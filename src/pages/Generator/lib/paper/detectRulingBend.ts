import { cropSheetColumns } from './cropSheetColumns';
import type { RulingBend, SheetImageData, SheetRuling } from './paper.types';
import { computeMedian, computeQuantile } from './quantile';
import {
  buildStripProfiles,
  detrendProfile,
  refinePeakOffset,
  toTangent,
} from './sheetProfile';

/**
 * Горизонтальная область с линиями, по которой меряется изгиб, в пикселях
 * кадра: от одного конца линий до другого, со стороны линии поля — до неё.
 */
export type RulingBendRegion = {
  /**
   * Левая граница области.
   */
  left: number;

  /**
   * Правая граница области.
   */
  right: number;
};

/**
 * Прямая разлиновка, поверх которой меряется изгиб.
 */
export type BendBaseRuling = Pick<
  SheetRuling,
  'step' | 'firstLinePhase' | 'skewAngle' | 'margins'
>;

/**
 * Результат измерения изгиба.
 */
export type RulingBendDetection = {
  /**
   * Изгиб линий. `null` — линии прямые или проследить их надёжно не удалось.
   */
  bend: RulingBend | null;

  /**
   * Доля узлов области, где линия нашлась, от 0 до 1. Есть и при `null`:
   * по ней видно, почему изгиб отброшен.
   */
  foundNodeShare: number;
};

/**
 * Ширина полосы в шагах разлиновки. Внутри двух шагов изогнутая линия почти
 * прямая, а узлы через два шага ещё разрешают волну бумаги в восемь шагов.
 */
export const BEND_STRIP_STEPS = 2;

/**
 * Наименьшее число полос: на узкой области узлы через два шага не опишут даже
 * прогиб.
 */
export const MIN_BEND_STRIPS = 8;

/**
 * Полуширина окна стартового поиска в долях шага: в центре кадра отход линии
 * доходит до шестой шага, а до соседней линии окно ещё не дотягивается.
 */
const START_SEARCH_SHARE = 1 / 3;

/**
 * Полуширина окна трассировки вокруг предсказания в долях шага. К краю отход
 * растёт до трети шага, но предсказание идёт за линией, и окну хватает шестой.
 */
const TRACE_SEARCH_SHARE = 1 / 6;

/**
 * Полуширина запасного окна трассировки в долях шага — на случай, когда в
 * основном окне линии нет. Предсказание по двум последним узлам промахивается
 * на склоне короткого прогиба: у прогиба в треть шага на половине области
 * соседние узлы расходятся на четверть шага, и линия уходит из окна в шестую.
 * Соседняя линия лежит в шаге от настоящей, и окно в треть шага её не достаёт,
 * пока промах предсказания меньше двух третей шага.
 */
const TRACE_FALLBACK_SHARE = 1 / 3;

/**
 * Квантиль стартовых глубин, которым меряется типичная глубина линий: линии
 * видны не на всём листе, и медиана на наполовину пустом листе упала бы до шума.
 */
const LINE_DEPTH_QUANTILE = 0.9;

/**
 * Доля типичной глубины, ниже которой линия в полосе считается ненайденной.
 * Десятая, а не пятая, как у границ разлиновки в `detectRuling.ts`: на крупном
 * кадре линия, изогнутая внутри полосы, размазана по полосе, и у края области,
 * срезанного наклоном, её провал мельче пятой части глубины прямых линий —
 * крайний узел терялся и заполнялся соседним. Узел ищется только внутри
 * области и в окне у предсказания трассы, поэтому чистое поле, спираль и чужая
 * линейка за линией поля в него не попадают.
 */
const LINE_DEPTH_LEVEL = 0.1;

/**
 * Отход узла от медианы соседних линий в долях шага, после которого узел
 * считается выбросом. Изгиб бумаги на три соседние линии почти постоянен.
 */
const OUTLIER_SHARE = 0.1;

/**
 * Число строк узлов, по которым берётся медиана фильтра выбросов.
 */
const FILTER_ROWS = 3;

/**
 * Доля найденных узлов строки, с которой пропуски в ней заполняются по самой
 * строке, а не по соседним строкам.
 */
const ROW_FILL_SHARE = 0.5;

/**
 * Узлы хранятся с точностью до сотой пикселя: одно и то же число лежит в
 * памяти, в хранилище и в артефакте профилей.
 */
