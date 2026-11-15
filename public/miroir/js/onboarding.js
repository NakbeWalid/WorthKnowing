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
const CHOICE_ICONS = { sell: ['arrowDown', 'Tout vendre'], keep: ['pause', 'Ne rien changer'], buy: ['arrowUp', '+50 %'] };

function setStep(n) {
  document.querySelectorAll('#steps li').forEach((el, i) => {
    el.classList.toggle('on', i === n - 1);
    el.classList.toggle('done', i < n - 1);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
/** Remplace la vue avec l'animation d'entrée. */
const render = (html) => UI.swap(view, html);

/** Écran d'erreur avec bouton « Réessayer » : une panne réseau ne laisse jamais la page figée. */
function showError(err, retry) {
  render(`<div class="step-card"><h1>Un problème est survenu</h1>
    <p class="error" style="margin-top:14px">${esc(err.message)}</p>
    <div class="step-actions"><button class="btn primary" id="retry">${UI.icon('refresh', 'sm')} Réessayer</button></div></div>`);
  $('#retry').onclick = retry;
}

// ------------------------------------------------------------------ Étape 1a : se noter de 0 à 10
function showSelf() {
  setStep(1);
  const qs = selfQuestions();
  render(`
    ${partner ? `<div class="partner-card" style="margin:0 0 18px"><div class="avatar">${UI.icon('link', 'sm')}</div>
      <div>Vous venez de <b>${esc(partner)}</b>. Environ 10 minutes, puis retour automatique.</div></div>` : ''}
    <div class="step-card">
      <span class="eyebrow">Étape 1</span>
      <h1 style="margin-top:8px">Comment vous <em>voyez-vous</em> ?</h1>
      <p class="lead">Notez-vous de 0 à 10. Aucune note n’est meilleure qu’une autre.</p>
      ${qs.map((q) => {
        const v = state.answers[q.id];
        const set = v !== undefined;
        const val = set ? v : (q.scale.min + q.scale.max) / 2;
        return `<div class="scale ${set ? 'set' : ''}" data-id="${esc(q.id)}">
          <div class="scale-head"><label for="s-${esc(q.id)}">${esc(q.text)}</label>
            <output for="s-${esc(q.id)}">${set ? v : '—'}</output></div>
          <input class="range ${set ? '' : 'unset'}" type="range" id="s-${esc(q.id)}" min="${q.scale.min}" max="${q.scale.max}" step="1" value="${val}"
            style="--fill:${((val - q.scale.min) / (q.scale.max - q.scale.min)) * 100}%">
          <div class="scale-ends"><span>${esc(q.scale.low)}</span><span>${esc(q.scale.high)}</span></div>
        </div>`;
      }).join('')}
      <div class="error" id="error" role="alert"></div>
      <div class="step-actions">
        <div class="persona-fill">Démo : ${Object.keys(PERSONAS).map((p) => `<button class="chip" data-persona="${p}">${p}</button>`).join('')}</div>
        <button class="btn primary lg" id="next">Continuer ${UI.icon('arrowRight', 'sm')}</button>
      </div>
    </div>
    <div class="step-card" style="padding-top:26px;padding-bottom:26px">
      <div class="row between wrap"><div><h2>CV <span class="faint" style="font-weight:400">· facultatif</span></h2>
        <p class="small muted" style="margin-top:4px">Sert uniquement à situer votre expertise. N’entre jamais dans votre profil.</p></div></div>
      <div id="cvBox" style="margin-top:16px">${cvBoxHtml(state.cv)}</div>
    </div>`);

  // Une note n'est enregistrée que si la personne a touché le curseur : la position de départ n'est pas une réponse.
  view.querySelectorAll('.scale').forEach((el) => {
    const input = el.querySelector('input');
    const q = qs.find((x) => x.id === el.dataset.id);
    const record = () => {
      state.answers[q.id] = Number(input.value);
      el.classList.add('set');
      input.classList.remove('unset');
      input.style.setProperty('--fill', `${((input.value - q.scale.min) / (q.scale.max - q.scale.min)) * 100}%`);
      el.querySelector('output').textContent = input.value;
      $('#error').textContent = '';
    };
    input.oninput = input.onpointerdown = input.onkeydown = record;
  });

  $('#next').onclick = () => {
    const missing = qs.filter((q) => state.answers[q.id] === undefined);
    if (missing.length) {
      $('#error').textContent = missing.length === 1
        ? `Il reste une note : « ${missing[0].text} ».`
        : `Il reste ${missing.length} notes à donner.`;
      view.querySelector(`.scale[data-id="${missing[0].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  render(`
    <div class="step-card">
      <div class="progress-line"><i style="width:${(state.index / qs.length) * 100}%"></i></div>
      <span class="counter">Question ${state.index + 1} / ${qs.length}</span>
      <h1 style="margin-top:10px">${esc(q.text)}</h1>
      <div class="options">
        ${q.options.map((o) => `<button class="option ${state.answers[q.id] === o.id ? 'on' : ''}" data-id="${esc(o.id)}"><span class="radio"></span>${esc(o.label)}</button>`).join('')}
      </div>
      <div class="step-actions">
        <button class="btn link" id="back">${UI.icon('arrowLeft', 'sm')} Retour</button>
        ${state.answers[q.id] !== undefined ? `<button class="btn primary" id="btnNextQuestion">${isLast ? 'Aux mises en situation' : 'Suivant'} ${UI.icon('arrowRight', 'sm')}</button>` : ''}
      </div>
    </div>`);
  requestAnimationFrame(() => { const bar = view.querySelector('.progress-line i'); if (bar) bar.style.width = `${((state.index + 1) / qs.length) * 100}%`; });

  view.querySelectorAll('.option').forEach((b) => (b.onclick = () => {
    state.answers[q.id] = b.dataset.id;
    view.querySelectorAll('.option').forEach((x) => x.classList.toggle('on', x === b));
    setTimeout(advance, 260); // laisse voir la sélection
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
    return `<div class="notice ink">${UI.icon('check', 'sm')}<div class="grow"><b>CV pris en compte</b>
      <span class="faint small"> · ${esc(day(cv.analysedAt))}</span>
      ${cv.summary ? `<p class="small muted" style="margin-top:4px;white-space:pre-line">${esc(cv.summary)}</p>` : ''}</div>
      <button class="btn ghost sm" id="cvRemove">Retirer</button></div>`;
  }
  return `<label class="cv-drop">${UI.icon('upload', 'lg')}
      <div class="grow"><b class="small" id="cvName">Choisir un fichier</b><div class="tiny faint">PDF ou texte, 5 Mo max.</div></div>
      <input type="file" id="cvFile" accept=".pdf,.txt,.md,.json" aria-label="Fichier du CV"></label>
    <div class="row" style="margin-top:12px"><button class="btn soft sm" id="cvSend">Analyser</button></div>
    <div class="error" id="cvError" role="alert"></div>`;
}

function setupCvBox() {
  if ($('#cvRemove')) $('#cvRemove').onclick = async () => {
    await api('DELETE', '/parser/cv').catch((err) => UI.alert('Erreur', esc(err.message)));
    state.cv = null;
    $('#cvBox').innerHTML = cvBoxHtml(null);
    setupCvBox();
  };
  if (!$('#cvSend')) return;
  $('#cvFile').onchange = () => { $('#cvName').textContent = $('#cvFile').files?.[0]?.name ?? 'Choisir un fichier'; $('#cvError').textContent = ''; };
  $('#cvSend').onclick = async () => {
    const file = $('#cvFile').files?.[0];
    if (!file) return ($('#cvError').textContent = 'Choisissez un fichier, ou continuez sans CV.');
    if (file.size > 5 * 1024 * 1024) return ($('#cvError').textContent = 'Fichier trop volumineux (5 Mo maximum).');
    $('#cvSend').disabled = true;
    $('#cvSend').innerHTML = '<span class="spinner"></span> Analyse…';
    try {
      const isText = /\.(txt|md|json)$/i.test(file.name);
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        isText ? reader.readAsText(file) : reader.readAsDataURL(file);
      });
      state.cv = await api('POST', '/parser/cv', isText ? { text: data, filename: file.name } : { base64: data, filename: file.name });
      UI.swap($('#cvBox'), cvBoxHtml(state.cv));
      setupCvBox();
    } catch (err) {
      $('#cvError').textContent = err.message;
      $('#cvSend').disabled = false;
      $('#cvSend').textContent = 'Analyser';
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
  render(`
    <div class="step-card" style="text-align:center;padding:52px 40px">
      <div class="avatar" style="width:56px;height:56px;margin:0 auto 18px">${UI.icon('chart', 'lg')}</div>
      <span class="eyebrow">Étape 2</span>
      <h1 style="margin-top:8px">${n} mises en <em>situation</em></h1>
      <div class="grid g-3" style="margin:28px 0 8px;text-align:left">
        <div class="widget tint"><b class="small">Courbes réelles</b><p class="tiny muted" style="margin-top:4px">Tirées des cinq dernières années.</p></div>
        <div class="widget tint"><b class="small">Noms masqués</b><p class="tiny muted" style="margin-top:4px">Pour que vous ne reconnaissiez pas l’épisode.</p></div>
        <div class="widget tint"><b class="small">Aucune bonne réponse</b><p class="tiny muted" style="margin-top:4px">On observe votre comportement.</p></div>
      </div>
      <button class="btn primary lg" id="go" style="margin-top:20px">Commencer ${UI.icon('arrowRight', 'sm')}</button>
    </div>`);
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
  render(`
    <div class="step-card">
      <div class="progress-line"><i style="width:${(state.index / total) * 100}%"></i></div>
      <div class="row between"><span class="counter">Situation ${state.index + 1} / ${total}</span><span class="pill outline">${esc(s.maskLabel)}</span></div>
      <h1 style="margin-top:10px">${esc(s.alias)}</h1>
      <div class="chart-box scenario-chart"><canvas id="scChart" aria-label="Prix sur les 90 dernières séances, base 100"></canvas></div>
      <p class="tiny faint">90 dernières séances · base 100</p>
      <div class="headline-card"><q>${esc(s.headline)}</q><div class="tiny faint" style="margin-top:6px">Manchette fictive</div></div>
      <p style="font-size:16px"><b>${esc(s.situation)}</b></p>
      <div class="options trio" id="choiceRow">${s.choices.map((c) => {
        const [ico, sub] = CHOICE_ICONS[c.id] ?? ['chevron', ''];
        return `<button class="option" data-id="${esc(c.id)}" aria-pressed="false"><span class="opt-icon">${UI.icon(ico)}</span>${esc(c.label)}<small>${sub}</small></button>`;
      }).join('')}</div>
      <div id="confidenceBox" class="hidden" style="margin-top:22px">
        <p class="small muted">Votre niveau de confiance ?</p>
        <div class="options trio conf" id="confidenceRow" style="margin-top:10px">${CONFIDENCES.map(([id, label]) => `<button class="option" data-confidence="${id}">${esc(label)}</button>`).join('')}</div>
      </div>
      <div class="error" id="error" role="alert"></div>
    </div>`);
  UI.scenario($('#scChart'), s.context);
  requestAnimationFrame(() => { const bar = view.querySelector('.progress-line i'); if (bar) bar.style.width = `${((state.index + 1) / total) * 100}%`; });

  const choiceButtons = [...view.querySelectorAll('#choiceRow .option')];
  const confidenceButtons = [...view.querySelectorAll('#confidenceRow .option')];
  const lock = (disabled) => [...choiceButtons, ...confidenceButtons].forEach((x) => (x.disabled = disabled));
  // 1. Le choix : on peut en changer tant que la confiance n'est pas donnée. Le temps de décision est celui du DERNIER choix.
  choiceButtons.forEach((b) => (b.onclick = () => {
    chosen = b.dataset.id;
    s.decisionTimeMs = Date.now() - state.shownAt;
    choiceButtons.forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    const box = $('#confidenceBox');
    if (box.classList.contains('hidden')) { box.classList.remove('hidden'); box.classList.add('view-enter'); }
  }));
  // 2. La confiance : envoie la réponse. En cas d'échec réseau, on peut renvoyer sans fausser le temps de décision.
  confidenceButtons.forEach((b) => (b.onclick = async () => {
    confidenceButtons.forEach((x) => x.classList.toggle('on', x === b));
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
    render(`<div class="step-card" style="text-align:center;padding:60px 30px"><span class="spinner" style="width:28px;height:28px;border-width:3px"></span>
      <p class="muted" style="margin-top:16px">Calcul de votre révélation…</p></div>`);
    try {
      state.result = await api('POST', `/evaluation/${state.session.evaluationId}/complete`);
    } catch (err) { return showError(err, showReveal); }
  }
  const r = state.result;
  const best = r.reveals.filter((x) => x.chosenId === x.bestId).length;
  render(`
    <div class="step-card reveal-hero">
      <span class="eyebrow">Étape 3 · 60 séances plus tard</span>
      <div class="kpi ${r.totalPnl >= 0 ? 'gain' : 'loss'}" style="margin-top:14px" id="pnl">0 $</div>
      <p class="muted" style="margin-top:8px">sur ${r.reveals.length} décisions, mise fictive de ${money(state.session.stake)} chacune</p>
      <div class="row" style="justify-content:center;margin-top:18px;gap:8px">
        <span class="pill ink">${best} / ${r.reveals.length} meilleur choix</span>
      </div>
      <p class="tiny faint" style="margin:18px auto 0;max-width:52ch">${esc(r.note)}</p>
    </div>
    <div class="reveal-grid stagger">
    ${r.reveals.map((x, i) => `
      <div class="widget reveal-card">
        <div class="row between"><span class="tiny faint">${esc(x.alias)} · ${esc(x.testsLabel)}</span><span class="tiny faint">${x.decisionSeconds} s</span></div>
        <h3 style="font:500 18px var(--serif);margin-top:6px">${esc(x.reveal.name)} <span class="faint" style="font-family:var(--sans);font-size:12px">${esc(x.reveal.ticker)}</span></h3>
        <p class="tiny faint">${esc(day(x.reveal.decisionDate + 'T12:00:00'))}</p>
        <div class="chart-box scenario-chart"><canvas id="rv${i}"></canvas></div>
        <div class="outcomes">
          ${x.options.map((o) => `<div class="outcome ${o.id === x.chosenId ? 'chosen' : ''}">
            ${o.id === x.bestId ? `<span class="pill gain best">${UI.icon('check', 'sm')}</span>` : ''}
            <span class="tiny faint">${esc(o.label)}</span><b>${signed(o.pnl)}</b></div>`).join('')}
        </div>
        <p class="small muted" style="margin-top:12px">${esc(x.sentence)}</p>
      </div>`).join('')}
    </div>
    <div class="step-actions" style="justify-content:flex-end"><button class="btn primary lg" id="next">Voir mon profil ${UI.icon('arrowRight', 'sm')}</button></div>`);
  UI.countUp($('#pnl'), r.totalPnl, (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`, 1200);
  r.reveals.forEach((x, i) => UI.scenario($('#rv' + i), x.context, x.forward));
  $('#next').onclick = () => showRules().catch((err) => showError(err, showRules));
}

// ------------------------------------------------------------------ Étape 4 : règles auto-définies
/** Une règle dans l'écran de fin d'évaluation : un interrupteur, le comportement encadré et une phrase libre. */
function ruleRowHtml(row, params) {
  const p = params.find((x) => x.param === row.param);
  return `<div class="rule-card ${row.risk ? 'risk' : ''} ${row.on ? '' : 'off'}" data-param="${esc(row.param ?? '')}">
    <div class="rule-toggle">
      <label class="switch"><input type="checkbox" class="on" ${row.on ? 'checked' : ''} aria-label="Activer cette règle"><span></span></label>
      ${row.custom
        ? `<select class="param input" style="max-width:280px;padding:9px 36px 9px 12px" aria-label="Comportement encadré">${params.map((x) => `<option value="${x.param}">${esc(x.label)}</option>`).join('')}</select>`
        : `<b class="grow">${esc(p.label)}</b>`}
      ${row.risk ? '<span class="pill red">à encadrer</span>' : ''}
    </div>
    <div class="editor">
      ${row.reason ? `<p class="tiny muted" style="margin-top:8px">${esc(row.reason)}</p>` : ''}
      <div class="field" style="margin-top:0"><textarea class="text" rows="2" maxlength="300" placeholder="Écrivez votre règle, avec vos mots." aria-label="Texte de la règle">${esc(row.text)}</textarea></div>
      <p class="trigger when" style="margin-top:8px"></p>
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
  const rel = state.result.reliability;

  render(`
    <div class="step-card">
      <span class="eyebrow">Étape 4</span>
      <h1 style="margin-top:8px">Votre <em>reflet</em></h1>
      <div class="grid g-2" style="margin-top:22px;align-items:center">
        <div>
          ${canvasBox('radar', 300)}
          <div class="legend" style="justify-content:center;margin-top:8px"><span><i class="dash"></i>Vous disiez</span><span><i style="background:var(--red)"></i>Vous avez fait</span></div>
        </div>
        <div>
          ${mirrorHead('Vous disiez', 'Vous avez fait')}
          ${params.map((p) => mirror(esc(p.label), p.declared, p.observed, p.reliability ? `fiabilité ${esc(p.reliability.label)}` : '')).join('')}
        </div>
      </div>
      ${rel ? `<div class="notice ink" style="margin-top:18px">${UI.icon('info', 'sm')}<span><b>Fiabilité : ${esc(rel.label)}.</b> <span class="muted">${esc(rel.summary)}</span></span></div>` : ''}
    </div>
    <div class="step-card">
      <h2 style="font:500 24px var(--serif)">Vos règles</h2>
      <p class="lead">Activez celles qui comptent, écrivez-les avec vos mots. ${partner ? `${esc(partner)} vous les rappellera` : 'Elles vous seront rappelées'} avant chaque ordre concerné.</p>
      <div id="ruleRows" style="margin-top:20px">${rows.map((r) => ruleRowHtml(r, params)).join('')}</div>
      <button class="btn soft sm" id="addRule" style="margin-top:14px">${UI.icon('plus', 'sm')} Ajouter une règle</button>
      <div class="error" id="error" role="alert"></div>
      ${partner && pending.get()?.link ? `<p class="tiny faint" style="margin-top:22px">En continuant, vous autorisez ${esc(partner)} à envoyer vos ordres et votre portefeuille à WorthKnowing,
        et à recevoir l’état de votre profil, votre dérive et le texte de vos règles.</p>` : ''}
      <div class="step-actions">
        <button class="btn link" id="backToReveal">${UI.icon('arrowLeft', 'sm')} Révélation</button>
        <button class="btn primary lg" id="save">${partner ? `Activer et retourner à ${esc(partner)}` : 'Activer mon profil'} ${UI.icon('arrowRight', 'sm')}</button>
      </div>
    </div>`);
  UI.radar($('#radar'), declaredScores, observedScores, { aLabel: 'Vous disiez', bLabel: 'Vous avez fait' });

  const wire = (el) => {
    const box = el.querySelector('.on');
    const select = el.querySelector('.param');
    const paramOf = () => (select ? select.value : el.dataset.param);
    const when = () => {
      el.querySelector('.when').innerHTML = `${UI.icon('clock', 'sm')} Rappelée avant : ${esc(params.find((p) => p.param === paramOf()).suggestedRule.trigger)}.`;
    };
    box.onchange = () => el.classList.toggle('off', !box.checked);
    if (select) select.onchange = when;
    when();
  };
  view.querySelectorAll('#ruleRows .rule-card').forEach(wire);
  $('#addRule').onclick = () => {
    $('#ruleRows').insertAdjacentHTML('beforeend', ruleRowHtml({ custom: true, text: '', on: true }, params));
    const el = $('#ruleRows').lastElementChild;
    el.classList.add('view-enter');
    wire(el);
    el.querySelector('.text').focus();
  };

  $('#backToReveal').onclick = showReveal;
  $('#save').onclick = async () => {
    const rules = [...view.querySelectorAll('#ruleRows .rule-card')]
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
  mountNav();
  let me;
  try {
    me = await api('GET', '/me');
    setUser(me.name);
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
    const required = me.status === 'reevaluation_required';
    render(`<div class="step-card" style="text-align:center;padding:52px 40px">
      ${UI.gauge(me.drift.score, me.driftThreshold)}
      <h1 style="margin-top:20px">Réévaluation</h1>
      <p class="lead" style="margin:10px auto 0">${required
        ? 'Votre comportement récent s’est éloigné de votre profil. De nouvelles situations vous attendent ; votre dérive repartira de zéro.'
        : 'Refaites le point quand vous voulez. Votre dérive repartira de zéro.'}</p>
      <div class="row" style="justify-content:center;margin-top:28px"><button class="btn ghost" onclick="location.href='/profile.html'">Plus tard</button>
        <button class="btn primary lg" id="go">Commencer ${UI.icon('arrowRight', 'sm')}</button></div></div>`);
    UI.animateGauges(view);
    $('#go').onclick = () => startSimulations(null);
  } else {
    showSelf();
  }
}
init();
