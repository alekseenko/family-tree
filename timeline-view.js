/* «Хронологія»: everyone's life on one time scale, as two tabs (Гілки, Покоління).
   timeline-engine.js (FamilyTimeline) does all the layout; this draws what build() returns and
   handles the pointer and keys. Moving over the plot changes only the parts that depend on the
   year (badge, count, band, dimming, tooltip) in place, without redrawing the page.
   Read-only: it never changes the data. Spec: docs in the timeline handoff (TIMELINE_SPEC.md). */
(function () {
  'use strict';
  var FA = window.FA, FE = window.FamilyEngine, FT = window.FamilyTimeline;
  var el = FA.el, icon = FA.icon;
  var GROUP_KEY = 'timeline.group';
  var DRAWER_W = 420;

  FA.tlGroup = function () { try { return localStorage.getItem(GROUP_KEY) === 'gen' ? 'gen' : 'branch'; } catch (e) { return 'branch'; } };
  function setGroup(A, g) { try { localStorage.setItem(GROUP_KEY, g); } catch (e) { /* the tab just isn't remembered */ } A.set({ tlGroup: g }); }

  /* ---------------------------------------------------------------- model, once per data */
  // Names as the «Імена» setting shows them. Capitals come from CSS instead, so given names still
  // decline in the pills («мати Ганни»).
  var mFor = null, mCase = '', mNow = 0, M = null, mId = 0;
  function model(d, nc) {
    var now = new Date().getFullYear();
    if (mFor === d && mCase === nc && mNow === now) return M;
    var data = d;
    if (nc !== 'as') {
      data = { rootId: d.rootId, families: d.families, people: {} };
      Object.keys(d.people).forEach(function (id) {
        var p = d.people[id];
        data.people[id] = Object.assign({}, p, { given: FE.caseName(p.given, 'cap'), surname: FE.caseName(p.surname, 'cap') });
      });
    }
    M = FT.model(data, { now: now });
    mFor = d; mCase = nc; mNow = now; mId++;
    return M;
  }

  // Real text widths for label placement (the engine's own estimate is deliberately generous).
  var FONTS = { tick: '600 11px', badge: '700 12px', scrub: '750 12px', pill: '650 12px', today: '650 11px', label: '650 11px', undated: '400 11px' };
  var ctx2d = null, fam = '', widths = {};
  function measure(text, role) {
    if (!ctx2d) {
      try { ctx2d = document.createElement('canvas').getContext('2d'); } catch (e) { ctx2d = null; }
      fam = getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'system-ui, sans-serif';
      if (!ctx2d) return FT.estimate(text, role);
    }
    var key = role + '|' + text;
    if (widths[key] == null) { ctx2d.font = (FONTS[role] || '400 11px') + ' ' + fam; widths[key] = Math.ceil(ctx2d.measureText(String(text)).width) + 4; }
    return widths[key];
  }

  // The layout depends on the data, tab, width and chosen person, not on the year: it is kept between
  // redraws, and a new year only recomputes the axis, the count and who is alive (cheap even for
  // thousands of people; a full build is not).
  var bKey = '', bVal = null;
  function layout(Mo, opts) {
    var key = [mId, opts.group, opts.device, opts.width, opts.sel].join('|');
    if (key !== bKey) { bKey = key; bVal = FT.build(Mo, opts); }
    if (bVal.year !== yearIn(bVal, Mo, opts.year)) setYear(bVal, Mo, opts.year, opts);
    return bVal;
  }
  function yearIn(B, Mo, y) { return Math.max(B.geo.y0, Math.min(Mo.now, y != null ? y : Mo.now)); }
  function setYear(B, Mo, y, opts) {
    var phone = opts.device === 'phone', G = B.geo;
    y = yearIn(B, Mo, y);
    B.year = y;
    B.count = FT.countAlive(Mo, y);
    B.axis = FT.axis({ X: B.X, L: G.L, R: G.R, y0: G.y0, y1: G.y1, k: G.k, now: Mo.now, width: opts.width, phone: phone, year: y, pillText: FT.countText(Mo, y, phone), measure: opts.measure });
    B.rows.forEach(function (r) { if (r.type === 'person' && !r.undated) { r.alive = FT.alive(Mo, r.id, y); r.dim = r.alive === 'no'; } });
  }

  // Phone hint, legend copy and the live region's sentence for a year.
  function yearSentence(y, c) { return y + ': живі ' + c.yes + (c.maybe ? ', ще ' + c.maybe + ' — невідомо' : ''); }

  // The plot's width: the body minus the person panel beside it (drawn after this view). Below
  // 1100px the panel floats over the page, as over the tree, so the timeline keeps the full width.
  function plotWidth(A) {
    var s = A.s, w = A.bodyWidth();
    if (s.drawerOpen && s.screen === 'app' && s.data.people[s.focusId] && !A.isTablet()) w -= DRAWER_W;
    return Math.max(A.isPhone() ? 300 : 480, w);
  }

  /* ---------------------------------------------------------------- small parts */
  function avatar(A, id, raw, row, cls) {
    var a = el('span.tl-av' + (cls ? '.' + cls : '') + (row.undated ? '.is-undated' : row.deceased ? '.is-dec' : ''), { 'aria-hidden': 'true' });
    var initials = document.createTextNode(row.undated && !raw.photo ? '?' : row.initials);
    a.appendChild(raw.photo ? A.portrait(raw, '', initials) : initials);
    return a;
  }
  function mark(m, small) {
    return el('span.tl-mk.is-' + m.kind + (small ? '.is-sm' : ''), { style: 'left:' + m.x + 'px;top:' + m.y + 'px' }, m.kind === 'q' ? '?' : null);
  }
  function glyph(kind) { return el('span.tl-lg-glyph', null, el('span.tl-mk.is-' + kind)); }

  function legendButton(A, phone) {
    var open = !!A.s.tlLegend;
    var toggle = function () { A.set({ tlLegend: !A.s.tlLegend }); };
    var ic = icon('legend', phone ? 'ft-ico--lg' : null);
    return phone
      ? el('button.ft-icon-btn.tl-lgbtn', { type: 'button', style: 'margin-left:auto', 'aria-label': 'Легенда', 'aria-expanded': String(open), 'aria-controls': 'tl-legend', 'data-k': 'tl-legend-btn', on: { click: toggle } }, ic)
      : el('button.ft-btn.ft-btn--sm.ft-btn--ghost.tl-lgbtn', { type: 'button', title: 'Легенда (L)', 'aria-expanded': String(open), 'aria-controls': 'tl-legend', 'data-k': 'tl-legend-btn', on: { click: toggle } }, ic, 'Легенда');
  }
  function groupSwitch(A) {
    return el('div.ft-seg', { role: 'group', 'aria-label': 'Групувати' }, [['branch', 'Гілки'], ['gen', 'Покоління']].map(function (o) {
      return el('button', { type: 'button', 'aria-pressed': String(A.s.tlGroup === o[0]), 'data-k': 'tl-group:' + o[0], on: { click: function () { if (A.s.tlGroup !== o[0]) setGroup(A, o[0]); } } }, o[1]);
    }));
  }

  // «Легенда»: live copies of the marks, laid out like the tree's line key.
  function legend(A, B, phone, hasStep) {
    var row = function (sample, text) { return el('div.ft-legend__row', null, el('span.tl-lgs', null, sample), el('span', null, text)); };
    var h = function (t) { return el('span.ft-legend__h', null, t); };
    var mk = function (k, style, text) { return el('span.tl-mk.is-' + k, { style: style || null }, text || null); };
    var bar = function (cls) { return el('span.tl-lgs__bar' + (cls ? '.' + cls : '')); };
    var box = el('div.ft-legend.tl-lgp' + (phone ? '.is-phone' : ''), { id: 'tl-legend', role: 'dialog', 'aria-label': 'Легенда хронології' });
    if (phone) box.appendChild(el('div.tl-lgp__head', null, el('span.tl-lgp__t', null, 'Легенда'),
      el('button.ft-icon-btn', { type: 'button', 'aria-label': 'Закрити легенду', 'data-k': 'tl-legend-close', on: { click: function () { A.set({ tlLegend: false, focusReq: 'tl-legend-btn' }); } } }, icon('close'))));
    box.appendChild(h('Життя'));
    box.appendChild(row([bar('is-live'), mk('cap', 'left:35px')], 'Жива людина — смуга триває до сьогодні'));
    box.appendChild(row(bar(), 'Померла людина'));
    box.appendChild(row(bar('is-hatch'), 'Приблизна дата — «бл.» або «до»'));
    box.appendChild(row([bar('is-short'), bar('is-hatch.is-tail'), mk('q', 'left:36px', '?')], 'Рік смерті невідомий — рахується окремо як «невідомо»'));
    box.appendChild(row(el('span.tl-av.is-dec', null, 'ІК'), 'Траурна стрічка на фото — людина померла'));
    box.appendChild(row(el('span.tl-av.is-undated', null, '?'), B.legend.undatedText));
    box.appendChild(h('Події на смузі'));
    [['m', 'Шлюб'], ['p', 'Партнерство без шлюбу'], ['div', 'Розлучення'], ['kid', 'Народилася дитина'], ['adopt', 'Усиновлення']].forEach(function (x) {
      box.appendChild(row([bar(), mk(x[0])], x[1]));
    });
    if (B.legend.branch) {
      box.appendChild(h('Родовід'));
      box.appendChild(row(el('span.tl-lgs__indent'), 'Відступ — діти під своїми батьками'));
      if (B.legend.lines) {
        box.appendChild(row(el('span.tl-lgs__vline'), 'Від батьків до дитини — у рік народження'));
        box.appendChild(row(el('span.tl-lgs__vline.is-tie'), 'Пара — у рік шлюбу'));
        if (hasStep) box.appendChild(row(el('span.tl-lgs__vline.is-step'), 'Прийомна дитина або дитина партнера'));
      }
      box.appendChild(row(el('span.tl-pmark', { style: 'margin-left:15px' }), 'Кружечок перед ім’ям — у родині через шлюб'));
    }
    box.appendChild(h('Вибір і рік'));
    box.appendChild(row(el('span.tl-lgs__sel'), B.legend.selectedText));
    box.appendChild(row(el('span.tl-lgs__rel', null, 'донька'), 'Родичі обраної людини підписані'));
    box.appendChild(row(bar('is-dim'), 'Приглушено — у вибраний рік ще не народився або вже помер'));
    box.appendChild(row(el('span.tl-lgs__today'), 'Пунктир — сьогодні'));
    return box;
  }

  /* ---------------------------------------------------------------- the view */
  function view(A) {
    var s = A.s, d = s.data, phone = A.isPhone();
    var wrap = el('div.tl-main' + (phone ? '.is-phone' : ''), { role: 'region', 'aria-label': 'Хронологія родини' });
    if (!Object.keys(d.people).length) {
      wrap.appendChild(el('div.tl-empty', null,
        el('h2.tl-empty__t', null, 'Тут з’явиться хронологія'),
        el('p.tl-empty__s', null, 'Додайте людей у дереві — їхні роки життя ляжуть на спільну шкалу.'),
        el('button.ft-btn.ft-btn--primary', { type: 'button', on: { click: function () { A.setView('tree'); } } }, 'Відкрити дерево')));
      return wrap;
    }
    var Mo = model(d, s.nameCase), group = s.tlGroup === 'gen' ? 'gen' : 'branch';
    var opts = { group: group, device: phone ? 'phone' : 'desktop', width: plotWidth(A), sel: s.focusId, year: s.tlYear, measure: measure };
    var B = layout(Mo, opts);
    var G = B.geo, sel = B.sel, rowById = {}, rowEls = {};
    var persons = B.rows.filter(function (r) { return r.type === 'person'; });
    persons.forEach(function (r) { rowById[r.id] = r; });
    var hasStep = B.conns.some(function (c) { return c.kind === 'step'; });

    var select = function (id) {
      if (phone) { A.focusPerson(id, { noOpen: true }); return; }
      A.focusPerson(id);
      A.set({ drawerOpen: true, focusReq: 'tl-n:' + id });
    };

    /* header */
    var phPill = null;
    if (phone) {
      wrap.appendChild(el('div.tl-ph-head', null,
        el('div', null, el('h2.tl-title', { style: 'font-size:22px' }, 'Хронологія'), el('p.tl-sub', { style: 'font-size:12px' }, 'Утримуйте й ведіть, щоб обрати рік')),
        legendButton(A, true)));
      phPill = el('span.tl-pill.tl-ph-pill', { 'aria-hidden': 'true' }, FT.countText(Mo, B.year, true));
      wrap.appendChild(el('div.tl-ph-ctrl', null, groupSwitch(A), phPill));
    } else {
      wrap.appendChild(el('div.tl-head', null,
        el('div', { style: 'min-width:0' }, el('h2.tl-title', null, 'Хронологія'), el('p.tl-sub', null, B.subtitle)),
        el('div.tl-ctrls', null, el('span.tl-ctrl-label', { 'aria-hidden': 'true' }, 'Групувати'), groupSwitch(A), legendButton(A, false))));
    }
    var axisTop = phone ? 96 : 64, scrollTop = phone ? 122 : 92;
    var axisEl = el('div.tl-axis', { 'aria-hidden': 'true', style: 'top:' + axisTop + 'px' + (phone ? ';height:26px' : '') });
    wrap.appendChild(axisEl);
    var paintAxis = function () {
      axisEl.textContent = '';
      var ax = B.axis;
      ax.ticks.forEach(function (t) {
        if (t.x - measure(t.text, 'tick') / 2 < 2) return;   // a label that would be cut by the left edge
        axisEl.appendChild(el('span.tl-axis__t', { style: 'left:' + t.x + 'px' + (phone ? ';top:6px' : '') }, t.text));
      });
      if (!phone && ax.today.show) axisEl.appendChild(el('span.tl-axis__today', { style: 'left:' + ax.today.x + 'px' }, 'сьогодні'));
      if (phone) axisEl.appendChild(el('span.tl-scrub', { style: 'left:' + ax.badge.x + 'px' }, ax.badge.text));
      else {
        axisEl.appendChild(el('span.tl-rbadge', { style: 'left:' + ax.badge.x + 'px' }, ax.badge.text));
        axisEl.appendChild(el('span.tl-pill', { style: 'left:' + ax.pill.x + 'px;top:2px' }, ax.pill.text));
      }
    };
    paintAxis();

    /* plot */
    var scroll = el('div.tl-scroll', { tabindex: '0', 'data-k': 'tl-plot', 'aria-label': 'Шкала років: стрілки вліво й вправо змінюють рік', style: 'top:' + scrollTop + 'px;bottom:0' });
    var plot = el('div.tl-plot', { style: 'height:' + (B.height + (phone ? 96 : 0)) + 'px' });
    scroll.appendChild(plot);
    if (!Mo.dated.length) wrap.appendChild(el('p.tl-note', { style: 'top:' + scrollTop + 'px' }, 'Додайте рік народження хоча б одній людині, щоб побачити шкалу.'));
    if (!Mo.dated.length) scroll.style.top = (scrollTop + 34) + 'px';
    B.axis.grids.forEach(function (g) { plot.appendChild(el('span.tl-grid' + (g.century ? '.is-century' : ''), { style: 'left:' + g.x + 'px' })); });
    B.rows.forEach(function (r) {
      var cls = r.type === 'band' ? 'is-band' : r.sel ? 'is-sel' : r.rel ? 'is-rel' : '';
      if (cls) plot.appendChild(el('span.tl-bg.' + cls, { style: 'top:' + r.top + 'px;height:' + r.h + 'px' }));
    });
    var hband = el('span.tl-hband'), hline = el('span.tl-hline');
    var paintBand = function () {
      hband.style.left = Math.round(B.X(B.year) * 10) / 10 + 'px';
      hband.style.width = Math.max(2, Math.round(G.k * 10) / 10) + 'px';
      hline.style.left = Math.round(B.X(B.year + 0.5)) + 'px';
    };
    paintBand();
    plot.appendChild(hband); plot.appendChild(hline);
    if (G.y1 >= Mo.now) plot.appendChild(el('span.tl-today', { style: 'left:' + B.axis.todayLineX + 'px' }));
    B.conns.forEach(function (c) {
      plot.appendChild(el('span.tl-conn' + (c.kind !== 'descent' ? '.is-' + c.kind : '') + (c.sel ? '.is-sel' : ''), { 'aria-hidden': 'true', style: 'left:' + c.x + 'px;top:' + c.top + 'px;height:' + c.h + 'px' }));
    });
    var firstStop = rowById[sel] ? sel : persons[0] && persons[0].id;
    function rowEl(r) {
      if (r.type === 'band') {
        return el('div.tl-row', { style: 'top:' + r.top + 'px;height:' + r.h + 'px' },
          el('div.tl-band-label', { style: phone ? 'left:12px' : null }, r.title, el('span', null, r.sub)));
      }
      var raw = d.people[r.id] || {};
      var row = el('div.tl-row' + (r.sel ? '.is-sel' : '') + (r.dim ? '.is-dim' : '') + (r.undated ? '.is-undated' : ''), { 'data-id': r.id, style: 'top:' + r.top + 'px;height:' + r.h + 'px' });
      r.guides.forEach(function (x) { row.appendChild(el('span.tl-guide', { style: 'left:' + x + 'px' })); });
      var pm = r.pmark ? el('span.tl-pmark' + (r.pmark === 'p' ? '.is-p' : r.pmark === 'div' ? '.is-div' : ''), { 'aria-hidden': 'true' }) : null;
      var nameAttrs = { type: 'button', 'aria-label': r.aria, tabindex: r.id === firstStop ? '0' : '-1', 'data-k': 'tl-n:' + r.id, 'data-id': r.id,
        on: { click: function (e) { e.stopPropagation(); select(r.id); }, keydown: function (e) { nameKey(e, r.id); } } };
      if (phone) {
        nameAttrs.style = 'left:' + r.nameX + 'px';
        row.appendChild(el('button.tl-ph-name', nameAttrs, pm, el('b.tl-name__t', { style: 'font-weight:inherit' }, r.name), el('span', null, r.years)));
      } else {
        nameAttrs.style = 'left:' + r.nameX + 'px;width:' + r.nameW + 'px';
        row.appendChild(el('button.tl-name', nameAttrs, pm, avatar(A, r.id, raw, r), el('span.tl-name__t', { style: 'min-width:0' }, r.name), el('span.tl-name__y', null, r.years)));
      }
      r.segs.forEach(function (sg) {
        row.appendChild(el('span.tl-seg' + (sg.tone === 'live' ? '.is-live' : '') + sg.cls.map(function (c) { return '.is-' + c; }).join('') + (r.sel ? '.is-selring' : ''),
          { 'aria-hidden': 'true', style: 'left:' + sg.x + 'px;top:' + sg.y + 'px;width:' + sg.w + 'px;height:' + sg.h + 'px' }));
      });
      r.marks.forEach(function (m) { row.appendChild(mark(m, phone)); });
      var labTop = phone ? ';top:26px' : '';
      if (r.label) row.appendChild(el('span.tl-lab.is-rel' + (r.label.left ? '.is-left' : ''), { 'aria-hidden': 'true', style: 'left:' + r.label.x + 'px' + labTop }, r.label.text));
      if (r.pill) row.appendChild(el('span.tl-undated-pill', { style: 'left:' + r.pill.x + 'px' + labTop }, r.pill.text));
      rowEls[r.id] = row;
      return row;
    }
    // Above 400 people only the rows within 300px of what's on screen exist; scrolling adds the rest.
    var windowed = persons.length > 400, shown = {};
    function paintRows() {
      var a = scroll.scrollTop - 300, z = scroll.scrollTop + (scroll.clientHeight || 900) + 300;
      B.rows.forEach(function (r) {
        var key = r.type === 'band' ? 'band:' + r.key : r.id, near = !windowed || (r.top + r.h > a && r.top < z);
        if (near && !shown[key]) { shown[key] = rowEl(r); plot.appendChild(shown[key]); }
        else if (!near && shown[key]) { shown[key].remove(); delete shown[key]; if (r.type === 'person') delete rowEls[r.id]; }
      });
    }
    paintRows();
    if (windowed) { var rq = 0; scroll.addEventListener('scroll', function () { if (!rq) rq = requestAnimationFrame(function () { rq = 0; paintRows(); }); }); }
    var tip = null;
    wrap.appendChild(scroll);

    /* ↑ ↓ between people (one name in the tab order: the chosen one) */
    var order = persons.map(function (r) { return r.id; });
    function nameKey(e, id) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); e.stopPropagation();
      var i = order.indexOf(id) + (e.key === 'ArrowDown' ? 1 : -1);
      if (i < 0 || i >= order.length) return;
      var cur = e.currentTarget, sel2 = '[data-k="tl-n:' + CSS.escape(order[i]) + '"]', next = plot.querySelector(sel2);
      if (!next) { scroll.scrollTop = Math.max(0, rowById[order[i]].top - scroll.clientHeight / 2); paintRows(); next = plot.querySelector(sel2); }
      if (!next) return;
      cur.setAttribute('tabindex', '-1'); next.setAttribute('tabindex', '0');
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
      showYear(B.year, order[i]);
    }

    /* the year: badge, count, band, dimming and the tooltip follow it */
    var live = el('div.sr-only', { 'aria-live': 'polite' });
    wrap.appendChild(live);
    var hov = null, liveT = null, peekAt = null;
    function paintTip() {
      if (phone) return;
      if (tip) { tip.remove(); tip = null; }
      var id = hov || sel, r = rowById[id], t = r && FT.tooltip(Mo, id, B.year);
      if (!t) return;
      var x = B.X(B.year), left = x + 300 > G.R ? Math.round(x - 286) : Math.round(x + G.k + 14);
      var viewBottom = scroll.scrollTop + (scroll.clientHeight || 600);
      var top = Math.round(Math.max(scroll.scrollTop + 6, Math.min(r.top + r.cy - 150, viewBottom - 200)));
      tip = el('div.tl-tip', { role: 'tooltip', style: 'left:' + left + 'px;top:' + top + 'px' },
        el('div.tl-tip__head', null, avatar(A, id, d.people[id] || {}, r, 'tl-av--md'),
          el('span', null, el('span.tl-tip__name', { style: 'display:block' }, t.name), el('span.tl-tip__years', null, t.years))),
        el('div.tl-tip__now' + (t.muted ? '.is-muted' : ''), null, t.now),
        t.events.map(function (ev) { return el('div.tl-tip__ev', null, glyph(ev.kind), el('span', null, String(ev.year)), el('span', null, ev.text)); }),
        t.more ? el('div.tl-tip__years', null, t.more) : null);
      plot.appendChild(tip);
    }
    function showYear(y, h, announce) {
      if (y !== B.year) {
        A.s.tlYear = y;
        opts.year = y;
        setYear(B, Mo, y, opts);
        paintAxis(); paintBand();
        B.rows.forEach(function (r) { if (r.type === 'person' && rowEls[r.id]) rowEls[r.id].classList.toggle('is-dim', r.dim); });
        if (phPill) phPill.textContent = FT.countText(Mo, B.year, true);
        if (peekAt) peekAt.textContent = FT.atYear(Mo, sel, B.year);
        if (announce) { clearTimeout(liveT); liveT = setTimeout(function () { live.textContent = yearSentence(B.year, B.count); }, 300); }
      }
      hov = h === undefined ? hov : h;
      paintTip();
    }
    var plotXY = function (e) { var b = plot.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    var rowAt = function (y) { for (var i = 0; i < persons.length; i++) { var r = persons[i]; if (y >= r.top && y < r.top + r.h) return r.id; } return null; };
    if (!phone) {
      scroll.addEventListener('pointermove', function (e) {
        var p = plotXY(e);
        showYear(p.x >= G.L - 4 ? B.yearAt(p.x) : B.year, rowAt(p.y));
      });
      scroll.addEventListener('pointerleave', function () { showYear(B.year, null); });
      scroll.addEventListener('scroll', function () { if (tip) paintTip(); });
    } else {
      // press and hold, then drag sideways to pick a year; a tap picks a person
      var hold = null, scrub = false, start = null, wasScrub = false;
      scroll.addEventListener('pointerdown', function (e) {
        start = { x: e.clientX, y: e.clientY }; scrub = false; wasScrub = false;
        clearTimeout(hold);
        hold = setTimeout(function () { scrub = true; wasScrub = true; showYear(B.yearAt(Math.max(G.L, plotXY(e).x)), null); }, 300);
      });
      scroll.addEventListener('pointermove', function (e) {
        if (scrub) { showYear(B.yearAt(Math.max(G.L, plotXY(e).x)), null); return; }
        if (start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 8) clearTimeout(hold);
      });
      var stop = function () { clearTimeout(hold); scrub = false; start = null; };
      scroll.addEventListener('pointerup', stop);
      scroll.addEventListener('pointercancel', stop);
      // while scrubbing the page must not scroll
      scroll.addEventListener('touchmove', function (e) { if (scrub) e.preventDefault(); }, { passive: false });
      scroll.addEventListener('contextmenu', function (e) { if (scrub || wasScrub) e.preventDefault(); });
      scroll.addEventListener('click', function (e) { if (wasScrub) { e.stopPropagation(); wasScrub = false; } }, true);
    }
    // a click on a row picks that person; anywhere in the plot closes the legend
    scroll.addEventListener('click', function (e) {
      if (A.s.tlLegend) { A.set({ tlLegend: false }); return; }
      var id = rowAt(plotXY(e).y);
      if (id) select(id);
    });
    scroll.addEventListener('keydown', function (e) {
      if (e.target !== scroll) return;
      var y = B.year;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') y += (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
      else if (e.key === 'Home') y = G.y0;
      else if (e.key === 'End') y = Mo.now;
      else return;
      e.preventDefault(); e.stopPropagation();
      showYear(Math.max(G.y0, Math.min(Mo.now, y)), undefined, true);
    });

    /* phone: the chosen person, their years and their age in the year */
    if (phone && !s.drawerOpen && s.screen === 'app' && rowById[sel]) {
      var r0 = rowById[sel], raw0 = d.people[sel] || {};
      peekAt = el('span.tl-peek__at', null, FT.atYear(Mo, sel, B.year));
      wrap.appendChild(el('div.ft-peek.tl-peek', null,
        avatar(A, sel, raw0, r0, 'tl-av--md'),
        el('span', { style: 'flex:1 1 auto;min-width:0' }, el('span.ft-result__name.tl-name__t', null, r0.name), el('span.ft-result__meta', null, r0.undated ? r0.years : r0.years + ' · ' + FT.lifeText(Mo, sel)), peekAt),
        el('button.ft-btn.ft-btn--sm', { type: 'button', 'data-k': 'tl-peek', on: { click: function () { A.set({ drawerOpen: true }); } } }, 'Деталі')));
    }
    if (s.tlLegend) wrap.appendChild(legend(A, B, phone, hasStep));

    // arriving from another view: the chosen person's row in view
    if (s.tlJump) {
      s.tlJump = false;
      Promise.resolve().then(function () {
        var r = rowById[sel];
        if (r && wrap.isConnected) scroll.scrollTop = Math.max(0, r.top - scroll.clientHeight / 3);
        if (windowed) paintRows();
        paintTip();
      });
    } else Promise.resolve().then(function () { if (!wrap.isConnected) return; if (windowed) paintRows(); paintTip(); });
    return wrap;
  }

  // The drawer's «У хронології» lines for a person.
  FA.tlFacts = function (A, id) { var Mo = model(A.s.data, A.s.nameCase); return Mo.P[id] ? FT.chronFacts(Mo, id) : []; };
  FA.timelineView = view;
})();
