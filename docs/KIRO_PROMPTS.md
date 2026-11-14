# Prompts Kiro : la partie AWS d'AlphaForge Mirror

L'application fonctionne déjà en entier **en local** (voir `README.md`). Il reste à la porter sur AWS.
Chaque partie AWS a son prompt ci-dessous. Donne-les à Kiro **dans l'ordre**, un à la fois, et vérifie
les critères d'acceptation avant de passer au suivant.

## Ce que Kiro doit savoir avant de commencer

- Le cœur du système est dans `backend/mirror/`. Il ne dépend d'aucun service : il parle à des
  **ports** définis dans `backend/mirror/ports.py`.
- En local, les ports sont servis par `adapters_local.py` et `market.py`. Sur AWS, ils doivent être
  servis par `backend/mirror/adapters_aws.py`, qui contient aujourd'hui des classes vides.
- **Le travail de Kiro est d'implémenter ces adaptateurs et l'infrastructure, pas de réécrire le cœur.**

| Port (`ports.py`) | Local | AWS (à faire) | Prompt |
|---|---|---|---|
| `Repository` | `JsonRepository` | DynamoDB | 2 |
| `MarketData` | `CsvMarketData` | S3 + Glue + Athena | 3 |
| `TextModel` | `TemplateTextModel` (gabarits) | Bedrock + Guardrails | 4 |
| API web | FastAPI / uvicorn | API Gateway + Lambda + Cognito | 5 |
| `EventBus`, `WebhookSender` | `InProcessBus`, envoi direct | EventBridge + Step Functions + SQS | 6 |
| `NewsSource` | fichier de démonstration | EventBridge Scheduler + Lambda + S3 | 7 |
| Application web | servie par FastAPI | S3 + CloudFront | 8 |
| Observabilité, sécurité | — | CloudWatch, X-Ray, IAM, Secrets Manager | 9 |

### Prompt 0 — Fichiers de pilotage (à donner en premier)

```text
Lis en entier docs/BRIEF.md, README.md, docs/ASSUMPTIONS.md, backend/mirror/ports.py et
backend/mirror/service.py. Ce dépôt contient AlphaForge Mirror, une application déjà fonctionnelle
en local. Ta mission est uniquement de la porter sur AWS.

Crée les fichiers de pilotage .kiro/steering/product.md, tech.md et structure.md avec ces règles
permanentes :
1. Ne modifie pas la logique de backend/mirror/ (scoring.py, scenarios.py, simulation.py, reveal.py,
   rules.py, posttrade.py, service.py). Tu implémentes les ports de ports.py dans adapters_aws.py et
   tu ajoutes l'infrastructure dans infra/ (AWS CDK en Python).
2. Les 14 tests de backend/tests/ doivent toujours passer en local (python -m pytest backend/tests).
   Les tests propres à AWS vont dans backend/tests_aws/.
3. Le choix local ou AWS se fait par la variable d'environnement MIRROR_ENV (local | aws).
4. Tout est une simulation : aucune transaction réelle, aucune donnée personnelle réelle, aucun
   conseil financier. Les comptes sociaux liés restent fictifs.
5. Les scores, les contrefactuels, l'appariement des règles et la cause d'un trade sont calculés par
   le code. Un modèle Bedrock ne les décide jamais ; toute sortie de modèle repasse par les
   validateurs existants et, en cas de rejet, le système revient aux gabarits locaux.
6. Moindre privilège IAM, chiffrement au repos et en transit, aucun secret dans le code, une seule
   région, tarification à l'usage. Chaque service AWS doit avoir un rôle justifié dans
   docs/ARCHITECTURE.md ; n'ajoute aucun service sans raison.
7. Toute l'interface et toute la documentation sont en français.
Ne crée encore aucune ressource AWS.
```

### Prompt 1 — Socle CDK

```text
Crée le projet AWS CDK (Python) dans infra/ avec une pile « MirrorStack » paramétrée par un nom
d'environnement (dev par défaut). Pour l'instant elle contient seulement :
- un compartiment S3 de données (chiffré, accès public bloqué, versionné) ;
- une clé KMS gérée par AWS ou SSE-S3 (choisis le plus simple et justifie-le) ;
- les sorties CloudFormation utiles (noms et ARN).
Ajoute infra/README.md avec les commandes exactes : installation, cdk bootstrap, cdk deploy,
cdk destroy. Ajoute un flux d'intégration continue (GitHub Actions) qui lance
« python -m pytest backend/tests », « npm run build » dans frontend/ et « cdk synth ».
Critères d'acceptation : cdk synth réussit ; cdk deploy crée la pile ; cdk destroy la supprime
sans ressource orpheline ; les 14 tests locaux passent.
```

