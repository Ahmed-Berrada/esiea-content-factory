/**
 * Sources.gs — import, découpage en extraits, diagnostic « exploitable », chargement du texte source.
 * Types de source : video (SRT complet + MP4), extrait (fenêtre debut→fin d'une vidéo), web, texte, image.
 */

var SOURCE_CACHE_ = {};

/** Menu : scanne Drive/01_Sources et déclare les fichiers dans l'onglet Sources. */
function importerSources() {
  var cfg = getConfig_();
  var folder = DriveApp.getFolderById(cfg.SOURCES_FOLDER_ID);
  var existing = getSources_();
  var byFile = {};
  Object.keys(existing).forEach(function (id) { if (existing[id].fichier_id) byFile[existing[id].fichier_id] = id; });

  var files = [];
  collectFiles_(folder, files);
  var videos = {};
  files.forEach(function (f) { if (/\.(mp4|mov|mkv|webm)$/i.test(f.getName())) videos[baseName_(f.getName())] = f.getId(); });

  var nextNum = nextSourceNumber_(existing);
  var newRows = [];
  files.forEach(function (f) {
    if (byFile[f.getId()]) return;
    var name = f.getName(), type = null;
    if (/\.srt$/i.test(name)) type = 'video';
    else if (/\.(jpe?g|png|webp)$/i.test(name)) type = 'image';
    else if (/\.(txt|md)$/i.test(name)) type = 'texte';
    if (!type) return;
    newRows.push({
      source_id: 'SRC-' + ('00' + (nextNum++)).slice(-3),
      titre: baseName_(name).replace(/[_-]+/g, ' '),
      type: type, fichier_id: f.getId(),
      fichier_video_id: type === 'video' ? (videos[baseName_(name)] || '') : '',
      langue: 'fr', recette: type === 'image' ? 'IMAGES' : 'STAR', anonymise: 'OUI',
      maj_le: now_()
    });
  });
  appendRows_(SH.SOURCES, newRows);
  preparerSources();
  toast_(newRows.length + ' source(s) importée(s).');
}

function collectFiles_(folder, acc) {
  var it = folder.getFiles();
  while (it.hasNext()) acc.push(it.next());
  var sub = folder.getFolders();
  while (sub.hasNext()) collectFiles_(sub.next(), acc);
}

function baseName_(n) { return String(n).replace(/\.[^.]+$/, ''); }

