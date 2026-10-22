/**
 * @vitest-environment jsdom
 */
import { buildSheetRuling } from '@pages/Generator/lib/paper';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { ActionBar } from '@pages/Generator/ui/Generator/ActionBar';
import { HistoryControls } from '@pages/Generator/ui/Generator/HistoryControls';
import { TextPane } from '@pages/Generator/ui/Generator/TextPane';
import { useHistoryHotkeys } from '@pages/Generator/ui/Generator/useHistoryHotkeys';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Кусок экрана генератора, где живут правки и их отмена: поле текста, кнопки
 * истории, полоса действий и обработчик клавиш на документе.
 */
const Harness: FC = () => {
  useHistoryHotkeys();

  return (
    <>
      <HistoryControls />

      <TextPane pageCount={1} />

      <ActionBar plan={null} />
    </>
  );
};

const INITIAL_TEXT = 'раз';

const getButton = (name: string): HTMLButtonElement => {
  const button = screen.getByRole('button', { name });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`«${name}» — не кнопка`);
  }

  return button;
};

const getText = (): string => {
  return useGeneratorStore.getState().text;
};

beforeEach(() => {
  useGeneratorStore.setState({ ...DEFAULT_GENERATOR_STATE, text: INITIAL_TEXT });
});

afterEach(() => {
  cleanup();
  useMarkupEditorStore.getState().close();
});

describe('отмена и повтор', () => {
  it('после загрузки отменять и повторять нечего', () => {
    render(<Harness />);

    expect(getButton('Отменить').disabled).toBe(true);
    expect(getButton('Повторить').disabled).toBe(true);
  });

  it('набранное без пауз слово отменяется одним шагом клавишами в поле текста', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('textbox', { name: 'Текст' }));
    await user.keyboard(' слово');

    expect(getText()).toBe(`${INITIAL_TEXT} слово`);

    await user.keyboard('{Control>}z{/Control}');

    expect(getText()).toBe(INITIAL_TEXT);
    expect(screen.getByDisplayValue(INITIAL_TEXT)).toBeDefined();

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');

    expect(getText()).toBe(`${INITIAL_TEXT} слово`);
  });

  it('клавиши отмены в поле текста не доходят до браузера', () => {
    render(<Harness />);

    const field = screen.getByRole('textbox', { name: 'Текст' });

    expect(fireEvent.keyDown(field, { key: 'z', code: 'KeyZ', metaKey: true })).toBe(
      false
    );
    expect(fireEvent.keyDown(field, { key: 'y', code: 'KeyY', ctrlKey: true })).toBe(
      false
    );
  });

  it('отмена перегенерации возвращает прежний прогон, повтор — новый', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const seedBefore = useGeneratorStore.getState().runSeed;

    await user.click(getButton('Перегенерировать'));

    const seedAfter = useGeneratorStore.getState().runSeed;

    expect(seedAfter).not.toBe(seedBefore);

    await user.click(getButton('Отменить'));

    expect(useGeneratorStore.getState().runSeed).toBe(seedBefore);

    await user.click(getButton('Повторить'));

    expect(useGeneratorStore.getState().runSeed).toBe(seedAfter);
  });

  it('понимает клавиши в русской раскладке и Ctrl+Y', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(getButton('Перегенерировать'));

    const seedAfter = useGeneratorStore.getState().runSeed;

    fireEvent.keyDown(document.body, { key: 'я', code: 'KeyZ', ctrlKey: true });

    expect(useGeneratorStore.getState().runSeed).not.toBe(seedAfter);

    fireEvent.keyDown(document.body, { key: 'н', code: 'KeyY', ctrlKey: true });

    expect(useGeneratorStore.getState().runSeed).toBe(seedAfter);
  });

  it('во время перетаскивания слайдера клавиши отмены не трогают историю', () => {
    render(<Harness />);

    useGeneratorStore.getState().commit({ text: 'шаг' });
    useGeneratorStore.getState().preview({ bottomMargin: 3 });

    const { history } = useGeneratorStore.getState();

    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });

    const state = useGeneratorStore.getState();

    expect(state.history).toBe(history);
    expect(state.history.previewBase).not.toBeNull();
    expect(state.text).toBe('шаг');
    expect(state.bottomMargin).toBe(3);

    /**
     * Отпускание слайдера записывает шаг от значения до перетаскивания, и
     * отмена возвращает к нему, а не к промежуточному значению.
     */
    useGeneratorStore.getState().commit({ bottomMargin: 3 });
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });

    expect(useGeneratorStore.getState().bottomMargin).toBe(
      DEFAULT_GENERATOR_STATE.bottomMargin
    );
    expect(useGeneratorStore.getState().text).toBe('шаг');
  });
});

/**
 * Поле числа и флажок, как в панели редактора разметки: по ним видно, кому
 * достаётся нажатие — набору или истории разметки.
 */
const EditorFieldsHarness: FC = () => {
  useHistoryHotkeys();

  return (
    <>
      <input aria-label="Шаг" defaultValue="30" />

      <input type="checkbox" aria-label="Линии" />
    </>
  );
};

const EDITOR_FRAME = { width: 600, height: 800 };

/**
 * Открывает редактор разметки и делает в нём одну правку.
 */
const openEditedMarkup = () => {
  const record = buildUserSheetRecord({
    familyId: 'lined',
    sheet: {
      id: 'user-sheet',
      label: 'Лист',
      src: 'data:image/jpeg;base64,',
      ...EDITOR_FRAME,
      ruling: buildSheetRuling(
        { step: 30, firstLinePhase: 12, skewAngle: 0 },
        EDITOR_FRAME
      ),
      lighting: null,
      texture: null,
    },
  });

  useMarkupEditorStore.getState().open(record);
  useMarkupEditorStore.getState().commit({ kind: 'grid' });
};

describe('клавиши истории при открытом редакторе разметки', () => {
  it('в поле набора отмена достаётся полю, а не разметке', () => {
    render(<EditorFieldsHarness />);
    openEditedMarkup();

    const isHandled = fireEvent.keyDown(screen.getByRole('textbox', { name: 'Шаг' }), {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
    });

    expect(isHandled).toBe(true);
    expect(useMarkupEditorStore.getState().draft?.kind).toBe('grid');
  });

  it('на флажке отмена по-прежнему отменяет правку разметки', () => {
    render(<EditorFieldsHarness />);
    openEditedMarkup();

    const isHandled = fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Линии' }), {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
    });

    expect(isHandled).toBe(false);
    expect(useMarkupEditorStore.getState().draft?.kind).toBe('lined');
  });
});
