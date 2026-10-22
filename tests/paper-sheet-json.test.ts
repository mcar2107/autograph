import type {
  RulingBend,
  RulingPerspective,
  SheetOutline,
} from '@pages/Generator/lib/paper/paper.types';
import { parsePaperSheet } from '@pages/Generator/model/paperSheetJson';
import { describe, expect, it } from 'vitest';

/**
 * Сетка изгиба с несимметричными смещениями: по ним видно, что разбор вернул
 * именно записанные числа, а не нули.
 */
const BEND: RulingBend = {
  columnOrigin: 60,
  columnSpacing: 120,
  columnCount: 3,
  rowOrigin: 80,
  rowSpacing: 40,
  rowCount: 2,
  offsets: [0, 1.25, -0.5, 0.75, 2, -1.5],
};

/**
 * Разлиновка записи новой формы без изгиба. Шаг ненулевой: без шага изгиба не
 * бывает, и проверка разбора упёрлась бы в это правило.
 */
const RULING: Record<string, unknown> = {
  step: 40,
  firstLinePhase: 80,
  skewAngle: 0.5,
  margins: { top: 80, right: 60, bottom: 60, left: 60 },
  marginLineX: null,
  marginLineSide: null,
};

/**
 * Запись экземпляра так, как её оставили артефакт или хранилище.
 *
 * @param ruling — разлиновка записи
 * @returns разобранный JSON экземпляра
 */
const buildEntry = (ruling: Record<string, unknown>): Record<string, unknown> => {
  return {
    id: 'sheet-1',
    label: 'Лист',
    src: 'data:image/jpeg;base64,0123456789',
    width: 480,
    height: 640,
    ruling,
  };
};

/**
 * Сетка изгиба без одного поля.
 *
 * @param key — какое поле убрать
 * @returns сетка без поля
 */
const omitBendField = (key: keyof RulingBend): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(BEND).filter(([name]) => {
      return name !== key;
    })
  );
};

/**
 * Случай испорченного изгиба.
 */
type CorruptedBend = {
  /**
   * Признак порчи — попадает в название теста.
   */
  name: string;

  /**
   * Изгиб так, как он лежит в записи.
   */
  bend: unknown;
};

/**
 * Каждый признак порчи — отдельным случаем: разбор, пропустивший один из них,
 * отдал бы отрисовке сетку, выборка по которой читает мимо смещений.
 */
const CORRUPTED_BENDS: CorruptedBend[] = [
  { name: 'строк больше, чем смещений', bend: { ...BEND, rowCount: 3 } },
  { name: 'узлов в строке меньше, чем смещений', bend: { ...BEND, columnCount: 2 } },
  { name: 'дробное число узлов', bend: { ...BEND, columnCount: 1.5, rowCount: 4 } },
  { name: 'нулевой интервал между узлами', bend: { ...BEND, columnSpacing: 0 } },
  { name: 'отрицательный интервал между строками', bend: { ...BEND, rowSpacing: -40 } },
  {
    name: 'смещение строкой',
    bend: { ...BEND, offsets: [0, '1.25', -0.5, 0.75, 2, -1.5] },
  },
  { name: 'смещение null', bend: { ...BEND, offsets: [0, null, -0.5, 0.75, 2, -1.5] } },
  { name: 'начало сетки строкой', bend: { ...BEND, columnOrigin: '60' } },
  { name: 'смещения не массивом', bend: { ...BEND, offsets: 'offsets' } },
  { name: 'нет начала строк', bend: omitBendField('rowOrigin') },
  { name: 'нет смещений', bend: omitBendField('offsets') },
  { name: 'изгиб не объектом', bend: 42 },
];

