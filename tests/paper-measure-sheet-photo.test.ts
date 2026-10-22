import {
  buildSheetRuling,
  detectRuling,
  extractLighting,
  extractTexture,
  lineCoordinateAt,
  lineHeightAt,
  type MarginLineSide,
  measureSheetPhoto,
  type PaperMargins,
  resolveSheetBounds,
  type RulingBend,
  sampleRulingBend,
  type SheetImageData,
  type SheetOutline,
  type SheetPhotoMeasurement,
  type SheetRuling,
  type SheetRulingSource,
} from '@pages/Generator/lib/paper';
import type * as DetectRulingModule from '@pages/Generator/lib/paper/detectRuling';
import type {
  DetectedRuling,
  RulingDetectionOptions,
} from '@pages/Generator/lib/paper/detectRuling';
import type * as PerspectiveModule from '@pages/Generator/lib/paper/detectRulingPerspective';
import { detectRulingPerspective } from '@pages/Generator/lib/paper/detectRulingPerspective';
import type * as RectifyModule from '@pages/Generator/lib/paper/measureSheetPhotoRectify';
import { rectifySheetImage } from '@pages/Generator/lib/paper/measureSheetPhotoRectify';
import { liftDetectedTopMargin } from '@pages/Generator/lib/paper/sheetRuling';
import { describe, expect, it, vi } from 'vitest';

import { readFirstTextLineY } from './helpers/first-text-line';
import {
  computeSyntheticLineY,
  computeSyntheticOutline,
  createSyntheticSheet,
  type SyntheticField,
  type SyntheticSheetParams,
} from './helpers/synthetic-sheet';

vi.mock('@pages/Generator/lib/paper/measureSheetPhotoRectify', async (importOriginal) => {
  const actual = await importOriginal<typeof RectifyModule>();

  return { ...actual, rectifySheetImage: vi.fn(actual.rectifySheetImage) };
});

vi.mock('@pages/Generator/lib/paper/detectRuling', async (importOriginal) => {
  const actual = await importOriginal<typeof DetectRulingModule>();

  return { ...actual, detectRuling: vi.fn(actual.detectRuling) };
});

vi.mock('@pages/Generator/lib/paper/detectRulingPerspective', async (importOriginal) => {
  const actual = await importOriginal<typeof PerspectiveModule>();

  return {
    ...actual,
    detectRulingPerspective: vi.fn(actual.detectRulingPerspective),
  };
});

const WIDTH = 900;

const HEIGHT = 1200;

const FRAME = { width: WIDTH, height: HEIGHT };

/**
 * Поля замера в той форме, в какой их отдаёт детектор по вырезке: верхнее —
 * линия первой строки, а не поле над ней.
 *
 * @param source — разлиновка замера
 * @param fallback — поля, если замер их не отдал
 * @returns поля с верхним на линии первой строки
 */
const toTextMargins = (
  source: SheetRulingSource,
  fallback: PaperMargins
): PaperMargins => {
  return source.margins
    ? { ...source.margins, top: readFirstTextLineY(source, FRAME) }
    : fallback;
};

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Лист на столе: стороны чуть наклонены к краям кадра, углы скруглены.
 */
const TABLE_OUTLINE: SheetOutline = {
  topLeft: { x: 130, y: 120 },
  topRight: { x: 790, y: 110 },
  bottomRight: { x: 800, y: 1110 },
  bottomLeft: { x: 140, y: 1120 },
};

/**
 * Стол темнее бумаги и с крупным зерном: по всему кадру его ступени и шум
 * сбивают измерение. Шаг полосовая ступень детектора там ещё находит, а вид
 * разлиновки и боковые поля уже уезжают — мерить лист можно только по вырезке
 * внутри контура.
 */
const TABLE_SURFACE = {
  outline: TABLE_OUTLINE,
  cornerRadius: 20,
  brightness: 0.3,
  grain: 0.3,
};

const GRID_STEP = 30;

/**
 * Клетка внутри листа на столе, со всех сторон — поля.
 */
const GRID_SHEET: SyntheticSheetParams = {
  width: WIDTH,
  height: HEIGHT,
  step: GRID_STEP,
  phase: 7,
  angle: 1,
  kind: 'grid',
  margins: { top: 200, right: 160, bottom: 180, left: 170 },
  lineWidth: 2,
  lineDarkness: 0.3,
  noise: 0.04,
  lighting: 0.2,
  seed: 5,
  surface: TABLE_SURFACE,
};

/**
 * Середина кадра по ширине в долях от −1 до 1.
 *
 * @param x — столбец кадра
 * @returns доля
 */
const toWidthShare = (x: number): number => {
  return (2 * x) / WIDTH - 1;
};

/**
 * Прогиб по ширине: середина линии ниже концов на заданную долю шага.
 *
 * @param depth — глубина прогиба в пикселях
 * @returns поле сдвига линий
 */
const toSag = (depth: number): SyntheticField => {
  return (x) => {
    return depth * (1 - toWidthShare(x) ** 2);
  };
};

/**
 * Прогиб, меняющий знак по высоте листа: у верхних линий середина выше концов,
 * у нижних — ниже. Ширина прогиба — ширина области с линиями, иначе его почти
 * целиком забрала бы ровная гребёнка.
 */
const TWISTED_SAG: SyntheticField = (x, y) => {
  return 0.3 * GRID_STEP * (1 - ((x - 455) / 255) ** 2) * ((2 * y) / HEIGHT - 1);
};

/**
 * Изогнутая клетка на листе, верх которого далеко от верха кадра. Строки узлов
 * изгиба лежат по координате вдоль линий, и сетка, не сдвинутая вместе с
 * вырезкой, взяла бы смещения строк на десяток шагов выше — на таком прогибе
 * это больше двадцатой шага.
 */
