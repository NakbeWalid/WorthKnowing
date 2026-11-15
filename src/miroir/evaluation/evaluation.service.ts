import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { config } from '../config';
import {
  Decision, Evaluation, PARAM_INFO, PARAMS, ParamKey, ParamScores, Rule, Scenario, ScenarioType, User,
} from '../domain/types';
import { EventsService } from '../realtime/events.service';
import { readDataFile } from '../../shared/data-files';
import { Store } from '../storage/store';
import { QUESTIONS } from './questions';
import { PARAM_CHECKS } from './rule-templates';
import { overallReliability, Reading, Reliability, reliabilityOf, CONFIDENCE_LEVELS } from './reliability';
import { eventSentence, outcomeOf, SCENARIO_TYPES, STAKE } from './scenario-types';

/**
 * Évaluation du profil en 4 temps :
 *   1. questionnaire  -> profil DÉCLARÉ (comment l'utilisateur se voit)
 *   2. simulations    -> profil OBSERVÉ (comment il agit réellement)
 *   3. révélation     -> ce qui s'est vraiment passé + résultat de chaque décision
 *   4. règles         -> l'utilisateur encadre lui-même ses paramètres fragiles
 * La même mécanique sert à la réévaluation déclenchée par le score de dérive.
 * La bibliothèque de scénarios est lue au démarrage (S3 si DATA_BUCKET, sinon disque local).
 */
@Injectable()
export class EvaluationService implements OnModuleInit {
  private library: Scenario[] = [];

  constructor(private store: Store, private events: EventsService) {}

  async onModuleInit() {
    this.library = JSON.parse(await readDataFile('data/scenarios.json'));
  }

  questions() { return QUESTIONS; }

  /** Démarre une évaluation : enregistre le profil déclaré et tire les mises en situation (2 par type de comportement). */
  async start(user: User, answers?: Record<string, string>) {
    const kind = user.profile ? 'reevaluation' : 'initial';
    let declared = user.profile?.declared;
    if (answers) {
      declared = this.declaredFrom(answers);
      user.preferences = Object.fromEntries(
        QUESTIONS.filter((q) => q.kind === 'info').map((q) => [q.id, answers[q.id]]));
      await this.store.saveUser(user);
    }
    if (!declared) throw new BadRequestException('Le questionnaire est requis pour la première évaluation.');

    const scenarios = this.pickScenarios(user.seenScenarios);
    const evaluation: Evaluation = {
      id: randomUUID(), userId: user.id, kind, declared,
      scenarioIds: scenarios.map((s) => s.id), decisions: [], result: null,
      createdAt: new Date().toISOString(), completedAt: null,
    };
    await this.store.saveEvaluation(evaluation);

    return this.masked(evaluation);
  }

  /**
   * Reprise après un rechargement de page : l'évaluation en cours, les situations déjà répondues
   * et, si les simulations sont terminées, la révélation déjà calculée.
   */
  async resume(user: User, evaluationId: string) {
    const evaluation = await this.load(user, evaluationId);
    if (evaluation.completedAt) throw new NotFoundException('Cette évaluation est déjà terminée.');
    return {
      ...this.masked(evaluation),
      answered: this.validDecisions(evaluation).map((d) => d.scenarioId),
      result: evaluation.result,
    };
  }

  /** Vue masquée : ni le titre réel, ni les dates, ni la suite ne quittent le serveur. */
  /**
   * Réponses dont le choix existe encore. Une évaluation commencée avant le passage aux trois choix
   * (Vendre / Garder / Acheter) contient d'anciens identifiants (`sell_all`, `hold`…) : ces réponses sont
   * ignorées, la personne les refait, au lieu de faire échouer la révélation.
   */
  private validDecisions(evaluation: Evaluation) {
    return evaluation.decisions.filter((d) => {
      const s = this.library.find((x) => x.id === d.scenarioId);
      return !!s && SCENARIO_TYPES[s.type].choices.some((c) => c.id === d.choiceId);
    });
  }
  private masked(evaluation: Evaluation) {
    return {
      evaluationId: evaluation.id, kind: evaluation.kind, stake: STAKE,
      scenarios: evaluation.scenarioIds.map((id) => this.scenario(id)).map((s, i) => {
        const def = SCENARIO_TYPES[s.type];
        return {
          id: s.id, title: def.title, alias: aliasOf(i), maskLabel: s.maskLabel,
          headline: def.headline, situation: def.situation(s), context: s.context,
          choices: def.choices.map(({ id, label }) => ({ id, label })),
        };
      }),
    };
  }

