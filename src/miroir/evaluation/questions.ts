import { ParamKey } from '../domain/types';

export interface Question {
  id: string;
  text: string;
  /**
   * self = l'utilisateur se note lui-même de 0 à 10 sur un paramètre du profil (curseur) : c'est le profil déclaré ;
   * info = un fait sur l'investisseur (choix dans une liste).
   */
  kind: 'self' | 'info';
  param?: ParamKey;
  /** kind « self » : ce que veulent dire les deux bouts du curseur. */
  scale?: { min: number; max: number; low: string; high: string };
  /** kind « info » : les réponses possibles. */
  options: { id: string; label: string }[];
}

/** Bornes de l'auto-notation. La note devient un score de profil sur 100 (note × 10). */
export const SELF_MIN = 0;
export const SELF_MAX = 10;

const self = (id: ParamKey, text: string, low: string, high: string): Question => ({
  id, text, kind: 'self', param: id, scale: { min: SELF_MIN, max: SELF_MAX, low, high }, options: [],
});

/**
 * Étape 1 de l'évaluation, dans l'ordre où elle est présentée :
 *   1. l'utilisateur se note de 0 à 10 sur les 6 paramètres du profil (un seul écran) ;
 *   2. quelques questions factuelles, celles qui servent ensuite aux avertissements de cohérence ;
 * puis viennent les mises en situation.
 */
export const QUESTIONS: Question[] = [
  self('riskTolerance', 'Votre appétit pour le risque', 'Très prudent', 'Très audacieux'),
  self('lossAversion', 'Quand vos placements baissent fortement', 'Je garde mon calme', 'Je vends pour arrêter les pertes'),
  self('fomo', 'Quand un titre dont tout le monde parle s’envole', 'Je l’ignore', 'J’achète pour ne pas manquer le train'),
  self('concentration', 'La place que peut prendre votre meilleure idée', 'Je répartis toujours', 'Je mise gros sur une seule position'),
  self('impulsivity', 'Votre vitesse de décision avant un ordre', 'Je réfléchis plusieurs jours', 'Je décide en quelques secondes'),
  self('newsSensitivity', 'Quand une nouvelle tombe sur un titre que vous détenez', 'Je ne change rien à mon plan', 'J’agis dans l’heure'),

  { id: 'horizon', kind: 'info', text: 'Dans combien de temps aurez-vous besoin de cet argent ?',
    options: [{ id: '<3', label: 'Moins de 3 ans' }, { id: '3-5', label: '3 à 5 ans' }, { id: '8-12', label: '8 à 12 ans' }, { id: '15+', label: '15 ans ou plus' }] },
  { id: 'objective', kind: 'info', text: 'Quel est votre objectif principal ?',
    options: [{ id: 'preserve', label: 'Préserver mon capital' }, { id: 'balanced', label: 'Croissance équilibrée' }, { id: 'growth', label: 'Croissance maximale à long terme' }] },
  { id: 'esg', kind: 'info', text: 'Quelle importance accordez-vous aux critères ESG ?',
    options: [{ id: 'low', label: 'Peu d’importance' }, { id: 'medium', label: 'Un critère parmi d’autres' }, { id: 'high', label: 'Très important — j’évite les controverses' }] },
  { id: 'crypto', kind: 'info', text: 'Les cryptoactifs vous intéressent-ils ?',
    options: [{ id: 'no', label: 'Non' }, { id: 'curious', label: 'Curieux, à petite dose' }, { id: 'yes', label: 'Oui, clairement' }] },
];
