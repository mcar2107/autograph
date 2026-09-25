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
 * Угол области текста — пересечение верхней или нижней направляющей с левым
 * или правым полем.
 */
export type MarginCorner = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

/**
 * Боковое поле, которое угол области текста правит по горизонтали.
 */
export type MarginCornerEdge = 'left' | 'right';

/**
 * Из чего сложен угол области текста.
 */
export type MarginCornerParts = {
  /**
   * Направляющая, которую угол двигает по высоте.
   */
  side: GuideMarginSide;

  /**
   * Боковое поле, конец которого угол двигает вдоль строки.
   */
  edge: MarginCornerEdge;
};

/**
 * Как сдвинули угол области текста: `drag` — перетаскивание идёт, `drop` —
 * отпущен, `nudgeX` и `nudgeY` — стрелкой вдоль строк или поперёк.
 */
export type MarginCornerMove = 'drag' | 'drop' | 'nudgeX' | 'nudgeY';

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
   * Ручка верхнего поля — середина верхнего края области текста.
   */
  top: SheetPoint;

  /**
   * Ручка нижнего поля — середина нижнего края области текста.
   */
  bottom: SheetPoint;

  /**
   * Углы области текста у левого поля — на верхней и нижней направляющих.
   */
  left: SideHandles;

  /**
   * Углы области текста у правого поля — на верхней и нижней направляющих.
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
