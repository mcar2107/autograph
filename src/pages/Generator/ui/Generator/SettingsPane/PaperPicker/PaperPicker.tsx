import { Spinner } from '@shared/ui/Spinner';
import type { TileRadioOption } from '@shared/ui/TileRadio';
import { TileRadio } from '@shared/ui/TileRadio';
import type { ChangeEvent, FC } from 'react';
import { useId, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PaperFamily } from '../../../../lib/paper';
import { selectPageSheetId } from '../../../../model/recipeSelectors';
import { useGeneratorStore } from '../../../../model/useGeneratorStore';
import type { UserSheetRecord } from '../../../../model/userSheetsStorage.types';
import { openSheetEditor, useSheetImport } from '../useSheetImport';

import { OwnSheetTile } from './OwnSheetTile';
import { PAPER_TILE_CLASS_NAME } from './paperTileClassName';
import { renderSheetPreview } from './renderSheetPreview';

/**
 * Статус разбора добавленной фотографии.
 *
 * @param label — подпись листа
 * @returns текст статуса
 */
const formatImportStatus = (label: string): string => {
  return `Разбираем фото «${label}»… Обычно это занимает до\u00A0полуминуты, редактор разметки откроется сам.`;
};

/**
 * Плитки семей: изображение первого экземпляра и название семьи.
 *
 * @param families — предустановленные семьи листов
 * @returns варианты для `TileRadio`
 */
const toFamilyOptions = (families: PaperFamily[]): TileRadioOption[] => {
  return families.map(({ id, label, sheets }) => {
    return { value: id, label, preview: renderSheetPreview(sheets[0]) };
  });
};

/**
 * Свои листы выбранной семьи: плитки показывают только их, чужие семьи рецепт
 * на страницы этой не выдаёт.
 *
 * @param records — все загруженные пользователем листы
 * @param familyId — выбранная семья
 * @returns записи листов семьи в порядке добавления
 */
const listOwnSheets = (
  records: UserSheetRecord[],
  familyId: string
): UserSheetRecord[] => {
  return records.filter((record) => {
    return record.familyId === familyId;
  });
};

/**
 * Выбор бумаги: семьи плитками, в том же ряду — добавление своей фотографии
 * и свои листы семьи с кнопкой разметки.
 *
 * Выбор семьи снимает закрепление экземпляра — рецепт снова раздаёт листы по
 * страницам. Выбор своего листа закрепляет его: иначе добавленную фотографию
 * пришлось бы ждать, пока рецепт выдаст её какой-нибудь странице.
 */
export const PaperPicker: FC = () => {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    presetFamilies,
    userSheets,
    familyId,
    pageSheetId,
    hasUnsavedSheets,
    hasUndeletedSheets,
  } = useGeneratorStore(
    useShallow((state) => {
      return {
        presetFamilies: state.presetFamilies,
        userSheets: state.userSheets,
        familyId: state.familyId,
        pageSheetId: selectPageSheetId(state, state.pageIndex),
        hasUnsavedSheets: state.unsavedUserSheetIds.length > 0,
        hasUndeletedSheets: state.undeletedUserSheetIds.length > 0,
      };
    })
  );
  const selectFamily = useGeneratorStore((state) => {
    return state.selectFamily;
  });
  const selectSheet = useGeneratorStore((state) => {
    return state.selectSheet;
  });
  const sheetImport = useSheetImport();

  const activeFamily =
    presetFamilies.find(({ id }) => {
      return id === familyId;
    }) || presetFamilies[0];
  const ownSheets = activeFamily ? listOwnSheets(userSheets, activeFamily.id) : [];

  const handleFamilyChange = (value: string) => {
    selectFamily(value);
  };

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    /**
     * Тот же файл должен выбираться повторно — например, после ошибки.
     */
    event.target.value = '';

    if (!file || !activeFamily) {
      return;
    }

    void sheetImport.add(file, { family: activeFamily });
  };

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3
        id={titleId}
        className="text-xs font-semibold tracking-wider text-fg-muted uppercase"
      >
        Бумага
      </h3>

      {/**
       * Разбор идёт до полуминуты, и одного индикатора на плитке мало: статус
       * называет, что происходит и что будет дальше. Область стоит на месте и
       * пустая — появившаяся вместе с текстом читалкой часто не объявляется.
       */}
      <div className="flex flex-col">
        <div className="flex flex-wrap gap-2">
          <TileRadio
            label="Семья листов"
            value={activeFamily?.id || ''}
            options={toFamilyOptions(presetFamilies)}
            className="contents"
            onChange={handleFamilyChange}
          />

          {/**
           * Разбор фотографии показывает индикатор на месте плюса, а подпись
           * плитки не меняется: подпись другой длины переносилась бы на вторую
           * строку и двигала бы соседние плитки.
           */}
          <button
            type="button"
            disabled={sheetImport.isBusy}
            aria-busy={sheetImport.isBusy}
            className={PAPER_TILE_CLASS_NAME}
            onClick={handleAddClick}
          >
            <span
              aria-hidden="true"
              className="flex aspect-square w-full items-center justify-center rounded-sm bg-canvas text-lg"
            >
              {sheetImport.isBusy ? <Spinner /> : '+'}
            </span>

            <span>Своё фото</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Своя фотография листа"
            tabIndex={-1}
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>

        <div role="status" aria-atomic="true">
          {sheetImport.pendingLabel === null ? null : (
            <p className="mt-2 text-xs text-fg-muted">
              {formatImportStatus(sheetImport.pendingLabel)}
            </p>
          )}
        </div>
      </div>

      {sheetImport.error ? (
        <p role="alert" className="text-xs text-danger">
          {sheetImport.error}
        </p>
      ) : null}

      {/**
       * Причину отказа хранилище не называет, поэтому сообщение перечисляет обе:
       * исчерпанную квоту и запрет хранения данных сайта.
       */}
      {hasUnsavedSheets ? (
        <p role="alert" className="text-xs text-danger">
          Лист не сохранится после перезагрузки: браузеру не хватает места или хранение
          данных сайта запрещено.
        </p>
      ) : null}

      {hasUndeletedSheets ? (
        <p role="alert" className="text-xs text-danger">
          Удалённый лист вернётся после перезагрузки: браузер не дал убрать его из
          хранилища.
        </p>
      ) : null}

      {ownSheets.length > 0 ? (
        <ul aria-label="Свои листы" className="flex flex-wrap gap-2">
          {ownSheets.map((record) => {
            const { sheet } = record;
            const { id } = sheet;

            const handleSheetSelect = () => {
              selectSheet(id);
            };

            const handleMarkupOpen = () => {
              void openSheetEditor(record);
            };

            return (
              <li key={id}>
                <OwnSheetTile
                  sheet={sheet}
                  isSelected={id === pageSheetId}
                  isMarkupDisabled={sheetImport.isBusy}
                  onSelect={handleSheetSelect}
                  onMarkupOpen={handleMarkupOpen}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};
