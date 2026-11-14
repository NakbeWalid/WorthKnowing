# Hypothèses et écarts connus

Tout ce qui suit est une hypothèse de simulation, pas une vérité financière. Les valeurs sont dans `config/`.

## Hypothèses de mesure
- Chaque scénario repart d'un portefeuille fictif de 100 000 $ : 15 % dans l'actif testé, 10 % de
  liquidités, le reste supposé stable. Les scénarios sont indépendants les uns des autres.
- « Vendre » liquide la position ; « renforcer » ajoute 25 % de sa valeur depuis les liquidités.
- Tolérance au risque : régression logistique sur une grille (pente 0,15, a priori centré sur le
  seuil déclaré, écart-type 15). Les décisions prises avec stimulus comptent pour 0,3.
- Seuils de vente associés au risque déclaré : 10, 15, 25, 40 et 55 % de baisse.
- Une décision est « rapide » sous 3 secondes. Un scénario reconnu compte pour moitié.
- Un trait est « données insuffisantes » sous 2 décisions pertinentes. Le profil est « préliminaire »
  sous 60 % de confiance moyenne.
- Inflation et chômage décalés de 45 et 35 jours pour respecter leur date de publication.
- Contexte d'un trade : seules les séances antérieures au jour du trade sont utilisées.

## Écarts par rapport au brief (docs/BRIEF.md)
1. **Mode court : 3 arrêts par scénario** (environ 12 décisions, 4 minutes) au lieu de 2. Avec 2 arrêts,
   presque tous les traits restaient « données insuffisantes ».
2. **Sévérité d'un trade** : la cause probable est pondérée par la *force* de sa catégorie, pas par la
   confiance. La confiance (écart avec la deuxième hypothèse) devenait très basse quand plusieurs
   signaux forts coexistaient, ce qui faisait baisser la sévérité des pires trades. La confiance sert
   toujours à borner les ajustements de traits.
3. **Directeur de scénarios** : la version locale est une politique déterministe et adaptative
   (couverture des traits, dose-réponse sur l'intensité). Le choix par un modèle Bedrock se branche
   par `TextModel.choose_scenario` (prompt Kiro 4).
4. **Textes** (déclencheurs, explications, lecture des règles) : gabarits en local. Bedrock les
   remplace, sous contrôle des mêmes validateurs.
5. **Épisodes de portefeuille** (plusieurs actifs sur la même fenêtre, section 5.3) : non construits.
   Le conflit de valeurs utilise un épisode du secteur de l'énergie.
6. **Nouvelles** : fichier de démonstration fictif en local. L'ingestion de nouvelles publiques
   réelles est le prompt Kiro 7.
7. **Authentification** : aucune en local (clé de développement pour `/v1`). Cognito est le prompt Kiro 5.
8. **Enquête** : un signal social compte quel que soit son sens (une publication qui pousse à acheter
   compte aussi avant une vente). À affiner avec un champ de valence sur les publications.
9. **Événements en retard** : l'indice de dérive est rejoué dans l'ordre de `executed_at` ; les
   indicateurs des trades déjà traités ne sont pas recalculés.
10. **Validation statistique complète** (200 personas synthétiques, calibration) : seul un test de
    récupération de l'ordre des seuils existe. Le reste est le prompt Kiro 10.

## Limites des données
Biais du survivant (univers choisi en 2026), 5 ans seulement, données Yahoo non certifiées, aucune
donnée ESG (les valeurs de Mateo sont une exclusion de secteur), anomalie CNQ.TO du 2022-08-22 non
utilisée. Certaines valeurs macro (inflation très élevée) permettent de deviner l'époque.
