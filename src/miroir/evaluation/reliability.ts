import { Confidence, ParamKey } from '../domain/types';
/**
 * Fiabilité de la mesure d'un paramètre du profil, déduite de ce que la personne a effectivement répondu.
 *
 * Ce n'est PAS une précision statistique : sans comportement réel de référence, on ne peut pas mesurer l'écart entre le
 * score et la vérité. C'est un indice de cohérence de la mesure, calculé sur trois faits observables :
 *   - combien de réponses nourrissent ce paramètre (une seule réponse ne peut pas être recoupée) ;
 *   - si ces réponses vont dans le même sens (écart entre la plus basse et la plus haute) ;
 *   - la confiance déclarée par la personne dans ces réponses.
 * La confiance ne modifie PAS le score du profil : elle ne sert qu'à dire à quel point on peut s'y fier
 * (pondérer le score demanderait des poids que rien ne permet de valider).
 */
export const CONFIDENCE_LEVELS: Confidence[] = ['high', 'medium', 'low'];
/** Poids de chaque niveau de confiance, utilisés uniquement pour la fiabilité (moyenne ≥ 0,8 : « sûr » dans l'ensemble). */
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.7, low: 0.4 };
/** Seuils de lecture, modifiables ici seulement. */
const SPREAD_CONSISTENT = 30;   // écart ≤ 30 points : réponses cohérentes
const SPREAD_CONTRADICTORY = 50; // écart > 50 points : réponses contradictoires
const CONFIDENCE_HIGH = 0.8;
const CONFIDENCE_LOW = 0.55;
/** Une mesure : la valeur d'une réponse (ou du temps de décision) pour un paramètre. */
export interface Reading { value: number; confidence?: Confidence; source: 'answer' | 'time' }
export type ReliabilityLevel = 'high' | 'medium' | 'low';
export const LEVEL_LABELS: Record<ReliabilityLevel, string> = { high: 'élevée', medium: 'moyenne', low: 'faible' };
export interface Reliability {
  level: ReliabilityLevel;
  label: string;
  /** Nombre de mesures (réponses, plus le temps de décision pour l'impulsivité). */
  readings: number;
  /** Écart entre la mesure la plus basse et la plus haute (0–100). 0 s'il n'y en a qu'une. */
  spread: number;
  /** Confiance moyenne des réponses (0,4–1), ou null si aucune n'a été indiquée. */
  confidence: number | null;
  /** Les raisons, en français, affichées à la personne. */
  why: string[];
}
export function reliabilityOf(readings: Reading[]): Reliability {
  const n = readings.length;
  const values = readings.map((r) => r.value);
  const spread = n > 1 ? Math.max(...values) - Math.min(...values) : 0;
  const stated = readings.filter((r) => r.confidence).map((r) => CONFIDENCE_WEIGHT[r.confidence!]);
  const confidence = stated.length ? stated.reduce((a, b) => a + b, 0) / stated.length : null;
  const why: string[] = [];
  why.push(n < 2 ? 'une seule mesure' : `${n} mesures`);
  if (n >= 2) why.push(spread <= SPREAD_CONSISTENT ? 'réponses cohérentes' : spread > SPREAD_CONTRADICTORY ? 'réponses contradictoires' : 'réponses un peu différentes');
  why.push(confidence === null ? 'confiance non indiquée'
    : confidence >= CONFIDENCE_HIGH ? 'confiance élevée' : confidence >= CONFIDENCE_LOW ? 'confiance moyenne' : 'réponses hésitantes');
  // « faible » dès qu'un seul des trois faits est mauvais ; « élevée » seulement si les trois sont bons et connus.
  let level: ReliabilityLevel = 'medium';
  if (n < 2 || spread > SPREAD_CONTRADICTORY || (confidence !== null && confidence < CONFIDENCE_LOW)) level = 'low';
  else if (spread <= SPREAD_CONSISTENT && confidence !== null && confidence >= CONFIDENCE_HIGH) level = 'high';
  return { level, label: LEVEL_LABELS[level], readings: n, spread: Math.round(spread), confidence: confidence === null ? null : Math.round(confidence * 100) / 100, why };
}
export interface OverallReliability { level: ReliabilityLevel; label: string; counts: Record<ReliabilityLevel, number>; summary: string }
/** Lecture d'ensemble : « élevée » si au moins 4 paramètres sur 6 sont solides et aucun fragile ; « faible » si 3 ou plus sont fragiles. */
export function overallReliability(byParam: Record<ParamKey, Reliability>): OverallReliability {
  const all = Object.values(byParam);
  const counts: Record<ReliabilityLevel, number> = { high: 0, medium: 0, low: 0 };
  for (const r of all) counts[r.level]++;
  const level: ReliabilityLevel = counts.low >= 3 ? 'low' : counts.high >= 4 && counts.low === 0 ? 'high' : 'medium';
  const solid = counts.high;
  const summary = `${solid} paramètre${solid > 1 ? 's' : ''} sur ${all.length} mesuré${solid > 1 ? 's' : ''} de façon solide`
    + (counts.low ? `, ${counts.low} fragile${counts.low > 1 ? 's' : ''}` : '') + '.';
  return { level, label: LEVEL_LABELS[level], counts, summary };
}
