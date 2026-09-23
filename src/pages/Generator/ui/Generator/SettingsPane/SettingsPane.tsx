import type { FC } from 'react';

import { ExpertSettings } from './ExpertSettings';
import { HandwritingPicker } from './HandwritingPicker';
import { InkPicker } from './InkPicker';
import { PaperPicker } from './PaperPicker';
import { RealismPicker } from './RealismPicker';
import { SheetMarkupEditor } from './SheetMarkupEditor';

/**
 * Колонка оформления: основной путь — бумага, почерк, чернила, реализм — и
 * свёрнутый под ним экспертный режим.
 *
 * Редактор разметки своего листа один на колонку: его открывают и кнопка
 * настройки на плитке, и каждый импорт фотографии, а второй экземпляр
 * открылся бы поверх первого на тот же лист.
 */
export const SettingsPane: FC = () => {
  return (
    <div className="flex flex-col gap-6 p-4">
      <PaperPicker />

      <HandwritingPicker />

      <InkPicker />

      <RealismPicker />

      <ExpertSettings />

      <SheetMarkupEditor />
    </div>
  );
};
