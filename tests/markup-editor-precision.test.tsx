/**
 * @vitest-environment jsdom
 */
import {
  buildSheetRuling,
  lineHeightAt,
  type PaperSheet,
  type RulingPin,
  sampleRulingBend,
  type SheetImageData,
  type SheetPoint,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import type { MarkupDraft } from '@pages/Generator/model/useMarkupEditorStore.types';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Съём пикселей подменяется: канвы в jsdom нет, а перемер контура по
 * стрелке ждёт снимок, которого тест не отдаёт.
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
 * Снимок линейки, на котором магнит различает линию и фон, — тот же, что у
 * тестов инструмента «Линии».
 */
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

const PHOTO_SRC = 'data:image/jpeg;base64,0123456789';

/**
 * Радиус ручки в экранных пикселях — по нему читается масштаб окна.
 */
const HANDLE_RADIUS = 10;

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

const PIN_LEFT = 150;

const PIN_RIGHT = 500;

/**
 * Булавки на линиях 3 и 13 снимка.
 */
const PINS: RulingPin[] = [3, 13].map((index) => {
  const y = PHOTO.phase + index * PHOTO.step;

  return { index, left: { x: PIN_LEFT, y }, right: { x: PIN_RIGHT, y } };
});

const SHEET: PaperSheet = {
  id: 'user-precision',
  label: SHEET_LABEL,
  src: PHOTO_SRC,
  ...FRAME,
  ruling: RULING,
  lighting: null,
  texture: null,
};

/**
 * Кладёт лист в стор и открывает на нём редактор.
 *
 * @param image — каналы фотографии; `null` — ещё не сняты
 * @returns диалог редактора
 */
const openEditor = async (image: SheetImageData | null): Promise<HTMLElement> => {
  const record = {
    ...buildUserSheetRecord({ familyId: 'lined', sheet: SHEET }),
    pins: PINS,
  };

  useGeneratorStore.getState().addUserSheet(record);
  useGeneratorStore.setState({
    familyId: 'lined',
    sheetId: SHEET.id,
    isSheetPinned: true,
  });
  useMarkupEditorStore.getState().open(record, image);
  render(<SheetMarkupEditor />);

  return await screen.findByRole('dialog', { name: `Разметка листа «${SHEET_LABEL}»` });
};

/**
 * Черновик открытого редактора.
 *
 * @returns черновик
 */
const readDraft = (): MarkupDraft => {
  const { draft } = useMarkupEditorStore.getState();

  if (!draft) {
    throw new Error('Редактор закрыт');
  }

  return draft;
};

/**
 * Подменяет экранную матрицу SVG оверлея единичной: пиксели окна совпадают с
 * пикселями фотографии.
 *
 * @param handle — ручка внутри SVG
 */
const mockIdentityScreenMatrix = (handle: HTMLElement) => {
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
};

/**
 * Перетаскивает ручку в точку фотографии с зажатым Alt/Option — без магнита.
 *
 * @param handle — ручка
 * @param point — куда отпустить, px фотографии
 */
const dragHandle = (handle: HTMLElement, point: SheetPoint) => {
  mockIdentityScreenMatrix(handle);
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, altKey: true });
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
    altKey: true,
  });
  fireEvent.pointerUp(handle, {
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
    altKey: true,
  });
};

/**
 * Высота линии разметки в столбце — какой её рисует оверлей.
 *
 * @param ruling — разлиновка
 * @param index — номер линии
 * @param x — столбец, px
 * @returns высота, px
 */
const readDrawnY = (ruling: SheetRuling, index: number, x: number): number => {
  const y = lineHeightAt(ruling, x, ruling.firstLinePhase + index * ruling.step);

  return ruling.bend ? y + sampleRulingBend(ruling.bend, ruling, x, y) : y;
};

/**
 * Вводит число в поле «Точных значений» и применяет его Enter.
 *
 * @param editor — диалог редактора
 * @param name — подпись поля
 * @param value — число
 */
const typeExactValue = async (editor: HTMLElement, name: string, value: string) => {
  const user = userEvent.setup();
  const field = within(editor).getByRole('textbox', { name });

  await user.clear(field);
  await user.type(field, `${value}{Enter}`);
};

/**
 * Открывает «Точные значения».
 *
 * @param editor — диалог редактора
 */
const openExactValues = async (editor: HTMLElement) => {
  const user = userEvent.setup();

  await user.click(within(editor).getByRole('button', { name: 'Точные значения' }));
};

