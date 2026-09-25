/**
 * @vitest-environment jsdom
 */
import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import {
  buildSheetRuling,
  lineCoordinateAt,
  type SheetPoint,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import {
  MarkupHandle,
  type MarkupHandleKind,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupHandle';
import {
  type MarkupLayerId,
  MarkupOverlay,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupOverlay';
import { buildWritingZone } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupOverlay/markupGeometry';
import { MarkupScaleContext } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport';
import type { MarkupToolId } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/SheetMarkupEditor.types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const FRAME = { width: 600, height: 800 };

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Допуск совпадения зоны письма с краями строк раскладки, px фотографии.
 */
const ZONE_TOLERANCE_PX = 1;

/**
 * Лист на столе: наклон, боковые поля с наклоном к строкам и линия поля,
 * которая у верха кадра лежит внутри левого поля, а к низу выходит из
 * него, — край текста там ломается.
 */
const SLANTED_RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: 1.2,
    margins: { top: 90, right: 40, bottom: 70, left: 60 },
    marginLineX: 40,
    marginLineSide: 'left',
    sideSlant: { left: 90, right: 70, marginLineX: 150 },
  },
  FRAME
);

/**
 * Тот же лист со схождением линий — снят под углом.
 */
const PERSPECTIVE_RULING: SheetRuling = {
  ...SLANTED_RULING,
  perspective: { originX: 300, originY: 400, convergenceX: 0.0001, convergenceY: 0.0002 },
};

/**
 * Лист без наклона полей, но с линией поля правее левого поля — как
 * `IMG_1813`: углы полей левее черты, а текст начинается правее неё.
 */
const STRAIGHT_RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: 0.5,
    margins: { top: 90, right: 40, bottom: 70, left: 60 },
    marginLineX: 100,
    marginLineSide: 'left',
  },
  FRAME
);

/**
 * Правая линия поля — как `IMG_1808`: правые углы полей правее черты.
 */
const RIGHT_LINE_RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: -0.8,
    margins: { top: 90, right: 40, bottom: 70, left: 60 },
    marginLineX: 480,
    marginLineSide: 'right',
    sideSlant: { left: 60, right: 40, marginLineX: 500 },
  },
  FRAME
);

const PINS = [
  { index: 3, left: { x: 80, y: 100 }, right: { x: 520, y: 104 } },
  { index: 12, left: { x: 80, y: 370 }, right: { x: 520, y: 374 } },
];

const ALL_LAYERS: MarkupLayerId[] = ['lines', 'margins', 'marginLine', 'outline', 'pins'];

/**
 * Слои, которые правит каждый инструмент: остальные при нём тусклее.
 */
const OWN_LAYERS: Record<MarkupToolId, MarkupLayerId[]> = {
  outline: ['outline'],
  lines: ['lines', 'pins'],
  bend: ['lines'],
  margins: ['margins', 'marginLine'],
};

afterEach(() => {
  cleanup();
});

/**
 * Края строк раскладки в пикселях фотографии: начало и конец каждой строки
 * на её базовой линии, как их ставит отрисовка.
 *
 * @param ruling — разлиновка страницы
 * @returns координата вдоль линий и края строки на фотографии
 */
const readLayoutEdges = (ruling: SheetRuling) => {
  const metrics = FALLBACK_FONT_METRICS;
  const geometry = deriveGeometry(
    { ruling, kind: 'lined', width: FRAME.width, height: FRAME.height },
    metrics
  );
  const { fontSizePx, lineSpacing, topOffset, leftPadding, blockWidth, lineBounds } =
    geometry;
  const lineStep = fontSizePx * metrics.lineHeight + lineSpacing;
  const firstBaseline = topOffset + metrics.fontAscent * fontSizePx;
  const bottom = lineCoordinateAt(ruling, 0, FRAME.height - ruling.margins.bottom);
  const radians = ruling.skewAngle / DEGREES_IN_RADIAN;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const count = Math.floor((bottom - firstBaseline) / lineStep) + 1;

  return Array.from({ length: count }, (_value, index) => {
    const u = firstBaseline + index * lineStep;
    const offset = lineBounds ? lineBounds.offsets[index] || 0 : 0;
    const width = lineBounds ? lineBounds.widths[index] || 0 : blockWidth;
    const left = leftPadding + offset;

    /**
     * Точка блока на базовой линии — поворотом на наклон, как у отрисовки.
     *
     * @param x — положение вдоль строки в системе блока
     * @returns столбец фотографии
     */
    const toPhotoX = (x: number): number => {
      return x * cos - u * cos * sin;
    };

    return { u, left: toPhotoX(left), right: toPhotoX(left + width) };
  });
};

