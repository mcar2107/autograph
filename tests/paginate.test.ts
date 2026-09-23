import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import type { SheetCalibration } from '@pages/Generator/lib/calibrate/calibrate.types';
import type { FontMetrics } from '@pages/Generator/lib/measure/measure.types';
import { paginate } from '@pages/Generator/lib/paginate/paginate';
import type {
  LayoutPage,
  PageSheet,
  PaginateOptions,
} from '@pages/Generator/lib/paginate/paginate.types';
import type { RulingKind } from '@pages/Generator/lib/paper';
import { describe, expect, it } from 'vitest';

import { getBaselineY, getLineStep } from './helpers/baseline-model';
import { createMonospaceMeasurer } from './helpers/monospace-measurer';

/**
 * Метрики, на которых геометрия считается в уме: высота строчных — ровно
 * принятая доля шага, поэтому кегль равен шагу разлиновки; подъём бокса — один
 * кегль, поэтому верхний отступ блока — первая линия минус шаг; шаг строк на
 * линейке — шаг разлиновки.
 */
const METRICS: FontMetrics = { xHeight: 0.55, fontAscent: 1, lineHeight: 1.25 };

/**
 * Лист без боковых полей: ширина блока равна ширине кадра.
 *
 * @param step — шаг разлиновки; первая линия и верхнее поле — на один шаг от верха
 * @param size — кадр листа
 * @param kind — вид разлиновки
 * @returns лист страницы, как его видит разбивка
 */
