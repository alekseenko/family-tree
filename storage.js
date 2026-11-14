/* Family Archive — saving.
   Two modes behind one interface:
   - folder: the user connects their family folder once (Chrome/Edge); family.js, photos/ and
     backups/ are written there automatically.
   - browser: everything stays in IndexedDB; "Download family.js" produces the file to swap in.
   The browser copy in IndexedDB is written on every change in both modes. */
(function () {
  'use strict';
  var FA = (window.FA = window.FA || {});

  var FILE = 'family.js';
  var KEEP_BACKUPS = 14;

  /* ---------------------------------------------------------------- IndexedDB */
  var dbp = null;
  // Private windows and some embedded browsers never open IndexedDB; give up after a few
  // seconds so the app still starts (it then behaves as download-only).
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      var t = setTimeout(function () { rej(new Error('IndexedDB did not open')); }, 4000);
      var r = indexedDB.open('family-archive', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); r.result.createObjectStore('photos'); };
      r.onsuccess = function () { clearTimeout(t); res(r.result); };
      r.onerror = function () { clearTimeout(t); rej(r.error); };
    });
    return dbp;
  }
  function idb(store, method, a, b) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        // a write counts once its transaction commits: a full disk fails there, not on the request
        var tx = d.transaction(store, method === 'get' ? 'readonly' : 'readwrite'), r = tx.objectStore(store)[method](a, b);
        tx.oncomplete = function () { S.idbOk = true; res(r.result); };
        tx.onabort = tx.onerror = function () { rej(tx.error || r.error); };
      });
    }).catch(function () { S.idbOk = false; return undefined; });
  }
  var kvGet = function (k) { return idb('kv', 'get', k); };
  var kvSet = function (k, v) { return idb('kv', 'put', v, k); };

  /* ---------------------------------------------------------------- file format */
  function serialize(d) {
    return '/* Family Archive data file. Loaded by index.html with <script src="family.js">.\n' +
      '   Written by the app. Everything after "window.FAMILY_DATA =" is plain JSON. */\n' +
      'window.FAMILY_DATA = ' + JSON.stringify(d, null, 2) + ';\n';
  }
  function parse(text) {
    var d = null, err = null;
    // the object assigned to window.FAMILY_DATA (the last assignment wins, as when the browser runs
    // the file), read up to its matching brace so comments around it don't matter
    var at = [], i = -1;
    while ((i = text.indexOf('FAMILY_DATA', i + 1)) >= 0) at.unshift(i);
    at.push(-1);
    for (var c = 0; c < at.length && !d; c++) {
      var json = objectAt(text, text.indexOf('{', Math.max(0, at[c])));
      if (!json) continue;
      try { d = JSON.parse(json); } catch (e) { err = err || e; }
    }
    if (!d) { if (err) throw err; throw new Error('У файлі немає даних родоводу'); }
    if (!d.people || typeof d.people !== 'object' || !Array.isArray(d.families)) throw new Error('Це не файл Родинного архіву');
    return normalize(d);
  }
  // The JSON object starting at text[a], up to its matching "}", or '' when there is none.
  function objectAt(text, a) {
    if (a < 0) return '';
    var depth = 0, str = false;
    for (var j = a; j < text.length; j++) {
      var ch = text[j];
      if (str) { if (ch === '\\') j++; else if (ch === '"') str = false; continue; }
      if (ch === '"') str = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return text.slice(a, j + 1);
    }
    return '';
  }
  // Ids become safe to use as object keys, in CSS selectors and in photo file names: letters
  // (Latin or Cyrillic), digits, _ and -, never a built-in name like "constructor" or "__proto__".
  function safeId(raw, taken, prefix) {
    var v = String(raw == null ? '' : raw).replace(/[^0-9A-Za-z_Ѐ-ӿ-]/g, '_').slice(0, 40);
    if (!v || v in Object.prototype) v = prefix + (v ? '_' + v : '');
    var base = v, n = 2;
    while (taken[v]) v = base + '_' + n++;
    taken[v] = true;
    return v;
  }
  var REL = { bio: 1, adopted: 1, step: 1, foster: 1 }, UNION = { married: 1, partner: 1, divorced: 1, none: 1 };
  var str = function (v) { return v == null || typeof v === 'object' ? '' : String(v); };
  // A photo is a file next to the tree (photos/…), one kept in this browser, or an embedded image;
  // never a web address (it would be fetched each time the tree is shown) or anything else.
  function okSrc(v) { return typeof v === 'string' && (/^idb:/.test(v) || /^data:image\//i.test(v) || (!!v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[\/\\]/.test(v))); }
  // Fills in what a hand-edited or older file may lack, and drops links to people who aren't there,
  // so the rest of the app can rely on the shape.
  function normalize(d) {
    var src = d.people, list = Array.isArray(src) ? src.map(function (p, i) { return [p && p.id != null ? p.id : 'p' + (i + 1), p]; })
      : Object.keys(src).map(function (k) { return [k, src[k]]; });
    // old id → new id; a Map, so "__proto__" and friends are ordinary keys
    var idMap = new Map(), taken = Object.create(null), people = Object.create(null);
    list.forEach(function (e) {
      var p = e[1];
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      var id = safeId(e[0], taken, 'p');
      if (!idMap.has(String(e[0]))) idMap.set(String(e[0]), id);
      p.id = id;
      ['given', 'surname', 'birthName', 'nick', 'notes'].forEach(function (k) { p[k] = str(p[k]); });
      ['birth', 'death'].forEach(function (k) { var e2 = p[k] && typeof p[k] === 'object' ? p[k] : {}; p[k] = { date: str(e2.date), place: str(e2.place) }; });
      if (p.sex !== 'm' && p.sex !== 'f') p.sex = 'u';
      p.deceased = !!p.deceased;
      p.photos = Array.isArray(p.photos) ? p.photos.map(function (x) { return typeof x === 'string' ? { src: x, caption: '' } : x; }).filter(function (x) { return x && okSrc(x.src); }) : [];
      // each photo needs its own id: deleting or captioning one must not touch another (the same id
      // on every read, so two reads of one file still compare equal)
      var phIds = Object.create(null);
      p.photos.forEach(function (x, i) {
        x.caption = str(x.caption);
        // framing of the main photo: "x% y%", each 0–100
        if (x.pos != null && !/^(100|\d{1,2}(\.\d+)?)% (100|\d{1,2}(\.\d+)?)%$/.test(x.pos)) delete x.pos;
        if (x.zoom != null && !(typeof x.zoom === 'number' && x.zoom > 1 && x.zoom <= 3)) delete x.zoom;
        x.id = x.id ? safeId(x.id, phIds, 'ph') : safeId('ph-' + id + '-' + (i + 1), phIds, 'ph');
      });
      if (!okSrc(p.photo) || !p.photo) p.photo = null;
      people[id] = p;
    });
    var ref = function (v) { return v == null ? null : idMap.get(String(v)) || null; };
    var ids = Object.create(null);
    d.people = {};
    Object.keys(people).forEach(function (id) { d.people[id] = people[id]; });
    d.families = d.families.filter(function (f) { return f && typeof f === 'object' && (ref(f.a) || ref(f.b)); }).map(function (f, i) {
      f.a = ref(f.a); f.b = ref(f.b);
      if (!f.a) { f.a = f.b; f.b = null; }
      if (f.b === f.a) f.b = null;
      f.id = safeId(f.id || 'f' + (i + 1), ids, 'f');
      var seenKid = Object.create(null);
      f.kids = (Array.isArray(f.kids) ? f.kids : []).map(function (k) { return typeof k === 'string' || typeof k === 'number' ? { id: k } : k; }).map(function (k) {
        var kid = k && ref(k.id);
        if (!kid || kid === f.a || kid === f.b || seenKid[kid]) return null;
        seenKid[kid] = true;
        return { id: kid, ra: REL[k.ra] ? k.ra : 'bio', rb: REL[k.rb] ? k.rb : 'bio' };
      }).filter(Boolean);
      f.start = str(f.start); f.end = str(f.end);
      if (!UNION[f.type]) f.type = f.b ? 'married' : 'none';
      return f;
    });
    d.title = str(d.title);
    d.meta = d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {};
    d.rootId = ref(d.rootId) || Object.keys(d.people)[0] || null;
    return d;
  }
  // Two copies of the same tree, or two different trees? New trees carry an id; older ones are
  // compared by their home person.
  function sameTree(x, y) {
    var a = x && x.meta && x.meta.treeId, b = y && y.meta && y.meta.treeId;
    if (a && b) return a === b;
    var px = x && x.people[x.rootId], py = y && y.people[y.rootId];
    return !!(px && py && x.rootId === y.rootId && px.given === py.given && px.surname === py.surname);
  }
  var rev = function (d) { return (d && d.meta && d.meta.revision) || 0; };

  /* ---------------------------------------------------------------- folder helpers */
  function writeFile(dir, name, contents) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable().then(function (w) { return w.write(contents).then(function () { return w.close(); }); });
    });
  }
  function readText(dir, name) {
    return dir.getFileHandle(name).then(function (fh) { return fh.getFile(); }).then(function (f) { return f.text(); });
  }
  function exists(dir, name) {
    return dir.getFileHandle(name).then(function () { return true; }, function () { return false; });
  }
  function readFolderData(dir) {
    return readFolder(dir).then(function (r) { return r && r.data; });
  }
  // { data, mod } where mod is the file's last-modified time, or null when there is no family.js.
  // A file that can't be read or isn't a tree is an error, never "no file": it must not be written over.
  function readFolder(dir) {
    return dir.getFileHandle(FILE).then(function (fh) { return fh.getFile(); }).then(function (f) {
      return f.text().then(function (t) {
        try { return { data: parse(t), mod: f.lastModified }; } catch (e) {
          // a JSON slip (comma, quote, comment) from editing the file by hand reads as English otherwise
          throw new Error('family.js у «' + dir.name + '» не вдалося прочитати: ' + (e instanceof SyntaxError ? 'у файлі помилка запису — можливо, його редагували вручну' : e.message));
        }
      });
    }, function (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; });
  }
  function fileMod(dir) {
    return dir.getFileHandle(FILE).then(function (fh) { return fh.getFile(); }).then(function (f) { return f.lastModified; }, function (e) { if (e && e.name === 'NotFoundError') return 0; throw e; });
  }
  // Rejects when the folder itself is gone (moved, renamed or deleted).
  function folderThere(dir) {
    return dir.keys ? dir.keys().next().then(function () { return true; }) : Promise.resolve(true);
  }

  /* ---------------------------------------------------------------- images */
  function toJpeg(file, max, quality) {
    return createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(res, 'image/jpeg', quality); });
    });
  }
  function blobToDataURL(blob) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); });
  }
  function dataURLToBlob(u) { return fetch(u).then(function (r) { return r.blob(); }); }

  // Every photo src stored in the data (profile + gallery).
  function eachPhoto(d, fn) {
    Object.keys(d.people).forEach(function (id) {
      var p = d.people[id];
      (p.photos || []).forEach(function (ph) { fn(ph.src, p); });
      if (p.photo) fn(p.photo, p);
    });
  }
  // Photos that moved (into the folder's photos/): the open tree, and through onRewrite the undo
  // history, point at their new place, so undo can't bring back a path that no longer works.
  var rewriteListeners = [];
  function movedPhotos(d, map) {
    if (!Object.keys(map).length) return;
    rewritePhotos(d, map);
    if (current && current !== d) rewritePhotos(current, map);
    rewriteListeners.forEach(function (fn) { fn(map); });
  }
  function rewritePhotos(d, map) {
    Object.keys(d.people).forEach(function (id) {
      var p = d.people[id];
      (p.photos || []).forEach(function (ph) { if (map[ph.src]) ph.src = map[ph.src]; });
      if (p.photo && map[p.photo]) p.photo = map[p.photo];
    });
  }

  /* ---------------------------------------------------------------- state */
  var S = {
    fsSupported: typeof window.showDirectoryPicker === 'function',
    // Served from a web site (GitHub Pages) rather than opened from disk. There the bundled family.js
    // is only the sample: a tree lives in a folder the visitor connects, never in the site.
    hosted: /^https?:$/.test(location.protocol),
    idbOk: true,
    mode: 'browser',          // 'folder' | 'browser' | 'sample' (published site, no folder: view-only)
    perm: 'granted',          // folder permission this session: 'granted' | 'prompt'
    dir: null,
    folderName: '',
    saving: false,
    saveError: false,
    permBanner: false,
    permError: '',            // why the last "Дозволити збереження" didn't work: 'denied' | an error name
    pending: 0,               // changes not yet in the file (folder) / not yet downloaded (browser)
    lastSaved: '',
    lastDownload: '',
    explainerSeen: false,
    hasBrowserCopy: false,
    browserCopyAt: '',
    revision: 0,
    saveErrorText: '',       // set when family.js is there but can't be read
    conflict: null,           // { data, at }: family.js was changed elsewhere while this tab had unsaved edits
    readOnly: false           // a second tab: never writes
  };
  // stamp: family.js's last-modified time when this tab last read or wrote it. A different time
  // means something else (another computer via Dropbox, another browser) changed the file.
  var listeners = [], timers = {}, current = null, lastBackupDay = '', urlCache = {}, stamp = 0, keepUnreadable = false;
  try { S.explainerSeen = localStorage.getItem('fa.explainerSeen') === '1'; } catch (e) { /* ignore */ }

  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function later(key, ms, fn) { clearTimeout(timers[key]); timers[key] = setTimeout(function () { delete timers[key]; fn(); }, ms); }
  // backups/family-2026-11-10-142305-<tag>.js: to the second, so two in one minute don't overwrite each other
  function backupName(tag) { var t = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; }; return 'family-' + FA.today(t) + '-' + p2(t.getHours()) + p2(t.getMinutes()) + p2(t.getSeconds()) + (tag ? '-' + tag : '') + '.js'; }
  function setStamp(m) { stamp = m || 0; if (!S.readOnly) kvSet('stamp', stamp); }

  function saveBrowserCopy() {
    if (!current || S.readOnly) return Promise.resolve();
    return kvSet('data', current).then(function () { return kvSet('pending', S.pending); });
  }

  function dailyBackup(dir) {
    var day = FA.today(), name = 'family-' + day + '.js';
    if (lastBackupDay === day) return Promise.resolve();
    return dir.getDirectoryHandle('backups', { create: true }).then(function (bdir) {
      return exists(bdir, name).then(function (has) {
        if (has) return null;
        return readText(dir, FILE).then(function (old) { return writeFile(bdir, name, old); }, function (e) { if (e && e.name !== 'NotFoundError') throw e; });
      }).then(function () { return prune(bdir); });
    }).then(function () { lastBackupDay = day; }, function () { /* a backup problem must not stop the save itself */ });
  }
  function prune(bdir) {
    if (!bdir.keys) return Promise.resolve();
    var names = [];
    var it = bdir.keys();
    function step() {
      return it.next().then(function (r) {
        if (r.done) return;
        if (/^family-\d{4}-\d{2}-\d{2}\.js$/.test(r.value)) names.push(r.value);
        return step();
      });
    }
    return step().then(function () {
      names.sort().reverse();
      return Promise.all(names.slice(KEEP_BACKUPS).map(function (n) { return bdir.removeEntry(n); }));
    });
  }

  // One write at a time: a change made during a write is written right after it, so an older
  // snapshot can never land last.
  var writing = null, writeAgain = false, busy = 0;  // busy: connect/allow are deciding
  function writeFolder() {
    if (writing) { writeAgain = true; return writing; }
    if (S.mode !== 'folder' || S.perm !== 'granted' || !S.dir || !current || S.readOnly || S.conflict) return Promise.resolve(false);
    S.saving = true; emit();
    var snapshot = current, written = S.pending, dir = S.dir;
    writing = fileMod(dir).then(function (mod) {
      // changed since this tab last saw it: stop and let the user choose
      if (stamp && mod && mod !== stamp) return readFolder(dir).then(function (r) {
        if (dir !== S.dir) return 'conflict';
        if (r && !sameContent(r.data, snapshot)) { S.conflict = { data: r.data, mod: r.mod }; return 'conflict'; }
        setStamp(mod);
      });
    }).then(function (c) {
      if (c === 'conflict') return false;
      // the file the user chose to replace (it couldn't be read) is kept as it was, or nothing is written
      var kept = !keepUnreadable ? Promise.resolve() : readText(dir, FILE).then(function (old) {
        return dir.getDirectoryHandle('backups', { create: true }).then(function (b) { return writeFile(b, backupName('unreadable'), old); });
      }, function (e) { if (e && e.name !== 'NotFoundError') throw e; }).then(function () { keepUnreadable = false; });
      return kept.then(function () { return dailyBackup(dir); }).then(function () { return writeFile(dir, FILE, serialize(snapshot)); })
        .then(function () { return dir !== S.dir ? null : fileMod(dir).then(setStamp, function () { setStamp(0); }); })
        .then(function () {
          if (dir !== S.dir) return false;
          S.saveError = false; S.saveErrorText = '';
          S.pending = Math.max(0, S.pending - written);
          S.lastSaved = FA.nowTime();
          saveBrowserCopy();
          return true;
        });
    }).then(function (ok) { S.saving = false; emit(); return ok; }, function (e) {
      S.saving = false;
      if (dir !== S.dir) { emit(); return false; }
      if (e && e.name === 'NotAllowedError') { S.perm = 'prompt'; S.permBanner = true; }
      else { S.saveError = true; S.saveErrorText = e && /family\.js у/.test(e.message) ? e.message : ''; }
      emit();
      return false;
    }).then(function (ok) {
      writing = null;
      if (writeAgain || dir !== S.dir) { writeAgain = false; if (S.pending) return writeFolder(); }
      return ok;
    });
    return writing;
  }
  function sameContent(a, b) {
    var strip = function (d) { var m = Object.assign({}, d.meta); delete m.savedAt; delete m.revision; return JSON.stringify(Object.assign({}, d, { meta: m })); };
    return strip(a) === strip(b);
  }

  function useFolder(dir) {
    S.dir = dir; S.folderName = dir.name; S.mode = 'folder'; S.perm = 'granted';
    S.saveError = false; S.saveErrorText = ''; S.permBanner = false; S.permError = ''; S.conflict = null; urlCache = {};
    lastBackupDay = '';
    // a save queued for the previous folder must not land in this one
    clearTimeout(timers.save); delete timers.save;
    return kvSet('dir', dir);
  }
  // A tree arriving in a folder: photo files from its previous folder come along, and photos kept
  // in this browser or embedded become files. Returns the {oldSrc: newSrc} rewrite already applied to d.
  function bringPhotos(d, from, dir) {
    return (from ? copyPhotoFiles(d, from, dir).catch(function () { /* best effort */ }) : Promise.resolve()).then(function () {
      return migratePhotos(d).catch(function () { return {}; });
    }).then(function (map) { movedPhotos(d, map); return map; });
  }
  // Files under photos/ that the tree uses, copied from the folder it lived in before (switching
  // folders). Files already in the new folder are left alone.
  function copyPhotoFiles(d, from, to) {
    var srcs = {};
    eachPhoto(d, function (src) { if (/^photos\//.test(src)) srcs[src] = 1; });
    return Object.keys(srcs).reduce(function (chain, src) {
      return chain.then(function () {
        var name = src.slice(7);
        return to.getDirectoryHandle('photos', { create: true }).then(function (pdir) {
          return exists(pdir, name).then(function (has) {
            if (has) return;
            return readPath(from, src).then(function (f) { return writeFile(pdir, name, f); }, function () { /* missing there too */ });
          });
        });
      });
    }, Promise.resolve());
  }

  // A data: URL as a Blob, decoded here rather than with fetch() (the site's security policy
  // only lets the page fetch its own files).
  function decodeDataURL(u) {
    var m = String(u).match(/^data:([^;,]*)(;base64)?,(.*)$/);
    if (!m) return null;
    // a damaged embedded photo is skipped, not a reason to refuse the whole file
    var raw;
    try { raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); } catch (e) { return null; }
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/jpeg' });
  }
  var EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  // Reads a file by its path inside a folder handle ("photos/p1-1.jpg").
  function readPath(dir, src) {
    var parts = src.split('/'), name = parts.pop();
    return parts.reduce(function (p, seg) { return p.then(function (dd) { return dd.getDirectoryHandle(seg); }); }, Promise.resolve(dir))
      .then(function (dd) { return dd.getFileHandle(name); }).then(function (fh) { return fh.getFile(); });
  }
  // Files from a folder can come without a type; the extension says what they are.
  var TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  function typed(blob, src) {
    if (!blob || /^image\//.test(blob.type)) return blob;
    var ext = (String(src).match(/\.(\w+)$/) || [])[1];
    return new Blob([blob], { type: TYPE[(ext || '').toLowerCase()] || 'image/jpeg' });
  }
  // The photo itself, wherever it is kept: this browser (idb:), the connected folder, or, on the
  // published site, the sample's photos/. null when it can't be read.
  function photoBlob(src) {
    return rawPhotoBlob(src).then(function (b) { return typed(b, src); });
  }
  function rawPhotoBlob(src) {
    if (/^data:/.test(src)) return Promise.resolve(decodeDataURL(src));
    if (/^idb:/.test(src)) return idb('photos', 'get', src.slice(4)).then(function (b) { return b || null; }, function () { return null; });
    if (/^https?:|^blob:/.test(src)) return Promise.resolve(null);
    if (S.mode === 'folder') return S.perm === 'granted' && S.dir ? readPath(S.dir, src).catch(function () { return null; }) : Promise.resolve(null);
    if (S.hosted) return fetch(src).then(function (r) { return r.ok ? r.blob() : null; }, function () { return null; });
    return Promise.resolve(null);
  }
  function sameBytes(a, b) {
    if (a.size !== b.size) return Promise.resolve(false);
    return Promise.all([a.arrayBuffer(), b.arrayBuffer()]).then(function (r) {
      var x = new Uint8Array(r[0]), y = new Uint8Array(r[1]);
      for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
      return true;
    });
  }
  // A file already in photos/ with exactly these bytes, so importing the same photos again
  // (restoring a download into its own folder) reuses them instead of making copies.
  function findSamePhoto(pdir, blob, index) {
    var list = function () {
      if (index.files) return Promise.resolve(index.files);
      var names = [], it = pdir.keys();
      var step = function () { return it.next().then(function (r) { if (r.done) return; names.push(r.value); return step(); }); };
      return step().then(function () {
        return Promise.all(names.map(function (n) { return pdir.getFileHandle(n).then(function (fh) { return fh.getFile(); }).then(function (f) { return { name: n, file: f }; }, function () { return null; }); }));
      }).then(function (fs) { return (index.files = fs.filter(Boolean)); });
    };
    return list().then(function (files) {
      var cands = files.filter(function (x) { return x.file.size === blob.size; });
      return cands.reduce(function (chain, x) {
        return chain.then(function (found) { return found || sameBytes(x.file, blob).then(function (eq) { return eq ? x.name : null; }); });
      }, Promise.resolve(null));
    });
  }
  // Photos kept inside the data (idb: in this browser, data: from an imported family.js) become
  // files in photos/ once the folder can be written. Existing files are never overwritten: a
  // photo gets the next free name, or reuses a file with identical bytes.
  function migratePhotos(d) {
    // in the same queue as adding photos, so both can't pick one free name
    var run = photoQueue.then(function () { return migrateNow(d); });
    photoQueue = run.catch(function () { /* next batch still runs */ });
    return run;
  }
  function migrateNow(d) {
    var srcs = {};
    eachPhoto(d, function (src, p) { if (/^(idb|data):/.test(src) && !srcs[src]) srcs[src] = p.id; });
    var map = {}, index = {};
    if (!Object.keys(srcs).length) return Promise.resolve(map);
    return S.dir.getDirectoryHandle('photos', { create: true }).then(function (pdir) {
      return Object.keys(srcs).reduce(function (chain, src) {
        return chain.then(function () {
          return photoBlob(src).then(function (blob) {
            if (!blob) return;
            return findSamePhoto(pdir, blob, index).then(function (same) {
              if (same) { map[src] = 'photos/' + same; return; }
              return nextPhotoName(d, srcs[src], map, EXT[blob.type] || 'jpg').then(function (name) {
                return writeFile(pdir, name, blob).then(function () {
                  map[src] = 'photos/' + name;
                  if (index.files) index.files.push({ name: name, file: blob });
                });
              });
            });
          });
        });
      }, Promise.resolve());
    }).then(function () { return map; });
  }
  // photos/<personId>-<n>.<ext> with the lowest n not used in the data or the folder.
  function nextPhotoName(d, pid, extraMap, ext) {
    var used = {};
    eachPhoto(d, function (src) { used[src] = 1; });
    Object.keys(extraMap || {}).forEach(function (k) { used[extraMap[k]] = 1; });
    var n = 1;
    function tryN() {
      var name = pid + '-' + n + '.' + (ext || 'jpg');
      if (used['photos/' + name]) { n++; return tryN(); }
      return S.dir.getDirectoryHandle('photos', { create: true }).then(function (pdir) { return exists(pdir, name); })
        .then(function (has) { if (has) { n++; return tryN(); } return name; });
    }
    return tryN();
  }

  var photoQueue = Promise.resolve();
  function savePhotosNow(files, pid, d) {
    var out = [], map = {};
    return files.reduce(function (chain, file) {
      return chain.then(function () {
        if (S.mode === 'folder' && S.perm === 'granted' && S.dir) {
          return toJpeg(file, 2400, 0.9).then(function (blob) {
            return nextPhotoName(d, pid, map).then(function (name) {
              return S.dir.getDirectoryHandle('photos', { create: true }).then(function (pdir) { return writeFile(pdir, name, blob); })
                .then(function () { map[name] = 'photos/' + name; out.push('photos/' + name); });
            });
          });
        }
        return toJpeg(file, 1600, 0.85).then(function (blob) {
          var key = 'ph-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          return idb('photos', 'put', blob, key).then(function () {
            if (!S.idbOk) return blobToDataURL(blob).then(function (u) { out.push(u); });
            urlCache['idb:' + key] = URL.createObjectURL(blob);
            out.push('idb:' + key);
          });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  var Storage = {
    S: S,
    serialize: serialize,
    parse: parse,
    normalize: normalize,
    onChange: function (fn) { listeners.push(fn); },
    onRewrite: function (fn) { rewriteListeners.push(fn); },
    rewritePhotos: rewritePhotos,

    // Decide what to open. Returns { data, screen, notice, error }.
    init: function (fileData, fileError) {
      var sample = fileData;
      var out = { data: S.hosted ? null : fileData, screen: 'app', notice: '', error: S.hosted ? '' : fileError || '' };
      return Promise.all([kvGet('data'), kvGet('dir'), kvGet('pending'), kvGet('choice'), kvGet('lastDownload'), kvGet('stamp')]).then(function (r) {
        var copy = r[0], dir = r[1], seen = r[5] || 0, file = null;
        stamp = seen;
        S.pending = r[2] || 0;
        S.lastDownload = r[4] || '';
        S.hasBrowserCopy = !!copy;
        S.browserCopyAt = copy && copy.meta ? copy.meta.savedAt : '';
        var step = Promise.resolve();
        if (dir && S.fsSupported && typeof dir.queryPermission === 'function') {
          S.dir = dir; S.folderName = dir.name; S.mode = 'folder';
          step = dir.queryPermission({ mode: 'readwrite' }).then(function (perm) {
            if (perm === 'granted') {
              S.perm = 'granted';
              return readFolder(dir).then(function (fr) {
                if (fr) { file = fr; out.data = fr.data; out.error = ''; return; }
                // no family.js: a new folder, or the folder itself is gone
                return folderThere(dir).catch(function () { S.saveError = true; });
              }, function (e) { out.error = String(e && e.message || e); });
            }
            S.perm = 'prompt'; S.permBanner = true;
          }, function () { S.perm = 'prompt'; S.permBanner = true; });
        }
        return step.then(function () {
          if (out.error) { out.screen = 'error'; return out; }
          if (S.hosted && S.mode !== 'folder') {
            // published site without a folder: the sample, read-only; browser copies are ignored
            S.mode = 'sample'; S.pending = 0;
            out.data = sample;
            if (!sample) { out.screen = 'error'; out.error = fileError || 'Не вдалося завантажити зразок'; return out; }
            if (S.fsSupported && !r[3]) out.screen = 'welcome';
            current = out.data; S.revision = rev(out.data);
            return out;
          }
          if (S.mode === 'folder' && !file && copy) {
            // the folder can't be read yet (permission to ask, or it's gone): the browser copy is the
            // latest this tab knows; "Дозволити збереження" compares it with the file
            out.data = copy;
            if (S.perm === 'granted' && !S.saveError && !S.pending) S.pending = 1;  // family.js was removed: write it again
          } else if (file && copy && seen) {
            // The browser copy holds edits the file doesn't have yet. If the file changed elsewhere
            // meanwhile, both versions exist and the user picks.
            if (!S.pending) setStamp(file.mod);
            else if (!sameTree(copy, file.data)) { out.data = copy; S.conflict = { data: file.data, mod: file.mod }; }
            else if (file.mod === seen) out.data = copy;
            else if (sameContent(copy, file.data)) { S.pending = 0; setStamp(file.mod); }
            else { out.data = copy; S.conflict = { data: file.data, mod: file.mod }; }
          } else if (copy && (!out.data || rev(copy) > rev(out.data))) {
            // only worth saying when the folder was readable but older; otherwise the status pill explains it
            if (out.data && S.mode === 'folder' && S.perm === 'granted') out.notice = 'Використано новішу копію, збережену в цьому браузері (' + FA.shortStamp(copy.meta.savedAt) + ')';
            out.data = copy;
            if (!S.pending) S.pending = 1;
          } else if (copy && rev(copy) < rev(out.data)) {
            S.pending = 0;
          }
          if (file && !seen) setStamp(file.mod);
          if (out.data && out.data.meta && out.data.meta.sample && !copy && !dir && !r[3]) out.screen = 'welcome';
          S.revision = rev(out.data);
          current = out.data;
          if (out.screen === 'app' && S.mode === 'folder' && S.perm === 'granted' && S.pending) later('save', 700, writeFolder);
          return out;
        });
      });
    },

    // Called after every change to the data.
    changed: function (d) {
      current = d;
      S.revision = Math.max(S.revision, rev(d)) + 1;
      d.meta = d.meta || {};
      if (!d.meta.treeId && !d.meta.sample) d.meta.treeId = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      d.meta.revision = S.revision;
      d.meta.savedAt = new Date().toISOString();
      S.pending++;
      S.hasBrowserCopy = true;
      later('idb', 300, saveBrowserCopy);
      if (S.mode === 'folder' && S.perm === 'granted' && !S.saveError && !S.conflict) later('save', 700, writeFolder);
      emit();
    },
    // A second tab of the same archive: shows, never writes.
    setReadOnly: function (v) { S.readOnly = !!v; if (v) { clearTimeout(timers.save); clearTimeout(timers.idb); timers = {}; } },
    // Something may have changed family.js while this tab was in the background (another computer
    // via Dropbox, another browser). Unchanged → null. Changed and nothing unsaved here → { load }.
    // Changed with unsaved edits here → a conflict for the user to resolve.
    check: function () {
      if (S.mode !== 'folder' || S.perm !== 'granted' || !S.dir || S.readOnly || S.conflict || writing || busy || !stamp) return Promise.resolve(null);
      var dir = S.dir;
      return fileMod(dir).then(function (mod) {
        if (!mod || mod === stamp) return null;
        return readFolder(dir).then(function (r) {
          if (!r || dir !== S.dir) return null;
          if (sameContent(r.data, current)) { setStamp(r.mod); return null; }
          if (!S.pending && !timers.save) { current = r.data; S.revision = rev(r.data); setStamp(r.mod); saveBrowserCopy(); emit(); return { load: r.data }; }
          S.conflict = { data: r.data, mod: r.mod }; emit();
          return { conflict: true };
        });
      }).catch(function () { return null; });
    },
    // 'mine' keeps this tab's tree and writes it; 'theirs' opens the file's. Either way the other
    // version is kept in backups/. Returns the tree to show.
    resolve: function (which) {
      var c = S.conflict, dir = S.dir;
      if (!c || !dir) return Promise.resolve(null);
      var loser = which === 'mine' ? c.data : current, tag = which === 'mine' ? 'other' : 'mine';
      var name = backupName(tag);
      // the version that loses is written to backups/ first; if that fails, nothing is overwritten
      return dir.getDirectoryHandle('backups', { create: true }).then(function (b) { return writeFile(b, name, serialize(loser)); }).then(function () {
        S.conflict = null;
        if (which === 'mine') {
          setStamp(c.mod); S.pending = Math.max(S.pending, 1);
          return bringPhotos(current, c.from, dir).then(function () { return writeFolder(); }).then(function (ok) { return { data: current, backup: name, saved: ok }; });
        }
        current = c.data; S.pending = 0; S.revision = rev(c.data); setStamp(c.mod); saveBrowserCopy(); emit();
        return { data: c.data, backup: name, saved: true };
      });
    },
    // Replace the data without counting it as an edit (undo stack reset, imports handle their own).
    setCurrent: function (d) { current = d; },

    chooseBrowserOnly: function () { kvSet('choice', 'browser'); S.mode = 'browser'; S.dir = null; emit(); },
    chooseSample: function () { kvSet('choice', 'sample'); },
    // Before a reload: the browser copy and, when it can, the folder get the latest changes.
    flush: function () {
      if (S.mode === 'sample' || S.readOnly) return Promise.resolve();
      clearTimeout(timers.idb); clearTimeout(timers.save); timers = {};
      return saveBrowserCopy().then(function () { return S.mode === 'folder' && S.perm === 'granted' && S.pending ? writeFolder() : null; }).catch(function () { /* reload anyway */ });
    },
    rememberChoice: function () { kvSet('choice', 'made'); },

    // Returns { load: data|null, rewrite: {oldSrc: newSrc} }
    connect: function (d) {
      if (!S.fsSupported) return Promise.reject(new Error('unsupported'));
      var prev = S.mode === 'folder' ? S.dir : null, before = prev && S.perm === 'granted' ? prev : null;
      return window.showDirectoryPicker({ id: 'family-archive', mode: 'readwrite' }).then(function (dir) {
        busy++;
        // an unreadable family.js rejects here: it is never treated as "no file" and written over
        return readFolder(dir).then(function (fr) {
          // the same folder again (also while saving is paused): what this tab last saw still counts
          var same = prev && prev.isSameEntry ? prev.isSameEntry(dir).catch(function () { return false; }) : Promise.resolve(false);
          return Promise.all([same, writing]).then(function (r) { return r[0]; }).then(function (isSame) {
            var seen = isSame ? stamp : 0, from = before && !isSame ? before : null;
            return useFolder(dir).then(function () {
              kvSet('choice', 'folder');
              // the sample, or nothing at all on screen (the error screen): an empty folder starts a new tree
              var fd = fr && fr.data, isSample = !d || !Object.keys(d.people || {}).length || !!(d.meta && d.meta.sample);
              var open = function () {
                // unsaved edits to another tree (one kept only in this browser): a copy goes into the new
                // folder's backups/ first; if that fails, nothing is replaced
                var keep = S.pending && !isSample && d && Object.keys(d.people).length && !sameTree(fd, d);
                var name = backupName('browser');
                return (keep ? dir.getDirectoryHandle('backups', { create: true }).then(function (b) { return writeFile(b, name, serialize(d)); }).then(function () { S.keptAs = name; }, function (e) {
                  throw new Error('не вдалося зберегти копію дерева з цього браузера в backups/ (' + (e && e.message || e) + '). Спершу завантажте family.js через ☰');
                }) : Promise.resolve()).then(function () {
                  current = fd; S.pending = 0; S.revision = rev(fd); S.lastSaved = FA.nowTime(); setStamp(fr.mod); saveBrowserCopy(); emit(); return { load: fd, rewrite: {} };
                });
              };
              // an empty folder: start a new tree there instead of copying the sample into it
              if (!fd && isSample) { S.pending = 0; setStamp(0); emit(); return { load: null, empty: true, rewrite: {} }; }
              if (fd) {
                // A folder with a tree opens that tree, unless it is an older copy of the tree on screen
                // (edits made here first, or a folder moved while saving failed): then it's brought up to date.
                if (isSample || !sameTree(fd, d)) return open();
                if (!S.pending || sameContent(fd, d)) return open();
                if (seen ? fr.mod !== seen : rev(fd) >= rev(d)) {
                  // the file changed elsewhere too: show this tree and let the user pick
                  setStamp(seen || fr.mod - 1); current = d; S.conflict = { data: fd, mod: fr.mod, from: from }; emit();
                  return { load: null, conflict: true, rewrite: {} };
                }
                setStamp(fr.mod);
              } else setStamp(0);
              // the tree moves into this folder: photos from the old folder come along
              return bringPhotos(d, from, dir).then(function (map) {
                // edited meanwhile: the newer tree gets the new photo paths too, and is what's written
                if (!current || current === d) current = d;
                S.pending = Math.max(S.pending, 1);
                return writeFolder().then(function () { return { load: null, rewrite: map }; });
              });
            });
          });
        }).then(function (r) { busy--; return r; }, function (e) { busy--; throw e; });
      });
    },

    // Re-grant write access for this session (needs a click).
    allow: function (d) {
      if (!S.dir) return Promise.resolve({ n: 0, load: null });
      var ask;
      try { ask = S.dir.requestPermission({ mode: 'readwrite' }); } catch (e) { ask = Promise.reject(e); }
      return ask.then(function (perm) {
        if (perm !== 'granted') { S.permError = 'denied'; emit(); return { n: 0, load: null }; }
        S.perm = 'granted'; S.permBanner = false; S.permError = ''; urlCache = {};
        busy++;
        // family.js may have been changed elsewhere while this tab couldn't read it: never write over a newer file
        return readFolder(S.dir).then(function (fr) {
          var fd = fr && fr.data;
          if (fd && !sameContent(fd, d) && (d.meta && d.meta.sample || !S.pending || !sameTree(fd, d) || (stamp ? fr.mod !== stamp : rev(fd) > rev(d)))) {
            // changed elsewhere since this tab last saw it
            if (S.pending && !(d.meta && d.meta.sample)) { current = d; S.conflict = { data: fd, mod: fr.mod }; emit(); return { n: 0, load: null, conflict: true }; }
            current = fd; S.pending = 0; S.revision = rev(fd); S.lastSaved = FA.nowTime(); setStamp(fr.mod); saveBrowserCopy(); emit(); return { n: 0, load: fd };
          }
          if (fr) setStamp(fr.mod);
          var n = S.pending;
          // edited while the file was read: the newer tree counts
          if (current && current !== d) d = current; else current = d;
          return migratePhotos(d).then(function (map) {
            if (Object.keys(map).length) { movedPhotos(d, map); S.pending++; }
          }, function () { /* try on the next save */ })
            .then(writeFolder).then(function (ok) { return { n: ok ? n : 0, load: null }; });
        }, function (e) { S.saveError = true; S.saveErrorText = String(e && e.message || e); emit(); return { n: 0, load: null }; })
          .then(function (r) { busy--; return r; }, function (e) { busy--; throw e; });
      }, function (e) { S.permError = (e && e.name) || 'error'; emit(); return { n: 0, load: null }; });
    },

    // family.js couldn't be read and the user chose the browser copy: the next save first copies the
    // unreadable file to backups/ as it is, then replaces it
    replaceUnreadable: function () { stamp = 0; keepUnreadable = true; },
    retry: function () { S.saveError = false; S.saveErrorText = ''; emit(); return writeFolder(); },
    dismissPermBanner: function () { S.permBanner = false; emit(); },

    // Builds family.js with browser-kept photos embedded as data URLs and downloads it.
    download: function (d, name) {
      // One self-contained file: every photo goes in as a data: URL, wherever it is kept.
      var copy = FA.clone(d), srcs = {}, had = S.pending;
      eachPhoto(copy, function (src) { if (!/^data:/.test(src)) srcs[src] = 1; });
      var map = {}, missing = 0;
      return Promise.all(Object.keys(srcs).map(function (src) {
        return photoBlob(src).then(function (blob) { if (!blob) { missing++; return null; } return blobToDataURL(blob).then(function (u) { map[src] = u; }); });
      })).then(function () {
        rewritePhotos(copy, map);
        var embedded = {};
        eachPhoto(copy, function (src) { if (/^data:/.test(src)) embedded[src] = 1; });
        var stats = { photos: Object.keys(embedded).length, missing: missing };
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([serialize(copy)], { type: 'text/javascript' }));
        a.download = name || FILE;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        if (!name) {
          S.lastDownload = new Date().toISOString();
          kvSet('lastDownload', S.lastDownload);
          if (S.mode !== 'folder') { S.pending = Math.max(0, S.pending - had); kvSet('pending', S.pending); }
          var first = !S.explainerSeen;
          S.explainerSeen = true;
          try { localStorage.setItem('fa.explainerSeen', '1'); } catch (e) { /* ignore */ }
          emit();
          return Object.assign({ first: first }, stats);
        }
        return Object.assign({ first: false }, stats);
      });
    },

    backupNow: function (d) {
      // not the daily name: that one holds how the day started
      var name = backupName('');
      if (S.mode === 'folder' && S.perm === 'granted' && S.dir) {
        return S.dir.getDirectoryHandle('backups', { create: true }).then(function (b) { return writeFile(b, name, serialize(d)).then(function () { return prune(b); }); })
          .then(function () { return 'Резервну копію записано в backups/' + name; });
      }
      return Storage.download(d, name).then(function () { return 'Резервну копію завантажено як ' + name; });
    },

    // Stores image files; returns the src values to put on the person.
    savePhotos: function (files, pid, d) {
      // one batch at a time, so two quick adds can't both pick the same free file name
      var run = photoQueue.then(function () { return savePhotosNow(files, pid, d); });
      photoQueue = run.catch(function () { /* next batch still runs */ });
      return run;
    },

    // Resolves a stored photo src for an <img>. Returns a string when known right away.
    photoURL: function (src) {
      if (!src) return '';
      if (/^(data:|blob:|https?:)/.test(src)) return src;
      if (urlCache[src]) return urlCache[src];
      if (/^idb:/.test(src)) {
        return idb('photos', 'get', src.slice(4)).then(function (blob) { return blob ? (urlCache[src] = URL.createObjectURL(blob)) : ''; });
      }
      // Paths are relative to the family folder. Without access to it (a new session before
      // "Allow saving"), don't guess: photos/ next to index.html may belong to another tree.
      if (S.mode === 'folder') {
        if (S.perm !== 'granted' || !S.dir) return '';
        return readPath(S.dir, src).then(function (f) { return (urlCache[src] = URL.createObjectURL(f)); }, function () { return ''; });
      }
      return src;
    },

    // After an import: embedded photos become files in photos/ when the folder can be written,
    // otherwise they are kept in this browser until it can (migratePhotos runs on connect and on
    // "Дозволити збереження"). Returns how many photos the tree has afterwards.
    adoptPhotos: function (d) {
      // photos/… paths in an imported file point into some other folder: say how many can't be found here
      var rel = {};
      eachPhoto(d, function (src) { if (!/^(data|idb|blob|https?):/.test(src)) rel[src] = 1; });
      S.importMissing = 0;
      var check = Promise.all(Object.keys(rel).map(function (src) { return rawPhotoBlob(src).then(function (b) { if (!b) S.importMissing++; }, function () { S.importMissing++; }); }));
      return check.then(function () { return Storage.adoptEmbedded(d); });
    },
    adoptEmbedded: function (d) {
      if (S.mode === 'folder' && S.perm === 'granted' && S.dir) return migratePhotos(d).then(function (map) { rewritePhotos(d, map); return d; });
      var srcs = {};
      eachPhoto(d, function (src) { if (/^data:/.test(src)) srcs[src] = 1; });
      var map = {};
      return Object.keys(srcs).reduce(function (chain, src) {
        return chain.then(function () {
          var blob = decodeDataURL(src), key = 'ph-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          if (!blob) return;
          return idb('photos', 'put', blob, key).then(function () { if (S.idbOk) map[src] = 'idb:' + key; }, function () { /* stays embedded */ });
        });
      }, Promise.resolve()).then(function () { rewritePhotos(d, map); return d; });
    },

    readImport: function (file) {
      return file.arrayBuffer().then(decodeText).then(function (t) {
        if (/^\s*0\s+HEAD/.test(t)) return FA.Gedcom.parse(t);
        return parse(t);
      });
    },

    // Another tree to merge in, from a file (family.js or GEDCOM) or a whole folder. Photos must come
    // along as data: their photos/… paths would otherwise point at files in *this* tree's folder.
    // Resolves { data, name, lost } (lost: photos that couldn't be read).
    readOther: function (src) {
      var lost = 0;
      var keepEmbedded = function (d) {
        Object.keys(d.people).forEach(function (id) {
          var p = d.people[id];
          p.photos = p.photos.filter(function (x) { var ok = /^data:image\//.test(x.src); if (!ok) lost++; return ok; });
          if (p.photo && !p.photos.some(function (x) { return x.src === p.photo; })) p.photo = p.photos.length ? p.photos[0].src : null;
        });
        return d;
      };
      if (src.kind === 'directory') {
        return readFolder(src).then(function (fr) {
          if (!fr) throw new Error('у папці «' + src.name + '» немає family.js');
          var d = fr.data, jobs = [];
          Object.keys(d.people).forEach(function (id) {
            d.people[id].photos.forEach(function (x) {
              if (/^(data|idb):/.test(x.src)) return;
              jobs.push(readPath(src, x.src).then(function (f) { return blobToDataURL(typed(f, x.src)); }).then(function (u) {
                if (d.people[id].photo === x.src) d.people[id].photo = u;
                x.src = u;
              }, function () { /* missing: dropped below */ }));
            });
          });
          return Promise.all(jobs).then(function () { return { data: keepEmbedded(d), name: src.name, lost: lost }; });
        });
      }
      return Storage.readImport(src).then(function (d) { return { data: keepEmbedded(d), name: src.name, lost: lost }; });
    },

    openBrowserCopy: function () { return kvGet('data'); }
  };

  // Text in whatever encoding the file has: a BOM says UTF-16; otherwise UTF-8, and anything that isn't
  // valid UTF-8 is read as Windows-1251 (Ukrainian GEDCOM from older tools often is).
  function decodeText(buf) {
    var b = new Uint8Array(buf), dec = function (enc, fatal) { return new TextDecoder(enc, { fatal: !!fatal }).decode(b); };
    if (b[0] === 0xFF && b[1] === 0xFE) return dec('utf-16le');
    if (b[0] === 0xFE && b[1] === 0xFF) return dec('utf-16be');
    try { return dec('utf-8', true); } catch (e) { return dec('windows-1251'); }
  }

  /* ---------------------------------------------------------------- GEDCOM (basic) */
  // GEDCOM dates: "12 MAR 1931", "MAR 1931", "ABT 1930"; anything else goes out as typed.
  var GED_MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function gedDate(v) {
    var s = String(v || '').trim(), r = window.FamilyEngine.readDate(s), m;
    // "до 1930", "після 1930", "між 1930 і 1935"; any other text goes out as a date phrase in brackets
    if ((m = s.match(/^до\s+(\d{4})$/i))) return 'BEF ' + m[1];
    if ((m = s.match(/^після\s+(\d{4})$/i))) return 'AFT ' + m[1];
    if ((m = s.match(/^між\s+(\d{4})\s+(?:і|й|та|-|–)\s+(\d{4})$/i))) return 'BET ' + m[1] + ' AND ' + m[2];
    if (!r || r.free || r.bad) return s ? '(' + s.replace(/[()]/g, '') + ')' : '';
    if (r.approx) return 'ABT ' + r.y;
    return (r.d ? r.d + ' ' : '') + (r.m ? GED_MON[r.m - 1] + ' ' : '') + r.y;
  }
  // "12 MAR 1931" → 12.03.1931, "ABT 1930" → бл. 1930; anything else as written.
  function fromGed(v) {
    var s = String(v || '').trim().toUpperCase(), m;
    if ((m = s.match(/^(?:ABT|EST|CAL|AROUND)\.?\s+(\d{4})$/))) return 'бл. ' + m[1];
    if ((m = s.match(/^BEF\.?\s+(\d{4})$/))) return 'до ' + m[1];
    if ((m = s.match(/^AFT\.?\s+(\d{4})$/))) return 'після ' + m[1];
    if ((m = s.match(/^(?:BET|FROM)\s+(\d{4})\s+(?:AND|TO)\s+(\d{4})$/))) return 'між ' + m[1] + ' і ' + m[2];
    if ((m = String(v).trim().match(/^\((.*)\)$/))) return m[1].trim();
    if ((m = s.match(/^(?:(\d{1,2})\s+)?([A-Z]{3})\s+(\d{4})$/)) && GED_MON.indexOf(m[2]) >= 0) {
      var mm = GED_MON.indexOf(m[2]) + 1, pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return (m[1] ? pad(+m[1]) + '.' : '') + pad(mm) + '.' + m[3];
    }
    return String(v || '').trim();
  }
  FA.Gedcom = {
    write: function (d) {
      var L = ['0 HEAD', '1 SOUR FamilyArchive', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
      var idx = {};
      Object.keys(d.people).forEach(function (id, i) { idx[id] = '@I' + (i + 1) + '@'; });
      // the tree's own title and home person, in tags other programs skip and this one reads back
      if (d.title) L.push('1 _TITL ' + d.title);
      if (idx[d.rootId]) L.push('1 _HOME ' + idx[d.rootId]);
      // GEDCOM lines stay short: a long line goes on in CONC lines, a new line is CONT; @ is written @@
      var note = function (text) {
        String(text).replace(/@/g, '@@').split('\n').forEach(function (ln, i) {
          var parts = ln.match(/[\s\S]{1,200}/g) || [''];
          parts.forEach(function (part, j) { L.push((j ? '2 CONC ' : i ? '2 CONT ' : '1 NOTE ') + part); });
        });
      };
      Object.keys(d.people).forEach(function (id) {
        var p = d.people[id];
        L.push('0 ' + idx[id] + ' INDI');
        L.push('1 NAME ' + (p.given || '') + ' /' + (p.surname || '') + '/');
        if (p.nick) L.push('2 NICK ' + p.nick);
        if (p.birthName && p.birthName !== p.surname) { L.push('2 TYPE married'); L.push('1 NAME ' + (p.given || '') + ' /' + p.birthName + '/'); L.push('2 TYPE birth'); }
        L.push('1 SEX ' + ({ m: 'M', f: 'F' }[p.sex] || 'U'));
        if (p.birth.date || p.birth.place) { L.push('1 BIRT'); if (p.birth.date) L.push('2 DATE ' + gedDate(p.birth.date)); if (p.birth.place) L.push('2 PLAC ' + p.birth.place); }
        if (p.deceased) { L.push('1 DEAT Y'); if (p.death.date) L.push('2 DATE ' + gedDate(p.death.date)); if (p.death.place) L.push('2 PLAC ' + p.death.place); }
        if (p.notes) note(p.notes);
        // photos kept as files (photos/…) go out as links; ones kept only in this browser can't
        var pics = (p.photos || []).slice();
        if (p.photo && !pics.some(function (x) { return x.src === p.photo; })) pics.unshift({ src: p.photo, caption: '' });
        pics.forEach(function (x) {
          if (/^(idb|data|blob):/.test(x.src)) return;
          L.push('1 OBJE'); L.push('2 FILE ' + x.src);
          if (x.caption) L.push('2 TITL ' + x.caption);
          if (x.src === p.photo) L.push('2 _PRIM Y');
          if (x.pos || x.zoom) L.push('2 _POSI ' + (x.pos || '50% 50%') + (x.zoom ? ' ' + x.zoom : ''));
        });
      });
      var REL_OUT = { bio: 'Natural', adopted: 'Adopted', step: 'Step', foster: 'Foster' };
      d.families.forEach(function (f, i) {
        L.push('0 @F' + (i + 1) + '@ FAM');
        // GEDCOM has husband and wife slots; the woman goes in WIFE when that's known
        var a = idx[f.a] ? f.a : null, b = idx[f.b] ? f.b : null;
        if (a && d.people[a].sex === 'f' && !(b && d.people[b].sex === 'f')) { var t = a; a = b; b = t; }
        else if (!a && b && d.people[b].sex === 'm') { a = b; b = null; }
        if (a) L.push('1 HUSB ' + idx[a]);
        if (b) L.push('1 WIFE ' + idx[b]);
        if (f.type === 'married' || f.type === 'divorced') { L.push('1 MARR'); if (f.start) L.push('2 DATE ' + gedDate(f.start)); }
        if (f.type === 'divorced') { L.push('1 DIV'); if (f.end) L.push('2 DATE ' + gedDate(f.end)); }
        if (f.type === 'partner') { L.push('1 EVEN'); L.push('2 TYPE Партнери'); if (f.start) L.push('2 DATE ' + gedDate(f.start)); }
        // how the child is related to each parent, as Family Tree Maker and others write it
        f.kids.forEach(function (k) {
          if (!idx[k.id]) return;
          L.push('1 CHIL ' + idx[k.id]);
          var relTo = function (x) { return x === f.a ? k.ra : x === f.b ? k.rb : 'bio'; };
          if (a && relTo(a) !== 'bio') L.push('2 _FREL ' + REL_OUT[relTo(a)]);
          if (b && relTo(b) !== 'bio') L.push('2 _MREL ' + REL_OUT[relTo(b)]);
        });
      });
      L.push('0 TRLR');
      // a line break inside a name or place would start a new GEDCOM record; notes are already split
      return L.map(function (ln) { return ln.replace(/[\r\n]+/g, ' '); }).join('\n') + '\n';
    },
    // Reads people, names, sex, birth/death and families. Enough to move a tree in from other tools.
    parse: function (text) {
      var d = { title: 'Родинний архів', rootId: null, meta: { version: 1, revision: 1, sample: false, savedAt: '' }, people: {}, families: [] };
      // each line goes under the last line one level up, so a source's own DATE or CONT under a
      // birth never passes for the birth's
      var recs = [], path = [];
      text.replace(/\r/g, '').split('\n').forEach(function (ln) {
        var m = ln.match(/^\s*(\d+)\s+(@[^@]+@\s+)?(\w+)\s?(.*)$/);
        if (!m) return;
        var lvl = +m[1], node = { ref: m[2] ? m[2].trim() : '', tag: m[3], val: (m[4] || '').replace(/@@/g, '@'), f: [] };
        if (lvl === 0) { recs.push(node); path = [node]; return; }
        if (!path[lvl - 1]) return;
        path[lvl - 1].f.push(node); path[lvl] = node; path.length = lvl + 1;
      });
      // CONT starts a new line, CONC continues the same one
      var long = function (x) { return x.f.reduce(function (t, y) { return y.tag === 'CONT' ? t + '\n' + y.val : y.tag === 'CONC' ? t + y.val : t; }, x.val); };
      var notes = {};
      recs.forEach(function (r) { if (r.tag === 'NOTE' && r.ref) notes[r.ref] = long(r); });
      var head = recs.find(function (r) { return r.tag === 'HEAD'; }), headVal = function (t) { var x = head && head.f.find(function (y) { return y.tag === t; }); return x ? x.val.trim() : ''; };
      if (headVal('_TITL')) d.title = headVal('_TITL');
      var map = {}, n = 0;
      recs.filter(function (r) { return r.tag === 'INDI'; }).forEach(function (r) {
        var id = 'p' + (++n); map[r.ref] = id;
        var birthGiven = '';
        var p = { id: id, given: '', surname: '', birthName: '', sex: 'u', birth: { date: '', place: '' }, death: { date: '', place: '' }, deceased: false, photo: null, photos: [], notes: '', updated: FA.today() };
        r.f.forEach(function (f) {
          var g = function (t) { var x = f.f.find(function (y) { return y.tag === t; }); return x ? x.val : ''; };
          var nm = f.tag === 'NAME' ? f.val.match(/^([^/]*)\/?([^/]*)\/?/) : null;
          if (nm && /^(birth|maiden)$/i.test(g('TYPE').trim())) { if (!p.birthName) p.birthName = (nm[2] || '').trim(); if (!birthGiven) birthGiven = (nm[1] || '').trim(); }
          else if (nm && !p.given && !p.surname) { p.given = (nm[1] || '').trim(); p.surname = (nm[2] || '').trim(); }
          if (f.tag === 'NAME' && g('NICK') && !p.nick) p.nick = g('NICK');
          if (f.tag === 'SEX') p.sex = { M: 'm', F: 'f' }[f.val.trim()] || 'u';
          if (f.tag === 'BIRT') p.birth = { date: fromGed(g('DATE')), place: g('PLAC') };
          if (f.tag === 'DEAT') { p.deceased = true; p.death = { date: fromGed(g('DATE')), place: g('PLAC') }; }
          // a note written out here or kept as its own record (1 NOTE @N1@); several are kept, one after another
          // a photo linked as a file next to the tree (photos/…); web links and absolute paths are skipped
          if (f.tag === 'OBJE') {
            var file = g('FILE').trim();
            if (file && !/^([a-z]+:|\/|\\)/i.test(file)) {
              var phid = 'ph-' + id + '-' + (p.photos.length + 1);
              p.photos.push({ id: phid, src: file, caption: g('TITL') });
              var posi = g('_POSI').trim().split(/\s+/);
              if (posi.length >= 2) { p.photos[p.photos.length - 1].pos = posi[0] + ' ' + posi[1]; if (posi[2]) p.photos[p.photos.length - 1].zoom = parseFloat(posi[2]); }
              if (/^y/i.test(g('_PRIM'))) p.photo = file;
            }
          }
          if (f.tag === 'NOTE') { var nt = /^@[^@]+@$/.test(f.val.trim()) ? notes[f.val.trim()] || '' : long(f); if (nt) p.notes = p.notes ? p.notes + '\n\n' + nt : nt; }
        });
        // only a birth name: that is the name
        if (!p.given && !p.surname) { p.given = birthGiven; p.surname = p.birthName; }
        // from other programs, the first photo is the portrait; this one marks it with _PRIM
        if (!p.photo && p.photos.length && headVal('SOUR') !== 'FamilyArchive') p.photo = p.photos[0].src;
        d.people[id] = p;
      });
      var fn = 0;
      recs.filter(function (r) { return r.tag === 'FAM'; }).forEach(function (r) {
        var get = function (t) { var x = r.f.find(function (y) { return y.tag === t; }); return x ? map[x.val.trim()] : null; };
        var a = get('HUSB'), b = get('WIFE');
        if (!a) { a = b; b = null; }
        if (!a) return;
        var marr = r.f.find(function (y) { return y.tag === 'MARR'; }), div = r.f.find(function (y) { return y.tag === 'DIV'; });
        // a couple's start date written by this app (EVEN · TYPE Партнери); other EVENs (engagement…) aren't it
        var even = b && r.f.find(function (y) { var t = y.f.find(function (z) { return z.tag === 'TYPE'; }); return y.tag === 'EVEN' && (!t || /^партнер/i.test(t.val.trim())) && y.f.some(function (z) { return z.tag === 'DATE'; }); });
        var dt = function (x) { var q = x && x.f.find(function (y) { return y.tag === 'DATE'; }); return q ? fromGed(q.val) : ''; };
        // _FREL is the tie to the husband, _MREL to the wife; a is the husband when there is one
        var hasH = !!get('HUSB');
        var rel = function (c, t) { var x = c.f.find(function (y) { return y.tag === t; }), v = x ? x.val.trim().toLowerCase() : ''; return /^adopt/.test(v) ? 'adopted' : /^step/.test(v) ? 'step' : /^foster/.test(v) ? 'foster' : 'bio'; };
        d.families.push({
          id: 'f' + (++fn), a: a, b: b, type: div ? 'divorced' : (marr ? 'married' : (b ? 'partner' : 'none')), start: marr ? dt(marr) : dt(even), end: dt(div),
          kids: r.f.filter(function (y) { return y.tag === 'CHIL' && map[y.val.trim()]; }).map(function (y) {
            return { id: map[y.val.trim()], ra: rel(y, hasH ? '_FREL' : '_MREL'), rb: b ? rel(y, '_MREL') : 'bio' };
          })
        });
      });
      d.rootId = map[headVal('_HOME')] || Object.keys(d.people)[0] || null;
      return d;
    }
  };

  // Closing the tab within a second of an edit: write it now rather than lose it. Leaving while a
  // write is still running asks first.
  window.addEventListener('pagehide', function () { if (timers.idb || timers.save) Storage.flush(); });
  window.addEventListener('beforeunload', function (e) {
    var folderWrite = (!!timers.save || S.saving) && S.mode === 'folder' && S.perm === 'granted' && !S.conflict && !S.saveError && !S.readOnly;
    // the browser won't keep anything: unsaved edits would be gone
    var lost = S.mode === 'browser' && !S.idbOk && S.pending > 0 && !S.readOnly;
    if (timers.idb || timers.save) Storage.flush();
    if (folderWrite || lost) { e.preventDefault(); e.returnValue = ''; }
  });

  FA.Storage = Storage;
})();
