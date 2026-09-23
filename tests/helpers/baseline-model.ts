import type { BlockGeometry } from '@pages/Generator/lib/calibrate';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';

/**
 * Шаг строк так, как его получает отрисовка: естественная высота строчного
 * бокса плюс межстрочная добавка. Добавка — внешний отступ строки, внутрь
 * бокса она не идёт.
 *
 * @param geometry — вычисленная геометрия блока
 * @param metrics — метрики шрифта, которым набран текст
 * @returns расстояние между базовыми линиями соседних строк в пикселях
 */
export const getLineStep = (geometry: BlockGeometry, metrics: FontMetrics): number => {
  return geometry.fontSizePx * metrics.lineHeight + geometry.lineSpacing;
};

/**
 * Положение базовой линии строки так, как его получает отрисовка: верх блока,
 * подъём строчного бокса и целое число шагов строк.
 *
 * Положение отсчитано в координате вдоль линий `U = y − x·tg θ` (с перспективой
 * — в её координате): на листе без наклона и перспективы это высота от верха
 * листа, на наклонном — высота линии в столбце `x = 0`. Отрисовка ставит
 * строку ровно на эту координату, в какую бы сторону ни был повёрнут блок.
 *
 * @param geometry — вычисленная геометрия блока
 * @param metrics — метрики шрифта, которым набран текст
 * @param lineIndex — номер строки от нуля
 * @returns координата базовой линии вдоль линий разлиновки в пикселях
 */
export const getBaselineY = (
  geometry: BlockGeometry,
  metrics: FontMetrics,
  lineIndex: number
): number => {
  return (
    geometry.topOffset +
    metrics.fontAscent * geometry.fontSizePx +
    lineIndex * getLineStep(geometry, metrics)
  );
};
