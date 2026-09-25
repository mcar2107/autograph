export type {
  BlockGeometry,
  GeometryCorrection,
  LineBounds,
  SheetBounds,
  SheetCalibration,
  TextEdges,
} from './calibrate.types';
export {
  BASE_FONT_SIZE_PX,
  deriveGeometry,
  deriveTextHeight,
  GRID_ROW_STEPS,
  MARGIN_LINE_GAP_SHARE,
  resolveTextEdgesAt,
} from './deriveGeometry';
