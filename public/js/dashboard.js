// Tableau de bord personnel : profil, dérive, règles, et simulation de trades.

let me = null;
let formTouchedAt = Date.now(); // début de la réflexion pour le trade en cours

async function refresh() {
  me = await api('GET', '/me');
  if (me.role === 'admin' || !me.profile) return route(me);
  const [portfolio, trades] = await Promise.all([api('GET', '/portfolio'), api('GET', '/trades')]);
  const blocked = me.status === 'reevaluation_required';

  $('#hello').textContent = `Bonjour ${me.name}`;
  $('#banner').classList.toggle('hidden', !blocked);
  $('#tradeButton').disabled = blocked;

  // Score de dérive
  $('#driftScore').textContent = me.drift.score;
  $('#driftNeedle').style.left = `calc(${me.drift.score}% - 2px)`;
  $('#driftLimit').style.left = me.driftThreshold + '%';
  $('#driftText').textContent = `Écart entre votre comportement actuel et votre dernière évaluation. À ${me.driftThreshold}, une réévaluation est demandée.`
    + (me.drift.overrides ? ` ${me.drift.overrides} règle(s) outrepassée(s).` : '');

  // Profil et règles
  const { current, baseline } = me.profile;
  $('#params').innerHTML = Object.keys(PARAM_LABELS).map((p) => paramBar(PARAM_LABELS[p], current[p], baseline[p])).join('');
  $('#rules').innerHTML = me.rules.length
    ? me.rules.map((r) => `<div class="rule"><span class="badge grey">${PARAM_LABELS[r.param]}</span>
        <p style="margin:6px 0 0">${esc(r.text.replace('{seuil}', r.threshold))}</p></div>`).join('')
    : '<p class="muted">Aucune règle définie.</p>';

  // Portefeuille
  $('#portfolio').innerHTML = `<table>
    <tr><th>Actif</th><th class="right">Valeur</th><th class="right">Poids</th></tr>
    ${portfolio.positions.map((p) => `<tr><td>${esc(p.ticker)}</td><td class="right">${money(p.value)}</td><td class="right">${(p.weight * 100).toFixed(0)} %</td></tr>`).join('')}
    <tr><td>Liquidités</td><td class="right">${money(portfolio.cash)}</td><td class="right">${((portfolio.cash / portfolio.total) * 100).toFixed(0)} %</td></tr>
    <tr><td><b>Total</b></td><td class="right"><b>${money(portfolio.total)}</b></td><td></td></tr>
  </table><p class="small muted" style="margin:8px 0 0">Valorisé au ${portfolio.date} (date de marché de votre dernier trade).</p>`;

  // Historique
  $('#history').innerHTML = trades.length ? trades.map((t) => `
    <details>
      <summary>
        <span class="badge ${t.side === 'buy' ? '' : 'grey'}">${t.side === 'buy' ? 'Achat' : 'Vente'}</span>
        <span class="grow"><b>${esc(t.ticker)}</b> · ${money(t.amount)} <span class="muted small">· marché du ${t.marketDate}</span></span>
        ${t.overrodeRules ? '<span class="badge danger">règle outrepassée</span>' : ''}
        <span class="muted small">dérive ${t.investigation.driftBefore} → ${t.investigation.driftAfter}</span>
      </summary>
      ${investigationHtml(t.investigation)}
    </details>`).join('') : '<p class="muted">Aucun trade pour l’instant.</p>';
}

/** Affiche le contexte de marché de l'actif choisi (faits tirés des prix). */
async function showContext() {
  try {
    const c = await api('GET', `/market/context?ticker=${encodeURIComponent($('#ticker').value)}&date=${$('#date').value}`);
    $('#context').innerHTML = `${esc(c.name)} · ${c.price.toFixed(2)} ${c.currency} au ${c.date} · 30 séances : ${pct(c.ret30d)} · volatilité : ${(c.vol30d * 100).toFixed(0)} %/an`;
  } catch (err) { $('#context').textContent = err.message; }
}

/** Fenêtre de rappel : la règle que l'utilisateur s'est fixée, avant de le laisser poursuivre. */
function confirmRules(check) {
  return new Promise((resolve) => {
    $('#modalBody').innerHTML = `
      <h2>Avant de poursuivre</h2>
      ${check.triggeredRules.length ? `<p>Ce trade touche ${check.triggeredRules.length > 1 ? 'des règles' : 'une règle'} que <b>vous vous êtes fixée${check.triggeredRules.length > 1 ? 's' : ''}</b> :</p>` : ''}
      ${check.triggeredRules.map((r) => `<div class="rule risk"><span class="badge warn">${PARAM_LABELS[r.param]}</span>
        <p style="margin:6px 0 2px"><b>« ${esc(r.text)} »</b></p><p class="small muted" style="margin:0">${esc(r.reason)}</p></div>`).join('')}
      ${check.warnings.map((w) => `<div class="notice">${esc(w)}</div>`).join('')}
      <div class="actions">
        <button id="cancel">Annuler le trade</button>
        <button class="danger" id="proceed">Poursuivre quand même</button>
      </div>`;
    $('#modal').classList.remove('hidden');
    const close = (answer) => { $('#modal').classList.add('hidden'); resolve(answer); };
    $('#cancel').onclick = () => close(false);
    $('#proceed').onclick = () => close(true);
  });
}

$('#tradeForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#tradeError').textContent = '';
  const request = {
    ticker: $('#ticker').value, side: $('#side').value, amount: Number($('#amount').value),
    marketDate: $('#date').value, note: $('#note').value,
  };
  try {
    // 1. Pré-contrôle : rappel des règles concernées.
    const check = await api('POST', '/trades/check', request);
    if (check.triggeredRules.length || check.warnings.length) {
      if (!(await confirmRules(check))) { formTouchedAt = Date.now(); return; }
    }
    // 2. Envoi du trade : le backend exécute, enquête, met à jour le profil et la dérive.
    $('#tradeButton').disabled = true;
    $('#tradeButton').textContent = 'Enquête en cours…';
    const out = await api('POST', '/trades', {
      ...request, decisionTimeMs: Date.now() - formTouchedAt,
      acknowledgedRuleIds: check.triggeredRules.map((r) => r.ruleId),
    });
    $('#resultCard').classList.remove('hidden');
    $('#result').innerHTML = investigationHtml(out.trade.investigation);
    $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#note').value = '';
  } catch (err) {
    $('#tradeError').textContent = err.message;
  } finally {
    $('#tradeButton').textContent = 'Envoyer le trade';
    formTouchedAt = Date.now();
    await refresh();
  }
};

(async () => {
  if (!session.token) return (location.href = '/');
  await refresh();
  const { assets, lastDate } = await api('GET', '/market/assets');
  $('#ticker').innerHTML = assets.map((a) => `<option value="${esc(a.ticker)}">${esc(a.ticker)} — ${esc(a.name)}</option>`).join('');
  $('#date').max = lastDate; $('#date').value = lastDate;
  $('#ticker').onchange = $('#date').onchange = () => { formTouchedAt = Date.now(); showContext(); };
  showContext();
})();
