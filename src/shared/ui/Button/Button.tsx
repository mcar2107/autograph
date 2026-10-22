import { cx } from '@shared/lib/styles';
import type { FC } from 'react';

import { Spinner } from '../Spinner';

import { buttonVariants } from './Button.styles';
import type { ButtonProps } from './Button.types';

export const Button: FC<ButtonProps> = (props) => {
  const {
    children,
    onClick,
    variant,
    isDisabled = false,
    isLoading = false,
    describedBy,
    className,
    ref,
  } = props;

  const handleButtonClick = () => {
    if (isLoading) {
      return;
    }

    onClick();
  };

  return (
    <button
      ref={ref}
      type="button"
      className={cx(buttonVariants({ variant }), className)}
      disabled={isDisabled}
      aria-busy={isLoading}
      aria-disabled={isLoading}
      aria-describedby={describedBy}
      onClick={handleButtonClick}
    >
      {/**
       * Подпись во время загрузки гасится прозрачностью, а не снимается и не
       * прячется `visibility`: кнопка держит прежнюю ширину, и соседи по
       * строке не прыгают, а читалка по-прежнему видит имя кнопки — скрытая
       * подпись оставила бы её безымянной.
       */}
      <span className={isLoading ? 'opacity-0' : undefined}>{children}</span>

      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
    </button>
  );
};
