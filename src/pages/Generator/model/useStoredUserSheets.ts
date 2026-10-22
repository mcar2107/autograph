import { useEffect } from 'react';

import { useGeneratorStore } from './useGeneratorStore';

/**
 * Возвращает в стор листы, загруженные пользователем в прошлые сеансы.
 *
 * Требование `paper-profile` говорит: лист и его характеристики переживают
 * перезагрузку, а повторный анализ не запускается. Хранилище это умеет, но
 * без вызова при старте список остаётся пустым, и загруженная вчера
 * фотография просто пропадает.
 */
export const useStoredUserSheets = (): void => {
  const restoreUserSheets = useGeneratorStore((state) => {
    return state.restoreUserSheets;
  });

  useEffect(() => {
    void restoreUserSheets();
  }, [restoreUserSheets]);
};
