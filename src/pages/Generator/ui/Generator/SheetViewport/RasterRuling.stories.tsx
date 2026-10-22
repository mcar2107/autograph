import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FC } from 'react';
import { useEffect } from 'react';
import { expect, waitFor } from 'storybook/test';
import { useShallow } from 'zustand/react/shallow';

import {
  CUSTOM_FONT_FAMILY,
  GRID_FAMILY_ID,
  HANDWRITING_FONTS,
  LINED_FAMILY_ID,
} from '../../../config';
import { GRID_ROW_STEPS, MARGIN_LINE_GAP_SHARE } from '../../../lib/calibrate';
import type { GlyphSource } from '../../../lib/glyph';
import { contourBounds } from '../../../lib/glyph';
import {
  clearFontMetricsCache,
  loadFontMetrics,
} from '../../../lib/measure/measureFontMetrics';
import type {
  PaperFamily,
  PaperSheet,
  RulingBend,
  RulingPerspective,
  RulingProjection,
  SheetImageData,
} from '../../../lib/paper';
import {
  buildSheetRuling,
  detectRuling,
  lineCoordinateAt,
  lineHeightAt,
  lineHeightScaleAt,
  lineHeightSlopeAt,
  sampleRulingBend,
  sampleRulingBendSlope,
} from '../../../lib/paper';
import type { PageRenderParams, RenderImage } from '../../../lib/render';
import { loadRenderImage } from '../../../lib/render';
import { drawPage, measurePageImage } from '../../../model/drawPage';
import { getPageRuling } from '../../../model/geometrySelectors';
import { clearLayoutCache } from '../../../model/measureLayout';
import { mirrorRenderImage } from '../../../model/mirrorRenderImage';
import { loadPaperFamilies } from '../../../model/paperProfiles';
import { findSheet } from '../../../model/paperSelectors';
import { findFontUrl } from '../../../model/useFontGlyphs';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '../../../model/useGeneratorStore';
import { usePageGeometry } from '../../../model/usePageGeometry';
import { usePageLayout } from '../../../model/usePageLayout';
import { usePageRender } from '../../../model/usePageRender';
import { useRunRender } from '../../../model/useRunRender';

import { SheetViewport } from './SheetViewport';

/**
 * Область просмотра пробы: примерно центральная колонка окна 1440×900. Лист
 * рисует сам `SheetViewport` экрана — проба меряет то, что он показывает.
 */
const VIEWPORT_BOX = { width: '760px', height: '720px' };

/**
 * Что нужно, чтобы нарисовать страницу и померить её растр. Параметры берутся
 * те же самые, которыми рисует генератор: проверка идёт по пикселям готовой
 * страницы, а не по числам, из которых она собрана.
 */
type RasterProbe = {
  /**
   * Экземпляр листа, чья фотография ушла в отрисовку.
   */
  sheetId: string;

  /**
   * Лист, под который разложена показанная страница. Раскладка под новый лист
   * пересчитывается асинхронно и до того отстаёт от выбора в сторе.
   */
  layoutSheetId: string;

  /**
   * Число страниц раскладки.
   */
  pageCount: number;

  /**
   * Число слов во всех строках раскладки: по нему видно, что раскладка
   * пересчитана под текущий текст, а не осталась от прежнего на том же листе.
   * Числа страниц для этого мало: у двух текстов на одном листе оно
   * совпадает.
   */
  wordCount: number;

  /**
   * Номер показанной страницы: у соседних половин разворота параметры разные,
   * а экземпляр один и тот же.
   */
  pageIndex: number;

  /**
   * Экземпляр листа страницы: его кадр — размер страницы, его разлиновка — то,
   * с чем сверяется растр.
   */
  sheet: PaperSheet;

  /**
   * Параметры отрисовки страницы в пикселях кадра листа.
   */
  params: PageRenderParams;

  /**
   * Семья листов: её вид задаёт, сколько шагов разлиновки занимает строка.
   */
  family: PaperFamily;
};

/**
 * Полутоновая выжимка нарисованной страницы.
 */
type PageRaster = {
  /**
   * Ширина растра в пикселях.
   */
  width: number;

  /**
   * Высота растра в пикселях.
   */
  height: number;

  /**
   * Яркости пикселей от 0 до 1, построчно сверху вниз.
   */
  luminance: Float32Array;
};

/**
 * Участок растра, по которому снимается профиль.
 */
type RasterBand = {
  /**
   * Левый столбец участка включительно.
   */
  left: number;

  /**
   * Правый столбец участка не включая.
   */
  right: number;

  /**
   * Верхняя строка участка включительно.
   */
  top: number;

  /**
   * Нижняя строка участка не включая.
   */
  bottom: number;
};

/**
 * Профиль яркости вдоль наклонных линий вместе с местом его первого отсчёта.
 */
type ShearedProfile = {
  /**
   * Средние яркости бинов сверху вниз.
   */
  values: Float64Array;

  /**
   * Строка растра, которой отвечает нулевой бин, считая от верха участка.
   */
  origin: number;
};

/**
 * Найденная на растре разлиновка: шаг и положение линий вдоль их наклона.
 */
type RasterRuling = {
  /**
   * Тангенс наклона линий: снят свипом по растру, а не взят из характеристик
   * экземпляра.
   */
  tangent: number;

  /**
   * Строка участка, которой отвечает нулевой бин профиля.
   */
  origin: number;

  /**
   * Шаг разлиновки в пикселях растра.
   */
  period: number;

  /**
   * Положение линии в бинах профиля по модулю шага.
   */
  phase: number;

  /**
   * Глубина гребёнки в долях яркости: по ней видно, что найден именно ряд
   * линий, а не шум.
   */
  contrast: number;
};

/**
 * Узкая полоса столбцов страницы, в которой строки сверяются с линиями.
 */
type RasterStrip = {
  /**
   * Левый столбец полосы включительно.
   */
  left: number;

  /**
   * Правый столбец полосы не включая.
   */
  right: number;

  /**
   * Столбец середины полосы: в нём читаются изгиб и положение линий.
   */
  center: number;
};

/**
 * Полосы замера у левого края блока, посередине и у правого края.
 */
type StripSet = {
  /**
   * Полоса у левого края блока.
   */
  left: RasterStrip;

  /**
   * Полоса посередине блока.
   */
  middle: RasterStrip;

  /**
   * Полоса у правого края блока.
   */
  right: RasterStrip;
};

/**
 * Как строки страницы легли на линии в одной полосе.
 */
type StripFit = {
  /**
   * Наибольшее отклонение базовых линий геометрии с изгибом листа от линий
   * растра в долях шага.
   */
  drift: number;

  /**
   * Отклонение низа чернил каждой строки от линии растра в долях шага.
   * `null` — чернил строки в полосе не нашлось.
   */
  inkOffsets: (number | null)[];
};

/**
 * Страница, проверенная по растру, вместе с фотографией, на которой её
 * рисовали.
 */
type RasterCheck = {
  /**
   * Проба проверенной страницы.
   */
  probe: RasterProbe;

  /**
   * Фотография листа страницы; на чётной странице — отражённая.
   */
  image: RenderImage;
};

/**
 * Веса каналов при переводе цвета в яркость — та же свёртка, что и у разбора
 * фотографий листа.
 */
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;

/**
 * Окно, по которому из профиля вычитается фон. Шире любого шага разлиновки и
 * заметно уже неравномерности освещения листа: свет уходит, линии остаются.
 */
const BACKGROUND_WINDOW = 151;

/**
 * Границы перебора шага разлиновки в пикселях растра. Шаги пресет-пака лежат
 * внутри с запасом в обе стороны, поэтому неверный масштаб фотографии не
 * выпадает из перебора, а находится с неправильным шагом — это и нужно
 * увидеть.
 */
const MIN_PERIOD = 20;
const MAX_PERIOD = 160;

/**
 * Доля от лучшего отклика, начиная с которой сдвиг считается основным
 * периодом: у гребёнки отклик повторяется на кратных сдвигах, а нужен первый.
 */
const FUNDAMENTAL_SHARE = 0.7;

/**
 * Границы и шаг свипа наклона. Наклон разлиновки в пресет-паке не выходит за
 * два градуса, перебор берётся с запасом.
 */
const MAX_TANGENT = 0.06;
const TANGENT_STEP = 0.004;

/**
 * Допустимое отклонение базовой линии от линии разлиновки в долях шага —
 * ровно то, что требует сценарий «Строки ложатся на линии».
 */
const DRIFT_TOLERANCE = 0.1;

/**
 * Допустимое расхождение измеренного шага с шагом разлиновки листа в долях шага.
 * Растровый замер грубее расчёта: линия занимает несколько пикселей, и
 * положение её середины гуляет на доли пикселя.
 */
const PERIOD_TOLERANCE = 0.02;

/**
 * Допустимое расхождение измеренного наклона с наклоном экземпляра в
 * градусах.
 */
const ANGLE_TOLERANCE = 0.5;

/**
 * Наименьшая глубина гребёнки, при которой замеру можно верить.
 */
const MIN_CONTRAST = 0.004;

/**
 * Сколько шагов разлиновки должно уместиться в полосе без чернил и сколько их
 * берётся в замер. Больше десятка шагов период не уточняют, а каждый лишний
 * пиксель полосы проходится свипом наклона по разу.
 */
const MIN_BAND_STEPS = 4;
const MAX_BAND_STEPS = 12;

/**
 * Через сколько столбцов берётся отсчёт в профиле. Линии разлиновки тянутся
 * через весь кадр, и каждый третий столбец описывает их не хуже сплошного
 * прохода — а свип наклона идёт втрое быстрее.
 */
const COLUMN_STRIDE = 3;

/**
 * Яркость, ниже которой пиксель считается чернилами. Бумага и разлиновка
 * заметно светлее: линия печатается бледной, чернила — тёмные.
 */
const INK_LEVEL = 0.45;

/**
 * Доли от вершины строки: по первой строка отделяется от пустого места, по
 * второй ищется её низ. Низ строки — не низ чернил: выносные элементы уходят
 * под базовую линию, но их на порядок меньше, чем тела букв.
 */
const INK_BAND_SHARE = 0.15;
const INK_BASELINE_SHARE = 0.35;

/**
 * Допустимое расхождение низа строки чернил с линией растра в долях шага.
 * Замер грубее расчёта: край чернил размыт сглаживанием, а под линией
 * остаются выносные элементы. Запас взят с тройным перекрытием к расхождению на
 * пресет-паке, но постоянный сдвиг в четверть шага, какой даёт сверка по
 * серединам строк или строка, не повторившая изгиб, порог ловит.
 */
const INK_TOLERANCE = 0.15;

/**
 * Доли ширины фотографии, между которыми снимается профиль. Края отброшены
 * намеренно: у листа в клетку за линией поля напечатана мелкая линейка со
 * своим шагом, и на отражённой странице она оказывается у другого края.
 */
const BAND_LEFT_SHARE = 0.3;
const BAND_RIGHT_SHARE = 0.7;

