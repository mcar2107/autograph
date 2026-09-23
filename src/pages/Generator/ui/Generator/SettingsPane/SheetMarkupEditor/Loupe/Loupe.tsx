import { cx } from '@shared/lib/styles';
import type { FC } from 'react';
import { createPortal } from 'react-dom';

import type { LoupeProps } from './Loupe.types';
import { LOUPE_SIZE, resolveLoupePlacement, resolveLoupeZoom } from './loupeGeometry';

/**
 * Лупа над перетаскиваемой ручкой: увеличенная область фотографии вокруг
 * точки ручки с перекрестьем в ней.
 *
 * Фотография — фон блока, а не копия снимка на канве: сдвиг лупы за ручкой —
 * смена двух чисел стиля, без перерисовки. Пиксели не сглаживаются: ручку
 * ставят на край линии, и размытый край солгал бы о том, где он.
 *
 * Отражённая фотография отражается вокруг центра лупы: точка ручки остаётся
 * под перекрестьем, а окрестность — как в окне просмотра.
 */
export const Loupe: FC<LoupeProps> = (props) => {
  const { src, frame, point, anchor, scale, isMirrored, container } = props;
  const zoom = resolveLoupeZoom(scale);
  const radius = LOUPE_SIZE / 2;
  const { left, top } = resolveLoupePlacement(anchor, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  return createPortal(
    <div
      role="img"
      aria-label="Лупа"
      data-photo-x={point.x}
      data-photo-y={point.y}
      className="pointer-events-none fixed z-50 size-40 overflow-hidden rounded-full border-2 border-focus bg-canvas shadow-popover"
      style={{ left, top }}
    >
      <div
        data-loupe-photo
        className={cx('absolute inset-0 bg-no-repeat', isMirrored && '-scale-x-100')}
        style={{
          backgroundImage: `url("${src}")`,
          backgroundSize: `${frame.width * zoom}px ${frame.height * zoom}px`,
          backgroundPosition: `${radius - point.x * zoom}px ${radius - point.y * zoom}px`,
          imageRendering: 'pixelated',
        }}
      />

      <span className="absolute top-1/2 left-0 h-px w-full bg-danger" />

      <span className="absolute top-0 left-1/2 h-full w-px bg-danger" />
    </div>,
    container
  );
};
