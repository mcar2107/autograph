import { Button } from '@shared/ui/Button';
import { ValueSlider } from '@shared/ui/ValueSlider';
import type { FC, PointerEvent } from 'react';
import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatNumber, NBSP } from '../../../../../lib/format/formatNumber';
import type {
  RulingBendRadius,
  SheetFrame,
  SheetPoint,
  SheetRuling,
} from '../../../../../lib/paper';
import { resolveBendRadius, resolveBendReach } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { normalizePins, refitBendToPins } from '../LinesTool/linesPins';
import { MarkupLiveRegion } from '../MarkupLiveRegion';
import { MARKUP_MUTED_OPACITY } from '../MarkupOverlay';
import { buildRulingLines, toPointsAttribute } from '../MarkupOverlay/markupGeometry';
import { MarkupStroke } from '../MarkupStroke';
import {
  mirrorMarkupPoint,
  useMarkupMirrorWidth,
  useMarkupScale,
} from '../MarkupViewport';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import { buildBendRing, toPhotoPoint } from './bendGeometry';
import type { BendRefitBlock, BendRefitNotice } from './BendTool.types';
import { useBendDrag } from './useBendDrag';

/**
 * Толщина полосы, за которую линия берётся указателем, в экранных пикселях:
 * сама линия в полтора пикселя, и попасть в неё мышью и пальцем трудно.
 * Делится на масштаб просмотра: зум — CSS-преобразование над `<svg>`, и
 * `non-scaling-stroke` его не учитывает.
 */
const HIT_WIDTH = 14;

/**
 * Толщина подсветки линии под курсором в экранных пикселях — вдвое толще
 * линий гребёнки: на мелком масштабе линии стоят через десяток экранных
 * пикселей, и без подсветки не видно, какую из них возьмёт нажатие.
 */
const HOVER_WIDTH = 3;

/**
 * Толщина рамки радиуса правки в экранных пикселях — как у линий гребёнки.
 */
const RING_WIDTH = 1.5;

/**
 * Пунктир рамки радиуса в экранных пикселях: рамка — граница правки, а не
 * линия листа.
 */
const RING_DASH: [number, number] = [4, 4];

/**
 * Радиус по умолчанию в шагах, если шага нет: слайдер всё равно что-то
 * показывает, а правка без шага не применяется.
 */
const FALLBACK_RADIUS_STEPS = 3;

/**
 * Границы слайдера радиуса в шагах разлиновки: уже шага правка задевает
 * только одну линию, шире десяти — полстраницы.
 */
const RADIUS_RANGE = { min: 1, max: 10, step: 0.5 };

const REFIT_FAILED_MESSAGE =
  'Изгиб по фотографии проследить не удалось — линии остались прежними.';

const REFIT_APPLIED_MESSAGE =
  'Изгиб прослежен по\u00A0фото: линии идут по\u00A0бумаге. «Отменить» вернёт прежние.';

/**
 * Почему подгонка по фото недоступна. Погасшая без объяснения кнопка
 * выглядит сломанной, а причины у неё разные и устраняются по-разному.
 */
const REFIT_BLOCKED_MESSAGES: Record<BendRefitBlock, string> = {
  blank:
    'При «Без разлиновки» редактор линий не\u00A0ищет, и\u00A0прослеживать изгиб не\u00A0по\u00A0чему. Строки идут по\u00A0закреплённым линиям.',
  noLines:
    'Сначала закрепите линии в\u00A0инструменте «Линии»: изгиб прослеживается от\u00A0них.',
  noImage:
    'Фото ещё готовится для\u00A0подгонки — кнопка включится через несколько секунд.',
};

/**
 * Форма слова «шаг» по правилу множественного числа; дробное число
 * согласуется с родительным падежом единственного: «2,5 шага».
 */
const STEP_WORD_BY_PLURAL: Record<Intl.LDMLPluralRule, string> = {
  zero: 'шагов',
  one: 'шаг',
  two: 'шага',
  few: 'шага',
  many: 'шагов',
  other: 'шага',
};

const PLURAL_RULES = new Intl.PluralRules('ru-RU');

/**
 * Радиус в шагах разлиновки для слайдера.
 *
 * @param value — радиус в шагах
 * @returns например «3 шага», «2,5 шага»
 */
const formatRadius = (value: number): string => {
  const number = formatNumber(value, { fractionDigits: 1, isSigned: false });

  return `${number}${NBSP}${STEP_WORD_BY_PLURAL[PLURAL_RULES.select(value)]}`;
};

/**
 * Чего не хватает подгонке изгиба по фото.
 *
 * @param isBlank — выбрано «Без разлиновки»
 * @param hasLines — у разметки есть линии
 * @param hasImage — каналы фотографии готовы
 * @returns причина; `null` — подгонка доступна
 */
const resolveRefitBlock = (
  isBlank: boolean,
  hasLines: boolean,
  hasImage: boolean
): BendRefitBlock | null => {
  if (isBlank) {
    return 'blank';
  }

  if (!hasLines) {
    return 'noLines';
  }

  return hasImage ? null : 'noImage';
};

