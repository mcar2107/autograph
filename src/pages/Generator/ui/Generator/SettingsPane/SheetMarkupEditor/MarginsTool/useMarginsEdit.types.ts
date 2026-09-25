import type { SheetPoint, SideEdge } from '../../../../../lib/paper';
import type { MarkupMoveSource } from '../MarkupHandle';

import type {
  GuideMarginSide,
  MarginCorner,
  SideHandleEnd,
} from './marginsGeometry.types';

/**
 * Правка полей и линии поля черновика.
 */
export type MarginsEdit = {
  /**
   * Добавленная линия поля идёт за указателем над фотографией, пока нажатие
   * её не поставит.
   */
  isFollowing: boolean;

  /**
   * Промежуточное положение верхней или нижней направляющей — без шага
   * истории.
   */
  moveMargin: (side: GuideMarginSide, point: SheetPoint) => void;

  /**
   * Отпускание верхней или нижней направляющей — шаг истории. С магнитом она
   * встаёт на линию, без него — стоит, где отпущена.
   */
  releaseMargin: (side: GuideMarginSide, point: SheetPoint, shouldSnap: boolean) => void;

  /**
   * Начало перетаскивания угла области текста: точка нажатия, px листа. От
   * её строки мерится, сдвинут ли угол по высоте.
   */
  startCorner: (point: SheetPoint) => void;

  /**
   * Промежуточное положение угла области текста — без шага истории. Пока
   * указатель по высоте не ушёл от строки нажатия дальше порога дрожи, поле
   * по высоте стоит на месте.
   */
  moveCorner: (corner: MarginCorner, point: SheetPoint) => void;

  /**
   * Завершённый сдвиг угла области текста: направляющая и конец бокового
   * поля угла — одним шагом истории. Перетаскивание, за которое указатель по
   * высоте не ушёл дальше порога дрожи, поле по высоте не трогает и на линию
   * его не ставит.
   */
  releaseCorner: (
    corner: MarginCorner,
    point: SheetPoint,
    source: MarkupMoveSource,
    cornerPoint: SheetPoint
  ) => void;

  /**
   * Промежуточное положение ручки бокового поля или линии поля — без шага
   * истории. Граница проходит через эту ручку и через вторую.
   */
  moveSideEnd: (edge: SideEdge, end: SideHandleEnd, point: SheetPoint) => void;

  /**
   * Отпускание ручки бокового поля или линии поля — шаг истории. С магнитом
   * ручка линии поля притягивается к черте фотографии, без него стоит, где
   * отпущена.
   */
  releaseSideEnd: (
    edge: SideEdge,
    end: SideHandleEnd,
    point: SheetPoint,
    shouldSnap: boolean
  ) => void;

  /**
   * Убирает линию поля.
   */
  removeMarginLine: () => void;

  /**
   * Добавляет линию поля у стороны листа, ближайшей к видимой части
   * фотографии, — шаг истории — и начинает вести её указателем.
   */
  addMarginLine: () => void;
};

/**
 * Идущее перетаскивание угла области текста.
 */
export type CornerDrag = {
  /**
   * Строка нажатия, px листа.
   */
  startY: number;

  /**
   * Ушёл ли указатель по высоте от строки нажатия дальше порога дрожи.
   */
  isVertical: boolean;
};
