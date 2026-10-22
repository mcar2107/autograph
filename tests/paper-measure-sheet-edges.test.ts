import { measureSheetPhoto } from '@pages/Generator/lib/paper/measureSheetPhoto';
import { describe, expect, it } from 'vitest';

import { readFirstTextLineY } from './helpers/first-text-line';
import {
  computeSyntheticColumnX,
  computeSyntheticLineY,
  createSyntheticSheet,
  type SyntheticField,
  type SyntheticRulingPerspective,
  type SyntheticSheetParams,
} from './helpers/synthetic-sheet';

const WIDTH = 900;

const HEIGHT = 1200;

const FRAME = { width: WIDTH, height: HEIGHT };

const STEP = 30;

const PHASE = 7;

const TOP = 150;

const BOTTOM = 150;

const RIGHT_COLUMNS = 170;

/**
 * Зазор от крайней вертикали до края блока — пятая доля шага, как у детектора.
 */
const EDGE_GAP = STEP / 5;

/**
 * Допуск границ — четверть шага: ошибка на линию даёт целый шаг.
 */
const TOLERANCE = STEP / 4;

/**
 * Дрейф шага сверху вниз, как у тетради, снятой телефоном под наклоном.
 */
const DRIFT = 0.044;

/**
 * Лист на столе с наклонной верхней стороной: вписанная вырезка срезает верх
 * листа по нижнему из углов, и между её краем и стороной слева остаётся полоса
 * бумаги.
 */
const BASE_SHEET: SyntheticSheetParams = {
  width: WIDTH,
  height: HEIGHT,
  step: STEP,
  phase: PHASE,
  angle: 0.4,
  kind: 'grid',
  margins: { top: TOP, right: 140, bottom: BOTTOM, left: 150 },
  columnMargins: { left: 180, right: RIGHT_COLUMNS },
  lineWidth: 2,
  lineDarkness: 0.3,
  noise: 0.04,
  lighting: 0.2,
  seed: 7,
  surface: {
    outline: {
      topLeft: { x: 60, y: 50 },
      topRight: { x: 850, y: 105 },
      bottomRight: { x: 860, y: 1170 },
      bottomLeft: { x: 50, y: 1180 },
    },
    cornerRadius: 20,
    brightness: 0.3,
    grain: 0.3,
  },
};

/**
 * Перспектива с дрейфом шага `drift` между верхней и нижней линиями области.
 *
 * @param drift — относительный рост шага сверху вниз
 * @returns перспектива синтетики
 */
const toDriftPerspective = (drift: number): SyntheticRulingPerspective => {
  const ratio = Math.sqrt(1 + drift);

  return {
    convergenceX: 0,
    convergenceY: (2 * (ratio - 1)) / ((HEIGHT - TOP - BOTTOM) * (ratio + 1)),
  };
};

/**
 * S-волна у верха листа: концы линий уходят в разные стороны, волна затухает
 * вниз.
 *
 * @param amplitude — амплитуда в долях шага
 * @param decaySteps — затухание в шагах
 * @returns изгиб горизонтальных линий
 */
const toTopWave = (amplitude: number, decaySteps: number): SyntheticField => {
  return (x, y) => {
    const shape = Math.sin((Math.PI * (x - WIDTH / 2)) / (WIDTH * 0.8));

    return (
      amplitude * STEP * shape * Math.exp(-Math.max(0, y - TOP) / (decaySteps * STEP))
    );
  };
};

/**
 * Вертикали расходятся книзу: крайние уходят на `share` шага наружу у низа и
 * внутрь у верха.
 *
 * @param share — отход крайних вертикалей в долях шага
 * @returns изгиб вертикальных линий
 */
const toDivergence = (share: number): SyntheticField => {
  return (x, y) => {
    return (
      share *
      STEP *
      ((x - WIDTH / 2) / (WIDTH / 2 - 180)) *
      ((y - HEIGHT / 2) / (HEIGHT / 2 - TOP))
    );
  };
};

/**
 * Верх первой нарисованной линии у левого края кадра: линия рисуется, если
 * центр прямой линии не выше верхней границы разлиновки.
 *
 * @param params — лист
 * @returns высота первой линии в столбце 0
 */
