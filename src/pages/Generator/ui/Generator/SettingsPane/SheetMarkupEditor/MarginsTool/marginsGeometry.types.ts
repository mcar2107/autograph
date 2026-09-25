import type { SheetPoint } from '../../../../../lib/paper';

/**
 * Поле листа, которое правится направляющей.
 */
export type MarginSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Поле, которое правится одной направляющей вдоль линий: верхнее или нижнее.
 */
export type GuideMarginSide = 'top' | 'bottom';

/**
 * Конец боковой границы блока, который правится ручкой: верхний или нижний.
 */
export type SideHandleEnd = 'top' | 'bottom';

/**
 * Две ручки боковой границы блока в пикселях фотографии.
 */
export type SideHandles = Record<SideHandleEnd, SheetPoint>;

/**
 * Ручки полей и линии поля и верхняя и нижняя направляющие в пикселях
 * фотографии.
 */
export type MarginHandles = {
  /**
   * Ручка верхнего поля.
   */
  top: SheetPoint;

  /**
   * Ручка нижнего поля.
   */
  bottom: SheetPoint;

  /**
   * Ручки левого поля — на верхней и нижней направляющих.
   */
  left: SideHandles;

  /**
   * Ручки правого поля — на верхней и нижней направляющих.
   */
  right: SideHandles;

  /**
   * Ручки линии поля — на трети и двух третях высоты листа. `null` — линии
   * поля нет.
   */
  marginLine: SideHandles | null;

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
