import { useLayoutEffect, useRef, useState } from 'react';

import { fitTileLabel } from './fitTileLabel';
import { interleaveLabelBreaks } from './interleaveLabelBreaks';
import { MAX_LABEL_LINES } from './tileLabelLines';
import type { FittedLabel, FittedText, LineCounter } from './useFittedLabel.types';

/**
 * Кладёт подпись в элемент кусками с точками переноса между ними — так же,
 * как её рисует плитка.
 *
 * @param element — элемент
 * @param text — подпись
 */
const fillLabelBreaks = (element: HTMLElement, text: string) => {
  element.replaceChildren(
    ...interleaveLabelBreaks(text, () => {
      return document.createElement('wbr');
    })
  );
};

/**
 * Сколько строк займёт текст в подписи: замер — пробным элементом рядом с
 * подписью, той же ширины, с тем же шрифтом и теми же точками переноса, что у
 * плитки, но без срезки строк, так что перенос тот же, что у браузера на
 * плитке.
 *
 * @param element — элемент подписи
 * @returns подсчёт строк и уборка копии; `null` — раскладки ещё нет
 */
const createLineCounter = (element: HTMLElement): LineCounter | null => {
  const { parentElement, clientWidth } = element;

  if (!parentElement || clientWidth <= 0) {
    return null;
  }

  const probe = document.createElement('span');

  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'absolute',
    display: 'block',
    visibility: 'hidden',
    width: `${clientWidth}px`,
    overflowWrap: 'anywhere',
  });
  parentElement.append(probe);
  probe.textContent = 'x';

  const lineHeight = probe.scrollHeight;

  const countLines = (text: string): number => {
    fillLabelBreaks(probe, text);

    return lineHeight > 0 ? Math.round(probe.scrollHeight / lineHeight) : 1;
  };

  const dispose = () => {
    probe.remove();
  };

  return { countLines, dispose };
};

/**
 * Подпись, которая встаёт в две строки своего элемента: имя целиком, если
 * помещается, иначе обрезанное с середины. Замер — самим браузером, копией
 * элемента после раскладки: модель переноса по ширинам знаков расходится с
 * браузером на пробелах и кириллице. Пока ширины нет — раскладки ещё не было,
 * — видно имя целиком, а лишнее срезает CSS.
 *
 * @param label — имя листа
 * @returns ссылка на элемент подписи и показанный текст
 */
export const useFittedLabel = (label: string): FittedLabel => {
  const ref = useRef<HTMLSpanElement>(null);
  /**
   * Подпись и имя, для которого она подобрана: у сменившегося имени старая
   * подпись не показывается.
   */
  const [fitted, setFitted] = useState<FittedText | null>(null);

  useLayoutEffect(() => {
    const counter = ref.current && createLineCounter(ref.current);

    if (!counter) {
      return;
    }

    const text = fitTileLabel(label, counter.countLines, MAX_LABEL_LINES);

    counter.dispose();
    setFitted({ label, text });
  }, [label]);

  return { ref, text: fitted?.label === label ? fitted.text : label };
};
