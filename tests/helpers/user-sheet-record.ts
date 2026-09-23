import type { PaperSheet, RulingKind } from '@pages/Generator/lib/paper';
import type { UserSheetRecord } from '@pages/Generator/model/userSheetsStorage.types';
import {
  deriveUserSheetMarkup,
  resolveFamilyKind,
} from '@pages/Generator/model/userSheetsStorageRecord';

/**
 * Параметры своего листа для теста: всё, кроме экземпляра и семьи, — по
 * умолчанию.
 */
export type UserSheetRecordParams = {
  /**
   * Семья, в которую добавлен лист.
   */
  familyId: string;

  /**
   * Экземпляр листа.
   */
  sheet: PaperSheet;

  /**
   * Вид разлиновки; не задан — вид семьи.
   */
  kind?: RulingKind;

  /**
   * Характеристики посчитаны; не задано — да.
   */
  isAnalyzed?: boolean;
};

/**
 * Свой лист стора так, как его собирает импорт: вид — заданный или семьи,
 * найденная автоматом разлиновка — разлиновка экземпляра, булавки выведены из
 * неё.
 *
 * @param params — семья, экземпляр и необязательные вид и признак разбора
 * @returns лист стора
 */
export const buildUserSheetRecord = (params: UserSheetRecordParams): UserSheetRecord => {
  const {
    familyId,
    sheet,
    kind = resolveFamilyKind(familyId),
    isAnalyzed = true,
  } = params;

  return { familyId, sheet, kind, isAnalyzed, ...deriveUserSheetMarkup(sheet, kind) };
};
