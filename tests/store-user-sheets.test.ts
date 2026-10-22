// @vitest-environment jsdom

import type { PaperSheet, RulingBend } from '@pages/Generator/lib/paper';
import {
  getAllRecords,
  openDatabase,
  SHEETS_STORE,
} from '@pages/Generator/model/indexedDb';
import {
  selectPaperFamilies,
  selectPendingUserSheets,
} from '@pages/Generator/model/paperSelectors';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import type { UserSheetRecord } from '@pages/Generator/model/userSheetsStorage.types';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Стор объявлен вне React, поэтому проверяется вызовами напрямую.
 */
const store = () => {
  return useGeneratorStore.getState();
};

/**
 * Фотография пользователя приходит как data URL. Строка короткая: проверяется
 * раздельное хранение, а не объём.
 */
const PHOTO_SRC = 'data:image/jpeg;base64,0123456789';

/**
 * Лист с посчитанными характеристиками: заметный наклон, несимметричные поля
 * и своя фаза первой линии — по ним видно, что после перезагрузки вернулись
 * именно измерения, а не значения по умолчанию.
 */
const buildMeasuredSheet = (id: string): PaperSheet => {
  return {
    id,
    label: 'Мой лист',
    src: PHOTO_SRC,
    width: 1200,
    height: 1600,
    ruling: {
      step: 64,
      firstLinePhase: 73.5,
      skewAngle: -1.4,
      margins: { top: 137.5, right: 90, bottom: 110, left: 120 },
      marginLineX: 1080,
      marginLineSide: 'right',
      sideSlant: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
    lighting: {
      gridWidth: 2,
      gridHeight: 2,
      values: [1, 0.9, 0.85, 0.8],
      contrast: 0.2,
      isUsable: true,
    },
    texture: {
      src: 'data:image/png;base64,texture',
      width: 8,
      height: 8,
      amplitude: 0.04,
    },
  };
};

const buildRecord = (id: string, isAnalyzed = true): UserSheetRecord => {
  return buildUserSheetRecord({
    familyId: 'grid',
    sheet: buildMeasuredSheet(id),
    isAnalyzed,
  });
};

/**
 * Перезагрузка страницы: состояние стора теряется, локальное хранилище — нет.
 */
const reload = () => {
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
};

/**
 * Лист без адресов файлов: после перезагрузки фотография и карта текстуры
 * приходят новыми object URL, а характеристики — теми же.
 *
 * @param sheet — лист
 * @returns характеристики листа без адресов
 */
const withoutUrls = ({ src: _src, texture, ...rest }: PaperSheet) => {
  return { ...rest, texture: texture && { ...texture, src: '' } };
};

/**
 * Записи базы как есть.
 *
 * @returns записи хранилища листов
 */
const readRawRecords = async (): Promise<unknown[]> => {
  const database = await openDatabase();

  try {
    return await getAllRecords(database, SHEETS_STORE);
  } finally {
    database.close();
  }
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage.clear();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
});

describe('пользовательские листы в сторе', () => {
  it('добавляет лист в его семью и выбирает его', () => {
    store().addUserSheet(buildRecord('user-1'));

    const family = selectPaperFamilies(store()).find((item) => {
      return item.id === 'grid';
    });

    expect(family?.sheets.at(-1)?.id).toBe('user-1');
    expect(store().sheetId).toBe('user-1');
  });

  it('не добавляет лист в чужую семью', () => {
    store().addUserSheet(buildRecord('user-1'));

    const lined = selectPaperFamilies(store()).find((item) => {
      return item.id === 'lined';
    });

    expect(
      lined?.sheets.some((sheet) => {
        return sheet.id === 'user-1';
      })
    ).toBe(false);
  });
});

describe('переживание перезагрузки', () => {
  it('возвращает лист с теми же характеристиками', async () => {
    const record = buildRecord('user-1');

    store().addUserSheet(record);
    reload();

    expect(store().userSheets).toHaveLength(0);

    await store().restoreUserSheets();

    const [restored] = store().userSheets;

    expect(store().userSheets).toHaveLength(1);
    expect(restored && { ...restored, sheet: withoutUrls(restored.sheet) }).toEqual({
      ...record,
      sheet: withoutUrls(record.sheet),
    });
  });

  it('возвращает изгиб линий строго равным исходному', async () => {
    const record = buildRecord('user-1');
    const { sheet } = record;
    const bend: RulingBend = {
      columnOrigin: 75,
      columnSpacing: 150,
      columnCount: 2,
      rowOrigin: 73.5,
      rowSpacing: 64,
      rowCount: 3,
      offsets: [0.5, -1.25, 2.75, 0, -0.01, 3.1],
    };

    store().addUserSheet({
      ...record,
      sheet: { ...sheet, ruling: { ...sheet.ruling, bend } },
    });
    reload();
    await store().restoreUserSheets();

    expect(store().userSheets[0]?.sheet.ruling.bend).toStrictEqual(bend);
  });

  it('не запускает повторный анализ восстановленного листа', async () => {
    store().addUserSheet(buildRecord('user-1'));
    reload();
    await store().restoreUserSheets();

    expect(selectPendingUserSheets(store())).toHaveLength(0);
  });

  it('оставляет в очереди анализа лист, характеристики которого ещё не посчитаны', () => {
    store().addUserSheet(buildRecord('user-2', false));

    expect(selectPendingUserSheets(store())).toHaveLength(1);
  });
});

