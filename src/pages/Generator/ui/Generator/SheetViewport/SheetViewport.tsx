import { cx } from '@shared/lib/styles';
import { Spinner } from '@shared/ui/Spinner';
import type { FC } from 'react';
import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PageRenderSource } from '../../../model/pageRender.types';
import { selectIsAwaitingUserSheets } from '../../../model/paperSelectors';
import { useGeneratorStore } from '../../../model/useGeneratorStore';

import { PageCanvas } from './PageCanvas';
import { PageSwitcher } from './PageSwitcher';
import type { SheetViewportProps, ShownPagesSize } from './SheetViewport.types';
import { SpreadPage } from './SpreadPage';
import { getPartnerIndex, getSpreadPair } from './spreadPages';
import { SpreadToggle } from './SpreadToggle';
import { useDetailRaster } from './useDetailRaster';
import { usePageHotkeys } from './usePageHotkeys';
import { useSpacePan } from './useSpacePan';
import { useViewportSize } from './useViewportSize';
import { useWheelZoom } from './useWheelZoom';
import { ViewportToolbar } from './ViewportToolbar';
import {
  computeDetailRasterScale,
  computeFitZoom,
  computeMainRasterScale,
} from './zoomScale';

/**
 * Отступ листа от края области — `p-6` обёртки листа: вписывание вычитает его,
 * иначе тень листа упиралась бы в край области.
 */
const VIEWPORT_PADDING = 24;

/**
 * Плотность экрана: растр в физических пикселях не мылит рукописный текст.
 * Вне браузера — единица.
 *
 * @returns множитель плотности экрана
 */
const getPixelRatio = (): number => {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
};

/**
 * Размер того, что вписывается в область: одна страница или пара разворота.
 * Непарная последняя страница занимает левую половину, и половина справа
 * считается того же размера — иначе она встала бы посередине.
 *
 * @param left — левая страница или одна страница
 * @param right — правая страница разворота; `null` — её нет
 * @param isSpread — показываются ли развороты
 * @returns ширина и высота в пикселях кадров
 */
const measureShownPages = (
  left: PageRenderSource | null,
  right: PageRenderSource | null,
  isSpread: boolean
): ShownPagesSize => {
  const leftWidth = left?.pageWidth || right?.pageWidth || 0;
  const leftHeight = left?.pageHeight || right?.pageHeight || 0;

  if (!isSpread) {
    return { width: leftWidth, height: leftHeight };
  }

  return {
    width: leftWidth + (right?.pageWidth || leftWidth),
    height: Math.max(leftHeight, right?.pageHeight || 0),
  };
};

/**
 * Область просмотра листа: навигация по страницам, вид, панель масштаба и
 * прокручиваемое поле с листом.
 *
 * По умолчанию лист вписан целиком; крупнее вписанного он прокручивается,
 * двигается пробелом с перетаскиванием и масштабируется Ctrl/⌘ + колесом вокруг
 * курсора. Лист меньше области стоит по центру.
 *
 * В развороте рядом стоят нечётная и следующая за ней чётная страница, и
 * вписывается пара. Чётная рисуется своим источником — тем же, что сохраняет
 * её в файл, поэтому зеркальна так же. Текущая страница обведена, клик по
 * другой делает текущей её.
 */
