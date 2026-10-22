export { bentLineHeightAt } from './bentLineHeightAt';
export type {
  MarginLineReport,
  MarginLineThreshold,
  RulingDetectionOptions,
} from './detectRuling';
export { detectRuling } from './detectRuling';
export { measureBendDeviation } from './detectRulingBend';
export { detectSheetOutline } from './detectSheetOutline';
export type { SkewDetectionOptions } from './detectSkewAngle';
export { detectSkewAngle, MAX_SKEW_ANGLE, SKEW_ANGLE_STEP } from './detectSkewAngle';
export { ANALYSIS_IMAGE_SIZE, downsampleSheetImage } from './downsampleSheetImage';
export { editRulingBend, resolveBendRadius, resolveBendReach } from './editRulingBend';
export type { RulingBendEdit, RulingBendRadius } from './editRulingBend.types';
export { refitRulingBend } from './editRulingBendRefit';
export { encodeTextureMap, toTexturePixels } from './encodeTextureMap';
export {
  extractLighting,
  LIGHTING_USABLE_CONTRAST,
  resolveLightingGrid,
} from './extractLighting';
export { extractTexture } from './extractTexture';
export { deriveRulingPins, fitRulingPins } from './fitRulingPins';
export type { RulingPinsFit } from './fitRulingPins.types';
export { measureSheetPhoto } from './measureSheetPhoto';
export type {
  SheetPhotoBandedReport,
  SheetPhotoDiagnostics,
  SheetPhotoMeasurement,
  SheetPhotoOptions,
  SheetPhotoPerspectiveReport,
} from './measureSheetPhoto.types';
export { mirrorSheetRuling } from './mirrorSheetRuling';
export type {
  ExtractLightingOptions,
  ExtractTextureOptions,
  LightingField,
  LightingGrid,
  MarginLineSide,
  PaperFamily,
  PaperMargins,
  PaperSheet,
  PaperTexture,
  RulingBend,
  RulingDetection,
  RulingKind,
  RulingMirrorOverride,
  RulingPerspective,
  RulingPin,
  RulingProjection,
  RulingSideSlant,
  SheetFrame,
  SheetImageData,
  SheetOutline,
  SheetPoint,
  SheetRuling,
  SheetRulingSource,
  TextureMap,
} from './paper.types';
export { resolveSheetBounds } from './resolveSheetBounds';
export {
  lineCoordinateAt,
  lineHeightAt,
  lineHeightScaleAt,
  lineHeightSlopeAt,
} from './rulingPerspective';
export { sampleRulingBend, sampleRulingBendSlope } from './sampleRulingBend';
export { buildSheetRuling, MARGIN_FALLBACK_STEPS, resolveFirstLine } from './sheetRuling';
export {
  intersectSideEdge,
  normalizeSideSlant,
  readMarginEnds,
  readMarginLineEnds,
  readSideEdge,
  reanchorMirrorOverride,
  reanchorSideEdges,
  resolveSideEdgeAt,
  sideEdgePointAt,
  sideEdgePointAtHeight,
  toSideEdgeEnds,
  writeSideEdge,
} from './sideEdges';
export type { SideEdge, SideEdgeEnds } from './sideEdges.types';
export { snapMarginLine } from './snapMarginLine';
export { snapToMarginLine, snapToRulingLine } from './snapToRulingLine';
export { synthesizeLighting } from './synthesizeLighting';
