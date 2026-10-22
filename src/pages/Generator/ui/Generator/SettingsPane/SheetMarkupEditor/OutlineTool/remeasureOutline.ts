import type { SheetOutline } from '../../../../../lib/paper';
import { buildSheetRuling, deriveRulingPins } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { resolveMeasuredKind } from '../../../../../model/userSheetsStorageRecord';
import { analyzeSheetPhoto } from '../../useSheetImport';
import { createRemeasureQueue, keepMirrorOverride } from '../markupRemeasure';

import type { OutlineRemeasureStatus } from './OutlineTool.types';
import { rebuildBlankRuling } from './rebuildBlankRuling';

const OUTLINE_REMEASURE = createRemeasureQueue('outline');

/**
 * Делает устаревшим перемер в полёте: угол вернули на место или отпустили
 * негодный контур, и последнее действие пользователя ответ на прежний контур
 * перебивать не должен.
 */
export const cancelOutlineRemeasure = () => {
  OUTLINE_REMEASURE.cancel();
};

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
  const { record, draft } = useMarkupEditorStore.getState();

  if (!record || !draft) {
    return 'dropped';
  }

  const request = OUTLINE_REMEASURE.start();
  const { sheet } = record;
  const { kind } = draft;
  const isBlank = kind === 'blank';
  const frame = { width: sheet.width, height: sheet.height };

  try {
    const analysis = await analyzeSheetPhoto({ src: sheet.src }, { kind, outline });
    const { record: current, draft: latest, commit } = useMarkupEditorStore.getState();

    if (
      !OUTLINE_REMEASURE.isLatest(request) ||
      current?.sheet.id !== sheet.id ||
      !latest
    ) {
      return 'dropped';
    }

    if (!analysis) {
      return 'failed';
    }

    const { measurement, texture } = analysis;
    const measured = isBlank
      ? rebuildBlankRuling(latest.ruling, measurement.outline, frame)
      : buildSheetRuling(measurement.source, frame);
    const ruling = keepMirrorOverride(measured, latest.ruling, frame);

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
    /**
     * Сбой устаревшего перемера не о том, что видно: пока он шёл, контур
     * сменили, и сообщение об ошибке легло бы поверх идущего нового.
     */
    return OUTLINE_REMEASURE.isLatest(request) ? 'failed' : 'dropped';
  } finally {
    OUTLINE_REMEASURE.finish(request);
  }
};
