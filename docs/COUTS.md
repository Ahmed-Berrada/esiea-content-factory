# Note de coûts — coût et temps par unité produite

> **Estimations avant production.** Les coûts réels sont calculés pour chaque sortie dans `Journal › cout_usd`
> (tokens réellement facturés × tarifs de `Config`) et agrégés dans le **Dashboard** (coût moyen par format,
> projection 1 000 sorties). Remplacer ce tableau par les chiffres du Dashboard après le premier lot, et joindre
> le relevé d'usage de Google AI Studio (Facturation › Utilisation).

## Hypothèses
- Modèle principal : `gemini-3.8-flash` (0,75 $ / 1M tokens entrée, 3,75 $ / 1M sortie réflexion incluse — tarif 2026,
  doublé au 01/01/2027). Secours et relecteur : `gemini-3.5-flash-lite` (0,30 $ / 2,50 $). Voix : `gemini-3.8-flash-tts`
  (0,50 $ texte, 9 $ / 1M tokens audio ≈ 25 tokens par seconde). Tarifs relevés sur la page officielle le 27/11/2026.
- Source type = extrait vidéo de 2 min (~300 mots). Consigne complète (règles + voix de marque + canal + format) ≈ 1 300 tokens.
- 1,2 génération en moyenne par sortie (régénération si un contrôle échoue). Sortie plafonnée à 4 096 tokens.
- Apps Script, Drive, Sheets, Colab : gratuits dans les quotas d'un compte Google. Pas d'abonnement d'orchestration.

## Mesures réelles (premier test, 27/11/2026, source = page d'accueil esiea.fr)
| Sortie | Modèle | Tokens entrée / sortie | Coût | Durée | Contrôle |
|---|---|---|---|---|---|
| Post LinkedIn | gemini-3.8-flash | 4 158 / 537 | 0,0063 $ | 220 s (API surchargée, 503) | OK, relecteur 10/10 |
| Thread X v01 | gemini-3.5-flash-lite | 8 277 / 8 587 | 0,025 $ | 23 s | OK (boucle de génération, corrigée depuis) |
| Thread X v02 | gemini-3.5-flash-lite | 8 313 / 681 | 0,0054 $ | 7 s | OK mais accents manquants → contrôle ajouté |

⚠️ Le tableau « Par format » ci-dessous date de la v1 de cette note (anciens tarifs Gemini 2.5) : multiplier par ≈ 2,5
pour les tarifs actuels, et le remplacer par les moyennes du Dashboard après le premier lot complet.

## Par format

| Format | Tokens entrée / sortie (approx.) | Coût IA / sortie | Temps / sortie |
|---|---|---|---|
| Post LinkedIn | 1,8 k / 0,5 k + relecture | ≈ 0,0025 $ | 8–15 s |
| Thread X | 1,8 k / 0,6 k + relecture | ≈ 0,0028 $ | 8–15 s |
| Article de blog | 1,9 k / 1,5 k + relecture | ≈ 0,0055 $ | 15–30 s |
| Chapitrage YouTube (vidéo 12 min) | 4,5 k / 0,3 k + relecture | ≈ 0,0030 $ | 8–15 s |
| FAQ | 1,9 k / 0,9 k + relecture | ≈ 0,0035 $ | 10–20 s |
| Sous-titres EN (vidéo 12 min) | 6 k / 6 k (sans relecture) | ≈ 0,017 $ | 30–60 s |
| Carrousel PDF | 1,9 k / 0,7 k + relecture | ≈ 0,0030 $ | 20–40 s (génération Slides + PDF) |
| Passages clés (JSON) | 2 k / 0,3 k + relecture | ≈ 0,0016 $ | 6–12 s |
| Clip 9:16 sous-titré | 0 (ffmpeg local/Colab) | 0 $ | 30–90 s |
| Script audio + MP3 (90 s) | TTS : 0,4 k / 2,3 k audio | ≈ 0,025 $ | 30–60 s |
| Image 1:1 ou 16:9 | vision : 0,4 k / 0,15 k (ou 0 en mode OpenCV) | ≈ 0,0005 $ (0 $) | 3–8 s |

## Projection 1 000 sorties
- **Mix des 8 formats ★** (blog, LinkedIn, thread X, chapitres, FAQ, sous-titres EN, carrousel, clip) :
  ≈ 0,006 $ en moyenne (mesuré : 0,005–0,006 $ par sortie texte) → **≈ 6 $ pour 1 000 sorties** en 2026, ≈ 12 $ aux tarifs 2027.
- **Pire cas** (uniquement audio) : ≈ 25 $ ; **meilleur cas** (images en mode OpenCV) : 0 $.
- **Temps** : ≈ 15 s par sortie texte, 3 exécutions Apps Script en parallèle → ≈ 5 s « mur » par sortie,
  soit **80 sorties ≈ 7–10 min** et **1 000 sorties ≈ 1 h 30** (au-delà : augmenter `PARALLEL_WORKERS`, limite ≈ 20).
- **Limites de débit** : offre payante niveau 1 Gemini Flash ≈ 1 000 requêtes/min → non bloquant. Les erreurs 429
  déclenchent une attente exponentielle puis une nouvelle tentative (`MAX_RETRIES`).
- **Temps humain** : ≈ 20 s de relecture par sortie pour passer `valide_humain` à O (le seul geste indispensable),
  contre ≈ 20–45 min de rédaction manuelle par contenu décliné.

## Comparaison
| | Manuel | Usine |
|---|---|---|
| 1 message → 8 formats | 3–4 h (rédaction + mise en page + montage) | ≈ 3 min machine + 3 min de relecture |
| Coût marginal | temps salarié | ≈ 0,04 $ |
| Abonnements | outils de design / montage | aucun (Google + API à l'usage) |