  async decide(user: User, evaluationId: string, decision: Decision) {
    const evaluation = await this.load(user, evaluationId);
    if (evaluation.completedAt) throw new BadRequestException('Cette évaluation est déjà terminée.');
    // Une fois la révélation calculée, les réponses sont figées : on ne rejoue pas en connaissant la suite.
    if (evaluation.result) throw new BadRequestException('Les simulations sont terminées : les réponses ne peuvent plus changer.');
    const scenario = this.scenario(decision?.scenarioId);
    if (!evaluation.scenarioIds.includes(scenario.id)) throw new BadRequestException('Scénario hors évaluation.');
    if (!SCENARIO_TYPES[scenario.type].choices.some((c) => c.id === decision.choiceId)) {
      throw new BadRequestException('Choix invalide.');
    }
    evaluation.decisions = evaluation.decisions.filter((d) => d.scenarioId !== scenario.id);
    if (decision.confidence !== undefined && !CONFIDENCE_LEVELS.includes(decision.confidence)) {
      throw new BadRequestException('Niveau de confiance invalide.');
    }
    evaluation.decisions.push({
      scenarioId: scenario.id, choiceId: decision.choiceId, decisionTimeMs: Number(decision.decisionTimeMs) || 0,
      ...(decision.confidence ? { confidence: decision.confidence } : {}),
    });
    await this.store.saveEvaluation(evaluation);
    return { answered: this.validDecisions(evaluation).length, total: evaluation.scenarioIds.length };
  }

  /** Fin des simulations : révèle l'histoire réelle, chiffre chaque décision et bâtit le profil observé. */
  async complete(user: User, evaluationId: string) {
    const evaluation = await this.load(user, evaluationId);
    if (evaluation.result) return evaluation.result; // déjà calculée : même révélation à chaque appel
    if (this.validDecisions(evaluation).length < evaluation.scenarioIds.length) {
      throw new BadRequestException('Toutes les simulations doivent être complétées.');
    }
    const signals: Record<ParamKey, number[]> = Object.fromEntries(PARAMS.map((p) => [p, []])) as any;
    const timeSignals: number[] = [];
    // Toutes les mesures de chaque paramètre (réponses + temps de décision), pour en juger la fiabilité.
    const readings = Object.fromEntries(PARAMS.map((p) => [p, [] as Reading[]])) as Record<ParamKey, Reading[]>;

    // Dans l'ordre où les situations ont été présentées (et non l'ordre d'arrivée des réponses).
    const reveals = evaluation.scenarioIds.map((id, i) => {
      const d = evaluation.decisions.find((x) => x.scenarioId === id)!;
      const s = this.scenario(id);
      const def = SCENARIO_TYPES[s.type];
      const chosen = def.choices.find((c) => c.id === d.choiceId)!;
      for (const [param, value] of Object.entries(chosen.signals)) {
        signals[param as ParamKey].push(value);
        readings[param as ParamKey].push({ value, confidence: d.confidence, source: 'answer' });
      }
      const seconds = d.decisionTimeMs / 1000;
      timeSignals.push(seconds < 5 ? 85 : seconds < 12 ? 55 : 25);

      const options = def.choices.map((c) => ({ id: c.id, label: c.label, pnl: outcomeOf(s, c) }));
      const best = options.reduce((a, b) => (b.pnl > a.pnl ? b : a));
      return {
        scenarioId: s.id, alias: aliasOf(i), title: def.title, tests: def.tests, testsLabel: PARAM_INFO[def.tests].label,
        reveal: s.reveal, context: s.context, forward: s.forward, stats: s.stats, outcome: s.outcome,
        sentence: eventSentence(s),
        chosenId: chosen.id, bestId: best.id, options,
        pnl: options.find((o) => o.id === chosen.id)!.pnl,
        decisionSeconds: Math.round(seconds),
      };
    });
    signals.impulsivity.push(avg(timeSignals));
    readings.impulsivity.push({ value: avg(timeSignals), source: 'time' });

    const observed = Object.fromEntries(PARAMS.map((p) =>
      [p, signals[p].length ? Math.round(avg(signals[p])) : evaluation.declared[p]])) as ParamScores;

    // Fiabilité de chaque paramètre. La confiance déclarée n'entre PAS dans le score : voir reliability.ts.
    const reliability = Object.fromEntries(PARAMS.map((p) => [p, reliabilityOf(readings[p])])) as Record<ParamKey, Reliability>;
    const result = {
      reveals,
      totalPnl: reveals.reduce((sum, r) => sum + r.pnl, 0),
      observed,
      params: this.diagnose(evaluation.declared, observed, user.rules).map((row) => ({ ...row, reliability: reliability[row.param] })),
      reliability: overallReliability(reliability),
      note: 'Le profil mesure votre comportement, pas votre rendement : une décision risquée peut bien tourner par chance.',
    };
    evaluation.result = result;
    await this.store.saveEvaluation(evaluation);
    return result;
  }

