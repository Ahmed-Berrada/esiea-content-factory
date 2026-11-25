# Réponses aux « questions à se poser »

## Pilotage depuis la Sheet
- **Un lot en cochant une case ?** Déclencheur installable `onEdit` : cocher `Ordres › lancer` crée toutes les lignes
  du Journal (sources × formats) puis lance la file de traitement.
- **Représenter une recette ?** Chaque format porte des étiquettes (`Formats › recettes`, ex. `STAR`, `VIDEO`, `IMAGES`)
  et chaque source une recette (`Sources › recette`). Un ordre avec `formats` vide applique à chaque source sa recette ;
  `RECETTE:STAR` force une recette. Les dépendances (`depend_de`) sont ajoutées automatiquement.
- **Relancer sans refaire ce qui est OK ?** Clé (source, format) : si une sortie OK/en cours existe, elle est sautée.
  `forcer_relance` crée une nouvelle version (`v02`). Menu *Relancer les erreurs* ne reprend que ERREUR/REJETE.
- **Limite des 6 minutes ?** Chaque exécution s'arrête à `BATCH_TIME_LIMIT_S` (280 s), puis se reprogramme via un
  déclencheur ponctuel ; l'état est dans le Journal, donc rien n'est perdu. 200 sorties = ~15 exécutions enchaînées.
- **Le Dashboard sait ce qui est fait ?** Il est 100 % formules sur le Journal (COUNTIFS / SUMIFS) : mis à jour à chaque écriture.

## Préparation des sources
- **Extrait exploitable ?** `preparerSources()` calcule nb de mots, durée, horodatages valides et croissants,
  coupe en pleine phrase → `exploitable` OUI/NON + `diagnostic`. Les sources NON sont exclues des ordres.
- **Source trop longue ?** Au-delà de `MAX_SOURCE_CHARS`, condensation par morceaux (map-reduce) en conservant
  chiffres, noms et horodatages. Les vidéos sont aussi découpées en extraits de ~2 min (fins de phrases).
- **Relier chaque fichier à sa source ?** Nom `SOURCE__FORMAT__vNN.ext`, rangé dans `02_Sorties/FORMAT/`,
  et ligne du Journal avec `output_id`, `source_id`, `file_id`, lien.

## Consignes et qualité
- **Une consigne par format, paramétrable ?** Onglet Prompts : `P_<FORMAT>` avec variables `{{ton}}`, `{{public}}`,
  `{{longueur}}`, `{{min_items}}`… remplies depuis Ordres (ou Config par défaut). Assemblage : règles + voix de marque
  + voix du canal + consigne du format + source.
- **Empêcher l'invention ?** (1) règle « source de vérité » dans chaque consigne ; (2) l'IA liste ses `faits_sources` ;
  (3) contrôle automatique : tout nombre, sigle ou nom propre de la sortie doit exister dans la source (sinon régénération
  avec la liste des faits fautifs) ; (4) relecteur IA `fait_invente`.
- **Vérifier les contraintes ?** `checkConstraints_` lit l'onglet Formats : caractères, mots, nb d'items, longueur
  de chaque item (tweets ≤ 280), horodatages (chapitres à 00:00, croissants, ≥ 10 s), durée des passages ; le worker
  vérifie dimensions et durée réelles avec ffprobe / PIL.
- **Seconde IA ?** Oui, modèle plus léger (`REVIEW_MODEL`) : fidélité, fait inventé, ton, citations. Score < 7 ou
  fait inventé → régénération avec ses remarques (2 max), puis REJETE (fichier dans `_REJETS`, visible et relançable).
- **Voix de marque sur 500 sorties ?** Un seul prompt `TOV_MARQUE` ajouté à toutes les consignes, décliné par canal
  (`TOV_LINKEDIN`, `TOV_X`…) ; le menu *Générer le tone of voice d'un canal* le dérive d'exemples réels.
