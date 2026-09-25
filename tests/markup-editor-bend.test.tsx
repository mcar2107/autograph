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
import { selectCalibrationRuling } from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { BendTool } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/BendTool';
import { MarkupScaleContext } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { BENT_PHOTO, RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Лист в линейку: шаг 40 px, область с линиями между линией поля (120) и
 * правым полем (540).
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
 * Допуск попадания линии через отпущенную точку из требования «Изгиб
 * правится перетаскиванием», px.
 */
const POINT_TOLERANCE_PX = 1;

/**
 * Допуск неподвижности линий за радиусом, px: узлы хранятся с точностью до
 * сотой, и сумма округлений у Катмулла — Рома остаётся в сотых.
 */
const STILL_TOLERANCE_PX = 0.05;

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

const RULING = buildPhotoRuling(PHOTO);

/**
 * Булавки на линиях 3 и 13 снимка.
 *
 * @param photo — снимок
 * @returns булавки
 */
const buildPins = (photo: typeof RULED_PHOTO): RulingPin[] => {
  return [3, 13].map((index) => {
    const y = photo.phase + index * photo.step;

    return { index, left: { x: 150, y }, right: { x: photo.width - 100, y } };
  });
};

/**
 * Булавки на линиях снимка с волной: концы — на самой волне, с отходом от неё.
 *
 * @param lines — номера линий
 * @param misses — отход левого и правого концов от линии снимка, px
 * @returns булавки
 */
const buildBentPins = (lines: number[], misses: number[][] = []): RulingPin[] => {
  return lines.map((index, order) => {
    const [leftMiss = 0, rightMiss = 0] = misses[order] || [];

    /**
     * Конец булавки у линии снимка.
     *
     * @param x — столбец, px
     * @param miss — отход от линии снимка, px
     * @returns конец
     */
    const toEnd = (x: number, miss: number): SheetPoint => {
      const y = BENT_PHOTO.phase + index * BENT_PHOTO.step + BENT_PHOTO.bend(x, 0);

      return { x, y: y + miss };
    };

    return { index, left: toEnd(110, leftMiss), right: toEnd(370, rightMiss) };
  });
};

const SHEET: PaperSheet = {
  id: 'user-bend',
  label: SHEET_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: RULING,
  lighting: null,
  texture: null,
};

/**
 * Кладёт лист в стор, ставит его на страницу, открывает редактор и
 * выбирает инструмент «Изгиб».
 *
 * @param user — сессия `userEvent`
 * @param ruling — разлиновка листа
 * @param image — каналы фотографии; `null` — ещё не сняты
 * @param frame — кадр фотографии
 * @param pins — булавки листа
 * @returns диалог редактора
 */
const openBendTool = async (
  user: ReturnType<typeof userEvent.setup>,
  ruling: SheetRuling,
  image: SheetImageData | null,
  frame = FRAME,
  pins = buildPins({ ...PHOTO, ...frame })
): Promise<HTMLElement> => {
  const record = {
    ...buildUserSheetRecord({
      familyId: 'lined',
      sheet: { ...SHEET, ...frame, ruling },
    }),
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

  const editor = await screen.findByRole('dialog', {
    name: `Разметка листа «${SHEET_LABEL}»`,
  });

  await user.click(within(editor).getByRole('radio', { name: 'Изгиб' }));

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
 * Высота линии в столбце такой, какой её рисуют оверлей и страница.
 *
 * @param ruling — разлиновка
 * @param index — номер линии
 * @param x — столбец, px
 * @returns высота, px
 */
const toLineY = (ruling: SheetRuling, index: number, x: number): number => {
  const straight = lineHeightAt(ruling, x, ruling.firstLinePhase + index * ruling.step);

  return ruling.bend
    ? straight + sampleRulingBend(ruling.bend, ruling, x, straight)
    : straight;
};

/**
 * Наибольший сдвиг линий между двумя разлиновками.
 *
 * @param before — до правки
 * @param after — после правки
 * @param lines — номера линий
 * @param columns — столбцы, px
 * @returns сдвиг, px
 */
const measureShift = (
  before: SheetRuling,
  after: SheetRuling,
  lines: number[],
  columns: number[]
): number => {
  return lines.reduce((limit, line) => {
    return columns.reduce((columnLimit, x) => {
      return Math.max(
        columnLimit,
        Math.abs(toLineY(after, line, x) - toLineY(before, line, x))
      );
    }, limit);
  }, 0);
};

/**
 * Номера всех линий кадра: и в полях, чтобы линии за радиусом проверялись и
 * за областью с линиями.
 */
const ALL_LINES = Array.from({ length: 20 }, (_item, index) => {
  return index;
});

/**
 * Столбцы через каждые пять пикселей по всему кадру.
 */
const ALL_COLUMNS = Array.from({ length: 121 }, (_item, index) => {
  return index * 5;
});

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
 * Тянет линию: нажатие в точке, движение и отпускание в той же колонке.
 *
 * @param editor — диалог редактора
 * @param index — номер линии, за которую берут
 * @param from — точка нажатия, px фотографии
 * @param toY — высота отпускания, px фотографии
 * @param isShiftDown — зажат ли Shift
 */
const dragLine = (
  editor: HTMLElement,
  index: number,
  from: SheetPoint,
  toY: number,
  isShiftDown = false
) => {
  mockScreenMatrix(editor);

  const line = editor.querySelector(`[data-bend-line-index="${index}"]`);

  if (!line) {
    throw new Error(`Линия ${index} не взять`);
  }

  const pointer = { pointerId: 1, shiftKey: isShiftDown };

  fireEvent.pointerDown(line, { ...pointer, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(line, { ...pointer, clientX: from.x, clientY: toY });
  fireEvent.pointerUp(line, { ...pointer, clientX: from.x, clientY: toY });
};

/**
 * Углы рамки у курсора.
 *
 * @param editor — диалог редактора
 * @returns углы по обходу, px фотографии
 */
const readRingCorners = (editor: HTMLElement): SheetPoint[] => {
  const points = editor.querySelector('[data-bend-ring]')?.getAttribute('points');

  if (!points) {
    throw new Error('Рамки нет');
  }

  return points.split(' ').map((pair) => {
    const [x = '', y = ''] = pair.split(',');

    return { x: Number(x), y: Number(y) };
  });
};

/**
 * Лежит ли точка внутри выпуклого многоугольника или на его границе.
 *
 * @param polygon — углы по обходу
 * @param point — точка
 * @returns внутри ли
 */
const isInsidePolygon = (polygon: SheetPoint[], point: SheetPoint): boolean => {
  const signs = polygon.map((corner, index) => {
    const next = polygon[(index + 1) % polygon.length] || corner;

    return Math.sign(
      (next.x - corner.x) * (point.y - corner.y) -
        (next.y - corner.y) * (point.x - corner.x)
    );
  });

  return (
    signs.every((sign) => {
      return sign >= 0;
    }) ||
    signs.every((sign) => {
      return sign <= 0;
    })
  );
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

describe('инструмент «Изгиб»: перетаскивание линии', () => {
  it('прогиб у пружины: линия проходит через точку, соседи сдвигаются меньше, за радиусом и справа — на месте', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const slider = within(editor).getByRole('slider', { name: 'Радиус изгиба' });

    expect(slider.getAttribute('aria-valuetext')).toBe('3 шага');

    /**
     * Радиус в полтора шага: рамка уже области с линиями, и у правого края
     * листа остаются столбцы вне её.
     */
    slider.focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');

    expect(slider.getAttribute('aria-valuetext')).toBe('1,5 шага');

    const line = 10;
    const x = 150;
    const grabbed = toLineY(RULING, line, x);
    const released = grabbed + 12;

    /**
     * Нажатие в двух пикселях под линией: линия уходит на сдвиг указателя, и
     * точка, которую взяли, встаёт в точку отпускания.
     */
    dragLine(editor, line, { x, y: grabbed + 2 }, released + 2);

    const edited = readDraftRuling();

    expect(Math.abs(toLineY(edited, line, x) - released)).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );

    [line - 1, line + 1].forEach((neighbour) => {
      const shift = toLineY(edited, neighbour, x) - toLineY(RULING, neighbour, x);

      expect(shift).toBeGreaterThan(0);
      expect(shift).toBeLessThan(released - grabbed);
    });

    /**
     * Дальше двух радиусов — трёх шагов — линии стоят, в том числе в полях
     * за крайними строками сетки.
     */
    const farLines = ALL_LINES.filter((other) => {
      return Math.abs(other - line) >= 3;
    });

    expect(measureShift(RULING, edited, farLines, ALL_COLUMNS)).toBeLessThanOrEqual(
      STILL_TOLERANCE_PX
    );

    /**
     * Правая часть листа — дальше двух радиусов вдоль линии и двух
     * промежутков узлов: Катмулл — Ром берёт по два узла с каждой стороны.
     */
    const bend = edited.bend;

    expect(bend).not.toBeNull();

    const reachX = (2 * (540 - 120)) / 3 / 2;
    const rightColumns = ALL_COLUMNS.filter((column) => {
      return column >= x + reachX + 2 * (bend?.columnSpacing || 0);
    });

    expect(rightColumns.length).toBeGreaterThan(10);
    expect(measureShift(RULING, edited, ALL_LINES, rightColumns)).toBeLessThanOrEqual(
      STILL_TOLERANCE_PX
    );
  });

  it('рамка у курсора — по охвату правки, и слайдер её меняет', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const svg = mockScreenMatrix(editor);

    fireEvent.pointerMove(svg, { clientX: 300, clientY: 400 });

    /**
     * Полуширина и полувысота рамки: у ровного листа без наклона она
     * прямоугольник.
     *
     * @returns полуоси рамки, px
     */
    const readRing = () => {
      const corners = readRingCorners(editor);
      const xs = corners.map(({ x }) => {
        return x;
      });
      const ys = corners.map(({ y }) => {
        return y;
      });

      return {
        rx: (Math.max(...xs) - Math.min(...xs)) / 2,
        ry: (Math.max(...ys) - Math.min(...ys)) / 2,
      };
    };

    /**
     * Сетка по области 120…540 — восемь полос по 52,5 px. Вдоль линий к двум
     * радиусам прибавлены два промежутка узлов: хвост Катмулла — Рома.
     */
    const columnSpacing = (540 - 120) / 8;

    expect(readRing().ry).toBeCloseTo(2 * 3 * PHOTO.step, 2);
    expect(readRing().rx).toBeCloseTo((2 * (540 - 120)) / 3 + 2 * columnSpacing, 2);

    const slider = within(editor).getByRole('slider', { name: 'Радиус изгиба' });

    slider.focus();
    await user.keyboard('{Home}');

    expect(readRing().ry).toBeCloseTo(2 * PHOTO.step, 2);

    /**
     * Радиус вдоль линий на одном шаге — треть от трёх шагов по умолчанию,
     * 46,7 px — уже промежутка узлов: правка берёт промежуток, и рамка
     * показывает его же.
     */
    expect(readRing().rx).toBeCloseTo(2 * columnSpacing + 2 * columnSpacing, 2);

    fireEvent.pointerLeave(svg);

    expect(editor.querySelector('[data-bend-ring]')).toBeNull();
  });

  it.each([
    ['один шаг', '{Home}', 230],
    ['три шага', '', 400],
  ])('радиус %s: линии за нарисованной рамкой не сдвигаются', async (_label, keys, x) => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const svg = mockScreenMatrix(editor);
    const slider = within(editor).getByRole('slider', { name: 'Радиус изгиба' });

    if (keys) {
      slider.focus();
      await user.keyboard(keys);
    }

    /**
     * Точка такая, что левый край рамки лежит в боковом поле, левее первого
     * узла сетки у 146 px, а сам этот узел попадает в охват правки: левее
     * него сетка узлов не имела и держала его значение до края листа.
     */
    const line = 9;
    const grabbed = toLineY(RULING, line, x);

    fireEvent.pointerMove(svg, { clientX: x, clientY: grabbed });

    const ring = readRingCorners(editor);

    dragLine(editor, line, { x, y: grabbed }, grabbed + 20);

    const edited = readDraftRuling();
    const outside = ALL_LINES.reduce((limit, index) => {
      return ALL_COLUMNS.reduce((columnLimit, column) => {
        const y = toLineY(RULING, index, column);

        return isInsidePolygon(ring, { x: column, y })
          ? columnLimit
          : Math.max(columnLimit, Math.abs(toLineY(edited, index, column) - y));
      }, limit);
    }, 0);

    expect(Math.abs(toLineY(edited, line, x) - (grabbed + 20))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
    expect(outside).toBe(0);
  });

  it('Shift: весь столбец сдвигается на тот же сдвиг', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 330;
    const grabbed = toLineY(RULING, 8, x);

    dragLine(editor, 8, { x, y: grabbed }, grabbed - 6, true);

    const edited = readDraftRuling();

    ALL_LINES.forEach((line) => {
      expect(
        Math.abs(toLineY(edited, line, x) - toLineY(RULING, line, x) + 6)
      ).toBeLessThanOrEqual(POINT_TOLERANCE_PX);
    });
  });

  it('перетаскивание — один шаг истории, нажатие без сдвига — ни одного', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 300;
    const grabbed = toLineY(RULING, 9, x);

    dragLine(editor, 9, { x, y: grabbed + 3 }, grabbed + 3);

    expect(useMarkupEditorStore.getState().history.past).toHaveLength(0);
    expect(readDraftRuling()).toBe(RULING);

    dragLine(editor, 9, { x, y: grabbed }, grabbed + 8);

    expect(useMarkupEditorStore.getState().history.past).toHaveLength(1);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraftRuling()).toBe(RULING);
  });

  it('сохранённый изгиб доезжает до страницы', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 300;
    const grabbed = toLineY(RULING, 9, x);

    dragLine(editor, 9, { x, y: grabbed }, grabbed + 8);
    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    const saved = selectCalibrationRuling(useGeneratorStore.getState(), 0)?.ruling;

    expect(saved).toBeDefined();
    expect(
      Math.abs(toLineY(saved as SheetRuling, 9, x) - (grabbed + 8))
    ).toBeLessThanOrEqual(POINT_TOLERANCE_PX);
  });
});

