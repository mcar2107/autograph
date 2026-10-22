import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type {
  GlyphOutline,
  GlyphPathCommand,
  GlyphPoint,
  GlyphSource,
} from '@pages/Generator/lib/glyph/glyph.types';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { Page } from '@pages/Generator/lib/paginate/paginate.types';
import type {
  PaperFamily,
  PaperSheet,
  RulingBend,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import type * as SampleRulingBendModule from '@pages/Generator/lib/paper/sampleRulingBend';
import { sampleRulingBend } from '@pages/Generator/lib/paper/sampleRulingBend';
import type { PageRenderParams } from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import { buildPageRenderParams } from '@pages/Generator/model/buildPageRenderParams';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import { describe, expect, it, vi } from 'vitest';

import { NO_DISTORTION_FLAGS } from './helpers/distortion-flags';
import { createPathRecorder } from './helpers/path-recorder';

vi.mock('@pages/Generator/lib/paper/sampleRulingBend', async (importOriginal) => {
  const actual = await importOriginal<typeof SampleRulingBendModule>();

  return { ...actual, sampleRulingBend: vi.fn(actual.sampleRulingBend) };
});

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Лист-модель: кадр в меру пресета, наклон не нулевой, чтобы выборка изгиба
 * получала угол блока, а не ноль.
 */
const RULING_STEP = 40;
const SHEET_WIDTH = 1600;
const SHEET_HEIGHT = 1200;
const SKEW_ANGLE = 0.8;
const FIRST_LINE_PHASE = 60;
const SHEET_MARGIN = 100;

/**
 * Верхнее поле — линия над первой строкой: строка встаёт на линию 100.
 */
const SHEET_TOP_MARGIN = SHEET_MARGIN - RULING_STEP;

/**
 * Допуск попадания низа букв на линию — десятая доля шага, как в требовании.
 */
const TOLERANCE_STEPS = 0.1;

/**
 * Изгиб в блоке обязан быть заметно больше допуска: иначе и прямая строка
 * уложилась бы в него, и тест ничего бы не доказал.
 */
const MIN_BEND_STEPS = 0.3;

/**
 * Амплитуда волны изгиба — 0,4 шага: больше порога, но меньше половины шага,
 * чтобы ближайшая к букве линия оставалась своей.
 */
const BEND_AMPLITUDE = RULING_STEP * 0.4;
const BEND_COLUMN_COUNT = 9;

/**
 * Разрешение отрисовки не единичное: изгиб обязан выбираться в пикселях
 * страницы, а не в пикселях канвы.
 */
const SCALE = 2;

/**
 * Узлы строки изгиба — период синусоиды во всю область узлов: линия и
 * поднимается, и опускается на ширине блока. Смещения кратны сотой, как у
 * настоящей сетки.
 *
 * @param share — доля амплитуды
 * @returns смещения узлов строки
 */
const buildBendRow = (share: number): number[] => {
  return Array.from({ length: BEND_COLUMN_COUNT }, (_, index) => {
    const phase = (2 * Math.PI * index) / (BEND_COLUMN_COUNT - 1);

    return Math.round(BEND_AMPLITUDE * share * Math.sin(phase) * 100) / 100;
  });
};

/**
 * Вторая строка узлов слабее первой: смешивание строк по координате вдоль
 * линий участвует в выборке.
 */
const BEND: RulingBend = {
  columnOrigin: SHEET_MARGIN,
  columnSpacing: 175,
  columnCount: BEND_COLUMN_COUNT,
  rowOrigin: FIRST_LINE_PHASE,
  rowSpacing: 1000,
  rowCount: 2,
  offsets: [...buildBendRow(1), ...buildBendRow(0.6)],
};

/**
 * Строки узлов изгиба лежат в координате вдоль линий наклонной разлиновки;
 * перспективы у листа теста нет.
 */
const BEND_PROJECTION = { skewAngle: SKEW_ANGLE, perspective: null };

const BENT_SHEET: PaperSheet = {
  id: 'bent',
  label: 'Изогнутый лист',
  src: '/paper/bent.jpg',
  width: SHEET_WIDTH,
  height: SHEET_HEIGHT,
  ruling: {
    step: RULING_STEP,
    firstLinePhase: FIRST_LINE_PHASE,
    skewAngle: SKEW_ANGLE,
    margins: {
      top: SHEET_TOP_MARGIN,
      right: SHEET_MARGIN,
      bottom: SHEET_MARGIN,
      left: SHEET_MARGIN,
    },
    marginLineX: null,
    marginLineSide: null,
    sideSlant: null,
    bend: BEND,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  lighting: null,
  texture: null,
};

/**
 * Тот же лист без изгиба: геометрия блока у него та же, отличается только
 * изгиб в параметрах отрисовки.
 */
const FLAT_SHEET: PaperSheet = {
  ...BENT_SHEET,
  id: 'flat',
  ruling: { ...BENT_SHEET.ruling, bend: null },
};

const FAMILY: PaperFamily = {
  id: 'lined',
  label: 'В линейку',
  kind: 'lined',
  sheets: [BENT_SHEET, FLAT_SHEET],
};

/**
 * Синтетическая буква: низ тела лежит ровно на базовой линии по всей ширине,
 * поэтому «низ тела в столбце» считается без поправок на рисунок шрифта.
 */
const UNITS_PER_EM = 1000;
const LETTER_ADVANCE = 500;
const LETTER_HEIGHT = 450;
const BOTTOM_LINE_SEGMENTS = 8;
const BOTTOM_CURVE_SEGMENTS = 4;

/**
 * Контур буквы: левая половина низа — отрезки, правая — кубические кривые с
 * контрольными точками на базовой линии, верх — квадратичная кривая. Так
 * сдвиг проверяется на всех видах команд пути.
 *
 * @returns команды контура в единицах шрифта
 */
const buildLetterCommands = (): GlyphPathCommand[] => {
  const half = LETTER_ADVANCE / 2;
  const lineLength = half / BOTTOM_LINE_SEGMENTS;
  const curveLength = half / BOTTOM_CURVE_SEGMENTS;
  const commands: GlyphPathCommand[] = [{ type: 'M', x: 0, y: 0 }];

  for (let index = 1; index <= BOTTOM_LINE_SEGMENTS; index += 1) {
    commands.push({ type: 'L', x: index * lineLength, y: 0 });
  }

  for (let index = 0; index < BOTTOM_CURVE_SEGMENTS; index += 1) {
    const start = half + index * curveLength;

    commands.push({
      type: 'C',
      x1: start + curveLength / 3,
      y1: 0,
      x2: start + (2 * curveLength) / 3,
      y2: 0,
      x: start + curveLength,
      y: 0,
    });
  }

  commands.push(
    { type: 'L', x: LETTER_ADVANCE, y: LETTER_HEIGHT },
    { type: 'Q', x1: half, y1: LETTER_HEIGHT * 1.2, x: 0, y: LETTER_HEIGHT },
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

/**
 * Длинное слово тянется через подъём и спуск линии; строка из слов проверяет
 * пробелы и начало каждого слова.
 */
const LONG_WORD = 'м'.repeat(40);
const WORDS_LINE = 'мммм ммммммм мм мммммм ммммм ммммммммм';

/**
 * Столбцы, по которым ищется низ тела букв: ширина столбца и полуширина
 * полосы, в которую должна попасть точка контура.
 */
const COLUMN_WIDTH = 6;
const COLUMN_BAND = 2;

/**
 * Столбцов на строке заведомо больше: если их мало, контуры не дошли до
 * записи, и проверка попадания прошла бы на пустом месте.
 */
const MIN_COLUMNS = 100;

/**
 * Неровность почерка поверх изгиба: поворот и сдвиг строки, поворот, скос и
 * сдвиг слова.
 */
const LINE_DISTORTION = { rotate: 1.5, translateX: 6 };
const WORD_DISTORTION = { rotate: -2, skew: 8, translateY: 2, letters: [] };

/**
 * Параметры отрисовки первой страницы листа с одной строкой — через тот же
 * адаптер, которым их собирает приложение.
 *
 * @param sheet — лист страницы
 * @param text — текст строки
 * @returns параметры отрисовки
 */
const buildParams = (sheet: PaperSheet, text: string): PageRenderParams => {
  const page: Page = { lines: [{ text, paragraphIndex: 0 }] };

  return buildPageRenderParams({
    page,
    calibration: getPageCalibration(FAMILY, sheet, 0),
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
    glyphs: { source: GLYPH_SOURCE, hasVariance: false },
    scale: SCALE,
  });
};

/**
 * Накладывает на страницу неровность почерка.
 *
 * @param params — параметры отрисовки
 * @returns те же параметры с искажёнными строками и словами
 */
const distortPage = (params: PageRenderParams): PageRenderParams => {
  return {
    ...params,
    page: {
      lines: params.page.lines.map(({ words }) => {
        return {
          distortion: LINE_DISTORTION,
          words: words.map((word) => {
            return { ...word, distortion: WORD_DISTORTION };
          }),
        };
      }),
    },
  };
};

/**
 * Отрисовывает страницу и отдаёт точки залитых контуров в пикселях страницы —
 * без масштаба отрисовки.
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
 * Самая нижняя точка контуров в каждом столбце строки — низ тела букв.
 *
 * @param points — точки контуров одной строки
 * @returns нижние точки столбцов слева направо
 */
const measureColumnBottoms = (points: GlyphPoint[]): GlyphPoint[] => {
  const bottoms = new Map<number, GlyphPoint>();

  points.forEach((point) => {
    const column = Math.round(point.x / COLUMN_WIDTH);
    const current = bottoms.get(column);

    if (Math.abs(point.x - column * COLUMN_WIDTH) > COLUMN_BAND) {
      return;
    }

    if (!current || point.y > current.y) {
      bottoms.set(column, point);
    }
  });

  return [...bottoms.entries()]
    .sort(([left], [right]) => {
      return left - right;
    })
    .map(([, point]) => {
      return point;
    });
};

/**
 * Насколько точка отходит от ближайшей линии фотографии листа с изгибом, в
 * долях шага. Линия — прямая наклонная гребёнка плюс изгиб в её точке.
 *
 * @param ruling — разлиновка фотографии
 * @param point — точка страницы
 * @returns отклонение в долях шага
 */
const measureLineDrift = (ruling: SheetRuling, { x, y }: GlyphPoint): number => {
  const { step, firstLinePhase, skewAngle, bend } = ruling;
  const tangent = Math.tan(skewAngle / DEGREES_IN_RADIAN);
  const lineIndex = Math.round((y - firstLinePhase - x * tangent) / step);
  const straightY = firstLinePhase + lineIndex * step + x * tangent;
  const lineY = straightY + (bend ? sampleRulingBend(bend, ruling, x, straightY) : 0);

  return Math.abs(y - lineY) / step;
};

/**
 * Наибольшее отклонение низа букв строки от линий фотографии изогнутого листа.
 *
 * @param bottoms — нижние точки столбцов
 * @returns отклонение в долях шага
 */
const measureMaxDrift = (bottoms: GlyphPoint[]): number => {
  return Math.max(
    ...bottoms.map((point) => {
      return measureLineDrift(BENT_SHEET.ruling, point);
    })
  );
};

describe('изгиб контуров на странице', () => {
  it.each([
    ['длинное слово', LONG_WORD],
    ['строка из слов', WORDS_LINE],
  ])('кладёт низ букв на изогнутую линию в каждом столбце: %s', (_, text) => {
    const bent = measureColumnBottoms(renderPoints(buildParams(BENT_SHEET, text)));
    const flat = measureColumnBottoms(renderPoints(buildParams(FLAT_SHEET, text)));
    const bendSteps = bent.map(({ x, y }) => {
      return Math.abs(sampleRulingBend(BEND, BEND_PROJECTION, x, y)) / RULING_STEP;
    });

    expect(bent.length).toBeGreaterThan(MIN_COLUMNS);
    expect(Math.max(...bendSteps)).toBeGreaterThanOrEqual(MIN_BEND_STEPS);
    expect(measureMaxDrift(bent)).toBeLessThanOrEqual(TOLERANCE_STEPS);

    /**
     * Контроль: без изгиба в параметрах те же буквы лежат на прямой гребёнке и
     * от линий фотографии отходят дальше допуска.
     */
    expect(measureMaxDrift(flat)).toBeGreaterThan(TOLERANCE_STEPS);
  });

  it('гнёт строку с неровностью почерка поверх изгиба', () => {
    const bent = renderPoints(distortPage(buildParams(BENT_SHEET, WORDS_LINE)));
    const flat = renderPoints(distortPage(buildParams(FLAT_SHEET, WORDS_LINE)));

    expect(bent.length).toBe(flat.length);
    expect(bent.length).toBeGreaterThan(MIN_COLUMNS);

    /**
     * Каждая точка контура сдвигается строго по вертикали страницы на изгиб в
     * своей точке: поворот и скос уже вошли в преобразование, и сдвиг,
     * посчитанный в системе буквы без обратной линейной части, увёл бы точки
     * и вбок.
     */
    const drift = bent.reduce(
      (acc, point, index) => {
        const straight = flat[index] || point;
        const bend = sampleRulingBend(BEND, BEND_PROJECTION, straight.x, straight.y);

        return {
          horizontal: Math.max(acc.horizontal, Math.abs(point.x - straight.x)),
          vertical: Math.max(
            acc.vertical,
            Math.abs(point.y - straight.y - bend) / RULING_STEP
          ),
        };
      },
      { horizontal: 0, vertical: 0 }
    );

    expect(drift.horizontal).toBeLessThan(1e-6);
    expect(drift.vertical).toBeLessThanOrEqual(TOLERANCE_STEPS);
    expect(measureMaxDrift(measureColumnBottoms(flat))).toBeGreaterThan(TOLERANCE_STEPS);
  });

  it('обращается к изгибу только на изогнутом листе и с углом блока', () => {
    const sampleSpy = vi.mocked(sampleRulingBend);
    const flat = buildParams(FLAT_SHEET, WORDS_LINE);
    const bent = buildParams(BENT_SHEET, WORDS_LINE);

    sampleSpy.mockClear();
    renderPageToCanvas(createPathRecorder().context, flat);

    expect(sampleSpy).not.toHaveBeenCalled();

    renderPageToCanvas(createPathRecorder().context, bent);

    expect(sampleSpy).toHaveBeenCalledWith(
      BEND,
      BEND_PROJECTION,
      expect.any(Number),
      expect.any(Number)
    );
  });
});
