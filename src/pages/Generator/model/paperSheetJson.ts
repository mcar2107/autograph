import { deriveRulingPins } from '../lib/paper/fitRulingPins';
import type {
  LightingField,
  MarginLineSide,
  PaperMargins,
  PaperSheet,
  PaperTexture,
  RulingBend,
  RulingKind,
  RulingMirrorOverride,
  RulingPerspective,
  RulingPin,
  RulingSideSlant,
  SheetFrame,
  SheetOutline,
  SheetPoint,
  SheetRuling,
} from '../lib/paper/paper.types';
import { lineCoordinateAt } from '../lib/paper/rulingPerspective';
import { buildSheetRuling } from '../lib/paper/sheetRuling';

import type { StoredSheetTexture, StoredUserSheet } from './userSheetsStorage.types';

const DEGREES_IN_HALF_TURN = 180;

/**
 * Разобранный JSON — не то же самое, что объект нужного типа: и артефакт
 * профилей, и локальное хранилище приходят извне сборки и могут отстать от
 * кода. Проверка формой, а не приведением типа: экземпляр, у которого не
 * хватает обязательного поля, отбрасывается целиком, а не роняет генератор
 * позже, в отрисовке.
 *
 * @param value — разобранное значение
 * @returns признак того, что значение — объект с полями
 */
export const isJsonRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Конечное число или запасное значение.
 *
 * @param value — разобранное значение
 * @param fallback — что подставить вместо мусора
 * @returns число
 */
export const toFiniteNumber = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/**
 * Непустая строка или пустая, если строки не было.
 *
 * @param value — разобранное значение
 * @returns строка; пустая означает «значения нет»
 */
export const toText = (value: unknown): string => {
  return typeof value === 'string' ? value : '';
};

/**
 * Поле освещения из JSON. `null` — поля нет или оно нечитаемо: отрисовка
 * возьмёт синтетический свет.
 *
 * @param value — разобранное значение
 * @returns поле освещения или `null`
 */
const parseLighting = (value: unknown): LightingField | null => {
  if (!isJsonRecord(value) || !Array.isArray(value.values)) {
    return null;
  }

  const items: unknown[] = value.values;

  return {
    gridWidth: toFiniteNumber(value.gridWidth, 0),
    gridHeight: toFiniteNumber(value.gridHeight, 0),
    values: items.reduce<number[]>((acc, item) => {
      acc.push(toFiniteNumber(item, 0));

      return acc;
    }, []),
    contrast: toFiniteNumber(value.contrast, 0),
    isUsable: value.isUsable === true,
  };
};

/**
 * Карта текстуры из JSON. `null` — карты нет или в ней нет картинки. Чем
 * задана картинка, разбору всё равно: и путь к файлу рядом с фотографией, и
 * data URL — просто непустая строка.
 *
 * @param value — разобранное значение
 * @returns карта текстуры или `null`
 */
const parseTexture = (value: unknown): PaperTexture | null => {
  if (!isJsonRecord(value)) {
    return null;
  }

  const src = toText(value.src);

  if (!src) {
    return null;
  }

  return {
    src,
    width: toFiniteNumber(value.width, 0),
    height: toFiniteNumber(value.height, 0),
    amplitude: toFiniteNumber(value.amplitude, 0),
  };
};

/**
 * Край линии поля из JSON.
 *
 * @param value — разобранное значение
 * @returns край; `null` — края нет или он нечитаем
 */
const parseMarginLineSide = (value: unknown): MarginLineSide | null => {
  return value === 'left' || value === 'right' ? value : null;
};

/**
 * Поля листа из JSON. Нечитаемое поле становится нулём: сборка разлиновки
 * считает такую сторону ненайденной и отступает с неё фолбэком.
 *
 * @param value — разобранное значение
 * @returns поля листа
 */
