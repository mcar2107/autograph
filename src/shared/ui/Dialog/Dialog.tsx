import * as RadixDialog from '@radix-ui/react-dialog';
import { cx } from '@shared/lib/styles';
import type { FC } from 'react';

import type { DialogProps } from './Dialog.types';

/**
 * Диалог всегда управляемый: лист открывает его и сам, когда
 * автоопределение разлиновки не удалось, а не только по кнопке.
 *
 * «Закрыть» — обычная кнопка, а не `IconButton`: при открытии фокус
 * встаёт на неё, подсказка `IconButton` открылась бы от фокуса, и первый
 * Esc закрыл бы подсказку, а не диалог.
 */
export const Dialog: FC<DialogProps> = (props) => {
  const { isOpen, title, description, trigger, children, onOpenChange, className } =
    props;

  /**
   * С подзаголовком описание диалога связывает сам Radix, и любое значение
   * `aria-describedby`, даже `undefined`, перебило бы его. Без подзаголовка
   * пустая строка говорит Radix, что описания нет намеренно.
   */
  const describedByProps = description ? {} : { 'aria-describedby': '' };

  const handleDialogOpenChange = (isNextOpen: boolean) => {
    onOpenChange(isNextOpen);
  };

  const handleCloseClick = () => {
    onOpenChange(false);
  };

  return (
    <RadixDialog.Root open={isOpen} onOpenChange={handleDialogOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}

      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-surface/80" />

        <RadixDialog.Content
          {...describedByProps}
          className={cx(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[32rem] max-w-[90vw] -translate-1/2 flex-col gap-4 overflow-y-auto rounded-lg bg-surface-raised p-6 text-fg shadow-popover focus:outline-none',
            className
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <RadixDialog.Title className="text-lg font-semibold">
                {title}
              </RadixDialog.Title>

              {description ? (
                <RadixDialog.Description className="text-sm text-fg-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>

            <button
              type="button"
              aria-label="Закрыть"
              className="-mt-1 -mr-2 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-border hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={handleCloseClick}
            >
              <svg aria-hidden viewBox="0 0 16 16" className="size-4">
                <path
                  d="m4 4 8 8m0-8-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          </div>

          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};
