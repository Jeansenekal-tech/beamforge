// BeamForge launcher. This file stays inside the app bundle and never changes.
// It starts the newest correctly-installed update (from the user's Application Support folder)
// or, if there is none or an update failed to start, the version that came with the installer.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const bundledDir = __dirname;
const bundledVersion = require('./package.json').version;
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

const updRoot = path.join(app.getPath('userData'), 'updates');
const ptrFile = path.join(updRoot, 'current.json');
const readPtr = () => { try { return JSON.parse(fs.readFileSync(ptrFile, 'utf8')); } catch { return null; } };
const writePtr = (p) => { try { fs.mkdirSync(updRoot, { recursive: true }); fs.writeFileSync(ptrFile, JSON.stringify(p, null, 1)); } catch { } };

const boot = {
  appDir: bundledDir, version: bundledVersion, bundledVersion, source: 'bundled', updRoot, rolledBack: null, cmp,
  markReady() { const p = readPtr(); if (p && boot.source === 'update' && !boot.fallback && p.version === boot.version && p.status !== 'ok') { p.status = 'ok'; writePtr(p); } },
  markFailed() { const p = readPtr(); if (!p) return; if (p.version === boot.version) p.status = 'failed'; else if (p.prev === boot.version) p.prev = null; writePtr(p); },
};

const ptr = readPtr();
const valid = (v) => v && cmp(v, bundledVersion) > 0 && ['core.js', 'updater.js', 'preload.js', 'index.html'].every(f => fs.existsSync(path.join(updRoot, v, f)));
if (ptr && cmp(ptr.version, bundledVersion) > 0) {
  if (ptr.status === 'pending' || ptr.status === 'failed' || !valid(ptr.version)) {
    // the last start of this update never finished loading -> go back to the last version that worked
    if (ptr.status !== 'failed') { boot.rolledBack = ptr.version; ptr.status = 'failed'; writePtr(ptr); }
    if (valid(ptr.prev)) Object.assign(boot, { appDir: path.join(updRoot, ptr.prev), version: ptr.prev, source: 'update', fallback: true });
  } else {
    ptr.status = 'pending'; writePtr(ptr);
    Object.assign(boot, { appDir: path.join(updRoot, ptr.version), version: ptr.version, source: 'update' });
  }
}
global.BF_BOOT = boot;
try {
  require(path.join(boot.appDir, 'core.js'));
} catch (e) {
  if (boot.source !== 'update') throw e;
  // the update crashed while starting: mark it bad and restart on the installed version
  console.error('Update failed to start, rolling back:', e);
  boot.markFailed();
  app.relaunch(); app.exit(0);
}