const parseMargins = (value: unknown): PaperMargins => {
  const margins: Record<string, unknown> = isJsonRecord(value) ? value : {};

  return {
    top: toFiniteNumber(margins.top, 0),
    right: toFiniteNumber(margins.right, 0),
    bottom: toFiniteNumber(margins.bottom, 0),
    left: toFiniteNumber(margins.left, 0),
  };
};

/**
 * Конечное число в JSON.
 *
 * @param value — разобранное значение
 * @returns признак конечного числа
 */
const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

/**
 * Интервал сетки: у узлов, стоящих в одной точке или в обратном порядке,
 * выборка делила бы на ноль или читала узлы задом наперёд.
 *
 * @param value — разобранное значение
 * @returns признак положительного конечного числа
 */
const isPositiveNumber = (value: unknown): value is number => {
  return isFiniteNumber(value) && value > 0;
};

/**
 * Размер сетки: дробное число узлов разошлось бы с плоским индексом смещений.
 *
 * @param value — разобранное значение
 * @returns признак целого положительного числа
 */
const isNodeCount = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
};

/**
 * Изгиб линий из JSON. Испорченная сетка — размеры, не согласованные с числом
 * смещений, неположительный интервал, нечисловое значение — читается как
 * отсутствие изгиба: такой лист ровный, а не сломанный, и остаётся в списке.
 * Частично годную сетку не чиним: смещения, прочитанные по неверным размерам,
 * встали бы не в те узлы.
 *
 * @param value — разобранное значение
 * @returns сетка изгиба; `null` — изгиба нет или он нечитаем
 */
const parseRulingBend = (value: unknown): RulingBend | null => {
  if (!isJsonRecord(value)) {
    return null;
  }

  const {
    columnOrigin,
    columnSpacing,
    columnCount,
    rowOrigin,
    rowSpacing,
    rowCount,
    offsets,
  } = value;

  if (
    !isFiniteNumber(columnOrigin) ||
    !isFiniteNumber(rowOrigin) ||
    !isPositiveNumber(columnSpacing) ||
    !isPositiveNumber(rowSpacing) ||
    !isNodeCount(columnCount) ||
    !isNodeCount(rowCount) ||
    !Array.isArray(offsets) ||
    offsets.length !== columnCount * rowCount
  ) {
    return null;
  }

  const items: unknown[] = offsets;

  if (
    !items.every((item): item is number => {
      return isFiniteNumber(item);
    })
  ) {
    return null;
  }

  return {
    columnOrigin,
    columnSpacing,
    columnCount,
    rowOrigin,
    rowSpacing,
    rowCount,
    offsets: items,
  };
};

/**
 * Угол контура из JSON.
 *
 * @param value — разобранное значение
 * @returns угол; `null` — у угла нет конечной координаты
 */
const parseSheetPoint = (value: unknown): SheetPoint | null => {
  if (!isJsonRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return null;
  }

  return { x: value.x, y: value.y };
};

/**
 * Контур листа из JSON. Контур с одним негодным углом не чиним и не дополняем
 * краем кадра: вырезка и фолбэк полей по такому контуру ушли бы мимо листа, а
 * лист во весь кадр рисуется так же, как до поиска контура.
 *
 * @param value — разобранное значение
 * @returns контур; `null` — лист во весь кадр
 */
const parseSheetOutline = (value: unknown): SheetOutline | null => {
  if (!isJsonRecord(value)) {
    return null;
  }

  const topLeft = parseSheetPoint(value.topLeft);
  const topRight = parseSheetPoint(value.topRight);
  const bottomRight = parseSheetPoint(value.bottomRight);
  const bottomLeft = parseSheetPoint(value.bottomLeft);

  if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
    return null;
  }

  return { topLeft, topRight, bottomRight, bottomLeft };
};

/**
 * Концы полей и линии поля у низа кадра из JSON. Нечитаемое боковое поле
 * снимает наклон целиком: поля ложатся без наклона к строкам, как у записи,
 * где концов у низа нет вовсе. Линия поля без конца у низа идёт без наклона.
 *
 * @param value — разобранное значение
 * @returns концы у низа кадра; `null` — наклона нет
 */
