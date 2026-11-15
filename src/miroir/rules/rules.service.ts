import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PARAM_INFO, PARAMS, ParamKey, Rule, User } from '../domain/types';
import { PARAM_CHECKS } from '../evaluation/rule-templates';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';
import { TradesService } from '../trades/trades.service';

export interface SmartRuleSuggestion {
  param: ParamKey;
  label: string;
  currentScore: number;
  baselineScore: number;
  gap: number;
  isAtRisk: boolean;
  activeRule: Rule | null;
  suggestion: {
    text: string;
    threshold: number;
    unit: string;
    rationale: string;
    recommended: boolean;
  };
}

@Injectable()
export class RulesService {
  constructor(
    private store: Store,
    private events: EventsService,
    private trades: TradesService,
  ) {}

  /** Récupère les règles courantes avec suggestions intelligentes personnalisées. */
  async getSmartRules(user: User): Promise<{
    rules: Rule[];
    drift: User['drift'];
    status: User['status'];
    canResetDrift: boolean;
    suggestions: SmartRuleSuggestion[];
  }> {
    const profile = user.profile;
    const current = profile?.current ?? ({} as any);
    const baseline = profile?.baseline ?? ({} as any);

    const suggestions: SmartRuleSuggestion[] = PARAMS.map((param) => {
      const c = current[param] ?? 50;
      const b = baseline[param] ?? 50;
      const gap = c - b;
      const activeRule = user.rules.find((r) => r.param === param) ?? null;
      const check = PARAM_CHECKS[param];

      // Recommandation intelligente selon le comportement observé
      let smartThreshold = check.defaultThreshold;
      let rationale = 'Seuil standard recommandé pour protéger votre capital.';
      let recommended = false;

      if (param === 'fomo' && c >= 55) {
        smartThreshold = Math.max(10, check.defaultThreshold - 5);
        rationale = `Comportement FOMO élevé (${c}/100) : resserrez le seuil à ${smartThreshold} % pour bloquer les achats au sommet.`;
        recommended = true;
      } else if (param === 'lossAversion' && c >= 60) {
        smartThreshold = Math.max(8, check.defaultThreshold - 5);
        rationale = `Forte anxiété face aux pertes (${c}/100) : un seuil de ${smartThreshold} % évite la vente précipitée en plein creux.`;
        recommended = true;
      } else if (param === 'concentration' && c >= 50) {
        smartThreshold = 20;
        rationale = `Tendance à sur-concentrer (${c}/100) : plafonnez toute position à 20 % maximum.`;
        recommended = true;
      } else if (param === 'impulsivity' && c >= 55) {
        smartThreshold = 15;
        rationale = `Décisions trop rapides observées (${c}/100) : imposez-vous au moins 15 secondes de recul.`;
        recommended = true;
      } else if (param === 'newsSensitivity' && c >= 60) {
        smartThreshold = 3;
        rationale = `Très sensible aux nouvelles (${c}/100) : évitez de trader les jours de mouvement ≥ 3 %.`;
        recommended = true;
      } else if (param === 'riskTolerance' && c >= 65) {
        smartThreshold = 15;
        rationale = `Prise de risque accrue (${c}/100) : limitez les actifs spéculatifs à 15 % du total.`;
        recommended = true;
      }

      const isAtRisk = c >= 55 || gap >= 15 || recommended;

      return {
        param,
        label: PARAM_INFO[param].label,
        currentScore: c,
        baselineScore: b,
        gap,
        isAtRisk,
        activeRule,
        suggestion: {
          text: check.ruleText,
          threshold: smartThreshold,
          unit: check.unit,
          rationale,
          recommended: isAtRisk && !activeRule,
        },
      };
    });

    return {
      rules: user.rules,
      drift: user.drift,
      status: user.status,
      canResetDrift: user.drift.score > 0 || user.status === 'reevaluation_required',
      suggestions,
    };
  }

  /** Modifie ou remplace l'ensemble des règles (modifiable n'importe quand). */
  async saveRules(
    user: User,
    rawRules: Array<{ param: ParamKey; text: string; threshold: number }>,
    resetDrift = false,
  ) {
    if (!Array.isArray(rawRules)) throw new BadRequestException('Liste de règles requise.');

    const now = new Date().toISOString();
    const updatedRules: Rule[] = rawRules.map((r) => {
      if (!PARAMS.includes(r.param) || !r.text?.trim() || !(Number(r.threshold) > 0)) {
        throw new BadRequestException('Chaque règle requiert un paramètre valide, un texte et un seuil > 0.');
      }
      return {
        id: randomUUID(),
        param: r.param,
        text: r.text.trim().slice(0, 300),
        threshold: Number(r.threshold),
        createdAt: now,
      };
    });

    user.rules = updatedRules;

    // Si resetDrift demandé ou si le statut était en réévaluation requise : reset complet à 0
    if (resetDrift || user.status === 'reevaluation_required') {
      user.drift.score = 0;
      user.drift.overrides = 0;
      user.status = 'active';
      if (user.profile) {
        user.profile.baseline = { ...user.profile.current };
      }
      this.events.emit(
        'drift.reset',
        user,
        `Règles mises à jour (${user.rules.length}) et score de dérive réinitialisé à 0`,
      );
    } else {
      this.events.emit(
        'rules.updated',
        user,
        `Règles comportementales mises à jour (${user.rules.length} actives)`,
      );
    }

    await this.store.saveUser(user);
    return {
      ok: true,
      rules: user.rules,
      drift: user.drift,
      status: user.status,
    };
  }

  /** Réinitialise expressément le score de dérive à 0 suite au réajustement des règles. */
  async resetDrift(user: User) {
    return this.trades.resetDrift(user);
  }
}
