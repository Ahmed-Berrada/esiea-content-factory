/**
 * Engine.gs — file de traitement.
 * - Contourne la limite de 6 min : chaque exécution s'arrête à BATCH_TIME_LIMIT_S puis se reprogramme.
 * - Parallélise : PARALLEL_WORKERS exécutions simultanées, chacune « réserve » ses lignes sous verrou.
 * - Les lignes moteur=worker (vidéo, audio, images) sont laissées au worker Python.
 */

function demarrerTraitement() {
  var n = cfgNum_('PARALLEL_WORKERS', 3);
  var existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'processQueue'; }).length;
  for (var i = existing; i < n; i++) {
    ScriptApp.newTrigger('processQueue').timeBased().after(1000 + i * 2000).create();
  }
  toast_('Traitement lancé (' + n + ' exécutions parallèles).');
}

/**
 * Échéance absolue de l'exécution en cours (Google tue tout script à 360 s).
 * Les tâches vérifient le temps restant avant chaque appel d'IA (deadlineLeftMs_).
 */
var EXEC_DEADLINE_ = 0;

function deadlineLeftMs_() { return EXEC_DEADLINE_ ? EXEC_DEADLINE_ - Date.now() : Infinity; }

function processQueue(e) {
  // supprime le déclencheur ponctuel qui nous a lancés (sinon ils s'accumulent, max 20)
  if (e && e.triggerUid) {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t); });
  }
  var t0 = Date.now();
  EXEC_DEADLINE_ = t0 + cfgNum_('EXEC_DEADLINE_S', 330) * 1000;
  var minJobMs = cfgNum_('JOB_MIN_S', 120) * 1000;   // on ne démarre pas une tâche sans ce temps devant soi
  var done = 0;
  while (deadlineLeftMs_() > minJobMs) {
    var job = claimNextJob_();
    if (!job) break;
    runJob_(job);
    done++;
  }
  majStatutsOrdres_();
  var left = remainingJobs_();
  if (left.todo > 0) ScriptApp.newTrigger('processQueue').timeBased().after(1000).create();
  // filet de sécurité : une tâche EN_COURS d'une exécution tuée sera reprise après expiration
  else if (left.running > 0) ScriptApp.newTrigger('processQueue').timeBased().after(cfgNum_('STALE_MIN', 7) * 60000).create();
  return done;
}

function remainingJobs_() {
  var r = { todo: 0, running: 0 };
  readTable_(SH.JOURNAL).rows.forEach(function (j) {
    if ((j.moteur || 'apps_script') !== 'apps_script') return;
    if (j.statut === STATUT.TODO || j.statut === STATUT.WAIT) r.todo++;
    if (j.statut === STATUT.RUN) r.running++;
  });
  return r;
}

/** Réserve (sous verrou) la prochaine ligne à faire dont les dépendances sont OK. */
function claimNextJob_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return null;
  try {
    var formats = getFormats_();
    var journal = readTable_(SH.JOURNAL).rows;
    var staleMs = cfgNum_('STALE_MIN', 7) * 60 * 1000;  // > durée max d'une exécution Google (6 min)
    for (var k = 0; k < journal.length; k++) {
      var j = journal[k];
      if ((j.moteur || 'apps_script') !== 'apps_script') continue;
      var stale = j.statut === STATUT.RUN && (Date.now() - new Date(j.maj_le).getTime() > staleMs);
      if (j.statut !== STATUT.TODO && j.statut !== STATUT.WAIT && !stale) continue;
      var f = formats[j.format_id];
      if (!f) continue;
      var dep = String(f.depend_de || '').trim();
      if (dep) {
        var depRow = latestOk_(journal, j.source_id, dep);
        if (!depRow) {
          var depFailed = journal.some(function (x) { return x.source_id === j.source_id && x.format_id === dep && (x.statut === STATUT.ERR || x.statut === STATUT.REJ); })
            && !journal.some(function (x) { return x.source_id === j.source_id && x.format_id === dep && [STATUT.TODO, STATUT.RUN, STATUT.WAIT].indexOf(x.statut) >= 0; });
          if (depFailed) updateRow_(SH.JOURNAL, j._row, { statut: STATUT.ERR, raison: 'dépendance ' + dep + ' en échec', maj_le: now_() });
          else if (j.statut !== STATUT.WAIT) updateRow_(SH.JOURNAL, j._row, { statut: STATUT.WAIT, maj_le: now_() });
          continue;
        }
        j._dep = depRow;
      }
      updateRow_(SH.JOURNAL, j._row, { statut: STATUT.RUN, tentatives: (Number(j.tentatives) || 0) + 1, maj_le: now_() });
      j.tentatives = (Number(j.tentatives) || 0) + 1;
      return j;
    }
    return null;
  } finally {
    lock.releaseLock();
  }
}