function nextSourceNumber_(existing) {
  var max = 0;
  Object.keys(existing).forEach(function (id) {
    var m = id.match(/^SRC-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

/** Menu : découpe chaque vidéo en extraits (~EXTRAIT_DUREE_S), coupés sur des fins de phrase. */
function creerExtraits() {
  var target = cfgNum_('EXTRAIT_DUREE_S', 120);
  var sources = getSources_();
  var rows = [];
  Object.keys(sources).forEach(function (id) {
    var s = sources[id];
    if (s.type !== 'video') return;
    var already = Object.keys(sources).some(function (k) { return sources[k].parent_id === id; });
    if (already) return;
    var cues = parseSrt_(DriveApp.getFileById(s.fichier_id).getBlob().getDataAsString('UTF-8'));
    splitCuesIntoExtracts_(cues, target).forEach(function (ex, k) {
      rows.push({
        source_id: id + '-E' + pad2_(k + 1), titre: s.titre + ' — extrait ' + (k + 1), type: 'extrait',
        fichier_id: s.fichier_id, fichier_video_id: s.fichier_video_id, debut: secToClock_(ex.start), fin: secToClock_(ex.end),
        langue: s.langue, recette: s.recette, anonymise: s.anonymise, parent_id: id, maj_le: now_()
      });
    });
  });
  appendRows_(SH.SOURCES, rows);
  preparerSources();
  toast_(rows.length + ' extrait(s) créés.');
}

/** Menu : calcule nb_mots / durée / exploitable / diagnostic pour toutes les sources. */
function preparerSources() {
  var minWords = cfgNum_('MIN_MOTS_SOURCE', 80);
  readTable_(SH.SOURCES).rows.forEach(function (s) {
    var patch = { maj_le: now_() };
    try {
      var src = loadSource_(s);
      var diag;
      if (s.type === 'image') {
        diag = { ok: !!(s.fichier_id || s.url), words: 0, duration: 0, issues: (s.fichier_id || s.url) ? [] : ['aucun fichier ni URL'] };
      } else if (src.cues) {
        diag = diagnoseCues_(src.cues, minWords);
        if (s.type === 'extrait' && src.cutMidSentence) diag.issues.push('avertissement : extrait coupé au milieu d\'une phrase');
      } else {
        var w = countWords_(src.text);
        diag = { ok: w >= minWords, words: w, duration: 0, issues: w >= minWords ? [] : ['trop court (' + w + ' mots)'] };
      }
      patch.nb_mots = diag.words;
      patch.duree_s = Math.round(diag.duration);
      patch.exploitable = diag.ok ? 'OUI' : 'NON';
      patch.diagnostic = diag.issues.join(' ; ') || 'OK';
    } catch (e) {
      patch.exploitable = 'NON';
      patch.diagnostic = 'Erreur : ' + e.message;
    }
    updateRow_(SH.SOURCES, s._row, patch);
  });
}

/**
 * Charge le contenu d'une source → {text (anonymisé), timedText?, cues?, start, end, title}
 */
function loadSource_(s) {
  var id = String(s.source_id);
  if (SOURCE_CACHE_[id]) return SOURCE_CACHE_[id];
  var cfg = getConfig_();
  var out = { title: s.titre, type: s.type, start: 0, end: Infinity };

  if (s.type === 'video' || s.type === 'extrait') {
    var cues = parseSrt_(DriveApp.getFileById(s.fichier_id).getBlob().getDataAsString('UTF-8'));
    if (s.type === 'extrait') {
      var a = clockToSec_(s.debut), b = clockToSec_(s.fin);
      var all = cues;
      cues = cues.filter(function (c) { return c.start >= a - 0.5 && c.end <= b + 0.5; });
      var firstIdx = all.indexOf(cues[0]);
      out.cutMidSentence = (firstIdx > 0 && !endsSentence_(all[firstIdx - 1].text)) || (cues.length && !endsSentence_(cues[cues.length - 1].text));
    }
    out.cues = cues;
    out.start = cues.length ? cues[0].start : 0;
    out.end = cues.length ? cues[cues.length - 1].end : 0;
    out.text = cues.map(function (c) { return c.text; }).join(' ');
    out.timedText = cuesToTimedText_(cues, 15);
  } else if (s.type === 'web') {
    out.text = fetchWebText_(s.url);
  } else if (s.type === 'texte') {
    out.text = s.fichier_id ? DriveApp.getFileById(s.fichier_id).getBlob().getDataAsString('UTF-8') : String(s.url || '');
  } else if (s.type === 'image') {
    out.text = String(s.titre || '');
  } else {
    throw new Error('Type de source inconnu : ' + s.type);
  }

  if (String(s.anonymise).toUpperCase() !== 'NON') {
    out.text = anonymize_(out.text, cfg.NOMS_A_ANONYMISER);
    if (out.timedText) out.timedText = anonymize_(out.timedText, cfg.NOMS_A_ANONYMISER);
  }
  SOURCE_CACHE_[id] = out;
  return out;
}

/** Page web ESIEA → texte lisible (sans scripts, menus, pieds de page). */
function fetchWebText_(url) {
  var html = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getContentText();
  var main = html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<article[\s\S]*?<\/article>/i);
  var h = main ? main[0] : html;
  h = h.replace(/<(script|style|nav|footer|header|noscript|svg|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ccedil;/g, 'ç')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return h;
}

/**
 * Texte envoyé à l'IA. Si trop long pour la fenêtre de contexte (MAX_SOURCE_CHARS),
 * on condense par morceaux (map) puis on concatène les résumés (reduce) — les chiffres sont conservés.
 */
function sourceTextForLlm_(src, usage) {
  var max = cfgNum_('MAX_SOURCE_CHARS', 60000);
  var t = src.timedText || src.text;
  if (t.length <= max) return t;
  var prompts = getPrompts_();
  var chunks = [], size = Math.floor(max / 2);
  for (var i = 0; i < t.length; i += size) chunks.push(t.substring(i, i + size));
  var parts = chunks.map(function (c) {
    var r = callLlm_({ system: prompts.SYS_REGLES || '', user: (prompts.P_CONDENSE || 'Condense ce texte en gardant tous les faits, chiffres, noms et horodatages :') + '\n\n<<<\n' + c + '\n>>>' });
    usage.tokensIn += r.tokensIn; usage.tokensOut += r.tokensOut;
    return r.text;
  });
  return parts.join('\n');
}
