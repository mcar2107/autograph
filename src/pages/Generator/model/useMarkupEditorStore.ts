import { create } from 'zustand';

import { deriveRulingPins, type RulingPin } from '../lib/paper';

import { COALESCE_WINDOW_MS, HISTORY_DEPTH } from './useGeneratorStore.history';
import type {
  MarkupDraft,
  MarkupEditorState,
  MarkupEditorStore,
  MarkupHistory,
  MarkupUpdate,
} from './useMarkupEditorStore.types';

/**
 * Поля черновика: по ним правка сверяется с текущим черновиком.
 */
const MARKUP_KEYS = ['ruling', 'pins', 'kind', 'remeasure'] as const;

const EMPTY_MARKUP_HISTORY: MarkupHistory = {
  past: [],
  future: [],
  coalesceKey: null,
  committedAt: 0,
  previewBase: null,
};

const CLOSED_EDITOR: MarkupEditorState = {
  record: null,
  draft: null,
  image: null,
  history: EMPTY_MARKUP_HISTORY,
  isCloseConfirming: false,
  remeasuringSources: [],
  isRemeasuring: false,
};

/**
 * Черновик после правки. Правка, не поменявшая ни одного поля, возвращает
 * тот же черновик: по ссылке шаг истории понимает, что менять нечего.
 *
 * @param draft — текущий черновик
 * @param update — правка
 * @returns черновик после правки
 */
const applyUpdate = (draft: MarkupDraft, update: MarkupUpdate): MarkupDraft => {
  const patch = typeof update === 'function' ? update(draft) : update;
  const isChanged = MARKUP_KEYS.some((key) => {
    return key in patch && patch[key] !== draft[key];
  });

  return isChanged ? { ...draft, ...patch } : draft;
};

/**
 * Совпадают ли булавки точка в точку.
 *
 * @param left — одни булавки
 * @param right — другие булавки
 * @returns совпадают ли
 */
const isSamePins = (left: RulingPin[], right: RulingPin[]): boolean => {
  return (
    left.length === right.length &&
    left.every((pin, index) => {
      const other = right[index];

      return (
        other !== undefined &&
        pin.index === other.index &&
        pin.left.x === other.left.x &&
        pin.left.y === other.left.y &&
        pin.right.x === other.right.x &&
        pin.right.y === other.right.y
      );
    })
  );
};

/**
 * Добавляет снимок в прошлое, отбрасывая самые старые сверх глубины.
 *
 * @param past — снимки прошлого
 * @param draft — новый снимок
 * @returns прошлое с новым снимком
 */
const pushPast = (past: MarkupDraft[], draft: MarkupDraft): MarkupDraft[] => {
  return [...past, draft].slice(-HISTORY_DEPTH);
};

/**
 * Редактор разметки своего листа: черновик и его история живут отдельно от
 * документа генератора. Свои листы в историю генератора не входят, и правка
 * в редакторе, отменённая Ctrl/⌘+Z, не должна трогать текст или реализм.
 *
 * Стор один на приложение, как и сам редактор: его открывают и импорт
 * фотографии, и кнопка настройки на плитке листа.
 */
