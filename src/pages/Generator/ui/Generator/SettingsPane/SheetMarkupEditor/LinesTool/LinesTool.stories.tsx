import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import { LINED_FAMILY_ID } from '../../../../../config';
import type { PaperSheet, RulingPin, SheetPoint } from '../../../../../lib/paper';
import { clearLayoutCache } from '../../../../../model/measureLayout';
import { loadPaperFamilies } from '../../../../../model/paperProfiles';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '../../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { deriveUserSheetMarkup } from '../../../../../model/userSheetsStorageRecord';
import { openSheetEditor } from '../../useSheetImport';
import { SheetMarkupEditor } from '../SheetMarkupEditor';

const SHEET_ID = 'user-lines-drag';

/**
 * Допуск попадания в пиксель фотографии: линии проходят через закреплённые
 * не дальше него.
 */
const PIXEL_TOLERANCE = 1;

/**
 * На какую долю шага уводится конец: в пятой доле магнит обязан вернуть его
 * на линию, а в четверти без магнита конец остаётся, где отпущен.
 */
const SNAP_SHARE = 0.2;

const FREE_SHARE = 0.25;

const LOAD_TIMEOUT = 20_000;

/**
 * Кладёт лист пресет-пака в линейку своим листом и открывает редактор тем же
 * путём, что кнопка настройки на плитке: разметка сразу, каналы фотографии —
 * когда воркер их снимет.
 *
 * @returns открытый лист
 */
const openPresetSheet = async (): Promise<PaperSheet> => {
  const families = await loadPaperFamilies();
  const preset = families.find(({ id }) => {
    return id === LINED_FAMILY_ID;
  })?.sheets[0];

  if (!preset) {
    throw new Error('В пресет-паке нет листа в линейку');
  }

  const sheet = { ...preset, id: SHEET_ID, label: 'Тетрадь в линейку' };
  const record = {
    familyId: LINED_FAMILY_ID,
    sheet,
    kind: 'lined' as const,
    ...deriveUserSheetMarkup(sheet, 'lined'),
    isAnalyzed: true,
  };

  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: families,
    userSheets: [record],
    hasRestoredUserSheets: true,
    familyId: LINED_FAMILY_ID,
    sheetId: SHEET_ID,
    isSheetPinned: true,
  });
  await openSheetEditor(record);
  await waitFor(
    async () => {
      await expect(useMarkupEditorStore.getState().image).not.toBeNull();
    },
    { timeout: LOAD_TIMEOUT }
  );

  return sheet;
};

/**
 * Ручка конца закреплённой линии.
 *
 * @param number — номер закреплённой линии, с единицы
 * @returns ручка
 */
const findPinEnd = async (number: number): Promise<SVGCircleElement> => {
  const name = `Закреплённая линия ${number}, правый конец`;

  return await waitFor(() => {
    const handle = document.querySelector<SVGCircleElement>(
      `circle[aria-label="${name}"]`
    );

    if (!handle) {
      throw new Error(`Нет ручки «${name}»`);
    }

    return handle;
  });
};

/**
 * Точка фотографии в координатах окна браузера.
 *
 * @param handle — ручка внутри SVG оверлея
 * @param point — точка, px фотографии
 * @returns точка окна
 */
const toClientPoint = (handle: SVGCircleElement, point: SheetPoint): SheetPoint => {
  const matrix = handle.ownerSVGElement?.getScreenCTM();

  if (!matrix) {
    throw new Error('У оверлея нет экранной матрицы');
  }

  const { a, b, c, d, e, f } = matrix;

  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
};

/**
 * Перетаскивает ручку настоящими событиями указателя.
 *
 * @param handle — ручка
 * @param target — куда отпустить, px фотографии
 * @param isAltDown — зажат ли Alt/Option
 */
const dragHandle = (handle: SVGCircleElement, target: SheetPoint, isAltDown: boolean) => {
  const start = toClientPoint(handle, {
    x: Number(handle.getAttribute('cx')),
    y: Number(handle.getAttribute('cy')),
  });
  const end = toClientPoint(handle, target);

  const dispatch = (type: string, point: SheetPoint) => {
    handle.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        altKey: isAltDown,
      })
    );
  };

  dispatch('pointerdown', start);
  dispatch('pointermove', end);
  dispatch('pointerup', end);
};

/**
 * Высота линии оверлея в столбце — по её ломаной.
 *
 * @param index — номер линии
 * @param x — столбец, px фотографии
 * @returns высота, px фотографии
 */
