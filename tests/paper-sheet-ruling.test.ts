import type {
  RulingDetection,
  RulingPerspective,
  SheetOutline,
} from '@pages/Generator/lib/paper';
import {
  buildSheetRuling,
  MARGIN_FALLBACK_STEPS,
  resolveFirstLine,
} from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

/**
 * Шаг и фаза не кратны друг другу и полуторам шагам: иначе фолбэк верхнего поля
 * совпал бы с линией и без округления.
 */
const STEP = 40;
const PHASE = 13;
const SKEW_ANGLE = -0.9;

/**
 * Допуск попадания базовой линии на линию разлиновки в долях шага — из
 * требования «Фолбэк не сбивает строки с линий».
 */
const DRIFT_TOLERANCE = 0.1;

const NO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Кадр фотографии: от его сторон отсчитывается фолбэк полей на листе во весь
 * кадр.
 */
const FRAME = { width: 1600, height: 2000 };

/**
 * Контур листа на столе: стороны несимметричны, чтобы фолбэк, отсчитанный от
 * края кадра, не совпал случайно с фолбэком от стороны листа.
 */
const OUTLINE: SheetOutline = {
  topLeft: { x: 120, y: 90 },
  topRight: { x: 1480, y: 70 },
  bottomRight: { x: 1450, y: 1900 },
  bottomLeft: { x: 140, y: 1930 },
};

/**
 * Стороны прямоугольника, вписанного в `OUTLINE`, отступами от краёв кадра:
 * внутренний из двух углов каждой стороны. Записаны числами, а не вызовом
 * `resolveSheetBounds`, чтобы тест не подтверждал одну формулу другой.
 */
const BOUNDS = { top: 90, right: 150, bottom: 100, left: 140 };

/**
 * Дрейф шага и схождение линий на половине кадра. Шесть процентов — порядок
 * реального снимка с руки: на краю кадра шаг отличается от середины на десятую.
 */
const DRIFT_SHARE = 0.06;

const PERSPECTIVE: RulingPerspective = {
  originX: FRAME.width / 2,
  originY: FRAME.height / 2,
  convergenceX: DRIFT_SHARE / (FRAME.width / 2),
  convergenceY: DRIFT_SHARE / (FRAME.height / 2),
};

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Координата вдоль линий по формуле design («Перспектива — дробно-линейная
 * координата вдоль линий»), записанной здесь заново: иначе тест сверял бы
 * сборку разлиновки с тем же модулем, которым она посчитана.
 */
const toLineCoordinate = (x: number, y: number, skewAngle: number): number => {
  const { originX, originY, convergenceX, convergenceY } = PERSPECTIVE;
  const tilt = Math.tan(skewAngle / DEGREES_IN_RADIAN);
  const weight = 1 + convergenceX * (x - originX) + convergenceY * (y - originY);

  return originY - originX * tilt + (y - originY - (x - originX) * tilt) / weight;
};

const buildDetection = (patch: Partial<RulingDetection> = {}): RulingDetection => {
  return {
    isDetected: true,
    step: STEP,
    firstLinePhase: PHASE,
    kind: 'lined',
    margins: NO_MARGINS,
    marginLineX: null,
    marginLineSide: null,
    bend: null,
    perspective: null,
    confidence: 0.9,
    ...patch,
  };
};

/**
 * Расстояние от точки до ближайшей линии разлиновки `PHASE + k * STEP` в долях
 * шага. Считается перебором линий, а не формулой первой линии, чтобы тест не
 * подтверждал формулу ею же.
 */
const measureLineDrift = (y: number): number => {
  let drift = Number.POSITIVE_INFINITY;

  for (let index = -2; index < 100; index += 1) {
    drift = Math.min(drift, Math.abs(y - (PHASE + index * STEP)));
  }

  return drift / STEP;
};

