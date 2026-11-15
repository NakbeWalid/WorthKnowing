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
        Vos ordres sont suspendus chez votre courtier. <b>Vous êtes invité à réajuster vos règles</b> pour réaligner votre profil.
        La validation de vos règles réinitialisera votre score de dérive à 0 et réactivera vos ordres.
      </div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="primary" id="btnBannerEditRules">Réajuster mes règles & Réinitialiser la dérive à 0</button>
        <button class="danger" onclick="location.href='/onboarding.html'">Refaire l’évaluation complète</button>
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
  if ($('#btnBannerEditRules')) {
    $('#btnBannerEditRules').onclick = () => openSmartRuleEditor(true);
  }

  // Score de dérive
  $('#driftScore').textContent = me.drift.score;
  $('#driftNeedle').style.left = `calc(${me.drift.score}% - 2px)`;
  $('#driftLimit').style.left = me.driftThreshold + '%';
  $('#driftText').textContent = `Écart entre votre comportement récent et votre dernière évaluation. À ${me.driftThreshold}, une réévaluation ou un réajustement des règles est exigé.`
    + (me.drift.overrides ? ` Règles outrepassées depuis : ${me.drift.overrides}.` : '');

  // Bouton de reset dérive si seuil dépassé ou dérive > 0
  const resetActionDiv = $('#driftResetAction');
  if (resetActionDiv) {
    resetActionDiv.innerHTML = me.drift.score > 0
      ? `<button class="mini" id="btnQuickReset" style="width:100%;">Réajuster règles & Réinitialiser dérive à 0</button>`
      : '';
    if ($('#btnQuickReset')) {
      $('#btnQuickReset').onclick = () => openSmartRuleEditor(true);
    }
  }

  // Liaison avec le courtier
  $('#link').innerHTML = me.link
    ? `<p><span class="badge ok">Lié</span> ${esc(me.link.partner)}, depuis le ${esc(day(me.link.linkedAt))}.</p>
       <p class="small muted">Vos ordres passés chez ${esc(me.link.partner)} sont analysés ici.</p>
       <button id="revoke">Retirer l’accès de ${esc(me.link.partner)}</button>`
    : `<p class="muted">Aucun compte de courtage lié. Pour que vos ordres soient analysés, activez WorthKnowing depuis les réglages de votre plateforme de courtage.</p>`;
  if ($('#revoke')) $('#revoke').onclick = async () => {
    if (!confirm(`Retirer l’accès de ${me.link.partner} ? Vos ordres ne seront plus analysés.`)) return;
    await api('DELETE', '/link').catch((err) => alert(err.message));
    refresh();
  };

  // Hexagone 6 critères (Ce que vous pensez vs Ce que vous êtes)
  const { current, baseline, declared } = me.profile;
  $('#hexagonContainer').innerHTML = hexagonChart(declared || baseline, current || baseline);

  // Barres miroir classiques
  $('#params').innerHTML = mirrorHead('À la dernière évaluation', 'Aujourd’hui')
    + Object.keys(PARAM_LABELS).map((k) => mirror(PARAM_LABELS[k], baseline[k], current[k])).join('');
  $('#evaluated').textContent = `Dernière évaluation le ${day(me.profile.evaluatedAt)} (${me.profile.evaluationCount} au total).`;

  // Enrichissement de la caractérisation (CV)
  const enrichBox = $('#enrichmentProfileBox');
  if (enrichBox) {
    if (me.characterizationEnrichment) {
      const enr = me.characterizationEnrichment;
      enrichBox.innerHTML = `
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px; margin-bottom:12px;">
          <h4 style="margin:0 0 6px; font-size:13px; color:#1e293b;">✨ Caractérisation comportementale enrichie (CV)</h4>
          ${enr.summary ? `<p class="small" style="margin:0 0 6px; white-space:pre-line; color:#475569;">${esc(enr.summary)}</p>` : ''}
          ${enr.highlights?.length ? `<ul class="small" style="margin:0; padding-left:18px; color:#475569;">${enr.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        </div>`;
    } else {
      enrichBox.innerHTML = '';
    }
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
  const isResetRequired = status === 'reevaluation_required' || drift.score > 0 || focusReset;

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

    <div style="margin:14px 0; padding:10px; background:${isResetRequired ? '#fef2f2' : '#f1f5f9'}; border-radius:6px;">
      <label style="margin:0; font-weight:600; display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="chkResetDrift" ${isResetRequired ? 'checked' : ''}>
        <span>Réinitialiser le score de dérive à 0 lors de l'enregistrement</span>
      </label>
      <p class="small muted" style="margin:4px 0 0 24px;">
        Recommandé si vous avez dépassé le seuil de dérive afin de réactiver immédiatement vos ordres de courtage.
      </p>
    </div>

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

    const resetDrift = $('#chkResetDrift').checked;
    $('#btnSaveSmartRules').disabled = true;

    try {
      await api('PUT', '/rules', { rules: updatedRules, resetDrift });
      editor.classList.add('hidden');
      await refresh();
      alert(resetDrift
        ? 'Règles enregistrées avec succès et score de dérive réinitialisé à 0 !'
        : 'Règles mises à jour avec succès !');
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
