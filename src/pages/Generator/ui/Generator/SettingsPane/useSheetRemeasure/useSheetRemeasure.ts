import { useState } from 'react';

import type {
  PaperMargins,
  SheetFrame,
  SheetOutline,
  SheetRuling,
} from '../../../../lib/paper';
import { buildSheetRuling } from '../../../../lib/paper';
import { useGeneratorStore } from '../../../../model/useGeneratorStore';
import { deriveUserSheetMarkup } from '../../../../model/userSheetsStorageRecord';
import { analyzeSheetPhoto } from '../useSheetImport';

import type {
  SheetRemeasure,
  SheetRemeasureFailure,
  SheetRemeasureOptions,
} from './useSheetRemeasure.types';

/**
 * Какая доля кадра по ширине и по высоте должна остаться внутри границ: в
 * меньшем куске не набирается строк ни на поиск шага, ни на страницу текста.
 */
const MIN_FRAME_SHARE = 1 / 4;

const SMALL_BOUNDS_ERROR = 'Границы оставляют слишком маленький лист';

/**
 * Нулевые поля: с ними сборка разлиновки отдаёт чистый фолбэк от контура.
 */
const ZERO_MARGINS: PaperMargins = { top: 0, right: 0, bottom: 0, left: 0 };

const DECODE_ERROR = 'Не удалось прочитать фотографию';

/**
 * Годятся ли границы для перемера: отступы неотрицательны, и от кадра остаётся
 * не меньше четверти ширины и высоты.
 *
 * @param bounds — отступы от краёв кадра
 * @param frame — кадр фотографии листа
 * @returns признак годных границ
 */
const isBoundsUsable = (bounds: PaperMargins, frame: SheetFrame): boolean => {
  const { top, right, bottom, left } = bounds;

  return (
    [top, right, bottom, left].every((side) => {
      return side >= 0;
    }) &&
    frame.width - left - right >= frame.width * MIN_FRAME_SHARE &&
    frame.height - top - bottom >= frame.height * MIN_FRAME_SHARE
  );
};

/**
 * Контур листа по границам: прямоугольник, вписанный в него, совпадает с
 * самими границами, и форма после перемера показывает ровно введённое.
 *
 * @param bounds — отступы от краёв кадра
 * @param frame — кадр фотографии листа
 * @returns прямоугольный контур
 */
const toBoundsOutline = (bounds: PaperMargins, frame: SheetFrame): SheetOutline => {
  const right = frame.width - bounds.right;
  const bottom = frame.height - bounds.bottom;

  return {
    topLeft: { x: bounds.left, y: bounds.top },
    topRight: { x: right, y: bounds.top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: bounds.left, y: bottom },
  };
};

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
const rebuildBlankRuling = (
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

/**
 * Перемер своего листа в границах, заданных руками: тот же путь измерения, что
 * при добавлении фотографии, только контур не ищется, а берётся из границ.
 *
 * @returns метод перемера вместе с его состоянием
 */
export const useSheetRemeasure = (sheetId: string): SheetRemeasure => {
  const addUserSheet = useGeneratorStore((state) => {
    return state.addUserSheet;
  });
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SheetRemeasureFailure | null>(null);
  const [revision, setRevision] = useState(0);

  /**
   * Ошибка относится к границам одного листа: на форме другого она сбивала бы
   * с толку, а вернувшись к прежнему листу, пользователь видит форму заново.
   */
  if (failure && failure.sheetId !== sheetId) {
    setFailure(null);
  }

  const remeasure = async (options: SheetRemeasureOptions) => {
    const { family, sheet, kind, bounds } = options;
    const isBlank = kind === 'blank';

    const fail = (message: string) => {
      setFailure({ sheetId: sheet.id, message });
    };

    /**
     * Границы проверяются до декодирования: негодные не должны ни тратить
     * время на фотографию, ни трогать лист.
     */
    if (!isBoundsUsable(bounds, sheet)) {
      fail(SMALL_BOUNDS_ERROR);

      return;
    }

    setBusy(true);
    setFailure(null);

    try {
      /**
       * Контур строится по кадру записи, а не по декодированному снимку: кадр
       * записи и есть кадр этой фотографии, а снимок декодирует воркер.
       */
      const analysis = await analyzeSheetPhoto(
        { src: sheet.src },
        {
          kind: isBlank ? 'blank' : family.kind,
          outline: toBoundsOutline(bounds, sheet),
        }
      );

      if (!analysis) {
        fail(DECODE_ERROR);

        return;
      }

      const { image, measurement, texture } = analysis;
      /**
       * Лист с разлиновкой получает всё измеримое, включая заданное руками:
       * поля ручной правки меряли по прежним границам и к новым не относятся.
       */
      const ruling = isBlank
        ? rebuildBlankRuling(sheet.ruling, measurement.outline, image)
        : buildSheetRuling(measurement.source, image);

      const remeasured = {
        ...sheet,
        width: image.width,
        height: image.height,
        ruling,
        lighting: measurement.lighting,
        texture,
      };

      /**
       * Новое измерение становится и разметкой автомата: «Сбросить к
       * найденному» после перемера возвращает к нему, а не к прежним границам.
       */
      addUserSheet({
        familyId: family.id,
        sheet: remeasured,
        kind,
        ...deriveUserSheetMarkup(remeasured),
        isAnalyzed: true,
      });
      setRevision((current) => {
        return current + 1;
      });
    } catch {
      fail(DECODE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return {
    remeasure,
    isBusy,
    error: failure?.sheetId === sheetId ? failure.message : null,
    revision,
  };
};
