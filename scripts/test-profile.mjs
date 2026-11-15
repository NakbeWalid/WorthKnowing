// Tests du profil et des règles (sans serveur ni AWS) : notes de 0 à 10, règles textuelles (ajouter, modifier, retirer), CV protégé par la session, CV sans effet sur le profil de référence
// (seule l'expertise, utilisée plus tard par l'enquête sur les trades, en est tirée),
// règles sans effet sur la dérive. Usage : npm run build && node scripts/test-profile.mjs
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { JsonStore } = require('../dist/miroir/storage/store.js');
const { EventsService } = require('../dist/miroir/realtime/events.service.js');
const { LocalAuthService, newUser } = require('../dist/miroir/auth/auth.service.js');
const { AuthGuard } = require('../dist/miroir/auth/auth.guard.js');
const { ParserController } = require('../dist/miroir/parser/parser.controller.js');
const { CvParserService } = require('../dist/miroir/parser/cv-parser.service.js');
const { EvaluationService } = require('../dist/miroir/evaluation/evaluation.service.js');
const { RulesService } = require('../dist/miroir/rules/rules.service.js');
const { QUESTIONS } = require('../dist/miroir/evaluation/questions.js');
const { buildFacts } = require('../dist/miroir/trades/agents/influence.agent.js');

let total = 0;
const ok = (cond, msg) => {
  total++;
  if (!cond) { console.error(`✘ ${msg}`); process.exit(1); }
  console.log(`✔ ${msg}`);
};

const store = new JsonStore();
const events = new EventsService();
const auth = new LocalAuthService(store, events);
const evaluation = new EvaluationService(store, events);
await evaluation.onModuleInit();
const stamp = Date.now();

// --- 1. L'analyse de CV exige une session valide (même garde que le reste de l'API) ----------------
const guards = Reflect.getMetadata('__guards__', ParserController) ?? [];
ok(guards.includes(AuthGuard), 'ParserController est protégé par AuthGuard');
const guard = new AuthGuard(auth, store);
const ctx = (headers) => ({ switchToHttp: () => ({ getRequest: () => ({ headers, query: {} }) }) });
const rejects = async (headers) => guard.canActivate(ctx(headers)).then(() => false, (e) => e.getStatus?.() === 401);
ok(await rejects({}), 'sans jeton : 401');
ok(await rejects({ authorization: 'Bearer faux.jeton' }), 'jeton invalide : 401');

// --- 2. Le CV n'entre JAMAIS dans le profil de référence : mêmes réponses -> même profil, avec ou sans CV --
// Les deux utilisateurs répondent EXACTEMENT pareil au questionnaire et aux simulations.
const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.kind === 'self' ? 4 : q.options[1].id]));
async function evaluate(user) {
  await store.saveUser(user);
  const session = await evaluation.start(user, { ...answers });
  for (const s of session.scenarios) {
    await evaluation.decide(user, session.evaluationId, { scenarioId: s.id, choiceId: s.choices[0].id, decisionTimeMs: 8000 });
  }
  await evaluation.complete(user, session.evaluationId);
  await evaluation.finalize(user, session.evaluationId, []);
  return user.profile;
}
const withoutCv = await evaluate(newUser(`sans-cv-${stamp}`, `sans-cv-${stamp}@t.local`, 'Sans CV', 'user'));

const withCvUser = newUser(`avec-cv-${stamp}`, `avec-cv-${stamp}@t.local`, 'Avec CV', 'user');
const cvText = 'Senior quantitative trader, 9 years of experience in derivatives, crypto and Bitcoin trading, high-frequency strategies.';
const cvResult = await new ParserController(new CvParserService(), store).analyse({ user: withCvUser }, { text: cvText, filename: 'cv.txt' });
const withCv = await evaluate(withCvUser);

ok(JSON.stringify(withCv.declared) === JSON.stringify(withoutCv.declared), 'profil déclaré identique (le CV ne touche pas aux réponses)');
ok(JSON.stringify(withCv.baseline) === JSON.stringify(withoutCv.baseline), 'profil de référence identique avec ou sans CV (le CV n’y entre jamais)');
ok(!withCv.sources && !withoutCv.sources, 'le profil ne porte plus de mélange de sources (CV / observé) : il est uniquement observé');
ok(cvResult.expertise === 'advanced', `expertise détectée au CV, conservée à part (${cvResult.expertise})`);
ok(withCvUser.cvProfile.expertise === 'advanced' && !('inferredScores' in withCvUser.cvProfile),
  'seule l’expertise est conservée sur le CV, aucun score de personnalité');

