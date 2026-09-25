import { cx } from '@shared/lib/styles';
import { Label } from '@shared/ui/Label';
import type { ChangeEvent, FC, KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { roundTo } from '../../../../../../lib/format/formatNumber';

import type { ExactValueFieldProps } from './ExactValueField.types';

/**
 * Знаков после запятой в показанном числе: десятая пикселя фотографии —
 * точнее ручку не поставить и стрелкой.
 */
const FRACTION_DIGITS = 1;

const NOT_A_NUMBER_MESSAGE = 'Нужно число, например 12,5.';

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
 * Поле «Точных значений»: число в пикселях фотографии и подпись, от чего оно
 * отсчитано. Применяется по Enter или уходу фокуса. Число, которое разметка не
 * принимает, и не число остаются в поле с ошибкой рядом — молчаливый откат к
 * прежнему значению выглядел бы как принятая правка. Esc отменяет набор и
 * ошибку.
 *
 * Набор и ошибка держатся, пока значение то же: сдвинутая ручкой или отменой
 * разметка показывает новое число, а не устаревший набор.
 */
export const ExactValueField: FC<ExactValueFieldProps> = (props) => {
  const { label, reference, value, onValueCommit } = props;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceId = `${id}-reference`;
  const errorId = `${id}-error`;
  /**
   * Набранный, но ещё не применённый текст. `null` — поле показывает
   * значение.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Значение, при котором начат набор: сменилось — набор и ошибка устарели.
   */
  const [editedValue, setEditedValue] = useState(value);

  if (editedValue !== value) {
    setEditedValue(value);
    setDraft(null);
    setError(null);
  }

  const isEditing = draft !== null;

  /**
   * Диалог закрывается по Esc, пойманному на документе до поля, поэтому
   * `stopPropagation` в обработчике поля его не держит. Пока в поле набор,
   * Esc помечается отменённым ещё на окне — диалог такой Esc пропускает, а
   * поле по нему отменяет набор. Без набора Esc закрывает редактор, как везде.
   */
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && event.target === inputRef.current) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, { capture: true });
    };
  }, [isEditing]);

  const commitDraft = () => {
    if (draft === null) {
      return;
    }

    const parsed = parseFieldValue(draft);
    const rejection = parsed === null ? NOT_A_NUMBER_MESSAGE : onValueCommit(parsed);

    if (rejection) {
      setError(rejection);

      return;
    }

    setDraft(null);
    setError(null);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value);
    setError(null);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Enter': {
        commitDraft();
        break;
      }

      case 'Escape': {
        setDraft(null);
        setError(null);
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
        ref={inputRef}
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${referenceId} ${errorId}` : referenceId}
        value={draft ?? formatFieldValue(value)}
        className={cx(
          'h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-fg tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          error && 'border-danger'
        )}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onBlur={handleInputBlur}
      />

      <p id={referenceId} className="text-xs text-fg-muted">
        {reference}
      </p>

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
};
