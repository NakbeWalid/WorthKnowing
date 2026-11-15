// Page de profil Miroir : dérive, profil, règles, enquêtes, et liaison avec la plateforme de courtage.
// Les ordres se passent chez le courtier ; ici on ne fait que consulter.

async function refresh() {
  const me = await api('GET', '/me');
  if (me.role === 'admin' || !me.profile) return route(me);
  const trades = await api('GET', '/trades');
  const p = pending.get();

  $('#hello').textContent = `Bonjour ${me.name}`;

  // Bandeau du haut : demande de liaison en attente, réévaluation exigée, ou retour au courtier.
  let top = '';
  if (p?.link) {
    top = `<div class="card partner">
      <h2>${esc(p.partner)} demande à lier votre profil Miroir</h2>
      <p>Si vous acceptez, ${esc(p.partner)} enverra à Miroir vos ordres et la composition de votre portefeuille,
        et recevra l’état de votre profil, votre score de dérive et le texte de vos règles. Rien d’autre.</p>
      <div class="actions"><button class="primary" id="allow">Autoriser et retourner à ${esc(p.partner)}</button>
        <button id="refuse">Refuser</button></div>
      <div class="error" id="linkError" role="alert"></div></div>`;
  } else if (me.status === 'reevaluation_required') {
    top = `<div class="banner"><div><b>Réévaluation requise.</b> Votre comportement s’est trop éloigné de votre profil de référence.
      Vos ordres sont suspendus chez votre courtier jusqu’à la réévaluation.</div>
      <button class="danger" onclick="location.href='/onboarding.html'">Refaire l’évaluation</button></div>`;
  } else if (p) {
    top = `<div class="card partner"><div class="row"><p style="margin:0">Votre profil est à jour.</p>
      <button class="primary" style="flex:none" id="goBack">Retourner à ${esc(p.partner)}</button></div></div>`;
  }
  $('#top').innerHTML = top;
  if ($('#allow')) {
    $('#allow').onclick = () => finishAndReturn().catch((err) => { $('#linkError').textContent = err.message; });
    $('#refuse').onclick = () => { pending.clear(); refresh(); };
  }
  if ($('#goBack')) $('#goBack').onclick = () => finishAndReturn();

  // Score de dérive
  $('#driftScore').textContent = me.drift.score;
  $('#driftNeedle').style.left = `calc(${me.drift.score}% - 2px)`;
  $('#driftLimit').style.left = me.driftThreshold + '%';
  $('#driftText').textContent = `Écart entre votre comportement récent et votre dernière évaluation. À ${me.driftThreshold}, une réévaluation est demandée.`
    + (me.drift.overrides ? ` Règles outrepassées depuis : ${me.drift.overrides}.` : '');

  // Liaison avec le courtier
  $('#link').innerHTML = me.link
    ? `<p><span class="badge ok">Lié</span> ${esc(me.link.partner)}, depuis le ${esc(day(me.link.linkedAt))}.</p>
       <p class="small muted">Vos ordres passés chez ${esc(me.link.partner)} sont analysés ici.</p>
       <button id="revoke">Retirer l’accès de ${esc(me.link.partner)}</button>`
    : `<p class="muted">Aucun compte de courtage lié. Pour que vos ordres soient analysés, activez Miroir depuis les réglages de votre plateforme de courtage.</p>`;
  if ($('#revoke')) $('#revoke').onclick = async () => {
    if (!confirm(`Retirer l’accès de ${me.link.partner} ? Vos ordres ne seront plus analysés.`)) return;
    await api('DELETE', '/link').catch((err) => alert(err.message));
    refresh();
  };

  // Profil : référence à gauche de l'axe, aujourd'hui à droite
  const { current, baseline } = me.profile;
  $('#params').innerHTML = mirrorHead('À la dernière évaluation', 'Aujourd’hui')
    + Object.keys(PARAM_LABELS).map((k) => mirror(PARAM_LABELS[k], baseline[k], current[k])).join('');
  $('#evaluated').textContent = `Dernière évaluation le ${day(me.profile.evaluatedAt)} (${me.profile.evaluationCount} au total).`;

  $('#rules').innerHTML = me.rules.length
    ? me.rules.map((r) => `<div class="rule"><span class="badge grey">${PARAM_LABELS[r.param]}</span>
        <p>${esc(r.text.replace('{seuil}', r.threshold))}</p></div>`).join('')
    : '<p class="empty">Aucune règle. Refaites une évaluation pour en définir.</p>';

  $('#history').innerHTML = trades.length
    ? trades.map((t) => tradeRow(t)).join('')
    : `<p class="empty">Aucun ordre analysé pour l’instant. ${me.link ? `Passez un ordre chez ${esc(me.link.partner)} : son enquête apparaîtra ici.` : ''}</p>`;
}

(async () => {
  if (!session.token) return (location.href = '/');
  refresh().catch((err) => { $('#top').innerHTML = `<div class="banner"><div>${esc(err.message)}</div><button onclick="location.reload()">Réessayer</button></div>`; });
})();
