import { bentLineHeightAt } from './bentLineHeightAt';
import type { PinComb, RulingPinsFit } from './fitRulingPins.types';
import type {
  RulingPerspective,
  RulingPin,
  SheetFrame,
  SheetPoint,
  SheetRuling,
} from './paper.types';
import { resolveSheetBounds } from './resolveSheetBounds';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { resolveFirstLineIndex } from './sheetRuling';
import { reanchorSideEdges } from './sideEdges';

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Наименьшая длина булавки по ширине кадра, px. Короче наклон булавки не
 * определён: концы в одном столбце дают деление на ноль.
 */
const MIN_PIN_SPAN = 1;

/**
 * Наименьший знаменатель `1 − a·q` в углах кадра — тот же, с которым детектор
 * принимает измеренную перспективу: ближе к нулю высота линии растёт
 * неограниченно, и малый сдвиг булавки уводил бы строки со страницы.
 */
const MIN_LINE_WEIGHT = 0.5;

/**
 * Расхождение перспективной и прямой гребёнок по кадру, меньше которого
 * перспектива не хранится, px. Порог на два порядка меньше допуска попадания
 * через булавки: снятая перспектива не сдвигает ни одну линию заметно, а две
 * параллельные булавки дают равный шаг без хвоста схождения от округления.
 */
const NEGLIGIBLE_PERSPECTIVE_PX = 0.01;

/**
 * Предел итераций Гаусса — Ньютона. Задача пятимерная и на точных данных
 * сходится за несколько итераций; предел держит только расходящийся случай.
 */
const MAX_ITERATIONS = 50;

/**
 * Сколько раз шаг итерации делится пополам, если полный шаг увеличил невязку.
 */
const MAX_STEP_HALVINGS = 20;

/**
 * Относительное улучшение суммы квадратов невязок, ниже которого подгонка
 * считается сошедшейся.
 */
const MIN_RELATIVE_IMPROVEMENT = 1e-12;

/**
 * Наименьший ведущий элемент нормированной системы: меньше — расстановка не
 * различает параметры гребёнки.
 */
const MIN_PIVOT = 1e-12;

/**
 * Допуск округления до линии в долях шага: поле, стоящее ровно на линии, после
 * деления на шаг даёт целое с погрешностью.
 */
const LINE_SNAP_EPSILON = 1e-6;

/**
 * Доля ширины, на которую концы начальных булавок отступают внутрь: от краёв
 * листа, когда разлиновка не найдена, — у самого края контура бумаги может не
 * быть, — и от краёв блока, когда найдена. У края блока линия на снимке
 * обрывается, уходит под линию поля или в тень переплёта, и магнит, отпущенный
 * там, линии не находит.
 */
const PIN_INSET_SHARE = 0.1;

/**
 * Число параметров гребёнки (`PinComb`): наклон, высота линии `0`, шаг и два
 * схождения. Столько столбцов у строки якобиана и столько уравнений у
 * нормальной системы шага Гаусса — Ньютона.
 */
const COMB_PARAMETER_COUNT = 5;

/**
 * Высота линии `index` над началом в столбце `x`, отсчитанном от начала.
 *
 * @param comb — гребёнка
 * @param index — номер линии
 * @param x — отступ столбца от начала, px
 * @returns отступ линии от начала по высоте, px
 */
const getCombLineY = (comb: PinComb, index: number, x: number): number => {
  const { tangent, offset, step, convergenceX, convergenceY } = comb;
  const height = offset + index * step;

  return (height * (1 + convergenceX * x) + x * tangent) / (1 - height * convergenceY);
};

/**
 * Невязки концов булавок по высоте: по две на булавку — левый и правый конец,
 * по порядку.
 *
 * @param comb — гребёнка
 * @param pins — булавки
 * @param origin — начало гребёнки в пикселях кадра
 * @returns невязки концов, px; положительная — конец ниже линии
 */
