// Page principale de Boréal Courtage : portefeuille, ticket d'ordre, historique, et service Miroir (facultatif).
//
// Parcours d'un ordre :
//   1. « Vérifier l'ordre »  -> POST /api/trades/preview : cotation + (si le compte est lié) règles Miroir à rappeler
//   2. fenêtre de confirmation : récapitulatif, et rappel de la règle que le client s'est fixée
//   3. « Confirmer »         -> POST /api/trades : exécution, puis enquête Miroir affichée sous le bandeau
//      « Annuler »           -> POST /api/trades/cancel : Miroir note que la règle a été respectée

let me = null;
let ticketTouchedAt = Date.now(); // début de la réflexion pour l'ordre en cours
let market = null; // { firstDate, lastDate, assets }

const PARAM_LABELS = {
  riskTolerance: 'Appétit pour le risque', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »',
  concentration: 'Concentration', impulsivity: 'Impulsivité', newsSensitivity: 'Sensibilité aux nouvelles',
};

// ------------------------------------------------------------------ Affichage du compte

async function refresh() {
  me = await api('GET', '/me');
  const [trades, miroir] = await Promise.all([
    api('GET', '/trades'),
    me.miroir.status === 'linked' ? api('GET', '/miroir/persona').then((r) => r.persona).catch(() => null) : null,
  ]);
  // La liaison a pu être révoquée côté Miroir pendant l'appel : on relit l'état.
  if (me.miroir.status === 'linked' && !miroir) me = await api('GET', '/me');

  const pf = me.portfolio;
  $('#hello').textContent = me.name;
  $('#total').textContent = money(pf.total);
  $('#cash').textContent = money(pf.cash);
  $('#gain').innerHTML = signed(pf.total - me.startingCash);
  $('#asOf').textContent = me.clock ? `Valorisé au cours de clôture du ${day(me.clock + 'T12:00:00')}, date de marché de votre dernier ordre.` : '';
  syncClock();

  $('#positions').innerHTML = pf.positions.length ? `<table>
    <tr><th>Actif</th><th class="right">Valeur</th><th class="right">Poids</th><th class="right">Gain ou perte</th><th></th></tr>
    ${pf.positions.map((p) => `<tr>
      <td><b>${esc(p.ticker)}</b></td><td class="right">${money(p.value)}</td>
      <td class="right">${(p.weight * 100).toFixed(0)} %</td><td class="right">${signed(p.gain)}</td>
      <td class="right"><button class="mini" data-sell="${esc(p.ticker)}" data-value="${p.value.toFixed(2)}">Vendre</button></td>
    </tr>`).join('')}</table>`
    : '<p class="empty">Aucune position. Passez un premier ordre avec le ticket.</p>';
  document.querySelectorAll('[data-sell]').forEach((b) => (b.onclick = () => {
    $('#sell').checked = true;
    $('#ticker').value = b.dataset.sell;
    $('#amount').value = b.dataset.value;
    touchTicket();
    $('#amount').focus();
  }));

  $('#history').innerHTML = trades.length ? `<table>
    <tr><th>Date de marché</th><th>Ordre</th><th class="right">Montant</th><th class="right">Cours</th><th>Miroir</th></tr>
    ${trades.map((t) => `<tr>
      <td>${esc(t.marketDate)}</td>
      <td><span class="badge ${t.side}">${t.side === 'buy' ? 'Achat' : 'Vente'}</span> <b>${esc(t.ticker)}</b></td>
      <td class="right">${money(t.amount)}</td><td class="right">${money(t.price, 2).replace(' $', '')} ${esc(t.currency)}</td>
      <td>${historyMiroir(t.miroir)}</td>
    </tr>`).join('')}</table>`
    : '<p class="empty">Aucun ordre pour l’instant.</p>';

  renderMiroir(miroir);
}

function historyMiroir(m) {
  if (m.status === 'analysed') {
    return `<span class="badge miroir">dérive ${m.driftBefore} → ${m.driftAfter}</span>`
      + (m.overrodeRules ? ' <span class="badge warn">règle outrepassée</span>' : '');
  }
  return m.status === 'unavailable' ? '<span class="badge grey">non analysé</span>' : '<span class="muted">—</span>';
}

