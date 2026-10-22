import type { SheetFrame, SheetRuling } from '../../../../lib/paper';
import { reanchorMirrorOverride } from '../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../model/useMarkupEditorStore';
import type { MarkupRemeasureSource } from '../../../../model/useMarkupEditorStore.types';

import type { MarkupRemeasureQueue } from './markupRemeasure.types';

/**
 * Очередь разборов фотографии одного источника — перемера по контуру или
 * поиска линий по виду. Побеждает последний запрос: ответ на прежний не
 * ложится поверх нового, а ожидание сохранения снимает только он. Номер
 * запроса живёт вне инструмента: разбор переживает переключение на другой
 * инструмент.
 *
 * @param source — чей это разбор в сторе редактора
 * @returns запуск, проверка и отмена запросов
 */
export const createRemeasureQueue = (
  source: MarkupRemeasureSource
): MarkupRemeasureQueue => {
  let latestRequest = 0;

  return {
    start: () => {
      latestRequest += 1;
      useMarkupEditorStore.getState().setRemeasuring(source, true);

      return latestRequest;
    },
    isLatest: (request) => {
      return request === latestRequest;
    },
    finish: (request) => {
      if (request === latestRequest) {
        useMarkupEditorStore.getState().setRemeasuring(source, false);
      }
    },
    cancel: () => {
      latestRequest += 1;
      useMarkupEditorStore.getState().setRemeasuring(source, false);
    },
  };
};

/**
 * Разлиновка автомата с полями зеркала из черновика. Поля зеркала заданы
 * руками, и автомат их не перемеряет: при новом наклоне листа они
 * переписываются так, чтобы на фото остаться на месте.
 *
 * @param measured — разлиновка, найденная автоматом
 * @param previous — разлиновка черновика до разбора
 * @param frame — кадр фотографии
 * @returns разлиновка с переписанными полями зеркала
 */
export const keepMirrorOverride = (
  measured: SheetRuling,
  previous: SheetRuling,
  frame: SheetFrame
): SheetRuling => {
  return {
    ...measured,
    mirrorOverride: reanchorMirrorOverride(
      previous.mirrorOverride,
      previous.skewAngle,
      measured.skewAngle,
      frame
    ),
  };
};
