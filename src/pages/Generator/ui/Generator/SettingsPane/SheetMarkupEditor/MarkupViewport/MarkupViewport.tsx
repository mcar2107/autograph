import { cx } from '@shared/lib/styles';
import { IconButton } from '@shared/ui/IconButton';
import type { FC, PointerEvent } from 'react';
import { useEffect, useRef } from 'react';

import { useMarkupMirrorWidth } from './markupMirrorContext';
import { MarkupScaleContext } from './markupScaleContext';
import type { MarkupViewportProps, PanPointer } from './MarkupViewport.types';
import { MarkupViewportHint } from './MarkupViewportHint';
import { useMarkupView } from './useMarkupView';
import { useSpacePan } from './useSpacePan';

const PERCENT = 100;

/**
 * Окно просмотра фотографии в редакторе: фотография и разметка лежат в одном
 * контейнере с одной CSS-матрицей. Приближение и сдвиг меняют только её —
 * разметка не пересчитывается и не отстаёт от снимка ни на кадр.
 *
 * Перетаскивание по фотографии сдвигает её. Ручки разметки перехватывают
 * нажатие сами, поэтому их перетаскивание снимок не двигает. С зажатым
 * пробелом нажатие забирает окно ещё до ручек: поверх ручек и линий пустого
 * места почти не остаётся, а сдвигать снимок нужно и там.
 *
 * На зеркальной странице фотография отражена — так она ляжет на правую
 * страницу разворота.
 */
export const MarkupViewport: FC<MarkupViewportProps> = (props) => {
  const { frame, photoSrc, photoLabel, children, onScaleChange } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PanPointer | null>(null);
  const { view, zoomIn, zoomOut, fit, panBy } = useMarkupView(viewportRef, frame);
  const isSpacePan = useSpacePan(viewportRef);
  const isMirrored = useMarkupMirrorWidth() !== null;
  const { scale, x, y } = view;

  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  /**
   * Начало сдвига указателем, нажатым на окне просмотра.
   *
   * @param event — нажатие
   */
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;

    pointerRef.current = { id: pointerId, x: clientX, y: clientY };
    currentTarget.setPointerCapture?.(pointerId);
  };

  /**
   * В режиме пробела сдвиг начинается на фазе погружения: нажатие дальше не
   * идёт, и ручка под указателем его не получает.
   */
  const handleViewportPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (!isSpacePan) {
      return;
    }

    event.stopPropagation();
    startPan(event);
  };

  const handleViewportPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    startPan(event);
  };

  const handleViewportPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    const { pointerId, clientX, clientY } = event;

    if (pointer?.id !== pointerId) {
      return;
    }

    panBy(clientX - pointer.x, clientY - pointer.y);
    pointerRef.current = { id: pointerId, x: clientX, y: clientY };
  };

  const handleViewportPointerUp = () => {
    pointerRef.current = null;
  };

  const handleZoomInClick = () => {
    zoomIn();
  };

  const handleZoomOutClick = () => {
    zoomOut();
  };

  const handleFitClick = () => {
    fit();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div
        ref={viewportRef}
        data-testid="markup-viewport"
        data-pan-mode={isSpacePan || undefined}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-md bg-canvas active:cursor-grabbing data-pan-mode:**:cursor-grab"
        onPointerDownCapture={handleViewportPointerDownCapture}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
      >
        <div
          data-testid="markup-stage"
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: frame.width,
            height: frame.height,
            transform: `translate(${x}px, ${y}px) scale(${scale})`,
          }}
        >
          <img
            src={photoSrc}
            alt={photoLabel}
            width={frame.width}
            height={frame.height}
            draggable={false}
            className={cx(
              'block size-full max-w-none select-none',
              isMirrored && '-scale-x-100'
            )}
          />

          <MarkupScaleContext value={scale}>{children}</MarkupScaleContext>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Масштаб фотографии"
          className="flex shrink-0 items-center gap-1"
        >
          <IconButton label="Отдалить" onClick={handleZoomOutClick}>
            <span aria-hidden="true">−</span>
          </IconButton>

          <IconButton label="Приблизить" onClick={handleZoomInClick}>
            <span aria-hidden="true">+</span>
          </IconButton>

          <IconButton label="Вписать фотографию" onClick={handleFitClick}>
            <span aria-hidden="true">⤢</span>
          </IconButton>

          <span className="px-2 text-xs whitespace-nowrap text-fg-muted tabular-nums">
            {Math.round(scale * PERCENT)} %
          </span>
        </div>

        <MarkupViewportHint />
      </div>
    </div>
  );
};
