import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FC } from 'react';
import { useEffect } from 'react';
import { expect, waitFor } from 'storybook/test';

import { GRID_FAMILY_ID, HANDWRITING_FONTS, LINED_FAMILY_ID } from '../../../config';
import { loadFontMetrics } from '../../../lib/measure/measureFontMetrics';
import type {
  PaperFamily,
  PaperSheet,
  RulingBend,
  RulingPerspective,
} from '../../../lib/paper';
import { lineCoordinateAt, lineHeightAt, sampleRulingBend } from '../../../lib/paper';
import { clearLayoutCache } from '../../../model/measureLayout';
import { loadPaperFamilies } from '../../../model/paperProfiles';
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
 * Снимок того, как страница легла на лист. Числа сняты с тех самых параметров,
 * которыми рендерер рисует страницу, и с разлиновки листа этой страницы, —
 * считать попадание по чему-то другому значило бы проверять не то, что видно.
 */
type BaselineProbe = {
  /**
   * Экземпляр листа, доставшийся странице.
   */
  sheetId: string;

  /**
   * Лист, под который разложена показанная страница. Раскладка под новый лист
   * пересчитывается асинхронно и до того отстаёт от листа страницы.
   */
  layoutSheetId: string;

  /**
   * Номер показанной страницы, считая с нуля.
   */
  pageIndex: number;

  /**
   * Семейство шрифта страницы.
   */
  fontFamily: string;

  /**
   * Кегль в пикселях кадра листа.
   */
  fontSizePx: number;

  /**
   * Добавка к естественной высоте строки в пикселях кадра листа.
   */
  lineSpacing: number;

  /**
   * Отступ верха первой строки от верха страницы до поворота блока.
   */
  topOffset: number;

  /**
   * Отступ левого края блока от левого края страницы до поворота блока.
   */
  leftPadding: number;

  /**
   * Ширина блока текста в пикселях кадра листа.
   */
  blockWidth: number;

  /**
   * Угол наклона блока в градусах. Блок поворачивается вокруг левого верхнего
   * угла страницы.
   */
  blockRotate: number;

  /**
   * Изгиб, по которому рендерер гнёт строки страницы.
   */
  bend: RulingBend | null;

  /**
   * Перспектива, по которой рендерер ставит строки на линии страницы.
   */
  perspective: RulingPerspective | null;

  /**
   * Подъём строчного бокса над базовой линией в долях кегля.
   */
  fontAscent: number;

  /**
   * Естественная высота строчного бокса в долях кегля.
   */
  lineHeight: number;

  /**
   * Шаг разлиновки листа страницы в пикселях кадра.
   */
  step: number;

  /**
   * Высота одной из линий разлиновки страницы у левого края кадра.
   */
  firstLinePhase: number;

  /**
   * Наклон разлиновки страницы в градусах; на чётной странице — отражённый.
   */
  skewAngle: number;

  /**
   * Изгиб линий разлиновки страницы; на чётной странице — отражённый.
   */
  rulingBend: RulingBend | null;

  /**
   * Перспектива разлиновки страницы; на чётной странице — отражённая.
   */
  rulingPerspective: RulingPerspective | null;

  /**
   * Число строк на показанной странице.
   */
  lineCount: number;

  /**
   * Ширина страницы в пикселях.
   */
  pageWidth: number;

  /**
   * Высота страницы в пикселях.
   */
  pageHeight: number;
};

/**
 * Последнее измерение пробы. Передаётся не через DOM: числа с плавающей точкой
 * пришлось бы печатать в разметку и разбирать обратно, а проверке нужны те же
 * значения, что ушли в рендерер.
 */
let lastProbe: BaselineProbe | null = null;

/**
 * Текст на много строк: попадание на одной строке ничего не значит —
 * расхождение шага строк с шагом разлиновки копится и видно только к концу
 * страницы. Длины хватает и на семью в клетку, где строка занимает две клетки.
 */
