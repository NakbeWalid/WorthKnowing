// Page principale de Boréal Courtage : portefeuille, ticket d'ordre, activité, et service WorthKnowing (facultatif).
//
// Parcours d'un ordre :
//   1. « Vérifier l'ordre »  -> POST /api/trades/preview : cotation + (si le compte est lié) règles WorthKnowing à rappeler
//   2. fenêtre de confirmation : récapitulatif, et rappel de la règle que le client s'est fixée
//   3. « Confirmer »         -> POST /api/trades : exécution ; l'analyse WorthKnowing arrive ensuite par SSE
//      « Renoncer »          -> POST /api/trades/cancel : WorthKnowing note que la règle a été respectée

let me = null;
let trades = [];
let persona = null;
let ticketTouchedAt = Date.now(); // début de la réflexion pour l'ordre en cours
let market = null; // { firstDate, lastDate, assets }
let historyFilter = 'all';
let openResult = null; // fenêtre « ordre exécuté » ouverte : { tradeId, el }

const PARAM_LABELS = {
  riskTolerance: 'Appétit pour le risque', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »',
  concentration: 'Concentration', impulsivity: 'Impulsivité', newsSensitivity: 'Sensibilité aux nouvelles',
};
const ALLOC_COLORS = ['#d7001f', '#1d1714', '#e8707f', '#7a6a5e', '#f2b3bb', '#b5a596', '#9e0018', '#d9cbbb'];
const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });

