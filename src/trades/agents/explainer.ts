import { Injectable, Logger } from '@nestjs/common';
import { BedrockClient } from '../../ai/bedrock.client';
import { inventedNumbers } from '../../ai/guards';
import { InfluenceVerdict, Investigation, PARAM_INFO, Trade } from '../../domain/types';

type Draft = Omit<Investigation, 'explanation'>;

/**
 * Agent d'explicabilité — transforme l'enquête en explication lisible :
 * étapes observables, sources, hypothèses et limites.
 * Implémentation AWS : `BedrockExplainer` (EXPLAINER_DRIVER=bedrock) ne rédige que le résumé ;
 * steps / sources / hypotheses / limits restent générés par le code.
 */
export abstract class Explainer {
  abstract explain(trade: Omit<Trade, 'investigation'>, draft: Draft): Promise<Investigation['explanation']>;
}

export const VERDICT_LABELS: Record<InfluenceVerdict['verdict'], string> = {
  influence_externe: 'influence externe possible',
  changement_de_comportement: 'changement de comportement',
  les_deux: 'influence externe et changement de comportement',
  conforme: 'rien de particulier',
  indetermine: 'impossible de conclure',
};

@Injectable()
export class TemplateExplainer extends Explainer {
  async explain(trade: Omit<Trade, 'investigation'>, d: Draft) {
    const action = `${trade.side === 'buy' ? 'Achat' : 'Vente'} de ${trade.amount.toLocaleString('fr-CA')} $ de ${trade.ticker}`;
    const involved = [...new Set(d.findings.map((f) => PARAM_INFO[f.param].label.toLowerCase()))];
    const summary = d.findings.length
      ? `${action} : ${involved.length} paramètre(s) de votre profil mis en jeu (${involved.join(', ')}). Score de dérive ${d.driftBefore} → ${d.driftAfter}.`
      : `${action} : aucun écart détecté par rapport à votre profil. Score de dérive ${d.driftBefore} → ${d.driftAfter}.`;
    const ruleFindings = d.findings.filter((f) => f.origin !== 'bedrock');
    const aiFindings = d.findings.filter((f) => f.origin === 'bedrock');

    const steps = [
      { agent: 'Agent marché', result: `Prix ${d.context.price.toFixed(2)} ${d.context.currency} au ${d.context.date} ; 30 séances ${(d.context.ret30d * 100).toFixed(1)} %, volatilité ${(d.context.vol30d * 100).toFixed(0)} %/an.` },
      { agent: 'Agent nouvelles', result: newsStep(d) },
      { agent: 'Agent gouvernance', result: d.triggeredRules.length ? `${d.triggeredRules.length} règle(s) personnelle(s) rappelée(s) puis outrepassée(s).` : 'Aucune règle personnelle concernée.' },
      { agent: 'Agent comportement', result: ruleFindings.length ? ruleFindings.map((f) => f.evidence).join(' ') : 'Aucun seuil franchi par rapport au profil de référence.' },
    ];
    if (d.influence) {
      steps.push({
        agent: 'Agent d’influence (IA, Amazon Bedrock)',
        result: `Verdict : ${VERDICT_LABELS[d.influence.verdict]}. ${d.influence.rationale}`
          + (aiFindings.length ? ` ${aiFindings.map((f) => f.evidence).join(' ')}` : ''),
      });
    }
    steps.push({ agent: 'Mise à jour du profil', result: d.paramUpdates.length ? d.paramUpdates.map((u) => `${PARAM_INFO[u.param].label} ${u.before} → ${u.after}`).join(' ; ') : 'Aucun paramètre modifié.' });

    return {
      summary,
      steps,
      sources: [
        'dataset/prices_daily.csv — Yahoo Finance via yfinance, extraction du 2026-11-13',
        ...new Set(d.news.map((n) => n.simulated
          ? n.source
          : `${n.source} — « ${n.title} » (${n.date}) ${n.url} — via GDELT, récupéré le ${n.retrievedAt?.slice(0, 10)}`)),
        'Profil et règles : évaluation de l’utilisateur',
      ],
      hypotheses: [
        'Un paramètre est « mis en jeu » quand le trade franchit un seuil fixe (ex. achat après +20 % en 30 séances).',
        '« Spéculatif » = cryptoactif ou volatilité annualisée ≥ 45 %.',
        'Chaque constat déplace le paramètre de 35 % vers le signal observé.',
        ...(d.influence ? ['Un constat de l’agent d’influence (IA) ne porte que sur les nouvelles, le « hype » ou les pertes, doit citer une donnée fournie, et son signal reste à ±15 points du signal calculé par le code.'] : []),
      ],
      limits: [
        newsLimit(d),
        'Données quotidiennes : l’heure exacte et les mouvements intrajournaliers sont ignorés.',
        'Montants non convertis entre CAD et USD.',
        'Un seul trade ne prouve pas un changement de comportement : le score de dérive agrège plusieurs trades.',
        ...(d.influence ? ['Une nouvelle publiée avant le trade ne prouve pas que vous l’avez lue : l’influence est une hypothèse.'] : []),
        'Simulation uniquement — aucun conseil financier.',
      ],
    };
  }
}

