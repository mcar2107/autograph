import type { FC } from 'react';

import type { MarkupLiveRegionProps } from './MarkupLiveRegion.types';

/**
 * Живая область сообщения инструмента. Область стоит на месте и пустая, а
 * меняется только её содержимое: область, появившаяся вместе с текстом,
 * читалкой часто не объявляется, а сообщения редактора — перемер, отказ
 * контура, итог подгонки — приходят после действия, когда фокус на ручке или
 * кнопке.
 *
 * Пустая область выведена из потока (`empty:absolute`): иначе она занимала бы
 * промежуток колонки инструмента под собой. Скрыть её через `display: none`
 * нельзя — такая область выпадает из дерева доступности, и текст, пришедший
 * вместе с её появлением, не объявляется.
 */
export const MarkupLiveRegion: FC<MarkupLiveRegionProps> = (props) => {
  const { tone, message, className } = props;

  return (
    <div role={tone} aria-atomic="true" className="empty:absolute">
      {message === null ? null : <p className={className}>{message}</p>}
    </div>
  );
};
