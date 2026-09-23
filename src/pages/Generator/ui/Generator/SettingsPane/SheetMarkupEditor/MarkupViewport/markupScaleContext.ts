import { createContext, useContext } from 'react';

/**
 * Масштаб фотографии в окне редактора: экранных пикселей на пиксель
 * фотографии. По нему ручки и точки разметки держат постоянный экранный
 * размер — иначе при приближении они росли бы вместе со снимком и закрывали
 * линию, на которую их ставят.
 */
export const MarkupScaleContext = createContext(1);

/**
 * Текущий масштаб фотографии в окне редактора.
 *
 * @returns экранных пикселей на пиксель фотографии
 */
export const useMarkupScale = (): number => {
  return useContext(MarkupScaleContext);
};
