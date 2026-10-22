import type { RulingKind } from '../../../../../lib/paper';
import { buildSheetRuling, deriveRulingPins } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { analyzeSheetPhoto } from '../../useSheetImport';
import { createRemeasureQueue, keepMirrorOverride } from '../markupRemeasure';

import type { RulingLinesSearchStatus } from './RulingKindControl.types';

const LINES_SEARCH = createRemeasureQueue('lines');

/**
 * Меняет вид с «Без разлиновки» на клетку или линейку и заново ищет линии на
 * фотографии внутри контура черновика.
 *
 * Вид виден в черновике сразу, а шагом истории вместе с найденными линиями
 * он становится, только когда поиск кончился: отмена возвращает чистый лист
 * одним шагом. Сохранение на время поиска недоступно — иначе на лист лёг бы
 * новый вид с воображаемыми строками чистого листа.
 *
 * Найденная разлиновка заменяет заданную руками целиком, кроме полей
 * зеркальной страницы; булавки выводятся из неё заново. Не нашлись линии или
 * не прочиталась фотография — вид всё равно меняется, а закреплённые строки
 * остаются: без них у листа не было бы шага вовсе. Разметка автомата
 * (`measuredRuling`) не меняется — контур тот же.
 *
 * @param kind — выбранный вид: клетка или линейка
 * @returns чем кончился поиск
 */
export const searchRulingLines = async (
  kind: RulingKind
): Promise<RulingLinesSearchStatus> => {
  const { record, draft, preview } = useMarkupEditorStore.getState();

  if (!record || !draft) {
    return 'dropped';
  }

  const request = LINES_SEARCH.start();
  const { sheet } = record;
  const { outline } = draft.ruling;
  const frame = { width: sheet.width, height: sheet.height };

  preview({ kind });

  try {
    const analysis = await analyzeSheetPhoto({ src: sheet.src }, { kind, outline });
    const { record: current, draft: latest, commit } = useMarkupEditorStore.getState();

    /**
     * Пока шёл поиск, вид могли отменить или сменить, а контур — перемерить:
     * линии, найденные в прежнем контуре, легли бы мимо нового.
     */
    if (
      !LINES_SEARCH.isLatest(request) ||
      current?.sheet.id !== sheet.id ||
      latest?.kind !== kind ||
      latest.ruling.outline !== outline
    ) {
      return 'dropped';
    }

    if (!analysis) {
      commit({ kind });

      return 'failed';
    }

    const { measurement } = analysis;

    if (!measurement.diagnostics.isRulingDetected) {
      commit({ kind });

      return 'notFound';
    }

    const measured = buildSheetRuling(measurement.source, frame);
    const ruling = keepMirrorOverride(measured, latest.ruling, frame);

    commit({ kind, ruling, pins: deriveRulingPins(ruling, frame) });

    return 'applied';
  } catch {
    const { draft: latest, commit } = useMarkupEditorStore.getState();

    if (!LINES_SEARCH.isLatest(request) || latest?.kind !== kind) {
      return 'dropped';
    }

    commit({ kind });

    return 'failed';
  } finally {
    LINES_SEARCH.finish(request);
  }
};