const parseSideSlant = (value: unknown): RulingSideSlant | null => {
  if (
    !isJsonRecord(value) ||
    !isPositiveNumber(value.left) ||
    !isPositiveNumber(value.right)
  ) {
    return null;
  }

  return {
    left: value.left,
    right: value.right,
    marginLineX: toFiniteNumber(value.marginLineX, 0) || null,
  };
};

/**
 * Отдельно заданные поля зеркальной страницы из JSON. Нечитаемое боковое поле
 * снимает всю замену, а не одно поле: половина замены с отражённой второй
 * половиной дала бы блок, которого пользователь не задавал.
 *
 * @param value — разобранное значение
 * @returns замена полей зеркала; `null` — зеркало берёт их отражением
 */
const parseMirrorOverride = (value: unknown): RulingMirrorOverride | null => {
  if (
    !isJsonRecord(value) ||
    !isPositiveNumber(value.marginLeft) ||
    !isPositiveNumber(value.marginRight)
  ) {
    return null;
  }

  const marginLineX = toFiniteNumber(value.marginLineX, 0) || null;
  const marginLineSide = parseMarginLineSide(value.marginLineSide);
  const hasMarginLine = marginLineX !== null && marginLineSide !== null;

  return {
    marginLineX: hasMarginLine ? marginLineX : null,
    marginLineSide: hasMarginLine ? marginLineSide : null,
    marginLeft: value.marginLeft,
    marginRight: value.marginRight,
    sideSlant: parseSideSlant(value.sideSlant),
  };
};

/**
 * Лежит ли перспектива по эту сторону горизонта во всём кадре: и вес `w`
 * координаты вдоль линий, и знаменатель `1 − a·q` высоты линии положительны.
 * Оба дробно-линейны по кадру, поэтому хватает его углов. Один знаменатель
 * `1 − a·q` проверки не держит: за горизонтом вес и числитель меняют знак
 * вместе, и знаменатель остаётся положительным там, где координата вдоль линий
 * уже не определена.
 *
 * @param perspective — перспектива из записи
 * @param skewAngle — наклон разлиновки записи в градусах
 * @param frame — кадр фотографии записи
 * @returns признак годной перспективы
 */
const isPerspectiveInFrame = (
  perspective: RulingPerspective,
  skewAngle: number,
  frame: SheetFrame
): boolean => {
  const { originX, originY, convergenceX, convergenceY } = perspective;
  const projection = { skewAngle, perspective };
  const tangent = Math.tan((skewAngle * Math.PI) / DEGREES_IN_HALF_TURN);
  const columns = [0, Math.max(frame.width - 1, 0)];
  const rows = [0, Math.max(frame.height - 1, 0)];

  return columns.every((x) => {
    return rows.every((y) => {
      const weight = 1 + convergenceX * (x - originX) + convergenceY * (y - originY);

      if (!(weight > 0)) {
        return false;
      }

      const offset = lineCoordinateAt(projection, x, y) - originY + originX * tangent;

      return 1 - offset * convergenceY > 0;
    });
  });
};

/**
 * Перспектива разлиновки из JSON. Нечитаемая или лежащая за горизонтом где-то
 * в кадре — отсутствие перспективы: строки такого листа идут через равный шаг,
 * а не уходят в бесконечность.
 *
 * @param value — разобранное значение
 * @param skewAngle — наклон разлиновки записи в градусах
 * @param frame — кадр фотографии записи
 * @returns перспектива; `null` — перспективы нет или она негодна
 */
