# ALPHAFORGE MIRROR — Brief de réalisation pour Kiro

> **Nom de travail :** AlphaForge Mirror — « Découvre l'investisseur que tu es vraiment ».
> **Contexte :** Datathon 2026 PolyFinances × Banque Nationale × AWS — défi « AlphaForge AI ».
> **Langue de l'application :** français uniquement. **Plateforme :** application web (bureau), pas de mobile.
> **Public de ce document :** l'IA Kiro, qui doit construire le projet complet. Lis tout le document avant d'écrire du code.

> **État du projet (14 novembre 2026).** L'application décrite ici existe déjà et fonctionne en local
> (voir `README.md`). La section 0 ci-dessous est remplacée par `docs/KIRO_PROMPTS.md` : Kiro ne construit
> plus le projet entier, il le porte sur AWS, prompt par prompt. Les écarts entre ce brief et le code
> sont listés dans `docs/ASSUMPTIONS.md`.

---

## 0. Comment utiliser ce document (instructions pour Kiro)

1. Crée les fichiers de pilotage (steering) `.kiro/steering/product.md`, `tech.md`, `structure.md` à partir des sections 1, 2, 12 et 13.
2. Crée une spec par domaine (section 17 pour la découpe) avec `requirements.md` (critères d'acceptation en format EARS, sections 16 et 18 comme base), `design.md` (sections 3 à 15) et `tasks.md` (section 17).
3. Les données fournies se trouvent dans `data/starter/` (les CSV du jeu de départ de l'organisation) et la bibliothèque d'épisodes dans `data/episode_library.json` (section 5). Le script de référence `reference/episode_miner.py` montre comment la bibliothèque a été produite ; réimplémente-le proprement dans le pipeline de données.
4. **Priorité absolue : un parcours complet qui fonctionne de bout en bout** (sections 3 et 19), puis la qualité, puis les extras. Ne multiplie pas les services AWS ni les agents sans raison : chaque composant doit pouvoir répondre à « pourquoi existe-t-il et quelle valeur apporte-t-il ? ».
5. Tous les seuils, poids et paramètres numériques de ce document sont des **valeurs initiales** à placer dans des fichiers de configuration (`config/*.yaml`) et à calibrer avec les personas synthétiques (section 18).
6. Si une information manque, prends l'hypothèse la plus simple, note-la dans `docs/ASSUMPTIONS.md` et continue. Ne t'arrête pas pour poser des questions.

---

## 1. Vision et proposition de valeur

### Le problème
Les institutions financières évaluent leurs clients avec un **questionnaire déclaratif** (profil d'investisseur). Or ce que les gens *disent* de leur tolérance au risque ne correspond pas à ce qu'ils *font* quand le portefeuille perd 30 % ou quand un influenceur leur parle d'une action « qui explose ». Le résultat : des profils faux, des ventes à la panique, des achats sous l'effet du hype, et des clients mal servis.

### La solution
AlphaForge Mirror mesure le **comportement réel** d'un investisseur, l'oppose à ce qu'il **pense être**, puis l'**accompagne dans la durée** :

1. **Profil déclaré** : l'investisseur dit qui il croit être (risque, horizon, préférences, impulsivité).
2. **Simulation** : il traverse des situations de marché **réelles mais masquées** (tirées de 5 ans de vraies données), où un agent d'IA décide des **déclencheurs** (notification, tweet d'une personnalité, message d'un proche, nouvelle, pression de temps…) qui testent chaque facette de son profil. Il choisit : **tenir, vendre ou renforcer**. Le système capte tout : décision, temps de réponse, déclencheur présent, contexte.
3. **Révélation, une seule fois, à la fin de toutes les simulations** : les masques tombent (« Actif A, c'était Tesla, janvier 2022 »). On lui montre ce qui s'est réellement passé et ce qu'auraient donné ses autres choix.
4. **Profil révélé** : l'écart entre ce qu'il pense être et ce qu'il est, chaque chiffre étant cliquable vers sa preuve.
5. **Pacte** : pour chaque faiblesse détectée, il écrit une **règle personnelle** que le système conserve.
6. **Branchement comme outil externe** : le système **ne gère aucun compte, aucun ordre et aucune application de trading**. Une plateforme de trading (l'**hôte**) l'appelle : elle lui envoie l'utilisateur, le moment du trade, le montant et l'information sur le trade. Facultativement, **avant** le trade, l'hôte peut demander une vérification : si la situation ressemble à une situation évaluée où l'utilisateur a établi une règle, le système renvoie un **rappel de sa propre règle**.
7. **Enquête automatique après chaque trade + indice de dérive** : à chaque trade reçu, **le système mène lui-même l'enquête** (sans poser de question à l'utilisateur) : nouvelles publiques et presse, comptes liés au profil **avec son consentement**, historique de ses trades et signaux de marché. Il en déduit une **cause probable avec un niveau de confiance et des preuves**. Si la cause est négative (hype, influence sociale, impulsion, règle ignorée…), il met à jour le profil, augmente un **indice de dérive** et ajuste le **seuil de réévaluation personnel** de l'utilisateur. Au-delà de ce seuil, une **alerte de réévaluation** déclenche une nouvelle simulation ciblée, et les règles sont ajoutées ou resserrées par l'utilisateur. La boucle continue indéfiniment.

### Pourquoi ça peut gagner
- **Originalité** : aucune autre approche probable ne mesure l'écart déclaré/observé et ne ferme la boucle jusqu'au comportement réel.
- **Les 3 personas deviennent des tests naturels** : Amira (« risque élevé ≠ tout accepter »), Mateo (valeurs ESG face à un pétrole qui s'envole), Robert (tenté par une action médiatisée : le système le met en garde au lieu d'acquiescer).
- **Auto-explicabilité par construction** : chaque conclusion est reliée à des décisions observées et à des données.
- **Cas d'affaires** pour une institution : vérification de l'adéquation du produit au client (KYC comportemental), moins de ventes à la panique, meilleure rétention, trace d'audit.

---

## 2. Contraintes non négociables du datathon

| Contrainte | Conséquence dans le produit |
|---|---|
| **Simulation uniquement** : aucune transaction réelle, aucun conseil financier personnalisé | Bandeau permanent « SIMULATION — ne constitue pas un conseil financier ». Le système **ne passe, ne route, ne bloque et ne modifie aucun ordre** : il reçoit des événements de trade et rappelle des règles, sans jamais dicter. Dans la démonstration, les événements viennent d'une **console de test** avec des données fictives. |
| Aucune donnée bancaire ou client réelle | Profils et événements de trade entièrement fictifs. L'API n'accepte qu'un **identifiant pseudonyme** fourni par l'hôte : aucun nom, aucun numéro de compte, aucune donnée bancaire. Dans la démonstration, les **comptes sociaux liés sont fictifs** (jeu de données synthétique) ; aucun compte réel de personne n'est lu. |
| Distinguer **faits, hypothèses, scénarios fictifs** | Chaque écran étiquette : **Donnée réelle** (prix, taux, inflation), **Hypothèse** (seuils, modèles), **Fictif** (tweets, messages, nouvelles simulées, portefeuille de départ). |
| Présenter les **incertitudes** | Chaque score affiche un intervalle et un **indice de confiance**. Si les données ne permettent pas de conclure, le système le dit. |
| Explications **synthétiques, vérifiables, fidèles** ; ne pas inventer de justification ; ne pas exposer le raisonnement interne détaillé des modèles | Journal de preuves (section 12). L'explication cite des preuves, pas la « chaîne de pensée » du modèle. |
| **Cohérence temporelle** : ne pas utiliser une information non encore publique | Les données macro mensuelles sont décalées par un délai de publication (section 6). Aucune donnée postérieure au point de décision n'est visible. |
| **Pas de prédiction de rendement futur** | Le système ne prédit rien. Il décrit des comportements passés et des scénarios rejoués. |
| **AWS = condition d'admissibilité** (intégration réelle, démontrable) | Amazon Bedrock est indispensable au fonctionnement (agents), S3/Athena/DynamoDB/Lambda/Step Functions portent le flux. Voir section 13. |
| Documenter sources, dates, traitements, licences | Voir section 6 et le livrable documentation. |

### Grille d'évaluation et où le projet la couvre

| Critère | Poids | Où on le gagne |
|---|---|---|
| Solution (pertinence, innovation, créativité, prototype) | 20 % | Section 1 (idée), parcours complet démontrable (section 3) |
| Agentique (architecture, explicabilité) | 20 % | Section 4 (agents avec rôle clair), section 12 (explicabilité) |
| Données (rigueur, validation, visualisation) | 20 % | Sections 5, 6, 18 (bibliothèque réelle, point-in-time, validation par personas synthétiques), visualisations du profil |
| UX/UI | 10 % | Section 14 (écrans clairs, une décision à la fois) |
| AWS (qualité de l'intégration) | 15 % | Section 13 (rôle concret de chaque service) |
| Pitch (présentation, business, marketing) | 15 % | Section 20 (récit de démo, cas d'affaires) |

---

## 3. Parcours utilisateur de bout en bout

### Phase A — Profil déclaré (≈ 30 s)
- L'utilisateur choisit **Amira**, **Mateo**, **Robert** (préremplis, voir section 11) ou **crée un profil**.
- Champs : tolérance au risque (faible → très élevée), horizon (années), objectif, préférences (ESG, exclusions de secteurs, intérêt pour les cryptos), expérience, **auto-évaluation** sur 5 énoncés (« je reste calme pendant les baisses », « je résiste aux modes », « je prends mes décisions rapidement », etc., échelle 1 à 5).
- **Étape facultative « Sources liées »** : l'utilisateur peut consentir à lier des comptes (réseaux sociaux ou professionnels) pour que l'enquête automatique des trades (section 15.1) puisse s'en servir. Consentement **explicite, par compte, révocable**, consigné ; dans la démonstration, les comptes liés sont **fictifs** (section 6).
- Le système crée un portefeuille de départ fictif de **100 000 $** conforme au profil (table d'allocation déterministe, section 11).

### Phase B — Simulation (≈ 10 à 12 minutes en mode complet ; 3 minutes en mode démo)
- Le temps avance par **arrêts mensuels** (checkpoints). À chaque arrêt l'utilisateur voit :
  - la valeur de son portefeuille et de la position concernée (« −23 400 $ depuis le début ») ;
  - le **contexte réel de l'époque** : taux directeur, inflation publiée à cette date, rendements obligataires (valeurs réelles, dates masquées) ;
  - un graphique de l'actif **rebasé** (indice 100 au début, sans dates ni noms) ;
  - **éventuellement un déclencheur** choisi par l'IA (notification, tweet, message d'un proche, nouvelle…) ;
  - **trois boutons** : **Tenir**, **Vendre** (liquide la position concernée), **Renforcer** (ajoute 25 % de la valeur actuelle de la position, depuis les liquidités).
- Le système capture : décision, **temps de réponse**, condition (déclencheur présent ou absent), contexte, ordre dans la session, hésitations (changements de survol/sélection avant validation).
- Mode complet : **8 scénarios × 2 à 3 arrêts décisionnels ≈ 20 décisions**. Chaque trait mesuré reçoit au moins 3 décisions. Mode démo : 4 scénarios, environ 8 décisions.
- Un scénario n'est **jamais répété** pour un même utilisateur (même actif et même fenêtre).
- **Aucun retour d'information pendant la session** : pas de révélation, pas de résultat final. Après **Vendre**, le scénario se termine pour l'utilisateur **sans montrer la suite du marché** (elle n'apparaît qu'à la révélation finale) ; après **Tenir** ou **Renforcer**, le scénario continue jusqu'à l'arrêt suivant. Les pages du compte ou du profil ne sont pas accessibles pendant la session.

### Phase C — Révélation (une seule fois, après la dernière décision de la dernière simulation)
- **Règle centrale : aucune révélation pendant la session.** Tant que toutes les simulations ne sont pas terminées, l'utilisateur ne voit ni identité d'actif, ni date, ni résultat final, ni ce qu'auraient donné ses autres choix, ni aucun indice de son profil. Cela évite qu'il apprenne d'un scénario à l'autre et fausse la mesure.
- L'écran de révélation présente ensuite **tous les scénarios joués, un par un dans l'ordre** (carrousel ou liste déroulante), puis enchaîne sur le profil révélé (phase D).
- Les masques tombent : actif réel, époque réelle, **tweets/messages révélés comme simulés**.
- Graphique superposé de trois trajectoires de valeur : **ce que tu as fait**, **tenir jusqu'au bout**, **suivre ton profil déclaré** (politique déterministe, section 8). Indicateurs : gain/perte, pire baisse, temps de récupération, stabilisation, rendement sur 12 mois après la fenêtre quand il existe.
- Message type (valeurs tirées de l'épisode réel `EP-TSLA-crash_no_recovery-2022-02-24` de la bibliothèque) : « Actif A, c'était Tesla. Le scénario débutait en février 2022. Au mois 3, la position valait −18 % depuis le début et −42 % sous son sommet ; tu as vendu. À la fin de la fenêtre, le titre était à −31 % depuis le départ, et il a regagné +29 % dans les 12 mois suivants (données réelles). » Le système doit toujours produire ce genre de phrase **à partir des valeurs de l'épisode**, jamais de mémoire.

### Phase D — Profil révélé
- Rapport d'une page : pour chaque trait, **déclaré vs observé**, écart, intervalle d'incertitude, confiance. Chaque chiffre est **cliquable** et ouvre le panneau de preuves (décisions, données, formule).
- Exemple : « Tu as déclaré un risque élevé. Ta tolérance observée correspond à un profil modéré (confiance 72 %). »

### Phase E — Pacte
- **Le modèle ne propose aucune règle.** Pour **chaque faiblesse détectée**, l'Agent d'explicabilité **montre le problème** (le comportement observé, les décisions et les données qui le prouvent) et **demande à l'utilisateur d'écrire lui-même** une règle personnelle pour le régler, avec ses propres mots. L'utilisateur peut aussi refuser d'écrire une règle pour une faiblesse (le refus est enregistré). Minimum 2 règles demandées, 3 conseillées.
- **Rôle limité du système pendant l'écriture :** (a) un champ de texte libre, avec le rappel du problème à côté ; (b) le système **traduit** le texte de l'utilisateur en règle structurée (déclencheur mesurable + action) puis la **lui montre pour confirmation** (« voici comment je comprends ta règle ») : l'utilisateur confirme ou corrige ; (c) si le texte est trop vague pour être mesuré (« être plus prudent »), le système **pose une question de clarification** sans suggérer de contenu de règle (« à partir de quelle baisse, en pourcentage ? »). Le système n'écrit pas, ne suggère pas et ne complète pas le fond de la règle.
- Une règle est **structurée** (déclencheur mesurable + action) pour être reconnue automatiquement plus tard (section 9). Exemples de règles qu'un **utilisateur** pourrait écrire (ce ne sont **pas** des suggestions du système) : « Si un titre a monté de plus de 40 % en 5 jours, j'attends 24 h avant d'acheter » ou « jamais plus de 5 % dans un titre dont je ne comprends pas le modèle d'affaires ».
- Les règles sont conservées dans le profil, versionnées.

### Phase F — Outil externe : réception des trades
- **Aucune application de trading dans ce projet.** Le système est un **service appelé par une plateforme hôte** (section 10). Il ne détient ni compte, ni position, ni ordre.
- **Avant le trade (optionnel)** : l'hôte peut appeler la vérification pré-trade avec l'intention de trade. Si le contexte ressemble à une situation évaluée où l'utilisateur a établi une règle, le système renvoie un **rappel structuré** (sa règle, la situation d'origine, une version compatible du montant) que l'hôte affiche comme il le souhaite. Aucune question n'est posée avant le trade. Le système **ne bloque rien**.
- **Après le trade (obligatoire)** : l'hôte envoie un **événement de trade** : utilisateur, moment, montant, information sur le trade (actif, sens, quantité, prix, devise, contexte optionnel). Le système répond par un accusé, puis analyse de façon asynchrone.
- **Enquête automatique, entièrement de notre côté** : le système reçoit les informations du trade, **mène lui-même l'enquête** sur ce qui a pu le pousser (nouvelles publiques et presse, comptes liés consentis, historique des trades, signaux de marché), puis **met à jour le profil et l'indice de dérive** de l'utilisateur. **Aucune action, aucune question et aucune confirmation n'est demandée à l'utilisateur.** Résultat de l'enquête : une **cause probable**, un **niveau de confiance** et des **preuves** (ou « indéterminé »).
- **Mise à jour** : croisement avec des indicateurs objectifs, sévérité du trade, mise à jour de l'**indice de dérive**, des traits du profil et du **seuil de réévaluation personnel** (section 15).

### Phase G — Réévaluation continue
- Quand l'indice de dérive atteint le **seuil de réévaluation de l'utilisateur** : alerte (webhook vers l'hôte et page de réévaluation), nouvelle simulation **ciblée** sur les traits dégradés, révision des règles par l'utilisateur (ajout ou resserrement), mise à jour du profil et du seuil. Sans fin.

---

## 4. Agents et composants : rôle de chacun

Principe : **le LLM conçoit et explique ; le code mesure et calcule.** Les scores, les contrefactuels et les seuils ne viennent jamais d'un LLM.

| # | Composant | Type | Rôle précis | Pourquoi il existe |
|---|---|---|---|---|
| 1 | **Directeur de scénarios** | Agent LLM (Bedrock, avec outils) | Lit l'état du profil (traits incertains, couverture des mesures, historique de fenêtres déjà utilisées) ; choisit **quel épisode réel** de la bibliothèque et **quels déclencheurs** (type, intensité, moment) pour mesurer le trait le plus incertain ou le plus à risque, en respectant les contraintes de cohérence. | Une séquence adaptative mesure plus vite et plus finement qu'un questionnaire fixe. Il ne choisit jamais de chiffres de marché : il sélectionne et combine. |
| 2 | **Rédacteur de déclencheurs** | Appel LLM structuré (Bedrock + Guardrails) | Écrit le texte du stimulus (tweet fictif d'une personnalité inventée, message d'un proche fictif, titre de nouvelle) à partir de **faits fournis par les outils** et d'un gabarit d'intensité. | Rend les stimuli crédibles et variés sans inventer de faits de marché. |
| 3 | **Validateur de scénarios** | Code (Lambda) + garde-fous Bedrock | Vérifie : aucune fuite d'identité (nom, ticker, date exacte, indices distinctifs), tous les chiffres du texte existent dans les données, stimulus conforme à son gabarit d'intensité, fenêtre non déjà utilisée. Refuse et relance sinon. | Garantit rigueur et masquage. |
| 4 | **Moteur d'analyse comportementale** | **Code déterministe** (Lambda, Python) | Calcule tous les scores de traits, intervalles, confiance, indice de dérive, contrefactuels. | Rend les mesures auditables et reproductibles. |
| 5 | **Agent d'explicabilité** | Agent LLM (Bedrock) contraint | Rédige la révélation, le rapport de profil et les messages du garde-fou **uniquement à partir d'un dossier de preuves JSON** ; chaque phrase référence des identifiants de preuve. Un validateur code vérifie que chaque nombre cité existe dans les preuves. | Explications fidèles, vérifiables, sans justification inventée. |
| 6 | **Agent de gouvernance (garde-fou)** | Code (appariement de règles) + LLM (formulation) | Reconnaît les situations similaires à une règle existante (fonction déterministe), valide les événements reçus (champs obligatoires, actif connu ou inconnu, données manquantes signalées) et formule le rappel. | Rend les contrôles visibles et vérifiables. |
| 7 | **Orchestrateur de réévaluation** | Step Functions | Surveille l'indice de dérive, déclenche l'alerte, lance une simulation ciblée, puis la révision des règles. | Ferme la boucle dans le temps. |
| 8 | **Agent enquêteur** | Code déterministe (collecte, scores d'attribution) + appels LLM limités à la **pertinence** des nouvelles et publications | Pour chaque trade reçu, collecte les signaux datés avant le trade (nouvelles publiques, comptes liés consentis, historique, marché), calcule les scores par catégorie de cause, produit un dossier d'enquête avec preuves, confiance et verdict (cause probable ou « indéterminé »). | Remplace le questionnaire : l'utilisateur n'a rien à déclarer, et la cause repose sur des données observables. |

Les composants 1, 2 et 5, et la classification de pertinence du composant 8, sont des **usages distincts de Bedrock** ; chacun a un contrat d'entrée/sortie en JSON validé par schéma. Si tu préfères un cadriciel d'agents (Strands Agents SDK ou Agents for Amazon Bedrock), choisis-en un seul et justifie-le dans `docs/ARCHITECTURE.md`.

---

## 5. La bibliothèque de simulations réelles

### 5.1 Principe
La bibliothèque est une collection d'**épisodes réels**, extraits **sans aucune modification** des 5 ans de données (2021-11-12 à 2026-11-12). Un épisode est une fenêtre d'environ **190 jours de bourse (≈ 9 mois)** pour un actif, découpée en **arrêts mensuels**. Les épisodes sont **réutilisables et combinables avec des déclencheurs** : un même épisode peut servir à tester la tolérance à la baisse sans stimulus, puis (avec un autre utilisateur) la sensibilité au hype avec un tweet.

`data/episode_library.json` contient déjà **73 épisodes couvrant les 31 actifs**, produits par `reference/episode_miner.py` :

| Type d'épisode | Nombre | Ce qu'il teste en priorité |
|---|---|---|
| `crash_no_recovery` (baisse ≥ 30 % sans retour) | 12 | Tolérance réelle au risque, aversion aux pertes, vente à la panique |
| `drop_then_recovery` (baisse ≥ 25 % puis reprise) | 6 | Patience, regret de vente, discipline |
| `parabolic_rally` (hausse ≥ 60 %) | 15 | Hype, FOMO, effet de disposition (vendre trop tôt), concentration |
| `rally_then_reversal` (hausse puis retournement) | 3 | Prise de profit, ancrage sur le sommet |
| `single_day_shock` (choc de ≥ 12 % en une journée) | 7 | Impulsivité, réaction aux nouvelles |
| `calm_sideways` (stagnation calme) | 12 | Ennui, surtrading, effet d'action inutile (contrôle) |
| `steady_climb` (hausse régulière) | 18 | Ligne de base, avidité à renforcer, concentration |

Exemples tirés des données (rendement total sur la fenêtre d'environ 9 mois, `adj_close`, à titre d'illustration de la diversité) : Shopify −77 % à partir de novembre 2021 ; Bitcoin −58 % et Ether −54 % à partir de mars 2022 ; NVIDIA +294 % à partir d'octobre 2022 ; obligations américaines longues (TLT) −30 % à partir de janvier 2022 ; Tesla −31 % à partir de février 2022 ; Constellation Software −51 % à partir de mai 2025.

### 5.2 Schéma d'un épisode (déjà présent dans le fichier)
```json
{
  "episode_id": "EP-TSLA-crash_no_recovery-2022-02-24",
  "type": "crash_no_recovery",
  "ticker_truth": "TSLA", "name_truth": "Tesla",
  "asset_class": "equity", "sector": "Consumer Discretionary", "currency": "USD",
  "start": "2022-02-24", "end": "2022-11-25",
  "stats": { "total_return_pct": -31.5, "max_drawdown_pct": -56.0, "peak_gain_pct": 43.0,
             "worst_day_pct": ..., "best_day_pct": ..., "ann_vol_pct": ...,
             "after_window_12m_return_pct": ... },
  "checkpoints": [
    { "step": 0, "date": "2022-02-24", "index": 100.0, "ret_since_start_pct": 0.0,
      "drawdown_from_peak_pct": 0.0,
      "macro": { "V39079": ..., "DFF": ..., "BD.CDN.10YR.DQ.YLD": ..., "DGS10": ...,
                 "STATIC_TOTALCPICHANGE": ..., "UNRATE": ... } }
  ]
}
```
Les champs `*_truth` et `date` **ne sont jamais envoyés au navigateur** avant la révélation. L'API de session ne renvoie que les champs masqués (section 5.4).

### 5.3 Épisodes de portefeuille (combinaisons)
La bibliothèque contient des épisodes à actif unique (**ancres**). Le moteur peut construire un **épisode de portefeuille** en prenant la même fenêtre de dates pour 3 à 5 actifs via Athena (par exemple Mateo : un fonds ESG, une action énergétique, des obligations, tous sur la même période), afin de tester la diversification, la cohérence avec les valeurs ou la corrélation actions-obligations en 2022. L'actif **ancre** est celui sur lequel portent les décisions ; les autres positions donnent le contexte de diversification.

### 5.4 Masquage
- Étiquette neutre : « Actif A, technologie à forte croissance », « Actif B, obligations long terme », « Actif C, fonds diversifié à critères ESG » (gabarits selon `asset_class` et `sector`, **sans** nom, ticker, pays ou produit reconnaissable).
- Prix **rebasés** (indice 100) ; temps affiché en **relatif** (« Mois 3 sur 9 ») ; valeurs en dollars du portefeuille fictif.
- Contexte macro : **valeurs réelles** (taux, inflation) mais **dates masquées** et valeurs arrondies. Limite documentée : certaines valeurs (ex. une inflation très élevée) permettent à un expert de deviner l'époque.
- **Contrôle de reconnaissance** : juste après la dernière décision de chaque scénario, **sans rien révéler**, la question « Avais-tu reconnu l'actif ou l'époque ? » (oui/peut-être/non). Un « oui » **réduit le poids** du scénario dans le profil (poids 0,5) et l'indique dans le rapport.

### 5.5 Extension de la bibliothèque
Le pipeline de données (Athena + Lambda) doit pouvoir **régénérer et étendre** la bibliothèque : autres fenêtres, autres durées (3, 6, 12 mois), autres types. Les paramètres (taille de fenêtre = 190 jours, pas = 21 jours, seuils par type) sont dans `config/episodes.yaml`.

---

## 6. Données, traitements et limites (à documenter dans le livrable)

### Sources (jeu de départ de l'organisation, window 2021-11-12 → 2026-11-12)
- **Yahoo Finance via yfinance** : prix quotidiens (`prices_daily.csv`), dividendes et fractionnements (`corporate_actions.csv`). Licence : conditions Yahoo.
- **Banque du Canada (API Valet)** : change USD/CAD, taux directeur, rendements canadiens 2 et 10 ans, IPC canadien.
- **FRED** : taux des fonds fédéraux, rendements américains 2 et 10 ans, IPC américain, chômage américain.
- Univers : 31 actifs (10 actions canadiennes, 10 américaines, 9 FNB dont un FNB filtré ESG, Bitcoin, Ether).

### Traitements obligatoires
- **Rendements** : utiliser `adj_close` (ajusté fractionnements et dividendes). `close` n'est ajusté que pour les fractionnements. **Ne pas réappliquer** les fractionnements de `corporate_actions.csv`.
- **Devises** : les titres `.TO` sont en CAD, les autres en USD ; conversion avec `fx_usdcad_daily.csv` (report de la dernière valeur les jours fériés canadiens). La devise de référence du portefeuille de **simulation** est le **CAD** ; les événements de trade portent leur propre devise et sont convertis au besoin.
- **Calendriers** : pas de remplissage dans les fichiers sources ; les cryptos se négocient 7 jours sur 7. Pour la bibliothèque, les séries crypto sont **limitées aux jours ouvrables** pour comparabilité ; documenter.
- **Cohérence temporelle (point-in-time)** : les séries macro mensuelles sont datées au mois de référence, pas à la publication. On applique un **décalage de publication conservateur de 45 jours** pour l'IPC (Canada et États-Unis) et de **35 jours** pour le chômage ; les séries quotidiennes ne sont pas décalées. Les valeurs FRED sont les valeurs révisées (limite documentée).
- **Anomalie connue** : CNQ.TO affiche un « fractionnement » de 1,021 le 2022-08-22 (probable distribution spéciale). Ne pas utiliser ce ratio ; signaler dans la documentation.

### Limites à déclarer
Biais du survivant (univers choisi en 2026 parmi des titres aujourd'hui importants) ; seulement 5 ans (régimes limités : hausse des taux de 2022, etc.) ; Yahoo non certifié par les bourses ; valeurs `adj_close` qui changent si on retélécharge ; **aucune donnée ESG, de nouvelles ou fondamentale dans le jeu de départ** : voir ci-dessous.

### Ce qui manque et comment le traiter
- **ESG (Mateo)** : le jeu ne contient aucune cote ESG. Approche minimale défendable : les **valeurs de Mateo sont exprimées en règles de secteur** (par exemple « éviter l'énergie fossile ») et en préférence pour le FNB filtré ESG (ESGV) ; le scénario ESG oppose ESGV à un titre énergétique (ENB, CNQ, XOM) sur la même fenêtre. Déclarer la limite : les données ne disent pas si une entreprise a des controverses. Amélioration envisagée : intégrer la méthodologie ESG publiée par l'émetteur du FNB.
- **Nouvelles** : les nouvelles des scénarios sont **construites à partir de faits présents dans les données** (« le taux directeur passe de X % à Y % », « l'actif perd Z % en une journée »), étiquetées comme **simulées**. Aucune vraie nouvelle d'entreprise n'est inventée. Option avancée : adaptateur vers une source publique de nouvelles datées (documenter licence et limites).
- **Réseaux sociaux (scénarios de simulation)** : les tweets, messages et publications des **scénarios** sont **fictifs**, de **personnes inventées** (jamais de vrais noms ou comptes), et révélés comme tels. Les sources de l'**enquête après trade** sont décrites ci-dessous.

### Sources de l'enquête automatique (section 15.1)
| Source | Contenu utilisé | Règles et limites |
|---|---|---|
| **Nouvelles publiques et presse** (adaptateur `NewsSource`) | Titre, média, **date et heure de publication**, URL, entités détectées (actif, société, secteur, thème macro). Options à évaluer et à documenter (licence, couverture, délai) : jeu de données ouvert GDELT (vérifier sa disponibilité sur AWS Open Data pour la période), flux RSS publics de médias, API de nouvelles sous licence. | On conserve les **métadonnées** et au plus un court extrait, **jamais les articles complets** (droit d'auteur). Ingestion **planifiée** (EventBridge Scheduler → Lambda → S3). Seules les nouvelles **publiées avant** le trade comptent (cohérence temporelle). Distinguer date de publication et date de collecte. |
| **Comptes liés du profil** (adaptateur `SocialSource` : LinkedIn, Instagram, etc.) | Publications de l'utilisateur ; interactions disponibles (« j'aime », commentaires, partages) ; comptes suivis et leurs publications **selon ce que l'API officielle et les autorisations accordées permettent** | **Consentement explicite, par compte, révocable et journalisé ; comptes de l'utilisateur lui-même uniquement ; API officielles et OAuth uniquement ; aucun scraping, aucun contournement de connexion, aucun message privé ; minimisation** (seulement ce qui concerne la finance ou l'actif du trade) ; **conservation courte** (30 jours par défaut, configurable), seuls les **signaux dérivés** sont gardés ; suppression à la demande. **Limite réelle à déclarer :** les API officielles n'exposent en général pas ce que l'utilisateur a *consulté*, seulement certaines interactions ; la couverture varie selon la plateforme et peut changer. Le système indique alors « couverture partielle » et abaisse l'**exposition** d'un signal dont la vue n'est pas prouvée. |
| **Historique des trades** | Événements reçus de l'hôte (section 10) | Sert à repérer les schémas d'impulsion (aller-retour, rafales, achat juste après une perte). |
| **Signaux de marché** | Rendements, volatilité, volume, hausse rapide | Calculés à partir du jeu de données ou fournis par l'hôte. |

**Dans la démonstration** (règle du défi : aucun compte réel, profils fictifs) : la source sociale est `SyntheticSocialSource`, un **jeu de données synthétique** de comptes et de publications fictifs liés aux profils fictifs, généré par `scripts/generate_synthetic_social.py` (graine fixe), contenant des **cas à cause connue** pour la validation (section 18). Tout est étiqueté **Fictif**. Les connecteurs réels (LinkedIn, Instagram, etc.) sont **décrits par l'interface et la documentation, mais non activés** : ils sont présentés comme extension, sous réserve des conditions d'utilisation et des lois sur la protection des renseignements personnels (consentement, minimisation, droit de suppression).

---

## 7. Catalogue de déclencheurs

Un **déclencheur** est un stimulus injecté à un arrêt précis d'un épisode pour mesurer un trait. Il a un **type**, une **source**, une **valence** (pousse à acheter / vendre / tenir), une **intensité** (1 à 3, définie par des paramètres, pas par l'humeur du LLM) et un **moment**. L'IA les choisit et en rédige le texte ; le code vérifie.

| ID | Déclencheur | Exemple (fictif) | Trait mesuré |
|---|---|---|---|
| T00 | **Contrôle** (aucun stimulus) | — | Ligne de base de tous les traits |
| T01 | Publication d'une **personnalité influente** (fictive) | « @MarieAnalyse : ce titre va doubler, j'ajoute ! » | Hype / influence sociale |
| T02 | Message d'un **proche** | « Mon cousin Karim vient d'acheter, il dit que c'est le moment » | Influence sociale de proximité |
| T03 | **Preuve sociale** | « 82 % des investisseurs de la plateforme renforcent aujourd'hui » | Hype / conformisme |
| T04 | **Nouvelle haussière** ou **baissière** construite sur des faits des données | « Le taux directeur passe de 1,25 % à 1,75 % » | Réactivité aux nouvelles |
| T05 | **Notification de perte** | « Ton portefeuille a perdu 4 200 $ aujourd'hui » | Aversion aux pertes, panique |
| T06 | **Pression de temps** | Minuteur de 10 secondes | Impulsivité |
| T07 | **Rumeur non vérifiée** vs **source officielle** | « Selon des sources anonymes… » | Discernement des sources |
| T08 | **Ancrage** | Affichage du prix d'achat ou du plus haut | Effet de disposition, ancrage |
| T09 | **Conflit de valeurs** | Le fonds ESG recule pendant que l'énergie progresse | Cohérence avec les valeurs |
| T10 | **Occasion de concentration** | Bouton « renforcer » qui ferait dépasser la limite déclarée | Discipline de diversification |
| T11 | **Gain rapide** | « +35 % en un mois : encaisser ? » | Effet de disposition |
| T12 | **Popularité** | « Le plus discuté cette semaine » | Hype |
| T13 | **Autorité** | « Objectif de cours relevé par un analyste » (fictif) | Déférence à l'autorité |
| T14 | **Contre-signal** | Le stimulus contredit les données affichées | Esprit critique |

### Combinaison épisode × déclencheur
Un scénario = **1 épisode** + **0 à 2 déclencheurs** placés à des arrêts précis + **contexte de l'utilisateur** (profil, portefeuille, historique). Règles de conception expérimentale (à implémenter dans le Directeur et vérifier dans le Validateur) :
- Chaque trait doit avoir **au moins 3 décisions « avec stimulus »** et **au moins 3 décisions « sans stimulus »** de nature comparable pour pouvoir isoler l'effet du stimulus.
- **Équilibrer** les conditions entre les scénarios (comme un plan expérimental), pas toujours le même déclencheur au même type d'épisode.
- **Ne jamais empiler** plus de 2 déclencheurs sur le même arrêt.
- **Gradient d'intensité** (1, 2, 3) quand un trait réagit : mesurer la dose-réponse.
- Les déclencheurs de **valence opposée** à la tendance réelle servent à tester l'esprit critique (T14).
- L'IA peut proposer des déclencheurs adaptés au persona (ex. : pour Robert, une publication sur une société très médiatisée ; pour Mateo, T09 ; pour Amira, T05 et T01 sur cryptos) mais la **bibliothèque de types reste fermée** et validée.

### Contraintes de sûreté sur les stimuli
- Personnes et comptes **inventés** ; jamais de vrai nom, vrai compte, vraie marque de média.
- Aucun fait de marché non présent dans les données ; aucune promesse chiffrée de rendement futur présentée comme un fait.
- Révélés comme simulés **à la révélation finale**, pas avant.
- Passer par **Amazon Bedrock Guardrails** (contenu, noms propres, conseils financiers explicites).

---

## 8. Mesure du profil : traits, signaux et formules

### 8.1 Signaux capturés à chaque décision (table `decisions`)
`session_id, scenario_id, step, action (hold|sell|add), t_display, t_decision, decision_time_ms, reading_time_expected_ms, trigger_ids, trigger_intensity, portfolio_value, focus_position_value, ret_since_start, drawdown_from_peak, macro_snapshot, position_weight, recognition_flag, hesitation_events, order_index`.

### 8.2 Les 8 traits (échelle 0–100 et intervalle à 80 %)
| Trait | Définition | Mesure |
|---|---|---|
| **RT** Tolérance observée au risque | Baisse (drawdown) à laquelle la probabilité de vendre atteint 50 % | Régression logistique bayésienne de `P(vendre)` sur `drawdown_from_peak` et `position_weight`, **décisions sans stimulus uniquement** pour une mesure propre ; a priori centré sur le profil déclaré. Résultat : seuil θ en % et classe de profil. |
| **LA** Aversion aux pertes / panique | Part des ventes réalisées en baisse sévère sans plan | Proportion de ventes à drawdown ≥ 15 % ; **vente près du creux** (dans les 10 % les plus bas de la fenêtre, calculé à la révélation) |
| **IMP** Impulsivité | Décisions rapides, retournements, trades rapprochés | Temps de décision normalisé par le temps de lecture attendu ; part de décisions < 3 s ; allers-retours (renforcer puis vendre en ≤ 2 arrêts) ; effet de T06 |
| **HYP** Sensibilité au hype / influence sociale | Changement de décision attribuable au stimulus social | `P(action alignée avec le stimulus | stimulus) − P(même action | contrôle)` pour T01, T02, T03, T12, T13 ; dose-réponse selon l'intensité |
| **NEWS** Réactivité aux nouvelles | Même méthode pour T04 et T07 ; part de décisions qui suivent une nouvelle non fiable (T07) |
| **VAL** Cohérence avec les valeurs | Part de décisions qui violent les exclusions ou préférences ESG déclarées sous T09 |
| **DIV** Discipline de diversification | Dépassements de la limite de position déclarée après décision (T10) |
| **DISP** Effet de disposition | Rapport « vendre les gagnants / garder les perdants » (proportion de gains réalisés vs proportion de pertes réalisées) |

### 8.3 Confiance
`confiance(trait) = f(nombre de décisions pertinentes, largeur de l'intervalle a posteriori, part de scénarios reconnus)`, affichée de 0 à 100 %. Le profil est qualifié de **préliminaire** tant que la confiance moyenne est < 60 %. Le système doit aussi dire explicitement « données insuffisantes pour conclure » quand c'est le cas.

### 8.4 Profil déclaré vs observé
Écart par trait = observé − déclaré, accompagné de son intervalle. Un écart n'est qualifié de **significatif** que si les intervalles ne se chevauchent pas ou si la différence dépasse un seuil de configuration. Le rapport classe les écarts (« points négatifs ») qui alimentent le Pacte.

### 8.5 Politique contrefactuelle du « profil déclaré »
Pour le graphique de révélation (« ce que tu aurais fait en suivant ton profil déclaré ») : politique déterministe : **vendre** si le drawdown dépasse le seuil du risque déclaré (faible −10 %, faible-modéré −15 %, modéré −25 %, élevé −40 %, très élevé −55 %), **tenir** sinon, **jamais renforcer** au-delà de la limite de position. Tous les contrefactuels sont **calculés par le code à partir des vraies données** et couverts par des tests unitaires.

---

## 9. Pacte, règles et garde-fou avant trade

### 9.1 Structure d'une règle
```json
{
  "rule_id": "R-...", "profile_id": "...", "version": 2, "strictness": 1,
  "text_user": "Si un titre a monté de plus de 40 % en 5 jours, j'attends 24 h.",
  "trait": "HYP",
  "trigger": { "all": [
      { "feature": "ret_5d_pct", "op": ">", "value": 40 },
      { "feature": "asset_class", "op": "in", "value": ["equity", "crypto"] } ] },
  "action": { "type": "cooldown", "params": { "hours": 24 } },
  "origin": { "scenario_id": "...", "decision_ids": ["..."] },
  "created_at": "...", "active": true
}
```
Types d'actions : `max_weight` (limite de position), `cooldown` (délai d'attente), `require_ack` (confirmation explicite), `no_buy_on_trigger` (ne pas acheter après un type de déclencheur), `size_cap` (taille maximale d'un ordre).

### 9.2 Reconnaissance des situations similaires (déterministe)
Pour toute intention de trade (vérification pré-trade) ou tout trade reçu, calculer un **vecteur de contexte** : classe d'actif, volatilité 20 j (percentile), drawdown, rendement 5 j et 20 j, **pic de volume** (z-score), présence d'une **nouvelle** (indicateur fourni par l'hôte), poids de la position après le trade, délai depuis le dernier trade, dérive courante. Les champs fournis par l'hôte priment ; les champs absents sont **calculés à partir du jeu de données** quand l'actif en fait partie et que la date est couverte ; sinon ils sont marqués **inconnus** (section 10). Une règle **s'applique** si ses conditions structurées sont satisfaites. Une **règle approchante** (distance au contexte d'origine sous un seuil) est aussi signalée avec un niveau de similarité. Le LLM ne décide jamais de l'application d'une règle ; il formule seulement le rappel.

### 9.3 Garde-fou avant le trade (optionnel ; option « avertir et laisser décider »)
- **Aucune question** n'est posée avant le trade. La vérification renvoie un objet `reminder` : la règle de l'utilisateur, la situation où il l'a établie, ce qu'il avait fait et ce qui s'est réellement passé, le contexte actuel du titre, et **une version compatible** du montant (par exemple 5 % au lieu de 30 %, calculée à partir de **sa propre règle**). L'hôte l'affiche à sa façon, ou intègre la **page de rappel hébergée** par le système.
- **Le système ne bloque rien.** L'utilisateur reste libre. Si un trade est ensuite reçu qui **dépasse la limite** ou **ne respecte pas le délai** d'une règle applicable, le système le détecte **automatiquement** à partir de l'événement (même si l'hôte n'avait pas appelé la vérification) et l'enregistre comme **« règle ignorée »**, ce qui alimente l'indice de dérive.
- Si aucune règle ne s'applique mais que la dérive est élevée, le rappel contient un message général de vigilance.

### 9.4 Resserrement des règles (réévaluation)
Niveaux de rigueur : **1** rappel · **2** délai d'attente ou limite réduite de moitié · **3** confirmation explicite obligatoire et limite à nouveau réduite. Après une alerte de réévaluation, l'agent **montre le problème** (règle ignorée, trades responsables) et **demande à l'utilisateur** d'écrire une nouvelle règle ou de resserrer une règle existante ; le **choix du niveau de rigueur appartient à l'utilisateur** (sélecteur dans le formulaire de règle). Le modèle ne propose pas le contenu de la règle.

---

## 10. API d'intégration : le système comme outil externe

### Principe
AlphaForge Mirror **n'est pas une application de trading et n'en branche aucune**. C'est un **service externe** qu'une plateforme de trading (l'**hôte**, par exemple celle d'une banque ou d'un courtier en ligne) appelle. Le système **reçoit** l'utilisateur, le moment du trade, le montant et l'information sur le trade, puis **met à jour le profil** de l'utilisateur, notamment son **indice de dérive** et son **seuil de réévaluation**. Il ne détient ni compte, ni position, ni ordre, et ne bloque ni ne modifie aucun trade.

### Événement de trade (entrée principale)
```json
{
  "event_id": "uuid-unique-fourni-par-l-hote",
  "user_id": "pseudonyme-fourni-par-l-hote",
  "executed_at": "2026-11-12T14:32:05-05:00",
  "side": "buy",
  "symbol": "NVDA",
  "asset_class": "equity",
  "quantity": 12.5,
  "price": 187.20,
  "currency": "USD",
  "amount": 2340.00,
  "amount_currency": "CAD",
  "portfolio_value": 52000.00,
  "position_weight_after_pct": 4.5,
  "order_type": "market",
  "context": {
    "ret_5d_pct": 22.4, "ret_20d_pct": 41.0, "vol_20d_pct": 58.0,
    "volume_zscore": 2.6, "news_flag": true, "hype_flag": true
  },
  "guard_decision_id": "optionnel"
}
```
- **Obligatoires :** `event_id`, `user_id`, `executed_at`, `side`, `symbol`, `amount` (avec `amount_currency`).
- **Facultatifs :** tout le reste (`asset_class`, `quantity`, `price`, `portfolio_value`, `position_weight_after_pct`, `order_type`, `context.*`, `guard_decision_id`).
- **Champs absents :** (1) si l'actif fait partie des 31 actifs du jeu de données et si la date est couverte (jusqu'au 2026-11-12), le système **calcule** `ret_5d`, `ret_20d`, `vol_20d` et `volume_zscore` à partir des données ; (2) sinon l'indicateur correspondant est **« inconnu »** : il ne contribue pas à la sévérité, **réduit de moitié le poids** de la mise à jour du profil, et l'écran de preuves l'indique (« donnée de contexte non disponible »). Le système ne devine jamais une valeur.
- Le **contexte** envoyé par l'hôte est traité comme **donnée déclarée par l'hôte** et étiqueté comme tel dans les preuves.

### Points de terminaison (REST, API Gateway + Lambda ; DynamoDB pour l'état)
| Méthode et chemin | Rôle |
|---|---|
| `POST /v1/trade-events` | **Reçoit un trade.** Valide le schéma, applique l'idempotence sur `event_id`, répond `202` avec `event_id` et `status: "received"`. L'analyse et l'enquête sont **asynchrones**. |
| `GET /v1/trade-events/{event_id}` | Résultat de l'analyse : indicateurs, sévérité, nouvel indice de dérive, **seuil de réévaluation**, statut (`normal`, `vigilance`, `alerte`), version de profil, résumé de l'enquête, `reevaluation_url` si alerte |
| `POST /v1/trade-intents:check` | **Facultatif, avant le trade** : prend l'intention de trade, renvoie `reminder` (règles applicables, similarité, contexte, version compatible) ou `no_match` |
| `GET /v1/trade-events/{event_id}/investigation` | **Dossier d'enquête** (lecture seule, pour l'audit et l'explicabilité) : signaux, scores par catégorie, cause probable, confiance, preuves, couverture des sources |
| `PUT /v1/users/{user_id}/sources` · `DELETE /v1/users/{user_id}/sources/{source_id}` | Consentements aux comptes liés : accorder, consulter, **révoquer** ; la révocation supprime les données dérivées de ce compte |
| `GET /v1/users/{user_id}/profile`, `/timeline`, `/rules` | Profil courant, historique des versions, règles |
| `GET /v1/evidence/{id}` | Panneau de preuves |
| `PUT /v1/webhooks` | Enregistre l'URL de rappel de l'hôte |

### Notifications sortantes (webhooks signés)
`investigation.completed` · `profile.updated` (avec l'indice de dérive, le seuil et le statut) · `reevaluation.required` (avec `reevaluation_url`). Signature **HMAC-SHA256**, nouvelles tentatives avec attente croissante, charges utiles sans donnée personnelle.

### Sécurité, confidentialité, fiabilité
- Authentification **machine à machine** (Cognito, flux client credentials, ou clés d'API avec plans d'utilisation et limitation de débit) ; chiffrement en transit et au repos ; moindre privilège IAM.
- **Minimisation des données** : pseudonyme uniquement ; aucune donnée bancaire ni d'identité. Le pseudonyme est lié à un profil lors de l'intégration initiale (voir hypothèses).
- **Idempotence** sur `event_id`, tolérance aux doublons et aux événements en retard (traités par `executed_at`, pas par ordre d'arrivée), file de rebut pour les événements invalides, contrat décrit dans un fichier **OpenAPI** (`docs/openapi.yaml`) généré et testé.
- Accusé de réception en **moins de 2 secondes** ; analyse complète en quelques secondes ; l'hôte n'est jamais bloqué par l'analyse.

### Flux de traitement d'un trade reçu
`POST /v1/trade-events` → validation et idempotence → événement (EventBridge) → **pipeline Step Functions** : enrichissement du contexte (jeu de données ou champs de l'hôte) → appariement des règles (règle ignorée ?) → **enquête automatique** (Agent enquêteur : collecte des signaux, scores d'attribution, verdict) → sévérité → mise à jour de l'indice de dérive, des traits, du **seuil de réévaluation** et création d'une **version de profil** avec ses preuves → `investigation.completed` et `profile.updated` → si seuil franchi : `reevaluation.required`.

### Console de test de l'hôte (outil de développement, pas un produit)
Une **page de test très simple** (ou un script `scripts/send_trade_event.py` et une collection Postman) joue le rôle de l'hôte : formulaire de trade fictif, boutons « vérifier avant le trade » et « envoyer le trade », affichage de la réponse, des webhooks reçus et du rappel. Elle sert à la **démonstration**, aux **tests automatisés** et aux **personas synthétiques**. Elle n'exécute rien, ne tient aucun compte, et est clairement étiquetée « Hôte de test — aucune transaction ».

---

## 11. Personas prédéfinis

Allocation de départ (**hypothèse** à documenter, table dans `config/allocations.yaml`) pour 100 000 $ fictifs :

| Persona | Déclaré | Allocation de départ (indicative) | Faiblesse à tester par l'IA |
|---|---|---|---|
| **Amira**, 26 ans | Risque élevé, 15 ans et plus, intéressée par l'IA et les cryptos, veut rester diversifiée | 45 % actions croissance/tech, 15 % cryptos, 20 % FNB large, 10 % obligations, 10 % liquidités | Panique en baisse sévère (T05, `crash_no_recovery`), concentration (T10), hype crypto (T01) |
| **Mateo**, 41 ans | Risque modéré, 8–12 ans, forte importance ESG, peu intéressé par la spéculation | 40 % FNB ESG, 20 % actions défensives, 30 % obligations, 10 % liquidités | Abandon de ses convictions (T09, ESGV vs énergie), nouvelles (T04) |
| **Robert**, 59 ans | Risque faible à modéré, 3–5 ans, préserve le capital, peu intéressé par les cryptos | 50 % obligations/court terme, 30 % actions établies, 10 % FNB or ou large, 10 % liquidités | Tenté par une action médiatisée (`parabolic_rally` + T01/T12), FOMO |

Un **profil personnalisé** utilise les mêmes champs et la même logique d'allocation.

---

## 12. Explicabilité : le journal de preuves

### Principes
1. **Tout est une preuve.** Chaque décision, chaque métrique, chaque règle, chaque contrefactuel est stocké avec un identifiant, une version de formule et ses entrées.
2. **Toute phrase affichée référence des preuves.** L'Agent d'explicabilité renvoie du JSON : `[{ "texte": "...", "evidence_ids": ["D-17","M-RT-3"] }]`.
3. **Validation automatique.** Un validateur code rejette toute phrase dont un nombre n'apparaît pas dans les preuves citées, ou qui cite une preuve inexistante, puis régénère. Si l'échec persiste : le texte est remplacé par un gabarit sans LLM.
4. **Panneau de preuves** (clic sur n'importe quel chiffre) : la décision d'origine (horodatage, temps de réponse, condition, déclencheur), la donnée source (fichier, date, version, transformation), la formule (nom, version, paramètres) et le niveau de confiance.
5. **Trace d'exécution** observable : appels d'outils des agents, entrées et sorties, versions de modèle, validations réussies ou échouées. **On n'expose pas la chaîne de raisonnement interne du modèle**, seulement ses entrées, ses outils et ses sorties.
6. **Faits, hypothèses, fictif** : chaque élément affiché porte l'étiquette correspondante.

### Exemple (valeurs **illustratives** : le système doit produire les vraies à partir des données)
« Tu as déclaré un risque élevé. Tu as vendu à −31 %. Ta tolérance observée correspond à un profil modéré (confiance 72 %). » → clic sur « −31 % » : décision D-17, scénario S-3, arrêt 5, drawdown −31,0 % (donnée réelle), temps de réponse 2,1 s, condition T05 intensité 2 ; clic sur « modéré » : formule RT v1, intervalle 80 % [−21 %, −27 %], 4 décisions sans stimulus.

---

## 13. Architecture AWS : rôle concret de chaque service

| Service | Rôle dans le flux (pas décoratif) |
|---|---|
| **Amazon Bedrock** (modèles Claude, Converse API avec utilisation d'outils, **Guardrails**) | Exécute le Directeur de scénarios, le Rédacteur de déclencheurs, l'Agent d'explicabilité, la formulation du garde-fou et la **classification de pertinence** des nouvelles et publications pour l'enquête. Sans Bedrock, aucun scénario ne se génère : **intégration essentielle**. |
| **Amazon S3** | Lac de données : CSV bruts, Parquet normalisés, `episode_library.json`, **métadonnées de nouvelles**, rapports et traces d'exécution archivés |
| **AWS Glue Data Catalog + Amazon Athena** | Requêtes SQL du mineur d'épisodes et du constructeur d'épisodes de portefeuille ; calcul des indicateurs de contexte (volatilité, rendement 5 j, pic de volume) |
| **AWS Lambda** (Python) | Outils des agents (`find_episodes`, `get_market_context`, `build_scenario`, `validate_scenario`, `score_decision`, `counterfactual`, `match_rules`, `ingest_trade_event`), API d'intégration |
| **AWS Step Functions** | Pipeline de génération de scénarios (génère → valide → file), pipeline post-trade, orchestrateur de réévaluation |
| **Amazon DynamoDB** | Profils (versions), sessions, scénarios, décisions, règles, événements de trade reçus, **dossiers d'enquête, consentements, signaux dérivés** (avec durée de vie), preuves |
| **Amazon API Gateway** | API REST de l'application et **API d'intégration** pour les hôtes (plans d'utilisation, limitation de débit, validation de schéma) |
| **Amazon Cognito** | Authentification des utilisateurs de démonstration et **identifiants machine à machine** des hôtes |
| **Amazon EventBridge** | Événements « trade reçu », « seuil de réévaluation franchi », « scénario prêt » ; relais des webhooks sortants ; **EventBridge Scheduler** pour l'ingestion périodique des nouvelles |
| **Amazon CloudFront + S3** | Hébergement de l'application web |
| **Amazon CloudWatch** (+ X-Ray optionnel) | Journalisation, métriques, traces des pipelines |
| **AWS IAM, Secrets Manager** | Moindre privilège par fonction ; aucun secret en clair |
| **AWS CDK** (Python) | Infrastructure en code, reproductible |

### Bonnes pratiques à démontrer
Moindre privilège IAM ; chiffrement au repos et en transit ; aucune donnée personnelle réelle ; coûts maîtrisés (tarification à l'usage, modèle léger pour les gabarits courts, modèle plus capable pour la direction des scénarios) ; **préfabrication de scénarios** : pendant que l'utilisateur décide, Step Functions prépare le scénario suivant ; un **réservoir de scénarios validés** sert de repli si la génération est lente ou échoue (résilience de la démo).

### Pile technique recommandée (modifiable si justifié)
Front : React + TypeScript + Vite + Tailwind + Recharts (ou ECharts), en français. Back : Python 3.12 (Lambda) + pandas/NumPy/SciPy. Infrastructure : CDK Python. Tests : pytest, Vitest, Playwright pour le parcours de démo.

---

## 14. Écrans et UX

Principes : **une décision à la fois**, lisibilité d'abord, sobriété « finance de confiance », accessibilité (contraste AA, clavier, textes alternatifs), tous les textes en français, étiquettes **Réel / Hypothèse / Fictif** visibles.

1. **Accueil et profil déclaré** : choix d'un persona ou création ; auto-évaluation en 5 énoncés.
2. **Simulation** : valeur du portefeuille, graphique rebasé, panneau de contexte macro (réel), **déclencheur** affiché comme une vraie notification ou une carte de publication (avec avatar fictif), **trois boutons**, minuteur lorsque T06 est actif. Barre de progression des scénarios.
3. **Révélation** (affichée **une seule fois, après toutes les simulations** ; elle parcourt chaque scénario joué, dans l'ordre) : animation de démasquage ; graphique à trois trajectoires ; indicateurs ; bandeau « Ce tweet était simulé ».
4. **Profil révélé** : radar déclaré vs observé avec bandes d'incertitude ; liste des écarts ; **chaque chiffre cliquable** vers le panneau de preuves ; indicateur de confiance.
5. **Pacte** : à côté du problème détecté (preuves cliquables), un champ où **l'utilisateur écrit sa propre règle** ; le système affiche la version structurée à confirmer ; aucune règle n'est suggérée par le modèle.
6. **Tableau de bord du profil** : jauge de **dérive** avec le **seuil de réévaluation personnel** (vert / vigilance / alerte), chronologie du profil (versions), liste des règles, **journal des trades reçus** avec le changement de profil et d'indice que chacun a causé. (Aucune position ni aucun ordre : le système ne les détient pas.)
7. **Page de rappel de règles** (hébergée, intégrable par l'hôte) : la règle de l'utilisateur, la situation d'origine, ce qui s'est passé, le contexte actuel et la version compatible du montant. Elle informe, sans bouton qui bloque ou exécute un trade. Plus la **console de test de l'hôte** (outil de développement, section 10).
8. **Dossier d'enquête d'un trade** (**lecture seule**, ouvert depuis le panneau de preuves ; vue d'audit et d'explicabilité) : cause probable, **niveau de confiance**, signaux classés avec leur **heure** et leur **source** (nouvelle, publication d'un compte lié, historique, marché), chaque élément cliquable vers sa preuve, mention « hypothèse fondée sur la proximité dans le temps, pas une preuve ». **Aucune action de l'utilisateur n'est possible ici** : l'enquête est entièrement automatique. « Indéterminé » est un résultat normal.
8b. **Sources et consentements** : liste des comptes liables (fictifs dans la démo), interrupteur par compte, ce qui est lu et pour combien de temps, bouton **Révoquer et supprimer**.
9. **Alerte de réévaluation** : explication (quels trades ont fait monter la dérive), lancement de la simulation ciblée, révision des règles.
10. **Panneau de preuves** (tiroir latéral, accessible depuis partout).

---

## 15. Enquête automatique après-trade, mise à jour du profil et indice de dérive

### 15.1 Enquête automatique (aucune question posée à l'utilisateur)
Pour **chaque** trade reçu, l'**Agent enquêteur** cherche lui-même ce qui a pu pousser l'utilisateur à agir. Il ne pose **aucune question** avant ni après le trade. Avant le trade, le système rappelle seulement les règles pertinentes (section 9).

**Méthode (déterministe ; le LLM n'attribue jamais la cause)**
1. **Fenêtre d'influence** : de `t − 72 h` à `t` (heure d'exécution), configurable. **Aucune information postérieure à `t` n'est utilisée.**
2. **Signaux candidats** collectés dans les sources de la section 6 : nouvelles publiques, publications et interactions des comptes liés, historique des trades, signaux de marché.
3. **Score d'un signal** `z_k = r_k · e_k · m_k · d_k` avec :
   - `r_k` **pertinence** (1,0 : le symbole ou le nom officiel de la société est cité ; 0,5 : secteur ou thème ; 0,3 : macro). La classification de pertinence peut être assistée par LLM (sortie structurée), mais la correspondance exacte du symbole ou du nom prime et est vérifiée par le code ;
   - `e_k` **exposition** (1,0 : interaction de l'utilisateur prouvée, par exemple « j'aime » ou commentaire ; 0,6 : publication d'un compte qu'il suit ; 0,3 : nouvelle publique sans preuve que l'utilisateur l'ait vue ; 0,4 : signal de marché). Abaissée si la couverture de la source est partielle ;
   - `m_k` **intensité** normalisée (engagement de la publication, volume z-score, ampleur du mouvement, importance de la nouvelle) ;
   - `d_k = exp(−(t − t_k) / τ)` **décroissance** avec `τ = 12 h`.
4. **Score par catégorie** `C_c = 1 − Π_k (1 − z_k)` sur les signaux de la catégorie. Catégories : **NOUVELLE**, **SOCIAL** (influenceur ou proche, selon le type de compte), **HYPE_MARCHE** (pic de volume, hausse rapide, popularité), **IMPULSION** (déduite de l'historique seul : aller-retour, rafale de trades, achat peu après une perte), **AUCUN_SIGNAL**.
5. **Verdict** : la catégorie de score maximal `C_top` est la **cause probable** si `C_top ≥ 0,25` ; sinon le verdict est **« indéterminé »**. **Confiance** = `C_top · (1 − C_second)`. Le dossier présente toujours la deuxième hypothèse. « Aucun signal externe détecté » ne signifie **pas** « décision analytique » : le système ne conclut jamais que l'utilisateur a bien analysé.
6. **Sortie** (`investigation`) : `{ trade_id, window, signals:[{id, type, source, time, relevance, exposure, intensity, decay, score, evidence_id}], category_scores, verdict, confidence, second_hypothesis, sources_coverage, data_gaps }`.

**Honnêteté et responsabilité**
- La cause est une **hypothèse fondée sur la proximité dans le temps et l'exposition**, **pas une preuve de causalité**. Les textes disent « signal probable avant ce trade », jamais « tu as acheté à cause de… ».
- « Indéterminé » est un résultat valide et **ne pénalise pas** l'utilisateur.
- **Garde-fous contre les erreurs d'attribution**, puisque l'utilisateur n'intervient pas : (a) la mise à jour du profil est **proportionnelle à la confiance** ; (b) elle est **bornée** (≤ 3 points par trait et par événement) ; (c) **aucun changement de trait** sur un verdict « indéterminé » ; (d) le poids d'un trade reçu reste de 0,5 ; (e) un seul trade ne suffit pas à déclencher une alerte sans dépasser `s_t ≥ 0,85` ; (f) toute décision est **tracée** avec ses preuves pour l'audit.
- Les nouvelles et publications sont **externes et non vérifiées** : étiquetées comme telles.

### 15.2 Indicateurs objectifs (entrées de l'enquête et de la sévérité)
`hype_marche` (rendement 5 j ≥ +20 % pour une action ou un FNB, ≥ +40 % pour une crypto, **ou** pic de volume z ≥ 2, **ou** `hype_flag` fourni par l'hôte) ; `news_flag` fourni par l'hôte (sinon « inconnu » et l'enquête s'appuie sur les nouvelles collectées) ; `round_trip` (achat puis vente du même actif en < 24 h, ou l'inverse, d'après `executed_at`) ; `overtrading` (≥ 3 trades sur le même actif en 5 jours) ; `loss_chasing` (achat dans les 24 h suivant une perte réalisée) ; `rule_override` (règle applicable non respectée, détectée à partir de l'événement : montant ou poids au-delà de la limite, délai non respecté) ; `size_vs_tolerance` (poids de position ou volatilité au-delà de la tolérance observée ; « inconnu » si le poids n'est pas fourni). `round_trip`, `overtrading` et `loss_chasing` alimentent la catégorie **IMPULSION**. Un indicateur **« inconnu »** vaut 0 dans la sévérité et réduit de moitié le poids de la mise à jour.

### 15.3 Sévérité d'un trade
`s_t = min(1, Σ_i w_i · c_i)` où `c_i ∈ [0, 1]` et `w_i` les poids de `config/drift.yaml`. Composantes et poids initiaux : **SOCIAL** 0,30 × confiance ; **HYPE_MARCHE** 0,30 × confiance ; **IMPULSION** 0,25 × son score `C` ; **NOUVELLE** 0,10 × confiance (réagir à une nouvelle n'est pas mauvais en soi : peu de poids) ; `rule_override` 0,30 ; `size_vs_tolerance` 0,20.
Un trade **conforme à ses règles**, sans schéma d'impulsion et sans signal externe marquant donne `s_t = 0` (comportement sain, qui **fait baisser** l'indice). Un verdict « indéterminé » ne contribue pas à la sévérité (seules `rule_override` et `size_vs_tolerance` comptent).

### 15.4 Indice de dérive et seuil de réévaluation personnel
`DI_t = clip( δ · DI_{t−1} + κ · 100 · s_t , 0, 100 )`, avec δ = 0,90 (décroissance quand les trades sont sains) et κ = 0,35 (facteur de croissance), initialisé à 0. **Les paramètres sont calibrables.**

**Le seuil de réévaluation est propre à chaque utilisateur** (`reeval_threshold`, borné entre 45 et 80) et fait partie de son profil :
- **Valeur initiale** après la simulation : `T0 = clip(70 − 0,3 · G, 45, 80)`, où `G` est l'écart moyen absolu déclaré/observé sur l'échelle 0–100. Plus l'écart est grand, plus le seuil est bas, donc plus l'alerte vient tôt.
- **Après chaque trade reçu** : si `s_t ≥ 0,5`, le seuil **baisse de 2** ; après 5 trades consécutifs avec `s_t = 0`, il **monte de 1**.
- **Après chaque réévaluation** : `T = clip(0,5 · T + 0,5 · (70 − 0,3 · G'), 45, 80)`, avec `G'` le nouvel écart.
- **Seuil de vigilance** = `0,6 · T`. **Seuil de réarmement** = `T − 20` (hystérésis).
- **Alerte de réévaluation** si `DI ≥ T`, **ou** trois trades consécutifs avec `s_t ≥ 0,5`, **ou** un trade avec `s_t ≥ 0,85`.
- Chaque alerte affiche les **trades déclencheurs**, les **composantes** et le **seuil** au moment du déclenchement (explicable). Chaque changement de seuil est une **nouvelle version du profil** avec ses preuves.
- Les constantes (70, 0,3, 2, 1, 45, 80, 20) sont dans `config/drift.yaml` et se calibrent avec les personas synthétiques.

### 15.5 Mise à jour du profil après un trade
Le trade reçu est une **observation de poids 0,5** (moins contrôlée qu'une simulation), réduit de moitié si le contexte est incomplet. Exemple de règles de mise à jour (config) :
- **Achat puis vente directe** (round trip) → `IMP` ↑ ; `RT` ↓ : la tolérance observée diminue en raison de l'écart entre l'acte d'achat et la sortie rapide (ajustement borné, p. ex. ≤ 3 points par événement).
- **Cause probable SOCIAL ou HYPE_MARCHE** avec confiance ≥ 0,6 → `HYP` ↑ (proportionnel à la confiance). **Cause probable NOUVELLE** avec confiance ≥ 0,6 → `NEWS` ↑ seulement si le trade contredit aussi une règle ou la tolérance observée. **Verdict « indéterminé »** → aucun changement de trait lié à la cause.
- **Règle ignorée** → ligne de rigueur de cette règle ↑ ; trait associé ↑.
- **Vente en baisse sévère sans plan** → `LA` ↑ ; `RT` ↓.
- **Trade conforme aux règles et aux indicateurs objectifs** → trait associé ↓ (amélioration), DI ↓.
- **Le seuil de réévaluation** est mis à jour selon 15.4 à chaque trade reçu.
Chaque mise à jour crée une **nouvelle version du profil** (immuable) avec les preuves liées.

### 15.5 bis Réévaluation
À l'alerte : (1) l'**Orchestrateur** demande au Directeur de scénarios une **simulation ciblée** sur les traits dégradés (3 à 4 scénarios, avec les déclencheurs liés aux comportements observés ; même règle que la session initiale : révélation une seule fois, à la fin) ; (2) recalcul du profil ; (3) l'Agent d'explicabilité présente ce qui a changé ; (4) l'agent **montre le problème et demande à l'utilisateur d'écrire** une nouvelle règle ou de resserrer une règle existante (il ne propose pas de règle) ; (5) l'utilisateur écrit et confirme la version structurée ; (6) DI est ramené à une valeur de reprise (p. ex. 50 % de sa valeur) et le suivi continue.

---

## 16. Exigences fonctionnelles (format EARS, à reprendre dans `requirements.md`)

**Profil et portefeuille**
1. QUAND l'utilisateur choisit un persona, LE SYSTÈME DOIT préremplir le profil déclaré et créer un portefeuille fictif de 100 000 $ conforme à `config/allocations.yaml`.
2. LE SYSTÈME DOIT permettre de créer un profil personnalisé avec les mêmes champs que les personas.

**Simulation**
3. QUAND une session démarre, LE SYSTÈME DOIT générer des scénarios adaptés au profil en choisissant des épisodes dans `episode_library` et des déclencheurs du catalogue (section 7).
4. LE SYSTÈME NE DOIT JAMAIS envoyer au navigateur le ticker, le nom, les dates exactes, le rendement final ou la suite du marché après une vente d'un épisode avant la révélation finale.
5. LE SYSTÈME DOIT afficher à chaque arrêt la valeur du portefeuille, le contexte macro réel masqué en dates, et trois actions : tenir, vendre, renforcer.
6. LE SYSTÈME DOIT enregistrer pour chaque décision les signaux listés en 8.1, dont le temps de réponse.
7. LE SYSTÈME NE DOIT PAS répéter pour un même utilisateur la même fenêtre d'un même actif.
8. LE SYSTÈME DOIT garantir, par session, au moins 3 décisions avec stimulus et 3 sans stimulus par trait mesuré, ou signaler la couverture insuffisante.
9. TOUT stimulus généré DOIT avoir passé le Validateur (aucune fuite, aucun fait absent des données, gabarit d'intensité respecté).
10. QUAND la génération échoue ou dépasse 8 secondes, LE SYSTÈME DOIT utiliser un scénario validé du réservoir.

**Révélation et profil**
11. UNIQUEMENT APRÈS la dernière décision de la dernière simulation de la session, LE SYSTÈME DOIT révéler, pour chaque scénario joué, l'actif, l'époque et les stimuli simulés, puis afficher trois trajectoires : choix réels, tenir, et politique du profil déclaré, toutes calculées à partir des données réelles.
12. LE SYSTÈME DOIT calculer les 8 traits avec intervalles et confiance (section 8) et afficher l'écart déclaré/observé.
13. LE SYSTÈME DOIT qualifier le profil de « préliminaire » tant que la confiance moyenne est < 60 %.
14. CHAQUE chiffre du rapport DOIT être cliquable et ouvrir le panneau de preuves.

**Pacte et garde-fou**
15. POUR chaque écart négatif significatif, LE SYSTÈME DOIT montrer le problème et demander à l'utilisateur d'écrire lui-même une règle (minimum 2), puis la sauvegarder sous forme structurée et versionnée après sa confirmation.
15b. LE SYSTÈME NE DOIT PAS proposer, suggérer ni compléter le contenu d'une règle ; il PEUT seulement traduire le texte de l'utilisateur en forme structurée et poser des questions de clarification neutres.
16. QUAND l'hôte appelle la vérification pré-trade avec une intention de trade dont le contexte satisfait le déclencheur d'une règle, LE SYSTÈME DOIT renvoyer un rappel avec la règle, la situation d'origine et une version compatible du montant, **sans poser de question préalable**.
17. QUAND un trade reçu ne respecte pas une règle applicable (montant ou poids au-delà de la limite, délai non respecté), LE SYSTÈME DOIT l'enregistrer comme « règle ignorée », que la vérification pré-trade ait eu lieu ou non.
18. LE SYSTÈME NE DOIT NI bloquer, ni annuler, ni modifier un ordre, NI présenter le rappel comme un conseil financier personnalisé.

**API d'intégration (outil externe)**
19. LE SYSTÈME DOIT exposer une API authentifiée qui reçoit les événements de trade (utilisateur, moment, montant, information sur le trade), valide le schéma et applique l'idempotence sur `event_id`.
20. LE SYSTÈME NE DOIT NI créer de comptes, NI détenir de positions, NI exécuter, router, bloquer ou modifier des ordres.
21. QUAND des champs de contexte sont absents, LE SYSTÈME DOIT les calculer à partir du jeu de données si possible, sinon les marquer « inconnus », réduire le poids de la mise à jour et le signaler dans les preuves.
22. LE SYSTÈME DOIT accuser réception en moins de 2 secondes, traiter l'analyse de façon asynchrone, exposer le résultat par GET et notifier l'hôte par webhook signé (HMAC-SHA256).
22b. LE SYSTÈME DOIT traiter les événements par `executed_at` (et non par ordre d'arrivée) et tolérer doublons et retards.

**Après trade et dérive**
23. APRÈS chaque trade reçu, LE SYSTÈME DOIT mener automatiquement l'enquête (15.1), **sans poser de question à l'utilisateur**, et calculer les indicateurs objectifs (15.2).
23b. LE SYSTÈME DOIT n'utiliser les comptes liés d'un utilisateur qu'avec son **consentement explicite, par compte et révocable**, uniquement via des **API officielles**, sans scraping et sans lire de messages privés.
23c. LE SYSTÈME DOIT présenter la cause inférée comme une **hypothèse** avec niveau de confiance et preuves cliquables, ne jamais affirmer une causalité, et PEUT conclure « indéterminé ».
23d. LE SYSTÈME NE DOIT utiliser que des informations **publiées avant** l'heure du trade, et DOIT ne conserver que les **métadonnées** des nouvelles et les **signaux dérivés** des comptes liés, avec une durée de conservation configurable (30 jours par défaut) et une suppression à la demande.
23e. L'enquête et la mise à jour du profil et de l'indice de dérive DOIVENT être **entièrement automatiques** : aucune action de l'utilisateur n'est requise ni possible ; le dossier d'enquête reste consultable **en lecture seule** via le panneau de preuves, et chaque mise à jour DOIT appliquer les garde-fous de 15.1.
24. LE SYSTÈME DOIT calculer la sévérité du trade, mettre à jour l'indice de dérive, les traits et le **seuil de réévaluation personnel** de l'utilisateur (15.4), et créer une nouvelle version du profil avec ses preuves.
25. QUAND le seuil de réévaluation de l'utilisateur est franchi (15.4), LE SYSTÈME DOIT déclencher la réévaluation ciblée, notifier l'hôte (`reevaluation.required`) et afficher les trades responsables.
26. LORS d'une réévaluation, LE SYSTÈME DOIT montrer le problème et demander à l'utilisateur d'ajouter ou de resserrer des règles lui-même, et conserver l'historique des versions.

**Explicabilité et responsabilité**
27. TOUTE explication DOIT être produite à partir du dossier de preuves, et un validateur DOIT rejeter tout nombre absent des preuves.
28. LE SYSTÈME DOIT afficher pour chaque chiffre l'étiquette Réel, Hypothèse ou Fictif.
29. LE SYSTÈME DOIT afficher l'incertitude (intervalle, confiance) et dire « données insuffisantes » lorsque c'est le cas.
30. LE SYSTÈME NE DOIT PAS prédire des rendements futurs ni exposer le raisonnement interne détaillé des modèles.

---

## 17. Découpage des specs et plan de tâches (priorisé)

### Specs recommandées
`data-lake-and-episodes` · `scenario-director-and-triggers` · `simulation-session-and-capture` · `scoring-and-profile` · `reveal-and-counterfactuals` · `pact-and-rules` · `integration-api-and-test-console` · `investigation-agent-and-sources` · `guard-and-posttrade-drift` · `explainability-evidence` · `web-app` · `infra-cdk`.

### Jalons (chacun doit se terminer par quelque chose de démontrable)
| Jalon | Contenu | Résultat démontrable |
|---|---|---|
| **M0** | Infra CDK de base, S3, DynamoDB, Cognito, CI | Déploiement reproductible |
| **M1** | Pipeline de données : CSV → Parquet → Athena ; reconstruction de la bibliothèque (73 épisodes) ; tests point-in-time | Épisodes interrogeables, tests verts |
| **M2** | Session de simulation **sans IA** (épisodes tirés, sans stimulus) + capture des décisions + écran de simulation | Une personne peut jouer 4 scénarios |
| **M3** | Moteur de scoring (RT, LA, IMP) + révélation + profil révélé simple | Premier « tu as déclaré… tu as vendu à… » |
| **M4** | **Directeur de scénarios + Rédacteur + Validateur** (Bedrock) avec déclencheurs T00–T06 | Scénarios différents à chaque session |
| **M5** | Traits HYP, NEWS, VAL, DIV, DISP + déclencheurs T07–T14 + confiance + contrôle de reconnaissance | Profil complet à 8 traits |
| **M6** | Agent d'explicabilité + journal de preuves + panneau cliquable | Chaque chiffre est vérifiable |
| **M7** | Pacte (règles structurées) | Règles sauvegardées et versionnées |
| **M8** | API d'intégration (événements de trade, vérification pré-trade, webhooks signés, authentification, OpenAPI) + console de test de l'hôte | Un trade envoyé par la console met à jour le profil |
| **M8b** | Sources de l'enquête : adaptateur de **nouvelles publiques** (ingestion planifiée), **source sociale synthétique** + écran de consentements | Des signaux datés sont disponibles pour un trade |
| **M9** | Rappel pré-trade + **enquête automatique** (Agent enquêteur) + indice de dérive + **seuil de réévaluation personnel** + alerte + réévaluation | Boucle fermée |
| **M10** | Personas synthétiques et validation (section 18), polissage UX, documentation, README, one-pager, scripts de démo | Livrables prêts |

**Règle de priorité si le temps manque :** M0–M3 puis M4, M6, M7, M8, M9 ; M5 peut être réduit à HYP + NEWS ; ne sacrifie jamais le parcours de bout en bout, le garde-fou ni l'explicabilité.

---

## 18. Validation (critère « Données » : rigueur et validation)

1. **Personas synthétiques à vérité connue** : un agent (Bedrock) ou un simulateur paramétrique joue des utilisateurs avec des traits **connus** (ex. : « panique à −20 % », « suit les influenceurs à 80 % »). Test de **récupération des paramètres** : le moteur doit retrouver les traits dans l'intervalle annoncé ; mesurer erreur et couverture des intervalles.
2. **Stabilité (test-retest)** : mêmes traits, jeux de scénarios différents → profils proches.
3. **Sensibilité** : changer un seuil, une pondération, un type de déclencheur, et mesurer l'effet sur le profil et l'indice de dérive (tableau dans la documentation).
4. **Aucune fuite temporelle** : tests automatiques qui échouent si une donnée de marché ou macro utilisée pour une décision de simulation ou pour le contexte d'un trade reçu est postérieure au moment de la décision, du trade, ou à la date de publication estimée.
5. **Test d'anonymat** : scan automatique des textes et charges utiles contre la liste des noms, tickers, dates exactes et mots-clés distinctifs des actifs.
6. **Exactitude des contrefactuels** : les trajectoires de révélation sont comparées à un calcul indépendant direct sur les données.
7. **Fidélité des explications** : 100 % des nombres affichés sont retrouvables dans les preuves ; taux de rejet du validateur mesuré.
8. **Qualité des données** : contrôle des doublons, des valeurs aberrantes, du cas CNQ, de la couverture de calendrier et des conversions CAD/USD, journalisé.
9. **Test de bout en bout** (Playwright) : parcours complet Amira et Robert, avec les trades envoyés par la console de test.
10. **Tests de contrat de l'API** : validation OpenAPI, idempotence, événements en désordre, doublons, champs absents (indicateurs « inconnus »), signature des webhooks, authentification refusée.
11. **Validation de l'enquête** : sur des trades synthétiques à **cause connue** (trade placé peu après une publication fictive d'un compte suivi, après un pic de volume, après une perte, sans aucun signal), mesurer précision et rappel par catégorie, **calibration de la confiance** (les confiances de 0,7 sont-elles justes ~70 % du temps ?), taux de « indéterminé » et taux de **faux positifs** sur les trades sans signal ; comparer à un tirage aléatoire. Vérifier qu'aucun signal postérieur au trade n'est utilisé.

---

## 19. Contraintes et hypothèses à consigner dans `docs/ASSUMPTIONS.md`
Hypothèses initiales : seuils et poids (sections 8, 15) ; allocations de départ ; politique contrefactuelle du profil déclaré ; décalages de publication (45 j et 35 j) ; « vendre » = liquider la position concernée, « renforcer » = +25 % de la valeur de la position ; poids 0,5 des trades réels et des scénarios reconnus ; limites de position par défaut (5 % pour un titre non compris, 15 % pour les autres) ; **intégration** : le pseudonyme de l'hôte est lié au profil par un code de liaison saisi dans l'application web lors de l'inscription (ou par une assertion SSO de l'hôte) ; le contexte de marché d'un trade provient de l'hôte ou, à défaut, du jeu de données (31 actifs, jusqu'au 2026-11-12) ; seuils d'indicateurs de hype (+20 % / +40 % en 5 jours, volume z ≥ 2) ; **enquête** : fenêtre de 72 h, τ = 12 h, seuil de verdict 0,25, conservation 30 jours, source sociale synthétique dans la démonstration, source de nouvelles publiques à choisir et à documenter (licence, couverture). **Rien de cela n'est une vérité financière** : ce sont des paramètres de simulation expliqués et testables.

---

## 20. Livrables du datathon et récit de démo

### Livrables
1. **Prototype + code + README** (dépendances, sources de données, configuration, instructions de déploiement et de reproduction).
2. **Vidéo d'environ 5 minutes**.
3. **Documentation technique** : méthodes et justification ; sources, actifs, traitements, hypothèses ; mécanisme d'explicabilité avec un exemple reliant une conclusion aux données ; validations, limites, améliorations.
4. **One-pager** : problème, approche agentique, originalité, données, explicabilité, bénéfice utilisateur.
Kiro doit générer ces documents à partir du code et des specs, et tenir `docs/` à jour.

### Script de démo (≈ 5 min, deux situations contrastées)
| Temps | Contenu |
|---|---|
| 0:00–0:30 | Problème : « Ce que les clients disent ≠ ce qu'ils font » ; proposition de valeur |
| 0:30–2:00 | **Amira** : profil déclaré « risque élevé » ; simulation en mode démo (4 scénarios) ; un tweet fictif et une notification de perte déclenchent une vente à −31 % ; **à la fin des 4 scénarios seulement : révélation** (« Actif A, c'était Tesla ») |
| 2:00–2:45 | **Profil révélé** : « risque élevé » déclaré → observé modéré, confiance affichée ; clic sur un chiffre → panneau de preuves ; **Pacte** : deux règles |
| 2:45–3:45 | **Robert** : depuis la **console de test de l'hôte**, une vérification pré-trade pour un titre médiatisé qui vient de monter fortement ; **le système renvoie sa propre règle**, ce qui s'est passé en simulation et une version compatible du montant ; l'hôte envoie ensuite le trade (montant supérieur à la limite) : **règle ignorée** détectée automatiquement |
| 3:45–4:30 | Après-trade : **l'enquête automatique** trouve, dans les 3 heures précédant le trade, une publication d'un compte suivi (fictif) et un pic de volume → **cause probable « hype / influence sociale », confiance affichée, preuves cliquables** ; **indice de dérive** qui monte, **seuil de réévaluation personnel** qui baisse, **alerte de réévaluation** (webhook reçu par l'hôte), nouvelle règle **écrite par l'utilisateur** |
| 4:30–5:00 | Architecture AWS en une image, validation par personas synthétiques, limites, cas d'affaires, appel à l'action |

### Cas d'affaires pour le pitch
Évaluation d'adéquation du client fondée sur le comportement réel plutôt que déclaratif ; réduction des ventes à la panique et des achats sous l'effet du hype ; trace d'audit complète des décisions et des avertissements ; **intégration légère** : un simple appel d'API depuis la plateforme existante d'une banque ou d'un courtier en ligne, sans refonte de leur application ni détention de comptes ou de positions ; extensibilité (nouveaux actifs, nouvelles périodes, nouvelles données ESG et de nouvelles).

---

## 21. Annexe — Fichiers fournis avec ce document
- `data/starter/*.csv` : jeu de départ de l'organisation (prix, taux, devises, opérations sur titres, univers d'actifs, métadonnées) — à placer tel quel.
- `data/episode_library.json` : 73 épisodes réels masquables (section 5), générés par `reference/episode_miner.py`.
- `reference/episode_miner.py` : script de référence de la détection d'épisodes (à industrialiser dans le pipeline et à paramétrer via `config/episodes.yaml`).
- Documents de l'organisation (énoncé du défi, présentation) : à conserver dans `docs/organisation/` pour référence.
