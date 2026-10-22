import type { MarkupView } from './markupView.types';

/**
 * Положение фотографии в окне редактора вместе с методами его смены.
 */
export type MarkupViewControl = {
  /**
   * Текущее положение фотографии.
   */
  view: MarkupView;

  /**
   * Приближает на шаг вокруг центра окна.
   */
  zoomIn: () => void;

  /**
   * Отдаляет на шаг вокруг центра окна.
   */
  zoomOut: () => void;

  /**
   * Вписывает фотографию в окно.
   */
  fit: () => void;

  /**
   * Сдвигает фотографию на экранные пиксели.
   */
  panBy: (dx: number, dy: number) => void;
};
