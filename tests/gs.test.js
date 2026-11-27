// Tests hors ligne des fonctions pures d'Apps Script (node --test tests/)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Text.gs'), 'utf8'), ctx);
const T = ctx.module.exports;

const SRT = `1
00:00:00,000 --> 00:00:04,000
Bienvenue à l'ESIEA.

2
00:00:04,000 --> 00:00:09,500
L'école forme des ingénieurs
3
00:00:09,500 --> 00:00:15,000
depuis 1958 sur deux campus.

4
00:00:15,000 --> 00:00:40,000
La cybersécurité et l'IA sont au cœur du programme.
`;

test('parseSrt / buildSrt aller-retour', () => {
  const cues = T.parseSrt_(SRT.replace('ingénieurs\n3', 'ingénieurs\n\n3'));
  assert.strictEqual(cues.length, 4);
  assert.strictEqual(cues[1].start, 4);
  assert.strictEqual(cues[1].end, 9.5);
  const again = T.parseSrt_(T.buildSrt_(cues));
  assert.deepStrictEqual(again.map(c => [c.start, c.end, c.text]), cues.map(c => [c.start, c.end, c.text]));
});

test('horloges', () => {
  assert.strictEqual(T.secToClock_(75), '01:15');
  assert.strictEqual(T.secToClock_(3725), '1:02:05');
  assert.strictEqual(T.clockToSec_('1:02:05'), 3725);
  assert.strictEqual(T.secToSrtTime_(9.5), '00:00:09,500');
});

test('extraits coupés en fin de phrase', () => {
  const cues = [];
  for (let i = 0; i < 30; i++) cues.push({ i: i + 1, start: i * 10, end: i * 10 + 10, text: i % 3 === 2 ? 'fin de phrase.' : 'suite de la phrase' });
  const ex = T.splitCuesIntoExtracts_(cues, 60);
  assert.ok(ex.length >= 3);
  ex.slice(0, -1).forEach(e => assert.ok(/\.$/.test(e.cues[e.cues.length - 1].text)));
});

test('diagnostic : trop court', () => {
  const d = T.diagnoseCues_(T.parseSrt_(SRT), 80);
  assert.strictEqual(d.ok, false);
  assert.match(d.issues.join(), /trop court/);
});

test('anonymisation', () => {
  const t = T.anonymize_('Je m\'appelle Julie Martin, écrivez à julie.martin@mail.com ou 06 12 34 56 78. Paul aussi.', 'Paul');
  assert.ok(!/Julie|julie|06 12|Paul/.test(t), t);
});

test('faits : chiffre inventé détecté, chiffre source accepté', () => {
  const src = 'L\'ESIEA forme des ingénieurs depuis 1958 sur deux campus. La cybersécurité est au programme.';
  assert.strictEqual(T.checkFacts_('Depuis 1958, l\'ESIEA forme des ingénieurs.', src, 'ESIEA').ok, true);
  const bad = T.checkFacts_('Depuis 1962, l\'ESIEA forme 4000 ingénieurs.', src, 'ESIEA');
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.invented.includes('1962') && bad.invented.includes('4000'));
  assert.strictEqual(T.checkFacts_('Il y a 2 campus.', src, '').ok, true, 'deux = 2');
});

test('faits : nom propre / sigle inventé détecté', () => {
  const src = 'L\'école propose une formation en cybersécurité.';
  const r = T.checkFacts_('La formation, labellisée par la CTI, est dirigée par Jean Dupont.', src, 'ESIEA');
  assert.strictEqual(r.ok, false);
  assert.ok(r.invented.includes('CTI'));
  assert.ok(r.invented.includes('Jean'));
});

test('faits : numérotation de thread et horodatages ignorés', () => {
  const r = T.checkFacts_('1/5 Le numérique change tout.\n\n2/5 Tout commence à 00:15.', 'le numérique change tout', '');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('rendu gabarit + contraintes items', () => {
  const data = { titre: 'T', contenu: '', items: [{ texte: 'a'.repeat(270) }, { texte: 'b' }] };
  const r = T.renderTemplate_('{{#items}}{{n}}/{{total}} {{texte}}\\n\\n{{/items}}', data, {});
  assert.ok(r.text.startsWith('1/2 aaa'));
  const c = T.checkConstraints_(r.text, data, { min_items: 2, max_items: 8, item_max_car: 272 }, { itemTexts: r.itemTexts });
  assert.strictEqual(c.ok, false);
  assert.match(c.errors.join(), /item 1/);
});

test('chapitres : 00:00 obligatoire, croissants, dans la source', () => {
  const f = { format_id: 'YT_CHAPITRES', min_items: 2 };
  const good = { items: [{ temps: '00:00', titre: 'Intro' }, { temps: '00:45', titre: 'Suite' }] };
  assert.strictEqual(T.checkConstraints_('x', good, f, { sourceStart: 0, sourceEnd: 100 }).ok, true);
  const bad = { items: [{ temps: '00:05', titre: 'Intro' }, { temps: '03:00', titre: 'Suite' }] };
  const r = T.checkConstraints_('x', bad, f, { sourceStart: 0, sourceEnd: 100 });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(), /00:00/);
  assert.match(r.errors.join(), /hors source/);
});

test('JSON robuste', () => {
  assert.deepStrictEqual({ ...T.parseJsonLoose_('```json\n{"a":1,}\n```') }, { a: 1 });
  assert.strictEqual(JSON.stringify(T.parseJsonLoose_('Voici : {"a":[1,2]} merci')), '{"a":[1,2]}');
  assert.throws(() => T.parseJsonLoose_('pas de json'));
});

test('consigne paramétrable', () => {
  assert.strictEqual(T.fillPrompt_('Ton {{ton}}, public {{public}}', { ton: 'drôle' }), 'Ton drôle, public non précisé');
});

test('taille de police décroît avec la longueur', () => {
  const a = T.fitFontSize_('court', 400, 100, 40, 10);
  const b = T.fitFontSize_('x'.repeat(600), 400, 100, 40, 10);
  assert.ok(a > b);
});

test('item vide détecté, texte rangé dans titre récupéré', () => {
  const tpl = '{{#items}}{{n}}/{{total}} {{texte}}\n\n{{/items}}';
  const empty = { items: [{ texte: '' }, { texte: '' }] };
  const r1 = T.renderTemplate_(tpl, empty, {});
  assert.match(T.checkConstraints_(r1.text, empty, {}, { itemTexts: r1.itemTexts }).errors.join(), /item 1 vide/);
  const inTitle = { items: [{ titre: 'Le numérique change tout.' }] };
  assert.match(T.renderTemplate_(tpl, inTitle, {}).text, /1\/1 Le numérique/);
});

test('accents français contrôlés', () => {
  assert.strictEqual(T.hasFrenchAccents_('L ESIEA est 1re ex aequo des ecoles d ingenieurs en informatique dans le classement 2026. Un engagement fort pour votre avenir et vos projets.'), false);
  assert.strictEqual(T.hasFrenchAccents_('L’ESIEA est 1re ex æquo des écoles d’ingénieurs en informatique dans le classement 2026. Un engagement fort pour votre avenir et vos projets.'), true);
});
