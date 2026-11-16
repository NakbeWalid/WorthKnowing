// Vue admin : les personas regroupés par caractère (portraits), la fiche de chacun dans une fenêtre centrée
// (enquêtes des agents, profil, règles), et le fil d'activité — tout est mis à jour en temps réel par le flux SSE.

let users = [];
let archFilter = 'all';
let animated = false; // l'apparition échelonnée ne joue qu'au premier affichage
let detail = null; // fiche ouverte : { id, el, tab, tradeId, data }

/** Libellés français des réponses factuelles du questionnaire (chargés une fois). */
let prefLabels = {};
async function loadPrefLabels() {
  const questions = await api('GET', '/evaluation/questions');
  for (const q of questions.filter((x) => x.kind === 'info')) {
    prefLabels[q.id] = { text: q.text, options: Object.fromEntries(q.options.map((o) => [o.id, o.label])) };
  }
}

function setLive(ok, text) {
  $('#live').className = 'pill ' + (ok ? 'red' : '');
  $('#live').innerHTML = `<span class="dot ${ok ? 'live' : ''}"></span>${esc(text)}`;
}

/** Chaque type d'événement du pipeline a son icône et sa couleur (celles de l'agent concerné). */
const EVENT_STYLE = {
  'trade.received': ['arrowDown', '#c98a2b'], 'investigation.completed': ['spark', '#d7001f'], 'profile.updated': ['target', '#1c7a4c'],
  'rule.respected': ['shield', '#6a3fa0'], 'rules.updated': ['edit', '#6a3fa0'], 'evaluation.completed': ['check', '#14716f'],
  'user.registered': ['user', '#9aa3c7'], 'link.created': ['link', '#14716f'], 'link.revoked': ['unlink', '#84102f'], 'drift.reset': ['refresh', '#1c7a4c'],
};

// ------------------------------------------------------------------ Galerie
async function loadUsers(flashId) {
  users = await api('GET', '/admin/users');
  users.forEach((u) => (u.arch = UI.archetypeOf(u.profile)));

  const flagged = users.filter((u) => u.status === 'reevaluation_required').length;
  const kpis = [
    ['Personas', users.length, 'users', ''],
    ['Liés à un courtier', users.filter((u) => u.linked).length, 'link', ''],
    ['Réévaluation requise', flagged, 'alert', flagged ? 'brand' : ''],
    ['Ordres enquêtés', users.reduce((s, u) => s + u.trades, 0), 'activity', ''],
  ];
  $('#kpis').innerHTML = kpis.map(([label, v, ico, cls]) => `<div class="widget ${cls}">
      <div class="widget-head" style="margin-bottom:2px"><h3>${label}</h3>${UI.icon(ico, 'sm')}</div><div class="kpi">${v}</div></div>`).join('')
    + `<div class="widget night team"><div class="widget-head" style="margin-bottom:0"><h3>L’équipe d’agents sur chaque ordre</h3><span class="pill glass"><span class="dot live"></span>en service</span></div>
      ${UI.agents(Object.keys(UI.AGENTS), { size: 'sm', dark: true, mode: 'working' })}</div>`;

  // Filtre par caractère : seulement ceux présents.
  const present = Object.keys(UI.ARCHETYPES).filter((k) => users.some((u) => u.arch.key === k));
  if (archFilter !== 'all' && !present.includes(archFilter)) archFilter = 'all';
  $('#archFilter').innerHTML = `<button class="chip ${archFilter === 'all' ? 'on' : ''}" data-arch="all">Tous · ${users.length}</button>`
    + present.map((k) => `<button class="chip ${archFilter === k ? 'on' : ''}" data-arch="${k}"><i style="background:${UI.ARCHETYPES[k].color}"></i>${esc(UI.ARCHETYPES[k].name)}</button>`).join('');
  $('#archFilter').querySelectorAll('[data-arch]').forEach((b) => (b.onclick = () => {
    archFilter = b.dataset.arch;
    $('#archFilter').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    animated = false;
    renderGallery();
  }));

  renderGallery(flashId);
}

