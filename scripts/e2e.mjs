// Test de bout en bout du pipeline complet. Usage : npm run build && npm start, puis npm run test:e2e
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let token = '';
const call = async (method, path, body, expected = [200, 201]) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!expected.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
};
const step = (label, detail = '') => console.log(`✔ ${label}${detail ? ' — ' + detail : ''}`);
const assert = (cond, msg) => { if (!cond) throw new Error('ÉCHEC : ' + msg); };

// --- Admin : ouvre le flux temps réel -------------------------------------------------
const admin = await call('POST', '/api/auth/login',
  { email: process.env.ADMIN_EMAIL ?? 'admin@miroir.local', password: process.env.ADMIN_PASSWORD ?? 'admin123' });
const events = [];
const sse = await fetch(`${BASE}/api/admin/stream?token=${admin.token}`);
(async () => {
  const decoder = new TextDecoder();
  for await (const chunk of sse.body) {
    for (const line of decoder.decode(chunk).split('\n')) {
      if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
    }
  }
})().catch(() => {});

// --- 1. Inscription ---------------------------------------------------------------
const email = `robert+${Date.now()}@test.local`;
const reg = await call('POST', '/api/auth/register', { email, password: 'secret123', name: 'Robert (test)' });
token = reg.token;
assert(reg.user.status === 'onboarding', 'statut initial');
step('Inscription', email);
await call('POST', '/api/trades/check', { ticker: 'NVDA', side: 'buy', amount: 1000 }, [403]);
step('Trade refusé avant évaluation');

// --- 2. Questionnaire : un profil qui se dit prudent ---------------------------------
const questions = await call('GET', '/api/evaluation/questions');
const answers = Object.fromEntries(questions.map((q) => [q.id, q.options[0].id]));
Object.assign(answers, { age: '45-59', horizon: '3-5', crypto: 'no' });
const session = await call('POST', '/api/evaluation/start', { answers });
assert(session.scenarios.length === 5, '5 scénarios');
assert(!JSON.stringify(session).includes('reveal'), 'aucune fuite de l’actif réel');
step('Questionnaire + 5 simulations masquées', session.scenarios.map((s) => s.title).join(', '));

// --- 3. Simulations : il agit de façon impulsive (1er choix, 2 s) -----------------------
for (const s of session.scenarios) {
  await call('POST', `/api/evaluation/${session.evaluationId}/decisions`,
    { scenarioId: s.id, choiceId: s.choices[0].id, decisionTimeMs: 2000 });
}
const result = await call('POST', `/api/evaluation/${session.evaluationId}/complete`);
step('Révélation', result.reveals.map((r) => `${r.reveal.ticker} ${r.pnl >= 0 ? '+' : ''}${r.pnl}$`).join(' | '));
const weak = result.params.filter((p) => p.atRisk);
assert(weak.length >= 2, 'paramètres fragiles détectés');
step('Paramètres fragiles', weak.map((p) => `${p.label} (déclaré ${p.declared}, observé ${p.observed})`).join(' ; '));

// --- 4. Règles auto-définies ------------------------------------------------------------
const rules = weak.map((p) => ({ param: p.param, text: p.suggestedRule.text, threshold: p.suggestedRule.threshold }));
await call('POST', `/api/evaluation/${session.evaluationId}/rules`, { rules });
let me = await call('GET', '/api/me');
assert(me.status === 'active' && me.drift.score === 0, 'profil actif, dérive 0');
step('Règles enregistrées, profil actif', `${me.rules.length} règle(s)`);

// --- 5. Trades : conforme, puis risqué ---------------------------------------------------
const calm = await call('POST', '/api/trades', { ticker: 'XBB.TO', side: 'buy', amount: 5000, decisionTimeMs: 45000 });
step('Trade conforme', calm.trade.investigation.explanation.summary);

const risky = { ticker: 'NVDA', side: 'buy', amount: 30000, marketDate: '2023-05-30', decisionTimeMs: 3000 };
const check = await call('POST', '/api/trades/check', risky);
step('Pré-contrôle', `${check.triggeredRules.length} règle(s) rappelée(s), ${check.warnings.length} avertissement(s)`);
assert(check.triggeredRules.length > 0, 'une règle devrait se déclencher');
await call('POST', '/api/trades', risky, [409]);
step('Trade bloqué sans confirmation des règles (409)');

let out, n = 0;
const tickers = ['NVDA', 'TSLA', 'BTC-USD', 'ETH-USD'];
const dates = ['2023-05-30', '2024-12-17', '2024-03-25', '2025-08-22'];
do {
  const req = { ticker: tickers[n], side: 'buy', amount: 15000, marketDate: dates[n], decisionTimeMs: 3000 };
  const c = await call('POST', '/api/trades/check', req);
  out = await call('POST', '/api/trades', { ...req, acknowledgedRuleIds: c.triggeredRules.map((r) => r.ruleId) });
  step(`Trade risqué ${++n}`, out.trade.investigation.explanation.summary);
} while (out.status === 'active' && n < 4);
assert(out.status === 'reevaluation_required', 'la dérive doit exiger une réévaluation');
step('Seuil de dérive franchi', `score ${out.drift.score}`);
await call('POST', '/api/trades/check', { ticker: 'SPY', side: 'buy', amount: 100 }, [403]);
step('Trading bloqué jusqu’à la réévaluation');

// --- 6. Réévaluation -------------------------------------------------------------------
const again = await call('POST', '/api/evaluation/start', {});
assert(again.kind === 'reevaluation', 'réévaluation');
assert(!again.scenarios.some((s) => session.scenarios.some((o) => o.id === s.id)), 'nouveaux scénarios');
for (const s of again.scenarios) {
  await call('POST', `/api/evaluation/${again.evaluationId}/decisions`,
    { scenarioId: s.id, choiceId: s.choices.at(-2).id, decisionTimeMs: 20000 });
}
const result2 = await call('POST', `/api/evaluation/${again.evaluationId}/complete`);
await call('POST', `/api/evaluation/${again.evaluationId}/rules`, {
  rules: result2.params.filter((p) => p.atRisk).map((p) => ({ param: p.param, text: p.suggestedRule.text, threshold: p.suggestedRule.threshold })),
});
me = await call('GET', '/api/me');
assert(me.status === 'active' && me.drift.score === 0 && me.profile.evaluationCount === 2, 'dérive remise à zéro');
step('Réévaluation terminée', 'dérive remise à 0, règles mises à jour');

// --- 7. Vue admin ----------------------------------------------------------------------
token = admin.token;
const users = await call('GET', '/api/admin/users');
const row = users.find((u) => u.email === email);
const detail = await call('GET', `/api/admin/users/${row.id}`);
assert(detail.trades.length === n + 1, 'historique complet côté admin');
step('Vue admin', `${users.length} utilisateur(s), ${detail.trades.length} trades pour ${row.name}`);
const mine = events.filter((e) => e.userId === row.id).map((e) => e.type);
assert(['trade.received', 'investigation.completed', 'profile.updated'].every((t) => mine.includes(t)), 'événements temps réel');
step('Temps réel (SSE)', `${mine.length} événements reçus`);
token = reg.token;
await call('GET', '/api/admin/users', null, [403]);
step('Accès admin refusé à un utilisateur normal');

console.log('\nTout le pipeline fonctionne.');
process.exit(0);
