import type { SheetImageData, SheetPhotoOptions } from '../../../../lib/paper';
import {
  decodeSheetInWorker,
  hasMeasureSheetWorker,
  measureSheetInWorker,
} from '../../../../model/createMeasureSheetClient';
import { analyzeSheetImage } from '../../../../model/measureSheetRequest';
import type { SheetPhotoAnalysis } from '../../../../model/measureSheetWorker.types';

import type { SheetPhotoInput } from './analyzeSheetPhoto.types';
import { decodeSheetImage } from './decodeSheetImage';

/**
 * Файл фотографии для воркера. У импорта он уже есть, у перемера и открытия с
 * плитки он берётся по адресу фотографии листа.
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

  return await analyzeSheetImage(image, options);
};

/**
 * Каналы снимка уже разобранного листа — для магнитов редактора, открытого с
 * плитки. Лист не перемеряется: декодирование идёт в воркере тем же путём,
 * что у разбора, а без воркера — в основном потоке.
 *
 * @param photo — фотография листа
 * @returns каналы снимка; `null` — фотография не декодировалась
 */
export const loadSheetImage = async (
  photo: SheetPhotoInput
): Promise<SheetImageData | null> => {
  if (hasMeasureSheetWorker()) {
    return await decodeSheetInWorker(await toPhotoBlob(photo));
  }

  return await decodeSheetImage(photo.src);
};
