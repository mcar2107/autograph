import { decodeSheetPhotoBlob } from './measureSheetImage';
import {
  collectAnalysisTransfer,
  collectImageTransfer,
  measureSheetRequest,
} from './measureSheetRequest';
import type {
  MeasureSheetRequest,
  MeasureSheetResponse,
} from './measureSheetWorker.types';

/**
 * Что сказать клиенту, когда разбор кончился исключением: оно через границу
 * воркера не проходит.
 *
 * @param error — то, чем кончился разбор
 * @returns сообщение об отказе
 */
const toMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Лист не разобрался';
};

/**
 * Воркер разбора фотографий листа: декодирует снимок, меряет его и отдаёт
 * измерение вместе с каналами снимка и картой текстуры. Задание «decode»
 * только декодирует: каналы нужны магнитам редактора на уже разобранном
 * листе.
 *
 * Задания отвечаются по номеру: клиент на порядок ответов не опирается.
 */
addEventListener('message', (event: MessageEvent<MeasureSheetRequest>) => {
  const request = event.data;

  const reply = async (): Promise<void> => {
    try {
      switch (request.task) {
        case 'measure': {
          const analysis = await measureSheetRequest(request);
          const response: MeasureSheetResponse = {
            requestId: request.requestId,
            status: 'done',
            analysis,
          };

          postMessage(response, {
            transfer: analysis ? collectAnalysisTransfer(analysis) : [],
          });

          return;
        }

        case 'decode': {
          const image = await decodeSheetPhotoBlob(request.photo);
          const response: MeasureSheetResponse = {
            requestId: request.requestId,
            status: 'decoded',
            image,
          };

          postMessage(response, { transfer: image ? collectImageTransfer(image) : [] });

          return;
        }

        default: {
          throw new Error('Неизвестное задание воркеру разбора');
        }
      }
    } catch (error: unknown) {
      const response: MeasureSheetResponse = {
        requestId: request.requestId,
        status: 'failed',
        message: toMessage(error),
      };

      postMessage(response);
    }
  };

  void reply();
});
