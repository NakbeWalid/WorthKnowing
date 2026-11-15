// Tests du profil (sans serveur ni AWS) : CV protégé par la session, CV sans effet sur le profil de référence
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
const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[1].id]));
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
await rules.saveRules(blocked, [{ param: 'fomo', text: 'Pas d’achat après +{seuil} % en 30 séances.', threshold: 15 }]);
const reloaded = await store.getUser(blocked.id);
ok(reloaded.status === 'reevaluation_required', 'statut reevaluation_required conservé après édition des règles');
ok(reloaded.drift.score === 72 && reloaded.drift.overrides === 3, 'score de dérive et règles outrepassées inchangés');
ok(reloaded.rules.length === 1 && reloaded.rules[0].threshold === 15, 'les nouvelles règles sont bien enregistrées');
await evaluate(reloaded);
ok(reloaded.status === 'active' && reloaded.drift.score === 0 && reloaded.drift.overrides === 0, 'seule une réévaluation complète remet la dérive à 0');

console.log(`\nTous les tests du profil passent (${total}/${total}).`);
