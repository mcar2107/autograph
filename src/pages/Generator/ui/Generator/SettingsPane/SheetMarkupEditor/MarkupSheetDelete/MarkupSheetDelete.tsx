import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useRef, useState } from 'react';

import { useFocusOnShow } from '../useFocusOnShow';

import type { MarkupSheetDeleteProps } from './MarkupSheetDelete.types';

/**
 * Удаление листа — отдельно от действий над разметкой и в конце панели, а не в
 * подвале рядом со «Сбросить к найденному» и «Сохранить»: оно не отменяется,
 * применяется сразу, в обход «Сохранить», и лист пропадает из выбора бумаги и
 * из хранилища.
 *
 * Подтверждение встаёт на место кнопки и забирает фокус: так оно видно и в
 * прокрученной панели, а первый Tab ведёт к ответам.
 */
export const MarkupSheetDelete: FC<MarkupSheetDeleteProps> = (props) => {
  const { sheetLabel, onDelete } = props;
  const [isDeleteConfirming, setDeleteConfirming] = useState(false);
  /**
   * Подтверждение закрыли отказом: фокус возвращается на «Удалить лист», а не
   * пропадает вместе с ответами. При открытии редактора кнопка фокус не
   * забирает.
   */
  const [isDeleteDeclined, setDeleteDeclined] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useFocusOnShow(groupRef, isDeleteConfirming);
  useFocusOnShow(deleteRef, isDeleteDeclined && !isDeleteConfirming);

  const handleDeleteClick = () => {
    setDeleteConfirming(true);
    setDeleteDeclined(false);
  };

  const handleDeleteConfirmClick = () => {
    onDelete();
  };

  const handleDeleteCancelClick = () => {
    setDeleteConfirming(false);
    setDeleteDeclined(true);
  };

  if (!isDeleteConfirming) {
    return (
      <div className="flex">
        <Button ref={deleteRef} variant="danger" onClick={handleDeleteClick}>
          Удалить лист
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Подтверждение удаления"
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md border border-danger p-3 focus:outline-none"
    >
      <p className="text-sm text-fg">
        Удалить «{sheetLabel}» из&nbsp;бумаги и&nbsp;из&nbsp;хранилища браузера?
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={handleDeleteConfirmClick}>
          Да, удалить
        </Button>

        <Button variant="ghost" onClick={handleDeleteCancelClick}>
          Не удалять
        </Button>
      </div>
    </div>
  );
};
