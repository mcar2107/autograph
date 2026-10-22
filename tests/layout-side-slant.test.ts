import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type { SheetCalibration } from '@pages/Generator/lib/calibrate';
import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import { paginate, WRAP_WIDTH_SLACK } from '@pages/Generator/lib/paginate/paginate';
import type {
  PaperFamily,
  PaperSheet,
  RulingSideSlant,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import { buildSheetRuling } from '@pages/Generator/lib/paper';
import { splitParagraphs } from '@pages/Generator/lib/split/splitParagraphs';
import { clearLayoutCache, measureLayout } from '@pages/Generator/model/measureLayout';
import { describe, expect, it } from 'vitest';

import {
  createMonospaceMeasurer,
  createMonospaceMeasurerFactory,
} from './helpers/monospace-measurer';

/**
 * Метрики, на которых геометрия считается в уме: кегль равен шагу
 * разлиновки, подъём бокса — один кегль, шаг строк на линейке — шаг
 * разлиновки.
 */
const METRICS: FontMetrics = { xHeight: 0.55, fontAscent: 1, lineHeight: 1.25 };

const STEP = 40;
const FRAME = { width: 400, height: 400 };

/**
 * Символ модели шириной в половину кегля — 20 px при кегле 40: слово «ab» с
 * пробелом занимает 60 px.
 */
const MEASURER = createMonospaceMeasurer();

/**
 * Лист в линейку без наклона: верхнее поле между верхом кадра и первой линией,
 * первая базовая линия на 40 px, строки через 40 px, девять строк до нижнего
 * поля.
 *
 * @param slant — концы полей у низа кадра; `null` — поля без наклона
 * @returns лист страницы
 */
const buildCalibration = (slant: RulingSideSlant | null): SheetCalibration => {
  const ruling: SheetRuling = buildSheetRuling(
    {
      step: STEP,
      firstLinePhase: STEP,
      skewAngle: 0,
      margins: { top: STEP / 2, right: 20, bottom: 20, left: 200 },
      marginLineX: null,
      marginLineSide: null,
      sideSlant: slant,
    },
    FRAME
  );

  return { ruling, kind: 'lined', ...FRAME };
};

/**
 * Левое поле у верха кадра — 200 px, у низа — 20 px: на первой строке блок
 * 198 px, на девятой — 342 px.
 */
const SLANTED = buildCalibration({ left: 20, right: 20, marginLineX: null });
const VERTICAL = buildCalibration(null);

const TEXT = Array.from({ length: 60 }, () => {
  return 'ab';
}).join(' ');

/**
 * Число слов в строке.
 *
 * @param text — строка
 * @returns число слов
 */
const countWords = (text: string): number => {
  return text.split(' ').length;
};

describe('перенос по месту строки на листе с наклонными полями', () => {
  it('нижние строки вмещают больше слов, чем верхние', () => {
    const [page] = paginate(TEXT, {
      measure: MEASURER,
      metrics: METRICS,
      correction: {},
      bottomMargin: 0,
      getPageSheet: () => {
        return { sheetId: 'slanted', calibration: SLANTED };
      },
    });
    const lines = page?.lines || [];
    const first = lines[0]?.text || '';
    const last = lines.at(-1)?.text || '';

    expect(lines).toHaveLength(9);
    expect(countWords(first)).toBe(3);
    expect(countWords(last)).toBe(5);
  });

  it('каждая строка режется по своей ширине', () => {
    const geometry = deriveGeometry(SLANTED, METRICS);
    const widths = geometry.lineBounds?.widths || [];
    const { lines } = splitParagraphs(TEXT, {
      width: geometry.blockWidth,
      lineWidths: widths,
      fontSizePx: geometry.fontSizePx,
      measure: MEASURER,
      maxLines: 9,
    });

    expect(widths[0]).toBeCloseTo(198, 6);
    expect(widths[8]).toBeCloseTo(342, 6);
    lines.forEach(({ text }, index) => {
      const width = MEASURER.measureWidth(text) * geometry.fontSizePx;
      const room = widths[index] || 0;

      expect(width).toBeLessThanOrEqual(room);
      expect(width + MEASURER.measureWidth(' ab') * geometry.fontSizePx).toBeGreaterThan(
        room * (1 - WRAP_WIDTH_SLACK)
      );
    });
  });

  it('строка начинается на пересечении своей базовой линии с полем', () => {
    const geometry = deriveGeometry(SLANTED, METRICS);
    const offsets = geometry.lineBounds?.offsets || [];

    expect(geometry.leftPadding).toBeCloseTo(182, 6);
    expect(offsets[0]).toBe(0);
    expect(geometry.leftPadding + (offsets[8] || 0)).toBeCloseTo(38, 6);
  });

  it('концы у низа, равные верхним, — прежняя геометрия и прежние переносы', () => {
    const equal = buildCalibration({ left: 200, right: 20, marginLineX: null });

    expect(equal.ruling.sideSlant).toBeNull();
    expect(deriveGeometry(equal, METRICS)).toStrictEqual(
      deriveGeometry(VERTICAL, METRICS)
    );
    expect(deriveGeometry(VERTICAL, METRICS).lineBounds).toBeUndefined();
  });
});

describe('концы полей у низа кадра в ключе раскладки', () => {
  /**
   * Свой лист с одним идентификатором: ключ кэша различает разлиновки только
   * отпечатком, как у листа, поправленного в редакторе.
   *
   * @param calibration — лист страницы
   * @returns семья из одного листа
   */
  const buildFamily = (calibration: SheetCalibration): PaperFamily => {
    const sheet: PaperSheet = {
      id: 'own',
      label: 'Свой лист',
      src: '/paper/own.jpg',
      ...FRAME,
      ruling: calibration.ruling,
      lighting: null,
      texture: null,
    };

    return { id: 'lined', label: 'В линейку', kind: 'lined', sheets: [sheet] };
  };

  it('наклон поля перекладывает страницу, а не берёт её из кэша', () => {
    clearLayoutCache();

    const factory = createMonospaceMeasurerFactory();

    /**
     * Раскладка текста на листе.
     *
     * @param calibration — лист страницы
     * @returns строки первой страницы
     */
    const layOut = (calibration: SheetCalibration) => {
      return measureLayout(
        {
          text: TEXT,
          fontFamily: 'Synthetic',
          metrics: METRICS,
          correction: DEFAULT_GEOMETRY_CORRECTION,
          bottomMargin: 0,
          runSeed: 3,
          family: buildFamily(calibration),
          sheetId: 'own',
          isSheetPinned: true,
        },
        factory.create
      )[0]?.lines;
    };

    expect(layOut(SLANTED)).not.toStrictEqual(layOut(VERTICAL));
  });
});
