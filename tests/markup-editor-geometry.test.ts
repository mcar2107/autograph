import {
  buildSheetRuling,
  lineHeightAt,
  type RulingBend,
  sampleRulingBend,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import { getPageRuling } from '@pages/Generator/model/geometrySelectors';
import { findLinePoint } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/BendTool/bendGeometry';
import {
  buildRulingLines,
  toOutlineBox,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupOverlay/markupGeometry';
import { describe, expect, it } from 'vitest';

const FRAME = { width: 900, height: 1200 };

const OUTLINE = {
  topLeft: { x: 60, y: 40 },
  topRight: { x: 850, y: 55 },
  bottomRight: { x: 840, y: 1150 },
  bottomLeft: { x: 70, y: 1160 },
};

const FLAT_RULING = buildSheetRuling(
  { step: 32, firstLinePhase: 17, skewAngle: 1.2, outline: OUTLINE },
  FRAME
);

/**
 * Волна бумаги: сетка 5 × 30 узлов, смещения до 12 px.
 */
const BEND: RulingBend = {
  columnOrigin: 150,
  columnSpacing: 150,
  columnCount: 5,
  rowOrigin: 49,
  rowSpacing: 32,
  rowCount: 30,
  offsets: Array.from({ length: 150 }, (_value, node) => {
    return 12 * Math.sin((node % 5) * 1.3) * Math.cos(Math.floor(node / 5) * 0.2);
  }),
};

const BENT_RULING: SheetRuling = {
  ...FLAT_RULING,
  bend: BEND,
  perspective: { originX: 450, originY: 600, convergenceX: 2e-5, convergenceY: 4e-5 },
};

describe('линии оверлея редактора', () => {
  it('на ровном листе линия — два конца, и оба на прямой гребёнке', () => {
    const lines = buildRulingLines(FLAT_RULING, FRAME);

    expect(lines.length).toBeGreaterThan(30);
    lines.forEach(({ index, points }) => {
      const u = FLAT_RULING.firstLinePhase + index * FLAT_RULING.step;

      expect(points).toHaveLength(2);
      points.forEach(({ x, y }) => {
        expect(y).toBe(lineHeightAt(FLAT_RULING, x, u));
      });
    });
  });

  it('линии покрывают контур листа по высоте и ширине', () => {
    const box = toOutlineBox(OUTLINE, FRAME);
    const lines = buildRulingLines(BENT_RULING, FRAME);
    const first = lines[0]?.points || [];
    const last = lines.at(-1)?.points || [];

    expect(box).toStrictEqual({ left: 60, top: 40, right: 850, bottom: 1160 });
    expect(
      Math.max(
        ...first.map(({ y }) => {
          return y;
        })
      )
    ).toBeLessThan(box.top);
    expect(
      Math.min(
        ...last.map(({ y }) => {
          return y;
        })
      )
    ).toBeGreaterThan(box.bottom);
    expect(first[0]?.x).toBe(box.left);
    expect(first.at(-1)?.x).toBe(box.right);
  });

  it('на листе с перспективой и изгибом точка — высота линии плюс изгиб в самой линии, точки не реже 16 px', () => {
    const lines = buildRulingLines(BENT_RULING, FRAME);

    lines.forEach(({ index, points }) => {
      const u = BENT_RULING.firstLinePhase + index * BENT_RULING.step;

      points.forEach(({ x, y }, order) => {
        const straight = lineHeightAt(BENT_RULING, x, u);

        expect(y).toBe(straight + sampleRulingBend(BEND, BENT_RULING, x, straight));
        expect(x - (points[order - 1]?.x || x)).toBeLessThanOrEqual(16);
      });
    });
  });

  it('зеркальная страница рисуется по отражённой разлиновке', () => {
    const sheet = {
      id: 'mirror',
      label: 'Зеркало',
      src: '',
      ...FRAME,
      ruling: BENT_RULING,
      lighting: null,
      texture: null,
    };
    const mirrored = getPageRuling(sheet, 1);
    const lines = buildRulingLines(mirrored, FRAME);
    const [line] = lines;
    const point = line?.points[3];

    if (!line || !point) {
      throw new Error('Линий нет');
    }

    const u = mirrored.firstLinePhase + line.index * mirrored.step;
    const straight = lineHeightAt(mirrored, point.x, u);

    expect(point.y).toBe(
      straight + sampleRulingBend(mirrored.bend || BEND, mirrored, point.x, straight)
    );
  });

  it('без шага и с шагом в доли пикселя линий нет', () => {
    expect(buildRulingLines({ ...FLAT_RULING, step: 0 }, FRAME)).toStrictEqual([]);
    expect(buildRulingLines({ ...FLAT_RULING, step: 0.5 }, FRAME)).toStrictEqual([]);
  });
});

describe('«Изгиб»: шаг у взятой линии', () => {
  /**
   * Лист на столе: к верху кадра шаг заметно короче, чем в середине.
   */
  const ruling = buildSheetRuling(
    {
      step: 40,
      firstLinePhase: 20,
      skewAngle: 0.5,
      margins: { top: 60, right: 60, bottom: 60, left: 90 },
      marginLineX: null,
      marginLineSide: null,
      perspective: {
        originX: 300,
        originY: 400,
        convergenceX: 0,
        convergenceY: 0.0008,
      },
    },
    { width: 600, height: 800 }
  );

  it.each([
    [300, 60],
    [300, 720],
    [80, 400],
  ])('в точке (%i, %i) — половина промежутка между соседями линии', (x, y) => {
    const grab = findLinePoint(ruling, { x, y });

    if (!grab) {
      throw new Error('Линия не взята');
    }

    const u = ruling.firstLinePhase + grab.index * ruling.step;
    const above = lineHeightAt(ruling, x, u - ruling.step);
    const below = lineHeightAt(ruling, x, u + ruling.step);

    expect(grab.localStep).toBeCloseTo((below - above) / 2, 9);
  });

  it('у верха и у низа кадра шаг разный, и ни один не равен шагу разлиновки', () => {
    const [top, bottom] = [60, 720].map((y) => {
      return findLinePoint(ruling, { x: 300, y })?.localStep || 0;
    });

    expect(Math.abs((top || 0) - ruling.step)).toBeGreaterThan(ruling.step * 0.1);
    expect(Math.abs((bottom || 0) - ruling.step)).toBeGreaterThan(ruling.step * 0.1);
    expect(bottom).toBeGreaterThan(top || 0);
  });
});
