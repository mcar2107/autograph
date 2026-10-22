/**
 * @vitest-environment jsdom
 */
import {
  buildSheetRuling,
  MARGIN_FALLBACK_STEPS,
  mirrorSheetRuling,
  type PaperSheet,
  readSideEdge,
  type SheetImageData,
  type SheetOutline,
  type SheetPoint,
  type SheetRuling,
  sideEdgePointAtHeight,
} from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import type { UserSheetRecord } from '@pages/Generator/model/userSheetsStorage.types';
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

import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Подменяется только съём пикселей: канвы в jsdom нет. Перемер идёт настоящим
 * детектором.
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

const FRAME = { width: RULED_PHOTO.width, height: RULED_PHOTO.height };

const SHEET_LABEL = 'Лист на столе';

/**
 * Разлиновка листа до правки контура: лист во весь кадр, поля и линия поля
 * заданы руками и отличаются от найденных на снимке.
 */
const MANUAL_RULING = buildSheetRuling(
  {
    step: RULED_PHOTO.step,
    firstLinePhase: RULED_PHOTO.phase,
    skewAngle: 0,
    margins: { top: 150, right: 120, bottom: 150, left: 150 },
    marginLineX: null,
    marginLineSide: null,
  },
  FRAME
);

const SHEET: PaperSheet = {
  id: 'user-outline',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: MANUAL_RULING,
  lighting: null,
  texture: null,
};

/**
 * Отложенный декодер: перемер ждёт, пока тест не отпустит снимок.
 *
 * @returns промис снимка и его разрешение
 */
const deferDecode = (): ((image: SheetImageData) => void) => {
  let resolve: (image: SheetImageData) => void = () => {
    return undefined;
  };

  decodeSheetImage.mockReturnValue(
    new Promise<SheetImageData>((done) => {
      resolve = done;
    })
  );

  return (image) => {
    resolve(image);
  };
};

/**
 * Редактор, открытый на листе.
 */
type OpenedEditor = {
  /**
   * Открытый лист.
   */
  record: UserSheetRecord;

  /**
   * Диалог редактора.
   */
  editor: HTMLElement;
};

/**
 * Кладёт лист в стор и открывает на нём редактор с инструментом «Контур».
 *
 * @returns открытый лист и диалог редактора
 */
const openOutlineTool = async (): Promise<OpenedEditor> => {
  const user = userEvent.setup();
  const record = buildUserSheetRecord({ familyId: 'lined', sheet: SHEET });

  useGeneratorStore.getState().addUserSheet(record);
  useMarkupEditorStore.getState().open(record);
  render(<SheetMarkupEditor />);

  const editor = await screen.findByRole('dialog', {
    name: `Разметка листа «${SHEET_LABEL}»`,
  });

  await user.click(within(editor).getByRole('radio', { name: 'Контур' }));

  return { record, editor };
};

/**
 * Перетаскивает ручку в точку фотографии. Экранная матрица SVG — единичная:
 * пиксели окна совпадают с пикселями фотографии.
 *
 * @param handle — ручка
 * @param point — куда отпустить, px фотографии
 */
const dragHandle = (handle: HTMLElement, point: SheetPoint) => {
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

  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: point.x, clientY: point.y });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: point.x, clientY: point.y });
};

/**
 * Ручка угла контура.
 *
 * @param editor — диалог редактора
 * @param name — подпись угла
 * @returns ручка
 */
const getCorner = (editor: HTMLElement, name: string): HTMLElement => {
  return within(editor).getByRole('button', { name });
};

beforeEach(() => {
  clearLayoutCache();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  useMarkupEditorStore.getState().close();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage?.clear();
  decodeSheetImage.mockReset();
});

afterEach(() => {
  cleanup();
});

/**
 * Раздел инструмента «Контур» в панели.
 *
 * @param editor — диалог редактора
 * @returns раздел
 */
const getOutlineSection = (editor: HTMLElement): HTMLElement => {
  return within(editor).getByRole('region', { name: 'Контур листа' });
};

