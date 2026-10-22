import type {
  InkModulationSource,
  PageRenderParams,
  RenderContext,
  RenderFontMetrics,
  RenderGeometry,
  RenderImage,
  RenderPage,
} from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import { describe, expect, it } from 'vitest';

/**
 * Измеритель-модель: ширина символа фиксирована, поэтому координаты слов
 * считаются в уме и не зависят от того, какой шрифт нашёлся в системе.
 */
const CHAR_WIDTH = 10;

const FONT_SIZE_PX = 20;
const LINE_SPACING = 4;
const TOP_OFFSET = 30;
const LEFT_PADDING = 15;
const BLOCK_WIDTH = 600;
const INK_COLOR = '#123456';
const FONT_FAMILY = 'Eskal';

/**
 * Метрики шрифта-модели. Ни одна доля не совпадает с запасной: подставленное
 * вместо переданного сразу будет видно по координатам.
 */
const FONT_METRICS: RenderFontMetrics = { fontAscent: 0.7, lineHeight: 1.5 };

/**
 * Шаг строк и первая базовая линия — те же формулы, которыми `lib/calibrate`
 * выводит геометрию: шаг равен естественной высоте строчного бокса плюс
 * добавка, базовая линия лежит ниже верха строки на подъём бокса.
 */
const LINE_STEP = FONT_SIZE_PX * FONT_METRICS.lineHeight + LINE_SPACING;
const FIRST_BASELINE = FONT_METRICS.fontAscent * FONT_SIZE_PX;

const BASE_FONT = `${FONT_SIZE_PX}px "${FONT_FAMILY}"`;

/**
 * Записанный вызов контекста: имя метода или присвоенного свойства и
 * аргументы.
 */
type RecordedCall = {
  /**
   * Имя метода или свойства.
   */
  name: string;

  /**
   * Аргументы вызова или присвоенное значение.
   */
  args: (string | number)[];
};

/**
 * Контекст-записыватель вместе с лентой записанных вызовов.
 */
type Recorder = {
  /**
   * Контекст, который подставляется рендереру.
   */
  ctx: RenderContext;

  /**
   * Вызовы в порядке поступления.
   */
  calls: RecordedCall[];
};

/**
 * Контекст-записыватель: ничего не рисует, только запоминает, что его
 * попросили сделать, и меряет текст по модели.
 */
const createRecorder = (): Recorder => {
  const calls: RecordedCall[] = [];

  const push = (name: string, ...args: (string | number)[]): void => {
    calls.push({ name, args });
  };

  let font = '';
  let fillStyle = '';

  const ctx: RenderContext = {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
      push('font', value);
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof value === 'string' ? value : '';
      push('fillStyle', fillStyle);
    },
    textBaseline: 'alphabetic',
    save() {
      push('save');
    },
    restore() {
      push('restore');
    },
    scale(x, y) {
      push('scale', x, y);
    },
    translate(x, y) {
      push('translate', x, y);
    },
    rotate(angle) {
      push('rotate', angle);
    },
    transform(a, b, c, d, e, f) {
      push('transform', a, b, c, d, e, f);
    },
    drawImage(_image, dx, dy, dWidth, dHeight) {
      push('drawImage', dx, dy, dWidth, dHeight);
    },
    measureText(text) {
      return { width: text.length * CHAR_WIDTH };
    },
    fillText(text, x, y) {
      push('fillText', text, x, y);
    },
    beginPath() {
      push('beginPath');
    },
    moveTo(x, y) {
      push('moveTo', x, y);
    },
    lineTo(x, y) {
      push('lineTo', x, y);
    },
    quadraticCurveTo(cpx, cpy, x, y) {
      push('quadraticCurveTo', cpx, cpy, x, y);
    },
    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      push('bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y);
    },
    closePath() {
      push('closePath');
    },
    fill() {
      push('fill');
    },
  };

  return { ctx, calls };
};

const BACKGROUND_IMAGE: RenderImage = { width: 800, height: 1000, close: () => {} };

const NO_WORD_DISTORTION = { rotate: 0, skew: 0, translateY: 0, letters: [] };
const NO_LINE_DISTORTION = { rotate: 0, translateX: 0 };

/**
 * Три строки: обычная с двумя словами, пустая между абзацами и строка с
 * искажённым словом. Этого хватает, чтобы проверить и состав, и координаты, и
 * все виды трансформаций.
 */
