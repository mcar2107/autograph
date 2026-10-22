/**
 * Почему сохранение недоступно. Пустой текст называется первым: его
 * пользователь исправляет сам, а чтение листов кончится и без него.
 *
 * @param isTextEmpty — текст пуст
 * @param isAwaitingUserSheets — страница ждёт чтения своих листов
 * @returns причина рядом с кнопками; `null` — сохранять можно
 */
export const resolveExportHint = (
  isTextEmpty: boolean,
  isAwaitingUserSheets: boolean
): string | null => {
  if (isTextEmpty) {
    return 'Введите текст, чтобы сохранить страницы';
  }

  if (isAwaitingUserSheets) {
    return 'Загружаем свои листы…';
  }

  return null;
};
