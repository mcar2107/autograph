/**
 * @vitest-environment jsdom
 */
import type { LayoutPage } from '@pages/Generator/lib/paginate/paginate.types';
import { renderPageInWorker } from '@pages/Generator/model/createPageRenderClient';
import type {
  PageRenderTask,
  RunRenderPlan,
} from '@pages/Generator/model/pageTask.types';
import { buildPageSheetSequence } from '@pages/Generator/model/recipeSelectors';
import { useExportPage } from '@pages/Generator/model/useExportPage';
import type { ExportDeps } from '@pages/Generator/model/useExportPage.types';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { usePageRender } from '@pages/Generator/model/usePageRender';
import { useRunRender } from '@pages/Generator/model/useRunRender';
import { ActionBar } from '@pages/Generator/ui/Generator/ActionBar';
import { downloadBlob, downloadDataUrl, readBlobAsDataUrl } from '@shared/lib/files';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRenderFamily } from './helpers/paper-family';

/**
 * Отрисовка подменяется целиком: тест проверяет оркестрацию и интерфейс, а
 * растра в jsdom нет. Заодно это ловит возврат отрисовки на главный поток —
 * тогда подменённый воркер остался бы без единого задания.
 */
vi.mock('@pages/Generator/model/createPageRenderClient', () => {
  return { renderPageInWorker: vi.fn() };
});

vi.mock('@shared/lib/files', () => {
  return {
    downloadBlob: vi.fn(),
    downloadDataUrl: vi.fn(),
    readBlobAsDataUrl: vi.fn(),
    readFileAsDataUrl: vi.fn(),
  };
});

/**
 * Масштаб снимка: страница рисуется в кадре листа один к одному, а не в размере
 * предпросмотра.
 */
const FRAME_SCALE = 1;

const PAGE_COUNT = 4;

/**
 * Текущая страница плана: сохраняется она, а не первая.
 */
const CURRENT_PAGE_INDEX = 2;

const PAGE_DATA_URL = 'data:image/jpeg;base64,page';

/**
 * Задание-пустышка: подменённая отрисовка в него не заглядывает. Лист пуст
 * намеренно — иначе сохранение полезло бы за фотографией, которой в jsdom
 * взяться неоткуда.
 */
const TASK: PageRenderTask = {
  params: {
    page: { lines: [] },
    background: null,
    inkColor: '#000000',
    ink: { lighting: null, texture: null, seed: 1 },
    glyphs: null,
    fontFamily: 'Abram',
    geometry: {
      fontSizePx: 20,
      lineSpacing: 0,
      topOffset: 0,
      leftPadding: 0,
      blockWidth: 100,
      blockRotate: 0,
      fontMetrics: { fontAscent: 0.8, lineHeight: 1.2 },
      bend: null,
      perspective: null,
    },
    scale: FRAME_SCALE,
  },
  sheet: null,
  textureSrc: null,
  font: null,
  pageWidth: 200,
  pageHeight: 400,
  quality: 0.92,
};

const buildPlan = (buildTask: (pageIndex: number) => PageRenderTask): RunRenderPlan => {
  return { pageCount: PAGE_COUNT, pageIndex: CURRENT_PAGE_INDEX, buildTask };
};

const PLAN: RunRenderPlan = buildPlan(() => {
  return TASK;
});

/**
 * Незавершённые отрисовки в порядке поступления: тест сам решает, когда
 * страница будет готова, и потому видит интерфейс в середине выгрузки.
 */
let pendingPages: Array<(page: Blob) => void> = [];

/**
 * Подменённая отрисовка: обещание висит, пока тест его не разрешит, и рвётся
 * по сигналу отмены — ровно так ведёт себя клиент воркера.
 */
const deferRender = () => {
  vi.mocked(renderPageInWorker).mockImplementation((_task, signal) => {
    return new Promise<Blob>((resolve, reject) => {
      pendingPages.push(resolve);

      signal?.addEventListener(
        'abort',
        () => {
          reject(new Error('Отрисовка страницы отменена'));
        },
        { once: true }
      );
    });
  });
};

/**
 * Дожидается очередного задания и объявляет страницу готовой.
 */
const completePage = async (pageIndex: number) => {
  await waitFor(() => {
    expect(pendingPages.length).toBeGreaterThan(pageIndex);
  });

  await act(async () => {
    pendingPages[pageIndex]?.(new Blob(['page'], { type: 'image/jpeg' }));
  });
};

const clickButton = async (name: string) => {
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name }));
};

const getButton = (name: string): HTMLButtonElement => {
  const button = screen.getByRole('button', { name });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`«${name}» — не кнопка`);
  }

  return button;
};

beforeEach(() => {
  pendingPages = [];
  useGeneratorStore.setState({ ...DEFAULT_GENERATOR_STATE, text: 'раз два' });
  vi.mocked(downloadBlob).mockClear();
  vi.mocked(downloadDataUrl).mockClear();
  vi.mocked(readBlobAsDataUrl).mockResolvedValue(PAGE_DATA_URL);
  deferRender();
});

afterEach(() => {
  cleanup();
  vi.mocked(renderPageInWorker).mockReset();
});

