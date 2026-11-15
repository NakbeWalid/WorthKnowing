// Fonctions partagées par toutes les pages de Miroir : appels API, session, liaison en attente, graphiques.

const session = {
  get token() { return localStorage.getItem('miroir.token'); },
  save(data) { localStorage.setItem('miroir.token', data.token); },
  clear() { localStorage.removeItem('miroir.token'); sessionStorage.removeItem('miroir.evaluation'); location.href = '/'; },
};

/**
 * Demande venue de la plateforme de courtage, gardée le temps de l'onglet :
 *   { returnUrl, partner, link: true, state }  -> lier le compte puis y retourner avec un code ;
 *   { returnUrl, partner }                     -> simple retour (après une réévaluation).
 */
const pending = {
  get() { try { return JSON.parse(sessionStorage.getItem('miroir.pending')); } catch { return null; } },
  set(value) { sessionStorage.setItem('miroir.pending', JSON.stringify(value)); },
  clear() { sessionStorage.removeItem('miroir.pending'); },
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
  if (res.status === 401 && !path.startsWith('/auth/')) session.clear();
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
    throw Object.assign(new Error(message || 'Erreur ' + res.status), { status: res.status, data });
  }
  return data;
}

/** Envoie l'utilisateur sur la bonne page selon son rôle et l'état de son profil. */
function route(user) {
  if (user.role === 'admin') location.href = '/admin.html';
  else if (!user.profile) location.href = '/onboarding.html';
  // Revenu de la plateforme pour une réévaluation exigée : on y va directement.
  else if (user.status === 'reevaluation_required' && pending.get() && !pending.get().link) location.href = '/onboarding.html';
  else location.href = '/profile.html';
}

/** Fin d'un parcours : retour chez le partenaire (avec le code de liaison si demandé), sinon page de profil. */
async function finishAndReturn() {
  const p = pending.get();
  if (!p) return (location.href = '/profile.html');
  let target = p.returnUrl;
  if (p.link) target = (await api('POST', '/link/authorize', { state: p.state, returnUrl: p.returnUrl })).redirectUrl;
  pending.clear();
  location.href = target;
}

const $ = (selector) => document.querySelector(selector);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Math.round(n).toLocaleString('fr-CA') + ' $';
const signed = (n) => `<span class="${n >= 0 ? 'pos' : 'neg'} num">${n >= 0 ? '+' : '−'}${money(Math.abs(n))}</span>`;
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} %`;
const day = (iso) => new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

const PARAM_LABELS = {
  riskTolerance: 'Appétit pour le risque', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »',
  concentration: 'Concentration', impulsivity: 'Impulsivité', newsSensitivity: 'Sensibilité aux nouvelles',
};
const STATUS = {
  onboarding: ['Évaluation en cours', 'grey'], active: ['Profil actif', 'ok'], reevaluation_required: ['Réévaluation requise', 'danger'],
};
const statusBadge = (s) => `<span class="badge ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

/** En-tête du miroir : nomme les deux côtés de l'axe. */
const mirrorHead = (left, right) => `<div class="mirror-head"><span>${left}</span><span></span><span>${right}</span></div>`;

/** Une ligne du miroir : `reference` à gauche de l'axe (gris), `value` à droite (couleur ; orange si l'écart ≥ 10). */
function mirror(label, reference, value, note = '') {
  const hot = Math.abs(value - reference) >= 10;
  return `<div class="mirror">
    <div class="label"><span>${label}</span>${note ? `<span class="muted small">${note}</span>` : ''}</div>
    <div class="half left"><i style="width:${reference}%"></i><b>${reference}</b></div>
    <div class="axis"></div>
    <div class="half right"><i class="${hot ? 'hot' : ''}" style="width:${value}%"></i><b>${value}</b></div>
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
    <path d="${path(context, 0)}" fill="none" stroke="#1c1b29" stroke-width="2"/>
    ${forward.length ? `<line x1="${cut}" x2="${cut}" y1="0" y2="${H}" stroke="#66647a" stroke-dasharray="4 4"/>
      <path d="${path(forward, context.length - 1)}" fill="none" stroke="#4b3fa7" stroke-width="2.5"/>
      <text x="${cut + 6}" y="14" font-size="12" fill="#66647a">votre décision</text>` : ''}
  </svg>`;
}
