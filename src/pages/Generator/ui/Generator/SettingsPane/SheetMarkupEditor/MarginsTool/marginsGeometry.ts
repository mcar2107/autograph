import type {
  MarginLineSide,
  PaperMargins,
  SheetFrame,
  SheetImageData,
  SheetPoint,
  SheetRuling,
  SideEdge,
  SideEdgeEnds,
} from '../../../../../lib/paper';
import {
  intersectSideEdge,
  lineCoordinateAt,
  lineHeightAt,
  lineHeightScaleAt,
  normalizeSideSlant,
  readMarginEnds,
  readMarginLineEnds,
  readSideEdge,
  sideEdgePointAtHeight,
  snapMarginLine,
  toSideEdgeEnds,
  writeSideEdge,
} from '../../../../../lib/paper';
import { buildMarginGuides, toOutlineBox } from '../MarkupOverlay/markupGeometry';
import type { MarkupBox } from '../MarkupOverlay/markupGeometry.types';

import type {
  GuideMarginSide,
  MarginCoordinates,
  MarginHandles,
  SideHandleEnd,
  SideHandles,
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
 * На каких долях высоты листа стоят ручки линии поля. Ручки боковых полей
 * стоят на верхней и нижней направляющих, и у близких границ ручки не должны
 * лечь друг на друга.
 */
const MARGIN_LINE_HANDLE_SHARES: Record<SideHandleEnd, number> = {
  top: 1 / 3,
  bottom: 2 / 3,
};

/**
 * Противоположный конец границы.
 */
const OTHER_END: Record<SideHandleEnd, SideHandleEnd> = {
  top: 'bottom',
  bottom: 'top',
};

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
 * Где боковая граница блока пересекает направляющую поля. Пересечения нет —
 * граница идёт вдоль линий, так поле не ставят, — ручка встаёт на границу в
 * строке направляющей у левого края кадра.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param ends — концы границы
 * @param u — координата направляющей вдоль линий
 * @returns точка, px фотографии
 */
const crossGuide = (
  ruling: SheetRuling,
  frame: SheetFrame,
  ends: SideEdgeEnds,
  u: number
): SheetPoint => {
  return (
    intersectSideEdge(ruling, ends, frame.height, u) ||
    sideEdgePointAtHeight(
      ruling.skewAngle,
      ends,
      frame.height,
      lineHeightAt(ruling, 0, u)
    )
  );
};

/**
 * Строки фотографии, в которых стоят ручки линии поля.
 *
 * @param box — описанный вокруг контура прямоугольник
 * @param end — какая ручка
 * @returns строка, px фотографии
 */
const toMarginLineRow = (box: MarkupBox, end: SideHandleEnd): number => {
  return box.top + (box.bottom - box.top) * MARGIN_LINE_HANDLE_SHARES[end];
};

/**
 * Где стоят ручки полей и линии поля и где проходят верхняя и нижняя
 * направляющие. Направляющие — те же границы полей, что пунктир оверлея
 * (`buildMarginGuides`): на наклонном листе и на листе с перспективой они идут
 * вдоль линий, а не по строке кадра. Ручки верхнего и нижнего полей — в
 * середине своей направляющей между боковыми полями, ручки боковых полей —
 * на пересечении с верхней и нижней направляющими: так боковое поле ставится
 * вдоль стороны листа по углам области письма.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @returns ручки и направляющие в пикселях фотографии
 */
export const resolveMarginHandles = (
  ruling: SheetRuling,
  frame: SheetFrame
): MarginHandles => {
  const box = toOutlineBox(ruling.outline, frame);
  const coordinates = resolveMarginCoordinates(ruling, frame);
  const lineEnds = readMarginLineEnds(ruling);
  const guides = buildMarginGuides(ruling, frame);

  /**
   * Ручки бокового поля на верхней и нижней направляющих.
   *
   * @param ends — концы поля
   * @returns ручки
   */
  const toGuideHandles = (ends: SideEdgeEnds): SideHandles => {
    return {
      top: crossGuide(ruling, frame, ends, coordinates.top),
      bottom: crossGuide(ruling, frame, ends, coordinates.bottom),
    };
  };

  const left = toGuideHandles(readMarginEnds(ruling, frame, 'left'));
  const right = toGuideHandles(readMarginEnds(ruling, frame, 'right'));

  /**
   * Ручка направляющей — посередине между боковыми полями внутри листа.
   *
   * @param end — какая направляющая
   * @returns ручка
   */
  const toGuideMiddle = (end: SideHandleEnd): SheetPoint => {
    const x = (Math.max(box.left, left[end].x) + Math.min(box.right, right[end].x)) / 2;

    return { x, y: lineHeightAt(ruling, x, coordinates[end]) };
  };

  return {
    top: toGuideMiddle('top'),
    bottom: toGuideMiddle('bottom'),
    left,
    right,
    marginLine: lineEnds && {
      top: sideEdgePointAtHeight(
        ruling.skewAngle,
        lineEnds,
        frame.height,
        toMarginLineRow(box, 'top')
      ),
      bottom: sideEdgePointAtHeight(
        ruling.skewAngle,
        lineEnds,
        frame.height,
        toMarginLineRow(box, 'bottom')
      ),
    },
    topGuide: guides.top,
    bottomGuide: guides.bottom,
  };
};

/**
 * Поля после перетаскивания верхней или нижней направляющей. При
 * `shouldSnap` она встаёт на ближайшую линию разлиновки. Направляющая не
 * заходит за противоположную и за край кадра.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param side — какое поле
 * @param point — точка ручки, px фотографии
 * @param shouldSnap — ставить ли на линию
 * @returns поля листа
 */
export const placeMargin = (
  ruling: SheetRuling,
  frame: SheetFrame,
  side: GuideMarginSide,
  point: SheetPoint,
  shouldSnap: boolean
): PaperMargins => {
  const { margins } = ruling;
  const { height } = frame;
  const u = lineCoordinateAt(ruling, point.x, point.y);

  /**
   * Высота границы у левого края кадра — в ней поле и хранится.
   */
  const edgeHeight = lineHeightAt(
    ruling,
    0,
    shouldSnap ? snapToRulingCoordinate(ruling, u) : u
  );

  switch (side) {
    case 'top': {
      return {
        ...margins,
        top: clamp(edgeHeight, MIN_MARGIN, height - margins.bottom),
      };
    }

    case 'bottom': {
      return {
        ...margins,
        bottom: clamp(height - edgeHeight, MIN_MARGIN, height - margins.top),
      };
    }

    default: {
      throw new Error(`Неизвестное поле: ${String(side)}`);
    }
  }
};

/**
 * Сторона линии поля по её положению относительно середины листа.
 *
 * @param ends — концы линии поля
 * @param box — описанный вокруг контура прямоугольник
 * @returns сторона
 */
const resolveMarginLineSide = (ends: SideEdgeEnds, box: MarkupBox): MarginLineSide => {
  return (ends.top + ends.bottom) / 2 < (box.left + box.right) / 2 ? 'left' : 'right';
};

/**
 * Точка ручки боковой границы, не выходящая за соседние: левое поле — не
 * левее пикселя от края кадра и не правее правого поля в той же строке,
 * правое — наоборот, линия поля — внутри листа. Ограничивается сама ручка, а
 * не концы у верха и низа кадра: концы — продолжение границы, и ограничение
 * их повернуло бы границу мимо ручки.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param point — точка ручки, px фотографии
 * @returns точка в допустимых пределах
 */
const clampSidePoint = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  point: SheetPoint
): SheetPoint => {
  const { skewAngle } = ruling;
  const { width, height } = frame;

  /**
   * Столбец поля в строке ручки.
   *
   * @param side — какое поле
   * @returns столбец, px
   */
  const marginAt = (side: MarginLineSide): number => {
    return sideEdgePointAtHeight(
      skewAngle,
      readMarginEnds(ruling, frame, side),
      height,
      point.y
    ).x;
  };

  switch (edge) {
    case 'left': {
      return { ...point, x: clamp(point.x, MIN_MARGIN, marginAt('right')) };
    }

    case 'right': {
      return { ...point, x: clamp(point.x, marginAt('left'), width - MIN_MARGIN) };
    }

    case 'marginLine': {
      const box = toOutlineBox(ruling.outline, frame);

      return { ...point, x: clamp(point.x, box.left, box.right) };
    }

    default: {
      throw new Error(`Неизвестная граница блока: ${String(edge)}`);
    }
  }
};

