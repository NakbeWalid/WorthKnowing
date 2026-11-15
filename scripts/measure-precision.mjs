// Précision de MESURE de l'évaluation, estimée par simulation. Usage : npm run build && node scripts/measure-precision.mjs
//
// CE QUE CE SCRIPT MESURE, ET CE QU'IL NE MESURE PAS
//   Mesure : si une personne a un vrai niveau (0-100) pour un comportement et répond avec un peu de bruit, de combien le score
//   que l'évaluation calcule s'écarte-t-il de ce vrai niveau ? C'est la précision de l'INSTRUMENT (résolution + robustesse au bruit).
//   Ne mesure PAS : la validité. Le script SUPPOSE que les barèmes `signals` traduisent bien un trait (par exemple que
//   « Acheter » dans « L'emballement » traduit un fomo de 90). Rien ne le démontre sans comportements réels de référence.
//
// HYPOTHÈSES DU MODÈLE DE RÉPONSE (modifiables ci-dessous)
//   - le vrai niveau de chaque comportement est tiré au hasard, uniformément, entre 0 et 100 ;
//   - dans une situation qui teste ce comportement, la personne choisit l'option dont le barème est le plus proche de
//     (son vrai niveau + un bruit gaussien d'écart-type SIGMA) : SIGMA = 10 (réponses nettes), 20 (moyen), 30 (très bruitées) ;
//   - le temps de décision (impulsivité) est un indice plus bruyant que les réponses : bruit 1,5 fois plus fort.
//   - « appétit pour le risque » n'a aucune situation à lui : il est déduit de réponses données pour d'autres comportements.
//     Il est donc exclu de la simulation, qui ne sait pas dire à quel trait il correspond.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { SCENARIO_TYPES } = require('../dist/miroir/evaluation/scenario-types.js');

const PARAMS = ['concentration', 'newsSensitivity', 'lossAversion', 'fomo', 'impulsivity'];
const NAMES = { concentration: 'Concentration', newsSensitivity: 'Sensibilité aux nouvelles', lossAversion: 'Réaction aux pertes', fomo: 'Attrait pour le « hype »', impulsivity: 'Impulsivité' };
const TESTS = Object.fromEntries(Object.entries(SCENARIO_TYPES).map(([k, v]) => [v.tests, k])); // paramètre -> type de situation qui le teste
const SEED = 20261115;

// Ancien jeu à 4 choix (commit 37a3ee4), pour comparer : barème de chaque option, par situation.
const OLD = {
  crash: [{ lossAversion: 90, riskTolerance: 15 }, { lossAversion: 65, riskTolerance: 35 }, { lossAversion: 35, riskTolerance: 60 }, { lossAversion: 15, riskTolerance: 85 }],
  hype: [{ fomo: 90, riskTolerance: 90 }, { fomo: 65, riskTolerance: 70 }, { fomo: 35, riskTolerance: 45 }, { fomo: 15, riskTolerance: 25 }],
  shock: [{ newsSensitivity: 90, lossAversion: 75 }, { newsSensitivity: 65 }, { newsSensitivity: 30 }, { newsSensitivity: 20 }],
  flat: [{ impulsivity: 85, fomo: 70 }, { impulsivity: 60 }, { impulsivity: 25 }],
  winner: [{ concentration: 90, fomo: 70 }, { concentration: 70 }, { concentration: 35 }, { concentration: 15 }],
};
const NEW = Object.fromEntries(Object.entries(SCENARIO_TYPES).map(([k, v]) => [k, v.choices.map((c) => c.signals)]));
/**
 * PISTE NON APPLIQUÉE : mêmes situations et mêmes sens, mais le barème du paramètre principal est réparti à égale distance
 * (15 / 50 / 85) au lieu des valeurs actuelles (par exemple 15 / 70 / 90 pour la concentration). Sert uniquement à chiffrer
 * ce que gagnerait un barème régulier ; le barème réel n'est pas modifié (c'est un jugement métier, voir KIRO_HANDOFF.md).
 */
