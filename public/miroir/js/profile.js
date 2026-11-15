// Page de profil WorthKnowing : dérive, hexagone à 6 critères, règles intelligentes, intégration bancaire.

let cachedRulesData = null;

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
        <b>Seuil de dérive dépassé (${me.drift.score} sur ${me.driftThreshold}).</b> Votre comportement s’est trop éloigné de vos garde-fous.<br>
        Vos ordres sont suspendus chez votre courtier jusqu’à ce que vous refassiez l’évaluation complète
        (questionnaire et simulations). Modifier vos règles ne remet pas la dérive à zéro.
      </div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="primary" onclick="location.href='/onboarding.html'">Refaire l’évaluation complète</button>
      </div>
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
  $('#driftText').textContent = `Écart entre votre comportement récent et votre dernière évaluation. À ${me.driftThreshold}, une réévaluation complète est exigée.`
    + (me.drift.overrides ? ` Règles outrepassées depuis : ${me.drift.overrides}.` : '');


  // Liaison avec le courtier
  $('#link').innerHTML = me.link
    ? `<p><span class="badge ok">Lié</span> ${esc(me.link.partner)}, depuis le ${esc(day(me.link.linkedAt))}.</p>
       <p class="small muted">Vos ordres passés chez ${esc(me.link.partner)} sont analysés ici.</p>
       <button id="revoke">Retirer l’accès de ${esc(me.link.partner)}</button>`
    : `<p class="muted">Aucun compte de courtage lié. Pour que vos ordres soient analysés, activez WorthKnowing depuis les réglages de votre plateforme de courtage.</p>`;
  if ($('#revoke')) $('#revoke').onclick = async () => {
    if (!confirm(`Retirer l’accès de ${me.link.partner} ? Vos ordres ne seront plus analysés.`)) return;
    await api('DELETE', '/link').catch((err) => alert(err.message));
    refresh(); renderConnect().catch(() => {});
  };

  // Hexagone 6 critères (Ce que vous pensez vs Ce que vous êtes)
  const { current, baseline, declared } = me.profile;
  $('#hexagonContainer').innerHTML = hexagonChart(declared || baseline, current || baseline);

  // Barres miroir classiques
  $('#params').innerHTML = mirrorHead('À la dernière évaluation', 'Aujourd’hui')
    + Object.keys(PARAM_LABELS).map((k) => mirror(PARAM_LABELS[k], baseline[k], current[k])).join('');
  $('#evaluated').textContent = `Dernière évaluation le ${day(me.profile.evaluatedAt)} (${me.profile.evaluationCount} au total).`;

  // Expertise détectée au CV : contexte pour l'analyse de vos futurs trades, n'entre pas dans ce profil.
  const enrichBox = $('#enrichmentProfileBox');
  if (enrichBox) {
    const expertise = me.cvProfile?.expertise;
    const label = { novice: 'novice', intermediate: 'intermédiaire', advanced: 'avancée' }[expertise];
    enrichBox.innerHTML = label
      ? `<p class="small muted">Expertise en trading détectée au CV : ${label}. Ce profil de référence n'en tient pas compte ;
         elle sert uniquement à mettre en contexte l'analyse de vos futurs trades.</p>`
      : '';
  }

  // Règles actives
  renderActiveRules(me.rules);

  // Historique des ordres
  $('#history').innerHTML = trades.length
    ? trades.map((t) => tradeRow(t)).join('')
    : `<p class="empty">Aucun ordre analysé pour l’instant. ${me.link ? `Passez un ordre chez ${esc(me.link.partner)} : son enquête apparaîtra ici.` : ''}</p>`;

  // Configuration bouton d'édition des règles
  $('#btnToggleRuleEditor').onclick = () => toggleSmartRuleEditor();
}

function renderActiveRules(rules) {
  $('#rules').innerHTML = rules.length
    ? rules.map((r) => `<div class="rule"><span class="badge grey">${PARAM_LABELS[r.param] ?? r.param}</span>
        <p>${esc(r.text.replace('{seuil}', r.threshold))}</p></div>`).join('')
    : '<p class="empty">Aucune règle active. Cliquez sur « Modifier mes règles » pour en définir.</p>';
}

async function openSmartRuleEditor(focusReset = false) {
  const editor = $('#ruleEditor');
  editor.classList.remove('hidden');
  editor.scrollIntoView({ behavior: 'smooth' });
  await loadAndRenderRuleEditor(focusReset);
}

