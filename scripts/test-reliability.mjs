// Tests de la fiabilité du profil et du niveau de confiance, sans AWS ni serveur.
// Usage : npm run build && node scripts/test-reliability.mjs   (inclus dans npm run test:unit)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { reliabilityOf, overallReliability } = require('../dist/miroir/evaluation/reliability.js');
const { EvaluationService } = require('../dist/miroir/evaluation/evaluation.service.js');
const { JsonStore } = require('../dist/miroir/storage/store.js');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘ ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`);
};
const ans = (value, confidence) => ({ value, confidence, source: 'answer' });

console.log('\n# Fiabilité d\'un paramètre');
check(reliabilityOf([ans(70, 'high'), ans(70, 'high')]).level === 'high', '2 réponses identiques, confiance élevée : fiabilité élevée');
check(reliabilityOf([ans(70, 'high'), ans(90, 'high')]).level === 'high', '2 réponses à 20 points d’écart (cohérentes), confiance élevée : élevée');
check(reliabilityOf([ans(70, 'high')]).level === 'low', 'une seule mesure : faible, même avec une confiance élevée (rien pour la recouper)');
check(reliabilityOf([ans(15, 'high'), ans(90, 'high')]).level === 'low', 'réponses contradictoires (écart 75) : faible malgré la confiance');
check(reliabilityOf([ans(15, 'high'), ans(70, 'high')]).level === 'low', 'écart de 55 (> 50) : faible');
check(reliabilityOf([ans(35, 'high'), ans(70, 'high')]).level === 'medium', 'écart de 35 (entre 30 et 50) : moyenne');
check(reliabilityOf([ans(70, 'low'), ans(70, 'low')]).level === 'low', 'réponses cohérentes mais toutes hésitantes : faible');
check(reliabilityOf([ans(70, 'medium'), ans(70, 'medium')]).level === 'medium', 'cohérentes, confiance « plutôt sûr » : moyenne (pas assez pour « élevée »)');
check(reliabilityOf([ans(70, 'high'), ans(70, 'low')]).level === 'medium', 'une réponse sûre, une hésitante : moyenne');
check(reliabilityOf([ans(70), ans(70)]).level === 'medium', 'cohérentes mais confiance non indiquée (ancienne évaluation) : moyenne, jamais « élevée »');
const imp = reliabilityOf([ans(85, 'high'), ans(85, 'high'), { value: 85, source: 'time' }]);
check(imp.level === 'high' && imp.readings === 3, 'le temps de décision compte comme une mesure, sans confiance associée', `${imp.readings} mesures`);
check(reliabilityOf([]).level === 'low', 'aucune mesure : faible, sans erreur');
const r = reliabilityOf([ans(15, 'high'), ans(90, 'low')]);
check(r.spread === 75 && r.why.includes('réponses contradictoires'), 'les raisons sont lisibles et l’écart est donné', r.why.join(' · '));

console.log('\n# Lecture d\'ensemble');
const mk = (levels) => Object.fromEntries(['riskTolerance', 'lossAversion', 'fomo', 'concentration', 'impulsivity', 'newsSensitivity'].map((p, i) => [p, { level: levels[i] }]));
check(overallReliability(mk(['high', 'high', 'high', 'high', 'medium', 'medium'])).level === 'high', '4 solides sur 6, aucun fragile : élevée');
check(overallReliability(mk(['high', 'high', 'high', 'high', 'high', 'low'])).level === 'medium', '5 solides mais 1 fragile : moyenne');
check(overallReliability(mk(['low', 'low', 'low', 'high', 'high', 'high'])).level === 'low', '3 fragiles : faible');
const ov = overallReliability(mk(['high', 'high', 'medium', 'medium', 'low', 'low']));
check(ov.counts.high === 2 && ov.counts.low === 2 && /2 paramètres sur 6/.test(ov.summary), 'décompte et phrase de synthèse', ov.summary);

console.log('\n# Enregistrement de la confiance et calcul du profil');
const svc = new EvaluationService(new JsonStore(), { emit() {} });
await svc.onModuleInit();
const answers = Object.fromEntries(svc.questions().map((q) => [q.id, q.options[0].id]));
let saved;
svc.store.saveEvaluation = async (e) => { saved = e; };
svc.store.saveUser = async () => {};
svc.store.getEvaluation = async () => saved;
const user = { id: 'u1', rules: [], seenScenarios: [], preferences: {} };
const session = await svc.start(user, answers);
const first = session.scenarios[0];
let status = 0;
try { await svc.decide(user, saved.id, { scenarioId: first.id, choiceId: 'keep', decisionTimeMs: 5000, confidence: 'certain' }); } catch (e) { status = e.status; }
check(status === 400, 'niveau de confiance inconnu : refusé (400)');
await svc.decide(user, saved.id, { scenarioId: first.id, choiceId: 'keep', decisionTimeMs: 5000, confidence: 'low' });
check(saved.decisions.find((d) => d.scenarioId === first.id).confidence === 'low', 'la confiance est enregistrée avec la réponse');
await svc.decide(user, saved.id, { scenarioId: first.id, choiceId: 'buy', decisionTimeMs: 5000 });
check(saved.decisions.find((d) => d.scenarioId === first.id).confidence === undefined, 'renvoyer une réponse sans confiance remplace aussi la confiance (pas de reste de l’ancienne)');

// 10 réponses : 2 sûres et cohérentes pour la concentration, et on compare avec et sans confiance.
async function run(confidenceFor, choiceFor) {
  const u = { id: 'u', rules: [], seenScenarios: [], preferences: {} };
  const sess = await svc.start(u, answers);
  for (const s of sess.scenarios) await svc.decide(u, saved.id, { scenarioId: s.id, choiceId: choiceFor(s), decisionTimeMs: 8000, ...(confidenceFor ? { confidence: confidenceFor(s) } : {}) });
  return svc.complete(u, saved.id);
}
const withHigh = await run(() => 'high', () => 'keep');
const withLow = await run(() => 'low', () => 'keep');
const withNone = await run(null, () => 'keep');
check(JSON.stringify(withHigh.observed) === JSON.stringify(withLow.observed) && JSON.stringify(withHigh.observed) === JSON.stringify(withNone.observed),
  'la confiance ne change PAS le score du profil (mêmes réponses = mêmes scores, quelle que soit la confiance)');
check(withHigh.params.every((p) => p.reliability && p.reliability.readings >= 1), 'chaque paramètre du résultat porte sa fiabilité');
check(withHigh.reliability.counts.high + withHigh.reliability.counts.medium + withHigh.reliability.counts.low === 6, 'le résultat porte une lecture d’ensemble sur 6 paramètres', withHigh.reliability.summary);
const lvl = (res, p) => res.params.find((x) => x.param === p).reliability.level;
check(lvl(withHigh, 'concentration') === 'high' && lvl(withLow, 'concentration') === 'low', 'même réponses : confiance élevée → fiabilité élevée, hésitation → faible', `${lvl(withHigh, 'concentration')} / ${lvl(withLow, 'concentration')}`);
check(withNone.params.every((p) => p.reliability.level !== 'high'), 'sans confiance indiquée (ancienne évaluation) : aucun paramètre n’est jamais noté « élevée »');
check(withHigh.params.find((p) => p.param === 'concentration').reliability.readings === 2, 'la concentration repose bien sur 2 mesures (2 situations)');

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTous les tests de fiabilité passent.');
process.exit(failures ? 1 : 0);
