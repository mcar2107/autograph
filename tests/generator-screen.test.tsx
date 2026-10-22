/**
 * @vitest-environment jsdom
 */
import { App } from '@app/App';
import type { LayoutPage } from '@pages/Generator/lib/paginate/paginate.types';
import { renderPageInWorker } from '@pages/Generator/model/createPageRenderClient';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import type { PageRenderTask } from '@pages/Generator/model/pageTask.types';
import { selectPageSheetId } from '@pages/Generator/model/recipeSelectors';
import { useExportPage } from '@pages/Generator/model/useExportPage';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { usePageLayout } from '@pages/Generator/model/usePageLayout';
import { usePageRender } from '@pages/Generator/model/usePageRender';
import { useRunRender } from '@pages/Generator/model/useRunRender';
import { ActionBar } from '@pages/Generator/ui/Generator/ActionBar';
import { SettingsPane } from '@pages/Generator/ui/Generator/SettingsPane';
import {
  getPartnerIndex,
  SheetViewport,
} from '@pages/Generator/ui/Generator/SheetViewport';
import { downloadDataUrl, readBlobAsDataUrl } from '@shared/lib/files';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';
import { buildRenderFamily } from './helpers/paper-family';
import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { RULED_PHOTO, uploadUserPhoto } from './helpers/user-sheet-photo';

/**
 * Съём пикселей фотографии подменяется: канвы в jsdom нет.
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
 * Отрисовка в воркере подменяется: растра в jsdom нет, а проверяется, какое
 * задание уходит на сохранение.
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

const PAGE_DATA_URL = 'data:image/jpeg;base64,page';

const FAMILY = buildRenderFamily();

/**
 * Запас снизу, оставляющий на листе семьи-модели две строки: четыре коротких
 * слова на страницу.
 */
const TWO_LINE_BOTTOM_MARGIN = 7;

/**
 * Четыре страницы по четыре слова: есть и текущая, и её пара в развороте.
 */
const FOUR_PAGE_TEXT = Array.from({ length: 16 }, () => {
  return 'раз';
}).join(' ');

/**
 * Текущая страница в проверке разворота: вторая, то есть правая половина
 * первого разворота.
 */
const CURRENT_PAGE_INDEX = 1;

/**
 * Раскладка из одной пустой страницы: сохранению есть что отдать, а мерить
 * текст незачем.
 */
const ONE_EMPTY_PAGE: LayoutPage[] = [{ sheetId: '', lines: [] }];

/**
 * Колонка оформления со ссылкой на инструкцию о своём шрифте: ей нужен
 * роутер.
 */
const renderSettingsPane = () => {
  render(
    <MemoryRouter>
      <SettingsPane />
    </MemoryRouter>
  );
};

type User = ReturnType<typeof userEvent.setup>;

/**
 * Область просмотра и полоса действий так, как их собирает экран: оба
 * получают один план прогона.
 */
const ViewportWithActions: FC = () => {
  const pages = usePageLayout(createMonospaceMeasurerFactory({ charWidth: 0.2 }).create);
  const source = usePageRender(pages);
  const plan = useRunRender(pages);
  const partnerSource = usePageRender(pages, getPartnerIndex(plan?.pageIndex || 0));

  return (
    <>
      <SheetViewport
        source={source}
        partnerSource={partnerSource}
        plan={plan}
        detailDeps={{
          renderPage: () => {
            return new Promise<Blob>(() => {});
          },
        }}
      />

      <ActionBar plan={plan} />
    </>
  );
};

/**
 * Раскрывает экспертный режим и в нём группу.
 *
 * @param user — сессия `userEvent`
 * @param section — заголовок группы
 */
const openExpertSection = async (user: User, section: string) => {
  await user.click(screen.getByRole('button', { name: 'Экспертный режим' }));
  await user.click(screen.getByRole('button', { name: section }));
};

/**
 * Задание, с которым сохранение ушло в воркер последним.
 *
 * @returns задание отрисовки
 */
const getLastSavedTask = (): PageRenderTask => {
  const { calls } = vi.mocked(renderPageInWorker).mock;
  const [task] = calls[calls.length - 1] || [];

  if (!task) {
    throw new Error('Сохранение не заказало отрисовку');
  }

  return task;
};

