// Test de bout en bout des DEUX applications et de leur liaison, par leurs API.
// Usage : npm run build && npm start   puis, dans un autre terminal :   npm run test:e2e
const MIROIR = process.env.MIROIR_URL ?? 'http://localhost:3000';
const BANK = process.env.BANK_URL ?? 'http://localhost:3001';
const PARTNER_KEY = process.env.PARTNER_API_KEY ?? 'dev-partner-key-change-me';

const client = (base) => {
  const c = {
    token: '',
    async call(method, path, body, expected = [200, 201], headers = {}) {
      const res = await fetch(base + path, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { 'Content-Type': 'application/json', ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}), ...headers },
      });
      const data = await res.json().catch(() => ({}));
      if (!expected.includes(res.status)) throw new Error(`${method} ${base}${path} -> ${res.status} ${JSON.stringify(data)}`);
      return data;
    },
  };
  return c;
};
const step = (label, detail = '') => console.log(`✔ ${label}${detail ? ' — ' + detail : ''}`);
const assert = (cond, msg) => { if (!cond) throw new Error('ÉCHEC : ' + msg); };
const stamp = Date.now();

// --- Admin Miroir : ouvre le flux temps réel ------------------------------------------
const admin = client(MIROIR);
admin.token = (await admin.call('POST', '/api/auth/login',
  { email: process.env.ADMIN_EMAIL ?? 'admin@miroir.local', password: process.env.ADMIN_PASSWORD ?? 'admin123' })).token;
const events = [];
const sse = await fetch(`${MIROIR}/api/admin/stream?token=${encodeURIComponent(admin.token)}`);
(async () => {
  const decoder = new TextDecoder();
  for await (const chunk of sse.body) {
    for (const line of decoder.decode(chunk).split('\n')) {
      if (line.startsWith('data: {')) { try { events.push(JSON.parse(line.slice(6))); } catch { /* ligne coupée */ } }
    }
  }
})().catch(() => {});

// === 1. Un client qui REFUSE Miroir : compte de courtage ordinaire ====================
const plain = client(BANK);
plain.token = (await plain.call('POST', '/api/auth/register', { email: `sans-miroir+${stamp}@test.local`, password: 'secret123', name: 'Client sans Miroir' })).token;
let me = await plain.call('GET', '/api/me');
assert(me.miroir.status === 'none' && me.portfolio.cash === 100000, 'nouveau compte : offre Miroir jamais présentée, 100 000 $');
await plain.call('POST', '/api/miroir/decline');
let preview = await plain.call('POST', '/api/trades/preview', { ticker: 'NVDA', side: 'buy', amount: 30000, marketDate: '2023-05-30' });
assert(preview.miroir.status === 'not_linked', 'aucun appel à Miroir pour un compte non lié');
let out = await plain.call('POST', '/api/trades', { ticker: 'NVDA', side: 'buy', amount: 30000, marketDate: '2023-05-30', decisionTimeMs: 2000 });
assert(out.trade.miroir.status === 'not_linked' && out.miroir === null, 'trade exécuté sans enquête');
assert((await plain.call('GET', '/api/trades')).length === 1, 'historique conservé par la plateforme');
await plain.call('POST', '/api/trades', { ticker: 'NVDA', side: 'sell', amount: 999999 }, [400]);
await plain.call('POST', '/api/trades', { ticker: 'TSLA', side: 'buy', amount: 999999 }, [400]);
step('Compte de courtage sans Miroir', 'offre refusée, trade exécuté, historique conservé, rien envoyé à Miroir');

// === 2. Un client qui ACCEPTE : redirection vers Miroir ================================
const bank = client(BANK);
bank.token = (await bank.call('POST', '/api/auth/register', { email: `robert+${stamp}@test.local`, password: 'secret123', name: 'Robert' })).token;
const start = await bank.call('POST', '/api/miroir/link/start');
const link = new URL(start.redirectUrl);
const state = link.searchParams.get('state');
const returnUrl = link.searchParams.get('return');
assert(link.origin === MIROIR && state && returnUrl.startsWith(BANK), 'redirection vers Miroir avec state et adresse de retour');
step('Activation demandée', `redirection vers ${link.origin}`);

// === 3. Chez Miroir : compte distinct, puis tout le processus de profil ==================
const miroir = client(MIROIR);
assert((await miroir.call('GET', `/api/link/partner?return=${encodeURIComponent(returnUrl)}`)).allowed, 'adresse de retour reconnue');
assert(!(await miroir.call('GET', `/api/link/partner?return=${encodeURIComponent('https://evil.example/app.html')}`)).allowed, 'adresse inconnue refusée');
const reg = await miroir.call('POST', '/api/auth/register', { email: `robert-miroir+${stamp}@test.local`, password: 'secret123', name: 'Robert (Miroir)' });
miroir.token = reg.token;
await miroir.call('POST', '/api/link/authorize', { state, returnUrl }, [409]);
step('Compte Miroir créé', 'liaison impossible avant la fin de l’évaluation');

