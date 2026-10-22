import { createDomMeasurer } from '../lib/measure/createDomMeasurer';
import { paginate } from '../lib/paginate/paginate';
import type { LayoutPage, PageSheet } from '../lib/paginate/paginate.types';
import type { PaperSheet } from '../lib/paper/paper.types';

import { getPageCalibration } from './geometrySelectors';
import type { LayoutParams, MeasurerFactory } from './measureLayout.types';
import { findSheet, resolveSheetKind } from './paperSelectors';
import { buildPageSheetSequence } from './recipeSelectors';

/**
 * Кэш раскладки. Обращение к DOM-измерителю — не «дорогое вычисление в
 * рендере», а работа с настоящим layout: React Compiler такое не мемоизирует,
 * держим кэш явно.
 */
const layouts = new Map<string, LayoutPage[]>();

/**
 * Сколько раскладок держим. Пользователь возит слайдер туда-сюда, и без предела
 * кэш растёт на каждое промежуточное значение.
 */
const MAX_CACHED_LAYOUTS = 50;

/**
 * Отпечаток листа: всё, от чего зависит набор страницы на нём. Кадр входит
 * наравне с разлиновкой: по высоте считается вместимость, по ширине — правый
 * край блока и отражение на зеркальной странице.
 *
 * @param sheet — экземпляр листа семьи
 * @returns значения, по которым листы сравниваются в ключе
 */
const toSheetFingerprint = (sheet: PaperSheet): unknown[] => {
  const { id, width, height, ruling } = sheet;
  const {
    step,
    firstLinePhase,
    skewAngle,
    margins,
    marginLineX,
    marginLineSide,
    sideSlant,
    perspective,
    mirrorOverride,
  } = ruling;

  return [
    id,
    width,
    height,
    step,
    firstLinePhase,
    skewAngle,
    margins.top,
    margins.right,
    margins.bottom,
    margins.left,
    marginLineX,
    marginLineSide,
    /**
     * Концы полей у низа кадра меняют ширину каждой строки, а с ней и
     * переносы.
     */
    sideSlant && [sideSlant.left, sideSlant.right, sideSlant.marginLineX],
    /**
     * Перспектива входит четырьмя числами: от неё зависят первая линия и
     * вместимость страницы. Изгиб и контур не входят — изгиб на разбивку не
     * влияет вовсе, а контур влияет только через поля, и они уже здесь.
     */
    perspective && [
      perspective.originX,
      perspective.originY,
      perspective.convergenceX,
      perspective.convergenceY,
    ],
    /**
     * Поля зеркала меняют блок правой страницы разворота, а идентификатор
     * листа при их правке прежний.
     */
    mirrorOverride && [
      mirrorOverride.marginLineX,
      mirrorOverride.marginLineSide,
      mirrorOverride.marginLeft,
      mirrorOverride.marginRight,
      mirrorOverride.sideSlant && [
        mirrorOverride.sideSlant.left,
        mirrorOverride.sideSlant.right,
        mirrorOverride.sideSlant.marginLineX,
      ],
    ],
  ];
};

/**
 * Ключ раскладки. Раскладка зависит от всей раздачи листов, поэтому в ключ
 * идут seed прогона и отпечаток каждого листа семьи: свой лист, подмешанный в
 * семью, сдвигает раздачу, а правка разлиновки листа не меняет его
 * идентификатор. Вид листа входит отдельно от семейного: смена вида своего
 * листа меняет число шагов на строку, не трогая ни семью, ни разлиновку.
 * Закреплённый лист входит только закреплённым — иначе выбор в панели на
 * раздачу не влияет.
 *
 * Поправка и метрики перечислены поимённо, а не сериализованы объектами:
 * порядок ключей объекта от истории правок не зависит, и отсутствующая дельта
 * совпадает с нулевой.
 *
 * @param params — параметры раскладки
 * @returns строковый ключ кэша
 */
const buildKey = (params: LayoutParams): string => {
  const {
    text,
    fontFamily,
    metrics,
    correction,
    bottomMargin,
    runSeed,
    family,
    sheetId,
    isSheetPinned,
  } = params;

  return JSON.stringify([
    text,
    fontFamily,
    metrics.xHeight,
    metrics.fontAscent,
    metrics.lineHeight,
    correction.fontSizePx || 0,
    correction.lineSpacing || 0,
    correction.topOffset || 0,
    correction.leftPadding || 0,
    correction.blockWidth || 0,
    bottomMargin,
    runSeed,
    family.id,
    family.kind,
    family.sheets.map(toSheetFingerprint),
    family.sheets.map(({ id }) => {
      return resolveSheetKind(family, id);
    }),
    isSheetPinned ? sheetId : null,
  ]);
};

/**
 * Листы страниц для разбивки: лист из раздачи прогона и разлиновка страницы по
 * нему — на зеркальной странице отражённая.
 *
 * @param params — параметры раскладки
 * @returns лист страницы по её номеру
 */
const createPageSheetSource = (
  params: LayoutParams
): ((pageIndex: number) => PageSheet) => {
  const { family } = params;
  const sheetIdAt = buildPageSheetSequence(params, family);

  return (pageIndex) => {
    const sheet = findSheet(family, sheetIdAt(pageIndex));

    if (!sheet) {
      throw new Error('Семья листов пуста: раскладывать текст не по чему');
    }

    return {
      sheetId: sheet.id,
      calibration: getPageCalibration(family, sheet, pageIndex),
    };
  };
};

/**
 * Раскладывает текст по страницам прогона: каждая страница набирается под
 * лист, доставшийся ей. Повторный вызов с теми же параметрами отдаёт готовый
 * результат и ничего не измеряет.
 *
 * @param params — текст, шрифт, геометрия и раздача листов
 * @param createMeasurer — чем измерять; в тестах подставляется модель
 * @returns страницы со строками и листом каждой
 */
export const measureLayout = (
  params: LayoutParams,
  createMeasurer: MeasurerFactory = createDomMeasurer
): LayoutPage[] => {
  const key = buildKey(params);
  const cached = layouts.get(key);

  if (cached) {
    return cached;
  }

  const { text, fontFamily, metrics, correction, bottomMargin } = params;
  const measure = createMeasurer({ fontFamily });

  try {
    const pages = paginate(text, {
      measure,
      metrics,
      correction,
      bottomMargin,
      getPageSheet: createPageSheetSource(params),
    });

    if (layouts.size >= MAX_CACHED_LAYOUTS) {
      const [oldestKey] = layouts.keys();

      if (oldestKey !== undefined) {
        layouts.delete(oldestKey);
      }
    }

    layouts.set(key, pages);

    return pages;
  } finally {
    measure.destroy();
  }
};

/**
 * Сбрасывает кэш раскладки: нужен тестам и смене загруженного шрифта, когда под
 * тем же именем семейства оказывается другое начертание.
 */
export const clearLayoutCache = (): void => {
  layouts.clear();
};
