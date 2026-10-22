import type { SheetImageData, SheetPoint } from './paper.types';
import { computeQuantile } from './quantile';
import { detrendProfile, smoothProfile } from './sheetProfile';
import {
  findSnapPeak,
  refineSnapPeak,
  resolveSnapProfileWindow,
} from './snapProfileWindow';
import type { SnapProfileWindow } from './snapProfileWindow.types';

/**
 * Направление поиска: `rows` — поперёк горизонтальной линии разлиновки, по
 * строкам столбца; `columns` — поперёк вертикальной черты поля, по столбцам
 * строки.
 */
type SnapAxis = 'rows' | 'columns';

/**
 * Окно сглаживания профиля в отсчётах: три — симметричное и не сдвигает
 * вершину, а одиночный шумный пиксель уже не становится минимумом.
 */
const SMOOTH_WINDOW = 3;

/**
 * Ширина окна фона в шагах: фон — среднее по шагу вокруг отсчёта, провал
 * линии в него входит лишь малой долей.
 */
const BACKGROUND_WINDOW_STEPS = 1;

/**
 * Во сколько раз провал должен быть глубже шума профиля. Шум мерится
 * медианой модулей отклонений: линии занимают малую долю профиля и её не
 * сдвигают. Четыре — компромисс, снятый на живых снимках: при шести магнит
 * не находил каждую четвёртую бледную линию клетки, при четырёх находит 99 %,
 * а за линию между линиями принимает пятисотую долю отпусканий.
 */
const NOISE_FACTOR = 4;

/**
 * Перевод медианы модулей в стандартное отклонение нормального шума.
 */
const MEDIAN_TO_SIGMA = 1.4826;

/**
 * Наименьшая глубина провала в долях яркости: на идеально ровном растре шум
 * нулевой, и порог по шуму пропустил бы любую рябь.
 */
const MIN_DEPTH = 0.01;

/**
 * Средняя яркость по полосе вдоль линии для каждого отсчёта поперёк неё.
 *
 * @param image — изображение листа
 * @param axis — направление поиска
 * @param window — профиль и полоса вдоль линии
 * @returns профиль яркости
 */
const buildSnapProfile = (
  image: SheetImageData,
  axis: SnapAxis,
  { from, count, alongFrom, alongTo }: SnapProfileWindow
): Float64Array => {
  const { width, luminance } = image;
  const profile = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const position = from + index;
    let sum = 0;

    for (let cursor = alongFrom; cursor <= alongTo; cursor += 1) {
      const pixel =
        axis === 'rows' ? position * width + cursor : cursor * width + position;

      sum += luminance[pixel] || 0;
    }

    profile[index] = sum / (alongTo - alongFrom + 1);
  }

  return profile;
};

/**
 * Самая тёмная линия в окне в треть шага вокруг координаты поперёк неё.
 *
 * Тот же поиск, что у трассы линий (`traceRulingLines.ts`): самый глубокий
 * провал окна, уточнённый параболой по трём отсчётам. Провал на краю окна,
 * у которого соседний отсчёт за окном глубже, — склон линии за окном, а не
 * линия в нём: такая линия не притягивает.
 *
 * @param image — изображение листа
 * @param axis — направление поиска
 * @param point — отпущенная точка, px фото
 * @param step — шаг разлиновки у точки, px
 * @returns координата линии поперёк неё; `null` — линии в окне нет
 */
const findSnapCoordinate = (
  image: SheetImageData,
  axis: SnapAxis,
  point: SheetPoint,
  step: number
): number | null => {
  const snapWindow =
    axis === 'rows'
      ? resolveSnapProfileWindow(point.y, point.x, image.height, image.width, step)
      : resolveSnapProfileWindow(point.x, point.y, image.width, image.height, step);

  if (!snapWindow) {
    return null;
  }

  const profile = smoothProfile(buildSnapProfile(image, axis, snapWindow), SMOOTH_WINDOW);
  const detrended = detrendProfile(profile, Math.round(BACKGROUND_WINDOW_STEPS * step));

  const depthAt = (bin: number): number => {
    return -(detrended[bin] || 0);
  };

  const peak = findSnapPeak(snapWindow, depthAt, 0);

  if (!peak) {
    return null;
  }

  const deviations = Array.from(detrended, (value) => {
    return Math.abs(value);
  });
  const noise = MEDIAN_TO_SIGMA * computeQuantile(deviations, 0.5);

  if (peak.score < Math.max(MIN_DEPTH, NOISE_FACTOR * noise)) {
    return null;
  }

  return refineSnapPeak(snapWindow, depthAt, peak.bin, peak.score);
};

/**
 * Магнит линии разлиновки: отпущенный конец закреплённой линии встаёт на
 * самую тёмную линию фотографии в своём столбце в пределах трети шага.
 *
 * @param image — изображение листа
 * @param point — отпущенный конец, px фото
 * @param step — шаг разлиновки у конца, px: окно поиска меряется им
 * @returns конец на линии, столбец тот же; `null` — линии в окне нет, конец
 *   остаётся где отпущен
 */
export const snapToRulingLine = (
  image: SheetImageData,
  point: SheetPoint,
  step: number
): SheetPoint | null => {
  const y = findSnapCoordinate(image, 'rows', point, step);

  return y === null ? null : { x: point.x, y };
};

/**
 * Магнит черты поля по яркости: отпущенная вертикаль встаёт на самую тёмную
 * вертикаль фотографии в своей строке в пределах трети шага. Нужен и серому
 * снимку, где цвета нет, — там это весь магнит черты.
 *
 * @param image — изображение листа
 * @param point — отпущенная точка вертикали, px фото
 * @param step — шаг разлиновки, px: окно поиска меряется им
 * @returns точка на черте, строка та же; `null` — черты в окне нет
 */
export const snapToMarginLine = (
  image: SheetImageData,
  point: SheetPoint,
  step: number
): SheetPoint | null => {
  const x = findSnapCoordinate(image, 'columns', point, step);

  return x === null ? null : { x, y: point.y };
};
