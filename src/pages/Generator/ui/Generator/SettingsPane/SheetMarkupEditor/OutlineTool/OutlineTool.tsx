import { cx } from '@shared/lib/styles';
import { Spinner } from '@shared/ui/Spinner';
import type { FC } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import type { SheetOutline, SheetPoint } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { clampToFrame } from '../markupGeometry';
import { MarkupHandle } from '../MarkupHandle';
import { MarkupLiveRegion } from '../MarkupLiveRegion';
import { MarkupStroke } from '../MarkupStroke';
import { useMarkupMirrorWidth } from '../MarkupViewport';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import {
  checkOutline,
  isSameOutline,
  OUTLINE_CORNERS,
  resolveOutline,
} from './outlineGeometry';
import type { OutlineCorner, OutlineNotice } from './OutlineTool.types';
import { cancelOutlineRemeasure, remeasureOutline } from './remeasureOutline';

const CORNER_LABELS: Record<OutlineCorner, string> = {
  topLeft: 'Левый верхний угол листа',
  topRight: 'Правый верхний угол листа',
  bottomRight: 'Правый нижний угол листа',
  bottomLeft: 'Левый нижний угол листа',
};

/**
 * Подписи углов на зеркальной странице: угол листа стоит там по другую
 * сторону, и читалка называет его тем углом, который видно.
 */
const MIRROR_CORNER_LABELS: Record<OutlineCorner, string> = {
  topLeft: CORNER_LABELS.topRight,
  topRight: CORNER_LABELS.topLeft,
  bottomRight: CORNER_LABELS.bottomLeft,
  bottomLeft: CORNER_LABELS.bottomRight,
};

/**
 * Толщина контура, который тянут, в экранных пикселях — как у контура листа.
 */
const PENDING_WIDTH = 2;

/**
 * Пунктир контура, который тянут, в экранных пикселях: он ещё не применён.
 */
const PENDING_DASH: [number, number] = [6, 4];

const INVERTED_MESSAGE =
  'Контур не применён: он вывернут. Углы должны обходить лист по кругу, не пересекая стороны.';

const NARROW_MESSAGE =
  'Контур не применён: он слишком узкий — от кадра остаётся меньше четверти ширины или высоты.';

const DECODE_MESSAGE = 'Не удалось прочитать фотографию: разметка осталась прежней.';

/**
 * Подсказка листа с разлиновкой. Перемер молча заменил бы поля и линии,
 * поправленные руками, поэтому об этом сказано до того, как угол отпущен.
 */
const RULED_HINT =
  'Перетащите углы на\u00A0углы листа. Отпущенный угол перемеряет лист внутри контура: линии, поля, свет и\u00A0текстуру. Ручные правки линий и\u00A0полей при этом заменяются найденными\u00A0— вернуть их можно кнопкой «Отменить».';

/**
 * Подсказка чистого листа: линий на нём не ищут, и заданное руками остаётся.
 */
const BLANK_HINT =
  'Перетащите углы на\u00A0углы листа. Отпущенный угол перемеряет свет и\u00A0текстуру внутри контура; шаг и\u00A0первая линия остаются, а\u00A0поля подтягиваются внутрь нового контура.';

const REMEASURING_MESSAGE = 'Лист перемеряется внутри нового контура…';

const RULED_APPLIED_MESSAGE =
  'Лист перемерен по\u00A0новому контуру. Правки линий и\u00A0полей заменены найденными\u00A0— «Отменить» вернёт их.';

const BLANK_APPLIED_MESSAGE =
  'Лист перемерен по\u00A0новому контуру: свет и\u00A0текстура сняты заново, поля внутри листа.';

/**
 * Контур в атрибут `points` многоугольника SVG.
 *
 * @param outline — контур
 * @returns точки по обходу углов
 */
const toPolygonPoints = (outline: SheetOutline): string => {
  return OUTLINE_CORNERS.map((corner) => {
    const { x, y } = outline[corner];

    return `${x},${y}`;
  }).join(' ');
};

/**
 * Инструмент «Контур»: четыре угла листа, каждый перетаскивается отдельно, в
 * том числе в четырёхугольник, а не прямоугольник, — лист, снятый на столе.
 *
 * Отпущенный угол перемеряет лист внутри нового контура. Вывернутый или
 * слишком узкий контур не применяется: причина видна у инструмента, и
 * разметка не трогается. Пока идёт перемер, углы стоят, куда их отпустили, а
 * сохранение ждёт.
 *
 * На зеркальной странице углы стоят в отражённом слое ручек: правится контур
 * самого листа, и зеркало его отражает.
 */
