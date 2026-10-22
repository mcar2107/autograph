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
import {
  CORNER_HEIGHT_SLOP,
  isCornerDragVertical,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/marginsGeometry';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';
import {
  dragMarginSide,
  dragSideEdge,
  readHandlePoint,
  SIDE_HANDLE_ENDS,
} from './helpers/side-handles';
import {
  computeSyntheticMarginLineX,
  createSyntheticSheet,
} from './helpers/synthetic-sheet';
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

    expect(
      within(within(editor).getByRole('region', { name: 'Поля листа' })).getByRole(
        'status'
      ).textContent
    ).toMatch(/Ведите линию поля/);

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBe(200);

    fireEvent.pointerLeave(svg);

    expect(readDraftRuling().marginLineX).toBeCloseTo(added, 6);

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 420, clientY: 300 });
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 420, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBe(420);
    expect(readDraftRuling().marginLineSide).toBe('right');
    expect(
      within(within(editor).getByRole('region', { name: 'Поля листа' })).queryByRole(
        'status'
      )
    ).toBeNull();

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

    /**
     * Подсказка ведения гаснет сразу, а не с первым движением над фото.
     */
    expect(
      within(within(editor).getByRole('region', { name: 'Поля листа' })).queryByRole(
        'status'
      )
    ).toBeNull();

    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 300 });

    expect(readDraftRuling().marginLineX).toBeNull();
    expect(
      within(within(editor).getByRole('region', { name: 'Поля листа' })).queryByRole(
        'status'
      )
    ).toBeNull();
  });

  it('сторона — по положению относительно середины листа', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(280, 'left'));

    dragSideEdge(editor, 'Линия поля', 470, dragHandle);

    expect(readDraftRuling().marginLineSide).toBe('right');
    expect(within(editor).getByText('Линия поля справа.')).toBeDefined();

    await save(user, editor);

    const { left, right } = readBlockEdges();

    expect(left).toBeCloseTo(PHOTO.margins.left, 6);
    expect(right).toBeCloseTo(470 - MARGIN_LINE_GAP, 6);
  });

  it('магнит: каждая ручка встаёт на наклонную черту в своей строке', async () => {
    const user = userEvent.setup();
    const photo = { ...PHOTO, marginLineDrift: 3 };
    const editor = await openMarginsTool(
      user,
      buildRuling(PHOTO.marginLineX, 'left'),
      createSyntheticSheet(photo)
    );

    for (const end of SIDE_HANDLE_ENDS) {
      const handle = within(editor).getByRole('button', { name: `Линия поля ${end}` });
      const { y } = readHandlePoint(handle);

      dragHandle(handle, { x: (computeSyntheticMarginLineX(photo, y) || 0) + 9, y });
    }

    for (const end of SIDE_HANDLE_ENDS) {
      const { x, y } = readHandlePoint(
        within(editor).getByRole('button', { name: `Линия поля ${end}` })
      );

      expect(Math.abs(x - (computeSyntheticMarginLineX(photo, y) || 0))).toBeLessThan(1);
    }

    expect(readDraftRuling().sideSlant?.marginLineX).not.toBeNull();
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

    /**
     * Нажимает клавишу на обеих ручках линии поля по очереди.
     *
     * @param keys — клавиши в записи `user-event`
     */
    const pressOnBoth = async (keys: string) => {
      for (const end of SIDE_HANDLE_ENDS) {
        within(editor)
          .getByRole('button', { name: `Линия поля ${end}` })
          .focus();
        await user.keyboard(keys);
      }
    };

    await pressOnBoth('{ArrowRight}');

    expect(readDraftRuling().marginLineX).toBeCloseTo(PHOTO.marginLineX + 1, 9);
    expect(readDraftRuling().sideSlant).toBeNull();

    await pressOnBoth('{Shift>}{ArrowLeft}{/Shift}');

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

describe('инструмент «Поля»: боковые поля двумя углами', () => {
  it('поле вдоль наклонной стороны листа — строки ниже начинаются левее и шире', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const top = readHandlePoint(
      within(editor).getByRole('button', { name: 'Левый верхний угол полей' })
    );
    const bottom = within(editor).getByRole('button', {
      name: 'Левый нижний угол полей',
    });

    dragHandle(bottom, { x: 40, y: readHandlePoint(bottom).y });

    expect(
      readHandlePoint(
        within(editor).getByRole('button', { name: 'Левый верхний угол полей' })
      )
    ).toStrictEqual(top);
    expect(
      readHandlePoint(
        within(editor).getByRole('button', { name: 'Левый нижний угол полей' })
      ).x
    ).toBeCloseTo(40, 9);
    expect(readDraftRuling().sideSlant?.left).toBeLessThan(40);

    await user.click(within(editor).getByRole('button', { name: 'Точные значения' }));

    expect(
      (
        within(editor).getByRole('textbox', {
          name: 'Левое поле снизу, px',
        }) as HTMLInputElement
      ).value
    ).toBe('40');

    await save(user, editor);

    const geometry = selectBlockGeometry(
      useGeneratorStore.getState(),
      0,
      FALLBACK_FONT_METRICS
    );
    const offsets = geometry?.lineBounds?.offsets || [];
    const widths = geometry?.lineBounds?.widths || [];

    expect(offsets.length).toBeGreaterThan(10);
    expect(offsets.at(-1)).toBeLessThan(-30);
    expect(widths.at(-1)).toBeGreaterThan((widths[0] || 0) + 30);
  });
});

/**
 * Ручка угла области текста.
 *
 * @param editor — диалог редактора
 * @param name — подпись угла без хвоста: «Левый верхний»
 * @returns ручка
 */
const getCorner = (editor: HTMLElement, name: string): HTMLElement => {
  return within(editor).getByRole('button', { name: `${name} угол полей` });
};

/**
 * Число шагов в истории черновика.
 *
 * @returns длина прошлого истории
 */
const readHistoryLength = (): number => {
  return useMarkupEditorStore.getState().history.past.length;
};

describe('инструмент «Поля»: углы области текста', () => {
  it('угол по диагонали двигает конец бокового поля и верхнее поле одним шагом истории', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const line = PHOTO.phase + 3 * PHOTO.step;
    const leftBottom = readHandlePoint(getCorner(editor, 'Левый нижний'));
    const rightTop = readHandlePoint(getCorner(editor, 'Правый верхний'));
    const rightBottom = readHandlePoint(getCorner(editor, 'Правый нижний'));
    const historyBefore = readHistoryLength();

    dragHandle(getCorner(editor, 'Левый верхний'), {
      x: 130,
      y: line + 0.4 * PHOTO.step,
    });

    const edited = readDraftRuling();

    expect(readHistoryLength()).toBe(historyBefore + 1);
    expect(edited.margins.top).toBeCloseTo(line, 6);
    expect(readHandlePoint(getCorner(editor, 'Левый верхний'))).toStrictEqual({
      x: 130,
      y: line,
    });
    expect(readHandlePoint(getCorner(editor, 'Левый нижний'))).toStrictEqual(leftBottom);
    expect(edited.sideSlant?.left).toBeLessThan(130);

    /**
     * Соседний угол едет по высоте вместе с полем, а конец правого поля
     * остаётся на месте.
     */
    expect(readHandlePoint(getCorner(editor, 'Правый верхний'))).toStrictEqual({
      x: rightTop.x,
      y: line,
    });
    expect(readHandlePoint(getCorner(editor, 'Правый нижний'))).toStrictEqual(
      rightBottom
    );
    expect(edited.margins.right).toBe(PHOTO.margins.right);
    expect(edited.sideSlant?.right).toBe(PHOTO.margins.right);

    await user.click(within(editor).getByRole('button', { name: 'Точные значения' }));

    const readField = (name: string): string => {
      return (within(editor).getByRole('textbox', { name }) as HTMLInputElement).value;
    };

    expect(readField('Левое поле сверху, px')).toBe('130');
    expect(readField('Верхнее поле, px')).toBe(String(line));

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraftRuling().margins).toStrictEqual(PHOTO.margins);
    expect(readDraftRuling().sideSlant).toBeNull();
  });

  it('нижний угол двигает свой конец бокового поля и нижнее поле', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const line = PHOTO.phase + 15 * PHOTO.step;
    const rightTop = readHandlePoint(getCorner(editor, 'Правый верхний'));

    dragHandle(getCorner(editor, 'Правый нижний'), {
      x: 520,
      y: line - 0.3 * PHOTO.step,
    });

    const edited = readDraftRuling();

    expect(PHOTO.height - edited.margins.bottom).toBeCloseTo(line, 6);
    expect(edited.sideSlant?.right).toBeGreaterThan(PHOTO.width - 520);
    expect(readHandlePoint(getCorner(editor, 'Правый нижний'))).toStrictEqual({
      x: 520,
      y: line,
    });
    expect(readHandlePoint(getCorner(editor, 'Правый верхний'))).toStrictEqual(rightTop);
    expect(readHandlePoint(getCorner(editor, 'Левый нижний')).y).toBe(line);
  });

  it('стрелки: ←→ — конец бокового поля, ↑↓ — поле по высоте, на пиксель без магнита', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const leftTop = readHandlePoint(getCorner(editor, 'Левый верхний'));

    getCorner(editor, 'Левый нижний').focus();
    await user.keyboard('{ArrowRight}');

    expect(readHandlePoint(getCorner(editor, 'Левый нижний')).x).toBeCloseTo(
      PHOTO.margins.left + 1,
      9
    );
    expect(readDraftRuling().margins.top).toBe(PHOTO.margins.top);
    expect(readDraftRuling().margins.bottom).toBe(PHOTO.margins.bottom);
    expect(readHandlePoint(getCorner(editor, 'Левый верхний'))).toStrictEqual(leftTop);

    getCorner(editor, 'Левый нижний').focus();
    await user.keyboard('{ArrowUp}');

    expect(readDraftRuling().margins.bottom).toBeCloseTo(PHOTO.margins.bottom + 1, 9);
    expect(readHandlePoint(getCorner(editor, 'Левый нижний')).x).toBeCloseTo(
      PHOTO.margins.left + 1,
      1
    );
    expect(readHandlePoint(getCorner(editor, 'Левый верхний'))).toStrictEqual(leftTop);

    getCorner(editor, 'Правый верхний').focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    expect(readDraftRuling().margins.top).toBeCloseTo(PHOTO.margins.top + 10, 9);
    expect(readDraftRuling().margins.right).toBe(PHOTO.margins.right);
  });

  it('середина края двигает поле только по высоте, стрелкой — на пиксель', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(null, null));
    const handle = within(editor).getByRole('button', { name: 'Верхнее поле' });

    handle.focus();
    await user.keyboard('{ArrowDown}');

    expect(readDraftRuling().margins.top).toBeCloseTo(PHOTO.margins.top + 1, 9);

    const historyBefore = readHistoryLength();

    within(editor).getByRole('button', { name: 'Верхнее поле' }).focus();
    await user.keyboard('{ArrowLeft}');

    expect(readHistoryLength()).toBe(historyBefore);
    expect(readDraftRuling().sideSlant).toBeNull();
  });
});