/**
 * Сколько строк набирается на проверяемую страницу: хватает на замер низа
 * строк, и под ними остаётся полоса без чернил.
 */
const CHECKED_ROW_COUNT = 4;

/**
 * Слова абзаца на всю ширину блока: короткие, поэтому строки набираются почти
 * до правого края блока. Повторов столько, что текст не влезает в две страницы
 * ни одного листа — и чётная страница тоже набрана целиком.
 */
const WIDE_WORDS = Array.from({ length: 600 }, () => {
  return 'и снова до поля';
})
  .join(' ')
  .split(' ');

/**
 * Абзац на всю ширину блока.
 */
const WIDE_TEXT = WIDE_WORDS.join(' ');

/**
 * Ширина полосы замера в шагах разлиновки. Замер ведётся вдоль изогнутой
 * линии: профиль сдвигается по её местному наклону в центре полосы, и внутри
 * трёх шагов линия от этой прямой почти не отходит.
 */
const STRIP_STEPS = 3;

/**
 * Насколько правая полоса отступает от правого края блока, в шагах
 * разлиновки: строка переносится целым словом и до края не доходит, а чернила
 * каждой проверяемой строки обязаны зайти в полосу.
 */
const RAGGED_STEPS = 2;

/**
 * Сколько точек строки проверяется на выход строчного бокса за кадр: от
 * левого до правого края блока включительно.
 */
const BOX_POINT_COUNT = 9;

/**
 * Кадр, шаг и фаза изогнутого листа. Шаг мельче, чем у пресет-пака: узлы
 * изгиба стоят через два шага, и подъём линии между соседними узлами обязан
 * уложиться в окно трассировки в шестую шага — на мелком шаге тот же отход в
 * долях шага набирается на большем числе узлов.
 */
const BENT_SHEET_WIDTH = 1600;
const BENT_SHEET_HEIGHT = 2000;
const BENT_SHEET_STEP = 40;
const BENT_SHEET_PHASE = 11;

/**
 * Сколько шагов сверху и снизу кадра лист без линий: линии до самого края
 * кадра сбивают поиск шага на кратный.
 */
const BENT_BLANK_STEPS = 8;

/**
 * Форма изгиба по доле полуширины кадра от центра: середина прямая, левая
 * половина плавно опускается на отход, правая так же поднимается, и у самых
 * краёв линии снова идут ровно.
 *
 * Изгиб несимметричен: у отражённого листа он направлен навстречу исходному,
 * и зеркальная страница, потерявшая отражение изгиба, уводит строки у краёв
 * больше чем на полшага. Прямые середина и края не сбивают свип угла и держат
 * отход найденного изгиба в крайних полосах выше четверти шага, а подъём
 * ступени достаточно пологий для окна трассировки.
 */
const BENT_FLAT_SHARE = 0.3;
const BENT_EDGE_SHARE = 0.2;
const BENT_REACH_SHARE = 0.35;

/**
 * Толщина и цвет линий изогнутого листа, цвет бумаги: линия светлее порога
 * чернил, но заметно темнее бумаги.
 */
const BENT_LINE_WIDTH = 2.4;
const BENT_LINE_COLOR = 'rgb(120, 140, 170)';
const BENT_PAPER_COLOR = 'rgb(246, 244, 238)';

/**
 * Через сколько пикселей ставится вершина ломаной линии листа.
 */
const BENT_LINE_SEGMENT = 4;

/**
 * Идентификатор изогнутого листа: не совпадает ни с одним экземпляром пака.
 */
const BENT_SHEET_ID = 'bent-synthetic';

/**
 * Кадр, шаг и фаза листа с перспективой — те же, что у изогнутого листа.
 */
const PERSPECTIVE_SHEET_WIDTH = 1600;
const PERSPECTIVE_SHEET_HEIGHT = 2000;
const PERSPECTIVE_SHEET_STEP = 40;
const PERSPECTIVE_SHEET_PHASE = 11;

/**
 * Перспектива листа story. Начало — середина кадра: шаг у верхнего края кадра
 * около 0,96 шага, у нижнего — около 1,04, а линии расходятся вправо на долю
 * процента. Строки проверяемой страницы стоят у верха листа, где координата
 * вдоль линий отстоит от высоты линии на фотографии почти на полшага: строки,
 * нарисованные без перспективы, уходят с линий далеко за допуск.
 */
const SHEET_PERSPECTIVE: RulingPerspective = {
  originX: PERSPECTIVE_SHEET_WIDTH / 2,
  originY: PERSPECTIVE_SHEET_HEIGHT / 2,
  convergenceX: 5e-6,
  convergenceY: 2e-5,
};

/**
 * Идентификатор листа с перспективой: не совпадает ни с одним экземпляром пака.
 */
const PERSPECTIVE_SHEET_ID = 'perspective-synthetic';

/**
 * Наименьший отход найденного изгиба в центре крайней полосы в долях шага:
 * меньше — и строки без изгиба почти укладывались бы в допуск чернил, а
 * отрицательный контроль ничего бы не проверил.
 */
const MIN_STRIP_BEND_SHARE = 0.25;

/**
 * Нечётная и зеркальная половины разворота.
 */
const SPREAD_PAGES = [0, 1];

/**
 * Погрешность растра в пикселях: пиксель сверяется центром, а после поворота
 * на наклон блока его край отстоит от центра до половины диагонали.
 */
const RASTER_TOLERANCE = 1;

/**
 * Насколько край текста может не доставать до края блока, в шагах разлиновки.
 * Строка переносится целым словом, но из десятка строк хоть одна доходит до
 * края ближе двух шагов — иначе текст не на всю ширину, и проверка краёв
 * ничего бы не сказала.
 */
const FILL_TOLERANCE_STEPS = 2;

/**
 * Шрифт проверки: тот, с которым генератор открывается.
 */
const DEFAULT_FONT = HANDWRITING_FONTS[0]?.family || '';

/**
 * Варианты шрифта страницы: встроенный, который рисуется контурами, и тот же
 * файл, подключённый своим шрифтом, — без контуров, обычными буквами.
 */
const FONT_VARIANTS: (string | null)[] = [null, CUSTOM_FONT_FAMILY];

let lastProbe: RasterProbe | null = null;

/**
 * Разбор изогнутого листа идёт один раз на прогон: детектор по кадру в два
 * мегапикселя работает заметное время.
 */
let bentSheet: PaperSheet | null = null;

/**
 * Лист с перспективой рисуется один раз на прогон.
 */
let perspectiveSheet: PaperSheet | null = null;

/**
 * Подключение своего шрифта одно на прогон: семейство у него всегда одно.
 */
let customFontTask: Promise<void> | null = null;

/**
 * Число слов в тексте.
 *
 * @param text — текст
 * @returns число слов
 */
const countTextWords = (text: string): number => {
  return text.split(/\s+/).filter(Boolean).length;
};

/**
 * Число слов во всех строках раскладки.
 *
 * @param pages — страницы раскладки
 * @returns число слов
 */
const countLayoutWords = (pages: ReturnType<typeof usePageLayout>): number => {
  return pages.reduce((count, page) => {
    return (
      count +
      page.lines.reduce((lineCount, line) => {
        return lineCount + countTextWords(line.text);
      }, 0)
    );
  }, 0);
};

/**
 * Проба страницы: собирает параметры отрисовки теми же хуками, что и экран
 * генератора.
 */
const RasterRulingProbe: FC = () => {
  const pages = usePageLayout();
  const source = usePageRender(pages);
  const plan = useRunRender(pages);
  const { family } = usePageGeometry();
  const { sheetId, pageIndex } = useGeneratorStore(
    useShallow((state) => {
      return { sheetId: state.sheetId, pageIndex: state.pageIndex };
    })
  );
  const params = source ? source.buildParams(1) : null;
  const sheet = family ? findSheet(family, sheetId) : undefined;
  const probe: RasterProbe | null =
    family && sheet && params?.background
      ? {
          sheetId: sheet.id,
          layoutSheetId: pages[pageIndex]?.sheetId || '',
          pageCount: pages.length,
          wordCount: countLayoutWords(pages),
          sheet,
          pageIndex,
          params,
          family,
        }
      : null;

  /**
   * Без списка зависимостей: фотография листа и метрики шрифта доезжают
   * асинхронно, и проверке важно последнее состояние.
   */
  useEffect(() => {
    lastProbe = probe;
  });

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="raster-probe">
        {probe
          ? `${probe.sheetId}: строк ${probe.params.page.lines.length}`
          : 'страница не собралась'}
      </p>

      <div className="flex flex-col" style={VIEWPORT_BOX}>
        <SheetViewport source={source} plan={plan} />
      </div>
    </div>
  );
};

/**
 * Переводит градусы в радианы.
 *
 * @param degrees — угол в градусах
 * @returns угол в радианах
 */
const toRadians = (degrees: number): number => {
  return (degrees * Math.PI) / 180;
};

/**
 * Отход линии изгиба в точке страницы. Без изгиба линии прямые, и отход
 * нулевой.
 *
 * @param bend — изгиб; `null` — его нет
 * @param projection — наклон и перспектива, в которых изгиб читается
 * @param x — столбец в пикселях страницы
 * @param y — высота в пикселях страницы
 * @returns отход вниз в пикселях
 */
const sampleBend = (
  bend: RulingBend | null,
  projection: RulingProjection,
  x: number,
  y: number
): number => {
  return bend ? sampleRulingBend(bend, projection, x, y) : 0;
};

/**
 * Высота, на которую рендерер ставит точку страницы: `Y(x, U) + d`. Раскладка
 * поставила точку на прямую наклонную гребёнку блока, поэтому её координата
 * вдоль линий — `U = y − x × tg θ`; перспектива геометрии переводит `U` в
 * высоту линии на фотографии, изгиб геометрии опускает линию на свой отход.
 *
 * @param geometry — геометрия отрисовки: наклон блока, перспектива и изгиб
 * @param x — столбец точки в пикселях страницы
 * @param y — высота точки на прямой гребёнке в пикселях страницы
 * @returns высота нарисованной точки в пикселях страницы
 */
const placeOnLine = (
  geometry: PageRenderParams['geometry'],
  x: number,
  y: number
): number => {
  const { blockRotate, perspective, bend } = geometry;
  const projection = { skewAngle: blockRotate, perspective };
  const lineY = perspective
    ? lineHeightAt(projection, x, y - x * Math.tan(toRadians(blockRotate)))
    : y;

  return lineY + sampleBend(bend, projection, x, lineY);
};

/**
 * Яркости пикселей RGBA-буфера.
 *
 * @param data — пиксели построчно, по четыре канала
 * @param size — число пикселей
 * @returns яркости от 0 до 1
 */
const toLuminance = (data: Uint8ClampedArray, size: number): Float32Array => {
  const luminance = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    const offset = index * 4;

    luminance[index] =
      ((data[offset] || 0) * RED_WEIGHT +
        (data[offset + 1] || 0) * GREEN_WEIGHT +
        (data[offset + 2] || 0) * BLUE_WEIGHT) /
      255;
  }

  return luminance;
};

