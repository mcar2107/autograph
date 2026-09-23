import { cx } from '@shared/lib/styles';
import type { FC, PointerEvent } from 'react';
import { useRef } from 'react';

import type { SheetPoint } from '../../../../../lib/paper';
import { useMarkupScale } from '../MarkupViewport';

import type { MarkupHandleProps } from './MarkupHandle.types';

/**
 * Радиус ручки в экранных пикселях: попадать пальцем и мышью одинаково
 * удобно при любом приближении фотографии.
 */
const HANDLE_RADIUS = 7;

/**
 * Точка фотографии под указателем. Разметка лежит в SVG с `viewBox` в
 * пикселях фотографии, и обратная экранная матрица SVG уже учитывает
 * приближение и сдвиг окна.
 *
 * @param element — ручка
 * @param clientX — горизонталь указателя в окне браузера
 * @param clientY — вертикаль указателя в окне браузера
 * @returns точка в пикселях фотографии; `null` — матрицы нет
 */
const toPhotoPoint = (
  element: SVGGraphicsElement,
  clientX: number,
  clientY: number
): SheetPoint | null => {
  const matrix = element.ownerSVGElement?.getScreenCTM?.();

  if (!matrix) {
    return null;
  }

  const { a, b, c, d, e, f } = matrix.inverse();

  return { x: a * clientX + c * clientY + e, y: b * clientX + d * clientY + f };
};

/**
 * Ручка разметки: точка в пикселях фотографии, которую перетаскивают. Общая
 * у всех инструментов редактора — размер, фокус, подпись и перевод указателя
 * в пиксели фотографии у них одни.
 *
 * Нажатие ручка забирает себе: окно просмотра под ней иначе начало бы
 * сдвигать фотографию вместе с перетаскиванием.
 */
export const MarkupHandle: FC<MarkupHandleProps> = (props) => {
  const { x, y, label, onMove, onMoveEnd, className } = props;
  const scale = useMarkupScale();
  const pointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<SheetPoint | null>(null);

  const handleHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, currentTarget } = event;

    event.stopPropagation();
    pointerIdRef.current = pointerId;
    lastPointRef.current = { x, y };
    currentTarget.setPointerCapture?.(pointerId);
  };

  const handleHandlePointerMove = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    if (pointerIdRef.current !== pointerId) {
      return;
    }

    const point = toPhotoPoint(currentTarget, clientX, clientY);

    if (point) {
      lastPointRef.current = point;
      onMove?.(point);
    }
  };

  const handleHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    const point = lastPointRef.current;

    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    pointerIdRef.current = null;
    lastPointRef.current = null;

    if (point) {
      onMoveEnd?.(point);
    }
  };

  return (
    <circle
      role="button"
      tabIndex={0}
      aria-label={label}
      cx={x}
      cy={y}
      r={HANDLE_RADIUS / scale}
      vectorEffect="non-scaling-stroke"
      className={cx(
        'cursor-move fill-surface-raised stroke-focus stroke-2 outline-none focus-visible:stroke-fg',
        className
      )}
      onPointerDown={handleHandlePointerDown}
      onPointerMove={handleHandlePointerMove}
      onPointerUp={handleHandlePointerUp}
      onPointerCancel={handleHandlePointerUp}
    />
  );
};