export const BEND_OFFSET_PRECISION = 100;

/**
 * Наименьшая доля найденных узлов области: при меньшей линии на большой части
 * листа не видны, и изгиб там — догадка заполнения.
 */
const MIN_FOUND_SHARE = 0.6;

/**
 * Наибольшая доля найденных узлов, которую может заменить фильтр выбросов:
 * при большей трасса шумная, и медианы соседей сами ненадёжны.
 */
const MAX_REPLACED_SHARE = 0.2;

/**
 * Смещение в долях шага, с которого трасса считается ушедшей на соседнюю
 * линию: на половине шага линия равно близка к обеим соседним местам гребёнки.
 */
const MAX_OFFSET_SHARE = 0.5;

/**
 * Наибольшее расхождение соседних строк узлов в одном узле в долях шага. Изгиб
 * бумаги гладкий, и скачок означает, что одна из линий захвачена чужой.
 */
const MAX_ROW_JUMP_SHARE = 0.25;

/**
 * Наименьший изгиб в долях шага, который стоит хранить: изгиб меньше половины
 * допуска попадания не стоит ни байта хранения, ни пересчёта контуров.
 */
const MIN_BEND_SHARE = 1 / 20;

/**
 * Веса трёх крайних узлов строки, от крайнего внутрь, для значения параболы
 * через них на краю области — в половине расстояния между узлами за крайним.
 * Это многочлен Лагранжа по узлам 0, 1, 2 в точке −½.
 */
const EDGE_WEIGHTS = [15 / 8, -5 / 4, 3 / 8] as const;

/**
 * Узел строки: положение линии в полосе.
 */
type LineDip = {
  /**
   * Координата линии вдоль профиля полосы в бинах.
   */
  position: number;

  /**
   * Глубина провала линии.
   */
  depth: number;
};

/**
 * Сетка узлов в процессе измерения.
 */
type NodeGrid = {
  /**
   * Смещения узлов от прямой гребёнки в пикселях, построчно.
   */
  offsets: Float64Array;

  /**
   * Нашлась ли линия в узле.
   */
  isFound: Uint8Array;

  /**
   * Число строк узлов.
   */
  rowCount: number;

  /**
   * Число узлов в строке.
   */
  columnCount: number;
};

const EMPTY_DETECTION: RulingBendDetection = { bend: null, foundNodeShare: 0 };

/**
 * Наименьшая разница плеч провала в пикселях — расстояний от вершины до краёв
 * на половине глубины, — с которой положение линии в полосе берётся
 * центроидом, а не вершиной. Линия, прямая внутри полосы, даёт симметричный
 * провал, и вершина с параболой точнее центроида по нескольким бинам. Линия,
 * изогнутая внутри полосы, даёт глубокую часть там, где она пологая, и
 * затянутый склон: вершина уезжает к пологой части, а узел должен стоять на
 * среднем положении линии в полосе. Порог в пиксель хватал шум ровных
 * провалов — прогиб в середине области на кадре втрое крупнее при наклоне в два
 * градуса терял точность с 0,037 до 0,042 шага, — при двух пикселях она
 * прежняя.
 */
const DIP_ASYMMETRY_BINS = 2;

/**
 * Край провала на заданной глубине с одной стороны от вершины, уточнённый
 * линейной интерполяцией между бинами.
 *
 * @param detrended — профиль полосы без фона, отрицательный на линиях
 * @param peak — бин вершины
 * @param level — глубина, на которой ищется край, меньше глубины вершины
 * @param direction — сторона: `-1` влево, `1` вправо
 * @returns координата края в бинах
 */
const findDipEdge = (
  detrended: Float64Array,
  peak: number,
  level: number,
  direction: -1 | 1
): number => {
  let bin = peak;

  while (-(detrended[bin + direction] || 0) > level) {
    bin += direction;
  }

  const inner = -(detrended[bin] || 0);
  const outer = -(detrended[bin + direction] || 0);

  return bin + (direction * (inner - level)) / (inner - outer);
};

/**
 * Положение линии в полосе: у симметричного провала — вершина, у
 * несимметричного — центроид его части глубже половины вершины, взвешенный
 * превышением над половиной.
 *
 * @param detrended — профиль полосы без фона, отрицательный на линиях
 * @param peak — бин самой глубокой точки
 * @param depth — глубина вершины
 * @param peakPosition — вершина, уточнённая параболой
 * @returns координата линии в бинах
 */
