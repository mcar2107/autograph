import type { SheetPoint } from '../../../../../lib/paper';
import type { MarkupMoveSource } from '../MarkupHandle';

import type { PinEnd } from './linesPins';

/**
 * Правка закреплённых линий черновика.
 */
export type LinesEdit = {
  /**
   * Булавка, которую правили последней. По ней подсвечивается расстановка,
   * которая разлиновку не задаёт. `null` — булавки ещё не правили.
   */
  lastEditedOrder: number | null;

  /**
   * Промежуточная точка перетаскивания конца: гребёнка следует за ним без
   * шага истории.
   */
  moveEnd: (order: number, end: PinEnd, point: SheetPoint) => void;

  /**
   * Завершённый сдвиг конца: магнит, если конец отпущен указателем без
   * Alt/Option, подгонка гребёнки и изгиба — шаг истории. Сдвиг стрелкой
   * магнит не притягивает: иначе конец у линии возвращался бы на неё и
   * точная правка на пиксель была бы невозможна.
   */
  releaseEnd: (
    order: number,
    end: PinEnd,
    point: SheetPoint,
    source: MarkupMoveSource
  ) => void;

  /**
   * Меняет число шагов между соседними булавками.
   */
  changeGapSteps: (gap: number, delta: number) => void;

  /**
   * Закрепляет ещё одну линию в самом широком промежутке.
   */
  addPin: () => void;

  /**
   * Открепляет линию, если закреплённых остаётся не меньше двух.
   */
  removePin: (order: number) => void;
};
