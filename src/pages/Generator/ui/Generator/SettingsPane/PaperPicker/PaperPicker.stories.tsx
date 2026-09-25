import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';

import { GRID_FAMILY_ID } from '../../../../config';
import type { PaperSheet } from '../../../../lib/paper';
import { loadPaperFamilies } from '../../../../model/paperProfiles';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '../../../../model/useGeneratorStore';
import type { UserSheetRecord } from '../../../../model/userSheetsStorage.types';
import { deriveUserSheetMarkup } from '../../../../model/userSheetsStorageRecord';

import { PaperPicker } from './PaperPicker';

const LOAD_TIMEOUT = 20_000;

/**
 * Наименьшая цель нажатия кнопки разметки, px.
 */
const MIN_TARGET_SIZE = 32;

/**
 * Два своих листа с именами, какие даёт телефон: они совпадают до последних
 * цифр, и на плитках обязаны различаться.
 */
const OWN_SHEETS = [
  { presetIndex: 0, id: 'user-img-1813', label: 'IMG_1813' },
  { presetIndex: 2, id: 'user-img-1808', label: 'IMG_1808' },
];

/**
 * Свой лист из листа пресет-пака: фотография светлая, как у настоящей
 * тетради, — на ней и проверяется контраст кнопки разметки.
 *
 * @param preset — лист пресет-пака
 * @param id — идентификатор своего листа
 * @param label — подпись своего листа
 * @returns запись своего листа
 */
const toOwnRecord = (preset: PaperSheet, id: string, label: string): UserSheetRecord => {
  const sheet = { ...preset, id, label };

  return {
    familyId: GRID_FAMILY_ID,
    sheet,
    kind: 'grid',
    ...deriveUserSheetMarkup(sheet, 'grid'),
    isAnalyzed: true,
  };
};

const meta = {
  component: PaperPicker,
  decorators: [
    (Story) => {
      return (
        <div className="w-80 bg-surface p-4">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof PaperPicker>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Свои листы в ряду выбора бумаги: подпись обрезана с середины, кнопка
 * разметки — на подложке поверх превью.
 */
export const OwnSheets: Story = {
  beforeEach: async () => {
    const families = await loadPaperFamilies();
    const presets =
      families.find(({ id }) => {
        return id === GRID_FAMILY_ID;
      })?.sheets || [];
    const userSheets = OWN_SHEETS.map(({ presetIndex, id, label }) => {
      const preset = presets[presetIndex];

      if (!preset) {
        throw new Error('В пресет-паке нет листа в клетку');
      }

      return toOwnRecord(preset, id, label);
    });

    useGeneratorStore.setState({
      ...DEFAULT_GENERATOR_STATE,
      presetFamilies: families,
      userSheets,
      hasRestoredUserSheets: true,
      familyId: GRID_FAMILY_ID,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ownSheets = await canvas.findByRole('list', { name: 'Свои листы' });

    for (const { label } of OWN_SHEETS) {
      const markup = within(ownSheets).getByRole('button', {
        name: `Разметка листа «${label}»`,
      });
      const { width, height } = markup.getBoundingClientRect();

      await expect(width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);
      await expect(height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);

      /**
       * Обрезанная с середины подпись помещается целиком: обрезка CSS с конца
       * поверх неё снова съела бы различающиеся цифры.
       */
      const caption = within(ownSheets)
        .getByRole('button', { name: label })
        .querySelector('span:last-child');

      await expect(caption?.scrollWidth).toBeLessThanOrEqual(caption?.clientWidth || 0);
    }

    await expect(
      within(ownSheets).getByRole('button', { name: 'IMG_1813' })
    ).toHaveTextContent('IM…813');

    /**
     * Снимок ждёт превью: без них эталон вышел бы с пустыми плитками.
     */
    await waitFor(
      async () => {
        const previews = [...ownSheets.querySelectorAll('img')];

        await expect(
          previews.every((image) => {
            return image.complete && image.naturalWidth > 0;
          })
        ).toBe(true);
      },
      { timeout: LOAD_TIMEOUT }
    );
  },
};
