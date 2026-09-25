import { cx } from '@shared/lib/styles';
import { IconButton } from '@shared/ui/IconButton';
import { Tooltip } from '@shared/ui/Tooltip';
import type { FC } from 'react';

import { PAPER_TILE_CLASS_NAME } from '../paperTileClassName';
import { renderSheetPreview } from '../renderSheetPreview';

import type { OwnSheetTileProps } from './OwnSheetTile.types';
import { useFittedLabel } from './useFittedLabel';

/**
 * Плитка своего листа: превью с подписью — выбор листа, в углу — кнопка
 * разметки.
 *
 * Подпись идёт в две строки с переносом по любому знаку: имена снимков — одно
 * длинное слово, и перенос по словам оставил бы его обрезанным. Имя целиком,
 * если встаёт; длиннее — обрезано с середины, по концу имени снимки и
 * различаются. Видимая подпись входит в доступное имя плитки: голосом
 * выбирают то, что видно.
 */
export const OwnSheetTile: FC<OwnSheetTileProps> = (props) => {
  const { sheet, isSelected, isMarkupDisabled, onSelect, onMarkupOpen } = props;
  const { label } = sheet;
  const { ref, text } = useFittedLabel(label);
  const name = text === label ? label : `${text} (${label})`;

  const handleTileClick = () => {
    onSelect();
  };

  const handleMarkupClick = () => {
    onMarkupOpen();
  };

  return (
    <>
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={name}
          aria-pressed={isSelected}
          className={cx(
            PAPER_TILE_CLASS_NAME,
            'aria-pressed:border-accent aria-pressed:text-fg'
          )}
          onClick={handleTileClick}
        >
          <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm bg-canvas">
            {renderSheetPreview(sheet)}
          </span>

          <span ref={ref} className="line-clamp-2 w-full break-all">
            {text}
          </span>
        </button>
      </Tooltip>

      {/**
       * Пока разбирается новая фотография, разметка недоступна: по концу
       * разбора редактор откроется на новом листе и сменил бы открытый с
       * правками. Подложка держит значок на светлом снимке; цель — 32 px под
       * мышь и 44 px под палец.
       */}
      <IconButton
        label={`Разметка листа «${label}»`}
        isDisabled={isMarkupDisabled}
        className="absolute top-0 right-0 border border-border-strong bg-surface/90 text-fg shadow-popover pointer-coarse:size-11 [&_svg]:size-5"
        onClick={handleMarkupClick}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />

          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </IconButton>
    </>
  );
};
