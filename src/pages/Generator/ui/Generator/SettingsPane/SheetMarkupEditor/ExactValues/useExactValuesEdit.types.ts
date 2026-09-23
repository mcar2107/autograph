import type { MarginSide } from '../MarginsTool/marginsGeometry.types';

/**
 * Правка разметки числами.
 */
export type ExactValuesEdit = {
  /**
   * Задаёт шаг разлиновки, px фотографии. Шаг не больше нуля не
   * применяется.
   */
  changeStep: (step: number) => void;

  /**
   * Задаёт положение первой линии, px фотографии.
   */
  changeFirstLine: (phase: number) => void;

  /**
   * Задаёт поле, px фотографии.
   */
  changeMargin: (side: MarginSide, value: number) => void;

  /**
   * Ставит линию поля в столбец, px фотографии.
   */
  changeMarginLine: (x: number) => void;
};