const LONG_TEXT = [
  'Рукописный текст ложится на разлиновку тетрадного листа строка за строкой,',
  'и чем дальше от начала страницы, тем заметнее любое расхождение шага строк',
  'с шагом линий: к низу листа текст либо держится линий, либо уезжает от них',
  'на целую строку, и никакой подкрутки настроек это уже не спасает.',
  'Кегль, межстрочный интервал и верхний отступ блока никто не задаёт руками:',
  'их выводит автокалибровка из шага разлиновки листа и метрик выбранного',
  'шрифта, снятых в браузере на настоящем начертании, а не на подстановочном.',
  'Поэтому проверять попадание нужно именно в браузере и именно на нескольких',
  'шрифтах: у каждого своя высота строчных, свой подъём строчного бокса и своя',
  'естественная высота строки, и любая из этих величин способна увести текст',
  'с линий, если формулы расчёта и отрисовки разойдутся хотя бы в одном шаге.',
].join(' ');

/**
 * Текст на разворот: и на второй, отражённой, странице должно лечь не меньше
 * строк, чем нужно для проверки.
 */
const SPREAD_TEXT = [LONG_TEXT, LONG_TEXT, LONG_TEXT].join('\n');

/**
 * Допуск спеки: базовая линия строки отходит от линии разлиновки не больше
 * чем на пиксель фотографии.
 */
const PIXEL_TOLERANCE = 1;

/**
 * Допуск сравнения шага строк с шагом разлиновки: шаг строк складывается из
 * кегля и интервала, и равенство теряется в последнем знаке.
 */
const STEP_EPSILON = 1e-9;

/**
 * Сколько строк должно лечь на страницу, чтобы проверка что-то значила.
 */
const MIN_LINE_COUNT = 8;

/**
 * Сколько точек строки сверяется с линией: от левого до правого края блока
 * включительно. Изгиб линии меняется на ширине листа плавно, и девяти точек
 * хватает, чтобы не проскочить ни горб, ни прогиб.
 */
const DRIFT_POINT_COUNT = 9;

/**
 * Наибольший отход растянутого изгиба в долях шага: на шаге пресет-пака это
 * десятки пикселей, и строка без изгиба заметно уходит с линий за допуск.
 */
const AMPLIFIED_BEND_SHARE = 0.4;

/**
 * Узлы изгиба хранятся с точностью до сотой пикселя.
 */
const OFFSET_PRECISION = 100;

/**
 * Перспектива листа story: шаг у нижних линий на четыре процента больше, чем у
 * верхних, — как в сценарии требования, — а расстояние между линиями от левого
 * края кадра до правого меняется на процент. У пресет-пака перспективы нет,
 * поэтому она задаётся литералом.
 */
const PERSPECTIVE_STEP_GROWTH = 0.04;
const PERSPECTIVE_CONVERGENCE_SHARE = 0.01;

/**
 * Шрифты, на которых проверяется попадание. Первые из пресета: расхождение
 * метрик ловится уже на нескольких начертаниях, а прогонять все шестнадцать —
 * минуты в браузере на пустом месте.
 */
const CHECKED_FONTS = HANDWRITING_FONTS.slice(0, 5).map(({ family }) => {
  return family;
});

/**
 * Шрифт, с которым генератор открывается: на нём проверяются обе семьи.
 */
const DEFAULT_FONT = HANDWRITING_FONTS[0]?.family || '';

/**
 * Проба попадания базовых линий на разлиновку.
 *
 * Раскладку и отрисовку берёт теми же хуками, что и экран генератора: кегль,
 * межстрочный интервал и верхний отступ выведены автокалибровкой из
 * разлиновки листа и метрик шрифта, снятых живым измерителем браузера. В
 * jsdom такую проверку не поставить — там метрики шрифта взять неоткуда.
 */
