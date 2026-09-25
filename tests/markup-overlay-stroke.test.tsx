/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildSheetRuling, type RulingPin } from '@pages/Generator/lib/paper';
import {
  type MarkupLayerId,
  MarkupOverlay,
} from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupOverlay';
import { MarkupScaleContext } from '@pages/Generator/ui/Generator/SettingsPane/SheetMarkupEditor/MarkupViewport';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const FRAME = { width: 600, height: 800 };

const RULING = buildSheetRuling(
  {
    step: 30,
    firstLinePhase: 12,
    skewAngle: 0.5,
    margins: { top: 90, right: 40, bottom: 70, left: 60 },
    marginLineX: 100,
    marginLineSide: 'left',
  },
  FRAME
);

const PINS: RulingPin[] = [
  { index: 3, left: { x: 80, y: 100 }, right: { x: 520, y: 104 } },
  { index: 12, left: { x: 80, y: 370 }, right: { x: 520, y: 374 } },
];

const LAYERS: MarkupLayerId[] = ['lines', 'margins', 'marginLine', 'outline', 'pins'];

/**
 * Токен цвета штриха у каждого слоя: слои различимы между собой только
 * цветом и пунктиром, поэтому у каждого свой.
 */
const LAYER_TOKENS: Record<MarkupLayerId, string> = {
  lines: 'markup-line',
  margins: 'markup-margin',
  marginLine: 'markup-margin-line',
  outline: 'markup-outline',
  pins: 'markup-pin',
};

const HALO_TOKEN = 'markup-halo';

/**
 * Краски редактора, которые ложатся на фотографию: слои и подсветка линии
 * в «Изгибе».
 */
const PAINT_TOKENS = [...Object.values(LAYER_TOKENS), 'markup-highlight'];

/**
 * Тон красной черты поля на снимке, градусы oklch.
 */
const RED_HUE = 25;

/**
 * Насколько тон линии поля разметки должен отстоять от красного, градусы, —
 * или она должна быть почти без цвета.
 */
const MIN_HUE_DISTANCE = 60;

const MAX_NEUTRAL_CHROMA = 0.03;

/**
 * Наименьшее расстояние двух красок в oklab: у самой близкой пары слоёв —
 * линий и булавок — 0,16, а заметная разница оттенков начинается с 0,02.
 */
const MIN_PAINT_DISTANCE = 0.15;

/**
 * Подложка шире основного штриха не больше чем на пиксель с каждой стороны:
 * при зуме, где пиксель фото — четыре экранных, линия фото толщиной в два
 * пикселя остаётся видна по краям.
 */
const MAX_HALO_SIDE_PX = 1;

/**
 * Две краски штриха контрастны между собой не меньше 9:1 — тогда на любом
 * фоне хотя бы одна из них даёт 3:1 (WCAG 1.4.11, техника C40).
 */
const MIN_PAIR_CONTRAST = 9;

/**
 * Самая тёмная бумага живых снимков — пятый процентиль яркости середины
 * листа у `IMG_1705` (у `IMG_1813` 0,215, у `IMG_1808` 0,37).
 */
const DARKEST_PAPER_LUMINANCE = 0.17;

/**
 * Наименьший контраст краски слоя к подложке над бумагой: WCAG 1.4.11.
 */
const MIN_LINE_CONTRAST = 3;

/**
 * Какая доля перепада «линия фото — бумага» должна остаться под подложкой:
 * меньше половины — и линия снимка под разметкой не видна, совпадение не
 * проверить.
 */
const MIN_PHOTO_LINE_SHARE = 0.5;

/**
 * Прозрачность приглушённых слоёв под пробным текстом: сквозь линии должны
 * читаться буквы.
 */
const MAX_MUTED_OPACITY = 0.25;

const handleLayerChange = () => {};

/**
 * Масштабы просмотра: мелкий обзор листа и приближение, где пиксель фото —
 * четыре экранных.
 */
const SCALES = [0.36, 4];

/**
 * Оверлей со всеми слоями.
 *
 * @param scale — масштаб просмотра
 * @param mode — приглушён ли он под пробным текстом и скрыт ли клавишей
 * @returns контейнер с оверлеем
 */
