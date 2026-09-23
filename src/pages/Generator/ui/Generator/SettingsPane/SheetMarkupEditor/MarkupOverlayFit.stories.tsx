import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FC } from 'react';
import { useEffect } from 'react';
import { expect, waitFor } from 'storybook/test';

import { HANDWRITING_FONTS, LINED_FAMILY_ID } from '../../../../config';
import { loadFontMetrics } from '../../../../lib/measure/measureFontMetrics';
import type {
  PaperFamily,
  PaperSheet,
  RulingBend,
  SheetPoint,
} from '../../../../lib/paper';
import type { PageRenderParams } from '../../../../lib/render';
import { renderPageLayers } from '../../../../lib/render';
import { clearLayoutCache } from '../../../../model/measureLayout';
import { loadPaperFamilies } from '../../../../model/paperProfiles';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '../../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../../model/useMarkupEditorStore';
import { usePageGeometry } from '../../../../model/usePageGeometry';
import { usePageLayout } from '../../../../model/usePageLayout';
import { usePageRender } from '../../../../model/usePageRender';
import { deriveUserSheetMarkup } from '../../../../model/userSheetsStorageRecord';

import { SheetMarkupEditor } from './SheetMarkupEditor';

/**
 * Снимок отрисовки страницы: параметры и лист, на который её разложили.
 */
type FitProbe = {
  /**
   * Параметры отрисовки страницы в пикселях кадра.
   */
  params: PageRenderParams;

  /**
   * Лист, на который страницу разложили.
   */
  layoutSheetId: string;

  /**
   * Лист, геометрию которого дала страница.
   */
  sheetId: string;

  /**
   * Сколько строк на странице.
   */
  lineCount: number;

  /**
   * Размер страницы в пикселях кадра.
   */
  pageWidth: number;

  /**
   * Высота страницы в пикселях кадра.
   */
  pageHeight: number;
};

/**
 * Линия оверлея, прочитанная из DOM.
 */
type OverlayLine = {
  /**
   * Номер линии.
   */
  index: number;

  /**
   * Точки ломаной слева направо.
   */
  points: SheetPoint[];
};

/**
 * Промах буквы мимо ближайшей линии оверлея.
 */
type LineMiss = {
  /**
   * Расстояние по вертикали, px фотографии.
   */
  miss: number;

  /**
   * Номер ближайшей линии.
   */
  index: number;
};

let lastProbe: FitProbe | null = null;

const SHEET_ID = 'user-fit-sheet';

const DEFAULT_FONT = HANDWRITING_FONTS[0]?.family || '';

const TEXT = [
  'Рукописный текст ложится на разлиновку тетрадного листа строка за строкой,',
  'и редактор разметки обязан рисовать линии ровно там, где отрисовка посадит',
  'базовые линии строк: на листе, снятом на столе, шаг меняется к дальнему краю,',
  'а волна бумаги уводит линию вверх и вниз, и любая своя формула оверлея',
  'разошлась бы со строками на странице раньше, чем это заметит глаз.',
].join(' ');

/**
 * Допуск спеки: линия оверлея и базовая линия строки расходятся не больше чем
 * на пиксель фотографии.
 */
const PIXEL_TOLERANCE = 1;

/**
 * Сколько букв и строк нужно сверить, чтобы проверка что-то значила.
 */
const MIN_LETTER_COUNT = 200;
const MIN_LINE_COUNT = 8;

/**
 * Волна бумаги в долях шага: заметно больше пикселя, иначе сверка без изгиба
 * прошла бы так же.
 */
const BEND_SHARE = 0.3;

const BEND_COLUMNS = 6;

/**
 * Перспектива листа на столе: шаг к низу больше на несколько процентов.
 */
const PERSPECTIVE_STEP_GROWTH = 0.04;
const PERSPECTIVE_CONVERGENCE_SHARE = 0.01;

/**
 * Проба: раскладка и параметры отрисовки теми же хуками, что у экрана
 * генератора, и редактор разметки на том же листе.
 */