/**
 * Рисует страницу настоящим путём отрисовки и снимает с неё полутоновую
 * выжимку.
 *
 * Фотография подставляется своя, а не та, что держит хук предпросмотра: хук
 * оставляет прежнюю картинку, пока грузится новая, и проверка успевала бы
 * снять чужой лист с новой геометрией. Всё остальное — размер страницы,
 * геометрия, искажения — приходит из настоящего пути отрисовки.
 *
 * @param probe — проба страницы
 * @param image — фотография выбранного экземпляра
 * @param params — параметры отрисовки; не заданы — параметры пробы
 * @returns растр страницы
 */
const renderProbeRaster = (
  probe: RasterProbe,
  image: RenderImage,
  params: PageRenderParams = probe.params
): PageRaster => {
  const { sheet } = probe;

  return rasterizePage(sheet, {
    ...params,
    background: params.background ? { ...params.background, image } : null,
  });
};

/**
 * Рисует страницу настоящим путём отрисовки в кадре листа и снимает
 * полутоновую выжимку.
 *
 * @param sheet — лист страницы: его кадр — размер страницы
 * @param params — параметры отрисовки
 * @returns растр страницы
 */
const rasterizePage = (sheet: PaperSheet, params: PageRenderParams): PageRaster => {
  const size = measurePageImage(sheet.width, sheet.height, params.scale);
  const canvas = document.createElement('canvas');

  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Браузер не дал контекст canvas');
  }

  drawPage(context, params, size);

  const { data } = context.getImageData(0, 0, size.width, size.height);

  return {
    width: size.width,
    height: size.height,
    luminance: toLuminance(data, size.width * size.height),
  };
};

/**
 * Профиль средней яркости вдоль линий, наклонённых на заданный тангенс. Бин
 * профиля отвечает строке растра в опорном столбце: наклон учитывается
 * сдвигом, а не поворотом растра.
 *
 * Края, где бин собрался не со всей ширины участка, отброшены — иначе
 * профили разных наклонов стали бы несравнимы.
 *
 * @param raster — растр страницы
 * @param band — участок растра
 * @param tangent — тангенс наклона линий
 * @param pivot — опорный столбец; не задан — левый столбец участка
 * @returns средние яркости бинов сверху вниз
 */
const buildProfile = (
  raster: PageRaster,
  band: RasterBand,
  tangent: number,
  pivot = band.left
): ShearedProfile => {
  const height = band.bottom - band.top;
  const sums = new Float64Array(height);
  const counts = new Float64Array(height);

  for (let x = band.left; x < band.right; x += COLUMN_STRIDE) {
    const shift = Math.round((x - pivot) * tangent);

    for (let y = band.top; y < band.bottom; y += 1) {
      const bin = y - band.top - shift;

      if (bin >= 0 && bin < height) {
        sums[bin] = (sums[bin] || 0) + (raster.luminance[y * raster.width + x] || 0);
        counts[bin] = (counts[bin] || 0) + 1;
      }
    }
  }

  /**
   * Края отрезаются, а не обнуляются: бин, собранный не со всей ширины
   * участка, темнее соседей на ровном месте, и такой скачок перебил бы в
   * автокорреляции саму разлиновку.
   */
  const reach = Math.max(Math.abs(band.left - pivot), Math.abs(band.right - pivot));
  const guard = Math.ceil(Math.abs(tangent) * reach) + 1;
  const size = Math.max(0, height - 2 * guard);
  const values = new Float64Array(size);

  for (let index = 0; index < size; index += 1) {
    const bin = index + guard;
    const count = counts[bin] || 0;

    values[index] = count > 0 ? (sums[bin] || 0) / count : 0;
  }

  return { values, origin: guard };
};

/**
 * Затемнение профиля относительно местного фона: положительное на линиях.
 * Заодно уходит неравномерность освещения листа.
 *
 * @param profile — профиль яркости
 * @returns ряд затемнений
 */
const buildDarkness = (profile: Float64Array): Float64Array => {
  const size = profile.length;
  const half = Math.floor(BACKGROUND_WINDOW / 2);
  const prefix = new Float64Array(size + 1);
  const darkness = new Float64Array(size);

  for (let index = 0; index < size; index += 1) {
    prefix[index + 1] = (prefix[index] || 0) + (profile[index] || 0);
  }

  for (let index = 0; index < size; index += 1) {
    const from = Math.max(0, index - half);
    const to = Math.min(size, index + half + 1);
    const background = ((prefix[to] || 0) - (prefix[from] || 0)) / (to - from);

    darkness[index] = background - (profile[index] || 0);
  }

  return darkness;
};

/**
 * Размах ряда: по нему выбирается наклон, при котором линии не размазаны.
 */
const measureSpread = (values: Float64Array): number => {
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += (values[index] || 0) ** 2;
  }

  return values.length > 0 ? Math.sqrt(sum / values.length) : 0;
};

/**
 * Отклик автокорреляции затемнений на заданном сдвиге.
 */
const measureResponse = (darkness: Float64Array, lag: number): number => {
  let sum = 0;

  for (let index = 0; index + lag < darkness.length; index += 1) {
    sum += (darkness[index] || 0) * (darkness[index + lag] || 0);
  }

  return darkness.length > lag ? sum / (darkness.length - lag) : 0;
};

/**
 * Шаг разлиновки по автокорреляции затемнений.
 *
 * Берётся первый сдвиг, отклик на котором сравним с лучшим: у ряда линий
 * отклик повторяется на кратных сдвигах, а нужен основной период. Вершина
 * уточняется параболой по трём соседним откликам.
 *
 * @param darkness — ряд затемнений
 * @returns шаг в пикселях растра; ноль — периодичности нет
 */
const measurePeriod = (darkness: Float64Array): number => {
  const responses = new Float64Array(MAX_PERIOD + 1);
  let best = 0;

  for (let lag = MIN_PERIOD; lag <= MAX_PERIOD; lag += 1) {
    responses[lag] = measureResponse(darkness, lag);
    best = Math.max(best, responses[lag] || 0);
  }

  if (best <= 0) {
    return 0;
  }

  for (let lag = MIN_PERIOD + 1; lag < MAX_PERIOD; lag += 1) {
    const response = responses[lag] || 0;
    const isPeak =
      response >= (responses[lag - 1] || 0) && response >= (responses[lag + 1] || 0);

    if (isPeak && response >= best * FUNDAMENTAL_SHARE) {
      const previous = responses[lag - 1] || 0;
      const next = responses[lag + 1] || 0;
      const denominator = previous - 2 * response + next;
      const offset = denominator === 0 ? 0 : (0.5 * (previous - next)) / denominator;

      return lag + Math.max(-0.5, Math.min(0.5, offset));
    }
  }

  return 0;
};

/**
 * Положение линий по модулю шага: фаза первой гармоники ряда затемнений.
 * Гармоника, а не поиск самого тёмного бина, — линия шире пикселя, и её
 * середина лежит между отсчётами.
 *
 * @param darkness — ряд затемнений
 * @param period — шаг разлиновки
 * @returns фаза в бинах профиля от нуля до шага
 */
const measurePhase = (darkness: Float64Array, period: number): number => {
  let real = 0;
  let imaginary = 0;

  for (let index = 0; index < darkness.length; index += 1) {
    const angle = (2 * Math.PI * index) / period;

    real += (darkness[index] || 0) * Math.cos(angle);
    imaginary += (darkness[index] || 0) * Math.sin(angle);
  }

  const phase = (Math.atan2(imaginary, real) * period) / (2 * Math.PI);

  return ((phase % period) + period) % period;
};

/**
 * Ищет разлиновку на участке растра: сначала свипом — наклон, потом по нему —
 * шаг и фаза. Ни одна из трёх величин не берётся из характеристик экземпляра:
 * проверке нужно то, что видно на пикселях.
 *
 * @param raster — растр страницы
 * @param band — участок без чернил
 * @returns найденная разлиновка
 */
const measureRasterRuling = (raster: PageRaster, band: RasterBand): RasterRuling => {
  let tangent = 0;
  let contrast = 0;

  for (
    let candidate = -MAX_TANGENT;
    candidate <= MAX_TANGENT + TANGENT_STEP / 2;
    candidate += TANGENT_STEP
  ) {
    const spread = measureSpread(
      buildDarkness(buildProfile(raster, band, candidate).values)
    );

    if (spread > contrast) {
      contrast = spread;
      tangent = candidate;
    }
  }

  const profile = buildProfile(raster, band, tangent);
  const darkness = buildDarkness(profile.values);
  const period = measurePeriod(darkness);

  return {
    tangent,
    origin: profile.origin,
    period,
    phase: period > 0 ? measurePhase(darkness, period) : 0,
    contrast,
  };
};

/**
 * Базовые линии страницы на прямой наклонной гребёнке в столбце растра — до
 * перспективы и изгиба.
 *
 * Считаются по той же модели строчного бокса, которой рисует рендерер:
 * базовая линия строки n — `b = topOffset + fontAscent × кегль + n × шаг
 * строк` в координате вдоль линий. Блок повёрнут вокруг левого верхнего угла
 * страницы, а высота в его системе — `b × cos θ`, поэтому базовая линия
 * пересекает столбец x на высоте `b + x × tg θ`.
 *
 * @param params — параметры отрисовки страницы
 * @param column — столбец страницы в пикселях
 * @returns высоты базовых линий в пикселях страницы сверху вниз
 */
const buildBaselines = (params: PageRenderParams, column: number): number[] => {
  const { geometry, page } = params;
  const { fontSizePx, lineSpacing, topOffset, fontMetrics, blockRotate } = geometry;
  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const rise = column * Math.tan(toRadians(blockRotate));

  return page.lines.map((_, index) => {
    const baseline = topOffset + fontMetrics.fontAscent * fontSizePx + index * lineStep;

    return baseline + rise;
  });
};

/**
 * Сколько пикселей чернил в каждом бине наклонного профиля.
 *
 * @param raster — растр страницы
 * @param band — участок со строками
 * @param tangent — наклон строк
 * @param pivot — опорный столбец: бин отвечает строке растра в нём
 * @returns число тёмных пикселей по бинам сверху вниз
 */
const buildInkProfile = (
  raster: PageRaster,
  band: RasterBand,
  tangent: number,
  pivot: number
): ShearedProfile => {
  const height = band.bottom - band.top;
  const counts = new Float64Array(height);

  for (let x = band.left; x < band.right; x += 1) {
    const shift = Math.round((x - pivot) * tangent);

    for (let y = band.top; y < band.bottom; y += 1) {
      const bin = y - band.top - shift;
      const isInk = (raster.luminance[y * raster.width + x] || 0) < INK_LEVEL;

      if (isInk && bin >= 0 && bin < height) {
        counts[bin] = (counts[bin] || 0) + 1;
      }
    }
  }

  return { values: counts, origin: 0 };
};

