/**
 * @vitest-environment jsdom
 */
import type { PaperFamily } from '@pages/Generator/lib/paper';
import { clearLayoutCache } from '@pages/Generator/model/measureLayout';
import { findSheet } from '@pages/Generator/model/paperSelectors';
import { selectPageSheetId } from '@pages/Generator/model/recipeSelectors';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { usePageLayout } from '@pages/Generator/model/usePageLayout';
import { usePageRender } from '@pages/Generator/model/usePageRender';
import { useRunRender } from '@pages/Generator/model/useRunRender';
import { SheetViewport } from '@pages/Generator/ui/Generator/SheetViewport';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findCalls, getCanvasFrame } from './helpers/canvas-recorder';
import type { MonospaceMeasurerFactory } from './helpers/monospace-measurer';
import { createMonospaceMeasurerFactory } from './helpers/monospace-measurer';
import {
  buildRenderFamily,
  buildSheet,
  RENDER_SHEET_RULING,
} from './helpers/paper-family';
import { buildUserSheetRecord } from './helpers/user-sheet-record';

/**
 * Повторяет сборку экрана генератора, но с измерителем-моделью: настоящих
 * размеров jsdom не считает, а проверяем мы разбивку и состав отрисованного, а
 * не вёрстку.
 */
type HarnessProps = {
  /**
   * Фабрика измерителей-шпионов.
   */
  factory: MonospaceMeasurerFactory;
};

const Harness: FC<HarnessProps> = (props) => {
  const { factory } = props;
  const pages = usePageLayout(factory.create);
  const source = usePageRender(pages);
  const plan = useRunRender(pages);

  return <SheetViewport source={source} plan={plan} />;
};

const FAMILY = buildRenderFamily();

/**
 * Ширина символа измерителя-модели в долях кегля. Кегль семьи-модели на
 * запасных метриках jsdom — 40 · 0,55 / 0,48 ≈ 45,8 пикселя, символ — около
 * 9,2 пикселя: блок в сто пикселей держит десять символов и не держит
 * одиннадцать.
 */
const CHAR_WIDTH = 0.2;

/**
 * Запас снизу в шагах разлиновки, оставляющий на странице ровно две строки:
 * нижнего поля у семьи-модели нет, базовые линии стоят на 41,25, 81,25 и
 * 121,25, а запас в семь шагов поднимает низ листа до 400 − 7 · 40 = 120 — две
 * строки встают, третья оказалась бы ниже.
 */
const TWO_LINE_BOTTOM_MARGIN = 7;

/**
 * Поправка кегля в долях шага: четверть шага семьи-модели — десять пикселей.
 */
const FONT_SIZE_CORRECTION = 0.25;

const createFactory = (): MonospaceMeasurerFactory => {
  return createMonospaceMeasurerFactory({ charWidth: CHAR_WIDTH });
};

/**
 * Узел canvas страницы: на нём рисует предпросмотр.
 *
 * @returns узел предпросмотра
 */
const getPageCanvas = (): HTMLCanvasElement => {
  const canvas = screen.getByTestId('page-canvas');

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Предпросмотр рисует не на canvas');
  }

  return canvas;
};

/**
 * Число страниц из навигации «N / M».
 *
 * @returns число страниц прогона
 */
const getPageCount = (): number => {
  return Number((screen.getByTestId('page-count').textContent || '').replace('/', ''));
};

/**
 * Слова, отрисованные на странице, в порядке отрисовки.
 *
 * @returns тексты, попавшие в снимок
 */
const getDrawnWords = (): unknown[] => {
  return findCalls(getCanvasFrame(getPageCanvas()), 'fillText').map(([text]) => {
    return text;
  });
};

/**
 * Отступ блока текста от левого края листа: рендерер сдвигает на него начало
 * координат перед отрисовкой строк.
 *
 * @returns отступ в пикселях кадра листа страницы
 */
const getBlockLeftPadding = (): unknown => {
  const [translate] = findCalls(getCanvasFrame(getPageCanvas()), 'translate');

  return translate?.[0];
};