/**
 * Столбец края зоны письма на линии с координатой `u`: линейно между
 * соседними точками края.
 *
 * @param ruling — разлиновка страницы
 * @param edge — точки края сверху вниз
 * @param u — координата вдоль линий
 * @returns столбец фотографии
 */
const readZoneX = (ruling: SheetRuling, edge: SheetPoint[], u: number): number => {
  const coordinates = edge.map(({ x, y }) => {
    return lineCoordinateAt(ruling, x, y);
  });
  const index = coordinates.findIndex((value, position) => {
    const next = coordinates[position + 1];

    return next !== undefined && value <= u + 1e-9 && u <= next + 1e-9;
  });
  const start = edge[index];
  const end = edge[index + 1];
  const from = coordinates[index];
  const to = coordinates[index + 1];

  if (!start || !end || from === undefined || to === undefined) {
    throw new Error(`Линия ${u} вне зоны письма`);
  }

  const share = to === from ? 0 : (u - from) / (to - from);

  return start.x + (end.x - start.x) * share;
};

/**
 * Левый и правый края зоны письма сверху вниз.
 *
 * @param zone — многоугольник зоны: левый край сверху вниз, затем правый
 *   снизу вверх
 * @returns края
 */
const splitZone = (zone: SheetPoint[]) => {
  const half = zone.length / 2;

  return { left: zone.slice(0, half), right: zone.slice(half).toReversed() };
};

