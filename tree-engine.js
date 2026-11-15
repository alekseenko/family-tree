/*
 * Family Archive — tree engine
 * Pure functions: data-model helpers, the person-centred tree layout, derived
 * relationships, small mutations and a Markdown subset parser.
 *
 * Classic script (no ES modules — those are blocked on file://).
 * In the browser:  <script src="tree-engine.js"></script>  →  window.FamilyEngine
 * In Node (tests): const FE = require('./tree-engine.js')
 *
 * Extracted from the prototype (reference/prototype/Main.dc.html) and kept
 * behaviour-identical; see tests/tree-engine.test.js.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ dims */
  // Card and spacing sizes in CSS px. Must match .ft-node / .ft-pnode in familytree.css.
  var DIMS = {
    compact:  { cw: 188, ch: 72,  cg: 88, sg: 24, gg: 48, rg: 88 },
    expanded: { cw: 172, ch: 272, cg: 88, sg: 24, gg: 48, rg: 80 },
    poster:   { cw: 164, ch: 64,  cg: 68, sg: 12, gg: 20, rg: 76 }
  };
  // cw/ch = card width/height · cg = gap between partners · sg = gap between siblings
  // gg = gap between family groups · rg = vertical gap between generations

  /* ------------------------------------------------------------ model helpers */
  function famsOf(d, id) { return d.families.filter(function (f) { return f.a === id || f.b === id; }); }
  function parentFams(d, id) { return d.families.filter(function (f) { return f.kids.some(function (k) { return k.id === id; }); }); }
  function other(f, id) { return f.a === id ? f.b : f.a; }
  function yearOf(v) { var r = readDate(v); return r ? r.y : null; }
  function sortFams(list) {
    var key = function (f) { return yearOf(f.start) || yearOf(f.end) || 9999; };
    return list.slice().sort(function (x, y) { return key(x) - key(y); });
  }
  // The family that draws a person's parents: prefer one where the child is biological to both.
  function primaryParentFam(d, id) {
    var fs = parentFams(d, id);
    if (!fs.length) return null;
    var bio = fs.find(function (f) { var k = f.kids.find(function (q) { return q.id === id; }); return k.ra === 'bio' && (!f.b || k.rb === 'bio'); });
    return bio || fs[0];
  }
  // One stroke style per child line: adopted > foster > step > bio.
  function kidRel(f, k) {
    if (!k) return 'bio';
    var rs = [k.ra]; if (f.b) rs.push(k.rb);
    if (rs.indexOf('adopted') >= 0) return 'adopted';
    if (rs.indexOf('foster') >= 0) return 'foster';
    if (rs.indexOf('step') >= 0) return 'step';
    return 'bio';
  }
  // Parents, partners and children (not siblings), existing people only.
  function relatedIds(d, id) {
    var s = {};
    parentFams(d, id).forEach(function (f) { if (f.a) s[f.a] = 1; if (f.b) s[f.b] = 1; });
    famsOf(d, id).forEach(function (f) { var o = other(f, id); if (o) s[o] = 1; f.kids.forEach(function (k) { s[k.id] = 1; }); });
    delete s[id];
    return Object.keys(s).filter(function (x) { return d.people[x]; });
  }
  function unionStyle(f) {
    if (f.type === 'partner') return { style: 'dashed', tone: '' };
    if (f.type === 'divorced') return { style: 'solid', tone: 'muted' };
    if (f.type === 'none') return { style: 'dotted', tone: 'muted' };
    return { style: 'solid', tone: '' };
  }
  function relStyle(rel) { return rel === 'adopted' ? 'dashed' : (rel === 'step' || rel === 'foster') ? 'dotted' : 'solid'; }
  function unionShort(f) {   // label on the union line; must fit the 64px gap between partners
    var ys = yearOf(f.start), ye = yearOf(f.end);
    // no year: the line style (solid / dashed) already says married or partners
    if (f.type === 'married') return ys ? 'шл. ' + ys : '';
    if (f.type === 'partner') return ys ? 'з ' + ys : '';
    if (f.type === 'divorced') return ye ? 'розл. ' + ye : 'розлучені';
    return '';
  }
  function unionLong(f) {    // chip in the drawer
    var ys = yearOf(f.start), ye = yearOf(f.end);
    if (f.type === 'married') return 'Шлюб' + (ys ? ' ' + ys : '');
    if (f.type === 'partner') return 'Партнери' + (ys ? ' з ' + ys : '');
    if (f.type === 'divorced') return 'Розлучення' + (ye ? ' ' + ye : '');
    return 'Спільні діти';
  }
  // With two or more partners, labels are numbered in date order: "1 · розл. 1986", "2 · шлюб".
  var UNION_WORD = { married: 'шлюб', partner: 'партнери', divorced: 'розлучені', none: 'спільні діти' };
  function unionNumbered(f, n) { return n + ' · ' + (unionShort(f) || UNION_WORD[f.type] || ''); }
  // Short tag beside a non-biological child line.
  var REL_TAG = { adopted: 'усиновлення', step: 'нерідні', foster: 'опіка' };
  function relTag(rel) { return REL_TAG[rel] || rel; }

  /* ------------------------------------------------------------ display helpers */
  // How names are shown (the data keeps them as typed): 'as' as written, 'cap' Іван-Петро Коваленко,
  // 'upper' ІВАН КОВАЛЕНКО. A letter after an apostrophe stays small: Мар’яна.
  var nameCase = 'as';
  function setNameCase(v) { nameCase = v === 'cap' || v === 'upper' ? v : 'as'; }
  function caseName(t) {
    t = String(t == null ? '' : t);
    if (nameCase === 'upper') return t.toLocaleUpperCase('uk');
    if (nameCase === 'cap') return t.toLocaleLowerCase('uk').replace(/(^|[\s\-‐–—(«"„.]+)(\S)/g, function (m, a, c) { return a + c.toLocaleUpperCase('uk'); });
    return t;
  }
  function nameOf(p) { if (!p) return ''; var n = [p.given, p.surname].filter(Boolean).join(' ').trim(); return n ? caseName(n) : 'Невідомо'; }
  function givenOf(p) { if (!p) return ''; var g = (p.given || '').trim(); return g ? caseName(g) : nameOf(p); }
  function initials(p) { if (!p) return '?'; var a = (p.given || '').trim(), b = (p.surname || '').trim(); return ((a ? a[0] : '') + (b ? b[0] : '')).toUpperCase() || '?'; }
  // "1931–2014", "1933–?", "нар. 1979" or "Дати невідомі"
  function yearsOf(p) {
    if (!p) return '';
    // an approximate year keeps its mark: нар. бл. 1930, ~1930–1990
    // free text ("до 1930", "весна 1945") shows its year as approximate too
    var yr = function (v, mark) { var r = readDate(v); return r && r.y ? (r.approx || r.free ? mark : '') + r.y : null; };
    var b = yr(p.birth && p.birth.date, '~'), dd = yr(p.death && p.death.date, '~');
    if (p.deceased && (b || dd)) return (b || '?') + '–' + (dd || '?');
    // "до 1930", "після 1950", "між 1930 і 1935" say more than "бл."
    var raw = String(p.birth && p.birth.date || '').trim(), m = raw.match(/^(до|після)\s+(\d{4})$/i) || raw.match(/^(?:між\s+)?(\d{4})\s*(?:і|й|та|-|–)\s*(\d{4})$/i);
    if (m) return 'нар. ' + (/^\d/.test(m[1]) ? m[1] + '–' + m[2] : m[1].toLowerCase() + ' ' + m[2]);
    b = yr(p.birth && p.birth.date, 'бл. ');
    return b ? 'нар. ' + b : 'Дати невідомі';
  }
  // Day + month uses the genitive ("12 березня 1931"); month + year the nominative ("березень 1931").
  var MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  var MONTHS_NOM = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
  // Dates are free text, typed however is natural: 12.03.1931, 12/3/1931, 12 3 1931, 12031931,
  // 1931-03-12, 12 березня 1931, бер 1931, 03.1931, 1931, бл. 1930, 1930?. readDate understands them
  // and gives the tidy form (12.03.1931, 03.1931, 1931, бл. 1930) in `text`. Anything else is kept
  // as typed ("весна 1945": free, with its year if it has one). A date that can't exist (31.02.1931)
  // is `bad`. Returns null for an empty value.
  var MONTH_RE = [/^січ/, /^лют/, /^бер/, /^квіт/, /^трав/, /^черв/, /^лип/, /^серп/, /^вер/, /^жовт/, /^лист/, /^груд/];
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  function monthOf(tok) {
    if (/^\d{1,2}$/.test(tok)) return +tok >= 1 && +tok <= 12 ? +tok : 0;
    for (var i = 0; i < 12; i++) if (MONTH_RE[i].test(tok)) return i + 1;
    return 0;
  }
  // Before 1918 dates here are usually Julian (church records), where every fourth year has 29 February.
  function daysIn(y, m) { return m === 2 && y < 1918 && y % 4 === 0 ? 29 : new Date(y, m, 0).getDate(); }
  function readDate(v) {
    var raw = String(v == null ? '' : v).trim(), s = raw.toLowerCase(), m;
    if (!s) return null;
    var free = function () { var y = s.match(/(\d{4})/); return { y: y ? +y[1] : null, m: 0, d: 0, free: true, text: raw }; };
    if ((m = s.match(/^(?:бл\.?|близько|приблизно|~|abt\.?|about|ca?\.)\s*(\d{4})$/) || s.match(/^(\d{4})\s*\?$/))) return { y: +m[1], m: 0, d: 0, approx: true, text: 'бл. ' + m[1] };
    var toks = s.replace(/(\d)(р\.?|року|рік)$/, '$1').split(/[\s.,\/\-]+/).filter(function (x) { return x && !/^(р|року|рік|р\.)$/.test(x); });
    // digits only, the year last: 12031931, 1231931 (12.3), 131931 (1.3), 031931 (03.1931), 31931 (3.1931)
    if (toks.length === 1 && /^\d{5,8}$/.test(toks[0])) {
      var dg = toks[0], yy0 = dg.slice(-4), head = dg.slice(0, -4), ok = [];
      var tryDM = function (dd0, mm0) { var y0 = +yy0, d0 = +dd0, m0 = +mm0; if (m0 >= 1 && m0 <= 12 && d0 >= 1 && d0 <= daysIn(y0, m0)) ok.push([dd0, mm0, yy0]); };
      if (head.length === 4) tryDM(head.slice(0, 2), head.slice(2));
      if (head.length === 3) { tryDM(head.slice(0, 2), head.slice(2)); tryDM(head.slice(0, 1), head.slice(1)); }
      if (head.length === 2) { if (+head >= 1 && +head <= 12) ok.push([head, yy0]); tryDM(head.slice(0, 1), head.slice(1)); }
      if (head.length === 1 && +head >= 1) ok.push([head, yy0]);
      if (ok.length === 1) toks = ok[0];
      else if (ok.length > 1) {
        var opts = ok.map(function (o) { return o.length === 3 ? pad2(+o[0]) + '.' + pad2(+o[1]) + '.' + o[2] : pad2(+o[0]) + '.' + o[1]; });
        return { y: +yy0, m: 0, d: 0, bad: true, ambiguous: opts, text: raw };
      }
      else return { y: +yy0, m: 0, d: 0, bad: true, text: raw };
    }
    if (toks.length === 3 && /^\d{4}$/.test(toks[0]) && /^\d{1,2}$/.test(toks[2])) toks = [toks[2], toks[1], toks[0]];   // 1931-03-12
    if (toks.length === 2 && /^\d{4}$/.test(toks[0]) && /^\d{1,2}$/.test(toks[1])) toks = [toks[1], toks[0]];            // 1931-03
    var isY = function (x) { return /^\d{4}$/.test(x); };
    if (toks.length === 1 && isY(toks[0])) return { y: +toks[0], m: 0, d: 0, text: toks[0] };
    if (toks.length === 2 && isY(toks[1]) && (/^\d{1,2}$/.test(toks[0]) || monthOf(toks[0]))) {
      var mo = monthOf(toks[0]);
      return mo ? { y: +toks[1], m: mo, d: 0, text: pad2(mo) + '.' + toks[1] } : { y: +toks[1], m: 0, d: 0, bad: true, text: raw };
    }
    if (toks.length === 3 && isY(toks[2]) && /^\d{1,2}$/.test(toks[0]) && (/^\d{1,2}$/.test(toks[1]) || monthOf(toks[1]))) {
      var dd = +toks[0], mm = monthOf(toks[1]), yy = +toks[2];
      if (!mm || dd < 1 || dd > daysIn(yy, mm)) return { y: yy, m: 0, d: 0, bad: true, text: raw };
      return { y: yy, m: mm, d: dd, text: pad2(dd) + '.' + pad2(mm) + '.' + yy };
    }
    return free();
  }
  // { y, m, d } (m and d 0 when unknown) for dates with a year; null otherwise.
  function parseDate(v) { var r = readDate(v); return r && r.y && !r.bad ? { y: r.y, m: r.m, d: r.d } : null; }
  // The tidy form to store: what readDate understood, or the text as typed.
  function normDate(v) { var r = readDate(v); return r ? r.text : ''; }
  // Ages and order need the full date: compares as yyyymmdd, unknown month or day counted as 0.
  function dateKey(v) { var p = parseDate(v); return p ? p.y * 10000 + p.m * 100 + p.d : null; }
  // Death before birth, or a year in the future: the drawer warns about it.
  // A death date counts only while the person is marked as deceased (unticking keeps the date, in case).
  function deathDate(p) { return p.deceased && p.death ? p.death.date : ''; }
  function dateProblem(p) {
    var bad = [p.birth && p.birth.date, deathDate(p)].filter(function (v) { var r = readDate(v); return r && r.bad; })[0];
    if (bad) { var amb = readDate(bad).ambiguous; return amb ? 'Неоднозначна дата ' + String(bad).trim() + ': це ' + amb.join(' чи ') + '? Поставте крапки.' : 'Такої дати немає: ' + String(bad).trim() + '.'; }
    var b = dateKey(p.birth && p.birth.date), d = dateKey(deathDate(p)), now = new Date().getFullYear();
    if (b && d) {
      var bp = parseDate(p.birth.date), dp = parseDate(p.death.date);
      // compare only as precisely as both dates are known
      var lo = bp.y !== dp.y ? [bp.y, dp.y] : !bp.m || !dp.m ? [0, 0] : bp.m !== dp.m ? [bp.m, dp.m] : !bp.d || !dp.d ? [0, 0] : [bp.d, dp.d];
      if (lo[1] < lo[0]) return 'Дата смерті раніша за дату народження.';
    }
    if (b && Math.floor(b / 10000) > now) return 'Рік народження ще не настав.';
    if (d && Math.floor(d / 10000) > now) return 'Рік смерті ще не настав.';
    return '';
  }
  // Whole years between two dates, or null.
  function ageBetween(a, b) {
    var x = parseDate(a), y = parseDate(b);
    if (!x || !y) return null;
    var n = y.y - x.y;
    // a year less only when the birthday is known to be still ahead
    if (x.m && y.m && (x.m !== y.m ? y.m < x.m : x.d && y.d && y.d < x.d)) n -= 1;
    return n;
  }
  function fmtDate(v) {
    var r = readDate(v);
    if (!r) return '';
    if (r.bad || r.free) return r.text;
    if (r.approx) return r.text;
    if (r.d) return r.d + ' ' + MONTHS[r.m - 1] + ' ' + r.y;
    if (r.m) return MONTHS_NOM[r.m - 1] + ' ' + r.y;
    return String(r.y);
  }
  // Search folds case and the apostrophe variants (' ’ ʼ `), so Мар'яна finds Мар’яна.
  function fold(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/['’ʼ`‘]/g, '’'); }
  function searchText(p) { return fold([p.given, p.surname, p.birthName, p.nick, p.birth && p.birth.place, p.death && p.death.place].filter(Boolean).join(' ')); }
  // every word of the query, in any order: "коваленко олена" finds Олена Коваленко
  function matches(p, q) { var t = searchText(p); return fold(q).split(/\s+/).every(function (w) { return t.indexOf(w) >= 0; }); }
  // Surname, then given name. localeCompare keeps і, ї, є and ґ in Ukrainian alphabetical order;
  // missing parts sort last.
  function byName(a, b) {
    var x = [a.surname, a.given], y = [b.surname, b.given];
    for (var i = 0; i < 2; i++) {
      if (!x[i] !== !y[i]) return x[i] ? -1 : 1;
      var c = (x[i] || '').localeCompare(y[i] || '', 'uk', { sensitivity: 'base' });
      if (c) return c;
    }
    return 0;
  }

  /* ------------------------------------------------------------ derived relations */
  // Siblings are never stored. kind: full (both parents shared) | half (one) | step (via a parent's partner)
  function siblingsOf(d, pid) {
    var parentsOf = function (id) {
      var m = {};
      parentFams(d, id).forEach(function (f) { var k = f.kids.find(function (q) { return q.id === id; }); if (f.a && k.ra !== 'step') m[f.a] = k.ra; if (f.b && k.rb !== 'step') m[f.b] = k.rb; });
      return m;
    };
    var mine = parentsOf(pid), mineIds = Object.keys(mine), anyParent = {}, sameFam = {}, cands = {};
    parentFams(d, pid).forEach(function (f) { if (f.a) anyParent[f.a] = 1; if (f.b) anyParent[f.b] = 1; f.kids.forEach(function (k) { sameFam[k.id] = 1; }); });
    Object.keys(anyParent).forEach(function (par) { famsOf(d, par).forEach(function (f) { f.kids.forEach(function (k) { if (k.id !== pid && d.people[k.id]) cands[k.id] = 1; }); }); });
    return Object.keys(cands).map(function (id) {
      var theirs = parentsOf(id), shared = mineIds.filter(function (x) { return theirs[x]; }), kind = 'step';
      if (shared.length >= 2 || (shared.length === 1 && mineIds.length < 2 && Object.keys(theirs).length < 2 && sameFam[id])) kind = 'full';
      else if (shared.length === 1) kind = 'half';
      return { id: id, kind: kind, adopted: shared.some(function (x) { return theirs[x] === 'adopted'; }) };
    }).sort(function (a, b) { return (yearOf(d.people[a.id].birth.date) || 9999) - (yearOf(d.people[b.id].birth.date) || 9999); });
  }
  function alreadyLinked(d, kind, pid, xid) {
    if (kind === 'parent') return parentFams(d, pid).some(function (f) { return f.a === xid || f.b === xid; });
    if (kind === 'child') return famsOf(d, pid).some(function (f) { return f.kids.some(function (k) { return k.id === xid; }); });
    if (kind === 'partner') return famsOf(d, pid).some(function (f) { return other(f, pid) === xid; });
    if (kind === 'sibling') { var pf = primaryParentFam(d, pid); return !!pf && pf.kids.some(function (k) { return k.id === xid; }); }
    return false;
  }

  /* ------------------------------------------------------------ mutations (operate on a draft copy) */
  function newId(d, prefix) {
    var n = 1;
    if (prefix === 'p') { while (d.people['p' + n]) n++; }
    else { var ids = {}; d.families.forEach(function (f) { ids[f.id] = 1; }); while (ids['f' + n]) n++; }
    return prefix + n;
  }
  function insertKid(d, f, kid) {   // keeps birth-year order for new children
    var y = yearOf(d.people[kid.id] && d.people[kid.id].birth.date), at = f.kids.length;
    if (y) { for (var i = 0; i < f.kids.length; i++) { var q = d.people[f.kids[i].id]; var yy = yearOf(q && q.birth.date); if (yy && yy > y) { at = i; break; } } }
    f.kids.splice(at, 0, kid);
  }
  // "Olena" + suggestion "Kovalenko" → Olena Kovalenko; "Olena Savchenko" → as typed (last word = surname)
  function splitName(full, suggest) {
    var t = String(full || '').trim().replace(/\s+/g, ' ');
    if (!t) return { given: '', surname: '' };
    var parts = t.split(' ');
    if (parts.length === 1) return { given: parts[0], surname: suggest || '' };
    return { given: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
  }
  function removePerson(d, pid) {
    delete d.people[pid];
    d.families = d.families.map(function (f) {
      var g = Object.assign({}, f, { kids: f.kids.filter(function (k) { return k.id !== pid; }) });
      if (g.a === pid) { g.a = g.b; g.b = null; g.kids = g.kids.map(function (k) { return { id: k.id, ra: k.rb || 'bio', rb: 'bio' }; }); }
      else if (g.b === pid) g.b = null;
      return g;
    }).filter(function (f) { return f.a && (f.b || f.kids.length); });
  }
  // keep = true → "only the partnership": they stay co-parents (type 'none')
  function detachPartner(d, fid, otherId, keep) {
    var f = d.families.find(function (x) { return x.id === fid; }); if (!f) return false;
    if (keep) { f.type = 'none'; f.start = ''; f.end = ''; return true; }
    if (!f.kids.length) { d.families = d.families.filter(function (x) { return x.id !== fid; }); return true; }
    if (f.b === otherId) { f.b = null; f.kids.forEach(function (k) { k.rb = 'bio'; }); }
    else if (f.a === otherId) { f.a = f.b; f.b = null; f.kids.forEach(function (k) { k.ra = k.rb; k.rb = 'bio'; }); }
    return true;
  }
  // Child keeps the other parent of that family via a single-parent family.
  function detachParentLink(d, fid, childId, parentId) {
    var f = d.families.find(function (x) { return x.id === fid; }); if (!f) return false;
    var k = f.kids.find(function (q) { return q.id === childId; }); if (!k) return false;
    f.kids = f.kids.filter(function (q) { return q.id !== childId; });
    var op = f.a === parentId ? f.b : f.a, orel = f.a === parentId ? k.rb : k.ra;
    if (op) {
      var g = d.families.find(function (x) { return x.a === op && !x.b; });
      if (!g) { g = { id: newId(d, 'f'), a: op, b: null, type: 'none', start: '', end: '', kids: [] }; d.families.push(g); }
      g.kids.push({ id: childId, ra: orel || 'bio', rb: 'bio' });
    }
    d.families = d.families.filter(function (x) { return x.a && (x.b || x.kids.length); });
    return true;
  }

  // A child listed under a parent alone and also under that parent in a couple is a leftover
  // (e.g. the other parent was linked later). Drop the solo entry, then families left empty.
  function tidyFamilies(d) {
    // one family per lone parent: a second one (after a partner was removed) joins the first
    var lone = {};
    d.families.forEach(function (g) {
      if (g.b || !g.a) return;
      var first = lone[g.a];
      if (!first) { lone[g.a] = g; return; }
      g.kids.forEach(function (k) { if (!first.kids.some(function (q) { return q.id === k.id; })) first.kids.push(k); });
      g.kids = [];
    });
    d.families.forEach(function (g) {
      if (g.b) return;
      if (g.type !== 'none') g.type = 'none';
      g.kids = g.kids.filter(function (k) {
        return !d.families.some(function (x) { return x !== g && x.b && (x.a === g.a || x.b === g.a) && x.kids.some(function (q) { return q.id === k.id; }); });
      });
    });
    // a couple linked only as their children's parents stops being one when no child is left
    d.families = d.families.filter(function (f) { return f.a && (f.b ? f.type !== 'none' || f.kids.length : f.kids.length); });
    return d;
  }
  // Someone listed as their own parent, or their own ancestor through any chain of families.
  function hasLoop(d) {
    var up = Object.create(null);
    d.families.forEach(function (f) {
      f.kids.forEach(function (k) { (up[k.id] = up[k.id] || []).push(f.a, f.b); });
    });
    // depth-first without recursion: a tree can be thousands of generations deep in a bad file
    var state = Object.create(null);
    return Object.keys(up).some(function (start) {
      if (state[start]) return false;
      var stack = [[start, 0]];
      state[start] = 1;
      while (stack.length) {
        var top = stack[stack.length - 1], ps = up[top[0]] || [];
        if (top[1] >= ps.length) { state[top[0]] = 2; stack.pop(); continue; }
        var p = ps[top[1]++];
        if (!p) continue;
        if (state[p] === 1) return true;
        if (!state[p]) { state[p] = 1; stack.push([p, 0]); }
      }
      return false;
    });
  }

  /* ------------------------------------------------------------ Markdown subset (notes) */
  // Paragraphs, #..###### headings, "- " / "* " lists, **bold**, *italic*, _italic_. Returns data, never HTML.
  function mdSpans(t) {
    var out = [], re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g, last = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > last) out.push({ t: t.slice(last, m.index), cls: '' });
      var tok = m[0];
      if (tok.indexOf('**') === 0 || tok.indexOf('__') === 0) out.push({ t: tok.slice(2, -2), cls: 'is-b' }); else out.push({ t: tok.slice(1, -1), cls: 'is-i' });
      last = m.index + tok.length;
    }
    if (last < t.length) out.push({ t: t.slice(last), cls: '' });
    return out;
  }
  function parseMd(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), blocks = [], para = [], list = null;
    var flushP = function () { if (para.length) { blocks.push({ isP: true, isH: false, isList: false, spans: mdSpans(para.join('\n')), items: [] }); para = []; } };
    var flushL = function () { if (list) { blocks.push({ isP: false, isH: false, isList: true, spans: [], items: list }); list = null; } };
    lines.forEach(function (ln) {
      var t = ln.trim(), m;
      if (!t) { flushP(); flushL(); return; }
      m = t.match(/^#{1,6}\s+(.*)$/);
      if (m) { flushP(); flushL(); blocks.push({ isP: false, isH: true, isList: false, spans: mdSpans(m[1]), items: [] }); return; }
      m = t.match(/^[-*]\s+(.*)$/);
      if (m) { flushP(); if (!list) list = []; list.push({ spans: mdSpans(m[1]) }); return; }
      flushL(); para.push(t);
    });
    flushP(); flushL();
    return blocks;
  }

  /* ------------------------------------------------------------ kinship
     kinship(d, homeId, pid) names pid from the home person's side: "Ваш дід по матері",
     "Ваша двоюрідна сестра", "Ваш тесть". '' for the home person and for people not connected. */
  // Everyone above (up) or below a person, as { id: true }, without the person.
  function lineOf(d, id, up) {
    var out = {}, q = [id];
    while (q.length) {
      var x = q.shift();
      d.families.forEach(function (f) {
        var next = up ? (f.kids.some(function (k) { return k.id === x; }) ? [f.a, f.b] : [])
          : (f.a === x || f.b === x ? f.kids.map(function (k) { return k.id; }) : []);
        next.forEach(function (n) { if (n && n !== id && d.people[n] && !out[n]) { out[n] = true; q.push(n); } });
      });
    }
    return out;
  }
  // blood: leave out step-parents, so a step-parent's parents aren't called grandparents
  function ancestorsOf(d, id, blood) {
    var out = {}, q = [id];
    out[id] = { n: 0, via: null };
    while (q.length) {
      var x = q.shift(), cur = out[x];
      parentFams(d, x).forEach(function (f) {
        var k = f.kids.find(function (c) { return c.id === x; });
        [[f.a, k && k.ra], [f.b, k && k.rb]].forEach(function (pr) {
          var p = pr[0];
          if (!p || !d.people[p] || out[p] || (blood && pr[1] === 'step')) return;
          out[p] = { n: cur.n + 1, via: cur.n === 0 ? p : cur.via };
          q.push(p);
        });
      });
    }
    return out;
  }
  // Closest common ancestor: up = generations from a to it, down = from it to b.
  function bloodLink(d, a, b) {
    var A = ancestorsOf(d, a, true), B = ancestorsOf(d, b, true), best = null;
    Object.keys(A).forEach(function (x) {
      if (!B[x]) return;
      var s = A[x].n + B[x].n;
      if (!best || s < best.s) best = { s: s, up: A[x].n, down: B[x].n, via: A[x].via, anc: x };
    });
    if (best) best.shared = Object.keys(A).filter(function (x) { return A[x].n === 1 && B[x] && B[x].n === 1; });
    return best;
  }
  // "Ваш дід", "Ваша бабуся", "Ваш дід чи бабуся"
  function yours(p, m, f) {
    if (p.sex === 'm') return 'Ваш ' + m;
    if (p.sex === 'f') return 'Ваша ' + f;
    return 'Ваш ' + m + ' чи ' + f;
  }
  var PRA = function (n) { return new Array(n + 1).join('пра'); };
  function bloodTerm(d, home, p, L) {
    var up = L.up, down = L.down, via = d.people[L.via], side = via && up >= 2 ? (via.sex === 'm' ? ' по батькові' : via.sex === 'f' ? ' по матері' : '') : '';
    if (down === 0) {
      if (up === 1) {
        var pf = parentFams(d, home.id).find(function (f) { return f.a === p.id || f.b === p.id; });
        var k = pf && pf.kids.find(function (q) { return q.id === home.id; }), rel = k ? (pf.a === p.id ? k.ra : k.rb) : 'bio';
        if (rel === 'step') return p.sex === 'f' ? 'Ваша мачуха' : p.sex === 'm' ? 'Ваш вітчим' : 'Ваш вітчим чи мачуха';
        if (rel === 'adopted' || rel === 'foster') return yours(p, 'прийомний батько', 'прийомна мати');
        return p.sex === 'u' || !p.sex ? 'Один із ваших батьків' : yours(p, 'батько', 'мати');
      }
      return yours(p, PRA(up - 2) + 'дід', PRA(up - 2) + 'бабуся') + side;
    }
    if (up === 0) {
      if (down === 1) return p.sex === 'm' ? 'Ваш син' : p.sex === 'f' ? 'Ваша донька' : 'Ваша дитина';
      return yours(p, PRA(down - 2) + 'онук', PRA(down - 2) + 'онука');
    }
    if (up === 1 && down === 1) {
      // one shared parent makes a half-sibling only when the other parents are known to differ
      var sib = siblingsOf(d, home.id).find(function (x) { return x.id === p.id; });
      if (L.shared.length === 1 && (!sib || sib.kind === 'half')) {
        var sp = d.people[L.shared[0]];
        if (sp && sp.sex === 'm') return yours(p, 'єдинокровний брат', 'єдинокровна сестра') + ' (спільний батько)';
        if (sp && sp.sex === 'f') return yours(p, 'єдиноутробний брат', 'єдиноутробна сестра') + ' (спільна мати)';
      }
      return yours(p, 'брат', 'сестра');
    }
    if (up === 2 && down === 1) return yours(p, 'дядько', 'тітка') + side;
    if (up === 1 && down === 2) return yours(p, 'племінник', 'племінниця');
    if (up === down) {
      var deg = ['двоюрідн', 'троюрідн', 'чотириюрідн'][up - 2];
      if (deg) return yours(p, deg + 'ий брат', deg + 'а сестра') + side;
    }
    if (up === 3 && down === 1) return yours(p, 'двоюрідний дід', 'двоюрідна бабуся') + side;
    if (up === 1 && down === 3) return yours(p, 'внучатий племінник', 'внучата племінниця');
    if (up === 3 && down === 2) return yours(p, 'двоюрідний дядько', 'двоюрідна тітка') + side;
    if (up === 2 && down === 3) return yours(p, 'двоюрідний племінник', 'двоюрідна племінниця');
    return yours(p, 'далекий родич', 'далека родичка');
  }
  function kinship(d, homeId, pid) {
    var home = d.people[homeId], p = d.people[pid];
    if (!home || !p || homeId === pid) return '';
    // partner
    var pf = famsOf(d, homeId).find(function (f) { return other(f, homeId) === pid; });
    if (pf) {
      if (pf.type === 'married') return yours(p, 'чоловік', 'дружина');
      if (pf.type === 'divorced') return yours(p, 'колишній чоловік', 'колишня дружина');
      if (pf.type === 'partner') return yours(p, 'партнер', 'партнерка');
      return 'Другий з батьків ваших дітей';
    }
    var L = bloodLink(d, homeId, pid);
    if (L) return bloodTerm(d, home, p, L);
    // the partner of a blood relative
    var viaRel = famsOf(d, pid).map(function (f) { return other(f, pid); }).filter(function (q) { return q && d.people[q]; })
      .map(function (q) { return { q: q, L: bloodLink(d, homeId, q) }; }).filter(function (x) { return x.L; })
      .sort(function (x, y) { return x.L.s - y.L.s; })[0];
    if (viaRel) {
      var u = viaRel.L.up, dn = viaRel.L.down;
      if (u === 1 && dn === 0) return yours(p, 'вітчим', 'мачуха');
      if ((u === 0 && dn === 1) || (u === 1 && dn === 1)) return yours(p, 'зять', 'невістка');
      if (u === 0 && dn === 2) {
        var gc = d.people[viaRel.q];
        return (p.sex === 'f' ? 'Дружина' : p.sex === 'm' ? 'Чоловік' : 'Партнер') + ' ' + (gc.sex === 'f' ? 'вашої онуки' : gc.sex === 'm' ? 'вашого онука' : 'вашого онука чи онуки');
      }
      if (u === 2 && dn === 1) {
        var vv = d.people[viaRel.L.via];
        return yours(p, 'дядько', 'тітка') + (vv && vv.sex === 'm' ? ' по батькові' : vv && vv.sex === 'f' ? ' по матері' : '');
      }
    }
    // a blood relative of one's own partner (the current one first)
    var mine = sortFams(famsOf(d, homeId)).reverse().map(function (f) { return other(f, homeId); }).filter(function (q) { return q && d.people[q]; });
    for (var i = 0; i < mine.length; i++) {
      var sp = d.people[mine[i]], M = bloodLink(d, mine[i], pid);
      if (!M) continue;
      var wife = sp.sex === 'f';
      if (M.up === 1 && M.down === 0) return wife ? yours(p, 'тесть', 'теща') : sp.sex === 'm' ? yours(p, 'свекор', 'свекруха') : yours(p, 'тесть чи свекор', 'теща чи свекруха');
      if (M.up === 0 && M.down === 1) return yours(p, 'пасинок', 'падчерка');
      if (M.up === 1 && M.down === 1) return wife ? yours(p, 'шурин', 'своячка') : sp.sex === 'm' ? yours(p, 'дівер', 'зовиця') : yours(p, 'родич через шлюб', 'родичка через шлюб');
      return yours(p, 'родич через шлюб', 'родичка через шлюб');
    }
    // the child of a parent's partner
    var parents = Object.keys(ancestorsOf(d, homeId)).filter(function (x) { return x !== homeId; });
    var step = parents.some(function (x) {
      return famsOf(d, x).some(function (f) { var o = other(f, x); return o && parents.indexOf(o) < 0 && f.kids.some(function (k) { return k.id === pid; }); });
    });
    if (step) return yours(p, 'зведений брат', 'зведена сестра');
    return connected(d, homeId)[pid] ? yours(p, 'родич через шлюб', 'родичка через шлюб') : '';
  }
  function connected(d, from) {
    var seen = {}, q = [from];
    seen[from] = 1;
    while (q.length) relatedIds(d, q.shift()).forEach(function (x) { if (!seen[x]) { seen[x] = 1; q.push(x); } });
    return seen;
  }

  /* ------------------------------------------------------------ data checks
     checkTree(d) → { [personId]: [{ level: 'error'|'warn', text }] }: dates that can't be right
     (death before birth, a child born before a parent or after a mother's death), ages that are
     unlikely, possible duplicates and people not connected to the rest of the tree. */
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    return n + ' ' + (a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many);
  }
  // народився / народилася → народився(лася) when the sex isn't known
  function vf(p, m, f) {
    if (p.sex === 'f') return f;
    if (p.sex === 'm') return m;
    var i = 0; while (i < m.length && m[i] === f[i]) i++;
    return m + '(' + f.slice(i) + ')';
  }
  // Earliest and latest day a date can mean, as yyyymmdd numbers.
  function span(v) {
    var r = parseDate(v), raw = readDate(v);
    if (!r) return null;
    // an approximate or free-text year could be a few years either way
    if (raw.approx || raw.free) return { lo: (r.y - 5) * 10000 + 101, hi: (r.y + 5) * 10000 + 1231, y: r.y };
    if (r.d) { var k = r.y * 10000 + r.m * 100 + r.d; return { lo: k, hi: k, y: r.y }; }
    if (r.m) return { lo: r.y * 10000 + r.m * 100 + 1, hi: r.y * 10000 + r.m * 100 + 31, y: r.y };
    return { lo: r.y * 10000 + 101, hi: r.y * 10000 + 1231, y: r.y };
  }
  function addMonths(k, n) {
    var y = Math.floor(k / 10000), m = Math.floor(k / 100) % 100 + n, dd = k % 100;
    y += Math.floor((m - 1) / 12); m = (m - 1) % 12 + 1;
    return y * 10000 + m * 100 + dd;
  }
  function checkTree(d) {
    var out = {}, now = new Date().getFullYear();
    var add = function (id, level, text) { (out[id] = out[id] || []).push({ level: level, text: text }); };
    var ids = Object.keys(d.people);
    ids.forEach(function (id) {
      var p = d.people[id], b = span(p.birth && p.birth.date), dd = span(deathDate(p));
      var dp = dateProblem(p);
      if (dp) add(id, 'error', dp);
      else if (b && dd && dd.y - b.y > 110) add(id, 'warn', vf(p, 'Прожив', 'Прожила') + ' ' + plural(dd.y - b.y, 'рік', 'роки', 'років') + ' — перевірте дати.');
      if (b && !p.deceased && now - b.y > 105) add(id, 'warn', vf(p, 'Народився', 'Народилася') + ' ' + b.y + ' року, а позначки про смерть немає.');
      // against each parent
      parentFams(d, id).forEach(function (f) {
        var k = f.kids.find(function (q) { return q.id === id; });
        [[f.a, k.ra], [f.b, k.rb]].forEach(function (pr) {
          var x = d.people[pr[0]];
          if (!x || !b) return;
          var mom = x.sex === 'f', who = x.sex === 'm' ? 'батька' : mom ? 'матері' : 'одного з батьків', whom = mom ? 'матір' : who, whoTo = x.sex === 'm' ? 'батькові' : mom ? 'матері' : 'одному з батьків';
          var xb = span(x.birth && x.birth.date), xd = span(deathDate(x)), born = vf(p, 'народився', 'народилася');
          if (xb && b.hi < xb.lo) { add(id, 'error', cap(born) + ' раніше за ' + whom + ' — ' + nameOf(x) + ' (' + xb.y + ').'); return; }
          if (xb && b.lo > xb.hi) {
            var age = b.y - xb.y;
            if (age < 13) add(id, 'warn', 'Коли ' + (p.sex === 'm' ? 'він ' + born : p.sex === 'f' ? 'вона ' + born : 'ця дитина народилася') + ', ' + whoTo + ' було ' + plural(age, 'рік', 'роки', 'років') + ' (' + nameOf(x) + ').');
            else if (pr[1] === 'bio' && ((mom && age > 55) || (!mom && age > 80))) add(id, 'warn', 'Коли ' + (p.sex === 'm' ? 'він ' + born : p.sex === 'f' ? 'вона ' + born : 'ця дитина народилася') + ', ' + whoTo + ' було ' + plural(age, 'рік', 'роки', 'років') + ' (' + nameOf(x) + ').');
          }
          if (pr[1] === 'bio' && xd) {
            if (mom && b.lo > xd.hi) add(id, 'error', cap(born) + ' після смерті матері — ' + nameOf(x) + ' (' + xd.y + ').');
            else if (!mom && b.lo > addMonths(xd.hi, 10)) add(id, 'error', cap(born) + ' більш ніж через 10 місяців після смерті ' + who + ' — ' + nameOf(x) + ' (' + xd.y + ').');
          }
        });
      });
    });
    // unions
    d.families.forEach(function (f) {
      var a = d.people[f.a], c = f.b && d.people[f.b];
      if (!a || !c) return;
      var st = span(f.start), en = span(f.end), pair = nameOf(a) + ' і ' + nameOf(c) + ': ';
      var both = function (level, text) { add(a.id, level, text); add(c.id, level, text); };
      if (st && en && en.hi < st.lo) both('error', pair + 'кінець стосунків (' + en.y + ') раніше за початок (' + st.y + ').');
      if (st) [a, c].forEach(function (x) {
        var xb = span(x.birth && x.birth.date), xd = span(deathDate(x));
        if (xb && st.y - xb.y < 14) both(st.y < xb.y ? 'error' : 'warn', pair + 'стосунки почалися ' + st.y + ' року, ' + (st.y < xb.y ? 'ще до того, як ' + vf(x, 'народився', 'народилася') + ' ' + nameOf(x) + ' (' + xb.y + ')' : 'коли ' + vf(x, 'одному', 'одній') + ' з них було ' + plural(st.y - xb.y, 'рік', 'роки', 'років') + ' (' + nameOf(x) + ')') + '.');
        if (xd && st.lo > xd.hi) both('error', pair + 'стосунки почалися ' + st.y + ' року, вже після того, як ' + nameOf(x) + ' ' + vf(x, 'помер', 'померла') + ' (' + xd.y + ').');
      });
    });
    // possible duplicates: the same name, and the same birth year or none for both
    var byName = {};
    ids.forEach(function (id) {
      var p = d.people[id];
      if (!p.given || !p.surname) return;
      var key = (p.given + ' ' + p.surname).toLowerCase().replace(/\s+/g, ' ').trim();
      (byName[key] = byName[key] || []).push(id);
    });
    Object.keys(byName).forEach(function (key) {
      var g = byName[key];
      for (var i = 0; i < g.length; i++) for (var j = i + 1; j < g.length; j++) {
        var x = d.people[g[i]], y = d.people[g[j]], yx = yearOf(x.birth && x.birth.date), yy = yearOf(y.birth && y.birth.date);
        if (yx !== yy) continue;
        add(x.id, 'warn', 'Можливо, це та сама людина, що й ' + nameOf(y) + ' (' + yearsOf(y).replace('Дати', 'дати') + ').');
        add(y.id, 'warn', 'Можливо, це та сама людина, що й ' + nameOf(x) + ' (' + yearsOf(x).replace('Дати', 'дати') + ').');
      }
    });
    // not connected to the home person
    if (d.rootId && d.people[d.rootId] && ids.length > 1) {
      var seen = connected(d, d.rootId);
      ids.forEach(function (id) { if (!seen[id]) add(id, 'warn', vf(d.people[id], 'Не пов’язаний', 'Не пов’язана') + ' з головною особою — жодного зв’язку з рештою дерева.'); });
    }
    return out;
  }
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

  /* ------------------------------------------------------------ tree layout
     Person-centred "hourglass", recomputed per selection:
       row −1  focus's primary parent couple, each parent's other partners outside them,
               one child group per family hanging under its couple (half-siblings included)
       row  0  focus as a full unit (partners + descendants); siblings as single cards
               (or full units when opt.sibFamilies)
       row ≥1  descendants, recursively
       row ≤−2 pedigree blocks centred over each parent, pushed apart if they collide
     Widths are computed bottom-up, so cards never overlap. Each person is drawn once.

     layoutTree(data, focusId, dims, { upGen, downGen, sibFamilies, ghosts }) → {
       nodes:  { [personId]: { x, y, row } }        top-left of each card, world px
       segs:   [{ k:'h'|'v', x, y, w, h, style:'solid'|'dashed'|'dotted', tone:''|'muted'|'hl' }]
       labels: [{ x, y, text, cls }]                union pills, centred on (x, y)
       tags:   [{ x, y, text }]                     'adopted' | 'step' | 'foster' beside child lines
       ghosts: [{ x, y, label }]                    "Add parent" placeholder slots
       hidden: { [personId]: n }                    relatives of that card not drawn ("+n")
       bounds: { minX, minY, maxX, maxY } | null
     }                                                                                   */
  function layoutTree(data, focusId, D, opt) {
    var P = data.people, ALL_GEN = 99;
    var out = { nodes: {}, segs: [], labels: [], tags: [], ghosts: [], hidden: {}, bounds: null };
    if (!focusId || !P[focusId]) return out;
    var placed = {};
    var has = function (id) { return !!placed[id]; };
    var put = function (id) { placed[id] = true; };
    var rowY = function (r) { return r * (D.ch + D.rg); };
    var fams = function (id) { return sortFams(famsOf(data, id)); };
    var unionLabel = function (f, owner) {
      var list = owner ? fams(owner).filter(function (x) { var o = other(x, owner); return o && P[o]; }) : [];
      return list.length > 1 ? unionNumbered(f, list.indexOf(f) + 1) : unionShort(f);
    };
    var hlFam = function (f) { return f.a === focusId || f.b === focusId; };
    var H = function (x1, x2, y, style, tone) { if (Math.abs(x2 - x1) < 0.5) return; out.segs.push({ k: 'h', x: Math.min(x1, x2), y: y, w: Math.abs(x2 - x1), h: 0, style: style, tone: tone }); };
    var V = function (x, y1, y2, style, tone) { if (Math.abs(y2 - y1) < 0.5) return; out.segs.push({ k: 'v', x: x, y: Math.min(y1, y2), w: 0, h: Math.abs(y2 - y1), style: style, tone: tone }); };

    // row: [{ pid, fam?, owner? }] partners row · specs: [{ fam, owner, kids:[{ kid, rel, sub }] }]
    function compose(row, specs) {
      var stepX = D.cw + D.cg;
      var PW = row.length * D.cw + (row.length - 1) * D.cg;
      var gs = specs.filter(function (g) { return g && g.kids.length; });
      gs.forEach(function (g) { g.w = g.kids.reduce(function (a, k) { return a + k.sub.w; }, 0) + D.sg * (g.kids.length - 1); });
      var KW = gs.length ? gs.reduce(function (a, g) { return a + g.w; }, 0) + D.gg * (gs.length - 1) : 0;
      var W = Math.max(PW, KW), px0 = (W - PW) / 2, pos = {}, unions = [], src = {};
      var persons = row.map(function (r, i) { pos[r.pid] = px0 + i * stepX; return { pid: r.pid, x: px0 + i * stepX }; });
      row.forEach(function (r, i) {
        if (!r.fam) return;
        var oi = row.findIndex(function (q) { return q.pid === r.owner; });
        if (oi < 0) return;
        var lo = Math.min(i, oi), hi = Math.max(i, oi);
        if (hi - lo === 1) {
          var xL = px0 + lo * stepX + D.cw, xR = px0 + hi * stepX;
          unions.push({ fam: r.fam, owner: r.owner, adj: true, xL: xL, xR: xR, mid: (xL + xR) / 2 });
          src[r.fam.id] = { x: (xL + xR) / 2, from: 'union' };
        } else {   // third+ partner: bracket above the row, children drop from that partner
          var x1 = px0 + oi * stepX + D.cw / 2 + (i > oi ? 28 : -28), x2 = px0 + i * stepX + D.cw / 2;
          unions.push({ fam: r.fam, owner: r.owner, adj: false, x1: x1, x2: x2 });
          src[r.fam.id] = { x: x2, from: 'bottom' };
        }
      });
      // Each child group is centred under the point its line drops from (the couple's midpoint,
      // or a lone parent), so the drop meets the middle of its bus and an only child hangs
      // straight down. Groups keep their order and move right only as far as needed to keep
      // the gap from the previous groups, compared row by row (each unit's `rows` contour),
      // so empty space in another generation doesn't push a group off-centre.
      var rows = { 0: [px0, px0 + PW] };
      var grow = function (r, d, mn, mx) { r[d] = r[d] ? [Math.min(r[d][0], mn), Math.max(r[d][1], mx)] : [mn, mx]; };
      var placed = [], prevRows = {};
      gs.forEach(function (g) {
        var s = src[g.fam.id] || { x: (pos[g.owner] != null ? pos[g.owner] : px0) + D.cw / 2, from: 'bottom' };
        var off = 0, rel = g.kids.map(function (k) { var o = off; off += k.sub.w + D.sg; return o; });
        var gRows = {};
        g.kids.forEach(function (k, i) { Object.keys(k.sub.rows).forEach(function (d) { grow(gRows, +d + 1, rel[i] + k.sub.rows[d][0], rel[i] + k.sub.rows[d][1]); }); });
        var last = g.kids.length - 1, mid = (rel[0] + g.kids[0].sub.ax + rel[last] + g.kids[last].sub.ax) / 2;
        var left = s.x - mid;
        Object.keys(gRows).forEach(function (d) { if (prevRows[d] != null) left = Math.max(left, prevRows[d] + D.gg - gRows[d][0]); });
        Object.keys(gRows).forEach(function (d) {
          prevRows[d] = Math.max(prevRows[d] == null ? -Infinity : prevRows[d], left + gRows[d][1]);
          grow(rows, +d, left + gRows[d][0], left + gRows[d][1]);
        });
        placed.push({ g: g, s: s, left: left, rel: rel });
      });
      // grow the unit to hold groups that reach past either edge
      var minX = 0, maxX = W;
      Object.keys(rows).forEach(function (d) { minX = Math.min(minX, rows[d][0]); maxX = Math.max(maxX, rows[d][1]); });
      if (minX < 0) {
        var sh = -minX;
        persons.forEach(function (q) { q.x += sh; });
        Object.keys(pos).forEach(function (k) { pos[k] += sh; });
        unions.forEach(function (un) { ['xL', 'xR', 'mid', 'x1', 'x2'].forEach(function (k) { if (un[k] != null) un[k] += sh; }); });
        Object.keys(rows).forEach(function (d) { rows[d] = [rows[d][0] + sh, rows[d][1] + sh]; });
      }
      var groups = placed.map(function (q) {
        return {
          fam: q.g.fam, src: { x: q.s.x - minX, from: q.s.from },
          kids: q.g.kids.map(function (k, i) { return { sub: k.sub, x: q.left - minX + q.rel[i], rel: k.rel, kid: k.kid }; })
        };
      });
      return { w: maxX - minX, persons: persons, unions: unions, groups: groups, pos: pos, rows: rows, ax: D.cw / 2 };
    }
    function kidsOf(f, depth) {
      var res = [];
      f.kids.forEach(function (k) { if (!P[k.id] || has(k.id)) return; res.push({ kid: k.id, rel: kidRel(f, k), sub: personUnit(k.id, depth, true) }); });
      return res;
    }
    function personUnit(pid, depth, full) {
      put(pid);
      if (!full) return compose([{ pid: pid }], []);
      var fs = fams(pid), withP = [];
      fs.forEach(function (f) { var o = other(f, pid); if (o && P[o] && !has(o)) { withP.push(f); put(o); } });
      var solo = fs.filter(function (f) { return withP.indexOf(f) < 0; });
      var left = withP.length >= 2 ? [withP[0]] : [];
      var right = withP.length >= 2 ? withP.slice(1) : withP;
      var row = left.map(function (f) { return { pid: other(f, pid), fam: f, owner: pid }; })
        .concat([{ pid: pid }], right.map(function (f) { return { pid: other(f, pid), fam: f, owner: pid }; }));
      // A partner at either end of the row brings their own other families along on the outside, so
      // a spouse's earlier marriage is drawn too: Надія — Володимир — Ніна — Володимир.
      var outer = function (f) {
        var o = other(f, pid), cells = [], groups = [];
        fams(o).forEach(function (g) {
          if (g.id === f.id) return;
          var q = other(g, o);
          if (q && P[q]) { if (has(q)) return; put(q); cells.push({ pid: q, fam: g, owner: o }); }
          if (depth > 0) groups.push({ fam: g, owner: o, kids: kidsOf(g, depth - 1) });
        });
        return { cells: cells, groups: groups };
      };
      var oL = left.length ? outer(left[0]) : { cells: [], groups: [] };
      var oR = right.length ? outer(right[right.length - 1]) : { cells: [], groups: [] };
      row = oL.cells.slice().reverse().concat(row, oR.cells);
      var specs = oL.groups.slice().reverse();
      if (depth > 0) left.concat(solo, right).forEach(function (f) { specs.push({ fam: f, owner: pid, kids: kidsOf(f, depth - 1) }); });
      specs = specs.concat(oR.groups);
      var u = compose(row, specs);
      u.ax = u.pos[pid] + D.cw / 2;
      return u;
    }
    function flatten(u, left, row) {
      var y = rowY(row);
      u.persons.forEach(function (p) { out.nodes[p.pid] = { x: left + p.x, y: y, row: row }; });
      u.unions.forEach(function (un) {
        var st = unionStyle(un.fam), hl = hlFam(un.fam), tone = hl ? 'hl' : st.tone, text = unionLabel(un.fam, un.owner);
        var cls = (un.fam.type === 'divorced' ? 'is-divorced' : '') + (hl ? ' is-hl' : '');
        if (un.adj) {
          H(left + un.xL, left + un.xR, y + D.ch / 2, st.style, tone);
          if (text) out.labels.push({ x: left + un.mid, y: y + D.ch / 2, text: text, cls: cls });
        } else {
          var ty = y - 16;
          V(left + un.x1, ty, y, st.style, tone); H(left + un.x1, left + un.x2, ty, st.style, tone); V(left + un.x2, ty, y, st.style, tone);
          if (text) out.labels.push({ x: left + (un.x1 + un.x2) / 2, y: ty, text: text, cls: cls });
        }
      });
      var ng = u.groups.length;
      u.groups.forEach(function (g, gi) {
        var frac = ng > 1 ? 0.3 + 0.4 * gi / (ng - 1) : 0.5;   // two groups never share a bus
        var busY = y + D.ch + D.rg * frac;
        var sx = left + g.src.x, sy = g.src.from === 'union' ? y + D.ch / 2 : y + D.ch;
        var hl = hlFam(g.fam), tone = hl ? 'hl' : '';
        var kxs = g.kids.map(function (k) { return left + k.x + k.sub.ax; });
        // the chosen person's own line runs all the way up to their parents
        var fi = g.kids.findIndex(function (k) { return k.kid === focusId; });
        V(sx, sy, busY, 'solid', hl || fi >= 0 ? 'hl' : '');
        H(Math.min.apply(null, [sx].concat(kxs)), Math.max.apply(null, [sx].concat(kxs)), busY, 'solid', tone);
        if (!hl && fi >= 0) H(sx, kxs[fi], busY, 'solid', 'hl');
        var ny = rowY(row + 1);
        g.kids.forEach(function (k, i) {
          V(kxs[i], busY, ny, relStyle(k.rel), hl || k.kid === focusId ? 'hl' : '');
          if (k.rel !== 'bio') out.tags.push({ x: kxs[i] + 7, y: ny - 14, text: relTag(k.rel), rel: k.rel });
          flatten(k.sub, left + k.x, row + 1);
        });
      });
    }
    // Pedigree block for the ancestors of pid (pid itself at row 0, not included in items).
    // With side branches on, an ancestor who married someone else too gets room for that partner
    // beside them, on the outer side (`side`: -1 left parent, 1 right parent), away from the couple.
    function ped(pid, depth, side, via) {
      var blk = pedBlock(pid, depth);
      if (!opt.collateral || !side) return blk;
      var more = fams(pid).some(function (g) { var o = other(g, pid); return g.id !== via && o && P[o] && !has(o); });
      if (!more) return blk;
      var room = D.cw + D.cg;
      if (side > 0) { blk.w = Math.max(blk.w, blk.cx + D.cw / 2 + room); return blk; }
      var d = room - (blk.cx - D.cw / 2);
      if (d <= 0) return blk;
      return {
        w: blk.w + d, cx: blk.cx + d,
        items: blk.items.map(function (it) { return { pid: it.pid, x: it.x + d, row: it.row }; }),
        links: blk.links.map(function (l) { return { fam: l.fam, rel: l.rel, ax: l.ax + d, bx: l.bx == null ? null : l.bx + d, cx: l.cx + d, row: l.row }; })
      };
    }
    function pedBlock(pid, depth) {
      var leaf = { w: D.cw, cx: D.cw / 2, items: [], links: [] };
      if (depth <= 0) return leaf;
      var f = primaryParentFam(data, pid);
      if (!f) return leaf;
      var a = f.a && P[f.a] && !has(f.a) ? f.a : null, b = f.b && P[f.b] && !has(f.b) ? f.b : null;
      if (!a && !b) return leaf;
      if (a) put(a);
      if (b) put(b);
      var rel = kidRel(f, f.kids.find(function (q) { return q.id === pid; }));
      var ba = a ? ped(a, depth - 1, -1, f.id) : null, bb = b ? ped(b, depth - 1, 1, f.id) : null;
      var shI = function (blk, dx) { return blk.items.map(function (it) { return { pid: it.pid, x: it.x + dx, row: it.row - 1 }; }); };
      var shL = function (blk, dx) { return blk.links.map(function (l) { return { fam: l.fam, rel: l.rel, ax: l.ax + dx, bx: l.bx == null ? null : l.bx + dx, cx: l.cx + dx, row: l.row - 1 }; }); };
      if (ba && bb) {
        var gap = Math.max(D.gg, D.cw + D.cg - (ba.w - ba.cx) - bb.cx);
        var ob = ba.w + gap, ax = ba.cx, bx = ob + bb.cx;
        return {
          w: ob + bb.w, cx: (ax + bx) / 2,
          items: shI(ba, 0).concat(shI(bb, ob), [{ pid: a, x: ax, row: -1 }, { pid: b, x: bx, row: -1 }]),
          links: shL(ba, 0).concat(shL(bb, ob), [{ fam: f, rel: rel, ax: ax, bx: bx, cx: (ax + bx) / 2, row: -1 }])
        };
      }
      var bs = ba || bb, who = a || b;
      return { w: bs.w, cx: bs.cx, items: shI(bs, 0).concat([{ pid: who, x: bs.cx, row: -1 }]), links: shL(bs, 0).concat([{ fam: f, rel: rel, ax: bs.cx, bx: null, cx: bs.cx, row: -1 }]) };
    }
    function placePed(bl, baseRow) {
      bl.b.items.forEach(function (it) { out.nodes[it.pid] = { x: it.x + bl.shift - D.cw / 2, y: rowY(baseRow + it.row), row: baseRow + it.row }; });
      bl.b.links.forEach(function (l) {
        var r = baseRow + l.row, y = rowY(r);
        var ax = l.ax + bl.shift, bx = l.bx == null ? null : l.bx + bl.shift;
        var cx = l.row === -1 ? out.nodes[bl.pid].x + D.cw / 2 : l.cx + bl.shift;
        var sx, sy;
        if (bx != null) {
          var st = unionStyle(l.fam), text = unionShort(l.fam);
          H(ax + D.cw / 2, bx - D.cw / 2, y + D.ch / 2, st.style, st.tone);
          sx = (ax + bx) / 2; sy = y + D.ch / 2;
          if (text) out.labels.push({ x: sx, y: sy, text: text, cls: l.fam.type === 'divorced' ? 'is-divorced' : '' });
        } else { sx = ax; sy = y + D.ch; }
        var busY = y + D.ch + D.rg / 2;
        V(sx, sy, busY, 'solid', '');
        H(Math.min(sx, cx), Math.max(sx, cx), busY, 'solid', '');
        V(cx, busY, rowY(r + 1), relStyle(l.rel), '');
        if (l.rel !== 'bio') out.tags.push({ x: cx + 7, y: rowY(r + 1) - 14, text: relTag(l.rel), rel: l.rel });
      });
    }

    // "Show everyone": each ancestor couple's other children (aunts, uncles, great-aunts…) come too, with
    // their partners and descendants, laid out to the outside of the tree on that side. Closest
    // generation first, so nearer relatives sit nearer the middle.
    function addCollaterals(bl, baseRow, side) {
      // the first free x on this side for a unit whose top row is `top`
      var spot = function (u, top, near) {
        var ext = {};
        Object.keys(out.nodes).forEach(function (id) {
          var n = out.nodes[id], e = ext[n.row];
          ext[n.row] = e ? [Math.min(e[0], n.x), Math.max(e[1], n.x + D.cw)] : [n.x, n.x + D.cw];
        });
        var left = null;
        Object.keys(u.rows).forEach(function (dd) {
          var e = ext[top + +dd]; if (!e) return;
          var c = side < 0 ? e[0] - D.gg - u.rows[dd][1] : e[1] + D.gg - u.rows[dd][0];
          left = left == null ? c : side < 0 ? Math.min(left, c) : Math.max(left, c);
        });
        return left != null ? left : side < 0 ? near - D.gg - u.w : near + D.gg;
      };
      // a card-sized spot at x on row r, a group gap clear of every card there
      var free = function (x, r) {
        return !Object.keys(out.nodes).some(function (id) { var n = out.nodes[id]; return n.row === r && n.x < x + D.cw + D.gg && n.x + D.cw > x - D.gg; });
      };
      var lanes = {};
      var links = bl.b.links.slice().sort(function (x, y) { return y.row - x.row; });
      links.forEach(function (l) {
        var f = l.fam, r = baseRow + l.row;
        var na = f.a && out.nodes[f.a], nb = f.b && out.nodes[f.b];
        if (!na && !nb) return;
        var sx = na && nb ? (na.x + nb.x) / 2 + D.cw / 2 : (na || nb).x + D.cw / 2;
        var busY = rowY(r) + D.ch + D.rg / 2;
        f.kids.filter(function (k) { return P[k.id] && !has(k.id); }).forEach(function (k) {
          var u = personUnit(k.id, ALL_GEN, true), left = spot(u, r + 1, sx);
          flatten(u, left, r + 1);
          var kx = left + u.ax, rel = kidRel(f, k);
          H(sx, kx, busY, 'solid', '');
          V(kx, busY, rowY(r + 1), relStyle(rel), '');
          if (rel !== 'bio') out.tags.push({ x: kx + 7, y: rowY(r + 1) - 14, text: relTag(rel), rel: rel });
        });
        // the couple's other marriages, each partner on their own outer side
        if (na) others(f.a, f.id, r, nb ? -1 : side);
        if (nb) others(f.b, f.id, r, na ? 1 : side);
      });
      // x's marriages other than `skip`: the first partner right beside x (ped kept that spot free), joined
      // by an ordinary marriage line, their children (half-siblings of the line) from between them.
      // A partner who can't sit beside x goes to the outside, joined by a line over the cards.
      function others(x, skip, r, dir) {
        var y = rowY(r), beside = true;
        fams(x).forEach(function (g) {
          if (g.id === skip) return;
          var o = other(g, x), nx = out.nodes[x].x, xc = nx + D.cw / 2;
          var st = unionStyle(g), text = unionShort(g), cls = g.type === 'divorced' ? 'is-divorced' : '';
          if (!(o && P[o] && !has(o))) { hang(g, xc, y + D.ch, r); return; }   // no other partner, or already drawn
          var ox = dir < 0 ? nx - D.cg - D.cw : nx + D.cw + D.cg;
          if (beside && free(ox, r)) {
            beside = false;
            put(o);
            out.nodes[o] = { x: ox, y: y, row: r };
            var xl = Math.min(nx, ox) + D.cw, xr = Math.max(nx, ox), mid = (xl + xr) / 2;
            H(xl, xr, y + D.ch / 2, st.style, st.tone);
            if (text) out.labels.push({ x: mid, y: y + D.ch / 2, text: text, cls: cls });
            hang(g, mid, y + D.ch / 2, r);
            others(o, g.id, r, dir);
            return;
          }
          var u = personUnit(o, ALL_GEN, true), left = spot(u, r, xc);
          flatten(u, left, r);
          var oc = out.nodes[o].x + D.cw / 2, ty = y - 8 - 8 * Math.min(3, lanes[r] = (lanes[r] || 0) + 1);   // each bracket its own height
          V(xc, ty, y, st.style, st.tone); H(xc, oc, ty, st.style, st.tone); V(oc, ty, y, st.style, st.tone);
          if (text) out.labels.push({ x: (xc + oc) / 2, y: ty, text: text, cls: cls });
        });
      }
      // g's children not drawn yet, to the outside, on a bus of their own from (sx, sy)
      function hang(g, sx, sy, r) {
        var by = rowY(r) + D.ch + D.rg * 0.7;
        g.kids.filter(function (k) { return P[k.id] && !has(k.id); }).forEach(function (k) {
          var ku = personUnit(k.id, ALL_GEN, true), kl = spot(ku, r + 1, sx);
          flatten(ku, kl, r + 1);
          var kx = kl + ku.ax, rel = kidRel(g, k);
          V(sx, sy, by, 'solid', ''); H(sx, kx, by, 'solid', ''); V(kx, by, rowY(r + 1), relStyle(rel), '');
          if (rel !== 'bio') out.tags.push({ x: kx + 7, y: rowY(r + 1) - 14, text: relTag(rel), rel: rel });
        });
      }
    }

    var pf = opt.upGen > 0 ? primaryParentFam(data, focusId) : null;
    if (pf && P[pf.a]) {
      var P1 = pf.a, P2 = pf.b && P[pf.b] ? pf.b : null;
      put(focusId); put(P1); if (P2) put(P2);
      var o1 = fams(P1).filter(function (f) { return f.id !== pf.id; });
      var o2 = P2 ? fams(P2).filter(function (f) { return f.id !== pf.id; }) : [];
      var o1p = [], o2p = [];
      o1.forEach(function (f) { var o = other(f, P1); if (o && P[o] && !has(o)) { o1p.push(f); put(o); } });
      o2.forEach(function (f) { var o = other(f, P2); if (o && P[o] && !has(o)) { o2p.push(f); put(o); } });
      var o1s = o1.filter(function (f) { return o1p.indexOf(f) < 0; }), o2s = o2.filter(function (f) { return o2p.indexOf(f) < 0; });
      var row = o1p.map(function (f) { return { pid: other(f, P1), fam: f, owner: P1 }; })
        .concat([{ pid: P1 }], P2 ? [{ pid: P2, fam: pf, owner: P1 }] : [], o2p.map(function (f) { return { pid: other(f, P2), fam: f, owner: P2 }; }));
      var focusDone = false;
      var sibKids = function (f) {
        var res = [];
        f.kids.forEach(function (k) {
          if (!P[k.id]) return;
          if (k.id === focusId) {
            if (focusDone) return;
            focusDone = true;
            res.push({ kid: k.id, rel: kidRel(f, k), sub: personUnit(focusId, opt.downGen, true) });
            return;
          }
          if (has(k.id)) return;
          res.push({ kid: k.id, rel: kidRel(f, k), sub: personUnit(k.id, opt.sibFamilies ? opt.downGen : 0, !!opt.sibFamilies) });
        });
        return res;
      };
      var specMap = {};
      specMap[pf.id] = { fam: pf, owner: P1, kids: sibKids(pf) };   // focus's own family first
      o1p.concat(o1s).forEach(function (f) { specMap[f.id] = { fam: f, owner: P1, kids: sibKids(f) }; });
      o2s.concat(o2p).forEach(function (f) { specMap[f.id] = { fam: f, owner: P2, kids: sibKids(f) }; });
      var u = compose(row, o1p.concat(o1s, [pf], o2s, o2p).map(function (f) { return specMap[f.id]; }));
      flatten(u, 0, -1);
      var blocks = [];
      [P1, P2].forEach(function (pid) {
        if (!pid || opt.upGen < 2) return;
        var b = ped(pid, opt.upGen - 1);
        if (!b.items.length) return;
        blocks.push({ pid: pid, b: b, shift: out.nodes[pid].x + D.cw / 2 - b.cx });
      });
      if (blocks.length === 2) {
        var ext = function (bl) {
          if (opt.collateral) return [bl.shift, bl.shift + bl.b.w];   // includes the room kept for other partners
          var mn = Infinity, mx = -Infinity;
          bl.b.items.forEach(function (it) { mn = Math.min(mn, it.x - D.cw / 2); mx = Math.max(mx, it.x + D.cw / 2); });
          return [mn + bl.shift, mx + bl.shift];
        };
        var e0 = ext(blocks[0]), e1 = ext(blocks[1]), need = e0[1] + D.gg - e1[0];
        if (need > 0) { blocks[0].shift -= need / 2; blocks[1].shift += need / 2; }
      }
      blocks.forEach(function (bl) { placePed(bl, -1); });
      if (opt.collateral) blocks.forEach(function (bl) { addCollaterals(bl, -1, bl.pid === P1 ? -1 : 1); });
      if (opt.ghosts && !P2) out.ghosts.push({ x: out.nodes[P1].x + D.cw + D.cg, y: rowY(-1), label: 'Додати другого з батьків' });
    } else {
      flatten(personUnit(focusId, opt.downGen, true), 0, 0);
      if (opt.ghosts) out.ghosts.push({ x: out.nodes[focusId].x, y: rowY(-1), label: 'Додати батька чи матір' });
    }
    Object.keys(out.nodes).forEach(function (id) { var n = 0; relatedIds(data, id).forEach(function (r) { if (!out.nodes[r]) n++; }); out.hidden[id] = n; });
    var bb2 = null;
    var grow = function (x, y) { if (!bb2) bb2 = { minX: x, minY: y, maxX: x + D.cw, maxY: y + D.ch }; else { bb2.minX = Math.min(bb2.minX, x); bb2.minY = Math.min(bb2.minY, y); bb2.maxX = Math.max(bb2.maxX, x + D.cw); bb2.maxY = Math.max(bb2.maxY, y + D.ch); } };
    Object.keys(out.nodes).forEach(function (id) { grow(out.nodes[id].x, out.nodes[id].y); });
    out.ghosts.forEach(function (g) { grow(g.x, g.y); });
    out.bounds = bb2;
    return out;
  }
  // CSS classes for one segment div: "is-h is-dashed is-muted"
  function segClass(g) { return 'is-' + g.k + (g.style !== 'solid' ? ' is-' + g.style : '') + (g.tone ? ' is-' + g.tone : ''); }

  var api = {
    DIMS: DIMS,
    famsOf: famsOf, parentFams: parentFams, primaryParentFam: primaryParentFam, other: other, yearOf: yearOf, sortFams: sortFams,
    kidRel: kidRel, relatedIds: relatedIds, lineOf: lineOf, vf: vf, hasLoop: hasLoop, unionStyle: unionStyle, relStyle: relStyle, unionShort: unionShort, unionLong: unionLong, unionNumbered: unionNumbered, relTag: relTag,
    nameOf: nameOf, givenOf: givenOf, caseName: caseName, setNameCase: setNameCase, initials: initials, yearsOf: yearsOf, fmtDate: fmtDate, parseDate: parseDate, readDate: readDate, normDate: normDate, dateProblem: dateProblem, ageBetween: ageBetween, searchText: searchText, matches: matches, fold: fold, byName: byName,
    siblingsOf: siblingsOf, alreadyLinked: alreadyLinked,
    newId: newId, insertKid: insertKid, splitName: splitName, removePerson: removePerson, detachPartner: detachPartner, detachParentLink: detachParentLink, tidyFamilies: tidyFamilies,
    parseMd: parseMd, mdSpans: mdSpans,
    kinship: kinship, checkTree: checkTree,
    layoutTree: layoutTree, segClass: segClass
  };
  root.FamilyEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