const toFirstLineTop = (params: SyntheticSheetParams): number => {
  const top = params.margins?.top || 0;
  const { bend: _bend, ...straight } = params;
  const index = Array.from({ length: 20 }, (_item, offset) => {
    return offset - 5;
  }).find((line) => {
    return computeSyntheticLineY(straight, line, 0) >= top - 0.5;
  });

  return computeSyntheticLineY(params, index || 0, 0);
};

/**
 * Правое поле по самому внутреннему положению крайней вертикали в области с
 * горизонтальными линиями.
 *
 * @param params — лист
 * @returns правое поле кадра с зазором
 */
const toRightMargin = (params: SyntheticSheetParams): number => {
  const lastColumn = Math.floor((WIDTH - RIGHT_COLUMNS - PHASE) / STEP);
  let innermost = WIDTH;

  for (let y = TOP; y <= HEIGHT - BOTTOM; y += 5) {
    innermost = Math.min(innermost, computeSyntheticColumnX(params, lastColumn, y));
  }

  return WIDTH - innermost + EDGE_GAP;
};

const measure = (params: SyntheticSheetParams) => {
  return measureSheetPhoto(createSyntheticSheet(params), { kind: 'grid' });
};

describe('measureSheetPhoto: границы разлиновки трассой вдоль линий', () => {
  /**
   * Углы проверенного диапазона сценария «Волна у края листа»: 0,4 шага с
   * затуханием за 20 шагов и 0,45 шага за 15.
   */
  it.each([
    { name: 'без перспективы', amplitude: 0.4, decaySteps: 20, drift: 0 },
    { name: 'с дрейфом 4,4 %', amplitude: 0.4, decaySteps: 20, drift: DRIFT },
    { name: 'без перспективы', amplitude: 0.45, decaySteps: 15, drift: 0 },
    { name: 'с дрейфом 4,4 %', amplitude: 0.45, decaySteps: 15, drift: DRIFT },
  ])(
    'волна у верха листа $amplitude шага за $decaySteps шагов: первая строка — на первой линии ($name)',
    ({ amplitude, decaySteps, drift }) => {
      const params: SyntheticSheetParams = {
        ...BASE_SHEET,
        bend: toTopWave(amplitude, decaySteps),
        rulingPerspective: drift ? toDriftPerspective(drift) : null,
      };
      const { source } = measure(params);

      expect(source.margins?.top).toBeGreaterThan(0);
      expect(
        Math.abs(readFirstTextLineY(source, FRAME) - toFirstLineTop(params))
      ).toBeLessThan(TOLERANCE);
    }
  );

  it('расходящиеся вертикали: правое поле — по самой внутренней точке крайней', () => {
    const params: SyntheticSheetParams = {
      ...BASE_SHEET,
      columnBend: toDivergence(0.45),
      rulingPerspective: toDriftPerspective(DRIFT),
    };
    const { source } = measure(params);

    expect(source.perspective).not.toBeNull();
    expect(Math.abs((source.margins?.right || 0) - toRightMargin(params))).toBeLessThan(
      TOLERANCE
    );
  });

  it('первая линия у края вырезки под наклонной стороной листа: над ней бумага без линий, первая строка — на ней', () => {
    const params: SyntheticSheetParams = {
      ...BASE_SHEET,
      margins: { top: 120, right: 140, bottom: BOTTOM, left: 150 },
    };
    const { source } = measure(params);

    expect(source.margins?.top).toBeGreaterThan(0);
    expect(
      Math.abs(readFirstTextLineY(source, FRAME) - toFirstLineTop(params))
    ).toBeLessThan(TOLERANCE);
  });

  it('разлиновка до края листа: край вырезки у наклонной стороны не становится полем', () => {
    const params: SyntheticSheetParams = {
      ...BASE_SHEET,
      margins: { top: 0, right: 140, bottom: BOTTOM, left: 150 },
    };
    const { source } = measure(params);

    expect(source.margins?.top).toBe(0);
  });
});
