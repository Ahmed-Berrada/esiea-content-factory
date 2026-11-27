# 🏭 Usine à contenus ESIEA

Une Google Sheet « tour de contrôle » qui transforme **N contenus ESIEA** (vidéos + sous-titres, pages web, images)
en **X formats marketing** pour **Y canaux**, automatiquement et en masse. Les sorties arrivent dans Google Drive.
Aucun outil d'orchestration (Make, Zapier, n8n…) : le moteur est **notre code** (Google Apps Script lié à la Sheet,
plus un worker Python pour la vidéo, l'audio et les images).

```
Sheet (Config · Sources · Formats · Prompts · Ordres · Journal · Dashboard)
   │ ☑ une case cochée dans Ordres = un lot entier
   ▼
Apps Script ─ textes : blog, LinkedIn, thread X, chapitres YouTube, FAQ, sous-titres EN, carrousel PDF…
   │           IA par API (Gemini 3.8 Flash par défaut, Claude possible, modèle = 1 cellule) → contrôles auto → relecteur IA → Drive
Worker Python ─ clip 9:16 sous-titré, résumé audio (voix de synthèse), images 1:1 / 16:9 (recadrage intelligent)
   ▼
Drive : ESIEA_Content_Factory/02_Sorties/<FORMAT_ID>/<SOURCE>__<FORMAT>__vNN.<ext>
```

## Déploiement en 20 minutes

