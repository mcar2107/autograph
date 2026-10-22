import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import type {
  GlyphOutline,
  GlyphPathCommand,
  GlyphPoint,
  GlyphSource,
} from '@pages/Generator/lib/glyph/glyph.types';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { Page } from '@pages/Generator/lib/paginate/paginate.types';
import type {
  PaperFamily,
  PaperSheet,
  RulingBend,
  SheetRuling,
} from '@pages/Generator/lib/paper';
import { sampleRulingBend } from '@pages/Generator/lib/paper';
import type {
  PageGlyphs,
  PageRenderParams,
  RenderContext,
} from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import { buildPageRenderParams } from '@pages/Generator/model/buildPageRenderParams';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import type { PageRenderInput } from '@pages/Generator/model/pageRender.types';
import { describe, expect, it } from 'vitest';

import { createDrawRecorder, findCalls } from './helpers/canvas-recorder';
import { NO_DISTORTION_FLAGS } from './helpers/distortion-flags';
import { createPathRecorder } from './helpers/path-recorder';

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Лист-модель: кадр в меру пресета, наклон не нулевой, чтобы выборка изгиба
 * получала угол блока, а не ноль.
 */
const RULING_STEP = 40;
const SHEET_WIDTH = 1600;
const SHEET_HEIGHT = 1200;
const SKEW_ANGLE = 0.8;
const FIRST_LINE_PHASE = 60;
const SHEET_MARGIN = 100;

/**
 * Допуск попадания на линию — десятая доля шага, как в требовании.
 */
const TOLERANCE_STEPS = 0.1;

/**
 * Изгиб под буквами обязан быть заметно больше допуска: иначе и прямая строка
 * уложилась бы в него, и проверка попадания ничего бы не доказала.
 */
const MIN_BEND_STEPS = 0.3;

/**
 * Амплитуда волны изгиба — 0,4 шага: больше порога, но меньше половины шага,
 * чтобы ближайшая к букве линия оставалась своей.
 */
const BEND_AMPLITUDE = RULING_STEP * 0.4;
const BEND_COLUMN_COUNT = 9;

/**
 * Разрешение отрисовки не единичное: изгиб обязан выбираться в пикселях
 * страницы, а не в пикселях канвы.
 */
const SCALE = 2;

/**
 * Ширина символа в измерителе записывателя путей: по ней ищется середина
 * буквы, вокруг которой рендерер её поворачивает.
 */
const RECORDER_CHAR_WIDTH = 10;

/**
 * Полуширина конечной разности, которой проверяется поворот буквы, и допуск
 * совпадения угла. Изгиб — гладкий сплайн, и на полупикселе разность от
 * производной отличается на порядки меньше допуска.
 */
const TANGENT_STEP = 0.5;
const ANGLE_TOLERANCE = 1e-3;

/**
 * Касательная хотя бы где-то заметно не нулевая: иначе совпадение угла с ней
 * прошло бы и без поворота.
 */
const MIN_TANGENT = 0.03;

/**
 * Узлы строки изгиба — период синусоиды во всю область узлов: линия и
 * поднимается, и опускается на ширине блока. Смещения кратны сотой, как у
 * настоящей сетки.
 *
 * @param share — доля амплитуды
 * @returns смещения узлов строки
 */
const buildBendRow = (share: number): number[] => {
  return Array.from({ length: BEND_COLUMN_COUNT }, (_, index) => {
    const phase = (2 * Math.PI * index) / (BEND_COLUMN_COUNT - 1);

    return Math.round(BEND_AMPLITUDE * share * Math.sin(phase) * 100) / 100;
  });
};

/**
 * Вторая строка узлов слабее первой: смешивание строк по координате вдоль
 * линий участвует в выборке.
 */
const BEND: RulingBend = {
  columnOrigin: SHEET_MARGIN,
  columnSpacing: 175,
  columnCount: BEND_COLUMN_COUNT,
  rowOrigin: FIRST_LINE_PHASE,
  rowSpacing: 1000,
  rowCount: 2,
  offsets: [...buildBendRow(1), ...buildBendRow(0.6)],
};

/**
 * Строки узлов изгиба лежат в координате вдоль линий наклонной разлиновки;
 * перспективы у листа теста нет.
 */
const BEND_PROJECTION = { skewAngle: SKEW_ANGLE, perspective: null };

