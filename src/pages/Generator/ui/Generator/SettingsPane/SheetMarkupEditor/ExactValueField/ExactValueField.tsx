import { cx } from '@shared/lib/styles';
import { Label } from '@shared/ui/Label';
import type { ChangeEvent, FC, KeyboardEvent } from 'react';
import { useId, useRef } from 'react';

import type { ExactValueFieldProps } from './ExactValueField.types';
import { useExactValueDraft } from './useExactValueDraft';

/**
 * Поле «Точных значений»: число в пикселях фотографии и подпись, от чего оно
 * отсчитано. Применяется по Enter или уходу фокуса. Число, которое разметка не
 * принимает, и не число остаются в поле с ошибкой рядом — молчаливый откат к
 * прежнему значению выглядел бы как принятая правка. Esc отменяет набор и
 * ошибку.
 */
export const ExactValueField: FC<ExactValueFieldProps> = (props) => {
  const { label, reference, value, onValueCommit } = props;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceId = `${id}-reference`;
  const errorId = `${id}-error`;
  const { text, error, change, commit, cancel } = useExactValueDraft({
    value,
    inputRef,
    onValueCommit,
  });

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    change(event.currentTarget.value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Enter': {
        commit();
        break;
      }

      case 'Escape': {
        cancel();
        break;
      }

      default: {
        break;
      }
    }
  };

  const handleInputBlur = () => {
    commit();
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>

      <input
        ref={inputRef}
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${referenceId} ${errorId}` : referenceId}
        value={text}
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