export const OutlineTool: FC<MarkupToolProps> = (props) => {
  const { handleLayer } = props;
  const cornerLabels =
    useMarkupMirrorWidth() === null ? CORNER_LABELS : MIRROR_CORNER_LABELS;
  const record = useMarkupEditorStore((state) => {
    return state.record;
  });
  const draft = useMarkupEditorStore((state) => {
    return state.draft;
  });
  /**
   * Статус — только своего перемера: поиск линий после смены вида показывает
   * свой у переключателя вида.
   */
  const isRemeasuring = useMarkupEditorStore((state) => {
    return state.remeasuringSources.includes('outline');
  });
  const [pending, setPending] = useState<SheetOutline | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Итог последнего перемера: без него отпущенный угол менял бы разметку
   * молча.
   */
  const [notice, setNotice] = useState<OutlineNotice | null>(null);

  if (!record || !draft) {
    return null;
  }

  const isBlank = draft.kind === 'blank';
  const savedOutline = draft.ruling.outline;
  /**
   * Итог перемера верен, пока разметка — его итог: после отмены или правки
   * «Лист перемерен» говорил бы уже не о том, что видно.
   */
  const shownNotice = notice?.draft === draft ? notice.text : null;

  const frame = { width: record.sheet.width, height: record.sheet.height };
  const current = resolveOutline(savedOutline, frame);
  const outline = pending || current;

  /**
   * Контур с одним сдвинутым углом.
   *
   * @param corner — угол
   * @param point — куда его сдвинули, px фотографии
   * @returns контур
   */
  const moveCorner = (corner: OutlineCorner, point: SheetPoint): SheetOutline => {
    return { ...outline, [corner]: clampToFrame(point, frame) };
  };

  /**
   * Проверяет отпущенный контур и перемеряет лист внутри него. Контур
   * остаётся на месте, пока идёт перемер, и уходит, когда итог лёг в
   * черновик или не лёг вовсе.
   *
   * @param next — отпущенный контур
   */
  const applyOutline = async (next: SheetOutline) => {
    if (isSameOutline(next, current)) {
      cancelOutlineRemeasure();
      setPending(null);

      return;
    }

    setNotice(null);

    const verdict = checkOutline(next, frame);

    switch (verdict) {
      case 'inverted': {
        cancelOutlineRemeasure();
        setPending(null);
        setMessage(INVERTED_MESSAGE);

        return;
      }

      case 'narrow': {
        cancelOutlineRemeasure();
        setPending(null);
        setMessage(NARROW_MESSAGE);

        return;
      }

      case 'usable': {
        break;
      }

      default: {
        throw new Error(`Неизвестный вердикт контура: ${String(verdict)}`);
      }
    }

    setPending(next);
    setMessage(null);

    const status = await remeasureOutline(next);

    /**
     * Пока шёл перемер, угол могли потянуть снова: новый контур не
     * снимается ответом на прежний.
     */
    setPending((shown) => {
      return shown === next && status !== 'dropped' ? null : shown;
    });

    switch (status) {
      case 'applied': {
        setNotice({
          text: isBlank ? BLANK_APPLIED_MESSAGE : RULED_APPLIED_MESSAGE,
          draft: useMarkupEditorStore.getState().draft,
        });
        break;
      }

      case 'failed': {
        setMessage(DECODE_MESSAGE);
        break;
      }

      case 'dropped': {
        break;
      }

      default: {
        throw new Error(`Неизвестный итог перемера: ${String(status)}`);
      }
    }
  };

  const handles = OUTLINE_CORNERS.map((corner) => {
    const { x, y } = outline[corner];

    const handleCornerMove = (point: SheetPoint) => {
      setPending(moveCorner(corner, point));
    };

    const handleCornerMoveEnd = (point: SheetPoint) => {
      void applyOutline(moveCorner(corner, point));
    };

    const handleCornerMoveCancel = () => {
      setPending(null);
    };

    return (
      <MarkupHandle
        key={corner}
        kind="corner"
        x={x}
        y={y}
        label={cornerLabels[corner]}
        className="in-data-pan-mode:pointer-events-none"
        onMove={handleCornerMove}
        onMoveEnd={handleCornerMoveEnd}
        onMoveCancel={handleCornerMoveCancel}
      />
    );
  });

  return (
    <section aria-label="Контур листа" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">{isBlank ? BLANK_HINT : RULED_HINT}</p>

      <MarkupLiveRegion
        tone="status"
        message={
          isRemeasuring ? (
            <>
              <Spinner />
              {REMEASURING_MESSAGE}
            </>
          ) : (
            shownNotice
          )
        }
        className={cx('text-fg-muted', isRemeasuring && 'flex items-center gap-2')}
      />

      <MarkupLiveRegion
        tone="alert"
        message={message}
        className="rounded-md border border-danger p-2 text-xs text-fg"
      />

      {handleLayer
        ? createPortal(
            <g data-tool="outline">
              {pending ? (
                <MarkupStroke
                  dash={PENDING_DASH}
                  fill="none"
                  width={PENDING_WIDTH}
                  className="stroke-markup-outline"
                >
                  <polygon points={toPolygonPoints(pending)} />
                </MarkupStroke>
              ) : null}

              {handles}
            </g>,
            handleLayer
          )
        : null}
    </section>
  );
};
