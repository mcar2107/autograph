import type { SheetImageData, SheetPoint } from './paper.types';
import { computeQuantile } from './quantile';
import { detrendProfile, refinePeakOffset, smoothProfile } from './sheetProfile';
import { TRACE_SEARCH_SHARE } from './traceRulingLines';

/**
 * Направление поиска: `rows` — поперёк горизонтальной линии разлиновки, по
 * строкам столбца; `columns` — поперёк вертикальной черты поля, по столбцам
 * строки.
 */
type SnapAxis = 'rows' | 'columns';

/**
 * Полудлина профиля поперёк линии в шагах. Шаг в обе стороны — чтобы фон,
 * вычитаемый из профиля, мерился по бумаге между линиями, а не по склону
 * искомой.
 */
const PROFILE_REACH_STEPS = 1;

/**
 * Полудлина полосы вдоль линии, по которой усредняется яркость, в шагах.
 * Четверть шага гасит шум бумаги, а наклон линии в пару градусов уводит её на
 * этой длине меньше чем на сотую шага.
 */
const ALONG_REACH_SHARE = 1 / 4;

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
 * @param across — первый отсчёт профиля поперёк линии
 * @param count — число отсчётов профиля
 * @param along — центр полосы вдоль линии
 * @param alongReach — полудлина полосы вдоль линии
 * @returns профиль яркости
 */
const buildSnapProfile = (
  image: SheetImageData,
  axis: SnapAxis,
  across: number,
  count: number,
  along: number,
  alongReach: number
): Float64Array => {
  const { width, height, luminance } = image;
  const alongSize = axis === 'rows' ? width : height;
  const alongFrom = Math.max(0, along - alongReach);
  const alongTo = Math.min(alongSize - 1, along + alongReach);
  const profile = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const position = across + index;
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
  const acrossValue = axis === 'rows' ? point.y : point.x;
  const alongValue = axis === 'rows' ? point.x : point.y;
  const acrossSize = axis === 'rows' ? image.height : image.width;
  const alongSize = axis === 'rows' ? image.width : image.height;

  if (
    !Number.isFinite(step) ||
    step <= 0 ||
    !Number.isFinite(acrossValue) ||
    !Number.isFinite(alongValue) ||
    acrossValue < 0 ||
    acrossValue > acrossSize - 1 ||
    alongValue < 0 ||
    alongValue > alongSize - 1
  ) {
    return null;
  }

  const reach = Math.ceil(PROFILE_REACH_STEPS * step);
  const center = Math.round(acrossValue);
  const from = Math.max(0, center - reach);
  const to = Math.min(acrossSize - 1, center + reach);
  const count = to - from + 1;
  const alongReach = Math.max(1, Math.round(ALONG_REACH_SHARE * step));
  const profile = smoothProfile(
    buildSnapProfile(image, axis, from, count, Math.round(alongValue), alongReach),
    SMOOTH_WINDOW
  );
  const detrended = detrendProfile(profile, Math.round(BACKGROUND_WINDOW_STEPS * step));
  const searchReach = TRACE_SEARCH_SHARE * step;
  const windowFrom = Math.max(1, Math.ceil(acrossValue - searchReach) - from);
  const windowTo = Math.min(count - 2, Math.floor(acrossValue + searchReach) - from);
  let peak = -1;
  let depth = 0;

  for (let bin = windowFrom; bin <= windowTo; bin += 1) {
    const binDepth = -(detrended[bin] || 0);

    if (binDepth > depth) {
      peak = bin;
      depth = binDepth;
    }
  }

  if (peak < 0) {
    return null;
  }

  const previous = -(detrended[peak - 1] || 0);
  const next = -(detrended[peak + 1] || 0);

  if (previous > depth || next > depth) {
    return null;
  }

  const deviations = Array.from(detrended, (value) => {
    return Math.abs(value);
  });
  const noise = MEDIAN_TO_SIGMA * computeQuantile(deviations, 0.5);

  if (depth < Math.max(MIN_DEPTH, NOISE_FACTOR * noise)) {
    return null;
  }

  return from + peak + refinePeakOffset(previous, depth, next);
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
