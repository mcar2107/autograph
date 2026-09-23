import type { SheetRuling } from '@pages/Generator/lib/paper';
import {
  lineHeightAt,
  refitRulingBend,
  sampleRulingBend,
} from '@pages/Generator/lib/paper';
import { detectRulingBend } from '@pages/Generator/lib/paper/detectRulingBend';
import { describe, expect, it } from 'vitest';

import {
  computeSyntheticLineY,
  computeSyntheticPerspective,
  createSyntheticSheet,
  type SyntheticField,
  type SyntheticSheetParams,
} from './helpers/synthetic-sheet';

const WIDTH = 900;

const HEIGHT = 1200;

const STEP = 24;

const PHASE = 5;

const TOP = 180;

const BOTTOM = 160;

const SIDE = 60;

const RULED_HEIGHT = HEIGHT - TOP - BOTTOM;

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Критерий задачи 2.4: линии следуют волне не хуже двадцатой шага.
 */
const LINE_TOLERANCE = STEP / 20;

/**
 * Длина волны — половина области с линиями: у её краёв волна в гребне, и
 * постоянное продолжение изгиба за крайними узлами не уводит линию с волны.
 */
const WAVELENGTH = (WIDTH - 2 * SIDE) / 2;

/**
 * Волна бумаги в четверть шага по ширине листа.
 */
const WAVE: SyntheticField = (x) => {
  return 0.25 * STEP * Math.cos((2 * Math.PI * (x - SIDE)) / WAVELENGTH);
};

/**
 * Коэффициент схождения по высоте, при котором шаг у нижней линии больше, чем
 * у верхней, на долю `drift`.
 *
 * @param drift — прирост шага сверху вниз
 * @returns коэффициент `convergenceY`
 */
const toConvergenceY = (drift: number): number => {
  const ratio = Math.sqrt(1 + drift);

  return (2 * (ratio - 1)) / (RULED_HEIGHT * (ratio + 1));
};

/**
 * Лист на столе с волной: дрейф шага 8 % и схождение на градус. На таком листе
 * поиск изгиба у прямой гребёнки по кадру изгиб отбрасывает.
 */
const WAVY_PERSPECTIVE_SHEET: SyntheticSheetParams = {
  width: WIDTH,
  height: HEIGHT,
  step: STEP,
  phase: PHASE,
  angle: 1,
  kind: 'lined',
  margins: { top: TOP, right: SIDE, bottom: BOTTOM, left: SIDE },
  lineWidth: 2,
  lineDarkness: 0.35,
  noise: 0.04,
  lighting: 0.2,
  seed: 11,
  rulingPerspective: {
    convergenceX: 1 / DEGREES_IN_RADIAN / RULED_HEIGHT,
    convergenceY: toConvergenceY(0.08),
  },
  bend: WAVE,
};

const WAVY_FLAT_SHEET: SyntheticSheetParams = {
  ...WAVY_PERSPECTIVE_SHEET,
  rulingPerspective: null,
};

/**
 * Текущая гребёнка редактора: закреплённые линии уже легли на снимок, изгиба
 * ещё нет.
 *
 * @param params — описание листа
 * @returns разлиновка с точной гребёнкой синтетики
 */
const toRuling = (params: SyntheticSheetParams): SheetRuling => {
  return {
    step: STEP,
    firstLinePhase: PHASE,
    skewAngle: 1,
    margins: { top: TOP, right: SIDE, bottom: BOTTOM, left: SIDE },
    marginLineX: null,
    marginLineSide: null,
    bend: null,
    perspective: computeSyntheticPerspective(params),
    outline: null,
    mirrorOverride: null,
  };
};

/**
 * Линии между полями, кроме крайних: у крайних строк узлов нет соседей сверху
 * или снизу для фильтра выбросов, и они не про перспективу.
 */
