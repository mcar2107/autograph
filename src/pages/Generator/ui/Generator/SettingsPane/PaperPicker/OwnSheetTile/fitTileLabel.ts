import { truncateMiddle } from './truncateMiddle';

/**
 * Подпись плитки: имя целиком, если оно встаёт в отведённые строки, иначе —
 * самое длинное, обрезанное с середины, что встаёт. Середина, а не конец:
 * снимки с телефона различаются концом имени.
 *
 * @param label — имя листа
 * @param countLines — сколько строк займёт текст на плитке
 * @param maxLines — сколько строк отведено
 * @returns подпись
 */
export const fitTileLabel = (
  label: string,
  countLines: (text: string) => number,
  maxLines: number
): string => {
  const length = [...label].length;

  for (let kept = length; kept > 1; kept -= 1) {
    const candidate = truncateMiddle(label, kept);

    if (countLines(candidate) <= maxLines) {
      return candidate;
    }
  }

  return truncateMiddle(label, 1);
};