/**
 * Радиусы правки по положению слайдера: поперёк линий — заданное число
 * шагов, вдоль линий — радиус по умолчанию в той же пропорции, так что форма
 * рамки остаётся прежней.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param radiusSteps — положение слайдера, шагов
 * @returns радиусы в пикселях кадра
 */
const scaleBendRadius = (
  ruling: SheetRuling,
  frame: SheetFrame,
  radiusSteps: number
): RulingBendRadius => {
  const defaults = resolveBendRadius(ruling, frame);
  const defaultSteps = ruling.step > 0 ? defaults.radius / ruling.step : 0;
  const factor = defaultSteps > 0 ? radiusSteps / defaultSteps : 1;

  return {
    radius: defaults.radius * factor,
    radiusX: defaults.radiusX * factor,
  };
};

/**
 * Инструмент «Изгиб»: любую линию можно взять в любой точке и потянуть поперёк
 * линий — она пройдёт через точку отпускания, соседние сдвинутся меньше, а за
 * рамкой у курсора ничего не сдвинется. Линия, которую возьмёт нажатие,
 * подсвечена заранее, а за одно перетаскивание уходит не дальше шага. Shift — сдвиг всего столбца, как у
 * прогиба у пружины. «Подогнать изгиб по фото» прослеживает изгиб заново
 * относительно текущих линий и доводит его до закреплённых линий, «Выпрямить»
 * его снимает.
 *
 * На зеркальной странице линии берутся в отражённом слое: правится изгиб
 * самого листа, и зеркало его отражает.
 */