const BaselineFitProbe: FC = () => {
  const pages = usePageLayout();
  const source = usePageRender(pages);
  const plan = useRunRender(pages);
  const { sheet, ruling } = usePageGeometry();
  const pageIndex = useGeneratorStore((state) => {
    return state.pageIndex;
  });
  const params = source ? source.buildParams(1) : null;
  const probe: BaselineProbe | null =
    source && params && sheet && ruling
      ? {
          sheetId: sheet.id,
          layoutSheetId: pages[pageIndex]?.sheetId || '',
          pageIndex,
          fontFamily: params.fontFamily,
          fontSizePx: params.geometry.fontSizePx,
          lineSpacing: params.geometry.lineSpacing,
          topOffset: params.geometry.topOffset,
          leftPadding: params.geometry.leftPadding,
          blockWidth: params.geometry.blockWidth,
          blockRotate: params.geometry.blockRotate,
          bend: params.geometry.bend,
          perspective: params.geometry.perspective,
          fontAscent: params.geometry.fontMetrics.fontAscent,
          lineHeight: params.geometry.fontMetrics.lineHeight,
          step: ruling.step,
          firstLinePhase: ruling.firstLinePhase,
          skewAngle: ruling.skewAngle,
          rulingBend: ruling.bend,
          rulingPerspective: ruling.perspective,
          lineCount: params.page.lines.length,
          pageWidth: source.pageWidth,
          pageHeight: source.pageHeight,
        }
      : null;

  /**
   * Без списка зависимостей: проба снимается на каждый рендер — метрики
   * шрифта и раскладка доезжают асинхронно, и важно последнее состояние.
   */
  useEffect(() => {
    lastProbe = probe;
  });

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="baseline-probe">
        {probe
          ? `${probe.fontFamily}: строк ${probe.lineCount}, кегль ${probe.fontSizePx.toFixed(2)}`
          : 'страница не собралась'}
      </p>

      <div className="flex flex-col" style={VIEWPORT_BOX}>
        <SheetViewport source={source} plan={plan} />
      </div>
    </div>
  );
};

/**
 * Шаг строк страницы в пикселях кадра: расстояние между базовыми линиями
 * соседних строк.
 *
 * @param probe — снимок параметров отрисовки
 * @returns шаг строк
 */