/**
 * Низ строки чернил рядом с расчётной базовой линией.
 *
 * Считается именно низ, а не середина: на линию разлиновки садится базовая
 * линия, а середина строчного бокса стоит выше неё на половину высоты
 * строчных — сверять по ней значило бы получить постоянный сдвиг в четверть
 * шага.
 *
 * @param ink — профиль чернил
 * @param baseline — расчётная базовая линия в бинах профиля
 * @param lineStep — шаг строк
 * @returns низ строки в бинах профиля; `null` — строки рядом не нашлось
 */
const measureInkBottom = (
  ink: Float64Array,
  baseline: number,
  lineStep: number
): number | null => {
  const from = Math.max(0, Math.round(baseline - lineStep * 0.8));
  const to = Math.min(ink.length - 1, Math.round(baseline + lineStep * 0.3));
  let peak = 0;
  let peakIndex = -1;

  for (let index = from; index <= to; index += 1) {
    if ((ink[index] || 0) > peak) {
      peak = ink[index] || 0;
      peakIndex = index;
    }
  }

  if (peakIndex < 0 || peak <= 0) {
    return null;
  }

  let bottom = peakIndex;

  while (bottom + 1 <= to && (ink[bottom + 1] || 0) >= peak * INK_BASELINE_SHARE) {
    bottom += 1;
  }

  return peak > 0 && peak * INK_BAND_SHARE > 0 ? bottom : null;
};

/**
 * Наибольшее из отклонений низа чернил; строки без чернил не учитываются —
 * их наличие проверяется отдельно.
 *
 * @param offsets — отклонения строк в долях шага
 * @returns наибольшее отклонение
 */
const measureWorstOffset = (offsets: (number | null)[]): number => {
  return offsets.reduce<number>((worst, offset) => {
    return Math.max(worst, offset || 0);
  }, 0);
};

/**
 * Полосы замера: у левого края блока, посередине и у правого края.
 *
 * Край блока у каждой строки свой: блок повёрнут вокруг угла страницы, и
 * нижние строки сдвинуты вбок на наклон. Полосы ставятся внутрь самого узкого
 * места, а правая ещё и отступает от края на перенос слова — туда заходят
 * чернила каждой строки.
 *
 * @param probe — проба страницы
 * @returns три полосы столбцов страницы
 */
const buildStrips = (probe: RasterProbe): StripSet => {
  const { params, sheet, pageIndex } = probe;
  const { geometry, page } = params;
  const { fontSizePx, lineSpacing, topOffset, fontMetrics } = geometry;
  const { leftPadding, blockWidth, blockRotate } = geometry;
  const { step } = getPageRuling(sheet, pageIndex);
  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const radians = toRadians(blockRotate);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const firstBaseline = topOffset + fontMetrics.fontAscent * fontSizePx;
  const lastBaseline = firstBaseline + Math.max(0, page.lines.length - 1) * lineStep;
  const firstShift = firstBaseline * cos * sin;
  const lastShift = lastBaseline * cos * sin;
  const width = Math.round(STRIP_STEPS * step);
  const left = Math.ceil(leftPadding * cos - Math.min(firstShift, lastShift));
  const right = Math.floor(
    (leftPadding + blockWidth) * cos -
      Math.max(firstShift, lastShift) -
      RAGGED_STEPS * step
  );

  const toStrip = (start: number): RasterStrip => {
    return { left: start, right: start + width, center: start + width / 2 };
  };

  return {
    left: toStrip(left),
    middle: toStrip(Math.round((left + right - width) / 2)),
    right: toStrip(right - width),
  };
};

/**
 * Сверяет строки страницы с линиями растра в одной полосе.
 *
 * Линии растра меряются в полосе без чернил под текстом: профиль снимается
 * вдоль линии листа — по её местному наклону с перспективой плюс местному
 * наклону изгиба в центре полосы, со сдвигом от её центра, — и фаза даёт
 * высоту линии в центральном столбце.
 *
 * Найденная линия переводится в координату вдоль линий разлиновки листа, а шаг
 * растра — в шаг этой координаты делением на местный масштаб шага: так
 * гребёнка растра переносится от полосы замера к любой строке, хотя на листе с
 * перспективой шаг у строки другой. Линия строки — та, чья координата ближе к
 * координате строки на прямой гребёнке блока, по которой строку разложили; её
 * высота у строки — `Y(x, U) + d`.
 *
 * Базовая линия, нарисованная геометрией отрисовки, и низ чернил, найденный у
 * неё, обязаны лечь на эту высоту; отклонение считается в долях местного шага
 * растра у строки.
 *
 * @param probe — проба страницы: лист и его разлиновка
 * @param raster — растр страницы
 * @param band — полоса без чернил под текстом
 * @param strip — полоса столбцов
 * @param period — шаг линий на растре
 * @param params — параметры, которыми нарисован растр
 * @returns отклонения базовых линий и чернил
 */
const measureStripFit = (
  probe: RasterProbe,
  raster: PageRaster,
  band: RasterBand,
  strip: RasterStrip,
  period: number,
  params: PageRenderParams
): StripFit => {
  const { sheet, pageIndex } = probe;
  const ruling = getPageRuling(sheet, pageIndex);
  const { geometry } = params;
  const { fontSizePx, lineSpacing, fontMetrics, blockRotate } = geometry;
  const { center } = strip;
  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const bandMiddle = (band.top + band.bottom) / 2;
  const blockProjection = { skewAngle: blockRotate, perspective: null };
  const bandBend = sampleBend(ruling.bend, ruling, center, bandMiddle);
  const bendSlope = ruling.bend
    ? sampleRulingBendSlope(ruling.bend, ruling, center, bandMiddle)
    : 0;
  const bandLine = lineCoordinateAt(ruling, center, bandMiddle - bandBend);
  const tangent = lineHeightSlopeAt(ruling, bandLine) + bendSlope;
  const lineBand: RasterBand = { ...band, left: strip.left, right: strip.right };
  const profile = buildProfile(raster, lineBand, tangent, center);
  const phase = measurePhase(buildDarkness(profile.values), period);
  const firstLine = band.top + profile.origin + phase;
  const firstLineU = lineCoordinateAt(ruling, center, firstLine - bandBend);
  const periodU = period / lineHeightScaleAt(ruling, center, firstLineU);
  const baselines = buildBaselines(params, center);
  const inkTop = Math.max(0, Math.floor((baselines[0] || 0) - 2 * lineStep));
  const inkBand: RasterBand = { ...lineBand, top: inkTop, bottom: band.top };
  const ink = buildInkProfile(raster, inkBand, tangent, center).values;
  let drift = 0;

  const inkOffsets = baselines.map((baseline) => {
    const rowU = lineCoordinateAt(blockProjection, center, baseline);
    const targetU = firstLineU + Math.round((rowU - firstLineU) / periodU) * periodU;
    const lineY = lineHeightAt(ruling, center, targetU);
    const target = lineY + sampleBend(ruling.bend, ruling, center, lineY);
    const localPeriod = periodU * lineHeightScaleAt(ruling, center, targetU);
    const drawn = placeOnLine(geometry, center, baseline);
    const bottom = measureInkBottom(ink, drawn - inkTop, lineStep);

    drift = Math.max(drift, Math.abs(drawn - target) / localPeriod);

    return bottom === null ? null : Math.abs(inkTop + bottom - target) / localPeriod;
  });

  return { drift, inkOffsets };
};

/**
 * Полоса без чернил внутри фотографии: ниже последней строки и выше нижнего
 * края листа. Столбцы берутся из середины фотографии — там нет линии поля.
 *
 * @param probe — проба страницы
 * @returns участок для замера; `null` — полосы не осталось
 */
const buildEmptyBand = (probe: RasterProbe): RasterBand | null => {
  const { params, sheet, pageIndex } = probe;
  const { background, geometry } = params;
  const { fontSizePx, lineSpacing, topOffset, fontMetrics, blockRotate } = geometry;

  if (!background) {
    return null;
  }

  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const radians = toRadians(blockRotate);
  const lastBaseline =
    topOffset +
    fontMetrics.fontAscent * fontSizePx +
    Math.max(0, params.page.lines.length - 1) * lineStep;
  const { bend } = getPageRuling(sheet, pageIndex);
  const bendDrop = bend
    ? bend.offsets.reduce((drop, offset) => {
        return Math.max(drop, offset);
      }, 0)
    : 0;

  /**
   * Полоса начинается под самой низкой точкой последней строки: блок повёрнут,
   * и у края кадра, куда строки опускаются, строка ниже, чем у другого края, а
   * изгиб опускает её ещё на свой наибольший отход вниз, — иначе в крайней
   * полосе замера под линиями оказались бы хвосты букв. Линия с перспективой
   * прямая, поэтому ниже всего строка у одного из краёв кадра.
   */
  const projection = { skewAngle: blockRotate, perspective: geometry.perspective };
  const lastLine = lastBaseline / Math.cos(radians);
  const lowest =
    Math.max(
      lineHeightAt(projection, 0, lastLine),
      lineHeightAt(projection, sheet.width, lastLine)
    ) + bendDrop;
  const top = Math.ceil(Math.max(0, lowest + lineStep));
  const limit = Math.floor(Math.min(sheet.height, background.height));
  const bottom = Math.min(limit, top + MAX_BAND_STEPS * sheet.ruling.step);
  const left = Math.round(background.width * BAND_LEFT_SHARE);
  const right = Math.round(background.width * BAND_RIGHT_SHARE);

  if (bottom - top < MIN_BAND_STEPS * sheet.ruling.step || right - left < 2) {
    return null;
  }

  return { left: Math.max(0, left), right: Math.min(sheet.width, right), top, bottom };
};

/**
 * Семейство шрифта страницы в варианте проверки.
 *
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 * @returns семейство шрифта страницы
 */
const resolveFontFamily = (customFontFamily: string | null): string => {
  return customFontFamily || DEFAULT_FONT;
};

/**
 * Ждёт страницу, нарисованную нужным экземпляром и нужным шрифтом.
 *
 * @param sheetId — ожидаемый экземпляр листа
 * @param pageIndex — ожидаемая страница
 * @param pageCount — ожидаемое число страниц раскладки; ноль — любое
 * @param fontFamily — ожидаемое семейство шрифта страницы
 * @returns проба страницы
 */
