// L'enquête d'un ordre, partagée par l'espace personnel et la vue admin.
// Tout est visible d'un coup : la conclusion à gauche, et l'équipe d'agents en haut — un clic sur un agent
// affiche son rapport à droite. Rien n'est caché dans un tiroir.

const VERDICTS = {
  influence_externe: 'Influence externe possible', changement_de_comportement: 'Changement de comportement',
  les_deux: 'Influence externe et changement de comportement', conforme: 'Rien de particulier', indetermine: 'Impossible de conclure',
};
const pctFr = (n, d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(d).replace('.', ',')} %`;
const tradeTitle = (t) => `${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(t.ticker)}`;
const sideIcon = (side) => `<div class="side-icon ${side}">${UI.icon(side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>`;
const driftPill = (inv) => {
  const d = inv.driftAfter - inv.driftBefore;
  return `<span class="pill ${d > 0 ? (inv.driftAfter >= 60 ? 'red' : 'amber') : d < 0 ? 'gain' : 'outline'} num">${inv.driftBefore} → ${inv.driftAfter}</span>`;
};

/** Une ligne d'ordre : sens, actif, montant, variation de dérive. */
function tradeRow(t, selectedId) {
  return `<div class="list-item clickable ${t.id === selectedId ? 'selected' : ''}" data-trade-id="${esc(t.id)}" tabindex="0">
    ${sideIcon(t.side)}
    <div class="grow"><div class="title">${tradeTitle(t)} <span class="faint" style="font-weight:400">${money(t.amount)}</span></div>
      <div class="sub">${esc(day(t.marketDate + 'T12:00:00'))}</div></div>
    ${t.overrodeRules ? `<span class="pill red" title="Règle outrepassée">${UI.icon('alert', 'sm')}</span>` : ''}
    <div class="end">${driftPill(t.investigation)}</div>
  </div>`;
}
function bindTradeRows(root, onSelect) {
  root.querySelectorAll('[data-trade-id]').forEach((row) => {
    row.onclick = () => onSelect(row.dataset.tradeId);
    row.onkeydown = (e) => { if (e.key === 'Enter') onSelect(row.dataset.tradeId); };
  });
}

/** Courbe de dérive, un point par ordre (chronologique). Cliquer un point sélectionne l'ordre. */
function driftTimeline(canvas, trades, threshold, { selectedId, onSelect } = {}) {
  const chrono = [...trades].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!chrono.length || !canvas) return;
  UI.driftLine(canvas, ['Départ', ...chrono.map((t) => t.ticker)],
    [chrono[0].investigation.driftBefore, ...chrono.map((t) => t.investigation.driftAfter)], threshold,
    [false, ...chrono.map((t) => t.overrodeRules)],
    { selected: selectedId ? chrono.findIndex((t) => t.id === selectedId) + 1 || undefined : undefined,
      onSelect: onSelect ? (i) => { if (i > 0) onSelect(chrono[i - 1].id); } : undefined });
}

/** Les agents qui ont réellement travaillé sur cet ordre, dans l'ordre, + l'explicabilité (toujours). */
function agentsOf(inv) {
  const steps = {};
  for (const s of inv.explanation.steps) steps[UI.agentKey(s.agent)] = s;
  delete steps.explication;
  return { steps, keys: [...Object.keys(steps), 'explication'] };
}

/** Le rapport d'un agent : sa phrase de conclusion, puis ses pièces. */
function agentReport(key, t) {
  const inv = t.investigation;
  const a = UI.AGENTS[key];
  const { steps } = agentsOf(inv);
  const list = (items) => (items?.length ? `<ul class="plain-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="small faint">—</p>');
  const head = `<div class="report-head" style="--c:${a.color}"><span class="agent-orb">${UI.icon(a.icon)}</span>
      <div class="grow"><div class="eyebrow">Rapport de l’agent</div><h3>${a.name}</h3></div>
      ${a.ai ? '<span class="pill red">IA · Amazon Bedrock</span>' : '<span class="pill outline">calcul vérifiable</span>'}</div>
    ${steps[key] ? `<p class="report-lead" style="--c:${a.color}">${esc(steps[key].result)}</p>` : ''}`;
  let body = '';

  if (key === 'marche' && inv.context) {
    const c = inv.context;
    const tile = (label, value, cls = '') => `<div class="stat-tile"><div class="kpi-label">${label}</div><div class="kpi ${cls}">${value}</div></div>`;
    const ret = (v) => [pctFr(v), v >= 0 ? 'gain' : 'loss'];
    body = `<div class="report-block"><h4>${esc(c.name)} · ${esc(c.sector ?? '')}</h4><div class="fact-grid">
      ${tile('Cours', `${c.price.toFixed(2).replace('.', ',')} <span class="tiny faint" style="font-family:var(--sans)">${esc(c.currency)}</span>`)}
      ${tile('1 séance', ...ret(c.ret1d))}${tile('5 séances', ...ret(c.ret5d))}${tile('30 séances', ...ret(c.ret30d))}
      ${tile('90 séances', ...ret(c.ret90d))}${tile('Volatilité / an', `${(c.vol30d * 100).toFixed(0)} %`)}
      ${tile('Sous le sommet 90 j', pctFr(c.drawdown90d), c.drawdown90d < -0.1 ? 'loss' : '')}
      ${tile('Nature', c.speculative ? 'Spéculatif' : 'Classique', c.speculative ? 'loss' : '')}
    </div></div>`;
  } else if (key === 'nouvelles') {
    body = `<div class="report-block"><h4>Nouvelles des 7 jours précédant l’ordre</h4>${inv.news.length ? inv.news.map((n) => `<div class="news-item">
        <span class="pill ${n.simulated ? 'outline' : n.impact === 'élevé' ? 'red' : n.impact === 'moyen' ? 'amber' : 'outline'}" style="flex:none;align-self:flex-start">${n.simulated ? 'simulé' : 'impact ' + esc(n.impact)}</span>
        <div>${n.simulated || !n.url ? `<b class="small">${esc(n.title)}</b>` : `<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>`}
          <div class="tiny faint" style="margin-top:2px">${esc(n.source ?? '')}${n.date ? ' · ' + esc(n.date) : ''}</div>
          ${n.summary ? `<p class="small muted" style="margin-top:4px">${esc(n.summary)} <span class="faint">(reformulé par IA)</span></p>` : ''}</div></div>`).join('')
      : '<p class="small faint">Aucune nouvelle trouvée sur cette période.</p>'}</div>`;
  } else if (key === 'gouvernance') {
    body = `<div class="report-block"><h4>Règles concernées</h4>${inv.triggeredRules.length ? inv.triggeredRules.map((r) => `<div class="finding">
        <span class="pill red">${UI.icon('shield', 'sm')}${esc(PARAM_LABELS[r.param] ?? r.param)}</span>
        <p style="font:400 16px/1.4 var(--serif);margin:8px 0 4px">« ${esc(r.text)} »</p><p class="small muted">${esc(r.reason)}</p></div>`).join('')
      : '<p class="small faint">Cet ordre ne touchait aucune de vos règles.</p>'}</div>
      ${inv.warnings.length ? `<div class="report-block"><h4>Cohérence avec le profil déclaré</h4>${inv.warnings.map((w) => `<div class="notice" style="margin-top:8px">${UI.icon('alert', 'sm')}<span>${esc(w)}</span></div>`).join('')}</div>` : ''}`;
  } else if (key === 'comportement' || key === 'influence') {
    const mine = (inv.findings ?? []).filter((f) => (key === 'influence' ? f.origin === 'bedrock' : f.origin !== 'bedrock'));
    const verdict = key === 'influence' && inv.influence ? `<div class="report-block"><h4>Verdict</h4>
        <p style="font:500 19px var(--serif)">${esc(VERDICTS[inv.influence.verdict] ?? inv.influence.verdict)}</p>
        <p class="small muted" style="margin-top:6px">${esc(inv.influence.rationale)}</p>
        ${inv.influence.refs?.length ? `<p class="tiny faint" style="margin-top:8px">Références vérifiées par le code : ${inv.influence.refs.map(esc).join(', ')} (N = nouvelle, F = fait calculé).</p>` : ''}</div>` : '';
    body = `${verdict}<div class="report-block"><h4>Constats${key === 'influence' ? ' de l’IA (bornés)' : ''}</h4>${mine.length ? mine.map((f) => `<div class="finding">
        <div class="row"><b class="small">${esc(PARAM_LABELS[f.param] ?? f.param)}</b><span class="pill outline num">signal ${Math.round(f.signal)}</span></div>
        <p class="small muted" style="margin-top:4px">${esc(f.evidence)}</p></div>`).join('')
      : `<p class="small faint">${key === 'influence' ? 'Aucun constat supplémentaire.' : 'Aucun seuil franchi par rapport au profil de référence.'}</p>`}</div>`;
  } else if (key === 'profil') {
    const di = inv.derivationImpact;
    body = `<div class="report-block"><h4>Paramètres déplacés par cet ordre</h4>${inv.paramUpdates.length
        ? mirrorHead('Avant', 'Après') + inv.paramUpdates.map((u) => mirror(PARAM_LABELS[u.param], u.before, u.after)).join('')
        : '<p class="small faint">Aucun paramètre modifié.</p>'}</div>
      <div class="report-block"><h4>Score de dérive</h4><div class="fact-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="stat-tile"><div class="kpi-label">Avant</div><div class="kpi">${inv.driftBefore}</div></div>
        <div class="stat-tile"><div class="kpi-label">Après</div><div class="kpi ${inv.driftAfter > inv.driftBefore ? 'loss' : ''}">${inv.driftAfter}</div></div>
        <div class="stat-tile"><div class="kpi-label">Pénalité de règle</div><div class="kpi">${di?.penaltyAdded ? '+' + di.penaltyAdded : '0'}</div></div>
      </div>${di?.exceededThreshold ? `<div class="notice red" style="margin-top:10px">${UI.icon('alert', 'sm')}<span>Seuil de dérive dépassé : réévaluation exigée.</span></div>` : ''}</div>`;
  } else if (key === 'explication') {
    body = `<p class="report-lead" style="--c:${a.color}">Rédige la synthèse à partir des rapports des autres agents, et documente d’où vient chaque élément.</p>
      <div class="report-block"><h4>Sources</h4>${list(inv.explanation.sources)}</div>
      <div class="report-block"><h4>Hypothèses</h4>${list(inv.explanation.hypotheses)}</div>
      <div class="report-block"><h4>Limites</h4>${list(inv.explanation.limits)}</div>`;
  }
  return head + body;
}

/**
 * Affiche l'enquête d'un ordre dans `root`. `opts.compact` pour la fiche admin ; `opts.meta(t)` ajoute une ligne de faits.
 * L'agent ouvert par défaut est le plus parlant : l'influence (IA) si elle a répondu, sinon le comportement.
 */
function mountInvestigation(root, t, opts = {}) {
  const inv = t.investigation;
  const { keys } = agentsOf(inv);
  let current = opts.agent && keys.includes(opts.agent) ? opts.agent : keys.includes('influence') ? 'influence' : keys.includes('comportement') ? 'comportement' : keys[0];
  const up = inv.driftAfter > inv.driftBefore, down = inv.driftAfter < inv.driftBefore;
  const inf = inv.influence;
  root.innerHTML = `<div class="inv ${opts.compact ? 'compact' : ''}">
    <div class="inv-head">${sideIcon(t.side)}
      <div class="grow"><div class="eyebrow">${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(day(t.marketDate + 'T12:00:00'))} · décidé en ${Math.round(t.decisionTimeMs / 1000)} s${opts.meta ? ' · ' + opts.meta(t) : ''}</div>
        <h2>${esc(t.ticker)} · ${money(t.amount)}</h2></div>
      ${t.overrodeRules ? `<span class="pill" style="background:#ff5a6e;color:#fff">${UI.icon('alert', 'sm')}règle outrepassée</span>` : ''}
      <div class="inv-drift"><div class="move"><span style="opacity:.6">${inv.driftBefore}</span>${UI.icon('arrowRight')}<span style="color:${up ? '#ff8a98' : down ? '#8fe0b5' : '#fff'}">${inv.driftAfter}</span></div><small>score de dérive</small></div>
    </div>
    <div class="inv-team">
      <div class="team-label"><span class="eyebrow">${keys.length} agents ont enquêté sur cet ordre</span><span class="tiny faint">Cliquez sur un agent pour lire son rapport</span></div>
      ${UI.agents(keys, { clickable: true, selected: current })}
    </div>
    <div class="inv-body">
      <div class="inv-concl">
        <div><h4>Conclusion</h4><p class="inv-summary">${esc(inv.explanation.summary)}</p></div>
        ${inf ? `<div class="verdict" style="--c:${UI.AGENTS.influence.color}"><span class="agent-orb">${UI.icon('spark')}</span>
          <div><div class="tiny faint">Comportement ou influence externe ?</div><b>${esc(VERDICTS[inf.verdict] ?? inf.verdict)}</b>
          <p class="small muted" style="margin-top:4px">${esc(inf.rationale)}</p></div></div>` : ''}
        ${inv.triggeredRules.map((r) => `<div class="notice red">${UI.icon('shield', 'sm')}<span>Règle outrepassée : « ${esc(r.text)} »</span></div>`).join('')}
        ${t.note ? `<p class="note-quote">« ${esc(t.note)} »</p>` : ''}
        ${inv.paramUpdates.length ? `<div><h4>Ce qui a bougé dans le profil</h4>${mirrorHead('Avant', 'Après')}${inv.paramUpdates.map((u) => mirror(PARAM_LABELS[u.param], u.before, u.after)).join('')}</div>` : ''}
      </div>
      <div class="inv-report" id="invReport"></div>
    </div>
  </div>`;
  const report = root.querySelector('#invReport');
  const show = (key, animate = true) => {
    current = key;
    root.querySelectorAll('[data-agent]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.agent === key)));
    if (animate) UI.swap(report, agentReport(key, t)); else report.innerHTML = agentReport(key, t);
    report.scrollTop = 0;
    opts.onAgent?.(key);
  };
  root.querySelectorAll('[data-agent]').forEach((b) => (b.onclick = () => show(b.dataset.agent)));
  show(current, false);
}

/** Les agents au repos, quand il n'y a encore aucun ordre à enquêter. */
function agentsIdle(text) {
  return `<div class="agents-idle">${UI.agents(Object.keys(UI.AGENTS), { mode: 'working' })}
    <h2 class="display" style="font-size:22px">Vos agents sont prêts</h2><p class="small">${text}</p></div>`;
}