const BENT_GRID_SHEET: SyntheticSheetParams = {
  ...GRID_SHEET,
  margins: { top: 440, right: 160, bottom: 180, left: 170 },
  surface: {
    ...TABLE_SURFACE,
    outline: {
      topLeft: { x: 130, y: 330 },
      topRight: { x: 790, y: 320 },
      bottomRight: { x: 800, y: 1110 },
      bottomLeft: { x: 140, y: 1120 },
    },
  },
  bend: TWISTED_SAG,
};

/**
 * Клетка доходит до левой стороны листа: левое поле не находится, и отступ с
 * этой стороны берётся фолбэком от стороны листа.
 */
const EDGE_GRID_SHEET: SyntheticSheetParams = {
  ...GRID_SHEET,
  margins: { top: 200, right: 160, bottom: 180, left: 0 },
};

/**
 * Та же клетка без поверхности: фотография обрезана по краям листа.
 */
const CROPPED_GRID_SHEET: SyntheticSheetParams = {
  ...GRID_SHEET,
  surface: null,
};

const BLANK_TABLE_SHEET: SyntheticSheetParams = {
  ...GRID_SHEET,
  kind: 'blank',
};

/**
 * Вырезка кадра со своим местом в нём.
 */
type TestCrop = {
  /**
   * Полутоновая выжимка вырезки.
   */
  image: SheetImageData;

  /**
   * Отступ вырезки от левого края кадра.
   */
  left: number;

  /**
   * Отступ вырезки от верхнего края кадра.
   */
  top: number;
};

/**
 * Вырезает прямоугольник, вписанный в контур, целыми пикселями внутрь.
 *
 * @param image — кадр
 * @param outline — контур листа
 * @returns вырезка
 */
const cutSheet = (image: SheetImageData, outline: SheetOutline | null): TestCrop => {
  const bounds = resolveSheetBounds(outline, image.width, image.height);
  const left = Math.ceil(bounds.left);
  const top = Math.ceil(bounds.top);
  const width = Math.floor(image.width - bounds.right) - left;
  const height = Math.floor(image.height - bounds.bottom) - top;
  const luminance = new Float32Array(width * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      luminance[row * width + column] =
        image.luminance[(top + row) * image.width + left + column] || 0;
    }
  }

  return { image: { width, height, luminance }, left, top };
};

/**
 * Поля ровного прохода по вырезке, переведённые в кадр: по высоте поля — это
 * координаты вдоль линий у левого края, и сдвигаются они на `T − L·tgθ`, по
 * ширине — на отступ вырезки. Ненайденная сторона остаётся нулём.
 *
 * @param detection — проход по вырезке
 * @param crop — вырезка
 * @returns поля в пикселях кадра
 */
const toFrameMargins = (detection: DetectedRuling, crop: TestCrop): PaperMargins => {
  const { margins, skewAngle } = detection;
  const shift = crop.top - crop.left * Math.tan(skewAngle / DEGREES_IN_RADIAN);
  const cropRight = WIDTH - crop.left - crop.image.width;
  const cropBottom = HEIGHT - crop.top - crop.image.height;

  return {
    top: margins.top && margins.top + shift,
    right: margins.right && margins.right + cropRight,
    bottom: margins.bottom && margins.bottom + cropBottom + crop.top - shift,
    left: margins.left && margins.left + crop.left,
  };
};

/**
 * Вырезка вместе с проходом детектора по ней.
 */
type CropDetection = {
  /**
   * Вырезка кадра.
   */
  crop: TestCrop;

  /**
   * Проход детектора по вырезке.
   */
  detection: DetectedRuling;
};

/**
 * Прогон детектора по вырезке кадра, заданной контуром.
 *
 * @param params — описание листа
 * @param outline — контур вырезки
 * @param options — настройки детектора
 * @returns вырезка и проход по ней
 */
const detectInCrop = (
  params: SyntheticSheetParams,
  outline: SheetOutline | null,
  options?: RulingDetectionOptions
): CropDetection => {
  const crop = cutSheet(createSyntheticSheet(params), outline);

  return { crop, detection: detectRuling(crop.image, options) };
};

/**
 * Координата вдоль линий найденной линии, ближайшей к эталонной линии `index`.
 *
 * @param ruling — разлиновка листа
 * @param params — описание листа
 * @param index — номер эталонной линии
 * @returns координата найденной линии
 */
const toNearestLine = (
  ruling: SheetRuling,
  params: SyntheticSheetParams,
  index: number
): number => {
  const { step = 0, phase = 0 } = params;
  const reference = phase + index * step;

  return (
    ruling.firstLinePhase +
    Math.round((reference - ruling.firstLinePhase) / ruling.step) * ruling.step
  );
};

/**
 * Способ найти координату вдоль линий найденной линии, отвечающей эталонной.
 */
type NearestLineResolver = (
  ruling: SheetRuling,
  params: SyntheticSheetParams,
  index: number
) => number;

/**
 * Высота линии разлиновки в столбце: прямая гребёнка с перспективой плюс изгиб.
 *
 * @param ruling — разлиновка листа
 * @param x — столбец кадра
 * @param coordinate — координата линии вдоль линий
 * @returns строка линии
 */
const restoreLineY = (ruling: SheetRuling, x: number, coordinate: number): number => {
  const straight = lineHeightAt(ruling, x, coordinate);
  const bend: RulingBend | null = ruling.bend;

  return straight + (bend ? sampleRulingBend(bend, ruling, x, straight) : 0);
};

/**
 * Ближайшая линия по высоте в столбце `column`, а не по координате вдоль
 * линий: у листа, сдвинутого от середины кадра, начало перспективы детектора
 * (середина вырезки) и синтетики (середина кадра) расходятся, и
 * `phase + k·step` синтетики указывает на соседнюю найденную линию.
 *
 * @param column — столбец сверки
 * @returns способ найти линию
 */
