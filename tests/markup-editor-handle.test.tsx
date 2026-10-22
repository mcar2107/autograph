/**
 * @vitest-environment jsdom
 */
import type { SheetPoint } from '@pages/Generator/lib/paper';
import { MarkupHandle } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupHandle';
import { MarkupScaleContext } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Обратная экранная матрица SVG: окно приближено вдвое и сдвинуто на
 * (20, 40) экранных пикселей.
 */
const INVERSE_SCREEN_MATRIX = { a: 0.5, b: 0, c: 0, d: 0.5, e: -10, f: -20 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Ручка внутри SVG при заданном масштабе окна.
 *
 * @param onMove — колбэк движения
 * @param onMoveEnd — колбэк отпускания
 * @param onViewportPointerDown — нажатие, дошедшее до окна просмотра
 * @returns ручка
 */
const renderHandle = (
  onMove: (point: SheetPoint) => void,
  onMoveEnd: (point: SheetPoint) => void,
  onViewportPointerDown: () => void = vi.fn()
): HTMLElement => {
  render(
    <div onPointerDown={onViewportPointerDown}>
      <svg>
        <MarkupScaleContext value={2}>
          <MarkupHandle
            kind="corner"
            x={100}
            y={200}
            label="Левый верхний угол листа"
            onMove={onMove}
            onMoveEnd={onMoveEnd}
          />
        </MarkupScaleContext>
      </svg>
    </div>
  );

  return screen.getByRole('button', { name: 'Левый верхний угол листа' });
};

describe('ручка разметки', () => {
  it('стоит в пикселях фотографии и держит экранный размер при приближении', () => {
    const handle = renderHandle(vi.fn(), vi.fn());

    expect(handle.getAttribute('cx')).toBe('100');
    expect(handle.getAttribute('cy')).toBe('200');
    expect(handle.getAttribute('r')).toBe('5');
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it('перетаскивание отдаёт точки фотографии под указателем, отпускание — последнюю', () => {
    const onMove = vi.fn();
    const onMoveEnd = vi.fn();
    const pointerDown = vi.fn();
    const handle = renderHandle(onMove, onMoveEnd, pointerDown);
    const svg = handle.closest('svg');

    if (!svg) {
      throw new Error('Ручка вне SVG');
    }

    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => {
        return {
          inverse: () => {
            return INVERSE_SCREEN_MATRIX;
          },
        };
      },
    });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 220, clientY: 440 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240, clientY: 460 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 900, clientY: 900 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(pointerDown).not.toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ x: 110, y: 210 });
    expect(onMoveEnd).toHaveBeenCalledWith({ x: 110, y: 210 }, 'pointer');
  });

  it('обводка фигуры — два экранных пикселя при любом масштабе окна', () => {
    const handle = renderHandle(vi.fn(), vi.fn());
    const shape = handle.parentElement?.querySelector('[data-handle-kind]');

    /**
     * Масштаб окна 2: в пикселях фотографии обводка вдвое тоньше экранной.
     */
    expect(shape?.getAttribute('stroke-width')).toBe('1');
  });

  it('нажатие без движения — не отпускание: правки нет', () => {
    const onMove = vi.fn();
    const onMoveEnd = vi.fn();
    const handle = renderHandle(onMove, onMoveEnd);
    const svg = handle.closest('svg');

    if (!svg) {
      throw new Error('Ручка вне SVG');
    }

    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => {
        return {
          inverse: () => {
            return INVERSE_SCREEN_MATRIX;
          },
        };
      },
    });

    const pointer = { pointerId: 1, clientX: 220, clientY: 440 };

    fireEvent.pointerDown(handle, pointer);
    fireEvent.pointerMove(handle, pointer);
    fireEvent.pointerUp(handle, pointer);

    expect(onMove).not.toHaveBeenCalled();
    expect(onMoveEnd).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, pointer);
    fireEvent.pointerMove(handle, { ...pointer, clientX: 240 });
    fireEvent.pointerMove(handle, pointer);
    fireEvent.pointerUp(handle, pointer);

    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onMoveEnd).toHaveBeenCalledTimes(1);
  });
});