describe('сборка разлиновки экземпляра из результата детектора', () => {
  it('без найденных полей отступает полтора шага от каждого края', () => {
    const detection = buildDetection();
    const ruling = buildSheetRuling({ ...detection, skewAngle: SKEW_ANGLE }, FRAME);
    const fallback = STEP * MARGIN_FALLBACK_STEPS;

    expect(MARGIN_FALLBACK_STEPS).toBe(1.5);
    expect(ruling.margins.right).toBe(fallback);
    expect(ruling.margins.bottom).toBe(fallback);
    expect(ruling.margins.left).toBe(fallback);
    expect(ruling.marginLineX).toBeNull();
    expect(ruling.marginLineSide).toBeNull();
    expect(ruling.step).toBe(STEP);
    expect(ruling.firstLinePhase).toBe(PHASE);
    expect(ruling.skewAngle).toBe(SKEW_ANGLE);
  });

  it('верхнее поле фолбэка округляет вверх до ближайшей линии не выше полутора шагов', () => {
    const ruling = buildSheetRuling({ ...buildDetection(), skewAngle: 0 }, FRAME);
    const fallback = STEP * MARGIN_FALLBACK_STEPS;

    /**
     * Верхнее поле — первая линия, лежащая не выше полутора шагов от края: она
     * не выше фолбэка, а предыдущая линия — уже выше него.
     */
    expect(measureLineDrift(ruling.margins.top)).toBeLessThan(1e-9);
    expect(ruling.margins.top).toBeGreaterThanOrEqual(fallback);
    expect(ruling.margins.top - STEP).toBeLessThan(fallback);
  });

  it('найденные поля и линию поля со стороной берёт как есть', () => {
    const margins = { top: 133, right: 90, bottom: 150, left: 70 };
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ margins, marginLineX: 1400, marginLineSide: 'right' }),
        skewAngle: SKEW_ANGLE,
      },
      FRAME
    );

    expect(ruling).toEqual({
      step: STEP,
      firstLinePhase: PHASE,
      skewAngle: SKEW_ANGLE,
      margins,
      marginLineX: 1400,
      marginLineSide: 'right',
      sideSlant: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    });
  });

  it('фолбэк применяет к каждой стороне отдельно: одна сторона найдена, остальные нули', () => {
    const ruling = buildSheetRuling(
      { ...buildDetection({ margins: { ...NO_MARGINS, left: 210 } }), skewAngle: 0 },
      FRAME
    );
    const fallback = STEP * MARGIN_FALLBACK_STEPS;

    expect(ruling.margins.left).toBe(210);
    expect(ruling.margins.right).toBe(fallback);
    expect(ruling.margins.bottom).toBe(fallback);
    expect(ruling.margins.top).toBeGreaterThanOrEqual(fallback);
    expect(measureLineDrift(ruling.margins.top)).toBeLessThan(1e-9);
  });

  it('при фолбэке первая строка садится на линию разлиновки', () => {
    const ruling = buildSheetRuling({ ...buildDetection(), skewAngle: 0 }, FRAME);
    const firstLine = resolveFirstLine(ruling);

    expect(measureLineDrift(firstLine)).toBeLessThanOrEqual(DRIFT_TOLERANCE);
    expect(firstLine).toBeGreaterThanOrEqual(ruling.margins.top);
  });

  it('линию поля без стороны считает отсутствующей', () => {
    const ruling = buildSheetRuling(
      { ...buildDetection({ marginLineX: 300 }), skewAngle: 0 },
      FRAME
    );

    expect(ruling.marginLineX).toBeNull();
    expect(ruling.marginLineSide).toBeNull();
  });

  it('собирает разлиновку из записи прежней формы: поля фолбэком', () => {
    const ruling = buildSheetRuling(
      { step: 64, firstLinePhase: 73.5, skewAngle: -1.4 },
      FRAME
    );

    expect(ruling.step).toBe(64);
    expect(ruling.firstLinePhase).toBe(73.5);
    expect(ruling.skewAngle).toBe(-1.4);
    expect(ruling.margins.left).toBe(96);
    expect(ruling.margins.top).toBe(137.5);
    expect(ruling.marginLineX).toBeNull();
  });

  it('повторная сборка готовой разлиновки её не меняет', () => {
    const ruling = buildSheetRuling(
      { ...buildDetection(), skewAngle: SKEW_ANGLE },
      FRAME
    );

    expect(buildSheetRuling(ruling, FRAME)).toEqual(ruling);
  });

  it('без найденного шага оставляет поля нулевыми и не даёт NaN', () => {
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ isDetected: false, step: 0, firstLinePhase: 0 }),
        skewAngle: 0,
      },
      FRAME
    );

    expect(ruling.margins).toEqual(NO_MARGINS);
    expect(Number.isFinite(resolveFirstLine(ruling))).toBe(true);
  });

  it('отступает полтора шага от стороны листа, а не от края кадра', () => {
    const ruling = buildSheetRuling(
      { ...buildDetection(), skewAngle: 0, outline: OUTLINE },
      FRAME
    );
    const fallback = STEP * MARGIN_FALLBACK_STEPS;

    expect(ruling.margins.left).toBe(BOUNDS.left + fallback);
    expect(ruling.margins.right).toBe(BOUNDS.right + fallback);
    expect(ruling.margins.bottom).toBe(BOUNDS.bottom + fallback);
    expect(ruling.margins.top).toBeGreaterThanOrEqual(BOUNDS.top + fallback);
    expect(ruling.margins.top - STEP).toBeLessThan(BOUNDS.top + fallback);
    expect(measureLineDrift(ruling.margins.top)).toBeLessThan(1e-9);
    expect(ruling.outline).toEqual(OUTLINE);
  });

  it('при перспективе верхнее поле фолбэком стоит на линии разлиновки', () => {
    const ruling = buildSheetRuling(
      { ...buildDetection(), skewAngle: SKEW_ANGLE, perspective: PERSPECTIVE },
      FRAME
    );
    const top = toLineCoordinate(0, ruling.margins.top, SKEW_ANGLE);
    const fallbackTop = toLineCoordinate(0, 0, SKEW_ANGLE) + STEP * MARGIN_FALLBACK_STEPS;
    const lines = (top - PHASE) / STEP;

    expect(Math.abs(lines - Math.round(lines))).toBeLessThan(1e-6);
    expect(top).toBeGreaterThanOrEqual(fallbackTop - 1e-9);
    expect(top - STEP).toBeLessThan(fallbackTop);
    expect(ruling.perspective).toEqual(PERSPECTIVE);
  });

  it('без шага отбрасывает перспективу: гребёнки, к которой она отсчитана, нет', () => {
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ isDetected: false, step: 0, firstLinePhase: 0 }),
        skewAngle: 0,
        perspective: PERSPECTIVE,
      },
      FRAME
    );

    expect(ruling.perspective).toBeNull();
  });
});

describe('первая линия разлиновки', () => {
  it('лежит не выше верхнего поля, даже если поле между линиями', () => {
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ margins: { top: 100, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );

    expect(resolveFirstLine(ruling)).toBe(133);
  });

  it('совпадает с полем, которое уже стоит на линии', () => {
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ margins: { top: 133, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );

    expect(resolveFirstLine(ruling)).toBe(133);
  });

  it('не перепрыгивает на следующую линию из-за погрешности вычислений', () => {
    const step = 53.7;
    const phase = 0.3;
    const ruling = buildSheetRuling(
      {
        step,
        firstLinePhase: phase,
        skewAngle: 0,
        margins: { top: phase + 7 * step, right: 60, bottom: 60, left: 60 },
      },
      FRAME
    );

    expect(resolveFirstLine(ruling)).toBeCloseTo(phase + 7 * step, 9);
  });
});
