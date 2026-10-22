import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  DEFAULT_BOTTOM_MARGIN,
  DEFAULT_GEOMETRY_CORRECTION,
  DEFAULT_REALISM_LEVEL_ID,
  DEFAULT_RUN_SEED,
  DEFAULT_SCENE_DARKEN,
  DEFAULT_SCENE_ROTATE,
  DEFAULT_SCENE_SCALE,
  DEFAULT_SCENE_SHIFT_X,
  DEFAULT_SCENE_SHIFT_Y,
  HANDWRITING_FONTS,
  PRESET_PAPER_FAMILIES,
  REALISM_LEVELS,
  type RealismLevelId,
  SCENES,
} from '../config';
import type { PaperFamily } from '../lib/paper/paper.types';
import { DEFAULT_INK_TONE_ID } from '../lib/recipe';

import type {
  GeneratorDocument,
  GeneratorRealism,
  GeneratorState,
} from './generator.types';
import { findKindFamily, selectPaperFamilies } from './paperSelectors';
import { SESSION_VERSION, toSession } from './sessionSchema';
import { createSessionStorage } from './sessionStorage';
import {
  EMPTY_HISTORY,
  type HistoryStep,
  recordCommit,
  recordPreview,
  recordRedo,
  recordUndo,
} from './useGeneratorStore.history';
import type {
  CommitOptions,
  DocumentUpdate,
  GeneratorSession,
  GeneratorStateWithHistory,
  GeneratorStoreWithHistory,
  PaperSelection,
} from './useGeneratorStore.types';
import { deleteUserSheet, readUserSheets, writeUserSheet } from './userSheetsStorage';
import type { UserSheetRecord } from './userSheetsStorage.types';

/**
 * Текст, с которым открывается генератор: экран не должен встречать пустым
 * листом, требование «страница уже отрисована» из спеки.
 */
const DEFAULT_TEXT = [
  'Здравствуй!',
  '',
  'Это рукописный текст: набери свой, выбери шрифт и подкрути настройки почерка.',
].join('\n');

/**
 * Реализм ступени: её значения вместе с её идентификатором.
 *
 * @param levelId — идентификатор ступени
 * @returns реализм ступени; `null` — такой ступени в таблице нет
 */
const findLevelRealism = (levelId: RealismLevelId): GeneratorRealism | null => {
  const level = REALISM_LEVELS.find(({ id }) => {
    return id === levelId;
  });

  if (!level) {
    return null;
  }

  const { id, flags, wordFrequency, letterFrequency, hasContourVariance } = level;

  return { level: id, flags, wordFrequency, letterFrequency, hasContourVariance };
};

/**
 * Реализм ступени по умолчанию. Таблица ступеней без неё — ошибка сборки
 * конфига, а не состояние, которое стор мог бы пережить.
 *
 * @param levelId — идентификатор ступени
 * @returns реализм ступени
 */
const toLevelRealism = (levelId: RealismLevelId): GeneratorRealism => {
  const realism = findLevelRealism(levelId);

  if (!realism) {
    throw new Error(`Нет ступени реализма: ${levelId}`);
  }

  return realism;
};

const DEFAULT_STATE: GeneratorStateWithHistory = {
  text: DEFAULT_TEXT,
  fontFamily: HANDWRITING_FONTS[0]?.family ?? '',
  ink: { kind: 'tone', toneId: DEFAULT_INK_TONE_ID },
  familyId: PRESET_PAPER_FAMILIES[0]?.id || '',
  sheetId: PRESET_PAPER_FAMILIES[0]?.sheets[0]?.id || '',
  isSheetPinned: false,
  realism: toLevelRealism(DEFAULT_REALISM_LEVEL_ID),
  geometryCorrection: DEFAULT_GEOMETRY_CORRECTION,
  bottomMargin: DEFAULT_BOTTOM_MARGIN,
  isSceneEnabled: false,
  sceneId: SCENES[0]?.id ?? '',
  sceneRotate: DEFAULT_SCENE_ROTATE,
  sceneShiftX: DEFAULT_SCENE_SHIFT_X,
  sceneShiftY: DEFAULT_SCENE_SHIFT_Y,
  sceneScale: DEFAULT_SCENE_SCALE,
  sceneDarken: DEFAULT_SCENE_DARKEN,
  hasSceneShadow: false,
  runSeed: DEFAULT_RUN_SEED,
  pageIndex: 0,
  isSpread: false,
  zoom: 'fit',
  presetFamilies: PRESET_PAPER_FAMILIES,
  userSheets: [],
  unsavedUserSheetIds: [],
  undeletedUserSheetIds: [],
  hasRestoredUserSheets: false,
  customFontFamily: null,
  customSceneSrc: null,
  isBackgroundHidden: false,
  history: EMPTY_HISTORY,
};

