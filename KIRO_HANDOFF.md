# Passation à Kiro — Miroir (AlphaForge AI, Datathon PolyFinances × Banque Nationale × AWS)

Tu reprends un projet **qui fonctionne déjà de bout en bout en local**. Ton travail : **brancher les services
AWS** aux endroits prévus, sans changer le parcours ni les règles métier. Lis ce document en entier avant de coder.

## 0. Règles du jeu (à respecter absolument)

1. **Ne casse pas le pipeline.** `npm run build && npm start` puis `npm run test:e2e` doit rester vert après
   chaque étape. Ce test rejoue : inscription → questionnaire → 5 simulations → révélation → règles → trades →
   dérive → blocage → réévaluation → vue admin temps réel.
2. **Garde les implémentations locales.** Chaque service AWS est une *nouvelle classe* derrière un contrat
   existant, choisie par variable d'environnement. `STORAGE_DRIVER=json` doit continuer à marcher sans compte AWS.
3. **Code simple et lisible**, commentaires en français, même style que l'existant. Pas de sur-ingénierie.
4. **AWS est une condition d'admissibilité** (15 % de la note) : chaque service doit avoir un rôle réel et
   démontrable dans le flux. Le jury dit explicitement : « Ne multipliez pas les services pour impressionner.
   Justifiez chaque choix. » Tiens-toi à la liste de la section 4.
5. **Cadre responsable du défi** : simulation uniquement, aucun conseil financier, distinguer faits /
   hypothèses / fictif, ne jamais inventer une justification après coup, dire quand on ne sait pas.
   Toute sortie d'un modèle doit citer ses sources ou être étiquetée.
6. **UI** : sobre et épurée, ne pas la surcharger. HTML + JS sans framework dans `public/`.

## 1. Le produit en une phrase

Miroir compare ce qu'un investisseur **dit** de lui (questionnaire) à ce qu'il **fait** (simulations sur des
épisodes de marché réels, masqués), l'amène à **se fixer ses propres règles** sur ses points fragiles, puis
**enquête sur chaque trade simulé** pour mettre à jour son profil et un **score de dérive** ; au-delà d'un
seuil, il doit refaire l'évaluation. Un admin voit tout en temps réel.

Lien avec l'énoncé : persona *Robert* (remettre en question une demande incohérente avec le profil),
*Amira* (« risque élevé » ≠ « tout est acceptable » : règles de concentration), *Mateo* (préférences non
financières : avertissement ESG). Agents demandés par l'énoncé : **gouvernance** et **explicabilité** existent déjà.

## 2. Ce qui est fait (ne pas refaire)

| Domaine | Fichiers | État |
| --- | --- | --- |
| Connexion / création d'utilisateur, rôles user/admin | `src/auth/*`, `public/index.html` | Fonctionnel (local) |
| Questionnaire 13 questions → profil déclaré + préférences | `src/evaluation/questions.ts` | Fonctionnel |
| Bibliothèque de 60 simulations (5 types × 12) tirée des prix réels | `scripts/build_scenarios.py` → `data/scenarios.json` | Fonctionnel |
| Session de 5 simulations masquées, temps de décision mesuré | `src/evaluation/evaluation.service.ts`, `scenario-types.ts` | Fonctionnel |
| Révélation (actif réel, suite réelle, résultat de chaque option) | idem, `public/js/onboarding.js` | Fonctionnel |
| Diagnostic déclaré vs observé, paramètres fragiles, règles auto-définies | `evaluation.service.ts` (`diagnose`, `finalize`), `rule-templates.ts` | Fonctionnel |
| Tableau de bord, formulaire de trade, rappel de la règle avant de poursuivre | `public/dashboard.html`, `public/js/dashboard.js` | Fonctionnel |
| Pipeline du trade : contrôle → exécution fictive → enquête → profil → dérive → explication | `src/trades/trades.service.ts`, `src/trades/agents/*`, `drift.ts` | Fonctionnel (enquête déterministe, nouvelles simulées) |
| Blocage au seuil de dérive + réévaluation (nouveaux scénarios, dérive remise à 0) | `trades.service.ts`, `evaluation.service.ts` | Fonctionnel |
| Vue admin temps réel (SSE) | `src/admin/admin.controller.ts`, `src/realtime/events.service.ts`, `public/js/admin.js` | Fonctionnel (mono-instance) |
| Test de bout en bout | `scripts/e2e.mjs` | Vert |

