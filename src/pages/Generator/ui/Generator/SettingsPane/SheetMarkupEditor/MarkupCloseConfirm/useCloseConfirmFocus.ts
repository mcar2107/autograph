import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Фокус подтверждения закрытия: при появлении встаёт на группу вопроса, а при
 * отказе закрывать возвращается туда, откуда о закрытии попросили.
 *
 * Просить закрыть можно с разных мест — «Отмена» в подвале, «Закрыть» в углу,
 * Esc с любого элемента, — поэтому возвращается фокус не на заранее известную
 * кнопку, а на элемент, державший его до вопроса. Пропал он из документа или
 * фокуса не было вовсе — фокус встаёт на сам диалог: иначе он ушёл бы на
 * `body`, за пределы модального окна.
 *
 * @param groupRef — группа вопроса
 * @param isShown — вопрос показан
 * @returns возврат фокуса после отказа закрывать
 */
export const useCloseConfirmFocus = (
  groupRef: RefObject<HTMLElement | null>,
  isShown: boolean
): (() => void) => {
  const returnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const group = groupRef.current;

    if (!isShown || !group) {
      return;
    }

    const { activeElement } = document;

    returnRef.current =
      activeElement instanceof HTMLElement && !group.contains(activeElement)
        ? activeElement
        : null;
    group.focus();
  }, [groupRef, isShown]);

  return () => {
    const target = returnRef.current;

    returnRef.current = null;

    if (target?.isConnected) {
      target.focus();

      return;
    }

    groupRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  };
};