const measureLineStep = (probe: BaselineProbe): number => {
  const { fontSizePx, lineHeight, lineSpacing } = probe;

  return fontSizePx * lineHeight + lineSpacing;
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
 * Расстояние от точки страницы до ближайшей линии разлиновки листа в
 * пикселях фотографии, по вертикали.
 *
 * Линия k проходит через столбец x на высоте `Y(x, фаза + k × шаг)` плюс изгиб
 * линии в этом столбце: `Y` переводит координату вдоль линий в высоту на
 * фотографии с наклоном и перспективой листа. Изгиб читается в точке самой
 * линии, а не в сверяемой точке: у изогнутой разлиновки соседние линии изогнуты
 * по-разному. Кандидаты — ближайшая линия без изгиба и две соседние: изгиб до
 * половины шага может сделать ближайшей соседнюю.
 *
 * @param probe — снимок разлиновки страницы
 * @param x — столбец точки в пикселях страницы
 * @param y — высота точки в пикселях страницы
 * @returns расстояние в пикселях
 */
const measurePointDrift = (probe: BaselineProbe, x: number, y: number): number => {
  const { step, firstLinePhase, skewAngle, rulingBend, rulingPerspective } = probe;
  const projection = { skewAngle, perspective: rulingPerspective };
  const nearest = Math.round(
    (lineCoordinateAt(projection, x, y) - firstLinePhase) / step
  );
  let drift = Number.POSITIVE_INFINITY;

  for (let line = nearest - 1; line <= nearest + 1; line += 1) {
    const straightY = lineHeightAt(projection, x, firstLinePhase + line * step);
    const lineY =
      straightY +
      (rulingBend ? sampleRulingBend(rulingBend, projection, x, straightY) : 0);

    drift = Math.min(drift, Math.abs(y - lineY));
  }

  return drift;
};

/**
 * Наибольшее отклонение базовых линий страницы от линий разлиновки в пикселях
 * фотографии по точкам каждой строки от левого до правого края блока.
 *
 * Базовые линии считаются по модели рендерера: до поворота строка n стоит на
 * высоте `(topOffset + fontAscent × кегль + n × шаг строк) × cos θ` — модель
 * отсчитывает высоты вдоль линий, а в повёрнутой системе блока та же высота
 * короче в cos θ раз, — блок поворачивается
 * вокруг левого верхнего угла страницы, и точка P встаёт на высоту
 * `Y(P.x, U) + d` своей линии: `U = P.y − P.x × tg θ` — координата вдоль линий
 * прямой наклонной гребёнки, по которой строку разложили, `Y` переводит её в
 * высоту на фотографии по перспективе рендерера, а изгиб `d` читается в точке
 * линии. На листе в клетку строка занимает две клетки, и базовая линия садится
 * на каждую вторую линию, поэтому сверка идёт с ближайшей.
 *
 * @param probe — снимок параметров отрисовки и разлиновки
 * @param bend — изгиб, которым гнутся строки; не задан — изгиб рендерера,
 *   `null` — тот же расчёт для строк без изгиба
 * @param perspective — перспектива, по которой строки встают на линии; не
 *   задана — перспектива рендерера, `null` — тот же расчёт без перспективы
 * @returns отклонение в пикселях
 */
const measureBaselineDrift = (
  probe: BaselineProbe,
  bend: RulingBend | null = probe.bend,
  perspective: RulingPerspective | null = probe.perspective
): number => {
  const { topOffset, fontSizePx, fontAscent, blockRotate } = probe;
  const { leftPadding, blockWidth, lineCount } = probe;
  const lineStep = measureLineStep(probe);
  const radians = toRadians(blockRotate);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const tangent = Math.tan(radians);
  const projection = { skewAngle: blockRotate, perspective };
  let drift = 0;

  for (let index = 0; index < lineCount; index += 1) {
    const baseline = (topOffset + fontAscent * fontSizePx + index * lineStep) * cos;

    for (let point = 0; point < DRIFT_POINT_COUNT; point += 1) {
      const along = leftPadding + (blockWidth * point) / (DRIFT_POINT_COUNT - 1);
      const x = along * cos - baseline * sin;
      const y = along * sin + baseline * cos;
      const lineY = perspective ? lineHeightAt(projection, x, y - x * tangent) : y;
      const drawnY = lineY + (bend ? sampleRulingBend(bend, projection, x, lineY) : 0);

      drift = Math.max(drift, measurePointDrift(probe, x, drawnY));
    }
  }

  return drift;
};

/**
 * Ждёт, пока страница ляжет выбранным шрифтом на нужный лист, и отдаёт снятую
 * пробу.
 *
 * Ожидание идёт по метрикам: шрифт грузится и меряется асинхронно, и до
 * замера геометрия считается по запасным пропорциям — попадание на линиях
 * такой страницы ничего не сказало бы о самом шрифте. Метрики проба сверяет с
 * замером живого щупа: так видно, что в отрисовку ушли пропорции именно этого
 * начертания. Ждёт проба и раскладку под лист страницы: до пересчёта отрисовка
 * берёт геометрию прежнего листа, а разлиновку проба снимает уже с нового.
 *
 * @param fontFamily — ожидаемое семейство шрифта страницы
 * @param pageIndex — ожидаемая страница
 * @param sheetId — ожидаемый лист; не задан — любой
 * @returns проба, снятая на метриках этого шрифта
 */
const waitForProbe = async (
  fontFamily: string,
  pageIndex = 0,
  sheetId = ''
): Promise<BaselineProbe> => {
  const metrics = await loadFontMetrics(fontFamily);

  await waitFor(
    async () => {
      await expect(lastProbe?.fontFamily).toBe(fontFamily);
      await expect(lastProbe?.pageIndex).toBe(pageIndex);
      await expect(lastProbe?.sheetId).toBe(sheetId || lastProbe?.sheetId);
      await expect(lastProbe?.layoutSheetId).toBe(lastProbe?.sheetId);
      await expect(lastProbe?.fontAscent).toBeCloseTo(metrics.fontAscent, 6);
      await expect(lastProbe?.lineHeight).toBeCloseTo(metrics.lineHeight, 6);
      await expect(lastProbe?.lineCount || 0).toBeGreaterThanOrEqual(MIN_LINE_COUNT);
    },
    { timeout: 15_000 }
  );

  if (!lastProbe) {
    throw new Error('Проба не снялась: страница не собралась');
  }

  return lastProbe;
};

/**
 * Проверяет, что базовые линии сели на разлиновку листа страницы по всей
 * длине строк.
 *
 * @param probe — снятая проба
 */
const expectBaselinesOnRuling = async (probe: BaselineProbe): Promise<void> => {
  /**
   * Блок наклонён ровно на угол разлиновки страницы: при другом угле строка
   * расходилась бы с линией к правому краю, а изгиб читался бы рендерером не
   * в тех точках, где его измерили на фотографии.
   */
  await expect(probe.blockRotate).toBeCloseTo(probe.skewAngle, 9);

  /**
   * Строка занимает не меньше линии разлиновки: сойдись шаг строк в ноль,
   * строки легли бы одна на другую, а отклонение от линий всё равно вышло бы
   * нулевым — попадание проверяется вместе с тем, что строки расходятся.
   */
  await expect(measureLineStep(probe)).toBeGreaterThanOrEqual(
    probe.step * (1 - STEP_EPSILON)
  );
  await expect(measureBaselineDrift(probe)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
};

/**
 * Ставит стор в известное состояние и забывает прошлую пробу: семья листов —
 * из аргумента, всё остальное по умолчанию. Экземпляры без артефакта профилей
 * несут синтезированную разлиновку без наклона.
 *
 * @param familyId — семья листов
 */
const applyFamily = (familyId: string): void => {
  lastProbe = null;
  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    text: LONG_TEXT,
    familyId,
  });
  /**
   * Ровное письмо с вариативностью контуров: искажения почерка сдвигали бы
   * буквы с базовых линий, которые здесь и проверяются.
   */
  useGeneratorStore.getState().selectRealismLevel('even');
  useGeneratorStore.getState().setContourVariance(true);
};

