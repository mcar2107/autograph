import type { SheetImageData } from '../lib/paper';

/**
 * Веса каналов при переводе цвета в яркость: та же свёртка, что у sRGB-яркости.
 * Разлиновка печатается серым или синим, и по одному зелёному каналу синяя
 * линия почти не видна — поэтому берутся все три.
 */
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;

/**
 * Снимает с пикселей RGBA полутоновую выжимку — вход всех измерений листа — и
 * разность красного и зелёного каналов, по которой измерение отличает красную
 * черту поля от нейтральной вертикали.
 *
 * Одна функция на основной поток и на воркер: разбор в воркере обязан давать
 * те же числа до бита, и две копии одной арифметики рано или поздно
 * разошлись бы.
 *
 * @param pixels — пиксели RGBA построчно
 * @param width — ширина кадра
 * @param height — высота кадра
 * @returns каналы снимка
 */
export const toSheetImageData = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): SheetImageData => {
  const luminance = new Float32Array(width * height);
  const redMinusGreen = new Int16Array(width * height);

  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset] || 0;
    const green = pixels[offset + 1] || 0;

    luminance[index] =
      (red * RED_WEIGHT +
        green * GREEN_WEIGHT +
        (pixels[offset + 2] || 0) * BLUE_WEIGHT) /
      255;
    redMinusGreen[index] = red - green;
  }

  return { width, height, luminance, redMinusGreen };
};

/**
 * Декодирует файл фотографии там, где нет `document`, — в воркере.
 *
 * Поворот по EXIF задаётся явно: элемент `img` в основном потоке его
 * применяет, и снимок с телефона, повёрнутый только тегом, иначе разобрался
 * бы в воркере лёжа на боку.
 *
 * @param photo — файл фотографии
 * @returns каналы снимка; `null` — фотография не декодировалась
 */
export const decodeSheetPhotoBlob = async (
  photo: Blob
): Promise<SheetImageData | null> => {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }

  const { width, height } = bitmap;

  if (width < 1 || height < 1) {
    bitmap.close();

    return null;
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();

    return null;
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data } = context.getImageData(0, 0, width, height);

  return toSheetImageData(data, width, height);
};
