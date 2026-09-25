import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent } from 'storybook/test';

import { Button } from './Button';

const meta = {
  component: Button,
  args: {
    children: 'Сохранить',
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: 'primary' },
};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Удалить лист' },
};

export const Focused: Story = {
  args: { variant: 'primary' },
  play: async () => {
    await userEvent.tab();
  },
};

export const Disabled: Story = {
  args: { variant: 'primary', isDisabled: true },
};

export const Loading: Story = {
  args: { variant: 'primary', isLoading: true },
};
