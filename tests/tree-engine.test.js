// Run: node tests/tree-engine.test.js   (Node 16+, no dependencies)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FE = require('../tree-engine.js');
const FM = require('../merge.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../family.js'), 'utf8'), sandbox);
const data = sandbox.window.FAMILY_DATA;
const clone = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };

function rowOverlaps(L, D) {
  const rows = {};
  Object.entries(L.nodes).forEach(([id, n]) => { (rows[n.row] = rows[n.row] || []).push([id, n.x]); });
  const bad = [];
  Object.values(rows).forEach((arr) => {
    arr.sort((a, b) => a[1] - b[1]);
    for (let i = 1; i < arr.length; i++) if (arr[i][1] - arr[i - 1][1] < D.cw + 8) bad.push(arr[i - 1][0] + '/' + arr[i][0]);
  });
  return bad;
}

test('sample data loads', () => {
  assert.strictEqual(Object.keys(data.people).length, 25);
  assert.strictEqual(data.families.length, 9);
  assert.strictEqual(data.meta.sample, true);
});

test('no two cards overlap, for every focus person and option set', () => {
  for (const dimsName of ['compact', 'expanded', 'poster']) {
    const D = FE.DIMS[dimsName];
    for (const id of Object.keys(data.people)) {
      for (const sibFamilies of [false, true]) {
        for (const g of [1, 2, 3, 4]) {
          const L = FE.layoutTree(data, id, D, { upGen: g, downGen: g, sibFamilies, ghosts: true });
          assert.deepStrictEqual(rowOverlaps(L, D), [], `${dimsName} focus=${id} sib=${sibFamilies} gen=${g}`);
          assert.ok(L.nodes[id], 'focus is drawn');
        }
      }
    }
  }
});

test('show everyone brings side branches (aunts, cousins, ancestors\' other marriages) without overlaps', () => {
  for (const dimsName of ['compact', 'expanded']) {
    const D = FE.DIMS[dimsName];
    for (const id of Object.keys(data.people)) {
      const opt = { upGen: 99, downGen: 99, sibFamilies: true, ghosts: true };
      const plain = FE.layoutTree(data, id, D, opt), all = FE.layoutTree(data, id, D, Object.assign({ collateral: true }, opt));
      assert.deepStrictEqual(rowOverlaps(all, D), [], `${dimsName} focus=${id}`);
      assert.ok(Object.keys(all.nodes).length >= Object.keys(plain.nodes).length, `never fewer: focus=${id}`);
    }
  }
  // from the youngest generation everyone in the sample is reachable
  const best = Math.max(...Object.keys(data.people).map((id) => Object.keys(FE.layoutTree(data, id, FE.DIMS.compact, { upGen: 99, downGen: 99, sibFamilies: true, collateral: true }).nodes).length));
  assert.strictEqual(best, Object.keys(data.people).length);
});

test('Taras view: remarriage, half/step siblings, ancestors, hidden counts', () => {
  const L = FE.layoutTree(data, 'p14', FE.DIMS.compact, { upGen: 3, downGen: 3, sibFamilies: false, ghosts: true });
  const row = (r) => Object.keys(L.nodes).filter((id) => L.nodes[id].row === r).sort((a, b) => L.nodes[a].x - L.nodes[b].x);
  assert.deepStrictEqual(row(-1), ['p11', 'p9', 'p10']);                 // Larysa — Viktor — Iryna
  assert.deepStrictEqual(row(0), ['p16', 'p17', 'p18', 'p14', 'p19', 'p15']);
  assert.deepStrictEqual(row(-2), ['p5', 'p6']);
  assert.deepStrictEqual(row(-3), ['p1', 'p2', 'p3', 'p4']);
  assert.deepStrictEqual(row(1), ['p22', 'p23']);
  assert.strictEqual(L.hidden.p15, 2);                                    // Oksana: Marco + Lia not drawn
  assert.strictEqual(L.hidden.p18, 1);                                    // Maksym: unknown parent
  assert.deepStrictEqual(L.labels.map((l) => l.text).sort(), ['1 · розл. 1986', '2 · шл. 1989', 'шл. 1926', 'шл. 1928', 'шл. 1952', 'шл. 2006'].sort());
  assert.deepStrictEqual(L.tags.map((t) => t.rel).sort(), ['adopted', 'step']);
  assert.deepStrictEqual(L.tags.map((t) => t.text).sort(), ['нерідні', 'усиновлення']);
  assert.ok(L.segs.some((g) => g.tone === 'hl'), 'focus lines highlighted');
});

