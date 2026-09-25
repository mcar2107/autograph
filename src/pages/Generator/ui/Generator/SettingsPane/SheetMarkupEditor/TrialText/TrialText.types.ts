export type TrialTextProps = {
  /**
   * Слой над фотографией и под разметкой, куда кладётся пробная страница.
   * `null` — слой ещё не смонтирован.
   */
  layer: HTMLElement | null;

  /**
   * Страница разворота: 0 — сам лист, 1 — зеркальная.
   */
  pageIndex: number;

  /**
   * Пробный текст включён.
   */
  isEnabled: boolean;

  /**
   * Колбэк на включение и выключение пробного текста.
   */
  onEnabledChange: (isEnabled: boolean) => void;
};
