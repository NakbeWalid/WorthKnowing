import { useEffect, useState } from "react";
import { api, money, num, Tag } from "./lib";

/* Console de test de l'hôte : outil de développement qui joue le rôle de la plateforme de trading.
   Elle n'exécute rien et ne tient aucun compte. Elle appelle l'API d'intégration (/v1). */
export function HostConsole({ uid, user }: { uid: string | null; user: any }) {
  const [f, setF] = useState<any>({ user_id: uid ?? "", side: "buy", symbol: "NVDA", amount: 9000, amount_currency: "CAD",
    portfolio_value: 60000, position_weight_after_pct: 15, executed_at: "2026-11-10T14:30:00-05:00" });
  const [check, setCheck] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [hooks, setHooks] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { if (uid) setF((x: any) => ({ ...x, user_id: uid })); }, [uid]);
  useEffect(() => {
    if (!f.user_id) return;
    const load = () => api(`/api/users/${f.user_id}/webhooks`).then(setHooks).catch(() => {});
    load(); const id = setInterval(load, 3000); return () => clearInterval(id);
  }, [f.user_id]);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const body = () => ({ ...f, amount: +f.amount, portfolio_value: f.portfolio_value === "" ? undefined : +f.portfolio_value,
    position_weight_after_pct: f.position_weight_after_pct === "" ? undefined : +f.position_weight_after_pct });
  const doCheck = () => { setErr(""); api("/v1/trade-intents:check", { ...body(), at: f.executed_at }).then(setCheck).catch((e) => setErr(e.message)); };
  const send = async () => {
    setErr(""); setResult(null);
    try {
      const event_id = "evt-" + Math.random().toString(16).slice(2, 10);
      await api("/v1/trade-events", { ...body(), event_id, guard_decision_id: check?.guard_decision_id });
      for (let i = 0; i < 20; i++) {
        const r = await api(`/v1/trade-events/${event_id}`);
        if (r.status === "processed") { setResult(r); return; }
        await new Promise((ok) => setTimeout(ok, 400));
      }
      setErr("L'analyse prend plus de temps que prévu.");
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <div className="stack">
        <h1>Console de l'hôte.</h1>
        <p className="lede">Cette page joue le rôle de la plateforme de trading qui appelle AlphaForge Mirror. Elle n'exécute aucune transaction et ne tient aucun compte. <Tag kind="Fictif" /></p>
        {user && <p className="muted">Profil lié : {user.declared.nom} ({uid}).</p>}
      </div>
      <section className="panel stack">
        <h3>Trade fictif à envoyer</h3>
        <div className="row">
          <label>Utilisateur (pseudonyme)<br /><input type="text" value={f.user_id} onChange={(e) => set("user_id", e.target.value)} /></label>
          <label>Sens<br /><select value={f.side} onChange={(e) => set("side", e.target.value)}><option value="buy">Achat</option><option value="sell">Vente</option></select></label>
          <label>Actif<br /><input type="text" value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} style={{ width: 110 }} /></label>
          <label>Montant (CAD)<br /><input type="number" value={f.amount} onChange={(e) => set("amount", e.target.value)} style={{ width: 120 }} /></label>
        </div>
        <div className="row">
          <label>Valeur du portefeuille (facultatif)<br /><input type="number" value={f.portfolio_value} onChange={(e) => set("portfolio_value", e.target.value)} style={{ width: 140 }} /></label>
          <label>Poids de la position après le trade, en % (facultatif)<br /><input type="number" value={f.position_weight_after_pct} onChange={(e) => set("position_weight_after_pct", e.target.value)} style={{ width: 120 }} /></label>
          <label>Moment du trade<br /><input type="text" value={f.executed_at} onChange={(e) => set("executed_at", e.target.value)} style={{ width: 250 }} /></label>
        </div>
        <p className="small muted">Le contexte de marché est calculé à partir du jeu de données pour ses 31 actifs, jusqu'au 12 novembre 2026. Pour un autre actif ou une autre date, il est marqué « inconnu ».</p>
        <div className="row">
          <button className="btn" disabled={!f.user_id} onClick={doCheck}>Vérifier avant le trade</button>
          <button className="btn primary" disabled={!f.user_id} onClick={send}>Envoyer le trade</button>
          {err && <span className="err">{err}</span>}
        </div>
      </section>
      {check && (
        <section className="panel stack">
          <h3>Réponse à la vérification avant le trade</h3>
          {check.result === "no_match" ? <p>Aucune règle de l'utilisateur ne s'applique à cette situation.{check.vigilance && ` ${check.vigilance}`}</p>
            : <ReminderBody g={check} />}
          <p className="small"><a href={check.reminder_url}>Ouvrir la page de rappel hébergée</a></p>
        </section>
      )}
      {result && (
        <section className="panel stack">
          <h3>Résultat de l'analyse du trade</h3>
          <table><tbody>
            <tr><th>Cause probable</th><td>{result.investigation.verdict_fr}{result.investigation.verdict !== "INDETERMINE" && ` (confiance ${Math.round(result.investigation.confidence * 100)} %)`}</td></tr>
            <tr><th>Règle non respectée</th><td>{result.rule_ignored ? "oui" : "non"}</td></tr>
            <tr><th>Sévérité</th><td>{Math.round(result.severity * 100)} sur 100</td></tr>
            <tr><th>Indice de dérive</th><td>{num(result.drift_index)} (seuil personnel {num(result.reevaluation_threshold)}) · {result.drift_status}</td></tr>
            <tr><th>Version du profil</th><td>{result.profile_version}</td></tr>
            <tr><th>Contexte complet</th><td>{result.context_incomplete ? "non, des données sont inconnues" : "oui"}</td></tr>
          </tbody></table>
          {result.reevaluation_url && <p><a href={result.reevaluation_url}>Réévaluation demandée : ouvrir la page de l'utilisateur</a></p>}
        </section>
      )}
      <section className="panel stack">
        <h3>Notifications reçues par l'hôte</h3>
        {hooks.length === 0 && <p className="muted">Aucune notification pour l'instant.</p>}
        {hooks.length > 0 && (
          <table><thead><tr><th>Événement</th><th>Contenu</th><th>Signature</th></tr></thead>
            <tbody>{hooks.map((h) => (
              <tr key={h.id}><td><b>{h.event}</b><br /><span className="small muted">{h.status}</span></td>
                <td className="small">{Object.entries(h.body.data).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(", ") : v}`).join(" · ")}</td>
                <td className="small muted">{h.signature.slice(0, 22)}…</td></tr>))}</tbody></table>
        )}
      </section>
    </>
  );
}

function ReminderBody({ g }: { g: any }) {
  return (
    <div className="stack">
      {g.reminder.map((r: any) => (
        <div key={r.rule_id} className="stack" style={{ borderLeft: "4px solid var(--ink)", paddingLeft: 16 }}>
          <p><b>Ta règle : « {r.ta_regle} »</b></p>
          <p className="small muted">{r.statut === "applicable" ? (r.depasse_ta_regle ? "Ce trade dépasse ta règle." : "Ta règle s'applique à cette situation.")
            : r.statut === "approchante" ? `Situation proche de ta règle (similarité ${Math.round(r.similarite * 100)} %).`
              : `Impossible de vérifier : données inconnues (${r.donnees_inconnues.join(", ")}).`} Rigueur {r.niveau_de_rigueur}.</p>
          {r.situation_d_origine && <p className="small"><b>Quand tu l'as écrite :</b> {r.situation_d_origine}</p>}
          {r.version_compatible?.montant != null && <p><b>Version compatible avec ta règle :</b> {money(r.version_compatible.montant)} ({r.version_compatible.explication}).</p>}
          {r.version_compatible?.attendre_heures != null && <p><b>Version compatible avec ta règle :</b> attendre {r.version_compatible.attendre_heures} heures ({r.version_compatible.explication}).</p>}
        </div>
      ))}
      <p className="small muted">{g.note}</p>
    </div>
  );
}

export function Reminder({ uid, gid }: { uid: string; gid: string }) {
  const [g, setG] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/api/users/${uid}/reminders/${gid}`).then(setG).catch((e) => setErr(e.message)); }, [uid, gid]);
  if (err) return <p className="err">{err}</p>;
  if (!g) return <p>Chargement…</p>;
  return (
    <>
      <div className="stack">
        <h1>Avant ce trade, souviens-toi de ta règle.</h1>
        <p className="lede">{g.intent.side === "buy" ? "Achat" : "Vente"} de {g.intent.symbol} pour {money(g.intent.amount)}.</p>
      </div>
      <section className="panel">
        {g.result === "no_match" ? <p>Aucune de tes règles ne s'applique à cette situation.{g.vigilance && ` ${g.vigilance}`}</p> : <ReminderBody g={g} />}
      </section>
      <p className="muted">Cette page informe seulement. La décision reste la tienne, sur ta plateforme.</p>
    </>
  );
}
