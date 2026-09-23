import { Label } from '@shared/ui/Label';
import type { ChangeEvent, FC, KeyboardEvent } from 'react';
import { useId, useState } from 'react';

import { roundTo } from '../../../../../../lib/format/formatNumber';

import type { ExactValueFieldProps } from './ExactValueField.types';

/**
 * Знаков после запятой в показанном числе: десятая пикселя фотографии —
 * точнее ручку не поставить и стрелкой.
 */
const FRACTION_DIGITS = 1;

/**
 * Число для поля: по-русски, с запятой, без разрядных пробелов — такое
 * число правят, а не читают.
 *
 * @param value — число; `null` — значения нет
 * @returns текст поля
 */
const formatFieldValue = (value: number | null): string => {
  return value === null ? '' : String(roundTo(value, FRACTION_DIGITS)).replace('.', ',');
};

/**
 * Число из набранного текста: дробь — через запятую или точку.
 *
 * @param text — набранный текст
 * @returns число; `null` — текст не число
 */
const parseFieldValue = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  const value = Number(trimmed);

  return trimmed === '' || !Number.isFinite(value) ? null : value;
};

/**
 * Поле «Точных значений»: число в пикселях фотографии. Применяется по Enter
 * или уходу фокуса; не число поле отбрасывает и возвращается к значению, Esc
 * — тоже.
 */
export const ExactValueField: FC<ExactValueFieldProps> = (props) => {
  const { label, value, onValueCommit } = props;
  const id = useId();
  /**
   * Набранный, но ещё не применённый текст. `null` — поле показывает
   * значение.
   */
  const [draft, setDraft] = useState<string | null>(null);

  const commitDraft = () => {
    const parsed = draft === null ? null : parseFieldValue(draft);

    setDraft(null);

    if (parsed !== null) {
      onValueCommit(parsed);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Enter': {
        commitDraft();
        break;
      }

      case 'Escape': {
        /**
         * Esc отменяет набор, а не закрывает редактор.
         */
        event.stopPropagation();
        setDraft(null);
        break;
      }

      default: {
        break;
      }
    }
  };

  const handleInputBlur = () => {
    commitDraft();
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>

      {/**
       * `??`, а не `||`: стёртое поле — пустая строка, и `||` вернул бы в него
       * число посреди набора.
       */}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? formatFieldValue(value)}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onBlur={handleInputBlur}
        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-fg tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
    </div>
  );
};
