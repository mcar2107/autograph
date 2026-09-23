import { deriveGeometry, deriveTextHeight } from '@pages/Generator/lib/calibrate';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { PaperFamily, PaperSheet, SheetRuling } from '@pages/Generator/lib/paper';
import {
  getPageCalibration,
  selectBlockGeometry,
  selectBlockSkewAngle,
  selectCalibrationRuling,
} from '@pages/Generator/model/geometrySelectors';
import { selectPageSheetId } from '@pages/Generator/model/recipeSelectors';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { beforeEach, describe, expect, it } from 'vitest';

import { getLineStep } from './helpers/baseline-model';
import { buildSheet } from './helpers/paper-family';

/**
 * Метрики берём запасные, а не измеренные: тест про сложение поправки с
 * вычисленным, и ему нужны одни и те же числа в любом окружении.
 */
const METRICS = FALLBACK_FONT_METRICS;

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Два наклонных листа с разным шагом и разными кадрами: какой бы из них ни
 * достался второй, зеркальной, странице, её разлиновка отражается с поправкой
 * на наклон.
 */
const NARROW_SHEET = buildSheet(
  'narrow',
  {
    step: 40,
    firstLinePhase: 20,
    skewAngle: 0.8,
    margins: { top: 80, right: 60, bottom: 80, left: 60 },
    marginLineX: 1540,
    marginLineSide: 'right',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  { width: 1600, height: 2003 }
);

const WIDE_SHEET = buildSheet(
  'wide',
  {
    step: 55,
    firstLinePhase: 30,
    skewAngle: -1.17,
    margins: { top: 140, right: 70, bottom: 90, left: 80 },
    marginLineX: 1500,
    marginLineSide: 'right',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  { width: 1600, height: 2050 }
);

const FAMILY: PaperFamily = {
  id: 'lined',
  label: 'Линейка',
  kind: 'lined',
  sheets: [NARROW_SHEET, WIDE_SHEET],
};

/**
 * Лист другой семьи: клетка с иным шагом, полями и наклоном, чтобы геометрия
 * после смены семьи не могла совпасть с прежней случайно.
 */
const GRID_SHEET = buildSheet(
  'grid-only',
  {
    step: 53,
    firstLinePhase: 12,
    skewAngle: 0.4,
    margins: { top: 96, right: 80, bottom: 80, left: 80 },
    marginLineX: 1400,
    marginLineSide: 'right',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  { width: 1600, height: 2050 }
);

const GRID_FAMILY: PaperFamily = {
  id: 'grid',
  label: 'Клетка',
  kind: 'grid',
  sheets: [GRID_SHEET],
};

/**
 * Погрешность сравнения пикселей: в отражении участвует тангенс угла.
 */
const PX_DIGITS = 9;

const store = () => {
  return useGeneratorStore.getState();
};

/**
 * Геометрия страницы по текущему состоянию стора.
 *
 * @param pageIndex — номер страницы от нуля
 * @returns геометрия блока в пикселях кадра листа страницы
 */
const geometry = (pageIndex: number) => {
  return selectBlockGeometry(store(), pageIndex, METRICS);
};

/**
 * Лист, который рецепт отдал странице.
 *
 * @param pageIndex — номер страницы от нуля
 * @returns экземпляр листа страницы
 */
const getPageSheet = (pageIndex: number): PaperSheet => {
  const sheetId = selectPageSheetId(store(), pageIndex);
  const sheet = FAMILY.sheets.find((item) => {
    return item.id === sheetId;
  });

  if (!sheet) {
    throw new Error(`Лист страницы не нашёлся: ${sheetId}`);
  }

  return sheet;
};

/**
 * Шаг разлиновки листа страницы.
 *
 * @param pageIndex — номер страницы от нуля
 * @returns шаг в пикселях кадра
 */
const getPageStep = (pageIndex: number): number => {
  return getPageSheet(pageIndex).ruling.step;
};

/**
 * Разлиновка отражённого листа, выписанная по отражению точек линии
 * `(x, y₀ + tanθ·x) → (W − x, y)`: линия, шедшая у правого края, после
 * отражения оказывается у левого, ниже на `tanθ·W`.
 *
 * @param sheet — лист страницы
 * @returns ожидаемая разлиновка зеркальной страницы
 */
const getExpectedMirroredRuling = (sheet: PaperSheet): SheetRuling => {
  const { ruling, width } = sheet;
  const { step, firstLinePhase, skewAngle, margins, marginLineX } = ruling;
  const shift = Math.tan(skewAngle / DEGREES_IN_RADIAN) * width;

  return {
    step,
    firstLinePhase: (((firstLinePhase + shift) % step) + step) % step,
    skewAngle: -skewAngle,
    margins: {
      top: margins.top + shift,
      right: margins.left,
      bottom: margins.bottom - shift,
      left: margins.right,
    },
    marginLineX: marginLineX === null ? null : width - marginLineX,
    marginLineSide: 'left',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  };
};

beforeEach(() => {
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: [FAMILY],
    familyId: FAMILY.id,
    sheetId: NARROW_SHEET.id,
  });
});

describe('геометрия конкретной страницы', () => {
  it('соседним страницам рецепт раздал разные листы', () => {
    expect(getPageSheet(0).id).not.toBe(getPageSheet(1).id);
  });

  it('нечётная страница берёт разлиновку и кадр своего листа как есть', () => {
    const sheet = getPageSheet(0);
    const calibration = selectCalibrationRuling(store(), 0);

    expect(calibration).toEqual({
      ruling: sheet.ruling,
      kind: FAMILY.kind,
      width: sheet.width,
      height: sheet.height,
    });
  });

  it('вторая страница берёт отражённую разлиновку своего наклонного листа', () => {
    const sheet = getPageSheet(1);
    const expected = getExpectedMirroredRuling(sheet);
    const calibration = selectCalibrationRuling(store(), 1);
    const ruling = calibration?.ruling;

    expect(sheet.ruling.skewAngle).not.toBe(0);
    expect(calibration?.width).toBe(sheet.width);
    expect(calibration?.height).toBe(sheet.height);
    expect(ruling?.step).toBe(expected.step);
    expect(ruling?.firstLinePhase).toBeCloseTo(expected.firstLinePhase, PX_DIGITS);
    expect(ruling?.skewAngle).toBeCloseTo(expected.skewAngle, PX_DIGITS);
    expect(ruling?.margins.top).toBeCloseTo(expected.margins.top, PX_DIGITS);
    expect(ruling?.margins.bottom).toBeCloseTo(expected.margins.bottom, PX_DIGITS);
    expect(ruling?.margins.left).toBe(expected.margins.left);
    expect(ruling?.margins.right).toBe(expected.margins.right);
    expect(ruling?.marginLineX).toBe(expected.marginLineX);
    expect(ruling?.marginLineSide).toBe(expected.marginLineSide);
  });

  it('наклон блока берётся из разлиновки страницы, на зеркальной — обратный', () => {
    expect(selectBlockSkewAngle(store(), 0)).toBeCloseTo(
      getPageSheet(0).ruling.skewAngle,
      PX_DIGITS
    );
    expect(selectBlockSkewAngle(store(), 1)).toBeCloseTo(
      -getPageSheet(1).ruling.skewAngle,
      PX_DIGITS
    );
  });

  it('у страниц на листах с разным шагом разный кегль', () => {
    const first = geometry(0);
    const second = geometry(1);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect((second?.fontSizePx || 0) / (first?.fontSizePx || 1)).toBeCloseTo(
      getPageStep(1) / getPageStep(0),
      PX_DIGITS
    );
  });

  it('закреплённый лист встаёт на все страницы, зеркальная его отражает', () => {
    store().selectSheet(WIDE_SHEET.id);

    expect(selectCalibrationRuling(store(), 0)?.ruling).toEqual(WIDE_SHEET.ruling);
    expect(selectCalibrationRuling(store(), 1)?.ruling.marginLineSide).toBe('left');
  });

  it('без семьи считать не по чему', () => {
    useGeneratorStore.setState({ presetFamilies: [] });

    expect(selectCalibrationRuling(store(), 0)).toBeNull();
    expect(geometry(0)).toBeNull();
    expect(selectBlockSkewAngle(store(), 0)).toBe(0);
  });
});

describe('поправка поверх вычисленной геометрии', () => {
  it('складывается с вычисленным в долях шага листа, а не заменяет его', () => {
    const derived = geometry(0);
    const step = getPageStep(0);

    store().setGeometryCorrection({ topOffset: 0.5, blockWidth: -2 });

    expect(geometry(0)?.topOffset).toBeCloseTo((derived?.topOffset || 0) + 0.5 * step);
    expect(geometry(0)?.blockWidth).toBeCloseTo((derived?.blockWidth || 0) - 2 * step);
  });

  it('одна и та же поправка на листах с разным шагом даёт один и тот же сдвиг в долях шага', () => {
    const derived = [geometry(0), geometry(1)];

    store().setGeometryCorrection({
      topOffset: 0.75,
      leftPadding: -0.25,
      fontSizePx: 0.1,
    });

    derived.forEach((base, pageIndex) => {
      const corrected = geometry(pageIndex);
      const step = getPageStep(pageIndex);

      expect(((corrected?.topOffset || 0) - (base?.topOffset || 0)) / step).toBeCloseTo(
        0.75,
        PX_DIGITS
      );
      expect(
        ((corrected?.leftPadding || 0) - (base?.leftPadding || 0)) / step
      ).toBeCloseTo(-0.25, PX_DIGITS);
      expect(((corrected?.fontSizePx || 0) - (base?.fontSizePx || 0)) / step).toBeCloseTo(
        0.1,
        PX_DIGITS
      );
    });
  });

  it('меняет только названную дельту', () => {
    store().setGeometryCorrection({ topOffset: 0.5 });
    store().setGeometryCorrection({ leftPadding: 0.25 });

    expect(store().geometryCorrection.topOffset).toBe(0.5);
    expect(store().geometryCorrection.leftPadding).toBe(0.25);
  });
});

describe('запас снизу', () => {
  it('отнимает одинаковое число строк на листах с разным шагом', () => {
    const reserve = 3;

    store().setGeometry({ bottomMargin: reserve });

    [0, 1].forEach((pageIndex) => {
      const calibration = selectCalibrationRuling(store(), pageIndex);
      const pageGeometry = geometry(pageIndex);

      if (!calibration || !pageGeometry) {
        throw new Error('Страница без геометрии');
      }

      const lineStep = getLineStep(pageGeometry, METRICS);

      const firstBaselineDepth = METRICS.fontAscent * pageGeometry.fontSizePx;

      const countLines = (bottomMargin: number): number => {
        const textHeight = deriveTextHeight(calibration, pageGeometry, bottomMargin);

        return Math.floor((textHeight - firstBaselineDepth) / lineStep) + 1;
      };

      expect(countLines(0) - countLines(store().bottomMargin)).toBe(reserve);
    });
  });
});

describe('поправка при смене листа', () => {
  it('сохраняется при смене экземпляра и применяется к его геометрии', () => {
    store().setGeometryCorrection({ topOffset: 0.5 });
    store().selectSheet(WIDE_SHEET.id);

    const corrected = geometry(0);

    store().resetGeometryCorrection();

    const derived = geometry(0);

    expect(corrected?.topOffset).toBeCloseTo(
      (derived?.topOffset || 0) + 0.5 * WIDE_SHEET.ruling.step
    );
  });

  it('применяется к заново вычисленному после смены семьи', () => {
    useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
    store().selectFamily('lined');

    const derived = geometry(0);
    const step = selectCalibrationRuling(store(), 0)?.ruling.step || 0;

    store().setGeometryCorrection({ topOffset: 0.5 });

    expect(step).toBeGreaterThan(0);
    expect(geometry(0)?.topOffset).toBeCloseTo((derived?.topOffset || 0) + 0.5 * step);
  });
});

describe('смена семьи листов', () => {
  it('пересчитывает геометрию под разлиновку листа новой семьи', () => {
    useGeneratorStore.setState({
      presetFamilies: [FAMILY, GRID_FAMILY],
      familyId: FAMILY.id,
      sheetId: NARROW_SHEET.id,
    });

    const previous = geometry(0);

    store().selectFamily(GRID_FAMILY.id);

    const expected = deriveGeometry(
      getPageCalibration(GRID_FAMILY, GRID_SHEET, 0),
      METRICS,
      store().geometryCorrection
    );

    expect(selectPageSheetId(store(), 0)).toBe(GRID_SHEET.id);
    expect(geometry(0)).not.toEqual(previous);
    expect(geometry(0)).toEqual(expected);
  });
});

describe('сброс поправки', () => {
  it('возвращает геометрию к вычисленной из разлиновки', () => {
    const derived = geometry(1);

    store().setGeometryCorrection({ topOffset: 0.5, fontSizePx: 0.1 });
    store().resetGeometryCorrection();

    expect(geometry(1)).toEqual(derived);
    expect(store().geometryCorrection.topOffset).toBe(0);
  });
});
