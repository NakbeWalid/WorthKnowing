// Test complet en mémoire de toutes les fonctionnalités implémentées
import { CvParserService } from '../dist/miroir/parser/cv-parser.service.js';
import { RulesService } from '../dist/miroir/rules/rules.service.js';
import { TradesService } from '../dist/miroir/trades/trades.service.js';
import { JsonStore } from '../dist/miroir/storage/store.js';
import { EventsService } from '../dist/miroir/realtime/events.service.js';
import { MarketService } from '../dist/shared/market.service.js';
import { MockNewsProvider } from '../dist/miroir/news/news.provider.js';
import { GovernanceAgent } from '../dist/miroir/trades/agents/governance.agent.js';
import { BehaviorAgent } from '../dist/miroir/trades/agents/behavior.agent.js';
import { TemplateExplainer } from '../dist/miroir/trades/agents/explainer.js';
import { NoInfluenceAgent } from '../dist/miroir/trades/agents/influence.agent.js';
import { newUser } from '../dist/miroir/auth/auth.service.js';
import { calculateDerivationImpact, GUARDRAIL_BREACH_PENALTY } from '../dist/miroir/trades/drift.js';
import { ParserController } from '../dist/miroir/parser/parser.controller.js';

let passed = 0;
let total = 0;
function assert(cond, msg) {
  total++;
  if (!cond) {
    console.error(`❌ ÉCHEC : ${msg}`);
    throw new Error(msg);
  }
  passed++;
  console.log(`✔ OK : ${msg}`);
}

console.log('\n--- 1. Test CV Parser Fully Working ---');
const cvParser = new CvParserService();
const sampleCvText = `
ALEXANDRE DUPONT
Senior Software Engineer & Quantitative Developer
Experience: 7 years of experience in FinTech, algorithmic trading, and Python backend systems.
Skills: Python, TypeScript, Docker, Kubernetes, AWS, DCF models, portfolio optimization, CFA Level 1.
Interest in ESG investing, renewable tech, and Bitcoin / blockchain architecture.
Education: M.Sc. Computer Science (2017 - 2019)
`;
const parsedCv = cvParser.parseCv(sampleCvText, 'cv_alexandre.txt');
assert(parsedCv.yearsOfExperience >= 7, 'Détection années expérience (>= 7)');
assert(parsedCv.seniority === 'senior', 'Détection niveau senior');
assert(parsedCv.industry === 'Finance & Investissement' || parsedCv.industry.includes('Finance'), 'Détection industrie Finance');
assert(parsedCv.financialLiteracy === 'advanced' || parsedCv.financialLiteracy === 'intermediate', 'Culture financière avancée/intermédiaire');
assert(parsedCv.cryptoAffinity === 'yes', 'Affinité crypto détectée');
assert(parsedCv.suggestedAnswers.age !== '', 'Suggestion tranche d’âge');
assert(parsedCv.inferredScores.riskTolerance > 50, 'Inférence prior riskTolerance > 50');

const testUser = newUser('user-test-1234', 'test@worthknowing.local', 'Test User', 'user');
console.log('\n--- 3. Test Derivation Factor Impact & Guardrail Penalty ---');
assert(GUARDRAIL_BREACH_PENALTY === 8, 'Pénalité de 8 points par garde-fou brisé');
const baseline = { riskTolerance: 50, lossAversion: 40, fomo: 30, concentration: 30, impulsivity: 20, newsSensitivity: 30 };
const current = { riskTolerance: 50, lossAversion: 40, fomo: 30, concentration: 30, impulsivity: 20, newsSensitivity: 30 };
const impact0 = calculateDerivationImpact(baseline, current, 0, 0, 60);
assert(impact0.addedDriftPoints === 0, '0 garde-fou brisé = 0 point ajouté');
assert(impact0.currentDriftScore === 0, 'Dérive courante 0');

const impact2 = calculateDerivationImpact(baseline, current, 0, 2, 60);
assert(impact2.guardrailsTriggered === 2, '2 garde-fous déclenchés');
assert(impact2.addedDriftPoints === 16, 'Pénalité ajoutée = 2 x 8 = 16 points');
assert(impact2.projectedDriftScore >= 16, 'Score projeté >= 16');

