/**
 * Setup.gs — menu, installation en 1 clic (onglets + Drive + déclencheurs), Dashboard, contrôle de conformité.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏭 Usine ESIEA')
    .addItem('1. Installer / réparer (onglets, Drive, déclencheurs)', 'installer')
    .addSeparator()
    .addItem('Importer les sources depuis Drive/01_Sources', 'importerSources')
    .addItem('Créer les extraits vidéo (découpage auto)', 'creerExtraits')
    .addItem('Préparer / diagnostiquer les sources', 'preparerSources')
    .addSeparator()
    .addItem('Lancer les ordres cochés', 'lancerOrdresCoches')
    .addItem('Relancer les erreurs / rejets', 'relancerErreurs')
    .addItem('Relancer le traitement (file d\'attente)', 'demarrerTraitement')
    .addSeparator()
    .addItem('Vérifier la conformité des sorties', 'verifierConformite')
    .addItem('Générer le tone of voice d\'un canal (exemples)', 'analyserTonCanal')
    .addToUi();
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Usine ESIEA', 6); } catch (e) { Logger.log(msg); }
}

function installer() {
  var ss = ss_();
  var created = [];
  [SH.CONFIG, SH.SOURCES, SH.FORMATS, SH.PROMPTS, SH.ORDRES, SH.JOURNAL].forEach(function (name) {
    var s = ss.getSheetByName(name);
    if (!s) { s = ss.insertSheet(name); created.push(name); }
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]])
        .setFontWeight('bold').setBackground('#002D72').setFontColor('#FFFFFF');
      s.setFrozenRows(1);
      var seed = { Config: seedConfig_, Formats: seedFormats_, Prompts: seedPrompts_, Sources: seedSources_ }[name];
      if (seed) {
        var rows = seed().map(function (r) { while (r.length < HEADERS[name].length) r.push(''); return r; });
        s.getRange(2, 1, rows.length, HEADERS[name].length).setValues(rows);
      }
    }
  });
  CONFIG_CACHE_ = null;
  installDrive_();
  formatSheets_();
  buildDashboard_();
  installTriggers_();
  var d = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (d && ss.getSheets().length > 1 && d.getLastRow() === 0) ss.deleteSheet(d);
  toast_('Installation terminée. Onglets créés : ' + (created.join(', ') || 'aucun (déjà présents)'));
}

function installDrive_() {
  var cfg = getConfig_();
  var root;
  // Sheet copiée (« Fichier › Créer une copie ») : on ne réutilise pas les dossiers de l'original
  if (cfg.INSTALL_SHEET_ID && cfg.INSTALL_SHEET_ID !== ss_().getId()) {
    ['DRIVE_ROOT_ID', 'SOURCES_FOLDER_ID', 'SORTIES_FOLDER_ID', 'GABARITS_FOLDER_ID'].forEach(function (k) { setConfigValue_(k, ''); });
    cfg = getConfig_();
  }
  setConfigValue_('INSTALL_SHEET_ID', ss_().getId());
  if (cfg.DRIVE_ROOT_ID) { try { root = DriveApp.getFolderById(cfg.DRIVE_ROOT_ID); } catch (e) { root = null; } }
  if (!root) {
    root = DriveApp.createFolder('ESIEA_Content_Factory');
    DriveApp.getFileById(ss_().getId()).moveTo(root);
    setConfigValue_('DRIVE_ROOT_ID', root.getId());
  }
  var ids = {
    SOURCES_FOLDER_ID: subFolder_(root.getId(), '01_Sources').getId(),
    SORTIES_FOLDER_ID: subFolder_(root.getId(), '02_Sorties').getId(),
    GABARITS_FOLDER_ID: subFolder_(root.getId(), '03_Gabarits').getId()
  };
  subFolder_(root.getId(), '05_Editables');
  Object.keys(ids).forEach(function (k) { setConfigValue_(k, ids[k]); });
  // sous-dossiers par format (arborescence fixe, connue d'avance)
  Object.keys(getFormats_()).forEach(function (fid) { subFolder_(ids.SORTIES_FOLDER_ID, fid); });
  subFolder_(ids.SORTIES_FOLDER_ID, '_REJETS');
}

function installTriggers_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onEditInstalled'; });
  if (!has) ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss_()).onEdit().create();
}

function formatSheets_() {
  var o = sheet_(SH.ORDRES), oi = headerIndex_(SH.ORDRES);
  o.getRange(2, oi.lancer, 500, 1).insertCheckboxes();
  o.getRange(2, oi.forcer_relance, 500, 1).insertCheckboxes();
  if (o.getLastRow() < 2) {
    o.getRange(2, 1, 2, 7).setValues([
      ['', false, '*', 'RECETTE:STAR', '', '', ''],
      ['', false, 'WEB-*', 'LINKEDIN, THREAD_X', 'enthousiaste et direct', 'lycéens de terminale', 'court']
    ]);
  }
  var j = sheet_(SH.JOURNAL), ji = headerIndex_(SH.JOURNAL);
  j.getRange(2, ji.valide_humain, 2000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['O', 'N'], true).build());
  var statutCol = j.getRange(2, ji.statut, 2000, 1);
  var rules = [
    ['OK', '#D9EAD3'], ['ERREUR', '#F4CCCC'], ['REJETE', '#FCE5CD'], ['EN_COURS', '#FFF2CC'], ['A_FAIRE', '#EFEFEF'], ['ATTENTE_DEP', '#EFEFEF']
  ].map(function (r) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(r[0]).setBackground(r[1]).setRanges([statutCol]).build(); });
  j.setConditionalFormatRules(rules);
  sheet_(SH.PROMPTS).setColumnWidth(4, 700).getRange('D:D').setWrap(true);
  sheet_(SH.CONFIG).setColumnWidth(1, 260).setColumnWidth(2, 320).setColumnWidth(3, 480);
}

function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Dashboard 100 % formules : se met à jour tout seul à chaque écriture dans le Journal. */
/**
 * Les formules sont écrites avec des virgules (syntaxe US) ; dans les Sheets en paramètres régionaux
 * à virgule décimale (fr_FR…), Google attend des points-virgules → conversion automatique.
 */
