import { PRESET_PAPER_FAMILIES } from '../config';
import { deriveRulingPins } from '../lib/paper/fitRulingPins';
import type { PaperSheet, PaperTexture, RulingKind } from '../lib/paper/paper.types';

import type {
  StoredSheetTexture,
  StoredUserSheet,
  UserSheetRecord,
} from './userSheetsStorage.types';

/**
 * Вид разлиновки, если семей нет вовсе.
 */
const FALLBACK_RULING_KIND: RulingKind = 'grid';

/**
 * Data URL: тип, параметры и полезная нагрузка.
 */
const DATA_URL_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

/**
 * Параметр data URL, которым помечена нагрузка в base64.
 */
const BASE64_PARAMETER = 'base64';

/**
 * Вид семьи листа. Семья берётся из встроенного набора, а не из загруженных
 * профилей: при запуске листы читаются раньше профилей, а вид семьи от
 * профилей не зависит. Неизвестная семья — первая, как и при проверке ссылок
 * сессии.
 *
 * @param familyId — семья записи
 * @returns вид разлиновки семьи
 */
export const resolveFamilyKind = (familyId: string): RulingKind => {
  const family =
    PRESET_PAPER_FAMILIES.find((item) => {
      return item.id === familyId;
    }) || PRESET_PAPER_FAMILIES[0];

  return family?.kind || FALLBACK_RULING_KIND;
};

/**
 * Файл из data URL. Разбор строки, а не `fetch`: так файл собирается
 * синхронно и тем же классом `Blob`, что у остального приложения.
 *
 * @param dataUrl — data URL
 * @returns файл; `null` — строка не data URL или нагрузка не декодируется
 */
export const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = DATA_URL_PATTERN.exec(dataUrl);

  if (!match) {
    return null;
  }

  const [, type = '', parameters = '', payload = ''] = match;

  try {
    if (!parameters.split(';').includes(BASE64_PARAMETER)) {
      return new Blob([decodeURIComponent(payload)], { type });
    }

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);

    /**
     * Цикл, а не `Uint8Array.from` с преобразователем: у фотографии с
     * телефона миллионы байт, и вызов функции на каждый заметен.
     */
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type });
  } catch {
    return null;
  }
};

/**
 * Карта текстуры для записи: картинка файлом рядом с размером и размахом.
 *
 * @param texture — карта текстуры экземпляра
 * @param image — картинка карты файлом
 * @returns карта для записи; `null` — карты или её файла нет
 */
const toStoredTexture = (
  texture: PaperTexture | null,
  image: Blob | null
): StoredSheetTexture | null => {
  if (!texture || !image) {
    return null;
  }

  const { width, height, amplitude } = texture;

  return { image, width, height, amplitude };
};

/**
 * Разметка автомата у только что измеренного листа: найденная разлиновка —
 * его разлиновка, булавки выведены из неё. Так собираются листы после импорта,
 * перемера и чтения записи, у которой разметки ещё не было.
 *
 * @param sheet — экземпляр с измеренной разлиновкой
 * @returns найденная разлиновка и булавки
 */
export const deriveUserSheetMarkup = (
  sheet: Pick<PaperSheet, 'ruling' | 'width' | 'height'>
): Pick<UserSheetRecord, 'measuredRuling' | 'pins'> => {
  const { ruling, width, height } = sheet;

  return { measuredRuling: ruling, pins: deriveRulingPins(ruling, { width, height }) };
};

/**
 * Запись для IndexedDB из листа стора: разметка — та, что у листа в памяти.
 *
 * @param record — лист стора
 * @param source — исходный файл фотографии
 * @param textureImage — картинка карты текстуры файлом
 * @returns запись для хранилища
 */
export const toStoredUserSheet = (
  { familyId, sheet, kind, measuredRuling, pins }: UserSheetRecord,
  source: Blob,
  textureImage: Blob | null
): StoredUserSheet => {
  const { id, label, width, height, ruling, lighting, texture } = sheet;

  return {
    id,
    familyId,
    kind,
    label,
    width,
    height,
    ruling,
    measuredRuling,
    pins,
    lighting,
    source,
    texture: toStoredTexture(texture, textureImage),
  };
};
