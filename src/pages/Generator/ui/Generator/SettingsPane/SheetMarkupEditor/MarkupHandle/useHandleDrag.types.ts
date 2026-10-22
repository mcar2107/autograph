import type { SheetPoint } from '../../../../../lib/paper';

import type { MarkupMoveSource } from './MarkupHandle.types';

/**
 * Идущее перетаскивание ручки — то, что нужно лупе.
 */
export type HandleDrag = {
  /**
   * Точка ручки, px фотографии.
   */
  point: SheetPoint;

  /**
   * Указатель в окне браузера.
   */
  anchor: SheetPoint;

  /**
   * Куда лупа кладётся порталом.
   */
  container: Element;
};

/**
 * Указатель над ручкой — то, что жесту нужно от события.
 */
export type HandlePointer = {
  /**
   * Номер указателя: жест ведёт только нажавший.
   */
  pointerId: number;

  /**
   * Горизонталь указателя в окне браузера.
   */
  clientX: number;

  /**
   * Вертикаль указателя в окне браузера.
   */
  clientY: number;

  /**
   * Круг захвата ручки: по его SVG указатель переводится в пиксели листа.
   */
  target: SVGGraphicsElement;
};

/**
 * Чем кончился жест.
 */
export type HandleDragEnd = {
  /**
   * Последняя точка перетаскивания, px листа; `null` — жеста не было.
   */
  point: SheetPoint | null;

  /**
   * Сдвинули ли ручку за жест.
   */
  hasMoved: boolean;
};

export type HandleDragOptions = {
  /**
   * Горизонталь ручки, px фотографии.
   */
  x: number;

  /**
   * Вертикаль ручки, px фотографии.
   */
  y: number;

  /**
   * Колбэк на нажатие: точка под указателем, px листа.
   */
  onMoveStart?: ((point: SheetPoint) => void) | undefined;

  /**
   * Колбэк на каждое движение: точка под указателем, px листа.
   */
  onMove?: ((point: SheetPoint) => void) | undefined;

  /**
   * Колбэк на завершённый сдвиг указателем.
   */
  onMoveEnd?: ((point: SheetPoint, source: MarkupMoveSource) => void) | undefined;

  /**
   * Колбэк на оборванный системой жест: показанное перетаскиванием в
   * черновике уже снято, остаётся снять своё.
   */
  onMoveCancel?: (() => void) | undefined;
};

export type HandleDragState = {
  /**
   * Идущее перетаскивание; `null` — ручку не тянут.
   */
  drag: HandleDrag | null;

  /**
   * Начинает жест нажатием.
   */
  start: (pointer: HandlePointer) => void;

  /**
   * Ведёт ручку за указателем.
   */
  move: (pointer: HandlePointer) => void;

  /**
   * Отпускание: зовёт завершённый сдвиг, если ручку сдвинули.
   */
  release: (pointerId: number) => void;

  /**
   * Обрыв жеста: снимает показанное, отпускание не зовёт.
   */
  cancel: (pointerId: number) => void;
};
