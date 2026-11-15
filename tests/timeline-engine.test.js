// Run: node tests/timeline-engine.test.js   (Node 16+, no dependencies)
// Checks the engine against the signed-off prototype (fixtures/timeline/Timeline.dc.html)
// and checks the layout rules that keep text from overlapping.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FT = require('../timeline-engine.js');
const load = (file) => { const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(file, 'utf8'), sb); return sb.window.FAMILY_DATA; };
const data = load(path.join(__dirname, 'fixtures/timeline/sample-uk.js'));
const NOW = 2026;
const M = FT.model(data, { now: NOW });
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };

// The prototype component, run headless with a stand-in for the design tool's base class.
const proto = (() => {
  const src = fs.readFileSync(path.join(__dirname, 'fixtures/timeline/Timeline.dc.html'), 'utf8');
  const code = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(u) { Object.assign(this.state, typeof u === 'function' ? u(this.state) : u); } }
  const C = new Function('DCLogic', code + '\nreturn Component;')(DCLogic);
  return (props) => new C(props || {});
})();
const P0 = proto();
const PM = P0.model();

/* ------------------------------------------------------------------ text helpers */
test('plural forms', () => {
  assert.strictEqual(FT.yrs(1), '1 рік'); assert.strictEqual(FT.yrs(2), '2 роки'); assert.strictEqual(FT.yrs(5), '5 років');
  assert.strictEqual(FT.yrs(11), '11 років'); assert.strictEqual(FT.yrs(21), '21 рік'); assert.strictEqual(FT.yrs(74), '74 роки');
  assert.strictEqual(FT.peopleCount(44), '44 людини'); assert.strictEqual(FT.peopleCount(12), '12 людей'); assert.strictEqual(FT.peopleCount(1), '1 людина');
});
test('genitive of given names', () => {
  const cases = { 'Ганна': 'Ганни', 'Федір': 'Федора', 'Софія': 'Софії', 'Григорій': 'Григорія', 'Ніна': 'Ніни', 'Петро': 'Петра', 'Іван': 'Івана',
    'Леся': 'Лесі', 'Ольга': 'Ольги', 'Яків': 'Якова', 'Ігор': 'Ігоря', 'Василь': 'Василя', 'Лука': 'Луки', 'Наташа': 'Наташі', 'Ілля': 'Іллі', 'Михайло': 'Михайла' };
  Object.entries(cases).forEach(([a, b]) => assert.strictEqual(FT.genitive(a), b, a));
  assert.strictEqual(FT.genitive('Любов', 'f'), 'Любові');
  assert.strictEqual(FT.genitive('Mykola'), null);
  assert.strictEqual(FT.genitive('ЛІДІЯ'), 'ЛІДІЇ'); assert.strictEqual(FT.genitive('ФЕДІР'), 'ФЕДОРА');
  assert.strictEqual(FT.genitive(''), null);
});
test('free-text dates and qualifiers', () => {
  const d = (s) => { const r = FT.parseDate(s); return r ? r.y + r.q : null; };
  assert.strictEqual(d('1871'), '1871'); assert.strictEqual(d('1989-01-17'), '1989');
  assert.strictEqual(d('бл. 1875'), '1875~'); assert.strictEqual(d('близько 1875'), '1875~'); assert.strictEqual(d('abt 1875'), '1875~'); assert.strictEqual(d('c. 1875'), '1875~');
  assert.strictEqual(d('до 1920'), '1920<'); assert.strictEqual(d('before 1920'), '1920<');
  assert.strictEqual(d('після 1920'), '1920>'); assert.strictEqual(d('1920?'), '1920~');
  assert.strictEqual(d(''), null); assert.strictEqual(d('невідомо'), null);
});

