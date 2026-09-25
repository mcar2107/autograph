import type { FontMetrics } from '../measure/measure.types';
import { FALLBACK_FONT_METRICS } from '../measure/measureFontMetrics';
import type { MarginLineSide, RulingKind } from '../paper/paper.types';
import { lineCoordinateAt } from '../paper/rulingPerspective';
import { resolveFirstLine } from '../paper/sheetRuling';
import { readSideEdge, resolveSideEdgeAt } from '../paper/sideEdges';
import type { SideEdge } from '../paper/sideEdges.types';

import type {
  BlockGeometry,
  GeometryBasis,
  GeometryCorrection,
  LineEdges,
  SheetCalibration,
} from './calibrate.types';

/**
 * Кегль, относительно которого считается em на границе с DOM. Сама геометрия
 * живёт в пикселях: `em` появляется только там, где размер уезжает в стиль.
 *
 * Верно, пока ни один предок блока текста не меняет `font-size`: в стиле
 * страницы стоит `em`, а не `rem`, поэтому промежуточный размер сдвинул бы
 * весь расчёт.
 */
export const BASE_FONT_SIZE_PX = 16;

/**
 * Сколько шагов разлиновки занимает строка на листе в клетку. Пишут в клетку
 * через одну: тело строчной буквы занимает клетку, а верхние и нижние
 * выносные элементы соседних строк иначе налезают друг на друга.
 */
export const GRID_ROW_STEPS = 2;

/**
 * Доля шага разлиновки, которую занимает высота строчных. Принятая пропорция
 * школьного письма: тело буквы заметно ниже расстояния между линиями, зазор
 * остаётся под выносные элементы.
 */
const X_HEIGHT_SHARE = 0.55;

/**
 * Зазор между линией поля и краем текста в долях шага разлиновки: буква не
 * садится вплотную на линию поля.
 */
export const MARGIN_LINE_GAP_SHARE = 0.2;

/**
 * Запасной шаг разлиновки в пикселях — примерно школьная линейка. Идёт в дело,
 * когда шага нет: разлиновку на фотографии не нашли или у чистого листа
 * пользователь ещё не задал свой шаг. Без него кегль обратился бы в ноль, а
 * вместе с ним и вся геометрия.
 */
const FALLBACK_RULING_STEP = 40;

/**
 * Наименьший осмысленный кегль в пикселях. Ниже — уже не текст, а полоска
 * пикселей; поправка не должна уводить размер в ноль или в минус.
 */
const MIN_FONT_SIZE_PX = 1;

/**
 * Больше строк края не считаются: столько на листе не встаёт, а шаг строк в
 * доли пикселя — это ошибка разметки, и массив краёв только занял бы память.
 */
const MAX_LINE_BOUNDS = 2000;

/**
 * Сколько шагов разлиновки приходится на одну строку текста.
 *
 * У чистого листа линий нет: шаг задаёт пользователь, и строка занимает
 * ровно его — удваивать нечего.
 *
 * @param kind — вид разлиновки листа
 * @returns множитель шага
 */
const getRowSteps = (kind: RulingKind): number => {
  switch (kind) {
    case 'grid': {
      return GRID_ROW_STEPS;
    }

    case 'lined': {
      return 1;
    }

    case 'blank': {
      return 1;
    }

    default: {
      throw new Error(`Unknown ruling kind: ${kind}`);
    }
  }
};

/**
 * Шаг, по которому считается геометрия и переводится поправка.
 *
 * @param step — шаг разлиновки; ноль и меньше — шаг не задан
 * @returns шаг больше нуля
 */
const resolveStep = (step: number): number => {
  return step > 0 ? step : FALLBACK_RULING_STEP;
};

/**
 * Левый и правый края блока на листе страницы.
 *
 * Линия поля сужает блок со своей стороны: текст отступает от неё на зазор.
 * Поля листа при этом остаются границей — линия, лежащая внутри поля, не
 * выводит блок за поле.
 *
 * @param sheet — лист страницы
 * @param step — шаг разлиновки больше нуля
 * @returns края блока в пикселях кадра
 */
const resolveBlockBounds = (
  sheet: SheetCalibration,
  step: number
): Pick<GeometryBasis, 'left' | 'right'> => {
  const { ruling, width } = sheet;
  const { margins, marginLineX, marginLineSide } = ruling;

  return narrowByMarginLine(
    margins.left,
    width - margins.right,
    marginLineX,
    marginLineSide,
    step
  );
};

