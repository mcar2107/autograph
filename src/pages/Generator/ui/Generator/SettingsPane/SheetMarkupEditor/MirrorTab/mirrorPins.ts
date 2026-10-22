import type { RulingPin } from '../../../../../lib/paper';

/**
 * Булавки листа на зеркальной странице — для показа в оверлее. Концы
 * меняются местами: левый конец булавки листа после отражения стоит справа, а
 * у булавки левый конец обязан лежать левее правого.
 *
 * @param pins — булавки листа, px фотографии
 * @param width — ширина кадра, px
 * @returns булавки в пикселях отражённого кадра, в том же порядке
 */
export const mirrorPins = (pins: RulingPin[], width: number): RulingPin[] => {
  return pins.map(({ index, left, right }) => {
    return {
      index,
      left: { x: width - right.x, y: right.y },
      right: { x: width - left.x, y: left.y },
    };
  });
};
