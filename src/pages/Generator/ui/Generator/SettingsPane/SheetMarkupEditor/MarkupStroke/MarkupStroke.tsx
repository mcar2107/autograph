import type { FC } from 'react';
import { useId } from 'react';

import { useMarkupScale } from '../MarkupViewport';

import type { MarkupStrokeProps } from './MarkupStroke.types';
import { toSvgId } from './toSvgId';

/**
 * На сколько экранных пикселей подложка выступает из-под штриха с каждой
 * стороны. Пиксель, а не больше: при зуме, где пиксель фото — четыре
 * экранных, линия снимка толщиной в два пикселя видна по краям подложки.
 */
const HALO_SIDE = 1;

/**
 * Непрозрачность подложки. Непрозрачная подложка закрывала линию снимка
 * целиком, и совпадение разметки с ней было не проверить; при 0,4 под
 * подложкой остаётся около 60 % перепада «линия — бумага» в sRGB, а краска
 * слоя к подложке над самой тёмной бумагой живых снимков (яркость 0,17)
 * держит не меньше 3,9:1.
 */
const HALO_OPACITY = 0.4;

/**
 * Двойной штрих разметки: полупрозрачная белая подложка под краской слоя.
 * Бумага на снимке бывает и светлой, и серой в тени, и одна краска на обоих
 * фонах 3:1 не держит — краска на осветлённой подложкой бумаге держит (см.
 * токены `markup-*` в `app/styles/app.css`). Подложка — одна группа с общей
 * непрозрачностью, а не непрозрачность каждой фигуры: на пересечениях линий
 * она не темнеет вдвое.
 *
 * Толщина и пунктир делятся на масштаб просмотра, а не отдаются
 * `vector-effect: non-scaling-stroke`: зум — CSS-преобразование контейнера
 * над `<svg>`, и Chromium его в `non-scaling-stroke` не учитывает — на 36 %
 * штрих в полтора пикселя выходил в полпикселя и растворялся в бумаге.
 *
 * Подложка — `<use>` той же группы, а не вторая копия фигур: геометрия
 * лежит в DOM один раз, а атрибуты фигур (`data-*`, подписи) не двоятся.
 * Поэтому толщина и цвет задаются снаружи группы, а фигуры наследуют их — в
 * подложке от `<use>`, в штрихе от обёртки.
 */
export const MarkupStroke: FC<MarkupStrokeProps> = (props) => {
  const { width, dash, className, children, ...geometryProps } = props;
  const id = toSvgId(useId());
  const scale = useMarkupScale();

  const dashArray = dash
    ?.map((length) => {
      return length / scale;
    })
    .join(' ');

  return (
    <>
      <use
        href={`#${id}`}
        aria-hidden="true"
        pointerEvents="none"
        strokeWidth={(width + 2 * HALO_SIDE) / scale}
        opacity={HALO_OPACITY}
        className="fill-markup-halo stroke-markup-halo"
      />

      <g strokeWidth={width / scale} className={className}>
        <g id={id} strokeDasharray={dashArray} {...geometryProps}>
          {children}
        </g>
      </g>
    </>
  );
};
