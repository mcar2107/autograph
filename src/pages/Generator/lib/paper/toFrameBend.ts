import { BEND_OFFSET_PRECISION } from './detectRulingBend';
import type { RulingBend, RulingProjection } from './paper.types';
import { lineHeightScaleAt } from './rulingPerspective';

/**
 * Переводит сетку изгиба, найденную в пикселях анализа — вырезки или её
 * выпрямленной копии, — в кадр. Один перевод на импорт и на «Подогнать по
 * фото»: изгиб, прослеженный заново, ложится в кадр тем же числом, что при
 * импорте.
 *
 * Строки узлов лежат по координате вдоль линий и сдвигаются вместе с ней.
 * Смещения мерились в пикселях анализа по высоте, а хранятся в пикселях фото:
 * у выпрямленной копии пиксель по высоте — единица координаты вдоль линий, и
 * смещение домножается на местный масштаб `∂Y/∂U` в своём узле. Без
 * перспективы масштаб единичный, и смещения не трогаются — ни умножением, ни
 * округлением.
 *
 * @param bend — изгиб в пикселях анализа
 * @param projection — наклон и перспектива в пикселях кадра
 * @param columnShift — сдвиг по горизонтали из анализа в кадр, px
 * @param lineShift — сдвиг координаты вдоль линий из анализа в кадр
 * @returns изгиб в пикселях кадра
 */
export const toFrameBend = (
  bend: RulingBend,
  projection: RulingProjection,
  columnShift: number,
  lineShift: number
): RulingBend => {
  const columnOrigin = bend.columnOrigin + columnShift;
  const rowOrigin = bend.rowOrigin + lineShift;

  if (!projection.perspective) {
    return { ...bend, columnOrigin, rowOrigin };
  }

  const offsets = bend.offsets.map((offset, index) => {
    const column = index % bend.columnCount;
    const row = Math.floor(index / bend.columnCount);
    const scale = lineHeightScaleAt(
      projection,
      columnOrigin + column * bend.columnSpacing,
      rowOrigin + row * bend.rowSpacing
    );

    return Math.round(offset * scale * BEND_OFFSET_PRECISION) / BEND_OFFSET_PRECISION;
  });

  return { ...bend, columnOrigin, rowOrigin, offsets };
};