// --- 2b. L'expertise CV influence bien l'enquête (InfluenceAgent), jamais le profil -------------------
const fakeMetrics = {
  side: 'buy',
  context: { name: 'Actif test', ticker: 'TST', date: '2026-01-01', ret1d: 0.01, ret5d: 0.02, ret30d: 0.03, vol30d: 0.2, drawdown90d: -0.1, speculative: false },
  positionWeight: 0.2, speculativeWeight: 0, decisionSeconds: 8,
};
const factsInput = { metrics: fakeMetrics, amount: 1000, note: '', news: [], recentTrades: [], profile: withCv, deterministic: [] };
const factsWithExpertise = buildFacts({ ...factsInput, expertise: 'advanced' }).join(' ');
const factsWithoutExpertise = buildFacts({ ...factsInput, expertise: null }).join(' ');
ok(factsWithExpertise.includes('Expertise en trading déclarée au CV') && factsWithExpertise.includes('avancée'),
  'l’enquête (InfluenceAgent) reçoit bien l’expertise CV comme fait numéroté');
ok(!factsWithoutExpertise.includes('Expertise en trading déclarée au CV'),
  'sans CV, aucun fait d’expertise n’est ajouté à l’enquête');

// --- 3. Modifier ses règles ne remet pas la dérive à zéro ----------------------------------------------
const rules = new RulesService(store, events);
const blocked = newUser(`bloque-${stamp}`, `bloque-${stamp}@t.local`, 'Bloqué', 'user');
Object.assign(blocked, { profile: { ...withoutCv }, drift: { score: 72, overrides: 3 }, status: 'reevaluation_required' });
await store.saveUser(blocked);
await rules.saveRules(blocked, [{ param: 'fomo', text: 'Pas d’achat d’un titre qui vient de s’envoler.' }]);
const reloaded = await store.getUser(blocked.id);
ok(reloaded.status === 'reevaluation_required', 'statut reevaluation_required conservé après édition des règles');
ok(reloaded.drift.score === 72 && reloaded.drift.overrides === 3, 'score de dérive et règles outrepassées inchangés');
ok(reloaded.rules.length === 1 && reloaded.rules[0].text === 'Pas d’achat d’un titre qui vient de s’envoler.' && !('threshold' in reloaded.rules[0]), 'la nouvelle règle est enregistrée : un texte, aucun seuil');
await evaluate(reloaded);
ok(reloaded.status === 'active' && reloaded.drift.score === 0 && reloaded.drift.overrides === 0, 'seule une réévaluation complète remet la dérive à 0');

// --- 4. Profil déclaré : six notes de 0 à 10 ---------------------------------------------------------
ok(QUESTIONS.filter((q) => q.kind === 'self').length === 6 && QUESTIONS.filter((q) => q.kind === 'info').length <= 5,
  `étape 1 : 6 curseurs et ${QUESTIONS.filter((q) => q.kind === 'info').length} questions`);
ok(Object.values(withoutCv.declared).every((v) => v === 40), 'une note de 4 sur 10 donne un score déclaré de 40 sur 100');
const refuses = async (patch) => evaluation.start(newUser(`n-${Math.random()}`, 'n@t.local', 'N', 'user'), { ...answers, ...patch })
  .then(() => false, (e) => e.getStatus?.() === 400);
ok(await refuses({ fomo: 11 }) && await refuses({ fomo: -1 }) && await refuses({ fomo: 4.5 }) && await refuses({ fomo: '' }) && await refuses({ fomo: undefined }),
  'note hors de 0–10, décimale ou absente : refusée (400)');
ok(await refuses({ horizon: 'jamais' }), 'réponse inconnue à une question : refusée (400)');
const extremes = newUser(`ext-${stamp}`, `ext-${stamp}@t.local`, 'Extrêmes', 'user');
await store.saveUser(extremes);
const ext = await store.getEvaluation((await evaluation.start(extremes, { ...answers, fomo: 0, impulsivity: '10' })).evaluationId);
ok(ext.declared.fomo === 0 && ext.declared.impulsivity === 100, 'les notes 0 et 10 sont acceptées (0 et 100 sur 100)');