describe('разбор изгиба линий из JSON', () => {
  it('читает изгиб записи строго равным записанному', () => {
    const sheet = parsePaperSheet(buildEntry({ ...RULING, bend: BEND }));

    expect(sheet?.ruling.bend).toStrictEqual(BEND);
  });

  it('оставляет в списке запись без изгиба ровным листом', () => {
    const sheet = parsePaperSheet(buildEntry(RULING));

    expect(sheet).not.toBeNull();
    expect(sheet?.ruling.bend).toBeNull();
  });

  it('читает явный null ровным листом', () => {
    const sheet = parsePaperSheet(buildEntry({ ...RULING, bend: null }));

    expect(sheet).not.toBeNull();
    expect(sheet?.ruling.bend).toBeNull();
  });

  it.each(CORRUPTED_BENDS)(
    'оставляет в списке ровным лист с испорченным изгибом: $name',
    ({ bend }) => {
      const sheet = parsePaperSheet(buildEntry({ ...RULING, bend }));

      expect(sheet).not.toBeNull();
      expect(sheet?.ruling.step).toBe(40);
      expect(sheet?.ruling.bend).toBeNull();
    }
  );
});

/**
 * Контур листа на столе с несимметричными углами: по ним видно, что разбор
 * не переставил углы местами.
 */
const OUTLINE: SheetOutline = {
  topLeft: { x: 20.5, y: 14 },
  topRight: { x: 455, y: 9.25 },
  bottomRight: { x: 462, y: 628 },
  bottomLeft: { x: 12, y: 633.5 },
};

/**
 * Перспектива с началом в середине кадра записи: знаменатель модели на кадре
 * не меньше 0,9.
 */
const PERSPECTIVE: RulingPerspective = {
  originX: 240,
  originY: 320,
  convergenceX: 0.000_01,
  convergenceY: 0.000_2,
};

/**
 * Случай испорченного поля записи.
 */
type CorruptedField = {
  /**
   * Признак порчи — попадает в название теста.
   */
  name: string;

  /**
   * Поле так, как оно лежит в записи.
   */
  value: unknown;
};

/**
 * Контур без одного угла.
 *
 * @param key — какой угол убрать
 * @returns контур без угла
 */
const omitOutlineCorner = (key: keyof SheetOutline): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(OUTLINE).filter(([name]) => {
      return name !== key;
    })
  );
};

/**
 * Каждый признак порчи контура — отдельным случаем: контур, прочитанный с
 * одним негодным углом, увёл бы вырезку и фолбэк полей мимо листа.
 */
const CORRUPTED_OUTLINES: CorruptedField[] = [
  { name: 'три угла', value: omitOutlineCorner('bottomLeft') },
  { name: 'угол null', value: { ...OUTLINE, topRight: null } },
  { name: 'угол без координаты', value: { ...OUTLINE, bottomRight: { x: 462 } } },
  { name: 'координата строкой', value: { ...OUTLINE, topLeft: { x: '20.5', y: 14 } } },
  { name: 'координата NaN', value: { ...OUTLINE, bottomLeft: { x: Number.NaN, y: 1 } } },
  {
    name: 'координата бесконечна',
    value: { ...OUTLINE, topLeft: { x: 20.5, y: Number.POSITIVE_INFINITY } },
  },
  { name: 'углы массивом', value: Object.values(OUTLINE) },
  { name: 'контур не объектом', value: 'outline' },
];

/**
 * Каждый признак порчи перспективы — отдельным случаем: у перспективы за
 * горизонтом на кадре координата вдоль линий не определена, и строки ушли бы
 * в бесконечность.
 */
const CORRUPTED_PERSPECTIVES: CorruptedField[] = [
  { name: 'нет начала по ширине', value: { ...PERSPECTIVE, originX: undefined } },
  { name: 'схождение строкой', value: { ...PERSPECTIVE, convergenceX: '0.00001' } },
  { name: 'схождение null', value: { ...PERSPECTIVE, convergenceY: null } },
  { name: 'начало NaN', value: { ...PERSPECTIVE, originY: Number.NaN } },
  {
    name: 'схождение бесконечно',
    value: { ...PERSPECTIVE, convergenceY: Number.NEGATIVE_INFINITY },
  },
  {
    name: '1 − a·q < 0 у правого края при начале под кадром',
    value: { originX: 240, originY: 2000, convergenceX: -0.005, convergenceY: -0.001 },
  },
  {
    name: 'горизонт внизу кадра',
    value: { ...PERSPECTIVE, convergenceX: 0, convergenceY: -0.004 },
  },
  {
    name: 'горизонт по ширине внутри кадра',
    value: { ...PERSPECTIVE, convergenceX: -0.005, convergenceY: 0 },
  },
  { name: 'перспектива не объектом', value: [240, 320, 0, 0] },
];