**Prérequis** : un compte Google, une clé API **Gemini en offre payante** (sur l'offre gratuite, Google peut utiliser les
données pour l'entraînement → interdit par la contrainte RGPD), Node.js (pour `clasp`), Python 3.11+ ou Colab.
Alternative prête à l'emploi : Claude (`PROVIDER = anthropic`, clé `API_KEY_ANTHROPIC`).

1. **Créer la Sheet + le script** (au choix) :
   - *Copie* : ouvrez la Sheet de référence › Fichier › Créer une copie (le script est copié avec elle). Passez à l'étape 2.
   - *Depuis ce dépôt* :
     ```
     npm install -g @google/clasp
     clasp login
     cd apps-script
     clasp create --type sheets --title "ESIEA Content Factory" --rootDir .
     clasp push -f
     ```
2. **Clé API** : dans l'éditeur Apps Script › ⚙ Paramètres du projet › Propriétés du script, ajoutez
   `API_KEY_GEMINI` = votre clé (aistudio.google.com › Get API key ; pour Claude : `API_KEY_ANTHROPIC`). (Jamais dans la Sheet, jamais dans le code.)
3. **Installer** : rechargez la Sheet › menu **🏭 Usine ESIEA › 1. Installer** (acceptez les autorisations).
   Cela crée les 7 onglets pré-remplis, l'arborescence Drive `ESIEA_Content_Factory/` et le déclencheur de la case à cocher.
4. **Charte** : déposez le logo officiel ESIEA (PNG transparent) dans `03_Gabarits/`, collez son ID dans
   `Config › LOGO_FILE_ID`, et vérifiez `COULEUR_PRIMAIRE / SECONDAIRE` avec les valeurs fournies.
5. **Sources** : déposez le corpus (vidéos `.mp4` + `.srt` de même nom, images) dans `01_Sources/`, puis
   menu **Importer les sources** et **Créer les extraits vidéo** (découpage automatique sur fins de phrases).
   Les pages de www.esiea.fr s'ajoutent à la main dans l'onglet Sources (type `web`, URL).
6. **Produire** : onglet **Ordres** › cochez `lancer` sur une ligne (ex. `sources = *`, `formats = RECETTE:STAR`).
   Le Journal se remplit, le Dashboard se met à jour, les fichiers apparaissent dans Drive.
7. **Worker média** (clips, audio, images) :
   - *Colab* : ouvrez `worker/colab_worker.ipynb`, ajoutez le secret `GEMINI_API_KEY`, collez l'ID de la Sheet, exécutez tout.
   - *Local* : `winget install Gyan.FFmpeg`, puis
     ```
     cd worker
     python -m venv .venv
     .venv\Scripts\pip install -r requirements.txt
     copy .env.example .env    # renseigner GEMINI_API_KEY et FACTORY_SHEET_ID
     .venv\Scripts\python worker.py --watch
     ```
     (créez un client OAuth « Application de bureau » dans Google Cloud et enregistrez-le en `worker/credentials.json`).
8. **Valider** : relisez, puis passez `valide_humain` à `O` dans le Journal. Rien ne part sans ce « O ».

## Les onglets

| Onglet | Rôle |
|---|---|
| **Config** | modèle IA, fournisseur, tarifs, ton par défaut, charte, limites (parallélisme, durées, relances) |
| **Sources** | une ligne par contenu source ; diagnostic automatique `exploitable` (trop court, vide, horodatages, coupé en pleine phrase) |
| **Formats** | une ligne par format : contraintes (car., mots, items, dimensions, durée), canal, prompt, gabarit de rendu, recettes |
| **Prompts** | toutes les consignes : règles « source de vérité », voix de marque, voix par canal, consigne par format, relecteur |
| **Ordres** | ☑ `lancer` = un lot ; `forcer_relance` = refaire même ce qui est OK (nouvelle version) |
| **Journal** | une ligne par sortie : statut, fichier, lien, modèle, tokens, coût, durée, contrôle auto, score relecteur, « généré par IA », `valide_humain` O/N, origine des médias, conforme O/N |
| **Dashboard** | formules : fait / en cours / erreur, taux de réussite et de conformité, coût par sortie et par format, projection 1 000 sorties |

## Ajouter un format en 15 minutes, sans code
1. **Prompts** : nouvelle ligne `P_MONFORMAT` avec la consigne (variables `{{ton}} {{public}} {{longueur}} {{min_items}}`…).
2. **Formats** : nouvelle ligne `MONFORMAT` : canal, `prompt_id = P_MONFORMAT`, `sortie` (`md`, `txt`, `json`,
   `pdf_carrousel`, `pdf_infographie`), contraintes, `rendu` (ex. `{{titre}}\n\n{{contenu}}` ou `{{#items}}- {{texte}}\n{{/items}}`).
3. **Ordres** : `formats = MONFORMAT`, cocher `lancer`. Le dossier Drive est créé au premier fichier.

**Option Claude (coûts minimaux)** : `PROVIDER = anthropic`, modèle Haiku 5.5 (0,10 $ / 0,50 $ par million de tokens), effort `low`, sorties JSON
garanties par schéma, et cache de prompt : les règles + la voix de marque, puis la source, sont relues à 10 % du prix
quand une même source est déclinée en plusieurs formats. Le Journal enregistre le coût réel de chaque sortie.

**Changer de modèle** : `Config › MODEL` (ex. `claude-sonnet-5-5` pour plus de finesse). **Changer de fournisseur** :
`Config › PROVIDER` (`anthropic`, `gemini`, `openai`) + propriété de script `API_KEY_<PROVIDER>`. Chaque ligne du Journal garde le modèle utilisé.

## Données (RGPD)
- **Ce qui est envoyé aux IA** : le texte des sous-titres / pages publiques ESIEA, *après anonymisation automatique*
  (e-mails, téléphones, « je m'appelle X », noms listés dans `Config › NOMS_A_ANONYMISER`), et les images à recadrer
  si `VISION_MODE = gemini` (sinon détection 100 % locale avec OpenCV).
- **Fournisseur** : API Gemini en **offre payante** (les données ne servent pas à l'entraînement) ; même garantie avec
  l'API Claude si l'on bascule `PROVIDER = anthropic`. Détection d'images 100 % locale par défaut.
- **Clés** : propriétés du script Apps Script et fichier `.env` / secrets Colab, jamais dans la Sheet ni le dépôt.
- **Personnes réelles** : aucune image de personne générée ; voix de synthèse génériques prédéfinies (pas de clonage) ;
  les consignes interdisent toute citation attribuée et le nom des personnes ; le relecteur IA le vérifie.
- **Médias** : uniquement les vidéos/images sources ESIEA (recadrées, jamais régénérées), le logo officiel tel quel,
  et une musique libre de droits déclarée dans Config ; l'origine est écrite dans `Journal › origine_medias`.

## Structure du dépôt
```
apps-script/   moteur lié à la Sheet (Common, Text, Llm, Sources, Orders, Engine, Output, Setup, SeedData)
worker/        worker Python : worker.py, imaging.py (3-B), video.py, audio.py, gemini.py, gsheets.py, colab_worker.ipynb
tests/         tests hors ligne : node --test tests/gs.test.js · python -m pytest tests/
docs/          COUTS.md (note de coûts) · QUESTIONS.md (réponses aux questions du challenge) · DEMO.md (script vidéo 3 min)
```

Projet réalisé dans le cadre du challenge « Content Repurposing à l'échelle » — ESIEA.
