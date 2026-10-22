import {
  type DetectedRuling,
  detectRuling,
  type MarginLineReport,
  NO_MARGIN_LINE_REPORT,
  RULED_SPAN_LEVEL,
  type RuledEdges,
} from './detectRuling';
import { detectRulingPerspective } from './detectRulingPerspective';
import type { RulingPerspectiveDetection } from './detectRulingPerspective.types';
import { detectSheetOutline } from './detectSheetOutline';
import { extractLighting } from './extractLighting';
import { extractTexture } from './extractTexture';
import { measureRedGreenP99 } from './marginLineRedness';
import type {
  SheetPhotoBandedReport,
  SheetPhotoMarginLineProfileReport,
  SheetPhotoMeasurement,
  SheetPhotoOptions,
  SheetPhotoPerspectiveReport,
} from './measureSheetPhoto.types';
import { rectifySheetImage } from './measureSheetPhotoRectify';
import type {
  PaperMargins,
  RulingProjection,
  SheetFrame,
  SheetImageData,
  SheetOutline,
  SheetPoint,
  SheetRulingSource,
} from './paper.types';
import { resolveSheetBounds } from './resolveSheetBounds';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { toTangent } from './sheetProfile';
import { liftDetectedTopMargin } from './sheetRuling';
import { toFrameBend } from './toFrameBend';
import { TRACE_SEARCH_SHARE } from './traceRulingLines';

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Вырезка внутри листа и её место в кадре.
 */
type SheetCrop = {
  /**
   * Полутоновая выжимка вырезки.
   */
  image: SheetImageData;

  /**
   * Отступ вырезки от левого края кадра, px.
   */
  left: number;

  /**
   * Отступ вырезки от верхнего края кадра, px.
   */
  top: number;
};

/**
 * Как результат детектора разлиновки ложится в кадр.
 */
type FrameTransfer = {
  /**
   * Сдвиг по горизонтали из пикселей анализа в пиксели кадра.
   */
  left: number;

  /**
   * Сдвиг координаты вдоль линий из анализа в кадр.
   */
  lineShift: number;

  /**
   * Ширина кадра, px.
   */
  frameWidth: number;

  /**
   * Наклон и перспектива в пикселях кадра.
   */
  projection: RulingProjection;

  /**
   * Верхнее поле кадра по координате вдоль линий анализа.
   *
   * @param top — найденное верхнее поле анализа
   * @returns верхнее поле кадра
   */
  toTop: (top: number) => number;

  /**
   * Нижнее поле кадра по нижнему полю анализа.
   *
   * @param bottom — найденное нижнее поле анализа
   * @returns нижнее поле кадра
   */
  toBottom: (bottom: number) => number;
};

/**
 * Верх и высота выпрямленной копии.
 */
type RectifiedSpan = {
  /**
   * Координата вдоль линий вырезки у верхней строки копии.
   */
  top: number;

  /**
   * Высота копии, px.
   */
  height: number;
};

/**
 * Разлиновка кадра вместе с проходом, который её дал.
 */
type RulingMeasurement = {
  /**
   * Разлиновка в пикселях кадра.
   */
  source: SheetRulingSource;

  /**
   * Итоговый проход детектора: второй, если он состоялся, иначе ровный.
   */
  detection: DetectedRuling;

  /**
   * Отчёт перспективы; `null` — разлиновка не найдена.
   */
  report: SheetPhotoPerspectiveReport | null;

  /**
   * Числа полосовой ступени прохода по кадру; `null` — полосы не считались.
   */
  banded: SheetPhotoBandedReport | null;

  /**
   * Отчёт поиска линии поля того прохода, который за ней ходил.
   */
  marginLine: MarginLineReport;

  /**
   * Вердикт первой ступени на обоих проходах и гейт серого снимка.
   */
  marginLineProfile: SheetPhotoMarginLineProfileReport;
};

/**
 * Край области с линиями, по высоте упирающийся в сторону листа.
 */
type RuledEdgeSide = keyof RuledEdges;

const MISSING_REPORT: SheetPhotoPerspectiveReport | null = null;

