/* Family Archive — everything that isn't the tree canvas or the drawer: People and
   Descendants views, first run / loading / error / empty screens, the delete
   dialog, the shortcut sheet, the photo viewer and the print poster. */
(function () {
  'use strict';
  var FA = window.FA, FE = window.FamilyEngine, St = FA.Storage;
  var el = FA.el, icon = FA.icon, count = FA.count;

  /* ================================================================ main area */
  function renderMainView(A) {
    var s = A.s;
    if (s.screen === 'loading' || !s.data && s.screen !== 'error') return loading();
    if (s.screen === 'error') return errorCard(A);
    if (s.view === 'people') return people(A);
    if (s.view === 'desc') return descendants(A);
    if (s.view === 'time') return timeline(A);
    return emptyTree(A);
  }

  function loading() {
    var skel = [[-94, -230], [-330, -230], [142, -230], [-200, -78], [12, -78], [-306, 74], [-94, 74], [118, 74]];
    return el('div.ft-viewport', { 'aria-busy': 'true', style: 'cursor: default' },
      el('div', { style: 'position:absolute;left:50%;top:42%;width:0;height:0' },
        skel.map(function (k) { return el('span.ft-skel', { style: 'left:' + k[0] + 'px;top:' + k[1] + 'px;width:188px;height:64px' }); })),
      el('div.ft-skel-label', { role: 'status' }, icon('book', 'ft-ico--lg'), 'Відкриваємо family.js…'));
  }

  function errorCard(A) {
    var S = St.S, where = S.folderName ? '«' + S.folderName + '»' : 'папці з застосунком';
    var card = el('div.ft-statecard', { role: 'alert' },
      el('span.ft-statecard__icon', null, icon('alert', 'ft-ico--lg')),
      el('h2.ft-statecard__title', null, 'Не вдалося прочитати family.js'),
      el('p.ft-statecard__body', null, 'Копія в ' + where + ' не читається — можливо, її редагували вручну або завантаження не завершилося. У вашій папці нічого не змінено.'),
      el('div.ft-code', null, A.s.fileError || 'Невідома помилка'));
    var acts = el('div.ft-statecard__actions');
    if (S.hasBrowserCopy) {
      acts.appendChild(el('button.ft-btn.ft-btn--primary.ft-btn--lg.ft-btn--block', { type: 'button', on: { click: function () {
        St.openBrowserCopy().then(function (copy) {
          if (!copy) return;
          A.loadData(copy, { screen: 'app' });
          St.replaceUnreadable();
          A.toast('Відкрито копію, збережену в цьому браузері. Збереження перепише family.js (нечитабельний файл залишиться в backups/).', false);
          St.changed(A.s.data);
        });
      } } }, 'Відкрити копію, збережену в цьому браузері' + (S.browserCopyAt ? ' · ' + FA.shortStamp(S.browserCopyAt) : '')));
    }
    if (S.fsSupported) acts.appendChild(el('button.ft-btn.ft-btn--lg.ft-btn--block', { type: 'button', on: { click: A.connect } }, 'Вибрати іншу папку…'));
    acts.appendChild(el('button.ft-btn.ft-btn--lg.ft-btn--block.ft-btn--ghost', { type: 'button', on: { click: function () { A.loadData(A.emptyData(), { screen: 'app' }); } } }, 'Почати порожнє дерево'));
    card.appendChild(acts);
    card.appendChild(el('p.ft-hint', null, S.folderName ? 'Автоматичні резервні копії лежать у «' + S.folderName + '/backups».' : 'Якщо ви раніше підключали папку, резервні копії лежать у її підпапці backups.'));
    return el('div.ft-center', { style: 'background: var(--paper)' }, card);
  }

  function emptyTree(A) {
    var s = A.s, f = s.first, ro = A.ro();
    var upd = function (patch) { s.first = Object.assign({}, s.first, patch); };
    var form = el('form.ft-startcard', { on: { submit: function (e) { e.preventDefault(); A.addFirst(); } } },
      icon('tree', '', { width: 1.6 }),
      el('h2.ft-pop__title', { style: 'font-size:22px' }, 'Хто буде першим?'),
      el('p.ft-hint', { style: 'font-size:14px' }, 'Почніть із себе або з найстаршого родича, якого знаєте. Решту додаватимете з їхніх карток.'));
    form.firstChild.setAttribute('style', 'width:28px;height:28px;color:var(--accent)');
    if (ro) {
      form.appendChild(el('p.ft-hint', null, A.viewOnlyScreen() ? 'На телефоні дерево лише переглядають. Додавати людей можна на комп’ютері або планшеті.' : 'У режимі перегляду дерево не можна змінювати.'));
      if (A.viewOnlyScreen() && A.showSample && !s.otherTab && FA.Storage.S.mode !== 'folder') form.appendChild(el('button.ft-btn.ft-btn--lg', { type: 'button', on: { click: A.showSample } }, 'Переглянути зразок'));
      return el('div.ft-center', { style: 'background-color: var(--paper)' }, form); }
    form.appendChild(el('label.ft-field', null, el('span.ft-field__label', null, 'Ім’я'),
      el('input.ft-input', { autocomplete: 'off', placeholder: 'напр. Олена Коваленко', value: f.name, 'data-k': 'first-name', on: { input: function (e) { upd({ name: e.target.value }); } } })));
    form.appendChild(el('div.ft-row2.ft-row2--auto', null,
      el('div.ft-field', null, el('span.ft-field__label', null, 'Стать'),
        A.seg([['f', 'Жінка'], ['m', 'Чоловік'], ['u', 'Не вказано']].map(function (o) { return { label: o[1], sel: f.sex === o[0], pick: function () { upd({ sex: o[0] }); A.schedule(); } }; }), 'Стать', true)),
      el('label.ft-field', null, el('span.ft-field__label', null, 'Народження'),
        el('input.ft-input', { maxlength: '24', placeholder: 'напр. 1985', title: 'Рік або дата: 1985, 12 3 1985, 12 березня 1985', autocomplete: 'off', value: f.year, on: { input: function (e) { upd({ year: e.target.value }); } } }))));
    form.appendChild(el('button.ft-btn.ft-btn--primary.ft-btn--lg', { type: 'submit' }, 'Додати першу особу'));
    form.appendChild(el('button.ft-link', { type: 'button', style: 'justify-self:start', on: { click: A.importFile } }, 'Або імпортуйте файл family.js чи GEDCOM'));
    return el('div.ft-center', { style: 'background-color: var(--paper)' }, form);
  }

  /* ---------------------------------------------------------------- People */
  function people(A) {
    var s = A.s, d = s.data, q = FE.fold(s.listQuery);
    var all = Object.keys(d.people).map(function (id) { return d.people[id]; }), probs = A.issues();
    var flt = {
      all: function () { return true; }, living: function (p) { return !p.deceased; }, deceased: function (p) { return !!p.deceased; },
      missing: function (p) { return !p.birth.date || (p.deceased && !p.death.date); }, nophoto: function (p) { return !p.photo; },
      issues: function (p) { return !!probs[p.id]; }
    };
    // the text filter first, so each chip counts what it would show
    var found = all.filter(function (p) { return !q || FE.matches(p, q) || (!p.given && !p.surname && 'невідомо'.indexOf(q) >= 0); });
    var rows = found.filter(flt[s.listFilter] || flt.all);
    var key = s.listSort, dir = s.listDir;
    var sk = function (p) { return key === 'born' ? (FE.yearOf(p.birth.date) || 9999) : key === 'died' ? (p.deceased ? (FE.yearOf(p.death.date) || 9998) : 99999) : null; };
    rows.sort(function (a, b) { if (key === 'name') return FE.byName(a, b) * dir; var x = sk(a), y = sk(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || FE.byName(a, b); });

    var wrap = el('div.ft-list');
    wrap.appendChild(el('div.ft-list__bar', null,
      el('h2.ft-list__title', null, 'Люди'),
      el('span.ft-list__count', { role: 'status' }, rows.length === all.length ? count(all.length, 'людина', 'людини', 'людей') : rows.length + ' з ' + all.length),
      el('div.ft-spacer'),
      el('input.ft-input.ft-list__filter', { type: 'search', placeholder: 'Фільтр за іменем чи місцем', 'aria-label': 'Фільтрувати людей', value: s.listQuery, 'data-k': 'list-filter', on: { input: function (e) { A.set({ listQuery: e.target.value }); } } })));
    wrap.appendChild(el('div.ft-filters', { role: 'group', 'aria-label': 'Показати', style: 'margin-bottom:14px' },
      [['all', 'Усі'], ['living', 'Живі'], ['deceased', 'Померлі'], ['missing', 'Бракує дат'], ['nophoto', 'Без фото'], ['issues', 'Перевірка даних']].map(function (f) {
        if (f[0] === 'issues' && !all.some(flt.issues) && s.listFilter !== 'issues') return null;
        return el('button.ft-filter' + (f[0] === 'issues' ? '.is-warn' : ''), { type: 'button', 'aria-pressed': String(s.listFilter === f[0]), 'data-k': 'flt:' + f[0], on: { click: function () { A.set({ listFilter: f[0] }); } } }, f[1], el('span.ft-filter__n', null, String(found.filter(flt[f[0]]).length)));
      })));
    var table = el('div.ft-table', { role: 'table', 'aria-label': 'Усі в дереві' });
    table.appendChild(el('div.ft-tr.ft-tr--head', { role: 'row' },
      [['name', 'Ім’я', true], ['born', 'Народження', true], ['bplace', 'Місце народж.', false], ['died', 'Смерть', true], ['parents', 'Батьки', false], ['photos', 'Фото', false]].map(function (c) {
        var sorted = key === c[0];
        return el('div.ft-th' + (sorted ? '.is-sorted' : ''), { role: 'columnheader', 'aria-sort': c[2] ? (sorted ? (dir > 0 ? 'ascending' : 'descending') : 'none') : null },
          c[2] ? el('button.ft-th__btn', { type: 'button', 'data-k': 'sort:' + c[0], on: { click: function () { A.set({ listSort: c[0], listDir: sorted ? -dir : 1 }); } } }, c[1], el('span', { 'aria-hidden': 'true' }, sorted ? (dir > 0 ? ' ↑' : ' ↓') : ''))
            : el('span', null, c[1]));
      })));
    rows.forEach(function (p) {
      var pars = [];
      FE.parentFams(d, p.id).forEach(function (f) { [f.a, f.b].forEach(function (x) { var q = x && d.people[x]; if (q && (q.given || q.surname) && pars.indexOf(FE.givenOf(q)) < 0) pars.push(FE.givenOf(q)); }); });
      var born = FE.fmtDate(p.birth.date), died = p.deceased ? (FE.fmtDate(p.death.date) || 'Дата невідома') : 'серед живих';
      var td = function (text, muted, extra) { return el('div.ft-td' + (muted ? '.ft-td--muted' : '') + (extra || ''), { role: 'cell' }, text); };
      table.appendChild(el('div.ft-tr' + (p.id === s.focusId ? '.is-focus' : ''), { role: 'row' },
        el('div.ft-td', { role: 'cell' }, el('button.ft-rowbtn', { type: 'button', on: { click: function () { A.focusPerson(p.id, { noOpen: true, view: 'tree' }); A.s.centered = false; } } },
          A.avatar(p), el('span', { style: 'min-width:0' }, el('span.ft-rowbtn__name', null, FE.nameOf(p)), p.birthName && p.birthName !== p.surname ? el('span.ft-rowbtn__aka', null, 'з дому ' + FE.caseName(p.birthName)) : null))),
        td(born || 'Невідомо', !born), td(p.birth.place || '—', !p.birth.place), td(died, !(p.deceased && p.death.date)),
        td(pars.join(', ') || '—', !pars.length), td(String((p.photos || []).length || '—'), false, '.ft-td--num'),
        // the "Зауваження" filter lists each person's notes on a line of their own under the row
        s.listFilter === 'issues' && probs[p.id] ? el('div.ft-td.ft-td--issues', { role: 'cell' }, probs[p.id].map(function (x) {
          return el('span.ft-rowbtn__issue.is-' + x.level, null, icon(x.level === 'error' ? 'alert' : 'info', 'ft-ico--sm'), x.text);
        })) : null));
    });
    if (!rows.length) table.appendChild(el('div.ft-list__empty', null, s.listFilter === 'issues' ? 'Зауважень немає: дати й зв’язки виглядають правдоподібно.' : 'Нікого не знайдено. Спробуйте інше написання або очистіть фільтр.'));
    wrap.appendChild(el('div.ft-tablewrap', null, table));
    return wrap;
  }

  /* ---------------------------------------------------------------- Descendants */
  function descendants(A) {
    var s = A.s, d = s.data, rootId = d.people[s.dvRoot] ? s.dvRoot : s.focusId, rp = d.people[rootId];
    var wrap = el('div.ft-list');
    if (!rp) { wrap.appendChild(el('p.ft-list__empty', null, 'Виберіть когось у дереві.')); return wrap; }
    var rows = [], seen = {}, n = 0, maxDepth = 0;
    function dvRow(id, p, depth, tag, hasKids, closed, partners) {
      var row = el('div.ft-dvrow' + (id === s.focusId ? '.is-focus' : ''), { style: 'padding-left:' + (8 + depth * 28) + 'px' });
      for (var i = 0; i < depth; i++) row.appendChild(el('span.ft-dvguide', { style: 'left:' + (20 + i * 28) + 'px', 'aria-hidden': 'true' }));
      row.appendChild(hasKids
        ? el('button.ft-dvtoggle' + (closed ? '.is-closed' : ''), { type: 'button', 'aria-label': (closed ? 'Показати дітей: ' : 'Сховати дітей: ') + FE.givenOf(p), 'aria-expanded': String(!closed), 'data-k': 'dv:' + id,
          on: { click: function () { var c = Object.assign({}, s.dvCollapsed); c[id] = !closed; A.set({ dvCollapsed: c }); } } }, icon('chevron', '', { width: 2 }))
        : el('span.ft-dvtoggle.is-leaf', { 'aria-hidden': 'true' }));
      row.appendChild(el('button.ft-dvperson', { type: 'button', on: { click: function () { A.focusPerson(id, { noOpen: true }); } } },
        A.avatar(p, 'ft-av--sm'), el('span.ft-dvperson__name', null, FE.nameOf(p)), el('span.ft-dvperson__years', null, FE.yearsOf(p))));
      if (tag) row.appendChild(el('span.ft-chip.ft-chip--sepia', null, tag));
      row.appendChild(el('span.ft-dvpartners', null, partners));
      return row;
    }
    var walk = function (id, depth, tag, hidden) {
      if (seen[id] || depth > 14) return;
      seen[id] = true;
      var p = d.people[id]; if (!p) return;
      var fams = FE.sortFams(FE.famsOf(d, id));
      var kidFams = fams.filter(function (f) { return f.kids.some(function (k) { return d.people[k.id]; }); });
      var closed = !!s.dvCollapsed[id], hasKids = kidFams.length > 0;
      var partners = fams.filter(function (f) { var o = FE.other(f, id); return o && d.people[o]; })
        .map(function (f) { var u = FE.unionShort(f); return '+ ' + FE.nameOf(d.people[FE.other(f, id)]) + (u ? ' (' + u + ')' : ''); }).join('   ');
      if (depth > 0) n++;
      maxDepth = Math.max(maxDepth, depth);
      // a collapsed branch still counts; its rows just aren't drawn
      if (!hidden) rows.push(dvRow(id, p, depth, tag, hasKids, closed, partners));;
      var multi = kidFams.length > 1;
      // two partners with the same first name need their surnames to tell them apart
      var given = kidFams.map(function (f) { var o = FE.other(f, id); return o && d.people[o] ? FE.givenOf(d.people[o]) : ''; });
      var twin = function (g) { return given.indexOf(g) !== given.lastIndexOf(g); };
      kidFams.forEach(function (f) {
        var o = FE.other(f, id), side = f.a === id ? 'ra' : 'rb';
        f.kids.forEach(function (k) {
          if (!d.people[k.id]) return;
          var rel = k[side];
          walk(k.id, depth + 1, [rel !== 'bio' ? FE.relTag(rel) : '', multi && o && d.people[o] ? FA.parentWord(d.people[o]) + ' — ' + (twin(FE.givenOf(d.people[o])) ? FE.nameOf(d.people[o]) : FE.givenOf(d.people[o])) : ''].filter(Boolean).join(' · '), hidden || closed);
        });
      });
    };
    walk(rootId, 0, '', false);
    wrap.appendChild(el('div.ft-list__bar', null,
      el('h2.ft-list__title', null, 'Нащадки: ' + FE.nameOf(rp)),
      el('span.ft-list__count', null, n ? count(n, 'нащадок', 'нащадки', 'нащадків') + ' · ' + count(maxDepth, 'покоління', 'покоління', 'поколінь') : 'Нащадків не вказано'),
      el('div.ft-spacer'),
      s.focusId !== rootId && d.people[s.focusId] ? el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: function () { A.set({ dvRoot: s.focusId }); } } }, 'Показати для: ' + FE.givenOf(d.people[s.focusId])) : null,
      Object.keys(s.dvCollapsed).some(function (k) { return s.dvCollapsed[k]; }) ? el('button.ft-btn.ft-btn--sm.ft-btn--ghost', { type: 'button', on: { click: function () { A.set({ dvCollapsed: {} }); } } }, 'Розгорнути все') : null));
    wrap.appendChild(el('div.ft-desc__tree', { 'aria-label': 'Нащадки: ' + FE.nameOf(rp) }, rows));
    return wrap;
  }

  /* ---------------------------------------------------------------- Timeline */
  // Years run down the page, one column per person, like a calendar's "find a time": a bar from birth
  // to death (to today for the living). Hovering or tapping a year shows who was alive then.
  function timeline(A) {
    var s = A.s, d = s.data, now = new Date().getFullYear(), phone = A.isPhone();
    var COL = phone ? 56 : 66, RULER = phone ? 46 : 60, YH = phone ? 10 : 12, HEAD = 78;
    var wrap = el('div.ft-list.ft-timeline');
    // a click shows the person's panel straight away (in the tree the first click only centres them)
    var open = function (id) { A.focusPerson(id); A.set({ drawerOpen: true }); };
    var span = function (v) { var r = FE.readDate(v); return r && r.y && !r.bad ? { y: r.y, rough: !!(r.approx || r.free) } : null; };
    // who can be placed: a known birth year, or at least the year they died
    var rows = [], undated = [];
    Object.keys(d.people).forEach(function (id) {
      var p = d.people[id], b = span(p.birth.date), dd = p.deceased ? span(p.death.date) : null;
      if (!b && !dd) { undated.push(p); return; }
      var from = b ? b.y : dd.y - 60, to = dd ? dd.y : p.deceased ? Math.min(now, from + 75) : now;
      if (to < from) to = from;
      rows.push({ p: p, from: from, to: to,
        // an end or a start that isn't known exactly fades out instead of stopping sharply
        fadeTop: !b || b.rough, fadeEnd: p.deceased && (!dd || dd.rough), living: !p.deceased });
    });
    rows.sort(function (x, y) { return x.from - y.from || FE.byName(x.p, y.p); });
    wrap.appendChild(el('div.ft-list__bar', null,
      el('h2.ft-list__title', null, 'Хронологія'),
      el('span.ft-list__count', null, rows.length ? count(rows.length, 'людина', 'людини', 'людей') + ' · ' + rows[0].from + '–' + now : 'Ще нікого з відомими роками'),
      el('span.ft-hint', null, 'Наведіть на рік, щоб побачити, хто тоді жив; натисніть на людину, щоб відкрити її фото й нотатки.')));
    if (!rows.length) { wrap.appendChild(el('p.ft-list__empty', null, 'Додайте рік народження чи смерті хоча б одній людині — і її життя з’явиться тут.')); return wrap; }

    var first = Math.floor(rows[0].from / 10) * 10, last = now + 3;
    var yearY = function (y) { return (y - first) * YH; };
    var W = rows.length * COL, H = (last - first + 1) * YH;
    var grid = el('div.ft-tl', { style: 'grid-template-columns:' + RULER + 'px ' + W + 'px;grid-template-rows:' + HEAD + 'px ' + H + 'px;--yh:' + YH + 'px;--col:' + COL + 'px;--ruler:' + RULER + 'px' });
    grid.appendChild(el('div.ft-tl__corner'));
    // names along the top, pinned while the years scroll under them
    grid.appendChild(el('div.ft-tl__head', null, rows.map(function (r) {
      var p = r.p;
      // the bar below is the keyboard stop for each person; the name is for the mouse
      return el('button.ft-tl__who' + (p.id === s.focusId ? '.is-focus' : ''), { type: 'button', tabindex: '-1', title: FE.nameOf(p) + ', ' + FE.yearsOf(p), 'data-k': 'tl-who:' + p.id,
        on: { click: function () { open(p.id); } } }, A.avatar(p), el('span.ft-tl__name', null, FE.givenOf(p)));
    })));
    // the year ruler down the left, pinned while scrolling sideways
    var ruler = el('div.ft-tl__ruler', { 'aria-hidden': 'true' });
    for (var y = first; y <= last; y += 10) ruler.appendChild(el('span.ft-tl__decade', { style: 'top:' + yearY(y) + 'px' }, String(y)));
    var hoverLabel = el('span.ft-tl__yearlabel');
    ruler.appendChild(hoverLabel);
    grid.appendChild(ruler);

    var body = el('div.ft-tl__body', { style: 'background-position: 0 ' + (-yearY(first)) + 'px' });
    body.appendChild(el('div.ft-tl__today', { style: 'top:' + yearY(now) + 'px' }, el('span', null, 'сьогодні')));
    var bandCount = el('span.ft-tl__count');
    var band = el('div.ft-tl__band', null, bandCount);
    body.appendChild(band);
    var bars = rows.map(function (r, i) {
      var p = r.p, top = yearY(r.from), h = Math.max(YH, yearY(r.to + 1) - top);
      var marks = [];
      // marriages and partnerships as dots, children's births as ticks
      FE.famsOf(d, p.id).forEach(function (f) {
        var o = FE.other(f, p.id), sy = span(f.start);
        if (sy && f.b) marks.push(el('span.ft-tl__mark.is-union', { style: 'top:' + (yearY(sy.y) - top) + 'px', title: FE.unionLong(f) + (o && d.people[o] ? ' · ' + FE.nameOf(d.people[o]) : '') }));
        f.kids.forEach(function (k) {
          var c = d.people[k.id], cy = c && span(c.birth.date);
          if (cy) marks.push(el('span.ft-tl__mark.is-kid', { style: 'top:' + (yearY(cy.y) - top) + 'px', title: 'Народження: ' + FE.nameOf(c) + ', ' + cy.y }));
        });
      });
      var bar = el('button.ft-tl__bar' + (r.living ? '.is-living' : '.is-deceased') + (r.fadeTop ? '.is-fadetop' : '') + (r.fadeEnd ? '.is-fadeend' : '') + (p.id === s.focusId ? '.is-focus' : ''),
        { type: 'button', style: 'left:' + (i * COL + COL / 2 - 7) + 'px;top:' + top + 'px;height:' + h + 'px', 'data-k': 'tl:' + p.id,
          'aria-label': FE.nameOf(p) + ', ' + FE.yearsOf(p), title: FE.nameOf(p) + ' · ' + FE.yearsOf(p),
          on: { click: function () { open(p.id); } } }, marks);
      bar._r = r;
      body.appendChild(bar);
      return bar;
    });
    // the year under the pointer: a band across, the year and how many were alive, the rest dimmed
    var shown = null;
    var showYear = function (yr) {
      if (yr === shown) return;
      shown = yr;
      if (yr == null) { grid.classList.remove('is-year'); bars.forEach(function (b) { b.classList.remove('is-alive'); }); return; }
      var alive = 0;
      bars.forEach(function (b) { var on = yr >= b._r.from && yr <= b._r.to; b.classList.toggle('is-alive', on); if (on) alive++; });
      grid.classList.add('is-year');
      band.style.top = yearY(yr) + 'px';
      hoverLabel.style.top = yearY(yr) + 'px';
      hoverLabel.textContent = String(yr);
      bandCount.textContent = alive ? 'живі: ' + alive : 'нікого';
    };
    var yearAt = function (e) { var r = body.getBoundingClientRect(); return Math.min(last, Math.max(first, first + Math.floor((e.clientY - r.top) / YH))); };
    body.addEventListener('pointermove', function (e) { showYear(yearAt(e)); });
    body.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') showYear(yearAt(e)); });
    body.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') showYear(null); });
    grid.appendChild(body);
    wrap.appendChild(grid);

    if (undated.length) {
      undated.sort(FE.byName);
      wrap.appendChild(el('div.ft-tl__undated', null,
        el('p.ft-hint', null, 'Без жодного відомого року, тож тут не показано (' + undated.length + '):'),
        el('div.ft-tl__chips', null, undated.map(function (p) { return el('button.ft-chip', { type: 'button', on: { click: function () { open(p.id); } } }, FE.nameOf(p)); })),
        el('button.ft-link', { type: 'button', on: { click: function () { A.set({ listFilter: 'missing' }); A.setView('people'); } } }, 'Відкрити «Бракує дат» у списку людей')));
    }
    // on arrival: the chosen person's column and birth in view
    var fi = rows.findIndex(function (r) { return r.p.id === s.focusId; });
    if (s.tlJump && fi >= 0) {
      s.tlJump = false;
      Promise.resolve().then(function () {
        if (!wrap.isConnected) return;
        wrap.scrollTop = Math.max(0, grid.offsetTop + HEAD + yearY(rows[fi].from) - wrap.clientHeight / 3);
        wrap.scrollLeft = Math.max(0, RULER + fi * COL - wrap.clientWidth / 2);
      });
    }
    return wrap;
  }

  /* ================================================================ overlays */
  function renderOverlays(slot, A) {
    var s = A.s;
    slot.textContent = '';
    if (s.screen === 'welcome' && s.data) slot.appendChild(welcome(A));
    if (s.confirm) { var c = confirmDialog(A); if (c) slot.appendChild(c); }
    if (s.showKeys) slot.appendChild(keySheet(A));
    if (s.lightbox) slot.appendChild(lightbox(A));
    if (s.posterOpen && s.screen === 'app' && s.data) slot.appendChild(poster(A));
    if (s.merge && s.screen === 'app' && s.data) slot.appendChild(mergeScreen(A));
  }

  /* ---------------------------------------------------------------- Merging another tree in */
  // Three steps on one full screen: where the other tree is, who is the same person in both, and a
  // review of every change (conflicts to decide, what was settled automatically, who is added).
  var REL_WORD = { bio: 'рідна', adopted: 'усиновлення', step: 'нерідна', foster: 'опіка' };
  var UNION_WORD = { married: 'шлюб', partner: 'партнери', divorced: 'розлучені', none: 'спільні діти' };
  function mergeValue(it, v) {
    if (it.field === 'sex') return FamilyMerge.SEX[v] || v;
    if (it.field === 'deceased') return v ? 'так' : 'ні';
    if (it.field === 'type') return UNION_WORD[v] || v;
    if (it.field === 'kid') return String(v).split('/').map(function (r) { return REL_WORD[r] || r; }).join(' / ');
    if (/date$|^start$|^end$/.test(it.field)) return FE.fmtDate(v) || '—';
    var t = String(v == null ? '' : v).trim();
    return t ? (t.length > 140 ? t.slice(0, 140) + '…' : t) : '—';
  }
  function mergeScreen(A) {
    var s = A.s, m = s.merge, d = s.data;
    var upd = function (patch) { A.set({ merge: Object.assign({}, s.merge, patch) }); };
    var close = function () { A.set({ merge: null, focusReq: 'menu' }); };
    var body = el('div.ft-merge__body');
    var head = el('div.ft-merge__head', null,
      el('h2.ft-dialog__title', { id: 'ft-merge-title' }, m.name ? 'Об’єднання з «' + m.name + '»' : 'Об’єднати з іншим деревом'),
      m.step === 'working' ? null : A.closeBtn(close, 'Скасувати об’єднання (Esc)', 'merge-close'));
    var foot = el('div.ft-merge__foot');
    var wrap = el('div.ft-merge', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ft-merge-title' }, el('div.ft-merge__inner', null, head, body, foot));
    var err = m.err ? el('p.ft-err', { role: 'alert' }, m.err) : null;
    var person = function (p, tree) {
      return el('span.ft-merge__who', null, A.avatar(p), el('span', null, el('span.ft-merge__name', null, FE.nameOf(p)), el('span.ft-merge__meta', null, FE.yearsOf(p) + (tree && p.birth.place ? ' · ' + p.birth.place : ''))));
    };

    if (m.step === 'working') { body.appendChild(el('p.ft-merge__lede', { role: 'status' }, m.text || 'Зачекайте…')); return wrap; }

    if (m.step === 'source') {
      body.appendChild(el('p.ft-merge__lede', null, 'Дерево родича додасться до вашого. Спершу ви позначите людей, які є в обох деревах, потім побачите всі зміни й розв’яжете розбіжності. Нічого не зміниться, доки ви не натиснете «Об’єднати».'));
      body.appendChild(el('div.ft-choices', null,
        St.S.fsSupported ? el('button.ft-choice.is-primary', { type: 'button', 'data-k': 'merge-folder', on: { click: function () { A.mergeFrom('folder'); } } },
          el('span.ft-choice__icon', null, icon('folder', 'ft-ico--lg')), el('span', null, el('span.ft-choice__title', null, 'Папка з деревом родича'), el('span.ft-choice__sub', null, 'Найкраще: разом із family.js прийдуть і всі фото з photos/.')), icon('next', 'ft-choice__arrow')) : null,
        el('button.ft-choice' + (St.S.fsSupported ? '' : '.is-primary'), { type: 'button', 'data-k': 'merge-file', on: { click: function () { A.mergeFrom('file'); } } },
          el('span.ft-choice__icon', null, icon('upload', 'ft-ico--lg')), el('span', null, el('span.ft-choice__title', null, 'Файл family.js або GEDCOM'), el('span.ft-choice__sub', null, 'Фото прийдуть, якщо файл зроблено через ☰ → «Завантажити family.js».')), icon('next', 'ft-choice__arrow'))));
      if (err) body.appendChild(err);
      foot.appendChild(el('button.ft-btn', { type: 'button', on: { click: close } }, 'Скасувати'));
      return wrap;
    }

    var T = m.theirs, ids = Object.keys(T.people), sugBy = {};
    m.sug.forEach(function (x) { sugBy[x.theirs] = x; });
    var oursSorted = Object.keys(d.people).map(function (id) { return d.people[id]; }).sort(FE.byName);
    var paired = Object.keys(m.pairs).filter(function (t) { return m.pairs[t]; });
    // one person here can stand for only one person there
    var dupes = {}; paired.forEach(function (t) { var o = m.pairs[t]; dupes[o] = (dupes[o] || 0) + 1; });
    var clash = Object.keys(dupes).filter(function (o) { return dupes[o] > 1; });

    if (m.step === 'match') {
      body.appendChild(el('p.ft-merge__lede', null, 'Хто з дерева «' + m.name + '» уже є у вашому? Ми підібрали пари за іменами, датами й родичами — перевірте їх. Решту людей буде додано як нових.'));
      body.appendChild(el('p.ft-merge__stats', null, count(ids.length, 'людина', 'людини', 'людей') + ' у їхньому дереві · ' + count(paired.length, 'спільна', 'спільні', 'спільних') +
        (m.lost ? ' · ' + count(m.lost, 'фото', 'фото', 'фото') + ' не вдалося взяти (оберіть папку родича, а не файл)' : '')));
      // suggested pairs first, then everyone else by name
      ids.sort(function (x, y) { return (sugBy[y] ? sugBy[y].score : 0) - (sugBy[x] ? sugBy[x].score : 0) || FE.byName(T.people[x], T.people[y]); });
      body.appendChild(el('div.ft-merge__list', { role: 'list' }, ids.map(function (t) {
        var q = T.people[t], sg = sugBy[t], cur = m.pairs[t] || '';
        var sel = el('select.ft-input.ft-merge__select', { 'aria-label': 'Хто це у вашому дереві: ' + FE.nameOf(q), 'data-k': 'mpair:' + t,
          on: { change: function (e) { var pr = Object.assign({}, s.merge.pairs); if (e.target.value) pr[t] = e.target.value; else delete pr[t]; upd({ pairs: pr, err: '' }); } } },
          [el('option', { value: '' }, '— нова людина в дереві —')].concat(oursSorted.map(function (p) {
            var o = el('option', { value: p.id }, FE.nameOf(p) + (FE.yearsOf(p) !== 'Дати невідомі' ? ' · ' + FE.yearsOf(p) : ''));
            if (p.id === cur) o.selected = true;
            return o;
          })));
        return el('div.ft-merge__row' + (cur ? '.is-paired' : '') + (cur && clash.indexOf(cur) >= 0 ? '.is-bad' : ''), { role: 'listitem' },
          person(q, true), el('span.ft-merge__arrow', { 'aria-hidden': 'true' }, '→'), sel,
          sg && cur === sg.ours ? el('span.ft-merge__why', null, el('span.ft-chip' + (sg.sure ? '.ft-chip--accent' : '.ft-chip--sepia'), null, sg.sure ? 'майже напевно' : 'перевірте'), ' ' + sg.reasons.join(', ')) : null);
      })));
      var stop = !paired.length ? 'Немає жодної спільної людини — без неї дерева не з’єднати, тож нічого не зміниться. Виберіть хоча б одну пару або скасуйте.'
        : clash.length ? 'Одну людину з вашого дерева вибрано для кількох людей із їхнього: ' + clash.map(function (o) { return FE.nameOf(d.people[o]); }).join(', ') + '.' : '';
      if (stop) foot.appendChild(el('p.ft-merge__stop', { role: 'alert' }, stop));
      foot.appendChild(el('button.ft-btn', { type: 'button', on: { click: close } }, 'Скасувати'));
      foot.appendChild(el('button.ft-btn.ft-btn--primary', { type: 'button', 'data-k': 'merge-next', disabled: !!stop, on: { click: function () { upd({ step: 'review', err: '' }); } } }, 'Далі: перевірити зміни'));
      return wrap;
    }

    // review
    var pl = A.mergePlan(), conflicts = pl.items.filter(function (i) { return !i.auto; }), autos = pl.items.filter(function (i) { return i.auto; });
    var whoOf = function (it) { if (it.who) return FE.nameOf(d.people[it.who]); var f = d.families.find(function (x) { return x.id === it.fam; }); return f ? [f.a, f.b].filter(Boolean).map(function (x) { return FE.givenOf(d.people[x]); }).join(' і ') : ''; };
    var choose = function (it, v) { var c = Object.assign({}, s.merge.choices); c[it.key] = v; upd({ choices: c }); };
    var famAdds = pl.families.filter(function (e) { return e.add; }).length, kidAdds = pl.families.reduce(function (a, e) { return a + (e.add ? 0 : e.kids.length); }, 0);
    var photoAdds = pl.photos.reduce(function (a, x) { return a + x.add.length; }, 0);
    body.appendChild(el('p.ft-merge__stats', null, [
      'Додасться ' + count(pl.newPeople.length, 'людина', 'людини', 'людей'),
      famAdds ? count(famAdds, 'нова родина', 'нові родини', 'нових родин') : '',
      kidAdds ? count(kidAdds, 'зв’язок дитини', 'зв’язки дітей', 'зв’язків дітей') : '',
      photoAdds ? count(photoAdds, 'фото', 'фото', 'фото') : '',
      count(autos.length, 'поле вирішено автоматично', 'поля вирішено автоматично', 'полів вирішено автоматично'),
      count(conflicts.length, 'розбіжність', 'розбіжності', 'розбіжностей')].filter(Boolean).join(' · ')));
    // an empty section draws nothing (but is still a node, for appendChild)
    var section = function (title, n, items) { return n ? el('section.ft-merge__sec', null, el('h3.ft-merge__h', null, title + ' (' + n + ')'), items) : document.createTextNode(''); };
    var none = !pl.newPeople.length && !pl.items.length && !famAdds && !kidAdds && !photoAdds;
    if (none) body.appendChild(el('p.ft-merge__lede', null, 'Усе з дерева «' + m.name + '» уже є у вашому — об’єднання нічого не змінить.'));
    var option = function (it, which, label, value) {
      var cur = FamilyMerge.pick(it, s.merge.choices);
      return el('button.ft-merge__opt', { type: 'button', 'aria-pressed': String(cur === which), 'data-k': 'mopt:' + it.key + ':' + which, on: { click: function () { choose(it, which); } } },
        el('span.ft-merge__optlabel', null, label), el('span.ft-merge__optval', null, value));
    };
    body.appendChild(section('Розбіжності — виберіть, що правильно', conflicts.length, conflicts.map(function (it) {
      return el('div.ft-merge__card', null, el('p.ft-merge__what', null, el('b', null, whoOf(it)), ' · ' + it.label),
        el('div.ft-merge__opts', { role: 'group', 'aria-label': whoOf(it) + ': ' + it.label },
          option(it, 'ours', 'У вашому дереві', mergeValue(it, it.a)), option(it, 'theirs', 'У дереві «' + m.name + '»', mergeValue(it, it.b)),
          it.both ? option(it, 'both', 'Обидва разом', 'Ваші нотатки, потім їхні') : null));
    })));
    body.appendChild(section('Вирішено автоматично', autos.length, el('div.ft-merge__autos', null, autos.map(function (it) {
      var cur = FamilyMerge.pick(it, s.merge.choices), flip = cur === it.auto ? (it.auto === 'ours' ? 'theirs' : 'ours') : it.auto;
      var val = cur === 'theirs' ? it.b : it.a;
      return el('div.ft-merge__auto', null,
        el('span', null, el('b', null, whoOf(it)), ' · ' + it.label + ': ', el('span.ft-merge__val', null, mergeValue(it, val)), cur === it.auto && it.why ? el('span.ft-merge__meta', null, ' — ' + it.why) : el('span.ft-merge__meta', null, ' — змінено вами')),
        el('button.ft-link', { type: 'button', on: { click: function () { choose(it, flip); } } }, cur === it.auto ? 'Узяти ' + (flip === 'ours' ? 'ваше' : 'їхнє') + ': ' + mergeValue(it, flip === 'ours' ? it.a : it.b) : 'Повернути'));
    }))));
    body.appendChild(section('Нові люди', pl.newPeople.length, el('div.ft-merge__people', null, pl.newPeople.map(function (t) { return person(T.people[t], true); }))));
    body.appendChild(section('Фото', photoAdds, el('p.ft-hint', null, 'Усі фото з обох дерев залишаться; однакові файли не дублюватимуться. Головне фото — ваше, якщо воно є. ' +
      pl.photos.map(function (x) { return FE.givenOf(d.people[x.who]) + ': +' + x.add.length; }).join(', '))));
    if (err) body.appendChild(err);
    if (!none) foot.appendChild(el('p.ft-hint', null, (St.S.mode === 'folder' ? 'Перед об’єднанням поточне дерево збережеться в backups/. ' : '') + 'Об’єднання можна скасувати одразу після (⌘Z / Ctrl+Z).'));
    foot.appendChild(el('button.ft-btn', { type: 'button', on: { click: function () { upd({ step: 'match', err: '' }); } } }, 'Назад'));
    foot.appendChild(none ? el('button.ft-btn.ft-btn--primary', { type: 'button', 'data-k': 'merge-close-done', on: { click: close } }, 'Закрити')
      : el('button.ft-btn.ft-btn--primary', { type: 'button', 'data-k': 'merge-apply', on: { click: A.mergeApply } }, 'Об’єднати'));
    return wrap;
  }

  function welcome(A) {
    var fs = St.S.fsSupported;
    var choice = function (cls, ic, title, sub, go, disabled) {
      return el('button.ft-choice' + (cls ? '.' + cls : ''), { type: 'button', disabled: disabled, 'data-k': 'choice-' + ic, on: { click: go } },
        el('span.ft-choice__icon', null, icon(ic, 'ft-ico--lg')),
        el('span', null, el('span.ft-choice__title', null, title), el('span.ft-choice__sub', null, sub)),
        icon('next', 'ft-choice__arrow'));
    };
    var mark = function () { var i = icon('book'); i.setAttribute('style', 'width:24px;height:24px'); return i; };
    // Published site: a tree always lives in a folder on the visitor's computer.
    if (St.S.hosted) {
      return el('div.ft-welcome', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ft-welcome-title' },
        el('div.ft-welcome__card', null,
          el('span.ft-welcome__mark', { 'aria-hidden': 'true' }, mark()),
          el('h1.ft-welcome__title', { id: 'ft-welcome-title' }, 'Зберігайте історію своєї родини в папці, яка належить вам'),
          el('p.ft-welcome__lede', null, 'Люди, нотатки й фото зберігаються як звичайні файли в папці на вашому комп’ютері. Сайт нічого не вивантажує й не бачить ваших даних.'),
          el('div.ft-choices', null,
            choice('is-primary', 'folder', 'Створити нове дерево', 'Виберіть порожню папку — туди записуватиметься кожна зміна.', A.connect),
            choice('', 'folderOk', 'Відкрити своє дерево', 'Виберіть папку, де вже є family.js.', A.connect)),
          el('div.ft-note', null, icon('info'),
            el('span', null, 'Спершу роздивитися? ', el('button.ft-link', { type: 'button', on: { click: A.viewSample } }, 'Переглянути зразок'), ' — родину Коваленків, лише для перегляду.'))));
    }
    return el('div.ft-welcome', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ft-welcome-title' },
      el('div.ft-welcome__card', null,
        el('span.ft-welcome__mark', { 'aria-hidden': 'true' }, (function () { var i = icon('book'); i.setAttribute('style', 'width:24px;height:24px'); return i; })()),
        el('h1.ft-welcome__title', { id: 'ft-welcome-title' }, 'Зберігайте історію своєї родини в папці, яка належить вам'),
        el('p.ft-welcome__lede', null, 'Люди, нотатки й фото зберігаються як звичайні файли поруч із цим застосунком. Нічого не вивантажується, і все працює без інтернету.'),
        el('div.ft-choices', null,
          choice(fs ? 'is-primary' : '', 'folder', 'Підключити папку з даними',
            fs ? 'Виберіть папку родини один раз — кожна зміна автоматично записується в family.js. Chrome або Edge.' : 'Недоступно в цьому браузері — для збереження просто в папку потрібен Chrome або Edge.',
            A.connect, !fs),
          choice(fs ? '' : 'is-primary', 'browser', 'Продовжити лише в браузері', 'Будь-який браузер. Зміни зберігаються лише в цьому браузері; час від часу завантажуйте family.js у свою папку як копію.', A.browserOnly)),
        el('div.ft-note', null, icon('info'),
          el('span', null, 'За цим вікном — ', el('strong', null, 'зразок даних'), ': родина Коваленків, що постачається разом із застосунком. Досліджуйте скільки завгодно' + (A.viewOnlyScreen() ? '.' : '; '),
            // a phone can't edit, so an empty tree would be a dead end there
            A.viewOnlyScreen() ? null : el('button.ft-link', { type: 'button', on: { click: A.startEmpty } }, 'почати порожнє дерево'), A.viewOnlyScreen() ? '' : ' можна будь-коли.'))));
  }

  function dialog(A, title, body, keepLabel, okLabel, ok) {
    var close = function () { A.set({ confirm: null }); };
    return el('div.ft-scrim', { on: { click: function (e) { if (e.target === e.currentTarget) close(); } } },
      el('div.ft-dialog', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'ft-cf-title', 'aria-describedby': 'ft-cf-body' },
        el('h2.ft-dialog__title', { id: 'ft-cf-title' }, title),
        el('p.ft-dialog__body', { id: 'ft-cf-body' }, body),
        el('div.ft-dialog__actions', null,
          el('button.ft-btn', { type: 'button', 'data-k': 'confirm-cancel', on: { click: close } }, keepLabel),
          el('button.ft-btn.ft-btn--danger', { type: 'button', on: { click: ok } }, okLabel))));
  }
  function confirmDialog(A) {
    var s = A.s, c = s.confirm, d = s.data;
    // the sample isn't kept in undo history, so there is nothing to undo back to
    var sample = !!(d && d.meta && d.meta.sample);
    if (c.kind === 'empty') return dialog(A, 'Почати порожнє дерево?', sample ? 'Зразок буде замінено порожнім деревом.' : 'Відкрите дерево буде замінено порожнім. Одразу після цього можна скасувати.', 'Залишити дерево', 'Почати порожнє', function () {
      A.set({ confirm: null });
      A.keepCopy().then(function (kept) { A.startEmpty(); A.toast('Порожнє дерево готове' + (kept ? '. Попереднє збережено в backups/' + kept : ''), !sample); }, function (e) { A.toast('Не вдалося: ' + e.message, false); });
    });
    var p = d.people[c.pid]; if (!p) return null;
    var pid = c.pid, name = FE.nameOf(p), n = FE.relatedIds(d, pid).length, ph = (p.photos || []).length;
    var body = 'Буде видалено особу «' + name + '»' + (n ? ' і ' + count(n, 'зв’язок', 'зв’язки', 'зв’язків') : '') + (ph ? ', ' + ph + ' фото' : '') + (p.notes ? ' та нотатки' : '') +
      '. Самі родичі залишаться в дереві. Одразу після цього можна скасувати.';
    return dialog(A, 'Видалити особу «' + name + '»?', body, 'Ні, залишити', 'Видалити особу', function () {
      var next = s.focusId === pid ? (FE.relatedIds(d, pid)[0] || null) : s.focusId;
      A.commit(function (dd) {
        FE.removePerson(dd, pid);
        if (dd.rootId === pid) dd.rootId = next || Object.keys(dd.people)[0] || null;
        if (!next) next = dd.rootId;
      }, { toast: name + ' — видалено', state: { confirm: null, editMode: false, relEdit: null },
        after: function () { if (next) A.focusPerson(next, { noOpen: true }); } });
    });
  }

  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  function keySheet(A) {
    var close = function () { A.set({ showKeys: false }); };
    var row = function (label, keys) { return el('div.ft-keys__row', null, el('span', null, label), el('span.ft-keys__k', null, keys.map(function (k) { return el('kbd.ft-kbd', null, k); }))); };
    return el('div.ft-scrim', { on: { click: function (e) { if (e.target === e.currentTarget) close(); } } },
      el('div.ft-dialog.ft-dialog--wide', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ft-keys-title' },
        el('div.ft-pop__head', null, el('h2.ft-dialog__title', { id: 'ft-keys-title' }, 'Гарячі клавіші'), A.closeBtn(close, null, 'keys-close')),
        el('div.ft-keys', null,
          el('span.ft-keys__h', null, 'Додати для вибраної особи'),
          row('Батька чи матір', ['P']), row('Дитину', ['C']), row('Партнера', ['R']), row('Брата чи сестру', ['S']),
          row('Додати й почати наступну', ['⇧', '↵']), row('Редагувати дані', ['E']),
          el('span.ft-keys__h', null, 'Переміщення'),
          row('Пошук', ['/']), row('Батьки · дитина', ['↑', '↓']), row('Наступна в ряду', ['←', '→']), row('Відкрити подробиці', ['↵']),
          row('Головна особа', ['H', 'Home']), row('Показати всіх', ['A']), row('Вмістити на екрані', ['F']), row('Масштаб', ['+', '−', '0']), row('Дерево · Люди · Нащадки · Хронологія', ['1', '2', '3', '4']),
          el('span.ft-keys__h', null, 'Інше'),
          row('Скасувати · повернути', MAC ? ['⌘Z', '⇧⌘Z'] : ['Ctrl+Z', 'Ctrl+Y']), row('Ця довідка', ['?']), row('Закрити, скасувати, крок назад', ['Esc']), row('Детальні картки · пояснення ліній', ['D', 'L']), row('Видалити вибрану особу', ['Del']),
          el('p.ft-hint', { style: 'grid-column: 1 / -1; padding-top: 8px' }, 'Літерні клавіші працюють і з українською розкладкою.'))));
  }

  // Full-size photo. ← → step through the person's photos, Esc or a click closes.
  function lightbox(A) {
    var s = A.s, p = s.data.people[s.focusId], list = p ? (p.photos || []).map(function (x) { return x.src; }) : [];
    if (p && p.photo && list.indexOf(p.photo) < 0) list.unshift(p.photo);
    var i = list.indexOf(s.lightbox), ph = p && (p.photos || []).find(function (x) { return x.src === s.lightbox; });
    var close = function () { A.set({ lightbox: null, focusReq: 'card:' + s.focusId }); };
    var go = function (k) { if (list.length > 1 && i >= 0) A.set({ lightbox: list[(i + k + list.length) % list.length], focusReq: 'lb-close' }); };
    var img = A.img(s.lightbox, (ph && ph.caption) || (p ? 'Фото: ' + FE.nameOf(p) : 'Фото'));
    img.setAttribute('style', 'max-width:92vw;max-height:84vh;display:block;border-radius:4px;box-shadow:var(--shadow-3)');
    var btn = function (label, k, ic, fn) { return el('button.ft-icon-btn', { type: 'button', 'aria-label': label, title: label, 'data-k': k, style: 'background:var(--surface)', on: { click: function (e) { e.stopPropagation(); fn(); } } }, icon(ic)); };
    return el('div.ft-scrim', { style: 'cursor: zoom-out; flex-direction: column; gap: 12px', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Фото' + (p ? ': ' + FE.nameOf(p) : ''),
      on: { click: close, keydown: function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } } } },
      img,
      el('div', { style: 'display:flex;gap:8px;align-items:center;color:#fff;font-size:13px' },
        list.length > 1 ? btn('Попереднє фото (←)', 'lb-prev', 'arrowLeft', function () { go(-1); }) : null,
        list.length > 1 ? el('span', null, (i + 1) + ' з ' + list.length) : null,
        list.length > 1 ? btn('Наступне фото (→)', 'lb-next', 'arrowRight', function () { go(1); }) : null,
        btn('Закрити (Esc)', 'lb-close', 'close', close)));
  }

  /* ---------------------------------------------------------------- poster */
  function poster(A) {
    var s = A.s, d = s.data, pfocus = d.people[s.focusId] ? s.focusId : d.rootId, fp = d.people[pfocus];
    // nobody to print (the last person was just removed): close instead of drawing nothing
    if (!fp) { Promise.resolve().then(function () { A.set({ posterOpen: false }); }); return el('div'); }
    var DP = FE.DIMS.poster;
    var L = FE.layoutTree(d, pfocus, DP, { upGen: s.posterUp, downGen: s.posterDown, sibFamilies: s.posterSibs, ghosts: false });
    var b = L.bounds, TW = 1587 - 128, TH = 1123 - 128 - 104 - 40 - 48;
    var bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
    var wk = Math.min(TW / bw, TH / bh, 1.35);
    var ids = Object.keys(L.nodes), rowsSeen = {};
    ids.forEach(function (id) { rowsSeen[L.nodes[id].row] = 1; });
    var gens = Object.keys(rowsSeen).length, total = Object.keys(d.people).length;
    var phone = A.isPhone();
    var stW = Math.max(200, (document.getElementById('app').clientWidth || 1200) - (phone ? 0 : 320) - 48), stH = Math.max(200, (document.getElementById('app').clientHeight || 800) - 48);
    var sk = Math.min(stW / 1587, stH / 1123), sx = Math.round(24 + (stW - 1587 * sk) / 2), sy = Math.round(24 + (stH - 1123 * sk) / 2);

    var world = el('div.ft-poster__world', { style: 'transform: translate(' + Math.round((TW - bw * wk) / 2 - b.minX * wk) + 'px, ' + Math.round((TH - bh * wk) / 2 - b.minY * wk) + 'px) scale(' + wk.toFixed(4) + ')' });
    world.appendChild(FA.linesSvg(L.segs, { flat: true }));
    L.labels.forEach(function (l) { world.appendChild(el('span.ft-ulabel', { cls: l.cls.replace('is-hl', '').trim(), style: 'left:' + Math.round(l.x) + 'px;top:' + Math.round(l.y) + 'px;background:#FFFDF9;color:#4A443B' }, l.text)); });
    L.tags.forEach(function (l) { world.appendChild(el('span.ft-ltag', { style: 'left:' + Math.round(l.x) + 'px;top:' + Math.round(l.y) + 'px;background:#FFFDF9' }, l.text)); });
    ids.forEach(function (id) {
      var p = d.people[id], n = L.nodes[id];
      var ph = el('span.ft-pnode__photo');
      if (p.photo) ph.appendChild(A.portrait(p)); else ph.textContent = FE.initials(p);
      world.appendChild(el('div.ft-pnode' + (p.deceased ? '.is-deceased' : '') + (id === pfocus ? '.is-focus' : '') + (!p.given && !p.surname ? '.is-unknown' : ''),
        { style: 'transform: translate(' + Math.round(n.x) + 'px, ' + Math.round(n.y) + 'px)' },
        ph, el('span', { style: 'min-width:0' }, el('span.ft-pnode__name', null, p.given && p.surname ? [el('span', null, FE.caseName(p.given.trim())), el('span', null, FE.caseName(p.surname.trim()))] : FE.nameOf(p)), el('span.ft-pnode__years', { style: 'display:block' }, FE.yearsOf(p) || ' '))));
    });
    var leg = function (style, text) { return el('span', null, el('i', { style: style }), text); };
    var sheet = el('div.ft-poster.ft-print-target' + (s.posterPhotos ? '' : '.no-photos'), { style: 'transform: translate(' + sx + 'px, ' + sy + 'px) scale(' + sk.toFixed(4) + ')' },
      el('header.ft-poster__head', null,
        el('div', null, el('p.ft-poster__eyebrow', null, 'Родинний архів'), el('h1.ft-poster__title', null, fp.surname ? 'Рід: ' + FE.caseName(fp.surname) : 'Наша родина')),
        el('p.ft-poster__sub', null, count(gens, 'покоління', 'покоління', 'поколінь') + ' · у центрі ' + FE.nameOf(fp), el('br'), 'Укладено ' + FE.fmtDate(FA.today()))),
      el('div.ft-poster__tree', null, world),
      el('footer.ft-poster__foot', null,
        el('div.ft-poster__legend', null,
          leg('', 'Шлюб · рідна дитина'), leg('border-top-style: dashed', 'Партнери · усиновлена дитина'), leg('border-top-style: dotted', 'Нерідна дитина чи під опікою'),
          el('span', null, el('b', { style: 'font-weight:600' }, 'шл.'), 'Шлюб'), el('span', null, el('b', { style: 'font-weight:600' }, 'розл.'), 'Розлучення'),
          leg('width:14px;height:14px;border:1px solid #6A6256;background:linear-gradient(135deg, transparent 0 30%, #2B2722 30% 52%, transparent 52%)', 'Померлі')),
        el('span', null, ids.length + ' з ' + count(total, 'людини', 'людей', 'людей') + ' в архіві · Родинний архів')));

    var gen = function (key) { return [1, 2, 3, 4].map(function (n) { return { label: String(n), sel: s[key] === n, pick: function () { var p = {}; p[key] = n; A.set(p); } }; }); };
    var close = function () { A.set({ posterOpen: false, focusReq: 'card:' + s.focusId }); };
    var opts = el('div.ft-posteropts', { role: 'group', 'aria-label': 'Параметри постера' },
      el('div.ft-pop__head', null, el('h2.ft-dialog__title', null, 'Друк постера'), A.closeBtn(close, 'Закрити попередній перегляд (Esc)', 'poster-close')),
      el('p.ft-hint', { style: 'font-size:13px' }, 'Одна сторінка A3 альбомної орієнтації в кольорах, зручних для друку, незалежно від теми. У центрі — ' + FE.nameOf(fp) + '; щоб змінити, виберіть когось іншого в дереві.'),
      el('div.ft-field', null, el('span.ft-field__label', null, 'Поколінь вище'), A.seg(gen('posterUp'), 'Поколінь вище', true)),
      el('div.ft-field', null, el('span.ft-field__label', null, 'Поколінь нижче'), A.seg(gen('posterDown'), 'Поколінь нижче', true)),
      el('label.ft-check', null, el('input', { type: 'checkbox', checked: s.posterSibs, on: { change: function () { A.set({ posterSibs: !s.posterSibs }); } } }), 'Включити родини братів і сестер'),
      el('label.ft-check', null, el('input', { type: 'checkbox', checked: s.posterPhotos, on: { change: function () { A.set({ posterPhotos: !s.posterPhotos }); } } }), 'Показувати фото'),
      el('button.ft-btn.ft-btn--primary.ft-btn--lg', { type: 'button', on: { click: function () { try { window.print(); } catch (e) { /* ignore */ } } } }, icon('print'), 'Надрукувати або зберегти PDF'),
      el('p.ft-hint', null, ids.length + ' з ' + total + ' вміщується на сторінці. У діалозі друку виберіть A3, альбомна, без полів.'),
      // below about half size the names get hard to read on paper
      wk < 0.5 ? el('p.ft-hint', { style: 'color: var(--danger)' }, 'Картки вийдуть дрібними. Зменште кількість поколінь або вимкніть родини братів і сестер.') : null);
    return el('div.ft-posterwrap', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Друк постера' }, opts, el('div.ft-posterstage', null, sheet));
  }

  FA.renderMainView = renderMainView;
  FA.renderOverlays = renderOverlays;
})();
