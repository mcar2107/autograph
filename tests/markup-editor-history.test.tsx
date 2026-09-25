/**
 * @vitest-environment jsdom
 */
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import {
  buildSheetRuling,
  type PaperSheet,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import { selectBlockGeometry } from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { PaperPicker } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { useHistoryHotkeys } from '@pages/Generator/ui/Generator/useHistoryHotkeys';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Выбор бумаги и редактор так, как их собирает экран генератора, вместе с
 * его клавишами истории: редактор обязан перехватить их у генератора.
 */
const EditorHarness: FC = () => {
  useHistoryHotkeys();

  return (
    <>
      <PaperPicker />

      <SheetMarkupEditor />
    </>
  );
};

type User = ReturnType<typeof userEvent.setup>;

const LABEL = 'Мой лист';

const FRAME = { width: 600, height: 800 };

/**
 * Разлиновка, найденная автоматом: ровная, с линией поля слева.
 */
const MEASURED_RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: 0,
    margins: { top: 90, right: 40, bottom: 70, left: 60 },
    marginLineX: 100,
    marginLineSide: 'left',
  },
  FRAME
);

const SHEET: PaperSheet = {
  id: 'user-sheet',
  label: LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: MEASURED_RULING,
  lighting: null,
  texture: null,
};

/**
 * Ставит лист в выбор бумаги и открывает его редактор кнопкой на плитке.
 *
 * @param user — сессия `userEvent`
 * @returns диалог редактора
 */
const openEditor = async (user: User): Promise<HTMLElement> => {
  useGeneratorStore
    .getState()
    .addUserSheet(buildUserSheetRecord({ familyId: 'lined', sheet: SHEET }));
  render(<EditorHarness />);
  await user.click(screen.getByRole('button', { name: `Разметка листа «${LABEL}»` }));

  return await screen.findByRole('dialog', { name: `Разметка листа «${LABEL}»` });
};

/**
 * Удаляет линию поля в черновике, как это сделал бы инструмент «Поля».
 */
const removeMarginLine = () => {
  act(() => {
    useMarkupEditorStore.getState().commit(({ ruling }) => {
      return { ruling: { ...ruling, marginLineX: null, marginLineSide: null } };
    });
  });
};

/**
 * Линия поля в оверлее редактора.
 *
 * @param editor — диалог редактора
 * @returns элемент линии поля; `null` — её нет
 */
const queryMarginLine = (editor: HTMLElement): Element | null => {
  return editor.querySelector('[data-layer="marginLine"]');
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

describe('история редактора разметки', () => {
  it('Ctrl+Z возвращает удалённую линию поля, Ctrl+Shift+Z снова её убирает', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);

    removeMarginLine();

    expect(queryMarginLine(editor)).toBeNull();

    await user.keyboard('{Control>}z{/Control}');

    expect(queryMarginLine(editor)).not.toBeNull();

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');

    expect(queryMarginLine(editor)).toBeNull();

    await user.keyboard('{Meta>}z{/Meta}');

    expect(queryMarginLine(editor)).not.toBeNull();
  });

  it('клавиши отмены в редакторе не трогают историю генератора', async () => {
    const user = userEvent.setup();

    useGeneratorStore.getState().commit({ text: 'правка генератора' });

    const editor = await openEditor(user);

    removeMarginLine();
    await user.keyboard('{Control>}z{/Control}');

    expect(queryMarginLine(editor)).not.toBeNull();
    expect(useGeneratorStore.getState().text).toBe('правка генератора');
    expect(useGeneratorStore.getState().history.past).toHaveLength(1);

    await user.keyboard('{Control>}z{/Control}');
    await user.keyboard('{Control>}y{/Control}');

    const { text, history } = useGeneratorStore.getState();

    expect(queryMarginLine(editor)).toBeNull();
    expect(text).toBe('правка генератора');
    expect(history.past).toHaveLength(1);
    expect(history.future).toHaveLength(0);
  });

  it('после закрытия редактора клавиши снова отменяют правки генератора', async () => {
    const user = userEvent.setup();

    useGeneratorStore.getState().commit({ text: 'правка генератора' });

    const editor = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Отмена' }));
    await user.keyboard('{Control>}z{/Control}');

    expect(useGeneratorStore.getState().text).toBe(DEFAULT_GENERATOR_STATE.text);
  });

  it('«Сбросить к найденному» возвращает разметку автомата после ручной правки', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);

    useMarkupEditorStore.getState().commit(({ ruling }) => {
      return { ruling: { ...ruling, step: 45, marginLineX: null, marginLineSide: null } };
    });
    await user.click(
      within(editor).getByRole('button', { name: 'Сбросить к найденному' })
    );

    expect(useMarkupEditorStore.getState().draft?.ruling).toBe(MEASURED_RULING);
    expect(queryMarginLine(editor)).not.toBeNull();

    await user.keyboard('{Control>}z{/Control}');

    expect(useMarkupEditorStore.getState().draft?.ruling.step).toBe(45);
  });
});

