/**
 * @vitest-environment jsdom
 */
import type * as PaperModule from '@pages/Generator/lib/paper';
import {
  buildSheetRuling,
  detectRuling,
  MARGIN_FALLBACK_STEPS,
  measureSheetPhoto,
  type PaperMargins,
  type PaperSheet,
  type RulingKind,
  sampleRulingBend,
  type SheetOutline,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import { detectRowSkewAngle } from '@pages/Generator/lib/paper/detectSkewAngle';
import {
  getAllRecords,
  openDatabase,
  putRecord,
  SHEETS_STORE,
} from '@pages/Generator/model/indexedDb';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import { findFamily } from '@pages/Generator/model/paperSelectors';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { readUserSheets } from '@pages/Generator/model/userSheetsStorage';
import { PaperPicker } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import type { SheetRemeasure } from '@pages/Generator/ui/Generator/SettingsPane/useSheetRemeasure';
import { useSheetRemeasure } from '@pages/Generator/ui/Generator/SettingsPane/useSheetRemeasure';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeSyntheticLineEnds,
  computeSyntheticLineY,
  computeSyntheticMarginLineX,
  createSyntheticSheet,
  type SyntheticSheetParams,
} from './helpers/synthetic-sheet';
import {
  ANGLE_TOLERANCE,
  ARC_PHOTO,
  BENT_PHOTO,
  createArcPhoto,
  LEFT_HALF_BENT_PHOTO,
  MARGIN_TOLERANCE,
  readUserRuling,
  RIGHT_HALF_BENT_PHOTO,
  RULED_PHOTO,
  RULED_PHOTO_FOUND_MARGINS,
  scalePhoto,
  STEP_TOLERANCE,
  TILTED_ANGLE,
  uploadUserPhoto,
} from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Подменяется только съём пикселей: канвы в jsdom нет. Измерения идут
 * настоящим детектором — проверяется, что до листа доезжает всё найденное, а
 * не то, что диалог передал заранее известный ответ.
 */
const { decodeSheetImage } = vi.hoisted(() => {
  return { decodeSheetImage: vi.fn() };
});

vi.mock(
  '@pages/Generator/ui/Generator/SettingsPane/useSheetImport/decodeSheetImage',
  () => {
    return { decodeSheetImage };
  }
);

/**
 * Измерение остаётся настоящим, но с записью вызовов: вид, с которым перемер
 * зовёт измерение, по одному результату не виден — ручная разлиновка чистого
 * листа от него не зависит.
 */
vi.mock('@pages/Generator/lib/paper', async (importOriginal) => {
  const paper = await importOriginal<typeof PaperModule>();

  return { ...paper, measureSheetPhoto: vi.fn(paper.measureSheetPhoto) };
});

/**
 * Выбор бумаги и редактор разметки так, как их собирает панель оформления:
 * импорт и кнопка настройки плитки открывают редактор через его стор.
 */
const SheetDialogHarness: FC = () => {
  return (
    <>
      <PaperPicker />

      <SheetMarkupEditor />
    </>
  );
};

type User = ReturnType<typeof userEvent.setup>;

/**
 * Открывает редактор своего листа кнопкой настройки на его плитке.
 *
 * @param user — сессия `userEvent`
 * @param label — подпись листа
 */
const openSheetDialog = async (user: User, label: string) => {
  await user.click(screen.getByRole('button', { name: `Настроить «${label}»` }));
};

/**
 * Наибольший промах по полям: одна сторона, потерянная по дороге, даёт промах
 * на всю её ширину.
 *
 * @param actual — поля листа
 * @param expected — поля, нарисованные на снимке
 * @returns промах в пикселях
 */
const measureMarginMiss = (actual: PaperMargins, expected: PaperMargins): number => {
  return Math.max(
    Math.abs(actual.top - expected.top),
    Math.abs(actual.right - expected.right),
    Math.abs(actual.bottom - expected.bottom),
    Math.abs(actual.left - expected.left)
  );
};

/**
 * Шаг прохода по столбцам при сверке линий в пикселях.
 */
const RESTORE_COLUMN_STEP = 2;

/**
 * Допуск попадания линий по спеке: двадцатая часть шага.
 */
const RESTORE_TOLERANCE = 1 / 20;

/**
 * Запас над пределом раскладки узлов в долях шага для случаев, где предел
 * выше допуска спеки: замер узлов не должен добавлять к нему больше сотой шага.
 */
const LAYOUT_LIMIT_MARGIN = 0.01;

/**
 * Запас над промахом при угле свипа по линиям в долях шага. Угол вертикалей
 * там, где он сменил угол линий, может сдвинуть сетку узлов на дискретность
 * замера — у дуги во всю ширину втрое крупного кадра это три тысячных шага.
 */
const SWEEP_ANGLE_MARGIN = 0.005;

/**
 * Ширина кадра фотографии среднего разрешения в точках.
 */
