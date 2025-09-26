/**
 * generate-index.js (single-run)
 * - Reads .env (in same dir)
 * - Scans ZORAXY_DIR and writes index.html with cards and "Unlock admin" button
 * - Intended to be run by systemd timer every N seconds (installer sets timer)
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const WEBROOT = process.env.ZORAXY_DIR;
const ADMIN_LOGIN = (process.env.FRONTEND_ADMIN_URL || '/admin').replace(/\/+$/,'') + '/login';

if (!WEBROOT) {
  console.error('ZORAXY_DIR not set in .env - aborting.');
  process.exit(1);
}

function listDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
      .sort((a,b)=>a.localeCompare(b));
  } catch (err) {
    console.error('listDirs error', err && err.message);
    return [];
  }
}

function buildHtml(dirs) {
  const cards = dirs.map(d => `<a class="card" href="./${encodeURIComponent(d)}/"><div class="title">${d}/</div><div class="meta">./${d}/</div></a>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Zoraxy — Index</title>
<style>
  body{font-family:Inter,system-ui,Arial;margin:28px;color:#0b1220;background:#f6fbff}
  h1{margin:0}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:18px}
  .card{display:block;padding:12px;background:#fff;border-radius:10px;text-decoration:none;color:inherit;border:1px solid rgba(0,0,0,0.06);box-shadow:0 6px 18px rgba(12,12,20,0.04)}
  .title{font-weight:600}
  .admin-btn{margin-top:18px;padding:10px 14px;border-radius:8px;background:linear-gradient(90deg,#7c3aed,#06b6d4);color:white;border:none;cursor:pointer}
  .small{color:#556;font-size:.95rem}
</style>
</head>
<body>
  <h1>Available Pages</h1>
  <div class="small">Auto-generated index — lists folders in the webroot</div>

  <div class="grid">${cards}</div>

  <div>
    <button class="admin-btn" id="unlockAdmin">Unlock admin panel</button>
    <div id="msg" class="small"></div>
  </div>

<script>
const ADMIN_LOGIN = ${JSON.stringify(ADMIN_LOGIN)};
// Clicking button opens password prompt and posts to /admin/login (proxied by Zoraxy)
document.getElementById('unlockAdmin').addEventListener('click', async () => {
  const pw = prompt('Enter admin password:');
  if (!pw) return;
  try {
    const res = await fetch(ADMIN_LOGIN, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (!res.ok) { document.getElementById('msg').textContent = 'Wrong password or admin unavailable'; return; }
    const html = await res.text();
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  } catch (err) {
    document.getElementById('msg').textContent = 'Error contacting admin backend';
  }
});
</script>
</body>
</html>`;
}

const dirs = listDirs(WEBROOT);
const html = buildHtml(dirs);
fs.writeFileSync(path.join(WEBROOT,'index.html'), html, 'utf8');
console.log(`[generate] wrote index.html with ${dirs.length} entries to ${WEBROOT}`);