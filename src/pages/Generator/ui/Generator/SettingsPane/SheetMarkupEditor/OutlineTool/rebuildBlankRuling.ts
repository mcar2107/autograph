import type {
  PaperMargins,
  SheetFrame,
  SheetOutline,
  SheetRuling,
} from '../../../../../lib/paper';
import { buildSheetRuling } from '../../../../../lib/paper';

/**
 * Нулевые поля: с ними сборка разлиновки отдаёт чистый фолбэк от контура.
 */
const ZERO_MARGINS: PaperMargins = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Разлиновка чистого листа после перемера: мерить её не по чему, поэтому шаг,
 * фаза, наклон и линия поля остаются заданными руками, а меняется один контур.
 *
 * Поля при этом подтягиваются: каждое становится не меньше фолбэка от нового
 * контура. Хранимое число не говорит, поставил его пользователь или фолбэк от
 * прежнего контура, а фолбэк, оставшийся от прежнего, уводит текст за край
 * листа — при шаге 41 и сдвиге границы на 200 px строки начались бы на 138 px
 * левее листа. Поле, заданное руками внутри листа, фолбэка больше и остаётся
 * как есть.
 *
 * @param ruling — прежняя разлиновка листа
 * @param outline — новый контур листа
 * @param frame — кадр фотографии
 * @returns разлиновка с новым контуром и полями внутри него
 */
export const rebuildBlankRuling = (
  ruling: SheetRuling,
  outline: SheetOutline | null,
  frame: SheetFrame
): SheetRuling => {
  const fallback = buildSheetRuling({ ...ruling, margins: ZERO_MARGINS, outline }, frame);

  return {
    ...fallback,
    margins: {
      top: Math.max(ruling.margins.top, fallback.margins.top),
      right: Math.max(ruling.margins.right, fallback.margins.right),
      bottom: Math.max(ruling.margins.bottom, fallback.margins.bottom),
      left: Math.max(ruling.margins.left, fallback.margins.left),
    },
  };
};
