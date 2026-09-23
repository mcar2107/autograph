import type {
  RulingMirrorOverride,
  SheetFrame,
  SheetRuling,
} from '../../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../../model/useMarkupEditorStore';
import type { MarkupDraft } from '../../../../../../model/useMarkupEditorStore.types';

import {
  placeMirrorMargin,
  placeMirrorMarginLine,
  placeMirrorMarginLineSide,
  readMirrorOverride,
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

  const moveMargin: MirrorOverrideEdit['moveMargin'] = (side, x) => {
    previewOverride((ruling) => {
      return placeMirrorMargin(ruling, frame, side, x);
    });
  };

  const setMargin: MirrorOverrideEdit['setMargin'] = (side, x) => {
    commitOverride((ruling) => {
      return placeMirrorMargin(ruling, frame, side, x);
    });
  };

  const moveMarginLine: MirrorOverrideEdit['moveMarginLine'] = (x) => {
    previewOverride((ruling) => {
      return placeMirrorMarginLine(ruling, frame, x);
    });
  };

  /**
   * Каналы фотографии для магнита берутся в момент вызова: при открытии с
   * плитки они приходят позже редактора. У листа без разлиновки магнита нет —
   * притягивать не к чему.
   */
  const setMarginLine: MirrorOverrideEdit['setMarginLine'] = (point, shouldSnap) => {
    const { image, draft } = useMarkupEditorStore.getState();
    const x =
      shouldSnap && image && draft && draft.kind !== 'blank'
        ? snapMirrorMarginLineX(image, draft.ruling, frame, point)
        : point.x;

    commitOverride((ruling) => {
      return placeMirrorMarginLine(ruling, frame, x);
    });
  };

  const setMarginLineSide: MirrorOverrideEdit['setMarginLineSide'] = (side) => {
    commitOverride((ruling) => {
      return placeMirrorMarginLineSide(ruling, frame, side);
    });
  };

  return {
    separate,
    reflect,
    moveMargin,
    setMargin,
    moveMarginLine,
    setMarginLine,
    setMarginLineSide,
  };
};
