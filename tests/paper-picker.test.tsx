/**
 * @vitest-environment jsdom
 */
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { readUserSheets } from '@pages/Generator/model/userSheetsStorage';
import { PaperPicker } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticSheet } from './helpers/synthetic-sheet';

/**
 * Съём пикселей подменяется: канвы в jsdom нет, а проверяется здесь не
 * декодирование, а то, что выбор бумаги делает с добавленным листом.
 */
const { decodeSheetImage } = vi.hoisted(() => {
  return { decodeSheetImage: vi.fn() };
});

vi.mock(
  '@pages/Generator/ui/Generator/SettingsPane/useSheetImport/decodeSheetImage',
  () => {
    return { decodeSheetImage };
  }
);

/**
 * Снимок листа в линейку с известной разлиновкой: автоопределение на нём
 * удаётся, и лист попадает в семью без ручного ввода.
 */
const RULED_PHOTO = {
  width: 420,
  height: 560,
  step: 23.5,
  phase: 8,
  margins: { top: 78.5, right: 36, bottom: 82, left: 60 },
  marginLineX: 96,
};

/**
 * Снимок листа в клетку: детектор узнаёт на нём клетку, какая бы семья ни была
 * выбрана.
 */
const GRID_PHOTO = {
  width: 420,
  height: 560,
  step: 28,
  phase: 0,
  kind: 'grid' as const,
  margins: { top: 56, right: 56, bottom: 56, left: 56 },
};

/**
 * Начало сообщения об отказе записи: оно и есть обещание спеки, причина после
 * двоеточия — пояснение.
 */
const SAVE_FAILURE_MESSAGE = /^Лист не сохранится после перезагрузки/;

const buildPhotoFile = (): File => {
  return new File([new Uint8Array([1, 2, 3])], 'моя тетрадь.jpg', {
    type: 'image/jpeg',
  });
};

const store = () => {
  return useGeneratorStore.getState();
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  globalThis.localStorage?.clear();
  decodeSheetImage.mockReset();
  decodeSheetImage.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PaperPicker', () => {
  it('показывает каждую семью плиткой с изображением и подписью', () => {
    render(<PaperPicker onSheetSettingsOpen={vi.fn()} />);

    const { presetFamilies } = store();

    expect(presetFamilies.length).toBeGreaterThan(0);

    for (const family of presetFamilies) {
      const tile = screen.getByRole('radio', { name: family.label });
      const image = tile.querySelector('img');

      expect(image?.getAttribute('src')).toBe(family.sheets[0]?.src);
    }

    expect(screen.getByRole('button', { name: 'Своё фото' })).toBeDefined();
  });

  it('выбор семьи снимает закрепление экземпляра', async () => {
    const user = userEvent.setup();

    store().selectSheet('grid-3');

    expect(store().isSheetPinned).toBe(true);

    render(<PaperPicker onSheetSettingsOpen={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: 'В линейку' }));

    expect(store().familyId).toBe('lined');
    expect(store().isSheetPinned).toBe(false);
    expect(
      screen.getByRole('radio', { name: 'В линейку' }).getAttribute('aria-checked')
    ).toBe('true');
  });

  it('показывает разбор фотографии на плитке, не меняя её подписи', async () => {
    const user = userEvent.setup();
    let finishDecode: (sheet: ReturnType<typeof createSyntheticSheet>) => void = () => {};

    decodeSheetImage.mockImplementation(() => {
      return new Promise((resolve) => {
        finishDecode = resolve;
      });
    });

    render(<PaperPicker onSheetSettingsOpen={vi.fn()} />);

    await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

    /**
     * Подпись плитки не меняется: слово другой длины переносилось бы на вторую
     * строку и двигало бы соседние плитки. Разбор виден индикатором, а для
     * читалки — пометкой занятости.
     */
    const addTile = screen.getByRole('button', { name: 'Своё фото' });

    await waitFor(() => {
      expect(addTile.getAttribute('aria-busy')).toBe('true');
    });

    finishDecode(createSyntheticSheet(RULED_PHOTO));

    await waitFor(() => {
      expect(store().userSheets).toHaveLength(1);
    });

    expect(
      screen.getByRole('button', { name: 'Своё фото' }).getAttribute('aria-busy')
    ).toBe('false');
  });

  it('добавленный лист — плитка с выбором и кнопкой настройки', async () => {
    const user = userEvent.setup();
    const handleSettingsOpen = vi.fn();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<PaperPicker onSheetSettingsOpen={handleSettingsOpen} />);

    await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

    await waitFor(() => {
      expect(store().userSheets).toHaveLength(1);
    });

    const [record] = store().userSheets;
    const sheetId = record?.sheet.id || '';
    const ownSheets = screen.getByRole('list', { name: 'Свои листы' });
    const tile = within(ownSheets).getByRole('button', { name: 'моя тетрадь' });

    expect(tile.querySelector('img')?.getAttribute('src')).toBe(record?.sheet.src);

    /**
     * Выбор семьи снимает закрепление, клик по плитке своего листа
     * закрепляет его снова.
     */
    store().selectFamily(record?.familyId || '');
    await user.click(tile);

    expect(store().sheetId).toBe(sheetId);
    expect(store().isSheetPinned).toBe(true);

    await user.click(
      within(ownSheets).getByRole('button', { name: 'Настроить «моя тетрадь»' })
    );

    expect(handleSettingsOpen).toHaveBeenCalledWith(sheetId);
  });

  it('отказ записи в хранилище виден сообщением, а лист остаётся доступным', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Квота исчерпана', 'QuotaExceededError');
    });

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<PaperPicker onSheetSettingsOpen={vi.fn()} />);

    expect(screen.queryByText(SAVE_FAILURE_MESSAGE)).toBeNull();

    await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

    const message = await screen.findByText(SAVE_FAILURE_MESSAGE);

    expect(message.getAttribute('role')).toBe('alert');
    expect(put).toHaveBeenCalled();
    expect(store().userSheets).toHaveLength(1);
    expect(
      within(screen.getByRole('list', { name: 'Свои листы' })).getByRole('button', {
        name: 'моя тетрадь',
      })
    ).toBeDefined();
  });

  it('лист в клетку, добавленный при выбранной линейке, встаёт в семью клетки', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(GRID_PHOTO));
    store().selectFamily('lined');

    render(<PaperPicker onSheetSettingsOpen={vi.fn()} />);

    await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

    await waitFor(() => {
      expect(store().userSheets).toHaveLength(1);
    });

    const [record] = store().userSheets;

    expect(record?.kind).toBe('grid');
    expect(record?.familyId).toBe('grid');
    expect(store().familyId).toBe('grid');

    const [stored] = await readUserSheets();

    expect(stored?.kind).toBe('grid');
    expect(stored?.familyId).toBe('grid');
  });
});
