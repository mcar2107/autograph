import {
  deleteRecord,
  getAllRecords,
  openDatabase,
  putRecord,
  runTransaction,
  SHEETS_STORE,
} from './indexedDb';
import { parseStoredUserSheet } from './paperSheetJson';
import type { StoredUserSheet, UserSheetRecord } from './userSheetsStorage.types';
import {
  clearLegacyUserSheets,
  readLegacyUserSheets,
  removeLegacyUserSheets,
} from './userSheetsStorageLegacy';
import { migrateLegacyUserSheets } from './userSheetsStorageMigration';
import {
  dataUrlToBlob,
  resolveFamilyKind,
  toStoredUserSheet,
} from './userSheetsStorageRecord';

/**
 * Хвост очереди операций хранилища. Операции идут строго по одной в порядке
 * вызова: стор пишет лист, не дожидаясь записи, и чтение, начатое следом,
 * должно её увидеть, а удаление — не обогнать запись того же листа.
 */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Object URL листов по идентификатору листа: фотография и карта текстуры.
 * Освобождаются при удалении листа. Повторное чтение прежние адреса не
 * освобождает: их ещё может держать лист в сторе, и его запись искала бы файл
 * по уже отозванному адресу.
 */
const sheetUrls = new Map<string, string[]>();

/**
 * Файлы за выданными object URL: лист, прочитанный из базы, несёт в `src`
 * адрес, а при повторной записи нужен сам файл.
 */
const urlFiles = new Map<string, Blob>();

/**
 * Дожидается операции, не пропуская её отказ дальше: хвост очереди не должен
 * отклоняться, иначе сбой одной операции отменил бы все поставленные за ней.
 *
 * @param operation — операция в очереди
 * @returns исполняется по концу операции, удачному или нет
 */
const settle = async (operation: Promise<unknown>): Promise<void> => {
  try {
    await operation;
  } catch {
    /**
     * Отказ получает тот, кто ставил операцию, — очереди он не касается.
     */
  }
};

/**
 * Ставит операцию в очередь хранилища. Сбой операции очередь не рвёт.
 *
 * @param operation — операция
 * @returns результат операции
 */
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = queueTail;
  const result = (async () => {
    await previous;

    return await operation();
  })();

  queueTail = settle(result);

  return result;
};

/**
 * Выполняет работу с открытой базой и закрывает соединение после неё.
 *
 * @param run — работа с базой
 * @returns результат работы
 */
const withDatabase = async <T>(
  run: (database: IDBDatabase) => Promise<T>
): Promise<T> => {
  const database = await openDatabase();

  try {
    return await run(database);
  } finally {
    database.close();
  }
};

/**
 * Выдаёт object URL файла листа и запоминает его для освобождения.
 *
 * @param sheetId — идентификатор листа
 * @param file — файл
 * @returns адрес файла
 */
const createSheetUrl = (sheetId: string, file: Blob): string => {
  const url = URL.createObjectURL(file);

  sheetUrls.set(sheetId, [...(sheetUrls.get(sheetId) || []), url]);
  urlFiles.set(url, file);

  return url;
};

/**
 * Освобождает object URL листа.
 *
 * @param sheetId — идентификатор листа
 */
const revokeSheetUrls = (sheetId: string): void => {
  for (const url of sheetUrls.get(sheetId) || []) {
    URL.revokeObjectURL(url);
    urlFiles.delete(url);
  }

  sheetUrls.delete(sheetId);
};

/**
 * Адрес фотографии только что выбранного листа. Object URL, а не data URL:
 * файл уже в руках, и запись листа берёт его по адресу без повторного
 * декодирования base64 в основном потоке, а строка в сторе не весит на треть
 * больше снимка. Освобождается вместе с листом — `deleteUserSheet` — или
 * `releaseUserSheetUrls`, если лист так и не добавился.
 *
 * @param sheetId — идентификатор нового листа
 * @param file — файл фотографии
 * @returns адрес файла
 */
export const createUserSheetUrl = (sheetId: string, file: Blob): string => {
  return createSheetUrl(sheetId, file);
};

/**
 * Освобождает адреса листа, который в стор не попал: импорт сорвался после
 * того, как адрес фотографии уже выдан.
 *
 * @param sheetId — идентификатор листа
 */
export const releaseUserSheetUrls = (sheetId: string): void => {
  revokeSheetUrls(sheetId);
};

/**
 * Файл по адресу из листа стора: выданный хранилищем object URL, data URL
 * свежего импорта или иной адрес, который браузер умеет прочитать.
 *
 * @param src — адрес файла
 * @returns файл; `null` — прочитать не удалось
 */
const resolveFile = async (src: string): Promise<Blob | null> => {
  const file = urlFiles.get(src) || dataUrlToBlob(src);

  if (file) {
    return file;
  }

  try {
    const response = await fetch(src);

    return await response.blob();
  } catch {
    return null;
  }
};