const renderOverlay = (scale = 1, mode = { isMuted: false, isHidden: false }) => {
  const { container } = render(
    <MarkupScaleContext value={scale}>
      <MarkupOverlay
        frame={FRAME}
        ruling={RULING}
        pins={PINS}
        layers={{
          lines: true,
          margins: true,
          marginLine: true,
          outline: true,
          pins: true,
        }}
        tool="lines"
        isMuted={mode.isMuted}
        isHidden={mode.isHidden}
        onHandleLayerChange={handleLayerChange}
      />
    </MarkupScaleContext>
  );

  return container;
};

/**
 * Толщины штриха и подложки и пунктир слоя в экранных пикселях.
 *
 * @param layer — слой разметки
 * @param scale — масштаб просмотра
 * @returns экранные размеры
 */
const readScreenStroke = (layer: MarkupLayerId, scale: number) => {
  const container = renderOverlay(scale);
  const geometry = container.querySelector(`[data-layer="${layer}"]`);
  const halo = container.querySelector(`use[href="#${geometry?.id}"]`);
  const dash = geometry?.getAttribute('stroke-dasharray');

  const screen = {
    core: Number(geometry?.parentElement?.getAttribute('stroke-width')) * scale,
    halo: Number(halo?.getAttribute('stroke-width')) * scale,
    dash: dash
      ? dash.split(' ').map((length) => {
          return Math.round(Number(length) * scale * 1000) / 1000;
        })
      : null,
  };

  cleanup();

  return screen;
};

/**
 * Разбирает `oklch(L% C Hdeg)` в числа.
 *
 * @param value — значение токена
 * @returns светлота в долях, хрома и тон в градусах
 */
const parseOklch = (value: string): [number, number, number] => {
  const match = /oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:deg)?\)/.exec(value);

  if (!match) {
    throw new Error(`Не oklch: ${value}`);
  }

  const [, lightness, chroma, hue] = match;

  return [Number(lightness) / 100, Number(chroma), Number(hue)];
};

/**
 * Расстояние двух цветов oklch в oklab.
 *
 * @param first — значение первого токена
 * @param second — значение второго токена
 * @returns ΔE_ok
 */
const toOklabDistance = (first: string, second: string): number => {
  const [firstL, firstA, firstB] = toOklab(first);
  const [secondL, secondA, secondB] = toOklab(second);

  return Math.hypot(firstL - secondL, firstA - secondA, firstB - secondB);
};

/**
 * Координаты oklab цвета oklch.
 *
 * @param value — значение токена
 * @returns `[L, a, b]`
 */
const toOklab = (value: string): [number, number, number] => {
  const [lightness, chroma, hue] = parseOklch(value);
  const radians = (hue * Math.PI) / 180;

  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
};

/**
 * Относительная яркость WCAG цвета oklch: через линейный sRGB с обрезкой
 * по охвату.
 *
 * @param value — значение токена
 * @returns яркость 0…1
 */