const waitForProbe = async (
  sheetId: string,
  pageIndex: number,
  pageCount = 0,
  fontFamily = DEFAULT_FONT
): Promise<RasterProbe> => {
  /**
   * Ожидание идёт по метрикам шрифта: пока начертание не загрузилось,
   * геометрия считается по запасным пропорциям, строк на странице выходит
   * другое число, и «полоса без чернил» оказывается под текстом.
   */
  const metrics = await loadFontMetrics(fontFamily);

  /**
   * Контуры доезжают отдельно от метрик. Встроенный шрифт без них рисовался
   * бы запасным путём, и проверка мерила бы не ту страницу, что уйдёт в
   * экспорт; у своего шрифта контуров нет вовсе.
   */
  const hasGlyphs = findFontUrl(fontFamily) !== null;

  /**
   * Эффект прежнего рендера может записать пробу уже после того, как стор
   * переставлен: у неё тот же лист и та же страница, но раскладка прежнего
   * текста.
   */
  const wordCount = countTextWords(useGeneratorStore.getState().text);

  await waitFor(
    async () => {
      await expect(lastProbe?.sheetId).toBe(sheetId);
      await expect(lastProbe?.layoutSheetId).toBe(sheetId);
      await expect(lastProbe?.wordCount).toBe(wordCount);
      await expect(lastProbe?.pageCount).toBe(pageCount || lastProbe?.pageCount);
      await expect(lastProbe?.pageIndex).toBe(pageIndex);
      await expect(lastProbe?.params.fontFamily).toBe(fontFamily);
      await expect(lastProbe?.params.geometry.fontMetrics.fontAscent).toBeCloseTo(
        metrics.fontAscent,
        6
      );
      await expect(lastProbe?.params.geometry.fontMetrics.lineHeight).toBeCloseTo(
        metrics.lineHeight,
        6
      );
      await expect(lastProbe?.params.page.lines.length || 0).toBeGreaterThan(1);
      await expect(Boolean(lastProbe?.params.glyphs)).toBe(hasGlyphs);
    },
    { timeout: 15_000 }
  );

  if (!lastProbe) {
    throw new Error('Проба не снялась: страница не собралась');
  }

  return lastProbe;
};

/**
 * Проверяет по растру нарисованной страницы, что разлиновка фотографии
 * совпадает с разлиновкой листа, а строки сидят на линиях от левого до
 * правого края блока.
 *
 * @param probe — проба страницы
 * @param image — фотография выбранного экземпляра
 */
const expectRasterOnRuling = async (
  probe: RasterProbe,
  image: RenderImage
): Promise<void> => {
  const { family, sheet } = probe;
  const band = buildEmptyBand(probe);

  if (!band) {
    throw new Error(`Полосы без чернил не осталось: ${probe.sheetId}`);
  }

  const raster = renderProbeRaster(probe, image);
  const ruling = measureRasterRuling(raster, band);

  /**
   * Гребёнка найдена: без этого нулевой сдвиг фазы прошёл бы проверку на
   * пустом месте.
   */
  await expect(ruling.contrast).toBeGreaterThan(MIN_CONTRAST);

  /**
   * Шаг разлиновки на растре — шаг разлиновки листа с местным масштабом
   * перспективы в полосе замера: страница равна кадру. Растяни отрисовка
   * фотографию, шаг ушёл бы на проценты, а строки — с линий.
   */
  const { geometry } = probe.params;
  const pageRuling = getPageRuling(sheet, probe.pageIndex);
  const bandX = (band.left + band.right) / 2;
  const bandLine = lineCoordinateAt(pageRuling, bandX, (band.top + band.bottom) / 2);
  const scale = lineHeightScaleAt(pageRuling, bandX, bandLine);
  const bandStep = sheet.ruling.step * scale;

  await expect(ruling.period).toBeGreaterThan(bandStep * (1 - PERIOD_TOLERANCE));
  await expect(ruling.period).toBeLessThan(bandStep * (1 + PERIOD_TOLERANCE));

  /**
   * Наклон линий на растре — наклон, под которым рендерер ставит строки в
   * полосе замера: наклон блока с перспективой геометрии. На отражённой
   * странице разлиновка вместе с листом переворачивается, и строки обязаны
   * наклониться в ту же сторону.
   */
  const blockProjection = {
    skewAngle: geometry.blockRotate,
    perspective: geometry.perspective,
  };
  const blockAngle =
    (Math.atan(lineHeightSlopeAt(blockProjection, bandLine)) * 180) / Math.PI;
  const rasterAngle = (Math.atan(ruling.tangent) * 180) / Math.PI;

  await expect(Math.abs(rasterAngle - blockAngle)).toBeLessThan(ANGLE_TOLERANCE);

  const rowSteps = family.kind === 'grid' ? GRID_ROW_STEPS : 1;
  const lineStep =
    geometry.fontSizePx * geometry.fontMetrics.lineHeight + geometry.lineSpacing;

  await expect((lineStep * scale) / ruling.period).toBeCloseTo(rowSteps, 1);

  /**
   * Строки сверяются с линиями в трёх узких полосах: на изогнутом листе
   * попадание в одном месте строки ничего не говорит о другом. Отклонение
   * базовых линий считается до ближайшей линии — на листе в клетку строка
   * занимает две клетки. Низ чернил сверяется вместе с базовыми линиями: без
   * этого проверка говорила бы только о разлиновке, а текст мог бы уехать сам
   * по себе.
   */
  const strips = buildStrips(probe);

  for (const strip of [strips.left, strips.middle, strips.right]) {
    const fit = measureStripFit(probe, raster, band, strip, ruling.period, probe.params);

    await expect(fit.drift).toBeLessThanOrEqual(DRIFT_TOLERANCE);
    await expect(fit.inkOffsets).not.toContain(null);
    await expect(measureWorstOffset(fit.inkOffsets)).toBeLessThanOrEqual(INK_TOLERANCE);
  }
};

/**
 * Левый и правый края в координатах наклонного блока.
 */
type PaperBounds = {
  /**
   * Левый край в пикселях кадра.
   */
  left: number;

  /**
   * Правый край в пикселях кадра.
   */
  right: number;
};

/**
 * Чернила страницы в координатах наклонного блока.
 */
type InkExtent = {
  /**
   * Самый левый столбец чернил страницы в пикселях кадра; бесконечность —
   * чернил нет.
   */
  left: number;

  /**
   * Самый левый столбец чернил вне свеса первых букв строк в пикселях кадра;
   * бесконечность — все чернила внутри свеса.
   */
  bareLeft: number;

  /**
   * Самый правый столбец чернил страницы в пикселях кадра.
   */
  right: number;

  /**
   * Есть ли чернила в верхнем ряду растра: там их срезал бы край кадра.
   */
  hasInkOnTopEdge: boolean;

  /**
   * Есть ли чернила в нижнем ряду растра: там их срезал бы край кадра.
   */
  hasInkOnBottomEdge: boolean;
};

/**
 * Габарит первой буквы строки, свешенной левее пера, в координатах наклонного
 * блока.
 */
type OverhangBox = {
  /**
   * Левый край буквы в пикселях кадра.
   */
  left: number;

  /**
   * Верх буквы в пикселях кадра.
   */
  top: number;

  /**
   * Низ буквы в пикселях кадра.
   */
  bottom: number;
};

/**
 * Габарит буквы относительно пера и базовой линии.
 */
type LetterExtent = {
  /**
   * Левый край буквы относительно пера в пикселях кадра; отрицательный —
   * буква свешена левее пера.
   */
  left: number;

  /**
   * Подъём буквы над базовой линией в пикселях кадра.
   */
  ascent: number;

  /**
   * Спуск буквы под базовую линию в пикселях кадра.
   */
  descent: number;
};

/**
 * Верх строчного бокса первой строки и низ бокса последней на странице.
 */
type LineBoxEdges = {
  /**
   * Самая высокая точка верха бокса первой строки в пикселях страницы.
   */
  top: number;

  /**
   * Самая низкая точка низа бокса последней строки в пикселях страницы.
   */
  bottom: number;
};

/**
 * Лежит ли точка внутри свеса первой буквы какой-нибудь строки. Правый край
 * габарита не нужен: правее пера чернила и так на бумаге.
 *
 * @param boxes — габариты свешенных первых букв
 * @param across — координата поперёк строк
 * @param along — координата вдоль строк
 * @returns `true` — точка принадлежит свесу
 */
const isInsideOverhang = (
  boxes: OverhangBox[],
  across: number,
  along: number
): boolean => {
  return boxes.some((box) => {
    return (
      across >= box.left - RASTER_TOLERANCE &&
      along >= box.top - RASTER_TOLERANCE &&
      along <= box.bottom + RASTER_TOLERANCE
    );
  });
};

/**
 * Чернила страницы в координатах наклонного блока. Пиксель поворачивается на
 * наклон блока в обратную сторону: блок повёрнут вокруг угла кадра, и в
 * повёрнутых координатах поля и линия поля листа стоят отвесно, а строки
 * лежат горизонтально.
 *
 * К строке пиксель не приписывается: на линейке строчный бокс выше шага строк,
 * и хвост первой буквы одной строки лежит в боксе следующей. Вместо этого
 * отдельно считается левый край чернил вне габаритов свешенных первых букв.
 *
 * @param raster — растр страницы
 * @param params — параметры отрисовки страницы
 * @param boxes — габариты первых букв строк, свешенных левее пера
 * @returns края чернил и срезы сверху и снизу
 */
const measureInkExtent = (
  raster: PageRaster,
  params: PageRenderParams,
  boxes: OverhangBox[]
): InkExtent => {
  const { geometry, scale } = params;
  const radians = toRadians(geometry.blockRotate);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const lastRow = raster.height - 1;
  let left = Number.POSITIVE_INFINITY;
  let bareLeft = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let hasInkOnTopEdge = false;
  let hasInkOnBottomEdge = false;

  for (let y = 0; y < raster.height; y += 1) {
    const row = y * raster.width;
    const centerY = (y + 0.5) / scale;

    for (let x = 0; x < raster.width; x += 1) {
      if ((raster.luminance[row + x] || 0) < INK_LEVEL) {
        const centerX = (x + 0.5) / scale;
        const across = centerX * cos + centerY * sin;
        const along = centerY * cos - centerX * sin;

        left = Math.min(left, across);
        right = Math.max(right, across);
        hasInkOnTopEdge = hasInkOnTopEdge || y === 0;
        hasInkOnBottomEdge = hasInkOnBottomEdge || y === lastRow;

        if (across < bareLeft && !isInsideOverhang(boxes, across, along)) {
          bareLeft = across;
        }
      }
    }
  }

  return { left, bareLeft, right, hasInkOnTopEdge, hasInkOnBottomEdge };
};

/**
 * Края, за которые текст на странице выходить не должен: поля листа, сужённые
 * линией поля с её стороны на зазор.
 *
 * @param probe — проба страницы
 * @returns левый и правый края в пикселях кадра
 */
const resolvePaperBounds = (probe: RasterProbe): PaperBounds => {
  const { sheet, pageIndex } = probe;
  const { step, margins, marginLineX, marginLineSide } = getPageRuling(sheet, pageIndex);
  const gap = step * MARGIN_LINE_GAP_SHARE;
  const left = margins.left;
  const right = sheet.width - margins.right;

  if (marginLineX === null) {
    return { left, right };
  }

  switch (marginLineSide) {
    case 'left': {
      return { left: Math.max(left, marginLineX + gap), right };
    }

    case 'right': {
      return { left, right: Math.min(right, marginLineX - gap) };
    }

    default: {
      return { left, right };
    }
  }
};

/**
 * Габарит буквы по контурам шрифта — тем, которыми её рисует рендерер.
 *
 * @param source — контуры шрифта страницы
 * @param char — буква
 * @param fontSizePx — кегль в пикселях кадра
 * @returns габарит; `null` — у буквы нет контура
 */
