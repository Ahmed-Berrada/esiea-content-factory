/**
 * SeedData.gs — contenu initial des onglets (copié UNE fois par installer()).
 * Ensuite tout se modifie dans la Sheet : ce fichier n'est plus lu.
 */

function seedConfig_() {
  return [
    ['PROVIDER', 'anthropic', 'Fournisseur IA : anthropic (Claude) | gemini | openai (clé dans Propriétés du script : API_KEY_<PROVIDER>)'],
    ['MODEL', 'claude-haiku-5-5', 'Modèle principal — changer cette cellule suffit pour changer de modèle'],
    ['MODEL_SECOURS', 'claude-sonnet-5-5', 'Modèle utilisé automatiquement si MODEL est surchargé (HTTP 503/429)'],
    ['REVIEW_ENABLED', 'TRUE', 'Relecture de chaque sortie par une seconde IA'],
    ['REVIEW_MODEL', 'claude-haiku-5-5', 'Modèle du relecteur (moins cher)'],
    ['REVIEW_MIN_SCORE', 7, 'Score minimal (sur 10) pour accepter une sortie'],
    ['TEMPERATURE', 0.6, ''],
    ['MAX_OUTPUT_TOKENS', 4096, 'Plafond de sortie : coupe les boucles de génération (une sortie texte fait < 2 000 tokens)'],
    ['LANGUE_SORTIE', 'fr', 'Langue des sorties : contrôle automatique de la présence des accents en français'],
    ['THINKING_BUDGET', 0, 'Modèles Gemini 2.5 : 0 = pas de « réflexion » facturée'],
    ['EFFORT', 'low', 'Claude : effort de réflexion low | medium | high — low suffit pour des textes courts et coûte le moins'],
    ['THINKING_LEVEL', 'low', 'Modèles Gemini 3.x : low | medium | high (réflexion facturée en tokens de sortie)'],
    ['MAX_REGENERATIONS', 2, 'Nouvelles tentatives quand une sortie échoue aux contrôles'],
    ['MAX_RETRIES', 3, 'Tentatives en cas d\'erreur API (429, 5xx)'],
    ['PARALLEL_WORKERS', 3, 'Exécutions Apps Script simultanées'],
    ['BATCH_TIME_LIMIT_S', 280, 'Durée max d\'une exécution avant reprogrammation (limite Google : 360 s)'],
    ['MIN_MOTS_SOURCE', 80, 'En dessous : source non exploitable'],
    ['EXTRAIT_DUREE_S', 120, 'Durée cible d\'un extrait vidéo (menu Créer les extraits)'],
    ['MAX_SOURCE_CHARS', 60000, 'Au-delà : la source est condensée par morceaux'],
    ['SRT_BATCH', 80, 'Repères de sous-titres traduits par appel'],
    ['TOV_ACTIF', 'TOV_MARQUE', 'Prompt de voix de marque ajouté à chaque consigne (onglet Prompts)'],
    ['TON_DEFAUT', 'chaleureux, pédagogique et assertif', 'Valeur par défaut de {{ton}}'],
    ['PUBLIC_DEFAUT', 'lycéens, étudiants et parents intéressés par les études d\'ingénieur du numérique', 'Valeur par défaut de {{public}}'],
    ['LONGUEUR_DEFAUT', 'standard', 'court | standard | long'],
    ['LANGUE_TRADUCTION', 'anglais', ''],
    ['GLOSSAIRE_NON_TRADUIT', 'ESIEA; Grande École', 'Intitulés officiels à ne jamais traduire (séparés par ;)'],
    ['TERMES_AUTORISES', 'ESIEA; IA; LinkedIn; YouTube; Instagram; TikTok; X; FAQ; Q; R', 'Termes que le contrôle « faits inventés » accepte même s\'ils ne sont pas dans la source'],
    ['NOMS_A_ANONYMISER', '', 'Noms de personnes à masquer avant envoi à l\'IA (séparés par ;)'],
    ['COULEUR_PRIMAIRE', '#002D72', 'Charte ESIEA — à remplacer par la valeur officielle fournie'],
    ['COULEUR_SECONDAIRE', '#E4003A', 'Charte ESIEA — à remplacer par la valeur officielle fournie'],
    ['COULEUR_FOND', '#FFFFFF', ''],
    ['COULEUR_TEXTE', '#1A1A1A', ''],
    ['POLICE_TITRE_SLIDES', 'Roboto', 'General Sans n\'existe pas dans Google Slides → utilisée par le worker (vidéo/images)'],
    ['POLICE_TEXTE_SLIDES', 'Roboto', ''],
    ['LOGO_FILE_ID', '', 'ID Drive du logo ESIEA officiel (PNG transparent) — jamais redessiné par l\'IA'],
    ['FOND_REPLI', 'flou', 'Images 3-B : flou | couleur (quand le sujet ne tient pas dans le cadre)'],
    ['VISION_MODE', 'opencv', 'Images 3-B : opencv (détection locale, gratuite) | gemini (IA de vision, payante)'],
    ['VISION_MODEL', 'gemini-3.8-flash', ''],
    ['TTS_MODEL', 'gemini-3.8-flash-tts', 'Voix de synthèse générique (jamais clonée)'],
    ['TTS_VOICE', 'Kore', 'Voix générique prédéfinie'],
    ['LEXIQUE_PRONONCIATION', 'ESIEA=E-S-I-E-A; IA=I-A; cyber=cybère', 'Remplacements appliqués au texte avant synthèse vocale'],
    ['MUSIQUE_FILE_ID', '', 'Musique libre de droits (Drive) pour le fond audio — vide = sans musique'],
    ['MUSIQUE_LICENCE', '', 'Licence / origine de la musique (reportée dans le Journal)'],
    ['PRIX_IN:claude-haiku-5-5', 0.10, '$ / 1M tokens entrée (Claude Haiku 5.5) — lecture du cache facturée 0,1x, écriture 1,25x'],
    ['PRIX_OUT:claude-haiku-5-5', 0.50, '$ / 1M tokens sortie'],
    ['PRIX_IN:claude-sonnet-5-5', 2.00, 'Claude Sonnet 5.5 (modèle de secours)'],
    ['PRIX_OUT:claude-sonnet-5-5', 10.00, ''],
    ['PRIX_IN:gemini-3.8-flash', 0.75, '$ / 1M tokens entrée — tarif 2026 (1,50 à partir du 01/01/2027), vérifier sur ai.google.dev/pricing'],
    ['PRIX_OUT:gemini-3.8-flash', 3.75, '$ / 1M tokens sortie, réflexion incluse (7,50 à partir du 01/01/2027)'],
    ['PRIX_IN:gemini-3.5-flash-lite', 0.30, ''],
    ['PRIX_OUT:gemini-3.5-flash-lite', 2.50, ''],
    ['PRIX_IN:gemini-3.8-flash-tts', 0.50, 'texte (1,00 à partir du 01/01/2027)'],
    ['PRIX_OUT:gemini-3.8-flash-tts', 9.00, 'tokens audio (18,00 à partir du 01/01/2027)'],
    ['PRIX_IN_DEFAUT', 0.10, 'Tarif utilisé si le modèle n\'a pas de ligne PRIX_IN:<modele>'],
    ['PRIX_OUT_DEFAUT', 0.50, ''],
    ['DRIVE_ROOT_ID', '', 'Rempli par l\'installation'],
    ['SOURCES_FOLDER_ID', '', 'Rempli par l\'installation'],
    ['SORTIES_FOLDER_ID', '', 'Rempli par l\'installation'],
    ['GABARITS_FOLDER_ID', '', 'Rempli par l\'installation']
  ];
}

