import type { SheetOutline } from '../../../../../lib/paper';
import { buildSheetRuling, deriveRulingPins } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { resolveMeasuredKind } from '../../../../../model/userSheetsStorageRecord';
import { analyzeSheetPhoto } from '../../useSheetImport';
import { rebuildBlankRuling } from '../../useSheetRemeasure';

import type { OutlineRemeasureStatus } from './OutlineTool.types';

/**
 * Номер последнего запрошенного перемера. Живёт вне инструмента: перемер
 * переживает переключение на другой инструмент, а ответ на устаревший контур
 * не должен лечь поверх нового.
 */
let latestRequest = 0;

/**
 * Перемеряет открытый в редакторе лист внутри нового контура и кладёт итог в
 * черновик одним шагом истории: разлиновку, булавки на ней и перемер — свет,
 * текстуру и разметку автомата.
 *
 * Разбор идёт в воркере, и окно редактора всё это время отвечает; сохранение
 * на это время недоступно. Контур не ищется, а берётся заданный. Всё, что
 * меряется, заменяет правленое руками, кроме вида разлиновки и заданных
 * отдельно линии поля и полей зеркальной страницы. У чистого листа линии не
 * ищутся: шаг и фаза остаются, поля подтягиваются внутрь нового контура.
 *
 * @param outline — новый контур, уже проверенный на годность
 * @returns чем кончился перемер
 */
export const remeasureOutline = async (
  outline: SheetOutline
): Promise<OutlineRemeasureStatus> => {
  const { record, draft, setRemeasuring } = useMarkupEditorStore.getState();

  if (!record || !draft) {
    return 'dropped';
  }

  latestRequest += 1;

  const request = latestRequest;
  const { sheet } = record;
  const { kind } = draft;
  const isBlank = kind === 'blank';
  const frame = { width: sheet.width, height: sheet.height };

  setRemeasuring('outline', true);

  try {
    const analysis = await analyzeSheetPhoto({ src: sheet.src }, { kind, outline });
    const { record: current, draft: latest, commit } = useMarkupEditorStore.getState();

    if (request !== latestRequest || current?.sheet.id !== sheet.id || !latest) {
      return 'dropped';
    }

    if (!analysis) {
      return 'failed';
    }

    const { measurement, texture } = analysis;
    const measured = isBlank
      ? rebuildBlankRuling(latest.ruling, measurement.outline, frame)
      : buildSheetRuling(measurement.source, frame);
    const ruling = { ...measured, mirrorOverride: latest.ruling.mirrorOverride };

    commit({
      ruling,
      pins: deriveRulingPins(ruling, frame),
      remeasure: {
        lighting: measurement.lighting,
        texture,
        measuredRuling: ruling,
        measuredKind: resolveMeasuredKind(measurement, kind, isBlank),
      },
    });

    return 'applied';
  } catch {
    return 'failed';
  } finally {
    /**
     * Ожидание снимает только последний перемер: пока идёт более новый,
     * сохранение по-прежнему ждёт.
     */
    if (request === latestRequest) {
      useMarkupEditorStore.getState().setRemeasuring('outline', false);
    }
  }
};
