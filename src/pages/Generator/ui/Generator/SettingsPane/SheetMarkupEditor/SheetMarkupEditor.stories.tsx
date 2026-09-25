import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { GRID_FAMILY_ID } from '../../../../config';
import { clearLayoutCache } from '../../../../model/measureLayout';
import { loadPaperFamilies } from '../../../../model/paperProfiles';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../model/useMarkupEditorStore';
import { deriveUserSheetMarkup } from '../../../../model/userSheetsStorageRecord';
import { openSheetEditor } from '../useSheetImport';

import { SheetMarkupEditor } from './SheetMarkupEditor';

const SHEET_ID = 'user-markup-showcase';

const LOAD_TIMEOUT = 20_000;

/**
 * Лист пресет-пака фиксирован: третий лист клетки — с изгибом и линией поля
 * справа, на нём видны все слои разметки сразу.
 */
const PRESET_INDEX = 2;

/**
 * Seed прогона фиксирован: эталон снимка не должен зависеть от случайного
 * экземпляра листа и почерка.
 */
const RUN_SEED = 7;

/**
 * Кладёт лист пресет-пака своим листом и открывает редактор тем же путём, что
 * кнопка настройки на плитке, а затем ждёт, пока фотография в окне
 * декодируется: снимок до этого вышел бы без листа.
 */
const openPresetSheet = async () => {
  const families = await loadPaperFamilies();
  const preset = families.find(({ id }) => {
    return id === GRID_FAMILY_ID;
  })?.sheets[PRESET_INDEX];

  if (!preset) {
    throw new Error('В пресет-паке нет листа в клетку');
  }

  const sheet = { ...preset, id: SHEET_ID, label: 'Тетрадь в клетку' };
  const record = {
    familyId: GRID_FAMILY_ID,
    sheet,
    kind: 'grid' as const,
    ...deriveUserSheetMarkup(sheet, 'grid'),
    isAnalyzed: true,
  };

  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: families,
    userSheets: [record],
    hasRestoredUserSheets: true,
    familyId: GRID_FAMILY_ID,
    sheetId: SHEET_ID,
    isSheetPinned: true,
    runSeed: RUN_SEED,
  });
  await openSheetEditor(record);
  await waitFor(
    async () => {
      await expect(useMarkupEditorStore.getState().image).not.toBeNull();

      const photo = document.querySelector<HTMLImageElement>(
        '[data-testid="markup-stage"] > img'
      );

      await expect(Boolean(photo?.complete && photo.naturalWidth > 0)).toBe(true);
    },
    { timeout: LOAD_TIMEOUT }
  );
};

/**
 * Открывает лист и переключает редактор на инструмент.
 *
 * @param canvasElement — корень story
 * @param tool — подпись инструмента в переключателе
 */
const openWithTool = async (canvasElement: HTMLElement, tool: string) => {
  await openPresetSheet();

  const body = within(canvasElement.ownerDocument.body);
  const radio = await body.findByRole('radio', { name: tool });

  await userEvent.click(radio);
  await expect(radio).toBeChecked();
};

const meta = {
  component: SheetMarkupEditor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SheetMarkupEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Редактор сразу после открытия: инструмент «Линии», булавки на крайних
 * найденных линиях.
 */
export const Lines: Story = {
  play: async ({ canvasElement }) => {
    await openPresetSheet();

    const body = within(canvasElement.ownerDocument.body);

    await expect(await body.findByRole('radio', { name: 'Линии' })).toBeChecked();
    await expect(
      await body.findByRole('button', { name: 'Закреплённая линия 1, левый конец' })
    ).toBeVisible();
  },
};

/**
 * «Контур»: четыре угла листа.
 */
export const Outline: Story = {
  play: async ({ canvasElement }) => {
    await openWithTool(canvasElement, 'Контур');
  },
};

/**
 * «Изгиб»: линии гребёнки с изгибом, найденным на снимке.
 */
export const Bend: Story = {
  play: async ({ canvasElement }) => {
    await openWithTool(canvasElement, 'Изгиб');
  },
};

/**
 * «Поля»: направляющие полей и линия поля.
 */
export const Margins: Story = {
  play: async ({ canvasElement }) => {
    await openWithTool(canvasElement, 'Поля');
  },
};

/**
 * Сколько раз левый нижний угол полей сдвигается влево на десять пикселей:
 * поле заметно наклоняется, как вдоль стороны листа, снятого на столе.
 */
const SLANT_STEPS = 8;

/**
 * «Поля» с наклонным левым полем: левый нижний угол сдвинут влево, поле идёт
 * через оба угла, а числа показывают оба конца.
 */
export const SlantedMargin: Story = {
  play: async ({ canvasElement }) => {
    await openWithTool(canvasElement, 'Поля');

    const body = within(canvasElement.ownerDocument.body);
    const bottom = await body.findByRole('button', { name: 'Левый нижний угол полей' });

    bottom.focus();

    for (let step = 0; step < SLANT_STEPS; step += 1) {
      await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    }

    await expect(useMarkupEditorStore.getState().draft?.ruling.sideSlant).not.toBeNull();
    await expect(
      await body.findByRole('button', { name: 'Левый верхний угол полей' })
    ).toBeVisible();

    await userEvent.click(await body.findByRole('button', { name: 'Точные значения' }));
    await expect(
      await body.findByRole('textbox', { name: 'Левое поле снизу, px' })
    ).toBeVisible();
  },
};

/**
 * Зеркальная страница: отражённые фотография и разметка, линия поля и боковые
 * поля зеркала — отражением оригинала.
 */
export const MirrorPage: Story = {
  play: async ({ canvasElement }) => {
    await openWithTool(canvasElement, 'Поля');

    const body = within(canvasElement.ownerDocument.body);
    const mirror = await body.findByRole('radio', { name: 'Зеркальная страница' });

    await userEvent.click(mirror);
    await expect(mirror).toBeChecked();
    await expect(
      await body.findByRole('img', {
        name: 'Фотография листа «Тетрадь в клетку», отражённая',
      })
    ).toBeVisible();
  },
};
