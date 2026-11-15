import { ParamKey, pct, Scenario, ScenarioType } from '../domain/types';

export interface Choice {
  id: string;
  label: string;
  /** Part de la mise de 10 000 $ exposée à l'actif après la décision. */
  exposure: number;
  /** Ce que ce choix révèle sur les paramètres du profil (0–100). */
  signals: Partial<Record<ParamKey, number>>;
}

interface ScenarioTypeDef {
  title: string;
  /** Paramètre principalement testé. */
  tests: ParamKey;
  /** Manchette FICTIVE affichée pendant la simulation (jamais présentée comme un fait). */
  headline: string;
  situation: (s: Scenario) => string;
  choices: Choice[];
}

/** Mise fictive utilisée pour chiffrer le résultat de chaque décision. */
export const STAKE = 10_000;

/**
 * Les 5 mises en situation. Le décor (nom, manchette) est fictif pour que l'utilisateur
 * ne reconnaisse pas l'épisode ; la courbe de prix et la suite sont réelles.
 */
export const SCENARIO_TYPES: Record<ScenarioType, ScenarioTypeDef> = {
  crash: {
    title: 'La chute',
    tests: 'lossAversion',
    headline: '« Les vendeurs dominent : les analystes abaissent leurs cibles les uns après les autres. »',
    situation: (s) => `Vous détenez ${STAKE.toLocaleString('fr-CA')} $ de ce titre. Il vient de perdre ${(-s.stats.ret30d * 100).toFixed(1)} % en 30 séances.`,
    choices: [
      { id: 'sell_all', label: 'Je vends tout', exposure: 0, signals: { lossAversion: 90, riskTolerance: 15 } },
      { id: 'sell_half', label: 'Je vends la moitié', exposure: 0.5, signals: { lossAversion: 65, riskTolerance: 35 } },
      { id: 'hold', label: 'Je ne touche à rien', exposure: 1, signals: { lossAversion: 35, riskTolerance: 60 } },
      { id: 'buy_more', label: 'J’en rachète (+50 %)', exposure: 1.5, signals: { lossAversion: 15, riskTolerance: 85 } },
    ],
  },
  hype: {
    title: 'L’emballement',
    tests: 'fomo',
    headline: '« Tout le monde en parle : le titre enchaîne les records et envahit les réseaux sociaux. »',
    situation: (s) => `Vous avez ${STAKE.toLocaleString('fr-CA')} $ en liquidités. Ce titre, que vous ne détenez pas, a pris ${pct(s.stats.ret60d)} en 60 séances.`,
    choices: [
      { id: 'all_in', label: 'J’investis tout', exposure: 1, signals: { fomo: 90, riskTolerance: 90 } },
      { id: 'half', label: 'J’investis la moitié', exposure: 0.5, signals: { fomo: 65, riskTolerance: 70 } },
      { id: 'small', label: 'Une petite position (10 %)', exposure: 0.1, signals: { fomo: 35, riskTolerance: 45 } },
      { id: 'none', label: 'Je passe mon tour', exposure: 0, signals: { fomo: 15, riskTolerance: 25 } },
    ],
  },
  shock: {
    title: 'La mauvaise nouvelle',
    tests: 'newsSensitivity',
    headline: '« Dernière heure : une annonce inattendue fait décrocher le titre à l’ouverture. »',
    situation: (s) => `Vous détenez ${STAKE.toLocaleString('fr-CA')} $ de ce titre. Il vient de chuter de ${(-s.stats.ret1d * 100).toFixed(1)} % en une seule séance.`,
    choices: [
      { id: 'sell_all', label: 'Je vends tout, tout de suite', exposure: 0, signals: { newsSensitivity: 90, lossAversion: 75 } },
      { id: 'sell_half', label: 'Je réduis de moitié', exposure: 0.5, signals: { newsSensitivity: 65 } },
      { id: 'hold', label: 'J’attends d’y voir clair', exposure: 1, signals: { newsSensitivity: 30 } },
      { id: 'buy_more', label: 'J’en profite pour acheter (+50 %)', exposure: 1.5, signals: { newsSensitivity: 20 } },
    ],
  },
  flat: {
    title: 'L’impatience',
    tests: 'impulsivity',
    headline: '« Pendant que le marché grimpe, certains titres font du surplace. Faut-il changer de cheval ? »',
    situation: (s) => `Vous détenez ${STAKE.toLocaleString('fr-CA')} $ de ce titre. En 90 séances il a fait ${pct(s.stats.ret90d)}, pendant que le marché montait nettement.`,
    choices: [
      { id: 'switch_all', label: 'Je vends tout pour suivre le marché', exposure: 0, signals: { impulsivity: 85, fomo: 70 } },
      { id: 'switch_half', label: 'Je bascule la moitié vers le marché', exposure: 0.5, signals: { impulsivity: 60 } },
      { id: 'hold', label: 'Je garde mon plan', exposure: 1, signals: { impulsivity: 25 } },
    ],
  },
  winner: {
    title: 'Le gagnant',
    tests: 'concentration',
    headline: '« La vedette de l’année ne s’arrête plus de monter. »',
    situation: (s) => `Ce titre a pris ${pct(s.stats.ret90d)} en 90 séances. Votre position vaut ${STAKE.toLocaleString('fr-CA')} $ et pèse maintenant 60 % de votre portefeuille.`,
    choices: [
      { id: 'add', label: 'J’en rajoute (+30 %)', exposure: 1.3, signals: { concentration: 90, fomo: 70 } },
      { id: 'hold', label: 'Je laisse courir', exposure: 1, signals: { concentration: 70 } },
      { id: 'trim', label: 'Je réduis de moitié pour rééquilibrer', exposure: 0.5, signals: { concentration: 35 } },
      { id: 'sell_all', label: 'Je vends tout et j’encaisse', exposure: 0, signals: { concentration: 15 } },
    ],
  },
};

