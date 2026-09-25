import type {
  RulingPin,
  RulingPinsFit,
  SheetPoint,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import {
  deriveRulingPins,
  fitRulingPins,
  lineCoordinateAt,
  lineHeightAt,
  mirrorSheetRuling,
  readSideEdge,
  sideEdgePointAtHeight,
} from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

const FRAME = { width: 1600, height: 2000 };

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Допуск попадания линий через булавки из требования «Линии правятся
 * закреплением», px.
 */
const PIN_TOLERANCE_PX = 1;

/**
 * Разлиновка, от которой стартует правка: верхнее и нижнее поля и контур
 * должны пережить подгонку без изменений.
 */
const BASE_RULING: SheetRuling = {
  step: 52,
  firstLinePhase: 11,
  skewAngle: -0.4,
  margins: { top: 160, right: 120, bottom: 140, left: 180 },
  marginLineX: 170,
  marginLineSide: 'left',
  sideSlant: null,
  bend: null,
  perspective: null,
  outline: null,
  mirrorOverride: null,
};

/**
 * Разлиновка из успешной подгонки; иначе тест падает с причиной отказа.
 *
 * @param fit — итог подгонки
 * @returns подогнанная разлиновка
 */
const expectFitted = (fit: RulingPinsFit): SheetRuling => {
  if (fit.status !== 'fitted') {
    throw new Error(`Подгонка не удалась: ${fit.status}`);
  }

  return fit.ruling;
};

/**
 * Высота линии `index` подогнанной разлиновки в столбце `x`.
 *
 * @param ruling — разлиновка
 * @param index — номер линии
 * @param x — столбец кадра, px
 * @returns высота линии, px
 */
const getLineY = (ruling: SheetRuling, index: number, x: number): number => {
  return lineHeightAt(ruling, x, ruling.firstLinePhase + index * ruling.step);
};

describe('две булавки ровного листа', () => {
  const STEP = 40;
  const PHASE = 25;
  const TANGENT = Math.tan(0.8 / DEGREES_IN_RADIAN);

  /**
   * Высота линии эталонного листа — прямая гребёнка с равным шагом.
   *
   * @param index — номер линии
   * @param x — столбец, px
   * @returns высота линии, px
   */
  const getTrueY = (index: number, x: number): number => {
    return PHASE + index * STEP + x * TANGENT;
  };

  const buildPin = (index: number): RulingPin => {
    return {
      index,
      left: { x: 150, y: getTrueY(index, 150) },
      right: { x: 1450, y: getTrueY(index, 1450) },
    };
  };

  const fit = fitRulingPins(BASE_RULING, [buildPin(3), buildPin(45)], FRAME);
  const ruling = expectFitted(fit);

  it('все линии идут через равный шаг и проходят через обе булавки', () => {
    for (let index = 0; index <= 48; index += 1) {
      for (const x of [0, FRAME.width]) {
        expect(Math.abs(getLineY(ruling, index, x) - getTrueY(index, x))).toBeLessThan(
          1e-6
        );
      }
    }

    expect(ruling.step).toBeCloseTo(STEP, 9);
    expect(ruling.skewAngle).toBeCloseTo(0.8, 9);
    expect(ruling.perspective).toBeNull();
    expect(fit.status === 'fitted' && fit.residuals).toStrictEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it('верхнее и нижнее поля, сторона линии поля и контур не меняются, изгиб снят', () => {
    expect(ruling.margins.top).toBe(BASE_RULING.margins.top);
    expect(ruling.margins.bottom).toBe(BASE_RULING.margins.bottom);
    expect(ruling.marginLineSide).toBe(BASE_RULING.marginLineSide);
    expect(ruling.outline).toBe(BASE_RULING.outline);
    expect(ruling.bend).toBeNull();
  });
});

describe('три булавки листа на столе', () => {
  /**
   * Лист, снятый на столе: проективное отображение бумаги с равным шагом
   * `PAPER_STEP` на кадр. Знаменатель растёт к верху листа, поэтому шаг на
   * снимке у верха на четверть меньше, чем у низа; небольшой поворот и
   * схождение по ширине — чтобы подгонка не прошла на одном наклоне.
   */
  const PAPER_STEP = 60;
  const LINE_COUNT = 30;
  const PAPER_HEIGHT = (LINE_COUNT - 1) * PAPER_STEP;
  const DEPTH = (Math.sqrt(1 / 0.75) - 1) / PAPER_HEIGHT;
  const WIDTH_CONVERGENCE = 2e-5;
  const ROTATION = 0.6 / DEGREES_IN_RADIAN;

  /**
   * Точка бумаги на снимке.
   *
   * @param u — отступ по ширине бумаги, px
   * @param v — отступ по высоте бумаги, px
   * @returns точка кадра
   */
  const project = (u: number, v: number): SheetPoint => {
    const weight = 1 + DEPTH * (PAPER_HEIGHT - v) + WIDTH_CONVERGENCE * (u - 600);

    return {
      x: 200 + (u * Math.cos(ROTATION) - v * Math.sin(ROTATION)) / weight,
      y: 150 + (u * Math.sin(ROTATION) + v * Math.cos(ROTATION)) / weight,
    };
  };

  /**
   * Высота линии `index` эталонного листа в столбце `x`: линия бумаги на
   * снимке прямая, высота берётся по двум её точкам.
   *
   * @param index — номер линии
   * @param x — столбец кадра, px
   * @returns высота линии, px
   */
  const getTrueY = (index: number, x: number): number => {
    const start = project(0, index * PAPER_STEP);
    const end = project(1200, index * PAPER_STEP);

    return start.y + ((x - start.x) * (end.y - start.y)) / (end.x - start.x);
  };

  const buildPin = (index: number): RulingPin => {
    return {
      index,
      left: project(100, index * PAPER_STEP),
      right: project(1100, index * PAPER_STEP),
    };
  };

  const topStep = project(600, PAPER_STEP).y - project(600, 0).y;
  const bottomStep =
    project(600, PAPER_HEIGHT).y - project(600, PAPER_HEIGHT - PAPER_STEP).y;
  const ruling = expectFitted(
    fitRulingPins(BASE_RULING, [buildPin(0), buildPin(14), buildPin(29)], FRAME)
  );

  it('шаг снимка у верха на четверть меньше, чем у низа', () => {
    expect(topStep / bottomStep).toBeGreaterThan(0.73);
    expect(topStep / bottomStep).toBeLessThan(0.77);
  });

  it('промежуточные линии ложатся на линии снимка не дальше двадцатой шага', () => {
    for (let index = 0; index < LINE_COUNT; index += 1) {
      for (const u of [100, 600, 1100]) {
        const { x } = project(u, index * PAPER_STEP);

        expect(Math.abs(getLineY(ruling, index, x) - getTrueY(index, x))).toBeLessThan(
          topStep / 20
        );
      }
    }

    expect(ruling.perspective?.convergenceY).not.toBe(0);
  });

  it('без третьей булавки изменение шага по высоте не передаётся', () => {
    const flat = expectFitted(
      fitRulingPins(BASE_RULING, [buildPin(0), buildPin(29)], FRAME)
    );
    const x = project(600, 7 * PAPER_STEP).x;

    expect(Math.abs(getLineY(flat, 7, x) - getTrueY(7, x))).toBeGreaterThan(topStep / 20);
  });

  /**
   * Булавок четыре: три линии одного пучка с любыми номерами гребёнка
   * проходит точно, и ошибку номера выдаёт только четвёртая.
   */
  it('булавка не на той линии видна по своей невязке', () => {
    const fit = fitRulingPins(
      BASE_RULING,
      [buildPin(0), buildPin(10), { ...buildPin(21), index: 20 }, buildPin(29)],
      FRAME
    );

    expect(fit.status).toBe('fitted');
    expect(fit.status === 'fitted' && Math.max(...fit.residuals)).toBeGreaterThan(
      topStep / 4
    );
  });
});

describe('две непараллельные булавки', () => {
  const PINS: RulingPin[] = [
    { index: 0, left: { x: 100, y: 300 }, right: { x: 1500, y: 300 } },
    { index: 10, left: { x: 100, y: 900 }, right: { x: 1500, y: 800 } },
  ];
  const ruling = expectFitted(fitRulingPins(BASE_RULING, PINS, FRAME));

  it('все линии прямые и проходят через булавки ±1 px', () => {
    for (const { index, left, right } of PINS) {
      expect(Math.abs(getLineY(ruling, index, left.x) - left.y)).toBeLessThan(
        PIN_TOLERANCE_PX
      );
      expect(Math.abs(getLineY(ruling, index, right.x) - right.y)).toBeLessThan(
        PIN_TOLERANCE_PX
      );
    }

    for (let index = 0; index <= 10; index += 1) {
      const start = getLineY(ruling, index, 0);
      const end = getLineY(ruling, index, FRAME.width);

      for (const x of [400, 800, 1200]) {
        const straight = start + ((end - start) * x) / FRAME.width;

        expect(Math.abs(getLineY(ruling, index, x) - straight)).toBeLessThan(1e-6);
      }
    }
  });

  it('линии сходятся к правому краю кадра через равный шаг по высоте', () => {
    for (let index = 0; index < 10; index += 1) {
      const leftGap = getLineY(ruling, index + 1, 100) - getLineY(ruling, index, 100);
      const rightGap = getLineY(ruling, index + 1, 1500) - getLineY(ruling, index, 1500);

      expect(rightGap).toBeLessThan(leftGap);
      expect(leftGap).toBeCloseTo(60, 6);
      expect(rightGap).toBeCloseTo(50, 6);
    }
  });
});

describe('две параллельные булавки на листе с перспективой', () => {
  it('снимают перспективу: линии идут через равный шаг по наклону булавок', () => {
    const tangent = 0.01;
    const pins: RulingPin[] = [2, 30].map((index) => {
      return {
        index,
        left: { x: 200, y: 100 + index * 45 + 200 * tangent },
        right: { x: 1400, y: 100 + index * 45 + 1400 * tangent },
      };
    });
    const ruling = expectFitted(
      fitRulingPins(
        {
          ...BASE_RULING,
          perspective: {
            originX: 800,
            originY: 1000,
            convergenceX: 1e-5,
            convergenceY: 2e-5,
          },
        },
        pins,
        FRAME
      )
    );

    expect(ruling.perspective).toBeNull();
    expect(ruling.step).toBeCloseTo(45, 9);
    expect(Math.tan(ruling.skewAngle / DEGREES_IN_RADIAN)).toBeCloseTo(tangent, 12);
  });
});

describe('негодная расстановка', () => {
  const PIN: RulingPin = {
    index: 0,
    left: { x: 100, y: 300 },
    right: { x: 1500, y: 300 },
  };

  const shifted = (index: number, y: number): RulingPin => {
    return {
      index,
      left: { x: 100, y },
      right: { x: 1500, y },
    };
  };

  it.each([
    { name: 'одна булавка', pins: [PIN] },
    { name: 'число шагов не задано', pins: [PIN, shifted(0, 900)] },
    {
      name: 'булавка без длины',
      pins: [PIN, { index: 5, left: { x: 700, y: 600 }, right: { x: 700, y: 640 } }],
    },
    { name: 'линии в обратном номерам порядке', pins: [PIN, shifted(-5, 900)] },
    { name: 'дробный номер', pins: [PIN, shifted(2.5, 900)] },
  ])('отвергается: $name', ({ pins }) => {
    expect(fitRulingPins(BASE_RULING, pins, FRAME)).toStrictEqual({
      status: 'degenerate',
    });
  });

  it('гребёнка с горизонтом внутри кадра отвергается с невязками', () => {
    const fit = fitRulingPins(
      BASE_RULING,
      [PIN, { index: 1, left: { x: 100, y: 900 }, right: { x: 1500, y: 310 } }],
      FRAME
    );

    expect(fit.status).toBe('beyondHorizon');
    expect(fit.status === 'beyondHorizon' && fit.residuals).toHaveLength(2);
  });
});

describe('начальные булавки', () => {
  it('ровный лист — две булавки на крайних линиях области с линиями', () => {
    const pins = deriveRulingPins(BASE_RULING, FRAME);
    const center = (180 + FRAME.width - 120) / 2;
    const [first, last] = pins;

    /**
     * Концы — на десятой доле ширины блока внутрь от его краёв: блок
     * 180…1480, ширина 1300.
     */
    expect(pins).toHaveLength(2);
    expect(first?.left.x).toBeCloseTo(310, 9);
    expect(first?.right.x).toBeCloseTo(1350, 9);
    expect(last?.left.x).toBeCloseTo(310, 9);
    expect(last?.right.x).toBeCloseTo(1350, 9);
    expect(getLineY(BASE_RULING, first?.index || 0, center)).toBeGreaterThanOrEqual(160);
    expect(getLineY(BASE_RULING, (first?.index || 0) - 1, center)).toBeLessThan(160);
    expect(getLineY(BASE_RULING, last?.index || 0, center)).toBeLessThanOrEqual(
      FRAME.height - 140
    );
    expect(getLineY(BASE_RULING, (last?.index || 0) + 1, center)).toBeGreaterThan(
      FRAME.height - 140
    );

    const ruling = expectFitted(fitRulingPins(BASE_RULING, pins, FRAME));

    expect(ruling.step).toBeCloseTo(BASE_RULING.step, 9);
    expect(ruling.firstLinePhase).toBeCloseTo(BASE_RULING.firstLinePhase, 6);
    expect(ruling.skewAngle).toBeCloseTo(BASE_RULING.skewAngle, 9);
  });

  it('лист с перспективой — три булавки, подгонка по ним возвращает те же линии', () => {
    const perspective = {
      originX: 700,
      originY: 900,
      convergenceX: 1.2e-5,
      convergenceY: -3e-5,
    };
    const source = { ...BASE_RULING, perspective };
    const pins = deriveRulingPins(source, FRAME);
    const ruling = expectFitted(fitRulingPins(source, pins, FRAME));

    expect(pins).toHaveLength(3);

    for (const y of [0, FRAME.height]) {
      for (const x of [0, FRAME.width]) {
        const u = lineCoordinateAt(source, x, y);
        const index = Math.round((u - source.firstLinePhase) / source.step);

        expect(
          Math.abs(getLineY(ruling, index, x) - getLineY(source, index, x))
        ).toBeLessThan(1e-6);
      }
    }
  });

  it('без шага — две булавки на четверти и трёх четвертях высоты листа', () => {
    const pins = deriveRulingPins({ ...BASE_RULING, step: 0 }, FRAME);

    expect(
      pins.map(({ index, left, right }) => {
        return [index, left.y, right.y];
      })
    ).toStrictEqual([
      [0, 500, 500],
      [0, 1500, 1500],
    ]);
    expect(fitRulingPins(BASE_RULING, pins, FRAME).status).toBe('degenerate');
  });
});

describe('боковые границы блока при смене наклона', () => {
  /**
   * Допуск «граница на фото на месте», px.
   */
  const EDGE_TOLERANCE_PX = 0.5;

  /**
   * Строки фотографии, в которых сверяется положение границ: концы у верха и
   * низа кадра и середина.
   */
  const ROWS = [0, FRAME.height / 2, FRAME.height];

  /**
   * Лист с наклонёнными полями и линией поля и со своими полями у зеркала:
   * пересчёт обязан сохранить на фото оба конца каждой границы.
   */
  const SLANTED_RULING: SheetRuling = {
    ...BASE_RULING,
    sideSlant: { left: 210, right: 95, marginLineX: 196 },
    mirrorOverride: {
      marginLineX: 1450,
      marginLineSide: 'right',
      marginLeft: 130,
      marginRight: 170,
      sideSlant: { left: 150, right: 160, marginLineX: 1436 },
    },
  };

  /**
   * Столбцы боковых границ страницы в строках `ROWS`: левое и правое поля,
   * затем линия поля.
   *
   * @param ruling — разлиновка страницы
   * @returns столбцы, px фотографии
   */
  const readEdgeColumns = (ruling: SheetRuling): number[] => {
    return (['left', 'right', 'marginLine'] as const).flatMap((edge) => {
      const ends = readSideEdge(ruling, FRAME, edge);

      return ends
        ? ROWS.map((y) => {
            return sideEdgePointAtHeight(ruling.skewAngle, ends, FRAME.height, y).x;
          })
        : [];
    });
  };

  /**
   * Наибольший сдвиг боковых границ на фото и на зеркальной странице.
   *
   * @param before — разлиновка до правки
   * @param after — разлиновка после правки
   * @returns сдвиг страницы и зеркала, px
   */
  const measureEdgeShift = (before: SheetRuling, after: SheetRuling): number[] => {
    return [
      [before, after],
      [mirrorSheetRuling(before, FRAME), mirrorSheetRuling(after, FRAME)],
    ].map(([from, to]) => {
      const start = readEdgeColumns(from || before);
      const end = readEdgeColumns(to || after);

      expect(end).toHaveLength(start.length);

      return start.reduce((largest, x, index) => {
        return Math.max(largest, Math.abs((end[index] || 0) - x));
      }, 0);
    });
  };

  it('ровный лист: наклон меняется на 1,2°, поля, линия поля и поля зеркала на фото на месте', () => {
    const tangent = Math.tan(0.8 / DEGREES_IN_RADIAN);
    const pins: RulingPin[] = [3, 45].map((index) => {
      return {
        index,
        left: { x: 150, y: 25 + index * 40 + 150 * tangent },
        right: { x: 1450, y: 25 + index * 40 + 1450 * tangent },
      };
    });
    const ruling = expectFitted(fitRulingPins(SLANTED_RULING, pins, FRAME));

    expect(ruling.skewAngle).toBeCloseTo(0.8, 9);
    expect(measureEdgeShift(SLANTED_RULING, ruling)).toStrictEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
    ]);
    expect(Math.max(...measureEdgeShift(SLANTED_RULING, ruling))).toBeLessThan(
      EDGE_TOLERANCE_PX
    );
  });

  it('ровный лист с полями без наклона: границы остаются на месте и наклоняются к строкам', () => {
    const tangent = Math.tan(0.8 / DEGREES_IN_RADIAN);
    const pins: RulingPin[] = [3, 45].map((index) => {
      return {
        index,
        left: { x: 150, y: 25 + index * 40 + 150 * tangent },
        right: { x: 1450, y: 25 + index * 40 + 1450 * tangent },
      };
    });
    const ruling = expectFitted(fitRulingPins(BASE_RULING, pins, FRAME));
    const [pageShift = Number.NaN, mirrorShift = Number.NaN] = measureEdgeShift(
      BASE_RULING,
      ruling
    );

    expect(pageShift).toBeLessThan(1e-6);
    expect(mirrorShift).toBeLessThan(EDGE_TOLERANCE_PX);
    expect(ruling.sideSlant).not.toBeNull();
  });

  it('лист с перспективой: сдвиг конца булавки на 30 px не двигает границы на фото и на зеркале', () => {
    const start: SheetRuling = {
      ...SLANTED_RULING,
      skewAngle: 0.3,
      perspective: {
        originX: 800,
        originY: 1000,
        convergenceX: 1e-5,
        convergenceY: 3e-5,
      },
    };
    const pins = deriveRulingPins(start, FRAME);
    const [head, ...rest] = pins;

    expect(pins).toHaveLength(3);

    if (!head) {
      throw new Error('Нет начальных булавок');
    }

    const moved = [{ ...head, left: { ...head.left, y: head.left.y - 30 } }, ...rest];
    const ruling = expectFitted(fitRulingPins(start, moved, FRAME));

    expect(ruling.perspective).not.toBeNull();
    expect(Math.abs(ruling.skewAngle - start.skewAngle)).toBeGreaterThan(0.1);
    expect(Math.max(...measureEdgeShift(start, ruling))).toBeLessThan(1e-6);
  });

  it('наклон не меняется — поля, линия поля и поля зеркала те же до бита', () => {
    const pins = deriveRulingPins(SLANTED_RULING, FRAME);
    const ruling = expectFitted(fitRulingPins(SLANTED_RULING, pins, FRAME));

    expect(ruling.margins).toBe(SLANTED_RULING.margins);
    expect(ruling.marginLineX).toBe(SLANTED_RULING.marginLineX);
    expect(ruling.sideSlant).toBe(SLANTED_RULING.sideSlant);
    expect(ruling.mirrorOverride).toBe(SLANTED_RULING.mirrorOverride);
  });
});
