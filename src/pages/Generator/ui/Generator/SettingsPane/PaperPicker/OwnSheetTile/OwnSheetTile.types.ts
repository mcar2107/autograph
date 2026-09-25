import type { PaperSheet } from '../../../../../lib/paper';

export type OwnSheetTileProps = {
  /**
   * Свой лист плитки.
   */
  sheet: PaperSheet;

  /**
   * Лист закреплён за текущей страницей.
   */
  isSelected: boolean;

  /**
   * Разметка сейчас недоступна — разбирается новая фотография.
   */
  isMarkupDisabled: boolean;

  /**
   * Колбэк на выбор листа.
   */
  onSelect: () => void;

  /**
   * Колбэк на открытие разметки листа.
   */
  onMarkupOpen: () => void;
};
