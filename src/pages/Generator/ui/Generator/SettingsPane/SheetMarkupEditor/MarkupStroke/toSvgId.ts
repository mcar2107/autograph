/**
 * Идентификатор для `url(#…)` и `href="#…"`: `useId` отдаёт двоеточия и
 * кавычки-ёлочки, которые в ссылке пришлось бы экранировать.
 *
 * @param id — идентификатор от `useId`
 * @returns идентификатор из букв, цифр и дефисов
 */
export const toSvgId = (id: string): string => {
  return `markup-${id.replace(/[^a-zA-Z0-9-]/g, '')}`;
};