const FRAME_1550_WIDTH = 1550;

/**
 * Шум ровного снимка: зерно бумаги сдвигает узлы изгиба, и на пути импорта
 * этот сдвиг не должен превращаться в изгиб.
 */
const FLAT_PHOTO_NOISE = 0.04;

const FLAT_PHOTO_SEED = 7;

/**
 * Тот же снимок на кадре шириной в 1550 точек. Множитель до него дробный,
 * поэтому кадр округляется до целых точек, как у настоящей фотографии.
 *
 * @param photo — снимок
 * @returns снимок на кадре 1550 точек
 */
const toFrame1550 = (photo: typeof ARC_PHOTO): SyntheticSheetParams => {
  const factor = FRAME_1550_WIDTH / RULED_PHOTO.width;

  return {
    ...scalePhoto(photo, factor),
    width: FRAME_1550_WIDTH,
    height: Math.round(RULED_PHOTO.height * factor),
  };
};

/**
 * Ровные снимки пути импорта: масштаб кадра, вид разлиновки и наклон.
 */
const FLAT_IMPORT_CASES = [1, 3].flatMap((scale) => {
  return (['lined', 'grid'] as const).flatMap((kind) => {
    return [0, 2, -2].map((angle) => {
      return [scale, kind, angle] as const;
    });
  });
});

/**
 * Наибольший промах линий, восстановленных по разлиновке листа, мимо линий
 * снимка — в долях шага, только в области с линиями: между верхним и нижним
 * полями, от линии поля слева до концов линий справа. Границы берутся на
 * высоте самой линии: у повёрнутого снимка линия поля и концы линий уходят
 * вбок по высоте кадра. Линия разлиновки сопоставляется с линией снимка по
 * высоте у левого края кадра.
 *
 * @param photo — описание снимка
 * @param ruling — разлиновка листа
 * @returns промах в долях шага снимка
 */
const measureRestoreError = (
  photo: SyntheticSheetParams,
  ruling: SheetRuling
): number => {
  const { step = 0, phase = 0, height = 0, width = 0, margins } = photo;
  const tangent = Math.tan((ruling.skewAngle * Math.PI) / 180);
  const firstIndex = Math.ceil(((margins?.top || 0) - phase) / step);
  const lastIndex = Math.floor((height - (margins?.bottom || 0) - phase) / step);
  let miss = 0;

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const line = Math.round((phase + index * step - ruling.firstLinePhase) / ruling.step);

    for (let x = 0; x < width; x += RESTORE_COLUMN_STEP) {
      const lineY = computeSyntheticLineY(photo, index, x);
      const ends = computeSyntheticLineEnds(photo, lineY);
      const left = Math.max(computeSyntheticMarginLineX(photo, lineY) || 0, ends.left);

      if (x >= left && x < ends.right) {
        const straight = ruling.firstLinePhase + line * ruling.step + x * tangent;
        const restored =
          straight +
          (ruling.bend ? sampleRulingBend(ruling.bend, ruling, x, straight) : 0);

        miss = Math.max(miss, Math.abs(restored - lineY));
      }
    }
  }

  return miss / step;
};

/**
 * Та же разлиновка с идеальным изгибом: смещения узлов её сетки сняты с
 * нарисованных линий в центрах узлов. Её промах — предел самой раскладки
 * узлов, без ошибки их замера.
 *
 * @param photo — описание снимка
 * @param ruling — разлиновка листа
 * @returns разлиновка с идеальными смещениями узлов
 */
const toIdealBendRuling = (
  photo: SyntheticSheetParams,
  ruling: SheetRuling
): SheetRuling => {
  const { bend, skewAngle, firstLinePhase, step } = ruling;

  if (!bend) {
    return ruling;
  }

  const { columnOrigin, columnSpacing, columnCount, rowOrigin, rowSpacing } = bend;
  const tangent = Math.tan((skewAngle * Math.PI) / 180);
  const firstLine = Math.round((rowOrigin - firstLinePhase) / step);
  const offsets = bend.offsets.map((_offset, node) => {
    const row = Math.floor(node / columnCount);
    const x = columnOrigin + (node % columnCount) * columnSpacing;
    const index = Math.round(
      (firstLinePhase + (firstLine + row) * step - (photo.phase || 0)) / (photo.step || 1)
    );

    return (
      computeSyntheticLineY(photo, index, x) -
      (rowOrigin + row * rowSpacing + x * tangent)
    );
  });

  return { ...ruling, bend: { ...bend, offsets } };
};

const WIDTH = 900;

const HEIGHT = 1200;

const STEP = 30;

