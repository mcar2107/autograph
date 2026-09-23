/**
 * Имя базы приложения.
 */
const DATABASE_NAME = 'autograph';

/**
 * Версия схемы базы. Поднимается только вместе с правкой `upgradeDatabase`:
 * браузер зовёт обновление схемы лишь при росте версии.
 */
const DATABASE_VERSION = 1;

/**
 * Хранилище своих листов: запись на лист, ключ — идентификатор листа.
 */
export const SHEETS_STORE = 'sheets';

/**
 * Поле записи, по которому хранилище листов её находит.
 */
const SHEETS_KEY_PATH = 'id';

/**
 * Ошибка операции базы. Ошибки у запроса или транзакции может не быть — у
 * транзакции, отменённой без сбоя, — а отказ всё равно должен нести причину.
 *
 * @param error — ошибка из IndexedDB
 * @param message — описание отказа, если ошибки нет
 * @returns ошибка для отклонения промиса
 */
const toError = (error: DOMException | null, message: string): Error => {
  return error || new DOMException(message, 'AbortError');
};

/**
 * Заводит хранилища при первом открытии. Хранилище, которое уже есть, не
 * трогается: записи в нём — свои листы пользователя.
 *
 * @param database — открываемая база в транзакции обновления схемы
 */
const upgradeDatabase = (database: IDBDatabase): void => {
  if (!database.objectStoreNames.contains(SHEETS_STORE)) {
    database.createObjectStore(SHEETS_STORE, { keyPath: SHEETS_KEY_PATH });
  }
};

/**
 * Открывает базу приложения. Отказ — отклонённый промис, а не исключение:
 * без IndexedDB (запрет данных сайта, старый браузер) вызывающий получает ту
 * же ветку отказа, что и при сбое открытия.
 *
 * Соединение закрывается само, когда другая вкладка поднимает версию базы:
 * иначе её обновление схемы ждало бы, пока закроют эту вкладку.
 *
 * @returns открытая база
 */
export const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const factory: IDBFactory | undefined = globalThis.indexedDB;

    if (!factory) {
      reject(new Error('IndexedDB недоступна'));

      return;
    }

    try {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        upgradeDatabase(request.result);
      };

      request.onsuccess = () => {
        const database = request.result;

        database.onversionchange = () => {
          database.close();
        };

        resolve(database);
      };

      request.onerror = () => {
        reject(toError(request.error, 'База не открылась'));
      };
    } catch (error) {
      reject(error instanceof Error ? error : new Error('База не открылась'));
    }
  });
};

/**
 * Выполняет операции в одной транзакции. Промис исполняется по `complete`, а
 * не по успеху запросов: запись считается сохранённой, только когда браузер
 * её зафиксировал, — отказ по квоте приходит отменой транзакции уже после
 * успешного запроса.
 *
 * Сбой любого запроса отменяет транзакцию целиком: ни одна из её записей не
 * сохраняется, промис отклоняется ошибкой сбоя.
 *
 * @param database — открытая база
 * @param storeNames — хранилища транзакции
 * @param mode — режим транзакции
 * @param run — операции над транзакцией; зовётся синхронно, пока она активна
 * @returns исполняется после фиксации транзакции
 */
export const runTransaction = (
  database: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => void
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(storeNames, mode);

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onabort = () => {
        reject(toError(transaction.error, 'Транзакция отменена'));
      };

      run(transaction);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Транзакция не началась'));
    }
  });
};

/**
 * Читает все записи хранилища по порядку ключей.
 *
 * @param database — открытая база
 * @param storeName — хранилище
 * @returns записи как есть, без проверки формы
 */
export const getAllRecords = async (
  database: IDBDatabase,
  storeName: string
): Promise<unknown[]> => {
  let records: unknown[] = [];

  await runTransaction(database, [storeName], 'readonly', (transaction) => {
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => {
      records = request.result;
    };
  });

  return records;
};

/**
 * Пишет запись; запись с тем же ключом заменяется.
 *
 * @param database — открытая база
 * @param storeName — хранилище
 * @param value — запись с ключом внутри
 * @returns исполняется после фиксации; отказ — ошибка IndexedDB, в том числе
 * `QuotaExceededError`
 */
export const putRecord = (
  database: IDBDatabase,
  storeName: string,
  value: unknown
): Promise<void> => {
  return runTransaction(database, [storeName], 'readwrite', (transaction) => {
    transaction.objectStore(storeName).put(value);
  });
};

/**
 * Удаляет запись по ключу. Отсутствующая запись — не ошибка.
 *
 * @param database — открытая база
 * @param storeName — хранилище
 * @param key — ключ записи
 * @returns исполняется после фиксации
 */
export const deleteRecord = (
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<void> => {
  return runTransaction(database, [storeName], 'readwrite', (transaction) => {
    transaction.objectStore(storeName).delete(key);
  });
};
