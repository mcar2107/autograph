import type { SheetRuling } from '../../../../../lib/paper';

/**
 * Числа гребёнки, которые правятся в «Точных значениях»: шаг или первая
 * линия.
 */
export type CombPatch = Partial<Pick<SheetRuling, 'step' | 'firstLinePhase'>>;