const locateDipCenter = (
  detrended: Float64Array,
  peak: number,
  depth: number,
  peakPosition: number
): number => {
  const level = depth / 2;
  const left = findDipEdge(detrended, peak, level, -1);
  const right = findDipEdge(detrended, peak, level, 1);

  if (Math.abs(left + right - 2 * peakPosition) < DIP_ASYMMETRY_BINS) {
    return peakPosition;
  }

  let weight = 0;
  let moment = 0;

  for (let bin = Math.ceil(left); bin <= Math.floor(right); bin += 1) {
    const excess = -(detrended[bin] || 0) - level;

    weight += excess;
    moment += excess * bin;
  }

  return moment / weight;
};

/**
 * Самый глубокий провал в окне вокруг предсказанного положения линии; его
 * положение — по `locateDipCenter`.
 *
 * @param detrended — профиль полосы без фона, отрицательный на линиях
 * @param center — предсказанная координата линии в бинах
 * @param reach — полуширина окна в бинах
 * @returns провал; `null` — в окне нет вершины темнее фона, а край окна лежит на
 *   склоне провала за окном
 */
const findLineDip = (
  detrended: Float64Array,
  center: number,
  reach: number
): LineDip | null => {
  const from = Math.max(1, Math.round(center - reach));
  const to = Math.min(detrended.length - 2, Math.round(center + reach));
  let peak = -1;
  let depth = 0;

  for (let bin = from; bin <= to; bin += 1) {
    const binDepth = -(detrended[bin] || 0);

    if (binDepth > depth) {
      peak = bin;
      depth = binDepth;
    }
  }

  const previous = -(detrended[peak - 1] || 0);
  const next = -(detrended[peak + 1] || 0);

  if (peak < 0 || previous > depth || next > depth) {
    return null;
  }

  return {
    position: locateDipCenter(
      detrended,
      peak,
      depth,
      peak + refinePeakOffset(previous, depth, next)
    ),
    depth,
  };
};

/**
 * Порядок полос для старта: от центральной к краям. Поиск в центре, а не у
 * края: там отход линии от прямой наименьший.
 */
const orderFromCenter = (count: number): number[] => {
  const center = (count - 1) / 2;

  return Array.from({ length: count }, (_item, index) => {
    return index;
  }).sort((first, second) => {
    return Math.abs(first - center) - Math.abs(second - center) || first - second;
  });
};

/**
 * Прослеживает линию от стартовой полосы к обоим краям области. Предсказание в
 * следующей полосе — положение в предыдущей плюс наклон по двум последним;
 * там, где линии нет, предсказание продолжается, а узел остаётся ненайденным.
 * Трассировка, а не поиск у прямой гребёнки в каждой полосе: к краю отход
 * растёт до трети шага, и окно у прямой цепляло бы соседнюю линию.
 */
const traceLine = (
  detrended: Float64Array[],
  start: number,
  startDip: LineDip,
  straight: number,
  reach: number,
  fallbackReach: number,
  threshold: number,
  grid: NodeGrid,
  row: number
): void => {
  const { offsets, isFound, columnCount } = grid;

  offsets[row * columnCount + start] = startDip.position - straight;
  isFound[row * columnCount + start] = 1;

  for (const direction of [-1, 1]) {
    let previous = startDip.position;
    let slope = 0;

    for (
      let strip = start + direction;
      strip >= 0 && strip < columnCount;
      strip += direction
    ) {
      const predicted = previous + slope;
      const profile = detrended[strip] || new Float64Array(0);
      const nearDip = findLineDip(profile, predicted, reach);
      const dip =
        nearDip !== null && nearDip.depth >= threshold
          ? nearDip
          : findLineDip(profile, predicted, fallbackReach);
      const isLineFound = dip !== null && dip.depth >= threshold;
      const position = dip !== null && isLineFound ? dip.position : predicted;

      if (isLineFound) {
        offsets[row * columnCount + strip] = position - straight;
        isFound[row * columnCount + strip] = 1;
      }

      slope = position - previous;
      previous = position;
    }
  }
};

/**
 * Номера строк, по которым берётся медиана фильтра: у крайних строк — три
 * ближайшие внутрь области, чтобы медиана не выродилась в пару значений.
 */
