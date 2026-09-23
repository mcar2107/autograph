export type MirrorTabProps = {
  /**
   * Страница, разметка которой показана: 0 — сам лист, 1 — зеркальная
   * страница разворота.
   */
  pageIndex: number;

  /**
   * Колбэк на смену показанной страницы.
   */
  onPageIndexChange: (pageIndex: number) => void;
};
