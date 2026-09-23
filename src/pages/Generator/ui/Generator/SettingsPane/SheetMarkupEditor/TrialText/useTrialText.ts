import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createDomMeasurer } from '../../../../../lib/measure/createDomMeasurer';
import { waitForFont } from '../../../../../lib/measure/waitForFont';
import { renderPageInWorker } from '../../../../../model/createPageRenderClient';
import { selectPageRecipe } from '../../../../../model/recipeSelectors';
import { findFontUrl } from '../../../../../model/useFontGlyphs';
import { useGeneratorStore } from '../../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { usePageGeometry } from '../../../../../model/usePageGeometry';

import { buildTrialTask } from './buildTrialTask';
import type { TrialRaster, TrialTextInput, TrialTextRaster } from './useTrialText.types';

/**
 * Пауза после отпускания ручки, после которой страница заказывается у
 * воркера: стрелки и правки числами идут подряд, и заказ на каждую гонял бы
 * воркер впустую.
 */
const TRIAL_DEBOUNCE_MS = 150;

/**
 * Наименьший масштаб пробной страницы: окно ещё не измерено, а страница
 * нужна уже сейчас.
 */
const MIN_RENDER_SCALE = 0.1;

/**
 * Пробная страница по черновой разметке: заказывается у воркера отрисовки
 * после каждой завершённой правки и не задерживает саму правку.
 *
 * Правка считается завершённой, когда черновик сменился шагом истории, а не
 * промежуточным значением перетаскивания: пока ручку тянут, страница не
 * заказывается. Каждая новая правка отменяет прежний заказ, а его ответ, даже
 * пришедший позже нового, не показывается: страница по старой разметке
 * солгала бы о новой. Пока новая не готова, пробного текста не видно.
 *
 * Смена масштаба окна перезаказывает страницу в новом разрешении, но
 * показанную не снимает — разметка у неё та же.
 *
 * @param input — включён ли пробный текст, страница разворота и масштаб окна
 * @returns адрес пробной страницы и признак ожидания
 */
export const useTrialText = (input: TrialTextInput): TrialTextRaster => {
  const { isEnabled, pageIndex, scale } = input;
  const { metrics, correction, fontFamily } = usePageGeometry();
  const [editCount, setEditCount] = useState(0);
  const [raster, setRaster] = useState<TrialRaster | null>(null);
  const revision = `${editCount}:${pageIndex}`;
  /**
   * Заказ уходит по таймеру и берёт параметры страницы на момент отправки:
   * метрики и поправка — новые объекты при смене шрифта, и в зависимостях
   * эффекта они перезапускали бы паузу.
   */
  const latestRef = useRef({ metrics, correction, fontFamily, scale });

  useLayoutEffect(() => {
    latestRef.current = { metrics, correction, fontFamily, scale };
  });

  useEffect(() => {
    return useMarkupEditorStore.subscribe((state, previous) => {
      if (state.draft !== previous.draft && state.history.previewBase === null) {
        setEditCount((count) => {
          return count + 1;
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const { record, draft } = useMarkupEditorStore.getState();
      const latest = latestRef.current;

      if (!record || !draft) {
        return;
      }

      const generator = useGeneratorStore.getState();
      const fontUrl = findFontUrl(latest.fontFamily);

      try {
        await waitForFont({ fontFamily: latest.fontFamily });

        if (controller.signal.aborted) {
          return;
        }

        const task = buildTrialTask({
          record,
          draft,
          pageIndex,
          text: generator.text,
          fontFamily: latest.fontFamily,
          metrics: latest.metrics,
          correction: latest.correction,
          bottomMargin: generator.bottomMargin,
          runSeed: generator.runSeed,
          recipe: selectPageRecipe(generator, 1),
          font: fontUrl
            ? {
                family: latest.fontFamily,
                url: fontUrl,
                hasVariance: generator.realism.hasContourVariance,
              }
            : null,
          createMeasurer: createDomMeasurer,
        });
        const shownScale = latest.scale * (window.devicePixelRatio || 1);
        const renderScale =
          shownScale > MIN_RENDER_SCALE ? Math.min(1, shownScale) : MIN_RENDER_SCALE;
        const page = await renderPageInWorker(
          { ...task, params: { ...task.params, scale: renderScale } },
          controller.signal
        );

        if (!controller.signal.aborted) {
          setRaster({ url: URL.createObjectURL(page), revision });
        }
      } catch {
        /**
         * Отмена или сбой воркера: пробного текста нет, разметка правится
         * дальше.
         */
      }
    }, TRIAL_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isEnabled, revision, pageIndex, scale]);

  const rasterUrl = raster?.url || null;

  useEffect(() => {
    return () => {
      if (rasterUrl) {
        URL.revokeObjectURL(rasterUrl);
      }
    };
  }, [rasterUrl]);

  const isCurrent = raster?.revision === revision;

  return {
    url: isEnabled && isCurrent ? rasterUrl : null,
    isPending: isEnabled && !isCurrent,
  };
};
