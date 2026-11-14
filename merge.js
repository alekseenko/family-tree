/*
 * Family Archive — merging another tree into this one
 * Pure functions, like tree-engine.js: no DOM, no storage.
 *
 *   FamilyMerge.suggest(ours, theirs)        → [{ ours, theirs, score, sure, reasons }]  who is probably the same person
 *   FamilyMerge.plan(ours, theirs, pairs)    → what a merge would do: new people, filled-in fields, conflicts,
 *                                              families and photos; pairs is { theirsId: oursId }
 *   FamilyMerge.apply(ours, theirs, plan, choices) → the merged tree (a new object; ours is left as it was)
 *
 * Every difference in the plan is an item { key, who, label, a, b, auto, why, both }:
 * a is our value, b theirs; auto is 'ours' | 'theirs' when it was settled without asking (and why),
 * null when the user has to choose. choices[key] overrides either.
 *
 * In the browser: <script src="merge.js"></script> after tree-engine.js → window.FamilyMerge
 * In Node (tests): const FM = require('./merge.js')
 */
(function (root) {
  'use strict';
  var FE = root.FamilyEngine || (typeof require !== 'undefined' ? require('./tree-engine.js') : null);

  var fold = function (v) { return FE.fold(v || ''); };
  var year = function (v) { var r = FE.readDate(v); return r && r.y && !r.bad ? r : null; };
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };

  /* ---------------------------------------------------------------- who is the same person */
  // Name and dates first; then each pair already likely makes their parents, partners and children
  // with matching names likelier too, so a whole family lines up from one or two people.
  function baseScore(p, q) {
    var s = 0, why = [];
    var pg = fold(p.given), qg = fold(q.given), ps = fold(p.surname), qs = fold(q.surname);
    var pb = fold(p.birthName), qb = fold(q.birthName);
    if (!pg || !qg || pg !== qg) {
      // "Олена" and "Олена Петрівна": the first given name is enough
      if (pg && qg && pg.split(' ')[0] === qg.split(' ')[0]) { s += 25; why.push('те саме ім’я'); } else return null;
    } else { s += 30; why.push('те саме ім’я'); }
    if (ps && ps === qs) { s += 25; why.push('те саме прізвище'); }
    else if ((pb && (pb === qs || pb === qb)) || (qb && qb === ps)) { s += 20; why.push('прізвище при народженні'); }
    else if (ps && qs) s -= 10;
    if (p.sex !== 'u' && q.sex !== 'u' && p.sex !== q.sex) return null;
    var by = year(p.birth.date), qy = year(q.birth.date);
    if (by && qy) {
      var gap = Math.abs(by.y - qy.y), rough = by.approx || by.free || qy.approx || qy.free;
      if (!gap) { s += 30; why.push('той самий рік народження'); if (FE.normDate(p.birth.date) === FE.normDate(q.birth.date) && by.d) { s += 10; why[why.length - 1] = 'та сама дата народження'; } }
      else if (gap <= (rough ? 5 : 1)) { s += 12; why.push('близький рік народження'); }
      else return null;
    }
    var dy = p.deceased && year(p.death.date), ey = q.deceased && year(q.death.date);
    if (dy && ey) { if (dy.y === ey.y) { s += 10; why.push('той самий рік смерті'); } else if (Math.abs(dy.y - ey.y) > 2) return null; }
    if (fold(p.birth.place) && fold(p.birth.place) === fold(q.birth.place)) { s += 8; why.push('те саме місце народження'); }
    return { score: s, why: why };
  }
  function kin(d, id) {
    var out = [];
    FE.parentFams(d, id).forEach(function (f) { [f.a, f.b].forEach(function (x) { if (x) out.push({ id: x, as: 'батьки' }); }); });
    FE.famsOf(d, id).forEach(function (f) {
      var o = FE.other(f, id); if (o) out.push({ id: o, as: 'партнери' });
      f.kids.forEach(function (k) { out.push({ id: k.id, as: 'діти' }); });
    });
    return out;
  }
  function suggest(ours, theirs) {
    var cand = [];
    Object.keys(theirs.people).forEach(function (t) {
      Object.keys(ours.people).forEach(function (o) {
        var b = baseScore(ours.people[o], theirs.people[t]);
        if (b) cand.push({ ours: o, theirs: t, base: b.score, why: b.why });
      });
    });
    // three rounds: a pair that is already likely lends weight to its relatives
    var chosen = [];
    for (var round = 0; round < 3; round++) {
      var byT = {}; chosen.forEach(function (c) { byT[c.theirs] = c.ours; });
      cand.forEach(function (c) {
        var bonus = 0, rel = {};
        var ok = kin(ours, c.ours), tk = kin(theirs, c.theirs);
        tk.forEach(function (x) { var m = byT[x.id]; if (m && ok.some(function (y) { return y.id === m && y.as === x.as; })) { bonus += 25; rel[x.as] = 1; } });
        c.score = c.base + Math.min(bonus, 50);
        c.reasons = c.why.concat(Object.keys(rel).map(function (r) { return 'спільні ' + r; }));
      });
      // one-to-one, best first
      chosen = []; var usedO = {}, usedT = {};
      cand.slice().sort(function (x, y) { return y.score - x.score; }).forEach(function (c) {
        if (c.score < 55 || usedO[c.ours] || usedT[c.theirs]) return;
        usedO[c.ours] = usedT[c.theirs] = true;
        chosen.push(c);
      });
    }
    return chosen.map(function (c) { return { ours: c.ours, theirs: c.theirs, score: c.score, sure: c.score >= 80, reasons: c.reasons }; });
  }

  /* ---------------------------------------------------------------- what merging would do */
  var PERSON_FIELDS = [
    ['given', 'Ім’я'], ['surname', 'Прізвище'], ['birthName', 'Прізвище при народженні'], ['nick', 'Прізвисько'],
    ['sex', 'Стать'], ['birth.date', 'Дата народження'], ['birth.place', 'Місце народження'],
    ['deceased', 'Помер(ла)'], ['death.date', 'Дата смерті'], ['death.place', 'Місце смерті'], ['notes', 'Нотатки']
  ];
  var get = function (p, path) { var k = path.split('.'); return k.length > 1 ? (p[k[0]] || {})[k[1]] : p[k[0]]; };
  var set = function (p, path, v) { var k = path.split('.'); if (k.length > 1) p[k[0]][k[1]] = v; else p[k[0]] = v; };
  var SEX = { m: 'чоловіча', f: 'жіноча', u: 'не вказано' };

  // { auto: 'ours'|'theirs'|'same'|null, why }
  function compare(field, a, b, p, q) {
    if (field === 'sex') {
      if (a === b) return { auto: 'same' };
      if (a === 'u') return { auto: 'theirs', why: 'у нас стать не вказано' };
      if (b === 'u') return { auto: 'ours', why: 'у них стать не вказано' };
      return { auto: null };
    }
    if (field === 'deceased') {
      if (!!a === !!b) return { auto: 'same' };
      return { auto: a ? 'ours' : 'theirs', why: 'одне з дерев знає, що людина померла' };
    }
    var sa = a == null ? '' : String(a).trim(), sb = b == null ? '' : String(b).trim();
    if (/date$/.test(field)) {
      if (FE.normDate(sa) === FE.normDate(sb)) return { auto: 'same' };
    } else if (fold(sa) === fold(sb)) return { auto: 'same' };
    if (!sb) return { auto: 'same' };
    if (!sa) return { auto: 'theirs', why: 'у нас порожньо' };
    if (/date$/.test(field)) {
      // the same year, one of them more exact: 1931 → 12.03.1931
      var x = FE.readDate(sa), y = FE.readDate(sb);
      if (x && y && x.y && x.y === y.y && !x.bad && !y.bad) {
        var px = (x.d ? 2 : 0) + (x.m ? 1 : 0) - (x.approx || x.free ? 1 : 0), py = (y.d ? 2 : 0) + (y.m ? 1 : 0) - (y.approx || y.free ? 1 : 0);
        var fits = (!x.m || !y.m || x.m === y.m) && (!x.d || !y.d || x.d === y.d);
        if (fits && px !== py) return px > py ? { auto: 'ours', why: 'наша дата точніша' } : { auto: 'theirs', why: 'їхня дата точніша' };
      }
      return { auto: null };
    }
    if (/place$/.test(field)) {
      // "Київ" and "Україна, Київ": the fuller one
      var fa = fold(sa), fb = fold(sb);
      if (fb.indexOf(fa) >= 0) return { auto: 'theirs', why: 'їхнє місце повніше' };
      if (fa.indexOf(fb) >= 0) return { auto: 'ours', why: 'наше місце повніше' };
      return { auto: null };
    }
    if (field === 'notes') return { auto: null, both: true };
    return { auto: null };
  }

  // Married name in one tree, maiden name in the other? A surname shared with a husband there is the
  // married one; a surname shared with a parent there is the one she was born with.
  var husbands = function (d, p) { return FE.famsOf(d, p.id).map(function (f) { return d.people[FE.other(f, p.id)]; }).filter(Boolean); };
  var parents = function (d, p) { var out = []; FE.parentFams(d, p.id).forEach(function (f) { [f.a, f.b].forEach(function (x) { if (x && d.people[x]) out.push(d.people[x]); }); }); return out; };
  var shares = function (list, sur) { return list.some(function (x) { return fold(x.surname) === sur || fold(x.birthName) === sur; }); };
  function maiden(ours, theirs, p, q) {
    var a = fold(p.surname), b = fold(q.surname);
    if (!a || !b || a === b) return null;
    if (shares(husbands(ours, p), a) && shares(parents(theirs, q), b)) return { keep: 'ours', born: q.surname };
    if (shares(parents(ours, p), a) && shares(husbands(theirs, q), b)) return { keep: 'theirs', born: p.surname };
    if (fold(q.surname) === fold(p.birthName) || fold(p.surname) === fold(q.birthName)) return { keep: 'ours', born: null };
    return null;
  }
  function plan(ours, theirs, pairs) {
    var map = {}, items = [], newPeople = [], photos = [], fams = [], used = {};
    Object.keys(ours.people).forEach(function (id) { used[id] = 1; });
    var n = 1;
    var fresh = function (prefix) { while (used[prefix + n]) n++; used[prefix + n] = 1; return prefix + n; };
    Object.keys(theirs.people).forEach(function (t) {
      if (pairs[t] && ours.people[pairs[t]]) map[t] = pairs[t];
      else { map[t] = fresh('p'); newPeople.push(t); }
    });
    // matched people: field by field
    Object.keys(pairs).forEach(function (t) {
      var o = pairs[t], p = ours.people[o], q = theirs.people[t];
      if (!p || !q) return;
      var mn = maiden(ours, theirs, p, q);
      PERSON_FIELDS.forEach(function (f) {
        var a = get(p, f[0]), b = get(q, f[0]), c = compare(f[0], a, b, p, q);
        if (f[0] === 'surname' && mn) c = { auto: mn.keep, why: mn.keep === 'ours' ? 'у них — прізвище при народженні' : 'у нас — прізвище при народженні, у них — у шлюбі' };
        if (c.auto === 'same') return;
        items.push({ key: 'p:' + o + ':' + f[0], who: o, theirsId: t, field: f[0], label: f[1], a: a, b: b, auto: c.auto, why: c.why || '', both: !!c.both });
      });
      // the surname she was born with, known from the other tree
      // (a different one already recorded here is a conflict)
      if (mn && mn.born && fold(mn.born) !== fold(p.birthName) && !items.some(function (i) { return i.key === 'p:' + o + ':birthName'; }))
        items.push({ key: 'p:' + o + ':birthName', who: o, theirsId: t, field: 'birthName', label: 'Прізвище при народженні', a: p.birthName, b: mn.born,
          auto: fold(p.birthName) ? null : 'theirs', why: fold(p.birthName) ? '' : 'прізвище її батьків', both: false });
      // photos: theirs are all added; the same file twice is kept once
      var have = {}; (p.photos || []).forEach(function (x) { have[x.src] = 1; });
      var add = (q.photos || []).filter(function (x) { return !have[x.src]; });
      if (add.length) photos.push({ who: o, add: add, main: !p.photo && q.photo ? q.photo : null });
    });
    // families: the same couple (after matching) is one family; children from both come together
    theirs.families.forEach(function (g) {
      var a = map[g.a], b = g.b ? map[g.b] : null;
      var same = ours.families.find(function (f) { return (f.a === a && (f.b || null) === b) || (b && f.a === b && f.b === a); });
      if (!same) { fams.push({ add: true, id: fresh('f'), src: g, a: a, b: b }); return; }
      var flip = same.a !== a;
      var kids = g.kids.filter(function (k) { return !same.kids.some(function (x) { return x.id === map[k.id]; }); });
      var entry = { add: false, id: same.id, src: g, kids: kids, flip: flip };
      fams.push(entry);
      if (b) {
        var ct = g.type === same.type ? null : same.type === 'none' ? 'theirs' : g.type === 'none' ? 'ours' : null;
        if (g.type !== same.type) items.push({ key: 'f:' + same.id + ':type', fam: same.id, field: 'type', label: 'Стосунки', a: same.type, b: g.type, auto: ct, why: ct ? 'одне з дерев не знає, чи це шлюб' : '', both: false });
        ['start', 'end'].forEach(function (k) {
          var c = compare('x.date', same[k], g[k]);
          if (c.auto !== 'same') items.push({ key: 'f:' + same.id + ':' + k, fam: same.id, field: k, label: k === 'start' ? 'Початок стосунків' : 'Кінець стосунків', a: same[k], b: g[k], auto: c.auto, why: c.why || '', both: false });
        });
      }
      // the same child, a different tie (adopted in one tree)
      g.kids.forEach(function (k) {
        var mine = same.kids.find(function (x) { return x.id === map[k.id]; });
        if (!mine) return;
        var tr = flip ? { ra: k.rb, rb: k.ra } : k;
        if (mine.ra !== tr.ra || mine.rb !== tr.rb) items.push({ key: 'k:' + same.id + ':' + mine.id, fam: same.id, kid: mine.id, field: 'kid', label: 'Зв’язок дитини з батьками', a: mine.ra + '/' + mine.rb, b: tr.ra + '/' + tr.rb, auto: null, why: '', both: false });
      });
    });
    return { map: map, items: items, newPeople: newPeople, photos: photos, families: fams };
  }

  /* ---------------------------------------------------------------- doing it */
  function pick(item, choices) { var c = choices && choices[item.key]; return c || item.auto || (item.both ? 'both' : 'ours'); }
  function apply(ours, theirs, pl, choices) {
    var d = clone(ours), map = pl.map;
    pl.newPeople.forEach(function (t) {
      var q = clone(theirs.people[t]); q.id = map[t];
      d.people[q.id] = q;
    });
    pl.items.forEach(function (it) {
      var c = pick(it, choices);
      if (it.who) {
        var p = d.people[it.who];
        if (c === 'theirs') set(p, it.field, clone(it.b));
        else if (c === 'both' && it.field === 'notes') p.notes = [it.a, it.b].filter(Boolean).join('\n\n');
      } else if (it.fam) {
        var f = d.families.find(function (x) { return x.id === it.fam; });
        if (!f || c !== 'theirs') return;
        if (it.field === 'kid') { var k = f.kids.find(function (x) { return x.id === it.kid; }), r = it.b.split('/'); k.ra = r[0]; k.rb = r[1]; }
        else f[it.field] = it.b;
      }
    });
    pl.photos.forEach(function (ph) {
      var p = d.people[ph.who];
      p.photos = (p.photos || []).concat(ph.add.map(function (x, i) { return Object.assign(clone(x), { id: 'ph-m' + Date.now().toString(36) + '-' + ph.who + '-' + i }); }));
      if (!p.photo && ph.main) p.photo = ph.main;
    });
    pl.families.forEach(function (e) {
      var g = e.src;
      var kid = function (k) { return { id: map[k.id], ra: k.ra, rb: k.rb }; };
      if (e.add) {
        d.families.push({ id: e.id, a: e.a, b: e.b, type: g.type, start: g.start, end: g.end, kids: g.kids.map(kid) });
        return;
      }
      var f = d.families.find(function (x) { return x.id === e.id; });
      e.kids.forEach(function (k) { var nk = kid(k); if (e.flip) { var t = nk.ra; nk.ra = nk.rb; nk.rb = t; } f.kids.push(nk); });
    });
    d.meta = Object.assign({}, d.meta);
    return d;
  }

  var api = { suggest: suggest, plan: plan, apply: apply, pick: pick, SEX: SEX };
  root.FamilyMerge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