describe('инструмент «Контур»', () => {
  it('показывает четыре угла листа во весь кадр', async () => {
    const { editor } = await openOutlineTool();

    const topLeft = getCorner(editor, 'Левый верхний угол листа');
    const bottomRight = getCorner(editor, 'Правый нижний угол листа');

    expect(getCorner(editor, 'Правый верхний угол листа')).toBeDefined();
    expect(getCorner(editor, 'Левый нижний угол листа')).toBeDefined();
    expect([topLeft.getAttribute('cx'), topLeft.getAttribute('cy')]).toStrictEqual([
      '0',
      '0',
    ]);
    expect([
      bottomRight.getAttribute('cx'),
      bottomRight.getAttribute('cy'),
    ]).toStrictEqual([String(FRAME.width), String(FRAME.height)]);
  });

  it('вывернутый контур не применён: сообщение, разметка прежняя, перемера нет', async () => {
    const { editor } = await openOutlineTool();
    const before = useMarkupEditorStore.getState().draft;

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 400, y: 540 });

    expect(
      (await within(getOutlineSection(editor)).findByRole('alert')).textContent
    ).toMatch(/Контур не применён.*вывернут/);
    expect(useMarkupEditorStore.getState().draft).toBe(before);
    expect(decodeSheetImage).not.toHaveBeenCalled();
    expect(getCorner(editor, 'Левый верхний угол листа').getAttribute('cx')).toBe('0');
  });

  it('узкий контур — сообщение, разметка прежняя, перемера нет', async () => {
    const { editor } = await openOutlineTool();
    const before = useMarkupEditorStore.getState().draft;

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 0, y: 450 });

    expect(
      (await within(getOutlineSection(editor)).findByRole('alert')).textContent
    ).toMatch(/Контур не применён.*слишком узкий/);
    expect(useMarkupEditorStore.getState().draft).toBe(before);
    expect(decodeSheetImage).not.toHaveBeenCalled();
  });

  it('во время перемера сохранение недоступно, окно отвечает на зум; результат ложится в черновик', async () => {
    const user = userEvent.setup();
    const release = deferDecode();
    const { editor } = await openOutlineTool();
    const before = useMarkupEditorStore.getState().draft;
    const outline: SheetOutline = {
      topLeft: { x: 20, y: 30 },
      topRight: { x: FRAME.width, y: 0 },
      bottomRight: { x: FRAME.width, y: FRAME.height },
      bottomLeft: { x: 0, y: FRAME.height },
    };

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), outline.topLeft);

    const save = within(editor).getByRole('button', { name: 'Сохранить' });

    await waitFor(() => {
      expect(save).toHaveProperty('disabled', true);
    });
    expect(within(getOutlineSection(editor)).getByRole('status').textContent).toMatch(
      /перемеряется/
    );
    expect(useMarkupEditorStore.getState().draft).toBe(before);
    /**
     * Угол стоит, куда его отпустили, пока идёт перемер.
     */
    expect(getCorner(editor, 'Левый верхний угол листа').getAttribute('cx')).toBe('20');

    const zoomLabel = within(editor).getByText(/%$/).textContent;

    await user.click(within(editor).getByRole('button', { name: 'Приблизить' }));

    expect(within(editor).getByText(/%$/).textContent).not.toBe(zoomLabel);

    await act(async () => {
      release(createSyntheticSheet(RULED_PHOTO));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(save).toHaveProperty('disabled', false);
    });

    const draft = useMarkupEditorStore.getState().draft;

    expect(draft?.ruling.outline).toStrictEqual(outline);
    expect(draft?.ruling.step).toBeCloseTo(RULED_PHOTO.step, 0);
    /**
     * Поля берутся из перемера, а не из ручной правки.
     */
    expect(draft?.ruling.margins.left).toBeLessThan(MANUAL_RULING.margins.left);
    expect(draft?.ruling.marginLineX).not.toBeNull();
    expect(draft?.remeasure?.measuredRuling).toBe(draft?.ruling);
    expect(draft?.pins.length).toBeGreaterThanOrEqual(2);
    expect(within(getOutlineSection(editor)).getByRole('status').textContent).toMatch(
      /Лист перемерен по\u00A0новому контуру/
    );
  });

  it('угол, возвращённый на место во время перемера, отменяет его: ответ в черновик не ложится', async () => {
    const release = deferDecode();
    const { editor } = await openOutlineTool();
    const before = useMarkupEditorStore.getState().draft;
    const save = within(editor).getByRole('button', { name: 'Сохранить' });

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 20, y: 30 });

    await waitFor(() => {
      expect(save).toHaveProperty('disabled', true);
    });

    /**
     * Нажатие без сдвига отпускания не зовёт: угол уводят и возвращают.
     */
    const corner = getCorner(editor, 'Левый верхний угол листа');

    fireEvent.pointerDown(corner, { pointerId: 1, clientX: 20, clientY: 30 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(corner, { pointerId: 1, clientX: 0, clientY: 0 });

    await waitFor(() => {
      expect(save).toHaveProperty('disabled', false);
    });

    await act(async () => {
      release(createSyntheticSheet(RULED_PHOTO));
      await Promise.resolve();
    });

    expect(useMarkupEditorStore.getState().draft).toBe(before);
    expect(getCorner(editor, 'Левый верхний угол листа').getAttribute('cx')).toBe('0');
  });

  it('подсказка предупреждает, что перемер заменит ручные правки линий и полей', async () => {
    const { editor } = await openOutlineTool();
    const section = getOutlineSection(editor);

    expect(section.textContent).toMatch(
      /правки линий и\u00A0полей .*заменяются найденными.*«Отменить»/
    );
  });

  it('сообщения контура — в живых областях, которые есть до сообщения', async () => {
    const release = deferDecode();
    const { editor } = await openOutlineTool();
    const section = getOutlineSection(editor);
    const status = within(section).getByRole('status');
    const alert = within(section).getByRole('alert');

    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 400, y: 540 });

    await waitFor(() => {
      expect(alert.textContent).toMatch(/Контур не применён/);
    });

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 20, y: 30 });

    await waitFor(() => {
      expect(status.textContent).toMatch(/перемеряется/);
    });
    expect(alert.textContent).toBe('');

    await act(async () => {
      release(createSyntheticSheet(RULED_PHOTO));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(status.textContent).toMatch(/Лист перемерен.*«Отменить»/);
    });
    expect(within(section).getByRole('status')).toBe(status);
    expect(within(section).getByRole('alert')).toBe(alert);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    /**
     * После отмены «Лист перемерен» говорил бы уже не о том, что видно.
     */
    expect(status.textContent).toBe('');
  });

  it('отмена возвращает прежний контур вместе с разметкой; сохранение кладёт перемер на лист', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    const { editor } = await openOutlineTool();
    const before = useMarkupEditorStore.getState().draft;

    dragHandle(getCorner(editor, 'Правый нижний угол листа'), { x: 400, y: 540 });

    await waitFor(() => {
      expect(useMarkupEditorStore.getState().draft?.remeasure).not.toBeNull();
    });

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(useMarkupEditorStore.getState().draft).toBe(before);

    act(() => {
      useMarkupEditorStore.getState().redo();
    });

    const remeasured = useMarkupEditorStore.getState().draft;

    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    const [saved] = useGeneratorStore.getState().userSheets;

    expect(saved?.sheet.ruling).toBe(remeasured?.ruling);
    expect(saved?.sheet.ruling.outline?.bottomRight).toStrictEqual({ x: 400, y: 540 });
    expect(saved?.measuredRuling).toBe(remeasured?.ruling);
    expect(saved?.sheet.lighting).toBe(remeasured?.remeasure?.lighting);
    expect(saved?.kind).toBe('lined');
  });

  it('перемер оставляет заданные отдельно линию поля и поля зеркальной страницы на месте на фото', async () => {
    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    const mirrorOverride = {
      marginLineX: 300,
      marginLineSide: 'right' as const,
      marginLeft: 40,
      marginRight: 90,
      sideSlant: null,
    };

    /**
     * Наклон до перемера далёк от найденного на снимке: поля зеркала,
     * оставленные теми же числами, повернулись бы вокруг угла кадра.
     */
    const before: SheetRuling = { ...MANUAL_RULING, skewAngle: 1.5, mirrorOverride };
    const record = buildUserSheetRecord({
      familyId: 'lined',
      sheet: { ...SHEET, ruling: before },
    });

    /**
     * Столбцы боковых границ зеркальной страницы у верха, в середине и у низа
     * кадра.
     *
     * @param ruling — разлиновка листа
     * @returns столбцы, px отражённой фотографии
     */
    const readMirrorColumns = (ruling: SheetRuling): number[] => {
      const page = mirrorSheetRuling(ruling, FRAME);

      return (['left', 'right', 'marginLine'] as const).flatMap((edge) => {
        const ends = readSideEdge(page, FRAME, edge);

        return [0, FRAME.height / 2, FRAME.height].map((y) => {
          return ends
            ? sideEdgePointAtHeight(page.skewAngle, ends, FRAME.height, y).x
            : Number.NaN;
        });
      });
    };

    useGeneratorStore.getState().addUserSheet(record);
    useMarkupEditorStore.getState().open(record);
    render(<SheetMarkupEditor />);

    const editor = await screen.findByRole('dialog');

    await userEvent.setup().click(within(editor).getByRole('radio', { name: 'Контур' }));
    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 10, y: 10 });

    await waitFor(() => {
      expect(useMarkupEditorStore.getState().draft?.remeasure).not.toBeNull();
    });

    const after = useMarkupEditorStore.getState().draft?.ruling;

    if (!after) {
      throw new Error('Черновик пропал');
    }

    expect(Math.abs(after.skewAngle - before.skewAngle)).toBeGreaterThan(1);
    expect(after.mirrorOverride?.marginLineSide).toBe('right');
    expect(readMirrorColumns(after)).toStrictEqual(
      readMirrorColumns(before).map((x) => {
        return expect.closeTo(x, 6);
      })
    );
  });
});

