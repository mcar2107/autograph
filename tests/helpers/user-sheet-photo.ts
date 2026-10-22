import { MARGIN_LINE_GAP_SHARE } from '@pages/Generator/lib/calibrate';
import type { SheetRuling } from '@pages/Generator/lib/paper';
import { useGeneratorStore } from '@pages/Generator/model/useGeneratorStore';
import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

import type { SyntheticField, SyntheticSheetParams } from './synthetic-sheet';

/**
 * Снимок листа в линейку с полями со всех сторон и линией поля слева. Верхнее
 * поле стоит ровно на линии разлиновки, нижнее — ровно под последней, поэтому
 * границы области с линиями совпадают с заданными полями.
 */
export const RULED_PHOTO = {
  width: 420,
  height: 560,
  step: 23.5,
  phase: 8,
  margins: { top: 78.5, right: 36, bottom: 82, left: 60 },
  marginLineX: 96,
};

/**
 * Поля, которые детектор находит на этом снимке: низ — на крайней линии, верх
 * — на линии над первой, чтобы первая строка встала на первую линию, а бока
 * отступают от границы области с линиями на зазор, как от линии поля, —
 * граница сама служит полем.
 */
export const RULED_PHOTO_FOUND_MARGINS = {
  ...RULED_PHOTO.margins,
  top: RULED_PHOTO.margins.top - RULED_PHOTO.step,
  right: RULED_PHOTO.margins.right + RULED_PHOTO.step * MARGIN_LINE_GAP_SHARE,
  left: RULED_PHOTO.margins.left + RULED_PHOTO.step * MARGIN_LINE_GAP_SHARE,
};

/**
 * Прогиб линий между линией поля и правыми концами линий: в середине на треть
 * шага вниз — наибольший прогиб, который допускает спека, — к краям области
 * сходит на нет без излома: за крайним узлом сетка изгиба держит смещение
 * постоянным.
 *
 * Область смещена к правому краю кадра, и крутая половина прогиба наклонена
 * круче свипа угла: такой лист уводил бы угол, найденный по всему кадру, к
 * наклону одной половины линии.
 */
const sagInsideRuledArea: SyntheticField = (x) => {
  const left = RULED_PHOTO.marginLineX;
  const right = RULED_PHOTO.width - RULED_PHOTO.margins.right;
  const share = Math.max(-1, Math.min(1, (2 * x - left - right) / (right - left)));

  return (RULED_PHOTO.step / 3) * Math.cos((Math.PI * share) / 2) ** 2;
};

/**
 * Тот же снимок с прогнутыми линиями.
 */
export const BENT_PHOTO = {
  ...RULED_PHOTO,
  bend: sagInsideRuledArea,
} satisfies SyntheticSheetParams;

/**
 * Прогиб во всю ширину кадра: парабола, в середине кадра ниже краёв на `share`
 * шага. Область с линиями — от линии поля до концов линий — стоит в кадре
 * несимметрично, и прямая, ближайшая к дуге внутри области, наклонена.
 *
 * @param share — прогиб в середине кадра в долях шага
 * @returns смещение линий
 */
const createSagAcrossFrame = (share: number): SyntheticField => {
  return (x) => {
    return share * RULED_PHOTO.step * (1 - ((2 * x) / RULED_PHOTO.width - 1) ** 2);
  };
};

/**
 * Снимок с дугой во всю ширину кадра в `share` шага.
 *
 * @param share — прогиб в середине кадра в долях шага
 * @returns снимок с дугой
 */
export const createArcPhoto = (share: number): RuledPhoto => {
  return { ...RULED_PHOTO, bend: createSagAcrossFrame(share) };
};

/**
 * Снимок с линиями, прогнутыми параболой во всю ширину кадра.
 */
export const ARC_PHOTO = createArcPhoto(1 / 3);

/**
 * Прогиб в треть шага только на одной половине области с линиями, другая
 * половина прямая: крутой склон прогиба стоит внутри области.
 *
 * @param from — левый край половины в пикселях снимка
 * @param to — правый край половины
 * @returns смещение линий
 */
