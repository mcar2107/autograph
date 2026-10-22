import { deriveGeometry } from '../calibrate/deriveGeometry';
import { splitParagraphs } from '../split/splitParagraphs';

import { countPageLines } from './countPageLines';
import type { LayoutPage, PaginateOptions } from './paginate.types';

/**
 * Доля ширины блока, которую разбивка оставляет в запас. Ширина строки
 * меряется в долях кегля и переводится в пиксели умножением на кегль страницы,
 * а Linux Chromium раскладывает строку целыми пикселями: там она выходит шире
 * такого пересчёта до 0,9 %. Процент запаса держит строку внутри блока в любом
 * браузере. Края блока и его отступы от полей не двигаются — сужается только
 * ширина, по которой режутся строки.
 */
export const WRAP_WIDTH_SLACK = 0.01;

/**
 * Раскладывает текст по страницам последовательно: каждая страница набирается
 * под лист, доставшийся ей, — своей шириной блока, своим кеглем и своей
 * вместимостью, а остаток текста переходит на следующую страницу. На листе с
 * наклонными полями у каждой строки своя ширина — по её месту на листе. Строки
 * всех страниц по порядку складываются в исходный текст без потерь и повторов.
 *
 * Страница, на которую по формуле не помещается ни одной строки, всё равно
 * берёт одну: иначе разбивка топталась бы на месте.
 *
 * Пустой текст даёт одну страницу — генератор всегда показывает лист.
 *
 * @param text — исходный текст
 * @param options — измеритель, метрики, поправка, запас снизу и листы страниц
 * @returns страницы со строками и листом каждой
 */
export const paginate = (text: string, options: PaginateOptions): LayoutPage[] => {
  const { measure, metrics, correction, bottomMargin, getPageSheet } = options;
  const pages: LayoutPage[] = [];
  let position = 0;

  while (position <= text.length) {
    const { sheetId, calibration } = getPageSheet(pages.length);
    const geometry = deriveGeometry(calibration, metrics, correction);
    /**
     * `NaN` получается, когда и высота под текст, и шаг строк нулевые: строк
     * по формуле нет — берём одну.
     */
    const capacity = countPageLines(calibration, geometry, metrics, bottomMargin) || 0;
    const { lines, end } = splitParagraphs(text, {
      width: geometry.blockWidth * (1 - WRAP_WIDTH_SLACK),
      ...(geometry.lineBounds && {
        lineWidths: geometry.lineBounds.widths.map((width) => {
          return width * (1 - WRAP_WIDTH_SLACK);
        }),
      }),
      fontSizePx: geometry.fontSizePx,
      measure,
      start: position,
      maxLines: Math.max(1, capacity),
    });

    pages.push({ sheetId, lines });
    position = end;
  }

  return pages;
};