// ------------------------------------------------------------------ Navigation entre les vues
function showView(name) {
  document.querySelectorAll('.nav-links [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === name)));
  document.querySelectorAll('.view').forEach((v) => {
    const on = v.id === 'view-' + name;
    v.classList.toggle('hidden', !on);
    if (on) { v.classList.remove('view-enter'); void v.offsetWidth; v.classList.add('view-enter'); }
  });
  history.replaceState(null, '', name === 'portfolio' ? location.pathname : '#' + name);
  if (name === 'activity') renderActivity();
}
document.querySelectorAll('.nav-links [data-view]').forEach((b) => (b.onclick = () => showView(b.dataset.view)));

// ------------------------------------------------------------------ Affichage du compte
async function refresh() {
  me = await api('GET', '/me');
  const [list, p, valueHistory] = await Promise.all([
    api('GET', '/trades'),
    me.miroir.status === 'linked' ? api('GET', '/miroir/persona').then((r) => r.persona).catch(() => null) : null,
    api('GET', '/portfolio/history').catch(() => ({ points: [] })),
  ]);
  trades = list;
  persona = p;
  // La liaison a pu être révoquée côté WorthKnowing pendant l'appel : on relit l'état.
  if (me.miroir.status === 'linked' && !persona) me = await api('GET', '/me');

  const pf = me.portfolio;
  const gain = pf.total - me.startingCash;
  const invested = pf.positions.reduce((s, x) => s + x.value, 0);
  $('#hello').textContent = me.name;
  $('#avatar').textContent = UI.initials(me.name);
  UI.countUp($('#total'), pf.total, bigMoney);
  $('#gain').innerHTML = `<span class="pill ${gain >= 0 ? 'gain' : 'loss'}">${UI.icon(gain >= 0 ? 'arrowUp' : 'arrowDown', 'sm')}${money(Math.abs(gain), 2)} · ${pct(gain / me.startingCash)}</span>
    <span class="tiny faint">depuis l’ouverture</span>`;
  $('#cash').textContent = money(pf.cash);
  $('#invested').textContent = money(invested);
  $('#asOf').textContent = me.clock ? `Valorisé à la clôture du ${day(me.clock + 'T12:00:00')}` : '';
  syncClock();

  renderValueChart(valueHistory.points);
  renderAllocation(pf, invested);
  renderPositions(pf);
  renderMiroir();
  if (!$('#view-activity').classList.contains('hidden')) renderActivity();
}

function renderValueChart(points) {
  const empty = points.length < 2;
  $('#valueEmpty').classList.toggle('hidden', !empty);
  if (empty) return UI.chart($('#valueChart'), { type: 'line', data: { labels: [], datasets: [] }, options: { scales: { x: { display: false }, y: { display: false } } } });
  const up = points.at(-1).value >= points[0].value;
  UI.area($('#valueChart'), points.map((p) => shortDate(p.date)), points.map((p) => p.value), {
    color: up ? UI.C.red : UI.C.ink, format: (v) => money(v),
  });
}

function renderAllocation(pf, invested) {
  const top = pf.positions.slice(0, 5);
  const rest = pf.positions.slice(5).reduce((s, p) => s + p.value, 0);
  const labels = [...top.map((p) => p.ticker), ...(rest ? ['Autres'] : []), 'Liquidités'];
  const values = [...top.map((p) => p.value), ...(rest ? [rest] : []), pf.cash];
  const colors = labels.map((l, i) => (l === 'Liquidités' ? '#e6d9c6' : ALLOC_COLORS[i % ALLOC_COLORS.length]));
  UI.donut($('#allocChart'), labels, values, colors);
  $('#allocCash').textContent = `${Math.round((pf.cash / pf.total) * 100)} %`;
  $('#allocCount').textContent = `${pf.positions.length} actif${pf.positions.length > 1 ? 's' : ''}`;
  $('#allocLegend').innerHTML = labels.map((l, i) => `<div><i style="background:${colors[i]}"></i><span>${esc(l)}</span>
    <b>${Math.round((values[i] / pf.total) * 100)} %</b></div>`).join('');
}

function renderPositions(pf) {
  $('#positions').innerHTML = pf.positions.length ? pf.positions.map((p) => {
    const ret = p.invested ? p.gain / p.invested : 0;
    return `<div class="list-item clickable position" data-sell="${esc(p.ticker)}" data-value="${p.value.toFixed(2)}" tabindex="0">
      <div class="ticker-badge">${esc(p.ticker.replace(/[-.].*$/, '').slice(0, 5))}</div>
      <div class="grow"><div class="title">${esc(p.ticker)}</div><div class="sub">${esc(assetName(p.ticker))}</div></div>
      <div class="end weight"><span class="tiny faint">${(p.weight * 100).toFixed(0)} %</span><div class="bar"><i style="width:${Math.min(100, p.weight * 100)}%"></i></div></div>
      <div class="end" style="min-width:110px"><b>${money(p.value)}</b><span class="tiny ${ret >= 0 ? 'gain' : 'loss'}">${pct(ret)}</span></div>
    </div>`;
  }).join('')
    : `<div class="empty-state">${UI.icon('pie')}<p>Aucune position. Passez un premier ordre avec le ticket.</p></div>`;
  document.querySelectorAll('[data-sell]').forEach((row) => {
    const go = () => {
      $('#sell').checked = true;
      $('#ticker').value = row.dataset.sell;
      setAmount(row.dataset.value);
      touchTicket();
      $('#ticket').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#amount').focus();
    };
    row.onclick = go;
    row.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}
const assetName = (ticker) => market?.assets.find((a) => a.ticker === ticker)?.name ?? '';

// ------------------------------------------------------------------ WorthKnowing
/** Le service WorthKnowing selon l'état du compte : offre, activation en attente, lié, ou désactivé. */
function renderMiroir() {
  const { status, urls } = me.miroir;
  const blocked = status === 'linked' && persona?.status === 'reevaluation_required';
  let notice = '';
  let widget = '';

  if (status === 'none' || status === 'pending') {
    const pendingNow = status === 'pending';
    notice = `<div class="wk-offer rise">
      <div class="grow">
        <span class="eyebrow" style="color:rgba(247,241,232,.55)">Service partenaire</span>
        <h3>${pendingNow ? 'Terminez votre profil <i>WorthKnowing</i>' : 'Investissez-vous comme vous le pensez ?'}</h3>
        <p>${pendingNow ? 'Il ne reste que quelques minutes. Vous serez ramené ici automatiquement.'
          : 'WorthKnowing compare ce que vous dites de vous à ce que vous faites, et vous rappelle vos propres règles avant chaque ordre.'}</p>
        ${pendingNow ? '' : `<div class="steps-mini"><span><b>1</b>Profil en 10 min</span><span><b>2</b>Vos règles</span><span><b>3</b>Rappels avant l’ordre</span></div>`}
      </div>
      <div class="row wrap">
        <button class="btn primary" data-miroir="start">${pendingNow ? 'Continuer' : 'Activer WorthKnowing'} ${UI.icon('arrowRight', 'sm')}</button>
        <button class="btn ghost" data-miroir="decline">${pendingNow ? 'Annuler' : 'Non merci'}</button>
      </div>
    </div>`;
  } else if (blocked) {
    notice = `<div class="banner rise">${UI.icon('pause', 'lg')}
      <div class="grow"><h3>Ordres suspendus</h3>
        <p>Votre dérive atteint ${persona.drift.score} / ${persona.drift.threshold}. Refaites votre évaluation WorthKnowing pour reprendre.</p></div>
      <a class="btn white" href="${esc(urls.reevaluate)}">Refaire l’évaluation ${UI.icon('arrowRight', 'sm')}</a>
    </div>`;
  }

  if (status === 'linked') {
    widget = persona ? `
      <div class="widget-head"><span class="logo">${UI.wkMark(true)}<span class="logo-word">Worth<i>Knowing</i></span></span>
        <span class="pill" style="background:rgba(247,241,232,.1);color:var(--cream)"><span class="dot live"></span>actif</span></div>
      ${UI.gauge(persona.drift.score, persona.drift.threshold)}
      <p class="tiny faint" style="text-align:center;margin-top:4px">Score de dérive</p>
      <div class="rules-mini"><span>${persona.rules.length} règle${persona.rules.length > 1 ? 's' : ''} active${persona.rules.length > 1 ? 's' : ''}</span>
        <button class="btn link sm" id="showRules">Voir ${UI.icon('chevron', 'sm')}</button></div>
      <div class="row between" style="margin-top:10px">
        <a class="btn ghost sm" href="${esc(urls.profile)}" target="_blank" rel="noopener">Mon profil ${UI.icon('external', 'sm')}</a>
        <button class="btn link sm" data-miroir="unlink">Retirer</button></div>`
      : `<div class="widget-head"><span class="logo">${UI.wkMark(true)}<span class="logo-word">Worth<i>Knowing</i></span></span></div>
        <p class="small muted">Le service ne répond pas pour le moment. Vos ordres passent normalement, sans analyse.</p>`;
  } else if (status === 'declined') {
    widget = `<div class="widget-head"><span class="logo">${UI.wkMark(true)}<span class="logo-word">Worth<i>Knowing</i></span></span></div>
      <p class="small muted" style="margin-bottom:16px">Non activé. Vos ordres restent sur la plateforme.</p>
      <button class="btn primary sm" data-miroir="start">Activer ${UI.icon('arrowRight', 'sm')}</button>`;
  } else {
    widget = `<div class="widget-head"><span class="logo">${UI.wkMark(true)}<span class="logo-word">Worth<i>Knowing</i></span></span></div>
      <p class="small muted">${status === 'pending' ? 'Activation en cours.' : 'Service facultatif, proposé ci-dessus.'}</p>`;
  }

  $('#notices').innerHTML = notice;
  const w = $('#wkWidget');
  w.className = 'widget wk-widget' + (status === 'linked' ? '' : ' offer');
  w.innerHTML = widget;
  UI.animateGauges(w);
  $('#wkPill').innerHTML = status === 'linked' && persona
    ? `<span class="pill ${blocked ? 'red' : 'outline'}" title="Score de dérive WorthKnowing">${UI.wkMark()}<span class="num">${persona.drift.score}</span></span>` : '';
  $('#wkPill').querySelector('svg')?.setAttribute('style', 'width:16px;height:16px');
  $('#orderButton').disabled = blocked;
  if ($('#showRules')) $('#showRules').onclick = () => UI.modal({
    title: 'Vos règles',
    body: persona.rules.length ? persona.rules.map((r) => `<div class="rule-reminder"><q>${esc(r.text)}</q></div>`).join('')
      : '<p class="muted">Aucune règle définie.</p>',
    actions: [{ label: 'Gérer dans WorthKnowing', value: 'go', kind: '' }],
  }).then((v) => { if (v === 'go') window.open(urls.profile, '_blank', 'noopener'); });

  document.querySelectorAll('[data-miroir]').forEach((b) => (b.onclick = async () => {
    const action = b.dataset.miroir;
    if (action === 'unlink' && !(await UI.confirm('Retirer WorthKnowing ?', 'Vos ordres ne seront plus analysés. Vous pourrez le réactiver plus tard.', { ok: 'Retirer', danger: true }))) return;
    b.disabled = true;
    try {
      if (action === 'start') return (location.href = (await api('POST', '/miroir/link/start')).redirectUrl);
      await api('POST', action === 'decline' ? '/miroir/decline' : '/miroir/unlink');
      if (action === 'unlink') toast('WorthKnowing a été retiré de votre compte.', 'ok');
    } catch (err) { toast(err.message); }
    await refresh().catch(() => {});
  }));
}

// ------------------------------------------------------------------ Activité : suivi des ordres
function renderActivity() {
  if (!me) return;
  const linked = me.miroir.status === 'linked';
  const analysed = trades.filter((t) => t.miroir.status === 'analysed');
  const overrides = analysed.filter((t) => t.miroir.overrodeRules).length;
  const volume = trades.reduce((s, t) => s + t.amount, 0);
  const stats = [
    ['Ordres passés', trades.length, 'list'],
    ['Volume échangé', money(volume), 'activity'],
    ['Analysés par WorthKnowing', linked || analysed.length ? analysed.length : '—', 'eye'],
    ['Règles outrepassées', linked || analysed.length ? overrides : '—', 'alert'],
  ];
  $('#activityStats').innerHTML = stats.map(([label, v, ico]) => `<div class="widget stat">
    <div class="widget-head" style="margin-bottom:6px"><h3>${label}</h3>${UI.icon(ico, 'sm')}</div><div class="kpi">${v}</div></div>`).join('');

  // Dérive dans le temps : chronologique, un point par ordre analysé.
  const chrono = [...analysed].reverse();
  $('#driftWidget').classList.toggle('hidden', chrono.length < 1);
  if (chrono.length) {
    const threshold = persona?.drift.threshold ?? 60;
    UI.driftLine($('#driftChart'), ['Départ', ...chrono.map((t) => `${t.ticker} · ${shortDate(t.marketDate)}`)],
      [chrono[0].miroir.driftBefore, ...chrono.map((t) => t.miroir.driftAfter)], threshold, [false, ...chrono.map((t) => t.miroir.overrodeRules)]);
  }

  const filtered = trades.filter((t) => historyFilter === 'all' || (historyFilter === 'flag' ? t.miroir.overrodeRules : t.side === historyFilter));
  $('#history').innerHTML = filtered.length ? filtered.map((t) => `<div class="list-item clickable history-item" data-trade="${esc(t.id)}" tabindex="0">
      <div class="side-icon ${t.side}">${UI.icon(t.side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>
      <div class="grow"><div class="title">${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(t.ticker)}</div>
        <div class="sub">${esc(day(t.marketDate + 'T12:00:00'))}</div></div>
      <div class="end">${historyMiroir(t.miroir)}</div>
      <div class="end" style="min-width:104px"><b class="${t.side === 'sell' ? 'gain' : ''}">${t.side === 'sell' ? '+' : '−'}${money(t.amount)}</b>
        <span class="tiny faint">${price(t.price)} ${esc(t.currency)}</span></div>
    </div>`).join('')
    : `<div class="empty-state">${UI.icon('list')}<p>${trades.length ? 'Aucun ordre pour ce filtre.' : 'Aucun ordre pour l’instant.'}</p></div>`;
  document.querySelectorAll('[data-trade]').forEach((row) => {
    const open = () => tradeDrawer(trades.find((t) => t.id === row.dataset.trade));
    row.onclick = open;
    row.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}
document.querySelectorAll('#historyFilter [data-filter]').forEach((b) => (b.onclick = () => {
  historyFilter = b.dataset.filter;
  document.querySelectorAll('#historyFilter .chip').forEach((c) => c.classList.toggle('on', c === b));
  renderActivity();
}));

function historyMiroir(m) {
  if (m.status === 'analysed') {
    const up = m.driftAfter > m.driftBefore;
    return `<span class="pill ${m.overrodeRules ? 'red' : up ? 'amber' : 'outline'}" title="Dérive WorthKnowing">
      ${m.overrodeRules ? UI.icon('alert', 'sm') : ''}${m.driftBefore} → ${m.driftAfter}</span>`;
  }
  if (m.status === 'pending') return '<span class="pill outline"><span class="spinner" style="width:10px;height:10px"></span>analyse</span>';
  return m.status === 'unavailable' ? '<span class="pill outline faint">non analysé</span>' : '';
}

function tradeDrawer(t) {
  if (!t) return;
  const m = t.miroir;
  UI.drawer(`<div class="side-icon ${t.side}">${UI.icon(t.side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>
      <div><div class="eyebrow">${t.side === 'buy' ? 'Achat' : 'Vente'}</div><h2>${esc(t.ticker)}</h2></div>`,
  `<div class="kpi">${money(t.amount, 2)}</div><p class="small muted" style="margin-top:4px">${esc(assetName(t.ticker))}</p>
    <dl class="facts" style="margin-top:20px">
      <dt>Date de marché</dt><dd>${esc(day(t.marketDate + 'T12:00:00'))}</dd>
      <dt>Cours</dt><dd>${price(t.price)} ${esc(t.currency)}</dd>
      <dt>Quantité</dt><dd>${t.qty.toLocaleString('fr-CA', { maximumFractionDigits: 4 })}</dd>
      <dt>Temps de décision</dt><dd>${Math.round(t.decisionTimeMs / 1000)} s</dd>
    </dl>
    ${t.note ? `<div class="notice ink" style="margin-top:16px">${UI.icon('edit', 'sm')}<span>« ${esc(t.note)} »</span></div>` : ''}
    ${analysisHtml(t)}`);
}

/** Bloc « Analyse WorthKnowing » d'un ordre (fenêtre de résultat et tiroir). */
function analysisHtml(trade) {
  const m = trade.miroir;
  if (m.status === 'not_linked') return '';
  if (m.status === 'pending') return `<div class="analysis" data-pending-trade="${esc(trade.id)}">
      <div class="eyebrow" style="color:rgba(247,241,232,.5)">Analyse WorthKnowing</div>
      <p style="margin-top:10px"><span class="spinner" style="border-color:#ff8a98;border-top-color:transparent"></span>&nbsp; Enquête en cours…</p></div>`;
  if (m.status === 'unavailable') return `<div class="notice" style="margin-top:16px">${UI.icon('info', 'sm')}<span>WorthKnowing n’a pas répondu : ordre non analysé.</span></div>`;
  return `<div class="analysis">
    <div class="row between"><span class="eyebrow" style="color:rgba(247,241,232,.5)">Analyse WorthKnowing</span>
      ${m.overrodeRules ? '<span class="pill red">règle outrepassée</span>' : ''}</div>
    <div class="drift-move"><span class="muted">${m.driftBefore}</span>${UI.icon('arrowRight')}<span style="color:${m.driftAfter >= m.driftBefore ? '#ff8a98' : '#8fe0b5'}">${m.driftAfter}</span>
      <span class="tiny muted" style="font-family:var(--sans)">dérive</span></div>
    <p class="small" style="margin-top:10px;opacity:.85">${esc(m.summary)}</p>
    ${m.reevaluationRequired ? '<p class="small" style="margin-top:10px;color:#ff8a98"><b>Seuil dépassé : réévaluation exigée.</b></p>' : ''}
    <a class="small" style="display:inline-flex;gap:6px;margin-top:12px" href="${esc(me.miroir.urls.profile)}" target="_blank" rel="noopener">Enquête complète ${UI.icon('external', 'sm')}</a>
  </div>`;
}

// ------------------------------------------------------------------ Ticket d'ordre
/** La date du ticket ne peut pas être antérieure au dernier ordre (horloge de marché simulée). */
function syncClock() {
  if (!market || !me) return;
  const min = me.clock ?? market.firstDate;
  $('#date').min = min;
  $('#date').max = market.lastDate;
  if (!$('#date').value || $('#date').value < min) $('#date').value = min;
}

const ticket = () => ({
  ticker: $('#ticker').value, side: $('#sell').checked ? 'sell' : 'buy', amount: Number($('#amount').value),
  marketDate: $('#date').value, note: $('#note').value,
});

function setAmount(v) {
  $('#amount').value = v;
  document.querySelectorAll('#amountChips .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.amt) === Number(v)));
}
document.querySelectorAll('#amountChips .chip').forEach((c) => (c.onclick = () => {
  if (c.dataset.amt === 'max') {
    const t = ticket();
    const held = me?.portfolio.positions.find((p) => p.ticker === t.ticker)?.value ?? 0;
    setAmount((t.side === 'buy' ? Math.floor(me?.portfolio.cash ?? 0) : held).toFixed(2).replace(/\.00$/, ''));
    c.classList.add('on');
  } else setAmount(c.dataset.amt);
  $('#ticketError').textContent = '';
}));

function touchTicket() {
  ticketTouchedAt = Date.now();
  $('#ticketError').textContent = '';
  $('#orderButton').textContent = $('#sell').checked ? 'Vérifier la vente' : 'Vérifier l’achat';
  showQuote();
}

let quoteCall = 0;
async function showQuote() {
  const t = ticket();
  if (!t.ticker) return;
  const call = ++quoteCall; // une réponse plus ancienne que la dernière demande est ignorée
  try {
    const q = await api('GET', `/market/quote?ticker=${encodeURIComponent(t.ticker)}&date=${encodeURIComponent(t.marketDate)}`);
    if (call !== quoteCall) return;
    $('#quote').innerHTML = `<div class="q-top"><div><div class="q-name">${esc(q.name)}</div>
        <div class="q-price">${price(q.price)} <span class="tiny faint" style="font-family:var(--sans)">${esc(q.currency)}</span></div></div>
        <div style="text-align:right"><span class="pill ${q.ret30d >= 0 ? 'gain' : 'loss'}">${pct(q.ret30d)}</span><div class="tiny faint" style="margin-top:4px">30 séances</div></div></div>
      <div class="chart-box spark"><canvas id="spark"></canvas></div>`;
    if (q.history?.close?.length) {
      UI.area($('#spark'), q.history.dates, q.history.close, { minimal: true, color: q.ret30d >= 0 ? UI.C.gain : UI.C.red });
    }
  } catch (err) {
    if (call === quoteCall) $('#quote').innerHTML = `<p class="small loss">${esc(err.message)}</p>`;
  }
}

/**
 * Fenêtre de confirmation. Avec un compte lié, c'est ici que la règle que le client s'est fixée lui est rappelée.
 * Résout à true (confirmer) ou false (annuler).
 */
async function confirmOrder(t, preview) {
  const m = preview.miroir;
  const rules = m.status === 'ok' ? m.triggeredRules : [];
  const warnings = m.status === 'ok' ? m.warnings : [];
  const body = `
    <div class="row" style="gap:14px;margin-bottom:18px">
      <div class="side-icon ${t.side}">${UI.icon(t.side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>
      <div><div class="kpi" style="margin:0">${money(t.amount, 2)}</div><div class="small muted">${t.side === 'buy' ? 'Achat' : 'Vente'} de ${esc(t.ticker)}</div></div>
    </div>
    <dl class="facts">
      <dt>Cours</dt><dd>${price(preview.quote.price)} ${esc(preview.quote.currency)}</dd>
      <dt>Clôture du</dt><dd>${esc(day(preview.quote.date + 'T12:00:00'))}</dd>
      <dt>Quantité</dt><dd>${(t.amount / preview.quote.price).toLocaleString('fr-CA', { maximumFractionDigits: 4 })}</dd>
    </dl>
    ${rules.length ? `<div style="margin-top:22px"><span class="pill red">${UI.icon('shield', 'sm')}Rappel WorthKnowing</span>
      ${rules.map((r) => `<div class="rule-reminder"><span class="tiny faint">${esc(PARAM_LABELS[r.param] ?? r.param)}</span>
        <q>${esc(r.text)}</q><p class="tiny muted">${esc(r.reason)}</p></div>`).join('')}</div>` : ''}
    ${warnings.map((w) => `<div class="notice" style="margin-top:10px">${UI.icon('alert', 'sm')}<span>${esc(w)}</span></div>`).join('')}
    ${m.status === 'unavailable' ? `<p class="tiny faint" style="margin-top:14px">WorthKnowing ne répond pas : ordre non vérifié contre vos règles.</p>` : ''}`;
  const value = await UI.modal({
    title: rules.length ? 'Un instant…' : 'Confirmer l’ordre', body,
    actions: [
      { label: rules.length ? 'Renoncer' : 'Annuler', value: false, kind: rules.length ? '' : 'ghost' },
      { label: rules.length ? 'Passer outre' : 'Confirmer', value: true, kind: rules.length ? 'ghost' : 'primary' },
    ],
  });
  return value === true;
}

/** Fenêtre « Ordre exécuté » : se met à jour en direct quand l'analyse WorthKnowing arrive (SSE). */
function showResult(trade) {
  const html = () => `<svg class="check-anim" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg>
    <div style="text-align:center"><h2 class="display" style="font-size:26px">Ordre exécuté</h2>
      <p class="muted small" style="margin-top:6px">${trade.side === 'buy' ? 'Achat' : 'Vente'} de ${money(trade.amount, 2)} de ${esc(trade.ticker)}
        à ${price(trade.price)} ${esc(trade.currency)}</p></div>
    <div id="resultAnalysis">${analysisHtml(trade)}</div>
    <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>`;
  const s = UI.sheet(html(), { onClose: () => { openResult = null; } });
  openResult = { tradeId: trade.id, el: s.el };
}

// ------------------------------------------------------------------ Analyse WorthKnowing en arrière-plan (SSE)
let miroirStream = null;

/** Un seul flux par session, ouvert une fois connecté. Notifie quand une enquête « pending » se termine. */
function connectMiroirStream() {
  miroirStream?.close();
  miroirStream = new EventSource('/api/trades/stream?token=' + encodeURIComponent(session.token));
  miroirStream.onmessage = (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    if (!event?.trade) return; // ligne « ping » de maintien de connexion : rien à faire
    if (openResult?.tradeId === event.tradeId) {
      UI.swap(openResult.el.querySelector('#resultAnalysis'), analysisHtml(event.trade));
    } else if (event.trade.miroir?.status === 'analysed') {
      toast(`Analyse terminée pour ${event.trade.ticker} : dérive ${event.trade.miroir.driftBefore} → ${event.trade.miroir.driftAfter}.`, 'ok');
    }
    refresh().catch(() => {}); // met aussi à jour l'historique et la jauge de dérive
  };
  miroirStream.onerror = () => {
    if (miroirStream.readyState === EventSource.CLOSED) setTimeout(connectMiroirStream, 5000);
  };
}

$('#ticket').onsubmit = async (e) => {
  e.preventDefault();
  if ($('#orderButton').disabled) return; // double clic ou envoi déjà en cours
  const label = $('#orderButton').textContent;
  $('#orderButton').disabled = true;
  $('#orderButton').innerHTML = '<span class="spinner" style="border-color:#fff;border-top-color:transparent"></span>';
  $('#ticketError').textContent = '';
  const t = ticket();
  try {
    // 1. Vérification : cotation, liquidités, et règles WorthKnowing à rappeler.
    const preview = await api('POST', '/trades/preview', { ...t, decisionTimeMs: Date.now() - ticketTouchedAt });
    if (preview.miroir.status === 'ok' && preview.miroir.reevaluationRequired) return; // refresh() affiche le bandeau
    // 2. Confirmation (avec rappel de la règle).
    const rules = preview.miroir.status === 'ok' ? preview.miroir.triggeredRules : [];
    if (!(await confirmOrder(t, preview))) {
      if (rules.length) {
        await api('POST', '/trades/cancel', { ...t, decisionTimeMs: Date.now() - ticketTouchedAt }).catch(() => {});
        toast('Ordre abandonné. WorthKnowing note que vous avez respecté votre règle.', 'ok');
      }
      return;
    }
    // 3. Exécution — confirmée tout de suite ; l'analyse arrive ensuite par SSE.
    const out = await api('POST', '/trades', {
      ...t, decisionTimeMs: Date.now() - ticketTouchedAt, acknowledgedRuleIds: rules.map((r) => r.ruleId),
    });
    showResult(out.trade);
    $('#note').value = '';
  } catch (err) {
    $('#ticketError').textContent = err.message;
  } finally {
    $('#orderButton').textContent = label;
    $('#orderButton').disabled = false; // refresh() le verrouille de nouveau si une réévaluation est requise
    ticketTouchedAt = Date.now();
    await refresh().catch((err) => { $('#ticketError').textContent ||= err.message; });
  }
};

// ------------------------------------------------------------------ Démarrage
(async () => {
  if (!session.token) return (location.href = '/');
  $('#navLogo').innerHTML = UI.logo('boreal', { href: '/app.html' });
  $('#logout').innerHTML = UI.icon('logout', 'sm');
  $('#logout').onclick = () => session.clear();
  if (location.hash === '#activity') showView('activity');
  connectMiroirStream();

  // Retour de WorthKnowing après la création du profil : ?code=…&state=… -> on termine la liaison côté serveur.
  const query = new URLSearchParams(location.search);
  if (query.get('code')) {
    history.replaceState(null, '', '/app.html'); // le code ne reste pas dans la barre d'adresse ni dans l'historique
    try {
      await api('POST', '/miroir/link/complete', { code: query.get('code'), state: query.get('state') });
      UI.modal({
        icon: `<div class="avatar" style="width:48px;height:48px;margin-bottom:14px">${UI.icon('shield')}</div>`,
        title: 'WorthKnowing est activé',
        body: '<p class="muted">Vos règles vous seront rappelées avant chaque ordre concerné, et chaque ordre sera analysé.</p>',
        actions: [{ label: 'Parfait', value: true, kind: 'primary' }],
      });
    } catch (err) { toast('Liaison avec WorthKnowing impossible : ' + err.message); }
  }

  const assets = await api('GET', '/market/assets').then((v) => ({ status: 'fulfilled', value: v }), (r) => ({ status: 'rejected', reason: r }));
  if (assets.status === 'fulfilled') {
    market = assets.value;
    const CLASSES = { equity: 'Actions', etf_equity: 'FNB d’actions', etf_bond: 'FNB d’obligations', etf_commodity: 'FNB de matières premières', crypto: 'Cryptoactifs' };
    const groups = {};
    for (const a of market.assets) (groups[a.asset_class] ??= []).push(a);
    $('#ticker').innerHTML = Object.entries(groups).map(([k, list]) => `<optgroup label="${esc(CLASSES[k] ?? k)}">
      ${list.map((a) => `<option value="${esc(a.ticker)}">${esc(a.ticker)} · ${esc(a.name)}</option>`).join('')}</optgroup>`).join('');
    for (const id of ['#ticker', '#date', '#buy', '#sell']) $(id).onchange = touchTicket;
    $('#amount').oninput = () => { $('#ticketError').textContent = ''; setAmount($('#amount').value); };
  }
  const account = await refresh().then(() => ({ status: 'fulfilled' }), (r) => ({ status: 'rejected', reason: r }));
  if (market) { syncClock(); touchTicket(); }
  const failure = [account, assets].find((r) => r.status === 'rejected');
  if (failure) $('#ticketError').textContent = failure.reason.message;
})();