const toLuminance = (value: string): number => {
  const [lightness, chroma, hue] = parseOklch(value);
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;

  const clamp = (channel: number) => {
    return Math.min(Math.max(channel, 0), 1);
  };

  const red = clamp(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s);
  const green = clamp(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s);
  const blue = clamp(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/**
 * Значение цветового токена темы с подстановкой `var(--color-…)` из палитры
 * Tailwind.
 *
 * @param token — имя токена без `--color-`
 * @returns значение `oklch(…)` или `#fff`
 */
const readColorToken = (token: string): string => {
  const sources = [
    readFileSync(resolve(__dirname, '../src/app/styles/app.css'), 'utf8'),
    readFileSync(resolve(__dirname, '../node_modules/tailwindcss/theme.css'), 'utf8'),
  ];
  const pattern = new RegExp(`--color-${token}:\\s*([^;]+);`);
  const source = sources.find((candidate) => {
    return pattern.test(candidate);
  });
  const match = source ? pattern.exec(source) : null;

  if (!match?.[1]) {
    throw new Error(`Нет токена --color-${token}`);
  }

  const value = match[1].trim();
  const reference = /^var\(--color-([\w-]+)\)$/.exec(value);

  return reference?.[1] ? readColorToken(reference[1]) : value;
};

/**
 * Яркость WCAG серого цвета, заданного в sRGB.
 *
 * @param channel — канал sRGB 0…1
 * @returns относительная яркость
 */
const toGrayLuminance = (channel: number): number => {
  return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

/**
 * Канал sRGB серого цвета заданной яркости.
 *
 * @param luminance — относительная яркость
 * @returns канал 0…1
 */
const toGrayChannel = (luminance: number): number => {
  return luminance <= 0.003_130_8
    ? luminance * 12.92
    : 1.055 * luminance ** (1 / 2.4) - 0.055;
};

const toContrast = (first: number, second: number): number => {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

/**
 * Прозрачность подложки: у `<use>` слоя линий.
 *
 * @returns непрозрачность 0…1
 */
const readHaloOpacity = (): number => {
  const container = renderOverlay();
  const geometry = container.querySelector('[data-layer="lines"]');
  const halo = container.querySelector(`use[href="#${geometry?.id}"]`);
  const opacity = Number(halo?.getAttribute('opacity') || '1');

  cleanup();

  return opacity;
};

const readLuminance = (token: string): number => {
  const value = readColorToken(token);

  return value === '#fff' ? 1 : toLuminance(value);
};

afterEach(() => {
  cleanup();
});

describe('штрих разметки', () => {
  it.each(LAYERS)(
    'слой %s рисуется двойным штрихом: подложка под цветом слоя',
    (layer) => {
      const container = renderOverlay();
      const geometry = container.querySelector<SVGGElement>(`[data-layer="${layer}"]`);

      if (!geometry) {
        throw new Error(`Нет слоя ${layer}`);
      }

      const core = geometry.parentElement;
      const halo = container.querySelector(`use[href="#${geometry.id}"]`);

      expect(geometry.id).not.toBe('');
      expect(core?.getAttribute('class')).toContain(`stroke-${LAYER_TOKENS[layer]}`);
      expect(halo?.getAttribute('class')).toContain(`stroke-${HALO_TOKEN}`);

      const coreWidth = Number(core?.getAttribute('stroke-width'));
      const haloWidth = Number(halo?.getAttribute('stroke-width'));

      expect(haloWidth).toBeGreaterThan(coreWidth);
      expect(haloWidth - coreWidth).toBeLessThanOrEqual(2 * MAX_HALO_SIDE_PX);
    }
  );

  it.each(LAYERS)('штрих слоя %s не масштабируется зумом', (layer) => {
    const [overview, closeUp] = SCALES.map((scale) => {
      return readScreenStroke(layer, scale);
    });

    expect(closeUp?.core).toBeCloseTo(overview?.core || 0, 6);
    expect(closeUp?.halo).toBeCloseTo(overview?.halo || 0, 6);
    expect(closeUp?.dash).toEqual(overview?.dash);
  });

  it.each(LAYERS)('фигуры слоя %s толщину не задают сами', (layer) => {
    const container = renderOverlay();
    const shapes = container.querySelectorAll(
      `[data-layer="${layer}"] :is(line, polyline, polygon, circle)`
    );

    expect(shapes.length).toBeGreaterThan(0);

    for (const shape of shapes) {
      expect(shape.hasAttribute('stroke-width')).toBe(false);
      expect(shape.hasAttribute('vector-effect')).toBe(false);
    }
  });

  it('у слоёв разные цвета', () => {
    const container = renderOverlay();
    const colors = LAYERS.map((layer) => {
      return container
        .querySelector(`[data-layer="${layer}"]`)
        ?.parentElement?.getAttribute('class');
    });

    expect(new Set(colors).size).toBe(LAYERS.length);
  });

  it.each(PAINT_TOKENS)('цвет %s и подложка контрастны не меньше 9:1', (token) => {
    const halo = readLuminance(HALO_TOKEN);
    const core = readLuminance(token);
    const contrast = (Math.max(halo, core) + 0.05) / (Math.min(halo, core) + 0.05);

    expect(contrast).toBeGreaterThanOrEqual(MIN_PAIR_CONTRAST);
  });
});

describe('роли красок', () => {
  it('линия поля разметки не того цвета, что красная черта на снимке', () => {
    const [, chroma, hue] = parseOklch(readColorToken(LAYER_TOKENS.marginLine));
    const distance = Math.abs(((hue - RED_HUE + 540) % 360) - 180);

    expect(chroma <= MAX_NEUTRAL_CHROMA || distance >= MIN_HUE_DISTANCE).toBe(true);
  });

  it.each(Object.values(LAYER_TOKENS))(
    'подсветка линии в «Изгибе» отличима от краски %s',
    (token) => {
      expect(
        toOklabDistance(readColorToken('markup-highlight'), readColorToken(token))
      ).toBeGreaterThanOrEqual(MIN_PAINT_DISTANCE);
    }
  );

  it('подсветка линии в «Изгибе» — своя краска, не краска закреплённых линий', () => {
    expect(readColorToken('markup-highlight')).not.toBe(
      readColorToken(LAYER_TOKENS.pins)
    );
  });
});

describe('подложка штриха', () => {
  it('полупрозрачна: линия фото под ней сохраняет не меньше половины перепада', () => {
    const opacity = readHaloOpacity();

    expect(opacity).toBeGreaterThan(0);
    expect(1 - opacity).toBeGreaterThanOrEqual(MIN_PHOTO_LINE_SHARE);
  });

  it.each(PAINT_TOKENS)(
    'на самой тёмной бумаге снимков краска %s контрастна подложке над бумагой не меньше 3:1',
    (token) => {
      const opacity = readHaloOpacity();
      const paper = toGrayChannel(DARKEST_PAPER_LUMINANCE);
      const halo = toGrayLuminance((1 - opacity) * paper + opacity);

      expect(toContrast(readLuminance(token), halo)).toBeGreaterThanOrEqual(
        MIN_LINE_CONTRAST
      );
    }
  );
});

describe('приглушение и скрытие', () => {
  it.each(['lines', 'margins', 'marginLine', 'outline'] as const)(
    'под пробным текстом слой %s приглушён вместе с подложкой',
    (layer) => {
      const container = renderOverlay(1, { isMuted: true, isHidden: false });
      const geometry = container.querySelector(`[data-layer="${layer}"]`);
      const muted = geometry?.closest('[data-muted]');
      const halo = container.querySelector(`use[href="#${geometry?.id}"]`);

      expect(Number(muted?.getAttribute('opacity'))).toBeLessThanOrEqual(
        MAX_MUTED_OPACITY
      );
      expect(muted?.contains(halo || null)).toBe(true);
    }
  );

  it('без пробного текста слои не приглушены', () => {
    const container = renderOverlay();

    expect(container.querySelector('[data-muted]')).toBeNull();
  });

  it('под пробным текстом у закреплённых линий остаются только концы, не приглушённые', () => {
    const container = renderOverlay(1, { isMuted: true, isHidden: false });
    const pins = container.querySelector('[data-layer="pins"]');

    expect(pins?.querySelectorAll('line')).toHaveLength(0);
    expect(pins?.querySelectorAll('circle')).toHaveLength(2 * PINS.length);
    expect(pins?.closest('[data-muted]')).toBeNull();
  });

  it('без пробного текста закреплённая линия рисуется целиком', () => {
    const container = renderOverlay();
    const pins = container.querySelector('[data-layer="pins"]');

    expect(pins?.querySelectorAll('line')).toHaveLength(PINS.length);
  });

  it('скрытая клавишей разметка не видна и не ловит указатель, но остаётся в документе', () => {
    const shown = renderOverlay().querySelector('svg');

    expect(shown?.classList.contains('opacity-0')).toBe(false);

    cleanup();

    const hidden = renderOverlay(1, { isMuted: false, isHidden: true }).querySelector(
      'svg'
    );

    expect(hidden?.classList.contains('opacity-0')).toBe(true);
    expect(hidden?.classList.contains('pointer-events-none')).toBe(true);
    expect(hidden?.querySelector('[data-layer="handles"]')).not.toBeNull();
  });
});
