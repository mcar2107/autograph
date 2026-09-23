export type ExactValueFieldProps = {
  /**
   * Подпись поля: что за число и в чём оно.
   */
  label: string;

  /**
   * Текущее значение, px фотографии. `null` — значения нет, поле пустое.
   */
  value: number | null;

  /**
   * Колбэк на применённое число: Enter или уход фокуса с годным числом.
   */
  onValueCommit: (value: number) => void;
};
