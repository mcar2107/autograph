import { deriveRulingPins } from '@pages/Generator/lib/paper';
import type { RulingKind, RulingPin } from '@pages/Generator/lib/paper/paper.types';
import { parseStoredUserSheet } from '@pages/Generator/model/paperSheetJson';
import { describe, expect, it } from 'vitest';

/**
 * Кадр фотографии записи.
 */
const FRAME = { width: 480, height: 640 };

/**
 * Замена полей зеркала: несимметричная, по ней видно, что вернулась именно
 * она, а не отражение.
 */
const MIRROR_OVERRIDE = {
  marginLineX: 400,
  marginLineSide: 'right',
  marginLeft: 50,
  marginRight: 90,
};

/**
 * Разлиновка после ручной правки: шаг отличается от найденного автоматом.
 */
const RULING: Record<string, unknown> = {
  step: 40,
  firstLinePhase: 80,
  skewAngle: 0.5,
  margins: { top: 80, right: 60, bottom: 60, left: 70 },
  marginLineX: 70,
  marginLineSide: 'left',
  mirrorOverride: MIRROR_OVERRIDE,
};

/**
 * Разлиновка, найденная автоматом.
 */
const MEASURED_RULING: Record<string, unknown> = {
  ...RULING,
  step: 41,
  mirrorOverride: null,
};

/**
 * Булавки ручной правки: номера и концы не совпадают с выведенными из
 * разлиновки.
 */
const PINS: RulingPin[] = [
  { index: 0, left: { x: 72, y: 81 }, right: { x: 410, y: 84 } },
  { index: 12, left: { x: 71, y: 561 }, right: { x: 411, y: 563 } },
];

/**
 * Вид семьи по идентификатору: так запись прежней формы получает вид.
 *
 * @param familyId — семья записи
 * @returns вид разлиновки семьи
 */
const resolveFamilyKind = (familyId: string): RulingKind => {
  return familyId === 'lined' ? 'lined' : 'grid';
};

/**
 * Запись новой формы со всеми полями.
 *
 * @returns запись так, как её отдаёт IndexedDB
 */
const buildRecord = (): Record<string, unknown> => {
  return {
    id: 'sheet-1',
    familyId: 'grid',
    kind: 'lined',
    label: 'Мой лист',
    width: FRAME.width,
    height: FRAME.height,
    ruling: RULING,
    measuredRuling: MEASURED_RULING,
    measuredKind: 'grid',
    pins: PINS,
    lighting: null,
    source: new Blob(['jpeg'], { type: 'image/jpeg' }),
    texture: {
      image: new Blob(['png'], { type: 'image/png' }),
      width: 120,
      height: 160,
      amplitude: 0.08,
    },
  };
};

/**
 * Запись без одного поля.
 *
 * @param key — какое поле убрать
 * @returns запись без поля
 */
const omitField = (key: string): Record<string, unknown> => {
  const { [key]: _omitted, ...rest } = buildRecord();

  return rest;
};