const parseRulingPerspective = (
  value: unknown,
  skewAngle: number,
  frame: SheetFrame
): RulingPerspective | null => {
  if (!isJsonRecord(value)) {
    return null;
  }

  const { originX, originY, convergenceX, convergenceY } = value;

  if (
    !isFiniteNumber(originX) ||
    !isFiniteNumber(originY) ||
    !isFiniteNumber(convergenceX) ||
    !isFiniteNumber(convergenceY)
  ) {
    return null;
  }

  const perspective = { originX, originY, convergenceX, convergenceY };

  return isPerspectiveInFrame(perspective, skewAngle, frame) ? perspective : null;
};

/**
 * Разлиновка экземпляра из JSON. Запись прежней формы разлиновки не несёт: шаг,
 * фаза и наклон берутся из полей самого экземпляра, поля и линия поля —
 * фолбэком.
 *
 * @param value — разобранный экземпляр
 * @param frame — кадр фотографии экземпляра: от него считается фолбэк полей
 * @returns разлиновка экземпляра
 */
const parseSheetRuling = (
  value: Record<string, unknown>,
  frame: SheetFrame
): SheetRuling => {
  const { ruling } = value;

  if (!isJsonRecord(ruling)) {
    return buildSheetRuling(
      {
        step: toFiniteNumber(value.measuredStep, 0),
        firstLinePhase: toFiniteNumber(value.firstLinePhase, 0),
        skewAngle: toFiniteNumber(value.skewAngle, 0),
      },
      frame
    );
  }

  const skewAngle = toFiniteNumber(ruling.skewAngle, 0);

  return buildSheetRuling(
    {
      step: toFiniteNumber(ruling.step, 0),
      firstLinePhase: toFiniteNumber(ruling.firstLinePhase, 0),
      skewAngle,
      margins: parseMargins(ruling.margins),
      marginLineX: toFiniteNumber(ruling.marginLineX, 0) || null,
      marginLineSide: parseMarginLineSide(ruling.marginLineSide),
      sideSlant: parseSideSlant(ruling.sideSlant),
      bend: parseRulingBend(ruling.bend),
      perspective: parseRulingPerspective(ruling.perspective, skewAngle, frame),
      outline: parseSheetOutline(ruling.outline),
      mirrorOverride: parseMirrorOverride(ruling.mirrorOverride),
    },
    frame
  );
};

/**
 * Экземпляр листа из JSON. Обязательны только идентификатор и фотография:
 * экземпляр без них нечем показать и не с чем связать, поэтому такой
 * отбрасывается. Остальное — измерения, и отсутствующее измерение заменяется
 * нейтральным: лист остаётся в списке, а недостающие поля разлиновки
 * берутся фолбэком.
 *
 * @param value — разобранное значение
 * @returns экземпляр листа или `null`, если его нечем показать
 */
export const parsePaperSheet = (value: unknown): PaperSheet | null => {
  if (!isJsonRecord(value)) {
    return null;
  }

  const id = toText(value.id);
  const src = toText(value.src);

  if (!id || !src) {
    return null;
  }

  const frame = {
    width: toFiniteNumber(value.width, 0),
    height: toFiniteNumber(value.height, 0),
  };

  return {
    id,
    label: toText(value.label) || id,
    src,
    width: frame.width,
    height: frame.height,
    ruling: parseSheetRuling(value, frame),
    lighting: parseLighting(value.lighting),
    texture: parseTexture(value.texture),
  };
};

/**
 * Наименьшее число булавок, через которое проводится гребёнка.
 */
const MIN_PIN_COUNT = 2;

/**
 * Виды разлиновки, которые знает запись листа.
 */
const RULING_KINDS: RulingKind[] = ['grid', 'lined', 'blank'];

/**
 * Вид разлиновки из JSON.
 *
 * @param value — разобранное значение
 * @returns вид; `null` — вида нет или он нечитаем
 */
const parseRulingKind = (value: unknown): RulingKind | null => {
  return (
    RULING_KINDS.find((kind) => {
      return kind === value;
    }) || null
  );
};

/**
 * Булавка из JSON.
 *
 * @param value — разобранное значение
 * @returns булавка; `null` — номер не целый или у конца нет координаты
 */
