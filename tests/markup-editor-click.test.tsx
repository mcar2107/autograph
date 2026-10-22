/**
 * @vitest-environment jsdom
 */
import { buildSheetRuling, type PaperSheet } from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import {
  selectHasMarkupEdits,
  useMarkupEditorStore,
} from '@pages/Generator/model/useMarkupEditorStore';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

type User = ReturnType<typeof userEvent.setup>;

const LABEL = 'Лист для нажатий';

const FRAME = { width: 600, height: 800 };

/**
 * Поля не на линиях: магнит, сработай он на нажатии, увёл бы их на соседнюю
 * линию, и нажатие стало бы правкой.
 */
const RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: 0.004,
    margins: { top: 95, right: 40, bottom: 67, left: 60 },
    marginLineX: 100,
    marginLineSide: 'left',
  },
  FRAME
);

const SHEET: PaperSheet = {
  id: 'user-click',
  label: LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: RULING,
  lighting: null,
  texture: null,
};

/**
 * Контур с правым нижним углом за краем кадра: так его отдаёт поиск
 * контура, когда лист уходит за снимок. Отпущенный на месте, этот угол
 * зажался бы в кадр и стал бы другим контуром — нажатие, принятое за
 * перетаскивание, завело бы перемер.
 */
const OUTLINED_SHEET: PaperSheet = {
  ...SHEET,
  ruling: {
    ...RULING,
    outline: {
      topLeft: { x: 10, y: 12 },
      topRight: { x: 590, y: 8 },
      bottomRight: { x: 612, y: 815 },
      bottomLeft: { x: 6, y: 790 },
    },
  },
};

/**
 * Открывает редактор листа и выбирает инструмент.
 *
 * @param user — сессия `userEvent`
 * @param tool — имя инструмента
 * @param sheet — лист; по умолчанию без контура
 * @returns диалог редактора
 */
const openTool = async (
  user: User,
  tool: string,
  sheet: PaperSheet = SHEET
): Promise<HTMLElement> => {
  const record = buildUserSheetRecord({ familyId: 'lined', sheet });

  useGeneratorStore.getState().addUserSheet(record);
  useMarkupEditorStore.getState().open(record);
  render(<SheetMarkupEditor />);

  const editor = await screen.findByRole('dialog', { name: `Разметка листа «${LABEL}»` });

  await user.click(within(editor).getByRole('radio', { name: tool }));

  return editor;
};

/**
 * Нажимает на ручку в её центре и отпускает, не сдвигая. Движение указателя
 * в ту же точку — дрожь, которую браузер шлёт и без сдвига руки.
 *
 * @param handle — ручка
 */
const clickHandle = (handle: HTMLElement) => {
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

  const pointer = {
    pointerId: 1,
    clientX: Number(handle.getAttribute('cx')) + 1,
    clientY: Number(handle.getAttribute('cy')) + 1,
  };

  fireEvent.pointerDown(handle, pointer);
  fireEvent.pointerMove(handle, pointer);
  fireEvent.pointerUp(handle, pointer);
};

/**
 * Проверяет, что после нажатия разметка та же и правки нет.
 *
 * @param handle — ручка
 */
const expectClickIsNotEdit = (handle: HTMLElement) => {
  const { draft, history } = useMarkupEditorStore.getState();
  const pastLength = history.past.length;

  clickHandle(handle);

  const state = useMarkupEditorStore.getState();

  expect(state.draft).toStrictEqual(draft);
  expect(state.history.past).toHaveLength(pastLength);
  expect(state.history.previewBase).toBeNull();
};

beforeEach(() => {
  useGeneratorStore.setState({ ...DEFAULT_GENERATOR_STATE, userSheets: [] });
  useMarkupEditorStore.getState().close();
  clearLayoutCache();
});

afterEach(() => {
  cleanup();
});

describe('нажатие на ручку без движения — не правка', () => {
  it('середина края области текста', async () => {
    const editor = await openTool(userEvent.setup(), 'Поля');

    expectClickIsNotEdit(within(editor).getByRole('button', { name: 'Верхнее поле' }));
    expect(selectHasMarkupEdits(useMarkupEditorStore.getState())).toBe(false);
  });

  it('угол области текста', async () => {
    const editor = await openTool(userEvent.setup(), 'Поля');

    expectClickIsNotEdit(
      within(editor).getByRole('button', { name: 'Правый нижний угол полей' })
    );
    expect(selectHasMarkupEdits(useMarkupEditorStore.getState())).toBe(false);
  });

  it('ручка линии поля', async () => {
    const editor = await openTool(userEvent.setup(), 'Поля');

    expectClickIsNotEdit(
      within(editor).getByRole('button', { name: 'Линия поля снизу' })
    );
    expect(selectHasMarkupEdits(useMarkupEditorStore.getState())).toBe(false);
  });

  it('угол контура', async () => {
    const editor = await openTool(userEvent.setup(), 'Контур', OUTLINED_SHEET);

    expectClickIsNotEdit(
      within(editor).getByRole('button', { name: 'Правый нижний угол листа' })
    );
    expect(selectHasMarkupEdits(useMarkupEditorStore.getState())).toBe(false);
    expect(useMarkupEditorStore.getState().isRemeasuring).toBe(false);
  });

  it('конец закреплённой линии', async () => {
    const editor = await openTool(userEvent.setup(), 'Линии');

    expectClickIsNotEdit(
      within(editor).getByRole('button', { name: 'Закреплённая линия 1, левый конец' })
    );
    expect(selectHasMarkupEdits(useMarkupEditorStore.getState())).toBe(false);
  });

  it('ручка линии поля зеркала, заданной отдельно', async () => {
    const user = userEvent.setup();
    const editor = await openTool(user, 'Поля');

    await user.click(within(editor).getByRole('radio', { name: 'Зеркальная страница' }));
    await user.click(within(editor).getByRole('radio', { name: 'Задать отдельно' }));

    expectClickIsNotEdit(
      within(editor).getByRole('button', { name: 'Линия поля зеркала снизу' })
    );
  });
});

describe('шаг истории — только по изменению значений', () => {
  it('отпускание в прежнем месте после перетаскивания шага не заводит', async () => {
    await openTool(userEvent.setup(), 'Поля');

    const { preview, commit } = useMarkupEditorStore.getState();
    const draft = useMarkupEditorStore.getState().draft;

    if (!draft) {
      throw new Error('Редактор закрыт');
    }

    const { ruling } = draft;

    preview({ ruling: { ...ruling, margins: { ...ruling.margins, top: 120 } } });
    commit({ ruling: { ...ruling, margins: { ...ruling.margins } } });

    const state = useMarkupEditorStore.getState();

    expect(state.draft?.ruling).toStrictEqual(ruling);
    expect(state.history.past).toHaveLength(0);
    expect(selectHasMarkupEdits(state)).toBe(false);
  });

  it('правка, изменившая значение, — шаг истории', async () => {
    await openTool(userEvent.setup(), 'Поля');

    const { commit, draft } = useMarkupEditorStore.getState();

    if (!draft) {
      throw new Error('Редактор закрыт');
    }

    const { ruling } = draft;

    commit({ ruling: { ...ruling, margins: { ...ruling.margins, top: 120 } } });

    expect(useMarkupEditorStore.getState().history.past).toHaveLength(1);
  });
});
