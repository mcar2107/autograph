import { useEffect } from 'react';

import { useGeneratorStore } from '../../../model/useGeneratorStore';
import { useMarkupEditorStore } from '../../../model/useMarkupEditorStore';

type HistoryCommand = 'undo' | 'redo';

/**
 * Какую команду истории просит нажатие. Клавиша берётся по `code`, а не по
 * `key`: в русской раскладке `key` у той же клавиши — «я», и отмена не
 * срабатывала бы.
 *
 * @param event — нажатие
 * @returns команда истории; `null` — нажатие не про историю
 */
const resolveCommand = (event: KeyboardEvent): HistoryCommand | null => {
  const { code, ctrlKey, metaKey, shiftKey, altKey } = event;

  if (altKey || !(ctrlKey || metaKey)) {
    return null;
  }

  switch (code) {
    case 'KeyZ': {
      return shiftKey ? 'redo' : 'undo';
    }

    case 'KeyY': {
      return ctrlKey && !shiftKey ? 'redo' : null;
    }

    default: {
      return null;
    }
  }
};

/**
 * Виды полей `input`, в которых не набирают текст: отмены браузера у них нет,
 * и нажатие в них остаётся отменой разметки.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Пришло ли нажатие в поле набора текста.
 *
 * @param target — элемент, получивший нажатие
 * @returns нажатие пришло в поле набора
 */
const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type);
  }

  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
};

/**
 * История, которой достаётся нажатие: пока открыт редактор разметки — его
 * черновика, иначе — документа генератора. Отмена в редакторе не должна
 * трогать текст или реализм, а свои листы в историю генератора не входят.
 *
 * @param event — нажатие
 * @returns отмена, повтор и признак идущего перетаскивания; `null` — нажатие
 * достаётся полю, в котором набирают текст
 */
const resolveHistoryTarget = (event: KeyboardEvent) => {
  const markupEditor = useMarkupEditorStore.getState();

  if (markupEditor.record) {
    /**
     * В поле редактора — «Точных значениях» — отмена достаётся набору числа:
     * отмена разметки посреди набора пересобрала бы черновик, и поле молча
     * сбросило бы набранное. Поле генератора за модальным редактором фокуса
     * не получает, так что перехват в нём этим не теряется.
     */
    if (isTextEntryTarget(event.target)) {
      return null;
    }

    const { history, undo, redo } = markupEditor;

    return { isDragging: history.previewBase !== null, undo, redo };
  }

  const { history, undo, redo } = useGeneratorStore.getState();

  return { isDragging: history.previewBase !== null, undo, redo };
};

/**
 * Клавиши отмены и повтора на весь документ: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z и
 * Ctrl+Y. Пока открыт редактор разметки, они отменяют и повторяют его
 * правки, а история генератора стоит.
 *
 * Перехватываются и в поле текста: поле контролируемое и получает значение
 * из истории, а посимвольная отмена браузера после программной установки
 * значения ведёт себя непредсказуемо. В полях редактора — нет: там набирают
 * число, а не правят документ.
 *
 * Пока идёт перетаскивание слайдера или ручки, клавиши ничего не делают:
 * отмена посреди перетаскивания унесла бы в повтор промежуточное значение и
 * потеряла бы значение до перетаскивания, к которому отменяется шаг
 * отпускания.
 */
export const useHistoryHotkeys = (): void => {
  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const command = resolveCommand(event);

      if (!command) {
        return;
      }

      const target = resolveHistoryTarget(event);

      if (!target) {
        return;
      }

      event.preventDefault();

      const { isDragging, undo, redo } = target;

      if (isDragging) {
        return;
      }

      switch (command) {
        case 'undo': {
          undo();

          return;
        }

        case 'redo': {
          redo();

          return;
        }

        default: {
          throw new Error(`Неизвестная команда истории: ${String(command)}`);
        }
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, []);
};
