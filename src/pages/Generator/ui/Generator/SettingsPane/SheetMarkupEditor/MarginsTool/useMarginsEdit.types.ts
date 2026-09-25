import type { SheetPoint, SideEdge } from '../../../../../lib/paper';

import type { GuideMarginSide, SideHandleEnd } from './marginsGeometry.types';

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
   * Отпускание верхней или нижней направляющей: она встаёт на линию — шаг
   * истории.
   */
  releaseMargin: (side: GuideMarginSide, point: SheetPoint) => void;

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
