import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';

import type { MarkupViewportSize } from './markupView.types';

/**
 * Размер окна просмотра редактора. Первое измерение — до отрисовки, иначе
 * фотография на первом кадре встала бы не вписанной и прыгнула; дальше размер
 * приходит от `ResizeObserver`.
 *
 * @param targetRef — узел окна просмотра
 * @returns размер окна; `null` — узла ещё нет
 */
export const useMarkupViewportSize = (
  targetRef: RefObject<HTMLElement | null>
): MarkupViewportSize | null => {
  const [size, setSize] = useState<MarkupViewportSize | null>(null);

  useLayoutEffect(() => {
    const target = targetRef.current;

    if (!target) {
      return;
    }

    const measure = () => {
      const { clientWidth: width, clientHeight: height } = target;

      setSize((current) => {
        return current?.width === width && current.height === height
          ? current
          : { width, height };
      });
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [targetRef]);

  return size;
};
