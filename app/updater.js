// BeamForge updater: checks an update feed, downloads + verifies + installs new versions,
// and installs .bfupdate files the user opens. Updates are stored in Application Support,
// never inside the signed app bundle, and only take effect after a restart.
const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let ctx = null, timer = null, busy = false, staged = null;
const settingsFile = () => path.join(ctx.app.getPath('userData'), 'update-settings.json');
// official feed: the BeamForge GitHub repo (used whenever no other address has been entered)
const FEED = 'https://raw.githubusercontent.com/Jeansenekal-tech/beamforge/main/updates/latest.json';
const DEFAULTS = { url: FEED, auto: true, lastCheck: 0, lastResult: '' };
function getSettings() { let s; try { s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { s = { ...DEFAULTS }; } if (!s.url) s.url = FEED; return s; }
function setSettings(s) {
  const cur = { ...getSettings(), ...s }; cur.url = String(cur.url || '').trim();
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(cur, null, 1));
  schedule(); return cur;
}
const emit = (ev) => { const w = ctx && ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send('update-event', ev); };
const running = () => ctx.BOOT.version;
const newest = () => { const v = staged || running(); return v; };

function init(c) {
  ctx = c; schedule();
  setTimeout(() => { if (getSettings().auto && getSettings().url) check({ manual: false }); }, 8000);
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(() => { const s = getSettings(); if (s.auto && s.url) check({ manual: false }); }, 6 * 3600 * 1000);
}

// ---- package install -------------------------------------------------------
// .bfupdate = JSON { app:'BeamForge', version, notes, minElectron, files: { 'path': base64 } }
async function installPackage(buf, { manual = false, expectSha = null } = {}) {
  const cmp = ctx.BOOT.cmp;
  try {
    if (expectSha) {
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (got !== expectSha) throw new Error('Download was corrupted (checksum mismatch) — try again');
    }
    let pkg; try { pkg = JSON.parse(buf.toString('utf8')); } catch { throw new Error('Not a BeamForge update file'); }
    if (pkg.app !== 'BeamForge' || !pkg.version || !pkg.files) throw new Error('Not a BeamForge update file');
    if (cmp(pkg.version, newest()) <= 0) {
      const msg = `Version ${pkg.version} is not newer than ${newest()} — nothing to install`;
      if (manual) emit({ type: 'info', message: msg }); return { ok: false, message: msg };
    }
    const major = parseInt(process.versions.electron, 10);
    if (pkg.minElectron && major < pkg.minElectron) throw new Error(`Version ${pkg.version} needs a newer runtime — please run the full installer once`);
    for (const f of ['core.js', 'updater.js', 'preload.js', 'index.html']) if (!pkg.files[f]) throw new Error('Update file is incomplete (' + f + ')');
    const root = ctx.BOOT.updRoot, dir = path.join(root, pkg.version), tmp = dir + '.tmp-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [rel, b64] of Object.entries(pkg.files)) {
      const norm = path.normalize(rel);
      if (norm.startsWith('..') || path.isAbsolute(norm)) throw new Error('Bad path in update: ' + rel);
      const out = path.join(tmp, norm); fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    }
    // syntax-check the main-process files before accepting the update
    for (const f of ['core.js', 'updater.js', 'preload.js', 'api.js'].filter(f => pkg.files[f])) { try { new (require('vm').Script)(fs.readFileSync(path.join(tmp, f), 'utf8'), { filename: f }); } catch (e) { throw new Error(`Update ${pkg.version} is damaged (${f}: ${e.message})`); } }
    fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(tmp, dir);
    const prev = ctx.BOOT.source === 'update' ? running() : null;
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version: pkg.version, status: 'ready', prev, installed: new Date().toISOString(), notes: pkg.notes || '' }, null, 1));
    // keep only the running version and the new one
    for (const d of fs.readdirSync(root)) { if (d === 'current.json' || d === pkg.version || d === running()) continue; try { fs.rmSync(path.join(root, d), { recursive: true, force: true }); } catch { } }
    staged = pkg.version;
    emit({ type: 'ready', version: pkg.version, notes: pkg.notes || '' });
    return { ok: true, version: pkg.version };
  } catch (e) {
    emit({ type: 'error', message: e.message, manual }); return { ok: false, message: e.message };
  }
}

// ---- online check ----------------------------------------------------------
// feed URL points at latest.json: { version, notes, package: 'BeamForge-x.y.z.bfupdate' (relative or absolute URL), sha256, size }
async function check({ manual = false } = {}) {
  const s = getSettings();
  if (!s.url) { const m = 'No update address set — add it in Check for Updates.'; if (manual) emit({ type: 'info', message: m }); return { ok: false, message: m }; }
  if (busy) return { ok: false, message: 'Already checking' };
  busy = true;
  try {
    if (manual) emit({ type: 'checking' });
    const bust = (u) => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();
    const r = await net.fetch(bust(s.url), { cache: 'no-store' });
    if (!r.ok) throw new Error(`Update server replied ${r.status}`);
    const man = await r.json();
    if (!man.version || !man.package) throw new Error('Update feed is not valid');
    setSettings({ lastCheck: Date.now(), lastResult: `Latest: ${man.version}` });
    let ptr = null; try { ptr = JSON.parse(fs.readFileSync(path.join(ctx.BOOT.updRoot, 'current.json'), 'utf8')); } catch { }
    if (!manual && ptr && ptr.status === 'failed' && ptr.version === man.version) return { ok: true, skipped: man.version }; // don't keep re-installing a version that failed
    if (ctx.BOOT.cmp(man.version, newest()) <= 0) { if (manual) emit({ type: 'none', version: newest() }); return { ok: true, upToDate: true, version: man.version }; }
    emit({ type: 'downloading', version: man.version });
    const pkgUrl = new URL(man.package, s.url).toString();
    const pr = await net.fetch(bust(pkgUrl), { cache: 'no-store' });
    if (!pr.ok) throw new Error(`Download failed (${pr.status})`);
    const buf = Buffer.from(await pr.arrayBuffer());
    return await installPackage(buf, { manual, expectSha: man.sha256 || null });
  } catch (e) {
    const msg = /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION|ADDRESS|TIMED_OUT|NETWORK)/.test(e.message) ? "Can't reach the update server (check the internet connection or the update address)" : e.message;
    setSettings({ lastCheck: Date.now(), lastResult: 'Error: ' + msg });
    emit({ type: 'error', message: msg, manual }); return { ok: false, message: msg };
  } finally { busy = false; }
}
module.exports = { init, check, installPackage, getSettings, setSettings };