const computeEndResiduals = (
  comb: PinComb,
  pins: RulingPin[],
  origin: SheetPoint
): number[] => {
  return pins.flatMap(({ index, left, right }) => {
    return [left, right].map((point) => {
      return point.y - origin.y - getCombLineY(comb, index, point.x - origin.x);
    });
  });
};

/**
 * Сумма квадратов невязок; гребёнка, у которой хоть один конец булавки лежит
 * за горизонтом, получает бесконечность и шагом не принимается.
 *
 * @param comb — гребёнка
 * @param pins — булавки
 * @param origin — начало гребёнки
 * @returns сумма квадратов, px²
 */
const computeCost = (comb: PinComb, pins: RulingPin[], origin: SheetPoint): number => {
  const isBeyondHorizon = pins.some(({ index }) => {
    return 1 - (comb.offset + index * comb.step) * comb.convergenceY <= 0;
  });

  if (isBeyondHorizon) {
    return Number.POSITIVE_INFINITY;
  }

  return computeEndResiduals(comb, pins, origin).reduce((sum, residual) => {
    return sum + residual * residual;
  }, 0);
};

/**
 * Строка якобиана высоты линии по параметрам гребёнки в порядке
 * `tangent, offset, step, convergenceX, convergenceY`.
 *
 * @param comb — гребёнка
 * @param index — номер линии
 * @param x — отступ столбца от начала, px
 * @returns производные высоты линии
 */
const computeJacobianRow = (comb: PinComb, index: number, x: number): number[] => {
  const { tangent, offset, step, convergenceX, convergenceY } = comb;
  const height = offset + index * step;
  const denominator = 1 - height * convergenceY;
  const numerator = height * (1 + convergenceX * x) + x * tangent;
  const byHeight =
    ((1 + convergenceX * x) * denominator + numerator * convergenceY) /
    (denominator * denominator);

  return [
    x / denominator,
    byHeight,
    index * byHeight,
    (height * x) / denominator,
    (numerator * height) / (denominator * denominator),
  ];
};

/**
 * Решение квадратной системы методом Гаусса с выбором ведущего элемента.
 *
 * @param matrix — матрица системы, по строкам; портится
 * @param vector — правая часть; портится
 * @returns решение; `null` — система вырождена
 */
const solveLinearSystem = (matrix: number[][], vector: number[]): number[] | null => {
  const size = vector.length;

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(matrix[row]?.[column] || 0) > Math.abs(matrix[pivotRow]?.[column] || 0)
      ) {
        pivotRow = row;
      }
    }

    const pivotLine = matrix[pivotRow];
    const columnLine = matrix[column];
    const pivot = pivotLine?.[column] || 0;

    if (!pivotLine || !columnLine || Math.abs(pivot) < MIN_PIVOT) {
      return null;
    }

    matrix[pivotRow] = columnLine;
    matrix[column] = pivotLine;
    [vector[pivotRow], vector[column]] = [vector[column] || 0, vector[pivotRow] || 0];

    for (let row = column + 1; row < size; row += 1) {
      const line = matrix[row];

      if (line) {
        const factor = (line[column] || 0) / pivot;

        for (let cell = column; cell < size; cell += 1) {
          line[cell] = (line[cell] || 0) - factor * (pivotLine[cell] || 0);
        }

        vector[row] = (vector[row] || 0) - factor * (vector[column] || 0);
      }
    }
  }

  const solution = Array.from({ length: size }, () => {
    return 0;
  });

  for (let row = size - 1; row >= 0; row -= 1) {
    const line = matrix[row] || [];
    let rest = vector[row] || 0;

    for (let cell = row + 1; cell < size; cell += 1) {
      rest -= (line[cell] || 0) * (solution[cell] || 0);
    }

    solution[row] = rest / (line[row] || 1);
  }

  return solution;
};

/**
 * Шаг Гаусса — Ньютона. Столбцы якобиана нормируются на свою длину: схождение
 * в 1/px и наклон разнятся на шесть порядков, и без нормировки ведущий
 * элемент выбирался бы по масштабу, а не по вкладу.
 *
 * @param comb — текущая гребёнка
 * @param pins — булавки
 * @param origin — начало гребёнки
 * @returns приращение параметров; `null` — расстановка их не различает
 */