## 3. Architecture actuelle et pipeline

```
Navigateur ──HTTP──▶ NestJS (src/)
                      ├─ AuthController        /api/auth/register · /api/auth/login · /api/me
                      ├─ EvaluationController  /api/evaluation/questions · start · :id/decisions · :id/complete · :id/rules
                      ├─ MarketController      /api/market/assets · /api/market/context
                      ├─ TradesController      /api/trades/check · POST /api/trades · GET /api/trades · /api/portfolio
                      └─ AdminController       /api/admin/users · /api/admin/users/:id · /api/admin/stream (SSE)
```

**Pipeline d'un trade** (`TradesService.submit`) — c'est le cœur, garde cet ordre :

```
POST /api/trades {ticker, side, amount, marketDate, decisionTimeMs, note, acknowledgedRuleIds}
 [1] GovernanceAgent   règles personnelles touchées ? → 409 tant qu'elles ne sont pas confirmées
 [2] exécution fictive portefeuille simulé (100 000 $)             → événement trade.received
 [3] enquête           NewsProvider.getNews + BehaviorAgent.analyse → événement investigation.completed
 [4] profil            paramètres mis en jeu déplacés de 35 % vers le signal ; dérive recalculée ;
                       statut → reevaluation_required si dérive ≥ DRIFT_THRESHOLD (60)
 [5] Explainer         résumé + étapes + sources + hypothèses + limites → événement profile.updated
 → Store.saveTrade / saveUser → la vue admin se rafraîchit à chaque événement
```

**Modèle de données** : tout est dans `src/domain/types.ts` (`User`, `Profile`, `Rule`, `Drift`, `Evaluation`,
`Trade`, `Investigation`, `Scenario`). Les 6 paramètres : `riskTolerance`, `lossAversion`, `fomo`,
`concentration`, `impulsivity`, `newsSensitivity` (0–100), chacun en `declared` / `baseline` / `current`.

**Une seule définition par paramètre** (`src/evaluation/rule-templates.ts`, `PARAM_CHECKS`) sert à la fois au
rappel des règles (seuil de l'utilisateur) et aux constats de l'enquête (seuil par défaut). Si tu ajoutes un
paramètre, c'est là, plus `PARAMS`/`PARAM_INFO` dans `types.ts` et `PARAM_LABELS` dans `public/js/common.js`.

## 4. Ton travail : les points d'intégration AWS

Chaque point est marqué dans le code par `▶ POINT D'INTÉGRATION AWS (Kiro)` (`grep -rn "INTÉGRATION AWS" src`).
Les trois branchements principaux sont trois lignes dans `src/app.module.ts`.

Fais-les **dans cet ordre** (du plus visible pour le jury au moins critique). Installe `@aws-sdk/*` v3 au besoin.

### 4.1 Amazon Bedrock — agent de nouvelles (priorité 1, le plus important)

- **Contrat** : `NewsProvider.getNews(context: MarketContext): Promise<NewsItem[]>` dans `src/news/news.provider.ts`.
- **Aujourd'hui** : `MockNewsProvider` fabrique des « signaux » à partir des prix, étiquetés `simulated: true`.
- **À faire** : `src/news/bedrock-news.provider.ts` — `BedrockNewsProvider extends NewsProvider`.
  Pour un `ticker` et une `date`, récupérer de **vraies nouvelles datées** des jours précédant le trade
  (fenêtre : 7 jours avant `context.date`, jamais après — pas de fuite du futur) et les faire résumer /
  classer par un modèle Bedrock (`impact`: faible / moyen / élevé), `simulated: false`, `source` = éditeur + URL.
  Options de récupération, à choisir selon ce qui est disponible dans le compte : Bedrock Agent avec un
  action group Lambda appelant une API de nouvelles publique ; ou Bedrock Knowledge Base alimentée par un
  bucket S3 de nouvelles datées. **Documente la source, la date et les conditions d'utilisation** (exigence de l'énoncé).
- **Garde-fous** : si aucune nouvelle n'est trouvée, retourner `[]` (l'explication dira « aucun signal ») —
  ne jamais laisser le modèle en inventer. En cas d'erreur Bedrock, retomber sur `MockNewsProvider`.
- **Sélection** : `NEWS_DRIVER=mock|bedrock` dans `app.module.ts` (`useClass` conditionnel ou `useFactory`).

### 4.2 Amazon Bedrock — enquête comportementale et explication (priorité 1)

