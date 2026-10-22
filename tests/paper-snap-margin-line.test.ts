import type { SheetImageData } from '@pages/Generator/lib/paper';
import { snapMarginLine, snapToMarginLine } from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

import type { SyntheticSheetParams } from './helpers/synthetic-sheet';
import {
  computeSyntheticColumnX,
  computeSyntheticMarginLineX,
  createSyntheticSheet,
  GRAY_COLOUR,
  NEUTRAL_COLOUR,
  RED_MARGIN_LINE_COLOUR,
} from './helpers/synthetic-sheet';

/**
 * Допуск попадания на черту из задачи 5.3, px.
 */
const SNAP_TOLERANCE_PX = 0.5;

/**
 * Отпущенная в пятой доле шага вертикаль — внутри окна в треть шага.
 */
const NEAR_SHARE = 0.2;

/**
 * Черта в 0,4 шага — за окном в треть шага.
 */
const FAR_SHARE = 0.4;

/**
 * Строки, в которых отпускается вертикаль: верх, середина и низ области с
 * линиями.
 */
const PROBE_ROWS = [150, 400, 650];

/**
 * Клетка с красной чертой поля между двумя вертикалями, в четверти шага от
 * ближней. Вертикали клетки темнее черты по яркости: красная черта на
 * фотографии бледнее синей клетки, и яркостный магнит у неё уходит на клетку.
 */
const RED_LINE_SHEET: SyntheticSheetParams = {
  width: 600,
  height: 800,
  step: 40,
  phase: 20,
  kind: 'grid',
  margins: { top: 60, right: 60, bottom: 60, left: 60 },
  lineDarkness: 0.4,
  marginLineX: 110,
  marginLineDarkness: 0.2,
  noise: 0.02,
  lighting: 0.2,
  seed: 31,
  colour: RED_MARGIN_LINE_COLOUR,
};

const { step: STEP = 40 } = RED_LINE_SHEET;

const RED_LINE_IMAGE = createSyntheticSheet(RED_LINE_SHEET);

/**
 * Серый снимок той же клетки: черта тёмно-серая, цвета нет — гейт выключает
 * цветовой поиск.
 */
const GRAY_LINE_IMAGE = createSyntheticSheet({
  ...RED_LINE_SHEET,
  marginLineDarkness: 0.6,
  colour: GRAY_COLOUR,
});

/**
 * Цветной снимок клетки без красной черты.
 */
const NEUTRAL_IMAGE = createSyntheticSheet({
  ...RED_LINE_SHEET,
  marginLineX: null,
  colour: NEUTRAL_COLOUR,
});

/**
 * Тот же растр без канала `R − G`.
 *
 * @param image — растр с каналом
 * @returns растр только с яркостью
 */
const toLuminanceOnly = ({
  width,
  height,
  luminance,
}: SheetImageData): SheetImageData => {
  return { width, height, luminance };
};

/**
 * Столбец черты в строке.
 *
 * @param y — строка
 * @returns столбец черты, px
 */
const lineXAt = (y: number): number => {
  return computeSyntheticMarginLineX(RED_LINE_SHEET, y) || 0;
};

/**
 * Столбец вертикали клетки, ближайшей к черте, в строке.
 *
 * @param y — строка
 * @returns столбец вертикали, px
 */
const nearestColumnXAt = (y: number): number => {
  return computeSyntheticColumnX(RED_LINE_SHEET, 2, y);
};

describe('snapMarginLine', () => {
  it('яркостный магнит у бледной красной черты уходит на вертикаль клетки', () => {
    PROBE_ROWS.forEach((y) => {
      const snapped = snapToMarginLine(
        RED_LINE_IMAGE,
        { x: lineXAt(y) - NEAR_SHARE * STEP, y },
        STEP
      );

      expect(snapped).not.toBeNull();
      expect(Math.abs((snapped?.x || 0) - nearestColumnXAt(y))).toBeLessThan(1);
    });
  });

  it('отпущенная в 0,2 шага от красной черты вертикаль встаёт на черту', () => {
    PROBE_ROWS.forEach((y) => {
      [-NEAR_SHARE, NEAR_SHARE].forEach((share) => {
        const snapped = snapMarginLine(
          RED_LINE_IMAGE,
          { x: lineXAt(y) + share * STEP, y },
          STEP
        );

        expect(snapped).not.toBeNull();
        expect(snapped?.y).toBe(y);
        expect(Math.abs((snapped?.x || 0) - lineXAt(y))).toBeLessThanOrEqual(
          SNAP_TOLERANCE_PX
        );
      });
    });
  });

  it('красная черта за третью шага не притягивает', () => {
    PROBE_ROWS.forEach((y) => {
      expect(
        snapMarginLine(RED_LINE_IMAGE, { x: lineXAt(y) + FAR_SHARE * STEP, y }, STEP)
      ).toBeNull();
    });
  });

  it('на цветном снимке без красной черты вертикаль клетки не притягивает', () => {
    PROBE_ROWS.forEach((y) => {
      const x = nearestColumnXAt(y) + NEAR_SHARE * STEP;

      expect(snapToMarginLine(NEUTRAL_IMAGE, { x, y }, STEP)).not.toBeNull();
      expect(snapMarginLine(NEUTRAL_IMAGE, { x, y }, STEP)).toBeNull();
    });
  });

  it('на сером снимке магнит яркостный', () => {
    PROBE_ROWS.forEach((y) => {
      const point = { x: lineXAt(y) + NEAR_SHARE * STEP, y };
      const snapped = snapMarginLine(GRAY_LINE_IMAGE, point, STEP);

      expect(snapped).not.toBeNull();
      expect(snapped).toEqual(snapToMarginLine(GRAY_LINE_IMAGE, point, STEP));
    });
  });

  it('без канала `R − G` магнит яркостный', () => {
    const image = toLuminanceOnly(RED_LINE_IMAGE);

    PROBE_ROWS.forEach((y) => {
      const point = { x: lineXAt(y) - NEAR_SHARE * STEP, y };

      expect(snapMarginLine(image, point, STEP)).toEqual(
        snapToMarginLine(image, point, STEP)
      );
    });
  });
});