  /** Dernière étape : l'utilisateur valide ses propres règles. Le profil devient la nouvelle référence. */
  async finalize(user: User, evaluationId: string, rules: { param: ParamKey; text: string; threshold: number }[]) {
    const evaluation = await this.load(user, evaluationId);
    const result = evaluation.result as { observed: ParamScores } | null;
    if (!result) throw new BadRequestException('Terminez les simulations avant de définir vos règles.');
    // Évite un double clic ou un rejeu : la dérive et le compteur d'évaluations ne doivent bouger qu'une fois.
    if (evaluation.completedAt) throw new BadRequestException('Cette évaluation est déjà terminée.');
    const now = new Date().toISOString();

    user.rules = (rules ?? []).map((r): Rule => {
      if (!PARAMS.includes(r.param) || !r.text?.trim() || !(Number(r.threshold) > 0)) {
        throw new BadRequestException('Règle invalide (paramètre, texte et seuil requis).');
      }
      return { id: randomUUID(), param: r.param, text: r.text.trim().slice(0, 300), threshold: Number(r.threshold), createdAt: now };
    });
    // Référence = comportement observé en simulation, combiné au CV s'il y en a un (source distincte).
    const cv = user.cvProfile?.inferredScores ?? null;
    const baseline = referenceProfile(result.observed, cv);
    user.profile = {
      declared: evaluation.declared, baseline: { ...baseline }, current: { ...baseline },
      evaluatedAt: now, evaluationCount: (user.profile?.evaluationCount ?? 0) + 1,
      sources: { observed: { ...result.observed }, cv: cv ? { ...cv } : null, cvWeight: cv ? CV_WEIGHT : 0 },
    };
    user.drift = { score: 0, overrides: 0 }; // remise à zéro de la dérive
    user.status = 'active';
    user.seenScenarios.push(...evaluation.scenarioIds);
    evaluation.completedAt = now;
    await this.store.saveEvaluation(evaluation);
    await this.store.saveUser(user);
    this.events.emit('evaluation.completed', user,
      `${evaluation.kind === 'initial' ? 'Évaluation initiale' : 'Réévaluation'} terminée — ${user.rules.length} règle(s) définie(s)`);
    return { ok: true };
  }

  // ---------------------------------------------------------------- privé
  private declaredFrom(answers: Record<string, string>): ParamScores {
    const scores = {} as ParamScores;
    for (const q of QUESTIONS) {
      const option = q.options.find((o) => o.id === answers[q.id]);
      if (!option) throw new BadRequestException(`Réponse manquante : ${q.text}`);
      if (q.param) scores[q.param] = option.score!;
    }
    return scores;
  }

