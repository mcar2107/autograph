// @vitest-environment jsdom

import type { RulingPin, SheetRuling } from '@pages/Generator/lib/paper';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { readUserSheets } from '@pages/Generator/model/userSheetsStorage';
import type { UserSheetRecord } from '@pages/Generator/model/userSheetsStorage.types';
import { IDBFactory } from 'fake-indexeddb';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Файл идёт отдельным от прочих тестов стора: просьба не вытеснять данные
 * звучит раз за сессию, то есть раз на модуль стора, а vitest даёт каждому
 * файлу свой.
 */

const store = () => {
  return useGeneratorStore.getState();
};

const buildRecord = (id: string): UserSheetRecord => {
  return buildUserSheetRecord({
    familyId: 'grid',
    sheet: {
      id,
      label: 'Мой лист',
      src: 'data:image/jpeg;base64,0123456789',
      width: 1200,
      height: 1600,
      ruling: {
        step: 64,
        firstLinePhase: 73.5,
        skewAngle: 0,
        margins: { top: 137.5, right: 90, bottom: 110, left: 120 },
        marginLineX: null,
        marginLineSide: null,
        sideSlant: null,
        bend: null,
        perspective: null,
        outline: null,
        mirrorOverride: null,
      },
      lighting: null,
      texture: null,
    },
  });
};

const persist = vi.fn(() => {
  return Promise.resolve(true);
});

