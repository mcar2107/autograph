import type { SheetImageData } from '../../../../lib/paper';
import { toSheetImageData } from '../../../../model/measureSheetImage';

/**
 * Загружает картинку из data URL.
 *
 * @param src — фотография листа как data URL
 * @returns загруженная картинка; `null` — браузер её не разобрал
 */
const loadImage = (src: string): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    const image = new Image();

    image.addEventListener('load', () => {
      resolve(image);
    });
    image.addEventListener('error', () => {
      resolve(null);
    });

    image.src = src;
  });
};

/**
 * Снимает с фотографии полутоновую выжимку — вход всех измерений листа — и
 * разность красного и зелёного каналов, по которой измерение отличает красную
 * черту поля от нейтральной вертикали.
 *
 * Пустой результат — обычный рабочий случай, а не сбой: фотография может не
 * разобраться, а канвы для съёма пикселей может не быть вовсе. Экземпляр в
 * этом случае всё равно добавляется, только разлиновку к нему задают руками.
 *
 * @param src — фотография листа как data URL
 * @returns выжимка; `null` — снять её не удалось
 */
export const decodeSheetImage = async (src: string): Promise<SheetImageData | null> => {
  const image = await loadImage(src);

  if (!image) {
    return null;
  }

  const { naturalWidth: width, naturalHeight: height } = image;

  if (width < 1 || height < 1) {
    return null;
  }

  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0);

  const { data } = context.getImageData(0, 0, width, height);

  return toSheetImageData(data, width, height);
};
