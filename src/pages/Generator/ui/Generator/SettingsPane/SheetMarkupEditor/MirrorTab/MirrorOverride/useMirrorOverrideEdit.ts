import type {
  RulingMirrorOverride,
  SheetFrame,
  SheetRuling,
} from '../../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../../model/useMarkupEditorStore';
import type { MarkupDraft } from '../../../../../../model/useMarkupEditorStore.types';
import { formatRangeRejection } from '../../ExactValues/exactValuesReferences';

import {
  placeMirrorMarginLineSide,
  placeMirrorSideEnd,
  placeMirrorSideValue,
  readMirrorOverride,
  readMirrorSideRange,
  snapMirrorMarginLineX,
} from './mirrorOverrideMarkup';
import type { MirrorOverrideEdit } from './useMirrorOverrideEdit.types';

/**
 * Черновик с новыми полями зеркала.
 *
 * @param draft — черновик разметки
 * @param mirrorOverride — линия поля и боковые поля зеркала; `null` — отражение
 * @returns правка черновика
 */
const toOverridePatch = (
  draft: MarkupDraft,
  mirrorOverride: RulingMirrorOverride | null
): Partial<MarkupDraft> => {
  return { ruling: { ...draft.ruling, mirrorOverride } };
};

/**
 * Правка линии поля и боковых полей зеркальной страницы в черновике. Правка
 * без отдельных полей зеркала сама их заводит: всё, что правится на вкладке
 * зеркала сверх общей разметки, — его собственное.
 *
 * @param frame — кадр фотографии
 * @returns методы правки
 */
export const useMirrorOverrideEdit = (frame: SheetFrame): MirrorOverrideEdit => {
  /**
   * Шаг истории с полями зеркала, выведенными из текущей разлиновки.
   *
   * @param build — поля зеркала по разлиновке листа
   */
  const commitOverride = (
    build: (ruling: SheetRuling) => RulingMirrorOverride | null
  ) => {
    useMarkupEditorStore.getState().commit((draft) => {
      return toOverridePatch(draft, build(draft.ruling));
    });
  };

  /**
   * Показ полей зеркала без шага истории.
   *
   * @param build — поля зеркала по разлиновке листа
   */
  const previewOverride = (build: (ruling: SheetRuling) => RulingMirrorOverride) => {
    useMarkupEditorStore.getState().preview((draft) => {
      return toOverridePatch(draft, build(draft.ruling));
    });
  };

  const separate = () => {
    commitOverride((ruling) => {
      return readMirrorOverride(ruling, frame);
    });
  };

  const reflect = () => {
    commitOverride(() => {
      return null;
    });
  };

  const moveSideEnd: MirrorOverrideEdit['moveSideEnd'] = (edge, end, point) => {
    previewOverride((ruling) => {
      return placeMirrorSideEnd(ruling, frame, edge, end, point);
    });
  };

  /**
   * Каналы фотографии для магнита берутся в момент вызова: при открытии с
   * плитки они приходят позже редактора. У листа без разлиновки магнита нет —
   * притягивать не к чему. Притягивается только ручка линии поля.
   */
  const setSideEnd: MirrorOverrideEdit['setSideEnd'] = (edge, end, point, shouldSnap) => {
    const { image, draft } = useMarkupEditorStore.getState();
    const target =
      edge === 'marginLine' && shouldSnap && image && draft && draft.kind !== 'blank'
        ? { x: snapMirrorMarginLineX(image, draft.ruling, frame, point), y: point.y }
        : point;

    commitOverride((ruling) => {
      return placeMirrorSideEnd(ruling, frame, edge, end, target);
    });
  };

  const setSideValue: MirrorOverrideEdit['setSideValue'] = (edge, end, value) => {
    const { draft, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return null;
    }

    const mirrorOverride = placeMirrorSideValue(draft.ruling, frame, edge, end, value);

    if (!mirrorOverride) {
      return formatRangeRejection(readMirrorSideRange(draft.ruling, frame, edge, end));
    }

    commit(toOverridePatch(draft, mirrorOverride));

    return null;
  };

  const setMarginLineSide: MirrorOverrideEdit['setMarginLineSide'] = (side) => {
    commitOverride((ruling) => {
      return placeMirrorMarginLineSide(ruling, frame, side);
    });
  };

  return {
    separate,
    reflect,
    moveSideEnd,
    setSideEnd,
    setSideValue,
    setMarginLineSide,
  };
};