const selectFilterRows = (row: number, rowCount: number): number[] => {
  const first = Math.min(Math.max(0, row - 1), rowCount - FILTER_ROWS);

  return [first, first + 1, first + 2];
};

/**
 * Заменяет выбросы медианой соседних линий в том же столбце. Медиана по
 * столбцу, а не по строке: по ширине волна в восемь шагов занимает четыре
 * узла, и медиана соседних узлов срезала бы её гребень.
 *
 * @returns число заменённых узлов
 */
const replaceOutliers = (grid: NodeGrid, limit: number): number => {
  const { offsets, isFound, rowCount, columnCount } = grid;
  const measured = Float64Array.from(offsets);
  let replaced = 0;

  for (let row = 0; row < rowCount; row += 1) {
    const filterRows = selectFilterRows(row, rowCount);

    for (let column = 0; column < columnCount; column += 1) {
      const index = row * columnCount + column;
      const neighbours = filterRows.reduce<number[]>((values, filterRow) => {
        if (isFound[filterRow * columnCount + column]) {
          values.push(measured[filterRow * columnCount + column] || 0);
        }

        return values;
      }, []);

      if (isFound[index] && neighbours.length === FILTER_ROWS) {
        const median = computeMedian(neighbours);

        if (Math.abs((measured[index] || 0) - median) > limit) {
          offsets[index] = median;
          replaced += 1;
        }
      }
    }
  }

  return replaced;
};

/**
 * Заполняет пропуски строки линейно между найденными узлами, за крайними
 * найденными — их значением.
 */
const fillRow = (grid: NodeGrid, row: number): void => {
  const { offsets, isFound, columnCount } = grid;
  const base = row * columnCount;
  let previous = -1;

  for (let column = 0; column <= columnCount; column += 1) {
    const isAnchor = column === columnCount || isFound[base + column] === 1;

    if (isAnchor) {
      const from = previous < 0 ? column : previous;
      const to = column === columnCount ? previous : column;

      for (let gap = previous + 1; gap < column; gap += 1) {
        const weight = to === from ? 0 : (gap - from) / (to - from);

        offsets[base + gap] =
          (1 - weight) * (offsets[base + from] || 0) + weight * (offsets[base + to] || 0);
      }

      previous = column;
    }
  }
};

/**
 * Заполняет пропуски: строки, где нашлась хотя бы половина узлов, — по самой
 * строке, остальные — по ближайшим таким строкам в том же столбце.
 */
const fillGaps = (grid: NodeGrid): void => {
  const { offsets, isFound, rowCount, columnCount } = grid;
  const isFilledRow = Array.from({ length: rowCount }, (_item, row) => {
    const found = isFound
      .subarray(row * columnCount, (row + 1) * columnCount)
      .reduce((sum, value) => {
        return sum + value;
      }, 0);

    return found > 0 && found >= ROW_FILL_SHARE * columnCount;
  });

  isFilledRow.forEach((isFilled, row) => {
    if (isFilled) {
      fillRow(grid, row);
    }
  });

  isFilledRow.forEach((isFilled, row) => {
    if (isFilled) {
      return;
    }

    const above = isFilledRow.lastIndexOf(true, row);
    const below = isFilledRow.indexOf(true, row);

    if (above < 0 && below < 0) {
      return;
    }

    const from = above < 0 ? below : above;
    const to = below < 0 ? above : below;
    const weight = to === from ? 0 : (row - from) / (to - from);

    for (let column = 0; column < columnCount; column += 1) {
      const index = row * columnCount + column;

      if (!isFound[index]) {
        offsets[index] =
          (1 - weight) * (offsets[from * columnCount + column] || 0) +
          weight * (offsets[to * columnCount + column] || 0);
      }
    }
  });
};

/**
 * Округляет смещение до сотой пикселя. Отрицательный ноль заменяется нулём:
 * хранилище и артефакт пишут изгиб в JSON, где `-0` становится `0`, и лист,
 * перечитанный из хранилища, нёс бы не то же число, что в памяти.
 *
 * @param offset — смещение в пикселях
 * @returns смещение, кратное сотой
 */
const roundOffset = (offset: number): number => {
  return Math.round(offset * BEND_OFFSET_PRECISION) / BEND_OFFSET_PRECISION || 0;
};

