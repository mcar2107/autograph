import type { FC } from 'react';

const KBD_CLASS_NAME = 'rounded-sm border border-border-strong px-1 font-ui';

/**
 * Подсказка управления окном просмотра. Колесо без модификатора сдвигает
 * снимок, а не приближает, как привыкли по картам и просмотрщикам: без
 * подсказки приближение колесом ищут и не находят.
 */
export const MarkupViewportHint: FC = () => {
  return (
    <p className="text-right text-xs text-fg-muted">
      Колесо{'\u00A0— '}сдвиг, <kbd className={KBD_CLASS_NAME}>Ctrl</kbd>/
      <kbd className={KBD_CLASS_NAME}>⌘</kbd>+колесо{'\u00A0— '}масштаб,{' '}
      <kbd className={KBD_CLASS_NAME}>Пробел</kbd>+перетаскивание{'\u00A0— '}сдвиг поверх
      ручек, <kbd className={KBD_CLASS_NAME}>H</kbd>
      {'\u00A0— '}скрыть разметку
    </p>
  );
};
