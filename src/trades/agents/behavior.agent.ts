import { Injectable } from '@nestjs/common';
import { clamp, Finding, PARAMS, TriggeredRule } from '../../domain/types';
import { PARAM_CHECKS, TradeMetrics } from '../../evaluation/rule-templates';

/**
 * Agent de comportement — cœur de l'enquête : quels paramètres du profil ce trade met-il en jeu ?
 * Chaque constat porte sa preuve chiffrée (issue des prix), jamais une justification inventée.
 * C'est le socle vérifiable ; l'agent d'influence (influence.agent.ts, Bedrock) ne peut qu'y ajouter
 * des constats bornés sur les paramètres que ce socle n'a pas déjà relevés.
 */
@Injectable()
export class BehaviorAgent {
  analyse(m: TradeMetrics, overridden: TriggeredRule[]): Finding[] {
    return PARAMS
      .filter((param) => PARAM_CHECKS[param].crossed(m, PARAM_CHECKS[param].defaultThreshold))
      .map((param) => {
        const check = PARAM_CHECKS[param];
        const override = overridden.some((r) => r.param === param);
        return {
          param, origin: 'rules' as const,
          // Passer outre sa propre règle renforce le signal.
          signal: clamp(check.signal(m) + (override ? 10 : 0)),
          evidence: check.evidence(m) + (override ? ' Règle personnelle outrepassée.' : ''),
        };
      });
  }
}
