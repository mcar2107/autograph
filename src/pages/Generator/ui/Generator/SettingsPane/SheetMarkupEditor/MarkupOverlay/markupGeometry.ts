import { resolveTextEdgesAt } from '../../../../../lib/calibrate';
import type {
  SheetFrame,
  SheetOutline,
  SheetPoint,
  SheetRuling,
  SideEdgeEnds,
} from '../../../../../lib/paper';
import {
  lineCoordinateAt,
  lineHeightAt,
  readMarginEnds,
  readMarginLineEnds,
  sampleRulingBend,
  sideEdgePointAt,
} from '../../../../../lib/paper';

import type {
  LineAttributes,
  MarginGuides,
  MarkupBox,
  RulingLinePath,
} from './markupGeometry.types';

/**
 * Больше линий оверлей не рисует: шаг в доли пикселя — это не разлиновка, а
 * ошибка разметки, и десятки тысяч ломаных только заморозили бы редактор.
 */
const MAX_LINE_COUNT = 1000;

/**
 * Сколько точек ломаной приходится на промежуток между узлами изгиба. Между
 * узлами линия — кубический сплайн, и хорда из восьмой доли промежутка
 * отходит от него на сотые пикселя даже на волне в полшага.
 */
const BEND_SAMPLES_PER_COLUMN = 8;

/**
 * Границы шага точек ломаной изогнутой линии, px фотографии: чаще двух
 * пикселей точек не нужно, реже шестнадцати — хорда уже заметна.
 */
const MIN_SAMPLE_SPACING = 2;
const MAX_SAMPLE_SPACING = 16;

/**
 * Запас линий за крайними по координате вдоль линий: изгиб уводит линию до
 * полушага, и линия у края контура иначе обрывалась бы раньше него.
 */
const LINE_RESERVE = 1;

/**
 * Сколько точек на край зоны письма у листа без шага: линий нет, и края
 * меряются по ровной сетке высот.
 */
const BLANK_ZONE_SAMPLES = 32;

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Точность записи координат в атрибут ломаной: сотая пикселя фотографии
 * заведомо мельче допуска в пиксель.
 */
const POINT_DIGITS = 2;

/**
 * Многоугольник листа на фотографии: четыре угла контура по обходу, у листа
 * во весь кадр — углы кадра.
 *
 * @param outline — контур листа; `null` — лист во весь кадр
 * @param frame — кадр фотографии
 * @returns углы по часовой стрелке от левого верхнего
 */
export const toOutlinePolygon = (
  outline: SheetOutline | null,
  frame: SheetFrame
): SheetPoint[] => {
  if (!outline) {
    return [
      { x: 0, y: 0 },
      { x: frame.width, y: 0 },
      { x: frame.width, y: frame.height },
      { x: 0, y: frame.height },
    ];
  }

  const { topLeft, topRight, bottomRight, bottomLeft } = outline;

  return [topLeft, topRight, bottomRight, bottomLeft];
};

/**
 * Прямоугольник, описанный вокруг контура и не выходящий за кадр: по нему
 * тянутся линии, а обрезает их сам контур.
 *
 * @param outline — контур листа; `null` — лист во весь кадр
 * @param frame — кадр фотографии
 * @returns описанный прямоугольник
 */
export const toOutlineBox = (
  outline: SheetOutline | null,
  frame: SheetFrame
): MarkupBox => {
  const polygon = toOutlinePolygon(outline, frame);
  const xs = polygon.map(({ x }) => {
    return x;
  });
  const ys = polygon.map(({ y }) => {
    return y;
  });

  return {
    left: Math.max(0, Math.min(...xs)),
    top: Math.max(0, Math.min(...ys)),
    right: Math.min(frame.width, Math.max(...xs)),
    bottom: Math.min(frame.height, Math.max(...ys)),
  };
};

/**
 * Столбцы, в которых ставятся точки линии. Прямая линия — и ровного листа, и
 * листа с перспективой: у перспективы линия с постоянной координатой вдоль
 * линий остаётся прямой, — обходится двумя концами. Изогнутой нужны точки
 * чаще узлов изгиба.
 *
 * @param ruling — разлиновка страницы
 * @param box — описанный вокруг контура прямоугольник
 * @returns столбцы слева направо
 */
const buildColumns = (ruling: SheetRuling, box: MarkupBox): number[] => {
  const { left, right } = box;
  const { bend } = ruling;

  if (!bend) {
    return [left, right];
  }

  const spacing = Math.min(
    MAX_SAMPLE_SPACING,
    Math.max(MIN_SAMPLE_SPACING, bend.columnSpacing / BEND_SAMPLES_PER_COLUMN)
  );
  const count = Math.max(1, Math.ceil((right - left) / spacing));

  return Array.from({ length: count + 1 }, (_value, index) => {
    return left + ((right - left) * index) / count;
  });
};

