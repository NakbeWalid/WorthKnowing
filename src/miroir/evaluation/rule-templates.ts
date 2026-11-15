import { MarketContext, ParamKey, pct, Rule } from '../domain/types';

/** Mesures d'un trade utilisées pour décider si un paramètre du profil est « mis en jeu ». */
export interface TradeMetrics {
  side: 'buy' | 'sell';
  context: MarketContext;
  /** Poids de la position dans le portefeuille après le trade (0–1). */
  positionWeight: number;
  /** Poids des actifs spéculatifs dans le portefeuille après le trade (0–1). */
  speculativeWeight: number;
  decisionSeconds: number;
}

interface ParamCheck {
  /** Règle proposée à l'utilisateur : une phrase, sans chiffre à régler. */
  ruleText: string;
  /** Seuil de détection, fixe et interne : l'utilisateur ne le règle pas, il écrit seulement le texte de sa règle. */
  defaultThreshold: number;
  /** Dans quel cas la règle est rappelée, en clair (affiché à côté de la règle). */
  trigger: string;
  /** Le comportement est-il mis en jeu par ce trade ? (`threshold` : seuil interne, ou celui d'une ancienne règle chiffrée) */
  crossed: (m: TradeMetrics, threshold: number) => boolean;
  /** Intensité du comportement observé (0–100). */
  signal: (m: TradeMetrics) => number;
  evidence: (m: TradeMetrics) => string;
}

const cap = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Une seule définition par paramètre, utilisée à deux endroits :
 *  - agent de gouvernance : rappel des règles (textuelles) que l'utilisateur a rattachées à ce comportement ;
 *  - agent de comportement : constat de l'enquête.
 * Les deux utilisent le même seuil interne : une règle est rappelée exactement quand son comportement est mis en jeu.
 */
export const PARAM_CHECKS: Record<ParamKey, ParamCheck> = {
  fomo: {
    ruleText: 'Je n’achète pas un actif qui vient de fortement monter sans attendre 24 h.',
    defaultThreshold: 20, trigger: 'achat d’un actif qui a monté d’au moins 20 % en 30 séances',
    crossed: (m, t) => m.side === 'buy' && m.context.ret30d * 100 >= t,
    signal: (m) => cap(50 + m.context.ret30d * 100),
    evidence: (m) => `Achat après une hausse de ${pct(m.context.ret30d)} en 30 séances.`,
  },
  lossAversion: {
    ruleText: 'Je ne vends pas un actif en forte baisse sans relire ma thèse d’investissement.',
    defaultThreshold: 15, trigger: 'vente d’un actif à 15 % ou plus sous son sommet des 90 dernières séances',
    crossed: (m, t) => m.side === 'sell' && -m.context.drawdown90d * 100 >= t,
    signal: (m) => cap(50 - m.context.drawdown90d * 100),
    evidence: (m) => `Vente alors que l’actif est à ${pct(m.context.drawdown90d)} de son sommet de 90 séances.`,
  },
  concentration: {
    ruleText: 'Je ne laisse aucune position dominer mon portefeuille.',
    defaultThreshold: 30, trigger: 'achat qui porte une position à plus de 30 % du portefeuille',
    crossed: (m, t) => m.side === 'buy' && m.positionWeight * 100 > t,
    signal: (m) => cap(40 + m.positionWeight * 100),
    evidence: (m) => `Après ce trade, la position pèse ${(m.positionWeight * 100).toFixed(0)} % du portefeuille.`,
  },
  impulsivity: {
    ruleText: 'Je prends le temps de réfléchir avant de confirmer un ordre.',
    defaultThreshold: 10, trigger: 'ordre confirmé en moins de 10 secondes',
    crossed: (m, t) => m.decisionSeconds < t,
    signal: (m) => (m.decisionSeconds < 5 ? 90 : 72),
    evidence: (m) => `Décision prise en ${m.decisionSeconds.toFixed(0)} s.`,
  },
  newsSensitivity: {
    ruleText: 'Je ne trade pas à chaud un actif qui vient de fortement bouger dans la journée.',
    defaultThreshold: 5, trigger: 'ordre sur un actif qui a bougé d’au moins 5 % dans la séance',
    crossed: (m, t) => Math.abs(m.context.ret1d) * 100 >= t,
    signal: (m) => cap(50 + 4 * Math.abs(m.context.ret1d) * 100),
    evidence: (m) => `Trade le jour d’un mouvement de ${pct(m.context.ret1d)} (réaction à chaud probable).`,
  },
  riskTolerance: {
    ruleText: 'Je garde les actifs spéculatifs (crypto, très forte volatilité) à une petite part de mon portefeuille.',
    defaultThreshold: 20, trigger: 'achat d’un actif spéculatif qui porte ces actifs à plus de 20 % du portefeuille',
    crossed: (m, t) => m.side === 'buy' && m.context.speculative && m.speculativeWeight * 100 > t,
    signal: (m) => cap(50 + m.speculativeWeight * 100),
    evidence: (m) => `Achat d’un actif spéculatif (volatilité ${(m.context.vol30d * 100).toFixed(0)} %/an) : ${(m.speculativeWeight * 100).toFixed(0)} % du portefeuille en actifs spéculatifs.`,
  },
};

/** Texte d'une règle tel qu'on l'affiche. Les anciennes règles chiffrées contiennent « {seuil} ». */
export function ruleText(rule: Pick<Rule, 'param' | 'text' | 'threshold'>): string {
  return rule.text.replace('{seuil}', String(rule.threshold ?? PARAM_CHECKS[rule.param].defaultThreshold));
}

/** La règle doit-elle être rappelée pour ce trade ? (seuil interne ; une ancienne règle chiffrée garde le sien) */
export function ruleCrossed(rule: Pick<Rule, 'param' | 'threshold'>, m: TradeMetrics): boolean {
  const check = PARAM_CHECKS[rule.param];
  return check.crossed(m, rule.threshold ?? check.defaultThreshold);
}