export const SheetViewport: FC<SheetViewportProps> = (props) => {
  const { source: renderedSource, partnerSource = null, plan, detailDeps } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const { zoomSetting, isSpread, isAwaitingUserSheets } = useGeneratorStore(
    useShallow((state) => {
      return {
        zoomSetting: state.zoom,
        isSpread: state.isSpread,
        isAwaitingUserSheets: selectIsAwaitingUserSheets(state),
      };
    })
  );
  /**
   * Страница на своём листе ждёт чтения листов, а не рисуется на подставленной
   * бумаге: иначе на время чтения мелькнула бы чужая страница.
   */
  const source = isAwaitingUserSheets ? null : renderedSource;
  const pageCount = plan?.pageCount || 0;
  const shownIndex = plan?.pageIndex || 0;
  const pair = getSpreadPair(shownIndex, pageCount);
  const partnerIndex = getPartnerIndex(shownIndex);
  const shownPartner =
    isSpread && pair.right !== null && !isAwaitingUserSheets ? partnerSource : null;
  const isCurrentLeft = shownIndex === pair.left;
  const leftSource = isCurrentLeft ? source : shownPartner;
  const rightSource = isCurrentLeft ? shownPartner : source;
  const shown = measureShownPages(
    isSpread ? leftSource : source,
    isSpread ? rightSource : null,
    isSpread
  );
  const size = useViewportSize(viewportRef);
  const fitZoom = computeFitZoom({
    viewportWidth: size?.width || 0,
    viewportHeight: size?.height || 0,
    pageWidth: shown.width,
    pageHeight: shown.height,
    padding: VIEWPORT_PADDING,
  });
  const zoom = zoomSetting === 'fit' ? fitZoom : zoomSetting;
  const pixelRatio = getPixelRatio();
  const rasterScale = computeMainRasterScale(zoom, fitZoom, pixelRatio);
  const detailScale = computeDetailRasterScale(zoom, fitZoom, pixelRatio);
  const detailUrl = useDetailRaster({ plan, scale: detailScale, deps: detailDeps || {} });
  const partnerDetailUrl = useDetailRaster({
    plan,
    scale: shownPartner ? detailScale : null,
    deps: detailDeps || {},
    pageIndex: partnerIndex,
  });
  const { isPanReady, isPanning } = useSpacePan(viewportRef);

  useWheelZoom({ viewportRef, sheetRef, zoom });
  usePageHotkeys({ pageIndex: shownIndex, pageCount, isSpread });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 py-1">
        {pageCount > 0 && (
          <PageSwitcher
            pageIndex={shownIndex}
            pageCount={pageCount}
            isSpread={isSpread}
          />
        )}

        <div className="ml-auto flex items-center gap-3">
          <SpreadToggle />

          <ViewportToolbar zoom={zoom} isFit={zoomSetting === 'fit'} />
        </div>
      </div>

      <div
        ref={viewportRef}
        role="region"
        aria-label="Лист"
        className={cx(
          'min-h-0 flex-1 overflow-auto bg-canvas',
          isPanReady && 'cursor-grab',
          isPanning && 'cursor-grabbing'
        )}
      >
        <div className="flex min-h-full w-max min-w-full items-center justify-center p-6">
          {/*
           * Область ожидания смонтирована всегда, меняется только текст:
           * область, появившаяся вместе с ним, читалкой часто не объявляется.
           * Пустая выведена из потока, чтобы не сдвигать лист по центру.
           */}
          <div role="status" aria-atomic="true" className="empty:absolute">
            {isAwaitingUserSheets && (
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Spinner />
                Загружаем свои листы…
              </p>
            )}
          </div>

          <div ref={sheetRef} className="flex shrink-0 items-center">
            {!isSpread && source && (
              <PageCanvas
                source={source}
                zoom={zoom}
                rasterScale={rasterScale}
                detailUrl={detailUrl}
              />
            )}

            {isSpread && leftSource && (
              <SpreadPage pageIndex={pair.left} isCurrent={isCurrentLeft}>
                <PageCanvas
                  source={leftSource}
                  zoom={zoom}
                  rasterScale={rasterScale}
                  detailUrl={isCurrentLeft ? detailUrl : partnerDetailUrl}
                />
              </SpreadPage>
            )}

            {isSpread && pair.right !== null && rightSource && (
              <SpreadPage pageIndex={pair.right} isCurrent={!isCurrentLeft}>
                <PageCanvas
                  source={rightSource}
                  zoom={zoom}
                  rasterScale={rasterScale}
                  detailUrl={isCurrentLeft ? partnerDetailUrl : detailUrl}
                />
              </SpreadPage>
            )}

            {isSpread && leftSource && !rightSource && (
              <div
                aria-hidden
                data-testid="spread-blank"
                style={{
                  width: `${String(Math.round((shown.width / 2) * zoom))}px`,
                  height: `${String(Math.round(shown.height * zoom))}px`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