const renderHarness = async (factory: MonospaceMeasurerFactory) => {
  render(<Harness factory={factory} />);

  await waitFor(() => {
    expect(getDrawnWords().length).toBeGreaterThan(0);
  });
};

/**
 * Семья-модель с теми же идентификаторами листов, но с другим нижним полем у
 * их разлиновки: правка листа, при которой идентификатор остаётся прежним.
 *
 * @returns семья с изменённой разлиновкой листов
 */
const buildFamilyWithEditedRuling = (): PaperFamily => {
  return {
    ...FAMILY,
    sheets: FAMILY.sheets.map((sheet) => {
      return buildSheet(
        sheet.id,
        { ...sheet.ruling, margins: { ...sheet.ruling.margins, bottom: 80 } },
        { width: sheet.width, height: sheet.height }
      );
    }),
  };
};

beforeEach(() => {
  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    text: 'раз два три четыре пять шесть',
    presetFamilies: [FAMILY],
    familyId: FAMILY.id,
    sheetId: FAMILY.sheets[0]?.id || '',
  });
  /**
   * Ровное письмо: слова рисуются целиком и на своих местах, иначе побуквенные
   * искажения дробили бы слово на буквы и ленту вызовов.
   */
  useGeneratorStore.getState().selectRealismLevel('even');
});

afterEach(() => {
  cleanup();
});

describe('разбивка на строки и страницы', () => {
  it('переносит текст по ширине блока', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    expect(getDrawnWords()).toEqual(['раз', 'два', 'три', 'четыре', 'пять', 'шесть']);
    expect(getPageCount()).toBe(1);
  });

  it('разбивает на страницы по вместимости листа', async () => {
    const factory = createFactory();

    useGeneratorStore.setState({ bottomMargin: TWO_LINE_BOTTOM_MARGIN });
    await renderHarness(factory);

    expect(getDrawnWords()).toEqual(['раз', 'два', 'три', 'четыре']);
    expect(getPageCount()).toBe(2);
  });

  it('показывает выбранную страницу', async () => {
    const factory = createFactory();

    useGeneratorStore.setState({ bottomMargin: TWO_LINE_BOTTOM_MARGIN });
    await renderHarness(factory);

    act(() => {
      useGeneratorStore.getState().goToPage(1);
    });

    await waitFor(() => {
      expect(getDrawnWords()).toEqual(['пять', 'шесть']);
    });
  });

  it('страница раскладки несёт лист, доставшийся ей в прогоне', async () => {
    const factory = createFactory();

    useGeneratorStore.setState({ bottomMargin: TWO_LINE_BOTTOM_MARGIN });

    const { result } = renderHook(() => {
      return usePageLayout(factory.create);
    });

    await waitFor(() => {
      expect(result.current).toHaveLength(2);
    });

    const state = useGeneratorStore.getState();

    expect(
      result.current.map(({ sheetId }) => {
        return sheetId;
      })
    ).toEqual([selectPageSheetId(state, 0), selectPageSheetId(state, 1)]);
  });
});

describe('разворот чётных страниц', () => {
  it('отодвигает блок от отражённой линии поля', async () => {
    const factory = createFactory();

    useGeneratorStore.setState({ bottomMargin: TWO_LINE_BOTTOM_MARGIN });
    await renderHarness(factory);

    expect(getBlockLeftPadding()).toBeCloseTo(RENDER_SHEET_RULING.margins.left);

    act(() => {
      useGeneratorStore.getState().goToPage(1);
    });

    /**
     * Блок отражается вместе с листом: слева от него остаётся столько же,
     * сколько на нечётной странице оставалось справа.
     */
    await waitFor(() => {
      expect(getBlockLeftPadding()).toBeCloseTo(RENDER_SHEET_RULING.margins.right);
    });
  });
});