beforeEach(() => {
  useMarkupEditorStore.getState().close();
  clearLayoutCache();
  globalThis.localStorage?.clear();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  decodeSheetImage.mockReset();
  vi.mocked(renderPageInWorker).mockReset();
  vi.mocked(renderPageInWorker).mockResolvedValue(
    new Blob(['page'], { type: 'image/jpeg' })
  );
  vi.mocked(readBlobAsDataUrl).mockResolvedValue(PAGE_DATA_URL);
  vi.mocked(downloadDataUrl).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('экран генератора на маршруте «/»', () => {
  it('показывает текст, лист, основной путь оформления и полосу действий', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('page')).toBeDefined();
    });

    expect(screen.getByRole('textbox', { name: 'Текст' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Вписать' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: 'Семья листов' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Почерк' })).toBeDefined();

    const inks = within(screen.getByRole('radiogroup', { name: 'Цвет чернил' }));

    expect(inks.getAllByRole('radio').length).toBeGreaterThan(1);
    expect(inks.queryByRole('radio', { name: 'Авто' })).toBeNull();
    expect(
      inks.getByRole('radio', { name: 'Синяя шариковая' }).getAttribute('aria-checked')
    ).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Реализм' })).toBeDefined();
    expect(
      screen
        .getByRole('button', { name: 'Экспертный режим' })
        .getAttribute('aria-expanded')
    ).toBe('false');

    for (const name of ['Перегенерировать', 'Сохранить страницу', 'Скачать все']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
  });
});

describe('полоса действий без текста', () => {
  it('связывает недоступные кнопки с причиной', () => {
    useGeneratorStore.setState({ text: '' });

    render(<ActionBar plan={null} />);

    for (const name of ['Сохранить страницу', 'Скачать все']) {
      const button = screen.getByRole('button', { name });

      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBeTruthy();
      expect(
        document.getElementById(button.getAttribute('aria-describedby') || '')
          ?.textContent
      ).toBe('Введите текст, чтобы сохранить страницы');
    }
  });

  it('с текстом кнопки ни на что не ссылаются', () => {
    render(<ActionBar plan={null} />);

    expect(
      screen
        .getByRole('button', { name: 'Сохранить страницу' })
        .hasAttribute('aria-describedby')
    ).toBe(false);
  });
});

describe('сохранение страницы', () => {
  it('при выключенной сцене не вкладывает страницу в сцену', async () => {
    useGeneratorStore.setState({
      presetFamilies: [FAMILY],
      familyId: FAMILY.id,
      sheetId: FAMILY.sheets[0]?.id || '',
    });

    const composeScene = vi.fn(() => {
      return Promise.resolve('data:image/jpeg;base64,scene');
    });
    const download = vi.fn();

    expect(useGeneratorStore.getState().isSceneEnabled).toBe(false);

    const { result } = renderHook(() => {
      return useExportPage(useRunRender(ONE_EMPTY_PAGE), {
        renderPage: () => {
          return Promise.resolve(PAGE_DATA_URL);
        },
        composeScene,
        download,
      });
    });

    await act(async () => {
      await result.current.save();
    });

    expect(composeScene).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(PAGE_DATA_URL, 'autograph_page.jpg');
  });

  it('разворот не меняет сохранённую страницу', async () => {
    const user = userEvent.setup();

    useGeneratorStore.setState({
      presetFamilies: [FAMILY],
      familyId: FAMILY.id,
      sheetId: FAMILY.sheets[0]?.id || '',
      bottomMargin: TWO_LINE_BOTTOM_MARGIN,
      text: FOUR_PAGE_TEXT,
      pageIndex: CURRENT_PAGE_INDEX,
    });

    render(<ViewportWithActions />);

    await waitFor(() => {
      expect(screen.getByTestId('page-count').textContent).toBe('/ 4');
    });

    await user.click(screen.getByRole('button', { name: 'Сохранить страницу' }));
    await waitFor(() => {
      expect(downloadDataUrl).toHaveBeenCalledTimes(1);
    });

    const single = getLastSavedTask();

    await user.click(screen.getByRole('radio', { name: 'Разворот' }));

    expect(useGeneratorStore.getState().isSpread).toBe(true);
    expect(screen.getAllByRole('button', { name: /^Страница \d$/ }).length).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Сохранить страницу' }));
    await waitFor(() => {
      expect(downloadDataUrl).toHaveBeenCalledTimes(2);
    });

    const spread = getLastSavedTask();

    expect(spread.params).toEqual(single.params);
    expect([spread.pageWidth, spread.pageHeight]).toEqual([
      single.pageWidth,
      single.pageHeight,
    ]);
    expect(vi.mocked(downloadDataUrl).mock.calls[1]).toEqual(
      vi.mocked(downloadDataUrl).mock.calls[0]
    );
  });
});