/**
 * Разлиновку не мерили: ни одна ступень не звалась, гейт не понадобился.
 */
const NO_MARGIN_LINE_PROFILE_REPORT: SheetPhotoMarginLineProfileReport = {
  flat: NO_MARGIN_LINE_REPORT.profileVeto,
  rectified: null,
  colourGate: null,
};

/**
 * Координата вдоль линий по модулю шага, в `[0, step)`.
 *
 * @param value — координата
 * @param step — шаг, больше нуля
 * @returns приведённая координата
 */
const wrapPhase = (value: number, step: number): number => {
  return ((value % step) + step) % step;
};

/**
 * Вырезает прямоугольник, вписанный в контур листа. Лист во весь кадр
 * отдаётся без копии: обрезанная фотография разбирается так же, как без
 * поиска контура, и не платит за лишний проход по пикселям.
 *
 * Разность красного и зелёного каналов вырезается тем же прямоугольником, что
 * и яркость: вето по цвету берёт красноту из того же столбца, где яркостная
 * мера нашла кандидата. Нет её в кадре — нет и в вырезке.
 *
 * @param image — полутоновая выжимка кадра
 * @param outline — контур листа
 * @returns вырезка и её отступы в кадре
 */
export const cropSheet = (
  image: SheetImageData,
  outline: SheetOutline | null
): SheetCrop => {
  const { width, height, luminance, redMinusGreen } = image;
  const bounds = resolveSheetBounds(outline, width, height);
  const left = Math.min(width, Math.max(0, Math.ceil(bounds.left)));
  const top = Math.min(height, Math.max(0, Math.ceil(bounds.top)));
  const right = Math.max(left, Math.min(width, Math.floor(width - bounds.right)));
  const bottom = Math.max(top, Math.min(height, Math.floor(height - bounds.bottom)));
  const cropWidth = right - left;
  const cropHeight = bottom - top;

  if (cropWidth === width && cropHeight === height) {
    return { image, left: 0, top: 0 };
  }

  const values = new Float32Array(cropWidth * cropHeight);
  const colour = redMinusGreen ? new Int16Array(cropWidth * cropHeight) : null;

  for (let row = 0; row < cropHeight; row += 1) {
    const from = (top + row) * width + left;

    values.set(luminance.subarray(from, from + cropWidth), row * cropWidth);

    if (redMinusGreen && colour) {
      colour.set(redMinusGreen.subarray(from, from + cropWidth), row * cropWidth);
    }
  }

  return {
    image: colour
      ? { width: cropWidth, height: cropHeight, luminance: values, redMinusGreen: colour }
      : { width: cropWidth, height: cropHeight, luminance: values },
    left,
    top,
  };
};

/**
 * Переводит поля, линию поля и изгиб из пикселей анализа в пиксели кадра.
 * Ненайденная сторона остаётся нулём: фолбэк от стороны листа посчитает сборка
 * разлиновки.
 *
 * Наклон берётся из перевода, а не из прохода: с ним посчитан сдвиг координаты
 * вдоль линий, которым сюда приходит фаза, и с ним же измерена перспектива.
 * Пару фазы и наклона держит сам детектор — заданный наклон он отдаёт наружу
 * тем же числом, которым мерил шаг и фазу.
 *
 * @param detection — результат детектора разлиновки
 * @param analysisWidth — ширина изображения, ушедшего в детектор
 * @param transfer — перевод в кадр
 * @returns разлиновка кадра без контура
 */
const toFrameSource = (
  detection: DetectedRuling,
  analysisWidth: number,
  transfer: FrameTransfer
): SheetRulingSource => {
  const { step, margins, marginLineX, marginLineSide, bend } = detection;
  const { left, lineShift, frameWidth, projection } = transfer;
  const frameMargins: PaperMargins = {
    top: margins.top ? transfer.toTop(margins.top) : 0,
    right: margins.right ? frameWidth - left - analysisWidth + margins.right : 0,
    bottom: margins.bottom ? transfer.toBottom(margins.bottom) : 0,
    left: margins.left ? left + margins.left : 0,
  };

  return {
    step,
    firstLinePhase: wrapPhase(detection.firstLinePhase + lineShift, step),
    skewAngle: projection.skewAngle,
    margins: frameMargins,
    marginLineX: marginLineX === null ? null : marginLineX + left,
    marginLineSide,
    bend:
      bend && toFrameBend(bend, transfer.projection, transfer.left, transfer.lineShift),
    perspective: projection.perspective,
  };
};