/**
 * Клетка на листе, лежащем на столе: стол темнее бумаги и с крупным зерном, и
 * по всему кадру его ступени и шум сбивают профиль яркости — уверенность там
 * 0,00 против 0,945 внутри контура. Шаг детектор по кадру целиком всё же
 * достаёт, полосовой ступенью, но числа выходят чужие: вид `lined` вместо
 * `grid` и левое поле 193 px вместо 175 — шесть десятых шага мимо. Поэтому
 * меряется лист внутри контура, а не по кадру.
 */
const TABLE_PHOTO: SyntheticSheetParams = {
  width: WIDTH,
  height: HEIGHT,
  step: STEP,
  phase: 7,
  angle: 1,
  kind: 'grid',
  margins: { top: 200, right: 160, bottom: 180, left: 170 },
  lineWidth: 2,
  lineDarkness: 0.3,
  noise: 0.04,
  lighting: 0.2,
  seed: 5,
  surface: {
    outline: {
      topLeft: { x: 130, y: 120 },
      topRight: { x: 790, y: 110 },
      bottomRight: { x: 800, y: 1110 },
      bottomLeft: { x: 140, y: 1120 },
    },
    cornerRadius: 20,
    brightness: 0.3,
    grain: 0.3,
  },
};

/**
 * Лист без адресов файлов: из хранилища фотография и карта текстуры приходят
 * object URL, а характеристики — те же, что в сторе.
 *
 * @param sheet — лист
 * @returns характеристики листа без адресов
 */
const withoutUrls = (sheet: PaperSheet | undefined) => {
  if (!sheet) {
    return sheet;
  }

  const { src: _src, texture, ...rest } = sheet;

  return { ...rest, texture: texture && { ...texture, src: '' } };
};

