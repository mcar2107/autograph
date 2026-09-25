/**
 * @vitest-environment jsdom
 */
import {
  buildSheetRuling,
  type PaperSheet,
  type RulingPin,
  type SheetPoint,
} from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import type { PageRenderTask } from '@pages/Generator/model/pageTask.types';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Заказ страницы у воркера отрисовки: тест решает, когда и чем он
 * ответит.
 */
type PendingRender = {
  /**
   * Задание на отрисовку.
   */
  task: PageRenderTask;

  /**
   * Сигнал отмены заказа.
   */
  signal: AbortSignal | undefined;

  /**
   * Ответить готовой страницей.
   */
  resolve: (page: Blob) => void;
};

const { renderPage, pending } = vi.hoisted(() => {
  const requests: PendingRender[] = [];

  return {
    pending: requests,
    renderPage: vi.fn((task: PageRenderTask, signal?: AbortSignal) => {
      return new Promise<Blob>((resolve) => {
        requests.push({ task, signal, resolve });
      });
    }),
  };
});

vi.mock('@pages/Generator/model/createPageRenderClient', () => {
  return { renderPageInWorker: renderPage };
});

/**
 * Настоящих размеров jsdom не считает: строки меряет модель с фиксированной
 * шириной символа.
 */
vi.mock('@pages/Generator/lib/measure/createDomMeasurer', async () => {
  const { createMonospaceMeasurerFactory } = await import('./helpers/monospace-measurer');

  return { createDomMeasurer: createMonospaceMeasurerFactory().create };
});

/**
 * Пауза, за которую заказ по отпусканию точно ушёл: дебаунс — 150 мс.
 */
const SETTLE_MS = 400;

const PHOTO = {
  ...RULED_PHOTO,
  width: 600,
  height: 800,
  step: 40,
  phase: 20,
  margins: { top: 60, right: 60, bottom: 60, left: 90 },
  marginLineX: 120,
};

const FRAME = { width: PHOTO.width, height: PHOTO.height };

const SHEET_LABEL = 'Тетрадь в линейку';

const TRIAL_NAME = 'Пробный текст по разметке';

const RULING = buildSheetRuling(
  {
    step: PHOTO.step,
    firstLinePhase: PHOTO.phase,
    skewAngle: 0,
    margins: PHOTO.margins,
    marginLineX: PHOTO.marginLineX,
    marginLineSide: 'left',
  },
  FRAME
);

const PINS: RulingPin[] = [3, 13].map((index) => {
  const y = PHOTO.phase + index * PHOTO.step;

  return { index, left: { x: 150, y }, right: { x: 500, y } };
});

const SHEET: PaperSheet = {
  id: 'user-trial',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: RULING,
  lighting: null,
  texture: null,
};

/**
 * Адреса, выданные готовым страницам, и отозванные из них.
 */
const objectUrls = { created: [] as string[], revoked: [] as string[] };

/**
 * Ждёт, пока истекут таймеры редактора.
 *
 * @param ms — сколько ждать
 */
const settle = async (ms: number = SETTLE_MS) => {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  });
};

/**
 * Открывает редактор на листе и включает пробный текст.
 *
 * @param text — текст в поле ввода генератора
 * @returns диалог редактора
 */
const openWithTrial = async (
  text = 'Первая пробная строка.\nВторая пробная строка.'
): Promise<HTMLElement> => {
  const user = userEvent.setup();
  const record = {
    ...buildUserSheetRecord({ familyId: 'lined', sheet: SHEET }),
    pins: PINS,
  };

  useGeneratorStore.getState().addUserSheet(record);
  useGeneratorStore.setState({
    familyId: 'lined',
    sheetId: SHEET.id,
    isSheetPinned: true,
    text,
  });
  useMarkupEditorStore.getState().open(record, null);
  render(<SheetMarkupEditor />);

  const editor = await screen.findByRole('dialog', {
    name: `Разметка листа «${SHEET_LABEL}»`,
  });

  await user.click(within(editor).getByRole('checkbox', { name: 'Пробный текст' }));

  return editor;
};

/**
 * Отвечает на заказ страницей.
 *
 * @param order — номер заказа, с нуля
 */
const answer = async (order: number) => {
  await act(async () => {
    pending[order]?.resolve(new Blob([String(order)], { type: 'image/jpeg' }));
    await Promise.resolve();
  });
};

/**
 * Тянет конец булавки и держит его, не отпуская.
 *
 * @param handle — ручка
 * @param point — куда, px фотографии
 */
const dragWithoutRelease = (handle: HTMLElement, point: SheetPoint) => {
  const svg = handle.closest('svg');

  if (!svg) {
    throw new Error('Ручка вне SVG');
  }

  Object.defineProperty(svg, 'getScreenCTM', {
    configurable: true,
    value: () => {
      return {
        inverse: () => {
          return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        },
      };
    },
  });
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, altKey: true });
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
    altKey: true,
  });
};

/**
 * Показанный пробный текст.
 *
 * @returns адрес его растра; `null` — не показан
 */
const readTrialSrc = (): string | null => {
  return screen.queryByRole('img', { name: TRIAL_NAME })?.getAttribute('src') || null;
};

beforeEach(() => {
  clearLayoutCache();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  useMarkupEditorStore.getState().close();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage?.clear();
  pending.length = 0;
  renderPage.mockClear();
  objectUrls.created = [];
  objectUrls.revoked = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => {
      const url = `blob:trial-${objectUrls.created.length}`;

      objectUrls.created.push(url);

      return url;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => {
      objectUrls.revoked.push(url);
    },
  });
});

afterEach(() => {
  cleanup();
});

