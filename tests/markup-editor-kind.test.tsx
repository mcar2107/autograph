/**
 * @vitest-environment jsdom
 */
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import {
  buildSheetRuling,
  deriveRulingPins,
  mirrorSheetRuling,
  type PaperSheet,
  readSideEdge,
  type RulingKind,
  type RulingPin,
  type SheetImageData,
  type SheetPoint,
  type SheetRuling,
  sideEdgePointAtHeight,
} from '@pages/Generator/lib/paper';
import { selectBlockGeometry } from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
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

import { getLineStep } from './helpers/baseline-model';
import { createSyntheticSheet } from './helpers/synthetic-sheet';
import { RULED_PHOTO } from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Подменяется только съём пикселей: канвы в jsdom нет. Поиск линий идёт
 * настоящим детектором.
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

type User = ReturnType<typeof userEvent.setup>;

/**
 * Лист в линейку 600×800: шаг 40 px, первая линия на 20 px.
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

const SHEET_LABEL = 'Свой лист';

/**
 * Разлиновка листа по снимку.
 *
 * @param photo — снимок
 * @param step — шаг разлиновки, px
 * @returns разлиновка
 */
const buildRuling = (photo: typeof RULED_PHOTO, step = photo.step): SheetRuling => {
  return buildSheetRuling(
    {
      step,
      firstLinePhase: photo.phase,
      skewAngle: 0,
      margins: photo.margins,
      marginLineX: null,
      marginLineSide: null,
    },
    { width: photo.width, height: photo.height }
  );
};

/**
 * Высота линии `index` на снимке без наклона.
 *
 * @param index — номер линии
 * @returns высота, px
 */
const lineY = (index: number): number => {
  return PHOTO.phase + index * PHOTO.step;
};

const PINS: RulingPin[] = [3, 13].map((index) => {
  const y = lineY(index);

  return { index, left: { x: 150, y }, right: { x: 500, y } };
});

/**
 * Лист, открытый в редакторе.
 */
type OpenParams = {
  /**
   * Вид листа, предложенный автоматом.
   */
  kind: RulingKind;

  /**
   * Семья, в которой лист лежит.
   */
  familyId: string;

  /**
   * Снимок: его размер и разлиновка.
   */
  photo?: typeof RULED_PHOTO;

  /**
   * Разлиновка листа; не задана — по снимку.
   */
  ruling?: SheetRuling;

  /**
   * Каналы фотографии; `null` — ещё не сняты.
   */
  image?: SheetImageData | null;
};

/**
 * Кладёт лист в стор, ставит его на страницу и открывает на нём редактор.
 *
 * @param params — вид, семья, снимок и разлиновка листа
 * @returns диалог редактора
 */
