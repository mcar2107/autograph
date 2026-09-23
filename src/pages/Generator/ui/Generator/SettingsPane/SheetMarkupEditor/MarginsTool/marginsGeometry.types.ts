import type { MarginLineSide, SheetPoint } from '../../../../../lib/paper';

/**
 * Поле листа, которое правится направляющей.
 */
export type MarginSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Ручки полей и линии поля и верхняя и нижняя направляющие в пикселях
 * фотографии.
 */
export type MarginHandles = Record<MarginSide, SheetPoint> & {
  /**
   * Ручка линии поля. `null` — линии поля нет.
   */
  marginLine: SheetPoint | null;

  /**
   * Верхняя направляющая — концы у краёв листа.
   */
  topGuide: SheetPoint[];

  /**
   * Нижняя направляющая — концы у краёв листа.
   */
  bottomGuide: SheetPoint[];
};

/**
 * Верхняя и нижняя границы области письма в координате вдоль линий.
 */
export type MarginCoordinates = {
  /**
   * Верхняя граница.
   */
  top: number;

  /**
   * Нижняя граница.
   */
  bottom: number;
};

/**
 * Положение линии поля в разлиновке.
 */
export type MarginLinePlacement = {
  /**
   * Столбец линии поля, px фотографии.
   */
  marginLineX: number;

  /**
   * Сторона листа, у которой она проходит.
   */
  marginLineSide: MarginLineSide;
};
