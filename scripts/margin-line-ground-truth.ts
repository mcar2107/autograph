import { resolve } from 'node:path';

import { chromium } from 'playwright';

import type { RulingKind } from '../src/pages/Generator/lib/paper';
import {
  buildSheetRuling,
  lineHeightAt,
  measureSheetPhoto,
  resolveFirstLine,
  resolveSheetBounds,
} from '../src/pages/Generator/lib/paper';

import type { SheetPhotoChannels } from './sheet-photo-report';
import { decodeSheetPhotoChannels } from './sheet-photo-report';

/**
 * Эталон линии поля по цвету: есть ли на снимке красная черта поля, у какой
 * стороны и где. Класс решает цвет столбца, а не ответ детектора, поэтому
 * поиск столбца написан здесь заново, отдельно от `detectRuling`: эталон,
 * который зовёт детектор, мерил бы сам себя. Из измерения берётся только
 * геометрия — шаг, угол, вырезка и область с линиями.
 *
 * Запуск — `npm run measure:margin-color -- <путь> [grid|lined|blank] [u,…]`.
 * Третий аргумент — столбцы `u`, цвет которых напечатать отдельно: так
 * проверяется ответ детектора, которого нет среди пиков красноты.
 */

/**
 * Виды, которые принимает второй аргумент.
 */
const RULING_KINDS: RulingKind[] = ['grid', 'lined', 'blank'];

/**
 * Вид по умолчанию — тот же, что у `measure:sheet`.
 */
const DEFAULT_KIND: RulingKind = 'grid';

/**
 * Число горизонтальных полос по высоте области с линиями.
 */
const BAND_COUNT = 3;

/**
 * Высота полосы, px. Полоса короче размывает черту шумом бумаги, длиннее —
 * на листе с наклоном или изгибом растягивает черту по нескольким столбцам.
 */
const BAND_HEIGHT = 400;

/**
 * Подписи полос сверху вниз.
 */
const BAND_LABELS = ['верх', 'середина', 'низ'];

/**
 * Доля ширины вырезки у каждого края, где ищется черта.
 */
const SIDE_FRACTION = 1 / 3;

/**
 * Доля высоты полосы, которую столбец обязан покрыть: столбцы у скошенного
 * края вырезки собраны из нескольких пикселей и шумят.
 */
const MIN_BIN_FILL = 0.6;

/**
 * Масштаб медианы модуля к σ нормального шума.
 */
const MAD_TO_SIGMA = 1.4826;

/**
 * Полуширина ядра столбца в бинах.
 */
const CORE_OFFSETS = [-1, 0, 1];

/**
 * Смещения бумаги вокруг столбца в бинах: дальше ширины черты, ближе соседней
 * вертикали клетки.
 */
const PAPER_OFFSETS = [-40, -35, -30, -25, 25, 30, 35, 40];

/**
 * Наименьший запас провала по зелёному над провалом по красному у черты.
 * У красной черты зелёный проседает сильнее: у 13 черт живых снимков запас
 * не меньше 13,5, у нейтральной клетки тёплой бумаги — не больше 5,5.
 */
const MIN_GREEN_EXCESS = 10;

/**
 * Наименьший пик красноты в σ шума средней трети.
 */
const MIN_REDNESS_SIGMAS = 10;

/**
 * Сколько полос из `BAND_COUNT` должны пройти правило, чтобы у стороны была
 * черта. Большинство, а не все: соринка или текст могут закрыть черту в одной
 * полосе.
 */
const MIN_PASSING_BANDS = 2;

/**
 * Сторона листа.
 */
type Side = 'left' | 'right';

/**
 * Стороны в порядке печати.
 */
const SIDES: Side[] = ['left', 'right'];

/**
 * Подписи сторон.
 */
const SIDE_LABELS: Record<Side, string> = {
  left: 'слева',
  right: 'справа',
};

/**
 * Аргументы командной строки.
 */