/**
 * Перевод ровного прохода по вырезке. Координата вдоль линий `y − x·tgθ`
 * вырезки отличается от кадровой на `T − L·tgθ`; поля по высоте — тоже
 * координаты вдоль линий у левого края, поэтому сдвигаются на то же число.
 *
 * @param crop — вырезка
 * @param frame — кадр
 * @param skewAngle — наклон разлиновки
 * @returns перевод в кадр
 */
const toFlatTransfer = (
  crop: SheetCrop,
  frame: SheetImageData,
  skewAngle: number
): FrameTransfer => {
  const lineShift = crop.top - crop.left * Math.tan(skewAngle / DEGREES_IN_RADIAN);
  const cropBottom = frame.height - crop.top - crop.image.height;

  return {
    left: crop.left,
    lineShift,
    frameWidth: frame.width,
    projection: { skewAngle, perspective: null },
    toTop: (top) => {
      return top + lineShift;
    },
    toBottom: (bottom) => {
      return cropBottom + bottom + crop.top - lineShift;
    },
  };
};

/**
 * Перевод второго прохода по выпрямленной копии. Строка копии — координата
 * вдоль линий вырезки от `top` копии, дальше — тот же сдвиг, что у ровного
 * прохода. Поля по высоте хранятся в пикселях фото у левого края кадра, и
 * координата вдоль линий переводится в высоту по перспективе.
 *
 * @param crop — вырезка
 * @param frame — кадр
 * @param detection — перспектива в пикселях вырезки
 * @param rectified — верх и высота выпрямленной копии
 * @returns перевод в кадр
 */
const toRectifiedTransfer = (
  crop: SheetCrop,
  frame: SheetImageData,
  detection: RulingPerspectiveDetection,
  rectified: RectifiedSpan
): FrameTransfer => {
  const { skewAngle, perspective } = detection;
  const lineShift =
    rectified.top + crop.top - crop.left * Math.tan(skewAngle / DEGREES_IN_RADIAN);
  const projection: RulingProjection = {
    skewAngle,
    perspective: perspective && {
      ...perspective,
      originX: perspective.originX + crop.left,
      originY: perspective.originY + crop.top,
    },
  };

  return {
    left: crop.left,
    lineShift,
    frameWidth: frame.width,
    projection,
    toTop: (top) => {
      return lineHeightAt(projection, 0, top + lineShift);
    },
    toBottom: (bottom) => {
      return (
        frame.height - lineHeightAt(projection, 0, rectified.height - bottom + lineShift)
      );
    },
  };
};

/**
 * Найдена ли сторона контура на снимке. Ненайденная сторона лежит точно на
 * краю кадра, поэтому сравнение строгое.
 *
 * @param outline — контур листа
 * @param side — верхняя или нижняя сторона
 * @param frame — кадр фотографии
 * @returns `true` — сторона листа видна на снимке
 */
const isOutlineSideFound = (
  outline: SheetOutline,
  side: RuledEdgeSide,
  frame: SheetImageData
): boolean => {
  const { topLeft, topRight, bottomRight, bottomLeft } = outline;

  switch (side) {
    case 'top': {
      return topLeft.y !== 0 || topRight.y !== 0;
    }

    case 'bottom': {
      return bottomLeft.y !== frame.height || bottomRight.y !== frame.height;
    }

    default: {
      throw new Error(`Неизвестная сторона контура: ${String(side)}`);
    }
  }
};

/**
 * Высота прямой через два угла контура в столбце кадра.
 *
 * @param from — левый угол стороны
 * @param to — правый угол стороны
 * @param x — столбец кадра
 * @returns высота стороны в столбце, px
 */
