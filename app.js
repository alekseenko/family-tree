/* Family Archive — app core: state, rendering, tree canvas, quick-add, keyboard, saving UI.
   The drawer lives in drawer.js; lists, state screens, dialogs and the poster in views.js. */
(function () {
  'use strict';
  var FA = window.FA, FE = window.FamilyEngine, St = FA.Storage;
  var el = FA.el, icon = FA.icon, count = FA.count, clamp = FA.clamp;

  function pref(k, def) { try { return localStorage.getItem('fa.' + k) || def; } catch (e) { return def; } }
  function setPref(k, v) { try { localStorage.setItem('fa.' + k, v); } catch (e) { /* ignore */ } }

  /* ================================================================ state */
  var s = {
    data: null, rev: 0, focusId: null, view: 'tree', dvRoot: null,
    zoom: 1, panX: 0, panY: 0, anim: false, lineFade: false, centered: false, dragging: false,
    density: pref('density', 'compact'), theme: pref('theme', 'system'),
    present: location.hash === '#present' || pref('present', '0') === '1',
    drawerOpen: true, editMode: false, qa: null, menuOpen: false, statusOpen: false, explainerOpen: false, moreOpen: false,
    search: '', searchOpen: false, searchIdx: 0, phoneSearch: false,
    relEdit: null, relConfirm: false, confirm: null, toast: null,
    screen: 'loading', fileError: '', otherTab: false,
    showLegend: false, showKeys: false, posterOpen: false, depthOpen: false,
    listSort: 'name', listDir: 1, listFilter: 'all', listQuery: '',
    dvCollapsed: {}, notesEdit: false, notesDraft: '', dragOver: false, captionEdit: null, frameEdit: null,
    pulseId: null, upGen: 3, downGen: 3, sibFamilies: false,
    posterUp: 3, posterDown: 2, posterSibs: true, posterPhotos: true,
    first: { name: '', sex: 'u', year: '' }, sampleNote: pref('sampleNote', '1') === '1',
    appW: 1440, appH: 900, vpW: 0, vpH: 0, focusReq: null, lightbox: null
  };
  var hist = [], fut = [], lastCoalesce = null, timers = {};
  var root, dom = {};

  var A = FA.app = { s: s };
  // photos moved into the folder: undo/redo snapshots follow them
  St.onRewrite(function (map) { hist.concat(fut).forEach(function (h) { St.rewritePhotos(h, map); }); });

  function later(key, ms, fn) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }
  var queued = false;
  function set(patch) { Object.assign(s, patch); schedule(); }
  function schedule() { if (queued) return; queued = true; Promise.resolve().then(render); }

  var isPhone = function () { return s.appW < 700; };
  // A phone (a small touch screen) only views; a narrow or zoomed-in desktop window keeps editing,
  // in the phone layout.
  var viewOnlyScreen = function () { return isPhone() && touchOnly; };
  var isTablet = function () { return s.appW < 1100; };
  // Present mode, phones, a second tab and non-app screens are read-only.
  var ro = function () { return s.screen !== 'app' || viewOnlyScreen() || s.present || s.otherTab || St.S.mode === 'sample'; };
  var sampleMode = function () { return St.S.mode === 'sample'; };
  var P = function (id) { return s.data && s.data.people[id]; };
  // Data checks (FE.checkTree), worked out once per version of the data.
  var issuesFor = null, issuesVal = {};
  var issues = function () { if (issuesFor !== s.data) { issuesFor = s.data; issuesVal = s.data ? FE.checkTree(s.data) : {}; } return issuesVal; };
  var given = function (id) { return FE.givenOf(P(id)); };
  var D = function () { return FE.DIMS[s.density]; };

  /* ================================================================ layout */
  var layoutCache = null;
  function layout() {
    if (!s.data) return { nodes: {}, segs: [], labels: [], tags: [], ghosts: [], hidden: {}, bounds: null };
    var key = [s.rev, s.focusId, s.density, s.upGen, s.downGen, s.sibFamilies ? 1 : 0].join('|');
    if (layoutCache && layoutCache.key === key) return layoutCache.val;
    var val = FE.layoutTree(s.data, s.focusId, D(), { upGen: s.upGen, downGen: s.downGen, sibFamilies: s.sibFamilies, ghosts: true });
    layoutCache = { key: key, val: val };
    return val;
  }
  // Below 1100px the drawer overlays the canvas (a side panel, or a bottom sheet on phones),
  // so centre in the part that stays visible.
  function panFor(pos) {
    var d = D(), w = s.vpW, h = s.vpH;
    var overlay = s.drawerOpen && s.screen === 'app' && P(s.focusId);
    if (overlay && isPhone()) h = Math.max(120, h - s.appH * 0.78 + 56);
    else if (overlay && isTablet()) w = Math.max(200, w - Math.min(400, s.appW * 0.92));
    return { panX: Math.round(w / 2 - (pos.x + d.cw / 2) * s.zoom), panY: Math.round(h / 2 - (pos.y + d.ch / 2) * s.zoom) };
  }
  function animate(patch) {
    Object.assign(s, patch, { anim: true });
    applyView();
    later('anim', 480, function () { s.anim = false; applyView(); });
  }
  function centerOn(pid, anim) {
    var pos = layout().nodes[pid];
    if (!pos || !s.vpW) return;
    if (anim) animate(panFor(pos)); else { Object.assign(s, panFor(pos)); applyView(); }
  }
  function zoomBy(f, cx, cy, anim) {
    var z = clamp(s.zoom * f, 0.3, 2);
    var x = cx == null ? s.vpW / 2 : cx, y = cy == null ? s.vpH / 2 : cy, k = z / s.zoom;
    var patch = { zoom: z, panX: x - (x - s.panX) * k, panY: y - (y - s.panY) * k };
    if (anim) animate(patch); else { Object.assign(s, patch); applyView(); }
  }
  function fit() {
    var b = layout().bounds;
    if (!b || !s.vpW) return;
    var bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    var z = clamp(Math.min((s.vpW - 96) / bw, (s.vpH - 150) / bh), 0.3, 1.2);
    animate({ zoom: z, panX: Math.round(s.vpW / 2 - (b.minX + bw / 2) * z), panY: Math.round((s.vpH - 40) / 2 - (b.minY + bh / 2) * z) });
  }
  function fadeLines() { later('fade', 440, function () { s.lineFade = false; if (dom.lines) dom.lines.classList.remove('is-fading'); }); }

  /* ================================================================ selection */
  // Moving to someone else keeps a half-written note instead of dropping it (everything else saves as you type).
  function keepNotes() {
    var p = s.notesEdit && P(s.focusId);
    if (!p || ro() || s.notesDraft === (p.notes || '')) return;
    var pid = p.id, v = s.notesDraft;
    commit(function (d) { if (!d.people[pid]) return false; d.people[pid].notes = v; }, { touch: pid, toast: 'Нотатки збережено: ' + FE.givenOf(p) });
  }
  function focusPerson(pid, o) {
    o = o || {};
    if (!pid || !P(pid)) return;
    if (pid !== s.focusId) keepNotes();
    var base = { relEdit: null, relConfirm: false, notesEdit: false, captionEdit: null, frameEdit: null, moreOpen: false, qa: null, searchOpen: false, ac: null };
    if (o.view) base.view = o.view;
    if (pid === s.focusId) {
      if (!o.noOpen) base.drawerOpen = true;
      set(base);
      if (o.view === 'tree') centerOn(pid, true);
      return;
    }
    lastCoalesce = null;
    Object.assign(s, base, { focusId: pid, editMode: false });
    var pos = layout().nodes[pid];
    if (pos && s.vpW) Object.assign(s, panFor(pos));
    s.anim = true; s.lineFade = true;
    render();
    fadeLines();
    later('anim', 480, function () { s.anim = false; applyView(); });
  }
  function goRoot() {
    var r = s.data && s.data.rootId;
    if (!r) return;
    // leaving "show everyone" puts the generation settings back
    if (s.prevDepth) { Object.assign(s, s.prevDepth, { prevDepth: null, lineFade: true }); fadeLines(); }
    if (s.view !== 'tree') s.view = 'tree';
    if (r === s.focusId) { render(); centerOn(r, true); } else focusPerson(r, { noOpen: true });
  }
  function navigate(key) {
    var d = s.data, L = layout(), cur = L.nodes[s.focusId];
    if (!cur) return;
    var target = null;
    var nearest = function (row) {
      var best = null, bd = Infinity;
      Object.keys(L.nodes).forEach(function (id) { var n = L.nodes[id]; if (n.row !== row) return; var dd = Math.abs(n.x - cur.x); if (dd < bd) { bd = dd; best = id; } });
      return best;
    };
    if (key === 'ArrowUp') {
      var pf = FE.primaryParentFam(d, s.focusId);
      target = pf && L.nodes[pf.a] ? pf.a : (pf && pf.b && L.nodes[pf.b] ? pf.b : nearest(cur.row - 1));
    } else if (key === 'ArrowDown') {
      var kid = FE.sortFams(FE.famsOf(d, s.focusId)).reduce(function (acc, f) { return acc || f.kids.find(function (k) { return L.nodes[k.id]; }) || null; }, null);
      target = kid ? kid.id : nearest(cur.row + 1);
    } else {
      var row = Object.keys(L.nodes).filter(function (id) { return L.nodes[id].row === cur.row; }).sort(function (a, b) { return L.nodes[a].x - L.nodes[b].x; });
      var i = row.indexOf(s.focusId);
      target = row[key === 'ArrowLeft' ? i - 1 : i + 1] || null;
    }
    if (target) { s.focusReq = 'card:' + target; focusPerson(target, { noOpen: true }); }
  }
  function setView(v) {
    // on a phone the person sheet would cover the list
    set({ view: v, qa: null, depthOpen: false, menuOpen: false, drawerOpen: isPhone() && v !== s.view ? false : s.drawerOpen, dvRoot: v === 'desc' ? s.focusId : s.dvRoot });
    if (v === 'tree') { s.centered = false; }
  }

  /* ================================================================ editing core */
  function commit(mut, o) {
    o = o || {};
    if (ro() && !o.force) return;
    var draft = FA.clone(s.data);
    if (mut(draft) === false) return;
    FE.tidyFamilies(draft);
    var push = !o.noHistory;
    if (o.coalesce) {
      var lc = lastCoalesce;
      if (lc && lc.key === o.coalesce && (s.editMode || Date.now() - lc.t < 4000)) push = false;
      lastCoalesce = { key: o.coalesce, t: Date.now() };
    } else lastCoalesce = null;
    if (push) { hist.push(s.data); if (hist.length > 80) hist.shift(); fut = []; }
    if (o.touch && draft.people[o.touch]) draft.people[o.touch].updated = FA.today();
    Object.assign(s, { data: draft, rev: s.rev + 1 }, o.state || {});
    var msg = typeof o.toast === 'function' ? o.toast(draft) : o.toast;
    if (msg) toast(msg, o.undo !== false);
    St.changed(s.data);
    schedule();
    if (o.after) Promise.resolve().then(o.after);
  }
  function undo() {
    if (ro()) return;
    if (!hist.length) { toast('Нічого скасовувати', false); return; }
    var prev = hist.pop();
    fut.push(s.data); lastCoalesce = null;
    Object.assign(s, { data: prev, rev: s.rev + 1 }, afterTimeTravel(prev));
    toast('Скасовано', false);
    St.changed(s.data);
    schedule();
  }
  function redo() {
    if (ro() || !fut.length) return;
    var nxt = fut.pop();
    hist.push(s.data); lastCoalesce = null;
    Object.assign(s, { data: nxt, rev: s.rev + 1 }, afterTimeTravel(nxt));
    toast('Повернено', false);
    St.changed(s.data);
    schedule();
  }
  // Undo/redo swap the whole tree: half-done edits and pop-ups about people who may now be gone close.
  function afterTimeTravel(d) {
    var up = { relEdit: null, relConfirm: false, confirm: null, notesEdit: false, notesDraft: '', captionEdit: null, lightbox: null };
    if (!d.people[s.focusId]) { up.focusId = d.rootId; up.editMode = false; }
    if (s.qa && !d.people[s.qa.pid]) up.qa = null;
    else if (s.qa && s.qa.linkId && !d.people[s.qa.linkId]) up.qa = Object.assign({}, s.qa, { linkId: null });
    return up;
  }
  // The toast's "Скасувати" belongs to the change it reports; once anything else changed it goes.
  function toast(msg, undoable) {
    s.toast = { msg: msg, undo: !!undoable, h: hist.length, id: Date.now() };
    later('toast', 6000, function () { set({ toast: null }); });
    schedule();
  }
  function newPerson(id, f) {
    return { id: id, given: f.given || '', surname: f.surname || '', birthName: '', nick: '', sex: f.sex || 'u', birth: { date: f.year || '', place: '' }, death: { date: '', place: '' }, deceased: false, photo: null, photos: [], notes: '', updated: FA.today() };
  }

  /* ================================================================ quick-add */
  var KIND = {
    parent: { acc: 'батька чи матір', nom: 'один із батьків', already: 'Вже один із батьків' },
    partner: { acc: 'партнера', nom: 'партнер', already: 'Вже партнер' },
    child: { acc: 'дитину', nom: 'дитина', already: 'Вже дитина' },
    sibling: { acc: 'брата чи сестру', nom: 'брат чи сестра', already: 'Вже брат чи сестра' }
  };
  // The surname someone was born with. A married woman's current surname is usually her husband's,
  // so without a recorded birth surname or a father in the tree it is unknown.
  function familySurname(d, pid) {
    var p = d.people[pid]; if (!p) return '';
    if (p.birthName) return p.birthName;
    var pf = FE.primaryParentFam(d, pid), dad = pf && [pf.a, pf.b].map(function (x) { return d.people[x]; }).find(function (x) { return x && x.sex === 'm' && x.surname; });
    if (dad) return dad.surname;
    var married = p.sex === 'f' && p.surname && FE.famsOf(d, pid).some(function (f) { var o = d.people[FE.other(f, pid)]; return o && o.sex === 'm' && o.surname === p.surname; });
    return married ? '' : (p.surname || '');
  }
  function qaSuggest(d, q) {
    var p = d.people[q.pid];
    if (!p || q.kind === 'partner') return '';
    if (q.kind === 'parent') {
      if (q.sex === 'm') return familySurname(d, q.pid);
      // a mother joining a father already in the tree usually took his surname
      var pf = FE.primaryParentFam(d, q.pid), dad = pf && !pf.b ? d.people[pf.a] : null;
      return dad && dad.sex === 'm' ? (dad.surname || '') : '';
    }
    if (q.kind === 'child') {
      var f = d.families.find(function (x) { return x.id === q.withFam; });
      var o = f ? d.people[FE.other(f, q.pid)] : null;
      if (p.sex !== 'm' && o && o.sex === 'm') return o.surname || '';
      return p.sex === 'm' ? (p.surname || '') : '';
    }
    return familySurname(d, q.pid);
  }
  // The name the quick-add form will save: the surname field as shown, or, while it hasn't been
  // touched and the name field holds two words, the name read as a full name.
  function qaName(d, q) {
    var given = String(q.name || '').trim(), sur = q.surname != null ? String(q.surname).trim() : qaSuggest(d, q);
    if (q.surname == null && /\s/.test(given)) return splitNameUk(given, sur, d);
    return { given: given, surname: sur };
  }
  // Birth in the quick-add form: anything readDate understands (1931, 12 3 1931, бл. 1930…), tidied.
  function qaDate(v) {
    var r = FE.readDate(v);
    if (!r) return { ok: true, val: '' };
    return r.bad || r.free ? { ok: false } : { ok: true, val: r.text };
  }


  // Ukrainian names are often written surname first ("Коваленко Олена"). If the first word is a
  // surname already in the tree and the last one isn't, read it that way round.
  function splitNameUk(full, suggest, d) {
    var nm = FE.splitName(full, suggest), parts = String(full || '').trim().split(/\s+/);
    if (parts.length < 2) return nm;
    var known = {};
    Object.keys(d.people).forEach(function (id) { var p = d.people[id]; [p.surname, p.birthName].forEach(function (x) { if (x) known[x.toLowerCase()] = 1; }); });
    if (suggest) known[suggest.toLowerCase()] = 1;
    if (known[parts[0].toLowerCase()] && !known[parts[parts.length - 1].toLowerCase()]) return { given: parts.slice(1).join(' '), surname: parts[0] };
    return nm;
  }
  function partnerFams(d, pid) {
    return FE.sortFams(FE.famsOf(d, pid)).filter(function (f) { var o = FE.other(f, pid); return o && d.people[o]; });
  }
  function openQa(kind, pid, tab) {
    var d = s.data, p = d.people[pid];
    if (!p || ro()) return;
    var fams = partnerFams(d, pid), pf = FE.primaryParentFam(d, pid);
    var sex = 'u';
    if (kind === 'partner') sex = p.sex === 'm' ? 'f' : p.sex === 'f' ? 'm' : 'u';
    if (kind === 'parent') { var ex = pf ? d.people[pf.a] : null; sex = ex ? (ex.sex === 'm' ? 'f' : 'm') : 'm'; }
    var cur = fams.filter(function (f) { return f.type !== 'divorced'; });
    var pick = cur.length ? cur[cur.length - 1] : fams[fams.length - 1];
    // children recorded with this person alone: a new partner is usually their other parent
    var solo = kind === 'partner' ? d.families.find(function (f) { return f.a === pid && !f.b && f.kids.some(function (k) { return d.people[k.id]; }); }) : null;
    set({
      qa: { kind: kind, pid: pid, tab: tab || 'new', name: '', surname: null, sex: sex, year: '', withFam: pick ? pick.id : 'none', unionType: 'married', parentRel: 'step', linkQuery: '', linkId: null, err: '',
        soloFam: solo ? solo.id : null, alsoParent: !!solo, alsoSiblings: true },
      menuOpen: false, statusOpen: false, depthOpen: false, moreOpen: false, view: 'tree', focusReq: tab === 'link' ? 'qa-link' : 'qa-name',
      // below 1100px the drawer overlays the canvas; make way for the popover
      drawerOpen: isTablet() ? false : s.drawerOpen
    });
    makeRoomForQa(pid);
  }
  var QA_W = 372;
  // Pan so the quick-add popover fits beside the card instead of covering it.
  function makeRoomForQa(pid) {
    var n = layout().nodes[pid], dims = D();
    if (!n || !s.vpW) return;
    var sx = n.x * s.zoom + s.panX, sy = n.y * s.zoom + s.panY, sw = dims.cw * s.zoom, sh = dims.ch * s.zoom;
    var right = sx + sw + 22 + QA_W <= s.vpW - 12, left = sx - QA_W - 22 >= 12;
    if (right || left) return;
    var tx = s.vpW - 12 - QA_W - 22 - sw;
    if (tx >= 12) animate({ panX: s.panX + (tx - sx) });
    else animate({ panY: s.panY + (24 - sy) });
  }
  function patchQa(up) { if (s.qa) { s.qa = Object.assign({}, s.qa, up); schedule(); } }
  function qaCommit(another) {
    var q = s.qa; if (!q) return;
    var d0 = s.data, p0 = d0.people[q.pid]; if (!p0) return;
    if (q.tab === 'link' && !(q.linkId && s.data.people[q.linkId])) { patchQa({ err: 'Спершу виберіть когось зі списку.' }); return; }
    var born = qaDate(q.year);
    if (q.tab === 'new' && !born.ok) { patchQa({ err: FE.readDate(q.year) && FE.readDate(q.year).ambiguous ? 'Це ' + FE.readDate(q.year).ambiguous.join(' чи ') + '? Поставте крапки.' : FE.readDate(q.year) && FE.readDate(q.year).bad ? 'Такої дати немає: ' + String(q.year).trim() + '.' : 'Не вдалося прочитати дату. Підійде 1931, 12.03.1931, 12 3 1931 або 12 березня 1931.' }); return; }
    if (q.tab === 'new' && FE.yearOf(born.val) > new Date().getFullYear()) { patchQa({ err: 'Рік народження ще не настав.' }); return; }
    if (q.tab === 'new' && !String(q.name).trim()) { patchQa({ err: 'Вкажіть ім’я.' }); return; }
    var newId = null, refused = '';
    commit(function (d) {
      var pid = q.pid, id, pf;
      // a link that would make someone their own parent or ancestor, or give a person a second pair of parents
      var refuse = function (why) { refused = why; return false; };
      var linked = q.tab === 'link' && d.people[q.linkId];
      if (linked && (q.kind === 'sibling' || q.kind === 'child')) {
        var lp = FE.parentFams(d, q.linkId), mine = FE.primaryParentFam(d, pid);
        var other = lp.filter(function (f) {
          // adoptive or step parents don't stop a birth parent being linked
          var k = f.kids.find(function (x) { return x.id === q.linkId; });
          return f.b && k.ra === 'bio' && k.rb === 'bio' && (q.kind === 'child' ? f.a !== pid && f.b !== pid : f !== mine);
        });
        if (other.length && (q.kind === 'child' || mine)) return refuse(FE.givenOf(linked) + ' вже має обох батьків. Щоб додати ще когось, відкрийте ' + FE.givenOf(linked) + ' і натисніть «Додати батька чи матір» — там можна вказати вітчима, мачуху чи усиновлювача.');
      }
      var res = (function () {
        if (q.tab === 'link') id = q.linkId;
        else {
          id = FE.newId(d, 'p');
          var nm = qaName(d, q);
          d.people[id] = newPerson(id, { given: nm.given, surname: nm.surname, sex: q.sex, year: born.val });
        }
        newId = id;
        if (q.kind === 'partner') {
          var solo = q.alsoParent && q.soloFam && d.families.find(function (x) { return x.id === q.soloFam && !x.b; });
          if (solo) { solo.b = id; solo.type = q.unionType; solo.kids.forEach(function (k) { k.rb = 'bio'; }); }
          else d.families.push({ id: FE.newId(d, 'f'), a: pid, b: id, type: q.unionType, start: '', end: '', kids: [] });
        } else if (q.kind === 'child') {
          var f = q.withFam !== 'none' ? d.families.find(function (x) { return x.id === q.withFam; }) : null;
          if (!f) {
            f = d.families.find(function (x) { return x.a === pid && !x.b; });
            if (!f) { f = { id: FE.newId(d, 'f'), a: pid, b: null, type: 'none', start: '', end: '', kids: [] }; d.families.push(f); }
          }
          if (!f.kids.some(function (k) { return k.id === id; })) FE.insertKid(d, f, { id: id, ra: 'bio', rb: 'bio' });
        } else if (q.kind === 'parent') {
          pf = FE.primaryParentFam(d, pid);
          if (!pf) {
            // a parent already raising children alone: this child joins that family
            var own = d.families.find(function (x) { return x.a === id && !x.b; });
            if (own) FE.insertKid(d, own, { id: pid, ra: 'bio', rb: 'bio' });
            else d.families.push({ id: FE.newId(d, 'f'), a: id, b: null, type: 'none', start: '', end: '', kids: [{ id: pid, ra: 'bio', rb: 'bio' }] });
          }
          else if (!pf.b) {
            // the two parents may already be a couple: move the children into that family
            var couple = d.families.find(function (x) { return x !== pf && ((x.a === pf.a && x.b === id) || (x.a === id && x.b === pf.a)); });
            if (couple) {
              var aSide = couple.a === pf.a, moving = q.alsoSiblings ? pf.kids : pf.kids.filter(function (k) { return k.id === pid; });
              moving.forEach(function (k) { if (!couple.kids.some(function (c) { return c.id === k.id; })) FE.insertKid(d, couple, aSide ? { id: k.id, ra: k.ra, rb: 'bio' } : { id: k.id, ra: 'bio', rb: k.ra }); });
              pf.kids = pf.kids.filter(function (k) { return moving.indexOf(k) < 0; });
            } else if (pf.kids.length > 1 && !q.alsoSiblings) {
              // only this child gets the new parent; the others keep their one known parent
              var mine = pf.kids.find(function (k) { return k.id === pid; });
              pf.kids = pf.kids.filter(function (k) { return k.id !== pid; });
              d.families.push({ id: FE.newId(d, 'f'), a: pf.a, b: id, type: 'married', start: '', end: '', kids: [{ id: pid, ra: mine.ra, rb: 'bio' }] });
            } else { pf.b = id; if (pf.type === 'none') pf.type = 'married'; pf.kids.forEach(function (k) { k.rb = 'bio'; }); }
          }
          else {
            var own2 = d.families.find(function (x) { return x.a === id && !x.b; });
            if (own2) FE.insertKid(d, own2, { id: pid, ra: q.parentRel || 'step', rb: 'bio' });
            else d.families.push({ id: FE.newId(d, 'f'), a: id, b: null, type: 'none', start: '', end: '', kids: [{ id: pid, ra: q.parentRel || 'step', rb: 'bio' }] });
          }
        } else if (q.kind === 'sibling') {
          pf = FE.primaryParentFam(d, pid);
          // an existing sibling who already has parents: this person joins that family
          var theirs = !pf && q.tab === 'link' ? FE.primaryParentFam(d, id) : null;
          if (theirs) { if (!theirs.kids.some(function (k) { return k.id === pid; })) FE.insertKid(d, theirs, { id: pid, ra: 'bio', rb: 'bio' }); return; }
          if (!pf) {
            var uid = FE.newId(d, 'p');
            d.people[uid] = newPerson(uid, {});
            pf = { id: FE.newId(d, 'f'), a: uid, b: null, type: 'none', start: '', end: '', kids: [{ id: pid, ra: 'bio', rb: 'bio' }] };
            d.families.push(pf);
          }
          if (!pf.kids.some(function (k) { return k.id === id; })) FE.insertKid(d, pf, { id: id, ra: 'bio', rb: 'bio' });
        }
      })();
      if (res === false) return false;
      if (q.tab === 'link' && FE.hasLoop(d) && !FE.hasLoop(s.data)) return refuse('Так не можна: хтось став би власним предком. Перевірте, кого ви вибрали.');
    }, {
      toast: function (d) { return (q.tab === 'link' ? 'Пов’язано: ' : 'Додано: ') + FE.nameOf(d.people[newId]) + ' (' + (q.kind === 'partner' && d.people[newId].sex === 'f' ? 'партнерка' : KIND[q.kind].nom) + ')'; },
      touch: q.pid,
      state: { qa: another ? Object.assign({}, q, { name: '', surname: q.surname, year: '', linkId: null, linkQuery: '', err: '', tab: 'new',
        // the next parent is usually the other one
        sex: q.kind === 'parent' ? (q.sex === 'm' ? 'f' : q.sex === 'f' ? 'm' : 'u') : q.sex }) : null, focusReq: another ? 'qa-name' : null },
      // without "add another", focus moves to the new person's card
      after: function () { if (newId) { set({ pulseId: newId, focusReq: another ? s.focusReq : 'card:' + newId }); later('pulse', 1600, function () { set({ pulseId: null }); }); } }
    });
    if (refused) patchQa({ err: refused });
  }

  /* ================================================================ storage actions */
  function connect() {
    if (!St.S.fsSupported) { toast('Для збереження в папку потрібен Chrome або Edge. Можна й далі працювати в цьому браузері.', false); return; }
    set({ menuOpen: false, statusOpen: false });
    St.connect(s.data || emptyData()).then(function (r) {
      if (r.empty) {
        set({ screen: 'app' });
        hist = []; fut = [];
        startEmpty();
        toast('Папка «' + St.S.folderName + '» готова. Почніть дерево з першої особи — зміни зберігатимуться в ній автоматично.', false);
        return;
      }
      if (r.load) { hist = []; fut = []; loadData(r.load, { screen: 'app' }); }
      else if (Object.keys(r.rewrite).length) { s.rev++; layoutCache = null; }
      set({ screen: 'app' });
      if (r.conflict) return;
      toast((r.load ? 'Відкрито дерево з «' : 'Підключено до «') + St.S.folderName + '». Зміни тепер зберігаються автоматично.' +
        (St.S.keptAs ? ' Попереднє дерево з цього браузера збережено як backups/' + St.S.keptAs + '.' : ''), false);
      St.S.keptAs = '';
    }, function (e) { if (e && e.name !== 'AbortError') toast('Не вдалося підключити папку: ' + (e.message || e), false); });
  }
  function grant() {
    set({ menuOpen: false });
    St.allow(s.data).then(function (r) {
      var n = r.n;
      if (r.load) { hist = []; fut = []; loadData(r.load, { screen: 'app' }); toast('Відкрито новішу версію з «' + St.S.folderName + '»', false); }
      // refused or the folder can't be reached: the status popover says why and offers the folder picker
      set({ statusOpen: St.S.perm !== 'granted' });
      if (St.S.perm === 'granted' && n) toast('Збереження відновлено — ' + count(n, 'зміну', 'зміни', 'змін') + ' записано в «' + St.S.folderName + '»', false);
    });
  }
  function download() {
    set({ menuOpen: false, statusOpen: false });
    var browser = St.S.mode !== 'folder';
    St.download(s.data).then(function (r) {
      var ph = r.photos ? ' — разом із ' + count(r.photos, 'фото', 'фото', 'фото') : '';
      if (r.missing) toast('family.js завантажено, але ' + count(r.missing, 'фото', 'фото', 'фото') + ' не вдалося додати' + (St.S.mode === 'folder' && St.S.perm !== 'granted' ? ': спершу дозвольте збереження.' : '.'), false);
      else if (!browser) toast('family.js завантажено' + ph + '. Його можна відкрити в будь-якій папці через «Імпорт».', false);
      else if (r.first) set({ explainerOpen: true });
      else toast('family.js завантажено — замініть ним старий файл у папці.', false);
    });
  }
  function backup() {
    set({ menuOpen: false, statusOpen: false });
    St.backupNow(s.data).then(function (m) { toast(m, false); }, function (e) { toast('Не вдалося створити копію: ' + e.message, false); });
  }
  function exportGed() {
    set({ menuOpen: false });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([FA.Gedcom.write(s.data)], { type: 'text/plain' }));
    a.download = 'family.ged';
    document.body.appendChild(a); a.click(); a.remove();
    toast('family.ged завантажено — ' + count(Object.keys(s.data.people).length, 'людина', 'людини', 'людей') + ', ' + count(s.data.families.length, 'родина', 'родини', 'родин'), false);
  }
  function importFile() {
    set({ menuOpen: false });
    var inp = el('input', { type: 'file', accept: '.js,.json,.ged', style: 'display:none' });
    inp.addEventListener('change', function () {
      var f = inp.files[0]; inp.remove();
      if (!f) return;
      var kept = '';
      // the tree in the folder is replaced: a copy goes to backups/ first, or nothing is replaced
      St.readImport(f).then(function (d) { return keepCopy().then(function (name) { kept = name; return d; }); }).then(St.adoptPhotos).then(function (d) {
        var was = s.data;
        d.meta = Object.assign({}, d.meta, { sample: false });
        loadData(d, { screen: 'app' });
        if (was && !(was.meta && was.meta.sample)) hist.push(was);
        fut = [];
        St.changed(s.data);
        var lost = St.S.importMissing;
        toast('Імпортовано ' + f.name + ' — ' + count(Object.keys(d.people).length, 'людина', 'людини', 'людей') + (kept ? '. Попереднє дерево збережено в backups/' + kept : '') +
          (lost ? '. ' + count(lost, 'фото', 'фото', 'фото') + ' не знайдено: файл посилається на photos/ іншої папки. Відкрийте дерево з тієї папки й завантажте family.js через меню ☰ — тоді фото ввійдуть у файл.' : ''), true);
      }).catch(function (e) { toast('Не вдалося імпортувати: ' + (e instanceof SyntaxError ? 'файл пошкоджено або це не family.js чи GEDCOM' : e && e.message || e), false); });
    });
    document.body.appendChild(inp);
    inp.click();
  }
  // Before the folder's tree is replaced (import, a new empty tree): a copy in backups/. Resolves with
  // its name, or '' when there is no folder tree to keep; rejects when the copy can't be written.
  function keepCopy() {
    var S = St.S;
    if (S.mode !== 'folder' || S.perm !== 'granted' || !s.data || !Object.keys(s.data.people).length || (s.data.meta && s.data.meta.sample)) return Promise.resolve('');
    return St.backupNow(s.data).then(function (msg) { return msg.split('backups/')[1] || ''; }, function (e) {
      throw new Error('копію поточного дерева в backups/ записати не вийшло (' + (e && e.message || e) + '), тож нічого не змінено');
    });
  }
  A.keepCopy = keepCopy;
  function emptyData() {
    return { title: 'Родинний архів', rootId: null, meta: { version: 1, revision: 0, sample: false, savedAt: '' }, people: {}, families: [] };
  }
  function startEmpty() {
    if (s.otherTab) return;
    // undo can't bring the sample back into the user's own folder
    if (s.data && s.data.meta && s.data.meta.sample) hist = []; else hist.push(s.data);
    fut = [];
    loadData(emptyData(), { screen: 'app' });
    St.rememberChoice();
    set({ sampleNote: false, drawerOpen: false, menuOpen: false, view: 'tree', qa: null, first: { name: '', sex: 'u', year: '' } });
    St.changed(s.data);
  }
  function addFirst() {
    var f = s.first;
    if (!String(f.name).trim()) { toast('Вкажіть ім’я.', false); return; }
    var born = qaDate(f.year);
    if (!born.ok) { toast('Не вдалося прочитати дату. Підійде 1931, 12.03.1931 або 12 березня 1931.', false); return; }
    var id = null;
    commit(function (d) {
      id = FE.newId(d, 'p');
      var nm = FE.splitName(f.name, '');
      d.people[id] = newPerson(id, { given: nm.given, surname: nm.surname, sex: f.sex, year: born.val });
      d.rootId = id;
      if (nm.surname) d.title = 'Родинний архів · ' + nm.surname;
    }, { toast: 'У дереві є перша особа. Додавайте родину кнопками +.', undo: false, state: { centered: false, drawerOpen: false, first: { name: '', sex: 'u', year: '' } }, after: function () { set({ focusId: id }); } });
  }
  function addFromSearch() {
    var nm = splitNameUk(s.search, '', s.data), id = null, label = s.search;
    commit(function (d) {
      id = FE.newId(d, 'p');
      d.people[id] = newPerson(id, { given: nm.given, surname: nm.surname });
    }, { toast: 'Додано: ' + (label || 'нова особа') + ' — пов’яжіть із родичами кнопками +', state: { search: '', searchOpen: false }, after: function () { focusPerson(id); set({ drawerOpen: true }); } });
  }
  function loadData(d, extra) {
    d.people = d.people && typeof d.people === 'object' ? d.people : {};
    d.families = Array.isArray(d.families) ? d.families : [];
    // tidy for display; it reaches the file with the next real edit
    St.normalize(d);
    FE.tidyFamilies(d);
    if (!d.meta.version) d.meta.version = 1;
    layoutCache = null;
    St.setCurrent(d);
    Object.assign(s, { data: d, rev: s.rev + 1, focusId: d.rootId, centered: false, editMode: false, relEdit: null, qa: null, notesEdit: false, captionEdit: null, frameEdit: null, lightbox: null }, extra || {});
    schedule();
  }
  function setPresent(on) {
    Object.assign(s, { present: on, editMode: false, qa: null, relEdit: null, relConfirm: false, notesEdit: false, captionEdit: null, frameEdit: null, menuOpen: false, moreOpen: false });
    setPref('present', on ? '1' : '0');
    try { history.replaceState(null, '', on ? '#present' : location.pathname + location.search); } catch (e) { /* file:// may refuse */ }
    schedule();
  }

  /* ================================================================ render orchestration */
  function captureFocus() {
    var a = document.activeElement;
    var keep = { scroll: {} };
    ['.ft-drawer__scroll', '.ft-list', '.ft-picker', '.ft-menu'].forEach(function (sel) { var n = root.querySelector(sel); if (n) keep.scroll[sel] = n.scrollTop; });
    keep.drawerFor = lastDrawerFor;
    if (a && root.contains(a) && a.getAttribute('data-k')) {
      keep.k = a.getAttribute('data-k');
      try { keep.ss = a.selectionStart; keep.se = a.selectionEnd; } catch (e) { /* not a text field */ }
      keep.el = a;
    }
    return keep;
  }
  var reduceMotion = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var lastDrawerFor = null;
  function restoreFocus(keep) {
    // the drawer keeps its scroll position only while it shows the same person
    Object.keys(keep.scroll).forEach(function (sel) { var n = root.querySelector(sel); if (n && (sel !== '.ft-drawer__scroll' || keep.drawerFor === s.focusId)) n.scrollTop = keep.scroll[sel]; });
    lastDrawerFor = s.focusId;
    var req = s.focusReq;
    if (req) {
      s.focusReq = null;
      var t = root.querySelector('[data-k="' + CSS.escape(req) + '"]');
      if (t) {
        try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        // only scroll real scroll areas; scrolling inside the canvas would shift the tree
        if (t.closest('.ft-drawer__scroll, .ft-list')) (t.closest('.ft-confirm, .ft-releditor') || t).scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
        return;
      }
    }
    if (!keep.k) return;
    var n = root.querySelector('[data-k="' + CSS.escape(keep.k) + '"]');
    if (!n || n === keep.el && document.activeElement === n) return;
    try { n.focus({ preventScroll: true }); if (keep.ss != null && n.setSelectionRange) n.setSelectionRange(keep.ss, keep.se); } catch (e) { /* ignore */ }
  }

  function render() {
    queued = false;
    if (!root) return;
    var keep = captureFocus();
    root.className = ['ft-app ft-theme', 'is-' + s.density, isPhone() ? 'is-phone' : '', isTablet() ? 'is-tablet is-touch' : '', touchOnly ? 'is-touch' : '', s.dragging ? 'is-dragging' : '', s.present ? 'is-present' : '', 'is-view-' + s.view, s.drawerOpen && s.screen === 'app' && P(s.focusId) ? 'is-drawer' : ''].join(' ');
    root.setAttribute('data-theme', s.theme);
    document.documentElement.setAttribute('data-theme', s.theme);
    renderTopbar();
    renderBanners();
    renderMain();
    FA.renderDrawer(dom.drawerSlot, A);
    FA.renderOverlays(dom.overlays, A);
    renderToast();
    restoreFocus(keep);
  }
  var touchOnly = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  /* ---------------------------------------------------------------- top bar */
  function seg(items, aria, full) {
    return el('div.ft-seg' + (full ? '.ft-seg--full' : ''), { role: 'group', 'aria-label': aria },
      items.map(function (o) { return el('button', { type: 'button', 'aria-pressed': String(!!o.sel), on: { click: o.pick }, 'data-k': o.k }, o.label); }));
  }
  A.seg = seg;

  function statusInfo() {
    var S = St.S, n = S.pending;
    var r = { cls: 'is-ok', label: 'Збережено в папці', title: 'Усі зміни є у family.js у «' + S.folderName + '»', count: 0, download: false, click: function () { set({ statusOpen: !s.statusOpen, explainerOpen: false }); } };
    if (S.conflict) { r.cls = 'is-danger'; r.label = 'Дві версії'; r.title = 'family.js змінили деінде — виберіть, яку версію залишити'; }
    else if (S.saveError) { r.cls = 'is-danger'; r.label = 'Не вдалося зберегти'; r.title = 'Не вдалося записати в папку — натисніть, щоб побачити варіанти'; }
    else if (S.mode === 'browser' && !S.idbOk) { r.cls = 'is-danger'; r.label = 'Не зберігається'; r.title = 'Браузер не дає зберігати дані — завантажте family.js, щоб не втратити зміни'; r.count = n; r.download = true; }
    else if (S.mode === 'folder' && S.perm === 'prompt') { r.cls = 'is-warn'; r.label = 'Дозволити збереження'; r.title = 'Один клік — і цей сеанс знову може записувати в «' + S.folderName + '»'; r.count = n; r.click = grant; }
    else if (S.mode === 'folder' && (S.saving || n > 0)) { r.cls = 'is-saving'; r.label = 'Збереження…'; }
    // nothing to lose yet in an empty tree
    else if (S.mode !== 'folder' && n > 0 && s.data && Object.keys(s.data.people).length) { r.cls = 'is-warn'; r.label = 'Ще не у файлі'; r.title = 'Зміни збережено в цьому браузері, але у ваш family.js вони ще не потрапили'; r.download = true; }
    else if (S.mode !== 'folder') { r.cls = 'is-neutral'; r.label = 'Збережено лише в браузері'; r.title = 'Дерево зберігається в цьому браузері — завантажте family.js, щоб мати копію-файл'; }
    return r;
  }
  function statusPop() {
    var S = St.S, n = S.pending, act = function (label, go, cls) { return el('button.ft-btn.ft-btn--sm' + (cls ? '.' + cls : ''), { type: 'button', on: { click: go } }, label); };
    if (S.conflict) return { title: 'Дві версії дерева', body: 'family.js у «' + S.folderName + '» змінили деінде, поки тут були незбережені зміни. Автозбереження зупинено, доки ви не виберете. Іншу версію буде збережено в backups/.', actions: [act('Відкрити версію з папки', function () { set({ statusOpen: false }); resolveConflict('theirs'); }, 'ft-btn--primary'), act('Залишити мою', function () { set({ statusOpen: false }); resolveConflict('mine'); })] };
    if (S.saveError) return { title: 'Не вдалося зберегти', body: (S.saveErrorText ? S.saveErrorText + '. Виправте або приберіть файл і спробуйте ще. ' : 'Родинний архів не зміг записати в «' + S.folderName + '». Папку могли перемістити, перейменувати або відкрити в іншому вікні. ') + count(n, 'зміна', 'зміни', 'змін') + ' в безпеці в цьому браузері.', actions: [act('Спробувати ще', retrySave, 'ft-btn--primary'), act('Вибрати папку…', connect)] };
    // a private window or a full disk: nothing outlives the tab
    if (S.mode === 'browser' && !S.idbOk) return { title: 'Браузер не зберігає зміни', body: 'Цей браузер не дає сторінці зберігати дані — так буває в приватному вікні або коли бракує місця на диску. Після закриття вкладки зміни зникнуть. Завантажте family.js або підключіть папку.',
      actions: [act('Завантажити family.js', download, 'ft-btn--primary')].concat(S.fsSupported ? [act('Вибрати папку…', connect)] : []) };
    if (S.mode === 'folder' && S.perm === 'prompt') {
      var why = S.permError === 'denied' ? 'Браузер не дав дозволу. Натисніть «Дозволити збереження» ще раз і в запиті біля адресного рядка виберіть «Дозволити» (або варіант «завжди», якщо він є).'
        : S.permError ? 'Браузер не може відкрити папку «' + S.folderName + '»: її могли перемістити, перейменувати або видалити. Виберіть папку з даними ще раз.'
        : 'Браузер раз за сеанс питає, чи може сторінка записувати в «' + S.folderName + '».';
      return { title: 'Збереження призупинено', body: why + ' ' + (n ? count(n, 'зміна чекає', 'зміни чекають', 'змін чекають') + ' в безпеці в цьому браузері.' : 'Поки нічого не чекає.'),
        actions: S.permError && S.permError !== 'denied' ? [act('Вибрати папку…', connect, 'ft-btn--primary'), act('Дозволити збереження', grant)] : [act('Дозволити збереження', grant, 'ft-btn--primary'), act('Вибрати папку…', connect)] };
    }
    if (S.mode === 'folder') return { title: 'Збережено в папці', body: 'Кожна зміна записується у family.js у «' + S.folderName + '» приблизно за секунду.' + (S.lastSaved ? ' Востаннє збережено о ' + S.lastSaved + '.' : ''), actions: [act('Створити резервну копію', backup), act('Змінити папку…', connect)] };
    if (n > 0 && s.data && Object.keys(s.data.people).length) return { title: 'Зміни лише в цьому браузері', body: 'Вони збережені в цьому браузері, але family.js у вашій папці їх ще не має (' + count(n, 'зміна', 'зміни', 'змін') + '). Завантажте свіжий family.js і замініть ним старий.', actions: [act('Завантажити family.js', download, 'ft-btn--primary')].concat(S.fsSupported ? [act('Вибрати папку з даними…', connect)] : []) };
    return { title: 'Збережено лише в браузері', body: (S.lastDownload ? 'Нічого нового відтоді, як ви завантажили family.js ' + FA.whenAt(S.lastDownload) + '. ' : 'Дерево зберігається в цьому браузері. ') + 'Очищення даних сайту в браузері видалить його, тож тримайте завантажений family.js у папці як основну копію.', actions: [act('Завантажити family.js', download)].concat(S.fsSupported ? [act('Вибрати папку з даними…', connect)] : []) };
  }
  function retrySave() { set({ statusOpen: false }); St.retry(); }
  function resolveConflict(which) {
    St.resolve(which).then(function (r) {
      if (!r) return;
      if (which === 'theirs') { hist = []; fut = []; loadData(r.data, { screen: 'app' }); }
      toast(which === 'theirs' ? 'Відкрито версію з папки. Вашу записано в backups/' + r.backup + '.'
        : (r.saved ? 'Вашу версію збережено в папці. Іншу записано в backups/' + r.backup + '.' : 'Іншу версію записано в backups/' + r.backup + ', але вашу поки не вдалося зберегти — дивіться стан угорі.'), false);
    }, function (e) { toast('Нічого не змінено: не вдалося записати копію в backups/ (' + (e && e.message || e) + ').', false); });
  }
  // Back to this tab: family.js may have been changed meanwhile on another computer.
  function checkFile() {
    if (s.otherTab || s.screen !== 'app') return;
    St.check().then(function (r) {
      if (r && r.load) { hist = []; fut = []; loadData(r.load, { screen: 'app' }); toast('Відкрито новішу версію з «' + St.S.folderName + '»', false); }
    });
  }

  function renderTopbar() {
    var d = s.data, phone = isPhone(), tablet = isTablet(), bar = dom.topbar;
    bar.textContent = '';
    if (!d) { bar.appendChild(el('div.ft-brand', null, el('span.ft-brand__mark', { 'aria-hidden': 'true' }, icon('book', 'ft-ico--lg')), el('h1.ft-brand__title', null, 'Родинний архів'))); return; }
    var viewOnly = viewOnlyScreen() || s.present || s.otherTab, sample = sampleMode();
    bar.appendChild(el('div.ft-brand', null,
      el('span.ft-brand__mark', { 'aria-hidden': 'true' }, icon('book', 'ft-ico--lg')),
      el('h1.ft-brand__title', null, d.title || 'Родинний архів'),
      d.meta && d.meta.sample && (!s.sampleNote || sample) && !phone ? el('span.ft-chip.ft-chip--sepia', { title: sample ? sampleWhy() : null }, 'Зразок даних') : null,
      viewOnly || sample ? el('span.ft-chip', null, 'Лише перегляд') : null));
    bar.appendChild(el('nav.ft-tabs', { 'aria-label': 'Подання' }, [['tree', 'Дерево', '1'], ['people', 'Люди', '2'], ['desc', 'Нащадки', '3']].map(function (t) {
      return el('button.ft-tab', { type: 'button', 'aria-pressed': String(s.view === t[0]), 'aria-keyshortcuts': t[2], title: t[1] + ' (' + t[2] + ')', 'data-k': 'tab:' + t[0], on: { click: function () { setView(t[0]); } } }, t[1]);
    })));
    bar.appendChild(renderSearch(phone, tablet));
    bar.appendChild(el('div.ft-spacer'));
    if (phone) bar.appendChild(el('button.ft-icon-btn', { type: 'button', 'aria-label': 'Пошук', 'aria-expanded': String(s.phoneSearch), on: { click: function () { set({ phoneSearch: !s.phoneSearch, focusReq: !s.phoneSearch ? 'search' : null }); } } }, icon('search', 'ft-ico--lg')));
    if (!phone && !s.otherTab && s.screen === 'app' && sample) {
      // the sample banner has the same button until it is dismissed
      if (St.S.fsSupported && !s.sampleNote) bar.appendChild(el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', 'data-k': 'own-tree', title: 'Виберіть порожню папку для нового дерева або папку, де вже є family.js', on: { click: connect } }, icon('folder', 'ft-ico--sm'), 'Своє дерево…'));
    } else if (!phone && !s.otherTab && s.screen === 'app') {
      if (s.present) bar.appendChild(el('button.ft-btn.ft-btn--sm', { type: 'button', 'data-k': 'present', title: 'Повернути кнопки редагування', on: { click: function () { setPresent(false); } } }, icon('edit', 'ft-ico--sm'), 'Редагувати'));
      else {
        bar.appendChild(el('button.ft-btn.ft-btn--sm.ft-btn--ghost.ft-tight', { type: 'button', 'data-k': 'present', 'aria-label': 'Режим перегляду', title: 'Режим перегляду: сховати все для редагування — щоб показати дерево родині', on: { click: function () { setPresent(true); } } }, icon('eye', 'ft-ico--sm'), el('span.ft-btn__label', null, 'Перегляд')));
        bar.appendChild(renderStatus());
      }
    }
    bar.appendChild(el('button.ft-icon-btn', { type: 'button', 'aria-label': 'Меню', 'aria-expanded': String(s.menuOpen), 'data-k': 'menu', on: { click: function () { set({ menuOpen: !s.menuOpen, statusOpen: false, explainerOpen: false }); } } }, icon('menu', 'ft-ico--lg')));
    if (s.menuOpen) bar.appendChild(renderMenu());
  }

  function searchResults() {
    var q = FE.fold(s.search);
    if (!q || !s.data) return [];
    var d = s.data;
    return Object.keys(d.people).map(function (id) { return d.people[id]; }).filter(function (p) { return FE.matches(p, q); })
      .sort(function (a, b) { var sa = FE.fold(FE.nameOf(a)).indexOf(q) === 0 ? 0 : 1, sb = FE.fold(FE.nameOf(b)).indexOf(q) === 0 ? 0 : 1; return sa - sb || FE.byName(a, b); })
      .slice(0, 8);
  }
  function pickResult(id) {
    var v = s.view;
    // focus goes to the chosen person's card, not back to the page
    Object.assign(s, { search: '', searchOpen: false, phoneSearch: false, focusReq: 'card:' + id });
    var inp = root.querySelector('.ft-search__input'); if (inp) inp.blur();
    focusPerson(id, { noOpen: true, view: v === 'people' ? 'tree' : v });
  }
  function renderSearch(phone, tablet) {
    var q = String(s.search || '').trim().toLowerCase(), res = searchResults();
    var box = el('div.ft-search' + (phone && s.phoneSearch ? '.is-open' : ''));
    box.appendChild(icon('search', 'ft-search__icon'));
    box.appendChild(el('input.ft-input.ft-search__input', {
      type: 'search', placeholder: 'Пошук людей', 'aria-label': 'Пошук людей', autocomplete: 'off', value: s.search, 'data-k': 'search',
      // a combobox: screen readers follow the highlighted result while focus stays in the field
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-controls': 'ft-results', 'aria-expanded': String(!!(s.searchOpen && q)),
      'aria-activedescendant': s.searchOpen && q && res[s.searchIdx] ? 'ft-res-' + s.searchIdx : null,
      on: {
        input: function (e) { set({ search: e.target.value, searchOpen: true, searchIdx: 0 }); },
        focus: function () { clearTimeout(timers.sb); if (!s.searchOpen) set({ searchOpen: true }); },
        blur: function () { later('sb', 160, function () { set({ searchOpen: false }); }); },
        keydown: function (e) {
          var r = searchResults();
          if (e.key === 'ArrowDown') { e.preventDefault(); set({ searchIdx: r.length ? (s.searchIdx + 1) % r.length : 0 }); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); set({ searchIdx: r.length ? (s.searchIdx - 1 + r.length) % r.length : 0 }); }
          else if (e.key === 'Enter') { e.preventDefault(); if (r[s.searchIdx]) pickResult(r[s.searchIdx].id); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); set({ search: '', searchOpen: false, phoneSearch: false }); e.target.blur(); }
        }
      }
    }));
    if (!s.search && !tablet) box.appendChild(el('kbd.ft-kbd.ft-search__kbd', null, '/'));
    if (s.searchOpen && q) {
      var list = el('div.ft-results', { role: 'listbox', id: 'ft-results', 'aria-label': 'Знайдені люди' });
      res.forEach(function (p, i) {
        var nm = FE.nameOf(p), at = nm.toLowerCase().indexOf(q);
        var why = at < 0 ? (p.nick && p.nick.toLowerCase().indexOf(q) >= 0 ? '«' + p.nick + '»' : p.birthName && p.birthName.toLowerCase().indexOf(q) >= 0 ? 'з дому ' + p.birthName : (p.birth.place || '')) : '';
        list.appendChild(el('button.ft-result' + (i === s.searchIdx ? '.is-active' : ''), { type: 'button', role: 'option', id: 'ft-res-' + i, tabindex: '-1', 'aria-selected': String(i === s.searchIdx), on: { mousedown: function (e) { e.preventDefault(); pickResult(p.id); } } },
          avatar(p),
          el('span', null,
            el('span.ft-result__name', null, at >= 0 ? [nm.slice(0, at), el('span.is-mark', null, nm.slice(at, at + q.length)), nm.slice(at + q.length)] : nm),
            el('span.ft-result__meta', null, [FE.yearsOf(p), why || p.birth.place].filter(Boolean).join(' · ')))));
      });
      if (!res.length) list.appendChild(el('div.ft-results__empty', null, el('span', null, 'Ще немає нікого на ім’я «' + s.search.trim() + '».'),
        !ro() ? el('button.ft-btn.ft-btn--sm', { type: 'button', on: { mousedown: function (e) { e.preventDefault(); addFromSearch(); } } }, 'Додати «' + s.search.trim() + '» як нову особу') : null));
      box.appendChild(list);
    }
    return box;
  }

  function renderStatus() {
    var st = statusInfo();
    var box = el('div.ft-statusbox');
    box.appendChild(el('button.ft-status.' + st.cls, { type: 'button', title: st.title, 'aria-expanded': String(s.statusOpen), 'data-k': 'status', on: { click: st.click } },
      el('span.ft-status__dot', { 'aria-hidden': 'true' }), el('span', null, st.label),
      st.count > 0 ? el('span.ft-status__count', null, '· ' + count(st.count, 'зміна чекає', 'зміни чекають', 'змін чекають')) : null));
    if (st.download) box.appendChild(el('button.ft-btn.ft-btn--sm.ft-btn--warn.ft-tight', { type: 'button', 'aria-label': 'Завантажити family.js', title: 'Завантажити family.js', on: { click: download } }, icon('download'), el('span.ft-btn__label', null, 'Завантажити')));
    if (s.statusOpen) {
      var sp = statusPop();
      box.appendChild(el('div.ft-pop.ft-pop--right', { role: 'dialog', 'aria-label': 'Де зберігаються зміни' },
        el('div.ft-pop__head', null, el('h3.ft-pop__title', null, sp.title), closeBtn(function () { set({ statusOpen: false }); })),
        el('p.ft-pop__body', null, sp.body),
        el('div.ft-pop__actions', null, sp.actions)));
    }
    if (s.explainerOpen) {
      box.appendChild(el('div.ft-pop.ft-pop--right', { role: 'dialog', 'aria-labelledby': 'ft-exp-title', style: 'width: 372px' },
        el('div.ft-pop__head', null, el('h3.ft-pop__title', { id: 'ft-exp-title' }, 'Тепер замініть family.js новим'), closeBtn(function () { set({ explainerOpen: false }); })),
        el('p.ft-pop__body', null, 'Цей браузер не вміє писати у вашу папку, тож збереження — це заміна файлу. Робіть це, коли захочете оновити копію в папці, — тим часом ваші зміни в безпеці в цьому браузері.'),
        el('div.ft-filemove', null, el('span.ft-filemove__file', null, 'Завантаження/family.js'), icon('arrowRight'), el('span.ft-filemove__file', null, 'папка родини/family.js')),
        el('ol.ft-steps', null,
          el('li', null, 'Відкрийте папку «Завантаження» і знайдіть family.js.'),
          el('li', null, 'Перемістіть його в папку родини, поруч з index.html, і виберіть «Замінити».'),
          el('li', null, 'Наступного разу, коли відкриєте index.html, ці зміни завантажаться з файлу.')),
        el('p.ft-hint', null, 'Якщо файл завантажився як «family (1).js», перейменуйте його на family.js перед переміщенням.'),
        el('div.ft-pop__foot', null, el('span.ft-hint', null, 'Показується один раз'), el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: function () { set({ explainerOpen: false }); } } }, 'Зрозуміло'))));
    }
    return box;
  }
  function closeBtn(fn, label, k) {
    return el('button.ft-icon-btn.ft-icon-btn--sm', { type: 'button', 'aria-label': label || 'Закрити', 'data-k': k || null, on: { click: fn } }, icon('close'));
  }
  A.closeBtn = closeBtn;

  function renderMenu() {
    var S = St.S, folder = S.mode === 'folder', sample = S.mode === 'sample';
    var item = function (ic, label, go, hint, cls) {
      return el('button.ft-menu__item' + (cls ? '.' + cls : ''), { type: 'button', on: { click: go } }, icon(ic), label, hint ? el('span.ft-menu__hint', null, hint) : null);
    };
    var canEdit = !ro() || (s.present && s.screen === 'app' && !viewOnlyScreen() && !s.otherTab);
    var m = el('div.ft-menu', { role: 'group', 'aria-label': 'Меню' });
    m.appendChild(el('div.ft-menu__storage', null,
      el('span', null, folder ? icon('folderOk', 'ft-ico--lg') : icon('browser', 'ft-ico--lg')),
      el('span', null,
        el('span.ft-menu__storage-t', { style: 'display:block' }, folder ? 'Збереження в «' + S.folderName + '»' : sample ? 'Зразок даних' : 'Збережено лише в цьому браузері'),
        el('span.ft-menu__storage-s', { style: 'display:block' }, sample ? sampleWhy() : folder ? (S.perm === 'prompt' ? 'Призупинено, доки ви не дозволите збереження в цьому сеансі' : 'family.js і photos/ записуються автоматично') : (S.fsSupported ? 'Підключіть папку, щоб зберігати автоматично' : 'Цей браузер не вміє писати в папки — завантажте family.js, щоб зберегти')))));
    if (canEdit && !s.present) {
      if (folder && S.perm === 'prompt') m.appendChild(item('folderOk', 'Дозволити збереження', grant, null, 'is-accent'));
      if (S.fsSupported) m.appendChild(item('folder', folder ? 'Змінити папку з даними…' : 'Підключити папку з даними…', connect));
      m.appendChild(el('div.ft-menu__sep', { role: 'separator' }));
      m.appendChild(el('div.ft-menu__label', null, 'Файл'));
      m.appendChild(item('download', 'Завантажити family.js', download));
      m.appendChild(item('download', 'Експорт GEDCOM (.ged)', exportGed));
      m.appendChild(item('upload', 'Імпорт family.js або GEDCOM…', importFile));
      m.appendChild(item('backup', 'Резервна копія', backup, folder ? 'у backups/' : 'файлом'));
    } else {
      if (sample && S.fsSupported && !viewOnlyScreen()) m.appendChild(item('folder', 'Створити або відкрити своє дерево…', connect, null, 'is-accent'));
      m.appendChild(el('div.ft-menu__sep', { role: 'separator' }));
      m.appendChild(el('div.ft-menu__label', null, 'Файл'));
      m.appendChild(item('download', 'Експорт GEDCOM (.ged)', exportGed));
    }
    var nIssues = Object.keys(issues()).length;
    if (!sample) m.appendChild(item('alert', 'Перевірка даних', function () { set({ menuOpen: false, listFilter: 'issues' }); setView('people'); }, nIssues ? count(nIssues, 'людина', 'людини', 'людей') : 'усе гаразд'));
    if (s.data && s.data.people[s.focusId] && !isPhone()) m.appendChild(item('print', 'Надрукувати постер…', function () { set({ posterOpen: true, focusReq: 'poster-close', menuOpen: false, moreOpen: false, qa: null }); }));
    m.appendChild(el('div.ft-menu__sep', { role: 'separator' }));
    m.appendChild(el('div.ft-menu__label', null, 'Вигляд'));
    m.appendChild(el('div.ft-menu__row', null, el('span', null, 'Тема'), seg([['system', 'Авто'], ['light', 'Світла'], ['dark', 'Темна']].map(function (t) {
      return { label: t[1], sel: s.theme === t[0], pick: function () { setPref('theme', t[0]); set({ theme: t[0] }); } };
    }), 'Тема')));
    m.appendChild(el('div.ft-menu__row', null, el('span', null, 'Картки'), seg([['compact', 'Компактні'], ['expanded', 'Детальні']].map(function (t) {
      return { label: t[1], sel: s.density === t[0], pick: function () { setDensity(t[0]); } };
    }), 'Вигляд карток')));
    if (!viewOnlyScreen() && !s.otherTab) m.appendChild(item('eye', s.present ? 'Вийти з режиму перегляду' : 'Режим перегляду', function () { setPresent(!s.present); }));
    m.appendChild(item('keyboard', 'Гарячі клавіші', function () { set({ showKeys: true, menuOpen: false, focusReq: 'keys-close' }); }, el('kbd.ft-kbd', null, '?')));
    if (canEdit && !s.present) {
      m.appendChild(el('div.ft-menu__sep', { role: 'separator' }));
      m.appendChild(item('trash', 'Почати порожнє дерево…', function () { set({ menuOpen: false, confirm: { kind: 'empty' } }); }, null, 'ft-menu__item--danger'));
    }
    return m;
  }

  // Why the published site shows the sample, and what it takes to keep one's own tree.
  function sampleWhy() {
    if (!St.S.fsSupported) return 'Власне дерево можна вести в Chrome або Edge на комп’ютері: лише вони вміють зберігати його у папку. Тут можна переглянути зразок.';
    return 'Щоб вести своє дерево, виберіть папку на комп’ютері: усе зберігається лише там, у файлі family.js, а сайт нічого не вивантажує.';
  }

  /* ---------------------------------------------------------------- new version */
  // The published site carries version.json; this page was built as window.APP_VERSION.
  // Checked at start, every 15 minutes and when the tab comes back into view.
  function checkVersion() {
    var mine = window.APP_VERSION;
    if (!St.S.hosted || !mine || mine === 'dev' || s.updateReady || !window.fetch) return;
    fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
      if (v && v.version && v.version !== mine) set({ updateReady: true });
    }, function () { /* offline: try later */ });
  }
  function reloadForUpdate() {
    set({ updating: true });
    St.flush().then(function () { location.reload(); });
  }

  /* ---------------------------------------------------------------- banners */
  function banner(cls, role, ic, strong, text, actions) {
    return el('div.ft-banner' + (cls ? '.' + cls : ''), { role: role }, icon(ic, 'ft-banner__ico'),
      el('div.ft-banner__text', null, el('strong', null, strong), text), el('div.ft-banner__actions', null, actions));
  }
  function renderBanners() {
    var real = dom.banners, S = St.S, b = document.createElement('div');
    renderBannersInto(b, S);
    var sig = b.innerHTML;
    if (real._sig === sig) return;
    real._sig = sig;
    real.textContent = '';
    while (b.firstChild) real.appendChild(b.firstChild);
  }
  function renderBannersInto(b, S) {
    if (s.screen !== 'app' || !s.data) return;
    if (s.otherTab) b.appendChild(s.otherTabGone
      ? banner('is-warn', 'status', 'lock', 'Іншу вкладку закрито.', ' Оновіть сторінку, щоб редагувати тут.', [el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: function () { location.reload(); } } }, 'Оновити')])
      : banner('is-warn', 'status', 'lock', 'Архів уже відкрито в іншій вкладці.', ' Тут лише перегляд, щоб зміни з двох вкладок не затерли одна одну.', []));
    if (S.conflict && !s.otherTab) {
      b.appendChild(banner('is-danger', 'alert', 'alert', 'family.js у «' + S.folderName + '» змінили деінде.',
        ' Мабуть, на іншому комп’ютері чи в іншому браузері, поки тут були незбережені зміни. Виберіть, яку версію залишити: іншу буде збережено в backups/.',
        [el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: function () { resolveConflict('theirs'); } } }, 'Відкрити версію з папки'),
          el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: function () { resolveConflict('mine'); } } }, 'Залишити мою')]));
    }
    if (s.updateReady && !s.otherTab) b.appendChild(banner('', 'status', 'info', 'Вийшла нова версія Родинного архіву.', ' Ваші дані в безпеці — оновлення займе секунду.',
      [el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', disabled: s.updating, on: { click: reloadForUpdate } }, s.updating ? 'Оновлення…' : 'Оновити')]));
    if (s.present || s.otherTab) return;
    if (S.mode === 'folder' && S.perm === 'prompt' && S.permBanner) {
      b.appendChild(banner('is-warn', 'status', 'lock', 'Збереження в «' + S.folderName + '» призупинено.',
        ' Браузери один раз за сеанс питають, чи може сторінка записувати в папку. ' + (S.pending ? count(S.pending, 'зміна чекає', 'зміни чекають', 'змін чекають') + ' в безпеці в цьому браузері.' : 'Поки нічого не чекає.'),
        [el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: grant } }, 'Дозволити збереження'),
          closeBtn(function () { St.dismissPermBanner(); }, 'Сховати — кнопка стану нагадуватиме')]));
    }
    if (S.saveError) {
      b.appendChild(banner('is-danger', 'alert', 'alert', 'Не вдалося зберегти в «' + S.folderName + '».', (S.saveErrorText ? ' ' + S.saveErrorText + '.' : ' Папку могли перемістити, перейменувати або відкрити в іншому вікні.') + ' Ваші зміни в безпеці в цьому браузері.',
        [el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: retrySave } }, 'Спробувати ще'), el('button.ft-btn.ft-btn--sm.ft-btn--ghost', { type: 'button', on: { click: connect } }, 'Вибрати папку…')]));
    }
    if (sampleMode() && s.sampleNote) {
      b.appendChild(banner('', 'note', 'info', 'Це зразок — родина Коваленків.', ' ' + sampleWhy(),
        [St.S.fsSupported && !viewOnlyScreen() ? el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: connect } }, 'Створити або відкрити дерево…') : null,
          closeBtn(function () { setPref('sampleNote', '0'); set({ sampleNote: false }); }, 'Сховати це повідомлення')]));
    } else if (s.data.meta && s.data.meta.sample && s.sampleNote && !isPhone()) {
      b.appendChild(banner('', 'note', 'info', 'Ви переглядаєте зразок даних', ' — родину Коваленків, додану до застосунку, щоб було що досліджувати. Зміни зберігаються, як і в будь-якому іншому дереві.',
        [el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: startEmpty } }, 'Почати порожнє дерево'),
          closeBtn(function () { setPref('sampleNote', '0'); set({ sampleNote: false }); }, 'Сховати це повідомлення')]));
    }
  }

  /* ---------------------------------------------------------------- main */
  function renderMain() {
    var main = dom.main, hasPeople = s.data && Object.keys(s.data.people).length > 0;
    main.setAttribute('aria-label', s.view === 'tree' ? 'Родинне дерево' : s.view === 'people' ? 'Список людей' : 'Нащадки');
    var showTree = s.data && s.view === 'tree' && hasPeople && (s.screen === 'app' || s.screen === 'welcome');
    if (showTree) {
      if (dom.vp.parentNode !== main) { main.textContent = ''; main.appendChild(dom.vp); dom.other = null; }
      renderTree();
    } else {
      if (dom.vp.parentNode === main) main.removeChild(dom.vp);
      main.textContent = '';
      main.appendChild(FA.renderMainView(A));
    }
  }

  /* ---------------------------------------------------------------- tree canvas */
  var nodeEls = {}, lastPos = {}, linesKey = '';

  // The main photo's framing ("x% y%"): which part shows when it's cropped to a square or a frame.
  // It belongs to the photo, so it comes back when that photo is made the main one again.
  function portraitPos(p) {
    var ph = p.photo && (p.photos || []).find(function (x) { return x.src === p.photo; });
    return ph && ph.pos || '';
  }
  function portrait(p, alt, fallback) {
    var i = img(p.photo, alt, fallback), pos = portraitPos(p);
    if (pos && i.tagName === 'IMG') i.style.objectPosition = pos;
    return i;
  }
  A.portrait = portrait; A.portraitPos = portraitPos;
  function avatar(p, cls) {
    var a = el('span.ft-av' + (cls ? '.' + cls : '') + (p.deceased ? '.is-deceased' : ''), { 'aria-hidden': 'true' });
    a.appendChild(p.photo ? portrait(p, '', document.createTextNode(FE.initials(p))) : document.createTextNode(FE.initials(p)));
    return a;
  }
  // <img> for a stored photo; if it can't be shown (yet), `fallback` takes its place.
  function img(src, alt, fallback) {
    var i = el('img', { alt: alt || '', draggable: 'false' });
    var show = function (u) { if (u) i.src = u; else if (fallback) { if (i.parentNode) i.replaceWith(fallback); else i = fallback; } else i.style.visibility = 'hidden'; };
    // a file that is gone (moved, deleted, another folder's path) shows the initials, not a broken image
    i.addEventListener('error', function () { if (fallback && i.parentNode) i.replaceWith(fallback); else i.style.visibility = 'hidden'; });
    var u = St.photoURL(src);
    if (typeof u === 'string') show(u); else u.then(show);
    return i;
  }
  A.avatar = avatar; A.img = img;

  function cardAria(p, isFocus) {
    var y = FE.yearsOf(p);
    return FE.nameOf(p) + (y ? ', ' + y.replace('–', ' — ').replace('нар. ', FE.vf(p, 'народився ', 'народилася ')) : '') + (p.deceased ? ', ' + FE.vf(p, 'помер', 'померла') : '') + (isFocus ? ', вибрано — натисніть Enter, щоб побачити подробиці' : '');
  }

  // When the full name doesn't fit one line of a compact card, the surname moves to a second line;
  // each line still ellipsizes, and the card's title holds the whole name. Measured after layout.
  // Split in two (measure, then change) so a whole tree of cards is measured in one layout pass.
  function nameOverflows(nameEl, p) {
    if (s.density !== 'compact' || !p.given || !p.surname) return false;
    // a short name always fits one line; measuring every card is what's slow
    if ((p.given + p.surname).length < 14) return false;
    var row = nameEl.parentNode;
    return nameEl.scrollWidth > nameEl.clientWidth || row.scrollWidth > row.clientWidth;
  }
  function fitName(nameEl, p) {
    var row = nameEl.parentNode;
    nameEl.textContent = '';
    nameEl.appendChild(el('span', null, p.given.trim()));
    nameEl.appendChild(el('span', null, p.surname.trim()));
    row.classList.add('is-2l');
  }
  function buildNode(id) {
    var n = el('div.ft-node');
    n.dataset.id = id;
    dom.world.appendChild(n);
    nodeEls[id] = n;
    return n;
  }
  function fillNode(n, id, p, opt) {
    var sig = JSON.stringify([FE.nameOf(p), FE.yearsOf(p), opt.place, p.photo, portraitPos(p), opt.isRoot, opt.more, opt.canAdd, opt.isFocus, St.S.mode + St.S.perm, s.density]);
    if (n._sig === sig) return;
    n._sig = sig;
    n.textContent = '';
    var photo = el('span.ft-card__photo');
    var initials = el('span.ft-card__initials', null, FE.initials(p));
    photo.appendChild(p.photo ? portrait(p, '', initials) : initials);
    var nameT = el('span.ft-card__name-t', null, FE.nameOf(p));
    var name = el('span.ft-card__name', null, nameT);
    n._fit = { over: function () { return nameOverflows(nameT, p); }, apply: function () { fitName(nameT, p); } };
    if (opt.isRoot) { var h = icon('home', '', { width: 2.2 }); h.setAttribute('class', 'ft-card__home'); name.appendChild(h); }
    var years = FE.yearsOf(p);
    // one Tab stop for the whole tree: the chosen card (arrow keys move between cards)
    n.appendChild(el('button.ft-card', { type: 'button', tabindex: opt.isFocus ? null : '-1', title: FE.nameOf(p) + (years ? ', ' + years : ''), 'aria-label': cardAria(p, opt.isFocus), 'aria-current': opt.isFocus ? 'true' : null, 'data-k': 'card:' + id, 'data-card': id },
      photo, el('span.ft-card__text', null, name, years ? el('span.ft-card__years', null, years) : null, opt.place ? el('span.ft-card__place', null, opt.place) : null)));
    if (opt.more) n.appendChild(el('span.ft-card__more', { title: count(opt.more, 'родича', 'родичів', 'родичів') + ' тут не показано — виберіть, щоб побачити' }, '+' + opt.more));
    if (opt.canAdd) {
      var nm = FE.nameOf(p);
      [['up', 'parent', 'Батьки · P', 'Додати батька чи матір: '], ['right', 'partner', 'Партнер · R', 'Додати партнера: '], ['down', 'child', 'Дитина · C', 'Додати дитину: '], ['left', 'sibling', 'Брат чи сестра · S', 'Додати брата чи сестру: ']].forEach(function (q) {
        n.appendChild(el('button.ft-qa.ft-qa--' + q[0], { type: 'button', tabindex: opt.isFocus ? null : '-1', 'data-tip': q[2], 'aria-label': q[3] + nm, 'data-qa': q[1], 'data-for': id }, icon('plus', '', { width: 2.2 })));
      });
    }
  }

  function renderTree() {
    var L = layout(), d = s.data, roNow = ro();
    var fpos = L.nodes[s.focusId] || { x: 0, y: 0 };
    if (!s.centered && s.vpW) { Object.assign(s, panFor(fpos)); s.centered = true; }
    // nodes: keyed by person id so cards glide to their new places
    var seen = {}, placed = [];
    Object.keys(L.nodes).forEach(function (id) {
      var p = d.people[id], pos = L.nodes[id], n = nodeEls[id];
      seen[id] = 1;
      var fresh = !n;
      if (fresh) {
        n = buildNode(id);
        // newly visible cards glide in from where they were last drawn, or from the focus
        var start = s.anim ? (lastPos[id] || fpos) : pos;
        n.classList.add('is-hidden');
        n.style.transform = 'translate(' + Math.round(start.x) + 'px, ' + Math.round(start.y) + 'px)';
      }
      var isFocus = id === s.focusId, unknown = !p.given && !p.surname;
      fillNode(n, id, p, {
        place: [p.birth.place, p.deceased ? p.death.place : ''].filter(Boolean).join(' → '),
        isRoot: id === d.rootId, more: L.hidden[id] || 0, canAdd: !roNow, isFocus: isFocus
      });
      var cls = 'ft-node' + (isFocus ? ' is-focus' : '') + (p.deceased ? ' is-deceased' : '') + (unknown ? ' is-unknown' : '') + (s.pulseId === id ? ' is-new' : '');
      var target = 'translate(' + Math.round(pos.x) + 'px, ' + Math.round(pos.y) + 'px)';
      placed.push({ n: n, cls: cls, target: target });
      lastPos[id] = { x: pos.x, y: pos.y };
    });
    // new cards need their start place laid out before they move; one layout pass for all of them
    // (one per card made "Показати всіх" take seconds on a tree of thousands)
    if (placed.some(function (x) { return x.n.classList.contains('is-hidden'); })) void dom.world.offsetWidth;
    placed.forEach(function (x) { x.n.className = x.cls; });
    placed.filter(function (x) { var f = x.n._fit; x.n._fit = null; return f && f.over() && (x.fit = f); }).forEach(function (x) { x.fit.apply(); });
    placed.forEach(function (x) { x.n.style.transform = x.target; });
    Object.keys(nodeEls).forEach(function (id) {
      if (seen[id]) return;
      if (!d.people[id]) { nodeEls[id].remove(); delete nodeEls[id]; delete lastPos[id]; return; }
      nodeEls[id].classList.add('is-hidden');
    });

    // lines, labels, tags and ghost slots: rebuilt when the layout changes
    var key = layoutCache.key + '|' + (roNow ? 1 : 0);
    if (key !== linesKey) {
      linesKey = key;
      dom.lines.textContent = '';
      dom.lines.appendChild(FA.linesSvg(L.segs));
      // beside the chosen card, the side + buttons sit on the union line: its label steps just below them
      var fp = L.nodes[s.focusId], dims = D(), drop = root.classList.contains('is-touch') ? 28 : 24;
      var nearPlus = function (l) { return !roNow && fp && Math.abs(l.y - (fp.y + dims.ch / 2)) < 6 && (Math.abs(l.x - fp.x) < 80 || Math.abs(l.x - fp.x - dims.cw) < 80); };
      L.labels.forEach(function (l) { dom.lines.appendChild(el('span.ft-ulabel', { cls: l.cls, style: 'left:' + Math.round(l.x) + 'px;top:' + Math.round(l.y + (nearPlus(l) ? drop : 0)) + 'px' }, l.text)); });
      L.tags.forEach(function (l) { dom.lines.appendChild(el('span.ft-ltag', { style: 'left:' + Math.round(l.x) + 'px;top:' + Math.round(l.y) + 'px' }, l.text)); });
      dom.ghosts.textContent = '';
      if (!roNow) L.ghosts.forEach(function (g) {
        dom.ghosts.appendChild(el('button.ft-ghost', { type: 'button', style: 'transform: translate(' + Math.round(g.x) + 'px, ' + Math.round(g.y) + 'px)', on: { click: function () { openQa('parent', s.focusId); } } }, icon('plus'), g.label));
      });
    }
    dom.lines.classList.toggle('is-fading', !!s.lineFade);
    renderCanvasUI(L, roNow);
    applyView();
  }

  function renderCanvasUI(L, roNow) {
    var ui = dom.vpUI, phone = isPhone();
    ui.textContent = '';
    dom.zoomVal = null; dom.qaPop = null;
    if (s.qa && !roNow) ui.appendChild(renderQa(L));

    var tool = function (ic, label, go, pressed, k) {
      return el('button.ft-icon-btn', { type: 'button', 'aria-label': label, title: label, 'aria-pressed': pressed == null ? null : String(!!pressed), 'data-k': k, on: { click: go } }, icon(ic));
    };
    dom.zoomVal = el('button.ft-btn.ft-btn--ghost.ft-zoomval', { type: 'button', on: { click: function () { zoomBy(1 / s.zoom, null, null, true); } } }, '');
    var rootP = s.data.people[s.data.rootId];
    ui.appendChild(el('div.ft-controls', null,
      el('div.ft-toolgroup', { role: 'group', 'aria-label': 'Масштаб' },
        tool('minus', 'Зменшити (−)', function () { zoomBy(0.8, null, null, true); }), dom.zoomVal, tool('plus', 'Збільшити (+)', function () { zoomBy(1.25, null, null, true); })),
      el('div.ft-toolgroup', { role: 'group', 'aria-label': 'Подання' },
        tool('fit', 'Вмістити на екрані (F)', fit, null, 'fit'),
        tool('home', rootP ? 'Назад до головної особи: ' + FE.givenOf(rootP) + ' (H)' : 'Головна особа (H)', goRoot, null, 'home'),
        tool('cards', 'Детальні картки (D)', function () { setDensity(s.density === 'compact' ? 'expanded' : 'compact'); }, s.density === 'expanded', 'density'),
        tool('legend', 'Пояснення ліній (L)', function () { set({ showLegend: !s.showLegend, depthOpen: false }); }, s.showLegend, 'legend')),
      el('div.ft-toolgroup', null,
        el('button.ft-btn.ft-btn--ghost.ft-btn--sm', { type: 'button', 'aria-expanded': String(s.depthOpen), 'aria-label': 'Показано поколінь: ↑' + s.upGen + ' ↓' + s.downGen, 'data-k': 'depth', title: 'Скільки поколінь показувати', on: { click: function () { set({ depthOpen: !s.depthOpen, showLegend: false }); } } },
          icon('depth'), s.upGen === ALL && s.downGen === ALL ? 'Усі' : '↑' + (s.upGen === ALL ? 'усі' : s.upGen) + '  ↓' + (s.downGen === ALL ? 'усі' : s.downGen))),
      scopeGroup(L)));

    if (s.depthOpen) {
      var gen = function (key) { return [1, 2, 3, 4, ALL].map(function (n) { return { label: n === ALL ? 'Усі' : String(n), sel: s[key] === n, pick: function () { var p = { prevDepth: null }; p[key] = n; relayout(p); } }; }); };
      ui.appendChild(el('div.ft-pop.ft-depth', { role: 'dialog', 'aria-label': 'Показані покоління' },
        el('div.ft-field', null, el('span.ft-field__label', null, 'Предки вище'), seg(gen('upGen'), 'Покоління предків', true)),
        el('div.ft-field', null, el('span.ft-field__label', null, 'Нащадки нижче'), seg(gen('downGen'), 'Покоління нащадків', true)),
        el('label.ft-check', null, el('input', { type: 'checkbox', checked: s.sibFamilies, on: { change: function () { relayout({ sibFamilies: !s.sibFamilies }); } } }), 'Показувати партнерів і дітей братів і сестер'),
        el('p.ft-hint', null, 'Великі дерева залишаються читабельними, бо показано лише пряму лінію цієї людини. Картки з +числом мають більше родичів — виберіть їх, щоб розгорнути.')));
    }
    if (s.showLegend) {
      var row = function (line, text) { return el('div.ft-legend__row', null, line, el('span', null, text)); };
      var ln = function (cls) { return el('span.ft-legend__line' + (cls ? '.' + cls : '')); };
      ui.appendChild(el('div.ft-legend', { role: 'note', 'aria-label': 'Пояснення ліній' },
        el('span.ft-legend__h', null, 'Пари'),
        row(ln(), 'Шлюб — підпис «шл.» з роком'), row(ln('is-dashed'), 'Партнери без шлюбу'), row(ln('is-muted'), 'Розлучення — підпис «розл.»'),
        el('span.ft-legend__h', { style: 'margin-top:4px' }, 'Діти'),
        row(ln(), 'Рідні'), row(ln('is-dashed'), 'Усиновлені (з позначкою)'), row(ln('is-dotted'), 'Нерідні чи під опікою (з позначкою)'),
        el('span.ft-legend__h', { style: 'margin-top:4px' }, 'Картки'),
        row(el('span.ft-legend__corner'), 'Померлі — стрічка в лівому куті, чорно-біле фото'),
        row(el('span.ft-chip.ft-chip--muted', { style: 'justify-self:start' }, '+2'), 'Родичі, яких тут не показано')));
    }
    var fp = s.data.people[s.focusId];
    if (phone && !s.drawerOpen && fp && s.screen === 'app') {
      ui.appendChild(el('button.ft-peek', { type: 'button', 'aria-label': 'Подробиці: ' + FE.nameOf(fp), on: { click: function () { s.drawerOpen = true; render(); centerOn(s.focusId, true); } } },
        avatar(fp), el('span', { style: 'flex:1 1 auto;min-width:0' }, el('span.ft-result__name', null, FE.nameOf(fp)), el('span.ft-result__meta', null, FE.yearsOf(fp))),
        el('span.ft-btn.ft-btn--sm', null, 'Подробиці')));
    }
  }
  // The tree only draws the focus person's lines, so say how much is shown and how to get back.
  function scopeGroup(L) {
    var shown = Object.keys(L.nodes).length, total = Object.keys(s.data.people).length, rootId = s.data.rootId;
    var away = rootId && s.focusId !== rootId;
    if (shown >= total && !away) return null;
    return el('div.ft-toolgroup.ft-scope', { role: 'status', title: shown < total ? 'Картки з «+N» мають ще родичів — виберіть, щоб розгорнути' : null },
      el('span.ft-scope__text', null, 'Показано ' + shown + ' з ' + total),
      shown < total && !(s.upGen === ALL && s.downGen === ALL && s.sibFamilies) ? el('button.ft-btn.ft-btn--sm', { type: 'button', 'data-k': 'scope-all', title: 'Усі покоління й гілки, щоб у полі зору було якнайбільше людей (A)', on: { click: showAll } }, icon('fit', 'ft-ico--sm'), 'Показати всіх') : null,
      away ? el('button.ft-btn.ft-btn--sm', { type: 'button', 'data-k': 'scope-home', title: 'До головної особи: ' + FE.nameOf(P(rootId)), on: { click: goRoot } },
        icon('home', 'ft-ico--sm'), 'До головної', el('kbd.ft-kbd', null, 'Esc')) : null);
  }
  // Show everyone: every generation and branch, centred on whichever of this person and their
  // ancestors brings the most people into one view, then fit it to the screen.
  var ALL = 99;
  function showAll() {
    var d = s.data, opt = { upGen: ALL, downGen: ALL, sibFamilies: true, ghosts: false };
    var seen = {}, queue = [s.focusId], best = null;
    while (queue.length) {
      var id = queue.shift();
      if (!id || seen[id] || !d.people[id]) continue;
      seen[id] = 1;
      var n = Object.keys(FE.layoutTree(d, id, D(), opt).nodes).length;
      if (!best || n > best.n) best = { id: id, n: n };
      var pf = FE.primaryParentFam(d, id);
      if (pf) queue.push(pf.a, pf.b);
    }
    if (!best) return;
    if (best.id !== s.focusId) keepNotes();
    var patch = { upGen: ALL, downGen: ALL, sibFamilies: true, focusId: best.id, lineFade: true, qa: null, depthOpen: false, notesEdit: best.id === s.focusId && s.notesEdit, captionEdit: null, relEdit: null };
    if (!s.prevDepth) patch.prevDepth = { upGen: s.upGen, downGen: s.downGen, sibFamilies: s.sibFamilies };
    Object.assign(s, patch);
    render();
    fit();
    fadeLines();
  }
  A.showAll = showAll;
  function relayout(patch) {
    Object.assign(s, patch, { lineFade: true });
    render();
    centerOn(s.focusId, true);
    fadeLines();
  }
  function setDensity(v) {
    if (v === s.density) return;
    setPref('density', v);
    Object.assign(s, { density: v, lineFade: true, menuOpen: false });
    render();
    centerOn(s.focusId, true);
    fadeLines();
  }

  // Cheap update for pan/zoom: no DOM rebuild.
  function applyView() {
    if (!dom.world) return;
    dom.world.classList.toggle('is-anim', !!s.anim);
    dom.world.style.transform = 'translate(' + (Math.round(s.panX * 100) / 100) + 'px, ' + (Math.round(s.panY * 100) / 100) + 'px) scale(' + (Math.round(s.zoom * 1000) / 1000) + ')';
    dom.vp.style.backgroundPosition = Math.round(s.panX) + 'px ' + Math.round(s.panY) + 'px';
    dom.vp.classList.toggle('is-dragging', !!s.dragging);
    if (dom.zoomVal) { dom.zoomVal.textContent = Math.round(s.zoom * 100) + '%'; dom.zoomVal.setAttribute('aria-label', 'Масштаб ' + Math.round(s.zoom * 100) + '% — повернути 100% (0)'); }
    if (dom.qaPop) placeQa(dom.qaPop);
  }

  /* ---------------------------------------------------------------- quick-add popover */
  function placeQa(pop) {
    var q = s.qa, L = layout(), n = q && L.nodes[q.pid], dims = D();
    // a short window (or 200% zoom): the form scrolls inside instead of running off the bottom
    if (s.vpH) pop.style.maxHeight = Math.max(160, s.vpH - 24) + 'px';
    var W = QA_W, Hh = pop.offsetHeight || 320, x = 16, y = 16;
    if (n && s.vpW) {
      var sx = n.x * s.zoom + s.panX, sy = n.y * s.zoom + s.panY, sw = dims.cw * s.zoom, sh = dims.ch * s.zoom;
      x = sx + sw + 22;
      if (x + W > s.vpW - 12) x = sx - W - 22;
      y = sy + sh / 2 - 90;
      if (x < 12) { x = clamp(sx + sw / 2 - W / 2, 12, Math.max(12, s.vpW - W - 12)); y = sy + sh + 22; }
      y = clamp(y, 12, Math.max(12, s.vpH - Hh - 12));
    }
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
  }
  function renderQa(L) {
    var q = s.qa, d = s.data, p = d.people[q.pid], word = KIND[q.kind];
    var fams = partnerFams(d, q.pid), pf = FE.primaryParentFam(d, q.pid);
    var suggest = qaSuggest(d, q), trimmed = String(q.name || '').trim();
    var pick = function (up) { return function () { patchQa(Object.assign({ err: '' }, up)); }; };
    var pop = el('div.ft-pop.ft-qapop', { role: 'dialog', 'aria-label': 'Додати ' + word.acc + ' · ' + FE.givenOf(p), on: { keydown: function (e) {
      var t = e.target;
      if (e.key === 'Enter' && t && ((t.tagName === 'INPUT' && t.type !== 'checkbox') || (t.closest && t.closest('.ft-seg') && !t.closest('.ft-seg[aria-label="Нова чи наявна особа"]')))) { e.preventDefault(); qaCommit(e.shiftKey); }
    } } });
    pop.appendChild(el('div.ft-pop__head', null, el('h3.ft-pop__title', null, 'Додати ' + word.acc + ' · ' + FE.givenOf(p)), closeBtn(function () { set({ qa: null }); }, 'Закрити (Esc)')));
    pop.appendChild(seg([
      { label: 'Нова особа', sel: q.tab === 'new', pick: function () { patchQa({ tab: 'new', err: '' }); s.focusReq = 'qa-name'; }, k: 'qa-tab-new' },
      { label: 'Вибрати наявну', sel: q.tab === 'link', pick: function () { patchQa({ tab: 'link', err: '' }); s.focusReq = 'qa-link'; }, k: 'qa-tab-link' }
    ], 'Нова чи наявна особа', true));
    if (q.tab === 'new') {
      var f = el('div.ft-form'), nmNow = qaName(d, q);
      var typed = function (key) { return function (e) { s.qa[key] = e.target.value; s.qa.err = ''; schedule(); }; };
      f.appendChild(el('div.ft-row2', null,
        el('label.ft-field', null, el('span.ft-field__label', null, 'Ім’я'),
          el('input.ft-input', { autocomplete: 'off', 'data-k': 'qa-name', value: q.name, placeholder: 'напр. Олена', 'aria-invalid': q.err && !String(q.name).trim() ? 'true' : null, 'aria-describedby': q.err ? 'ft-qa-err' : null, on: { input: typed('name') } })),
        el('label.ft-field', null, el('span.ft-field__label', null, 'Прізвище'),
          el('input.ft-input', { autocomplete: 'off', 'data-k': 'qa-surname', value: q.surname != null ? q.surname : suggest, placeholder: 'Невідомо', on: { input: typed('surname') } }))));
      if (q.surname == null && /\s/.test(trimmed)) f.appendChild(el('p.ft-hint', { style: 'margin-top:-6px' }, 'Буде збережено як ' + nmNow.given + ' ' + nmNow.surname + '.'));
      f.appendChild(el('div.ft-row2.ft-row2--auto', null,
        el('div.ft-field', null, el('span.ft-field__label', null, 'Стать'), seg([['f', 'Жінка'], ['m', 'Чоловік'], ['u', 'Не вказано']].map(function (o) { return { label: o[1], sel: q.sex === o[0], pick: pick({ sex: o[0] }), k: 'qa-sex-' + o[0] }; }), 'Стать', true)),
        el('label.ft-field', null, el('span.ft-field__label', null, 'Народження'), el('input.ft-input', { maxlength: '24', placeholder: 'Рік або дата', title: '1931, 12 3 1931, 12 березня 1931, бл. 1930', autocomplete: 'off', value: q.year, 'data-k': 'qa-year',
          on: { input: function (e) { s.qa.year = e.target.value; s.qa.err = ''; } } }))));
      pop.appendChild(f);
    }
    var opts = el('div.ft-form');
    (function (f) {
      if (q.kind === 'child' && fams.length) {
        f.appendChild(el('div.ft-field', null, el('span.ft-field__label', null, 'Другий з батьків'), seg(fams.map(function (fm) {
          return { label: FE.givenOf(d.people[FE.other(fm, q.pid)]), sel: q.withFam === fm.id, pick: pick({ withFam: fm.id }), k: 'qa-fam-' + fm.id };
        }).concat([{ label: 'Невідомо', sel: q.withFam === 'none', pick: pick({ withFam: 'none' }), k: 'qa-fam-none' }]), 'Другий з батьків', true)));
      }
      if (q.kind === 'partner') f.appendChild(el('div.ft-field', null, el('span.ft-field__label', null, 'Стосунки'), seg([['married', 'Шлюб'], ['partner', 'Партнери']].map(function (o) { return { label: o[1], sel: q.unionType === o[0], pick: pick({ unionType: o[0] }), k: 'qa-union-' + o[0] }; }), 'Стосунки', true)));
      var soloF = q.kind === 'partner' && q.soloFam && d.families.find(function (x) { return x.id === q.soloFam; });
      if (soloF) {
        f.appendChild(el('label.ft-check', null, el('input', { type: 'checkbox', checked: q.alsoParent, 'data-k': 'qa-also', on: { change: function (e) { s.qa.alsoParent = e.target.checked; } } }),
          el('span', null, 'Також другий з батьків для: ' + soloF.kids.filter(function (k) { return d.people[k.id]; }).map(function (k) { return FE.givenOf(d.people[k.id]); }).join(', '))));
      }
      if (q.kind === 'parent' && pf && pf.b) {
        // on the link tab, the person picked decides the word
        var qsex = q.tab === 'link' && d.people[q.linkId] ? d.people[q.linkId].sex : q.sex;
        f.appendChild(el('div.ft-field', null, el('span.ft-field__label', null, FE.givenOf(p) + ' вже має двох батьків. Хто це?'),
          seg((qsex === 'f' ? [['step', 'Мачуха'], ['adopted', 'Усиновлювачка'], ['foster', 'Опікунка']] : qsex === 'm' ? [['step', 'Вітчим'], ['adopted', 'Усиновлювач'], ['foster', 'Опікун']]
            : [['step', 'Вітчим чи мачуха'], ['adopted', 'Усиновлювач(ка)'], ['foster', 'Опікун(ка)']]).map(function (o) { return { label: o[1], sel: q.parentRel === o[0], pick: pick({ parentRel: o[0] }), k: 'qa-prel-' + o[0] }; }), 'Хто це для дитини', true)));
      }
      var sibs = q.kind === 'parent' && pf && !pf.b ? pf.kids.filter(function (k) { return k.id !== q.pid && d.people[k.id]; }) : [];
      if (sibs.length) {
        f.appendChild(el('label.ft-check', null, el('input', { type: 'checkbox', checked: q.alsoSiblings, 'data-k': 'qa-sibs', on: { change: function (e) { s.qa.alsoSiblings = e.target.checked; } } }),
          el('span', null, 'Також другий з батьків для: ' + sibs.map(function (k) { return FE.givenOf(d.people[k.id]); }).join(', '))));
      }
      var note = '';
      if (q.kind === 'sibling' && !pf) note = 'Батьків ще не вказано, тож для обох буде додано спільного батька чи матір без імені — заповните пізніше.';
      if (q.kind === 'parent' && pf && !pf.b) note = 'Утворить пару з: ' + FE.givenOf(d.people[pf.a]) + ' — і стане другим із батьків.';
      if (note) f.appendChild(el('p.ft-hint', null, note));
    })(opts);
    if (q.tab === 'link') {
      var lq = FE.fold(q.linkQuery), rel = FE.relatedIds(d, q.pid);
      var cands = Object.keys(d.people).filter(function (id) { return id !== q.pid; }).map(function (id) { return d.people[id]; })
        .filter(function (x) { return !lq || FE.matches(x, lq) || (!x.given && !x.surname && 'невідомо'.indexOf(lq) >= 0); })
        .sort(FE.byName).slice(0, 8);
      var picker = el('div.ft-picker', { role: 'listbox', 'aria-label': 'Люди' });
      // nobody can become their own ancestor
      var up = FE.lineOf(d, q.pid, true), down = FE.lineOf(d, q.pid, false);
      var loop = q.kind === 'parent' ? down : q.kind === 'child' ? up : q.kind === 'sibling' ? Object.assign({}, up, down) : {};
      cands.forEach(function (x) {
        var already = FE.alreadyLinked(d, q.kind, q.pid, x.id) || loop[x.id];
        picker.appendChild(el('button.ft-pick', { type: 'button', role: 'option', 'aria-selected': String(q.linkId === x.id), disabled: already, 'data-k': 'pick:' + x.id,
          on: { click: pick({ linkId: x.id }), dblclick: function () { s.qa.linkId = x.id; qaCommit(false); } } },
          avatar(x, 'ft-av--sm'),
          el('span', null, el('span.ft-result__name', { style: 'font-size:14px' }, FE.nameOf(x)), el('span.ft-result__meta', null, FE.yearsOf(x))),
          already ? el('span.ft-pick__note', null, loop[x.id] && !FE.alreadyLinked(d, q.kind, q.pid, x.id) ? (up[x.id] ? 'Предок' : 'Нащадок') : word.already) : (rel.indexOf(x.id) >= 0 ? el('span.ft-pick__note', null, 'Родич') : null)));
      });
      if (!cands.length) picker.appendChild(el('p.ft-hint', { style: 'padding:8px 6px' }, 'Нікого не знайдено. Перейдіть на «Нова особа», щоб додати.'));
      pop.appendChild(el('div.ft-form', null,
        el('input.ft-input', { type: 'search', placeholder: 'Знайдіть когось у дереві', 'aria-label': 'Знайти особу', autocomplete: 'off', value: q.linkQuery, 'data-k': 'qa-link',
          on: { input: function (e) { s.qa.linkQuery = e.target.value; s.qa.linkId = null; schedule(); } } }),
        picker,
        el('p.ft-hint', null, 'Так можна виправити пропущений зв’язок або з’єднати дві гілки — дублікат не створюється.')));
    }
    if (opts.childNodes.length) pop.appendChild(opts);
    if (q.err) pop.appendChild(el('p.ft-err', { role: 'alert', id: 'ft-qa-err' }, q.err));
    pop.appendChild(el('div.ft-pop__foot', null,
      el('span.ft-hint', null, el('kbd.ft-kbd', null, '↵'), ' додати · ', el('kbd.ft-kbd', null, '⇧↵'), ' додати ще'),
      el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', disabled: q.tab === 'link' && !q.linkId, on: { click: function () { qaCommit(false); } } }, q.tab === 'link' ? 'Пов’язати' : 'Додати')));
    dom.qaPop = pop;
    Promise.resolve().then(function () { if (dom.qaPop === pop) placeQa(pop); });
    return pop;
  }

  /* ---------------------------------------------------------------- toast */
  function renderToast() {
    var t = dom.toasts;
    // a later change takes the undo button away: it would undo that change instead
    var canUndo = !!(s.toast && s.toast.undo && s.toast.h === hist.length);
    var id = s.toast ? s.toast.id + (canUndo ? ':u' : '') : 0;
    if (t._id === id) return;
    t._id = id;
    t.textContent = '';
    if (!s.toast) return;
    t.appendChild(el('div.ft-toast', null, el('span', null, s.toast.msg),
      canUndo ? el('button.ft-toast__btn', { type: 'button', on: { click: undo } }, 'Скасувати') : null,
      el('button.ft-toast__x', { type: 'button', 'aria-label': 'Закрити', on: { click: function () { set({ toast: null }); } } }, icon('close', 'ft-ico--sm'))));
  }

  /* ================================================================ pointer + wheel */
  var ptrs = {}, drag = null, pinch = null;
  function vpRect() { return dom.vp.getBoundingClientRect(); }
  function pDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var t = e.target;
    if (t && t.closest && t.closest('button, input, textarea, a, label, .ft-pop, .ft-controls, .ft-legend, .ft-peek')) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    if (ids.length === 1) drag = { x: e.clientX, y: e.clientY, px: s.panX, py: s.panY, moved: false };
    else if (ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: s.zoom, px: s.panX, py: s.panY, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag = null;
    }
    try { dom.vp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function pMove(e) {
    if (!ptrs[e.pointerId]) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    if (ids.length === 2 && pinch) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], pn = pinch;
      var z = clamp(pn.z * Math.hypot(a.x - b.x, a.y - b.y) / pn.d, 0.3, 2);
      var r = vpRect(), cx = pn.cx - r.left, cy = pn.cy - r.top, k = z / pn.z;
      var mx = (a.x + b.x) / 2 - pn.cx, my = (a.y + b.y) / 2 - pn.cy;
      Object.assign(s, { zoom: z, panX: cx - (cx - pn.px) * k + mx, panY: cy - (cy - pn.py) * k + my, anim: false });
      applyView();
      return;
    }
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    Object.assign(s, { panX: drag.px + dx, panY: drag.py + dy, anim: false, dragging: true });
    applyView();
  }
  function pUp(e) {
    delete ptrs[e.pointerId];
    var dr = drag;
    if (Object.keys(ptrs).length < 2) pinch = null;
    if (dr && !dr.moved && (s.qa || s.depthOpen || s.menuOpen || s.statusOpen || s.moreOpen || s.showLegend)) set({ qa: null, depthOpen: false, menuOpen: false, statusOpen: false, moreOpen: false, showLegend: false });
    if (!Object.keys(ptrs).length) { drag = null; if (s.dragging) { s.dragging = false; applyView(); } }
  }
  function onWheel(e) {
    // popovers and lists over the canvas scroll normally
    if (e.target.closest && e.target.closest('.ft-pop, .ft-menu, .ft-legend, .ft-results')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { var r = vpRect(); zoomBy(Math.exp(-e.deltaY * 0.006), e.clientX - r.left, e.clientY - r.top, false); return; }
    var m = e.deltaMode === 1 ? 16 : 1;
    Object.assign(s, { panX: s.panX - e.deltaX * m, panY: s.panY - e.deltaY * m, anim: false });
    applyView();
  }
  function onVpResize() {
    var w = dom.vp.clientWidth, h = dom.vp.clientHeight;
    if (!w || !h) return;
    if (!s.centered) {
      s.vpW = w; s.vpH = h;
      var pos = layout().nodes[s.focusId];
      if (pos) Object.assign(s, panFor(pos));
      s.centered = true;
      applyView();
    } else if (w !== s.vpW || h !== s.vpH) {
      // keep the centre point where it was (e.g. the drawer docking)
      s.panX += (w - s.vpW) / 2; s.panY += (h - s.vpH) / 2;
      s.vpW = w; s.vpH = h;
      applyView();
    }
  }

  /* ================================================================ keyboard */
  function escape() {
    if (s.lightbox) { set({ lightbox: null, focusReq: 'card:' + s.focusId }); return true; }
    if (s.confirm) { set({ confirm: null, focusReq: 'card:' + s.focusId }); return true; }
    if (s.showKeys) { set({ showKeys: false, focusReq: 'card:' + s.focusId }); return true; }
    if (s.qa) { set({ qa: null, focusReq: 'card:' + s.focusId }); return true; }
    if (s.menuOpen || s.statusOpen || s.explainerOpen || s.moreOpen || s.depthOpen || s.showLegend) {
      // focus goes back to the button that opened it
      var opener = s.menuOpen ? 'menu' : s.statusOpen || s.explainerOpen ? 'status' : s.moreOpen ? 'more' : s.depthOpen ? 'depth' : 'legend';
      set({ menuOpen: false, statusOpen: false, explainerOpen: false, moreOpen: false, depthOpen: false, showLegend: false, focusReq: opener });
      return true;
    }
    if (s.posterOpen) { set({ posterOpen: false, focusReq: 'card:' + s.focusId }); return true; }
    if (s.frameEdit) { set({ frameEdit: null, focusReq: 'frame' }); return true; }
    if (s.captionEdit) { set({ captionEdit: null }); return true; }
    if (s.relEdit) { set({ relEdit: null, relConfirm: false }); return true; }
    if (s.notesEdit) { set({ notesEdit: false }); return true; }
    if (s.editMode) { endEdit(); return true; }
    if (s.search || s.searchOpen || s.phoneSearch) { set({ search: '', searchOpen: false, phoneSearch: false }); var i = root.querySelector('.ft-search__input'); if (i) i.blur(); return true; }
    // back to the home person's view before closing the drawer
    if (s.screen === 'app' && s.view === 'tree' && s.data && s.data.rootId && s.focusId !== s.data.rootId) { goRoot(); return true; }
    if (s.view === 'people' && s.listQuery) { set({ listQuery: '' }); return true; }
    if (s.drawerOpen && s.screen === 'app') { set({ drawerOpen: false, editMode: false, moreOpen: false }); return true; }
    return false;
  }
  function startEdit() {
    if (ro() || !P(s.focusId)) return;
    lastCoalesce = null;
    set({ editMode: true, drawerOpen: true, moreOpen: false, focusReq: 'ed-given' });
  }
  function endEdit() { lastCoalesce = null; set({ editMode: false, ac: null }); }
  function askDelete(pid) { if (pid && P(pid) && !ro()) set({ confirm: { kind: 'delete', pid: pid }, moreOpen: false, focusReq: 'confirm-cancel' }); }

  // Tab and Shift+Tab stay inside an open dialog
  function trapTab(e) {
    var all = root.querySelectorAll('[aria-modal="true"]'), dlg = all[all.length - 1];
    if (!dlg) return;
    var items = [].filter.call(dlg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && n.getClientRects().length; });
    if (!items.length) { e.preventDefault(); return; }
    var first = items[0], last = items[items.length - 1], a = document.activeElement;
    if (!dlg.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  function onKey(e) {
    if (!root || !s.data && s.screen !== 'error') return;
    var t = e.target || {}, k = e.key, tag = t.tagName || '';
    if (t !== document.body && !root.contains(t)) return;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || t.isContentEditable;
    var mod = e.metaKey || e.ctrlKey;
    if (k === 'Escape') { if (escape()) e.preventDefault(); return; }
    if (k === 'Tab') { trapTab(e); return; }
    // ↑ ↓ move between the menu's buttons
    var menuEl = (k === 'ArrowDown' || k === 'ArrowUp') && (t.closest && t.closest('.ft-menu') || (s.menuOpen && t.getAttribute && t.getAttribute('data-k') === 'menu' && root.querySelector('.ft-menu')));
    if (menuEl) {
      var btns = [].slice.call(menuEl.querySelectorAll('button:not(:disabled)')), i = btns.indexOf(t);
      var step = k === 'ArrowDown' ? 1 : -1; e.preventDefault(); btns[i < 0 ? (step > 0 ? 0 : btns.length - 1) : (i + step + btns.length) % btns.length].focus(); return;
    }
    // e.code keeps letter shortcuts working on the Ukrainian keyboard layout
    var code = e.code || '';
    // the panel's fields save as you type, so the app's undo is their undo too
    var appUndo = !typing || (t.getAttribute && /^ed-/.test(t.getAttribute('data-k') || ''));
    if (mod && code === 'KeyZ' && appUndo) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && code === 'KeyY' && appUndo) { e.preventDefault(); redo(); return; }
    if (typing || mod || e.altKey || s.screen !== 'app' || s.confirm || s.showKeys || s.posterOpen || s.lightbox) return;
    var inPanel = t.closest && t.closest('.ft-drawer, .ft-list, .ft-pop, .ft-menu, .ft-posterwrap');
    var noEdit = ro(), fid = s.focusId, tree = s.view === 'tree';
    var act = function (fn) { e.preventDefault(); fn(); };
    var letter = /^Key[A-Z]$/.test(code) ? code.slice(3) : '';
    if (k === '/' || code === 'Slash' && !e.shiftKey) return act(openSearch);
    if (k === '?' || code === 'Slash' && e.shiftKey) return act(function () { set({ showKeys: true, menuOpen: false, focusReq: 'keys-close' }); });
    switch (letter) {
      case 'P': if (!noEdit && fid) act(function () { openQa('parent', fid); }); return;
      case 'C': if (!noEdit && fid) act(function () { openQa('child', fid); }); return;
      case 'S': if (!noEdit && fid) act(function () { openQa('sibling', fid); }); return;
      case 'R': if (!noEdit && fid) act(function () { openQa('partner', fid); }); return;
      case 'E': if (!noEdit && fid) act(startEdit); return;
      case 'H': if (tree) act(goRoot); return;
      case 'F': if (tree) act(fit); return;
      case 'A': if (tree) act(showAll); return;
      case 'L': if (tree) act(function () { set({ showLegend: !s.showLegend, depthOpen: false }); }); return;
      case 'D': if (tree) act(function () { setDensity(s.density === 'compact' ? 'expanded' : 'compact'); }); return;
    }
    if (k === '+' || k === '=' || code === 'NumpadAdd') { if (tree) act(function () { zoomBy(1.25, null, null, true); }); return; }
    if (k === '-' || k === '_' || code === 'NumpadSubtract') { if (tree) act(function () { zoomBy(0.8, null, null, true); }); return; }
    if (code === 'Digit0' || code === 'Numpad0') { if (tree) act(function () { zoomBy(1 / s.zoom, null, null, true); }); return; }
    if (code === 'Digit1') return act(function () { setView('tree'); });
    if (code === 'Digit2') return act(function () { setView('people'); });
    if (code === 'Digit3') return act(function () { setView('desc'); });
    if (k === 'Home') { if (tree) act(goRoot); return; }
    // a card reached with Tab is the one Enter and Delete mean, even before it was clicked
    var tabbed = t.getAttribute && t.getAttribute('data-card');
    if (k === 'Enter') { if (tree && !inPanel && (t === root || t === document.body || (t.classList && t.classList.contains('ft-card')))) act(function () { if (tabbed && tabbed !== s.focusId) focusPerson(tabbed); else set({ drawerOpen: true }); }); return; }
    if (/^Arrow/.test(k)) { if (tree && !inPanel) act(function () { navigate(k); }); return; }
    if (k === 'Delete' || k === 'Backspace') { if (!noEdit && fid && tree && !inPanel) act(function () { askDelete(tabbed && P(tabbed) ? tabbed : fid); }); }
  }
  function openSearch() {
    if (isPhone()) set({ phoneSearch: true, focusReq: 'search' });
    else { var i = root.querySelector('.ft-search__input'); if (i) i.focus(); }
  }

  /* ================================================================ startup */
  function build() {
    root = document.getElementById('app');
    root.textContent = '';
    dom.topbar = el('header.ft-topbar');
    dom.banners = el('div');
    dom.main = el('main.ft-main');
    dom.drawerSlot = el('div', { style: 'display:contents' });
    dom.overlays = el('div', { style: 'display:contents' });
    dom.toasts = el('div.ft-toasts', { 'aria-live': 'polite' });
    root.appendChild(dom.topbar);
    root.appendChild(dom.banners);
    root.appendChild(el('div.ft-body', null, dom.main, dom.drawerSlot));
    root.appendChild(dom.overlays);
    root.appendChild(dom.toasts);

    dom.lines = el('div.ft-lines', { 'aria-hidden': 'true' });
    dom.ghosts = el('div');
    dom.world = el('div.ft-world', null, dom.lines, dom.ghosts);
    dom.vpUI = el('div');
    dom.vp = el('div.ft-viewport', null, dom.world, dom.vpUI);
    dom.vp.addEventListener('pointerdown', pDown);
    dom.vp.addEventListener('pointermove', pMove);
    dom.vp.addEventListener('pointerup', pUp);
    dom.vp.addEventListener('pointercancel', pUp);
    dom.vp.addEventListener('wheel', onWheel, { passive: false });
    dom.world.addEventListener('click', function (e) {
      var qa = e.target.closest('[data-qa]');
      if (qa) { openQa(qa.getAttribute('data-qa'), qa.getAttribute('data-for')); return; }
      var card = e.target.closest('[data-card]');
      if (card) focusPerson(card.getAttribute('data-card'));
    });
    dom.world.addEventListener('dblclick', function (e) {
      var card = e.target.closest('[data-card]');
      if (card) focusPerson(card.getAttribute('data-card'));
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(onVpResize).observe(dom.vp);
      new ResizeObserver(function () {
        var w = root.clientWidth;
        s.appH = root.clientHeight || s.appH;
        if (w && Math.abs(w - s.appW) > 1) {
          var was = [isPhone(), isTablet()];
          s.appW = w;
          if (was[0] !== isPhone() || was[1] !== isTablet()) render();
        }
      }).observe(root);
    }
    document.addEventListener('keydown', onKey);
    // a file dropped anywhere outside a drop zone would make the browser open it and leave the app
    ['dragover', 'drop'].forEach(function (t) {
      document.addEventListener(t, function (e) { if (!e.defaultPrevented && e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
    });
    window.addEventListener('hashchange', function () { if ((location.hash === '#present') !== s.present) setPresent(!s.present); });
    St.onChange(schedule);
  }

  // A second tab on the same archive is read-only. The editing tab holds a lock; a read-only tab
  // waits for it and offers to take over once the other tab closes.
  function watchTabs() {
    if (navigator.locks && navigator.locks.request) {
      return new Promise(function (res) {
        // On a reload the page being replaced can still hold the lock for a moment: ask a few times.
        var tries = 0;
        var ask = function () {
          navigator.locks.request('family-archive', { ifAvailable: true }, function (lock) {
            if (lock) { s.otherTab = false; res(); return new Promise(function () { /* held while the tab is open */ }); }
            if (++tries < 6) { setTimeout(ask, 200); return; }
            s.otherTab = true; res();
            navigator.locks.request('family-archive', function () { set({ otherTabGone: true }); return new Promise(function () { /* keep it: this tab edits after a reload */ }); });
          }).catch(function () { res(); });
        };
        ask();
      });
    }
    var ch;
    try { ch = new BroadcastChannel('family-archive'); } catch (e) { return Promise.resolve(); }
    var answered = false;
    ch.onmessage = function (m) {
      if (m.data === 'hello' && !s.otherTab) ch.postMessage('here');
      if (m.data === 'here') answered = true;
    };
    ch.postMessage('hello');
    return new Promise(function (res) { setTimeout(function () { s.otherTab = answered; res(); }, 250); });
  }

  function start() {
    build();
    s.appW = root.clientWidth || 1440;
    s.appH = root.clientHeight || 900;
    render();
    var fileData = window.FAMILY_DATA || null;
    // the bundled sample, kept so a phone (which can't edit) can go back to it from an empty tree
    var sample = fileData && fileData.meta && fileData.meta.sample ? FA.clone(fileData) : null;
    A.showSample = sample ? function () {
      if (St.S.mode === 'folder') return; hist = []; fut = []; loadData(FA.clone(sample), { screen: 'app' }); St.changed(s.data); } : null;
    var fileError = window.FAMILY_ERROR || (!fileData ? (window.FAMILY_MISSING ? 'Файл family.js не знайдено поруч з index.html' : 'family.js не вдалося розібрати') : '');
    watchTabs().then(function () {
      St.setReadOnly(s.otherTab);
      return St.init(fileData, fileError);
    }).then(function (out) {
      if (out.screen === 'error') { set({ screen: 'error', fileError: out.error }); return; }
      // phones start on the tree; the peek bar opens the details sheet
      loadData(out.data || emptyData(), { screen: out.screen, drawerOpen: !isPhone(), focusReq: out.screen === 'welcome' ? 'choice-' + (St.S.fsSupported ? 'folder' : 'browser') : null });
      if (out.notice) toast(out.notice, false);
    }).catch(function (e) { set({ screen: 'error', fileError: 'Не вдалося відкрити дерево: ' + (e && e.message || e) }); });
    checkVersion();
    setInterval(checkVersion, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { checkVersion(); checkFile(); } });
    window.addEventListener('focus', checkFile);
  }

  /* ================================================================ exports for drawer.js / views.js */
  Object.assign(A, {
    set: set, schedule: schedule, render: render, commit: commit, undo: undo, redo: redo, toast: toast,
    ro: ro, issues: issues, isPhone: isPhone, viewOnlyScreen: viewOnlyScreen, isTablet: isTablet, P: P, given: given, later: later, cancel: function (key) { clearTimeout(timers[key]); },
    focusPerson: focusPerson, openQa: openQa, startEdit: startEdit, endEdit: endEdit, askDelete: askDelete,
    setView: setView, goRoot: goRoot, connect: connect, download: download, importFile: importFile, startEmpty: startEmpty,
    addFirst: addFirst, loadData: loadData, emptyData: emptyData, partnerFams: partnerFams, centerOn: centerOn, fadeLines: fadeLines,
    browserOnly: function () { St.chooseBrowserOnly(); set({ screen: 'app', focusReq: 'card:' + s.focusId }); },
    viewSample: function () { St.chooseSample(); set({ screen: 'app', focusReq: 'card:' + s.focusId }); },
    checkVersion: checkVersion,
    setCoalesce: function (v) { lastCoalesce = v; },
    clearHistory: function () { hist = []; fut = []; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