/**
 * Концы бокового поля, годные для записи: поле у верха и у низа кадра не уже
 * пикселя — нулевое поле запись листа читает как «поля нет». Линию поля это
 * не касается: её концы — просто столбцы.
 *
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param ends — концы границы
 * @returns концы
 */
const clampSideEnds = (
  frame: SheetFrame,
  edge: SideEdge,
  ends: SideEdgeEnds
): SideEdgeEnds => {
  switch (edge) {
    case 'left': {
      return {
        top: Math.max(ends.top, MIN_MARGIN),
        bottom: Math.max(ends.bottom, MIN_MARGIN),
      };
    }

    case 'right': {
      const max = frame.width - MIN_MARGIN;

      return { top: Math.min(ends.top, max), bottom: Math.min(ends.bottom, max) };
    }

    case 'marginLine': {
      return ends;
    }

    default: {
      throw new Error(`Неизвестная граница блока: ${String(edge)}`);
    }
  }
};

/**
 * Разлиновка с новыми концами боковой границы. У линии поля сторона
 * выводится из её положения относительно середины листа.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param ends — концы границы
 * @returns разлиновка
 */
const applySideEnds = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  ends: SideEdgeEnds
): SheetRuling => {
  const clamped = clampSideEnds(frame, edge, ends);
  const next = writeSideEdge(ruling, frame, edge, clamped);

  if (edge !== 'marginLine') {
    return next;
  }

  return {
    ...next,
    marginLineSide: resolveMarginLineSide(clamped, toOutlineBox(ruling.outline, frame)),
  };
};