test('two marriages without years are numbered; one is not labelled', () => {
  const d = clone(data);
  d.people.p30 = { id: 'p30', given: 'Ян', surname: 'Руда', sex: 'm', birth: {}, death: {}, deceased: false, photos: [] };
  d.families.push({ id: 'f30', a: 'p30', b: 'p13', type: 'married', start: '', end: '', kids: [] });
  const L = FE.layoutTree(d, 'p13', FE.DIMS.compact, { upGen: 1, downGen: 1, sibFamilies: false, ghosts: false });
  assert.deepStrictEqual(L.labels.map((l) => l.text).sort(), ['1 · шл. 1981', '2 · шлюб'].sort());
  const single = clone(data);
  single.families.find((f) => f.id === 'f8').start = '';
  const L2 = FE.layoutTree(single, 'p22', FE.DIMS.compact, { upGen: 1, downGen: 0, sibFamilies: false, ghosts: false });
  assert.ok(!L2.labels.some((l) => l.text === ''), 'no empty label pills');
});

test('an only child hangs straight below the couple; groups sit under their own parents', () => {
  const D = FE.DIMS.compact;
  const L = FE.layoutTree(data, 'p15', D, { upGen: 1, downGen: 1, sibFamilies: false, ghosts: false });
  const mid = (L.nodes.p15.x + L.nodes.p20.x + D.cw) / 2;            // Oksana — Marco
  assert.strictEqual(L.nodes.p24.x + D.cw / 2, mid);                   // Lia
  const V = FE.layoutTree(data, 'p9', D, { upGen: 1, downGen: 1, sibFamilies: false, ghosts: false });
  const kidsMid = (a, b) => (V.nodes[a].x + V.nodes[b].x + D.cw) / 2;
  const coupleMid = (a, b) => (Math.min(V.nodes[a].x, V.nodes[b].x) + Math.max(V.nodes[a].x, V.nodes[b].x) + D.cw) / 2;
  assert.strictEqual(kidsMid('p14', 'p15'), coupleMid('p9', 'p10'));  // Viktor + Iryna → Taras, Oksana
});

test('a child with a wide family of their own still sits under their parents (row contours)', () => {
  const pp = (id) => ({ id, given: id, surname: 'X', sex: 'u', birth: {}, death: {}, deceased: false, photos: [] });
  const d = { people: {}, families: [
    { id: 'f1', a: 'm', b: 'h1', type: 'married', start: '', end: '', kids: [{ id: 'a', ra: 'bio', rb: 'bio' }] },
    { id: 'f2', a: 'm', b: 'h2', type: 'married', start: '', end: '', kids: [{ id: 'b', ra: 'bio', rb: 'bio' }] },
    { id: 'f3', a: 'b', b: 'bp', type: 'married', start: '', end: '', kids: [{ id: 'c1', ra: 'bio', rb: 'bio' }, { id: 'c2', ra: 'bio', rb: 'bio' }] },
    { id: 'f4', a: 'c2', b: 'c2p', type: 'partner', start: '', end: '', kids: [] }
  ] };
  ['m', 'h1', 'h2', 'a', 'b', 'bp', 'c1', 'c2', 'c2p'].forEach((id) => { d.people[id] = pp(id); });
  const D = FE.DIMS.compact, L = FE.layoutTree(d, 'b', D, { upGen: 3, downGen: 3, sibFamilies: false, ghosts: false });
  const n = L.nodes, coupleMid = (x, y) => (Math.min(n[x].x, n[y].x) + Math.max(n[x].x, n[y].x) + D.cw) / 2;
  assert.strictEqual(n.b.x + D.cw / 2, coupleMid('m', 'h2'));
  assert.strictEqual(n.a.x + D.cw / 2, coupleMid('m', 'h1'));
  assert.deepStrictEqual(rowOverlaps(L, D), []);
});