### Prompt 2 — DynamoDB (port `Repository`)

```text
Implémente DynamoRepository dans backend/mirror/adapters_aws.py. Il doit respecter exactement le
port Repository de ports.py (put, get, list avec préfixe, delete) et se comporter comme
JsonRepository de adapters_local.py.
- Une seule table, facturation à la demande, chiffrée, récupération à un instant donné activée.
  Clé de partition « pk » = nom de la table logique (users, sessions, profiles, profile_versions,
  rules, trades, investigations, evidence, reveals, guard_decisions, webhooks, webhook_deliveries,
  consent_log, rule_refusals, trade_index), clé de tri « sk » = la clé. list(table, prefix) devient
  une requête avec begins_with, paginée.
- Les nombres flottants doivent être convertis en Decimal à l'écriture et reconvertis à la lecture.
- Les éléments volumineux (sessions, reveals) peuvent dépasser 400 Ko : dans ce cas, stocke le
  contenu dans S3 et garde un pointeur dans DynamoDB, de façon transparente pour l'appelant.
- Ajoute un attribut de durée de vie (TTL) sur les signaux dérivés des comptes liés : les éléments
  de la table logique investigations expirent selon investigation.retention_days de la
  configuration (30 jours).
- Ajoute la table à la pile CDK et donne aux fonctions seulement les droits nécessaires.
Tests dans backend/tests_aws/test_repository.py : exécute contre DynamoDB la même suite que pour
JsonRepository (écriture, lecture, liste par préfixe, suppression, gros élément, flottants).
Critère d'acceptation : en remplaçant le dépôt local par DynamoRepository, tous les tests de
backend/tests/test_flow.py passent sans modification du cœur.
```

### Prompt 3 — S3, Glue et Athena (port `MarketData` et pipeline d'épisodes)

```text
1. Pipeline de données : charge les CSV de data/starter/ dans le compartiment S3 (préfixe raw/),
   convertis-les en Parquet (préfixe curated/), déclare les tables dans AWS Glue Data Catalog et
   crée un groupe de travail Athena avec un compartiment de résultats et une limite de volume
   analysé par requête.
2. Implémente AthenaMarketData dans adapters_aws.py avec exactement les méthodes de CsvMarketData
   (backend/mirror/market.py) : resolve, known, asset, context, path, fx_usdcad, to_cad.
   La règle de cohérence temporelle est obligatoire : pour un instant t, seules les séances
   strictement antérieures au jour de t sont utilisées. Charge les séries en mémoire au démarrage
   à froid de la fonction (les données sont petites) plutôt que d'interroger Athena à chaque appel.
3. Réécris le mineur d'épisodes reference/episode_miner.py en tâche reproductible (Lambda ou script
   lancé par Step Functions) qui lit les tables Athena, applique config/episodes.yaml et écrit
   episode_library.json dans S3. Il doit reproduire exactement les 73 épisodes de
   data/episode_library.json (même identifiants, mêmes valeurs).
4. Ajoute une requête Athena qui construit un épisode de portefeuille : mêmes dates pour 3 à 5
   actifs (brief, section 5.3). Documente-la, sans encore la brancher dans le Directeur.
Tests : backend/tests_aws/test_market.py compare AthenaMarketData.context et path à CsvMarketData
pour 10 actifs et 20 dates ; un test échoue si une donnée postérieure à t est utilisée ; un test
vérifie que la bibliothèque régénérée est identique au fichier fourni.
Documente dans docs/DATA.md les sources, dates, traitements, limites et licences (brief, section 6),
y compris l'anomalie CNQ.TO du 2022-08-22 et le biais du survivant.
```

### Prompt 4 — Amazon Bedrock et Guardrails (port `TextModel`)