export const useMarkupEditorStore = create<MarkupEditorStore>()((set, get) => {
  return {
    ...CLOSED_EDITOR,
    open: (record, image = null) => {
      const { sheet, pins, kind } = record;

      return set({
        record,
        draft: { ruling: sheet.ruling, pins, kind, remeasure: null },
        image,
        history: EMPTY_MARKUP_HISTORY,
        isCloseConfirming: false,
        remeasuringSources: [],
        isRemeasuring: false,
      });
    },
    close: () => {
      return set(CLOSED_EDITOR);
    },
    requestClose: () => {
      if (selectHasMarkupEdits(get())) {
        return set({ isCloseConfirming: true });
      }

      return set(CLOSED_EDITOR);
    },
    dismissClose: () => {
      return set({ isCloseConfirming: false });
    },
    commit: (update, options = {}) => {
      const { draft, history } = get();

      if (!draft) {
        return;
      }

      const next = applyUpdate(draft, update);
      const base = history.previewBase || draft;

      if (next === base) {
        return set({ draft: next, history: { ...history, previewBase: null } });
      }

      const now = Date.now();
      const coalesceKey = options.coalesceKey || null;
      const isCoalesced =
        !history.previewBase &&
        coalesceKey !== null &&
        history.coalesceKey === coalesceKey &&
        now - history.committedAt <= COALESCE_WINDOW_MS;

      return set({
        draft: next,
        history: {
          past: isCoalesced ? history.past : pushPast(history.past, base),
          future: [],
          coalesceKey,
          committedAt: now,
          previewBase: null,
        },
      });
    },
    preview: (update) => {
      const { draft, history } = get();

      if (!draft) {
        return;
      }

      return set({
        draft: applyUpdate(draft, update),
        history: {
          ...history,
          coalesceKey: null,
          previewBase: history.previewBase || draft,
        },
      });
    },
    undo: () => {
      const { draft, history } = get();
      const previous = history.past.at(-1);

      if (!draft || !previous) {
        return;
      }

      return set({
        draft: previous,
        history: {
          ...EMPTY_MARKUP_HISTORY,
          past: history.past.slice(0, -1),
          future: [history.previewBase || draft, ...history.future],
        },
      });
    },
    redo: () => {
      const { draft, history } = get();
      const [next, ...future] = history.future;

      if (!draft || !next) {
        return;
      }

      return set({
        draft: next,
        history: {
          ...EMPTY_MARKUP_HISTORY,
          past: pushPast(history.past, history.previewBase || draft),
          future,
        },
      });
    },
    reset: () => {
      const { record, draft } = get();

      if (!record || !draft) {
        return;
      }

      const { measuredRuling, measuredKind, sheet } = record;
      /**
       * Булавки выводятся заново: сохранённые стоят на правленой гребёнке, и с
       * найденной разлиновкой они бы разошлись.
       */
      const pins = deriveRulingPins(measuredRuling, sheet);

      /**
       * Разметка уже найденная — шага нет: выведенные заново булавки — другой
       * массив с теми же точками, и сброс без правок иначе стал бы правкой, о
       * которой спросит закрытие.
       */
      if (
        draft.ruling === measuredRuling &&
        draft.kind === measuredKind &&
        draft.remeasure === null &&
        isSamePins(draft.pins, pins)
      ) {
        return;
      }

      /**
       * Сброс снимает и перемер по контуру, заданному в редакторе: найденная
       * разметка листа — по его сохранённому контуру, и свет с текстурой к ней
       * тоже прежние.
       */
      get().commit({ ruling: measuredRuling, pins, kind: measuredKind, remeasure: null });
    },
    setImage: (sheetId, image) => {
      /**
       * Каналы, снятые для листа, который уже закрыли, не кладутся: иначе они
       * держались бы в памяти до следующего открытия.
       */
      if (get().record?.sheet.id !== sheetId) {
        return;
      }

      return set({ image });
    },
    setRemeasuring: (source, isRemeasuring) => {
      const others = get().remeasuringSources.filter((item) => {
        return item !== source;
      });
      const remeasuringSources = isRemeasuring ? [...others, source] : others;

      return set({ remeasuringSources, isRemeasuring: remeasuringSources.length > 0 });
    },
  };
});

/**
 * Есть ли в черновике правки, которых нет у листа: по ним закрытие без
 * сохранения спрашивает подтверждение.
 *
 * @param state — состояние редактора
 * @returns есть ли несохранённые правки
 */
export const selectHasMarkupEdits = (state: MarkupEditorState): boolean => {
  return state.history.past.length > 0 || state.history.previewBase !== null;
};

/**
 * Есть ли правка, которую можно отменить.
 *
 * @param state — состояние редактора
 * @returns доступна ли отмена
 */
export const selectIsMarkupUndoAvailable = (state: MarkupEditorState): boolean => {
  return state.history.past.length > 0;
};

/**
 * Есть ли отменённая правка, которую можно повторить.
 *
 * @param state — состояние редактора
 * @returns доступен ли повтор
 */
export const selectIsMarkupRedoAvailable = (state: MarkupEditorState): boolean => {
  return state.history.future.length > 0;
};

/**
 * Совпадают ли два значения разметки поле в поле. Сравнение по значению, а
 * не по ссылке: лист, перечитанный из хранилища, держит найденную и свою
 * разлиновку разными объектами и без единой правки.
 *
 * @param left — одно значение
 * @param right — другое значение
 * @returns совпадают ли
 */
const isSameValue = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }

  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) {
    return false;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }

  const leftEntries = Object.entries(left);

  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => {
      return key in right && isSameValue(value, Reflect.get(right, key));
    })
  );
};

/**
 * Открыт ли лист с разметкой, сохранённой в редакторе, а не найденной
 * автоматом: разлиновка или вид листа отличаются от предложенных автоматом.
 * Смотрит на лист, каким он был при открытии, а не на черновик.
 *
 * @param state — состояние редактора
 * @returns сохранённая ли разметка
 */
export const selectIsSavedMarkup = (state: MarkupEditorState): boolean => {
  const { record } = state;

  if (!record) {
    return false;
  }

  return (
    record.kind !== record.measuredKind ||
    !isSameValue(record.sheet.ruling, record.measuredRuling)
  );
};
