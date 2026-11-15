// Évaluation en 4 étapes : comment vous vous voyez (notes de 0 à 10, puis quelques questions)
// -> simulations -> révélation -> règles.
// Sert aussi à la réévaluation (l'étape 1 est alors sautée).
// L'évaluation en cours est mémorisée dans l'onglet : recharger la page reprend là où on en était.

const view = $('#view');
const state = { questions: [], answers: {}, session: null, index: 0, shownAt: 0, result: null, cv: null };
const partner = pending.get()?.partner; // défini si l'utilisateur vient de la plateforme de courtage
const selfQuestions = () => state.questions.filter((q) => q.kind === 'self');
const infoQuestions = () => state.questions.filter((q) => q.kind === 'info');

// Profils de démonstration (les 3 personas de l'énoncé) pour remplir l'étape 1 en un clic : notes de 0 à 10, puis réponses.
const PERSONAS = {
  Amira: {
    riskTolerance: 8, lossAversion: 4, fomo: 6, concentration: 4, impulsivity: 6, newsSensitivity: 4,
    horizon: '15+', objective: 'growth', esg: 'low', crypto: 'yes',
  },
  Mateo: {
    riskTolerance: 4, lossAversion: 4, fomo: 3, concentration: 3, impulsivity: 3, newsSensitivity: 4,
    horizon: '8-12', objective: 'balanced', esg: 'high', crypto: 'no',
  },
  Robert: {
    riskTolerance: 3, lossAversion: 4, fomo: 3, concentration: 1, impulsivity: 1, newsSensitivity: 4,
    horizon: '3-5', objective: 'preserve', esg: 'medium', crypto: 'no',
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

// ------------------------------------------------------------------ Étape 1a : se noter de 0 à 10
function showSelf() {
  setStep(1);
  const qs = selfQuestions();
  view.innerHTML = `
    ${partner ? `<div class="card partner"><p style="margin:0">Vous venez de ${esc(partner)}.
      Comptez une dizaine de minutes ; à la fin, vous y serez ramené et vos ordres pourront être analysés.</p></div>` : ''}
    <div class="card">
      <h1>Comment vous voyez-vous ?</h1>
      <p class="muted">Donnez-vous une note de 0 à 10 sur chacun de ces six traits. Aucune note n’est meilleure qu’une autre :
        les mises en situation montreront ensuite comment vous agissez, et on comparera les deux.</p>
      ${qs.map((q) => {
        const v = state.answers[q.id];
        const set = v !== undefined;
        return `<div class="scale ${set ? 'set' : ''}" data-id="${esc(q.id)}">
          <div class="scale-head"><label for="s-${esc(q.id)}">${esc(q.text)}</label>
            <output for="s-${esc(q.id)}">${set ? `${v} / ${q.scale.max}` : 'à noter'}</output></div>
          <input type="range" id="s-${esc(q.id)}" min="${q.scale.min}" max="${q.scale.max}" step="1" value="${set ? v : (q.scale.min + q.scale.max) / 2}">
          <div class="scale-ends"><span>${q.scale.min} · ${esc(q.scale.low)}</span><span>${esc(q.scale.high)} · ${q.scale.max}</span></div>
        </div>`;
      }).join('')}
      <div class="error" id="error" role="alert"></div>
      <div class="actions"><button class="primary" id="next">Continuer</button></div>
    </div>
    <div class="card quiet">
      <h2>Votre CV (facultatif)</h2>
      <p class="small muted">Vous pouvez passer cette étape. Si vous fournissez un CV, il ne remplit <b>aucune</b> de vos réponses et
        n’entre <b>jamais</b> dans votre profil de référence, qui ne dépend que de vos réponses et de vos simulations.
        Il sert uniquement à détecter votre niveau d’expertise en trading, utilisé plus tard pour mettre en contexte
        l’analyse de vos trades. Le texte du CV n’est pas conservé.</p>
      <div id="cvBox">${cvBoxHtml(state.cv)}</div>
    </div>
    <p class="small muted" style="margin-top:14px;">Pour la démonstration, pré-remplir comme un persona de l’énoncé :
      ${Object.keys(PERSONAS).map((p) => `<button class="link" data-persona="${p}">${p}</button>`).join(', ')}.</p>`;

  // Une note n'est enregistrée que si la personne a touché le curseur : la position de départ n'est pas une réponse.
  view.querySelectorAll('.scale').forEach((el) => {
    const input = el.querySelector('input');
    const q = qs.find((x) => x.id === el.dataset.id);
    const record = () => {
      state.answers[q.id] = Number(input.value);
      el.classList.add('set');
      el.querySelector('output').textContent = `${input.value} / ${q.scale.max}`;
      $('#error').textContent = '';
    };
    input.oninput = input.onpointerdown = input.onkeydown = record;
  });

  $('#next').onclick = () => {
    const missing = qs.filter((q) => state.answers[q.id] === undefined);
    if (missing.length) {
      $('#error').textContent = missing.length === 1
        ? `Il reste une note à donner : « ${missing[0].text} ».`
        : `Il reste ${missing.length} notes à donner (curseurs marqués « à noter »).`;
      return;
    }
    state.index = 0;
    showQuestion();
  };

  view.querySelectorAll('[data-persona]').forEach((b) => (b.onclick = () => {
    state.answers = { ...PERSONAS[b.dataset.persona] };
    showSelf();
  }));
  setupCvBox();
}

// ------------------------------------------------------------------ Étape 1b : quelques questions
function showQuestion() {
  setStep(1);
  const qs = infoQuestions();
  if (!qs.length) return startSimulations(state.answers);
  const q = qs[state.index];
  const isLast = state.index + 1 === qs.length;
  const advance = () => {
    state.index++;
    state.index < qs.length ? showQuestion() : startSimulations(state.answers);
  };

  view.innerHTML = `
    <div class="card" id="questionCard">
      <div class="progress"><i style="width:${((state.index + 1) / qs.length) * 100}%"></i></div>
      <p class="small muted" style="margin:0;">Question ${state.index + 1} sur ${qs.length}</p>
      <h1 style="margin-top:12px;">${esc(q.text)}</h1>
      <div class="choices">
        ${q.options.map((o) => `<button data-id="${esc(o.id)}" class="${state.answers[q.id] === o.id ? 'primary' : ''}">${esc(o.label)}</button>`).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:22px; flex-wrap:wrap; gap:10px;">
        <button class="link" id="back">← ${state.index ? 'Question précédente' : 'Revenir à mes notes'}</button>
        ${state.answers[q.id] !== undefined ? `<button class="primary" id="btnNextQuestion">${isLast ? 'Passer aux mises en situation' : 'Suivant'}</button>` : ''}
      </div>
    </div>`;

  view.querySelectorAll('.choices button').forEach((b) => (b.onclick = () => {
    state.answers[q.id] = b.dataset.id;
    advance();
  }));
  if ($('#btnNextQuestion')) $('#btnNextQuestion').onclick = advance;
  $('#back').onclick = () => {
    if (!state.index) return showSelf();
    state.index--;
    showQuestion();
  };
}

// CV facultatif : analysé côté serveur, conservé à part, jamais utilisé pour remplir les réponses.
function cvBoxHtml(cv) {
  if (cv) {
    return `<p class="small"><span class="badge ok">CV pris en compte</span> analysé le ${esc(day(cv.analysedAt))}.</p>
      ${cv.summary ? `<p class="small muted" style="white-space:pre-line">${esc(cv.summary)}</p>` : ''}
      <button class="mini" id="cvRemove">Retirer mon CV</button>`;
  }
  return `<input type="file" id="cvFile" accept=".pdf,.txt,.md,.json" aria-label="Fichier du CV (PDF ou texte, 5 Mo max.)">
    <div class="row"><button class="mini" id="cvSend">Analyser mon CV</button><span class="small muted">PDF ou texte, 5 Mo max.</span></div>
    <div class="error" id="cvError" role="alert"></div>`;
}

function setupCvBox() {
  if ($('#cvRemove')) $('#cvRemove').onclick = async () => {
    await api('DELETE', '/parser/cv').catch((err) => alert(err.message));
    state.cv = null;
    $('#cvBox').innerHTML = cvBoxHtml(null);
    setupCvBox();
  };
  if (!$('#cvSend')) return;
  $('#cvSend').onclick = async () => {
    const file = $('#cvFile').files?.[0];
    if (!file) return ($('#cvError').textContent = 'Choisissez un fichier, ou continuez sans CV.');
    if (file.size > 5 * 1024 * 1024) return ($('#cvError').textContent = 'Fichier trop volumineux (5 Mo maximum).');
    $('#cvSend').disabled = true;
    try {
      const isText = /\.(txt|md|json)$/i.test(file.name);
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        isText ? reader.readAsText(file) : reader.readAsDataURL(file);
      });
      state.cv = await api('POST', '/parser/cv', isText ? { text: data, filename: file.name } : { base64: data, filename: file.name });
      $('#cvBox').innerHTML = cvBoxHtml(state.cv);
      setupCvBox();
    } catch (err) {
      $('#cvError').textContent = err.message;
      $('#cvSend').disabled = false;
    }
  };
}