/** Le service Miroir selon l'état du compte : offre, activation en attente, lié, ou désactivé. */
function renderMiroir(persona) {
  const { status, urls } = me.miroir;
  let notice = '';
  let panel = '';

  if (status === 'none') {
    notice = `<div class="panel miroir">
      <h2>Ajouter Miroir à votre compte ?</h2>
      <p>Miroir est un service indépendant qui compare ce que vous dites de vous comme investisseur à ce que vous faites vraiment.
        Vous y créez un compte, répondez à quelques questions et à cinq mises en situation, puis vous fixez vos propres règles.
        Ensuite, avant chaque ordre qui touche une de vos règles, nous vous la rappelons.</p>
      <p class="small muted">Si vous l’activez, nous envoyons à Miroir vos ordres et la composition de votre portefeuille.
        Sans Miroir, votre compte fonctionne normalement. Vous pourrez l’ajouter ou le retirer à tout moment.</p>
      <div class="actions"><button class="miroir" data-miroir="start">Activer Miroir</button>
        <button data-miroir="decline">Non merci</button></div>
    </div>`;
  } else if (status === 'pending') {
    notice = `<div class="panel miroir">
      <h2>Activation de Miroir en attente</h2>
      <p>Terminez la création de votre profil chez Miroir : vous serez ramené ici automatiquement.</p>
      <div class="actions"><button class="miroir" data-miroir="start">Continuer chez Miroir</button>
        <button data-miroir="decline">Annuler l’activation</button></div>
    </div>`;
  } else if (status === 'linked' && persona?.status === 'reevaluation_required') {
    notice = `<div class="panel alert">
      <h2>Miroir demande une réévaluation de votre profil</h2>
      <p>Votre comportement récent s’est trop éloigné de votre profil (score de dérive ${persona.drift.score} sur 100).
        Vos ordres sont suspendus jusqu’à la réévaluation. Vous pouvez aussi retirer Miroir de votre compte.</p>
      <div class="actions"><a class="button" href="${esc(urls.reevaluate)}">Refaire l’évaluation chez Miroir</a></div>
    </div>`;
  }

  if (status === 'linked') {
    panel = `<div class="panel miroir"><h2>Service Miroir</h2>${persona ? `
      <p style="margin:0"><b class="num" style="font-size:22px">${persona.drift.score}</b> <span class="muted">sur 100, score de dérive</span></p>
      <div class="meter"><i class="${persona.drift.score >= persona.drift.threshold ? 'high' : ''}" style="width:${persona.drift.score}%"></i>
        <b style="left:${persona.drift.threshold}%"></b></div>
      <p class="small muted">À ${persona.drift.threshold}, Miroir demande une réévaluation.</p>
      <details><summary>Vos ${persona.rules.length} règle(s)</summary>
        <ul>${persona.rules.map((r) => `<li>${esc(r.text)}</li>`).join('') || '<li>Aucune règle définie.</li>'}</ul></details>`
      : '<p class="small muted">Miroir ne répond pas pour le moment. Vos ordres passent normalement ; ils ne seront pas analysés.</p>'}
      <div class="actions"><a href="${esc(urls.profile)}" target="_blank" rel="noopener">Ouvrir mon profil Miroir</a>
        <button class="link" data-miroir="unlink" style="margin-left:auto">Retirer Miroir</button></div></div>`;
  } else if (status === 'declined') {
    panel = `<div class="panel"><h2>Service Miroir</h2>
      <p class="small muted">Miroir n’est pas activé sur ce compte : vos ordres ne quittent pas la plateforme et sont simplement conservés dans votre historique.</p>
      <button data-miroir="start">Activer Miroir</button></div>`;
  }
  $('#notices').innerHTML = notice;
  $('#miroirPanel').innerHTML = panel;
  $('#orderButton').disabled = status === 'linked' && persona?.status === 'reevaluation_required';

  document.querySelectorAll('[data-miroir]').forEach((b) => (b.onclick = async () => {
    const action = b.dataset.miroir;
    if (action === 'unlink' && !confirm('Retirer Miroir de votre compte ? Vos ordres ne seront plus analysés. Vous pourrez le réactiver plus tard.')) return;
    b.disabled = true;
    try {
      if (action === 'start') return (location.href = (await api('POST', '/miroir/link/start')).redirectUrl);
      await api('POST', action === 'decline' ? '/miroir/decline' : '/miroir/unlink');
      if (action === 'unlink') toast('Miroir a été retiré de votre compte.');
    } catch (err) { toast(err.message); }
    await refresh().catch(() => {});
  }));
}

// ------------------------------------------------------------------ Ticket d'ordre

