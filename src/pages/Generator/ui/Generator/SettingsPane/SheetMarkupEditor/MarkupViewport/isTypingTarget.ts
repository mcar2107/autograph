/**
 * Идёт ли набор текста: клавиша в поле ввода печатается, а не управляет
 * окном просмотра — набор числа в «Точных значениях» не должен хватать
 * фотографию или прятать разметку.
 *
 * @param target — элемент, получивший нажатие
 * @returns нажатие пришло в поле ввода
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
};
