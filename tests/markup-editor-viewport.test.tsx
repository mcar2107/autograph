/**
 * @vitest-environment jsdom
 */
import { MarkupHandle } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupHandle';
import { MarkupViewport } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport';
import {
  clampScale,
  computeRevealOffset,
  MARKUP_ZOOM_MAX,
  MARKUP_ZOOM_STEP,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport/markupView';
import type { MarkupViewPoint } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport/markupView.types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const FRAME = { width: 600, height: 800 };

/**
 * Наименьшее приближение, при котором видно, на какой пиксель линии легла
 * точка разметки: пиксель фотографии — четыре экранных.
 */
const PIXEL_ZOOM = 4;

afterEach(() => {
  cleanup();
});

/**
 * Окно просмотра с одной ручкой поверх фотографии.
 *
 * @param onHandleMove — колбэк движения ручки
 * @returns окно, сцена с матрицей и ручка
 */
const renderViewport = (onHandleMove: () => void = vi.fn()) => {
  render(
    <MarkupViewport frame={FRAME} photoSrc="data:image/jpeg;base64," photoLabel="Лист">
      <svg viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}>
        <MarkupHandle kind="corner" x={100} y={200} label="Ручка" onMove={onHandleMove} />
      </svg>
    </MarkupViewport>
  );

  return {
    viewport: screen.getByTestId('markup-viewport'),
    stage: screen.getByTestId('markup-stage'),
    handle: screen.getByRole('button', { name: 'Ручка' }),
  };
};

/**
 * Перетаскивание указателем с элемента на заданный сдвиг.
 *
 * @param target — элемент, на котором нажали
 * @param dx — сдвиг по горизонтали
 * @param dy — сдвиг по вертикали
 */
const drag = (target: Element, dx: number, dy: number) => {
  fireEvent.pointerDown(target, { pointerId: 1, clientX: 50, clientY: 50 });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 50 + dx, clientY: 50 + dy });
  fireEvent.pointerUp(target, { pointerId: 1 });
};

describe('панорама с пробелом', () => {
  it('без пробела ручка забирает нажатие, с зажатым пробелом перетаскивание по ручке сдвигает фото', async () => {
    const user = userEvent.setup();
    const { viewport, stage, handle } = renderViewport();
    const before = stage.style.transform;

    drag(handle, 30, 40);

    expect(stage.style.transform).toBe(before);

    await user.hover(viewport);
    await user.keyboard('[Space>]');

    expect(viewport.dataset.panMode).toBe('true');

    drag(handle, 30, 40);

    expect(stage.style.transform).not.toBe(before);

    const panned = stage.style.transform;

    await user.keyboard('[/Space]');

    expect(viewport.dataset.panMode).toBeUndefined();

    drag(handle, 30, 40);

    expect(stage.style.transform).toBe(panned);
  });

  it('пробел в поле ввода и вне окна просмотра режим сдвига не включает', async () => {
    const user = userEvent.setup();

    render(
      <>
        <input aria-label="Шаг" />

        <MarkupViewport
          frame={FRAME}
          photoSrc="data:image/jpeg;base64,"
          photoLabel="Лист"
        >
          <svg />
        </MarkupViewport>
      </>
    );

    const viewport = screen.getByTestId('markup-viewport');

    await user.keyboard('[Space>]');

    expect(viewport.dataset.panMode).toBeUndefined();

    await user.keyboard('[/Space]');
    await user.hover(viewport);
    await user.click(screen.getByRole('textbox', { name: 'Шаг' }));
    await user.hover(viewport);
    await user.keyboard('[Space>]');

    expect(viewport.dataset.panMode).toBeUndefined();
  });
});

