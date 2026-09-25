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

/**
 * Сколько раз нажать «Приблизить», чтобы концы булавок ушли за край окна:
 * шаг кнопки — корень из двух, шесть нажатий — восьмикратное приближение.
 */
const ZOOM_CLICKS = 6;

/**
 * Прокрутка колеса с Ctrl в пикселях: приближение примерно на пятую часть.
 */
const WHEEL_DELTA = -100;

/**
 * Допуск точки под курсором после приближения колесом, экранные пиксели.
 */
const ANCHOR_TOLERANCE = 1;

/**
 * Прокрутка окна и всех его предков: табуляция к ручке не должна двигать ни
 * одного из них.
 *
 * @param element — окно просмотра
 * @returns пары «сверху, слева» от окна до корня документа
 */
const readScrollChain = (element: Element): number[][] => {
  const chain: number[][] = [];

  for (let node: Element | null = element; node; node = node.parentElement) {
    chain.push([node.scrollTop, node.scrollLeft]);
  }

  return chain;
};

/**
 * Точка окна браузера в пикселях фотографии — по матрице оверлея.
 *
 * @param svg — SVG оверлея
 * @param point — точка окна браузера
 * @returns точка фотографии
 */
const toPhotoPoint = (svg: SVGSVGElement, point: SheetPoint): SheetPoint => {
  const matrix = svg.getScreenCTM()?.inverse();

  if (!matrix) {
    throw new Error('У оверлея нет экранной матрицы');
  }

  const { a, b, c, d, e, f } = matrix;

  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
};

/**
 * Точка фотографии в окне браузера — по матрице оверлея.
 *
 * @param svg — SVG оверлея
 * @param point — точка фотографии
 * @returns точка окна браузера
 */
const toClientPoint = (svg: SVGSVGElement, point: SheetPoint): SheetPoint => {
  const matrix = svg.getScreenCTM();

  if (!matrix) {
    throw new Error('У оверлея нет экранной матрицы');
  }

  const { a, b, c, d, e, f } = matrix;

  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
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

    /**
     * Центр перекрестья — там, где в лупе лежит точка ручки: полпоперечника
     * от угла поля со снимком.
     */
    const photo = await findElement<HTMLElement>('[data-loupe-photo]');
    const [horizontalGap, verticalGap] = [
      ...loupe.querySelectorAll<HTMLElement>('[data-crosshair-gap]'),
    ].map((gap) => {
      return gap.getBoundingClientRect();
    });
    const photoBox = photo.getBoundingClientRect();

    await expect(
      (horizontalGap?.left || 0) + (horizontalGap?.width || 0) / 2
    ).toBeCloseTo(photoBox.left + (right - left) / 2, 0);
    await expect((verticalGap?.top || 0) + (verticalGap?.height || 0) / 2).toBeCloseTo(
      photoBox.top + (bottom - top) / 2,
      0
    );
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

    /**
     * Под пробным текстом линии приглушены, у закреплённых линий — только
     * концы.
     */
    const muted = await findElement<SVGGElement>('[data-muted]');

    await expect(Number(getComputedStyle(muted).opacity)).toBeLessThanOrEqual(0.25);
    await expect(document.querySelectorAll('[data-layer="pins"] line')).toHaveLength(0);
  },
};

/**
 * Фокус на ручке за краем приближенного окна показывает её сдвигом фотографии
 * моделью окна: ни окно, ни его предки не прокручиваются, а приближение
 * колесом с Ctrl после этого остаётся у курсора. `focus()` без
 * `preventScroll` прокручивает к элементу так же, как табуляция.
 */
export const FocusHandleOutsideView: Story = {
  play: async () => {
    await openPresetSheet();

    const viewport = await findElement<HTMLElement>('[data-testid="markup-viewport"]');
    const stage = await findElement<HTMLElement>('[data-testid="markup-stage"]');
    const svg = await findElement<SVGSVGElement>('svg[aria-label="Разметка листа"]');
    const zoomIn = [...document.querySelectorAll('button')].find((button) => {
      return button.getAttribute('aria-label') === 'Приблизить';
    });

    for (let click = 0; click < ZOOM_CLICKS; click += 1) {
      zoomIn?.click();
    }

    /**
     * Ручка, целиком ушедшая за правый или нижний край окна: туда прокрутка
     * контейнера дотягивается, и нативная прокрутка к ней была бы видна.
     *
     * @returns ручка
     */
    const findHiddenHandle = (): SVGCircleElement => {
      const frame = viewport.getBoundingClientRect();
      const hidden = [
        ...viewport.querySelectorAll<SVGCircleElement>('circle[role="button"]'),
      ].find((circle) => {
        const { left, top } = circle.getBoundingClientRect();

        return left > frame.right || top > frame.bottom;
      });

      if (!hidden) {
        throw new Error('Все ручки в окне: приближение не увело их за край');
      }

      return hidden;
    };

    const handle = await waitFor(findHiddenHandle);
    const scrollsBefore = readScrollChain(viewport);
    const { transform } = stage.style;

    handle.focus();

    await expect(document.activeElement).toBe(handle);
    await expect(readScrollChain(viewport)).toStrictEqual(scrollsBefore);
    await expect(viewport.scrollTop).toBe(0);
    await expect(viewport.scrollLeft).toBe(0);
    await expect(stage.style.transform).not.toBe(transform);

    const frame = viewport.getBoundingClientRect();
    const box = handle.getBoundingClientRect();

    await expect(box.left).toBeGreaterThanOrEqual(frame.left);
    await expect(box.right).toBeLessThanOrEqual(frame.right);
    await expect(box.top).toBeGreaterThanOrEqual(frame.top);
    await expect(box.bottom).toBeLessThanOrEqual(frame.bottom);

    /**
     * Курсор — в трети окна, а не в середине: у середины ошибка якоря от
     * прокрутки не отличалась бы от приближения к центру.
     */
    const cursor = {
      x: frame.left + frame.width / 3,
      y: frame.top + frame.height / 3,
    };
    const photoPoint = toPhotoPoint(svg, cursor);
    const zoomed = stage.style.transform;

    viewport.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: WHEEL_DELTA,
        clientX: cursor.x,
        clientY: cursor.y,
      })
    );

    await waitFor(async () => {
      await expect(stage.style.transform).not.toBe(zoomed);
    });

    const after = toClientPoint(svg, photoPoint);

    await expect(Math.abs(after.x - cursor.x)).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
    await expect(Math.abs(after.y - cursor.y)).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
  },
};
