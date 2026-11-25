/**
 * Output.gs — écriture dans Drive (arborescence + nommage fixés) et gabarits PDF aux couleurs ESIEA.
 *   ESIEA_Content_Factory/02_Sorties/<FORMAT_ID>/<SOURCE>__<FORMAT>__vNN.<ext>
 *   ESIEA_Content_Factory/02_Sorties/_REJETS/…   (sorties refusées par les contrôles, pour relecture)
 *   ESIEA_Content_Factory/05_Editables/…         (versions Google Slides modifiables des PDF)
 */

function formatFolder_(formatId, rejected) {
  var root = DriveApp.getFolderById(getConfig_().SORTIES_FOLDER_ID);
  var name = rejected ? '_REJETS' : formatId;
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function subFolder_(parentId, name) {
  var p = DriveApp.getFolderById(parentId);
  var it = p.getFoldersByName(name);
  return it.hasNext() ? it.next() : p.createFolder(name);
}

function writeTextFile_(job, f, content, ext, ok) {
  var name = outputFileName_(job.source_id, job.format_id, Number(job.version) || 1, ext);
  var folder = formatFolder_(job.format_id, !ok);
  trashSameName_(folder, name);
  var mime = ext === 'json' ? 'application/json' : (ext === 'md' ? 'text/markdown' : MimeType.PLAIN_TEXT);
  var file = folder.createFile(Utilities.newBlob(content, mime, name));
  return { name: name, id: file.getId(), url: file.getUrl(), folder: folder.getName() };
}

function trashSameName_(folder, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
}

/** Choisit l'écriture selon Formats!sortie : md | txt | json | pdf_carrousel | pdf_infographie */
function saveOutput_(job, f, data, renderedText, ok) {
  var sortie = String(f.sortie || 'txt');
  if (sortie === 'pdf_carrousel' || sortie === 'pdf_infographie') {
    var r = buildPdf_(job, f, data, sortie, ok);
    r.media = getConfig_().LOGO_FILE_ID ? 'logo ESIEA officiel (fichier Drive, non généré) + texte IA' : 'texte IA (logo non configuré)';
    return r;
  }
  var ext = sortie === 'chapitres' ? 'txt' : sortie;
  var content = ext === 'json' ? JSON.stringify(data, null, 2) : renderedText;
  var w = writeTextFile_(job, f, content, ext, ok);
  w.media = 'aucun média (texte généré par IA)';
  return w;
}

// ---------------- Gabarit PDF (Google Slides → PDF) ----------------

function hex_(h, dflt) { h = String(h || dflt).trim(); return /^#[0-9a-f]{6}$/i.test(h) ? h : dflt; }

/**
 * Carrousel : 1 couverture + 1 page par item (taille carrée/portrait selon Formats!largeur/hauteur).
 * Infographie : une seule page, un bloc numéroté par item.
 * Le texte est dimensionné pour toujours tenir dans son cadre (fitFontSize_). Le logo est le fichier officiel.
 */
function buildPdf_(job, f, data, kind, ok) {
  var cfg = getConfig_();
  var W = (Number(f.largeur) || 1080) / 2, H = (Number(f.hauteur) || 1080) / 2; // px → pt
  var C1 = hex_(cfg.COULEUR_PRIMAIRE, '#002D72'), C2 = hex_(cfg.COULEUR_SECONDAIRE, '#E4003A'),
    BG = hex_(cfg.COULEUR_FOND, '#FFFFFF'), TX = hex_(cfg.COULEUR_TEXTE, '#1A1A1A');
  var fontTitle = cfg.POLICE_TITRE_SLIDES || 'Roboto', fontBody = cfg.POLICE_TEXTE_SLIDES || 'Roboto';
  var name = outputFileName_(job.source_id, job.format_id, Number(job.version) || 1, 'pdf');

  var pres = Slides.Presentations.create({
    title: name.replace(/\.pdf$/, ''),
    pageSize: { width: { magnitude: W, unit: 'PT' }, height: { magnitude: H, unit: 'PT' } }
  });
  var deck = SlidesApp.openById(pres.presentationId);
  var first = deck.getSlides()[0];
  var logoBlob = null;
  if (cfg.LOGO_FILE_ID) { try { logoBlob = DriveApp.getFileById(cfg.LOGO_FILE_ID).getBlob(); } catch (e) { logoBlob = null; } }
  var M = W * 0.08;

  function addText(slide, text, x, y, w, h, maxSize, minSize, color, font, bold) {
    var size = fitFontSize_(text, w, h, maxSize, minSize);
    var box = slide.insertTextBox(String(text), x, y, w, h);
    var st = box.getText().getTextStyle();
    st.setFontFamily(font).setFontSize(size).setForegroundColor(color).setBold(!!bold);
    box.setContentAlignment(SlidesApp.ContentAlignment.TOP);
    return box;
  }
  function decorate(slide, n, total) {
    slide.getBackground().setSolidFill(BG);
    var bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, H - H * 0.035, W, H * 0.035);
    bar.getFill().setSolidFill(C1);
    bar.getBorder().setTransparent();
    if (logoBlob) {
      var img = slide.insertImage(logoBlob);
      var lw = W * 0.2, ratio = img.getHeight() / img.getWidth();
      img.setWidth(lw).setHeight(lw * ratio).setLeft(W - M - lw).setTop(M * 0.6);
    }
    if (total) addText(slide, n + ' / ' + total, M, H - M * 1.3, W * 0.3, M * 0.6, 11, 8, C1, fontBody, true);
  }

  var items = (data.items || []).filter(function (it) { return it && (it.titre || it.texte); });
  var pages = 0;

  if (kind === 'pdf_carrousel') {
    var total = items.length + 1;
    var cover = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    decorate(cover, 1, total);
    cover.getBackground().setSolidFill(C1);
    addText(cover, data.titre || '', M, H * 0.28, W - 2 * M, H * 0.34, 40, 18, '#FFFFFF', fontTitle, true);
    addText(cover, data.contenu || '', M, H * 0.64, W - 2 * M, H * 0.2, 18, 10, '#FFFFFF', fontBody, false);
    pages++;
    items.forEach(function (it, k) {
      var sl = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
      decorate(sl, k + 2, total);
      var accent = sl.insertShape(SlidesApp.ShapeType.RECTANGLE, M, H * 0.2, W * 0.12, H * 0.012);
      accent.getFill().setSolidFill(C2);
      accent.getBorder().setTransparent();
      addText(sl, it.titre || '', M, H * 0.24, W - 2 * M, H * 0.2, 30, 14, C1, fontTitle, true);
      addText(sl, it.texte || '', M, H * 0.46, W - 2 * M, H * 0.38, 22, 10, TX, fontBody, false);
      pages++;
    });
  } else {
    var sl = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    decorate(sl, 0, 0);
    addText(sl, data.titre || '', M, M * 1.6, W - 2 * M - W * 0.2, H * 0.12, 30, 14, C1, fontTitle, true);
    addText(sl, data.contenu || '', M, M * 1.6 + H * 0.13, W - 2 * M, H * 0.09, 14, 8, TX, fontBody, false);
    var top = M * 1.6 + H * 0.24, avail = H - top - M * 1.5, n = Math.max(1, items.length), bh = avail / n;
    items.forEach(function (it, k) {
      var y = top + k * bh;
      var badge = sl.insertShape(SlidesApp.ShapeType.ELLIPSE, M, y + 4, bh * 0.45, bh * 0.45);
      badge.getFill().setSolidFill(k % 2 ? C2 : C1); badge.getBorder().setTransparent();
      badge.getText().setText(String(k + 1)).getTextStyle().setForegroundColor('#FFFFFF').setBold(true).setFontFamily(fontTitle).setFontSize(Math.max(10, Math.round(bh * 0.2)));
      badge.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      var x = M + bh * 0.55, w = W - x - M;
      addText(sl, it.titre || '', x, y, w, bh * 0.35, 18, 9, C1, fontTitle, true);
      addText(sl, it.texte || '', x, y + bh * 0.33, w, bh * 0.6, 13, 7, TX, fontBody, false);
    });
    pages = 1;
  }
  first.remove();
  deck.saveAndClose();

  var folder = formatFolder_(job.format_id, !ok);
  trashSameName_(folder, name);
  var pdf = folder.createFile(DriveApp.getFileById(pres.presentationId).getAs(MimeType.PDF).setName(name));
  // version modifiable rangée à part (n'est pas une sortie notée)
  var editable = DriveApp.getFileById(pres.presentationId);
  editable.moveTo(subFolder_(cfg.DRIVE_ROOT_ID, '05_Editables'));
  return { name: name, id: pdf.getId(), url: pdf.getUrl(), folder: folder.getName(), pages: pages };
}
