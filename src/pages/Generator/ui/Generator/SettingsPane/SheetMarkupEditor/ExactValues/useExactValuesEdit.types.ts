import type { SideEdge } from '../../../../../lib/paper';
import type {
  GuideMarginSide,
  SideHandleEnd,
} from '../MarginsTool/marginsGeometry.types';

/**
 * Правка разметки числами.
 */
export type ExactValuesEdit = {
  /**
   * Задаёт шаг разлиновки, px фотографии. Возвращает, почему шаг не
   * применён: не больше нуля или линии сошлись бы внутри кадра; `null` —
   * применён.
   */
  changeStep: (step: number) => string | null;

  /**
   * Задаёт положение первой линии, px фотографии. Возвращает, почему не
   * применено; `null` — применено.
   */
  changeFirstLine: (phase: number) => string | null;

  /**
   * Задаёт верхнее или нижнее поле, px фотографии.
   */
  changeMargin: (side: GuideMarginSide, value: number) => void;

  /**
   * Ставит ручку бокового поля или линии поля в столбец, px фотографии; у
   * правого поля число — отступ от правого края. Линии поля нет — она
   * появляется без наклона.
   */
  changeSideEnd: (edge: SideEdge, end: SideHandleEnd, value: number) => void;
};
