import type { RefObject } from 'react';
import { useEffect } from 'react';

/**
 * Ставит фокус на элемент, когда он показался.
 *
 * @param ref — ссылка на элемент
 * @param isShown — элемент показан
 */
export const useFocusOnShow = (
  ref: RefObject<HTMLElement | null>,
  isShown: boolean
): void => {
  useEffect(() => {
    if (isShown) {
      ref.current?.focus();
    }
  }, [ref, isShown]);
};
