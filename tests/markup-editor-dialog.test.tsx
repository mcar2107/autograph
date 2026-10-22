/**
 * @vitest-environment jsdom
 */
import {
  buildSheetRuling,
  lineHeightAt,
  type PaperSheet,
  type SheetPoint,
  type SheetRuling,
} from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { useMarkupEditorStore } from '@pages/Generator/model/useMarkupEditorStore';
import { PaperPicker } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker';
import { SheetMarkupEditor } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticSheet } from './helpers/synthetic-sheet';
import {
  buildPhotoFile,
  readUserRuling,
  RULED_PHOTO,
  uploadUserPhoto,
} from './helpers/user-sheet-photo';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Подменяется только съём пикселей: канвы в jsdom нет. Разбор идёт настоящим
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

/**
 * Выбор бумаги и редактор так, как их собирает панель оформления.
 */
const EditorHarness: FC = () => {
  return (
    <>
      <PaperPicker />

      <SheetMarkupEditor />
    </>
  );
};

type User = ReturnType<typeof userEvent.setup>;

const UPLOADED_LABEL = 'моя тетрадь';

const SEEDED_LABEL = 'Правленый лист';

const FRAME = { width: 600, height: 800 };

/**
 * Разлиновка, найденная автоматом, у заранее положенного листа.
 */
const MEASURED_RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: 0.5,
    margins: { top: 90, right: 40, bottom: 70, left: 60 },
    marginLineX: 100,
    marginLineSide: 'left',
  },
  FRAME
);

/**
 * Та же разлиновка после ручной правки: другой шаг и без линии поля.
 */
const EDITED_RULING: SheetRuling = {
  ...MEASURED_RULING,
  step: 40,
  marginLineX: null,
  marginLineSide: null,
};

const SEEDED_SHEET: PaperSheet = {
  id: 'user-edited',
  label: SEEDED_LABEL,
  src: 'data:image/jpeg;base64,0123456789',
  ...FRAME,
  ruling: EDITED_RULING,
  lighting: null,
  texture: null,
};

/**
 * Кладёт в стор лист, разметку которого пользователь уже правил.
 */
const seedEditedSheet = () => {
  const record = buildUserSheetRecord({ familyId: 'lined', sheet: SEEDED_SHEET });

  useGeneratorStore
    .getState()
    .addUserSheet({ ...record, measuredRuling: MEASURED_RULING });
};

/**
 * Открытый редактор листа.
 *
 * @param label — подпись листа
 * @returns диалог редактора
 */
const findEditor = async (label: string): Promise<HTMLElement> => {
  return await screen.findByRole('dialog', { name: `Разметка листа «${label}»` });
};

/**
 * Ломаные линий разлиновки в оверлее редактора.
 *
 * @param editor — диалог редактора
 * @returns линии сверху вниз
 */
const readLines = (editor: HTMLElement): SVGPolylineElement[] => {
  return [
    ...editor.querySelectorAll<SVGPolylineElement>('[data-layer="lines"] polyline'),
  ];
};

/**
 * Точки ломаной из её атрибута.
 *
 * @param line — ломаная
 * @returns точки в пикселях фотографии
 */
const readPoints = (line: Element): SheetPoint[] => {
  return (line.getAttribute('points') || '').split(' ').map((pair) => {
    const [x = 0, y = 0] = pair.split(',').map(Number);

    return { x, y };
  });
};

/**
 * Наибольший промах точек линий оверлея мимо разлиновки.
 *
 * @param editor — диалог редактора
 * @param ruling — разлиновка, которую должен рисовать оверлей
 * @returns промах в пикселях фотографии
 */
const measureOverlayMiss = (editor: HTMLElement, ruling: SheetRuling): number => {
  return readLines(editor).reduce((miss, line) => {
    const index = Number(line.dataset.lineIndex);
    const u = ruling.firstLinePhase + index * ruling.step;

    return readPoints(line).reduce((lineMiss, { x, y }) => {
      return Math.max(lineMiss, Math.abs(y - lineHeightAt(ruling, x, u)));
    }, miss);
  }, 0);
};

/**
 * Открывает редактор кнопкой настройки на плитке листа.
 *
 * @param user — сессия `userEvent`
 * @param label — подпись листа
 */
