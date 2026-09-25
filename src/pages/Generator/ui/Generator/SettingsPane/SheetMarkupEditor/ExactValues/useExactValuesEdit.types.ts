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
   * Задаёт шаг разлиновки, px фотографии. Шаг не больше нуля не
   * применяется.
   */
  changeStep: (step: number) => void;

  /**
   * Задаёт положение первой линии, px фотографии.
   */
  changeFirstLine: (phase: number) => void;

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
