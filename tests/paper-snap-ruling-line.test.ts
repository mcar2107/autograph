import type { SheetImageData } from '@pages/Generator/lib/paper';
import { snapToMarginLine, snapToRulingLine } from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

import type { SyntheticSheetParams } from './helpers/synthetic-sheet';
import {
  computeSyntheticLineY,
  computeSyntheticMarginLineX,
  createSyntheticSheet,
} from './helpers/synthetic-sheet';

/**
 * Допуск попадания конца на линию из задачи 2.6, px.
 */
const SNAP_TOLERANCE_PX = 0.5;

/**
 * Отпущенный в пятой доле шага конец магнит обязан притянуть: это внутри окна
 * в треть шага с запасом.
 */
const NEAR_SHARE = 0.2;

/**
 * Линия в 0,4 шага — за окном в треть шага: её склон доходит до края окна,
 * но притягивать она не должна.
 */
const FAR_SHARE = 0.4;

/**
 * Лист линейки с шумом, светом и наклоном, как у живого снимка: магнит
 * проверяется не на идеальном растре.
 */
const LINED_SHEET: SyntheticSheetParams = {
  width: 600,
  height: 800,
  step: 40,
  phase: 20,
  angle: 0.8,
  kind: 'lined',
  margins: { top: 60, right: 60, bottom: 60, left: 90 },
  lineDarkness: 0.3,
  noise: 0.03,
  lighting: 0.2,
  seed: 7,
};

/**
 * Лист на столе: шаг по кадру меняется к верху, и окно магнита меряется
 * шагом, переданным вызывающей стороной, а не шагом листа.
 */
const PERSPECTIVE_SHEET: SyntheticSheetParams = {
  ...LINED_SHEET,
  perspective: 0.2,
  seed: 11,
};

/**
 * Лист с чертой поля: магнит черты до цветового поиска ищет по яркости.
 */
const MARGIN_LINE_SHEET: SyntheticSheetParams = {
  ...LINED_SHEET,
  angle: 0,
  marginLineX: 90,
  seed: 13,
};

const LINED_IMAGE = createSyntheticSheet(LINED_SHEET);

const PERSPECTIVE_IMAGE = createSyntheticSheet(PERSPECTIVE_SHEET);

const MARGIN_LINE_IMAGE = createSyntheticSheet(MARGIN_LINE_SHEET);

/**
 * Номера линий и столбцы, на которых проверяется магнит: у верха, в середине
 * и у низа области, у обоих концов линий и в центре.
 */
const LINE_INDICES = [2, 8, 15];

const COLUMNS = [120, 300, 520];

/**
 * Шаг листа с перспективой в окрестности линии — разность соседних линий в
 * том же столбце.
 *
 * @param params — описание листа
 * @param index — номер линии
 * @param x — столбец
 * @returns местный шаг, px
 */
const computeLocalStep = (params: SyntheticSheetParams, index: number, x: number) => {
  return (
    computeSyntheticLineY(params, index + 1, x) - computeSyntheticLineY(params, index, x)
  );
};

/**
 * Проверяет, что отпущенный в доле шага от линии конец встаёт на неё.
 *
 * @param image — растр листа
 * @param params — описание листа
 * @param share — доля шага от линии со знаком
 */
const expectSnapsOntoLines = (
  image: SheetImageData,
  params: SyntheticSheetParams,
  share: number
) => {
  for (const index of LINE_INDICES) {
    for (const x of COLUMNS) {
      const lineY = computeSyntheticLineY(params, index, x);
      const step = computeLocalStep(params, index, x);
      const snapped = snapToRulingLine(image, { x, y: lineY + share * step }, step);

      expect(snapped).not.toBeNull();
      expect(snapped?.x).toBe(x);
      expect(Math.abs((snapped?.y || 0) - lineY)).toBeLessThanOrEqual(SNAP_TOLERANCE_PX);
    }
  }
};

