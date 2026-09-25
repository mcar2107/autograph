import { paginate } from '../../../../../lib/paginate/paginate';
import type { Page } from '../../../../../lib/paginate/paginate.types';
import type { PaperFamily, PaperSheet } from '../../../../../lib/paper';
import { buildPageTask } from '../../../../../model/buildPageTask';
import { getPageCalibration } from '../../../../../model/geometrySelectors';
import type { PageRenderTask } from '../../../../../model/pageTask.types';

import type { TrialTaskInput } from './buildTrialTask.types';

/**
 * Сколько символов текста идёт в пробную страницу. Страница тетради — пара
 * тысяч знаков; остальной текст на неё не лёг бы, а разбивать его впустую —
 * лишнее время до показа.
 */
const TRIAL_TEXT_LIMIT = 4000;

/**
 * Образец, пока поле ввода пустое: проверять разметку надо и до того, как
 * набран свой текст. Панграмма — все буквы алфавита, и хвосты, и выносные
 * элементы.
 */
const SAMPLE_TEXT = 'Съешь же ещё этих мягких французских булок, да выпей чаю.';

/**
 * Текст пробной страницы: сам текст из поля ввода, а за ним, пока не набран
 * предел, — он же, повторённый одним абзацем.
 *
 * Страница заполняется целиком, потому что проверяется разметка всего листа:
 * у короткого текста строки кончались бы вверху, а сползание строк с линий у
 * нижнего края — перспектива, изгиб, нижнее поле — и осталось бы
 * непроверенным. Повтор — своего текста, а не образца: на странице те же
 * буквы, что уйдут в JPEG. Начало — как набрано, с абзацами, а повтор — одним
 * абзацем: короткие абзацы давали бы короткие строки, и правое поле осталось
 * бы непроверенным.
 *
 * @param text — текст из поля ввода
 * @returns текст пробной страницы не короче предела
 */
const toTrialText = (text: string): string => {
  const source = text.trim() || SAMPLE_TEXT;
  const paragraph = source.replaceAll(/\s+/g, ' ');
  let trial = source;

  if (trial.length < TRIAL_TEXT_LIMIT) {
    trial += '\n';
  }

  while (trial.length < TRIAL_TEXT_LIMIT) {
    trial += `${paragraph} `;
  }

  return trial.slice(0, TRIAL_TEXT_LIMIT);
};

const EMPTY_PAGE: Page = { lines: [] };

/**
 * Лист с черновой разметкой: разлиновка из черновика, а свет и текстура — от
 * перемера по новому контуру, если он был. Так пробная страница — ровно та,
 * что получится после «Сохранить».
 *
 * @param input — лист и черновик
 * @returns лист для отрисовки
 */
const toDraftSheet = (input: TrialTaskInput): PaperSheet => {
  const { record, draft } = input;
  const { remeasure } = draft;
  const sheet = { ...record.sheet, ruling: draft.ruling };

  return remeasure
    ? { ...sheet, lighting: remeasure.lighting, texture: remeasure.texture }
    : sheet;
};

/**
 * Задание воркеру отрисовки на пробную страницу: текст из поля ввода,
 * повторённый до конца страницы и разложенный по черновой разметке листа, теми же шрифтом, чернилами и
 * реализмом, что у страниц прогона, — тем же путём, каким страница уходит в
 * JPEG. Лист стоит в семье из него одного, с видом из черновика: так число
 * шагов на строку — как у листа после сохранения.
 *
 * Зеркальная страница раскладывается так, будто текст начинается на ней, —
 * иначе на ней было бы пусто, пока текст не займёт первую.
 *
 * @param input — лист, черновик и параметры страниц генератора
 * @returns задание на отрисовку в масштабе кадра
 */
export const buildTrialTask = (input: TrialTaskInput): PageRenderTask => {
  const { draft, pageIndex, text, fontFamily, metrics, correction, recipe } = input;
  const sheet = toDraftSheet(input);
  const family: PaperFamily = {
    id: input.record.familyId,
    label: sheet.label,
    kind: draft.kind,
    sheets: [sheet],
    sheetKinds: { [sheet.id]: draft.kind },
  };
  const measure = input.createMeasurer({ fontFamily });
  let page = EMPTY_PAGE;

  try {
    const [first] = paginate(toTrialText(text), {
      measure,
      metrics,
      correction,
      bottomMargin: input.bottomMargin,
      getPageSheet: (index) => {
        return {
          sheetId: sheet.id,
          calibration: getPageCalibration(family, sheet, pageIndex + index),
        };
      },
    });

    page = first || EMPTY_PAGE;
  } finally {
    measure.destroy();
  }

  return buildPageTask({
    page,
    family,
    sheet,
    pageIndex,
    isBackgroundHidden: false,
    metrics,
    correction,
    inkColor: recipe.inkColor,
    fontFamily,
    flags: recipe.flags,
    wordFrequency: recipe.wordFrequency,
    letterFrequency: recipe.letterFrequency,
    seed: recipe.handwritingSeed,
    runSeed: input.runSeed,
    font: input.font,
    quality: recipe.jpegQuality,
  });
};
