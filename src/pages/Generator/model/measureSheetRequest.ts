import type {
  PaperTexture,
  SheetImageData,
  SheetPhotoMeasurement,
  SheetPhotoOptions,
} from '../lib/paper';
import { encodeTextureMap, measureSheetPhoto } from '../lib/paper';

import { decodeSheetPhotoBlob } from './measureSheetImage';
import type {
  MeasureSheetMeasureRequest,
  SheetPhotoAnalysis,
} from './measureSheetWorker.types';

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
 * Разбор уже декодированного снимка: измерение и карта текстуры. Один на
 * воркер и на основной поток без воркера — числа обоих путей обязаны совпадать
 * до бита, и две копии цепочки рано или поздно разошлись бы.
 *
 * @param image — каналы снимка
 * @param options — настройки измерения
 * @returns разбор фотографии
 */
export const analyzeSheetImage = async (
  image: SheetImageData,
  options: SheetPhotoOptions
): Promise<SheetPhotoAnalysis> => {
  const measurement = measureSheetPhoto(image, options);
  const texture = await encodeTexture(measurement);

  return { image, measurement, texture };
};

/**
 * Разбирает фотографию из задания: декодирование, каналы снимка, измерение и
 * карта текстуры — всё, что основной поток делал бы сам.
 *
 * @param request — задание воркеру
 * @returns разбор; `null` — фотография не декодировалась
 */
export const measureSheetRequest = async (
  request: MeasureSheetMeasureRequest
): Promise<SheetPhotoAnalysis | null> => {
  const image = await decodeSheetPhotoBlob(request.photo);

  if (!image) {
    return null;
  }

  return await analyzeSheetImage(image, request.options);
};

/**
 * Буферы массивов по одному разу: буфер, дважды попавший в список передачи,
 * роняет отправку, а у двух массивов он может быть общим.
 *
 * @param channels — массивы каналов; `undefined` — канала нет
 * @returns буферы без повторов
 */
const collectBuffers = (channels: (ArrayBufferView | undefined)[]): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();

  channels.forEach((channel) => {
    if (channel?.buffer instanceof ArrayBuffer) {
      buffers.add(channel.buffer);
    }
  });

  return [...buffers];
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

  return collectBuffers([
    image.luminance,
    image.redMinusGreen,
    measurement.textureMap.values,
  ]);
};

/**
 * Буферы каналов снимка для передачи владения — те же, что у разбора, но без
 * карты текстуры: декодирование её не строит.
 *
 * @param image — каналы снимка
 * @returns буферы для списка передачи
 */
export const collectImageTransfer = (image: SheetImageData): ArrayBuffer[] => {
  return collectBuffers([image.luminance, image.redMinusGreen]);
};
