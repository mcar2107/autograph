import type { RulingBendRadius, SheetPoint, SheetRuling } from '../../../../../lib/paper';
import {
  bentLineHeightAt,
  lineCoordinateAt,
  lineHeightAt,
} from '../../../../../lib/paper';

import type { BendLineGrab } from './bendGeometry.types';

/**
 * Линия, ближайшая к указателю в его столбце: за неё линия берётся при
 * перетаскивании, её же подсвечивает наведение. Взятая точка лежит на самой
 * линии, и нажатие без сдвига линию не двигает.
 *
 * @param ruling — разлиновка листа
 * @param point — точка под указателем, px фотографии
 * @returns точка на линии, номер линии и шаг у неё; `null` — шага нет
 */
export const findLinePoint = (
  ruling: SheetRuling,
  point: SheetPoint
): BendLineGrab | null => {
  const { step, firstLinePhase } = ruling;

  if (!(step > 0)) {
    return null;
  }

  const { x, y } = point;
  const guess = Math.round((lineCoordinateAt(ruling, x, y) - firstLinePhase) / step);
  const nearest = [guess - 1, guess, guess + 1].reduce<BendLineGrab | null>(
    (best, index) => {
      const height = bentLineHeightAt(
        ruling,
        ruling.bend,
        x,
        firstLinePhase + index * step
      );

      return best && Math.abs(best.point.y - y) <= Math.abs(height - y)
        ? best
        : { point: { x, y: height }, index, localStep: 0 };
    },
    null
  );

  if (!nearest) {
    return null;
  }

  const u = firstLinePhase + nearest.index * step;
  const localStep =
    Math.abs(lineHeightAt(ruling, x, u + step) - lineHeightAt(ruling, x, u - step)) / 2;

  return { ...nearest, localStep };
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
