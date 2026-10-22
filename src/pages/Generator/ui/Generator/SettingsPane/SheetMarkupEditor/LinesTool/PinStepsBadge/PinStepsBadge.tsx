import { IconButton } from '@shared/ui/IconButton';
import type { FC } from 'react';

import type { PinStepsBadgeProps } from './PinStepsBadge.types';

/**
 * Слово «шаг» в числе: «1 шаг», «3 шага», «10 шагов».
 *
 * @param count — число шагов
 * @returns слово в нужной форме
 */
const toStepsWord = (count: number): string => {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;

  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return 'шаг';
  }

  return lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'шага'
    : 'шагов';
};

/**
 * Число шагов между соседними закреплёнными линиями с кнопками ±. Смена числа
 * меняет шаг разлиновки: так чинится шаг, найденный автоматом вдвое больше
 * или меньше настоящего.
 */
export const PinStepsBadge: FC<PinStepsBadgeProps> = (props) => {
  const { upperNumber, steps, onStepsChange } = props;
  const pair = `линиями ${upperNumber} и ${upperNumber + 1}`;

  const handleDecreaseClick = () => {
    onStepsChange(-1);
  };

  const handleIncreaseClick = () => {
    onStepsChange(1);
  };

  return (
    <div
      role="group"
      aria-label={`Шагов между ${pair}`}
      className="flex items-center gap-2 self-center text-xs text-fg-muted"
    >
      <IconButton
        label={`Меньше шагов между ${pair}`}
        isDisabled={steps <= 1}
        onClick={handleDecreaseClick}
      >
        <span aria-hidden="true">−</span>
      </IconButton>

      <output className="min-w-20 text-center text-fg tabular-nums">
        {steps > 0 ? `${steps} ${toStepsWord(steps)}` : 'шагов: ?'}
      </output>

      <IconButton label={`Больше шагов между ${pair}`} onClick={handleIncreaseClick}>
        <span aria-hidden="true">+</span>
      </IconButton>
    </div>
  );
};
