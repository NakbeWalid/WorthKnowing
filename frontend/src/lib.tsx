import { useRef, useState } from "react";

// ------------------------------------------------------------------ API
const HOST_KEY = "dev-host-key"; // clé de la console de test (hôte fictif), jamais une vraie clé

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", ...(path.startsWith("/v1") ? { "X-Api-Key": HOST_KEY } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erreur || data.detail?.[0]?.msg || data.detail || `Erreur ${r.status}`);
  return data as T;
}

export const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string | null) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ }
  },
};

// ------------------------------------------------------------------ formats
export const money = (x: number) => `${Math.round(x).toLocaleString("fr-CA").replace(/-/, "−")} $`;
export const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x)).toLocaleString("fr-CA")} $`;
export const pct = (x: number | null | undefined, sign = true) =>
  x == null ? "—" : `${sign ? (x > 0 ? "+" : x < 0 ? "−" : "") : ""}${Math.abs(x).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} %`;
export const num = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("fr-CA", { maximumFractionDigits: 1 }));

export function Tag({ kind }: { kind: string }) {
  const k = kind.startsWith("R") ? "reel" : kind.startsWith("H") ? "hypothese" : "fictif";
  return <span className={`tag ${k}`}>{kind.startsWith("R") ? "Réel" : kind.startsWith("H") ? "Hypothèse" : "Fictif"}</span>;
}

// ------------------------------------------------------------------ graphique en lignes
export type Series = { name: string; color: string; values: number[] };

export function LineChart({ series, height = 220, markers = [], xLabel, format = (v: number) => num(v), baseline }: {
  series: Series[]; height?: number; markers?: { x: number; label: string }[]; xLabel?: (i: number) => string;
  format?: (v: number) => string; baseline?: number;
}) {
  const W = 880, H = height, padL = 8, padR = series.length > 1 ? 190 : 56, padT = 14, padB = 22;
  const n = Math.max(...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).concat(baseline ?? []);
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const move = (e: React.MouseEvent) => {
    const b = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (W - padL - padR)) * (n - 1)))));
  };
  // Étiquettes directes en bout de ligne, écartées pour ne pas se chevaucher.
  const ends = series.map((s) => ({ s, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  return (
    <div className="chartwrap">
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" onMouseMove={move} onMouseLeave={() => setHover(null)}
        aria-label={series.map((s) => s.name).join(", ")}>
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            {series.length === 1 && <text x={W - padR + 6} y={y(v) + 4}>{format(v)}</text>}
          </g>
        ))}
        {baseline != null && <line x1={padL} x2={W - padR} y1={y(baseline)} y2={y(baseline)} stroke="var(--ink-3)" strokeDasharray="4 4" />}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
        {series.length > 1 && ends.map(({ s, y: ly }) => (
          <text key={s.name} x={W - padR + 8} y={ly + 4} style={{ fill: "var(--ink)" }}>{s.name}</text>
        ))}
        {markers.map((m, i) => {
          const v = series[0].values[Math.min(m.x, series[0].values.length - 1)];
          return (
            <g key={i}>
              <circle cx={x(m.x)} cy={y(v)} r="6" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
              <text x={x(m.x)} y={y(v) - 12} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 600 }}>{m.label}</text>
            </g>
          );
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--ink)" strokeWidth="1" />}
        {hover != null && series.map((s) => s.values[hover] != null && (
          <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
        ))}
        {xLabel && [0, n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : "end"}>{xLabel(i)}</text>
        ))}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 8 }}>
          {xLabel ? `${xLabel(hover)} : ` : ""}
          {series.filter((s) => s.values[hover] != null).map((s) => `${series.length > 1 ? s.name + " " : ""}${format(s.values[hover])}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

// ------------------------------------------------------------------ jauge de dérive
export function Gauge({ d }: { d: any }) {
  return (
    <div className="gauge" role="img" aria-label={`Indice de dérive ${d.di} sur 100, seuil de réévaluation ${d.threshold}`}>
      <div className="track" />
      <div className="fill" style={{ width: `${d.di}%` }} />
      <div className="mark vig" style={{ left: `${d.vigilance_threshold}%` }}><span>vigilance {num(d.vigilance_threshold)}</span></div>
      <div className="mark" style={{ left: `${d.threshold}%` }}><span>ton seuil {num(d.threshold)}</span></div>
    </div>
  );
}

// ------------------------------------------------------------------ tiroir de preuves
const LABELS: Record<string, string> = {};
const human = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/ pct$/, " (%)").replace(/ s$/, " (s)");
const show = (v: any): string =>
  v == null ? "inconnu" : typeof v === "boolean" ? (v ? "oui" : "non") : typeof v === "number" ? num(v)
    : Array.isArray(v) ? (v.length ? v.map(show).join(", ") : "aucun") : typeof v === "object"
      ? Object.entries(v).map(([k, x]) => `${human(k)} : ${show(x)}`).join(" ; ") : String(v);

export function EvidenceDrawer({ uid, id, onOpen, onClose }: { uid: string; id: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [e, setE] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState("");
  if (loaded !== id) {
    setLoaded(id); setE(null); setErr("");
    api(`/api/users/${uid}/evidence/${encodeURIComponent(id)}`).then(setE).catch((x) => setErr(x.message));
  }
  return (
    <>
      <button className="scrim" aria-label="Fermer le panneau de preuves" onClick={onClose} />
      <aside className="drawer" aria-label="Panneau de preuves">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">Preuve {id}</span>
          <button className="btn quiet" onClick={onClose}>Fermer</button>
        </div>
        {err && <p className="err">{err}</p>}
        {e && (
          <>
            <h3>{e.titre}</h3>
            <div className="row"><Tag kind={e.etiquette} /><span className="muted">{e.type}</span></div>
            <dl>
              {Object.entries(e.donnees).map(([k, v]) => (<div key={k} style={{ display: "contents" }}><dt>{human(k)}</dt><dd>{show(v)}</dd></div>))}
            </dl>
            <div className="stack small">
              <p><b>Source :</b> {e.source}</p>
              {e.formule && <p><b>Méthode :</b> {e.formule}</p>}
            </div>
            {e.liens.length > 0 && (
              <div className="stack small">
                <b>Preuves liées</b>
                <div className="row">{e.liens.map((l: string) => <button key={l} className="link" onClick={() => onOpen(l)}>{l}</button>)}</div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

export function Sentence({ s, onOpen }: { s: any; onOpen: (id: string) => void }) {
  return (
    <div className="sentence">
      <p>{s.texte} <Tag kind={s.etiquette ?? "Réel"} /></p>
      <span className="row small">{s.evidence_ids.map((id: string) => <button key={id} className="link" onClick={() => onOpen(id)}>preuve</button>)}</span>
    </div>
  );
}
