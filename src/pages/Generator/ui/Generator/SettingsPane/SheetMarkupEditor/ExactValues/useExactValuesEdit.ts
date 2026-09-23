import type { SheetFrame } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { placeMargin, placeMarginLine } from '../MarginsTool/marginsGeometry';
import type { MarginSide } from '../MarginsTool/marginsGeometry.types';

import { retargetComb, toMarginPoint } from './exactValuesMarkup';
import type { CombPatch } from './exactValuesMarkup.types';
import type { ExactValuesEdit } from './useExactValuesEdit.types';

/**
 * Правка разметки числами. Каждое число — шаг истории и тот же итог, что
 * перетаскивание ручки в то же место без магнита: поле ставится той же
 * функцией, что направляющая по отпусканию (верхнее и нижнее встают на
 * линию), шаг и первая линия — через булавки, как после их перетаскивания.
 * Магнит не притягивает: набранное число — уже точное место.
 *
 * Каналы фотографии для изгиба берутся из стора в момент правки, как у
 * инструмента «Линии».
 *
 * @param frame — кадр фотографии
 * @returns методы правки
 */
export const useExactValuesEdit = (frame: SheetFrame): ExactValuesEdit => {
  /**
   * Перестраивает гребёнку под новый шаг или первую линию.
   *
   * @param patch — новые числа гребёнки
   */
  const changeComb = (patch: CombPatch) => {
    const { draft, image, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const markup = retargetComb(draft, patch, frame, image);

    if (markup) {
      commit(markup);
    }
  };

  const changeStep = (step: number) => {
    if (step > 0) {
      changeComb({ step });
    }
  };

  const changeFirstLine = (phase: number) => {
    changeComb({ firstLinePhase: phase });
  };

  const changeMargin = (side: MarginSide, value: number) => {
    const { commit } = useMarkupEditorStore.getState();

    commit((draft) => {
      const point = toMarginPoint(side, value, frame);

      return {
        ruling: {
          ...draft.ruling,
          margins: placeMargin(draft.ruling, frame, side, point, true),
        },
      };
    });
  };

  const changeMarginLine = (x: number) => {
    const { commit } = useMarkupEditorStore.getState();

    commit((draft) => {
      return { ruling: { ...draft.ruling, ...placeMarginLine(draft.ruling, frame, x) } };
    });
  };

  return { changeStep, changeFirstLine, changeMargin, changeMarginLine };
};
