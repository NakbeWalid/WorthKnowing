import { Injectable } from '@nestjs/common';
import { Investigation, PARAM_INFO, Trade } from '../../domain/types';

type Draft = Omit<Investigation, 'explanation'>;

/**
 * Agent d'explicabilité — transforme l'enquête en explication lisible :
 * étapes observables, sources, hypothèses et limites.
 *
 * ▶ POINT D'INTÉGRATION AWS (Kiro) : créer `BedrockExplainer` (Amazon Bedrock) qui rédige
 *   `summary` en langage naturel À PARTIR de ces mêmes faits. Les champs steps / sources /
 *   hypotheses / limits doivent rester générés par le code, pas par le modèle.
 */
export abstract class Explainer {
  abstract explain(trade: Omit<Trade, 'investigation'>, draft: Draft): Promise<Investigation['explanation']>;
}

@Injectable()
export class TemplateExplainer extends Explainer {
  async explain(trade: Omit<Trade, 'investigation'>, d: Draft) {
    const action = `${trade.side === 'buy' ? 'Achat' : 'Vente'} de ${trade.amount.toLocaleString('fr-CA')} $ de ${trade.ticker}`;
    const involved = d.findings.map((f) => PARAM_INFO[f.param].label.toLowerCase());
    const summary = d.findings.length
      ? `${action} : ${involved.length} paramètre(s) de votre profil mis en jeu (${involved.join(', ')}). Score de dérive ${d.driftBefore} → ${d.driftAfter}.`
      : `${action} : aucun écart détecté par rapport à votre profil. Score de dérive ${d.driftBefore} → ${d.driftAfter}.`;

    return {
      summary,
      steps: [
        { agent: 'Agent marché', result: `Prix ${d.context.price.toFixed(2)} ${d.context.currency} au ${d.context.date} ; 30 séances ${(d.context.ret30d * 100).toFixed(1)} %, volatilité ${(d.context.vol30d * 100).toFixed(0)} %/an.` },
        { agent: 'Agent nouvelles', result: d.news.length ? `${d.news.length} signal(aux) : ${d.news.map((n) => n.title).join(' | ')}` : 'Aucun signal notable autour de la date du trade.' },
        { agent: 'Agent gouvernance', result: d.triggeredRules.length ? `${d.triggeredRules.length} règle(s) personnelle(s) rappelée(s) puis outrepassée(s).` : 'Aucune règle personnelle concernée.' },
        { agent: 'Agent comportement', result: d.findings.length ? d.findings.map((f) => f.evidence).join(' ') : 'Trade conforme au profil de référence.' },
        { agent: 'Mise à jour du profil', result: d.paramUpdates.length ? d.paramUpdates.map((u) => `${PARAM_INFO[u.param].label} ${u.before} → ${u.after}`).join(' ; ') : 'Aucun paramètre modifié.' },
      ],
      sources: [
        'dataset/prices_daily.csv — Yahoo Finance via yfinance, extraction du 2026-11-13',
        ...new Set(d.news.map((n) => n.source)),
        'Profil et règles : évaluation de l’utilisateur',
      ],
      hypotheses: [
        'Un paramètre est « mis en jeu » quand le trade franchit un seuil fixe (ex. achat après +20 % en 30 séances).',
        '« Spéculatif » = cryptoactif ou volatilité annualisée ≥ 45 %.',
        'Chaque constat déplace le paramètre de 35 % vers le signal observé.',
      ],
      limits: [
        d.news.some((n) => n.simulated) ? 'Les « nouvelles » sont des signaux simulés à partir des prix, pas de vraies dépêches.' : 'Couverture des nouvelles limitée aux sources interrogées.',
        'Données quotidiennes : l’heure exacte et les mouvements intrajournaliers sont ignorés.',
        'Montants non convertis entre CAD et USD.',
        'Un seul trade ne prouve pas un changement de comportement : le score de dérive agrège plusieurs trades.',
        'Simulation uniquement — aucun conseil financier.',
      ],
    };
  }
}
