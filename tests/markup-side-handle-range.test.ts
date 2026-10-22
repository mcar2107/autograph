import {
  buildSheetRuling,
  type SheetRuling,
  type SideEdge,
} from '@pages/Generator/lib/paper';
import { formatRangeRejection } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/ExactValues/exactValuesReferences';
import {
  placeExactSideHandleValue,
  readSideHandleRange,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarginsTool/marginsGeometry';
import type {
  SideHandleEnd,
  ValueRange,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarginsTool/marginsGeometry.types';
import {
  placeMirrorSideValue,
  readMirrorSideRange,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MirrorTab/MirrorOverride/mirrorOverrideMarkup';
import { mulberry32 } from '@shared/lib/random';
import { describe, expect, it } from 'vitest';

const FRAME = { width: 600, height: 800 };

const SIDE_EDGES: SideEdge[] = ['left', 'right', 'marginLine'];

const SIDE_ENDS: SideHandleEnd[] = ['top', 'bottom'];

/**
 * Чисел на одну ручку: отрезок, названный в отказе, у ручки поля бывает
 * втрое уже кадра, и на меньшей выборке его края проверялись бы редко.
 */
const SAMPLES_PER_HANDLE = 600;

/**
 * Запас выборки за краями кадра: числа там разметка обязана отвергать.
 */
const SAMPLE_OVERSHOOT = 20;

/**
 * Шаг округления показа: концы отрезка округляются внутрь до десятой, и число
 * между показанным концом и настоящим в пределах десятой — не расхождение.
 */
const SHOWN_ROUNDING = 0.1;

/**
 * Разлиновка листа для выборки.
 *
 * @param skewAngle — наклон строк, рад
 * @param left — левое поле, px
 * @param marginLineX — столбец линии поля; `null` — линии нет
 * @returns разлиновка
 */
const buildRuling = (
  skewAngle: number,
  left: number,
  marginLineX: number | null
): SheetRuling => {
  return buildSheetRuling(
    {
      step: 30,
      firstLinePhase: 12,
      skewAngle,
      margins: { top: 95, right: 40, bottom: 67, left },
      marginLineX,
      marginLineSide: marginLineX === null ? null : 'left',
    },
    FRAME
  );
};

/**
 * Разлиновки выборки: пример из аудита (левое поле 20, верх 95, низ 67), тот
 * же лист без линии поля и листы с наклоном строк в обе стороны.
 */
const RULINGS: Record<string, SheetRuling> = {
  'пример аудита': buildRuling(0.004, 20, 100),
  'без линии поля': buildRuling(0.004, 20, null),
  'наклон вниз': buildRuling(0.03, 60, 120),
  'наклон вверх': buildRuling(-0.03, 60, 120),
};

type PlaceValue = (value: number) => boolean;

/**
 * Концы отрезка так, как их называет причина отказа.
 *
 * @param text — текст отказа
 * @returns концы, px
 */
const parseShownRange = (text: string): ValueRange => {
  const match = /от.(-?[\d,]+) до.(-?[\d,]+)/.exec(text);

  if (!match?.[1] || !match[2]) {
    throw new Error(`Нет отрезка в отказе: ${text}`);
  }

  return {
    min: Number(match[1].replace(',', '.')),
    max: Number(match[2].replace(',', '.')),
  };
};

/**
 * Числа выборки, на которых названный отрезок и принятые числа расходятся.
 *
 * @param text — текст отказа
 * @param place — принимает ли разметка число
 * @param seed — seed выборки
 * @returns расхождения
 */
const collectMismatches = (text: string, place: PlaceValue, seed: number): string[] => {
  const shown = parseShownRange(text);
  const random = mulberry32(seed);
  const mismatches: string[] = [];

  for (let index = 0; index < SAMPLES_PER_HANDLE; index += 1) {
    const value = -SAMPLE_OVERSHOOT + random() * (FRAME.width + 2 * SAMPLE_OVERSHOOT);
    const isAccepted = place(value);
    const isInside = value >= shown.min && value <= shown.max;
    const isOutside =
      value < shown.min - SHOWN_ROUNDING || value > shown.max + SHOWN_ROUNDING;

    if (isInside && !isAccepted) {
      mismatches.push(`${value} внутри ${shown.min}…${shown.max} отвергнуто`);
    }

    if (isOutside && isAccepted) {
      mismatches.push(`${value} вне ${shown.min}…${shown.max} принято`);
    }
  }

  return mismatches;
};

describe('отрезок в отказе конца бокового поля — ровно принимаемые числа', () => {
  const cases = Object.entries(RULINGS).flatMap(([name, ruling]) => {
    return SIDE_EDGES.flatMap((edge) => {
      return SIDE_ENDS.map((end) => {
        return { name, ruling, edge, end };
      });
    });
  });

  it.each(cases)('$name: $edge, $end', ({ ruling, edge, end }) => {
    const text = formatRangeRejection(readSideHandleRange(ruling, FRAME, edge, end));

    const place = (value: number): boolean => {
      return placeExactSideHandleValue(ruling, FRAME, edge, end, value) !== null;
    };

    expect(collectMismatches(text, place, 19)).toStrictEqual([]);
  });

  it.each(cases)('зеркало, $name: $edge, $end', ({ ruling, edge, end }) => {
    const text = formatRangeRejection(readMirrorSideRange(ruling, FRAME, edge, end));

    const place = (value: number): boolean => {
      return placeMirrorSideValue(ruling, FRAME, edge, end, value) !== null;
    };

    expect(collectMismatches(text, place, 23)).toStrictEqual([]);
  });

  it('пример аудита: «Левое поле снизу» 150 отвергнуто, и отрезок его не включает', () => {
    const ruling = RULINGS['пример аудита'];

    if (!ruling) {
      throw new Error('Нет разлиновки примера');
    }

    expect(
      placeExactSideHandleValue(ruling, FRAME, 'left', 'bottom', 100)
    ).not.toBeNull();
    expect(placeExactSideHandleValue(ruling, FRAME, 'left', 'bottom', 150)).toBeNull();
    expect(
      parseShownRange(
        formatRangeRejection(readSideHandleRange(ruling, FRAME, 'left', 'bottom'))
      ).max
    ).toBeLessThan(150);
  });
});
