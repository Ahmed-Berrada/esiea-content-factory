/**
 * Text.gs — fonctions PURES (sans service Google) : SRT, contrôles, anonymisation, rendu.
 * Elles sont testées hors ligne par tests/gs.test.js (node).
 */

// ===================== SRT =====================

function srtTimeToSec_(t) {
  var m = String(t).trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
}

function secToSrtTime_(s) {
  var ms = Math.round(s * 1000);
  var h = Math.floor(ms / 3600000); ms -= h * 3600000;
  var m = Math.floor(ms / 60000); ms -= m * 60000;
  var sec = Math.floor(ms / 1000); ms -= sec * 1000;
  function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  return p(h, 2) + ':' + p(m, 2) + ':' + p(sec, 2) + ',' + p(ms, 3);
}

/** "mm:ss" ou "h:mm:ss" pour YouTube */
function secToClock_(s) {
  s = Math.max(0, Math.floor(s));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  var mm = (m < 10 ? '0' : '') + m, ss = (sec < 10 ? '0' : '') + sec;
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}

function clockToSec_(c) {
  var parts = String(c).trim().split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  return parts.reduce(function (acc, v) { return acc * 60 + v; }, 0);
}

/** Parse un SRT → [{i, start, end, text}] */
function parseSrt_(content) {
  var blocks = String(content).replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/);
  var cues = [];
  blocks.forEach(function (b) {
    var lines = b.split('\n').filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) return;
    var tIdx = lines[0].indexOf('-->') >= 0 ? 0 : 1;
    var tl = lines[tIdx];
    if (!tl || tl.indexOf('-->') < 0) return;
    var t = tl.split('-->');
    cues.push({
      i: cues.length + 1,
      start: srtTimeToSec_(t[0]),
      end: srtTimeToSec_(t[1]),
      text: lines.slice(tIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    });
  });
  return cues;
}

function buildSrt_(cues) {
  return cues.map(function (c, k) {
    return (k + 1) + '\n' + secToSrtTime_(c.start) + ' --> ' + secToSrtTime_(c.end) + '\n' + c.text + '\n';
  }).join('\n');
}

