import type {
  MarginLineSide,
  PaperMargins,
  RulingMirrorOverride,
  RulingProjection,
  RulingSideSlant,
  SheetFrame,
  SheetPoint,
  SheetRuling,
} from './paper.types';
import { lineHeightAt, lineHeightSlopeAt } from './rulingPerspective';
import type {
  SideEdge,
  SideEdgeBlockPoint,
  SideEdgeEnds,
  SideEdgeRotation,
} from './sideEdges.types';

const DEGREES_IN_RADIAN = 180 / Math.PI;

/**
 * Знаменатель пересечения ближе к нулю — граница блока идёт вдоль линии
 * разлиновки, и точки пересечения нет: так поле не ставят.
 */
const MIN_CROSSING_DENOMINATOR = 1e-9;

/**
 * Концы ручек ближе по высоте блока — прямую через них не провести: граница
 * остаётся перпендикуляром к строкам через первую точку.
 */
const MIN_ENDS_SPAN = 1e-6;

/**
 * Изменение наклона, меньше которого границы блока не пересчитываются,
 * градусы. Подгонка через булавки, стоящие на линиях, возвращает прежний
 * наклон с погрешностью арктангенса; пересчёт от неё сдвинул бы границы на
 * стомиллионные доли пикселя, но превратил бы поля без наклона в наклонённые,
 * и раскладка ушла бы с прежнего пути.
 */
const NEGLIGIBLE_SKEW_CHANGE = 1e-9;

/**
 * Боковые границы блока в порядке пересчёта.
 */
const SIDE_EDGES: SideEdge[] = ['left', 'right', 'marginLine'];

/**
 * Синус и косинус наклона разлиновки.
 *
 * @param skewAngle — наклон в градусах
 * @returns синус и косинус
 */
const toRotation = (skewAngle: number): SideEdgeRotation => {
  const radians = skewAngle / DEGREES_IN_RADIAN;

  return { sin: Math.sin(radians), cos: Math.cos(radians) };
};

/**
 * Концы бокового поля, записанные в разлиновке: у верха кадра — поле, у низа
 * — `sideSlant`, а без него то же, что у верха. Правое поле хранится
 * отступом от правого края, а концы отдаются положением от левого: у всех
 * боковых границ одна мера.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param side — какое поле
 * @returns концы поля
 */
export const readMarginEnds = (
  ruling: SheetRuling,
  frame: SheetFrame,
  side: MarginLineSide
): SideEdgeEnds => {
  const { margins, sideSlant } = ruling;

  switch (side) {
    case 'left': {
      return { top: margins.left, bottom: sideSlant ? sideSlant.left : margins.left };
    }

    case 'right': {
      return {
        top: frame.width - margins.right,
        bottom: frame.width - (sideSlant ? sideSlant.right : margins.right),
      };
    }

    default: {
      throw new Error(`Неизвестное поле: ${String(side)}`);
    }
  }
};

/**
 * Концы линии поля, записанные в разлиновке.
 *
 * @param ruling — разлиновка листа
 * @returns концы линии поля; `null` — линии нет
 */
export const readMarginLineEnds = (ruling: SheetRuling): SideEdgeEnds | null => {
  const { marginLineX, sideSlant } = ruling;

  if (marginLineX === null) {
    return null;
  }

  return { top: marginLineX, bottom: sideSlant?.marginLineX || marginLineX };
};

/**
 * Концы боковой границы блока, записанные в разлиновке.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @returns концы границы; `null` — линии поля нет
 */
export const readSideEdge = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge
): SideEdgeEnds | null => {
  switch (edge) {
    case 'left': {
      return readMarginEnds(ruling, frame, 'left');
    }

    case 'right': {
      return readMarginEnds(ruling, frame, 'right');
    }

    case 'marginLine': {
      return readMarginLineEnds(ruling);
    }

    default: {
      throw new Error(`Неизвестная граница блока: ${String(edge)}`);
    }
  }
};

