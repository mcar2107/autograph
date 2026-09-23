import { LINED_FAMILY_ID } from '@pages/Generator/config';
import {
  DEFAULT_GENERATOR_STATE,
  selectIsRedoAvailable,
  selectIsUndoAvailable,
  useGeneratorStore,
} from '@pages/Generator/model/useGeneratorStore';
import { HISTORY_DEPTH } from '@pages/Generator/model/useGeneratorStore.history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Стор объявлен вне React, поэтому проверяется вызовами напрямую.
 */
const store = () => {
  return useGeneratorStore.getState();
};

/**
 * Пауза заведомо длиннее окна склейки набора.
 */
const PAUSE_MS = 2000;

/**
 * Промежуток между символами при наборе без пауз.
 */
const KEYSTROKE_MS = 100;

beforeEach(() => {
  vi.useFakeTimers();
  useGeneratorStore.setState(DEFAULT_GENERATOR_STATE);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Набирает слово по символу без пауз.
 *
 * @param base — текст до набора
 * @param word — набираемое слово
 */
const typeWord = (base: string, word: string): void => {
  for (let length = 1; length <= word.length; length += 1) {
    store().setText(base + word.slice(0, length));
    vi.advanceTimersByTime(KEYSTROKE_MS);
  }
};

describe('история правок', () => {
  it('на старте отменять и повторять нечего', () => {
    expect(selectIsUndoAvailable(store())).toBe(false);
    expect(selectIsRedoAvailable(store())).toBe(false);
  });

  it('набор без пауз отменяется одним шагом', () => {
    const initial = store().text;

    typeWord(initial, ' слово');

    expect(store().history.past).toHaveLength(1);

    store().undo();

    expect(store().text).toBe(initial);
    expect(selectIsUndoAvailable(store())).toBe(false);
  });

  it('пауза в наборе разрывает шаг', () => {
    store().setText('а');
    vi.advanceTimersByTime(PAUSE_MS);
    store().setText('аб');

    store().undo();

    expect(store().text).toBe('а');
  });

  it('набор после отмены — новый шаг, а не продолжение прежнего', () => {
    store().setText('а');
    store().undo();
    store().setText('б');
    store().setText('бв');

    store().undo();

    expect(store().text).toBe(DEFAULT_GENERATOR_STATE.text);
  });

  it('отмена перегенерации возвращает seed прогона, повтор — снова новый', () => {
    const { runSeed } = store();

    store().startNewRun();

    const nextRunSeed = store().runSeed;

    store().undo();

    expect(store().runSeed).toBe(runSeed);

    store().redo();

    expect(store().runSeed).toBe(nextRunSeed);
  });

  it('повтор после отмены возвращает выбранный уровень реализма', () => {
    store().selectRealismLevel('sloppy');
    store().undo();

    expect(store().realism.level).toBe('normal');

    store().redo();

    expect(store().realism.level).toBe('sloppy');
  });

  it('новая правка после отмены очищает повтор', () => {
    store().selectRealismLevel('sloppy');
    store().undo();

    expect(selectIsRedoAvailable(store())).toBe(true);

    store().setInk({ kind: 'custom', color: '#112233' });

    expect(selectIsRedoAvailable(store())).toBe(false);
  });

  it('переполнение теряет старейший шаг', () => {
    const { runSeed } = store();

    for (let step = 0; step <= HISTORY_DEPTH; step += 1) {
      store().startNewRun();
    }

    expect(store().history.past).toHaveLength(HISTORY_DEPTH);

    while (selectIsUndoAvailable(store())) {
      store().undo();
    }

    expect(store().runSeed).toBe(runSeed + 1);
  });

  it('просмотр и ресурсы в историю не попадают', () => {
    store().goToPage(3);
    store().setZoom(2);
    store().setIsSpread(true);
    store().setBackgroundHidden(true);
    store().setCustomFontFamily('UserFont');

    expect(selectIsUndoAvailable(store())).toBe(false);
  });

  it('отмена не трогает номер страницы', () => {
    store().selectFamily(LINED_FAMILY_ID);
    store().goToPage(2);

    store().undo();

    expect(store().familyId).toBe(DEFAULT_GENERATOR_STATE.familyId);
    expect(store().pageIndex).toBe(2);
  });

  it('правка без изменения значения шага не создаёт', () => {
    store().setGeometryCorrection({ topOffset: 0 });
    store().setInk({ kind: 'tone', toneId: 'ballpoint-blue' });

    expect(selectIsUndoAvailable(store())).toBe(false);
  });

  describe('слайдер', () => {
    it('перетаскивание пишет значение без шага, отпускание — один шаг от исходного', () => {
      for (const bottomMargin of [1, 2, 3]) {
        store().preview({ bottomMargin });
      }

      expect(store().bottomMargin).toBe(3);
      expect(selectIsUndoAvailable(store())).toBe(false);

      store().commit({ bottomMargin: 4 });

      expect(store().history.past).toHaveLength(1);

      store().undo();

      expect(store().bottomMargin).toBe(DEFAULT_GENERATOR_STATE.bottomMargin);
    });

    it('правка поля реализма через commit снимает названную ступень', () => {
      store().commit((state) => {
        return { realism: { ...state.realism, wordFrequency: 5 } };
      });

      expect(store().realism.level).toBe('custom');
      expect(store().realism.wordFrequency).toBe(5);
    });

    it('смежные шаги одного слайдера склеиваются по ключу', () => {
      store().setWordFrequency(2);
      store().setWordFrequency(3);

      store().undo();

      expect(store().realism).toEqual(DEFAULT_GENERATOR_STATE.realism);
    });
  });

  it('отмена к снимку с удалённым своим листом снимает закрепление', () => {
    /**
     * Свои листы уже прочитаны: пока они читаются, ненайденный лист может
     * быть ещё не прочитанным, а не удалённым.
     */
    useGeneratorStore.setState({
      familyId: LINED_FAMILY_ID,
      sheetId: 'user-gone',
      isSheetPinned: true,
      hasRestoredUserSheets: true,
    });
    store().setText('правка');

    store().undo();

    expect(store().isSheetPinned).toBe(false);
    expect(store().familyId).toBe(DEFAULT_GENERATOR_STATE.familyId);
    expect(store().sheetId).toBe(DEFAULT_GENERATOR_STATE.sheetId);
  });

  it('отмена до конца чтения своих листов не снимает закрепление ещё не прочитанного листа', () => {
    useGeneratorStore.setState({
      familyId: LINED_FAMILY_ID,
      sheetId: 'user-pending',
      isSheetPinned: true,
    });
    store().setText('правка');

    store().undo();

    expect(store().isSheetPinned).toBe(true);
    expect(store().sheetId).toBe('user-pending');
  });
});