const toNearestLineInColumn = (column: number): NearestLineResolver => {
  return (ruling, params, index) => {
    const reference = computeSyntheticLineY(params, index, column);
    const guess = Math.round(
      (lineCoordinateAt(ruling, column, reference) - ruling.firstLinePhase) / ruling.step
    );

    return [guess - 1, guess, guess + 1].reduce(
      (best, candidate) => {
        const coordinate = ruling.firstLinePhase + candidate * ruling.step;
        const distance = Math.abs(restoreLineY(ruling, column, coordinate) - reference);
        const bestDistance = Math.abs(restoreLineY(ruling, column, best) - reference);

        return distance < bestDistance ? coordinate : best;
      },
      ruling.firstLinePhase + guess * ruling.step
    );
  };
};

/**
 * Наибольшее расхождение линий, восстановленных по разлиновке с перспективой и
 * изгибом, с эталоном синтетики — в каждом столбце области с линиями, а не
 * только в узлах изгиба.
 *
 * @param ruling — разлиновка листа
 * @param params — описание листа
 * @param lines — номера эталонных линий
 * @param columns — столбцы проверки
 * @param toLine — способ найти линию, отвечающую эталонной
 * @returns расхождение в пикселях
 */
const measureRestoreError = (
  ruling: SheetRuling,
  params: SyntheticSheetParams,
  lines: number[],
  columns: number[],
  toLine: NearestLineResolver = toNearestLine
): number => {
  return lines.reduce((limit, line) => {
    const coordinate = toLine(ruling, params, line);

    return columns.reduce((columnLimit, x) => {
      const restored = restoreLineY(ruling, x, coordinate);

      return Math.max(
        columnLimit,
        Math.abs(restored - computeSyntheticLineY(params, line, x))
      );
    }, limit);
  }, 0);
};

/**
 * Номера линий, нарисованных между верхним и нижним полями листа.
 *
 * @param params — описание листа
 * @returns номера линий
 */
const toDrawnLines = (params: SyntheticSheetParams): number[] => {
  const {
    step = 0,
    phase = 0,
    height = 0,
    margins = { top: 0, right: 0, bottom: 0, left: 0 },
  } = params;
  const first = Math.ceil((margins.top - phase) / step);
  const last = Math.floor((height - margins.bottom - phase) / step);

  return Array.from({ length: last - first + 1 }, (_item, index) => {
    return first + index;
  });
};

/**
 * Столбцы области с линиями через каждые три пикселя: и в узлах изгиба, и между
 * ними, и у краёв области.
 *
 * @param left — левая граница области
 * @param right — правая граница области
 * @returns столбцы
 */
const toColumns = (left: number, right: number): number[] => {
  return Array.from({ length: Math.floor((right - left) / 3) + 1 }, (_item, index) => {
    return left + index * 3;
  });
};

/**
 * Измеряет синтетический лист как клетку.
 *
 * @param params — описание листа
 * @returns измерения
 */
const measure = (params: SyntheticSheetParams): SheetPhotoMeasurement => {
  return measureSheetPhoto(createSyntheticSheet(params), { kind: 'grid' });
};

describe('measureSheetPhoto: лист на столе', () => {
  it('по всему кадру числа уезжают от чисел вырезки — отрицательный контроль', () => {
    const frame = detectRuling(createSyntheticSheet(GRID_SHEET));
    const { crop, detection } = detectInCrop(
      GRID_SHEET,
      computeSyntheticOutline(GRID_SHEET)
    );
    const expected = toFrameMargins(detection, crop);

    /**
     * Шаг по кадру целиком находится — его берёт полосовая ступень детектора,
     * которой ступени и зерно стола не мешают. Вырезка нужна не ради шага:
     * столбцы стола не дают опознать клетку, а боковая граница области с
     * линиями садится на край стола, а не на край бумаги, и поле уезжает
     * больше чем на треть шага.
     */
    expect(frame.isDetected).toBe(true);
    expect(detection.kind).toBe('grid');
    expect(frame.kind).not.toBe(detection.kind);
    expect(Math.abs(frame.margins.left - expected.left)).toBeGreaterThan(GRID_STEP / 3);
  });

  it('шаг — как у прогона по вырезке, поля — переведённые поля вырезки', () => {
    const result = measure(GRID_SHEET);
    const { crop, detection } = detectInCrop(
      GRID_SHEET,
      computeSyntheticOutline(GRID_SHEET)
    );
    const expected = toFrameMargins(detection, crop);

    expect(detection.isDetected).toBe(true);
    expect(result.diagnostics.isRulingDetected).toBe(true);
    expect(Math.abs(result.source.step - detection.step)).toBeLessThanOrEqual(
      GRID_STEP / 100
    );
    expect(result.source.margins).toBeDefined();

    const margins = toTextMargins(result.source, expected);

    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
      expect(expected[side]).toBeGreaterThan(0);
      expect(Math.abs(margins[side] - expected[side])).toBeLessThanOrEqual(1);
    });
  });

  it('первая строка стоит на первой линии: без поправки фазы на отступ вырезки была бы ниже', () => {
    const firstTextLine = readFirstTextLineY(measure(GRID_SHEET).source, FRAME);
    const [firstLine = 0] = toDrawnLines(GRID_SHEET);

    expect(
      Math.abs(firstTextLine - computeSyntheticLineY(GRID_SHEET, firstLine, 0))
    ).toBeLessThanOrEqual(GRID_STEP / 20);
  });

  it('контур и изгиб в кадре: восстановленные линии не дальше двадцатой шага', () => {
    const result = measure(BENT_GRID_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const { margins = GRID_SHEET.margins } = BENT_GRID_SHEET;

    expect(result.outline).not.toBeNull();
    expect(ruling.bend).not.toBeNull();
    expect(
      measureRestoreError(
        ruling,
        BENT_GRID_SHEET,
        toDrawnLines(BENT_GRID_SHEET),
        toColumns(
          (margins?.left || 0) + GRID_STEP,
          WIDTH - (margins?.right || 0) - GRID_STEP
        )
      )
    ).toBeLessThanOrEqual(GRID_STEP / 20);
  });

  it('ненайденная сторона поля отступает полтора шага от стороны листа, а не кадра', () => {
    const result = measure(EDGE_GRID_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const reference = resolveSheetBounds(TABLE_OUTLINE, WIDTH, HEIGHT);

    expect(result.source.margins?.left).toBe(0);
    expect(
      Math.abs(ruling.margins.left - (reference.left + 1.5 * ruling.step))
    ).toBeLessThanOrEqual(2);
  });

  it('неудача разлиновки отдаёт контур, свет и текстуру, а разлиновку — ненайденной', () => {
    const image = createSyntheticSheet(BLANK_TABLE_SHEET);
    const result = measureSheetPhoto(image, { kind: 'grid' });
    const lighting = extractLighting(image, { outline: result.outline });

    expect(result.source.step).toBe(0);
    expect(result.diagnostics.isRulingDetected).toBe(false);
    expect(result.outline).not.toBeNull();
    expect(result.source.outline).toEqual(result.outline);
    expect(result.lighting).toEqual(lighting);
    expect(result.textureMap).toEqual(
      extractTexture(image, lighting, { outline: result.outline })
    );
  });

  it('у чистого листа разлиновка не ищется', () => {
    const result = measureSheetPhoto(createSyntheticSheet(GRID_SHEET), { kind: 'blank' });

    expect(result.source.step).toBe(0);
    expect(result.diagnostics.confidence).toBe(0);
    expect(result.outline).not.toBeNull();
  });

  it('ручной контур не ищется заново', () => {
    const outline: SheetOutline = {
      topLeft: { x: 150, y: 140 },
      topRight: { x: 780, y: 140 },
      bottomRight: { x: 780, y: 1100 },
      bottomLeft: { x: 150, y: 1100 },
    };
    const result = measureSheetPhoto(createSyntheticSheet(GRID_SHEET), {
      kind: 'grid',
      outline,
    });

    expect(result.outline).toBe(outline);
    expect(result.source.outline).toBe(outline);
  });
});