describe('запись своего листа в IndexedDB', () => {
  it('полная запись читается со всеми полями', () => {
    const record = buildRecord();
    const sheet = parseStoredUserSheet(record, resolveFamilyKind);

    expect(sheet?.id).toBe('sheet-1');
    expect(sheet?.familyId).toBe('grid');
    expect(sheet?.kind).toBe('lined');
    expect(sheet?.label).toBe('Мой лист');
    expect(sheet?.ruling.step).toBe(40);
    expect(sheet?.ruling.mirrorOverride).toEqual(MIRROR_OVERRIDE);
    expect(sheet?.measuredRuling.step).toBe(41);
    expect(sheet?.measuredKind).toBe('grid');
    expect(sheet?.pins).toEqual(PINS);
    expect(sheet?.source).toBe(record.source);
    expect(sheet?.texture).toEqual({
      image: expect.any(Blob),
      width: 120,
      height: 160,
      amplitude: 0.08,
    });
  });

  it('запись без вида получает вид своей семьи', () => {
    const sheet = parseStoredUserSheet(
      { ...omitField('kind'), familyId: 'lined' },
      resolveFamilyKind
    );

    expect(sheet?.kind).toBe('lined');
  });

  it('запись без вида, добавленная без разлиновки, читается чистым листом', () => {
    const sheet = parseStoredUserSheet(
      { ...omitField('kind'), isBlank: true },
      resolveFamilyKind
    );

    expect(sheet?.kind).toBe('blank');
  });

  it('нечитаемый вид заменяется видом семьи', () => {
    const sheet = parseStoredUserSheet(
      { ...buildRecord(), kind: 'dotted' },
      resolveFamilyKind
    );

    expect(sheet?.kind).toBe('grid');
  });

  it('запись без фотографии отбрасывается: показывать нечего', () => {
    expect(parseStoredUserSheet(omitField('source'), resolveFamilyKind)).toBeNull();
    expect(
      parseStoredUserSheet(
        { ...buildRecord(), source: 'data:image/jpeg;base64,0123' },
        resolveFamilyKind
      )
    ).toBeNull();
  });

  it('запись без карты текстуры читается листом без текстуры', () => {
    expect(
      parseStoredUserSheet(omitField('texture'), resolveFamilyKind)?.texture
    ).toBeNull();
    expect(
      parseStoredUserSheet(
        { ...buildRecord(), texture: { width: 120, height: 160, amplitude: 0.08 } },
        resolveFamilyKind
      )?.texture
    ).toBeNull();
  });

  it('запись без найденной разметки берёт найденной свою', () => {
    const sheet = parseStoredUserSheet(omitField('measuredRuling'), resolveFamilyKind);

    expect(sheet?.measuredRuling).toEqual(sheet?.ruling);
  });

  it('запись без найденного вида и с нечитаемым найденным видом берёт вид листа', () => {
    const missing = parseStoredUserSheet(omitField('measuredKind'), resolveFamilyKind);
    const broken = parseStoredUserSheet(
      { ...buildRecord(), measuredKind: 'spiral' },
      resolveFamilyKind
    );

    expect(missing?.measuredKind).toBe('lined');
    expect(broken?.measuredKind).toBe('lined');
  });

  it('запись без булавок получает выведенные из разлиновки', () => {
    const sheet = parseStoredUserSheet(omitField('pins'), resolveFamilyKind);

    expect(sheet).not.toBeNull();
    expect(sheet?.pins).toEqual(deriveRulingPins(sheet!.ruling, FRAME));
    expect(sheet?.pins.length).toBeGreaterThanOrEqual(2);
  });

  it('испорченные булавки заменяются выведенными целиком', () => {
    const [first] = PINS;
    const brokenPins = [first, { index: 12, left: { x: 71 }, right: { x: 411, y: 563 } }];
    const broken = parseStoredUserSheet(
      { ...buildRecord(), pins: brokenPins },
      resolveFamilyKind
    );
    const single = parseStoredUserSheet(
      { ...buildRecord(), pins: [first] },
      resolveFamilyKind
    );
    const fractional = parseStoredUserSheet(
      {
        ...buildRecord(),
        pins: PINS.map((pin) => {
          return { ...pin, index: pin.index + 0.5 };
        }),
      },
      resolveFamilyKind
    );

    expect(broken?.pins).toEqual(deriveRulingPins(broken!.ruling, FRAME));
    expect(single?.pins).toEqual(deriveRulingPins(single!.ruling, FRAME));
    expect(fractional?.pins).toEqual(deriveRulingPins(fractional!.ruling, FRAME));
  });

  it('разлиновка без замены полей зеркала отражает оригинал', () => {
    const { mirrorOverride: _omitted, ...ruling } = RULING;
    const sheet = parseStoredUserSheet({ ...buildRecord(), ruling }, resolveFamilyKind);

    expect(sheet?.ruling.mirrorOverride).toBeNull();
  });

  it('запись до разлиновки экземпляра берёт шаг и фазу из своих полей', () => {
    const record = {
      ...omitField('ruling'),
      measuredStep: 36,
      firstLinePhase: 50,
      skewAngle: 0.2,
    };
    const sheet = parseStoredUserSheet(record, resolveFamilyKind);

    expect(sheet?.ruling.step).toBe(36);
    expect(sheet?.ruling.firstLinePhase).toBe(50);
    expect(sheet?.ruling.marginLineX).toBeNull();
    expect(sheet?.ruling.mirrorOverride).toBeNull();
  });
});
