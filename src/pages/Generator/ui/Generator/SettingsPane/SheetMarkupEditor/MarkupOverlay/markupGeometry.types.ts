import type { SheetPoint } from '../../../../../lib/paper';

/**
 * Линия разлиновки в оверлее: ломаная в пикселях фотографии.
 */
export type RulingLinePath = {
  /**
   * Номер линии: её координата вдоль линий — `firstLinePhase + index·step`.
   */
  index: number;

  /**
   * Точки линии слева направо.
   */
  points: SheetPoint[];
};

/**
 * Прямоугольник в пикселях фотографии.
 */
export type MarkupBox = {
  /**
   * Левый край.
   */
  left: number;

  /**
   * Верхний край.
   */
  top: number;

  /**
   * Правый край.
   */
  right: number;

  /**
   * Нижний край.
   */
  bottom: number;
};

/**
 * Верхняя и нижняя границы области письма в оверлее: концы у краёв листа.
 */
export type MarginGuides = {
  /**
   * Граница верхнего поля.
   */
  top: SheetPoint[];

  /**
   * Граница нижнего поля.
   */
  bottom: SheetPoint[];
};
