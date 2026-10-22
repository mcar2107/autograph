import type { SheetPoint } from '../../../../../lib/paper';

import type { LoupeBounds, LoupePlacement } from './Loupe.types';

/**
 * Поперечник лупы в пикселях окна, им же лупа задана в разметке. Сорок
 * линий фотографии при самом мелком увеличении: видны и линия, и бумага по
 * обе её стороны.
 */
export const LOUPE_SIZE = 160;

/**
 * Во сколько раз лупа крупнее окна просмотра.
 */
const LOUPE_MAGNIFICATION = 4;

/**
 * Наименьшее увеличение лупы, экранных пикселей на пиксель фотографии: при
 * вписанной фотографии четыре раза к окну мельче самой фотографии, а лупа
 * нужна, чтобы разглядеть её пиксели.
 */
const LOUPE_MIN_ZOOM = 2;

/**
 * Зазор между пальцем или курсором и краем лупы, px окна: палец закрывает
 * пятно около сантиметра, и лупа встаёт над ним, а не под ним.
 */
const LOUPE_OFFSET = 40;

/**
 * Наименьший отступ лупы от края окна, px.
 */
const LOUPE_EDGE_GAP = 8;

/**
 * Увеличение лупы при масштабе окна.
 *
 * @param scale — экранных пикселей на пиксель фотографии в окне
 * @returns экранных пикселей на пиксель фотографии в лупе
 */
export const resolveLoupeZoom = (scale: number): number => {
  return Math.max(LOUPE_MIN_ZOOM, scale * LOUPE_MAGNIFICATION);
};

/**
 * Где поставить лупу: над указателем, чтобы её не закрыли ни палец, ни
 * курсор, а у верхнего края окна — под ним. Внутри окна лупа держится по
 * обеим осям: в низком окне, где она не встаёт ни над указателем, ни под ним,
 * лупа, наехавшая на указатель, полезнее лупы за нижним краем.
 *
 * @param anchor — указатель в окне браузера
 * @param bounds — размер окна
 * @returns левый верхний угол лупы, px окна
 */
export const resolveLoupePlacement = (
  anchor: SheetPoint,
  bounds: LoupeBounds
): LoupePlacement => {
  const above = anchor.y - LOUPE_OFFSET - LOUPE_SIZE;
  const maxLeft = Math.max(LOUPE_EDGE_GAP, bounds.width - LOUPE_SIZE - LOUPE_EDGE_GAP);
  const maxTop = Math.max(LOUPE_EDGE_GAP, bounds.height - LOUPE_SIZE - LOUPE_EDGE_GAP);
  const top = above >= LOUPE_EDGE_GAP ? above : anchor.y + LOUPE_OFFSET;

  return {
    left: Math.min(Math.max(anchor.x - LOUPE_SIZE / 2, LOUPE_EDGE_GAP), maxLeft),
    top: Math.min(top, maxTop),
  };
};
