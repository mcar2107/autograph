import { cx } from '@shared/lib/styles';
import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { Fragment, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatNumber, NBSP } from '../../../../../lib/format/formatNumber';
import type { RulingPinsFit, SheetPoint } from '../../../../../lib/paper';
import { fitRulingPins } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupMoveSource } from '../MarkupHandle';
import { MarkupHandle } from '../MarkupHandle';
import { MarkupLiveRegion } from '../MarkupLiveRegion';
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

/**
 * Невязка, начиная с которой она показывается: меньше полупикселя линия
 * проходит через булавку на глаз точно, и «невязка 0 px» у каждой карточки
 * только шумит.
 */
const SHOWN_RESIDUAL_PX = 0.5;

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
 * @param residual — невязка, px фотографии
 * @returns например «0,8 px»
 */
const formatResidual = (residual: number): string => {
  return `${formatNumber(residual, { fractionDigits: 1, isSigned: false })}${NBSP}px`;
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
  /**
   * Пока ручку тянут, гребёнка промежуточная: изгиб к ней ещё не подогнан, и
   * невязка каждой булавки на ней — не итог правки, а шум.
   */
  const isDragging = useMarkupEditorStore((state) => {
    return state.history.previewBase !== null;
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
  const rejection = fit && lastEditedOrder !== null ? describeRejectedFit(fit) : null;
  /**
   * Отказ, который читает живая область. Пока ручку тянут, он держит прежний:
   * расстановка на каждом движении то годна, то нет, и читалка объявляла бы
   * каждое переключение. Итог правки объявляется по отпусканию.
   */
  const [announcedRejection, setAnnouncedRejection] = useState(rejection);

  if (!isDragging && announcedRejection !== rejection) {
    setAnnouncedRejection(rejection);
  }

  if (!draft || !fit) {
    return null;
  }

  const { pins } = draft;
  const gapSteps = readGapSteps(pins);
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
   * — последняя правленая, иначе — та, до линии которой больше пикселя. Пока
   * ручку тянут, по невязке не подсвечивается ни одна.
   *
   * @param order — булавка
   * @returns подсвечена ли
   */
  const isPinFlagged = (order: number): boolean => {
    if (rejection) {
      return order === lastEditedOrder;
    }

    return !isDragging && (residuals[order] || 0) > MAX_RESIDUAL_PX;
  };

  /**
   * Невязка для карточки булавки: после отпускания и заметная.
   *
   * @param order — булавка
   * @returns невязка, px; `null` — не показывается
   */
  const readShownResidual = (order: number): number | null => {
    const residual = residuals[order];

    return !isDragging && residual !== undefined && residual >= SHOWN_RESIDUAL_PX
      ? residual
      : null;
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
          kind="lineEnd"
          x={x}
          y={y}
          label={`Закреплённая линия ${order + 1}, ${endLabels[end]}`}
          isFlagged={isPinFlagged(order)}
          className="in-data-pan-mode:pointer-events-none"
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

      <MarkupLiveRegion
        tone="alert"
        message={announcedRejection}
        className="rounded-md border border-danger p-2 text-xs text-fg"
      />

      <ol aria-label="Закреплённые линии" className="flex flex-col gap-1">
        {pins.map((_pin, order) => {
          const steps = gapSteps[order - 1];

          const handleStepsChange = (delta: number) => {
            changeGapSteps(order - 1, delta);
          };

          const handleRemoveClick = () => {
            removePin(order);
          };

          const residual = readShownResidual(order);

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

                {residual === null ? null : (
                  <span className="text-xs text-fg-muted tabular-nums">
                    невязка {formatResidual(residual)}
                  </span>
                )}

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