const createHalfSag = (from: number, to: number): SyntheticField => {
  return (x) => {
    const share = Math.max(-1, Math.min(1, (2 * x - from - to) / (to - from)));

    return (RULED_PHOTO.step / 3) * Math.cos((Math.PI * share) / 2) ** 2;
  };
};

/**
 * Середина области с линиями: между линией поля и правыми концами линий.
 */
const RULED_AREA_MIDDLE =
  (RULED_PHOTO.marginLineX + RULED_PHOTO.width - RULED_PHOTO.margins.right) / 2;

/**
 * Снимок с прогибом на левой половине области.
 */
export const LEFT_HALF_BENT_PHOTO = {
  ...RULED_PHOTO,
  bend: createHalfSag(RULED_PHOTO.marginLineX, RULED_AREA_MIDDLE),
} satisfies SyntheticSheetParams;

/**
 * Снимок с прогибом на правой половине области.
 */
export const RIGHT_HALF_BENT_PHOTO = {
  ...RULED_PHOTO,
  bend: createHalfSag(RULED_AREA_MIDDLE, RULED_PHOTO.width - RULED_PHOTO.margins.right),
} satisfies SyntheticSheetParams;

/**
 * Снимок листа в линейку с полями и линией поля, изогнутый или ровный.
 */
type RuledPhoto = typeof RULED_PHOTO & Pick<SyntheticSheetParams, 'bend'>;

/**
 * Тот же снимок в `factor` раз крупнее: кадр, шаг, поля, линия поля и прогиб
 * растут вместе, толщина линий остаётся прежней — как у фотографии, снятой в
 * большем разрешении.
 *
 * @param photo — снимок
 * @param factor — во сколько раз крупнее
 * @returns увеличенный снимок
 */
export const scalePhoto = (photo: RuledPhoto, factor: number): RuledPhoto => {
  const { width, height, step, phase, margins, marginLineX, bend } = photo;
  const scaled = {
    width: width * factor,
    height: height * factor,
    step: step * factor,
    phase: phase * factor,
    margins: {
      top: margins.top * factor,
      right: margins.right * factor,
      bottom: margins.bottom * factor,
      left: margins.left * factor,
    },
    marginLineX: marginLineX * factor,
  };

  if (!bend) {
    return scaled;
  }

  return {
    ...scaled,
    bend: (x, y) => {
      return factor * bend(x / factor, y / factor);
    },
  };
};

/**
 * Наклон повёрнутого снимка в градусах: в пределах свипа детектора и заметно
 * дальше его допуска от нуля.
 */
export const TILTED_ANGLE = 1.2;

/**
 * Допуски те же, что у детектора: шаг усредняется по всей высоте кадра, поля
 * упираются в дискретность профиля, угол — в шаг свипа.
 */
export const STEP_TOLERANCE = 0.3;

export const MARGIN_TOLERANCE = 3;

export const ANGLE_TOLERANCE = 0.2;

/**
 * Файл фотографии. Содержимое не важно: пиксели приходят из подменённого
 * съёма, а по имени файла лист называется в списке.
 *
 * @returns файл фотографии листа
 */
export const buildPhotoFile = (): File => {
  return new File([new Uint8Array([1, 2, 3])], 'моя тетрадь.jpg', {
    type: 'image/jpeg',
  });
};

/**
 * Разлиновка единственного добавленного листа.
 *
 * @returns разлиновка из стора; `undefined` — листа ещё нет
 */
export const readUserRuling = (): SheetRuling | undefined => {
  const [record] = useGeneratorStore.getState().userSheets;

  return record?.sheet.ruling;
};

/**
 * Загружает фотографию через контрол группы «Бумага» и дожидается листа в
 * сторе: разбор асинхронный.
 *
 * @param user — сессия `userEvent`
 */
export const uploadUserPhoto = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.upload(screen.getByLabelText('Своя фотография листа'), buildPhotoFile());

  await waitFor(() => {
    expect(readUserRuling()).toBeDefined();
  });
};
