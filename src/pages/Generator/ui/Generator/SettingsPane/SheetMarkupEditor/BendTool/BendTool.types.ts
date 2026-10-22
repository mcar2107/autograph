import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';

/**
 * Чего не хватает подгонке изгиба по фото:
 *
 * - `blank` — выбрано «Без разлиновки», линий на фото не ищут;
 * - `noLines` — у разметки нет линий;
 * - `noImage` — каналы фотографии ещё не готовы.
 */
export type BendRefitBlock = 'blank' | 'noLines' | 'noImage';

/**
 * Итог подгонки изгиба для пользователя.
 */
export type BendRefitNotice = {
  /**
   * Текст сообщения.
   */
  text: string;

  /**
   * Черновик после подгонки: сообщение показывается, пока разметка — он.
   */
  draft: MarkupDraft | null;
};
