import type { RulingPin, SheetFrame, SheetRuling } from '../../../../../lib/paper';

/**
 * Слой разметки, который показывается и скрывается отдельно.
 */
export type MarkupLayerId = 'outline' | 'lines' | 'margins' | 'marginLine' | 'pins';

/**
 * Какие слои разметки показаны.
 */
export type MarkupLayerVisibility = Record<MarkupLayerId, boolean>;

export type MarkupOverlayProps = {
  /**
   * Кадр фотографии: в его пикселях задан `viewBox`.
   */
  frame: SheetFrame;

  /**
   * Разлиновка страницы — у зеркальной половины разворота уже отражённая.
   */
  ruling: SheetRuling;

  /**
   * Булавки, через которые подогнана гребёнка.
   */
  pins: RulingPin[];

  /**
   * Какие слои показаны.
   */
  layers: MarkupLayerVisibility;

  /**
   * Включён пробный текст: линии приглушены, у закреплённых линий — только
   * концы.
   */
  isMuted: boolean;

  /**
   * Разметка скрыта удержанием клавиши.
   */
  isHidden: boolean;

  /**
   * Колбэк с узлом слоя ручек: инструменты кладут туда свои ручки порталом.
   * `null` — оверлей размонтирован.
   */
  onHandleLayerChange: (layer: SVGGElement | null) => void;
};