/**
 * Ставит стор на закреплённый лист пресет-пака с измерениями и на заданную
 * половину разворота.
 *
 * @param families — предустановленные семьи с измерениями
 * @param familyId — семья листов
 * @param sheetId — экземпляр листа
 * @param pageIndex — номер страницы, считая с нуля
 */
const applySheet = (
  families: PaperFamily[],
  familyId: string,
  sheetId: string,
  pageIndex: number
): void => {
  lastProbe = null;
  clearLayoutCache();
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: families,
    text: SPREAD_TEXT,
    familyId,
    sheetId,
    isSheetPinned: true,
    pageIndex,
  });
  /**
   * Ровное письмо с вариативностью контуров: искажения почерка сдвигали бы
   * буквы с базовых линий, которые здесь и проверяются.
   */
  useGeneratorStore.getState().selectRealismLevel('even');
  useGeneratorStore.getState().setContourVariance(true);
};

/**
 * Сколько разных шагов разлиновки у экземпляров семьи. Экземпляры пресет-пака
 * сняты с разного расстояния, поэтому число меньше числа экземпляров значит,
 * что в дело пошли листы без измерений.
 *
 * @param family — семья листов
 * @returns число разных шагов
 */
const countDistinctSteps = (family: PaperFamily): number => {
  const steps = family.sheets.reduce<Set<number>>((acc, sheet) => {
    acc.add(sheet.ruling.step);

    return acc;
  }, new Set<number>());

  return steps.size;
};

/**
 * Наибольший отход линий листа от прямой в пикселях кадра.
 *
 * @param bend — изгиб линий листа
 * @returns наибольший отход по модулю
 */
const measureBendReach = (bend: RulingBend): number => {
  return bend.offsets.reduce((reach, offset) => {
    return Math.max(reach, Math.abs(offset));
  }, 0);
};

/**
 * Экземпляр пресет-пака вместе с семьёй, в которую он входит.
 */
type SheetInFamily = {
  /**
   * Семья экземпляра.
   */
  family: PaperFamily;

  /**
   * Сам экземпляр.
   */
  sheet: PaperSheet;
};

/**
 * Экземпляр пресет-пака с наибольшим отходом линий в долях шага вместе с его
 * семьёй.
 *
 * @param families — предустановленные семьи с измерениями
 * @returns семья и экземпляр; `null` — изогнутых экземпляров нет
 */
