// @vitest-environment jsdom

import { deriveRulingPins } from '@pages/Generator/lib/paper';
import {
  getAllRecords,
  openDatabase,
  SHEETS_STORE,
} from '@pages/Generator/model/indexedDb';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ключи прежнего строкового хранилища — литералами, а не из кода: фикстуры
 * повторяют то, что оставила прежняя версия приложения.
 */
const INDEX_KEY = 'autograph.paper.user-sheets';
const SOURCE_KEY = 'autograph.paper.source.user-manual';
const DERIVED_KEY = 'autograph.paper.derived.user-manual';
const BLANK_SOURCE_KEY = 'autograph.paper.source.user-blank';

/**
 * Байты фотографии листа с ручной разметкой.
 */
const PHOTO_BYTES = 'legacy-jpeg-bytes';

/**
 * Байты карты текстуры.
 */
const TEXTURE_BYTES = 'legacy-png-bytes';

/**
 * Разлиновка после ручной правки в прежнем диалоге: поля, линия поля и изгиб
 * заданы не автоматом.
 */
const MANUAL_RULING = {
  step: 58,
  firstLinePhase: 21,
  skewAngle: 0.7,
  margins: { top: 137, right: 95, bottom: 100, left: 80 },
  marginLineX: 1110,
  marginLineSide: 'right',
  bend: {
    columnOrigin: 75,
    columnSpacing: 150,
    columnCount: 2,
    rowOrigin: 21,
    rowSpacing: 58,
    rowCount: 2,
    offsets: [0.5, -1.25, 2.75, 0],
  },
  perspective: null,
  outline: null,
};

/**
 * Список листов строкой — так, как его писала прежняя версия: лист с ручной
 * разметкой в семье линейки и чистый лист в семье клетки.
 */
const LEGACY_INDEX = JSON.stringify([
  {
    familyId: 'lined',
    isAnalyzed: true,
    isBlank: false,
    id: 'user-manual',
    label: 'Тетрадь в линейку',
    width: 1200,
    height: 1600,
    ruling: MANUAL_RULING,
  },
  {
    familyId: 'grid',
    isAnalyzed: true,
    isBlank: true,
    id: 'user-blank',
    label: 'Чистый',
    width: 1000,
    height: 1400,
    ruling: { ...MANUAL_RULING, step: 40, marginLineX: null, marginLineSide: null },
  },
]);

/**
 * Производные карты листа с ручной разметкой строкой.
 */
const LEGACY_DERIVED = JSON.stringify({
  lighting: {
    gridWidth: 2,
    gridHeight: 1,
    values: [1, 0.9],
    contrast: 0.1,
    isUsable: true,
  },
  texture: {
    src: `data:image/png;base64,${btoa(TEXTURE_BYTES)}`,
    width: 8,
    height: 8,
    amplitude: 0.04,
  },
});

/**
 * Кладёт в строковое хранилище листы прежней версии.
 */
const seedLegacyStorage = (): void => {
  const storage = globalThis.localStorage;

  storage.setItem(INDEX_KEY, LEGACY_INDEX);
  storage.setItem(SOURCE_KEY, `data:image/jpeg;base64,${btoa(PHOTO_BYTES)}`);
  storage.setItem(DERIVED_KEY, LEGACY_DERIVED);
  storage.setItem(BLANK_SOURCE_KEY, 'data:image/jpeg;base64,AA==');
};

/**
 * Ключи своих листов в строковом хранилище.
 *
 * @returns ключи по алфавиту
 */
const readLegacyKeys = (): string[] => {
  return Object.keys(globalThis.localStorage)
    .filter((key) => {
      return key.includes('.paper.');
    })
    .sort();
};

/**
 * Записи базы как есть.
 *
 * @returns записи хранилища листов по порядку ключей
 */
const readRawRecords = async (): Promise<Record<string, unknown>[]> => {
  const database = await openDatabase();

  try {
    const records = await getAllRecords(database, SHEETS_STORE);

    return records.reduce<Record<string, unknown>[]>((acc, record) => {
      if (typeof record === 'object' && record !== null) {
        acc.push({ ...record });
      }

      return acc;
    }, []);
  } finally {
    database.close();
  }
};

/**
 * Свежий экземпляр модуля хранилища — как при запуске новой версии.
 *
 * @returns публичное API хранилища
 */
const startApp = async () => {
  vi.resetModules();

  return await import('@pages/Generator/model/userSheetsStorage');
};