const PAGE: RenderPage = {
  lines: [
    {
      words: [
        { text: 'аб', distortion: NO_WORD_DISTORTION, seed: 0 },
        { text: 'вгд', distortion: NO_WORD_DISTORTION, seed: 0 },
      ],
      distortion: NO_LINE_DISTORTION,
    },
    { words: [], distortion: NO_LINE_DISTORTION },
    {
      words: [
        {
          text: 'ежз',
          distortion: {
            rotate: 2,
            skew: 5,
            translateY: 3,
            letters: [{ index: 1, letterSpacing: 2, fontFamily: 'Lexa' }],
          },
          seed: 0,
        },
      ],
      distortion: { rotate: -1, translateX: 4 },
    },
  ],
};

const buildGeometry = (overrides: Partial<RenderGeometry> = {}): RenderGeometry => {
  return {
    fontSizePx: FONT_SIZE_PX,
    lineSpacing: LINE_SPACING,
    topOffset: TOP_OFFSET,
    leftPadding: LEFT_PADDING,
    blockWidth: BLOCK_WIDTH,
    blockRotate: 0,
    fontMetrics: FONT_METRICS,
    bend: null,
    perspective: null,
    ...overrides,
  };
};

/**
 * Внешность листа, которая ничего не меняет: разделение проходов и модуляция
 * проверяются отдельно, а здесь важен состав отрисованного.
 */
const NO_INK: InkModulationSource = { lighting: null, texture: null, seed: 1 };

const buildParams = (overrides: Partial<PageRenderParams> = {}): PageRenderParams => {
  return {
    page: PAGE,
    background: { image: BACKGROUND_IMAGE, width: 800, height: 1000 },
    inkColor: INK_COLOR,
    ink: NO_INK,
    glyphs: null,
    fontFamily: FONT_FAMILY,
    geometry: buildGeometry(),
    scale: 1,
    ...overrides,
  };
};

const render = (overrides: Partial<PageRenderParams> = {}): RecordedCall[] => {
  const { ctx, calls } = createRecorder();

  renderPageToCanvas(ctx, buildParams(overrides));

  return calls;
};

/**
 * Вызовы одного имени — в порядке записи.
 */
const callsOf = (calls: RecordedCall[], name: string): RecordedCall[] => {
  return calls.filter((call) => {
    return call.name === name;
  });
};

/**
 * Один аргумент от каждого вызова с этим именем — в порядке записи.
 */
const argsOf = (
  calls: RecordedCall[],
  name: string,
  index: number
): (string | number | undefined)[] => {
  return calls.reduce<(string | number | undefined)[]>((acc, call) => {
    if (call.name === name) {
      acc.push(call.args[index]);
    }

    return acc;
  }, []);
};

/**
 * Лента без вызовов перечисленных имён: так сравниваются прогоны, которые
 * должны отличаться только ими.
 */
const withoutCalls = (calls: RecordedCall[], names: string[]): RecordedCall[] => {
  return calls.reduce<RecordedCall[]>((acc, call) => {
    if (!names.includes(call.name)) {
      acc.push(call);
    }

    return acc;
  }, []);
};

/**
 * Ординаты базовых линий: строка начинается со сдвига по вертикали от начала
 * блока.
 */
const baselinesOf = (calls: RecordedCall[]): (string | number | undefined)[] => {
  return calls.reduce<(string | number | undefined)[]>((acc, call) => {
    if (call.name === 'translate' && call.args[0] === 0 && call.args[1] !== 0) {
      acc.push(call.args[1]);
    }

    return acc;
  }, []);
};

