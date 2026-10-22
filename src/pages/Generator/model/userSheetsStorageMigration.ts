import { runTransaction, SHEETS_STORE } from './indexedDb';
import type { StoredUserSheet, UserSheetRecord } from './userSheetsStorage.types';
import { readLegacyUserSheets, removeLegacyUserSheets } from './userSheetsStorageLegacy';
import { dataUrlToBlob, toStoredUserSheet } from './userSheetsStorageRecord';

/**
 * Имя ошибки IndexedDB, когда запись с таким ключом уже есть.
 */
const CONSTRAINT_ERROR = 'ConstraintError';

/**
 * Запись прежнего хранилища в форме IndexedDB. Фотография и карта текстуры
 * лежали data URL-ами и становятся файлами; разметки, которой в прежней форме
 * не было, получают дефолты.
 *
 * @param record — лист прежнего хранилища
 * @returns запись; `null` — фотография не декодируется, переносить нечего
 */
const toMigratedSheet = (record: UserSheetRecord): StoredUserSheet | null => {
  const source = dataUrlToBlob(record.sheet.src);

  if (!source) {
    return null;
  }

  const textureImage = record.sheet.texture
    ? dataUrlToBlob(record.sheet.texture.src)
    : null;

  return toStoredUserSheet(record, source, textureImage);
};

/**
 * Переносит листы из строкового хранилища в IndexedDB одной транзакцией.
 * Прежние ключи удаляются только после её фиксации: сбой оставляет их как
 * есть, и следующий запуск повторяет перенос.
 *
 * Перенос идемпотентен: запись с уже существующим идентификатором не
 * перезаписывается — она новее, её могли поправить после прошлого переноса, а
 * прежние ключи могла снова записать старая версия в соседней вкладке.
 *
 * @param database — открытая база
 * @returns прежние листы, которые остались в строковом хранилище: их
 * показывают до конца сессии, чтобы сбой переноса не прятал листы
 */
export const migrateLegacyUserSheets = async (
  database: IDBDatabase
): Promise<UserSheetRecord[]> => {
  const legacy = readLegacyUserSheets();

  if (legacy.length === 0) {
    return [];
  }

  const migrated = legacy.reduce<StoredUserSheet[]>((acc, record) => {
    const stored = toMigratedSheet(record);

    if (stored) {
      acc.push(stored);
    }

    return acc;
  }, []);

  try {
    await runTransaction(database, [SHEETS_STORE], 'readwrite', (transaction) => {
      const store = transaction.objectStore(SHEETS_STORE);

      for (const stored of migrated) {
        const request = store.add(stored);

        /**
         * Уже перенесённая запись — не сбой: без отмены действия по умолчанию
         * ошибка одной записи отменила бы всю транзакцию.
         */
        request.onerror = (event) => {
          if (request.error?.name === CONSTRAINT_ERROR) {
            event.preventDefault();
          }
        };
      }
    });
  } catch {
    return legacy;
  }

  const migratedIds = new Set(
    migrated.map(({ id }) => {
      return id;
    })
  );

  removeLegacyUserSheets([...migratedIds]);

  return legacy.filter(({ sheet }) => {
    return !migratedIds.has(sheet.id);
  });
};
