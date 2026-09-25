import { cx } from '@shared/lib/styles';
import type { FC } from 'react';
import { createPortal } from 'react-dom';

import type { LoupeProps } from './Loupe.types';
import { LOUPE_SIZE, resolveLoupePlacement, resolveLoupeZoom } from './loupeGeometry';

/**
 * Луч перекрестья: светлая линия в пиксель с тёмной каймой в пиксель с
 * каждой стороны. Одноцветное перекрестье тонет в линии своего цвета —
 * красное в красной черте поля, тёмное в линии клетки; у пары светлой и
 * тёмной на любом фоне видна хотя бы одна. Вдоль своей оси луч
 * растягивается `flex-1`, поперёк остаётся в пиксель — один класс годится
 * обоим направлениям.
 */
const CROSSHAIR_ARM_CLASS_NAME =
  'min-h-px min-w-px flex-1 bg-white outline outline-black/70';

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
 *
 * Рамка — кольцо снаружи, а не граница: граница ужала бы поле лупы, и центр
 * снимка, отсчитанный от поперечника лупы, разошёлся бы с центром
 * перекрестья на её толщину.
 *
 * В центре перекрестья зазор: ручку ставят на край линии, и перекрестье,
 * сходящееся в точку, закрыло бы ровно тот пиксель, куда её ставят.
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
      className="pointer-events-none fixed z-50 size-40 overflow-hidden rounded-full bg-canvas shadow-popover ring-2 ring-focus"
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

      <div className="absolute inset-0 flex items-center">
        <span data-crosshair-arm className={CROSSHAIR_ARM_CLASS_NAME} />

        <span data-crosshair-gap className="size-2 shrink-0" />

        <span data-crosshair-arm className={CROSSHAIR_ARM_CLASS_NAME} />
      </div>

      <div className="absolute inset-0 flex flex-col items-center">
        <span data-crosshair-arm className={CROSSHAIR_ARM_CLASS_NAME} />

        <span data-crosshair-gap className="size-2 shrink-0" />

        <span data-crosshair-arm className={CROSSHAIR_ARM_CLASS_NAME} />
      </div>
    </div>,
    container
  );
};