/**
 * Описание поля — тексты элементов из `aria-describedby`, через пробел.
 *
 * @param field — поле ввода
 * @returns описание; пустая строка — описания нет
 */
const readFieldDescription = (field: HTMLElement): string => {
  return (field.getAttribute('aria-describedby') || '')
    .split(' ')
    .map((id) => {
      return document.getElementById(id)?.textContent || '';
    })
    .join(' ');
};

/**
 * Тексты всех живых областей отказа в редакторе: у инструментов они стоят на
 * месте и пустые, пока отказа нет.
 *
 * @param editor — диалог редактора
 * @returns тексты подряд; пустая строка — отказов нет
 */
const readAlertTexts = (editor: HTMLElement): string => {
  return within(editor)
    .queryAllByRole('alert')
    .map((alert) => {
      return alert.textContent || '';
    })
    .join('');
};

beforeEach(() => {
  clearLayoutCache();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  useMarkupEditorStore.getState().close();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage?.clear();
  decodeSheetImage.mockReset();
  decodeSheetImage.mockReturnValue(
    new Promise(() => {
      return undefined;
    })
  );
});

afterEach(() => {
  cleanup();
});

describe('точная правка: стрелки', () => {
  it('стрелка вправо сдвигает угол контура на пиксель фотографии при приближении, с Shift — на десять', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(null);

    await user.click(within(editor).getByRole('radio', { name: 'Контур' }));
    await user.click(within(editor).getByRole('button', { name: 'Приблизить' }));
    await user.click(within(editor).getByRole('button', { name: 'Приблизить' }));

    const corner = within(editor).getByRole('button', {
      name: 'Левый верхний угол листа',
    });
    const scale = HANDLE_RADIUS / Number(corner.getAttribute('r'));

    expect(scale).not.toBeCloseTo(1, 3);

    corner.focus();
    fireEvent.keyDown(corner, { key: 'ArrowRight' });

    expect(Number(corner.getAttribute('cx'))).toBe(1);
    expect(Number(corner.getAttribute('cy'))).toBe(0);

    fireEvent.keyDown(corner, { key: 'ArrowDown', shiftKey: true });

    expect(Number(corner.getAttribute('cx'))).toBe(1);
    expect(Number(corner.getAttribute('cy'))).toBe(10);
  });

  it('стрелка у конца закреплённой линии сдвигает его на пиксель: магнит сдвиг клавишей не возвращает', async () => {
    const editor = await openEditor(createSyntheticSheet(PHOTO));
    const handle = within(editor).getByRole('button', {
      name: 'Закреплённая линия 1, левый конец',
    });
    const before = readDraft().pins[0];

    if (!before) {
      throw new Error('Нет первой булавки');
    }

    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    expect(readDraft().pins[0]?.left).toStrictEqual({
      x: before.left.x,
      y: before.left.y + 1,
    });

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });

    expect(readDraft().pins[0]?.left).toStrictEqual({
      x: before.left.x + 10,
      y: before.left.y + 1,
    });
    expect(
      Math.abs(
        readDrawnY(readDraft().ruling, before.index, before.left.x + 10) -
          (before.left.y + 1)
      )
    ).toBeLessThanOrEqual(1);
  });

  it('прочие клавиши ручка не перехватывает', async () => {
    const editor = await openEditor(null);
    const handle = within(editor).getByRole('button', {
      name: 'Закреплённая линия 1, левый конец',
    });
    const before = readDraft();

    fireEvent.keyDown(handle, { key: 'a' });

    expect(readDraft()).toBe(before);
  });
});

describe('точная правка: ручки с клавиатуры', () => {
  it('Tab перебирает ручки по порядку, и у каждой есть имя', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(null);
    const overlay = within(editor).getByRole('group', { name: 'Разметка листа' });
    const handles = within(overlay).getAllByRole('button');

    expect(handles.length).toBe(4);

    for (const handle of handles) {
      expect(handle.getAttribute('aria-label')).toMatch(/\S/);
    }

    handles[0]?.focus();

    for (const handle of handles.slice(1)) {
      await user.tab();

      expect(document.activeElement).toBe(handle);
    }
  });
});

