import { Button } from '@shared/ui/Button';
import type { FC } from 'react';

import { MarkupHistoryControls } from '../MarkupHistoryControls';

import type { MarkupFooterProps } from './MarkupFooter.types';

/**
 * Подвал панели редактора: история, сброс и выход. Каркас держит его вне
 * прокрутки панели — нужен он при любом инструменте и любой высоте окна.
 * Удаления листа здесь нет: его не отменить, и рядом со «Сохранить» оно
 * стояло бы под рукой.
 */
export const MarkupFooter: FC<MarkupFooterProps> = (props) => {
  const { onReset, onCancel, isSaveDisabled, onSave } = props;

  const handleResetClick = () => {
    onReset();
  };

  const handleCancelClick = () => {
    onCancel();
  };

  const handleSaveClick = () => {
    onSave();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <MarkupHistoryControls />

        <Button variant="ghost" onClick={handleResetClick}>
          Сбросить к найденному
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleCancelClick}>
          Отмена
        </Button>

        <Button isDisabled={isSaveDisabled} onClick={handleSaveClick}>
          Сохранить
        </Button>
      </div>
    </div>
  );
};