const computeGaussNewtonStep = (
  comb: PinComb,
  pins: RulingPin[],
  origin: SheetPoint
): number[] | null => {
  const residuals = computeEndResiduals(comb, pins, origin);
  const rows = pins.flatMap(({ index, left, right }) => {
    return [left, right].map((point) => {
      return computeJacobianRow(comb, index, point.x - origin.x);
    });
  });
  const normal = Array.from({ length: COMB_PARAMETER_COUNT }, (_, row) => {
    return Array.from({ length: COMB_PARAMETER_COUNT }, (__, column) => {
      return rows.reduce((sum, jacobian) => {
        return sum + (jacobian[row] || 0) * (jacobian[column] || 0);
      }, 0);
    });
  });
  const gradient = Array.from({ length: COMB_PARAMETER_COUNT }, (_, row) => {
    return rows.reduce((sum, jacobian, point) => {
      return sum + (jacobian[row] || 0) * (residuals[point] || 0);
    }, 0);
  });
  const scales = normal.map((line, row) => {
    return Math.sqrt(line[row] || 0);
  });

  if (
    scales.some((scale) => {
      return !(scale > 0);
    })
  ) {
    return null;
  }

  const scaledNormal = normal.map((line, row) => {
    return line.map((value, column) => {
      return value / ((scales[row] || 1) * (scales[column] || 1));
    });
  });
  const scaledGradient = gradient.map((value, row) => {
    return value / (scales[row] || 1);
  });
  const solution = solveLinearSystem(scaledNormal, scaledGradient);

  return (
    solution &&
    solution.map((value, row) => {
      return value / (scales[row] || 1);
    })
  );
};

/**
 * Гребёнка, сдвинутая на долю приращения.
 *
 * @param comb — гребёнка
 * @param delta — приращение в порядке строки якобиана
 * @param share — доля приращения
 * @returns сдвинутая гребёнка
 */
const shiftComb = (comb: PinComb, delta: number[], share: number): PinComb => {
  const [tangent = 0, offset = 0, step = 0, convergenceX = 0, convergenceY = 0] = delta;

  return {
    tangent: comb.tangent + share * tangent,
    offset: comb.offset + share * offset,
    step: comb.step + share * step,
    convergenceX: comb.convergenceX + share * convergenceX,
    convergenceY: comb.convergenceY + share * convergenceY,
  };
};

/**
 * Подгонка всех пяти параметров по трём и более булавкам наименьшими
 * квадратами невязок по высоте.
 *
 * @param start — начальная гребёнка
 * @param pins — булавки
 * @param origin — начало гребёнки
 * @returns подогнанная гребёнка; `null` — расстановка параметры не различает
 */
const refineComb = (
  start: PinComb,
  pins: RulingPin[],
  origin: SheetPoint
): PinComb | null => {
  let comb = start;
  let cost = computeCost(comb, pins, origin);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const delta = computeGaussNewtonStep(comb, pins, origin);

    if (!delta) {
      return null;
    }

    let share = 1;
    let next = shiftComb(comb, delta, share);
    let nextCost = computeCost(next, pins, origin);

    for (
      let halving = 0;
      halving < MAX_STEP_HALVINGS && !(nextCost <= cost);
      halving += 1
    ) {
      share /= 2;
      next = shiftComb(comb, delta, share);
      nextCost = computeCost(next, pins, origin);
    }

    if (!(nextCost <= cost)) {
      return comb;
    }

    const improvement = cost - nextCost;

    comb = next;
    cost = nextCost;

    if (improvement <= cost * MIN_RELATIVE_IMPROVEMENT) {
      return comb;
    }
  }

  return comb;
};

/**
 * Наклон прямой через концы булавки и её высота над началом в его столбце.
 *
 * @param pin — булавка
 * @param origin — начало гребёнки
 * @returns наклон и высота, px
 */
