import { useEffect, useRef, useState } from 'react';

import type {
  SheetFrame,
  SheetPoint,
  SheetRuling,
  SideEdge,
} from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';
import { toPhotoPoint } from '../BendTool/bendGeometry';
import { placeMirrorCorner } from '../MirrorTab/MirrorOverride/mirrorOverrideMarkup';

import {
  placeMargin,
  placeMarginCorner,
  placeMarginLine,
  placeSideEnd,
  removeMarginLine as removeRulingMarginLine,
  resolveAddedMarginLinePoint,
  snapMarginLineX,
} from './marginsGeometry';
import type {
  GuideMarginSide,
  MarginCorner,
  MarginCornerMove,
  SideHandleEnd,
} from './marginsGeometry.types';
import type { MarginsEdit } from './useMarginsEdit.types';

/**
 * Показывает линию поля без наклона в столбце точки — без шага истории.
 *
 * @param frame — кадр фотографии
 * @param point — точка, px фотографии
 */
const previewMarginLine = (frame: SheetFrame, point: SheetPoint) => {
  const { draft, preview } = useMarkupEditorStore.getState();

  if (!draft) {
    return;
  }

  preview({ ruling: placeMarginLine(draft.ruling, frame, point) });
};

/**
 * Ставит добавленную линию поля без наклона в столбец точки, притянув её к
 * черте фотографии, — шаг истории. Каналы фотографии для магнита берутся из стора в момент вызова:
 * при открытии с плитки они приходят позже редактора, и до них магнита нет.
 * У листа без разлиновки магнита нет вовсе — притягивать не к чему.
 *
 * @param frame — кадр фотографии
 * @param point — точка, px фотографии
 * @param shouldSnap — притягивать ли к черте: сдвиг стрелкой — точная правка
 *   на пиксель, и магнит вернул бы линию на место
 */
const commitMarginLine = (frame: SheetFrame, point: SheetPoint, shouldSnap = true) => {
  const { draft, image, commit } = useMarkupEditorStore.getState();

  if (!draft) {
    return;
  }

  const x =
    shouldSnap && image && draft.kind !== 'blank'
      ? snapMarginLineX(image, draft.ruling, point)
      : point.x;

  commit({ ruling: placeMarginLine(draft.ruling, frame, { x, y: point.y }) });
};

/**
 * Столбец фотографии в середине видимой части окна просмотра. Окно — блок, в
 * котором позиционирована сцена с фотографией и оверлеем; обратная экранная
 * матрица SVG переводит его середину в пиксели фотографии с приближением и
 * сдвигом.
 *
 * @param svg — SVG оверлея
 * @returns столбец, px фотографии; `null` — окна или матрицы нет
 */
const readVisibleCenterX = (svg: SVGSVGElement | null | undefined): number | null => {
  const viewport = svg?.parentElement?.offsetParent;

  if (!viewport) {
    return null;
  }

  const { left, right, top, bottom } = viewport.getBoundingClientRect();

  if (!(right > left)) {
    return null;
  }

  const point = toPhotoPoint(svg, (left + right) / 2, (top + bottom) / 2);

  return point ? point.x : null;
};

/**
 * Правка полей и линии поля черновика. Перетаскивание показывает
 * направляющую, где указатель, без шага истории; отпускание ставит верхнюю и
 * нижнюю на линию разлиновки, а ручку линии поля — на черту фотографии, и
 * записывает шаг. Угол области текста двигает сразу направляющую и конец
 * своего бокового поля — одним шагом истории. Линия поля правится двумя
 * ручками: она проходит через обе. Стрелка — точная правка на пиксель, и
 * магнит её не отменяет.
 *
 * Добавленная линия поля встаёт в восьмую ширины листа от стороны, ближайшей
 * к середине видимой части фотографии, и сразу тянется: идёт за указателем
 * над фотографией, пока нажатие на фотографии её не поставит. Указатель,
 * ушедший с фотографии, возвращает её на место появления — иначе путь к
 * панели утащил бы её к краю листа. Любая другая правка черновика, отмена в
 * том числе, ведение прекращает.
 *
 * На зеркальной странице углы — видимые углы её области текста: по высоте
 * они правят общую направляющую, по горизонтали — поля зеркала.
 *
 * @param frame — кадр фотографии
 * @param handleLayer — слой ручек оверлея; `null` — линию поля не ведут
 *   указателем, а только ставят
 * @param isMirrorPage — правится ли зеркальная страница
 * @returns методы правки и идёт ли ведение добавленной линии
 */
