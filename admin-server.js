/**
 * admin-server.js
 * Zoraxy WebManager admin backend (CommonJS)
 *
 * Endpoints (all under /admin prefix):
 *  - POST /admin/login         -> accepts { password } and returns admin.html (HTML served only after successful password)
 *  - POST /admin/clone         -> body { repoUrl, target }  [requires header x-admin-password]
 *  - POST /admin/upload        -> multipart form 'archive' file, optional 'target'  [requires header x-admin-password]
 *  - POST /admin/pull          -> triggers pullAllRepos()  [requires header x-admin-password]
 *  - GET  /admin/files?path=.. -> list directory entries  [requires header x-admin-password]
 *  - GET  /admin/file?path=..  -> read file content  [requires header x-admin-password]
 *  - POST /admin/file          -> JSON { path, content } write file  [requires header x-admin-password]
 *  - POST /admin/file/delete   -> JSON { path } delete file/dir  [requires header x-admin-password]
 *
 * Security:
 *  - The login endpoint returns admin HTML only if the correct password is POSTed.
 *  - All other endpoints require header 'x-admin-password'.
 *  - Server listens on 127.0.0.1; proxy /admin/ to it in Zoraxy/nginx.
 */

const express = require('express');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const multer = require('multer');
const unzipper = require('unzipper');
const simpleGit = require('simple-git');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const WEBROOT = process.env.ZORAXY_DIR || path.join(__dirname, 'html');
const FRONTEND_ADMIN_URL = (process.env.FRONTEND_ADMIN_URL || '/admin').replace(/\/+$/, '');

const HOST = '127.0.0.1';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

console.log(`[startup] admin-server starting. WEBROOT=${WEBROOT} PORT=${ADMIN_PORT}`);

// ----- helpers -----
function requirePassword(req, res, next) {
  const pass = req.header('x-admin-password') || (req.body && req.body.password);
  if (!pass || pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'unauthorized' });
  }
  next();
}

function safeJoin(base, p) {
  const normalizedBase = path.resolve(base);
  const target = path.resolve(normalizedBase, '.' + path.sep + (p || ''));
  if (!target.startsWith(normalizedBase)) throw new Error('invalid path');
  return target;
}

// ----- login: returns admin UI HTML (only on success) -----
app.post(`${FRONTEND_ADMIN_URL}/login`, (req, res) => {
  const password = req.body && req.body.password;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'invalid password' });
  }

  // read admin.html template and inject the password and FRONTEND_ADMIN_URL into the page
  const adminTemplatePath = path.join(__dirname, 'admin.html');
  if (!fs.existsSync(adminTemplatePath)) {
    return res.status(500).json({ ok: false, message: 'admin UI not found' });
  }

  let html = fs.readFileSync(adminTemplatePath, 'utf8');
  // inject constants in a safe way
  html = html.replace(/%%ADMIN_PASSWORD%%/g, JSON.stringify(password));
  html = html.replace(/%%FRONTEND_ADMIN_URL%%/g, JSON.stringify(FRONTEND_ADMIN_URL));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ----- clone a repo into webroot -----
