// Fonctions partagées par les pages de Boréal Courtage.

const session = {
  get token() { return localStorage.getItem('boreal.token'); },
  save(token) { localStorage.setItem('boreal.token', token); },
  clear() { localStorage.removeItem('boreal.token'); location.href = '/'; },
};

/** Appel JSON à l'API de la plateforme. `status` = 0 si le serveur est injoignable ; `data` = corps de la réponse. */
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
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* corps non JSON (proxy) */ }
  if (res.status === 401 && !path.startsWith('/auth/')) session.clear();
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(' ') : data.message;
    throw Object.assign(new Error(message || 'Erreur ' + res.status), { status: res.status, data });
  }
  return data;
}

const $ = (selector) => document.querySelector(selector);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, digits = 0) => Number(n).toLocaleString('fr-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' $';
const signed = (n) => `<span class="${n >= 0 ? 'gain' : 'loss'}">${n >= 0 ? '+' : '−'}${money(Math.abs(n))}</span>`;
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} %`;
const day = (iso) => new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });

/** Message bref en bas de l'écran, qui disparaît seul. */
function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
  el.setAttribute('role', 'status');
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}