const MarkupOverlayFitProbe: FC = () => {
  const pages = usePageLayout();
  const source = usePageRender(pages);
  const { sheet } = usePageGeometry();
  const params = source ? source.buildParams(1) : null;

  /**
   * Без списка зависимостей: проба снимается на каждый рендер — метрики
   * шрифта и раскладка доезжают асинхронно, и важно последнее состояние.
   */
  useEffect(() => {
    lastProbe =
      source && params && sheet
        ? {
            params,
            layoutSheetId: pages[0]?.sheetId || '',
            sheetId: sheet.id,
            lineCount: params.page.lines.length,
            pageWidth: source.pageWidth,
            pageHeight: source.pageHeight,
          }
        : null;
  });

  return <SheetMarkupEditor />;
};

/**
 * Лист на столе с волной бумаги: фотография пресета, а разлиновка с
 * перспективой и изгибом, заданными литералами, — у пресет-пака их нет.
 *
 * @param sheet — лист пресет-пака
 * @returns свой лист с перспективой и изгибом
 */
const buildBentPerspectiveSheet = (sheet: PaperSheet): PaperSheet => {
  const { width, height, ruling } = sheet;
  const { step, firstLinePhase } = ruling;
  const rowCount = Math.ceil(height / step) + 2;
  const bend: RulingBend = {
    columnOrigin: width / (2 * BEND_COLUMNS),
    columnSpacing: width / BEND_COLUMNS,
    columnCount: BEND_COLUMNS,
    rowOrigin: firstLinePhase - step,
    rowSpacing: step,
    rowCount,
    offsets: Array.from({ length: BEND_COLUMNS * rowCount }, (_value, node) => {
      const column = node % BEND_COLUMNS;
      const row = Math.floor(node / BEND_COLUMNS);

      return (
        BEND_SHARE *
        step *
        Math.sin((2 * Math.PI * column) / (BEND_COLUMNS - 1)) *
        Math.cos(row * 0.15)
      );
    }),
  };

  return {
    ...sheet,
    id: SHEET_ID,
    label: 'Лист на столе',
    ruling: {
      ...ruling,
      bend,
      perspective: {
        originX: width / 2,
        originY: height / 2,
        convergenceX: PERSPECTIVE_CONVERGENCE_SHARE / width,
        convergenceY: PERSPECTIVE_STEP_GROWTH / (2 * height),
      },
    },
  };
};

/**
 * Кладёт лист своим, закрепляет его на странице и открывает на нём редактор.
 *
 * @param families — семьи пресет-пака
 * @returns свой лист
 */
const applySheet = (families: PaperFamily[]): PaperSheet => {
  const preset = families.find(({ id }) => {
    return id === LINED_FAMILY_ID;
  })?.sheets[0];

  if (!preset) {
    throw new Error('В пресет-паке нет листа в линейку');
  }

  const sheet = buildBentPerspectiveSheet(preset);
  const record = {
    familyId: LINED_FAMILY_ID,
    sheet,
    kind: 'lined' as const,
    ...deriveUserSheetMarkup(sheet, 'lined'),
    isAnalyzed: true,
  };

  lastProbe = null;
  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: families,
    userSheets: [record],
    hasRestoredUserSheets: true,
    text: TEXT,
    familyId: LINED_FAMILY_ID,
    sheetId: SHEET_ID,
    isSheetPinned: true,
  });
  /**
   * Ровное письмо: искажения почерка сдвигали бы буквы с базовых линий,
   * которые здесь и сверяются.
   */
  useGeneratorStore.getState().selectRealismLevel('even');
  useMarkupEditorStore.getState().open(record);

  return sheet;
};

/**
 * Рисует страницу и записывает, куда встала середина каждой буквы на
 * базовой линии, в пикселях страницы.
 *
 * Буквы идут без контуров — обычным `fillText`: на листе с изгибом и
 * перспективой так каждая буква ставится на свою линию отдельно, и середина
 * буквы на базовой линии — ровно та точка, которую отрисовка сажает на
 * линию. Запись идёт с настоящего контекста канвы после всех преобразований
 * рендерера, а не по модели строчного бокса.
 *
 * @param probe — снимок параметров отрисовки
 * @returns точки букв на странице
 */
