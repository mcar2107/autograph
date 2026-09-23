import { isJsonRecord, parsePaperSheet, toText } from './paperSheetJson';
import type { UserSheetRecord } from './userSheetsStorage.types';

/**
 * Ключ списка пользовательских листов: лёгкие характеристики всех листов
 * сразу.
 */
const INDEX_KEY = 'autograph.paper.user-sheets';

/**
 * Префикс ключа исходного файла. Исходник лежит отдельной записью на лист и
 * отдельно от производных: файл невосстановим, а всё, что из него посчитано,
 * пересчитывается заново. Хранилище кончится — выбрасываются производные, а
 * не фотографии.
 */
const SOURCE_KEY_PREFIX = 'autograph.paper.source.';

/**
 * Префикс ключа производных карт: поля освещения и текстуры. Самая тяжёлая и
 * при этом единственная пересчитываемая часть.
 */
const DERIVED_KEY_PREFIX = 'autograph.paper.derived.';

/**
 * Общее начало ключей листов под прежним именем приложения. Такие записи
 * переносятся под текущие ключи при чтении: иначе листы, сохранённые до
 * переименования, пропали бы у пользователя без следа.
 */
const LEGACY_KEY_PREFIX = 'handwriting.paper.';

/**
 * Общее начало текущих ключей листов.
 */
const KEY_PREFIX = 'autograph.paper.';

/**
 * Локальное хранилище или `null`, если его нет: в тестовом окружении без jsdom
 * и в браузере с запрещёнными данными сайта обращение к нему бросает.
 *
 * @returns хранилище или `null`
 */
const getStorage = (): Storage | null => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

/**
 * Читает и разбирает значение ключа.
 *
 * @param storage — локальное хранилище
 * @param key — ключ записи
 * @returns разобранное значение; `null` — записи нет или она нечитаема
 */
const readJson = (storage: Storage, key: string): unknown => {
  const raw = storage.getItem(key);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Пишет значение в ключ, переживая переполнение хранилища.
 *
 * @param storage — локальное хранилище
 * @param key — ключ записи
 * @param value — что записать
 * @returns удалось ли записать
 */
const writeItem = (storage: Storage, key: string, value: string): boolean => {
  try {
    storage.setItem(key, value);

    return true;
  } catch {
    return false;
  }
};

/**
 * Переносит записи листов из ключей прежнего имени в текущие. Запись под
 * текущим ключом не перезаписывается: она новее. Старый ключ удаляется, только
 * если перенос удался, — переполненное хранилище не должно терять фотографию.
 *
 * @param storage — локальное хранилище
 */
const migrateLegacyKeys = (storage: Storage): void => {
  const legacyKeys = Object.keys(storage).filter((key) => {
    return key.startsWith(LEGACY_KEY_PREFIX);
  });

  for (const legacyKey of legacyKeys) {
    const key = `${KEY_PREFIX}${legacyKey.slice(LEGACY_KEY_PREFIX.length)}`;
    const value = storage.getItem(legacyKey);
    const isMoved =
      storage.getItem(key) !== null || (value !== null && writeItem(storage, key, value));

    if (isMoved) {
      storage.removeItem(legacyKey);
    }
  }
};

/**
 * Разбирает список лёгких характеристик.
 *
 * @param storage — локальное хранилище
 * @returns записи списка по порядку добавления
 */
const readIndex = (storage: Storage): Record<string, unknown>[] => {
  const parsed = readJson(storage, INDEX_KEY);

  if (!Array.isArray(parsed)) {
    return [];
  }

  const items: unknown[] = parsed;

  return items.reduce<Record<string, unknown>[]>((acc, item) => {
    if (isJsonRecord(item) && toText(item.id)) {
      acc.push(item);
    }

    return acc;
  }, []);
};

/**
 * Собирает лист обратно из трёх частей хранилища.
 *
 * @param storage — локальное хранилище
 * @param entry — запись списка
 * @returns пользовательский лист; `null` — исходный файл потерян
 */
const readRecord = (
  storage: Storage,
  entry: Record<string, unknown>
): UserSheetRecord | null => {
  const id = toText(entry.id);
  const src = storage.getItem(`${SOURCE_KEY_PREFIX}${id}`) || '';
  const derived = readJson(storage, `${DERIVED_KEY_PREFIX}${id}`);
  const maps = isJsonRecord(derived) ? derived : {};
  const sheet = parsePaperSheet({
    ...entry,
    src,
    lighting: maps.lighting,
    texture: maps.texture,
  });

  if (!sheet) {
    return null;
  }

  return {
    familyId: toText(entry.familyId),
    sheet,
    isAnalyzed: entry.isAnalyzed === true,
    /**
     * Запись без вида листа читается листом с разлиновкой семьи, а не
     * отбрасывается: у записи прежней формы поля нет, и это не порча.
     */
    isBlank: entry.isBlank === true,
  };
};

/**
 * Листы, сохранённые в строковом хранилище версиями до IndexedDB, вместе с их
 * характеристиками. Лист, у которого потерялся исходный файл, отбрасывается:
 * показывать нечего, а характеристики без фотографии бесполезны.
 *
 * @returns листы по порядку добавления; пустой список — хранилища или листов
 * в нём нет
 */
export const readLegacyUserSheets = (): UserSheetRecord[] => {
  const storage = getStorage();

  if (!storage) {
    return [];
  }

  migrateLegacyKeys(storage);

  return readIndex(storage).reduce<UserSheetRecord[]>((acc, entry) => {
    const record = readRecord(storage, entry);

    if (record) {
      acc.push(record);
    }

    return acc;
  }, []);
};

/**
 * Убирает листы из строкового хранилища: файл, производные и запись списка.
 * Список без оставшихся записей удаляется целиком.
 *
 * @param sheetIds — идентификаторы экземпляров
 */
export const removeLegacyUserSheets = (sheetIds: string[]): void => {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  const removed = new Set(sheetIds);
  const rest = readIndex(storage).filter((item) => {
    return !removed.has(toText(item.id));
  });

  for (const sheetId of sheetIds) {
    storage.removeItem(`${SOURCE_KEY_PREFIX}${sheetId}`);
    storage.removeItem(`${DERIVED_KEY_PREFIX}${sheetId}`);
  }

  if (rest.length > 0) {
    writeItem(storage, INDEX_KEY, JSON.stringify(rest));
  } else {
    storage.removeItem(INDEX_KEY);
  }
};

/**
 * Убирает из строкового хранилища все листы, в том числе те, чья запись
 * списка не читается.
 */
export const clearLegacyUserSheets = (): void => {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  removeLegacyUserSheets(
    readIndex(storage).map((entry) => {
      return toText(entry.id);
    })
  );
  storage.removeItem(INDEX_KEY);
};