describe('snapToRulingLine', () => {
  it('отпущенный в 0,2 шага ниже линии конец встаёт на неё ±0,5 px', () => {
    expectSnapsOntoLines(LINED_IMAGE, LINED_SHEET, NEAR_SHARE);
  });

  it('отпущенный в 0,2 шага выше линии конец встаёт на неё ±0,5 px', () => {
    expectSnapsOntoLines(LINED_IMAGE, LINED_SHEET, -NEAR_SHARE);
  });

  it('на листе с перспективой конец встаёт на линию по местному шагу', () => {
    expectSnapsOntoLines(PERSPECTIVE_IMAGE, PERSPECTIVE_SHEET, NEAR_SHARE);
  });

  it('между линиями конец остаётся на месте', () => {
    for (const index of LINE_INDICES) {
      for (const x of COLUMNS) {
        const lineY = computeSyntheticLineY(LINED_SHEET, index, x);
        const point = { x, y: lineY + 0.5 * (LINED_SHEET.step || 0) };

        expect(snapToRulingLine(LINED_IMAGE, point, LINED_SHEET.step || 0)).toBeNull();
      }
    }
  });

  it('линия в 0,4 шага не притягивает', () => {
    for (const share of [FAR_SHARE, -FAR_SHARE]) {
      for (const index of LINE_INDICES) {
        for (const x of COLUMNS) {
          const lineY = computeSyntheticLineY(LINED_SHEET, index, x);
          const point = { x, y: lineY + share * (LINED_SHEET.step || 0) };

          expect(snapToRulingLine(LINED_IMAGE, point, LINED_SHEET.step || 0)).toBeNull();
        }
      }
    }
  });

  it('на листе без линий конец остаётся на месте', () => {
    const blank = createSyntheticSheet({ ...LINED_SHEET, lineDarkness: 0 });

    for (const x of COLUMNS) {
      for (const y of [150, 400, 650]) {
        expect(snapToRulingLine(blank, { x, y }, LINED_SHEET.step || 0)).toBeNull();
      }
    }
  });

  it('точка за кадром и негодный шаг не притягиваются', () => {
    const lineY = computeSyntheticLineY(LINED_SHEET, 8, 300);

    expect(snapToRulingLine(LINED_IMAGE, { x: -5, y: lineY }, 40)).toBeNull();
    expect(snapToRulingLine(LINED_IMAGE, { x: 300, y: 900 }, 40)).toBeNull();
    expect(snapToRulingLine(LINED_IMAGE, { x: 300, y: lineY + 4 }, 0)).toBeNull();
    expect(
      snapToRulingLine(LINED_IMAGE, { x: 300, y: lineY + 4 }, Number.NaN)
    ).toBeNull();
  });
});

describe('snapToMarginLine', () => {
  const step = MARGIN_LINE_SHEET.step || 0;

  it('отпущенная в 0,2 шага от черты поля вертикаль встаёт на неё ±0,5 px', () => {
    for (const y of [200, 400, 600]) {
      const lineX = computeSyntheticMarginLineX(MARGIN_LINE_SHEET, y) || 0;

      for (const share of [NEAR_SHARE, -NEAR_SHARE]) {
        const snapped = snapToMarginLine(
          MARGIN_LINE_IMAGE,
          { x: lineX + share * step, y },
          step
        );

        expect(snapped).not.toBeNull();
        expect(snapped?.y).toBe(y);
        expect(Math.abs((snapped?.x || 0) - lineX)).toBeLessThanOrEqual(
          SNAP_TOLERANCE_PX
        );
      }
    }
  });

  it('черта в 0,4 шага не притягивает, вдали от черты вертикаль остаётся на месте', () => {
    const y = 400;
    const lineX = computeSyntheticMarginLineX(MARGIN_LINE_SHEET, y) || 0;

    for (const x of [lineX + FAR_SHARE * step, lineX - FAR_SHARE * step, 300]) {
      expect(snapToMarginLine(MARGIN_LINE_IMAGE, { x, y }, step)).toBeNull();
    }
  });
});
