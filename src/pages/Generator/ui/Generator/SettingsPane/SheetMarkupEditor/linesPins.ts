import type {
  RulingPin,
  RulingPinsFit,
  SheetFrame,
  SheetImageData,
  SheetPoint,
  SheetRuling,
} from '../../../../lib/paper';
import {
  bentLineHeightAt,
  editRulingBend,
  fitRulingPins,
  lineCoordinateAt,
  lineHeightScaleAt,
  refitRulingBend,
  snapToRulingLine,
} from '../../../../lib/paper';

import type { PinEnd } from './linesPins.types';

/**
 * Булавка с концами слева направо. Конец, перетащенный за другой, меняется с
 * ним ролью: подгонка считает левым конец с меньшим столбцом, а пользователь
 * тянет ту точку, которую видит, а не «левую».
 *
 * @param pin — булавка
 * @returns булавка с упорядоченными концами
 */
const orderPinEnds = (pin: RulingPin): RulingPin => {
  const { left, right } = pin;

  return right.x < left.x ? { ...pin, left: right, right: left } : pin;
};

/**
 * Булавки по номерам линий сверху вниз с упорядоченными концами. Сортировка
 * устойчивая: у пустой разлиновки номера равны, и порядок булавок — их
 * порядок сверху вниз.
 *
 * @param pins — булавки
 * @returns упорядоченные булавки
 */
export const normalizePins = (pins: RulingPin[]): RulingPin[] => {
  return pins.map(orderPinEnds).toSorted((first, second) => {
    return first.index - second.index;
  });
};

/**
 * Булавки со сдвинутым концом одной из них.
 *
 * @param pins — булавки
 * @param order — какая булавка
 * @param end — какой конец
 * @param point — куда сдвинут конец, px фотографии
 * @returns булавки
 */
export const movePinEnd = (
  pins: RulingPin[],
  order: number,
  end: PinEnd,
  point: SheetPoint
): RulingPin[] => {
  return pins.map((pin, index) => {
    return index === order ? { ...pin, [end]: point } : pin;
  });
};

/**
 * Число шагов между соседними булавками. `0` — у пустой разлиновки, пока
 * пользователь не задал его сам.
 *
 * @param pins — булавки по номерам
 * @returns числа шагов, по одному на промежуток
 */
export const readGapSteps = (pins: RulingPin[]): number[] => {
  return pins.slice(1).map((pin, index) => {
    return pin.index - (pins[index]?.index || 0);
  });
};

/**
 * Булавки с другим числом шагов в одном промежутке: номера всех булавок ниже
 * него сдвигаются, и промежутки под ним свои числа шагов сохраняют.
 *
 * @param pins — булавки по номерам
 * @param gap — промежуток, считая с нуля сверху
 * @param delta — на сколько шагов изменить
 * @returns булавки; `null` — шагов в промежутке стало бы меньше одного
 */
export const shiftGapSteps = (
  pins: RulingPin[],
  gap: number,
  delta: number
): RulingPin[] | null => {
  const steps = readGapSteps(pins)[gap];

  if (steps === undefined || steps + delta < 1) {
    return null;
  }

  return pins.map((pin, index) => {
    return index > gap ? { ...pin, index: pin.index + delta } : pin;
  });
};

/**
 * Точка линии разлиновки в столбце: высота линии с наклоном и перспективой
 * плюс изгиб — тем же выражением, каким на линию садятся строки.
 *
 * @param ruling — разлиновка
 * @param index — номер линии
 * @param x — столбец, px фотографии
 * @returns точка на линии
 */
const pointOnLine = (ruling: SheetRuling, index: number, x: number): SheetPoint => {
  const { bend, firstLinePhase, step } = ruling;

  return { x, y: bentLineHeightAt(ruling, bend, x, firstLinePhase + index * step) };
};