const readOverlayLineY = (index: number, x: number): number => {
  const line = document.querySelector(
    `[data-layer="lines"] [data-line-index="${index}"]`
  );
  const points = (line?.getAttribute('points') || '').split(' ').map((pair) => {
    const [px = 0, py = 0] = pair.split(',').map(Number);

    return { x: px, y: py };
  });
  const segment = points.findIndex((point, order) => {
    const next = points[order + 1];

    return next !== undefined && point.x <= x && x <= next.x;
  });
  const from = points[segment];
  const to = points[segment + 1];

  if (!from || !to) {
    throw new Error(`Линия ${index} не проходит через столбец ${x}`);
  }

  return from.y + ((to.y - from.y) * (x - from.x)) / (to.x - from.x || 1);
};

/**
 * Вторая закреплённая линия черновика.
 *
 * @returns булавка
 */
const readSecondPin = (): RulingPin => {
  const pin = useMarkupEditorStore.getState().draft?.pins[1];

  if (!pin) {
    throw new Error('В черновике меньше двух булавок');
  }

  return pin;
};

const meta = {
  component: SheetMarkupEditor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SheetMarkupEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Конец булавки, отпущенный в пятой доле шага от линии фотографии, магнит
 * возвращает на неё, и линия оверлея с номером булавки проходит через оба
 * её конца.
 */
export const DragPinEndSnapsToLine: Story = {
  play: async () => {
    const sheet = await openPresetSheet();
    const handle = await findPinEnd(2);
    const before = readSecondPin();
    const released = before.right.y + SNAP_SHARE * sheet.ruling.step;

    dragHandle(handle, { x: before.right.x, y: released }, false);

    await waitFor(async () => {
      await expect(readSecondPin().right.y).not.toBe(before.right.y);
    });

    const after = readSecondPin();

    await expect(Math.abs(after.right.y - released)).toBeGreaterThan(PIXEL_TOLERANCE);
    await expect(Math.abs(after.right.y - before.right.y)).toBeLessThanOrEqual(
      PIXEL_TOLERANCE
    );

    for (const end of [after.left, after.right]) {
      await expect(
        Math.abs(readOverlayLineY(after.index, end.x) - end.y)
      ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    }
  },
};

/**
 * С Alt/Option конец остаётся, где отпущен, и расстановка годна: разлиновка
 * подогнана через него, а не отвергнута.
 */
export const DragPinEndWithAltStaysPut: Story = {
  play: async () => {
    const sheet = await openPresetSheet();
    const handle = await findPinEnd(2);
    const before = readSecondPin();
    const released = before.right.y + FREE_SHARE * sheet.ruling.step;

    dragHandle(handle, { x: before.right.x, y: released }, true);

    await waitFor(async () => {
      await expect(readSecondPin().right.y).toBeCloseTo(released, 6);
    });

    /**
     * Область отказа стоит на месте и пустая, пока расстановка годна.
     */
    await expect(document.querySelector('[role="alert"]')?.textContent).toBe('');
    await expect(useMarkupEditorStore.getState().draft?.ruling).not.toBe(sheet.ruling);
  },
};

/**
 * С зажатым пробелом нажатие поверх булавки сдвигает фотографию, а не
 * булавку: ручки лежат в оверлее порталом, и окно просмотра забирает нажатие,
 * только если ручка его не перехватила.
 */
export const SpaceOverPinPansPhoto: Story = {
  play: async () => {
    await openPresetSheet();

    const handle = await findPinEnd(2);
    const before = readSecondPin();
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="markup-viewport"]'
    );
    const stage = document.querySelector<HTMLElement>('[data-testid="markup-stage"]');

    if (!viewport || !stage) {
      throw new Error('Нет окна просмотра');
    }

    const { transform } = stage.style;
    const start = toClientPoint(handle, before.right);
    const end = { x: start.x + 40, y: start.y + 30 };
    const pointer = {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };

    viewport.dispatchEvent(new PointerEvent('pointerenter'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    );

    await waitFor(async () => {
      await expect(viewport.dataset.panMode).toBe('true');
    });

    const target = document.elementFromPoint(start.x, start.y);

    await expect(target).not.toBe(handle);

    target?.dispatchEvent(
      new PointerEvent('pointerdown', { ...pointer, clientX: start.x, clientY: start.y })
    );
    target?.dispatchEvent(
      new PointerEvent('pointermove', { ...pointer, clientX: end.x, clientY: end.y })
    );
    target?.dispatchEvent(
      new PointerEvent('pointerup', { ...pointer, clientX: end.x, clientY: end.y })
    );
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));

    /**
     * Сдвиг — обновление состояния окна, и до кадра React стиль прежний.
     */
    await waitFor(async () => {
      await expect(stage.style.transform).not.toBe(transform);
    });
    await expect(readSecondPin()).toStrictEqual(before);
  },
};
