import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

const SPACE_CODE = 'Space';

/**
 * Пробел в поле ввода — это пробел, а не сдвиг: набор числа в «Точных
 * значениях» не должен хватать фотографию.
 *
 * @param target — элемент, получивший нажатие
 * @returns идёт ли набор текста
 */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
};

/**
 * Режим сдвига по зажатому пробелу: пока он включён, перетаскивание двигает
 * фотографию и поверх ручек и линий разметки.
 *
 * Включается, только пока указатель над окном просмотра. Иначе пробел,
 * отнятый у кнопок панели, сломал бы их нажатие с клавиатуры, а без мыши
 * сдвигать нечем. Нажатие и отпускание пробела в этом режиме отменяются:
 * кнопка в фокусе (при открытии это «Закрыть») иначе сработала бы на
 * отпускание.
 *
 * @param viewportRef — узел окна просмотра
 * @returns зажат ли пробел для сдвига
 */
export const useSpacePan = (viewportRef: RefObject<HTMLElement | null>): boolean => {
  const [isSpacePan, setSpacePan] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    let isPointerInside = false;
    let isHeld = false;

    const release = () => {
      isHeld = false;
      setSpacePan(false);
    };

    const handleViewportPointerEnter = () => {
      isPointerInside = true;
    };

    const handleViewportPointerLeave = () => {
      isPointerInside = false;
    };

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.code !== SPACE_CODE) {
        return;
      }

      if (!isHeld && (!isPointerInside || isTyping(event.target))) {
        return;
      }

      event.preventDefault();
      isHeld = true;
      setSpacePan(true);
    };

    const handleDocumentKeyUp = (event: KeyboardEvent) => {
      if (event.code !== SPACE_CODE || !isHeld) {
        return;
      }

      event.preventDefault();
      release();
    };

    viewport.addEventListener('pointerenter', handleViewportPointerEnter);
    viewport.addEventListener('pointerleave', handleViewportPointerLeave);
    document.addEventListener('keydown', handleDocumentKeyDown);
    document.addEventListener('keyup', handleDocumentKeyUp);
    window.addEventListener('blur', release);

    return () => {
      viewport.removeEventListener('pointerenter', handleViewportPointerEnter);
      viewport.removeEventListener('pointerleave', handleViewportPointerLeave);
      document.removeEventListener('keydown', handleDocumentKeyDown);
      document.removeEventListener('keyup', handleDocumentKeyUp);
      window.removeEventListener('blur', release);
    };
  }, [viewportRef]);

  return isSpacePan;
};
