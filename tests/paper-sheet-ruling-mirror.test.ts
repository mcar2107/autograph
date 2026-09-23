import type {
  RulingBend,
  RulingMirrorOverride,
  RulingPerspective,
  RulingProjection,
  SheetOutline,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import { mirrorSheetRuling, resolveFirstLine } from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

/**
 * Наклонный лист пресет-пака `grid-1`: при таком угле и кадре наклон во всю
 * ширину ≈33 px ≈0.6 шага — больше допуска, поэтому потерянная поправка на
 * наклон не пройдёт незамеченной.
 */
const FRAME_WIDTH = 1600;
const STEP = 53.7;
const SKEW_ANGLE = -1.17;

/**
 * Высота кадра: нижнее поле отражается через высоту линии у противоположного
 * края, а она отсчитывается от низа кадра.
 */
const FRAME_HEIGHT = 2100;

const FRAME = { width: FRAME_WIDTH, height: FRAME_HEIGHT };

/**
 * Допуск попадания базовой линии на линию разлиновки в долях шага — из
 * требования «Чётные страницы зеркалятся».
 */
const DRIFT_TOLERANCE = 0.1;

const DEGREES_IN_RADIAN = 180 / Math.PI;

const RULING: SheetRuling = {
  step: STEP,
  firstLinePhase: 21.4,
  skewAngle: SKEW_ANGLE,
  margins: { top: 180, right: 240, bottom: 150, left: 90 },
  marginLineX: 1360,
  marginLineSide: 'right',
  bend: null,
  perspective: null,
  outline: null,
  mirrorOverride: null,
};

/**
 * Точка кадра.
 */
type Point = {
  /**
   * Горизонталь в пикселях кадра.
   */
  x: number;

  /**
   * Вертикаль в пикселях кадра.
   */
  y: number;
};

/**
 * Отражение точки фотографии по горизонтали: так отражается сама фотография.
 */
const reflectPoint = ({ x, y }: Point): Point => {
  return { x: FRAME_WIDTH - x, y };
};

/**
 * Высота прямой, проходящей через две точки, на заданной горизонтали.
 */
const interpolateY = (first: Point, second: Point, x: number): number => {
  return first.y + ((second.y - first.y) * (x - first.x)) / (second.x - first.x);
};

/**
 * Где наклонная прямая исходного листа, идущая от высоты `y0` у его левого
 * края, проходит у левого края отражённой фотографии. Эталон строится
 * отражением двух точек прямой, а не формулой отражения разлиновки.
 */
const reflectLineAtLeftEdge = (y0: number): number => {
  const tilt = Math.tan(SKEW_ANGLE / DEGREES_IN_RADIAN);
  const left = reflectPoint({ x: 0, y: y0 });
  const right = reflectPoint({ x: FRAME_WIDTH, y: y0 + tilt * FRAME_WIDTH });

  return interpolateY(right, left, 0);
};

/**
 * Первая линия отражённой фотографии, лежащая не выше отражённого верхнего
 * поля, у левого края кадра — перебором линий исходного листа.
 */
const findMirroredFirstLine = (): number => {
  const top = reflectLineAtLeftEdge(RULING.margins.top);
  let firstLine = Number.POSITIVE_INFINITY;

  for (let index = -10; index < 100; index += 1) {
    const line = reflectLineAtLeftEdge(RULING.firstLinePhase + index * STEP);

    if (line >= top - 1e-6) {
      firstLine = Math.min(firstLine, line);
    }
  }

  return firstLine;
};

describe('mirrorSheetRuling', () => {
  it('первая базовая строка зеркальной страницы садится на линию отражённой фотографии', () => {
    const mirrored = mirrorSheetRuling(RULING, FRAME);
    const drift = Math.abs(resolveFirstLine(mirrored) - findMirroredFirstLine());

    expect(drift / STEP).toBeLessThanOrEqual(DRIFT_TOLERANCE);
  });

  it('наклон во всю ширину кадра больше допуска: без поправки строка ушла бы с линии', () => {
    const shift = Math.abs(reflectLineAtLeftEdge(0));

    expect(shift / STEP).toBeGreaterThan(DRIFT_TOLERANCE);
  });

  it('переносит линию поля к противоположному краю вместе со стороной', () => {
    const mirrored = mirrorSheetRuling(RULING, FRAME);

    expect(mirrored.marginLineX).toBe(reflectPoint({ x: 1360, y: 0 }).x);
    expect(mirrored.marginLineSide).toBe('left');
    expect(
      mirrorSheetRuling({ ...RULING, marginLineSide: 'left' }, FRAME).marginLineSide
    ).toBe('right');
  });

  it('меняет местами левое и правое поля и инвертирует наклон', () => {
    const mirrored = mirrorSheetRuling(RULING, FRAME);

    expect(mirrored.margins.left).toBe(RULING.margins.right);
    expect(mirrored.margins.right).toBe(RULING.margins.left);
    expect(mirrored.skewAngle).toBe(-SKEW_ANGLE);
    expect(mirrored.step).toBe(STEP);
  });

  it('сдвигает нижнее поле на наклон во всю ширину кадра', () => {
    const mirrored = mirrorSheetRuling(RULING, FRAME);
    const bottomLine = reflectLineAtLeftEdge(-RULING.margins.bottom);

    expect(mirrored.margins.bottom).toBeCloseTo(-bottomLine, 9);
  });

  it('без линии поля оставляет её отсутствующей', () => {
    const mirrored = mirrorSheetRuling(
      { ...RULING, marginLineX: null, marginLineSide: null },
      FRAME
    );

    expect(mirrored.marginLineX).toBeNull();
    expect(mirrored.marginLineSide).toBeNull();
  });

  it('ровный лист отражает без сдвига по вертикали', () => {
    const mirrored = mirrorSheetRuling({ ...RULING, skewAngle: 0 }, FRAME);

    expect(mirrored.skewAngle).toBe(0);
    expect(mirrored.firstLinePhase).toBeCloseTo(RULING.firstLinePhase, 9);
    expect(mirrored.margins.top).toBe(RULING.margins.top);
  });
});

describe('поля зеркала, заданные отдельно', () => {
  const MIRROR_OVERRIDE: RulingMirrorOverride = {
    marginLineX: 330,
    marginLineSide: 'left',
    marginLeft: 360,
    marginRight: 70,
  };
  const OVERRIDDEN: SheetRuling = { ...RULING, mirrorOverride: MIRROR_OVERRIDE };

  it('заменяют отражённые линию поля и боковые поля', () => {
    const mirrored = mirrorSheetRuling(OVERRIDDEN, FRAME);

    expect(mirrored.marginLineX).toBe(330);
    expect(mirrored.marginLineSide).toBe('left');
    expect(mirrored.margins.left).toBe(360);
    expect(mirrored.margins.right).toBe(70);
  });

  it('не трогают остальную отражённую разметку', () => {
    const mirrored = mirrorSheetRuling(OVERRIDDEN, FRAME);
    const reflected = mirrorSheetRuling(RULING, FRAME);

    expect({
      ...mirrored,
      margins: { ...mirrored.margins, left: 0, right: 0 },
      marginLineX: null,
      marginLineSide: null,
    }).toStrictEqual({
      ...reflected,
      margins: { ...reflected.margins, left: 0, right: 0 },
      marginLineX: null,
      marginLineSide: null,
    });
  });

  it('у отражённой разлиновки своего зеркала нет', () => {
    expect(mirrorSheetRuling(OVERRIDDEN, FRAME).mirrorOverride).toBeNull();
    expect(mirrorSheetRuling(RULING, FRAME).mirrorOverride).toBeNull();
  });

  it('линия поля без стороны у зеркала считается отсутствующей', () => {
    const mirrored = mirrorSheetRuling(
      { ...RULING, mirrorOverride: { ...MIRROR_OVERRIDE, marginLineSide: null } },
      FRAME
    );

    expect(mirrored.marginLineX).toBeNull();
    expect(mirrored.marginLineSide).toBeNull();
  });
});

/**
 * Лист, снятый на столе с руки: наклон градус, шаг по кадру дрейфует на шесть
 * процентов, контур несимметричен — стол виден с одной стороны шире.
 */
const PERSPECTIVE_SKEW_ANGLE = 1;
const PERSPECTIVE_PHASE = 21.4;
const DRIFT_SHARE = 0.06;

/**
 * Допуск совпадения линий в долях шага — из задачи 2.5: отражение считается
 * точной алгеброй, а не приближением.
 */
const LINE_TOLERANCE = 0.01;

const PERSPECTIVE: RulingPerspective = {
  originX: FRAME_WIDTH / 2,
  originY: FRAME_HEIGHT / 2,
  convergenceX: DRIFT_SHARE / (FRAME_WIDTH / 2),
  convergenceY: DRIFT_SHARE / (FRAME_HEIGHT / 2),
};

const PERSPECTIVE_PROJECTION: RulingProjection = {
  skewAngle: PERSPECTIVE_SKEW_ANGLE,
  perspective: PERSPECTIVE,
};

const OUTLINE: SheetOutline = {
  topLeft: { x: 120, y: 90 },
  topRight: { x: 1480, y: 70 },
  bottomRight: { x: 1450, y: 2010 },
  bottomLeft: { x: 140, y: 2040 },
};

/**
 * Сетка изгиба: узлы строки несимметричны, строки разные. Строки узлов лежат
 * на линиях 3, 4 и 5 — по ним и сверяются линии.
 */
const PERSPECTIVE_BEND: RulingBend = {
  columnOrigin: 150,
  columnSpacing: 260,
  columnCount: 5,
  rowOrigin: PERSPECTIVE_PHASE + 3 * STEP,
  rowSpacing: STEP,
  rowCount: 3,
  offsets: [
    0.5, 1.8, 3.1, 4.25, 4.9, -1.2, -0.4, 0.8, 2.05, 3.5, 2.4, 1.1, -0.6, -2.3, -3.15,
  ],
};

/**
 * Координата вдоль линий и обратная ей высота линии по формулам design
 * («Перспектива — дробно-линейная координата вдоль линий»), записанным здесь
 * заново: иначе отражение сверялось бы с тем же модулем, которым посчитано.
 */
const toLineCoordinate = (
  { skewAngle, perspective }: RulingProjection,
  x: number,
  y: number
): number => {
  const tilt = Math.tan(skewAngle / DEGREES_IN_RADIAN);

  if (!perspective) {
    return y - x * tilt;
  }

  const { originX, originY, convergenceX, convergenceY } = perspective;
  const weight = 1 + convergenceX * (x - originX) + convergenceY * (y - originY);

  return originY - originX * tilt + (y - originY - (x - originX) * tilt) / weight;
};

const toLineHeight = (
  { skewAngle, perspective }: RulingProjection,
  x: number,
  u: number
): number => {
  const tilt = Math.tan(skewAngle / DEGREES_IN_RADIAN);

  if (!perspective) {
    return u + x * tilt;
  }

  const { originX, originY, convergenceX, convergenceY } = perspective;
  const offset = u - originY + originX * tilt;

  return (
    originY +
    (offset * (1 + convergenceX * (x - originX)) + (x - originX) * tilt) /
      (1 - offset * convergenceY)
  );
};

/**
 * Верхнее поле стоит ровно на линии: после отражения оно должно остаться на
 * линии отражённой разлиновки, а не съехать между ними.
 */
const PERSPECTIVE_MARGIN_TOP = toLineHeight(
  PERSPECTIVE_PROJECTION,
  0,
  PERSPECTIVE_PHASE + 4 * STEP
);

const PERSPECTIVE_RULING: SheetRuling = {
  step: STEP,
  firstLinePhase: PERSPECTIVE_PHASE,
  skewAngle: PERSPECTIVE_SKEW_ANGLE,
  margins: { top: PERSPECTIVE_MARGIN_TOP, right: 240, bottom: 150, left: 90 },
  marginLineX: 1360,
  marginLineSide: 'right',
  bend: PERSPECTIVE_BEND,
  perspective: PERSPECTIVE,
  outline: OUTLINE,
  mirrorOverride: null,
};

/**
 * Наклон во всю ширину кадра: на него сдвигается координата вдоль линий при
 * отражении (design, «Отражение»).
 */
const PERSPECTIVE_SHIFT =
  Math.tan(PERSPECTIVE_SKEW_ANGLE / DEGREES_IN_RADIAN) * FRAME_WIDTH;

/**
 * Высота линии разлиновки в узле сетки изгиба: перспективная гребёнка плюс
 * смещение узла. Точки взяты в узлах, потому что кривая проходит через них
 * точно, и эталон не зависит от выборки изгиба.
 */
const resolveNodeLineY = (
  ruling: SheetRuling,
  lineIndex: number,
  column: number
): number => {
  const { bend } = ruling;

  if (!bend) {
    throw new Error('У листа нет изгиба');
  }

  const u = ruling.firstLinePhase + lineIndex * ruling.step;
  const x = bend.columnOrigin + column * bend.columnSpacing;
  const row = Math.round((u - bend.rowOrigin) / bend.rowSpacing);

  return (
    toLineHeight(ruling, x, u) + (bend.offsets[row * bend.columnCount + column] || 0)
  );
};

/**
 * Номер линии отражённой разлиновки, в которую переходит линия исходной: у
 * левого края отражённого кадра она проходит там, где гребёнка исходной шла у
 * правого края. Номер берётся округлением, а не формулой отражения фазы.
 */
const findMirroredIndex = (mirrored: SheetRuling, lineIndex: number): number => {
  const atRightEdge = toLineHeight(
    PERSPECTIVE_RULING,
    FRAME_WIDTH,
    PERSPECTIVE_PHASE + lineIndex * STEP
  );

  return Math.round(
    (toLineCoordinate(mirrored, 0, atRightEdge) - mirrored.firstLinePhase) / STEP
  );
};

describe('отражение перспективы и контура', () => {
  it('линии, восстановленные по отражённой разлиновке, совпадают с отражёнными линиями листа', () => {
    const mirrored = mirrorSheetRuling(PERSPECTIVE_RULING, FRAME);
    let drift = 0;

    for (const lineIndex of [3, 4, 5]) {
      const mirroredIndex = findMirroredIndex(mirrored, lineIndex);

      for (let column = 0; column < PERSPECTIVE_BEND.columnCount; column += 1) {
        const expected = resolveNodeLineY(PERSPECTIVE_RULING, lineIndex, column);
        const actual = resolveNodeLineY(
          mirrored,
          mirroredIndex,
          PERSPECTIVE_BEND.columnCount - 1 - column
        );

        drift = Math.max(drift, Math.abs(actual - expected));
      }
    }

    expect(drift / STEP).toBeLessThanOrEqual(LINE_TOLERANCE);
  });

  it('дрейф шага по кадру больше допуска: отражённая перспектива не совпала бы случайно', () => {
    const middle = toLineHeight(PERSPECTIVE_PROJECTION, FRAME_WIDTH / 2, 0);
    const edge = toLineHeight(PERSPECTIVE_PROJECTION, FRAME_WIDTH, 0);

    expect(Math.abs(edge - middle) / STEP).toBeGreaterThan(LINE_TOLERANCE);
  });

  it('меняет местами левые и правые углы контура', () => {
    const { outline } = mirrorSheetRuling(PERSPECTIVE_RULING, FRAME);

    expect(outline).toEqual({
      topLeft: { x: FRAME_WIDTH - OUTLINE.topRight.x, y: OUTLINE.topRight.y },
      topRight: { x: FRAME_WIDTH - OUTLINE.topLeft.x, y: OUTLINE.topLeft.y },
      bottomRight: { x: FRAME_WIDTH - OUTLINE.bottomLeft.x, y: OUTLINE.bottomLeft.y },
      bottomLeft: { x: FRAME_WIDTH - OUTLINE.bottomRight.x, y: OUTLINE.bottomRight.y },
    });
  });

  it('оставляет верхнее поле на линии, а нижнее — на своей прямой', () => {
    const mirrored = mirrorSheetRuling(PERSPECTIVE_RULING, FRAME);
    const top = toLineCoordinate(mirrored, 0, mirrored.margins.top);
    const lines = (top - mirrored.firstLinePhase) / STEP;
    const bottom = toLineCoordinate(mirrored, 0, FRAME_HEIGHT - mirrored.margins.bottom);
    /**
     * Нижнее поле, как и верхнее, задано у левого края кадра: отражение
     * оставляет блок на той же прямой листа, а координата вдоль линий после
     * отражения отличается на наклон во всю ширину.
     */
    const expectedBottom =
      toLineCoordinate(
        PERSPECTIVE_RULING,
        0,
        FRAME_HEIGHT - PERSPECTIVE_RULING.margins.bottom
      ) + PERSPECTIVE_SHIFT;

    expect(Math.abs(lines - Math.round(lines))).toBeLessThan(1e-6);
    expect(bottom).toBeCloseTo(expectedBottom, 6);
  });
});
