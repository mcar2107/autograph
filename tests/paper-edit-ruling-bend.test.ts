import type { RulingBend, RulingBendEdit, SheetRuling } from '@pages/Generator/lib/paper';
import {
  editRulingBend,
  lineHeightAt,
  resolveBendRadius,
  sampleRulingBend,
} from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

const FRAME = { width: 900, height: 1200 };

const STEP = 24;

const PHASE = 5;

const LEFT_MARGIN = 60;

const RIGHT_MARGIN = 60;

/**
 * Допуск попадания линии через отпущенную точку из требования «Изгиб
 * правится перетаскиванием», px.
 */
const POINT_TOLERANCE_PX = 1;

/**
 * Допуск неподвижности линий за радиусом из задачи 2.3, px.
 */
const STILL_TOLERANCE_PX = 0.5;

/**
 * Радиус по высоте — три шага, вдоль линии — треть области: значения по
 * умолчанию из решения 3.
 */
const RADIUS = 3 * STEP;

const RADIUS_X = (FRAME.width - LEFT_MARGIN - RIGHT_MARGIN) / 3;

/**
 * Лист на столе: перспектива сводит линии к дальнему краю, поэтому высота
 * линии в столбце берётся только через `lineHeightAt`, а не как `U + x·tgθ`.
 */
const PERSPECTIVE_RULING: SheetRuling = {
  step: STEP,
  firstLinePhase: PHASE,
  skewAngle: 1,
  margins: { top: 180, right: RIGHT_MARGIN, bottom: 160, left: LEFT_MARGIN },
  marginLineX: null,
  marginLineSide: null,
  bend: null,
  perspective: {
    originX: 450,
    originY: 600,
    convergenceX: 1e-5,
    convergenceY: 4e-5,
  },
  outline: null,
  mirrorOverride: null,
};

/**
 * Высота линии `index` в столбце `x` с изгибом — та же модель, что у оверлея и
 * отрисовки: гребёнка с перспективой плюс выборка изгиба на её линии.
 *
 * @param ruling — разлиновка
 * @param index — номер линии
 * @param x — столбец кадра
 * @returns высота линии, px
 */
const toLineY = (ruling: SheetRuling, index: number, x: number): number => {
  const straight = lineHeightAt(ruling, x, ruling.firstLinePhase + index * ruling.step);

  return (
    straight + (ruling.bend ? sampleRulingBend(ruling.bend, ruling, x, straight) : 0)
  );
};

/**
 * Номера линий между верхним и нижним полями.
 */
const LINES = Array.from({ length: 36 }, (_item, index) => {
  return 8 + index;
});

/**
 * Столбцы через каждые три пикселя по всему кадру: изгиб продолжается за
 * крайние узлы, и линии за радиусом проверяются и там.
 */
const COLUMNS = Array.from({ length: 300 }, (_item, index) => {
  return index * 3;
});

/**
 * Наибольший сдвиг линий из набора между двумя разлиновками в заданных
 * столбцах.
 *
 * @param before — разлиновка до правки
 * @param after — разлиновка после правки
 * @param lines — номера линий
 * @param columns — столбцы
 * @returns сдвиг, px
 */
const measureShift = (
  before: SheetRuling,
  after: SheetRuling,
  lines: number[],
  columns: number[]
): number => {
  return lines.reduce((limit, line) => {
    return columns.reduce((columnLimit, x) => {
      return Math.max(
        columnLimit,
        Math.abs(toLineY(after, line, x) - toLineY(before, line, x))
      );
    }, limit);
  }, 0);
};

/**
 * Линии, отстоящие от линии `index` дальше двух радиусов по высоте.
 *
 * @param index — номер перетаскиваемой линии
 * @returns номера линий
 */
const toFarLines = (index: number): number[] => {
  return LINES.filter((line) => {
    return Math.abs(line - index) * STEP >= 2 * RADIUS;
  });
};

/**
 * Изгиб с волной по ширине и по высоте: правка поверх него не должна зависеть
 * от того, что узлы уже не нулевые.
 */
