import { fitTileLabel } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker/OwnSheetTile/fitTileLabel';
import { splitLabelBreaks } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker/OwnSheetTile/splitLabelBreaks';
import { truncateMiddle } from '@pages/Generator/ui/Generator/SettingsPane/PaperPicker/OwnSheetTile/truncateMiddle';
import { describe, expect, it } from 'vitest';

describe('точки переноса подписи плитки', () => {
  it.each([
    ['IMG_1813', ['IMG_', '1813']],
    ['IMG_20250925_143012', ['IMG_', '20250925_', '143012']],
    ['IMG_…43012', ['IMG_', '…', '43012']],
    ['IMG1813', ['IMG', '1813']],
    ['Тетрадь в клетку, лист 2', ['Тетрадь в клетку, лист 2']],
    ['2024', ['2024']],
    ['scan_', ['scan_']],
  ])('%s → %j', (label, segments) => {
    expect(splitLabelBreaks(label)).toStrictEqual(segments);
  });

  it('куски складываются обратно в подпись', () => {
    const label = 'IMG_20250925_143012';

    expect(splitLabelBreaks(label).join('')).toBe(label);
  });
});

describe('подбор подписи плитки', () => {
  /**
   * Подсчёт строк, растущий с длиной текста: по пять знаков в строке.
   *
   * @param calls — сюда пишется каждый замер
   * @returns подсчёт строк
   */
  const createCounter = (calls: string[]) => {
    return (text: string): number => {
      calls.push(text);

      return Math.ceil([...text].length / 5);
    };
  };

  it('имя, которое встаёт, — целиком, одним замером', () => {
    const calls: string[] = [];

    expect(fitTileLabel('IMG_1813', createCounter(calls), 2)).toBe('IMG_1813');
    expect(calls).toHaveLength(1);
  });

  it('длинное — самое длинное обрезанное, что встаёт, двоичным поиском', () => {
    const calls: string[] = [];
    const label = 'IMG_20250925_143012_very_long_phone_name_0001';

    expect(fitTileLabel(label, createCounter(calls), 2)).toBe(truncateMiddle(label, 10));
    expect(calls.length).toBeLessThanOrEqual(1 + Math.ceil(Math.log2([...label].length)));
  });

  it('не встаёт и многоточие — остаётся оно одно', () => {
    const countLines = (): number => {
      return 3;
    };

    expect(fitTileLabel('IMG_1813', countLines, 2)).toBe('…');
  });
});