const openFromTile = async (user: User, label: string) => {
  await user.click(screen.getByRole('button', { name: `Разметка листа «${label}»` }));
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

describe('редактор после импорта', () => {
  it('разлиновка найдена — редактор открывается с найденной разметкой поверх фотографии', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<EditorHarness />);
    await uploadUserPhoto(user);

    const editor = await findEditor(UPLOADED_LABEL);
    const ruling = readUserRuling();

    if (!ruling) {
      throw new Error('Лист не добавлен');
    }

    expect(
      within(editor).getByRole('img', { name: `Фотография листа «${UPLOADED_LABEL}»` })
    ).toBeDefined();
    expect(editor.querySelector('[data-layer="outline"] polygon')).not.toBeNull();
    expect(editor.querySelector('[data-layer="marginLine"] line')).not.toBeNull();
    expect(editor.querySelectorAll('[data-layer="margins"] [data-margin]')).toHaveLength(
      4
    );
    expect(readLines(editor).length).toBeGreaterThan(
      RULED_PHOTO.height / RULED_PHOTO.step - 2
    );
    expect(measureOverlayMiss(editor, ruling)).toBeLessThan(0.01);
    expect(within(editor).queryByText(/Линии на снимке не найдены/)).toBeNull();
  });

  it('лист встаёт в выбор бумаги до закрытия редактора, выбранным и закреплённым', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<EditorHarness />);
    await uploadUserPhoto(user);
    await findEditor(UPLOADED_LABEL);

    const { userSheets, sheetId, isSheetPinned } = useGeneratorStore.getState();

    expect(userSheets).toHaveLength(1);
    expect(sheetId).toBe(userSheets[0]?.sheet.id);
    expect(isSheetPinned).toBe(true);
  });

  it('закрытие без сохранения оставляет лист с разметкой автомата', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(createSyntheticSheet(RULED_PHOTO));

    render(<EditorHarness />);
    await uploadUserPhoto(user);

    const editor = await findEditor(UPLOADED_LABEL);
    const [record] = useGeneratorStore.getState().userSheets;

    await user.click(within(editor).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();

    const [after] = useGeneratorStore.getState().userSheets;

    expect(after).toBe(record);
    expect(after?.sheet.ruling).toBe(after?.measuredRuling);
  });

  it('разлиновка не найдена — сообщение и две закреплённые линии', async () => {
    const user = userEvent.setup();

    decodeSheetImage.mockResolvedValue(
      createSyntheticSheet({
        ...RULED_PHOTO,
        kind: 'blank',
        marginLineX: null,
        noise: 0.06,
        lighting: 0.3,
      })
    );

    render(<EditorHarness />);
    await uploadUserPhoto(user);

    const editor = await findEditor(UPLOADED_LABEL);

    expect(readUserRuling()?.step).toBe(0);
    expect(within(editor).getByText(/Линии на снимке не найдены/)).toBeDefined();
    expect(within(editor).getByText(/Закрепите две линии/)).toBeDefined();
    expect(
      within(editor).getAllByRole('img', { name: /^Закреплённая линия \d$/ })
    ).toHaveLength(2);
    expect(readLines(editor)).toHaveLength(0);
  });
});