const toSideY = (from: SheetPoint, to: SheetPoint, x: number): number => {
  if (to.x === from.x) {
    return from.y;
  }

  return from.y + ((to.y - from.y) * (x - from.x)) / (to.x - from.x);
};

/**
 * Глубина самого тёмного провала профиля в окне у строки: насколько строка
 * темнее медианы окном в шаг вокруг неё.
 *
 * @param profile — средняя яркость по строкам
 * @param center — строка, у которой ищется провал, в индексах профиля
 * @param reach — полуширина окна поиска в строках
 * @param half — полуширина окна медианы в строках
 * @returns глубина провала; ноль — в окне нет ничего темнее фона
 */
const measureProfileDip = (
  profile: Float64Array,
  center: number,
  reach: number,
  half: number
): number => {
  let depth = 0;
  const from = Math.max(1, Math.round(center - reach));
  const to = Math.min(profile.length - 2, Math.round(center + reach));

  for (let index = from; index <= to; index += 1) {
    const window = Array.from(
      profile.subarray(Math.max(0, index - half), index + half + 1)
    ).sort((first, second) => {
      return first - second;
    });
    const median = window[Math.floor(window.length / 2)] || 0;

    depth = Math.max(depth, median - (profile[index] || 0));
  }

  return depth;
};

/**
 * Средняя яркость строк кадра вдоль наклонных линий в полосе столбцов.
 *
 * @param image — полутоновая выжимка кадра
 * @param left — левый столбец полосы
 * @param right — правый столбец полосы, не включая
 * @param rows — первая и последняя строка профиля в середине полосы
 * @param tangent — тангенс наклона разлиновки
 * @returns яркость по строкам от первой
 */
const buildRowProfile = (
  image: SheetImageData,
  left: number,
  right: number,
  rows: [number, number],
  tangent: number
): Float64Array => {
  const { width, height, luminance } = image;
  const [first, last] = rows;
  const column = (left + right) / 2;
  const profile = new Float64Array(Math.max(0, last - first + 1));

  profile.forEach((_value, index) => {
    let sum = 0;
    let count = 0;

    for (let x = Math.max(0, Math.ceil(left)); x < Math.min(width, right); x += 1) {
      const y = Math.round(first + index + (x - column) * tangent);

      if (y >= 0 && y < height) {
        sum += luminance[y * width + x] || 0;
        count += 1;
      }
    }

    profile[index] = count > 0 ? sum / count : 0;
  });

  return profile;
};

/**
 * Служит ли край вырезки полем: область с линиями упёрлась в край вырезки, а
 * вырезка — прямоугольник, вписанный в контур, и у наклонной стороны листа
 * между краем вырезки и стороной остаётся бумага. Там на шаг дальше крайней
 * линии и ищется следующая — по тем же вертикальным полосам, где крайняя
 * прослежена, в том же окне поиска и с тем же уровнем «линия есть», что у
 * границ области. В большинстве полос, где окно помещается на бумаге, провала
 * нет — крайняя линия и есть граница разлиновки, иначе линии идут до края
 * листа, и сторона уходит фолбэку.
 *
 * @param image — полутоновая выжимка кадра
 * @param crop — вырезка, по которой шёл ровный проход
 * @param outline — контур листа
 * @param detection — ровный проход
 * @param side — край области
 * @returns `true` — за крайней линией линий нет, её положение — поле
 */
