import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PARAM_INFO, PARAMS, ParamKey, Rule, User } from '../domain/types';
import { PARAM_CHECKS, ruleText } from '../evaluation/rule-templates';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';

/** Ce que l'utilisateur envoie pour une règle : le comportement concerné et sa phrase. Pas de seuil. */
export interface RuleInput { param: ParamKey; text: string }

/** Nombre maximal de règles par utilisateur (au-delà, un rappel n'est plus lu). */
export const MAX_RULES = 12;
const MAX_TEXT = 300;

/** Règle telle qu'elle est affichée : texte final et, en clair, le cas où elle est rappelée. */
export interface RuleView {
  id: string;
  param: ParamKey;
  label: string;
  text: string;
  trigger: string;
  createdAt: string;
}

export interface RuleSuggestion {
  param: ParamKey;
  label: string;
  currentScore: number;
  baselineScore: number;
  gap: number;
  isAtRisk: boolean;
  /** L'utilisateur a-t-il déjà au moins une règle sur ce comportement ? */
  hasRule: boolean;
  trigger: string;
  suggestion: { text: string; rationale: string; recommended: boolean };
}

/** Pourquoi encadrer ce comportement, quand son score courant est élevé. */
const RATIONALES: Record<ParamKey, { from: number; text: (score: number) => string }> = {
  fomo: { from: 55, text: (c) => `Attrait marqué pour ce qui vient de monter (${c}/100) : une règle évite d’acheter au sommet.` },
  lossAversion: { from: 60, text: (c) => `Forte réaction aux pertes (${c}/100) : une règle évite de vendre dans la panique.` },
  concentration: { from: 50, text: (c) => `Tendance à concentrer (${c}/100) : une règle garde le portefeuille réparti.` },
  impulsivity: { from: 55, text: (c) => `Décisions rapides (${c}/100) : une règle impose un temps de recul.` },
  newsSensitivity: { from: 60, text: (c) => `Sensible aux nouvelles (${c}/100) : une règle évite de réagir à chaud.` },
  riskTolerance: { from: 65, text: (c) => `Prise de risque élevée (${c}/100) : une règle limite les actifs spéculatifs.` },
};

/** Valide une règle reçue du navigateur. */
export function checkRuleInput(raw: Partial<RuleInput> | undefined): RuleInput {
  const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
  if (!raw || !PARAMS.includes(raw.param as ParamKey)) throw new BadRequestException('Choisissez le comportement que la règle encadre.');
  if (!text) throw new BadRequestException('Écrivez le texte de la règle.');
  if (text.length > MAX_TEXT) throw new BadRequestException(`Le texte d’une règle ne dépasse pas ${MAX_TEXT} caractères.`);
  return { param: raw.param as ParamKey, text };
}

/** Construit la liste complète des règles d'un utilisateur à partir de ce qu'il a saisi. */
export function buildRules(raw: Partial<RuleInput>[] | undefined, now = new Date().toISOString()): Rule[] {
  if (raw !== undefined && !Array.isArray(raw)) throw new BadRequestException('Liste de règles requise.');
  if ((raw ?? []).length > MAX_RULES) throw new BadRequestException(`${MAX_RULES} règles au maximum.`);
  return (raw ?? []).map((r) => ({ id: randomUUID(), ...checkRuleInput(r), createdAt: now }));
}

export function ruleView(rule: Rule): RuleView {
  return {
    id: rule.id, param: rule.param, label: PARAM_INFO[rule.param].label,
    text: ruleText(rule), trigger: PARAM_CHECKS[rule.param].trigger, createdAt: rule.createdAt,
  };
}

/**
 * Règles personnelles : des phrases que l'utilisateur écrit, ajoute, modifie et retire quand il veut.
 * Chaque règle est rattachée à un comportement ; elle est rappelée quand un ordre met ce comportement en jeu.
 * Aucune de ces opérations ne touche au score de dérive ni au statut : seule une (ré)évaluation complète les remet à zéro.
 */
@Injectable()
export class RulesService {
  constructor(private store: Store, private events: EventsService) {}

  /** Règles courantes et, pour chaque comportement, une règle proposée. */
  async getSmartRules(user: User): Promise<{
    rules: RuleView[]; drift: User['drift']; status: User['status']; maxRules: number; suggestions: RuleSuggestion[];
  }> {
    const current = user.profile?.current;
    const baseline = user.profile?.baseline;
    const suggestions: RuleSuggestion[] = PARAMS.map((param) => {
      const c = current?.[param] ?? 50;
      const b = baseline?.[param] ?? 50;
      const hasRule = user.rules.some((r) => r.param === param);
      const marked = c >= RATIONALES[param].from;
      const isAtRisk = marked || c >= 55 || c - b >= 15;
      return {
        param, label: PARAM_INFO[param].label, currentScore: c, baselineScore: b, gap: c - b, isAtRisk, hasRule,
        trigger: PARAM_CHECKS[param].trigger,
        suggestion: {
          text: PARAM_CHECKS[param].ruleText,
          rationale: marked ? RATIONALES[param].text(c)
            : c - b >= 15 ? `Ce comportement s’est accentué depuis votre évaluation (${b} → ${c}).`
            : 'Règle type pour ce comportement.',
          recommended: isAtRisk && !hasRule,
        },
      };
    });
    return { rules: user.rules.map(ruleView), drift: user.drift, status: user.status, maxRules: MAX_RULES, suggestions };
  }

  /** Remplace l'ensemble des règles. */
  async saveRules(user: User, rawRules: Partial<RuleInput>[]) {
    if (!Array.isArray(rawRules)) throw new BadRequestException('Liste de règles requise.');
    user.rules = buildRules(rawRules);
    return this.saved(user, `Règles personnelles mises à jour (${user.rules.length} actives)`);
  }

  async addRule(user: User, raw: Partial<RuleInput>) {
    if (user.rules.length >= MAX_RULES) throw new BadRequestException(`${MAX_RULES} règles au maximum : retirez-en une avant d’en ajouter.`);
    const rule: Rule = { id: randomUUID(), ...checkRuleInput(raw), createdAt: new Date().toISOString() };
    user.rules.push(rule);
    return { ...(await this.saved(user, `Règle ajoutée : ${PARAM_INFO[rule.param].label}`)), rule: ruleView(rule) };
  }

  async updateRule(user: User, id: string, raw: Partial<RuleInput>) {
    const rule = user.rules.find((r) => r.id === id);
    if (!rule) throw new NotFoundException('Règle introuvable.');
    const input = checkRuleInput({ param: raw?.param ?? rule.param, text: raw?.text ?? ruleText(rule) });
    // Le texte est désormais celui que l'utilisateur vient d'écrire : l'ancien seuil chiffré n'a plus lieu d'être.
    delete rule.threshold;
    Object.assign(rule, input, { updatedAt: new Date().toISOString() });
    return { ...(await this.saved(user, `Règle modifiée : ${PARAM_INFO[rule.param].label}`)), rule: ruleView(rule) };
  }

  async removeRule(user: User, id: string) {
    const rule = user.rules.find((r) => r.id === id);
    if (!rule) throw new NotFoundException('Règle introuvable.');
    user.rules = user.rules.filter((r) => r.id !== id);
    return this.saved(user, `Règle retirée : ${PARAM_INFO[rule.param].label}`);
  }

  private async saved(user: User, message: string) {
    await this.store.saveUser(user);
    this.events.emit('rules.updated', user, message);
    return { ok: true, rules: user.rules.map(ruleView), drift: user.drift, status: user.status };
  }
}
