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
 * Цель нажатия кнопки разметки под палец, px.
 */
const COARSE_TARGET_SIZE = 44;

/**
 * Правила таблиц стилей под `pointer: coarse`, вынутые из медиазапроса: в
 * браузере с мышью окно под палец иначе не проверить. Селектор правила —
 * внешнего правила стиля, в которое медиазапрос вложен.
 *
 * @param rules — правила таблицы или группы
 * @param selector — селектор внешнего правила; `null` — его нет
 * @returns правила CSS текстом
 */
const collectCoarseRules = (rules: CSSRuleList, selector: string | null): string[] => {
  return [...rules].flatMap((rule) => {
    if (rule instanceof CSSMediaRule && /pointer:\s*coarse/u.test(rule.conditionText)) {
      return [...rule.cssRules].map((inner) => {
        const own =
          inner instanceof CSSStyleRule
            ? inner.selectorText.replaceAll('&', selector || '')
            : selector;
        const declarations =
          inner instanceof CSSStyleRule || inner instanceof CSSNestedDeclarations
            ? inner.style.cssText
            : '';

        return `${own || ':root'}{${declarations}}`;
      });
    }

    if (rule instanceof CSSStyleRule) {
      return collectCoarseRules(rule.cssRules, rule.selectorText);
    }

    return rule instanceof CSSGroupingRule
      ? collectCoarseRules(rule.cssRules, selector)
      : [];
  });
};

/**
 * Включает на странице правила под палец, как если бы указатель был грубым.
 *
 * @returns таблица стилей с этими правилами — убрать после замера
 */
const applyCoarsePointerRules = (): HTMLStyleElement => {
  const style = document.createElement('style');

  style.textContent = [...document.styleSheets]
    .flatMap((sheet) => {
      return collectCoarseRules(sheet.cssRules, null);
    })
    .join('\n');
  document.head.append(style);

  return style;
};

/**
 * Свои листы с именами, какие даёт телефон, — они совпадают до последних цифр,
 * и на плитках обязаны различаться, — и два длинных: такое не встаёт в две
 * строки, и обрезка с середины оставляет на виду конец имени.
 */
const OWN_SHEETS = [
  { presetIndex: 0, id: 'user-img-1813', label: 'IMG_1813', isShort: true },
  { presetIndex: 2, id: 'user-img-1808', label: 'IMG_1808', isShort: true },
  { presetIndex: 1, id: 'user-img-long', label: 'IMG_20250925_143012', isShort: false },
  { presetIndex: 3, id: 'user-ru', label: 'Тетрадь в клетку, лист 2', isShort: false },
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
 * Свои листы в ряду выбора бумаги: подпись в две строки, длинная — обрезана с
 * середины, кнопка разметки — на подложке поверх превью.
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

    for (const { label, isShort } of OWN_SHEETS) {
      const markup = within(ownSheets).getByRole('button', {
        name: `Разметка листа «${label}»`,
      });
      const { width, height } = markup.getBoundingClientRect();

      await expect(width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);
      await expect(height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);

      const tile = within(ownSheets)
        .getAllByRole('button')
        .find((button) => {
          return (
            button.hasAttribute('aria-pressed') &&
            (button.getAttribute('aria-label') || '').includes(label)
          );
        });
      const caption = tile?.querySelector('span:last-child');
      const text = caption?.textContent || '';

      /**
       * Подобранная подпись встаёт в свои две строки целиком: срезка CSS с
       * конца поверх неё снова съела бы различающиеся цифры.
       */
      await expect(caption?.scrollHeight).toBeLessThanOrEqual(caption?.clientHeight || 0);
      await expect(tile?.getAttribute('aria-label')).toContain(text);

      if (isShort) {
        await expect(text).toBe(label);

        /**
         * Номер снимка не разрезается переносом: «IMG_» / «1813», а не
         * «IMG_181» / «3».
         */
        const tail = [...(caption?.childNodes || [])].at(-1);
        const range = document.createRange();

        if (tail) {
          range.selectNodeContents(tail);
        }

        const tops = new Set(
          [...range.getClientRects()].map(({ top }) => {
            return Math.round(top);
          })
        );

        await expect(tail?.textContent).toBe(label.slice(label.indexOf('_') + 1));
        await expect(tops.size).toBe(1);
      } else {
        await expect(text).toContain('…');
        await expect(label.endsWith(text.slice(-3))).toBe(true);
      }
    }

    /**
     * Под палец кнопка вырастает до 44 px, под мышь остаётся 32 px.
     */
    const [firstSheet] = OWN_SHEETS;
    const markup = within(ownSheets).getByRole('button', {
      name: `Разметка листа «${firstSheet?.label}»`,
    });
    const coarse = applyCoarsePointerRules();
    const coarseRect = markup.getBoundingClientRect();

    coarse.remove();

    const fineRect = markup.getBoundingClientRect();

    await expect([coarseRect.width, coarseRect.height]).toStrictEqual([
      COARSE_TARGET_SIZE,
      COARSE_TARGET_SIZE,
    ]);
    await expect([fineRect.width, fineRect.height]).toStrictEqual([
      MIN_TARGET_SIZE,
      MIN_TARGET_SIZE,
    ]);

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
