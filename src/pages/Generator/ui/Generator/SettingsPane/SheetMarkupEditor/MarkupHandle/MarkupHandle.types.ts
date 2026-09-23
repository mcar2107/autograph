import type { SheetPoint } from '../../../../../lib/paper';

export type MarkupHandleProps = {
  /**
   * Горизонталь ручки в пикселях фотографии.
   */
  x: number;

  /**
   * Вертикаль ручки в пикселях фотографии.
   */
  y: number;

  /**
   * Подпись ручки для читалки: что именно она двигает.
   */
  label: string;

  /**
   * Колбэк на каждое движение перетаскивания: точка под указателем в пикселях
   * фотографии.
   */
  onMove?: (point: SheetPoint) => void;

  /**
   * Колбэк на отпускание: последняя точка перетаскивания.
   */
  onMoveEnd?: (point: SheetPoint) => void;

  /**
   * Дополнительные классы.
   */
  className?: string;
};
