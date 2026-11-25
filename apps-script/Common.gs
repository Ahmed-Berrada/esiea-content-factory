/**
 * Common.gs — constantes, lecture/écriture des onglets, configuration.
 * Toute la logique métier (prompts, formats, modèles) vit dans la Sheet, pas ici.
 */

var SH = {
  CONFIG: 'Config',
  SOURCES: 'Sources',
  FORMATS: 'Formats',
  PROMPTS: 'Prompts',
  ORDRES: 'Ordres',
  JOURNAL: 'Journal',
  DASH: 'Dashboard'
};

var HEADERS = {
  Config: ['cle', 'valeur', 'description'],
  Sources: ['source_id', 'titre', 'type', 'fichier_id', 'fichier_video_id', 'url', 'debut', 'fin',
    'langue', 'recette', 'anonymise', 'nb_mots', 'duree_s', 'exploitable', 'diagnostic', 'parent_id', 'maj_le'],
  Formats: ['format_id', 'nom', 'niveau', 'etoile', 'moteur', 'canal', 'prompt_id', 'sortie', 'types_source',
    'min_car', 'max_car', 'min_mots', 'max_mots', 'min_items', 'max_items', 'item_max_car',
    'largeur', 'hauteur', 'duree_min_s', 'duree_max_s', 'depend_de', 'recettes', 'actif', 'rendu'],
  Prompts: ['prompt_id', 'type', 'description', 'texte'],
  Ordres: ['order_id', 'lancer', 'sources', 'formats', 'ton', 'public', 'longueur', 'forcer_relance',
    'statut', 'nb_sorties', 'ok', 'erreurs', 'cree_le'],
  Journal: ['output_id', 'order_id', 'source_id', 'format_id', 'niveau', 'moteur', 'statut', 'tentatives',
    'fichier', 'file_id', 'lien', 'dossier', 'modele', 'tokens_in', 'tokens_out', 'cout_usd', 'duree_s',
    'controle_auto', 'score_relecteur', 'raison', 'genere_par_ia', 'valide_humain', 'origine_medias',
    'ton', 'public', 'longueur', 'version', 'cree_le', 'maj_le', 'conforme']
};

var STATUT = { TODO: 'A_FAIRE', RUN: 'EN_COURS', OK: 'OK', ERR: 'ERREUR', REJ: 'REJETE', WAIT: 'ATTENTE_DEP' };

// ---------- accès aux onglets ----------

function ss_() { return SpreadsheetApp.getActive(); }

function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new Error('Onglet manquant : ' + name + ' (lancez Usine ▸ Installer)');
  return s;
}

/** Lit un onglet en tableau d'objets {colonne: valeur, _row: n°ligne}. */
function readTable_(name) {
  var s = sheet_(name);
  var values = s.getDataRange().getValues();
  if (values.length === 0) return { headers: [], rows: [] };
  var headers = values[0].map(String);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r.join('') === '') continue;
    var o = { _row: i + 1 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function headerIndex_(name) {
  var s = sheet_(name);
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
  var idx = {};
  headers.forEach(function (h, j) { idx[h] = j + 1; });
  return idx;
}

/** Met à jour quelques colonnes d'une ligne (patch partiel). */
function updateRow_(name, rowNum, patch) {
  var s = sheet_(name);
  var idx = headerIndex_(name);
  Object.keys(patch).forEach(function (k) {
    if (idx[k]) s.getRange(rowNum, idx[k]).setValue(patch[k]);
  });
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var s = sheet_(name);
  var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
  var data = objs.map(function (o) { return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; }); });
  s.getRange(s.getLastRow() + 1, 1, data.length, headers.length).setValues(data);
}

// ---------- configuration ----------

var CONFIG_CACHE_ = null;

/** Config = paires clé/valeur de l'onglet Config. */
function getConfig_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  var cfg = {};
  readTable_(SH.CONFIG).rows.forEach(function (r) { if (r.cle) cfg[String(r.cle).trim()] = r.valeur; });
  CONFIG_CACHE_ = cfg;
  return cfg;
}

function cfgNum_(key, dflt) {
  var v = getConfig_()[key];
  var n = Number(v);
  return (v === '' || v === undefined || isNaN(n)) ? dflt : n;
}

function cfgBool_(key, dflt) {
  var v = getConfig_()[key];
  if (v === '' || v === undefined) return dflt;
  return v === true || String(v).toUpperCase() === 'TRUE' || String(v).toUpperCase() === 'OUI';
}

function setConfigValue_(key, value) {
  var t = readTable_(SH.CONFIG);
  var row = t.rows.filter(function (r) { return r.cle === key; })[0];
  if (row) updateRow_(SH.CONFIG, row._row, { valeur: value });
  else appendRows_(SH.CONFIG, [{ cle: key, valeur: value, description: '' }]);
  CONFIG_CACHE_ = null;
}

function getPrompts_() {
  var p = {};
  readTable_(SH.PROMPTS).rows.forEach(function (r) { if (r.prompt_id) p[String(r.prompt_id).trim()] = String(r.texte || ''); });
  return p;
}

function getFormats_() {
  var f = {};
  readTable_(SH.FORMATS).rows.forEach(function (r) { if (r.format_id) f[String(r.format_id).trim()] = r; });
  return f;
}

function getSources_() {
  var s = {};
  readTable_(SH.SOURCES).rows.forEach(function (r) { if (r.source_id) s[String(r.source_id).trim()] = r; });
  return s;
}

/** Clé d'API : jamais dans la Sheet ni le code → Propriétés du script. */
function getApiKey_(provider) {
  var key = PropertiesService.getScriptProperties().getProperty('API_KEY_' + String(provider).toUpperCase());
  if (!key) throw new Error('Clé API absente : ajoutez la propriété de script API_KEY_' + String(provider).toUpperCase());
  return key;
}

function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd HH:mm:ss'); }

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Convention de nommage : <SOURCE>__<FORMAT>__vNN.<ext> */
function outputFileName_(sourceId, formatId, version, ext) {
  return sourceId + '__' + formatId + '__v' + pad2_(version) + '.' + ext;
}

var FILE_NAME_REGEX = /^[A-Z0-9-]+__[A-Z0-9_]+__v\d{2}\.[a-z0-9]+$/;
