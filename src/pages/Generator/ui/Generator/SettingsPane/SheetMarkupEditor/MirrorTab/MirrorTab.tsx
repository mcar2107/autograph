import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import type { FC } from 'react';

import { MirrorOverride } from './MirrorOverride';
import type { MirrorTabProps } from './MirrorTab.types';

const MIRROR_PAGE = '1';

const PAGE_OPTIONS: SegmentedControlOption[] = [
  { value: '0', label: 'Страница' },
  { value: MIRROR_PAGE, label: 'Зеркальная страница' },
];

/**
 * Вкладки «Страница / Зеркальная страница». Зеркальная — отражённая
 * фотография с отражённой разметкой, как она ляжет на правую страницу
 * разворота. Контур, линии, изгиб, верхнее и нижнее поля у страниц общие и
 * правятся на любой вкладке; линия поля и боковые поля зеркала по выбору
 * отражены или свои — они правятся здесь.
 */
export const MirrorTab: FC<MirrorTabProps> = (props) => {
  const { pageIndex, tool, handleLayer, onPageIndexChange } = props;
  const isMirrorPage = pageIndex !== 0;

  const handlePageChange = (value: string) => {
    onPageIndexChange(value === MIRROR_PAGE ? 1 : 0);
  };

  return (
    <section aria-label="Страница разворота" className="flex flex-col gap-2 text-sm">
      <SegmentedControl
        label="Страница разворота"
        value={isMirrorPage ? MIRROR_PAGE : '0'}
        options={PAGE_OPTIONS}
        onChange={handlePageChange}
      />

      {isMirrorPage ? (
        <MirrorOverride handleLayer={handleLayer} withHandles={tool === 'margins'} />
      ) : null}
    </section>
  );
};
