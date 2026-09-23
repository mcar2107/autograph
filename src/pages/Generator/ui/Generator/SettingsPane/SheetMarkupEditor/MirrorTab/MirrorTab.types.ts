import type { MarkupToolId } from '../SheetMarkupEditor.types';

export type MirrorTabProps = {
  /**
   * Страница, разметка которой показана: 0 — сам лист, 1 — зеркальная
   * страница разворота.
   */
  pageIndex: number;

  /**
   * Выбранный инструмент: ручки полей зеркала стоят в окне только с «Полями».
   */
  tool: MarkupToolId;

  /**
   * Слой ручек поверх фотографии. `null` — слой ещё не смонтирован.
   */
  handleLayer: SVGGElement | null;

  /**
   * Колбэк на смену показанной страницы.
   */
  onPageIndexChange: (pageIndex: number) => void;
};
