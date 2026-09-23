import type { RulingBendRegion } from './detectRulingBend';
import type { RulingBendEdit, RulingBendRadius } from './editRulingBend.types';
import type { RulingBend, SheetFrame, SheetPoint, SheetRuling } from './paper.types';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { sampleRulingBend } from './sampleRulingBend';

/**
 * Ширина полосы сетки в шагах разлиновки и наименьшее число полос — те же, что
 * у поиска изгиба (`detectRulingBend.ts`): заведённая руками сетка и найденная
 * по фото одной плотности, и подгонка по фото после ручной правки не меняет
 * разрешение волны.
 */
const STRIP_STEPS = 2;

const MIN_STRIPS = 8;

/**
 * Узлы хранятся с точностью до сотой пикселя, как у найденного изгиба: то же
 * число лежит в памяти и в записи листа.
 */
const OFFSET_PRECISION = 100;

/**
 * Радиус по умолчанию поперёк линий — три шага: прогиб бумаги захватывает
 * несколько соседних линий, а не одну.
 */
const DEFAULT_RADIUS_STEPS = 3;

/**
 * Радиус по умолчанию вдоль линий — треть области с линиями: волна бумаги
 * короче ширины листа, и правка у края не должна тянуть противоположный край.
 */
const DEFAULT_RADIUS_X_SHARE = 1 / 3;

/**
 * Дальность затухания в радиусах: за двумя радиусами вес узла нулевой.
 */
const FADE_REACH = 2;

/**
 * Значение гауссианы на границе затухания. Вычитается из неё, чтобы вес
 * сходил к нулю на границе без скачка: усечённая гауссиана оставила бы на
 * соседних за границей линиях ступеньку в седьмую часть сдвига.
 */
const FADE_FLOOR = Math.exp(-(FADE_REACH ** 2) / 2);

/**
 * Запас на погрешность деления при округлении к номеру линии или строки.
 */
const SNAP_EPSILON = 1e-9;

/**
 * Наименьший отклик сетки в точке, при котором добавок ещё масштабируется:
 * ниже деление на отклик раздуло бы узлы.
 */
const MIN_RESPONSE = 1e-6;

/**
 * Горизонтальная область с линиями, в которой лежат узлы изгиба: между
 * боковыми полями, со стороны линии поля — до неё. За линией поля и полями
 * пружина, переплёт и стол, узлы там не нужны.
 *
 * @param ruling — разлиновка листа
 * @param frameWidth — ширина кадра: правое поле отсчитывается от его края
 * @returns область в пикселях кадра
 */
export const resolveBendRegion = (
  ruling: SheetRuling,
  frameWidth: number
): RulingBendRegion => {
  const { margins, marginLineX, marginLineSide } = ruling;
  const left = margins.left;
  const right = frameWidth - margins.right;

  if (marginLineX === null || marginLineSide === null) {
    return { left, right };
  }

  switch (marginLineSide) {
    case 'left': {
      return { left: Math.max(left, marginLineX), right };
    }

    case 'right': {
      return { left, right: Math.min(right, marginLineX) };
    }

    default: {
      throw new Error(`Неизвестная сторона линии поля: ${String(marginLineSide)}`);
    }
  }
};

/**
 * Радиусы правки изгиба по умолчанию: три шага поперёк линий и треть области
 * с линиями вдоль них.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @returns радиусы в пикселях кадра
 */
export const resolveBendRadius = (
  ruling: SheetRuling,
  frame: SheetFrame
): RulingBendRadius => {
  const { left, right } = resolveBendRegion(ruling, frame.width);

  return {
    radius: DEFAULT_RADIUS_STEPS * ruling.step,
    radiusX: Math.max(0, right - left) * DEFAULT_RADIUS_X_SHARE,
  };
};

/**
 * Нулевая сетка изгиба с узлами, как у поиска изгиба: столбцы — центры равных
 * полос области с линиями шириной около двух шагов, строки — линии гребёнки
 * между верхним и нижним полями.
 *
 * @param ruling — разлиновка листа, шаг больше нуля
 * @param frame — кадр фотографии
 * @returns сетка; `null` — область уже восьми пикселей
 */