describe('предел приближения', () => {
  it('пиксель фотографии достижим в четыре экранных и больше', () => {
    expect(MARKUP_ZOOM_MAX).toBeGreaterThanOrEqual(PIXEL_ZOOM);
    expect(clampScale(PIXEL_ZOOM, 0.1)).toBe(PIXEL_ZOOM);
    expect(clampScale(Number.POSITIVE_INFINITY, 0.1)).toBe(MARKUP_ZOOM_MAX);
  });

  it('кнопка «Приблизить» доводит до предела и дальше не ведёт', async () => {
    const user = userEvent.setup();
    const { stage } = renderViewport();
    const zoomIn = screen.getByRole('button', { name: 'Приблизить' });
    const clicks = Math.ceil(Math.log(MARKUP_ZOOM_MAX) / Math.log(MARKUP_ZOOM_STEP)) + 2;

    for (let index = 0; index < clicks; index += 1) {
      await user.click(zoomIn);
    }

    expect(stage.style.transform).toContain(`scale(${MARKUP_ZOOM_MAX})`);
    expect(screen.getByText(`${MARKUP_ZOOM_MAX * 100} %`)).toBeDefined();
  });
});

/**
 * Подменяет прямоугольник элемента в окне браузера: jsdom layout не считает.
 *
 * @param element — элемент
 * @param left — левый край
 * @param top — верхний край
 * @param width — ширина
 * @param height — высота
 */
const mockRect = (
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number
) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      return DOMRect.fromRect({ x: left, y: top, width, height });
    },
  });
};

/**
 * Сдвиг сцены из её CSS-матрицы.
 *
 * @param stage — сцена окна просмотра
 * @returns сдвиг левого верхнего угла фотографии, экранные пиксели
 */
const readTranslate = (stage: HTMLElement): MarkupViewPoint => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(stage.style.transform);

  if (!match) {
    throw new Error(`Нет сдвига в ${stage.style.transform}`);
  }

  return { x: Number(match[1]), y: Number(match[2]) };
};

describe('ручка в фокусе вне видимой части окна', () => {
  it('сдвиг приводит в середину окна только ось, по которой ручка вне окна', () => {
    const size = { width: 400, height: 300 };

    expect(
      computeRevealOffset({ left: 100, top: 100, right: 114, bottom: 114 }, size)
    ).toBeNull();
    expect(
      computeRevealOffset({ left: 900, top: 100, right: 914, bottom: 114 }, size)
    ).toStrictEqual({ x: 200 - 907, y: 0 });
    expect(
      computeRevealOffset({ left: 100, top: -500, right: 114, bottom: -486 }, size)
    ).toStrictEqual({ x: 0, y: 150 + 493 });
    expect(
      computeRevealOffset({ left: 4, top: 100, right: 18, bottom: 114 }, size)
    ).toStrictEqual({ x: 200 - 11, y: 0 });
  });

  it('фокус на ручке за краем окна сдвигает фотографию моделью окна, и ручка встаёт в середину', () => {
    const { viewport, stage, handle } = renderViewport();
    const before = readTranslate(stage);

    mockRect(viewport, 50, 60, 400, 300);
    mockRect(handle, 950, 1060, 14, 14);

    act(() => {
      handle.focus();
    });

    expect(document.activeElement).toBe(handle);

    const after = readTranslate(stage);

    expect(after.x - before.x).toBeCloseTo(50 + 200 - 957, 6);
    expect(after.y - before.y).toBeCloseTo(60 + 150 - 1067, 6);
  });

  it('ручка, взятая указателем у края окна, фотографию не сдвигает', () => {
    const { viewport, stage, handle } = renderViewport();
    const before = stage.style.transform;

    mockRect(viewport, 0, 0, 400, 300);
    mockRect(handle, 393, 100, 14, 14);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 395, clientY: 107 });
    act(() => {
      handle.focus();
    });

    expect(stage.style.transform).toBe(before);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    act(() => {
      handle.blur();
      handle.focus();
    });

    expect(stage.style.transform).not.toBe(before);
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)(
    'указатель, потерянный без pointerup (%s), табуляцию не глушит',
    (lost) => {
      const { viewport, stage, handle } = renderViewport();
      const before = stage.style.transform;

      mockRect(viewport, 0, 0, 400, 300);
      mockRect(handle, 950, 100, 14, 14);

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 955, clientY: 107 });
      fireEvent[lost](handle, { pointerId: 1 });
      act(() => {
        handle.focus();
      });

      expect(stage.style.transform).not.toBe(before);
    }
  );
});
