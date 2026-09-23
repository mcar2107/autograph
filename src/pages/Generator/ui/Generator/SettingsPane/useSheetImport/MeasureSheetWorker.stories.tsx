import { withBasePath } from '@shared/lib/url';
import { Spinner } from '@shared/ui/Spinner';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FC } from 'react';
import { expect } from 'storybook/test';

import type { RulingKind } from '../../../../lib/paper';
import { encodeTextureMap, measureSheetPhoto } from '../../../../lib/paper';
import {
  decodeSheetInWorker,
  measureSheetInWorker,
} from '../../../../model/createMeasureSheetClient';
import type { SheetPhotoAnalysis } from '../../../../model/measureSheetWorker.types';

import { decodeSheetImage } from './decodeSheetImage';

/**
 * Период таймера, по которому проверяется отзывчивость основного потока.
 */
const TICK_MS = 10;

/**
 * Насколько тик таймера может опоздать, пока идёт разбор: дольше интерфейс
 * заметно запинается — индикатор ожидания встаёт, набор текста рвётся.
 */
const MAX_TICK_DELAY_MS = 50;

/**
 * Сколько тиков должно пройти за разбор, чтобы проверка не была пустой:
 * разбор короче пары периодов таймера ничего о потоке не говорит.
 */
const MIN_TICKS = 5;

/**
 * Проба: разбор идёт в play-функции, а на экране крутится индикатор ожидания —
 * тот же, что на плитке «Своё фото».
 */
const MeasureSheetWorkerProbe: FC = () => {
  return (
    <p className="flex items-center gap-2">
      <Spinner />
      Разбор фотографии листа
    </p>
  );
};

/**
 * Адрес фотографии пресет-пака.
 *
 * @param kind — вид разлиновки, он же папка пресет-пака
 * @param index — номер фотографии в папке
 * @returns адрес фотографии
 */
const toPresetSrc = (kind: RulingKind, index: number): string => {
  return withBasePath(`/paper/${kind}/${index}.jpg`);
};

/**
 * Скачивает фотографию файлом — так её получает воркер при импорте.
 *
 * @param src — адрес фотографии
 * @returns файл фотографии
 */
const fetchPhoto = async (src: string): Promise<Blob> => {
  const response = await fetch(src);

  return await response.blob();
};

/**
 * Число несовпавших байтов двух массивов. Сравнение по байтам, а не по
 * значениям: `NaN` и `−0` должны совпасть в точности, а не по равенству чисел.
 *
 * @param actual — массив из воркера
 * @param expected — массив основного потока
 * @returns число несовпавших байтов; длины разные — `Infinity`
 */
const countByteMismatches = (
  actual: ArrayBufferView | undefined,
  expected: ArrayBufferView | undefined
): number => {
  if (!actual || !expected || actual.byteLength !== expected.byteLength) {
    return actual === expected ? 0 : Infinity;
  }

  const left = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const right = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
  let mismatches = 0;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      mismatches += 1;
    }
  }

  return mismatches;
};

/**
 * Разбор в основном потоке тем же путём, что до переезда в воркер.
 *
 * @param src — адрес фотографии
 * @param kind — вид разлиновки
 * @returns разбор основного потока
 */
const analyzeOnMainThread = async (
  src: string,
  kind: RulingKind
): Promise<SheetPhotoAnalysis> => {
  const image = await decodeSheetImage(src);

  if (!image) {
    throw new Error(`Фотография ${src} не декодировалась`);
  }

  const measurement = measureSheetPhoto(image, { kind });
  const texture = await encodeTextureMap(measurement.textureMap);

  return { image, measurement, texture };
};

/**
 * Разбор воркера совпадает с разбором основного потока до бита: каналы снимка,
 * всё измерение с отчётами, поле освещения и карта текстуры в байтах.
 *
 * @param src — адрес фотографии
 * @param kind — вид разлиновки
 * @returns разбор воркера
 */
