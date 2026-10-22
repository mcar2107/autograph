import type {
  MarginLineSide,
  RulingBend,
  RulingPerspective,
  RulingSideSlant,
  SheetFrame,
  SheetOutline,
  SheetRuling,
} from './paper.types';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { normalizeSideSlant } from './sideEdges';

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Остаток от деления, не уходящий в минус: фаза отражённой разлиновки должна
 * оставаться высотой линии у верха кадра, а не над ним.
 *
 * @param value — делимое
 * @param divisor — делитель, больше нуля
 * @returns остаток в `[0, divisor)`
 */
const toPositiveModulo = (value: number, divisor: number): number => {
  return ((value % divisor) + divisor) % divisor;
};

/**
 * Край линии поля после отражения.
 *
 * @param side — край до отражения
 * @returns противоположный край; `null` — линии поля нет
 */
const flipMarginLineSide = (side: MarginLineSide | null): MarginLineSide | null => {
  switch (side) {
    case 'left': {
      return 'right';
    }

    case 'right': {
      return 'left';
    }

    default: {
      return null;
    }
  }
};

/**
 * Сетка изгиба отражённой фотографии. Строки узлов сдвигаются на тот же наклон
 * во всю ширину кадра, что и фаза: координата вдоль линий отсчитывается у
 * левого края, а он после отражения — бывший правый. Первым узлом становится
 * отражённый последний, поэтому у несимметричной области с линиями сетка
 * ложится в другое место кадра.
 *
 * @param bend — сетка изгиба листа; `null` — линии прямые
 * @param shift — наклон разлиновки во всю ширину кадра в пикселях
 * @param width — ширина кадра фотографии в пикселях
 * @returns сетка отражённой фотографии; `null` — линии прямые
 */
const mirrorRulingBend = (
  bend: RulingBend | null,
  shift: number,
  width: number
): RulingBend | null => {
  if (!bend) {
    return null;
  }

  const { columnOrigin, columnSpacing, columnCount, rowOrigin, offsets } = bend;

  return {
    ...bend,
    columnOrigin: width - (columnOrigin + (columnCount - 1) * columnSpacing),
    rowOrigin: rowOrigin + shift,
    offsets: offsets.map((_, index) => {
      const column = index % columnCount;

      return offsets[index - column + columnCount - 1 - column] || 0;
    }),
  };
};

/**
 * Перспектива отражённой фотографии: начало отсчёта переезжает к другому краю
 * кадра, схождение линий по ширине меняет знак, дрейф шага по высоте остаётся
 * прежним. При такой подстановке координата вдоль линий отражённого кадра
 * отличается от исходной ровно на наклон во всю ширину — тем же слагаемым, что
 * и фаза.
 *
 * @param perspective — перспектива листа; `null` — линии идут через равный шаг
 * @param width — ширина кадра фотографии в пикселях
 * @returns перспектива отражённой фотографии
 */
const mirrorPerspective = (
  perspective: RulingPerspective | null,
  width: number
): RulingPerspective | null => {
  if (!perspective) {
    return null;
  }

  return {
    ...perspective,
    originX: width - perspective.originX,
    /**
     * `|| 0` убирает отрицательный ноль у листа без схождения по ширине: он
     * неотличим в расчётах, но сравнение через `Object.is` видит в нём другое
     * значение.
     */
    convergenceX: -perspective.convergenceX || 0,
  };
};

/**
 * Концы полей и линии поля у низа отражённого кадра: левое и правое меняются
 * местами, линия поля переезжает в отражённый столбец — как и концы у верха.
 *
 * @param slant — концы у низа кадра листа; `null` — наклона нет
 * @param width — ширина кадра фотографии в пикселях
 * @returns концы у низа отражённого кадра
 */
const mirrorSideSlant = (
  slant: RulingSideSlant | null,
  width: number
): RulingSideSlant | null => {
  if (!slant) {
    return null;
  }

  return {
    left: slant.right,
    right: slant.left,
    marginLineX: slant.marginLineX === null ? null : width - slant.marginLineX,
  };
};

/**
 * Контур листа на отражённой фотографии: углы переезжают по горизонтали, а
 * левые меняются местами с правыми — иначе обход четырёхугольника вывернулся
 * бы, и вписанный прямоугольник вышел бы за лист.
 *
 * @param outline — контур листа; `null` — лист во весь кадр
 * @param width — ширина кадра фотографии в пикселях
 * @returns контур на отражённой фотографии
 */