function seedFormats_() {
  // format_id, nom, niveau, etoile, moteur, canal, prompt_id, sortie, types_source,
  // min_car, max_car, min_mots, max_mots, min_items, max_items, item_max_car,
  // largeur, hauteur, duree_min_s, duree_max_s, depend_de, recettes, actif, rendu
  var V = 'video extrait', ALL = 'video extrait web texte';
  return [
    ['BLOG', 'Article de blog', 1, '★', 'apps_script', 'blog', 'P_BLOG', 'md', ALL, '', '', 450, 1000, 3, 6, '', '', '', '', '', '', 'STAR,TEXTE', 'OUI',
      '# {{titre}}\\n\\n{{contenu}}\\n\\n{{#items}}## {{titre}}\\n\\n{{texte}}\\n\\n{{/items}}'],
    ['LINKEDIN', 'Post LinkedIn', 1, '★', 'apps_script', 'linkedin', 'P_LINKEDIN', 'txt', ALL, 500, 1800, '', '', '', '', '', '', '', '', '', '', 'STAR,TEXTE', 'OUI',
      '{{contenu}}\\n\\n{{hashtags}}'],
    ['THREAD_X', 'Thread X (Twitter)', 1, '★', 'apps_script', 'x', 'P_THREAD_X', 'txt', ALL, '', '', '', '', 4, 8, 280, '', '', '', '', '', 'STAR,TEXTE', 'OUI',
      '{{#items}}{{n}}/{{total}} {{texte}}\\n\\n{{/items}}'],
    ['YT_CHAPITRES', 'Chapitrage YouTube', 1, '★', 'apps_script', 'youtube', 'P_YT_CHAPITRES', 'chapitres', 'video', '', '', '', '', 3, 15, 100, '', '', '', '', '', 'STAR,TEXTE', 'OUI',
      '{{#items}}{{temps}} {{titre}}\\n{{/items}}'],
    ['INSTAGRAM', 'Légende Instagram', 1, '', 'apps_script', 'instagram', 'P_INSTAGRAM', 'txt', ALL, 200, 2200, '', '', '', '', '', '', '', '', '', '', 'TEXTE', 'OUI',
      '{{contenu}}\\n\\n{{hashtags}}'],
    ['YT_DESCRIPTION', 'Description YouTube', 2, '', 'apps_script', 'youtube', 'P_YT_DESCRIPTION', 'txt', 'video', 300, 5000, '', '', '', '', '', '', '', '', '', '', 'TEXTE', 'OUI',
      '{{titre}}\\n\\n{{contenu}}\\n\\n{{hashtags}}'],
    ['FAQ', 'FAQ', 2, '★', 'apps_script', 'blog', 'P_FAQ', 'md', ALL, '', '', '', '', 4, 8, 600, '', '', '', '', '', 'STAR,TEXTE', 'OUI',
      '# {{titre}}\\n\\n{{#items}}**{{titre}}**\\n\\n{{texte}}\\n\\n{{/items}}'],
    ['NEWSLETTER', 'Bloc newsletter', 2, '', 'apps_script', 'newsletter', 'P_NEWSLETTER', 'md', ALL, '', '', 150, 400, '', '', '', '', '', '', '', '', 'TEXTE', 'OUI',
      '## {{titre}}\\n\\n{{contenu}}'],
    ['SRT_EN', 'Sous-titres traduits (EN)', 2, '★', 'apps_script', 'youtube', 'P_SRT_TRAD', 'srt', 'video', '', '', '', '', '', '', '', '', '', '', '', '', 'STAR', 'OUI', ''],
    ['CARROUSEL', 'Carrousel LinkedIn (PDF)', 2, '★', 'apps_script', 'linkedin', 'P_CARROUSEL', 'pdf_carrousel', ALL, '', '', '', '', 4, 7, 260, 1080, 1350, '', '', '', 'STAR', 'OUI',
      '{{titre}}\\n{{contenu}}\\n{{#items}}{{titre}} — {{texte}}\\n{{/items}}'],
    ['INFOGRAPHIE', 'Infographie résumé (PDF)', 3, '', 'apps_script', 'linkedin', 'P_INFOGRAPHIE', 'pdf_infographie', ALL, '', '', '', '', 3, 6, 220, 1080, 1920, '', '', '', 'VISUEL', 'OUI',
      '{{titre}}\\n{{contenu}}\\n{{#items}}{{titre}} — {{texte}}\\n{{/items}}'],
    ['MOMENTS_CLES', 'Passages clés (JSON)', 2, '', 'apps_script', 'video', 'P_MOMENTS_CLES', 'json', V, '', '', '', '', 1, 5, '', '', '', 10, 60, '', 'VIDEO', 'OUI',
      '{{#items}}{{temps}}-{{fin}} {{titre}} : {{texte}}\\n{{/items}}'],
    ['CLIP_9X16', 'Clip vertical sous-titré (Reels/Shorts)', 3, '★', 'worker', 'instagram', '', 'mp4', V, '', '', '', '', '', '', '', 1080, 1920, 10, 60, 'MOMENTS_CLES', 'STAR,VIDEO', 'OUI', ''],
    ['PODCAST_SCRIPT', 'Script audio (résumé)', 2, '', 'apps_script', 'audio', 'P_PODCAST_SCRIPT', 'txt', ALL, '', '', 120, 320, '', '', '', '', '', '', '', '', 'AUDIO', 'OUI',
      '{{contenu}}'],
    ['AUDIO', 'Résumé audio (voix de synthèse)', 3, '', 'worker', 'audio', '', 'mp3', ALL, '', '', '', '', '', '', '', '', '', 30, 180, 'PODCAST_SCRIPT', 'AUDIO', 'OUI', ''],
    ['IMG_1X1', 'Image 1:1 (Instagram)', 3, '', 'worker', 'instagram', '', 'jpg', 'image', '', '', '', '', '', '', '', 1080, 1080, '', '', '', 'IMAGES', 'OUI', ''],
    ['IMG_16X9', 'Image 16:9 (YouTube, site, LinkedIn)', 3, '', 'worker', 'web', '', 'jpg', 'image', '', '', '', '', '', '', '', 1920, 1080, '', '', '', 'IMAGES', 'OUI', '']
  ];
}