/**
 * Концы у низа кадра, сведённые к разлиновке: без линии поля нет и её конца,
 * а концы, совпавшие с верхними, — отсутствие наклона. Так у полей без
 * наклона одна запись, и раскладка и отрисовка идут прежним путём.
 *
 * @param slant — концы у низа кадра; `null` — наклона нет
 * @param margins — поля у верха кадра
 * @param marginLineX — линия поля у верха кадра; `null` — линии нет
 * @returns концы у низа кадра; `null` — наклона нет
 */
export const normalizeSideSlant = (
  slant: RulingSideSlant | null,
  margins: PaperMargins,
  marginLineX: number | null
): RulingSideSlant | null => {
  if (!slant) {
    return null;
  }

  const bottomLineX = marginLineX === null ? null : slant.marginLineX || marginLineX;

  if (
    slant.left === margins.left &&
    slant.right === margins.right &&
    bottomLineX === marginLineX
  ) {
    return null;
  }

  return { left: slant.left, right: slant.right, marginLineX: bottomLineX };
};

/**
 * Разлиновка с новыми концами одной границы блока. Сторона линии поля не
 * меняется: её выводит тот, кто линию ставит.
 *
 * @param ruling — разлиновка листа
 * @param frame — кадр фотографии
 * @param edge — какая граница
 * @param ends — новые концы, px от левого края кадра
 * @returns разлиновка с новой границей
 */
export const writeSideEdge = (
  ruling: SheetRuling,
  frame: SheetFrame,
  edge: SideEdge,
  ends: SideEdgeEnds
): SheetRuling => {
  const { margins, marginLineX, sideSlant } = ruling;
  const current: RulingSideSlant = sideSlant || {
    left: margins.left,
    right: margins.right,
    marginLineX,
  };

  switch (edge) {
    case 'left': {
      const next = { ...margins, left: ends.top };

      return {
        ...ruling,
        margins: next,
        sideSlant: normalizeSideSlant(
          { ...current, left: ends.bottom },
          next,
          marginLineX
        ),
      };
    }

    case 'right': {
      const next = { ...margins, right: frame.width - ends.top };

      return {
        ...ruling,
        margins: next,
        sideSlant: normalizeSideSlant(
          { ...current, right: frame.width - ends.bottom },
          next,
          marginLineX
        ),
      };
    }

    case 'marginLine': {
      return {
        ...ruling,
        marginLineX: ends.top,
        sideSlant: normalizeSideSlant(
          { ...current, marginLineX: ends.bottom },
          margins,
          ends.top
        ),
      };
    }

    default: {
      throw new Error(`Неизвестная граница блока: ${String(edge)}`);
    }
  }
};

/**
 * Точка границы блока на высоте блока `v`: концы заданы у высот `0` и
 * высоты кадра, между ними граница идёт прямой, а система блока повёрнута на
 * наклон разлиновки вокруг левого верхнего угла кадра — как у отрисовки.
 *
 * @param skewAngle — наклон разлиновки в градусах
 * @param ends — концы границы
 * @param height — высота кадра, px
 * @param v — высота в системе блока, px
 * @returns точка на фотографии
 */
export const sideEdgePointAt = (
  skewAngle: number,
  ends: SideEdgeEnds,
  height: number,
  v: number
): SheetPoint => {
  const { sin, cos } = toRotation(skewAngle);
  const x = ends.top + ((ends.bottom - ends.top) * v) / height;

  return { x: x * cos - v * sin, y: x * sin + v * cos };
};

/**
 * Точка границы блока в строке фотографии `y`.
 *
 * @param skewAngle — наклон разлиновки в градусах
 * @param ends — концы границы
 * @param height — высота кадра, px
 * @param y — строка фотографии, px
 * @returns точка на фотографии
 */
export const sideEdgePointAtHeight = (
  skewAngle: number,
  ends: SideEdgeEnds,
  height: number,
  y: number
): SheetPoint => {
  const start = sideEdgePointAt(skewAngle, ends, height, 0);
  const end = sideEdgePointAt(skewAngle, ends, height, height);

  return sideEdgePointAt(
    skewAngle,
    ends,
    height,
    ((y - start.y) * height) / (end.y - start.y)
  );
};

