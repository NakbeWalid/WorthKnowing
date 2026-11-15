// Tests du tirage des mises en situation (10 par évaluation : 2 par type de comportement), sans AWS ni serveur.
// Usage : npm run build && node scripts/test-simulations.mjs   (inclus dans npm run test:unit)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { EvaluationService, aliasOf } = require('../dist/miroir/evaluation/evaluation.service.js');
const { JsonStore } = require('../dist/miroir/storage/store.js');
const { config } = require('../dist/miroir/config.js');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘ ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`);
};

const svc = new EvaluationService(new JsonStore(), { emit() {} });
await svc.onModuleInit();
const library = svc.library;
const TYPES = ['crash', 'hype', 'shock', 'flat', 'winner'];
const expected = TYPES.length * config.scenariosPerType;

console.log('\n# Tirage des situations');
check(config.scenariosPerType === 2 && expected === 10, 'configuration : 2 situations par type, 10 au total');

/** Invariants à vérifier sur un tirage. Retourne la liste des violations. */
function violations(picked) {
  const v = [];
  if (picked.length !== expected) v.push(`${picked.length} situations au lieu de ${expected}`);
  if (picked.some((s) => !s)) return [...v, 'situation manquante'];
  if (new Set(picked.map((s) => s.id)).size !== picked.length) v.push('même situation tirée deux fois');
  if (new Set(picked.map((s) => s.reveal.ticker)).size !== picked.length) v.push('même actif tiré deux fois');
  for (const t of TYPES) if (picked.filter((s) => s.type === t).length !== config.scenariosPerType) v.push(`type ${t} : pas ${config.scenariosPerType} situations`);
  for (let i = 1; i < picked.length; i++) if (picked[i].type === picked[i - 1].type) v.push(`deux situations « ${picked[i].type} » de suite (positions ${i}, ${i + 1})`);
  return v;
}

const N = 2000;
let bad = 0, firstBad = null;
for (let i = 0; i < N; i++) {
  const v = violations(svc.pickScenarios([]));
  if (v.length) { bad++; firstBad ??= v; }
}
check(bad === 0, `${N} tirages aléatoires : 10 situations, 2 par type, actifs tous différents, jamais le même type à la suite`, bad ? `${bad} tirages fautifs, ex. ${firstBad.join(' ; ')}` : '');

// Une personne qui a déjà vu beaucoup de situations : on privilégie les nouvelles, sans jamais en manquer ni les répéter.
const seenMost = library.filter((_, i) => i % 3 !== 0).map((s) => s.id);
bad = 0; firstBad = null;
for (let i = 0; i < N; i++) {
  const v = violations(svc.pickScenarios(seenMost));
  if (v.length) { bad++; firstBad ??= v; }
}
check(bad === 0, `${N} tirages avec 2/3 de la bibliothèque déjà vue : mêmes garanties`, bad ? firstBad.join(' ; ') : '');

// Tout a déjà été vu (cas limite) : on réutilise des situations plutôt que d'échouer.
bad = 0;
for (let i = 0; i < 300; i++) if (violations(svc.pickScenarios(library.map((s) => s.id))).length) bad++;
check(bad === 0, 'bibliothèque entièrement vue : le tirage réussit quand même (situations réutilisées, jamais en double)');

// Priorité aux situations jamais vues. Elle cède devant la règle « actifs tous différents » : quand un type n'a plus que quelques
// situations nouvelles et que leurs actifs sont déjà pris par d'autres types, réutiliser une situation vue vaut mieux que
// montrer deux fois le même actif (ce qui révélerait l'épisode). Il n'existe alors aucune solution sans réutilisation.
let reused = 0;
const RUNS = 1000;
for (let i = 0; i < RUNS; i++) reused += svc.pickScenarios(seenMost).filter((s) => seenMost.includes(s.id)).length;
check(reused / RUNS < 0.1, `2/3 de la bibliothèque déjà vue : moins de 0,1 situation déjà vue en moyenne par tirage de 10`, `${(reused / RUNS).toFixed(3)} en moyenne`);
const seenFew = library.filter((_, i) => i % 6 === 0).map((s) => s.id); // un peu plus d'1/6 vu : il reste largement de quoi choisir
reused = 0;
for (let i = 0; i < RUNS; i++) reused += svc.pickScenarios(seenFew).filter((s) => seenFew.includes(s.id)).length;
check(reused === 0, `1/6 de la bibliothèque déjà vue : aucune situation déjà vue sur ${RUNS} tirages`, reused ? `${reused} réutilisations` : '');

console.log('\n# Alias des situations');
const aliases = Array.from({ length: expected }, (_, i) => aliasOf(i));
check(aliases[0] === 'Titre A' && aliases[9] === 'Titre J', 'alias de « Titre A » à « Titre J »', aliases.join(', '));
check(new Set(aliases).size === expected && aliases.every((a) => !a.includes('undefined')), 'alias tous différents, aucun « undefined » (l’ancienne liste n’avait que 8 lettres)');

console.log('\n# Évaluation complète à 10 situations');
const user = { id: 'u-test', rules: [], seenScenarios: [], preferences: {} };
let saved;
svc.store.saveEvaluation = async (e) => { saved = e; };
svc.store.saveUser = async () => {};
const questions = svc.questions();
const answers = Object.fromEntries(questions.map((q) => [q.id, q.kind === 'self' ? 2 : q.options[0].id]));
const session = await svc.start(user, answers);
check(session.scenarios.length === 10, 'start : 10 situations envoyées au navigateur', `${session.scenarios.length}`);
check(session.scenarios.map((s) => s.alias).join() === aliases.join(), 'start : alias « Titre A » à « Titre J » dans l’ordre');
check(session.scenarios.every((s) => s.choices.map((c) => c.label).join('|') === 'Vendre|Garder|Acheter'), 'start : chaque situation propose Vendre | Garder | Acheter');
check(!JSON.stringify(session).includes('reveal'), 'start : aucun indice sur l’actif réel');
svc.store.getEvaluation = async () => saved;
for (const s of session.scenarios) await svc.decide(user, saved.id, { scenarioId: s.id, choiceId: 'keep', decisionTimeMs: 8000 });
const half = { ...saved, decisions: saved.decisions.slice(0, 9), result: null };
svc.store.getEvaluation = async () => half;
let refused = false;
try { await svc.complete(user, half.id); } catch (e) { refused = e.status === 400; }
check(refused, 'complete : refusé tant que les 10 situations ne sont pas toutes répondues (9 sur 10)');
svc.store.getEvaluation = async () => saved;
const result = await svc.complete(user, saved.id);
check(result.reveals.length === 10 && result.reveals.map((r) => r.alias).join() === aliases.join(), 'complete : 10 situations révélées, mêmes alias');
check(result.reveals.every((r) => r.options.length === 3), 'complete : 3 options chiffrées par situation');

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTous les tests du tirage passent.');
process.exit(failures ? 1 : 0);