```text
Implémente BedrockTextModel dans adapters_aws.py. Il respecte le port TextModel de ports.py et
utilise l'API Converse de Bedrock avec des sorties structurées (utilisation d'outils ou JSON validé
par schéma). Chaque méthode renvoie None en cas d'erreur, de dépassement de délai (8 secondes) ou de
sortie invalide : le cœur revient alors à ses gabarits. Vérifie d'abord dans la documentation AWS
quels modèles sont disponibles dans la région du compte et choisis un modèle rapide pour les textes
courts et un modèle plus capable pour choose_scenario ; mets les identifiants dans la configuration.

Les cinq méthodes et leurs contrats :
1. choose_scenario(state, candidates) : le Directeur de scénarios. Reçoit l'état (créneau, raison,
   couverture des traits, profil déclaré) et une liste de candidats. Renvoie
   {"episode_id": ..., "justification": ...}. L'identifiant doit appartenir aux candidats ; le code
   le vérifie déjà (backend/mirror/scenarios.py, Director.next_scenario).
2. write_trigger(spec, facts) : le Rédacteur de déclencheurs. Reçoit le gabarit local, la valence,
   l'intensité et les faits autorisés. Renvoie {"texte": ...}. Il ne doit citer aucun nombre absent
   des faits, aucun nom d'actif, aucune date, aucune personne réelle. Le texte repasse par
   validate_trigger ; s'il est rejeté, le gabarit local est utilisé.
3. explain(kind, dossier) : l'Agent d'explicabilité. Renvoie une liste
   [{"texte": ..., "evidence_ids": [...], "etiquette": "Réel|Hypothèse|Fictif"}] écrite uniquement à
   partir du dossier de preuves. Elle repasse par validate_sentences (backend/mirror/reveal.py).
   Pour le type « profil », chaque phrase garde le champ "trait".
4. parse_rule(text, weakness) : traduit la règle écrite par l'utilisateur en structure
   {"ok": true, "trigger": {"all": [...]}, "action": {...}} ou {"ok": false, "question": ...}.
   INTERDICTION ABSOLUE de proposer, compléter ou améliorer le contenu de la règle : la traduction
   ne contient que ce que l'utilisateur a écrit, et la question de clarification ne suggère aucune
   valeur. La structure doit passer rules.valid_structure.
5. classify_relevance(item, symbol, asset) : renvoie un nombre entre 0 et 1 indiquant si une
   nouvelle ou une publication concerne l'actif. Le code plafonne ce score et la correspondance
   exacte du symbole prime. Le modèle n'attribue jamais la cause d'un trade.

Crée un garde-fou Amazon Bedrock Guardrails appliqué à write_trigger et explain : pas de conseil
financier personnalisé, pas de promesse de rendement, pas de nom de personne réelle, filtres de
contenu. Journalise pour chaque appel : composant, identifiant du modèle, entrées, sortie, durée,
résultat du validateur. N'enregistre jamais de raisonnement interne du modèle.

Tests dans backend/tests_aws/test_bedrock.py : chaque méthode respecte son schéma ; un texte de
déclencheur contenant un nombre inventé est rejeté et remplacé par le gabarit ; parse_rule sur
« je veux être plus prudent » renvoie une question sans aucun chiffre ; avec Bedrock coupé, le
parcours complet fonctionne encore.
Critère d'acceptation : avec MIRROR_ENV=aws, deux sessions du même persona donnent des scénarios et
des textes différents, et 100 % des phrases affichées passent validate_sentences.
```

### Prompt 5 — API Gateway, Lambda et Cognito (API web et API d'intégration)

```text
Expose l'application backend/mirror/api.py (FastAPI) derrière Amazon API Gateway et AWS Lambda.
- Emballe FastAPI dans Lambda avec un adaptateur ASGI (par exemple Mangum) ou l'adaptateur web
  Lambda ; garde les routes et les schémas identiques à ceux de api.py.
- Implémente build_aws_service() dans adapters_aws.py : il assemble MirrorService avec
  DynamoRepository, AthenaMarketData, BedrockTextModel, EventBridgeBus, S3NewsSource,
  SyntheticSocialSource (inchangé, lu depuis S3) et LambdaWebhookSender, à partir de variables
  d'environnement.
- Routes /api/* : application web, protégées par Amazon Cognito (groupe d'utilisateurs avec des
  comptes de démonstration). L'identifiant du profil doit être lié à l'utilisateur connecté : un
  utilisateur ne peut lire que son propre profil.
- Routes /v1/* : API d'intégration pour la plateforme hôte, protégées par authentification de
  machine à machine (flux client credentials de Cognito, ou clés d'API avec plan d'utilisation).
  Ajoute la limitation de débit et la validation de schéma des requêtes dans API Gateway.
- POST /v1/trade-events doit répondre 202 en moins de 2 secondes : il valide, applique
  l'idempotence sur event_id, publie l'événement et rend la main (le traitement vient au prompt 6).
- Génère docs/openapi.yaml à partir de l'application et vérifie-le dans l'intégration continue.
Tests dans backend/tests_aws/test_api.py : appel sans jeton refusé (401) ; accès au profil d'un
autre utilisateur refusé (403) ; doublon d'event_id renvoie « duplicate » ; événement invalide
refusé (422) ; débit limité au-delà du plan.
```

