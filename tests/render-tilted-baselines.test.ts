import type { BlockGeometry } from '@pages/Generator/lib/calibrate';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { RulingPerspective } from '@pages/Generator/lib/paper';
import { lineCoordinateAt } from '@pages/Generator/lib/paper';
import type { PageRenderParams, RenderGeometry } from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import { describe, expect, it } from 'vitest';

import { getBaselineY } from './helpers/baseline-model';
import { createPathRecorder } from './helpers/path-recorder';

const METRICS = FALLBACK_FONT_METRICS;

/**
 * Шаг разлиновки и наклон живого снимка, на котором промах был заметен
 * (`IMG_1808`): к низу листа строки уходили с линий на несколько пикселей.
 */
const RULING_STEP = 86;
const SKEW_ANGLE = -2.96;
const LINE_COUNT = 40;

/**
 * Перспектива листа на столе: шаг к низу растёт на несколько процентов.
 */
const PERSPECTIVE: RulingPerspective = {
  originX: 1500,
  originY: 2000,
  convergenceX: 3e-6,
  convergenceY: 1e-5,
};

/**
 * Базовая линия ровного пути — точное число: координата вдоль линий у неё
 * ровно та, что даёт модель строчного бокса.
 */
const EXACT_TOLERANCE_PX = 1e-6;

/**
 * Буквы на листе с перспективой повёрнуты по касательной своей линии вокруг
 * середины, а записывается начало буквы — оно отходит от линии на сотые доли
 * пикселя.
 */
const CURVED_TOLERANCE_PX = 0.05;

const FONT_SIZE_PX = (RULING_STEP * 0.55) / METRICS.xHeight;

const BLOCK_GEOMETRY: BlockGeometry = {
  fontSizePx: FONT_SIZE_PX,
  lineSpacing: RULING_STEP - FONT_SIZE_PX * METRICS.lineHeight,
  topOffset: 250 - METRICS.fontAscent * FONT_SIZE_PX,
  leftPadding: 200,
  blockWidth: 2000,
};

/**
 * Страница из одной короткой строки на каждую линию, без искажений почерка:
 * сверяется только положение строк.
 */
const PAGE: PageRenderParams['page'] = {
  lines: Array.from({ length: LINE_COUNT }, () => {
    return {
      words: [
        {
          text: 'а',
          distortion: { rotate: 0, skew: 0, translateY: 0, letters: [] },
          seed: 0,
        },
      ],
      distortion: { rotate: 0, translateX: 0 },
    };
  }),
};

/**
 * Параметры отрисовки наклонного листа.
 *
 * @param perspective — перспектива листа; `null` — прямая гребёнка
 * @returns параметры страницы
 */
const buildParams = (perspective: RulingPerspective | null): PageRenderParams => {
  const geometry: RenderGeometry = {
    ...BLOCK_GEOMETRY,
    blockRotate: SKEW_ANGLE,
    fontMetrics: METRICS,
    bend: null,
    perspective,
  };

  return {
    page: PAGE,
    background: null,
    inkColor: '#000',
    ink: { lighting: null, texture: null, seed: 1 },
    glyphs: null,
    fontFamily: 'Eskal',
    geometry,
    scale: 1,
  };
};

/**
 * Итог сверки строк с моделью строчного бокса.
 */
type BaselineMiss = {
  /**
   * Наибольший промах в координате вдоль линий, px.
   */
  miss: number;

  /**
   * Сколько строк сверено.
   */
  count: number;
};

/**
 * Наибольший промах строк мимо модели строчного бокса в координате вдоль
 * линий, px.
 *
 * @param perspective — перспектива листа; `null` — прямая гребёнка
 * @returns промах и число сверенных строк
 */
const measureMiss = (perspective: RulingPerspective | null): BaselineMiss => {
  const { context, texts } = createPathRecorder();
  const projection = { skewAngle: SKEW_ANGLE, perspective };

  renderPageToCanvas(context, buildParams(perspective));

  const miss = texts.reduce((worst, { x, y }, index) => {
    const expected = getBaselineY(BLOCK_GEOMETRY, METRICS, index);

    return Math.max(worst, Math.abs(lineCoordinateAt(projection, x, y) - expected));
  }, 0);

  return { miss, count: texts.length };
};

describe('строки наклонного листа', () => {
  it('стоят на координате вдоль линий, которую даёт модель строчного бокса', () => {
    const { miss, count } = measureMiss(null);

    expect(count).toBe(LINE_COUNT);
    expect(miss).toBeLessThanOrEqual(EXACT_TOLERANCE_PX);
  });

  it('стоят на ней и на листе с перспективой', () => {
    const { miss, count } = measureMiss(PERSPECTIVE);

    expect(count).toBe(LINE_COUNT);
    expect(miss).toBeLessThanOrEqual(CURVED_TOLERANCE_PX);
  });
});