const WAVY_BEND: RulingBend = {
  columnOrigin: 60 + 780 / 32 / 2 - 0.5,
  columnSpacing: 780 / 16,
  columnCount: 16,
  rowOrigin: PHASE + 8 * STEP,
  rowSpacing: STEP,
  rowCount: 36,
  offsets: Array.from({ length: 16 * 36 }, (_item, index) => {
    const column = index % 16;
    const row = Math.floor(index / 16);

    return Math.round(400 * Math.sin(column / 2.5) * Math.cos(row / 7)) / 100;
  }),
};

const OPTIONS: RulingBendEdit = {
  radius: RADIUS,
  radiusX: RADIUS_X,
  isWholeColumn: false,
  frame: FRAME,
};

describe('editRulingBend: перетаскивание точки линии', () => {
  it('прогиб у пружины: линия проходит через точку, соседи меньше, дальние линии и правая часть на месте', () => {
    const line = 20;
    const x = 80;
    const delta = 8;
    const point = { x, y: toLineY(PERSPECTIVE_RULING, line, x) };
    const edited = editRulingBend(PERSPECTIVE_RULING, point, delta, OPTIONS);

    expect(edited.bend).not.toBeNull();
    expect(Math.abs(toLineY(edited, line, x) - (point.y + delta))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );

    const neighbourShifts = [line - 1, line + 1, line - 2, line + 2].map((neighbour) => {
      return toLineY(edited, neighbour, x) - toLineY(PERSPECTIVE_RULING, neighbour, x);
    });

    neighbourShifts.forEach((shift) => {
      expect(shift).toBeGreaterThan(0);
      expect(shift).toBeLessThan(delta);
    });
    expect(
      measureShift(PERSPECTIVE_RULING, edited, toFarLines(line), COLUMNS)
    ).toBeLessThanOrEqual(STILL_TOLERANCE_PX);

    /**
     * Правая часть листа — дальше двух радиусов вдоль линии и ещё двух
     * промежутков узлов: Катмулл — Ром берёт по два узла с каждой стороны.
     */
    const bend = edited.bend as RulingBend;
    const rightColumns = COLUMNS.filter((column) => {
      return column >= x + 2 * RADIUS_X + 2 * bend.columnSpacing;
    });

    expect(rightColumns.length).toBeGreaterThan(0);
    expect(
      measureShift(PERSPECTIVE_RULING, edited, LINES, rightColumns)
    ).toBeLessThanOrEqual(STILL_TOLERANCE_PX);
  });

  it('правка поверх готового изгиба: точка взята, линии за двумя радиусами не сдвинулись', () => {
    const ruling: SheetRuling = { ...PERSPECTIVE_RULING, bend: WAVY_BEND };
    const line = 30;
    const x = 437;
    const delta = -6.5;
    const point = { x, y: toLineY(ruling, line, x) };
    const edited = editRulingBend(ruling, point, delta, OPTIONS);

    expect(Math.abs(toLineY(edited, line, x) - (point.y + delta))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
    expect(measureShift(ruling, edited, toFarLines(line), COLUMNS)).toBeLessThanOrEqual(
      STILL_TOLERANCE_PX
    );
    expect(edited.bend?.columnCount).toBe(WAVY_BEND.columnCount);
    expect(edited.bend?.rowCount).toBe(WAVY_BEND.rowCount);
  });

  it('узкий радиус и точка между узлами: линия всё равно доходит до точки', () => {
    /**
     * Радиус вдоль линии — промежуток узлов: Катмулл — Ром между узлами
     * отвечает на такой узкий горб заметно меньше единицы, и без масштаба по
     * отклику линия не дошла бы до точки больше чем на пиксель.
     */
    const ruling: SheetRuling = { ...PERSPECTIVE_RULING, bend: WAVY_BEND };
    const line = 22;
    const x = WAVY_BEND.columnOrigin + 6.5 * WAVY_BEND.columnSpacing;
    const delta = STEP;
    const point = { x, y: toLineY(ruling, line, x) };
    const edited = editRulingBend(ruling, point, delta, {
      ...OPTIONS,
      radius: STEP,
      radiusX: WAVY_BEND.columnSpacing,
    });

    expect(Math.abs(toLineY(edited, line, x) - (point.y + delta))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
  });

  it('точка чуть в стороне от линии: линия проходит через отпущенную точку, а не через взятую', () => {
    const ruling: SheetRuling = { ...PERSPECTIVE_RULING, bend: WAVY_BEND };
    const line = 15;
    const x = 610;
    const point = { x, y: toLineY(ruling, line, x) + 3 };
    const edited = editRulingBend(ruling, point, 4, OPTIONS);

    expect(Math.abs(toLineY(edited, line, x) - (point.y + 4))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
  });

  it('точка за крайним узлом по ширине: линия всё равно проходит через неё', () => {
    const ruling: SheetRuling = { ...PERSPECTIVE_RULING, bend: WAVY_BEND };
    const line = 25;
    const x = 20;
    const point = { x, y: toLineY(ruling, line, x) };
    const edited = editRulingBend(ruling, point, 5, OPTIONS);

    expect(Math.abs(toLineY(edited, line, x) - (point.y + 5))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
    expect(measureShift(ruling, edited, toFarLines(line), COLUMNS)).toBeLessThanOrEqual(
      STILL_TOLERANCE_PX
    );
  });

  it('линия выше сетки узлов: сетка дорастает до неё, прочие линии за радиусом не меняются', () => {
    const ruling: SheetRuling = { ...PERSPECTIVE_RULING, bend: WAVY_BEND };
    const line = 2;
    const x = 450;
    const point = { x, y: toLineY(ruling, line, x) };
    const edited = editRulingBend(ruling, point, -4, OPTIONS);
    const farLines = [...LINES, 0, 1, 3, 4, 5, 6, 7].filter((other) => {
      return Math.abs(other - line) * STEP >= 2 * RADIUS;
    });

    expect(Math.abs(toLineY(edited, line, x) - (point.y - 4))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
    expect(measureShift(ruling, edited, farLines, COLUMNS)).toBeLessThanOrEqual(
      STILL_TOLERANCE_PX
    );
  });

  it('весь столбец: все линии в столбце точки сдвигаются на тот же сдвиг', () => {
    const line = 20;
    const x = 300;
    const delta = 5;
    const point = { x, y: toLineY(PERSPECTIVE_RULING, line, x) };
    const edited = editRulingBend(PERSPECTIVE_RULING, point, delta, {
      ...OPTIONS,
      isWholeColumn: true,
    });

    LINES.forEach((other) => {
      expect(
        Math.abs(
          toLineY(edited, other, x) - toLineY(PERSPECTIVE_RULING, other, x) - delta
        )
      ).toBeLessThanOrEqual(POINT_TOLERANCE_PX);
    });
  });

  it('без изгиба создаётся сетка с шагом узлов, как у поиска изгиба: полосы в два шага по области', () => {
    const point = { x: 450, y: toLineY(PERSPECTIVE_RULING, 20, 450) };
    const bend = editRulingBend(PERSPECTIVE_RULING, point, 3, OPTIONS).bend as RulingBend;
    const regionWidth = FRAME.width - LEFT_MARGIN - RIGHT_MARGIN;

    expect(bend.columnCount).toBe(Math.round(regionWidth / (2 * STEP)));
    expect(bend.columnSpacing).toBeCloseTo(regionWidth / bend.columnCount, 9);
    expect(bend.rowSpacing).toBe(STEP);
    expect((bend.rowOrigin - PHASE) / STEP).toBe(
      Math.round((bend.rowOrigin - PHASE) / STEP)
    );
    bend.offsets.forEach((offset) => {
      expect(Math.round(offset * 100)).toBeCloseTo(offset * 100, 9);
    });
  });

  it('без шага разлиновки правка не применяется', () => {
    const ruling: SheetRuling = { ...PERSPECTIVE_RULING, step: 0, perspective: null };

    expect(editRulingBend(ruling, { x: 100, y: 300 }, 5, OPTIONS)).toBe(ruling);
  });
});

describe('resolveBendRadius', () => {
  it('по умолчанию три шага по высоте и треть области вдоль линий', () => {
    expect(resolveBendRadius(PERSPECTIVE_RULING, FRAME)).toStrictEqual({
      radius: RADIUS,
      radiusX: RADIUS_X,
    });
  });
});