function endsSentence_(text) { return /[.!?…»"]\s*$/.test(String(text).trim()); }

/** Diagnostic d'un SRT : exploitable ? */
function diagnoseCues_(cues, minWords) {
  var issues = [];
  if (!cues.length) return { ok: false, words: 0, duration: 0, issues: ['SRT vide ou illisible'] };
  var words = cues.map(function (c) { return c.text; }).join(' ').split(/\s+/).filter(String).length;
  var duration = cues[cues.length - 1].end - cues[0].start;
  for (var k = 0; k < cues.length; k++) {
    if (isNaN(cues[k].start) || isNaN(cues[k].end) || cues[k].end < cues[k].start) { issues.push('horodatage invalide (repère ' + cues[k].i + ')'); break; }
    if (k > 0 && cues[k].start + 0.001 < cues[k - 1].start) { issues.push('horodatages non croissants (repère ' + cues[k].i + ')'); break; }
  }
  if (words < minWords) issues.push('trop court (' + words + ' mots < ' + minWords + ')');
  if (!endsSentence_(cues[cues.length - 1].text)) issues.push('avertissement : finit au milieu d\'une phrase');
  var blocking = issues.filter(function (i) { return i.indexOf('avertissement') !== 0; });
  return { ok: blocking.length === 0, words: words, duration: duration, issues: issues };
}

/** Découpe une liste de repères en extraits de ~targetSec, coupés en fin de phrase. */
function splitCuesIntoExtracts_(cues, targetSec, minSec) {
  var extracts = [], cur = [];
  minSec = minSec || targetSec * 0.5;
  cues.forEach(function (c, k) {
    cur.push(c);
    var dur = c.end - cur[0].start;
    var last = k === cues.length - 1;
    if ((dur >= targetSec && endsSentence_(c.text)) || dur >= targetSec * 1.6 || last) {
      extracts.push({ start: cur[0].start, end: c.end, cues: cur });
      cur = [];
    }
  });
  // fusionne un dernier extrait trop court avec le précédent
  if (extracts.length > 1 && (extracts[extracts.length - 1].end - extracts[extracts.length - 1].start) < minSec) {
    var lastEx = extracts.pop();
    var prev = extracts[extracts.length - 1];
    prev.end = lastEx.end; prev.cues = prev.cues.concat(lastEx.cues);
  }
  return extracts;
}

/** Texte horodaté compact pour l'IA : "[mm:ss] phrase…" toutes les ~15 s. */
function cuesToTimedText_(cues, stepSec) {
  stepSec = stepSec || 15;
  var out = [], buf = [], bufStart = null;
  cues.forEach(function (c) {
    if (bufStart === null) bufStart = c.start;
    buf.push(c.text);
    if (c.end - bufStart >= stepSec && endsSentence_(c.text)) {
      out.push('[' + secToClock_(bufStart) + '] ' + buf.join(' '));
      buf = []; bufStart = null;
    }
  });
  if (buf.length) out.push('[' + secToClock_(bufStart) + '] ' + buf.join(' '));
  return out.join('\n');
}

// ===================== Anonymisation (RGPD) =====================

/** Retire e-mails, téléphones, et noms listés dans Config NOMS_A_ANONYMISER avant tout envoi à une IA. */
function anonymize_(text, namesCsv) {
  var t = String(text);
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
  t = t.replace(/(\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g, '[TEL]');
  t = t.replace(/\b([Jj]e m['’]appelle|[Mm]on (?:pr[ée]nom|nom) (?:est|c'est)|[Mm]oi c['’]est)\s+([A-ZÉÈ][a-zéèëïçà-]+)(\s+[A-ZÉÈ][a-zéèëïçà-]+)?/g, '$1 [PERSONNE]');
  String(namesCsv || '').split(/[;,]/).map(function (n) { return n.trim(); }).filter(String).forEach(function (n) {
    t = t.replace(new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '[PERSONNE]');
  });
  return t;
}

// ===================== Source de vérité =====================

function normalize_(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

/** Formes numériques équivalentes : "1 200" / "1200" / "1,5" / "1.5" */
function numberVariants_(n) {
  var raw = n.replace(/\s/g, '');
  return [raw, raw.replace(',', '.'), raw.replace('.', ',')];
}

var NUMBER_WORDS_ = { 'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10, 'onze': 11, 'douze': 12, 'quinze': 15, 'vingt': 20, 'trente': 30, 'cent': 100, 'mille': 1000 };

/**
 * Vérifie qu'aucun chiffre / nom propre / sigle de la sortie n'est absent de la source.
 * Retourne {ok, invented:[...]}. Les numéros de liste ("1/6"), horodatages et termes autorisés sont ignorés.
 */
function checkFacts_(output, source, allowedCsv) {
  var src = normalize_(source);
  var srcDigits = src.replace(/(\d)[\s.](?=\d{3}\b)/g, '$1');
  var allowed = String(allowedCsv || '').split(/[;,]/).map(function (a) { return normalize_(a.trim()); }).filter(String);
  var invented = [];
  var out = String(output)
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')          // horodatages
    .replace(/(^|\n)\s*\d+\s*[\/.)]\s*\d*/g, '$1 ')      // numérotation de liste / thread
    .replace(/#[\wÀ-ÿ]+/g, ' ')                          // hashtags
    .replace(/https?:\/\/\S+/g, ' ');

  // 1) nombres
  var nums = out.match(/\d+(?:[  ]\d{3})*(?:[.,]\d+)?/g) || [];
  nums.forEach(function (n) {
    var vs = numberVariants_(n);
    var found = vs.some(function (v) { return srcDigits.indexOf(normalize_(v)) >= 0; });
    if (!found) {
      var val = parseFloat(vs[1]);
      found = Object.keys(NUMBER_WORDS_).some(function (w) { return NUMBER_WORDS_[w] === val && new RegExp('\\b' + w + '\\b').test(src); });
    }
    if (!found && allowed.indexOf(normalize_(n)) < 0) invented.push(n.trim());
  });

  // 2) sigles (2+ majuscules) et noms propres (Majuscule hors début de phrase)
  var tokens = out.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*/g) || [];
  var sentenceStart = true;
  var parts = out.split(/([.!?\n:•—–-]\s*)/);
  parts.forEach(function (chunk) {
    if (/^[.!?\n:•—–-]\s*$/.test(chunk)) { sentenceStart = true; return; }
    (chunk.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g) || []).forEach(function (w) {
      var isAcronym = /^[A-ZÀ-Ý]{2,}s?$/.test(w);
      var isProper = /^[A-ZÀ-Ý][a-zà-ÿ]/.test(w) && !sentenceStart;
      sentenceStart = false;
      if (!isAcronym && !isProper) return;
      var nw = normalize_(w).replace(/['’]s$/, '');
      if (nw.length < 2) return;
      if (allowed.indexOf(nw) >= 0) return;
      if (src.indexOf(nw) >= 0) return;
      invented.push(w);
    });
  });
  void tokens;
  var uniq = invented.filter(function (v, i, a) { return a.indexOf(v) === i; });
  return { ok: uniq.length === 0, invented: uniq };
}

/**
 * Un texte français rédigé (au moins 40 mots) contient forcément des accents.
 * Les listes courtes (titres de chapitres, hashtags) peuvent légitimement n'en avoir aucun.
 */
function hasFrenchAccents_(t) {
  t = String(t);
  return countWords_(t.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')) < 40 || /[éèêëàâùûçîïô]/i.test(t);
}

// ===================== Contraintes de format =====================

function countWords_(t) { return String(t).split(/\s+/).filter(function (w) { return /[A-Za-zÀ-ÿ0-9]/.test(w); }).length; }

function num_(v) { return (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v); }

/**
 * Contrôle automatique d'une sortie texte vs les contraintes de l'onglet Formats.
 * itemTexts = rendu individuel de chaque item (ex. un tweet) pour item_max_car.
 */
function checkConstraints_(rendered, data, fmt, ctx) {
  var errors = [];
  var chars = String(rendered).length, words = countWords_(rendered);
  var items = (data && data.items) || [];
  var c = {
    min_car: num_(fmt.min_car), max_car: num_(fmt.max_car), min_mots: num_(fmt.min_mots), max_mots: num_(fmt.max_mots),
    min_items: num_(fmt.min_items), max_items: num_(fmt.max_items), item_max_car: num_(fmt.item_max_car),
    duree_min_s: num_(fmt.duree_min_s), duree_max_s: num_(fmt.duree_max_s)
  };
  if (!String(rendered).trim()) errors.push('sortie vide');
  if (c.min_car !== null && chars < c.min_car) errors.push('trop court : ' + chars + ' car. < ' + c.min_car);
  if (c.max_car !== null && chars > c.max_car) errors.push('trop long : ' + chars + ' car. > ' + c.max_car);
  if (c.min_mots !== null && words < c.min_mots) errors.push('trop peu de mots : ' + words + ' < ' + c.min_mots);
  if (c.max_mots !== null && words > c.max_mots) errors.push('trop de mots : ' + words + ' > ' + c.max_mots);
  if (c.min_items !== null && items.length < c.min_items) errors.push('items : ' + items.length + ' < ' + c.min_items);
  if (c.max_items !== null && items.length > c.max_items) errors.push('items : ' + items.length + ' > ' + c.max_items);
  if (ctx && ctx.itemTexts) {
    ctx.itemTexts.forEach(function (t, k) {
      if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) errors.push('item ' + (k + 1) + ' vide');
    });
  }
  if (c.item_max_car !== null && ctx && ctx.itemTexts) {
    ctx.itemTexts.forEach(function (t, k) {
      if (t.length > c.item_max_car) errors.push('item ' + (k + 1) + ' : ' + t.length + ' car. > ' + c.item_max_car);
    });
  }
  // horodatages (chapitres YouTube, passages clés)
  // horodatages vérifiés seulement pour les formats qui les utilisent (chapitres, passages clés) :
  // un champ « temps » rempli mais non affiché (ex. sections d'un blog) est ignoré.
  var usesTime = String(fmt.rendu || '').indexOf('{{temps}}') >= 0 || ['chapitres', 'json'].indexOf(String(fmt.sortie)) >= 0 || fmt.format_id === 'YT_CHAPITRES';
  var timed = usesTime ? items.filter(function (it) { return it && it.temps; }) : [];
  if (timed.length) {
    var prev = -1;
    var srcStart = ctx && ctx.sourceStart !== undefined ? ctx.sourceStart : 0;
    var srcEnd = ctx && ctx.sourceEnd !== undefined ? ctx.sourceEnd : Infinity;
    timed.forEach(function (it, k) {
      var t = clockToSec_(it.temps);
      if (isNaN(t)) { errors.push('horodatage illisible : ' + it.temps); return; }
      // 00:00 est toujours permis (YouTube impose un 1er chapitre à 00:00, même si la parole commence plus tard)
      if ((t < srcStart - 1 && t !== 0) || t > srcEnd + 1) errors.push('horodatage hors source : ' + it.temps);
      if (fmt.format_id === 'YT_CHAPITRES' || String(fmt.sortie) === 'chapitres') {
        if (k === 0 && t !== 0) errors.push('le 1er chapitre doit commencer à 00:00');
        if (k > 0 && t - prev < 10) errors.push('chapitres espacés de moins de 10 s (' + it.temps + ')');
        if (t <= prev) errors.push('chapitres non croissants (' + it.temps + ')');
      }
      if (it.fin) {
        var f = clockToSec_(it.fin), d = f - t;
        if (isNaN(f) || d <= 0) errors.push('fin invalide : ' + it.fin);
        else {
          if (c.duree_min_s !== null && d < c.duree_min_s) errors.push('passage trop court (' + Math.round(d) + ' s)');
          if (c.duree_max_s !== null && d > c.duree_max_s) errors.push('passage trop long (' + Math.round(d) + ' s)');
        }
      }
      prev = t;
    });
  }
  return { ok: errors.length === 0, errors: errors, stats: { chars: chars, words: words, items: items.length } };
}

// ===================== JSON robuste =====================

/** Extrait un objet JSON d'une réponse d'IA (gère ```json, texte autour, virgules finales). */
function parseJsonLoose_(text) {
  if (text && typeof text === 'object') return text;
  var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) { /* continue */ }
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    var sub = t.substring(a, b + 1).replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(sub); } catch (e2) { /* continue */ }
  }
  throw new Error('JSON invalide renvoyé par l\'IA');
}

// ===================== Rendu (mini-gabarit) =====================

/**
 * Gabarit éditable dans Formats!rendu :
 *   {{titre}} {{contenu}} {{hashtags}} {{source_titre}}
 *   {{#items}} … {{n}} {{total}} {{titre}} {{texte}} {{temps}} {{fin}} … {{/items}}
 * "\n" littéral dans la cellule = saut de ligne.
 */
function renderTemplate_(tpl, data, extra) {
  tpl = String(tpl || '{{titre}}\n\n{{contenu}}').replace(/\\n/g, '\n');
  var items = (data.items || []);
  var itemTexts = [];
  var out = tpl.replace(/\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g, function (_, block) {
    return items.map(function (it, k) {
      if (typeof it === 'string') it = { texte: it };
      // un modèle qui range le texte dans « titre » ne doit pas produire d'item vide
      if (!String(it.texte || '').trim() && block.indexOf('{{titre}}') < 0 && it.titre) it = { texte: it.titre, temps: it.temps, fin: it.fin };
      var r = block.replace(/\{\{(\w+)\}\}/g, function (__, key) {
        if (key === 'n') return String(k + 1);
        if (key === 'total') return String(items.length);
        return it[key] === undefined || it[key] === null ? '' : String(it[key]);
      });
      itemTexts.push(r.trim());
      return r;
    }).join('');
  });
  var hashtags = (data.hashtags || []).map(function (h) { h = String(h).trim(); return h.charAt(0) === '#' ? h : '#' + h.replace(/\s+/g, ''); }).join(' ');
  var vars = { titre: data.titre || '', contenu: data.contenu || '', hashtags: hashtags };
  Object.keys(extra || {}).forEach(function (k) { vars[k] = extra[k]; });
  out = out.replace(/\{\{(\w+)\}\}/g, function (_, key) { return vars[key] === undefined ? '' : String(vars[key]); });
  out = out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { text: out, itemTexts: itemTexts };
}

/** Remplit les {{variables}} d'une consigne. */
function fillPrompt_(tpl, vars) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, function (m, k) {
    return (vars[k] === undefined || vars[k] === null || vars[k] === '') ? 'non précisé' : String(vars[k]);
  });
}

/** Estimation de taille de police pour que le texte tienne dans une boîte (gabarits PDF). */
function fitFontSize_(text, boxW, boxH, maxSize, minSize) {
  var len = String(text).length || 1;
  for (var size = maxSize; size >= minSize; size--) {
    var charsPerLine = Math.max(1, Math.floor(boxW / (size * 0.52)));
    var lines = 0;
    String(text).split('\n').forEach(function (para) { lines += Math.max(1, Math.ceil(para.length / charsPerLine)); });
    if (lines * size * 1.3 <= boxH) return size;
  }
  void len;
  return minSize;
}

// export pour les tests node
if (typeof module !== 'undefined') {
  module.exports = {
    parseSrt_: parseSrt_, buildSrt_: buildSrt_, srtTimeToSec_: srtTimeToSec_, secToSrtTime_: secToSrtTime_,
    secToClock_: secToClock_, clockToSec_: clockToSec_, diagnoseCues_: diagnoseCues_,
    splitCuesIntoExtracts_: splitCuesIntoExtracts_, cuesToTimedText_: cuesToTimedText_, anonymize_: anonymize_,
    checkFacts_: checkFacts_, checkConstraints_: checkConstraints_, parseJsonLoose_: parseJsonLoose_,
    renderTemplate_: renderTemplate_, fillPrompt_: fillPrompt_, fitFontSize_: fitFontSize_, countWords_: countWords_, hasFrenchAccents_: hasFrenchAccents_
  };
}