/**
 * Невязка булавки у разлиновки черновика: насколько линия с её номером, какой
 * она нарисована — с перспективой и изгибом, — отходит от концов булавки.
 * Меряется по нарисованной линии, а не по гребёнке подгонки: изгиб, заново
 * прослеженный по фотографии, уводит линию от булавки, поставленной мимо
 * линии снимка, и это пользователь видит на фотографии.
 *
 * @param ruling — разлиновка черновика
 * @param pin — булавка
 * @returns наибольшее расстояние по высоте от концов до линии, px;
 *   `undefined` — разлиновки нет
 */
export const measurePinMiss = (
  ruling: SheetRuling,
  pin: RulingPin
): number | undefined => {
  if (!(ruling.step > 0)) {
    return undefined;
  }

  return Math.max(
    ...[pin.left, pin.right].map(({ x, y }) => {
      return Math.abs(pointOnLine(ruling, pin.index, x).y - y);
    })
  );
};

/**
 * Ещё одна булавка — в середине самого широкого промежутка, на линии текущей
 * разлиновки: третья булавка в середине листа — то, что передаёт перспективу
 * по высоте.
 *
 * @param ruling — текущая разлиновка
 * @param pins — булавки по номерам
 * @returns булавки с новой; `null` — промежутка шире одного шага нет или
 *   разлиновки нет
 */
export const insertPin = (ruling: SheetRuling, pins: RulingPin[]): RulingPin[] | null => {
  const steps = readGapSteps(pins);
  const widest = steps.reduce((best, count, gap) => {
    return count > (steps[best] || 0) ? gap : best;
  }, 0);
  const above = pins[widest];
  const below = pins[widest + 1];
  const count = steps[widest] || 0;

  if (!(ruling.step > 0) || !above || !below || count < 2) {
    return null;
  }

  const index = above.index + Math.floor(count / 2);
  const pin = {
    index,
    left: pointOnLine(ruling, index, (above.left.x + below.left.x) / 2),
    right: pointOnLine(ruling, index, (above.right.x + below.right.x) / 2),
  };

  return [...pins.slice(0, widest + 1), pin, ...pins.slice(widest + 1)];
};

/**
 * Магнит: отпущенный конец встаёт на самую тёмную линию фотографии в своём
 * столбце в пределах трети шага. Шаг — местный, у точки: на листе со столом
 * он к дальнему краю короче, и окно по среднему шагу цепляло бы соседнюю
 * линию.
 *
 * @param image — каналы фотографии
 * @param ruling — разлиновка, от которой меряется шаг
 * @param point — отпущенный конец, px фотографии
 * @returns конец на линии; линии в окне нет или шага нет — там, где отпущен
 */
export const snapPinEnd = (
  image: SheetImageData,
  ruling: SheetRuling,
  point: SheetPoint
): SheetPoint => {
  const { x, y } = point;
  const step = ruling.step * lineHeightScaleAt(ruling, x, lineCoordinateAt(ruling, x, y));

  if (!(step > 0)) {
    return point;
  }

  return snapToRulingLine(image, point, step) || point;
};

/**
 * Невязка, ниже которой конец булавки изгибом не доводится: узлы изгиба
 * хранятся с точностью до сотой пикселя, точнее конец не встанет.
 */
const PIN_BEND_TOLERANCE = 0.01;

/**
 * Число проходов доводки изгиба. Правка у одного конца задевает соседние
 * булавки в пределах своего радиуса, и проходы по всем концам сводят невязку
 * к точности хранения узлов; на живых снимках хватает четырёх.
 */
const PIN_BEND_PASSES = 6;

/**
 * Доля размаха булавки в радиусе доводки вдоль линии: правка затухает к
 * середине булавки и противоположный конец не сдвигает.
 */
const PIN_BEND_RADIUS_X_SHARE = 1 / 4;