export const BendTool: FC<MarkupToolProps> = (props) => {
  const { handleLayer, isMuted } = props;
  const mirrorWidth = useMarkupMirrorWidth();
  const scale = useMarkupScale();
  const record = useMarkupEditorStore((state) => {
    return state.record;
  });
  const draft = useMarkupEditorStore((state) => {
    return state.draft;
  });
  const hasImage = useMarkupEditorStore((state) => {
    return state.image !== null;
  });
  const width = record?.sheet.width || 0;
  const height = record?.sheet.height || 0;
  const frame = useMemo(() => {
    return { width, height };
  }, [width, height]);
  const ruling = draft?.ruling;
  const [radiusSteps, setRadiusSteps] = useState(() => {
    return ruling && ruling.step > 0
      ? resolveBendRadius(ruling, frame).radius / ruling.step
      : FALLBACK_RADIUS_STEPS;
  });
  const refitHintId = useId();
  const [refitNotice, setRefitNotice] = useState<BendRefitNotice | null>(null);
  const radius = useMemo(() => {
    return ruling
      ? scaleBendRadius(ruling, frame, radiusSteps)
      : { radius: 0, radiusX: 0 };
  }, [ruling, frame, radiusSteps]);
  const { ringCenter, activeIndex, grab, hover, drag, release } = useBendDrag(
    handleLayer,
    frame,
    radius
  );

  /**
   * Линии для захвата — те же ломаные, что рисует оверлей: взять можно ровно
   * то, что видно. Атрибуты считаются только по разлиновке: рамка идёт за
   * курсором на каждое движение, а изогнутый лист — это десятки тысяч точек.
   */
  const lines = useMemo(() => {
    return ruling
      ? buildRulingLines(ruling, frame).map(({ index, points }) => {
          return { index, points: toPointsAttribute(points) };
        })
      : [];
  }, [ruling, frame]);

  if (!draft || !ruling) {
    return null;
  }

  const hasLines = ruling.step > 0;
  const activeLine = lines.find(({ index }) => {
    return index === activeIndex;
  });
  const refitBlock = resolveRefitBlock(draft.kind === 'blank', hasLines, hasImage);
  /**
   * Итог подгонки верен, пока разметка — его итог: после отмены или новой
   * правки он говорил бы уже не о том, что видно.
   */
  const refitMessage = refitNotice?.draft === draft ? refitNotice.text : null;
  const ring =
    ringCenter && hasLines
      ? buildBendRing(ruling, ringCenter, resolveBendReach(ruling, frame, radius))
      : null;

  const handleRadiusChange = (value: number) => {
    setRadiusSteps(value);
  };

  const handleRefitClick = () => {
    const { draft: current, image, commit } = useMarkupEditorStore.getState();

    if (!current || !image) {
      return;
    }

    const refitted = refitBendToPins(
      image,
      current.ruling,
      normalizePins(current.pins),
      frame
    );

    if (!refitted) {
      setRefitNotice({ text: REFIT_FAILED_MESSAGE, draft: current });

      return;
    }

    commit({ ruling: refitted });
    setRefitNotice({
      text: REFIT_APPLIED_MESSAGE,
      draft: useMarkupEditorStore.getState().draft,
    });
  };

  /**
   * Точка листа под указателем: на зеркальной странице — отражённая.
   *
   * @param event — событие указателя на линиях
   * @returns точка, px фотографии листа; `null` — матрицы нет
   */
  const readSheetPoint = (event: PointerEvent<SVGGElement>): SheetPoint | null => {
    const { clientX, clientY, currentTarget } = event;
    const point = toPhotoPoint(currentTarget.ownerSVGElement, clientX, clientY);

    return point && mirrorMarkupPoint(point, mirrorWidth);
  };

  const handleLinesPointerDown = (event: PointerEvent<SVGGElement>) => {
    const { pointerId, currentTarget } = event;
    const point = readSheetPoint(event);

    if (point && grab(pointerId, point)) {
      event.stopPropagation();
      currentTarget.setPointerCapture?.(pointerId);
    }
  };

  const handleLinesPointerMove = (event: PointerEvent<SVGGElement>) => {
    const { pointerId, shiftKey } = event;
    const point = readSheetPoint(event);

    hover(point);

    if (point) {
      drag(pointerId, point.y, shiftKey);
    }
  };

  const handleLinesPointerLeave = () => {
    hover(null);
  };

  const handleLinesPointerUp = (event: PointerEvent<SVGGElement>) => {
    const { pointerId, shiftKey } = event;
    const point = readSheetPoint(event);

    release(pointerId, point ? point.y : null, shiftKey);
  };

  /**
   * Отмена указателя системой приходит без осмысленных координат: остаётся
   * последнее показанное положение.
   *
   * @param event — событие отмены
   */
  const handleLinesPointerCancel = (event: PointerEvent<SVGGElement>) => {
    release(event.pointerId, null, event.shiftKey);
  };

  const handleStraightenClick = () => {
    const { commit } = useMarkupEditorStore.getState();

    setRefitNotice(null);
    commit((current) => {
      return { ruling: { ...current.ruling, bend: null } };
    });
  };

  return (
    <section aria-label="Изгиб линий" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Потяните любую линию вверх или вниз — она пройдёт через точку, где вы её
        отпустите, а соседние сдвинутся меньше. За рамкой у курсора линии не меняются. С
        Shift сдвигается весь столбец. Линия, которую возьмёт нажатие, подсвечена; за одно
        движение она уходит не дальше шага.
      </p>

      <ValueSlider
        label="Радиус изгиба"
        value={radiusSteps}
        min={RADIUS_RANGE.min}
        max={RADIUS_RANGE.max}
        step={RADIUS_RANGE.step}
        formatValue={formatRadius}
        isDisabled={!hasLines}
        onChange={handleRadiusChange}
      />

      <Button
        variant="secondary"
        isDisabled={refitBlock !== null}
        describedBy={refitBlock ? refitHintId : undefined}
        onClick={handleRefitClick}
      >
        Подогнать изгиб по фото
      </Button>

      {refitBlock ? (
        <p id={refitHintId} className="text-xs text-fg-muted">
          {REFIT_BLOCKED_MESSAGES[refitBlock]}
        </p>
      ) : null}

      <Button variant="ghost" isDisabled={!ruling.bend} onClick={handleStraightenClick}>
        Выпрямить
      </Button>

      <MarkupLiveRegion
        tone="status"
        message={refitMessage}
        className="text-xs text-fg-muted"
      />

      {handleLayer && hasLines
        ? createPortal(
            <g
              data-tool="bend"
              onPointerDown={handleLinesPointerDown}
              onPointerMove={handleLinesPointerMove}
              onPointerUp={handleLinesPointerUp}
              onPointerCancel={handleLinesPointerCancel}
              onPointerLeave={handleLinesPointerLeave}
            >
              {lines.map(({ index, points }) => {
                return (
                  <polyline
                    key={index}
                    data-bend-line-index={index}
                    points={points}
                    strokeWidth={HIT_WIDTH / scale}
                    pointerEvents="stroke"
                    className="cursor-ns-resize fill-none stroke-transparent in-data-pan-mode:pointer-events-none"
                  />
                );
              })}

              {/*
               * Подсветка и рамка лежат в слое ручек, мимо приглушения
               * оверлея, поэтому под пробным текстом гаснут здесь — той же
               * непрозрачностью, что и линии разметки.
               */}
              <g
                data-muted={isMuted || undefined}
                opacity={isMuted ? MARKUP_MUTED_OPACITY : undefined}
              >
                {activeLine ? (
                  <MarkupStroke
                    pointerEvents="none"
                    fill="none"
                    width={HOVER_WIDTH}
                    className="stroke-markup-highlight"
                  >
                    <polyline
                      data-bend-hover={activeLine.index}
                      points={activeLine.points}
                    />
                  </MarkupStroke>
                ) : null}

                {ring ? (
                  <MarkupStroke
                    dash={RING_DASH}
                    pointerEvents="none"
                    fill="none"
                    width={RING_WIDTH}
                    className="stroke-markup-highlight"
                  >
                    <polygon data-bend-ring="" points={toPointsAttribute(ring)} />
                  </MarkupStroke>
                ) : null}
              </g>
            </g>,
            handleLayer
          )
        : null}
    </section>
  );
};