/**
 * Номер линии под подсветкой инструмента.
 *
 * @param editor — диалог редактора
 * @returns номер линии; `null` — подсветки нет
 */
const readHoveredLine = (editor: HTMLElement): number | null => {
  const hovered = editor.querySelector('[data-bend-hover]');

  return hovered ? Number(hovered.getAttribute('data-bend-hover')) : null;
};

/**
 * Полоса захвата линии.
 *
 * @param editor — диалог редактора
 * @param index — номер линии
 * @returns ломаная захвата
 */
const getHitLine = (editor: HTMLElement, index: number): Element => {
  const line = editor.querySelector(`[data-bend-line-index="${index}"]`);

  if (!line) {
    throw new Error(`Нет полосы линии ${index}`);
  }

  return line;
};

describe('инструмент «Изгиб»: подсветка линии под курсором', () => {
  it('подсвечена та линия, которую возьмёт нажатие, — ближайшая в столбце, а не верхняя полоса', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 200;

    mockScreenMatrix(editor);

    expect(readHoveredLine(editor)).toBeNull();

    fireEvent.pointerMove(getHitLine(editor, 10), {
      clientX: x,
      clientY: toLineY(RULING, 10, x) + 3,
    });

    expect(readHoveredLine(editor)).toBe(10);
    expect(editor.querySelector('[data-bend-hover]')?.getAttribute('points')).toBe(
      getHitLine(editor, 10).getAttribute('points')
    );

    /**
     * На мелком масштабе полосы соседних линий перекрываются: указатель над
     * полосой десятой линии, но ближе к одиннадцатой — нажатие возьмёт её, и
     * подсвечена она.
     */
    fireEvent.pointerMove(getHitLine(editor, 10), {
      clientX: x,
      clientY: toLineY(RULING, 11, x) - 4,
    });

    expect(readHoveredLine(editor)).toBe(11);

    fireEvent.pointerLeave(getHitLine(editor, 10));

    expect(readHoveredLine(editor)).toBeNull();
  });

  it('во время перетаскивания подсвечена взятая линия', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 200;
    const grabbed = toLineY(RULING, 10, x);
    const line = getHitLine(editor, 10);
    const pointer = { pointerId: 1 };

    mockScreenMatrix(editor);
    fireEvent.pointerMove(line, { clientX: x, clientY: grabbed });
    fireEvent.pointerDown(line, { ...pointer, clientX: x, clientY: grabbed });
    fireEvent.pointerMove(line, { ...pointer, clientX: x, clientY: grabbed + 30 });
    fireEvent.pointerLeave(line);

    expect(readHoveredLine(editor)).toBe(10);

    fireEvent.pointerUp(line, { ...pointer, clientX: x, clientY: grabbed + 30 });
  });
});

