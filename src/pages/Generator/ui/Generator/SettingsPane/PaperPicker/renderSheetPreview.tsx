import type { PaperSheet } from '../../../../lib/paper';

/**
 * Превью листа в плитке. Подпись плитки рядом, поэтому картинка —
 * декоративная.
 *
 * @param sheet — экземпляр, фотография которого показывается
 * @returns картинка, заполняющая квадрат плитки
 */
export const renderSheetPreview = (sheet: PaperSheet | undefined) => {
  if (!sheet) {
    return null;
  }

  return <img src={sheet.src} alt="" className="size-full object-cover" />;
};
