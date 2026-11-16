// Page principale de Boréal Courtage : portefeuille, ticket d'ordre, activité, et service WorthKnowing (facultatif).
// La page ne défile pas : chaque vue est une grille qui remplit l'écran, les listes défilent dans leur widget.
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
let selectedTradeId = null; // ordre affiché dans le détail de la vue Activité
let openResult = null; // fenêtre « ordre exécuté » ouverte : { tradeId, el }

const PARAM_LABELS = {
  riskTolerance: 'Appétit pour le risque', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »',
  concentration: 'Concentration', impulsivity: 'Impulsivité', newsSensitivity: 'Sensibilité aux nouvelles',
};
/** Les agents de WorthKnowing qui enquêtent sur chaque ordre (la plateforme n'en reçoit que la conclusion). */
const WK_AGENTS = ['marche', 'nouvelles', 'gouvernance', 'comportement', 'influence', 'profil'];
const ALLOC_COLORS = ['#ff4763', '#a98bf5', '#f5b84a', '#2ec4b6', '#ff7a59', '#5b8def', '#f2b3bb', '#3ccf8e'];
const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
const wkLogo = () => `<span class="logo">${UI.wkMark(true)}<span class="logo-word">Worth<i>Knowing</i></span></span>`;
const sideIcon = (side) => `<div class="side-icon ${side}">${UI.icon(side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>`;
/** Lien direct vers l'enquête complète d'un ordre, chez WorthKnowing. */
const investigationUrl = (m) => `${me.miroir.urls.profile}profile.html#enquete=${encodeURIComponent(m.tradeId ?? '')}`;

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
  $('#gain').innerHTML = `<span class="pill glass">${UI.icon(gain >= 0 ? 'arrowUp' : 'arrowDown', 'sm')}${money(Math.abs(gain), 2)} · ${pct(gain / me.startingCash)}</span>
    <span class="tiny faint">depuis l’ouverture</span>`;
  $('#cash').textContent = money(pf.cash);
  $('#invested').textContent = money(invested);
  $('#cashHint').textContent = `${money(pf.cash)} disponibles`;
  $('#asOf').textContent = me.clock ? `Valorisé à la clôture du ${day(me.clock + 'T12:00:00')}` : 'Aucun ordre pour l’instant';
  syncClock();

  renderValueChart(valueHistory.points);
  renderAllocation(pf);
  renderPositions(pf);
  renderMiroir();
  if (!$('#view-activity').classList.contains('hidden')) renderActivity();
}

function renderValueChart(points) {
  const empty = points.length < 2;
  $('#valueEmpty').classList.toggle('hidden', !empty);
  if (empty) return UI.chart($('#valueChart'), { type: 'line', data: { labels: [], datasets: [] }, options: { scales: { x: { display: false }, y: { display: false } } } });
  UI.area($('#valueChart'), points.map((p) => shortDate(p.date)), points.map((p) => p.value), {
    color: '#ffffff', fill: 0.30, width: 2.4, grid: 'rgba(255,255,255,.14)', tick: 'rgba(255,255,255,.72)', format: (v) => money(v),
  });
}

function renderAllocation(pf) {
  const top = pf.positions.slice(0, 5);
  const rest = pf.positions.slice(5).reduce((s, p) => s + p.value, 0);
  const labels = [...top.map((p) => p.ticker), ...(rest ? ['Autres'] : []), 'Liquidités'];
  const values = [...top.map((p) => p.value), ...(rest ? [rest] : []), pf.cash];
  const colors = labels.map((l, i) => (l === 'Liquidités' ? 'rgba(247,239,245,.20)' : ALLOC_COLORS[i % ALLOC_COLORS.length]));
  UI.donut($('#allocChart'), labels, values, colors);
  $('#allocCash').textContent = `${Math.round((pf.cash / pf.total) * 100)} %`;
  $('#allocCount').textContent = `${pf.positions.length} actif${pf.positions.length > 1 ? 's' : ''}`;
  $('#allocLegend').innerHTML = labels.map((l, i) => `<div><i style="background:${colors[i]}"></i><span>${esc(l)}</span>
    <b>${Math.round((values[i] / pf.total) * 100)} %</b></div>`).join('');
}

