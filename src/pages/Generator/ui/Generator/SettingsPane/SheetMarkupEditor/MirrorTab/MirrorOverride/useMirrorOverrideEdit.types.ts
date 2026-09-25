import type { MarginLineSide, SheetPoint, SideEdge } from '../../../../../../lib/paper';
import type { SideHandleEnd } from '../../MarginsTool/marginsGeometry.types';

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
   * Промежуточное положение ручки бокового поля или линии поля — без шага
   * истории. Граница проходит через эту ручку и через вторую.
   */
  moveSideEnd: (edge: SideEdge, end: SideHandleEnd, point: SheetPoint) => void;

  /**
   * Ставит ручку бокового поля или линии поля в точку — шаг истории. С
   * магнитом ручка линии поля притягивается к черте фотографии, без него
   * стоит, где поставлена.
   */
  setSideEnd: (
    edge: SideEdge,
    end: SideHandleEnd,
    point: SheetPoint,
    shouldSnap: boolean
  ) => void;

  /**
   * Ставит ручку бокового поля или линии поля в столбец из числа — шаг
   * истории. У правого поля число — отступ от правого края.
   */
  setSideValue: (edge: SideEdge, end: SideHandleEnd, value: number) => void;

  /**
   * Ставит линию поля у стороны или убирает её — шаг истории.
   */
  setMarginLineSide: (side: MarginLineSide | null) => void;
};