describe('инструмент «Изгиб»: сдвиг не дальше шага', () => {
  it.each([
    ['вниз', 1],
    ['вверх', -1],
  ])(
    'рывок %s на два с половиной шага останавливает линию на шаге',
    async (_direction, sign) => {
      const user = userEvent.setup();
      const editor = await openBendTool(user, RULING, null);
      const line = 10;
      const x = 150;
      const grabbed = toLineY(RULING, line, x);

      dragLine(editor, line, { x, y: grabbed }, grabbed + sign * 2.5 * PHOTO.step);

      const edited = readDraftRuling();

      expect(
        Math.abs(toLineY(edited, line, x) - (grabbed + sign * PHOTO.step))
      ).toBeLessThanOrEqual(POINT_TOLERANCE_PX);
      expect(readRingCorners(editor).length).toBe(4);
    }
  );

  it('сдвиг в пределах шага не ограничен: линия проходит через точку отпускания', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const line = 10;
    const x = 150;
    const grabbed = toLineY(RULING, line, x);
    const released = grabbed + 0.9 * PHOTO.step;

    dragLine(editor, line, { x, y: grabbed }, released);

    expect(Math.abs(toLineY(readDraftRuling(), line, x) - released)).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
  });

  it('Shift: весь столбец тоже не дальше шага', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 330;
    const grabbed = toLineY(RULING, 8, x);

    dragLine(editor, 8, { x, y: grabbed }, grabbed - 3 * PHOTO.step, true);

    const edited = readDraftRuling();

    expect(Math.abs(toLineY(edited, 8, x) - (grabbed - PHOTO.step))).toBeLessThanOrEqual(
      POINT_TOLERANCE_PX
    );
  });
});

