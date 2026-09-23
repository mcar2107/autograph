import type { SheetFrame } from '../../../../../lib/paper';

import type { MarkupView, MarkupViewPoint, MarkupViewportSize } from './markupView.types';

/**
 * Самое крупное приближение — восемь экранных пикселей на пиксель
 * фотографии: вдвое больше четырёх, при которых уже видно, на какой пиксель
 * линии легла точка разметки.
 */
export const MARKUP_ZOOM_MAX = 8;

/**
 * Во сколько раз можно отдалить фотографию от вписанной: дальше она
 * превращается в точку, а разметку уже не разглядеть.
 */
const FIT_ZOOM_OUT = 4;

/**
 * Отступ вписанной фотографии от краёв окна, экранные пиксели.
 */
const FIT_PADDING = 16;

/**
 * Шаг кнопок приближения: два нажатия удваивают масштаб.
 */
export const MARKUP_ZOOM_STEP = Math.SQRT2;

/**
 * Масштаб, при котором фотография целиком помещается в окно с отступами.
 * Окно, ещё не измеренное, и фотография без кадра дают единицу: отрисовка до
 * первого замера не должна делить на ноль.
 *
 * @param viewport — размер окна
 * @param frame — кадр фотографии
 * @returns вписанный масштаб
 */
export const computeFitScale = (
  viewport: MarkupViewportSize,
  frame: SheetFrame
): number => {
  const availableWidth = viewport.width - 2 * FIT_PADDING;
  const availableHeight = viewport.height - 2 * FIT_PADDING;

  if (
    frame.width <= 0 ||
    frame.height <= 0 ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return 1;
  }

  return Math.min(availableWidth / frame.width, availableHeight / frame.height);
};

/**
 * Держит масштаб между отдалённым вписанным и наибольшим приближением.
 *
 * @param scale — масштаб
 * @param fitScale — вписанный масштаб
 * @returns масштаб в допустимых пределах
 */
export const clampScale = (scale: number, fitScale: number): number => {
  const min = Math.min(fitScale / FIT_ZOOM_OUT, MARKUP_ZOOM_MAX);

  return Math.min(MARKUP_ZOOM_MAX, Math.max(min, scale));
};

/**
 * Фотография, вписанная в окно по центру.
 *
 * @param viewport — размер окна
 * @param frame — кадр фотографии
 * @returns положение фотографии
 */
export const fitView = (viewport: MarkupViewportSize, frame: SheetFrame): MarkupView => {
  const scale = computeFitScale(viewport, frame);

  return {
    scale,
    x: (viewport.width - frame.width * scale) / 2,
    y: (viewport.height - frame.height * scale) / 2,
  };
};

/**
 * Новый масштаб вокруг точки окна: точка фотографии под ней остаётся под
 * ней — так приближение колесом ведёт к курсору, а не к углу снимка.
 *
 * @param view — текущее положение
 * @param scale — новый масштаб, уже в допустимых пределах
 * @param anchor — точка окна, которая остаётся на месте
 * @returns положение после смены масштаба
 */
export const zoomView = (
  view: MarkupView,
  scale: number,
  anchor: MarkupViewPoint
): MarkupView => {
  const ratio = scale / view.scale;

  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
};
