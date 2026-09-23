import { DEFAULT_GEOMETRY_CORRECTION } from '@pages/Generator/config';
import { deriveGeometry } from '@pages/Generator/lib/calibrate/deriveGeometry';
import { PAGE_IMAGE_MIME } from '@pages/Generator/lib/export';
import { FALLBACK_FONT_METRICS } from '@pages/Generator/lib/measure/measureFontMetrics';
import type { Page } from '@pages/Generator/lib/paginate/paginate.types';
import type { PaperFamily, PaperSheet } from '@pages/Generator/lib/paper';
import { mirrorSheetRuling } from '@pages/Generator/lib/paper';
import type { PageRenderParams, RenderImage } from '@pages/Generator/lib/render';
import { renderPageToCanvas } from '@pages/Generator/lib/render';
import {
  buildPageRenderParams,
  isMirroredPage,
} from '@pages/Generator/model/buildPageRenderParams';
import { getPageCalibration } from '@pages/Generator/model/geometrySelectors';
import { mirrorRenderImage } from '@pages/Generator/model/mirrorRenderImage';
import type { PageRenderInput } from '@pages/Generator/model/pageRender.types';
import { renderPageImage } from '@pages/Generator/model/renderPageImage';
import { describe, expect, it } from 'vitest';

import {
  createDrawRecorder,
  createSurfaceRecorder,
  findCalls,
} from './helpers/canvas-recorder';
import { NO_DISTORTION_FLAGS } from './helpers/distortion-flags';

/**
 * Лист-модель: линия поля стоит на известном месте, поля и кадр подобраны так,
 * чтобы геометрия считалась в уме.
 */
const MARGIN_LINE_X = 25;
const RULING_STEP = 40;
const SHEET_WIDTH = 400;
const SHEET_HEIGHT = 800;
const RIGHT_MARGIN = 100;

/**
 * Зазор между линией поля и началом текста — пятая часть шага разлиновки; та же
 * доля, что и в автокалибровке.
 */
const MARGIN_LINE_GAP = RULING_STEP * 0.2;

/**
 * Наклон экземпляра: ни на что другое в геометрии он не похож, поэтому по нему
 * сразу видно, дошёл ли угол до отрисовки.
 */
const SKEW_ANGLE = 1.7;

/**
 * Допуск попадания базовой линии на линию фотографии — десятая доля шага, как в
 * требовании к зеркальной странице.
 */
const BASELINE_TOLERANCE = 0.1;

const DEGREES_IN_RADIAN = 180 / Math.PI;

