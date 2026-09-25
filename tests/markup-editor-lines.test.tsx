/**
 * @vitest-environment jsdom
 */
import {
  buildSheetRuling,
  lineHeightAt,
  type PaperSheet,
  readSideEdge,
  type RulingBend,
  type RulingPin,
  sampleRulingBend,
  type SheetImageData,
  type SheetPoint,
  type SheetRuling,
  sideEdgePointAtHeight,
} from '@pages/Generator/lib/paper';
import { selectCalibrationRuling } from '@pages/Generator/model/geometrySelectors';
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

import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { BENT_PHOTO, RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

type User = ReturnType<typeof userEvent.setup>;

/**
 * Снимок линейки с шагом, на котором магнит различает линию и фон: при шаге в
 * два десятка пикселей фон профиля на синтетике без шума проседает у соседних
 * линий, и порог магнита встаёт выше глубины линии.
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

const { step: STEP, phase: PHASE } = PHOTO;

/**
 * Разлиновка по линиям снимка.
 *
 * @param photo — снимок: шаг, фаза, поля и линия поля
 * @returns разлиновка
 */
const buildPhotoRuling = (photo: typeof RULED_PHOTO): SheetRuling => {
  return buildSheetRuling(
    {
      step: photo.step,
      firstLinePhase: photo.phase,
      skewAngle: 0,
      margins: photo.margins,
      marginLineX: photo.marginLineX,
      marginLineSide: 'left',
    },
    { width: photo.width, height: photo.height }
  );
};

/**
 * Разлиновка, совпадающая с линиями снимка.
 */
const RULING = buildPhotoRuling(PHOTO);

/**
 * Высота линии снимка с номером.
 *
 * @param index — номер линии
 * @param photo — снимок
 * @returns высота, px
 */
const lineY = (index: number, photo: typeof RULED_PHOTO = PHOTO): number => {
  return photo.phase + index * photo.step;
};

const PIN_LEFT = 150;

const PIN_RIGHT = 500;

/**
 * Булавки на двух линиях снимка.
 *
 * @param indices — номера линий
 * @param photo — снимок
 * @returns булавки
 */
const buildPins = (indices: number[], photo: typeof RULED_PHOTO = PHOTO): RulingPin[] => {
  return indices.map((index) => {
    const y = lineY(index, photo);

    return { index, left: { x: PIN_LEFT, y }, right: { x: PIN_RIGHT, y } };
  });
};

/**
 * Булавки на линиях 3 и 13 — десять шагов между ними.
 */
const PINS = buildPins([3, 13]);

const SHEET: PaperSheet = {
  id: 'user-lines',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: RULING,
  lighting: null,
  texture: null,
};

/**
 * Кладёт лист в стор, ставит его на страницу и открывает редактор.
 *
 * @param ruling — разлиновка листа
 * @param pins — булавки листа
 * @param image — каналы фотографии; `null` — ещё не сняты
 * @returns диалог редактора
 */
const openEditor = async (
  ruling: SheetRuling,
  pins: RulingPin[],
  image: SheetImageData | null
): Promise<HTMLElement> => {
  const record = {
    ...buildUserSheetRecord({ familyId: 'lined', sheet: { ...SHEET, ruling } }),
    pins,
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
 * Разлиновка черновика редактора.
 *
 * @returns разлиновка
 */
const readDraftRuling = (): SheetRuling => {
  const ruling = useMarkupEditorStore.getState().draft?.ruling;

  if (!ruling) {
    throw new Error('Редактор закрыт');
  }

  return ruling;
};

/**
 * Булавки черновика редактора.
 *
 * @returns булавки
 */
const readDraftPins = (): RulingPin[] => {
  return useMarkupEditorStore.getState().draft?.pins || [];
};

/**
 * Номера линий, которые рисует оверлей.
 *
 * @param editor — диалог редактора
 * @returns номера линий
 */
const readLineIndices = (editor: HTMLElement): number[] => {
  return [
    ...editor.querySelectorAll<SVGPolylineElement>('[data-layer="lines"] polyline'),
  ].map((line) => {
    return Number(line.dataset.lineIndex);
  });
};

/**
 * Наибольшее расстояние по высоте от концов булавок до их линий, какими они
 * нарисованы: с перспективой и изгибом.
 *
 * @param ruling — разлиновка
 * @param pins — булавки
 * @returns расстояние, px
 */
const measurePinMiss = (ruling: SheetRuling, pins: RulingPin[]): number => {
  const { bend } = ruling;

  return pins.reduce((miss, { index, left, right }) => {
    const u = ruling.firstLinePhase + index * ruling.step;

    return [left, right].reduce((endMiss, { x, y }) => {
      const straight = lineHeightAt(ruling, x, u);
      const drawn = bend
        ? straight + sampleRulingBend(bend, ruling, x, straight)
        : straight;

      return Math.max(endMiss, Math.abs(y - drawn));
    }, miss);
  }, 0);
};

/**
 * Изгиб, опускающий все линии снимка на одно и то же число пикселей: узлы
 * накрывают линии с первой по двадцатую и столбцы булавок.
 *
 * @param offset — сдвиг линий вниз, px
 * @returns сетка изгиба
 */
const createUniformBend = (offset: number): RulingBend => {
  const rowCount = 20;
  const columnCount = 5;

  return {
    columnOrigin: 100,
    columnSpacing: 100,
    columnCount,
    rowOrigin: PHASE,
    rowSpacing: STEP,
    rowCount,
    offsets: Array.from({ length: rowCount * columnCount }, () => {
      return offset;
    }),
  };
};

/**
 * Перетаскивает ручку в точку фотографии. Экранная матрица SVG — единичная.
 *
 * @param handle — ручка
 * @param point — куда отпустить, px фотографии
 * @param isAltDown — зажат ли Alt/Option
 */
const dragHandle = (handle: HTMLElement, point: SheetPoint, isAltDown = false) => {
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

  const pointer = { pointerId: 1, clientX: point.x, clientY: point.y, altKey: isAltDown };

  fireEvent.pointerDown(handle, { ...pointer, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(handle, pointer);
  fireEvent.pointerUp(handle, pointer);
};

/**
 * Ручка конца закреплённой линии.
 *
 * @param editor — диалог редактора
 * @param number — номер закреплённой линии, с единицы
 * @param end — какой конец
 * @returns ручка
 */
const getPinEnd = (
  editor: HTMLElement,
  number: number,
  end: 'левый' | 'правый'
): HTMLElement => {
  return within(editor).getByRole('button', {
    name: `Закреплённая линия ${number}, ${end} конец`,
  });
};

/**
 * Классы видимой фигуры конца булавки: подсветку ошибкой несёт она, а не
 * круг захвата.
 *
 * @param editor — диалог редактора
 * @param number — номер булавки с единицы
 * @param end — какой конец
 * @returns классы фигуры
 */
const readPinEndClass = (
  editor: HTMLElement,
  number: number,
  end: 'левый' | 'правый'
): string => {
  const shape = getPinEnd(editor, number, end).parentElement?.querySelector(
    '[data-handle-kind]'
  );

  return shape?.getAttribute('class') || '';
};

/**
 * Нажимает кнопку несколько раз.
 *
 * @param user — сессия `userEvent`
 * @param button — кнопка
 * @param times — сколько раз
 */
const clickTimes = async (user: User, button: HTMLElement, times: number) => {
  for (let count = 0; count < times; count += 1) {
    await user.click(button);
  }
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

describe('инструмент «Линии»: число шагов', () => {
  it('N с 10 на 20 → 19 промежуточных линий через обе булавки; страница после сохранения — по новому шагу', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(RULING, PINS, null);
    const badge = within(editor).getByRole('group', {
      name: 'Шагов между линиями 1 и 2',
    });

    expect(badge.textContent).toMatch(/10 шагов/);

    await clickTimes(
      user,
      within(badge).getByRole('button', { name: 'Больше шагов между линиями 1 и 2' }),
      10
    );

    expect(badge.textContent).toMatch(/20 шагов/);

    const [first, last] = readDraftPins();

    expect([first?.index, last?.index]).toStrictEqual([3, 23]);
    expect(
      readLineIndices(editor).filter((index) => {
        return index > 3 && index < 23;
      })
    ).toHaveLength(19);
    expect(readDraftRuling().step).toBeCloseTo(STEP / 2, 6);
    expect(measurePinMiss(readDraftRuling(), readDraftPins())).toBeLessThan(1);

    /**
     * Десять нажатий по одному промежутку — одна правка.
     */
    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(badge.textContent).toMatch(/10 шагов/);

    act(() => {
      useMarkupEditorStore.getState().redo();
    });

    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    expect(
      selectCalibrationRuling(useGeneratorStore.getState(), 0)?.ruling.step
    ).toBeCloseTo(STEP / 2, 6);
  });

  it('меньше одного шага между линиями не бывает', async () => {
    const editor = await openEditor(RULING, buildPins([3, 4]), null);
    const fewer = within(editor).getByRole('button', {
      name: 'Меньше шагов между линиями 1 и 2',
    });

    expect(fewer).toHaveProperty('disabled', true);
  });

  it('разлиновка не найдена: число шагов не задано, пока его не укажут', async () => {
    const user = userEvent.setup();
    const empty = buildSheetRuling(
      {
        step: 0,
        firstLinePhase: 0,
        skewAngle: 0,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        marginLineX: null,
        marginLineSide: null,
      },
      FRAME
    );
    const pins = [lineY(3), lineY(13)].map((y) => {
      return { index: 0, left: { x: PIN_LEFT, y }, right: { x: PIN_RIGHT, y } };
    });
    const editor = await openEditor(empty, pins, null);
    const badge = within(editor).getByRole('group', {
      name: 'Шагов между линиями 1 и 2',
    });

    expect(badge.textContent).toMatch(/\?/);
    expect(readLineIndices(editor)).toHaveLength(0);

    await user.click(
      within(badge).getByRole('button', { name: 'Больше шагов между линиями 1 и 2' })
    );
    await clickTimes(
      user,
      within(badge).getByRole('button', { name: 'Больше шагов между линиями 1 и 2' }),
      9
    );

    expect(badge.textContent).toMatch(/10 шагов/);
    expect(readDraftRuling().step).toBeCloseTo(STEP, 6);
    expect(measurePinMiss(readDraftRuling(), readDraftPins())).toBeLessThan(1e-6);
  });
});

describe('инструмент «Линии»: булавки', () => {
  it('перетащенный конец ведёт гребёнку, и все линии проходят через булавки', async () => {
    const editor = await openEditor(RULING, PINS, null);

    dragHandle(getPinEnd(editor, 2, 'правый'), { x: PIN_RIGHT, y: lineY(13) - 20 });

    const ruling = readDraftRuling();

    expect(readDraftPins()[1]?.right).toStrictEqual({ x: PIN_RIGHT, y: lineY(13) - 20 });
    expect(ruling.perspective).not.toBeNull();
    expect(measurePinMiss(ruling, readDraftPins())).toBeLessThan(1);
    expect(
      within(editor).getByRole('listitem', { name: 'Закреплённая линия 2' }).textContent
    ).toMatch(/невязка 0\s?px/);
  });

  it('перетащенный конец и число шагов меняют наклон, а поля и линия поля на фото на месте', async () => {
    const user = userEvent.setup();

    /**
     * Столбцы боковых полей и линии поля у верха, в середине и у низа кадра.
     *
     * @param ruling — разлиновка листа
     * @returns столбцы, px фотографии
     */
    const readEdgeColumns = (ruling: SheetRuling): number[] => {
      return (['left', 'right', 'marginLine'] as const).flatMap((edge) => {
        const ends = readSideEdge(ruling, FRAME, edge);

        return [0, FRAME.height / 2, FRAME.height].map((y) => {
          return ends
            ? sideEdgePointAtHeight(ruling.skewAngle, ends, FRAME.height, y).x
            : Number.NaN;
        });
      });
    };

    const editor = await openEditor(RULING, PINS, null);
    const before = readEdgeColumns(readDraftRuling());

    dragHandle(getPinEnd(editor, 2, 'правый'), { x: PIN_RIGHT, y: lineY(13) - 20 });

    expect(Math.abs(readDraftRuling().skewAngle - RULING.skewAngle)).toBeGreaterThan(1);

    await user.click(
      within(editor).getByRole('button', { name: 'Больше шагов между линиями 1 и 2' })
    );

    expect(readEdgeColumns(readDraftRuling())).toStrictEqual(
      before.map((x) => {
        return expect.closeTo(x, 6);
      })
    );
  });

  it('магнит ставит отпущенный конец на линию фотографии', async () => {
    const editor = await openEditor(RULING, PINS, createSyntheticSheet(PHOTO));
    const released = lineY(13) + STEP * 0.2;

    dragHandle(getPinEnd(editor, 2, 'правый'), { x: 300, y: released });

    const end = readDraftPins()[1]?.right;

    expect(end?.x).toBe(300);
    expect(Math.abs((end?.y || 0) - lineY(13))).toBeLessThanOrEqual(0.5);
  });

  it('на чистом листе магнит не притягивает', async () => {
    const record = {
      ...buildUserSheetRecord({
        familyId: 'lined',
        sheet: SHEET,
        kind: 'blank',
      }),
      pins: PINS,
    };

    useGeneratorStore.getState().addUserSheet(record);
    useGeneratorStore.setState({
      familyId: 'lined',
      sheetId: SHEET.id,
      isSheetPinned: true,
    });
    useMarkupEditorStore.getState().open(record, createSyntheticSheet(PHOTO));
    render(<SheetMarkupEditor />);

    const editor = await screen.findByRole('dialog', {
      name: `Разметка листа «${SHEET_LABEL}»`,
    });
    const released = lineY(13) + STEP * 0.2;

    dragHandle(getPinEnd(editor, 2, 'правый'), { x: 300, y: released });

    expect(readDraftPins()[1]?.right).toStrictEqual({ x: 300, y: released });
  });

  it('с Alt магнит не притягивает', async () => {
    const editor = await openEditor(RULING, PINS, createSyntheticSheet(PHOTO));
    const released = lineY(13) + STEP * 0.2;

    dragHandle(getPinEnd(editor, 2, 'правый'), { x: 300, y: released }, true);

    expect(readDraftPins()[1]?.right).toStrictEqual({ x: 300, y: released });
  });

  it('каналы фотографии, пришедшие после открытия, включают магнит', async () => {
    const editor = await openEditor(RULING, PINS, null);
    const released = lineY(13) + STEP * 0.2;

    dragHandle(getPinEnd(editor, 2, 'правый'), { x: 300, y: released });

    expect(readDraftPins()[1]?.right.y).toBe(released);

    act(() => {
      useMarkupEditorStore.getState().setImage(SHEET.id, createSyntheticSheet(PHOTO));
    });
    dragHandle(getPinEnd(editor, 2, 'правый'), { x: 300, y: released });

    expect(Math.abs((readDraftPins()[1]?.right.y || 0) - lineY(13))).toBeLessThanOrEqual(
      0.5
    );
  });

  it('после правки изгиб прослеживается по фотографии заново', async () => {
    const editor = await openEditor(
      buildPhotoRuling(RULED_PHOTO),
      buildPins([3, 13], RULED_PHOTO),
      createSyntheticSheet(BENT_PHOTO)
    );

    expect(readDraftRuling().bend).toBeNull();

    dragHandle(getPinEnd(editor, 1, 'левый'), { x: PIN_LEFT, y: lineY(3, RULED_PHOTO) });

    expect(readDraftRuling().bend).not.toBeNull();
    expect(measurePinMiss(readDraftRuling(), readDraftPins())).toBeLessThanOrEqual(1);
  });

  it('на изогнутом снимке нарисованные линии проходят через все три булавки', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(
      buildPhotoRuling(RULED_PHOTO),
      buildPins([3, 13], RULED_PHOTO),
      createSyntheticSheet(BENT_PHOTO)
    );

    await user.click(within(editor).getByRole('button', { name: 'Закрепить ещё линию' }));
    dragHandle(getPinEnd(editor, 2, 'правый'), {
      x: PIN_RIGHT,
      y: lineY(8, RULED_PHOTO) + RULED_PHOTO.step * 0.2,
    });

    expect(readDraftPins()).toHaveLength(3);
    expect(measurePinMiss(readDraftRuling(), readDraftPins())).toBeLessThanOrEqual(1);
  });

  it('без каналов фотографии изгиб после правки снят', async () => {
    const bend = {
      columnOrigin: 100,
      columnSpacing: 100,
      columnCount: 3,
      rowOrigin: PHASE,
      rowSpacing: STEP,
      rowCount: 2,
      offsets: [1, 2, 1, 1, 2, 1],
    };
    const editor = await openEditor({ ...RULING, bend }, PINS, null);

    dragHandle(getPinEnd(editor, 1, 'левый'), { x: PIN_LEFT, y: lineY(3) });

    expect(readDraftRuling().bend).toBeNull();
  });

  it('конец, перетащенный за другой, меняется с ним ролью, и расстановка годна', async () => {
    const editor = await openEditor(RULING, PINS, null);

    dragHandle(getPinEnd(editor, 1, 'левый'), { x: PIN_RIGHT + 20, y: lineY(3) });

    const [first] = readDraftPins();

    expect(first?.left.x).toBe(PIN_RIGHT);
    expect(first?.right.x).toBe(PIN_RIGHT + 20);
    expect(within(editor).queryByRole('alert')).toBeNull();
    expect(measurePinMiss(readDraftRuling(), readDraftPins())).toBeLessThan(1);
  });

  it('расстановка, которая разлиновку не задаёт, не применяется и подсвечивает булавку', async () => {
    const editor = await openEditor(RULING, PINS, null);

    dragHandle(getPinEnd(editor, 1, 'левый'), { x: PIN_LEFT, y: lineY(18) });
    dragHandle(getPinEnd(editor, 1, 'правый'), { x: PIN_RIGHT, y: lineY(18) });

    expect(within(editor).getByRole('alert').textContent).toMatch(
      /не задают разлиновку|сходятся внутри кадра/
    );
    expect(readDraftRuling()).toBe(RULING);
    expect(readPinEndClass(editor, 1, 'правый')).toMatch(/stroke-danger/);
    expect(readPinEndClass(editor, 2, 'правый')).not.toMatch(/stroke-danger/);
  });

  it('невязка — расстояние от булавки до нарисованной линии; больше пикселя подсвечено', async () => {
    const [first, second] = PINS;

    if (!first || !second) {
      throw new Error('Нет булавок');
    }

    const shifted = {
      ...second,
      right: { ...second.right, y: second.right.y + 5 },
    };
    const editor = await openEditor(RULING, [first, shifted], null);
    const item = within(editor).getByRole('listitem', { name: 'Закреплённая линия 2' });

    expect(item.textContent).toMatch(/невязка 5\s?px/);
    expect(item.getAttribute('class')).toMatch(/border-danger/);
    expect(readPinEndClass(editor, 2, 'правый')).toMatch(/stroke-danger/);
    expect(
      within(editor).getByRole('listitem', { name: 'Закреплённая линия 1' }).textContent
    ).toMatch(/невязка 0\s?px/);
  });

  it('невязка учитывает изгиб: булавка на изогнутой линии мимо гребёнки годна', async () => {
    const offset = 6;
    const pins = PINS.map((pin) => {
      return {
        ...pin,
        left: { ...pin.left, y: pin.left.y + offset },
        right: { ...pin.right, y: pin.right.y + offset },
      };
    });
    const editor = await openEditor(
      { ...RULING, bend: createUniformBend(offset) },
      pins,
      null
    );
    const item = within(editor).getByRole('listitem', { name: 'Закреплённая линия 2' });

    expect(item.textContent).toMatch(/невязка 0\s?px/);
    expect(item.getAttribute('class')).not.toMatch(/border-danger/);
  });

  it('третья булавка встаёт в середину и снимается обратно', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(RULING, PINS, null);

    await user.click(within(editor).getByRole('button', { name: 'Закрепить ещё линию' }));

    expect(
      readDraftPins().map(({ index }) => {
        return index;
      })
    ).toStrictEqual([3, 8, 13]);
    expect(
      within(editor).getByRole('group', { name: 'Шагов между линиями 2 и 3' }).textContent
    ).toMatch(/5 шагов/);
    expect(measurePinMiss(readDraftRuling(), readDraftPins())).toBeLessThan(1);

    const middle = within(editor).getByRole('listitem', { name: 'Закреплённая линия 2' });

    await user.click(within(middle).getByRole('button', { name: 'Открепить' }));

    expect(readDraftPins()).toHaveLength(2);

    const last = within(editor).getByRole('listitem', { name: 'Закреплённая линия 2' });

    expect(within(last).getByRole('button', { name: 'Открепить' })).toHaveProperty(
      'disabled',
      true
    );
  });
});