### Prompt 6 — EventBridge, Step Functions et SQS (pipeline après trade, réévaluation, webhooks)

```text
Implémente EventBridgeBus et LambdaWebhookSender dans adapters_aws.py, puis l'orchestration :
1. Pipeline après trade. L'événement « trade.received » publié sur un bus EventBridge dédié
   déclenche une machine d'états AWS Step Functions dont chaque étape est visible :
   enrichir le contexte -> apparier les règles -> enquête automatique -> sévérité -> mise à jour de
   l'indice de dérive, des traits et du seuil personnel -> nouvelle version du profil -> webhooks.
   La logique existe déjà dans MirrorService._process_trade (backend/mirror/service.py) : découpe-la
   en étapes en appelant les mêmes fonctions (posttrade.objective_indicators, rules.match_rules,
   posttrade.investigate, posttrade.severity, posttrade.update_drift), sans changer les calculs.
   Ajoute des reprises avec attente croissante et une file de rebut SQS pour les échecs.
   Les événements d'un même utilisateur doivent être traités un par un (file FIFO par utilisateur
   ou verrou) et rejoués dans l'ordre de executed_at, comme le fait _replay_drift.
2. Webhooks sortants (investigation.completed, profile.updated, reevaluation.required) : livraison
   par une fonction dédiée, signature HMAC-SHA256 dans l'en-tête X-Mirror-Signature avec un secret
   stocké dans AWS Secrets Manager, nouvelles tentatives, file de rebut, journal des livraisons
   dans la table logique webhook_deliveries.
3. Génération de scénarios à l'avance. Pendant que l'utilisateur décide, une machine d'états
   prépare et valide le scénario suivant (génère -> valide -> met en réserve). Si la génération
   dépasse 8 secondes ou échoue, le Directeur local (politique déterministe déjà présente) fournit
   le scénario : la démonstration ne doit jamais attendre Bedrock.
4. Réévaluation. Quand l'état de dérive passe en alerte, publie « reevaluation.required » ; la
   session ciblée (mode « cible ») et la remise à niveau du seuil existent déjà dans le cœur.
Tests dans backend/tests_aws/test_pipeline.py : un trade envoyé produit une exécution réussie et
une nouvelle version de profil ; deux événements arrivés dans le désordre donnent le même indice
que dans l'ordre ; un webhook vers une URL en panne finit dans la file de rebut ; la signature
reçue par un récepteur de test est valide.
```

### Prompt 7 — Ingestion de nouvelles publiques (port `NewsSource`)

```text
Implémente S3NewsSource dans adapters_aws.py (port NewsSource : items(start_iso, end_iso)) et son
ingestion planifiée : EventBridge Scheduler -> Lambda -> S3 (un fichier JSON Lines par jour).
- Évalue d'abord les sources possibles et écris ton choix dans docs/DATA.md avec licence,
  couverture et délai : jeu de données ouvert GDELT (vérifie s'il est disponible dans le registre
  AWS Open Data pour la période voulue), flux RSS publics de médias, ou une API de nouvelles sous
  licence. Ne choisis qu'une source dont les conditions autorisent cet usage.
- Ne conserve que les métadonnées : titre, média, date et heure de publication, URL, symboles ou
  secteur détectés, importance. Jamais le texte complet des articles.
- Distingue la date de publication de la date de collecte. Seules les nouvelles publiées avant le
  trade sont renvoyées par items.
- Le format de chaque élément est celui de data/demo/news_demo.json.
- Les nouvelles réelles portent l'étiquette « Externe, non vérifiée ». Le fichier de démonstration
  reste disponible et étiqueté « Fictif (démonstration) ».
- N'active aucun connecteur vers de vrais comptes de réseaux sociaux : la source sociale reste le
  jeu synthétique (scripts/generate_synthetic_social.py). Décris seulement, dans
  docs/ARCHITECTURE.md, l'interface d'un futur connecteur OAuth officiel et ses conditions
  (consentement par compte, révocation, minimisation, suppression).
Tests : aucune nouvelle postérieure à la borne de fin n'est renvoyée ; un article sans date de
publication est écarté ; la taille stockée par article reste sous 2 Ko.
```

