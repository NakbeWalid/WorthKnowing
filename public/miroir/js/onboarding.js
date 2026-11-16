// Évaluation en 4 étapes : comment vous vous voyez (notes de 0 à 10, puis quelques questions)
// -> simulations -> révélation -> règles.
// Sert aussi à la réévaluation (l'étape 1 est alors sautée).
// L'évaluation en cours est mémorisée dans l'onglet : recharger la page reprend là où on en était.
// Chaque écran tient dans la fenêtre : seules les listes longues défilent, à l'intérieur de leur carte.

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
}
/** Remplace la vue avec l'animation d'entrée. */
const render = (html) => UI.swap(view, html);

/** Écran d'erreur avec bouton « Réessayer » : une panne réseau ne laisse jamais la page figée. */
function showError(err, retry) {
  render(`<div class="onb-center"><div class="step-card"><h1>Un problème est survenu</h1>
    <p class="error" style="margin-top:14px">${esc(err.message)}</p>
    <div class="step-actions"><span></span><button class="btn primary" id="retry">${UI.icon('refresh', 'sm')} Réessayer</button></div></div></div>`);
  $('#retry').onclick = retry;
}

// ------------------------------------------------------------------ Étape 1a : se noter de 0 à 10
const cvLabel = () => (state.cv ? `${UI.icon('check', 'sm')} CV ajouté` : `${UI.icon('upload', 'sm')} Ajouter mon CV (facultatif)`);
function showSelf() {
  setStep(1);
  const qs = selfQuestions();
  render(`<div class="step-card">
      <div class="row between wrap" style="align-items:flex-start"><div>
        <span class="eyebrow">Étape 1</span>
        <h1 style="margin-top:6px">Comment vous <em class="g-text">voyez-vous</em> ?</h1>
        <p class="lead">Notez-vous de 0 à 10 sur ces six traits. Aucune note n’est meilleure qu’une autre.</p></div>
        ${partner ? `<span class="pill red">${UI.icon('link', 'sm')}Vous venez de ${esc(partner)} · retour automatique</span>` : ''}</div>
      <div class="scales">
      ${qs.map((q) => {
        const v = state.answers[q.id];
        const set = v !== undefined;
        const val = set ? v : (q.scale.min + q.scale.max) / 2;
        return `<div class="scale ${set ? 'set' : ''}" data-id="${esc(q.id)}">
          <label for="s-${esc(q.id)}">${esc(q.text)}</label>
          <span class="scale-end low">${esc(q.scale.low)}</span>
          <input class="range ${set ? '' : 'unset'}" type="range" id="s-${esc(q.id)}" min="${q.scale.min}" max="${q.scale.max}" step="1" value="${val}"
            style="--fill:${((val - q.scale.min) / (q.scale.max - q.scale.min)) * 100}%">
          <span class="scale-end high">${esc(q.scale.high)}</span>
          <output for="s-${esc(q.id)}">${set ? v : '—'}</output>
        </div>`;
      }).join('')}
      </div>
      <div class="error" id="error" role="alert"></div>
      <div class="step-actions">
        <div class="persona-fill">Démo : ${Object.keys(PERSONAS).map((p) => `<button class="chip" data-persona="${p}">${p}</button>`).join('')}</div>
        <div class="row"><button class="btn ghost" id="cvBtn">${cvLabel()}</button>
          <button class="btn primary lg" id="next">Continuer ${UI.icon('arrowRight', 'sm')}</button></div>
      </div>
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
  $('#cvBtn').onclick = openCv;
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

  render(`<div class="onb-center"><div class="step-card">
      <div class="progress-line"><i style="width:${(state.index / qs.length) * 100}%"></i></div>
      <span class="counter">Question ${state.index + 1} / ${qs.length}</span>
      <h1 style="margin-top:8px">${esc(q.text)}</h1>
      <div class="options">
        ${q.options.map((o) => `<button class="option ${state.answers[q.id] === o.id ? 'on' : ''}" data-id="${esc(o.id)}"><span class="radio"></span>${esc(o.label)}</button>`).join('')}
      </div>
      <div class="step-actions">
        <button class="btn link" id="back">${UI.icon('arrowLeft', 'sm')} Retour</button>
        ${state.answers[q.id] !== undefined ? `<button class="btn primary" id="btnNextQuestion">${isLast ? 'Aux mises en situation' : 'Suivant'} ${UI.icon('arrowRight', 'sm')}</button>` : ''}
      </div>
    </div></div>`);
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

// CV facultatif (dans une fenêtre) : analysé côté serveur, conservé à part, jamais utilisé pour remplir les réponses.
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
    <div class="error" id="cvError" role="alert"></div>
    <div class="modal-actions"><button class="btn ghost" data-close>Plus tard</button><button class="btn primary" id="cvSend">Analyser</button></div>`;
}
function openCv() {
  const s = UI.sheet(`<div class="modal-head"><h2>Votre CV <span class="faint" style="font:400 15px var(--sans)">· facultatif</span></h2>
      <button class="close-x" data-close aria-label="Fermer">${UI.icon('x', 'sm')}</button></div>
    <p class="small muted" style="margin-bottom:16px">Il sert uniquement à situer votre expertise en trading, pour mettre en contexte l’analyse de vos ordres.
      Il ne remplit aucune réponse, n’entre jamais dans votre profil, et son texte n’est pas conservé.</p>
    <div id="cvBox">${cvBoxHtml(state.cv)}</div>`, { onClose: () => { if ($('#cvBtn')) $('#cvBtn').innerHTML = cvLabel(); } });
  const wire = () => {
    s.el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => s.close()));
    if ($('#cvRemove')) $('#cvRemove').onclick = async () => {
      await api('DELETE', '/parser/cv').catch((err) => UI.toast(esc(err.message)));
      state.cv = null;
      $('#cvBox').innerHTML = cvBoxHtml(null);
      wire();
    };
    if (!$('#cvSend')) return;
    $('#cvFile').onchange = () => { $('#cvName').textContent = $('#cvFile').files?.[0]?.name ?? 'Choisir un fichier'; $('#cvError').textContent = ''; };
    $('#cvSend').onclick = async () => {
      const file = $('#cvFile').files?.[0];
      if (!file) return ($('#cvError').textContent = 'Choisissez un fichier, ou continuez sans CV.');
      if (file.size > 5 * 1024 * 1024) return ($('#cvError').textContent = 'Fichier trop volumineux (5 Mo maximum).');
      $('#cvSend').disabled = true;
      $('#cvSend').innerHTML = '<span class="spinner" style="border-color:#fff;border-top-color:transparent"></span> Analyse…';
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
        wire();
      } catch (err) {
        $('#cvError').textContent = err.message;
        $('#cvSend').disabled = false;
        $('#cvSend').textContent = 'Analyser';
      }
    };
  };
  wire();
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
  const point = (icon, title, text) => `<div class="stat-tile" style="text-align:left;padding:16px"><span class="avatar soft" style="margin-bottom:10px">${UI.icon(icon, 'sm')}</span>
    <div><b class="small">${title}</b><p class="tiny muted" style="margin-top:2px">${text}</p></div></div>`;
  render(`<div class="onb-center"><div class="step-card" style="text-align:center;padding:40px">
      <span class="eyebrow">Étape 2</span>
      <h1 style="margin-top:8px">${n} mises en <em class="g-text">situation</em></h1>
      <p class="lead" style="margin-left:auto;margin-right:auto">Décidez comme avec votre propre argent. À la fin, on vous montre ce qui s’est réellement passé.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:24px">
        ${point('chart', '1 · La séance défile', 'Une vraie courbe de prix, sous un nom masqué.')}
        ${point('news', '2 · La manchette tombe', 'Fictive, pour que vous ne reconnaissiez pas l’épisode.')}
        ${point('zap', '3 · Vous décidez', 'Vendre, garder ou acheter. Aucune bonne réponse.')}
      </div>
      <div class="step-actions" style="justify-content:center"><button class="btn primary lg" id="go">Commencer ${UI.icon('arrowRight', 'sm')}</button></div>
    </div></div>`);
  $('#go').onclick = showScenario;
}

