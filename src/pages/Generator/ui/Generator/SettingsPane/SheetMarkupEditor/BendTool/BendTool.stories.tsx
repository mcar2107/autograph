import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { LINED_FAMILY_ID } from '../../../../../config';
import type { PaperSheet, SheetPoint } from '../../../../../lib/paper';
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

const SHEET_ID = 'user-bend-drag';

/**
 * Допуск попадания линии через отпущенную точку, px фотографии.
 */
const PIXEL_TOLERANCE = 1;

/**
 * На какую долю шага уводится точка линии: заметно, но не до соседней линии.
 */
const DRAG_SHARE = 0.3;

/**
 * Столбец, за который берётся линия, — доля ширины кадра: у левого края, как
 * прогиб у пружины.
 */
const GRAB_SHARE = 0.25;

const LOAD_TIMEOUT = 20_000;

/**
 * Линия, за которую берёт инструмент.
 */
type GrabbedLine = {
  /**
   * Полоса захвата линии.
   */
  line: SVGPolylineElement;

  /**
   * Номер линии разлиновки.
   */
  index: number;
};

/**
 * Кладёт лист пресет-пака в линейку своим листом, открывает редактор и
 * выбирает инструмент «Изгиб».
 *
 * @param canvasElement — корень story
 * @returns открытый лист
 */
const openBendTool = async (canvasElement: HTMLElement): Promise<PaperSheet> => {
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

  const body = within(canvasElement.ownerDocument.body);

  await userEvent.click(await body.findByRole('radio', { name: 'Изгиб' }));

  return sheet;
};

/**
 * Линия для захвата — средняя из нарисованных инструментом.
 *
 * @returns ломаная захвата и номер линии
 */
const findMiddleLine = async (): Promise<GrabbedLine> => {
  return await waitFor(() => {
    const lines = [
      ...document.querySelectorAll<SVGPolylineElement>('[data-bend-line-index]'),
    ];
    const line = lines[Math.floor(lines.length / 2)];

    if (!line) {
      throw new Error('Инструмент «Изгиб» не нарисовал линий');
    }

    return { line, index: Number(line.dataset.bendLineIndex) };
  });
};

/**
 * Точка фотографии в координатах окна браузера.
 *
 * @param element — элемент внутри SVG оверлея
 * @param point — точка, px фотографии
 * @returns точка окна
 */
const toClientPoint = (element: SVGGraphicsElement, point: SheetPoint): SheetPoint => {
  const matrix = element.ownerSVGElement?.getScreenCTM();

  if (!matrix) {
    throw new Error('У оверлея нет экранной матрицы');
  }

  const { a, b, c, d, e, f } = matrix;

  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
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
 * Настоящее событие указателя в точке окна.
 *
 * @param target — элемент под указателем
 * @param type — тип события
 * @param point — точка окна
 */
const dispatchPointer = (target: Element, type: string, point: SheetPoint) => {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: point.x,
      clientY: point.y,
    })
  );
};

const meta = {
  component: SheetMarkupEditor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SheetMarkupEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Линия, взятая у левого края листа и отпущенная ниже, проходит через точку
 * отпускания — в разметке, которую рисует оверлей, а не только в черновике.
 */
export const DragLinePassesThroughPoint: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openBendTool(canvasElement);
    const { line, index } = await findMiddleLine();
    const x = Math.round(sheet.width * GRAB_SHARE);
    const grabbed = { x, y: readOverlayLineY(index, x) };
    const released = { x, y: grabbed.y + DRAG_SHARE * sheet.ruling.step };
    const target = document.elementFromPoint(
      toClientPoint(line, grabbed).x,
      toClientPoint(line, grabbed).y
    );

    await expect(target).toBe(line);

    dispatchPointer(line, 'pointerdown', toClientPoint(line, grabbed));
    dispatchPointer(line, 'pointermove', toClientPoint(line, released));
    dispatchPointer(line, 'pointerup', toClientPoint(line, released));

    await waitFor(
      async () => {
        await expect(
          Math.abs(readOverlayLineY(index, x) - released.y)
        ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
      },
      { timeout: LOAD_TIMEOUT }
    );
    await expect(useMarkupEditorStore.getState().history.past).toHaveLength(1);
  },
};

/**
 * С зажатым пробелом нажатие поверх линии сдвигает фотографию, а не линию:
 * полосы захвата лежат в оверлее порталом и в режиме панорамы нажатие
 * пропускают.
 */
export const SpaceOverLinePansPhoto: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openBendTool(canvasElement);
    const { line, index } = await findMiddleLine();
    const x = Math.round(sheet.width * GRAB_SHARE);
    const before = useMarkupEditorStore.getState().draft?.ruling;
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="markup-viewport"]'
    );
    const stage = document.querySelector<HTMLElement>('[data-testid="markup-stage"]');

    if (!viewport || !stage) {
      throw new Error('Нет окна просмотра');
    }

    const { transform } = stage.style;
    const start = toClientPoint(line, { x, y: readOverlayLineY(index, x) });
    const end = { x: start.x + 40, y: start.y + 30 };

    viewport.dispatchEvent(new PointerEvent('pointerenter'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    );

    await waitFor(async () => {
      await expect(viewport.dataset.panMode).toBe('true');
    });

    const target = document.elementFromPoint(start.x, start.y);

    await expect(target).not.toBe(line);

    if (target) {
      dispatchPointer(target, 'pointerdown', start);
      dispatchPointer(target, 'pointermove', end);
      dispatchPointer(target, 'pointerup', end);
    }

    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));

    await waitFor(async () => {
      await expect(stage.style.transform).not.toBe(transform);
    });
    await expect(useMarkupEditorStore.getState().draft?.ruling).toBe(before);
  },
};