describe('колонка оформления', () => {
  it('неудачный импорт открывает ровно один редактор листа', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(
      createSyntheticSheet({
        ...RULED_PHOTO,
        kind: 'blank',
        marginLineX: null,
        noise: 0.06,
        lighting: 0.3,
      })
    );

    renderSettingsPane();
    await uploadUserPhoto(user);

    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBe(1);
    });

    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('кнопка настройки плитки открывает редактор своего листа', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    renderSettingsPane();
    await uploadUserPhoto(user);

    /**
     * Импорт открывает редактор сам, и с разлиновкой тоже: кнопка настройки
     * проверяется после его закрытия.
     */
    expect(screen.getAllByRole('dialog').length).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(await screen.findByRole('button', { name: /^Разметка листа «/ }));

    expect(screen.getAllByRole('dialog').length).toBe(1);
  });

  it('после смены семьи на странице лист новой семьи', async () => {
    const user = userEvent.setup();

    renderSettingsPane();

    const { presetFamilies, familyId } = useGeneratorStore.getState();
    const nextFamily = presetFamilies.find((family) => {
      return family.id !== familyId;
    });

    if (!nextFamily) {
      throw new Error('Для проверки нужны две семьи');
    }

    await user.click(screen.getByRole('radio', { name: nextFamily.label }));

    const state = useGeneratorStore.getState();
    const nextSheetIds = nextFamily.sheets.map(({ id }) => {
      return id;
    });

    expect(state.familyId).toBe(nextFamily.id);
    expect(nextSheetIds).toContain(selectPageSheetId(state, 0));
    expect(nextSheetIds).toContain(selectPageSheetId(state, 1));
  });
});

describe('экспертный режим в колонке оформления', () => {
  it('поправка геометрии ходит долями шага и сбрасывается к вычисленной', async () => {
    const user = userEvent.setup();

    renderSettingsPane();
    await openExpertSection(user, 'Геометрия');

    const fontSize = screen.getByRole('slider', { name: 'Размер шрифта' });
    const leftPadding = screen.getByRole('slider', { name: 'Левый отступ' });

    expect(fontSize.getAttribute('aria-valuemax')).toBe('0.25');
    expect(leftPadding.getAttribute('aria-valuemin')).toBe('-2');

    leftPadding.focus();
    await user.keyboard('{ArrowRight}');

    expect(useGeneratorStore.getState().geometryCorrection.leftPadding).toBe(0.05);

    await user.click(screen.getByRole('button', { name: 'Сбросить поправку' }));

    expect(useGeneratorStore.getState().geometryCorrection).toEqual(
      DEFAULT_GENERATOR_STATE.geometryCorrection
    );
  });

  it('отступ чётных страниц и поворот блока отдельно не настраиваются', async () => {
    const user = userEvent.setup();

    renderSettingsPane();
    await openExpertSection(user, 'Геометрия');

    expect(screen.queryByRole('slider', { name: 'Отступ чётных страниц' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Поворот блока' })).toBeNull();
  });

  it('вариативность контуров включена по умолчанию и выключается', async () => {
    const user = userEvent.setup();

    renderSettingsPane();
    await openExpertSection(user, 'Почерк');

    const toggle = screen.getByRole('checkbox', { name: 'Вариативность контуров букв' });

    expect(toggle.getAttribute('data-state')).toBe('checked');

    await user.click(toggle);

    expect(useGeneratorStore.getState().realism.hasContourVariance).toBe(false);
  });
});
