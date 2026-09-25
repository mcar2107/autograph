import { cx } from '@shared/lib/styles';
import type { FC } from 'react';
import { useId, useMemo } from 'react';

import { MarkupStroke, toSvgId } from '../MarkupStroke';
import { useMarkupMirrorWidth, useMarkupScale } from '../MarkupViewport';
import type { MarkupToolId } from '../SheetMarkupEditor.types';

import {
  buildMarginGuides,
  buildRulingLines,
  buildWritingZone,
  toLineAttributes,
  toOutlinePolygon,
  toPointsAttribute,
} from './markupGeometry';
import { MARKUP_MUTED_OPACITY } from './markupOpacity';
import type {
  MarkupLayerGroupAttributes,
  MarkupLayerId,
  MarkupOverlayProps,
} from './MarkupOverlay.types';

/**
 * Толщина линий разметки в экранных пикселях: штрих не масштабируется вместе
 * с фотографией, иначе при приближении линии закрывали бы то, что под ними.
 */
const STROKE_WIDTH = 1.5;

/**
 * Пунктир полей в экранных пикселях: поля отличаются от линий гребёнки не
 * только цветом.
 */
const MARGIN_DASH: [number, number] = [6, 4];

/**
 * Толщина одиночных линий — линии поля, контура, булавок: их немного, и
 * они должны читаться поверх гребёнки.
 */
const SINGLE_STROKE_WIDTH = 2;

/**
 * Радиус точки на концах булавки в экранных пикселях.
 */
const PIN_END_RADIUS = 4;

/**
 * Непрозрачность слоёв, которые выбранный инструмент не правит. Они нужны
 * как ориентир — где линии, где контур, — но в полную силу спорили бы с
 * тем, что правится: в «Полях» концы закреплённых линий ложатся рядом с
 * углами полей. Контраст слоя к бумаге при этом ниже 3:1 намеренно: это
 * фон правки, а не её предмет, и выбор инструмента возвращает слою полную
 * силу.
 */
const FOREIGN_OPACITY = 0.4;

/**
 * Непрозрачность заливки зоны письма: бумага под ней чуть темнеет, и
 * граница зоны видна, а линии снимка сквозь заливку не теряются.
 */
const WRITING_ZONE_OPACITY = 0.14;

/**
 * Слои, которые правит каждый инструмент.
 */
const TOOL_LAYERS: Record<MarkupToolId, MarkupLayerId[]> = {
  outline: ['outline'],
  lines: ['lines', 'pins'],
  bend: ['lines'],
  margins: ['margins', 'marginLine'],
};

/**
 * Атрибуты группы слоя: слой, который выбранный инструмент не правит,
 * тусклее — вместе с подложкой штриха.
 *
 * @param tool — выбранный инструмент
 * @param layer — слой
 * @returns атрибуты группы
 */
const toLayerGroupAttributes = (
  tool: MarkupToolId,
  layer: MarkupLayerId
): MarkupLayerGroupAttributes => {
  if (TOOL_LAYERS[tool].includes(layer)) {
    return { 'data-layer-group': layer };
  }

  return { 'data-layer-group': layer, 'data-foreign': true, opacity: FOREIGN_OPACITY };
};

/**
 * Разметка листа поверх фотографии: контур, линии разлиновки, поля, линия
 * поля и булавки — в пикселях фотографии. `viewBox` совпадает с кадром,
 * поэтому приближение и сдвиг, заданные общему с фотографией контейнеру,
 * разметку не сдвигают относительно снимка.
 *
 * Линии обрезаны контуром листа: за ним стол или соседний лист, и строки там
 * не лягут.
 *
 * Под пробным текстом линии приглушены, а у закреплённых линий остаются
 * только концы: проверяют там, сели ли буквы на линии снимка, и линия
 * разметки на базовой линии закрывала бы именно это место. Ручки не
 * приглушаются — правка идёт и при пробном тексте.
 *
 * Скрытая разметка остаётся в документе прозрачной и не ловит указатель:
 * ручка в фокусе фокус не теряет, и после возврата стрелки двигают её дальше.
 *
 * Слои, которые выбранный инструмент не правит, тусклее своих. Под полями
 * закрашена зона письма — где на странице встанут строки: у линии поля
 * внутри полей она уже прямоугольника полей.
 */
