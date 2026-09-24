import { afterEach, expect } from 'vitest';
import { page } from 'vitest/browser';

import '../src/app/styles/app.css';

/**
 * Переходы и анимации выключены: снимок мог поймать середину раскрытия
 * аккордеона или появления фокусного кольца — и эталон разъезжался от прогона
 * к прогону.
 */
const style = document.createElement('style');

style.textContent = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
}`;
document.head.append(style);

/**
 * Stories, снимать которые незачем: это функциональные пробы на настоящем
 * измерителе и в настоящем воркере — разбивка по строкам, попадание базовых
 * линий на разлиновку, разбор снимка в воркере, — а не витрина. Оформления в
 * них нет, и эталон ничего не сторожит.
 */
const SKIPPED_STORY_FILES = [
  'RealLayout.stories.tsx',
  'BaselineFit.stories.tsx',
  'RasterRuling.stories.tsx',
  'MarkupOverlayFit.stories.tsx',
  'LinesTool.stories.tsx',
  'MeasureSheetWorker.stories.tsx',
];

/**
 * Отдельные stories без эталона, в виде `<файл> > <имя story>`.
 *
 * «Narrow Window» проверяет прокрутку в окне уже порога: страница там шире
 * окна предпросмотра, и снимок тела захватил бы за краем окна чужой белый фон
 * вместо раскладки. Сама раскладка снята в «Desktop».
 */
const SKIPPED_STORIES = ['GeneratorLayout.stories.tsx > Narrow Window'];

/**
 * Снимок после каждой story. Снимается всё окно предпросмотра: у панели и
 * страницы важна вся раскладка, а не отдельный узел.
 *
 * Стили подключаются выше: в прогоне stories через vitest тестовая страница
 * своя, и без явного импорта снимок вышел бы без оформления.
 */
afterEach(async (context) => {
  const fileName = context.task.file?.name ?? '';
  const isSkippedFile = SKIPPED_STORY_FILES.some((skipped) => {
    return fileName.endsWith(skipped);
  });
  const isSkippedStory = SKIPPED_STORIES.some((skipped) => {
    return `${fileName} > ${context.task.name}`.endsWith(skipped);
  });

  if (isSkippedFile || isSkippedStory) {
    return;
  }

  /**
   * Рукописные шрифты грузятся асинхронно: снимок, сделанный до их
   * применения, отличается от эталона целыми строками текста.
   */
  await document.fonts.ready;

  await expect(page.elementLocator(document.body)).toMatchScreenshot(context.task.name);
});
