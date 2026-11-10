// Builds the published site: node scripts/build-site.js <outDir> <version>
// Copies only the app and the sample family (never data/), stamps the version, adds ?v=<version>
// to every script and stylesheet so a reload can't mix old and new files (GitHub Pages lets
// browsers cache them for 10 minutes), and adds a Content Security Policy: the page may load
// nothing but its own files and send nothing anywhere.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const [outArg, version] = process.argv.slice(2);
if (!outArg || !version) { console.error('usage: node scripts/build-site.js <outDir> <version>'); process.exit(1); }
const out = path.resolve(outArg);
// it is emptied first, so never the project itself or a folder that contains it
if (out === root || root.startsWith(out + path.sep)) { console.error('refusing to build into ' + out); process.exit(1); }

const FILES = ['index.html', 'favicon.svg', 'familytree.css', 'app.css', 'boot.js', 'family.js', 'tree-engine.js', 'ui.js', 'storage.js', 'drawer.js', 'views.js', 'app.js'];
const DIRS = ['photos'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
FILES.forEach((f) => fs.copyFileSync(path.join(root, f), path.join(out, f)));
DIRS.forEach((d) => fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true }));

const v = JSON.stringify(version);
fs.writeFileSync(path.join(out, 'version.js'), 'window.APP_VERSION = ' + v + ';\n');
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version: version, builtAt: new Date().toISOString() }) + '\n');
fs.writeFileSync(path.join(out, '.nojekyll'), '');

const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
html = html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^":?#]+\.(?:js|css))(")/g, (m, a, file, b) => a + file + '?v=' + encodeURIComponent(version) + b);
// index.html carries the policy itself (it matters on disk too); older copies get it here
if (!html.includes('Content-Security-Policy')) html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n  <meta name="referrer" content="no-referrer">');
else if (!html.includes('content="' + CSP + '"')) { console.error('index.html has a different Content Security Policy than build-site.js'); process.exit(1); }
if (!html.includes('Content-Security-Policy')) { console.error('could not add the Content Security Policy'); process.exit(1); }
fs.writeFileSync(path.join(out, 'index.html'), html);

console.log('built ' + path.relative(root, out) + ' (' + version + '): ' + fs.readdirSync(out).length + ' entries');
