/**
 * @vitest-environment jsdom
 */
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import {
  buildSheetRuling,
  lineHeightAt,
  type MarginLineSide,
  type PaperSheet,
  type RulingMirrorOverride,
  sampleRulingBend,
  type SheetImageData,
  type SheetPoint,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import {
  getPageRuling,
  selectBlockGeometry,
} from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { readUserSheets } from '@pages/Generator/model/userSheetsStorage';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import {
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

import { readHandlePoint, SIDE_HANDLE_ENDS } from './helpers/side-handles';
import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

type User = ReturnType<typeof userEvent.setup>;

/**
 * Подменяется только съём пикселей для перемера контура: канвы в jsdom нет.
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

const { width: WIDTH, height: HEIGHT } = FRAME;

const SHEET_LABEL = 'Тетрадь в линейку';

/**
 * Зазор блока от линии поля — пятая часть шага, как у найденной автоматом.
 */
const MARGIN_LINE_GAP = PHOTO.step / 5;

/**
 * Разлиновка листа с заданной линией поля.
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
  id: 'user-mirror',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: buildRuling(null, null),
  lighting: null,
  texture: null,
};

/**
 * Кладёт лист в стор, закрепляет его за всеми страницами, открывает редактор
 * на вкладке зеркальной страницы и выбирает инструмент.
 *
 * @param user — сессия `userEvent`
 * @param ruling — разлиновка листа
 * @param tool — подпись инструмента
 * @param image — каналы фотографии; `null` — ещё не сняты
 * @returns диалог редактора
 */
const openMirror = async (
  user: User,
  ruling: SheetRuling,
  tool: string,
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
  });
  useMarkupEditorStore.getState().open(record, image);
  render(<SheetMarkupEditor />);

  const editor = await screen.findByRole('dialog', {
    name: `Разметка листа «${SHEET_LABEL}»`,
  });

  await user.click(within(editor).getByRole('radio', { name: 'Зеркальная страница' }));
  await user.click(within(editor).getByRole('radio', { name: tool }));

  return editor;
};

/**
 * Разлиновка черновика.
 *
 * @returns разлиновка листа в редакторе
 */
const readDraftRuling = (): SheetRuling => {
  const ruling = useMarkupEditorStore.getState().draft?.ruling;

  if (!ruling) {
    throw new Error('Редактор закрыт');
  }

  return ruling;
};

/**
 * Даёт SVG оверлея единичную экранную матрицу: пиксели окна совпадают с
 * пикселями отражённого кадра, который видно на вкладке зеркала.
 *
 * @param editor — диалог редактора
 */
const mockScreenMatrix = (editor: HTMLElement) => {
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
};

/**
 * Перетаскивает ручку в точку экрана — в пиксели отражённого кадра.
 *
 * @param editor — диалог редактора
 * @param handle — ручка
 * @param point — куда отпустить, px отражённого кадра
 */
