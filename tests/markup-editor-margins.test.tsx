/**
 * @vitest-environment jsdom
 */
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import {
  buildSheetRuling,
  lineCoordinateAt,
  type MarginLineSide,
  type PaperSheet,
  type SheetImageData,
  type SheetPoint,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import {
  selectBlockGeometry,
  selectCalibrationRuling,
} from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache, measureLayout } from '@pages/Generator/model/measureLayout';
import { selectActiveFamily } from '@pages/Generator/model/paperSelectors';
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

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';
import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

type User = ReturnType<typeof userEvent.setup>;

/**
 * Лист в линейку 600×800: шаг 40 px, поля слева 90 и справа 60, черта поля
 * снимка — в столбце 120.
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

/**
 * Зазор блока от линии поля — пятая часть шага, как у найденной автоматом.
 */
const MARGIN_LINE_GAP = PHOTO.step / 5;

/**
 * Длинный текст: раскладка набирает полную первую страницу, и по длине её
 * строк видна ширина блока.
 */
const LONG_TEXT = Array.from({ length: 400 }, () => {
  return 'слово';
}).join(' ');

/**
 * Разлиновка снимка с заданной линией поля.
 *
 * @param marginLineX — столбец линии поля; `null` — её нет
 * @param marginLineSide — сторона линии поля
 * @returns разлиновка
 */
const buildRuling = (
  marginLineX: number | null,
  marginLineSide: MarginLineSide | null
): SheetRuling => {
  return buildSheetRuling(
    {
      step: PHOTO.step,
      firstLinePhase: PHOTO.phase,
      skewAngle: 0,
      margins: PHOTO.margins,
      marginLineX,
      marginLineSide,
    },
    FRAME
  );
};

const SHEET: PaperSheet = {
  id: 'user-margins',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: buildRuling(null, null),
  lighting: null,
  texture: null,
};

/**
 * Кладёт лист в стор, ставит его на страницу, открывает редактор и выбирает
 * инструмент «Поля».
 *
 * @param user — сессия `userEvent`
 * @param ruling — разлиновка листа
 * @param image — каналы фотографии; `null` — ещё не сняты
 * @returns диалог редактора
 */