/**
 * Приводит выбор семьи и экземпляра к тому, что есть на самом деле: после
 * загрузки артефакта и после удаления листа прежний выбор может указывать в
 * никуда, а генератор обязан рисовать страницу.
 *
 * @param families — доступные семьи листов
 * @param familyId — желаемая семья
 * @param sheetId — желаемый экземпляр; пустая строка — взять первый в семье
 * @returns существующий выбор; пустые строки — семей нет вовсе
 */
const resolveSelection = (
  families: PaperFamily[],
  familyId: string,
  sheetId: string
): PaperSelection => {
  const family =
    families.find((item) => {
      return item.id === familyId;
    }) || families[0];

  if (!family) {
    return { familyId: '', sheetId: '' };
  }

  const sheet =
    family.sheets.find((item) => {
      return item.id === sheetId;
    }) || family.sheets[0];

  return { familyId: family.id, sheetId: sheet?.id || '' };
};

/**
 * Проверка ссылок на лист после восстановления: сессия и снимки истории
 * ссылаются на листы, которых к этому моменту может не быть. Пропавший
 * закреплённый лист снимает закрепление и возвращает семью по умолчанию —
 * держать выбор в его семье пользователь не просил. Неизвестная семья
 * заменяется первой, пропавший незакреплённый экземпляр — первым в семье.
 *
 * Пока свои листы не прочитаны, ненайденный экземпляр известной семьи
 * пропавшим не считается: это может быть свой лист, который ещё читается.
 * Проверка повторяется, когда чтение закончится.
 *
 * @param families — доступные семьи листов
 * @param refs — семья, экземпляр и закрепление из сессии или снимка
 * @param hasRestoredUserSheets — свои листы уже прочитаны
 * @returns существующие семья и экземпляр с закреплением
 */
const resolveSheetRefs = (
  families: PaperFamily[],
  refs: Pick<GeneratorState, 'familyId' | 'sheetId' | 'isSheetPinned'>,
  hasRestoredUserSheets: boolean
): Pick<GeneratorState, 'familyId' | 'sheetId' | 'isSheetPinned'> => {
  const { familyId, sheetId, isSheetPinned } = refs;
  const family = families.find((item) => {
    return item.id === familyId;
  });
  const hasSheet = Boolean(
    family?.sheets.some((item) => {
      return item.id === sheetId;
    })
  );

  if (family && (hasSheet || !hasRestoredUserSheets)) {
    return { familyId, sheetId, isSheetPinned };
  }

  const fallbackFamilyId = isSheetPinned ? '' : familyId;

  return { ...resolveSelection(families, fallbackFamilyId, ''), isSheetPinned: false };
};

/**
 * Переход по истории с проверкой ссылок на лист: снимок мог сохранить свой
 * лист, удалённый после него.
 *
 * @param state — текущее состояние
 * @param step — переход; `null` — переходить некуда
 * @returns изменения состояния
 */
const applyHistoryStep = (
  state: GeneratorStateWithHistory,
  step: HistoryStep | null
): Partial<GeneratorStateWithHistory> => {
  if (!step) {
    return {};
  }

  const { document, history } = step;

  return {
    ...document,
    ...resolveSheetRefs(
      selectPaperFamilies(state),
      document,
      state.hasRestoredUserSheets
    ),
    history,
  };
};

/**
 * Следующий seed — соседнее целое, а не случайное число: соседние seed дают
 * заметно разный рецепт, зато переход предсказуем и проверяется тестом.
 */
const nextSeed = (seed: number): number => {
  return (seed + 1) >>> 0;
};

/**
 * Реализм после правки отдельного поля: ступень снимается, потому что набор
 * значений больше не её.
 *
 * @param state — текущее состояние генератора
 * @param patch — изменённые поля реализма
 * @returns реализм с правкой и ступенью `custom`
 */
const toCustomRealism = (
  state: GeneratorState,
  patch: Partial<GeneratorRealism>
): GeneratorRealism => {
  return { ...state.realism, ...patch, level: 'custom' };
};