const measureContourExtent = (
  source: GlyphSource,
  char: string,
  fontSizePx: number
): LetterExtent | null => {
  const outline = source.getGlyph(char);

  if (!outline || outline.commands.length === 0) {
    return null;
  }

  const { minX, minY, maxY } = contourBounds(outline.commands);
  const unit = fontSizePx / source.unitsPerEm;

  return { left: minX * unit, ascent: maxY * unit, descent: -minY * unit };
};

/**
 * Габарит буквы по метрикам начертания в браузере: у своего шрифта контуров
 * нет, и буква рисуется обычным текстом тем же начертанием.
 *
 * @param context — контекст с установленным шрифтом страницы
 * @param char — буква
 * @returns габарит
 */
const measureTextExtent = (
  context: CanvasRenderingContext2D,
  char: string
): LetterExtent => {
  const metrics = context.measureText(char);

  return {
    left: -metrics.actualBoundingBoxLeft,
    ascent: metrics.actualBoundingBoxAscent,
    descent: metrics.actualBoundingBoxDescent,
  };
};

/**
 * Контекст для замера букв шрифтом страницы.
 *
 * @param fontSizePx — кегль в пикселях кадра
 * @param fontFamily — семейство шрифта страницы
 * @returns контекст с установленным шрифтом
 */
const createMeasureContext = (
  fontSizePx: number,
  fontFamily: string
): CanvasRenderingContext2D => {
  const context = document.createElement('canvas').getContext('2d');

  if (!context) {
    throw new Error('Браузер не дал контекст canvas');
  }

  context.font = `${fontSizePx}px "${fontFamily}"`;

  return context;
};

/**
 * Габариты первых букв строк, которые рисунок шрифта свешивает левее пера.
 * Рукописный шрифт рисует часть букв с хвостом влево от точки, куда их ставит
 * перо: у «д» в шрифте по умолчанию хвост уходит на 0.156 em. Строка при этом
 * начинается на краю блока, а чернила свешиваются за него — это рисунок
 * буквы, а не положение блока.
 *
 * Габарит берётся у каждой строки свой — по её первой букве, её базовой линии
 * и перу на краю блока, — и считается по самому шрифту, а не по растру: иначе
 * проверка мерила бы допуск тем же, что проверяет. Встроенный шрифт меряется
 * контурами, свой — метриками начертания. На изогнутом листе и листе с
 * перспективой буква встаёт на линию фотографии, и габарит сдвигается на тот
 * же сдвиг `Y + d − y`, что рендерер даёт точке пера.
 *
 * @param params — параметры отрисовки страницы
 * @returns габариты свешенных букв; строки без свеса в список не попадают
 */
const buildOverhangBoxes = (params: PageRenderParams): OverhangBox[] => {
  const { glyphs, page, geometry, fontFamily } = params;
  const { fontSizePx, lineSpacing, topOffset, leftPadding, fontMetrics } = geometry;
  const { blockRotate } = geometry;
  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const radians = toRadians(blockRotate);
  const context = glyphs ? null : createMeasureContext(fontSizePx, fontFamily);

  const measureLetter = (char: string): LetterExtent | null => {
    if (glyphs) {
      return measureContourExtent(glyphs.source, char, fontSizePx);
    }

    return context ? measureTextExtent(context, char) : null;
  };

  return page.lines.reduce<OverhangBox[]>((acc, line, index) => {
    const char = line.words[0]?.text[0] || '';
    const extent = char ? measureLetter(char) : null;

    if (!extent || extent.left >= 0) {
      return acc;
    }

    const baseline = topOffset + fontMetrics.fontAscent * fontSizePx + index * lineStep;
    const penX = leftPadding * Math.cos(radians) - baseline * Math.sin(radians);
    const penY = leftPadding * Math.sin(radians) + baseline * Math.cos(radians);
    const shift = placeOnLine(geometry, penX, penY) - penY;

    acc.push({
      left: leftPadding + extent.left,
      top: baseline - extent.ascent + shift,
      bottom: baseline + extent.descent + shift,
    });

    return acc;
  }, []);
};

/**
 * Верх строчного бокса первой строки и низ бокса последней в пикселях
 * страницы — по точкам строки от левого до правого края блока, с поворотом
 * блока, перспективой и изгибом строк.
 *
 * @param params — параметры отрисовки страницы
 * @returns крайние высоты боксов
 */
const measureLineBoxEdges = (params: PageRenderParams): LineBoxEdges => {
  const { geometry, page } = params;
  const { fontSizePx, lineSpacing, topOffset, fontMetrics } = geometry;
  const { leftPadding, blockWidth, blockRotate } = geometry;
  const lineStep = fontSizePx * fontMetrics.lineHeight + lineSpacing;
  const boxBottom =
    topOffset +
    Math.max(0, page.lines.length - 1) * lineStep +
    fontSizePx * fontMetrics.lineHeight;
  const radians = toRadians(blockRotate);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (let point = 0; point < BOX_POINT_COUNT; point += 1) {
    const along = leftPadding + (blockWidth * point) / (BOX_POINT_COUNT - 1);
    const topX = along * cos - topOffset * sin;
    const topY = along * sin + topOffset * cos;
    const bottomX = along * cos - boxBottom * sin;
    const bottomY = along * sin + boxBottom * cos;

    top = Math.min(top, placeOnLine(geometry, topX, topY));
    bottom = Math.max(bottom, placeOnLine(geometry, bottomX, bottomY));
  }

  return { top, bottom };
};

/**
 * Проверяет по растру нарисованной страницы, что текст на всю ширину не
 * выходит ни за левое поле, ни за правое поле или линию поля листа страницы,
 * ни за верхний и нижний края кадра.
 *
 * Справа граница строгая: правый край самой длинной строки не заходит ни за
 * поле, ни за зазор до линии поля. Слева граница — край блока, с которого
 * начинаются строки: левее него допускаются только чернила внутри габарита
 * первой буквы той строки, которую рисунок шрифта свешивает за перо. Общий
 * свес на всю страницу пропустил бы строку без свеса, уехавшую влево.
 *
 * Сверху и снизу строчные боксы первой и последней строк по метрикам
 * настоящего шрифта лежат в кадре по всей длине строки — с поворотом блока и
 * изгибом, — и край кадра не срезал ни одного пикселя чернил.
 *
 * Фон скрыт: линия поля на фотографии темнее порога чернил и сошла бы за
 * текст, а размер и геометрия страницы от фона не зависят.
 *
 * @param probe — проба страницы
 */
const expectTextOnPaper = async (probe: RasterProbe): Promise<void> => {
  const { sheet, params, pageIndex } = probe;
  const raster = rasterizePage(sheet, { ...params, background: null });
  const ink = measureInkExtent(raster, params, buildOverhangBoxes(params));
  const bounds = resolvePaperBounds(probe);
  const box = measureLineBoxEdges(params);
  const fill = FILL_TOLERANCE_STEPS * getPageRuling(sheet, pageIndex).step;

  if (!Number.isFinite(ink.left) || !Number.isFinite(ink.right)) {
    throw new Error(`На странице нет чернил: ${probe.sheetId}, ${pageIndex}`);
  }

  await expect(box.top).toBeGreaterThanOrEqual(0);
  await expect(box.bottom).toBeLessThanOrEqual(sheet.height);
  await expect(ink.hasInkOnTopEdge).toBe(false);
  await expect(ink.hasInkOnBottomEdge).toBe(false);
  await expect(ink.bareLeft).toBeGreaterThanOrEqual(bounds.left - RASTER_TOLERANCE);
  await expect(ink.right).toBeLessThanOrEqual(bounds.right + RASTER_TOLERANCE);

  /**
   * Текст и правда во всю ширину: иначе край, до которого чернила не
   * добрались, проверку прошёл бы сам собой.
   */
  await expect(ink.left).toBeLessThanOrEqual(bounds.left + fill);
  await expect(ink.right).toBeGreaterThanOrEqual(bounds.right - fill);
};

/**
 * Ставит стор на известный лист, половину разворота и шрифт.
 *
 * Искажения почерка выключены: они двигают слова и строки нарочно, а проверке
 * нужна сама раскладка.
 *
 * @param families — предустановленные семьи с измерениями
 * @param familyId — семья листов
 * @param sheetId — экземпляр листа
 * @param pageIndex — номер страницы, считая с нуля
 * @param text — текст генератора
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 */
const applySheet = (
  families: PaperFamily[],
  familyId: string,
  sheetId: string,
  pageIndex: number,
  text: string,
  customFontFamily: string | null = null
): void => {
  lastProbe = null;
  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: families,
    text,
    familyId,
    sheetId,
    isSheetPinned: true,
    pageIndex,
    customFontFamily,
  });
  /**
   * Ровное письмо: попадание на линии проверяется по базовым линиям, а
   * искажения почерка сдвигали бы буквы с них.
   */
  useGeneratorStore.getState().selectRealismLevel('even');
};

/**
 * Подключает файл встроенного шрифта своим шрифтом — тем же путём, что и
 * загрузка пользователем: через FontFace под общим именем своего шрифта.
 * Кэш метрик сбрасывается: семейство своего шрифта одно на любой файл.
 */
const loadCustomFont = async (): Promise<void> => {
  const url = findFontUrl(DEFAULT_FONT);

  if (!url) {
    throw new Error(`Файл шрифта не нашёлся: ${DEFAULT_FONT}`);
  }

  const response = await fetch(url);
  const face = new FontFace(CUSTOM_FONT_FAMILY, await response.arrayBuffer());

  await face.load();
  document.fonts.add(face);
  clearFontMetricsCache();
};

/**
 * Готовит шрифт варианта проверки. Свой шрифт подключается один раз на
 * прогон, и контуров для него генератор не находит.
 *
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 */
const prepareFont = async (customFontFamily: string | null): Promise<void> => {
  if (!customFontFamily) {
    return;
  }

  customFontTask = customFontTask || loadCustomFont();

  await customFontTask;
  await expect(findFontUrl(customFontFamily)).toBeNull();
};

/**
 * Число слов в строках.
 *
 * @param lines — строки страницы
 * @returns число слов
 */
const countWords = (lines: PageRenderParams['page']['lines']): number => {
  return lines.reduce((count, line) => {
    return count + line.words.length;
  }, 0);
};

/**
 * Текст, при котором проверяемая страница существует, набрана строками почти
 * до правого края блока, а снизу у неё остаётся полоса без чернил.
 *
 * Берётся начало абзаца на всю ширину: столько слов, сколько легло на
 * страницы до проверяемой и на первые строки её самой. Строки переносятся по
 * словам, поэтому начало абзаца раскладывается теми же строками, а последняя
 * строка кончается там же, где кончалась в полном абзаце, — у края блока.
 *
 * @param families — предустановленные семьи с измерениями
 * @param familyId — семья листов
 * @param sheetId — экземпляр листа
 * @param pageIndex — номер проверяемой страницы, считая с нуля
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 * @returns текст генератора
 */
