import { Dialog } from '@shared/ui/Dialog';
import type { FC } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useMarkupEditorStore } from '../../../../model/useMarkupEditorStore';

import { MarkupEditorContent } from './MarkupEditorContent';

/**
 * Диалог на весь экран: фотографию листа нужно разглядывать до пикселя, а в
 * окне обычного диалога она уменьшилась бы до превью.
 */
const FULLSCREEN_CLASS_NAME =
  'top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-0 overflow-hidden rounded-none p-4';

/**
 * Редактор разметки своего листа: фотография с разметкой поверх неё и
 * инструменты её правки.
 *
 * Открывается сам после каждого импорта фотографии и кнопкой настройки на
 * плитке листа — оба пути идут через стор редактора, поэтому экземпляр один.
 * Правки ложатся на лист только по «Сохранить»; закрытие без сохранения
 * оставляет лист как был, в том числе с разметкой автомата после импорта, а
 * при несохранённых правках сначала спрашивает подтверждение.
 */
export const SheetMarkupEditor: FC = () => {
  const { record, draft } = useMarkupEditorStore(
    useShallow((state) => {
      return { record: state.record, draft: state.draft };
    })
  );
  const requestClose = useMarkupEditorStore((state) => {
    return state.requestClose;
  });

  /**
   * Esc, «Закрыть» и клик мимо — та же просьба закрыть, что и «Отмена»: с
   * несохранёнными правками редактор сначала спрашивает.
   */
  const handleDialogOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      requestClose();
    }
  };

  return (
    <Dialog
      isOpen={Boolean(record && draft)}
      title={`Разметка листа «${record?.sheet.label || ''}»`}
      description="Разметка, найденная на фотографии. Правки применяются к листу по «Сохранить»."
      className={FULLSCREEN_CLASS_NAME}
      onOpenChange={handleDialogOpenChange}
    >
      {record && draft ? (
        <MarkupEditorContent key={record.sheet.id} record={record} draft={draft} />
      ) : null}
    </Dialog>
  );
};
