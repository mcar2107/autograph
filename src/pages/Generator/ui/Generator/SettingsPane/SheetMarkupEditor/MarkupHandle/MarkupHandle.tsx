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
import { MarkupHandleShape } from './MarkupHandleShape';

/**
 * Радиус круга захвата в экранных пикселях: попадать пальцем и мышью
 * одинаково удобно при любом приближении фотографии и при любой форме
 * ручки. Круг не меньше описанной окружности самой крупной фигуры с
 * обводкой — квадрата угла, 6·√2 + 1 ≈ 9,5, — иначе указатель на уголке
 * видимой фигуры ручку не брал бы.
 */
const HANDLE_RADIUS = 10;

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
 *
 * Видно не круг захвата, а фигура роли (`MarkupHandleShape`): указатель и
 * фокус берёт прозрачный круг под ней, одинаковый у всех ролей, а фигура
 * указатель не ловит и подсвечивает фокус круга как соседа.
 */
export const MarkupHandle: FC<MarkupHandleProps> = (props) => {
  const { kind, x, y, label, onMoveStart, onMove, onMoveEnd, isFlagged, className } =
    props;
  const scale = useMarkupScale();
  const mirrorWidth = useMarkupMirrorWidth();
  const sheet = useMarkupEditorStore((state) => {
    return state.record?.sheet || null;
  });
  const pointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<SheetPoint | null>(null);
  const pressPointRef = useRef<SheetPoint | null>(null);
  const hasMovedRef = useRef(false);
  const [drag, setDrag] = useState<HandleDrag | null>(null);

  const handleHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    event.stopPropagation();
    pointerIdRef.current = pointerId;
    lastPointRef.current = { x, y };
    hasMovedRef.current = false;
    currentTarget.setPointerCapture?.(pointerId);
    setDrag({
      point: { x, y },
      anchor: { x: clientX, y: clientY },
      container: currentTarget.closest('[role="dialog"]') || document.body,
    });

    const pagePoint = toPhotoPoint(currentTarget, clientX, clientY);
    const pressPoint = pagePoint && mirrorMarkupPoint(pagePoint, mirrorWidth);

    pressPointRef.current = pressPoint;

    if (pressPoint) {
      onMoveStart?.(pressPoint);
    }
  };

  const handleHandlePointerMove = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    if (pointerIdRef.current !== pointerId) {
      return;
    }

    const pagePoint = toPhotoPoint(currentTarget, clientX, clientY);
    const point = pagePoint && mirrorMarkupPoint(pagePoint, mirrorWidth);
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

  const handleHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    const point = lastPointRef.current;

    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    pointerIdRef.current = null;
    lastPointRef.current = null;
    pressPointRef.current = null;
    setDrag(null);

    /**
     * Нажатие без движения — не правка: отпускание не зовётся, и ни магнит,
     * ни подгонка разлиновки через булавки, ни перемер по контуру не
     * запускаются.
     */
    if (point && hasMovedRef.current) {
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
    <g className={className}>
      <circle
        role="button"
        tabIndex={0}
        aria-label={label}
        cx={x}
        cy={y}
        r={HANDLE_RADIUS / scale}
        className="peer cursor-move fill-transparent outline-none"
        onPointerDown={handleHandlePointerDown}
        onPointerMove={handleHandlePointerMove}
        onPointerUp={handleHandlePointerUp}
        onPointerCancel={handleHandlePointerUp}
        onKeyDown={handleHandleKeyDown}
      />

      <MarkupHandleShape
        kind={kind}
        x={x}
        y={y}
        scale={scale}
        className={cx(
          'pointer-events-none fill-surface-raised peer-focus-visible:stroke-fg',
          isFlagged ? 'stroke-danger' : 'stroke-focus'
        )}
        strokeWidth={HANDLE_STROKE_WIDTH / scale}
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
    </g>
  );
};