beforeEach(() => {
  clearLayoutCache();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  useMarkupEditorStore.getState().close();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage?.clear();
  decodeSheetImage.mockReset();
  vi.mocked(measureSheetPhoto).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('импорт фотографии листа', () => {
  it('сохраняет у листа найденные шаг, поля и линию поля', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<SheetDialogHarness />);
    await uploadUserPhoto(user);

    const ruling = readUserRuling();

    expect(Math.abs((ruling?.step || 0) - RULED_PHOTO.step)).toBeLessThanOrEqual(
      STEP_TOLERANCE
    );
    expect(
      ruling && measureMarginMiss(ruling.margins, RULED_PHOTO_FOUND_MARGINS)
    ).toBeLessThanOrEqual(MARGIN_TOLERANCE);
    expect(ruling?.marginLineSide).toBe('left');
    expect(
      Math.abs((ruling?.marginLineX || 0) - RULED_PHOTO.marginLineX)
    ).toBeLessThanOrEqual(MARGIN_TOLERANCE);
  });

  it('лист на столе: у листа найденные внутри контура шаг и поля, контур сохранён', async () => {
    const user = userEvent.setup();
    const image = createSyntheticSheet(TABLE_PHOTO);
    const { step = 0 } = TABLE_PHOTO;

    decodeSheetImage.mockResolvedValue(image);

    render(<SheetDialogHarness />);
    await uploadUserPhoto(user);

    const ruling = readUserRuling();

    expect(ruling?.outline).not.toBeNull();
    expect(Math.abs((ruling?.step || 0) - step)).toBeLessThanOrEqual(STEP_TOLERANCE);
    /**
     * Точность самих полей держат юнит-тесты измерения фото; здесь — что до
     * листа доезжают поля, найденные внутри контура, а не по кадру целиком.
     */
    expect(
      measureMarginMiss(
        ruling?.margins || { top: 0, right: 0, bottom: 0, left: 0 },
        buildSheetRuling(measureSheetPhoto(image, { kind: 'grid' }).source, image).margins
      )
    ).toBe(0);
    expect((await readUserSheets())[0]?.sheet.ruling.outline).toStrictEqual(
      ruling?.outline
    );
  }, 60_000);

  it('сохраняет у повёрнутого листа найденный угол наклона', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(
      createSyntheticSheet({ ...RULED_PHOTO, angle: TILTED_ANGLE })
    );

    render(<SheetDialogHarness />);
    await uploadUserPhoto(user);

    const ruling = readUserRuling();

    expect(Math.abs((ruling?.skewAngle || 0) - TILTED_ANGLE)).toBeLessThanOrEqual(
      ANGLE_TOLERANCE
    );
    expect(Math.abs((ruling?.step || 0) - RULED_PHOTO.step)).toBeLessThanOrEqual(
      STEP_TOLERANCE
    );
  });

  it('кладёт в хранилище ту же разлиновку, что и в стор', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<SheetDialogHarness />);
    await uploadUserPhoto(user);

    const [stored] = await readUserSheets();

    expect(stored?.sheet.ruling).toEqual(readUserRuling());
  });

  it('сохраняет у изогнутого листа изгиб линий, и из хранилища он читается тем же', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(BENT_PHOTO));

    render(<SheetDialogHarness />);
    await uploadUserPhoto(user);

    const bend = readUserRuling()?.bend;

    expect(bend?.offsets.length).toBeGreaterThan(0);

    useGeneratorStore.setState({ userSheets: [] });
    await useGeneratorStore.getState().restoreUserSheets();

    expect(readUserRuling()?.bend).toStrictEqual(bend);
  });

  /**
   * Угол сверяется с наклоном там, где линейной части у прогиба в области нет:
   * прогиб симметричен в области или идёт дугой во всю ширину кадра. У прогиба
   * на одной половине области линейная часть уходит в угол, и сверяются только
   * линии, бока и линия поля.
   *
   * У предела раскладки узлов промах выше допуска спеки и при идеальных узлах:
   * прогиб на половине области короче восьми шагов, а дуга и прогиб на
   * половине у края, срезанного наклоном, выходят за крайний узел области,
   * суженной наклоном в два градуса. Там промах сверяется с пределом той же
   * сетки.
   */
  it.each([
    ['прогиб в середине области без наклона', BENT_PHOTO, 0, true, false],
    ['прогиб в середине области с наклоном 1°', BENT_PHOTO, 1, true, false],
    ['прогиб в середине области с наклоном −2°', BENT_PHOTO, -2, true, false],
    ['прогиб в середине области с наклоном 2°', BENT_PHOTO, 2, true, false],
    [
      'втрое крупный кадр, прогиб в середине, наклон 2°',
      scalePhoto(BENT_PHOTO, 3),
      2,
      true,
      false,
    ],
    [
      'втрое крупный кадр, прогиб в середине, наклон −2°',
      scalePhoto(BENT_PHOTO, 3),
      -2,
      true,
      false,
    ],
    ['дуга во всю ширину кадра', ARC_PHOTO, 0, true, false],
    ['втрое крупный кадр, дуга во всю ширину', scalePhoto(ARC_PHOTO, 3), 0, true, false],
    ['прогиб на левой половине области', LEFT_HALF_BENT_PHOTO, 0, false, false],
    [
      'втрое крупный кадр, прогиб на левой половине, наклон 2°',
      scalePhoto(LEFT_HALF_BENT_PHOTO, 3),
      2,
      false,
      false,
    ],
    [
      'втрое крупный кадр, прогиб на правой половине, наклон −2°',
      scalePhoto(RIGHT_HALF_BENT_PHOTO, 3),
      -2,
      false,
      false,
    ],
    [
      'предел раскладки: втрое крупный кадр, прогиб на левой половине',
      scalePhoto(LEFT_HALF_BENT_PHOTO, 3),
      0,
      false,
      true,
    ],
    [
      'предел раскладки: втрое крупный кадр, прогиб на левой половине у среза, наклон −2°',
      scalePhoto(LEFT_HALF_BENT_PHOTO, 3),
      -2,
      false,
      true,
    ],
    [
      'предел раскладки: втрое крупный кадр, прогиб на правой половине у среза, наклон 2°',
      scalePhoto(RIGHT_HALF_BENT_PHOTO, 3),
      2,
      false,
      true,
    ],
    ['предел раскладки: дуга, наклон 2°', ARC_PHOTO, 2, true, true],
    ['предел раскладки: дуга, наклон −2°', ARC_PHOTO, -2, true, true],
    [
      'предел раскладки: втрое крупный кадр, дуга, наклон 2°',
      scalePhoto(ARC_PHOTO, 3),
      2,
      true,
      true,
    ],
    [
      'предел раскладки: втрое крупный кадр, дуга, наклон −2°',
      scalePhoto(ARC_PHOTO, 3),
      -2,
      true,
      true,
    ],
  ] as const)(
    'импорт изогнутого листа (%s): линии, бока и линия поля — как у ровного',
    async (_name, bentPhoto, angle, isAngleChecked, isLayoutLimit) => {
      const user = userEvent.setup();
      const photo = { ...bentPhoto, angle };
      const { bend: _bend, ...flatPhoto } = photo;
      const image = createSyntheticSheet(photo);

      decodeSheetImage.mockResolvedValue(image);

      render(<SheetDialogHarness />);
      await uploadUserPhoto(user);

      const ruling = readUserRuling();

      if (!ruling) {
        throw new Error('Лист не добавлен');
      }

      const flatImage = createSyntheticSheet(flatPhoto);
      const flat = buildSheetRuling(detectRuling(flatImage), flatImage);
      const sweepRuling = buildSheetRuling(
        detectRuling(image, { skewAngle: detectRowSkewAngle(image) }),
        image
      );
      const restoreError = measureRestoreError(photo, ruling);

      expect(ruling.bend).not.toBeNull();
      expect(restoreError).toBeLessThanOrEqual(
        isLayoutLimit
          ? measureRestoreError(photo, toIdealBendRuling(photo, ruling)) +
              LAYOUT_LIMIT_MARGIN
          : RESTORE_TOLERANCE
      );
      expect(restoreError).toBeLessThanOrEqual(
        measureRestoreError(photo, sweepRuling) + SWEEP_ANGLE_MARGIN
      );
      expect(ruling.marginLineSide).toBe(flat.marginLineSide);
      expect(
        Math.abs((ruling.marginLineX || 0) - (flat.marginLineX || 0))
      ).toBeLessThanOrEqual(MARGIN_TOLERANCE);
      expect(
        measureMarginMiss(ruling.margins, {
          ...flat.margins,
          top: ruling.margins.top,
          bottom: ruling.margins.bottom,
        })
      ).toBeLessThanOrEqual(MARGIN_TOLERANCE);

      if (isAngleChecked) {
        expect(Math.abs(ruling.skewAngle - angle)).toBeLessThanOrEqual(ANGLE_TOLERANCE);
      }
    },
    60_000
  );

  /**
   * Дуга во всю ширину кадра под наклоном: в узлах сетки линия отходит от
   * прямой разлиновки меньше двадцатой шага, а у краёв области, за крайними
   * узлами, — больше. Проверяется только решение «ровный или изогнутый» и
   * попадание линий; угол и бока против ровного двойника сверяет тест выше.
   */
  it.each([
    ['дуга 0,15 шага, наклон 1°', createArcPhoto(0.15), 1],
    ['дуга 0,15 шага, наклон −1°', createArcPhoto(0.15), -1],
    [
      'втрое крупный кадр, дуга 0,15 шага, наклон 1°',
      scalePhoto(createArcPhoto(0.15), 3),
      1,
    ],
    [
      'втрое крупный кадр, дуга 0,15 шага, наклон −1°',
      scalePhoto(createArcPhoto(0.15), 3),
      -1,
    ],
    ['кадр 1550 px, дуга 0,15 шага, наклон 1°', toFrame1550(createArcPhoto(0.15)), 1],
    ['кадр 1550 px, дуга 0,15 шага, наклон −1°', toFrame1550(createArcPhoto(0.15)), -1],
    ['дуга 0,2 шага, наклон 1,5°', createArcPhoto(0.2), 1.5],
    ['кадр 1550 px, дуга 0,2 шага, наклон 1,5°', toFrame1550(createArcPhoto(0.2)), 1.5],
    ['кадр 1550 px, дуга 0,2 шага, наклон −1,5°', toFrame1550(createArcPhoto(0.2)), -1.5],
  ] as const)(
    'импорт дуги под наклоном (%s): лист не сохраняется ровным',
    async (_name, bentPhoto, angle) => {
      const user = userEvent.setup();
      const photo = { ...bentPhoto, angle };

      decodeSheetImage.mockResolvedValue(createSyntheticSheet(photo));

      render(<SheetDialogHarness />);
      await uploadUserPhoto(user);

      const ruling = readUserRuling();

      if (!ruling) {
        throw new Error('Лист не добавлен');
      }

      expect(measureRestoreError(photo, { ...ruling, bend: null })).toBeGreaterThan(
        RESTORE_TOLERANCE
      );
      expect(ruling.bend).not.toBeNull();
      expect(measureRestoreError(photo, ruling)).toBeLessThanOrEqual(RESTORE_TOLERANCE);
    },
    60_000
  );

  /**
   * Шаг сверяется, чтобы лист не остался ровным только из-за того, что
   * разлиновка не нашлась.
   */
  it.each(FLAT_IMPORT_CASES)(
    'импорт ровного листа (кадр ×%i, %s, наклон %i°): изгиб не сохраняется',
    async (scale, kind, angle) => {
      const user = userEvent.setup();

      decodeSheetImage.mockResolvedValue(
        createSyntheticSheet({
          ...scalePhoto(RULED_PHOTO, scale),
          kind,
          angle,
          noise: FLAT_PHOTO_NOISE,
          seed: FLAT_PHOTO_SEED,
        })
      );

      render(<SheetDialogHarness />);
      await uploadUserPhoto(user);

      const ruling = readUserRuling();

      expect(
        Math.abs((ruling?.step || 0) - RULED_PHOTO.step * scale)
      ).toBeLessThanOrEqual(STEP_TOLERANCE * scale);
      expect(ruling?.bend).toBeNull();
    },
    60_000
  );

  it('на ненайденной разлиновке оставляет лист с нулевым шагом и без линии поля', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(
      createSyntheticSheet({
        ...RULED_PHOTO,
        kind: 'blank',
        marginLineX: null,
        noise: 0.06,
        lighting: 0.3,
      })
    );

    render(<SheetDialogHarness />);
    await uploadUserPhoto(user);

    expect(readUserRuling()?.step).toBe(0);
    expect(readUserRuling()?.marginLineX).toBeNull();
  });
});

