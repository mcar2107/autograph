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
   * Задаёт верхнее или нижнее поле, px фотографии. Возвращает, почему не
   * применено: число за краем кадра или за противоположным полем; `null` —
   * применено.
   */
  changeMargin: (side: GuideMarginSide, value: number) => string | null;

  /**
   * Ставит ручку бокового поля или линии поля в столбец, px фотографии; у
   * правого поля число — отступ от правого края. Линии поля нет — она
   * появляется без наклона. Возвращает, почему не применено: ручка в этом
   * столбце вышла бы за лист или за противоположное поле; `null` — применено.
   */
  changeSideEnd: (edge: SideEdge, end: SideHandleEnd, value: number) => string | null;
};
