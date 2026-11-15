# Passation à Kiro — Miroir + Boréal Courtage

Le projet a été **séparé en deux applications web** (branche `separation-banque-miroir`). Tout fonctionne en local
et le test de bout en bout est vert, mais **rien de ce qui touche AWS n'a pu être exécuté** depuis l'environnement
où ce travail a été fait. Ton rôle : vérifier les hypothèses de la section 5, corriger ce qui casse sur AWS, et
déployer. Lis les sections 1 à 4 pour comprendre la structure avant de toucher au code.

## 0. Règles du jeu

1. `npm run build && npm start`, puis `npm run test:e2e` doit rester vert après chaque changement (mode local, sans AWS).
2. **Les deux applications ne partagent ni code métier ni données.** `src/bank` n'importe jamais `src/miroir` (et
   inversement). Elles ne se parlent que par HTTP, via `src/bank/miroir.client.ts` → `/api/partner/v1`. Seul
   `src/shared` (cours de marché, lecture S3/disque, briques d'authentification locale) est commun.
3. Les implémentations locales restent utilisables sans compte AWS ; chaque service AWS se choisit par variable d'environnement.
4. Code simple, commentaires en français, interface sobre. Pas de nouveau service AWS sans rôle démontrable.
5. Cadre du défi : simulation uniquement, aucun conseil financier, distinguer faits / hypothèses / fictif, ne rien
   inventer après coup, dire quand on ne sait pas. Boréal Courtage est une plateforme **fictive** et doit le rester
   visiblement (ne pas lui donner le nom ou l'apparence d'une vraie institution).

## 1. Les deux applications

| | **Miroir** (`src/miroir`, `public/miroir`) | **Boréal Courtage** (`src/bank`, `public/bank`) |
| --- | --- | --- |
| Rôle | Notre service : profil comportemental, règles, enquêtes, dérive, vue admin | Plateforme de courtage fictive, cliente de Miroir |
| Port local | 3000 (`PORT`) | 3001 (`BANK_PORT`) |
| Entrée | `dist/miroir/main.js` | `dist/bank/main.js` |
| Comptes | Les siens (local ou Cognito) | Les siens (local), sans lien avec ceux de Miroir |
| Données | `data/db.json` ou tables `miroir-*` | `data/bank-db.json` ou tables `boreal-*` |
| Détient le portefeuille | Non | Oui (100 000 $ fictifs) |
| Pages | `/` connexion, `/onboarding.html`, `/profile.html`, `/admin.html` | `/` connexion, `/app.html` |

`npm start` lance les deux (`scripts/start-all.mjs`). En production ce sont deux conteneurs de la même image.

## 2. Parcours et liaison (à préserver tel quel)

1. Ouverture d'un compte chez Boréal → offre Miroir. **Refus** : compte ordinaire (`miroir.status = 'declined'`),
   les ordres sont exécutés et gardés dans l'historique, rien n'est envoyé à Miroir, l'option reste dans la page du compte.
2. **Acceptation** (tout de suite ou plus tard) : `POST /api/miroir/link/start` crée un `state` aléatoire et renvoie
   l'adresse `MIROIR/?link=1&state=…&return=BORÉAL/app.html`.
3. Chez Miroir, `public/miroir/index.html` valide `return` (`GET /api/link/partner`) et garde la demande dans
   `sessionStorage` (`miroir.pending`). L'utilisateur crée un **compte Miroir**, passe le questionnaire, les 5
   simulations, la révélation, puis définit ses règles.
4. À la fin (`finishAndReturn()` dans `public/miroir/js/common.js`) : `POST /api/link/authorize` → code à usage
   unique (5 min) → redirection vers `BORÉAL/app.html?code=…&state=…`.
5. `public/bank/js/app.js` appelle `POST /api/miroir/link/complete` : Boréal vérifie le `state`, puis son serveur
   échange le code (`POST /api/partner/v1/link/exchange`, en-tête `x-partner-key`) contre le **code persona**,
   stocké sur le compte (`account.miroir.personaCode`) et jamais envoyé au navigateur.
6. Ordres : voir section 3. Réévaluation : quand la dérive ≥ 60, `trades/check` renvoie `reevaluationRequired`,
   Boréal suspend les ordres et renvoie le client vers `MIROIR/?return=…` ; après la réévaluation il est ramené.
7. Retrait : `POST /api/miroir/unlink` (côté Boréal, prévient Miroir) ou `DELETE /api/link` (côté Miroir ; Boréal le
   découvre au prochain appel par un 401 et repasse le compte en ordinaire, `MiroirLinkService.handleRevoked`).

**Codes** (`src/miroir/partner/link.service.ts`) : les deux sont des objets signés HMAC avec `LINK_SECRET`.
Le code à usage unique contient `{uid, lid, exp}` ; le code persona `mir_…` contient `{uid, lid}`. `lid` est
l'identifiant de la liaison en cours sur l'utilisateur (`user.link.id`) : il change à chaque nouvelle liaison, ce qui
invalide les anciens codes sans table supplémentaire. « Usage unique » = la liaison passe de `pending` à `active` au
premier échange.

## 3. Pipeline d'un ordre

```
navigateur Boréal ── POST /api/trades/preview ──▶ TradingService.preview
                                                    validate()  : montant, liquidités, position, horloge de marché
                                                    precheck()  : Miroir POST /trades/check ─▶ TradesService.check
                                                                  (règles à rappeler, avertissements, réévaluation)
   fenêtre de confirmation : récapitulatif + rappel de la règle
   « Renoncer »  ── POST /api/trades/cancel ──▶ Miroir POST /trades/abandon (événement rule.respected)
   « Confirmer » ── POST /api/trades ─────────▶ TradingService.execute
                                                    [1] precheck() refait : 409 si règle non confirmée ou réévaluation exigée
                                                    [2] exécution dans le portefeuille, account.asOf = date de l'ordre
                                                    [3] Miroir POST /trades ─▶ TradesService.submit
                                                          nouvelles → constats (socle) → agent d'influence
                                                          → profil + dérive → explication → événements SSE
                                                    [4] trade enregistré avec un résumé du verdict
```

- **Miroir ne détient plus de portefeuille.** Boréal envoie le portefeuille *avant* l'ordre dans chaque requête
  (`portfolio: {cash, positions: [{ticker, value}]}`) ; `TradesService.metrics()` en déduit les poids.
- Le trade est déjà exécuté quand Miroir le reçoit : toute règle concernée compte comme outrepassée (pas de 409 côté Miroir).
- `externalId` (identifiant du trade chez Boréal) rend `POST /trades` idempotent.
- Miroir injoignable : `preview` renvoie `miroir.status = 'unavailable'`, l'ordre passe, le trade est marqué
  `miroir.status = 'unavailable'`. Un 4xx de Miroir (hors 401) remonte comme une erreur d'intégration.

## 4. Ce qui a changé par rapport à ta version (commit `fd8b9cf`)

**Déplacements** (historique git conservé) : `src/*` → `src/miroir/*` ; `src/market/market.service.ts` et
`src/storage/data-files.ts` → `src/shared/` ; `public/*` → `public/miroir/*` ; `dashboard.html/js` → `profile.html/js` ;
`dashboard-shared.js` → `investigation.js`.

**Supprimé de Miroir** : le portefeuille (`User.portfolio`), l'exécution fictive, `POST /api/trades`,
`POST /api/trades/check`, `GET /api/portfolio`, `GET /api/market/*`. Les trades n'entrent plus que par l'API partenaire.

**Ajouté** : `src/miroir/partner/*`, tout `src/bank/*`, `public/bank/*`, `src/shared/local-auth.ts`, `src/shared/env.ts`,
`GET /api/evaluation/:id` (reprise), `GET /api/health` sur les deux applications, événements `link.created`,
`link.revoked`, `rule.respected`.

**Bugs corrigés**
- Recharger la page pendant l'évaluation faisait tout recommencer → reprise là où on en était (`sessionStorage` + `GET /api/evaluation/:id`).
- On pouvait changer une réponse après avoir vu la révélation, puis la recalculer → réponses figées dès que la révélation existe ; `complete` est idempotent.
- La révélation suivait l'ordre d'arrivée des réponses, pas celui des situations : après un renvoi, les alias « Titre A… » pouvaient être décalés.
- Champ montant : `min="1" step="100"` rendait 5 000 ou 30 000 invalides pour le navigateur (le formulaire ne partait pas).
- Le pré-contrôle n'envoyait pas le temps de décision : la règle d'impulsivité se déclenchait à chaque ordre (« décision prise en 0 s »).
- Ordres à des dates qui reculaient : le portefeuille était valorisé à une date antérieure à certains achats (pertes ou gains absurdes) → l'horloge de marché simulée ne recule plus (`TradingService.validate`).
- `JsonStore` rendait ses objets internes : une requête qui échouait après avoir modifié le profil laissait la modification en mémoire → copie à la lecture et à l'écriture.
- Courriel d'inscription non nettoyé (espaces) alors que la recherche l'était ; `body` absent → erreur 500 sur `start` et `rules`.
- Chaîne d'attente trop longue pour CloudFront (nouvelles 30 s + deux appels Bedrock de 25 s > 60 s) : le navigateur recevait une erreur alors que le trade était exécuté → 20 s + 15 s + 15 s (`NEWS_TIMEOUT_MS`, `BEDROCK_TIMEOUT_MS`).
- Débordement horizontal sur mobile ; libellés bruts (`age : 45-59`) dans la vue admin.

## 5. Hypothèses à vérifier sur AWS (rien de ceci n'a été exécuté)

Ce qui a été vérifié : compilation, e2e local (modes `json` / `local` / `mock` / `template`), parcours complet au
navigateur, `cdk synth MiroirApp` avec le contexte en cache. Ce qui ne l'a pas été : tout appel réel à AWS, et GDELT
(bloqué par le réseau de l'environnement de travail).

| # | Hypothèse | Où | Comment vérifier |
| --- | --- | --- | --- |
| H1 | Une tâche Fargate à deux conteneurs (`miroir` :3000, `bank` :3001), deux écouteurs ALB (80, 8080), deux distributions CloudFront se déploie sans erreur | `infra/lib/app-stack.ts` | `./deploy.sh` ; les deux groupes cibles sont sains (`/api/health`) |
| H2 | Le conteneur par défaut renommé `miroir` ne casse pas la mise à jour du service existant | idem (`containerName`) | observer le déploiement ECS ; sinon détruire et recréer `MiroirApp` |
| H3 | Boréal joint Miroir par `http://localhost:3000` dans la même tâche (réseau `awsvpc`) | `MIROIR_API_URL` | ouvrir un compte Boréal lié, passer un ordre : statut « analysé » |
| H4 | `PARTNER_RETURN_ORIGINS` (= adresse CloudFront de Boréal) correspond exactement à l'origine vue par le navigateur ; `BANK_PUBLIC_URL` / `MIROIR_PUBLIC_URL` sans barre finale | `app-stack.ts`, `addEnvironment` | la redirection de liaison aboutit ; sinon « Adresse de retour inconnue » sur la page de connexion Miroir |
| H5 | Les 3 nouveaux secrets (`miroir/link-secret`, `miroir/partner-api-key`, `boreal/jwt-secret`) sont lisibles par le rôle d'exécution, et `PARTNER_API_KEY` a la même valeur dans les deux conteneurs | `app-stack.ts` | la tâche démarre ; l'échange du code ne répond pas 401 |
| H6 | `DynamoBankStore` fonctionne (jamais exécuté) : tables `boreal-accounts` (index `email-index`) et `boreal-trades` | `src/bank/dynamo.store.ts`, `data-stack.ts` | ouvrir un compte, se reconnecter, passer deux ordres, relire l'historique |
| H7 | Les utilisateurs déjà présents dans `miroir-users` (avec `portfolio`, sans `link`) restent lisibles | `publicUser`, `LinkService` (`user.link` absent = aucune liaison) | se connecter avec un ancien compte ; au besoin vider les tables |
| H8 | Durée totale d'un ordre sous les 60 s de CloudFront : pré-contrôle (≤ 8 s) + enquête (≤ 50 s côté Boréal ; nouvelles ≤ 20 s + 2 appels Bedrock ≤ 15 s côté Miroir) | `src/bank/config.ts`, `src/miroir/config.ts` | mesurer dans CloudWatch ; si Haiku dépasse 15 s, le résumé gabarit est gardé (comportement voulu) |
| H9 | Le parcours avec `NEWS_DRIVER=bedrock`, `INFLUENCE_DRIVER=bedrock`, `EXPLAINER_DRIVER=bedrock` fonctionne toujours : le code des agents n'a pas changé, mais il n'a été que compilé depuis le déplacement | `src/miroir/news`, `src/miroir/trades/agents` | un ordre NVDA au 2023-05-30 affiche de vraies manchettes dans le profil Miroir |
| H10 | Le corpus de nouvelles couvre les dates de démo dans leur **nouvel ordre** (l'horloge ne recule plus) : XBB.TO 2023-01-10, NVDA 2023-05-30, BTC-USD 2024-03-25, TSLA 2024-12-17, ETH-USD 2025-08-22 | `scripts/prefetch_news.mjs` (chemins `dist/miroir/…` mis à jour, non exécuté) | `npm run build && node scripts/prefetch_news.mjs` ; XBB.TO au 2023-01-10 n'est pas dans le corpus actuel |
| H11 | Mode Cognito : l'inscription Miroir en venant de Boréal, puis `POST /api/link/authorize` avec le jeton d'accès Cognito | `cognito-auth.service.ts` (inchangé) | parcours complet sur l'environnement déployé |
| H12 | Boréal lit les cours depuis S3 (`DATA_BUCKET`) avec le rôle de la tâche | `src/shared/data-files.ts` | journal « dataset/prices_daily.csv ← s3://… » dans le flux `boreal` |
| H13 | Le flux SSE de la vue admin passe toujours par la distribution Miroir | `admin.controller.ts` (inchangé) | la vue admin affiche les événements d'un ordre en direct |
| H14 | `scripts/e2e.mjs` contre AWS : `MIROIR_URL`, `BANK_URL`, `PARTNER_API_KEY` (secret), `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `scripts/e2e.mjs` | le test est vert ; il crée 3 comptes de test à supprimer ensuite |

## 6. Limites connues, par ordre d'intérêt

1. **Ordres non rattrapés** : un ordre passé pendant que Miroir est injoignable reste « non analysé ». Piste : file
   SQS entre Boréal et Miroir pour l'envoi après exécution (le pré-contrôle reste synchrone), ou un bouton de renvoi ;
   `externalId` rend déjà le renvoi sans danger.
2. **Écritures concurrentes** : deux ordres simultanés du même persona peuvent s'écraser (lecture, calcul, `Put` complet).
   Piste : numéro de version sur `User` et `ConditionExpression` dans `DynamoStore.saveUser`.
3. **Un seul rôle IAM** pour les deux conteneurs (même tâche). Deux services ECS sépareraient les droits : Boréal n'a
   besoin ni de Bedrock, ni de Cognito, ni des tables `miroir-*`.
4. **Un seul partenaire** : une clé d'API (`PARTNER_API_KEY`), un nom, une liste d'origines. Plusieurs courtiers
   demanderaient une table de partenaires. Le code persona n'expire pas ; le renouveler = refaire la liaison.
5. Aucune limitation de débit sur les connexions ni sur `trades/abandon` (annuler en boucle fait redescendre la dérive vers la référence, jamais en dessous).
6. Boréal n'a qu'une authentification locale (choix : c'est le partenaire de démonstration).
7. `.env` n'est pas chargé automatiquement : les variables doivent être exportées ou passées sur la ligne de commande.
8. Montants non convertis entre CAD et USD (`dataset/fx_usdcad_daily.csv` disponible).
9. Le score de dérive monte vite : 8 points par règle outrepassée, et un ordre peut en outrepasser plusieurs. Deux
   ordres risqués suffisent à exiger une réévaluation. C'est réglable dans `src/miroir/trades/drift.ts`.

## 7. Scénario de démonstration (≈ 4 minutes, deux fenêtres)

1. Fenêtre A : vue admin de Miroir. Fenêtre B : Boréal Courtage.
2. Boréal : ouvrir un compte « Robert », cliquer **Non merci**, passer un petit ordre : il s'exécute, colonne Miroir vide.
3. Boréal : **Activer Miroir** → compte Miroir → persona *Robert* → 5 situations → révélation → règles → retour automatique.
4. Boréal : acheter 30 000 $ de NVDA au **2023-05-30** → rappel des règles et avertissements → **Renoncer** (l'admin
   voit « règle respectée »), puis recommencer et **Passer outre** → analyse de Miroir, dérive en hausse.
5. Continuer en avançant la date : BTC-USD au **2024-03-25**, TSLA au **2024-12-17** → réévaluation exigée, ordres suspendus.
6. **Refaire l'évaluation chez Miroir** → retour automatique → dérive à 0, ordres de nouveau possibles.
7. Miroir, page de profil : ouvrir une enquête (étapes, sources, hypothèses, limites).

## 8. Définition de « terminé »

- [ ] `npm run test:e2e` vert en local, puis contre l'environnement déployé (H14).
- [ ] Chaque ligne H1–H14 cochée, ou corrigée avec une note dans ce fichier.
- [ ] Un ordre lié affiche au moins une vraie manchette sourcée dans l'enquête (ou dit clairement qu'il n'y en a pas).
- [ ] README à jour si une hypothèse a conduit à changer l'architecture.
- [ ] Livrables du défi : vidéo, documentation technique, one-pager, schéma d'architecture (celui du README est à jour).
