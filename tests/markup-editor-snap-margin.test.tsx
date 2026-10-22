/**
 * @vitest-environment jsdom
 */
import {
  buildSheetRuling,
  type PaperSheet,
  type SheetImageData,
  type SheetPoint,
  type SheetRuling,
  snapToMarginLine,
} from '@pages/Generator/lib/paper';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SyntheticSheetParams } from './helpers/synthetic-sheet';
import {
  computeSyntheticColumnX,
  createSyntheticSheet,
  RED_MARGIN_LINE_COLOUR,
} from './helpers/synthetic-sheet';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Клетка 600×800 с шагом 40 и бледной красной чертой поля в столбце 110 —
 * в четверти шага от вертикали клетки 100, которая по яркости темнее черты.
 */
const PHOTO = {
  width: 600,
  height: 800,
  step: 40,
  phase: 20,
  kind: 'grid',
  margins: { top: 60, right: 60, bottom: 60, left: 60 },
  lineDarkness: 0.4,
  marginLineX: 110,
  marginLineDarkness: 0.2,
  noise: 0.02,
  lighting: 0.2,
  seed: 31,
  colour: RED_MARGIN_LINE_COLOUR,
} satisfies SyntheticSheetParams;

const RED_LINE_X = 110;

const FRAME = { width: PHOTO.width, height: PHOTO.height };

const SHEET_LABEL = 'Тетрадь в клетку';

/**
 * Допуск попадания на черту из задачи 5.3, px.
 */
const SNAP_TOLERANCE_PX = 0.5;

const RULING: SheetRuling = buildSheetRuling(
  {
    step: PHOTO.step,
    firstLinePhase: 20,
    skewAngle: 0,
    margins: { top: 60, right: 60, bottom: 60, left: 60 },
    marginLineX: null,
    marginLineSide: null,
  },
  FRAME
);

const SHEET: PaperSheet = {
  id: 'user-snap-margin',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: RULING,
  lighting: null,
  texture: null,
};

/**
 * Открывает редактор листа с каналами фотографии и выбирает инструмент «Поля».
 *
 * @param user — сессия `userEvent`
 * @param image — каналы фотографии
 * @returns диалог редактора
 */
const openMarginsTool = async (
  user: ReturnType<typeof userEvent.setup>,
  image: SheetImageData
): Promise<HTMLElement> => {
  const record = buildUserSheetRecord({ familyId: 'grid', sheet: SHEET });

  useGeneratorStore.getState().addUserSheet(record);
  useGeneratorStore.setState({
    familyId: 'grid',
    sheetId: SHEET.id,
    isSheetPinned: true,
  });
  useMarkupEditorStore.getState().open(record, image);
  render(<SheetMarkupEditor />);

  const editor = await screen.findByRole('dialog', {
    name: `Разметка листа «${SHEET_LABEL}»`,
  });

  await user.click(within(editor).getByRole('radio', { name: 'Поля' }));

  return editor;
};

/**
 * Ведёт добавленную линию поля указателем над фотографией при единичной
 * экранной матрице и ставит её нажатием.
 *
 * @param editor — диалог редактора
 * @param point — где нажать, px фотографии
 */
const placeFollowedLine = (editor: HTMLElement, point: SheetPoint) => {
  const svg = editor.querySelector<SVGSVGElement>('svg[aria-label="Разметка листа"]');

  if (!svg) {
    throw new Error('Нет оверлея');
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

  const pointer = { pointerId: 1, clientX: point.x, clientY: point.y };

  fireEvent.pointerMove(svg, pointer);
  fireEvent.pointerDown(svg, pointer);
  fireEvent.pointerUp(svg, pointer);
};

beforeEach(() => {
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
  useMarkupEditorStore.getState().close();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage?.clear();
});

afterEach(() => {
  cleanup();
});

describe('магнит линии поля по цвету', () => {
  it('добавленная линия поля притянута к красной черте, а не к вертикали клетки', async () => {
    const user = userEvent.setup();
    const image = createSyntheticSheet(PHOTO);
    const point = { x: RED_LINE_X - 0.2 * PHOTO.step, y: 300 };
    const columnX = computeSyntheticColumnX(PHOTO, 2, point.y);

    expect(
      Math.abs((snapToMarginLine(image, point, PHOTO.step)?.x || 0) - columnX)
    ).toBeLessThan(1);

    const editor = await openMarginsTool(user, image);

    await user.click(within(editor).getByRole('button', { name: 'Добавить линию поля' }));
    placeFollowedLine(editor, point);

    const { marginLineX, marginLineSide } =
      useMarkupEditorStore.getState().draft?.ruling || RULING;

    expect(marginLineSide).toBe('left');
    expect(Math.abs((marginLineX || 0) - RED_LINE_X)).toBeLessThanOrEqual(
      SNAP_TOLERANCE_PX
    );
  });
});