const measurePinLine = (pin: RulingPin, origin: SheetPoint): [number, number] => {
  const { left, right } = pin;
  const slope = (right.y - left.y) / (right.x - left.x);

  return [slope, left.y - origin.y - (left.x - origin.x) * slope];
};

/**
 * Точное решение по двум булавкам: четыре уравнения на наклон, высоту, шаг и
 * схождение по ширине, изменение шага по высоте — ноль. Каждая линия гребёнки
 * прямая с высотой `a` в столбце начала и наклоном `t + a·qₓ`, поэтому
 * наклоны и высоты двух булавок дают параметры прямо.
 *
 * @param first — булавка с меньшим номером
 * @param second — булавка с большим номером
 * @param origin — начало гребёнки
 * @returns гребёнка; `null` — линии идут в обратном номерам порядке
 */
const solveTwoPins = (
  first: RulingPin,
  second: RulingPin,
  origin: SheetPoint
): PinComb | null => {
  const [firstSlope, firstHeight] = measurePinLine(first, origin);
  const [secondSlope, secondHeight] = measurePinLine(second, origin);
  const step = (secondHeight - firstHeight) / (second.index - first.index);

  if (!(step > 0)) {
    return null;
  }

  const convergenceX = (secondSlope - firstSlope) / (secondHeight - firstHeight);

  return {
    tangent: firstSlope - firstHeight * convergenceX,
    offset: firstHeight - first.index * step,
    step,
    convergenceX,
    convergenceY: 0,
  };
};

/**
 * Годна ли расстановка для подгонки: булавок не меньше двух, у каждой есть
 * длина по ширине, номера целые и не повторяются.
 *
 * @param pins — булавки
 * @returns признак годной расстановки
 */
const isPlacementUsable = (pins: RulingPin[]): boolean => {
  const indices = new Set(
    pins.map(({ index }) => {
      return index;
    })
  );

  return (
    pins.length >= 2 &&
    indices.size === pins.length &&
    pins.every(({ index, left, right }) => {
      return (
        Number.isInteger(index) &&
        [left.x, left.y, right.x, right.y].every(Number.isFinite) &&
        right.x - left.x >= MIN_PIN_SPAN
      );
    })
  );
};

/**
 * Углы кадра: дробно-линейные знаменатели модели по кадру монотонны, и их
 * хватает углов.
 *
 * @param frame — кадр фотографии
 * @returns углы кадра в пикселях
 */
const listFrameCorners = (frame: SheetFrame): SheetPoint[] => {
  const right = Math.max(frame.width - 1, 0);
  const bottom = Math.max(frame.height - 1, 0);

  return [
    { x: 0, y: 0 },
    { x: right, y: 0 },
    { x: 0, y: bottom },
    { x: right, y: bottom },
  ];
};

/**
 * Лежит ли кадр по эту сторону горизонта перспективы с запасом: вес `w`
 * координаты вдоль линий положителен, а знаменатель `1 − a·q` высоты линии не
 * ближе `MIN_LINE_WEIGHT` к нулю во всех углах.
 *
 * @param ruling — разлиновка с перспективой
 * @param perspective — её перспектива
 * @param frame — кадр фотографии
 * @returns признак годной перспективы
 */
const isPerspectiveInFrame = (
  ruling: SheetRuling,
  perspective: RulingPerspective,
  frame: SheetFrame
): boolean => {
  const { originX, originY, convergenceX, convergenceY } = perspective;
  const tangent = Math.tan(ruling.skewAngle / DEGREES_IN_RADIAN);

  return listFrameCorners(frame).every(({ x, y }) => {
    const weight = 1 + convergenceX * (x - originX) + convergenceY * (y - originY);
    const offset = lineCoordinateAt(ruling, x, y) - originY + originX * tangent;

    return weight > 0 && 1 - offset * convergenceY >= MIN_LINE_WEIGHT;
  });
};

/**
 * Наибольшее расхождение перспективной и прямой гребёнок по кадру: у крайних
 * линий кадра в крайних столбцах. Линии прямые, а расхождение по номеру линии
 * монотонно, поэтому внутренних точек не нужно.
 *
 * @param ruling — разлиновка с перспективой
 * @param frame — кадр фотографии
 * @returns расхождение, px
 */