const isRuledEdgeMargin = (
  image: SheetImageData,
  crop: SheetCrop,
  outline: SheetOutline | null,
  detection: DetectedRuling,
  side: RuledEdgeSide
): boolean => {
  const edge = detection.ruledEdges[side];

  if (!outline || !edge || !isOutlineSideFound(outline, side, image)) {
    return false;
  }

  const { step, skewAngle } = detection;
  const isTop = side === 'top';
  const direction = isTop ? -1 : 1;
  const [from, to] = isTop
    ? [outline.topLeft, outline.topRight]
    : [outline.bottomLeft, outline.bottomRight];
  const tangent = toTangent(skewAngle);
  const reach = step * TRACE_SEARCH_SHARE;
  const half = Math.max(1, Math.floor(step / 2));
  const stripWidth = crop.image.width / Math.max(1, edge.strips.length);
  let room = 0;
  let present = 0;

  edge.strips.forEach((position, strip) => {
    if (position === null) {
      return;
    }

    const left = crop.left + strip * stripWidth;
    const right = left + stripWidth;
    const lineY = crop.top + position + (left + right - 2 * crop.left) * tangent * 0.5;
    const beyondY = lineY + direction * step;
    const sheetY = isTop
      ? Math.max(toSideY(from, to, left), toSideY(from, to, right))
      : Math.min(toSideY(from, to, left), toSideY(from, to, right));

    if ((sheetY - beyondY) * direction < reach) {
      return;
    }

    const first = Math.max(0, Math.ceil(Math.min(sheetY, lineY - step)));
    const last = Math.min(image.height - 1, Math.floor(Math.max(sheetY, lineY + step)));
    const profile = buildRowProfile(image, left, right, [first, last], tangent);
    const lineDepth = measureProfileDip(profile, lineY - first, reach, half);
    const beyondDepth = measureProfileDip(profile, beyondY - first, reach, half);

    room += 1;
    present += beyondDepth >= lineDepth * RULED_SPAN_LEVEL ? 1 : 0;
  });

  return room > 0 && present * 2 < room;
};

/**
 * Ровный проход с полями у краёв вырезки, которые проверка по снимку признала
 * границей разлиновки (`isRuledEdgeMargin`).
 *
 * @param image — полутоновая выжимка кадра
 * @param crop — вырезка
 * @param outline — контур листа
 * @param detection — ровный проход по вырезке
 * @returns проход с уточнёнными верхним и нижним полями
 */
const withEdgeMargins = (
  image: SheetImageData,
  crop: SheetCrop,
  outline: SheetOutline | null,
  detection: DetectedRuling
): DetectedRuling => {
  const { margins, ruledEdges } = detection;
  const isTopMargin = isRuledEdgeMargin(image, crop, outline, detection, 'top');
  const isBottomMargin = isRuledEdgeMargin(image, crop, outline, detection, 'bottom');

  if (!isTopMargin && !isBottomMargin) {
    return detection;
  }

  return {
    ...detection,
    margins: {
      ...margins,
      top: isTopMargin && ruledEdges.top ? ruledEdges.top.position : margins.top,
      bottom:
        isBottomMargin && ruledEdges.bottom
          ? crop.image.height - ruledEdges.bottom.position
          : margins.bottom,
    },
  };
};

/**
 * Середина области с линиями по ширине кадра: там сходятся обе гребёнки листа,
 * потому что обе подогнаны по одним и тем же линиям, а их узлы лежат внутри
 * полей. Ненайденное поле оставляет край кадра, и середина съезжает к середине
 * кадра — ровно туда, где сидит масса узлов и в этом случае.
 *
 * @param margins — поля разлиновки в кадре
 * @param frameWidth — ширина кадра
 * @returns столбец середины области в пикселях кадра
 */
const toRuledMiddle = (margins: PaperMargins, frameWidth: number): number => {
  return (margins.left + (frameWidth - margins.right)) / 2;
};

/**
 * Верхнее и нижнее поле второго прохода, упёршегося в край выпрямленной копии,
 * берутся у ровного прохода: копия режется по вырезке, и за её краем второй
 * проход линий не видит, а ровный уже проверил край по снимку. Поле ставится
 * на ближайшую линию перспективной гребёнки: у ровного прохода линия стоит по
 * своей гребёнке, и строка встала бы мимо линий.
 *
 * Садится оно на линию в середине области с линиями, а не у левого края кадра,
 * куда поле отсчитано. Обе гребёнки описывают одни и те же линии и сходятся
 * там, где лежат их узлы, а к краю расходятся на разницу наклонов во всё
 * плечо: у листа с волной у верха это треть шага, и округление к ближайшей
 * линии у самого края берёт соседнюю — текст начинается со второй линии листа.
 * Поэтому поле переносится в середину области по гребёнке ровного прохода, там
 * садится на линию перспективной и возвращается к левому краю уже по ней.
 *
 * @param source — разлиновка второго прохода в кадре
 * @param flat — разлиновка ровного прохода в кадре
 * @param projection — наклон и перспектива второго прохода в кадре
 * @param frame — кадр фотографии
 * @returns разлиновка с унаследованными полями
 */
