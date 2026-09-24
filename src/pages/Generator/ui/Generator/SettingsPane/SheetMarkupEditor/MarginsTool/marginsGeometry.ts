import type {
  PaperMargins,
  SheetFrame,
  SheetImageData,
  SheetPoint,
  SheetRuling,
} from '../../../../../lib/paper';
import {
  lineCoordinateAt,
  lineHeightAt,
  lineHeightScaleAt,
  snapMarginLine,
} from '../../../../../lib/paper';
import { buildMarginGuides, toOutlineBox } from '../MarkupOverlay/markupGeometry';

import type {
  MarginCoordinates,
  MarginHandles,
  MarginLinePlacement,
  MarginSide,
} from './marginsGeometry.types';

/**
 * Наименьшее поле, px. Нулевое поле запись листа читает как «поля нет» и
 * подставляет поле от стороны листа, поэтому направляющая, дотянутая до края
 * кадра, встаёт в пиксель от него.
 */
const MIN_MARGIN = 1;

/**
 * На какой доле ширины листа от его стороны появляется добавленная линия
 * поля: там она у школьной тетради и проходит.
 */
const ADDED_MARGIN_LINE_SHARE = 1 / 8;

/**
 * На какой доле высоты листа стоит ручка линии поля: ручки левого и правого
 * полей стоят посередине, и у близких вертикалей ручки не должны лечь друг на
 * друга.
 */
const MARGIN_LINE_HANDLE_SHARE = 1 / 3;

/**
 * Ограничивает число отрезком.
 *
 * @param value — число
 * @param min — нижняя граница
 * @param max — верхняя граница
 * @returns число в `[min, max]`
 */
const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Координата вдоль линий верхней и нижней границ области письма — так же,
 * как их читает автокалибровка (`lib/calibrate/deriveGeometry.ts`): поле
 * задано высотой у левого края кадра.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @returns координаты верхней и нижней границ
 */
const resolveMarginCoordinates = (
  ruling: SheetRuling,
  frame: SheetFrame
): MarginCoordinates => {
  const { margins } = ruling;

  return {
    top: lineCoordinateAt(ruling, 0, margins.top),
    bottom: lineCoordinateAt(ruling, 0, frame.height - margins.bottom),
  };
};

/**
 * Ближайшая линия разлиновки к координате вдоль линий. Без шага линий нет, и
 * координата остаётся как есть.
 *
 * @param ruling — разлиновка листа
 * @param u — координата вдоль линий
 * @returns координата линии
 */
const snapToRulingCoordinate = (ruling: SheetRuling, u: number): number => {
  const { step, firstLinePhase } = ruling;

  if (!(step > 0)) {
    return u;
  }

  return firstLinePhase + Math.round((u - firstLinePhase) / step) * step;
};

/**
 * Где стоят ручки полей и линии поля и где проходят верхняя и нижняя
 * направляющие. Направляющие — те же границы полей, что пунктир оверлея
 * (`buildMarginGuides`): на наклонном листе и на листе с перспективой они идут
 * вдоль линий, а не по строке кадра. Ручки — посередине области письма.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @returns ручки и направляющие в пикселях фотографии
 */
export const resolveMarginHandles = (
  ruling: SheetRuling,
  frame: SheetFrame
): MarginHandles => {
  const { margins, marginLineX } = ruling;
  const box = toOutlineBox(ruling.outline, frame);
  const coordinates = resolveMarginCoordinates(ruling, frame);
  const left = margins.left;
  const right = frame.width - margins.right;
  const middleX = (Math.max(box.left, left) + Math.min(box.right, right)) / 2;
  const top = lineHeightAt(ruling, middleX, coordinates.top);
  const bottom = lineHeightAt(ruling, middleX, coordinates.bottom);
  const middleY = (top + bottom) / 2;
  const guides = buildMarginGuides(ruling, frame);

  return {
    top: { x: middleX, y: top },
    bottom: { x: middleX, y: bottom },
    left: { x: left, y: middleY },
    right: { x: right, y: middleY },
    marginLine:
      marginLineX === null
        ? null
        : {
            x: marginLineX,
            y: box.top + (box.bottom - box.top) * MARGIN_LINE_HANDLE_SHARE,
          },
    topGuide: guides.top,
    bottomGuide: guides.bottom,
  };
};

