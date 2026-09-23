import type { SheetImageData } from '../lib/paper';

import type {
  UserSheetMarkup,
  UserSheetRecord,
  UserSheetRemeasure,
} from './userSheetsStorage.types';

/**
 * Черновик разметки в редакторе: то, что «Сохранить» применит к листу одним
 * действием.
 */
export type MarkupDraft = UserSheetMarkup & {
  /**
   * Перемер фотографии по контуру черновика. Лежит в черновике, а не рядом:
   * отмена правки контура обязана вернуть и свет с текстурой прежнего контура.
   * `null` — контур в редакторе не менялся.
   */
  remeasure: UserSheetRemeasure | null;
};

/**
 * Правка черновика: поля или функция от текущего черновика.
 */
export type MarkupUpdate =
  Partial<MarkupDraft> | ((draft: MarkupDraft) => Partial<MarkupDraft>);

/**
 * Параметры шага истории редактора.
 */
export type MarkupCommitOptions = {
  /**
   * Ключ склейки: правки с одним ключом подряд в пределах окна — один шаг
   * истории.
   */
  coalesceKey?: string;
};

/**
 * История правок черновика.
 */
export type MarkupHistory = {
  /**
   * Снимки черновика до каждого шага, от старых к новым.
   */
  past: MarkupDraft[];

  /**
   * Отменённые снимки, к которым ведёт повтор, от ближних к дальним.
   */
  future: MarkupDraft[];

  /**
   * Ключ склейки последнего шага. `null` — последний шаг не склеивается.
   */
  coalesceKey: string | null;

  /**
   * Когда записан последний шаг, мс.
   */
  committedAt: number;

  /**
   * Черновик до начала перетаскивания: к нему отменяется шаг по отпусканию.
   * `null` — перетаскивание не идёт.
   */
  previewBase: MarkupDraft | null;
};

/**
 * Состояние редактора разметки.
 */
export type MarkupEditorState = {
  /**
   * Лист, открытый в редакторе, каким он был при открытии. `null` — редактор
   * закрыт.
   */
  record: UserSheetRecord | null;

  /**
   * Черновик разметки открытого листа. `null` — редактор закрыт.
   */
  draft: MarkupDraft | null;

  /**
   * Каналы фотографии для магнитов. Держатся, только пока редактор открыт.
   * `null` — не переданы или ещё не сняты.
   */
  image: SheetImageData | null;

  /**
   * История правок черновика.
   */
  history: MarkupHistory;

  /**
   * Закрытие попросили при несохранённых правках, и редактор ждёт
   * подтверждения.
   */
  isCloseConfirming: boolean;

  /**
   * Что сейчас разбирает фотографию: перемер по новому контуру, поиск линий
   * после смены вида. Каждый разбор отмечает только себя, поэтому конец одного
   * не снимает ожидание другого.
   */
  remeasuringSources: MarkupRemeasureSource[];

  /**
   * Идёт хоть один разбор фотографии: сохранение ждёт его, иначе на лист легла
   * бы разметка прежнего контура или прежнего вида. Производное от
   * `remeasuringSources`, держится тем же сеттером.
   */
  isRemeasuring: boolean;
};

/**
 * Разбор фотографии, который ждёт сохранение: перемер по новому контуру или
 * поиск линий после смены вида с «Без разлиновки».
 */
export type MarkupRemeasureSource = 'outline' | 'lines';

/**
 * Действия редактора разметки.
 */
export type MarkupEditorActions = {
  /**
   * Открывает редактор на листе с его сохранённой разметкой.
   */
  open: (record: UserSheetRecord, image?: SheetImageData | null) => void;

  /**
   * Закрывает редактор без сохранения и отпускает каналы фотографии.
   */
  close: () => void;

  /**
   * Просьба закрыть без сохранения: без несохранённых правок закрывает
   * сразу, с ними — ждёт подтверждения.
   */
  requestClose: () => void;

  /**
   * Отказ от закрытия, ждущего подтверждения: правка продолжается.
   */
  dismissClose: () => void;

  /**
   * Правка черновика шагом истории.
   */
  commit: (update: MarkupUpdate, options?: MarkupCommitOptions) => void;

  /**
   * Правка черновика без шага истории — промежуточное значение
   * перетаскивания. Шаг ставит следующий `commit`.
   */
  preview: (update: MarkupUpdate) => void;

  /**
   * Отмена последнего шага.
   */
  undo: () => void;

  /**
   * Повтор отменённого шага.
   */
  redo: () => void;

  /**
   * Возвращает разметку, найденную автоматом, — разлиновку, булавки и вид —
   * шагом истории. Черновик, уже совпадающий с ней, не меняется.
   */
  reset: () => void;

  /**
   * Кладёт каналы фотографии открытого листа.
   */
  setImage: (sheetId: string, image: SheetImageData) => void;

  /**
   * Отмечает начало или конец разбора фотографии из своего источника.
   */
  setRemeasuring: (source: MarkupRemeasureSource, isRemeasuring: boolean) => void;
};

/**
 * Стор редактора разметки: состояние вместе с действиями.
 */
export type MarkupEditorStore = MarkupEditorState & MarkupEditorActions;
