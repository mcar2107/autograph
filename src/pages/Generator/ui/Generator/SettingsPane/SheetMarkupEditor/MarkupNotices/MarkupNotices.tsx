import type { FC } from 'react';

import type { MarkupDraft } from '../../../../../model/useMarkupEditorStore.types';
import type { MarkupToolId } from '../SheetMarkupEditor.types';

import type { MarkupNoticesProps } from './MarkupNotices.types';

/**
 * Сообщения о том, чего в разметке нет, у своего инструмента. Разметка без
 * линии поля, перспективы или изгиба бывает и верной — лист без поля, снятый
 * сверху, ровный, — поэтому сообщения подсказывают, а не запрещают
 * сохранение.
 *
 * @param tool — инструмент
 * @param draft — черновик разметки
 * @returns тексты сообщений
 */
const collectNotices = (tool: MarkupToolId, draft: MarkupDraft): string[] => {
  const { ruling, kind } = draft;
  const isRuled = kind !== 'blank';
  const hasLines = ruling.step > 0;

  switch (tool) {
    case 'lines': {
      if (isRuled && !hasLines) {
        return [
          'Линии на снимке не найдены. Закрепите две линии: поставьте концы булавок на линии листа и укажите, сколько шагов между ними.',
        ];
      }

      return isRuled && !ruling.perspective
        ? ['Перспектива не найдена. Если лист снят под углом, закрепите третью линию.']
        : [];
    }

    case 'bend': {
      return isRuled && hasLines && !ruling.bend
        ? [
            'Изгиб линий не найден — строки пойдут по прямым. Если бумага волнится, подгоните изгиб по фото.',
          ]
        : [];
    }

    case 'margins': {
      return isRuled && ruling.marginLineX === null
        ? ['Линия поля не найдена. Если она есть на листе, добавьте её.']
        : [];
    }

    case 'outline': {
      return [];
    }

    default: {
      throw new Error(`Неизвестный инструмент: ${String(tool)}`);
    }
  }
};

/**
 * Сообщения автомата у активного инструмента.
 */
export const MarkupNotices: FC<MarkupNoticesProps> = (props) => {
  const { tool, draft } = props;
  const notices = collectNotices(tool, draft);

  if (notices.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Сообщения автомата" className="flex flex-col gap-1">
      {notices.map((notice) => {
        return (
          <li
            key={notice}
            className="rounded-md border border-border-strong p-2 text-xs text-fg-muted"
          >
            {notice}
          </li>
        );
      })}
    </ul>
  );
};
