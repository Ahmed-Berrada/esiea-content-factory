# Plan — Usine à contenus ESIEA (Challenge 3-A Vidéo→Texte + 3-B Reformatage d'images)

## 1. Architecture retenue

```
 Google Sheet (tour de contrôle)            Moteur (notre code)                    Google Drive
 ┌──────────────────────────┐   menu /   ┌───────────────────────────────┐      ┌────────────────────┐
 │ Config  Sources  Formats │  checkbox  │ A. Apps Script (lié à la Sheet)│      │ /ESIEA_Factory/    │
 │ Prompts Ordres   Journal │ ─────────► │   - formats TEXTE (LLM via API)│ ───► │  01_Sources/       │
 │ Dashboard                │            │   - Slides→PDF (carrousel...)  │      │  02_Sorties/<fmt>/ │
 └──────────────────────────┘ ◄──────────│   - triggers par lots (<6 min) │      │  03_Gabarits/      │
         ▲  statuts / coûts              │ B. Worker Python (local/Colab) │      │  04_Logs/          │
         └───────────────────────────────│   - ffmpeg : clips 9:16, srt   │      └────────────────────┘
                                         │   - images 1:1 / 16:9 (smart   │
                                         │     crop + fond flou/ESIEA)    │
                                         │   - TTS voix générique         │
                                         └───────────────────────────────┘
```

- **Apps Script** = cœur (exigé : copie de la Sheet = copie de l'usine). Gère tout ce qui est texte + PDF.
- **Worker Python** = ce qu'Apps Script ne sait pas faire (ffmpeg, traitement d'image). Il lit la même Sheet
  (API Google Sheets, compte de service), prend les ordres `media` en statut `A_FAIRE`, écrit dans Drive et le Journal.
  Lançable en local (`python worker.py`) ou en notebook Colab (zéro install).
- **Aucun Make/Zapier/n8n.**

## 2. Les 7 onglets de la Sheet

| Onglet | Contenu |
|---|---|
| **Config** | `MODEL` (ex. `gemini-2.5-flash`), `PROVIDER`, `TEMPERATURE`, `DRIVE_ROOT_ID`, `BATCH_SIZE`, prix /1M tokens, ton global, couleurs ESIEA, `TONE_OF_VOICE` (prompt fourni) |
| **Sources** | `source_id` (SRC-001…), type (video/srt/page web/image), titre, URL/Drive ID, langue, durée, `exploitable` (auto : longueur, vide, mal découpé), anonymisé O/N |
| **Formats** | `format_id`, niveau ★1/2/3, type (text/media), canal, prompt_id, contraintes (min/max caractères, mots, nb items, dimensions, durée), extension, sous-dossier |
| **Prompts** | `prompt_id`, consigne paramétrable `{{ton}} {{public}} {{longueur}} {{source}}`, + prompts tone-of-voice par canal (LinkedIn, X, Insta, blog, YouTube) |
| **Ordres** | une ligne = source × liste de formats (ou « recette »), case ☑ `Lancer`, `forcer_relance` ; les sous-commandes sont générées automatiquement |
| **Journal** | 1 ligne par sortie : output_id, source_id, format, fichier + lien, statut (A_FAIRE/EN_COURS/OK/ERREUR/REJETÉ), modèle, tokens in/out, coût, durée, contrôle auto (OK/KO + raison), score relecteur IA, « généré par IA » = O, `validé humain` O/N, origine des médias |
| **Dashboard** | formules : fait / en cours / erreur par format & source, taux de réussite, coût total, coût / sortie, projection 1 000 sorties, graphique |

