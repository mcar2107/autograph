import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import { Spinner } from '@shared/ui/Spinner';
import type { FC } from 'react';
import { useState } from 'react';

import type { RulingKind } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { MarkupLiveRegion } from '../MarkupLiveRegion';

import { searchRulingLines } from './searchRulingLines';

const KIND_OPTIONS: SegmentedControlOption[] = [
  { value: 'grid', label: 'Клетка' },
  { value: 'lined', label: 'Линейка' },
  { value: 'blank', label: 'Без разлиновки' },
];

const NOT_FOUND_MESSAGE =
  'Линии на фотографии не найдены: строки идут по закреплённым линиям. Поправьте их инструментом «Линии».';

const FAILED_MESSAGE =
  'Не удалось прочитать фотографию: линии не искались, строки идут по закреплённым линиям.';

/**
 * Значение переключателя — вид разлиновки.
 *
 * @param value — значение из переключателя
 * @returns вид ли это
 */
const isRulingKind = (value: string): value is RulingKind => {
  return KIND_OPTIONS.some((option) => {
    return option.value === value;
  });
};

/**
 * Вид разлиновки листа: клетка, линейка или без разлиновки. Начальный —
 * предложенный автоматом по снимку.
 *
 * Вид задаёт число шагов на строку и семью, в которую лист уйдёт при
 * сохранении. Переход на «Без разлиновки» разметку не трогает — строки
 * задаются закреплением, магниты выключаются. Переход с него заново ищет
 * линии на фотографии; между клеткой и линейкой линии те же, и искать их
 * заново незачем.
 *
 * Пока идёт перемер — по контуру или поиск линий, — вид не меняется: ответ
 * разбора, запрошенного при прежнем виде, лёг бы поверх нового.
 */
export const RulingKindControl: FC = () => {
  const kind = useMarkupEditorStore((state) => {
    return state.draft?.kind || null;
  });
  const commit = useMarkupEditorStore((state) => {
    return state.commit;
  });
  const isRemeasuring = useMarkupEditorStore((state) => {
    return state.isRemeasuring;
  });
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!kind) {
    return null;
  }

  const searchLines = async (next: RulingKind) => {
    setIsSearching(true);
    setMessage(null);

    const status = await searchRulingLines(next);

    setIsSearching(false);

    switch (status) {
      case 'notFound': {
        setMessage(NOT_FOUND_MESSAGE);
        break;
      }

      case 'failed': {
        setMessage(FAILED_MESSAGE);
        break;
      }

      case 'applied': {
        break;
      }

      case 'dropped': {
        break;
      }

      default: {
        throw new Error(`Неизвестный итог поиска линий: ${String(status)}`);
      }
    }
  };

  const handleKindChange = (value: string) => {
    if (!isRulingKind(value) || value === kind) {
      return;
    }

    if (kind === 'blank') {
      void searchLines(value);

      return;
    }

    setMessage(null);
    commit({ kind: value });
  };

  return (
    <section aria-label="Вид разлиновки" className="flex flex-col gap-2 text-sm">
      <SegmentedControl
        label="Вид разлиновки"
        value={kind}
        options={KIND_OPTIONS}
        isDisabled={isRemeasuring}
        onChange={handleKindChange}
      />

      <MarkupLiveRegion
        tone="status"
        message={
          isSearching ? (
            <>
              <Spinner />
              Ищем линии на фотографии…
            </>
          ) : null
        }
        className="flex items-center gap-2 text-fg-muted"
      />

      <MarkupLiveRegion
        tone="alert"
        message={message}
        className="rounded-md border border-danger p-2 text-xs text-fg"
      />
    </section>
  );
};
