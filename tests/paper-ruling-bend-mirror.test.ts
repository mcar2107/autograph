import type { RulingBend, SheetRuling } from '@pages/Generator/lib/paper';
import { mirrorSheetRuling, sampleRulingBend } from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

/**
 * Наклонный лист в меру пресета `grid-1`: наклон во всю ширину кадра ≈0.6 шага,
 * поэтому строка узлов, не сдвинутая при отражении на наклон, смешала бы
 * соседние строки.
 */
const FRAME_WIDTH = 1600;
const STEP = 53.7;
const SKEW_ANGLE = -1.17;
const PHASE = 21.4;

/**
 * Кадр листа: отражению высота нужна для нижнего поля, на перенос изгиба она
 * не влияет.
 */
const FRAME = { width: FRAME_WIDTH, height: 2100 };

/**
 * Допуск совпадения линий в долях шага — из задачи 1.3.
 */
const LINE_TOLERANCE = 0.01;

const DEGREES_IN_RADIAN = 180 / Math.PI;
const TILT = Math.tan(SKEW_ANGLE / DEGREES_IN_RADIAN);

/**
 * Сетка прижата к левому краю кадра, как область с линиями у листа с линией
 * поля справа: отражённая сетка лежит в другом месте кадра, и забытый пересчёт
 * первого узла не совпадёт случайно. Узлы строки несимметричны, строки разные.
 */
const BEND: RulingBend = {
  columnOrigin: 150,
  columnSpacing: 120,
  columnCount: 8,
  rowOrigin: PHASE + 3 * STEP,
  rowSpacing: STEP,
  rowCount: 3,
  offsets: [
    0.5, 1.8, 3.1, 4.25, 4.9, 4.4, 2.6, 0.3, -1.2, -0.4, 0.8, 2.05, 3.5, 5.2, 6.1, 5.75,
    2.4, 1.1, -0.6, -2.3, -3.15, -2.7, -1.05, 0.9,
  ],
};

const RULING: SheetRuling = {
  step: STEP,
  firstLinePhase: PHASE,
  skewAngle: SKEW_ANGLE,
  margins: { top: 180, right: 240, bottom: 150, left: 90 },
  marginLineX: 1360,
  marginLineSide: 'right',
  bend: BEND,
  perspective: null,
  outline: null,
  mirrorOverride: null,
};

/**
 * Высота линии разлиновки на горизонтали: прямая наклонная гребёнка плюс
 * изгиб, взятый на прямой этой линии.
 */
const resolveLineY = (ruling: SheetRuling, index: number, x: number): number => {
  const { step, firstLinePhase, skewAngle, bend } = ruling;
  const straightY =
    firstLinePhase + index * step + x * Math.tan(skewAngle / DEGREES_IN_RADIAN);

  return straightY + (bend ? sampleRulingBend(bend, ruling, x, straightY) : 0);
};

/**
 * Номер линии отражённой разлиновки, в которую переходит линия исходной: у
 * левого края отражённого кадра она проходит там, где её прямая шла у правого
 * края исходного. Номер берётся округлением, а не формулой отражения фазы.
 */
const findMirroredIndex = (mirrored: SheetRuling, index: number): number => {
  const straightAtRightEdge = PHASE + index * STEP + FRAME_WIDTH * TILT;

  return Math.round((straightAtRightEdge - mirrored.firstLinePhase) / STEP);
};

describe('отражение изгиба', () => {
  it('сетка несимметрична: отражённая область с линиями лежит в другом месте кадра', () => {
    const lastNodeX = BEND.columnOrigin + (BEND.columnCount - 1) * BEND.columnSpacing;

    expect(Math.abs(FRAME_WIDTH - lastNodeX - BEND.columnOrigin)).toBeGreaterThan(
      BEND.columnSpacing
    );
  });

  it('линия, восстановленная по отражённой разлиновке, совпадает с отражённой линией листа', () => {
    const mirrored = mirrorSheetRuling(RULING, FRAME);
    let drift = 0;

    for (const index of [1, 3, 4, 5, 6, 9]) {
      const mirroredIndex = findMirroredIndex(mirrored, index);

      for (const x of [0, 140, 455, 610, 777, 1010, 1333, 1450, 1600]) {
        const expected = resolveLineY(RULING, index, FRAME_WIDTH - x);
        const actual = resolveLineY(mirrored, mirroredIndex, x);

        drift = Math.max(drift, Math.abs(actual - expected));
      }
    }

    expect(drift / STEP).toBeLessThanOrEqual(LINE_TOLERANCE);
  });

  it('ровные линии остаются ровными после отражения', () => {
    expect(mirrorSheetRuling({ ...RULING, bend: null }, FRAME).bend).toBeNull();
  });
});