- **`BehaviorAgent`** (`src/trades/agents/behavior.agent.ts`) : aujourd'hui des constats déterministes.
  **Garde-les comme socle vérifiable.** Ajoute un `BedrockInfluenceAgent` appelé à l'étape [3] qui reçoit
  { contexte de marché, nouvelles, 10 derniers trades de l'utilisateur, profil, note de l'utilisateur } et
  répond à la question de l'énoncé du produit : *« ce trade montre-t-il un changement de comportement ou une
  influence externe (nouvelle, emballement) ? »*. Sortie JSON stricte : `Finding[]` supplémentaires
  (`param`, `signal` 0–100, `evidence` citant une nouvelle ou un fait chiffré fourni en entrée). Rejeter
  tout constat dont l'`evidence` ne renvoie pas à une donnée d'entrée. Plafonner l'effet du modèle
  (ex. signal borné à ±15 autour du signal déterministe) pour que le score reste explicable.
- **`Explainer`** (`src/trades/agents/explainer.ts`) : créer `BedrockExplainer extends Explainer` qui ne
  rédige que `summary` en langage clair à partir des faits. `steps`, `sources`, `hypotheses`, `limits`
  restent produits par le code (repris de `TemplateExplainer`). Sélection : `EXPLAINER_DRIVER=template|bedrock`.
- Mets à jour la limite « Les nouvelles sont des signaux simulés » : elle est déjà conditionnelle à `simulated`.
- Bonus à forte valeur pour le jury : à la **révélation** des simulations (`EvaluationService.complete`),
  ajouter à chaque scénario un champ `historicalContext` (1–2 phrases + source) produit par le même agent de
  nouvelles pour `reveal.ticker` autour de `reveal.decisionDate`. Si rien de sourcé : ne rien afficher.

### 4.3 Amazon DynamoDB — persistance (priorité 2)

- **Contrat** : classe abstraite `Store` (`src/storage/store.ts`), 8 méthodes async.
- **À faire** : `src/storage/dynamo.store.ts` — `DynamoStore extends Store` avec `@aws-sdk/lib-dynamodb`.
  Tables : `miroir-users` (PK `id`, GSI `email-index` sur `email`), `miroir-evaluations` (PK `id`),
  `miroir-trades` (PK `userId`, SK `createdAt`). Stocker les objets tels quels (documents).
- **Sélection** : `STORAGE_DRIVER=json|dynamodb`. Rien d'autre à modifier dans l'application.

### 4.4 Amazon Cognito — authentification (priorité 2)

- **Aujourd'hui** : `AuthService` (mot de passe scrypt + jeton HMAC maison). Suffisant pour la démo, pas pour la prod.
- **À faire** : User Pool + groupe `admin`. `register`/`login` passent par Cognito ; `AuthService.verify`
  valide le JWT Cognito (`aws-jwt-verify`) et lit le groupe pour le rôle. L'objet `User` métier reste dans le
  `Store`, clé = `sub` Cognito. `AuthGuard`, `AdminGuard`, les contrôleurs et `public/js/common.js` ne changent
  pas (le navigateur envoie toujours `Authorization: Bearer <jeton>`).