/* ------------------------------------------------------------------ parity with the prototype */
test('sample loads: 44 on the scale, 6 without dates', () => {
  assert.strictEqual(M.dated.length, 44); assert.strictEqual(M.undated.length, 6);
});
test('alive counts match the prototype for every year', () => {
  for (let y = 1860; y <= NOW; y++) { const a = FT.countAlive(M, y), b = P0.count(y); assert.deepStrictEqual([a.yes, a.maybe], [b.yes, b.maybe], 'year ' + y); }
  assert.strictEqual(FT.countText(M, 1944), 'живі: 12 · ще 1 — невідомо');
  assert.strictEqual(FT.countText(M, 1944, true), '1944 · живі: 12 · ще 1 — невідомо');
});
test('year labels and life lengths match the prototype', () => {
  M.ids.forEach((id) => { assert.strictEqual(FT.yearsLabel(M, id), P0.yLabel(PM.P[id]), id); assert.strictEqual(FT.lifeText(M, id), P0.lifeText(PM.P[id]), id); });
});
test('Гілки row order matches the prototype', () => {
  const c = proto({ variant: '2' }); const r = c.renderVals();
  const want = r.rows.filter((x) => x.pid).map((x) => x.pid);
  const got = FT.rowList(M, 'branch').map((x) => x.id);
  assert.deepStrictEqual(got, want);
  const depth = {}; FT.rowList(M, 'branch').forEach((x) => { depth[x.id] = x.depth; });
  assert.strictEqual(depth.k3, 0); assert.strictEqual(depth.u1, 1); assert.strictEqual(depth.k40, 5);
});
test('generations match the prototype', () => {
  M.dated.forEach((id) => assert.strictEqual(M.gen[id], PM.P[id].gen, id));
  const bands = FT.rowList(M, 'gen').filter((x) => x.type === 'band').map((x) => x.title + ' · ' + x.sub);
  assert.deepStrictEqual(bands, ['I покоління · нар. 1868–1875 · 3 людини', 'II покоління · нар. 1898–1905 · 5 людей', 'III покоління · нар. 1921–1931 · 8 людей',
    'IV покоління · нар. 1946–1960 · 13 людей', 'V покоління · нар. 1976–1995 · 11 людей', 'VI покоління · нар. 2004–2016 · 4 людини', 'Без відомих дат · 6 людей']);
});
test('relation words match the prototype for Василь (and say more where it said nothing)', () => {
  M.dated.forEach((id) => { const want = P0.relation(id, 'k9'); if (want) assert.strictEqual(FT.relation(M, id, 'k9'), want, id); });
  assert.strictEqual(FT.relation(M, 'u3', 'k9'), 'дідусь');           // the prototype only knew "батько Софії"
  assert.strictEqual(FT.relation(M, 'k5', 'k9'), 'тітка');
  assert.strictEqual(FT.relation(M, 'k12', 'k9'), 'двоюрідний брат');
  assert.strictEqual(FT.relation(M, 'k19', 'k17'), 'колишня дружина');
  assert.strictEqual(FT.relation(M, 'k34', 'k18'), 'усиновлена донька');
  assert.strictEqual(FT.relation(M, 'k11', 'k4'), 'невістка');
  assert.strictEqual(FT.relation(M, 'k4', 'k11'), 'свекор');
  assert.strictEqual(FT.relation(M, 'k39', 'k31'), 'партнер');
});
test('dateless rows are named from their anchor, as in the prototype', () => {
  const want = { u1: 'син Федора · без дат', u2: 'мати Ганни · без дат', u3: 'батько Софії · без дат', u4: 'батько Григорія · без дат', u5: 'мати Ніни · без дат', u6: 'дружина Федора · без дат' };
  Object.entries(want).forEach(([id, t]) => assert.strictEqual(FT.anchorText(M, id), t));
});
test('tooltip text matches the prototype', () => {
  const ctx = (hy) => ({ M: PM, hy: hy, G: { k: 4 } });
  [['k9', 1944], ['k6', 1944], ['k6', 1960], ['k3', 1930], ['k30', 1970], ['k4', 1944], ['k2', 1900]].forEach(([id, y]) => {
    const a = FT.tooltip(M, id, y), b = P0.tipVals(id, ctx(y), 0, 0, 800, 'right');
    assert.strictEqual(a.now, b.now, id + ' ' + y); assert.strictEqual(a.years, b.years, id);
    assert.deepStrictEqual(a.events.map((e) => e.year + ' ' + e.text), b.evs.map((e) => e.y + ' ' + e.t), id);
  });
});

