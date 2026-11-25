/**
 * Orders.gs — une case cochée dans Ordres = un lot entier.
 * Ordre = (sources × formats). Les lignes du Journal sont créées automatiquement (idempotent).
 *   sources : "*" | "SRC-001*" (joker) | "SRC-001, SRC-002"
 *   formats : "" (= recette de chaque source) | "RECETTE:STAR" | "*" | "BLOG, LINKEDIN"
 */

/** Déclencheur installable onEdit (créé par installer()). */
function onEditInstalled(e) {
  try {
    var s = e.range.getSheet();
    if (s.getName() !== SH.ORDRES || e.range.getRow() < 2) return;
    var idx = headerIndex_(SH.ORDRES);
    if (e.range.getColumn() !== idx.lancer) return;
    if (e.range.getValue() !== true) return;
    lancerOrdre_(e.range.getRow());
  } catch (err) {
    toast_('Erreur : ' + err.message);
  }
}

/** Menu : lance toutes les lignes d'Ordres cochées et pas encore lancées. */
function lancerOrdresCoches() {
  readTable_(SH.ORDRES).rows.forEach(function (o) {
    if (o.lancer === true && String(o.statut).indexOf('LANCE') !== 0) lancerOrdre_(o._row);
  });
}

function lancerOrdre_(rowNum) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var o = readTable_(SH.ORDRES).rows.filter(function (r) { return r._row === rowNum; })[0];
    if (!o.order_id) { o.order_id = 'ORD-' + Utilities.formatDate(new Date(), 'Europe/Paris', 'yyMMdd-HHmmss'); updateRow_(SH.ORDRES, rowNum, { order_id: o.order_id, cree_le: now_() }); }
    preparerSources();
    var res = expandOrder_(o);
    updateRow_(SH.ORDRES, rowNum, {
      statut: 'LANCE — ' + res.created + ' créée(s), ' + res.skippedOk + ' déjà OK, ' + res.skippedIncompatible + ' incompatible(s), ' + res.skippedSource + ' source(s) non exploitable(s)',
      nb_sorties: res.created + res.skippedOk
    });
  } finally {
    lock.releaseLock();
  }
  demarrerTraitement();
}

function matchList_(spec, ids) {
  spec = String(spec || '').trim();
  if (spec === '' || spec === '*') return ids.slice();
  var parts = spec.split(/[,;\n]/).map(function (p) { return p.trim(); }).filter(String);
  return ids.filter(function (id) {
    return parts.some(function (p) {
      if (p.indexOf('*') >= 0) return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(id);
      return p === id;
    });
  });
}

function formatsForSpec_(spec, formats, source) {
  var ids = Object.keys(formats).filter(function (id) { return String(formats[id].actif).toUpperCase() !== 'NON' && formats[id].actif !== false; });
  spec = String(spec || '').trim();
  var recipe = null;
  if (spec === '') recipe = String(source.recette || 'STAR');
  else if (/^RECETTE:/i.test(spec)) recipe = spec.split(':')[1].trim();
  if (recipe) {
    return ids.filter(function (id) {
      var tags = String(formats[id].recettes || '').split(/[,;\s]+/).map(function (t) { return t.toUpperCase(); });
      return tags.indexOf(recipe.toUpperCase()) >= 0;
    });
  }
  return matchList_(spec, ids);
}

/** Ajoute les dépendances (ex. CLIP_9X16 nécessite MOMENTS_CLES) */
function withDependencies_(fids, formats) {
  var out = fids.slice();
  fids.forEach(function (f) {
    var dep = String(formats[f].depend_de || '').trim();
    if (dep && formats[dep] && out.indexOf(dep) < 0) out.unshift(dep);
  });
  return out;
}

function expandOrder_(o) {
  var sources = getSources_(), formats = getFormats_();
  var journal = readTable_(SH.JOURNAL).rows;
  var cfg = getConfig_();
  var srcIds = matchList_(o.sources, Object.keys(sources));
  var force = o.forcer_relance === true;
  var res = { created: 0, skippedOk: 0, skippedIncompatible: 0, skippedSource: 0 };
  var rows = [];

  srcIds.forEach(function (sid) {
    var s = sources[sid];
    if (String(s.exploitable).toUpperCase() !== 'OUI') { res.skippedSource++; return; }
    var fids = withDependencies_(formatsForSpec_(o.formats, formats, s), formats);
    fids.forEach(function (fid) {
      var f = formats[fid];
      var allowed = String(f.types_source || '').split(/[,;\s]+/).filter(String);
      if (allowed.length && allowed.indexOf(String(s.type)) < 0) { res.skippedIncompatible++; return; }
      var existing = journal.filter(function (j) { return j.source_id === sid && j.format_id === fid; });
      var active = existing.filter(function (j) { return [STATUT.OK, STATUT.TODO, STATUT.RUN, STATUT.WAIT].indexOf(j.statut) >= 0; });
      if (active.length && !force) { res.skippedOk++; return; }  // relance sans refaire ce qui est OK
      var version = existing.reduce(function (m, j) { return Math.max(m, Number(j.version) || 0); }, 0) + 1;
      rows.push({
        output_id: sid + '__' + fid + '__v' + pad2_(version),
        order_id: o.order_id, source_id: sid, format_id: fid, niveau: f.niveau, moteur: f.moteur || 'apps_script',
        statut: STATUT.TODO, tentatives: 0, genere_par_ia: 'O', valide_humain: 'N',
        ton: o.ton || cfg.TON_DEFAUT, public: o.public || cfg.PUBLIC_DEFAUT, longueur: o.longueur || cfg.LONGUEUR_DEFAUT,
        version: version, cree_le: now_(), maj_le: now_()
      });
      res.created++;
    });
  });
  appendRows_(SH.JOURNAL, rows);
  return res;
}

/** Menu : remet en file les sorties en ERREUR ou REJETE (nouvelle tentative). */
function relancerErreurs() {
  var n = 0;
  readTable_(SH.JOURNAL).rows.forEach(function (j) {
    if (j.statut === STATUT.ERR || j.statut === STATUT.REJ) {
      updateRow_(SH.JOURNAL, j._row, { statut: STATUT.TODO, tentatives: 0, raison: 'relance manuelle — ' + j.raison, maj_le: now_() });
      n++;
    }
  });
  toast_(n + ' sortie(s) remise(s) en file.');
  if (n) demarrerTraitement();
}

function majStatutsOrdres_() {
  var journal = readTable_(SH.JOURNAL).rows;
  readTable_(SH.ORDRES).rows.forEach(function (o) {
    if (!o.order_id) return;
    var mine = journal.filter(function (j) { return j.order_id === o.order_id; });
    if (!mine.length) return;
    var ok = mine.filter(function (j) { return j.statut === STATUT.OK; }).length;
    var err = mine.filter(function (j) { return j.statut === STATUT.ERR || j.statut === STATUT.REJ; }).length;
    var pending = mine.length - ok - err;
    var st = pending ? 'EN COURS (' + pending + ' restantes)' : (err ? 'TERMINE AVEC ERREURS' : 'TERMINE');
    updateRow_(SH.ORDRES, o._row, { ok: ok, erreurs: err, statut: 'LANCE — ' + st });
  });
}