const openMarginsTool = async (
  user: User,
  ruling: SheetRuling,
  image: SheetImageData | null = null
): Promise<HTMLElement> => {
  const record = buildUserSheetRecord({
    familyId: 'lined',
    sheet: { ...SHEET, ruling },
  });

  useGeneratorStore.getState().addUserSheet(record);
  useGeneratorStore.setState({
    familyId: 'lined',
    sheetId: SHEET.id,
    isSheetPinned: true,
    text: LONG_TEXT,
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
 * Края блока текста, px кадра.
 */
type BlockEdges = {
  /**
   * Левый край.
   */
  left: number;

  /**
   * Правый край.
   */
  right: number;
};

/**
 * Края блока текста на первой странице по сохранённому листу.
 *
 * @returns левый и правый края, px кадра
 */
const readBlockEdges = (): BlockEdges => {
  const geometry = selectBlockGeometry(
    useGeneratorStore.getState(),
    0,
    FALLBACK_FONT_METRICS
  );

  if (!geometry) {
    throw new Error('Геометрии страницы нет');
  }

  return {
    left: geometry.leftPadding,
    right: geometry.leftPadding + geometry.blockWidth,
  };
};

/**
 * Длина самой длинной строки первой страницы в знаках: раскладка по
 * сохранённому листу измерителем с постоянной шириной знака.
 *
 * @returns число знаков
 */
const readLongestLine = (): number => {
  const state = useGeneratorStore.getState();
  const family = selectActiveFamily(state);

  if (!family) {
    throw new Error('Семьи листа нет');
  }

  const [page] = measureLayout(
    {
      text: state.text,
      fontFamily: 'Monospace',
      metrics: FALLBACK_FONT_METRICS,
      correction: state.geometryCorrection,
      bottomMargin: state.bottomMargin,
      runSeed: state.runSeed,
      family,
      sheetId: state.sheetId,
      isSheetPinned: state.isSheetPinned,
    },
    createMonospaceMeasurerFactory({ charWidth: 0.5 }).create
  );

  return (page?.lines || []).reduce((longest, { text }) => {
    return Math.max(longest, text.length);
  }, 0);
};

/**
 * Даёт SVG оверлея единичную экранную матрицу и перетаскивает ручку.
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

  const pointer = { pointerId: 1, clientX: point.x, clientY: point.y };

  fireEvent.pointerDown(handle, { ...pointer, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(handle, pointer);
  fireEvent.pointerUp(handle, pointer);
};

/**
 * Даёт SVG оверлея единичную экранную матрицу: пиксели окна совпадают с
 * пикселями фотографии.
 *
 * @param editor — диалог редактора
 * @returns SVG оверлея
 */
const mockScreenMatrix = (editor: HTMLElement): SVGSVGElement => {
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

  return svg;
};

/**
 * Даёт окну просмотра видимую часть: сцена с фотографией позиционирована в
 * нём, и при единичной матрице его середина — столбец `centerX` фотографии.
 *
 * @param svg — SVG оверлея
 * @param centerX — середина видимой части, px фотографии
 */
const mockVisibleCenter = (svg: SVGSVGElement, centerX: number) => {
  const stage = svg.parentElement;
  const viewport = stage?.parentElement;

  if (!stage || !viewport) {
    throw new Error('Нет окна просмотра');
  }

  Object.defineProperty(stage, 'offsetParent', { configurable: true, value: viewport });

  viewport.getBoundingClientRect = () => {
    return DOMRect.fromRect({ x: centerX - 150, y: 0, width: 300, height: 400 });
  };
};

/**
 * Ведёт добавленную линию поля указателем над фотографией и ставит её
 * нажатием.
 *
 * @param editor — диалог редактора
 * @param point — где нажать, px фотографии
 */
const placeFollowedLine = (editor: HTMLElement, point: SheetPoint) => {
  const svg = mockScreenMatrix(editor);
  const pointer = { pointerId: 1, clientX: point.x, clientY: point.y };

  fireEvent.pointerMove(svg, pointer);
  fireEvent.pointerDown(svg, pointer);
  fireEvent.pointerUp(svg, pointer);
};

/**
 * Сохраняет разметку кнопкой редактора.
 *
 * @param user — сессия `userEvent`
 * @param editor — диалог редактора
 */
const save = async (user: User, editor: HTMLElement) => {
  await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));
  clearLayoutCache();
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

describe('инструмент «Поля»: линия поля', () => {
  it('ложная линия поля убрана → блок ограничен полями листа, а не половиной кадра', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(280, 'left'));
    const before = readBlockEdges();
    const longestBefore = readLongestLine();

    expect(before.left).toBeCloseTo(280 + MARGIN_LINE_GAP, 6);

    await user.click(within(editor).getByRole('button', { name: 'Убрать линию поля' }));

    expect(readDraftRuling().marginLineX).toBeNull();
    expect(readDraftRuling().marginLineSide).toBeNull();
    expect(readBlockEdges()).toStrictEqual(before);

    await save(user, editor);

    const after = readBlockEdges();

    expect(after.left).toBeCloseTo(PHOTO.margins.left, 6);
    expect(after.right).toBeCloseTo(PHOTO.width - PHOTO.margins.right, 6);
    expect(readLongestLine()).toBeGreaterThan(longestBefore * 1.5);
  });

  it('линия поля добавлена у левого края → блок начинается правее неё', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));

    expect(
      within(editor).getByRole('list', { name: 'Сообщения автомата' }).textContent
    ).toMatch(/Линия поля не найдена/);

    await user.click(within(editor).getByRole('button', { name: 'Добавить линию поля' }));

    expect(readDraftRuling().marginLineX).toBeCloseTo(PHOTO.width / 8, 6);
    expect(readDraftRuling().marginLineSide).toBe('left');
    expect(within(editor).queryByRole('list', { name: 'Сообщения автомата' })).toBeNull();

    placeFollowedLine(editor, { x: 160, y: 300 });

    expect(readDraftRuling().marginLineX).toBe(160);
    expect(readDraftRuling().marginLineSide).toBe('left');

    const longestBefore = readLongestLine();

    await save(user, editor);

    expect(readBlockEdges().left).toBeCloseTo(160 + MARGIN_LINE_GAP, 6);
    expect(readLongestLine()).toBeLessThan(longestBefore);
  });

  it('добавленная линия появляется у стороны, ближайшей к видимой части листа', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));

    mockVisibleCenter(mockScreenMatrix(editor), 450);
    await user.click(within(editor).getByRole('button', { name: 'Добавить линию поля' }));

    expect(readDraftRuling().marginLineX).toBeCloseTo(PHOTO.width - PHOTO.width / 8, 6);
    expect(readDraftRuling().marginLineSide).toBe('right');
  });

  it('добавленная линия сразу идёт за указателем и встаёт нажатием', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const svg = mockScreenMatrix(editor);
    const added = PHOTO.width / 8;

    await user.click(within(editor).getByRole('button', { name: 'Добавить линию поля' }));

    expect(within(editor).getByRole('status').textContent).toMatch(/Ведите линию поля/);

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBe(200);

    fireEvent.pointerLeave(svg);

    expect(readDraftRuling().marginLineX).toBeCloseTo(added, 6);

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 420, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 420, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBe(420);
    expect(readDraftRuling().marginLineSide).toBe('right');
    expect(within(editor).queryByRole('status')).toBeNull();

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 300, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBe(420);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraftRuling().marginLineX).toBeCloseTo(added, 6);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraftRuling().marginLineX).toBeNull();
  });

  it('отмена добавления прекращает ведение линии', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const svg = mockScreenMatrix(editor);

    await user.click(within(editor).getByRole('button', { name: 'Добавить линию поля' }));

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBeNull();
    expect(within(editor).queryByRole('status')).toBeNull();
  });

  it('сторона — по положению относительно середины листа', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(280, 'left'));

    dragHandle(within(editor).getByRole('button', { name: 'Линия поля' }), {
      x: 470,
      y: 300,
    });

    expect(readDraftRuling().marginLineSide).toBe('right');
    expect(within(editor).getByText('Линия поля справа.')).toBeDefined();

    await save(user, editor);

    const { left, right } = readBlockEdges();

    expect(left).toBeCloseTo(PHOTO.margins.left, 6);
    expect(right).toBeCloseTo(470 - MARGIN_LINE_GAP, 6);
  });

  it('магнит: линия поля, отпущенная рядом с чертой снимка, встаёт на черту', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(
      user,
      buildRuling(null, null),
      createSyntheticSheet(PHOTO)
    );

    await user.click(within(editor).getByRole('button', { name: 'Добавить линию поля' }));
    placeFollowedLine(editor, { x: PHOTO.marginLineX + 9, y: 300 });

    expect(
      Math.abs((readDraftRuling().marginLineX || 0) - PHOTO.marginLineX)
    ).toBeLessThan(1);
  });

  it('стрелка сдвигает линию поля на пиксель мимо магнита', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(
      user,
      buildRuling(PHOTO.marginLineX, 'left'),
      createSyntheticSheet(PHOTO)
    );
    const handle = within(editor).getByRole('button', { name: 'Линия поля' });

    handle.focus();
    await user.keyboard('{ArrowRight}');

    expect(readDraftRuling().marginLineX).toBeCloseTo(PHOTO.marginLineX + 1, 9);

    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');

    expect(readDraftRuling().marginLineX).toBeCloseTo(PHOTO.marginLineX - 9, 9);
  });

  it('удаление отменяется', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(280, 'left'));

    await user.click(within(editor).getByRole('button', { name: 'Убрать линию поля' }));

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraftRuling().marginLineX).toBe(280);
    expect(
      within(editor).getByRole('button', { name: 'Убрать линию поля' })
    ).toBeDefined();
  });
});