const TABLE_SHEET_LABEL = 'Лист на столе';

/**
 * Контур, найденный «с ошибкой»: дробные углы проверяют округление формы до
 * сотых, а стороны не параллельны краям — начальные значения берутся по
 * вписанному прямоугольнику, а не по одному из углов.
 */
const WRONG_OUTLINE: SheetOutline = {
  topLeft: { x: 20.123, y: 30.456 },
  topRight: { x: 880.5, y: 25.111 },
  bottomRight: { x: 870.014, y: 1180.789 },
  bottomLeft: { x: 15.5, y: 1170.333 },
};

/**
 * Границы листа на снимке, заданные руками: внутри настоящего контура.
 */
const MANUAL_BOUNDS: PaperMargins = { top: 135, right: 115, bottom: 95, left: 150 };

/**
 * Поля, заданные руками до перемера. Шаг ненулевой, иначе форма разлиновки не
 * показала бы поля, и перетирание нечем было бы проверить. Каждое поле лежит
 * внутри листа с границами `MANUAL_BOUNDS` — дальше полутора шагов от них:
 * такое поле перемер не трогает.
 */
const MANUAL_RULING = {
  step: 41,
  firstLinePhase: 3,
  skewAngle: 0,
  margins: { top: 333, right: 222, bottom: 199.5, left: 444 },
};

