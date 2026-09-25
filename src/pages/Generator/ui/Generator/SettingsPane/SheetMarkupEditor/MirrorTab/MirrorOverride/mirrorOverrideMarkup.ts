import type {
  MarginLineSide,
  RulingMirrorOverride,
  SheetFrame,
  SheetImageData,
  SheetPoint,
  SheetRuling,
  SideEdge,
} from '../../../../../../lib/paper';
import { mirrorSheetRuling, readMarginLineEnds } from '../../../../../../lib/paper';
import {
  placeMarginLine,
  placeMarginLineEnds,
  placeSideEnd,
  placeSideHandleValue,
  removeMarginLine,
  resolveAddedMarginLinePoint,
  snapMarginLineX,
} from '../../MarginsTool/marginsGeometry';
import type { SideHandleEnd } from '../../MarginsTool/marginsGeometry.types';
import { mirrorMarkupPoint } from '../../MarkupViewport';

/**
 * Линия поля и боковые поля зеркала из разлиновки зеркальной страницы.
 *
 * @param page — разлиновка зеркальной страницы
 * @returns линия поля и боковые поля зеркала, px отражённого кадра
 */
const toMirrorOverride = (page: SheetRuling): RulingMirrorOverride => {
  const { margins, marginLineX, marginLineSide, sideSlant } = page;

  return {
    marginLineX,
    marginLineSide,
    marginLeft: margins.left,
    marginRight: margins.right,
    sideSlant,
  };
};

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
  return toMirrorOverride(mirrorSheetRuling(ruling, frame));
};

/**
 * Боковая граница зеркала после перетаскивания одной её ручки — теми же
 * правилами, что граница листа: через ручку и вторую ручку, поле не уже
 * пикселя и не за противоположным, линия поля — внутри отражённого листа.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param end — какая ручка
 * @param point — точка ручки, px отражённого кадра
 * @returns поля зеркала
 */
export const placeMirrorSideEnd = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  end: SideHandleEnd,
  point: SheetPoint
): RulingMirrorOverride => {
  const page = mirrorSheetRuling(ruling, frame);

  return toMirrorOverride(placeSideEnd(page, frame, edge, end, point));
};

/**
 * Боковая граница зеркала, ручка которой стоит в столбце из числа, — тот же
 * итог, что перетаскивание ручки туда.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param end — какая ручка
 * @param value — столбец, у правого поля — отступ от правого края, px
 *   отражённого кадра
 * @returns поля зеркала
 */
export const placeMirrorSideValue = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  end: SideHandleEnd,
  value: number
): RulingMirrorOverride => {
  const page = mirrorSheetRuling(ruling, frame);

  return toMirrorOverride(placeSideHandleValue(page, frame, edge, end, value));
};

/**
 * Линия поля зеркала у заданной стороны. Линия с другой стороны переезжает
 * в столбцы, отражённые по кадру: у тетради, где черта справа на обеих
 * страницах, это ровно столбцы черты листа. Линии не было — она встаёт без
 * наклона в восьмую ширины листа от этой стороны.
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
  const page = mirrorSheetRuling(ruling, frame);

  if (side === null) {
    return toMirrorOverride(removeMarginLine(page));
  }

  if (page.marginLineSide === side) {
    return toMirrorOverride(page);
  }

  const ends = readMarginLineEnds(page);

  if (!ends) {
    const point = resolveAddedMarginLinePoint(
      page,
      frame,
      side === 'right' ? frame.width : 0
    );

    return toMirrorOverride(placeMarginLine(page, frame, point));
  }

  return toMirrorOverride(
    placeMarginLineEnds(page, frame, {
      top: frame.width - ends.top,
      bottom: frame.width - ends.bottom,
    })
  );
};

/**
 * Столбец черты под ручкой линии поля зеркала. Отражённая фотография — та же
 * фотография листа, поэтому черта ищется на ней в отражённом столбце и
 * отражается обратно.
 *
 * @param image — каналы фотографии листа
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param point — где отпущена ручка, px отражённого кадра
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
