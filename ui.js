/* Family Archive — small DOM helpers shared by every script.
   User data only ever reaches the page through textContent (el's `text` or string children). */
(function () {
  'use strict';
  var FA = (window.FA = window.FA || {});

  // el('button.ft-btn.ft-btn--sm', { on: { click: fn }, 'aria-label': '…' }, 'Text', childNode, [more])
  function el(sel, props) {
    var parts = sel.split('.'), node = document.createElement(parts[0] || 'div');
    if (parts.length > 1) node.className = parts.slice(1).join(' ');
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v == null || v === false) return;
      if (k === 'on') Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
      else if (k === 'cls') node.className += (node.className ? ' ' : '') + v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'multiple' || k === 'hidden') node[k] = !!v;
      else if (k === 'ref') v(node);
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }
  function add(node, c) {
    if (c == null || c === false || c === '') return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(node, x); }); return; }
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }

  /* Inline icons (static markup from the design, never user data). */
  var P = {
    book: '<path d="M12 6.5C10 5 7.3 4.5 4 4.5v13c3.3 0 6 .5 8 2 2-1.5 4.7-2 8-2v-13c-3.3 0-6 .5-8 2z"/><path d="M12 6.5v13"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 19V8M7.5 12.5L12 8l4.5 4.5M5 4.5h14"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    folderOk: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M9.5 13.2l1.9 1.9 3.6-3.8"/>',
    backup: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.8 13.8L12 16l2.2-2.2"/>',
    browser: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/>',
    print: '<path d="M7 9V4.5h10V9"/><path d="M7 17H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17"/><path d="M7 14h10v6H7z"/>',
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7.5 14h9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    alert: '<path d="M12 4.5L3 19.5h18z"/><path d="M12 10v4.5M12 17v.2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    home: '<path d="M4.5 11L12 4.5l7.5 6.5M6.5 9.5V19.5h11V9.5"/>',
    cards: '<rect x="4" y="4.5" width="7" height="15" rx="1.5"/><rect x="13" y="4.5" width="7" height="15" rx="1.5"/><path d="M6 13h3M15 13h3"/>',
    legend: '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 7h3M4 12h1M6 12h1M4 17h.5M6 17h.5"/>',
    depth: '<path d="M12 4v16M8.5 7.5L12 4l3.5 3.5M8.5 16.5L12 20l3.5-3.5"/>',
    edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="M13.5 6.5l4 4"/>',
    pencil: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/>',
    more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
    descendants: '<path d="M6 4v12a3 3 0 0 0 3 3h9M6 9h9"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
    unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7"/><path d="M4 4l16 16"/>',
    up: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
    down: '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>',
    chevron: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
    arrowRight: '<path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5"/>',
    arrowLeft: '<path d="M19 12H5M10.5 6.5L5 12l5.5 5.5"/>',
    next: '<path d="M9.5 6.5l5.5 5.5-5.5 5.5"/>',
    person: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5a7 7 0 0 1 13 0"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
    tree: '<circle cx="12" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/><path d="M12 7.5V14M6 16.5V14h12v2.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'
  };
  var NS = 'http://www.w3.org/2000/svg';
  // icon('plus', 'ft-ico--sm', { width: 2.2 })
  function icon(name, cls, opt) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ft-ico' + (cls ? ' ' + cls : ''));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', (opt && opt.width) || 1.8);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = P[name] || '';
    return svg;
  }

  // Tree connectors from layoutTree segs as one SVG, so corners join cleanly at any zoom.
  // Highlighted lines are drawn last to sit on top. opt.flat drops the highlight (poster).
  function linesSvg(segs, opt) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ft-linesvg');
    svg.setAttribute('aria-hidden', 'true');
    if (!segs.length) return svg;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    segs.forEach(function (g) { minX = Math.min(minX, g.x); minY = Math.min(minY, g.y); maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h); });
    minX -= 4; minY -= 4; maxX += 4; maxY += 4;
    svg.setAttribute('viewBox', minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY));
    svg.style.cssText = 'left:' + minX + 'px;top:' + minY + 'px;width:' + (maxX - minX) + 'px;height:' + (maxY - minY) + 'px';
    var tone = function (g) { return opt && opt.flat && g.tone === 'hl' ? '' : g.tone; };
    segs.slice().sort(function (a, b) { return (tone(a) === 'hl') - (tone(b) === 'hl'); }).forEach(function (g) {
      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', g.x); ln.setAttribute('y1', g.y);
      ln.setAttribute('x2', g.k === 'h' ? g.x + g.w : g.x); ln.setAttribute('y2', g.k === 'v' ? g.y + g.h : g.y);
      ln.setAttribute('class', 'ft-ln' + (g.style !== 'solid' ? ' is-' + g.style : '') + (tone(g) ? ' is-' + tone(g) : ''));
      svg.appendChild(ln);
    });
    return svg;
  }

  // Ukrainian plural: plural(3, 'людина', 'людини', 'людей') → "людини"
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  function count(n, one, few, many) { return n + ' ' + plural(n, one, few, many); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowTime(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function today(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var MON_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  // "9 листопада, 14:32"
  function shortStamp(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return d.getDate() + ' ' + MON_GEN[d.getMonth()] + ', ' + nowTime(d);
  }
  // "сьогодні о 14:32", "9 листопада о 14:32"; older values hold only the time: "о 14:32"
  function whenAt(v) {
    if (/^\d\d:\d\d$/.test(v || '')) return 'о ' + v;
    var d = v ? new Date(v) : null;
    if (!d || isNaN(d)) return '';
    return (today(d) === today() ? 'сьогодні' : d.getDate() + ' ' + MON_GEN[d.getMonth()]) + ' о ' + nowTime(d);
  }

  // Deep copy of plain data. Strings are shared, so photo data URLs are not duplicated in undo history.
  function clone(x) {
    if (Array.isArray(x)) return x.map(clone);
    if (x && typeof x === 'object') { var o = {}; Object.keys(x).forEach(function (k) { o[k] = clone(x[k]); }); return o; }
    return x;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // "мати" / "батько" / "другий з батьків", by the parent's recorded sex
  function parentWord(p) { return ({ f: 'мати', m: 'батько' })[p && p.sex] || 'другий з батьків'; }

  FA.el = el;
  FA.add = add;
  FA.icon = icon;
  FA.linesSvg = linesSvg;
  FA.plural = plural;
  FA.count = count;
  FA.nowTime = nowTime;
  FA.today = today;
  FA.whenAt = whenAt;
  FA.shortStamp = shortStamp;
  FA.clone = clone;
  FA.clamp = clamp;
  FA.parentWord = parentWord;
})();
