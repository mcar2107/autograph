import { buildSheetRuling, type SheetImageData } from '@pages/Generator/lib/paper';
import {
  selectHasMarkupEdits,
  useMarkupEditorStore,
} from '@pages/Generator/model/useMarkupEditorStore';
import type { UserSheetRecord } from '@pages/Generator/model/userSheetsStorage.types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUserSheetRecord } from './helpers/user-sheet-record';

const FRAME = { width: 600, height: 800 };

const MEASURED = buildSheetRuling({ step: 30, firstLinePhase: 12, skewAngle: 0 }, FRAME);

/**
 * Лист, разметку которого пользователь уже правил: сохранённая разлиновка
 * отличается от найденной автоматом шагом.
 *
 * @returns запись листа
 */
const buildEditedRecord = (): UserSheetRecord => {
  const record = buildUserSheetRecord({
    familyId: 'lined',
    sheet: {
      id: 'user-edited',
      label: 'Правленый',
      src: 'data:image/jpeg;base64,',
      ...FRAME,
      ruling: { ...MEASURED, step: 40 },
      lighting: null,
      texture: null,
    },
  });

  return { ...record, measuredRuling: MEASURED };
};

const IMAGE: SheetImageData = {
  ...FRAME,
  luminance: new Float32Array(FRAME.width * FRAME.height),
};

const store = () => {
  return useMarkupEditorStore.getState();
};

