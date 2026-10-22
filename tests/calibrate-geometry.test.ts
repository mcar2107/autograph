import type { SheetCalibration } from '@pages/Generator/lib/calibrate';
import {
  deriveGeometry,
  deriveTextHeight,
  GRID_ROW_STEPS,
} from '@pages/Generator/lib/calibrate';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import type { SheetRuling } from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

import { getBaselineY, getLineStep } from './helpers/baseline-model';

/**
 * Лист в линейку с линией поля слева: линия правее левого поля, блок
 * отсчитывается от неё.
 */
const LINE_LEFT: SheetCalibration = {
  kind: 'lined',
  width: 1600,
  height: 2000,
  ruling: {
    step: 40,
    firstLinePhase: 0,
    skewAngle: 0,
    margins: { top: 80, right: 40, bottom: 60, left: 30 },
    marginLineX: 60,
    marginLineSide: 'left',
    sideSlant: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
};

/**
 * Лист в линейку с линией поля справа, как у пресет-пака: правый край блока
 * упирается не в поле, а в линию.
 */
const LINE_RIGHT: SheetCalibration = {
  kind: 'lined',
  width: 1600,
  height: 2050,
  ruling: {
    step: 53.7,
    firstLinePhase: 21.4,
    skewAngle: 0,
    margins: { top: 128.8, right: 30, bottom: 70, left: 70 },
    marginLineX: 1450,
    marginLineSide: 'right',
    sideSlant: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
};

/**
 * Лист в клетку без линии поля.
 */
const NO_LINE: SheetCalibration = {
  kind: 'grid',
  width: 1500,
  height: 2100,
  ruling: {
    step: 25,
    firstLinePhase: 0,
    skewAngle: 0,
    margins: { top: 75, right: 60, bottom: 50, left: 50 },
    marginLineX: null,
    marginLineSide: null,
    sideSlant: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
};

/**
 * Лист, у которого верхнее поле не лежит на линии: первая линия строго ниже
 * поля — `13 + (floor((100 − 13) / 40) + 1) · 40 = 133`.
 */
const OFF_PHASE: SheetCalibration = {
  kind: 'lined',
  width: 1600,
  height: 2000,
  ruling: {
    step: 40,
    firstLinePhase: 13,
    skewAngle: 0,
    margins: { top: 100, right: 40, bottom: 60, left: 60 },
    marginLineX: null,
    marginLineSide: null,
    sideSlant: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
};

const OFF_PHASE_FIRST_LINE = 133;

/**
 * Чистый лист: линий нет, шаг задал пользователь.
 */
const BLANK: SheetCalibration = {
  kind: 'blank',
  width: 1400,
  height: 1900,
  ruling: {
    step: 48,
    firstLinePhase: 0,
    skewAngle: 0,
    margins: { top: 96, right: 60, bottom: 60, left: 70 },
    marginLineX: null,
    marginLineSide: null,
    sideSlant: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
};

/**
 * Метрики рукописного шрифта: подъём строчного бокса заметно выше подъёма
 * чернил и высоты строчных. Расхождение намеренное — на нём видно, если
 * верхний отступ посчитан не от бокса.
 */
const METRICS: FontMetrics = { xHeight: 0.48, fontAscent: 0.95, lineHeight: 1.25 };

/**
 * Допустимое отклонение базовой линии от линии разлиновки — десятая доля
 * шага, как в требовании.
 */
const DRIFT_SHARE = 0.1;

/**
 * Погрешность сравнения пикселей: складываются дробные шаги.
 */
const PX_EPSILON = 1e-9;

/**
 * Лист с подменённой разлиновкой.
 *
 * @param sheet — исходный лист
 * @param patch — поля разлиновки, которые нужно заменить
 * @returns лист с новой разлиновкой
 */
const withRuling = (
  sheet: SheetCalibration,
  patch: Partial<SheetRuling>
): SheetCalibration => {
  return { ...sheet, ruling: { ...sheet.ruling, ...patch } };
};

/**
 * Линия разлиновки, на которую должна лечь строка с этим номером. Первая
 * линия считается здесь заново, а не берётся из кода: первая линия строго ниже
 * верхнего поля.
 *
 * @param sheet — лист страницы
 * @param lineIndex — номер строки от нуля
 * @param rowSteps — сколько шагов разлиновки занимает строка
 * @returns высота линии в пикселях кадра
 */
const getRulingLineY = (
  sheet: SheetCalibration,
  lineIndex: number,
  rowSteps: number
): number => {
  const { step, firstLinePhase, margins } = sheet.ruling;
  const firstLine =
    firstLinePhase +
    (Math.floor((margins.top - firstLinePhase) / step + PX_EPSILON) + 1) * step;

  return firstLine + lineIndex * step * rowSteps;
};

/**
 * Наибольшее отклонение базовых линий от разлиновки на первых строках.
 *
 * @param sheet — лист страницы
 * @param metrics — метрики шрифта
 * @param rowSteps — сколько шагов разлиновки занимает строка
 * @returns отклонение в пикселях
 */
const getMaxDrift = (
  sheet: SheetCalibration,
  metrics: FontMetrics,
  rowSteps: number
): number => {
  const geometry = deriveGeometry(sheet, metrics);
  let maxDrift = 0;

  for (let lineIndex = 0; lineIndex < 8; lineIndex += 1) {
    const drift = Math.abs(
      getBaselineY(geometry, metrics, lineIndex) -
        getRulingLineY(sheet, lineIndex, rowSteps)
    );

    maxDrift = Math.max(maxDrift, drift);
  }

  return maxDrift;
};

describe('deriveGeometry: границы блока из стороны линии поля', () => {
  it('линия слева: блок начинается за линией и доходит до правого поля', () => {
    const { ruling, width } = LINE_LEFT;
    const geometry = deriveGeometry(LINE_LEFT, METRICS);

    expect(geometry.leftPadding - (ruling.marginLineX || 0)).toBeGreaterThanOrEqual(
      ruling.step / 5 - PX_EPSILON
    );
    expect(geometry.leftPadding).toBeLessThan((ruling.marginLineX || 0) + ruling.step);
    expect(geometry.leftPadding + geometry.blockWidth).toBeCloseTo(
      width - ruling.margins.right,
      9
    );
  });

  it('линия справа: блок начинается от левого поля и не доходит до линии', () => {
    const { ruling } = LINE_RIGHT;
    const geometry = deriveGeometry(LINE_RIGHT, METRICS);
    const blockRight = geometry.leftPadding + geometry.blockWidth;

    expect(geometry.leftPadding).toBeCloseTo(ruling.margins.left, 9);
    expect((ruling.marginLineX || 0) - blockRight).toBeGreaterThanOrEqual(
      ruling.step / 5 - PX_EPSILON
    );
    expect((ruling.marginLineX || 0) - blockRight).toBeLessThan(ruling.step);
  });

  it('линии нет: блок стоит между полями', () => {
    const { ruling, width } = NO_LINE;
    const geometry = deriveGeometry(NO_LINE, METRICS);

    expect(geometry.leftPadding).toBe(ruling.margins.left);
    expect(geometry.blockWidth).toBeCloseTo(
      width - ruling.margins.left - ruling.margins.right,
      9
    );
  });

  it('блок не заходит за поля, даже если линия поля лежит внутри поля', () => {
    const left = deriveGeometry(withRuling(LINE_LEFT, { marginLineX: 10 }), METRICS);
    const right = deriveGeometry(withRuling(LINE_RIGHT, { marginLineX: 1590 }), METRICS);

    expect(left.leftPadding).toBeGreaterThanOrEqual(LINE_LEFT.ruling.margins.left);
    expect(right.leftPadding + right.blockWidth).toBeLessThanOrEqual(
      LINE_RIGHT.width - LINE_RIGHT.ruling.margins.right + PX_EPSILON
    );
  });
});

describe('deriveGeometry: первая строка на линии', () => {
  it('поле не кратно фазе: базовая линия на первой линии ниже поля', () => {
    const { ruling } = OFF_PHASE;
    const geometry = deriveGeometry(OFF_PHASE, METRICS);
    const baseline = getBaselineY(geometry, METRICS, 0);
    const phaseRemainder =
      (((baseline - ruling.firstLinePhase) % ruling.step) + ruling.step) % ruling.step;

    expect(baseline).toBeCloseTo(OFF_PHASE_FIRST_LINE, 9);
    expect(Math.min(phaseRemainder, ruling.step - phaseRemainder)).toBeLessThan(1e-6);
    expect(baseline).toBeGreaterThan(ruling.margins.top);
    expect(baseline - ruling.margins.top).toBeLessThan(ruling.step);
    expect(getMaxDrift(OFF_PHASE, METRICS, 1)).toBeLessThanOrEqual(
      DRIFT_SHARE * ruling.step
    );
  });

  it('поле ровно на линии: первая строка — на следующей линии, под полем', () => {
    const { ruling } = LINE_LEFT;
    const geometry = deriveGeometry(LINE_LEFT, METRICS);

    expect(getBaselineY(geometry, METRICS, 0)).toBeCloseTo(
      ruling.margins.top + ruling.step,
      9
    );
  });

  it('сажает базовые линии на разлиновку', () => {
    expect(getMaxDrift(LINE_LEFT, METRICS, 1)).toBeLessThanOrEqual(
      DRIFT_SHARE * LINE_LEFT.ruling.step
    );
    expect(getMaxDrift(LINE_RIGHT, METRICS, 1)).toBeLessThanOrEqual(
      DRIFT_SHARE * LINE_RIGHT.ruling.step
    );
  });

  it('на других метриках шрифта меняет кегль, сохраняя попадание', () => {
    const narrow: FontMetrics = { xHeight: 0.35, fontAscent: 1.08, lineHeight: 1.45 };
    const base = deriveGeometry(OFF_PHASE, METRICS);
    const other = deriveGeometry(OFF_PHASE, narrow);

    expect(other.fontSizePx).not.toBeCloseTo(base.fontSizePx, 3);
    expect(getMaxDrift(OFF_PHASE, narrow, 1)).toBeLessThanOrEqual(
      DRIFT_SHARE * OFF_PHASE.ruling.step
    );
  });

  it('верхний отступ отсчитан от подъёма бокса, а не от чернил', () => {
    const geometry = deriveGeometry(OFF_PHASE, METRICS);

    expect(geometry.topOffset).toBeCloseTo(
      OFF_PHASE_FIRST_LINE - METRICS.fontAscent * geometry.fontSizePx,
      9
    );
  });
});

describe('deriveGeometry: строчный бокс', () => {
  it('высота строчных занимает принятую долю шага разлиновки', () => {
    const geometry = deriveGeometry(LINE_LEFT, METRICS);
    const xHeightPx = geometry.fontSizePx * METRICS.xHeight;

    expect(xHeightPx).toBeGreaterThan(0.4 * LINE_LEFT.ruling.step);
    expect(xHeightPx).toBeLessThan(0.7 * LINE_LEFT.ruling.step);
  });

  it('на листе в клетку строка занимает две клетки', () => {
    const geometry = deriveGeometry(NO_LINE, METRICS);

    expect(getLineStep(geometry, METRICS)).toBeCloseTo(
      GRID_ROW_STEPS * NO_LINE.ruling.step,
      9
    );
    expect(getMaxDrift(NO_LINE, METRICS, GRID_ROW_STEPS)).toBeLessThanOrEqual(
      DRIFT_SHARE * NO_LINE.ruling.step
    );
  });

  it('на чистом листе строка занимает заданный пользователем шаг', () => {
    const geometry = deriveGeometry(BLANK, METRICS);

    expect(getLineStep(geometry, METRICS)).toBeCloseTo(BLANK.ruling.step, 9);
    expect(getMaxDrift(BLANK, METRICS, 1)).toBeLessThanOrEqual(
      DRIFT_SHARE * BLANK.ruling.step
    );
  });

  it('без шага разлиновки отдаёт рабочую геометрию, а не ноль', () => {
    const geometry = deriveGeometry(withRuling(BLANK, { step: 0 }), METRICS);

    expect(geometry.fontSizePx).toBeGreaterThan(0);
    expect(Number.isFinite(geometry.topOffset)).toBe(true);
    expect(getLineStep(geometry, METRICS)).toBeGreaterThan(0);
  });

  it('листы с разным шагом дают разный кегль в отношении шагов', () => {
    const narrow = deriveGeometry(LINE_LEFT, METRICS);
    const wide = deriveGeometry(LINE_RIGHT, METRICS);

    expect(wide.fontSizePx / narrow.fontSizePx).toBeCloseTo(
      LINE_RIGHT.ruling.step / LINE_LEFT.ruling.step,
      9
    );
  });

  it('на нулевой высоте строчных не отдаёт мусор', () => {
    const broken: FontMetrics = { xHeight: 0, fontAscent: 0.95, lineHeight: 1.25 };
    const geometry = deriveGeometry(LINE_LEFT, broken);

    expect(Number.isFinite(geometry.fontSizePx)).toBe(true);
    expect(geometry.fontSizePx).toBeGreaterThan(0);
  });
});

describe('deriveGeometry: поправка в долях шага', () => {
  it('применяет поправку поверх вычисленного, переводя доли в пиксели листа', () => {
    const { step } = LINE_LEFT.ruling;
    const base = deriveGeometry(LINE_LEFT, METRICS);
    const corrected = deriveGeometry(LINE_LEFT, METRICS, {
      fontSizePx: 0.1,
      lineSpacing: 0.05,
      topOffset: -0.25,
      leftPadding: 0.5,
      blockWidth: -1,
    });

    expect(corrected.fontSizePx).toBeCloseTo(base.fontSizePx + 0.1 * step, 9);
    expect(corrected.lineSpacing).toBeCloseTo(base.lineSpacing + 0.05 * step, 9);
    expect(corrected.topOffset).toBeCloseTo(base.topOffset - 0.25 * step, 9);
    expect(corrected.leftPadding).toBeCloseTo(base.leftPadding + 0.5 * step, 9);
    expect(corrected.blockWidth).toBeCloseTo(base.blockWidth - step, 9);
  });

  it('одна и та же поправка на листах с разным шагом сдвигает на одну долю шага', () => {
    const correction = { topOffset: 0.75, leftPadding: -0.5 };

    for (const sheet of [LINE_LEFT, LINE_RIGHT, NO_LINE]) {
      const { step } = sheet.ruling;
      const base = deriveGeometry(sheet, METRICS);
      const corrected = deriveGeometry(sheet, METRICS, correction);

      expect((corrected.topOffset - base.topOffset) / step).toBeCloseTo(0.75, 9);
      expect((corrected.leftPadding - base.leftPadding) / step).toBeCloseTo(-0.5, 9);
    }
  });

  it('пустая поправка ничего не меняет', () => {
    expect(deriveGeometry(LINE_LEFT, METRICS, {})).toEqual(
      deriveGeometry(LINE_LEFT, METRICS)
    );
  });

  it('поправка не уводит кегль в ноль и в минус', () => {
    const zeroed = deriveGeometry(LINE_LEFT, METRICS, { fontSizePx: -2 });
    const negative = deriveGeometry(LINE_LEFT, METRICS, { fontSizePx: -100 });

    expect(zeroed.fontSizePx).toBeGreaterThan(0);
    expect(negative.fontSizePx).toBeGreaterThan(0);
  });

  it('поправка не уводит ширину блока в минус', () => {
    const geometry = deriveGeometry(LINE_LEFT, METRICS, { blockWidth: -10_000 });

    expect(geometry.blockWidth).toBe(0);
  });
});

describe('deriveTextHeight', () => {
  it('высота под текст — кадр без верхнего отступа, нижнего поля и запаса в шагах', () => {
    const { ruling, height } = LINE_RIGHT;
    const geometry = deriveGeometry(LINE_RIGHT, METRICS);

    expect(deriveTextHeight(LINE_RIGHT, geometry, 0)).toBeCloseTo(
      height - geometry.topOffset - ruling.margins.bottom,
      9
    );
    expect(deriveTextHeight(LINE_RIGHT, geometry, 2.5)).toBeCloseTo(
      height - geometry.topOffset - ruling.margins.bottom - 2.5 * ruling.step,
      9
    );
  });
});
