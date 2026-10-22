/**
 * Цифровой хвост подписи и то, что перед ним. После пробела перенос и так
 * возможен.
 */
const DIGIT_TAIL_PATTERN = /^(.*?[^\d\s_])(\d+)$/su;

/**
 * Подпись по кускам, между которыми строка может переноситься: после
 * каждого «_» и перед цифровым хвостом. Имя снимка с телефона — одно слово,
 * и перенос по любому знаку разрезал бы номер снимка («IMG_181 / 3»), а
 * номер и различает соседние снимки. Кусок, которому строки мало, браузер
 * всё равно переносит по знакам.
 *
 * @param text — подпись
 * @returns куски подряд; склеенные — подпись
 */
export const splitLabelBreaks = (text: string): string[] => {
  const parts = text.split(/(?<=_)/u);
  const last = parts.at(-1) || '';
  const tail = DIGIT_TAIL_PATTERN.exec(last);

  if (!tail) {
    return parts;
  }

  const [, head = '', digits = ''] = tail;

  return [...parts.slice(0, -1), head, digits];
};