/**
 * Свой лист, у которого автопоиск контура ошибся, а поля поправлены руками.
 * Света и текстуры у него нет: по их появлению видно, что перемер их заменил.
 */
const SEEDED_SHEET: PaperSheet = {
  id: 'user-table',
  label: TABLE_SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  width: WIDTH,
  height: HEIGHT,
  ruling: buildSheetRuling(
    { ...MANUAL_RULING, outline: WRONG_OUTLINE },
    { width: WIDTH, height: HEIGHT }
  ),
  lighting: null,
  texture: null,
};

/**
 * Тот же лист, но с полями, которые поставил фолбэк по ошибочному контуру:
 * полтора шага от его сторон. По записи фолбэк от ручного ввода не отличить,
 * поэтому перемер судит по новому контуру, а не по происхождению числа.
 */
const FALLBACK_SHEET: PaperSheet = {
  ...SEEDED_SHEET,
  ruling: buildSheetRuling(
    {
      ...MANUAL_RULING,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      outline: WRONG_OUTLINE,
    },
    { width: WIDTH, height: HEIGHT }
  ),
};

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const SMALL_BOUNDS_ERROR = 'Границы оставляют слишком маленький лист';

/**
 * Прямоугольный контур по отступам от краёв кадра.
 *
 * @param bounds — отступы
 * @returns контур
 */
const toRectOutline = (bounds: PaperMargins): SheetOutline => {
  const right = WIDTH - bounds.right;
  const bottom = HEIGHT - bounds.bottom;

  return {
    topLeft: { x: bounds.left, y: bounds.top },
    topRight: { x: right, y: bounds.top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: bounds.left, y: bottom },
  };
};

/**
 * Кладёт свой лист в стор.
 *
 * @param isBlank — лист добавлен без разлиновки; семья у него всё равно клетка
 */
const seedSheet = (isBlank = false) => {
  useGeneratorStore.getState().addUserSheet(
    buildUserSheetRecord({
      familyId: 'grid',
      sheet: SEEDED_SHEET,
      kind: isBlank ? 'blank' : 'grid',
    })
  );
};

/**
 * Превращает записи хранилища в записи прежней формы — без вида листа — и
 * перечитывает их, как при перезагрузке.
 */
const restoreWithoutKind = async () => {
  /**
   * Чтение встаёт в очередь хранилища за записью листа: после него запись
   * уже в базе.
   */
  await readUserSheets();

  const database = await openDatabase();

  try {
    const records = await getAllRecords(database, SHEETS_STORE);

    for (const record of records) {
      if (typeof record === 'object' && record !== null) {
        const { kind: _kind, ...legacy } = { kind: null, ...record };

        await putRecord(database, SHEETS_STORE, legacy);
      }
    }
  } finally {
    database.close();
  }

  useGeneratorStore.setState({ userSheets: [] });
  await useGeneratorStore.getState().restoreUserSheets();
};

/**
 * Запись своего листа в сторе.
 *
 * @returns запись; `undefined` — листа нет
 */
const readUserSheet = (): PaperSheet | undefined => {
  return useGeneratorStore.getState().userSheets[0]?.sheet;
};

/**
 * Перемер своего листа хуком редактора так, как его зовёт инструмент
 * «Контур»: лист и вид — из стора, семья — по записи листа.
 *
 * @param sheetId — лист, перемер которого отслеживается
 * @returns хук перемера в обёртке `renderHook`
 */
const renderRemeasure = (sheetId = SEEDED_SHEET.id) => {
  return renderHook(
    (id: string) => {
      return useSheetRemeasure(id);
    },
    { initialProps: sheetId }
  );
};

