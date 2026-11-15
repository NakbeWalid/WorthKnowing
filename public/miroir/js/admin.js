// Vue admin : les personas regroupés par caractère (portraits), leur fiche détaillée dans un tiroir,
// et le fil d'activité — tout est mis à jour en temps réel par le flux SSE.

let users = [];
let archFilter = 'all';
let detail = null; // tiroir ouvert : { id, el }
let animated = false; // l'apparition échelonnée ne joue qu'au premier affichage

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

// ------------------------------------------------------------------ Galerie
async function loadUsers(flashId) {
  users = await api('GET', '/admin/users');
  users.forEach((u) => (u.arch = UI.archetypeOf(u.profile)));
  $('#updated').textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`;

  const flagged = users.filter((u) => u.status === 'reevaluation_required').length;
  const kpis = [
    ['Personas', users.length, 'users'],
    ['Liés à un courtier', users.filter((u) => u.linked).length, 'link'],
    ['Réévaluation requise', flagged, 'alert'],
    ['Ordres enquêtés', users.reduce((s, u) => s + u.trades, 0), 'activity'],
  ];
  $('#kpis').innerHTML = kpis.map(([label, v, ico], i) => `<div class="widget ${i === 2 && v ? 'red' : ''}">
    <div class="widget-head" style="margin-bottom:4px"><h3>${label}</h3>${UI.icon(ico, 'sm')}</div><div class="kpi">${v}</div></div>`).join('');

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
    $('#gallery').innerHTML = `<div class="widget flat"><div class="empty-state">${UI.icon('users')}<p>Aucun persona pour l’instant.</p></div></div>`;
    return;
  }
  const groups = Object.keys(UI.ARCHETYPES)
    .filter((k) => archFilter === 'all' || k === archFilter)
    .map((k) => [k, users.filter((u) => u.arch.key === k)])
    .filter(([, list]) => list.length);
  $('#gallery').innerHTML = groups.map(([k, list]) => {
    const a = UI.ARCHETYPES[k];
    return `<section class="arch-section">
      <div class="arch-head"><div class="emblem" style="background:${a.color}">${UI.icon(a.glyph)}</div>
        <div><h3>${esc(a.name)}</h3><p>${esc(a.line)}</p></div><span class="count">${list.length}</span></div>
      <div class="persona-grid ${animated ? '' : 'stagger'}">${list.map((u) => personaCard(u, flashId)).join('')}</div>
    </section>`;
  }).join('');
  animated = true;
  document.querySelectorAll('.persona-card').forEach((c) => {
    const open = () => openDetail(c.dataset.id);
    c.onclick = open;
    c.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}

function personaCard(u, flashId) {
  const hot = u.drift >= 60 || u.status === 'reevaluation_required';
  return `<article class="persona-card ${hot ? 'hot' : ''} ${u.id === flashId ? 'flash' : ''}" data-id="${esc(u.id)}" tabindex="0" style="--tint:${u.arch.tint}">
    <div class="pc-top">${u.linked ? `<span class="pill gain" title="Lié à un courtier">${UI.icon('link', 'sm')}</span>` : ''}
      ${u.status === 'reevaluation_required' ? `<span class="pill red" title="Réévaluation requise">${UI.icon('alert', 'sm')}</span>` : ''}</div>
    <span class="portrait">${UI.portrait(u.id, u.arch, 68)}</span>
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

// ------------------------------------------------------------------ Fiche d'un persona (tiroir)
let detailCall = 0;
async function openDetail(id) {
  const call = ++detailCall;
  const data = await api('GET', '/admin/users/' + id);
  if (call !== detailCall) return; // une demande plus récente a pris le relais
  const u = users.find((x) => x.id === id);
  const arch = u?.arch ?? UI.archetypeOf(data.user.profile?.current);
  const head = `<span class="portrait">${UI.portrait(id, arch, 48)}</span>
    <div><div class="eyebrow" style="color:${arch.color}">${esc(arch.name)}</div><h2>${esc(data.user.name)}</h2></div>`;
  if (detail?.id === id && document.body.contains(detail.el)) {
    detail.el.querySelector('.drawer-body').innerHTML = detailHtml(data);
  } else {
    const d = UI.drawer(head, detailHtml(data));
    detail = { id, el: d.el };
  }
  wireDetail(data);
}

function detailHtml({ user, trades }) {
  const p = user.profile;
  const prefs = Object.entries(user.preferences)
    .map(([k, v]) => `<dt>${esc(prefLabels[k]?.text ?? k)}</dt><dd>${esc(prefLabels[k]?.options[v] ?? v)}</dd>`).join('');
  const expertise = { novice: 'novice', intermediate: 'intermédiaire', advanced: 'avancée' }[user.cvProfile?.expertise];
  return `
    <div class="row wrap" style="gap:6px">${statusBadge(user.status)}
      ${user.link ? `<span class="pill gain">${UI.icon('link', 'sm')}${esc(user.link.partner)}</span>` : '<span class="pill outline">aucun courtier</span>'}
      ${expertise ? `<span class="pill outline">expertise ${expertise}</span>` : ''}</div>
    <p class="tiny faint" style="margin-top:10px">${esc(user.email)} · inscrit le ${esc(day(user.createdAt))}${p ? ` · ${p.evaluationCount} évaluation(s)` : ''}</p>

    <div class="grid g-2" style="margin-top:20px;gap:12px">
      <div class="widget tint" style="padding:16px">${UI.gauge(user.drift.score, user.driftThreshold)}</div>
      <div class="widget tint" style="padding:16px;display:grid;gap:8px;align-content:center">
        <div class="row between"><span class="small muted">Règles</span><b>${user.rules.length}</b></div>
        <div class="row between"><span class="small muted">Ordres</span><b>${trades.length}</b></div>
        <div class="row between"><span class="small muted">Outrepassées</span><b class="${user.drift.overrides ? 'loss' : ''}">${user.drift.overrides ?? 0}</b></div>
      </div>
    </div>

    ${p ? `
    <div class="inv-block" style="margin-top:26px"><h4>Profil</h4>
      <div class="chart-box" style="height:260px"><canvas id="adRadar"></canvas></div>
      <div class="legend" style="justify-content:center;margin:6px 0 14px"><span><i class="dash"></i>Déclaré</span><span><i style="background:var(--red)"></i>Actuel</span></div>
      <table class="param-table"><tr><th>Paramètre</th><th>Déclaré</th><th>Réf.</th><th>Actuel</th></tr>
        ${Object.keys(PARAM_LABELS).map((k) => `<tr><td>${PARAM_LABELS[k]}</td><td class="faint">${p.declared[k]}</td><td>${p.baseline[k]}</td>
          <td><b class="${Math.abs(p.current[k] - p.baseline[k]) >= 10 ? 'loss' : ''}">${p.current[k]}</b></td></tr>`).join('')}
      </table>
    </div>` : '<div class="notice ink" style="margin-top:22px">' + UI.icon('hourglass', 'sm') + '<span>Évaluation initiale non terminée.</span></div>'}

    ${prefs ? `<div class="inv-block"><h4>Déclarations</h4><dl class="facts">${prefs}</dl></div>` : ''}

    <div class="inv-block"><h4>Règles auto-définies</h4>
      ${user.rules.map((r) => `<div class="rule-card" style="padding:14px 16px"><span class="pill">${PARAM_LABELS[r.param]}</span>
        <q style="font-size:15px">${esc(r.text.replace('{seuil}', r.threshold ?? ''))}</q></div>`).join('') || '<p class="small faint">Aucune règle.</p>'}
    </div>

    <div class="inv-block"><h4>Ordres reçus</h4>
      ${trades.length ? `<div class="chart-box" style="height:170px;margin-bottom:8px"><canvas id="adDrift"></canvas></div>
        <div class="list" id="adTrades">${trades.map((t) => tradeRow(t)).join('')}</div>` : '<p class="small faint">Aucun ordre reçu.</p>'}
    </div>`;
}

function wireDetail({ user, trades }) {
  const el = detail?.el;
  if (!el) return;
  UI.animateGauges(el);
  if (user.profile) UI.radar(el.querySelector('#adRadar'), user.profile.declared, user.profile.current, { aLabel: 'Déclaré', bLabel: 'Actuel' });
  if (trades.length) {
    driftTimeline(el.querySelector('#adDrift'), trades, user.driftThreshold);
    bindTradeRows(el.querySelector('#adTrades'), trades,
      (t) => `Reçu à ${new Date(t.createdAt).toLocaleTimeString('fr-CA')} · décision en ${(t.decisionTimeMs / 1000).toFixed(0)} s`);
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
    if (feed.querySelector('.empty-state')) feed.innerHTML = '';
    feed.insertAdjacentHTML('afterbegin', `<div class="feed-item"><span class="ft"></span><div>
      <time>${new Date(event.at).toLocaleTimeString('fr-CA')}</time><b>${esc(event.userName)}</b> <span class="muted">${esc(event.message)}</span></div></div>`);
    while (feed.children.length > 100) feed.lastElementChild.remove(); // le fil ne grossit pas sans fin
    scheduleReload(event.userId);
  };
}

(async () => {
  if (!session.token) return (location.href = '/');
  mountNav('', '<span class="pill ink">Admin</span>');
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
