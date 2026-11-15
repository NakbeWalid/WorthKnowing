import { Injectable } from '@nestjs/common';
import { TriggeredRule, User } from '../../domain/types';
import { PARAM_CHECKS, ruleCrossed, ruleText, TradeMetrics } from '../../evaluation/rule-templates';

/**
 * Agent de gouvernance — vérifie AVANT l'exécution que le trade respecte :
 *   1. les règles que l'utilisateur s'est lui-même fixées (rappel + confirmation exigée) ;
 *   2. la cohérence avec son profil déclaré (avertissement, cf. persona « Robert »).
 * Déterministe et vérifiable : aucune IA générative ici, volontairement.
 */
@Injectable()
export class GovernanceAgent {
  triggeredRules(user: User, m: TradeMetrics): TriggeredRule[] {
    return user.rules
      .filter((rule) => ruleCrossed(rule, m))
      .map((rule) => ({
        ruleId: rule.id, param: rule.param,
        text: ruleText(rule),
        reason: PARAM_CHECKS[rule.param].evidence(m),
      }));
  }

  coherenceWarnings(user: User, m: TradeMetrics): string[] {
    if (m.side !== 'buy' || !user.profile) return [];
    const { context: c } = m;
    const prefs = user.preferences;
    const warnings: string[] = [];
    if (c.speculative && user.profile.declared.riskTolerance <= 40) {
      warnings.push(`Vous vous décrivez comme prudent, mais ${c.ticker} est un actif spéculatif (volatilité ${(c.vol30d * 100).toFixed(0)} %/an).`);
    }
    if (c.speculative && (prefs.horizon === '<3' || prefs.horizon === '3-5')) {
      warnings.push('Votre horizon est court : une forte baisse pourrait ne pas avoir le temps de se résorber.');
    }
    if (c.assetClass === 'crypto' && prefs.crypto === 'no') {
      warnings.push('Vous avez indiqué ne pas être intéressé par les cryptoactifs.');
    }
    if (prefs.esg === 'high' && c.sector === 'Energy') {
      warnings.push('Secteur Énergie : à vérifier selon vos critères ESG (aucune donnée ESG dans notre jeu de données — nous ne pouvons pas conclure).');
    }
    return warnings;
  }
}
