import { ParamKey } from '../domain/types';

export interface Question {
  id: string;
  text: string;
  /** info = fait sur l'investisseur ; self = comment il se voit (alimente le profil déclaré). */
  kind: 'info' | 'self';
  param?: ParamKey;
  options: { id: string; label: string; score?: number }[];
}

const self = (id: ParamKey, text: string, labels: string[]): Question => ({
  id, text, kind: 'self', param: id,
  options: labels.map((label, i) => ({ id: String(i), label, score: [15, 40, 65, 90][i] })),
});

/** Étape 1 de l'évaluation : « comment vous voyez-vous ? » */
export const QUESTIONS: Question[] = [
  { id: 'age', kind: 'info', text: 'Quel âge avez-vous ?',
    options: [{ id: '18-29', label: '18 – 29 ans' }, { id: '30-44', label: '30 – 44 ans' }, { id: '45-59', label: '45 – 59 ans' }, { id: '60+', label: '60 ans et plus' }] },
  { id: 'horizon', kind: 'info', text: 'Dans combien de temps aurez-vous besoin de cet argent ?',
    options: [{ id: '<3', label: 'Moins de 3 ans' }, { id: '3-5', label: '3 à 5 ans' }, { id: '8-12', label: '8 à 12 ans' }, { id: '15+', label: '15 ans ou plus' }] },
  { id: 'objective', kind: 'info', text: 'Quel est votre objectif principal ?',
    options: [{ id: 'preserve', label: 'Préserver mon capital' }, { id: 'balanced', label: 'Croissance équilibrée' }, { id: 'growth', label: 'Croissance maximale à long terme' }] },
  { id: 'experience', kind: 'info', text: 'Votre expérience en investissement ?',
    options: [{ id: 'beginner', label: 'Débutant' }, { id: 'intermediate', label: 'Intermédiaire' }, { id: 'advanced', label: 'Avancé' }] },
  { id: 'esg', kind: 'info', text: 'Quelle importance accordez-vous aux critères ESG ?',
    options: [{ id: 'low', label: 'Peu d’importance' }, { id: 'medium', label: 'Un critère parmi d’autres' }, { id: 'high', label: 'Très important — j’évite les controverses' }] },
  { id: 'crypto', kind: 'info', text: 'Les cryptoactifs vous intéressent-ils ?',
    options: [{ id: 'no', label: 'Non' }, { id: 'curious', label: 'Curieux, à petite dose' }, { id: 'yes', label: 'Oui, clairement' }] },
  { id: 'follows', kind: 'info', text: 'À quelle fréquence suivez-vous les marchés ?',
    options: [{ id: 'rarely', label: 'Rarement' }, { id: 'weekly', label: 'Chaque semaine' }, { id: 'daily', label: 'Tous les jours' }] },

  self('riskTolerance', 'Face au risque, vous vous décririez comme…',
    ['Très prudent', 'Plutôt prudent', 'Plutôt audacieux', 'Très audacieux']),
  self('lossAversion', 'Votre portefeuille perd 25 % en un mois. Vous pensez que vous…',
    ['Achèteriez davantage', 'Ne toucheriez à rien', 'Vendriez une partie', 'Vendriez tout pour arrêter les pertes']),
  self('fomo', 'Un titre dont tout le monde parle a doublé en trois mois. Vous…',
    ['L’ignorez', 'Le surveillez sans acheter', 'Achetez un peu pour ne pas manquer le train', 'Achetez beaucoup, ça va continuer']),
  self('concentration', 'Quelle part de votre portefeuille mettriez-vous sur votre meilleure idée ?',
    ['Moins de 10 %', '10 à 25 %', '25 à 50 %', 'Plus de 50 %']),
  self('impulsivity', 'Avant de passer un ordre, vous prenez généralement…',
    ['Plusieurs jours de réflexion', 'Quelques heures', 'Quelques minutes', 'Quelques secondes']),
  self('newsSensitivity', 'Une mauvaise nouvelle tombe sur un titre que vous détenez. Vous…',
    ['Ne changez rien à votre plan', 'Attendez quelques jours pour y voir clair', 'Ajustez votre position le jour même', 'Agissez dans l’heure']),
];
