// Fonctions partagées par toutes les pages : appels API, session, graphiques, barres de profil.

const session = {
  get token() { return localStorage.getItem('token'); },
  get role() { return localStorage.getItem('role'); },
  save(data) { localStorage.setItem('token', data.token); localStorage.setItem('role', data.user.role); },
  clear() { localStorage.removeItem('token'); localStorage.removeItem('role'); location.href = '/'; },
};

/**
 * Appel JSON à l'API. Lève toujours une Error avec un message lisible : `status` = 0 si le serveur est
 * injoignable ou trop lent, sinon le code HTTP ; `data` = corps de la réponse.
 */
async function api(method, path, body, timeoutMs = 90_000) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  let res;
  try {
    res = await fetch('/api' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw Object.assign(new Error(err.name === 'TimeoutError'
      ? 'Le serveur met trop de temps à répondre. Réessayez.'
      : 'Connexion au serveur impossible. Vérifiez votre réseau et réessayez.'), { status: 0, data: {} });
  }
  // Un proxy (CloudFront, ALB) peut répondre en HTML ou sans corps : on ne suppose jamais du JSON.
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* corps non JSON */ }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/register') session.clear();
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
    throw Object.assign(new Error(message || 'Erreur ' + res.status), { status: res.status, data });
  }
  return data;
}
/** Envoie l'utilisateur sur la bonne page selon son rôle et son statut. */
function route(user) {
  if (user.role === 'admin') location.href = '/admin.html';
  else location.href = user.status === 'onboarding' ? '/onboarding.html' : '/dashboard.html';
}

const $ = (selector) => document.querySelector(selector);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Math.round(n).toLocaleString('fr-CA') + ' $';
const signed = (n) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : ''}${money(n)}</span>`;
const pct = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)} %`;

const PARAM_LABELS = {
  riskTolerance: 'Appétit pour le risque', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »',
  concentration: 'Concentration', impulsivity: 'Impulsivité', newsSensitivity: 'Sensibilité aux nouvelles',
};
const STATUS = {
  onboarding: ['Évaluation en cours', 'grey'], active: ['Actif', ''], reevaluation_required: ['Réévaluation requise', 'danger'],
};
const statusBadge = (s) => `<span class="badge ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

/** Barre d'un paramètre : `value` = barre pleine, `mark` = repère vertical (déclaré ou référence). */
function paramBar(label, value, mark, note = '') {
  const moved = mark != null && Math.abs(value - mark) >= 10;
  return `<div class="param">
    <div class="head"><span>${label}</span><span class="muted">${note || value}</span></div>
    <div class="bar"><i class="${moved ? 'hot' : ''}" style="width:${value}%"></i>${mark != null ? `<b style="left:${mark}%"></b>` : ''}</div>
  </div>`;
}

/**
 * Courbe SVG minimaliste. `context` = avant la décision ; `forward` (optionnel) = la suite réelle,
 * tracée en couleur après une ligne pointillée marquant le moment de la décision.
 */
function lineChart(context, forward = []) {
  const all = context.concat(forward.slice(1));
  if (all.length < 2) return '';
  const W = 640, H = 200, pad = 8;
  const min = Math.min(...all), max = Math.max(...all);
  const x = (i) => pad + (i / (all.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const path = (values, offset) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const cut = x(context.length - 1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du prix (base 100)">
    <path d="${path(context, 0)}" fill="none" stroke="#17202e" stroke-width="2"/>
    ${forward.length ? `<line x1="${cut}" x2="${cut}" y1="0" y2="${H}" stroke="#667085" stroke-dasharray="4 4"/>
      <path d="${path(forward, context.length - 1)}" fill="none" stroke="#0f6b5c" stroke-width="2.5"/>
      <text x="${cut + 6}" y="14" font-size="12" fill="#667085">votre décision</text>` : ''}
  </svg>`;
}