/**
 * Шаг чистого листа, заданный руками: не совпадает с шагом линий на снимке,
 * поэтому поиск разлиновки, ошибочно запущенный на чистом листе, виден по
 * шагу.
 */
const BLANK_STEP = RULED_PHOTO.step * 1.5;

/**
 * Открывает редактор на чистом листе с инструментом «Контур».
 *
 * @param margins — поля листа, px фотографии
 * @returns диалог редактора
 */
const openBlankOutlineTool = async (
  margins: PaperSheet['ruling']['margins']
): Promise<HTMLElement> => {
  const ruling = buildSheetRuling(
    {
      step: BLANK_STEP,
      firstLinePhase: 5,
      skewAngle: 0,
      margins,
      marginLineX: null,
      marginLineSide: null,
    },
    FRAME
  );
  const record = buildUserSheetRecord({
    familyId: 'lined',
    sheet: { ...SHEET, ruling },
    kind: 'blank',
  });

  useGeneratorStore.getState().addUserSheet(record);
  useMarkupEditorStore.getState().open(record);
  render(<SheetMarkupEditor />);

  const editor = await screen.findByRole('dialog');

  await userEvent.setup().click(within(editor).getByRole('radio', { name: 'Контур' }));

  return editor;
};

describe('перемер контура чистого листа', () => {
  it('меняет контур и свет, а шаг, фазу и поля внутри листа оставляет заданными руками', async () => {
    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    const margins = { top: 150, right: 120, bottom: 150, left: 150 };
    const editor = await openBlankOutlineTool(margins);

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), { x: 20, y: 30 });

    await waitFor(() => {
      expect(useMarkupEditorStore.getState().draft?.remeasure).not.toBeNull();
    });

    const draft = useMarkupEditorStore.getState().draft;

    expect(draft?.ruling.outline?.topLeft).toStrictEqual({ x: 20, y: 30 });
    expect(draft?.ruling).toMatchObject({
      step: BLANK_STEP,
      firstLinePhase: 5,
      skewAngle: 0,
      margins,
    });
    expect(draft?.remeasure?.measuredKind).toBe('blank');
    expect(getOutlineSection(editor).textContent).toMatch(
      /поля подтягиваются внутрь нового контура/
    );
  });

  it('поля, оставшиеся от прежнего контура, уходят внутрь нового', async () => {
    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    const editor = await openBlankOutlineTool({ top: 0, right: 0, bottom: 0, left: 0 });
    const topLeft = { x: 80, y: 90 };
    const bottomRight = { x: FRAME.width - 70, y: FRAME.height - 60 };

    dragHandle(getCorner(editor, 'Левый верхний угол листа'), topLeft);

    await waitFor(() => {
      expect(useMarkupEditorStore.getState().draft?.remeasure).not.toBeNull();
    });

    dragHandle(getCorner(editor, 'Правый нижний угол листа'), bottomRight);

    await waitFor(() => {
      expect(
        useMarkupEditorStore.getState().draft?.ruling.outline?.bottomRight
      ).toStrictEqual(bottomRight);
    });

    const ruling = useMarkupEditorStore.getState().draft?.ruling;
    const fallback = BLANK_STEP * MARGIN_FALLBACK_STEPS;

    expect(ruling?.step).toBe(BLANK_STEP);
    expect(ruling?.margins.top).toBeGreaterThanOrEqual(topLeft.y + fallback);
    expect(ruling?.margins.left).toBeGreaterThanOrEqual(topLeft.x + fallback);
    expect(ruling?.margins.bottom).toBeGreaterThanOrEqual(
      FRAME.height - bottomRight.y + fallback
    );
    expect(ruling?.margins.right).toBeGreaterThanOrEqual(
      FRAME.width - bottomRight.x + fallback
    );
  });
});