describe('перенос своих листов из localStorage в IndexedDB', () => {
  const originalFactory = globalThis.indexedDB;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    globalThis.indexedDB = originalFactory;
    globalThis.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('переносит лист с ручной разметкой без потерь и удаляет прежние ключи', async () => {
    seedLegacyStorage();

    const sheets = await (await startApp()).readUserSheets();
    const manual = sheets.find(({ sheet }) => {
      return sheet.id === 'user-manual';
    });

    expect(manual?.familyId).toBe('lined');
    expect(manual?.sheet.label).toBe('Тетрадь в линейку');
    expect(manual?.sheet.ruling).toEqual({ ...MANUAL_RULING, mirrorOverride: null });
    expect(manual?.sheet.lighting?.values).toEqual([1, 0.9]);
    expect(manual?.sheet.texture?.amplitude).toBe(0.04);
    expect(readLegacyKeys()).toEqual([]);

    const records = await readRawRecords();
    const stored = records.find(({ id }) => {
      return id === 'user-manual';
    });
    const { source, texture } = stored || {};

    expect(records).toHaveLength(2);
    expect(stored?.kind).toBe('lined');
    expect(stored?.ruling).toEqual({ ...MANUAL_RULING, mirrorOverride: null });
    expect(stored?.measuredRuling).toEqual(stored?.ruling);
    expect(stored?.pins).toEqual(
      manual && deriveRulingPins(manual.sheet.ruling, { width: 1200, height: 1600 })
    );
    expect(source instanceof Blob && (await source.text())).toBe(PHOTO_BYTES);
    expect(source instanceof Blob && source.type).toBe('image/jpeg');
    expect(
      typeof texture === 'object' &&
        texture !== null &&
        'image' in texture &&
        texture.image instanceof Blob &&
        (await texture.image.text())
    ).toBe(TEXTURE_BYTES);
  });

  it('чистый лист переносится с видом «без разлиновки»', async () => {
    seedLegacyStorage();

    const sheets = await (await startApp()).readUserSheets();
    const records = await readRawRecords();

    expect(
      records.find(({ id }) => {
        return id === 'user-blank';
      })?.kind
    ).toBe('blank');
    expect(
      sheets.find(({ sheet }) => {
        return sheet.id === 'user-blank';
      })?.isBlank
    ).toBe(true);
  });

  it('перенесённый лист читается после следующего запуска уже из IndexedDB', async () => {
    seedLegacyStorage();
    await (await startApp()).readUserSheets();

    const sheets = await (await startApp()).readUserSheets();

    expect(
      sheets.map(({ sheet }) => {
        return sheet.src.startsWith('blob:');
      })
    ).toEqual([true, true]);
  });

  it('сбой транзакции оставляет localStorage как есть, а листы видны до конца сессии', async () => {
    seedLegacyStorage();

    const before = readLegacyKeys().map((key) => {
      return [key, globalThis.localStorage.getItem(key)];
    });

    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
      throw new DOMException('Нет места', 'QuotaExceededError');
    });

    const sheets = await (await startApp()).readUserSheets();

    vi.restoreAllMocks();

    expect(
      readLegacyKeys().map((key) => {
        return [key, globalThis.localStorage.getItem(key)];
      })
    ).toEqual(before);
    expect(await readRawRecords()).toEqual([]);
    expect(
      sheets
        .map(({ sheet }) => {
          return sheet.id;
        })
        .sort()
    ).toEqual(['user-blank', 'user-manual']);

    const retried = await (await startApp()).readUserSheets();

    expect(retried).toHaveLength(2);
    expect(readLegacyKeys()).toEqual([]);
  });

  it('повторный перенос ничего не дублирует и не затирает поправленное', async () => {
    seedLegacyStorage();

    const storage = await startApp();
    const [first] = await storage.readUserSheets();

    expect(first).toBeDefined();
    await storage.writeUserSheet({
      ...first!,
      sheet: { ...first!.sheet, label: 'Поправлен после переноса' },
    });

    /**
     * Старая версия в соседней вкладке снова записала те же ключи.
     */
    seedLegacyStorage();

    const sheets = await (await startApp()).readUserSheets();
    const records = await readRawRecords();

    expect(records).toHaveLength(2);
    expect(sheets).toHaveLength(2);
    expect(
      records.find(({ id }) => {
        return id === first?.sheet.id;
      })?.label
    ).toBe('Поправлен после переноса');
    expect(readLegacyKeys()).toEqual([]);
  });

  it('переносит и листы под прежним именем приложения', async () => {
    const storage = globalThis.localStorage;

    storage.setItem('handwriting.paper.user-sheets', LEGACY_INDEX);
    storage.setItem(
      'handwriting.paper.source.user-manual',
      `data:image/jpeg;base64,${btoa(PHOTO_BYTES)}`
    );
    storage.setItem('handwriting.paper.source.user-blank', 'data:image/jpeg;base64,AA==');

    const sheets = await (await startApp()).readUserSheets();

    expect(sheets).toHaveLength(2);
    expect(await readRawRecords()).toHaveLength(2);
    expect(readLegacyKeys()).toEqual([]);
  });
});
