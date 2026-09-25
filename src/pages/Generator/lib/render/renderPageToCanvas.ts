import type { LineBounds } from '../calibrate/calibrate.types';
import { deformGlyphPath } from '../glyph/deformGlyphPath';
import type { GlyphPathCommand, GlyphPoint } from '../glyph/glyph.types';
import { FALLBACK_FONT_METRICS } from '../measure/measureFontMetrics';
import type { RulingBend, RulingProjection } from '../paper/paper.types';
import { lineHeightAt, lineHeightSlopeAt } from '../paper/rulingPerspective';
import { sampleRulingBend, sampleRulingBendSlope } from '../paper/sampleRulingBend';
import type { LetterDistortion } from '../randomize/randomize.types';

import type {
  LineStart,
  PageGlyphs,
  PageRenderParams,
  RenderContext,
  RenderFontMetrics,
  RenderLine,
  RenderWord,
} from './render.types';

/**
 * Сколько градусов в радиане: css-трансформации задаются в градусах, canvas
 * принимает радианы.
 */
const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Шаг seed между соседними буквами слова: у каждого вхождения буквы свой
 * контур. Взаимно простое с шагом слов число, чтобы seed букв соседних слов не
 * совпадали позиция в позицию.
 */
const LETTER_SEED_STEP = 7919;

/**
 * Какие слои страницы рисует проход. Проходы разделены, потому что чернила
 * модулируются шейдером и им нужен свой прозрачный слой, а фон обязан остаться
 * под ним нетронутым.
 */
type PageLayers = {
  /**
   * Рисуется ли фотография листа.
   */
  hasBackground: boolean;

  /**
   * Рисуются ли чернила.
   */
  hasInk: boolean;
};

const ALL_LAYERS: PageLayers = { hasBackground: true, hasInk: true };
const BACKGROUND_LAYER: PageLayers = { hasBackground: true, hasInk: false };
const INK_LAYER: PageLayers = { hasBackground: false, hasInk: true };

/**
 * Переводит градусы css-трансформаций в радианы canvas.
 */
const toRadians = (degrees: number): number => {
  return degrees / DEGREES_IN_RADIAN;
};

/**
 * Аффинное преобразование в форме аргументов `transform` канвы:
 * `x′ = a·x + c·y + e`, `y′ = b·x + d·y + f`.
 */
type AffineMatrix = {
  /**
   * Горизонтальный масштаб.
   */
  a: number;

  /**
   * Вертикальный скос.
   */
  b: number;

  /**
   * Горизонтальный скос.
   */
  c: number;

  /**
   * Вертикальный масштаб.
   */
  d: number;

  /**
   * Сдвиг по горизонтали.
   */
  e: number;

  /**
   * Сдвиг по вертикали.
   */
  f: number;
};

const IDENTITY_MATRIX: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Произведение преобразований: сначала применяется правое, потом левое — в том
 * порядке, в каком их накапливает канва.
 */
const multiplyMatrices = (left: AffineMatrix, right: AffineMatrix): AffineMatrix => {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
};

/**
 * Линии разлиновки страницы вместе с преобразованием, которое канва применила
 * бы к точке, — без масштаба отрисовки: линии заданы в пикселях страницы.
 */
type LineTracker = {
  /**
   * Изгиб линий разлиновки страницы. `null` — линии не изогнуты, и от прямой
   * гребёнки их уводит одна перспектива.
   */
  bend: RulingBend | null;

  /**
   * Наклон и перспектива разлиновки: ими координата вдоль линий переводится в
   * высоту линии на фотографии, в них же лежат строки узлов изгиба.
   */
  projection: RulingProjection;

  /**
   * Тангенс наклона разлиновки. Раскладка ставит точку на прямую наклонную
   * гребёнку, поэтому координата вдоль линий точки страницы — `y − x·tgθ`.
   */
  tangent: number;

  /**
   * Текущее преобразование из системы рисования в пиксели страницы.
   */
  matrix: AffineMatrix;

  /**
   * Преобразования, запомненные на `save`.
   */
  stack: AffineMatrix[];
};