function fx_(f) {
  var loc = String(ss_().getSpreadsheetLocale() || 'en_US');
  if (/^(en|ja|zh|ko|he|iw|th|hi|ms|fil|tl)/i.test(loc)) return f;
  // remplace les virgules hors chaînes "..."
  return f.split('"').map(function (part, i) { return i % 2 ? part : part.replace(/,/g, ';'); }).join('"');
}

function buildDashboard_() {
  var ss = ss_();
  var d = ss.getSheetByName(SH.DASH) || ss.insertSheet(SH.DASH);
  d.clear();
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  var ji = headerIndex_(SH.JOURNAL);
  function J(col) { return 'Journal!' + colLetter_(ji[col]) + '2:' + colLetter_(ji[col]); }
  var st = J('statut'), fmt = J('format_id'), cost = J('cout_usd'), dur = J('duree_s'), val = J('valide_humain'), conf = J('conforme');

  d.getRange('A1').setValue('🏭 Usine à contenus ESIEA — Tableau de bord').setFontSize(16).setFontWeight('bold').setFontColor('#002D72');
  d.getRange('A2').setFormula(fx_('="Mis à jour : "&TEXT(NOW(),"dd/mm/yyyy hh:mm")'));
  var kpis = [
    ['Sorties commandées', '=COUNTA(' + J('output_id') + ')'],
    ['✅ OK', '=COUNTIF(' + st + ',"OK")'],
    ['⏳ En cours / à faire', '=COUNTIF(' + st + ',"EN_COURS")+COUNTIF(' + st + ',"A_FAIRE")+COUNTIF(' + st + ',"ATTENTE_DEP")'],
    ['❌ Erreur', '=COUNTIF(' + st + ',"ERREUR")'],
    ['⚠️ Rejeté par les contrôles', '=COUNTIF(' + st + ',"REJETE")'],
    ['Taux de réussite', '=IFERROR(B5/B4,0)'],
    ['Taux de conformité (script)', '=IFERROR(COUNTIF(' + conf + ',"O")/B4,0)'],
    ['Validées par un humain', '=COUNTIFS(' + val + ',"O",' + st + ',"OK")'],
    ['Coût total (USD)', '=SUM(' + cost + ')'],
    ['Coût moyen / sortie OK (USD)', '=IFERROR(SUMIFS(' + cost + ',' + st + ',"OK")/B5,0)'],
    ['Projection 1 000 sorties (USD)', '=B13*1000'],
    ['Temps moyen / sortie (s)', '=IFERROR(AVERAGEIFS(' + dur + ',' + st + ',"OK"),0)'],
    ['Projection 1 000 sorties (heures, 1 exécution)', '=B15*1000/3600'],
    ['Modèle actuel (Config)', '=IFERROR(VLOOKUP("MODEL",Config!A:B,2,FALSE),"")']
  ];
  d.getRange(4, 1, kpis.length, 1).setValues(kpis.map(function (k) { return [k[0]]; })).setFontWeight('bold');
  d.getRange(4, 2, kpis.length, 1).setFormulas(kpis.map(function (k) { return [fx_(k[1])]; }));
  d.getRange('B9:B10').setNumberFormat('0.0%');
  d.getRange('B12:B14').setNumberFormat('$0.0000');
  d.getRange('B15:B16').setNumberFormat('0.0');

  var r0 = 4 + kpis.length + 2;
  d.getRange(r0, 1, 1, 9).setValues([['Format', 'Niveau', 'Commandées', 'OK', 'En cours', 'Erreur/Rejet', 'Coût total $', 'Coût / sortie $', 'Coût 1 000 sorties $']])
    .setFontWeight('bold').setBackground('#002D72').setFontColor('#FFFFFF');
  var a = 'A' + (r0 + 1);
  d.getRange(a).setFormula(fx_('=FILTER(Formats!A2:A,Formats!A2:A<>"")'));
  d.getRange('B' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,IFERROR(VLOOKUP(' + a + ':A,Formats!A:C,3,FALSE))))'));
  d.getRange('C' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,COUNTIF(' + fmt + ',' + a + ':A)))'));
  d.getRange('D' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"OK")))'));
  d.getRange('E' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"EN_COURS")+COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"A_FAIRE")+COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"ATTENTE_DEP")))'));
  d.getRange('F' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"ERREUR")+COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"REJETE")))'));
  d.getRange('G' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,SUMIF(' + fmt + ',' + a + ':A,' + cost + ')))'));
  d.getRange('H' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,IFERROR(SUMIFS(' + cost + ',' + fmt + ',' + a + ':A,' + st + ',"OK")/COUNTIFS(' + fmt + ',' + a + ':A,' + st + ',"OK"),0)))'));
  d.getRange('I' + (r0 + 1)).setFormula(fx_('=ARRAYFORMULA(IF(' + a + ':A="",,H' + (r0 + 1) + ':H*1000))'));
  d.getRange('G' + (r0 + 1) + ':I' + (r0 + 40)).setNumberFormat('$0.0000');
  d.setColumnWidth(1, 300);

  var nFormats = Math.max(1, Object.keys(getFormats_()).length);
  var chart = d.newChart().asBarChart().setStacked()
    .addRange(d.getRange(r0, 1, nFormats + 1, 1)).addRange(d.getRange(r0, 4, nFormats + 1, 3))
    .setOption('title', 'Avancement par format').setOption('colors', ['#34A853', '#FBBC04', '#EA4335'])
    .setPosition(3, 11, 0, 0).setNumHeaders(1).build();
  d.insertChart(chart);
  ss.setActiveSheet(d);
  ss.moveActiveSheet(1);
}

