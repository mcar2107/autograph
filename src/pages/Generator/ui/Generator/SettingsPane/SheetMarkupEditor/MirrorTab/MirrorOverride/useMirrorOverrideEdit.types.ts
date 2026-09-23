import type { MarginLineSide, SheetPoint } from '../../../../../../lib/paper';

import type { MirrorMarginSide } from './mirrorOverrideMarkup.types';

/**
 * Правка линии поля и боковых полей зеркальной страницы. Точки и столбцы — в
 * пикселях отражённого кадра, как их видно на вкладке зеркала.
 */
export type MirrorOverrideEdit = {
  /**
   * Задаёт линию поля и боковые поля зеркала отдельно, начиная с тех, что
   * видны сейчас, — шаг истории.
   */
  separate: () => void;

  /**
   * Возвращает зеркалу отражение линии поля и боковых полей листа — шаг
   * истории.
   */
  reflect: () => void;

  /**
   * Промежуточное положение бокового поля — без шага истории.
   */
  moveMargin: (side: MirrorMarginSide, x: number) => void;

  /**
   * Ставит боковое поле в столбец — шаг истории.
   */
  setMargin: (side: MirrorMarginSide, x: number) => void;

  /**
   * Промежуточное положение линии поля — без шага истории.
   */
  moveMarginLine: (x: number) => void;

  /**
   * Ставит линию поля в столбец точки — шаг истории. С магнитом линия
   * притягивается к черте фотографии, без него стоит, где поставлена.
   */
  setMarginLine: (point: SheetPoint, shouldSnap: boolean) => void;

  /**
   * Ставит линию поля у стороны или убирает её — шаг истории.
   */
  setMarginLineSide: (side: MarginLineSide | null) => void;
};
