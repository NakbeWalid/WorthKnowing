// Tests automatisés de l'agent d'influence et de ses garde-fous, SANS AWS : un faux client Bedrock renvoie des
// réponses scriptées. Usage : npm run build && npm run test:unit
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const guards = require('../dist/miroir/ai/guards.js');
const { BedrockInfluenceAgent } = require('../dist/miroir/trades/agents/influence.agent.js');
const { MarketService } = require('../dist/shared/market.service.js');
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false); // les avertissements de relance sont attendus : on ne pollue pas la sortie

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘ ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ============================================================ Garde-fou lexical (inventedQualifiers)
console.log('\n# Garde-fou lexical');
check(same(guards.inventedQualifiers('Une décision rapide.', 'Décision prise en 4 s.'), ['rapide']), 'mot absent des faits : rejeté');
for (const word of ['rapide', 'rapides', 'rapidement', 'rapidité', 'vite', 'lent', 'lente', 'lentement', 'lenteur', 'précipité', 'précipitée',
  'précipitamment', 'hâtif', 'hâtive', 'hâtivement', 'instantané', 'instantanée', 'instantanément', 'promptement', 'immédiat', 'immédiate', 'immédiatement', 'expéditif', 'réfléchie', 'irréfléchie']) {
  check(guards.inventedQualifiers(`La décision est ${word} ici.`, 'Décision prise en 60 s.').length === 1, `variante détectée : ${word}`);
}
check(same(guards.inventedQualifiers('Décision quasi instantanée.', ''), ['instantanée']), '« quasi instantanée » détecté');
check(same(guards.inventedQualifiers('Décision RAPIDE et Précipitée.', ''), ['rapide', 'précipitée']), 'majuscules et accents');
check(guards.inventedQualifiers('Des nouvelles récentes, une hausse récente (+49 %), peu après, la veille.', '').length === 0, 'proximités non ciblées (« récent », « peu après ») non rejetées : périmètre borné');
check(guards.inventedQualifiers('Un talent violent, une invite, le rapport, un rapprochement, une lentille, la vitesse du vent.', '').length === 0, 'aucun faux positif sur « talent », « violent », « invite », « rapport », « lentille »…');
check(guards.inventedQualifiers('la croissance la plus rapide [N1]', 'Titre : Alphabet, la croissance la plus rapide en un an').length === 0, 'mot présent dans les faits (titre de manchette) : accepté');
check(same(guards.inventedQualifiers('réagit rapidement', 'la plus rapide croissance'), ['rapidement']), '« rapide » dans les faits n’autorise pas « rapidement »');
check(guards.inventedQualifiers('profil élevé en impulsivity et impulsivité', 'impulsivity 80').length === 0, '« impulsivity » (paramètre du profil) jamais rejeté');

// ============================================================ Garde-fous existants (non-régression)
console.log('\n# Garde-fous existants');
check(same(guards.inventedDurations('4 jours après des nouvelles', 'Fenêtre de 7 jours'), ['4 jours']), 'délai inventé rejeté');
check(guards.inventedDurations('sur une fenêtre de 7 jours', 'Fenêtre de 7 jours').length === 0, 'durée présente dans les faits acceptée');
check(same(guards.inventedNumbers('La position pèse 87 %', 'Position 12 %'), ['87']), 'chiffre inventé rejeté');

// ============================================================ Agent : relance unique et filet de sécurité
console.log('\n# Agent d\'influence (faux client Bedrock)');
const market = new MarketService();
await market.onModuleInit();
const context = market.context('XBB.TO', '2023-01-10');
const news = [
  { date: '2023-01-06', source: 'a.ca', impact: 'élevé', simulated: false, title: 'Surprise jobs gain increases the odds of a rate hike', url: 'https://a.ca/1' },
  { date: '2023-01-06', source: 'b.ca', impact: 'élevé', simulated: false, title: 'More Lenders See Hiking After Blowout Jobs Report', url: 'https://b.ca/2' },
];
const profile = { riskTolerance: 60, lossAversion: 80, fomo: 70, concentration: 85, impulsivity: 80, newsSensitivity: 90 };
const input = (n = news) => ({
  metrics: { side: 'buy', context, positionWeight: 0.02, speculativeWeight: 0, decisionSeconds: 60 }, amount: 2000, note: '',
  news: n, profile: { declared: profile, baseline: profile, current: profile }, deterministic: [], recentTrades: [],
});
const base = { verdict: 'influence_externe', refs: ['F1', 'N1', 'N2'], findings: [] };
const GOOD = 'Des nouvelles sur les taux [N1][N2] précèdent le trade ; décision prise en 60 s [F1].';
const REFS = /^Appuyé sur :/;

async function run(name, script, expectCalls, verify, inp = input()) {
  const prompts = [];
  let i = 0;
  const fake = { modelId: 'fake', json: async (_s, prompt) => { prompts.push(prompt); const r = script[i++]; if (r instanceof Error) throw r; return r; } };
  const r = await new BedrockInfluenceAgent(fake).analyse(inp);
  check(prompts.length === expectCalls && verify(r, prompts), name, `appels ${prompts.length}/${expectCalls} · « ${r.verdict?.rationale?.slice(0, 70)} »`);
}

