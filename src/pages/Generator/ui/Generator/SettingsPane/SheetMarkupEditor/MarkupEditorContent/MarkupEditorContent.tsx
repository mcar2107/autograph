import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import type { FC } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { getPageRuling } from '../../../../../model/geometrySelectors';
import { useGeneratorStore } from '../../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { BendTool } from '../BendTool';
import { ExactValues } from '../ExactValues';
import { LinesTool } from '../LinesTool';
import { MarginsTool } from '../MarginsTool';
import { MarkupCloseConfirm } from '../MarkupCloseConfirm';
import { MarkupFooter } from '../MarkupFooter';
import { MarkupLayers, useHideMarkupKey } from '../MarkupLayers';
import { MarkupNotices } from '../MarkupNotices';
import type { MarkupLayerVisibility } from '../MarkupOverlay';
import { MarkupOverlay } from '../MarkupOverlay';
import { MarkupSheetDelete } from '../MarkupSheetDelete';
import {
  MarkupMirrorContext,
  MarkupScaleContext,
  MarkupViewport,
} from '../MarkupViewport';
import { MirrorOverride, mirrorPins, MirrorTab } from '../MirrorTab';
import { OutlineTool } from '../OutlineTool';
import { RulingKindControl } from '../RulingKindControl';
import type { MarkupToolId, MarkupToolProps } from '../SheetMarkupEditor.types';
import { TrialText } from '../TrialText';

import type { MarkupEditorContentProps } from './MarkupEditorContent.types';

/**
 * Инструменты в порядке работы с листом: сначала границы, потом линии и их
 * изгиб, в конце поля.
 */
const TOOL_OPTIONS: SegmentedControlOption[] = [
  { value: 'outline', label: 'Контур' },
  { value: 'lines', label: 'Линии' },
  { value: 'bend', label: 'Изгиб' },
  { value: 'margins', label: 'Поля' },
];

const TOOLS: Record<MarkupToolId, FC<MarkupToolProps>> = {
  outline: OutlineTool,
  lines: LinesTool,
  bend: BendTool,
  margins: MarginsTool,
};

/**
 * Стартовый инструмент — «Линии»: там автомат ошибается чаще всего, и там же
 * видно, верна ли разметка вообще.
 */
const START_TOOL: MarkupToolId = 'lines';

const ALL_LAYERS_SHOWN: MarkupLayerVisibility = {
  outline: true,
  lines: true,
  margins: true,
  marginLine: true,
  pins: true,
};

/**
 * Значение переключателя — инструмент редактора.
 *
 * @param value — значение из переключателя
 * @returns инструмент ли это
 */
const isToolId = (value: string): value is MarkupToolId => {
  return value in TOOLS;
};

/**
 * Содержимое редактора: фотография с разметкой слева, панель справа.
 * Монтируется заново на каждый открытый лист: инструмент, слои и страница
 * разворота с прошлого листа не переносятся.
 */