const findMostBentSheet = (families: PaperFamily[]): SheetInFamily | null => {
  let found: SheetInFamily | null = null;
  let bestShare = 0;

  for (const family of families) {
    for (const sheet of family.sheets) {
      const { bend, step } = sheet.ruling;
      const share = bend && step > 0 ? measureBendReach(bend) / step : 0;

      if (share > bestShare) {
        bestShare = share;
        found = { family, sheet };
      }
    }
  }

  return found;
};

/**
 * Тот же экземпляр с изгибом, растянутым до заданного отхода: форма изгиба
 * настоящая, с фотографии, а размах такой, что строка без изгиба уходит с
 * линий за допуск.
 *
 * @param sheet — изогнутый экземпляр пресет-пака
 * @returns экземпляр с растянутым изгибом
 */
const amplifySheetBend = (sheet: PaperSheet): PaperSheet => {
  const { bend, step } = sheet.ruling;

  if (!bend) {
    throw new Error(`У экземпляра нет изгиба: ${sheet.id}`);
  }

  const factor = (AMPLIFIED_BEND_SHARE * step) / measureBendReach(bend);

  return {
    ...sheet,
    ruling: {
      ...sheet.ruling,
      bend: {
        ...bend,
        offsets: bend.offsets.map((offset) => {
          return Math.round(offset * factor * OFFSET_PRECISION) / OFFSET_PRECISION;
        }),
      },
    },
  };
};

/**
 * Семьи, в которых экземпляр заменён другим с тем же идентификатором.
 *
 * @param families — предустановленные семьи
 * @param sheet — экземпляр на замену
 * @returns семьи с заменённым экземпляром
 */
const replaceSheet = (families: PaperFamily[], sheet: PaperSheet): PaperFamily[] => {
  return families.map((family) => {
    return {
      ...family,
      sheets: family.sheets.map((item) => {
        return item.id === sheet.id ? sheet : item;
      }),
    };
  });
};

/**
 * Тот же экземпляр с перспективой. Начало перспективы — середина кадра, и шаг
 * `Y'(U)` растёт от верха к низу как `1 / (1 − a·q)²`: на полувысоте кадра в
 * обе стороны это даёт `1 + 2·q·высота` между крайними линиями.
 *
 * @param sheet — экземпляр пресет-пака
 * @returns экземпляр с перспективой
 */
const addSheetPerspective = (sheet: PaperSheet): PaperSheet => {
  const { width, height } = sheet;

  return {
    ...sheet,
    ruling: {
      ...sheet.ruling,
      perspective: {
        originX: width / 2,
        originY: height / 2,
        convergenceX: PERSPECTIVE_CONVERGENCE_SHARE / width,
        convergenceY: PERSPECTIVE_STEP_GROWTH / (2 * height),
      },
    },
  };
};

const meta = {
  component: BaselineFitProbe,
  beforeEach: () => {
    applyFamily(LINED_FAMILY_ID);
  },
} satisfies Meta<typeof BaselineFitProbe>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LinedRuling: Story = {
  play: async () => {
    await expectBaselinesOnRuling(await waitForProbe(DEFAULT_FONT));
  },
};

export const GridRuling: Story = {
  beforeEach: () => {
    applyFamily(GRID_FAMILY_ID);
  },
  play: async () => {
    await expectBaselinesOnRuling(await waitForProbe(DEFAULT_FONT));
  },
};

/**
 * Смена встроенного шрифта не требует правки настроек: кегль и межстрочный
 * интервал выводятся из метрик нового начертания, и текст остаётся на линиях.
 */
export const FontSwitchKeepsRuling: Story = {
  play: async () => {
    const { setFontFamily } = useGeneratorStore.getState();

    for (const fontFamily of CHECKED_FONTS) {
      setFontFamily(fontFamily);

      await expectBaselinesOnRuling(await waitForProbe(fontFamily));
    }

    /**
     * Ни один слайдер геометрии не двигался: попадание держится расчётом, а
     * не поправкой пользователя.
     */
    await expect(useGeneratorStore.getState().geometryCorrection).toEqual(
      DEFAULT_GENERATOR_STATE.geometryCorrection
    );
  },
};