const buildCalibration = (
  step: number,
  size: Pick<SheetCalibration, 'width' | 'height'>,
  kind: RulingKind = 'lined'
): SheetCalibration => {
  return {
    ruling: {
      step,
      firstLinePhase: step,
      skewAngle: 0,
      margins: { top: step, right: 0, bottom: BOTTOM_MARGIN_PX, left: 0 },
      marginLineX: null,
      marginLineSide: null,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
    kind,
    ...size,
  };
};

/**
 * Нижнее поле листов в пикселях кадра.
 */
const BOTTOM_MARGIN_PX = 20;

const FRAME = { width: 400, height: 400 };

/**
 * Два листа с разным шагом. Верхний отступ блока у обоих нулевой: первая линия
 * на шаг от верха, подъём бокса — тоже шаг.
 *
 * - шаг 40: (400 − 0 − 20) / 40 = 9,5 → 9 строк;
 * - шаг 30: (400 − 0 − 20) / 30 ≈ 12,67 → 12 строк.
 */
const WIDE_STEP_SHEET: PageSheet = {
  sheetId: 'wide',
  calibration: buildCalibration(40, FRAME),
};
const NARROW_STEP_SHEET: PageSheet = {
  sheetId: 'narrow',
  calibration: buildCalibration(30, FRAME),
};
const WIDE_STEP_LINES = 9;
const NARROW_STEP_LINES = 12;

/**
 * С запасом снизу в полтора шага:
 *
 * - шаг 40: (400 − 0 − 20 − 60) / 40 = 8;
 * - шаг 30: (400 − 0 − 20 − 45) / 30 ≈ 11,17 → 11.
 */
const BOTTOM_MARGIN_STEPS = 1.5;
const WIDE_STEP_LINES_WITH_RESERVE = 8;
const NARROW_STEP_LINES_WITH_RESERVE = 11;

/**
 * Метрики рукописного шрифта, на которых низ страницы легко потерять: подъём
 * строчного бокса выше шага строк на линейке и заметно ниже — на клетке. На
 * шаге 40 кегль — 40 × 0,55 / 0,5 = 44, подъём — 1,1 × 44 = 48,4, верхний
 * отступ блока — 40 − 48,4 = −8,4, первая базовая линия — 40.
 */
const TALL_METRICS: FontMetrics = { xHeight: 0.5, fontAscent: 1.1, lineHeight: 1.3 };

/**
 * Лист, на котором проверяется низ страницы, вместе с эталонной вместимостью.
 */
type BottomCase = {
  /**
   * Лист страницы.
   */
  sheet: PageSheet;

  /**
   * Сколько строк встаёт на полную страницу этого листа.
   */
  lineCount: number;
};

/**
 * Листы, где последняя строка встаёт у самого нижнего поля. Вместимость
 * посчитана по числам кадра: строка ставится, пока её базовая линия не ниже
 * поля.
 *
 * - клетка: строка — два шага, 80 px; поле кадра 400 — на 380; базовые линии
 *   40, 120, 200, 280, 360 — пять строк, шестая, 440, ниже поля;
 * - линейка: строка — шаг, 40 px; поле кадра 418 — на 398; базовые линии 40, 80,
 *   …, 360 — девять строк, десятая, 400, ниже поля.
 */
const BOTTOM_CASES: BottomCase[] = [
  {
    sheet: {
      sheetId: 'grid-bottom',
      calibration: buildCalibration(40, { width: 400, height: 400 }, 'grid'),
    },
    lineCount: 5,
  },
  {
    sheet: {
      sheetId: 'lined-bottom',
      calibration: buildCalibration(40, { width: 400, height: 418 }, 'lined'),
    },
    lineCount: 9,
  },
];

/**
 * Насколько Linux Chromium раскладывает строку шире её замера в долях кегля,
 * умноженного на кегль: наибольшее расхождение, снятое на пресетном шрифте.
 */
const BROWSER_WIDTH_EXCESS = 0.009;

/**
 * Символ — половина кегля: на шаге 40 символ занимает 20 пикселей и блок
 * держит 20 символов, на шаге 30 — 15 пикселей и 26 символов.
 */
const measure = createMonospaceMeasurer({ charWidth: 0.5 });

const alternateSheets = (pageIndex: number): PageSheet => {
  return pageIndex % 2 === 0 ? WIDE_STEP_SHEET : NARROW_STEP_SHEET;
};

const buildOptions = (patch: Partial<PaginateOptions> = {}): PaginateOptions => {
  return {
    measure,
    metrics: METRICS,
    correction: {},
    bottomMargin: 0,
    getPageSheet: alternateSheets,
    ...patch,
  };
};

const buildParagraph = (wordCount: number, prefix: string): string => {
  return Array.from({ length: wordCount }, (_word, index) => {
    return `${prefix}${index}`;
  }).join(' ');
};

/**
 * Длинный текст из нескольких абзацев с пустым абзацем посередине: его хватает
 * на несколько страниц, и абзацы переходят через границы страниц.
 */
const LONG_TEXT = [
  buildParagraph(60, 'альфа'),
  '',
  buildParagraph(45, 'бета'),
  buildParagraph(70, 'гамма'),
].join('\n');

/**
 * Склеивает строки страниц обратно в текст: строки одного абзаца — через
 * пробел, абзацы — через перевод строки.
 *
 * @param pages — страницы раскладки
 * @returns текст, собранный из строк
 */
const joinPages = (pages: LayoutPage[]): string => {
  let text = '';
  let previousParagraph: number | null = null;

  for (const { lines } of pages) {
    for (const { text: lineText, paragraphIndex } of lines) {
      if (previousParagraph !== null) {
        text +=
          paragraphIndex === previousParagraph
            ? ' '
            : '\n'.repeat(paragraphIndex - previousParagraph);
      }

      text += lineText;
      previousParagraph = paragraphIndex;
    }
  }

  return text;
};

describe('paginate', () => {
  it('склейка строк всех страниц даёт исходный текст без потерь и повторов', () => {
    const pages = paginate(LONG_TEXT, buildOptions());

    expect(pages.length).toBeGreaterThan(3);
    expect(joinPages(pages)).toBe(LONG_TEXT);
  });

  it('набирает каждую страницу под лист, доставшийся ей', () => {
    const pages = paginate(LONG_TEXT, buildOptions());

    expect(pages[0]?.sheetId).toBe('wide');
    expect(pages[1]?.sheetId).toBe('narrow');
    expect(pages[0]?.lines).toHaveLength(WIDE_STEP_LINES);
    expect(pages[1]?.lines).toHaveLength(NARROW_STEP_LINES);
    expect(pages[1]?.lines.length).toBeGreaterThan(pages[0]?.lines.length || 0);
  });

  it('вычитает запас снизу в шагах разлиновки листа страницы', () => {
    const pages = paginate(
      LONG_TEXT,
      buildOptions({ bottomMargin: BOTTOM_MARGIN_STEPS })
    );

    expect(pages[0]?.lines).toHaveLength(WIDE_STEP_LINES_WITH_RESERVE);
    expect(pages[1]?.lines).toHaveLength(NARROW_STEP_LINES_WITH_RESERVE);
  });

  it('переносит по ширине блока в пикселях кегля своей страницы', () => {
    const pages = paginate(LONG_TEXT, buildOptions());

    const widthOf = (page: LayoutPage | undefined, fontSizePx: number): number => {
      return Math.max(
        ...(page?.lines || []).map(({ text }) => {
          return text.length * 0.5 * fontSizePx;
        })
      );
    };

    expect(widthOf(pages[0], 40)).toBeLessThanOrEqual(FRAME.width);
    expect(widthOf(pages[1], 30)).toBeLessThanOrEqual(FRAME.width);
    expect(widthOf(pages[1], 30)).toBeGreaterThan(FRAME.width * 0.8);
  });

  it('оставляет строке запас на ширину, которую браузер раскладывает шире замера', () => {
    /**
     * Слова в 9 и 10 символов: пара с пробелом — ровно 20 символов, ровно
     * ширина блока на шаге 40. Без запаса такая строка встала бы вплотную к
     * краю блока, и браузер, разложивший её шире замера, вывел бы её за край.
     */
    const text = Array.from({ length: 12 }, (_word, index) => {
      return index % 2 === 0 ? 'а'.repeat(9) : 'б'.repeat(10);
    }).join(' ');
    const pages = paginate(
      text,
      buildOptions({
        getPageSheet: () => {
          return WIDE_STEP_SHEET;
        },
      })
    );

    for (const { lines } of pages) {
      for (const { text: lineText } of lines) {
        expect(
          lineText.length * 0.5 * 40 * (1 + BROWSER_WIDTH_EXCESS)
        ).toBeLessThanOrEqual(FRAME.width);
      }
    }
  });

  it('добирает строку до нижнего поля на клетке и на линейке, не опуская базовую линию под поле', () => {
    for (const { sheet, lineCount } of BOTTOM_CASES) {
      const { calibration } = sheet;
      const pages = paginate(
        LONG_TEXT,
        buildOptions({
          metrics: TALL_METRICS,
          getPageSheet: () => {
            return sheet;
          },
        })
      );
      const geometry = deriveGeometry(calibration, TALL_METRICS);
      const bottomLine = calibration.height - calibration.ruling.margins.bottom;

      expect(pages.length).toBeGreaterThan(1);

      for (const page of pages.slice(0, -1)) {
        const baseline = getBaselineY(geometry, TALL_METRICS, page.lines.length - 1);

        expect(page.lines).toHaveLength(lineCount);
        expect(baseline).toBeLessThanOrEqual(bottomLine);
        expect(bottomLine - baseline).toBeLessThan(getLineStep(geometry, TALL_METRICS));
      }
    }
  });

  it('слово шире блока занимает свою строку, и разбивка не зацикливается', () => {
    const narrow: PageSheet = {
      sheetId: 'narrow-block',
      calibration: buildCalibration(40, { width: 200, height: 400 }),
    };
    const text = 'раз сверхдлинноеслово два';
    const pages = paginate(
      text,
      buildOptions({
        getPageSheet: () => {
          return narrow;
        },
      })
    );

    expect(pages).toHaveLength(1);
    expect(
      pages[0]?.lines.map(({ text: lineText }) => {
        return lineText;
      })
    ).toEqual(['раз', 'сверхдлинноеслово', 'два']);
  });

  it('строка, не помещающаяся даже на пустую страницу, всё равно занимает свою', () => {
    /**
     * Первая базовая линия — 40, нижнее поле — на 50 − 20 = 30: ни одной строки
     * по формуле.
     */
    const tiny: PageSheet = {
      sheetId: 'tiny',
      calibration: buildCalibration(40, { width: 400, height: 50 }),
    };
    const pages = paginate(
      'раз\nдва\nтри',
      buildOptions({
        getPageSheet: () => {
          return tiny;
        },
      })
    );

    expect(
      pages.map(({ lines }) => {
        return lines.length;
      })
    ).toEqual([1, 1, 1]);
  });

  it('на пустом тексте отдаёт одну страницу с листом первой страницы', () => {
    const pages = paginate('', buildOptions());

    expect(pages).toHaveLength(1);
    expect(pages[0]?.sheetId).toBe('wide');
    expect(joinPages(pages)).toBe('');
  });
});
