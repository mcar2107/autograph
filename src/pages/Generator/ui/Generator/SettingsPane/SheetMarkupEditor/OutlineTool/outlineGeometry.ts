import type { SheetFrame, SheetOutline } from '../../../../../lib/paper';
import { resolveSheetBounds } from '../../../../../lib/paper';

import type { OutlineVerdict } from './OutlineTool.types';

/**
 * Какая доля кадра по ширине и по высоте должна остаться внутри контура: в
 * меньшем куске не набирается строк ни на поиск шага, ни на страницу текста.
 */
const MIN_FRAME_SHARE = 1 / 4;

/**
 * Углы контура по часовой стрелке от левого верхнего: в этом порядке идут
 * ручки и проверка выпуклости.
 */
export const OUTLINE_CORNERS = [
  'topLeft',
  'topRight',
  'bottomRight',
  'bottomLeft',
] as const;

/**
 * Контур, по которому идут ручки: у листа во весь кадр — углы кадра.
 *
 * @param outline — контур листа; `null` — лист во весь кадр
 * @param frame — кадр фотографии
 * @returns контур с четырьмя углами
 */
export const resolveOutline = (
  outline: SheetOutline | null,
  frame: SheetFrame
): SheetOutline => {
  const { width, height } = frame;

  return (
    outline || {
      topLeft: { x: 0, y: 0 },
      topRight: { x: width, y: 0 },
      bottomRight: { x: width, y: height },
      bottomLeft: { x: 0, y: height },
    }
  );
};

/**
 * Совпадают ли контуры угол в угол.
 *
 * @param left — один контур
 * @param right — другой контур
 * @returns совпадают ли
 */
export const isSameOutline = (left: SheetOutline, right: SheetOutline): boolean => {
  return OUTLINE_CORNERS.every((corner) => {
    return left[corner].x === right[corner].x && left[corner].y === right[corner].y;
  });
};

/**
 * Выпуклый ли контур с обходом по часовой стрелке на экране: повороты во всех
 * углах в одну сторону. Встречный обход — это углы, переставленные местами, а
 * поворот в другую сторону — вогнутый угол; ни там, ни там вписанного
 * прямоугольника листа нет.
 *
 * @param outline — контур
 * @returns выпуклый ли
 */
const isConvexClockwise = (outline: SheetOutline): boolean => {
  const points = OUTLINE_CORNERS.map((corner) => {
    return outline[corner];
  });

  return points.every((point, index) => {
    const next = points[(index + 1) % points.length] || point;
    const after = points[(index + 2) % points.length] || point;
    const cross =
      (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);

    return cross > 0;
  });
};

/**
 * Проверяет, годится ли контур для перемера листа.
 *
 * @param outline — контур
 * @param frame — кадр фотографии
 * @returns вердикт
 */
export const checkOutline = (
  outline: SheetOutline,
  frame: SheetFrame
): OutlineVerdict => {
  if (!isConvexClockwise(outline)) {
    return 'inverted';
  }

  const { width, height } = frame;
  const { top, right, bottom, left } = resolveSheetBounds(outline, width, height);

  return width - left - right < width * MIN_FRAME_SHARE ||
    height - top - bottom < height * MIN_FRAME_SHARE
    ? 'narrow'
    : 'usable';
};
