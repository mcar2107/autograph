import { useEffect, useRef, useState } from 'react';

import type {
  RulingBendRadius,
  SheetFrame,
  SheetPoint,
  SheetRuling,
} from '../../../../../lib/paper';
import { editRulingBend } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';

import { findLinePoint, toPhotoPoint } from './bendGeometry';
import type { BendDrag, BendDragState } from './useBendDrag.types';

/**
 * Сдвиг, мельче которого отпускание правкой не считается: нажатие без
 * движения не должно заводить шаг истории и сетку изгиба.
 */
const MIN_DRAG_PX = 0.01;

/**
 * Перетаскивание линии поперёк линий в инструменте «Изгиб»: взятая точка
 * линии уходит вместе с указателем по высоте, в своём столбце, и линия
 * проходит через точку, где её отпустили; сдвиг затухает в пределах радиуса. Shift — сдвиг всего столбца. Промежуточные положения —
 * показ без шага истории, отпускание — один шаг.
 *
 * Рамка радиуса следует за курсором над фотографией, пока инструмент
 * смонтирован, а во время перетаскивания стоит на взятой линии.
 *
 * @param handleLayer — слой ручек оверлея: по его SVG курсор переводится в
 *   пиксели фотографии
 * @param frame — кадр фотографии
 * @param radius — радиусы затухания правки
 * @returns центр рамки и методы перетаскивания
 */
export const useBendDrag = (
  handleLayer: SVGGElement | null,
  frame: SheetFrame,
  radius: RulingBendRadius
): BendDrag => {
  const dragRef = useRef<BendDragState | null>(null);
  const [ringCenter, setRingCenter] = useState<SheetPoint | null>(null);

  /**
   * Курсор над фотографией слушается у самого SVG, а не у линий: рамка
   * показывает радиус и там, где линии ещё не взяты.
   */
  useEffect(() => {
    const svg = handleLayer?.ownerSVGElement;

    if (!svg) {
      return;
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!dragRef.current) {
        setRingCenter(toPhotoPoint(svg, event.clientX, event.clientY));
      }
    };

    const handlePointerLeave = () => {
      if (!dragRef.current) {
        setRingCenter(null);
      }
    };

    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      svg.removeEventListener('pointermove', handlePointerMove);
      svg.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [handleLayer]);

  /**
   * Разлиновка, в которой взятая точка линии ушла вместе с указателем.
   *
   * @param drag — идущее перетаскивание
   * @param y — высота указателя, px фотографии
   * @param isWholeColumn — зажат ли Shift
   * @returns разлиновка после правки
   */
  const editFrom = (
    drag: BendDragState,
    y: number,
    isWholeColumn: boolean
  ): SheetRuling => {
    const { base, grab, pointerY } = drag;

    return editRulingBend(base, grab, y - pointerY, {
      ...radius,
      isWholeColumn,
      frame,
    });
  };

  const grab = (pointerId: number, point: SheetPoint): boolean => {
    const { draft } = useMarkupEditorStore.getState();
    const linePoint = draft && findLinePoint(draft.ruling, point);

    if (!draft || !linePoint) {
      return false;
    }

    dragRef.current = {
      pointerId,
      base: draft.ruling,
      grab: linePoint,
      pointerY: point.y,
      lastY: null,
    };
    setRingCenter(linePoint);

    return true;
  };

  const drag = (pointerId: number, y: number, isWholeColumn: boolean) => {
    const current = dragRef.current;

    if (current?.pointerId !== pointerId) {
      return;
    }

    if (current.lastY === null && Math.abs(y - current.pointerY) < MIN_DRAG_PX) {
      return;
    }

    current.lastY = y;
    setRingCenter({ x: current.grab.x, y: current.grab.y + y - current.pointerY });
    useMarkupEditorStore
      .getState()
      .preview({ ruling: editFrom(current, y, isWholeColumn) });
  };

  const release = (pointerId: number, y: number | null, isWholeColumn: boolean) => {
    const current = dragRef.current;

    if (current?.pointerId !== pointerId) {
      return;
    }

    dragRef.current = null;

    const released = y === null ? current.lastY : y;

    /**
     * Нажатие без сдвига правкой не считается: иначе оно заводило бы шаг
     * истории и нулевую сетку изгиба.
     */
    if (
      released === null ||
      (current.lastY === null && Math.abs(released - current.pointerY) < MIN_DRAG_PX)
    ) {
      return;
    }

    useMarkupEditorStore
      .getState()
      .commit({ ruling: editFrom(current, released, isWholeColumn) });
  };

  return { ringCenter, grab, drag, release };
};
