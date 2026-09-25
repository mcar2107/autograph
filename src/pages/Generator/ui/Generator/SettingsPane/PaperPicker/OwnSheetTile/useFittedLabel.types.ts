import type { RefObject } from 'react';

/**
 * Подпись плитки, подобранная под её строки.
 */
export type FittedLabel = {
  /**
   * Ссылка на элемент подписи: по его шрифту и ширине идёт замер.
   */
  ref: RefObject<HTMLSpanElement | null>;

  /**
   * Показанный текст: имя целиком или обрезанное с середины.
   */
  text: string;
};

/**
 * Подобранная подпись вместе с именем, под которое она подобрана.
 */
export type FittedText = {
  /**
   * Имя листа.
   */
  label: string;

  /**
   * Подпись для этого имени.
   */
  text: string;
};

/**
 * Подсчёт строк подписи пробным элементом.
 */
export type LineCounter = {
  /**
   * Сколько строк займёт текст в подписи.
   */
  countLines: (text: string) => number;

  /**
   * Убирает пробный элемент.
   */
  dispose: () => void;
};
