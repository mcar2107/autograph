import { refinePeakOffset } from './sheetProfile';
import type { SnapPeak, SnapProfileWindow } from './snapProfileWindow.types';
import { TRACE_SEARCH_SHARE } from './traceRulingLines';

/**
 * Полудлина профиля поперёк линии в шагах. Шаг в обе стороны — чтобы фон,
 * вычитаемый из профиля, мерился по бумаге между линиями, а не по склону
 * искомой, у каждого отсчёта окна поиска в треть шага.
 */
const PROFILE_REACH_STEPS = 1;

/**
 * Полудлина полосы вдоль линии, по которой усредняется отсчёт, в шагах.
 * Четверть шага гасит шум бумаги, а наклон линии в пару градусов уводит её на
 * этой длине меньше чем на сотую шага. Полоса в полшага — и та же высота, что
 * у полос, по которым краснота мерится при поиске линии поля.
 */
const ALONG_REACH_SHARE = 1 / 4;

/**
 * Профиль и окно поиска магнита вокруг отпущенной точки. Магнит линии
 * разлиновки и магнит черты поля меряют одно и то же окно, и у обоих его
 * задаёт эта функция: окно в треть шага — то же, что у трассы линий
 * (`traceRulingLines.ts`), профиль — на шаг в обе стороны.
 *
 * @param across — координата точки поперёк искомой линии, px
 * @param along — координата точки вдоль искомой линии, px
 * @param acrossSize — размер изображения поперёк линии, px
 * @param alongSize — размер изображения вдоль линии, px
 * @param step — шаг разлиновки у точки, px
 * @returns профиль и окно; `null` — точка вне изображения или шаг негоден
 */
export const resolveSnapProfileWindow = (
  across: number,
  along: number,
  acrossSize: number,
  alongSize: number,
  step: number
): SnapProfileWindow | null => {
  if (
    !Number.isFinite(step) ||
    step <= 0 ||
    !Number.isFinite(across) ||
    !Number.isFinite(along) ||
    across < 0 ||
    across > acrossSize - 1 ||
    along < 0 ||
    along > alongSize - 1
  ) {
    return null;
  }

  const reach = Math.ceil(PROFILE_REACH_STEPS * step);
  const center = Math.round(across);
  const from = Math.max(0, center - reach);
  const to = Math.min(acrossSize - 1, center + reach);
  const count = to - from + 1;
  const alongReach = Math.max(1, Math.round(ALONG_REACH_SHARE * step));
  const alongCenter = Math.round(along);
  const searchReach = TRACE_SEARCH_SHARE * step;

  return {
    from,
    count,
    alongFrom: Math.max(0, alongCenter - alongReach),
    alongTo: Math.min(alongSize - 1, alongCenter + alongReach),
    windowFrom: Math.max(1, Math.ceil(across - searchReach) - from),
    windowTo: Math.min(count - 2, Math.floor(across + searchReach) - from),
  };
};

/**
 * Отсчёт окна с наибольшей оценкой. При равных оценках берётся первый.
 *
 * @param window — окно поиска
 * @param scoreAt — оценка отсчёта профиля по его номеру
 * @param floor — оценка, которую отсчёт должен превзойти, чтобы стать вершиной
 * @returns номер вершины в профиле и её оценка; `null` — ни один отсчёт окна
 *   не превзошёл `floor`
 */
export const findSnapPeak = (
  { windowFrom, windowTo }: SnapProfileWindow,
  scoreAt: (bin: number) => number,
  floor: number
): SnapPeak | null => {
  let peak = -1;
  let best = floor;

  for (let bin = windowFrom; bin <= windowTo; bin += 1) {
    const score = scoreAt(bin);

    if (score > best) {
      peak = bin;
      best = score;
    }
  }

  return peak < 0 ? null : { bin: peak, score: best };
};

/**
 * Координата вершины, уточнённая параболой по трём отсчётам. Вершина на краю
 * окна, у которой соседний отсчёт за окном выше, — склон линии за окном, а не
 * линия в нём: такая вершина не притягивает.
 *
 * @param window — окно поиска
 * @param scoreAt — оценка отсчёта профиля по его номеру
 * @param peak — номер вершины в профиле
 * @param score — оценка вершины
 * @returns координата линии поперёк неё, px; `null` — вершина — склон
 */
export const refineSnapPeak = (
  { from }: SnapProfileWindow,
  scoreAt: (bin: number) => number,
  peak: number,
  score: number
): number | null => {
  const previous = scoreAt(peak - 1);
  const next = scoreAt(peak + 1);

  if (previous > score || next > score) {
    return null;
  }

  return from + peak + refinePeakOffset(previous, score, next);
};