const createBendGrid = (ruling: SheetRuling, frame: SheetFrame): RulingBend | null => {
  const { step, firstLinePhase, margins } = ruling;
  const region = resolveBendRegion(ruling, frame.width);
  const cropLeft = Math.max(0, Math.ceil(region.left));
  const cropWidth = Math.min(frame.width, Math.floor(region.right)) - cropLeft;

  if (cropWidth < MIN_STRIPS) {
    return null;
  }

  const columnCount = Math.min(
    cropWidth,
    Math.max(MIN_STRIPS, Math.round(cropWidth / (STRIP_STEPS * step)))
  );
  const columnSpacing = cropWidth / columnCount;
  const firstLine = Math.ceil(
    (lineCoordinateAt(ruling, 0, margins.top) - firstLinePhase) / step - SNAP_EPSILON
  );
  const lastLine = Math.max(
    firstLine,
    Math.floor(
      (lineCoordinateAt(ruling, 0, frame.height - margins.bottom) - firstLinePhase) /
        step +
        SNAP_EPSILON
    )
  );
  const rowCount = lastLine - firstLine + 1;

  return {
    columnOrigin: cropLeft - 0.5 + columnSpacing / 2,
    columnSpacing,
    columnCount,
    rowOrigin: firstLinePhase + firstLine * step,
    rowSpacing: step,
    rowCount,
    offsets: Array.from({ length: columnCount * rowCount }, () => {
      return 0;
    }),
  };
};

/**
 * Ограничивает число отрезком.
 *
 * @param value — число
 * @param min — нижняя граница
 * @param max — верхняя граница
 * @returns число в `[min, max]`
 */
const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Достраивает сетку строками до линии с координатой `u`. Новая строка —
 * копия крайней: за крайней строкой выборка и так берёт её значения, поэтому
 * ни одна линия от достройки не сдвигается.
 *
 * @param bend — сетка изгиба
 * @param u — координата вдоль линий перетаскиваемой линии
 * @returns сетка, строки которой накрывают `u`
 */
const extendRows = (bend: RulingBend, u: number): RulingBend => {
  const { rowOrigin, rowSpacing, rowCount, columnCount, offsets } = bend;

  if (rowSpacing <= 0 || rowCount < 1) {
    return bend;
  }

  const lastRow = rowOrigin + (rowCount - 1) * rowSpacing;
  const above = Math.max(0, Math.ceil((rowOrigin - u) / rowSpacing - SNAP_EPSILON));
  const below = Math.max(0, Math.ceil((u - lastRow) / rowSpacing - SNAP_EPSILON));

  if (above === 0 && below === 0) {
    return bend;
  }

  const extendedCount = rowCount + above + below;

  return {
    ...bend,
    rowOrigin: rowOrigin - above * rowSpacing,
    rowCount: extendedCount,
    offsets: Array.from({ length: extendedCount * columnCount }, (_item, index) => {
      const row = clamp(Math.floor(index / columnCount) - above, 0, rowCount - 1);

      return offsets[row * columnCount + (index % columnCount)] || 0;
    }),
  };
};

/**
 * Высота линии с координатой `u` в столбце `x` вместе с изгибом — та же модель,
 * что у отрисовки и оверлея.
 *
 * @param ruling — разлиновка листа
 * @param bend — сетка изгиба
 * @param x — столбец кадра
 * @param u — координата линии вдоль линий
 * @returns высота линии, px
 */
const toBentLineY = (
  ruling: SheetRuling,
  bend: RulingBend,
  x: number,
  u: number
): number => {
  const straight = lineHeightAt(ruling, x, u);

  return straight + sampleRulingBend(bend, ruling, x, straight);
};

/**
 * Координата вдоль линий той линии гребёнки, которая с изгибом проходит в
 * столбце точки ближе всех к ней.
 *
 * @param ruling — разлиновка листа
 * @param bend — сетка изгиба
 * @param point — взятая точка
 * @returns координата линии
 */
const findGrabbedLine = (
  ruling: SheetRuling,
  bend: RulingBend,
  point: SheetPoint
): number => {
  const { step, firstLinePhase } = ruling;
  const guess = Math.round(
    (lineCoordinateAt(ruling, point.x, point.y) - firstLinePhase) / step
  );

  return [guess - 1, guess + 1].reduce(
    (best, index) => {
      const u = firstLinePhase + index * step;
      const distance = Math.abs(toBentLineY(ruling, bend, point.x, u) - point.y);
      const bestDistance = Math.abs(toBentLineY(ruling, bend, point.x, best) - point.y);

      return distance < bestDistance ? u : best;
    },
    firstLinePhase + guess * step
  );
};

/**
 * Вес узла по расстоянию: гауссиана, опущенная так, что на двух радиусах она
 * сходит в ноль, и нормированная к единице в центре.
 *
 * @param distance — расстояние от узла до точки, px
 * @param radius — радиус затухания, px, больше нуля
 * @returns вес от 0 до 1
 */
