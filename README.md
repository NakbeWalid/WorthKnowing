# Miroir — AlphaForge AI (Datathon PolyFinances 2026)

> Ce que vous dites de vous comme investisseur, et ce que vous faites vraiment.

Miroir bâtit le profil comportemental d'un investisseur en comparant ce qu'il **déclare** à ce qu'il
**fait** dans des situations de marché réelles (rendues méconnaissables), l'aide à **se fixer ses propres
règles**, puis **enquête sur chaque trade simulé** pour mesurer à quel point son comportement dérive.

**Simulation uniquement** — aucune transaction réelle, aucun conseil financier.

## Démarrer

```bash
npm install
npm run build
npm start            # http://localhost:3000
npm run test:e2e     # (serveur lancé) rejoue tout le pipeline par l'API
```

- Admin : `admin@miroir.local` / `admin123` (modifiable par variables d'environnement, voir `.env.example`)
- Repartir de zéro : supprimer `data/db.json`
- Régénérer la bibliothèque de simulations : `npm run scenarios` (Python 3, aucune dépendance)

## Parcours

1. **Connexion / création d'utilisateur** (`/`)
2. **Évaluation** (`/onboarding.html`)
   1. 13 questions : faits (âge, horizon, objectif, ESG, crypto…) + comment il se voit → **profil déclaré**
   2. 5 mises en situation tirées des prix réels 2021-2026, masquées (nom et manchette fictifs, prix en base 100) → **profil observé**
   3. Révélation : l'actif réel, la date, ce qui s'est passé ensuite, et le résultat en $ de chaque décision possible
   4. Règles : pour chaque paramètre fragile, l'utilisateur écrit sa propre règle (texte + seuil)
3. **Tableau de bord** (`/dashboard.html`) : profil, score de dérive, règles, simulation de trades.
   Si un trade touche une règle, elle lui est rappelée avant qu'il puisse poursuivre.
4. **Enquête** sur chaque trade → mise à jour des paramètres et du **score de dérive** → au-delà de 60, réévaluation obligatoire.
5. **Vue admin** (`/admin.html`) : tous les utilisateurs, profils, règles, trades et enquêtes, en temps réel.

## Le profil : 6 paramètres (0–100)

Appétit pour le risque · Réaction aux pertes · Attrait pour le « hype » · Concentration · Impulsivité · Sensibilité aux nouvelles.
Chacun existe en trois versions : **déclaré** (questionnaire), **référence** (observé à la dernière évaluation), **actuel** (mis à jour par les trades).

**Score de dérive** = 1,5 × plus grand écart d'un paramètre + écart moyen + 8 points par règle outrepassée (`src/trades/drift.ts`).

## Structure

```
scripts/build_scenarios.py   bibliothèque de simulations (60 scénarios) à partir de dataset/prices_daily.csv
dataset/                     jeu de données de départ (inchangé)
data/                        scenarios.json, assets.json (générés), db.json (base locale)
src/
  auth/         inscription, connexion, gardes                    -> Cognito
  storage/      contrat Store + JsonStore                         -> DynamoDB
  evaluation/   questionnaire, scénarios, diagnostic, règles
  market/       prix et indicateurs factuels                      -> S3
  news/         contrat NewsProvider + mock                       -> agent Bedrock
  trades/       pipeline du trade + agents (gouvernance, comportement, explicabilité) -> Bedrock
  realtime/     bus d'événements (SSE)                            -> EventBridge / AppSync
  admin/        API admin + flux temps réel
public/         4 pages HTML + JS sans framework ni build
KIRO_HANDOFF.md passation pour l'intégration AWS
```

## Données, hypothèses, limites

- Prix : Yahoo Finance via `yfinance`, 2021-11-12 → 2026-11-12, extraction du 2026-11-13 (`dataset/README.md`, `dataset/sources_metadata.csv`).
- Rendements calculés sur `adj_close` ; prix d'exécution = `close`. Calendriers alignés par report de la dernière valeur connue.
- Les scénarios sont détectés par des seuils fixes (ex. « chute » = −25 % en 30 séances). Les manchettes affichées pendant les simulations sont fictives et étiquetées comme telles ; aucune cause historique n'est inventée à la révélation.
- Le profil mesure un comportement, pas un rendement. Cinq situations donnent un signal, pas un diagnostic.
- Les « nouvelles » de l'enquête sont pour l'instant des signaux dérivés des prix, étiquetés « simulé ».
- Montants non convertis entre CAD et USD ; biais du survivant dans l'univers d'actifs ; aucune donnée ESG.