const dragHandle = (editor: HTMLElement, handle: HTMLElement, point: SheetPoint) => {
  mockScreenMatrix(editor);

  const pointer = { pointerId: 1, clientX: point.x, clientY: point.y };

  fireEvent.pointerDown(handle, { ...pointer, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(handle, pointer);
  fireEvent.pointerUp(handle, pointer);
};

/**
 * Края блока текста, px кадра страницы.
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
 * Края блока текста страницы по листу в сторе генератора.
 *
 * @param pageIndex — номер страницы: нечётная — зеркальная
 * @returns левый и правый края, px кадра страницы
 */
const readBlockEdges = (pageIndex: number): BlockEdges => {
  const geometry = selectBlockGeometry(
    useGeneratorStore.getState(),
    pageIndex,
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
 * Сохраняет разметку и сбрасывает кэш раскладки.
 *
 * @param user — сессия `userEvent`
 * @param editor — диалог редактора
 */
const save = async (user: User, editor: HTMLElement) => {
  await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));
  clearLayoutCache();
};

/**
 * Разлиновка зеркальной страницы сохранённого листа — тем же селектором, что
 * у раскладки и отрисовки.
 *
 * @returns разлиновка страницы 1
 */
const readSavedMirrorRuling = (): SheetRuling => {
  const saved = useGeneratorStore.getState().userSheets.find(({ sheet }) => {
    return sheet.id === SHEET.id;
  });

  if (!saved) {
    throw new Error('Листа нет');
  }

  return getPageRuling(saved.sheet, 1);
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

describe('вкладка зеркальной страницы: общая разметка', () => {
  it('фотография и слой ручек отражены, булавки — концами по порядку', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(user, buildRuling(null, null), 'Контур');
    const photo = within(editor).getByRole('img', { name: /отражённая$/ });
    const layer = editor.querySelector('[data-layer="handles"]');
    const [pin] = useMarkupEditorStore.getState().draft?.pins || [];
    const line = editor.querySelector('[data-layer="pins"] line');

    expect(photo.className).toMatch(/-scale-x-100/);
    expect(layer?.getAttribute('transform')).toBe(`matrix(-1 0 0 1 ${WIDTH} 0)`);

    /**
     * Левый конец булавки на зеркале — отражённый правый конец листа.
     */
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo(WIDTH - (pin?.right.x || 0), 9);
    expect(Number(line?.getAttribute('x2'))).toBeCloseTo(WIDTH - (pin?.left.x || 0), 9);
    expect(Number(line?.getAttribute('x1'))).toBeLessThan(
      Number(line?.getAttribute('x2'))
    );
  });

  it('угол на зеркале меняет оригинал', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(PHOTO));

    const editor = await openMirror(user, buildRuling(null, null), 'Контур');

    /**
     * Левый верхний угол листа на зеркале стоит справа: ручка названа тем
     * углом, который видно, и стоит в пикселях листа внутри отражённого слоя.
     */
    const corner = within(editor).getByRole('button', {
      name: 'Правый верхний угол листа',
    });

    expect(corner.getAttribute('cx')).toBe('0');

    dragHandle(editor, corner, { x: WIDTH - 20, y: 30 });

    await waitFor(() => {
      expect(readDraftRuling().outline).toStrictEqual({
        topLeft: { x: 20, y: 30 },
        topRight: { x: WIDTH, y: 0 },
        bottomRight: { x: WIDTH, y: HEIGHT },
        bottomLeft: { x: 0, y: HEIGHT },
      });
    });

    expect(
      getPageRuling({ ...SHEET, ruling: readDraftRuling() }, 1).outline?.topRight
    ).toStrictEqual({
      x: WIDTH - 20,
      y: 30,
    });
  });

  it('стрелка на зеркале двигает конец булавки туда, куда видно', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(user, buildRuling(null, null), 'Линии');
    const [pin] = useMarkupEditorStore.getState().draft?.pins || [];

    if (!pin) {
      throw new Error('Булавок нет');
    }

    /**
     * Левый конец булавки листа на зеркале стоит справа.
     */
    within(editor)
      .getByRole('button', { name: 'Закреплённая линия 1, правый конец' })
      .focus();
    await user.keyboard('{ArrowLeft}');

    expect(useMarkupEditorStore.getState().draft?.pins[0]?.left.x).toBeCloseTo(
      pin.left.x + 1,
      9
    );

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');

    expect(useMarkupEditorStore.getState().draft?.pins[0]?.left.x).toBeCloseTo(
      pin.left.x - 9,
      9
    );
  });

  it('изгиб на зеркале правит линию листа в отражённом столбце', async () => {
    const user = userEvent.setup();
    const ruling = buildRuling(null, null);
    const editor = await openMirror(user, ruling, 'Изгиб');
    const index = 8;
    const sheetX = 180;
    const grabbed = lineHeightAt(
      ruling,
      sheetX,
      ruling.firstLinePhase + index * ruling.step
    );
    const line = editor.querySelector(`[data-bend-line-index="${index}"]`);

    if (!line) {
      throw new Error('Линии нет');
    }

    mockScreenMatrix(editor);

    const pointer = { pointerId: 1, clientX: WIDTH - sheetX };

    fireEvent.pointerDown(line, { ...pointer, clientY: grabbed });
    fireEvent.pointerMove(line, { ...pointer, clientY: grabbed + 10 });
    fireEvent.pointerUp(line, { ...pointer, clientY: grabbed + 10 });

    const edited = readDraftRuling();

    /**
     * Сдвиг — в столбце листа 180, а не в столбце экрана 420.
     */
    expect(edited.bend).not.toBeNull();

    const pages = getPageRuling({ ...SHEET, ruling: edited }, 1);

    expect(pages.bend).not.toBeNull();

    const bend = edited.bend;

    if (!bend) {
      throw new Error('Изгиба нет');
    }

    expect(sampleRulingBend(bend, edited, sheetX, grabbed)).toBeCloseTo(10, 0);
    expect(
      Math.abs(sampleRulingBend(bend, edited, WIDTH - sheetX, grabbed))
    ).toBeLessThan(Math.abs(sampleRulingBend(bend, edited, sheetX, grabbed)));
  });

  it('на зеркале «Поля» правят общие верхнее и нижнее поля, боковых ручек нет', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(user, buildRuling(120, 'left'), 'Поля');

    expect(within(editor).queryByRole('button', { name: 'Левое поле' })).toBeNull();
    expect(within(editor).queryByRole('button', { name: 'Линия поля' })).toBeNull();

    dragHandle(editor, within(editor).getByRole('button', { name: 'Верхнее поле' }), {
      x: 300,
      y: 142,
    });

    /**
     * Верхнее поле встаёт на ближайшую линию — у листа и у зеркала оно одно.
     */
    expect(readDraftRuling().margins.top).toBeCloseTo(140, 6);
  });
});