function latestOk_(journal, sourceId, formatId) {
  var ok = journal.filter(function (x) { return x.source_id === sourceId && x.format_id === formatId && x.statut === STATUT.OK; });
  return ok.length ? ok[ok.length - 1] : null;
}

function runJob_(job) {
  var t0 = Date.now();
  var cfg = getConfig_();
  try {
    var formats = getFormats_(), sources = getSources_();
    var f = formats[job.format_id], s = sources[job.source_id];
    if (!s) throw new Error('source introuvable : ' + job.source_id);
    var res = String(f.sortie) === 'srt' ? runSrtTranslation_(job, f, s) : runTextJob_(job, f, s);
    var patch = {
      statut: res.status, fichier: res.fileName || '', file_id: res.fileId || '', lien: res.url || '',
      dossier: res.folder || '', modele: res.model, tokens_in: res.tokensIn, tokens_out: res.tokensOut,
      cout_usd: costUsd_(res.model, res.tokensIn, res.tokensOut) + (res.extraCost || 0),
      duree_s: Math.round((Date.now() - t0) / 100) / 10,
      controle_auto: res.check, score_relecteur: res.review === undefined ? '' : res.review,
      raison: res.reason || '', origine_medias: res.media || 'aucun média (texte généré par IA)',
      genere_par_ia: 'O', maj_le: now_()
    };
    updateRow_(SH.JOURNAL, job._row, patch);
  } catch (err) {
    var retry = (err.retryable || /Timeout|Service invoked too many|Adresse non disponible|Address unavailable/i.test(err.message))
      && job.tentatives < cfgNum_('MAX_RETRIES', 3);
    updateRow_(SH.JOURNAL, job._row, {
      statut: retry ? STATUT.TODO : STATUT.ERR, raison: String(err.message).substring(0, 500),
      modele: cfg.MODEL, duree_s: Math.round((Date.now() - t0) / 100) / 10, maj_le: now_()
    });
  }
}

/** Construit les consignes : règles + voix de marque + voix du canal + consigne du format (tout vient de la Sheet). */
function buildPrompts_(job, f, src, sourceText) {
  var cfg = getConfig_(), P = getPrompts_();
  var formatPrompt = P[f.prompt_id];
  if (!formatPrompt) throw new Error('Prompt introuvable dans l\'onglet Prompts : ' + f.prompt_id);
  var system = [
    P.SYS_REGLES || '',
    '=== VOIX DE MARQUE ===\n' + (P[cfg.TOV_ACTIF || 'TOV_MARQUE'] || ''),
    P['TOV_' + String(f.canal).toUpperCase()] ? '=== SPÉCIFICITÉS DU CANAL ' + String(f.canal).toUpperCase() + ' ===\n' + P['TOV_' + String(f.canal).toUpperCase()] : ''
  ].filter(String).join('\n\n');
  var vars = {
    ton: job.ton || cfg.TON_DEFAUT, public: job.public || cfg.PUBLIC_DEFAUT, longueur: job.longueur || cfg.LONGUEUR_DEFAUT,
    min_car: f.min_car, max_car: f.max_car, min_mots: f.min_mots, max_mots: f.max_mots,
    min_items: f.min_items, max_items: f.max_items, item_max_car: f.item_max_car,
    duree_min_s: f.duree_min_s, duree_max_s: f.duree_max_s,
    titre_source: src.title, glossaire: cfg.GLOSSAIRE_NON_TRADUIT, langue_cible: cfg.LANGUE_TRADUCTION || 'anglais',
    debut_source: secToClock_(src.start || 0), fin_source: src.end === Infinity ? '' : secToClock_(src.end || 0)
  };
  var user = fillPrompt_(formatPrompt, vars) + JSON_INSTRUCTION +
    '\n\n=== SOURCE (seule source de vérité) — « ' + src.title + ' » ===\n<<<\n' + sourceText + '\n>>>';
  return { system: system, user: user };
}

