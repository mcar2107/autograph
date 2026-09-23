import { Disclosure } from '@shared/ui/Disclosure';
import type { FC } from 'react';
import { useMemo } from 'react';

import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarginSide } from '../MarginsTool/marginsGeometry.types';

import { ExactValueField } from './ExactValueField';
import { useExactValuesEdit } from './useExactValuesEdit';

const MARGIN_SIDES: MarginSide[] = ['top', 'bottom', 'left', 'right'];

const MARGIN_LABELS: Record<MarginSide, string> = {
  top: 'Верхнее поле, px',
  bottom: 'Нижнее поле, px',
  left: 'Левое поле, px',
  right: 'Правое поле, px',
};

/**
 * «Точные значения»: шаг, первая линия, четыре поля и линия поля числами в
 * пикселях фотографии. Свёрнуты по умолчанию — разметку правят ручками, а
 * числа нужны, когда место известно точнее, чем его видно.
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
  const { changeStep, changeFirstLine, changeMargin, changeMarginLine } =
    useExactValuesEdit(frame);

  if (!ruling) {
    return null;
  }

  const { step, firstLinePhase, margins, marginLineX } = ruling;

  const handleStepCommit = (value: number) => {
    changeStep(value);
  };

  const handleFirstLineCommit = (value: number) => {
    changeFirstLine(value);
  };

  const handleMarginLineCommit = (value: number) => {
    changeMarginLine(value);
  };

  return (
    <Disclosure title="Точные значения">
      <div className="grid grid-cols-2 gap-2">
        <ExactValueField label="Шаг, px" value={step} onValueCommit={handleStepCommit} />

        <ExactValueField
          label="Первая линия, px"
          value={firstLinePhase}
          onValueCommit={handleFirstLineCommit}
        />

        {MARGIN_SIDES.map((side) => {
          const handleMarginCommit = (value: number) => {
            changeMargin(side, value);
          };

          return (
            <ExactValueField
              key={side}
              label={MARGIN_LABELS[side]}
              value={margins[side]}
              onValueCommit={handleMarginCommit}
            />
          );
        })}

        <ExactValueField
          label="Линия поля, px"
          value={marginLineX}
          onValueCommit={handleMarginLineCommit}
        />
      </div>
    </Disclosure>
  );
};
