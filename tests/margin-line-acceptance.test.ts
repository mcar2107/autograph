import type { SheetCalibration } from '@pages/Generator/lib/calibrate';
import {
  deriveGeometry,
  GRID_ROW_STEPS,
  MARGIN_LINE_GAP_SHARE,
} from '@pages/Generator/lib/calibrate';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import type { RulingBend, SheetRuling } from '@pages/Generator/lib/paper';
import {
  buildSheetRuling,
  lineHeightAt,
  measureBendDeviation,
  measureSheetPhoto,
  mirrorSheetRuling,
  sampleRulingBend,
} from '@pages/Generator/lib/paper';
import { detectRuling } from '@pages/Generator/lib/paper/detectRuling';
import { describe, expect, it } from 'vitest';

import { getBaselineY } from './helpers/baseline-model';
import {
  computeSyntheticMarginLineX,
  createSyntheticSheet,
  DRIFTING_MARGIN_LINE_SHEET,
  type SyntheticMarginLineSheet,
} from './helpers/synthetic-sheet';

/**
 * Метрики рукописного шрифта в долях кегля: те же, по которым считает
 * геометрию `tests/calibrate-geometry.test.ts`. Края блока от метрик не
 * зависят, но `deriveGeometry` без них не зовётся.
 */
const METRICS: FontMetrics = { xHeight: 0.48, fontAscent: 0.95, lineHeight: 1.25 };

/**
 * Допуск приёмки на положение линии поля в долях шага разлиновки — пятая доля
 * шага из требования «Линия поля находится, когда в кадре она не вертикаль».
 */
const ACCEPTANCE_TOLERANCE_SHARE = 0.2;

/**
 * Барьер глубины линии поля — `MARGIN_LINE_DEPTH_RATIO` из
 * `lib/paper/detectRuling.ts` на момент калибровки. Исходник константу не
 * экспортирует, и литералом она повторена нарочно: записи замера ниже
 * фиксируют запас живой выборки относительно откалиброванного барьера, а число,
 * взятое у детектора, переписалось бы вместе с его правкой. Детектор эти
 * записи не сторожат: сменившийся барьер они не заметят, а поведение барьера
 * на синтетике проверяет `tests/paper-detect-edges-margin-line.test.ts`.
 */
const PEER_DEPTH_RATIO = 1.5;

/**
 * Живой снимок из предмета issue #9: разлиновка, снятая
 * `npm run measure:sheet -- paper_photos_examples/<файл> lined`, и эталон линии
 * поля из `ground-truth.md`.
 *
 * Фотографии лежат вне репозитория, поэтому живой прогон в CI не повторяется:
 * числа приходят литералами из отчёта задачи 6.1, а тест держит арифметику
 * приёмки поверх них.
 */
type LiveSheet = {
  /**
   * Имя файла снимка.
   */
  name: string;

  /**
   * Лист страницы: кадр и разлиновка из отчёта.
   */
  sheet: SheetCalibration;

  /**
   * Эталонные положения черты в координате вдоль линий: по одному на верхнюю,
   * среднюю и нижнюю полосу области с линиями. Черта не параллельна
   * разлиновке, и самое внутреннее из них — точка, ближе которой к тексту
   * черта не подходит нигде на листе.
   */
  trueLine: number[];
};

/**
 * Разлиновка живого снимка по отчёту 6.1.
 *
 * Изгиб, перспектива и контур оставлены пустыми: числами отчёт печатает не
 * сетку изгиба и не коэффициенты схождения, а их сводку, и края блока
 * (`lib/calibrate/deriveGeometry.ts`) читают только шаг, поля и линию поля.
 *
 * @param width — ширина кадра, px
 * @param height — высота кадра, px
 * @param ruling — шаг, фаза, наклон, поля и линия поля из отчёта
 * @returns лист страницы для расчёта геометрии
 */