const openEditor = async (params: OpenParams): Promise<HTMLElement> => {
  const { kind, familyId, photo = PHOTO, image = null } = params;
  const frame = { width: photo.width, height: photo.height };
  const ruling = params.ruling || buildRuling(photo);
  const sheet: PaperSheet = {
    id: 'user-kind',
    label: SHEET_LABEL,
    src: 'data:image/jpeg;base64,0123456789',
    ...frame,
    ruling,
    lighting: null,
    texture: null,
  };
  const record = {
    ...buildUserSheetRecord({ familyId, sheet, kind }),
    pins: photo === PHOTO ? PINS : deriveRulingPins(ruling, frame),
  };

  useGeneratorStore.getState().addUserSheet(record);
  useGeneratorStore.setState({ familyId, sheetId: sheet.id, isSheetPinned: true });
  useMarkupEditorStore.getState().open(record, image);
  render(<SheetMarkupEditor />);

  return await screen.findByRole('dialog', { name: `Разметка листа «${SHEET_LABEL}»` });
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
 * Отложенный декодер: поиск линий ждёт, пока тест не отпустит снимок.
 *
 * @returns разрешение промиса снимка
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
 * Шаг строк на первой странице по сохранённому листу, px.
 *
 * @returns расстояние между базовыми линиями соседних строк
 */
const readRowStep = (): number => {
  const geometry = selectBlockGeometry(
    useGeneratorStore.getState(),
    0,
    FALLBACK_FONT_METRICS
  );

  if (!geometry) {
    throw new Error('Геометрии страницы нет');
  }

  return getLineStep(geometry, FALLBACK_FONT_METRICS);
};

/**
 * Черновик открытого редактора.
 *
 * @returns черновик
 */
const readDraft = () => {
  const { draft } = useMarkupEditorStore.getState();

  if (!draft) {
    throw new Error('Редактор закрыт');
  }

  return draft;
};

/**
 * Выбирает вид разлиновки.
 *
 * @param user — сессия `userEvent`
 * @param editor — диалог редактора
 * @param name — подпись вида
 */
const chooseKind = async (user: User, editor: HTMLElement, name: string) => {
  const group = within(editor).getByRole('radiogroup', { name: 'Вид разлиновки' });

  await user.click(within(group).getByRole('radio', { name }));
};

/**
 * Выбранный вид в переключателе.
 *
 * @param editor — диалог редактора
 * @returns подпись выбранного вида
 */
const readCheckedKind = (editor: HTMLElement): string | null => {
  const group = within(editor).getByRole('radiogroup', { name: 'Вид разлиновки' });

  return (
    within(group)
      .getAllByRole('radio')
      .find((radio) => {
        return radio.getAttribute('aria-checked') === 'true';
      })?.textContent || null
  );
};

/**
 * Раздел вида разлиновки в панели редактора.
 *
 * @param editor — диалог редактора
 * @returns раздел
 */
const getKindSection = (editor: HTMLElement): HTMLElement => {
  return within(editor).getByRole('region', { name: 'Вид разлиновки' });
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

describe('вид разлиновки в редакторе', () => {
  it('показывает вид, предложенный автоматом', async () => {
    const editor = await openEditor({ kind: 'lined', familyId: 'lined' });

    expect(readCheckedKind(editor)).toBe('Линейка');
  });

  it('автомат принял клетку за линейку: выбрана клетка → лист в семье клетки, строки через клетку', async () => {
    const user = userEvent.setup();
    const editor = await openEditor({ kind: 'lined', familyId: 'lined' });

    expect(readRowStep()).toBeCloseTo(PHOTO.step, 6);

    await chooseKind(user, editor, 'Клетка');

    expect(readDraft().kind).toBe('grid');
    expect(readDraft().ruling.step).toBe(PHOTO.step);

    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    expect(useGeneratorStore.getState().userSheets[0]?.familyId).toBe('grid');
    expect(useGeneratorStore.getState().familyId).toBe('grid');
    expect(readRowStep()).toBeCloseTo(PHOTO.step * 2, 6);
    expect(decodeSheetImage).not.toHaveBeenCalled();
  });

  /**
   * Чистый лист остаётся в семье, где лежал: и в клетке, где строка — два
   * шага, строки на нём идут через заданный шаг.
   */
  it.each<[RulingKind]>([['grid'], ['lined']])(
    'без разлиновки в семье %s → магнит не притягивает, строки через заданный шаг, линии не ищутся',
    async (familyKind) => {
      const user = userEvent.setup();
      const editor = await openEditor({
        kind: familyKind,
        familyId: familyKind,
        image: createSyntheticSheet(PHOTO),
      });

      await chooseKind(user, editor, 'Без разлиновки');

      expect(readDraft().kind).toBe('blank');
      expect(readDraft().pins).toStrictEqual(PINS);

      /**
       * Воображаемая строка в пяти пикселях под линией снимка: магнит линий
       * поставил бы конец на линию, а без разлиновки конец остаётся, где его
       * отпустили. Десять шагов от третьей линии — шаг 36,5 px.
       */
      const released = lineY(12) + 5;
      const step = (released - lineY(3)) / 10;

      dragHandle(
        within(editor).getByRole('button', {
          name: 'Закреплённая линия 2, правый конец',
        }),
        { x: 500, y: released }
      );
      dragHandle(
        within(editor).getByRole('button', { name: 'Закреплённая линия 2, левый конец' }),
        { x: 150, y: released }
      );

      expect(readDraft().pins[1]).toStrictEqual({
        index: 13,
        left: { x: 150, y: released },
        right: { x: 500, y: released },
      });
      expect(readDraft().ruling.step).toBeCloseTo(step, 6);

      await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

      const [saved] = useGeneratorStore.getState().userSheets;

      expect(saved?.kind).toBe('blank');
      expect(saved?.familyId).toBe(familyKind);
      expect(saved?.sheet.ruling.step).toBeCloseTo(step, 6);
      expect(readRowStep()).toBeCloseTo(step, 6);
      expect(decodeSheetImage).not.toHaveBeenCalled();
    }
  );

  it('с «Без разлиновки» на линейку заново ищет линии; сохранение ждёт поиска, отмена — один шаг', async () => {
    const user = userEvent.setup();
    const manual = buildRuling(RULED_PHOTO, 30);
    const editor = await openEditor({
      kind: 'blank',
      familyId: 'lined',
      photo: RULED_PHOTO,
      ruling: manual,
    });
    const release = deferDecode();

    await chooseKind(user, editor, 'Линейка');

    expect(readCheckedKind(editor)).toBe('Линейка');
    expect(within(getKindSection(editor)).getByRole('status').textContent).toContain(
      'Ищем линии на фотографии'
    );
    expect(
      within(editor).getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')
    ).toBe(true);
    expect(decodeSheetImage).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(createSyntheticSheet(RULED_PHOTO));
    });

    await waitFor(() => {
      expect(readDraft().ruling.step).toBeCloseTo(RULED_PHOTO.step, 1);
    });

    const found = readDraft();

    expect(found.kind).toBe('lined');
    expect(found.ruling.outline).toBe(manual.outline);
    expect(found.pins).toStrictEqual(
      deriveRulingPins(found.ruling, {
        width: RULED_PHOTO.width,
        height: RULED_PHOTO.height,
      })
    );
    expect(within(getKindSection(editor)).getByRole('status').textContent).toBe('');
    expect(
      within(editor).getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')
    ).toBe(false);

    act(() => {
      useMarkupEditorStore.getState().undo();
    });

    expect(readDraft().kind).toBe('blank');
    expect(readDraft().ruling).toBe(manual);

    act(() => {
      useMarkupEditorStore.getState().redo();
    });

    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    const [saved] = useGeneratorStore.getState().userSheets;

    expect(saved?.kind).toBe('lined');
    expect(saved?.sheet.ruling.step).toBeCloseTo(RULED_PHOTO.step, 1);
    expect(readRowStep()).toBeCloseTo(saved?.sheet.ruling.step || 0, 6);
  });

  it('найденные линии с другим наклоном не сдвигают на фото поля зеркальной страницы', async () => {
    const user = userEvent.setup();
    const frame = { width: RULED_PHOTO.width, height: RULED_PHOTO.height };

    /**
     * Наклон ручной разметки далёк от найденного на снимке: поля зеркала,
     * оставленные теми же числами, повернулись бы вокруг угла кадра.
     */
    const manual: SheetRuling = {
      ...buildRuling(RULED_PHOTO, 30),
      skewAngle: 1.5,
      mirrorOverride: {
        marginLineX: 300,
        marginLineSide: 'right',
        marginLeft: 40,
        marginRight: 90,
        sideSlant: { left: 52, right: 80, marginLineX: 310 },
      },
    };

    /**
     * Столбцы боковых границ зеркальной страницы у верха, в середине и у низа
     * кадра.
     *
     * @param ruling — разлиновка листа
     * @returns столбцы, px отражённой фотографии
     */
    const readMirrorColumns = (ruling: SheetRuling): number[] => {
      const page = mirrorSheetRuling(ruling, frame);

      return (['left', 'right', 'marginLine'] as const).flatMap((edge) => {
        const ends = readSideEdge(page, frame, edge);

        return [0, frame.height / 2, frame.height].map((y) => {
          return ends
            ? sideEdgePointAtHeight(page.skewAngle, ends, frame.height, y).x
            : Number.NaN;
        });
      });
    };

    const editor = await openEditor({
      kind: 'blank',
      familyId: 'lined',
      photo: RULED_PHOTO,
      ruling: manual,
    });

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));
    await chooseKind(user, editor, 'Линейка');

    await waitFor(() => {
      expect(readDraft().ruling.step).toBeCloseTo(RULED_PHOTO.step, 1);
    });

    const found = readDraft().ruling;

    expect(Math.abs(found.skewAngle - manual.skewAngle)).toBeGreaterThan(1);
    expect(readMirrorColumns(found)).toStrictEqual(
      readMirrorColumns(manual).map((x) => {
        return expect.closeTo(x, 6);
      })
    );
  });

  it('поиск линий и перемер контура, идущие вместе, не снимают друг другу ожидание сохранения', async () => {
    const user = userEvent.setup();
    const editor = await openEditor({
      kind: 'blank',
      familyId: 'lined',
      photo: RULED_PHOTO,
      ruling: buildRuling(RULED_PHOTO, 30),
    });
    const releaseLines = deferDecode();

    await chooseKind(user, editor, 'Линейка');

    const releaseOutline = deferDecode();

    await user.click(within(editor).getByRole('radio', { name: 'Контур' }));
    dragHandle(within(editor).getByRole('button', { name: 'Правый нижний угол листа' }), {
      x: 400,
      y: 540,
    });

    expect(useMarkupEditorStore.getState().remeasuringSources).toStrictEqual([
      'lines',
      'outline',
    ]);

    const saveButton = within(editor).getByRole('button', { name: 'Сохранить' });

    await act(async () => {
      releaseLines(createSyntheticSheet(RULED_PHOTO));
    });
    await waitFor(() => {
      expect(within(getKindSection(editor)).getByRole('status').textContent).toBe('');
    });

    expect(saveButton.hasAttribute('disabled')).toBe(true);
    expect(
      within(editor).getByText(/Лист перемеряется внутри нового контура/)
    ).toBeDefined();

    await act(async () => {
      releaseOutline(createSyntheticSheet(RULED_PHOTO));
    });
    await waitFor(() => {
      expect(saveButton.hasAttribute('disabled')).toBe(false);
    });

    expect(readDraft().kind).toBe('lined');
    expect(readDraft().ruling.outline?.bottomRight).toStrictEqual({ x: 400, y: 540 });
  });

  it('линий на снимке нет: вид меняется, закреплённые строки остаются, причина видна', async () => {
    const user = userEvent.setup();
    const manual = buildRuling(RULED_PHOTO, 30);
    const editor = await openEditor({
      kind: 'blank',
      familyId: 'lined',
      photo: RULED_PHOTO,
      ruling: manual,
    });

    decodeSheetImage.mockResolvedValue(
      createSyntheticSheet({ ...RULED_PHOTO, kind: 'blank', marginLineX: null })
    );

    await chooseKind(user, editor, 'Клетка');

    expect(
      (await within(getKindSection(editor)).findByRole('alert')).textContent
    ).toContain('Линии на фотографии не найдены');
    expect(readDraft().kind).toBe('grid');
    expect(readDraft().ruling).toBe(manual);
  });

  it('между клеткой и линейкой линии не ищутся заново', async () => {
    const user = userEvent.setup();
    const editor = await openEditor({ kind: 'grid', familyId: 'grid' });

    await chooseKind(user, editor, 'Линейка');

    expect(readDraft().kind).toBe('lined');
    expect(decodeSheetImage).not.toHaveBeenCalled();
    expect(within(getKindSection(editor)).getByRole('status').textContent).toBe('');
  });
});