var TOV_REFERENCE_ = 'COMMENT S\'EXPRIMER ?\nVoici une analyse détaillée du tone of voice que tu dois utiliser dans ta réponse :\n\n' +
  '1. Personnalité du ton :\n- Chaleureux : Utilisation de tutoiement et un ton proche, presque conversationnel.\n- Pédagogique : Présentation structurée, visée explicative et informative.\n- Assertif : Affirmations claires et directes, accompagnées de points de vue assumés.\n\n' +
  '2. Émotions évoquées :\n- Confiance : Le ton inspire l\'idée qu\'il est possible de maîtriser les intelligences artificielles et d\'outils martech en toute sérénité grâce à des conseils pratiques.\n- Empathie : Une compréhension des motivations et craintes de l\'audience (ex. majorité silencieuse, peur de laisser des traces en ligne).\n- Inspiration : Encouragement à adopter une approche réfléchie et humaine.\n\n' +
  '3. Vocabulaire et expressions :\n- Récurrents : "Majorité silencieuse", "Vanity metrics", "Humanité métrique", "Influence professionnelle", "Efficience",\n- Questions rhétoriques engageantes : "Tu te rappelles cette notion... ?"\n- Invitation à la réflexion : "Et si on allait chercher d\'autres indicateurs ?"\n- Usage fréquent de "tu" pour établir une proximité.\n\n' +
  '4. Rythme et structure :\n- Rythme : Alternance entre phrases courtes et impactantes, et phrases plus longues pour expliciter les idées.\n- Structure :\n- Introduction engageante avec anecdotes ou problématiques universelles.\n- Corps du texte structuré en blocs explicatifs avec exemples pratiques.\n- Conclusion invitant à une action ou une réflexion plus profonde.\n\n' +
  '5. Niveau de formalité et d\'accessibilité :\n- Niveau de formalité : Informel mais professionnel, idéal pour des utilisateurs d\'intelligences artificielles et d\'outils martech cherchant à améliorer leur présence.\n- Accessibilité : Intermédiaire, avec des termes techniques expliqués pour un public qui n\'est pas forcément expert.\n\n' +
  '6. Métaphore du ton :\n- "Comme un coach bienveillant mais exigeant, qui t\'accompagne avec des conseils concrets et te pousse à voir les choses autrement."\n\n' +
  'Synthèse en une phrase mémorable :\n"Un ton chaleureux et assertif qui inspire confiance, en expliquant avec pédagogie et proximité comment transformer les IA en un outil puissant pour ta carrière."';

