// Vue admin : tous les utilisateurs + détail, mis à jour en temps réel par le flux SSE.

let selectedId = null;

/** Libellés français des réponses factuelles du questionnaire (chargés une fois). */
let prefLabels = {};
async function loadPrefLabels() {
  const questions = await api('GET', '/evaluation/questions');
  for (const q of questions.filter((x) => x.kind === 'info')) {
    prefLabels[q.id] = { text: q.text, options: Object.fromEntries(q.options.map((o) => [o.id, o.label])) };
  }
}

async function loadUsers(flashId) {
  const users = await api('GET', '/admin/users');
  $('#users').innerHTML = users.length ? users.map((u) => `
    <tr class="clickable ${u.id === selectedId ? 'selected' : ''} ${u.id === flashId ? 'flash' : ''}" data-id="${esc(u.id)}">
      <td><b>${esc(u.name)}</b> ${u.linked ? '<span class="badge ok">lié</span>' : ''}<br><span class="small muted">${esc(u.email)}</span></td>
      <td>${statusBadge(u.status)}</td>
      <td class="right"><b>${u.drift}</b></td><td class="right">${u.rules}</td><td class="right">${u.trades}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">Aucun persona pour l’instant.</td></tr>';
  document.querySelectorAll('#users tr.clickable').forEach((row) => (row.onclick = () => {
    selectedId = row.dataset.id;
    refreshAll();
  }));
}

let detailCall = 0;
async function loadDetail() {
  if (!selectedId) return;
  const call = ++detailCall;
  const id = selectedId;
  const { user, trades } = await api('GET', '/admin/users/' + id);
  if (call !== detailCall || id !== selectedId) return; // une réponse plus récente (ou un autre utilisateur) a pris le relais
  const p = user.profile;
  const prefs = Object.entries(user.preferences)
    .map(([k, v]) => `<tr><td class="muted">${esc(prefLabels[k]?.text ?? k)}</td><td>${esc(prefLabels[k]?.options[v] ?? v)}</td></tr>`).join('');
  $('#detail').innerHTML = `
    <div class="card">
      <h2>${esc(user.name)} ${statusBadge(user.status)}
        <span class="badge ${user.drift.score >= user.driftThreshold ? 'danger' : 'grey'}">dérive ${user.drift.score} sur 100</span>
        ${user.link ? `<span class="badge ok">lié à ${esc(user.link.partner)}</span>` : '<span class="badge grey">aucun compte de courtage lié</span>'}</h2>
      <p class="small muted">${esc(user.email)}, inscrit le ${esc(day(user.createdAt))}.
        ${p ? `${p.evaluationCount} évaluation(s), la dernière le ${esc(day(p.evaluatedAt))}.` : ''}
        ${user.drift.overrides ? `Règles outrepassées depuis : ${user.drift.overrides}.` : ''}</p>
      ${p ? `
      <!-- Graphique Hexagonal 6 critères : what you think vs what you are -->
      ${hexagonChart(p.declared, p.current)}
      <div class="grid">
        <div>
          <h3>Paramètres du profil</h3>
          <table><tr><th>Paramètre</th><th class="right">Déclaré</th><th class="right">Référence</th><th class="right">Actuel</th></tr>
          ${Object.keys(PARAM_LABELS).map((k) => `<tr><td>${PARAM_LABELS[k]}</td><td class="right">${p.declared[k]}</td>
            <td class="right">${p.baseline[k]}</td>
            <td class="right"><b class="${Math.abs(p.current[k] - p.baseline[k]) >= 10 ? 'neg' : ''}">${p.current[k]}</b></td></tr>`).join('')}
          </table>
          ${prefs ? `<h3 style="margin-top:20px">Ce que le persona a déclaré</h3><table>${prefs}</table>` : ''}
          ${user.cvProfile?.expertise ? `<p class="small muted" style="margin-top:12px">Expertise en trading détectée au CV : ${{ novice: 'novice', intermediate: 'intermédiaire', advanced: 'avancée' }[user.cvProfile.expertise]} (contexte d'enquête sur les trades, n'affecte pas ce profil de référence).</p>` : ''}
        </div>
        <div>
          <h3>Règles auto-définies</h3>
          ${user.rules.map((r) => `<div class="rule"><span class="badge grey">${PARAM_LABELS[r.param]}</span>
            <p>${esc(r.text.replace('{seuil}', r.threshold))}</p></div>`).join('') || '<p class="empty">Aucune règle.</p>'}
        </div>
      </div>` : '<p class="empty">Évaluation initiale non terminée.</p>'}
      <h3 style="margin-top:22px">Ordres reçus et enquêtes</h3>
      ${trades.map((t) => tradeRow(t,
        `, reçu à ${new Date(t.createdAt).toLocaleTimeString('fr-CA')}, décision en ${(t.decisionTimeMs / 1000).toFixed(0)} s`)).join('')
        || '<p class="empty">Aucun ordre reçu.</p>'}
    </div>`;
}

/** Rafraîchit la liste et le détail ; une erreur réseau ne casse pas le flux temps réel. */
function refreshAll(flashId, detailConcerned = true) {
  Promise.all([loadUsers(flashId), detailConcerned ? loadDetail() : null]).catch((err) => {
    $('#live').className = 'badge danger';
    $('#live').textContent = '● ' + err.message;
  });
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
    // Le détail n'est rechargé que si l'événement concerne l'utilisateur affiché (ou après une reconnexion).
    refreshAll(ids.at(-1), !ids.length || ids.includes(selectedId));
  }, 150);
}
/** Chaque étape du pipeline (trade → enquête → profil) arrive ici et rafraîchit la vue. */
let source = null;
function connect() {
  source?.close();
  source = new EventSource('/api/admin/stream?token=' + encodeURIComponent(session.token));
  source.onopen = () => {
    $('#live').className = 'badge'; $('#live').textContent = '● en direct';
    scheduleReload(); // rattrape les événements manqués pendant une coupure
  };
  source.onerror = async () => {
    $('#live').className = 'badge danger'; $('#live').textContent = '● déconnecté';
    // EventSource se reconnecte seul, sauf si le serveur a refusé (jeton expiré) : on vérifie, puis on relance.
    if (source.readyState !== EventSource.CLOSED) return;
    try { await api('GET', '/me'); } catch (err) { if (err.status !== 0) return; } // 401 : api() renvoie à la connexion
    setTimeout(connect, 5000);
  };
  source.onmessage = (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    const feed = $('#feed');
    if (feed.querySelector('p')) feed.innerHTML = '';
    feed.insertAdjacentHTML('afterbegin',
      `<div class="flash"><time>${new Date(event.at).toLocaleTimeString('fr-CA')}</time><b>${esc(event.userName)}</b> — ${esc(event.message)}</div>`);
    while (feed.children.length > 100) feed.lastElementChild.remove(); // le fil ne grossit pas sans fin
    scheduleReload(event.userId);
  };
}
(async () => {
  if (!session.token) return (location.href = '/');
  try {
    const me = await api('GET', '/me');
    if (me.role !== 'admin') return route(me);
    await loadPrefLabels().catch(() => {}); // sans libellés, on affiche les clés brutes
    await loadUsers();
  } catch (err) {
    $('#live').className = 'badge danger'; $('#live').textContent = '● ' + err.message;
  }
  connect();
})();
