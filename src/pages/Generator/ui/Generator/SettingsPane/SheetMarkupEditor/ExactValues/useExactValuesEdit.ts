import type { SheetFrame, SideEdge } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import {
  placeExactSideHandleValue,
  placeMargin,
  readMarginRange,
  readSideHandleRange,
} from '../MarginsTool/marginsGeometry';
import type {
  GuideMarginSide,
  SideHandleEnd,
} from '../MarginsTool/marginsGeometry.types';

import { retargetComb, toMarginPoint } from './exactValuesMarkup';
import type { CombPatch } from './exactValuesMarkup.types';
import { formatRangeRejection } from './exactValuesReferences';
import type { ExactValuesEdit } from './useExactValuesEdit.types';

const STEP_NOT_POSITIVE_MESSAGE = 'Шаг должен быть больше нуля.';

const COMB_REJECTED_MESSAGE =
  'Такой разлиновки у\u00A0листа не\u00A0бывает: линии сошлись\u00A0бы внутри кадра.';

/**
 * Правка разметки числами. Каждое число — шаг истории и тот же итог, что
 * перетаскивание ручки в то же место без магнита: поле ставится той же
 * функцией, что направляющая по отпусканию (верхнее и нижнее встают на
 * линию), ручка бокового поля и линии поля — как перетащенная в этот столбец
 * по своей направляющей, шаг и первая линия — через булавки, как после их
 * перетаскивания.
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
   * @returns почему не применено; `null` — применено
   */
  const changeComb = (patch: CombPatch): string | null => {
    const { draft, image, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return null;
    }

    const markup = retargetComb(draft, patch, frame, image);

    if (!markup) {
      return COMB_REJECTED_MESSAGE;
    }

    commit(markup);

    return null;
  };

  const changeStep = (step: number): string | null => {
    return step > 0 ? changeComb({ step }) : STEP_NOT_POSITIVE_MESSAGE;
  };

  const changeFirstLine = (phase: number): string | null => {
    return changeComb({ firstLinePhase: phase });
  };

  const changeMargin = (side: GuideMarginSide, value: number): string | null => {
    const { draft, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return null;
    }

    const range = readMarginRange(draft.ruling, frame, side);

    if (value < range.min || value > range.max) {
      return formatRangeRejection(range);
    }

    commit({
      ruling: {
        ...draft.ruling,
        margins: placeMargin(
          draft.ruling,
          frame,
          side,
          toMarginPoint(side, value, frame),
          true
        ),
      },
    });

    return null;
  };

  const changeSideEnd = (
    edge: SideEdge,
    end: SideHandleEnd,
    value: number
  ): string | null => {
    const { draft, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return null;
    }

    const ruling = placeExactSideHandleValue(draft.ruling, frame, edge, end, value);

    if (!ruling) {
      return formatRangeRejection(readSideHandleRange(draft.ruling, frame, edge, end));
    }

    commit({ ruling });

    return null;
  };

  return { changeStep, changeFirstLine, changeMargin, changeSideEnd };
};