const measurePerspectiveDeviation = (ruling: SheetRuling, frame: SheetFrame): number => {
  const corners = listFrameCorners(frame);
  const coordinates = corners.map(({ x, y }) => {
    return lineCoordinateAt(ruling, x, y);
  });
  const straight = { ...ruling, perspective: null };

  return [Math.min(...coordinates), Math.max(...coordinates)].reduce((deviation, u) => {
    return corners.reduce((largest, { x }) => {
      return Math.max(
        largest,
        Math.abs(lineHeightAt(ruling, x, u) - lineHeightAt(straight, x, u))
      );
    }, deviation);
  }, 0);
};

/**
 * Невязка каждой булавки у готовой разлиновки: считается через
 * `lineHeightAt`, тем же путём, каким по разлиновке ставятся строки.
 *
 * @param ruling — разлиновка
 * @param pins — булавки
 * @returns наибольшее расстояние по высоте от концов булавки до её линии, px
 */
const measurePinResiduals = (ruling: SheetRuling, pins: RulingPin[]): number[] => {
  return pins.map(({ index, left, right }) => {
    const u = ruling.firstLinePhase + index * ruling.step;

    return Math.max(
      Math.abs(left.y - lineHeightAt(ruling, left.x, u)),
      Math.abs(right.y - lineHeightAt(ruling, right.x, u))
    );
  });
};

/**
 * Подгоняет гребёнку разлиновки через закреплённые линии.
 *
 * Две булавки задают гребёнку точно: шаг по высоте равный, непараллельные
 * булавки дают схождение линий по ширине. Три и больше подгоняют и изменение
 * шага по высоте — перспективу листа, снятого на столе. Линии гребёнки прямые
 * при любой расстановке.
 *
 * Изгиб у подогнанной разлиновки снят: его сетка отсчитана от прежней гребёнки
 * и после смены шага или наклона легла бы мимо линий; заново он подгоняется по
 * фотографии. Боковые поля, линия поля и поля зеркала при смене наклона
 * переписываются так, что на фотографии остаются на месте; верхнее и нижнее
 * поля и контур остаются как были.
 *
 * @param ruling — текущая разлиновка листа
 * @param pins — булавки в пикселях кадра
 * @param frame — кадр фотографии: годность перспективы проверяется в его углах
 * @returns разлиновка и невязка каждой булавки или причина отказа
 */
export const fitRulingPins = (
  ruling: SheetRuling,
  pins: RulingPin[],
  frame: SheetFrame
): RulingPinsFit => {
  const [head] = pins;

  if (!head || !isPlacementUsable(pins)) {
    return { status: 'degenerate' };
  }

  const ends = pins.flatMap(({ left, right }) => {
    return [left, right];
  });
  const origin = {
    x:
      ends.reduce((sum, { x }) => {
        return sum + x;
      }, 0) / ends.length,
    y:
      ends.reduce((sum, { y }) => {
        return sum + y;
      }, 0) / ends.length,
  };
  const first = pins.reduce((lowest, pin) => {
    return pin.index < lowest.index ? pin : lowest;
  }, head);
  const last = pins.reduce((highest, pin) => {
    return pin.index > highest.index ? pin : highest;
  }, head);
  const start = solveTwoPins(first, last, origin);
  const comb = start && pins.length > 2 ? refineComb(start, pins, origin) : start;

  if (
    !comb ||
    !(comb.step > 0) ||
    ![comb.tangent, comb.offset, comb.step, comb.convergenceX, comb.convergenceY].every(
      Number.isFinite
    )
  ) {
    return { status: 'degenerate' };
  }

  const perspective: RulingPerspective = {
    originX: origin.x,
    originY: origin.y,
    convergenceX: comb.convergenceX,
    convergenceY: comb.convergenceY,
  };
  const fitted: SheetRuling = {
    ...ruling,
    step: comb.step,
    firstLinePhase: comb.offset + origin.y - origin.x * comb.tangent,
    skewAngle: Math.atan(comb.tangent) * DEGREES_IN_RADIAN,
    bend: null,
    perspective,
  };

  if (!isPerspectiveInFrame(fitted, perspective, frame)) {
    return { status: 'beyondHorizon', residuals: measurePinResiduals(fitted, pins) };
  }

  const result = reanchorSideEdges(
    measurePerspectiveDeviation(fitted, frame) < NEGLIGIBLE_PERSPECTIVE_PX
      ? { ...fitted, perspective: null }
      : fitted,
    ruling.skewAngle,
    frame
  );

  return {
    status: 'fitted',
    ruling: result,
    residuals: measurePinResiduals(result, pins),
  };
};