/**
 * Боковая граница после перетаскивания одной её ручки: граница проходит через
 * точку ручки и через вторую ручку, которая стоит на месте. Так поле ставят
 * вдоль стороны листа, снятого на столе: сторона в кадре наклонена, и
 * вертикаль оставила бы между краем листа и текстом клин.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param end — какая ручка
 * @param point — точка ручки, px фотографии
 * @returns разлиновка; линии поля нет — прежняя
 */
export const placeSideEnd = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  end: SideHandleEnd,
  point: SheetPoint
): SheetRuling => {
  const handles = resolveMarginHandles(ruling, frame);
  const pair = edge === 'marginLine' ? handles.marginLine : handles[edge];

  if (!pair) {
    return ruling;
  }

  const ends = toSideEdgeEnds(
    ruling.skewAngle,
    frame.height,
    clampSidePoint(ruling, frame, edge, point),
    pair[OTHER_END[end]]
  );

  return applySideEnds(ruling, frame, edge, ends);
};

/**
 * Точка, в которую перетащили бы ручку боковой границы, чтобы она встала в
 * столбец `x`: ручка поля идёт по своей направляющей, ручка линии поля — по
 * своей строке.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param end — какая ручка
 * @param x — столбец, px фотографии
 * @returns точка ручки, px фотографии
 */
export const toSideHandlePoint = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  end: SideHandleEnd,
  x: number
): SheetPoint => {
  if (edge === 'marginLine') {
    return { x, y: toMarginLineRow(toOutlineBox(ruling.outline, frame), end) };
  }

  return { x, y: lineHeightAt(ruling, x, resolveMarginCoordinates(ruling, frame)[end]) };
};

/**
 * Линия поля через точку, без наклона к строкам: внутри листа, а сторона —
 * по положению относительно середины листа.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param point — точка линии, px фотографии
 * @returns разлиновка с линией поля
 */
