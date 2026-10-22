import type { SheetPoint } from '../../../../lib/paper';

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