// ------------------------------------------------------------------ Étape 2 : simulations
async function startSimulations(answers) {
  try {
    state.session = await api('POST', '/evaluation/start', {
      answers: answers || state.answers,
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

/** Les trois niveaux de confiance proposés après chaque réponse (ids attendus par le serveur). */
const CONFIDENCES = [['high', 'Sûr'], ['medium', 'Plutôt sûr'], ['low', 'Hésitant']];
function showScenario() {
  setStep(2);
  const s = state.session.scenarios[state.index];
  const total = state.session.scenarios.length;
  state.shownAt = Date.now(); // sert à mesurer le temps de décision
  s.decisionTimeMs = undefined;
  let chosen = null;
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
      <div class="choices trio" id="choiceRow">${s.choices.map((c) => `<button data-id="${esc(c.id)}" aria-pressed="false">${esc(c.label)}</button>`).join('')}</div>
      <p class="small muted" style="margin:10px 0 0">Vendre : tout vendre · Garder : ne rien changer · Acheter : ajouter 50 % de plus.</p>
      <div id="confidenceBox" class="hidden">
        <p style="margin-top:18px">Quel est votre niveau de confiance dans cette décision ?</p>
        <div class="choices trio" id="confidenceRow">${CONFIDENCES.map(([id, label]) => `<button data-confidence="${id}">${esc(label)}</button>`).join('')}</div>
      </div>
      <div class="error" id="error" role="alert"></div>
    </div>`;
  const choiceButtons = [...view.querySelectorAll('#choiceRow button')];
  const confidenceButtons = [...view.querySelectorAll('#confidenceRow button')];
  const lock = (disabled) => [...choiceButtons, ...confidenceButtons].forEach((x) => (x.disabled = disabled));
  // 1. Le choix : on peut en changer tant que la confiance n'est pas donnée. Le temps de décision est celui du DERNIER choix.
  choiceButtons.forEach((b) => (b.onclick = () => {
    chosen = b.dataset.id;
    s.decisionTimeMs = Date.now() - state.shownAt;
    choiceButtons.forEach((x) => {
      const on = x === b;
      x.setAttribute('aria-pressed', String(on));
      x.style.background = on ? 'var(--accent-soft)' : '';
      x.style.borderColor = on ? 'var(--accent)' : '';
    });
    $('#confidenceBox').classList.remove('hidden');
  }));
  // 2. La confiance : envoie la réponse. En cas d'échec réseau, on peut renvoyer sans fausser le temps de décision.
  confidenceButtons.forEach((b) => (b.onclick = async () => {
    lock(true);
    $('#error').textContent = '';
    try {
      await api('POST', `/evaluation/${state.session.evaluationId}/decisions`, {
        scenarioId: s.id, choiceId: chosen, decisionTimeMs: s.decisionTimeMs, confidence: b.dataset.confidence,
      });
    } catch (err) {
      $('#error').textContent = err.message; // le serveur remplace la décision : on peut renvoyer
      lock(false);
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
  $('#next').onclick = () => showRules().catch((err) => showError(err, showRules));
}

// ------------------------------------------------------------------ Étape 4 : règles auto-définies
/** Lecture d'ensemble de la fiabilité du profil (les évaluations d'avant la confiance n'en ont pas : rien n'est affiché). */
function reliabilityHtml(r) {
  if (!r) return '';
  return `<p class="small" style="margin:0 0 10px"><b>Fiabilité de ce profil : ${esc(r.label)}.</b> <span class="muted">${esc(r.summary)}</span></p>`;
}
/** Une règle dans l'écran de fin d'évaluation : une case, le comportement encadré et une phrase libre. */
function ruleRowHtml(row, params) {
  const p = params.find((x) => x.param === row.param);
  return `<div class="rule ${row.risk ? 'risk' : ''} ${row.on ? '' : 'off'}" data-param="${esc(row.param ?? '')}">
    <div class="row">
      <input type="checkbox" class="on" ${row.on ? 'checked' : ''} aria-label="Activer cette règle">
      ${row.custom
        ? `<select class="param" aria-label="Comportement encadré">${params.map((x) => `<option value="${x.param}">${esc(x.label)}</option>`).join('')}</select>`
        : `<b>${esc(p.label)}</b>`}
      ${row.risk ? '<span class="badge warn" style="flex:none">à encadrer</span>' : ''}
    </div>
    ${row.reason ? `<p class="small muted">${esc(row.reason)}</p>` : ''}
    <div class="editor">
      <textarea class="text" rows="2" maxlength="300" placeholder="Écrivez votre règle, avec vos mots." aria-label="Texte de la règle">${esc(row.text)}</textarea>
      <p class="small muted when" style="margin:6px 0 0"></p>
    </div>
  </div>`;
}

async function showRules() {
  setStep(4);
  const params = state.result.params;
  // Le profil déclaré vient du résultat : il est aussi disponible après un rechargement de page.
  const declaredScores = Object.fromEntries(params.map((p) => [p.param, p.declared]));
  const observedScores = state.result.observed;
  // Réévaluation : on repart des règles déjà écrites (toutes, même plusieurs sur un même comportement).
  let mine = [];
  if (state.session.kind === 'reevaluation') mine = (await api('GET', '/rules').catch(() => ({ rules: [] }))).rules;
  const rows = params.flatMap((p) => {
    const existing = mine.filter((r) => r.param === p.param);
    return existing.length
      ? existing.map((r) => ({ param: p.param, text: r.text, on: true, risk: p.atRisk, reason: p.reason }))
      : [{ param: p.param, text: p.suggestedRule.text, on: p.atRisk, risk: p.atRisk, reason: p.reason }];
  });

  view.innerHTML = `
    <div class="card">
      <h1>Votre reflet</h1>
      <p class="muted">À gauche, comment vous vous décriviez. À droite, comment vous avez agi. Plus les deux côtés diffèrent, plus le paramètre mérite une règle.</p>
      ${hexagonChart(declaredScores, observedScores)}
      ${reliabilityHtml(state.result.reliability)}
      ${mirrorHead('Vous disiez', 'Vous avez fait')}
      ${params.map((p) => mirror(esc(p.label), p.declared, p.observed, p.reliability ? `fiabilité ${esc(p.reliability.label)}` : '')).join('')}
      ${params.some((p) => p.reliability) ? '<p class="small muted" style="margin:8px 0 0">La fiabilité dit si vos réponses se recoupent et si vous étiez sûr de vous. Elle ne mesure pas la justesse du score : seuls vos vrais ordres, un par un, l’affineront.</p>' : ''}
    </div>
    <div class="card">
      <h2>Vos règles</h2>
      <p class="muted">Pour chaque point fragile, écrivez-vous une règle, avec vos mots. ${partner ? `${esc(partner)} vous la rappellera` : 'Elle vous sera rappelée'}
        avant tout ordre qui met ce comportement en jeu. Vous pourrez en ajouter, les modifier ou les retirer à tout moment depuis WorthKnowing.</p>
      <div id="ruleRows">${rows.map((r) => ruleRowHtml(r, params)).join('')}</div>
      <button class="mini" id="addRule">Ajouter une autre règle</button>
      <div class="error" id="error" role="alert"></div>
      <div class="actions">
        <button class="primary" id="save">${partner ? `Activer mon profil et retourner à ${esc(partner)}` : 'Activer mon profil'}</button>
        <button id="backToReveal">Revoir la révélation</button>
      </div>
      ${partner && pending.get().link ? `<p class="small muted" style="margin-top:14px">En continuant, vous autorisez ${esc(partner)} à envoyer vos ordres
        et la composition de votre portefeuille à WorthKnowing, et à recevoir l’état de votre profil, votre score de dérive et le texte de vos règles.</p>` : ''}
    </div>`;

  const wire = (el) => {
    const box = el.querySelector('.on');
    const select = el.querySelector('.param');
    const paramOf = () => (select ? select.value : el.dataset.param);
    const when = () => {
      el.querySelector('.when').textContent = 'Rappelée avant : ' + params.find((p) => p.param === paramOf()).suggestedRule.trigger + '.';
    };
    box.onchange = () => el.classList.toggle('off', !box.checked);
    if (select) select.onchange = when;
    when();
  };
  view.querySelectorAll('#ruleRows .rule').forEach(wire);
  $('#addRule').onclick = () => {
    $('#ruleRows').insertAdjacentHTML('beforeend', ruleRowHtml({ custom: true, text: '', on: true }, params));
    const el = $('#ruleRows').lastElementChild;
    wire(el);
    el.querySelector('.text').focus();
  };

  $('#backToReveal').onclick = showReveal;
  $('#save').onclick = async () => {
    const rules = [...view.querySelectorAll('#ruleRows .rule')]
      .filter((el) => el.querySelector('.on').checked)
      .map((el) => ({ param: el.querySelector('.param')?.value ?? el.dataset.param, text: el.querySelector('.text').value }));
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
    state.cv = me.cvProfile ?? null;
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
        if (state.result) return await showRules();
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
    showSelf();
  }
}
init();