test('person without parents gets an "add parent" ghost', () => {
  const L = FE.layoutTree(data, 'p1', FE.DIMS.compact, { upGen: 3, downGen: 3, sibFamilies: false, ghosts: true });
  assert.strictEqual(L.ghosts.length, 1);
  assert.strictEqual(L.ghosts[0].label, 'Додати батька чи матір');
});

test('primary parent family prefers biological', () => {
  assert.strictEqual(FE.primaryParentFam(data, 'p18').id, 'f6');
  assert.strictEqual(FE.primaryParentFam(data, 'p17').id, 'f5');
});

test('siblings are derived: full, half, step', () => {
  const s = FE.siblingsOf(data, 'p14').map((x) => x.id + ':' + x.kind + (x.adopted ? '+a' : ''));
  assert.deepStrictEqual(s, ['p15:full', 'p18:step', 'p16:half', 'p17:half+a']);
});

test('display helpers', () => {
  assert.strictEqual(FE.yearsOf(data.people.p6), '1931–2014');
  assert.strictEqual(FE.yearsOf(data.people.p7), '1933–?');
  assert.strictEqual(FE.yearsOf(data.people.p14), 'нар. 1979');
  assert.strictEqual(FE.yearsOf(data.people.p25), 'Дати невідомі');
  assert.strictEqual(FE.nameOf(data.people.p25), 'Невідомо');
  assert.strictEqual(FE.fmtDate('1931-03-12'), '12 березня 1931');
  assert.strictEqual(FE.fmtDate('abt 1930'), 'бл. 1930');
  assert.strictEqual(FE.fmtDate('бл. 1930'), 'бл. 1930');
  assert.strictEqual(FE.fmtDate('1931-03'), 'березень 1931');
  assert.strictEqual(FE.fmtDate('весна 1944'), 'весна 1944');
  assert.deepStrictEqual(FE.splitName('Олена', 'Коваленко'), { given: 'Олена', surname: 'Коваленко' });
  assert.deepStrictEqual(FE.splitName('Анна Марія Савченко', 'Коваленко'), { given: 'Анна Марія', surname: 'Савченко' });
});

test('mutations: detach, remove', () => {
  let d = clone(data);
  FE.detachPartner(d, 'f8', 'p19', true);
  assert.strictEqual(d.families.find((f) => f.id === 'f8').type, 'none');
  d = clone(data);
  FE.detachPartner(d, 'f8', 'p19', false);
  assert.strictEqual(d.families.find((f) => f.id === 'f8').b, null);
  d = clone(data);
  FE.detachParentLink(d, 'f4', 'p15', 'p9');                             // Oksana keeps Iryna only
  assert.ok(d.families.some((f) => f.a === 'p10' && !f.b && f.kids.some((k) => k.id === 'p15')));
  d = clone(data);
  FE.removePerson(d, 'p9');
  assert.ok(!d.people.p9);
  assert.ok(d.families.every((f) => f.a !== 'p9' && f.b !== 'p9'));
});

test('names sort in Ukrainian alphabetical order', () => {
  const ppl = ['Євген', 'Ігор', 'Юрій', 'Ґанна', 'Іван', 'Яків', 'Їжак'].map((g) => ({ given: g, surname: 'Х' }));
  assert.deepStrictEqual(ppl.sort(FE.byName).map((p) => p.given), ['Ґанна', 'Євген', 'Іван', 'Ігор', 'Їжак', 'Юрій', 'Яків']);
  const mixed = [{ given: '', surname: '' }, { given: 'Олег', surname: '' }, { given: 'Ян', surname: 'Бондар' }];
  assert.deepStrictEqual(mixed.sort(FE.byName).map((p) => p.given), ['Ян', 'Олег', '']);
});

