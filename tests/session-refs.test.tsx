/**
 * @vitest-environment jsdom
 */
import { LINED_FAMILY_ID, PRESET_PAPER_FAMILIES } from '@pages/Generator/config';
import type { PaperSheet } from '@pages/Generator/lib/paper';
import { SESSION_VERSION } from '@pages/Generator/model/sessionSchema';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Ключ сессии в локальном хранилище.
 */
const SESSION_KEY = 'autograph.session';

/**
 * Свой лист в семье «в линейку».
 */
const USER_SHEET: PaperSheet = {
  id: 'user-1',
  label: 'Мой лист',
  src: 'data:image/jpeg;base64,AA==',
  width: 1200,
  height: 1600,
  ruling: {
    step: 64,
    firstLinePhase: 71.5,
    skewAngle: 0,
    margins: { top: 135.5, right: 90, bottom: 110, left: 120 },
    marginLineX: null,
    marginLineSide: 'left',
    sideSlant: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  lighting: null,
  texture: null,
};

/**
 * Сохраняет сессию с указанными ссылками на лист.
 *
 * @param refs — семья, экземпляр и закрепление
 */
const storeSession = (refs: Record<string, unknown>): void => {
  globalThis.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      state: { text: 'Сохранённый текст', isSpread: true, ...refs },
      version: SESSION_VERSION,
    })
  );
};

/**
 * Открывает генератор заново: свежий модуль стора читает сессию, затем
 * монтируется восстановление своих листов — как при загрузке страницы.
 *
 * @returns состояние стора после восстановления
 */
const openGenerator = async () => {
  vi.resetModules();

  const { useGeneratorStore } = await import('@pages/Generator/model/useGeneratorStore');
  const { useStoredUserSheets } =
    await import('@pages/Generator/model/useStoredUserSheets');

  renderHook(() => {
    useStoredUserSheets();
  });

  /**
   * Листы читаются асинхронно, и хук не отдаёт своего промиса. Повторное
   * чтение встаёт в очередь хранилища за чтением хука и исполняется после
   * него.
   */
  await useGeneratorStore.getState().restoreUserSheets();

  return useGeneratorStore.getState();
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage.clear();
});

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

describe('проверка ссылок на листы после восстановления', () => {
  it('закреплённый свой лист пропал — закрепление снято, семья по умолчанию', async () => {
    storeSession({
      familyId: LINED_FAMILY_ID,
      sheetId: 'user-gone',
      isSheetPinned: true,
    });

    const state = await openGenerator();

    expect(state.isSheetPinned).toBe(false);
    expect(state.familyId).toBe(PRESET_PAPER_FAMILIES[0]?.id);
    expect(state.sheetId).toBe(PRESET_PAPER_FAMILIES[0]?.sheets[0]?.id);
    expect(state.text).toBe('Сохранённый текст');
    expect(state.isSpread).toBe(true);
  });

  it('неизвестная семья заменяется первой', async () => {
    storeSession({ familyId: 'papyrus', sheetId: 'papyrus-1', isSheetPinned: false });

    const state = await openGenerator();

    expect(state.familyId).toBe(PRESET_PAPER_FAMILIES[0]?.id);
    expect(state.sheetId).toBe(PRESET_PAPER_FAMILIES[0]?.sheets[0]?.id);
    expect(state.text).toBe('Сохранённый текст');
    expect(state.isSpread).toBe(true);
  });

  it('закреплённый свой лист на месте — выбор сохраняется', async () => {
    const { writeUserSheet } = await import('@pages/Generator/model/userSheetsStorage');

    await writeUserSheet(
      buildUserSheetRecord({ familyId: LINED_FAMILY_ID, sheet: USER_SHEET })
    );
    storeSession({
      familyId: LINED_FAMILY_ID,
      sheetId: USER_SHEET.id,
      isSheetPinned: true,
    });

    const state = await openGenerator();

    expect(state.familyId).toBe(LINED_FAMILY_ID);
    expect(state.sheetId).toBe(USER_SHEET.id);
    expect(state.isSheetPinned).toBe(true);
  });

  it('загрузка профилей после восстановления не снимает закрепление своего листа', async () => {
    const { writeUserSheet } = await import('@pages/Generator/model/userSheetsStorage');

    await writeUserSheet(
      buildUserSheetRecord({ familyId: LINED_FAMILY_ID, sheet: USER_SHEET })
    );
    storeSession({
      familyId: LINED_FAMILY_ID,
      sheetId: USER_SHEET.id,
      isSheetPinned: true,
    });

    await openGenerator();

    const { useGeneratorStore } =
      await import('@pages/Generator/model/useGeneratorStore');

    useGeneratorStore.getState().setPresetFamilies(PRESET_PAPER_FAMILIES);

    expect(useGeneratorStore.getState().sheetId).toBe(USER_SHEET.id);
    expect(useGeneratorStore.getState().isSheetPinned).toBe(true);
  });
});

