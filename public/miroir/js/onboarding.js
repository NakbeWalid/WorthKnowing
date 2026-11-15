// Évaluation en 4 étapes : questionnaire -> simulations -> révélation -> règles.
// Sert aussi à la réévaluation (le questionnaire est alors sauté).
// L'évaluation en cours est mémorisée dans l'onglet : recharger la page reprend là où on en était.

const view = $('#view');
const state = { questions: [], answers: {}, session: null, index: 0, shownAt: 0, result: null };
const partner = pending.get()?.partner; // défini si l'utilisateur vient de la plateforme de courtage

// Profils de démonstration (les 3 personas de l'énoncé) pour remplir le questionnaire en un clic.
const PERSONAS = {
  Amira: { age: '18-29', horizon: '15+', objective: 'growth', experience: 'intermediate', esg: 'low', crypto: 'yes', follows: 'weekly',
    riskTolerance: '3', lossAversion: '1', fomo: '2', concentration: '1', impulsivity: '2', newsSensitivity: '1' },
  Mateo: { age: '30-44', horizon: '8-12', objective: 'balanced', experience: 'intermediate', esg: 'high', crypto: 'no', follows: 'weekly',
    riskTolerance: '1', lossAversion: '1', fomo: '1', concentration: '1', impulsivity: '1', newsSensitivity: '1' },
  Robert: { age: '45-59', horizon: '3-5', objective: 'preserve', experience: 'advanced', esg: 'medium', crypto: 'no', follows: 'daily',
    riskTolerance: '1', lossAversion: '1', fomo: '1', concentration: '0', impulsivity: '0', newsSensitivity: '1' },
};

function setStep(n) {
  document.querySelectorAll('#steps li').forEach((el, i) => {
    el.classList.toggle('on', i === n - 1);
    el.classList.toggle('done', i < n - 1);
  });
  window.scrollTo(0, 0);
}

/** Écran d'erreur avec bouton « Réessayer » : une panne réseau ne laisse jamais la page figée. */
function showError(err, retry) {
  view.innerHTML = `<div class="card"><h1>Un problème est survenu</h1>
    <p class="error">${esc(err.message)}</p>
    <button class="primary" id="retry">Réessayer</button></div>`;
  $('#retry').onclick = retry;
}

