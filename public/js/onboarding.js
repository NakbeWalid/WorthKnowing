// Évaluation en 4 étapes : questionnaire -> simulations -> révélation -> règles.
// Sert aussi à la réévaluation (le questionnaire est alors sauté).

const view = $('#view');
const state = { questions: [], answers: {}, session: null, index: 0, shownAt: 0, result: null };

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
  document.querySelectorAll('#steps div').forEach((el, i) => el.classList.toggle('on', i === n - 1));
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ Étape 1 : questionnaire
function showQuestion() {
  setStep(1);
  const q = state.questions[state.index];
  view.innerHTML = `
    <div class="card">
      <div class="progress"><i style="width:${(state.index / state.questions.length) * 100}%"></i></div>
      <p class="small muted">Question ${state.index + 1} sur ${state.questions.length}</p>
      <h1>${esc(q.text)}</h1>
      <div class="choices">${q.options.map((o) => `<button data-id="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>
      ${state.index ? '<p style="margin-top:16px"><button class="link" id="back">← Question précédente</button></p>' : ''}
    </div>
    ${state.index === 0 ? `<p class="small muted">Démo — répondre comme un persona de l’énoncé :
      ${Object.keys(PERSONAS).map((p) => `<button class="link" data-persona="${p}">${p}</button>`).join(' · ')}</p>` : ''}`;
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
  state.session = await api('POST', '/evaluation/start', answers ? { answers } : {});
  state.index = 0;
  setStep(2);
  view.innerHTML = `
    <div class="card">
      <h1>${state.session.scenarios.length} mises en situation</h1>
      <p>Vous allez voir ${state.session.scenarios.length} situations de marché. Les <b>courbes de prix sont réelles</b>, tirées des cinq dernières années.
      Les noms et les manchettes sont <b>fictifs</b>, pour que vous ne reconnaissiez pas l’épisode.</p>
      <p>Décidez comme vous le feriez avec votre propre argent. Il n’y a pas de bonne réponse : on mesure votre comportement, pas votre rendement.
      À la fin, on vous révèle ce qui s’est réellement passé.</p>
      <button class="primary" id="go">Commencer</button>
    </div>`;
  $('#go').onclick = showScenario;
}

function showScenario() {
  const s = state.session.scenarios[state.index];
  const total = state.session.scenarios.length;
  state.shownAt = Date.now(); // sert à mesurer le temps de décision
  view.innerHTML = `
    <div class="card">
      <div class="progress"><i style="width:${(state.index / total) * 100}%"></i></div>
      <p class="small muted">Situation ${state.index + 1} sur ${total} · ${esc(s.title)}</p>
      <h1>${esc(s.alias)} <span class="badge grey">${esc(s.maskLabel)}</span></h1>
      ${lineChart(s.context)}
      <p class="small muted">Prix sur les 90 dernières séances (base 100).</p>
      <div class="quote">${esc(s.headline)} <span class="badge grey">manchette fictive</span></div>
      <p><b>${esc(s.situation)}</b></p>
      <p>Que faites-vous ?</p>
      <div class="choices">${s.choices.map((c) => `<button data-id="${c.id}">${esc(c.label)}</button>`).join('')}</div>
    </div>`;
  view.querySelectorAll('.choices button').forEach((b) => (b.onclick = async () => {
    view.querySelectorAll('button').forEach((x) => (x.disabled = true));
    await api('POST', `/evaluation/${state.session.evaluationId}/decisions`,
      { scenarioId: s.id, choiceId: b.dataset.id, decisionTimeMs: Date.now() - state.shownAt });
    state.index++;
    state.index < total ? showScenario() : showReveal();
  }));
}

// ------------------------------------------------------------------ Étape 3 : révélation
async function showReveal() {
  state.result = await api('POST', `/evaluation/${state.session.evaluationId}/complete`);
  setStep(3);
  const r = state.result;
  view.innerHTML = `
    <div class="card">
      <h1>Ce qui s’est vraiment passé</h1>
      <p>Résultat de vos ${r.reveals.length} décisions sur 60 séances : <b>${signed(r.totalPnl)}</b> (mise fictive de ${money(state.session.stake)} par situation).</p>
      <p class="small muted">${esc(r.note)}</p>
    </div>
    ${r.reveals.map((x, i) => `
      <div class="card">
        <p class="small muted">${esc(state.session.scenarios[i].alias)} · ${esc(x.title)} · teste : ${esc(x.testsLabel)}</p>
        <h2>C’était ${esc(x.reveal.name)} (${esc(x.reveal.ticker)}), le ${x.reveal.decisionDate}</h2>
        ${lineChart(x.context, x.forward)}
        <p>Dans les 60 séances suivantes, le titre a fait <b>${pct(x.outcome.fwd60d)}</b>
          (pire creux en chemin : ${pct(x.outcome.maxDrawdown)} ; marché américain sur la même période : ${pct(x.outcome.marketFwd60d)}).
          Vous avez décidé en ${x.decisionSeconds} s.</p>
        ${historicalContextHtml(x.historicalContext)}
        <table>
          <tr><th>Décision possible</th><th class="right">Résultat réel</th></tr>
          ${x.options.map((o) => `<tr class="${o.id === x.chosenId ? 'chosen' : ''} ${o.id === x.bestId ? 'best' : ''}">
            <td>${esc(o.label)}</td><td class="right">${signed(o.pnl)}</td></tr>`).join('')}
        </table>
      </div>`).join('')}
    <button class="primary" id="next">Voir mon profil et définir mes règles →</button>`;
  $('#next').onclick = showRules;
}

// ------------------------------------------------------------------ Étape 4 : règles auto-définies
function showRules() {
  setStep(4);
  const params = state.result.params;
  view.innerHTML = `
    <div class="card">
      <h1>Votre profil : déclaré contre observé</h1>
      <p class="muted">La barre montre comment vous avez agi en simulation ; le trait noir, comment vous vous décriviez.</p>
      ${params.map((p) => paramBar(p.label, p.observed, p.declared, `observé ${p.observed} · déclaré ${p.declared}`)).join('')}
      <div class="legend"><span>Observé</span><span class="tick">Déclaré</span></div>
    </div>
    <div class="card">
      <h2>Vos règles</h2>
      <p class="muted">Pour chaque point fragile, fixez-vous une règle. Elle vous sera rappelée avant tout trade qui la concerne. Modifiez le texte et le seuil à votre goût.</p>
      ${params.map((p) => `
        <div class="rule ${p.atRisk ? 'risk' : ''}" data-param="${p.param}">
          <div class="row">
            <input type="checkbox" id="on-${p.param}" ${p.atRisk ? 'checked' : ''}>
            <label for="on-${p.param}" style="margin:0; color:var(--ink); font-size:15px"><b>${esc(p.label)}</b>
              ${p.atRisk ? '<span class="badge warn">à encadrer</span>' : ''}</label>
          </div>
          ${p.reason ? `<p class="small muted" style="margin:6px 0 0">${esc(p.reason)}</p>` : ''}
          <div class="row"><input class="text" value="${esc(p.suggestedRule.text)}" aria-label="Texte de la règle"></div>
          <div class="row small muted"><span style="flex:none">Seuil</span>
            <input class="threshold" type="number" min="1" value="${p.suggestedRule.threshold}" aria-label="Seuil">
            <span>${esc(p.suggestedRule.unit)} — remplace <code>{seuil}</code> dans le texte</span></div>
        </div>`).join('')}
      <div class="error" id="error"></div>
      <button class="primary" id="save">Activer mon profil</button>
    </div>`;
  $('#save').onclick = async () => {
    const rules = [...view.querySelectorAll('.rule')]
      .filter((el) => el.querySelector('input[type=checkbox]').checked)
      .map((el) => ({ param: el.dataset.param, text: el.querySelector('.text').value, threshold: Number(el.querySelector('.threshold').value) }));
    try {
      await api('POST', `/evaluation/${state.session.evaluationId}/rules`, { rules });
      location.href = '/dashboard.html';
    } catch (err) { $('#error').textContent = err.message; }
  };
}

// ------------------------------------------------------------------ Démarrage
(async () => {
  if (!session.token) return (location.href = '/');
  const me = await api('GET', '/me');
  if (me.role === 'admin') return route(me);
  if (me.profile) {
    // Réévaluation : le profil déclaré est conservé, on repasse directement des simulations inédites.
    setStep(2);
    view.innerHTML = `<div class="card"><h1>Réévaluation</h1>
      <p>Votre comportement récent s’est éloigné de votre profil de référence (score de dérive : <b>${me.drift.score}</b>).
      On refait le point avec de nouvelles situations, puis vous ajusterez vos règles.</p>
      <button class="primary" id="go">Continuer</button></div>`;
    $('#go').onclick = () => startSimulations(null);
  } else {
    state.questions = await api('GET', '/evaluation/questions');
    showQuestion();
  }
})();

/** Ce que disaient les médias juste avant la décision (vraies manchettes citées). Rien de sourcé : rien d'affiché. */
function historicalContextHtml(hc) {
  if (!hc) return '';
  return `<div class="quote">
    <p style="margin:0 0 6px">${esc(hc.text)} <span class="badge grey">IA</span></p>
    <p class="small muted" style="margin:0">${hc.sources.map((s) =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)}</a> (${esc(s.date)})`).join(' · ')}</p>
    <p class="small muted" style="margin:4px 0 0">${esc(hc.label)}</p>
  </div>`;
}