/**
 * Нижнее поле не на линии: направляющая в строке 750, между линиями 740 и
 * 780, — как у пресетов, где нижнее поле стоит в доле шага от линии.
 */
const OFF_LINE_MARGINS = { ...PHOTO.margins, bottom: 50 };

/**
 * Строка нижней направляющей листа с полем не на линии.
 */
const OFF_LINE_BOTTOM = PHOTO.height - OFF_LINE_MARGINS.bottom;

/**
 * Верхнее и нижнее поля листа с нижним полем не на линии.
 */
const OFF_LINE_HEIGHT_MARGINS = {
  top: OFF_LINE_MARGINS.top,
  bottom: OFF_LINE_MARGINS.bottom,
};

/**
 * Верхнее и нижнее поля черновика — поле по высоте, которое двигает угол.
 *
 * @returns верхнее и нижнее поля, px
 */
const readHeightMargins = (): typeof OFF_LINE_HEIGHT_MARGINS => {
  const { top, bottom } = readDraftRuling().margins;

  return { top, bottom };
};

/**
 * Наклон листа для проверки угла на наклонной разлиновке, градусы.
 */
const SKEW_ANGLE = 2;

/**
 * Разлиновка с нижним полем не на линии.
 *
 * @param skewAngle — наклон листа, градусы
 * @returns разлиновка
 */
