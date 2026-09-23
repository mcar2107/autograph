import type { RadioGroupOption } from '@shared/ui/RadioGroup';
import { RadioGroup } from '@shared/ui/RadioGroup';
import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import type { FC } from 'react';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import type { MarginLineSide, SheetPoint } from '../../../../../../lib/paper';
import { mirrorSheetRuling } from '../../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../../model/useMarkupEditorStore';
import { ExactValueField } from '../../ExactValues/ExactValueField';
import { resolveMarginHandles } from '../../MarginsTool/marginsGeometry';
import type { MarkupMoveSource } from '../../MarkupHandle';
import { MarkupHandle } from '../../MarkupHandle';
import { mirrorMarkupPoint } from '../../MarkupViewport';

import type { MirrorOverrideProps } from './MirrorOverride.types';
import type { MirrorMarginSide } from './mirrorOverrideMarkup.types';
import { useMirrorOverrideEdit } from './useMirrorOverrideEdit';

const MODE_OPTIONS: RadioGroupOption[] = [
  { value: 'mirrored', label: 'Как у оригинала, отражённо' },
  { value: 'separate', label: 'Задать отдельно' },
];

const NO_MARGIN_LINE = 'none';

const MARGIN_LINE_OPTIONS: SegmentedControlOption[] = [
  { value: NO_MARGIN_LINE, label: 'Нет' },
  { value: 'left', label: 'Слева' },
  { value: 'right', label: 'Справа' },
];

const MIRROR_MARGIN_SIDES: MirrorMarginSide[] = ['left', 'right'];

const MARGIN_HANDLE_LABELS: Record<MirrorMarginSide, string> = {
  left: 'Левое поле зеркала',
  right: 'Правое поле зеркала',
};

const MARGIN_FIELD_LABELS: Record<MirrorMarginSide, string> = {
  left: 'Левое поле зеркала, px',
  right: 'Правое поле зеркала, px',
};

/**
 * Сторона линии поля из переключателя.
 *
 * @param value — значение переключателя
 * @returns сторона; `null` — линии нет
 */
const toMarginLineSide = (value: string): MarginLineSide | null => {
  switch (value) {
    case 'left': {
      return 'left';
    }

    case 'right': {
      return 'right';
    }

    default: {
      return null;
    }
  }
};

/**
 * Линия поля и боковые поля зеркальной страницы: по умолчанию отражены из
 * листа, по выбору — свои. Свои правятся числами и, пока выбран инструмент
 * «Поля», ручками в окне; линия поля ставится с любой стороны или убирается
 * только на зеркале.
 *
 * Ручки стоят в отражённом слое: их точки — в пикселях листа, а поля зеркала
 * — в пикселях отражённого кадра, и каждая переводится через `x → W − x`.
 */
export const MirrorOverride: FC<MirrorOverrideProps> = (props) => {
  const { handleLayer, withHandles } = props;
  const width = useMarkupEditorStore((state) => {
    return state.record?.sheet.width || 0;
  });
  const height = useMarkupEditorStore((state) => {
    return state.record?.sheet.height || 0;
  });
  const ruling = useMarkupEditorStore((state) => {
    return state.draft?.ruling || null;
  });
  const frame = useMemo(() => {
    return { width, height };
  }, [width, height]);
  const {
    separate,
    reflect,
    moveMargin,
    setMargin,
    moveMarginLine,
    setMarginLine,
    setMarginLineSide,
  } = useMirrorOverrideEdit(frame);

  if (!ruling) {
    return null;
  }

  const override = ruling.mirrorOverride;

  const handleModeChange = (value: string) => {
    if (value === 'separate') {
      separate();
    } else {
      reflect();
    }
  };

  const handleMarginLineSideChange = (value: string) => {
    setMarginLineSide(toMarginLineSide(value));
  };

  const handleMarginLineCommit = (value: number) => {
    setMarginLine({ x: value, y: 0 }, false);
  };

  const handleMarginLineMove = (point: SheetPoint) => {
    moveMarginLine(mirrorMarkupPoint(point, width).x);
  };

  /**
   * Стрелкой линию поля сдвигают на пиксель мимо черты — магнит вернул бы
   * её обратно.
   *
   * @param point — точка отпускания, px листа
   * @param source — чем сдвинули
   */
  const handleMarginLineMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
    setMarginLine(mirrorMarkupPoint(point, width), source === 'pointer');
  };

  const handles = override
    ? resolveMarginHandles(mirrorSheetRuling(ruling, frame), frame)
    : null;

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        label="Линия поля и боковые поля зеркала"
        value={override ? 'separate' : 'mirrored'}
        options={MODE_OPTIONS}
        onChange={handleModeChange}
      />

      {override ? (
        <>
          <SegmentedControl
            label="Линия поля зеркала"
            value={override.marginLineSide || NO_MARGIN_LINE}
            options={MARGIN_LINE_OPTIONS}
            onChange={handleMarginLineSideChange}
          />

          <div className="grid grid-cols-2 gap-2">
            {MIRROR_MARGIN_SIDES.map((side) => {
              const handleMarginCommit = (value: number) => {
                setMargin(side, side === 'left' ? value : width - value);
              };

              return (
                <ExactValueField
                  key={side}
                  label={MARGIN_FIELD_LABELS[side]}
                  value={side === 'left' ? override.marginLeft : override.marginRight}
                  onValueCommit={handleMarginCommit}
                />
              );
            })}

            <ExactValueField
              label="Линия поля зеркала, px"
              value={override.marginLineX}
              onValueCommit={handleMarginLineCommit}
            />
          </div>
        </>
      ) : null}

      {handleLayer && withHandles && handles
        ? createPortal(
            <g data-tool="mirror-margins">
              {MIRROR_MARGIN_SIDES.map((side) => {
                const { x, y } = mirrorMarkupPoint(handles[side], width);

                const handleMarginMove = (point: SheetPoint) => {
                  moveMargin(side, mirrorMarkupPoint(point, width).x);
                };

                const handleMarginMoveEnd = (point: SheetPoint) => {
                  setMargin(side, mirrorMarkupPoint(point, width).x);
                };

                return (
                  <MarkupHandle
                    key={side}
                    x={x}
                    y={y}
                    label={MARGIN_HANDLE_LABELS[side]}
                    className="in-data-pan-mode:pointer-events-none"
                    onMove={handleMarginMove}
                    onMoveEnd={handleMarginMoveEnd}
                  />
                );
              })}

              {handles.marginLine ? (
                <MarkupHandle
                  x={width - handles.marginLine.x}
                  y={handles.marginLine.y}
                  label="Линия поля зеркала"
                  className="stroke-danger in-data-pan-mode:pointer-events-none"
                  onMove={handleMarginLineMove}
                  onMoveEnd={handleMarginLineMoveEnd}
                />
              ) : null}
            </g>,
            handleLayer
          )
        : null}
    </div>
  );
};
