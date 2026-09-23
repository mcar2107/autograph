import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';
import type { UserSheetRecord } from '../../../../../model/userSheetsStorage.types';

export type MarkupEditorContentProps = {
  /**
   * Лист, открытый в редакторе.
   */
  record: UserSheetRecord;

  /**
   * Черновик его разметки.
   */
  draft: MarkupDraft;
};