const SYSTEM = `Tu rédiges le résumé d'une enquête de Miroir, un outil éducatif de SIMULATION d'investissement.
Tu t'adresses à l'investisseur en le vouvoyant, en français clair, sans jargon.
Règles absolues : tu n'utilises QUE les faits fournis ; tu recopies les chiffres tels quels sans en calculer de nouveaux ;
tu n'ajoutes aucune cause, aucune prévision, aucun conseil d'achat ou de vente ; tu ne qualifies pas une durée
(ni « rapide » ni « lent ») si les faits ne le font pas. Une nouvelle antérieure au trade ne prouve pas qu'elle l'a
déclenché : écris au plus « possiblement influencé par ». Pas de vocabulaire psychologique : c'est un profil de comportement.
Tu réponds uniquement par un objet JSON.`;

/**
 * Résumé en langage naturel rédigé par Amazon Bedrock à partir des faits de l'enquête.
 * Garde-fou : tout nombre du résumé doit figurer dans les faits fournis, sinon on garde le résumé gabarit.
 */
@Injectable()
export class BedrockExplainer extends TemplateExplainer {
  private log = new Logger('BedrockExplainer');
  constructor(private bedrock: BedrockClient) {
    super();
  }

  async explain(trade: Omit<Trade, 'investigation'>, d: Draft) {
    const base = await super.explain(trade, d);
    const facts = [
      `Trade : ${trade.side === 'buy' ? 'achat' : 'vente'} de ${trade.amount.toLocaleString('fr-CA')} $ de ${trade.ticker} (${d.context.name}) à la date de marché ${d.context.date}.`,
      `Score de dérive : ${d.driftBefore} avant, ${d.driftAfter} après (sur 100).`,
      ...d.findings.map((f) => `Constat (${PARAM_INFO[f.param].label}) : ${f.evidence}`),
      ...d.paramUpdates.map((u) => `${PARAM_INFO[u.param].label} : ${u.before} → ${u.after}.`),
      ...d.triggeredRules.map((r) => `Règle personnelle outrepassée : « ${r.text} »`),
      ...d.warnings.map((w) => `Avertissement de cohérence : ${w}`),
      ...d.news.filter((n) => !n.simulated).slice(0, 3).map((n) => `Nouvelle (${n.date}, ${n.source}) : ${n.summary ?? n.title}`),
      ...(d.influence ? [`Agent d'influence : ${VERDICT_LABELS[d.influence.verdict]} — ${d.influence.rationale}`] : []),
      ...(d.findings.length ? [] : ['Aucun écart détecté par rapport au profil de référence.']),
    ];
    const prompt = `Faits :\n${facts.map((f) => `- ${f}`).join('\n')}

Écris un résumé de 2 ou 3 phrases (70 mots maximum) : ce que montre ce trade sur le comportement de l'investisseur
et l'évolution du score de dérive. Format : {"summary":"..."}`;
    try {
      const out = await this.bedrock.json<{ summary?: unknown }>(SYSTEM, prompt, 400);
      const summary = typeof out.summary === 'string' ? out.summary.trim() : '';
      if (!summary) throw new Error('résumé vide');
      const unknown = inventedNumbers(summary, facts.join(' '));
      if (unknown.length) throw new Error(`chiffres absents des faits : ${unknown.join(', ')}`);
      return { ...base, summary: `${summary.slice(0, 600)} (Résumé rédigé par IA à partir des faits ci-dessous.)` };
    } catch (err) {
      this.log.warn(`résumé gabarit conservé : ${(err as Error).message}`);
      return base;
    }
  }
}

/** Étape « Agent nouvelles » : distingue toujours vraies manchettes, signaux simulés et absence de signal. */
function newsStep(d: Draft): string {
  if (!d.news.length) return 'Aucune nouvelle trouvée dans les 7 jours précédant le trade : aucun signal.';
  if (d.news.every((n) => n.simulated)) return `${d.news.length} signal(aux) simulé(s) : ${d.news.map((n) => n.title).join(' | ')}`;
  return `${d.news.length} manchette(s) réelle(s) des 7 jours précédents (GDELT, classées par Amazon Bedrock) : `
    + d.news.map((n) => `[${n.impact}] ${n.date} ${n.source} — ${n.title}`).join(' | ');
}

function newsLimit(d: Draft): string {
  if (d.news.some((n) => n.simulated)) return 'Les « nouvelles » sont des signaux simulés à partir des prix, pas de vraies dépêches.';
  if (d.news.length) return 'Nouvelles : manchettes en anglais indexées par GDELT, 7 jours avant le trade ; l’impact est une estimation du modèle (Amazon Bedrock), pas une mesure.';
  return 'Aucune nouvelle trouvée : cela ne prouve pas qu’il n’y en avait pas (couverture limitée aux sources interrogées).';
}