const SHEET: PaperSheet = {
  id: 'sheet-1',
  label: 'Лист 1',
  src: '/paper/sheet-1.jpg',
  width: SHEET_WIDTH,
  height: SHEET_HEIGHT,
  ruling: {
    step: RULING_STEP,
    firstLinePhase: 100,
    skewAngle: SKEW_ANGLE,
    margins: { top: 100, right: RIGHT_MARGIN, bottom: 0, left: 0 },
    marginLineX: MARGIN_LINE_X,
    marginLineSide: 'left',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
  lighting: null,
  texture: null,
};

/**
 * Наклонный лист в меру пресета `grid-1`: угол −1,17° на кадре 1600 px даёт
 * сдвиг линии во всю ширину кадра больше десятой доли шага, поэтому потерянное
 * при отражении слагаемое сразу выводит строки за допуск.
 */
const TILTED_SHEET: PaperSheet = {
  ...SHEET,
  id: 'tilted',
  width: 1600,
  height: 2050,
  ruling: {
    step: 53.7,
    firstLinePhase: 21.3,
    skewAngle: -1.17,
    margins: { top: 130, right: 150, bottom: 90, left: 170 },
    marginLineX: null,
    marginLineSide: null,
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  },
};

/**
 * Наклонный лист с изгибом. Узлы несимметричны и область узлов не по центру
 * кадра: отражённый изгиб отличается от исходного и порядком узлов, и началом
 * области.
 */
const BENT_SHEET: PaperSheet = {
  ...TILTED_SHEET,
  id: 'bent',
  ruling: {
    ...TILTED_SHEET.ruling,
    bend: {
      columnOrigin: 170,
      columnSpacing: 400,
      columnCount: 4,
      rowOrigin: 21.3,
      rowSpacing: 1000,
      rowCount: 2,
      offsets: [0, 3.5, -2.25, 1, 0.5, 1.75, -1, 0],
    },
  },
};

/**
 * Наклонный лист с перспективой. Начало отсчёта не в середине кадра, схождение
 * по ширине ненулевое: отражённая перспектива отличается от исходной и
 * началом, и знаком схождения.
 */
const SLOPED_SHEET: PaperSheet = {
  ...TILTED_SHEET,
  id: 'sloped',
  ruling: {
    ...TILTED_SHEET.ruling,
    perspective: {
      originX: 700,
      originY: 900,
      convergenceX: 2e-5,
      convergenceY: 2.5e-5,
    },
  },
};

const FAMILY: PaperFamily = {
  id: 'lined',
  label: 'В линейку',
  kind: 'lined',
  sheets: [SHEET, TILTED_SHEET, BENT_SHEET, SLOPED_SHEET],
};

const PAGE: Page = {
  lines: [
    { text: 'раз два', paragraphIndex: 0 },
    { text: '', paragraphIndex: 0 },
    { text: 'три', paragraphIndex: 1 },
  ],
};

/**
 * Поправка, у которой ни одна дельта не нулевая: совпадение с раскладкой
 * проверяется не на одной вычисленной геометрии.
 */
const CORRECTION = {
  fontSizePx: 0.1,
  lineSpacing: -0.05,
  topOffset: 0.5,
  leftPadding: 0.25,
  blockWidth: -1,
};

/**
 * Изображение-пустышка: рендерер только передаёт его в контекст, а тест
 * сравнивает по ссылке.
 */
const SHEET_IMAGE = { id: 'sheet-image' } as unknown as RenderImage;

/**
 * Вход адаптера для страницы с заданным номером: разлиновка страницы берётся
 * тем же селектором, которым её берёт раскладка.
 *
 * @param patch — поля, заменяющие значения по умолчанию
 * @param pageIndex — номер страницы, считая с нуля
 * @param sheet — лист страницы
 * @returns вход адаптера
 */
const buildInput = (
  patch: Partial<PageRenderInput> = {},
  pageIndex = 0,
  sheet: PaperSheet = SHEET
): PageRenderInput => {
  return {
    page: PAGE,
    calibration: getPageCalibration(FAMILY, sheet, pageIndex),
    sheetImage: SHEET_IMAGE,
    metrics: FALLBACK_FONT_METRICS,
    correction: DEFAULT_GEOMETRY_CORRECTION,
    inkColor: '#123456',
    fontFamily: 'Eskal',
    flags: NO_DISTORTION_FLAGS,
    wordFrequency: 1,
    letterFrequency: 1,
    seed: 42,
    ink: { lighting: null, texture: null, seed: 7 },
    glyphs: null,
    scale: 1,
    ...patch,
  };
};

/**
 * Насколько базовая линия строки отходит от ближайшей линии фотографии листа,
 * в долях шага.
 *
 * Эталон построен без отражённой разлиновки: линия исходной фотографии —
 * точки `(x, y₀ + tanθ·x)`, отражённая фотография переносит каждую точку в
 * `(W − x, y)`. Точка базовой линии переводится из системы блока в систему
 * страницы тем же поворотом, которым её кладёт рендерер, и возвращается на
 * исходную фотографию отражением.
 *
 * @param params — параметры отрисовки зеркальной страницы
 * @param sheet — лист страницы
 * @param lineIndex — номер строки на странице
 * @param blockX — точка на строке от левого края блока
 * @returns отклонение в долях шага разлиновки
 */
const measureMirroredBaselineDrift = (
  params: PageRenderParams,
  sheet: PaperSheet,
  lineIndex: number,
  blockX: number
): number => {
  const { fontSizePx, lineSpacing, topOffset, leftPadding, blockRotate, fontMetrics } =
    params.geometry;
  const { step, firstLinePhase, skewAngle } = sheet.ruling;
  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const localX = leftPadding + blockX;
  const localY = topOffset + fontMetrics.fontAscent * fontSizePx + lineIndex * lineStep;
  const angle = blockRotate / DEGREES_IN_RADIAN;
  const pageX = localX * Math.cos(angle) - localY * Math.sin(angle);
  const pageY = localX * Math.sin(angle) + localY * Math.cos(angle);
  const photoX = sheet.width - pageX;
  const lines =
    (pageY - firstLinePhase - Math.tan(skewAngle / DEGREES_IN_RADIAN) * photoX) / step;

  return Math.abs(lines - Math.round(lines));
};

describe('адаптер параметров отрисовки', () => {
  it('переводит раскладку в слова и строки страницы', () => {
    const { page } = buildPageRenderParams(buildInput());

    expect(page.lines).toHaveLength(3);
    expect(
      page.lines[0]?.words.map((word) => {
        return word.text;
      })
    ).toEqual(['раз', 'два']);
    expect(page.lines[1]?.words).toEqual([]);
  });

  it('берёт кегль и края блока из разлиновки листа страницы', () => {
    const { geometry } = buildPageRenderParams(buildInput());

    expect(geometry.fontSizePx).toBeCloseTo(
      (RULING_STEP * 0.55) / FALLBACK_FONT_METRICS.xHeight
    );
    expect(geometry.leftPadding).toBeCloseTo(MARGIN_LINE_X + MARGIN_LINE_GAP);
    expect(geometry.blockWidth).toBeCloseTo(
      SHEET_WIDTH - MARGIN_LINE_X - MARGIN_LINE_GAP - RIGHT_MARGIN
    );
  });

  it('считает геометрию страницы тем же расчётом, что и раскладка', () => {
    [0, 1].forEach((pageIndex) => {
      const calibration = getPageCalibration(FAMILY, TILTED_SHEET, pageIndex);
      const { geometry } = buildPageRenderParams(
        buildInput({ correction: CORRECTION }, pageIndex, TILTED_SHEET)
      );

      expect(geometry).toEqual({
        ...deriveGeometry(calibration, FALLBACK_FONT_METRICS, CORRECTION),
        blockRotate: calibration.ruling.skewAngle,
        fontMetrics: FALLBACK_FONT_METRICS,
        bend: null,
        perspective: null,
      });
    });
  });

  it('кладёт фотографию во весь кадр листа страницы', () => {
    const { background } = buildPageRenderParams(buildInput());

    expect(background).toEqual({
      image: SHEET_IMAGE,
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
    });
  });

  it('оставляет одни чернила, когда фотографии нет', () => {
    const { background } = buildPageRenderParams(buildInput({ sheetImage: null }));

    expect(background).toBeNull();
  });

  it('наклоняет блок на угол разлиновки страницы', () => {
    const { geometry } = buildPageRenderParams(buildInput());

    expect(geometry.blockRotate).toBe(SKEW_ANGLE);
  });
});

describe('чётные страницы', () => {
  it('считает чётной вторую страницу пользовательской нумерации', () => {
    expect(isMirroredPage(0)).toBe(false);
    expect(isMirroredPage(1)).toBe(true);
    expect(isMirroredPage(2)).toBe(false);
  });

  it('отступает от отражённой линии поля на ту же величину, что и на нечётной', () => {
    const straight = buildPageRenderParams(buildInput({}, 0)).geometry;
    const mirrored = buildPageRenderParams(buildInput({}, 1)).geometry;
    /**
     * После отражения линия поля стоит у правого края кадра; блок обязан
     * кончаться на том же расстоянии от неё, на каком на нечётной странице
     * начинался.
     */
    const mirroredMarginLineX = SHEET_WIDTH - MARGIN_LINE_X;

    expect(straight.leftPadding - MARGIN_LINE_X).toBeCloseTo(MARGIN_LINE_GAP);
    expect(mirrored.blockWidth).toBeCloseTo(straight.blockWidth);
    expect(
      mirroredMarginLineX - (mirrored.leftPadding + mirrored.blockWidth)
    ).toBeCloseTo(straight.leftPadding - MARGIN_LINE_X);
  });

  it('переворачивает наклон блока вместе с фотографией', () => {
    const straight = buildPageRenderParams(buildInput({}, 0)).geometry;
    const mirrored = buildPageRenderParams(buildInput({}, 1)).geometry;

    expect(straight.blockRotate).toBe(SKEW_ANGLE);
    expect(mirrored.blockRotate).toBe(-SKEW_ANGLE);
  });

  it('передаёт изгиб листа: на нечётной странице как есть, на чётной — отражённый', () => {
    const straight = buildPageRenderParams(buildInput({}, 0, BENT_SHEET)).geometry;
    const mirrored = buildPageRenderParams(buildInput({}, 1, BENT_SHEET)).geometry;

    expect(straight.bend).toStrictEqual(BENT_SHEET.ruling.bend);
    expect(mirrored.bend).toStrictEqual(
      mirrorSheetRuling(BENT_SHEET.ruling, BENT_SHEET).bend
    );
    expect(mirrored.bend).not.toStrictEqual(straight.bend);
  });

  it('передаёт перспективу листа: на нечётной странице как есть, на чётной — отражённую', () => {
    const straight = buildPageRenderParams(buildInput({}, 0, SLOPED_SHEET)).geometry;
    const mirrored = buildPageRenderParams(buildInput({}, 1, SLOPED_SHEET)).geometry;

    expect(straight.perspective).toStrictEqual(SLOPED_SHEET.ruling.perspective);
    expect(mirrored.perspective).toStrictEqual(
      mirrorSheetRuling(SLOPED_SHEET.ruling, SLOPED_SHEET).perspective
    );
    expect(mirrored.perspective).not.toStrictEqual(straight.perspective);
  });

  it('кладёт базовые линии на линии отражённой фотографии наклонного листа', () => {
    const params = buildPageRenderParams(buildInput({}, 1, TILTED_SHEET));
    const { blockWidth } = params.geometry;

    [0, 5, 20].forEach((lineIndex) => {
      [0, blockWidth / 2, blockWidth].forEach((blockX) => {
        expect(
          measureMirroredBaselineDrift(params, TILTED_SHEET, lineIndex, blockX)
        ).toBeLessThanOrEqual(BASELINE_TOLERANCE);
      });
    });
  });

  it('не требует отдельной настройки отступа: другой лист его пересчитывает', () => {
    const wider: PaperSheet = {
      ...SHEET,
      id: 'wider',
      width: SHEET_WIDTH * 2,
      ruling: {
        ...SHEET.ruling,
        marginLineX: MARGIN_LINE_X * 2,
        margins: { ...SHEET.ruling.margins, right: 60 },
      },
    };
    const first = buildPageRenderParams(buildInput({}, 1)).geometry;
    const second = buildPageRenderParams(buildInput({}, 1, wider)).geometry;

    expect(second.leftPadding).not.toBeCloseTo(first.leftPadding);
  });
});

describe('предпросмотр и снимок', () => {
  it('отличаются только масштабом', () => {
    const preview = buildPageRenderParams(buildInput({ scale: 0.5 }));
    const full = buildPageRenderParams(buildInput({ scale: 1 }));

    expect(preview.scale).toBe(0.5);
    expect(full.scale).toBe(1);
    expect({ ...preview, scale: 0 }).toEqual({ ...full, scale: 0 });
  });

  it('рисуют одно и то же с точностью до масштаба', () => {
    const preview = createDrawRecorder();
    const full = createDrawRecorder();

    renderPageToCanvas(preview.context, buildPageRenderParams(buildInput({ scale: 1 })));
    renderPageToCanvas(full.context, buildPageRenderParams(buildInput({ scale: 4 })));

    const strip = (calls: typeof preview.calls) => {
      return calls.filter((call) => {
        return call.name !== 'scale';
      });
    };

    expect(strip(full.calls)).toEqual(strip(preview.calls));
    expect(findCalls(preview.calls, 'scale')).toEqual([[1, 1]]);
    expect(findCalls(full.calls, 'scale')).toEqual([[4, 4]]);
  });
});

describe('состав снимка', () => {
  it('содержит только лист и его текст', () => {
    const recorder = createDrawRecorder();

    renderPageToCanvas(recorder.context, buildPageRenderParams(buildInput()));

    const images = findCalls(recorder.calls, 'drawImage');
    const texts = findCalls(recorder.calls, 'fillText').map(([text]) => {
      return text;
    });

    expect(images).toHaveLength(1);
    expect(images[0]?.[0]).toBe(SHEET_IMAGE);
    expect(texts).toEqual(['раз', 'два', 'три']);
  });
});

describe('отражение фотографии', () => {
  it('переворачивает изображение по горизонтали', () => {
    const recorder = createDrawRecorder();
    const mirrored = { id: 'mirror' } as unknown as RenderImage;
    const result = mirrorRenderImage(SHEET_IMAGE, 400, 800, () => {
      return { context: recorder.context, image: mirrored };
    });

    expect(result).toBe(mirrored);
    expect(findCalls(recorder.calls, 'translate')).toEqual([[400, 0]]);
    expect(findCalls(recorder.calls, 'scale')).toEqual([[-1, 1]]);
    expect(findCalls(recorder.calls, 'drawImage')).toEqual([
      [SHEET_IMAGE, 0, 0, 400, 800],
    ]);
  });

  it('отдаёт исходную фотографию, когда контекста нет', () => {
    const result = mirrorRenderImage(SHEET_IMAGE, 400, 800, () => {
      return { context: null, image: SHEET_IMAGE };
    });

    expect(result).toBe(SHEET_IMAGE);
  });
});

describe('растеризация страницы', () => {
  it('кодирует снимок в формат фотографии с заданным качеством', () => {
    const surfaces = createSurfaceRecorder();
    const dataUrl = renderPageImage({
      params: buildPageRenderParams(buildInput()),
      pageWidth: SHEET_WIDTH,
      pageHeight: SHEET_HEIGHT,
      quality: 0.92,
      createSurface: surfaces.createSurface,
    });

    expect(surfaces.encodings).toEqual([{ type: PAGE_IMAGE_MIME, quality: 0.92 }]);
    expect(dataUrl.startsWith(`data:${PAGE_IMAGE_MIME}`)).toBe(true);
  });

  it('растеризует в разрешении, заданном масштабом', () => {
    const surfaces = createSurfaceRecorder();

    renderPageImage({
      params: buildPageRenderParams(buildInput({ scale: 0.5 })),
      pageWidth: SHEET_WIDTH,
      pageHeight: SHEET_HEIGHT,
      quality: 0.92,
      createSurface: surfaces.createSurface,
    });

    expect(surfaces.sizes).toEqual([
      { width: SHEET_WIDTH / 2, height: SHEET_HEIGHT / 2 },
    ]);
  });

  it('кладёт фотографию на всю канву и не оставляет под ней подложки', () => {
    const surfaces = createSurfaceRecorder();

    renderPageImage({
      params: buildPageRenderParams(buildInput()),
      pageWidth: SHEET_WIDTH,
      pageHeight: SHEET_HEIGHT,
      quality: 0.92,
      createSurface: surfaces.createSurface,
    });

    expect(surfaces.sizes).toEqual([{ width: SHEET_WIDTH, height: SHEET_HEIGHT }]);
    expect(findCalls(surfaces.calls, 'drawImage')).toEqual([
      [SHEET_IMAGE, 0, 0, SHEET_WIDTH, SHEET_HEIGHT],
    ]);
    expect(findCalls(surfaces.calls, 'fillRect')).toEqual([]);
  });

  it('закрашивает страницу без фотографии: прозрачности в формате с потерями нет', () => {
    const surfaces = createSurfaceRecorder();

    renderPageImage({
      params: buildPageRenderParams(buildInput({ sheetImage: null })),
      pageWidth: SHEET_WIDTH,
      pageHeight: SHEET_HEIGHT,
      quality: 0.92,
      createSurface: surfaces.createSurface,
    });

    expect(findCalls(surfaces.calls, 'fillRect')).toEqual([
      [0, 0, SHEET_WIDTH, SHEET_HEIGHT],
    ]);
  });
});