// ------------------------------------------------------------------ Étape 1 : questionnaire
function showQuestion() {
  setStep(1);
  const q = state.questions[state.index];
  view.innerHTML = `
    ${state.index === 0 && partner ? `<div class="card partner"><p style="margin:0">Vous venez de ${esc(partner)}.
      Comptez une dizaine de minutes ; à la fin, vous y serez ramené et vos ordres pourront être analysés.</p></div>` : ''}
    <div class="card">
      <div class="progress"><i style="width:${(state.index / state.questions.length) * 100}%"></i></div>
      <p class="small muted">Question ${state.index + 1} sur ${state.questions.length}</p>
      <h1>${esc(q.text)}</h1>
      <div class="choices">${q.options.map((o) => `<button data-id="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>
      ${state.index ? '<p style="margin:18px 0 0"><button class="link" id="back">Revenir à la question précédente</button></p>' : ''}
    </div>
    ${state.index === 0 ? `<p class="small muted">Pour la démonstration, répondre comme un persona de l’énoncé :
      ${Object.keys(PERSONAS).map((p) => `<button class="link" data-persona="${p}">${p}</button>`).join(', ')}.</p>` : ''}`;
  view.querySelectorAll('.choices button').forEach((b) => (b.onclick = () => {
    state.answers[q.id] = b.dataset.id;
    state.index++;
    state.index < state.questions.length ? showQuestion() : startSimulations(state.answers);
  }));
  view.querySelectorAll('[data-persona]').forEach((b) => (b.onclick = () => startSimulations(PERSONAS[b.dataset.persona])));
  if ($('#back')) $('#back').onclick = () => { state.index--; showQuestion(); };
}

// ------------------------------------------------------------------ Étape 2 : simulations
async function startSimulations(answers) {
  try {
    state.session = await api('POST', '/evaluation/start', answers ? { answers } : {});
  } catch (err) { return showError(err, () => startSimulations(answers)); }
  sessionStorage.setItem('miroir.evaluation', state.session.evaluationId);
  state.index = 0;
  setStep(2);
  const n = state.session.scenarios.length;
  view.innerHTML = `
    <div class="card">
      <h1>${n} mises en situation</h1>
      <p>Vous allez voir ${n} situations de marché. Les <b>courbes de prix sont réelles</b>, tirées des cinq dernières années.
      Les noms et les manchettes sont <b>fictifs</b>, pour que vous ne reconnaissiez pas l’épisode.</p>
      <p>Décidez comme vous le feriez avec votre propre argent. Il n’y a pas de bonne réponse : on observe votre comportement, pas votre rendement.
      À la fin, on vous montre ce qui s’est réellement passé.</p>
      <button class="primary" id="go">Commencer</button>
    </div>`;
  $('#go').onclick = showScenario;
}

function showScenario() {
  setStep(2);
  const s = state.session.scenarios[state.index];
  const total = state.session.scenarios.length;
  state.shownAt = Date.now(); // sert à mesurer le temps de décision
  view.innerHTML = `
    <div class="card">
      <div class="progress"><i style="width:${(state.index / total) * 100}%"></i></div>
      <p class="small muted">Situation ${state.index + 1} sur ${total} : ${esc(s.title.toLowerCase())}</p>
      <h1>${esc(s.alias)} <span class="badge grey">${esc(s.maskLabel)}</span></h1>
      ${lineChart(s.context)}
      <p class="small muted">Prix sur les 90 dernières séances (base 100).</p>
      <div class="quote">${esc(s.headline)} <span class="badge grey">manchette fictive</span></div>
      <p><b>${esc(s.situation)}</b></p>
      <p>Que faites-vous ?</p>
      <div class="choices">${s.choices.map((c) => `<button data-id="${c.id}">${esc(c.label)}</button>`).join('')}</div>
      <div class="error" id="error" role="alert"></div>
    </div>`;
  view.querySelectorAll('.choices button').forEach((b) => (b.onclick = async () => {
    view.querySelectorAll('button').forEach((x) => (x.disabled = true));
    $('#error').textContent = '';
    s.decisionTimeMs ??= Date.now() - state.shownAt; // mesuré au premier clic, pas faussé par un renvoi
    try {
      await api('POST', `/evaluation/${state.session.evaluationId}/decisions`,
        { scenarioId: s.id, choiceId: b.dataset.id, decisionTimeMs: s.decisionTimeMs });
    } catch (err) {
      $('#error').textContent = err.message; // le choix peut être renvoyé : le serveur remplace la décision
      view.querySelectorAll('button').forEach((x) => (x.disabled = false));
      return;
    }
    state.index++;
    state.index < total ? showScenario() : showReveal();
  }));
}

// ------------------------------------------------------------------ Étape 3 : révélation
async function showReveal() {
  setStep(3);
  if (!state.result) {
    view.innerHTML = '<div class="card"><p class="muted">Calcul de la révélation…</p></div>';
    try {
      state.result = await api('POST', `/evaluation/${state.session.evaluationId}/complete`);
    } catch (err) { return showError(err, showReveal); }
  }
  const r = state.result;
  view.innerHTML = `
    <div class="card">
      <h1>Ce qui s’est vraiment passé</h1>
      <p>Résultat de vos ${r.reveals.length} décisions, 60 séances plus tard : <b>${signed(r.totalPnl)}</b>
        (mise fictive de ${money(state.session.stake)} par situation).</p>
      <p class="small muted">${esc(r.note)}</p>
    </div>
    ${r.reveals.map((x) => `
      <div class="card">
        <p class="small muted">${esc(x.alias)}, « ${esc(x.title.toLowerCase())} ». Paramètre observé : ${esc(x.testsLabel.toLowerCase())}. Décidé en ${x.decisionSeconds} s.</p>
        <h2>C’était ${esc(x.reveal.name)} (${esc(x.reveal.ticker)}), le ${esc(day(x.reveal.decisionDate + 'T12:00:00'))}</h2>
        ${lineChart(x.context, x.forward)}
        <p>${esc(x.sentence)}</p>
        <table>
          <tr><th>Décision possible</th><th class="right">Résultat réel</th></tr>
          ${x.options.map((o) => `<tr class="${o.id === x.chosenId ? 'chosen' : ''} ${o.id === x.bestId ? 'best' : ''}">
            <td>${esc(o.label)}</td><td class="right">${signed(o.pnl)}</td></tr>`).join('')}
        </table>
      </div>`).join('')}
    <button class="primary" id="next">Voir mon profil et définir mes règles</button>`;
  $('#next').onclick = showRules;
}

// ------------------------------------------------------------------ Étape 4 : règles auto-définies
function showRules() {
  setStep(4);
  const params = state.result.params;
  view.innerHTML = `
    <div class="card">
      <h1>Votre reflet</h1>
      <p class="muted">À gauche, comment vous vous décriviez. À droite, comment vous avez agi. Plus les deux côtés diffèrent, plus le paramètre mérite une règle.</p>
      ${mirrorHead('Vous disiez', 'Vous avez fait')}
      ${params.map((p) => mirror(esc(p.label), p.declared, p.observed)).join('')}
    </div>
    <div class="card">
      <h2>Vos règles</h2>
      <p class="muted">Pour chaque point fragile, fixez-vous une règle. ${partner ? `${esc(partner)} vous la rappellera` : 'Elle vous sera rappelée'}
        avant tout ordre qui la concerne. Le texte et le seuil sont les vôtres : modifiez-les.</p>
      ${params.map((p) => `
        <div class="rule ${p.atRisk ? 'risk' : 'off'}" data-param="${p.param}">
          <div class="row">
            <input type="checkbox" id="on-${p.param}" ${p.atRisk ? 'checked' : ''}>
            <label for="on-${p.param}" style="margin:0; color:var(--ink); font-size:16px"><b>${esc(p.label)}</b>
              ${p.atRisk ? '<span class="badge warn">à encadrer</span>' : ''}</label>
          </div>
          ${p.reason ? `<p class="small muted">${esc(p.reason)}</p>` : ''}
          <div class="editor">
            <div class="row"><textarea class="text" rows="2" maxlength="300" aria-label="Texte de la règle : ${esc(p.label)}">${esc(p.suggestedRule.text)}</textarea></div>
            <div class="row small muted"><span style="flex:none">Seuil</span>
              <input class="threshold" type="number" min="1" step="any" value="${p.suggestedRule.threshold}" aria-label="Seuil : ${esc(p.label)}">
              <span>${esc(p.suggestedRule.unit)}. Il remplace <code>{seuil}</code> dans le texte.</span></div>
            <p class="small preview" style="margin-bottom:0"></p>
          </div>
        </div>`).join('')}
      <div class="error" id="error" role="alert"></div>
      <div class="actions">
        <button class="primary" id="save">${partner ? `Activer mon profil et retourner à ${esc(partner)}` : 'Activer mon profil'}</button>
        <button id="backToReveal">Revoir la révélation</button>
      </div>
      ${partner && pending.get().link ? `<p class="small muted" style="margin-top:14px">En continuant, vous autorisez ${esc(partner)} à envoyer vos ordres
        et la composition de votre portefeuille à Miroir, et à recevoir l’état de votre profil, votre score de dérive et le texte de vos règles.</p>` : ''}
    </div>`;
  view.querySelectorAll('.rule').forEach((el) => {
    const box = el.querySelector('input[type=checkbox]');
    box.onchange = () => el.classList.toggle('off', !box.checked);
    // Aperçu de la règle telle qu'elle sera rappelée, mis à jour à chaque frappe.
    const preview = () => { el.querySelector('.preview').textContent =
      'Vous lirez : « ' + el.querySelector('.text').value.replace('{seuil}', el.querySelector('.threshold').value) + ' »'; };
    el.querySelector('.text').oninput = el.querySelector('.threshold').oninput = preview;
    preview();
  });
  $('#backToReveal').onclick = showReveal;
  $('#save').onclick = async () => {
    const rules = [...view.querySelectorAll('.rule')]
      .filter((el) => el.querySelector('input[type=checkbox]').checked)
      .map((el) => ({ param: el.dataset.param, text: el.querySelector('.text').value, threshold: Number(el.querySelector('.threshold').value) }));
    $('#save').disabled = true; // évite le double envoi
    $('#error').textContent = '';
    try {
      // Si la page est rechargée entre les deux appels, la reprise voit l'évaluation terminée et retombe sur finishAndReturn().
      await api('POST', `/evaluation/${state.session.evaluationId}/rules`, { rules });
      sessionStorage.removeItem('miroir.evaluation');
      await finishAndReturn();
    } catch (err) {
      $('#error').textContent = err.message;
      $('#save').disabled = false;
    }
  };
}

// ------------------------------------------------------------------ Démarrage
async function init() {
  if (!session.token) return (location.href = '/');
  let me;
  try {
    me = await api('GET', '/me');
    if (me.role === 'admin') return route(me);
    // Reprise d'une évaluation commencée dans cet onglet.
    const current = sessionStorage.getItem('miroir.evaluation');
    if (current) {
      const resumed = await api('GET', '/evaluation/' + current).catch((err) => {
        if (err.status !== 404) throw err;
        sessionStorage.removeItem('miroir.evaluation');
        return null;
      });
      if (resumed) {
        state.session = resumed;
        state.result = resumed.result;
        state.index = resumed.scenarios.findIndex((s) => !resumed.answered.includes(s.id));
        if (state.result) return showRules();
        return state.index < 0 ? showReveal() : showScenario();
      }
    }
    if (!me.profile) state.questions = await api('GET', '/evaluation/questions');
  } catch (err) { return showError(err, init); }

  if (me.profile) {
    // Réévaluation : le profil déclaré est conservé, on repasse directement des simulations inédites.
    setStep(2);
    view.innerHTML = `<div class="card"><h1>Réévaluation</h1>
      <p>${me.status === 'reevaluation_required'
        ? `Votre comportement récent s’est éloigné de votre profil de référence (score de dérive : <b>${me.drift.score}</b> sur 100).`
        : 'Vous pouvez refaire le point quand vous le souhaitez.'}
      De nouvelles situations vous attendent ; vous ajusterez ensuite vos règles et votre score de dérive repartira de zéro.</p>
      <div class="actions"><button class="primary" id="go">Continuer</button>
        <button onclick="location.href='/profile.html'">Plus tard</button></div></div>`;
    $('#go').onclick = () => startSimulations(null);
  } else {
    showQuestion();
  }
}
init();