function runTextJob_(job, f, s) {
  var cfg = getConfig_();
  var src = loadSource_(s);
  var usage = { tokensIn: 0, tokensOut: 0 };
  var sourceText = sourceTextForLlm_(src, usage);
  var p = buildPrompts_(job, f, src, sourceText);
  var maxRegen = cfgNum_('MAX_REGENERATIONS', 2);
  var attempt = 0, feedback = '', last = null;

  var callMs = cfgNum_('LLM_CALL_BUDGET_S', 75) * 1000;  // temps à prévoir pour un appel d'IA
  while (attempt <= maxRegen) {
    if (last && deadlineLeftMs_() < callMs * 2) {   // pas le temps de régénérer + relire : on rend la meilleure version
      last.problems.push("budget temps de l'exécution atteint après " + attempt + ' essai(s) — relancer pour réessayer');
      break;
    }
    var r = callLlmJson_({ system: p.system, user: p.user + feedback, json: true });
    usage.tokensIn += r.tokensIn; usage.tokensOut += r.tokensOut;
    var data = r.data;
    var rendered = renderTemplate_(f.rendu, data, { source_titre: src.title });
    var cons = checkConstraints_(rendered.text, data, f, { itemTexts: rendered.itemTexts, sourceStart: src.start, sourceEnd: src.end });
    var facts = checkFacts_(rendered.text, src.text + '\n' + (src.timedText || '') + '\n' + src.title, cfg.TERMES_AUTORISES);
    var problems = cons.errors.slice();
    if (!facts.ok) problems.push('faits absents de la source : ' + facts.invented.join(', '));
    if (String(cfg.LANGUE_SORTIE || 'fr') === 'fr' && !hasFrenchAccents_(rendered.text)) {
      problems.push("texte français sans accents ni apostrophes : réécris avec l'orthographe française complète");
    }
    var review;
    if (!problems.length && cfgBool_('REVIEW_ENABLED', true) && deadlineLeftMs_() > callMs) {
      review = reviewOutput_(rendered.text, sourceText, f, usage);
      if (review.fait_invente || review.score < cfgNum_('REVIEW_MIN_SCORE', 7)) {
        problems.push('relecteur IA (' + review.score + '/10) : ' + (review.problemes || []).join(' ; '));
      }
    }
    last = { data: data, rendered: rendered, problems: problems, stats: cons.stats, review: review, model: r.model };
    if (!problems.length) break;
    feedback = '\n\n=== CORRECTION DEMANDÉE ===\nTa réponse précédente a échoué aux contrôles automatiques :\n- ' + problems.join('\n- ') +
      '\nCorrige ces points. N\'utilise AUCUN chiffre, nom, date ou intitulé absent de la source.';
    attempt++;
  }

  var ok = !last.problems.length;
  var file = saveOutput_(job, f, last.data, last.rendered.text, ok);
  return {
    status: ok ? STATUT.OK : STATUT.REJ,
    fileName: file.name, fileId: file.id, url: file.url, folder: file.folder,
    model: last.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, extraCost: usage.extraCost || 0,
    check: (ok ? 'OK' : 'KO') + ' — ' + last.stats.chars + ' car., ' + last.stats.words + ' mots, ' + last.stats.items + ' items' + (file.pages ? ', ' + file.pages + ' pages' : '') + ', ' + (attempt + 1) + ' essai(s)',
    review: last.review ? last.review.score : '',
    reason: last.problems.join(' | '),
    media: file.media
  };
}

