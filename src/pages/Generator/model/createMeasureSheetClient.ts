import type { SheetImageData, SheetPhotoOptions } from '../lib/paper';

import type {
  MeasureSheetClient,
  MeasureSheetClientDeps,
  MeasureSheetDecodeRequest,
  MeasureSheetMeasureRequest,
  MeasureSheetPort,
  MeasureSheetRequest,
  MeasureSheetResponse,
  SheetPhotoAnalysis,
} from './measureSheetWorker.types';

/**
 * Незакрытое задание: чем ответить клиенту, когда воркер пришлёт ответ.
 */
type PendingMeasure = {
  /**
   * Отдать ответ воркера тому, кто ждёт задание.
   */
  resolve: (response: MeasureSheetResponse) => void;

  /**
   * Сообщить, что задание не удалось.
   */
  reject: (error: Error) => void;
};

/**
 * Задание без номера: номер ставит клиент.
 */
type UnnumberedRequest =
  | Omit<MeasureSheetMeasureRequest, 'requestId'>
  | Omit<MeasureSheetDecodeRequest, 'requestId'>;

const CRASH_MESSAGE = 'Воркер разбора листа упал';

/**
 * Клиент разбора: отправляет фотографию воркеру и ждёт измерение.
 *
 * Порт открывается на первое задание, а не при создании клиента: модуль
 * импортируется всегда, а воркер нужен только тому, кто добавляет или
 * перемеряет свой лист. Упавший воркер останавливается, ждущие задания
 * получают отказ, и следующее задание открывает порт заново — иначе одно
 * падение оставило бы импорт листов сломанным до перезагрузки вкладки.
 *
 * @param deps — чем открывать порт
 * @returns клиент разбора
 */
export const createMeasureSheetClient = (
  deps: MeasureSheetClientDeps
): MeasureSheetClient => {
  const { createPort } = deps;
  const pending = new Map<number, PendingMeasure>();
  let port: MeasureSheetPort | null = null;
  let lastRequestId = 0;

  /**
   * Закрывает задание ответом воркера.
   */
  const settle = (response: MeasureSheetResponse): void => {
    const waiting = pending.get(response.requestId);

    if (!waiting) {
      return;
    }

    pending.delete(response.requestId);

    if (response.status === 'failed') {
      waiting.reject(new Error(response.message));

      return;
    }

    waiting.resolve(response);
  };

  /**
   * Отказывает всем ждущим и забывает порт упавшего воркера.
   */
  const handleCrash = (crashed: MeasureSheetPort): void => {
    if (port !== crashed) {
      return;
    }

    crashed.terminate();
    port = null;

    const waiting = [...pending.values()];

    pending.clear();
    waiting.forEach(({ reject }) => {
      reject(new Error(CRASH_MESSAGE));
    });
  };

  /**
   * Порт воркера: открывается на первое задание и живёт, пока воркер не упал.
   */
  const openPort = (): MeasureSheetPort => {
    if (port) {
      return port;
    }

    const opened = createPort();

    opened.onResponse(settle);
    opened.onCrash(() => {
      handleCrash(opened);
    });
    port = opened;

    return opened;
  };

  /**
   * Отправляет задание и ждёт ответ воркера на него.
   *
   * @param unnumbered — задание без номера
   * @returns ответ воркера; отказ — задание не удалось
   */
  const send = (unnumbered: UnnumberedRequest): Promise<MeasureSheetResponse> => {
    lastRequestId += 1;

    const request: MeasureSheetRequest = { ...unnumbered, requestId: lastRequestId };

    return new Promise<MeasureSheetResponse>((resolve, reject) => {
      pending.set(request.requestId, { resolve, reject });

      try {
        openPort().postMessage(request);
      } catch (error: unknown) {
        pending.delete(request.requestId);
        reject(
          new Error(
            error instanceof Error
              ? `Задание не прошло через границу воркера: ${error.message}`
              : 'Задание не прошло через границу воркера'
          )
        );
      }
    });
  };

  /**
   * Ответ не на то задание — ошибка протокола, а не пустой результат.
   *
   * @param response — ответ воркера
   * @returns ошибка несовпавшего исхода
   */
  const toMismatch = (response: MeasureSheetResponse): Error => {
    return new Error(`Воркер ответил не тем исходом: ${response.status}`);
  };

  const measure = async (
    photo: Blob,
    options: SheetPhotoOptions
  ): Promise<SheetPhotoAnalysis | null> => {
    const response = await send({ task: 'measure', photo, options });

    if (response.status !== 'done') {
      throw toMismatch(response);
    }

    return response.analysis;
  };

  const decode = async (photo: Blob): Promise<SheetImageData | null> => {
    const response = await send({ task: 'decode', photo });

    if (response.status !== 'decoded') {
      throw toMismatch(response);
    }

    return response.image;
  };

  return { measure, decode };
};

/**
 * Клиент приложения: настоящий воркер. Создаётся на первое задание — в jsdom
 * воркера нет, а модуль импортируется всегда.
 */
let appClient: MeasureSheetClient | null = null;

/**
 * Есть ли где разбирать фотографию вне основного потока. Нет — разбор идёт в
 * основном потоке: в jsdom тестов воркера нет, а добавить лист там всё равно
 * нужно.
 *
 * @returns признак доступного воркера
 */
export const hasMeasureSheetWorker = (): boolean => {
  return typeof Worker !== 'undefined';
};

/**
 * Клиент приложения с настоящим воркером: создаётся на первое задание.
 *
 * @returns клиент разбора
 */
const getAppClient = (): MeasureSheetClient => {
  if (!appClient) {
    appClient = createMeasureSheetClient({
      createPort: () => {
        const worker = new Worker(new URL('./measureSheet.worker.ts', import.meta.url), {
          type: 'module',
        });

        return {
          postMessage: (request) => {
            worker.postMessage(request);
          },
          onResponse: (listener) => {
            worker.addEventListener(
              'message',
              (event: MessageEvent<MeasureSheetResponse>) => {
                listener(event.data);
              }
            );
          },
          onCrash: (listener) => {
            worker.addEventListener('error', listener);
          },
          terminate: () => {
            worker.terminate();
          },
        };
      },
    });
  }

  return appClient;
};

/**
 * Разбирает фотографию листа в воркере: декодирование, каналы снимка,
 * измерение и кодирование карты текстуры идут вне основного потока, и
 * интерфейс отвечает всё время разбора. Числа те же, что у `measureSheetPhoto`
 * в основном потоке, до бита.
 *
 * @param photo — файл фотографии
 * @param options — настройки измерения
 * @returns разбор; `null` — фотография не декодировалась
 */
export const measureSheetInWorker = (
  photo: Blob,
  options: SheetPhotoOptions
): Promise<SheetPhotoAnalysis | null> => {
  return getAppClient().measure(photo, options);
};

/**
 * Снимает каналы снимка в воркере, без измерения: для магнитов редактора,
 * открытого на уже разобранном листе. Декодирование идёт вне основного
 * потока, буферы приходят передачей владения.
 *
 * @param photo — файл фотографии
 * @returns каналы снимка; `null` — фотография не декодировалась
 */
export const decodeSheetInWorker = (photo: Blob): Promise<SheetImageData | null> => {
  return getAppClient().decode(photo);
};
