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

## 5. Vérification sur AWS (faite le 2026-11-15, compte 025066237985, us-east-1)

Déployé avec `./deploy.sh` (image en ligne : `e91ec23`, étiquette = commit) ; `npm run test:e2e` **vert contre l'environnement déployé**
(`MIROIR_URL`, `BANK_URL`, `PARTNER_API_KEY`, `ADMIN_PASSWORD` lus dans Secrets Manager). Miroir :
`https://d282er2gpi2tj4.cloudfront.net` · Boréal : `https://ds5dvhgpln5xx.cloudfront.net`.

| # | Résultat | Preuve |
| --- | --- | --- |
| H1 | **Corrigée.** Le déploiement échouait d'avance : la liste de préfixes CloudFront pèse 55 règles et un groupe de sécurité en accepte 60, or le code en posait deux sur le groupe de l'ALB (ports 80 et 8080). Le port 8080 a maintenant son propre groupe de sécurité, attaché au même ALB. Ensuite : déploiement sans erreur, les deux groupes cibles sont sains sur `/api/health`. | `infra/lib/app-stack.ts`, `describe-target-health` |
| H2 | **OK.** Renommer `web` en `miroir` et ajouter un second groupe cible se met à jour sans interruption : le service existant a été mis à jour, sans destruction de la pile. | `UPDATE_COMPLETE`, 1 tâche, 0 échec |
| H3 | **OK.** Boréal joint Miroir par `localhost:3000` : les ordres liés sont analysés. | trades `miroir-trades` avec enquête, e2e |
| H4 | **OK.** `/api/link/partner` accepte l'origine Boréal et refuse une origine inconnue ; la liaison complète passe dans l'e2e. | requêtes `curl` |
| H5 | **OK.** Les 3 secrets existent et la tâche démarre ; une mauvaise clé partenaire donne « Clé partenaire invalide », la bonne arrive à la vérification du code. | `list-secrets`, `curl` |
| H6 | **OK.** `DynamoBankStore` fonctionne : comptes, ordres, reconnexion et historique relus. Tables `boreal-accounts` (index `email-index`) et `boreal-trades`. | `scan` : 2 comptes, 6 ordres |
| H7 | **OK.** Un ancien compte (avec `portfolio`, sans `link`) se connecte, `/api/me` et `/api/trades` répondent 200. Le champ `portfolio` hérité est encore renvoyé par `/api/me` (inoffensif, inutilisé). | login d'un compte de l'ancienne version |
| H8 | **OK.** L'e2e complet (4 ordres analysés avec Bedrock) passe en 45 s ; chaque appel Bedrock dure 1 à 2,6 s. Aucune erreur 502/504 de CloudFront. | journaux CloudWatch |
| H9 | **OK.** Avec `NEWS_DRIVER`, `INFLUENCE_DRIVER` et `EXPLAINER_DRIVER` = `bedrock`, NVDA au 2023-05-30 affiche 5 manchettes réelles (liens), un verdict et un résumé rédigé par IA. **Défaut corrigé** : l'agent d'influence écrivait un délai inventé (« 3-4 jours après ») ; `inventedDurations` (`src/miroir/ai/guards.ts`) rejette désormais toute durée absente des faits, pour l'agent d'influence et l'explicateur. L'agent d'influence qualifiait aussi une décision de 60 s de « rapide » ; la règle « ne jamais qualifier une durée de décision » (déjà présente chez l'explicateur) est maintenant dans son prompt, dans la consigne générale et dans la description du champ `rationale` (la consigne générale seule n'était pas suivie). **Constat** : le modèle continue d'écrire des délais (« 4 jours après ») malgré la consigne ; le code le relance une fois (voir la section 6, point 0). | table `miroir-trades`, `node -e` sur le garde-fou |
| H10 | **Corrigée.** XBB.TO au 2023-01-10 et ETH-USD au 2025-08-22 manquaient au corpus (GDELT répondait 429, repli sur des signaux simulés). Préchargés (5 nouvelles réelles chacun), commités et envoyés dans S3. Les 5 dates de démo sont couvertes. | `scripts/prefetch_news.mjs`, `data/news/` |
| H11 | **OK.** Mode Cognito : inscription, connexion, groupe `admin` (l'admin a le rôle `admin`), liaison et autorisation passent dans l'e2e. | e2e, `/api/me` |
| H12 | **OK.** Les deux conteneurs lisent `dataset/prices_daily.csv` depuis S3 avec le rôle de la tâche. | journal « ← s3://miroir-data-025066237985/… » |
| H13 | **OK.** Le flux SSE passe par la distribution Miroir (`text/event-stream`, 200) ; l'e2e reçoit 20 événements. | `curl`, e2e |
| H14 | **OK.** `scripts/e2e.mjs` vert contre AWS. Il crée des comptes de test dans Cognito et DynamoDB (voir ci-dessous). | e2e |

**Autres constats**
- L'ALB n'est pas joignable directement (ports 80 et 8080 fermés hors CloudFront).
- `data/bank-db.json` (comptes de test locaux) n'était exclu ni de l'envoi vers S3, ni de l'archive CodeBuild : corrigé dans `data-stack.ts` et `build-stack.ts`.
- Les comptes de test (`@test.local`) laissés par les e2e ont été supprimés de Cognito et de DynamoDB (comptes, ordres, évaluations). Restent `admin@miroir.local` et `zkr@faudrasyfaire.com`. Chaque e2e en recrée : à nettoyer avant la démo finale.
- GDELT limite le débit depuis ces adresses (429) : un ordre à une date absente du corpus retombe sur des signaux simulés (étiquetés). Les dates de la démo sont toutes dans le corpus.

## 6. Limites connues, par ordre d'intérêt
0. **Agent d'influence : relance unique, devenue rare (≈ 4 %).** Quand la phrase du modèle viole le garde-fou (chiffre ou délai absent des faits), `retryRationale` le relance une fois en nommant la violation ; seule la nouvelle phrase est reprise, et seulement si elle passe le même garde-fou. Si elle échoue aussi, plante ou manque de temps (la relance partage le budget de 15 s du 1er appel), la liste « Appuyé sur : F1, N1… » est affichée : une phrase fautive n'est jamais montrée.
   **Cause racine de la relance quasi systématique** (mesurée sur le vrai modèle, 74 à 111 essais par variante, 37 situations réelles du corpus × 2 à 3 durées de décision) : le taux était de **66 %**, et ce n'était pas un biais du modèle. (1) **31 des 49 relances** venaient du garde-fou lui-même : le prompt donnait les dates des nouvelles au modèle, mais pas au garde-fou, qui rejetait « nouvelles du 15 juillet » comme chiffre inventé (24 % après correction). (2) Le reste venait des délais que le modèle calculait en voyant la date de chaque nouvelle à côté de celle du trade. **Retirer les dates de nouvelles du prompt** (elles restent affichées à l'utilisateur) : **4 % de relance**, sans effet sur les qualificatifs de durée.
   **Pistes essayées et écartées** (même banc de mesure) : en-tête neutre (36 %, pire) ; règle en tête du prompt (24 %, inchangé) ; retirer la règle « aucun délai » ou son exemple (≈ 42 %, pire) ; rappel en fin de prompt (2 %) et contre-exemple « mauvais/bon » (4 %), qui réduisent la relance mais multiplient par 3 à 5 les « décision rapide » non fondés. Test isolé (30 paires de dates, sans le reste du prompt) : Haiku n'écrit aucun écart sans consigne (0/30) ; le défaut vient donc des données qu'on lui donne, pas d'un penchant du modèle.
   **Reste (≈ 4 %)** : durées citées par les titres de manchettes (« sommets de 6 mois »), que le garde-fou rejette par prudence et que la relance corrige. Non assoupli volontairement : accepter un chiffre « qui ressemble » à un autre est le risque que le garde-fou couvre.
   **Règle à retenir** : toute donnée donnée au modèle doit aussi être dans `factsText`, sinon le garde-fou la juge « inventée ».
   **Garde-fou lexical des qualificatifs** (`inventedQualifiers`, `src/miroir/ai/guards.ts`) : une phrase qui contient « rapide », « précipitée », « instantané », « immédiatement », « réfléchie »… (variantes d'accord et d'adverbe) absents des faits est traitée comme une violation : même relance unique que pour les chiffres et les délais, qui nomme le mot (« elle utilise le mot « rapide » alors que rien dans les faits fournis ne qualifie la vitesse de la décision »), même repli sur la liste de références. Aucune formulation du prompt n'a été modifiée. Mesure sur le vrai modèle : avant, 3 cas sur 111 laissaient passer « rapide » jusqu'à l'affichage ; après, **0 sur 185** essais réels (9 premières phrases fautives, toutes corrigées), et 0 sur 74 relances forcées (73 phrases propres, 1 repli sur les références). Relance : 8,6 % (contre 3,6 %), donc un appel Bedrock de plus dans 1 ordre sur 12.
   **Limites assumées de ce garde-fou** : (1) un mot déjà présent dans les faits n'est pas rejeté, donc si un titre de manchette contenait « rapide » (les titres du corpus sont en anglais, ce qui est rare), le modèle pourrait l'utiliser pour qualifier la décision sans être arrêté ; (2) la liste est lexicale : une formulation hors liste passe (« décision brève ») ; sur les 185 essais, aucune n'est apparue, mais ce n'est pas garanti ; (3) les expressions de proximité entre une nouvelle et le trade (« peu après », « récentes ») ne sont pas ciblées : « récent » est légitime pour un mouvement de prix calculé (« hausse récente de 49 % »), et les rejeter ferait des faux positifs. « impulsif » est exclu parce que `impulsivity` est un paramètre du profil présent dans les faits.
   **Tests** : `npm run build && npm run test:unit` (`scripts/test-influence.mjs`, 55 contrôles, faux client Bedrock, sans AWS). Les 8 cas « délai / chiffre / relance » existaient seulement dans un script temporaire supprimé : ils sont désormais dans le dépôt, avec les cas des qualificatifs.
   Explicateur : jamais rejeté en production (aucun repli sur le gabarit dans les journaux) ; sa tâche ne demande pas de situer des nouvelles.

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

- [x] `npm run test:e2e` vert en local, puis contre l'environnement déployé (H14).
- [x] Chaque ligne H1–H14 cochée, ou corrigée avec une note dans ce fichier (section 5).
- [x] Un ordre lié affiche au moins une vraie manchette sourcée dans l'enquête (NVDA 2023-05-30 : 5 manchettes avec lien).
- [x] README à jour si une hypothèse a conduit à changer l'architecture.
- [ ] Livrables du défi : vidéo, documentation technique, one-pager, schéma d'architecture (celui du README est à jour).
