import type { RulingBendRadius, SheetPoint, SheetRuling } from '../../../../../lib/paper';
import {
  lineCoordinateAt,
  lineHeightAt,
  sampleRulingBend,
} from '../../../../../lib/paper';

/**
 * Точка фотографии под указателем. Разметка лежит в SVG с `viewBox` в
 * пикселях фотографии, и обратная экранная матрица SVG уже учитывает
 * приближение и сдвиг окна.
 *
 * @param svg — SVG оверлея
 * @param clientX — горизонталь указателя в окне браузера
 * @param clientY — вертикаль указателя в окне браузера
 * @returns точка в пикселях фотографии; `null` — матрицы нет
 */
export const toPhotoPoint = (
  svg: SVGSVGElement | null | undefined,
  clientX: number,
  clientY: number
): SheetPoint | null => {
  const matrix = svg?.getScreenCTM?.();

  if (!matrix) {
    return null;
  }

  const { a, b, c, d, e, f } = matrix.inverse();

  return { x: a * clientX + c * clientY + e, y: b * clientX + d * clientY + f };
};

/**
 * Высота линии в столбце такой, какой её рисует оверлей: гребёнка с наклоном
 * и перспективой плюс изгиб.
 *
 * @param ruling — разлиновка листа
 * @param x — столбец, px фотографии
 * @param u — координата линии вдоль линий
 * @returns высота, px фотографии
 */
const toDrawnLineY = (ruling: SheetRuling, x: number, u: number): number => {
  const straight = lineHeightAt(ruling, x, u);

  return ruling.bend
    ? straight + sampleRulingBend(ruling.bend, ruling, x, straight)
    : straight;
};

/**
 * Точка нарисованной линии, ближайшей к указателю в его столбце: за неё
 * линия берётся при перетаскивании. Взятая точка лежит на самой линии, и
 * нажатие без сдвига линию не двигает.
 *
 * @param ruling — разлиновка листа
 * @param point — точка под указателем, px фотографии
 * @returns точка на линии; `null` — шага нет
 */
export const findLinePoint = (
  ruling: SheetRuling,
  point: SheetPoint
): SheetPoint | null => {
  const { step, firstLinePhase } = ruling;

  if (!(step > 0)) {
    return null;
  }

  const { x, y } = point;
  const guess = Math.round((lineCoordinateAt(ruling, x, y) - firstLinePhase) / step);
  const heights = [guess - 1, guess, guess + 1].map((index) => {
    return toDrawnLineY(ruling, x, firstLinePhase + index * step);
  });
  const nearest = heights.reduce((best, height) => {
    return Math.abs(height - y) < Math.abs(best - y) ? height : best;
  });

  return { x, y: nearest };
};

/**
 * Рамка у курсора: докуда дотягивается правка изгиба — за ней линии не
 * сдвигаются. Правка раздаёт сдвиг узлам с весом по строкам и по столбцам
 * отдельно, поэтому её след — не эллипс, а полоса между двумя линиями
 * гребёнки, обрезанная двумя вертикалями: эллипс срезал бы углы, где линии
 * ещё сдвигаются. Верх и низ рамки идут вдоль линий — на наклонном листе и
 * на листе с перспективой линия с постоянной координатой остаётся прямой.
 *
 * @param ruling — разлиновка листа
 * @param center — курсор, px фотографии
 * @param reach — дальность правки (`resolveBendReach`)
 * @returns углы рамки по обходу, px фотографии
 */
export const buildBendRing = (
  ruling: SheetRuling,
  center: SheetPoint,
  reach: RulingBendRadius
): SheetPoint[] => {
  const { x, y } = center;
  const u = lineCoordinateAt(ruling, x, y);
  const left = x - reach.radiusX;
  const right = x + reach.radiusX;

  return [
    { x: left, y: lineHeightAt(ruling, left, u - reach.radius) },
    { x: right, y: lineHeightAt(ruling, right, u - reach.radius) },
    { x: right, y: lineHeightAt(ruling, right, u + reach.radius) },
    { x: left, y: lineHeightAt(ruling, left, u + reach.radius) },
  ];
};
