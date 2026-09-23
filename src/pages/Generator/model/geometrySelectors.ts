import type { BlockGeometry, SheetCalibration } from '../lib/calibrate/calibrate.types';
import { deriveGeometry } from '../lib/calibrate/deriveGeometry';
import type { FontMetrics } from '../lib/measure/measure.types';
import { mirrorSheetRuling } from '../lib/paper/mirrorSheetRuling';
import type { PaperFamily, PaperSheet, SheetRuling } from '../lib/paper/paper.types';

import { isMirroredPage } from './buildPageRenderParams';
import type { GeneratorState } from './generator.types';
import { findSheet, selectActiveFamily } from './paperSelectors';
import { selectPageSheetId } from './recipeSelectors';

/**
 * Разлиновка страницы: разлиновка её листа, на чётной странице — отражённая.
 * Единственное место, где разлиновка зависит от чётности: раскладка и
 * отрисовка берут её отсюда и сами по чётности не ветвятся, иначе на
 * наклонном листе вместимость страницы разошлась бы с отрисовкой.
 *
 * @param sheet — лист, доставшийся странице
 * @param pageIndex — номер страницы, считая с нуля
 * @returns разлиновка в пикселях кадра листа
 */
export const getPageRuling = (sheet: PaperSheet, pageIndex: number): SheetRuling => {
  return isMirroredPage(pageIndex)
    ? mirrorSheetRuling(sheet.ruling, sheet)
    : sheet.ruling;
};

/**
 * Лист страницы в том виде, в каком по нему считается геометрия.
 *
 * Вид разлиновки — у листа: у своего листа он свой, у пресета — семейный.
 * Чистый свой лист лежит в семье клетки или линейки, и вид семьи удвоил бы на
 * нём строку в клетке.
 *
 * @param family — семья листов: из неё берётся вид разлиновки листа
 * @param sheet — лист, доставшийся странице
 * @param pageIndex — номер страницы, считая с нуля
 * @returns разлиновка страницы и кадр её листа
 */
export const getPageCalibration = (
  family: PaperFamily,
  sheet: PaperSheet,
  pageIndex: number
): SheetCalibration => {
  return {
    ruling: getPageRuling(sheet, pageIndex),
    kind: family.sheetKinds?.[sheet.id] || family.kind,
    width: sheet.width,
    height: sheet.height,
  };
};

/**
 * Лист страницы, по которому считается её геометрия: тот, что достался
 * странице по рецепту прогона, а не выбранный в панели.
 *
 * @param state — состояние генератора
 * @param pageIndex — номер страницы, считая с нуля
 * @returns разлиновка страницы и кадр; `null` — семьи или листов нет
 */
export const selectCalibrationRuling = (
  state: GeneratorState,
  pageIndex: number
): SheetCalibration | null => {
  const family = selectActiveFamily(state);
  const sheet = family
    ? findSheet(family, selectPageSheetId(state, pageIndex))
    : undefined;

  if (!family || !sheet) {
    return null;
  }

  return getPageCalibration(family, sheet, pageIndex);
};

/**
 * Итоговая геометрия блока страницы: вычисленная из разлиновки её листа и
 * метрик шрифта, со сложенной поверх ручной поправкой. Поправка задана
 * дельтами в долях шага, поэтому на листах с разным шагом она сдвигает текст
 * на одну и ту же долю строки.
 *
 * @param state — состояние генератора
 * @param pageIndex — номер страницы, считая с нуля
 * @param metrics — метрики выбранного шрифта в долях кегля
 * @returns геометрия блока в пикселях кадра листа; `null` — считать не по чему
 */
export const selectBlockGeometry = (
  state: GeneratorState,
  pageIndex: number,
  metrics: FontMetrics
): BlockGeometry | null => {
  const calibration = selectCalibrationRuling(state, pageIndex);

  if (!calibration) {
    return null;
  }

  return deriveGeometry(calibration, metrics, state.geometryCorrection);
};

/**
 * Угол, на который наклонён блок текста страницы: наклон её разлиновки.
 * Фотография не выправляется, вдоль её наклона выкладывается текст; на
 * чётной странице наклон отражён вместе с листом.
 *
 * @param state — состояние генератора
 * @param pageIndex — номер страницы, считая с нуля
 * @returns угол в градусах; ноль — листа нет или он снят ровно
 */
export const selectBlockSkewAngle = (
  state: GeneratorState,
  pageIndex: number
): number => {
  return selectCalibrationRuling(state, pageIndex)?.ruling.skewAngle || 0;
};