/**
 * Края блока, сужённые линией поля с её стороны: текст отступает от неё на
 * зазор, а поля листа остаются границей — линия, лежащая внутри поля, не
 * выводит блок за поле.
 *
 * @param left — левое поле, px
 * @param right — правое поле, px от левого края кадра
 * @param marginLineX — линия поля, px; `null` — линии нет
 * @param marginLineSide — сторона линии поля
 * @param step — шаг разлиновки больше нуля
 * @returns края блока
 */
const narrowByMarginLine = (
  left: number,
  right: number,
  marginLineX: number | null,
  marginLineSide: MarginLineSide | null,
  step: number
): Pick<GeometryBasis, 'left' | 'right'> => {
  const gap = step * MARGIN_LINE_GAP_SHARE;

  if (marginLineX === null) {
    return { left, right };
  }

  switch (marginLineSide) {
    case 'left': {
      return { left: Math.max(left, marginLineX + gap), right };
    }

    case 'right': {
      return { left, right: Math.min(right, marginLineX - gap) };
    }

    default: {
      return { left, right };
    }
  }
};

/**
 * Геометрия блока по готовой основе.
 *
 * Модель строчного бокса — общая с отрисовкой:
 *
 * - шаг строк `lineStep = fontSizePx * lineHeight + lineSpacing`;
 * - базовая линия строки n — `topOffset + fontAscent * fontSizePx + n * lineStep`.
 *
 * Отсюда и расчёт: шаг строк берётся кратным шагу разлиновки, кегль
 * подбирается так, чтобы высота строчных заняла принятую долю шага, а верхний
 * отступ отсчитывается назад от первой линии на подъём строчного бокса.
 * Межстрочный интервал — внешний отступ строки, внутрь бокса он не идёт и в
 * верхнем отступе не участвует.
 *
 * @param basis — вид разлиновки, шаг, первая линия и края блока
 * @param metrics — метрики шрифта в долях кегля
 * @param correction — дельты в долях шага
 * @returns геометрия блока в пикселях
 */
const buildGeometry = (
  basis: GeometryBasis,
  metrics: FontMetrics,
  correction: GeometryCorrection
): BlockGeometry => {
  const { kind, step, firstLine, left, right } = basis;
  const { fontAscent, lineHeight } = metrics;
  const xHeight = metrics.xHeight || FALLBACK_FONT_METRICS.xHeight;
  const fontSizePx = (step * X_HEIGHT_SHARE) / xHeight;
  const lineSpacing = step * getRowSteps(kind) - fontSizePx * lineHeight;
  const topOffset = firstLine - fontAscent * fontSizePx;

  return {
    fontSizePx: Math.max(
      MIN_FONT_SIZE_PX,
      fontSizePx + (correction.fontSizePx || 0) * step
    ),
    lineSpacing: lineSpacing + (correction.lineSpacing || 0) * step,
    topOffset: topOffset + (correction.topOffset || 0) * step,
    leftPadding: left + (correction.leftPadding || 0) * step,
    blockWidth: Math.max(0, right - left + (correction.blockWidth || 0) * step),
  };
};

/**
 * Выводит геометрию блока текста из разлиновки листа страницы и метрик шрифта.
 *
 * Базовая линия первой строки садится на первую линию разлиновки не выше
 * верхнего поля, а не на само поле: поле, взятое по умолчанию, к линиям не
 * привязано, и отсчёт от него увёл бы строки между линиями.
 *
 * Левый и правый края блока — поля листа, сужённые линией поля с её стороны.
 *
 * Пользовательская поправка задана в долях шага и складывается с вычисленным,
 * а не заменяет его: после смены листа она применяется к новому расчёту и
 * сдвигает текст на ту же долю шага, какой бы шаг ни был у фотографии.
 *
 * @param sheet — лист страницы: разлиновка, вид разлиновки и кадр
 * @param metrics — метрики шрифта в долях кегля
 * @param correction — дельты поверх вычисленного в долях шага
 * @returns геометрия блока в пикселях кадра листа
 */
export const deriveGeometry = (
  sheet: SheetCalibration,
  metrics: FontMetrics,
  correction: GeometryCorrection = {}
): BlockGeometry => {
  const { ruling, kind } = sheet;
  const step = resolveStep(ruling.step);
  const geometry = buildGeometry(
    {
      kind,
      step,
      firstLine: resolveFirstLine(ruling),
      ...resolveBlockBounds(sheet, step),
    },
    metrics,
    correction
  );

  if (!ruling.sideSlant) {
    return geometry;
  }

  const { lefts, widths } = buildLineEdges(sheet, step, geometry, metrics, correction);
  const firstLeft = lefts[0] || 0;

  return {
    ...geometry,
    leftPadding: firstLeft + (correction.leftPadding || 0) * step,
    blockWidth: widths[0] || 0,
    lineBounds: {
      offsets: lefts.map((left) => {
        return left - firstLeft;
      }),
      widths,
    },
  };
};

