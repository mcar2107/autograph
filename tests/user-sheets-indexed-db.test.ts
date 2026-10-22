// @vitest-environment jsdom

import {
  deleteRecord,
  getAllRecords,
  openDatabase,
  putRecord,
  runTransaction,
  SHEETS_STORE,
} from '@pages/Generator/model/indexedDb';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Фотография как её хранит база: тип файла и байты должны вернуться те же.
 */
const PHOTO_BYTES = 'jpeg-bytes-0123456789';

/**
 * Запись со своими полями и файлом внутри: база хранит её целиком.
 */
type StoredEntry = {
  /**
   * Ключ записи.
   */
  id: string;

  /**
   * Подпись: по ней видно, какая из записей с одним ключом осталась.
   */
  label: string;

  /**
   * Файл фотографии.
   */
  source: Blob;
};

/**
 * Проверяет, что из базы пришла запись нужной формы.
 *
 * @param value — прочитанное значение
 * @returns признак записи с файлом
 */
const isStoredEntry = (value: unknown): value is StoredEntry => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'source' in value &&
    value.source instanceof Blob
  );
};

/**
 * Прочитанные записи по порядку ключей.
 *
 * @returns записи хранилища листов
 */
const readEntries = async (): Promise<StoredEntry[]> => {
  const database = await openDatabase();

  try {
    const records = await getAllRecords(database, SHEETS_STORE);

    return records.filter(isStoredEntry);
  } finally {
    database.close();
  }
};

/**
 * Запись листа с фотографией.
 *
 * @param id — ключ записи
 * @returns запись
 */
const buildEntry = (id: string): StoredEntry => {
  return {
    id,
    label: `Лист ${id}`,
    source: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
  };
};

/**
 * Ключ записи — для сверки состава хранилища.
 *
 * @param entry — запись
 * @returns ключ
 */
const toId = ({ id }: StoredEntry): string => {
  return id;
};

/**
 * Подпись записи.
 *
 * @param entry — запись
 * @returns подпись
 */
const toLabel = ({ label }: StoredEntry): string => {
  return label;
};

describe('обёртка IndexedDB', () => {
  const originalFactory = globalThis.indexedDB;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    globalThis.indexedDB = originalFactory;
  });

  it('записанный Blob читается новым соединением с тем же типом и байтами', async () => {
    const database = await openDatabase();

    await putRecord(database, SHEETS_STORE, buildEntry('a'));
    database.close();

    const [entry] = await readEntries();

    expect(entry?.id).toBe('a');
    expect(entry?.label).toBe('Лист a');
    expect(entry?.source.type).toBe('image/jpeg');
    expect(await entry?.source.text()).toBe(PHOTO_BYTES);
  });

  it('запись с тем же ключом заменяет прежнюю, а не дублирует', async () => {
    const database = await openDatabase();

    await putRecord(database, SHEETS_STORE, buildEntry('a'));
    await putRecord(database, SHEETS_STORE, { ...buildEntry('a'), label: 'Новый' });
    database.close();

    const entries = await readEntries();

    expect(entries.map(toLabel)).toEqual(['Новый']);
  });

  it('удаление убирает только свою запись', async () => {
    const database = await openDatabase();

    await putRecord(database, SHEETS_STORE, buildEntry('a'));
    await putRecord(database, SHEETS_STORE, buildEntry('b'));
    await deleteRecord(database, SHEETS_STORE, 'a');
    database.close();

    const entries = await readEntries();

    expect(entries.map(toId)).toEqual(['b']);
  });

  it('транзакция пишет все записи разом и завершается после complete', async () => {
    const database = await openDatabase();

    await runTransaction(database, [SHEETS_STORE], 'readwrite', (transaction) => {
      const store = transaction.objectStore(SHEETS_STORE);

      store.put(buildEntry('a'));
      store.put(buildEntry('b'));
    });
    database.close();

    const entries = await readEntries();

    expect(entries.map(toId)).toEqual(['a', 'b']);
  });

  it('сбой одной операции отменяет транзакцию целиком и отклоняет промис', async () => {
    const database = await openDatabase();

    await putRecord(database, SHEETS_STORE, buildEntry('a'));

    const transactionResult = runTransaction(
      database,
      [SHEETS_STORE],
      'readwrite',
      (transaction) => {
        const store = transaction.objectStore(SHEETS_STORE);

        store.put(buildEntry('b'));
        store.add(buildEntry('a'));
      }
    );

    await expect(transactionResult).rejects.toMatchObject({ name: 'ConstraintError' });
    database.close();

    const entries = await readEntries();

    expect(entries.map(toId)).toEqual(['a']);
  });

  it('исключение в операциях отменяет поставленные до него запросы и отклоняет промис им', async () => {
    const database = await openDatabase();
    const failure = new Error('операции сорвались');

    const transactionResult = runTransaction(
      database,
      [SHEETS_STORE],
      'readwrite',
      (transaction) => {
        transaction.objectStore(SHEETS_STORE).put(buildEntry('b'));

        throw failure;
      }
    );

    await expect(transactionResult).rejects.toBe(failure);
    database.close();

    expect(await readEntries()).toEqual([]);
  });

  it('без IndexedDB открытие отклоняется, а не бросает синхронно', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB');

    await expect(openDatabase()).rejects.toBeInstanceOf(Error);
  });
});
