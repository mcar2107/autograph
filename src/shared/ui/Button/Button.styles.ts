import { cva } from 'class-variance-authority';

/**
 * Вид кнопки отдельно от компонента: его берут и контролы, которым нужна своя
 * разметка кнопки, — например, выбор файла со ссылками на подпись и описание.
 */
export const buttonVariants = cva(
  'relative inline-flex cursor-pointer items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'bg-surface-raised text-fg hover:bg-border',
        ghost: 'bg-transparent text-fg-muted hover:bg-border',
        /**
         * Под курсором надпись светлеет: красная на подсвеченном красным фоне
         * поверхности диалога держала бы меньше 4,5:1.
         */
        danger:
          'bg-transparent text-danger inset-ring inset-ring-danger hover:bg-danger/15 hover:text-fg',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  }
);
