import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

import { computeRevealOffset } from './markupView';

/**
 * Показывает ручку, получившую фокус за краем окна просмотра: сдвигает
 * фотографию моделью окна, а не прокруткой. Табуляция иначе прокрутила бы
 * контейнер окна сама, в обход модели, — сдвиг фотографии разошёлся бы с её
 * матрицей, и приближение колесом уезжало бы от курсора. Контейнер окна
 * нативно не прокручивается вовсе (`overflow: clip`), а этот хук даёт
 * табуляции то, что давала прокрутка.
 *
 * Сдвиг применяется синхронно, до прокрутки к элементу в фокусе, которую
 * браузер делает после событий фокуса: ручка к тому моменту уже в окне, и
 * прокручивать браузеру нечего — ни окно, ни диалог вокруг.
 *
 * Ручку, взятую указателем, фотография не догоняет: она под указателем и так
 * видна, а сдвиг снимка в начале перетаскивания увёл бы её из-под руки.
 *
 * Слушатели нативные: ручки инструменты кладут в окно порталом, и по дереву
 * React события фокуса до окна не доходят.
 *
 * @param viewportRef — узел окна просмотра
 * @param panBy — сдвиг фотографии на экранные пиксели
 */
export const useRevealFocus = (
  viewportRef: RefObject<HTMLElement | null>,
  panBy: (dx: number, dy: number) => void
): void => {
  const panByRef = useRef(panBy);

  useEffect(() => {
    panByRef.current = panBy;
  });

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const pressedPointers = new Set<number>();

    const handleViewportPointerDown = (event: PointerEvent) => {
      pressedPointers.add(event.pointerId);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      pressedPointers.delete(event.pointerId);
    };

    const handleViewportFocusIn = (event: FocusEvent) => {
      const { target } = event;

      if (
        pressedPointers.size > 0 ||
        !(target instanceof Element) ||
        target === viewport
      ) {
        return;
      }

      const frame = viewport.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const offset = computeRevealOffset(
        {
          left: box.left - frame.left,
          top: box.top - frame.top,
          right: box.right - frame.left,
          bottom: box.bottom - frame.top,
        },
        { width: frame.width, height: frame.height }
      );

      if (offset) {
        flushSync(() => {
          panByRef.current(offset.x, offset.y);
        });
      }
    };

    viewport.addEventListener('pointerdown', handleViewportPointerDown, true);
    viewport.addEventListener('focusin', handleViewportFocusIn);
    globalThis.addEventListener('pointerup', handleWindowPointerUp, true);
    globalThis.addEventListener('pointercancel', handleWindowPointerUp, true);

    return () => {
      viewport.removeEventListener('pointerdown', handleViewportPointerDown, true);
      viewport.removeEventListener('focusin', handleViewportFocusIn);
      globalThis.removeEventListener('pointerup', handleWindowPointerUp, true);
      globalThis.removeEventListener('pointercancel', handleWindowPointerUp, true);
    };
  }, [viewportRef]);
};
