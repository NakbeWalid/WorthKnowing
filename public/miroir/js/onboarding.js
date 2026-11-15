// Évaluation en 4 étapes : questionnaire -> simulations -> révélation -> règles.
// Sert aussi à la réévaluation (le questionnaire est alors sauté).
// L'évaluation en cours est mémorisée dans l'onglet : recharger la page reprend là où on en était.

const view = $('#view');
const state = { questions: [], answers: {}, session: null, index: 0, shownAt: 0, result: null, enrichment: null };
const partner = pending.get()?.partner; // défini si l'utilisateur vient de la plateforme de courtage

let cvFileCached = null;
let cvTextCached = '';

// Profils de démonstration (les 3 personas de l'énoncé) pour remplir le questionnaire en un clic.
const PERSONAS = {
  Amira: {
    age: '18-29', horizon: '15+', objective: 'growth', experience: 'intermediate', esg: 'low', crypto: 'yes', follows: 'weekly',
    riskTolerance: '3', lossAversion: '1', fomo: '2', concentration: '1', impulsivity: '2', newsSensitivity: '1',
  },
  Mateo: {
    age: '30-44', horizon: '8-12', objective: 'balanced', experience: 'intermediate', esg: 'high', crypto: 'no', follows: 'weekly',
    riskTolerance: '1', lossAversion: '1', fomo: '1', concentration: '1', impulsivity: '1', newsSensitivity: '1',
  },
  Robert: {
    age: '45-59', horizon: '3-5', objective: 'preserve', experience: 'advanced', esg: 'medium', crypto: 'no', follows: 'daily',
    riskTolerance: '1', lossAversion: '1', fomo: '1', concentration: '0', impulsivity: '0', newsSensitivity: '1',
  },
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
  const isLast = state.index + 1 === state.questions.length;
  const isAnswered = state.answers[q.id] !== undefined;
  const suggestedOpt = state.enrichment?.suggestedAnswers?.[q.id];

  view.innerHTML = `
    ${state.index === 0 && partner ? `<div class="card partner"><p style="margin:0">Vous venez de ${esc(partner)}.
      Comptez une dizaine de minutes ; à la fin, vous y serez ramené et vos ordres pourront être analysés.</p></div>` : ''}

    ${state.index === 0 ? `
    <div class="card" style="border: 2px dashed #94a3b8; background: #f8fafc; margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0;">⚡ Pré-remplissage et caractérisation via votre CV</h3>
        <span class="badge" style="background:#2563eb; color:white;">WorthKnowing AI</span>
      </div>
      <p class="small muted" style="margin:6px 0 14px;">
        Fournissez votre CV (PDF, Texte, Markdown, JSON) pour pré-remplir automatiquement vos réponses et affiner votre caractérisation, <b>sans sauter le questionnaire</b>.
      </p>

      <!-- Zone CV -->
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:12px; margin-bottom:12px;">
        <label style="font-weight:600; font-size:13px; display:block; margin-bottom:6px;">📄 Votre CV (PDF, Texte, Markdown, JSON)</label>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <input type="file" id="cvFileInput" accept=".pdf,.txt,.json,.md" style="flex:1; min-width:200px;">
        </div>
        <details style="margin-top:6px;"><summary class="small muted" style="cursor:pointer">Ou coller directement le texte de votre CV</summary>
          <textarea id="cvTextPaste" rows="3" placeholder="Collez le texte brut de votre CV ici..." style="width:100%; margin-top:6px; font-size:13px;">${esc(cvTextCached)}</textarea>
        </details>
      </div>

      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button class="primary" id="btnEnrichAll">⚡ Analyser le CV & Pré-remplir le questionnaire</button>
        <span class="small muted">Facultatif : vous pouvez aussi répondre directement au questionnaire ci-dessous.</span>
      </div>

      <div id="enrichResultBox" class="${state.enrichment ? '' : 'hidden'}" style="margin-top:14px;">
        ${renderEnrichmentSummary(state.enrichment)}
      </div>
    </div>` : (state.enrichment ? `
      <div style="margin-bottom:14px; font-size:12px; color:#15803d; background:#ecfdf5; border:1px solid #bbf7d0; padding:8px 12px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
        <span>✨ <b>Profil pré-rempli par votre CV</b>. Vérifiez et ajustez chaque réponse selon vos souhaits.</span>
        <button class="link mini" id="btnEditEnrichData" style="font-size:11px;">Modifier CV</button>
      </div>` : '')}

    <div class="card" id="questionCard">
      <div class="progress"><i style="width:${((state.index + 1) / state.questions.length) * 100}%"></i></div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
        <p class="small muted" style="margin:0;">Question ${state.index + 1} sur ${state.questions.length}</p>
        ${state.enrichment ? `<span class="badge" style="background:#ecfdf5; color:#15803d; border:1px solid #a7f3d0; font-size:11px;">✦ Suggestion appliquée</span>` : ''}
      </div>
      <h1 style="margin-top:12px;">${esc(q.text)}</h1>
      <div class="choices">
        ${q.options.map((o) => {
          const isSelected = state.answers[q.id] === o.id;
          const isSuggested = suggestedOpt === o.id;
          return `<button data-id="${esc(o.id)}" class="${isSelected ? 'primary' : ''}">
            ${esc(o.label)}${isSuggested ? ' <span style="font-size:11px; opacity:0.85; font-weight:normal;">(✦ Suggéré)</span>' : ''}
          </button>`;
        }).join('')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:22px; flex-wrap:wrap; gap:10px;">
        <div>
          ${state.index ? '<button class="link" id="back" style="padding:0;">← Question précédente</button>' : ''}
        </div>
        <div>
          ${isAnswered ? `
            <button class="primary" id="btnNextQuestion">
              ${isLast ? 'Confirmer et passer aux simulations (Étape 2) →' : 'Valider ce choix et Suivant →'}
            </button>
          ` : ''}
        </div>
      </div>
    </div>

    ${state.index === 0 ? `<p class="small muted" style="margin-top:14px;">Pour la démonstration, pré-remplir comme un persona de l’énoncé :
      ${Object.keys(PERSONAS).map((p) => `<button class="link" data-persona="${p}">${p}</button>`).join(', ')}.</p>` : ''}`;

  // Gestion des clics sur les choix de réponses
  view.querySelectorAll('.choices button').forEach((b) => (b.onclick = () => {
    state.answers[q.id] = b.dataset.id;
    state.index++;
    state.index < state.questions.length ? showQuestion() : startSimulations(state.answers);
  }));

  // Gestion du bouton Valider et Suivant
  const btnNext = $('#btnNextQuestion');
  if (btnNext) {
    btnNext.onclick = () => {
      state.index++;
      state.index < state.questions.length ? showQuestion() : startSimulations(state.answers);
    };
  }

  // Précédent
  if ($('#back')) {
    $('#back').onclick = () => {
      state.index--;
      showQuestion();
    };
  }

  // Raccourci vers le panneau CV si l'utilisateur veut le modifier
  if ($('#btnEditEnrichData')) {
    $('#btnEditEnrichData').onclick = () => {
      state.index = 0;
      showQuestion();
    };
  }

  // Pré-remplissage via persona démo
  view.querySelectorAll('[data-persona]').forEach((b) => (b.onclick = () => {
    state.answers = { ...PERSONAS[b.dataset.persona] };
    showQuestion();
  }));

  // Initialisation du panneau d'enrichissement (étape 1 uniquement)
  if (state.index === 0) {
    setupEnrichmentPanel();
  }
}