describe('полоса действий', () => {
  it('держит перегенерацию, сохранение страницы и выгрузку пачки', () => {
    render(<ActionBar plan={PLAN} />);

    expect(getButton('Перегенерировать').disabled).toBe(false);
    expect(getButton('Сохранить страницу').disabled).toBe(false);
    expect(getButton('Скачать все').disabled).toBe(false);
  });

  it('без текста не даёт сохранять и объясняет почему', () => {
    useGeneratorStore.setState({ text: '  \n' });

    render(<ActionBar plan={PLAN} />);

    expect(getButton('Сохранить страницу').disabled).toBe(true);
    expect(getButton('Скачать все').disabled).toBe(true);
    expect(screen.getByText('Введите текст, чтобы сохранить страницы')).toBeDefined();
  });

  it('пока свои листы читаются, не сохраняет страницу на подставленной бумаге', () => {
    useGeneratorStore.setState({
      sheetId: 'user-not-read-yet',
      isSheetPinned: true,
      hasRestoredUserSheets: false,
    });

    render(<ActionBar plan={PLAN} />);

    expect(getButton('Сохранить страницу').disabled).toBe(true);
    expect(getButton('Скачать все').disabled).toBe(true);
    expect(screen.getByText('Загружаем свои листы…')).toBeDefined();

    act(() => {
      useGeneratorStore.setState({ hasRestoredUserSheets: true });
    });

    expect(getButton('Сохранить страницу').disabled).toBe(false);
    expect(getButton('Скачать все').disabled).toBe(false);
  });
});

describe('перегенерация', () => {
  it('меняет seed прогона, выбранный тон чернил не трогает', async () => {
    const family = buildRenderFamily();

    useGeneratorStore.setState({
      presetFamilies: [family],
      familyId: family.id,
      sheetId: family.sheets[0]?.id || '',
    });

    const pages: LayoutPage[] = [{ sheetId: '', lines: [] }];
    const { result } = renderHook(() => {
      return usePageRender(pages);
    });
    const seedBefore = useGeneratorStore.getState().runSeed;
    const inkBefore = result.current?.buildParams(1).inkColor;

    render(<ActionBar plan={PLAN} />);

    await clickButton('Перегенерировать');

    expect(useGeneratorStore.getState().runSeed).not.toBe(seedBefore);
    expect(result.current?.buildParams(1).inkColor).toBe(inkBefore);
  });
});

describe('сохранение страницы', () => {
  it('скачивает текущую страницу под именем файла страницы', async () => {
    const buildTask = vi.fn(() => {
      return TASK;
    });

    vi.mocked(renderPageInWorker).mockResolvedValue(
      new Blob(['page'], { type: 'image/jpeg' })
    );

    render(<ActionBar plan={buildPlan(buildTask)} />);

    await clickButton('Сохранить страницу');

    await waitFor(() => {
      expect(downloadDataUrl).toHaveBeenCalledWith(PAGE_DATA_URL, 'autograph_page.jpg');
    });

    expect(buildTask).toHaveBeenCalledTimes(1);
    expect(buildTask).toHaveBeenCalledWith(CURRENT_PAGE_INDEX);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('показывает ход сохранения на кнопке и не запускает его дважды', async () => {
    let finishRender: (page: Blob) => void = () => {};

    vi.mocked(renderPageInWorker).mockImplementation(() => {
      return new Promise<Blob>((resolve) => {
        finishRender = resolve;
      });
    });

    render(<ActionBar plan={PLAN} />);

    await clickButton('Сохранить страницу');

    const saveButton = getButton('Сохранить страницу');

    expect(saveButton.getAttribute('aria-busy')).toBe('true');

    /**
     * Подпись на месте: ход сохранения показывает индикатор, а сменившаяся
     * подпись меняла бы ширину кнопки и дёргала полосу действий.
     */
    expect(saveButton.textContent).toContain('Сохранить страницу');

    await clickButton('Сохранить страницу');

    expect(renderPageInWorker).toHaveBeenCalledTimes(1);

    finishRender(new Blob(['page'], { type: 'image/jpeg' }));

    await waitFor(() => {
      expect(getButton('Сохранить страницу').getAttribute('aria-busy')).toBe('false');
    });
  });

  it('при отказе отрисовки не скачивает файл и показывает сообщение', async () => {
    vi.mocked(renderPageInWorker).mockRejectedValue(new Error('отрисовка не удалась'));

    render(<ActionBar plan={PLAN} />);

    await clickButton('Сохранить страницу');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Не удалось сохранить страницу'
      );
    });

    expect(downloadDataUrl).not.toHaveBeenCalled();
  });

  it('не сохраняет, пока страница не отрисована', async () => {
    render(<ActionBar plan={null} />);

    await clickButton('Сохранить страницу');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Страница ещё не отрисована'
      );
    });

    expect(renderPageInWorker).not.toHaveBeenCalled();
  });

  it('скачивает композицию, когда режим сцены включён', async () => {
    const download = vi.fn();

    useGeneratorStore.setState({ isSceneEnabled: true });

    const { result } = renderHook(() => {
      return useExportPage(PLAN, {
        renderPage: () => {
          return Promise.resolve(PAGE_DATA_URL);
        },
        composeScene: () => {
          return Promise.resolve('data:image/jpeg;base64,scene');
        },
        download,
      });
    });

    await act(async () => {
      await result.current.save();
    });

    expect(download).toHaveBeenCalledWith(
      'data:image/jpeg;base64,scene',
      'autograph_with_bg.jpg'
    );
  });

  it('сохраняет показанную страницу, когда номер обогнал раскладку', async () => {
    const family = buildRenderFamily();

    /**
     * Номер страницы за пределами раскладки: так бывает, пока раскладка не
     * пересчитана под укоротившийся текст, и предпросмотр в это время
     * показывает первую страницу.
     */
    useGeneratorStore.setState({
      presetFamilies: [family],
      familyId: family.id,
      sheetId: family.sheets[0]?.id || '',
      pageIndex: 3,
    });

    const sheetIdAt = buildPageSheetSequence(useGeneratorStore.getState(), family);
    const pages: LayoutPage[] = [0, 1].map((pageIndex) => {
      return {
        sheetId: sheetIdAt(pageIndex),
        lines: [{ text: `страница ${pageIndex}`, paragraphIndex: 0 }],
      };
    });
    const renderPage = vi.fn<ExportDeps['renderPage']>(() => {
      return Promise.resolve(PAGE_DATA_URL);
    });
    const download = vi.fn();
    const { result } = renderHook(() => {
      return {
        source: usePageRender(pages),
        control: useExportPage(useRunRender(pages), { renderPage, download }),
      };
    });

    await act(async () => {
      await result.current.control.save();
    });

    const [task] = renderPage.mock.calls[0] || [];
    const { source } = result.current;
    const shown = source?.buildParams(1);

    expect(download).toHaveBeenCalledTimes(1);
    expect(shown?.page.lines.length).toBeGreaterThan(0);
    expect(task?.params.page).toEqual(shown?.page);
    expect(task?.params.geometry).toEqual(shown?.geometry);
    expect([task?.pageWidth, task?.pageHeight]).toEqual([
      source?.pageWidth,
      source?.pageHeight,
    ]);
  });
});