let putSpy: MockInstance<IDBObjectStore['put']>;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  Object.defineProperty(navigator, 'storage', {
    value: { persist },
    configurable: true,
  });
  putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('сохранение своего листа', () => {
  it('просит браузер не вытеснять данные ровно один раз — при первом сохранении', async () => {
    await store().restoreUserSheets();

    expect(persist).not.toHaveBeenCalled();

    store().addUserSheet(buildRecord('user-1'));
    store().addUserSheet(buildRecord('user-2'));
    store().addUserSheet(buildRecord('user-1'));

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('отказ записи помечает лист несохранённым, лист остаётся в списке', async () => {
    putSpy.mockImplementation(() => {
      throw new DOMException('Квота исчерпана', 'QuotaExceededError');
    });

    store().addUserSheet(buildRecord('user-1'));

    await vi.waitFor(() => {
      expect(store().unsavedUserSheetIds).toEqual(['user-1']);
    });
    expect(
      store().userSheets.map(({ sheet }) => {
        return sheet.id;
      })
    ).toEqual(['user-1']);
  });

  it('удачная перезапись и удаление снимают пометку', async () => {
    putSpy.mockImplementation(() => {
      throw new DOMException('Квота исчерпана', 'QuotaExceededError');
    });

    store().addUserSheet(buildRecord('user-1'));
    store().addUserSheet(buildRecord('user-2'));

    await vi.waitFor(() => {
      expect(store().unsavedUserSheetIds).toEqual(['user-1', 'user-2']);
    });

    putSpy.mockRestore();
    store().addUserSheet(buildRecord('user-1'));
    store().removeUserSheet('user-2');

    await vi.waitFor(() => {
      expect(store().unsavedUserSheetIds).toEqual([]);
    });
  });

  it('результат записи удалённого листа пометку не возвращает', async () => {
    putSpy.mockImplementation(() => {
      throw new DOMException('Квота исчерпана', 'QuotaExceededError');
    });

    store().addUserSheet(buildRecord('user-1'));
    store().removeUserSheet('user-1');

    /**
     * Чтение встаёт в очередь хранилища после записи и удаления, поэтому к его
     * концу результат записи стор уже получил.
     */
    await store().restoreUserSheets();

    expect(putSpy).toHaveBeenCalled();
    expect(store().unsavedUserSheetIds).toEqual([]);
  });
});

describe('сохранение разметки своего листа', () => {
  /**
   * Правка редактора: другой шаг и наклон, своя пара булавок.
   */
  const buildEdit = (record: UserSheetRecord) => {
    const ruling: SheetRuling = { ...record.sheet.ruling, step: 66, skewAngle: 0.8 };
    const pins: RulingPin[] = [
      { index: 0, left: { x: 120, y: 210 }, right: { x: 1080, y: 223 } },
      { index: 18, left: { x: 120, y: 1398 }, right: { x: 1080, y: 1411 } },
    ];

    return { ruling, pins };
  };

  it('правка ложится на лист, а найденная автоматом разлиновка остаётся и после перечтения', async () => {
    const record = buildRecord('user-1');
    const { ruling, pins } = buildEdit(record);

    store().addUserSheet(record);
    store().saveSheetMarkup('user-1', { ruling, pins, kind: 'grid' });

    const [edited] = store().userSheets;

    expect(edited?.sheet.ruling).toStrictEqual(ruling);
    expect(edited?.pins).toStrictEqual(pins);
    expect(edited?.measuredRuling).toStrictEqual(record.sheet.ruling);

    const [stored] = await readUserSheets();

    expect(stored?.sheet.ruling).toStrictEqual(ruling);
    expect(stored?.pins).toStrictEqual(pins);
    expect(stored?.kind).toBe('grid');
    expect(stored?.measuredRuling).toStrictEqual(record.sheet.ruling);
  });

  it('перемер контура — свет, текстура и найденная разлиновка — переживает перечтение хранилища', async () => {
    const record = buildRecord('user-1');
    const outline = {
      topLeft: { x: 40, y: 30 },
      topRight: { x: 1170, y: 52 },
      bottomRight: { x: 1150, y: 1580 },
      bottomLeft: { x: 28, y: 1560 },
    };
    const ruling: SheetRuling = { ...record.sheet.ruling, outline };
    const measuredRuling: SheetRuling = {
      ...record.sheet.ruling,
      step: 62,
      firstLinePhase: 81,
      outline,
    };
    const remeasure = {
      lighting: {
        gridWidth: 2,
        gridHeight: 2,
        values: [1, 0.92, 0.87, 0.81],
        contrast: 0.19,
        isUsable: true,
      },
      texture: {
        src: `data:image/png;base64,${btoa('png-texture-bytes')}`,
        width: 8,
        height: 8,
        amplitude: 0.05,
      },
      measuredRuling,
      measuredKind: 'lined' as const,
    };

    store().addUserSheet(record);
    store().saveSheetMarkup('user-1', {
      ruling,
      pins: buildEdit(record).pins,
      kind: 'grid',
      remeasure,
    });

    const [stored] = await readUserSheets();

    expect(stored?.isAnalyzed).toBe(true);
    expect(stored?.sheet.ruling.outline).toStrictEqual(outline);
    expect(stored?.sheet.lighting).toStrictEqual(remeasure.lighting);
    expect(stored?.sheet.texture).toStrictEqual({
      ...remeasure.texture,
      src: expect.stringMatching(/^blob:/),
    });
    expect(stored?.measuredRuling).toStrictEqual(measuredRuling);
    expect(stored?.measuredKind).toBe('lined');
  });

  it('смена вида переносит лист в семью этого вида вместе с выбором', async () => {
    const record = buildRecord('user-1');

    store().addUserSheet(record);

    expect(store().familyId).toBe('grid');

    store().saveSheetMarkup('user-1', { ...buildEdit(record), kind: 'lined' });

    expect(store().userSheets[0]?.familyId).toBe('lined');
    expect(store().userSheets[0]?.kind).toBe('lined');
    expect(store().familyId).toBe('lined');
    expect(store().sheetId).toBe('user-1');

    const [stored] = await readUserSheets();

    expect(stored?.familyId).toBe('lined');
  });

  it('отмена в генераторе после смены вида не возвращает лист в прежнюю семью', () => {
    const record = buildRecord('user-1');

    store().addUserSheet(record);
    store().commit({ text: 'первая правка' });
    store().commit({ text: 'вторая правка' });
    store().saveSheetMarkup('user-1', { ...buildEdit(record), kind: 'lined' });
    store().undo();

    expect(store().text).toBe('первая правка');
    expect(store().familyId).toBe('lined');
    expect(store().sheetId).toBe('user-1');
    expect(store().isSheetPinned).toBe(true);

    store().redo();

    expect(store().text).toBe('вторая правка');
    expect(store().familyId).toBe('lined');
  });

  it('чистый лист остаётся в своей семье', () => {
    const record = buildRecord('user-1');

    store().addUserSheet(record);
    store().saveSheetMarkup('user-1', { ...buildEdit(record), kind: 'blank' });

    expect(store().userSheets[0]?.familyId).toBe('grid');
    expect(store().userSheets[0]?.kind).toBe('blank');
  });

  it('отказ записи сохранённой разметки помечает лист несохранённым', async () => {
    const record = buildRecord('user-1');

    store().addUserSheet(record);
    /**
     * Чтение встаёт в очередь хранилища за записью листа: к его концу лист
     * записан, и отказ достаётся только сохранению разметки.
     */
    await readUserSheets();
    putSpy.mockImplementation(() => {
      throw new DOMException('Квота исчерпана', 'QuotaExceededError');
    });
    store().saveSheetMarkup('user-1', { ...buildEdit(record), kind: 'grid' });

    await vi.waitFor(() => {
      expect(store().unsavedUserSheetIds).toEqual(['user-1']);
    });
    expect(store().userSheets[0]?.pins).toStrictEqual(buildEdit(record).pins);
  });
});