function renderEnrichmentSummary(res) {
  if (!res) return '';
  return `
    <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:12px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:18px;">✅</span>
        <h4 style="margin:0; color:#166534;">CV analysé & Réponses pré-remplies !</h4>
      </div>
      <p class="small" style="margin:6px 0 8px; color:#15803d;">
        Vos 13 questions ci-dessous ont été pré-remplies selon votre parcours.
        <b>Parcourez les questions ci-dessous pour valider ou ajuster chaque choix.</b>
      </p>
      <div class="small" style="background:#ffffff; border:1px solid #bbf7d0; border-radius:4px; padding:10px;">
        ${res.summary ? `<div style="white-space:pre-line; margin-bottom:6px; color:#334155;">${esc(res.summary)}</div>` : ''}
        ${res.highlights?.length ? `<ul style="margin:0; padding-left:18px; color:#475569;">${res.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>
  `;
}

function setupEnrichmentPanel() {
  const btnEnrichAll = $('#btnEnrichAll');
  const cvFileInput = $('#cvFileInput');
  const cvTextPaste = $('#cvTextPaste');

  if (cvFileInput) {
    cvFileInput.onchange = () => {
      if (cvFileInput.files && cvFileInput.files[0]) {
        cvFileCached = cvFileInput.files[0];
      }
    };
  }

  if (cvTextPaste) {
    cvTextPaste.oninput = () => {
      cvTextCached = cvTextPaste.value;
    };
  }

  if (btnEnrichAll) {
    btnEnrichAll.onclick = async () => {
      const hasCvFile = cvFileCached || (cvFileInput?.files && cvFileInput.files[0]);
      const hasCvText = Boolean(cvTextCached.trim());

      if (!hasCvFile && !hasCvText) {
        return alert('Veuillez sélectionner un fichier CV ou coller le texte de votre CV.');
      }

      btnEnrichAll.disabled = true;
      btnEnrichAll.textContent = 'Analyse du CV en cours…';

      try {
        let cvPayload = undefined;
        if (hasCvFile) {
          const file = cvFileCached || cvFileInput.files[0];
          const isText = file.name.endsWith('.txt') || file.name.endsWith('.json') || file.name.endsWith('.md');
          const readerData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            if (isText) reader.readAsText(file);
            else reader.readAsDataURL(file);
          });
          cvPayload = isText
            ? { text: readerData, filename: file.name }
            : { base64: readerData, filename: file.name };
        } else if (hasCvText) {
          cvPayload = { text: cvTextCached.trim(), filename: 'cv.txt' };
        }

        let res;
        try {
          res = await api('POST', '/parser/enrich', { cv: cvPayload, ...cvPayload });
        } catch (enrichErr) {
          // Si le serveur actif tourne encore sur une version sans /enrich, repli transparent sur /parser/cv
          if (enrichErr.message?.includes('Cannot POST') || enrichErr.status === 404) {
            const rawCv = await api('POST', '/parser/cv', cvPayload);
            res = {
              cv: rawCv,
              suggestedAnswers: rawCv.suggestedAnswers,
              inferredScores: rawCv.inferredScores,
              highlights: rawCv.highlights,
              summary: rawCv.summary,
            };
          } else {
            throw enrichErr;
          }
        }
        state.enrichment = res;

        // Pré-remplissage des réponses du questionnaire
        state.answers = { ...res.suggestedAnswers, ...state.answers };

        // Affichage du résultat d'enrichissement
        const resultBox = $('#enrichResultBox');
        if (resultBox) {
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = renderEnrichmentSummary(res);
        }

        // Rafraîchit la carte de question sans sauter le formulaire
        showQuestion();
      } catch (err) {
        alert('Erreur lors de l’analyse du CV : ' + err.message);
      } finally {
        if (btnEnrichAll) {
          btnEnrichAll.disabled = false;
          btnEnrichAll.textContent = '⚡ Analyser le CV & Pré-remplir le questionnaire';
        }
      }
    };
  }
}

// ------------------------------------------------------------------ Étape 2 : simulations
async function startSimulations(answers) {
  try {
    state.session = await api('POST', '/evaluation/start', {
      answers: answers || state.answers,
      enrichment: state.enrichment || undefined,
    });
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

  let currentChoiceIdx = 0;

  view.innerHTML = `
    <div class="card">
      <div class="progress"><i style="width:${(state.index / total) * 100}%"></i></div>
      <p class="small muted">Situation ${state.index + 1} sur ${total} : ${esc(s.title.toLowerCase())}</p>
      <h1>${esc(s.alias)} <span class="badge grey">${esc(s.maskLabel)}</span></h1>
      ${lineChart(s.context)}
      <p class="small muted">Prix sur les 90 dernières séances (base 100).</p>
      <div class="quote">${esc(s.headline)} <span class="badge grey">manchette fictive</span></div>
      <p><b>${esc(s.situation)}</b></p>

      <!-- Slider interactif dans la mise en situation -->
      <div class="slider-box" style="margin:20px 0; padding:16px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:600; font-size:14px; color:#1e293b;">Curseur de décision (Slider) :</span>
          <span class="badge" id="sliderChoiceBadge" style="background:#2563eb; color:white;">Option 1 / ${s.choices.length}</span>
        </div>
        <input type="range" id="scenarioSlider" min="0" max="${s.choices.length - 1}" step="1" value="0" style="width:100%; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b; margin-top:4px;">
          <span>Prudent / Vente</span>
          <span>Neutre</span>
          <span>Agressif / Achat</span>
        </div>
        <div style="margin-top:12px; padding:10px; background:white; border:1px solid #e2e8f0; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span class="small muted">Option sélectionnée avec le curseur :</span><br>
            <b id="activeChoiceText" style="font-size:14px; color:#0f172a;">${esc(s.choices[0].label)}</b>
          </div>
          <button class="primary" id="sliderConfirmBtn" style="flex:none; margin-left:12px;">Confirmer avec le curseur</button>
        </div>
      </div>

      <p class="small muted" style="margin:16px 0 6px;">Ou cliquez directement sur l'une des options :</p>
      <div class="choices">${s.choices.map((c, i) => `<button data-id="${c.id}" data-idx="${i}">${esc(c.label)}</button>`).join('')}</div>
      <div class="error" id="error" role="alert"></div>
    </div>`;

  const slider = $('#scenarioSlider');
  const badge = $('#sliderChoiceBadge');
  const activeText = $('#activeChoiceText');
  const buttons = view.querySelectorAll('.choices button');

  const updateSelection = (idx) => {
    currentChoiceIdx = idx;
    slider.value = idx;
    badge.textContent = `Option ${idx + 1} / ${s.choices.length}`;
    activeText.textContent = s.choices[idx].label;
    buttons.forEach((btn, i) => {
      btn.style.outline = i === idx ? '2px solid #2563eb' : '';
      btn.style.background = i === idx ? '#eff6ff' : '';
    });
  };

  slider.oninput = (e) => updateSelection(Number(e.target.value));

  const submitDecision = async (choiceId) => {
    view.querySelectorAll('button').forEach((x) => (x.disabled = true));
    slider.disabled = true;
    $('#error').textContent = '';
    s.decisionTimeMs ??= Date.now() - state.shownAt;
    try {
      await api('POST', `/evaluation/${state.session.evaluationId}/decisions`, {
        scenarioId: s.id,
        choiceId,
        decisionTimeMs: s.decisionTimeMs,
      });
    } catch (err) {
      $('#error').textContent = err.message;
      view.querySelectorAll('button').forEach((x) => (x.disabled = false));
      slider.disabled = false;
      return;
    }
    state.index++;
    state.index < total ? showScenario() : showReveal();
  };

  $('#sliderConfirmBtn').onclick = () => submitDecision(s.choices[currentChoiceIdx].id);

  buttons.forEach((b) => (b.onclick = () => {
    updateSelection(Number(b.dataset.idx));
    submitDecision(b.dataset.id);
  }));

  updateSelection(0);
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
  const declaredScores = state.session?.declared || (state.result && state.result.observed) || {};
  const observedScores = state.result.observed;

  view.innerHTML = `
    <div class="card">
      <h1>Votre reflet</h1>
      <p class="muted">À gauche, comment vous vous décriviez. À droite, comment vous avez agi. Plus les deux côtés diffèrent, plus le paramètre mérite une règle.</p>
      
      <!-- Graphique Hexagonal à 6 critères : what you think vs what you are -->
      ${hexagonChart(declaredScores, observedScores)}

      ${mirrorHead('Vous disiez', 'Vous avez fait')}
      ${params.map((p) => mirror(esc(p.label), p.declared, p.observed)).join('')}
    </div>
    <div class="card">
      <h2>Vos règles</h2>
      <p class="muted">Pour chaque point fragile, fixez-vous une règle. ${partner ? `${esc(partner)} vous la rappellera` : 'Elle vous sera rappelée'}
        avant tout ordre qui la concerne. Le texte et le seuil sont les vôtres : modifiez-les à tout moment.</p>
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
        et la composition de votre portefeuille à WorthKnowing, et à recevoir l’état de votre profil, votre score de dérive et le texte de vos règles.</p>` : ''}
    </div>`;

  view.querySelectorAll('.rule').forEach((el) => {
    const box = el.querySelector('input[type=checkbox]');
    box.onchange = () => el.classList.toggle('off', !box.checked);
    const preview = () => {
      el.querySelector('.preview').textContent =
        'Vous lirez : « ' + el.querySelector('.text').value.replace('{seuil}', el.querySelector('.threshold').value) + ' »';
    };
    el.querySelector('.text').oninput = el.querySelector('.threshold').oninput = preview;
    preview();
  });

  $('#backToReveal').onclick = showReveal;
  $('#save').onclick = async () => {
    const rules = [...view.querySelectorAll('.rule')]
      .filter((el) => el.querySelector('input[type=checkbox]').checked)
      .map((el) => ({
        param: el.dataset.param,
        text: el.querySelector('.text').value,
        threshold: Number(el.querySelector('.threshold').value),
      }));
    $('#save').disabled = true;
    $('#error').textContent = '';
    try {
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
