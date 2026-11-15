import { PARAMS, ParamScores } from '../domain/types';

/**
 * Score de dérive (0–100) : à quel point le comportement courant s'éloigne
 * de la référence fixée à la dernière évaluation.
 *
 *   dérive = 1,5 × plus grand écart d'un paramètre
 *          + écart moyen des 6 paramètres
 *          + 8 points par règle personnelle outrepassée
 */
export function computeDrift(baseline: ParamScores, current: ParamScores, overrides: number): number {
  const gaps = PARAMS.map((p) => Math.abs(current[p] - baseline[p]));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.min(100, Math.round(1.5 * Math.max(...gaps) + mean + 8 * overrides));
}

/** Poids d'un nouveau constat dans la valeur courante d'un paramètre. */
export const SIGNAL_WEIGHT = 0.35;
/** Un trade sans écart rapproche les paramètres de la référence. */
export const CALM_DECAY = 0.15;
