import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BlockGeometry } from '@pages/Generator/lib/calibrate/calibrate.types';
import {
  deriveGeometry,
  MARGIN_LINE_GAP_SHARE,
} from '@pages/Generator/lib/calibrate/deriveGeometry';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { PaperSheet, SheetRuling } from '@pages/Generator/lib/paper';
import { mirrorSheetRuling } from '@pages/Generator/lib/paper';
import { parsePaperSheet } from '@pages/Generator/model/paperSheetJson';
import { describe, expect, it } from 'vitest';

/**
 * Разлиновка `IMG_1813` после правки — дамп `SheetRuling` из `measureSheetPhoto`
 * и `buildSheetRuling` тем же декодером, что у отчёта замера. Собрать её из
 * отчёта нельзя: он не печатает ни коэффициентов перспективы, ни узлов изгиба.
 */
const FIXTURE_PATH = resolve(import.meta.dirname, 'fixtures/img-1813-ruling.json');

/**
 * Самое внутреннее положение настоящей черты `IMG_1813` по разметке цветом
 * (контракт K1): `u` у верхней полосы, слева. Число снято скриптом вне
 * детектора, поэтому фикстура сверяется с ним, а не сама с собой.
 */
const INNERMOST_MARGIN_LINE_U = 401;

/**
 * Столбец фантома, который первая ступень до правки ставила справа: блок
 * кончался на нём, сужаясь до половины листа.
 */
const PHANTOM_MARGIN_LINE_X = 1640.7;

/**
 * Допуск положения линии поля — пятая часть шага, как в требовании.
 */
const MARGIN_LINE_TOLERANCE_STEPS = 0.2;

/**
 * Допуск округления в пикселях: отражение переводит линию в `W − x`, и
 * зазор до края блока теряет последний бит.
 */
const ROUNDING_TOLERANCE_PX = 1e-9;

/**
 * Экземпляр листа из фикстуры — тем же разбором, которым приложение читает
 * артефакт профилей.
 *
 * @returns экземпляр листа `IMG_1813`
 */
const readFixtureSheet = (): PaperSheet => {
  const value: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const sheet = parsePaperSheet(value);

  if (sheet === null) {
    throw new Error(`Фикстура не разобралась: ${FIXTURE_PATH}`);
  }

  return sheet;
};

/**
 * Геометрия блока на листе с этой разлиновкой.
 *
 * @param sheet — экземпляр листа
 * @param ruling — разлиновка страницы: исходная или отражённая
 * @returns геометрия блока в пикселях кадра
 */
const deriveBlock = (sheet: PaperSheet, ruling: SheetRuling): BlockGeometry => {
  return deriveGeometry(
    { ruling, kind: 'grid', width: sheet.width, height: sheet.height },
    FALLBACK_FONT_METRICS
  );
};

describe('IMG_1813: блок текста на левой половине разворота', () => {
  const sheet = readFixtureSheet();
  const { ruling, width } = sheet;
  const { step, margins, marginLineX, marginLineSide } = ruling;
  const gap = step * MARGIN_LINE_GAP_SHARE;
  const { leftPadding, blockWidth } = deriveBlock(sheet, ruling);

  /**
   * Разбор подставляет нейтральное значение вместо негодного поля: потерянная
   * перспектива или изгиб незаметно сменили бы проверяемую разлиновку.
   */
  it('фикстура читается разбором без потерь', () => {
    const value: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    /**
     * Полей зеркала в записи нет: разбор читает их отражением.
     */
    const { mirrorOverride, ...stored } = ruling;

    expect(mirrorOverride).toBeNull();
    expect(value).toMatchObject({ ruling: stored });
    expect(ruling.perspective).not.toBeNull();
    expect(ruling.bend).not.toBeNull();
  });

  it('линия поля — у настоящей черты, а не у фантома', () => {
    expect(marginLineSide).toBe('left');
    expect(Math.abs((marginLineX || 0) - INNERMOST_MARGIN_LINE_U)).toBeLessThanOrEqual(
      MARGIN_LINE_TOLERANCE_STEPS * step
    );
  });

  it('правый край блока — поле листа, а не фантом посередине', () => {
    expect(leftPadding + blockWidth).toBeCloseTo(width - margins.right, 6);
    expect(leftPadding + blockWidth).toBeGreaterThan(PHANTOM_MARGIN_LINE_X);
    expect(blockWidth).toBeGreaterThanOrEqual(
      width - margins.right - Math.max(margins.left, (marginLineX || 0) + gap)
    );
  });

  it('левый край блока — внутрь от черты на зазор и не за её внутренним положением', () => {
    expect(leftPadding - (marginLineX || 0)).toBeGreaterThanOrEqual(
      gap - ROUNDING_TOLERANCE_PX
    );
    expect(leftPadding).toBeGreaterThan(INNERMOST_MARGIN_LINE_U);
  });
});

describe('IMG_1813: блок текста на правой половине разворота', () => {
  const sheet = readFixtureSheet();
  const { width, height } = sheet;
  const mirrored = mirrorSheetRuling(sheet.ruling, { width, height });
  const { step, margins, marginLineX, marginLineSide } = mirrored;
  const gap = step * MARGIN_LINE_GAP_SHARE;
  const { leftPadding, blockWidth } = deriveBlock(sheet, mirrored);
  const rightEdge = leftPadding + blockWidth;

  it('линия поля отражается к правой стороне вместе с разлиновкой', () => {
    expect(marginLineSide).toBe('right');
    expect(
      Math.abs((marginLineX || 0) - (width - INNERMOST_MARGIN_LINE_U))
    ).toBeLessThanOrEqual(MARGIN_LINE_TOLERANCE_STEPS * step);
  });

  it('блок не сужен до половины листа', () => {
    expect(leftPadding).toBeCloseTo(margins.left, 6);
    expect(blockWidth).toBeGreaterThan(width / 2);
    expect(blockWidth).toBeGreaterThanOrEqual(
      Math.min(width - margins.right, (marginLineX || width) - gap) - margins.left
    );
  });

  it('правый край блока не заходит за черту', () => {
    expect((marginLineX || 0) - rightEdge).toBeGreaterThanOrEqual(
      gap - ROUNDING_TOLERANCE_PX
    );
    expect(rightEdge).toBeLessThan(width - INNERMOST_MARGIN_LINE_U);
  });
});
