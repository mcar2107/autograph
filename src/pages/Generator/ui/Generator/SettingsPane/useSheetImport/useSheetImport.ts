import { readFileAsDataUrl } from '@shared/lib/files';
import { useState } from 'react';

import { buildSheetRuling } from '../../../../lib/paper';
import { findKindFamily } from '../../../../model/paperSelectors';
import { useGeneratorStore } from '../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../model/useMarkupEditorStore';
import type { UserSheetRecord } from '../../../../model/userSheetsStorage.types';
import {
  deriveUserSheetMarkup,
  resolveMeasuredKind,
} from '../../../../model/userSheetsStorageRecord';

import { analyzeSheetPhoto } from './analyzeSheetPhoto';
import type { SheetImport, SheetImportOptions } from './useSheetImport.types';

/**
 * Разлиновка, которой нет: нулевой шаг помечает экземпляр, на котором
 * автоопределение не дало результата, — по нему редактор разметки сообщает,
 * что линии не найдены, и ставит две булавки для ручного закрепления.
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
  const openMarkupEditor = useMarkupEditorStore((state) => {
    return state.open;
  });
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (file: File, options: SheetImportOptions) => {
    const { family } = options;
    const label = toSheetLabel(file.name);

    setPendingLabel(label);
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
        { kind: family.kind }
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
      const kind = resolveMeasuredKind(measurement, family.kind, family.kind === 'blank');
      const sheet = {
        id: sheetId,
        label,
        src,
        width: frame.width,
        height: frame.height,
        ruling,
        lighting: measurement?.lighting || null,
        texture: analysis?.texture || null,
      };

      const record: UserSheetRecord = {
        familyId: findKindFamily(presetFamilies, family.id, kind)?.id || family.id,
        sheet,
        kind,
        ...deriveUserSheetMarkup(sheet, kind),
        /**
         * Разбор считается пройденным даже тогда, когда разлиновка не нашлась:
         * повторный прогон по той же фотографии дал бы тот же результат, а
         * заданное руками затёр бы.
         */
        isAnalyzed: true,
      };

      /**
       * Лист встаёт в выбор бумаги до редактора, а не по его сохранению:
       * закрытый без сохранения редактор оставляет лист с разметкой автомата.
       * Редактор открывается после каждого импорта — и когда разлиновка
       * нашлась, и когда нет: ошибку автомата видно только на снимке. Каналы
       * фотографии уходят магнитам редактора и отпускаются с его закрытием.
       */
      addUserSheet(record);
      openMarkupEditor(record, image);
    } catch {
      setError('Не удалось прочитать фотографию');
    } finally {
      setPendingLabel(null);
    }
  };

  return { add, isBusy: pendingLabel !== null, pendingLabel, error };
};
