import { cx } from '@shared/lib/styles';
import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { Fragment, useMemo } from 'react';
import { createPortal } from 'react-dom';

import { formatNumber, NBSP } from '../../../../../lib/format/formatNumber';
import type { RulingPinsFit, SheetPoint } from '../../../../../lib/paper';
import { fitRulingPins } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupMoveSource } from '../MarkupHandle';
import { MarkupHandle } from '../MarkupHandle';
import { useMarkupMirrorWidth } from '../MarkupViewport';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import { measurePinMiss, normalizePins, type PinEnd, readGapSteps } from './linesPins';
import { PinStepsBadge } from './PinStepsBadge';
import { useLinesEdit } from './useLinesEdit';

/**
 * Невязка, после которой булавка подсвечивается: линии обязаны проходить
 * через закреплённые не дальше пикселя фотографии.
 */
const MAX_RESIDUAL_PX = 1;

const END_LABELS: Record<PinEnd, string> = {
  left: 'левый конец',
  right: 'правый конец',
};

/**
 * Подписи концов на зеркальной странице: левый конец булавки листа стоит там
 * справа, и читалка называет его тем концом, который видно.
 */
const MIRROR_END_LABELS: Record<PinEnd, string> = {
  left: END_LABELS.right,
  right: END_LABELS.left,
};

const PIN_ENDS: PinEnd[] = ['left', 'right'];

/**
 * Почему расстановка булавок разлиновку не задаёт.
 *
 * @param fit — подгонка по булавкам
 * @returns текст для пользователя; `null` — расстановка годна
 */
const describeRejectedFit = (fit: RulingPinsFit): string | null => {
  switch (fit.status) {
    case 'fitted': {
      return null;
    }

    case 'degenerate': {
      return 'Закреплённые линии не задают разлиновку: у линии нет длины, линии идут не сверху вниз по номерам или число шагов между ними не указано. Разлиновка осталась прежней.';
    }

    case 'beyondHorizon': {
      return 'Закреплённые линии сходятся внутри кадра — такой разлиновки у листа не бывает. Разлиновка осталась прежней.';
    }

    default: {
      throw new Error(`Неизвестный итог подгонки: ${String(fit)}`);
    }
  }
};

/**
 * Невязка булавки для панели.
 *
 * @param residual — невязка, px фотографии; `undefined` — гребёнки нет
 * @returns например «0,4 px»
 */
const formatResidual = (residual: number | undefined): string => {
  return residual === undefined
    ? '—'
    : `${formatNumber(residual, { fractionDigits: 1, isSigned: false })}${NBSP}px`;
};

/**
 * Инструмент «Линии»: закреплённые линии — булавки, через которые проходит
 * гребёнка. Концы булавок перетаскиваются на настоящие линии фотографии и по
 * отпусканию притягиваются к ближайшей тёмной линии; Alt/Option магнит
 * отключает. Между соседними булавками — число шагов с кнопками ±.
 *
 * На зеркальной странице концы булавок стоят в отражённом слое ручек:
 * правятся булавки самого листа, и зеркало их отражает.
 */
export const LinesTool: FC<MarkupToolProps> = (props) => {
  const { handleLayer } = props;
  const endLabels = useMarkupMirrorWidth() === null ? END_LABELS : MIRROR_END_LABELS;
  const record = useMarkupEditorStore((state) => {
    return state.record;
  });
  const draft = useMarkupEditorStore((state) => {
    return state.draft;
  });
  const width = record?.sheet.width || 0;
  const height = record?.sheet.height || 0;
  const frame = useMemo(() => {
    return { width, height };
  }, [width, height]);
  const { lastEditedOrder, moveEnd, releaseEnd, changeGapSteps, addPin, removePin } =
    useLinesEdit(frame);

  /**
   * Подгонка по булавкам черновика — ради признака, задают ли они разлиновку.
   * Гаусс — Ньютон на каждый рендер не нужен: булавки меняются только правкой.
   */
  const fit = useMemo(() => {
    return draft ? fitRulingPins(draft.ruling, normalizePins(draft.pins), frame) : null;
  }, [draft, frame]);

  if (!draft || !fit) {
    return null;
  }

  const { pins } = draft;
  const gapSteps = readGapSteps(pins);
  const rejection = lastEditedOrder === null ? null : describeRejectedFit(fit);
  const residuals = pins.map((pin) => {
    return measurePinMiss(draft.ruling, pin);
  });
  const canAddPin =
    draft.ruling.step > 0 &&
    gapSteps.some((steps) => {
      return steps >= 2;
    });

  /**
   * Подсвечивается булавка, которая не держит линию: при негодной расстановке
   * — последняя правленая, иначе — та, до линии которой больше пикселя.
   *
   * @param order — булавка
   * @returns подсвечена ли
   */
  const isPinFlagged = (order: number): boolean => {
    return rejection
      ? order === lastEditedOrder
      : (residuals[order] || 0) > MAX_RESIDUAL_PX;
  };

  const handleAddPinClick = () => {
    addPin();
  };

  const handles = pins.flatMap((pin, order) => {
    return PIN_ENDS.map((end) => {
      const { x, y } = pin[end];

      const handleEndMove = (point: SheetPoint) => {
        moveEnd(order, end, point);
      };

      const handleEndMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
        releaseEnd(order, end, point, source);
      };

      return (
        <MarkupHandle
          key={`${order}-${end}`}
          x={x}
          y={y}
          label={`Закреплённая линия ${order + 1}, ${endLabels[end]}`}
          className={cx(
            'in-data-pan-mode:pointer-events-none',
            isPinFlagged(order) && 'stroke-danger'
          )}
          onMove={handleEndMove}
          onMoveEnd={handleEndMoveEnd}
        />
      );
    });
  });

  return (
    <section aria-label="Линии листа" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Перетащите концы закреплённых линий на линии фотографии — разлиновка пройдёт через
        них. Конец притягивается к ближайшей линии; с Alt/Option — нет.
      </p>

      {rejection ? (
        <p role="alert" className="rounded-md border border-danger p-2 text-xs text-fg">
          {rejection}
        </p>
      ) : null}

      <ol aria-label="Закреплённые линии" className="flex flex-col gap-1">
        {pins.map((_pin, order) => {
          const steps = gapSteps[order - 1];

          const handleStepsChange = (delta: number) => {
            changeGapSteps(order - 1, delta);
          };

          const handleRemoveClick = () => {
            removePin(order);
          };

          return (
            <Fragment key={order}>
              {steps === undefined ? null : (
                <li className="list-none">
                  <PinStepsBadge
                    upperNumber={order}
                    steps={steps}
                    onStepsChange={handleStepsChange}
                  />
                </li>
              )}

              <li
                aria-label={`Закреплённая линия ${order + 1}`}
                className={cx(
                  'flex items-center justify-between gap-2 rounded-md border border-border-strong px-2 py-1',
                  isPinFlagged(order) && 'border-danger'
                )}
              >
                <span className="text-fg">Линия {order + 1}</span>

                <span className="text-xs text-fg-muted tabular-nums">
                  невязка {formatResidual(residuals[order])}
                </span>

                <Button
                  variant="ghost"
                  isDisabled={pins.length <= 2}
                  onClick={handleRemoveClick}
                >
                  Открепить
                </Button>
              </li>
            </Fragment>
          );
        })}
      </ol>

      <Button variant="secondary" isDisabled={!canAddPin} onClick={handleAddPinClick}>
        Закрепить ещё линию
      </Button>

      {handleLayer ? createPortal(<g data-tool="lines">{handles}</g>, handleLayer) : null}
    </section>
  );
};
