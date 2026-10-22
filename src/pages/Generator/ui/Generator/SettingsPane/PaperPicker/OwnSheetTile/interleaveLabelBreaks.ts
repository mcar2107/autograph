import { splitLabelBreaks } from './splitLabelBreaks';

/**
 * Подпись кусками с точкой переноса между соседними: одна раскладка и для
 * плитки, и для пробного элемента замера строк. Разойдись они в точках
 * переноса — замер подбирал бы обрезку под чужие строки.
 *
 * @param text — подпись
 * @param createBreak — точка переноса перед куском с этим номером
 * @returns куски подписи вперемежку с точками переноса
 */
export const interleaveLabelBreaks = <Break>(
  text: string,
  createBreak: (index: number) => Break
): (string | Break)[] => {
  return splitLabelBreaks(text).flatMap((segment, index) => {
    return index > 0 ? [createBreak(index), segment] : [segment];
  });
};
