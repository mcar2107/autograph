import type { ReactNode } from 'react';

export type ButtonProps = {
  /**
   * Текст кнопки.
   */
  children: ReactNode;

  /**
   * Колбэк на нажатие.
   */
  onClick: () => void;

  /**
   * Оформление: `primary` — главное действие экрана, `secondary` — обычное,
   * `ghost` — без заливки, `danger` — разрушительное: то, что теряет данные
   * без возможности отмены.
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';

  /**
   * Кнопка недоступна.
   */
  isDisabled?: boolean;

  /**
   * Действие кнопки идёт: вместо подписи крутится индикатор, повторное
   * нажатие не проходит.
   */
  isLoading?: boolean;

  /**
   * Идентификатор текста, который объясняет кнопку: например, почему она
   * недоступна. Недоступную кнопку без причины читалка озвучивает голой.
   */
  describedBy?: string | undefined;

  /**
   * Дополнительные классы.
   */
  className?: string;
};
