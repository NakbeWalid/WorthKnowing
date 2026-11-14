import { useCallback, useEffect, useRef, useState } from "react";
import { api, EvidenceDrawer, Gauge, Legend, LineChart, money, num, pct, Sentence, signed, store, Tag } from "./lib";
import { HostConsole, Reminder } from "./Host";

const C = { toi: "#0A8F88", tenir: "#C2571A", profil: "#5B5FC7" };
const RISQUES: Record<string, string> = { faible: "Faible", faible_modere: "Faible à modéré", modere: "Modéré", eleve: "Élevé", tres_eleve: "Très élevé" };
const ITEMS: [string, string][] = [
  ["calme_baisses", "Je reste calme pendant les baisses"], ["resiste_modes", "Je résiste aux modes"],
  ["decide_vite", "Je prends mes décisions rapidement"], ["nouvelles_stables", "Les nouvelles me font rarement changer d'avis"],
  ["respecte_limites", "Je respecte mes limites de diversification"],
];
const ACTION: Record<string, string> = { hold: "Tenu", sell: "Vendu", add: "Renforcé" };

function useHash(): [string, (h: string) => void] {
  const [h, setH] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || "/");
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return [h, (x) => { location.hash = x; }];
}

export default function App() {
  const [route, go] = useHash();
  const [uid, setUid] = useState<string | null>(new URLSearchParams(location.search).get("user") || store.get("mirror.user"));
  const [user, setUser] = useState<any>(null);
  const [sid, setSid] = useState<string | null>(store.get("mirror.session"));
  const [ev, setEv] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!uid) { setUser(null); return; }
    api(`/api/users/${uid}`).then(setUser).catch(() => { setUid(null); store.set("mirror.user", null); });
  }, [uid]);
  useEffect(refresh, [refresh, route]);
  const adopt = (id: string) => { setUid(id); store.set("mirror.user", id); };
  const session = (id: string | null) => { setSid(id); store.set("mirror.session", id); };
  const reset = () => { store.set("mirror.user", null); session(null); setUid(null); go("/"); };
  const inSim = route.startsWith("/simulation");
  const page = route.split("/")[1] || "";
  const nav: [string, string][] = [["profil", "Profil"], ["revelation", "Révélation"], ["pacte", "Mes règles"], ["tableau", "Tableau de bord"], ["hote", "Console de l'hôte"]];
  return (
    <>
      <div className="band">
        <span><strong>Simulation.</strong> Aucune transaction réelle. Ceci n'est pas un conseil financier.</span>
        <span>Les prix et les taux sont réels. Les messages et les comptes liés sont fictifs.</span>
      </div>
      <header className="top">
        <button className="brand" onClick={() => !inSim && go(user?.has_profile ? "/profil" : "/")}>AlphaForge <span>Mirror</span></button>
        {user?.has_profile && !inSim && (
          <nav className="nav" aria-label="Sections">
            {nav.map(([k, l]) => <button key={k} aria-current={page === k ? "page" : undefined} onClick={() => go("/" + k)}>{l}</button>)}
            <button onClick={reset}>Nouveau profil</button>
          </nav>
        )}
      </header>
      <main>
        {route === "/" && <Home uid={uid} user={user} adopt={adopt} onStart={(v) => { session(v.session_id); go("/simulation"); }} go={go} />}
        {inSim && sid && <Simulation sid={sid} onDone={() => go("/revelation")} />}
        {page === "revelation" && user && <Reveal sid={sid ?? user.last_session} open={setEv} go={go} />}
        {page === "profil" && uid && <Profile uid={uid} open={setEv} go={go} />}
        {page === "pacte" && uid && <Pact uid={uid} open={setEv} go={go} />}
        {page === "tableau" && uid && <Dashboard uid={uid} open={setEv} go={go} />}
        {page === "reevaluation" && uid && <Reevaluation uid={uid} open={setEv} onStart={(v) => { session(v.session_id); go("/simulation"); }} />}
        {page === "hote" && <HostConsole uid={uid} user={user} />}
        {page === "rappel" && uid && <Reminder uid={uid} gid={route.split("/")[2]} />}
        {!uid && !["", "hote"].includes(page) && <p>Commence par <button className="link" onClick={() => go("/")}>choisir un profil</button>.</p>}
      </main>
      {ev && uid && <EvidenceDrawer uid={uid} id={ev} onOpen={setEv} onClose={() => setEv(null)} />}
    </>
  );
}