// Les 8 cas d'origine (délais et chiffres)
const BAD_DELAY = 'Le trade intervient 4 jours après des nouvelles sur les taux [N1][N2], décision prise en 60 s [F1].';
await run('délai inventé, puis relance propre', [{ ...base, rationale: BAD_DELAY }, { ...base, rationale: GOOD }], 2,
  (r, p) => r.verdict.rationale === GOOD && /4 jours/.test(p[1]) && /délai non confirmé/.test(p[1]));
await run('relance fautive aussi : liste de références', [{ ...base, rationale: BAD_DELAY }, { ...base, rationale: 'Encore 3 jours avant [N1].' }], 2, (r) => REFS.test(r.verdict.rationale));
await run('phrase propre : un seul appel', [{ ...base, rationale: GOOD }], 1, (r) => r.verdict.rationale === GOOD);
await run('relance qui plante : liste de références', [{ ...base, rationale: BAD_DELAY }, new Error('timeout')], 2, (r) => REFS.test(r.verdict.rationale) && r.verdict.verdict === 'influence_externe');
await run('la relance ne change pas le verdict', [{ ...base, rationale: BAD_DELAY }, { verdict: 'conforme', refs: ['F1'], findings: [], rationale: GOOD }], 2,
  (r) => r.verdict.rationale === GOOD && r.verdict.verdict === 'influence_externe' && r.verdict.refs.join() === 'F1,N1,N2');
await run('relance vide : liste de références', [{ ...base, rationale: BAD_DELAY }, { ...base, rationale: '  ' }], 2, (r) => REFS.test(r.verdict.rationale));
await run('chiffre inventé, puis relance propre', [{ ...base, rationale: 'La position pèse 87 % du portefeuille [F1].' }, { ...base, rationale: GOOD }], 2,
  (r, p) => r.verdict.rationale === GOOD && /chiffre\(s\) 87/.test(p[1]));
await run('date de nouvelle inventée : rejetée', [{ ...base, rationale: 'Des nouvelles du 15 juillet [N1] précèdent le trade.' }, { ...base, rationale: 'Encore du 22 juillet [N1].' }], 2, (r) => REFS.test(r.verdict.rationale));

// Nouveaux cas : qualificatifs
const BAD_QUAL = 'Des nouvelles sur les taux [N1][N2] précèdent une décision rapide de 60 s [F1].';
await run('qualificatif « rapide », puis relance propre', [{ ...base, rationale: BAD_QUAL }, { ...base, rationale: GOOD }], 2,
  (r, p) => r.verdict.rationale === GOOD
    && p[1].includes('elle utilise le mot « rapide » alors que rien dans les faits fournis ne qualifie la vitesse de la décision'));
await run('qualificatif répété à la relance : liste de références', [{ ...base, rationale: BAD_QUAL }, { ...base, rationale: 'Une réaction précipitée [N1].' }], 2,
  (r) => REFS.test(r.verdict.rationale) && !/rapide|précipit/i.test(r.verdict.rationale));
await run('deux mots nommés ensemble', [{ ...base, rationale: 'Décision rapide et précipitée [F1].' }, { ...base, rationale: GOOD }], 2,
  (r, p) => /les mots « rapide », « précipitée »/.test(p[1]));
await run('qualificatif + délai : les deux violations sont nommées', [{ ...base, rationale: 'Décision rapide, 4 jours après [N1].' }, { ...base, rationale: GOOD }], 2,
  (r, p) => /mot « rapide »/.test(p[1]) && /« 4 jours »/.test(p[1]));
await run('relance qui plante sur qualificatif : liste de références', [{ ...base, rationale: BAD_QUAL }, new Error('timeout')], 2, (r) => REFS.test(r.verdict.rationale));
await run('la relance ne change pas le verdict (qualificatif)', [{ ...base, rationale: BAD_QUAL }, { verdict: 'conforme', refs: ['F1'], findings: [], rationale: GOOD }], 2,
  (r) => r.verdict.verdict === 'influence_externe' && r.verdict.rationale === GOOD);
// Mot présent dans une vraie manchette : aucun rejet, aucune relance
const newsFast = [{ ...news[0], title: 'Alphabet posts its fastest growth, a rapide rise' }, news[1]];
await run('mot déjà dans les faits (titre de manchette) : aucun rejet', [{ ...base, rationale: 'Une hausse rapide citée par [N1] précède le trade.' }], 1,
  (r) => /rapide/.test(r.verdict.rationale), input(newsFast));
await run('même mot, absent des faits : rejeté', [{ ...base, rationale: 'Une hausse rapide citée par [N1] précède le trade.' }, { ...base, rationale: GOOD }], 2,
  (r) => r.verdict.rationale === GOOD);

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
