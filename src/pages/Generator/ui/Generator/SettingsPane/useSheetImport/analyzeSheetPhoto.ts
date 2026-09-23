import type { PaperTexture, SheetPhotoOptions, TextureMap } from '../../../../lib/paper';
import { encodeTextureMap, measureSheetPhoto } from '../../../../lib/paper';
import {
  hasMeasureSheetWorker,
  measureSheetInWorker,
} from '../../../../model/createMeasureSheetClient';
import type { SheetPhotoAnalysis } from '../../../../model/measureSheetWorker.types';

import type { SheetPhotoInput } from './analyzeSheetPhoto.types';
import { decodeSheetImage } from './decodeSheetImage';

/**
 * Кодирует карту текстуры. Там, где канвы нет, лист остаётся без текстуры: она
 * украшает чернила, но не влияет на раскладку.
 *
 * @param textureMap — карта текстуры листа
 * @returns карта текстуры; `null` — закодировать не удалось
 */
const encodeTexture = async (textureMap: TextureMap): Promise<PaperTexture | null> => {
  try {
    return await encodeTextureMap(textureMap);
  } catch {
    return null;
  }
};

/**
 * Файл фотографии для воркера. У импорта он уже есть, у перемера фотография
 * хранится data URL-ом, и файл собирается из него.
 *
 * @param photo — фотография листа
 * @returns файл фотографии
 */
const toPhotoBlob = async (photo: SheetPhotoInput): Promise<Blob> => {
  if (photo.blob) {
    return photo.blob;
  }

  const response = await fetch(photo.src);

  return await response.blob();
};

/**
 * Разбор фотографии листа — единственный путь импорта и перемера: каналы
 * снимка, измерение и карта текстуры.
 *
 * Разбор идёт в воркере, и интерфейс отвечает всё время, пока он длится. Где
 * воркера нет (jsdom тестов), тот же разбор идёт в основном потоке: лист
 * добавляется, а не падает. Числа у обоих путей одни и те же.
 *
 * @param photo — фотография листа
 * @param options — настройки измерения
 * @returns разбор; `null` — фотография не декодировалась, лист добавляется
 *   без измерения
 */
export const analyzeSheetPhoto = async (
  photo: SheetPhotoInput,
  options: SheetPhotoOptions
): Promise<SheetPhotoAnalysis | null> => {
  if (hasMeasureSheetWorker()) {
    return await measureSheetInWorker(await toPhotoBlob(photo), options);
  }

  const image = await decodeSheetImage(photo.src);

  if (!image) {
    return null;
  }

  const measurement = measureSheetPhoto(image, options);
  const texture = await encodeTexture(measurement.textureMap);

  return { image, measurement, texture };
};