app.post(`${FRONTEND_ADMIN_URL}/clone`, requirePassword, async (req, res) => {
  try {
    const { repoUrl, target } = req.body || {};
    if (!repoUrl) return res.status(400).json({ ok: false, message: 'repoUrl required' });

    const parsed = path.basename(repoUrl).replace(/\.git$/, '').replace(/[^\w\-\.]/g, '-');
    const destName = target && target.trim() ? target.trim().replace(/[^\w\-\.]/g, '-') : parsed;
    const dest = path.join(WEBROOT, destName);

    if (fs.existsSync(dest)) {
      return res.status(409).json({ ok: false, message: 'target already exists' });
    }

    await simpleGit().clone(repoUrl, dest);
    console.log(`[clone] ${repoUrl} -> ${dest}`);
    return res.json({ ok: true, message: 'cloned', dest: destName });
  } catch (err) {
    console.error('[clone] error', err && err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ----- upload zip and extract into webroot -----
const upload = multer({ dest: '/tmp' });
app.post(`${FRONTEND_ADMIN_URL}/upload`, requirePassword, upload.single('archive'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'archive required' });
    const file = req.file;
    const target = (req.body.target || path.parse(file.originalname).name).replace(/[^\w\-\.]/g, '-');
    const dest = path.join(WEBROOT, target);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    await new Promise((resolve, reject) => {
      fs.createReadStream(file.path)
        .pipe(unzipper.Extract({ path: dest }))
        .on('close', resolve)
        .on('error', reject);
    });
    fs.unlinkSync(file.path);
    console.log(`[upload] extracted archive -> ${dest}`);
    return res.json({ ok: true, message: 'uploaded & extracted', dest: target });
  } catch (err) {
    console.error('[upload] error', err && err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ----- manual pull all repos -----
app.post(`${FRONTEND_ADMIN_URL}/pull`, requirePassword, async (req, res) => {
  try {
    await pullAllRepos();
    return res.json({ ok: true, message: 'pull started' });
  } catch (err) {
    console.error('[pull] error', err && err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ----- file explorer & editor -----
app.get(`${FRONTEND_ADMIN_URL}/files`, requirePassword, (req, res) => {
  try {
    const p = req.query.path || '/';
    const abs = safeJoin(WEBROOT, p);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map(d => ({ name: d.name, isDir: d.isDirectory() }));
    res.json({ ok: true, path: p, entries });
  } catch (err) {
    console.error('[files] err', err && err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get(`${FRONTEND_ADMIN_URL}/file`, requirePassword, (req, res) => {
  try {
    const p = req.query.path;
    if (!p) return res.status(400).json({ ok: false, message: 'path required' });
    const abs = safeJoin(WEBROOT, p);
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, message: 'not found' });
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ ok: true, content });
  } catch (err) {
    console.error('[file-read] err', err && err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post(`${FRONTEND_ADMIN_URL}/file`, requirePassword, (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    if (!p) return res.status(400).json({ ok: false, message: 'path required' });
    const abs = safeJoin(WEBROOT, p);
    fs.writeFileSync(abs, content, 'utf8');
    console.log(`[file-write] saved ${abs}`);
    res.json({ ok: true, message: 'saved' });
  } catch (err) {
    console.error('[file-write] err', err && err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.post(`${FRONTEND_ADMIN_URL}/file/delete`, requirePassword, (req, res) => {
  try {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ ok: false, message: 'path required' });
    const abs = safeJoin(WEBROOT, p);
    fse.removeSync(abs);
    console.log(`[file-delete] removed ${abs}`);
    res.json({ ok: true, message: 'deleted' });
  } catch (err) {
    console.error('[file-delete] err', err && err.message);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ----- auto-pull logic -----
async function pullAllRepos() {
  try {
    console.log('[autopull] scanning', WEBROOT);
    const entries = fs.readdirSync(WEBROOT, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const e of entries) {
      const repoPath = path.join(WEBROOT, e.name);
      if (fs.existsSync(path.join(repoPath, '.git'))) {
        console.log('[autopull] pulling', e.name);
        try { await simpleGit(repoPath).pull(); console.log('[autopull] pulled', e.name); } catch (err) { console.error('[autopull] failed', e.name, err && err.message); }
      }
    }
  } catch (err) {
    console.error('[autopull] error', err && err.message);
  }
}

// run on start and schedule every 10 minutes
pullAllRepos();
setInterval(pullAllRepos, 10 * 60 * 1000);

// ----- start server -----
app.listen(ADMIN_PORT, HOST, () => {
  console.log(`Zoraxy admin-server listening on http://${HOST}:${ADMIN_PORT}  WEBROOT=${WEBROOT}`);
});