export const useMarginsEdit = (
  frame: SheetFrame,
  handleLayer: SVGGElement | null,
  isMirrorPage: boolean
): MarginsEdit => {
  const [isFollowing, setIsFollowing] = useState(false);

  /**
   * Черновик сразу после добавления линии: ведение идёт, пока правки поверх
   * него — только показ ведомой линии.
   */
  const addedRef = useRef<MarkupDraft | null>(null);

  useEffect(() => {
    const svg = handleLayer?.ownerSVGElement;

    if (!isFollowing || !svg) {
      return;
    }

    /**
     * Черновик, от которого идёт ведение, если его не сменила другая правка.
     *
     * @returns черновик добавления; `null` — ведение пора прекратить
     */
    const readAdded = (): MarkupDraft | null => {
      const { draft, history } = useMarkupEditorStore.getState();
      const added = addedRef.current;

      return added && (history.previewBase || draft) === added ? added : null;
    };

    const stop = () => {
      addedRef.current = null;
      setIsFollowing(false);
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const point = toPhotoPoint(svg, event.clientX, event.clientY);

      if (!readAdded()) {
        stop();

        return;
      }

      if (point) {
        previewMarginLine(frame, point);
      }
    };

    const handlePointerLeave = () => {
      const added = readAdded();

      if (!added) {
        stop();

        return;
      }

      useMarkupEditorStore.getState().preview({ ruling: added.ruling });
    };

    /**
     * Нажатие ставит линию и дальше не идёт: окно просмотра под ним иначе
     * начало бы сдвигать фотографию, а ручка — перетаскивание. Нажатие в
     * режиме сдвига пробелом остаётся окну.
     *
     * @param event — нажатие
     */
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const point = toPhotoPoint(svg, event.clientX, event.clientY);

      if (svg.closest('[data-pan-mode]') || !point) {
        return;
      }

      if (readAdded()) {
        event.stopPropagation();
        commitMarginLine(frame, point);
      }

      stop();
    };

    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('pointerleave', handlePointerLeave);
    svg.addEventListener('pointerdown', handlePointerDown);

    return () => {
      svg.removeEventListener('pointermove', handlePointerMove);
      svg.removeEventListener('pointerleave', handlePointerLeave);
      svg.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isFollowing, handleLayer, frame]);

  const moveMargin = (side: GuideMarginSide, point: SheetPoint) => {
    const { draft, preview } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const margins = placeMargin(draft.ruling, frame, side, point, false);

    preview({ ruling: { ...draft.ruling, margins } });
  };

  const releaseMargin = (
    side: GuideMarginSide,
    point: SheetPoint,
    shouldSnap: boolean
  ) => {
    const { draft, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const margins = placeMargin(draft.ruling, frame, side, point, shouldSnap);

    commit({ ruling: { ...draft.ruling, margins } });
  };

  /**
   * Разлиновка после сдвига угла на странице, которая сейчас правится.
   *
   * @param ruling — разлиновка листа
   * @param corner — угол
   * @param point — точка угла, px листа
   * @param move — как сдвинули
   * @returns разлиновка
   */
  const placeCorner = (
    ruling: SheetRuling,
    corner: MarginCorner,
    point: SheetPoint,
    move: MarginCornerMove
  ): SheetRuling => {
    return isMirrorPage
      ? placeMirrorCorner(ruling, frame, corner, point, move)
      : placeMarginCorner(ruling, frame, corner, point, move);
  };

  const moveCorner = (corner: MarginCorner, point: SheetPoint) => {
    const { draft, preview } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    preview({ ruling: placeCorner(draft.ruling, corner, point, 'drag') });
  };

  /**
   * Стрелка вдоль строк на зеркале с отражёнными полями угол не двигает —
   * такой сдвиг шагом истории не становится.
   *
   * @param corner — угол
   * @param point — точка угла, px листа
   * @param move — как сдвинули
   */
  const releaseCorner = (
    corner: MarginCorner,
    point: SheetPoint,
    move: MarginCornerMove
  ) => {
    const { draft, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const ruling = placeCorner(draft.ruling, corner, point, move);

    if (ruling !== draft.ruling) {
      commit({ ruling });
    }
  };

  const moveSideEnd = (edge: SideEdge, end: SideHandleEnd, point: SheetPoint) => {
    const { draft, preview } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    preview({ ruling: placeSideEnd(draft.ruling, frame, edge, end, point) });
  };

  /**
   * Ручка линии поля с магнитом встаёт на черту фотографии в своей строке —
   * у каждой ручки своя точка черты, и линия поля ложится вдоль наклонной
   * черты. Каналы фотографии берутся из стора в момент вызова, как у
   * добавления линии.
   *
   * @param edge — какая граница
   * @param end — какая ручка
   * @param point — точка отпускания, px фотографии
   * @param shouldSnap — притягивать ли линию поля к черте
   */
  const releaseSideEnd = (
    edge: SideEdge,
    end: SideHandleEnd,
    point: SheetPoint,
    shouldSnap: boolean
  ) => {
    const { draft, image, commit } = useMarkupEditorStore.getState();

    if (!draft) {
      return;
    }

    const target =
      edge === 'marginLine' && shouldSnap && image && draft.kind !== 'blank'
        ? { x: snapMarginLineX(image, draft.ruling, point), y: point.y }
        : point;

    commit({ ruling: placeSideEnd(draft.ruling, frame, edge, end, target) });
  };

  const removeMarginLine = () => {
    const { commit } = useMarkupEditorStore.getState();

    commit((draft) => {
      return { ruling: removeRulingMarginLine(draft.ruling) };
    });
  };

  const addMarginLine = () => {
    const svg = handleLayer?.ownerSVGElement;
    const { commit } = useMarkupEditorStore.getState();

    commit((draft) => {
      const point = resolveAddedMarginLinePoint(
        draft.ruling,
        frame,
        readVisibleCenterX(svg)
      );

      return { ruling: placeMarginLine(draft.ruling, frame, point) };
    });

    addedRef.current = useMarkupEditorStore.getState().draft;
    setIsFollowing(Boolean(svg && addedRef.current));
  };

  return {
    isFollowing,
    moveMargin,
    releaseMargin,
    moveCorner,
    releaseCorner,
    moveSideEnd,
    releaseSideEnd,
    removeMarginLine,
    addMarginLine,
  };
};