describe('инструмент «Поля»: направляющие', () => {
  it('верхнее поле, отпущенное между линиями, встаёт на ближайшую линию; первая строка — на ней', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const line = PHOTO.phase + 3 * PHOTO.step;

    dragHandle(within(editor).getByRole('button', { name: 'Верхнее поле' }), {
      x: 300,
      y: line + 0.4 * PHOTO.step,
    });

    expect(readDraftRuling().margins.top).toBeCloseTo(line, 6);

    const guide = editor.querySelector('[data-margin-guide="top"]');

    expect(guide?.getAttribute('points')).toBe(`0.00,${line}.00 600.00,${line}.00`);

    await save(user, editor);

    const geometry = selectBlockGeometry(
      useGeneratorStore.getState(),
      0,
      FALLBACK_FONT_METRICS
    );
    const firstBaseline =
      (geometry?.topOffset || 0) +
      FALLBACK_FONT_METRICS.fontAscent * (geometry?.fontSizePx || 0);

    expect(
      selectCalibrationRuling(useGeneratorStore.getState(), 0)?.ruling.margins.top
    ).toBe(line);
    expect(firstBaseline).toBeCloseTo(line, 6);
  });

  it('нижнее поле встаёт на ближайшую линию', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const line = PHOTO.phase + 15 * PHOTO.step;

    dragHandle(within(editor).getByRole('button', { name: 'Нижнее поле' }), {
      x: 300,
      y: line - 0.3 * PHOTO.step,
    });

    expect(PHOTO.height - readDraftRuling().margins.bottom).toBeCloseTo(line, 6);
  });

  it('боковые поля стоят, где отпущены, и ограничивают блок', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));

    dragHandle(within(editor).getByRole('button', { name: 'Левое поле' }), {
      x: 133.3,
      y: 400,
    });
    dragHandle(within(editor).getByRole('button', { name: 'Правое поле' }), {
      x: 511.7,
      y: 400,
    });

    const { margins } = readDraftRuling();

    expect(margins.left).toBeCloseTo(133.3, 6);
    expect(margins.right).toBeCloseTo(PHOTO.width - 511.7, 6);

    await save(user, editor);

    const { left, right } = readBlockEdges();

    expect(left).toBeCloseTo(133.3, 6);
    expect(right).toBeCloseTo(511.7, 6);
  });

  it('направляющая не заходит за противоположную', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));

    dragHandle(within(editor).getByRole('button', { name: 'Верхнее поле' }), {
      x: 300,
      y: PHOTO.height + 50,
    });

    expect(readDraftRuling().margins.top).toBeLessThanOrEqual(
      PHOTO.height - PHOTO.margins.bottom
    );
  });
});