- **JSON fiable ?** Mode JSON natif + schéma (`responseSchema`) ; sinon nettoyage (```json, virgules) puis 1 relance
  « JSON uniquement » ; échec → ERREUR visible.

## Vidéo et audio
- **Passages clés ?** Format `MOMENTS_CLES` : l'IA lit la transcription horodatée et renvoie des passages (début/fin),
  contrôlés (dans la source, durée bornée).
- **10 s qui commencent et finissent sur une phrase ?** Le worker recale début après une ponctuation finale et fin sur
  une ponctuation finale, dans la plage de durée du format.
- **16:9 → 9:16 sans couper la personne ?** Détection de visages toutes les 0,5 s, abscisse médiane, cadre 9:16 centré dessus.
- **Sous-titres lisibles ?** ASS incrusté par ffmpeg : Roboto gras 68 px, 2 lignes de 26 car. max, encadré aux couleurs
  ESIEA, marge basse hors interface Reels/Shorts.
- **Où tourne ffmpeg ?** Worker Python, en local ou dans Colab (ffmpeg préinstallé), piloté par la même Sheet.
- **Prononciation des sigles ?** `Config › LEXIQUE_PRONONCIATION` (ESIEA → E-S-I-E-A, IA → I-A…) appliqué avant TTS.

## Images et mise en page
- **5 formats sans déformer ?** Une ligne Formats par taille ; recadrage intelligent (vision Gemini ou OpenCV), cadre
  contenant toutes les zones critiques, mise à l'échelle uniforme ; repli fond flou/couleur ESIEA si le sujet ne tient pas.
- **Gabarit aux couleurs ESIEA → PDF ?** Google Slides généré (taille de page = Formats), couleurs/polices de Config,
  logo officiel inséré depuis Drive, export PDF ; la version éditable est rangée dans `05_Editables`.
- **Texte lisible quelle que soit sa longueur ?** `fitFontSize_` calcule la taille de police pour chaque cadre ;
  les consignes bornent la longueur par item et le contrôle le vérifie.

## Traduction
- **Intitulés officiels ?** `GLOSSAIRE_NON_TRADUIT` injecté dans la consigne + contrôle qu'ils sont conservés.
- **Horodatages ?** On n'envoie que le texte numéroté des repères ; les horodatages d'origine sont recopiés ; contrôle
  du nombre de repères.

## Passage à l'échelle et coûts
- **Coût par sortie / 1 000 ?** Voir `docs/COUTS.md` et le Dashboard (coût réel par ligne du Journal).
- **Limites de débit ?** Attente exponentielle sur 429/5xx, `MAX_RETRIES`, parallélisme réglable.
- **Échec d'une source/sortie ?** Le lot continue ; la ligne passe en ERREUR avec la raison ; menu de relance.
- **80 sorties en 45 min ?** 3 exécutions Apps Script parallèles (+ worker multi-threads) → ~10 min.

## Paramétrabilité et déploiement
- **Nouveau format en 15 min ?** Une ligne Prompts + une ligne Formats (gabarit `rendu`), aucun code (cf. README).
- **Changer de modèle / fournisseur ?** `Config › MODEL` / `PROVIDER` ; tracé dans `Journal › modele`.
- **Clés d'API ?** Propriétés du script (Apps Script) et `.env` / secrets Colab (worker), hors Sheet et hors dépôt.
- **Déploiement en 20 min ?** Copie de la Sheet (script inclus) + clé + menu Installer (cf. README).

## Responsabilité
- **Signaler l'IA / valider ?** `Journal › genere_par_ia = O` et `valide_humain` O/N (N par défaut) : le chargé de
  communication relit et passe à O ; le Dashboard compte les sorties validées.
- **Aucune personne imitée ?** Pas de génération d'image de personne, voix génériques prédéfinies, consignes et
  relecteur interdisant citations attribuées et noms.
- **Aucune donnée personnelle ?** Anonymisation automatique avant chaque appel (colonne `Sources › anonymise`),
  offre API payante sans entraînement, détection d'images en local possible (`VISION_MODE = opencv`).