describe('зона письма', () => {
  it.each([
    ['наклон полей и линии поля, край ломается', SLANTED_RULING],
    ['то же с перспективой', PERSPECTIVE_RULING],
    ['поля без наклона, линия поля правее поля', STRAIGHT_RULING],
    ['линия поля справа', RIGHT_LINE_RULING],
  ])('%s: края зоны совпадают с краями строк раскладки', (_name, ruling) => {
    const zone = buildWritingZone(ruling, FRAME);
    const { left, right } = splitZone(zone);
    const lines = readLayoutEdges(ruling);

    expect(lines.length).toBeGreaterThan(5);

    for (const line of lines) {
      expect(Math.abs(readZoneX(ruling, left, line.u) - line.left)).toBeLessThanOrEqual(
        ZONE_TOLERANCE_PX
      );
      expect(Math.abs(readZoneX(ruling, right, line.u) - line.right)).toBeLessThanOrEqual(
        ZONE_TOLERANCE_PX
      );
    }
  });

  it('линия поля правее левого поля — зона начинается правее линии поля, а не у поля', () => {
    const { left } = splitZone(buildWritingZone(STRAIGHT_RULING, FRAME));
    const gap = STRAIGHT_RULING.step / 5;

    for (const point of left) {
      const u = lineCoordinateAt(STRAIGHT_RULING, point.x, point.y);
      const radians = STRAIGHT_RULING.skewAngle / DEGREES_IN_RADIAN;
      const blockX =
        (point.x + u * Math.cos(radians) * Math.sin(radians)) / Math.cos(radians);

      expect(blockX).toBeCloseTo(100 + gap, 6);
    }
  });

  it('оверлей закрашивает зону письма, а не прямоугольник полей', () => {
    const { container } = render(
      <MarkupScaleContext value={1}>
        <MarkupOverlay
          frame={FRAME}
          ruling={STRAIGHT_RULING}
          pins={[]}
          tool="margins"
          layers={{
            lines: true,
            margins: true,
            marginLine: true,
            outline: true,
            pins: true,
          }}
          isMuted={false}
          isHidden={false}
          onHandleLayerChange={() => {}}
        />
      </MarkupScaleContext>
    );
    const zone = container.querySelector('[data-writing-zone]');
    const expected = buildWritingZone(STRAIGHT_RULING, FRAME)
      .map(({ x, y }) => {
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    expect(zone?.getAttribute('points')).toBe(expected);
    expect(zone?.closest('[data-layer-group="margins"]')).not.toBeNull();
  });
});

/**
 * Оверлей со всеми слоями при заданном инструменте.
 *
 * @param tool — активный инструмент
 * @returns контейнер
 */
const renderOverlay = (tool: MarkupToolId): HTMLElement => {
  const { container } = render(
    <MarkupScaleContext value={1}>
      <MarkupOverlay
        frame={FRAME}
        ruling={STRAIGHT_RULING}
        pins={PINS}
        tool={tool}
        layers={{
          lines: true,
          margins: true,
          marginLine: true,
          outline: true,
          pins: true,
        }}
        isMuted={false}
        isHidden={false}
        onHandleLayerChange={() => {}}
      />
    </MarkupScaleContext>
  );

  return container;
};

/**
 * Итоговая непрозрачность слоя: произведение `opacity` его предков внутри
 * оверлея.
 *
 * @param container — контейнер оверлея
 * @param layer — слой
 * @returns непрозрачность 0…1
 */
const readLayerOpacity = (container: HTMLElement, layer: MarkupLayerId): number => {
  const geometry = container.querySelector(`[data-layer="${layer}"]`);
  let opacity = 1;
  let node = geometry?.parentElement || null;

  while (node && node.tagName !== 'svg') {
    opacity *= Number(node.getAttribute('opacity') || '1');
    node = node.parentElement;
  }

  if (!geometry) {
    throw new Error(`Нет слоя ${layer}`);
  }

  return opacity;
};

describe('слои чужих инструментов', () => {
  it.each(Object.keys(OWN_LAYERS) as MarkupToolId[])(
    'при инструменте %s свои слои в полную силу, чужие тусклее',
    (tool) => {
      const container = renderOverlay(tool);
      const own = OWN_LAYERS[tool];

      for (const layer of ALL_LAYERS) {
        const opacity = readLayerOpacity(container, layer);

        if (own.includes(layer)) {
          expect(opacity).toBe(1);
        } else {
          expect(opacity).toBeLessThan(1);
          expect(opacity).toBeGreaterThan(0);
        }
      }
    }
  );
});

/**
 * Ручка вида `kind` внутри SVG.
 *
 * @param kind — роль ручки
 * @param isFlagged — подсвечена ли ошибкой
 * @param scale — масштаб просмотра
 * @returns видимая фигура ручки
 */
const renderHandle = (kind: MarkupHandleKind, isFlagged = false, scale = 2): Element => {
  render(
    <svg>
      <MarkupScaleContext value={scale}>
        <MarkupHandle kind={kind} x={100} y={200} label="Ручка" isFlagged={isFlagged} />
      </MarkupScaleContext>
    </svg>
  );

  const shape = screen
    .getByRole('button', { name: 'Ручка' })
    .parentElement?.querySelector('[data-handle-kind]');

  if (!shape) {
    throw new Error('Нет фигуры ручки');
  }

  return shape;
};

/**
 * Наибольшее расстояние от точки ручки (100, 200) до контура фигуры, без
 * обводки: вершины квадрата и ромба, радиус круга.
 *
 * @param shape — видимая фигура ручки
 * @returns радиус описанной окружности, px фотографии
 */
const readShapeOuterRadius = (shape: Element): number => {
  const center = { x: 100, y: 200 };

  switch (shape.tagName) {
    case 'rect': {
      const x = Number(shape.getAttribute('x'));
      const y = Number(shape.getAttribute('y'));
      const width = Number(shape.getAttribute('width'));
      const height = Number(shape.getAttribute('height'));

      return Math.max(
        Math.hypot(x - center.x, y - center.y),
        Math.hypot(x + width - center.x, y + height - center.y)
      );
    }

    case 'polygon': {
      return (shape.getAttribute('points') || '').split(' ').reduce((farthest, pair) => {
        const [x = 0, y = 0] = pair.split(',').map(Number);

        return Math.max(farthest, Math.hypot(x - center.x, y - center.y));
      }, 0);
    }

    case 'circle': {
      return Number(shape.getAttribute('r'));
    }

    default: {
      throw new Error(`Неизвестная фигура: ${shape.tagName}`);
    }
  }
};

describe('форма ручки по роли', () => {
  it('угол — квадрат с центром в точке ручки', () => {
    const shape = renderHandle('corner');
    const x = Number(shape.getAttribute('x'));
    const y = Number(shape.getAttribute('y'));
    const width = Number(shape.getAttribute('width'));
    const height = Number(shape.getAttribute('height'));

    expect(shape.tagName).toBe('rect');
    expect(shape.getAttribute('data-handle-kind')).toBe('corner');
    expect(width).toBeCloseTo(height, 9);
    expect(x + width / 2).toBeCloseTo(100, 9);
    expect(y + height / 2).toBeCloseTo(200, 9);
  });

  it('середина края — ромб: вершины над, под и по бокам от точки ручки', () => {
    const shape = renderHandle('edgeMiddle');
    const points = (shape.getAttribute('points') || '').split(' ').map((pair) => {
      const [x, y] = pair.split(',').map(Number);

      return { x, y };
    });

    expect(shape.tagName).toBe('polygon');
    expect(points).toHaveLength(4);
    expect(points[0]?.x).toBeCloseTo(100, 6);
    expect(points[0]?.y).toBeLessThan(200);
    expect(points[1]?.x).toBeGreaterThan(100);
    expect(points[1]?.y).toBeCloseTo(200, 6);
    expect(points[2]?.y).toBeGreaterThan(200);
    expect(points[3]?.x).toBeLessThan(100);
  });

  it('конец линии — круг', () => {
    const shape = renderHandle('lineEnd');

    expect(shape.tagName).toBe('circle');
    expect(shape.getAttribute('cx')).toBe('100');
    expect(shape.getAttribute('cy')).toBe('200');
  });

  it.each(
    (['corner', 'edgeMiddle', 'lineEnd'] as const).flatMap((kind) => {
      return [0.36, 2, 4].map((scale) => {
        return [kind, scale] as const;
      });
    })
  )(
    'круг захвата ручки %s на масштабе %s не меньше описанной окружности фигуры с обводкой',
    (kind, scale) => {
      const shape = renderHandle(kind, false, scale);
      const handle = screen.getByRole('button', { name: 'Ручка' });
      const halfStroke = Number(shape.getAttribute('stroke-width')) / 2;
      const outerRadius = readShapeOuterRadius(shape) + halfStroke;

      expect(Number(handle.getAttribute('r'))).toBeGreaterThanOrEqual(outerRadius - 1e-9);
    }
  );

  it('фигура не ловит указатель: его берёт круг захвата с подписью', () => {
    const shape = renderHandle('corner');
    const handle = screen.getByRole('button', { name: 'Ручка' });

    expect(shape.getAttribute('class')).toContain('pointer-events-none');
    expect(shape.getAttribute('aria-hidden')).toBe('true');
    expect(handle.tagName).toBe('circle');
  });

  it('подсвеченная ошибкой ручка обведена цветом ошибки', () => {
    expect(renderHandle('lineEnd', true).getAttribute('class')).toContain(
      'stroke-danger'
    );

    cleanup();

    expect(renderHandle('lineEnd').getAttribute('class')).not.toContain('stroke-danger');
  });
});