const resolvePageText = async (
  families: PaperFamily[],
  familyId: string,
  sheetId: string,
  pageIndex: number,
  customFontFamily: string | null
): Promise<string> => {
  let wordCount = 0;

  for (let index = 0; index <= pageIndex; index += 1) {
    applySheet(families, familyId, sheetId, index, WIDE_TEXT, customFontFamily);

    const { params } = await waitForProbe(
      sheetId,
      index,
      0,
      resolveFontFamily(customFontFamily)
    );
    const { lines } = params.page;

    wordCount += countWords(
      index === pageIndex ? lines.slice(0, CHECKED_ROW_COUNT) : lines
    );
  }

  return WIDE_WORDS.slice(0, wordCount).join(' ');
};

/**
 * Проверяет по растру одну страницу экземпляра: набирает текст, ждёт
 * страницу и сверяет её с линиями фотографии.
 *
 * @param families — семьи листов стора
 * @param familyId — семья листов
 * @param sheet — экземпляр листа
 * @param pageIndex — номер страницы: чётная по счёту пользователя отражается
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 * @returns проверенная страница и её фотография
 */
const checkSheetRaster = async (
  families: PaperFamily[],
  familyId: string,
  sheet: PaperSheet,
  pageIndex: number,
  customFontFamily: string | null
): Promise<RasterCheck> => {
  const photo = await loadRenderImage(sheet.src);
  const image =
    pageIndex % 2 === 1 ? mirrorRenderImage(photo, sheet.width, sheet.height) : photo;
  const text = await resolvePageText(
    families,
    familyId,
    sheet.id,
    pageIndex,
    customFontFamily
  );

  applySheet(families, familyId, sheet.id, pageIndex, text, customFontFamily);

  /**
   * Проверяемая страница — последняя в раскладке: под её строками и остаётся
   * полоса для замера разлиновки.
   */
  const probe = await waitForProbe(
    sheet.id,
    pageIndex,
    pageIndex + 1,
    resolveFontFamily(customFontFamily)
  );

  await expectRasterOnRuling(probe, image);

  return { probe, image };
};

/**
 * Прогоняет проверку по всем экземплярам семьи на одной половине разворота.
 *
 * @param familyId — семья листов
 * @param pageIndex — номер страницы: чётная по счёту пользователя отражается
 */
const checkFamily = async (familyId: string, pageIndex: number): Promise<void> => {
  const families = await loadPaperFamilies();
  const family = families.find((item) => {
    return item.id === familyId;
  });

  if (!family) {
    throw new Error(`Семья не нашлась: ${familyId}`);
  }

  /**
   * Экземпляры обязаны быть измеренными — у листов без измерений разлиновка
   * одна на всю семью, и шаги не различались бы. Среди них обязан быть
   * наклонный лист, у которого наклон во всю ширину кадра сдвигает линию больше
   * чем на допуск: только на таком отражение, потерявшее поправку на наклон,
   * выводит строки с линий.
   */
  const steps = family.sheets.reduce<Set<number>>((acc, sheet) => {
    acc.add(sheet.ruling.step);

    return acc;
  }, new Set<number>());
  const hasTiltedSheet = family.sheets.some((sheet) => {
    const { skewAngle, step } = sheet.ruling;
    const shift = Math.abs(Math.tan((skewAngle * Math.PI) / 180) * sheet.width);

    return shift > DRIFT_TOLERANCE * step;
  });

  await expect(steps.size).toBe(family.sheets.length);
  await expect(hasTiltedSheet).toBe(true);

  for (const sheet of family.sheets) {
    await checkSheetRaster(families, familyId, sheet, pageIndex, null);
  }
};

/**
 * Прогоняет проверку полей на всех половинах разворота одного экземпляра.
 *
 * @param families — семьи листов стора
 * @param familyId — семья листов
 * @param sheetId — экземпляр листа
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 * @returns пробы проверенных страниц
 */
const checkSheetTextOnPaper = async (
  families: PaperFamily[],
  familyId: string,
  sheetId: string,
  customFontFamily: string | null
): Promise<RasterProbe[]> => {
  const probes: RasterProbe[] = [];

  for (const pageIndex of SPREAD_PAGES) {
    applySheet(families, familyId, sheetId, pageIndex, WIDE_TEXT, customFontFamily);

    const probe = await waitForProbe(
      sheetId,
      pageIndex,
      0,
      resolveFontFamily(customFontFamily)
    );

    /**
     * Страница не последняя в раскладке — значит, набрана до низа, а не
     * парой строк.
     */
    await expect(probe.pageCount).toBeGreaterThan(pageIndex + 1);
    await expectTextOnPaper(probe);

    probes.push(probe);
  }

  return probes;
};

/**
 * Прогоняет проверку полей по всем экземплярам семьи на обеих половинах
 * разворота.
 *
 * @param familyId — семья листов
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 */
const checkTextOnPaper = async (
  familyId: string,
  customFontFamily: string | null
): Promise<void> => {
  const families = await loadPaperFamilies();
  const family = families.find((item) => {
    return item.id === familyId;
  });

  if (!family) {
    throw new Error(`Семья не нашлась: ${familyId}`);
  }

  await prepareFont(customFontFamily);

  for (const sheet of family.sheets) {
    await checkSheetTextOnPaper(families, familyId, sheet.id, customFontFamily);
  }
};

/**
 * Отход линии изогнутого листа в столбце кадра: изгиб зависит только от
 * горизонтали, левее середины кадра линия опускается, правее — поднимается.
 *
 * @param x — столбец кадра
 * @returns отход вниз в пикселях; отрицательный — вверх
 */
const computeSheetBend = (x: number): number => {
  const half = BENT_SHEET_WIDTH / 2;
  const distance = Math.abs(x - half) / half;
  const ramp = (distance - BENT_FLAT_SHARE) / (1 - BENT_FLAT_SHARE - BENT_EDGE_SHARE);
  const share = Math.min(1, Math.max(0, ramp));
  const reach =
    BENT_REACH_SHARE * BENT_SHEET_STEP * (0.5 - 0.5 * Math.cos(Math.PI * share));

  return x < half ? reach : -reach;
};

/**
 * Рисует изогнутый лист в линейку.
 *
 * Хелперы синтетических листов из `tests/` в stories недоступны, а лист
 * должен пройти настоящий импорт: из растра, а не из готовой разлиновки.
 *
 * @returns канва с фотографией листа
 */
const drawBentSheet = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');

  canvas.width = BENT_SHEET_WIDTH;
  canvas.height = BENT_SHEET_HEIGHT;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Браузер не дал контекст canvas');
  }

  context.fillStyle = BENT_PAPER_COLOR;
  context.fillRect(0, 0, BENT_SHEET_WIDTH, BENT_SHEET_HEIGHT);
  context.strokeStyle = BENT_LINE_COLOR;
  context.lineWidth = BENT_LINE_WIDTH;

  const firstLineY = BENT_SHEET_PHASE + BENT_BLANK_STEPS * BENT_SHEET_STEP;
  const lastLineY = BENT_SHEET_HEIGHT - BENT_BLANK_STEPS * BENT_SHEET_STEP;

  for (let lineY = firstLineY; lineY <= lastLineY; lineY += BENT_SHEET_STEP) {
    context.beginPath();
    context.moveTo(0, lineY + computeSheetBend(0));

    for (let x = BENT_LINE_SEGMENT; x <= BENT_SHEET_WIDTH; x += BENT_LINE_SEGMENT) {
      context.lineTo(x, lineY + computeSheetBend(x));
    }

    context.stroke();
  }

  return canvas;
};

/**
 * Изогнутый лист, разобранный тем же путём, что и загруженная фотография:
 * сначала наклон, потом по нему разлиновка вместе с изгибом.
 *
 * @returns экземпляр листа с фотографией в data URL
 */
const createBentSheet = (): PaperSheet => {
  const canvas = drawBentSheet();
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Браузер не дал контекст canvas');
  }

  const { data } = context.getImageData(0, 0, BENT_SHEET_WIDTH, BENT_SHEET_HEIGHT);
  const image: SheetImageData = {
    width: BENT_SHEET_WIDTH,
    height: BENT_SHEET_HEIGHT,
    luminance: toLuminance(data, BENT_SHEET_WIDTH * BENT_SHEET_HEIGHT),
  };
  /**
   * Лист разбирается тем же вызовом, что и при импорте фотографии: наклон
   * детектор ищет сам.
   */
  const detection = detectRuling(image);

  if (!detection.isDetected) {
    throw new Error('Разлиновка изогнутого листа не нашлась');
  }

  return {
    id: BENT_SHEET_ID,
    label: 'Изогнутый лист',
    src: canvas.toDataURL('image/png'),
    width: BENT_SHEET_WIDTH,
    height: BENT_SHEET_HEIGHT,
    ruling: buildSheetRuling(detection, {
      width: BENT_SHEET_WIDTH,
      height: BENT_SHEET_HEIGHT,
    }),
    lighting: null,
    texture: null,
  };
};

/**
 * Изогнутый лист прогона.
 *
 * @returns экземпляр листа
 */
const resolveBentSheet = (): PaperSheet => {
  bentSheet = bentSheet || createBentSheet();

  return bentSheet;
};

/**
 * Семьи стора с синтетическим листом в семье линейки.
 *
 * @param families — предустановленные семьи
 * @param sheet — синтетический лист
 * @returns семьи с добавленным листом
 */
const withLinedSheet = (families: PaperFamily[], sheet: PaperSheet): PaperFamily[] => {
  return families.map((family) => {
    return family.id === LINED_FAMILY_ID
      ? { ...family, sheets: [...family.sheets, sheet] }
      : family;
  });
};

/**
 * Проверяет, что та же страница, нарисованная с другим изгибом или другой
 * перспективой строк, уводит низ чернил в обеих крайних полосах от линий
 * фотографии за допуск.
 *
 * @param probe — проба проверенной страницы
 * @param image — фотография листа страницы
 * @param band — полоса без чернил под текстом
 * @param lines — изгиб и перспектива, которыми строки встают на линии; `null`
 *   в поле — строки без изгиба или без перспективы
 */
const expectLineMismatch = async (
  probe: RasterProbe,
  image: RenderImage,
  band: RasterBand,
  lines: Pick<PageRenderParams['geometry'], 'bend' | 'perspective'>
): Promise<void> => {
  const strips = buildStrips(probe);
  const params: PageRenderParams = {
    ...probe.params,
    geometry: { ...probe.params.geometry, ...lines },
  };
  const raster = renderProbeRaster(probe, image, params);
  const { period } = measureRasterRuling(raster, band);

  for (const strip of [strips.left, strips.right]) {
    const fit = measureStripFit(probe, raster, band, strip, period, params);

    await expect(measureWorstOffset(fit.inkOffsets)).toBeGreaterThan(INK_TOLERANCE);
  }
};