const parseRulingPin = (value: unknown): RulingPin | null => {
  if (!isJsonRecord(value) || !Number.isInteger(value.index)) {
    return null;
  }

  const left = parseSheetPoint(value.left);
  const right = parseSheetPoint(value.right);

  if (!left || !right) {
    return null;
  }

  return { index: toFiniteNumber(value.index, 0), left, right };
};

/**
 * Булавки из JSON. Испорченная булавка снимает все, а не одну: гребёнка через
 * оставшиеся прошла бы не там, где её закрепил пользователь. Без булавок лист
 * получает выведенные из его разлиновки — они проходят по тем же линиям.
 *
 * @param value — разобранное значение
 * @param ruling — разлиновка записи
 * @param frame — кадр фотографии записи
 * @returns булавки
 */
const parseRulingPins = (
  value: unknown,
  ruling: SheetRuling,
  frame: SheetFrame
): RulingPin[] => {
  const items: unknown[] = Array.isArray(value) ? value : [];
  const pins = items.reduce<RulingPin[]>((acc, item) => {
    const pin = parseRulingPin(item);

    if (pin) {
      acc.push(pin);
    }

    return acc;
  }, []);

  return pins.length === items.length && pins.length >= MIN_PIN_COUNT
    ? pins
    : deriveRulingPins(ruling, frame);
};

/**
 * Карта текстуры записи своего листа. Без картинки файлом карты нет.
 *
 * @param value — разобранное значение
 * @returns карта; `null` — карты нет или в ней нет картинки
 */
const parseStoredTexture = (value: unknown): StoredSheetTexture | null => {
  if (!isJsonRecord(value) || !(value.image instanceof Blob)) {
    return null;
  }

  return {
    image: value.image,
    width: toFiniteNumber(value.width, 0),
    height: toFiniteNumber(value.height, 0),
    amplitude: toFiniteNumber(value.amplitude, 0),
  };
};

/**
 * Запись своего листа из IndexedDB. Обязательны идентификатор и фотография
 * файлом: без них лист нечем показать. Разлиновка разбирается тем же путём, что
 * у `parsePaperSheet`, с теми же фолбэками. Недостающие поля новой формы
 * получают дефолты: вид — чистый лист, если запись помечена `isBlank`, иначе
 * вид семьи; найденная разметка — сохранённая; булавки — выведенные из
 * разлиновки; замена полей зеркала — нет.
 *
 * @param value — прочитанная запись
 * @param resolveFamilyKind — вид семьи по её идентификатору
 * @returns запись листа или `null`, если его нечем показать
 */
export const parseStoredUserSheet = (
  value: unknown,
  resolveFamilyKind: (familyId: string) => RulingKind
): StoredUserSheet | null => {
  if (!isJsonRecord(value) || !(value.source instanceof Blob)) {
    return null;
  }

  const id = toText(value.id);

  if (!id) {
    return null;
  }

  const familyId = toText(value.familyId);
  const frame = {
    width: toFiniteNumber(value.width, 0),
    height: toFiniteNumber(value.height, 0),
  };
  const ruling = parseSheetRuling(value, frame);
  const measuredRuling = isJsonRecord(value.measuredRuling)
    ? parseSheetRuling({ ruling: value.measuredRuling }, frame)
    : ruling;
  const legacyKind = value.isBlank === true ? 'blank' : resolveFamilyKind(familyId);
  const kind = parseRulingKind(value.kind) || legacyKind;

  return {
    id,
    familyId,
    kind,
    label: toText(value.label) || id,
    width: frame.width,
    height: frame.height,
    ruling,
    measuredRuling,
    measuredKind: parseRulingKind(value.measuredKind) || kind,
    pins: parseRulingPins(value.pins, ruling, frame),
    lighting: parseLighting(value.lighting),
    source: value.source,
    texture: parseStoredTexture(value.texture),
  };
};