/**
 * Ключ списка лёгких характеристик в локальном хранилище.
 */
const INDEX_KEY = 'autograph.paper.user-sheets';

/**
 * Кладёт в хранилище запись списка и исходный файл так, как их оставила
 * сессия, — литералом, мимо сериализатора: проверяется чтение чужой записи, а
 * не согласие сериализатора с самим собой.
 */
const seedStorage = (entry: Record<string, unknown>) => {
  globalThis.localStorage.setItem(INDEX_KEY, JSON.stringify([entry]));
  globalThis.localStorage.setItem(
    `autograph.paper.source.${String(entry.id)}`,
    PHOTO_SRC
  );
};

describe('форма записи в хранилище', () => {
  it('пишет разлиновку целиком одной записью листа', async () => {
    const record = buildRecord('user-1');

    store().addUserSheet(record);
    await store().restoreUserSheets();

    const [entry] = await readRawRecords();

    expect(entry).toMatchObject({ id: 'user-1', ruling: record.sheet.ruling });
  });

  it('читает разлиновку записи новой формы целиком', async () => {
    const ruling = {
      step: 58,
      firstLinePhase: 21,
      skewAngle: 0.7,
      margins: { top: 137, right: 95, bottom: 100, left: 80 },
      marginLineX: 1110,
      marginLineSide: 'right',
    };

    seedStorage({
      familyId: 'grid',
      isAnalyzed: true,
      id: 'user-new',
      label: 'Лист новой формы',
      width: 1200,
      height: 1600,
      ruling,
    });
    await store().restoreUserSheets();

    const [restored] = store().userSheets;

    expect(restored?.sheet.ruling).toEqual({
      ...ruling,
      sideSlant: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    });
  });

  it('оставляет в списке запись прежней формы с приблизительной разлиновкой', async () => {
    seedStorage({
      familyId: 'grid',
      isAnalyzed: true,
      id: 'user-legacy',
      label: 'Лист прежней формы',
      width: 1200,
      height: 1600,
      skewAngle: -0.6,
      measuredStep: 48,
      firstLinePhase: 30,
    });
    await store().restoreUserSheets();

    const family = selectPaperFamilies(store()).find((item) => {
      return item.id === 'grid';
    });

    /**
     * Поля — полтора шага от края кадра: 72 px. Верхнее опускается до
     * ближайшей линии: 30 + 48 = 78.
     */
    expect(family?.sheets.at(-1)?.ruling).toEqual({
      step: 48,
      firstLinePhase: 30,
      skewAngle: -0.6,
      margins: { top: 78, right: 72, bottom: 72, left: 72 },
      marginLineX: null,
      marginLineSide: null,
      sideSlant: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    });
    expect(family?.sheets.at(-1)?.id).toBe('user-legacy');
  });
});

describe('удаление пользовательского листа', () => {
  it('убирает лист из списка и переводит выбор на оставшийся экземпляр', () => {
    store().addUserSheet(buildRecord('user-1'));
    store().removeUserSheet('user-1');

    expect(store().userSheets).toHaveLength(0);
    expect(store().sheetId).toBe('grid-1');
  });

  it('убирает лист из хранилища вместе с файлом и производными', async () => {
    store().addUserSheet(buildRecord('user-1'));
    store().removeUserSheet('user-1');
    reload();
    await store().restoreUserSheets();

    expect(store().userSheets).toHaveLength(0);
    expect(await readRawRecords()).toEqual([]);
  });

  it('не трогает соседний лист', async () => {
    store().addUserSheet(buildRecord('user-1'));
    store().addUserSheet(buildRecord('user-2'));
    store().removeUserSheet('user-1');
    reload();
    await store().restoreUserSheets();

    expect(
      store().userSheets.map((record) => {
        return record.sheet.id;
      })
    ).toEqual(['user-2']);
  });
});