test('tidyFamilies drops a child listed under a parent alone when the couple has them', () => {
  const d = { people: { m: {}, a: {}, b: {}, c: {} }, families: [
    { id: 'f1', a: 'm', b: null, type: 'none', kids: [{ id: 'c', ra: 'bio', rb: 'bio' }, { id: 'b', ra: 'bio', rb: 'bio' }] },
    { id: 'f2', a: 'm', b: null, type: 'married', kids: [{ id: 'c', ra: 'bio', rb: 'bio' }] },
    { id: 'f3', a: 'm', b: 'a', type: 'married', kids: [{ id: 'c', ra: 'bio', rb: 'bio' }] }
  ] };
  FE.tidyFamilies(d);
  assert.deepStrictEqual(d.families.map((f) => f.id + ':' + f.kids.map((k) => k.id).join(',')), ['f1:b', 'f3:c']);
  assert.strictEqual(d.families[0].type, 'none');
  const sample = clone(data), before = JSON.stringify(sample);
  FE.tidyFamilies(sample);
  assert.strictEqual(JSON.stringify(sample), before, 'the sample family is already tidy');
});

test('dates: full dates in either order, checks for impossible ones', () => {
  assert.strictEqual(FE.fmtDate('17.02.1949'), '17 лютого 1949');
  assert.strictEqual(FE.fmtDate('1949-02-17'), '17 лютого 1949');
  assert.strictEqual(FE.fmtDate('03.1931'), 'березень 1931');
  assert.strictEqual(FE.fmtDate('31.02.1931'), '31.02.1931');
  assert.strictEqual(FE.ageBetween('17.02.1949', '16.02.2019'), 69);
  const norm = (v) => FE.normDate(v);
  assert.deepStrictEqual(['12031931', '1231931', '131931', '031931', '31931', '12 3 1931', '12 березня 1931', '1930?'].map(norm),
    ['12.03.1931', '12.03.1931', '01.03.1931', '03.1931', '03.1931', '12.03.1931', '12.03.1931', 'бл. 1930']);
  assert.deepStrictEqual(FE.readDate('1121931').ambiguous, ['11.02.1931', '01.12.1931']);
  assert.match(FE.dateProblem({ birth: { date: '1121931' }, death: {} }), /Неоднозначна дата 1121931: це 11.02.1931 чи 01.12.1931/);
  const p = (b, dd) => ({ birth: { date: b }, death: { date: dd }, deceased: !!dd });
  assert.ok(FE.dateProblem(p('17.02.2022', '17.03.1970')).startsWith('Дата смерті'));
  // a death date left behind after unticking "Помер(ла)" doesn't count
  assert.strictEqual(FE.dateProblem({ birth: { date: '17.02.2022' }, death: { date: '17.03.1970' }, deceased: false }), '');
  assert.strictEqual(FE.dateProblem(p('1931', '05.1931')), '', 'same year, unknown month: fine');
  assert.ok(FE.dateProblem(p('31.02.1931', '')).startsWith('Такої дати'));
  assert.ok(FE.searchText({ given: 'Олександр', nick: 'Дід Саша' }).includes('саша'));
});

test("a partner's other family is drawn beside them", () => {
  // n has partners v1 (left) and v2 (right); v1 also has an earlier wife w with a daughter g
  const per = (sex) => ({ sex, birth: {}, death: {} });
  const d = { people: { n: per('f'), v1: per('m'), v2: per('m'), w: per('f'), g: per('f'), k: per('f') }, families: [
    { id: 'f1', a: 'n', b: 'v1', type: 'divorced', start: '1966', kids: [{ id: 'k', ra: 'bio', rb: 'bio' }] },
    { id: 'f2', a: 'n', b: 'v2', type: 'married', start: '1970', kids: [] },
    { id: 'f3', a: 'v1', b: 'w', type: 'married', start: '1970', kids: [{ id: 'g', ra: 'bio', rb: 'bio' }] }
  ] };
  const L = FE.layoutTree(d, 'n', FE.DIMS.compact, { upGen: 3, downGen: 3, sibFamilies: false, ghosts: false });
  assert.ok(L.nodes.w && L.nodes.g, 'w and g are drawn');
  const xs = ['w', 'v1', 'n', 'v2'].map((id) => L.nodes[id].x);
  assert.deepStrictEqual(xs.slice().sort((a, b) => a - b), xs, 'order: w, v1, n, v2');
  assert.ok(L.nodes.g.x < L.nodes.k.x, "w's daughter sits left of n's");
});

