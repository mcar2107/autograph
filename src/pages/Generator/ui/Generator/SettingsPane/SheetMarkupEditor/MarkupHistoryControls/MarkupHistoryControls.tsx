import { IconButton } from '@shared/ui/IconButton';
import { Toolbar, ToolbarItem } from '@shared/ui/Toolbar';
import type { FC } from 'react';

import {
  selectIsMarkupRedoAvailable,
  selectIsMarkupUndoAvailable,
  useMarkupEditorStore,
} from '../../../../../model/useMarkupEditorStore';

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
          <svg aria-hidden viewBox="0 0 16 16">
            <path
              d="M5 3 2 6l3 3M2 6h8a4 4 0 0 1 0 8H7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </IconButton>
      </ToolbarItem>

      <ToolbarItem>
        <IconButton
          label="Повторить"
          isDisabled={!isRedoAvailable}
          onClick={handleRedoClick}
        >
          <svg aria-hidden viewBox="0 0 16 16">
            <path
              d="m11 3 3 3-3 3m3-3H6a4 4 0 0 0 0 8h3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </IconButton>
      </ToolbarItem>
    </Toolbar>
  );
};