describe('разбор контура листа и перспективы из JSON', () => {
  it('читает контур и перспективу строго равными записанным', () => {
    const sheet = parsePaperSheet(
      buildEntry({ ...RULING, outline: OUTLINE, perspective: PERSPECTIVE })
    );

    expect(sheet?.ruling.outline).toStrictEqual(OUTLINE);
    expect(sheet?.ruling.perspective).toStrictEqual(PERSPECTIVE);
  });

  it('читает запись без контура и перспективы листом во весь кадр без перспективы', () => {
    const sheet = parsePaperSheet(buildEntry(RULING));

    expect(sheet?.ruling.step).toBe(40);
    expect(sheet?.ruling.margins).toStrictEqual(RULING.margins);
    expect(sheet?.ruling.outline).toBeNull();
    expect(sheet?.ruling.perspective).toBeNull();
  });

  it.each(CORRUPTED_OUTLINES)(
    'оставляет в списке листом во весь кадр лист с испорченным контуром: $name',
    ({ value }) => {
      const sheet = parsePaperSheet(
        buildEntry({ ...RULING, outline: value, perspective: PERSPECTIVE })
      );

      expect(sheet?.ruling.step).toBe(40);
      expect(sheet?.ruling.outline).toBeNull();
      expect(sheet?.ruling.perspective).toStrictEqual(PERSPECTIVE);
    }
  );

  it.each(CORRUPTED_PERSPECTIVES)(
    'оставляет в списке без перспективы лист с испорченной перспективой: $name',
    ({ value }) => {
      const sheet = parsePaperSheet(
        buildEntry({ ...RULING, outline: OUTLINE, perspective: value })
      );

      expect(sheet?.ruling.step).toBe(40);
      expect(sheet?.ruling.perspective).toBeNull();
      expect(sheet?.ruling.outline).toStrictEqual(OUTLINE);
    }
  );
});

describe('разбор полей зеркала из JSON', () => {
  const MIRROR_OVERRIDE = {
    marginLineX: 120,
    marginLineSide: 'left',
    marginLeft: 140,
    marginRight: 50,
  };

  it('читает поля зеркала строго равными записанным', () => {
    const sheet = parsePaperSheet(
      buildEntry({ ...RULING, mirrorOverride: MIRROR_OVERRIDE })
    );

    expect(sheet?.ruling.mirrorOverride).toStrictEqual({
      ...MIRROR_OVERRIDE,
      sideSlant: null,
    });
  });

  it('читает запись без полей зеркала отражением', () => {
    expect(parsePaperSheet(buildEntry(RULING))?.ruling.mirrorOverride).toBeNull();
  });

  it.each([
    { name: 'боковое поле строкой', value: { ...MIRROR_OVERRIDE, marginLeft: '140' } },
    { name: 'нет правого поля', value: { ...MIRROR_OVERRIDE, marginRight: undefined } },
    { name: 'нулевое поле', value: { ...MIRROR_OVERRIDE, marginRight: 0 } },
    { name: 'не объектом', value: [140, 50] },
  ])('оставляет лист с испорченными полями зеркала отражением: $name', ({ value }) => {
    const sheet = parsePaperSheet(buildEntry({ ...RULING, mirrorOverride: value }));

    expect(sheet?.ruling.mirrorOverride).toBeNull();
    expect(sheet?.ruling.step).toBe(40);
  });

  it('линию поля зеркала без стороны читает отсутствующей', () => {
    const sheet = parsePaperSheet(
      buildEntry({
        ...RULING,
        mirrorOverride: { ...MIRROR_OVERRIDE, marginLineSide: 'top' },
      })
    );

    expect(sheet?.ruling.mirrorOverride).toStrictEqual({
      ...MIRROR_OVERRIDE,
      marginLineX: null,
      marginLineSide: null,
      sideSlant: null,
    });
  });
});

