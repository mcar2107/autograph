import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import type { PaperFamily, PaperSheet, RulingBend } from '@pages/Generator/lib/paper';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache, measureLayout } from '@pages/Generator/model/measureLayout';
import type { LayoutParams } from '@pages/Generator/model/measureLayout.types';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';

const METRICS: FontMetrics = { xHeight: 0.55, fontAscent: 1, lineHeight: 1.25 };

/**
 * Изгиб заметный — до трети шага, — чтобы влияние на разбивку, будь оно, не
 * потерялось в округлении.
 */
const BEND: RulingBend = {
  columnOrigin: 60,
  columnSpacing: 120,
  columnCount: 5,
  rowOrigin: 40,
  rowSpacing: 400,
  rowCount: 2,
  offsets: [0, 12.5, -8, 10, 0, 3, -13.25, 6, 0, -2],
};

/**
 * Два экземпляра с разным шагом и полями: раздача листов по страницам тоже
 * участвует в разбивке.
 */
const BENT_SHEETS: PaperSheet[] = [
  {
    id: 'first',
    label: 'Первый',
    src: '/paper/first.jpg',
    width: 600,
    height: 800,
    ruling: {
      step: 40,
      firstLinePhase: 40,
      skewAngle: 0.6,
      margins: { top: 80, right: 60, bottom: 60, left: 60 },
      marginLineX: null,
      marginLineSide: null,
      sideSlant: null,
      bend: BEND,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
    lighting: null,
    texture: null,
  },
  {
    id: 'second',
    label: 'Второй',
    src: '/paper/second.jpg',
    width: 620,
    height: 780,
    ruling: {
      step: 36,
      firstLinePhase: 30,
      skewAngle: -0.9,
      margins: { top: 70, right: 50, bottom: 50, left: 90 },
      marginLineX: 80,
      marginLineSide: 'left',
      sideSlant: null,
      bend: { ...BEND, offsets: [...BEND.offsets].reverse() },
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
    lighting: null,
    texture: null,
  },
];

/**
 * Семья из тех же листов, но без изгиба.
 *
 * @param sheets — листы семьи
 * @returns семья в линейку
 */
const buildFamily = (sheets: PaperSheet[]): PaperFamily => {
  return { id: 'lined', label: 'В линейку', kind: 'lined', sheets };
};

const BENT_FAMILY = buildFamily(BENT_SHEETS);
const FLAT_FAMILY = buildFamily(
  BENT_SHEETS.map((sheet) => {
    return { ...sheet, ruling: { ...sheet.ruling, bend: null } };
  })
);

/**
 * Текст на несколько страниц: в разбивку попадают и нечётные, и зеркальные.
 */
const TEXT = Array.from({ length: 60 }, (_, index) => {
  return `строка номер ${index} с переносом по ширине блока листа`;
}).join('\n');

const MIN_PAGES = 3;

/**
 * Параметры раскладки текста на семье.
 *
 * @param family — семья листов
 * @returns параметры раскладки
 */
const buildParams = (family: PaperFamily): LayoutParams => {
  return {
    text: TEXT,
    fontFamily: 'Synthetic',
    metrics: METRICS,
    correction: DEFAULT_GEOMETRY_CORRECTION,
    bottomMargin: 0.5,
    runSeed: 3,
    family,
    sheetId: 'first',
    isSheetPinned: false,
  };
};

beforeEach(() => {
  clearLayoutCache();
});

describe('изгиб и раскладка', () => {
  it('разбивает текст на те же страницы, что и без изгиба', () => {
    const { create } = createMonospaceMeasurerFactory();
    const bent = measureLayout(buildParams(BENT_FAMILY), create);

    clearLayoutCache();

    const flat = measureLayout(buildParams(FLAT_FAMILY), create);

    expect(bent.length).toBeGreaterThanOrEqual(MIN_PAGES);
    expect(bent).toEqual(flat);
  });

  it('выводит ту же геометрию блока на нечётной и зеркальной странице', () => {
    BENT_SHEETS.forEach((sheet, index) => {
      const flatSheet = FLAT_FAMILY.sheets[index] || sheet;

      [0, 1].forEach((pageIndex) => {
        expect(
          deriveGeometry(getPageCalibration(BENT_FAMILY, sheet, pageIndex), METRICS)
        ).toEqual(
          deriveGeometry(getPageCalibration(FLAT_FAMILY, flatSheet, pageIndex), METRICS)
        );
      });
    });
  });

  it('не меняет отпечаток кэша раскладки', () => {
    const factory = createMonospaceMeasurerFactory();
    const bent = measureLayout(buildParams(BENT_FAMILY), factory.create);
    const flat = measureLayout(buildParams(FLAT_FAMILY), factory.create);

    expect(flat).toBe(bent);
    expect(factory.createCalls()).toBe(1);

    /**
     * Контроль: правка прямой разлиновки ключ меняет, и совпадение выше — не
     * кэш, который не видит листов вовсе.
     */
    const restepped = buildFamily(
      BENT_SHEETS.map((sheet, index) => {
        return index === 0 ? { ...sheet, ruling: { ...sheet.ruling, step: 42 } } : sheet;
      })
    );

    measureLayout(buildParams(restepped), factory.create);

    expect(factory.createCalls()).toBe(2);
  });
});