/**
 * Края каждой строки на листе, где поле или линия поля идут наклонно к
 * строкам: строка начинается и кончается там, где её базовая линия
 * пересекает границы, — так текст стоит на одном расстоянии от края листа по
 * всей высоте, а не оставляет у дальнего края пустой клин.
 *
 * Базовые линии — по той же модели строчного бокса, что у отрисовки и
 * вместимости страницы, в координате вдоль линий; края — пересечение границы
 * с линией разлиновки этой высоты, с перспективой. Строки считаются до низа
 * кадра: ниже ни одна строка страницы не встанет.
 *
 * Ширины уже с поправкой ширины блока, как у блока без наклона.
 *
 * @param sheet — лист страницы
 * @param step — шаг разлиновки больше нуля
 * @param geometry — геометрия блока без наклона полей
 * @param metrics — метрики шрифта в долях кегля
 * @param correction — дельты поверх вычисленного в долях шага
 * @returns левые края строк без поправки и их ширины
 */
const buildLineEdges = (
  sheet: SheetCalibration,
  step: number,
  geometry: BlockGeometry,
  metrics: FontMetrics,
  correction: GeometryCorrection
): LineEdges => {
  const { ruling, width, height } = sheet;
  const { fontSizePx, lineSpacing, topOffset } = geometry;
  const lineHeight = metrics.lineHeight || FALLBACK_FONT_METRICS.lineHeight;
  const fontAscent = metrics.fontAscent || FALLBACK_FONT_METRICS.fontAscent;
  const lineStep = fontSizePx * lineHeight + lineSpacing;
  const firstBaseline = topOffset + fontAscent * fontSizePx;
  const lastBaseline = Math.max(
    lineCoordinateAt(ruling, 0, height),
    lineCoordinateAt(ruling, width, height)
  );
  const lineCount =
    lineStep > 0
      ? Math.min(
          MAX_LINE_BOUNDS,
          Math.max(1, Math.floor((lastBaseline - firstBaseline) / lineStep) + 1)
        )
      : 1;
  const widthCorrection = (correction.blockWidth || 0) * step;

  /**
   * Граница блока на базовой линии строки.
   *
   * @param edge — какая граница
   * @param u — координата вдоль линий базовой линии
   * @returns положение вдоль строки; `null` — линии поля нет
   */
  const edgeAt = (edge: SideEdge, u: number): number | null => {
    const ends = readSideEdge(ruling, sheet, edge);

    return ends && resolveSideEdgeAt(ruling, ends, height, u);
  };

  return Array.from({ length: lineCount }).reduce<LineEdges>(
    (edges, _value, index) => {
      const u = firstBaseline + index * lineStep;
      const { left, right } = narrowByMarginLine(
        edgeAt('left', u) || 0,
        edgeAt('right', u) || 0,
        edgeAt('marginLine', u),
        ruling.marginLineSide,
        step
      );

      edges.lefts.push(left);
      edges.widths.push(Math.max(0, right - left + widthCorrection));

      return edges;
    },
    { lefts: [], widths: [] }
  );
};

/**
 * Высота под текст на листе страницы: кадр без верхнего отступа блока, нижнего
 * поля листа и запаса снизу. Запас задан в шагах разлиновки, поэтому на листах
 * с разным шагом он отнимает одно и то же число строк.
 *
 * Высота меряется в координате вдоль линий, в которой стоят и строки: нижняя
 * граница поля переводится в неё, а верхний отступ блока в ней уже задан. Без
 * перспективы `U(0, y) = y`, и число прежнее.
 *
 * @param sheet — лист страницы
 * @param geometry — геометрия блока на этом листе
 * @param bottomMargin — запас снизу в долях шага разлиновки
 * @returns высота в координате вдоль линий, px
 */
export const deriveTextHeight = (
  sheet: SheetCalibration,
  geometry: BlockGeometry,
  bottomMargin: number
): number => {
  const { ruling, height } = sheet;

  return (
    lineCoordinateAt(ruling, 0, height - ruling.margins.bottom) -
    geometry.topOffset -
    bottomMargin * resolveStep(ruling.step)
  );
};