const buildOffLineRuling = (skewAngle = 0): SheetRuling => {
  return buildSheetRuling(
    {
      step: PHOTO.step,
      firstLinePhase: PHOTO.phase,
      skewAngle,
      margins: OFF_LINE_MARGINS,
      marginLineX: null,
      marginLineSide: null,
    },
    FRAME
  );
};

/**
 * Экранный радиус круга захвата ручки — `HANDLE_RADIUS` в `MarkupHandle`.
 */
const HANDLE_SCREEN_RADIUS = 10;

/**
 * Масштаб окна редактора — экранных пикселей на пиксель фотографии. Ручка
 * держит постоянный экранный радиус, поэтому масштаб читается из него.
 *
 * @param handle — ручка
 * @returns масштаб
 */
const readScale = (handle: HTMLElement): number => {
  return HANDLE_SCREEN_RADIUS / Number(handle.getAttribute('r'));
};

/**
 * Перетаскивание указателем по пути: нажатие в первой точке, движения по
 * остальным, отпускание в последней. Путь из одной точки — нажатие и
 * отпускание без движения. Экранная матрица единичная — точки в пикселях
 * фотографии.
 *
 * @param handle — ручка
 * @param path — точки указателя, px фотографии
 * @param onMove — проверка после каждого движения
 */