const inheritEdgeMargins = (
  source: SheetRulingSource,
  flat: SheetRulingSource,
  projection: RulingProjection,
  frame: SheetFrame
): SheetRulingSource => {
  const margins = source.margins || { top: 0, right: 0, bottom: 0, left: 0 };
  const flatTop = flat.margins?.top || 0;
  const flatBottom = flat.margins?.bottom || 0;
  const { step, firstLinePhase } = source;
  const flatProjection: RulingProjection = {
    skewAngle: flat.skewAngle,
    perspective: flat.perspective || null,
  };
  const middle = toRuledMiddle(margins, frame.width);

  const snapToLine = (y: number): number => {
    const height = lineHeightAt(
      flatProjection,
      middle,
      lineCoordinateAt(flatProjection, 0, y)
    );
    const line = Math.round(
      (lineCoordinateAt(projection, middle, height) - firstLinePhase) / step
    );

    return lineHeightAt(projection, 0, firstLinePhase + line * step);
  };

  return {
    ...source,
    margins: {
      ...margins,
      top: margins.top || (flatTop && snapToLine(flatTop)),
      bottom:
        margins.bottom ||
        (flatBottom && frame.height - snapToLine(frame.height - flatBottom)),
    },
  };
};

/**
 * Отчёт полосовой ступени: что она сделала, шаги полос и их дрейф. Признак
 * запуска идёт полем, а не пустотой шагов: у незапущенной ступени и у
 * отказавшей шаги одинаково пусты, а отчёт замера эти случаи различает.
 *
 * @param detection — проход детектора по кадру
 * @returns отчёт полос
 */
const toBandedReport = ({
  bandedStage,
  bandSteps,
}: DetectedRuling): SheetPhotoBandedReport => {
  const first = bandSteps[0];
  const last = bandSteps.at(-1);

  return {
    stage: bandedStage,
    steps: bandSteps,
    drift: first && last ? last / first - 1 : 0,
  };
};

/**
 * Отчёт линии поля того прохода, который за ней ходил.
 *
 * Проход по выпрямленной копии ищет линию только у стороны, найденной ровным
 * проходом: на снимке, где ровный проход кандидата отверг, стороны нет, и копия
 * за ним не идёт вовсе. Числа отказа лежат тогда только у ровного прохода — а
 * это и есть снимок, ради которого отчёт заведён: по нему калибруется барьер
 * фантома, и «полос не было» вместо отношения глубин оставило бы калибровку
 * слепой.
 *
 * Опросили оба — числа берутся у прохода, чья разлиновка ушла наружу: рядом с
 * его же `marginLineX` отношение ровного прохода говорило бы о другом замере.
 *
 * @param outer — проход, чья разлиновка ушла наружу
 * @param flat — ровный проход по кадру
 * @returns отчёт линии поля
 */
const toMarginLineReport = (
  outer: MarginLineReport,
  flat: MarginLineReport
): MarginLineReport => {
  const hasNothingToTell = outer.stage === 'none' && outer.threshold === null;

  return hasNothingToTell ? flat : outer;
};

/**
 * Вердикт первой ступени обоих проходов. Гейт у проходов общий — мера кадра
 * считается один раз, — поэтому берётся у того, которому он понадобился.
 *
 * @param flat — отчёт ровного прохода по кадру
 * @param rectified — отчёт прохода по выпрямленной копии; `null` — второго
 *   прохода не было
 * @returns вердикты обоих проходов и гейт
 */
