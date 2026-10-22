export type MarkupSheetDeleteProps = {
  /**
   * Подпись листа: её называет подтверждение удаления.
   */
  sheetLabel: string;

  /**
   * Колбэк на подтверждённое удаление листа.
   */
  onDelete: () => void;
};