describe('инструмент «Изгиб»: действия', () => {
  it('«Выпрямить» снимает изгиб: линии прямые и проходят через закреплённые', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const x = 300;
    const grabbed = toLineY(RULING, 9, x);

    dragLine(editor, 9, { x, y: grabbed }, grabbed + 8);

    expect(readDraftRuling().bend).not.toBeNull();

    await user.click(within(editor).getByRole('button', { name: 'Выпрямить' }));

    const straight = readDraftRuling();

    expect(straight.bend).toBeNull();

    useMarkupEditorStore.getState().draft?.pins.forEach(({ index, left, right }) => {
      [left, right].forEach(({ x: endX, y }) => {
        expect(Math.abs(toLineY(straight, index, endX) - y)).toBeLessThanOrEqual(
          POINT_TOLERANCE_PX
        );
      });
    });
    expect(within(editor).getByRole('button', { name: 'Выпрямить' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('«Подогнать изгиб по фото»: линии следуют волне бумаги', async () => {
    const user = userEvent.setup();
    const ruling = buildPhotoRuling(BENT_PHOTO);
    const editor = await openBendTool(
      user,
      ruling,
      createSyntheticSheet(BENT_PHOTO),
      { width: BENT_PHOTO.width, height: BENT_PHOTO.height },
      buildBentPins([3, 20])
    );

    expect(ruling.bend).toBeNull();

    await user.click(
      within(editor).getByRole('button', { name: 'Подогнать изгиб по фото' })
    );

    const fitted = readDraftRuling();
    const columns = [140, 200, 258, 320, 370];
    const lines = [6, 10, 14, 18];

    expect(fitted.bend).not.toBeNull();

    lines.forEach((line) => {
      columns.forEach((x) => {
        const truth = BENT_PHOTO.phase + line * BENT_PHOTO.step + BENT_PHOTO.bend(x, 0);

        expect(Math.abs(toLineY(fitted, line, x) - truth)).toBeLessThanOrEqual(
          POINT_TOLERANCE_PX
        );
      });
    });

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraftRuling().bend).toBeNull();
  });

  it('«Подогнать изгиб по фото» при трёх закреплённых линиях: линии проходят через их концы', async () => {
    const user = userEvent.setup();
    const frame = { width: BENT_PHOTO.width, height: BENT_PHOTO.height };

    /**
     * Концы стоят в паре пикселей от линий снимка — так гребёнка через три
     * булавки, подогнанная по наименьшим квадратам, расходится с волной на
     * живых листах. Прослеженный изгиб ведёт линию по снимку и уводит её с
     * булавки на эти пиксели.
     */
    const pins = buildBentPins(
      [4, 12, 19],
      [
        [2, -1.5],
        [-2, 2.5],
        [1.5, -2],
      ]
    );
    const editor = await openBendTool(
      user,
      buildPhotoRuling(BENT_PHOTO),
      createSyntheticSheet(BENT_PHOTO),
      frame,
      pins
    );

    await user.click(
      within(editor).getByRole('button', { name: 'Подогнать изгиб по фото' })
    );

    const fitted = readDraftRuling();

    expect(fitted.bend).not.toBeNull();

    pins.forEach(({ index, left, right }) => {
      [left, right].forEach(({ x, y }) => {
        expect(Math.abs(toLineY(fitted, index, x) - y)).toBeLessThanOrEqual(
          POINT_TOLERANCE_PX
        );
      });
    });
  });

  it('«Выпрямить» при трёх закреплённых линиях: линии строго прямые, у каждой булавки — её невязка', async () => {
    const user = userEvent.setup();
    const frame = { width: BENT_PHOTO.width, height: BENT_PHOTO.height };
    const pins = buildBentPins(
      [4, 12, 19],
      [
        [2, -1.5],
        [-2, 2.5],
        [1.5, -2],
      ]
    );
    const editor = await openBendTool(
      user,
      buildPhotoRuling(BENT_PHOTO),
      createSyntheticSheet(BENT_PHOTO),
      frame,
      pins
    );

    await user.click(
      within(editor).getByRole('button', { name: 'Подогнать изгиб по фото' })
    );

    expect(readDraftRuling().bend).not.toBeNull();

    await user.click(within(editor).getByRole('button', { name: 'Выпрямить' }));

    const straight = readDraftRuling();

    expect(straight.bend).toBeNull();

    /**
     * Прямая: середина отрезка лежит на линии между его концами.
     */
    ALL_LINES.forEach((line) => {
      const left = toLineY(straight, line, 110);
      const middle = toLineY(straight, line, 240);
      const right = toLineY(straight, line, 370);

      expect(Math.abs(middle - (left + right) / 2)).toBeLessThanOrEqual(
        STILL_TOLERANCE_PX
      );
    });

    const expected = pins.map(({ index, left, right }) => {
      return Math.max(
        ...[left, right].map(({ x, y }) => {
          return Math.abs(toLineY(straight, index, x) - y);
        })
      );
    });

    /**
     * Волна уводит прямую гребёнку от концов на пиксели: невязка видна, а не
     * нулевая.
     */
    expect(Math.max(...expected)).toBeGreaterThan(POINT_TOLERANCE_PX);

    await user.click(within(editor).getByRole('radio', { name: 'Линии' }));

    expected.forEach((residual, order) => {
      const row = within(editor).getByRole('listitem', {
        name: `Закреплённая линия ${order + 1}`,
      });
      const [, shown = ''] = /невязка\s+([\d,]+)/.exec(row.textContent || '') || [];

      expect(Number(shown.replace(',', '.'))).toBeCloseTo(residual, 1);
    });
  });

  it('без каналов фотографии подгонять изгиб не по чему', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, null);
    const refit = within(editor).getByRole('button', {
      name: 'Подогнать изгиб по фото',
    });

    expect(refit).toHaveProperty('disabled', true);

    act(() => {
      useMarkupEditorStore.getState().setImage(SHEET.id, createSyntheticSheet(PHOTO));
    });

    expect(refit).toHaveProperty('disabled', false);
  });

  it('ровный снимок: изгиб не прослежен — сообщение, ручной изгиб прежний', async () => {
    const user = userEvent.setup();
    const editor = await openBendTool(user, RULING, createSyntheticSheet(PHOTO));
    const x = 300;
    const grabbed = toLineY(RULING, 9, x);

    dragLine(editor, 9, { x, y: grabbed }, grabbed + 8);

    const bent = readDraftRuling();

    expect(bent.bend).not.toBeNull();

    await user.click(
      within(editor).getByRole('button', { name: 'Подогнать изгиб по фото' })
    );

    expect(within(editor).getByRole('status').textContent).toMatch(
      /проследить не удалось/
    );
    expect(readDraftRuling()).toBe(bent);
  });
});

describe('инструмент «Изгиб»: полоса попадания', () => {
  /**
   * Ширина полосы, за которую линия берётся указателем, в экранных пикселях.
   */
  const HIT_SCREEN_WIDTH = 14;

  it.each([0.36, 4])('на масштабе %s полоса линии — 14 экранных пикселей', (scale) => {
    const record = buildUserSheetRecord({ familyId: 'lined', sheet: SHEET });
    const handleLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    useMarkupEditorStore.getState().open(record, null);
    render(
      <MarkupScaleContext value={scale}>
        <BendTool handleLayer={handleLayer} pageIndex={0} />
      </MarkupScaleContext>
    );

    const lines = handleLayer.querySelectorAll('[data-bend-line-index]');

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(Number(line.getAttribute('stroke-width')) * scale).toBeCloseTo(
        HIT_SCREEN_WIDTH,
        6
      );
      expect(line.hasAttribute('vector-effect')).toBe(false);
    }
  });
});
