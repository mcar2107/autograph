import 'fake-indexeddb/auto';

import { installCanvasStub } from './canvas-recorder';

/**
 * jsdom не реализует API, на которые опираются примитивы Radix: наблюдение за
 * размерами и захват указателя. Без заглушек компонентные тесты падают ещё на
 * монтировании, хотя проверяют логику, а не вёрстку.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = (): boolean => {
    return false;
  };

  Element.prototype.setPointerCapture = (): void => {};

  Element.prototype.releasePointerCapture = (): void => {};

  Element.prototype.scrollIntoView = (): void => {};
}

/**
 * `document.fonts` в jsdom нет, а ядро ждёт готовности шрифта перед
 * измерением. Заглушка отдаёт готовность сразу: настоящие шрифты в jsdom всё
 * равно не грузятся.
 */
if (typeof document !== 'undefined' && !document.fonts) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      load: () => {
        return Promise.resolve([]);
      },
      add: () => {},
      ready: Promise.resolve(undefined),
    },
  });
}

/**
 * FontFace в jsdom тоже нет. Заглушка разбирает файл так же грубо, как это
 * делает браузер на первом шаге: настоящий `.ttf` начинается с нулевого байта
 * версии sfnt, всё остальное считаем нечитаемым.
 */
class FontFaceStub {
  private readonly source: ArrayBuffer;

  constructor(_family: string, source: ArrayBuffer) {
    this.source = source;
  }

  load(): Promise<FontFaceStub> {
    const [first] = new Uint8Array(this.source);

    return first === 0
      ? Promise.resolve(this)
      : Promise.reject(new Error('Файл не разобрался как шрифт'));
  }
}

/**
 * jsdom не считает layout, и у `Range` нет `getClientRects`. Возвращаем пустой
 * список: измеритель на настоящем DOM в jsdom всё равно даст нули, а
 * содержательные проверки разбивки идут на измерителе-модели.
 */
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => {
    return [] as unknown as DOMRectList;
  };
}

if (typeof globalThis.FontFace === 'undefined') {
  Object.defineProperty(globalThis, 'FontFace', {
    configurable: true,
    value: FontFaceStub,
  });
}

/**
 * jsdom не растеризует canvas: `getContext('2d')` отдаёт `null`, и страница в
 * компонентном тесте не рисовалась бы вовсе. Записыватель занимает его место —
 * заодно по нему видно, что именно рендерер попросил нарисовать.
 */
installCanvasStub();

/**
 * Структурный клон, не теряющий файлы. В jsdom `Blob` — класс jsdom, а
 * `structuredClone` — родной из Node: такой файл он молча превращает в пустой
 * объект, и IndexedDB-заглушка вернула бы вместо фотографии `{}`. Файл
 * неизменяем, поэтому вместо копии годится он сам — как и в браузере, где
 * клон `Blob` ссылается на те же байты.
 */
const nativeStructuredClone = globalThis.structuredClone;

/**
 * Массив или простой объект: их клон собирается поэлементно.
 *
 * @param value — клонируемое значение
 * @returns признак контейнера
 */
const isPlainContainer = (value: unknown): value is object => {
  return (
    Array.isArray(value) ||
    (typeof value === 'object' &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype)
  );
};

/**
 * Есть ли внутри значения файл: только тогда клон идёт своим путём, всё
 * остальное клонирует родная реализация без изменений.
 *
 * @param value — клонируемое значение
 * @param visited — уже пройденные объекты: защита от циклов
 * @returns признак файла внутри
 */
const containsBlob = (value: unknown, visited: Set<object>): boolean => {
  if (value instanceof Blob) {
    return true;
  }

  /**
   * Внутрь идём только в массивы и простые объекты — ровно туда, куда клон
   * ниже копирует поэлементно. Перебор типизированного массива на миллионы
   * пикселей ради поиска файла занял бы секунды.
   */
  if (!isPlainContainer(value) || visited.has(value)) {
    return false;
  }

  visited.add(value);

  return Object.values(value).some((item) => {
    return containsBlob(item, visited);
  });
};

/**
 * Клон, в котором файлы остаются собой, массивы и простые объекты копируются
 * поэлементно, а всё прочее уходит в родной клон.
 *
 * @param value — клонируемое значение
 * @returns клон
 */
const cloneKeepingBlobs = (value: unknown): unknown => {
  if (value instanceof Blob) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(cloneKeepingBlobs);
  }

  if (isPlainContainer(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        return [key, cloneKeepingBlobs(item)];
      })
    );
  }

  return nativeStructuredClone(value);
};

if (typeof Blob !== 'undefined' && !(nativeStructuredClone(new Blob()) instanceof Blob)) {
  globalThis.structuredClone = <T>(value: T, options?: StructuredSerializeOptions): T => {
    if (containsBlob(value, new Set())) {
      return cloneKeepingBlobs(value) as T;
    }

    return nativeStructuredClone(value, options);
  };
}
