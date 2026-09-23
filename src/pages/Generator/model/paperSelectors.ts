import type { PaperFamily, PaperSheet, RulingKind } from '../lib/paper/paper.types';

import type { GeneratorState } from './generator.types';
import type { UserSheetRecord } from './userSheetsStorage.types';

/**
 * Все доступные семьи: предустановленные плюс добавленные в них
 * пользовательские листы. Пользовательские листы хранятся отдельным списком, а
 * не внутри семьи: так их легко сохранить, восстановить и удалить, не
 * пересобирая пресеты.
 *
 * Семья без своих листов возвращается той же ссылкой, что и пришла: результат
 * попадает в зависимости хуков, и новый объект на каждый вызов гонял бы
 * пересчёт впустую.
 *
 * @param presetFamilies — предустановленные семьи
 * @param userSheets — загруженные пользователем листы
 * @returns семьи листов с пользовательскими экземплярами
 */
export const mergeFamilySheets = (
  presetFamilies: PaperFamily[],
  userSheets: UserSheetRecord[]
): PaperFamily[] => {
  return presetFamilies.reduce<PaperFamily[]>((acc, family) => {
    const own = userSheets.reduce<PaperSheet[]>((sheetAcc, record) => {
      if (record.familyId === family.id) {
        sheetAcc.push(record.sheet);
      }

      return sheetAcc;
    }, []);

    acc.push(own.length > 0 ? { ...family, sheets: [...family.sheets, ...own] } : family);

    return acc;
  }, []);
};

/**
 * Семья по идентификатору. Если такой нет — первая доступная: генератор всегда
 * рисует по какой-то разлиновке.
 *
 * @param families — доступные семьи
 * @param familyId — идентификатор выбранной семьи
 * @returns семья; `undefined` — семей нет вовсе
 */
export const findFamily = (
  families: PaperFamily[],
  familyId: string
): PaperFamily | undefined => {
  return (
    families.find((family) => {
      return family.id === familyId;
    }) || families[0]
  );
};

/**
 * Семья своего листа по его виду: предпочтённая, если её вид совпадает, иначе
 * первая семья этого вида. Чистому листу своей семьи нет, он остаётся в
 * предпочтённой. Вид берётся у листа, а не у семьи, поэтому лист в клетку,
 * добавленный при выбранной линейке, уходит к клетке.
 *
 * @param families — доступные семьи
 * @param preferredFamilyId — выбранная семья или семья, где лист лежит сейчас
 * @param kind — вид разлиновки листа
 * @returns семья; `undefined` — семей нет вовсе
 */
export const findKindFamily = (
  families: PaperFamily[],
  preferredFamilyId: string,
  kind: RulingKind
): PaperFamily | undefined => {
  const preferred = findFamily(families, preferredFamilyId);

  if (kind === 'blank' || preferred?.kind === kind) {
    return preferred;
  }

  return (
    families.find((family) => {
      return family.kind === kind;
    }) || preferred
  );
};

/**
 * Экземпляр листа по идентификатору. Если такого нет — первый в семье.
 *
 * @param family — семья листов
 * @param sheetId — идентификатор выбранного экземпляра
 * @returns экземпляр; `undefined` — в семье нет экземпляров
 */
export const findSheet = (
  family: PaperFamily,
  sheetId: string
): PaperSheet | undefined => {
  return (
    family.sheets.find((sheet) => {
      return sheet.id === sheetId;
    }) || family.sheets[0]
  );
};

/**
 * Все доступные семьи по состоянию генератора.
 *
 * @param state — состояние генератора
 * @returns семьи листов с пользовательскими экземплярами
 */
export const selectPaperFamilies = (state: GeneratorState): PaperFamily[] => {
  return mergeFamilySheets(state.presetFamilies, state.userSheets);
};

/**
 * Выбранная семья листов. Если выбор указывает в никуда — первая доступная:
 * генератор всегда рисует по какой-то разлиновке.
 *
 * @param state — состояние генератора
 * @returns семья; `undefined` — семей нет вовсе
 */
export const selectActiveFamily = (state: GeneratorState): PaperFamily | undefined => {
  return findFamily(selectPaperFamilies(state), state.familyId);
};

/**
 * Выбранный экземпляр листа. Если выбор указывает в никуда — первый в семье.
 *
 * @param state — состояние генератора
 * @returns экземпляр; `undefined` — в семье нет экземпляров
 */
export const selectActiveSheet = (state: GeneratorState): PaperSheet | undefined => {
  const family = selectActiveFamily(state);

  if (!family) {
    return undefined;
  }

  return findSheet(family, state.sheetId);
};

/**
 * Пользовательские листы, которым ещё нужен анализ. Восстановленный из
 * хранилища лист приходит посчитанным и в этот список не попадает — повторно
 * его не анализируют.
 *
 * @param state — состояние генератора
 * @returns листы, ожидающие определения характеристик
 */
export const selectPendingUserSheets = (state: GeneratorState): UserSheetRecord[] => {
  return state.userSheets.filter((record) => {
    return !record.isAnalyzed;
  });
};

/**
 * Страница стоит на своём листе, которого ещё нет: закреплённый лист сессии не
 * найден, а свои листы ещё читаются. Пока это так, область листа показывает
 * ожидание, а не подставленную бумагу: иначе на время чтения мелькнула бы
 * чужая страница.
 *
 * @param state — состояние генератора
 * @returns ждёт ли страница чтения своих листов
 */
export const selectIsAwaitingUserSheets = (state: GeneratorState): boolean => {
  if (state.hasRestoredUserSheets || !state.isSheetPinned) {
    return false;
  }

  return !selectPaperFamilies(state).some((family) => {
    return family.sheets.some((sheet) => {
      return sheet.id === state.sheetId;
    });
  });
};
