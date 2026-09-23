import { collectAnalysisTransfer, measureSheetRequest } from './measureSheetRequest';
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
 * измерение вместе с каналами снимка и картой текстуры.
 *
 * Задания отвечаются по номеру: клиент на порядок ответов не опирается.
 */
addEventListener('message', (event: MessageEvent<MeasureSheetRequest>) => {
  const request = event.data;

  const reply = async (): Promise<void> => {
    try {
      const analysis = await measureSheetRequest(request);
      const response: MeasureSheetResponse = {
        requestId: request.requestId,
        status: 'done',
        analysis,
      };

      postMessage(response, {
        transfer: analysis ? collectAnalysisTransfer(analysis) : [],
      });
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
