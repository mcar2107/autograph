import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPaperFamilies } from '@pages/Generator/config/paperFamilies';
import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import { MARGIN_FALLBACK_STEPS } from '@pages/Generator/lib/paper';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import {
  PAPER_PROFILES_VERSION,
  parsePaperProfiles,
} from '@pages/Generator/model/paperProfiles';
import { describe, expect, it } from 'vitest';

import { getBaselineY, getLineStep } from './helpers/baseline-model';

/**
 * Разлиновка экземпляра в пикселях его фотографии: поля несимметричны и линия
 * поля справа, как у пресет-пака, — по ним видно, что разлиновка пришла из
 * артефакта, а не собрана фолбэком.
 */
const PROFILE_RULING = {
  step: 53.5,
  firstLinePhase: 41.2,
  skewAngle: -0.8,
  margins: { top: 94.7, right: 150, bottom: 90, left: 70 },
  marginLineX: 1450,
  marginLineSide: 'right',
  bend: null,
};

/**
 * Экземпляр в том виде, в каком его пишет скрипт сборки: разлиновка целиком в
 * `ruling`, наклона, шага и фазы на верхнем уровне нет, карта текстуры —
 * путь к файлу рядом с фотографией, а не data URL.
 */
const buildProfile = (id: string) => {
  return {
    id,
    label: `Клетка ${id}`,
    src: `/paper/grid/${id}.jpg`,
    width: 1600,
    height: 2050,
    ruling: PROFILE_RULING,
    lighting: {
      gridWidth: 2,
      gridHeight: 1,
      values: [1, 0.8],
      contrast: 0.2,
      isUsable: true,
    },
    texture: {
      src: '/paper/grid/1.texture.png',
      width: 256,
      height: 320,
      amplitude: 0.05,
    },
  };
};

const buildArtifact = (version: number = PAPER_PROFILES_VERSION) => {
  return { version, families: { grid: [buildProfile('1')] } };
};

/**
 * Требование `paper-profile`: страница, на которой не помещается ни одной
 * строки, — не страница.
 */
const MIN_PAGE_CAPACITY = 1;

/**
 * Листов в пресет-паке: по четыре в клетку и в линейку.
 */
const PRESET_SHEET_COUNT = 8;

describe('разбор артефакта профилей', () => {
  it('берёт разлиновку экземпляра как есть', () => {
    const profiles = parsePaperProfiles(buildArtifact());

    expect(profiles.grid?.[0]?.ruling).toEqual({
      ...PROFILE_RULING,
      sideSlant: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    });
  });

  it('принимает карту текстуры, заданную путём к файлу', () => {
    const profiles = parsePaperProfiles(buildArtifact());

    expect(profiles.grid?.[0]?.texture?.src).toBe('/paper/grid/1.texture.png');
    expect(profiles.grid?.[0]?.lighting?.isUsable).toBe(true);
  });

  it('отбрасывает артефакт чужой версии целиком', () => {
    expect(parsePaperProfiles(buildArtifact(PAPER_PROFILES_VERSION - 1))).toEqual({});
    expect(parsePaperProfiles(buildArtifact(PAPER_PROFILES_VERSION + 1))).toEqual({});
  });

  it('отбрасывает экземпляр без фотографии, оставляя остальные', () => {
    const profiles = parsePaperProfiles({
      version: PAPER_PROFILES_VERSION,
      families: { grid: [{ id: 'broken' }, buildProfile('1')] },
    });

    expect(
      profiles.grid?.map((sheet) => {
        return sheet.id;
      })
    ).toEqual(['1']);
  });
});