/**
 * Высота линии фотографии под точкой страницы: `Y(x, U) + d(x, U)`. Раскладка
 * поставила точку на прямую наклонную гребёнку, поэтому её координата вдоль
 * линий — `U = y − x·tgθ`; перспектива переводит `U` в высоту линии на снимке,
 * изгиб опускает линию на своё смещение.
 *
 * Без перспективы высота линии равна самой `y`, и выборка изгиба получает те
 * же числа, что и на листе, у которого перспективы нет вовсе.
 *
 * @param tracker — линии разлиновки и текущее преобразование
 * @param x — горизонталь точки в пикселях страницы
 * @param y — вертикаль точки в пикселях страницы
 * @returns высота линии в пикселях страницы
 */
const lineHeightOf = (tracker: LineTracker, x: number, y: number): number => {
  const { bend, projection, tangent } = tracker;
  const lineY = projection.perspective ? lineHeightAt(projection, x, y - x * tangent) : y;

  return lineY + (bend ? sampleRulingBend(bend, projection, x, lineY) : 0);
};

/**
 * Точка в текущей системе рисования, образ которой на странице опущен на своё
 * место на линии фотографии: `p + L⁻¹·(0, Δ(M·p))`, где `L` — линейная часть
 * `M`, а `Δ = Y + d − y`.
 *
 * Сдвиг переводится обратной линейной частью, а не прибавляется к `y` как
 * есть: поворот и скос строки и слова уже в преобразовании, и тот же сдвиг в
 * системе буквы увёл бы точку на странице вбок. Стык соседних букв — одна и та
 * же точка страницы, поэтому сдвиг у него один и соединение не рвётся.
 *
 * @param tracker — линии разлиновки и текущее преобразование
 * @param x — горизонталь точки в системе рисования
 * @param y — вертикаль точки в системе рисования
 * @returns сдвинутая точка в той же системе
 */
const linePoint = (tracker: LineTracker, x: number, y: number): GlyphPoint => {
  const { a, b, c, d, e, f } = tracker.matrix;
  const determinant = a * d - b * c;

  if (determinant === 0) {
    return { x, y };
  }

  const pageY = b * x + d * y + f;
  const offset = lineHeightOf(tracker, a * x + c * y + e, pageY) - pageY;

  return {
    x: x - (c * offset) / determinant,
    y: y + (a * offset) / determinant,
  };
};

/**
 * Рисует текст жёсткой фигурой на линии фотографии: середина текста на базовой
 * линии встаёт на линию в своём образе на странице, а сам текст
 * поворачивается вокруг неё по касательной к линии.
 *
 * Положить текст на форму линии нечем — точек контура у него нет. Поэтому на
 * неровном листе рендерер рисует так по одной букве: буква шириной в доли шага
 * на касательной отходит от линии много меньше допуска, а целое слово осталось
 * бы прямым.
 *
 * Касательная — `∂(Y + d)/∂x` при постоянной `U`; наклон блока в систему буквы
 * уже вошёл, поэтому из угла касательной он вычитается. Поворот задан в
 * системе буквы, и при скосе слова угол на странице приближённый: скос
 * неровности почерка — единицы градусов, ошибка ничтожна.
 *
 * @param ctx — контекст, в который идут вызовы
 * @param tracker — линии разлиновки и текущее преобразование
 * @param text — текст
 * @param x — начало текста на базовой линии в системе рисования
 * @param y — базовая линия в системе рисования
 */
