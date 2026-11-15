/*
 * Family Archive — timeline engine («Хронологія»)
 * Pure functions that turn the app's data (window.FAMILY_DATA) into everything the
 * timeline page draws: row order for both tabs (Гілки, Покоління), bars and markers,
 * lines of descent, relation words, label placement that never overlaps, the axis,
 * the hover count and the tooltip text. Ukrainian copy and grammar live here too.
 *
 * Classic script (no ES modules — those are blocked on file://).
 * In the browser:  <script src="timeline-engine.js"></script>  →  window.FamilyTimeline
 * In Node (tests): const FT = require('./timeline-engine.js')
 *
 * Ported from the prototype (reference/prototype/Timeline.dc.html), generalised from
 * its hard-coded sample to the real data model; see tests/timeline-engine.test.js.
 */
(function (root) {
  'use strict';

  /* ================================================================ constants */
  var UNKNOWN_SPAN = 85;   // an unknown end is drawn (hatched) up to birth + 85
  var LIVING_CAP = 110;    // not marked deceased but born more than 110 years ago → end unknown
  var GEO = {
    desktop: { L: 344, gutter: 24, pitch: 18, barH: 8, barTop: 5, bandH: 26, indent: 10, nameX0: 22, guideX0: 16, genNameX: 24 },
    phone:   { L: 12,  gutter: 12, pitch: 34, barH: 7, barTop: 23, bandH: 30, indent: 10, nameX0: 12, guideX0: 7,  genNameX: 12 }
  };

  /* ================================================================ Ukrainian text */
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 10, b = Math.abs(n) % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  }
  function yrs(n) { return n + ' ' + plural(n, 'рік', 'роки', 'років'); }
  function peopleCount(n) { return n + ' ' + plural(n, 'людина', 'людини', 'людей'); }
  function eventsCount(n) { return n + ' ' + plural(n, 'подія', 'події', 'подій'); }
  function roman(n) { var r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']; return r[n] || String(n); }
  // Gendered word: sex 'm' | 'f' | 'u' (unknown → neutral form when one exists, else masculine)
  function gw(sex, m, f, u) { return sex === 'f' ? f : sex === 'm' ? m : (u != null ? u : m); }

  // Genitive case of a Ukrainian given name ("мати Ганни", "син Федора").
  // Returns null for names it cannot decline (Latin script, empty) so callers can fall back.
  var GEN_EXCEPT = { 'Федір': 'Федора', 'Яків': 'Якова', 'Антін': 'Антона', 'Ігор': 'Ігоря', 'Лазар': 'Лазаря', 'Любов': 'Любові', 'Лев': 'Лева', 'Павло': 'Павла' };
  function genitive(name, sex) {
    var s = String(name || '').trim();
    if (!s || !/^[А-ЯІЇЄҐа-яіїєґ'’ʼ-]+$/.test(s)) return null;
    // a name typed in capitals stays in capitals: ЛІДІЯ → ЛІДІЇ
    if (s.length > 1 && s === s.toUpperCase()) { var g = genitive(s.charAt(0) + s.slice(1).toLowerCase(), sex); return g && g.toUpperCase(); }
    if (GEN_EXCEPT[s]) return GEN_EXCEPT[s];
    var low = s.toLowerCase(), last = low.slice(-1), prev = low.slice(-2, -1);
    if (low.slice(-2) === 'ія') return s.slice(0, -1) + 'ї';                 // Марія → Марії
    if (last === 'я') return s.slice(0, -1) + 'і';                          // Леся → Лесі, Ілля → Іллі
    if (last === 'а') return s.slice(0, -1) + ('жчшщ'.indexOf(prev) >= 0 ? 'і' : 'и');  // Ганна → Ганни, Наташа → Наташі
    if (last === 'о') return s.slice(0, -1) + 'а';                          // Петро → Петра
    if (last === 'й') return s.slice(0, -1) + 'я';                          // Андрій → Андрія
    if (last === 'ь') return s.slice(0, -1) + 'я';                          // Василь → Василя
    if (sex === 'f') return s + 'і';                                        // Любов-like feminine consonant stems
    return s + 'а';                                                         // Іван → Івана
  }

  /* ================================================================ dates */
  // Dates are free text in the app. We need a year and a qualifier:
  //   ''  exact     '~' about     '<' before     '>' after
  var Q_ABOUT = /^(бл\.?|близько|приблизно|прибл\.?|біля|~|≈|abt\.?|about|c\.|ca\.?|circa)\s*/i;
  var Q_BEFORE = /^(до|не пізніше|раніше|<|bef\.?|before)\s*/i;
  var Q_AFTER = /^(після|пізніше|не раніше|>|aft\.?|after)\s*/i;
  function parseDate(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    var q = '';
    if (Q_ABOUT.test(s)) q = '~'; else if (Q_BEFORE.test(s)) q = '<'; else if (Q_AFTER.test(s)) q = '>';
    if (/\?\s*$/.test(s) && !q) q = '~';
    var m = s.match(/(\d{4})/);
    if (!m) return null;
    return { y: Number(m[1]), q: q };
  }

  /* ================================================================ model */
  function other(f, id) { return f.a === id ? f.b : f.a; }
  function kidRelTo(f, k, parentId) { return parentId === f.a ? (k.ra || 'bio') : (k.rb || 'bio'); }
  function yearOfStr(v) { var d = parseDate(v); return d ? d.y : null; }

  /*
   * model(data, opts) → M. Build once per data change; everything else reads M.
   * opts.now        — current year (default: this year)
   * opts.lineRoots  — ids to start the Гілки outline from, in order (optional; see outline())
   */
  function model(data, opts) {
    opts = opts || {};
    var now = opts.now || new Date().getFullYear();
    var P = {}, ids = Object.keys(data.people || {});
    var fams = (data.families || []).filter(function (f) { return f && (f.a || f.b); });
    var parents = {}, kids = {}, unions = {};
    ids.forEach(function (id) { parents[id] = []; kids[id] = []; unions[id] = []; });
    fams.forEach(function (f) {
      [f.a, f.b].forEach(function (x) { if (x && unions[x]) unions[x].push(f); });
      (f.kids || []).forEach(function (k) {
        if (!parents[k.id]) return;
        [f.a, f.b].forEach(function (x) {
          if (!x || !kids[x]) return;
          var rel = kidRelTo(f, k, x);
          parents[k.id].push({ id: x, fam: f, rel: rel });
          kids[x].push({ id: k.id, fam: f, rel: rel });
        });
      });
    });
    // people with parsed years
    ids.forEach(function (id) {
      var p = data.people[id], b = parseDate(p.birth && p.birth.date), d = parseDate(p.death && p.death.date);
      var lk = parseDate(p.lastKnown);
      var x = { id: id, raw: p, given: (p.given || '').trim(), surname: (p.surname || '').trim(), birthName: (p.birthName || '').trim(),
        sex: p.sex === 'f' || p.sex === 'm' ? p.sex : 'u', photo: p.photo || '', b: b ? b.y : null, bq: b ? b.q : '', d: null, dq: '', last: lk ? lk.y : null };
      if (b && b.q === '<') x.bq = '~';                     // "до 1870" as a birth reads as approximate
      if (d && d.q !== '>') { x.d = d.y; x.dq = d.q; }
      if (d && d.q === '>') { x.last = Math.max(x.last || 0, d.y); }   // "після 1920" → alive in 1920, end unknown
      x.undated = x.b == null;
      x.deceased = !!p.deceased || x.d != null;
      x.living = !x.undated && !x.deceased && x.b >= now - LIVING_CAP;
      x.unknownEnd = !x.undated && !x.living && x.d == null;
      if (x.d != null && x.b != null && x.d < x.b) { x.d = null; x.dq = ''; x.unknownEnd = true; x.dataError = 'death-before-birth'; }
      P[id] = x;
    });
    var byB = function (a, b) { var A = P[a].b == null ? 9999 : P[a].b, B = P[b].b == null ? 9999 : P[b].b; return A - B || (a < b ? -1 : a > b ? 1 : 0); };
    var famKey = function (f) { return yearOfStr(f.start) || yearOfStr(f.end) || 9999; };
    ids.forEach(function (id) { kids[id].sort(function (a, b) { return byB(a.id, b.id); }); unions[id].sort(function (a, b) { return famKey(a) - famKey(b); }); });
    var M = { now: now, P: P, ids: ids, fams: fams, parents: parents, kids: kids, unions: unions, byBirth: byB, rootId: data.rootId || null };
    // events per person, then "last known alive" for unknown ends
    ids.forEach(function (id) { P[id].events = computeEvents(M, id); });
    ids.forEach(function (id) {
      var x = P[id];
      if (!x.unknownEnd) return;
      var ev = x.events.filter(function (e) { return e.y >= x.b; }).map(function (e) { return e.y; });
      x.last = Math.max.apply(null, [x.last || x.b, x.b].concat(ev));
      x.lastInferred = !(x.raw.lastKnown);
    });
    M.dated = ids.filter(function (id) { return !P[id].undated; }).sort(byB);
    M.undated = ids.filter(function (id) { return P[id].undated; }).sort(function (a, b) { return byName(P[a], P[b]); });
    M.outline = outline(M, opts.lineRoots);
    M.gen = generations(M);
    M.anchor = {}; M.outline.forEach(function (o) { M.anchor[o.id] = o; });
    return M;
  }

  function computeEvents(M, id) {
    var P = M.P, out = [];
    M.unions[id].forEach(function (f) {
      var o = other(f, id), s = yearOfStr(f.start), e = yearOfStr(f.end);
      if (s && f.type !== 'none') out.push({ y: s, k: f.type === 'partner' ? 'p' : 'm', who: o, fam: f });
      if (e && f.type === 'divorced') out.push({ y: e, k: 'div', who: o, fam: f });
    });
    M.kids[id].forEach(function (k) {
      var q = P[k.id];
      if (!q || q.undated) return;
      if (k.rel === 'step' || k.rel === 'foster') return;       // not this person's own birth or adoption event
      out.push({ y: q.b, k: k.rel === 'adopted' ? 'adopt' : 'kid', who: k.id, fam: k.fam });
    });
    return out.sort(function (a, b) { return a.y - b.y; });
  }

  /* ---------------------------------------------------------------- life arithmetic */
  function endY(M, p) { if (p.undated) return null; if (p.d != null) return p.d; return p.living ? M.now : null; }
  function softEnd(M, p) { var e = endY(M, p); return e != null ? e : Math.min(M.now, p.b + UNKNOWN_SPAN); }
  // 'yes' | 'maybe' | 'no' — unknown lives are never guessed: after the last known year they are "maybe"
  function alive(M, id, y) {
    var p = M.P[id];
    if (!p || p.undated || y < p.b) return 'no';
    var e = endY(M, p);
    if (e != null) return y <= e ? 'yes' : 'no';
    if (y <= (p.last || p.b)) return 'yes';
    return y <= Math.min(M.now, p.b + UNKNOWN_SPAN) ? 'maybe' : 'no';
  }
  function countAlive(M, y) {
    var yes = 0, maybe = 0;
    M.dated.forEach(function (id) { var a = alive(M, id, y); if (a === 'yes') yes++; else if (a === 'maybe') maybe++; });
    return { yes: yes, maybe: maybe };
  }
  function countText(M, y, withYear) {
    var c = countAlive(M, y);
    return (withYear ? y + ' · ' : '') + 'живі: ' + c.yes + (c.maybe ? ' · ще ' + c.maybe + ' — невідомо' : '');
  }
  function overlap(M, a, b) {
    var A = M.P[a], B = M.P[b];
    if (!A || !B || A.undated || B.undated) return 0;
    var ea = endY(M, A) != null ? endY(M, A) : (A.last || A.b), eb = endY(M, B) != null ? endY(M, B) : (B.last || B.b);
    return Math.max(0, Math.min(ea, eb) - Math.max(A.b, B.b));
  }

  /* ---------------------------------------------------------------- names and labels */
  function fullName(M, id) { var p = M.P[id]; if (!p) return ''; var n = [p.given, p.surname].filter(Boolean).join(' '); return n || 'Невідома особа'; }
  function initials(M, id) { var p = M.P[id]; if (!p || (!p.given && !p.surname)) return '?'; return ((p.given ? p.given[0] : '') + (p.surname ? p.surname[0] : '')).toUpperCase(); }
  function byName(a, b) { var x = ((a.surname || '~') + ' ' + (a.given || '~')).toLowerCase(), y = ((b.surname || '~') + ' ' + (b.given || '~')).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  // "бл. 1868 – до 1920" · "1871–1943" · "нар. 1953" · "1905 – ?" · "дати невідомі"
  function yearsLabel(M, id) {
    var p = M.P[id];
    if (p.undated) return p.d != null ? '? – ' + p.d : 'дати невідомі';
    var b = (p.bq === '~' ? 'бл. ' : '') + p.b;
    if (p.living) return 'нар. ' + b;
    if (p.d == null) return b + ' – ?';
    var d = (p.dq === '<' ? 'до ' : p.dq === '~' ? 'бл. ' : '') + p.d;
    return p.bq || p.dq ? b + ' – ' + d : b + '–' + d;
  }
  function lifeText(M, id) {
    var p = M.P[id];
    if (p.undated) return 'дати невідомі';
    if (p.living) return yrs(M.now - p.b);
    if (p.d == null) return 'рік смерті невідомий';
    return (p.bq || p.dq ? '≈ ' : '') + yrs(p.d - p.b);
  }

  /* ---------------------------------------------------------------- relations (Ukrainian) */
  function parentIds(M, id) { return M.parents[id].map(function (r) { return r.id; }); }
  function partnerFams(M, a, b) { return M.unions[a].filter(function (f) { return other(f, a) === b; }); }
  // How x is related to s, in one word or two: "дідусь", "колишня дружина", "двоюрідна сестра"; '' if not close kin.
  function relation(M, xid, sid) {
    if (!xid || !sid || xid === sid || !M.P[xid] || !M.P[sid]) return '';
    var x = M.P[xid], sx = x.sex, s = M.P[sid];
    var g = function (m, f, u) { return gw(sx, m, f, u); };
    // parent
    var pr = M.parents[sid].filter(function (r) { return r.id === xid; })[0];
    if (pr) {
      if (pr.rel === 'adopted') return g('названий батько', 'названа мати', 'названий з батьків');
      if (pr.rel === 'step') return g('вітчим', 'мачуха', 'вітчим чи мачуха');
      if (pr.rel === 'foster') return g('прийомний батько', 'прийомна мати', 'прийомний з батьків');
      return g('батько', 'мати', 'один із батьків');
    }
    // child
    var kr = M.kids[sid].filter(function (r) { return r.id === xid; })[0];
    if (kr) {
      if (kr.rel === 'adopted') return g('усиновлений син', 'усиновлена донька', 'усиновлена дитина');
      if (kr.rel === 'step') return g('пасинок', 'падчерка', 'дитина партнера');
      if (kr.rel === 'foster') return g('прийомний син', 'прийомна донька', 'прийомна дитина');
      return g('син', 'донька', 'дитина');
    }
    // partner
    var pf = partnerFams(M, sid, xid)[0];
    if (pf) {
      if (pf.type === 'divorced') return g('колишній чоловік', 'колишня дружина', 'колишнє подружжя');
      if (pf.type === 'partner') return g('партнер', 'партнерка', 'партнер');
      if (pf.type === 'none') return g('батько дитини', 'мати дитини', 'інший з батьків');
      return g('чоловік', 'дружина', 'подружжя');
    }
    // siblings: full, half (by father / by mother), step
    var ps = parentIds(M, sid), px = parentIds(M, xid);
    var bioOf = function (id) { return M.parents[id].filter(function (r) { return r.rel === 'bio' || r.rel === 'adopted'; }).map(function (r) { return r.id; }); };
    var bs = bioOf(sid), bx = bioOf(xid), shared = bs.filter(function (q) { return bx.indexOf(q) >= 0; });
    // half siblings only when both have two known parents and share exactly one
    if (shared.length && !(shared.length === 1 && bs.length === 2 && bx.length === 2)) return g('брат', 'сестра', 'брат чи сестра');
    if (shared.length === 1) {
      var via = M.P[shared[0]].sex;
      return g('брат', 'сестра', 'брат чи сестра') + (via === 'f' ? ' по матері' : via === 'm' ? ' по батькові' : ' (зведені)');
    }
    if (ps.some(function (q) { return px.indexOf(q) >= 0; })) return g('зведений брат', 'зведена сестра', 'зведені');
    // a parent's partner who is not a parent
    if (ps.some(function (q) { return M.unions[q].some(function (f) { return (f.type === 'married' || f.type === 'partner') && other(f, q) === xid; }); })) return g('вітчим', 'мачуха', 'партнер батька чи матері');
    // ancestors and descendants by bio/adoptive lines
    var up = function (id) { return M.parents[id].filter(function (r) { return r.rel === 'bio' || r.rel === 'adopted'; }).map(function (r) { return r.id; }); };
    var down = function (id) { return M.kids[id].filter(function (r) { return r.rel === 'bio' || r.rel === 'adopted'; }).map(function (r) { return r.id; }); };
    var levels = function (start, step, max) { var out = [], cur = [start]; for (var i = 1; i <= max; i++) { var nx = []; cur.forEach(function (c) { step(c).forEach(function (q) { if (nx.indexOf(q) < 0) nx.push(q); }); }); out.push(nx); cur = nx; } return out; };
    var anc = levels(sid, up, 6), des = levels(sid, down, 6);
    var pra = function (n) { var s2 = ''; for (var i = 0; i < n; i++) s2 += 'пра'; return s2; };
    for (var i = 1; i < 6; i++) {
      if (anc[i] && anc[i].indexOf(xid) >= 0) return pra(i - 1) + g('дідусь', 'бабуся', 'дідусь чи бабуся');
      if (des[i] && des[i].indexOf(xid) >= 0) return i === 1 ? g('онук', 'онука', 'онук чи онука') : pra(i - 1) + g('внук', 'внучка', 'внук чи внучка');   // онук, правнук, праправнук
    }
    // aunts/uncles, nephews/nieces, cousins
    var sibsOf = function (id) { var out = []; up(id).forEach(function (q) { down(q).forEach(function (k) { if (k !== id && out.indexOf(k) < 0) out.push(k); }); }); return out; };
    if (anc[0].some(function (a) { return sibsOf(a).indexOf(xid) >= 0; })) return g('дядько', 'тітка', 'дядько чи тітка');
    if (sibsOf(sid).some(function (b) { return down(b).indexOf(xid) >= 0; })) return g('племінник', 'племінниця', 'племінник чи племінниця');
    if (anc[1].some(function (a) { return sibsOf(a).indexOf(xid) >= 0; })) return g('двоюрідний дід', 'двоюрідна бабуся', 'двоюрідні дід чи бабуся');
    if (anc[0].some(function (a) { return sibsOf(a).some(function (u) { return down(u).indexOf(xid) >= 0; }); })) return g('двоюрідний брат', 'двоюрідна сестра', 'двоюрідний брат чи сестра');
    // in-laws
    var spouses = M.unions[sid].filter(function (f) { return f.type === 'married' || f.type === 'partner'; }).map(function (f) { return other(f, sid); }).filter(Boolean);
    if (spouses.some(function (sp) { return up(sp).indexOf(xid) >= 0; })) {
      if (s.sex === 'f') return g('свекор', 'свекруха', 'батько чи мати чоловіка');
      if (s.sex === 'm') return g('тесть', 'теща', 'батько чи мати дружини');
      return g('батько партнера', 'мати партнера', 'один із батьків партнера');
    }
    if (down(sid).some(function (k) { return M.unions[k].some(function (f) { return (f.type === 'married' || f.type === 'partner') && other(f, k) === xid; }); })) return g('зять', 'невістка', 'зять чи невістка');
    return '';
  }

  /* ---------------------------------------------------------------- Гілки outline */
  /*
   * Row order for the Гілки tab: a descendant outline.
   * 1. Roots are people with no recorded parents, oldest first (no birth year → last),
   *    unless opts.lineRoots names the starting people.
   * 2. A root whose children are all already in the outline is an in-law ancestor
   *    (Ганна's mother): it is not a line of its own but sits right after its child,
   *    at the child's indent. Its partners follow it.
   * 3. Visiting a person: the person, then each partner (by union start) followed by
   *    that partner's in-law ancestors, then the children of every union (by birth,
   *    dateless last), one indent deeper.
   * Each item: { id, depth, kind: 'blood' | 'partner' | 'ancestor', fam, anchor }
   * `anchor` is the person this row hangs from; it names dateless rows ("мати Ганни").
   */
  function outline(M, lineRoots) {
    var P = M.P, roots = M.ids.filter(function (id) { return !M.parents[id].length; }).sort(M.byBirth);
    if (lineRoots && lineRoots.length) roots = lineRoots.filter(function (id) { return P[id]; }).concat(roots.filter(function (id) { return lineRoots.indexOf(id) < 0; }));
    var covered = {}, mains = [], attached = {};
    var cover = function (id) {
      var stack = [id];
      while (stack.length) {
        var x = stack.pop();
        if (covered[x]) continue;
        covered[x] = 1;
        M.unions[x].forEach(function (f) { var o = other(f, x); if (o && !covered[o]) stack.push(o); (f.kids || []).forEach(function (k) { if (P[k.id] && !covered[k.id]) stack.push(k.id); }); });
      }
    };
    roots.forEach(function (r) {
      if (covered[r]) return;
      var ks = M.kids[r].map(function (k) { return k.id; });
      if (ks.length && ks.every(function (k) { return covered[k]; })) {
        (attached[ks[0]] = attached[ks[0]] || []).push(r);
        covered[r] = 1;
        M.unions[r].forEach(function (f) { var o = other(f, r); if (o) covered[o] = 1; });
        return;
      }
      mains.push(r); cover(r);
    });
    var out = [], seen = {};
    var add = function (id, depth, kind, fam, anchor) { seen[id] = 1; out.push({ id: id, depth: depth, kind: kind, fam: fam || null, anchor: anchor || null }); };
    var ancestors = function (id, depth) {
      (attached[id] || []).forEach(function (a) {
        if (seen[a]) return;
        add(a, depth, 'ancestor', null, id);
        M.unions[a].forEach(function (f) { var o = other(f, a); if (o && !seen[o]) add(o, depth, 'partner', f, a); });
      });
    };
    var visit = function (id, depth, anchor) {
      if (seen[id]) return;
      add(id, depth, 'blood', null, anchor);
      ancestors(id, depth);
      // partners, each followed by their in-law ancestors and their other partners
      var otherUnions = [];
      M.unions[id].forEach(function (f) {
        var o = other(f, id); if (!o || seen[o]) return;
        add(o, depth, 'partner', f, id); ancestors(o, depth);
        M.unions[o].forEach(function (g) {
          if (g === f || other(g, o) === id) return;
          var o2 = other(g, o); if (o2 && !seen[o2]) add(o2, depth, 'partner', g, o);
          otherUnions.push([g, o]);
        });
      });
      var kidsOf = function (f) { return (f.kids || []).map(function (k) { return k.id; }).filter(function (k) { return P[k]; }).sort(M.byBirth); };
      M.unions[id].forEach(function (f) { kidsOf(f).forEach(function (k) { visit(k, depth + 1, id); }); });
      // a partner's children from another union hang here too
      otherUnions.forEach(function (go) { kidsOf(go[0]).forEach(function (k) { visit(k, depth + 1, go[1]); }); });
    };
    mains.forEach(function (r) { visit(r, 0, null); });
    M.ids.slice().sort(M.byBirth).forEach(function (id) { if (!seen[id]) visit(id, 0, null); });
    return out;
  }

  /* Generations for the Покоління tab: the outline's lines start at I; partners share
     their partner's generation, children are one below, in-law ancestors one above.
     Renumbered so the oldest generation with a dated person is I. */
  function generations(M) {
    var gen = {}, queue = [];
    var seed = function (id) { if (gen[id] == null) { gen[id] = 1; queue.push(id); } };
    var run = function () {
      while (queue.length) {
        var x = queue.shift(), gx = gen[x];
        M.unions[x].forEach(function (f) { var o = other(f, x); if (o && gen[o] == null) { gen[o] = gx; queue.push(o); } });
        M.kids[x].forEach(function (k) { if (gen[k.id] == null) { gen[k.id] = gx + 1; queue.push(k.id); } });
        M.parents[x].forEach(function (p) { if (gen[p.id] == null) { gen[p.id] = gx - 1; queue.push(p.id); } });
      }
    };
    M.outline.filter(function (o) { return o.depth === 0 && o.kind === 'blood'; }).forEach(function (o) { seed(o.id); run(); });
    M.ids.forEach(function (id) { seed(id); run(); });
    var dated = M.dated.map(function (id) { return gen[id]; });
    var shift = dated.length ? 1 - Math.min.apply(null, dated) : 0;
    Object.keys(gen).forEach(function (id) { gen[id] += shift; });
    return gen;
  }

  // Text for a dateless row's pill: "мати Ганни · без дат", "син Федора · помер 1920"
  function anchorText(M, id) {
    var o = M.anchor[id], p = M.P[id], a = o && o.anchor ? M.P[o.anchor] : null;
    var tail = p.d != null ? gw(p.sex, 'помер ', 'померла ', 'пом. ') + p.d : 'без дат';
    if (!a) return tail;
    var word = relation(M, id, a.id);
    if (!word) return tail;
    var gen = genitive(a.given, a.sex);
    return (gen ? word + ' ' + gen : word + ' — ' + fullName(M, a.id)) + ' · ' + tail;
  }

  /* ---------------------------------------------------------------- rows for a tab */
  // [{ type: 'band', key, title, sub } | { type: 'person', id, depth, kind, fam }]
  function rowList(M, group) {
    if (group === 'gen') {
      var out = [], gens = {};
      M.dated.forEach(function (id) { var g = M.gen[id] || 1; (gens[g] = gens[g] || []).push(id); });
      Object.keys(gens).map(Number).sort(function (a, b) { return a - b; }).forEach(function (g) {
        var ids = gens[g].sort(M.byBirth), bs = ids.map(function (id) { return M.P[id].b; });
        out.push({ type: 'band', key: 'g' + g, title: roman(g) + ' покоління', sub: 'нар. ' + Math.min.apply(null, bs) + '–' + Math.max.apply(null, bs) + ' · ' + peopleCount(ids.length) });
        ids.forEach(function (id) { out.push({ type: 'person', id: id, depth: 0, kind: 'blood', fam: null }); });
      });
      if (M.undated.length) {
        out.push({ type: 'band', key: 'und', title: 'Без відомих дат', sub: peopleCount(M.undated.length) });
        M.undated.forEach(function (id) { out.push({ type: 'person', id: id, depth: 0, kind: 'blood', fam: null }); });
      }
      return out;
    }
    return M.outline.map(function (o) { return { type: 'person', id: o.id, depth: o.depth, kind: o.kind, fam: o.fam }; });
  }

  /* ---------------------------------------------------------------- text widths */
  // Rough widths used when no measure() is supplied. Pass opts.measure(text, role) → px
  // (e.g. canvas measureText with the element's computed font) for exact placement.
  var CW = { tick: 6.2, badge: 7.2, scrub: 7.4, pill: 6.8, today: 6.4, label: 6.3, undated: 6.2 };
  function estimate(text, role) { return Math.round(String(text).length * (CW[role] || 6.4)) + 6; }

  /* ---------------------------------------------------------------- bars and markers */
  function segments(M, p, X, y0, y1, top, h) {
    var parts = [], tone = p.living ? 'live' : 'dec';
    if (p.unknownEnd) {
      var last = Math.max(p.last || p.b, p.b + 1), cap = Math.min(M.now, p.b + UNKNOWN_SPAN);
      if (p.bq) { parts.push([p.b - 4, p.b + 3, ['hatch']]); parts.push([p.b + 3, Math.max(p.b + 3, last), ['r']]); }
      else parts.push([p.b, last, ['r']]);
      if (cap > last) parts.push([last, cap, ['hatch']]);
    } else {
      var e = endY(M, p), a = p.b, z = e, tail = null, cls = [];
      if (p.bq) { parts.push([p.b - 4, p.b + 3, ['hatch']]); a = p.b + 3; cls.push('l'); }
      if (p.dq === '<' || p.dq === '~') { tail = [e - 6, e, ['hatch']]; z = e - 6; cls.push('r'); }
      if (p.living) cls.push('r');
      if (z > a) parts.push([a, z, cls]);
      if (tail) parts.push(tail);
    }
    var out = [];
    parts.forEach(function (pt) {
      var a = Math.max(pt[0], y0), z = Math.min(pt[1], y1), cls = pt[2].slice();
      if (z <= a) return;
      if (pt[0] < y0) cls.push('l');
      if (pt[1] > y1) cls.push('r');
      out.push({ x: Math.round(X(a) * 10) / 10, w: Math.max(2, Math.round((X(z) - X(a)) * 10) / 10), y: top, h: h, tone: tone, cls: cls });
    });
    return out;
  }
  function markers(M, p, X, cy, y0, y1) {
    var out = [], end = softEnd(M, p);
    p.events.forEach(function (ev) { if (ev.y < y0 || ev.y > y1 || ev.y < p.b || ev.y > end) return; out.push({ x: Math.round(X(ev.y + 0.5)), y: cy, kind: ev.k }); });
    if (p.living && y1 >= M.now) out.push({ x: Math.round(X(M.now)) + 1, y: cy, kind: 'cap' });
    if (p.unknownEnd && p.b + UNKNOWN_SPAN <= Math.min(y1, M.now)) out.push({ x: Math.round(X(p.b + UNKNOWN_SPAN)), y: cy, kind: 'q' });
    return out;
  }

  /* ================================================================ build */
  /*
   * build(M, opts) → everything one render of the page needs.
   * opts: {
   *   group: 'branch' | 'gen'          tab («Гілки» | «Покоління»)
   *   device: 'desktop' | 'phone'
   *   width: main column width in px   (desktop: viewport − 400 px panel when open)
   *   sel: selected person id
   *   year: hovered or pinned year
   *   measure: optional (text, role) → px
   * }
   */
  function build(M, opts) {
    opts = opts || {};
    var phone = opts.device === 'phone', G0 = phone ? GEO.phone : GEO.desktop;
    var group = opts.group === 'gen' ? 'gen' : 'branch';
    var width = opts.width || (phone ? 390 : 1040), measure = opts.measure || estimate;
    var sel = M.P[opts.sel] ? opts.sel : (M.rootId && M.P[M.rootId] ? M.rootId : M.dated[0] || M.ids[0]);
    var minB = M.dated.length ? Math.min.apply(null, M.dated.map(function (id) { return M.P[id].b - (M.P[id].bq ? 4 : 0); })) : M.now - 100;
    var y0 = Math.floor((minB - 1) / 5) * 5, y1 = M.now + 4;
    var L = G0.L, R = width - G0.gutter, k = (R - L) / (y1 - y0);
    var X = function (y) { return L + (y - y0) * k; };
    var year = Math.max(y0, Math.min(M.now, opts.year != null ? opts.year : M.now));
    var rels = {}; M.ids.forEach(function (id) { var r = relation(M, id, sel); if (r) rels[id] = r; });
    var list = rowList(M, group);
    var rows = [], conns = [], idx = {}, top = 0;
    list.forEach(function (it) {
      if (it.type === 'band') { rows.push({ type: 'band', key: it.key, top: top, h: G0.bandH, title: it.title, sub: it.sub }); top += G0.bandH; return; }
      var p = M.P[it.id], depth = group === 'gen' ? 0 : it.depth, h = G0.pitch;
      var nameX = group === 'gen' ? G0.genNameX : G0.nameX0 + depth * G0.indent;
      var guides = []; for (var i = 0; i < depth; i++) guides.push(G0.guideX0 + i * G0.indent);
      var cy = G0.barTop + G0.barH / 2, al = p.undated ? 'no' : alive(M, it.id, year);
      var pm = it.kind === 'partner' && group !== 'gen' ? (it.fam && it.fam.type === 'partner' ? 'p' : it.fam && it.fam.type === 'divorced' ? 'div' : 'm') : '';
      var row = {
        type: 'person', key: it.id, id: it.id, top: top, h: h, cy: cy, depth: depth, kind: it.kind,
        nameX: nameX, nameW: phone ? null : L - 8 - nameX, guides: guides, pmark: pm,
        name: fullName(M, it.id), years: yearsLabel(M, it.id), initials: initials(M, it.id), photo: p.photo,
        deceased: !p.undated && !p.living, undated: p.undated, sel: it.id === sel, rel: rels[it.id] || '',
        dim: !p.undated && al === 'no', alive: al,
        segs: p.undated ? [] : segments(M, p, X, y0, y1, G0.barTop, G0.barH),
        marks: p.undated ? [] : markers(M, p, X, cy, y0, y1),
        label: null, pill: null
      };
      row.aria = row.name + ', ' + row.years + (row.rel ? ', ' + row.rel : '');
      if (p.undated) row.pill = { x: phone ? nameX + 8 : L + 6, text: anchorText(M, it.id) };
      else if (row.rel && !row.sel && !phone) {
        var w = measure(row.rel, 'label'), sx = X(Math.max(p.b, y0)), ex = X(Math.min(softEnd(M, p), y1)) + (p.living || p.unknownEnd ? 14 : 0);
        row.label = { x: 0, left: false, text: row.rel, opt: { r: ex + 8, l: sx - 8, w: w, rOk: ex + 8 + w <= R + 20, lOk: sx - 8 - w >= L } };
        row.label.left = !row.label.opt.rOk; row.label.x = Math.round(row.label.left ? row.label.opt.l : row.label.opt.r);
      }
      rows.push(row); idx[it.id] = row; top += h;
    });
    // lines of descent (desktop Гілки only; on a phone the indent carries the branches)
    if (group === 'branch' && !phone) {
      M.fams.forEach(function (f) {
        var ra = idx[f.a], rb = f.b ? idx[f.b] : null, s = yearOfStr(f.start);
        var selF = f.a === sel || f.b === sel;
        if (ra && rb && s && f.type !== 'none') {
          var t = Math.min(ra.top, rb.top) + ra.cy, bt = Math.max(ra.top, rb.top) + rb.cy;
          conns.push({ x: Math.round(X(s + 0.5)) - 1, top: t, h: bt - t, kind: 'tie', sel: selF });
        }
        var anchor = rb && ra && rb.top > ra.top ? rb : (ra || rb);
        if (!anchor) return;
        (f.kids || []).forEach(function (kk) {
          var kr = idx[kk.id], q = M.P[kk.id];
          if (!kr || !q || q.undated) return;
          var rel = f.b ? (kk.ra === 'adopted' || kk.rb === 'adopted' ? 'adopt' : (kk.ra === 'step' || kk.rb === 'step' || kk.ra === 'foster' || kk.rb === 'foster') ? 'step' : 'descent') : (kk.ra === 'adopted' ? 'adopt' : kk.ra === 'step' || kk.ra === 'foster' ? 'step' : 'descent');
          var t2 = anchor.top + anchor.cy + G0.barH / 2 + 1, b2 = kr.top + kr.cy;
          if (b2 > t2) conns.push({ x: Math.round(X(q.b + 0.5)), top: t2, h: b2 - t2, kind: rel, sel: selF || kk.id === sel });
        });
      });
    }
    // dateless pills step past the lines that cross their row
    rows.forEach(function (r) {
      if (!r.pill) return;
      var w = measure(r.pill.text, 'undated') + 12;
      var xs = crossing(conns, r).sort(function (a, b) { return a - b; });
      var x = r.pill.x;
      xs.forEach(function (cx) { if (cx >= x - 5 && cx <= x + w + 5) x = cx + 9; });
      r.pill.x = Math.round(x); r.pill.w = w;
    });
    // relation words dodge lines of descent and the «сьогодні» line
    var todayX = X(M.now);
    rows.forEach(function (r) {
      var lab = r.type === 'person' && r.label; if (!lab) return;
      var o = lab.opt, obs = crossing(conns, r).concat([todayX]);
      var free = function (a, z) { return !obs.some(function (x) { return x > a - 3 && x < z + 3; }); };
      var cands = [];
      if (o.rOk) cands.push([o.r, false]);
      if (o.lOk) cands.push([o.l, true]);
      obs.slice().sort(function (a, b) { return a - b; }).forEach(function (x) { if (x + 5 > o.r && x + 5 + o.w <= R + 20) cands.push([x + 5, false]); });
      obs.slice().sort(function (a, b) { return b - a; }).forEach(function (x) { if (x - 5 < o.l && x - 5 - o.w >= L) cands.push([x - 5, true]); });
      var hit = cands.filter(function (c) { return c[1] ? free(c[0] - o.w, c[0]) : free(c[0], c[0] + o.w); })[0];
      if (hit) { lab.x = Math.round(hit[0]); lab.left = hit[1]; }
      delete lab.opt;
    });
    var ax = axis({ X: X, L: L, R: R, y0: y0, y1: y1, k: k, now: M.now, width: width, phone: phone, year: year, pillText: phone ? countText(M, year, true) : countText(M, year, false), measure: measure });
    return {
      geo: { L: L, R: R, y0: y0, y1: y1, k: k, pitch: G0.pitch, barH: G0.barH },
      X: X, yearAt: function (x) { return Math.max(y0, Math.min(M.now, Math.floor(y0 + (x - L) / k))); },
      rows: rows, conns: conns, height: top + 12, sel: sel, year: year,
      count: countAlive(M, year), axis: ax,
      legend: {
        lines: group === 'branch' && !phone, branch: group === 'branch',
        undatedText: group === 'gen' ? 'Дати невідомі — рядок без смуги, у кінці списку' : 'Дати невідомі — рядок без смуги поруч із родичами',
        selectedText: phone ? 'Обрана людина — деталі в картці внизу' : 'Обрана людина — деталі в панелі праворуч'
      },
      subtitle: peopleCount(M.dated.length) + ' на шкалі' + (M.undated.length ? ' · ' + M.undated.length + ' без дат — ' + (group === 'gen' ? 'у кінці списку' : 'у своїх гілках') : '')
    };
  }
  function crossing(conns, r) { return conns.filter(function (c) { return c.top < r.top + r.h - 2 && c.top + c.h > r.top + 2; }).map(function (c) { return c.x; }); }

  /* ---------------------------------------------------------------- axis */
  // Priority: year badge > count pill > «сьогодні» > decade ticks. A lower label hides
  // rather than sitting under a higher one. The pill flips left of the badge near the edge.
  function axis(a) {
    var m = a.measure || estimate, step = a.phone ? 20 : (a.k * 10 >= 34 ? 10 : 20);
    var ticks = [], grids = [];
    for (var y = Math.ceil(a.y0 / step) * step; y <= Math.min(a.y1, a.now); y += step) { ticks.push({ x: Math.round(a.X(y)), text: String(y), year: y }); grids.push({ x: Math.round(a.X(y)), century: y % 100 === 0 }); }
    var bx = Math.round(a.X(a.year + 0.5)), bw = a.phone ? m(String(a.year), 'scrub') + 14 : m(String(a.year), 'badge') + 10;
    var boxes = [[bx - bw / 2, bx + bw / 2]], pill = null;
    if (!a.phone) {
      var pw = m(a.pillText, 'pill') + 16, right = bx + bw / 2 + 6, left = bx - bw / 2 - 6 - pw;
      var px = right + pw <= a.width - 8 ? right : left >= 8 ? left : (a.width - 8 - right > left ? right : 8);
      pill = { x: Math.round(px), w: pw, text: a.pillText };
      boxes.push([px, px + pw]);
    } else pill = { x: null, w: null, text: a.pillText };
    var hits = function (l, r) { return boxes.some(function (b) { return l < b[1] + 4 && r > b[0] - 4; }); };
    var tx = Math.round(a.X(a.now)), tw = m('сьогодні', 'today');
    var today = { x: tx, show: !a.phone && a.y1 >= a.now && !hits(tx - tw / 2, tx + tw / 2) };
    if (today.show) boxes.push([tx - tw / 2, tx + tw / 2]);
    var shown = ticks.filter(function (t) { var hw = m(t.text, 'tick') / 2; return !hits(t.x - hw, t.x + hw); });
    return { step: step, ticks: shown, grids: grids, badge: { x: bx, text: String(a.year) }, pill: pill, today: today, todayLineX: tx };
  }

  /* ---------------------------------------------------------------- tooltip and panel text */
  function eventText(M, ev) {
    var q = M.P[ev.who];
    if (ev.k === 'm') return 'шлюб · ' + fullName(M, ev.who);
    if (ev.k === 'p') return 'партнерство · ' + fullName(M, ev.who);
    if (ev.k === 'div') return 'розлучення · ' + fullName(M, ev.who);
    if (ev.k === 'adopt') return 'усиновлення · ' + (q.given || fullName(M, ev.who));
    return gw(q.sex, 'син ', 'донька ', 'дитина ') + (q.given || fullName(M, ev.who));
  }
  // Card shown next to the hovered bar.
  function tooltip(M, id, y) {
    var p = M.P[id]; if (!p || p.undated) return null;
    var al = alive(M, id, y), now, muted = true;
    if (al === 'yes') { now = 'У ' + y + ' — ' + (p.bq ? 'бл. ' : '') + yrs(y - p.b) + (y === p.d ? ' · рік смерті' : ''); muted = false; }
    else if (al === 'maybe') now = 'У ' + y + ' — невідомо, чи ' + gw(p.sex, 'живий', 'жива', 'жива людина') + ' (було б ' + yrs(y - p.b) + ')';
    else if (y < p.b) now = 'У ' + y + ' ще не ' + gw(p.sex, 'народився', 'народилася', 'народилась');
    else now = 'У ' + y + ' вже не ' + gw(p.sex, 'жив', 'жила', 'жила') + ' · ' + gw(p.sex, 'помер ', 'померла ', 'пом. ') + (p.dq === '<' ? 'до ' : '') + p.d;
    var evs = p.events.filter(function (e) { return e.y <= softEnd(M, p); });
    return {
      name: fullName(M, id), years: yearsLabel(M, id) + ' · ' + lifeText(M, id), now: now, muted: muted,
      events: evs.slice(0, 4).map(function (e) { return { kind: e.k, year: e.y, text: eventText(M, e) }; }),
      more: evs.length > 4 ? 'і ще ' + eventsCount(evs.length - 4) : ''
    };
  }
  // Lines for the drawer's «У хронології» section.
  function chronFacts(M, id) {
    var p = M.P[id], out = [];
    if (p.undated) return ['Дати невідомі — додайте рік народження, щоб людина з’явилася на шкалі'];
    if (p.living) out.push('Зараз ' + yrs(M.now - p.b));
    else if (p.d == null) out.push('Рік смерті невідомий' + (p.last && p.last > p.b ? ' · остання звістка ' + p.last : ''));
    else out.push(gw(p.sex, 'Прожив ', 'Прожила ', 'Прожито ') + (p.bq || p.dq ? 'приблизно ' : '') + yrs(p.d - p.b));
    var ov = M.dated.filter(function (x) { return x !== id && overlap(M, x, id) > 0; });
    out.push('Сучасників в архіві: ' + ov.length + ' — жили в ті самі роки');
    var gens = ov.map(function (x) { return M.gen[x]; }).concat([M.gen[id]]).filter(function (g) { return g != null; });
    if (gens.length) { var g0 = Math.min.apply(null, gens), g1 = Math.max.apply(null, gens); out.push('Поколінь за життя: ' + (g1 - g0 + 1) + (g1 > g0 ? ' (' + roman(g0) + '–' + roman(g1) + ')' : '')); }
    return out;
  }
  // Phone peek card line: "у 1944 — 18 років"
  function atYear(M, id, y) {
    var p = M.P[id]; if (!p || p.undated) return '';
    var al = alive(M, id, y);
    if (al === 'yes') return 'у ' + y + ' — ' + yrs(y - p.b);
    if (al === 'maybe') return 'у ' + y + ' — невідомо';
    return y < p.b ? 'у ' + y + ' ще не ' + gw(p.sex, 'народився', 'народилася', 'народилась') : 'у ' + y + ' вже не ' + gw(p.sex, 'жив', 'жила', 'жила');
  }

  /* ================================================================ export */
  var api = {
    GEO: GEO, UNKNOWN_SPAN: UNKNOWN_SPAN, LIVING_CAP: LIVING_CAP,
    plural: plural, yrs: yrs, peopleCount: peopleCount, roman: roman, genitive: genitive, parseDate: parseDate,
    model: model, alive: alive, countAlive: countAlive, countText: countText, overlap: overlap,
    fullName: fullName, initials: initials, yearsLabel: yearsLabel, lifeText: lifeText,
    relation: relation, anchorText: anchorText, outline: outline, rowList: rowList,
    build: build, axis: axis, estimate: estimate, tooltip: tooltip, chronFacts: chronFacts, atYear: atYear, eventText: eventText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FamilyTimeline = api;
})(typeof window !== 'undefined' ? window : this);
