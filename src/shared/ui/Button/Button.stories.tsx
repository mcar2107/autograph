import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from './Button';

/**
 * Наименьший контраст текста кнопки с фоном под ним (WCAG 1.4.3).
 */
const MIN_TEXT_CONTRAST = 4.5;

/**
 * Цвет CSS в канвасе: канвас разбирает любую запись цвета, которую отдаёт
 * `getComputedStyle`, и отдаёт её пикселями sRGB.
 *
 * @param context — канвас в один пиксель
 * @param colors — цвета слоёв снизу вверх, с прозрачностью
 * @returns канал красного, зелёного и синего, 0…255
 */
const blendColors = (context: CanvasRenderingContext2D, colors: string[]): number[] => {
  context.clearRect(0, 0, 1, 1);

  for (const color of colors) {
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
  }

  return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
};

/**
 * Относительная яркость цвета sRGB по WCAG.
 *
 * @param channels — красный, зелёный, синий, 0…255
 * @returns яркость, 0…1
 */
const readLuminance = (channels: number[]): number => {
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const value = channel / 255;

    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/**
 * Контраст текста кнопки с её фоном поверх фона страницы.
 *
 * @param button — кнопка
 * @returns контраст, от 1 до 21
 */
const measureTextContrast = (button: HTMLElement): number => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Канвас не создан');
  }

  canvas.width = 1;
  canvas.height = 1;

  /**
   * Фоны предков от страницы до кнопки: кнопка стоит на поверхности диалога,
   * а не прямо на странице.
   */
  const backdrop: string[] = [];

  for (let node = button.parentElement; node; node = node.parentElement) {
    backdrop.unshift(getComputedStyle(node).backgroundColor);
  }

  const { color, backgroundColor } = getComputedStyle(button);
  const [text, background] = [
    blendColors(context, [...backdrop, backgroundColor, color]),
    blendColors(context, [...backdrop, backgroundColor]),
  ].map(readLuminance);
  const lighter = Math.max(text || 0, background || 0);
  const darker = Math.min(text || 0, background || 0);

  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Правила `:hover` таблиц стилей, переписанные на атрибут `data-hover`:
 * события `userEvent` не наводят настоящий указатель, и `:hover` без этого в
 * прогоне stories не включить. Вложенные правила разворачиваются: селектор
 * `&` — внешнего правила.
 *
 * @param rules — правила таблицы или группы
 * @param parent — селектор внешнего правила; пустая строка — его нет
 * @returns правила CSS текстом
 */
const collectHoverRules = (rules: CSSRuleList, parent: string): string[] => {
  return [...rules].flatMap((rule) => {
    if (rule instanceof CSSStyleRule) {
      const selector = parent
        ? rule.selectorText.replaceAll('&', parent)
        : rule.selectorText;
      const own =
        HOVER_PATTERN.test(selector) && rule.style.length > 0
          ? [
              `${selector.replaceAll(HOVER_PATTERN, '[data-hover]')}{${rule.style.cssText}}`,
            ]
          : [];

      return [...own, ...collectHoverRules(rule.cssRules, selector)];
    }

    if (rule instanceof CSSNestedDeclarations) {
      return HOVER_PATTERN.test(parent)
        ? [`${parent.replaceAll(HOVER_PATTERN, '[data-hover]')}{${rule.style.cssText}}`]
        : [];
    }

    return rule instanceof CSSGroupingRule
      ? collectHoverRules(rule.cssRules, parent)
      : [];
  });
};

/**
 * `:hover` в селекторе — псевдокласс, а не часть имени класса `hover\:…`.
 */
const HOVER_PATTERN = /(?<!\\):hover/gu;

/**
 * Наводит на элемент «указатель»: включает его правила `:hover` и ждёт конца
 * перехода цветов.
 *
 * @param element — элемент
 * @returns снимает наведение
 */
const forceHover = async (element: HTMLElement): Promise<() => void> => {
  const style = document.createElement('style');

  style.textContent = [...document.styleSheets]
    .flatMap((sheet) => {
      return collectHoverRules(sheet.cssRules, '');
    })
    .join('\n');
  document.head.append(style);
  element.dataset.hover = '';

  await new Promise((resolve) => {
    setTimeout(resolve, HOVER_TRANSITION_MS);
  });

  return () => {
    style.remove();
    delete element.dataset.hover;
  };
};

/**
 * Сколько ждать конца перехода цветов, мс: у кнопки он короче.
 */
const HOVER_TRANSITION_MS = 400;

const meta = {
  component: Button,
  args: {
    children: 'Сохранить',
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: 'primary' },
};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Удалить лист' },
};

/**
 * Разрушительная кнопка под курсором: подсветка фона не должна съедать
 * контраст надписи.
 */
export const DangerHover: Story = {
  args: { variant: 'danger', children: 'Удалить лист' },
  decorators: [
    (Story) => {
      return (
        <div className="bg-surface-raised p-4">
          <Story />
        </div>
      );
    },
  ],
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Удалить лист' });
    const idle = getComputedStyle(button).backgroundColor;

    await expect(measureTextContrast(button)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

    const unhover = await forceHover(button);
    const hovered = getComputedStyle(button).backgroundColor;
    const contrast = measureTextContrast(button);

    unhover();

    await expect(hovered).not.toBe(idle);
    await expect(contrast).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  },
};

export const Focused: Story = {
  args: { variant: 'primary' },
  play: async () => {
    await userEvent.tab();
  },
};

export const Disabled: Story = {
  args: { variant: 'primary', isDisabled: true },
};

export const Loading: Story = {
  args: { variant: 'primary', isLoading: true },
};