function evenlySpaced(options) {
  const out = {};
  for (const [type, opts] of Object.entries(options)) {
    const main = SCENARIO_TYPES[type].tests;
    const order = opts.map((o, i) => [o[main], i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); // rangs du plus bas au plus haut
    const even = [15, 50, 85];
    out[type] = opts.map((o, i) => ({ ...o, [main]: even[order.indexOf(i)] }));
  }
  return out;
}
const CONFIGS = [
  { name: '5 situations, 4 choix (ancienne version)', options: OLD, perType: 1 },
  { name: '5 situations, 3 choix', options: NEW, perType: 1 },
  { name: '10 situations, 3 choix (version actuelle)', options: NEW, perType: 2 },
  { name: '10 situations, 3 choix, barème à écarts réguliers 15/50/85 (PISTE NON APPLIQUÉE)', options: evenlySpaced(NEW), perType: 2 },
];

// Générateur pseudo-aléatoire reproductible : les mêmes chiffres à chaque exécution.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const TIME_BUCKETS = [85, 55, 25]; // « moins de 5 s », « moins de 12 s », « plus »
const nearest = (target, values) => values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));

/** Score observé d'un paramètre pour une personne de vrai niveau `trait`, avec bruit `sigma`. Même agrégation que l'application (moyenne). */
function observe(param, trait, cfg, sigma, r) {
  const type = TESTS[param];
  const vals = [];
  for (let k = 0; k < cfg.perType; k++) {
    const opts = cfg.options[type];
    const own = opts.map((o) => o[param]); // barème de chaque option pour CE paramètre (toutes les options en ont un)
    const target = trait + gauss(r) * sigma;
    const chosen = own.indexOf(nearest(target, own));
    vals.push(opts[chosen][param]);
    // Les barèmes secondaires de cette option (par exemple fomo dans « L'impatience ») ne sont pas simulés ici : seul le paramètre
    // principal de la situation est évalué, ce qui sous-estime légèrement les paramètres qui reçoivent aussi des signaux secondaires.
  }
  if (param === 'impulsivity') {
    // Le temps de décision de chaque situation (10 ou 5) donne un indice, moyenné ; bruit plus fort.
    const times = Array.from({ length: cfg.perType * 5 }, () => nearest(trait + gauss(r) * sigma * 1.5, TIME_BUCKETS));
    vals.push(times.reduce((a, b) => a + b, 0) / times.length);
  }
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const SIGMAS = [0, 10, 20, 30];
const N = 20000;
console.log('Précision de mesure estimée par simulation (', N, 'personnes simulées par cas, graine', SEED, ')');
console.log('Valeur lue : écart MOYEN entre le score calculé et le vrai niveau, en points sur 100 (plus petit = plus précis).\n');
const summary = {};
for (const cfg of CONFIGS) {
  console.log(cfg.name);
  console.log('  ' + 'comportement'.padEnd(28) + SIGMAS.map((s) => (s === 0 ? 'sans bruit' : `bruit ${s}`).padStart(11)).join(''));
  const means = SIGMAS.map(() => 0);
  for (const p of PARAMS) {
    const row = SIGMAS.map((s, si) => {
      const r = rng(SEED + si * 101 + p.length); let sum = 0;
      for (let i = 0; i < N; i++) { const t = r() * 100; sum += Math.abs(observe(p, t, cfg, s, r) - t); }
      const mean = sum / N; means[si] += mean / PARAMS.length; return mean;
    });
    console.log('  ' + NAMES[p].padEnd(28) + row.map((v) => v.toFixed(1).padStart(11)).join(''));
  }
  console.log('  ' + 'MOYENNE des 5'.padEnd(28) + means.map((v) => v.toFixed(1).padStart(11)).join('') + '\n');
  summary[cfg.name] = means;
}
const [oldM, mid, cur, even] = Object.values(summary);
console.log('Lecture : avec une personne « moyennement bruitée » (bruit 20), l\'écart moyen passe de',
  oldM[2].toFixed(1), 'points (ancienne version) à', mid[2].toFixed(1), '(3 choix) puis', cur[2].toFixed(1), '(10 situations).');
console.log('Barème à écarts réguliers (non appliqué) : à bruit 20,', even[2].toFixed(1), 'points ; sans bruit,', even[0].toFixed(1), 'contre', cur[0].toFixed(1), 'pour le barème actuel.');
console.log('Même sans aucun bruit, l\'écart ne tombe pas à 0 : avec 3 choix, un score ne peut prendre que quelques valeurs (écart de résolution).');