describe('закоммиченный артефакт пресет-пака', () => {
  /**
   * Сырой текст, а не разобранный объект: изгиб пишет скрипт сборки, читает
   * приложение, и расхождение формата молча выпрямило бы листы.
   */
  it('разбирает каждый лист с изгибом в сыром артефакте в изогнутый', () => {
    const text = readFileSync(
      join(process.cwd(), 'public', 'paper', 'profiles.json'),
      'utf8'
    );
    const rawBendCount = text.match(/"bend":\{/g)?.length || 0;
    const sheets = Object.values(parsePaperProfiles(JSON.parse(text))).flat();
    const bentCount = sheets.reduce((count, sheet) => {
      return sheet.ruling.bend === null ? count : count + 1;
    }, 0);

    expect(rawBendCount).toBeGreaterThan(0);
    expect(bentCount).toBe(rawBendCount);
  });

  /**
   * Требование `paper-profile`: перспектива и контур пресета посчитаны заранее.
   * Отсутствующее поле приложение читает так же, как `null`, поэтому
   * разобранный объект не отличит недособранный артефакт от измеренного — ключ
   * проверяется в сыром тексте.
   */
  it('несёт у каждого листа измеренные перспективу и контур', () => {
    const text = readFileSync(
      join(process.cwd(), 'public', 'paper', 'profiles.json'),
      'utf8'
    );
    const rulingCount = text.match(/"ruling":\{/g)?.length || 0;

    expect(rulingCount).toBeGreaterThan(0);
    expect(text.match(/"perspective":(null|\{)/g)?.length || 0).toBe(rulingCount);
    expect(text.match(/"outline":(null|\{)/g)?.length || 0).toBe(rulingCount);
  });

  /**
   * Фотографии пресетов обрезаны по листу, и плавного дрейфа шага на них нет:
   * укороченный промежуток у края кадра перспективой не считается. Проверяется
   * и сырой текст, и разобранный лист: испорченная перспектива разобралась бы
   * в `null` и прошла бы мимо проверки по разобранному объекту.
   */
  it('держит у каждого пресета лист без перспективы во весь кадр', () => {
    const text = readFileSync(
      join(process.cwd(), 'public', 'paper', 'profiles.json'),
      'utf8'
    );
    const sheets = Object.values(parsePaperProfiles(JSON.parse(text))).flat();
    const projectedSheetIds = sheets.reduce<string[]>((acc, sheet) => {
      if (sheet.ruling.perspective !== null || sheet.ruling.outline !== null) {
        acc.push(sheet.id);
      }

      return acc;
    }, []);

    expect(sheets).toHaveLength(PRESET_SHEET_COUNT);
    expect(text).not.toMatch(/"perspective":(?!null)/);
    expect(text).not.toMatch(/"outline":(?!null)/);
    expect(projectedSheetIds).toEqual([]);
  });
});

describe('сборка предустановленных семей', () => {
  it('подставляет посчитанные экземпляры в свою семью', () => {
    const [grid, lined] = buildPaperFamilies(parsePaperProfiles(buildArtifact()));

    expect(grid?.sheets).toHaveLength(1);
    expect(grid?.sheets[0]?.id).toBe('1');
    expect(grid?.sheets[0]?.ruling).toEqual({
      ...PROFILE_RULING,
      sideSlant: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    });
    expect(lined?.sheets).toHaveLength(4);
  });

  it('без артефакта отдаёт обе семьи с синтезированной разлиновкой листов', () => {
    const families = buildPaperFamilies({});

    expect(
      families.map((family) => {
        return family.id;
      })
    ).toEqual(['grid', 'lined']);

    for (const family of families) {
      for (const sheet of family.sheets) {
        const { ruling, width, height } = sheet;
        const fallback = ruling.step * MARGIN_FALLBACK_STEPS;

        /**
         * Шаг — доля кадра: клетка укладывается в ширину листа 33 раза,
         * линейка в высоту — 25.
         */
        const expectedStep = family.kind === 'grid' ? width / 33 : height / 25;

        expect(ruling.step).toBeCloseTo(expectedStep, 9);
        expect(ruling.margins.left).toBeCloseTo(fallback, 9);
        expect(ruling.margins.right).toBeCloseTo(fallback, 9);
        expect(ruling.margins.bottom).toBeCloseTo(fallback, 9);
        expect(ruling.margins.top + ruling.step).toBeGreaterThanOrEqual(fallback - 1e-9);
        expect(ruling.marginLineX).toBeNull();
        expect(ruling.marginLineSide).toBeNull();
        expect(sheet.lighting).toBeNull();
      }
    }
  });

  it('без артефакта листы дают рисуемую геометрию на обеих сторонах разворота', () => {
    for (const family of buildPaperFamilies({})) {
      for (const sheet of family.sheets) {
        for (const pageIndex of [0, 1]) {
          const calibration = getPageCalibration(family, sheet, pageIndex);
          const geometry = deriveGeometry(calibration, FALLBACK_FONT_METRICS);
          const lineStep = getLineStep(geometry, FALLBACK_FONT_METRICS);
          const bottomLine = calibration.height - calibration.ruling.margins.bottom;
          const firstBaseline = getBaselineY(geometry, FALLBACK_FONT_METRICS, 0);
          const capacity = Math.floor((bottomLine - firstBaseline) / lineStep) + 1;

          expect(geometry.blockWidth).toBeGreaterThan(0);
          expect(geometry.leftPadding).toBeGreaterThanOrEqual(0);
          expect(geometry.leftPadding + geometry.blockWidth).toBeLessThanOrEqual(
            sheet.width
          );
          expect(geometry.topOffset).toBeGreaterThanOrEqual(0);
          expect(capacity).toBeGreaterThanOrEqual(MIN_PAGE_CAPACITY);
        }
      }
    }
  });
});