/* ------------------------------------------------------------------ layout rules (no overlaps) */
const crossingX = (B, r) => B.conns.filter((c) => c.top < r.top + r.h - 2 && c.top + c.h > r.top + 2).map((c) => c.x);
const est = FT.estimate;
function checkLayout(B, width, label) {
  const today = B.axis.todayLineX;
  B.rows.forEach((r) => {
    if (r.label) {
      const w = est(r.label.text, 'label'), a = r.label.left ? r.label.x - w : r.label.x, z = a + w;
      crossingX(B, r).concat([today]).forEach((x) => assert.ok(!(x > a - 2 && x < z + 2), label + ': line through «' + r.label.text + '» on ' + r.name));
      assert.ok(a >= B.geo.L - 1, label + ': label left of the plot on ' + r.name);
    }
    if (r.pill) {
      crossingX(B, r).forEach((x) => assert.ok(!(x > r.pill.x - 2 && x < r.pill.x + r.pill.w + 2), label + ': line through pill on ' + r.name));
    }
    if (r.nameW != null) assert.ok(r.nameW >= 230, label + ': name column too narrow for ' + r.name);
  });
  const ax = B.axis, boxes = [[ax.badge.x - (est(ax.badge.text, 'badge') + 10) / 2, ax.badge.x + (est(ax.badge.text, 'badge') + 10) / 2]];
  if (ax.pill.x != null) { boxes.push([ax.pill.x, ax.pill.x + ax.pill.w]); assert.ok(ax.pill.x >= 8 && ax.pill.x + ax.pill.w <= width - 8 + 1, label + ': pill off the axis'); }
  if (ax.today.show) boxes.push([ax.today.x - est('сьогодні', 'today') / 2, ax.today.x + est('сьогодні', 'today') / 2]);
  ax.ticks.forEach((t) => { const hw = est(t.text, 'tick') / 2; boxes.forEach((b) => assert.ok(!(t.x - hw < b[1] + 3 && t.x + hw > b[0] - 3), label + ': tick ' + t.text + ' under a label')); });
}
test('no overlaps: both tabs, desktop and phone, every selection, many years', () => {
  let n = 0;
  ['branch', 'gen'].forEach((group) => [['desktop', 1040], ['desktop', 1440], ['phone', 390]].forEach(([device, width]) => {
    M.ids.forEach((sel) => [1868, 1900, 1944, 1986, 2005, 2016, 2026].forEach((year) => {
      const B = FT.build(M, { group, device, width, sel, year });
      checkLayout(B, width, group + '/' + device + '/' + width + '/' + sel + '/' + year); n++;
    }));
  }));
  assert.ok(n > 1000);
});
test('every person appears exactly once in each tab', () => {
  ['branch', 'gen'].forEach((group) => {
    const B = FT.build(M, { group, sel: 'k9', year: 1944 });
    const ids = B.rows.filter((r) => r.type === 'person').map((r) => r.id);
    assert.strictEqual(ids.length, 50, group); assert.strictEqual(new Set(ids).size, 50, group);
  });
});
test('axis: «сьогодні» never sits on 2020, the badge never sits on a decade', () => {
  const B = FT.build(M, { group: 'branch', sel: 'k9', year: 1900 });
  assert.ok(B.axis.today.show);
  assert.ok(!B.axis.ticks.some((t) => t.text === '2020'));
  assert.ok(B.axis.ticks.some((t) => t.text === '2010'));
  const C = FT.build(M, { group: 'branch', sel: 'k9', year: 2016 });
  assert.ok(C.axis.pill.x < C.axis.badge.x, 'pill flips left near the end');
  assert.ok(!C.axis.today.show, '«сьогодні» yields to the badge');
});
test('phone: no lines of descent; desktop Гілки has them; Покоління has none', () => {
  assert.strictEqual(FT.build(M, { group: 'branch', device: 'phone', sel: 'k9' }).conns.length, 0);
  assert.ok(FT.build(M, { group: 'branch', sel: 'k9' }).conns.length > 30);
  assert.strictEqual(FT.build(M, { group: 'gen', sel: 'k9' }).conns.length, 0);
});

/* ------------------------------------------------------------------ edge cases */
test('empty archive and all-dateless archives do not throw', () => {
  const E = FT.model({ people: {}, families: [] }, { now: NOW });
  const B = FT.build(E, { group: 'branch' }); assert.strictEqual(B.rows.length, 0);
  const U = FT.model({ people: { a: { id: 'a', given: 'Олена', sex: 'f', birth: { date: '' }, death: { date: '' } } }, families: [] }, { now: NOW });
  assert.strictEqual(FT.build(U, { group: 'gen' }).rows.length, 2);
});
test('unknown ends: very old and not marked deceased; "після"; death before birth', () => {
  const D = FT.model({ people: {
    a: { id: 'a', given: 'Яким', sex: 'm', birth: { date: '1890' }, death: { date: '' }, deceased: false },
    b: { id: 'b', given: 'Явдоха', sex: 'f', birth: { date: '1880' }, death: { date: 'після 1920' }, deceased: true },
    c: { id: 'c', given: 'Тит', sex: 'm', birth: { date: '1900' }, death: { date: '1890' }, deceased: true }
  }, families: [] }, { now: NOW });
  assert.ok(D.P.a.unknownEnd && !D.P.a.living);
  assert.strictEqual(FT.alive(D, 'b', 1920), 'yes'); assert.strictEqual(FT.alive(D, 'b', 1930), 'maybe');
  assert.strictEqual(D.P.c.dataError, 'death-before-birth');
});
test('the English sample of the shipped app still lays out (names not declined)', () => {
  const en = path.join(__dirname, '../family.js');
  if (!fs.existsSync(en)) return;
  const E = FT.model(load(en), { now: NOW });
  ['branch', 'gen'].forEach((group) => { const B = FT.build(E, { group, sel: E.rootId, year: 1950 }); assert.strictEqual(B.rows.filter((r) => r.type === 'person').length, E.ids.length); checkLayout(B, 1040, 'en/' + group); });
});

console.log('\n' + passed + ' passed');