function renderPositions(pf) {
  $('#positions').innerHTML = pf.positions.length ? pf.positions.map((p) => {
    const ret = p.invested ? p.gain / p.invested : 0;
    return `<div class="list-item clickable position" data-sell="${esc(p.ticker)}" data-value="${p.value.toFixed(2)}" tabindex="0" title="Cliquer pour vendre">
      <div class="ticker-badge">${esc(p.ticker.replace(/[-.].*$/, '').slice(0, 5))}</div>
      <div class="grow"><div class="title">${esc(p.ticker)}</div><div class="sub">${esc(assetName(p.ticker))}</div></div>
      <div class="end"><span class="tiny faint">${(p.weight * 100).toFixed(0)} %</span><div class="bar"><i style="width:${Math.min(100, p.weight * 100)}%"></i></div></div>
      <div class="end" style="min-width:86px"><b>${money(p.value)}</b><span class="tiny ${ret >= 0 ? 'gain' : 'loss'}">${pct(ret)}</span></div>
    </div>`;
  }).join('')
    : `<div class="empty-state">${UI.icon('pie')}<p>Aucune position. Passez un premier ordre avec le ticket.</p></div>`;
  document.querySelectorAll('[data-sell]').forEach((row) => {
    const go = () => {
      $('#sell').checked = true;
      $('#ticker').value = row.dataset.sell;
      setAmount(row.dataset.value);
      touchTicket();
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
  let widget = '';

  if (status === 'linked') {
    widget = persona ? `
      <div class="widget-head">${wkLogo()}<span class="pill glass"><span class="dot live"></span>actif</span></div>
      ${UI.gauge(persona.drift.score, persona.drift.threshold, { dark: true })}
      <p class="tiny faint" style="text-align:center;margin-top:2px">Score de dérive</p>
      <div class="wk-foot">
        <div class="wk-line"><span>${persona.rules.length} règle${persona.rules.length > 1 ? 's' : ''} active${persona.rules.length > 1 ? 's' : ''}</span>
          <button class="btn link sm" id="showRules">Voir ${UI.icon('chevron', 'sm')}</button></div>
        <div class="row between"><a class="btn glass sm" href="${esc(urls.profile)}" target="_blank" rel="noopener">Mon profil ${UI.icon('external', 'sm')}</a>
          <button class="btn link sm" data-miroir="unlink">Retirer</button></div>
      </div>`
      : `<div class="widget-head">${wkLogo()}</div>
        <p class="small muted">Le service ne répond pas pour le moment. Vos ordres passent normalement, sans analyse.</p>`;
  } else if (status === 'pending') {
    widget = `<div class="widget-head">${wkLogo()}<span class="pill glass">en attente</span></div>
      <p class="offer-title">Terminez votre <i>profil</i></p>
      <p class="small muted" style="margin-top:6px">Quelques minutes, puis retour automatique ici.</p>
      <div class="wk-foot"><button class="btn primary block" data-miroir="start">Continuer ${UI.icon('arrowRight', 'sm')}</button>
        <button class="btn link sm" data-miroir="decline">Annuler l’activation</button></div>`;
  } else {
    widget = `<div class="widget-head">${wkLogo()}<span class="pill glass">partenaire</span></div>
      <p class="offer-title">Investissez-vous comme vous le <i>pensez</i>&nbsp;?</p>
      <p class="small muted" style="margin-top:6px">Six agents analysent chaque ordre et vous rappellent vos propres règles.</p>
      <div class="wk-foot"><button class="btn primary block" data-miroir="start">Activer ${UI.icon('arrowRight', 'sm')}</button>
        ${status === 'none' ? '<button class="btn link sm" data-miroir="decline">Non merci</button>' : ''}</div>`;
  }

  $('#notices').innerHTML = blocked ? `<div class="banner rise">${UI.icon('pause', 'lg')}
      <div class="grow"><h3>Ordres suspendus</h3>
        <p>Votre dérive atteint ${persona.drift.score} / ${persona.drift.threshold}. Refaites votre évaluation WorthKnowing pour reprendre.</p></div>
      <a class="btn white sm" href="${esc(urls.reevaluate)}">Refaire l’évaluation ${UI.icon('arrowRight', 'sm')}</a>
    </div>` : '';
  const w = $('#wkWidget');
  w.innerHTML = widget;
  UI.animateGauges(w);
  $('#wkPill').innerHTML = status === 'linked' && persona
    ? `<span class="pill ${blocked ? 'red' : 'outline'}" title="Score de dérive WorthKnowing">${UI.wkMark()}<span class="num">${persona.drift.score}</span></span>` : '';
  $('#wkPill').querySelector('svg')?.setAttribute('style', 'width:15px;height:15px');
  $('#orderButton').disabled = blocked;
  if ($('#showRules')) $('#showRules').onclick = () => UI.modal({
    title: 'Vos règles',
    body: persona.rules.length ? persona.rules.map((r) => `<div class="rule-reminder"><q>${esc(r.text)}</q></div>`).join('')
      : '<p class="muted">Aucune règle définie.</p>',
    actions: [{ label: 'Gérer dans WorthKnowing', value: 'go', kind: '' }],
  }).then((v) => { if (v === 'go') window.open(urls.profile + 'profile.html#regles', '_blank', 'noopener'); });

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

// ------------------------------------------------------------------ Activité : liste, dérive, détail d'un ordre
function renderActivity() {
  if (!me) return;
  const linked = me.miroir.status === 'linked';
  const analysed = trades.filter((t) => t.miroir.status === 'analysed');
  const overrides = analysed.filter((t) => t.miroir.overrodeRules).length;
  const volume = trades.reduce((s, t) => s + t.amount, 0);
  const dash = linked || analysed.length;
  $('#activityStats').innerHTML = [
    ['Ordres', trades.length], ['Volume', money(volume)], ['Analysés', dash ? analysed.length : '—'], ['Écarts', dash ? overrides : '—'],
  ].map(([label, v]) => `<div class="stat-tile"><div class="kpi-label">${label}</div><div class="kpi">${v}</div></div>`).join('');

  if (!trades.some((t) => t.id === selectedTradeId)) selectedTradeId = trades[0]?.id ?? null;

  // Dérive dans le temps : chronologique, un point par ordre analysé. Cliquer un point ouvre l'ordre.
  const chrono = [...analysed].reverse();
  $('#driftEmpty').classList.toggle('hidden', chrono.length > 0);
  $('#driftEmpty span').textContent = linked ? 'La courbe apparaîtra après votre premier ordre analysé.' : 'Activez WorthKnowing pour suivre votre dérive.';
  if (chrono.length) {
    UI.driftLine($('#driftChart'), ['Départ', ...chrono.map((t) => `${t.ticker} · ${shortDate(t.marketDate)}`)],
      [chrono[0].miroir.driftBefore, ...chrono.map((t) => t.miroir.driftAfter)], persona?.drift.threshold ?? 60,
      [false, ...chrono.map((t) => t.miroir.overrodeRules)],
      { selected: chrono.findIndex((t) => t.id === selectedTradeId) + 1 || undefined, onSelect: (i) => { if (i > 0) selectTrade(chrono[i - 1].id); } });
  } else UI.chart($('#driftChart'), { type: 'line', data: { labels: [], datasets: [] }, options: { scales: { x: { display: false }, y: { display: false } } } });

  renderHistory();
  renderOrderDetail();
}

function renderHistory() {
  const filtered = trades.filter((t) => historyFilter === 'all' || (historyFilter === 'flag' ? t.miroir.overrodeRules : t.side === historyFilter));
  $('#history').innerHTML = filtered.length ? filtered.map((t) => `<div class="list-item clickable history-item ${t.id === selectedTradeId ? 'selected' : ''}" data-trade="${esc(t.id)}" tabindex="0">
      ${sideIcon(t.side)}
      <div class="grow"><div class="title">${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(t.ticker)}</div>
        <div class="sub">${esc(day(t.marketDate + 'T12:00:00'))}</div></div>
      <div class="end">${historyMiroir(t.miroir)}</div>
      <div class="end" style="min-width:84px"><b>${money(t.amount)}</b></div>
    </div>`).join('')
    : `<div class="empty-state">${UI.icon('list')}<p>${trades.length ? 'Aucun ordre pour ce filtre.' : 'Aucun ordre pour l’instant.'}</p></div>`;
  document.querySelectorAll('[data-trade]').forEach((row) => {
    row.onclick = () => selectTrade(row.dataset.trade);
    row.onkeydown = (e) => { if (e.key === 'Enter') selectTrade(row.dataset.trade); };
  });
}
function selectTrade(id) {
  selectedTradeId = id;
  renderActivity();
}
document.querySelectorAll('#historyFilter [data-filter]').forEach((b) => (b.onclick = () => {
  historyFilter = b.dataset.filter;
  document.querySelectorAll('#historyFilter .chip').forEach((c) => c.classList.toggle('on', c === b));
  renderHistory();
}));

function historyMiroir(m) {
  if (m.status === 'analysed') {
    const up = m.driftAfter > m.driftBefore;
    return `<span class="pill ${m.overrodeRules ? 'red' : up ? 'amber' : 'outline'}" title="Dérive WorthKnowing">
      ${m.overrodeRules ? UI.icon('alert', 'sm') : ''}${m.driftBefore} → ${m.driftAfter}</span>`;
  }
  if (m.status === 'pending') return '<span class="pill outline"><span class="spinner" style="width:10px;height:10px"></span>enquête</span>';
  return m.status === 'unavailable' ? '<span class="pill outline faint">non analysé</span>' : '';
}

/** Détail de l'ordre sélectionné : les faits à gauche, la conclusion de l'enquête WorthKnowing à droite. */
function renderOrderDetail() {
  const t = trades.find((x) => x.id === selectedTradeId);
  const el = $('#orderDetail');
  if (!t) {
    el.innerHTML = `<div class="empty-state" style="flex:1">${UI.icon('activity')}<p>Passez un ordre : son détail et son enquête apparaîtront ici.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="od-main">
      <div class="od-head">${sideIcon(t.side)}
        <div class="grow"><div class="eyebrow">${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(day(t.marketDate + 'T12:00:00'))}</div>
          <h2>${esc(t.ticker)} <span class="faint" style="font:400 13px var(--sans)">${esc(assetName(t.ticker))}</span></h2></div>
        <div class="kpi">${money(t.amount, 2)}</div></div>
      <div class="od-facts">
        <div class="stat-tile"><div class="kpi-label">Cours</div><div class="kpi">${price(t.price)} <span class="tiny faint" style="font-family:var(--sans)">${esc(t.currency)}</span></div></div>
        <div class="stat-tile"><div class="kpi-label">Quantité</div><div class="kpi">${t.qty.toLocaleString('fr-CA', { maximumFractionDigits: 4 })}</div></div>
        <div class="stat-tile"><div class="kpi-label">Temps de décision</div><div class="kpi">${Math.round(t.decisionTimeMs / 1000)} s</div></div>
        <div class="stat-tile"><div class="kpi-label">Passé le</div><div class="kpi">${new Date(t.createdAt).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}</div></div>
      </div>
      ${t.note ? `<p class="od-note">« ${esc(t.note)} »</p>` : ''}
      <div class="od-chart"><div class="row between"><span class="kpi-label">Cours sur les 90 séances avant l’ordre</span><span id="odRet"></span></div>
        <div class="chart-box fill"><canvas id="odChart"></canvas></div></div>
    </div>
    <div class="od-wk">${wkBlock(t)}</div>`;
  drawOrderChart(t);
  el.querySelector('[data-backfill]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('POST', '/miroir/backfill');
      toast(r.started ? 'Analyse relancée : le résultat s’affichera ici dès qu’elle est terminée.' : 'Rien à analyser.', 'ok');
      refresh().catch(() => {});
    } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  });
  el.querySelector('[data-miroir-start]')?.addEventListener('click', async () => {
    try { location.href = (await api('POST', '/miroir/link/start')).redirectUrl; } catch (err) { toast(err.message); }
  });
}

/** Courbe du cours avant l'ordre (mise en cache par ordre). */
const quoteCache = new Map();
async function drawOrderChart(t) {
  try {
    if (!quoteCache.has(t.id)) quoteCache.set(t.id, await api('GET', `/market/quote?ticker=${encodeURIComponent(t.ticker)}&date=${encodeURIComponent(t.marketDate)}`));
    const q = quoteCache.get(t.id);
    if (t.id !== selectedTradeId || !$('#odChart')) return;
    $('#odRet').innerHTML = `<span class="pill ${q.ret30d >= 0 ? 'gain' : 'loss'}">${pct(q.ret30d)} sur 30 séances</span>`;
    UI.area($('#odChart'), q.history.dates.map(shortDate), q.history.close, { color: q.ret30d >= 0 ? UI.C.gain : UI.C.red, format: (v) => price(v), fill: 0.16 });
  } catch { /* la courbe est un complément : son absence ne gêne pas */ }
}

/** Conclusion de l'enquête WorthKnowing d'un ordre, avec l'équipe d'agents qui l'a menée. */
function wkBlock(t) {
  const m = t.miroir;
  const head = (right = '') => `<div class="row between">${wkLogo()}${right}</div>`;
  if (m.status === 'not_linked') return `${head()}
    <p class="summary" style="margin-top:6px">Cet ordre n’a pas été analysé : WorthKnowing n’était pas actif.</p>
    <p class="small muted">Une fois activé, six agents enquêtent sur chaque ordre : marché, nouvelles, vos règles, votre comportement, influence externe, mise à jour du profil.</p>
    ${UI.agents(WK_AGENTS, { size: 'sm', dark: true, mode: 'working' })}
    ${me.miroir.status !== 'linked'
      ? `<div class="wk-cta"><span></span><button class="btn primary sm" data-miroir-start>Activer WorthKnowing ${UI.icon('arrowRight', 'sm')}</button></div>`
      : `<div class="wk-cta"><span class="tiny muted">WorthKnowing est actif maintenant : cet ordre peut être analysé après coup.</span><button class="btn primary sm" data-backfill>Analyser maintenant</button></div>`}`;
  if (m.status === 'pending') return `${head('<span class="pill glass"><span class="dot live"></span>enquête en cours</span>')}
    <p class="summary" style="margin-top:6px">Vos agents enquêtent sur cet ordre…</p>
    ${UI.agents(WK_AGENTS, { size: 'sm', dark: true, mode: 'working' })}
    <p class="small muted">Le résultat s’affichera ici automatiquement, en général en quelques secondes.</p>`;
  if (m.status === 'unavailable') return `${head()}
    <p class="summary" style="margin-top:6px">WorthKnowing n’a pas répondu : cet ordre est exécuté, mais n’a pas été analysé.</p>
    ${me.miroir.status === 'linked' ? `<div class="wk-cta"><span></span><button class="btn primary sm" data-backfill>Réessayer l’analyse</button></div>` : ''}`;
  return `${head(m.overrodeRules ? `<span class="pill" style="background:#ff5a6e;color:#fff">${UI.icon('alert', 'sm')}règle outrepassée</span>` : '<span class="pill glass">enquête terminée</span>')}
    ${UI.agents(WK_AGENTS, { size: 'sm', dark: true })}
    <div class="drift-move"><span class="muted">${m.driftBefore}</span>${UI.icon('arrowRight')}<span style="color:${m.driftAfter > m.driftBefore ? '#ff8a98' : m.driftAfter < m.driftBefore ? '#8fe0b5' : '#fff'}">${m.driftAfter}</span><small>score de dérive</small></div>
    <p class="summary">${esc(m.summary)}</p>
    ${m.reevaluationRequired ? '<p class="small" style="color:#ff8a98"><b>Seuil dépassé : réévaluation exigée.</b></p>' : ''}
    <div class="wk-cta"><span class="tiny muted">Le détail de chaque agent reste chez WorthKnowing.</span>
      <a class="btn white sm" href="${esc(investigationUrl(m))}" target="_blank" rel="noopener">Voir l’enquête complète ${UI.icon('external', 'sm')}</a></div>`;
}

// ------------------------------------------------------------------ Ticket d'ordre
/** La date du ticket ne peut pas être antérieure au dernier ordre (horloge de marché simulée). */
function syncClock() {
  if (!market || !me) return;
  const min = me.clock ?? market.firstDate;
  $('#date').min = min;
  $('#date').max = market.lastDate;
  // Par défaut : la séance la plus récente (nouvelles et cours d'actualité). L'horloge ne recule jamais ensuite.
  if (!$('#date').value || $('#date').value < min) $('#date').value = me.clock ?? market.lastDate;
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
        <div style="text-align:right"><span class="pill ${q.ret30d >= 0 ? 'gain' : 'loss'}">${pct(q.ret30d)}</span><div class="tiny faint" style="margin-top:3px">30 séances</div></div></div>
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
    <div class="row" style="gap:14px;margin-bottom:16px">${sideIcon(t.side)}
      <div><div class="kpi" style="margin:0">${money(t.amount, 2)}</div><div class="small muted">${t.side === 'buy' ? 'Achat' : 'Vente'} de ${esc(t.ticker)}</div></div>
    </div>
    <dl class="facts">
      <dt>Cours</dt><dd>${price(preview.quote.price)} ${esc(preview.quote.currency)}</dd>
      <dt>Clôture du</dt><dd>${esc(day(preview.quote.date + 'T12:00:00'))}</dd>
      <dt>Quantité</dt><dd>${(t.amount / preview.quote.price).toLocaleString('fr-CA', { maximumFractionDigits: 4 })}</dd>
    </dl>
    ${rules.length ? `<div style="margin-top:20px"><span class="pill red">${UI.icon('shield', 'sm')}Rappel WorthKnowing</span>
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

/** Bloc WorthKnowing de la fenêtre « Ordre exécuté » : les agents au travail, puis leur conclusion. */
function resultWk(trade) {
  const m = trade.miroir;
  if (m.status === 'not_linked') return '';
  if (m.status === 'unavailable') return `<div class="notice" style="margin-top:16px">${UI.icon('info', 'sm')}<span>WorthKnowing n’a pas répondu : ordre non analysé.</span></div>`;
  if (m.status === 'pending') return `<div class="result-wk">
      <div class="row between">${wkLogo()}<span class="pill glass"><span class="dot live"></span>enquête en cours</span></div>
      ${UI.agents(WK_AGENTS, { size: 'sm', dark: true, mode: 'working' })}
      <p class="small muted" style="margin-top:8px;text-align:center">Six agents enquêtent sur votre ordre…</p></div>`;
  return `<div class="result-wk">
    <div class="row between">${wkLogo()}${m.overrodeRules ? '<span class="pill" style="background:#ff5a6e;color:#fff">règle outrepassée</span>' : '<span class="pill glass">enquête terminée</span>'}</div>
    ${UI.agents(WK_AGENTS, { size: 'sm', dark: true })}
    <div class="drift-move"><span class="muted">${m.driftBefore}</span>${UI.icon('arrowRight')}<span style="color:${m.driftAfter > m.driftBefore ? '#ff8a98' : '#8fe0b5'}">${m.driftAfter}</span><small>score de dérive</small></div>
    <p class="small" style="margin-top:8px;opacity:.9">${esc(m.summary)}</p>
    ${m.reevaluationRequired ? '<p class="small" style="margin-top:8px;color:#ff8a98"><b>Seuil dépassé : réévaluation exigée.</b></p>' : ''}
  </div>`;
}

/** Fenêtre « Ordre exécuté » : se met à jour en direct quand l'analyse WorthKnowing arrive (SSE). */
function showResult(trade) {
  const actions = (t) => `<button class="btn ghost" data-close>Fermer</button>
    ${t.miroir.status === 'analysed' || t.miroir.status === 'pending' ? '<button class="btn" data-see>Voir dans Activité</button>' : ''}`;
  const s = UI.sheet(`<svg class="check-anim" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg>
    <div style="text-align:center"><h2 class="display" style="font-size:25px">Ordre exécuté</h2>
      <p class="muted small" style="margin-top:6px">${trade.side === 'buy' ? 'Achat' : 'Vente'} de ${money(trade.amount, 2)} de ${esc(trade.ticker)}
        à ${price(trade.price)} ${esc(trade.currency)}</p></div>
    <div id="resultAnalysis">${resultWk(trade)}</div>
    <div class="modal-actions">${actions(trade)}</div>`, { onClose: () => { openResult = null; } });
  s.el.querySelector('[data-see]')?.addEventListener('click', () => { s.close(); selectedTradeId = trade.id; showView('activity'); });
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
      UI.swap(openResult.el.querySelector('#resultAnalysis'), resultWk(event.trade));
    } else if (event.trade.miroir?.status === 'analysed') {
      toast(`Enquête terminée pour ${event.trade.ticker} : dérive ${event.trade.miroir.driftBefore} → ${event.trade.miroir.driftAfter}.`, 'ok');
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
    selectedTradeId = out.trade.id;
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
      const done = await api('POST', '/miroir/link/complete', { code: query.get('code'), state: query.get('state') });
      UI.modal({
        title: 'WorthKnowing est activé',
        body: `<p class="muted">Vos règles vous seront rappelées avant chaque ordre concerné, et six agents enquêteront sur chaque ordre.</p>
          ${done.backfilled ? `<p class="muted" style="margin-top:10px">${done.backfilled} ordre(s) passé(s) avant l’activation sont analysés maintenant, un par un ; les résultats apparaissent dans Activité.</p>` : ''}
          <div style="margin-top:16px">${UI.agents(WK_AGENTS, { size: 'sm' })}</div>`,
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
