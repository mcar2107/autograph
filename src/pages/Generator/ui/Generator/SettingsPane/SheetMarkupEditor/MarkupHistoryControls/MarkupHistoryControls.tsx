import { IconButton } from '@shared/ui/IconButton';
import { Toolbar, ToolbarItem } from '@shared/ui/Toolbar';
import type { FC } from 'react';

import {
  selectIsMarkupRedoAvailable,
  selectIsMarkupUndoAvailable,
  useMarkupEditorStore,
} from '../../../../../model/useMarkupEditorStore';
import { RedoIcon, UndoIcon } from '../../../HistoryIcons';

/**
 * Кнопки отмены и повтора правок разметки — те же, что в шапке генератора, но
 * над историей редактора: пока он открыт, правки генератора стоят, и кнопки
 * шапки под диалогом всё равно недоступны.
 *
 * Недоступная кнопка остаётся на месте: так видно, что отменять пока нечего,
 * и соседние кнопки подвала не прыгают.
 */
export const MarkupHistoryControls: FC = () => {
  const isUndoAvailable = useMarkupEditorStore(selectIsMarkupUndoAvailable);
  const isRedoAvailable = useMarkupEditorStore(selectIsMarkupRedoAvailable);
  const undo = useMarkupEditorStore((state) => {
    return state.undo;
  });
  const redo = useMarkupEditorStore((state) => {
    return state.redo;
  });

  const handleUndoClick = () => {
    undo();
  };

  const handleRedoClick = () => {
    redo();
  };

  return (
    <Toolbar label="История правок">
      <ToolbarItem>
        <IconButton
          label="Отменить"
          isDisabled={!isUndoAvailable}
          onClick={handleUndoClick}
        >
          <UndoIcon />
        </IconButton>
      </ToolbarItem>

      <ToolbarItem>
        <IconButton
          label="Повторить"
          isDisabled={!isRedoAvailable}
          onClick={handleRedoClick}
        >
          <RedoIcon />
        </IconButton>
      </ToolbarItem>
    </Toolbar>
  );
};
