import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { SheetFrame } from '../../../../../lib/paper';

import {
  clampScale,
  computeFitScale,
  fitView,
  MARKUP_ZOOM_STEP,
  zoomView,
} from './markupView';
import type { MarkupView } from './markupView.types';
import type { MarkupViewControl } from './useMarkupView.types';
import { useMarkupViewportSize } from './useMarkupViewportSize';

/**
 * Во сколько раз меняется масштаб на пиксель прокрутки, в показателе
 * экспоненты: щелчок колеса — примерно пятая часть масштаба, жест тачпада —
 * плавно.
 */
const WHEEL_ZOOM_RATE = 0.002;

/**
 * Высота строки прокрутки в пикселях: мышь в режиме строк отдаёт смещение
 * строками.
 */
const WHEEL_LINE_HEIGHT = 16;

/**
 * Приближение и сдвиг фотографии в окне редактора.
 *
 * Пока пользователь не трогал масштаб, фотография вписана и следует за
 * размером окна. Первое приближение или сдвиг фиксируют положение, «Вписать»
 * возвращает к вписанному.
 *
 * Ctrl/⌘ + колесо (и щипок тачпада, который браузер отдаёт так же) —
 * приближение к курсору, колесо без модификатора — сдвиг. Слушатель вешается
 * напрямую: React регистрирует колесо пассивным, и масштаб страницы браузером
 * отменить было бы нельзя.
 *
 * @param viewportRef — узел окна просмотра
 * @param frame — кадр фотографии
 * @returns положение фотографии и методы его смены
 */
export const useMarkupView = (
  viewportRef: RefObject<HTMLElement | null>,
  frame: SheetFrame
): MarkupViewControl => {
  const size = useMarkupViewportSize(viewportRef);
  const [manualView, setManualView] = useState<MarkupView | null>(null);
  const viewportSize = size || { width: 0, height: 0 };
  const fitScale = computeFitScale(viewportSize, frame);
  const view = manualView || fitView(viewportSize, frame);
  const fittedRef = useRef(view);

  useEffect(() => {
    fittedRef.current = fitView(viewportSize, frame);
  });

  /**
   * Смена положения функцией от текущего: движения указателя приходят чаще
   * отрисовки, и положение, взятое из прошлого рендера, теряло бы сдвиги.
   *
   * @param change — новое положение из текущего
   */
  const updateView = (change: (current: MarkupView) => MarkupView) => {
    setManualView((previous) => {
      return change(previous || fittedRef.current);
    });
  };

  const zoomAtCenter = (factor: number) => {
    updateView((current) => {
      return zoomView(current, clampScale(current.scale * factor, fitScale), {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2,
      });
    });
  };

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const handleViewportWheel = (event: WheelEvent) => {
      event.preventDefault();

      const lineFactor =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_HEIGHT : 1;
      const { deltaX, deltaY, clientX, clientY } = event;
      const isZoom = event.ctrlKey || event.metaKey;
      const { left, top } = viewport.getBoundingClientRect();

      setManualView((previous) => {
        const current = previous || fittedRef.current;

        if (!isZoom) {
          return {
            ...current,
            x: current.x - deltaX * lineFactor,
            y: current.y - deltaY * lineFactor,
          };
        }

        const scale = clampScale(
          current.scale * Math.exp(-deltaY * lineFactor * WHEEL_ZOOM_RATE),
          fitScale
        );

        return zoomView(current, scale, { x: clientX - left, y: clientY - top });
      });
    };

    viewport.addEventListener('wheel', handleViewportWheel, { passive: false });

    return () => {
      viewport.removeEventListener('wheel', handleViewportWheel);
    };
  }, [viewportRef, fitScale]);

  return {
    view,
    zoomIn: () => {
      zoomAtCenter(MARKUP_ZOOM_STEP);
    },
    zoomOut: () => {
      zoomAtCenter(1 / MARKUP_ZOOM_STEP);
    },
    fit: () => {
      setManualView(null);
    },
    panBy: (dx, dy) => {
      updateView((current) => {
        return { ...current, x: current.x + dx, y: current.y + dy };
      });
    },
  };
};