describe('пробный текст', () => {
  it('выключен — страницу у воркера не заказывает; включён — один заказ по черновой разметке', async () => {
    const record = buildUserSheetRecord({ familyId: 'lined', sheet: SHEET });

    useGeneratorStore.getState().addUserSheet(record);
    useMarkupEditorStore.getState().open({ ...record, pins: PINS }, null);
    render(<SheetMarkupEditor />);
    await screen.findByRole('dialog', { name: `Разметка листа «${SHEET_LABEL}»` });
    await settle();

    expect(renderPage).not.toHaveBeenCalled();

    cleanup();
    await openWithTrial();
    await settle();

    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(pending[0]?.task.sheet?.src).toBe(SHEET.src);
    expect(pending[0]?.task.pageWidth).toBe(FRAME.width);
    expect(pending[0]?.task.params.scale).toBeGreaterThan(0);
    expect(pending[0]?.task.params.scale).toBeLessThanOrEqual(1);
    expect(pending[0]?.task.params.page.lines.length).toBeGreaterThan(0);

    await answer(0);

    await waitFor(() => {
      expect(readTrialSrc()).toBe('blob:trial-0');
    });
  });

  it('перетаскивание страницу не заказывает, после отпускания уходит один заказ, и текст перекладывается', async () => {
    const editor = await openWithTrial();

    await settle();
    await answer(0);

    const handle = within(editor).getByRole('button', {
      name: 'Закреплённая линия 2, правый конец',
    });

    dragWithoutRelease(handle, { x: 500, y: 560 });
    await settle();

    expect(renderPage).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(handle, {
      pointerId: 1,
      clientX: 500,
      clientY: 560,
      altKey: true,
    });

    /**
     * Правка ложится сразу, не дожидаясь пробного текста.
     */
    expect(useMarkupEditorStore.getState().draft?.pins[1]?.right).toStrictEqual({
      x: 500,
      y: 560,
    });
    expect(readTrialSrc()).toBeNull();

    await settle();

    expect(renderPage).toHaveBeenCalledTimes(2);

    await settle();

    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(pending[1]?.task.params.geometry.fontSizePx).not.toBe(
      pending[0]?.task.params.geometry.fontSizePx
    );

    await answer(1);

    await waitFor(() => {
      expect(readTrialSrc()).toBe('blob:trial-1');
    });
  });

  it('устаревший ответ не показывается, даже если пришёл позже нового', async () => {
    await openWithTrial();
    await settle();

    const { commit } = useMarkupEditorStore.getState();

    act(() => {
      commit((draft) => {
        return {
          ruling: { ...draft.ruling, margins: { ...draft.ruling.margins, left: 100 } },
        };
      });
    });
    await settle();
    act(() => {
      commit((draft) => {
        return {
          ruling: { ...draft.ruling, margins: { ...draft.ruling.margins, left: 110 } },
        };
      });
    });
    await settle();

    expect(renderPage).toHaveBeenCalledTimes(3);
    expect(pending[1]?.signal?.aborted).toBe(true);

    await answer(2);

    await waitFor(() => {
      expect(readTrialSrc()).toBe('blob:trial-0');
    });

    await answer(1);
    await answer(0);
    await settle(50);

    expect(readTrialSrc()).toBe('blob:trial-0');
    expect(objectUrls.created).toStrictEqual(['blob:trial-0']);
  });

  it('выключенный пробный текст убирается с фотографии', async () => {
    const user = userEvent.setup();
    const editor = await openWithTrial();

    await settle();
    await answer(0);

    await waitFor(() => {
      expect(readTrialSrc()).toBe('blob:trial-0');
    });

    await user.click(within(editor).getByRole('checkbox', { name: 'Пробный текст' }));

    expect(readTrialSrc()).toBeNull();
  });

  it('короткий текст заполняет страницу целиком: сначала он сам, дальше — его повтор одним абзацем', async () => {
    await openWithTrial('слово '.repeat(2000));
    await settle();

    const capacity = pending[0]?.task.params.page.lines.length || 0;

    cleanup();
    pending.length = 0;
    await openWithTrial();
    await settle();

    const lines = pending[0]?.task.params.page.lines || [];
    const texts = lines.map(({ words }) => {
      return words
        .map(({ text }) => {
          return text;
        })
        .join(' ');
    });

    expect(capacity).toBeGreaterThan(3);
    expect(lines).toHaveLength(capacity);
    const pageText = texts.join(' ');

    expect(
      pageText.startsWith(
        'Первая пробная строка. Вторая пробная строка. Первая пробная строка. Вторая пробная строка.'
      )
    ).toBe(true);
    expect(pageText.split('Первая пробная строка.').length - 1).toBeGreaterThan(2);
  });

  it('пустое поле ввода — страница целиком из образца', async () => {
    await openWithTrial('слово '.repeat(2000));
    await settle();

    const capacity = pending[0]?.task.params.page.lines.length || 0;

    cleanup();
    pending.length = 0;
    await openWithTrial('   ');
    await settle();

    expect(pending[0]?.task.params.page.lines).toHaveLength(capacity);
  });

  it('под пробным текстом линии разметки приглушены, у закреплённых линий — только концы', async () => {
    const user = userEvent.setup();
    const editor = await openWithTrial();
    const overlay = within(editor).getByRole('group', { name: 'Разметка листа' });

    expect(overlay.querySelector('[data-muted] [data-layer="lines"]')).not.toBeNull();
    expect(overlay.querySelectorAll('[data-layer="pins"] line')).toHaveLength(0);

    await user.click(within(editor).getByRole('checkbox', { name: 'Пробный текст' }));

    expect(overlay.querySelector('[data-muted]')).toBeNull();
    expect(overlay.querySelectorAll('[data-layer="pins"] line')).toHaveLength(
      PINS.length
    );
  });
});