const LINES = Array.from(
  {
    length:
      Math.floor((HEIGHT - BOTTOM - PHASE) / STEP) - Math.ceil((TOP - PHASE) / STEP) - 1,
  },
  (_item, index) => {
    return Math.ceil((TOP - PHASE) / STEP) + 1 + index;
  }
);

/**
 * Столбцы области с линиями через каждые три пикселя.
 */
const COLUMNS = Array.from(
  { length: Math.floor((WIDTH - 2 * SIDE - 8) / 3) + 1 },
  (_item, index) => {
    return SIDE + 4 + index * 3;
  }
);

/**
 * Наибольшее расхождение линий разлиновки с эталоном синтетики по всей
 * области с линиями.
 *
 * @param ruling — разлиновка
 * @param params — описание листа
 * @returns расхождение, px
 */
const measureLineError = (ruling: SheetRuling, params: SyntheticSheetParams): number => {
  return LINES.reduce((limit, line) => {
    return COLUMNS.reduce((columnLimit, x) => {
      const straight = lineHeightAt(ruling, x, PHASE + line * STEP);
      const restored =
        straight + (ruling.bend ? sampleRulingBend(ruling.bend, ruling, x, straight) : 0);

      return Math.max(
        columnLimit,
        Math.abs(restored - computeSyntheticLineY(params, line, x))
      );
    }, limit);
  }, 0);
};

describe('refitRulingBend: подгонка изгиба по фото от текущей гребёнки', () => {
  it('перспектива и волна: линии следуют волне не хуже двадцатой шага', () => {
    const image = createSyntheticSheet(WAVY_PERSPECTIVE_SHEET);
    const ruling = toRuling(WAVY_PERSPECTIVE_SHEET);
    const detection = refitRulingBend(image, ruling);

    expect(detection.bend).not.toBeNull();
    expect(
      measureLineError({ ...ruling, bend: detection.bend }, WAVY_PERSPECTIVE_SHEET)
    ).toBeLessThanOrEqual(LINE_TOLERANCE);
  });

  it('отрицательный контроль: поиск изгиба у прямой гребёнки по кадру волну на этом листе теряет', () => {
    const image = createSyntheticSheet(WAVY_PERSPECTIVE_SHEET);
    const ruling = toRuling(WAVY_PERSPECTIVE_SHEET);
    const { bend } = detectRulingBend(image, ruling, { left: SIDE, right: WIDTH - SIDE });

    expect(measureLineError({ ...ruling, bend }, WAVY_PERSPECTIVE_SHEET)).toBeGreaterThan(
      LINE_TOLERANCE
    );
  });

  it('без перспективы вывод равен поиску изгиба по кадру до бита', () => {
    const image = createSyntheticSheet(WAVY_FLAT_SHEET);
    const ruling = toRuling(WAVY_FLAT_SHEET);
    const detection = refitRulingBend(image, ruling);

    expect(ruling.perspective).toBeNull();
    expect(detection.bend).not.toBeNull();
    expect(detection).toStrictEqual(
      detectRulingBend(image, ruling, { left: SIDE, right: WIDTH - SIDE })
    );
    expect(
      measureLineError({ ...ruling, bend: detection.bend }, WAVY_FLAT_SHEET)
    ).toBeLessThanOrEqual(LINE_TOLERANCE);
  });

  it('линия поля сужает область: узлы изгиба не заходят за неё', () => {
    const image = createSyntheticSheet(WAVY_PERSPECTIVE_SHEET);
    const ruling: SheetRuling = {
      ...toRuling(WAVY_PERSPECTIVE_SHEET),
      marginLineX: 200,
      marginLineSide: 'left',
    };
    const { bend } = refitRulingBend(image, ruling);

    expect(bend).not.toBeNull();
    expect(bend?.columnOrigin).toBeGreaterThan(200);
  });

  it('без шага изгиба нет', () => {
    const image = createSyntheticSheet(WAVY_FLAT_SHEET);

    expect(
      refitRulingBend(image, { ...toRuling(WAVY_FLAT_SHEET), step: 0 }).bend
    ).toBeNull();
  });
});
