import { Disclosure } from '@shared/ui/Disclosure';
import type { FC } from 'react';
import { useMemo } from 'react';

import type { SideEdge } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import {
  readSideHandleValue,
  resolveMarginHandles,
} from '../MarginsTool/marginsGeometry';
import type {
  GuideMarginSide,
  SideHandleEnd,
} from '../MarginsTool/marginsGeometry.types';

import { ExactValueField } from './ExactValueField';
import {
  EXACT_VALUES_LEGEND,
  FROM_FRAME_TOP,
  SIDE_REFERENCES,
} from './exactValuesReferences';
import { useExactValuesEdit } from './useExactValuesEdit';

const GUIDE_MARGIN_SIDES: GuideMarginSide[] = ['top', 'bottom'];

const GUIDE_MARGIN_LABELS: Record<GuideMarginSide, string> = {
  top: 'Верхнее поле, px',
  bottom: 'Нижнее поле, px',
};

const GUIDE_MARGIN_REFERENCES: Record<GuideMarginSide, string> = {
  top: FROM_FRAME_TOP,
  bottom: 'от\u00A0низа кадра',
};

const SIDE_EDGES: SideEdge[] = ['left', 'right', 'marginLine'];

const SIDE_HANDLE_ENDS: SideHandleEnd[] = ['top', 'bottom'];

const SIDE_LABELS: Record<SideEdge, Record<SideHandleEnd, string>> = {
  left: { top: 'Левое поле сверху, px', bottom: 'Левое поле снизу, px' },
  right: { top: 'Правое поле сверху, px', bottom: 'Правое поле снизу, px' },
  marginLine: { top: 'Линия поля сверху, px', bottom: 'Линия поля снизу, px' },
};

/**
 * «Точные значения»: шаг, первая линия, верхнее и нижнее поля, оба конца
 * боковых полей и линии поля числами в пикселях фотографии. Свёрнуты по
 * умолчанию — разметку правят ручками, а числа нужны, когда место известно
 * точнее, чем его видно. Конец бокового поля — столбец его угла области
 * текста, конец линии поля — столбец её ручки, у правого поля — отступ угла
 * от правого края кадра.
 *
 * Каждое число подписано, от чего отсчитано: поля листа на снимке идут от
 * сторон листа, а числа — от краёв кадра. Число, которое разметка не
 * принимает, остаётся в поле с причиной.
 *
 * Показывают и правят разметку самого листа: у зеркальной страницы свои
 * поля правятся на её вкладке.
 */
export const ExactValues: FC = () => {
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
  const { changeStep, changeFirstLine, changeMargin, changeSideEnd } =
    useExactValuesEdit(frame);

  if (!ruling) {
    return null;
  }

  const { step, firstLinePhase, margins } = ruling;
  const handles = resolveMarginHandles(ruling, frame);

  const handleStepCommit = (value: number): string | null => {
    return changeStep(value);
  };

  const handleFirstLineCommit = (value: number): string | null => {
    return changeFirstLine(value);
  };

  return (
    <Disclosure title="Точные значения">
      <p className="mb-2 text-xs text-fg-muted">{EXACT_VALUES_LEGEND}</p>

      <div className="grid grid-cols-2 gap-2">
        <ExactValueField
          label="Шаг, px"
          reference="между соседними линиями"
          value={step}
          onValueCommit={handleStepCommit}
        />

        <ExactValueField
          label="Первая линия, px"
          reference={`${FROM_FRAME_TOP} у\u00A0левого края`}
          value={firstLinePhase}
          onValueCommit={handleFirstLineCommit}
        />

        {GUIDE_MARGIN_SIDES.map((side) => {
          const handleMarginCommit = (value: number): null => {
            changeMargin(side, value);

            return null;
          };

          return (
            <ExactValueField
              key={side}
              label={GUIDE_MARGIN_LABELS[side]}
              reference={GUIDE_MARGIN_REFERENCES[side]}
              value={margins[side]}
              onValueCommit={handleMarginCommit}
            />
          );
        })}

        {SIDE_EDGES.flatMap((edge) => {
          return SIDE_HANDLE_ENDS.map((end) => {
            const handleSideCommit = (value: number): null => {
              changeSideEnd(edge, end, value);

              return null;
            };

            return (
              <ExactValueField
                key={`${edge}-${end}`}
                label={SIDE_LABELS[edge][end]}
                reference={SIDE_REFERENCES[edge]}
                value={readSideHandleValue(handles, frame, edge, end)}
                onValueCommit={handleSideCommit}
              />
            );
          });
        })}
      </div>
    </Disclosure>
  );
};