const questions = await miroir.call('GET', '/api/evaluation/questions');
const answers = Object.fromEntries(questions.map((q) => [q.id, q.options[0].id]));
Object.assign(answers, { age: '45-59', horizon: '3-5', crypto: 'no' });
const session = await miroir.call('POST', '/api/evaluation/start', { answers });
assert(session.scenarios.length === 5 && !JSON.stringify(session).includes('reveal'), '5 scénarios masqués');
for (const s of session.scenarios.slice(0, 2)) {
  await miroir.call('POST', `/api/evaluation/${session.evaluationId}/decisions`, { scenarioId: s.id, choiceId: s.choices[0].id, decisionTimeMs: 2000 });
}
const resumed = await miroir.call('GET', `/api/evaluation/${session.evaluationId}`);
assert(resumed.answered.length === 2 && resumed.result === null, 'reprise après rechargement : 2 réponses conservées');
for (const s of session.scenarios.slice(2)) {
  await miroir.call('POST', `/api/evaluation/${session.evaluationId}/decisions`, { scenarioId: s.id, choiceId: s.choices[0].id, decisionTimeMs: 2000 });
}
const result = await miroir.call('POST', `/api/evaluation/${session.evaluationId}/complete`);
await miroir.call('POST', `/api/evaluation/${session.evaluationId}/decisions`,
  { scenarioId: session.scenarios[0].id, choiceId: session.scenarios[0].choices[1].id, decisionTimeMs: 1 }, [400]);
const weak = result.params.filter((p) => p.atRisk);
assert(weak.length >= 2, 'paramètres fragiles détectés');
await miroir.call('POST', `/api/evaluation/${session.evaluationId}/rules`,
  { rules: weak.map((p) => ({ param: p.param, text: p.suggestedRule.text, threshold: p.suggestedRule.threshold })) });
step('Évaluation', `${result.reveals.map((r) => r.reveal.ticker).join(', ')} révélés ; ${weak.length} règles ; réponses figées après la révélation`);

// === 4. Retour à la plateforme : code à usage unique -> code persona ======================
const authorized = await miroir.call('POST', '/api/link/authorize', { state, returnUrl });
const back = new URL(authorized.redirectUrl);
const code = back.searchParams.get('code');
assert(back.href.startsWith(returnUrl) && back.searchParams.get('state') === state, 'retour vers la plateforme avec code et state');
await bank.call('POST', '/api/miroir/link/complete', { code, state: 'mauvais-state' }, [400]);
await client(MIROIR).call('POST', '/api/partner/v1/link/exchange', { code }, [401], { 'x-partner-key': 'mauvaise-cle' });
const linked = await bank.call('POST', '/api/miroir/link/complete', { code, state });
assert(linked.status === 'linked' && linked.persona.rules.length === weak.length, 'compte lié, règles visibles');
await client(MIROIR).call('POST', '/api/partner/v1/link/exchange', { code }, [401], { 'x-partner-key': PARTNER_KEY });
me = await bank.call('GET', '/api/me');
assert(me.miroir.status === 'linked' && !JSON.stringify(me).includes('mir_'), 'le code persona ne sort jamais du serveur');
step('Liaison', 'state vérifié, code à usage unique, clé partenaire exigée, code persona gardé côté serveur');

// === 5. Trades : pré-contrôle des règles, puis enquête ====================================
out = await bank.call('POST', '/api/trades', { ticker: 'XBB.TO', side: 'buy', amount: 5000, marketDate: '2023-01-10', decisionTimeMs: 45000 });
assert(out.trade.miroir.status === 'analysed' && out.miroir.drift.score === 0, 'trade conforme : enquête sans dérive');
step('Trade conforme', out.miroir.investigation.explanation.summary);

const risky = { ticker: 'NVDA', side: 'buy', amount: 30000, marketDate: '2023-05-30', decisionTimeMs: 3000 };
preview = await bank.call('POST', '/api/trades/preview', risky);
assert(preview.miroir.status === 'ok' && preview.miroir.triggeredRules.length > 0, 'une règle doit être rappelée avant le trade');
step('Pré-contrôle', `${preview.miroir.triggeredRules.length} règle(s) à rappeler, ${preview.miroir.warnings.length} avertissement(s)`);
await bank.call('POST', '/api/trades', risky, [409]);
await bank.call('POST', '/api/trades/cancel', risky);
assert((await bank.call('GET', '/api/trades')).length === 1, 'trade annulé : rien n’est exécuté');
step('Rappel de règle', 'trade bloqué sans confirmation (409), puis annulé par le client');
await bank.call('POST', '/api/trades/preview', { ticker: 'SPY', side: 'buy', amount: 100, marketDate: '2022-06-01' }, [400]);
step('Horloge de marché simulée', 'un ordre ne peut pas être daté avant le précédent');