describe('кэш разбивки', () => {
  it('не измеряет заново при изменении цвета чернил', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    const measuresBefore = factory.createCalls();

    act(() => {
      useGeneratorStore.getState().setInk({ kind: 'custom', color: '#ff0000' });
    });

    await waitFor(() => {
      expect(getDrawnWords().length).toBeGreaterThan(0);
    });

    expect(factory.createCalls()).toBe(measuresBefore);
  });

  it('не измеряет заново при повторной раскладке с теми же параметрами', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    const measuresBefore = factory.createCalls();

    cleanup();
    await renderHarness(factory);

    expect(factory.createCalls()).toBe(measuresBefore);
  });

  it('измеряет заново при изменении поправки кегля', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    const measuresBefore = factory.createCalls();

    act(() => {
      useGeneratorStore
        .getState()
        .setGeometryCorrection({ fontSizePx: FONT_SIZE_CORRECTION });
    });

    await waitFor(() => {
      expect(factory.createCalls()).toBe(measuresBefore + 1);
    });
  });

  it('берёт готовую разбивку из кэша при возврате к прежним параметрам', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    act(() => {
      useGeneratorStore
        .getState()
        .setGeometryCorrection({ fontSizePx: FONT_SIZE_CORRECTION });
    });

    await waitFor(() => {
      expect(factory.createCalls()).toBe(2);
    });

    act(() => {
      useGeneratorStore.getState().setGeometryCorrection({ fontSizePx: 0 });
    });

    await waitFor(() => {
      expect(getDrawnWords().length).toBeGreaterThan(0);
    });

    expect(factory.createCalls()).toBe(2);
  });

  it('раскладывает заново, когда в семью добавлен свой лист', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    const measuresBefore = factory.createCalls();

    /**
     * Лист подмешивается в семью без закрепления: сдвигается раздача листов
     * по страницам, а выбор пользователя остаётся прежним.
     */
    act(() => {
      useGeneratorStore.setState({
        userSheets: [
          buildUserSheetRecord({ familyId: FAMILY.id, sheet: buildSheet('user-1') }),
        ],
      });
    });

    await waitFor(() => {
      expect(factory.createCalls()).toBe(measuresBefore + 1);
    });
  });

  it('раскладывает заново при правке разлиновки листа без смены идентификатора', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    const measuresBefore = factory.createCalls();

    act(() => {
      useGeneratorStore.setState({ presetFamilies: [buildFamilyWithEditedRuling()] });
    });

    await waitFor(() => {
      expect(factory.createCalls()).toBe(measuresBefore + 1);
    });
  });
});