describe('разбор концов полей у низа кадра из JSON', () => {
  const SLANTED_RULING = {
    ...RULING,
    marginLineX: 110,
    marginLineSide: 'left',
    sideSlant: { left: 30, right: 90, marginLineX: 95 },
  };

  it('читает концы у низа строго равными записанным', () => {
    const sheet = parsePaperSheet(buildEntry(SLANTED_RULING));

    expect(sheet?.ruling.sideSlant).toStrictEqual({
      left: 30,
      right: 90,
      marginLineX: 95,
    });
    expect(sheet?.ruling.margins.left).toBe(60);
    expect(sheet?.ruling.marginLineX).toBe(110);
  });

  it('читает запись без концов у низа полями без наклона', () => {
    expect(parsePaperSheet(buildEntry(RULING))?.ruling.sideSlant).toBeNull();
  });

  it('концы, совпавшие с верхними, читает полями без наклона', () => {
    const sheet = parsePaperSheet(
      buildEntry({
        ...SLANTED_RULING,
        sideSlant: { left: 60, right: 60, marginLineX: 110 },
      })
    );

    expect(sheet?.ruling.sideSlant).toBeNull();
  });

  it('конец линии поля без самой линии не читает', () => {
    const sheet = parsePaperSheet(
      buildEntry({ ...RULING, sideSlant: { left: 30, right: 60, marginLineX: 95 } })
    );

    expect(sheet?.ruling.sideSlant).toStrictEqual({
      left: 30,
      right: 60,
      marginLineX: null,
    });
  });

  it.each([
    { name: 'левое поле строкой', value: { left: '30', right: 90, marginLineX: 95 } },
    { name: 'нулевое правое поле', value: { left: 30, right: 0, marginLineX: 95 } },
    { name: 'нет левого поля', value: { right: 90, marginLineX: 95 } },
    { name: 'не объектом', value: [30, 90] },
    {
      name: 'отрицательное левое поле',
      value: { left: -30, right: 90, marginLineX: 95 },
    },
  ])('испорченные концы читает полями без наклона: $name', ({ value }) => {
    const sheet = parsePaperSheet(buildEntry({ ...SLANTED_RULING, sideSlant: value }));

    expect(sheet?.ruling.sideSlant).toBeNull();
    expect(sheet?.ruling.margins.left).toBe(60);
  });

  it('читает концы у низа у полей зеркала', () => {
    const sheet = parsePaperSheet(
      buildEntry({
        ...RULING,
        mirrorOverride: {
          marginLineX: null,
          marginLineSide: null,
          marginLeft: 140,
          marginRight: 50,
          sideSlant: { left: 100, right: 50, marginLineX: null },
        },
      })
    );

    expect(sheet?.ruling.mirrorOverride?.sideSlant).toStrictEqual({
      left: 100,
      right: 50,
      marginLineX: null,
    });
  });

  it.each([
    { name: 'правое поле строкой', value: { left: 100, right: '50', marginLineX: null } },
    { name: 'нулевое левое поле', value: { left: 0, right: 50, marginLineX: null } },
    { name: 'не объектом', value: 'slant' },
  ])(
    'испорченные концы у полей зеркала снимают только наклон зеркала: $name',
    ({ value }) => {
      const sheet = parsePaperSheet(
        buildEntry({
          ...RULING,
          mirrorOverride: {
            marginLineX: null,
            marginLineSide: null,
            marginLeft: 140,
            marginRight: 50,
            sideSlant: value,
          },
        })
      );

      expect(sheet?.ruling.mirrorOverride).toStrictEqual({
        marginLineX: null,
        marginLineSide: null,
        marginLeft: 140,
        marginRight: 50,
        sideSlant: null,
      });
    }
  );
});