/**
 * Перемеряет лист в заданных границах.
 *
 * @param remeasure — метод перемера из хука
 * @param bounds — отступы границ от краёв кадра
 * @param kind — вид листа; не задан — вид записи
 */
const remeasureSheet = async (
  remeasure: SheetRemeasure['remeasure'],
  bounds: PaperMargins,
  kind?: RulingKind
) => {
  const { userSheets, presetFamilies } = useGeneratorStore.getState();
  const record = userSheets.find(({ sheet }) => {
    return sheet.id === SEEDED_SHEET.id;
  });
  const family = record && findFamily(presetFamilies, record.familyId);

  if (!record || !family) {
    throw new Error('Лист для перемера не найден');
  }

  await act(async () => {
    await remeasure({
      family,
      sheet: record.sheet,
      kind: kind || record.kind,
      bounds,
    });
  });
};

describe('ручная правка границ листа', () => {
  beforeEach(() => {
    decodeSheetImage.mockResolvedValue(createSyntheticSheet(TABLE_PHOTO));
  });

  it('перемер заменяет разлиновку, свет и текстуру, сохраняя id, подпись и фотографию', async () => {
    seedSheet();

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS);

    const sheet = readUserSheet();

    expect(sheet?.ruling.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));
    expect(decodeSheetImage).toHaveBeenCalledWith(SEEDED_SHEET.src);
    expect(sheet?.id).toBe(SEEDED_SHEET.id);
    expect(sheet?.label).toBe(SEEDED_SHEET.label);
    expect(sheet?.src).toBe(SEEDED_SHEET.src);
    expect(sheet?.lighting).not.toBeNull();
    expect(Math.abs((sheet?.ruling.step || 0) - STEP)).toBeLessThanOrEqual(
      STEP_TOLERANCE
    );
    expect(withoutUrls((await readUserSheets())[0]?.sheet)).toStrictEqual(
      withoutUrls(sheet)
    );
  }, 60_000);

  it('перемер перетирает поля, заданные руками', async () => {
    seedSheet();

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS);

    const ruling = readUserRuling();

    expect(ruling?.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));
    SIDES.forEach((side) => {
      expect(ruling?.margins[side]).not.toBe(MANUAL_RULING.margins[side]);
    });
  }, 60_000);

  it.each([
    ['по высоте', { top: 450, right: 0, bottom: 460, left: 0 }],
    ['по ширине', { top: 0, right: 350, bottom: 0, left: 330 }],
    ['отрицательный отступ', { top: -10, right: 0, bottom: 0, left: 0 }],
  ] as const)(
    'границы, оставляющие слишком маленький лист (%s), дают сообщение, лист не меняется',
    async (_name, bounds) => {
      seedSheet();

      const before = readUserSheet();
      const { result } = renderRemeasure();

      await remeasureSheet(result.current.remeasure, bounds);

      expect(result.current.error).toBe(SMALL_BOUNDS_ERROR);
      expect(readUserSheet()).toBe(before);
      expect(decodeSheetImage).not.toHaveBeenCalled();
    }
  );

  it('после перечтения хранилища лист остаётся с заданным контуром', async () => {
    seedSheet();

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS);

    const measured = readUserSheet();

    expect(measured?.ruling.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));

    useGeneratorStore.setState({ userSheets: [] });
    await useGeneratorStore.getState().restoreUserSheets();

    expect(readUserSheet()?.ruling.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));
    expect(readUserSheet()?.ruling).toEqual(measured?.ruling);
  }, 60_000);

  it('сообщение об ошибке не переходит на другой лист', async () => {
    seedSheet();

    const { result, rerender } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, {
      top: 450,
      right: 0,
      bottom: 460,
      left: 0,
    });

    expect(result.current.error).toBe(SMALL_BOUNDS_ERROR);

    rerender('user-other');

    expect(result.current.error).toBeNull();

    rerender(SEEDED_SHEET.id);

    expect(result.current.error).toBeNull();
  });

  it('пока идёт перемер, хук занят', async () => {
    let resolveDecode: (image: unknown) => void = () => {};

    decodeSheetImage.mockReturnValue(
      new Promise((resolve) => {
        resolveDecode = resolve;
      })
    );
    seedSheet();

    const { result } = renderRemeasure();
    const record = useGeneratorStore.getState().userSheets[0];
    const family = findFamily(useGeneratorStore.getState().presetFamilies, 'grid');

    if (!record || !family) {
      throw new Error('Лист для перемера не найден');
    }

    let pending: Promise<void> = Promise.resolve();

    act(() => {
      pending = result.current.remeasure({
        family,
        sheet: record.sheet,
        kind: record.kind,
        bounds: MANUAL_BOUNDS,
      });
    });

    expect(result.current.isBusy).toBe(true);

    resolveDecode(createSyntheticSheet(TABLE_PHOTO));

    await act(async () => {
      await pending;
    });

    expect(result.current.isBusy).toBe(false);
  }, 60_000);
});