export const MarkupOverlay: FC<MarkupOverlayProps> = (props) => {
  const { frame, ruling, pins, layers, tool, isMuted, isHidden, onHandleLayerChange } =
    props;
  const clipId = toSvgId(useId());
  const scale = useMarkupScale();
  const mirrorWidth = useMarkupMirrorWidth();
  const { width, height } = frame;
  const polygon = toPointsAttribute(toOutlinePolygon(ruling.outline, frame));
  const marginGuides = buildMarginGuides(ruling, frame);

  /**
   * Ломаные пересчитываются только по разлиновке: изогнутый лист — это
   * десятки тысяч точек, а зум и сдвиг идут без перерисовки оверлея.
   */
  const lines = useMemo(() => {
    return buildRulingLines(ruling, frame);
  }, [ruling, frame]);

  const writingZone = useMemo(() => {
    return toPointsAttribute(buildWritingZone(ruling, frame));
  }, [ruling, frame]);

  return (
    <svg
      role="group"
      aria-label="Разметка листа"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cx(
        'absolute top-0 left-0 overflow-visible',
        isHidden && 'pointer-events-none opacity-0'
      )}
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points={polygon} />
        </clipPath>
      </defs>

      <g
        data-muted={isMuted || undefined}
        opacity={isMuted ? MARKUP_MUTED_OPACITY : undefined}
      >
        {layers.lines ? (
          <g {...toLayerGroupAttributes(tool, 'lines')}>
            <MarkupStroke
              data-layer="lines"
              clipPath={`url(#${clipId})`}
              fill="none"
              width={STROKE_WIDTH}
              className="stroke-markup-line"
            >
              {lines.map(({ index, points }) => {
                return (
                  <polyline
                    key={index}
                    data-line-index={index}
                    points={toPointsAttribute(points)}
                  />
                );
              })}
            </MarkupStroke>
          </g>
        ) : null}

        {layers.margins ? (
          <g {...toLayerGroupAttributes(tool, 'margins')}>
            <polygon
              data-writing-zone=""
              points={writingZone}
              clipPath={`url(#${clipId})`}
              pointerEvents="none"
              fillOpacity={WRITING_ZONE_OPACITY}
              className="fill-markup-margin"
            />

            <MarkupStroke
              data-layer="margins"
              clipPath={`url(#${clipId})`}
              dash={MARGIN_DASH}
              fill="none"
              width={STROKE_WIDTH}
              className="stroke-markup-margin"
            >
              <polyline data-margin="top" points={toPointsAttribute(marginGuides.top)} />

              <polyline
                data-margin="bottom"
                points={toPointsAttribute(marginGuides.bottom)}
              />

              <line data-margin="left" {...toLineAttributes(marginGuides.left)} />

              <line data-margin="right" {...toLineAttributes(marginGuides.right)} />
            </MarkupStroke>
          </g>
        ) : null}

        {layers.marginLine && marginGuides.marginLine ? (
          <g {...toLayerGroupAttributes(tool, 'marginLine')}>
            <MarkupStroke
              data-layer="marginLine"
              clipPath={`url(#${clipId})`}
              fill="none"
              width={SINGLE_STROKE_WIDTH}
              className="stroke-markup-margin-line"
            >
              <line {...toLineAttributes(marginGuides.marginLine)} />
            </MarkupStroke>
          </g>
        ) : null}

        {layers.outline ? (
          <g {...toLayerGroupAttributes(tool, 'outline')}>
            <MarkupStroke
              data-layer="outline"
              fill="none"
              width={SINGLE_STROKE_WIDTH}
              className="stroke-markup-outline"
            >
              <polygon points={polygon} />
            </MarkupStroke>
          </g>
        ) : null}
      </g>

      {layers.pins ? (
        <g {...toLayerGroupAttributes(tool, 'pins')}>
          <MarkupStroke
            data-layer="pins"
            width={SINGLE_STROKE_WIDTH}
            className="fill-markup-pin stroke-markup-pin"
          >
            {pins.map(({ left, right }, order) => {
              const label = `Закреплённая линия ${order + 1}`;

              return (
                <g key={label} role="img" aria-label={label}>
                  {isMuted ? null : (
                    <line x1={left.x} y1={left.y} x2={right.x} y2={right.y} />
                  )}

                  <circle cx={left.x} cy={left.y} r={PIN_END_RADIUS / scale} />

                  <circle cx={right.x} cy={right.y} r={PIN_END_RADIUS / scale} />
                </g>
              );
            })}
          </MarkupStroke>
        </g>
      ) : null}

      {/*
       * На зеркальной странице ручки стоят в пикселях самого листа, а слой
       * отражён целиком: инструмент правит одну разметку на обеих вкладках.
       */}
      <g
        ref={onHandleLayerChange}
        data-layer="handles"
        transform={mirrorWidth === null ? undefined : `matrix(-1 0 0 1 ${mirrorWidth} 0)`}
      />
    </svg>
  );
};
