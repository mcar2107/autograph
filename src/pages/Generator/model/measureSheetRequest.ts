import type { PaperTexture, SheetPhotoMeasurement } from '../lib/paper';
import { encodeTextureMap, measureSheetPhoto } from '../lib/paper';

import { decodeSheetPhotoBlob } from './measureSheetImage';
import type { MeasureSheetRequest, SheetPhotoAnalysis } from './measureSheetWorker.types';

/**
 * Кодирует карту текстуры. Не вышло — лист остаётся без текстуры: она украшает
 * чернила, но не влияет на раскладку.
 *
 * @param measurement — измерение фотографии
 * @returns карта текстуры; `null` — закодировать не удалось
 */
const encodeTexture = async (
  measurement: SheetPhotoMeasurement
): Promise<PaperTexture | null> => {
  try {
    return await encodeTextureMap(measurement.textureMap);
  } catch {
    return null;
  }
};

/**
 * Разбирает фотографию из задания: декодирование, каналы снимка, измерение и
 * карта текстуры — всё, что основной поток делал бы сам.
 *
 * @param request — задание воркеру
 * @returns разбор; `null` — фотография не декодировалась
 */
export const measureSheetRequest = async (
  request: MeasureSheetRequest
): Promise<SheetPhotoAnalysis | null> => {
  const image = await decodeSheetPhotoBlob(request.photo);

  if (!image) {
    return null;
  }

  const measurement = measureSheetPhoto(image, request.options);
  const texture = await encodeTexture(measurement);

  return { image, measurement, texture };
};

/**
 * Буферы разбора, которые уходят в основной поток передачей владения: каналы
 * снимка на мегапиксели и карта текстуры того же размера. Копия при отправке
 * заняла бы основной поток на время, сравнимое с тем, ради которого разбор
 * уехал в воркер.
 *
 * Буфер в списке передачи должен встречаться один раз, иначе отправка падает,
 * поэтому общий у двух массивов буфер берётся единожды.
 *
 * @param analysis — разбор фотографии
 * @returns буферы для списка передачи
 */
export const collectAnalysisTransfer = (analysis: SheetPhotoAnalysis): ArrayBuffer[] => {
  const { image, measurement } = analysis;
  const buffers = new Set<ArrayBuffer>();

  [image.luminance, image.redMinusGreen, measurement.textureMap.values].forEach(
    (channel) => {
      if (channel?.buffer instanceof ArrayBuffer) {
        buffers.add(channel.buffer);
      }
    }
  );

  return [...buffers];
};