type GroundTruthArguments = {
  /**
   * Абсолютный путь к фотографии.
   */
  path: string;

  /**
   * Вид семьи, под который меряется геометрия.
   */
  kind: RulingKind;

  /**
   * Столбцы `u`, цвет которых печатается отдельно.
   */
  probes: number[];
};

/**
 * Геометрия профиля: вырезка, наклон и сдвиг бинов.
 */
type ProfileGeometry = {
  /**
   * Левый край вырезки, px.
   */
  cropLeft: number;

  /**
   * Правый край вырезки, px, не включая.
   */
  cropRight: number;

  /**
   * Верх вырезки, px: от него отсчитан сдвиг `u`.
   */
  cropTop: number;

  /**
   * Тангенс наклона линий.
   */
  tangent: number;

  /**
   * Сдвиг бина относительно `u`, чтобы бины при наклоне не уходили в минус.
   */
  shift: number;

  /**
   * Число бинов.
   */
  size: number;

  /**
   * Шаг разлиновки, px.
   */
  step: number;
};

/**
 * Средние каналов по столбцам `u = x + (y − cropTop)·tgθ` одной полосы.
 */
type BandProfile = {
  /**
   * Подпись полосы.
   */
  label: string;

  /**
   * Первая строка полосы.
   */
  yFrom: number;

  /**
   * Строка за последней строкой полосы.
   */
  yTo: number;

  /**
   * Средняя строка полосы: в ней `x` столбца переводится из `u`.
   */
  centerY: number;

  /**
   * Средняя яркость столбца, `NaN` — столбец пуст.
   */
  luminance: Float64Array;

  /**
   * Средний красный канал столбца.
   */
  red: Float64Array;

  /**
   * Средний зелёный канал столбца.
   */
  green: Float64Array;

  /**
   * Первый бин, покрытый на `MIN_BIN_FILL` высоты полосы.
   */
  filledFrom: number;

  /**
   * Последний бин, покрытый на `MIN_BIN_FILL` высоты полосы.
   */
  filledTo: number;
};

/**
 * Строки полосы.
 */
type BandRows = Pick<BandProfile, 'label' | 'yFrom' | 'yTo'>;

/**
 * Значение в столбце: пик красноты или глубина провала яркости.
 */
type ColumnValue = {
  /**
   * Координата вдоль линий.
   */
  u: number;

  /**
   * Значение в столбце.
   */
  value: number;
};

/**
 * Средние красного и зелёного по набору бинов.
 */
type ChannelMean = {
  /**
   * Средний красный.
   */
  red: number;

  /**
   * Средний зелёный.
   */
  green: number;
};

/**
 * Цвет столбца против бумаги рядом.
 */
type ColumnSign = {
  /**
   * Координата вдоль линий.
   */
  u: number;

  /**
   * Столбец кадра в средней строке полосы.
   */
  x: number;

  /**
   * Красный канал столбца.
   */
  coreRed: number;

  /**
   * Зелёный канал столбца.
   */
  coreGreen: number;

  /**
   * Провал красного: бумага минус столбец.
   */
  deltaRed: number;

  /**
   * Провал зелёного: бумага минус столбец.
   */
  deltaGreen: number;
};

/**
 * Пик красноты полосы у одной стороны и его проверка правилом.
 */
type RednessPeak = ColumnSign & {
  /**
   * Избыток `R − G` над скользящей медианой.
   */
  excess: number;

  /**
   * Избыток в σ шума средней трети.
   */
  sigmas: number;

  /**
   * Пик ближе шага к краю вырезки: там стол, обложка и тень края.
   */
  isAtEdge: boolean;

  /**
   * Пик прошёл правило класса.
   */
  isPassing: boolean;
};

/**
 * Самый глубокий провал яркости у стороны и его цвет.
 */
type DeepestDip = ColumnSign & {
  /**
   * Глубина провала яркости под скользящей медианой.
   */
  depth: number;
};

/**
 * Итог полосы у одной стороны.
 */
