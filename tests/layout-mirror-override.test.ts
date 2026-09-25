import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import type {
  PaperFamily,
  PaperSheet,
  RulingMirrorOverride,
} from '@pages/Generator/lib/paper';
import { clearLayoutCache, measureLayout } from '@pages/Generator/model/measureLayout';
import type { LayoutParams } from '@pages/Generator/model/measureLayout.types';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';

const METRICS: FontMetrics = { xHeight: 0.55, fontAscent: 1, lineHeight: 1.25 };

const SHEET_WIDTH = 1600;
const SHEET_HEIGHT = 2000;
const SHEET_MARGIN = 100;

/**
 * Поля зеркала заданы заметно шире отражённых: блок правой страницы сужается
 * почти вдвое, и переносы на ней расходятся на первой же длинной строке.
 */
const MIRROR_OVERRIDE: RulingMirrorOverride = {
  marginLineX: 500,
  marginLineSide: 'left',
  marginLeft: 500,
  marginRight: 300,
  sideSlant: null,
};

/**
 * Лист с полями зеркала или без них. Идентификатор один: ключ кэша различает
 * их только отпечатком разлиновки, как у листа, поправленного в редакторе.
 *
 * @param mirrorOverride — поля зеркальной страницы; `null` — отражённые
 * @returns экземпляр листа
 */
const buildSheet = (mirrorOverride: RulingMirrorOverride | null): PaperSheet => {
  return {
    id: 'own',
    label: 'Свой лист',
    src: '/paper/own.jpg',
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    ruling: {
      step: 40,
      firstLinePhase: 60,
      skewAngle: 0,
      margins: {
        top: SHEET_MARGIN,
        right: SHEET_MARGIN,
        bottom: SHEET_MARGIN,
        left: SHEET_MARGIN,
      },
      marginLineX: null,
      marginLineSide: null,
      sideSlant: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride,
    },
    lighting: null,
    texture: null,
  };
};

/**
 * Текст на несколько страниц со строками длиннее узкого блока.
 */
const TEXT = Array.from({ length: 120 }, (_, index) => {
  return `строка номер ${index} достаточно длинная, чтобы узкий блок перенёс её`;
}).join('\n');

/**
 * Параметры раскладки на семье из одного листа.
 *
 * @param sheet — экземпляр листа семьи
 * @returns параметры раскладки
 */
const buildParams = (sheet: PaperSheet): LayoutParams => {
  const family: PaperFamily = {
    id: 'lined',
    label: 'В линейку',
    kind: 'lined',
    sheets: [sheet],
  };

  return {
    text: TEXT,
    fontFamily: 'Synthetic',
    metrics: METRICS,
    correction: DEFAULT_GEOMETRY_CORRECTION,
    bottomMargin: 0,
    runSeed: 3,
    family,
    sheetId: sheet.id,
    isSheetPinned: true,
  };
};

beforeEach(() => {
  clearLayoutCache();
});

describe('поля зеркальной страницы в раскладке', () => {
  it('правка полей зеркала перекладывает правую страницу, левую нет', () => {
    const factory = createMonospaceMeasurerFactory();
    const reflected = measureLayout(buildParams(buildSheet(null)), factory.create);
    const overridden = measureLayout(
      buildParams(buildSheet(MIRROR_OVERRIDE)),
      factory.create
    );

    expect(reflected.length).toBeGreaterThan(2);
    expect(overridden[0]?.lines).toStrictEqual(reflected[0]?.lines);
    expect(overridden[1]?.lines).not.toStrictEqual(reflected[1]?.lines);
  });
});
