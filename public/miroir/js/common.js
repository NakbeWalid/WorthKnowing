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

/**
 * Graphique Hexagonal (Radar Chart) à 6 critères :
 * Compare « Ce que vous pensez » (Déclaré) vs « Ce que vous êtes » (Observé / Actuel).
 */
function hexagonChart(declared = {}, actual = {}, options = {}) {
  const keys = ['riskTolerance', 'lossAversion', 'fomo', 'concentration', 'impulsivity', 'newsSensitivity'];
  const labels = [
    'Appétit risque',
    'Réaction pertes',
    'Attrait « hype »',
    'Concentration',
    'Impulsivité',
    'Sensibilité infos',
  ];

  const W = options.width || 560;
  const H = options.height || 420;
  const cx = W / 2;
  const cy = H / 2 - 12;
  const R = options.radius || 125;

  const angles = keys.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / 6);
  const pt = (angle, dist) => ({
    x: cx + dist * Math.cos(angle),
    y: cy + dist * Math.sin(angle),
  });

  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const gridPolys = gridLevels
    .map((lvl) => {
      const pts = angles.map((a) => pt(a, R * lvl)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="#e2e8f0" stroke-width="${lvl === 1.0 ? '1.5' : '1'}" stroke-dasharray="${lvl === 1.0 ? 'none' : '2,2'}" />`;
    })
    .join('');

  const axes = angles
    .map((a) => {
      const p = pt(a, R);
      return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="#cbd5e1" stroke-width="1.2" />`;
    })
    .join('');

  const labelElems = keys
    .map((k, i) => {
      const a = angles[i];
      const lp = pt(a, R + 26);
      const dVal = declared && declared[k] !== undefined ? declared[k] : 50;
      const aVal = actual && actual[k] !== undefined ? actual[k] : 50;

      let anchor = 'middle';
      if (Math.cos(a) > 0.3) anchor = 'start';
      else if (Math.cos(a) < -0.3) anchor = 'end';

      const baseline = Math.sin(a) < -0.3 ? 'baseline' : Math.sin(a) > 0.3 ? 'hanging' : 'middle';

      return `<g transform="translate(${lp.x.toFixed(1)}, ${lp.y.toFixed(1)})">
      <text text-anchor="${anchor}" dominant-baseline="${baseline}" font-size="12" font-weight="600" fill="#1e293b">${esc(labels[i])}</text>
      <text text-anchor="${anchor}" dominant-baseline="${baseline}" y="14" font-size="11" fill="#64748b">
        <tspan fill="#2563eb" font-weight="700">${dVal}</tspan> vs <tspan fill="#d97706" font-weight="700">${aVal}</tspan>
      </text>
    </g>`;
    })
    .join('');

  const declaredPts = keys.map((k, i) => {
    const val = Math.max(0, Math.min(100, Number(declared?.[k] ?? 50)));
    return pt(angles[i], R * (val / 100));
  });
  const declaredPoly = declaredPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const declaredDots = declaredPts
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" />`)
    .join('');

  const actualPts = keys.map((k, i) => {
    const val = Math.max(0, Math.min(100, Number(actual?.[k] ?? 50)));
    return pt(angles[i], R * (val / 100));
  });
  const actualPoly = actualPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const actualDots = actualPts
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#d97706" stroke="#ffffff" stroke-width="1.5" />`)
    .join('');

  const legendY = H - 18;

  return `<div class="hexagon-chart-card" style="margin:16px 0; background:var(--card-bg, #fff); border-radius:8px; padding:12px;">
    <h3 style="margin:0 0 4px; text-align:center; font-size:15px;">Ce que vous pensez et ce que vous faites</h3>
    <p class="small muted" style="margin:0 0 10px; text-align:center;">Les 6 paramètres de votre profil d’investisseur, de 0 à 100</p>
    <div style="text-align:center; overflow-x:auto;">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; max-width:520px; height:auto; font-family:inherit;" role="img" aria-label="Hexagone 6 critères">
        ${gridPolys}
        ${axes}
        <polygon points="${declaredPoly}" fill="rgba(37, 99, 235, 0.18)" stroke="#2563eb" stroke-width="2.2" stroke-dasharray="4,3" />
        ${declaredDots}
        <polygon points="${actualPoly}" fill="rgba(217, 119, 6, 0.22)" stroke="#d97706" stroke-width="2.5" />
        ${actualDots}
        ${labelElems}
        <g transform="translate(${cx - 150}, ${legendY})">
          <line x1="0" y1="0" x2="20" y2="0" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="4,3" />
          <circle cx="10" cy="0" r="4" fill="#2563eb" />
          <text x="26" y="4" font-size="12" font-weight="600" fill="#2563eb">Ce que vous pensez</text>

          <line x1="170" y1="0" x2="190" y2="0" stroke="#d97706" stroke-width="2.5" />
          <circle cx="180" cy="0" r="4" fill="#d97706" />
          <text x="196" y="4" font-size="12" font-weight="600" fill="#d97706">Ce que vous faites</text>
        </g>
      </svg>
    </div>
  </div>`;
}