/**
 * Линии разлиновки страницы внутри контура листа в пикселях фотографии.
 *
 * Каждая точка ставится ровно тем выражением, каким отрисовка сажает
 * базовую линию строки на линию листа: высота линии в столбце по наклону и
 * перспективе плюс смещение изгиба, прочитанное в самой линии. Своей формулы
 * у оверлея нет, поэтому линия в редакторе и строка на странице не
 * расходятся ни на листе на столе, ни на волне бумаги.
 *
 * Разлиновка — страницы, а не листа: у правой половины разворота она
 * отражена, и рисовать надо её.
 *
 * @param ruling — разлиновка страницы
 * @param frame — кадр фотографии
 * @returns линии сверху вниз; пусто — шага нет или он выродился
 */
export const buildRulingLines = (
  ruling: SheetRuling,
  frame: SheetFrame
): RulingLinePath[] => {
  const { step, firstLinePhase, bend } = ruling;

  if (!(step > 0)) {
    return [];
  }

  const box = toOutlineBox(ruling.outline, frame);
  const corners = [
    lineCoordinateAt(ruling, box.left, box.top),
    lineCoordinateAt(ruling, box.right, box.top),
    lineCoordinateAt(ruling, box.right, box.bottom),
    lineCoordinateAt(ruling, box.left, box.bottom),
  ];
  const first = Math.ceil((Math.min(...corners) - firstLinePhase) / step) - LINE_RESERVE;
  const last = Math.floor((Math.max(...corners) - firstLinePhase) / step) + LINE_RESERVE;

  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last - first > MAX_LINE_COUNT
  ) {
    return [];
  }

  const columns = buildColumns(ruling, box);

  return Array.from({ length: Math.max(0, last - first + 1) }, (_value, offset) => {
    const index = first + offset;
    const u = firstLinePhase + index * step;

    return {
      index,
      points: columns.map((x) => {
        const y = lineHeightAt(ruling, x, u);

        return { x, y: bend ? y + sampleRulingBend(bend, ruling, x, y) : y };
      }),
    };
  });
};

/**
 * Боковая граница блока — прямая через оба её конца, продлённая на высоту
 * кадра вверх и вниз: обрезает её контур листа. Точки — те же, по которым
 * раскладка ставит начало и конец строк, поэтому граница в редакторе и край
 * текста на странице не расходятся ни на наклонном листе, ни на листе со
 * столом.
 *
 * @param ruling — разлиновка страницы
 * @param frame — кадр фотографии
 * @param ends — концы границы
 * @returns концы отрезка, px фотографии
 */
const toSideGuide = (
  ruling: SheetRuling,
  frame: SheetFrame,
  ends: SideEdgeEnds
): SheetPoint[] => {
  const { height } = frame;

  return [-height, 2 * height].map((v) => {
    return sideEdgePointAt(ruling.skewAngle, ends, height, v);
  });
};

/**
 * Верхняя и нижняя границы области письма — линии гребёнки с координатой
 * поля. Поле задано высотой у левого края кадра, и так же его читает
 * автокалибровка (`lib/calibrate/deriveGeometry.ts`): горизонталь кадра на
 * наклонном листе разошлась бы с первой строкой на `x·tgθ`, а на листе с
 * перспективой — ещё и на схождение. Изгиб не учитывается: раскладка его не
 * читает.
 *
 * С перспективой линия с постоянной координатой остаётся прямой, поэтому
 * двух концов у краёв листа хватает.
 *
 * Боковые поля и линия поля — прямые через оба конца (`toSideGuide`).
 *
 * @param ruling — разлиновка страницы
 * @param frame — кадр фотографии
 * @returns границы полей в пикселях фотографии
 */
export const buildMarginGuides = (
  ruling: SheetRuling,
  frame: SheetFrame
): MarginGuides => {
  const { margins } = ruling;
  const box = toOutlineBox(ruling.outline, frame);

  /**
   * Линия гребёнки через высоту поля у левого края кадра.
   *
   * @param y — высота поля у левого края кадра
   * @returns концы у краёв листа
   */
  const toGuide = (y: number): SheetPoint[] => {
    const u = lineCoordinateAt(ruling, 0, y);

    return [box.left, box.right].map((x) => {
      return { x, y: lineHeightAt(ruling, x, u) };
    });
  };

  const lineEnds = readMarginLineEnds(ruling);

  return {
    top: toGuide(margins.top),
    bottom: toGuide(frame.height - margins.bottom),
    left: toSideGuide(ruling, frame, readMarginEnds(ruling, frame, 'left')),
    right: toSideGuide(ruling, frame, readMarginEnds(ruling, frame, 'right')),
    marginLine: lineEnds && toSideGuide(ruling, frame, lineEnds),
  };
};