type BandSide = {
  /**
   * Пик красноты, `null` — у стороны нет покрытых столбцов.
   */
  peak: RednessPeak | null;

  /**
   * Цвет самого глубокого провала яркости, `null` — провалов нет.
   */
  deepest: DeepestDip | null;
};

/**
 * Разбирает аргументы командной строки: путь, вид семьи и пробы.
 */
const parseArguments = (): GroundTruthArguments => {
  const [path, kindArgument, probesArgument] = process.argv.slice(2);

  if (!path) {
    throw new Error(
      'Укажите путь: npm run measure:margin-color -- <путь> [grid|lined|blank] [u,…]'
    );
  }

  const kind = RULING_KINDS.find((candidate) => {
    return candidate === kindArgument;
  });

  if (kindArgument && !kind) {
    throw new Error(`Неизвестный вид «${kindArgument}», ожидается grid, lined или blank`);
  }

  const probes = (probesArgument || '').split(',').reduce<number[]>((acc, value) => {
    if (value.trim()) {
      acc.push(Number(value));
    }

    return acc;
  }, []);

  if (probes.some(Number.isNaN)) {
    throw new Error(`Пробы «${probesArgument}» — не числа через запятую`);
  }

  return { path: resolve(path), kind: kind || DEFAULT_KIND, probes };
};

/**
 * Медиана чисел; пустой список — ноль.
 */
const median = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => {
    return a - b;
  });
  const middle = sorted.length >> 1;

  if (sorted.length % 2) {
    return sorted[middle] || 0;
  }

  return ((sorted[middle - 1] || 0) + (sorted[middle] || 0)) / 2;
};

/**
 * Скользящая медиана окном в `window` бинов — фон, над которым черта
 * выделяется пиком, а плавный перепад света пиков не даёт.
 */
const movingMedian = (values: Float64Array, window: number): Float64Array => {
  const half = Math.max(1, Math.round(window / 2));

  return values.map((_value, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(values.length - 1, index + half);

    return median(Array.from(values.subarray(from, to + 1)));
  });
};

/**
 * Собирает профили каналов полосы по столбцам `u`. Средние, а не суммы:
 * столбцы у скошенного края вырезки покрыты не на всю высоту.
 */
const measureBand = (
  photo: SheetPhotoChannels,
  geometry: ProfileGeometry,
  band: BandRows
): BandProfile => {
  const { width, luminance, red, green } = photo;
  const { cropLeft, cropRight, cropTop, tangent, shift, size } = geometry;
  const { yFrom, yTo } = band;
  const luminanceSums = new Float64Array(size);
  const redSums = new Float64Array(size);
  const greenSums = new Float64Array(size);
  const counts = new Float64Array(size);

  for (let y = yFrom; y < yTo; y += 1) {
    const row = y * width;
    const offset = (y - cropTop) * tangent;

    for (let x = cropLeft; x < cropRight; x += 1) {
      const bin = Math.round(x + offset) + shift;

      if (bin >= 0 && bin < size) {
        luminanceSums[bin] = (luminanceSums[bin] || 0) + (luminance[row + x] || 0);
        redSums[bin] = (redSums[bin] || 0) + (red[row + x] || 0);
        greenSums[bin] = (greenSums[bin] || 0) + (green[row + x] || 0);
        counts[bin] = (counts[bin] || 0) + 1;
      }
    }
  }

  const toMeans = (source: Float64Array): Float64Array => {
    return source.map((sum, index) => {
      return counts[index] ? sum / (counts[index] || 1) : Number.NaN;
    });
  };

  const minCount = MIN_BIN_FILL * (yTo - yFrom);
  const filledBins = counts.reduce<number[]>((acc, count, index) => {
    if (count >= minCount) {
      acc.push(index);
    }

    return acc;
  }, []);

  return {
    ...band,
    centerY: (yFrom + yTo) / 2,
    luminance: toMeans(luminanceSums),
    red: toMeans(redSums),
    green: toMeans(greenSums),
    filledFrom: filledBins[0] || 0,
    filledTo: filledBins.at(-1) || 0,
  };
};

