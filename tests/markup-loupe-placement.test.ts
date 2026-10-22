import {
  LOUPE_SIZE,
  resolveLoupePlacement,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/Loupe/loupeGeometry';
import { describe, expect, it } from 'vitest';

/**
 * Окно браузера обычного ноутбука: лупа встаёт и над указателем, и под ним.
 */
const WINDOW = { width: 1440, height: 900 };

describe('место лупы', () => {
  it('стоит над указателем, а у верхнего края окна — под ним', () => {
    const above = resolveLoupePlacement({ x: 700, y: 500 }, WINDOW);
    const below = resolveLoupePlacement({ x: 700, y: 20 }, WINDOW);

    expect(above.top + LOUPE_SIZE).toBeLessThan(500);
    expect(below.top).toBeGreaterThan(20);
  });

  it('в низком окне не уходит за нижний край', () => {
    const bounds = { width: WINDOW.width, height: 240 };
    const { top } = resolveLoupePlacement({ x: 700, y: 150 }, bounds);

    expect(top).toBeGreaterThan(0);
    expect(top + LOUPE_SIZE).toBeLessThanOrEqual(bounds.height);
  });

  it('по горизонтали держится внутри окна у обоих краёв', () => {
    const left = resolveLoupePlacement({ x: 0, y: 500 }, WINDOW);
    const right = resolveLoupePlacement({ x: WINDOW.width, y: 500 }, WINDOW);

    expect(left.left).toBeGreaterThan(0);
    expect(right.left + LOUPE_SIZE).toBeLessThanOrEqual(WINDOW.width);
  });
});
