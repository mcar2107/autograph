import type {
  PaperMargins,
  RulingProjection,
  SheetFrame,
  SheetRuling,
  SheetRulingSource,
} from './paper.types';
import { resolveSheetBounds } from './resolveSheetBounds';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { normalizeSideSlant } from './sideEdges';

/**
 * На сколько шагов разлиновки блок отступает от края кадра с той стороны, где
 * поле не нашлось. Отступ задан шагами, а не пикселями: масштаб у каждой
 * фотографии свой, и только доля шага даёт одинаковое поле на любом снимке.
 * Полтора шага на пресет-паке — около восьмидесяти пикселей.
 */
export const MARGIN_FALLBACK_STEPS = 1.5;

/**
 * Допуск округления до линии в долях шага. Поле, стоящее ровно на линии,
 * после вычитания фазы и деления на шаг даёт не целое, а целое плюс или минус
 * погрешность, и честное округление взяло бы соседнюю линию.
 */
const LINE_SNAP_EPSILON = 1e-6;

const NO_MARGINS: PaperMargins = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Первая линия разлиновки, лежащая на заданной высоте или ниже неё по листу.
 * Высота в кадре растёт вниз, поэтому число округляется вверх.
 *
 * @param y — высота в пикселях кадра
 * @param step — шаг разлиновки, больше нуля
 * @param phase — высота любой линии разлиновки
 * @returns высота линии в пикселях кадра
 */
const ceilToLine = (y: number, step: number, phase: number): number => {
  return phase + Math.ceil((y - phase) / step - LINE_SNAP_EPSILON) * step;
};

/**
 * Координата вдоль линий первой линии разлиновки, лежащей строго ниже
 * верхнего поля у левого края кадра. На ней стоит базовая линия первой строки:
 * поле — верхняя граница области письма, и тело букв первой строки ложится под
 * него, а не над ним. Поле на линии отдаёт строку на следующую линию; поле
 * между линиями — на ближайшую ниже. Отсчёт от линии, а не от поля, держит
 * строки на разлиновке, даже когда поле не кратно шагу.
 *
 * Поле переводится в координату вдоль линий, а не округляется по высоте кадра:
 * при перспективе соседние линии отстоят друг от друга по высоте на разное
 * число пикселей, и округление по высоте встало бы мимо линии. Без
 * перспективы `U(0, y) = y`.
 *
 * @param ruling — разлиновка листа
 * @returns координата вдоль линий; без шага — само верхнее поле
 */
export const resolveFirstLine = (ruling: SheetRuling): number => {
  const { step, firstLinePhase, margins } = ruling;

  if (step <= 0) {
    return margins.top;
  }

  const top = lineCoordinateAt(ruling, 0, margins.top);

  return (
    firstLinePhase +
    (Math.floor((top - firstLinePhase) / step + LINE_SNAP_EPSILON) + 1) * step
  );
};

/**
 * Верхнее поле, под которым первая строка встаёт на линию `firstLine`: поле
 * ложится на линию шагом выше. Так автомат и фолбэк отдают поле той же
 * границей области письма, какой его ставят руками в редакторе, — на линии
 * над первой строкой.
 *
 * Линия над первой может уйти за верх кадра, когда первая строка ближе шага к
 * нему, а поля за край кадра не заходят. Тогда поле встаёт посередине между
 * верхом кадра и первой линией: строго выше неё и ниже линии над ней.
 *
 * @param projection — наклон и перспектива разлиновки
 * @param step — шаг разлиновки больше нуля
 * @param firstLine — координата вдоль линий линии первой строки
 * @returns верхнее поле, px от верха кадра у левого края
 */
export const placeTopMarginAbove = (
  projection: RulingProjection,
  step: number,
  firstLine: number
): number => {
  const above = lineHeightAt(projection, 0, firstLine - step);

  return above > 0 ? above : lineHeightAt(projection, 0, firstLine) / 2;
};

