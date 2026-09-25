import type {
  Line,
  SplitParagraphsOptions,
  SplitParagraphsResult,
} from './splitParagraphs.types';

/**
 * Разделитель абзацев исходного текста.
 */
const PARAGRAPH_BREAK = '\n';

/**
 * Слово — всё между пробельными символами. Перевод строки тоже пробельный,
 * поэтому слово никогда не переходит через границу абзаца.
 */
const WORD_PATTERN = /\S+/g;

/**
 * Номер абзаца, в котором лежит позиция: сколько переводов строки стоит до
 * неё.
 *
 * @param text — исходный текст
 * @param position — позиция в тексте
 * @returns номер абзаца, считая с нуля
 */
const countParagraphBreaks = (text: string, position: number): number => {
  let count = 0;
  let breakIndex = text.indexOf(PARAGRAPH_BREAK);

  while (breakIndex !== -1 && breakIndex < position) {
    count += 1;
    breakIndex = text.indexOf(PARAGRAPH_BREAK, breakIndex + 1);
  }

  return count;
};

/**
 * Разбивает текст на строки: абзацы — по переводам строк, каждый абзац — жадно
 * по ширине блока, а если заданы ширины строк — по ширине своей строки. Слово добавляется в строку, пока она помещается; слово,
 * которое не помещается целиком, занимает отдельную строку — переносов внутри
 * слова генератор не делает. Пустой абзац даёт пустую строку, чтобы отбивка
 * между абзацами сохранилась в отрисовке.
 *
 * Разбивку можно продолжать: вызов набирает не больше `maxLines` строк с
 * позиции `start` и отдаёт позицию, где остановился. Правило на разрыве одно:
 * разрыв внутри абзаца поглощает пробелы между словами — продолжение начнётся
 * с первой буквы следующего слова; конец абзаца поглощает его перевод строки —
 * продолжение начнётся со следующего абзаца. За последним абзацем стоит мнимый
 * перевод строки, поэтому разобранный целиком текст отдаёт позицию за своим
 * концом, а пустой абзац в конце текста не теряется.
 *
 * Строки, набранные по частям, совпадают со строками разбивки целиком при той
 * же ширине: решение о переносе зависит только от текущей строки.
 *
 * @param text — исходный текст
 * @param options — ширина блока, кегль, измеритель, позиция старта и предел строк
 * @returns строки и позиция, с которой продолжать
 */
export const splitParagraphs = (
  text: string,
  options: SplitParagraphsOptions
): SplitParagraphsResult => {
  const {
    width,
    lineWidths,
    fontSizePx,
    measure,
    start = 0,
    maxLines = Number.POSITIVE_INFINITY,
  } = options;
  const lines: Line[] = [];

  /**
   * Ширина строки, которая набирается сейчас. `??`, а не `||`: нулевая ширина
   * у строки, где поля сошлись, — настоящая ширина, а не её отсутствие.
   *
   * @returns ширина, px
   */
  const readLineWidth = (): number => {
    if (!lineWidths || lineWidths.length === 0) {
      return width;
    }

    return lineWidths[Math.min(lines.length, lineWidths.length - 1)] ?? width;
  };

  let position = start;
  let paragraphIndex = countParagraphBreaks(text, start);

  while (position <= text.length && lines.length < maxLines) {
    const breakIndex = text.indexOf(PARAGRAPH_BREAK, position);
    const paragraphEnd = breakIndex === -1 ? text.length : breakIndex;
    const words = text.slice(position, paragraphEnd).matchAll(WORD_PATTERN);
    let current = '';

    for (const match of words) {
      const [word] = match;
      const candidate = current ? `${current} ${word}` : word;

      if (!current || measure.measureWidth(candidate) * fontSizePx <= readLineWidth()) {
        current = candidate;

        continue;
      }

      lines.push({ text: current, paragraphIndex });

      if (lines.length >= maxLines) {
        return { lines, end: position + match.index };
      }

      current = word;
    }

    lines.push({ text: current, paragraphIndex });
    position = paragraphEnd + 1;
    paragraphIndex += 1;
  }

  return { lines, end: position };
};
