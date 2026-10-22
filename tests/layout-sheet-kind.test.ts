import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import type { PaperFamily, PaperSheet, RulingKind } from '@pages/Generator/lib/paper';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import { clearLayoutCache, measureLayout } from '@pages/Generator/model/measureLayout';
import type { LayoutParams } from '@pages/Generator/model/measureLayout.types';
import { mergeFamilySheets } from '@pages/Generator/model/paperSelectors';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

const METRICS: FontMetrics = { xHeight: 0.55, fontAscent: 1, lineHeight: 1.25 };

/**
 * Лист 1600×2000 с шагом 40 px и полями по 100 px.
 *
 * @param id — идентификатор листа
 * @returns лист
 */
const buildSheet = (id: string): PaperSheet => {
  return {
    id,
    label: id,
    src: `/paper/${id}.jpg`,
    width: 1600,
    height: 2000,
    ruling: {
      step: 40,
      firstLinePhase: 60,
      skewAngle: 0,
      margins: { top: 100, right: 100, bottom: 100, left: 100 },
      marginLineX: null,
      marginLineSide: null,
      sideSlant: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
    lighting: null,
    texture: null,
  };
};

const PRESET_SHEET = buildSheet('preset');

const OWN_SHEET = buildSheet('own');

const GRID_FAMILY: PaperFamily = {
  id: 'grid',
  label: 'В клетку',
  kind: 'grid',
  sheets: [PRESET_SHEET],
};

/**
 * Семья клетки со своим листом заданного вида.
 *
 * @param kind — вид своего листа
 * @returns семья с пресетом и своим листом
 */
const buildFamily = (kind: RulingKind): PaperFamily => {
  const record = buildUserSheetRecord({ familyId: 'grid', sheet: OWN_SHEET, kind });
  const [family] = mergeFamilySheets([GRID_FAMILY], [record]);

  if (!family) {
    throw new Error('Семьи нет');
  }

  return family;
};

const TEXT = Array.from({ length: 200 }, (_, index) => {
  return `строка ${index}`;
}).join('\n');

/**
 * Параметры раскладки по своему листу, закреплённому на всех страницах.
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
    bottomMargin: 0,
    runSeed: 3,
    family,
    sheetId: OWN_SHEET.id,
    isSheetPinned: true,
  };
};

beforeEach(() => {
  clearLayoutCache();
});

describe('число шагов на строку — по виду листа', () => {
  it('чистый свой лист в семье клетки — строка в один шаг, пресет семьи — в два', () => {
    const family = buildFamily('blank');

    expect(getPageCalibration(family, OWN_SHEET, 0).kind).toBe('blank');
    expect(getPageCalibration(family, PRESET_SHEET, 0).kind).toBe('grid');
    expect(getPageCalibration(GRID_FAMILY, PRESET_SHEET, 0).kind).toBe('grid');
  });

  it('смена вида своего листа перекладывает страницы: чистый лист вмещает вдвое больше строк', () => {
    const factory = createMonospaceMeasurerFactory();
    const grid = measureLayout(buildParams(buildFamily('grid')), factory.create);
    const blank = measureLayout(buildParams(buildFamily('blank')), factory.create);
    const gridRows = grid[0]?.lines.length || 0;
    const blankRows = blank[0]?.lines.length || 0;

    expect(gridRows).toBeGreaterThan(10);
    expect(blankRows).toBeGreaterThanOrEqual(gridRows * 2 - 1);
    expect(blank.length).toBeLessThan(grid.length);
  });
});