const fillLineText = (
  ctx: RenderContext,
  tracker: LineTracker,
  text: string,
  x: number,
  y: number
): void => {
  const { bend, projection, tangent, matrix } = tracker;
  const { a, b, c, d, e, f } = matrix;
  const centerX = x + ctx.measureText(text).width / 2;
  const center = linePoint(tracker, centerX, y);
  const pageX = a * centerX + c * y + e;
  const pageY = b * centerX + d * y + f;
  const u = pageY - pageX * tangent;
  const lineY = projection.perspective ? lineHeightAt(projection, pageX, u) : pageY;
  const slope =
    (projection.perspective ? lineHeightSlopeAt(projection, u) : tangent) +
    (bend ? sampleRulingBendSlope(bend, projection, pageX, lineY) : 0);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(Math.atan(slope) - toRadians(projection.skewAngle));
  ctx.translate(-centerX, -y);
  ctx.fillText(text, x, y);
  ctx.restore();
};

/**
 * Контекст, который рисует в `ctx` те же вызовы, но точки путей кладёт на
 * линии разлиновки фотографии, а текст — на линию сдвигом и поворотом.
 *
 * Рядом со стеком канвы ведётся своё преобразование с тем же порядком
 * `rotate`, `translate`, `transform` и своим стеком на `save`/`restore`: снять
 * преобразование с контекста нечем — `getTransform` нет ни у `RenderContext`,
 * ни у записывающих контекстов тестов. Вызовы трансформаций поэтому остаются
 * на месте, меняются только координаты точек, контрольные точки кривых — тем
 * же полем.
 *
 * Преобразование начинается с единичного: контекст создаётся после масштаба
 * отрисовки, и точки меряются в пикселях страницы.
 *
 * @param ctx — контекст, в который идут вызовы
 * @param bend — изгиб линий разлиновки страницы; `null` — линии не изогнуты
 * @param projection — наклон и перспектива разлиновки, в которых заданы линии
 *   и строки узлов изгиба
 * @returns контекст рисования по линиям фотографии
 */