describe('кнопки истории редактора', () => {
  it('«Отменить» и «Повторить» в подвале отменяют и повторяют правку', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);
    const history = within(editor).getByRole('toolbar', { name: 'История правок' });
    const undo = within(history).getByRole('button', { name: 'Отменить' });
    const redo = within(history).getByRole('button', { name: 'Повторить' });

    expect(undo).toHaveProperty('disabled', true);
    expect(redo).toHaveProperty('disabled', true);

    removeMarginLine();

    expect(undo).toHaveProperty('disabled', false);

    await user.click(undo);

    expect(queryMarginLine(editor)).not.toBeNull();
    expect(undo).toHaveProperty('disabled', true);
    expect(redo).toHaveProperty('disabled', false);

    await user.click(redo);

    expect(queryMarginLine(editor)).toBeNull();
    expect(redo).toHaveProperty('disabled', true);
  });

  it('кнопки редактора не трогают историю генератора', async () => {
    const user = userEvent.setup();

    useGeneratorStore.getState().commit({ text: 'правка генератора' });

    const editor = await openEditor(user);

    removeMarginLine();
    await user.click(within(editor).getByRole('button', { name: 'Отменить' }));

    expect(queryMarginLine(editor)).not.toBeNull();
    expect(useGeneratorStore.getState().text).toBe('правка генератора');
  });
});

/**
 * Подзаголовок диалога редактора — его доступное описание.
 *
 * @param editor — диалог редактора
 * @returns текст подзаголовка
 */
const readSubtitle = (editor: HTMLElement): string => {
  const id = editor.getAttribute('aria-describedby') || '';

  return document.getElementById(id)?.textContent || '';
};

describe('подзаголовок редактора', () => {
  it('у листа с разметкой автомата — «найденная на фотографии»', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);

    expect(readSubtitle(editor)).toMatch(/^Разметка, найденная на\u00A0фотографии\./);
  });

  it('после сохранённой правки повторное открытие называет разметку сохранённой', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);

    removeMarginLine();
    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    await user.click(screen.getByRole('button', { name: `Разметка листа «${LABEL}»` }));

    const reopened = await screen.findByRole('dialog', {
      name: `Разметка листа «${LABEL}»`,
    });

    expect(readSubtitle(reopened)).toMatch(/^Сохранённая разметка/);
  });

  it('разлиновка, равная найденной, но прочитанная отдельно, — всё ещё найденная', async () => {
    const user = userEvent.setup();

    useGeneratorStore.getState().addUserSheet({
      ...buildUserSheetRecord({ familyId: 'lined', sheet: SHEET }),
      measuredRuling: structuredClone(MEASURED_RULING),
    });
    render(<EditorHarness />);
    await user.click(screen.getByRole('button', { name: `Разметка листа «${LABEL}»` }));

    const editor = await screen.findByRole('dialog', {
      name: `Разметка листа «${LABEL}»`,
    });

    expect(readSubtitle(editor)).toMatch(/^Разметка, найденная/);
  });

  it('сменённый вид разлиновки — тоже сохранённая разметка', async () => {
    const user = userEvent.setup();

    useGeneratorStore.getState().addUserSheet({
      ...buildUserSheetRecord({ familyId: 'lined', sheet: SHEET }),
      measuredKind: 'grid',
    });
    render(<EditorHarness />);
    await user.click(screen.getByRole('button', { name: `Разметка листа «${LABEL}»` }));

    const editor = await screen.findByRole('dialog', {
      name: `Разметка листа «${LABEL}»`,
    });

    expect(readSubtitle(editor)).toMatch(/^Сохранённая разметка/);
  });
});

describe('закрытие редактора с правками', () => {
  it('«Отмена» с правками спрашивает подтверждение, и после него лист прежний', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);
    const [record] = useGeneratorStore.getState().userSheets;

    removeMarginLine();
    await user.click(within(editor).getByRole('button', { name: 'Отмена' }));

    const confirm = within(editor).getByRole('group', {
      name: 'Подтверждение закрытия',
    });

    expect(screen.getByRole('dialog')).toBe(editor);

    await user.click(
      within(confirm).getByRole('button', { name: 'Закрыть без сохранения' })
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useGeneratorStore.getState().userSheets[0]).toBe(record);
  });

  it('«Продолжить правку» оставляет редактор с правками открытым', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);

    removeMarginLine();
    await user.click(within(editor).getByRole('button', { name: 'Закрыть' }));

    const confirm = within(editor).getByRole('group', {
      name: 'Подтверждение закрытия',
    });

    expect(document.activeElement).toBe(confirm);

    await user.click(within(confirm).getByRole('button', { name: 'Продолжить правку' }));

    expect(
      within(editor).queryByRole('group', { name: 'Подтверждение закрытия' })
    ).toBeNull();
    expect(screen.getByRole('dialog')).toBe(editor);
    expect(queryMarginLine(editor)).toBeNull();
  });

  it('Esc с правками тоже спрашивает подтверждение', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);

    removeMarginLine();
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBe(editor);
    expect(
      within(editor).getByRole('group', { name: 'Подтверждение закрытия' })
    ).toBeDefined();
  });

  it('без правок редактор закрывается сразу', async () => {
    const user = userEvent.setup();

    await openEditor(user);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('сохранение разметки', () => {
  it('сохранённая разметка доезжает до геометрии страницы на этом листе', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);
    const edited: SheetRuling = {
      ...MEASURED_RULING,
      margins: { ...MEASURED_RULING.margins, left: 200 },
      marginLineX: null,
      marginLineSide: null,
    };

    const readLeft = () => {
      return selectBlockGeometry(useGeneratorStore.getState(), 0, FALLBACK_FONT_METRICS)
        ?.leftPadding;
    };

    const before = readLeft() || 0;

    expect(before).toBeLessThan(150);

    useMarkupEditorStore.getState().commit({ ruling: edited });

    expect(readLeft()).toBe(before);

    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readLeft()).toBeGreaterThan(190);
  });
});
