import { MarketContext, ParamKey, pct } from '../domain/types';

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
  /** Règle proposée à l'utilisateur ; « {seuil} » = valeur du seuil. */
  ruleText: string;
  defaultThreshold: number;
  unit: string;
  /** La règle (ou le constat) se déclenche-t-elle pour ce trade, avec ce seuil ? */
  crossed: (m: TradeMetrics, threshold: number) => boolean;
  /** Intensité du comportement observé (0–100). */
  signal: (m: TradeMetrics) => number;
  evidence: (m: TradeMetrics) => string;
}

const cap = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Une seule définition par paramètre, utilisée à deux endroits :
 *  - agent de gouvernance : avec le seuil que l'utilisateur s'est fixé  -> rappel de sa règle ;
 *  - agent de comportement : avec le seuil par défaut                   -> constat de l'enquête.
 */
export const PARAM_CHECKS: Record<ParamKey, ParamCheck> = {
  fomo: {
    ruleText: 'Je n’achète pas un actif qui a monté de plus de {seuil} % en 30 séances sans attendre 24 h.',
    defaultThreshold: 20, unit: '% en 30 séances',
    crossed: (m, t) => m.side === 'buy' && m.context.ret30d * 100 >= t,
    signal: (m) => cap(50 + m.context.ret30d * 100),
    evidence: (m) => `Achat après une hausse de ${pct(m.context.ret30d)} en 30 séances.`,
  },
  lossAversion: {
    ruleText: 'Je ne vends pas un actif qui a baissé de plus de {seuil} % depuis son sommet sans relire ma thèse.',
    defaultThreshold: 15, unit: '% sous le sommet 90 séances',
    crossed: (m, t) => m.side === 'sell' && -m.context.drawdown90d * 100 >= t,
    signal: (m) => cap(50 - m.context.drawdown90d * 100),
    evidence: (m) => `Vente alors que l’actif est à ${pct(m.context.drawdown90d)} de son sommet de 90 séances.`,
  },
  concentration: {
    ruleText: 'Aucune position ne dépasse {seuil} % de mon portefeuille.',
    defaultThreshold: 30, unit: '% du portefeuille',
    crossed: (m, t) => m.side === 'buy' && m.positionWeight * 100 > t,
    signal: (m) => cap(40 + m.positionWeight * 100),
    evidence: (m) => `Après ce trade, la position pèse ${(m.positionWeight * 100).toFixed(0)} % du portefeuille.`,
  },
  impulsivity: {
    ruleText: 'Je prends au moins {seuil} secondes de réflexion avant de confirmer un trade.',
    defaultThreshold: 10, unit: 'secondes',
    crossed: (m, t) => m.decisionSeconds < t,
    signal: (m) => (m.decisionSeconds < 5 ? 90 : 72),
    evidence: (m) => `Décision prise en ${m.decisionSeconds.toFixed(0)} s.`,
  },
  newsSensitivity: {
    ruleText: 'Je ne trade pas un actif qui vient de bouger de plus de {seuil} % en une séance.',
    defaultThreshold: 5, unit: '% en une séance',
    crossed: (m, t) => Math.abs(m.context.ret1d) * 100 >= t,
    signal: (m) => cap(50 + 4 * Math.abs(m.context.ret1d) * 100),
    evidence: (m) => `Trade le jour d’un mouvement de ${pct(m.context.ret1d)} (réaction à chaud probable).`,
  },
  riskTolerance: {
    ruleText: 'Les actifs spéculatifs (crypto, très forte volatilité) ne dépassent pas {seuil} % de mon portefeuille.',
    defaultThreshold: 20, unit: '% du portefeuille',
    crossed: (m, t) => m.side === 'buy' && m.context.speculative && m.speculativeWeight * 100 > t,
    signal: (m) => cap(50 + m.speculativeWeight * 100),
    evidence: (m) => `Achat d’un actif spéculatif (volatilité ${(m.context.vol30d * 100).toFixed(0)} %/an) : ${(m.speculativeWeight * 100).toFixed(0)} % du portefeuille en actifs spéculatifs.`,
  },
};
