import type { SheetPoint, SheetRuling } from '../../../../../lib/paper';

/**
 * Идущее перетаскивание линии.
 */
export type BendDragState = {
  /**
   * Указатель, который тянет линию.
   */
  pointerId: number;

  /**
   * Разлиновка до перетаскивания: каждое промежуточное положение считается
   * от неё, а не от предыдущего показа.
   */
  base: SheetRuling;

  /**
   * Взятая точка на линии, px фотографии.
   */
  grab: SheetPoint;

  /**
   * Высота указателя при нажатии, px фотографии. Линия уходит на сдвиг
   * указателя от неё: нажатие рядом с линией её не дёргает.
   */
  pointerY: number;

  /**
   * Последняя показанная высота указателя, px фотографии. `null` — линию ещё
   * не сдвигали.
   */
  lastY: number | null;
};

/**
 * Перетаскивание линий инструмента «Изгиб».
 */
export type BendDrag = {
  /**
   * Центр рамки радиуса, px фотографии. `null` — курсор вне фотографии.
   */
  ringCenter: SheetPoint | null;

  /**
   * Берёт ближайшую к точке линию. `false` — брать нечего: шага нет.
   */
  grab: (pointerId: number, point: SheetPoint) => boolean;

  /**
   * Промежуточное положение: линия через высоту `y` в столбце взятой точки,
   * без шага истории.
   */
  drag: (pointerId: number, y: number, isWholeColumn: boolean) => void;

  /**
   * Отпускание шагом истории. `y = null` — оставить последнее показанное
   * положение.
   */
  release: (pointerId: number, y: number | null, isWholeColumn: boolean) => void;
};
