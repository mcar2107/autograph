import type { SheetFrame, SheetRulingSource } from '@pages/Generator/lib/paper';
import {
  buildSheetRuling,
  lineHeightAt,
  resolveFirstLine,
} from '@pages/Generator/lib/paper';

/**
 * Высота у левого края кадра линии, на которую встаёт первая строка разлиновки
 * из замера. Детектор отдаёт верхнее поле на линии над первой строкой, и с
 * первой линией снимка сверяется не само поле, а эта линия.
 *
 * @param source — разлиновка, как её отдал замер
 * @param frame — кадр фотографии
 * @returns высота первой строки, px кадра
 */
export const readFirstTextLineY = (
  source: SheetRulingSource,
  frame: SheetFrame
): number => {
  const ruling = buildSheetRuling(source, frame);

  return lineHeightAt(ruling, 0, resolveFirstLine(ruling));
};
