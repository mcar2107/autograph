import { createContext, useContext } from 'react';

import type { SheetPoint } from '../../../../../lib/paper';

/**
 * Ширина кадра, если в окне зеркальная страница, иначе `null`.
 *
 * Зеркало показывает отражённую фотографию, а ручки инструментов правят
 * разметку самого листа: слой ручек отражён целиком, и точка под указателем
 * переводится в пиксели листа через `x → W − x`. Инструменту остаётся одна
 * система координат — лист, — и разметка у страниц общая по построению.
 */
export const MarkupMirrorContext = createContext<number | null>(null);

/**
 * Ширина кадра зеркальной страницы в окне редактора.
 *
 * @returns ширина кадра, px; `null` — в окне сам лист
 */
export const useMarkupMirrorWidth = (): number | null => {
  return useContext(MarkupMirrorContext);
};

/**
 * Точка отражённого кадра в пикселях самого листа и обратно: отражение по
 * горизонтали — само себе обратное.
 *
 * @param point — точка, px фотографии
 * @param mirrorWidth — ширина кадра зеркальной страницы; `null` — отражения нет
 * @returns точка по другую сторону отражения
 */
export const mirrorMarkupPoint = (
  point: SheetPoint,
  mirrorWidth: number | null
): SheetPoint => {
  return mirrorWidth === null ? point : { x: mirrorWidth - point.x, y: point.y };
};
