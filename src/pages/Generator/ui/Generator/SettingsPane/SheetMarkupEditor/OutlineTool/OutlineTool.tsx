import { Spinner } from '@shared/ui/Spinner';
import type { FC } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import type { SheetOutline, SheetPoint } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { MarkupHandle } from '../MarkupHandle';
import { MarkupStroke } from '../MarkupStroke';
import { useMarkupMirrorWidth } from '../MarkupViewport';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import {
  checkOutline,
  clampToFrame,
  isSameOutline,
  OUTLINE_CORNERS,
  type OutlineCorner,
  resolveOutline,
} from './outlineGeometry';
import { remeasureOutline } from './remeasureOutline';

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
  const savedOutline = useMarkupEditorStore((state) => {
    return state.draft?.ruling.outline || null;
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

  if (!record) {
    return null;
  }

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
      setPending(null);

      return;
    }

    const verdict = checkOutline(next, frame);

    switch (verdict) {
      case 'inverted': {
        setPending(null);
        setMessage(INVERTED_MESSAGE);

        return;
      }

      case 'narrow': {
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

    if (status === 'failed') {
      setMessage(DECODE_MESSAGE);
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

    return (
      <MarkupHandle
        key={corner}
        x={x}
        y={y}
        label={cornerLabels[corner]}
        className="in-data-pan-mode:pointer-events-none"
        onMove={handleCornerMove}
        onMoveEnd={handleCornerMoveEnd}
      />
    );
  });

  return (
    <section aria-label="Контур листа" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Перетащите углы на углы листа. Отпущенный угол перемеряет лист внутри контура:
        линии, поля, свет и текстуру.
      </p>

      {isRemeasuring ? (
        <p role="status" className="flex items-center gap-2 text-fg-muted">
          <Spinner />
          Лист перемеряется внутри нового контура…
        </p>
      ) : null}

      {message ? (
        <p role="alert" className="rounded-md border border-danger p-2 text-xs text-fg">
          {message}
        </p>
      ) : null}

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