const toLiveSheet = (
  width: number,
  height: number,
  ruling: Omit<
    SheetRuling,
    'bend' | 'perspective' | 'outline' | 'mirrorOverride' | 'sideSlant'
  >
): SheetCalibration => {
  return {
    kind: 'lined',
    width,
    height,
    ruling: {
      ...ruling,
      bend: null,
      sideSlant: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
  };
};

/**
 * `IMG_1806`: линия поля найдена полосовой ступенью в 2423.9 px справа при
 * эталоне 2425.0 — отход 0.012 шага при допуске 0.2.
 */
const IMG_1806: LiveSheet = {
  name: 'IMG_1806.jpeg',
  sheet: toLiveSheet(3024, 4032, {
    step: 88.14,
    firstLinePhase: 63,
    skewAngle: -1.35,
    margins: { top: 199, right: 284.9, bottom: 263.4, left: 296.4 },
    marginLineX: 2423.9,
    marginLineSide: 'right',
  }),
  trueLine: [2425, 2466, 2517],
};

/**
 * `IMG_1807`: линия поля найдена в 2404.8 px справа при эталоне 2406.0 — отход
 * 0.014 шага.
 */
const IMG_1807: LiveSheet = {
  name: 'IMG_1807.jpeg',
  sheet: toLiveSheet(3024, 4032, {
    step: 86.71,
    firstLinePhase: 75.4,
    skewAngle: -2.05,
    margins: { top: 203.3, right: 286.3, bottom: 303.4, left: 130.1 },
    marginLineX: 2404.8,
    marginLineSide: 'right',
  }),
  trueLine: [2406, 2439, 2479],
};

const LIVE_SHEETS = [IMG_1806, IMG_1807];

/**
 * Правый край блока в пикселях кадра.
 *
 * @param sheet — лист страницы
 * @returns столбец правого края блока
 */
const findBlockRight = (sheet: SheetCalibration): number => {
  const { leftPadding, blockWidth } = deriveGeometry(sheet, METRICS);

  return leftPadding + blockWidth;
};

/**
 * Левый край блока в пикселях кадра.
 *
 * @param sheet — лист страницы
 * @returns столбец левого края блока
 */
const findBlockLeft = (sheet: SheetCalibration): number => {
  return deriveGeometry(sheet, METRICS).leftPadding;
};

/**
 * Тот же лист на зеркальной странице: разлиновка отражается целиком, и линия
 * поля переезжает к противоположной стороне.
 *
 * @param sheet — лист страницы
 * @returns лист правой половины разворота
 */
const mirrorSheet = (sheet: SheetCalibration): SheetCalibration => {
  const { width, height } = sheet;

  return { ...sheet, ruling: mirrorSheetRuling(sheet.ruling, { width, height }) };
};

/**
 * Разлиновка синтетического листа, снятая тем же путём, каким её снимает
 * импорт своего листа: измерение фотографии и сборка разлиновки.
 *
 * @param sheet — синтетический лист
 * @returns лист страницы с измеренной разлиновкой
 */
const measureSyntheticSheet = (sheet: SyntheticMarginLineSheet): SheetCalibration => {
  /**
   * Вид разлиновки у листа необязателен, и его умолчание — линейка, как у
   * самого хелпера: замер и расчёт геометрии обязаны получить один и тот же
   * вид, иначе строка займёт другое число шагов.
   */
  const kind = sheet.kind || 'lined';
  const image = createSyntheticSheet(sheet);
  const { source } = measureSheetPhoto(image, { kind });
  const frame = { width: sheet.width, height: sheet.height };

  return { kind, ...frame, ruling: buildSheetRuling(source, frame) };
};

/**
 * Самое внутреннее место черты синтетического листа в его области с линиями: у
 * левой черты область письма справа, и самое внутреннее — наибольшее `x`.
 *
 * @param sheet — синтетический лист с чертой
 * @returns столбец самой внутренней точки черты
 */
const findInnermostSyntheticX = (sheet: SyntheticMarginLineSheet): number => {
  let innermost = Number.NEGATIVE_INFINITY;

  for (let y = sheet.margins.top; y <= sheet.height - sheet.margins.bottom; y += 1) {
    innermost = Math.max(innermost, computeSyntheticMarginLineX(sheet, y) || 0);
  }

  return innermost;
};

/**
 * Наименьший зазор между краем блока и чертой по всей высоте области с
 * линиями. Положительный — текст черту не пересекает.
 *
 * @param sheet — синтетический лист с чертой
 * @param edge — край блока в пикселях кадра
 * @param isMirrored — страница зеркальная: черта отражена вместе с листом
 * @returns наименьший зазор в пикселях
 */
const findSyntheticClearance = (
  sheet: SyntheticMarginLineSheet,
  edge: number,
  isMirrored: boolean
): number => {
  let clearance = Number.POSITIVE_INFINITY;

  for (let y = sheet.margins.top; y <= sheet.height - sheet.margins.bottom; y += 1) {
    const line = computeSyntheticMarginLineX(sheet, y) || 0;
    const gap = isMirrored ? sheet.width - line - edge : edge - line;

    clearance = Math.min(clearance, gap);
  }

  return clearance;
};

/**
 * Допуск на отклонение базовой линии от линии разлиновки в долях шага —
 * десятая доля шага из требования.
 */
const BASELINE_DRIFT_SHARE = 0.1;

/**
 * Погрешность сравнения пикселей: складываются дробные шаги.
 */
const PX_EPSILON = 1e-9;

/**
 * Порог проверки надёжности изгиба: ниже этой доли найденных узлов изгиб не
 * сохраняется (`lib/paper/detectRulingBend.ts`).
 */
const BEND_NODE_SHARE = 0.6;

/**
 * Наименьший отход изгиба в долях шага, при котором он сохраняется: мельче
 * двадцатой доли шага изгиб не окупает хранения.
 */
const BEND_DEVIATION_SHARE = 0.05;

/**
 * Насколько область изгиба обязана сузиться от найденной черты в шагах
 * разлиновки. На живых снимках, где черта нашлась впервые, блок и область
 * изгиба сузились на 2.6…3.05 шага; синтетика держит ту же меру.
 */
const MIN_NARROWING_STEPS = 2;

/**
 * Амплитуда изгиба листа калибровки в пикселях — четверть шага.
 */
const CALIBRATION_BEND_AMPLITUDE = 10;

/**
 * Изгиб линий листа калибровки: полуволна на всю ширину кадра.
 *
 * @param x — столбец кадра
 * @returns смещение линии вниз от прямой гребёнки в пикселях
 */
const computeCalibrationBend = (x: number): number => {
  return (
    CALIBRATION_BEND_AMPLITUDE *
    Math.sin((Math.PI * x) / DRIFTING_MARGIN_LINE_SHEET.width)
  );
};

/**
 * Лист со снесённой чертой, у которого линии ещё и изогнуты: у ровного листа
 * сетки изгиба нет вовсе, и сужать черте было бы нечего. Сам хелпер листов при
 * этом не меняется — изгиб добавлен поверх замороженного листа калибровки.
 */
const BENT_MARGIN_LINE_SHEET = {
  ...DRIFTING_MARGIN_LINE_SHEET,
  bend: computeCalibrationBend,
};

const BENT_IMAGE = createSyntheticSheet(BENT_MARGIN_LINE_SHEET);

/**
 * Лист с подменённой разлиновкой.
 *
 * @param sheet — исходный лист
 * @param patch — поля разлиновки, которые нужно заменить
 * @returns лист с новой разлиновкой
 */
const withRuling = (
  sheet: SheetCalibration,
  patch: Partial<SheetRuling>
): SheetCalibration => {
  return { ...sheet, ruling: { ...sheet.ruling, ...patch } };
};

/**
 * Линия разлиновки, на которую должна лечь строка с этим номером. Первая линия
 * считается здесь заново, а не берётся из кода: она не выше верхнего поля.
 *
 * @param sheet — лист страницы
 * @param lineIndex — номер строки от нуля
 * @returns высота линии в пикселях кадра
 */
const getRulingLineY = (sheet: SheetCalibration, lineIndex: number): number => {
  const { step, firstLinePhase, margins } = sheet.ruling;
  const rowSteps = sheet.kind === 'grid' ? GRID_ROW_STEPS : 1;
  const firstLine =
    firstLinePhase + Math.ceil((margins.top - firstLinePhase) / step - PX_EPSILON) * step;

  return firstLine + lineIndex * step * rowSteps;
};

/**
 * Наибольшее отклонение базовых линий от разлиновки на всех строках, которые
 * помещаются на странице: у снимка с найденной чертой строк за сорок, и
 * отклонение копится к низу листа.
 *
 * @param sheet — лист страницы
 * @returns отклонение в пикселях
 */
const findMaxBaselineDrift = (sheet: SheetCalibration): number => {
  const geometry = deriveGeometry(sheet, METRICS);
  const bottom = sheet.height - sheet.ruling.margins.bottom;
  let maxDrift = 0;

  for (let lineIndex = 0; getRulingLineY(sheet, lineIndex) <= bottom; lineIndex += 1) {
    maxDrift = Math.max(
      maxDrift,
      Math.abs(
        getBaselineY(geometry, METRICS, lineIndex) - getRulingLineY(sheet, lineIndex)
      )
    );
  }

  return maxDrift;
};

/**
 * Наибольшее отклонение базовых линий листа с изгибом от его настоящих линий.
 *
 * Сравнение идёт с линиями синтетического листа — `phase + k·step` плюс
 * изгиб калибровки в том же столбце, — а не с гребёнкой из разлиновки:
 * `deriveGeometry` изгиба не читает, и сверка с прямой гребёнкой была бы
 * тождеством плоской модели. Базовая линия в столбце ставится так же, как в
 * отрисовке: строка на прямой наклонной гребёнке плюс смещение по найденной
 * сетке изгиба. Номер настоящей линии — ближайшая к строке: при допуске в
 * десятую долю шага округление до половины шага ничего не прощает.
 *
 * @param sheet — лист страницы с разлиновкой, найденной на снимке
 * @param shouldApplyBend — сдвигать ли строки по сетке изгиба; без сдвига
 *   видно, насколько изгиб листа уводит прямые строки с линий
 * @returns отклонение в пикселях по всем строкам и столбцам блока
 */
const findMaxBentBaselineDrift = (
  sheet: SheetCalibration,
  shouldApplyBend: boolean
): number => {
  const { bend, skewAngle, margins } = sheet.ruling;
  const { phase, step } = BENT_MARGIN_LINE_SHEET;
  const geometry = deriveGeometry(sheet, METRICS);
  const { leftPadding, blockWidth } = geometry;
  const projection = { skewAngle, perspective: null };
  const bottom = sheet.height - margins.bottom;
  let maxDrift = 0;

  for (
    let lineIndex = 0;
    getBaselineY(geometry, METRICS, lineIndex) <= bottom;
    lineIndex += 1
  ) {
    const baseline = getBaselineY(geometry, METRICS, lineIndex);
    const trueLine = phase + Math.round((baseline - phase) / step) * step;

    for (let x = leftPadding; x <= leftPadding + blockWidth; x += 1) {
      const lineY = lineHeightAt(projection, x, baseline);
      const offset =
        shouldApplyBend && bend ? sampleRulingBend(bend, projection, x, lineY) : 0;

      maxDrift = Math.max(
        maxDrift,
        Math.abs(lineY + offset - (trueLine + computeCalibrationBend(x)))
      );
    }
  }

  return maxDrift;
};

/**
 * Разлиновка листа с изгибом и чертой.
 *
 * @param isLineIgnored — черту не искать: так лист выглядел до полосовой
 *   ступени, и с ним сравнивается сузившаяся область изгиба
 * @returns результат детектора
 */
const detectBentSheet = (isLineIgnored = false): ReturnType<typeof detectRuling> => {
  return detectRuling(BENT_IMAGE, isLineIgnored ? { marginLineSide: null } : {});
};

/**
 * Сетка изгиба, без которой проверке нечего мерить: пустая сетка означает, что
 * изгиб потерялся, и падать тест обязан с этим, а не на обращении к `null`.
 *
 * @param bend — сетка изгиба разлиновки
 * @returns та же сетка
 */
const requireBend = (bend: RulingBend | null): RulingBend => {
  if (bend === null) {
    throw new Error('Изгиб не найден: сужать область нечему');
  }

  return bend;
};

/**
 * Края области, по которой снята сетка изгиба.
 */
type BendArea = {
  /**
   * Левый край области в пикселях кадра.
   */
  from: number;

  /**
   * Правый край области в пикселях кадра.
   */
  to: number;
};

/**
 * Края области, по которой снята сетка изгиба: узлы стоят в центрах равных
 * полос области, поэтому её края отстоят от крайних узлов на полполосы.
 *
 * @param bend — сетка изгиба
 * @returns левый и правый края области в пикселях кадра
 */
const findBendArea = (bend: RulingBend): BendArea => {
  const { columnOrigin, columnSpacing, columnCount } = bend;
  const half = columnSpacing / 2;

  return {
    from: columnOrigin - half,
    to: columnOrigin + (columnCount - 1) * columnSpacing + half,
  };
};

describe('приёмка issue #9: линия поля на снимках, где её не было', () => {
  it.each(LIVE_SHEETS)(
    '$name: найденная линия отстоит от эталона не больше чем на пятую долю шага',
    ({ sheet, trueLine }) => {
      const { step, marginLineX } = sheet.ruling;
      const innermost = Math.min(...trueLine);

      expect(marginLineX).not.toBeNull();
      expect(sheet.ruling.marginLineSide).toBe('right');
      expect(Math.abs((marginLineX || 0) - innermost)).toBeLessThanOrEqual(
        ACCEPTANCE_TOLERANCE_SHARE * step
      );
    }
  );

  it('запись замера `IMG_1596`: барьер выше глубины лучшего кандидата в полтора раза', () => {
    /**
     * Запись калибровки, а не проверка: оба числа — литералы, и упасть она
     * не может. Держит арифметику запаса, чтобы правка барьера или таблицы
     * калибровки была видна в этом файле.
     *
     * Глубина лучшего кандидата `IMG_1596` в долях децили соседних вертикалей
     * (`calibration.md`): барьер на том же снимке — `PEER_DEPTH_RATIO` тех же
     * децилей, поэтому запас считается их отношением, а не разностью
     * абсолютных глубин.
     */
    const candidateDepthShare = 0.86;

    expect(PEER_DEPTH_RATIO / candidateDepthShare).toBeGreaterThanOrEqual(1.5);
  });

  it('запись замера: барьер разделяет классы живой выборки с запасом', () => {
    /**
     * Запись калибровки, а не проверка: все числа — литералы, и упасть она
     * не может.
     *
     * Крайние отношения «глубина / дециль соседей» по таблице калибровки 3.4:
     * `IMG_1706` — самый глубокий кандидат среди снимков без черты, `IMG_1807` —
     * самая мелкая настоящая черта.
     */
    const maxAbsentRatio = 1.39;
    const minPresentRatio = 2.48;

    expect(maxAbsentRatio).toBeLessThan(PEER_DEPTH_RATIO);
    expect(minPresentRatio).toBeGreaterThan(PEER_DEPTH_RATIO);
    expect(minPresentRatio - maxAbsentRatio).toBeGreaterThanOrEqual(0.1);
  });
});

describe('приёмка issue #9: край блока не заходит за черту', () => {
  it.each(LIVE_SHEETS)(
    '$name: правый край блока отстоит от черты внутрь на всей высоте страницы',
    ({ sheet, trueLine }) => {
      const { step } = sheet.ruling;
      const right = findBlockRight(sheet);

      expect(right).toBeLessThanOrEqual(
        (sheet.ruling.marginLineX || 0) - MARGIN_LINE_GAP_SHARE * step
      );

      for (const line of trueLine) {
        expect(line - right).toBeGreaterThanOrEqual(ACCEPTANCE_TOLERANCE_SHARE * step);
      }
    }
  );

  it('`IMG_1806`: край блока уходит с правого поля внутрь черты', () => {
    const { width, ruling } = IMG_1806.sheet;

    expect(findBlockRight(IMG_1806.sheet)).toBeLessThan(width - ruling.margins.right);
  });

  it.each(LIVE_SHEETS)(
    '$name: на зеркальной странице черта и край блока меняют сторону',
    ({ sheet, trueLine }) => {
      const mirrored = mirrorSheet(sheet);
      const { step, marginLineX } = mirrored.ruling;
      const left = findBlockLeft(mirrored);

      expect(mirrored.ruling.marginLineSide).toBe('left');
      expect(left).toBeGreaterThanOrEqual(
        (marginLineX || 0) + MARGIN_LINE_GAP_SHARE * step
      );

      for (const line of trueLine) {
        expect(left - (sheet.width - line)).toBeGreaterThanOrEqual(
          ACCEPTANCE_TOLERANCE_SHARE * step
        );
      }
    }
  );
});

describe('приёмка issue #9: снесённая черта на синтетическом листе', () => {
  const sheet = DRIFTING_MARGIN_LINE_SHEET;

  it('измеренная линия отстоит от самой внутренней точки черты не больше чем на пятую долю шага', () => {
    const { ruling } = measureSyntheticSheet(sheet);

    expect(ruling.marginLineSide).toBe('left');
    expect(
      Math.abs((ruling.marginLineX || 0) - findInnermostSyntheticX(sheet))
    ).toBeLessThanOrEqual(ACCEPTANCE_TOLERANCE_SHARE * sheet.step);
  });

  it('левый край блока не заходит за черту ни на одной высоте', () => {
    const measured = measureSyntheticSheet(sheet);
    const left = findBlockLeft(measured);

    expect(left).toBeGreaterThanOrEqual(
      (measured.ruling.marginLineX || 0) + MARGIN_LINE_GAP_SHARE * measured.ruling.step
    );
    expect(findSyntheticClearance(sheet, left, false)).toBeGreaterThanOrEqual(0);
  });

  it('на зеркальной странице правый край блока не заходит за отражённую черту', () => {
    const mirrored = mirrorSheet(measureSyntheticSheet(sheet));
    const right = findBlockRight(mirrored);

    expect(mirrored.ruling.marginLineSide).toBe('right');
    expect(right).toBeLessThanOrEqual(
      (mirrored.ruling.marginLineX || 0) - MARGIN_LINE_GAP_SHARE * mirrored.ruling.step
    );
    expect(findSyntheticClearance(sheet, right, true)).toBeGreaterThanOrEqual(0);
  });
});

describe('приёмка issue #9: текст по-прежнему ложится на разлиновку', () => {
  it.each(LIVE_SHEETS)(
    '$name: базовые линии отстоят от разлиновки не больше чем на десятую долю шага',
    ({ sheet }) => {
      expect(findMaxBaselineDrift(sheet)).toBeLessThanOrEqual(
        BASELINE_DRIFT_SHARE * sheet.ruling.step
      );
    }
  );

  it.each(LIVE_SHEETS)('$name: линия поля не сдвинула разлиновку', ({ sheet }) => {
    const withoutLine = withRuling(sheet, { marginLineX: null, marginLineSide: null });
    const geometry = deriveGeometry(sheet, METRICS);
    const bare = deriveGeometry(withoutLine, METRICS);

    expect(geometry.topOffset).toBe(bare.topOffset);
    expect(geometry.fontSizePx).toBe(bare.fontSizePx);
    expect(geometry.lineSpacing).toBe(bare.lineSpacing);
  });

  it.each(LIVE_SHEETS)(
    '$name: на зеркальной странице базовые линии тоже ложатся на разлиновку',
    ({ sheet }) => {
      const mirrored = mirrorSheet(sheet);

      expect(findMaxBaselineDrift(mirrored)).toBeLessThanOrEqual(
        BASELINE_DRIFT_SHARE * mirrored.ruling.step
      );
    }
  );
});

describe('приёмка issue #9: впервые найденная черта сужает область изгиба', () => {
  it('граница сетки изгиба со стороны черты совпала с линией поля', () => {
    const detection = detectBentSheet();
    const bend = requireBend(detection.bend);

    expect(detection.marginLineSide).toBe('left');
    expect(
      Math.abs(findBendArea(bend).from - (detection.marginLineX || 0))
    ).toBeLessThanOrEqual(bend.columnSpacing);
  });

  it('сетка сузилась только со стороны черты и на те же два с лишним шага', () => {
    const area = findBendArea(requireBend(detectBentSheet().bend));
    const bareBend = requireBend(detectBentSheet(true).bend);
    const bare = findBendArea(bareBend);
    const { step, margins } = BENT_MARGIN_LINE_SHEET;

    expect(Math.abs(bare.from - margins.left)).toBeLessThanOrEqual(
      bareBend.columnSpacing
    );
    expect(area.to).toBeCloseTo(bare.to, 9);
    expect((area.from - bare.from) / step).toBeGreaterThan(MIN_NARROWING_STEPS);
  });

  it('изгиб не потерялся от сужения области', () => {
    const detection = detectBentSheet();
    const bend = requireBend(detection.bend);

    expect(detection.bendFoundNodeShare).toBeGreaterThanOrEqual(BEND_NODE_SHARE);
    expect(
      measureBendDeviation(bend.offsets, bend.columnCount) / detection.step
    ).toBeGreaterThan(BEND_DEVIATION_SHARE);
  });

  it('на пересчитанной сетке базовые линии ложатся на разлиновку', () => {
    const detection = detectBentSheet();
    const frame = {
      width: BENT_MARGIN_LINE_SHEET.width,
      height: BENT_MARGIN_LINE_SHEET.height,
    };
    const sheet: SheetCalibration = {
      kind: 'grid',
      ...frame,
      ruling: buildSheetRuling(detection, frame),
    };

    expect(sheet.ruling.bend).not.toBeNull();
    expect(findMaxBentBaselineDrift(sheet, true)).toBeLessThanOrEqual(
      BASELINE_DRIFT_SHARE * sheet.ruling.step
    );
    expect(findMaxBentBaselineDrift(sheet, false)).toBeGreaterThan(
      BASELINE_DRIFT_SHARE * sheet.ruling.step
    );
  });
});