const recordLetterBaselines = (probe: FitProbe): SheetPoint[] => {
  const { params, pageWidth, pageHeight } = probe;
  const canvas = document.createElement('canvas');

  canvas.width = Math.round(pageWidth);
  canvas.height = Math.round(pageHeight);

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Канва не создалась');
  }

  const points: SheetPoint[] = [];
  const fillText = context.fillText.bind(context);

  context.fillText = (text: string, x: number, y: number) => {
    const { a, b, c, d, e, f } = context.getTransform();
    const middle = x + context.measureText(text).width / 2;

    points.push({ x: a * middle + c * y + e, y: b * middle + d * y + f });
    fillText(text, x, y);
  };

  renderPageLayers(
    context,
    { ...params, glyphs: null },
    { width: canvas.width, height: canvas.height },
    {
      createLayer: () => {
        return null;
      },
    }
  );

  return points;
};

/**
 * Линии, которые редактор нарисовал поверх фотографии, — из атрибутов SVG.
 *
 * @returns линии оверлея
 */
const readOverlayLines = (): OverlayLine[] => {
  return [
    ...document.querySelectorAll<SVGPolylineElement>('[data-layer="lines"] polyline'),
  ].map((line) => {
    return {
      index: Number(line.dataset.lineIndex),
      points: (line.getAttribute('points') || '').split(' ').map((pair) => {
        const [x = 0, y = 0] = pair.split(',').map(Number);

        return { x, y };
      }),
    };
  });
};

/**
 * Высота ломаной в столбце линейной интерполяцией между её точками.
 *
 * @param points — точки ломаной слева направо
 * @param x — столбец
 * @returns высота; `null` — столбец вне ломаной
 */
const interpolateLine = (points: SheetPoint[], x: number): number | null => {
  const right = points.findIndex((point) => {
    return point.x >= x;
  });
  const end = points[right];
  const start = points[right - 1] || end;

  if (!start || !end || start.x > x) {
    return null;
  }

  const span = end.x - start.x;

  return span > 0 ? start.y + ((end.y - start.y) * (x - start.x)) / span : end.y;
};

/**
 * Расстояние от точки до ближайшей линии оверлея по вертикали вместе с
 * номером этой линии.
 *
 * @param lines — линии оверлея
 * @param point — точка буквы
 * @returns промах в пикселях и номер линии
 */
const measureMiss = (lines: OverlayLine[], point: SheetPoint): LineMiss => {
  return lines.reduce<LineMiss>(
    (best, { index, points }) => {
      const y = interpolateLine(points, point.x);
      const miss = y === null ? Number.POSITIVE_INFINITY : Math.abs(point.y - y);

      return miss < best.miss ? { miss, index } : best;
    },
    { miss: Number.POSITIVE_INFINITY, index: Number.NaN }
  );
};

const meta = {
  component: MarkupOverlayFitProbe,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MarkupOverlayFitProbe>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Базовые линии букв, нарисованных рендерером страницы, лежат на линиях,
 * которые редактор рисует поверх фотографии, — на листе с перспективой и
 * волной бумаги, с допуском в пиксель фотографии.
 */
export const BaselinesOnOverlayLines: Story = {
  play: async () => {
    const families = await loadPaperFamilies();
    const sheet = applySheet(families);
    const metrics = await loadFontMetrics(DEFAULT_FONT);

    await waitFor(
      async () => {
        await expect(lastProbe?.sheetId).toBe(sheet.id);
        await expect(lastProbe?.layoutSheetId).toBe(sheet.id);
        await expect(lastProbe?.params.geometry.fontMetrics.fontAscent).toBeCloseTo(
          metrics.fontAscent,
          6
        );
        await expect(lastProbe?.lineCount || 0).toBeGreaterThanOrEqual(MIN_LINE_COUNT);
        await expect(readOverlayLines().length).toBeGreaterThan(MIN_LINE_COUNT);
      },
      { timeout: 15_000 }
    );

    if (!lastProbe) {
      throw new Error('Страница не собралась');
    }

    await expect(lastProbe.params.geometry.perspective).not.toBeNull();
    await expect(lastProbe.params.geometry.bend).not.toBeNull();

    const lines = readOverlayLines();
    const letters = recordLetterBaselines(lastProbe);
    const misses = letters.map((point) => {
      return measureMiss(lines, point);
    });
    const worst = Math.max(
      ...misses.map(({ miss }) => {
        return miss;
      })
    );
    const hitLines = new Set(
      misses.map(({ index }) => {
        return index;
      })
    );

    await expect(letters.length).toBeGreaterThanOrEqual(MIN_LETTER_COUNT);
    await expect(hitLines.size).toBeGreaterThanOrEqual(MIN_LINE_COUNT);
    await expect(worst).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  },
};
