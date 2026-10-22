import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';
import type { MarkupToolId } from '../SheetMarkupEditor.types';

export type MarkupNoticesProps = {
  /**
   * Инструмент, рядом с которым показываются сообщения.
   */
  tool: MarkupToolId;

  /**
   * Черновик разметки: по нему видно, чего автомат не нашёл.
   */
  draft: MarkupDraft;
};
