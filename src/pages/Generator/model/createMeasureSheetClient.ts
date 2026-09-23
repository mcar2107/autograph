import type { SheetPhotoOptions } from '../lib/paper';

import type {
  MeasureSheetClient,
  MeasureSheetClientDeps,
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
   * Отдать разбор.
   */
  resolve: (analysis: SheetPhotoAnalysis | null) => void;

  /**
   * Сообщить, что разбор не удался.
   */
  reject: (error: Error) => void;
};

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

    switch (response.status) {
      case 'done': {
        waiting.resolve(response.analysis);

        return;
      }

      case 'failed': {
        waiting.reject(new Error(response.message));

        return;
      }

      default: {
        throw new Error('Воркер ответил неизвестным исходом');
      }
    }
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

  const measure = (
    photo: Blob,
    options: SheetPhotoOptions
  ): Promise<SheetPhotoAnalysis | null> => {
    lastRequestId += 1;

    const request: MeasureSheetRequest = { requestId: lastRequestId, photo, options };

    return new Promise<SheetPhotoAnalysis | null>((resolve, reject) => {
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

  return { measure };
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

  return appClient.measure(photo, options);
};