/**
 * Цвет столбца `u`: среднее ядра ±1 бин против среднего бумаги по сторонам.
 * Пустые бины пропускаются — у края вырезки бумаги с одной стороны нет.
 */
const signAt = (
  profile: BandProfile,
  geometry: ProfileGeometry,
  u: number
): ColumnSign => {
  const bin = Math.round(u) + geometry.shift;

  const meanOf = (offsets: number[]): ChannelMean => {
    const picked = offsets.reduce<number[]>((acc, offset) => {
      const red = profile.red[bin + offset];

      if (red !== undefined && Number.isFinite(red)) {
        acc.push(bin + offset);
      }

      return acc;
    }, []);
    const count = picked.length || 1;
    const sum = picked.reduce<ChannelMean>(
      (acc, index) => {
        return {
          red: acc.red + (profile.red[index] || 0),
          green: acc.green + (profile.green[index] || 0),
        };
      },
      { red: 0, green: 0 }
    );

    return { red: sum.red / count, green: sum.green / count };
  };

  const core = meanOf(CORE_OFFSETS);
  const paper = meanOf(PAPER_OFFSETS);

  return {
    u,
    x: u - (profile.centerY - geometry.cropTop) * geometry.tangent,
    coreRed: core.red,
    coreGreen: core.green,
    deltaRed: paper.red - core.red,
    deltaGreen: paper.green - core.green,
  };
};

/**
 * Сторона, к крайней трети которой относится столбец; `null` — средняя треть.
 */
const toSide = (x: number, geometry: ProfileGeometry): Side | null => {
  const innerWidth = geometry.cropRight - geometry.cropLeft;

  if (x < geometry.cropLeft + innerWidth * SIDE_FRACTION) {
    return 'left';
  }

  if (x > geometry.cropRight - innerWidth * SIDE_FRACTION) {
    return 'right';
  }

  return null;
};

/**
 * Ищет у каждой стороны полосы пик красноты и самый глубокий провал яркости.
 *
 * Краснота — `R − G` минус скользящая медиана окном в шаг: красная черта даёт
 * положительный пик, серая или синяя вертикаль клетки и тень — нет. Провал
 * яркости печатается для сверки: он показывает, что видит профиль по яркости
 * на том же месте.
 */
const analyseBand = (
  profile: BandProfile,
  geometry: ProfileGeometry
): Record<Side, BandSide> => {
  const { filledFrom: from, filledTo: to } = profile;
  const { step, shift, cropLeft, cropRight } = geometry;
  const redness = new Float64Array(to - from + 1).map((_value, index) => {
    return (profile.red[from + index] || 0) - (profile.green[from + index] || 0);
  });
  const rednessBackground = movingMedian(redness, step);
  const brightness = profile.luminance.slice(from, to + 1);
  const brightnessBackground = movingMedian(brightness, step);
  const middle: number[] = [];
  const best: Record<Side, ColumnValue | null> = { left: null, right: null };
  const deepest: Record<Side, ColumnValue | null> = { left: null, right: null };

  for (let index = 0; index < redness.length; index += 1) {
    const u = from + index - shift;
    const x = u - (profile.centerY - geometry.cropTop) * geometry.tangent;
    const excess = (redness[index] || 0) - (rednessBackground[index] || 0);
    const side = toSide(x, geometry);

    if (!side) {
      middle.push(Math.abs(excess));
      continue;
    }

    const current = best[side];

    if (!current || excess > current.value) {
      best[side] = { u, value: excess };
    }

    const depth = (brightnessBackground[index] || 0) - (brightness[index] || 0);
    const isLocalMinimum =
      index > 0 &&
      index < redness.length - 1 &&
      depth > 0 &&
      depth >= (brightnessBackground[index - 1] || 0) - (brightness[index - 1] || 0) &&
      depth >= (brightnessBackground[index + 1] || 0) - (brightness[index + 1] || 0);
    const currentDeepest = deepest[side];

    if (isLocalMinimum && (!currentDeepest || depth > currentDeepest.value)) {
      deepest[side] = { u, value: depth };
    }
  }

  const sigma = MAD_TO_SIGMA * median(middle) || Number.EPSILON;

  const toBandSide = (side: Side): BandSide => {
    const peak = best[side];
    const deep = deepest[side];

    if (!peak) {
      return { peak: null, deepest: null };
    }

    const sign = signAt(profile, geometry, peak.u);
    const isAtEdge =
      side === 'left' ? sign.x - cropLeft < step : cropRight - sign.x < step;
    const sigmas = peak.value / sigma;
    const isPassing =
      !isAtEdge &&
      sign.coreRed > sign.coreGreen &&
      sign.deltaGreen - sign.deltaRed >= MIN_GREEN_EXCESS &&
      sigmas >= MIN_REDNESS_SIGMAS;

    return {
      peak: { ...sign, excess: peak.value, sigmas, isAtEdge, isPassing },
      deepest: deep && { ...signAt(profile, geometry, deep.u), depth: deep.value },
    };
  };

  return { left: toBandSide('left'), right: toBandSide('right') };
};