function toggleSmartRuleEditor() {
  const editor = $('#ruleEditor');
  if (editor.classList.contains('hidden')) {
    openSmartRuleEditor(false);
  } else {
    editor.classList.add('hidden');
  }
}

async function loadAndRenderRuleEditor(focusReset = false) {
  const editor = $('#ruleEditor');
  editor.innerHTML = '<p class="small muted">Chargement des suggestions intelligentes…</p>';
  try {
    cachedRulesData = await api('GET', '/rules');
  } catch (err) {
    editor.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  const { suggestions, rules, drift, status } = cachedRulesData;

  editor.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <h3 style="margin:0; font-size:16px;">💡 Éditeur de règles intelligentes</h3>
      <button class="mini" id="btnCloseEditor" style="flex:none;">Fermer</button>
    </div>
    <p class="small muted" style="margin:0 0 14px;">
      Vous pouvez modifier, activer ou désactiver vos règles <b>à n'importe quel moment</b>.
      Des suggestions intelligentes sont calculées automatiquement selon l'évolution de vos paramètres.
    </p>

    <div class="smart-rules-list">
      ${suggestions.map((s) => {
        const active = rules.find((r) => r.param === s.param);
        const isChecked = Boolean(active);
        const thresholdVal = active ? active.threshold : s.suggestion.threshold;
        const textVal = active ? active.text : s.suggestion.text;

        return `
          <div class="rule-edit-card" data-param="${s.param}" style="margin-bottom:12px; padding:10px; background:white; border:1px solid ${s.isAtRisk ? '#f59e0b' : '#e2e8f0'}; border-radius:6px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label style="margin:0; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="chk-rule" ${isChecked ? 'checked' : ''}>
                <span>${esc(s.label)}</span>
                ${s.isAtRisk ? '<span class="badge warn" style="font-size:10px;">Point fragile</span>' : ''}
              </label>
              <span class="small muted">Score actuel : <b>${s.currentScore}/100</b></span>
            </div>

            ${s.suggestion.rationale ? `<p class="small" style="margin:6px 0; color:#475569;">💡 <b>Suggestion :</b> ${esc(s.suggestion.rationale)}</p>` : ''}

            <div class="rule-fields ${isChecked ? '' : 'hidden'}" style="margin-top:8px;">
              <textarea class="rule-text" rows="2" style="width:100%; font-size:13px;" aria-label="Texte de la règle">${esc(textVal)}</textarea>
              <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
                <span class="small muted">Seuil :</span>
                <input type="number" class="rule-threshold" min="1" step="any" value="${thresholdVal}" style="width:90px;">
                <span class="small muted">${esc(s.suggestion.unit)}</span>
                <button type="button" class="mini btn-apply-smart" data-threshold="${s.suggestion.threshold}" data-text="${esc(s.suggestion.text)}" style="margin-left:auto;">Appliquer suggestion</button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <p class="small muted">Modifier vos règles ne change ni votre score de dérive ni le blocage de vos ordres.</p>
    <div style="display:flex; gap:8px; align-items:center;">
      <button class="primary" id="btnSaveSmartRules">Enregistrer mes règles</button>
      <button id="btnCancelEditor">Annuler</button>
      <span class="small error" id="ruleEditorError" style="margin-left:8px;"></span>
    </div>
  `;

  $('#btnCloseEditor').onclick = () => editor.classList.add('hidden');
  $('#btnCancelEditor').onclick = () => editor.classList.add('hidden');

  editor.querySelectorAll('.chk-rule').forEach((chk) => {
    chk.onchange = () => {
      const fields = chk.closest('.rule-edit-card').querySelector('.rule-fields');
      fields.classList.toggle('hidden', !chk.checked);
    };
  });

  editor.querySelectorAll('.btn-apply-smart').forEach((btn) => {
    btn.onclick = () => {
      const card = btn.closest('.rule-edit-card');
      card.querySelector('.rule-threshold').value = btn.dataset.threshold;
      card.querySelector('.rule-text').value = btn.dataset.text;
      const chk = card.querySelector('.chk-rule');
      if (!chk.checked) {
        chk.checked = true;
        card.querySelector('.rule-fields').classList.remove('hidden');
      }
    };
  });

  $('#btnSaveSmartRules').onclick = async () => {
    const errorSpan = $('#ruleEditorError');
    errorSpan.textContent = '';
    const updatedRules = [];

    editor.querySelectorAll('.rule-edit-card').forEach((card) => {
      const isChecked = card.querySelector('.chk-rule').checked;
      if (isChecked) {
        const param = card.dataset.param;
        const text = card.querySelector('.rule-text').value.trim();
        const threshold = Number(card.querySelector('.rule-threshold').value);
        if (text && threshold > 0) {
          updatedRules.push({ param, text, threshold });
        }
      }
    });

    $('#btnSaveSmartRules').disabled = true;

    try {
      await api('PUT', '/rules', { rules: updatedRules });
      editor.classList.add('hidden');
      await refresh();
      alert('Règles mises à jour. Votre score de dérive n’a pas changé.');
    } catch (err) {
      errorSpan.textContent = err.message;
    } finally {
      $('#btnSaveSmartRules').disabled = false;
    }
  };
}

(async () => {
  if (!session.token) return (location.href = '/');
  refresh().catch((err) => {
    $('#top').innerHTML = `<div class="banner"><div>${esc(err.message)}</div><button onclick="location.reload()">Réessayer</button></div>`;
  });
})();

// ------------------------------------------------------------------ User id et identifiants institution
// User id : vous représente auprès des institutions. Créé automatiquement, toujours visible, seulement régénérable.
// ID institution : votre identifiant chez une plateforme. Reçu automatiquement quand vous liez la plateforme,
// ou ajouté à la main pour qu'une autre plateforme puisse faire analyser vos trades.
async function renderConnect() {
  const c = await api('GET', '/connect');
  $('#token').innerHTML = c.token
    ? `<div class="row"><code style="flex:1; word-break:break-all">${esc(c.token.value)}</code><button class="mini" id="copyToken">Copier</button></div>
       <p class="small muted">Créé le ${esc(day(c.token.createdAt))}. Ne le donnez qu’aux institutions de la liste ci-dessous.</p>
       <button class="mini" id="regenToken">Régénérer</button><div class="error" id="tokenError"></div>`
    : '<p class="muted">Votre user id sera créé automatiquement à la fin de votre évaluation.</p>';
  if ($('#copyToken')) $('#copyToken').onclick = () => navigator.clipboard.writeText(c.token.value).then(() => { $('#copyToken').textContent = 'Copié'; });
  if ($('#regenToken')) $('#regenToken').onclick = async () => {
    const linked = c.platforms.find((p) => p.source === 'link');
    if (!confirm(`Régénérer votre user id ? L’ancien cessera aussitôt de fonctionner.${linked ? ` ${linked.name} recevra automatiquement le nouveau.` : ''}`)) return;
    try {
      const r = await api('POST', '/connect/token/regenerate');
      if (r.manualPlatforms.length) alert(`Nouveau user id créé. Donnez-le à : ${r.manualPlatforms.join(', ')} (plateformes ajoutées à la main).`);
      renderConnect();
    } catch (err) { $('#tokenError').textContent = err.message; }
  };

  $('#platforms').innerHTML = `
    ${c.platforms.length ? `<ul>${c.platforms.map((p) => `<li><b>${esc(p.name)}</b> — ID institution <code>${esc(p.accountId)}</code>
        ${p.source === 'link' ? '<span class="badge ok">lié automatiquement</span>'
          : `<span class="badge grey">ajouté à la main</span> <button class="mini" data-remove="${esc(p.id)}">Retirer</button>`}</li>`).join('')}</ul>`
      : '<p class="muted">Aucune institution. Liez votre compte depuis votre plateforme de courtage, ou ajoutez-en une ci-dessous.</p>'}
    ${c.token ? `<form id="addPlatform">
      <p class="small muted" style="margin:0">Une autre plateforme ? Ajoutez votre identifiant chez elle pour que vos trades soient aussi analysés.</p>
      <label for="pfName">Institution</label><input id="pfName" maxlength="60" placeholder="ex. Wealthsimple" required>
      <label for="pfAccount">Mon ID chez cette institution</label><input id="pfAccount" maxlength="100" required>
      <div class="error" id="pfError"></div>
      <button class="mini primary">Ajouter</button>
    </form>` : ''}`;
  $('#platforms').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Retirer cette institution ? Ses trades ne seront plus analysés.')) return;
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
renderConnect().catch(() => {});
