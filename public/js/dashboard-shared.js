// Affichage d'une enquête de trade, partagé par le tableau de bord et la vue admin.

/** Détail d'une enquête : résumé, étapes des agents, sources, hypothèses, limites. */
function investigationHtml(inv) {
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  return `<div class="explain">
    <p><b>${esc(inv.explanation.summary)}</b></p>
    ${inv.warnings.map((w) => `<div class="notice">${esc(w)}</div>`).join('')}
    ${inv.paramUpdates.map((u) => paramBar(PARAM_LABELS[u.param], u.after, u.before, `${u.before} → ${u.after}`)).join('')}
    <h3>Étapes de l’enquête</h3>
    <ul>${inv.explanation.steps.map((s) => `<li><b>${esc(s.agent)}</b> — ${esc(s.result)}</li>`).join('')}</ul>
    <h3>Sources</h3>${list(inv.explanation.sources)}
    <h3>Hypothèses</h3>${list(inv.explanation.hypotheses)}
    <h3>Limites</h3>${list(inv.explanation.limits)}
  </div>`;
}