test('kinship names people from the home person', () => {
  // h's parents f + m; f's parents gf + gm; f's sister a (married to u) with daughter c;
  // h's wife w with father wf; h's son s with wife sw; m's second husband st with son hb
  const per = (sex, by) => ({ sex, birth: { date: by || '' }, death: {} });
  const d = { rootId: 'h', people: { h: per('m'), f: per('m'), m: per('f'), gf: per('m'), gm: per('f'), a: per('f'), u: per('m'), c: per('f'), w: per('f'), wf: per('m'), s: per('m'), sw: per('f'), st: per('m'), hb: per('m') }, families: [
    { id: 'f1', a: 'f', b: 'm', type: 'divorced', kids: [{ id: 'h', ra: 'bio', rb: 'bio' }] },
    { id: 'f2', a: 'gf', b: 'gm', type: 'married', kids: [{ id: 'f', ra: 'bio', rb: 'bio' }, { id: 'a', ra: 'bio', rb: 'bio' }] },
    { id: 'f3', a: 'u', b: 'a', type: 'married', kids: [{ id: 'c', ra: 'bio', rb: 'bio' }] },
    { id: 'f4', a: 'h', b: 'w', type: 'married', kids: [{ id: 's', ra: 'bio', rb: 'bio' }] },
    { id: 'f5', a: 'wf', b: null, type: 'none', kids: [{ id: 'w', ra: 'bio', rb: 'bio' }] },
    { id: 'f6', a: 's', b: 'sw', type: 'married', kids: [] },
    { id: 'f7', a: 'st', b: 'm', type: 'married', kids: [{ id: 'hb', ra: 'bio', rb: 'bio' }] }
  ] };
  const k = (id) => FE.kinship(d, 'h', id);
  assert.strictEqual(k('h'), '');
  assert.strictEqual(k('f'), 'Ваш батько');
  assert.strictEqual(k('gm'), 'Ваша бабуся по батькові');
  assert.strictEqual(k('a'), 'Ваша тітка по батькові');
  assert.strictEqual(k('u'), 'Ваш дядько по батькові');
  assert.strictEqual(k('c'), 'Ваша двоюрідна сестра по батькові');
  assert.strictEqual(k('w'), 'Ваша дружина');
  assert.strictEqual(k('wf'), 'Ваш тесть');
  assert.strictEqual(k('sw'), 'Ваша невістка');
  assert.strictEqual(k('st'), 'Ваш вітчим');
  assert.strictEqual(k('hb'), 'Ваш єдиноутробний брат (спільна мати)');
});

test('checkTree finds impossible and unlikely dates, duplicates and loose people', () => {
  const per = (sex, given, b, dd) => ({ id: given, given, surname: 'Х', sex, birth: { date: b || '' }, death: { date: dd || '' }, deceased: !!dd });
  const d = { rootId: 'Мати', people: {}, families: [] };
  [per('f', 'Мати', '1950', '01.02.1980'), per('m', 'Батько', '1948', '10.01.1990'), per('m', 'Син', '1945'), per('f', 'Донька', '05.06.1982'), per('m', 'Пізній', '1991'), per('f', 'Окрема', '1960')]
    .forEach((p) => { d.people[p.id] = p; });
  d.families.push({ id: 'f1', a: 'Батько', b: 'Мати', type: 'married', start: '1940', end: '', kids: ['Син', 'Донька', 'Пізній'].map((id) => ({ id, ra: 'bio', rb: 'bio' })) });
  const c = FE.checkTree(d), txt = (id) => (c[id] || []).map((x) => x.level + ': ' + x.text).join(' | ');
  assert.match(txt('Син'), /error: Народився раніше за батька/);
  assert.match(txt('Донька'), /error: Народилася після смерті матері/);
  assert.match(txt('Пізній'), /більш ніж через 10 місяців після смерті батька/);
  assert.match(txt('Мати'), /error: Батько Х і Мати Х: стосунки почалися 1940 року, ще до того, як народилася Мати Х \(1950\)/);
  assert.match(txt('Окрема'), /Не пов’язана з головною особою/);
  d.people['Двійник'] = Object.assign(per('f', 'Окрема', '1960'), { id: 'Двійник' });
  assert.match(FE.checkTree(d)['Двійник'].map((x) => x.text).join(' | '), /Можливо, це та сама людина, що й Окрема Х/);
  assert.deepStrictEqual(FE.checkTree(data), {}, 'the sample family has no problems');
});

