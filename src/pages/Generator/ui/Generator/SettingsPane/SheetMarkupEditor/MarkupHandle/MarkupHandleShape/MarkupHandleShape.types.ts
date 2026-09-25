import type { MarkupHandleKind } from '../MarkupHandle.types';

export type MarkupHandleShapeProps = {
  /**
   * Роль ручки.
   */
  kind: MarkupHandleKind;

  /**
   * Горизонталь центра в пикселях фотографии.
   */
  x: number;

  /**
   * Вертикаль центра в пикселях фотографии.
   */
  y: number;

  /**
   * Масштаб просмотра: размеры фигуры заданы в экранных пикселях.
   */
  scale: number;

  /**
   * Толщина обводки в пикселях фотографии.
   */
  strokeWidth: number;

  /**
   * Классы фигуры.
   */
  className: string;
};
