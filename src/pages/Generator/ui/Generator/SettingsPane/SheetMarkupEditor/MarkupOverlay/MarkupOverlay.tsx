import type { FC } from 'react';
import { useId, useMemo } from 'react';

import { useMarkupMirrorWidth, useMarkupScale } from '../MarkupViewport';

import {
  buildMarginGuides,
  buildRulingLines,
  toOutlinePolygon,
  toPointsAttribute,
} from './markupGeometry';
import type { MarkupOverlayProps } from './MarkupOverlay.types';

/**
 * Толщина линий разметки в экранных пикселях: штрих не масштабируется вместе
 * с фотографией, иначе при приближении линии закрывали бы то, что под ними.
 */
const STROKE_WIDTH = 1.5;

/**
 * Радиус точки на концах булавки в экранных пикселях.
 */
const PIN_END_RADIUS = 4;

/**
 * Идентификатор для `url(#…)`: `useId` отдаёт двоеточия и кавычки-ёлочки,
 * которые в ссылке на обрезку пришлось бы экранировать.
 *
 * @param id — идентификатор от `useId`
 * @returns идентификатор из букв, цифр и дефисов
 */
const toSvgId = (id: string): string => {
  return `markup-${id.replace(/[^a-zA-Z0-9-]/g, '')}`;
};

/**
 * Разметка листа поверх фотографии: контур, линии разлиновки, поля, линия
 * поля и булавки — в пикселях фотографии. `viewBox` совпадает с кадром,
 * поэтому приближение и сдвиг, заданные общему с фотографией контейнеру,
 * разметку не сдвигают относительно снимка.
 *
 * Линии обрезаны контуром листа: за ним стол или соседний лист, и строки там
 * не лягут.
 */
export const MarkupOverlay: FC<MarkupOverlayProps> = (props) => {
  const { frame, ruling, pins, layers, onHandleLayerChange } = props;
  const clipId = toSvgId(useId());
  const scale = useMarkupScale();
  const mirrorWidth = useMarkupMirrorWidth();
  const { width, height } = frame;
  const { margins, marginLineX } = ruling;
  const polygon = toPointsAttribute(toOutlinePolygon(ruling.outline, frame));
  const marginGuides = buildMarginGuides(ruling, frame);

  /**
   * Ломаные пересчитываются только по разлиновке: изогнутый лист — это
   * десятки тысяч точек, а зум и сдвиг идут без перерисовки оверлея.
   */
  const lines = useMemo(() => {
    return buildRulingLines(ruling, frame);
  }, [ruling, frame]);

  return (
    <svg
      role="group"
      aria-label="Разметка листа"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="absolute top-0 left-0 overflow-visible"
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points={polygon} />
        </clipPath>
      </defs>

      {layers.lines ? (
        <g
          data-layer="lines"
          clipPath={`url(#${clipId})`}
          className="fill-none stroke-accent"
        >
          {lines.map(({ index, points }) => {
            return (
              <polyline
                key={index}
                data-line-index={index}
                points={toPointsAttribute(points)}
                strokeWidth={STROKE_WIDTH}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      ) : null}

      {layers.margins ? (
        <g
          data-layer="margins"
          clipPath={`url(#${clipId})`}
          strokeDasharray="6 4"
          className="fill-none stroke-fg-subtle"
        >
          <polyline
            data-margin="top"
            points={toPointsAttribute(marginGuides.top)}
            strokeWidth={STROKE_WIDTH}
            vectorEffect="non-scaling-stroke"
          />

          <polyline
            data-margin="bottom"
            points={toPointsAttribute(marginGuides.bottom)}
            strokeWidth={STROKE_WIDTH}
            vectorEffect="non-scaling-stroke"
          />

          <line
            data-margin="left"
            x1={margins.left}
            y1={0}
            x2={margins.left}
            y2={height}
            strokeWidth={STROKE_WIDTH}
            vectorEffect="non-scaling-stroke"
          />

          <line
            data-margin="right"
            x1={width - margins.right}
            y1={0}
            x2={width - margins.right}
            y2={height}
            strokeWidth={STROKE_WIDTH}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {layers.marginLine && marginLineX !== null ? (
        <g
          data-layer="marginLine"
          clipPath={`url(#${clipId})`}
          className="fill-none stroke-danger"
        >
          <line
            x1={marginLineX}
            y1={0}
            x2={marginLineX}
            y2={height}
            strokeWidth={STROKE_WIDTH * 2}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {layers.outline ? (
        <g data-layer="outline" className="fill-none stroke-focus">
          <polygon
            points={polygon}
            strokeWidth={STROKE_WIDTH * 2}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {layers.pins ? (
        <g data-layer="pins" className="fill-focus stroke-focus">
          {pins.map(({ left, right }, order) => {
            const label = `Закреплённая линия ${order + 1}`;

            return (
              <g key={label} role="img" aria-label={label}>
                <line
                  x1={left.x}
                  y1={left.y}
                  x2={right.x}
                  y2={right.y}
                  strokeWidth={STROKE_WIDTH * 2}
                  vectorEffect="non-scaling-stroke"
                />

                <circle
                  cx={left.x}
                  cy={left.y}
                  r={PIN_END_RADIUS / scale}
                  vectorEffect="non-scaling-stroke"
                />

                <circle
                  cx={right.x}
                  cy={right.y}
                  r={PIN_END_RADIUS / scale}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
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