/**
 * Наибольший отход линий от прямой разлиновки во всей области, а не только в
 * узлах: крайний узел стоит в центре крайней полосы, и за ним до края области
 * остаётся полполосы. У дуги во всю ширину кадра под наклоном линия отходит от
 * прямой сильнее всего как раз там — узлы держатся ниже двадцатой шага, а у
 * края области линия уходит дальше, и лист сохранялся бы ровным.
 *
 * Отход у края — парабола через три крайних узла строки, продолженная на
 * полполосы. Прямая через два узла не видит кривизны линии у края и на дуге
 * недобирает до пяти тысячных шага — ровно столько, чтобы дуга в 0,15 шага
 * под наклоном в градус осталась ровной. Шум узлов парабола усиливает сильнее
 * прямой, но на ровных листах отход у края не выходит за три сотых шага.
 *
 * @param offsets — округлённые смещения узлов, построчно
 * @param columnCount — число узлов в строке, не меньше трёх
 * @returns наибольший отход в пикселях
 */
export const measureBendDeviation = (
  offsets: readonly number[],
  columnCount: number
): number => {
  return offsets.reduce((max, offset, index) => {
    const column = index % columnCount;
    const isEdge = column === 0 || column === columnCount - 1;

    if (!isEdge) {
      return Math.max(max, Math.abs(offset));
    }

    const inward = column === 0 ? 1 : -1;
    const edge =
      EDGE_WEIGHTS[0] * offset +
      EDGE_WEIGHTS[1] * (offsets[index + inward] || 0) +
      EDGE_WEIGHTS[2] * (offsets[index + 2 * inward] || 0);

    return Math.max(max, Math.abs(offset), Math.abs(edge));
  }, 0);
};

/**
 * Проверка надёжности измеренного изгиба. Ненадёжный изгиб хуже прямой
 * гребёнки: он уводит строки с линий там, где прямая разлиновка попала бы.
 * Ровным лист считается, только если линии нигде в области, включая края за
 * крайними узлами, не отходят от прямой на двадцатую шага.
 *
 * @param offsets — округлённые смещения узлов, построчно
 * @param columnCount — число узлов в строке
 * @param step — шаг разлиновки в пикселях
 * @param foundShare — доля найденных узлов области
 * @param replacedShare — доля найденных узлов, заменённых фильтром выбросов
 * @returns `true`, если изгиб можно сохранить
 */
const isReliableBend = (
  offsets: number[],
  columnCount: number,
  step: number,
  foundShare: number,
  replacedShare: number
): boolean => {
  const maxOffset = offsets.reduce((max, offset) => {
    return Math.max(max, Math.abs(offset));
  }, 0);
  const hasRowJump = offsets.some((offset, index) => {
    return (
      index >= columnCount &&
      Math.abs(offset - (offsets[index - columnCount] || 0)) > MAX_ROW_JUMP_SHARE * step
    );
  });

  return (
    foundShare >= MIN_FOUND_SHARE &&
    replacedShare <= MAX_REPLACED_SHARE &&
    maxOffset < MAX_OFFSET_SHARE * step &&
    measureBendDeviation(offsets, columnCount) >= MIN_BEND_SHARE * step &&
    !hasRowJump
  );
};

/**
 * Меряет изгиб горизонтальных линий поверх прямой наклонной гребёнки: каждая
 * линия внутри области прослеживается по вертикальным полосам шириной около
 * двух шагов от центра к краям, выбросы заменяются медианой соседних линий,
 * пропуски заполняются.
 *
 * Строки узлов — подряд идущие линии гребёнки между верхним и нижним полями,
 * целиком попадающие в кадр. Узлы стоят в центрах равных полос области, за
 * областью узлов нет: у спирали и за линией поля трасса цеплялась бы за чужие
 * провалы.
 *
 * @param image — полутоновая выжимка фотографии листа
 * @param ruling — прямая разлиновка: шаг, фаза, наклон и поля у левого края кадра
 * @param region — горизонтальная область с линиями
 * @returns изгиб и доля найденных узлов; изгиб `null`, если измерять нечего
 */