const createLineContext = (
  ctx: RenderContext,
  bend: RulingBend | null,
  projection: RulingProjection
): RenderContext => {
  const tracker: LineTracker = {
    bend,
    projection,
    tangent: Math.tan(toRadians(projection.skewAngle)),
    matrix: IDENTITY_MATRIX,
    stack: [],
  };

  const apply = (next: AffineMatrix): void => {
    tracker.matrix = multiplyMatrices(tracker.matrix, next);
  };

  return {
    get fillStyle(): RenderContext['fillStyle'] {
      return ctx.fillStyle;
    },
    set fillStyle(value: RenderContext['fillStyle']) {
      ctx.fillStyle = value;
    },
    get font(): string {
      return ctx.font;
    },
    set font(value: string) {
      ctx.font = value;
    },
    get textBaseline(): CanvasTextBaseline {
      return ctx.textBaseline;
    },
    set textBaseline(value: CanvasTextBaseline) {
      ctx.textBaseline = value;
    },
    save: () => {
      tracker.stack.push(tracker.matrix);
      ctx.save();
    },
    restore: () => {
      tracker.matrix = tracker.stack.pop() || IDENTITY_MATRIX;
      ctx.restore();
    },
    scale: (x, y) => {
      apply({ ...IDENTITY_MATRIX, a: x, d: y });
      ctx.scale(x, y);
    },
    translate: (x, y) => {
      apply({ ...IDENTITY_MATRIX, e: x, f: y });
      ctx.translate(x, y);
    },
    rotate: (angle) => {
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      apply({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
      ctx.rotate(angle);
    },
    transform: (a, b, c, d, e, f) => {
      apply({ a, b, c, d, e, f });
      ctx.transform(a, b, c, d, e, f);
    },
    drawImage: (image, dx, dy, dWidth, dHeight) => {
      ctx.drawImage(image, dx, dy, dWidth, dHeight);
    },
    measureText: (text) => {
      return ctx.measureText(text);
    },
    fillText: (text, x, y) => {
      fillLineText(ctx, tracker, text, x, y);
    },
    beginPath: () => {
      ctx.beginPath();
    },
    moveTo: (x, y) => {
      const point = linePoint(tracker, x, y);

      ctx.moveTo(point.x, point.y);
    },
    lineTo: (x, y) => {
      const point = linePoint(tracker, x, y);

      ctx.lineTo(point.x, point.y);
    },
    quadraticCurveTo: (cpx, cpy, x, y) => {
      const control = linePoint(tracker, cpx, cpy);
      const end = linePoint(tracker, x, y);

      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    },
    bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) => {
      const first = linePoint(tracker, cp1x, cp1y);
      const second = linePoint(tracker, cp2x, cp2y);
      const end = linePoint(tracker, x, y);

      ctx.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
    },
    closePath: () => {
      ctx.closePath();
    },
    fill: () => {
      ctx.fill();
    },
  };
};

/**
 * Собирает значение css-свойства `font`. Семейство обязательно в кавычках:
 * имя с пробелом — а такое приходит с пользовательским шрифтом — без них
 * делает всё свойство невалидным, и присвоение молча не применяется.
 */
const buildFont = (fontSizePx: number, fontFamily: string): string => {
  return `${fontSizePx}px "${fontFamily}"`;
};

/**
 * Подставляет запасные доли вместо нулей и мусора: метрики могли не сняться,
 * а делить геометрию на ноль дороже, чем ошибиться в пропорции.
 */
const resolveMetrics = (metrics: RenderFontMetrics): RenderFontMetrics => {
  return {
    fontAscent: metrics.fontAscent || FALLBACK_FONT_METRICS.fontAscent,
    lineHeight: metrics.lineHeight || FALLBACK_FONT_METRICS.lineHeight,
  };
};

/**
 * Во сколько раз единицы шрифта меньше пикселей страницы.
 */
const glyphScale = (glyphs: PageGlyphs, fontSizePx: number): number => {
  return fontSizePx / (glyphs.source.unitsPerEm || 1);
};

/**
 * Стили букв слова по их позициям. Буквы, которых в карте нет, рисуются
 * шрифтом страницы без добавки к межбуквенному интервалу.
 */
const buildLetterStyles = (
  letters: LetterDistortion[]
): Map<number, LetterDistortion> => {
  return new Map(
    letters.map((letter) => {
      return [letter.index, letter];
    })
  );
};

/**
 * Ширины букв слова вместе с добавками к межбуквенному интервалу: на столько
 * сдвигается перо после каждой буквы.
 */
const measureLetterAdvances = (
  ctx: RenderContext,
  word: RenderWord,
  fontSizePx: number,
  baseFont: string
): number[] => {
  const { text, distortion } = word;
  const letterStyles = buildLetterStyles(distortion.letters);

  return [...text].map((character, index) => {
    const letter = letterStyles.get(index);
    const letterFont = letter?.fontFamily || null;

    if (letterFont) {
      ctx.font = buildFont(fontSizePx, letterFont);
    }

    const { width } = ctx.measureText(character);

    if (letterFont) {
      ctx.font = baseFont;
    }

    return width + (letter?.letterSpacing || 0);
  });
};

/**
 * Ширины букв слова, когда буквы рисуются контурами: продвижение глифа плюс
 * кернинг с соседом. Буква с подменённым шрифтом и буква, которой в шрифте
 * нет, меряются текстом — контуров для них нет.
 */
const measureGlyphAdvances = (
  ctx: RenderContext,
  word: RenderWord,
  glyphs: PageGlyphs,
  fontSizePx: number,
  baseFont: string
): number[] => {
  const { text, distortion } = word;
  const letterStyles = buildLetterStyles(distortion.letters);
  const { source } = glyphs;
  const scale = glyphScale(glyphs, fontSizePx);
  const characters = [...text];

  return characters.map((character, index) => {
    const letter = letterStyles.get(index);
    const letterFont = letter?.fontFamily || null;
    const letterSpacing = letter?.letterSpacing || 0;
    const glyph = letterFont ? null : source.getGlyph(character);

    if (!glyph) {
      if (letterFont) {
        ctx.font = buildFont(fontSizePx, letterFont);
      }

      const { width } = ctx.measureText(character);

      if (letterFont) {
        ctx.font = baseFont;
      }

      return width + letterSpacing;
    }

    const nextCharacter = characters[index + 1];
    const kerning = nextCharacter ? source.getKerning(character, nextCharacter) : 0;

    return (glyph.advanceWidth + kerning) * scale + letterSpacing;
  });
};

/**
 * Ширины букв слова: по контурам, если они есть, иначе текстом. Пустой список —
 * слово рисуется целиком, и мерить его по буквам незачем. На изогнутом листе
 * слово текстом всегда рисуется по буквам.
 */
const measureAdvances = (
  ctx: RenderContext,
  word: RenderWord,
  glyphs: PageGlyphs | null,
  fontSizePx: number,
  baseFont: string,
  isCurved: boolean
): number[] => {
  if (glyphs) {
    return measureGlyphAdvances(ctx, word, glyphs, fontSizePx, baseFont);
  }

  if (word.distortion.letters.length === 0 && !isCurved) {
    return [];
  }

  return measureLetterAdvances(ctx, word, fontSizePx, baseFont);
};

/**
 * Ширина пробела между словами. Контуры меряют его продвижением глифа: у
 * рукописных шрифтов пробел заметно уже среднего символа, и мерить его текстом,
 * когда всё остальное считается по контурам, значило бы расставить слова по
 * одной ширине, а буквы — по другой.
 */
const measureSpace = (
  ctx: RenderContext,
  glyphs: PageGlyphs | null,
  fontSizePx: number
): number => {
  const spaceGlyph = glyphs?.source.getGlyph(' ');

  if (!glyphs || !spaceGlyph) {
    return ctx.measureText(' ').width;
  }

  return spaceGlyph.advanceWidth * glyphScale(glyphs, fontSizePx);
};

/**
 * Кладёт контур глифа в путь и заливает его.
 *
 * Координаты переводятся в пиксели страницы прямо здесь, без собственного
 * преобразования контекста: ось `y` в шрифте смотрит вверх, а в канве вниз, и
 * отдельный переворот системы координат вывернул бы вместе с глифом и
 * трансформации слова.
 *
 * @param ctx — контекст рисования
 * @param commands — команды пути в единицах шрифта
 * @param x — левый край глифа в пикселях страницы
 * @param scale — сколько пикселей страницы в единице шрифта
 */
const fillGlyphPath = (
  ctx: RenderContext,
  commands: readonly GlyphPathCommand[],
  x: number,
  scale: number
): void => {
  ctx.beginPath();

  for (const command of commands) {
    switch (command.type) {
      case 'M': {
        ctx.moveTo(x + command.x * scale, -command.y * scale);
        break;
      }

      case 'L': {
        ctx.lineTo(x + command.x * scale, -command.y * scale);
        break;
      }

      case 'Q': {
        ctx.quadraticCurveTo(
          x + command.x1 * scale,
          -command.y1 * scale,
          x + command.x * scale,
          -command.y * scale
        );
        break;
      }

      case 'C': {
        ctx.bezierCurveTo(
          x + command.x1 * scale,
          -command.y1 * scale,
          x + command.x2 * scale,
          -command.y2 * scale,
          x + command.x * scale,
          -command.y * scale
        );
        break;
      }

      case 'Z': {
        ctx.closePath();
        break;
      }

      default: {
        throw new Error(`Неизвестная команда контура: ${JSON.stringify(command)}`);
      }
    }
  }

  ctx.fill();
};

/**
 * Рисует слово контурами шрифта: каждая буква — свой путь.
 *
 * Вариативность отключается целиком, а не сводится к нулевой амплитуде: при
 * выключенном флаге деформация не вызывается, и в путь идут исходные контуры
 * шрифта.
 */
const drawWordGlyphs = (
  ctx: RenderContext,
  word: RenderWord,
  x: number,
  advances: number[],
  glyphs: PageGlyphs,
  fontSizePx: number,
  baseFont: string
): void => {
  const { text, distortion, seed } = word;
  const letterStyles = buildLetterStyles(distortion.letters);
  const { source, hasVariance } = glyphs;
  const scale = glyphScale(glyphs, fontSizePx);
  let cursorX = x;

  [...text].forEach((character, index) => {
    const letterFont = letterStyles.get(index)?.fontFamily || null;
    const glyph = letterFont ? null : source.getGlyph(character);

    if (glyph) {
      const commands = hasVariance
        ? deformGlyphPath(glyph.commands, {
            unitsPerEm: source.unitsPerEm,
            advanceWidth: glyph.advanceWidth,
            seed: seed + index * LETTER_SEED_STEP,
          })
        : glyph.commands;

      fillGlyphPath(ctx, commands, cursorX, scale);
    } else {
      if (letterFont) {
        ctx.font = buildFont(fontSizePx, letterFont);
      }

      ctx.fillText(character, cursorX, 0);

      if (letterFont) {
        ctx.font = baseFont;
      }
    }

    cursorX += advances[index] || 0;
  });
};

/**
 * Рисует слово буквами шрифта: целиком, если ни одна буква не выбивается, и
 * по одной, если у букв свои интервалы или своё начертание.
 *
 * На изогнутом листе слово рисуется по буквам всегда: каждая садится на линию
 * в своей середине, а целое слово осталось бы прямым и на длинной строке
 * отошло бы от линии дальше допуска.
 */
const drawWordText = (
  ctx: RenderContext,
  word: RenderWord,
  x: number,
  advances: number[],
  fontSizePx: number,
  baseFont: string,
  isCurved: boolean
): void => {
  const { text, distortion } = word;
  const { letters } = distortion;

  if (letters.length === 0 && !isCurved) {
    ctx.fillText(text, x, 0);

    return;
  }

  const letterStyles = buildLetterStyles(letters);
  let cursorX = x;

  [...text].forEach((character, index) => {
    const letterFont = letterStyles.get(index)?.fontFamily || null;

    if (letterFont) {
      ctx.font = buildFont(fontSizePx, letterFont);
    }

    ctx.fillText(character, cursorX, 0);

    if (letterFont) {
      ctx.font = baseFont;
    }

    cursorX += advances[index] || 0;
  });
};

/**
 * Рисует слово от точки `x` на базовой линии текущей строки и возвращает его
 * ширину — от неё отсчитывается следующее слово.
 *
 * Поворот и скос применяются вокруг горизонтального центра слова на базовой
 * линии; порядок трансформаций тот же, что в css-строке
 * `rotate() skew() translateY()`.
 *
 * Слово, начинающееся за правой границей блока, не рисуется: раскладка
 * считается тем же `blockWidth`, поэтому такое слово означает рассинхрон, и
 * выпустить его за край листа хуже, чем не показать.
 */
const drawWord = (
  ctx: RenderContext,
  word: RenderWord,
  x: number,
  glyphs: PageGlyphs | null,
  fontSizePx: number,
  baseFont: string,
  blockWidth: number,
  isCurved: boolean
): number => {
  const { text, distortion } = word;
  const { rotate, skew, translateY, letters } = distortion;

  if (text.length === 0) {
    return 0;
  }

  const isMeasuredByLetter = Boolean(glyphs) || letters.length > 0 || isCurved;
  const advances = measureAdvances(ctx, word, glyphs, fontSizePx, baseFont, isCurved);
  const width = isMeasuredByLetter
    ? advances.reduce((sum, advance) => {
        return sum + advance;
      }, 0)
    : ctx.measureText(text).width;

  if (blockWidth > 0 && x >= blockWidth) {
    return width;
  }

  const originX = x + width / 2;

  ctx.save();
  ctx.translate(originX, 0);

  if (rotate !== 0) {
    ctx.rotate(toRadians(rotate));
  }

  if (skew !== 0) {
    ctx.transform(1, 0, Math.tan(toRadians(skew)), 1, 0, 0);
  }

  if (translateY !== 0) {
    ctx.translate(0, translateY);
  }

  ctx.translate(-originX, 0);

  if (glyphs) {
    drawWordGlyphs(ctx, word, x, advances, glyphs, fontSizePx, baseFont);
  } else {
    drawWordText(ctx, word, x, advances, fontSizePx, baseFont, isCurved);
  }

  ctx.restore();

  return width;
};

/**
 * Рисует строку: базовая линия уже посчитана, слова кладутся слева направо
 * через пробел от начала строки.
 *
 * Поворот и сдвиг строки применяются вокруг середины блока: строка занимает
 * всю его ширину, и от точки поворота зависит, качается она или разъезжается
 * веером.
 */
const drawLine = (
  ctx: RenderContext,
  line: RenderLine,
  startX: number,
  baselineY: number,
  spaceWidth: number,
  glyphs: PageGlyphs | null,
  fontSizePx: number,
  baseFont: string,
  blockWidth: number,
  isCurved: boolean
): void => {
  const { words, distortion } = line;
  const { rotate, translateX } = distortion;

  if (words.length === 0) {
    return;
  }

  const originX = blockWidth / 2;

  ctx.save();
  ctx.translate(startX, baselineY);
  ctx.translate(originX, 0);

  if (rotate !== 0) {
    ctx.rotate(toRadians(rotate));
  }

  if (translateX !== 0) {
    ctx.translate(translateX, 0);
  }

  ctx.translate(-originX, 0);

  let cursorX = 0;

  words.forEach((word, index) => {
    if (index > 0) {
      cursorX += spaceWidth;
    }

    cursorX += drawWord(
      ctx,
      word,
      cursorX,
      glyphs,
      fontSizePx,
      baseFont,
      blockWidth,
      isCurved
    );
  });

  ctx.restore();
};

/**
 * Начало и ширина строки блока. Без краёв строк у всех строк начало блока и
 * его ширина; строкам дальше массива краёв — края последней: так раскладка
 * набирает их той же шириной.
 *
 * @param lineBounds — края строк; не заданы — строки по блоку
 * @param index — номер строки на странице
 * @param blockWidth — ширина блока
 * @returns сдвиг начала строки от левого края блока и её ширина
 */
const resolveLineBounds = (
  lineBounds: LineBounds | undefined,
  index: number,
  blockWidth: number
): LineStart => {
  if (!lineBounds || lineBounds.widths.length === 0) {
    return { startX: 0, width: blockWidth };
  }

  const position = Math.min(index, lineBounds.widths.length - 1);

  return {
    startX: lineBounds.offsets[position] || 0,
    width: lineBounds.widths[position] || 0,
  };
};

/**
 * Рисует перечисленные слои страницы в контекст.
 *
 * Чернила листа с изгибом или перспективой рисуются через контекст линий,
 * созданный после масштаба отрисовки: его преобразование ведётся в пикселях
 * страницы. Лист без того и другого рисуется прямо в `ctx`, и линии не
 * выбираются вовсе — лента вызовов у него та же, что и до появления изгиба.
 */
const drawPage = (
  ctx: RenderContext,
  params: PageRenderParams,
  layers: PageLayers
): void => {
  const { page, background, inkColor, glyphs, fontFamily, geometry, scale } = params;
  const {
    fontSizePx,
    lineSpacing,
    topOffset,
    leftPadding,
    blockWidth,
    lineBounds,
    blockRotate,
    fontMetrics,
    bend,
    perspective,
  } = geometry;
  const { fontAscent, lineHeight } = resolveMetrics(fontMetrics);
  const baseFont = buildFont(fontSizePx, fontFamily);
  const isCurved = perspective !== null || bend !== null;

  ctx.save();
  ctx.scale(scale, scale);

  if (layers.hasBackground && background) {
    ctx.drawImage(background.image, 0, 0, background.width, background.height);
  }

  if (layers.hasInk) {
    ctx.save();

    const inkContext = isCurved
      ? createLineContext(ctx, bend, { skewAngle: blockRotate, perspective })
      : ctx;

    /**
     * Высоты модели строчного бокса отсчитаны в координате вдоль линий
     * `U = y − x·tg θ`, а в системе блока, повёрнутой на θ, высота `v` лежит на
     * `U = v / cos θ`. Поэтому высоты строк переводятся в систему блока
     * множителем cos θ, а кегль и длины вдоль строки — нет: сжатие самих букв
     * исказило бы почерк. Без множителя строка n уходила бы с линии на
     * `(1/cos θ − 1)·U`: на листе с наклоном в три градуса — на пять пикселей к
     * низу кадра. Без наклона множитель — ровно единица, и числа не меняются.
     */
    const lineScale = Math.cos(toRadians(blockRotate));

    if (blockRotate !== 0) {
      inkContext.rotate(toRadians(blockRotate));
    }

    inkContext.translate(leftPadding, topOffset * lineScale);

    inkContext.fillStyle = inkColor;
    inkContext.textBaseline = 'alphabetic';
    inkContext.font = baseFont;

    const spaceWidth = measureSpace(inkContext, glyphs, fontSizePx);
    const lineStep = (fontSizePx * lineHeight + lineSpacing) * lineScale;
    const firstBaselineY = fontAscent * fontSizePx * lineScale;

    page.lines.forEach((line, index) => {
      const bounds = resolveLineBounds(lineBounds, index, blockWidth);

      drawLine(
        inkContext,
        line,
        bounds.startX,
        firstBaselineY + index * lineStep,
        spaceWidth,
        glyphs,
        fontSizePx,
        baseFont,
        bounds.width,
        isCurved
      );
    });

    ctx.restore();
  }

  ctx.restore();
};

/**
 * Рисует страницу в контекст: сначала фотография листа, поверх неё — чернила.
 * Ничего не очищает и ничего не измеряет в DOM: вход полностью описывает
 * результат, поэтому два вызова с одними параметрами дают одну и ту же
 * картинку.
 *
 * Шаг строк и базовые линии считаются по метрикам шрифта теми же формулами,
 * которыми `lib/calibrate` выводит геометрию из разлиновки: базовая линия
 * лежит на подъёме строчного бокса от верха строки, а межстрочная добавка —
 * внешний отступ строки и внутрь бокса не идёт. Разойдись формулы — базовые
 * линии не сядут на линии листа.
 *
 * Разрешение задаётся одним параметром `scale`: предпросмотр и экспорт идут
 * этим же путём и отличаются только им.
 *
 * @param ctx — контекст рисования; состояние восстанавливается к исходному
 * @param params — что рисовать, чем и в каком разрешении
 */
export const renderPageToCanvas = (
  ctx: RenderContext,
  params: PageRenderParams
): void => {
  drawPage(ctx, params, ALL_LAYERS);
};

/**
 * Рисует только фотографию листа: чернила лягут отдельным слоем и вернутся
 * сюда уже промодулированными.
 *
 * @param ctx — контекст страницы
 * @param params — параметры отрисовки
 */
export const drawPageBackground = (
  ctx: RenderContext,
  params: PageRenderParams
): void => {
  drawPage(ctx, params, BACKGROUND_LAYER);
};

/**
 * Рисует только чернила. Контекст обычно принадлежит прозрачному слою: шейдеру
 * нужны чернила без листа под ними, иначе он промодулирует и фотографию,
 * которая уже несёт своё освещение.
 *
 * @param ctx — контекст слоя чернил
 * @param params — параметры отрисовки
 */
export const drawPageInk = (ctx: RenderContext, params: PageRenderParams): void => {
  drawPage(ctx, params, INK_LAYER);
};
