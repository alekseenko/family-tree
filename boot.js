/* Runs before family.js: remembers why it failed, if it does, for the error screen.
   (A separate file rather than an inline script, so the published site can forbid inline scripts.) */
window.addEventListener('error', function (e) {
  var t = e.target;
  // a <script> that couldn't be loaded at all (capture phase: resource errors don't bubble)
  if (t && t.tagName === 'SCRIPT' && /(^|\/)family\.js(\?|$)/.test(t.src || '')) { window.FAMILY_MISSING = true; return; }
  // family.js loaded but isn't valid JavaScript
  if (!window.FAMILY_DATA && e.message && (!e.filename || /family\.js(\?|$)/.test(e.filename))) window.FAMILY_ERROR = e.message + (e.lineno ? ' — family.js, рядок ' + e.lineno : '');
}, true);