/**
 * Цвет столбца одной строкой.
 */
const formatSign = (sign: ColumnSign): string => {
  const { u, x, coreRed, coreGreen, deltaRed, deltaGreen } = sign;
  const relation = coreRed > coreGreen ? 'R > G' : 'R < G';

  return (
    `u ${u.toFixed(1)} (x ${x.toFixed(1)}): R ${coreRed.toFixed(1)}, G ${coreGreen.toFixed(1)}, ` +
    `${relation}; ΔR ${deltaRed.toFixed(1)} против ΔG ${deltaGreen.toFixed(1)}`
  );
};

/**
 * Пометка пика: прошёл правило или чем не прошёл.
 */
const formatVerdict = (peak: RednessPeak): string => {
  if (peak.isPassing) {
    return 'черта';
  }

  if (peak.isAtEdge) {
    return 'нет — край вырезки';
  }

  return 'нет';
};

/**
 * Самое внутреннее положение черты по прошедшим пикам: у левой стороны
 * наибольшее `u`, у правой наименьшее — ближе к тексту линия не заходит ни в
 * одной полосе.
 */
const findInnermost = (side: Side, peaks: RednessPeak[]): RednessPeak | null => {
  return peaks.reduce<RednessPeak | null>((acc, peak) => {
    if (!acc) {
      return peak;
    }

    switch (side) {
      case 'left': {
        return peak.u > acc.u ? peak : acc;
      }

      case 'right': {
        return peak.u < acc.u ? peak : acc;
      }

      default: {
        throw new Error(`Неизвестная сторона: ${String(side)}`);
      }
    }
  }, null);
};

/**
 * Размечает фотографию и печатает по полосе на строку. Печать идёт в stderr,
 * как у `measure:sheet`.
 */
