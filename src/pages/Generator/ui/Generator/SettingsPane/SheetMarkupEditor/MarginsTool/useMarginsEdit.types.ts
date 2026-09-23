import type { SheetPoint } from '../../../../../lib/paper';

import type { MarginSide } from './marginsGeometry.types';

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
   * Промежуточное положение направляющей поля — без шага истории.
   */
  moveMargin: (side: MarginSide, point: SheetPoint) => void;

  /**
   * Отпускание направляющей поля: верхняя и нижняя встают на линию — шаг
   * истории.
   */
  releaseMargin: (side: MarginSide, point: SheetPoint) => void;

  /**
   * Промежуточное положение линии поля — без шага истории.
   */
  moveMarginLine: (point: SheetPoint) => void;

  /**
   * Отпускание линии поля: магнит к черте фотографии — шаг истории.
   */
  releaseMarginLine: (point: SheetPoint) => void;

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