/**
 * Точки ломаной SVG из атрибута `points`.
 *
 * @param element — ломаная
 * @returns точки в пикселях фотографии
 */
const readPoints = (element: Element | null): SheetPoint[] => {
  return (element?.getAttribute('points') || '')
    .split(' ')
    .filter(Boolean)
    .map((pair) => {
      const [x = '', y = ''] = pair.split(',');

      return { x: Number(x), y: Number(y) };
    });
};

describe('пунктир полей в оверлее', () => {
  it('на наклонном листе с перспективой верхнее и нижнее поля идут вдоль линии, как их читает раскладка', async () => {
    const user = userEvent.setup();
    const ruling = buildSheetRuling(
      {
        step: PHOTO.step,
        firstLinePhase: PHOTO.phase,
        skewAngle: 3,
        perspective: {
          originX: 300,
          originY: 400,
          convergenceX: 4e-5,
          convergenceY: 6e-5,
        },
        margins: PHOTO.margins,
        marginLineX: null,
        marginLineSide: null,
      },
      FRAME
    );
    const editor = await openMarginsTool(user, ruling);
    const expected = {
      top: lineCoordinateAt(ruling, 0, ruling.margins.top),
      bottom: lineCoordinateAt(ruling, 0, PHOTO.height - ruling.margins.bottom),
    };

    (['top', 'bottom'] as const).forEach((side) => {
      const dashed = readPoints(editor.querySelector(`[data-margin="${side}"]`));
      const guide = readPoints(editor.querySelector(`[data-margin-guide="${side}"]`));

      expect(dashed).toHaveLength(2);
      dashed.forEach(({ x, y }) => {
        expect(lineCoordinateAt(ruling, x, y)).toBeCloseTo(expected[side], 1);
      });
      expect(dashed).toStrictEqual(guide);
    });

    const [left, right] = readPoints(editor.querySelector('[data-margin="top"]'));

    expect(Math.abs((right?.y || 0) - (left?.y || 0))).toBeGreaterThan(PHOTO.step / 2);
  });
});
