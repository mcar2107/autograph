import type {
  RulingPin,
  SheetFrame,
  SheetImageData,
  SheetPoint,
  SheetRuling,
} from '../../../../../lib/paper';
import { deriveRulingPins, fitRulingPins, lineHeightAt } from '../../../../../lib/paper';
import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';
import { normalizePins, refitBendToPins } from '../LinesTool/linesPins';
import type { GuideMarginSide } from '../MarginsTool/marginsGeometry.types';

import type { CombPatch } from './exactValuesMarkup.types';

/**
 * Булавки на прямой гребёнке: концы на высоте своих линий в своих столбцах.
 * Изгиб не прибавляется: он прослеживается заново относительно новой
 * гребёнки, как после перетаскивания.
 *
 * @param ruling — гребёнка
 * @param pins — булавки с номерами линий и столбцами концов
 * @returns булавки на линиях гребёнки
 */
const placePinsOnComb = (ruling: SheetRuling, pins: RulingPin[]): RulingPin[] => {
  return pins.map((pin) => {
    const u = ruling.firstLinePhase + pin.index * ruling.step;
    const [left, right] = [pin.left, pin.right].map(({ x }) => {
      return { x, y: lineHeightAt(ruling, x, u) };
    });

    return { index: pin.index, left: left || pin.left, right: right || pin.right };
  });
};

/**
 * Разметка после шага или первой линии, заданных числом. Булавки встают на
 * линии гребёнки с этим шагом и первой линией в своих столбцах, а изгиб
 * прослеживается по фотографии и доводится до булавок — как после
 * перетаскивания булавок в эти места с Alt/Option: линии те же.
 *
 * Гребёнка при этом остаётся ровно той, что задана числами, и не
 * подгоняется заново через булавки: у листа с перспективой подгонка
 * записала бы те же линии от другого начала отсчёта, и набранные шаг и
 * первая линия показались бы другими числами.
 *
 * Булавки, которые гребёнку не задают, — без номеров шагов между ними, — не
 * переставляются, а выводятся заново по заданной гребёнке.
 *
 * @param draft — черновик
 * @param patch — новый шаг или первая линия, px фотографии
 * @param frame — кадр фотографии
 * @param image — каналы фотографии для изгиба; `null` — изгиб не прослеживается
 * @returns правка черновика; `null` — такой гребёнки у листа не бывает:
 *   линии сошлись бы внутри кадра
 */
export const retargetComb = (
  draft: MarkupDraft,
  patch: CombPatch,
  frame: SheetFrame,
  image: SheetImageData | null
): Pick<MarkupDraft, 'pins' | 'ruling'> | null => {
  const target: SheetRuling = { ...draft.ruling, ...patch, bend: null };
  const placed = normalizePins(placePinsOnComb(target, draft.pins));
  const pins =
    fitRulingPins(target, placed, frame).status === 'fitted'
      ? placed
      : deriveRulingPins(target, frame);

  if (fitRulingPins(target, pins, frame).status !== 'fitted') {
    return null;
  }

  const traced =
    image && draft.kind !== 'blank' ? refitBendToPins(image, target, pins, frame) : null;

  /**
   * Без прослеженного изгиба доводить нечего: булавки стоят на линиях
   * гребёнки точно.
   */
  return { pins, ruling: traced || target };
};

/**
 * Точка, в которую перетащили бы верхнюю или нижнюю направляющую, чтобы поле
 * стало равно числу: поле хранится высотой у левого края кадра.
 *
 * @param side — какое поле
 * @param value — поле, px фотографии
 * @param frame — кадр фотографии
 * @returns точка направляющей, px фотографии
 */
export const toMarginPoint = (
  side: GuideMarginSide,
  value: number,
  frame: SheetFrame
): SheetPoint => {
  switch (side) {
    case 'top': {
      return { x: 0, y: value };
    }

    case 'bottom': {
      return { x: 0, y: frame.height - value };
    }

    default: {
      throw new Error(`Неизвестное поле: ${String(side)}`);
    }
  }
};
