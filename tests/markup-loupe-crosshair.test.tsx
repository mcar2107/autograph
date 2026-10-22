/**
 * @vitest-environment jsdom
 */
import { Loupe } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/Loupe';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * Лупа над точкой фотографии.
 *
 * @returns узел лупы
 */
const renderLoupe = (): HTMLElement => {
  render(
    <Loupe
      src="data:image/jpeg;base64,"
      frame={{ width: 600, height: 800 }}
      point={{ x: 120, y: 300 }}
      anchor={{ x: 400, y: 400 }}
      scale={1}
      isMirrored={false}
      container={document.body}
    />
  );

  return screen.getByRole('img', { name: 'Лупа' });
};

describe('перекрестие лупы', () => {
  it('светлое с тёмной каймой: различимо и на красной черте поля, и на тёмной линии, и на бумаге', () => {
    const loupe = renderLoupe();
    const arms = loupe.querySelectorAll('[data-crosshair-arm]');

    expect(arms).toHaveLength(4);

    for (const arm of arms) {
      expect(arm.classList.contains('bg-white')).toBe(true);
      expect(arm.getAttribute('class')).toMatch(/\boutline-black\b/);
    }

    expect(loupe.innerHTML).not.toContain('bg-danger');
  });

  it('в центре зазор: точку под ручкой перекрестие не закрывает', () => {
    const loupe = renderLoupe();
    const gaps = loupe.querySelectorAll('[data-crosshair-gap]');

    expect(gaps).toHaveLength(2);

    for (const gap of gaps) {
      expect(gap.previousElementSibling?.hasAttribute('data-crosshair-arm')).toBe(true);
      expect(gap.nextElementSibling?.hasAttribute('data-crosshair-arm')).toBe(true);
    }
  });
});
