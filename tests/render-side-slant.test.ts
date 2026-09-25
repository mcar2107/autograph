import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import type { GlyphPoint } from '@pages/Generator/lib/glyph';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import { countPageLines } from '@pages/Generator/lib/paginate/countPageLines';
import type { Page } from '@pages/Generator/lib/paginate/paginate.types';
import type {
  PaperFamily,
  PaperSheet,
  RulingPerspective,
  SheetOutline,
  SheetPoint,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import {
  lineCoordinateAt,
  mirrorSheetRuling,
  toSideEdgeEnds,
} from '@pages/Generator/lib/paper';
import type { PageRenderParams } from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import { buildPageRenderParams } from '@pages/Generator/model/buildPageRenderParams';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import { describe, expect, it } from 'vitest';

import { NO_DISTORTION_FLAGS } from './helpers/distortion-flags';
import { createPathRecorder } from './helpers/path-recorder';

/**
 * Лист на столе: трапеция, сужающаяся к дальнему, верхнему краю, шаг линий
 * к верху короче, наклон — градус.
 */
const RULING_STEP = 50;
const SHEET_WIDTH = 1600;
const SHEET_HEIGHT = 2000;
const SKEW_ANGLE = 1;
const FIRST_LINE_PHASE = 40;

const PERSPECTIVE: RulingPerspective = {
  originX: SHEET_WIDTH / 2,
  originY: SHEET_HEIGHT / 2,
  convergenceX: 0,
  convergenceY: 1e-4,
};

const OUTLINE: SheetOutline = {
  topLeft: { x: 300, y: 150 },
  topRight: { x: 1300, y: 170 },
  bottomRight: { x: 1500, y: 1900 },
  bottomLeft: { x: 100, y: 1880 },
};

/**
 * Отступ полей от сторон листа по горизонтали, px: одинаковый у верха и у
 * низа — так их ставят вдоль сторон трапеции.
 */
const SIDE_INSET = 80;

/**
 * Допуск — десятая доля шага, как в требовании.
 */
const TOLERANCE_STEPS = 0.1;

const SCALE = 2;

/**
 * Сдвиг точки по горизонтали.
 *
 * @param point — точка
 * @param dx — сдвиг, px
 * @returns сдвинутая точка
 */
const shift = ({ x, y }: SheetPoint, dx: number): SheetPoint => {
  return { x: x + dx, y };
};

const LEFT_ENDS = toSideEdgeEnds(
  SKEW_ANGLE,
  SHEET_HEIGHT,
  shift(OUTLINE.topLeft, SIDE_INSET),
  shift(OUTLINE.bottomLeft, SIDE_INSET)
);

const RIGHT_ENDS = toSideEdgeEnds(
  SKEW_ANGLE,
  SHEET_HEIGHT,
  shift(OUTLINE.topRight, -SIDE_INSET),
  shift(OUTLINE.bottomRight, -SIDE_INSET)
);

/**
 * Разлиновка листа: боковые поля вдоль сторон трапеции или, для сравнения,
 * одним числом у верха.
 *
 * @param isSlanted — идут ли поля вдоль сторон
 * @returns разлиновка
 */
const buildRuling = (isSlanted: boolean): SheetRuling => {
  return {
    step: RULING_STEP,
    firstLinePhase: FIRST_LINE_PHASE,
    skewAngle: SKEW_ANGLE,
    margins: {
      top: 260,
      right: SHEET_WIDTH - RIGHT_ENDS.top,
      bottom: 160,
      left: LEFT_ENDS.top,
    },
    marginLineX: null,
    marginLineSide: null,
    sideSlant: isSlanted
      ? {
          left: LEFT_ENDS.bottom,
          right: SHEET_WIDTH - RIGHT_ENDS.bottom,
          marginLineX: null,
        }
      : null,
    bend: null,
    perspective: PERSPECTIVE,
    outline: OUTLINE,
    mirrorOverride: null,
  };
};

/**
 * Экземпляр листа.
 *
 * @param isSlanted — идут ли поля вдоль сторон
 * @returns лист
 */
const buildSheet = (isSlanted: boolean): PaperSheet => {
  return {
    id: isSlanted ? 'slanted' : 'vertical',
    label: 'Лист на столе',
    src: '/paper/table.jpg',
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    ruling: buildRuling(isSlanted),
    lighting: null,
    texture: null,
  };
};

/**
 * Семья с одним листом.
 *
 * @param sheet — лист
 * @returns семья
 */
const buildFamily = (sheet: PaperSheet): PaperFamily => {
  return { id: 'lined', label: 'В линейку', kind: 'lined', sheets: [sheet] };
};

/**
 * Короткое слово: вся строка заведомо уже блока, и первая буква каждой строки
 * стоит у левого края блока.
 */
const LINE_TEXT = 'мм мм';

/**
 * Параметры отрисовки полной страницы: строк столько, сколько встаёт на лист.
 *
 * @param sheet — лист
 * @param pageIndex — номер страницы; нечётный — зеркальная
 * @returns параметры отрисовки
 */
const buildParams = (sheet: PaperSheet, pageIndex: number): PageRenderParams => {
  const calibration = getPageCalibration(buildFamily(sheet), sheet, pageIndex);
  const geometry = deriveGeometry(calibration, FALLBACK_FONT_METRICS);
  const lineCount = countPageLines(calibration, geometry, FALLBACK_FONT_METRICS, 0);
  const page: Page = {
    lines: Array.from({ length: lineCount }, () => {
      return { text: LINE_TEXT, paragraphIndex: 0 };
    }),
  };

  return buildPageRenderParams({
    page,
    calibration,
    sheetImage: null,
    metrics: FALLBACK_FONT_METRICS,
    correction: {},
    inkColor: '#101010',
    fontFamily: 'Synthetic',
    flags: NO_DISTORTION_FLAGS,
    wordFrequency: 1,
    letterFrequency: 1,
    seed: 42,
    ink: { lighting: null, texture: null, seed: 7 },
    glyphs: null,
    scale: SCALE,
  });
};

/**
 * Начало каждой строки — первая буква на её базовой линии, в пикселях
 * страницы, по ленте отрисовки.
 *
 * @param params — параметры отрисовки
 * @param ruling — разлиновка страницы
 * @returns начала строк сверху вниз
 */
const renderLineStarts = (
  params: PageRenderParams,
  ruling: SheetRuling
): GlyphPoint[] => {
  const recorder = createPathRecorder();

  renderPageToCanvas(recorder.context, params);

  const starts = new Map<number, GlyphPoint>();

  recorder.texts.forEach((text) => {
    const point = { x: text.x / SCALE, y: text.y / SCALE };
    const index = Math.round(
      (lineCoordinateAt(ruling, point.x, point.y) - ruling.firstLinePhase) / ruling.step
    );
    const current = starts.get(index);

    if (!current || point.x < current.x) {
      starts.set(index, point);
    }
  });

  return [...starts.keys()]
    .sort((left, right) => {
      return left - right;
    })
    .reduce<GlyphPoint[]>((points, index) => {
      const point = starts.get(index);

      if (point) {
        points.push(point);
      }

      return points;
    }, []);
};

/**
 * Расстояние по горизонтали от стороны листа до точки.
 *
 * @param from — верхний конец стороны
 * @param to — нижний конец стороны
 * @param point — точка
 * @returns расстояние, px; положительное — точка правее стороны
 */
const distanceFromSide = (
  from: SheetPoint,
  to: SheetPoint,
  point: GlyphPoint
): number => {
  const sideX = from.x + ((to.x - from.x) * (point.y - from.y)) / (to.y - from.y);

  return point.x - sideX;
};

/**
 * Сводка по началам строк страницы.
 */
type StartSpread = {
  /**
   * Разброс расстояний от стороны листа до начала строки, в долях шага.
   */
  spread: number;

  /**
   * Сколько строк нашлось на ленте.
   */
  lines: number;

  /**
   * Среднее расстояние, px.
   */
  mean: number;
};

/**
 * Разброс расстояний от левой стороны листа до начала строки по всей
 * странице.
 *
 * @param sheet — лист
 * @param pageIndex — номер страницы
 * @returns сводка
 */
const measureStartSpread = (sheet: PaperSheet, pageIndex: number): StartSpread => {
  const calibration = getPageCalibration(buildFamily(sheet), sheet, pageIndex);
  const { ruling } = calibration;
  const outline = ruling.outline || OUTLINE;
  const starts = renderLineStarts(buildParams(sheet, pageIndex), ruling);
  const distances = starts.map((point) => {
    return distanceFromSide(outline.topLeft, outline.bottomLeft, point);
  });
  const mean =
    distances.reduce((sum, value) => {
      return sum + value;
    }, 0) / distances.length;

  return {
    spread: (Math.max(...distances) - Math.min(...distances)) / RULING_STEP,
    lines: starts.length,
    mean,
  };
};

describe('боковые поля вдоль сторон листа на столе', () => {
  it('строка начинается на одном расстоянии от края листа сверху и снизу', () => {
    const { spread, lines, mean } = measureStartSpread(buildSheet(true), 0);

    expect(lines).toBeGreaterThan(20);
    expect(spread).toBeLessThanOrEqual(TOLERANCE_STEPS);
    expect(Math.abs(mean - SIDE_INSET)).toBeLessThanOrEqual(
      TOLERANCE_STEPS * RULING_STEP
    );
  });

  it('поле одним числом оставляет у края листа клин', () => {
    const { spread } = measureStartSpread(buildSheet(false), 0);

    expect(spread).toBeGreaterThan(1);
  });

  it('на зеркальной странице строка так же идёт вдоль отражённой стороны', () => {
    const sheet = buildSheet(true);
    const mirrored = mirrorSheetRuling(sheet.ruling, sheet);
    const { spread, lines, mean } = measureStartSpread(sheet, 1);

    expect(mirrored.sideSlant).not.toBeNull();
    expect(lines).toBeGreaterThan(20);
    expect(spread).toBeLessThanOrEqual(TOLERANCE_STEPS);
    expect(Math.abs(mean - SIDE_INSET)).toBeLessThanOrEqual(
      TOLERANCE_STEPS * RULING_STEP
    );
  });
});
