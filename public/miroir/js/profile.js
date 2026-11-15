// Espace WorthKnowing, en trois onglets :
//   Tableau de bord — score de dérive, profil d'investisseur, suivi des ordres analysés ;
//   Mes règles      — ajouter, modifier, retirer ses règles (des phrases, sans seuil) ;
//   Compte          — le compte, la clé WorthKnowing (user id) et les plateformes de trading.

// ------------------------------------------------------------------ Onglets (mémorisés dans l'adresse : #regles, #profil)
const TABS = ['reflet', 'regles', 'profil'];
mountNav(`<button role="tab" data-tab="reflet">Tableau de bord</button>
  <button role="tab" data-tab="regles">Mes règles<span class="count" id="rulesCount"></span></button>
  <button role="tab" data-tab="profil">Compte</button>`);
function showTab(name, push = true) {
  const tab = TABS.includes(name) ? name : 'reflet';
  TABS.forEach((t) => {
    const el = $(`#tab-${t}`);
    const on = t === tab;
    el.classList.toggle('hidden', !on);
    if (on) { el.classList.remove('view-enter'); void el.offsetWidth; el.classList.add('view-enter'); }
    document.querySelector(`.nav-links [data-tab="${t}"]`).setAttribute('aria-selected', String(on));
  });
  if (push) history.replaceState(null, '', tab === 'reflet' ? location.pathname : '#' + tab);
}
document.querySelectorAll('.nav-links [data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { showTab(go.dataset.goto); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});
window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));
showTab(location.hash.slice(1), false);

// ------------------------------------------------------------------ Tableau de bord
async function refresh() {
  const me = await api('GET', '/me');
  if (me.role === 'admin' || !me.profile) return route(me);
  const trades = await api('GET', '/trades');
  const p = pending.get();

  setUser(me.name);
  $('#greeting').innerHTML = `Bonjour, <em>${esc(me.name)}</em>`;

  // Bandeau du haut : demande de liaison en attente, réévaluation exigée, ou retour au courtier.
  let top = '';
  if (p?.link) {
    top = `<div class="banner rise" style="background-color:var(--ink)">${UI.icon('link', 'lg')}
      <div class="grow"><h3>${esc(p.partner)} demande à lier votre profil</h3>
        <p>Il enverra vos ordres et votre portefeuille ; il recevra votre dérive et le texte de vos règles. Rien d’autre.</p>
        <div class="error" id="linkError" role="alert"></div></div>
      <button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.3)" id="refuse">Refuser</button>
      <button class="btn primary" id="allow">Autoriser ${UI.icon('arrowRight', 'sm')}</button></div>`;
  } else if (me.status === 'reevaluation_required' || me.drift.score >= me.driftThreshold) {
    top = `<div class="banner rise">${UI.icon('alert', 'lg')}
      <div class="grow"><h3>Seuil de dérive dépassé</h3>
        <p>Vos ordres sont suspendus chez votre courtier jusqu’à votre réévaluation.</p></div>
      <button class="btn white" onclick="location.href='/onboarding.html'">Refaire l’évaluation ${UI.icon('arrowRight', 'sm')}</button></div>`;
  } else if (p) {
    top = `<div class="notice ink rise" style="margin-bottom:24px;align-items:center">${UI.icon('check')}<span class="grow">Votre profil est à jour.</span>
      <button class="btn primary sm" id="goBack">Retourner à ${esc(p.partner)}</button></div>`;
  }
  $('#top').innerHTML = top;
  if ($('#allow')) {
    $('#allow').onclick = () => finishAndReturn().catch((err) => { $('#linkError').textContent = err.message; });
    $('#refuse').onclick = () => { pending.clear(); refresh(); };
  }
  if ($('#goBack')) $('#goBack').onclick = () => finishAndReturn();

  // Score de dérive
  $('#gauge').innerHTML = UI.gauge(me.drift.score, me.driftThreshold);
  UI.animateGauges($('#gauge'));
  $('#driftPill').innerHTML = statusBadge(me.status);
  $('#driftText').textContent = `Écart avec votre dernière évaluation.${me.drift.overrides ? ` ${me.drift.overrides} règle(s) outrepassée(s).` : ''}`;

  // Radar (déclaré / aujourd'hui) et barres miroir (référence / aujourd'hui)
  const { current, baseline, declared } = me.profile;
  UI.radar($('#radar'), declared || baseline, current || baseline, { aLabel: 'Déclaré', bLabel: 'Aujourd’hui' });
  $('#params').innerHTML = mirrorHead('Référence', 'Aujourd’hui')
    + Object.keys(PARAM_LABELS).map((k) => mirror(PARAM_LABELS[k], baseline[k], current[k])).join('');
  const expertise = { novice: 'novice', intermediate: 'intermédiaire', advanced: 'avancée' }[me.cvProfile?.expertise];
  $('#evaluated').innerHTML = `${UI.icon('calendar', 'sm')} Évalué le ${esc(day(me.profile.evaluatedAt))}${expertise ? ` · expertise ${expertise}` : ''}
    <button class="btn soft sm" style="margin-left:10px" onclick="location.href='/onboarding.html'">${UI.icon('refresh', 'sm')} Réévaluer</button>`;

  // Suivi des ordres : courbe de dérive + liste compacte (détail dans un tiroir)
  $('#driftChartBox').classList.toggle('hidden', !trades.length);
  driftTimeline($('#driftChart'), trades, me.driftThreshold);
  $('#history').innerHTML = trades.length
    ? trades.map((t) => tradeRow(t)).join('')
    : `<div class="empty-state">${UI.icon('activity')}<p>Aucun ordre analysé. ${me.link ? `Passez un ordre chez ${esc(me.link.partner)}.` : ''}</p></div>`;
  bindTradeRows($('#history'), trades);

  // Onglet Compte
  $('#account').innerHTML = `
    <dt>Nom</dt><dd>${esc(me.name)}</dd>
    <dt>Courriel</dt><dd>${esc(me.email)}</dd>
    <dt>Inscrit le</dt><dd>${esc(day(me.createdAt))}</dd>
    <dt>Évaluations</dt><dd>${me.profile.evaluationCount}</dd>
    <dt>État</dt><dd>${statusBadge(me.status)}</dd>`;
}