## 3. Pipeline d'une sortie texte
1. Ordre coché → `onEdit` installable crée les lignes du Journal (idempotent : clé `source_id|format_id`, on saute les `OK`).
2. Traitement par lots de `BATCH_SIZE` ; un trigger temporel relance la suite → contourne la limite 6 min (200 sorties OK).
3. Source = transcription .srt nettoyée (+ découpage en morceaux si trop long → résumé map-reduce).
4. Prompt = Tone of voice canal + consigne du format + **règle « source de vérité »** (n'utiliser que les faits du texte) → réponse **JSON** (schéma imposé, `responseMimeType: application/json`), retry si JSON invalide.
5. **Contrôles auto** : longueurs/nombre d'items depuis l'onglet Formats + **vérif anti-invention** : tout chiffre / date / nom propre de la sortie doit exister dans la source (regex) → sinon REJETÉ + 1 régénération.
6. **Relecteur IA** (modèle léger) : fidélité, fait inventé, ton → score ; < seuil → REJETÉ.
7. Écriture Drive : `02_Sorties/<format>/<source_id>__<format_id>__v<n>.<ext>` ; mise à jour Journal + Dashboard.

## 4. Formats visés
**Niveau 1 (★ texte, MVP)** : article de blog, post LinkedIn, thread X/tweets, chapitrage YouTube (horodaté depuis le .srt), + description YouTube, FAQ, newsletter, citations-clés (paraphrases, pas de fausses citations).
**Niveau 2** : sous-titres traduits EN (horodatages conservés, glossaire d'intitulés officiels non traduits), carrousel LinkedIn/Insta PDF via gabarit Google Slides ESIEA, infographie / fiche résumé PDF.
**Niveau 3 (worker Python)** : clips courts 9:16 (passages clés détectés via le srt, coupes sur phrases complètes, sous-titres incrustés, recadrage sur le visage), audio/podcast résumé TTS voix générique (lexique de prononciation ESIEA → « é-ss-i-é-a »), **3-B images 1:1 et 16:9** (détection visage/personne/texte → cadre qui garde le sujet ; si impossible → fond flou ou aplat ESIEA, jamais d'étirement).

## 5. Contraintes du challenge → réponse
| # | Contrainte | Réponse |
|---|---|---|
| 1 | Pas de copier-coller chat | appels API depuis Apps Script / worker, déclenchés par case cochée |
| 2 | Prompts dans la Sheet | onglet Prompts, rien dans le code |
| 3 | Modèle = cellule Config, tracé dans Journal | `Config!MODEL`, colonne `modèle` |
| 4 | Budget | tokens réels × prix Config → coût / sortie, projection 1 000 |
| 5 | Source de vérité | règle de prompt + contrôle regex des faits + relecteur IA |
| 6 | Charte | logo / Roboto / General Sans / couleurs dans gabarits Slides et overlays ; IA ne dessine jamais le logo |
| 7 | Pas de personne réelle | pas de génération d'image de personne, TTS voix générique, pas de citation attribuée |
| 8 | Données perso | anonymisation regex (noms, emails, tél.) avant appel ; API payante/no-training ; section README « Données » |
| 9 | Médias libres | images source ESIEA ou fonds générés ; musique libre ; colonne origine |
| 10 | Transparence IA | Journal : `généré_par_IA=O`, `validé_humain` O/N (seul geste humain : cocher après relecture) |

## 6. Dépôt GitHub `esiea-content-factory`
```
apps-script/   Code.gs, Orders.gs, Llm.gs, Checks.gs, Drive.gs, Slides.gs, Dashboard.gs, appsscript.json, .clasp.json
worker/        worker.py, video.py, images.py, tts.py, sheets.py, requirements.txt, colab.ipynb
sheet-template/ seed CSV des onglets (Config, Formats, Prompts) + setup() qui crée les onglets
docs/          README (déploiement 1 page), COSTS.md (note de coûts), QUESTIONS.md (réponses aux questions), DEMO.md (script vidéo 3 min)
tests/         tests des contrôles (longueur, faits, JSON) et du smart-crop
```
Clés API : **PropertiesService** (Apps Script) et `.env` (worker, gitignoré) — jamais dans la Sheet ni le code.

## 7. Étapes de réalisation
1. Init repo + squelette + README ; création GitHub (`gh auth login` requis).
2. Apps Script : `setup()` crée les 7 onglets + données seed + arborescence Drive.
3. Couche LLM paramétrable (Gemini / OpenAI / Claude selon `Config!PROVIDER`), JSON + retries + backoff 429.
4. Ordres → Journal (recettes, idempotence, lots + triggers), contrôles auto, relecteur.
5. Formats niveau 1 → test sur les 2 vidéos du corpus.
6. Niveau 2 : traduction srt, gabarits Slides → PDF.
7. Worker Python : smart crop images (3-B), clips 9:16, TTS.
8. Dashboard + note de coûts + README + QUESTIONS.md + script démo.
9. Déploiement via `clasp push`, run sur le corpus, vérif Drive/Journal.

## 8. Ce dont j'ai besoin de toi
- **GitHub** : lancer `gh auth login` (je ne peux pas me connecter à ta place).
- **Google** : `clasp login` (pour pousser l'Apps Script) + un compte de service ou OAuth pour le worker Python.
- **Clé API IA** (que tu saisiras toi-même dans les Script Properties / `.env`).
- **Corpus** : télécharger le dossier Drive des 2 vidéos + .srt dans `corpus/` (lien partagé du prof) — ou me donner l'accès via le connecteur Drive.
- **Charte** : logo ESIEA officiel (PNG/SVG) + couleurs exactes.
- ffmpeg n'est pas installé : `winget install Gyan.FFmpeg` (ou on fait tourner la vidéo dans Colab).