const BENT_SHEET: PaperSheet = {
  id: 'bent',
  label: 'Изогнутый лист',
  src: '/paper/bent.jpg',
  width: SHEET_WIDTH,
  height: SHEET_HEIGHT,
  ruling: {
    step: RULING_STEP,
    firstLinePhase: FIRST_LINE_PHASE,
    skewAngle: SKEW_ANGLE,
    margins: {
      top: SHEET_MARGIN,
      right: SHEET_MARGIN,
      bottom: SHEET_MARGIN,
      left: SHEET_MARGIN,
    },
    marginLineX: null,
    marginLineSide: null,
    sideSlant: null,
    bend: BEND,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  lighting: null,
  texture: null,
};

/**
 * Тот же лист без изгиба: геометрия блока та же, отличается только изгиб.
 */
const FLAT_SHEET: PaperSheet = {
  ...BENT_SHEET,
  id: 'flat',
  ruling: { ...BENT_SHEET.ruling, bend: null },
};

const FAMILY: PaperFamily = {
  id: 'lined',
  label: 'В линейку',
  kind: 'lined',
  sheets: [BENT_SHEET, FLAT_SHEET],
};

/**
 * Синтетическая буква: низ тела лежит ровно на базовой линии по всей ширине,
 * поэтому «низ тела в столбце» считается без поправок на рисунок шрифта.
 */
const UNITS_PER_EM = 1000;
const LETTER_ADVANCE = 500;
const LETTER_HEIGHT = 450;
const BOTTOM_SEGMENTS = 12;

/**
 * Контур буквы: низ — отрезки по базовой линии, верх — прямоугольная крышка.
 *
 * @returns команды контура в единицах шрифта
 */
const buildLetterCommands = (): GlyphPathCommand[] => {
  const segment = LETTER_ADVANCE / BOTTOM_SEGMENTS;
  const commands: GlyphPathCommand[] = [{ type: 'M', x: 0, y: 0 }];

  for (let index = 1; index <= BOTTOM_SEGMENTS; index += 1) {
    commands.push({ type: 'L', x: index * segment, y: 0 });
  }

  commands.push(
    { type: 'L', x: LETTER_ADVANCE, y: LETTER_HEIGHT },
    { type: 'L', x: 0, y: LETTER_HEIGHT },
    { type: 'Z' }
  );

  return commands;
};

const LETTER: GlyphOutline = {
  char: 'м',
  commands: buildLetterCommands(),
  advanceWidth: LETTER_ADVANCE,
};

const SPACE: GlyphOutline = { char: ' ', commands: [], advanceWidth: LETTER_ADVANCE / 2 };

/**
 * Буква, которой в шрифте нет: рисуется текстом даже при разобранных контурах.
 */
const MISSING_CHAR = 'ж';

const GLYPH_SOURCE: GlyphSource = {
  unitsPerEm: UNITS_PER_EM,
  getGlyph: (char) => {
    switch (char) {
      case ' ': {
        return SPACE;
      }

      case MISSING_CHAR: {
        return null;
      }

      default: {
        return LETTER;
      }
    }
  },
  getKerning: () => {
    return 0;
  },
};

const GLYPHS: PageGlyphs = { source: GLYPH_SOURCE, hasVariance: false };

/**
 * Строка из слов разной длины во всю ширину блока: при ширине символа
 * записывателя она проходит и подъём, и спуск линии.
 */
const WORDS_LINE = Array.from({ length: 20 }, (_, index) => {
  return 'м'.repeat(3 + (index % 5));
}).join(' ');

/**
 * Длинное слово контурами тянется через подъём и спуск линии.
 */
const LONG_WORD = 'м'.repeat(40);

/**
 * Строка контурами, в которой часть букв нарисована текстом.
 */
const MIXED_LINE = Array.from({ length: 8 }, (_, index) => {
  return `мм${MISSING_CHAR.repeat(1 + (index % 2))}м`;
}).join(' ');

/**
 * Столбцы, по которым ищется низ тела букв: ширина столбца и полуширина
 * полосы, в которую должна попасть точка контура.
 */
const COLUMN_WIDTH = 6;
const COLUMN_BAND = 2;

/**
 * Столбцов на строке заведомо больше: если их мало, контуры не дошли до
 * записи, и проверка прошла бы на пустом месте.
 */
const MIN_COLUMNS = 100;

/**
 * Поправка верхнего отступа в долях шага и допуск, с которым сдвиг держится
 * одинаковым по всем столбцам строки: он заметно меньше перепада изгиба, и
 * потерянный на сдвинутой строке изгиб вывел бы разброс за него.
 */
const TOP_OFFSET_STEPS = 0.25;
const SHIFT_TOLERANCE_STEPS = 0.02;

/**
 * Параметры отрисовки первой страницы листа с одной строкой — через тот же
 * адаптер, которым их собирает приложение.
 *
 * @param sheet — лист страницы
 * @param text — текст строки
 * @param patch — поля входа адаптера, заменяющие значения по умолчанию
 * @returns параметры отрисовки
 */
const buildParams = (
  sheet: PaperSheet,
  text: string,
  patch: Partial<PageRenderInput> = {}
): PageRenderParams => {
  const page: Page = { lines: [{ text, paragraphIndex: 0 }] };

  return buildPageRenderParams({
    page,
    calibration: getPageCalibration(FAMILY, sheet, 0),
    sheetImage: null,
    metrics: FALLBACK_FONT_METRICS,
    correction: DEFAULT_GEOMETRY_CORRECTION,
    inkColor: '#101010',
    fontFamily: 'Synthetic',
    flags: NO_DISTORTION_FLAGS,
    wordFrequency: 1,
    letterFrequency: 1,
    seed: 42,
    ink: { lighting: null, texture: null, seed: 7 },
    glyphs: GLYPHS,
    scale: SCALE,
    ...patch,
  });
};

/**
 * Накладывает на страницу неровность почерка: поворот и сдвиг строки,
 * поворот, скос, сдвиг и побуквенные интервалы слова.
 *
 * @param params — параметры отрисовки
 * @returns те же параметры с искажёнными строками и словами
 */
const distortPage = (params: PageRenderParams): PageRenderParams => {
  return {
    ...params,
    page: {
      lines: params.page.lines.map(({ words }) => {
        return {
          distortion: { rotate: 1.5, translateX: 6 },
          words: words.map((word) => {
            return {
              ...word,
              distortion: {
                rotate: -2,
                skew: 8,
                translateY: 2,
                letters: [{ index: 1, letterSpacing: 3, fontFamily: null }],
              },
            };
          }),
        };
      }),
    },
  };
};

/**
 * Буква, нарисованная текстом.
 */
type DrawnLetter = {
  /**
   * Что нарисовали.
   */
  text: string;

  /**
   * Точка буквы на базовой линии в пикселях страницы.
   */
  point: GlyphPoint;

  /**
   * Поворот, применённый после последнего `save`; `null` — буква не
   * поворачивалась.
   */
  angle: number | null;
};

/**
 * Отрисовывает страницу и отдаёт буквы, нарисованные текстом, вместе с
 * поворотом, под которым каждая из них легла.
 *
 * @param params — параметры отрисовки
 * @returns буквы в порядке отрисовки
 */
const renderLetters = (params: PageRenderParams): DrawnLetter[] => {
  const recorder = createPathRecorder();
  const letters: DrawnLetter[] = [];
  let angle: number | null = null;

  const context: RenderContext = {
    ...recorder.context,
    save: () => {
      angle = null;
      recorder.context.save();
    },
    rotate: (radians) => {
      angle = radians;
      recorder.context.rotate(radians);
    },
    fillText: (text, x, y) => {
      recorder.context.fillText(text, x, y);

      const drawn = recorder.texts.at(-1);

      if (drawn) {
        letters.push({ text, point: { x: drawn.x / SCALE, y: drawn.y / SCALE }, angle });
      }
    },
  };

  renderPageToCanvas(context, params);

  return letters;
};

/**
 * Отрисовывает страницу и отдаёт точки залитых контуров в пикселях страницы.
 *
 * @param params — параметры отрисовки
 * @returns точки контуров в порядке записи
 */
const renderPoints = (params: PageRenderParams): GlyphPoint[] => {
  const recorder = createPathRecorder();

  renderPageToCanvas(recorder.context, params);

  return recorder.polylines.flatMap((polyline) => {
    return polyline.map(({ x, y }) => {
      return { x: x / SCALE, y: y / SCALE };
    });
  });
};

/**
 * Самая нижняя точка контуров в каждом столбце строки — низ тела букв.
 *
 * @param points — точки контуров одной строки
 * @returns нижние точки по номеру столбца
 */
const measureColumnBottoms = (points: GlyphPoint[]): Map<number, GlyphPoint> => {
  return points.reduce((bottoms, point) => {
    const column = Math.round(point.x / COLUMN_WIDTH);
    const current = bottoms.get(column);

    if (Math.abs(point.x - column * COLUMN_WIDTH) <= COLUMN_BAND) {
      if (!current || point.y > current.y) {
        bottoms.set(column, point);
      }
    }

    return bottoms;
  }, new Map<number, GlyphPoint>());
};

/**
 * Насколько точка отходит от ближайшей линии фотографии листа с изгибом, в
 * долях шага. Линия — прямая наклонная гребёнка плюс изгиб в её точке.
 *
 * @param ruling — разлиновка фотографии
 * @param point — точка страницы
 * @returns отклонение в долях шага
 */
const measureLineDrift = (ruling: SheetRuling, { x, y }: GlyphPoint): number => {
  const { step, firstLinePhase, skewAngle, bend } = ruling;
  const tangent = Math.tan(skewAngle / DEGREES_IN_RADIAN);
  const lineIndex = Math.round((y - firstLinePhase - x * tangent) / step);
  const straightY = firstLinePhase + lineIndex * step + x * tangent;
  const lineY = straightY + (bend ? sampleRulingBend(bend, ruling, x, straightY) : 0);

  return Math.abs(y - lineY) / step;
};

/**
 * Угол касательной к изгибу в середине буквы, по конечной разности вдоль
 * прямой линии разлиновки. Середина ищется от точки буквы на базовой линии по
 * направлению, под которым буква легла; изгиб в ней вычитается, чтобы
 * выбирать там же, где рендерер, — до сдвига.
 *
 * @param letter — нарисованная буква
 * @returns угол касательной в радианах
 */
const measureTangentAngle = ({ point, angle }: DrawnLetter): number => {
  const direction = SKEW_ANGLE / DEGREES_IN_RADIAN + (angle || 0);
  const half = RECORDER_CHAR_WIDTH / 2;
  const centerX = point.x + half * Math.cos(direction);
  const shiftedY = point.y + half * Math.sin(direction);
  const centerY = shiftedY - sampleRulingBend(BEND, BEND_PROJECTION, centerX, shiftedY);
  const rise = TANGENT_STEP * Math.tan(SKEW_ANGLE / DEGREES_IN_RADIAN);
  const ahead = sampleRulingBend(
    BEND,
    BEND_PROJECTION,
    centerX + TANGENT_STEP,
    centerY + rise
  );
  const behind = sampleRulingBend(
    BEND,
    BEND_PROJECTION,
    centerX - TANGENT_STEP,
    centerY - rise
  );

  return Math.atan((ahead - behind) / (2 * TANGENT_STEP));
};

/**
 * Наибольшие величины по буквам строки.
 */
type LetterSummary = {
  /**
   * Отход точки буквы от изогнутой линии в долях шага.
   */
  drift: number;

  /**
   * Изгиб под буквой в долях шага.
   */
  bend: number;

  /**
   * Модуль угла касательной в радианах.
   */
  tangent: number;

  /**
   * Расхождение поворота буквы с касательной в радианах; бесконечность — буква
   * не поворачивалась.
   */
  angleError: number;
};

/**
 * Сводка по буквам, нарисованным текстом на изогнутом листе.
 *
 * @param letters — нарисованные буквы
 * @returns наибольшие величины по буквам
 */
const summarizeLetters = (letters: DrawnLetter[]): LetterSummary => {
  return letters.reduce(
    (acc, letter) => {
      const { x, y } = letter.point;
      const tangent = measureTangentAngle(letter);

      return {
        drift: Math.max(acc.drift, measureLineDrift(BENT_SHEET.ruling, letter.point)),
        bend: Math.max(
          acc.bend,
          Math.abs(sampleRulingBend(BEND, BEND_PROJECTION, x, y)) / RULING_STEP
        ),
        tangent: Math.max(acc.tangent, Math.abs(tangent)),
        angleError:
          letter.angle === null
            ? Infinity
            : Math.max(acc.angleError, Math.abs(letter.angle - tangent)),
      };
    },
    { drift: 0, bend: 0, tangent: 0, angleError: 0 }
  );
};

/**
 * Столбец строки, сдвинутой поправкой.
 */
type ColumnShift = {
  /**
   * Сдвиг низа тела букв в долях шага.
   */
  shift: number;

  /**
   * Отход поднятого обратно низа от изогнутой линии в долях шага.
   */
  drift: number;

  /**
   * Изгиб в столбце в долях шага.
   */
  bend: number;
};

/**
 * Непробельные символы строки по порядку.
 *
 * @param text — строка
 * @returns её буквы без пробелов
 */
const toLetters = (text: string): string[] => {
  return [...text.replaceAll(' ', '')];
};

describe('буквы без контура на изогнутом листе', () => {
  it('рисует каждую букву отдельно на изогнутой линии и по её касательной', () => {
    const letters = renderLetters(buildParams(BENT_SHEET, WORDS_LINE, { glyphs: null }));
    const summary = summarizeLetters(letters);

    expect(
      letters.map(({ text }) => {
        return text;
      })
    ).toEqual(toLetters(WORDS_LINE));
    expect(summary.bend).toBeGreaterThanOrEqual(MIN_BEND_STEPS);
    expect(summary.tangent).toBeGreaterThanOrEqual(MIN_TANGENT);
    expect(summary.drift).toBeLessThanOrEqual(TOLERANCE_STEPS);
    expect(summary.angleError).toBeLessThanOrEqual(ANGLE_TOLERANCE);
  });

  it('кладёт на изогнутую линию буквы, которых нет среди контуров шрифта', () => {
    const letters = renderLetters(buildParams(BENT_SHEET, MIXED_LINE));
    const summary = summarizeLetters(letters);

    expect(
      letters.map(({ text }) => {
        return text;
      })
    ).toEqual(
      toLetters(MIXED_LINE).filter((char) => {
        return char === MISSING_CHAR;
      })
    );
    expect(summary.bend).toBeGreaterThanOrEqual(MIN_BEND_STEPS);
    expect(summary.tangent).toBeGreaterThanOrEqual(MIN_TANGENT);
    expect(summary.drift).toBeLessThanOrEqual(TOLERANCE_STEPS);
    expect(summary.angleError).toBeLessThanOrEqual(ANGLE_TOLERANCE);
  });

  it('на ровном листе рисует слово целиком одним вызовом и не поворачивает его', () => {
    const letters = renderLetters(buildParams(FLAT_SHEET, WORDS_LINE, { glyphs: null }));

    expect(
      letters.map(({ text }) => {
        return text;
      })
    ).toEqual(WORDS_LINE.split(' '));
    expect(
      letters.every(({ angle }) => {
        return angle === null;
      })
    ).toBe(true);
  });
});

describe('детерминизм на изогнутом листе', () => {
  it.each([
    ['контуры с вариативностью', { ...GLYPHS, hasVariance: true }],
    ['буквы текстом', null],
  ])('два прогона с одними параметрами дают одну ленту вызовов: %s', (_, glyphs) => {
    const first = createDrawRecorder();
    const second = createDrawRecorder();

    renderPageToCanvas(
      first.context,
      distortPage(buildParams(BENT_SHEET, WORDS_LINE, { glyphs }))
    );
    renderPageToCanvas(
      second.context,
      distortPage(buildParams(BENT_SHEET, WORDS_LINE, { glyphs }))
    );

    expect(second.calls).toEqual(first.calls);

    /**
     * Лента не пустая: совпадение двух пустых лент ничего не доказывает.
     */
    expect(findCalls(first.calls, glyphs ? 'moveTo' : 'fillText').length).toBeGreaterThan(
      0
    );
  });
});

describe('поправка геометрии на изогнутом листе', () => {
  it('сдвигает низ букв на долю шага и сохраняет изгиб строки по столбцам', () => {
    const base = measureColumnBottoms(renderPoints(buildParams(BENT_SHEET, LONG_WORD)));
    const moved = measureColumnBottoms(
      renderPoints(
        buildParams(BENT_SHEET, LONG_WORD, {
          correction: { ...DEFAULT_GEOMETRY_CORRECTION, topOffset: TOP_OFFSET_STEPS },
        })
      )
    );
    const report = [...base].reduce<ColumnShift[]>((acc, [column, point]) => {
      const shifted = moved.get(column);

      if (shifted) {
        const lifted = { x: shifted.x, y: shifted.y - TOP_OFFSET_STEPS * RULING_STEP };

        acc.push({
          shift: (shifted.y - point.y) / RULING_STEP,
          drift: measureLineDrift(BENT_SHEET.ruling, lifted),
          bend:
            Math.abs(sampleRulingBend(BEND, BEND_PROJECTION, lifted.x, lifted.y)) /
            RULING_STEP,
        });
      }

      return acc;
    }, []);

    const pick = (key: keyof ColumnShift): number[] => {
      return report.map((entry) => {
        return entry[key];
      });
    };

    expect(report.length).toBeGreaterThan(MIN_COLUMNS);
    expect(Math.max(...pick('bend'))).toBeGreaterThanOrEqual(MIN_BEND_STEPS);
    expect(Math.min(...pick('shift'))).toBeGreaterThanOrEqual(
      TOP_OFFSET_STEPS - SHIFT_TOLERANCE_STEPS
    );
    expect(Math.max(...pick('shift'))).toBeLessThanOrEqual(
      TOP_OFFSET_STEPS + SHIFT_TOLERANCE_STEPS
    );
    expect(Math.max(...pick('drift'))).toBeLessThanOrEqual(TOLERANCE_STEPS);
  });
});
