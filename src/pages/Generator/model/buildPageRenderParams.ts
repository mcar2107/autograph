import { SUBSTITUTE_FONTS } from '../config';
import { deriveGeometry } from '../lib/calibrate/deriveGeometry';
import type { Page } from '../lib/paginate/paginate.types';
import { buildDistortions } from '../lib/randomize/buildDistortions';
import { buildLineDistortions } from '../lib/randomize/buildLineDistortions';
import type { LineDistortion, WordDistortion } from '../lib/randomize/randomize.types';
import type { PageRenderParams, RenderLine, RenderPage } from '../lib/render';

import type { PageRenderInput } from './pageRender.types';

/**
 * Пустые искажения: нужны, когда слов или строк на странице больше, чем
 * описаний, — например, пока не досчиталась разбивка.
 */
const NO_WORD_DISTORTION: WordDistortion = {
  rotate: 0,
  skew: 0,
  translateY: 0,
  letters: [],
};
const NO_LINE_DISTORTION: LineDistortion = { rotate: 0, translateX: 0 };

/**
 * Шаг seed между соседними словами страницы. С запасом больше, чем шаг между
 * буквами внутри слова: иначе seed последних букв длинного слова совпали бы с
 * seed первых букв следующего, и два соседних слова написались бы одной рукой
 * посимвольно.
 */
const WORD_SEED_STEP = 1_000_003;

/**
 * Чётная по пользовательской нумерации страница — правая половина разворота.
 * Нумерация для пользователя начинается с единицы, поэтому чётной оказывается
 * нечётная позиция в массиве.
 *
 * @param pageIndex — номер страницы, считая с нуля
 * @returns отражается ли страница
 */
export const isMirroredPage = (pageIndex: number): boolean => {
  return (pageIndex + 1) % 2 === 0;
};

/**
 * Номер страницы, которая действительно показывается. Номер в сторе обгоняет
 * раскладку, пока она не пересчитана под укоротившийся текст: тогда
 * показывается первая страница. Предпросмотр и сохранение берут номер отсюда,
 * иначе сохранилась бы не та страница, что на экране.
 *
 * @param pageIndex — номер страницы в сторе, считая с нуля
 * @param pageCount — число страниц раскладки
 * @returns номер показанной страницы, считая с нуля
 */
export const resolveShownPageIndex = (pageIndex: number, pageCount: number): number => {
  return pageIndex < pageCount ? pageIndex : 0;
};

/**
 * Слова страницы построчно. Пустая строка между абзацами остаётся пустым
 * списком: она ничего не рисует, но занимает свою высоту.
 *
 * @param page — страница с посчитанной раскладкой
 * @returns слова каждой строки в порядке отрисовки
 */
const splitLineWords = (page: Page): string[][] => {
  return page.lines.map(({ text }) => {
    return text ? text.split(' ') : [];
  });
};

/**
 * Собирает страницу для рендерера: слова и строки со своими искажениями.
 *
 * @param page — страница с посчитанной раскладкой
 * @param input — параметры искажений почерка
 * @returns страница, готовая к отрисовке
 */
const buildRenderPage = (page: Page, input: PageRenderInput): RenderPage => {
  const { flags, wordFrequency, letterFrequency, seed } = input;
  const lineWords = splitLineWords(page);
  const wordDistortions = buildDistortions(lineWords.flat(), {
    flags,
    wordFrequency,
    letterFrequency,
    seed,
    substituteFonts: SUBSTITUTE_FONTS,
  });
  const lineDistortions = buildLineDistortions(page.lines.length, { flags, seed });
  const lines: RenderLine[] = [];
  let wordOffset = 0;

  lineWords.forEach((words, lineIndex) => {
    lines.push({
      words: words.map((text, index) => {
        return {
          text,
          distortion: wordDistortions[wordOffset + index] || NO_WORD_DISTORTION,
          seed: seed + (wordOffset + index) * WORD_SEED_STEP,
        };
      }),
      distortion: lineDistortions[lineIndex] || NO_LINE_DISTORTION,
    });
    wordOffset += words.length;
  });

  return { lines };
};

/**
 * Собирает параметры отрисовки страницы из состояния генератора и посчитанной
 * раскладки.
 *
 * Кегль сюда приходит уже в пикселях: em — единица DOM, и живёт она только на
 * границе с измерителем текста, а рендереру нужны пиксели страницы.
 *
 * Геометрия блока выводится из разлиновки страницы тем же расчётом, которым
 * страницу раскладывает `lib/paginate`: разойдись они — переносы посчитались бы
 * по одной ширине блока, а отрисовались по другой. На чётной странице
 * разлиновка приходит уже отражённой (`model/geometrySelectors.ts`), поэтому
 * отступ от перенесённой линии поля и сдвиг наклонных линий выходят из неё
 * сами. Блок наклоняется на угол той же разлиновки: фотография не
 * выправляется, текст выкладывается вдоль её наклона. Изгиб линий берётся из
 * неё же и на чётной странице отражён вместе с фотографией.
 *
 * Страница равна кадру листа, и фотография ложится на неё целиком — от угла до
 * угла, без масштаба и сдвига.
 *
 * @param input — раскладка страницы, разлиновка её листа и разрешение
 * @returns параметры отрисовки страницы
 */
export const buildPageRenderParams = (input: PageRenderInput): PageRenderParams => {
  const { page, calibration, sheetImage, metrics, correction, scale } = input;
  const geometry = deriveGeometry(calibration, metrics, correction);

  return {
    page: buildRenderPage(page, input),
    background: sheetImage
      ? { image: sheetImage, width: calibration.width, height: calibration.height }
      : null,
    inkColor: input.inkColor,
    ink: input.ink,
    glyphs: input.glyphs,
    fontFamily: input.fontFamily,
    geometry: {
      fontSizePx: geometry.fontSizePx,
      lineSpacing: geometry.lineSpacing,
      topOffset: geometry.topOffset,
      leftPadding: geometry.leftPadding,
      blockWidth: geometry.blockWidth,
      ...(geometry.lineBounds && { lineBounds: geometry.lineBounds }),
      blockRotate: calibration.ruling.skewAngle,
      fontMetrics: metrics,
      bend: calibration.ruling.bend,
      perspective: calibration.ruling.perspective,
    },
    scale,
  };
};
