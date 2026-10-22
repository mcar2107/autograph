import type { ReactNode, SVGProps } from 'react';

export type MarkupStrokeProps = Omit<
  SVGProps<SVGGElement>,
  | 'id'
  | 'ref'
  | 'className'
  | 'stroke'
  | 'strokeWidth'
  | 'strokeDasharray'
  | 'vectorEffect'
  | 'children'
> & {
  /**
   * Толщина основного штриха в экранных пикселях — при любом зуме. Фигуры
   * внутри своей толщины не задают.
   */
  width: number;

  /**
   * Пунктир: длины штриха и промежутка в экранных пикселях. Не задан —
   * линия сплошная.
   */
  dash?: [number, number];

  /**
   * Классы краски слоя: цвет штриха, у точек — и заливки.
   */
  className: string;

  /**
   * Фигуры слоя.
   */
  children: ReactNode;
};
