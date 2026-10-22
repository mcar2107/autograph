import { roundTo } from '../../../../../lib/format/formatNumber';
import type { SideEdge } from '../../../../../lib/paper';
import type { ValueRange } from '../MarginsTool/marginsGeometry.types';

export const FROM_FRAME_TOP = 'от\u00A0верха кадра';

export const FROM_FRAME_LEFT = 'от\u00A0левого края кадра';

/**
 * Общая оговорка к числам: поля листа на снимке отсчитываются от сторон
 * листа, а числа — от краёв кадра, и без оговорки их путают.
 */
export const EXACT_VALUES_LEGEND =
  'Числа — в\u00A0пикселях фотографии, от\u00A0краёв кадра, а\u00A0не\u00A0листа.';

/**
 * От чего отсчитана первая линия. Минус обещан только ей: она бывает и выше
 * кадра, а поля и боковые границы за край кадра не заходят.
 */
export const FIRST_LINE_REFERENCE =
  'от\u00A0верха кадра у\u00A0левого края; выше кадра — с\u00A0минусом';

/**
 * От чего отсчитано число боковой границы: правое поле — отступ от правого
 * края, остальные — столбец от левого, и у линии поля на любой стороне тоже:
 * отсчёт от ближней стороны менялся бы вместе со стороной посреди набора.
 */
export const SIDE_REFERENCES: Record<SideEdge, string> = {
  left: FROM_FRAME_LEFT,
  right: 'от\u00A0правого края кадра',
  marginLine: FROM_FRAME_LEFT,
};

/**
 * Десятые, в которые округляется край отрезка: наружу округлённое число
 * разметка бы не приняла. Шум пересечения наклонных прямых снимается до
 * округления, иначе 540 показалось бы как 539,9.
 *
 * @param value — край отрезка, px
 * @param round — `Math.ceil` для начала, `Math.floor` для конца
 * @returns край отрезка по-русски, с запятой
 */
const formatRangeEnd = (value: number, round: (value: number) => number): string => {
  return String(round(roundTo(value, 6) * 10) / 10).replace('.', ',');
};

/**
 * Причина отказа числу вне отрезка, который разметка принимает.
 *
 * @param range — отрезок чисел, px
 * @returns текст ошибки у поля
 */
export const formatRangeRejection = (range: ValueRange): string => {
  const { min, max } = range;

  return `Можно от\u00A0${formatRangeEnd(min, Math.ceil)} до\u00A0${formatRangeEnd(max, Math.floor)}\u00A0px: дальше край листа или\u00A0другое поле.`;
};