/** Gain ou perte en $ d'un choix, selon ce qui s'est RÉELLEMENT passé sur 60 séances. */
export function outcomeOf(s: Scenario, choice: Choice): number {
  let pnl = STAKE * choice.exposure * s.outcome.fwd60d;
  // « L'impatience » : la partie vendue est réinvestie dans le marché (SPY).
  if (s.type === 'flat') pnl += STAKE * (1 - choice.exposure) * s.outcome.marketFwd60d;
  return Math.round(pnl);
}
const abs = (n: number) => `${(Math.abs(n) * 100).toFixed(1)} %`;
/** Ce qui précédait la décision, selon le type de situation (faits tirés des prix, rien d'extérieur). */
const LEAD: Record<ScenarioType, (s: Scenario) => string> = {
  crash: (s) => `venait de perdre ${abs(s.stats.ret30d)} en 30 séances`,
  hype: (s) => `venait de prendre ${abs(s.stats.ret60d)} en 60 séances`,
  shock: (s) => `venait de chuter de ${abs(s.stats.ret1d)} en une séance`,
  flat: (s) => `avait fait ${pct(s.stats.ret90d)} en 90 séances pendant que le marché montait`,
  winner: (s) => `avait pris ${abs(s.stats.ret90d)} en 90 séances`,
};
/**
 * Une phrase pour la révélation : ce qui précédait la décision et ce qui s'est passé ensuite.
 * Construite uniquement à partir des prix du jeu de données : aucune nouvelle, aucun appel externe.
 */
export function eventSentence(s: Scenario): string {
  const o = s.outcome;
  // SPY est lui-même le marché américain : inutile de le comparer à lui-même.
  const versus = s.reveal.ticker === 'SPY' ? '' : `, contre ${pct(o.marketFwd60d)} pour le marché américain`;
  return `Avant votre décision, le titre ${LEAD[s.type](s)}. Dans les 60 séances suivantes, il a fait ${pct(o.fwd60d)} `
    + `(pire creux en chemin : ${pct(o.maxDrawdown)})${versus}.`;
}
