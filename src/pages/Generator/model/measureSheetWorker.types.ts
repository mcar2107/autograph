import type {
  PaperTexture,
  SheetImageData,
  SheetPhotoMeasurement,
  SheetPhotoOptions,
} from '../lib/paper';

/**
 * Разбор фотографии листа целиком: измерение, закодированная карта текстуры и
 * сами каналы снимка.
 *
 * Каналы отдаются вместе с измерением, потому что по ним же работают магниты
 * редактора разметки: декодировать фотографию второй раз ради них дороже, чем
 * держать уже снятые, пока редактор открыт.
 */
export type SheetPhotoAnalysis = {
  /**
   * Каналы снимка — яркость и `R − G`, — по которым шло измерение.
   */
  image: SheetImageData;

  /**
   * Измерение фотографии: разлиновка, контур, свет, карта текстуры и отчёты.
   */
  measurement: SheetPhotoMeasurement;

  /**
   * Карта текстуры, закодированная для шейдера. `null` — закодировать не
   * удалось: лист остаётся без текстуры, раскладку это не меняет.
   */
  texture: PaperTexture | null;
};

/**
 * Задание воркеру: разобрать одну фотографию листа.
 */
export type MeasureSheetRequest = {
  /**
   * Номер задания: воркер отвечает по нему, порядок ответов не обещан.
   */
  requestId: number;

  /**
   * Файл фотографии как есть: декодирование тоже уходит из основного потока.
   */
  photo: Blob;

  /**
   * Настройки измерения — те же, что у разбора в основном потоке.
   */
  options: SheetPhotoOptions;
};

/**
 * Разбор закончен.
 */
export type MeasureSheetDone = {
  /**
   * Номер задания.
   */
  requestId: number;

  /**
   * Признак исхода.
   */
  status: 'done';

  /**
   * Разбор фотографии. `null` — браузер её не декодировал: лист всё равно
   * добавляется, разлиновку к нему задают руками.
   */
  analysis: SheetPhotoAnalysis | null;
};

/**
 * Разбор кончился исключением.
 */
export type MeasureSheetFailed = {
  /**
   * Номер задания.
   */
  requestId: number;

  /**
   * Признак исхода.
   */
  status: 'failed';

  /**
   * Чем кончился разбор: исключение через границу воркера не проходит.
   */
  message: string;
};

/**
 * Ответ воркера на задание.
 */
export type MeasureSheetResponse = MeasureSheetDone | MeasureSheetFailed;

/**
 * Порт воркера глазами клиента: только то, чем клиент пользуется. Приложение
 * оборачивает в него `Worker`, тест подставляет запись сообщений.
 */
export type MeasureSheetPort = {
  /**
   * Отправляет задание.
   */
  postMessage: (request: MeasureSheetRequest) => void;

  /**
   * Подписывается на ответы воркера.
   */
  onResponse: (listener: (response: MeasureSheetResponse) => void) => void;

  /**
   * Подписывается на падение воркера: ошибку загрузки модуля или исключение
   * вне обработчика задания. Ответа на ждущие задания после неё не будет.
   */
  onCrash: (listener: () => void) => void;

  /**
   * Останавливает воркер.
   */
  terminate: () => void;
};

/**
 * Чем клиент открывает воркер.
 */
export type MeasureSheetClientDeps = {
  /**
   * Открывает порт воркера. Зовётся на первое задание и после падения воркера.
   */
  createPort: () => MeasureSheetPort;
};

/**
 * Разбор фотографии листа вне основного потока.
 */
export type MeasureSheetClient = {
  /**
   * Разбирает фотографию. `null` — фотография не декодировалась; отказ —
   * разбор кончился исключением или воркер упал.
   */
  measure: (
    photo: Blob,
    options: SheetPhotoOptions
  ) => Promise<SheetPhotoAnalysis | null>;
};
