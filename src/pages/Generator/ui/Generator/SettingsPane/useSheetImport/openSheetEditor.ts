import { useMarkupEditorStore } from '../../../../model/useMarkupEditorStore';
import type { UserSheetRecord } from '../../../../model/userSheetsStorage.types';

import { loadSheetImage } from './analyzeSheetPhoto';

/**
 * Открывает редактор разметки на уже разобранном листе. Редактор открывается
 * сразу, с сохранённой разметкой, а каналы фотографии для магнитов приходят,
 * когда снимок декодируется: ждать их ради показа разметки незачем.
 *
 * Лист, закрытый до конца декодирования, каналы не получает — их не кладёт
 * стор редактора. Не декодировалась фотография — редактор работает без
 * магнитов.
 *
 * @param record — лист, который открывается
 */
export const openSheetEditor = async (record: UserSheetRecord): Promise<void> => {
  const { open, setImage } = useMarkupEditorStore.getState();
  const { id, src } = record.sheet;

  open(record);

  try {
    const image = await loadSheetImage({ src });

    if (image) {
      setImage(id, image);
    }
  } catch {
    /**
     * Магниты — удобство, а не условие правки: без каналов редактор
     * остаётся открытым с ручной правкой.
     */
  }
};