describe('measureSheetPhoto: лист без поверхности', () => {
  it('результат совпадает с детектором по кадру и нынешним светом', () => {
    const image = createSyntheticSheet(CROPPED_GRID_SHEET);
    const result = measureSheetPhoto(image, { kind: 'grid' });
    const detection = detectRuling(image);
    const lighting = extractLighting(image);

    expect(result.outline).toBeNull();
    expect(result.source).toEqual(
      liftDetectedTopMargin({
        step: detection.step,
        firstLinePhase: detection.firstLinePhase,
        skewAngle: detection.skewAngle,
        margins: detection.margins,
        marginLineX: detection.marginLineX,
        marginLineSide: detection.marginLineSide,
        bend: detection.bend,
        perspective: null,
        outline: null,
      })
    );
    expect(result.lighting).toEqual(lighting);
    expect(result.textureMap).toEqual(extractTexture(image, lighting));
  });
});

const LINED_STEP = 24;

/**
 * Высота области с линиями у листа в линейку с перспективой.
 */
const LINED_TOP = 180;

const LINED_BOTTOM = 160;

const LINED_RULED_HEIGHT = HEIGHT - LINED_TOP - LINED_BOTTOM;

/**
 * Коэффициент изменения шага по высоте, при котором шаг между крайними линиями
 * области растёт на заданную долю: местный шаг меняется как `1/(1 − a·q)²`.
 *
 * @param drift — во сколько раз шаг у нижней линии больше, чем у верхней, минус 1
 * @param ruledHeight — высота области с линиями
 * @returns коэффициент `convergenceY` модели
 */
const toConvergenceY = (drift: number, ruledHeight = LINED_RULED_HEIGHT): number => {
  const ratio = Math.sqrt(1 + drift);

  return (2 * (ratio - 1)) / (ruledHeight * (ratio + 1));
};

/**
 * Дрейф шага 4 % и схождение линий на полградуса по высоте области.
 */
const DRIFT_4 = {
  convergenceX: 0.5 / DEGREES_IN_RADIAN / LINED_RULED_HEIGHT,
  convergenceY: toConvergenceY(0.04),
};

const LINED_DRIFT_SHEET: SyntheticSheetParams = {
  width: WIDTH,
  height: HEIGHT,
  step: LINED_STEP,
  phase: 5,
  angle: 1,
  kind: 'lined',
  margins: { top: LINED_TOP, right: 0, bottom: LINED_BOTTOM, left: 0 },
  lineWidth: 2,
  lineDarkness: 0.35,
  noise: 0.04,
  lighting: 0.2,
  seed: 11,
  surface: TABLE_SURFACE,
  rulingPerspective: DRIFT_4,
};

const BENT_LINED_DRIFT_SHEET: SyntheticSheetParams = {
  ...LINED_DRIFT_SHEET,
  bend: toSag(0.2 * LINED_STEP),
};

/**
 * Амплитуда прогиба у верхней границы области в долях шага. Больше полушага:
 * такую волну опрос у прямой гребёнки теряет целиком, и верхние линии остаются
 * только за трассой вдоль линий.
 */
const TOP_SAG_SHARE = 0.8;

/**
 * Затухание прогиба в шагах: ниже трёх шагов от верхней границы волна сходит на
 * нет, и область делится на волну у края и ровную часть.
 */
const TOP_SAG_DECAY_STEPS = 3;

/**
 * Прогиб у верхней границы области, одинаковый по всей ширине: у S-образной
 * волны прямая гребёнка удержала бы линию серединой, а здесь линия уходит с
 * гребёнки целиком — как у листа, чей верх отходит от стола.
 *
 * @param x — столбец кадра
 * @param y — строка кадра
 * @returns сдвиг линии вниз
 */
