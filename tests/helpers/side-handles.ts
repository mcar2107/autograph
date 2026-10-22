import type { SheetPoint } from '@pages/Generator/lib/paper';
import { within } from '@testing-library/react';

/**
 * Ручки боковой границы: верхняя и нижняя.
 */
export const SIDE_HANDLE_ENDS = ['сверху', 'снизу'] as const;

/**
 * Где ручка стоит сейчас: в атрибутах круга, в пикселях слоя ручек.
 *
 * @param handle — ручка
 * @returns точка ручки
 */
export const readHandlePoint = (handle: Element): SheetPoint => {
  return {
    x: Number(handle.getAttribute('cx')),
    y: Number(handle.getAttribute('cy')),
  };
};

/**
 * Ставит боковую границу в столбец целиком: сначала верхнюю ручку, потом
 * нижнюю — каждую в её строке. Так поле без наклона ставится двумя ручками.
 *
 * @param editor — диалог редактора
 * @param name — имя границы без конца: «Левое поле», «Линия поля»
 * @param x — столбец в пикселях слоя ручек
 * @param drag — перетаскивание ручки в точку
 */
export const dragSideEdge = (
  editor: HTMLElement,
  name: string,
  x: number,
  drag: (handle: HTMLElement, point: SheetPoint) => void
): void => {
  SIDE_HANDLE_ENDS.forEach((end) => {
    const handle = within(editor).getByRole('button', { name: `${name} ${end}` });

    drag(handle, { x, y: readHandlePoint(handle).y });
  });
};

/**
 * Углы области текста у бокового поля: верхний и нижний.
 */
export const MARGIN_CORNER_ROWS = ['верхний', 'нижний'] as const;

/**
 * Ставит боковое поле в столбец целиком: сначала верхний угол области текста,
 * потом нижний — каждый в его строке, так что поля по высоте не сдвигаются.
 *
 * @param editor — диалог редактора
 * @param side — какое поле: «Левый» или «Правый»
 * @param x — столбец в пикселях слоя ручек
 * @param drag — перетаскивание ручки в точку
 */
export const dragMarginSide = (
  editor: HTMLElement,
  side: 'Левый' | 'Правый',
  x: number,
  drag: (handle: HTMLElement, point: SheetPoint) => void
): void => {
  MARGIN_CORNER_ROWS.forEach((row) => {
    const handle = within(editor).getByRole('button', {
      name: `${side} ${row} угол полей`,
    });

    drag(handle, { x, y: readHandlePoint(handle).y });
  });
};