describe('редактор с плитки листа', () => {
  it('повторное открытие показывает сохранённую ручную разметку, а не найденную автоматом', async () => {
    const user = userEvent.setup();

    seedEditedSheet();
    render(<EditorHarness />);
    await openFromTile(user, SEEDED_LABEL);

    const editor = await findEditor(SEEDED_LABEL);

    expect(measureOverlayMiss(editor, EDITED_RULING)).toBeLessThan(0.01);
    expect(measureOverlayMiss(editor, MEASURED_RULING)).toBeGreaterThan(1);
    expect(editor.querySelector('[data-layer="marginLine"]')).toBeNull();
  });

  it('каналы фотографии для магнитов приходят и при открытии с плитки, закрытие их отпускает', async () => {
    const user = userEvent.setup();
    const image = createSyntheticSheet(RULED_PHOTO);

    decodeSheetImage.mockResolvedValue(image);
    seedEditedSheet();
    render(<EditorHarness />);
    await openFromTile(user, SEEDED_LABEL);

    const editor = await findEditor(SEEDED_LABEL);

    await waitFor(() => {
      expect(useMarkupEditorStore.getState().image).toBe(image);
    });
    expect(decodeSheetImage).toHaveBeenCalledWith(SEEDED_SHEET.src);

    await user.click(within(editor).getByRole('button', { name: 'Отмена' }));

    expect(useMarkupEditorStore.getState().image).toBeNull();
  });

  it('пока идёт разбор новой фотографии, настройка своих листов недоступна', async () => {
    const user = userEvent.setup();
    let finishDecode: (image: ReturnType<typeof createSyntheticSheet>) => void = () => {};

    decodeSheetImage.mockReturnValue(
      new Promise((resolve) => {
        finishDecode = resolve;
      })
    );
    seedEditedSheet();
    render(<EditorHarness />);

    const settings = screen.getByRole('button', {
      name: `Разметка листа «${SEEDED_LABEL}»`,
    });

    expect(settings).toHaveProperty('disabled', false);

    await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

    expect(settings).toHaveProperty('disabled', true);

    finishDecode(createSyntheticSheet(RULED_PHOTO));

    await findEditor(UPLOADED_LABEL);

    expect(
      screen.getByRole('button', {
        name: `Разметка листа «${SEEDED_LABEL}»`,
        hidden: true,
      })
    ).toHaveProperty('disabled', false);
  });

  it('линия поля не найдена — сообщение у инструмента «Поля», сохранение доступно', async () => {
    const user = userEvent.setup();

    seedEditedSheet();
    render(<EditorHarness />);
    await openFromTile(user, SEEDED_LABEL);

    const editor = await findEditor(SEEDED_LABEL);

    expect(within(editor).queryByText(/Линия поля не найдена/)).toBeNull();

    await user.click(within(editor).getByRole('radio', { name: 'Поля' }));

    expect(within(editor).getByText(/Линия поля не найдена/)).toBeDefined();
    expect(within(editor).getByText(/добавьте её/)).toBeDefined();
    expect(
      within(editor).getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')
    ).toBe(false);
  });

  it('слои скрываются и показываются по отдельности', async () => {
    const user = userEvent.setup();

    seedEditedSheet();
    render(<EditorHarness />);
    await openFromTile(user, SEEDED_LABEL);

    const editor = await findEditor(SEEDED_LABEL);

    await user.click(within(editor).getByRole('checkbox', { name: 'Линии' }));

    expect(readLines(editor)).toHaveLength(0);
    expect(editor.querySelector('[data-layer="outline"] polygon')).not.toBeNull();
    expect(editor.querySelectorAll('[data-layer="margins"] [data-margin]')).toHaveLength(
      4
    );

    await user.click(within(editor).getByRole('checkbox', { name: 'Контур' }));

    expect(editor.querySelector('[data-layer="outline"]')).toBeNull();

    await user.click(within(editor).getByRole('checkbox', { name: 'Линии' }));

    expect(readLines(editor).length).toBeGreaterThan(0);
  });

  it('приближение меняет общую матрицу фотографии и разметки, разметка в пикселях фотографии', async () => {
    const user = userEvent.setup();

    seedEditedSheet();
    render(<EditorHarness />);
    await openFromTile(user, SEEDED_LABEL);

    const editor = await findEditor(SEEDED_LABEL);
    const stage = within(editor).getByTestId('markup-stage');
    const overlay = within(editor).getByRole('group', { name: 'Разметка листа' });
    const photo = within(editor).getByRole('img', {
      name: `Фотография листа «${SEEDED_LABEL}»`,
    });
    const before = stage.style.transform;
    const pointsBefore = readLines(editor).map((line) => {
      return line.getAttribute('points');
    });

    await user.click(within(editor).getByRole('button', { name: 'Приблизить' }));

    expect(stage.style.transform).not.toBe(before);
    expect(overlay.parentElement).toBe(stage);
    expect(photo.parentElement).toBe(stage);
    expect(overlay.getAttribute('viewBox')).toBe(`0 0 ${FRAME.width} ${FRAME.height}`);
    expect(
      readLines(editor).map((line) => {
        return line.getAttribute('points');
      })
    ).toStrictEqual(pointsBefore);
  });

  it('«Сохранить» применяет черновик к листу, лист остаётся выбранным', async () => {
    const user = userEvent.setup();

    seedEditedSheet();
    render(<EditorHarness />);
    await openFromTile(user, SEEDED_LABEL);

    const editor = await findEditor(SEEDED_LABEL);
    const margins = { ...EDITED_RULING.margins, left: 150 };

    useMarkupEditorStore.getState().commit({ ruling: { ...EDITED_RULING, margins } });
    await user.click(within(editor).getByRole('button', { name: 'Сохранить' }));

    const { userSheets, sheetId, isSheetPinned } = useGeneratorStore.getState();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(userSheets[0]?.sheet.ruling.margins).toStrictEqual(margins);
    expect(userSheets[0]?.measuredRuling).toBe(MEASURED_RULING);
    expect(sheetId).toBe(SEEDED_SHEET.id);
    expect(isSheetPinned).toBe(true);
    expect(useMarkupEditorStore.getState().image).toBeNull();
  });
});