const TOP_SAG: SyntheticField = (_x, y) => {
  return (
    TOP_SAG_SHARE *
    LINED_STEP *
    Math.exp(-Math.max(0, y - LINED_TOP) / (TOP_SAG_DECAY_STEPS * LINED_STEP))
  );
};

const TOP_SAG_LINED_SHEET: SyntheticSheetParams = {
  ...LINED_DRIFT_SHEET,
  bend: TOP_SAG,
};

/**
 * Линии ровной части листа: те, где прогиб у верхней границы затух ниже сотой
 * шага. Перспектива описывает их и без волны, и по ним видно, подогнана ли она
 * по ядру.
 *
 * @param params — описание листа
 * @returns номера линий
 */
const toCalmLines = (params: SyntheticSheetParams): number[] => {
  return toDrawnLines(params).filter((line) => {
    return TOP_SAG(0, computeSyntheticLineY(params, line, 0)) < LINED_STEP / 100;
  });
};

const SHIFTED_TOP = 360;

const SHIFTED_BOTTOM = 40;

const SHIFTED_RULED_HEIGHT = HEIGHT - SHIFTED_TOP - SHIFTED_BOTTOM;

/**
 * Лист, сдвинутый вправо-вниз: середина вырезки далеко от середины кадра, и
 * перспектива, переведённая в кадр без отступа вырезки, уводит линии дальше
 * двадцатой шага. На листе по центру кадра такая ошибка не видна.
 */
const SHIFTED_OUTLINE: SheetOutline = {
  topLeft: { x: 250, y: 305 },
  topRight: { x: 880, y: 295 },
  bottomRight: { x: 890, y: 1180 },
  bottomLeft: { x: 260, y: 1190 },
};

/**
 * Схождение 2° и дрейф 6 % — с запасом внутри гарантий, чтобы ошибка перевода
 * перспективы была видна далеко за порогом, а не у него.
 */
const SHIFTED_BENT_LINED_SHEET: SyntheticSheetParams = {
  ...LINED_DRIFT_SHEET,
  margins: { top: SHIFTED_TOP, right: 0, bottom: SHIFTED_BOTTOM, left: 0 },
  surface: { ...TABLE_SURFACE, outline: SHIFTED_OUTLINE },
  rulingPerspective: {
    convergenceX: 2 / DEGREES_IN_RADIAN / SHIFTED_RULED_HEIGHT,
    convergenceY: toConvergenceY(0.06, SHIFTED_RULED_HEIGHT),
  },
  bend: toSag(0.3 * LINED_STEP),
};

const GRID_DRIFT_SHEET: SyntheticSheetParams = {
  ...GRID_SHEET,
  step: LINED_STEP,
  margins: { top: LINED_TOP, right: 170, bottom: LINED_BOTTOM, left: 180 },
  rulingPerspective: DRIFT_4,
};

describe('measureSheetPhoto: повторный импорт', () => {
  it('второе измерение той же фотографии повторяет первое до числа', () => {
    /**
     * Фотография одна на оба измерения: пользователь добавляет тот же файл
     * второй раз, а не пересоздаёт лист. Новый растр на каждый вызов прятал бы
     * разницу за совпадением синтезатора.
     */
    const image = createSyntheticSheet(LINED_DRIFT_SHEET);
    const first = measureSheetPhoto(image, { kind: 'grid' });
    const second = measureSheetPhoto(image, { kind: 'grid' });

    expect(second.source.step).toBe(first.source.step);
    /**
     * Сверяется всё измерение, а не один шаг: перспектива, изгиб, поля, свет и
     * текстура выводятся из того же прохода, и случайность в любом из них
     * даёт пользователю два разных листа из одного файла. Лист с дрейфом —
     * потому что полосовая ступень, засев и второй проход включаются именно на
     * нём.
     */
    expect(second).toStrictEqual(first);
  });
});

