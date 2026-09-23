// @vitest-environment jsdom

import type { PaperSheet } from '@pages/Generator/lib/paper';
import { selectPendingUserSheets } from '@pages/Generator/model/paperSelectors';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import {
  clearUserSheets,
  writeUserSheet,
} from '@pages/Generator/model/userSheetsStorage';
import { useStoredUserSheets } from '@pages/Generator/model/useStoredUserSheets';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SHEET: PaperSheet = {
  id: 'user-1',
  label: 'Мой лист',
  src: 'data:image/jpeg;base64,AA==',
  width: 1200,
  height: 1600,
  ruling: {
    step: 64,
    firstLinePhase: 71.5,
    skewAngle: -1.2,
    margins: { top: 135.5, right: 90, bottom: 110, left: 120 },
    marginLineX: 1080,
    marginLineSide: 'right',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  lighting: null,
  texture: null,
};

/**
 * Лист, снятый на столе: контур и перспектива в записи есть, а досчитывать их
 * при запуске нечем — фотография не разбирается.
 */
const TABLE_SHEET: PaperSheet = {
  ...SHEET,
  id: 'user-2',
  ruling: {
    ...SHEET.ruling,
    outline: {
      topLeft: { x: 96.5, y: 120 },
      topRight: { x: 1110, y: 101.25 },
      bottomRight: { x: 1131, y: 1540 },
      bottomLeft: { x: 88, y: 1561.75 },
    },
    perspective: {
      originX: 610,
      originY: 830,
      convergenceX: 0.000_012,
      convergenceY: -0.000_031,
    },
  },
};

describe('восстановление своих листов при открытии генератора', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  });

  afterEach(async () => {
    cleanup();
    await clearUserSheets();
  });

  it('возвращает лист из хранилища в стор', async () => {
    await writeUserSheet({
      familyId: 'lined',
      sheet: SHEET,
      isAnalyzed: true,
      isBlank: false,
    });

    renderHook(() => {
      return useStoredUserSheets();
    });

    await waitFor(() => {
      expect(useGeneratorStore.getState().userSheets).toHaveLength(1);
    });

    const [restored] = useGeneratorStore.getState().userSheets;

    expect(restored?.sheet.id).toBe(SHEET.id);
    expect(restored?.sheet.ruling).toEqual(SHEET.ruling);
  });

  it('возвращает лист с контуром и перспективой теми же, что записаны', async () => {
    await writeUserSheet({
      familyId: 'grid',
      sheet: TABLE_SHEET,
      isAnalyzed: true,
      isBlank: false,
    });

    renderHook(() => {
      return useStoredUserSheets();
    });

    await waitFor(() => {
      expect(useGeneratorStore.getState().userSheets).toHaveLength(1);
    });

    const [restored] = useGeneratorStore.getState().userSheets;

    expect(restored?.sheet.ruling.outline).toStrictEqual(TABLE_SHEET.ruling.outline);
    expect(restored?.sheet.ruling.perspective).toStrictEqual(
      TABLE_SHEET.ruling.perspective
    );
    expect(restored?.sheet.ruling).toEqual(TABLE_SHEET.ruling);
    expect(selectPendingUserSheets(useGeneratorStore.getState())).toHaveLength(0);
  });

  it('не ставит восстановленный лист в очередь на повторный анализ', async () => {
    await writeUserSheet({
      familyId: 'lined',
      sheet: SHEET,
      isAnalyzed: true,
      isBlank: false,
    });

    renderHook(() => {
      return useStoredUserSheets();
    });

    await waitFor(() => {
      expect(useGeneratorStore.getState().userSheets).toHaveLength(1);
    });

    expect(selectPendingUserSheets(useGeneratorStore.getState())).toHaveLength(0);
  });
});