const mirrorOutline = (
  outline: SheetOutline | null,
  width: number
): SheetOutline | null => {
  if (!outline) {
    return null;
  }

  const { topLeft, topRight, bottomRight, bottomLeft } = outline;

  return {
    topLeft: { x: width - topRight.x, y: topRight.y },
    topRight: { x: width - topLeft.x, y: topLeft.y },
    bottomRight: { x: width - bottomLeft.x, y: bottomLeft.y },
    bottomLeft: { x: width - bottomRight.x, y: bottomRight.y },
  };
};

/**
 * Разлиновка того же листа, отражённого по горизонтали, — правой половины
 * разворота.
 *
 * Отражение меняет и вертикальные величины: наклонная линия, шедшая у правого
 * края кадра, после отражения оказывается у левого, где отсчитываются фаза и
 * поля, — ниже на наклон во всю ширину кадра. Двойное отражение эту поправку
 * сокращает, поэтому проверять её нужно попаданием строки на линию отражённой
 * фотографии.
 *
 * Отдельно заданные у зеркала линия поля и боковые поля (`mirrorOverride`)
 * заменяют отражённые; у результата `mirrorOverride` всегда `null`.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии в пикселях: нижнее поле отсчитывается от низа
 *   кадра, поэтому одной ширины мало
 * @returns разлиновка отражённой фотографии в тех же пикселях
 */
export const mirrorSheetRuling = (
  ruling: SheetRuling,
  frame: SheetFrame
): SheetRuling => {
  const { step, firstLinePhase, skewAngle, margins, marginLineX, marginLineSide } =
    ruling;
  const { width, height } = frame;
  const shift = Math.tan(skewAngle / DEGREES_IN_RADIAN) * width;
  const phase = firstLinePhase + shift;

  /**
   * Прямая, шедшая у левого края кадра, после отражения проходит там, где она
   * шла у правого. Высота берётся через координату вдоль линий: при перспективе
   * поправка не сводится к одному наклону во всю ширину, а зависит от того, на
   * какой высоте прямая идёт.
   *
   * @param y — высота прямой у левого края кадра в пикселях
   * @returns её высота у левого края отражённого кадра
   */
  const mirrorEdge = (y: number): number => {
    return lineHeightAt(ruling, width, lineCoordinateAt(ruling, 0, y));
  };

  const mirrored: SheetRuling = {
    step,
    firstLinePhase: step > 0 ? toPositiveModulo(phase, step) : phase,
    /**
     * `|| 0` убирает отрицательный ноль у ровного листа: он неотличим в
     * расчётах, но сравнение через `Object.is` видит в нём другое значение.
     */
    skewAngle: -skewAngle || 0,
    margins: {
      top: mirrorEdge(margins.top),
      right: margins.left,
      bottom: height - mirrorEdge(height - margins.bottom),
      left: margins.right,
    },
    marginLineX: marginLineX === null ? null : width - marginLineX,
    marginLineSide: flipMarginLineSide(marginLineSide),
    sideSlant: mirrorSideSlant(ruling.sideSlant, width),
    bend: mirrorRulingBend(ruling.bend, shift, width),
    perspective: mirrorPerspective(ruling.perspective, width),
    outline: mirrorOutline(ruling.outline, width),
    /**
     * Отражённая разлиновка — уже зеркальная страница: своего зеркала у неё
     * нет, и повторное отражение не должно было бы применять поля зеркала к
     * оригиналу.
     */
    mirrorOverride: null,
  };

  if (!ruling.mirrorOverride) {
    return mirrored;
  }

  const { marginLeft, marginRight, sideSlant, ...marginLine } = ruling.mirrorOverride;
  const hasMarginLine =
    marginLine.marginLineX !== null && marginLine.marginLineSide !== null;

  const pageMargins = { ...mirrored.margins, left: marginLeft, right: marginRight };
  const pageMarginLineX = hasMarginLine ? marginLine.marginLineX : null;

  return {
    ...mirrored,
    margins: pageMargins,
    marginLineX: pageMarginLineX,
    marginLineSide: hasMarginLine ? marginLine.marginLineSide : null,
    sideSlant: normalizeSideSlant(sideSlant, pageMargins, pageMarginLineX),
  };
};