/**
 * Булавка на линии разлиновки: концы на высоте линии с её изгибом, чтобы
 * стоять на той линии, которую пользователь видит на снимке.
 *
 * @param ruling — разлиновка листа
 * @param index — номер линии
 * @param left — столбец левого конца, px
 * @param right — столбец правого конца, px
 * @returns булавка
 */
const placePinOnLine = (
  ruling: SheetRuling,
  index: number,
  left: number,
  right: number
): RulingPin => {
  const u = ruling.firstLinePhase + index * ruling.step;

  return {
    index,
    left: { x: left, y: bentLineHeightAt(ruling, ruling.bend, left, u) },
    right: { x: right, y: bentLineHeightAt(ruling, ruling.bend, right, u) },
  };
};

/**
 * Начальные булавки листа: линия первой строки (`resolveFirstLine`, а не
 * линия верхнего поля над ней — у линейки той на листе может не быть) и
 * последняя линия над нижним полем, плюс средняя,
 * если у листа есть перспектива, — две булавки перспективу по высоте не
 * передают. Концы булавок стоят на десятой доле ширины блока внутрь от его
 * краёв.
 *
 * Крайние линии берутся в столбце `0`, как у раскладки и направляющих полей
 * в редакторе: верхнее и нижнее поля — высоты у левого края кадра. В другом
 * столбце наклонного листа они пришлись бы на другие линии, и булавка встала
 * бы на несколько строк выше или ниже первой строки текста.
 *
 * Без шага разлиновки булавки ставятся на четверть и три четверти высоты
 * листа с равными номерами: число шагов между ними задаёт пользователь.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии: от него отсчитываются правое и нижнее поля
 * @returns булавки в порядке номеров
 */
export const deriveRulingPins = (ruling: SheetRuling, frame: SheetFrame): RulingPin[] => {
  const { step, firstLinePhase, margins } = ruling;

  if (step <= 0) {
    const bounds = resolveSheetBounds(ruling.outline, frame.width, frame.height);
    const top = bounds.top;
    const height = frame.height - bounds.bottom - top;
    const width = frame.width - bounds.right - bounds.left;
    const left = bounds.left + width * PIN_INSET_SHARE;
    const right = frame.width - bounds.right - width * PIN_INSET_SHARE;

    return [top + height / 4, top + (height * 3) / 4].map((y) => {
      return { index: 0, left: { x: left, y }, right: { x: right, y } };
    });
  }

  const blockLeft = margins.left;
  const blockRight = frame.width - margins.right;
  const inset = (blockRight - blockLeft) * PIN_INSET_SHARE;
  const left = blockLeft + inset;
  const right = blockRight - inset;
  const firstIndex = resolveFirstLineIndex(ruling);
  const lastIndex = Math.max(
    Math.floor(
      (lineCoordinateAt(ruling, 0, frame.height - margins.bottom) - firstLinePhase) /
        step +
        LINE_SNAP_EPSILON
    ),
    firstIndex + 1
  );
  const middleIndex = Math.round((firstIndex + lastIndex) / 2);
  const indices =
    ruling.perspective && middleIndex > firstIndex && middleIndex < lastIndex
      ? [firstIndex, middleIndex, lastIndex]
      : [firstIndex, lastIndex];

  return indices.map((index) => {
    return placePinOnLine(ruling, index, left, right);
  });
};