function seedPrompts_() {
  return [
    ['SYS_REGLES', 'systeme', 'Règles ajoutées à TOUTES les consignes',
      'Tu es le rédacteur de l\'équipe communication de l\'école d\'ingénieurs ESIEA.\n' +
      'RÈGLES NON NÉGOCIABLES :\n' +
      '1. SOURCE DE VÉRITÉ : tu n\'utilises QUE les informations présentes dans la SOURCE fournie. Aucun chiffre, date, pourcentage, nom de personne, nom d\'entreprise, nom de formation, de diplôme, de label, de campus ou de partenaire qui n\'y figure pas mot pour mot. Si une information manque, tu formules sans elle.\n' +
      '2. Les intitulés officiels (formations, diplômes, labels, campus) sont recopiés exactement comme dans la source.\n' +
      '3. Aucune citation entre guillemets attribuée à une personne réelle : tu reformules (« l\'école explique que… »). Tu ne nommes aucune personne.\n' +
      '4. Tu n\'inventes ni témoignage, ni anecdote, ni exemple chiffré.\n' +
      '5. Tu écris en français correct, AVEC tous les accents et apostrophes (é, è, à, ç, l’, d’…) (sauf consigne de traduction), sans emoji excessif (3 maximum), sans majuscules criardes.\n' +
      '6. Tu respectes strictement les contraintes de longueur et de nombre d\'éléments demandées.\n' +
      '7. Dans "faits_sources", tu recopies chaque fait chiffré ou nommé que tu as utilisé, tel qu\'il apparaît dans la source.'],
    ['TOV_REFERENCE', 'voix', 'Prompt 1 « Tone of voice » fourni par le challenge (référence)', TOV_REFERENCE_],
    ['TOV_MARQUE', 'voix', 'Voix de marque ESIEA (adaptation du prompt 1 à la marque)',
      'VOIX DE LA MARQUE ESIEA :\n' +
      '- Personnalité : chaleureuse, pédagogique, assertive. Une école d\'ingénieurs passionnée par le numérique qui parle vrai.\n' +
      '- Émotions : confiance (on peut réussir dans le numérique), curiosité (donner envie d\'apprendre), fierté (valoriser les projets et la communauté).\n' +
      '- Style : phrases courtes et impactantes alternées avec des phrases explicatives ; termes techniques expliqués simplement ; questions rhétoriques engageantes ; conclusion qui invite à agir ou à réfléchir.\n' +
      '- Formalité : professionnelle mais accessible ; vouvoiement par défaut sauf si le canal précise le tutoiement.\n' +
      '- Métaphore : « un ingénieur-mentor bienveillant et exigeant qui ouvre les portes du numérique ».\n' +
      '- À éviter : superlatifs non prouvés (« la meilleure école »), jargon non expliqué, ton publicitaire agressif.\n' +
      'Ton demandé pour cette production : {{ton}}. Public visé : {{public}}.'],
    ['TOV_LINKEDIN', 'voix', 'Déclinaison LinkedIn',
      'LinkedIn : ton expert et inspirant, vouvoiement. Accroche forte en 1re ligne (moins de 150 caractères, sans le nom de l\'école en premier mot), paragraphes de 1 à 3 lignes séparés par une ligne vide, 1 question finale qui invite au commentaire, 3 à 5 hashtags pertinents en fin de post.'],
    ['TOV_X', 'voix', 'Déclinaison X / Twitter',
      'X : ton vif, direct, tutoiement possible. Une idée par tweet, phrases très courtes, 0 à 2 hashtags dans tout le thread, pas de hashtag en milieu de phrase. Le 1er tweet donne envie de lire la suite.'],
    ['TOV_INSTAGRAM', 'voix', 'Déclinaison Instagram',
      'Instagram : ton proche et enthousiaste, tutoiement, public jeune (lycéens / étudiants). Accroche émotionnelle, phrases courtes, 2 à 3 emojis maximum, appel à l\'action clair, 5 à 10 hashtags à la fin.'],
    ['TOV_BLOG', 'voix', 'Déclinaison blog / site',
      'Blog : ton pédagogique et structuré, vouvoiement, intertitres explicites (pensés SEO), introduction qui pose la problématique, conclusion avec appel à l\'action (découvrir, échanger, candidater) sans promesse chiffrée.'],
    ['TOV_YOUTUBE', 'voix', 'Déclinaison YouTube',
      'YouTube : titres de chapitres courts (2 à 6 mots), informatifs, sans clickbait ; description claire avec les points clés de la vidéo.'],
    ['TOV_NEWSLETTER', 'voix', 'Déclinaison newsletter',
      'Newsletter : ton chaleureux d\'actualité, vouvoiement, titre accrocheur, 1 à 2 paragraphes, une phrase d\'appel à l\'action.'],
    ['TOV_AUDIO', 'voix', 'Déclinaison audio (voix de synthèse)',
      'Audio : texte écrit pour être ÉCOUTÉ. Phrases courtes, pas de parenthèses, pas de liste à puces, pas de sigles non prononçables, pas d\'URL ni d\'emoji. Ton dynamique et clair.'],
    ['P_BLOG', 'format', 'Article de blog',
      'Rédige un article de blog à partir de la source. Longueur : {{longueur}} ({{min_mots}} à {{max_mots}} mots au total).\n' +
      '"titre" : titre accrocheur (max 70 caractères). "contenu" : introduction (2-3 phrases). "items" : {{min_items}} à {{max_items}} sections, chacune avec "titre" (intertitre) et "texte" (1-2 paragraphes). La dernière section conclut avec un appel à l\'action.'],
    ['P_LINKEDIN', 'format', 'Post LinkedIn',
      'Rédige un post LinkedIn à partir de la source. Longueur : {{longueur}}, entre {{min_car}} et {{max_car}} caractères hashtags compris.\n' +
      '"titre" : résumé interne en 5 mots. "contenu" : le post complet (sans les hashtags). "hashtags" : 3 à 5 hashtags sans espace.'],
    ['P_THREAD_X', 'format', 'Thread X',
      'Rédige un thread X de {{min_items}} à {{max_items}} tweets à partir de la source. Chaque tweet ("items[].texte") fait AU MAXIMUM 260 caractères (la numérotation est ajoutée automatiquement, ne la mets pas). "titre" : sujet en 5 mots. Le premier tweet accroche, le dernier conclut.'],
    ['P_YT_CHAPITRES', 'format', 'Chapitrage YouTube',
      'Crée le chapitrage YouTube de la vidéo à partir de la transcription horodatée (repères [mm:ss]).\n' +
      '"items" : {{min_items}} à {{max_items}} chapitres, chacun avec "temps" au format mm:ss (le premier = "00:00", ensuite uniquement des horodatages présents dans la transcription, croissants, espacés d\'au moins 30 secondes) et "titre" (2 à 6 mots). "titre" global : titre de la vidéo proposé.'],
    ['P_INSTAGRAM', 'format', 'Légende Instagram',
      'Rédige une légende Instagram à partir de la source ({{min_car}} à {{max_car}} caractères hashtags compris). "contenu" : la légende. "hashtags" : 5 à 10 hashtags. "titre" : idée de visuel en 6 mots.'],
    ['P_YT_DESCRIPTION', 'format', 'Description YouTube',
      'Rédige la description YouTube de la vidéo : "titre" = titre optimisé (max 90 caractères), "contenu" = description (2 paragraphes + liste des points clés en tirets). "hashtags" : 3 hashtags.'],
    ['P_FAQ', 'format', 'FAQ',
      'Crée une FAQ de {{min_items}} à {{max_items}} questions que se pose le public ({{public}}) et dont la réponse est DANS la source. "items[].titre" = la question, "items[].texte" = la réponse (2-4 phrases, uniquement des faits de la source). "titre" : titre de la FAQ.'],
    ['P_NEWSLETTER', 'format', 'Bloc newsletter',
      'Rédige un bloc de newsletter ({{min_mots}} à {{max_mots}} mots) : "titre" accrocheur, "contenu" = 1 à 2 paragraphes + une phrase d\'appel à l\'action.'],
    ['P_SRT_TRAD', 'format', 'Traduction de sous-titres',
      'Tu traduis des sous-titres vers l\'{{langue_cible}}. Tu reçois {"cues":[{"i":n,"t":"texte"}]} et tu renvoies EXACTEMENT les mêmes "i", dans le même ordre, avec "t" traduit. Un repère = une traduction, même s\'il est incomplet (la phrase continue au repère suivant). Garde la longueur proche de l\'original. Ne traduis JAMAIS ces intitulés officiels : {{glossaire}}. Réponds en JSON {"cues":[...]}.'],
    ['P_CARROUSEL', 'format', 'Carrousel LinkedIn (PDF)',
      'Crée un carrousel LinkedIn. "titre" : titre de couverture (max 60 caractères). "contenu" : sous-titre de couverture (max 120 caractères). "items" : {{min_items}} à {{max_items}} slides avec "titre" (max 50 caractères) et "texte" (max 200 caractères). La dernière slide est un appel à l\'action sans information inventée.'],
    ['P_INFOGRAPHIE', 'format', 'Infographie résumé (PDF)',
      'Crée le contenu d\'une infographie verticale. "titre" (max 60 caractères), "contenu" (une phrase de contexte, max 140 caractères), "items" : {{min_items}} à {{max_items}} points clés avec "titre" (max 40 caractères) et "texte" (max 180 caractères). Privilégie les faits concrets de la source.'],
    ['P_MOMENTS_CLES', 'format', 'Passages clés pour clips vidéo',
      'À partir de la transcription horodatée, sélectionne {{min_items}} à {{max_items}} passages forts, autonomes et compréhensibles sans contexte, classés du meilleur au moins bon. Chaque item : "temps" (début mm:ss, pris dans la transcription, au début d\'une phrase), "fin" (mm:ss, fin d\'une phrase), durée entre {{duree_min_s}} et {{duree_max_s}} secondes, "titre" (accroche de 3 à 6 mots), "texte" (pourquoi ce passage est fort, 1 phrase). Les horodatages doivent être compris entre {{debut_source}} et {{fin_source}}.'],
    ['P_PODCAST_SCRIPT', 'format', 'Script audio',
      'Écris le script d\'un court résumé audio ({{min_mots}} à {{max_mots}} mots) lu par une voix de synthèse : "contenu" = le texte à lire (intro accrocheuse, 2-3 idées clés de la source, conclusion), "titre" = titre de l\'épisode. Pas de citation, pas de nom de personne.'],
    ['P_RELECTURE', 'relecture', 'Consigne du relecteur IA',
      'Tu es le relecteur qualité de l\'ESIEA. Compare la SORTIE à la SOURCE.\n' +
      'Vérifie : (1) fait_invente = true si la sortie contient un chiffre, une date, un nom, une formation, un diplôme, un label ou une affirmation factuelle absente de la source ; (2) fidélité au sens de la source ; (3) ton de marque (chaleureux, pédagogique, assertif, sans superlatif non prouvé) ; (4) aucune citation attribuée à une personne réelle.\n' +
      'Donne un "score" de 0 à 10 (10 = publiable sans retouche) et la liste courte des "problemes" (vide si aucun). Réponds en JSON {"score":n,"fait_invente":bool,"ton_ok":bool,"problemes":[...]}.'],
    ['P_CONDENSE', 'outil', 'Condensation d\'une source trop longue',
      'Condense ce passage en un texte 3 fois plus court. Conserve TOUS les chiffres, dates, noms de formations et horodatages [mm:ss] tels quels. N\'ajoute rien.'],
    ['P_ANALYSE_TON', 'outil', 'Analyse du tone of voice d\'un canal (menu Usine)',
      'Analyse les exemples de contenus suivants publiés par la marque sur le canal {{canal}} et décris leur tone of voice selon la structure : 1. Personnalité du ton, 2. Émotions évoquées, 3. Vocabulaire et expressions, 4. Rythme et structure, 5. Niveau de formalité et d\'accessibilité, 6. Métaphore du ton, puis une synthèse en une phrase. Le résultat sera utilisé comme consigne pour rédiger de futurs contenus sur ce canal.']
  ];
}

function seedSources_() {
  return [
    ['WEB-001', 'Site ESIEA — page d\'accueil', 'web', '', '', 'https://www.esiea.fr/', '', '', 'fr', 'TEXTE', 'OUI']
  ];
}
