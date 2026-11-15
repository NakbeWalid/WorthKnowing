// Affichage d'une enquête de trade, partagé par la page de profil et la vue admin.

/** Détail d'une enquête : résumé, paramètres déplacés, nouvelles, étapes des agents, sources, hypothèses, limites. */
function investigationHtml(inv) {
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  return `<div class="explain">
    <p><b>${esc(inv.explanation.summary)}</b></p>
    ${inv.warnings.map((w) => `<div class="notice">${esc(w)}</div>`).join('')}
    ${inv.triggeredRules.map((r) => `<div class="notice">Règle outrepassée : « ${esc(r.text)} »</div>`).join('')}
    ${inv.paramUpdates.length ? mirrorHead('Avant cet ordre', 'Après') + inv.paramUpdates.map((u) => mirror(PARAM_LABELS[u.param], u.before, u.after)).join('') : ''}
    ${newsHtml(inv.news)}
    ${influenceHtml(inv.influence)}
    <h3>Étapes de l’enquête</h3>
    <ul>${inv.explanation.steps.map((s) => `<li><b>${esc(s.agent)}</b> : ${esc(s.result)}</li>`).join('')}</ul>
    <h3>Sources</h3>${list(inv.explanation.sources)}
    <h3>Hypothèses</h3>${list(inv.explanation.hypotheses)}
    <h3>Limites</h3>${list(inv.explanation.limits)}
  </div>`;
}

/** Nouvelles avant le trade : vraies manchettes avec lien, ou signaux simulés clairement étiquetés. */
function newsHtml(news) {
  if (!news.length) return '<h3>Nouvelles</h3><p class="small muted">Aucune nouvelle trouvée dans les 7 jours précédant le trade.</p>';
  return `<h3>Nouvelles des 7 jours précédents</h3><ul>${news.map((n) => n.simulated
    ? `<li>${esc(n.title)} <span class="badge grey">simulé</span></li>`
    : `<li><span class="badge ${n.impact === 'élevé' ? 'warn' : 'grey'}">impact ${esc(n.impact)}</span>
        <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <span class="small muted">${esc(n.source)}, ${esc(n.date)}</span>
        ${n.summary ? `<br><span class="small muted">${esc(n.summary)} (reformulé par IA)</span>` : ''}</li>`).join('')}</ul>`;
}

const VERDICTS = {
  influence_externe: 'Influence externe possible', changement_de_comportement: 'Changement de comportement',
  les_deux: 'Influence externe et changement de comportement', conforme: 'Rien de particulier', indetermine: 'Impossible de conclure',
};

/** Réponse de l'agent d'influence (IA), avec les références vérifiées qu'il cite. */
function influenceHtml(inf) {
  if (!inf) return '';
  return `<h3>Changement de comportement ou influence externe ?</h3>
    <p><b>${esc(VERDICTS[inf.verdict])}</b> <span class="badge grey">IA</span><br>
    <span class="small muted">${esc(inf.rationale)} N = nouvelle, F = fait calculé ; références vérifiées par le code.</span></p>`;
}

/** Ligne repliable d'un trade enquêté (résumé visible, enquête au clic). */
function tradeRow(t, extra = '') {
  return `<details>
    <summary>
      <span class="badge ${t.side === 'buy' ? '' : 'grey'}">${t.side === 'buy' ? 'Achat' : 'Vente'}</span>
      <span class="grow"><b>${esc(t.ticker)}</b> ${money(t.amount)}
        <span class="muted small">marché du ${esc(t.marketDate)}${extra}</span></span>
      ${t.overrodeRules ? '<span class="badge danger">règle outrepassée</span>' : ''}
      <span class="muted small num">dérive ${t.investigation.driftBefore} → ${t.investigation.driftAfter}</span>
    </summary>
    ${t.note ? `<p class="quote">${esc(t.note)}</p>` : ''}
    ${investigationHtml(t.investigation)}
  </details>`;
}