/** Vérifie par script les 4 critères de conformité du barème et remplit Journal!conforme (O/N). */
function verifierConformite() {
  var formats = getFormats_();
  var n = 0, ok = 0;
  readTable_(SH.JOURNAL).rows.forEach(function (j) {
    var reasons = [];
    if (j.statut !== STATUT.OK) reasons.push('statut ' + j.statut);
    if (!FILE_NAME_REGEX.test(String(j.fichier))) reasons.push('nom non conforme');
    if (j.file_id) {
      try {
        var f = DriveApp.getFileById(j.file_id);
        if (f.isTrashed()) reasons.push('fichier à la corbeille');
        var parents = f.getParents();
        var parentName = parents.hasNext() ? parents.next().getName() : '';
        if (parentName !== j.format_id) reasons.push('mauvais dossier (' + parentName + ')');
      } catch (e) { reasons.push('fichier introuvable'); }
    } else reasons.push('pas de fichier');
    if (String(j.controle_auto).indexOf('OK') !== 0) reasons.push('contraintes Formats non respectées');
    if (!formats[j.format_id]) reasons.push('format inconnu');
    var conforme = reasons.length ? 'N' : 'O';
    updateRow_(SH.JOURNAL, j._row, { conforme: conforme });
    n++; if (conforme === 'O') ok++;
  });
  toast_('Conformité : ' + ok + ' / ' + n + ' sorties conformes.');
}

/**
 * Génère le tone of voice d'un canal à partir d'exemples réels (sources de type texte/web dont la recette = TOV_<CANAL>)
 * et l'écrit dans l'onglet Prompts (TOV_<CANAL>). L'humain relit avant usage.
 */
function analyserTonCanal() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Canal à analyser (ex. LINKEDIN). Les sources dont la recette vaut TOV_<CANAL> servent d\'exemples.');
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var canal = r.getResponseText().trim().toUpperCase();
  var sources = getSources_();
  var examples = Object.keys(sources).filter(function (id) { return String(sources[id].recette).toUpperCase() === 'TOV_' + canal; })
    .map(function (id) { return loadSource_(sources[id]).text; });
  if (!examples.length) { toast_('Aucune source avec recette TOV_' + canal); return; }
  var P = getPrompts_();
  var res = callLlm_({ system: '', user: fillPrompt_(P.P_ANALYSE_TON, { canal: canal }) + '\n\n' + examples.map(function (e, k) { return 'EXEMPLE ' + (k + 1) + ' :\n' + e; }).join('\n\n') });
  var t = readTable_(SH.PROMPTS);
  var row = t.rows.filter(function (p) { return p.prompt_id === 'TOV_' + canal; })[0];
  if (row) updateRow_(SH.PROMPTS, row._row, { texte: res.text, description: 'Généré depuis ' + examples.length + ' exemple(s) le ' + now_() });
  else appendRows_(SH.PROMPTS, [{ prompt_id: 'TOV_' + canal, type: 'voix', description: 'Généré depuis ' + examples.length + ' exemple(s)', texte: res.text }]);
  toast_('TOV_' + canal + ' mis à jour dans Prompts.');
}