const fadeWeight = (distance: number, radius: number): number => {
  const share = distance / radius;

  if (Math.abs(share) >= FADE_REACH) {
    return 0;
  }

  return (Math.exp(-(share ** 2) / 2) - FADE_FLOOR) / (1 - FADE_FLOOR);
};

/**
 * Веса узлов сетки для точки. Точка за крайним узлом берёт веса от крайнего
 * узла: за ним выборка постоянна, и правка крайнего узла проводит линию через
 * точку. Радиус не меньше промежутка узлов: у более узкого у точки между
 * узлами не нашлось бы ни одного узла с весом.
 *
 * @param bend — сетка изгиба
 * @param x — столбец точки
 * @param u — координата вдоль линий перетаскиваемой линии
 * @param options — радиусы и режим «весь столбец»
 * @returns веса в порядке узлов сетки
 */
const computeNodeWeights = (
  bend: RulingBend,
  x: number,
  u: number,
  { radius, radiusX, isWholeColumn }: RulingBendEdit
): number[] => {
  const { columnOrigin, columnSpacing, columnCount, rowOrigin, rowSpacing, rowCount } =
    bend;
  const anchorX = clamp(
    x,
    columnOrigin,
    columnOrigin + (columnCount - 1) * columnSpacing
  );
  const anchorU = clamp(u, rowOrigin, rowOrigin + (rowCount - 1) * rowSpacing);
  const reachX = Math.max(radiusX, columnSpacing);
  const reachU = Math.max(radius, rowSpacing);
  const columnWeights = Array.from({ length: columnCount }, (_item, column) => {
    return fadeWeight(columnOrigin + column * columnSpacing - anchorX, reachX);
  });

  return Array.from({ length: rowCount * columnCount }, (_item, index) => {
    const rowWeight = isWholeColumn
      ? 1
      : fadeWeight(
          rowOrigin + Math.floor(index / columnCount) * rowSpacing - anchorU,
          reachU
        );

    return rowWeight * (columnWeights[index % columnCount] || 0);
  });
};

/**
 * Округляет смещение до сотой пикселя.
 *
 * @param offset — смещение
 * @returns смещение, кратное сотой
 */
const roundOffset = (offset: number): number => {
  return Math.round(offset * OFFSET_PRECISION) / OFFSET_PRECISION;
};

/**
 * Перетаскивание точки линии поперёк линий: линия, ближайшая к взятой точке,
 * проходит через отпущенную точку `point.y + delta`, сдвиг плавно затухает на
 * соседние линии и вдоль линии и за двумя радиусами равен нулю. Сетка узлов
 * остаётся прежней; без изгиба заводится нулевая сетка той же плотности, что
 * у поиска изгиба, а линия выше или ниже сетки достраивает её строками.
 *
 * Добавок узлам раздаётся по весам и масштабируется по отклику выборки в
 * точке: Катмулл — Ром между узлами отвечает на единичные веса меньше
 * единицы, и без масштаба линия не доходила бы до точки.
 *
 * @param ruling — разлиновка листа
 * @param point — взятая точка на линии, px кадра
 * @param delta — сдвиг по высоте кадра, px, положительный — вниз
 * @param options — радиусы, режим «весь столбец» и кадр
 * @returns разлиновка с новым изгибом; без шага — та же разлиновка
 */
export const editRulingBend = (
  ruling: SheetRuling,
  point: SheetPoint,
  delta: number,
  options: RulingBendEdit
): SheetRuling => {
  if (ruling.step <= 0) {
    return ruling;
  }

  const grid = ruling.bend || createBendGrid(ruling, options.frame);

  if (!grid) {
    return ruling;
  }

  const u = findGrabbedLine(ruling, grid, point);
  const bend = extendRows(grid, u);
  const straight = lineHeightAt(ruling, point.x, u);
  const shift = point.y + delta - toBentLineY(ruling, bend, point.x, u);
  const weights = computeNodeWeights(bend, point.x, u, options);
  const response = sampleRulingBend(
    { ...bend, offsets: weights },
    ruling,
    point.x,
    straight
  );

  if (response < MIN_RESPONSE) {
    return ruling;
  }

  const scale = shift / response;

  return {
    ...ruling,
    bend: {
      ...bend,
      offsets: bend.offsets.map((offset, index) => {
        return roundOffset(offset + (weights[index] || 0) * scale);
      }),
    },
  };
};