test('markdown subset never produces HTML', () => {
  const b = FE.parseMd('Hi **bold** and *it*\n\n## Work\n- a\n- b _c_');
  assert.deepStrictEqual(b.map((x) => (x.isP ? 'p' : x.isH ? 'h' : 'ul')), ['p', 'h', 'ul']);
  assert.deepStrictEqual(b[0].spans.map((s) => s.cls), ['', 'is-b', '', 'is-i']);
  assert.strictEqual(b[2].items.length, 2);
});

test('approximate years keep their mark, search folds apostrophes, lines up and down', () => {
  const p = (b, dd) => ({ birth: { date: b }, death: { date: dd || '' }, deceased: !!dd, sex: 'u' });
  assert.strictEqual(FE.yearsOf(p('бл. 1930')), 'нар. бл. 1930');
  assert.strictEqual(FE.yearsOf(p('1930?', '1990')), '~1930–1990');
  assert.strictEqual(FE.fold(" Мар'яна "), FE.fold('Мар’яна'));
  assert.ok(FE.searchText({ given: 'Марʼяна', surname: 'Коваль', birth: {} }).includes(FE.fold("мар'яна")));
  assert.ok(FE.matches({ given: 'Олена', surname: 'Коваленко', birth: {} }, 'коваленко  олена'));
  const d = { people: { a: {}, b: {}, c: {} }, families: [{ id: 'f1', a: 'a', b: null, kids: [{ id: 'b' }] }, { id: 'f2', a: 'b', b: null, kids: [{ id: 'c' }] }] };
  assert.deepStrictEqual(Object.keys(FE.lineOf(d, 'c', true)).sort(), ['a', 'b']);
  assert.deepStrictEqual(Object.keys(FE.lineOf(d, 'a', false)).sort(), ['b', 'c']);
});

test('kinship: one recorded parent is not half-blood; step links are not blood', () => {
  const per = (id, sex) => ({ id, given: id, surname: '', sex, birth: { date: '' }, death: { date: '' } });
  const d = { rootId: 'h', people: {}, families: [] };
  ['h:m', 'b:m', 'm:f', 'x:m', 's:m', 'sp:m', 'k:f', 'w:f'].forEach((t) => { const [id, sex] = t.split(':'); d.people[id] = per(id, sex); });
  d.families.push({ id: 'f1', a: 'm', b: null, type: 'none', kids: [{ id: 'h', ra: 'bio', rb: 'bio' }, { id: 'b', ra: 'bio', rb: 'bio' }] });
  assert.strictEqual(FE.kinship(d, 'h', 'b'), 'Ваш брат');
  // a step-father's father is no grandfather; the wife's son from before is a stepson
  d.families.push({ id: 'f2', a: 'sp', b: 'm', type: 'married', kids: [{ id: 'h', ra: 'step', rb: 'bio' }] });
  d.families.push({ id: 'f3', a: 'x', b: null, type: 'none', kids: [{ id: 'sp', ra: 'bio', rb: 'bio' }] });
  assert.notStrictEqual(FE.kinship(d, 'h', 'x'), 'Ваш дід');
  assert.strictEqual(FE.kinship(d, 'h', 'sp'), 'Ваш вітчим');
  d.families.push({ id: 'f4', a: 'h', b: 'w', type: 'married', kids: [{ id: 's', ra: 'step', rb: 'bio' }] });
  assert.strictEqual(FE.kinship(d, 'h', 's'), 'Ваш пасинок');
});