// ------------------------------------------------------------------ Mes règles : ajouter, modifier, retirer
let rulesData = null;

async function loadRules() {
  rulesData = await api('GET', '/rules');
  renderRules();
}

function renderRules() {
  const { rules, suggestions, maxRules } = rulesData;
  const full = rules.length >= maxRules;
  $('#rulesCount').textContent = rules.length || '';
  $('#addRuleBtn').innerHTML = `${UI.icon('plus', 'sm')} Nouvelle règle`;
  $('#addRuleBtn').disabled = full;
  $('#addRuleBtn').title = full ? `Maximum de ${maxRules} règles atteint` : '';
  $('#addRuleBtn').onclick = () => ruleForm();

  // Résumé sur le tableau de bord
  $('#rulesSummary').innerHTML = rules.length
    ? rules.slice(0, 4).map((r) => `<div class="list-item"><span class="avatar soft" style="width:30px;height:30px">${UI.icon('shield', 'sm')}</span>
        <div class="grow"><div class="small">${esc(r.text)}</div><div class="sub">${esc(r.label)}</div></div></div>`).join('')
      + (rules.length > 4 ? `<p class="tiny faint" style="margin-top:8px">+ ${rules.length - 4} autre(s)</p>` : '')
    : `<div class="empty-state">${UI.icon('shield')}<p>Aucune règle.</p><button class="btn soft sm" style="margin-top:12px" data-goto="regles">Créer une règle</button></div>`;

  // Liste complète
  $('#rules').innerHTML = rules.length
    ? `<div class="stagger">${rules.map((r) => `<div class="rule-card" data-id="${esc(r.id)}">
        <span class="pill">${esc(r.label)}</span>
        <q>${esc(r.text)}</q>
        <div class="trigger">${UI.icon('clock', 'sm')} Rappelée avant : ${esc(r.trigger)}</div>
        <div class="rule-actions">
          <button class="btn soft icon-only sm" data-edit title="Modifier" aria-label="Modifier">${UI.icon('edit', 'sm')}</button>
          <button class="btn soft icon-only sm" data-remove title="Retirer" aria-label="Retirer">${UI.icon('trash', 'sm')}</button></div>
      </div>`).join('')}</div>
      <p class="tiny faint" style="margin-top:14px">Modifier vos règles ne change pas votre score de dérive.</p>`
    : `<div class="widget flat"><div class="empty-state">${UI.icon('shield')}<p>Aucune règle pour l’instant.</p></div></div>`;

  $('#rules').querySelectorAll('.rule-card').forEach((el) => {
    const rule = rules.find((r) => r.id === el.dataset.id);
    el.querySelector('[data-edit]').onclick = () => ruleForm(rule);
    el.querySelector('[data-remove]').onclick = async () => {
      if (!(await UI.confirm('Retirer cette règle ?', `« ${esc(rule.text)} »`, { ok: 'Retirer', danger: true }))) return;
      try {
        await api('DELETE', `/rules/${encodeURIComponent(rule.id)}`);
        await loadRules();
        UI.toast('Règle retirée.', 'ok');
      } catch (err) { UI.alert('Erreur', esc(err.message)); }
    };
  });

  // Règles proposées : les comportements marqués qui n'ont pas encore de règle
  const proposed = suggestions.filter((s) => s.suggestion.recommended);
  $('#ruleSuggestions').innerHTML = proposed.length && !full ? `<div class="widget tint">
      <div class="widget-head"><h3>Suggérées pour vous</h3>${UI.icon('spark', 'sm')}</div>
      ${proposed.map((s) => `<div class="rule-card risk" style="margin-top:10px">
        <span class="pill red">${esc(s.label)}</span>
        <q style="font-size:15px">${esc(s.suggestion.text)}</q>
        <p class="tiny muted">${esc(s.suggestion.rationale)}</p>
        <div class="row" style="margin-top:12px"><button class="btn primary sm" data-adopt="${s.param}">${UI.icon('plus', 'sm')} Ajouter</button>
          <button class="btn ghost sm" data-adapt="${s.param}">Adapter</button></div>
      </div>`).join('')}</div>` : '';
  $('#ruleSuggestions').querySelectorAll('[data-adopt]').forEach((b) => (b.onclick = async () => {
    const s = suggestions.find((x) => x.param === b.dataset.adopt);
    b.disabled = true;
    try { await api('POST', '/rules', { param: s.param, text: s.suggestion.text }); await loadRules(); UI.toast('Règle ajoutée.', 'ok'); }
    catch (err) { UI.alert('Erreur', esc(err.message)); b.disabled = false; }
  }));
  $('#ruleSuggestions').querySelectorAll('[data-adapt]').forEach((b) => (b.onclick = () => {
    const s = suggestions.find((x) => x.param === b.dataset.adapt);
    ruleForm(null, { param: s.param, text: s.suggestion.text });
  }));
}

