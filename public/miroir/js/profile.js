// Espace WorthKnowing, en trois onglets :
//   Tableau de bord — score de dérive, profil d'investisseur, ordres analysés ;
//   Mes règles      — ajouter, modifier, retirer ses règles (des phrases, sans seuil) ;
//   Profil          — le compte, la clé WorthKnowing (user id) et les plateformes de trading.

// ------------------------------------------------------------------ Onglets (mémorisés dans l'adresse : #regles, #profil)
const TABS = ['reflet', 'regles', 'profil'];
function showTab(name, push = true) {
  const tab = TABS.includes(name) ? name : 'reflet';
  TABS.forEach((t) => {
    $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
    $(`#tabbtn-${t}`).setAttribute('aria-selected', String(t === tab));
  });
  if (push) history.replaceState(null, '', tab === 'reflet' ? location.pathname : '#' + tab);
}
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { showTab(go.dataset.goto); window.scrollTo(0, 0); }
});
window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));
showTab(location.hash.slice(1), false);

// ------------------------------------------------------------------ Tableau de bord
async function refresh() {
  const me = await api('GET', '/me');
  if (me.role === 'admin' || !me.profile) return route(me);
  const trades = await api('GET', '/trades');
  const p = pending.get();

  $('#hello').textContent = `Bonjour ${me.name}`;

  // Bandeau du haut : demande de liaison en attente, réévaluation exigée, ou retour au courtier.
  let top = '';
  if (p?.link) {
    top = `<div class="card partner">
      <h2>${esc(p.partner)} demande à lier votre profil WorthKnowing</h2>
      <p>Si vous acceptez, ${esc(p.partner)} enverra à WorthKnowing vos ordres et la composition de votre portefeuille,
        et recevra l’état de votre profil, votre score de dérive et le texte de vos règles. Rien d’autre.</p>
      <div class="actions"><button class="primary" id="allow">Autoriser et retourner à ${esc(p.partner)}</button>
        <button id="refuse">Refuser</button></div>
      <div class="error" id="linkError" role="alert"></div></div>`;
  } else if (me.status === 'reevaluation_required' || me.drift.score >= me.driftThreshold) {
    top = `<div class="banner">
      <div>
        <b>Seuil de dérive dépassé (${me.drift.score} sur ${me.driftThreshold}).</b> Votre comportement s’est trop éloigné de votre profil de référence.<br>
        Vos ordres sont suspendus chez votre courtier jusqu’à ce que vous refassiez les mises en situation.
        Modifier vos règles ne remet pas la dérive à zéro.
      </div>
      <button class="primary" onclick="location.href='/onboarding.html'">Refaire l’évaluation</button>
    </div>`;
  } else if (p) {
    top = `<div class="card partner"><div class="row"><p style="margin:0">Votre profil est à jour.</p>
      <button class="primary" style="flex:none" id="goBack">Retourner à ${esc(p.partner)}</button></div></div>`;
  }
  $('#top').innerHTML = top;
  if ($('#allow')) {
    $('#allow').onclick = () => finishAndReturn().catch((err) => { $('#linkError').textContent = err.message; });
    $('#refuse').onclick = () => { pending.clear(); refresh(); };
  }
  if ($('#goBack')) $('#goBack').onclick = () => finishAndReturn();

  // Score de dérive
  $('#driftScore').textContent = me.drift.score;
  $('#driftNeedle').style.left = `calc(${me.drift.score}% - 2px)`;
  $('#driftLimit').style.left = me.driftThreshold + '%';
  $('#driftText').textContent = `Écart entre votre comportement récent et votre dernière évaluation. À ${me.driftThreshold}, une réévaluation est exigée.`
    + (me.drift.overrides ? ` Règles outrepassées depuis : ${me.drift.overrides}.` : '');

  // Hexagone 6 critères (ce que vous pensez / ce que vous êtes) et barres miroir
  const { current, baseline, declared } = me.profile;
  $('#hexagonContainer').innerHTML = hexagonChart(declared || baseline, current || baseline);
  $('#params').innerHTML = mirrorHead('À la dernière évaluation', 'Aujourd’hui')
    + Object.keys(PARAM_LABELS).map((k) => mirror(PARAM_LABELS[k], baseline[k], current[k])).join('');
  $('#evaluated').textContent = `Dernière évaluation le ${day(me.profile.evaluatedAt)} (${me.profile.evaluationCount} au total).`;

  // Expertise détectée au CV : contexte pour l'analyse des futurs trades, n'entre pas dans ce profil.
  const expertise = { novice: 'novice', intermediate: 'intermédiaire', advanced: 'avancée' }[me.cvProfile?.expertise];
  $('#enrichmentProfileBox').innerHTML = expertise
    ? `<p class="small muted">Expertise en trading détectée au CV : ${expertise}. Ce profil n’en tient pas compte ;
       elle sert uniquement à mettre en contexte l’analyse de vos ordres.</p>`
    : '';

  // Ordres analysés
  $('#history').innerHTML = trades.length
    ? trades.map((t) => tradeRow(t)).join('')
    : `<p class="empty">Aucun ordre analysé pour l’instant. ${me.link ? `Passez un ordre chez ${esc(me.link.partner)} : son enquête apparaîtra ici.` : ''}</p>`;

  // Onglet Profil : le compte
  $('#account').innerHTML = `
    <dt>Nom</dt><dd>${esc(me.name)}</dd>
    <dt>Courriel</dt><dd>${esc(me.email)}</dd>
    <dt>Inscrit le</dt><dd>${esc(day(me.createdAt))}</dd>
    <dt>État du profil</dt><dd>${statusBadge(me.status)}</dd>`;
}

