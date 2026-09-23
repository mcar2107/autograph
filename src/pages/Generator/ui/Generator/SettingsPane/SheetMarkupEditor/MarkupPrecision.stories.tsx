import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

import { LINED_FAMILY_ID } from '../../../../config';
import type { RulingPin, SheetPoint } from '../../../../lib/paper';
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

const SHEET_ID = 'user-precision';

const LOAD_TIMEOUT = 20_000;

/**
 * Seed прогона фиксирован: пробный текст рисуется тем же почерком при каждом
 * прогоне.
 */
const RUN_SEED = 7;

/**
 * Кладёт лист пресет-пака в линейку своим листом и открывает редактор тем же
 * путём, что кнопка настройки на плитке.
 */
const openPresetSheet = async () => {
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
    runSeed: RUN_SEED,
  });
  await openSheetEditor(record);
  await waitFor(
    async () => {
      await expect(useMarkupEditorStore.getState().image).not.toBeNull();
    },
    { timeout: LOAD_TIMEOUT }
  );
};

/**
 * Элемент по селектору, когда он появится.
 *
 * @param selector — CSS-селектор
 * @returns элемент
 */
const findElement = async <T extends Element>(selector: string): Promise<T> => {
  return await waitFor(() => {
    const element = document.querySelector<T>(selector);

    if (!element) {
      throw new Error(`Нет элемента ${selector}`);
    }

    return element;
  });
};

/**
 * Первая закреплённая линия черновика.
 *
 * @returns булавка
 */
const readFirstPin = (): RulingPin => {
  const pin = useMarkupEditorStore.getState().draft?.pins[0];

  if (!pin) {
    throw new Error('В черновике нет булавок');
  }

  return pin;
};

/**
 * Центр элемента в окне браузера.
 *
 * @param element — элемент
 * @returns точка окна
 */
const readCenter = (element: Element): SheetPoint => {
  const { left, top, width, height } = element.getBoundingClientRect();

  return { x: left + width / 2, y: top + height / 2 };
};

const meta = {
  component: SheetMarkupEditor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SheetMarkupEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Стрелка сдвигает конец булавки в фокусе на пиксель фотографии, «Точные
 * значения» раскрыты: разметка правится без мыши, и у каждого контрола есть
 * имя — проверку доступности story проходит без нарушений.
 */
export const ArrowNudgeAndExactValues: Story = {
  play: async () => {
    await openPresetSheet();

    const handle = await findElement<SVGCircleElement>(
      'circle[aria-label="Закреплённая линия 1, левый конец"]'
    );
    const before = readFirstPin();

    handle.focus();
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );

    await waitFor(async () => {
      await expect(readFirstPin().left).toStrictEqual({
        x: before.left.x,
        y: before.left.y + 1,
      });
    });

    const trigger = [...document.querySelectorAll('button')].find((button) => {
      return button.textContent === 'Точные значения';
    });

    trigger?.click();

    const step = await findElement<HTMLInputElement>('input[inputmode="decimal"]');

    await expect(step.value).not.toBe('');
  },
};

/**
 * Пока тянут конец булавки, над указателем видна лупа — внутри окна и не под
 * указателем.
 */
export const LoupeWhileDragging: Story = {
  play: async () => {
    await openPresetSheet();

    const handle = await findElement<SVGCircleElement>(
      'circle[aria-label="Закреплённая линия 2, правый конец"]'
    );
    const start = readCenter(handle);
    const pointer = {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };

    handle.dispatchEvent(
      new PointerEvent('pointerdown', { ...pointer, clientX: start.x, clientY: start.y })
    );
    handle.dispatchEvent(
      new PointerEvent('pointermove', {
        ...pointer,
        clientX: start.x,
        clientY: start.y + 3,
      })
    );

    const loupe = await findElement<HTMLElement>('[role="img"][aria-label="Лупа"]');
    const { left, top, right, bottom } = loupe.getBoundingClientRect();
    const isUnderPointer =
      left <= start.x && start.x <= right && top <= start.y + 3 && start.y + 3 <= bottom;

    await expect(isUnderPointer).toBe(false);
    await expect(left).toBeGreaterThanOrEqual(0);
    await expect(right).toBeLessThanOrEqual(window.innerWidth);
    await expect(top).toBeGreaterThanOrEqual(0);
    await expect(bottom).toBeLessThanOrEqual(window.innerHeight);
  },
};

/**
 * Пробный текст приходит от воркера отрисовки и ложится поверх фотографии в
 * её пикселях.
 */
export const TrialTextOverPhoto: Story = {
  play: async () => {
    await openPresetSheet();

    const trial = [...document.querySelectorAll('label')].find((label) => {
      return label.textContent === 'Пробный текст';
    });

    trial?.click();

    const image = await waitFor(
      async () => {
        const element = await findElement<HTMLImageElement>(
          'img[alt="Пробный текст по разметке"]'
        );

        await expect(element.complete && element.naturalWidth > 0).toBe(true);

        return element;
      },
      { timeout: LOAD_TIMEOUT }
    );
    const photo = await findElement<HTMLImageElement>(
      '[data-testid="markup-stage"] > img'
    );

    await expect(image.getBoundingClientRect().width).toBeCloseTo(
      photo.getBoundingClientRect().width,
      0
    );
  },
};
