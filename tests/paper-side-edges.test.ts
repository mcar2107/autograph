import type { SheetRuling } from '@pages/Generator/lib/paper';
import {
  buildSheetRuling,
  intersectSideEdge,
  lineCoordinateAt,
  mirrorSheetRuling,
  readSideEdge,
  reanchorMirrorOverride,
  resolveSideEdgeAt,
  sideEdgePointAt,
  sideEdgePointAtHeight,
  toSideEdgeEnds,
  writeSideEdge,
} from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

const FRAME = { width: 1600, height: 2000 };
const SKEW_ANGLE = 1.5;
const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Лист на столе: наклон и перспектива, поля без наклона.
 */
const RULING: SheetRuling = buildSheetRuling(
  {
    step: 50,
    firstLinePhase: 40,
    skewAngle: SKEW_ANGLE,
    margins: { top: 200, right: 150, bottom: 150, left: 120 },
    marginLineX: 260,
    marginLineSide: 'left',
    perspective: {
      originX: 800,
      originY: 1000,
      convergenceX: 2e-5,
      convergenceY: 1e-4,
    },
  },
  FRAME
);

describe('боковая граница блока', () => {
  it('равные концы — перпендикуляр к строкам: столбец блока тот же на любой высоте', () => {
    const ends = { top: 120, bottom: 120 };
    const radians = SKEW_ANGLE / DEGREES_IN_RADIAN;

    [0, 700, 1900].forEach((v) => {
      const point = sideEdgePointAt(SKEW_ANGLE, ends, FRAME.height, v);

      expect(point.x).toBeCloseTo(120 * Math.cos(radians) - v * Math.sin(radians), 9);
      expect(point.y).toBeCloseTo(120 * Math.sin(radians) + v * Math.cos(radians), 9);
    });
  });

  it('граница через две точки проходит через обе', () => {
    const first = { x: 300, y: 400 };
    const second = { x: 180, y: 1700 };
    const ends = toSideEdgeEnds(SKEW_ANGLE, FRAME.height, first, second);

    [first, second].forEach((point) => {
      expect(
        sideEdgePointAtHeight(SKEW_ANGLE, ends, FRAME.height, point.y).x
      ).toBeCloseTo(point.x, 9);
    });
  });

  it('точка пересечения лежит и на линии разлиновки, и на границе', () => {
    const ends = toSideEdgeEnds(
      SKEW_ANGLE,
      FRAME.height,
      { x: 300, y: 400 },
      {
        x: 180,
        y: 1700,
      }
    );

    [300, 900, 1600].forEach((u) => {
      const crossing = intersectSideEdge(RULING, ends, FRAME.height, u);

      expect(crossing).not.toBeNull();
      expect(lineCoordinateAt(RULING, crossing?.x || 0, crossing?.y || 0)).toBeCloseTo(
        u,
        6
      );
      expect(
        sideEdgePointAtHeight(SKEW_ANGLE, ends, FRAME.height, crossing?.y || 0).x
      ).toBeCloseTo(crossing?.x || 0, 6);
    });
  });

  it('начало строки в системе блока после поворота ложится в столбец пересечения', () => {
    const ends = { top: 300, bottom: 150 };
    const radians = SKEW_ANGLE / DEGREES_IN_RADIAN;

    [300, 900, 1600].forEach((u) => {
      const blockX = resolveSideEdgeAt(RULING, ends, FRAME.height, u);
      const v = u * Math.cos(radians);
      const pageX = blockX * Math.cos(radians) - v * Math.sin(radians);

      expect(pageX).toBeCloseTo(
        intersectSideEdge(RULING, ends, FRAME.height, u)?.x || 0,
        9
      );
    });
  });
});

describe('запись концов боковых полей в разлиновку', () => {
  it('правое поле хранится отступом от правого края, а читается положением', () => {
    const ruling = writeSideEdge(RULING, FRAME, 'right', { top: 1450, bottom: 1500 });

    expect(ruling.margins.right).toBe(150);
    expect(ruling.sideSlant).toStrictEqual({ left: 120, right: 100, marginLineX: 260 });
    expect(readSideEdge(ruling, FRAME, 'right')).toStrictEqual({
      top: 1450,
      bottom: 1500,
    });
  });

  it('концы, вернувшиеся к верхним, снимают наклон', () => {
    const slanted = writeSideEdge(RULING, FRAME, 'left', { top: 120, bottom: 80 });
    const straight = writeSideEdge(slanted, FRAME, 'left', { top: 120, bottom: 120 });

    expect(slanted.sideSlant).not.toBeNull();
    expect(straight.sideSlant).toBeNull();
    expect(straight).toStrictEqual(RULING);
  });

  it('линия поля наклоняется отдельно от полей', () => {
    const ruling = writeSideEdge(RULING, FRAME, 'marginLine', { top: 260, bottom: 230 });

    expect(ruling.marginLineX).toBe(260);
    expect(readSideEdge(ruling, FRAME, 'marginLine')).toStrictEqual({
      top: 260,
      bottom: 230,
    });
    expect(readSideEdge(ruling, FRAME, 'left')).toStrictEqual({ top: 120, bottom: 120 });
  });
});

describe('концы полей у низа кадра на зеркальной странице', () => {
  const SLANTED: SheetRuling = {
    ...RULING,
    sideSlant: { left: 60, right: 200, marginLineX: 230 },
  };

  it('левое и правое меняются местами, линия поля отражается по кадру', () => {
    expect(mirrorSheetRuling(SLANTED, FRAME).sideSlant).toStrictEqual({
      left: 200,
      right: 60,
      marginLineX: FRAME.width - 230,
    });
  });

  it('двойное отражение возвращает концы листа', () => {
    const twice = mirrorSheetRuling(mirrorSheetRuling(SLANTED, FRAME), FRAME);

    expect(twice.sideSlant).toStrictEqual(SLANTED.sideSlant);
  });

  it('заданные у зеркала концы заменяют отражённые', () => {
    const ruling: SheetRuling = {
      ...SLANTED,
      mirrorOverride: {
        marginLineX: null,
        marginLineSide: null,
        marginLeft: 140,
        marginRight: 90,
        sideSlant: { left: 110, right: 90, marginLineX: 500 },
      },
    };

    expect(mirrorSheetRuling(ruling, FRAME).sideSlant).toStrictEqual({
      left: 110,
      right: 90,
      marginLineX: null,
    });
  });
});

describe('поля зеркала при смене наклона листа', () => {
  const override = {
    marginLineX: 1300,
    marginLineSide: 'right' as const,
    marginLeft: 140,
    marginRight: 200,
    sideSlant: null,
  };

  it('наклон тот же — поля зеркала те же до бита, тем же объектом', () => {
    expect(reanchorMirrorOverride(override, SKEW_ANGLE, SKEW_ANGLE, FRAME)).toBe(
      override
    );
  });

  it('смена наклона мельче погрешности арктангенса поля не трогает', () => {
    expect(reanchorMirrorOverride(override, SKEW_ANGLE, SKEW_ANGLE + 5e-10, FRAME)).toBe(
      override
    );
  });

  it('заметная смена наклона переписывает концы, и у низа кадра они расходятся с верхом', () => {
    const next = reanchorMirrorOverride(override, SKEW_ANGLE, SKEW_ANGLE + 0.5, FRAME);

    expect(next).not.toBe(override);
    expect(next?.sideSlant).not.toBeNull();
  });

  it('зеркала без своих полей нет — и переписывать нечего', () => {
    expect(reanchorMirrorOverride(null, SKEW_ANGLE, SKEW_ANGLE + 0.5, FRAME)).toBeNull();
  });
});