/**
 * Поле, найденное детектором на первой линии области с линиями, переводится
 * в границу области письма — на линию над ней. Первая строка остаётся на той
 * линии, которую нашёл детектор, а поле не на линии (округление при переводе в
 * кадр) отдаёт её на ту же линию, что и до перевода.
 *
 * @param source — разлиновка, как её нашёл детектор, в пикселях кадра
 * @returns разлиновка с верхним полем над первой строкой; ненайденное поле
 *   остаётся нулём
 */
export const liftDetectedTopMargin = (source: SheetRulingSource): SheetRulingSource => {
  const { step, firstLinePhase, margins } = source;

  if (step <= 0 || !margins?.top) {
    return source;
  }

  const projection: RulingProjection = {
    skewAngle: source.skewAngle,
    perspective: source.perspective || null,
  };
  const firstLine = ceilToLine(
    lineCoordinateAt(projection, 0, margins.top),
    step,
    firstLinePhase
  );

  return {
    ...source,
    margins: { ...margins, top: placeTopMarginAbove(projection, step, firstLine) },
  };
};

/**
 * Собирает разлиновку экземпляра из результата детектора или из записи
 * прежней формы. Каждая ненайденная сторона — нулевое поле — получает отступ в
 * полтора шага от стороны листа; у верхнего на этом отступе встаёт первая
 * строка — на ближайшей линии ниже, — а само поле ложится на линию над ней.
 * Линия поля без стороны считается отсутствующей, а концы полей у низа
 * кадра, совпавшие с верхними, — отсутствием наклона.
 *
 * Готовую разлиновку функция не меняет, поэтому её можно звать и на
 * перечитанном из хранилища листе.
 *
 * @param source — шаг, фаза, наклон, перспектива, контур и то, что нашлось из
 *   полей
 * @param frame — кадр фотографии: фолбэк полей отсчитывается от сторон
 *   прямоугольника, вписанного в контур листа, а он задан в кадре
 * @returns разлиновка экземпляра; без шага поля остаются как пришли
 */
export const buildSheetRuling = (
  source: SheetRulingSource,
  frame: SheetFrame
): SheetRuling => {
  const { step, firstLinePhase, skewAngle } = source;
  const margins = source.margins || NO_MARGINS;
  const marginLineX = source.marginLineX || null;
  const marginLineSide = source.marginLineSide || null;
  const hasMarginLine = marginLineX !== null && marginLineSide !== null;
  const ruling: SheetRuling = {
    step,
    firstLinePhase,
    skewAngle,
    margins,
    marginLineX: hasMarginLine ? marginLineX : null,
    marginLineSide: hasMarginLine ? marginLineSide : null,
    sideSlant: normalizeSideSlant(
      source.sideSlant || null,
      margins,
      hasMarginLine ? marginLineX : null
    ),
    /**
     * Чистый лист и ручной ввод без шага не несут ни сетку изгиба, ни
     * перспективу: обе описывают гребёнку, которой у такого листа нет.
     */
    bend: step > 0 ? source.bend || null : null,
    perspective: step > 0 ? source.perspective || null : null,
    outline: source.outline || null,
    mirrorOverride: source.mirrorOverride || null,
  };

  /**
   * Без шага фолбэк считать не от чего: такой лист идёт в ручной ввод
   * разлиновки, а не рисуется молча.
   */
  if (step <= 0) {
    return ruling;
  }

  const bounds = resolveSheetBounds(ruling.outline, frame.width, frame.height);
  const fallback = step * MARGIN_FALLBACK_STEPS;
  /**
   * Первая строка встаёт на линию не выше полутора шагов от верха листа, а
   * поле — на линию над ней. Линия ищется в координате вдоль линий, а не по
   * высоте кадра: при перспективе соседние линии отстоят друг от друга по
   * высоте на разное число пикселей, и округление по высоте встало бы мимо
   * линии.
   */
  const firstLine = ceilToLine(
    lineCoordinateAt(ruling, 0, bounds.top) + fallback,
    step,
    firstLinePhase
  );

  return {
    ...ruling,
    margins: {
      top: margins.top || placeTopMarginAbove(ruling, step, firstLine),
      right: margins.right || bounds.right + fallback,
      bottom: margins.bottom || bounds.bottom + fallback,
      left: margins.left || bounds.left + fallback,
    },
  };
};