/**
 * Graphique « en direct » d'une mise en situation : la courbe se trace séance après séance, comme si le
 * marché défilait, puis reste vivante (point qui pulse, lecture au survol). Les valeurs sont celles de la
 * série réelle : rien n'est inventé après la dernière séance.
 * `onTick(valeur, index)` à chaque image ; `onDone()` quand toute la courbe est affichée. Renvoie { skip }.
 */
function liveChart(canvas, series, { duration = 2600, onTick, onDone } = {}) {
  // Le canvas n'accepte pas var(--…) : on lit les couleurs du thème (clair ou sombre) sur l'élément lui-même.
  const sv = (n) => getComputedStyle(canvas).getPropertyValue(n).trim();
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const n = series.length;
  const lo0 = Math.min(...series), hi0 = Math.max(...series);
  const padV = (hi0 - lo0) * 0.12 || 1;
  const lo = lo0 - padV, hi = hi0 + padV;
  const P = { l: 6, r: 62, t: 14, b: 24 };
  const UP = '74,222,150', DOWN = '255,107,129';
  let start = null, done = false, progress = still ? n - 1 : 0, hover = null;

  const finish = () => { if (done) return; done = true; progress = n - 1; onTick?.(series[n - 1], n - 1); onDone?.(); };
  canvas.onmousemove = (e) => { const r = canvas.getBoundingClientRect(); hover = { x: e.clientX - r.left }; };
  canvas.onmouseleave = () => { hover = null; };

  function frame(now) {
    if (!canvas.isConnected) return; // l'écran a changé : on arrête la boucle
    if (start === null) start = now;
    if (!done) {
      progress = Math.min(n - 1, ((now - start) / duration) * (n - 1));
      if (progress >= n - 1) finish();
    }
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return requestAnimationFrame(frame);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X = (i) => P.l + (i / (n - 1)) * (w - P.l - P.r);
    const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (h - P.t - P.b);
    const k = Math.floor(progress), f = progress - k;
    const head = k >= n - 1 ? series[n - 1] : series[k] + (series[k + 1] - series[k]) * f;
    const rgb = head >= 100 ? UP : DOWN;
    if (!done) onTick?.(head, k);

    // Grille, repères de prix et base 100
    ctx.font = '500 11px Inter, sans-serif'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4, y = Y(v);
      ctx.strokeStyle = `rgba(${sv('--ink-rgb')},.07)`; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y); ctx.stroke();
      ctx.fillStyle = `rgba(${sv('--ink-rgb')},.42)`; ctx.textAlign = 'left'; ctx.fillText(v.toFixed(0), w - P.r + 10, y);
    }
    if (100 > lo && 100 < hi) {
      ctx.setLineDash([2, 5]); ctx.strokeStyle = `rgba(${sv('--ink-rgb')},.28)`;
      ctx.beginPath(); ctx.moveTo(P.l, Y(100)); ctx.lineTo(w - P.r, Y(100)); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = `rgba(${sv('--ink-rgb')},.42)`; ctx.textBaseline = 'alphabetic';
    [[0, `−${n - 1} séances`, 'left'], [Math.round((n - 1) / 3), `−${Math.round(((n - 1) * 2) / 3)}`, 'center'], [Math.round(((n - 1) * 2) / 3), `−${Math.round((n - 1) / 3)}`, 'center'], [n - 1, 'maintenant', 'right']]
      .forEach(([i, label, align]) => { ctx.textAlign = align; ctx.fillText(label, X(i), h - 6); });

    // Courbe tracée jusqu'à la séance en cours, aire en dégradé
    const hx = X(progress), hy = Y(head);
    ctx.beginPath(); ctx.moveTo(X(0), Y(series[0]));
    for (let i = 1; i <= k; i++) ctx.lineTo(X(i), Y(series[i]));
    ctx.lineTo(hx, hy);
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = `rgb(${rgb})`; ctx.stroke();
    ctx.lineTo(hx, h - P.b); ctx.lineTo(X(0), h - P.b); ctx.closePath();
    const grad = ctx.createLinearGradient(0, P.t, 0, h - P.b);
    grad.addColorStop(0, `rgba(${rgb},.30)`); grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad; ctx.fill();

    // Dernier cours : ligne de niveau, étiquette de prix, point qui pulse
    ctx.setLineDash([4, 4]); ctx.strokeStyle = `rgba(${rgb},.55)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(w - P.r, hy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = `rgb(${rgb})`; ctx.beginPath(); ctx.roundRect(w - P.r + 4, hy - 10, P.r - 6, 20, 6); ctx.fill();
    ctx.fillStyle = sv('--bg'); ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(head.toFixed(1), w - P.r + 4 + (P.r - 6) / 2, hy + 0.5);
    const pulse = (Math.sin(now / 300) + 1) / 2;
    ctx.beginPath(); ctx.arc(hx, hy, 5 + pulse * 8, 0, Math.PI * 2); ctx.fillStyle = `rgba(${rgb},${0.26 - pulse * 0.2})`; ctx.fill();
    ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2); ctx.fillStyle = `rgb(${rgb})`; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = sv('--bg'); ctx.stroke();

    // Lecture au survol (une fois la courbe complète)
    if (done && hover) {
      const i = Math.max(0, Math.min(n - 1, Math.round(((hover.x - P.l) / (w - P.l - P.r)) * (n - 1))));
      const x = X(i), y = Y(series[i]);
      ctx.strokeStyle = `rgba(${sv('--ink-rgb')},.28)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, h - P.b); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      const text = `${i === n - 1 ? 'maintenant' : `il y a ${n - 1 - i} séances`} · ${series[i].toFixed(1)}`;
      ctx.font = '600 11.5px Inter, sans-serif';
      const tw = ctx.measureText(text).width + 16, tx = Math.max(P.l, Math.min(w - P.r - tw, x - tw / 2));
      ctx.fillStyle = sv('--cream-3'); ctx.beginPath(); ctx.roundRect(tx, P.t, tw, 22, 7); ctx.fill();
      ctx.fillStyle = '#f7eff5'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, tx + 8, P.t + 11.5);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (still) setTimeout(finish, 0);
  return { skip: finish };
}

