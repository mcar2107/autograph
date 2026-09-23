import type { GeometryCorrection } from '../../../../../lib/calibrate/calibrate.types';
import type { FontMetrics } from '../../../../../lib/measure/measure.types';
import type { MeasurerFactory } from '../../../../../model/measureLayout.types';
import type { PageFontSource } from '../../../../../model/pageTask.types';
import type { PageRecipeValues } from '../../../../../model/recipeSelectors.types';
import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';
import type { UserSheetRecord } from '../../../../../model/userSheetsStorage.types';

/**
 * Всё, из чего собирается пробная страница: лист с черновой разметкой и то,
 * чем генератор рисует страницы.
 */
export type TrialTaskInput = {
  /**
   * Лист, открытый в редакторе.
   */
  record: UserSheetRecord;

  /**
   * Черновик его разметки: по нему раскладывается пробный текст.
   */
  draft: MarkupDraft;

  /**
   * Страница разворота: 0 — сам лист, 1 — зеркальная.
   */
  pageIndex: number;

  /**
   * Текст из поля ввода генератора.
   */
  text: string;

  /**
   * Семейство шрифта страницы.
   */
  fontFamily: string;

  /**
   * Метрики шрифта в долях кегля.
   */
  metrics: FontMetrics;

  /**
   * Ручная поправка геометрии в долях шага.
   */
  correction: GeometryCorrection;

  /**
   * Запас снизу в долях шага.
   */
  bottomMargin: number;

  /**
   * Seed прогона: из него выводится синтетическое освещение листа.
   */
  runSeed: number;

  /**
   * Чернила и почерк из рецепта прогона — те же, что у страниц.
   */
  recipe: PageRecipeValues;

  /**
   * Шрифт страницы для воркера. `null` — контуров нет.
   */
  font: PageFontSource | null;

  /**
   * Чем измерять строки.
   */
  createMeasurer: MeasurerFactory;
};
