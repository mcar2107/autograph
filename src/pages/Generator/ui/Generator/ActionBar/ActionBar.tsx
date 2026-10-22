import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useId } from 'react';

import { selectIsAwaitingUserSheets } from '../../../model/paperSelectors';
import { useBatchExport } from '../../../model/useBatchExport';
import { useExportPage } from '../../../model/useExportPage';
import { useGeneratorStore } from '../../../model/useGeneratorStore';

import type { ActionBarProps } from './ActionBar.types';
import { resolveExportHint } from './resolveExportHint';

/**
 * Полоса главных действий: новый прогон, текущая страница файлом и вся пачка
 * архивом. Прогресс пачки и её отмена — здесь же, чтобы не искать их по
 * экрану.
 *
 * Сохранение и выгрузка — два действия, а не одно с переключателем: пачку
 * заказывают редко и ждут долго, а текущую страницу сохраняют по ходу
 * подбора настроек.
 *
 * Без текста сохранять нечего: кнопки недоступны, и рядом написано почему —
 * недоступная кнопка без объяснения выглядит сломанной. Так же они ждут
 * чтения своих листов, пока страница закреплена на ещё не прочитанном: до
 * его конца отрисовка взяла бы подставленный лист семьи, и в файл ушла бы
 * чужая бумага.
 */
export const ActionBar: FC<ActionBarProps> = (props) => {
  const { plan } = props;
  const isTextEmpty = useGeneratorStore((state) => {
    return state.text.trim() === '';
  });
  const isAwaitingUserSheets = useGeneratorStore(selectIsAwaitingUserSheets);
  const startNewRun = useGeneratorStore((state) => {
    return state.startNewRun;
  });
  const hintId = useId();
  const pageExport = useExportPage(plan);
  const batchExport = useBatchExport(plan);
  const { progress, isRunning } = batchExport;
  const error = pageExport.error || batchExport.error;
  /**
   * Подсказка связана с кнопками, а не просто стоит рядом: читалка, дойдя до
   * недоступной кнопки, иначе не узнала бы причину.
   */
  const hint = resolveExportHint(isTextEmpty, isAwaitingUserSheets);
  const describedBy = hint ? hintId : undefined;

  const handleRegenerateClick = () => {
    startNewRun();
  };

  const handleSaveClick = () => {
    void pageExport.save();
  };

  const handleBatchClick = () => {
    void batchExport.start();
  };

  const handleCancelClick = () => {
    batchExport.cancel();
  };

  return (
    <div className="flex w-full items-center gap-4">
      <Button variant="secondary" onClick={handleRegenerateClick}>
        Перегенерировать
      </Button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 text-sm">
        {hint ? (
          <p id={hintId} className="text-fg-muted">
            {hint}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}

        {progress ? (
          <p role="status" className="text-fg-muted tabular-nums">
            Готово {progress.completed} из {progress.total}
          </p>
        ) : null}

        {isRunning ? (
          <Button variant="ghost" onClick={handleCancelClick}>
            Отменить
          </Button>
        ) : null}
      </div>

      <Button
        variant="secondary"
        isDisabled={hint !== null}
        isLoading={isRunning}
        describedBy={describedBy}
        onClick={handleBatchClick}
      >
        Скачать все
      </Button>

      {/**
       * Ход сохранения показывает индикатор на кнопке, а не сменившаяся
       * подпись: подпись другой длины меняла бы ширину кнопки, и полоса
       * действий дёргалась бы на каждое сохранение.
       */}
      <Button
        variant="primary"
        isDisabled={hint !== null}
        isLoading={pageExport.isSaving}
        describedBy={describedBy}
        onClick={handleSaveClick}
      >
        Сохранить страницу
      </Button>
    </div>
  );
};