describe('renderPageToCanvas', () => {
  it('рисует слова раскладки в том же порядке и тем же составом', () => {
    expect(argsOf(render(), 'fillText', 0)).toEqual(['аб', 'вгд', 'е', 'ж', 'з']);
  });

  it('кладёт слова по посчитанным координатам', () => {
    const [firstWord, secondWord] = callsOf(render(), 'fillText');

    expect(firstWord?.args).toEqual(['аб', 0, 0]);
    /**
     * Второе слово отступает на ширину первого плюс пробел: 2 и 1 символа по
     * модели измерителя.
     */
    expect(secondWord?.args).toEqual(['вгд', 3 * CHAR_WIDTH, 0]);
  });

  it('ставит блок текста по отступам и красит чернила', () => {
    const calls = render();
    const blockShift = callsOf(calls, 'translate')[0];

    expect(blockShift?.args).toEqual([LEFT_PADDING, TOP_OFFSET]);
    expect(callsOf(calls, 'fillStyle')[0]?.args).toEqual([INK_COLOR]);
    expect(callsOf(calls, 'font')[0]?.args).toEqual([BASE_FONT]);
  });

  it('отсчитывает первую базовую линию от подъёма строчного бокса', () => {
    const raised: RenderFontMetrics = {
      ...FONT_METRICS,
      fontAscent: FONT_METRICS.fontAscent + 0.1,
    };
    const [baseline] = baselinesOf(render());
    const [raisedBaseline] = baselinesOf(
      render({ geometry: buildGeometry({ fontMetrics: raised }) })
    );

    expect(baseline).toBeCloseTo(FIRST_BASELINE);
    expect(raisedBaseline).toBeCloseTo(FIRST_BASELINE + 0.1 * FONT_SIZE_PX);
  });

  it('считает шаг строк по метрике шрифта, а пустая строка только сдвигает базовую линию', () => {
    const stretched: RenderFontMetrics = { ...FONT_METRICS, lineHeight: 3 };
    const [, thirdLine] = baselinesOf(render());
    const [, stretchedThirdLine] = baselinesOf(
      render({ geometry: buildGeometry({ fontMetrics: stretched }) })
    );

    /**
     * Третья строка — третья по счёту, хотя вторая пустая и ничего не
     * нарисовала.
     */
    expect(thirdLine).toBeCloseTo(FIRST_BASELINE + 2 * LINE_STEP);
    /**
     * Вдвое большая естественная высота строки растягивает шаг ровно на неё,
     * добавка к интервалу остаётся прежней.
     */
    expect(stretchedThirdLine).toBeCloseTo(
      FIRST_BASELINE + 2 * (FONT_SIZE_PX * 3 + LINE_SPACING)
    );
  });

  it('качает строку вокруг середины блока', () => {
    const calls = render({
      page: {
        lines: [
          {
            words: [{ text: 'аб', distortion: NO_WORD_DISTORTION, seed: 0 }],
            distortion: { rotate: -1, translateX: 4 },
          },
        ],
      },
    });
    const start = calls.findIndex((call) => {
      return call.name === 'translate' && call.args[1] === FIRST_BASELINE;
    });

    expect(calls.slice(start, start + 5)).toEqual([
      { name: 'translate', args: [0, FIRST_BASELINE] },
      { name: 'translate', args: [BLOCK_WIDTH / 2, 0] },
      { name: 'rotate', args: [(-1 * Math.PI) / 180] },
      { name: 'translate', args: [4, 0] },
      { name: 'translate', args: [-BLOCK_WIDTH / 2, 0] },
    ]);
  });

  it('поворачивает блок вокруг угла листа до отступов', () => {
    const angle = (2 * Math.PI) / 180;
    const calls = render({ geometry: buildGeometry({ blockRotate: 2 }) });
    const start = calls.findIndex((call) => {
      return call.name === 'drawImage';
    });

    /**
     * Верхний отступ задан в координате вдоль линий, а в повёрнутой системе
     * блока та же высота короче в cos θ раз.
     */
    expect(calls.slice(start + 1, start + 4)).toEqual([
      { name: 'save', args: [] },
      { name: 'rotate', args: [angle] },
      { name: 'translate', args: [LEFT_PADDING, TOP_OFFSET * Math.cos(angle)] },
    ]);
  });

  it('применяет трансформации слова в порядке css-цепочки', () => {
    const word = {
      text: 'ежз',
      distortion: { rotate: 2, skew: 5, translateY: 3, letters: [] },
      seed: 0,
    };
    const calls = render({
      page: { lines: [{ words: [word], distortion: NO_LINE_DISTORTION }] },
      background: null,
    });
    const originX = (3 * CHAR_WIDTH) / 2;

    expect(calls).toEqual([
      { name: 'save', args: [] },
      { name: 'scale', args: [1, 1] },
      { name: 'save', args: [] },
      { name: 'translate', args: [LEFT_PADDING, TOP_OFFSET] },
      { name: 'fillStyle', args: [INK_COLOR] },
      { name: 'font', args: [BASE_FONT] },
      { name: 'save', args: [] },
      { name: 'translate', args: [0, FIRST_BASELINE] },
      { name: 'translate', args: [BLOCK_WIDTH / 2, 0] },
      { name: 'translate', args: [-BLOCK_WIDTH / 2, 0] },
      { name: 'save', args: [] },
      { name: 'translate', args: [originX, 0] },
      { name: 'rotate', args: [(2 * Math.PI) / 180] },
      { name: 'transform', args: [1, 0, Math.tan((5 * Math.PI) / 180), 1, 0, 0] },
      { name: 'translate', args: [0, 3] },
      { name: 'translate', args: [-originX, 0] },
      { name: 'fillText', args: ['ежз', 0, 0] },
      { name: 'restore', args: [] },
      { name: 'restore', args: [] },
      { name: 'restore', args: [] },
      { name: 'restore', args: [] },
    ]);
  });

  it('уважает межбуквенный интервал и подмену шрифта буквы', () => {
    const calls = render();

    expect(argsOf(calls, 'font', 0)).toContain(`${FONT_SIZE_PX}px "Lexa"`);
    /**
     * После искажённой второй буквы перо уходит на её ширину плюс добавку к
     * интервалу. Первые два слова рисуются целиком, побуквенно — только третье.
     */
    expect(argsOf(calls, 'fillText', 1).slice(2)).toEqual([
      0,
      CHAR_WIDTH,
      2 * CHAR_WIDTH + 2,
    ]);
  });

  it('не рисует фон, когда он скрыт, и кладёт текст по тем же координатам', () => {
    const withBackground = render();
    const withoutBackground = render({ background: null });

    expect(callsOf(withoutBackground, 'drawImage')).toHaveLength(0);
    expect(callsOf(withBackground, 'drawImage')[0]?.args).toEqual([0, 0, 800, 1000]);
    expect(withoutBackground).toEqual(withoutCalls(withBackground, ['drawImage']));
  });

  it('не выпускает слово за правую границу блока', () => {
    const narrow = render({ geometry: buildGeometry({ blockWidth: 25 }) });
    const unlimited = render({ geometry: buildGeometry({ blockWidth: 0 }) });

    expect(argsOf(narrow, 'fillText', 0)).toEqual(['аб', 'е', 'ж', 'з']);
    expect(argsOf(unlimited, 'fillText', 0)).toEqual(['аб', 'вгд', 'е', 'ж', 'з']);
  });

  it('возвращает контекст в исходное состояние', () => {
    const calls = render();

    let depth = 0;
    let minDepth = 0;

    for (const { name } of calls) {
      if (name === 'save') {
        depth += 1;
      }

      if (name === 'restore') {
        depth -= 1;
      }

      minDepth = Math.min(minDepth, depth);
    }

    expect(depth).toBe(0);
    expect(minDepth).toBe(0);
  });

  it('меняет от масштаба только разрешение, но не состав отрисованного', () => {
    const single = render({ scale: 1 });
    const triple = render({ scale: 3 });
    const flat = render({ scale: 0 });
    const mirrored = render({ scale: -2 });

    expect(callsOf(triple, 'scale')[0]?.args).toEqual([3, 3]);
    expect(callsOf(flat, 'scale')[0]?.args).toEqual([0, 0]);
    expect(callsOf(mirrored, 'scale')[0]?.args).toEqual([-2, -2]);
    expect(withoutCalls(triple, ['scale'])).toEqual(withoutCalls(single, ['scale']));
    expect(withoutCalls(flat, ['scale'])).toEqual(withoutCalls(single, ['scale']));
    expect(withoutCalls(mirrored, ['scale'])).toEqual(withoutCalls(single, ['scale']));
  });

  it('переживает пустую страницу, пустое слово и букву за пределами слова', () => {
    const empty = render({ page: { lines: [] } });
    const gap = render({
      page: {
        lines: [
          {
            words: [
              { text: '', distortion: NO_WORD_DISTORTION, seed: 0 },
              { text: 'аб', distortion: NO_WORD_DISTORTION, seed: 0 },
            ],
            distortion: NO_LINE_DISTORTION,
          },
        ],
      },
    });
    const strayLetter = render({
      page: {
        lines: [
          {
            words: [
              {
                text: 'аб',
                distortion: {
                  rotate: 0,
                  skew: 0,
                  translateY: 0,
                  letters: [{ index: 9, letterSpacing: 5, fontFamily: 'Lexa' }],
                },
                seed: 0,
              },
            ],
            distortion: NO_LINE_DISTORTION,
          },
        ],
      },
    });

    expect(callsOf(empty, 'fillText')).toHaveLength(0);
    expect(callsOf(gap, 'fillText')[0]?.args).toEqual(['аб', CHAR_WIDTH, 0]);
    expect(argsOf(strayLetter, 'fillText', 0)).toEqual(['а', 'б']);
    expect(argsOf(strayLetter, 'font', 0)).not.toContain(`${FONT_SIZE_PX}px "Lexa"`);
  });

  it('повторный вызов с теми же параметрами даёт ту же запись', () => {
    expect(render()).toEqual(render());
  });
});