// ------------------------------------------------------------------ Mes règles : ajouter, modifier, retirer
let rulesData = null;

async function loadRules() {
  rulesData = await api('GET', '/rules');
  renderRules();
}

function renderRules() {
  const { rules, suggestions, maxRules } = rulesData;
  $('#rulesCount').textContent = rules.length ? rules.length : '';

  // Résumé sur le tableau de bord
  $('#rulesSummary').innerHTML = rules.length
    ? `<ul class="plain">${rules.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>`
    : '<p class="empty">Aucune règle pour l’instant.</p>';

  // Liste complète
  $('#rules').innerHTML = rules.length
    ? rules.map((r) => `<div class="rule" data-id="${esc(r.id)}">
        <div class="rule-view">
          <span class="badge grey">${esc(r.label)}</span>
          <p>${esc(r.text)}</p>
          <p class="small muted">Rappelée avant : ${esc(r.trigger)}.</p>
          <div class="rule-actions"><button class="mini" data-edit>Modifier</button><button class="mini" data-remove>Retirer</button></div>
        </div>
      </div>`).join('')
    : '<p class="empty">Aucune règle pour l’instant. Ajoutez-en une ci-dessous.</p>';

  $('#rules').querySelectorAll('.rule').forEach((el) => {
    const rule = rules.find((r) => r.id === el.dataset.id);
    el.querySelector('[data-edit]').onclick = () => editRule(el, rule);
    el.querySelector('[data-remove]').onclick = async () => {
      if (!confirm(`Retirer cette règle ?\n\n« ${rule.text} »`)) return;
      try { rulesData = { ...rulesData, ...(await api('DELETE', `/rules/${encodeURIComponent(rule.id)}`)) }; await loadRules(); }
      catch (err) { alert(err.message); }
    };
  });

  // Formulaire d'ajout
  const select = $('#newRuleParam');
  const keep = select.value;
  select.innerHTML = suggestions.map((s) => `<option value="${s.param}">${esc(s.label)}</option>`).join('');
  if (keep) select.value = keep;
  const chosen = () => suggestions.find((s) => s.param === select.value);
  const when = () => { $('#newRuleWhen').textContent = `Rappelée avant : ${chosen().trigger}.`; };
  select.onchange = when;
  when();
  $('#useSuggestion').onclick = () => { $('#newRuleText').value = chosen().suggestion.text; $('#newRuleText').focus(); };
  const full = rules.length >= maxRules;
  $('#addRuleForm').querySelector('button.primary').disabled = full;
  if (full) $('#addRuleError').textContent = `Vous avez ${maxRules} règles, le maximum. Retirez-en une pour en ajouter.`;

  // Règles proposées : les comportements marqués qui n'ont pas encore de règle
  const proposed = suggestions.filter((s) => s.suggestion.recommended);
  $('#ruleSuggestions').innerHTML = proposed.length && !full ? `<div class="card quiet">
      <h2>Règles proposées</h2>
      <p class="small muted">D’après votre profil actuel, ces comportements gagneraient à être encadrés.</p>
      ${proposed.map((s) => `<div class="rule risk">
        <span class="badge warn">${esc(s.label)}</span>
        <p>${esc(s.suggestion.text)}</p>
        <p class="small muted">${esc(s.suggestion.rationale)}</p>
        <div class="rule-actions"><button class="mini" data-adopt="${s.param}">Ajouter cette règle</button>
          <button class="mini" data-adapt="${s.param}">L’adapter d’abord</button></div>
      </div>`).join('')}</div>` : '';
  $('#ruleSuggestions').querySelectorAll('[data-adopt]').forEach((b) => (b.onclick = async () => {
    const s = suggestions.find((x) => x.param === b.dataset.adopt);
    b.disabled = true;
    try { await api('POST', '/rules', { param: s.param, text: s.suggestion.text }); await loadRules(); }
    catch (err) { alert(err.message); b.disabled = false; }
  }));
  $('#ruleSuggestions').querySelectorAll('[data-adapt]').forEach((b) => (b.onclick = () => {
    const s = suggestions.find((x) => x.param === b.dataset.adapt);
    select.value = s.param; when();
    $('#newRuleText').value = s.suggestion.text;
    $('#newRuleText').focus();
  }));
}