/**
 * Изгиб, доведённый до булавок: линия каждой булавки проходит через оба её
 * конца. Гребёнка через три булавки и больше подгоняется по наименьшим
 * квадратам и через концы сама не проходит, а изгиб, прослеженный по
 * фотографии, ведёт линию по снимку, а не по булавке, — между тем булавка и
 * есть то, что пользователь закрепил. Доводка местная: поперёк линий — в шаг,
 * вдоль — к середине булавки, и прослеженная волна вдали от булавок остаётся.
 *
 * @param ruling — разлиновка с гребёнкой через булавки
 * @param pins — булавки по номерам
 * @param frame — кадр фотографии: от него заводится сетка изгиба, если её нет
 * @returns разлиновка с изгибом; булавки уже на линиях — та же разлиновка
 */
const pinRulingBend = (
  ruling: SheetRuling,
  pins: RulingPin[],
  frame: SheetFrame
): SheetRuling => {
  const ends = pins.flatMap((pin) => {
    const radiusX = Math.abs(pin.right.x - pin.left.x) * PIN_BEND_RADIUS_X_SHARE;

    return [pin.left, pin.right].map((point) => {
      return { index: pin.index, point, radiusX };
    });
  });
  let pinned = ruling;

  for (let pass = 0; pass < PIN_BEND_PASSES; pass += 1) {
    const before = pinned;

    pinned = ends.reduce((current, { index, point, radiusX }) => {
      const drawn = pointOnLine(current, index, point.x);
      const delta = point.y - drawn.y;

      return Math.abs(delta) < PIN_BEND_TOLERANCE
        ? current
        : editRulingBend(current, drawn, delta, {
            radius: current.step,
            radiusX,
            isWholeColumn: false,
            frame,
          });
    }, pinned);

    if (pinned === before) {
      break;
    }
  }

  return pinned;
};

/**
 * «Подогнать изгиб по фото» при закреплённых линиях: изгиб, заново
 * прослеженный по фотографии относительно линий разлиновки и доведённый до
 * булавок. Прослеженный изгиб ведёт линию по снимку, а не по булавке, и без
 * доводки уводил бы закреплённые линии с их концов.
 *
 * @param image — каналы фотографии
 * @param ruling — разлиновка, относительно линий которой прослеживается изгиб
 * @param pins — булавки по номерам
 * @param frame — кадр фотографии
 * @returns разлиновка с изгибом через булавки; `null` — изгиб по фотографии
 *   проследить не удалось
 */
export const refitBendToPins = (
  image: SheetImageData,
  ruling: SheetRuling,
  pins: RulingPin[],
  frame: SheetFrame
): SheetRuling | null => {
  const { bend } = refitRulingBend(image, ruling);

  return bend ? pinRulingBend({ ...ruling, bend }, pins, frame) : null;
};

/**
 * Итог правки булавок: подогнанная через них гребёнка с изгибом, заново
 * прослеженным по фотографии относительно новых линий и доведённым до
 * булавок. Прежний изгиб к новой гребёнке не относится — при смене шага его
 * сдвиги легли бы на чужие линии.
 *
 * Без каналов фотографии или без прослеженного изгиба остаётся только
 * доводка до булавок: у двух булавок гребёнка через них проходит сама, и лист
 * остаётся ровным.
 *
 * @param ruling — разлиновка до правки
 * @param pins — булавки по номерам
 * @param frame — кадр фотографии
 * @param image — каналы фотографии; `null` — ещё не сняты
 * @returns подгонка; у годной — разлиновка уже с изгибом
 */
export const fitPinsWithBend = (
  ruling: SheetRuling,
  pins: RulingPin[],
  frame: SheetFrame,
  image: SheetImageData | null
): RulingPinsFit => {
  const fit = fitRulingPins(ruling, pins, frame);

  if (fit.status !== 'fitted') {
    return fit;
  }

  if (!image) {
    return { ...fit, ruling: pinRulingBend(fit.ruling, pins, frame) };
  }

  return {
    ...fit,
    ruling:
      refitBendToPins(image, fit.ruling, pins, frame) ||
      pinRulingBend({ ...fit.ruling, bend: null }, pins, frame),
  };
};