function renderGallery(flashId) {
  if (!users.length) {
    $('#gallery').innerHTML = `<div class="empty-state">${UI.icon('users')}<p>Aucun persona pour l’instant.</p></div>`;
    return;
  }
  const groups = Object.keys(UI.ARCHETYPES)
    .filter((k) => archFilter === 'all' || k === archFilter)
    .map((k) => [k, users.filter((u) => u.arch.key === k)])
    .filter(([, list]) => list.length);
  $('#gallery').innerHTML = '<div class="arch-wrap">' + groups.map(([k, list]) => {
    const a = UI.ARCHETYPES[k];
    return `<section class="arch-section" style="--n:${Math.min(list.length, 5)}">
      <div class="arch-head"><div class="emblem" style="--c:${a.color}">${UI.icon(a.glyph)}</div>
        <div><h3>${esc(a.name)}</h3><p>${esc(a.line)}</p></div><span class="count">${list.length}</span></div>
      <div class="persona-grid ${animated ? '' : 'stagger'}">${list.map((u) => personaCard(u, flashId)).join('')}</div>
    </section>`;
  }).join('') + '</div>';
  animated = true;
  document.querySelectorAll('.persona-card').forEach((c) => {
    const open = () => openDetail(c.dataset.id);
    c.onclick = open;
    c.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}

function personaCard(u, flashId) {
  const hot = u.drift >= 60 || u.status === 'reevaluation_required';
  return `<article class="persona-card ${hot ? 'hot' : ''} ${u.id === flashId ? 'flash' : ''}" data-id="${esc(u.id)}" tabindex="0" style="--tint:${u.arch.tint};--c:${u.arch.color}">
    <div class="pc-top">${u.linked ? `<span class="pill gain" title="Lié à un courtier">${UI.icon('link', 'sm')}</span>` : ''}
      ${u.status === 'reevaluation_required' ? `<span class="pill red" title="Réévaluation requise">${UI.icon('alert', 'sm')}</span>` : ''}</div>
    <span class="portrait">${UI.portrait(u.id, u.arch, 58)}</span>
    <h4>${esc(u.name)}</h4>
    <div class="email">${esc(u.email)}</div>
    <div class="mini-drift" title="Dérive ${u.drift} / 100"><i style="width:${u.drift}%"></i></div>
    <div class="pc-stats">
      <div><b class="drift">${u.drift}</b><span>dérive</span></div>
      <div><b>${u.rules}</b><span>règles</span></div>
      <div><b>${u.trades}</b><span>ordres</span></div>
    </div>
  </article>`;
}

// ------------------------------------------------------------------ Fiche d'un persona (fenêtre centrée)
let detailCall = 0;
async function openDetail(id) {
  const call = ++detailCall;
  const data = await api('GET', '/admin/users/' + id);
  if (call !== detailCall) return; // une demande plus récente a pris le relais
  const same = detail?.id === id && document.body.contains(detail.el);
  if (!same) {
    const s = UI.sheet('<div class="pd" id="pd"></div>', { size: 'xl', onClose: () => { detail = null; } });
    detail = { id, el: s.el, close: s.close, tab: data.trades.length ? 'enquetes' : 'profil', tradeId: data.trades[0]?.id ?? null };
  }
  detail.data = data;
  if (!data.trades.some((t) => t.id === detail.tradeId)) detail.tradeId = data.trades[0]?.id ?? null;
  renderDetail();
}

function renderDetail() {
  const { user, trades } = detail.data;
  const u = users.find((x) => x.id === detail.id);
  const arch = u?.arch ?? UI.archetypeOf(user.profile?.current);
  const expertise = { novice: 'novice', intermediate: 'intermédiaire', advanced: 'avancée' }[user.cvProfile?.expertise];
  const tabs = [['enquetes', `Enquêtes · ${trades.length}`], ['profil', 'Profil'], ['regles', `Règles · ${user.rules.length}`]];
  detail.el.querySelector('#pd').innerHTML = `
    <aside class="pd-side night">
      <div class="row" style="gap:14px"><span class="portrait">${UI.portrait(detail.id, arch, 64)}</span>
        <div><div class="eyebrow" style="color:rgba(255,255,255,.6)">${esc(arch.name)}</div><h2>${esc(user.name)}</h2></div></div>
      <p class="tiny muted">${esc(arch.line)}.</p>
      <div class="row wrap" style="gap:6px"><span class="pill glass"><span class="dot"></span>${STATUS[user.status][0]}</span>
        ${user.link ? `<span class="pill glass">${UI.icon('link', 'sm')}${esc(user.link.partner)}</span>` : '<span class="pill outline">aucun courtier</span>'}
        ${expertise ? `<span class="pill outline">expertise ${expertise}</span>` : ''}</div>
      <div style="margin:auto 0">${UI.gauge(user.drift.score, user.driftThreshold, { dark: true })}<p class="tiny muted" style="text-align:center;margin-top:4px">Score de dérive</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="stat-tile"><div class="kpi-label">Règles</div><div class="kpi">${user.rules.length}</div></div>
        <div class="stat-tile"><div class="kpi-label">Ordres</div><div class="kpi">${trades.length}</div></div>
        <div class="stat-tile"><div class="kpi-label">Écarts</div><div class="kpi">${user.drift.overrides ?? 0}</div></div>
      </div>
      <p class="tiny muted" style="overflow-wrap:anywhere">${esc(user.email)}<br>Inscrit le ${esc(day(user.createdAt))}${user.profile ? ` · ${user.profile.evaluationCount} évaluation(s)` : ''}</p>
    </aside>
    <div class="pd-main">
      <div class="pd-bar"><div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button role="tab" data-t="${k}" aria-selected="${k === detail.tab}">${label}</button>`).join('')}</div>
        <button class="close-x" data-x aria-label="Fermer">${UI.icon('x', 'sm')}</button></div>
      <div class="pd-content" id="pdContent"></div>
    </div>`;
  UI.animateGauges(detail.el);
  detail.el.querySelector('[data-x]').onclick = () => detail.close();
  detail.el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
    detail.tab = b.dataset.t;
    detail.el.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderDetailTab(true);
  }));
  renderDetailTab(false);
}

function renderDetailTab(animate) {
  const { user, trades } = detail.data;
  const box = detail.el.querySelector('#pdContent');
  const p = user.profile;
  if (animate) { box.classList.remove('view-enter'); void box.offsetWidth; box.classList.add('view-enter'); }

  if (detail.tab === 'enquetes') {
    if (!trades.length) { box.innerHTML = agentsIdle('Aucun ordre reçu pour ce persona. Les agents enquêteront dès le premier.'); return; }
    box.innerHTML = `<div class="trade-chips">${trades.map((t) => `<button class="trade-chip ${t.id === detail.tradeId ? 'on' : ''}" data-trade-id="${esc(t.id)}">
        ${sideIcon(t.side)}<b>${esc(t.ticker)}</b><span class="faint">${money(t.amount)}</span>${driftPill(t.investigation)}
        ${t.overrodeRules ? `<span class="loss">${UI.icon('alert', 'sm')}</span>` : ''}</button>`).join('')}</div>
      <div id="pdInv" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>`;
    const show = () => mountInvestigation(box.querySelector('#pdInv'), trades.find((t) => t.id === detail.tradeId), {
      compact: true, agent: detail.agent, onAgent: (k) => { detail.agent = k; },
      meta: (t) => `reçu à ${new Date(t.createdAt).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`,
    });
    box.querySelectorAll('[data-trade-id]').forEach((b) => (b.onclick = () => {
      detail.tradeId = b.dataset.tradeId;
      box.querySelectorAll('.trade-chip').forEach((x) => x.classList.toggle('on', x === b));
      show();
    }));
    show();
  } else if (detail.tab === 'profil') {
    box.innerHTML = p ? `<div class="pd-pad"><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:26px;height:100%">
        <div style="display:flex;flex-direction:column;min-height:0">
          <div class="row between"><h4 class="eyebrow">Déclaré et actuel</h4><div class="legend"><span><i class="dash"></i>Déclaré</span><span><i style="background:var(--red)"></i>Actuel</span></div></div>
          <div class="chart-box fill" style="min-height:240px"><canvas id="adRadar"></canvas></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
          <div><h4 class="eyebrow" style="margin-bottom:6px">Paramètres</h4>
          <table class="param-table"><tr><th>Paramètre</th><th>Déclaré</th><th>Réf.</th><th>Actuel</th></tr>
            ${Object.keys(PARAM_LABELS).map((k) => `<tr><td>${PARAM_LABELS[k]}</td><td class="faint">${p.declared[k]}</td><td>${p.baseline[k]}</td>
              <td><b class="${Math.abs(p.current[k] - p.baseline[k]) >= 10 ? 'loss' : ''}">${p.current[k]}</b></td></tr>`).join('')}
          </table></div>
          ${trades.length ? `<div style="flex:1;min-height:150px;display:flex;flex-direction:column"><h4 class="eyebrow" style="margin-bottom:6px">Dérive, ordre après ordre</h4>
            <div class="chart-box fill"><canvas id="adDrift"></canvas></div></div>` : ''}
        </div></div></div>`
      : `<div class="empty-state">${UI.icon('hourglass')}<p>Évaluation initiale non terminée.</p></div>`;
    if (p) UI.radar(box.querySelector('#adRadar'), p.declared, p.current, { aLabel: 'Déclaré', bLabel: 'Actuel' });
    if (p && trades.length) driftTimeline(box.querySelector('#adDrift'), trades, user.driftThreshold, {
      onSelect: (id) => { detail.tradeId = id; detail.tab = 'enquetes'; renderDetail(); },
    });
  } else {
    const prefs = Object.entries(user.preferences)
      .map(([k, v]) => `<dt>${esc(prefLabels[k]?.text ?? k)}</dt><dd>${esc(prefLabels[k]?.options[v] ?? v)}</dd>`).join('');
    box.innerHTML = `<div class="pd-pad"><div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:26px">
      <div><h4 class="eyebrow" style="margin-bottom:10px">Règles auto-définies</h4>
        ${user.rules.map((r) => `<div class="rule-card stacked"><span class="pill">${PARAM_LABELS[r.param]}</span>
          <q style="font-size:15px;margin-bottom:0">${esc(r.text.replace('{seuil}', r.threshold ?? ''))}</q></div>`).join('') || '<p class="small faint">Aucune règle.</p>'}</div>
      <div><h4 class="eyebrow" style="margin-bottom:10px">Ce que le persona a déclaré</h4>
        ${prefs ? `<dl class="facts">${prefs}</dl>` : '<p class="small faint">Aucune déclaration.</p>'}</div>
    </div></div>`;
  }
}

// ------------------------------------------------------------------ Temps réel
/** Rafraîchit la galerie et la fiche ouverte ; une erreur réseau ne casse pas le flux temps réel. */
function refreshAll(flashId, detailConcerned = true) {
  const open = detail && document.body.contains(detail.el) ? detail.id : null;
  Promise.all([loadUsers(flashId), open && detailConcerned ? openDetail(open) : null]).catch((err) => setLive(false, err.message));
}
/** Un trade émet 3 événements en quelques centaines de ms : on regroupe les rafraîchissements. */
let reloadTimer = null;
const flashIds = new Set();
function scheduleReload(flashId) {
  if (flashId) flashIds.add(flashId);
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    const ids = [...flashIds];
    flashIds.clear();
    // La fiche n'est rechargée que si l'événement concerne le persona affiché (ou après une reconnexion).
    refreshAll(ids.at(-1), !ids.length || ids.includes(detail?.id));
  }, 150);
}
/** Chaque étape du pipeline (trade → enquête → profil) arrive ici et rafraîchit la vue. */
let source = null;
function connect() {
  source?.close();
  source = new EventSource('/api/admin/stream?token=' + encodeURIComponent(session.token));
  source.onopen = () => {
    setLive(true, 'en direct');
    scheduleReload(); // rattrape les événements manqués pendant une coupure
  };
  source.onerror = async () => {
    setLive(false, 'déconnecté');
    // EventSource se reconnecte seul, sauf si le serveur a refusé (jeton expiré) : on vérifie, puis on relance.
    if (source.readyState !== EventSource.CLOSED) return;
    try { await api('GET', '/me'); } catch (err) { if (err.status !== 0) return; } // 401 : api() renvoie à la connexion
    setTimeout(connect, 5000);
  };
  source.onmessage = (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    const feed = $('#feed');
    feed.querySelector('.empty-state')?.remove();
    const [ico, color] = EVENT_STYLE[event.type] ?? ['activity', '#9aa3c7'];
    feed.insertAdjacentHTML('afterbegin', `<div class="feed-item"><span class="ft" style="--c:${color}">${UI.icon(ico)}</span><div>
      <time>${new Date(event.at).toLocaleTimeString('fr-CA')}</time><b>${esc(event.userName)}</b> <span class="muted">${esc(event.message)}</span></div></div>`);
    while (feed.children.length > 100) feed.lastElementChild.remove(); // le fil ne grossit pas sans fin
    scheduleReload(event.userId);
  };
}

(async () => {
  if (!session.token) return (location.href = '/');
  mountNav('', '<span class="pill ink">Admin</span>');
  $('#feedEmpty').innerHTML = `${UI.icon('radio')}<p>En attente d’événements. Chaque ordre reçu, chaque enquête et chaque mise à jour de profil s’affichera ici.</p>`;
  try {
    const me = await api('GET', '/me');
    if (me.role !== 'admin') return route(me);
    setUser(me.name);
    await loadPrefLabels().catch(() => {}); // sans libellés, on affiche les clés brutes
    await loadUsers();
  } catch (err) {
    setLive(false, err.message);
  }
  connect();
})();