test('loops, lone-parent families, empty couples, notes formatting, date qualifiers', () => {
  const kid = (id) => ({ id, ra: 'bio', rb: 'bio' });
  // a loop through two families, and someone listed as their own child
  assert.strictEqual(FE.hasLoop({ families: [{ a: 'A', b: 'B', kids: [kid('C')] }, { a: 'C', b: null, kids: [kid('A')] }] }), true);
  assert.strictEqual(FE.hasLoop({ families: [{ a: 'A', b: 'B', kids: [kid('B')] }] }), true);
  assert.strictEqual(FE.hasLoop({ families: [{ a: 'A', b: 'B', kids: [kid('C')] }, { a: 'C', b: 'D', kids: [kid('E')] }] }), false);
  // two families for one lone parent become one; a childless "спільні діти" couple goes
  const d = { people: {}, families: [
    { id: 'f1', a: 'M', b: null, type: 'none', kids: [kid('X')] },
    { id: 'f2', a: 'M', b: null, type: 'none', kids: [kid('Y'), kid('X')] },
    { id: 'f3', a: 'P', b: 'Q', type: 'none', kids: [] },
    { id: 'f4', a: 'P', b: 'R', type: 'married', kids: [] }] };
  FE.tidyFamilies(d);
  assert.deepStrictEqual(d.families.map((f) => f.id + ':' + f.kids.map((k) => k.id).join('')), ['f1:XY', 'f4:']);
  // notes keep line breaks inside a paragraph; __x__ is bold too
  const md = FE.parseMd('Рядок 1\nРядок 2 __жирне__');
  assert.strictEqual(md.length, 1);
  assert.strictEqual(md[0].spans.map((x) => x.t).join(''), 'Рядок 1\nРядок 2 жирне');
  assert.ok(md[0].spans.some((x) => x.cls === 'is-b' && x.t === 'жирне'));
  // cards say what a free-text date says
  const p = (b) => ({ birth: { date: b }, death: { date: '' }, sex: 'u' });
  assert.deepStrictEqual(['після 1950', 'до 1930', 'між 1930 і 1935', 'весна 1945'].map((x) => FE.yearsOf(p(x))),
    ['нар. після 1950', 'нар. до 1930', 'нар. 1930–1935', 'нар. бл. 1945']);
});

