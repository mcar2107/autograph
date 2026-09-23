import { readFileAsDataUrl } from '@shared/lib/files';
import { useState } from 'react';

import type { RulingKind, SheetPhotoMeasurement } from '../../../../lib/paper';
import { buildSheetRuling } from '../../../../lib/paper';
import { findKindFamily } from '../../../../model/paperSelectors';
import { useGeneratorStore } from '../../../../model/useGeneratorStore';
import { deriveUserSheetMarkup } from '../../../../model/userSheetsStorageRecord';

import { analyzeSheetPhoto } from './analyzeSheetPhoto';
import { requestManualRuling } from './manualRulingRequest';
import type { SheetImport, SheetImportOptions } from './useSheetImport.types';

/**
 * Разлиновка, которой нет: нулевой шаг помечает экземпляр как ждущий ручного
 * ввода — по нему панель и понимает, что автоопределение не дало результата.
 */
const MISSING_RULING = { step: 0, firstLinePhase: 0, skewAngle: 0 };

/**
 * Счётчик добавленных за сессию листов. Нужен вместе со временем: два файла,
 * выбранные в одном диалоге, приходят в одну миллисекунду.
 */
let sheetCounter = 0;

/**
 * Идентификатор нового экземпляра. Пользовательские листы живут в локальном
 * хранилище, поэтому идентификатор обязан пережить перезагрузку и не совпасть
 * с предустановленным.
 *
 * @returns идентификатор экземпляра
 */
const nextSheetId = (): string => {
  sheetCounter += 1;

  return `user-${Date.now().toString(36)}-${sheetCounter}`;
};

/**
 * Подпись экземпляра в списке — имя файла без расширения.
 *
 * @param fileName — имя выбранного файла
 * @returns подпись экземпляра
 */
const toSheetLabel = (fileName: string): string => {
  return fileName.replace(/\.[^.]+$/, '') || 'Свой лист';
};

/**
 * Вид нового листа: предложенный снимком, а не выбранной семьёй. Если вид
 * снимок не дал — разлиновка не нашлась или фотография не разобрана, — вид
 * семьи.
 *
 * @param measurement — измерение фотографии; `null` — не разобрана
 * @param familyKind — вид выбранной семьи
 * @param isBlank — лист добавлен без разлиновки
 * @returns вид разлиновки листа
 */
const resolveImportKind = (
  measurement: SheetPhotoMeasurement | null,
  familyKind: RulingKind,
  isBlank: boolean
): RulingKind => {
  if (isBlank) {
    return 'blank';
  }

  return measurement?.diagnostics.isRulingDetected
    ? measurement.diagnostics.kind
    : familyKind;
};

/**
 * Добавление своей фотографии листа: чтение файла, измерения и запись
 * экземпляра в выбранную семью.
 *
 * @returns метод добавления вместе с состоянием разбора
 */
export const useSheetImport = (): SheetImport => {
  const addUserSheet = useGeneratorStore((state) => {
    return state.addUserSheet;
  });
  const presetFamilies = useGeneratorStore((state) => {
    return state.presetFamilies;
  });
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (file: File, options: SheetImportOptions) => {
    const { family, isBlank } = options;

    setBusy(true);
    setError(null);

    try {
      const src = await readFileAsDataUrl(file);
      /**
       * Измерение тем же путём, что собирает пресеты: контур листа, разлиновка
       * внутри него с наклоном, перспективой и изгибом, свет и текстура только
       * по бумаге. У чистого листа разлиновка не ищется, остальное — так же.
       */
      const analysis = await analyzeSheetPhoto(
        { src, blob: file },
        { kind: isBlank ? 'blank' : family.kind }
      );
      const image = analysis?.image || null;
      const measurement = analysis?.measurement || null;
      /**
       * Кадр неразобранной фотографии неизвестен, а сама она не отбрасывается:
       * берётся кадр первого листа семьи. Без него страница такого листа
       * вышла бы нулевого размера, а разлиновку к нему всё равно задают руками.
       */
      const frameSource = image || family.sheets[0];
      const frame = {
        width: frameSource?.width || 0,
        height: frameSource?.height || 0,
      };
      /**
       * В разлиновку идёт всё найденное — и поля, и линия поля со стороной, и
       * контур листа: по ним выкладывается блок текста, а не по общему для
       * семьи отступу.
       */
      const ruling = buildSheetRuling(measurement?.source || MISSING_RULING, frame);
      const sheetId = nextSheetId();
      const kind = resolveImportKind(measurement, family.kind, isBlank);
      const sheet = {
        id: sheetId,
        label: toSheetLabel(file.name),
        src,
        width: frame.width,
        height: frame.height,
        ruling,
        lighting: measurement?.lighting || null,
        texture: analysis?.texture || null,
      };

      addUserSheet({
        familyId: findKindFamily(presetFamilies, family.id, kind)?.id || family.id,
        sheet,
        kind,
        ...deriveUserSheetMarkup(sheet),
        /**
         * Разбор считается пройденным даже тогда, когда разлиновка не нашлась:
         * повторный прогон по той же фотографии дал бы тот же результат, а
         * заданное руками затёр бы.
         */
        isAnalyzed: true,
      });

      /**
       * Нулевой шаг — разлиновки нет: без ручного ввода строки встали бы по
       * синтетической гребёнке, не совпадающей с линиями снимка.
       */
      if (ruling.step <= 0) {
        requestManualRuling(sheetId);
      }
    } catch {
      setError('Не удалось прочитать фотографию');
    } finally {
      setBusy(false);
    }
  };

  return { add, isBusy, error };
};