const expectWorkerMatchesMainThread = async (
  src: string,
  kind: RulingKind
): Promise<SheetPhotoAnalysis> => {
  /**
   * Воркер стартует первым и разбирает параллельно с основным потоком: подряд
   * два разбора снимка пресет-пака не укладываются в таймаут story.
   */
  const inWorker = measureSheetInWorker(await fetchPhoto(src), { kind });
  const expected = await analyzeOnMainThread(src, kind);
  const actual = await inWorker;

  if (!actual) {
    throw new Error(`Воркер не декодировал ${src}`);
  }

  await expect(actual.image.width).toBe(expected.image.width);
  await expect(actual.image.height).toBe(expected.image.height);
  await expect(
    countByteMismatches(actual.image.luminance, expected.image.luminance)
  ).toBe(0);
  await expect(
    countByteMismatches(actual.image.redMinusGreen, expected.image.redMinusGreen)
  ).toBe(0);
  await expect(
    countByteMismatches(
      actual.measurement.textureMap.values,
      expected.measurement.textureMap.values
    )
  ).toBe(0);

  /**
   * Карта текстуры сверена по байтам выше; в общем сравнении её мегапиксели
   * перебирались бы по одному значению.
   */
  const withoutTextureValues = ({ measurement }: SheetPhotoAnalysis) => {
    return {
      ...measurement,
      textureMap: { ...measurement.textureMap, values: null },
    };
  };

  await expect(withoutTextureValues(actual)).toStrictEqual(
    withoutTextureValues(expected)
  );
  await expect(actual.texture).toStrictEqual(expected.texture);

  return actual;
};

const meta = {
  component: MeasureSheetWorkerProbe,
} satisfies Meta<typeof MeasureSheetWorkerProbe>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Пока воркер разбирает фотографию, основной поток отвечает: таймер с
 * периодом 10 мс не опаздывает больше чем на 50 мс, и индикатор ожидания
 * крутится.
 */
export const MainThreadStaysResponsive: Story = {
  play: async () => {
    const photo = await fetchPhoto(toPresetSrc('grid', 1));
    let lastTick = performance.now();
    let maxDelay = 0;
    let ticks = 0;
    const timer = setInterval(() => {
      const now = performance.now();

      maxDelay = Math.max(maxDelay, now - lastTick - TICK_MS);
      lastTick = now;
      ticks += 1;
    }, TICK_MS);

    try {
      const analysis = await measureSheetInWorker(photo, { kind: 'grid' });

      await expect(analysis?.measurement.source.step).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
    }

    await expect(ticks).toBeGreaterThanOrEqual(MIN_TICKS);
    await expect(maxDelay).toBeLessThanOrEqual(MAX_TICK_DELAY_MS);
  },
};

/**
 * Story сверки одной фотографии пресет-пака: по фотографии на story, потому
 * что разбор снимка идёт секундами.
 *
 * @param kind — вид разлиновки, он же папка пресет-пака
 * @param index — номер фотографии в папке
 * @returns story сверки
 */
const createPresetStory = (kind: RulingKind, index: number): Story => {
  return {
    play: async () => {
      const { measurement } = await expectWorkerMatchesMainThread(
        toPresetSrc(kind, index),
        kind
      );

      await expect(measurement.source.step).toBeGreaterThan(0);
    },
  };
};

/**
 * Каналы снимка для магнитов редактора, открытого с плитки: воркер декодирует
 * без измерения, и каналы совпадают с основным потоком до бита.
 */
export const DecodeMatchesMainThread: Story = {
  play: async () => {
    const src = toPresetSrc('grid', 1);
    const actual = await decodeSheetInWorker(await fetchPhoto(src));
    const expected = await decodeSheetImage(src);

    if (!actual || !expected) {
      throw new Error(`Фотография ${src} не декодировалась`);
    }

    await expect(actual.width).toBe(expected.width);
    await expect(actual.height).toBe(expected.height);
    await expect(countByteMismatches(actual.luminance, expected.luminance)).toBe(0);
    await expect(countByteMismatches(actual.redMinusGreen, expected.redMinusGreen)).toBe(
      0
    );
  },
};

export const GridPreset1MatchesMainThread = createPresetStory('grid', 1);
export const GridPreset2MatchesMainThread = createPresetStory('grid', 2);
export const GridPreset3MatchesMainThread = createPresetStory('grid', 3);
export const GridPreset4MatchesMainThread = createPresetStory('grid', 4);
export const LinedPreset1MatchesMainThread = createPresetStory('lined', 1);
export const LinedPreset2MatchesMainThread = createPresetStory('lined', 2);
export const LinedPreset3MatchesMainThread = createPresetStory('lined', 3);
export const LinedPreset4MatchesMainThread = createPresetStory('lined', 4);
