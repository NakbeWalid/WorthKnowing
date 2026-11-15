// Vue admin : tous les utilisateurs + détail, mis à jour en temps réel par le flux SSE.

let selectedId = null;

async function loadUsers(flashId) {
  const users = await api('GET', '/admin/users');
  $('#users').innerHTML = users.length ? users.map((u) => `
    <tr class="clickable ${u.id === selectedId ? 'selected' : ''} ${u.id === flashId ? 'flash' : ''}" data-id="${u.id}">
      <td><b>${esc(u.name)}</b><br><span class="small muted">${esc(u.email)}</span></td>
      <td>${statusBadge(u.status)}</td>
      <td class="right"><b>${u.drift}</b></td><td class="right">${u.rules}</td><td class="right">${u.trades}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">Aucun utilisateur inscrit.</td></tr>';
  document.querySelectorAll('#users tr.clickable').forEach((row) => (row.onclick = () => {
    selectedId = row.dataset.id;
    loadUsers(); loadDetail();
  }));
}

async function loadDetail() {
  if (!selectedId) return;
  const { user, portfolio, trades } = await api('GET', '/admin/users/' + selectedId);
  const p = user.profile;
  $('#detail').innerHTML = `
    <div class="card">
      <h2>${esc(user.name)} ${statusBadge(user.status)} <span class="badge ${user.drift.score >= user.driftThreshold ? 'danger' : 'grey'}">dérive ${user.drift.score} / 100</span></h2>
      <p class="small muted">${esc(user.email)} · inscrit le ${user.createdAt.slice(0, 10)}
        ${p ? ` · ${p.evaluationCount} évaluation(s), dernière le ${p.evaluatedAt.slice(0, 10)}` : ''}
        · portefeuille ${money(portfolio.total)}
        ${Object.entries(user.preferences).map(([k, v]) => ` · ${esc(k)} : ${esc(v)}`).join('')}</p>
      ${p ? `<div class="grid">
        <div>
          <h3>Paramètres du profil</h3>
          <table><tr><th>Paramètre</th><th class="right">Déclaré</th><th class="right">Référence</th><th class="right">Actuel</th></tr>
          ${Object.keys(PARAM_LABELS).map((k) => `<tr><td>${PARAM_LABELS[k]}</td><td class="right">${p.declared[k]}</td>
            <td class="right">${p.baseline[k]}</td>
            <td class="right"><b class="${Math.abs(p.current[k] - p.baseline[k]) >= 10 ? 'neg' : ''}">${p.current[k]}</b></td></tr>`).join('')}
          </table>
        </div>
        <div>
          <h3>Règles auto-définies</h3>
          ${user.rules.map((r) => `<div class="rule"><span class="badge grey">${PARAM_LABELS[r.param]}</span>
            <p style="margin:6px 0 0">${esc(r.text.replace('{seuil}', r.threshold))}</p></div>`).join('') || '<p class="muted">Aucune règle.</p>'}
        </div>
      </div>` : '<p class="muted">Évaluation initiale non terminée.</p>'}
      <h3 style="margin-top:18px">Historique des trades et enquêtes</h3>
      ${trades.map((t) => `
        <details>
          <summary>
            <span class="badge ${t.side === 'buy' ? '' : 'grey'}">${t.side === 'buy' ? 'Achat' : 'Vente'}</span>
            <span class="grow"><b>${esc(t.ticker)}</b> · ${money(t.amount)}
              <span class="muted small">· marché du ${t.marketDate} · envoyé à ${new Date(t.createdAt).toLocaleTimeString('fr-CA')} · décision en ${(t.decisionTimeMs / 1000).toFixed(0)} s</span></span>
            ${t.overrodeRules ? '<span class="badge danger">règle outrepassée</span>' : ''}
            <span class="muted small">dérive ${t.investigation.driftBefore} → ${t.investigation.driftAfter}</span>
          </summary>
          ${t.note ? `<p class="quote">${esc(t.note)}</p>` : ''}
          ${investigationHtml(t.investigation)}
        </details>`).join('') || '<p class="muted">Aucun trade.</p>'}
    </div>`;
}

/** Chaque étape du pipeline (trade → enquête → profil) arrive ici et rafraîchit la vue. */
function connect() {
  const source = new EventSource('/api/admin/stream?token=' + session.token);
  source.onopen = () => { $('#live').className = 'badge'; $('#live').textContent = '● en direct'; };
  source.onerror = () => { $('#live').className = 'badge danger'; $('#live').textContent = '● déconnecté'; };
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    const feed = $('#feed');
    if (feed.querySelector('p')) feed.innerHTML = '';
    feed.insertAdjacentHTML('afterbegin',
      `<div class="flash"><time>${new Date(event.at).toLocaleTimeString('fr-CA')}</time><b>${esc(event.userName)}</b> — ${esc(event.message)}</div>`);
    loadUsers(event.userId);
    if (event.userId === selectedId) loadDetail();
  };
}

(async () => {
  if (!session.token) return (location.href = '/');
  const me = await api('GET', '/me');
  if (me.role !== 'admin') return route(me);
  await loadUsers();
  connect();
})();