describe('вкладка зеркальной страницы: линия поля и боковые поля', () => {
  it('линия поля справа на обеих страницах', async () => {
    const user = userEvent.setup();
    const lineX = WIDTH - 100;
    const editor = await openMirror(user, buildRuling(lineX, 'right'), 'Поля');

    /**
     * Без отдельной правки у зеркала линия поля отражена влево.
     */
    expect(readBlockEdges(1).left).toBeCloseTo(100 + MARGIN_LINE_GAP, 6);

    await user.click(within(editor).getByRole('radio', { name: 'Задать отдельно' }));
    await user.click(within(editor).getByRole('radio', { name: 'Справа' }));

    expect(readDraftRuling().mirrorOverride).toStrictEqual({
      marginLineX: lineX,
      marginLineSide: 'right',
      marginLeft: PHOTO.margins.right,
      marginRight: PHOTO.margins.left,
      sideSlant: null,
    });

    await save(user, editor);

    const page = readBlockEdges(0);
    const mirror = readBlockEdges(1);

    expect(page.left).toBeCloseTo(PHOTO.margins.left, 6);
    expect(page.right).toBeCloseTo(lineX - MARGIN_LINE_GAP, 6);
    expect(mirror.left).toBeCloseTo(PHOTO.margins.right, 6);
    expect(mirror.right).toBeCloseTo(lineX - MARGIN_LINE_GAP, 6);
    expect(readSavedMirrorRuling().marginLineSide).toBe('right');

    const [stored] = await readUserSheets();

    expect(stored?.sheet.ruling.mirrorOverride).toStrictEqual({
      marginLineX: lineX,
      marginLineSide: 'right',
      marginLeft: PHOTO.margins.right,
      marginRight: PHOTO.margins.left,
      sideSlant: null,
    });
  });

  it('линию поля можно убрать только на зеркале', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(user, buildRuling(120, 'left'), 'Поля');

    await user.click(within(editor).getByRole('radio', { name: 'Задать отдельно' }));
    await user.click(within(editor).getByRole('radio', { name: 'Нет' }));
    await save(user, editor);

    expect(readBlockEdges(0).left).toBeCloseTo(120 + MARGIN_LINE_GAP, 6);
    expect(readBlockEdges(1).right).toBeCloseTo(WIDTH - PHOTO.margins.left, 6);
  });

  it('возврат к отражению', async () => {
    const user = userEvent.setup();
    const override: RulingMirrorOverride = {
      marginLineX: WIDTH - 120,
      marginLineSide: 'right',
      marginLeft: 70,
      marginRight: 80,
      sideSlant: null,
    };
    const editor = await openMirror(
      user,
      { ...buildRuling(120, 'left'), mirrorOverride: override },
      'Поля'
    );

    expect(
      within(editor)
        .getByRole('radio', { name: 'Задать отдельно' })
        .getAttribute('aria-checked')
    ).toBe('true');

    await user.click(
      within(editor).getByRole('radio', { name: 'Как у оригинала, отражённо' })
    );

    expect(readDraftRuling().mirrorOverride).toBeNull();

    await save(user, editor);

    const mirror = readSavedMirrorRuling();

    expect(mirror.marginLineX).toBe(WIDTH - 120);
    expect(mirror.marginLineSide).toBe('right');
    expect(mirror.margins.left).toBe(PHOTO.margins.right);
    expect(mirror.margins.right).toBe(PHOTO.margins.left);

    const [stored] = await readUserSheets();

    expect(stored?.sheet.ruling.mirrorOverride).toBeNull();
  });

  it('боковое поле зеркала ставится двумя ручками вдоль наклонной стороны', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(user, buildRuling(null, null), 'Поля');

    await user.click(within(editor).getByRole('radio', { name: 'Задать отдельно' }));

    const bottom = within(editor).getByRole('button', {
      name: 'Левое поле зеркала снизу',
    });
    const mirroredX = WIDTH - readHandlePoint(bottom).x;

    dragHandle(editor, bottom, { x: mirroredX - 40, y: readHandlePoint(bottom).y });

    expect(readDraftRuling().mirrorOverride?.sideSlant).not.toBeNull();
    expect(readDraftRuling().sideSlant).toBeNull();
    expect(
      (
        within(editor).getByRole('textbox', {
          name: 'Левое поле зеркала снизу, px',
        }) as HTMLInputElement
      ).value
    ).toBe(String(mirroredX - 40));

    await save(user, editor);

    const [page, mirror] = [0, 1].map((pageIndex) => {
      return selectBlockGeometry(
        useGeneratorStore.getState(),
        pageIndex,
        FALLBACK_FONT_METRICS
      );
    });

    expect(page?.lineBounds).toBeUndefined();
    expect(mirror?.lineBounds?.offsets.at(-1)).toBeLessThan(-30);
  });

  it('боковое поле зеркала не опускается до нуля ни числом, ни ручкой', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(user, buildRuling(null, null), 'Поля');

    await user.click(within(editor).getByRole('radio', { name: 'Задать отдельно' }));

    const field = within(editor).getByRole('textbox', {
      name: 'Левое поле зеркала сверху, px',
    });

    await user.clear(field);
    await user.type(field, '-5{Enter}');

    expect(readDraftRuling().mirrorOverride?.marginLeft).toBe(1);

    dragHandle(
      editor,
      within(editor).getByRole('button', { name: 'Правое поле зеркала сверху' }),
      { x: WIDTH + 50, y: 300 }
    );

    expect(readDraftRuling().mirrorOverride?.marginRight).toBe(1);
  });

  it('линия поля зеркала притягивается к отражённой черте, стрелкой — нет', async () => {
    const user = userEvent.setup();
    const editor = await openMirror(
      user,
      buildRuling(PHOTO.marginLineX, 'left'),
      'Поля',
      createSyntheticSheet(PHOTO)
    );

    await user.click(within(editor).getByRole('radio', { name: 'Задать отдельно' }));

    const mirroredLine = WIDTH - PHOTO.marginLineX;

    for (const end of SIDE_HANDLE_ENDS) {
      const handle = within(editor).getByRole('button', {
        name: `Линия поля зеркала ${end}`,
      });

      dragHandle(editor, handle, {
        x: mirroredLine + 9,
        y: readHandlePoint(handle).y,
      });
    }

    const { mirrorOverride } = readDraftRuling();

    expect(Math.abs((mirrorOverride?.marginLineX || 0) - mirroredLine)).toBeLessThan(1);
    expect(
      Math.abs((mirrorOverride?.sideSlant?.marginLineX || mirroredLine) - mirroredLine)
    ).toBeLessThan(1);

    const snapped = mirrorOverride?.marginLineX || 0;

    for (const end of SIDE_HANDLE_ENDS) {
      within(editor)
        .getByRole('button', { name: `Линия поля зеркала ${end}` })
        .focus();
      await user.keyboard('{ArrowRight}');
    }

    expect(readDraftRuling().mirrorOverride?.marginLineX).toBeCloseTo(snapped + 1, 6);
  });
});
