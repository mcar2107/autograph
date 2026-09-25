import type { SegmentedControlOption } from '@shared/ui/SegmentedControl';
import { SegmentedControl } from '@shared/ui/SegmentedControl';
import type { FC } from 'react';

import type { MirrorTabProps } from './MirrorTab.types';

const MIRROR_PAGE = '1';

const PAGE_OPTIONS: SegmentedControlOption[] = [
  { value: '0', label: 'Страница' },
  { value: MIRROR_PAGE, label: 'Зеркальная страница' },
];

/**
 * Вкладки «Страница / Зеркальная страница» над окном просмотра. Зеркальная —
 * отражённая фотография с отражённой разметкой, как она ляжет на правую
 * страницу разворота. Вкладки стоят над снимком, а не в панели: они меняют
 * то, что показано в окне, и внизу панели их не находили.
 */
export const MirrorTab: FC<MirrorTabProps> = (props) => {
  const { pageIndex, onPageIndexChange } = props;
  const isMirrorPage = pageIndex !== 0;

  const handlePageChange = (value: string) => {
    onPageIndexChange(value === MIRROR_PAGE ? 1 : 0);
  };

  return (
    <SegmentedControl
      label="Страница разворота"
      value={isMirrorPage ? MIRROR_PAGE : '0'}
      options={PAGE_OPTIONS}
      className="self-start"
      onChange={handlePageChange}
    />
  );
};
