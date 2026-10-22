import { useRef, useState } from 'react';

import type { SheetPoint } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { toPhotoPoint } from '../markupPointer';
import { mirrorMarkupPoint, useMarkupMirrorWidth } from '../MarkupViewport';

import type {
  HandleDrag,
  HandleDragEnd,
  HandleDragOptions,
  HandleDragState,
  HandlePointer,
} from './useHandleDrag.types';

/**
 * Перетаскивание ручки указателем: перевод указателя в пиксели листа, точка
 * нажатия, лупа и отпускание.
 *
 * Нажатие без движения — не правка: отпускание не зовётся, и ни магнит, ни
 * подгонка разлиновки через булавки, ни перемер по контуру не запускаются.
 * Оборванный системой жест (`pointercancel`) — тоже не правка: показанное
 * перетаскиванием снимается, и отпускание не зовётся.
 *
 * @param options — точка ручки и колбэки перетаскивания
 * @returns методы жеста и идущее перетаскивание для лупы
 */
export const useHandleDrag = (options: HandleDragOptions): HandleDragState => {
  const { x, y, onMoveStart, onMove, onMoveEnd, onMoveCancel } = options;
  const mirrorWidth = useMarkupMirrorWidth();
  const pointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<SheetPoint | null>(null);
  const pressPointRef = useRef<SheetPoint | null>(null);
  const hasMovedRef = useRef(false);
  const [drag, setDrag] = useState<HandleDrag | null>(null);

  /**
   * Точка листа под указателем: на зеркальной странице — отражённая.
   *
   * @param pointer — указатель
   * @returns точка, px листа; `null` — матрицы нет
   */
  const readSheetPoint = (pointer: HandlePointer): SheetPoint | null => {
    const { clientX, clientY, target } = pointer;
    const point = toPhotoPoint(target.ownerSVGElement, clientX, clientY);

    return point && mirrorMarkupPoint(point, mirrorWidth);
  };

  /**
   * Забывает жест.
   *
   * @returns последняя точка перетаскивания и было ли движение
   */
  const finish = (): HandleDragEnd => {
    const point = lastPointRef.current;
    const hasMoved = hasMovedRef.current;

    pointerIdRef.current = null;
    lastPointRef.current = null;
    pressPointRef.current = null;
    hasMovedRef.current = false;
    setDrag(null);

    return { point, hasMoved };
  };

  const start = (pointer: HandlePointer) => {
    const { pointerId, clientX, clientY, target } = pointer;

    pointerIdRef.current = pointerId;
    lastPointRef.current = { x, y };
    hasMovedRef.current = false;
    setDrag({
      point: { x, y },
      anchor: { x: clientX, y: clientY },
      container: target.closest('[role="dialog"]') || document.body,
    });

    const pressPoint = readSheetPoint(pointer);

    pressPointRef.current = pressPoint;

    if (pressPoint) {
      onMoveStart?.(pressPoint);
    }
  };

  const move = (pointer: HandlePointer) => {
    const { pointerId, clientX, clientY } = pointer;

    if (pointerIdRef.current !== pointerId) {
      return;
    }

    const point = readSheetPoint(pointer);
    const pressPoint = pressPointRef.current;

    /**
     * Движение в точку нажатия — не сдвиг: браузер шлёт его и без движения
     * руки, а ручка, нажатая не в центре, иначе прыгнула бы под указатель.
     */
    if (
      !hasMovedRef.current &&
      point &&
      pressPoint &&
      point.x === pressPoint.x &&
      point.y === pressPoint.y
    ) {
      return;
    }

    if (point) {
      hasMovedRef.current = true;
      lastPointRef.current = point;
      setDrag((current) => {
        return current && { ...current, point, anchor: { x: clientX, y: clientY } };
      });
      onMove?.(point);
    }
  };

  const release = (pointerId: number) => {
    if (pointerIdRef.current !== pointerId) {
      return;
    }

    const { point, hasMoved } = finish();

    if (point && hasMoved) {
      onMoveEnd?.(point, 'pointer');
    }
  };

  const cancel = (pointerId: number) => {
    if (pointerIdRef.current !== pointerId) {
      return;
    }

    const { hasMoved } = finish();

    if (hasMoved) {
      useMarkupEditorStore.getState().cancelPreview();
      onMoveCancel?.();
    }
  };

  return { drag, start, move, release, cancel };
};