/** Passe une règle en mode édition, sur place. */
function editRule(el, rule) {
  const { suggestions } = rulesData;
  el.innerHTML = `<form class="rule-edit">
    <label for="edit-param-${esc(rule.id)}">Comportement encadré</label>
    <select id="edit-param-${esc(rule.id)}">${suggestions.map((s) => `<option value="${s.param}" ${s.param === rule.param ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
    <label for="edit-text-${esc(rule.id)}">Ma règle</label>
    <textarea id="edit-text-${esc(rule.id)}" rows="2" maxlength="300" required>${esc(rule.text)}</textarea>
    <div class="error" role="alert"></div>
    <div class="rule-actions"><button class="mini primary">Enregistrer</button><button type="button" class="mini" data-cancel>Annuler</button></div>
  </form>`;
  const form = el.querySelector('form');
  form.querySelector('textarea').focus();
  form.querySelector('[data-cancel]').onclick = renderRules;
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', `/rules/${encodeURIComponent(rule.id)}`, { param: form.querySelector('select').value, text: form.querySelector('textarea').value });
      await loadRules();
    } catch (err) { form.querySelector('.error').textContent = err.message; }
  };
}

$('#addRuleForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#addRuleError').textContent = '';
  try {
    await api('POST', '/rules', { param: $('#newRuleParam').value, text: $('#newRuleText').value });
    $('#newRuleText').value = '';
    await loadRules();
  } catch (err) { $('#addRuleError').textContent = err.message; }
};

// ------------------------------------------------------------------ Profil : clé WorthKnowing et plateformes de trading
// User id : vous représente auprès des plateformes. Créé automatiquement, toujours visible, seulement régénérable.
// Identifiant plateforme : votre identifiant chez une plateforme. Reçu automatiquement quand vous la liez,
// ou ajouté à la main pour qu'une autre plateforme puisse faire analyser vos ordres.
async function renderConnect() {
  const c = await api('GET', '/connect');
  $('#token').innerHTML = c.token
    ? `<div class="row"><code class="key">${esc(c.token.value)}</code><button class="mini" id="copyToken" style="flex:none">Copier</button></div>
       <p class="small muted" style="margin-top:8px">Créée le ${esc(day(c.token.createdAt))}. Ne la donnez qu’aux plateformes de la liste ci-dessous.</p>
       <button class="mini" id="regenToken">Régénérer</button><div class="error" id="tokenError" role="alert"></div>`
    : '<p class="muted">Votre clé sera créée automatiquement à la fin de votre évaluation.</p>';
  if ($('#copyToken')) $('#copyToken').onclick = () => navigator.clipboard.writeText(c.token.value).then(() => { $('#copyToken').textContent = 'Copié'; });
  if ($('#regenToken')) $('#regenToken').onclick = async () => {
    const linked = c.platforms.find((p) => p.source === 'link');
    if (!confirm(`Régénérer votre clé ? L’ancienne cessera aussitôt de fonctionner.${linked ? ` ${linked.name} recevra automatiquement la nouvelle.` : ''}`)) return;
    try {
      const r = await api('POST', '/connect/token/regenerate');
      if (r.manualPlatforms.length) alert(`Nouvelle clé créée. Donnez-la à : ${r.manualPlatforms.join(', ')} (plateformes ajoutées à la main).`);
      renderConnect();
    } catch (err) { $('#tokenError').textContent = err.message; }
  };

  $('#platforms').innerHTML = `
    ${c.platforms.length ? `<ul class="plain platforms">${c.platforms.map((p) => `<li>
        <div><b>${esc(p.name)}</b> ${p.source === 'link' ? '<span class="badge ok">liée</span>' : '<span class="badge grey">ajoutée à la main</span>'}<br>
          <span class="small muted">Mon identifiant :</span> <code>${esc(p.accountId)}</code></div>
        ${p.source === 'link' ? `<button class="mini" data-unlink="${esc(p.name)}">Retirer l’accès</button>`
          : `<button class="mini" data-remove="${esc(p.id)}">Retirer</button>`}</li>`).join('')}</ul>`
      : '<p class="muted">Aucune plateforme. Activez WorthKnowing depuis les réglages de votre plateforme de courtage, ou ajoutez-en une ci-dessous.</p>'}
    ${c.token ? `<form id="addPlatform">
      <h3 style="margin-top:18px">Ajouter une plateforme</h3>
      <label for="pfName">Plateforme</label><input id="pfName" maxlength="60" placeholder="ex. Wealthsimple" required>
      <label for="pfAccount">Mon identifiant chez elle</label><input id="pfAccount" maxlength="100" required>
      <div class="error" id="pfError" role="alert"></div>
      <button class="mini primary">Ajouter</button>
    </form>` : ''}`;
  $('#platforms').querySelectorAll('[data-unlink]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`Retirer l’accès de ${b.dataset.unlink} ? Vos ordres n’y seront plus analysés.`)) return;
    await api('DELETE', '/link').catch((err) => alert(err.message));
    refresh().catch(() => {}); renderConnect().catch(() => {});
  }));
  $('#platforms').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Retirer cette plateforme ? Ses ordres ne seront plus analysés.')) return;
    await api('DELETE', `/connect/platforms/${encodeURIComponent(b.dataset.remove)}`).catch((err) => alert(err.message));
    renderConnect();
  }));
  if ($('#addPlatform')) $('#addPlatform').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/connect/platforms', { name: $('#pfName').value, accountId: $('#pfAccount').value });
      renderConnect();
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
    $('#top').innerHTML = `<div class="banner"><div>${esc(err.message)}</div><button onclick="location.reload()">Réessayer</button></div>`;
  }
})();