/** Seconde IA : vérifie fidélité, faits inventés, ton. Sortie rejetée → régénérée avec ses remarques. */
function reviewOutput_(output, sourceText, f, usage) {
  var P = getPrompts_(), cfg = getConfig_();
  var schema = {
    type: 'OBJECT',
    properties: {
      score: { type: 'INTEGER' }, fait_invente: { type: 'BOOLEAN' }, ton_ok: { type: 'BOOLEAN' },
      problemes: { type: 'ARRAY', items: { type: 'STRING' } }
    },
    required: ['score', 'fait_invente', 'problemes']
  };
  var r = callLlmJson_({
    model: cfg.REVIEW_MODEL || cfg.MODEL, json: true, schema: schema, temperature: 0,
    system: P.P_RELECTURE || 'Tu es relecteur qualité.',
    user: 'FORMAT : ' + f.nom + ' (' + f.canal + ')\n\n=== SOURCE ===\n<<<\n' + sourceText + '\n>>>\n\n=== SORTIE À VÉRIFIER ===\n<<<\n' + output + '\n>>>'
  });
  // le relecteur a son propre modèle (et son propre tarif) : coût ajouté séparément
  usage.extraCost = (usage.extraCost || 0) + costUsd_(r.model, r.tokensIn, r.tokensOut);
  return { score: Number(r.data.score) || 0, fait_invente: r.data.fait_invente === true, problemes: r.data.problemes || [] };
}

/** Traduction de sous-titres : texte traduit par lots, horodatages recopiés à l'identique. */
function runSrtTranslation_(job, f, s) {
  var cfg = getConfig_(), P = getPrompts_();
  var src = loadSource_(s);
  var cues = src.cues;
  if (!cues || !cues.length) throw new Error('la source n\'a pas de sous-titres');
  var usage = { tokensIn: 0, tokensOut: 0 }, model = cfg.MODEL;
  var batch = cfgNum_('SRT_BATCH', 80), outCues = [];
  var glossary = String(cfg.GLOSSAIRE_NON_TRADUIT || '').split(/[;,]/).map(function (g) { return g.trim(); }).filter(String);
  var schema = { type: 'OBJECT', properties: { cues: { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, t: { type: 'STRING' } } } } }, required: ['cues'] };
  var system = (P.SYS_REGLES || '') + '\n\n' + fillPrompt_(P[f.prompt_id] || '', { langue_cible: cfg.LANGUE_TRADUCTION || 'anglais', glossaire: glossary.join(', ') });

  for (var k = 0; k < cues.length; k += batch) {
    var slice = cues.slice(k, k + batch);
    var payload = { cues: slice.map(function (c) { return { i: c.i, t: c.text }; }) };
    var r = callLlmJson_({ system: system, user: JSON.stringify(payload), json: true, schema: schema, temperature: 0.2 });
    usage.tokensIn += r.tokensIn; usage.tokensOut += r.tokensOut; model = r.model;
    var map = {};
    (r.data.cues || []).forEach(function (c) { map[c.i] = c.t; });
    slice.forEach(function (c) {
      outCues.push({ start: c.start, end: c.end, text: map[c.i] !== undefined ? map[c.i] : null, orig: c.text });
    });
  }
  var missing = outCues.filter(function (c) { return c.text === null; }).length;
  var glossLost = [];
  outCues.forEach(function (c) {
    if (c.text === null) return;
    glossary.forEach(function (g) {
      if (c.orig.indexOf(g) >= 0 && c.text.indexOf(g) < 0 && glossLost.indexOf(g) < 0) glossLost.push(g);
    });
  });
  outCues.forEach(function (c) { if (c.text === null) c.text = c.orig; });
  var srtText = buildSrt_(outCues);
  var problems = [];
  if (missing) problems.push(missing + ' repère(s) non traduit(s)');
  if (glossLost.length) problems.push('intitulés officiels modifiés : ' + glossLost.join(', '));
  var ok = problems.length === 0;
  var file = writeTextFile_(job, f, srtText, 'srt', ok);
  return {
    status: ok ? STATUT.OK : STATUT.REJ, fileName: file.name, fileId: file.id, url: file.url, folder: file.folder,
    model: model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut,
    check: (ok ? 'OK' : 'KO') + ' — ' + outCues.length + '/' + cues.length + ' repères, horodatages identiques à la source',
    reason: problems.join(' | '), media: 'aucun média (sous-titres traduits par IA)'
  };
}
