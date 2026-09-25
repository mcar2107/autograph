import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';

/**
 * Годится ли контур для перемера:
 *
 * - `usable` — годится;
 * - `inverted` — невыпуклый или вывернутый: углы не обходят лист по кругу;
 * - `narrow` — от кадра остаётся меньше четверти ширины или высоты.
 */
export type OutlineVerdict = 'usable' | 'inverted' | 'narrow';

/**
 * Чем кончился перемер по контуру:
 *
 * - `applied` — разметка перемеряна и легла в черновик;
 * - `failed` — фотография не прочиталась, черновик прежний;
 * - `dropped` — результат устарел: пришёл новый контур или редактор закрыт.
 */
export type OutlineRemeasureStatus = 'applied' | 'failed' | 'dropped';

/**
 * Итог перемера для пользователя.
 */
export type OutlineNotice = {
  /**
   * Текст сообщения.
   */
  text: string;

  /**
   * Черновик, который перемер положил: сообщение показывается, пока разметка
   * — он.
   */
  draft: MarkupDraft | null;
};
