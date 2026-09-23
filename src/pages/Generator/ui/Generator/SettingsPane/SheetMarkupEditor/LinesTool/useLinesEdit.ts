import { useState } from 'react';

import type {
  RulingPin,
  SheetFrame,
  SheetPoint,
  SheetRuling,
} from '../../../../../lib/paper';
import { fitRulingPins } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupCommitOptions } from '../../../../../model/useMarkupEditorStore.types';
import type { MarkupMoveSource } from '../MarkupHandle';

import {
  fitPinsWithBend,
  insertPin,
  movePinEnd,
  normalizePins,
  type PinEnd,
  shiftGapSteps,
  snapPinEnd,
} from './linesPins';
import { useAltKeyRef } from './useAltKeyRef';
import type { LinesEdit } from './useLinesEdit.types';

/**
 * Точка, сдвинутая внутрь кадра: конец булавки за краем фотографии не на
 * линии листа.
 *
 * @param point — точка, px фотографии
 * @param frame — кадр фотографии
 * @returns точка внутри кадра
 */
const clampToFrame = (point: SheetPoint, frame: SheetFrame): SheetPoint => {
  return {
    x: Math.min(Math.max(point.x, 0), frame.width),
    y: Math.min(Math.max(point.y, 0), frame.height),
  };
};

/**
 * Правка закреплённых линий: перетаскивание концов, число шагов между
 * булавками, новые и снятые булавки. Каждая правка подгоняет гребёнку через
 * булавки и заново прослеживает изгиб по фотографии; расстановка, которая
 * гребёнку не задаёт, разлиновку не меняет — булавки встают, где их
 * поставили, а подсвечивается последняя правленая.
 *
 * Каналы фотографии для магнита и изгиба берутся из стора в момент правки:
 * при открытии с плитки они приходят позже редактора, и до них правка идёт
 * без магнита и без изгиба.
 *
 * @param frame — кадр фотографии
 * @returns методы правки и последняя правленая булавка
 */
export const useLinesEdit = (frame: SheetFrame): LinesEdit => {
  const isAltRef = useAltKeyRef();
  const [lastEditedOrder, setLastEditedOrder] = useState<number | null>(null);

  /**
   * Кладёт булавки в черновик шагом истории вместе с разлиновкой через них.
   *
   * @param pins — булавки после правки
   * @param base — разлиновка до правки: остаётся, если булавки её не задают
   * @param order — правленая булавка
   * @param options — склейка шагов истории
   */
  const applyPins = (
    pins: RulingPin[],
    base: SheetRuling,
    order: number | null,
    options?: MarkupCommitOptions
  ) => {
    const { draft, image, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const normalized = normalizePins(pins);
    const fit = fitPinsWithBend(
      base,
      normalized,
      frame,
      draft.kind === 'blank' ? null : image
    );

    commit(
      { pins: normalized, ruling: fit.status === 'fitted' ? fit.ruling : base },
      options
    );
    setLastEditedOrder(order);
  };

  const moveEnd = (order: number, end: PinEnd, point: SheetPoint) => {
    const { draft, preview } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const pins = movePinEnd(draft.pins, order, end, clampToFrame(point, frame));
    const fit = fitRulingPins(draft.ruling, normalizePins(pins), frame);

    preview(fit.status === 'fitted' ? { pins, ruling: fit.ruling } : { pins });
  };

  const releaseEnd = (
    order: number,
    end: PinEnd,
    point: SheetPoint,
    source: MarkupMoveSource
  ) => {
    const { draft, history, image } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    /**
     * Разлиновка до перетаскивания: промежуточные гребёнки — только показ, и
     * магнит меряет шаг по той, что была до него.
     */
    const base = (history.previewBase || draft).ruling;
    const clamped = clampToFrame(point, frame);
    const isMagnetOn =
      source === 'pointer' &&
      !isAltRef.current &&
      draft.kind !== 'blank' &&
      image !== null;
    const target = isMagnetOn ? snapPinEnd(image, base, clamped) : clamped;

    applyPins(movePinEnd(draft.pins, order, end, target), base, order);
  };

  const changeGapSteps = (gap: number, delta: number) => {
    const { draft } = useMarkupEditorStore.getState();
    const pins = draft && shiftGapSteps(draft.pins, gap, delta);

    if (!draft || !pins) {
      return;
    }

    /**
     * Нажатия подряд по одному промежутку — один шаг истории: «с 10 на 20» —
     * одна правка, а не десять.
     */
    applyPins(pins, draft.ruling, gap + 1, { coalesceKey: `lines-gap-${gap}` });
  };

  const addPin = () => {
    const { draft } = useMarkupEditorStore.getState();
    const pins = draft && insertPin(draft.ruling, draft.pins);

    if (!draft || !pins) {
      return;
    }

    const order = pins.findIndex((pin) => {
      return !draft.pins.includes(pin);
    });

    applyPins(pins, draft.ruling, order);
  };

  const removePin = (order: number) => {
    const { draft } = useMarkupEditorStore.getState();

    if (!draft || draft.pins.length <= 2) {
      return;
    }

    applyPins(
      draft.pins.filter((_pin, index) => {
        return index !== order;
      }),
      draft.ruling,
      null
    );
  };

  return { lastEditedOrder, moveEnd, releaseEnd, changeGapSteps, addPin, removePin };
};