const main = async (): Promise<void> => {
  const { path, kind, probes } = parseArguments();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const photo = await decodeSheetPhotoChannels(page, path);
    const measurement = measureSheetPhoto(photo, { kind });
    const ruling = buildSheetRuling(measurement.source, photo);
    const { width, height } = photo;
    const { step, skewAngle, margins, marginLineX, marginLineSide } = ruling;
    const bounds = resolveSheetBounds(ruling.outline, width, height);
    const cropLeft = Math.min(width, Math.max(0, Math.ceil(bounds.left)));
    const cropTop = Math.min(height, Math.max(0, Math.ceil(bounds.top)));
    const cropRight = Math.max(
      cropLeft,
      Math.min(width, Math.floor(width - bounds.right))
    );
    const cropBottom = Math.max(
      cropTop,
      Math.min(height, Math.floor(height - bounds.bottom))
    );
    const tangent = Math.tan((skewAngle * Math.PI) / 180);
    const shift = Math.ceil(Math.abs(tangent) * height) + 1;
    const geometry: ProfileGeometry = {
      cropLeft,
      cropRight,
      cropTop,
      tangent,
      shift,
      size: width + 2 * shift,
      step,
    };
    /**
     * Верх области с линиями — линия первой строки, а не верхнее поле: поле
     * лежит на линии над ней, а у линейки этой линии на листе может не быть.
     */
    const ruledTop = Math.max(
      cropTop,
      Math.round(lineHeightAt(ruling, 0, resolveFirstLine(ruling)))
    );
    const ruledBottom = Math.min(cropBottom, Math.round(height - margins.bottom));
    const bandStride =
      (ruledBottom - ruledTop - BAND_HEIGHT) / Math.max(1, BAND_COUNT - 1);
    const bands = Array.from({ length: BAND_COUNT }, (_unused, index) => {
      const yFrom = Math.round(ruledTop + index * bandStride);

      return {
        label: BAND_LABELS[index] || `полоса ${index + 1}`,
        yFrom,
        yTo: yFrom + BAND_HEIGHT,
      };
    });
    const profiles = bands.map((band) => {
      return measureBand(photo, geometry, band);
    });
    const analyses = profiles.map((profile) => {
      return analyseBand(profile, geometry);
    });
    const detected =
      marginLineX === null
        ? 'нет'
        : `${marginLineX.toFixed(1)} px ${marginLineSide || ''}`;

    console.error(`${path}: ${width}×${height} px, вид ${kind}`);
    console.error(
      `  шаг ${step.toFixed(2)} px, угол ${skewAngle.toFixed(2)}°, вырезка x ${cropLeft}…${cropRight}, ` +
        `y ${cropTop}…${cropBottom}, область с линиями y ${ruledTop}…${ruledBottom}`
    );
    console.error(`  линия поля детектора: ${detected}`);
    console.error(
      '  u = x + (y − верх вырезки)·tgθ, x — в средней строке полосы, Δ — бумага минус столбец'
    );

    for (const [index, profile] of profiles.entries()) {
      const analysis = analyses[index];

      console.error(`  полоса ${profile.label}, y ${profile.yFrom}…${profile.yTo}:`);

      for (const side of SIDES) {
        const { peak, deepest } = analysis?.[side] || { peak: null, deepest: null };
        const peakLine = peak
          ? `${formatSign(peak)}, краснота ${peak.excess.toFixed(1)} (${peak.sigmas.toFixed(1)}σ) — ${formatVerdict(peak)}`
          : '—';
        const deepestLine = deepest
          ? `${formatSign(deepest)}, глубина ${deepest.depth.toFixed(3)}`
          : '—';

        console.error(`    ${SIDE_LABELS[side]}, пик красноты: ${peakLine}`);
        console.error(`    ${SIDE_LABELS[side]}, провал яркости: ${deepestLine}`);
      }

      for (const u of probes) {
        console.error(`    проба ${formatSign(signAt(profile, geometry, u))}`);
      }
    }

    for (const side of SIDES) {
      const passing = analyses.reduce<RednessPeak[]>((acc, analysis) => {
        const { peak } = analysis[side];

        if (peak?.isPassing) {
          acc.push(peak);
        }

        return acc;
      }, []);
      const innermost = findInnermost(side, passing);
      const verdict =
        passing.length >= MIN_PASSING_BANDS && innermost
          ? `черта ${side}, самое внутреннее u ${innermost.u.toFixed(1)} (x ${innermost.x.toFixed(1)})`
          : 'черты нет';

      console.error(
        `  итог ${SIDE_LABELS[side]}: ${verdict}, прошли ${passing.length} из ${BAND_COUNT} полос`
      );
    }
  } finally {
    await browser.close();
  }
};

await main();
