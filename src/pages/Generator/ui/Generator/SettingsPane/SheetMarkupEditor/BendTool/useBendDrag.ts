import { useEffect, useRef, useState } from 'react';

import type {
  RulingBendRadius,
  SheetFrame,
  SheetPoint,
  SheetRuling,
} from '../../../../../lib/paper';
import { editRulingBend } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { toPhotoPoint } from '../markupPointer';
import { mirrorMarkupPoint, useMarkupMirrorWidth } from '../MarkupViewport';

import { findLinePoint } from './bendGeometry';
import type { BendDrag, BendDragState } from './useBendDrag.types';

/**
 * Сдвиг, мельче которого отпускание правкой не считается: нажатие без
 * движения не должно заводить шаг истории и сетку изгиба.
 */
const MIN_DRAG_PX = 0.01;

/**
 * Сдвиг указателя от нажатия, урезанный до шага разлиновки у взятой точки.
 *
 * @param drag — идущее перетаскивание
 * @param y — высота указателя, px фотографии
 * @returns сдвиг линии, px фотографии
 */
const clampShift = (drag: BendDragState, y: number): number => {
  const { pointerY, maxShift } = drag;

  return Math.min(maxShift, Math.max(-maxShift, y - pointerY));
};

/**
 * Перетаскивание линии поперёк линий в инструменте «Изгиб»: взятая точка
 * линии уходит вместе с указателем по высоте, в своём столбце, и линия
 * проходит через точку, где её отпустили; сдвиг затухает в пределах радиуса.
 * Shift — сдвиг всего столбца. Промежуточные положения — показ без шага
 * истории, отпускание — один шаг.
 *
 * За одно перетаскивание линия уходит не дальше шага разлиновки: дальше она
 * встала бы на соседнюю линию снимка или за неё, а такой изгиб не бывает
 * правкой — детектор изгиба отвергает уже полшага как перескок трассы. На
 * мелком масштабе, где шаг — десяток экранных пикселей, рывок мыши иначе гнул
 * бы линию на несколько шагов.
 *
 * Рамка радиуса следует за курсором над фотографией, пока инструмент
 * смонтирован, а во время перетаскивания стоит на взятой линии. На
 * зеркальной странице её центр — в пикселях самого листа: рамку рисует
 * отражённый слой ручек.
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const mirrorWidth = useMarkupMirrorWidth();

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
        const point = toPhotoPoint(svg, event.clientX, event.clientY);

        setRingCenter(point && mirrorMarkupPoint(point, mirrorWidth));
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
  }, [handleLayer, mirrorWidth]);

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
    const { base, grab } = drag;

    return editRulingBend(base, grab, clampShift(drag, y), {
      ...radius,
      isWholeColumn,
      frame,
    });
  };

  const grab = (pointerId: number, point: SheetPoint): boolean => {
    const { draft } = useMarkupEditorStore.getState();
    const line = draft && findLinePoint(draft.ruling, point);

    if (!draft || !line) {
      return false;
    }

    dragRef.current = {
      pointerId,
      base: draft.ruling,
      grab: line.point,
      maxShift: line.localStep,
      pointerY: point.y,
      lastY: null,
    };
    setRingCenter(line.point);
    setActiveIndex(line.index);

    return true;
  };

  const hover = (point: SheetPoint | null) => {
    if (dragRef.current) {
      return;
    }

    const { draft } = useMarkupEditorStore.getState();
    const line = point && draft && findLinePoint(draft.ruling, point);

    setActiveIndex(line ? line.index : null);
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
    setRingCenter({ x: current.grab.x, y: current.grab.y + clampShift(current, y) });
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

  return { ringCenter, activeIndex, grab, hover, drag, release };
};