### Prompt 8 — Hébergement de l'application web (S3 et CloudFront)

```text
Héberge frontend/ (React, Vite) sur Amazon S3 derrière Amazon CloudFront :
- compartiment privé, accès par contrôle d'accès d'origine, HTTPS obligatoire, en-têtes de
  sécurité, redirection des erreurs 403 et 404 vers index.html ;
- CloudFront route /api/* et /v1/* vers API Gateway pour garder la même origine ;
- connexion par Cognito (interface hébergée) : ajoute au frontend l'écran de connexion et l'envoi
  du jeton dans frontend/src/lib.tsx (fonction api), sans changer les écrans existants ;
- la clé « dev-host-key » de la console de l'hôte est remplacée par un jeton de machine à machine
  obtenu côté serveur : la console de test ne doit contenir aucun secret dans le navigateur ;
- commande de déploiement unique documentée dans infra/README.md (construction puis synchronisation
  puis invalidation du cache).
Test de bout en bout (Playwright) contre l'URL CloudFront : parcours complet d'Amira en mode court
(simulation, révélation à la fin seulement, profil, une règle écrite) puis un trade envoyé depuis
la console de l'hôte qui met à jour le tableau de bord.
```

### Prompt 9 — Observabilité, sécurité et coûts

```text
Termine la mise en production de démonstration :
- Amazon CloudWatch : journaux structurés en JSON, un tableau de bord (trades reçus, durée du
  pipeline, taux de rejet des validateurs, taux de repli de Bedrock vers les gabarits, erreurs),
  alarmes sur la file de rebut et sur les erreurs 5xx ; AWS X-Ray sur le pipeline après trade.
- Revue IAM : un rôle par fonction, aucune étoile sur les ressources, accès Bedrock limité aux
  modèles utilisés, accès S3 limité aux préfixes utiles.
- Secrets dans AWS Secrets Manager, rotation décrite.
- Budget AWS avec alerte, et une estimation de coût pour 1 000 sessions et 10 000 trades par mois
  dans docs/ARCHITECTURE.md.
- Écris docs/ARCHITECTURE.md en français : un schéma (Mermaid), le rôle concret de chaque service
  AWS dans le flux, ce qui se passe si Bedrock est indisponible, et les bonnes pratiques
  appliquées (sécurité, données, ressources).
Critère d'acceptation : chaque service AWS de la pile a une phrase qui répond à « pourquoi
existe-t-il et quelle valeur apporte-t-il ? ». Supprime tout service qui n'en a pas.
```

### Prompt 10 — Validation et livrables du datathon

```text
1. Personas synthétiques à vérité connue (brief, section 18) : écris scripts/validate.py qui joue
   au moins 200 utilisateurs simulés aux traits connus (seuil de vente, taux de suivi des messages
   sociaux, vitesse de décision) à travers l'API, puis mesure l'erreur de récupération de chaque
   trait, la couverture des intervalles à 80 %, la stabilité entre deux sessions, la sensibilité
   aux seuils de config/, et, pour l'enquête, la précision, le rappel, la calibration de la
   confiance et le taux de faux positifs sur des trades à cause connue. Écris les résultats dans
   docs/VALIDATION.md avec des tableaux et les limites constatées. Si un résultat est mauvais,
   écris-le tel quel et propose un réglage de config/ ; ne modifie pas les formules sans le signaler.
2. Complète le README (déploiement AWS, reproduction), la documentation technique
   (docs/DOCUMENTATION_TECHNIQUE.md : méthodes, sources, traitements, hypothèses, mécanisme
   d'explicabilité avec un exemple qui relie une conclusion à ses preuves, validations, limites,
   améliorations) et le one-pager (docs/ONE_PAGER.md, une page).
3. Prépare le script de la vidéo de 5 minutes (docs/DEMO.md) à partir de la section 20 du brief :
   Amira en simulation courte, révélation à la fin, profil, pacte ; puis Robert et la console de
   l'hôte : rappel de sa règle, trade envoyé, enquête automatique, indice de dérive, alerte de
   réévaluation. Indique pour chaque moment le service AWS à montrer à l'écran.
```