describe('measureSheetPhoto: перспектива', () => {
  it('линейка с дрейфом 4 % на столе: первая строка на первой линии, у ровного прохода — мимо', () => {
    const result = measure(LINED_DRIFT_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const [firstLine = 0] = toDrawnLines(LINED_DRIFT_SHEET);
    const firstLineY = computeSyntheticLineY(LINED_DRIFT_SHEET, firstLine, 0);
    const { crop, detection } = detectInCrop(LINED_DRIFT_SHEET, result.outline);

    expect(ruling.perspective).not.toBeNull();
    expect(
      Math.abs(readFirstTextLineY(result.source, FRAME) - firstLineY)
    ).toBeLessThanOrEqual(LINED_STEP / 10);
    /**
     * Ровная гребёнка на этом листе ставит первую линию выше настоящей: шаг у
     * верха мельче среднего. Знак зависит от того, успела ли гребёнка
     * соскочить на соседнюю линию, поэтому контроль — по модулю.
     */
    expect(Math.abs(toFrameMargins(detection, crop).top - firstLineY)).toBeGreaterThan(
      LINED_STEP / 10
    );
  });

  it('линейка с дрейфом и изгибом: линии не дальше двадцатой шага в любой точке области', () => {
    const result = measure(BENT_LINED_DRIFT_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const bounds = resolveSheetBounds(TABLE_OUTLINE, WIDTH, HEIGHT);

    expect(ruling.perspective).not.toBeNull();
    expect(ruling.bend).not.toBeNull();
    expect(
      measureRestoreError(
        ruling,
        BENT_LINED_DRIFT_SHEET,
        toDrawnLines(BENT_LINED_DRIFT_SHEET),
        toColumns(bounds.left + 2, WIDTH - bounds.right - 2)
      )
    ).toBeLessThanOrEqual(LINED_STEP / 20);
  });

  it('перспектива и изгиб на листе вдали от середины кадра: линии не дальше двадцатой шага', () => {
    const result = measure(SHIFTED_BENT_LINED_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const bounds = resolveSheetBounds(SHIFTED_OUTLINE, WIDTH, HEIGHT);
    const left = bounds.left + 2;
    const right = WIDTH - bounds.right - 2;

    expect(ruling.perspective).not.toBeNull();
    expect(ruling.bend).not.toBeNull();
    expect(
      measureRestoreError(
        ruling,
        SHIFTED_BENT_LINED_SHEET,
        toDrawnLines(SHIFTED_BENT_LINED_SHEET),
        toColumns(left, right),
        toNearestLineInColumn((left + right) / 2)
      )
    ).toBeLessThanOrEqual(LINED_STEP / 20);
  });

  it('прогиб у верха области: перспектива подогнана по ядру, на ровной части линии не дальше двадцатой шага', () => {
    const result = measure(TOP_SAG_LINED_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const bounds = resolveSheetBounds(TABLE_OUTLINE, WIDTH, HEIGHT);

    expect(ruling.perspective).not.toBeNull();
    expect(
      measureRestoreError(
        ruling,
        TOP_SAG_LINED_SHEET,
        toCalmLines(TOP_SAG_LINED_SHEET),
        toColumns(bounds.left + 2, WIDTH - bounds.right - 2)
      )
    ).toBeLessThanOrEqual(LINED_STEP / 20);
  });

  it('клетка с дрейфом 4 %: поля в пределах полушага от эталона', () => {
    const result = measure(GRID_DRIFT_SHEET);
    const ruling = buildSheetRuling(result.source, FRAME);
    const lines = toDrawnLines(GRID_DRIFT_SHEET);
    /**
     * Эталон боковых полей — тот же лист без перспективы: боковое поле
     * отсчитывается от конца линий с зазором, и в параметрах листа его нет.
     */
    const flat = buildSheetRuling(
      measure({ ...GRID_DRIFT_SHEET, rulingPerspective: null }).source,
      FRAME
    );

    expect(ruling.perspective).not.toBeNull();
    expect(flat.perspective).toBeNull();
    expect(
      Math.abs(
        readFirstTextLineY(result.source, FRAME) -
          computeSyntheticLineY(GRID_DRIFT_SHEET, lines[0] || 0, 0)
      )
    ).toBeLessThanOrEqual(LINED_STEP / 2);
    expect(
      Math.abs(
        HEIGHT -
          ruling.margins.bottom -
          computeSyntheticLineY(GRID_DRIFT_SHEET, lines.at(-1) || 0, 0)
      )
    ).toBeLessThanOrEqual(LINED_STEP / 2);
    expect(Math.abs(ruling.margins.left - flat.margins.left)).toBeLessThanOrEqual(
      LINED_STEP / 2
    );
    expect(Math.abs(ruling.margins.right - flat.margins.right)).toBeLessThanOrEqual(
      LINED_STEP / 2
    );
  });

  it('второй проход не нашёл разлиновку: результат — ровный проход без перспективы', async () => {
    const actual = await vi.importActual<typeof RectifyModule>(
      '@pages/Generator/lib/paper/measureSheetPhotoRectify'
    );

    vi.mocked(rectifySheetImage).mockImplementationOnce((image, projection) => {
      const rectified = actual.rectifySheetImage(image, projection);

      return {
        ...rectified,
        image: {
          ...rectified.image,
          luminance: new Float32Array(rectified.image.luminance.length).fill(0.9),
        },
      };
    });

    const result = measure(LINED_DRIFT_SHEET);
    const { crop, detection } = detectInCrop(LINED_DRIFT_SHEET, result.outline);
    const phaseShift =
      crop.top - crop.left * Math.tan(detection.skewAngle / DEGREES_IN_RADIAN);

    expect(vi.mocked(rectifySheetImage)).toHaveBeenCalled();
    expect(result.diagnostics.perspective?.isRectifiedRulingMissing).toBe(true);
    expect(result.source.perspective).toBeNull();
    expect(result.source.step).toBe(detection.step);
    expect(result.source.skewAngle).toBe(detection.skewAngle);
    expect(result.source.firstLinePhase).toBeCloseTo(
      (detection.firstLinePhase + phaseShift + detection.step) % detection.step,
      9
    );

    const expected = toFrameMargins(detection, crop);
    const margins = toTextMargins(result.source, expected);

    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
      expect(margins[side]).toBeCloseTo(expected[side], 9);
    });
  });
});

/**
 * Засев схождения, который полосовая ступень отдаёт вместе с шагом: прирост
 * шага на пиксель у своего начала отсчёта. У дрейфа листа он равен `2·q`:
 * местный шаг модели растёт как `1/(1 − a·q)²`, и у начала отсчёта его
 * производная вдвое больше `q`.
 */
const BANDED_SEED = 2 * DRIFT_4.convergenceY;

/**
 * Шаги полос, которыми подменяется полосовая ступень. Подмена нужна потому,
 * что на синтетическом листе профиль по всему кадру берёт порог уверенности с
 * запасом и до полос дело не доходит ни при каком дрейфе: полосы зовёт только
 * снимок настоящей тетради.
 */
const BANDED_STEPS = [23, 24, 25.3];

const BANDED_DRIFT = 25.3 / 23 - 1;

/**
 * Начало отсчёта засева, которое подмена отдала детектору.
 */
type BandedSeedOrigin = {
  /**
   * Середина вырезки в её пикселях.
   */
  origin: number;
};

/**
 * Подменяет первый проход детектора его же числами, к которым добавлены шаги
 * полос и засев схождения от середины вырезки, — ровно то, что детектор отдаёт
 * листу, шаг которого нашли полосы.
 *
 * @returns начало отсчёта засева в пикселях вырезки, как его увидит замер
 */
const mockBandedPass = async (): Promise<BandedSeedOrigin> => {
  const actual = await vi.importActual<typeof DetectRulingModule>(
    '@pages/Generator/lib/paper/detectRuling'
  );
  const seen = { origin: 0 };

  vi.mocked(detectRuling).mockImplementationOnce((image, options) => {
    seen.origin = image.height / 2;

    return {
      ...actual.detectRuling(image, options),
      bandedStage: 'measured',
      bandSteps: BANDED_STEPS,
      convergenceSeed: BANDED_SEED,
      convergenceOrigin: seen.origin,
    };
  });

  return seen;
};

/**
 * Подменяет первый проход детектора его же числами, у которых полосовая
 * ступень отмечена отказавшей: шаг ей пришлось искать, и она его не дала.
 */
const mockRejectedBandedPass = async (): Promise<void> => {
  const actual = await vi.importActual<typeof DetectRulingModule>(
    '@pages/Generator/lib/paper/detectRuling'
  );

  vi.mocked(detectRuling).mockImplementationOnce((image, options) => {
    return { ...actual.detectRuling(image, options), bandedStage: 'rejected' };
  });
};

/**
 * Подменяет проход по выпрямленной копии проходом, шаг которого нашла
 * полосовая ступень: первый проход идёт настоящим, у второго к его же числам
 * добавляются шаги полос. На синтетическом листе профиль по кадру берёт порог
 * с запасом, и до полос дело не доходит ни при каком дрейфе.
 */
const mockRectifiedBandedPass = async (): Promise<void> => {
  const actual = await vi.importActual<typeof DetectRulingModule>(
    '@pages/Generator/lib/paper/detectRuling'
  );

  vi.mocked(detectRuling)
    .mockImplementationOnce(actual.detectRuling)
    .mockImplementationOnce((image, options) => {
      return {
        ...actual.detectRuling(image, options),
        bandedStage: 'measured',
        bandSteps: BANDED_STEPS,
      };
    });
};

describe('measureSheetPhoto: полосовой шаг выпрямленной копии', () => {
  /**
   * Пару фазы и наклона держит сам детектор: заданный наклон он отдаёт наружу
   * тем же числом, которым мерил шаг и фазу, а копия выпрямлена только от
   * схождения и скос в ней сохранён. Отказ от прохода, шаг которого нашли
   * полосы, стоил бы на живых снимках медианы промаха базовых линий
   * 0,135…0,215 шага против 0,005…0,040.
   */
  it('шаг копии нашли полосы: числа второго прохода взяты', async () => {
    await mockRectifiedBandedPass();

    const result = measure(LINED_DRIFT_SHEET);

    expect(result.diagnostics.perspective?.isRectifiedRulingMissing).toBe(false);
    expect(result.source.perspective).not.toBeNull();
  });
});

describe('measureSheetPhoto: полосовая ступень', () => {
  it('шаг взял профиль по кадру: ступень не понадобилась', () => {
    expect(measure(LINED_DRIFT_SHEET).diagnostics.banded).toStrictEqual({
      stage: 'skipped',
      steps: [],
      drift: 0,
    });
    expect(measure(GRID_SHEET).diagnostics.banded?.stage).toBe('skipped');
  });

  /**
   * Отказ ступени доезжает до диагностики своим состоянием: шаги у него и у
   * незапущенной ступени одинаково пусты, а отчёт замера печатает разное.
   */
  it('полосы посчитались и шага не дали: отказ виден в диагностике', async () => {
    await mockRejectedBandedPass();

    expect(measure(LINED_DRIFT_SHEET).diagnostics.banded).toStrictEqual({
      stage: 'rejected',
      steps: [],
      drift: 0,
    });
  });

  it('шаг нашли полосы: их шаги и дрейф уходят в диагностику', async () => {
    await mockBandedPass();

    const { banded } = measure(LINED_DRIFT_SHEET).diagnostics;

    expect(banded?.stage).toBe('measured');
    expect(banded?.steps).toStrictEqual(BANDED_STEPS);
    expect(banded?.drift).toBeCloseTo(BANDED_DRIFT, 12);
  });

  it('засев схождения доезжает до поиска перспективы вместе со своим началом', async () => {
    const seen = await mockBandedPass();

    vi.mocked(detectRulingPerspective).mockClear();

    const result = measure(LINED_DRIFT_SHEET);
    const [call] = vi.mocked(detectRulingPerspective).mock.calls;

    expect(call?.[1].convergenceSeed).toBe(BANDED_SEED);
    expect(call?.[1].convergenceOrigin).toBe(seen.origin);
    expect(result.source.perspective).not.toBeNull();
  });
});

/**
 * Линия поля, которую подмена отдаёт проходу детектора.
 */
type MockedMarginLine = {
  /**
   * Отступ линии поля в пикселях вырезки. `null` — линии нет.
   */
  marginLineX: number | null;

  /**
   * Сторона линии поля. `null` — линии нет.
   */
  marginLineSide: MarginLineSide | null;
};

/**
 * Линия поля ровного прохода: левая, как на тетради с цветным полем.
 */
const FLAT_MARGIN_LINE: MockedMarginLine = { marginLineX: 120, marginLineSide: 'left' };

/**
 * Та же линия, чуть сдвинутая проходом по выпрямленной копии.
 */
const RECTIFIED_MARGIN_LINE: MockedMarginLine = {
  marginLineX: 128,
  marginLineSide: 'left',
};

/**
 * Линии поля нет.
 */
const NO_MARGIN_LINE: MockedMarginLine = { marginLineX: null, marginLineSide: null };

/**
 * Подменяет линию поля в обоих проходах — ровном и по выпрямленной копии — и
 * записывает настройки, с которыми позвали каждый. Остальные числа проходов
 * настоящие.
 *
 * @param flat — линия поля ровного прохода
 * @param rectified — линия поля прохода по выпрямленной копии
 * @returns настройки проходов в порядке вызова
 */
const mockMarginLinePasses = async (
  flat: MockedMarginLine,
  rectified: MockedMarginLine
): Promise<(RulingDetectionOptions | undefined)[]> => {
  const actual = await vi.importActual<typeof DetectRulingModule>(
    '@pages/Generator/lib/paper/detectRuling'
  );
  const seen: (RulingDetectionOptions | undefined)[] = [];

  /**
   * Подмена слушается ограничения по стороне так же, как настоящий детектор:
   * иначе тест доказывал бы только то, что фантом снимается с результата, а
   * снимать его нужно до области изгиба.
   */
  const toFoundLine = (
    line: MockedMarginLine,
    options?: RulingDetectionOptions
  ): MockedMarginLine => {
    const side = options?.marginLineSide;

    if (side === undefined || side === line.marginLineSide) {
      return line;
    }

    return NO_MARGIN_LINE;
  };

  const withMarginLine = (line: MockedMarginLine) => {
    return (image: SheetImageData, options?: RulingDetectionOptions): DetectedRuling => {
      seen.push(options);

      return { ...actual.detectRuling(image, options), ...toFoundLine(line, options) };
    };
  };

  vi.mocked(detectRuling)
    .mockImplementationOnce(withMarginLine(flat))
    .mockImplementationOnce(withMarginLine(rectified));

  return seen;
};

describe('measureSheetPhoto: линия поля второго прохода', () => {
  it('ровный проход линии не нашёл: второй её не ищет и не заводит', async () => {
    const seen = await mockMarginLinePasses(NO_MARGIN_LINE, RECTIFIED_MARGIN_LINE);

    const result = measure(LINED_DRIFT_SHEET);

    expect(result.source.perspective).not.toBeNull();
    /**
     * Запрет идёт в сам детектор, а не снимается с результата: областью изгиба
     * линия поля режет сетку узлов, и снятая после прохода она оставила бы
     * часть блока за сеткой.
     */
    expect(seen[1]?.marginLineSide).toBeNull();
    expect(result.source.marginLineX).toBeNull();
    expect(result.source.marginLineSide).toBeNull();
  });

  it('ровный проход линию нашёл: второй уточняет её на той же стороне', async () => {
    const seen = await mockMarginLinePasses(FLAT_MARGIN_LINE, RECTIFIED_MARGIN_LINE);

    const result = measure(LINED_DRIFT_SHEET);
    const { crop } = detectInCrop(LINED_DRIFT_SHEET, result.outline);

    expect(result.source.perspective).not.toBeNull();
    expect(seen[1]?.marginLineSide).toBe(FLAT_MARGIN_LINE.marginLineSide);
    expect(result.source.marginLineX).toBe(
      (RECTIFIED_MARGIN_LINE.marginLineX || 0) + crop.left
    );
    expect(result.source.marginLineSide).toBe(RECTIFIED_MARGIN_LINE.marginLineSide);
  });

  it('второй проход линию не подтвердил: линии поля нет', async () => {
    await mockMarginLinePasses(FLAT_MARGIN_LINE, NO_MARGIN_LINE);

    const result = measure(LINED_DRIFT_SHEET);

    /**
     * Неподтверждённая линия не возвращается числами ровного прохода: на
     * выпрямленной копии она мерилась заново и не набрала барьер — так линию
     * теряют IMG_1705 и IMG_1808, у которых её на листе нет.
     */
    expect(result.source.perspective).not.toBeNull();
    expect(result.source.marginLineX).toBeNull();
    expect(result.source.marginLineSide).toBeNull();
  });
});

/**
 * Отчёт линии поля берётся у того прохода, чья разлиновка ушла наружу: на
 * снимке с перспективой линию мерил второй проход, и ступень ровного прохода
 * рассказывала бы про число, которого в разлиновке уже нет.
 */
describe('measureSheetPhoto: отчёт линии поля', () => {
  it('прямую черту нашёл профиль, и опроса полос не было', () => {
    const result = measure({ ...GRID_SHEET, marginLineX: 300 });

    expect(result.source.marginLineX).not.toBeNull();
    expect(result.diagnostics.marginLine).toStrictEqual({
      coverage: 0,
      ratio: 0,
      stage: 'profile',
      threshold: null,
      profileVeto: expect.objectContaining({ isCalled: true, verdict: 'accepted' }),
      colourGate: { isEnabled: false, redGreenP99: null },
    });
  });

  it('на листе без черты диагностика несёт связавший порог', () => {
    const { diagnostics, source } = measure(GRID_SHEET);

    expect(source.marginLineX).toBeNull();
    expect(diagnostics.marginLine.stage).toBe('none');
    expect(diagnostics.marginLine.threshold).not.toBeNull();
  });

  /**
   * Снимок, ради которого отчёт и заведён: ровный проход кандидата отверг, и
   * копия за линией поля уже не идёт — сторона ей не задана. Числа отказа
   * лежат только у ровного прохода, и без них калибровка барьера фантома
   * видит «полос не было» вместо отношения глубин.
   */
  it('линию отверг ровный проход: его числа доезжают до диагностики', async () => {
    await mockMarginLinePasses(NO_MARGIN_LINE, NO_MARGIN_LINE);

    const { diagnostics, source } = measure(LINED_DRIFT_SHEET);

    expect(source.marginLineX).toBeNull();
    expect(diagnostics.marginLine.stage).toBe('none');
    expect(diagnostics.marginLine.threshold).not.toBeNull();
  });

  it('у чистого листа разлиновка не мерилась, и опроса не было', () => {
    const result = measureSheetPhoto(createSyntheticSheet(GRID_SHEET), {
      kind: 'blank',
    });

    expect(result.diagnostics.marginLine).toStrictEqual({
      coverage: 0,
      ratio: 0,
      stage: 'none',
      threshold: null,
      profileVeto: { isCalled: false },
      colourGate: null,
    });
  });
});