export const placeMarginLine = (
  ruling: SheetRuling,
  frame: SheetFrame,
  point: SheetPoint
): SheetRuling => {
  const inside = clampSidePoint(ruling, frame, 'marginLine', point);

  return placeMarginLineEnds(
    ruling,
    frame,
    toSideEdgeEnds(ruling.skewAngle, frame.height, inside, inside)
  );
};

/**
 * Линия поля с заданными концами: внутри листа, а сторона — по положению
 * относительно середины листа.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param ends — концы линии поля
 * @returns разлиновка с линией поля
 */
export const placeMarginLineEnds = (
  ruling: SheetRuling,
  frame: SheetFrame,
  ends: SideEdgeEnds
): SheetRuling => {
  return applySideEnds(ruling, frame, 'marginLine', ends);
};

/**
 * Разлиновка без линии поля: вместе с ней уходит и её конец у низа кадра.
 *
 * @param ruling — разлиновка листа
 * @returns разлиновка без линии поля
 */
export const removeMarginLine = (ruling: SheetRuling): SheetRuling => {
  return {
    ...ruling,
    marginLineX: null,
    marginLineSide: null,
    sideSlant: normalizeSideSlant(ruling.sideSlant, ruling.margins, null),
  };
};

/**
 * Число, которым боковая граница показывается в «Точных значениях»: столбец
 * ручки, у правого поля — отступ ручки от правого края кадра.
 *
 * @param handles — ручки полей
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param end — какая ручка
 * @returns число, px; `null` — линии поля нет
 */
export const readSideHandleValue = (
  handles: MarginHandles,
  frame: SheetFrame,
  edge: SideEdge,
  end: SideHandleEnd
): number | null => {
  switch (edge) {
    case 'left': {
      return handles.left[end].x;
    }

    case 'right': {
      return frame.width - handles.right[end].x;
    }

    case 'marginLine': {
      return handles.marginLine ? handles.marginLine[end].x : null;
    }

    default: {
      throw new Error(`Неизвестная граница блока: ${String(edge)}`);
    }
  }
};

/**
 * Разлиновка, в которой ручка боковой границы стоит в столбце, заданном
 * числом «Точных значений», — тот же итог, что перетаскивание ручки туда.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param end — какая ручка
 * @param value — число: столбец, у правого поля — отступ от правого края, px
 * @returns разлиновка
 */
export const placeSideHandleValue = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  end: SideHandleEnd,
  value: number
): SheetRuling => {
  const x = edge === 'right' ? frame.width - value : value;

  const point = toSideHandlePoint(ruling, frame, edge, end, x);

  if (edge === 'marginLine' && !readSideEdge(ruling, frame, edge)) {
    return placeMarginLine(ruling, frame, point);
  }

  return placeSideEnd(ruling, frame, edge, end, point);
};

/**
 * Точка новой линии поля: в восьмой доле ширины листа от стороны, ближайшей
 * к столбцу, на который смотрит пользователь, — линия появляется в видимой
 * части листа, — на середине его высоты. Столбца нет или он ровно посередине
 * — от левой стороны: там линия поля у школьной тетради и проходит.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param nearX — столбец, к которому ближе сторона, px фотографии; `null` —
 *   неизвестен
 * @returns точка, px фотографии
 */
export const resolveAddedMarginLinePoint = (
  ruling: SheetRuling,
  frame: SheetFrame,
  nearX: number | null
): SheetPoint => {
  const box = toOutlineBox(ruling.outline, frame);
  const inset = (box.right - box.left) * ADDED_MARGIN_LINE_SHARE;
  const y = (box.top + box.bottom) / 2;

  return nearX !== null && nearX > (box.left + box.right) / 2
    ? { x: box.right - inset, y }
    : { x: box.left + inset, y };
};

/**
 * Магнит линии поля: отпущенная ручка встаёт на черту поля фотографии в
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
