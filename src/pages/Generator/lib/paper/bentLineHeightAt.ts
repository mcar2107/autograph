import type { RulingBend, RulingProjection } from './paper.types';
import { lineHeightAt } from './rulingPerspective';
import { sampleRulingBend } from './sampleRulingBend';

/**
 * Высота линии с координатой `u` в столбце `x` такой, какой на неё садятся
 * строки страницы: гребёнка с наклоном и перспективой плюс изгиб. Одна на
 * редактор и подгонку булавок — то, что видно в оверлее, и есть линия
 * страницы.
 *
 * @param projection — наклон и перспектива разлиновки
 * @param bend — сетка изгиба; `null` — линия прямая
 * @param x — столбец кадра, px
 * @param u — координата линии вдоль линий
 * @returns высота линии, px кадра
 */
export const bentLineHeightAt = (
  projection: RulingProjection,
  bend: RulingBend | null,
  x: number,
  u: number
): number => {
  const straight = lineHeightAt(projection, x, u);

  return bend ? straight + sampleRulingBend(bend, projection, x, straight) : straight;
};