console.log('\n--- 4. Test Smart Rules & Editable Anytime ---');
const store = new JsonStore();
const events = new EventsService();
const market = new MarketService();
await market.onModuleInit();
const news = new MockNewsProvider();
const governance = new GovernanceAgent();
const behavior = new BehaviorAgent();
const explainer = new TemplateExplainer();
const influence = new NoInfluenceAgent();
const trades = new TradesService(store, market, news, governance, behavior, explainer, influence, events);
const rulesService = new RulesService(store, events, trades);

testUser.profile = {
  declared: baseline,
  baseline: { ...baseline },
  current: { ...current, fomo: 75, impulsivity: 65 }, // comportement avec dérive FOMO & impulsivité
  evaluatedAt: new Date().toISOString(),
  evaluationCount: 1,
};
await store.saveUser(testUser);

const smartRules = await rulesService.getSmartRules(testUser);
assert(smartRules.suggestions.length === 6, '6 critères avec suggestions intelligentes');
const fomoSug = smartRules.suggestions.find((s) => s.param === 'fomo');
assert(fomoSug.isAtRisk === true, 'FOMO détecté comme point fragile');
assert(fomoSug.suggestion.threshold <= 15, 'Seuil FOMO intelligent abaissé');

// Modification des règles n'importe quand
const updated = await rulesService.saveRules(testUser, [
  { param: 'fomo', text: 'Je n’achète pas d’actif en hausse de {seuil} %', threshold: 12 },
  { param: 'impulsivity', text: 'J’attends au moins {seuil} secondes', threshold: 15 },
]);
assert(updated.ok === true, 'Enregistrement des règles anytime réussi');
assert(testUser.rules.length === 2, '2 règles sauvegardées sur l’utilisateur');

console.log('\n--- 5. Modifier ses règles ne remet pas la dérive à zéro ---');
testUser.drift = { score: 65, overrides: 4 }; // dépassement du seuil (60)
testUser.status = 'reevaluation_required';
await store.saveUser(testUser);
await rulesService.saveRules(testUser, [{ param: 'fomo', text: 'Pas d’achat après +{seuil} %', threshold: 10 }]);
assert(testUser.drift.score === 65 && testUser.drift.overrides === 4, 'Dérive inchangée après édition des règles');
assert(testUser.status === 'reevaluation_required', 'Statut reevaluation_required conservé');
testUser.status = 'active';
console.log('\n--- 6. Test pré-contrôle : impact sur la dérive ---');
const checkRes = await trades.check(testUser, {
  ticker: 'NVDA',
  side: 'buy',
  amount: 25000,
  marketDate: '2023-05-30',
  portfolio: { cash: 100000, positions: [] },
  decisionTimeMs: 1000, // 1 seconde -> déclenche la règle d'impulsivité (seuil 15s)
});
assert(checkRes.triggeredRules.length > 0, 'Règle d’impulsivité déclenchée');
assert(checkRes.derivationImpact !== undefined, 'Impact facteur de dérive calculé');
assert(checkRes.derivationImpact.addedDriftPoints >= 8, 'Pénalité calculée (+8 points)');

console.log('\n--- 7. Test ParserController : CV conservé à part, expertise seule, sans réponses suggérées ---');
const parserCtrl = new ParserController(cvParser, store);
const largeCvBase64 = 'data:application/pdf;base64,' + Buffer.alloc(260 * 1024, 'A').toString('base64');
const cvRes = await parserCtrl.analyse({ user: testUser }, { base64: largeCvBase64, filename: 'mon_cv_260ko.pdf' });
assert(cvRes.expertise !== undefined, 'CV 260 ko analysé sans crash');
assert(!('suggestedAnswers' in cvRes), 'Aucune réponse suggérée renvoyée au questionnaire');
assert(!('inferredScores' in cvRes), 'Aucun score de personnalité renvoyé (seule l’expertise est conservée)');
await parserCtrl.analyse({ user: testUser }, { text: sampleCvText, filename: 'cv.txt' });
assert(['novice', 'intermediate', 'advanced'].includes(testUser.cvProfile?.expertise), 'Expertise du CV conservée sur l’utilisateur');
assert(!JSON.stringify(testUser.cvProfile).includes('ALEXANDRE DUPONT'), 'Le texte du CV n’est pas conservé');
console.log(`\n🎉 TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS ! (${passed}/${total})\n`);
