import { cx } from '@shared/lib/styles';
import type { FC, KeyboardEvent, PointerEvent } from 'react';

import type { SheetPoint } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { Loupe } from '../Loupe';
import { useMarkupMirrorWidth, useMarkupScale } from '../MarkupViewport';

import type { MarkupHandleProps } from './MarkupHandle.types';
import { MarkupHandleShape } from './MarkupHandleShape';
import { useHandleDrag } from './useHandleDrag';

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
  const {
    kind,
    x,
    y,
    label,
    onMoveStart,
    onMove,
    onMoveEnd,
    onMoveCancel,
    isFlagged,
    className,
  } = props;
  const scale = useMarkupScale();
  const mirrorWidth = useMarkupMirrorWidth();
  const sheet = useMarkupEditorStore((state) => {
    return state.record?.sheet || null;
  });
  const { drag, start, move, release, cancel } = useHandleDrag({
    x,
    y,
    onMoveStart,
    onMove,
    onMoveEnd,
    onMoveCancel,
  });

  const handleHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    event.stopPropagation();
    currentTarget.setPointerCapture?.(pointerId);
    start({ pointerId, clientX, clientY, target: currentTarget });
  };

  const handleHandlePointerMove = (event: PointerEvent<SVGCircleElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    move({ pointerId, clientX, clientY, target: currentTarget });
  };

  const handleHandlePointerUp = (event: PointerEvent<SVGCircleElement>) => {
    release(event.pointerId);
  };

  const handleHandlePointerCancel = (event: PointerEvent<SVGCircleElement>) => {
    cancel(event.pointerId);
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
        onPointerCancel={handleHandlePointerCancel}
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
