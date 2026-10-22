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
import { liftDetectedTopMargin } from '@pages/Generator/lib/paper/sheetRuling';
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

  it('верхнее поле фолбэка — линия над первой линией не выше полутора шагов', () => {
    const ruling = buildSheetRuling({ ...buildDetection(), skewAngle: 0 }, FRAME);
    const fallback = STEP * MARGIN_FALLBACK_STEPS;

    /**
     * Первая строка — первая линия, лежащая не выше полутора шагов от края: она
     * не выше фолбэка, а линия над ней — уже выше него. Поле — эта линия над
     * первой строкой: граница области письма, под которой встаёт текст.
     */
    expect(measureLineDrift(ruling.margins.top)).toBeLessThan(1e-9);
    expect(ruling.margins.top + STEP).toBeGreaterThanOrEqual(fallback);
    expect(ruling.margins.top).toBeLessThan(fallback);
    expect(resolveFirstLine(ruling)).toBeCloseTo(ruling.margins.top + STEP, 9);
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
    expect(ruling.margins.top + STEP).toBeGreaterThanOrEqual(fallback);
    expect(measureLineDrift(ruling.margins.top)).toBeLessThan(1e-9);
  });

  it('при фолбэке первая строка садится на линию разлиновки', () => {
    const ruling = buildSheetRuling({ ...buildDetection(), skewAngle: 0 }, FRAME);
    const firstLine = resolveFirstLine(ruling);

    expect(measureLineDrift(firstLine)).toBeLessThanOrEqual(DRIFT_TOLERANCE);
    expect(firstLine).toBeGreaterThanOrEqual(STEP * MARGIN_FALLBACK_STEPS);
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
    expect(ruling.margins.top).toBe(73.5);
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
    expect(ruling.margins.top + STEP).toBeGreaterThanOrEqual(BOUNDS.top + fallback);
    expect(ruling.margins.top).toBeLessThan(BOUNDS.top + fallback);
    expect(measureLineDrift(ruling.margins.top)).toBeLessThan(1e-9);
    expect(ruling.outline).toEqual(OUTLINE);
  });

  it('при перспективе верхнее поле фолбэком стоит на линии над первой строкой', () => {
    const ruling = buildSheetRuling(
      { ...buildDetection(), skewAngle: SKEW_ANGLE, perspective: PERSPECTIVE },
      FRAME
    );
    const top = toLineCoordinate(0, ruling.margins.top, SKEW_ANGLE);
    const fallbackTop = toLineCoordinate(0, 0, SKEW_ANGLE) + STEP * MARGIN_FALLBACK_STEPS;
    const lines = (top - PHASE) / STEP;

    expect(Math.abs(lines - Math.round(lines))).toBeLessThan(1e-6);
    expect(top + STEP).toBeGreaterThanOrEqual(fallbackTop - 1e-9);
    expect(top).toBeLessThan(fallbackTop);
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
  it('лежит ниже верхнего поля на ближайшей линии, если поле между линиями', () => {
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ margins: { top: 100, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );

    expect(resolveFirstLine(ruling)).toBe(133);
  });

  it('у поля, стоящего на линии, — следующая линия: тело букв встаёт под поле', () => {
    const ruling = buildSheetRuling(
      {
        ...buildDetection({ margins: { top: 133, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );

    expect(resolveFirstLine(ruling)).toBe(173);
  });

  /**
   * Шаг подобран так, что `(top − phase) / step` выходит 6,999999999999999, а не
   * 7: без допуска округления строка осталась бы на линии самого поля.
   */
  it('не перепрыгивает через линию из-за погрешности вычислений', () => {
    const step = 40.1;
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

    expect(resolveFirstLine(ruling)).toBeCloseTo(phase + 8 * step, 9);
  });
});

describe('верхнее поле, найденное детектором', () => {
  it('ложится на линию над найденной: первая строка остаётся на найденной линии', () => {
    const source = liftDetectedTopMargin(
      {
        ...buildDetection({ margins: { top: 133, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );
    const ruling = buildSheetRuling(source, FRAME);

    expect(ruling.margins.top).toBe(93);
    expect(resolveFirstLine(ruling)).toBe(133);
  });

  it('поле между линиями отдаёт первую строку ближайшей линии ниже, а само ложится шагом выше', () => {
    const source = liftDetectedTopMargin(
      {
        ...buildDetection({ margins: { top: 120, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );
    const ruling = buildSheetRuling(source, FRAME);

    expect(ruling.margins.top).toBe(93);
    expect(resolveFirstLine(ruling)).toBe(133);
  });

  it('при наклоне и перспективе поднимает поле ровно на шаг вдоль линий', () => {
    const detectedTop = 500;
    const detectedLine = Math.ceil(
      (toLineCoordinate(0, detectedTop, SKEW_ANGLE) - PHASE) / STEP
    );
    const source = liftDetectedTopMargin(
      {
        ...buildDetection({
          margins: { top: detectedTop, right: 60, bottom: 60, left: 60 },
          perspective: PERSPECTIVE,
        }),
        skewAngle: SKEW_ANGLE,
      },
      FRAME
    );
    const ruling = buildSheetRuling(source, FRAME);

    expect(toLineCoordinate(0, ruling.margins.top, SKEW_ANGLE)).toBeCloseTo(
      PHASE + (detectedLine - 1) * STEP,
      6
    );
    expect(resolveFirstLine(ruling)).toBeCloseTo(PHASE + detectedLine * STEP, 6);
  });

  it('у первой линии ближе шага к верху кадра встаёт между верхом и ней, не за край', () => {
    const source = liftDetectedTopMargin(
      {
        ...buildDetection({ margins: { top: PHASE, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
      },
      FRAME
    );
    const ruling = buildSheetRuling(source, FRAME);

    expect(ruling.margins.top).toBe((1 + PHASE) / 2);
    expect(resolveFirstLine(ruling)).toBe(PHASE);
  });

  /**
   * Линия над первой лежит в полупикселе от верха кадра: поле на ней вышло бы
   * меньше пикселя, а такое поле редактор разметки не принимает.
   */
  it('не ставит поле ближе пикселя к верху кадра', () => {
    const source = liftDetectedTopMargin(
      {
        ...buildDetection({
          firstLinePhase: 0.5,
          margins: { top: 40.5, right: 60, bottom: 60, left: 60 },
        }),
        skewAngle: 0,
      },
      FRAME
    );
    const ruling = buildSheetRuling(source, FRAME);

    expect(ruling.margins.top).toBe((1 + 40.5) / 2);
    expect(resolveFirstLine(ruling)).toBe(40.5);
  });

  it('у первой линии ближе шага к верху листа встаёт между верхом листа и ней, не на стол', () => {
    const source = liftDetectedTopMargin(
      {
        ...buildDetection({ margins: { top: 93, right: 60, bottom: 60, left: 60 } }),
        skewAngle: 0,
        outline: OUTLINE,
      },
      FRAME
    );
    const ruling = buildSheetRuling(source, FRAME);

    expect(ruling.margins.top).toBe((BOUNDS.top + 93) / 2);
    expect(resolveFirstLine(ruling)).toBe(93);
  });

  it('ненайденное поле оставляет нулём: его ставит фолбэк', () => {
    const source = { ...buildDetection(), skewAngle: 0 };

    expect(liftDetectedTopMargin(source, FRAME)).toBe(source);
  });
});
