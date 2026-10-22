import { useEffect, useState } from 'react';

import { roundTo } from '../../../../../lib/format/formatNumber';

import type { ExactValueDraft, ExactValueDraftOptions } from './useExactValueDraft.types';

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
 * Набор числа в поле «Точных значений». Число, которое разметка не принимает,
 * и не число остаются в поле с ошибкой — молчаливый откат к прежнему значению
 * выглядел бы как принятая правка.
 *
 * Набор и ошибка держатся, пока значение то же: сдвинутая ручкой или отменой
 * разметка показывает новое число, а не устаревший набор.
 *
 * @param options — значение, поле и колбэк применения
 * @returns текст поля, ошибка и методы набора
 */
export const useExactValueDraft = (options: ExactValueDraftOptions): ExactValueDraft => {
  const { value, inputRef, onValueCommit } = options;
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

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target === inputRef.current) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, { capture: true });
    };
  }, [isEditing, inputRef]);

  const change = (text: string) => {
    setDraft(text);
    setError(null);
  };

  const commit = () => {
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

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  /**
   * `??`, а не `||`: стёртое поле — пустая строка, и `||` вернул бы в него
   * число посреди набора.
   */
  const text = draft ?? formatFieldValue(value);

  return { text, error, change, commit, cancel };
};