test('merge: matching people, filled-in fields, conflicts, photos and families', () => {
  const ours = clone(data);
  const P = (id, given, surname, sex, b, extra) => Object.assign({ id, given, surname, birthName: '', nick: '', sex, birth: { date: b || '', place: '' }, death: { date: '', place: '' }, deceased: false, photo: null, photos: [], notes: '' }, extra || {});
  // a relative's tree: Юлія's family, with Тарас and their children seen from her side
  const theirs = { title: 'Ткаченки', rootId: 'y', meta: {}, people: {
    y: P('y', 'Юлія', 'Ткаченко', 'f', '1981'),
    t: P('t', 'Тарас', 'Коваленко', 'm', '1979', { birth: { date: '1979', place: 'м. Київ, Україна' }, notes: 'Записала Юлія' }),
    o: P('o', 'Остап', 'Коваленко', 'm', '2008', { photos: [{ id: 'x', src: 'data:image/png;base64,AAAA', caption: 'Перший клас' }], photo: 'data:image/png;base64,AAAA' }),
    z: P('z', 'Злата', 'Коваленко', 'f', '12.05.2012'),
    i: P('i', 'Іван', 'Ткаченко', 'm', '1955'),
    l: P('l', 'Ольга', 'Ткаченко', 'f', '1957'),
    k: P('k', 'Катерина', 'Ткаченко', 'f', '1985') },
    families: [
      { id: 'a1', a: 'i', b: 'l', type: 'married', start: '', end: '', kids: [{ id: 'y', ra: 'bio', rb: 'bio' }, { id: 'k', ra: 'bio', rb: 'bio' }] },
      { id: 'a2', a: 't', b: 'y', type: 'married', start: '2006', end: '', kids: [{ id: 'o', ra: 'bio', rb: 'bio' }, { id: 'z', ra: 'bio', rb: 'bio' }] }] };
  const sug = FM.suggest(ours, theirs);
  const pairs = {}; sug.forEach((m) => { pairs[m.theirs] = m.ours; });
  assert.deepStrictEqual(pairs, { t: 'p14', y: 'p19', o: 'p22', z: 'p23' }, 'the four shared people, nobody else');
  assert.ok(sug.find((m) => m.theirs === 'y').reasons.some((r) => /спільні/.test(r)), 'Юлія is matched through her husband and children');
  const pl = FM.plan(ours, theirs, pairs);
  const it = (k) => pl.items.find((x) => x.key === k);
  assert.strictEqual(pl.newPeople.length, 3, 'her parents and sister are new');
  assert.strictEqual(it('p:p14:birth.place').auto, 'theirs', 'the fuller place');
  assert.strictEqual(it('p:p14:birth.date').auto, 'ours', 'our date is more exact');
  assert.strictEqual(it('p:p23:birth.date').auto, 'theirs', 'their date is more exact');
  assert.strictEqual(it('p:p19:surname').auto, 'ours', 'married name stays');
  assert.deepStrictEqual([it('p:p19:birthName').a, it('p:p19:birthName').b, it('p:p19:birthName').auto], ['Савченко', 'Ткаченко', null], 'two different maiden names: the user decides');
  assert.strictEqual(it('p:p14:notes').auto, 'theirs', 'empty notes filled in');
  const merged = FM.apply(ours, theirs, pl, {});
  FE.tidyFamilies(merged);
  assert.strictEqual(Object.keys(merged.people).length, 28);
  assert.strictEqual(merged.people.p19.birthName, 'Савченко', 'ours unless chosen');
  assert.strictEqual(merged.people.p23.birth.date, '12.05.2012');
  assert.strictEqual(merged.people.p22.photos.length, ours.people.p22.photos.length + 1, 'their photo is added, ours stay');
  // Юлія now has parents and a sister; the couple's family is not duplicated
  assert.strictEqual(FE.parentFams(merged, 'p19').length, 1);
  assert.strictEqual(merged.families.filter((f) => [f.a, f.b].includes('p14') && [f.a, f.b].includes('p19')).length, 1);
  assert.strictEqual(FE.siblingsOf(merged, 'p19').length, 1);
  assert.strictEqual(FE.hasLoop(merged), false);
  assert.ok(!Object.keys(merged.people).some((id) => !ours.people[id] && ['p14', 'p19', 'p22', 'p23'].includes(id)));
  // a real disagreement waits for a choice; the choice decides
  theirs.people.t.birth.date = '1978';
  const pl2 = FM.plan(ours, theirs, pairs);
  assert.strictEqual(pl2.items.find((x) => x.key === 'p:p14:birth.date').auto, null);
  assert.strictEqual(FM.apply(ours, theirs, pl2, { 'p:p14:birth.date': 'theirs' }).people.p14.birth.date, '1978');
  assert.strictEqual(FM.apply(ours, theirs, pl2, {}).people.p14.birth.date, ours.people.p14.birth.date, 'ours unless chosen');
  // a tree with nobody in common: nothing to merge
  const stranger = { people: { s: P('s', 'Олег', 'Іншенко', 'm', '1970') }, families: [] };
  assert.deepStrictEqual(FM.suggest(ours, stranger), []);
  // the same given name but other dates or sex is not a match
  assert.deepStrictEqual(FM.suggest(ours, { people: { s: P('s', 'Тарас', 'Коваленко', 'm', '1950') }, families: [] }), []);
});

console.log(`\n${passed} tests passed`);
