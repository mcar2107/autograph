/**
 * @vitest-environment jsdom
 */
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { readUserSheets } from '@pages/Generator/model/userSheetsStorage';
import { PaperPicker } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

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
    render(<PaperPicker />);

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

    render(<PaperPicker />);

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

    render(<PaperPicker />);

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

  it('пока фото разбирается, рядом с плитками виден статус в живой области', async () => {
    const user = userEvent.setup();
    let finishDecode: (sheet: ReturnType<typeof createSyntheticSheet>) => void = () => {};

    decodeSheetImage.mockImplementation(() => {
      return new Promise((resolve) => {
        finishDecode = resolve;
      });
    });

    render(<PaperPicker />);

    const status = screen.getByRole('status');

    expect(status.textContent).toBe('');

    await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

    await waitFor(() => {
      expect(status.textContent).toMatch(/Разбираем фото «моя тетрадь»…/);
    });
    expect(status.textContent).toMatch(/до\u00A0полуминуты/);
    expect(status.textContent).toMatch(/редактор разметки откроется сам/);

    finishDecode(createSyntheticSheet(RULED_PHOTO));

    await waitFor(() => {
      expect(store().userSheets).toHaveLength(1);
    });

    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('');
  });

  it('добавленный лист — плитка с выбором и кнопкой настройки', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<PaperPicker />);

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

    /**
     * Импорт уже открыл редактор листа: кнопка настройки проверяется на
     * закрытом.
     */
    useMarkupEditorStore.getState().close();
    await user.click(
      within(ownSheets).getByRole('button', { name: 'Разметка листа «моя тетрадь»' })
    );

    expect(useMarkupEditorStore.getState().record?.sheet.id).toBe(sheetId);
  });

  it('отказ записи в хранилище виден сообщением, а лист остаётся доступным', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Квота исчерпана', 'QuotaExceededError');
    });

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<PaperPicker />);

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

    render(<PaperPicker />);

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

/**
 * Свой лист в семье линейки с заданной подписью: разлиновка — синтетическая
 * по умолчанию, её плитка не читает.
 *
 * @param id — идентификатор листа
 * @param label — подпись листа
 * @returns запись своего листа
 */
const buildLabeledRecord = (id: string, label: string) => {
  const { width, height } = RULED_PHOTO;
  const [preset] =
    store().presetFamilies.find(({ id: familyId }) => {
      return familyId === 'lined';
    })?.sheets || [];

  if (!preset) {
    throw new Error('В семье линейки нет листов');
  }

  return buildUserSheetRecord({
    familyId: 'lined',
    sheet: { ...preset, id, label, src: `data:image/jpeg;base64,${id}`, width, height },
  });
};

/**
 * Высота строки подписи в заглушке раскладки, px.
 */
const LABEL_LINE_HEIGHT = 16;

/**
 * Знаков в строке подписи в заглушке раскладки.
 */
const LABEL_LINE_CHARS = 5;

/**
 * Раскладка подписи плитки. В jsdom её нет: ширина элемента — ноль, высота
 * текста — тоже. Заглушка ставит в строку пять знаков и отдаёт высоту текста
 * по числу строк.
 */
const stubLabelWidth = () => {
  const layout = {
    readHeight(this: HTMLElement): number {
      const length = [...(this.textContent || '')].length;

      return Math.ceil(length / LABEL_LINE_CHARS) * LABEL_LINE_HEIGHT;
    },
  };

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(56);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    layout.readHeight
  );
};

describe('плитки своих листов: подпись и кнопка разметки', () => {
  it('подпись в две строки: имя, которое помещается, видно целиком и совпадает с доступным', () => {
    stubLabelWidth();
    store().selectFamily('lined');
    store().addUserSheet(buildLabeledRecord('user-1813', 'IMG_1813'));
    store().addUserSheet(buildLabeledRecord('user-1808', 'IMG_1808'));

    render(<PaperPicker />);

    const ownSheets = screen.getByRole('list', { name: 'Свои листы' });
    const first = within(ownSheets).getByRole('button', { name: 'IMG_1813' });
    const second = within(ownSheets).getByRole('button', { name: 'IMG_1808' });

    expect(first.textContent).toBe('IMG_1813');
    expect(second.textContent).toBe('IMG_1808');
    expect(first.querySelector('.line-clamp-2.break-all')?.textContent).toBe('IMG_1813');
  });

  it('сверх двух строк — обрезка с середины, видимый текст входит в доступное имя', () => {
    stubLabelWidth();
    store().selectFamily('lined');
    store().addUserSheet(buildLabeledRecord('user-long', 'IMG_20250925_143012'));
    store().addUserSheet(buildLabeledRecord('user-ru', 'Тетрадь в клетку, лист 2'));

    render(<PaperPicker />);

    const ownSheets = screen.getByRole('list', { name: 'Свои листы' });
    const [long, cyrillic] = within(ownSheets)
      .getAllByRole('button')
      .filter((button) => {
        return button.hasAttribute('aria-pressed');
      });

    /**
     * Две строки по пять знаков заглушки: конец имени — то, чем различаются
     * снимки с телефона, — остаётся на виду.
     */
    expect(long?.textContent).toBe('IMG_…43012');
    expect(cyrillic?.textContent).toBe('Тетр…ист 2');

    for (const [button, full] of [
      [long, 'IMG_20250925_143012'],
      [cyrillic, 'Тетрадь в клетку, лист 2'],
    ] as const) {
      const name = button?.getAttribute('aria-label') || '';

      expect(name).toContain(button?.textContent || '—');
      expect(name).toContain(full);
    }
  });

  it('кнопка разметки заметна, подсказка называет лист целиком, нажатие открывает редактор', async () => {
    const user = userEvent.setup();

    store().selectFamily('lined');
    store().addUserSheet(buildLabeledRecord('user-1813', 'IMG_1813'));

    render(<PaperPicker />);

    const button = within(screen.getByRole('list', { name: 'Свои листы' })).getByRole(
      'button',
      { name: 'Разметка листа «IMG_1813»' }
    );

    /**
     * Цель не меньше 32 px и подложка под значком: без неё белый значок
     * теряется на светлом снимке.
     */
    expect(button.className).toMatch(/\bsize-8\b/);
    expect(button.className).not.toMatch(/\bsize-6\b/);
    /**
     * Под палец — 44 px: 32 px хватает мыши, а пальцем в угол плитки не
     * попасть.
     */
    expect(button.className).toMatch(/\bpointer-coarse:size-11\b/);
    expect(button.className).toMatch(/\bbg-surface\//);

    await user.hover(button);

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Разметка листа «IMG_1813»'
    );

    await user.click(button);

    expect(useMarkupEditorStore.getState().record?.sheet.id).toBe('user-1813');
  });
});
