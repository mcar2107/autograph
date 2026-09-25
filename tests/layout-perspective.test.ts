import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type { SheetCalibration } from '@pages/Generator/lib/calibrate';
import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import { countPageLines } from '@pages/Generator/lib/paginate/countPageLines';
import type {
  PaperFamily,
  PaperSheet,
  RulingPerspective,
} from '@pages/Generator/lib/paper';
import { lineHeightAt } from '@pages/Generator/lib/paper';
import { clearLayoutCache, measureLayout } from '@pages/Generator/model/measureLayout';
import type { LayoutParams } from '@pages/Generator/model/measureLayout.types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getBaselineY, getLineStep } from './helpers/baseline-model';
import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';

const METRICS: FontMetrics = { xHeight: 0.55, fontAscent: 1, lineHeight: 1.25 };

const RULING_STEP = 40;
const SHEET_WIDTH = 1600;
const SHEET_HEIGHT = 2000;
const SKEW_ANGLE = 0.8;
const SHEET_MARGIN = 100;

/**
 * Фаза выбрана так, что перевод верхнего поля в координату вдоль линий
 * приводит к другой первой линии, чем округление по высоте кадра: иначе
 * проверка прошла бы и на расчёте, который перспективы не видит.
 */
const FIRST_LINE_PHASE = 45;

/**
 * Перспектива: шаг у нижних линий заметно больше, чем у верхних, линии
 * сходятся по ширине. Знаменатель `1 − a·q` по кадру не опускается ниже 0,97 —
 * лист в пределах надёжности измерения.
 */
const PERSPECTIVE: RulingPerspective = {
  originX: SHEET_WIDTH / 2,
  originY: SHEET_HEIGHT / 2,
  convergenceX: 1e-5,
  convergenceY: 1.5e-5,
};

/**
 * Погрешность сравнения пикселей: складываются дробные шаги.
 */
const PX_EPSILON = 1e-6;

/**
 * Лист с перспективой.
 *
 * @param perspective — перспектива разлиновки; `null` — линии через равный шаг
 * @param id — идентификатор экземпляра
 * @returns экземпляр листа
 */
const buildSheet = (perspective: RulingPerspective | null): PaperSheet => {
  return {
    id: 'sloped',
    label: 'Лист со столом',
    src: '/paper/sloped.jpg',
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    ruling: {
      step: RULING_STEP,
      firstLinePhase: FIRST_LINE_PHASE,
      skewAngle: SKEW_ANGLE,
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
      perspective,
      outline: null,
      mirrorOverride: null,
    },
    lighting: null,
    texture: null,
  };
};

const SHEET = buildSheet(PERSPECTIVE);

/**
 * Тот же экземпляр без перспективы: идентификатор у него один с исходным,
 * поэтому ключ раскладки различает их только отпечатком разлиновки.
 */
const FLAT_SHEET = buildSheet(null);

const CALIBRATION: SheetCalibration = {
  ruling: SHEET.ruling,
  kind: 'lined',
  width: SHEET_WIDTH,
  height: SHEET_HEIGHT,
};

const GEOMETRY = deriveGeometry(CALIBRATION, METRICS);
const LINE_STEP = getLineStep(GEOMETRY, METRICS);
const CAPACITY = countPageLines(CALIBRATION, GEOMETRY, METRICS, 0);

/**
 * Номер линии разлиновки, на которой стоит координата вдоль линий.
 *
 * @param u — координата вдоль линий
 * @returns номер линии, дробный
 */
const toLineNumber = (u: number): number => {
  return (u - FIRST_LINE_PHASE) / RULING_STEP;
};

/**
 * Высота базовой линии строки на фотографии у левого края кадра. Раскладка
 * ставит строки в координате вдоль линий, и место строки на снимке — высота
 * линии с этой координатой.
 *
 * @param lineIndex — номер строки от нуля
 * @returns высота в пикселях кадра
 */
const getBaselinePhotoY = (lineIndex: number): number => {
  return lineHeightAt(SHEET.ruling, 0, getBaselineY(GEOMETRY, METRICS, lineIndex));
};

/**
 * Текст на несколько страниц.
 */
const TEXT = Array.from({ length: 80 }, (_, index) => {
  return `строка номер ${index} с переносом по ширине блока листа`;
}).join('\n');

