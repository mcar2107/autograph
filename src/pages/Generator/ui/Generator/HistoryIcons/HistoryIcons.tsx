import type { FC } from 'react';

/**
 * Значок отмены правки: стрелка назад с загибом. Один на шапку генератора и
 * подвал редактора разметки — кнопки истории там одни и те же по смыслу, и
 * разойтись рисунком им нельзя.
 */
export const UndoIcon: FC = () => {
  return (
    <svg aria-hidden viewBox="0 0 16 16">
      <path
        d="M5 3 2 6l3 3M2 6h8a4 4 0 0 1 0 8H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
};

/**
 * Значок повтора правки — зеркальный значку отмены.
 */
export const RedoIcon: FC = () => {
  return (
    <svg aria-hidden viewBox="0 0 16 16">
      <path
        d="m11 3 3 3-3 3m3-3H6a4 4 0 0 0 0 8h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
};