// --- 5. Règles textuelles : ajouter, modifier, retirer ------------------------------------------------
const { GovernanceAgent } = require('../dist/miroir/trades/agents/governance.agent.js');
const { MAX_RULES } = require('../dist/miroir/rules/rules.service.js');
const writer = newUser(`regles-${stamp}`, `regles-${stamp}@t.local`, 'Règles', 'user');
Object.assign(writer, { profile: { ...withoutCv }, drift: { score: 12, overrides: 1 }, status: 'active' });
await store.saveUser(writer);
const added = await rules.addRule(writer, { param: 'impulsivity', text: '  Je dors dessus avant d’acheter.  ' });
ok(added.rule.text === 'Je dors dessus avant d’acheter.' && added.rule.trigger && !('threshold' in writer.rules[0]), 'ajout : texte libre, sans seuil, avec le cas de rappel en clair');
await rules.addRule(writer, { param: 'impulsivity', text: 'Jamais d’ordre dans le métro.' });
ok(writer.rules.length === 2, 'plusieurs règles possibles sur un même comportement');
const edited = await rules.updateRule(writer, added.rule.id, { text: 'Je dors dessus avant tout ordre.' });
ok(edited.rule.id === added.rule.id && writer.rules[0].text === 'Je dors dessus avant tout ordre.' && writer.rules[0].param === 'impulsivity',
  'modification : le texte change, l’identifiant et le comportement restent');
await rules.updateRule(writer, added.rule.id, { param: 'fomo' });
ok(writer.rules[0].param === 'fomo' && writer.rules[0].text === 'Je dors dessus avant tout ordre.', 'on peut rattacher la règle à un autre comportement');
const bad = async (fn) => fn().then(() => false, (e) => [400, 404].includes(e.getStatus?.()));
ok(await bad(() => rules.addRule(writer, { param: 'fomo', text: '   ' })) && await bad(() => rules.addRule(writer, { param: 'inconnu', text: 'x' }))
  && await bad(() => rules.addRule(writer, { param: 'fomo', text: 'x'.repeat(301) })), 'texte vide, trop long ou comportement inconnu : refusé');
ok(await bad(() => rules.updateRule(writer, 'absent', { text: 'x' })) && await bad(() => rules.removeRule(writer, 'absent')), 'règle introuvable : 404');
await rules.removeRule(writer, added.rule.id);
ok(writer.rules.length === 1 && writer.rules[0].text === 'Jamais d’ordre dans le métro.', 'retrait : seule la règle visée disparaît');
ok(writer.drift.score === 12 && writer.drift.overrides === 1 && writer.status === 'active', 'ajouter, modifier, retirer : dérive et statut inchangés');
const persisted = await store.getUser(writer.id);
ok(persisted.rules.length === 1, 'les règles sont bien enregistrées');
for (let i = writer.rules.length; i < MAX_RULES; i++) await rules.addRule(writer, { param: 'fomo', text: `Règle ${i}` });
ok(await bad(() => rules.addRule(writer, { param: 'fomo', text: 'de trop' })), `au-delà de ${MAX_RULES} règles : refusé`);

// Rappel : une règle textuelle est rappelée quand son comportement est mis en jeu ; une ancienne règle chiffrée garde son seuil.
const governance = new GovernanceAgent();
const metricsAt = (decisionSeconds) => ({ side: 'buy', context: { ...fakeMetrics.context }, positionWeight: 0.1, speculativeWeight: 0, decisionSeconds });
const g = { rules: [
  { id: 'a', param: 'impulsivity', text: 'Je prends mon temps.', createdAt: '' },
  { id: 'b', param: 'impulsivity', text: 'Au moins {seuil} secondes de réflexion.', threshold: 30, createdAt: '' },
] };
const fast = governance.triggeredRules(g, metricsAt(3));
ok(fast.length === 2 && fast[0].text === 'Je prends mon temps.' && fast[1].text === 'Au moins 30 secondes de réflexion.', 'ordre en 3 s : les deux règles sont rappelées, texte affiché tel quel');
const mid = governance.triggeredRules(g, metricsAt(20));
ok(mid.length === 1 && mid[0].ruleId === 'b', 'ordre en 20 s : seule l’ancienne règle chiffrée (30 s) est rappelée');
ok(governance.triggeredRules(g, metricsAt(45)).length === 0, 'ordre en 45 s : aucune règle rappelée');
const legacy = { ...writer, rules: [{ id: 'old', param: 'impulsivity', text: 'Au moins {seuil} secondes.', threshold: 30, createdAt: '' }] };
await rules.updateRule(legacy, 'old', { text: 'Je respire avant de confirmer.' });
ok(!('threshold' in legacy.rules[0]) && legacy.rules[0].text === 'Je respire avant de confirmer.', 'modifier une ancienne règle chiffrée la rend purement textuelle');

console.log(`\nTous les tests du profil passent (${total}/${total}).`);