/**
 * Проверяет строки на изогнутом листе на нечётной и зеркальной страницах.
 *
 * Изгиб найден на растре и заметен: в центрах крайних полос он не меньше
 * четверти шага. Отрицательных контролей два. Тот же лист, нарисованный
 * прямыми строками, уводит низ чернил в крайних полосах за допуск — иначе
 * проверка по полосам не отличала бы изогнутые строки от прямых. На
 * зеркальной странице то же даёт неотражённый изгиб экземпляра — иначе
 * проверка не отличала бы отражённый изгиб от потерянного.
 *
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 */
const checkBentRaster = async (customFontFamily: string | null): Promise<void> => {
  await prepareFont(customFontFamily);

  const sheet = resolveBentSheet();
  const families = withLinedSheet(await loadPaperFamilies(), sheet);

  for (const pageIndex of SPREAD_PAGES) {
    const { probe, image } = await checkSheetRaster(
      families,
      LINED_FAMILY_ID,
      sheet,
      pageIndex,
      customFontFamily
    );
    const ruling = getPageRuling(sheet, pageIndex);
    const band = buildEmptyBand(probe);

    if (!band) {
      throw new Error(`Полосы без чернил не осталось: ${sheet.id}, ${pageIndex}`);
    }

    await expect(probe.params.geometry.bend).not.toBeNull();

    const strips = buildStrips(probe);
    const bandMiddle = (band.top + band.bottom) / 2;

    for (const strip of [strips.left, strips.right]) {
      const bend = sampleBend(ruling.bend, ruling, strip.center, bandMiddle);

      await expect(Math.abs(bend) / ruling.step).toBeGreaterThanOrEqual(
        MIN_STRIP_BEND_SHARE
      );
    }

    await expectLineMismatch(probe, image, band, { bend: null, perspective: null });

    if (pageIndex % 2 === 1) {
      await expectLineMismatch(probe, image, band, {
        bend: sheet.ruling.bend,
        perspective: null,
      });
    }
  }
};

/**
 * Высота линии листа с перспективой в столбце кадра — своя запись формулы
 * перспективы для листа без наклона, а не вызов `lib/paper`: фотография обязана
 * сойтись с разлиновкой, а не повторить её расчёт.
 *
 * @param line — номер линии, считая от линии фазы
 * @param x — столбец кадра
 * @returns высота линии в пикселях кадра
 */
const computePerspectiveLineY = (line: number, x: number): number => {
  const { originX, originY, convergenceX, convergenceY } = SHEET_PERSPECTIVE;
  const offset = PERSPECTIVE_SHEET_PHASE + line * PERSPECTIVE_SHEET_STEP - originY;

  return (
    originY + (offset * (1 + convergenceX * (x - originX))) / (1 - offset * convergenceY)
  );
};

/**
 * Рисует лист в линейку с перспективой: линии во весь кадр, шаг растёт сверху
 * вниз, и линии расходятся по ширине.
 *
 * @returns канва с фотографией листа
 */
const drawPerspectiveSheet = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');

  canvas.width = PERSPECTIVE_SHEET_WIDTH;
  canvas.height = PERSPECTIVE_SHEET_HEIGHT;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Браузер не дал контекст canvas');
  }

  context.fillStyle = BENT_PAPER_COLOR;
  context.fillRect(0, 0, PERSPECTIVE_SHEET_WIDTH, PERSPECTIVE_SHEET_HEIGHT);
  context.strokeStyle = BENT_LINE_COLOR;
  context.lineWidth = BENT_LINE_WIDTH;

  for (
    let line = -1;
    computePerspectiveLineY(line, 0) < PERSPECTIVE_SHEET_HEIGHT;
    line += 1
  ) {
    context.beginPath();
    context.moveTo(0, computePerspectiveLineY(line, 0));
    context.lineTo(
      PERSPECTIVE_SHEET_WIDTH,
      computePerspectiveLineY(line, PERSPECTIVE_SHEET_WIDTH)
    );
    context.stroke();
  }

  return canvas;
};

/**
 * Лист с перспективой прогона. Разлиновка — литерал: у пресет-пака перспективы
 * нет, а поиск перспективы на фотографии проверяют юнит-тесты, и здесь ему
 * нечего добавить к проверке отрисовки. Поля — фолбэком от краёв кадра.
 *
 * @returns экземпляр листа
 */
const resolvePerspectiveSheet = (): PaperSheet => {
  perspectiveSheet = perspectiveSheet || {
    id: PERSPECTIVE_SHEET_ID,
    label: 'Лист с перспективой',
    src: drawPerspectiveSheet().toDataURL('image/png'),
    width: PERSPECTIVE_SHEET_WIDTH,
    height: PERSPECTIVE_SHEET_HEIGHT,
    ruling: buildSheetRuling(
      {
        step: PERSPECTIVE_SHEET_STEP,
        firstLinePhase: PERSPECTIVE_SHEET_PHASE,
        skewAngle: 0,
        perspective: SHEET_PERSPECTIVE,
      },
      { width: PERSPECTIVE_SHEET_WIDTH, height: PERSPECTIVE_SHEET_HEIGHT }
    ),
    lighting: null,
    texture: null,
  };

  return perspectiveSheet;
};

/**
 * Проверяет строки на листе с перспективой на нечётной и зеркальной страницах.
 *
 * Отрицательный контроль — та же страница, нарисованная без перспективы: низ
 * чернил в крайних полосах уходит от линий фотографии за допуск, иначе
 * проверка не отличала бы строки на перспективе от строк на прямой гребёнке.
 *
 * @param customFontFamily — свой шрифт; `null` — встроенный шрифт проверки
 */
const checkPerspectiveRaster = async (customFontFamily: string | null): Promise<void> => {
  await prepareFont(customFontFamily);

  const sheet = resolvePerspectiveSheet();
  const families = withLinedSheet(await loadPaperFamilies(), sheet);

  for (const pageIndex of SPREAD_PAGES) {
    const { probe, image } = await checkSheetRaster(
      families,
      LINED_FAMILY_ID,
      sheet,
      pageIndex,
      customFontFamily
    );
    const band = buildEmptyBand(probe);

    if (!band) {
      throw new Error(`Полосы без чернил не осталось: ${sheet.id}, ${pageIndex}`);
    }

    await expect(probe.params.geometry.perspective).not.toBeNull();
    await expectLineMismatch(probe, image, band, {
      bend: probe.params.geometry.bend,
      perspective: null,
    });
  }
};

const meta = {
  component: RasterRulingProbe,
} satisfies Meta<typeof RasterRulingProbe>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Растр нечётной страницы в клетку: шаг и наклон линий на растре — разлиновка
 * листа, а строки сидят на линиях от левого до правого края блока — на всех
 * экземплярах семьи.
 */
export const GridRasterRuling: Story = {
  play: async () => {
    await checkFamily(GRID_FAMILY_ID, 0);
  },
};

/**
 * То же на чётной странице: лист отражён, разлиновка вместе с ним. Базовые
 * линии сверяются с линиями, найденными на растре отражённой фотографии, в том
 * числе на наклонном `grid-1`.
 */
export const MirroredGridRasterRuling: Story = {
  play: async () => {
    await checkFamily(GRID_FAMILY_ID, 1);
  },
};

/**
 * Растр нечётной страницы в линейку.
 */
export const LinedRasterRuling: Story = {
  play: async () => {
    await checkFamily(LINED_FAMILY_ID, 0);
  },
};

/**
 * Растр чётной страницы в линейку.
 */
export const MirroredLinedRasterRuling: Story = {
  play: async () => {
    await checkFamily(LINED_FAMILY_ID, 1);
  },
};

/**
 * Строки повторяют изгиб линий листа, найденный импортом на его растре, — от
 * левого до правого края блока, на нечётной и на зеркальной странице.
 */
export const BentRasterRuling: Story = {
  play: async () => {
    await checkBentRaster(null);
  },
};

/**
 * Свой шрифт повторяет изгиб: буквы без контуров садятся на изогнутую линию
 * так же, как контуры встроенного шрифта.
 */
export const CustomFontBentRasterRuling: Story = {
  play: async () => {
    await checkBentRaster(CUSTOM_FONT_FAMILY);
  },
};

/**
 * Текст на всю ширину остаётся на бумаге: на растре нечётной и зеркальной
 * страниц чернила не выходят за поля, линию поля и края кадра — на всех
 * экземплярах клетки.
 */
export const GridTextStaysOnPaper: Story = {
  play: async () => {
    await checkTextOnPaper(GRID_FAMILY_ID, null);
  },
};

/**
 * То же на всех экземплярах линейки.
 */
export const LinedTextStaysOnPaper: Story = {
  play: async () => {
    await checkTextOnPaper(LINED_FAMILY_ID, null);
  },
};

/**
 * То же своим шрифтом на экземплярах клетки: свес букв без контуров берётся
 * из метрик начертания.
 */
export const GridCustomFontStaysOnPaper: Story = {
  play: async () => {
    await checkTextOnPaper(GRID_FAMILY_ID, CUSTOM_FONT_FAMILY);
  },
};

/**
 * То же своим шрифтом на экземплярах линейки.
 */
export const LinedCustomFontStaysOnPaper: Story = {
  play: async () => {
    await checkTextOnPaper(LINED_FAMILY_ID, CUSTOM_FONT_FAMILY);
  },
};

/**
 * Текст остаётся на бумаге на изогнутом листе: строки опускаются вслед за
 * линиями, а боксы и чернила не уходят за края кадра — встроенным и своим
 * шрифтом.
 */
export const BentTextStaysOnPaper: Story = {
  play: async () => {
    const sheet = resolveBentSheet();
    const families = withLinedSheet(await loadPaperFamilies(), sheet);

    for (const customFontFamily of FONT_VARIANTS) {
      await prepareFont(customFontFamily);

      const probes = await checkSheetTextOnPaper(
        families,
        LINED_FAMILY_ID,
        sheet.id,
        customFontFamily
      );

      for (const probe of probes) {
        await expect(probe.params.geometry.bend).not.toBeNull();
      }
    }
  },
};

/**
 * Строки следуют перспективе линий листа от левого до правого края блока — на
 * нечётной и на зеркальной странице, — а те же строки без перспективы уходят с
 * линий за допуск.
 */
export const PerspectiveRasterRuling: Story = {
  play: async () => {
    await checkPerspectiveRaster(null);
  },
};

/**
 * Свой шрифт следует перспективе: буквы без контуров садятся на линию так же,
 * как контуры встроенного шрифта.
 */
export const CustomFontPerspectiveRasterRuling: Story = {
  play: async () => {
    await checkPerspectiveRaster(CUSTOM_FONT_FAMILY);
  },
};

/**
 * Текст остаётся на бумаге на листе с перспективой: строки встают на линии
 * фотографии, а боксы и чернила не уходят за поля и края кадра — встроенным и
 * своим шрифтом.
 */
export const PerspectiveTextStaysOnPaper: Story = {
  play: async () => {
    const sheet = resolvePerspectiveSheet();
    const families = withLinedSheet(await loadPaperFamilies(), sheet);

    for (const customFontFamily of FONT_VARIANTS) {
      await prepareFont(customFontFamily);

      const probes = await checkSheetTextOnPaper(
        families,
        LINED_FAMILY_ID,
        sheet.id,
        customFontFamily
      );

      for (const probe of probes) {
        await expect(probe.params.geometry.perspective).not.toBeNull();
      }
    }
  },
};