/**
 * Просьба не вытеснять данные сайта уже прозвучала в этой сессии. Флаг модуля,
 * а не поле стора: сброс стора к умолчаниям не делает браузер забывчивым.
 */
let hasRequestedPersistentStorage = false;

/**
 * Просит браузер не вытеснять данные сайта при нехватке места — раз за
 * сессию, при первом сохранении своего листа: Firefox может спросить
 * разрешение, и вопрос уместен, только когда пользователь что-то сохраняет.
 * Отказ или отсутствие API ничего не ломают — лист просто остаётся
 * вытесняемым.
 */
const requestPersistentStorage = (): void => {
  if (hasRequestedPersistentStorage) {
    return;
  }

  hasRequestedPersistentStorage = true;

  const storage = globalThis.navigator?.storage;

  if (!storage?.persist) {
    return;
  }

  storage.persist().catch(() => {
    return false;
  });
};

/**
 * Ключ сессии в локальном хранилище.
 */
const SESSION_KEY = 'autograph.session';

/**
 * Сессия из состояния стора для записи. Подключённый свой шрифт в неё не
 * попадает, и почерк тогда пишется первым встроенным: после перезагрузки
 * файла шрифта уже нет, а сохранённый из-под него встроенный пользователь
 * не видел.
 *
 * @param state — состояние генератора
 * @returns поля сессии
 */
const partializeSession = (state: GeneratorStoreWithHistory): GeneratorSession => {
  const session = toSession(state);

  return state.customFontFamily
    ? { ...session, fontFamily: DEFAULT_STATE.fontFamily }
    : session;
};