/** La date du ticket ne peut pas être antérieure au dernier ordre (horloge de marché simulée). */
function syncClock() {
  if (!market) return;
  const min = me.clock ?? market.firstDate;
  $('#date').min = min;
  $('#date').max = market.lastDate;
  if (!$('#date').value || $('#date').value < min) $('#date').value = min;
}

const ticket = () => ({
  ticker: $('#ticker').value, side: $('#sell').checked ? 'sell' : 'buy', amount: Number($('#amount').value),
  marketDate: $('#date').value, note: $('#note').value,
});

function touchTicket() {
  ticketTouchedAt = Date.now();
  $('#ticketError').textContent = '';
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
    $('#quote').innerHTML = `<b>${esc(q.name)}</b> : ${q.price.toFixed(2)} ${esc(q.currency)} à la clôture du ${esc(q.date)}<br>
      <span class="muted">${pct(q.ret1d)} sur la séance, ${pct(q.ret30d)} sur 30 séances</span>`;
  } catch (err) {
    if (call === quoteCall) $('#quote').textContent = err.message;
  }
}

function closeModal() { $('#modal').classList.add('hidden'); }

/**
 * Fenêtre de confirmation. Avec un compte lié, c'est ici que la règle que le client s'est fixée lui est rappelée.
 * Résout à true (confirmer) ou false (annuler).
 */
function confirmOrder(t, preview) {
  const m = preview.miroir;
  const rules = m.status === 'ok' ? m.triggeredRules : [];
  const warnings = m.status === 'ok' ? m.warnings : [];
  return new Promise((resolve) => {
    $('#modalBody').innerHTML = `
      <h2>Confirmer l’ordre</h2>
      <dl class="recap">
        <dt>Ordre</dt><dd>${t.side === 'buy' ? 'Achat' : 'Vente'} de ${esc(t.ticker)}</dd>
        <dt>Montant</dt><dd>${money(t.amount, 2)}</dd>
        <dt>Cours</dt><dd>${preview.quote.price.toFixed(2)} ${esc(preview.quote.currency)} (clôture du ${esc(preview.quote.date)})</dd>
        <dt>Quantité</dt><dd>${(t.amount / preview.quote.price).toLocaleString('fr-CA', { maximumFractionDigits: 4 })}</dd>
      </dl>
      ${rules.length ? `<h3 style="color:var(--miroir)">Rappel de Miroir : ${rules.length > 1 ? 'des règles que vous vous êtes fixées' : 'une règle que vous vous êtes fixée'}</h3>` : ''}
      ${rules.map((r) => `<div class="rule"><span class="badge miroir">${esc(PARAM_LABELS[r.param] ?? r.param)}</span>
        <p><b>« ${esc(r.text)} »</b></p><p class="small muted">${esc(r.reason)}</p></div>`).join('')}
      ${warnings.map((w) => `<div class="notice">${esc(w)}</div>`).join('')}
      ${m.status === 'unavailable' ? '<p class="small muted">Miroir ne répond pas : cet ordre ne sera pas vérifié contre vos règles.</p>' : ''}
      <div class="actions">
        <button id="cancelOrder">${rules.length ? 'Renoncer à cet ordre' : 'Annuler'}</button>
        <button class="${rules.length ? 'danger' : 'primary'}" id="confirmOrder">${rules.length ? 'Passer outre et confirmer' : 'Confirmer l’ordre'}</button>
      </div>`;
    $('#modal').classList.remove('hidden');
    $('#confirmOrder').focus();
    $('#cancelOrder').onclick = () => { closeModal(); resolve(false); };
    $('#confirmOrder').onclick = () => { closeModal(); resolve(true); };
  });
}