beforeEach(() => {
  store().close();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('стор редактора разметки', () => {
  it('открывается с сохранённой разметкой листа, а не с найденной автоматом', () => {
    const record = buildEditedRecord();

    store().open(record);

    expect(store().record).toBe(record);
    expect(store().draft).toStrictEqual({
      ruling: record.sheet.ruling,
      pins: record.pins,
      kind: record.kind,
      remeasure: null,
    });
    expect(selectHasMarkupEdits(store())).toBe(false);
  });

  it('правка отменяется и повторяется', () => {
    store().open(buildEditedRecord());

    const before = store().draft;

    store().commit({ kind: 'grid' });

    expect(store().draft?.kind).toBe('grid');
    expect(selectHasMarkupEdits(store())).toBe(true);

    store().undo();

    expect(store().draft).toBe(before);
    expect(selectHasMarkupEdits(store())).toBe(false);

    store().redo();

    expect(store().draft?.kind).toBe('grid');
  });

  it('перетаскивание — один шаг истории по отпусканию', () => {
    store().open(buildEditedRecord());

    const before = store().draft;

    store().preview((draft) => {
      return { ruling: { ...draft.ruling, firstLinePhase: 13 } };
    });
    store().preview((draft) => {
      return { ruling: { ...draft.ruling, firstLinePhase: 14 } };
    });
    store().commit((draft) => {
      return { ruling: { ...draft.ruling, firstLinePhase: 15 } };
    });

    expect(store().history.past).toHaveLength(1);

    store().undo();

    expect(store().draft).toBe(before);
  });

  it('правка поля черновика вне ручного перечня на отпускании не теряется', () => {
    store().open(buildEditedRecord());

    const opened = store().draft;

    if (!opened) {
      throw new Error('Редактор закрыт');
    }

    /**
     * Черновик с полем, которого в типе нет: так выглядит черновик, когда тип
     * получает новое поле. Правка его идёт между предпросмотром и отпусканием,
     * а разлиновка на отпускании возвращается к прежней.
     */
    const withField = { ...opened, trialText: 'до' };

    useMarkupEditorStore.setState({ draft: withField });
    store().preview((draft) => {
      return { ruling: { ...draft.ruling, firstLinePhase: 13 } };
    });

    const dragged = { ...store().draft, trialText: 'после' };

    useMarkupEditorStore.setState({ draft: { ...opened, ...dragged } });
    store().commit((draft) => {
      return {
        ruling: { ...draft.ruling, firstLinePhase: opened.ruling.firstLinePhase },
      };
    });

    expect(store().history.past).toHaveLength(1);
    expect(store().draft).toHaveProperty('trialText', 'после');
  });

  it('перемер сверяется по ссылке: равный по значению — другой перемер', () => {
    const record = buildEditedRecord();
    const remeasure = {
      lighting: null,
      texture: null,
      measuredRuling: MEASURED,
      measuredKind: record.kind,
    };

    store().open(record);
    store().commit({ remeasure });
    store().preview({ remeasure: { ...remeasure } });
    store().commit({ remeasure: { ...remeasure } });

    expect(store().history.past).toHaveLength(2);
  });

  it('правки с одним ключом склейки в пределах окна — один шаг', () => {
    vi.useFakeTimers();
    store().open(buildEditedRecord());

    store().commit({ kind: 'grid' }, { coalesceKey: 'kind' });
    vi.advanceTimersByTime(100);
    store().commit({ kind: 'blank' }, { coalesceKey: 'kind' });

    expect(store().history.past).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    store().commit({ kind: 'lined' }, { coalesceKey: 'kind' });

    expect(store().history.past).toHaveLength(2);
  });

  it('«Сбросить к найденному» возвращает разлиновку автомата шагом истории', () => {
    const record = buildEditedRecord();

    store().open(record);
    store().reset();

    expect(store().draft?.ruling).toBe(record.measuredRuling);
    expect(store().draft?.pins.length).toBeGreaterThanOrEqual(2);

    store().undo();

    expect(store().draft?.ruling).toBe(record.sheet.ruling);
  });

  it('закрытие без правок закрывает сразу, с правками — ждёт подтверждения', () => {
    const record = buildEditedRecord();

    store().open(record);
    store().requestClose();

    expect(store().record).toBeNull();

    store().open(record);
    store().commit({ kind: 'grid' });
    store().requestClose();

    expect(store().record).toBe(record);
    expect(store().isCloseConfirming).toBe(true);

    store().dismissClose();

    expect(store().isCloseConfirming).toBe(false);
    expect(store().draft?.kind).toBe('grid');

    store().undo();
    store().requestClose();

    expect(store().record).toBeNull();
  });

  it('«Сбросить к найденному» возвращает и вид, предложенный автоматом', () => {
    const record = {
      ...buildEditedRecord(),
      kind: 'grid' as const,
      measuredKind: 'lined' as const,
    };

    store().open(record);
    store().reset();

    expect(store().draft?.kind).toBe('lined');

    store().undo();

    expect(store().draft?.kind).toBe('grid');
  });

  it('сброс неправленой разметки шага истории не кладёт', () => {
    const edited = buildEditedRecord();
    const record = buildUserSheetRecord({ familyId: 'lined', sheet: edited.sheet });

    store().open(record);
    store().reset();

    expect(store().history.past).toHaveLength(0);
    expect(selectHasMarkupEdits(store())).toBe(false);

    store().requestClose();

    expect(store().record).toBeNull();
  });

  it('каналы фотографии держатся, только пока лист открыт', () => {
    const record = buildEditedRecord();

    store().open(record, IMAGE);

    expect(store().image).toBe(IMAGE);

    store().close();

    expect(store().image).toBeNull();
    expect(store().draft).toBeNull();

    store().open(record);
    store().setImage('user-other', IMAGE);

    expect(store().image).toBeNull();

    store().setImage(record.sheet.id, IMAGE);

    expect(store().image).toBe(IMAGE);
  });

  it('правки, отменённые глубже истории, остаются несохранёнными', () => {
    store().open(buildEditedRecord());

    for (let step = 1; step <= 101; step += 1) {
      const { draft } = store();

      if (draft) {
        store().commit({ ruling: { ...draft.ruling, step: 40 + step } });
      }
    }

    while (store().history.past.length > 0) {
      store().undo();
    }

    expect(store().draft?.ruling.step).toBe(41);
    expect(selectHasMarkupEdits(store())).toBe(true);
  });

  it('правка, вернувшая разлиновку к листу новым объектом, правкой не считается', () => {
    const record = buildEditedRecord();

    store().open(record);
    store().commit({ ruling: { ...record.sheet.ruling, step: 55 } });
    store().commit({ ruling: { ...record.sheet.ruling } });

    expect(store().history.past.length).toBe(2);
    expect(selectHasMarkupEdits(store())).toBe(false);
  });

  it('перемер контура и поиск линий не снимают ожидание друг друга', () => {
    store().open(buildEditedRecord());

    store().setRemeasuring('outline', true);
    store().setRemeasuring('lines', true);
    store().setRemeasuring('lines', false);

    expect(store().isRemeasuring).toBe(true);
    expect(store().remeasuringSources).toStrictEqual(['outline']);

    store().setRemeasuring('lines', true);
    store().setRemeasuring('outline', false);

    expect(store().isRemeasuring).toBe(true);

    store().setRemeasuring('lines', false);

    expect(store().isRemeasuring).toBe(false);
    expect(store().remeasuringSources).toStrictEqual([]);
  });
});