// ================================================================== accueil et profil déclaré
function Home({ uid, user, adopt, onStart, go }: { uid: string | null; user: any; adopt: (id: string) => void; onStart: (v: any) => void; go: (h: string) => void }) {
  const [personas, setPersonas] = useState<any[]>([]);
  const [pick, setPick] = useState<string>("amira");
  const [custom, setCustom] = useState<any>({ nom: "", risque: "modere", horizon_ans: 10, esg: false, crypto: false,
    auto_evaluation: Object.fromEntries(ITEMS.map(([k]) => [k, 3])) });
  const [mode, setMode] = useState("demo");
  const [sources, setSources] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/api/personas").then(setPersonas).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (uid && user && !user.has_profile) api(`/api/users/${uid}/sources`).then(setSources).catch(() => {}); }, [uid, user]);
  const p = personas.find((x) => x.id === pick);
  const create = async () => {
    setBusy(true); setErr("");
    try { adopt((await api("/api/users", pick === "custom" ? { custom } : { persona: pick })).user_id); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const toggle = async (platform: string, granted: boolean) => setSources(await api(`/api/users/${uid}/sources`, { platform, granted }, "PUT"));
  const start = async () => {
    setBusy(true); setErr("");
    try { onStart(await api("/api/sessions", { user_id: uid, mode })); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  if (user?.has_profile) {
    return (
      <div className="stack">
        <h1>Ton profil est prêt.</h1>
        <div className="row"><button className="btn primary" onClick={() => go("/profil")}>Voir mon profil</button></div>
      </div>
    );
  }
  if (uid && user) {
    return (
      <>
        <div className="stack">
          <h2>Avant de commencer, {user.declared.nom}</h2>
          <p className="lede">Tu vas traverser des situations de marché réelles, présentées sans nom ni date. À chaque arrêt, tu choisis de tenir, de vendre ou de renforcer. Rien n'est révélé avant la toute fin.</p>
        </div>
        <section className="panel stack">
          <h3>Comptes liés (facultatif)</h3>
          <p className="muted">Si tu y consens, le système s'en sert plus tard pour comprendre ce qui précède tes trades. Tu peux retirer ton accord à tout moment : les données dérivées sont alors supprimées. {sources?.note}</p>
          {sources?.plateformes.map((s: any) => (
            <label key={s.id} className="switch">
              <span><b style={{ textTransform: "capitalize" }}>{s.id}</b> <Tag kind="Fictif" /><br /><span className="muted">Lu : publications des comptes suivis et tes interactions publiques. Couverture : {s.couverture}. Conservation : {sources.conservation_jours} jours.</span></span>
              <input type="checkbox" checked={!!s.granted} onChange={(e) => toggle(s.id, e.target.checked)} aria-label={`Lier ${s.id}`} />
            </label>
          ))}
        </section>
        <section className="panel stack">
          <h3>Durée de la simulation</h3>
          <div className="row">
            <label><input type="radio" name="mode" checked={mode === "demo"} onChange={() => setMode("demo")} /> Courte : 4 situations, environ 4 minutes (profil préliminaire)</label>
            <label><input type="radio" name="mode" checked={mode === "complet"} onChange={() => setMode("complet")} /> Complète : 8 situations, environ 10 minutes</label>
          </div>
          <div className="row"><button className="btn primary" disabled={busy} onClick={start}>Commencer la simulation</button></div>
          {err && <p className="err">{err}</p>}
        </section>
      </>
    );
  }
  return (
    <>
      <div className="stack">
        <h1>L'investisseur que tu dis être, et celui que tu es.</h1>
        <p className="lede">Dis-nous comment tu te vois. Tu traverses ensuite de vraies situations de marché, masquées. À la fin, on compare les deux, preuves à l'appui, et tu écris tes propres règles.</p>
      </div>
      <section className="stack">
        <h3>Qui es-tu comme investisseur ?</h3>
        <div className="personas">
          {personas.map((x) => (
            <button key={x.id} className="persona" aria-pressed={pick === x.id} onClick={() => setPick(x.id)}>
              <b>{x.nom}, {x.age} ans</b>
              <span className="small">{x.resume}</span>
            </button>
          ))}
          <button className="persona" aria-pressed={pick === "custom"} onClick={() => setPick("custom")}>
            <b>Mon propre profil</b><span className="small">Je décris moi-même mon risque, mon horizon et mes préférences.</span>
          </button>
        </div>
      </section>
      <section className="panel split">
        {pick === "custom" ? (
          <div className="stack">
            <h3>Ton profil déclaré</h3>
            <label>Tolérance au risque<br />
              <select value={custom.risque} onChange={(e) => setCustom({ ...custom, risque: e.target.value })}>
                {Object.entries(RISQUES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label>Horizon de placement (années)<br />
              <input type="number" min={1} max={40} value={custom.horizon_ans} onChange={(e) => setCustom({ ...custom, horizon_ans: +e.target.value })} /></label>
            <label><input type="checkbox" checked={custom.esg} onChange={(e) => setCustom({ ...custom, esg: e.target.checked })} /> Les critères ESG comptent pour moi (j'évite le pétrole et le gaz)</label>
            <label><input type="checkbox" checked={custom.crypto} onChange={(e) => setCustom({ ...custom, crypto: e.target.checked })} /> Les cryptoactifs m'intéressent</label>
          </div>
        ) : p ? (
          <div className="stack">
            <h3>Profil déclaré de {p.nom}</h3>
            <table><tbody>
              <tr><th>Risque</th><td>{RISQUES[p.risque]}</td></tr>
              <tr><th>Horizon</th><td>{p.horizon_ans} ans</td></tr>
              <tr><th>Préférences</th><td>{[p.esg && "critères ESG", p.crypto && "cryptoactifs", !p.esg && !p.crypto && "entreprises établies"].filter(Boolean).join(", ")}</td></tr>
              <tr><th>Portefeuille fictif <Tag kind="Fictif" /></th><td>{Object.entries(p.allocation).map(([k, v]) => `${k} ${v} %`).join(" · ")}</td></tr>
            </tbody></table>
          </div>
        ) : <div />}
        <div className="stack">
          <h3>Comment tu te vois</h3>
          <p className="muted">De 1 (pas du tout moi) à 5 (tout à fait moi).</p>
          <div className="scale">
            {ITEMS.map(([k, label]) => {
              const v = pick === "custom" ? custom.auto_evaluation[k] : p?.auto_evaluation[k];
              return (
                <div key={k} style={{ display: "contents" }}>
                  <label htmlFor={k}>{label}</label>
                  <span className="row"><input id={k} type="range" min={1} max={5} value={v ?? 3} disabled={pick !== "custom"}
                    onChange={(e) => setCustom({ ...custom, auto_evaluation: { ...custom.auto_evaluation, [k]: +e.target.value } })} /><b>{v}</b></span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <div className="row">
        <button className="btn primary" disabled={busy || !personas.length} onClick={create}>Continuer avec ce profil</button>
        {err && <span className="err">{err}</span>}
      </div>
    </>
  );
}

// ================================================================== simulation
function Simulation({ sid, onDone }: { sid: string; onDone: () => void }) {
  const [v, setV] = useState<any>(null);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const t0 = useRef(0), hes = useRef(0), last = useRef(""), busy = useRef(false);
  const load = (x: any) => {
    setV(x); busy.current = false;
    if (x.status === "finished") { onDone(); return; }
    t0.current = performance.now(); hes.current = 0; last.current = "";
    setLeft(x.triggers?.find((t: any) => t.timer_seconds)?.timer_seconds ?? null);
  };
  useEffect(() => { api(`/api/sessions/${sid}`).then(load).catch((e) => setErr(e.message)); }, [sid]); // eslint-disable-line
  const decide = useCallback((action: string) => {
    if (busy.current) return;
    busy.current = true;
    api(`/api/sessions/${sid}/decisions`, { action, decision_time_ms: Math.round(performance.now() - t0.current), hesitations: hes.current })
      .then(load).catch((e) => { busy.current = false; setErr(e.message); });
  }, [sid]); // eslint-disable-line
  useEffect(() => {
    if (left == null) return;
    if (left <= 0) { decide("hold"); return; }
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [left, decide]);
  const hover = (a: string) => { if (last.current && last.current !== a) hes.current += 1; last.current = a; };
  if (err) return <p className="err">{err}</p>;
  if (!v) return <p>Chargement…</p>;
  if (v.status === "finished") return <p>Simulation terminée. Ouverture de la révélation…</p>;
  const prog = ((v.scenario_number - 1) / v.scenarios_total) * 100;
  if (v.status === "awaiting_recognition") {
    return (
      <section className="stack">
        <div className="progress"><i style={{ width: `${(v.scenario_number / v.scenarios_total) * 100}%` }} /></div>
        <h2>Avais-tu reconnu cet actif ou cette époque ?</h2>
        <p className="muted">{v.label}. Ta réponse sert seulement à pondérer la mesure. Rien n'est révélé maintenant.</p>
        <div className="row">
          {[["oui", "Oui"], ["peut-etre", "Peut-être"], ["non", "Non"]].map(([k, l]) => (
            <button key={k} className="btn" onClick={() => api(`/api/sessions/${sid}/recognition`, { answer: k }).then(load).catch((e) => setErr(e.message))}>{l}</button>
          ))}
        </div>
      </section>
    );
  }
  return (
    <>
      <div className="stack">
        <div className="sim-head">
          <h2>{v.label}</h2>
          <span className="muted">Situation {v.scenario_number} sur {v.scenarios_total} · Mois {v.month} sur {v.months_total}</span>
        </div>
        <div className="progress" aria-hidden="true"><i style={{ width: `${prog}%` }} /></div>
      </div>
      <dl className="figures">
        <div><dt>Ton portefeuille <Tag kind="Fictif" /></dt><dd>{money(v.portfolio_value)}</dd><span className={v.portfolio_pnl < 0 ? "neg small" : "pos small"}>{signed(v.portfolio_pnl)} depuis le début</span></div>
        <div><dt>Cette position <Tag kind="Réel" /></dt><dd className={v.position_pnl < 0 ? "neg" : "pos"}>{signed(v.position_pnl)}</dd><span className="small muted">{pct(v.position_ret_pct)} depuis le début · {num(v.position_weight_pct)} % du portefeuille</span></div>
        <div><dt>Sous son sommet <Tag kind="Réel" /></dt><dd>{pct(Math.abs(v.drawdown_pct), false)}</dd><span className="small muted">Liquidités : {money(v.cash)}</span></div>
      </dl>
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Évolution de l'actif, base 100 au départ</h3><Tag kind="Réel" />
        </div>
        <LineChart series={[{ name: "Actif (base 100)", color: "var(--ink)", values: v.chart }]} baseline={100}
          xLabel={(i) => (i === 0 ? "Début" : i === v.chart.length - 1 ? `Mois ${v.month}` : `Jour ${i}`)} />
        <p className="small muted">Contexte de l'époque ({v.macro.zone}) <Tag kind="Réel" /> : taux directeur {num(v.macro.taux_directeur)} % · taux à 10 ans {num(v.macro.taux_10_ans)} % · inflation au Canada sur un an {num(v.macro.inflation_canada)} % (dernière valeur publiée à ce moment).</p>
      </section>
      {v.triggers.map((t: any, i: number) => t.timer_seconds ? (
        <div key={i} className="row" role="timer" aria-live="polite"><span className="timer">{left ?? 0} s</span><span>pour décider. Sans réponse, la position est conservée.</span></div>
      ) : (
        <div key={i} className={`stimulus ${t.famille === "nouvelle" ? "nouvelle" : ""}`}>
          <span className="small muted">{t.forme === "message" ? "Message reçu" : t.forme === "publication" ? "Publication" : t.forme === "nouvelle" ? "Fil d'actualité" : "Notification"}</span>
          <span>{t.texte}</span>
        </div>
      ))}
      <div className="choices">
        {[["hold", "Tenir", "Ne rien changer"], ["sell", "Vendre", "Liquider cette position"], ["add", "Renforcer", "Ajouter 25 % depuis les liquidités"]].map(([a, l, s]) => (
          <button key={a} disabled={a === "add" && !v.can_add} onMouseEnter={() => hover(a)} onFocus={() => hover(a)} onClick={() => decide(a)}>{l}<small>{s}</small></button>
        ))}
      </div>
    </>
  );
}

// ================================================================== révélation
function Reveal({ sid, open, go }: { sid: string | null; open: (id: string) => void; go: (h: string) => void }) {
  const [r, setR] = useState<any>(null);
  const [i, setI] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => { if (sid) api(`/api/sessions/${sid}/reveal`).then(setR).catch((e) => setErr(e.message)); }, [sid]);
  if (err) return <p className="err">{err}</p>;
  if (!r) return <p>Chargement…</p>;
  const sc = r.scenarios[i], t = sc.trajectoires;
  const series = [{ name: "Ce que tu as fait", color: C.toi, values: t.toi }, { name: "Tenir jusqu'au bout", color: C.tenir, values: t.tenir },
    { name: "Suivre ton profil déclaré", color: C.profil, values: t.profil_declare }];
  return (
    <>
      <div className="stack">
        <span className="muted">Révélation {i + 1} sur {r.scenarios.length}</span>
        <h1 key={sc.scenario_id} className="unmask">{sc.label.split(",")[0]}, c'était {sc.name}.</h1>
        <p className="lede">{sc.ticker} · {sc.periode}</p>
      </div>
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>Ce qui s'est réellement passé</h3><Tag kind="Réel" /></div>
        <LineChart series={[{ name: sc.name, color: "var(--ink)", values: sc.chart }]} baseline={100}
          markers={sc.decision_points.map((d: any) => ({ x: d.x, label: ACTION[d.action] }))}
          xLabel={(k) => (k === 0 ? "Début" : k === sc.chart.length - 1 ? "Fin de la fenêtre" : `Jour ${k}`)} />
      </section>
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h3>Trois trajectoires pour une mise de {money(t.mise_de_depart)}</h3><Tag kind="Réel" /></div>
        <Legend series={series} />
        <LineChart series={series} format={money} xLabel={(k) => `Mois ${k}`} height={240} />
        <details><summary className="small">Voir les valeurs en tableau</summary>
          <table><thead><tr><th>Mois</th>{series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
            <tbody>{t.toi.map((_: number, k: number) => <tr key={k}><td>{k}</td>{series.map((s) => <td key={s.name} className="num">{money(s.values[k])}</td>)}</tr>)}</tbody></table>
        </details>
        <p className="small muted">« Suivre ton profil déclaré » applique une règle simple : vendre dès que la baisse sous le sommet atteint le seuil associé à ton risque déclaré. <Tag kind="Hypothèse" /></p>
      </section>
      <section className="panel">
        {sc.phrases.map((s: any, k: number) => <Sentence key={k} s={s} onOpen={open} />)}
      </section>
      {sc.declencheurs.length > 0 && (
        <section className="panel stack">
          <h3>Ce qu'on t'a montré pendant cette situation</h3>
          {sc.declencheurs.map((d: any, k: number) => (
            <div key={k} className={`stimulus ${d.fictif ? "" : "nouvelle"}`}>
              <span className="small muted">Mois {d.mois} · {d.nom} <Tag kind={d.fictif ? "Fictif" : "Réel"} /></span>
              <span>{d.texte}</span>
              <span className="small muted">{d.fictif ? "Ce message était simulé. Son auteur n'existe pas." : "Fait tiré des données réelles, mis en forme pour la simulation."}</span>
            </div>
          ))}
        </section>
      )}
      <details className="panel"><summary>Pourquoi cette situation ? Les étapes du système</summary>
        <div className="stack small" style={{ marginTop: 12 }}>
          <p><b>{sc.directeur.composant}</b> ({sc.directeur.source}) : {sc.directeur.raison}. {sc.directeur.candidats} épisodes réels possibles.</p>
          {Object.entries(sc.validation).flatMap(([m, logs]: any) => logs.map((l: any, k: number) => (
            <p key={m + k}><b>Validateur</b>, mois {m} : déclencheur {l.declencheur} {l.resultat}{l.problemes ? ` (${l.problemes.join(" ; ")})` : ""}.</p>)))}
        </div>
      </details>
      <div className="row">
        <button className="btn" disabled={i === 0} onClick={() => { setI(i - 1); scrollTo(0, 0); }}>Précédente</button>
        {i < r.scenarios.length - 1
          ? <button className="btn primary" onClick={() => { setI(i + 1); scrollTo(0, 0); }}>Révélation suivante</button>
          : <button className="btn primary" onClick={() => go("/profil")}>Voir mon profil révélé</button>}
      </div>
    </>
  );
}

// ================================================================== profil révélé (le miroir)
function Profile({ uid, open, go }: { uid: string; open: (id: string) => void; go: (h: string) => void }) {
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/api/users/${uid}/profile`).then(setP).catch((e) => setErr(e.message)); }, [uid]);
  if (err) return <p className="err">{err}</p>;
  if (!p) return <p>Chargement…</p>;
  const traits = Object.values(p.traits) as any[];
  const rt = p.traits.RT;
  return (
    <>
      <div className="stack">
        <h1>Ce que tu as dit. Ce que tu as fait.</h1>
        <p className="lede">
          {rt.observed != null
            ? `Tu as déclaré un risque ${RISQUES[p.declared.risque].toLowerCase()}. Tes décisions correspondent à un profil ${RISQUES[rt.detail.classe].toLowerCase()}.`
            : "Il manque encore des décisions en baisse pour situer ta tolérance au risque."}
        </p>
        <div className="row">
          <span className="muted">Version {p.version} · confiance moyenne {Math.round(p.resume.confiance_moyenne * 100)} %</span>
          {p.resume.preliminaire && <span className="status vigilance">Profil préliminaire</span>}
        </div>
      </div>
      <section className="panel">
        <div className="mirror">
          <div className="mirror-head"><div>Déclaré</div><div>sur 100</div><div>Observé, avec son intervalle à 80 %</div></div>
          {traits.map((t) => (
            <div className="mirror-row" key={t.code}>
              <div className="mbar left">
                {t.declared == null ? <span className="none">non déclaré</span> : (
                  <><button className="val" onClick={() => open(`M-${t.code}`)}>{num(t.declared)}</button>
                    <div className="track"><div className="fill" style={{ width: `${t.declared}%` }} /></div></>)}
              </div>
              <button className="name" title={t.aide} onClick={() => open(`M-${t.code}`)}>{t.nom}</button>
              <div className="mbar">
                {t.observed == null ? <span className="none">données insuffisantes</span> : (
                  <><div className="track"><div className="fill" style={{ width: `${t.observed}%` }} />
                    <div className="whisk" style={{ left: `${t.low}%`, width: `${Math.max(1, t.high - t.low)}%` }} /></div>
                    <button className="val" onClick={() => open(`M-${t.code}`)}>{num(t.observed)}</button></>)}
              </div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>Chaque chiffre ouvre sa preuve : les décisions, les données et la formule. Les scores sont des mesures de simulation <Tag kind="Hypothèse" />, pas des prédictions.</p>
      </section>
      <section className="panel">
        <h3 style={{ marginBottom: 8 }}>En détail</h3>
        {p.phrases.map((s: any, k: number) => <Sentence key={k} s={s} onOpen={open} />)}
      </section>
      <div className="row">
        <button className="btn primary" onClick={() => go("/pacte")}>
          {p.faiblesses.length ? `Écrire mes règles (${p.faiblesses.length} écart${p.faiblesses.length > 1 ? "s" : ""} à traiter)` : "Voir mes règles"}
        </button>
        <button className="btn" onClick={() => go("/tableau")}>Tableau de bord</button>
      </div>
    </>
  );
}

// ================================================================== pacte
function RuleEditor({ uid, trait, replaces, onSaved }: { uid: string; trait: string | null; replaces?: any; onSaved: () => void }) {
  const [text, setText] = useState(replaces?.text_user ?? "");
  const [parsed, setParsed] = useState<any>(null);
  const [strict, setStrict] = useState(replaces?.strictness ?? 1);
  const [err, setErr] = useState("");
  const body = { text, trait, strictness: strict, replaces: replaces?.rule_id };
  return (
    <div className="stack">
      <label htmlFor={`rule-${trait}-${replaces?.rule_id}`}>Ta règle, avec tes mots</label>
      <textarea id={`rule-${trait}-${replaces?.rule_id}`} value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} />
      <div className="row">
        <button className="btn" disabled={text.trim().length < 8} onClick={() => api(`/api/users/${uid}/rules/parse`, body).then(setParsed).catch((e) => setErr(e.message))}>Vérifier ma règle</button>
        <label>Niveau de rigueur{" "}
          <select value={strict} onChange={(e) => setStrict(+e.target.value)}>
            <option value={1}>1 · simple rappel</option><option value={2}>2 · rappel renforcé</option><option value={3}>3 · rappel le plus strict</option>
          </select></label>
      </div>
      {parsed && !parsed.ok && <p className="err">{parsed.question}</p>}
      {parsed?.ok && (
        <div className="stack">
          <p><b>Voici comment je comprends ta règle :</b> {parsed.lecture}</p>
          <div className="row">
            <button className="btn primary" onClick={() => api(`/api/users/${uid}/rules`, body).then(onSaved).catch((e) => setErr(e.message))}>C'est bien ma règle, l'enregistrer</button>
            <button className="btn quiet" onClick={() => setParsed(null)}>Je la corrige</button>
          </div>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function Pact({ uid, open, go }: { uid: string; open: (id: string) => void; go: (h: string) => void }) {
  const [p, setP] = useState<any>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [free, setFree] = useState(false);
  const load = () => { setEdit(null); setFree(false); api(`/api/users/${uid}/profile`).then(setP); };
  useEffect(load, [uid]); // eslint-disable-line
  if (!p) return <p>Chargement…</p>;
  const todo = p.faiblesses.filter((w: any) => w.statut === "en_attente");
  return (
    <>
      <div className="stack">
        <h1>Tes règles, écrites par toi.</h1>
        <p className="lede">Pour chaque écart, on te montre le problème et ses preuves. À toi d'écrire la règle qui le règle. Le système ne propose rien : il vérifie seulement que ta règle est mesurable.</p>
      </div>
      {p.faiblesses.length === 0 && <p>Aucun écart marqué pour l'instant. Tu peux quand même écrire une règle.</p>}
      {p.faiblesses.map((w: any) => (
        <section key={w.trait} className={`panel stack ${w.statut === "en_attente" ? "weak" : ""}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>{w.nom}</h3>
            {w.statut === "regle" && <span className="ok">Règle écrite</span>}
            {w.statut === "refuse" && <span className="muted">Tu as choisi de ne pas écrire de règle</span>}
          </div>
          <p>{w.probleme}</p>
          <div className="row small">
            <button className="link" onClick={() => open(w.evidence_id)}>Voir la mesure</button>
            {w.decision_ids.slice(0, 6).map((d: string, k: number) => <button key={d} className="link" onClick={() => open(d)}>décision {k + 1}</button>)}
          </div>
          {w.statut === "en_attente" && (
            <>
              <RuleEditor key={"w-" + w.trait} uid={uid} trait={w.trait} onSaved={load} />
              <div><button className="link small" onClick={() => api(`/api/users/${uid}/rules/refuse`, { text: "", trait: w.trait }).then(load)}>Ne pas écrire de règle pour cet écart</button></div>
            </>
          )}
        </section>
      ))}
      <section className="panel stack">
        <h3>Règles en vigueur ({p.regles.length})</h3>
        {p.regles.length === 0 && <p className="muted">Aucune règle pour l'instant.</p>}
        {p.regles.map((r: any) => (
          <div key={r.rule_id} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <p><b>« {r.text_user} »</b></p>
            <p className="small muted">Lecture du système : {r.lecture} Rigueur {r.strictness} · version {r.version} · <button className="link" onClick={() => open(r.rule_id)}>preuve</button></p>
            {edit === r.rule_id ? <RuleEditor key={"r-" + r.rule_id} uid={uid} trait={r.trait} replaces={r} onSaved={load} />
              : <div><button className="link small" onClick={() => setEdit(r.rule_id)}>Modifier ou resserrer cette règle</button></div>}
          </div>
        ))}
        {free ? <RuleEditor key={"libre-" + p.regles.length} uid={uid} trait={null} onSaved={load} /> : <div><button className="btn quiet" onClick={() => setFree(true)}>Écrire une autre règle</button></div>}
      </section>
      <div className="row">
        <button className="btn primary" onClick={() => go("/tableau")}>{todo.length ? "Continuer vers le tableau de bord" : "Aller au tableau de bord"}</button>
        {todo.length > 0 && p.regles.length < 2 && <span className="muted">Deux règles au minimum sont conseillées.</span>}
      </div>
    </>
  );
}

// ================================================================== tableau de bord
function Investigation({ uid, eid, open }: { uid: string; eid: string; open: (id: string) => void }) {
  const [inv, setInv] = useState<any>(null);
  useEffect(() => { api(`/api/users/${uid}/investigations/${eid}`).then(setInv).catch(() => setInv(null)); }, [uid, eid]);
  if (!inv) return <p className="muted">Enquête en cours…</p>;
  return (
    <div className="stack">
      <p><b>Cause probable : {inv.verdict_fr}</b>{inv.verdict !== "INDETERMINE" && ` · confiance ${Math.round(inv.confidence * 100)} %`} <Tag kind="Hypothèse" /> <button className="link small" onClick={() => open(`I-${eid.slice(0, 12)}`)}>preuve</button></p>
      <p className="small muted">{inv.avertissement} Fenêtre observée : les {inv.window.heures} heures avant le trade. Consultation seule : l'enquête est automatique.</p>
      {inv.signals.length > 0 && (
        <table><thead><tr><th>Signal</th><th>Source</th><th className="num">Avant le trade</th><th className="num">Score</th><th /></tr></thead>
          <tbody>{inv.signals.map((s: any) => (
            <tr key={s.id}><td>{s.libelle}<br /><span className="small muted">{s.categorie === "SOCIAL" ? "influence sociale" : s.categorie === "HYPE_MARCHE" ? "hype de marché" : s.categorie === "NOUVELLE" ? "nouvelle" : "impulsion"}</span></td>
              <td className="small">{s.source}</td><td className="num">{num(s.heures_avant_le_trade)} h</td><td className="num">{num(Math.round(s.score * 100))}</td>
              <td><button className="link small" onClick={() => open(s.id)}>preuve</button></td></tr>))}</tbody></table>
      )}
      <p className="small muted">Sources : {Object.entries(inv.sources_coverage).map(([k, v]) => `${k} (${v})`).join(" · ")}.{inv.data_gaps.length > 0 && ` Limites : ${inv.data_gaps.join(" ; ")}.`}</p>
    </div>
  );
}

function Dashboard({ uid, open, go }: { uid: string; open: (id: string) => void; go: (h: string) => void }) {
  const [p, setP] = useState<any>(null);
  const [tl, setTl] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(() => {
    api(`/api/users/${uid}/profile`).then(setP);
    api(`/api/users/${uid}/timeline`).then(setTl);
    api(`/api/users/${uid}/trades`).then(setTrades);
  }, [uid]);
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, [load]);
  if (!p) return <p>Chargement…</p>;
  const d = p.derive;
  return (
    <>
      <div className="stack">
        <h1>Ton suivi dans le temps.</h1>
        <p className="lede">Chaque trade envoyé par ta plateforme est analysé automatiquement. L'indice monte quand un trade ressemble à tes écarts, et redescend quand tes trades sont sains.</p>
      </div>
      {d.reevaluation_pending && (
        <div className="alert" role="alert">
          <h3>Il est temps de refaire le point.</h3>
          <p>Ton indice de dérive a atteint ton seuil personnel. Une courte simulation ciblée permet de remesurer, puis de revoir tes règles.</p>
          <div><button className="btn primary" onClick={() => go("/reevaluation")}>Voir pourquoi et commencer</button></div>
        </div>
      )}
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Indice de dérive : {num(d.di)} sur 100</h3>
          <span className={`status ${d.status}`}>{d.status === "normal" ? "Normal" : d.status === "vigilance" ? "Vigilance" : "Alerte"}</span>
        </div>
        <Gauge d={d} />
        <p className="small muted">Ton seuil de réévaluation est personnel <Tag kind="Hypothèse" /> : il part plus bas quand l'écart entre le déclaré et l'observé est grand, baisse après un trade problématique et remonte après cinq trades sains.</p>
      </section>
      <section className="panel stack">
        <h3>Trades reçus ({trades.length})</h3>
        {trades.length === 0 && <p className="muted">Aucun trade reçu. Ouvre la console de l'hôte pour en envoyer un fictif.</p>}
        {trades.length > 0 && (
          <table><thead><tr><th>Moment</th><th>Trade</th><th>Cause probable</th><th className="num">Sévérité</th><th className="num">Indice après</th><th /></tr></thead>
            <tbody>{trades.map((t) => (
              <tr key={t.event_id}>
                <td className="small">{t.executed_at.replace("T", " ").slice(0, 16)}</td>
                <td>{t.side === "buy" ? "Achat" : "Vente"} {t.symbol} · {money(t.amount_cad ?? t.amount)}{t.regle_ignoree && <><br /><span className="neg small">Règle non respectée</span></>}</td>
                <td>{t.status !== "processed" ? "analyse en cours" : t.enquete.verdict_fr}</td>
                <td className="num">{t.severite != null ? num(Math.round(t.severite * 100)) : "—"}</td>
                <td className="num">{t.derive_apres ? num(t.derive_apres.di) : "—"}</td>
                <td><button className="link small" onClick={() => setSel(sel === t.event_id ? null : t.event_id)}>{sel === t.event_id ? "fermer" : "enquête"}</button> · <button className="link small" onClick={() => open(`T-${t.event_id.slice(0, 12)}`)}>preuve</button></td>
              </tr>))}</tbody></table>
        )}
        {sel && <div className="panel flat"><Investigation uid={uid} eid={sel} open={open} /></div>}
      </section>
      <section className="panel stack">
        <h3>Historique du profil</h3>
        <table><thead><tr><th>Version</th><th>Cause</th><th className="num">Indice</th><th className="num">Seuil</th><th>Preuves</th></tr></thead>
          <tbody>{[...tl].reverse().slice(0, 12).map((v) => (
            <tr key={v.version}><td>{v.version}</td><td>{v.cause}</td><td className="num">{num(v.derive.di)}</td><td className="num">{num(v.derive.threshold)}</td>
              <td>{v.evidence_ids.map((e: string) => <button key={e} className="link small" style={{ marginRight: 8 }} onClick={() => open(e)}>{e.slice(0, 1) === "T" ? "trade" : "enquête"}</button>)}</td></tr>))}</tbody></table>
      </section>
      <section className="panel stack">
        <h3>Tes règles ({p.regles.length})</h3>
        {p.regles.map((r: any) => <p key={r.rule_id}>« {r.text_user} » <span className="small muted">rigueur {r.strictness}</span></p>)}
        <div><button className="btn quiet" onClick={() => go("/pacte")}>Gérer mes règles</button></div>
      </section>
    </>
  );
}

// ================================================================== réévaluation
function Reevaluation({ uid, open, onStart }: { uid: string; open: (id: string) => void; onStart: (v: any) => void }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/api/users/${uid}/trades`).then(setTrades); api(`/api/users/${uid}/profile`).then(setP); }, [uid]);
  if (!p) return <p>Chargement…</p>;
  const bad = trades.filter((t) => t.status === "processed" && t.severite >= 0.25);
  return (
    <>
      <div className="stack">
        <h1>Pourquoi refaire le point maintenant.</h1>
        <p className="lede">Ton indice de dérive est à {num(p.derive.di)} pour un seuil personnel de {num(p.derive.threshold)}. Voici les trades qui l'ont fait monter.</p>
      </div>
      <section className="panel">
        <table><thead><tr><th>Trade</th><th>Ce qui a compté</th><th className="num">Sévérité</th><th /></tr></thead>
          <tbody>{bad.map((t) => (
            <tr key={t.event_id}><td>{t.side === "buy" ? "Achat" : "Vente"} {t.symbol}<br /><span className="small muted">{t.executed_at.replace("T", " ").slice(0, 16)}</span></td>
              <td className="small">{Object.entries(t.composantes).filter(([, v]: any) => v > 0).map(([k, v]: any) => `${({ SOCIAL: "influence sociale", HYPE_MARCHE: "hype de marché", NOUVELLE: "nouvelle", IMPULSION: "impulsion", rule_override: "règle non respectée", size_vs_tolerance: "taille au-delà de ta tolérance" } as any)[k]} ${Math.round(v * 100)}`).join(" · ")}</td>
              <td className="num">{Math.round(t.severite * 100)}</td>
              <td><button className="link small" onClick={() => open(`T-${t.event_id.slice(0, 12)}`)}>preuve</button></td></tr>))}</tbody></table>
      </section>
      <p>La simulation ciblée compte 3 situations. Comme la première fois, rien n'est révélé avant la fin. Ensuite, tu revois tes règles toi-même.</p>
      <div className="row">
        <button className="btn primary" onClick={() => api("/api/sessions", { user_id: uid, mode: "cible" }).then(onStart).catch((e) => setErr(e.message))}>Commencer la simulation ciblée</button>
        {err && <span className="err">{err}</span>}
      </div>
    </>
  );
}
