import { Button } from '@shared/ui/Button';
import { ValueSlider } from '@shared/ui/ValueSlider';
import type { FC, PointerEvent } from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatNumber, NBSP } from '../../../../../lib/format/formatNumber';
import type { RulingBendRadius, SheetFrame, SheetRuling } from '../../../../../lib/paper';
import { resolveBendRadius, resolveBendReach } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { normalizePins, refitBendToPins } from '../LinesTool/linesPins';
import { buildRulingLines, toPointsAttribute } from '../MarkupOverlay/markupGeometry';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import { buildBendRing, toPhotoPoint } from './bendGeometry';
import { useBendDrag } from './useBendDrag';

/**
 * Толщина полосы, за которую линия берётся указателем, в экранных пикселях:
 * сама линия в полтора пикселя, и попасть в неё мышью и пальцем трудно.
 */
const HIT_WIDTH = 14;

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
 * рамкой у курсора ничего не сдвинется. Shift — сдвиг всего столбца, как у
 * прогиба у пружины. «Подогнать изгиб по фото» прослеживает изгиб заново
 * относительно текущих линий и доводит его до закреплённых линий, «Выпрямить»
 * его снимает.
 *
 * Разметка правится на странице самого листа: у зеркальной страницы линии —
 * отражение этих.
 */
export const BendTool: FC<MarkupToolProps> = (props) => {
  const { handleLayer, pageIndex } = props;
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
  const [refitMessage, setRefitMessage] = useState<string | null>(null);
  const radius = useMemo(() => {
    return ruling
      ? scaleBendRadius(ruling, frame, radiusSteps)
      : { radius: 0, radiusX: 0 };
  }, [ruling, frame, radiusSteps]);
  const { ringCenter, grab, drag, release } = useBendDrag(handleLayer, frame, radius);

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
  const canRefit = hasLines && hasImage && draft.kind !== 'blank';
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
      setRefitMessage(REFIT_FAILED_MESSAGE);

      return;
    }

    setRefitMessage(null);
    commit({ ruling: refitted });
  };

  const handleLinesPointerDown = (event: PointerEvent<SVGGElement>) => {
    const { pointerId, clientX, clientY, currentTarget } = event;
    const point = toPhotoPoint(currentTarget.ownerSVGElement, clientX, clientY);

    if (point && grab(pointerId, point)) {
      event.stopPropagation();
      currentTarget.setPointerCapture?.(pointerId);
    }
  };

  const handleLinesPointerMove = (event: PointerEvent<SVGGElement>) => {
    const { pointerId, clientX, clientY, currentTarget, shiftKey } = event;
    const point = toPhotoPoint(currentTarget.ownerSVGElement, clientX, clientY);

    if (point) {
      drag(pointerId, point.y, shiftKey);
    }
  };

  const handleLinesPointerUp = (event: PointerEvent<SVGGElement>) => {
    const { pointerId, clientX, clientY, currentTarget, shiftKey } = event;
    const point = toPhotoPoint(currentTarget.ownerSVGElement, clientX, clientY);

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

    setRefitMessage(null);
    commit((current) => {
      return { ruling: { ...current.ruling, bend: null } };
    });
  };

  return (
    <section aria-label="Изгиб линий" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Потяните любую линию вверх или вниз — она пройдёт через точку, где вы её
        отпустите, а соседние сдвинутся меньше. За рамкой у курсора линии не меняются. С
        Shift сдвигается весь столбец.
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

      <Button variant="secondary" isDisabled={!canRefit} onClick={handleRefitClick}>
        Подогнать изгиб по фото
      </Button>

      <Button variant="ghost" isDisabled={!ruling.bend} onClick={handleStraightenClick}>
        Выпрямить
      </Button>

      {refitMessage ? (
        <p role="status" className="text-xs text-fg-muted">
          {refitMessage}
        </p>
      ) : null}

      {handleLayer && pageIndex === 0 && hasLines
        ? createPortal(
            <g
              data-tool="bend"
              onPointerDown={handleLinesPointerDown}
              onPointerMove={handleLinesPointerMove}
              onPointerUp={handleLinesPointerUp}
              onPointerCancel={handleLinesPointerCancel}
            >
              {lines.map(({ index, points }) => {
                return (
                  <polyline
                    key={index}
                    data-bend-line-index={index}
                    points={points}
                    strokeWidth={HIT_WIDTH}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="stroke"
                    className="cursor-ns-resize fill-none stroke-transparent in-data-pan-mode:pointer-events-none"
                  />
                );
              })}

              {ring ? (
                <polygon
                  data-bend-ring=""
                  points={toPointsAttribute(ring)}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  className="fill-none stroke-focus"
                />
              ) : null}
            </g>,
            handleLayer
          )
        : null}
    </section>
  );
};