/** Les trois niveaux de confiance proposés après chaque réponse (ids attendus par le serveur). */
const CONFIDENCES = [['high', 'Sûr'], ['medium', 'Plutôt sûr'], ['low', 'Hésitant']];
/** Part de la position conservée après chaque décision (mêmes valeurs que le serveur : tout vendre, garder, +50 %). */
const EXPOSURE = { sell: 0, keep: 1, buy: 1.5 };

/**
 * Une mise en situation, jouée comme une séance de marché : la courbe défile, puis la manchette tombe et le
 * ticket d'ordre se débloque. Le temps de décision n'est compté qu'à partir de ce moment-là (toute
 * l'information est alors à l'écran), pour que l'animation ne fausse pas la mesure d'impulsivité.
 */
function showScenario() {
  setStep(2);
  const s = state.session.scenarios[state.index];
  const total = state.session.scenarios.length;
  const stake = state.session.stake;
  const c = s.context, last = c.length - 1;
  const ret = (k) => c[last] / c[Math.max(0, last - k)] - 1;
  const pc = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d).replace('.', ',')} %`;
  const stats = [['1 séance', ret(1)], ['5 séances', ret(5)], ['30 séances', ret(30)], [`${last} séances`, ret(last)], ['Sous le sommet', c[last] / Math.max(...c) - 1]];
  s.decisionTimeMs = undefined;
  state.shownAt = 0; // fixé au déblocage du ticket (voir unlock)
  let chosen = null;

  render(`<div class="step-card sim">
      <div class="sim-bar">
        <span class="pill red"><span class="dot live"></span>Séance ${state.index + 1} / ${total}</span>
        <div class="sim-dots">${Array.from({ length: total }, (_, k) => `<i class="${k < state.index ? 'done' : k === state.index ? 'on' : ''}"></i>`).join('')}</div>
        <span class="pill outline">${esc(s.maskLabel)}</span>
      </div>
      <div class="sc-grid">
        <div class="sc-left">
          <div class="sim-quote">
            <div><div class="eyebrow">${esc(s.alias)} · nom masqué</div>
              <div class="sim-price"><span id="simPrice">100,0</span><small>base 100</small></div></div>
            <div style="text-align:right"><span class="pill" id="simChange">0,0 %</span><div class="tiny faint" style="margin-top:4px" id="simClock">il y a ${last} séances</div></div>
          </div>
          <div class="chart-box fill sim-chart" title="Cliquez pour afficher toute la courbe"><canvas id="scChart" aria-label="Prix sur les ${last} dernières séances, base 100"></canvas></div>
          <div class="sim-stats" id="simStats">${stats.map(([label]) => `<div class="stat-tile"><div class="kpi-label">${label}</div><div class="kpi">—</div></div>`).join('')}</div>
        </div>
        <div class="sc-right">
          <div class="flash" id="simFlash">
            <div class="flash-tag"><span class="dot"></span>Flash marché<em>manchette fictive</em></div>
            <q>${esc(s.headline)}</q>
          </div>
          <div class="position" id="simPosition">
            <div class="row between"><span class="eyebrow">Votre position</span><b class="kpi" style="font-size:22px">${money(stake)}</b></div>
            <p>${esc(s.situation)}</p>
          </div>
          <div id="simTicket" class="locked">
            <div class="eyebrow" id="ticketLabel"><span class="spinner" style="width:10px;height:10px"></span>&nbsp; La séance défile…</div>
            <div class="options trio" id="choiceRow">${s.choices.map((ch) => {
              const [ico] = CHOICE_ICONS[ch.id] ?? ['chevron'];
              return `<button class="option" data-id="${esc(ch.id)}" aria-pressed="false" disabled><span class="opt-icon">${UI.icon(ico)}</span>${esc(ch.label)}
                <small>position → ${money(stake * (EXPOSURE[ch.id] ?? 1))}</small></button>`;
            }).join('')}</div>
            <div id="confidenceBox" style="margin-top:14px;visibility:hidden">
              <p class="small muted">Votre niveau de confiance ?</p>
              <div class="options trio conf" id="confidenceRow" style="margin-top:8px">${CONFIDENCES.map(([id, label]) => `<button class="option" data-confidence="${id}">${esc(label)}</button>`).join('')}</div>
            </div>
          </div>
          <div class="error" id="error" role="alert"></div>
        </div>
      </div>
      <div class="sim-stamp hidden" id="simStamp"><svg class="check-anim" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg><b>Décision enregistrée</b></div>
    </div>`);

  const choiceButtons = [...view.querySelectorAll('#choiceRow .option')];
  const confidenceButtons = [...view.querySelectorAll('#confidenceRow .option')];
  const lock = (disabled) => [...choiceButtons, ...confidenceButtons].forEach((x) => (x.disabled = disabled));

  /** La courbe est complète : la manchette tombe, les chiffres s'affichent, le ticket s'ouvre, le chrono démarre. */
  const unlock = () => {
    $('#simStats').innerHTML = stats.map(([label, v]) => `<div class="stat-tile"><div class="kpi-label">${label}</div><div class="kpi ${v >= 0 ? 'gain' : 'loss'}">${pc(v)}</div></div>`).join('');
    $('#simStats').classList.add('stagger');
    $('#simFlash').classList.add('in');
    $('#simPosition').classList.add('in');
    $('#simTicket').classList.remove('locked');
    $('#ticketLabel').textContent = 'Que faites-vous ?';
    $('#simClock').textContent = 'maintenant';
    choiceButtons.forEach((b) => (b.disabled = false));
    state.shownAt = Date.now();
  };
  const chart = liveChart($('#scChart'), c, {
    onTick: (v, k) => {
      $('#simPrice').textContent = v.toFixed(1).replace('.', ',');
      const ch = $('#simChange');
      ch.textContent = pc(v / 100 - 1);
      ch.className = 'pill ' + (v >= 100 ? 'gain' : 'loss');
      if (k < last) $('#simClock').textContent = `il y a ${last - k} séances`;
    },
    onDone: unlock,
  });
  view.querySelector('.sim-chart').onclick = () => chart.skip();

  // 1. Le choix : on peut en changer tant que la confiance n'est pas donnée. Le temps de décision est celui du DERNIER choix.
  choiceButtons.forEach((b) => (b.onclick = () => {
    chosen = b.dataset.id;
    s.decisionTimeMs = Date.now() - state.shownAt;
    choiceButtons.forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    const box = $('#confidenceBox');
    if (box.style.visibility === 'hidden') { box.style.visibility = ''; box.classList.add('view-enter'); }
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
    $('#simStamp').classList.remove('hidden');
    await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 750));
    state.index++;
    state.index < total ? showScenario() : showReveal();
  }));
}

// ------------------------------------------------------------------ Étape 3 : révélation
// Une décision à la fois, en grand : la frise du haut permet de passer d'une situation à l'autre (ou ← →).
let revealIndex = 0;
async function showReveal() {
  setStep(3);
  if (!state.result) {
    render(`<div class="onb-center"><div class="step-card" style="text-align:center;padding:50px 30px">
      ${UI.agents(['marche', 'comportement', 'profil', 'explication'], { mode: 'working' })}
      <p class="muted" style="margin-top:16px">Calcul de votre révélation…</p></div></div>`);
    try {
      state.result = await api('POST', `/evaluation/${state.session.evaluationId}/complete`);
    } catch (err) { return showError(err, showReveal); }
  }
  const r = state.result;
  const best = r.reveals.filter((x) => x.chosenId === x.bestId).length;
  const mine = (x) => x.options.find((o) => o.id === x.chosenId) ?? { pnl: 0, label: '—' };
  const amount = (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
  const letter = (i) => String.fromCharCode(65 + i);
  revealIndex = Math.min(revealIndex, r.reveals.length - 1);

  render(`<div class="rv">
    <div class="rv-top">
      <div>
        <span class="eyebrow">Étape 3 · ce qui s’est vraiment passé, 60 séances plus tard</span>
        <div class="row" style="align-items:baseline;gap:14px;margin-top:4px"><div class="kpi rv-pnl ${r.totalPnl >= 0 ? 'gain' : 'loss'}" id="pnl">0 $</div>
          <span class="small muted">sur ${r.reveals.length} décisions · mise fictive de ${money(state.session.stake)} chacune</span></div>
        <p class="tiny faint" style="margin-top:4px;max-width:70ch">${esc(r.note)}</p>
      </div>
      <span class="grow"></span>
      <div class="rv-score"><b>${best}<span> / ${r.reveals.length}</span></b><small>meilleurs choix</small></div>
      <button class="btn primary lg" id="next">Voir mon profil ${UI.icon('arrowRight', 'sm')}</button>
    </div>
    <div class="rv-tabs" role="tablist" aria-label="Les situations">
      ${r.reveals.map((x, i) => `<button class="rv-tab" role="tab" data-i="${i}" title="${esc(x.reveal.name)}">
        <span class="l"><span>Situation ${letter(i)}</span>${x.chosenId === x.bestId ? `<span class="gain">${UI.icon('check', 'sm')}</span>` : ''}</span>
        <span class="n">${esc(x.reveal.name)}</span><b class="${mine(x).pnl >= 0 ? 'gain' : 'loss'}">${amount(mine(x).pnl)}</b></button>`).join('')}
    </div>
    <div class="widget rv-detail" id="rvDetail"></div>
  </div>`);
  UI.countUp($('#pnl'), r.totalPnl, amount, 1200);

  const show = (i, animate = true) => {
    revealIndex = (i + r.reveals.length) % r.reveals.length;
    const x = r.reveals[revealIndex];
    const chosen = mine(x);
    const bestOpt = x.options.find((o) => o.id === x.bestId);
    const max = Math.max(1, ...x.options.map((o) => Math.abs(o.pnl)));
    view.querySelectorAll('.rv-tab').forEach((b, k) => { b.classList.toggle('on', k === revealIndex); b.setAttribute('aria-selected', String(k === revealIndex)); });
    view.querySelector('.rv-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const html = `<div class="rv-left">
        <div class="row" style="gap:14px"><span class="rv-letter">${letter(revealIndex)}</span>
          <div class="grow"><div class="eyebrow">C’était « ${esc(x.alias)} » · ${esc(day(x.reveal.decisionDate + 'T12:00:00'))}</div>
            <h2>${esc(x.reveal.name)} <span class="faint" style="font:400 13px var(--sans)">${esc(x.reveal.ticker)}</span></h2></div>
          <span class="pill outline">Trait observé : ${esc(x.testsLabel.toLowerCase())}</span></div>
        <div class="chart-box fill" style="margin-top:12px;min-height:170px"><canvas id="rvChart"></canvas></div>
        <div class="legend" style="margin-top:8px"><span><i style="background:var(--ink)"></i>Ce que vous voyiez</span><span><i style="background:var(--red)"></i>Ce qui s’est passé ensuite</span></div>
      </div>
      <div class="rv-right">
        <div><div class="eyebrow">Votre décision · prise en ${x.decisionSeconds} s</div>
          <div class="row wrap" style="margin-top:4px;gap:12px"><span class="rv-choice">${esc(chosen.label)}</span>
            ${x.chosenId === x.bestId ? `<span class="pill gain">${UI.icon('check', 'sm')}le meilleur choix</span>` : `<span class="pill outline">le meilleur était : ${esc(bestOpt?.label ?? '—')}</span>`}</div></div>
        <div class="rv-outs">${x.options.map((o) => `<div class="rv-out ${o.id === x.chosenId ? 'chosen' : ''}">
            <span class="lab">${esc(o.label)}${o.id === x.chosenId ? ' <em>vous</em>' : ''}</span>
            <span class="track"><i class="${o.pnl >= 0 ? 'pos' : 'neg'}" style="width:${Math.max(2, (Math.abs(o.pnl) / max) * 100)}%"></i></span>
            <b class="${o.pnl >= 0 ? 'gain' : 'loss'}">${amount(o.pnl)}</b></div>`).join('')}</div>
        <p class="rv-sentence">${esc(x.sentence)}</p>
        <div class="row between"><button class="btn soft sm" data-nav="-1">${UI.icon('arrowLeft', 'sm')} Précédente</button>
          <span class="tiny faint num">${revealIndex + 1} / ${r.reveals.length}</span>
          <button class="btn soft sm" data-nav="1">Suivante ${UI.icon('arrowRight', 'sm')}</button></div>
      </div>`;
    const box = $('#rvDetail');
    if (animate) UI.swap(box, html); else box.innerHTML = html;
    UI.scenario($('#rvChart'), x.context, x.forward);
    box.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => show(revealIndex + Number(b.dataset.nav))));
  };
  view.querySelectorAll('.rv-tab').forEach((b) => (b.onclick = () => show(Number(b.dataset.i))));
  document.onkeydown = (e) => {
    if (!$('#rvDetail') || e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowRight') show(revealIndex + 1);
    if (e.key === 'ArrowLeft') show(revealIndex - 1);
  };
  show(revealIndex, false);
  $('#next').onclick = () => showRules().catch((err) => showError(err, showRules));
}

// ------------------------------------------------------------------ Étape 4 : règles auto-définies
/** Une règle dans l'écran de fin d'évaluation : un interrupteur, le comportement encadré et une phrase libre. */
function ruleRowHtml(row, params) {
  const p = params.find((x) => x.param === row.param);
  return `<div class="rule-card stacked ${row.risk ? 'risk' : ''} ${row.on ? '' : 'off'}" data-param="${esc(row.param ?? '')}">
    <div class="rule-toggle">
      <label class="switch"><input type="checkbox" class="on" ${row.on ? 'checked' : ''} aria-label="Activer cette règle"><span></span></label>
      ${row.custom
        ? `<select class="param input" style="max-width:280px;padding:8px 36px 8px 12px" aria-label="Comportement encadré">${params.map((x) => `<option value="${x.param}">${esc(x.label)}</option>`).join('')}</select>`
        : `<b class="grow">${esc(p.label)}</b>`}
      ${row.risk ? '<span class="pill red">à encadrer</span>' : ''}
    </div>
    <div class="editor">
      ${row.reason ? `<p class="tiny muted" style="margin-top:8px">${esc(row.reason)}</p>` : ''}
      <div class="field" style="margin-top:8px"><textarea class="text" rows="2" maxlength="300" placeholder="Écrivez votre règle, avec vos mots." aria-label="Texte de la règle">${esc(row.text)}</textarea></div>
      <p class="trigger when" style="margin-top:6px"></p>
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

  render(`<div class="onb-split rules-split">
    <div class="step-card" style="overflow:auto">
      <div class="row between"><div><span class="eyebrow">Étape 4</span><h1 style="margin-top:4px">Votre <em class="g-text">reflet</em></h1></div>
        <div class="legend"><span><i class="dash"></i>Vous disiez</span><span><i style="background:var(--red)"></i>Vous avez fait</span></div></div>
      <div class="chart-box" style="height:230px;flex:none;margin:6px 0 10px"><canvas id="radar"></canvas></div>
      ${mirrorHead('Vous disiez', 'Vous avez fait')}
      ${params.map((p) => mirror(esc(p.label), p.declared, p.observed, p.reliability ? `fiabilité ${esc(p.reliability.label)}` : '')).join('')}
      ${rel ? `<div class="notice ink" style="margin-top:12px">${UI.icon('info', 'sm')}<span><b>Fiabilité : ${esc(rel.label)}.</b> <span class="muted">${esc(rel.summary)}</span></span></div>` : ''}
    </div>
    <div class="step-card">
      <div class="row between"><h2 style="font:500 24px var(--serif)">Vos règles</h2>
        <button class="btn soft sm" id="addRule">${UI.icon('plus', 'sm')} Ajouter</button></div>
      <p class="lead">Activez celles qui comptent et écrivez-les avec vos mots. ${partner ? `${esc(partner)} vous les rappellera` : 'Elles vous seront rappelées'} avant chaque ordre concerné.</p>
      <div id="ruleRows" class="scroll" style="flex:1;margin:14px -8px 0 0;padding-right:8px">${rows.map((r) => ruleRowHtml(r, params)).join('')}</div>
      <div class="error" id="error" role="alert"></div>
      ${partner && pending.get()?.link ? `<p class="tiny faint" style="margin-top:10px">En continuant, vous autorisez ${esc(partner)} à envoyer vos ordres et votre portefeuille à WorthKnowing,
        et à recevoir l’état de votre profil, votre dérive et le texte de vos règles.</p>` : ''}
      <div class="step-actions">
        <button class="btn link" id="backToReveal">${UI.icon('arrowLeft', 'sm')} Révélation</button>
        <button class="btn primary lg" id="save">${partner ? `Activer et retourner à ${esc(partner)}` : 'Activer mon profil'} ${UI.icon('arrowRight', 'sm')}</button>
      </div>
    </div>
  </div>`);
  UI.radar($('#radar'), declaredScores, observedScores, { aLabel: 'Vous disiez', bLabel: 'Vous avez fait' });

  const wire = (el) => {
    const box = el.querySelector('.on');
    const select = el.querySelector('.param');
    const paramOf = () => (select ? select.value : el.dataset.param);
    const when = () => {
      el.querySelector('.when').innerHTML = `${UI.icon('clock', 'sm')}<span>Rappelée avant : ${esc(params.find((p) => p.param === paramOf()).suggestedRule.trigger)}.</span>`;
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
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    render(`<div class="onb-center"><div class="step-card night" style="text-align:center;padding:40px">
      ${UI.gauge(me.drift.score, me.driftThreshold, { dark: true })}
      <h1 style="margin-top:18px;color:#fff">Réévaluation</h1>
      <p class="lead" style="margin:8px auto 0">${required
        ? 'Votre comportement récent s’est éloigné de votre profil. De nouvelles situations vous attendent ; votre dérive repartira de zéro.'
        : 'Refaites le point quand vous voulez. Votre dérive repartira de zéro.'}</p>
      <div class="row" style="justify-content:center;margin-top:24px"><button class="btn glass" onclick="location.href='/profile.html'">Plus tard</button>
        <button class="btn primary lg" id="go">Commencer ${UI.icon('arrowRight', 'sm')}</button></div></div></div>`);
    UI.animateGauges(view);
    $('#go').onclick = () => startSimulations(null);
  } else {
    showSelf();
  }
}
init();