const toMarginLineProfileReport = (
  flat: MarginLineReport,
  rectified: MarginLineReport | null
): SheetPhotoMarginLineProfileReport => {
  return {
    flat: flat.profileVeto,
    rectified: rectified && rectified.profileVeto,
    colourGate: flat.colourGate || (rectified && rectified.colourGate),
  };
};

/**
 * Разлиновка вырезки: ровный проход, перспектива и, если она есть, второй
 * проход по выпрямленной копии.
 *
 * Перспектива подгоняется по ядру разлиновки (`coreMargins`), а не по всей
 * области с линиями: крайние линии, удержанные трассой на волне листа, модель
 * перспективы не описывает, и их невязка отбраковала бы перспективу всего
 * листа.
 *
 * @param image — полутоновая выжимка кадра
 * @param crop — вырезка внутри листа
 * @param outline — контур листа
 * @returns разлиновка кадра, итоговый проход и отчёт перспективы
 */
const measureRuling = (
  image: SheetImageData,
  crop: SheetCrop,
  outline: SheetOutline | null
): RulingMeasurement => {
  /**
   * Гейт серого снимка — один на оба прохода и по всему кадру, до вырезки:
   * вырезка и копия теряют стол и обложку, и их мера цветности у бледной
   * бумаги ложится на самый порог. Мера считается один раз и только если
   * детектору понадобилась.
   */
  let frameRedGreenP99: number | null = null;
  let isFrameColourMeasured = false;

  const measureFrameRedGreenP99 = (): number | null => {
    if (!isFrameColourMeasured) {
      frameRedGreenP99 = measureRedGreenP99(image);
      isFrameColourMeasured = true;
    }

    return frameRedGreenP99;
  };

  const detected = detectRuling(crop.image, { measureFrameRedGreenP99 });
  const banded = toBandedReport(detected);

  if (!detected.isDetected || detected.step <= 0) {
    return {
      source: { step: 0, firstLinePhase: 0, skewAngle: detected.skewAngle },
      detection: detected,
      report: MISSING_REPORT,
      banded,
      marginLine: detected.marginLineReport,
      marginLineProfile: toMarginLineProfileReport(detected.marginLineReport, null),
    };
  }

  const flat = withEdgeMargins(image, crop, outline, detected);

  const flatSource = toFrameSource(
    flat,
    crop.image.width,
    toFlatTransfer(crop, image, flat.skewAngle)
  );
  const perspective = detectRulingPerspective(
    crop.image,
    { ...flat, margins: flat.coreMargins },
    {
      left: crop.left,
      top: crop.top,
      width: image.width,
      height: image.height,
    }
  );
  const report: SheetPhotoPerspectiveReport = {
    foundNodeShare: perspective.foundNodeShare,
    topStep: perspective.topStep,
    bottomStep: perspective.bottomStep,
    deviation: perspective.deviation,
    isRectifiedRulingMissing: false,
  };

  if (!perspective.perspective) {
    return {
      source: flatSource,
      detection: flat,
      report,
      banded,
      marginLine: flat.marginLineReport,
      marginLineProfile: toMarginLineProfileReport(flat.marginLineReport, null),
    };
  }

  /**
   * Копия выпрямляется уточнённым наклоном: он подогнан вместе со схождением,
   * и с наклоном ровного прохода линии копии встали бы мимо гребёнки.
   */
  const rectified = rectifySheetImage(crop.image, {
    skewAngle: perspective.skewAngle,
    perspective: perspective.perspective,
  });
  /**
   * Наклон задаётся детектору, и тем же числом он уходит наружу: свип полос
   * на копии ничего не переопределяет. Пара шага, фазы и наклона от этого не
   * рвётся, хотя фазу полосовая ступень и меряет своим свипом. Копия
   * выпрямлена только от схождения, скос в ней сохранён, и линии лежат прямой
   * гребёнкой под заданным наклоном — искать вдали от него свипу нечего: на
   * снимках, где ступень сработала на копии, её угол разошёлся с заданным на
   * 0,002…0,120°, то есть на 0,04…3,2 px фазы у края кадра (0,0005…0,053
   * шага).
   *
   * Строгий отказ от такого прохода не окупается: у `IMG_1705`, `IMG_1809`,
   * `IMG_1810` и `IMG_1811` он уводит медиану промаха базовых линий с
   * 0,005…0,040 шага на 0,135…0,215, а максимум — с 0,020…0,155 на 0,500,
   * тогда как граница приёмки — 0,05 по медиане и 0,25 по максимуму.
   */
  const second =
    rectified.image.height > 0
      ? detectRuling(rectified.image, {
          skewAngle: perspective.skewAngle,
          /**
           * Сторону задаёт ровный проход: второй волен уточнить `x` линии поля
           * или не подтвердить её, но искать её у другого края листа ему
           * нечем — выпрямление `x` вертикали не меняет.
           */
          marginLineSide: flat.marginLineSide,
          measureFrameRedGreenP99,
        })
      : null;

  if (!second || !second.isDetected || second.step <= 0) {
    return {
      source: flatSource,
      detection: flat,
      report: { ...report, isRectifiedRulingMissing: true },
      banded,
      marginLine: flat.marginLineReport,
      marginLineProfile: toMarginLineProfileReport(
        flat.marginLineReport,
        second && second.marginLineReport
      ),
    };
  }

  const transfer = toRectifiedTransfer(crop, image, perspective, {
    top: rectified.top,
    height: rectified.image.height,
  });

  return {
    source: inheritEdgeMargins(
      toFrameSource(second, rectified.image.width, transfer),
      flatSource,
      transfer.projection,
      image
    ),
    detection: second,
    report,
    banded,
    marginLine: toMarginLineReport(second.marginLineReport, flat.marginLineReport),
    marginLineProfile: toMarginLineProfileReport(
      flat.marginLineReport,
      second.marginLineReport
    ),
  };
};