describe('асинхронный старт', () => {
  afterEach(() => {
    vi.doUnmock('@pages/Generator/model/userSheetsStorage');
  });

  it('страница на закреплённом своём листе ждёт чтения листов, а не рисуется на пресете', async () => {
    const { writeUserSheet } = await import('@pages/Generator/model/userSheetsStorage');

    await writeUserSheet(
      buildUserSheetRecord({ familyId: LINED_FAMILY_ID, sheet: USER_SHEET })
    );
    storeSession({
      familyId: LINED_FAMILY_ID,
      sheetId: USER_SHEET.id,
      isSheetPinned: true,
    });

    /**
     * Чтение своих листов задерживается, пока тест его не отпустит: так
     * профили заведомо приходят раньше листов.
     */
    let releaseRead = () => {};

    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    vi.resetModules();
    vi.doMock('@pages/Generator/model/userSheetsStorage', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('@pages/Generator/model/userSheetsStorage')>();

      return {
        ...actual,
        readUserSheets: async () => {
          await readGate;

          return await actual.readUserSheets();
        },
      };
    });

    const { useGeneratorStore } =
      await import('@pages/Generator/model/useGeneratorStore');
    const { useStoredUserSheets } =
      await import('@pages/Generator/model/useStoredUserSheets');
    const { usePageLayout } = await import('@pages/Generator/model/usePageLayout');
    const { usePageRender } = await import('@pages/Generator/model/usePageRender');
    const { useRunRender } = await import('@pages/Generator/model/useRunRender');
    const { SheetViewport } = await import('@pages/Generator/ui/Generator/SheetViewport');
    const measurer = createMonospaceMeasurerFactory({ charWidth: 0.2 });

    const Harness: FC = () => {
      useStoredUserSheets();

      const pages = usePageLayout(measurer.create);
      const source = usePageRender(pages);
      const plan = useRunRender(pages);

      return <SheetViewport source={source} plan={plan} />;
    };

    render(<Harness />);
    act(() => {
      useGeneratorStore.getState().setPresetFamilies(PRESET_PAPER_FAMILIES);
    });

    /**
     * Раскладка и отрисовка успевают отработать на подставленной бумаге, но
     * на экран она не выходит.
     */
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    });

    const status = screen.getByText(/Загружаем свои листы/).closest('[role="status"]');

    expect(status).not.toBeNull();
    expect(screen.queryAllByTestId('page')).toHaveLength(0);
    expect(useGeneratorStore.getState().sheetId).toBe(USER_SHEET.id);
    expect(useGeneratorStore.getState().isSheetPinned).toBe(true);

    releaseRead();

    await waitFor(() => {
      expect(useGeneratorStore.getState().hasRestoredUserSheets).toBe(true);
    });

    expect(useGeneratorStore.getState().sheetId).toBe(USER_SHEET.id);
    expect(useGeneratorStore.getState().isSheetPinned).toBe(true);
    await waitFor(() => {
      expect(screen.queryByText(/Загружаем свои листы/)).toBeNull();
      expect(screen.queryAllByTestId('page')).toHaveLength(1);
    });

    /**
     * Область ожидания та же и опустела, а не снята вместе с текстом: только
     * смонтированная заранее область объявляет свой новый текст.
     */
    expect(status?.isConnected).toBe(true);
    expect(status?.textContent).toBe('');
  });
});
