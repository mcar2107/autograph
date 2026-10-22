import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useRef } from 'react';

import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';

import { useCloseConfirmFocus } from './useCloseConfirmFocus';

/**
 * Подтверждение закрытия редактора с несохранёнными правками. Показывается,
 * пока стор редактора ждёт ответа, — на «Отмену», «Закрыть», Esc и клик мимо
 * одинаково.
 *
 * Фокус при появлении встаёт на саму группу: после Esc или «Закрыть» он
 * остался бы там, откуда вопрос не виден, а с группы вопрос зачитывается и
 * первый Tab ведёт к ответам. «Продолжить правку» возвращает его туда, откуда
 * попросили закрыть: иначе он пропал бы вместе с вопросом.
 */
export const MarkupCloseConfirm: FC = () => {
  const isCloseConfirming = useMarkupEditorStore((state) => {
    return state.isCloseConfirming;
  });
  const close = useMarkupEditorStore((state) => {
    return state.close;
  });
  const dismissClose = useMarkupEditorStore((state) => {
    return state.dismissClose;
  });
  const groupRef = useRef<HTMLDivElement>(null);

  const restoreFocus = useCloseConfirmFocus(groupRef, isCloseConfirming);

  const handleDiscardClick = () => {
    close();
  };

  const handleKeepClick = () => {
    restoreFocus();
    dismissClose();
  };

  if (!isCloseConfirming) {
    return null;
  }

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Подтверждение закрытия"
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md border border-danger p-3 focus:outline-none"
    >
      <p className="text-sm text-fg">
        Правки разметки не&nbsp;сохранены. Закрыть редактор и&nbsp;оставить лист как был?
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={handleDiscardClick}>
          Закрыть без сохранения
        </Button>

        <Button variant="ghost" onClick={handleKeepClick}>
          Продолжить правку
        </Button>
      </div>
    </div>
  );
};
