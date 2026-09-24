import { cx } from '@shared/lib/styles';
import type { FC, KeyboardEvent, PointerEvent } from 'react';
import { useRef, useState } from 'react';

import type { SheetPoint } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { Loupe } from '../Loupe';
import {
  mirrorMarkupPoint,
  useMarkupMirrorWidth,
  useMarkupScale,
} from '../MarkupViewport';

import type { HandleDrag, MarkupHandleProps } from './MarkupHandle.types';

/**
 * Радиус ручки в экранных пикселях: попадать пальцем и мышью одинаково
 * удобно при любом приближении фотографии.
 */
const HANDLE_RADIUS = 7;

/**
 * Обводка ручки в экранных пикселях. Делится на масштаб, как и радиус: зум —
 * CSS-преобразование над `<svg>`, и `non-scaling-stroke` его не учитывает.
 */
const HANDLE_STROKE_WIDTH = 2;

/**
 * Сдвиг стрелкой с Shift, px фотографии: грубая подводка к линии, а
 * стрелкой без модификатора — последний пиксель.
 */
const COARSE_NUDGE = 10;

/**
 * Направление сдвига по стрелке.
 *
 * @param key — нажатая клавиша
 * @returns сдвиг на пиксель фотографии; `null` — клавиша не стрелка
 */
const readArrowOffset = (key: string): SheetPoint | null => {
  switch (key) {
    case 'ArrowLeft': {
      return { x: -1, y: 0 };
    }

    case 'ArrowRight': {
      return { x: 1, y: 0 };
    }

    case 'ArrowUp': {
      return { x: 0, y: -1 };
    }

    case 'ArrowDown': {
      return { x: 0, y: 1 };
    }

    default: {
      return null;
    }
  }
};

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
 * у всех инструментов редактора — размер, фокус, подпись, перевод указателя
 * в пиксели фотографии, лупа и сдвиг стрелками у них одни.
 *
 * Нажатие ручка забирает себе: окно просмотра под ней иначе начало бы
 * сдвигать фотографию вместе с перетаскиванием. Пока ручку тянут, рядом с
 * указателем стоит лупа с фотографией под ручкой.
 *
 * Стрелка сдвигает ручку в фокусе на пиксель фотографии, с Shift — на
 * десять, при любом приближении окна: сдвиг мерится в пикселях снимка, а не
 * экрана, и каждое нажатие — завершённая правка.
 *
 * На зеркальной странице ручка стоит в пикселях самого листа внутри
 * отражённого слоя: указатель переводится через `x → W − x`, а стрелка влево
 * двигает её влево на экране — вправо по листу.
 */
export const MarkupHandle: FC<MarkupHandleProps> = (props) => {
  const { x, y, label, onMove, onMoveEnd, className } = props;
  const scale = useMarkupScale();
  const mirrorWidth = useMarkupMirrorWidth();
  const sheet = useMarkupEditorStore((state) => {
    return state.record?.sheet || null;
  });
  const pointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<SheetPoint | null>(null);
  const [drag, setDrag] = useState<HandleDrag | null>(null);

  const handleHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    event.stopPropagation();
    pointerIdRef.current = pointerId;
    lastPointRef.current = { x, y };
    currentTarget.setPointerCapture?.(pointerId);
    setDrag({
      point: { x, y },
      anchor: { x: clientX, y: clientY },
      container: currentTarget.closest('[role="dialog"]') || document.body,
    });
  };

  const handleHandlePointerMove = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    if (pointerIdRef.current !== pointerId) {
      return;
    }

    const pagePoint = toPhotoPoint(currentTarget, clientX, clientY);
    const point = pagePoint && mirrorMarkupPoint(pagePoint, mirrorWidth);

    if (point) {
      lastPointRef.current = point;
      setDrag((current) => {
        return current && { ...current, point, anchor: { x: clientX, y: clientY } };
      });
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
    setDrag(null);

    if (point) {
      onMoveEnd?.(point, 'pointer');
    }
  };

  const handleHandleKeyDown = (event: KeyboardEvent<SVGCircleElement>) => {
    const { key, shiftKey } = event;
    const offset = readArrowOffset(key);

    if (!offset) {
      return;
    }

    /**
     * Стрелка иначе прокрутила бы панель или окно под диалогом.
     */
    event.preventDefault();

    const distance = shiftKey ? COARSE_NUDGE : 1;
    const directionX = mirrorWidth === null ? 1 : -1;

    onMoveEnd?.(
      { x: x + offset.x * directionX * distance, y: y + offset.y * distance },
      'keyboard'
    );
  };

  return (
    <>
      <circle
        role="button"
        tabIndex={0}
        aria-label={label}
        cx={x}
        cy={y}
        r={HANDLE_RADIUS / scale}
        strokeWidth={HANDLE_STROKE_WIDTH / scale}
        className={cx(
          'cursor-move fill-surface-raised stroke-focus outline-none focus-visible:stroke-fg',
          className
        )}
        onPointerDown={handleHandlePointerDown}
        onPointerMove={handleHandlePointerMove}
        onPointerUp={handleHandlePointerUp}
        onPointerCancel={handleHandlePointerUp}
        onKeyDown={handleHandleKeyDown}
      />

      {drag && sheet ? (
        <Loupe
          src={sheet.src}
          frame={sheet}
          point={drag.point}
          anchor={drag.anchor}
          scale={scale}
          isMirrored={mirrorWidth !== null}
          container={drag.container}
        />
      ) : null}
    </>
  );
};
