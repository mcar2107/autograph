import type { ReactNode } from 'react';

export type MarkupLiveRegionProps = {
  /**
   * Как объявлять: `status` — вежливо, после текущей фразы читалки;
   * `alert` — сразу, для отказов.
   */
  tone: 'status' | 'alert';

  /**
   * Текущее сообщение. `null` — сообщения нет, область пуста, но на месте.
   */
  message: ReactNode | null;

  /**
   * Классы видимого сообщения.
   */
  className?: string;
};