const dragHandleAlong = (
  handle: HTMLElement,
  path: SheetPoint[],
  onMove: () => void = () => {}
) => {
  const svg = handle.closest('svg');
  const [start, ...moves] = path;

  if (!svg || !start) {
    throw new Error('Ручка вне SVG или путь пустой');
  }

  const end = moves.at(-1) || start;

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

  fireEvent.pointerDown(handle, { pointerId: 1, clientX: start.x, clientY: start.y });

  for (const { x, y } of moves) {
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: x, clientY: y });
    onMove();
  }

  fireEvent.pointerUp(handle, { pointerId: 1, clientX: end.x, clientY: end.y });
};

describe('инструмент «Поля»: порог высоты у угла', () => {
  it('угол вбок на листе, где нижнее поле не на линии: поле по высоте то же до бита, меняется только наклон', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling());
    const corner = getCorner(editor, 'Левый нижний');
    const leftTop = readHandlePoint(getCorner(editor, 'Левый верхний'));
    const historyBefore = readHistoryLength();

    expect(readHandlePoint(corner)).toStrictEqual({
      x: PHOTO.margins.left,
      y: OFF_LINE_BOTTOM,
    });

    dragHandleAlong(
      corner,
      [
        { x: PHOTO.margins.left, y: OFF_LINE_BOTTOM },
        { x: 110, y: OFF_LINE_BOTTOM },
        { x: 130, y: OFF_LINE_BOTTOM },
      ],
      () => {
        expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);
      }
    );

    const edited = readDraftRuling();

    expect(readHistoryLength()).toBe(historyBefore + 1);
    expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);
    expect(edited.margins.right).toBe(OFF_LINE_MARGINS.right);
    expect(edited.sideSlant?.left).toBeGreaterThan(130);
    expect(readHandlePoint(getCorner(editor, 'Левый нижний'))).toStrictEqual({
      x: 130,
      y: OFF_LINE_BOTTOM,
    });
    expect(readHandlePoint(getCorner(editor, 'Левый верхний'))).toStrictEqual(leftTop);
  });

  it('дрожь указателя по высоте в пределах порога поле по высоте не трогает', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling());
    const corner = getCorner(editor, 'Левый нижний');
    const jitter = CORNER_HEIGHT_SLOP / readScale(corner);

    dragHandleAlong(
      corner,
      [
        { x: PHOTO.margins.left, y: OFF_LINE_BOTTOM },
        { x: 100, y: OFF_LINE_BOTTOM - jitter },
        { x: 115, y: OFF_LINE_BOTTOM + jitter },
        { x: 130, y: OFF_LINE_BOTTOM + jitter },
      ],
      () => {
        expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);
      }
    );

    expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);
    expect(readHandlePoint(getCorner(editor, 'Левый нижний')).x).toBe(130);
  });

  it('порог мерится от точки нажатия, а не от центра ручки', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling());
    const corner = getCorner(editor, 'Левый нижний');

    /**
     * Нажали ниже центра ручки, но внутри круга захвата, и повели вбок.
     */
    const grab = OFF_LINE_BOTTOM + (CORNER_HEIGHT_SLOP + 2) / readScale(corner);

    dragHandleAlong(corner, [
      { x: PHOTO.margins.left, y: grab },
      { x: 110, y: grab },
      { x: 130, y: grab },
    ]);

    expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);
  });

  it('нажатие на угол ниже центра и отпускание без движения поле по высоте не трогают', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling());
    const corner = getCorner(editor, 'Левый нижний');

    /**
     * Нажатие внутри круга захвата, но дальше порога от центра ручки.
     */
    const grab = OFF_LINE_BOTTOM + (CORNER_HEIGHT_SLOP + 2) / readScale(corner);

    dragHandleAlong(corner, [{ x: PHOTO.margins.left, y: grab }]);

    expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);
  });

  it('сдвиг по высоте больше порога — поле встаёт на ближайшую линию, даже если указатель вернулся', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling());
    const corner = getCorner(editor, 'Левый нижний');
    const beyond = (CORNER_HEIGHT_SLOP + 1) / readScale(corner);

    dragHandleAlong(corner, [
      { x: PHOTO.margins.left, y: OFF_LINE_BOTTOM },
      { x: 130, y: OFF_LINE_BOTTOM + beyond },
    ]);

    /**
     * Строка 750 ближе к линии 740, чем к 780.
     */
    expect(readHeightMargins()).toStrictEqual({ ...OFF_LINE_HEIGHT_MARGINS, bottom: 60 });

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    dragHandleAlong(getCorner(editor, 'Левый нижний'), [
      { x: PHOTO.margins.left, y: OFF_LINE_BOTTOM },
      { x: 110, y: OFF_LINE_BOTTOM - beyond },
      { x: 130, y: OFF_LINE_BOTTOM },
    ]);

    expect(readDraftRuling().margins.bottom).toBeCloseTo(60, 9);
  });

  it('порог — в экранных пикселях окна: сдвиг фотографии, бывший дрожью, при приближении ставит поле на линию', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling());

    /**
     * Три пикселя фотографии: при масштабе 1 это три экранных пикселя, в
     * пределах порога, при масштабе 2 — шесть, за ним.
     */
    const shift = CORNER_HEIGHT_SLOP - 1;
    const path = [
      { x: PHOTO.margins.left, y: OFF_LINE_BOTTOM },
      { x: 130, y: OFF_LINE_BOTTOM + shift },
    ];

    expect(readScale(getCorner(editor, 'Левый нижний'))).toBe(1);

    dragHandleAlong(getCorner(editor, 'Левый нижний'), path);

    expect(readHeightMargins()).toStrictEqual(OFF_LINE_HEIGHT_MARGINS);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    await user.click(within(editor).getByRole('button', { name: 'Приблизить' }));
    await user.click(within(editor).getByRole('button', { name: 'Приблизить' }));

    expect(readScale(getCorner(editor, 'Левый нижний'))).toBeCloseTo(2, 9);

    dragHandleAlong(getCorner(editor, 'Левый нижний'), path);

    expect(readDraftRuling().margins.bottom).toBeCloseTo(60, 9);
  });

  it('угол вбок на листе с наклоном: поле по высоте то же до бита, сдвиг за порог ставит его на линию', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildOffLineRuling(SKEW_ANGLE));
    const start = readHandlePoint(getCorner(editor, 'Левый нижний'));
    const before = readHeightMargins();

    dragHandleAlong(getCorner(editor, 'Левый нижний'), [
      start,
      { x: start.x + 20, y: start.y + CORNER_HEIGHT_SLOP / 2 },
      { x: start.x + 40, y: start.y },
    ]);

    expect(readHeightMargins()).toStrictEqual(before);
    expect(readDraftRuling().sideSlant?.left).toBeGreaterThan(start.x);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    /**
     * Точка чуть ниже середины промежутка между линиями 740 и 780 по высоте,
     * но выше неё по координате вдоль линий: наклон в два градуса на
     * столбце 130 поднимает координату на четыре с половиной пикселя.
     */
    const release = { x: start.x + 40, y: 762 };

    dragHandleAlong(getCorner(editor, 'Левый нижний'), [start, release]);

    /**
     * Поле встаёт на линию, ближайшую к точке отпускания по координате вдоль
     * линий, а не по высоте: у середины промежутка на наклонном листе это
     * разные линии.
     */
    const ruling = buildOffLineRuling(SKEW_ANGLE);
    const u = lineCoordinateAt(ruling, release.x, release.y);
    const line = PHOTO.phase + Math.round((u - PHOTO.phase) / PHOTO.step) * PHOTO.step;
    const byHeight =
      PHOTO.phase + Math.round((release.y - PHOTO.phase) / PHOTO.step) * PHOTO.step;

    expect(line).not.toBe(byHeight);

    expect(readHeightMargins().top).toBe(before.top);
    expect(readHeightMargins().bottom).toBeCloseTo(PHOTO.height - line, 9);
    expect(readHeightMargins().bottom).not.toBe(before.bottom);
  });

  it('порог — в экранных пикселях: тот же сдвиг фотографии при приближении уже не дрожь', () => {
    expect(isCornerDragVertical(OFF_LINE_BOTTOM, OFF_LINE_BOTTOM + 3, 1)).toBe(false);
    expect(isCornerDragVertical(OFF_LINE_BOTTOM, OFF_LINE_BOTTOM - 3, 2)).toBe(true);
    expect(
      isCornerDragVertical(
        OFF_LINE_BOTTOM,
        OFF_LINE_BOTTOM + CORNER_HEIGHT_SLOP * 4,
        0.25
      )
    ).toBe(false);
  });
});