export const useGeneratorStore = create<GeneratorStoreWithHistory>()(
  persist(
    (set, get) => {
      /**
       * Правка документа шагом истории. Время берётся здесь, а не в
       * `recordCommit`, чтобы склейку можно было проверить без часов.
       */
      const commit = (update: DocumentUpdate, options: CommitOptions = {}): void => {
        set((state) => {
          return recordCommit(state, update, options, Date.now());
        });
      };

      /**
       * Сохраняет свой лист и отмечает в сторе, принят ли он хранилищем. Отказ
       * записи удалённого за это время листа не помечается: сообщать о листе,
       * которого уже нет в списке, незачем.
       *
       * @param record — лист стора
       */
      const saveUserSheet = async (record: UserSheetRecord): Promise<void> => {
        const { id } = record.sheet;

        requestPersistentStorage();

        const isSaved = await writeUserSheet(record);

        set((state) => {
          const rest = state.unsavedUserSheetIds.filter((sheetId) => {
            return sheetId !== id;
          });
          const isListed = state.userSheets.some(({ sheet }) => {
            return sheet.id === id;
          });

          return { unsavedUserSheetIds: isSaved || !isListed ? rest : [...rest, id] };
        });
      };

      /**
       * Удаляет свой лист из хранилища и отмечает в сторе, если хранилище его
       * не удалило.
       *
       * @param sheetId — идентификатор экземпляра
       */
      const forgetUserSheet = async (sheetId: string): Promise<void> => {
        const isDeleted = await deleteUserSheet(sheetId);

        if (!isDeleted) {
          set((state) => {
            return {
              undeletedUserSheetIds: [
                ...state.undeletedUserSheetIds.filter((id) => {
                  return id !== sheetId;
                }),
                sheetId,
              ],
            };
          });
        }
      };

      return {
        ...DEFAULT_STATE,
        commit,
        preview: (update) => {
          return set((state) => {
            return recordPreview(state, update);
          });
        },
        undo: () => {
          return set((state) => {
            return applyHistoryStep(state, recordUndo(state));
          });
        },
        redo: () => {
          return set((state) => {
            return applyHistoryStep(state, recordRedo(state));
          });
        },
        setText: (text) => {
          return commit({ text }, { coalesceKey: 'text' });
        },
        setFontFamily: (fontFamily) => {
          return commit({ fontFamily });
        },
        setCustomFontFamily: (customFontFamily) => {
          return set({ customFontFamily });
        },
        setInk: (ink) => {
          return commit({ ink });
        },
        setGeometry: (patch) => {
          return commit(patch, { coalesceKey: 'geometry' });
        },
        setBackgroundHidden: (isBackgroundHidden) => {
          return set({ isBackgroundHidden });
        },
        toggleDistortion: (flag) => {
          return commit((state) => {
            const { flags } = state.realism;

            return {
              realism: toCustomRealism(state, {
                flags: { ...flags, [flag]: !flags[flag] },
              }),
            };
          });
        },
        setContourVariance: (hasContourVariance) => {
          return commit((state) => {
            return { realism: toCustomRealism(state, { hasContourVariance }) };
          });
        },
        setWordFrequency: (wordFrequency) => {
          return commit(
            (state) => {
              return { realism: toCustomRealism(state, { wordFrequency }) };
            },
            { coalesceKey: 'wordFrequency' }
          );
        },
        setLetterFrequency: (letterFrequency) => {
          return commit(
            (state) => {
              return { realism: toCustomRealism(state, { letterFrequency }) };
            },
            { coalesceKey: 'letterFrequency' }
          );
        },
        selectRealismLevel: (levelId) => {
          const realism = findLevelRealism(levelId);

          if (!realism) {
            return;
          }

          commit({ realism });
        },
        setSceneEnabled: (isSceneEnabled) => {
          return commit({ isSceneEnabled });
        },
        selectScene: (sceneId) => {
          return set((state) => {
            /**
             * Своё изображение сцены — ресурс, а не документ: оно
             * сбрасывается без шага истории, шагом становится только выбор
             * сцены.
             */
            return {
              ...recordCommit(state, { sceneId }, {}, Date.now()),
              customSceneSrc: null,
            };
          });
        },
        setCustomScene: (customSceneSrc) => {
          return set({ customSceneSrc });
        },
        setSceneParams: (patch) => {
          return commit(patch, { coalesceKey: `scene:${Object.keys(patch).join()}` });
        },
        setIsSpread: (isSpread) => {
          return set({ isSpread });
        },
        setZoom: (zoom) => {
          return set({ zoom });
        },
        goToPage: (pageIndex) => {
          return set({ pageIndex: Math.max(pageIndex, 0) });
        },
        clampPageIndex: (pageCount) => {
          return set((state) => {
            const lastIndex = Math.max(pageCount - 1, 0);

            return { pageIndex: Math.min(state.pageIndex, lastIndex) };
          });
        },
        setPresetFamilies: (presetFamilies) => {
          return set((state) => {
            const families = selectPaperFamilies({ ...state, presetFamilies });

            /**
             * Профили и свои листы приходят в любом порядке: закреплённый
             * свой лист, который ещё читается, здесь пропавшим не считается.
             */
            return {
              presetFamilies,
              ...resolveSheetRefs(families, state, state.hasRestoredUserSheets),
            };
          });
        },
        selectFamily: (familyId) => {
          return commit((state) => {
            /**
             * Экземпляр берётся первый в семье: прежний принадлежал другой семье.
             * Вместе с ним снимается и ручной выбор — раздачу листов по страницам
             * снова делает рецепт. Поправка геометрии при этом остаётся: она
             * задана дельтами.
             */
            return {
              ...resolveSelection(selectPaperFamilies(state), familyId, ''),
              isSheetPinned: false,
            };
          });
        },
        selectSheet: (sheetId) => {
          return commit({ sheetId, isSheetPinned: true });
        },
        addUserSheet: (record) => {
          void saveUserSheet(record);

          return set((state) => {
            const rest = state.userSheets.filter((item) => {
              return item.sheet.id !== record.sheet.id;
            });

            /**
             * Добавленный лист встаёт выбранным вручную: пользователь загрузил
             * свою фотографию, чтобы её увидеть, а не чтобы она встала в очередь
             * рецепта.
             */
            return {
              userSheets: [...rest, record],
              familyId: record.familyId,
              sheetId: record.sheet.id,
              isSheetPinned: true,
            };
          });
        },
        saveSheetMarkup: (sheetId, markup) => {
          const { ruling, pins, kind, remeasure } = markup;
          const { userSheets, presetFamilies } = get();
          const record = userSheets.find(({ sheet }) => {
            return sheet.id === sheetId;
          });

          if (!record) {
            return;
          }

          const familyId =
            findKindFamily(presetFamilies, record.familyId, kind)?.id || record.familyId;
          const saved: UserSheetRecord = remeasure
            ? {
                ...record,
                familyId,
                kind,
                pins,
                measuredRuling: remeasure.measuredRuling,
                measuredKind: remeasure.measuredKind,
                sheet: {
                  ...record.sheet,
                  ruling,
                  lighting: remeasure.lighting,
                  texture: remeasure.texture,
                },
              }
            : { ...record, familyId, kind, pins, sheet: { ...record.sheet, ruling } };

          /**
           * Переезд листа в семью другого вида — правка ресурса, а не
           * документа: шага истории он не ставит, а снимки, выбравшие этот лист
           * в прежней семье, переезжают вместе с ним. Иначе отмена правки
           * текста вернула бы выбор в семью, где листа уже нет, и починка
           * ссылок сбросила бы его на чужой лист.
           */
          const relocate = (document: GeneratorDocument): GeneratorDocument => {
            return document.sheetId === sheetId && document.familyId === record.familyId
              ? { ...document, familyId }
              : document;
          };

          set((state) => {
            const next = state.userSheets.map((item) => {
              return item.sheet.id === sheetId ? saved : item;
            });
            const { history } = state;
            const relocated =
              familyId === record.familyId
                ? {}
                : {
                    history: {
                      ...history,
                      past: history.past.map(relocate),
                      future: history.future.map(relocate),
                      previewBase: history.previewBase && relocate(history.previewBase),
                    },
                  };

            return state.sheetId === sheetId
              ? { userSheets: next, familyId, ...relocated }
              : { userSheets: next, ...relocated };
          });
          void saveUserSheet(saved);
        },
        removeUserSheet: (sheetId) => {
          void forgetUserSheet(sheetId);

          return set((state) => {
            const userSheets = state.userSheets.filter((item) => {
              return item.sheet.id !== sheetId;
            });
            const families = selectPaperFamilies({ ...state, userSheets });
            const selection = resolveSelection(families, state.familyId, state.sheetId);

            /**
             * Удалили выбранный вручную лист — ручной выбор снимается: держать
             * его на подставленном взамен экземпляре пользователь не просил.
             */
            return {
              userSheets,
              unsavedUserSheetIds: state.unsavedUserSheetIds.filter((id) => {
                return id !== sheetId;
              }),
              ...selection,
              isSheetPinned: state.isSheetPinned && selection.sheetId === state.sheetId,
            };
          });
        },
        restoreUserSheets: async () => {
          /**
           * Чтение, упавшее целиком, не должно оставить страницу ждать вечно:
           * листов тогда нет, и ссылки на них проверяются как на пропавшие.
           */
          const restored = await readUserSheets().catch(() => {
            return [];
          });

          set((state) => {
            const restoredIds = new Set(
              restored.map(({ sheet }) => {
                return sheet.id;
              })
            );
            /**
             * Лист, добавленный, пока шло чтение, остаётся: чтение его ещё не
             * видело, а затирать его прочитанным списком значит потерять.
             */
            const userSheets = [
              ...restored,
              ...state.userSheets.filter(({ sheet }) => {
                return !restoredIds.has(sheet.id);
              }),
            ];
            const families = selectPaperFamilies({ ...state, userSheets });

            return {
              userSheets,
              hasRestoredUserSheets: true,
              ...resolveSheetRefs(families, state, true),
            };
          });
        },
        setGeometryCorrection: (patch) => {
          return commit(
            (state) => {
              return { geometryCorrection: { ...state.geometryCorrection, ...patch } };
            },
            { coalesceKey: `geometryCorrection:${Object.keys(patch).join()}` }
          );
        },
        resetGeometryCorrection: () => {
          return commit({ geometryCorrection: DEFAULT_GEOMETRY_CORRECTION });
        },
        startNewRun: () => {
          return commit((state) => {
            return { runSeed: nextSeed(state.runSeed) };
          });
        },
      };
    },
    {
      name: SESSION_KEY,
      version: SESSION_VERSION,
      storage: createSessionStorage(toSession(DEFAULT_STATE)),
      partialize: partializeSession,
    }
  )
);

/**
 * Значения по умолчанию: нужны тестам и stories, чтобы вернуть стор в
 * исходное состояние.
 */
export const DEFAULT_GENERATOR_STATE = DEFAULT_STATE;

/**
 * Есть ли шаг для отмены: кнопка и сочетание клавиш отмены доступны.
 *
 * @param state — состояние генератора
 * @returns доступна ли отмена
 */
export const selectIsUndoAvailable = (state: GeneratorStateWithHistory): boolean => {
  return state.history.past.length > 0;
};

/**
 * Есть ли шаг для повтора.
 *
 * @param state — состояние генератора
 * @returns доступен ли повтор
 */
export const selectIsRedoAvailable = (state: GeneratorStateWithHistory): boolean => {
  return state.history.future.length > 0;
};