describe('выгрузка пачки', () => {
  it('показывает в полосе число готовых страниц и общее число', async () => {
    render(<ActionBar plan={PLAN} />);

    await clickButton('Скачать все');

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(`Готово 0 из ${PAGE_COUNT}`);
    });

    await completePage(0);

    expect(screen.getByRole('status').textContent).toBe(`Готово 1 из ${PAGE_COUNT}`);
    expect(getButton('Отменить')).toBeDefined();
    expect(getButton('Скачать все').getAttribute('aria-busy')).toBe('true');
  });

  it('скачивает архив и убирает прогресс, когда пачка дошла до конца', async () => {
    render(<ActionBar plan={PLAN} />);

    await clickButton('Скачать все');

    for (let pageIndex = 0; pageIndex < PAGE_COUNT; pageIndex += 1) {
      await completePage(pageIndex);
    }

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('autograph_pages.zip');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('показывает номер неудавшейся страницы и всё равно отдаёт архив', async () => {
    render(<ActionBar plan={PLAN} />);

    await clickButton('Скачать все');

    await completePage(0);

    await waitFor(() => {
      expect(pendingPages.length).toBeGreaterThan(1);
    });

    vi.mocked(renderPageInWorker).mockRejectedValueOnce(new Error('страница упала'));

    await act(async () => {
      pendingPages[1]?.(new Blob(['page'], { type: 'image/jpeg' }));
    });

    /**
     * Отказ приходится на третью страницу, а её обещание в очередь теста не
     * попадает: следом сразу начинается четвёртая.
     */
    await completePage(2);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Не отрисовались страницы');
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('отмена прекращает генерацию, архив не скачивает и оставляет полосу рабочей', async () => {
    render(<ActionBar plan={PLAN} />);

    await clickButton('Скачать все');

    await waitFor(() => {
      expect(pendingPages).toHaveLength(1);
    });

    await clickButton('Отменить');

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(pendingPages).toHaveLength(1);

    await clickButton('Скачать все');

    await waitFor(() => {
      expect(pendingPages).toHaveLength(2);
    });
  });

  it('не рисует страницы на главном потоке и отдаёт заданиям кадр листа', async () => {
    const createElement = vi.spyOn(document, 'createElement');

    render(<ActionBar plan={PLAN} />);

    await clickButton('Скачать все');

    for (let pageIndex = 0; pageIndex < PAGE_COUNT; pageIndex += 1) {
      await completePage(pageIndex);
    }

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    const canvasCalls = createElement.mock.calls.filter((call) => {
      return String(call[0]) === 'canvas';
    });

    expect(canvasCalls).toHaveLength(0);
    expect(renderPageInWorker).toHaveBeenCalledTimes(PAGE_COUNT);
    expect(vi.mocked(renderPageInWorker).mock.calls[0]?.[0].params.scale).toBe(
      FRAME_SCALE
    );

    createElement.mockRestore();
  });
});
