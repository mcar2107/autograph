import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * События, по которым читается состояние Alt/Option. Указатель — главный
 * источник: клавишу могли зажать вне окна, и `keydown` сюда не дошёл бы.
 */
const MODIFIER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup'];

/**
 * Зажат ли Alt/Option — по последнему событию указателя или клавиатуры.
 *
 * Ручка отдаёт отпускание одной точкой, без модификаторов, поэтому состояние
 * клавиши читается на окне в фазе погружения: так оно обновлено до того, как
 * ручка сообщит об отпускании.
 *
 * @returns ссылка с признаком зажатого Alt/Option
 */
export const useAltKeyRef = (): RefObject<boolean> => {
  const isAltRef = useRef(false);

  useEffect(() => {
    const handleWindowModifierEvent = (event: Event) => {
      if (event instanceof MouseEvent || event instanceof KeyboardEvent) {
        isAltRef.current = event.altKey;
      }
    };

    MODIFIER_EVENTS.forEach((type) => {
      window.addEventListener(type, handleWindowModifierEvent, { capture: true });
    });

    return () => {
      MODIFIER_EVENTS.forEach((type) => {
        window.removeEventListener(type, handleWindowModifierEvent, { capture: true });
      });
    };
  }, []);

  return isAltRef;
};