/**
 * Строки садятся на разлиновку настоящих фотографий пресет-пака — на каждом
 * экземпляре и на обеих половинах разворота, а страница равна кадру своего
 * листа.
 *
 * Экземпляры берутся из артефакта профилей: у каждого свой шаг, поля, наклон
 * и изгиб, и на чётной странице разлиновка отражена вместе с наклоном и
 * изгибом — на наклонных листах потерянная при отражении поправка вывела бы
 * строки за допуск.
 */
export const PhotoRulingOnSheet: Story = {
  play: async () => {
    const families = await loadPaperFamilies();

    for (const family of families) {
      await expect(countDistinctSteps(family)).toBe(family.sheets.length);

      for (const sheet of family.sheets) {
        for (const pageIndex of [0, 1]) {
          applySheet(families, family.id, sheet.id, pageIndex);

          const probe = await waitForProbe(DEFAULT_FONT, pageIndex, sheet.id);

          await expectBaselinesOnRuling(probe);
          await expect(probe.pageWidth).toBe(sheet.width);
          await expect(probe.pageHeight).toBe(sheet.height);
        }
      }
    }
  },
};

/**
 * Строки повторяют изгиб линий по всей длине — на нечётной и на зеркальной
 * странице, — а тот же расчёт для прямых строк уходит с линий за допуск.
 *
 * Отход изгиба у экземпляров пресет-пака не больше десятой шага, и
 * отрицательный контроль держался бы на считаных пикселях сверх допуска.
 * Поэтому берётся самый изогнутый экземпляр, а размах его изгиба
 * растягивается до четырёх десятых шага — форма линий остаётся снятой с
 * фотографии.
 *
 * Отражение изгиба эта арифметика не проверяет: изгиб рендерера и изгиб
 * разлиновки страницы берутся из одной отражённой разлиновки и совпадают и
 * при потерянном отражении. Его проверяет растр отражённой фотографии в
 * `RasterRuling.stories.tsx`.
 */
export const BentRulingOnSheet: Story = {
  play: async () => {
    const families = await loadPaperFamilies();
    const found = findMostBentSheet(families);

    if (!found) {
      throw new Error('В пресет-паке нет изогнутых экземпляров');
    }

    const { family, sheet } = found;
    const bentFamilies = replaceSheet(families, amplifySheetBend(sheet));

    for (const pageIndex of [0, 1]) {
      applySheet(bentFamilies, family.id, sheet.id, pageIndex);

      const probe = await waitForProbe(DEFAULT_FONT, pageIndex, sheet.id);

      await expect(probe.bend).not.toBeNull();
      await expectBaselinesOnRuling(probe);
      await expect(measureBaselineDrift(probe, null)).toBeGreaterThan(PIXEL_TOLERANCE);
    }
  },
};

/**
 * Строки следуют перспективе разлиновки по всей длине и высоте — на нечётной и
 * на зеркальной странице, — а тот же расчёт без перспективы уходит с линий за
 * допуск.
 *
 * Лист — экземпляр линейки с перспективой, заданной литералом: у пресет-пака
 * её нет, и расчёт без перспективы на нём совпал бы с расчётом с ней.
 */
export const PerspectiveRulingOnSheet: Story = {
  play: async () => {
    const families = await loadPaperFamilies();
    const family = families.find((item) => {
      return item.id === LINED_FAMILY_ID;
    });
    const sheet = family?.sheets[0];

    if (!family || !sheet) {
      throw new Error('В пресет-паке нет экземпляров линейки');
    }

    const perspectiveFamilies = replaceSheet(families, addSheetPerspective(sheet));

    for (const pageIndex of [0, 1]) {
      applySheet(perspectiveFamilies, family.id, sheet.id, pageIndex);

      const probe = await waitForProbe(DEFAULT_FONT, pageIndex, sheet.id);

      await expect(probe.perspective).not.toBeNull();
      await expectBaselinesOnRuling(probe);
      await expect(measureBaselineDrift(probe, probe.bend, null)).toBeGreaterThan(
        PIXEL_TOLERANCE
      );
    }
  },
};
