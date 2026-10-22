import type { RadioGroupOption } from '@shared/ui/RadioGroup';
import { RadioGroup } from '@shared/ui/RadioGroup';
import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import type { FC } from 'react';
import { createPortal } from 'react-dom';

import type { MarginLineSide, SheetPoint, SideEdge } from '../../../../../../lib/paper';
import { mirrorSheetRuling } from '../../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../../model/useMarkupEditorStore';
import { ExactValueField } from '../../ExactValueField';
import { EXACT_VALUES_LEGEND, SIDE_REFERENCES } from '../../exactValuesReferences';
import { readSideHandleValue, resolveMarginHandles } from '../../marginsGeometry';
import type { SideHandleEnd } from '../../marginsGeometry.types';
import type { MarkupMoveSource } from '../../MarkupHandle';
import { MarkupHandle } from '../../MarkupHandle';
import { mirrorMarkupPoint } from '../../MarkupViewport';

import type { MirrorOverrideProps } from './MirrorOverride.types';
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

const SIDE_EDGES: SideEdge[] = ['left', 'right', 'marginLine'];

const SIDE_HANDLE_ENDS: SideHandleEnd[] = ['top', 'bottom'];

const HANDLE_LABELS: Record<SideEdge, Record<SideHandleEnd, string>> = {
  left: { top: 'Левое поле зеркала сверху', bottom: 'Левое поле зеркала снизу' },
  right: { top: 'Правое поле зеркала сверху', bottom: 'Правое поле зеркала снизу' },
  marginLine: {
    top: 'Линия поля зеркала сверху',
    bottom: 'Линия поля зеркала снизу',
  },
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
 * «Поля», в окне: боковые поля — углами области текста зеркала (их ставит
 * инструмент), линия поля — двумя своими ручками, как у листа; линия поля
 * ставится с любой стороны или убирается только на зеркале.
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
  const frame = { width, height };
  const { separate, reflect, moveSideEnd, setSideEnd, setSideValue, setMarginLineSide } =
    useMirrorOverrideEdit(frame);

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

  const handles = override
    ? resolveMarginHandles(mirrorSheetRuling(ruling, frame), frame)
    : null;

  /**
   * Ручки линии поля зеркала стоят в отражённом слое: точка ручки переводится
   * в пиксели листа, а точка перетаскивания — обратно в пиксели отражённого
   * кадра. Боковые поля зеркала в окне правят углы инструмента «Поля».
   */
  const marginLine = handles?.marginLine;
  const marginLineHandles = marginLine
    ? SIDE_HANDLE_ENDS.map((end) => {
        const { x, y } = mirrorMarkupPoint(marginLine[end], width);

        const handleMarginLineMove = (point: SheetPoint) => {
          moveSideEnd('marginLine', end, mirrorMarkupPoint(point, width));
        };

        /**
         * Стрелкой ручку линии поля сдвигают на пиксель мимо черты — магнит
         * вернул бы её обратно.
         *
         * @param point — точка отпускания, px листа
         * @param source — чем сдвинули
         */
        const handleMarginLineMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
          setSideEnd(
            'marginLine',
            end,
            mirrorMarkupPoint(point, width),
            source === 'pointer'
          );
        };

        return (
          <MarkupHandle
            key={`marginLine-${end}`}
            kind="lineEnd"
            x={x}
            y={y}
            label={HANDLE_LABELS.marginLine[end]}
            className="in-data-pan-mode:pointer-events-none"
            onMove={handleMarginLineMove}
            onMoveEnd={handleMarginLineMoveEnd}
          />
        );
      })
    : [];

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

          {handles ? (
            <p className="text-xs text-fg-muted">{EXACT_VALUES_LEGEND}</p>
          ) : null}

          {handles ? (
            <div className="grid grid-cols-2 gap-2">
              {SIDE_EDGES.flatMap((edge) => {
                return SIDE_HANDLE_ENDS.map((end) => {
                  const handleSideCommit = (value: number): string | null => {
                    return setSideValue(edge, end, value);
                  };

                  return (
                    <ExactValueField
                      key={`${edge}-${end}`}
                      label={`${HANDLE_LABELS[edge][end]}, px`}
                      reference={SIDE_REFERENCES[edge]}
                      value={readSideHandleValue(handles, frame, edge, end)}
                      onValueCommit={handleSideCommit}
                    />
                  );
                });
              })}
            </div>
          ) : null}
        </>
      ) : null}

      {handleLayer && withHandles && handles
        ? createPortal(<g data-tool="mirror-margins">{marginLineHandles}</g>, handleLayer)
        : null}
    </div>
  );
};
