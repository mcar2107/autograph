const ELLIPSIS = '…';

/**
 * Обрезает подпись с середины: фотографии с телефона называются одинаково
 * до последних цифр (`IMG_1813`, `IMG_1808`), и обрезка с конца делала бы
 * плитки двух снимков неразличимыми.
 *
 * @param label — подпись целиком
 * @param maxLength — наибольшая длина результата в символах, с многоточием
 * @returns подпись не длиннее `maxLength`: начало, многоточие и конец
 */
export const truncateMiddle = (label: string, maxLength: number): string => {
  const chars = [...label];

  if (chars.length <= maxLength) {
    return label;
  }

  const kept = maxLength - 1;
  const headLength = Math.floor(kept / 2);
  const tailLength = kept - headLength;

  return `${chars.slice(0, headLength).join('')}${ELLIPSIS}${chars.slice(chars.length - tailLength).join('')}`;
};
