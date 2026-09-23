import type {
  MarginLineSide,
  RulingMirrorOverride,
  SheetFrame,
  SheetImageData,
  SheetPoint,
  SheetRuling,
} from '../../../../../../lib/paper';
import { mirrorSheetRuling } from '../../../../../../lib/paper';
import {
  placeMargin,
  placeMarginLine,
  resolveAddedMarginLineX,
  snapMarginLineX,
} from '../../MarginsTool/marginsGeometry';
import { mirrorMarkupPoint } from '../../MarkupViewport';

import type { MirrorMarginSide } from './mirrorOverrideMarkup.types';

/**
 * Линия поля и боковые поля, с которыми зеркальная страница ляжет сейчас:
 * отражённые из листа или заданные отдельно. С них начинается отдельная
 * правка, поэтому переход к ней ничего на странице не сдвигает.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @returns линия поля и боковые поля зеркала, px отражённого кадра
 */
export const readMirrorOverride = (
  ruling: SheetRuling,
  frame: SheetFrame
): RulingMirrorOverride => {
  const { margins, marginLineX, marginLineSide } = mirrorSheetRuling(ruling, frame);

  return {
    marginLineX,
    marginLineSide,
    marginLeft: margins.left,
    marginRight: margins.right,
  };
};

/**
 * Боковое поле зеркала в столбце `x` — теми же правилами, что поле листа: не
 * уже пикселя и не за противоположным полем. Поле не бывает нулевым:
 * запись листа с таким полем зеркала читается без полей зеркала вовсе.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param side — какое поле
 * @param x — столбец края блока, px отражённого кадра
 * @returns поля зеркала с новым боковым
 */
export const placeMirrorMargin = (
  ruling: SheetRuling,
  frame: SheetFrame,
  side: MirrorMarginSide,
  x: number
): RulingMirrorOverride => {
  const page = mirrorSheetRuling(ruling, frame);
  const { left, right } = placeMargin(page, frame, side, { x, y: 0 }, false);

  return { ...readMirrorOverride(ruling, frame), marginLeft: left, marginRight: right };
};

/**
 * Линия поля зеркала в столбце `x`: внутри контура отражённого листа, сторона
 * — по положению относительно его середины.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param x — столбец, px отражённого кадра
 * @returns поля зеркала с новой линией поля
 */
export const placeMirrorMarginLine = (
  ruling: SheetRuling,
  frame: SheetFrame,
  x: number
): RulingMirrorOverride => {
  const page = mirrorSheetRuling(ruling, frame);

  return { ...readMirrorOverride(ruling, frame), ...placeMarginLine(page, frame, x) };
};

/**
 * Линия поля зеркала у заданной стороны. Линия с другой стороны переезжает
 * в столбец, отражённый по кадру: у тетради, где черта справа на обеих
 * страницах, это ровно столбец черты листа. Линии не было — она встаёт в
 * восьмую ширины листа от этой стороны.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param side — сторона; `null` — линии поля у зеркала нет
 * @returns поля зеркала
 */
export const placeMirrorMarginLineSide = (
  ruling: SheetRuling,
  frame: SheetFrame,
  side: MarginLineSide | null
): RulingMirrorOverride => {
  const current = readMirrorOverride(ruling, frame);

  if (side === null) {
    return { ...current, marginLineX: null, marginLineSide: null };
  }

  if (current.marginLineSide === side) {
    return current;
  }

  const page = mirrorSheetRuling(ruling, frame);
  const x =
    current.marginLineX === null
      ? resolveAddedMarginLineX(page, frame, side === 'right' ? frame.width : 0)
      : frame.width - current.marginLineX;

  return { ...current, ...placeMarginLine(page, frame, x) };
};

/**
 * Столбец черты под линией поля зеркала. Отражённая фотография — та же
 * фотография листа, поэтому черта ищется на ней в отражённом столбце и
 * отражается обратно.
 *
 * @param image — каналы фотографии листа
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param point — где отпущена линия, px отражённого кадра
 * @returns столбец линии, px отражённого кадра
 */
export const snapMirrorMarginLineX = (
  image: SheetImageData,
  ruling: SheetRuling,
  frame: SheetFrame,
  point: SheetPoint
): number => {
  const sheetPoint = mirrorMarkupPoint(point, frame.width);

  return frame.width - snapMarginLineX(image, ruling, sheetPoint);
};
