import { cx } from '@shared/lib/styles';
import type { FC } from 'react';
import { useId, useMemo } from 'react';

import { MarkupStroke, toSvgId } from '../MarkupStroke';
import { useMarkupMirrorWidth, useMarkupScale } from '../MarkupViewport';

import {
  buildMarginGuides,
  buildRulingLines,
  toLineAttributes,
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
 * Непрозрачность линий разметки под пробным текстом. Синие чернила лежат
 * ровно на линиях разлиновки, и в полную силу линии закрывали бы буквы;
 * четверти хватает, чтобы видеть, где разметка, и читать сквозь неё текст.
 */
const MUTED_OPACITY = 0.25;

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
 */
export const MarkupOverlay: FC<MarkupOverlayProps> = (props) => {
  const { frame, ruling, pins, layers, isMuted, isHidden, onHandleLayerChange } = props;
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

      <g data-muted={isMuted || undefined} opacity={isMuted ? MUTED_OPACITY : undefined}>
        {layers.lines ? (
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
        ) : null}

        {layers.margins ? (
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
        ) : null}

        {layers.marginLine && marginGuides.marginLine ? (
          <MarkupStroke
            data-layer="marginLine"
            clipPath={`url(#${clipId})`}
            fill="none"
            width={SINGLE_STROKE_WIDTH}
            className="stroke-markup-margin-line"
          >
            <line {...toLineAttributes(marginGuides.marginLine)} />
          </MarkupStroke>
        ) : null}

        {layers.outline ? (
          <MarkupStroke
            data-layer="outline"
            fill="none"
            width={SINGLE_STROKE_WIDTH}
            className="stroke-markup-outline"
          >
            <polygon points={polygon} />
          </MarkupStroke>
        ) : null}
      </g>

      {layers.pins ? (
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