/**
 * Где граница блока пересекает линию разлиновки с координатой вдоль линий
 * `u`. Обе — прямые в кадре: граница по построению, линия — и при
 * перспективе, поэтому точка одна и находится без подбора.
 *
 * @param projection — наклон и перспектива разлиновки
 * @param ends — концы границы
 * @param height — высота кадра, px
 * @param u — координата вдоль линий
 * @returns точка на фотографии; `null` — граница идёт вдоль линии
 */
export const intersectSideEdge = (
  projection: RulingProjection,
  ends: SideEdgeEnds,
  height: number,
  u: number
): SheetPoint | null => {
  const start = sideEdgePointAt(projection.skewAngle, ends, height, 0);
  const end = sideEdgePointAt(projection.skewAngle, ends, height, height);
  const directionX = end.x - start.x;
  const directionY = end.y - start.y;
  const lineY = lineHeightAt(projection, 0, u);
  const slope = lineHeightSlopeAt(projection, u);
  const denominator = directionY - slope * directionX;

  if (!(Math.abs(denominator) > MIN_CROSSING_DENOMINATOR)) {
    return null;
  }

  const share = (lineY + slope * start.x - start.y) / denominator;
  const x = start.x + share * directionX;

  return { x, y: lineY + slope * x };
};

/**
 * Начало строки на линии с координатой `u` в системе блока — столько
 * отрисовка откладывает вдоль строки от левого края блока, чтобы строка
 * начиналась на границе.
 *
 * Отрисовка ставит точку блока `(X, v)` на фотографию поворотом на наклон, а
 * перспектива и изгиб двигают её только по высоте. Строка с координатой `u`
 * лежит в блоке на высоте `u·cos θ`, поэтому `X` выбирается так, чтобы
 * повёрнутая точка легла в столбец пересечения границы с линией: сдвиг по
 * высоте тогда приводит её ровно в пересечение. Без перспективы это просто
 * граница на высоте строки.
 *
 * @param projection — наклон и перспектива разлиновки
 * @param ends — концы границы
 * @param height — высота кадра, px
 * @param u — координата вдоль линий базовой линии строки
 * @returns положение вдоль строки в системе блока, px
 */
export const resolveSideEdgeAt = (
  projection: RulingProjection,
  ends: SideEdgeEnds,
  height: number,
  u: number
): number => {
  const { sin, cos } = toRotation(projection.skewAngle);
  const v = u * cos;
  const crossing = intersectSideEdge(projection, ends, height, u);

  if (!crossing) {
    return ends.top + ((ends.bottom - ends.top) * v) / height;
  }

  return (crossing.x + v * sin) / cos;
};

/**
 * Концы границы блока, проходящей через две точки фотографии, — так граница
 * ставится двумя ручками.
 *
 * @param skewAngle — наклон разлиновки в градусах
 * @param height — высота кадра, px
 * @param first — первая точка, px фотографии
 * @param second — вторая точка, px фотографии
 * @returns концы границы; точки на одной высоте блока — перпендикуляр к
 *   строкам через первую
 */
export const toSideEdgeEnds = (
  skewAngle: number,
  height: number,
  first: SheetPoint,
  second: SheetPoint
): SideEdgeEnds => {
  const { sin, cos } = toRotation(skewAngle);

  /**
   * Точка фотографии в системе блока: поворот, обратный отрисовке.
   *
   * @param point — точка фотографии
   * @returns положение вдоль строки и высота блока
   */
  const toBlock = ({ x, y }: SheetPoint): SideEdgeBlockPoint => {
    return { x: x * cos + y * sin, v: y * cos - x * sin };
  };

  const a = toBlock(first);
  const b = toBlock(second);

  if (!(Math.abs(b.v - a.v) > MIN_ENDS_SPAN)) {
    return { top: a.x, bottom: a.x };
  }

  const slope = (b.x - a.x) / (b.v - a.v);

  return { top: a.x - slope * a.v, bottom: a.x + slope * (height - a.v) };
};

