import { useEffect, useState } from 'react';

import { isTypingTarget } from '../MarkupViewport';

/**
 * Клавиша по физическому положению, а не по символу: в русской раскладке на
 * ней «Р», и подсказка «H» работала бы только в латинской.
 */
const HIDE_MARKUP_CODE = 'KeyH';

/**
 * Скрытие всей разметки, пока зажата клавиша H: отпустил — вернулась. Так
 * линию снимка под линией разметки видно за одно движение, без пяти флажков
 * слоёв туда и обратно.
 *
 * Нажатие в поле ввода печатает букву и разметку не прячет. С Ctrl, Cmd или
 * Alt это чужое сочетание, а не скрытие. Потеря окном фокуса возвращает
 * разметку: отпускание клавиши в другом окне сюда не дойдёт.
 *
 * @returns скрыта ли разметка
 */
export const useHideMarkupKey = (): boolean => {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const release = () => {
      setIsHidden(false);
    };

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const { code, ctrlKey, metaKey, altKey, target } = event;

      if (code !== HIDE_MARKUP_CODE || ctrlKey || metaKey || altKey) {
        return;
      }

      if (isTypingTarget(target)) {
        return;
      }

      setIsHidden(true);
    };

    const handleDocumentKeyUp = (event: KeyboardEvent) => {
      if (event.code === HIDE_MARKUP_CODE) {
        release();
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);
    document.addEventListener('keyup', handleDocumentKeyUp);
    window.addEventListener('blur', release);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
      document.removeEventListener('keyup', handleDocumentKeyUp);
      window.removeEventListener('blur', release);
    };
  }, []);

  return isHidden;
};
