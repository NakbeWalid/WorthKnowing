/** Modèle de données de la plateforme de courtage. Aucun type de Miroir n'est importé ici. */

export interface Position { qty: number; invested: number }

/**
 * État du service Miroir pour ce compte :
 *   none     = offre jamais présentée (nouveau compte) ;
 *   declined = refusé ou délié : compte de courtage ordinaire, l'option reste dans les réglages ;
 *   pending  = le client est parti créer son profil chez Miroir, on attend son retour ;
 *   linked   = lié : `personaCode` identifie son profil dans chaque requête envoyée à Miroir.
 */
export type MiroirStatus = 'none' | 'declined' | 'pending' | 'linked';

export interface Account {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  cash: number;
  positions: Record<string, Position>;
  /** Date de marché simulée du dernier trade (sert à valoriser le portefeuille). */
  asOf?: string;
  miroir: {
    status: MiroirStatus;
    /** Jeton anti-falsification de la liaison en cours (vérifié au retour de Miroir). */
    state?: string;
    /** Code persona remis par Miroir. Secret : ne quitte jamais le serveur. */
    personaCode?: string;
    linkedAt?: string;
  };
}

/** Ce que Miroir a répondu pour un trade — la plateforme n'en garde qu'un résumé. */
export interface TradeMiroirResult {
  /**
   * not_linked = compte sans Miroir ; pending = ordre exécuté, enquête en cours en arrière-plan ;
   * analysed = enquête reçue ; unavailable = Miroir injoignable.
   */
  status: 'not_linked' | 'pending' | 'analysed' | 'unavailable';
  tradeId?: string;
  driftBefore?: number;
  driftAfter?: number;
  overrodeRules?: boolean;
  reevaluationRequired?: boolean;
  summary?: string;
}

export interface BankTrade {
  id: string;
  accountId: string;
  ticker: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  qty: number;
  currency: string;
  /** Date de marché simulée (les données vont du 2021-11-12 au 2026-11-12). */
  marketDate: string;
  /** Heure réelle de l'ordre. */
  createdAt: string;
  /** Temps passé sur le ticket d'ordre avant de confirmer. */
  decisionTimeMs: number;
  note: string;
  miroir: TradeMiroirResult;
}

export interface TradeInput {
  ticker: string;
  side: 'buy' | 'sell';
  amount: number;
  marketDate?: string;
  decisionTimeMs?: number;
  note?: string;
  /** Règles Miroir rappelées que le client a choisi d'outrepasser. */
  acknowledgedRuleIds?: string[];
}
