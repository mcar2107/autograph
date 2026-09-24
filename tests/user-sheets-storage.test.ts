// @vitest-environment jsdom

import type { PaperSheet, RulingPin, SheetRuling } from '@pages/Generator/lib/paper';
import { deriveRulingPins } from '@pages/Generator/lib/paper';
import {
  getAllRecords,
  openDatabase,
  SHEETS_STORE,
} from '@pages/Generator/model/indexedDb';
import type { UserSheetRecord } from '@pages/Generator/model/userSheetsStorage.types';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Байты фотографии и карты текстуры: по ним видно, что из базы вернулся тот же
 * файл, а не пустой.
 */
const PHOTO_BYTES = 'jpeg-photo-bytes';
const TEXTURE_BYTES = 'png-texture-bytes';

/**
 * Data URL из строки байтов — так их отдаёт импорт.
 *
 * @param type — тип файла
 * @param bytes — байты строкой
 * @returns data URL
 */
const toDataUrl = (type: string, bytes: string): string => {
  return `data:${type};base64,${btoa(bytes)}`;
};

/**
 * Разлиновка листа на столе после ручной правки: изгиб, перспектива, контур,
 * линия поля и замена полей зеркала — всё, что должно пережить перезагрузку.
 */
const RULING: SheetRuling = {
  step: 64,
  firstLinePhase: 73.5,
  skewAngle: -1.4,
  margins: { top: 137.5, right: 90, bottom: 110, left: 120 },
  marginLineX: 1080,
  marginLineSide: 'right',
  bend: {
    columnOrigin: 75,
    columnSpacing: 150,
    columnCount: 2,
    rowOrigin: 73.5,
    rowSpacing: 64,
    rowCount: 3,
    offsets: [0.5, -1.25, 2.75, 0, -0.01, 3.1],
  },
  perspective: {
    originX: 610,
    originY: 830,
    convergenceX: 0.000_012,
    convergenceY: -0.000_031,
  },
  outline: {
    topLeft: { x: 96.5, y: 120 },
    topRight: { x: 1110, y: 101.25 },
    bottomRight: { x: 1131, y: 1540 },
    bottomLeft: { x: 88, y: 1561.75 },
  },
  mirrorOverride: {
    marginLineX: 130,
    marginLineSide: 'left',
    marginLeft: 140,
    marginRight: 95,
  },
};

/**
 * Лист свежего импорта: фотография и карта текстуры — data URL.
 *
 * @param id — идентификатор листа
 * @returns лист
 */
const buildSheet = (id: string): PaperSheet => {
  return {
    id,
    label: 'Мой лист',
    src: toDataUrl('image/jpeg', PHOTO_BYTES),
    width: 1200,
    height: 1600,
    ruling: RULING,
    lighting: {
      gridWidth: 2,
      gridHeight: 2,
      values: [1, 0.9, 0.85, 0.8],
      contrast: 0.2,
      isUsable: true,
    },
    texture: {
      src: toDataUrl('image/png', TEXTURE_BYTES),
      width: 8,
      height: 8,
      amplitude: 0.04,
    },
  };
};

/**
 * Лист стора.
 *
 * @param id — идентификатор листа
 * @returns лист стора
 */
const buildRecord = (id: string): UserSheetRecord => {
  return buildUserSheetRecord({ familyId: 'lined', sheet: buildSheet(id) });
};

/**
 * Свежий экземпляр модуля хранилища — как после перезагрузки страницы: ни
 * очереди, ни выданных адресов прошлой сессии, соединение с базой новое.
 *
 * @returns публичное API хранилища
 */
const reloadStorage = async () => {
  vi.resetModules();

  return await import('@pages/Generator/model/userSheetsStorage');
};

/**
 * Записи базы как есть — мимо разбора хранилища.
 *
 * @returns записи хранилища листов
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
 * Лист без адресов файлов: адреса после перезагрузки новые, разметка — та же.
 *
 * @param sheet — лист
 * @returns характеристики листа без адресов
 */
const withoutUrls = ({ src: _src, texture, ...rest }: PaperSheet) => {
  return { ...rest, texture: texture && { ...texture, src: '' } };
};

/**
 * Идентификатор листа — для сверки состава списка.
 *
 * @param record — лист стора
 * @returns идентификатор листа
 */
const toSheetId = ({ sheet }: UserSheetRecord): string => {
  return sheet.id;
};