  /**
   * `scenariosPerType` situations par type de biais, sur des actifs tous différents, jamais déjà vues si possible.
   * Elles sont données par « tours » (un exemplaire de chaque type par tour, dans un ordre mélangé) : deux situations
   * du même type ne se suivent jamais.
   */
  private pickScenarios(seen: string[]): Scenario[] {
    const types: ScenarioType[] = ['crash', 'hype', 'shock', 'flat', 'winner'];
    const picked: Scenario[] = [];
    for (let round = 0; round < config.scenariosPerType; round++) {
      const order = shuffle(types);
      if (picked.length && order[0] === picked[picked.length - 1].type) order.push(order.shift()!); // pas deux fois le même type d'affilée
      for (const type of order) {
        const pool = shuffle(this.library.filter((s) => s.type === type && !picked.some((p) => p.id === s.id)));
        const newAsset = (s: Scenario) => !picked.some((p) => p.reveal.ticker === s.reveal.ticker);
        const unseen = (s: Scenario) => !seen.includes(s.id);
        // Par ordre de préférence : actif nouveau et situation jamais vue, puis actif nouveau, puis jamais vue, puis n'importe laquelle.
        picked.push(pool.find((s) => newAsset(s) && unseen(s)) ?? pool.find(newAsset) ?? pool.find(unseen) ?? pool[0]);
      }
    }
    return picked;
  }
  /** Compare déclaré et observé, repère les paramètres fragiles et propose une règle pour chacun. */
  private diagnose(declared: ParamScores, observed: ParamScores, existingRules: Rule[]) {
    const rows = PARAMS.map((param) => {
      const gap = observed[param] - declared[param];
      let reason = '';
      if (param === 'riskTolerance') {
        if (Math.abs(gap) >= 25) reason = `Écart entre ce que vous dites (${declared[param]}) et ce que vous faites (${observed[param]}).`;
      } else if (gap >= 20) {
        reason = `Vous vous sous-estimez : déclaré ${declared[param]}, observé ${observed[param]}.`;
      } else if (observed[param] >= 60) {
        reason = `Comportement marqué en simulation (${observed[param]}/100).`;
      }
      const check = PARAM_CHECKS[param];
      const existing = existingRules.find((r) => r.param === param);
      return {
        param, label: PARAM_INFO[param].label, high: PARAM_INFO[param].high,
        declared: declared[param], observed: observed[param], gap, atRisk: reason !== '', reason,
        suggestedRule: { text: existing?.text ?? check.ruleText, threshold: existing?.threshold ?? check.defaultThreshold, unit: check.unit },
      };
    });
    // Toujours au moins deux garde-fous : on complète avec les paramètres les plus élevés.
    const byScore = rows.filter((r) => r.param !== 'riskTolerance').sort((a, b) => b.observed - a.observed);
    for (const row of byScore) {
      if (rows.filter((r) => r.atRisk).length >= 2) break;
      if (!row.atRisk) { row.atRisk = true; row.reason = 'Garde-fou préventif : votre paramètre le plus élevé.'; }
    }
    return rows;
  }

  private scenario(id: string) {
    const s = this.library.find((x) => x.id === id);
    if (!s) throw new NotFoundException('Scénario introuvable.');
    return s;
  }

  private async load(user: User, id: string) {
    const evaluation = await this.store.getEvaluation(id);
    if (!evaluation || evaluation.userId !== user.id) throw new NotFoundException('Évaluation introuvable.');
    return evaluation;
  }
}

/**
 * Poids du CV dans la référence du profil. Le CV décrit un parcours (expérience, secteur), pas des décisions :
 * il compte moins que les simulations, où l'on observe ce que la personne fait.
 */
export const CV_WEIGHT = 0.25;

/** Profil de référence : observé seul, ou (1 − CV_WEIGHT) × observé + CV_WEIGHT × CV. Le déclaré n'y entre pas. */
export function referenceProfile(observed: ParamScores, cv: ParamScores | null): ParamScores {
  if (!cv) return { ...observed };
  return Object.fromEntries(PARAMS.map((p) => {
    const fromCv = Number.isFinite(cv[p]) ? Math.max(0, Math.min(100, cv[p])) : observed[p];
    return [p, Math.round((1 - CV_WEIGHT) * observed[p] + CV_WEIGHT * fromCv)];
  })) as ParamScores;
}

/** « Titre A », « Titre B »… (assez de lettres pour toutes les situations d'une évaluation). */
export const aliasOf = (i: number) => `Titre ${String.fromCharCode(65 + i)}`;
const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
function shuffle<T>(items: T[]): T[] {
  return items.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