- Le flux SSE passe le jeton en `?token=` (limite d'`EventSource`) : conserve ce cas dans `AuthGuard`.

### 4.5 Amazon S3 — données (priorité 3)

- `MarketService` lit `dataset/prices_daily.csv` et `data/assets.json` ; `EvaluationService` lit
  `data/scenarios.json`. Ajouter une lecture depuis un bucket (`DATA_BUCKET`) au démarrage, avec repli sur
  le disque local. Y déposer aussi `sources_metadata.csv` (traçabilité des données demandée par le jury).

### 4.6 Temps réel et asynchrone — EventBridge / AppSync (priorité 3, seulement si le temps le permet)

- `EventsService` est un `Subject` RxJS en mémoire : parfait sur une instance, insuffisant sur plusieurs.
- Cible : `EventsService.emit` publie aussi sur **EventBridge** (bus `miroir`), et la vue admin s'abonne via
  **AppSync Events** ou **API Gateway WebSocket**. Garde les 5 types d'événements de `AppEvent`.
- Variante « pipeline asynchrone » : `POST /api/trades` dépose le trade dans **SQS** et une **Step Functions**
  enchaîne les étapes [3]→[5] (une Lambda par agent). Ne le fais que si 4.1–4.4 sont terminés et verts :
  la version synchrone actuelle est plus simple à expliquer en démo.
- `PIPELINE_STEP_DELAY_MS` (350 ms) n'existe que pour rendre les étapes visibles dans la vue admin : à
  supprimer dès que les appels Bedrock introduisent une vraie latence.

### 4.7 Déploiement

- Conteneur unique (ajouter un `Dockerfile` Node 22) sur **App Runner** ou **ECS Fargate** ; rôle IAM au
  moindre privilège (Bedrock `InvokeModel`/`InvokeAgent`, tables DynamoDB nommées, bucket S3 en lecture).
  Secrets (`JWT_SECRET`, mot de passe admin) dans **Secrets Manager** / variables chiffrées, jamais dans le dépôt.
- Infra en code (CDK ou SAM) dans `infra/`. Région suggérée : `ca-central-1` (vérifier la disponibilité des
  modèles Bedrock choisis, sinon profil d'inférence inter-régions).

## 5. Ce qu'il reste à améliorer côté produit (après AWS, par ordre d'intérêt)

1. **Règle respectée** : quand l'utilisateur clique « Annuler le trade » dans la fenêtre de rappel, appeler un
   nouvel endpoint `POST /api/trades/abandon` qui enregistre l'événement et réduit légèrement la dérive
   (signal positif). Aujourd'hui l'annulation n'est pas enregistrée.
2. **Conversion CAD/USD** avec `dataset/fx_usdcad_daily.csv` (les montants sont actuellement traités dans la
   devise de cotation — c'est écrit dans les limites affichées).
3. **Impulsivité par fréquence** : nombre de trades sur 24 h comme signal supplémentaire dans `PARAM_CHECKS`.
4. **Plus de scénarios** : 6 à 8 par évaluation (`config.scenariosPerEvaluation` + nouveaux types dans
   `build_scenarios.py` et `scenario-types.ts`, ex. krach obligations + actions de 2022 avec `macro_rates.csv`).
5. **Validation des entrées** avec `class-validator` (DTO) — aujourd'hui validation manuelle minimale.
6. **Graphique d'évolution de la dérive** dans le tableau de bord (les valeurs avant/après sont dans chaque trade).
7. Livrables du défi encore à produire : vidéo ~5 min, documentation technique, one-pager, schéma d'architecture AWS.

## 6. Hypothèses et limites actuelles (à conserver dans la documentation finale)

- Seuils des scénarios et des constats fixés à la main (`build_scenarios.py`, `PARAM_CHECKS`) ; « spéculatif »
  = crypto ou volatilité annualisée ≥ 45 % ; poids d'un constat = 35 % ; formule de dérive dans `drift.ts`.
- Cinq simulations donnent un signal de comportement, pas un diagnostic psychologique.
- Données quotidiennes, `adj_close` pour les rendements, biais du survivant, aucune donnée ESG (l'avertissement
  ESG dit explicitement qu'on ne peut pas conclure).
- La « date de marché simulée » permet de trader à une date passée pour la démonstration ; le portefeuille est
  valorisé à la date du dernier trade.

## 7. Scénario de démonstration à préserver (≈ 3 minutes)

1. Ouvrir `/admin.html` (admin) dans une fenêtre, `/` dans une autre.
2. Créer « Robert », cliquer le persona *Robert*, répondre aux 5 simulations, lire la révélation, activer les règles.
3. Tableau de bord : acheter 30 000 $ de NVDA à la date de marché 2023-05-30 → rappel des règles +
   avertissement d'incohérence avec le profil → « Poursuivre quand même » → enquête expliquée, dérive en hausse.
4. Répéter avec TSLA (2024-12-17) puis BTC-USD (2024-03-25) → dérive ≥ 60 → trades suspendus → réévaluation.
5. Pendant ce temps, la fenêtre admin affiche chaque étape en direct.

## 8. Définition de « terminé »

- [ ] `npm run test:e2e` vert en local (`json`/`mock`/`template`) **et** contre l'environnement AWS déployé (`BASE_URL=…`).
- [ ] Une enquête de trade affiche au moins une vraie nouvelle sourcée (ou dit clairement qu'il n'y en a pas).
- [ ] Données persistées dans DynamoDB, connexion par Cognito, admin réservé au groupe `admin`.
- [ ] README mis à jour : services AWS utilisés, rôle de chacun, schéma, variables d'environnement, sources de données ajoutées.
