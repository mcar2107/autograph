import type { RefObject } from 'react';

export type ExactValueDraftOptions = {
  /**
   * Значение разметки, px; `null` — значения нет.
   */
  value: number | null;

  /**
   * Поле ввода: Esc в нём во время набора не закрывает диалог.
   */
  inputRef: RefObject<HTMLInputElement | null>;

  /**
   * Колбэк на применение числа. Возвращает причину отказа; `null` — число
   * принято.
   */
  onValueCommit: (value: number) => string | null;
};

export type ExactValueDraft = {
  /**
   * Текст поля: набор, а без набора — значение.
   */
  text: string;

  /**
   * Причина, по которой набор не принят; `null` — ошибки нет.
   */
  error: string | null;

  /**
   * Меняет набранный текст и снимает ошибку.
   */
  change: (text: string) => void;

  /**
   * Применяет набор: принятый уходит, отвергнутый остаётся с ошибкой.
   */
  commit: () => void;

  /**
   * Отменяет набор и ошибку.
   */
  cancel: () => void;
};
