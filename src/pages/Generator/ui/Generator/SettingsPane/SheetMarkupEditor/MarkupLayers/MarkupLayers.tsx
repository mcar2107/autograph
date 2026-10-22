import { Checkbox } from '@shared/ui/Checkbox';
import type { FC } from 'react';

import type { MarkupLayerId } from '../MarkupOverlay';

import type { MarkupLayersProps } from './MarkupLayers.types';

/**
 * Подписи слоёв в порядке показа.
 */
const LAYER_LABELS: [MarkupLayerId, string][] = [
  ['outline', 'Контур'],
  ['lines', 'Линии'],
  ['margins', 'Поля'],
  ['marginLine', 'Линия поля'],
  ['pins', 'Закреплённые линии'],
];

/**
 * Показ и скрытие слоёв разметки по отдельности: линии разлиновки закрывают
 * снимок, и чтобы разглядеть под ними настоящие, их нужно убрать, не трогая
 * остальное. Подсказка про клавишу H стоит здесь же: быстрое скрытие всей
 * разметки ищут рядом с флажками слоёв.
 */
export const MarkupLayers: FC<MarkupLayersProps> = (props) => {
  const { layers, onLayersChange } = props;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-xs font-semibold tracking-wider text-fg-muted uppercase">
        Слои
      </legend>

      {LAYER_LABELS.map(([layer, label]) => {
        const handleLayerChange = (isChecked: boolean) => {
          onLayersChange({ ...layers, [layer]: isChecked });
        };

        return (
          <Checkbox
            key={layer}
            label={label}
            isChecked={layers[layer]}
            onChange={handleLayerChange}
          />
        );
      })}

      <p className="text-xs text-fg-muted">
        Удерживайте{' '}
        <kbd className="rounded-sm border border-border-strong px-1 font-ui">H</kbd>
        {'\u00A0— '}вся разметка скрыта, пока клавиша зажата.
      </p>
    </fieldset>
  );
};
