/** Modèle de domaine partagé par tous les modules. */

/** Les 6 paramètres du profil comportemental, chacun noté de 0 à 100. */
export const PARAMS = [
  'riskTolerance', 'lossAversion', 'fomo', 'concentration', 'impulsivity', 'newsSensitivity',
] as const;
export type ParamKey = (typeof PARAMS)[number];
export type ParamScores = Record<ParamKey, number>;

export const PARAM_INFO: Record<ParamKey, { label: string; high: string }> = {
  riskTolerance: { label: 'Appétit pour le risque', high: 'accepte une forte volatilité' },
  lossAversion: { label: 'Réaction aux pertes', high: 'vend dans la panique quand ça baisse' },
  fomo: { label: 'Attrait pour le « hype »', high: 'achète ce qui vient de beaucoup monter' },
  concentration: { label: 'Concentration', high: 'laisse une position dominer le portefeuille' },
  impulsivity: { label: 'Impulsivité', high: 'décide vite et change souvent de cap' },
  newsSensitivity: { label: 'Sensibilité aux nouvelles', high: 'réagit à chaud aux manchettes' },
};

/** Règle que l'utilisateur se définit lui-même pour encadrer un paramètre fragile. */
export interface Rule {
  id: string;
  param: ParamKey;
  /** Texte libre ; « {seuil} » est remplacé par la valeur du seuil à l'affichage. */
  text: string;
  threshold: number;
  createdAt: string;
}

export interface Profile {
  /** Comment l'utilisateur se voit (questionnaire). */
  declared: ParamScores;
  /** Comportement observé à la dernière évaluation : point de référence de la dérive. */
  baseline: ParamScores;
  /** Valeur courante, mise à jour après chaque trade enquêté. */
  current: ParamScores;
  evaluatedAt: string;
  evaluationCount: number;
}

export interface Drift {
  score: number;
  /** Nombre de règles outrepassées depuis la dernière évaluation. */
  overrides: number;
}

export type UserStatus = 'onboarding' | 'active' | 'reevaluation_required';

export interface Position { qty: number; invested: number }

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  passwordHash: string;
  createdAt: string;
  status: UserStatus;
  /** Réponses factuelles du questionnaire (âge, horizon, objectif, ESG, crypto…). */
  preferences: Record<string, string>;
  profile: Profile | null;
  rules: Rule[];
  drift: Drift;
  /** asOf = date de marché du dernier trade (sert à valoriser le portefeuille). */
  portfolio: { cash: number; positions: Record<string, Position>; asOf?: string };
  seenScenarios: string[];
}

export type ScenarioType = 'crash' | 'hype' | 'shock' | 'flat' | 'winner';

/** Scénario de la bibliothèque (généré par scripts/build_scenarios.py). */
export interface Scenario {
  id: string;
  type: ScenarioType;
  maskLabel: string;
  context: number[];
  forward: number[];
  stats: { ret1d: number; ret30d: number; ret60d: number; ret90d: number };
  outcome: { fwd20d: number; fwd60d: number; maxDrawdown: number; marketFwd60d: number };
  reveal: { ticker: string; name: string; sector: string; decisionDate: string; startDate: string; endDate: string };
}

export interface Decision { scenarioId: string; choiceId: string; decisionTimeMs: number }

export interface Evaluation {
  id: string;
  userId: string;
  kind: 'initial' | 'reevaluation';
  scenarioIds: string[];
  decisions: Decision[];
  declared: ParamScores;
  result: unknown | null;
  createdAt: string;
  completedAt: string | null;
}

export interface NewsItem {
  date: string;
  /** Manchette telle que publiée (vraie nouvelle) ou description du signal (simulé). */
  title: string;
  /** Éditeur (domaine) pour une vraie nouvelle. */
  source: string;
  impact: 'faible' | 'moyen' | 'élevé';
  /** true = signal dérivé des prix, pas une vraie dépêche. Toujours affiché comme tel. */
  simulated: boolean;
  /** Vraie nouvelle : lien vers l'article et date de récupération (traçabilité). */
  url?: string;
  retrievedAt?: string;
  /** Reformulation en français par le modèle (étiquetée « IA ») — n'ajoute aucune information. */
  summary?: string;
}

/** Contexte de marché calculé à la date du trade (faits issus de prices_daily.csv). */
export interface MarketContext {
  ticker: string;
  name: string;
  assetClass: string;
  sector: string;
  date: string;
  price: number;
  currency: string;
  ret1d: number;
  ret5d: number;
  ret30d: number;
  ret90d: number;
  /** Volatilité annualisée sur 30 séances. */
  vol30d: number;
  /** Écart par rapport au plus haut des 90 dernières séances (≤ 0). */
  drawdown90d: number;
  speculative: boolean;
}

/** Un constat de l'enquête : quel paramètre est mis en jeu, et sur quelle preuve. */
export interface Finding {
  param: ParamKey;
  /** Signal 0–100 qui tire le paramètre courant vers lui. */
  signal: number;
  evidence: string;
  /** rules = seuil fixe vérifiable (socle) ; bedrock = constat de l'agent d'influence, borné. */
  origin?: 'rules' | 'bedrock';
}

/** Réponse de l'agent d'influence : changement de comportement ou influence externe ? */
export interface InfluenceVerdict {
  verdict: 'influence_externe' | 'changement_de_comportement' | 'les_deux' | 'conforme' | 'indetermine';
  rationale: string;
  /** Références vérifiées vers les données d'entrée (N1 = nouvelle 1, F2 = fait 2). */
  refs: string[];
  model: string;
}

export interface TriggeredRule { ruleId: string; param: ParamKey; text: string; reason: string }

export interface Investigation {
  context: MarketContext;
  news: NewsItem[];
  findings: Finding[];
  /** Absent si l'agent d'influence n'est pas activé ou n'a pas répondu. */
  influence?: InfluenceVerdict | null;
  /** Tensions entre la demande et le profil déclaré (informatif, sans blocage). */
  warnings: string[];
  triggeredRules: TriggeredRule[];
  paramUpdates: { param: ParamKey; before: number; after: number }[];
  driftBefore: number;
  driftAfter: number;
  explanation: { summary: string; steps: { agent: string; result: string }[]; sources: string[]; hypotheses: string[]; limits: string[] };
}

export interface Trade {
  id: string;
  userId: string;
  ticker: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  qty: number;
  /** Date de marché simulée (les données s'arrêtent au 2026-11-12). */
  marketDate: string;
  /** Heure réelle de la requête. */
  createdAt: string;
  /** Temps passé avant de confirmer la décision. */
  decisionTimeMs: number;
  note: string;
  overrodeRules: boolean;
  investigation: Investigation;
}

export const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));
export const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)} %`;