/** Ce que Miroir a conclu de l'ordre, résumé pour le client (l'enquête complète reste chez Miroir). */
function verdictHtml(out) {
  const t = out.trade;
  const head = `<h2>Ordre exécuté</h2>
    <p><b>${t.side === 'buy' ? 'Achat' : 'Vente'} de ${money(t.amount, 2)} de ${esc(t.ticker)}</b>
      à ${t.price.toFixed(2)} ${esc(t.currency)}, clôture du ${esc(t.marketDate)}.</p>`;
  if (t.miroir.status === 'not_linked') return head;
  if (t.miroir.status === 'unavailable' || !out.miroir) {
    return head + '<div class="notice">Miroir n’a pas répondu : cet ordre est exécuté mais n’a pas été analysé.</div>';
  }
  const inv = out.miroir.investigation;
  const d = out.miroir.drift;
  return head + `<div class="rule">
      <span class="badge miroir">Analyse de Miroir</span>
      <p><b>${esc(inv.explanation.summary)}</b></p>
      <div class="meter"><i class="${d.score >= d.threshold ? 'high' : ''}" style="width:${d.score}%"></i><b style="left:${d.threshold}%"></b></div>
      <p class="small muted">Score de dérive : ${d.before} avant cet ordre, ${d.score} après. Réévaluation demandée à ${d.threshold}.</p>
      ${inv.findings.length ? `<details><summary>Ce que Miroir a relevé</summary><ul>${inv.findings.map((f) =>
        `<li><b>${esc(PARAM_LABELS[f.param] ?? f.param)}</b> : ${esc(f.evidence)}</li>`).join('')}</ul></details>` : ''}
      <p class="small" style="margin-top:8px"><a href="${esc(me.miroir.urls.profile)}" target="_blank" rel="noopener">Voir l’enquête complète dans Miroir</a>
        (sources, hypothèses et limites).</p>
    </div>`;
}

$('#ticket').onsubmit = async (e) => {
  e.preventDefault();
  if ($('#orderButton').disabled) return; // double clic ou envoi déjà en cours
  $('#orderButton').disabled = true;
  $('#ticketError').textContent = '';
  const t = ticket();
  try {
    // 1. Vérification : cotation, liquidités, et règles Miroir à rappeler.
    const preview = await api('POST', '/trades/preview', { ...t, decisionTimeMs: Date.now() - ticketTouchedAt });
    if (preview.miroir.status === 'ok' && preview.miroir.reevaluationRequired) return; // refresh() affiche le bandeau
    // 2. Confirmation (avec rappel de la règle).
    const rules = preview.miroir.status === 'ok' ? preview.miroir.triggeredRules : [];
    if (!(await confirmOrder(t, preview))) {
      if (rules.length) {
        await api('POST', '/trades/cancel', { ...t, decisionTimeMs: Date.now() - ticketTouchedAt }).catch(() => {});
        toast('Ordre abandonné. Miroir a noté que vous avez respecté votre règle.');
      }
      return;
    }
    // 3. Exécution, puis enquête Miroir.
    $('#orderButton').textContent = me.miroir.status === 'linked' ? 'Exécution et analyse Miroir…' : 'Exécution…';
    const out = await api('POST', '/trades', {
      ...t, decisionTimeMs: Date.now() - ticketTouchedAt, acknowledgedRuleIds: rules.map((r) => r.ruleId),
    });
    $('#resultPanel').classList.remove('hidden');
    $('#resultPanel').innerHTML = verdictHtml(out);
    $('#resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#note').value = '';
  } catch (err) {
    $('#ticketError').textContent = err.message;
  } finally {
    $('#orderButton').textContent = 'Vérifier l’ordre';
    $('#orderButton').disabled = false; // refresh() le verrouille de nouveau si une réévaluation est requise
    ticketTouchedAt = Date.now();
    await refresh().catch((err) => { $('#ticketError').textContent ||= err.message; });
  }
};

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) $('#cancelOrder')?.click(); });

// ------------------------------------------------------------------ Démarrage

(async () => {
  if (!session.token) return (location.href = '/');

  // Retour de Miroir après la création du profil : ?code=…&state=… -> on termine la liaison côté serveur.
  const query = new URLSearchParams(location.search);
  if (query.get('code')) {
    history.replaceState(null, '', '/app.html'); // le code ne reste pas dans la barre d'adresse ni dans l'historique
    try {
      await api('POST', '/miroir/link/complete', { code: query.get('code'), state: query.get('state') });
      toast('Miroir est activé : vos règles vous seront rappelées avant chaque ordre concerné.');
    } catch (err) { toast('Liaison avec Miroir impossible : ' + err.message); }
  }

  const [account, assets] = await Promise.allSettled([refresh(), api('GET', '/market/assets')]);
  if (assets.status === 'fulfilled') {
    market = assets.value;
    $('#ticker').innerHTML = market.assets.map((a) => `<option value="${esc(a.ticker)}">${esc(a.ticker)} — ${esc(a.name)}</option>`).join('');
    if (me) syncClock();
    for (const id of ['#ticker', '#date', '#buy', '#sell']) $(id).onchange = touchTicket;
    $('#amount').oninput = () => { $('#ticketError').textContent = ''; };
    showQuote();
  }
  const failure = [account, assets].find((r) => r.status === 'rejected');
  if (failure) $('#ticketError').textContent = failure.reason.message;
})();
