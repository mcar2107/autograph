import { Dialog } from '@shared/ui/Dialog';
import type { FC } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PaperMargins, RulingKind } from '../../../../lib/paper';
import { deriveRulingPins } from '../../../../lib/paper';
import { findFamily } from '../../../../model/paperSelectors';
import { useGeneratorStore } from '../../../../model/useGeneratorStore';
import { useManualRulingRequest } from '../useSheetImport';
import { useSheetRemeasure } from '../useSheetRemeasure';

import type { SheetDialogProps } from './SheetDialog.types';
import { SheetDialogForm } from './SheetDialogForm';
import type { ManualRuling } from './sheetDraft';
import { buildEditedRuling } from './sheetDraft';

/**
 * Вид листа после правки в диалоге: диалог знает только «без разлиновки», а
 * вид листа с разлиновкой сохраняет — предложенный снимком, а не семьёй.
 * Лист, с которого сняли «без разлиновки», получает вид своей семьи.
 *
 * @param kind — вид листа до правки
 * @param isBlank — отмечено ли «без разлиновки»
 * @param familyKind — вид семьи листа
 * @returns вид листа после правки
 */
const toEditedKind = (
  kind: RulingKind,
  isBlank: boolean,
  familyKind: RulingKind
): RulingKind => {
  if (isBlank) {
    return 'blank';
  }

  return kind === 'blank' ? familyKind : kind;
};

/**
 * Диалог своего листа: фотография, границы листа на ней и разлиновка.
 *
 * Открывается кнопкой настройки на плитке листа и сам — когда на добавленной
 * фотографии автоопределение не нашло разлиновки. Правка разлиновки ложится
 * на лист только по «Сохранить»; перемер и удаление — отдельные действия со
 * своими кнопками и применяются сразу.
 */
export const SheetDialog: FC<SheetDialogProps> = (props) => {
  const { sheetId, onSheetIdChange } = props;
  const { record, presetFamilies } = useGeneratorStore(
    useShallow((state) => {
      return {
        record: state.userSheets.find(({ sheet }) => {
          return sheet.id === sheetId;
        }),
        presetFamilies: state.presetFamilies,
      };
    })
  );
  const saveSheetMarkup = useGeneratorStore((state) => {
    return state.saveSheetMarkup;
  });
  const removeUserSheet = useGeneratorStore((state) => {
    return state.removeUserSheet;
  });
  const sheetRemeasure = useSheetRemeasure(record?.sheet.id || '');

  useManualRulingRequest(onSheetIdChange);

  const family = record ? findFamily(presetFamilies, record.familyId) : undefined;

  const close = () => {
    onSheetIdChange(null);
  };

  const handleDialogOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      close();
    }
  };

  const handleRemeasure = (bounds: PaperMargins, isBlank: boolean) => {
    if (!record || !family) {
      return;
    }

    void sheetRemeasure.remeasure({
      family,
      sheet: record.sheet,
      kind: toEditedKind(record.kind, isBlank, family.kind),
      bounds,
    });
  };

  const handleSave = (manual: ManualRuling, isBlank: boolean) => {
    if (!record || !family) {
      return;
    }

    const { sheet } = record;
    const ruling = buildEditedRuling(sheet, manual);

    /**
     * Булавки выводятся из правленой разлиновки: шаг и фаза из формы уводят
     * гребёнку от прежних булавок. Найденная автоматом разлиновка остаётся
     * прежней — её хранит стор.
     */
    saveSheetMarkup(sheet.id, {
      ruling,
      pins: deriveRulingPins(ruling, sheet),
      kind: toEditedKind(record.kind, isBlank, family.kind),
    });
    close();
  };

  const handleDelete = () => {
    if (record) {
      removeUserSheet(record.sheet.id);
    }

    close();
  };

  const handleCancel = () => {
    close();
  };

  return (
    <Dialog
      isOpen={Boolean(record)}
      title={`Лист «${record?.sheet.label || ''}»`}
      description="Границы листа на фотографии и его разлиновка."
      onOpenChange={handleDialogOpenChange}
    >
      {record ? (
        <SheetDialogForm
          /**
           * Черновик берёт начальные значения из листа один раз, поэтому форма
           * пересоздаётся и по смене листа, и по перемеру: иначе после перемера
           * она показывала бы введённое до него, а не измеренное заново.
           */
          key={`${record.sheet.id}:${sheetRemeasure.revision}`}
          sheet={record.sheet}
          isBlank={record.kind === 'blank'}
          isRemeasuring={sheetRemeasure.isBusy}
          remeasureError={sheetRemeasure.error}
          onRemeasure={handleRemeasure}
          onSave={handleSave}
          onDelete={handleDelete}
          onCancel={handleCancel}
        />
      ) : null}
    </Dialog>
  );
};