/**
 * Поля после перетаскивания одной направляющей. Верхняя и нижняя при
 * `shouldSnap` встают на ближайшую линию разлиновки, боковые — куда отпущены.
 * Направляющая не заходит за противоположную и за край кадра.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param side — какое поле
 * @param point — точка ручки, px фотографии
 * @param shouldSnap — ставить ли верхнюю и нижнюю на линию
 * @returns поля листа
 */
export const placeMargin = (
  ruling: SheetRuling,
  frame: SheetFrame,
  side: MarginSide,
  point: SheetPoint,
  shouldSnap: boolean
): PaperMargins => {
  const { margins } = ruling;
  const { width, height } = frame;

  /**
   * Высота границы у левого края кадра — в ней поле и хранится.
   *
   * @returns высота, px
   */
  const toEdgeHeight = (): number => {
    const u = lineCoordinateAt(ruling, point.x, point.y);

    return lineHeightAt(ruling, 0, shouldSnap ? snapToRulingCoordinate(ruling, u) : u);
  };

  switch (side) {
    case 'top': {
      return {
        ...margins,
        top: clamp(toEdgeHeight(), MIN_MARGIN, height - margins.bottom),
      };
    }

    case 'bottom': {
      return {
        ...margins,
        bottom: clamp(height - toEdgeHeight(), MIN_MARGIN, height - margins.top),
      };
    }

    case 'left': {
      return {
        ...margins,
        left: clamp(point.x, MIN_MARGIN, width - margins.right),
      };
    }

    case 'right': {
      return {
        ...margins,
        right: clamp(width - point.x, MIN_MARGIN, width - margins.left),
      };
    }

    default: {
      throw new Error(`Неизвестное поле: ${String(side)}`);
    }
  }
};

/**
 * Линия поля в столбце: внутри листа, а сторона — по положению относительно
 * середины листа.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param x — столбец, px фотографии
 * @returns столбец и сторона линии поля
 */
export const placeMarginLine = (
  ruling: SheetRuling,
  frame: SheetFrame,
  x: number
): MarginLinePlacement => {
  const box = toOutlineBox(ruling.outline, frame);
  const marginLineX = clamp(x, box.left, box.right);

  return {
    marginLineX,
    marginLineSide: marginLineX < (box.left + box.right) / 2 ? 'left' : 'right',
  };
};

/**
 * Столбец новой линии поля: в восьмой доле ширины листа от стороны, ближайшей
 * к столбцу, на который смотрит пользователь, — линия появляется в видимой
 * части листа. Столбца нет или он ровно посередине — от левой стороны: там
 * линия поля у школьной тетради и проходит.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param nearX — столбец, к которому ближе сторона, px фотографии; `null` —
 *   неизвестен
 * @returns столбец, px фотографии
 */
export const resolveAddedMarginLineX = (
  ruling: SheetRuling,
  frame: SheetFrame,
  nearX: number | null
): number => {
  const box = toOutlineBox(ruling.outline, frame);
  const inset = (box.right - box.left) * ADDED_MARGIN_LINE_SHARE;

  return nearX !== null && nearX > (box.left + box.right) / 2
    ? box.right - inset
    : box.left + inset;
};

/**
 * Магнит линии поля: отпущенная вертикаль встаёт на черту поля фотографии в
 * пределах трети местного шага. Шаг — у точки: на листе со столом он к
 * дальнему краю короче.
 *
 * @param image — каналы фотографии
 * @param ruling — разлиновка листа
 * @param point — точка ручки, px фотографии
 * @returns столбец черты; черты в окне нет или шага нет — где отпущена
 */
export const snapMarginLineX = (
  image: SheetImageData,
  ruling: SheetRuling,
  point: SheetPoint
): number => {
  const { x, y } = point;
  const step = ruling.step * lineHeightScaleAt(ruling, x, lineCoordinateAt(ruling, x, y));

  if (!(step > 0)) {
    return x;
  }

  const snapped = snapMarginLine(image, point, step);

  return snapped ? snapped.x : x;
};
