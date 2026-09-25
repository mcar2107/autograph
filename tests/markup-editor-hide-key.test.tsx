/**
 * @vitest-environment jsdom
 */
import { buildSheetRuling, type PaperSheet } from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

const FRAME = { width: 600, height: 800 };

const SHEET_LABEL = 'Тетрадь в линейку';

const SHEET: PaperSheet = {
  id: 'user-hide-key',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: buildSheetRuling(
    {
      step: 40,
      firstLinePhase: 20,
      skewAngle: 0,
      margins: { top: 60, right: 60, bottom: 60, left: 90 },
      marginLineX: 120,
      marginLineSide: 'left',
    },
    FRAME
  ),
  lighting: null,
  texture: null,
};

/**
 * Открывает редактор на листе.
 *
 * @returns диалог редактора
 */
const openEditor = async (): Promise<HTMLElement> => {
  const record = buildUserSheetRecord({ familyId: 'lined', sheet: SHEET });

  useGeneratorStore.getState().addUserSheet(record);
  useMarkupEditorStore.getState().open(record, null);
  render(<SheetMarkupEditor />);

  return screen.findByRole('dialog', { name: `Разметка листа «${SHEET_LABEL}»` });
};

/**
 * Скрыта ли разметка: оверлей в документе, но прозрачен.
 *
 * @param editor — диалог редактора
 * @returns скрыта ли разметка
 */
const isMarkupHidden = (editor: HTMLElement): boolean => {
  return within(editor)
    .getByRole('group', { name: 'Разметка листа' })
    .classList.contains('opacity-0');
};

beforeEach(() => {
  clearLayoutCache();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  useMarkupEditorStore.getState().close();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage?.clear();
});

afterEach(() => {
  cleanup();
});

describe('скрытие разметки клавишей H', () => {
  it('зажатая H прячет всю разметку, отпущенная — возвращает', async () => {
    const editor = await openEditor();

    expect(isMarkupHidden(editor)).toBe(false);

    fireEvent.keyDown(document.body, { code: 'KeyH', key: 'h' });

    expect(isMarkupHidden(editor)).toBe(true);

    fireEvent.keyDown(document.body, { code: 'KeyH', key: 'h', repeat: true });

    expect(isMarkupHidden(editor)).toBe(true);

    fireEvent.keyUp(document.body, { code: 'KeyH', key: 'h' });

    expect(isMarkupHidden(editor)).toBe(false);
  });

  it('в русской раскладке работает та же клавиша', async () => {
    const editor = await openEditor();

    fireEvent.keyDown(document.body, { code: 'KeyH', key: 'р' });

    expect(isMarkupHidden(editor)).toBe(true);
  });

  it('в поле ввода H печатается и разметку не прячет', async () => {
    const user = userEvent.setup();
    const editor = await openEditor();

    await user.click(within(editor).getByText('Точные значения'));

    const [field] = within(editor).getAllByRole('textbox');

    if (!field) {
      throw new Error('Нет поля ввода');
    }

    fireEvent.keyDown(field, { code: 'KeyH', key: 'h' });

    expect(isMarkupHidden(editor)).toBe(false);
  });

  it('с Ctrl, Cmd или Alt это чужое сочетание, а не скрытие', async () => {
    const editor = await openEditor();

    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      fireEvent.keyDown(document.body, { code: 'KeyH', key: 'h', [modifier]: true });

      expect(isMarkupHidden(editor)).toBe(false);
    }
  });

  it('потеря окном фокуса возвращает разметку', async () => {
    const editor = await openEditor();

    fireEvent.keyDown(document.body, { code: 'KeyH', key: 'h' });

    expect(isMarkupHidden(editor)).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(isMarkupHidden(editor)).toBe(false);
  });

  it('подсказка про клавишу видна в панели слоёв', async () => {
    const editor = await openEditor();
    const layers = within(editor).getByRole('group', { name: 'Слои' });

    expect(layers.textContent).toContain('Удерживайте H');
  });
});
