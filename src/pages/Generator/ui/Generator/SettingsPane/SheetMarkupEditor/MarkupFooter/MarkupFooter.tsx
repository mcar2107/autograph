import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useState } from 'react';

import type { MarkupFooterProps } from './MarkupFooter.types';

/**
 * Действия редактора над листом целиком. Удаление — отдельное действие с
 * подтверждением и применяется сразу, в обход «Сохранить»: лист пропадает
 * из выбора бумаги и из хранилища.
 */
export const MarkupFooter: FC<MarkupFooterProps> = (props) => {
  const { sheetLabel, onReset, onDelete, onCancel, onSave } = props;
  const [isDeleteConfirming, setDeleteConfirming] = useState(false);

  const handleResetClick = () => {
    onReset();
  };

  const handleDeleteClick = () => {
    setDeleteConfirming(true);
  };

  const handleDeleteConfirmClick = () => {
    onDelete();
  };

  const handleDeleteCancelClick = () => {
    setDeleteConfirming(false);
  };

  const handleCancelClick = () => {
    onCancel();
  };

  const handleSaveClick = () => {
    onSave();
  };

  return (
    <div className="flex flex-col gap-3">
      {isDeleteConfirming ? (
        <div
          role="group"
          aria-label="Подтверждение удаления"
          className="flex flex-col gap-2 rounded-md border border-danger p-3"
        >
          <p className="text-sm text-fg">
            Удалить «{sheetLabel}» из бумаги и из хранилища браузера?
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleDeleteConfirmClick}>
              Да, удалить
            </Button>

            <Button variant="ghost" onClick={handleDeleteCancelClick}>
              Не удалять
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={handleResetClick}>
          Сбросить к найденному
        </Button>

        <Button
          variant="ghost"
          isDisabled={isDeleteConfirming}
          onClick={handleDeleteClick}
        >
          Удалить лист
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleCancelClick}>
          Отмена
        </Button>

        <Button onClick={handleSaveClick}>Сохранить</Button>
      </div>
    </div>
  );
};