export const detectRulingBend = (
  image: SheetImageData,
  ruling: BendBaseRuling,
  region: RulingBendRegion
): RulingBendDetection => {
  const { step, firstLinePhase, skewAngle, margins } = ruling;
  const cropLeft = Math.max(0, Math.ceil(region.left));
  const cropWidth = Math.min(image.width, Math.floor(region.right)) - cropLeft;

  /**
   * Уже восьми пикселей полосы выродились бы в пустые, и расстояние между
   * узлами сетки стало бы нулевым.
   */
  if (step <= 0 || cropWidth < MIN_BEND_STRIPS) {
    return EMPTY_DETECTION;
  }

  const columnCount = Math.min(
    cropWidth,
    Math.max(MIN_BEND_STRIPS, Math.round(cropWidth / (BEND_STRIP_STEPS * step)))
  );
  const strips = buildStripProfiles(
    cropSheetColumns(image, cropLeft, cropWidth),
    'horizontal',
    skewAngle,
    Math.abs(skewAngle),
    columnCount
  );
  const origin = strips[0]?.origin || 0;
  const detrended = strips.map((strip) => {
    return detrendProfile(strip.values, 2 * Math.round(step) + 1);
  });
  const size = detrended[0]?.length || 0;
  const startReach = step * START_SEARCH_SHARE;
  /**
   * Координата прямой линии `k` в бинах профиля вырезки: `firstLinePhase + k·step`
   * у левого края кадра, сдвинутая наклоном к левому краю вырезки.
   */
  const lineOffset = cropLeft * toTangent(skewAngle) - origin + firstLinePhase;
  const tolerance = step * START_SEARCH_SHARE;
  const firstLine = Math.max(
    Math.ceil((margins.top - tolerance - firstLinePhase) / step),
    Math.ceil((1 + startReach - lineOffset) / step)
  );
  const lastLine = Math.min(
    Math.floor((image.height - margins.bottom + tolerance - firstLinePhase) / step),
    Math.floor((size - 2 - startReach - lineOffset) / step)
  );
  const rowCount = lastLine - firstLine + 1;

  if (strips.length !== columnCount || rowCount < FILTER_ROWS) {
    return EMPTY_DETECTION;
  }

  const startDips = Array.from({ length: rowCount }, (_item, row) => {
    const straight = lineOffset + (firstLine + row) * step;

    return detrended.map((profile) => {
      return findLineDip(profile, straight, startReach);
    });
  });
  const threshold =
    LINE_DEPTH_LEVEL *
    computeQuantile(
      startDips.flat().map((dip) => {
        return dip === null ? 0 : dip.depth;
      }),
      LINE_DEPTH_QUANTILE
    );

  if (threshold <= 0) {
    return EMPTY_DETECTION;
  }

  const grid: NodeGrid = {
    offsets: new Float64Array(rowCount * columnCount),
    isFound: new Uint8Array(rowCount * columnCount),
    rowCount,
    columnCount,
  };
  const startOrder = orderFromCenter(columnCount);

  startDips.forEach((dips, row) => {
    const start = startOrder.find((strip) => {
      return (dips[strip]?.depth || 0) >= threshold;
    });
    const startDip = start === undefined ? null : dips[start];

    if (start !== undefined && startDip) {
      traceLine(
        detrended,
        start,
        startDip,
        lineOffset + (firstLine + row) * step,
        step * TRACE_SEARCH_SHARE,
        step * TRACE_FALLBACK_SHARE,
        threshold,
        grid,
        row
      );
    }
  });

  const foundCount = grid.isFound.reduce((sum, value) => {
    return sum + value;
  }, 0);

  const replaced = replaceOutliers(grid, step * OUTLIER_SHARE);

  fillGaps(grid);

  const columnSpacing = cropWidth / columnCount;
  const offsets = Array.from(grid.offsets, roundOffset);
  const foundNodeShare = foundCount / (rowCount * columnCount);

  if (
    !isReliableBend(
      offsets,
      columnCount,
      step,
      foundNodeShare,
      replaced / Math.max(1, foundCount)
    )
  ) {
    return { bend: null, foundNodeShare };
  }

  return {
    bend: {
      /**
       * Пиксель с номером `x` — точка `x`, поэтому вырезка покрывает отрезок от
       * `cropLeft − ½`, и центр её первой полосы на полпикселя левее середины
       * полосы по номерам.
       */
      columnOrigin: cropLeft - 0.5 + columnSpacing / 2,
      columnSpacing,
      columnCount,
      rowOrigin: firstLinePhase + firstLine * step,
      rowSpacing: step,
      rowCount,
      offsets,
    },
    foundNodeShare,
  };
};