/**
 * Разлиновка, у которой боковые границы страницы, записанные при наклоне
 * `fromAngle`, переписаны под её собственный наклон так, что на фотографии
 * они остались на месте.
 *
 * @param ruling — разлиновка с новым наклоном и прежними концами
 * @param fromAngle — наклон, при котором концы записаны, градусы
 * @param frame — кадр фотографии
 * @returns разлиновка с переписанными концами
 */
const reanchorPageEdges = (
  ruling: SheetRuling,
  fromAngle: number,
  frame: SheetFrame
): SheetRuling => {
  const { height } = frame;

  return SIDE_EDGES.reduce((current, edge) => {
    const ends = readSideEdge(current, frame, edge);

    if (!ends) {
      return current;
    }

    const top = sideEdgePointAt(fromAngle, ends, height, 0);
    const bottom = sideEdgePointAt(fromAngle, ends, height, height);

    return writeSideEdge(
      current,
      frame,
      edge,
      toSideEdgeEnds(current.skewAngle, height, top, bottom)
    );
  }, ruling);
};

/**
 * Поля и линия поля зеркальной страницы после смены наклона листа с
 * `fromAngle` на `toAngle`, стоящие на отражённой фотографии там же, где
 * стояли. Они записаны в системе блока отражённого кадра — с обратным
 * наклоном.
 *
 * @param override — поля зеркала; `null` — зеркало отражает оригинал
 * @param fromAngle — наклон листа, при котором они записаны, градусы
 * @param toAngle — новый наклон листа, градусы
 * @param frame — кадр фотографии
 * @returns поля зеркала под новый наклон; наклон не изменился — те же
 */
export const reanchorMirrorOverride = (
  override: RulingMirrorOverride | null,
  fromAngle: number,
  toAngle: number,
  frame: SheetFrame
): RulingMirrorOverride | null => {
  if (!override || !(Math.abs(toAngle - fromAngle) >= NEGLIGIBLE_SKEW_CHANGE)) {
    return override;
  }

  const { marginLeft, marginRight, marginLineX, marginLineSide, sideSlant } = override;
  const page = reanchorPageEdges(
    {
      step: 0,
      firstLinePhase: 0,
      skewAngle: -toAngle,
      margins: { top: 0, right: marginRight, bottom: 0, left: marginLeft },
      marginLineX,
      marginLineSide,
      sideSlant,
      bend: null,
      perspective: null,
      outline: null,
      mirrorOverride: null,
    },
    -fromAngle,
    frame
  );

  return {
    marginLineX: page.marginLineX,
    marginLineSide,
    marginLeft: page.margins.left,
    marginRight: page.margins.right,
    sideSlant: page.sideSlant,
  };
};

/**
 * Разлиновка после смены наклона, у которой боковые поля, линия поля и поля
 * зеркала стоят на фотографии там же, где стояли при наклоне `fromAngle`.
 *
 * Концы границ записаны в системе блока, повёрнутой на наклон вокруг левого
 * верхнего угла кадра: при новом наклоне те же числа повернули бы границы
 * вокруг него, и к низу кадра они уехали бы на высоту, умноженную на
 * изменение угла. Граница, шедшая перпендикулярно прежним строкам, к новым
 * строкам наклонена, и её концы у низа кадра записываются отдельно. Верхнее и
 * нижнее поля — высоты у левого края кадра, их смена наклона не трогает.
 *
 * @param ruling — разлиновка с новым наклоном и прежними концами границ
 * @param fromAngle — наклон, при котором концы записаны, градусы
 * @param frame — кадр фотографии
 * @returns разлиновка с концами под новый наклон; наклон не изменился — та же
 */
export const reanchorSideEdges = (
  ruling: SheetRuling,
  fromAngle: number,
  frame: SheetFrame
): SheetRuling => {
  if (!(Math.abs(ruling.skewAngle - fromAngle) >= NEGLIGIBLE_SKEW_CHANGE)) {
    return ruling;
  }

  return {
    ...reanchorPageEdges(ruling, fromAngle, frame),
    mirrorOverride: reanchorMirrorOverride(
      ruling.mirrorOverride,
      fromAngle,
      ruling.skewAngle,
      frame
    ),
  };
};
