import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type { GeometryCorrection } from '@pages/Generator/lib/calibrate';
import type {
  GlyphOutline,
  GlyphPathCommand,
  GlyphPoint,
  GlyphSource,
} from '@pages/Generator/lib/glyph';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { Page } from '@pages/Generator/lib/paginate/paginate.types';
import type {
  PaperFamily,
  PaperSheet,
  RulingPerspective,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import type * as RulingPerspectiveModule from '@pages/Generator/lib/paper/rulingPerspective';
import {
  lineCoordinateAt,
  lineHeightAt,
} from '@pages/Generator/lib/paper/rulingPerspective';
import type { PageGlyphs, PageRenderParams } from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import { buildPageRenderParams } from '@pages/Generator/model/buildPageRenderParams';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import { describe, expect, it, vi } from 'vitest';

import { NO_DISTORTION_FLAGS } from './helpers/distortion-flags';
import { createPathRecorder } from './helpers/path-recorder';

vi.mock('@pages/Generator/lib/paper/rulingPerspective', async (importOriginal) => {
  const actual = await importOriginal<typeof RulingPerspectiveModule>();

  return { ...actual, lineHeightAt: vi.fn(actual.lineHeightAt) };
});

/**
 * Лист-модель: шаг у нижних линий примерно на шесть процентов больше, чем у
 * верхних, линии сходятся по ширине, наклон — градус.
 */
const RULING_STEP = 40;
const SHEET_WIDTH = 1600;
const SHEET_HEIGHT = 1200;
const SKEW_ANGLE = 1;
const FIRST_LINE_PHASE = 60;
const SHEET_MARGIN = 100;

const PERSPECTIVE: RulingPerspective = {
  originX: SHEET_WIDTH / 2,
  originY: SHEET_HEIGHT / 2,
  convergenceX: 2.5e-5,
  convergenceY: 2.5e-5,
};

/**
 * Допуск попадания низа букв на линию — десятая доля шага, как в требовании.
 */
const TOLERANCE_STEPS = 0.1;

/**
 * Разрешение отрисовки не единичное: перспектива обязана считаться в пикселях
 * страницы, а не в пикселях канвы.
 */
const SCALE = 2;

/**
 * Строк на странице столько, чтобы блок дошёл до нижнего поля: у верхних линий
 * перспектива почти не отличается от прямой гребёнки, и на коротком тексте
 * контроль ничего не поймал бы.
 */
const LINE_COUNT = 24;

/**
 * Точек на строке заведомо больше: если их мало, контуры не дошли до записи, и
 * проверка попадания прошла бы на пустом месте.
 */
const MIN_POINTS_PER_LINE = 40;

/**
 * Столбцы, по которым ищется низ тела букв: ширина столбца и полуширина
 * полосы, в которую должна попасть точка контура.
 */
const COLUMN_WIDTH = 6;
const COLUMN_BAND = 2;

/**
 * Лист с перспективой.
 *
 * @param perspective — перспектива разлиновки; `null` — линии через равный шаг
 * @param id — идентификатор экземпляра
 * @returns экземпляр листа
 */
const buildSheet = (perspective: RulingPerspective | null, id: string): PaperSheet => {
  return {
    id,
    label: 'Лист на столе',
    src: `/paper/${id}.jpg`,
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    ruling: {
      step: RULING_STEP,
      firstLinePhase: FIRST_LINE_PHASE,
      skewAngle: SKEW_ANGLE,
      margins: {
        top: SHEET_MARGIN,
        right: SHEET_MARGIN,
        bottom: SHEET_MARGIN,
        left: SHEET_MARGIN,
      },
      marginLineX: null,
      marginLineSide: null,
      sideSlant: null,
      bend: null,
      perspective,
      outline: null,
      mirrorOverride: null,
    },
    lighting: null,
    texture: null,
  };
};

const SHEET = buildSheet(PERSPECTIVE, 'sloped');
const FLAT_SHEET = buildSheet(null, 'flat');

const FAMILY: PaperFamily = {
  id: 'lined',
  label: 'В линейку',
  kind: 'lined',
  sheets: [SHEET, FLAT_SHEET],
};

/**
 * Синтетическая буква: низ тела лежит ровно на базовой линии по всей ширине,
 * поэтому «низ тела в столбце» считается без поправок на рисунок шрифта. Тело
 * заметно ниже шага разлиновки: точка буквы не должна попадать в полосу
 * соседней линии.
 */
const UNITS_PER_EM = 1000;
const LETTER_ADVANCE = 500;
const LETTER_HEIGHT = 250;
const BOTTOM_SEGMENTS = 10;

/**
 * Доля ширины буквы, на которую верх отступает от каждого края. Верх уже низа:
 * у края буквы, где столбец может не поймать ни одной точки низа, нет и точек
 * верха, и верх не выдаёт себя за низ столбца.
 */
const TOP_INSET = 0.25;

/**
 * Контур буквы: низ — отрезки по базовой линии, боковины сходятся к узкому
 * верху, верх — квадратичная кривая.
 *
 * @returns команды контура в единицах шрифта
 */
const buildLetterCommands = (): GlyphPathCommand[] => {
  const commands: GlyphPathCommand[] = [{ type: 'M', x: 0, y: 0 }];

  for (let index = 1; index <= BOTTOM_SEGMENTS; index += 1) {
    commands.push({ type: 'L', x: (index * LETTER_ADVANCE) / BOTTOM_SEGMENTS, y: 0 });
  }

  commands.push(
    { type: 'L', x: LETTER_ADVANCE * (1 - TOP_INSET), y: LETTER_HEIGHT },
    {
      type: 'Q',
      x1: LETTER_ADVANCE / 2,
      y1: LETTER_HEIGHT * 1.2,
      x: LETTER_ADVANCE * TOP_INSET,
      y: LETTER_HEIGHT,
    },
    { type: 'Z' }
  );

  return commands;
};

const LETTER: GlyphOutline = {
  char: 'м',
  commands: buildLetterCommands(),
  advanceWidth: LETTER_ADVANCE,
};

const SPACE: GlyphOutline = { char: ' ', commands: [], advanceWidth: LETTER_ADVANCE / 2 };

const GLYPH_SOURCE: GlyphSource = {
  unitsPerEm: UNITS_PER_EM,
  getGlyph: (char) => {
    return char === ' ' ? SPACE : LETTER;
  },
  getKerning: () => {
    return 0;
  },
};

const GLYPHS: PageGlyphs = { source: GLYPH_SOURCE, hasVariance: false };

/**
 * Строка во всю ширину блока: чем дальше от начала перспективы, тем больше
 * расходятся прямая гребёнка и линии фотографии.
 */
const WORDS_LINE = Array.from({ length: 8 }, () => {
  return 'м'.repeat(6);
}).join(' ');

const PAGE: Page = {
  lines: Array.from({ length: LINE_COUNT }, () => {
    return { text: WORDS_LINE, paragraphIndex: 0 };
  }),
};

/**
 * Параметры отрисовки страницы — через тот же адаптер, которым их собирает
 * приложение.
 *
 * @param pageIndex — номер страницы, считая с нуля
 * @param glyphs — контуры шрифта; `null` — буквы рисуются текстом
 * @param correction — ручная поправка геометрии в долях шага
 * @returns параметры отрисовки
 */
const buildParams = (
  pageIndex: number,
  glyphs: PageGlyphs | null,
  correction: GeometryCorrection = DEFAULT_GEOMETRY_CORRECTION
): PageRenderParams => {
  return buildPageRenderParams({
    page: PAGE,
    calibration: getPageCalibration(FAMILY, SHEET, pageIndex),
    sheetImage: null,
    metrics: FALLBACK_FONT_METRICS,
    correction,
    inkColor: '#101010',
    fontFamily: 'Synthetic',
    flags: NO_DISTORTION_FLAGS,
    wordFrequency: 1,
    letterFrequency: 1,
    seed: 42,
    ink: { lighting: null, texture: null, seed: 7 },
    glyphs,
    scale: SCALE,
  });
};

/**
 * Те же параметры на листе без перспективы в геометрии.
 *
 * @param params — параметры отрисовки
 * @returns параметры, в которых строки идут по прямой гребёнке
 */
const stripPerspective = (params: PageRenderParams): PageRenderParams => {
  return { ...params, geometry: { ...params.geometry, perspective: null } };
};

/**
 * Точки залитых контуров в пикселях страницы — без масштаба отрисовки.
 *
 * @param params — параметры отрисовки
 * @returns точки контуров в порядке записи
 */
const renderPoints = (params: PageRenderParams): GlyphPoint[] => {
  const recorder = createPathRecorder();

  renderPageToCanvas(recorder.context, params);

  return recorder.polylines.flatMap((polyline) => {
    return polyline.map(({ x, y }) => {
      return { x: x / SCALE, y: y / SCALE };
    });
  });
};

/**
 * Точки букв, нарисованных текстом: начало каждой буквы на её базовой линии.
 *
 * @param params — параметры отрисовки
 * @returns точки в пикселях страницы
 */
const renderLetterPoints = (params: PageRenderParams): GlyphPoint[] => {
  const recorder = createPathRecorder();

  renderPageToCanvas(recorder.context, params);

  return recorder.texts.map(({ x, y }) => {
    return { x: x / SCALE, y: y / SCALE };
  });
};

/**
 * Номер линии разлиновки, ближайшей к точке страницы.
 *
 * @param ruling — разлиновка фотографии страницы
 * @param point — точка страницы
 * @returns номер линии на гребёнке
 */
const toLineIndex = (ruling: SheetRuling, { x, y }: GlyphPoint): number => {
  return Math.round(
    (lineCoordinateAt(ruling, x, y) - ruling.firstLinePhase) / ruling.step
  );
};

/**
 * Насколько точка отходит от ближайшей линии фотографии, в долях шага.
 *
 * @param ruling — разлиновка фотографии страницы
 * @param point — точка страницы
 * @returns отклонение в долях шага
 */
const measureLineDrift = (ruling: SheetRuling, point: GlyphPoint): number => {
  const { firstLinePhase, step } = ruling;
  const lineY = lineHeightAt(
    ruling,
    point.x,
    firstLinePhase + toLineIndex(ruling, point) * step
  );

  return Math.abs(point.y - lineY) / step;
};

/**
 * Самая нижняя точка контуров в каждом столбце каждой строки — низ тела букв.
 *
 * @param ruling — разлиновка фотографии страницы
 * @param points — точки контуров страницы
 * @returns нижние точки столбцов
 */
const measureGlyphBaselines = (
  ruling: SheetRuling,
  points: GlyphPoint[]
): GlyphPoint[] => {
  const bottoms = new Map<string, GlyphPoint>();

  points.forEach((point) => {
    const column = Math.round(point.x / COLUMN_WIDTH);

    if (Math.abs(point.x - column * COLUMN_WIDTH) > COLUMN_BAND) {
      return;
    }

    const key = `${toLineIndex(ruling, point)}:${column}`;
    const current = bottoms.get(key);

    if (!current || point.y > current.y) {
      bottoms.set(key, point);
    }
  });

  return [...bottoms.values()];
};

/**
 * Сводка по базовым точкам страницы.
 */
type BaselineSummary = {
  /**
   * Сколько линий разлиновки заняли точки.
   */
  lines: number;

  /**
   * Наименьшее число точек на линии.
   */
  points: number;

  /**
   * Наибольшее отклонение от линий фотографии в долях шага.
   */
  drift: number;
};

/**
 * Сводит базовые точки страницы к числам требования.
 *
 * @param ruling — разлиновка фотографии страницы
 * @param points — базовые точки
 * @returns сводка
 */
const summarize = (ruling: SheetRuling, points: GlyphPoint[]): BaselineSummary => {
  const perLine = new Map<number, number>();
  let drift = 0;

  points.forEach((point) => {
    const index = toLineIndex(ruling, point);

    perLine.set(index, (perLine.get(index) || 0) + 1);
    drift = Math.max(drift, measureLineDrift(ruling, point));
  });

  return { lines: perLine.size, points: Math.min(...perLine.values()), drift };
};

/**
 * Базовые точки страницы: у контуров — низ тела букв по столбцам, у букв
 * текстом — точка каждой буквы на базовой линии.
 *
 * @param ruling — разлиновка фотографии страницы
 * @param params — параметры отрисовки
 * @param glyphs — контуры шрифта; `null` — буквы рисуются текстом
 * @returns базовые точки в пикселях страницы
 */
const collectBaselines = (
  ruling: SheetRuling,
  params: PageRenderParams,
  glyphs: PageGlyphs | null
): GlyphPoint[] => {
  return glyphs
    ? measureGlyphBaselines(ruling, renderPoints(params))
    : renderLetterPoints(params);
};

/**
 * Номер верхней линии разлиновки, которую заняли базовые точки.
 *
 * @param ruling — разлиновка фотографии страницы
 * @param points — базовые точки
 * @returns номер линии на гребёнке
 */
const findFirstLine = (ruling: SheetRuling, points: GlyphPoint[]): number => {
  return Math.min(
    ...points.map((point) => {
      return toLineIndex(ruling, point);
    })
  );
};

/**
 * Поправка вниз — наибольшая, какую даёт слайдер: чем дальше строки уходят от
 * своего места, тем сильнее перспектива меняет шаг под ними.
 */
const CORRECTION_STEPS = 2;

/**
 * Насколько поправка может ухудшить попадание на линии, в долях шага. Сдвиг
 * мимо перспективы на две строки ошибается на `2·(∂Y/∂U − 1)` — у этого листа
 * до семи сотых шага.
 */
const CORRECTION_DRIFT_STEPS = 0.01;

const CASES: [string, number, PageGlyphs | null][] = [
  ['контуры шрифта, нечётная страница', 0, GLYPHS],
  ['контуры шрифта, зеркальная страница', 1, GLYPHS],
  ['буквы текстом, нечётная страница', 0, null],
  ['буквы текстом, зеркальная страница', 1, null],
];

describe('перспектива разлиновки на странице', () => {
  it.each(CASES)(
    'кладёт базовые линии на линии фотографии: %s',
    (_, pageIndex, glyphs) => {
      const { ruling } = getPageCalibration(FAMILY, SHEET, pageIndex);
      const params = buildParams(pageIndex, glyphs);
      const summary = summarize(ruling, collectBaselines(ruling, params, glyphs));

      expect(summary.lines).toBe(LINE_COUNT);
      expect(summary.points).toBeGreaterThanOrEqual(MIN_POINTS_PER_LINE);
      expect(summary.drift).toBeLessThanOrEqual(TOLERANCE_STEPS);

      /**
       * Контроль: те же строки по прямой гребёнке отходят от линий фотографии
       * дальше допуска — значит, попадание выше даёт именно перспектива.
       */
      const straight = collectBaselines(ruling, stripPerspective(params), glyphs);

      expect(summarize(ruling, straight).drift).toBeGreaterThan(TOLERANCE_STEPS);
    }
  );

  it.each(CASES)(
    'сдвигает строки поправкой вниз по линиям фотографии: %s',
    (_, pageIndex, glyphs) => {
      const { ruling } = getPageCalibration(FAMILY, SHEET, pageIndex);
      const plain = collectBaselines(ruling, buildParams(pageIndex, glyphs), glyphs);
      const shifted = collectBaselines(
        ruling,
        buildParams(pageIndex, glyphs, {
          ...DEFAULT_GEOMETRY_CORRECTION,
          topOffset: CORRECTION_STEPS,
        }),
        glyphs
      );
      const summary = summarize(ruling, shifted);

      expect(summary.lines).toBe(LINE_COUNT);
      expect(summary.points).toBeGreaterThanOrEqual(MIN_POINTS_PER_LINE);
      expect(summary.drift).toBeLessThanOrEqual(TOLERANCE_STEPS);
      expect(findFirstLine(ruling, shifted)).toBe(
        findFirstLine(ruling, plain) + CORRECTION_STEPS
      );

      /**
       * Поправка переводится в координату вдоль линий и проходит через
       * перспективу: строки уходят вниз на целые линии фотографии и лежат на
       * них так же точно, как без поправки. Сдвиг пикселями поверх перспективы
       * тоже прошёл бы допуск требования — у низа листа шаг под строками
       * больше на проценты, — но отошёл бы от линий на сотые доли шага.
       */
      expect(summary.drift).toBeLessThanOrEqual(
        summarize(ruling, plain).drift + CORRECTION_DRIFT_STEPS
      );
    }
  );

  it('не считает высоту линий на листе без перспективы и без изгиба', () => {
    const flat = buildPageRenderParams({
      page: PAGE,
      calibration: getPageCalibration(FAMILY, FLAT_SHEET, 0),
      sheetImage: null,
      metrics: FALLBACK_FONT_METRICS,
      correction: DEFAULT_GEOMETRY_CORRECTION,
      inkColor: '#101010',
      fontFamily: 'Synthetic',
      flags: NO_DISTORTION_FLAGS,
      wordFrequency: 1,
      letterFrequency: 1,
      seed: 42,
      ink: { lighting: null, texture: null, seed: 7 },
      glyphs: GLYPHS,
      scale: SCALE,
    });
    const heightSpy = vi.mocked(lineHeightAt);

    heightSpy.mockClear();
    renderPageToCanvas(createPathRecorder().context, flat);

    expect(heightSpy).not.toHaveBeenCalled();

    renderPageToCanvas(createPathRecorder().context, buildParams(0, GLYPHS));

    expect(heightSpy).toHaveBeenCalled();
  });
});
