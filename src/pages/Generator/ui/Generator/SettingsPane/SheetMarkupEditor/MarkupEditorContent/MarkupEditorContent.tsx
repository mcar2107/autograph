import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import type { FC } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { getPageRuling } from '../../../../../model/geometrySelectors';
import { useGeneratorStore } from '../../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { BendTool } from '../BendTool';
import { LinesTool } from '../LinesTool';
import { MarginsTool } from '../MarginsTool';
import { MarkupCloseConfirm } from '../MarkupCloseConfirm';
import { MarkupFooter } from '../MarkupFooter';
import { MarkupLayers } from '../MarkupLayers';
import { MarkupNotices } from '../MarkupNotices';
import type { MarkupLayerVisibility } from '../MarkupOverlay';
import { MarkupOverlay } from '../MarkupOverlay';
import { MarkupScaleContext, MarkupViewport } from '../MarkupViewport';
import { MirrorTab } from '../MirrorTab';
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
  const [tool, setTool] = useState<MarkupToolId>(START_TOOL);
  const [layers, setLayers] = useState(ALL_LAYERS_SHOWN);
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const ActiveTool = TOOLS[tool];

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

  const handleToolChange = (value: string) => {
    if (isToolId(value)) {
      setTool(value);
    }
  };

  const handleLayersChange = (next: MarkupLayerVisibility) => {
    setLayers(next);
  };

  const handlePageIndexChange = (next: number) => {
    setPageIndex(next);
  };

  const handleReset = () => {
    reset();
  };

  const handleDelete = () => {
    removeUserSheet(sheet.id);
    close();
  };

  const handleCancel = () => {
    requestClose();
  };

  /**
   * Вся разметка ложится на лист одним действием стора: страницы на листе
   * перекладываются один раз, а не по полю.
   */
  const handleSave = () => {
    saveSheetMarkup(sheet.id, draft);
    close();
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <MarkupViewport
        frame={sheet}
        photoSrc={sheet.src}
        photoLabel={`Фотография листа «${sheet.label}»`}
        onScaleChange={handleScaleChange}
      >
        <MarkupOverlay
          frame={sheet}
          ruling={pageRuling}
          pins={pageIndex === 0 ? draft.pins : []}
          layers={layers}
          onHandleLayerChange={handleHandleLayerChange}
        />
      </MarkupViewport>

      <aside
        aria-label="Настройка разметки"
        className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto"
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
         * Ручки инструментов уходят порталом в оверлей, но в дереве React
         * лежат здесь, вне окна просмотра, — масштаб им передаётся отсюда.
         */}
        <MarkupScaleContext value={scale}>
          <ActiveTool handleLayer={handleLayer} pageIndex={pageIndex} />

          <MarkupLayers layers={layers} onLayersChange={handleLayersChange} />

          <TrialText handleLayer={handleLayer} pageIndex={pageIndex} />
        </MarkupScaleContext>

        <MirrorTab pageIndex={pageIndex} onPageIndexChange={handlePageIndexChange} />

        <div className="mt-auto flex flex-col gap-3">
          <MarkupCloseConfirm />

          <MarkupFooter
            sheetLabel={sheet.label}
            onReset={handleReset}
            onDelete={handleDelete}
            onCancel={handleCancel}
            isSaveDisabled={isRemeasuring}
            onSave={handleSave}
          />
        </div>
      </aside>
    </div>
  );
};
