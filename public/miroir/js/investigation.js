// Suivi des ordres enquêtés, partagé par la page de profil et la vue admin.
// Liste compacte (une ligne par ordre) ; le détail de l'enquête s'ouvre dans un tiroir à onglets.

const VERDICTS = {
  influence_externe: ['Influence externe possible', 'news'], changement_de_comportement: ['Changement de comportement', 'activity'],
  les_deux: ['Influence externe et changement de comportement', 'alert'], conforme: ['Rien de particulier', 'check'], indetermine: ['Impossible de conclure', 'info'],
};

/** Une ligne d'ordre : sens, actif, montant, variation de dérive. */
function tradeRow(t) {
  const inv = t.investigation;
  const d = inv.driftAfter - inv.driftBefore;
  return `<div class="list-item clickable trade-row" data-trade-id="${esc(t.id)}" tabindex="0">
    <div class="side-icon ${t.side}">${UI.icon(t.side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>
    <div class="grow"><div class="title">${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(t.ticker)} <span class="faint" style="font-weight:400">${money(t.amount)}</span></div>
      <div class="sub">${esc(day(t.marketDate + 'T12:00:00'))}${inv.influence ? ` · ${esc(VERDICTS[inv.influence.verdict]?.[0] ?? '')}` : ''}</div></div>
    ${t.overrodeRules ? `<span class="pill red" title="Règle outrepassée">${UI.icon('alert', 'sm')}</span>` : ''}
    <div class="end"><span class="pill ${d > 0 ? (inv.driftAfter >= 60 ? 'red' : 'amber') : d < 0 ? 'gain' : 'outline'} drift-chip">${inv.driftBefore} → ${inv.driftAfter}</span></div>
  </div>`;
}

/** Liste + ouverture du tiroir au clic. `meta(t)` ajoute des faits propres à l'admin. */
function bindTradeRows(root, trades, meta) {
  root.querySelectorAll('[data-trade-id]').forEach((row) => {
    const open = () => openInvestigation(trades.find((t) => t.id === row.dataset.tradeId), meta);
    row.onclick = open;
    row.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}

/** Courbe de dérive, un point par ordre (chronologique). */
function driftTimeline(canvas, trades, threshold) {
  const chrono = [...trades].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!chrono.length) return;
  UI.driftLine(canvas, ['Départ', ...chrono.map((t) => t.ticker)],
    [chrono[0].investigation.driftBefore, ...chrono.map((t) => t.investigation.driftAfter)], threshold,
    [false, ...chrono.map((t) => t.overrodeRules)]);
}

function openInvestigation(t, meta) {
  if (!t) return;
  const inv = t.investigation;
  const list = (items) => items?.length ? `<ul class="plain-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="small faint">—</p>';
  const [vLabel, vIcon] = VERDICTS[inv.influence?.verdict] ?? [];
  const tabs = {
    resume: `
      <p class="inv-summary">${esc(inv.explanation.summary)}</p>
      ${t.note ? `<p class="note-quote" style="margin-top:16px">« ${esc(t.note)} »</p>` : ''}
      ${inv.triggeredRules.map((r) => `<div class="notice red" style="margin-top:14px">${UI.icon('shield', 'sm')}<span>Règle outrepassée : « ${esc(r.text)} »</span></div>`).join('')}
      ${inv.warnings.map((w) => `<div class="notice" style="margin-top:10px">${UI.icon('alert', 'sm')}<span>${esc(w)}</span></div>`).join('')}
      ${inv.influence ? `<div class="inv-block" style="margin-top:22px"><h4>Comportement ou influence ?</h4>
        <div class="verdict"><div class="avatar ink">${UI.icon(vIcon)}</div><div><b>${esc(vLabel)}</b> <span class="pill outline" style="margin-left:4px">IA</span>
        <p class="small muted" style="margin-top:4px">${esc(inv.influence.rationale)}</p></div></div></div>` : ''}
      ${inv.paramUpdates.length ? `<div class="inv-block"><h4>Paramètres déplacés</h4>${mirrorHead('Avant', 'Après')}
        ${inv.paramUpdates.map((u) => mirror(PARAM_LABELS[u.param], u.before, u.after)).join('')}</div>` : ''}`,
    news: inv.news.length ? inv.news.map((n) => `<div class="news-item">
        <span class="pill ${n.simulated ? 'outline' : n.impact === 'élevé' ? 'red' : 'outline'}" style="flex:none">${n.simulated ? 'simulé' : esc(n.impact)}</span>
        <div>${n.simulated ? `<b class="small">${esc(n.title)}</b>` : `<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>`}
          <div class="tiny faint" style="margin-top:2px">${esc(n.source ?? '')}${n.date ? ' · ' + esc(n.date) : ''}</div>
          ${n.summary ? `<p class="small muted" style="margin-top:6px">${esc(n.summary)}</p>` : ''}</div></div>`).join('')
      : `<div class="empty-state">${UI.icon('news')}<p>Aucune nouvelle dans les 7 jours précédant l’ordre.</p></div>`,
    methode: `
      <div class="inv-block"><h4>Étapes de l’enquête</h4><ul class="timeline">${inv.explanation.steps.map((s) => `<li><b>${esc(s.agent)}</b><div class="small muted">${esc(s.result)}</div></li>`).join('')}</ul></div>
      <div class="inv-block"><h4>Sources</h4>${list(inv.explanation.sources)}</div>
      <div class="inv-block"><h4>Hypothèses</h4>${list(inv.explanation.hypotheses)}</div>
      <div class="inv-block"><h4>Limites</h4>${list(inv.explanation.limits)}</div>`,
  };
  const d = UI.drawer(`<div class="side-icon ${t.side}">${UI.icon(t.side === 'buy' ? 'arrowDown' : 'arrowUp', 'sm')}</div>
      <div><div class="eyebrow">${t.side === 'buy' ? 'Achat' : 'Vente'} · ${esc(day(t.marketDate + 'T12:00:00'))}</div><h2>${esc(t.ticker)} · ${money(t.amount)}</h2></div>`,
  `<div class="grid g-3" style="gap:10px;margin-bottom:22px">
      <div class="widget tint" style="padding:14px"><div class="tiny faint">Dérive</div><div class="kpi" style="font-size:22px">${inv.driftBefore} → <span class="${inv.driftAfter > inv.driftBefore ? 'loss' : ''}">${inv.driftAfter}</span></div></div>
      <div class="widget tint" style="padding:14px"><div class="tiny faint">Décision</div><div class="kpi" style="font-size:22px">${Math.round(t.decisionTimeMs / 1000)} s</div></div>
      <div class="widget tint" style="padding:14px"><div class="tiny faint">Nouvelles</div><div class="kpi" style="font-size:22px">${inv.news.length}</div></div>
    </div>
    ${meta ? `<p class="tiny faint" style="margin:-10px 0 18px">${meta(t)}</p>` : ''}
    <div class="tabs" role="tablist">
      <button role="tab" data-t="resume" aria-selected="true">Résumé</button>
      <button role="tab" data-t="news" aria-selected="false">Nouvelles</button>
      <button role="tab" data-t="methode" aria-selected="false">Méthode</button>
    </div>
    <div id="invTab">${tabs.resume}</div>`);
  d.el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
    d.el.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    UI.swap(d.el.querySelector('#invTab'), tabs[b.dataset.t]);
  }));
}