/**
 * Измеряет фотографию листа одним путём для импорта, перемера и пресетов:
 * контур, разлиновку с перспективой и изгибом, поле освещения и карту текстуры.
 *
 * Разлиновка ищется только в прямоугольнике, вписанном в контур листа, и
 * переводится в пиксели кадра: поверхность вокруг листа не сбивает ни шаг, ни
 * поля. Неудача разлиновки не отбрасывает фотографию: контур, свет и текстура
 * остаются, а разлиновка приходит с нулевым шагом — лист уходит в ручной ввод.
 *
 * @param image — полутоновая выжимка фотографии
 * @param options — вид разлиновки семьи и ручной контур
 * @returns измерения в пикселях кадра
 */
export const measureSheetPhoto = (
  image: SheetImageData,
  options: SheetPhotoOptions
): SheetPhotoMeasurement => {
  const outline =
    options.outline === undefined ? detectSheetOutline(image) : options.outline;
  const lighting = extractLighting(image, { outline });
  const textureMap = extractTexture(image, lighting, { outline });
  const crop = cropSheet(image, outline);
  const shouldMeasureRuling =
    options.kind !== 'blank' && crop.image.width > 1 && crop.image.height > 1;

  if (!shouldMeasureRuling) {
    return {
      source: { step: 0, firstLinePhase: 0, skewAngle: 0, outline },
      outline,
      lighting,
      textureMap,
      diagnostics: {
        isRulingDetected: false,
        confidence: 0,
        kind: 'blank',
        bendFoundNodeShare: 0,
        perspective: MISSING_REPORT,
        banded: null,
        marginLine: NO_MARGIN_LINE_REPORT,
        marginLineProfile: NO_MARGIN_LINE_PROFILE_REPORT,
      },
    };
  }

  const { source, detection, report, banded, marginLine, marginLineProfile } =
    measureRuling(image, crop, outline);

  return {
    source: liftDetectedTopMargin({ ...source, outline }),
    outline,
    lighting,
    textureMap,
    diagnostics: {
      isRulingDetected: detection.isDetected,
      confidence: detection.confidence,
      kind: detection.kind,
      bendFoundNodeShare: detection.bendFoundNodeShare,
      perspective: report,
      banded,
      marginLine,
      marginLineProfile,
    },
  };
};
