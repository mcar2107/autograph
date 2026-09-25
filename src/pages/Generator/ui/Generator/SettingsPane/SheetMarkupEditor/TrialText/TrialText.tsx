import { Checkbox } from '@shared/ui/Checkbox';
import type { FC } from 'react';
import { createPortal } from 'react-dom';

import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import { useMarkupScale } from '../MarkupViewport';

import type { TrialTextProps } from './TrialText.types';
import { useTrialText } from './useTrialText';

/**
 * Пробный текст поверх фотографии: текст из поля ввода, выложенный по
 * черновой разметке теми же шрифтом, чернилами и реализмом, что и страница, —
 * проверка, что строки лягут на линии. Включается по желанию и обновляется
 * после каждой завершённой правки. Включён ли он, решает редактор: под ним
 * приглушается разметка.
 *
 * Страница — та же, что уйдёт в JPEG, вместе с фотографией, поэтому ложится
 * над снимком и под разметкой: ручки остаются видны поверх текста.
 */
export const TrialText: FC<TrialTextProps> = (props) => {
  const { layer, pageIndex, isEnabled, onEnabledChange } = props;
  const scale = useMarkupScale();
  const width = useMarkupEditorStore((state) => {
    return state.record?.sheet.width || 0;
  });
  const height = useMarkupEditorStore((state) => {
    return state.record?.sheet.height || 0;
  });
  const { url, isPending } = useTrialText({ isEnabled, pageIndex, scale });

  const handleTrialChange = (isChecked: boolean) => {
    onEnabledChange(isChecked);
  };

  return (
    <section aria-label="Пробный текст" className="flex flex-col gap-1 text-sm">
      <Checkbox
        label="Пробный текст"
        isChecked={isEnabled}
        onChange={handleTrialChange}
      />

      {isEnabled && isPending ? (
        <p role="status" className="text-xs text-fg-muted">
          Пробный текст перекладывается по разметке…
        </p>
      ) : null}

      {url && layer
        ? createPortal(
            <img
              src={url}
              alt="Пробный текст по разметке"
              width={width}
              height={height}
              draggable={false}
              className="block size-full max-w-none select-none"
            />,
            layer
          )
        : null}
    </section>
  );
};