describe('свои листы в IndexedDB', () => {
  const originalFactory = globalThis.indexedDB;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    globalThis.indexedDB = originalFactory;
    vi.restoreAllMocks();
  });

  it('лист переживает перезагрузку с той же разметкой', async () => {
    const record = buildRecord('user-1');
    const storage = await reloadStorage();

    expect(await storage.writeUserSheet(record)).toBe(true);

    const reloaded = await reloadStorage();
    const [restored] = await reloaded.readUserSheets();

    expect(restored?.familyId).toBe('lined');
    expect(restored?.isAnalyzed).toBe(true);
    expect(restored?.kind).toBe('lined');
    expect(restored && withoutUrls(restored.sheet)).toStrictEqual(
      withoutUrls(record.sheet)
    );
    expect(restored?.sheet.src).toMatch(/^blob:/);
    expect(restored?.sheet.texture?.src).toMatch(/^blob:/);
  });

  it('фотография и карта текстуры лежат файлами, а не data URL', async () => {
    const storage = await reloadStorage();

    await storage.writeUserSheet(buildRecord('user-1'));

    const [stored] = await readRawRecords();
    const { source, texture } = stored || {};

    expect(source).toBeInstanceOf(Blob);
    expect(source instanceof Blob && (await source.text())).toBe(PHOTO_BYTES);
    expect(source instanceof Blob && source.type).toBe('image/jpeg');
    expect(texture).toMatchObject({ width: 8, height: 8, amplitude: 0.04 });
    expect(Object.keys(stored || {}).sort()).toEqual([
      'familyId',
      'height',
      'id',
      'kind',
      'label',
      'lighting',
      'measuredKind',
      'measuredRuling',
      'pins',
      'ruling',
      'source',
      'texture',
      'width',
    ]);
  });

  it('лист импорта пишется с видом семьи, найденной разлиновкой — текущей, булавками — выведенными', async () => {
    const storage = await reloadStorage();

    await storage.writeUserSheet(buildRecord('user-1'));

    const [stored] = await readRawRecords();

    expect(stored?.kind).toBe('lined');
    expect(stored?.measuredKind).toBe('lined');
    expect(stored?.measuredRuling).toStrictEqual(RULING);
    expect(stored?.pins).toStrictEqual(
      deriveRulingPins(RULING, { width: 1200, height: 1600 })
    );
  });

  it('разметка листа, отличная от найденной, сохраняется и читается как есть', async () => {
    const storage = await reloadStorage();
    const measuredRuling: SheetRuling = { ...RULING, step: 66, mirrorOverride: null };
    const pins: RulingPin[] = [
      { index: 0, left: { x: 120, y: 200 }, right: { x: 1080, y: 180 } },
      { index: 20, left: { x: 118, y: 1480 }, right: { x: 1082, y: 1460 } },
    ];

    await storage.writeUserSheet({
      ...buildRecord('user-1'),
      kind: 'blank',
      measuredRuling,
      measuredKind: 'grid',
      pins,
    });

    const [stored] = await readRawRecords();
    const [restored] = await (await reloadStorage()).readUserSheets();

    expect(stored?.kind).toBe('blank');
    expect(stored?.measuredRuling).toStrictEqual(measuredRuling);
    expect(stored?.pins).toStrictEqual(pins);
    expect(restored?.kind).toBe('blank');
    expect(restored?.measuredKind).toBe('grid');
    expect(stored?.measuredKind).toBe('grid');
    expect(restored?.measuredRuling).toStrictEqual(measuredRuling);
    expect(restored?.pins).toStrictEqual(pins);
  });

  it('повторная запись прочитанного листа берёт файл по его адресу', async () => {
    const storage = await reloadStorage();

    await storage.writeUserSheet(buildRecord('user-1'));

    const [restored] = await storage.readUserSheets();

    expect(restored).toBeDefined();
    expect(
      await storage.writeUserSheet({
        ...restored!,
        sheet: { ...restored!.sheet, label: 'Переименован' },
      })
    ).toBe(true);

    const [stored] = await readRawRecords();
    const { source } = stored || {};

    expect(stored?.label).toBe('Переименован');
    expect(source instanceof Blob && (await source.text())).toBe(PHOTO_BYTES);
  });

  it('чтение, начатое сразу после записи, видит записанный лист', async () => {
    const storage = await reloadStorage();

    void storage.writeUserSheet(buildRecord('user-1'));

    const sheets = await storage.readUserSheets();

    expect(sheets.map(toSheetId)).toEqual(['user-1']);
  });

  it('удаление убирает лист из базы и освобождает его адреса', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const storage = await reloadStorage();

    await storage.writeUserSheet(buildRecord('user-1'));
    await storage.writeUserSheet(buildRecord('user-2'));

    const sheets = await storage.readUserSheets();
    const removed = sheets.find(({ sheet }) => {
      return sheet.id === 'user-1';
    })?.sheet;

    await storage.deleteUserSheet('user-1');

    expect(revoke).toHaveBeenCalledWith(removed?.src);
    expect(revoke).toHaveBeenCalledWith(removed?.texture?.src);
    expect((await (await reloadStorage()).readUserSheets()).map(toSheetId)).toEqual([
      'user-2',
    ]);
  });

  it('пять снимков с телефона по 4 МБ переживают перезагрузку все', async () => {
    const photoSize = 4 * 1024 * 1024;
    const photo = `data:image/jpeg;base64,${Buffer.alloc(photoSize, 0x5a).toString('base64')}`;
    const ids = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'];
    const storage = await reloadStorage();

    for (const id of ids) {
      const record = buildRecord(id);

      expect(
        await storage.writeUserSheet({
          ...record,
          sheet: { ...record.sheet, src: photo },
        })
      ).toBe(true);
    }

    const createUrl = vi.spyOn(URL, 'createObjectURL');
    const sheets = await (await reloadStorage()).readUserSheets();
    const urlFiles = createUrl.mock.calls.reduce<Map<string, Blob>>(
      (acc, [file], index) => {
        const url = createUrl.mock.results[index]?.value;

        if (file instanceof Blob && typeof url === 'string') {
          acc.set(url, file);
        }

        return acc;
      },
      new Map()
    );

    expect(sheets.map(toSheetId)).toEqual(ids);
    sheets.forEach(({ sheet }) => {
      expect(urlFiles.get(sheet.src)?.size).toBe(photoSize);
    });
  });

  it('без IndexedDB запись сообщает об отказе, а не бросает', async () => {
    const storage = await reloadStorage();

    Reflect.deleteProperty(globalThis, 'indexedDB');

    expect(await storage.writeUserSheet(buildRecord('user-1'))).toBe(false);
    expect(await storage.readUserSheets()).toEqual([]);
  });

  it('отказ базы при записи — отказ, лист не записан', async () => {
    const storage = await reloadStorage();
    const quota = new DOMException('Нет места', 'QuotaExceededError');

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota;
    });

    expect(await storage.writeUserSheet(buildRecord('user-1'))).toBe(false);

    vi.restoreAllMocks();

    expect(await readRawRecords()).toEqual([]);
  });
});
