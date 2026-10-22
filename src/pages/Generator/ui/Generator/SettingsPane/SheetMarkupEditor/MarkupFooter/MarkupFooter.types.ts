export type MarkupFooterProps = {
  /**
   * Колбэк на «Сбросить к найденному».
   */
  onReset: () => void;

  /**
   * Колбэк на «Отмена».
   */
  onCancel: () => void;

  /**
   * «Сохранить» недоступно: разметка ещё не готова к применению.
   */
  isSaveDisabled: boolean;

  /**
   * Колбэк на «Сохранить».
   */
  onSave: () => void;
};
