import { truncateMiddle } from './truncateMiddle';

/**
 * Подпись плитки: имя целиком, если оно встаёт в отведённые строки, иначе —
 * самое длинное, обрезанное с середины, что встаёт. Середина, а не конец:
 * снимки с телефона различаются концом имени.
 *
 * Длина ищется делением пополам: каждый замер — раскладка пробного элемента
 * браузером, и перебор по знаку у длинного имени стоил бы десятков раскладок
 * на плитку. Строк у более короткой обрезки не больше, чем у длинной.
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
  if (countLines(label) <= maxLines) {
    return label;
  }

  /**
   * Длина, которая точно встаёт (одно многоточие — последнее, что остаётся),
   * и длина, которая точно не встаёт.
   */
  let fits = 1;
  let overflows = [...label].length;

  while (overflows - fits > 1) {
    const middle = Math.floor((fits + overflows) / 2);

    if (countLines(truncateMiddle(label, middle)) <= maxLines) {
      fits = middle;
    } else {
      overflows = middle;
    }
  }

  return truncateMiddle(label, fits);
};
