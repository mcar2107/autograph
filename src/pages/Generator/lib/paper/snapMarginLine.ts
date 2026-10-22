import {
  isColourVetoEnabled,
  MARGIN_LINE_MIN_REDNESS,
  measureRedGreenP99,
} from './marginLineRedness';
import type { SheetImageData, SheetPoint } from './paper.types';
import { computeMovingMedian } from './quantile';
import {
  findSnapPeak,
  refineSnapPeak,
  resolveSnapProfileWindow,
} from './snapProfileWindow';
import type { SnapProfileWindow } from './snapProfileWindow.types';
import { snapToMarginLine } from './snapToRulingLine';

/**
 * Решение гейта серого снимка по изображению. Мера — 99-й процентиль по всему
 * кадру, десяток миллионов значений на снимке телефона, а изображение в
 * редакторе одно на всё время правки: мерить её на каждое отпускание незачем.
 */
const colourGateCache = new WeakMap<SheetImageData, boolean>();

/**
 * Включён ли на изображении цветовой поиск: у него есть канал `R − G`, и гейт
 * серого снимка считает его цветным.
 *
 * @param image — изображение листа
 * @returns `true` — черта ищется по красноте
 */
const isColourImage = (image: SheetImageData): boolean => {
  const cached = colourGateCache.get(image);

  if (cached !== undefined) {
    return cached;
  }

  const isColour = isColourVetoEnabled(measureRedGreenP99(image));

  colourGateCache.set(image, isColour);

  return isColour;
};

/**
 * Средняя `R − G` по полосе вдоль черты для каждого столбца профиля.
 *
 * @param redMinusGreen — канал `R − G` изображения
 * @param width — ширина изображения
 * @param snapWindow — профиль и полоса вдоль черты
 * @returns профиль в уровнях
 */
const buildRednessProfile = (
  redMinusGreen: Int16Array,
  width: number,
  { from, count, alongFrom, alongTo }: SnapProfileWindow
): Float64Array => {
  const profile = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const x = from + index;
    let sum = 0;

    for (let y = alongFrom; y <= alongTo; y += 1) {
      sum += redMinusGreen[y * width + x] || 0;
    }

    profile[index] = sum / (alongTo - alongFrom + 1);
  }

  return profile;
};

/**
 * Магнит красной черты: столбец с наибольшим избытком `R − G` над фоном в
 * окне в треть шага, уточнённый параболой.
 *
 * Избыток — та же мера, по которой краснота кандидата решается при поиске
 * линии поля (`marginLineRedness.ts`): среднее по полосе в полшага над
 * скользящей медианой в шаг, окно фона — `max(3, round(step))`. Порог тот же —
 * `MARGIN_LINE_MIN_REDNESS`: ниже него столбец — нейтральная вертикаль, а не
 * черта. Вершина на краю окна, у которой соседний столбец за окном краснее, —
 * склон черты за окном, а не черта в нём.
 *
 * @param image — изображение листа с каналом `R − G`
 * @param redMinusGreen — канал `R − G`
 * @param point — отпущенная точка вертикали, px фото
 * @param step — шаг разлиновки, px
 * @returns столбец черты; `null` — красной черты в окне нет
 */
const findRedColumn = (
  image: SheetImageData,
  redMinusGreen: Int16Array,
  point: SheetPoint,
  step: number
): number | null => {
  const { width, height } = image;
  const snapWindow = resolveSnapProfileWindow(point.x, point.y, width, height, step);

  if (!snapWindow) {
    return null;
  }

  const means = buildRednessProfile(redMinusGreen, width, snapWindow);
  const background = computeMovingMedian(means, Math.max(3, Math.round(step)));

  const excessAt = (bin: number): number => {
    return (means[bin] || 0) - (background[bin] || 0);
  };

  const peak = findSnapPeak(snapWindow, excessAt, Number.NEGATIVE_INFINITY);

  if (!peak || peak.score < MARGIN_LINE_MIN_REDNESS) {
    return null;
  }

  return refineSnapPeak(snapWindow, excessAt, peak.bin, peak.score);
};

/**
 * Магнит линии поля: отпущенная вертикаль встаёт на черту поля фотографии в
 * своей строке в пределах трети шага.
 *
 * На цветном снимке черта ищется по красноте: красная черта по яркости
 * бледнее вертикалей клетки, и самая тёмная вертикаль окна — чаще клетка, чем
 * черта. Нейтральная вертикаль там не притягивает вовсе. На сером снимке и у
 * изображения без канала `R − G` (гейт серого снимка из `marginLineRedness.ts`)
 * цвета нет, и магнит ищет самую тёмную вертикаль.
 *
 * @param image — изображение листа
 * @param point — отпущенная точка вертикали, px фото
 * @param step — шаг разлиновки у точки, px: окно поиска меряется им
 * @returns точка на черте, строка та же; `null` — черты в окне нет, вертикаль
 *   остаётся где отпущена
 */
export const snapMarginLine = (
  image: SheetImageData,
  point: SheetPoint,
  step: number
): SheetPoint | null => {
  const { redMinusGreen } = image;

  if (!redMinusGreen || !isColourImage(image)) {
    return snapToMarginLine(image, point, step);
  }

  const x = findRedColumn(image, redMinusGreen, point, step);

  return x === null ? null : { x, y: point.y };
};