describe('точная правка: лупа', () => {
  it('пока тянут конец закреплённой линии, рядом видна увеличенная фотография под ним', async () => {
    const editor = await openEditor(null);
    const handle = within(editor).getByRole('button', {
      name: 'Закреплённая линия 2, правый конец',
    });

    expect(screen.queryByRole('img', { name: 'Лупа' })).toBeNull();

    mockIdentityScreenMatrix(handle);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500, clientY: 540 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 480, clientY: 530 });

    const loupe = screen.getByRole('img', { name: 'Лупа' });
    const photo = loupe.querySelector<HTMLElement>('[data-loupe-photo]');

    expect(photo?.style.backgroundImage).toContain(PHOTO_SRC);
    expect(loupe.dataset.photoX).toBe('480');
    expect(loupe.dataset.photoY).toBe('530');

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 480, clientY: 530 });

    expect(screen.queryByRole('img', { name: 'Лупа' })).toBeNull();
  });
});

describe('точная правка: числа', () => {
  it('шаг, первая линия, поля и линия поля показаны в пикселях фотографии', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);

    const readField = (name: string): string => {
      return (within(editor).getByRole('textbox', { name }) as HTMLInputElement).value;
    };

    expect(readField('Шаг, px')).toBe('40');
    expect(readField('Первая линия, px')).toBe('20');
    expect(readField('Верхнее поле, px')).toBe('60');
    expect(readField('Нижнее поле, px')).toBe('60');
    expect(readField('Левое поле сверху, px')).toBe('90');
    expect(readField('Левое поле снизу, px')).toBe('90');
    expect(readField('Правое поле сверху, px')).toBe('60');
    expect(readField('Правое поле снизу, px')).toBe('60');
    expect(readField('Линия поля сверху, px')).toBe('120');
    expect(readField('Линия поля снизу, px')).toBe('120');
  });

  it('поле числом — то же, что перетаскивание его направляющей в то же место', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(null);

    await openExactValues(editor);
    await typeExactValue(editor, 'Верхнее поле, px', '147');
    await typeExactValue(editor, 'Левое поле снизу, px', '101,5');

    const { margins: typed, sideSlant } = readDraft().ruling;

    act(() => {
      useMarkupEditorStore.getState().undo();
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraft().ruling.margins).toStrictEqual(RULING.margins);
    expect(readDraft().ruling.sideSlant).toBeNull();

    await user.click(within(editor).getByRole('radio', { name: 'Поля' }));

    const top = within(editor).getByRole('button', { name: 'Верхнее поле' });

    dragHandle(top, { x: Number(top.getAttribute('cx')), y: 147 });

    const left = within(editor).getByRole('button', { name: 'Левый нижний угол полей' });

    dragHandle(left, { x: 101.5, y: Number(left.getAttribute('cy')) });

    expect(readDraft().ruling.margins).toStrictEqual(typed);
    expect(readDraft().ruling.sideSlant).toStrictEqual(sideSlant);
    expect(typed.top).toBe(140);
    expect(
      Number(
        within(editor)
          .getByRole('button', { name: 'Левый нижний угол полей' })
          .getAttribute('cx')
      )
    ).toBe(101.5);
    expect(
      Number(
        within(editor)
          .getByRole('button', { name: 'Левый верхний угол полей' })
          .getAttribute('cx')
      )
    ).toBe(RULING.margins.left);
  });

  it('линия поля числами обоих концов ставится в тот столбец, сторона — по положению', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);
    await typeExactValue(editor, 'Линия поля сверху, px', '520');

    expect(readDraft().ruling.sideSlant?.marginLineX).not.toBeNull();
    expect(readDraft().ruling.marginLineSide).toBe('right');

    await typeExactValue(editor, 'Линия поля снизу, px', '520');

    expect(readDraft().ruling.marginLineX).toBe(520);
    expect(readDraft().ruling.sideSlant).toBeNull();
    expect(readDraft().ruling.marginLineSide).toBe('right');
  });

  it('шаг числом — то же, что перетаскивание булавок на линии с этим шагом', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);
    await typeExactValue(editor, 'Шаг, px', '45');

    const typed = readDraft();

    expect(typed.ruling.step).toBeCloseTo(45, 9);
    expect(typed.ruling.firstLinePhase).toBeCloseTo(PHOTO.phase, 9);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    for (const [order, pin] of PINS.entries()) {
      const y = PHOTO.phase + pin.index * 45;

      for (const end of ['left', 'right'] as const) {
        dragHandle(
          within(editor).getByRole('button', {
            name: `Закреплённая линия ${order + 1}, ${end === 'left' ? 'левый' : 'правый'} конец`,
          }),
          { x: pin[end].x, y }
        );
      }
    }

    expect(readDraft().ruling.step).toBeCloseTo(typed.ruling.step, 9);
    expect(readDraft().ruling.firstLinePhase).toBeCloseTo(typed.ruling.firstLinePhase, 9);
    expect(readDraft().pins).toStrictEqual(typed.pins);
  });

  it('первая линия числом сдвигает все линии, шаг прежний', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);
    await typeExactValue(editor, 'Первая линия, px', '31');

    const { ruling, pins } = readDraft();

    expect(ruling.firstLinePhase).toBeCloseTo(31, 9);
    expect(ruling.step).toBeCloseTo(PHOTO.step, 9);

    for (const pin of pins) {
      expect(pin.left.y).toBeCloseTo(31 + pin.index * PHOTO.step, 9);
    }
  });

  it('у каждого числа подписано, от чего оно отсчитано', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);

    const readDescription = (name: string): string => {
      return readFieldDescription(within(editor).getByRole('textbox', { name }));
    };

    /**
     * `getByText` сводит неразрывные пробелы к обычным.
     */
    expect(within(editor).getByText(/от краёв кадра, а не листа/)).toBeTruthy();
    expect(readDescription('Шаг, px')).toMatch(/между соседними линиями/);
    expect(readDescription('Первая линия, px')).toMatch(/от\u00A0верха кадра/);
    expect(readDescription('Верхнее поле, px')).toMatch(/от\u00A0верха кадра/);
    expect(readDescription('Нижнее поле, px')).toMatch(/от\u00A0низа кадра/);
    expect(readDescription('Левое поле снизу, px')).toMatch(/от\u00A0левого края кадра/);
    expect(readDescription('Правое поле сверху, px')).toMatch(
      /от\u00A0правого края кадра/
    );
    expect(readDescription('Линия поля снизу, px')).toMatch(/от\u00A0левого края кадра/);
  });

  it('не число: ошибка у поля, набранное остаётся, разметка прежняя', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);

    const before = readDraft();

    await typeExactValue(editor, 'Шаг, px', 'abc');

    const field = within(editor).getByRole('textbox', { name: 'Шаг, px' });

    expect(readDraft()).toBe(before);
    expect((field as HTMLInputElement).value).toBe('abc');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(readFieldDescription(field)).toMatch(/Нужно число/);
    expect(readAlertTexts(editor)).toMatch(/Нужно число/);
  });

  it('шаг 0: ошибка у поля вместо молчаливого отката; Esc возвращает значение, редактор открыт', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(null);

    await openExactValues(editor);

    const before = readDraft();

    await typeExactValue(editor, 'Шаг, px', '0');

    const field = within(editor).getByRole('textbox', { name: 'Шаг, px' });

    expect(readDraft()).toBe(before);
    expect((field as HTMLInputElement).value).toBe('0');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(readFieldDescription(field)).toMatch(/больше нуля/);

    await user.keyboard('{Escape}');

    expect(editor.isConnected).toBe(true);
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe('40');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(readAlertTexts(editor)).toBe('');

    await user.keyboard('{Escape}');

    expect(editor.isConnected).toBe(false);
  });

  it('отрицательный шаг отвергается, годное число после ошибки применяется и снимает её', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);

    const before = readDraft();

    await typeExactValue(editor, 'Шаг, px', '-5');

    const field = within(editor).getByRole('textbox', { name: 'Шаг, px' });

    expect(readDraft()).toBe(before);
    expect(readFieldDescription(field)).toMatch(/больше нуля/);

    await typeExactValue(editor, 'Шаг, px', '45');

    expect(readDraft().ruling.step).toBeCloseTo(45, 9);
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(readAlertTexts(editor)).toBe('');
  });

  it('ошибка у поля снимается, когда значение меняется другой правкой', async () => {
    const editor = await openEditor(null);

    await openExactValues(editor);
    await typeExactValue(editor, 'Шаг, px', '45');
    await typeExactValue(editor, 'Шаг, px', '0');

    const field = within(editor).getByRole('textbox', { name: 'Шаг, px' });

    expect((field as HTMLInputElement).value).toBe('0');

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect((field as HTMLInputElement).value).toBe('40');
    expect(field.getAttribute('aria-invalid')).toBeNull();
  });
});
