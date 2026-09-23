/**
 * @vitest-environment jsdom
 */
import { deriveGeometry } from '@pages/Generator/lib/calibrate';
import type { PaperFamily, SheetRuling } from '@pages/Generator/lib/paper';
import { mirrorSheetRuling } from '@pages/Generator/lib/paper/mirrorSheetRuling';
import type * as BuildRunRecipeModule from '@pages/Generator/lib/recipe/buildRunRecipe';
import { buildRunRecipe } from '@pages/Generator/lib/recipe/buildRunRecipe';
import { findSheet } from '@pages/Generator/model/paperSelectors';
import { selectPageSheetId } from '@pages/Generator/model/recipeSelectors';
import {
  DEFAULT_GENERATOR_STATE,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { usePageGeometry } from '@pages/Generator/model/usePageGeometry';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildFamily, buildSheet } from './helpers/paper-family';

/**
 * Сборка рецепта под шпионом: по числу вызовов видно, пересобирает ли хук
 * рецепт на изменения стора, к листу страницы отношения не имеющие.
 */
vi.mock('@pages/Generator/lib/recipe/buildRunRecipe', async (importOriginal) => {
  const actual = await importOriginal<typeof BuildRunRecipeModule>();

  return { ...actual, buildRunRecipe: vi.fn(actual.buildRunRecipe) };
});

/**
 * Разлиновка с линией поля слева и разными боковыми полями: отражённая
 * разлиновка отличается от исходной, и по ней видно, какую отдал хук.
 *
 * @param step — шаг разлиновки
 * @returns разлиновка в пикселях кадра 1600×2000
 */
const buildRuling = (step: number): SheetRuling => {
  return {
    step,
    firstLinePhase: step * 2,
    skewAngle: 0.5,
    margins: { top: step * 2, right: 40, bottom: 60, left: 90 },
    marginLineX: 90,
    marginLineSide: 'left',
    bend: null,
    perspective: null,
    outline: null,
    mirrorOverride: null,
  };
};

/**
 * Семья из трёх листов с разным шагом: у страниц прогона разная геометрия.
 */
const FAMILY: PaperFamily = {
  ...buildFamily(0),
  sheets: [
    buildSheet('sheet-0', buildRuling(40)),
    buildSheet('sheet-1', buildRuling(48)),
    buildSheet('sheet-2', buildRuling(56)),
  ],
};

const store = () => {
  return useGeneratorStore.getState();
};

beforeEach(() => {
  useGeneratorStore.setState({
    ...DEFAULT_GENERATOR_STATE,
    presetFamilies: [FAMILY],
    familyId: FAMILY.id,
    sheetId: 'sheet-0',
  });
});

afterEach(() => {
  cleanup();
});

describe('usePageGeometry', () => {
  it('на заданной странице отдаёт её лист, отражённую разлиновку и геометрию по ней', () => {
    const { result } = renderHook(() => {
      return usePageGeometry(1);
    });
    const sheet = findSheet(FAMILY, selectPageSheetId(store(), 1));

    if (!sheet) {
      throw new Error('У страницы нет листа');
    }

    const ruling = mirrorSheetRuling(sheet.ruling, sheet);

    expect(result.current.sheet?.id).toBe(sheet.id);
    expect(result.current.ruling).toEqual(ruling);
    expect(result.current.sheetGeometry).toEqual(
      deriveGeometry(
        { ruling, kind: FAMILY.kind, width: sheet.width, height: sheet.height },
        result.current.metrics,
        store().geometryCorrection
      )
    );
  });

  it('без номера страницы берёт текущую страницу генератора', () => {
    useGeneratorStore.setState({ pageIndex: 2 });

    const { result } = renderHook(() => {
      return usePageGeometry();
    });
    const sheet = findSheet(FAMILY, selectPageSheetId(store(), 2));

    expect(result.current.sheet?.id).toBe(sheet?.id);
    expect(result.current.ruling).toEqual(sheet?.ruling);
  });

  it('идёт за листом страницы при новом прогоне', () => {
    const { result } = renderHook(() => {
      return usePageGeometry(1);
    });

    for (let run = 0; run < 5; run += 1) {
      act(() => {
        store().startNewRun();
      });

      expect(result.current.sheet?.id).toBe(selectPageSheetId(store(), 1));
    }
  });

  it('не пересобирает рецепт на изменения стора, не касающиеся листа', () => {
    const buildRunRecipeSpy = vi.mocked(buildRunRecipe);

    renderHook(() => {
      return usePageGeometry(1);
    });
    buildRunRecipeSpy.mockClear();

    act(() => {
      store().setInk({ kind: 'custom', color: '#ff0000' });
      store().setText('другой текст');
    });

    expect(buildRunRecipeSpy).not.toHaveBeenCalled();
  });
});