const orders = [['NVDA', '2023-05-30'], ['BTC-USD', '2024-03-25'], ['TSLA', '2024-12-17'], ['ETH-USD', '2025-08-22']];
let n = 0;
do {
  const req = { ticker: orders[n][0], side: 'buy', amount: 15000, marketDate: orders[n][1], decisionTimeMs: 3000 };
  const p = await bank.call('POST', '/api/trades/preview', req);
  out = await bank.call('POST', '/api/trades', { ...req, acknowledgedRuleIds: p.miroir.triggeredRules.map((r) => r.ruleId) });
  step(`Trade risqué ${++n}`, `dérive ${out.miroir.drift.before} → ${out.miroir.drift.score}`);
} while (!out.miroir.reevaluationRequired && n < orders.length);
assert(out.miroir.reevaluationRequired, 'la dérive doit exiger une réévaluation');
const blocked = await bank.call('POST', '/api/trades', { ticker: 'SPY', side: 'buy', amount: 100 }, [409]);
assert(blocked.reevaluationRequired, 'ordres suspendus jusqu’à la réévaluation');
step('Seuil de dérive franchi', `score ${out.miroir.drift.score} : ordres suspendus côté plateforme`);

// === 6. Réévaluation chez Miroir, puis reprise des ordres ================================
const again = await miroir.call('POST', '/api/evaluation/start', {});
assert(again.kind === 'reevaluation' && !again.scenarios.some((s) => session.scenarios.some((o) => o.id === s.id)), 'nouveaux scénarios');
for (const s of again.scenarios) {
  await miroir.call('POST', `/api/evaluation/${again.evaluationId}/decisions`, { scenarioId: s.id, choiceId: s.choices.at(-2).id, decisionTimeMs: 20000 });
}
const result2 = await miroir.call('POST', `/api/evaluation/${again.evaluationId}/complete`);
await miroir.call('POST', `/api/evaluation/${again.evaluationId}/rules`, {
  rules: result2.params.filter((p) => p.atRisk).map((p) => ({ param: p.param, text: p.suggestedRule.text, threshold: p.suggestedRule.threshold })),
});
const profile = await miroir.call('GET', '/api/me');
assert(profile.status === 'active' && profile.drift.score === 0 && profile.profile.evaluationCount === 2, 'dérive remise à zéro');
assert(profile.link?.partner && !('id' in profile.link), 'liaison visible côté Miroir, sans son identifiant secret');
await bank.call('POST', '/api/trades', { ticker: 'SPY', side: 'buy', amount: 100, decisionTimeMs: 30000 });
assert((await miroir.call('GET', '/api/trades')).length === n + 2, 'tous les trades enquêtés sont dans le profil Miroir');
step('Réévaluation', 'dérive remise à 0, ordres de nouveau acceptés');

// === 7. Révocation côté Miroir, nouvelle liaison, retrait côté plateforme ===================
await miroir.call('DELETE', '/api/link');
preview = await bank.call('POST', '/api/trades/preview', { ticker: 'SPY', side: 'buy', amount: 100 });
me = await bank.call('GET', '/api/me');
assert(preview.miroir.status === 'not_linked' && me.miroir.status === 'declined', 'révocation côté Miroir détectée par la plateforme');
out = await bank.call('POST', '/api/trades', { ticker: 'SPY', side: 'buy', amount: 100 });
assert(out.trade.miroir.status === 'not_linked', 'le compte redevient un compte ordinaire');
const start2 = new URL((await bank.call('POST', '/api/miroir/link/start')).redirectUrl);
const auth2 = new URL((await miroir.call('POST', '/api/link/authorize', { state: start2.searchParams.get('state'), returnUrl })).redirectUrl);
await bank.call('POST', '/api/miroir/link/complete', { code: auth2.searchParams.get('code'), state: start2.searchParams.get('state') });
assert((await bank.call('GET', '/api/miroir/persona')).persona.status === 'active', 'compte lié de nouveau');
await bank.call('POST', '/api/miroir/unlink');
assert((await miroir.call('GET', '/api/me')).link === null, 'retrait côté plateforme répercuté chez Miroir');
step('Révocation et nouvelle liaison', 'des deux côtés ; l’option reste disponible');

// === 8. Vue admin Miroir =============================================================
await miroir.call('POST', '/api/trades', { ticker: 'SPY' }, [404]);
const users = await admin.call('GET', '/api/admin/users');
const row = users.find((u) => u.email === `robert-miroir+${stamp}@test.local`);
const detail = await admin.call('GET', `/api/admin/users/${row.id}`);
assert(detail.trades.length === n + 2, 'historique des enquêtes côté admin');
const types = events.filter((e) => e.userId === row.id).map((e) => e.type);
for (const t of ['link.created', 'trade.received', 'investigation.completed', 'profile.updated', 'rule.respected', 'link.revoked']) {
  assert(types.includes(t), `événement temps réel ${t}`);
}
await miroir.call('GET', '/api/admin/users', null, [403]);
step('Vue admin', `${detail.trades.length} enquêtes, ${types.length} événements temps réel, accès refusé aux non-admins`);

console.log('\nLes deux applications et leur liaison fonctionnent.');
process.exit(0);