/**
 * Точки в атрибут `points` ломаной или многоугольника SVG.
 *
 * @param points — точки в пикселях фотографии
 * @returns строка координат
 */
export const toPointsAttribute = (points: SheetPoint[]): string => {
  return points
    .map(({ x, y }) => {
      return `${x.toFixed(POINT_DIGITS)},${y.toFixed(POINT_DIGITS)}`;
    })
    .join(' ');
};

/**
 * Концы отрезка в атрибуты линии SVG.
 *
 * @param points — концы отрезка в пикселях фотографии
 * @returns атрибуты `x1`, `y1`, `x2`, `y2`
 */
export const toLineAttributes = (points: SheetPoint[]): LineAttributes => {
  const start = points[0] || { x: 0, y: 0 };
  const end = points.at(-1) || start;

  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
};

/**
 * Высоты, на которых меряются края зоны письма: верхняя и нижняя границы и
 * каждая линия разлиновки между ними. Строки встают только на линии, поэтому
 * край зоны на линии — ровно край строки на ней, а излом края там, где линия
 * поля выходит из поля, ломаная между линиями повторяет с точностью до
 * высоты строки. Без шага линий нет — сетка высот ровная.
 *
 * @param ruling — разлиновка страницы
 * @param top — координата верхней границы вдоль линий
 * @param bottom — координата нижней границы вдоль линий
 * @returns координаты вдоль линий сверху вниз
 */
const buildZoneCoordinates = (
  ruling: SheetRuling,
  top: number,
  bottom: number
): number[] => {
  const { step, firstLinePhase } = ruling;

  if (!(step > 0) || (bottom - top) / step > MAX_LINE_COUNT) {
    return Array.from({ length: BLANK_ZONE_SAMPLES + 1 }, (_value, index) => {
      return top + ((bottom - top) * index) / BLANK_ZONE_SAMPLES;
    });
  }

  const first = Math.floor((top - firstLinePhase) / step) + 1;
  const last = Math.ceil((bottom - firstLinePhase) / step) - 1;
  const lines = Array.from(
    { length: Math.max(0, last - first + 1) },
    (_value, offset) => {
      return firstLinePhase + (first + offset) * step;
    }
  );

  return [top, ...lines, bottom];
};

/**
 * Зона письма — где на странице встанут строки: между верхней и нижней
 * направляющими полей, а вдоль строки — между краями, которые берёт
 * раскладка (`resolveTextEdgesAt` из `lib/calibrate`): поля листа, сужённые
 * линией поля с зазором. Прямоугольник полей шире её, когда линия поля
 * лежит внутри области полей, и текст туда не пойдёт.
 *
 * Край строки ставится на фотографию так же, как отрисовка ставит начало
 * строки: точка блока на базовой линии поворачивается на наклон листа, а
 * перспектива сдвигает её только по высоте — на линию в этом столбце. Изгиб
 * не учитывается: раскладка его не читает.
 *
 * @param ruling — разлиновка страницы
 * @param frame — кадр фотографии
 * @returns многоугольник: левый край сверху вниз, затем правый снизу вверх
 */
export const buildWritingZone = (
  ruling: SheetRuling,
  frame: SheetFrame
): SheetPoint[] => {
  const { margins, skewAngle } = ruling;
  const { height } = frame;
  const radians = skewAngle / DEGREES_IN_RADIAN;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const sheet = { ruling, width: frame.width, height };
  const coordinates = buildZoneCoordinates(
    ruling,
    lineCoordinateAt(ruling, 0, margins.top),
    lineCoordinateAt(ruling, 0, height - margins.bottom)
  );

  /**
   * Точка края строки на фотографии.
   *
   * @param blockX — положение вдоль строки в системе блока
   * @param u — координата линии вдоль линий
   * @returns точка, px фотографии
   */
  const toPhotoPoint = (blockX: number, u: number): SheetPoint => {
    const x = blockX * cos - u * cos * sin;

    return { x, y: lineHeightAt(ruling, x, u) };
  };

  const { lefts, rights } = coordinates.reduce<Record<'lefts' | 'rights', SheetPoint[]>>(
    (edges, u) => {
      const { left, right } = resolveTextEdgesAt(sheet, u);

      edges.lefts.push(toPhotoPoint(left, u));
      edges.rights.push(toPhotoPoint(Math.max(left, right), u));

      return edges;
    },
    { lefts: [], rights: [] }
  );

  return [...lefts, ...rights.toReversed()];
};