/**
 * Лист стора из записи базы: файлы становятся object URL. Лист из хранилища
 * всегда посчитан — повторный анализ по нему не запускается.
 *
 * @param stored — запись базы
 * @returns лист стора
 */
const toUserSheetRecord = (stored: StoredUserSheet): UserSheetRecord => {
  const {
    id,
    familyId,
    kind,
    label,
    width,
    height,
    ruling,
    measuredRuling,
    measuredKind,
    pins,
    lighting,
    texture,
  } = stored;

  const src = createSheetUrl(id, stored.source);

  return {
    familyId,
    isAnalyzed: true,
    kind,
    measuredRuling,
    measuredKind,
    pins,
    sheet: {
      id,
      label,
      src,
      width,
      height,
      ruling,
      lighting,
      texture: texture && {
        src: createSheetUrl(id, texture.image),
        width: texture.width,
        height: texture.height,
        amplitude: texture.amplitude,
      },
    },
  };
};

/**
 * Разбирает записи базы. Нечитаемая запись пропускается, а не роняет список.
 *
 * @param records — записи базы как есть
 * @returns листы стора по порядку ключей
 */
const toUserSheetRecords = (records: unknown[]): UserSheetRecord[] => {
  return records.reduce<UserSheetRecord[]>((acc, record) => {
    const stored = parseStoredUserSheet(record, resolveFamilyKind);

    if (stored) {
      acc.push(toUserSheetRecord(stored));
    }

    return acc;
  }, []);
};

/**
 * Читает свои листы вместе с характеристиками и разметкой. Листы, лежащие
 * ещё в строковом хранилище прежних версий, сначала переносятся в IndexedDB;
 * не перенесённые показываются до конца сессии.
 *
 * Без IndexedDB (запрет данных сайта) читается только прежнее хранилище.
 *
 * @returns листы по порядку идентификаторов
 */
export const readUserSheets = (): Promise<UserSheetRecord[]> => {
  return enqueue(async () => {
    try {
      return await withDatabase(async (database) => {
        const pending = await migrateLegacyUserSheets(database);
        const stored = toUserSheetRecords(await getAllRecords(database, SHEETS_STORE));
        const storedIds = new Set(
          stored.map(({ sheet }) => {
            return sheet.id;
          })
        );

        return [
          ...stored,
          ...pending.filter(({ sheet }) => {
            return !storedIds.has(sheet.id);
          }),
        ];
      });
    } catch {
      return readLegacyUserSheets();
    }
  });
};

/**
 * Сохраняет лист одной записью: фотография и карта текстуры — файлами, рядом
 * характеристики и разметка листа в памяти, включая найденную автоматом. Лист
 * с тем же идентификатором перезаписывается.
 *
 * @param record — лист стора
 * @returns удалось ли сохранить; `false` — хранилища нет, оно переполнено
 * или фотографию не удалось прочитать
 */
export const writeUserSheet = (record: UserSheetRecord): Promise<boolean> => {
  return enqueue(async () => {
    const { sheet } = record;
    const source = await resolveFile(sheet.src);

    if (!source) {
      return false;
    }

    const textureImage = sheet.texture ? await resolveFile(sheet.texture.src) : null;

    try {
      await withDatabase((database) => {
        return putRecord(
          database,
          SHEETS_STORE,
          toStoredUserSheet(record, source, textureImage)
        );
      });

      return true;
    } catch {
      return false;
    }
  });
};

/**
 * Убирает лист из хранилища и освобождает его object URL. Лист прежнего
 * хранилища, не перенесённый из-за сбоя, убирается и оттуда.
 *
 * @param sheetId — идентификатор экземпляра
 * @returns удалось ли убрать; `false` — база открылась, но удаление в ней
 * сорвалось, и после перезагрузки лист вернётся. Без базы — `true`: лист жил
 * только в памяти сессии, и удалять в хранилище нечего.
 */
export const deleteUserSheet = (sheetId: string): Promise<boolean> => {
  return enqueue(async () => {
    removeLegacyUserSheets([sheetId]);
    revokeSheetUrls(sheetId);

    let database: IDBDatabase;

    try {
      database = await openDatabase();
    } catch {
      return true;
    }

    try {
      await deleteRecord(database, SHEETS_STORE, sheetId);

      return true;
    } catch {
      return false;
    } finally {
      database.close();
    }
  });
};

/**
 * Убирает все свои листы из обоих хранилищ. Нужен тестам и сбросу состояния.
 */
export const clearUserSheets = (): Promise<void> => {
  return enqueue(async () => {
    clearLegacyUserSheets();

    for (const sheetId of [...sheetUrls.keys()]) {
      revokeSheetUrls(sheetId);
    }

    try {
      await withDatabase((database) => {
        return runTransaction(database, [SHEETS_STORE], 'readwrite', (transaction) => {
          transaction.objectStore(SHEETS_STORE).clear();
        });
      });
    } catch {
      /**
       * Без базы очищать нечего.
       */
    }
  });
};