/** Fenêtre d'ajout (rule absent) ou de modification d'une règle. */
function ruleForm(rule = null, preset = {}) {
  const { suggestions } = rulesData;
  const param = rule?.param ?? preset.param ?? suggestions[0]?.param;
  const s = UI.sheet(`<div class="modal-head"><h2>${rule ? 'Modifier la règle' : 'Nouvelle règle'}</h2>
      <button class="close-x" data-close aria-label="Fermer">${UI.icon('x', 'sm')}</button></div>
    <form id="ruleForm">
      <div class="field"><label for="rfParam">Comportement encadré</label>
        <select id="rfParam">${suggestions.map((x) => `<option value="${x.param}" ${x.param === param ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        <span class="hint" id="rfWhen"></span></div>
      <div class="field"><label for="rfText">Ma règle</label>
        <textarea id="rfText" rows="3" maxlength="300" required placeholder="Écrivez votre règle, avec vos mots.">${esc(rule?.text ?? preset.text ?? '')}</textarea></div>
      ${rule ? '' : '<button type="button" class="btn link sm" id="rfSuggest" style="margin-top:8px">' + UI.icon('spark', 'sm') + ' Partir de la règle type</button>'}
      <div class="error" id="rfError" role="alert"></div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">${rule ? 'Enregistrer' : 'Ajouter'}</button></div>
    </form>`);
  const el = s.el;
  el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => s.close()));
  const chosen = () => suggestions.find((x) => x.param === el.querySelector('#rfParam').value);
  const when = () => { el.querySelector('#rfWhen').textContent = `Rappelée avant : ${chosen().trigger}.`; };
  el.querySelector('#rfParam').onchange = when;
  when();
  if (el.querySelector('#rfSuggest')) el.querySelector('#rfSuggest').onclick = () => { el.querySelector('#rfText').value = chosen().suggestion.text; el.querySelector('#rfText').focus(); };
  el.querySelector('#rfText').focus();
  el.querySelector('#ruleForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = { param: el.querySelector('#rfParam').value, text: el.querySelector('#rfText').value };
    try {
      if (rule) await api('PUT', `/rules/${encodeURIComponent(rule.id)}`, body);
      else await api('POST', '/rules', body);
      s.close();
      await loadRules();
      UI.toast(rule ? 'Règle modifiée.' : 'Règle ajoutée.', 'ok');
    } catch (err) { el.querySelector('#rfError').textContent = err.message; }
  };
}

// ------------------------------------------------------------------ Compte : clé WorthKnowing et plateformes de trading
// User id : vous représente auprès des plateformes. Créé automatiquement, toujours visible, seulement régénérable.
// Identifiant plateforme : votre identifiant chez une plateforme. Reçu automatiquement quand vous la liez,
// ou ajouté à la main pour qu'une autre plateforme puisse faire analyser vos ordres.
async function renderConnect() {
  const c = await api('GET', '/connect');
  $('#token').innerHTML = c.token
    ? `<div class="row" style="background:var(--cream);border-radius:12px;padding:6px 6px 6px 14px">
        <code class="grow small" style="word-break:break-all">${esc(c.token.value)}</code>
        <button class="btn soft icon-only sm" id="copyToken" title="Copier" aria-label="Copier">${UI.icon('copy', 'sm')}</button></div>
       <p class="tiny faint" style="margin-top:10px">Créée le ${esc(day(c.token.createdAt))}. À ne donner qu’à vos plateformes.</p>
       <button class="btn ghost sm" id="regenToken" style="margin-top:14px">${UI.icon('refresh', 'sm')} Régénérer</button><div class="error" id="tokenError" role="alert"></div>`
    : `<div class="empty-state">${UI.icon('key')}<p>Créée automatiquement à la fin de votre évaluation.</p></div>`;
  if ($('#copyToken')) $('#copyToken').onclick = () => navigator.clipboard.writeText(c.token.value).then(() => UI.toast('Clé copiée.', 'ok'));
  if ($('#regenToken')) $('#regenToken').onclick = async () => {
    const linked = c.platforms.find((p) => p.source === 'link');
    if (!(await UI.confirm('Régénérer votre clé ?', `L’ancienne cessera aussitôt de fonctionner.${linked ? ` ${esc(linked.name)} recevra la nouvelle automatiquement.` : ''}`, { ok: 'Régénérer', danger: true }))) return;
    try {
      const r = await api('POST', '/connect/token/regenerate');
      if (r.manualPlatforms.length) UI.alert('Nouvelle clé créée', `Donnez-la à : ${esc(r.manualPlatforms.join(', '))}.`);
      renderConnect();
    } catch (err) { $('#tokenError').textContent = err.message; }
  };

  $('#platforms').innerHTML = `
    ${c.platforms.length ? `<div class="list">${c.platforms.map((p) => `<div class="list-item">
        <div class="ticker-badge">${esc(UI.initials(p.name))}</div>
        <div class="grow"><div class="title">${esc(p.name)} ${p.source === 'link' ? '<span class="pill gain" style="margin-left:6px"><span class="dot"></span>liée</span>' : '<span class="pill" style="margin-left:6px">manuelle</span>'}</div>
          <div class="sub">Identifiant : <code>${esc(p.accountId)}</code></div></div>
        ${p.source === 'link' ? `<button class="btn ghost sm" data-unlink="${esc(p.name)}">${UI.icon('unlink', 'sm')} Retirer l’accès</button>`
          : `<button class="btn ghost sm" data-remove="${esc(p.id)}">Retirer</button>`}</div>`).join('')}</div>`
      : `<div class="empty-state">${UI.icon('link')}<p>Aucune plateforme. Activez WorthKnowing depuis votre courtier, ou ajoutez-en une.</p></div>`}
    ${c.token ? `<form id="addPlatform" class="row wrap" style="margin-top:18px;align-items:flex-end;gap:12px">
      <div class="field grow" style="margin:0;min-width:180px"><label for="pfName">Plateforme</label><input id="pfName" maxlength="60" placeholder="ex. Wealthsimple" required></div>
      <div class="field grow" style="margin:0;min-width:180px"><label for="pfAccount">Mon identifiant chez elle</label><input id="pfAccount" maxlength="100" required></div>
      <button class="btn">${UI.icon('plus', 'sm')} Ajouter</button>
    </form><div class="error" id="pfError" role="alert"></div>` : ''}`;
  $('#platforms').querySelectorAll('[data-unlink]').forEach((b) => (b.onclick = async () => {
    if (!(await UI.confirm(`Retirer l’accès de ${esc(b.dataset.unlink)} ?`, 'Vos ordres n’y seront plus analysés.', { ok: 'Retirer', danger: true }))) return;
    await api('DELETE', '/link').catch((err) => UI.alert('Erreur', esc(err.message)));
    refresh().catch(() => {}); renderConnect().catch(() => {});
  }));
  $('#platforms').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!(await UI.confirm('Retirer cette plateforme ?', 'Ses ordres ne seront plus analysés.', { ok: 'Retirer', danger: true }))) return;
    await api('DELETE', `/connect/platforms/${encodeURIComponent(b.dataset.remove)}`).catch((err) => UI.alert('Erreur', esc(err.message)));
    renderConnect();
  }));
  if ($('#addPlatform')) $('#addPlatform').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/connect/platforms', { name: $('#pfName').value, accountId: $('#pfAccount').value });
      renderConnect();
      UI.toast('Plateforme ajoutée.', 'ok');
    } catch (err) { $('#pfError').textContent = err.message; }
  };
}

// ------------------------------------------------------------------ Démarrage
(async () => {
  if (!session.token) return (location.href = '/');
  try {
    await refresh();
    await Promise.all([loadRules(), renderConnect()]);
  } catch (err) {
    $('#top').innerHTML = `<div class="banner">${UI.icon('alert', 'lg')}<div class="grow"><h3>Chargement impossible</h3><p>${esc(err.message)}</p></div>
      <button class="btn white" onclick="location.reload()">Réessayer</button></div>`;
  }
})();
