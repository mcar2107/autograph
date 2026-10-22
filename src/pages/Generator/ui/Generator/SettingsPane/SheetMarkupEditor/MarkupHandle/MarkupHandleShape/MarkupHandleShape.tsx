import type { FC } from 'react';

import type { MarkupHandleShapeProps } from './MarkupHandleShape.types';

/**
 * Половина стороны квадрата угла в экранных пикселях: площадь близка к кругу
 * конца линии, и ручки разных ролей одного веса.
 */
const CORNER_HALF_SIDE = 6;

/**
 * Половина диагонали ромба середины края в экранных пикселях.
 */
const EDGE_HALF_DIAGONAL = 8;

/**
 * Радиус круга конца линии в экранных пикселях.
 */
const END_RADIUS = 7;

/**
 * Видимая фигура ручки по её роли: квадрат — угол, ромб — середина края,
 * круг — конец линии. В «Полях» углы, середины краёв и концы линии поля
 * стоят рядом, и одинаковые точки там не различить; форма — не
 * единственный признак, у каждой ручки есть подпись.
 *
 * Размеры делятся на масштаб: зум — CSS-преобразование над `<svg>`, и фигура
 * держит экранный размер при любом приближении.
 */
export const MarkupHandleShape: FC<MarkupHandleShapeProps> = (props) => {
  const { kind, x, y, scale, strokeWidth, className } = props;

  switch (kind) {
    case 'corner': {
      const half = CORNER_HALF_SIDE / scale;

      return (
        <rect
          aria-hidden="true"
          data-handle-kind={kind}
          x={x - half}
          y={y - half}
          width={2 * half}
          height={2 * half}
          strokeWidth={strokeWidth}
          className={className}
        />
      );
    }

    case 'edgeMiddle': {
      const half = EDGE_HALF_DIAGONAL / scale;

      return (
        <polygon
          aria-hidden="true"
          data-handle-kind={kind}
          points={`${x},${y - half} ${x + half},${y} ${x},${y + half} ${x - half},${y}`}
          strokeWidth={strokeWidth}
          className={className}
        />
      );
    }

    case 'lineEnd': {
      return (
        <circle
          aria-hidden="true"
          data-handle-kind={kind}
          cx={x}
          cy={y}
          r={END_RADIUS / scale}
          strokeWidth={strokeWidth}
          className={className}
        />
      );
    }

    default: {
      throw new Error(`Неизвестная роль ручки: ${String(kind)}`);
    }
  }
};
