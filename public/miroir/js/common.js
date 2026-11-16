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
const signed = (n) => `<span class="${n >= 0 ? 'gain' : 'loss'} num">${n >= 0 ? '+' : '−'}${money(Math.abs(n))}</span>`;
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} %`;
const day = (iso) => new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

const PARAM_LABELS = {
  riskTolerance: 'Appétit pour le risque', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »',
  concentration: 'Concentration', impulsivity: 'Impulsivité', newsSensitivity: 'Sensibilité aux nouvelles',
};
const STATUS = {
  onboarding: ['En évaluation', ''], active: ['Profil actif', 'gain'], reevaluation_required: ['Réévaluation requise', 'red'],
};
const statusBadge = (s) => `<span class="pill ${STATUS[s][1]}"><span class="dot"></span>${STATUS[s][0]}</span>`;

/** Légende des barres miroir : nomme les deux côtés de l'axe. */
const mirrorHead = (left, right) => `<div class="mirror-legend"><span>${left}</span><span>${right}</span></div>`;

/** Une ligne du miroir : `reference` à gauche de l'axe, `value` à droite (rouge si l'écart ≥ 10). */
function mirror(label, reference, value, note = '') {
  const d = value - reference;
  const hot = Math.abs(d) >= 10;
  return `<div class="mirror">
    <div class="m-label"><span>${label}</span><span class="row" style="gap:8px">${note ? `<span class="tiny faint">${note}</span>` : ''}
      ${d ? `<span class="delta ${hot ? 'loss' : 'faint'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>` : ''}</span></div>
    <div class="half left"><i style="width:${reference}%"></i><b>${reference}</b></div>
    <div class="axis"></div>
    <div class="half right"><i class="${hot ? 'hot' : ''}" style="width:${value}%"></i><b>${value}</b></div>
  </div>`;
}

/** Emplacement d'un graphique Chart.js (le canvas est rempli après insertion dans la page). */
const canvasBox = (id, height = 220) => `<div class="chart-box" style="height:${height}px"><canvas id="${id}"></canvas></div>`;

/** Barre du haut commune aux pages connectées. */
function mountNav(tabsHtml = '', extra = '') {
  const nav = document.querySelector('header.nav');
  nav.innerHTML = `${UI.logo('wk', { href: '/' })}${tabsHtml ? `<nav class="nav-links" role="tablist">${tabsHtml}</nav>` : ''}
    <span class="spacer"></span><span class="pill outline demo-pill" title="Aucune transaction réelle, aucun conseil financier">Simulation</span>${extra}
    <div class="user-chip"><span id="hello"></span><div class="avatar ink" id="avatar">·</div></div>
    <button class="btn soft icon-only" id="logout" title="Déconnexion" aria-label="Déconnexion">${UI.icon('logout', 'sm')}</button>`;
  $('#logout').onclick = () => session.clear();
}
const setUser = (name) => { $('#hello').textContent = name; $('#avatar').textContent = UI.initials(name); };
