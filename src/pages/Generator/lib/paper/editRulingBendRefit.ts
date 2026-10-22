import { cropSheetColumns } from './cropSheetColumns';
import { detectRulingBend, type RulingBendDetection } from './detectRulingBend';
import { resolveBendRegion } from './editRulingBend';
import { rectifySheetImage } from './measureSheetPhotoRectify';
import type { RulingProjection, SheetImageData, SheetRuling } from './paper.types';
import { lineCoordinateAt, lineHeightAt } from './rulingPerspective';
import { resolveFirstLine } from './sheetRuling';
import { toFrameBend } from './toFrameBend';

const DEGREES_IN_RADIAN = 180 / Math.PI;

const EMPTY_DETECTION: RulingBendDetection = { bend: null, foundNodeShare: 0 };

/**
 * «Подогнать изгиб по фото»: заново прослеживает изгиб линий по снимку
 * относительно текущей гребёнки листа — её шага, фазы, наклона, перспективы и
 * полей — в области между боковыми полями и линией поля.
 *
 * Без перспективы это поиск изгиба по кадру как есть. С перспективой поиск
 * идёт по копии области, выпрямленной перспективой, — тем же путём, что у
 * импорта: у прямой гребёнки по кадру линии листа на столе расходятся с
 * гребёнкой к краям, и трасса изгиба либо теряет их, либо меряет схождение
 * вместо волны.
 *
 * @param image — полутоновая выжимка фотографии в пикселях кадра
 * @param ruling — текущая разлиновка листа
 * @returns изгиб в пикселях кадра и доля найденных узлов; изгиб `null`, если
 *   проследить его надёжно не удалось
 */
export const refitRulingBend = (
  image: SheetImageData,
  ruling: SheetRuling
): RulingBendDetection => {
  const { step, firstLinePhase, skewAngle, margins, perspective } = ruling;
  const region = resolveBendRegion(ruling, image.width);

  /**
   * Верх области с линиями — линия первой строки, а не верхнее поле: поле
   * лежит на линии над ней, а у линейки этой линии на листе может не быть, и
   * её пустая строка узлов уронила бы долю найденных.
   */
  const firstLine = resolveFirstLine(ruling);

  if (!perspective) {
    return detectRulingBend(
      image,
      { ...ruling, margins: { ...margins, top: lineHeightAt(ruling, 0, firstLine) } },
      region
    );
  }

  const cropLeft = Math.max(0, Math.floor(region.left));
  const cropWidth = Math.min(image.width, Math.ceil(region.right)) - cropLeft;

  if (step <= 0 || cropWidth < 1) {
    return EMPTY_DETECTION;
  }

  const projection: RulingProjection = {
    skewAngle,
    perspective: { ...perspective, originX: perspective.originX - cropLeft },
  };
  const rectified = rectifySheetImage(
    cropSheetColumns(image, cropLeft, cropWidth),
    projection
  );

  if (rectified.image.height < 2) {
    return EMPTY_DETECTION;
  }

  /**
   * Прямая координата копии `r − x·tgθ` — это координата вдоль линий кадра,
   * сдвинутая на столбец вырезки и на верх копии.
   */
  const shift = cropLeft * Math.tan(skewAngle / DEGREES_IN_RADIAN) - rectified.top;
  const topLine = firstLine + shift;
  const bottomLine = lineCoordinateAt(ruling, 0, image.height - margins.bottom) + shift;
  const detection = detectRulingBend(
    rectified.image,
    {
      step,
      firstLinePhase: firstLinePhase + shift,
      skewAngle,
      margins: {
        top: topLine,
        right: 0,
        bottom: rectified.image.height - bottomLine,
        left: 0,
      },
    },
    { left: region.left - cropLeft, right: region.right - cropLeft }
  );

  return detection.bend
    ? { ...detection, bend: toFrameBend(detection.bend, ruling, cropLeft, -shift) }
    : detection;
};