describe('перемер чистого листа', () => {
  beforeEach(() => {
    decodeSheetImage.mockResolvedValue(createSyntheticSheet(TABLE_PHOTO));
  });

  it('меняет контур и свет, а шаг, фазу и поля оставляет заданными руками', async () => {
    seedSheet(true);

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS);

    expect(readUserSheet()?.ruling.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));

    const [record] = useGeneratorStore.getState().userSheets;
    const { step, firstLinePhase, skewAngle, margins } = SEEDED_SHEET.ruling;

    expect(measureSheetPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'blank' })
    );
    expect(record?.kind).toBe('blank');
    expect(record?.sheet.lighting).not.toBeNull();
    expect(record?.sheet.ruling).toMatchObject({
      step,
      firstLinePhase,
      skewAngle,
      margins,
    });
    const [stored] = await readUserSheets();

    expect(stored && { ...stored, sheet: withoutUrls(stored.sheet) }).toStrictEqual(
      record && { ...record, sheet: withoutUrls(record.sheet) }
    );
  }, 60_000);

  it('поля, оставшиеся от прежнего контура, уходят внутрь нового', async () => {
    useGeneratorStore
      .getState()
      .addUserSheet(
        buildUserSheetRecord({ familyId: 'grid', sheet: FALLBACK_SHEET, kind: 'blank' })
      );

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS);

    const ruling = readUserSheet()?.ruling;
    const fallback = MANUAL_RULING.step * MARGIN_FALLBACK_STEPS;

    expect(ruling?.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));
    expect(ruling?.step).toBe(FALLBACK_SHEET.ruling.step);
    expect(ruling?.firstLinePhase).toBe(FALLBACK_SHEET.ruling.firstLinePhase);
    expect(ruling?.skewAngle).toBe(FALLBACK_SHEET.ruling.skewAngle);
    SIDES.forEach((side) => {
      expect(ruling?.margins[side]).toBeGreaterThanOrEqual(
        MANUAL_BOUNDS[side] + fallback
      );
    });
  }, 60_000);

  it('запись прежней формы без вида листа читается видом семьи: перемер ищет разлиновку', async () => {
    seedSheet();
    await restoreWithoutKind();

    expect(useGeneratorStore.getState().userSheets[0]?.kind).toBe('grid');

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS);

    expect(readUserSheet()?.ruling.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));
    expect(measureSheetPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'grid' })
    );
    expect(Math.abs((readUserSheet()?.ruling.step || 0) - STEP)).toBeLessThanOrEqual(
      STEP_TOLERANCE
    );
  }, 60_000);

  it('лист, перемеренный видом «без разлиновки», не ищет линии и оставляет заданное руками', async () => {
    seedSheet();

    const { result } = renderRemeasure();

    await remeasureSheet(result.current.remeasure, MANUAL_BOUNDS, 'blank');

    expect(readUserSheet()?.ruling.outline).toStrictEqual(toRectOutline(MANUAL_BOUNDS));
    expect(measureSheetPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'blank' })
    );
    expect(useGeneratorStore.getState().userSheets[0]?.kind).toBe('blank');
    expect(readUserSheet()?.ruling.step).toBe(MANUAL_RULING.step);
  }, 60_000);
});

describe('удаление листа', () => {
  it('после подтверждения лист пропадает из выбора бумаги и из хранилища', async () => {
    const user = userEvent.setup();

    seedSheet();
    render(<SheetDialogHarness />);
    await openSheetDialog(user, TABLE_SHEET_LABEL);

    await user.click(screen.getByRole('button', { name: 'Удалить лист' }));

    expect(useGeneratorStore.getState().userSheets).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Да, удалить' }));

    expect(useGeneratorStore.getState().userSheets).toHaveLength(0);
    expect(await readUserSheets()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.queryByRole('button', { name: `Настроить «${TABLE_SHEET_LABEL}»` })
    ).toBeNull();
  });

  it('отказ от удаления оставляет лист', async () => {
    const user = userEvent.setup();

    seedSheet();
    render(<SheetDialogHarness />);
    await openSheetDialog(user, TABLE_SHEET_LABEL);

    await user.click(screen.getByRole('button', { name: 'Удалить лист' }));
    await user.click(screen.getByRole('button', { name: 'Не удалять' }));

    expect(useGeneratorStore.getState().userSheets).toHaveLength(1);
    expect(await readUserSheets()).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});

describe('фотография листа', () => {
  it('диалог показывает фотографию своего листа', async () => {
    const user = userEvent.setup();

    seedSheet();
    render(<SheetDialogHarness />);
    await openSheetDialog(user, TABLE_SHEET_LABEL);

    expect(
      screen.getByRole('img', { name: `Фотография листа «${TABLE_SHEET_LABEL}»` })
    ).toHaveProperty('src', SEEDED_SHEET.src);
  });
});
