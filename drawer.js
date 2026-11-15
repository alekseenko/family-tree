/* Family Archive — the detail drawer: header, edit mode, family links and their
   editor, notes and photos. Rendered from app state on every change. */
(function () {
  'use strict';
  var FA = window.FA, FE = window.FamilyEngine, St = FA.Storage;
  var el = FA.el, icon = FA.icon, count = FA.count;

  var REL_SEG = [['bio', 'Рідні'], ['adopted', 'Усиновлення'], ['step', 'Нерідні'], ['foster', 'Опіка']];
  // the tag beside a non-biological parent, in that parent's gender
  var PARENT_TAG = { adopted: ['усиновлювач', 'усиновлювачка'], step: ['вітчим', 'мачуха'], foster: ['опікун', 'опікунка'] };
  function parentTag(rel, q) { var t = PARENT_TAG[rel]; return !t ? rel : q && q.sex === 'f' ? t[1] : q && q.sex === 'm' ? t[0] : t[0] + ' чи ' + t[1]; }
  var UNION_SEG = [['married', 'Шлюб'], ['partner', 'Партнери'], ['divorced', 'Розлучення']];
  var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };

  function renderDrawer(slot, A) {
    var s = A.s;
    slot.textContent = '';
    var d = s.data, p = d && d.people[s.focusId];
    if (!d || !p || !s.drawerOpen || s.screen !== 'app') return;
    var ro = A.ro(), pid = p.id;

    var aside = el('aside.ft-drawer', { 'aria-label': 'Подробиці: ' + FE.nameOf(p) });
    aside.appendChild(el('div.ft-drawer__grab', { 'aria-hidden': 'true' }));
    aside.appendChild(bar(A, p, ro));
    var scroll = el('div.ft-drawer__scroll');
    scroll.appendChild(head(A, p, ro));
    var unknown = !p.given && !p.surname;
    if (unknown && !p.birth.date && !p.photo && !(p.photos || []).length && !p.notes) {
      scroll.appendChild(el('div.ft-empty-person', null,
        el('p.ft-empty-person__t', null, 'Про цю особу ще нічого не записано.'),
        el('p.ft-hint', { style: 'font-size:13px' }, 'Можливо, це заповнювач, створений під час додавання родича. Впишіть, що знаєте, або пов’яжіть стосунок із кимось, хто вже є в дереві.'),
        !ro ? el('div.ft-empty-person__actions', null,
          el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: A.startEdit } }, 'Додати ім’я'),
          el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: function () { A.openQa('partner', pid, 'link'); } } }, 'Пов’язати з наявною особою')) : null));
    }
    scroll.appendChild(family(A, p, ro));
    scroll.appendChild(notes(A, p, ro));
    scroll.appendChild(photos(A, p, ro));
    scroll.appendChild(el('footer.ft-dfoot', null, (p.updated && FE.fmtDate(p.updated) ? 'Змінено ' + FE.fmtDate(p.updated) : 'Ще не змінювалося') + ' · ID ' + pid));
    aside.appendChild(scroll);
    slot.appendChild(aside);
  }

  /* ---------------------------------------------------------------- bar */
  function bar(A, p, ro) {
    var s = A.s, d = s.data, pid = p.id;
    var acts = el('div.ft-drawer__acts');
    if (!ro) {
      acts.appendChild(s.editMode
        ? el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', 'data-k': 'ed-done', on: { click: A.endEdit } }, 'Готово')
        : el('button.ft-btn.ft-btn--sm', { type: 'button', 'data-k': 'ed-start', 'aria-keyshortcuts': 'E', on: { click: A.startEdit } }, icon('edit', 'ft-ico--sm'), 'Редагувати', el('kbd.ft-kbd', { 'aria-hidden': 'true' }, 'E')));
    }
    acts.appendChild(el('button.ft-icon-btn', { type: 'button', 'aria-label': 'Інші дії', 'aria-expanded': String(s.moreOpen), 'data-k': 'more', on: { click: function () { A.set({ moreOpen: !s.moreOpen }); } } }, icon('more')));
    acts.appendChild(el('button.ft-icon-btn', { type: 'button', 'aria-label': 'Закрити подробиці (Esc)', on: { click: function () { A.set({ drawerOpen: false, editMode: false, moreOpen: false }); } } }, icon('close')));
    var b = el('div.ft-drawer__bar', null,
      el('span.ft-drawer__crumb', null, s.editMode && !ro ? 'Редагування' : (pid === d.rootId ? 'Головна особа' : 'Особа')), acts);
    if (s.moreOpen) {
      var item = function (ic, label, go, danger) { return el('button.ft-menu__item' + (danger ? '.ft-menu__item--danger' : ''), { type: 'button', on: { click: go } }, icon(ic), label); };
      var m = el('div.ft-menu.ft-menu--small', { role: 'group', 'aria-label': 'Дії з особою' });
      if (!ro && pid !== d.rootId) m.appendChild(item('home', 'Зробити головною особою', function () {
        A.commit(function (dd) { dd.rootId = pid; }, { toast: FE.givenOf(p) + ' тепер головна особа', state: { moreOpen: false } });
      }));
      m.appendChild(item('descendants', 'Показати нащадків', function () { A.set({ view: 'desc', dvRoot: pid, moreOpen: false }); }));
      if (!A.isPhone()) m.appendChild(item('print', 'Постер із центром тут', function () { A.set({ posterOpen: true, focusReq: 'poster-close', moreOpen: false, qa: null }); }));
      if (!ro) {
        m.appendChild(el('div.ft-menu__sep', { role: 'separator' }));
        m.appendChild(item('trash', 'Видалити особу…', function () { A.askDelete(pid); }, true));
      }
      b.appendChild(m);
    }
    return b;
  }

  /* ---------------------------------------------------------------- header */
  function head(A, p, ro) {
    var s = A.s, d = s.data, pid = p.id, unknown = !p.given && !p.surname;
    var mountImg = el('div.ft-mount__img');
    if (p.photo) {
      var im = A.portrait(p, 'Портрет: ' + FE.nameOf(p), el('span.ft-mount__initials', null, FE.initials(p)));
      mountImg.appendChild(zoomable(A, im, p.photo, 'портрет ' + FE.nameOf(p)));
    } else mountImg.appendChild(el('span.ft-mount__initials', null, FE.initials(p)));
    var mount = el('div.ft-mount' + (p.deceased ? '.is-deceased' : ''), null, mountImg);
    // the main photo can be framed when it is one of the person's photos
    var framable = !ro && p.photo && (p.photos || []).some(function (x) { return x.src === p.photo; });
    if (framable && s.frameEdit !== pid) mount = el('div.ft-mountcol', null, mount,
      el('button.ft-link.ft-mount__frame', { type: 'button', 'data-k': 'frame', on: { click: function () { A.set({ frameEdit: pid, focusReq: 'frame-box' }); } } }, 'Кадрувати'));

    var age = p.deceased ? FE.ageBetween(p.birth.date, p.death.date) : null, problem = FE.dateProblem(p);
    if (age != null && age < 0) age = null;
    var born = FE.fmtDate(p.birth.date), died = FE.fmtDate(p.death.date);
    var home = d.people[d.rootId], kin = home ? FE.kinship(d, d.rootId, p.id) : '';
    var text = el('div', { style: 'min-width:0' },
      el('h2.ft-dname' + (unknown ? '.is-unknown' : ''), null, FE.nameOf(p)),
      kin ? el('p.ft-dkin', { title: 'Відносно головної особи — ' + FE.nameOf(home) }, kin) : null,
      p.nick ? el('p.ft-daka', null, '«' + p.nick + '»') : null,
      p.birthName && p.birthName !== p.surname ? el('p.ft-daka', null, 'з дому ' + FE.caseName(p.birthName)) : null);
    var editing = s.editMode && !ro;
    if (!editing) {
      var fact = function (label, val, muted, place) {
        return el('div.ft-fact', null, el('dt', null, label), el('dd', null, el('span' + (muted ? '.ft-fact__muted' : ''), null, val), place ? el('span.ft-fact__place', null, place) : null));
      };
      text.appendChild(el('dl.ft-facts', null,
        fact('Народження', born || 'Не вказано', !born, p.birth.place),
        p.deceased ? fact('Смерть', died ? died + (age != null ? ' · ' + count(age, 'рік', 'роки', 'років') : '') : 'Дату не вказано', !died, p.death.place) : null));
    }
    var sec = el('section.ft-dhead', null, mount, text);
    if (framable && s.frameEdit === pid) sec.appendChild(framer(A, p));
    var found = A.issues()[p.id];
    // while editing, the problems sit above the fields that fix them
    if (editing) sec.appendChild(editGrid(A, p));
    if (found && !A.s.present) sec.insertBefore(el('div.ft-issues', { role: 'note', 'aria-label': 'Перевірка даних' },
      found.map(function (x) { return el('p.ft-issue.is-' + x.level, null, icon(x.level === 'error' ? 'alert' : 'info', 'ft-ico--sm'), el('span', null, x.text)); }),
      !editing && !ro ? el('button.ft-link', { type: 'button', on: { click: A.startEdit } }, 'Виправити') : null), editing ? sec.querySelector('.ft-editgrid') : null);
    return sec;
  }

  // Framing the main photo: what shows in the square on cards and avatars. The photo's frame is
  // { pos: "x% y%", zoom }: pos is where it is anchored (CSS object-position), zoom magnifies around
  // that point. Drag the photo, use the arrow keys, or the zoom slider.
  var frameDrag = null;   // a drag in progress; it outlives a redraw of the panel
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  function framer(A, p) {
    var pid = p.id, ph = p.photos.find(function (x) { return x.src === p.photo; });
    var cur = (ph.pos || '50% 50%').split(' ').map(parseFloat), f = { x: cur[0], y: cur[1], z: ph.zoom || 1 };
    if (frameDrag && frameDrag.pid === pid) f = frameDrag.f;
    var im = A.img(p.photo, 'Головне фото: ' + FE.nameOf(p));
    im.draggable = false;
    var box = el('div.ft-framer__box', { tabindex: '0', role: 'group', 'data-k': 'frame-box', 'aria-label': 'Кадр головного фото: перетягніть, стрілки зсувають, плюс і мінус змінюють масштаб',
      'aria-describedby': 'ft-framer-hint' }, im);
    var hint = el('p.ft-hint', { id: 'ft-framer-hint' });
    var zoom = el('input.ft-framer__zoom', { type: 'range', min: '1', max: '3', step: '0.05', value: String(f.z), 'aria-label': 'Масштаб', 'data-k': 'frame-zoom' });
    // the image now in the panel (a redraw replaces it)
    var liveImg = function () { var b = document.querySelector('[data-k="frame-box"]'); return b && b.querySelector('img'); };
    var show = function () { A.frameStyle(liveImg() || im, f.x + '% ' + f.y + '%', f.z); };
    var save = function () {
      var pos = Math.round(f.x) + '% ' + Math.round(f.y) + '%', z = Math.round(f.z * 100) / 100;
      A.commit(function (d) {
        var q = d.people[pid], g = q && q.photos.find(function (x) { return x.src === q.photo; });
        if (!g) return false;
        if (pos === '50% 50%') delete g.pos; else g.pos = pos;
        if (z > 1) g.zoom = z; else delete g.zoom;
      }, { touch: pid, coalesce: 'pos:' + pid });
    };
    A.frameStyle(im, f.x + '% ' + f.y + '%', f.z);
    // how far, in screen pixels, the picture can travel on each axis at this zoom
    var room = function (b) {
      var r = b.getBoundingClientRect(), i = b.querySelector('img'), nw = i.naturalWidth || 1, nh = i.naturalHeight || 1, k = Math.max(r.width / nw, r.height / nh);
      return { x: r.width * (f.z - 1) + f.z * (nw * k - r.width), y: r.height * (f.z - 1) + f.z * (nh * k - r.height) };
    };
    var explain = function () {
      if (!im.naturalWidth) return;
      var w = im.naturalWidth, h = im.naturalHeight;
      hint.textContent = (f.z > 1.01 ? 'Перетягніть фото, щоб вибрати, що видно' : Math.abs(w - h) < 2 ? 'Фото квадратне й видно повністю. Збільште масштаб, щоб наблизити, і перетягніть' : w < h ? 'Перетягуйте фото вгору чи вниз, щоб вибрати, що видно' : 'Перетягуйте фото вліво чи вправо, щоб вибрати, що видно') +
        ' на картках і в мініатюрах. Стрілки зсувають точніше, + і − змінюють масштаб.';
    };
    if (im.complete) explain(); else im.addEventListener('load', explain);
    var onMove = function (e) {
      var d = frameDrag; if (!d) return;
      // dragging the picture right shows more of its left side
      if (d.room.x > 1) f.x = clamp(d.x - (e.clientX - d.sx) / d.room.x * 100, 0, 100);
      if (d.room.y > 1) f.y = clamp(d.y - (e.clientY - d.sy) / d.room.y * 100, 0, 100);
      show();
    };
    var onUp = function () {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      var b = document.querySelector('[data-k="frame-box"]'); if (b) b.classList.remove('is-dragging');
      frameDrag = null; save();
    };
    box.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      e.preventDefault(); box.focus();
      frameDrag = { pid: pid, f: f, sx: e.clientX, sy: e.clientY, x: f.x, y: f.y, room: room(box) };
      box.classList.add('is-dragging');
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    });
    if (frameDrag && frameDrag.pid === pid) box.classList.add('is-dragging');
    box.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 1 : 5, dx = { ArrowLeft: -step, ArrowRight: step }[e.key] || 0, dy = { ArrowUp: -step, ArrowDown: step }[e.key] || 0;
      var dz = e.key === '+' || e.key === '=' ? 0.1 : e.key === '-' || e.key === '−' ? -0.1 : 0;
      if (!dx && !dy && !dz) return;
      e.preventDefault(); e.stopPropagation();
      f.x = clamp(f.x + dx, 0, 100); f.y = clamp(f.y + dy, 0, 100); f.z = clamp(f.z + dz, 1, 3);
      show(); save();
    });
    zoom.addEventListener('input', function () { f.z = clamp(parseFloat(zoom.value) || 1, 1, 3); show(); explain(); });
    zoom.addEventListener('change', save);
    return el('div.ft-framer', { role: 'group', 'aria-label': 'Кадрування головного фото' },
      box,
      el('div.ft-framer__side', null, hint,
        el('label.ft-framer__zoomrow', null, el('span', null, 'Масштаб'), zoom),
        el('div.ft-framer__acts', null,
          el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: function () { f.x = 50; f.y = 50; f.z = 1; zoom.value = '1'; show(); explain(); save(); } } }, 'Скинути'),
          el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', on: { click: function () { A.set({ frameEdit: null, focusReq: 'frame' }); } } }, 'Готово'))));
  }

  function patchPerson(A, pid, path, val) {
    A.commit(function (d) {
      var p = d.people[pid]; if (!p) return false;
      if (path === 'birth.date') p.birth.date = val;
      else if (path === 'birth.place') p.birth.place = val;
      else if (path === 'death.date') { p.death.date = val; if (val) p.deceased = true; }
      else if (path === 'death.place') p.death.place = val;
      else p[path] = val;
    }, { coalesce: 'edit:' + pid, touch: pid });
  }
  // Places already used in the tree, most used first.
  function knownPlaces(d) {
    var n = {};
    Object.keys(d.people).forEach(function (id) {
      var q = d.people[id];
      [q.birth && q.birth.place, q.death && q.death.place].forEach(function (x) { x = String(x || '').trim(); if (x) n[x] = (n[x] || 0) + 1; });
    });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || a.localeCompare(b, 'uk'); });
  }
  var WORD = /[^\s,.;:()\/-]+/g;
  var words = function (v) { return String(v || '').toLowerCase().match(WORD) || []; };
  // Every typed word has to start some word of the place, in any order: "запор" and
  // "вишн укр" both match. An empty field lists the most used places.
  function matchPlaces(list, q) {
    var toks = words(q), cur = String(q || '').trim().toLowerCase();
    return list.filter(function (pl) {
      if (pl.toLowerCase() === cur) return false;
      var ws = words(pl);
      return toks.every(function (tk) { return ws.some(function (w) { return w.indexOf(tk) === 0; }); });
    }).slice(0, 8);
  }
  // The place with the typed word starts marked.
  function markPlace(pl, q) {
    var toks = words(q), out = [], last = 0, m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(pl))) {
      var w = m[0].toLowerCase(), len = 0;
      toks.forEach(function (tk) { if (w.indexOf(tk) === 0 && tk.length > len) len = tk.length; });
      if (!len) continue;
      out.push(pl.slice(last, m.index), el('span.is-mark', null, pl.slice(m.index, m.index + len)));
      last = m.index + len;
    }
    out.push(pl.slice(last));
    return out;
  }
  // A text field with suggestions from places already in the tree. The list opens on click,
  // typing or ↓; ↑↓ move, Enter picks, Esc closes.
  function placeField(A, pid, label, path, val, k) {
    var s = A.s, open = !!(s.ac && s.ac.k === k);
    var list = open ? matchPlaces(knownPlaces(s.data), val) : [];
    var idx = list.length ? Math.min(s.ac.idx, list.length - 1) : -1;  // -1: nothing highlighted, Enter keeps the text
    var openAt = function (i) { A.set({ ac: { k: k, idx: i } }); };
    var pick = function (v) { s.ac = null; patchPerson(A, pid, path, v); };
    var input = el('input.ft-input', { autocomplete: 'off', value: val || '', 'data-k': k, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(list.length > 0), 'aria-controls': k + '-list',
      'aria-activedescendant': idx >= 0 ? k + '-opt-' + idx : null,
      on: {
        input: function (e) { s.ac = { k: k, idx: -1 }; patchPerson(A, pid, path, e.target.value); },
        click: function () { if (!open) openAt(-1); },
        focus: function () { A.cancel('ac'); },
        blur: function () { A.later('ac', 150, function () { if (A.s.ac && A.s.ac.k === k) A.set({ ac: null }); }); },
        keydown: function (e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); openAt(open && list.length ? (idx + 1) % list.length : 0); }
          else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); openAt(idx <= 0 ? list.length - 1 : idx - 1); }
          else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(list[idx]); }
          else if (e.key === 'Escape' && list.length) { e.preventDefault(); e.stopPropagation(); A.set({ ac: null }); }
        }
      } });
    return el('label.ft-field.ft-ac', null, el('span.ft-field__label', null, label), input,
      list.length ? el('div.ft-results.ft-ac__list', { role: 'listbox', id: k + '-list', 'aria-label': label },
        list.map(function (pl, i) {
          return el('div.ft-result.ft-ac__opt' + (i === idx ? '.is-active' : ''), { role: 'option', id: k + '-opt-' + i, 'aria-selected': String(i === idx),
            on: { mousedown: function (e) { e.preventDefault(); pick(pl); }, mousemove: function () { if (i !== idx) openAt(i); } } }, markPlace(pl, val));
        })) : null);
  }
  function editGrid(A, p) {
    var pid = p.id, problem = FE.dateProblem(p);
    var field = function (label, path, val, k, extra) {
      extra = extra || {};
      return el('label.ft-field' + (extra.wide ? '.ft-field--wide' : ''), null, el('span.ft-field__label', null, label),
        el('input.ft-input' + (extra.bad ? '.is-invalid' : ''), { autocomplete: 'off', value: val || '', placeholder: extra.ph, 'aria-invalid': extra.bad ? 'true' : null, 'data-k': k, on: { input: function (e) { patchPerson(A, pid, path, e.target.value); } } }),
        extra.after || null);
    };
    // Dates can be typed in any usual way; the line under the field says how it was read, and
    // leaving the field stores the tidy form (12 3 1931 → 12.03.1931).
    var dateField = function (label, path, val, k, bad) {
      var r = FE.readDate(val), shown = r && !r.bad && !r.free ? FE.fmtDate(val) : '';
      var note = !r ? null : r.bad ? el('span.ft-datehint.is-bad', null, r.ambiguous ? 'Це ' + r.ambiguous.join(' чи ') + '? Поставте крапки' : 'Такої дати немає')
        : r.free ? el('span.ft-datehint', null, r.y ? 'Збережеться як текст' : 'Не схоже на дату — збережеться як текст')
        : shown !== String(val).trim() ? el('span.ft-datehint', null, shown) : null;
      var f = field(label, path, val, k, { ph: 'напр. 12 3 1931', bad: bad || !!(r && r.bad), after: note });
      // the line under the field is read out with it
      if (note) { note.id = 'hint-' + k; f.querySelector('input').setAttribute('aria-describedby', note.id); }
      // a re-render also blurs the field (and focus comes straight back): only a real leave counts
      f.querySelector('input').addEventListener('blur', function () {
        setTimeout(function () {
          var a = document.activeElement, q = A.s.data.people[pid];
          if ((a && a.getAttribute('data-k') === k) || !q) return;
          var cur = path === 'birth.date' ? q.birth.date : q.death.date, v = FE.normDate(cur);
          if (v !== cur) patchPerson(A, pid, path, v);
        }, 0);
      });
      return f;
    };
    var dateBad = !!problem, bad = function (v) { var r = FE.readDate(v); return !!(r && r.bad); };
    return el('div.ft-editgrid', null,
      field('Ім’я (імена)', 'given', p.given, 'ed-given'),
      field('Прізвище', 'surname', p.surname, 'ed-surname'),
      field('Прізвище при народженні', 'birthName', p.birthName, 'ed-birthname', { ph: 'напр. дівоче' }),
      field('Прізвисько', 'nick', p.nick, 'ed-nick', { ph: 'напр. Баба Ніна' }),
      el('div.ft-field.ft-field--wide', null, el('span.ft-field__label', null, 'Стать'),
        A.seg([['f', 'Жінка'], ['m', 'Чоловік'], ['u', 'Не вказано']].map(function (o) {
          return { label: o[1], sel: (p.sex || 'u') === o[0], pick: function () { patchPerson(A, pid, 'sex', o[0]); }, k: 'ed-sex-' + o[0] };
        }), 'Стать', true)),
      dateField('Дата народження', 'birth.date', p.birth.date, 'ed-bdate', bad(p.birth.date) || (dateBad && /раніша за дату народження|народження ще не настав/.test(problem))),
      placeField(A, pid, 'Місце народження', 'birth.place', p.birth.place, 'ed-bplace'),
      el('label.ft-check.ft-field--wide', null, el('input', { type: 'checkbox', checked: !!p.deceased, 'data-k': 'ed-dec', on: { change: function (e) { patchPerson(A, pid, 'deceased', !!e.target.checked); } } }), FE.vf(p, 'Помер', 'Померла')),
      p.deceased ? dateField('Дата смерті', 'death.date', p.death.date, 'ed-ddate', bad(p.death.date) || (dateBad && /раніша за дату народження|смерті ще не настав/.test(problem))) : null,
      p.deceased ? placeField(A, pid, 'Місце смерті', 'death.place', p.death.place, 'ed-dplace') : null,
      el('p.ft-hint.ft-field--wide', null, 'Дату пишіть як зручно: 12.03.1931, 12 3 1931, 12 березня 1931, березень 1931, бл. 1930. Зміни зберігаються під час введення. Скасувати — ⌘Z / Ctrl+Z.'));
  }

  /* ---------------------------------------------------------------- family */
  function family(A, p, ro) {
    var s = A.s, d = s.data, pid = p.id;
    var mk = function (id, o) {
      var q = d.people[id], editable = !ro && o.kind !== 'sibling', editing = editable && s.relEdit === o.key;
      var rowEl = el('div.ft-rel' + (q.deceased ? '.is-deceased' : '') + (editing ? '.is-editing' : ''), null,
        el('button.ft-rel__main', { type: 'button', 'data-k': 'rel:' + o.key, on: { click: function () { A.focusPerson(id, { noOpen: true }); } } },
          A.avatar(q), el('span.ft-rel__text', null, el('span.ft-rel__name', null, FE.nameOf(q)), el('span.ft-rel__meta', null, FE.yearsOf(q)))),
        o.tag ? el('span.ft-chip' + (o.tagCls ? '.' + o.tagCls : ''), null, o.tag) : null);
      if (editable) {
        var acts = el('div.ft-rel__acts');
        if (o.move) {
          acts.appendChild(el('button.ft-icon-btn.ft-icon-btn--sm', { type: 'button', 'aria-label': 'Перемістити вище: ' + FE.nameOf(q), 'data-k': 'mv:' + o.fam.id + ':' + id + ':up', disabled: !(o.idx > 0), on: { click: function () { moveKid(A, o.fam.id, id, -1); } } }, icon('up')));
          acts.appendChild(el('button.ft-icon-btn.ft-icon-btn--sm', { type: 'button', 'aria-label': 'Перемістити нижче: ' + FE.nameOf(q), 'data-k': 'mv:' + o.fam.id + ':' + id + ':dn', disabled: !(o.idx < o.n - 1), on: { click: function () { moveKid(A, o.fam.id, id, 1); } } }, icon('down')));
        }
        acts.appendChild(el('button.ft-icon-btn.ft-icon-btn--sm', { type: 'button', 'aria-label': 'Змінити зв’язок із: ' + FE.nameOf(q), 'aria-expanded': String(editing), 'data-k': 'reled:' + o.key,
          on: { click: function () { A.set({ relEdit: editing ? null : o.key, relConfirm: false, focusReq: editing ? null : 'reled-box' }); } } }, icon('edit')));
        rowEl.appendChild(acts);
      }
      return editing ? [rowEl, relEditor(A, o, id)] : [rowEl];
    };

    var parents = [];
    FE.parentFams(d, pid).forEach(function (f) {
      var k = f.kids.find(function (q) { return q.id === pid; });
      ['a', 'b'].forEach(function (side) {
        var id = f[side]; if (!id || !d.people[id]) return;
        var rel = k ? k['r' + side] : 'bio';
        parents = parents.concat(mk(id, { key: 'par:' + f.id + ':' + side, kind: 'parent', fam: f, side: side, childId: pid, tag: rel !== 'bio' ? parentTag(rel, d.people[id]) : '', tagCls: 'ft-chip--sepia' }));
      });
    });
    var pf = FE.primaryParentFam(d, pid), fams = FE.sortFams(FE.famsOf(d, pid));
    var partners = [];
    var withPartner = fams.filter(function (f) { var o = FE.other(f, pid); return o && d.people[o]; });
    withPartner.forEach(function (f, i) {
      var tag = (withPartner.length > 1 ? (i + 1) + ' · ' : '') + FE.unionLong(f);
      partners = partners.concat(mk(FE.other(f, pid), { key: 'ptn:' + f.id, kind: 'partner', fam: f, tag: tag, tagCls: f.type === 'divorced' || f.type === 'none' ? 'ft-chip--muted' : 'ft-chip--accent' }));
    });
    var kidFams = fams.filter(function (f) { return f.kids.some(function (k) { return d.people[k.id]; }); });
    var nKids = 0;
    var childBlocks = kidFams.map(function (f) {
      var o = FE.other(f, pid), side = f.a === pid ? 'a' : 'b';
      var kids = f.kids.filter(function (k) { return d.people[k.id]; });
      nKids += kids.length;
      var title = kidFams.length > 1 || !o ? (o && d.people[o] ? cap(FA.parentWord(d.people[o])) + ': ' + FE.nameOf(d.people[o]) : 'Другого з батьків не вказано') : '';
      var rows = [];
      kids.forEach(function (k, i) {
        var rel = k['r' + side];
        rows = rows.concat(mk(k.id, { key: 'kid:' + f.id + ':' + k.id, kind: 'child', fam: f, side: side, childId: k.id, tag: rel !== 'bio' ? FE.relTag(rel) : '', tagCls: 'ft-chip--sepia', move: kids.length > 1, idx: i, n: kids.length }));
      });
      return [title ? el('p.ft-relgroup__sub', null, title) : null].concat(rows);
    });
    var sibs = [];
    FE.siblingsOf(d, pid).forEach(function (x) {
      var tag = x.kind === 'full' ? (x.adopted ? 'усиновлення' : '') : (x.kind === 'half' ? FE.vf(d.people[x.id], 'напіврідний', 'напіврідна') + (x.adopted ? ' · усиновлення' : '') : FE.vf(d.people[x.id], 'зведений', 'зведена'));
      sibs = sibs.concat(mk(x.id, { key: 'sib:' + x.id, kind: 'sibling', tag: tag, tagCls: 'ft-chip--sepia' }));
    });
    var group = function (title, rows, empty, canAdd, addLabel, kind) {
      return el('div.ft-relgroup', null,
        el('div.ft-relgroup__head', null, el('h4.ft-relgroup__title', null, title),
          canAdd ? el('button.ft-btn.ft-btn--ghost.ft-btn--xs', { type: 'button', on: { click: function () { A.openQa(kind, pid); } } }, icon('plus', 'ft-ico--sm', { width: 2 }), addLabel) : null),
        rows.length ? rows : el('p.ft-relgroup__empty', null, empty));
    };
    return el('section.ft-section', { 'aria-label': 'Родина' },
      el('div.ft-section__head', null, el('h3.ft-section__title', null, 'Родина')),
      group('Батьки', parents, 'Батьків ще не вказано.', !ro && (!pf || !pf.b), 'Додати батька чи матір', 'parent'),
      group('Партнери', partners, 'Партнерів не вказано.', !ro, 'Додати партнера', 'partner'),
      group('Діти', nKids ? [].concat.apply([], childBlocks) : [], 'Дітей не вказано.', !ro, 'Додати дитину', 'child'),
      group('Брати й сестри', sibs, 'Братів і сестер не вказано.', !ro, 'Додати брата чи сестру', 'sibling'));
  }

  function setUnion(A, fid, patch, typing) {
    A.commit(function (d) { var f = d.families.find(function (x) { return x.id === fid; }); if (!f) return false; Object.assign(f, patch); }, { coalesce: typing ? 'union:' + fid : null, touch: A.s.focusId });
  }
  function setKidRel(A, fid, cid, side, rel) {
    A.commit(function (d) { var f = d.families.find(function (x) { return x.id === fid; }), k = f && f.kids.find(function (q) { return q.id === cid; }); if (!k) return false; k['r' + side] = rel; }, { touch: A.s.focusId });
  }
  // Moves a child to another of this parent's families ('solo' = other parent unknown).
  function moveChild(A, fromId, toId, cid, pid) {
    if (fromId === toId) return;
    var newFam = toId;
    A.commit(function (d) {
      var from = d.families.find(function (x) { return x.id === fromId; }); if (!from) return false;
      var k = from.kids.find(function (q) { return q.id === cid; }); if (!k) return false;
      var rel = from.a === pid ? k.ra : k.rb;
      var to = toId === 'solo' ? d.families.find(function (x) { return x.a === pid && !x.b; }) : d.families.find(function (x) { return x.id === toId; });
      if (!to) { to = { id: FE.newId(d, 'f'), a: pid, b: null, type: 'none', start: '', end: '', kids: [] }; d.families.push(to); }
      if (to.kids.some(function (q) { return q.id === cid; })) return false;
      from.kids = from.kids.filter(function (q) { return q.id !== cid; });
      FE.insertKid(d, to, to.a === pid ? { id: cid, ra: rel, rb: 'bio' } : { id: cid, ra: 'bio', rb: rel });
      d.families = d.families.filter(function (x) { return x.a && (x.b || x.kids.length); });
      newFam = to.id;
    }, { touch: A.s.focusId, after: function () { A.set({ relEdit: 'kid:' + newFam + ':' + cid }); } });
  }
  function moveKid(A, fid, cid, dir) {
    var next = '';
    A.commit(function (d) {
      var f = d.families.find(function (x) { return x.id === fid; }); if (!f) return false;
      var i = f.kids.findIndex(function (k) { return k.id === cid; }), j = i + dir;
      if (i < 0 || j < 0 || j >= f.kids.length) return false;
      var t = f.kids[i]; f.kids[i] = f.kids[j]; f.kids[j] = t;
      // focus stays on the arrow just used, or the other one once the child reaches the end
      var end = dir < 0 ? j === 0 : j === f.kids.length - 1;
      next = 'mv:' + fid + ':' + cid + ':' + ((dir < 0) !== end ? 'up' : 'dn');
    }, { touch: A.s.focusId });
    if (next) A.set({ focusReq: next });
  }

  function relEditor(A, o, otherId) {
    var s = A.s, d = s.data, conf = s.relConfirm;
    var f = d.families.find(function (x) { return x.id === o.fam.id; }) || o.fam;
    var me = A.given(s.focusId);
    var box = el('div.ft-releditor', { tabindex: '-1', 'data-k': 'reled-box', style: 'outline: none' });
    var confirmBox = function (text, alt, okLabel, ok) {
      return el('div.ft-confirm', { role: 'alertdialog', 'aria-label': 'Прибрати зв’язок?' },
        el('p.ft-confirm__text', null, text),
        el('div.ft-confirm__actions', null,
          el('button.ft-btn.ft-btn--sm', { type: 'button', 'data-k': 'rel-cancel', on: { click: function () { A.set({ relConfirm: false }); } } }, 'Скасувати'),
          alt ? el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: alt.go } }, alt.label) : null,
          el('button.ft-btn.ft-btn--sm.ft-btn--danger', { type: 'button', on: { click: ok } }, okLabel)));
    };
    var foot = function (label) {
      return el('div.ft-releditor__foot', null,
        el('button.ft-btn.ft-btn--sm.ft-btn--ghost.ft-btn--danger-text', { type: 'button', on: { click: function () { A.set({ relConfirm: true, focusReq: 'rel-cancel' }); } } }, icon('unlink', 'ft-ico--sm'), label),
        el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: function () { A.set({ relEdit: null, relConfirm: false, focusReq: 'reled:' + o.key }); } } }, 'Готово'));
    };
    if (o.kind === 'partner') {
      var them = A.given(otherId), n = f.kids.length;
      var themAcc = ({ f: 'її', m: 'його' })[(d.people[otherId] || {}).sex] || 'цю особу';
      var types = UNION_SEG.slice();
      if (f.type === 'none') types.push(['none', 'Спільні діти']);
      box.appendChild(el('div.ft-field', null, el('span.ft-field__label', null, 'Стосунки'),
        A.seg(types.map(function (t) { return { label: t[1], sel: f.type === t[0], pick: function () { setUnion(A, f.id, { type: t[0] }); } }; }), 'Стосунки', true)));
      var yr = function (label, key, k) {
        return el('label.ft-field', null, el('span.ft-field__label', null, label),
          el('input.ft-input.ft-input--sm', { inputmode: 'numeric', placeholder: 'Рік', value: f[key] || '', 'data-k': k, on: { input: function (e) { var p = {}; p[key] = e.target.value; setUnion(A, f.id, p, true); } } }));
      };
      // "Спільні діти" has no dates; an end year is kept (and shown) for a divorce
      if (f.type !== 'none') box.appendChild(el('div.ft-row2', null,
        yr(f.type === 'partner' ? 'Разом з' : 'Шлюб з', 'start', 'rel-start'),
        f.type === 'divorced' ? yr('Розлучення в', 'end', 'rel-end') : null));
      if (conf) {
        var detach = function (keep) {
          var msg = keep ? 'Стосунки прибрано — вони залишаються пов’язаними як спільні батьки' : 'Стосунки прибрано: ' + me + ' — ' + them;
          A.commit(function (dd) { return FE.detachPartner(dd, f.id, otherId, keep) ? undefined : false; }, { toast: msg, state: { relEdit: null, relConfirm: false }, touch: s.focusId });
        };
        box.appendChild(n
          ? confirmBox(me + ' і ' + them + ': ' + count(n, 'спільна дитина', 'спільні дитини', 'спільних дітей') + '. Прибрати лише стосунки чи також прибрати ' + themAcc + ' з батьків ' + (n === 1 ? 'цієї дитини' : 'цих дітей') + '?',
            { label: 'Лише стосунки', go: function () { detach(true); } }, 'Прибрати й з батьків', function () { detach(false); })
          : confirmBox('Прибрати стосунки (' + me + ' — ' + them + ')? Обоє залишаться в дереві.', null, 'Прибрати стосунки', function () { detach(false); }));
      } else box.appendChild(foot('Прибрати стосунки'));
      return box;
    }
    var childId = o.childId, parentId = f[o.side];
    var k = f.kids.find(function (q) { return q.id === childId; });
    var cur = k ? k['r' + o.side] : 'bio';
    var cName = A.given(childId), pName = A.given(parentId), op = f[o.side === 'a' ? 'b' : 'a'];
    box.appendChild(el('div.ft-field', null, el('span.ft-field__label', null, 'Зв’язок: ' + cName + ' → ' + pName),
      A.seg(REL_SEG.map(function (t) { return { label: t[1], sel: cur === t[0], pick: function () { setKidRel(A, f.id, childId, o.side, t[0]); } }; }), 'Тип зв’язку', true)));
    var pfams = o.kind === 'child' ? A.partnerFams(d, parentId) : [];
    if (pfams.length) {
      box.appendChild(el('div.ft-field', null, el('span.ft-field__label', null, 'Другий з батьків'),
        A.seg(pfams.map(function (g) { return { label: A.given(FE.other(g, parentId)), sel: g.id === f.id, pick: function () { moveChild(A, f.id, g.id, childId, parentId); } }; })
          .concat([{ label: 'Невідомо', sel: !f.b, pick: function () { moveChild(A, f.id, 'solo', childId, parentId); } }]), 'Другий з батьків', true)));
    }
    if (conf) {
      box.appendChild(confirmBox('Прибрати зв’язок ' + cName + ' — ' + pName + '? Обоє залишаться в дереві' + (op && d.people[op] ? '; ' + A.given(op) + ' і далі буде одним із батьків.' : '.'), null, 'Прибрати зв’язок', function () {
        A.commit(function (dd) { return FE.detachParentLink(dd, f.id, childId, parentId) ? undefined : false; },
          { toast: 'Зв’язок прибрано: ' + cName + ' — ' + pName, state: { relEdit: null, relConfirm: false }, touch: s.focusId });
      }));
    } else box.appendChild(foot(o.kind === 'parent' ? 'Від’єднати від: ' + pName : 'Від’єднати: ' + cName));
    return box;
  }

  /* ---------------------------------------------------------------- notes */
  function notes(A, p, ro) {
    var s = A.s, pid = p.id, md = FE.parseMd(p.notes || '');
    var editing = s.notesEdit && !ro;
    var sec = el('section.ft-section', { 'aria-label': 'Нотатки' },
      el('div.ft-section__head', null, el('h3.ft-section__title', null, 'Нотатки'),
        !ro && !editing && md.length ? el('button.ft-btn.ft-btn--ghost.ft-btn--xs', { type: 'button', 'data-k': 'notes-edit', on: { click: function () { startNotes(A, p); } } }, 'Редагувати') : null));
    if (editing) {
      var ta;
      var save = function () {
        var v = ta.value;
        if (v === (p.notes || '')) { A.set({ notesEdit: false, focusReq: 'notes-edit' }); return; }
        A.commit(function (d) { if (!d.people[pid]) return false; d.people[pid].notes = v; }, { touch: pid, state: { notesEdit: false, focusReq: 'notes-edit' } });
      };
      var wrap = function (pre, post, linePrefix) {
        var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, nv, caret;
        if (linePrefix) { var ls = v.lastIndexOf('\n', a - 1) + 1; nv = v.slice(0, ls) + linePrefix + v.slice(ls); caret = a + linePrefix.length; }
        else { var mid = v.slice(a, b) || 'текст'; nv = v.slice(0, a) + pre + mid + post + v.slice(b); caret = a + pre.length + mid.length + post.length; }
        ta.value = nv; s.notesDraft = nv;
        ta.focus(); ta.setSelectionRange(caret, caret);
      };
      ta = el('textarea.ft-input.ft-textarea', { rows: '8', 'aria-label': 'Нотатки в Markdown', 'data-k': 'notes', value: s.notesDraft,
        on: {
          input: function (e) { s.notesDraft = e.target.value; },
          keydown: function (e) {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); A.set({ notesEdit: false, focusReq: 'notes-edit' }); }
          }
        } });
      var tb = function (label, aria, style, fn) { return el('button', { type: 'button', 'aria-label': aria, style: style, on: { mousedown: function (e) { e.preventDefault(); }, click: fn } }, label); };
      sec.appendChild(el('div.ft-mdtools', { role: 'toolbar', 'aria-label': 'Форматування' },
        tb('Ж', 'Жирний', 'font-weight:700', function () { wrap('**', '**'); }),
        tb('К', 'Курсив', 'font-style:italic;font-family:var(--font-serif)', function () { wrap('*', '*'); }),
        tb('З', 'Заголовок', '', function () { wrap('', '', '## '); }),
        tb('•', 'Маркований список', '', function () { wrap('', '', '- '); })));
      var grow = function () { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
      ta.addEventListener('input', grow);
      requestAnimationFrame(grow);
      sec.appendChild(ta);
      sec.appendChild(el('div.ft-rowend', null,
        el('span.ft-hint', null, '**жирний** · *курсив* · ## заголовок · - список'),
        el('span', { style: 'display:flex;gap:6px' },
          el('button.ft-btn.ft-btn--sm', { type: 'button', on: { click: function () { A.set({ notesEdit: false, focusReq: 'notes-edit' }); } } }, 'Скасувати'),
          el('button.ft-btn.ft-btn--sm.ft-btn--primary', { type: 'button', title: 'Зберегти (⌘↵ / Ctrl+↵)', on: { click: save } }, 'Зберегти нотатки'))));
      return sec;
    }
    if (md.length) {
      var spans = function (list) { return list.map(function (sp) { return el('span' + (sp.cls ? '.' + sp.cls : ''), null, sp.t); }); };
      sec.appendChild(el('div.ft-md', null, md.map(function (b) {
        if (b.isH) return el('h4.ft-md__h', null, spans(b.spans));
        if (b.isList) return el('ul.ft-md__ul', null, b.items.map(function (it) { return el('li', null, spans(it.spans)); }));
        return el('p', null, spans(b.spans));
      })));
    } else if (!ro) sec.appendChild(el('button.ft-emptyline', { type: 'button', 'data-k': 'notes-edit', on: { click: function () { startNotes(A, p); } } }, 'Нотаток ще немає. Додайте спогад, історію чи звідки взявся запис.'));
    else sec.appendChild(el('p.ft-relgroup__empty', null, 'Нотаток ще немає.'));
    return sec;
  }
  function startNotes(A, p) {
    if (A.ro()) return;
    A.set({ notesEdit: true, notesDraft: p.notes || '', drawerOpen: true, focusReq: 'notes' });
  }

  /* ---------------------------------------------------------------- photos */
  function addFiles(A, files) {
    var s = A.s, pid = s.focusId;
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!list.length) { A.toast('Сюди можна додавати лише зображення.', false); return; }
    St.savePhotos(list, pid, s.data).then(function (srcs) {
      if (!srcs.length) return;
      A.commit(function (d) {
        var p = d.people[pid]; if (!p) return false;
        srcs.forEach(function (src, i) { p.photos.push({ id: 'ph-' + Date.now().toString(36) + i, src: src, caption: '' }); if (!p.photo) p.photo = src; });
      }, { toast: srcs.length === 1 ? 'Фото додано' : 'Додано ' + srcs.length + ' фото', touch: pid });
    }, function (e) { A.toast('Не вдалося додати фото: ' + (e && e.message || e), false); });
  }
  // A photo that opens full size on click, Enter or Space.
  function zoomable(A, im, src, label) {
    im.style.cursor = 'zoom-in';
    im.setAttribute('tabindex', '0'); im.setAttribute('role', 'button'); im.setAttribute('aria-label', 'Відкрити фото: ' + label);
    var open = function () { A.set({ lightbox: src, focusReq: 'lb-close' }); };
    im.addEventListener('click', open);
    im.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return im;
  }
  function photos(A, p, ro) {
    var s = A.s, pid = p.id, list = p.photos || [];
    var sec = el('section.ft-section', { 'aria-label': 'Фото' },
      el('div.ft-section__head', null, el('h3.ft-section__title', null, 'Фото'), el('span.ft-section__count', null, list.length ? list.length + ' фото' : '')));
    if (list.length) {
      sec.appendChild(el('div.ft-gallery', null, list.map(function (ph, i) {
        var editing = !ro && s.captionEdit === ph.id, isProfile = p.photo === ph.src;
        var im = A.img(ph.src, ph.caption || 'Фото ' + (i + 1) + ': ' + FE.nameOf(p));
        im.loading = 'lazy';
        zoomable(A, im, ph.src, ph.caption || 'фото ' + (i + 1));
        var frame = el('div.ft-photo__frame', null, im, isProfile ? el('span.ft-chip.ft-chip--accent.ft-photo__badge', null, 'Головне') : null);
        if (!ro) {
          frame.appendChild(el('div.ft-photo__acts', null,
            !isProfile ? el('button.ft-photo__btn', { type: 'button', 'aria-label': 'Зробити головним фото', title: 'Зробити головним фото', on: { click: function () {
              A.commit(function (d) { var q = d.people[pid]; if (!q) return false; q.photo = ph.src; }, { toast: 'Головне фото змінено', touch: pid });
            } } }, icon('person', 'ft-ico--sm')) : null,
            el('button.ft-photo__btn', { type: 'button', 'aria-label': 'Змінити підпис до фото' + (p.photos.length > 1 ? ' ' + (i + 1) : ''), title: 'Змінити підпис', 'data-k': 'capbtn:' + ph.id, on: { click: function () { A.set({ captionEdit: ph.id, focusReq: 'cap:' + ph.id }); } } }, icon('pencil', 'ft-ico--sm')),
            el('button.ft-photo__btn', { type: 'button', 'aria-label': 'Видалити фото' + (p.photos.length > 1 ? ' ' + (i + 1) : ''), title: 'Видалити фото', on: { click: function () {
              A.commit(function (d) {
                var q = d.people[pid]; if (!q) return false;
                q.photos = q.photos.filter(function (x) { return x.id !== ph.id; });
                if (q.photo === ph.src) q.photo = q.photos.length ? q.photos[0].src : null;
              }, { toast: 'Фото видалено', touch: pid });
            } } }, icon('trash', 'ft-ico--sm'))));
        }
        var cap = editing
          ? el('input.ft-input.ft-input--sm', { 'aria-label': 'Підпис', placeholder: 'Додати підпис', value: ph.caption || '', 'data-k': 'cap:' + ph.id,
            on: {
              input: function (e) {
                var v = e.target.value;
                A.commit(function (d) { var q = d.people[pid], x = q && q.photos.find(function (y) { return y.id === ph.id; }); if (!x) return false; x.caption = v; }, { coalesce: 'cap:' + ph.id, touch: pid });
              },
              keydown: function (e) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); A.set({ captionEdit: null, focusReq: 'capbtn:' + ph.id }); } },
              blur: function () { A.later('capblur', 120, function () { if (A.s.captionEdit === ph.id && document.activeElement.getAttribute('data-k') !== 'cap:' + ph.id) A.set({ captionEdit: null }); }); }
            } })
          : !ro && !ph.caption ? el('figcaption.ft-photo__cap.is-empty', null, el('button.ft-link', { type: 'button', 'data-k': 'capbtn:' + ph.id, on: { click: function () { A.set({ captionEdit: ph.id, focusReq: 'cap:' + ph.id }); } } }, 'Додати підпис'))
          : el('figcaption.ft-photo__cap' + (ph.caption ? '' : '.is-empty'), null, ph.caption || 'Без підпису');
        return el('figure.ft-photo', null, frame, cap);
      })));
    }
    if (!ro) {
      var zone, title = el('span.ft-dropzone__t', null, 'Перетягніть фото сюди');
      var over = function (on) { zone.classList.toggle('is-over', on); title.textContent = on ? 'Відпустіть, щоб додати до фото: ' + FE.givenOf(p) : 'Перетягніть фото сюди'; };
      zone = el('label.ft-dropzone', { on: {
        dragover: function (e) { e.preventDefault(); over(true); },
        dragleave: function (e) { if (!zone.contains(e.relatedTarget)) over(false); },
        drop: function (e) { e.preventDefault(); over(false); addFiles(A, e.dataTransfer && e.dataTransfer.files); }
      } },
      el('input.ft-sr', { type: 'file', accept: 'image/*', multiple: true, on: { change: function (e) { addFiles(A, e.target.files); try { e.target.value = ''; } catch (err) { /* ignore */ } } } }),
      icon('image', 'ft-ico--lg'), title,
      el('span.ft-dropzone__s', null, 'або натисніть, щоб вибрати · JPG чи PNG · ' + (St.S.mode === 'folder' && St.S.perm === 'granted' ? 'копіюються в photos/' : 'зберігаються в цьому браузері')));
      sec.appendChild(zone);
    } else if (!list.length) sec.appendChild(el('p.ft-relgroup__empty', null, 'Фото ще немає.'));
    return sec;
  }

  FA.renderDrawer = renderDrawer;
})();
