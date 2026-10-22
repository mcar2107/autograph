import { bentLineHeightAt } from './bentLineHeightAt';
import {
  BEND_OFFSET_PRECISION,
  BEND_STRIP_STEPS,
  MIN_BEND_STRIPS,
  type RulingBendRegion,
} from './detectRulingBend';
import type {
  ColumnTargets,
  RulingBendEdit,
  RulingBendRadius,
} from './editRulingBend.types';
import type { RulingBend, SheetFrame, SheetPoint, SheetRuling } from './paper.types';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { sampleRulingBend } from './sampleRulingBend';

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
 * Сколько промежутков узлов за последним узлом с весом Катмулл — Ром ещё
 * сдвигает линию: между узлами он берёт по два соседа с каждой стороны.
 */
const CATMULL_ROM_SUPPORT = 2;

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
 * Плотность узлов берётся у поиска изгиба (`detectRulingBend.ts`): заведённая
 * руками сетка и найденная по фото одной плотности, и подгонка по фото после
 * ручной правки не меняет разрешение волны.
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

  if (cropWidth < MIN_BEND_STRIPS) {
    return null;
  }

  const columnCount = Math.min(
    cropWidth,
    Math.max(MIN_BEND_STRIPS, Math.round(cropWidth / (BEND_STRIP_STEPS * step)))
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
 * Достраивает сетку столбцами до столбца кадра `x`. Новый столбец — копия
 * крайнего: за крайним столбцом выборка и так держит его значение, поэтому
 * линии за прежним краем сетки от достройки не сдвигаются. Между двумя
 * крайними прежними узлами Катмулл — Ром брал в соседи отражённый узел, а
 * теперь берёт копию, и линия там меняется на долю разности этих узлов —
 * меньше тринадцатой её части.
 *
 * @param bend — сетка изгиба
 * @param x — столбец кадра, px
 * @returns сетка, столбцы которой накрывают `x`
 */
const extendColumns = (bend: RulingBend, x: number): RulingBend => {
  const { columnOrigin, columnSpacing, columnCount, rowCount, offsets } = bend;

  if (columnSpacing <= 0 || columnCount < 1) {
    return bend;
  }

  const lastColumn = columnOrigin + (columnCount - 1) * columnSpacing;
  const before = Math.max(
    0,
    Math.ceil((columnOrigin - x) / columnSpacing - SNAP_EPSILON)
  );
  const after = Math.max(0, Math.ceil((x - lastColumn) / columnSpacing - SNAP_EPSILON));

  if (before === 0 && after === 0) {
    return bend;
  }

  const extendedCount = columnCount + before + after;

  return {
    ...bend,
    columnOrigin: columnOrigin - before * columnSpacing,
    columnCount: extendedCount,
    offsets: Array.from({ length: rowCount * extendedCount }, (_item, index) => {
      const row = Math.floor(index / extendedCount);
      const column = clamp((index % extendedCount) - before, 0, columnCount - 1);

      return offsets[row * columnCount + column] || 0;
    }),
  };
};

/**
 * Докуда достраивать сетку столбцами при правке в столбце `x`. За крайним
 * столбцом выборка держит его значение, и правка, задевшая крайний узел,
 * увела бы линии бокового поля до края листа, далеко за рамкой. Поэтому
 * сторона достраивается до охвата затухания и ещё на столбец — дальше узлы
 * без веса держат линии на месте.
 *
 * Достройка не бесплатна: Катмулл — Ром у прежнего края брал в соседи
 * отражённый узел, а после неё — копию, и линии у края во всех строках
 * меняются на долю разности крайних узлов. Поэтому сторона достраивается,
 * только когда без этого сдвинулись бы линии за рамкой: крайний узел
 * получает вес, а рамка кончается внутри кадра. Иначе граница — прежний
 * крайний столбец.
 *
 * Точка за крайним столбцом — в боковом поле, у пружины или переплёта —
 * берёт веса от себя (`computeNodeWeights`), а крайний узел доводит линию до
 * неё: выборка держит его значение до края кадра, внутри рамки. Достройка
 * нужна ей по тому же правилу, а ещё — когда крайний узел вне затухания:
 * тогда линию через точку провести нечем, и сторона достраивается до охвата
 * затухания вокруг точки.
 *
 * @param grid — сетка изгиба
 * @param x — столбец правки, px
 * @param fade — радиусы затухания
 * @param frameWidth — ширина кадра, px
 * @returns столбцы, до которых сетка должна доходить слева и справа, px
 */
const resolveColumnTargets = (
  grid: RulingBend,
  x: number,
  fade: RulingBendRadius,
  frameWidth: number
): ColumnTargets => {
  const { columnOrigin, columnSpacing, columnCount } = grid;
  const lastColumn = columnOrigin + (columnCount - 1) * columnSpacing;
  const reach = FADE_REACH * fade.radiusX;
  const drawn = reach + CATMULL_ROM_SUPPORT * columnSpacing;
  const extended = reach + columnSpacing;
  const shouldExtendLeft =
    x - columnOrigin < reach &&
    (x - drawn > 0 || fadeWeight(columnOrigin - x, fade.radiusX) < MIN_RESPONSE);
  const shouldExtendRight =
    lastColumn - x < reach &&
    (x + drawn < frameWidth || fadeWeight(x - lastColumn, fade.radiusX) < MIN_RESPONSE);

  return {
    left: shouldExtendLeft ? Math.max(0, x - extended) : columnOrigin,
    right: shouldExtendRight ? Math.min(frameWidth, x + extended) : lastColumn,
  };
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
      const distance = Math.abs(bentLineHeightAt(ruling, bend, point.x, u) - point.y);
      const bestDistance = Math.abs(
        bentLineHeightAt(ruling, bend, point.x, best) - point.y
      );

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
 * Радиусы затухания, с которыми правка раздаёт сдвиг узлам: не меньше
 * промежутка узлов — у более узкого у точки между узлами не нашлось бы ни
 * одного узла с весом.
 *
 * @param bend — сетка изгиба
 * @param radius — заданные радиусы
 * @returns радиусы затухания, px
 */
const resolveFadeRadius = (
  bend: RulingBend,
  { radius, radiusX }: RulingBendRadius
): RulingBendRadius => {
  return {
    radius: Math.max(radius, bend.rowSpacing),
    radiusX: Math.max(radiusX, bend.columnSpacing),
  };
};

/**
 * Докуда дотягивается правка изгиба с заданными радиусами: поперёк линий —
 * по координате вдоль линий, вдоль них — по горизонтали кадра. Линии дальше
 * не сдвигаются, поэтому рамка у курсора рисуется по этой мере, а не по
 * радиусам слайдера. Поперёк линий это два радиуса затухания: линии стоят на
 * строках сетки, и строка без веса линию не двигает. Вдоль линий к двум
 * радиусам прибавлены два промежутка узлов: Катмулл — Ром между узлами берёт
 * по два соседа с каждой стороны, и узел с весом сдвигает линию до второго
 * узла за собой. У радиуса уже промежутка узлов правка берёт промежуток.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии: по нему заводится сетка, если изгиба нет
 * @param radius — заданные радиусы
 * @returns дальность правки, px; без шага или без сетки — два заданных
 *   радиуса
 */
export const resolveBendReach = (
  ruling: SheetRuling,
  frame: SheetFrame,
  radius: RulingBendRadius
): RulingBendRadius => {
  const grid = ruling.step > 0 ? ruling.bend || createBendGrid(ruling, frame) : null;

  if (!grid) {
    return { radius: FADE_REACH * radius.radius, radiusX: FADE_REACH * radius.radiusX };
  }

  const fade = resolveFadeRadius(grid, radius);

  return {
    radius: FADE_REACH * fade.radius,
    radiusX: FADE_REACH * fade.radiusX + CATMULL_ROM_SUPPORT * grid.columnSpacing,
  };
};

/**
 * Веса узлов сетки для точки. Вдоль линий веса считаются от самой точки, и
 * за крайним столбцом тоже: затухание кончается там же, где рамка вокруг
 * точки, а выборка за крайним узлом держит его значение, и масштаб добавка
 * по отклику доводит линию до точки. Поперёк линий точка за крайней строкой
 * берёт веса от крайней строки.
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
  const anchorU = clamp(u, rowOrigin, rowOrigin + (rowCount - 1) * rowSpacing);
  const fade = resolveFadeRadius(bend, { radius, radiusX });
  const reachX = fade.radiusX;
  const reachU = fade.radius;
  const columnWeights = Array.from({ length: columnCount }, (_item, column) => {
    return fadeWeight(columnOrigin + column * columnSpacing - x, reachX);
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
  return Math.round(offset * BEND_OFFSET_PRECISION) / BEND_OFFSET_PRECISION;
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

  /**
   * Сетка дорастает до линий, до которых дотягивается затухание, и ещё на
   * строку за ними: за крайней строкой выборка держит её значение, и правка
   * у края сетки иначе увела бы все линии поля за ней, сколь угодно далёкие.
   * Достроенные строки дальше двух радиусов получают нулевой вес и держат
   * линии за собой на месте. Столбцы — см. `resolveColumnTargets`.
   */
  const fade = resolveFadeRadius(grid, options);
  const reachU = FADE_REACH * fade.radius + grid.rowSpacing;
  const columns = resolveColumnTargets(grid, point.x, fade, options.frame.width);
  const bend = extendColumns(
    extendColumns(extendRows(extendRows(grid, u - reachU), u + reachU), columns.left),
    columns.right
  );
  const straight = lineHeightAt(ruling, point.x, u);
  const shift = point.y + delta - bentLineHeightAt(ruling, bend, point.x, u);
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