/**
 * Параметры раскладки текста на семье из одного листа.
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
    isSheetPinned: false,
  };
};

beforeEach(() => {
  clearLayoutCache();
});

describe('раскладка на листе с перспективой', () => {
  it('сажает первую строку на линию не выше верхнего поля', () => {
    const firstBaseline = getBaselineY(GEOMETRY, METRICS, 0);
    const { margins } = SHEET.ruling;

    expect(toLineNumber(firstBaseline)).toBeCloseTo(
      Math.round(toLineNumber(firstBaseline)),
      6
    );
    expect(getBaselinePhotoY(0)).toBeGreaterThanOrEqual(margins.top);

    /**
     * Линия выше первой лежит уже над полем: иначе первая строка пропустила бы
     * линию и оставила у верха листа пустую полосу.
     */
    expect(lineHeightAt(SHEET.ruling, 0, firstBaseline - LINE_STEP)).toBeLessThan(
      margins.top
    );

    /**
     * Контроль: округление верхнего поля по высоте кадра, без перевода в
     * координату вдоль линий, даёт другую линию.
     */
    const straightFirstLine =
      FIRST_LINE_PHASE +
      Math.ceil((margins.top - FIRST_LINE_PHASE) / RULING_STEP) * RULING_STEP;

    expect(Math.abs(straightFirstLine - firstBaseline)).toBeGreaterThan(RULING_STEP / 2);
  });

  it('ставит соседние строки на соседние линии по всей высоте страницы', () => {
    const numbers = Array.from({ length: CAPACITY }, (_, lineIndex) => {
      return toLineNumber(getBaselineY(GEOMETRY, METRICS, lineIndex));
    });

    expect(CAPACITY).toBeGreaterThan(10);
    numbers.forEach((number, index) => {
      expect(number).toBeCloseTo(Math.round(numbers[0] || 0) + index, 6);
    });
  });

  it('доводит последнюю строку до нижнего поля и не заводит за него', () => {
    const bottom = SHEET_HEIGHT - SHEET.ruling.margins.bottom;
    const lastBaseline = getBaselineY(GEOMETRY, METRICS, CAPACITY - 1);

    expect(getBaselinePhotoY(CAPACITY - 1)).toBeLessThanOrEqual(bottom + PX_EPSILON);
    expect(lineHeightAt(SHEET.ruling, 0, lastBaseline + LINE_STEP)).toBeGreaterThan(
      bottom
    );
  });

  it('переводит нижнее поле в координату вдоль линий, а не берёт высоту кадра', () => {
    const lineU = getBaselineY(GEOMETRY, METRICS, CAPACITY - 1);
    const linePhotoY = lineHeightAt(SHEET.ruling, 0, lineU);

    /**
     * Нижнее поле ставится на середину расхождения высоты линии на снимке и её
     * координаты вдоль линий: по снимку линия уже ниже поля, а высота поля,
     * взятая как координата, лежит ниже линии. Так вместимость зависит от
     * перевода поля, а не совпадает с прямым расчётом по случайности.
     */
    const bottom = (linePhotoY + lineU) / 2;

    expect(linePhotoY - lineU).toBeGreaterThan(2);

    const calibration: SheetCalibration = {
      ...CALIBRATION,
      ruling: {
        ...SHEET.ruling,
        margins: { ...SHEET.ruling.margins, bottom: SHEET_HEIGHT - bottom },
      },
    };
    const geometry = deriveGeometry(calibration, METRICS);
    const capacity = countPageLines(calibration, geometry, METRICS, 0);
    const lastBaseline = getBaselineY(geometry, METRICS, capacity - 1);

    expect(geometry).toEqual(GEOMETRY);
    expect(lineHeightAt(calibration.ruling, 0, lastBaseline)).toBeLessThanOrEqual(bottom);
    expect(lineHeightAt(calibration.ruling, 0, lastBaseline + LINE_STEP)).toBeGreaterThan(
      bottom
    );

    /**
     * Контроль: без перевода в координату вдоль линий на страницу встала бы ещё
     * одна строка — ниже нижнего поля.
     */
    const straightCapacity =
      Math.floor(
        (bottom - geometry.topOffset - METRICS.fontAscent * geometry.fontSizePx) /
          LINE_STEP
      ) + 1;

    expect(straightCapacity).toBe(capacity + 1);
  });

  it('меняет ключ кэша раскладки вместе с перспективой', () => {
    const factory = createMonospaceMeasurerFactory();
    const sloped = measureLayout(buildParams(SHEET), factory.create);
    const flat = measureLayout(buildParams(FLAT_SHEET), factory.create);

    expect(factory.createCalls()).toBe(2);
    expect(flat).not.toBe(sloped);

    /**
     * Контроль: те же параметры второй раз ничего не измеряют — значит,
     * расхождение выше именно в отпечатке листа, а не в промахе кэша.
     */
    measureLayout(buildParams(SHEET), factory.create);

    expect(factory.createCalls()).toBe(2);
  });
});
