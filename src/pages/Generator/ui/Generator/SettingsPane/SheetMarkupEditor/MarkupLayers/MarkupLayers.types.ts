import type { MarkupLayerVisibility } from '../MarkupOverlay';

export type MarkupLayersProps = {
  /**
   * Какие слои показаны.
   */
  layers: MarkupLayerVisibility;

  /**
   * Колбэк на смену показанных слоёв.
   */
  onLayersChange: (layers: MarkupLayerVisibility) => void;
};
