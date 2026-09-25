import { cx } from '@shared/lib/styles';
import { IconButton } from '@shared/ui/IconButton';
import { Spinner } from '@shared/ui/Spinner';
import type { TileRadioOption } from '@shared/ui/TileRadio';
import { TileRadio } from '@shared/ui/TileRadio';
import { Tooltip } from '@shared/ui/Tooltip';
import type { ChangeEvent, FC } from 'react';
import { useId, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PaperFamily, PaperSheet } from '../../../../lib/paper';
import { selectPageSheetId } from '../../../../model/recipeSelectors';
import { useGeneratorStore } from '../../../../model/useGeneratorStore';
import type { UserSheetRecord } from '../../../../model/userSheetsStorage.types';
import { openSheetEditor, useSheetImport } from '../useSheetImport';

import { truncateMiddle } from './truncateMiddle';

/**
 * Классы плитки — те же, что у плиток семей в `TileRadio`: свои листы и
 * добавление стоят с ними в одном ряду и не должны отличаться формой.
 */
const TILE_CLASS_NAME =
  'flex w-16 cursor-pointer flex-col items-center gap-1 rounded-md border border-border bg-surface-raised p-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Сколько символов подписи своего листа помещается под превью шириной в
 * плитку: `IMG_1813` не помещается, а `IM…813` — да.
 */
const OWN_SHEET_LABEL_LENGTH = 6;

/**
 * Превью листа в плитке. Подпись плитки рядом, поэтому картинка —
 * декоративная.
 *
 * @param sheet — экземпляр, фотография которого показывается
 * @returns картинка, заполняющая квадрат плитки
 */
const renderSheetPreview = (sheet: PaperSheet | undefined) => {
  if (!sheet) {
    return null;
  }

  return <img src={sheet.src} alt="" className="size-full object-cover" />;
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
  const { presetFamilies, userSheets, familyId, pageSheetId, hasUnsavedSheets } =
    useGeneratorStore(
      useShallow((state) => {
        return {
          presetFamilies: state.presetFamilies,
          userSheets: state.userSheets,
          familyId: state.familyId,
          pageSheetId: selectPageSheetId(state, state.pageIndex),
          hasUnsavedSheets: state.unsavedUserSheetIds.length > 0,
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
          className={TILE_CLASS_NAME}
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

      {ownSheets.length > 0 ? (
        <ul aria-label="Свои листы" className="flex flex-wrap gap-2">
          {ownSheets.map((record) => {
            const { sheet } = record;
            const { id, label } = sheet;
            const isSelected = id === pageSheetId;

            const handleSheetClick = () => {
              selectSheet(id);
            };

            const handleMarkupClick = () => {
              void openSheetEditor(record);
            };

            return (
              <li key={id} className="relative">
                {/**
                 * Подпись под превью обрезана, поэтому полное имя — в
                 * доступном имени и в подсказке.
                 */}
                <Tooltip content={label}>
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={isSelected}
                    className={cx(
                      TILE_CLASS_NAME,
                      'aria-pressed:border-accent aria-pressed:text-fg'
                    )}
                    onClick={handleSheetClick}
                  >
                    <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm bg-canvas">
                      {renderSheetPreview(sheet)}
                    </span>

                    <span className="w-full truncate">
                      {truncateMiddle(label, OWN_SHEET_LABEL_LENGTH)}
                    </span>
                  </button>
                </Tooltip>

                {/**
                 * Пока разбирается новая фотография, разметка недоступна: по
                 * концу разбора редактор откроется на новом листе и сменил бы
                 * открытый с правками. Подложка держит значок на светлом
                 * снимке, размер — цель для пальца.
                 */}
                <IconButton
                  label={`Разметка листа «${label}»`}
                  isDisabled={sheetImport.isBusy}
                  className="absolute top-0 right-0 border border-border-strong bg-surface/90 text-fg shadow-popover [&_svg]:size-5"
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
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};