export const MarkupEditorContent: FC<MarkupEditorContentProps> = (props) => {
  const { record, draft } = props;
  const { sheet } = record;
  const close = useMarkupEditorStore((state) => {
    return state.close;
  });
  const requestClose = useMarkupEditorStore((state) => {
    return state.requestClose;
  });
  const reset = useMarkupEditorStore((state) => {
    return state.reset;
  });
  const isRemeasuring = useMarkupEditorStore((state) => {
    return state.isRemeasuring;
  });
  const saveSheetMarkup = useGeneratorStore((state) => {
    return state.saveSheetMarkup;
  });
  const removeUserSheet = useGeneratorStore((state) => {
    return state.removeUserSheet;
  });
  const [handleLayer, setHandleLayer] = useState<SVGGElement | null>(null);
  const [trialLayer, setTrialLayer] = useState<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<MarkupToolId>(START_TOOL);
  const [layers, setLayers] = useState(ALL_LAYERS_SHOWN);
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [isTrialEnabled, setIsTrialEnabled] = useState(false);
  const isMarkupHidden = useHideMarkupKey();
  const ActiveTool = TOOLS[tool];
  const isMirrorPage = pageIndex !== 0;

  /**
   * Разлиновка — страницы, а не листа, тем же селектором, что у раскладки и
   * отрисовки: у зеркальной страницы она отражена, и линии оверлея обязаны
   * совпасть со строками именно на ней.
   */
  const pageRuling = useMemo(() => {
    return getPageRuling({ ...sheet, ruling: draft.ruling }, pageIndex);
  }, [sheet, draft.ruling, pageIndex]);

  /**
   * Стабильный колбэк: он же `ref` слоя ручек, и новый на каждый рендер
   * снимал бы и ставил слой заново.
   */
  const handleHandleLayerChange = useCallback((layer: SVGGElement | null) => {
    setHandleLayer(layer);
  }, []);

  /**
   * Стабильный колбэк: окно зовёт его из эффекта на каждую смену масштаба.
   */
  const handleScaleChange = useCallback((next: number) => {
    setScale(next);
  }, []);

  /**
   * Стабильный колбэк: это `ref` слоя пробного текста.
   */
  const handleTrialLayerChange = useCallback((layer: HTMLDivElement | null) => {
    setTrialLayer(layer);
  }, []);

  const handleToolChange = (value: string) => {
    if (isToolId(value)) {
      setTool(value);
    }
  };

  const handleLayersChange = (next: MarkupLayerVisibility) => {
    setLayers(next);
  };

  const handleTrialEnabledChange = (isEnabled: boolean) => {
    setIsTrialEnabled(isEnabled);
  };

  const handlePageIndexChange = (next: number) => {
    setPageIndex(next);
  };

  const handleMarkupReset = () => {
    reset();
  };

  const handleSheetDelete = () => {
    removeUserSheet(sheet.id);
    close();
  };

  const handleEditorCancel = () => {
    requestClose();
  };

  /**
   * Вся разметка ложится на лист одним действием стора: страницы на листе
   * перекладываются один раз, а не по полю.
   */
  const handleMarkupSave = () => {
    saveSheetMarkup(sheet.id, draft);
    close();
  };

  /**
   * На зеркальной странице окно и ручки узнают ширину кадра из контекста:
   * фотография и слой ручек отражаются, а инструменты правят лист в его
   * собственных пикселях.
   */
  return (
    <MarkupMirrorContext value={isMirrorPage ? sheet.width : null}>
      <div className="flex min-h-0 flex-1 gap-4">
        {/*
         * Вкладки страниц — над окном, а не в панели: они меняют то, что
         * показано на снимке.
         */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <MirrorTab pageIndex={pageIndex} onPageIndexChange={handlePageIndexChange} />

          <MarkupViewport
            frame={sheet}
            photoSrc={sheet.src}
            photoLabel={
              isMirrorPage
                ? `Фотография листа «${sheet.label}», отражённая`
                : `Фотография листа «${sheet.label}»`
            }
            onScaleChange={handleScaleChange}
          >
            {/*
             * Пробный текст — страница с фотографией целиком: лежит над снимком и
             * под разметкой, чтобы ручки оставались видны; линии под ним
             * приглушены.
             */}
            <div
              ref={handleTrialLayerChange}
              className="pointer-events-none absolute inset-0"
            />

            <MarkupOverlay
              frame={sheet}
              ruling={pageRuling}
              pins={isMirrorPage ? mirrorPins(draft.pins, sheet.width) : draft.pins}
              layers={layers}
              tool={tool}
              isMuted={isTrialEnabled}
              isHidden={isMarkupHidden}
              onHandleLayerChange={handleHandleLayerChange}
            />
          </MarkupViewport>
        </div>

        {/*
         * Подвал с историей, сбросом и сохранением лежит вне прокрутки: высота
         * панели зависит от инструмента, и в прокрутке «Сохранить» то было бы
         * видно, то уходило бы под край окна.
         */}
        <aside
          aria-label="Настройка разметки"
          className="flex w-80 shrink-0 flex-col gap-3"
        >
          {/*
           * Отступ справа держит место под полосой прокрутки: полоса поверх
           * содержимого, как на macOS, иначе легла бы на поля ввода.
           */}
          <div
            data-testid="markup-panel-scroll"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-3"
          >
            <RulingKindControl />

            <SegmentedControl
              label="Инструмент"
              value={tool}
              options={TOOL_OPTIONS}
              onChange={handleToolChange}
            />

            <MarkupNotices tool={tool} draft={draft} />

            {/*
             * Выбор полей зеркала стоит там же, где у листа точные значения:
             * вкладка зеркала их не показывает, а в конце панели собственные
             * поля и числа зеркала терялись бы под инструментом и слоями.
             */}
            {isMirrorPage ? (
              <div className="text-sm">
                <MirrorOverride
                  handleLayer={handleLayer}
                  withHandles={tool === 'margins'}
                />
              </div>
            ) : (
              <ExactValues />
            )}

            {/*
             * Ручки инструментов уходят порталом в оверлей, но в дереве React
             * лежат здесь, вне окна просмотра, — масштаб им передаётся отсюда.
             */}
            <MarkupScaleContext value={scale}>
              <ActiveTool
                handleLayer={handleLayer}
                pageIndex={pageIndex}
                isMuted={isTrialEnabled}
              />

              <MarkupLayers layers={layers} onLayersChange={handleLayersChange} />

              <TrialText
                layer={trialLayer}
                pageIndex={pageIndex}
                isEnabled={isTrialEnabled}
                onEnabledChange={handleTrialEnabledChange}
              />
            </MarkupScaleContext>

            <div className="border-t border-border pt-4">
              <MarkupSheetDelete sheetLabel={sheet.label} onDelete={handleSheetDelete} />
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-3">
            <MarkupCloseConfirm />

            <MarkupFooter
              onReset={handleMarkupReset}
              onCancel={handleEditorCancel}
              isSaveDisabled={isRemeasuring}
              onSave={handleMarkupSave}
            />
          </div>
        </aside>
      </div>
    </MarkupMirrorContext>
  );
};