describe('инструмент «Поля»: направляющие', () => {
  it('верхнее поле, отпущенное между линиями, встаёт на ближайшую линию; первая строка — на линии под ним', async () => {
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
    expect(firstBaseline).toBeCloseTo(line + PHOTO.step, 6);
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

    dragMarginSide(editor, 'Левый', 133.3, dragHandle);
    dragMarginSide(editor, 'Правый', 511.7, dragHandle);

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
 * Разлиновка листа, снятого на столе: изгиб, перспектива и контур сразу.
 * Правка полей не должна задеть ни одно из трёх — все они отсчитаны от
 * гребёнки, которую поля не меняют.
 *
 * @returns разлиновка
 */
const buildCurvedRuling = (): SheetRuling => {
  const columnCount = 4;
  const rowCount = 20;

  return buildSheetRuling(
    {
      step: PHOTO.step,
      firstLinePhase: PHOTO.phase,
      skewAngle: 1,
      bend: {
        columnOrigin: 120,
        columnSpacing: 120,
        columnCount,
        rowOrigin: PHOTO.phase,
        rowSpacing: PHOTO.step,
        rowCount,
        offsets: Array.from({ length: columnCount * rowCount }, (_, index) => {
          return Math.round(300 * Math.sin(index)) / 100;
        }),
      },
      perspective: {
        originX: 300,
        originY: 400,
        convergenceX: 4e-5,
        convergenceY: 6e-5,
      },
      outline: {
        topLeft: { x: 12, y: 8 },
        topRight: { x: 590, y: 14 },
        bottomRight: { x: 586, y: 792 },
        bottomLeft: { x: 9, y: 786 },
      },
      margins: PHOTO.margins,
      marginLineX: null,
      marginLineSide: null,
    },
    FRAME
  );
};

/**
 * Открывает «Точные значения» и набирает число в поле.
 *
 * @param user — сессия `userEvent`
 * @param editor — диалог редактора
 * @param name — подпись поля
 * @param value — набираемое значение
 */
const typeExactValue = async (
  user: User,
  editor: HTMLElement,
  name: string,
  value: string
) => {
  if (!within(editor).queryByRole('textbox', { name })) {
    await user.click(within(editor).getByRole('button', { name: 'Точные значения' }));
  }

  const field = within(editor).getByRole('textbox', { name });

  await user.clear(field);
  await user.type(field, `${value}{Enter}`);
};

describe('инструмент «Поля»: изгиб, перспектива и контур', () => {
  it('правка полей ручками и числом сохраняет изгиб, перспективу и контур листа', async () => {
    const user = userEvent.setup();
    const ruling = buildCurvedRuling();
    const editor = await openMarginsTool(user, ruling);
    const { bend, perspective, outline } = readDraftRuling();

    expect(bend).not.toBeNull();
    expect(perspective).not.toBeNull();
    expect(outline).not.toBeNull();

    dragHandle(within(editor).getByRole('button', { name: 'Верхнее поле' }), {
      x: 300,
      y: PHOTO.phase + 3.4 * PHOTO.step,
    });
    dragMarginSide(editor, 'Левый', 140, dragHandle);
    await typeExactValue(user, editor, 'Правое поле сверху, px', '75');
    await typeExactValue(user, editor, 'Правое поле снизу, px', '75');

    const edited = readDraftRuling();

    /**
     * Лист наклонён, поэтому поле стоит там, где его ручки, — в столбце на
     * направляющих, — а не тем же числом у верха кадра. Ручка, отпущенная
     * мимо наклонной направляющей, съезжает по ней на сотые пикселя.
     *
     * @param name — имя ручки
     * @param x — ожидаемый столбец, px
     * @returns отход ручки от столбца, px
     */
    const measureHandleOffset = (name: string, x: number): number => {
      return Math.abs(
        readHandlePoint(within(editor).getByRole('button', { name })).x - x
      );
    };

    expect(edited.margins.top).not.toBe(ruling.margins.top);
    expect(measureHandleOffset('Левый верхний угол полей', 140)).toBeLessThan(0.1);
    expect(measureHandleOffset('Левый нижний угол полей', 140)).toBeLessThan(0.1);
    expect(
      measureHandleOffset('Правый верхний угол полей', PHOTO.width - 75)
    ).toBeLessThan(1e-6);
    expect(
      measureHandleOffset('Правый нижний угол полей', PHOTO.width - 75)
    ).toBeLessThan(1e-6);
    expect(edited.bend).toBe(bend);
    expect(edited.perspective).toBe(perspective);
    expect(edited.outline).toBe(outline);

    await save(user, editor);

    const saved = useGeneratorStore.getState().userSheets.find(({ sheet }) => {
      return sheet.id === SHEET.id;
    })?.sheet.ruling;

    expect(saved?.margins).toStrictEqual(edited.margins);
    expect(saved?.bend).toStrictEqual(bend);
    expect(saved?.perspective).toStrictEqual(perspective);
    expect(saved?.outline).toStrictEqual(outline);
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

/**
 * Роль видимой фигуры ручки с подписью `name`.
 *
 * @param editor — диалог редактора
 * @param name — подпись ручки
 * @returns тег фигуры и её роль
 */
const readHandleShape = (editor: HTMLElement, name: string): string => {
  const shape = within(editor)
    .getByRole('button', { name })
    .parentElement?.querySelector('[data-handle-kind]');

  return `${shape?.tagName}:${shape?.getAttribute('data-handle-kind')}`;
};

describe('инструмент «Поля»: роли на виду', () => {
  it('углы — квадраты, середины краёв — ромбы, концы линии поля — круги', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(120, 'left'));

    expect(readHandleShape(editor, 'Левый верхний угол полей')).toBe('rect:corner');
    expect(readHandleShape(editor, 'Правый нижний угол полей')).toBe('rect:corner');
    expect(readHandleShape(editor, 'Верхнее поле')).toBe('polygon:edgeMiddle');
    expect(readHandleShape(editor, 'Нижнее поле')).toBe('polygon:edgeMiddle');
    expect(readHandleShape(editor, 'Линия поля сверху')).toBe('circle:lineEnd');
    expect(readHandleShape(editor, 'Линия поля снизу')).toBe('circle:lineEnd');
  });

  it('линии и булавки тусклее полей, а на «Линиях» — наоборот', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(120, 'left'));

    /**
     * Помечен ли слой как чужой для выбранного инструмента.
     *
     * @param layer — слой
     * @returns помечен ли
     */
    const isForeign = (layer: string): boolean => {
      return Boolean(
        editor.querySelector(`[data-layer="${layer}"]`)?.closest('[data-foreign]')
      );
    };

    expect(isForeign('margins')).toBe(false);
    expect(isForeign('marginLine')).toBe(false);
    expect(isForeign('lines')).toBe(true);
    expect(isForeign('outline')).toBe(true);

    await user.click(within(editor).getByRole('radio', { name: 'Линии' }));

    expect(isForeign('lines')).toBe(false);
    expect(isForeign('pins')).toBe(false);
    expect(isForeign('margins')).toBe(true);
    expect(isForeign('marginLine')).toBe(true);
  });

  it('зона письма в «Полях» начинается от линии поля с зазором, а не от левого поля', async () => {
    const user = userEvent.setup();
    const editor = await openMarginsTool(user, buildRuling(120, 'left'));
    const [first] = readPoints(editor.querySelector('[data-writing-zone]'));

    expect(first?.x).toBeCloseTo(120 + MARGIN_LINE_GAP, 1);
    expect(
      readHandlePoint(
        within(editor).getByRole('button', { name: 'Левый верхний угол полей' })
      ).x
    ).toBeCloseTo(PHOTO.margins.left, 1);
  });
});
