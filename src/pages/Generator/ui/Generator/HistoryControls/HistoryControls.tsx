import { IconButton } from '@shared/ui/IconButton';
import { Toolbar, ToolbarItem } from '@shared/ui/Toolbar';
import type { FC } from 'react';

import {
  selectIsRedoAvailable,
  selectIsUndoAvailable,
  useGeneratorStore,
} from '../../../model/useGeneratorStore';
import { RedoIcon, UndoIcon } from '../HistoryIcons';

/**
 * Кнопки отмены и повтора правок для шапки экрана. Недоступная кнопка
 * остаётся на месте: так видно, что отменять пока нечего.
 */
export const HistoryControls: FC = () => {
  const isUndoAvailable = useGeneratorStore(selectIsUndoAvailable);
  const isRedoAvailable = useGeneratorStore(selectIsRedoAvailable);
  const undo = useGeneratorStore((state) => {
    return state.undo;
  });
  const redo = useGeneratorStore((state) => {
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