describe('листы с разными пропорциями', () => {
  /**
   * Кадр второго листа: и ширина, и пропорции отличаются от первого. Высота
   * подобрана так, чтобы при запасе в восемь шагов на нём помещалась одна
   * строка, а на первом листе — две.
   */
  const OTHER_FRAME = { width: 300, height: 360 };

  /**
   * Текст, которому на листах семьи-модели нужно больше двух страниц. Исходный
   * текст из `beforeEach` раскладывается ровно на две.
   */
  const LONG_TEXT = 'раз два три четыре пять шесть семь восемь девять десять';

  /**
   * Семья-модель с теми же идентификаторами листов, но с другим кадром у
   * второго листа.
   *
   * @returns семья из двух листов с разными пропорциями
   */
  const buildFramedFamily = (): PaperFamily => {
    return {
      ...FAMILY,
      sheets: FAMILY.sheets.map((sheet, index) => {
        return index === 0 ? sheet : buildSheet(sheet.id, sheet.ruling, OTHER_FRAME);
      }),
    };
  };

  const FRAMED_FAMILY = buildFramedFamily();

  /**
   * Область просмотра, в которой за вычетом отступов по 24 пикселя остаётся
   * 200 × 400: оба листа вписываются по ширине, и лист на экране шириной в 200
   * пикселей, какой бы ни была ширина его кадра.
   */
  const VIEWPORT = { width: 248, height: 448 };

  const FIT_WIDTH = 200;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: VIEWPORT.width,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: VIEWPORT.height,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  });

  /**
   * Пропорции кадра листа, доставшегося странице в прогоне.
   *
   * @param pageIndex — номер страницы, считая с нуля
   * @returns высота кадра, делённая на ширину
   */
  const getFrameRatio = (pageIndex: number): number => {
    const sheet = findSheet(
      FRAMED_FAMILY,
      selectPageSheetId(useGeneratorStore.getState(), pageIndex)
    );

    return (sheet?.height || 0) / (sheet?.width || 1);
  };

  /**
   * Пропорции холста предпросмотра.
   *
   * @returns высота холста, делённая на ширину
   */
  const getCanvasRatio = (): number => {
    const canvas = getPageCanvas();

    return canvas.height / canvas.width;
  };

  const renderFramedHarness = async (): Promise<void> => {
    useGeneratorStore.setState({
      presetFamilies: [FRAMED_FAMILY],
      bottomMargin: TWO_LINE_BOTTOM_MARGIN,
    });
    await renderHarness(createFactory());
    await waitFor(() => {
      expect(getPageCount()).toBe(2);
    });
  };

  it('вписывает лист в область, а высоту ведёт за кадром листа страницы', async () => {
    await renderFramedHarness();

    expect(getFrameRatio(0)).not.toBeCloseTo(getFrameRatio(1));

    for (const pageIndex of [0, 1, 0]) {
      act(() => {
        useGeneratorStore.getState().goToPage(pageIndex);
      });

      await waitFor(() => {
        expect(getCanvasRatio()).toBeCloseTo(getFrameRatio(pageIndex), 2);
      });

      expect(getPageCanvas().width).toBe(FIT_WIDTH);
      expect(screen.getByTestId('page').style.width).toBe(`${String(FIT_WIDTH)}px`);
    }
  });

  it('оставляет пользователя на странице, когда пересчёт меняет число страниц', async () => {
    await renderFramedHarness();

    act(() => {
      useGeneratorStore.getState().goToPage(1);
    });

    await waitFor(() => {
      expect(getCanvasRatio()).toBeCloseTo(getFrameRatio(1), 2);
    });

    act(() => {
      useGeneratorStore.getState().setText(LONG_TEXT);
    });

    await waitFor(() => {
      expect(getPageCount()).toBeGreaterThan(2);
    });

    expect(useGeneratorStore.getState().pageIndex).toBe(1);
    expect(getCanvasRatio()).toBeCloseTo(getFrameRatio(1), 2);
  });

  it('оставляет пользователя на странице, когда страниц становится меньше, но она ещё есть', async () => {
    const { text } = useGeneratorStore.getState();

    await renderFramedHarness();

    act(() => {
      useGeneratorStore.getState().setText(LONG_TEXT);
    });

    await waitFor(() => {
      expect(getPageCount()).toBeGreaterThan(2);
    });

    act(() => {
      useGeneratorStore.getState().goToPage(1);
    });

    await waitFor(() => {
      expect(getCanvasRatio()).toBeCloseTo(getFrameRatio(1), 2);
    });

    act(() => {
      useGeneratorStore.getState().setText(text);
    });

    await waitFor(() => {
      expect(getPageCount()).toBe(2);
    });

    expect(useGeneratorStore.getState().pageIndex).toBe(1);
    expect(getCanvasRatio()).toBeCloseTo(getFrameRatio(1), 2);
  });
});

describe('снимок страницы', () => {
  it('не содержит элементов интерфейса', async () => {
    const factory = createFactory();

    useGeneratorStore.setState({ bottomMargin: TWO_LINE_BOTTOM_MARGIN });
    await renderHarness(factory);

    const pageNode = screen.getByTestId('page');

    expect(pageNode.querySelectorAll('button')).toHaveLength(0);
    expect(pageNode.querySelectorAll('nav')).toHaveLength(0);
    expect(pageNode.querySelectorAll('input')).toHaveLength(0);
    expect(pageNode.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('рисует лист и текст, и ничего кроме', async () => {
    const factory = createFactory();

    await renderHarness(factory);

    const drawn = new Set(
      getCanvasFrame(getPageCanvas()).map((call) => {
        return call.name;
      })
    );

    expect([...drawn].sort()).toEqual([
      'fillStyle',
      'fillText',
      'font',
      'restore',
      'save',
      'scale',
      'translate',
    ]);
  });
});
