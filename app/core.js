// BeamForge — main process core (updatable; loaded by the launcher in main.js)
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const BOOT = global.BF_BOOT || { appDir: __dirname, version: app.getVersion(), bundledVersion: app.getVersion(), source: 'bundled', markReady() { }, rolledBack: null };
const APP_DIR = BOOT.appDir;
const updater = require('./updater.js');
const api = require('./api.js');

let win = null, pendingSerial = null, lastPorts = [], rendererReady = false;
const pendingOpen = [];
const isMac = process.platform === 'darwin';

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640, backgroundColor: '#1d1f23', show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default', title: 'BeamForge',
    webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.once('ready-to-show', () => win.show());
  const ses = win.webContents.session;

  // ---- Web Serial: let the renderer pick a port from our own dialog
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    pendingSerial = callback; lastPorts = portList;
    webContents.send('serial-ports', portList);
  });
  ses.on('serial-port-added', (e, port) => { if (pendingSerial) { lastPorts = [...lastPorts.filter(p => p.portId !== port.portId), port]; win.webContents.send('serial-ports', lastPorts); } });
  ses.on('serial-port-removed', (e, port) => { if (pendingSerial) { lastPorts = lastPorts.filter(p => p.portId !== port.portId); win.webContents.send('serial-ports', lastPorts); } });
  ses.setPermissionCheckHandler((wc, permission) => ['serial', 'local-fonts', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media'].includes(permission));
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(['serial', 'local-fonts', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media'].includes(permission)));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(APP_DIR, 'index.html'));
  // if an updated version never reports that it started properly, fall back to the installed version
  if (BOOT.source === 'update') setTimeout(() => { if (!rendererReady) { BOOT.markFailed(); app.relaunch(); app.exit(0); } }, 25000);
  win.webContents.on('did-finish-load', () => { while (pendingOpen.length) sendOpenFile(pendingOpen.shift()); });
  win.on('closed', () => { win = null; });
}

ipcMain.on('serial-chosen', (e, id) => { if (pendingSerial) { pendingSerial(id || ''); pendingSerial = null; } });
ipcMain.handle('save-file', async (e, { defaultPath, filters, data, path: p }) => {
  let target = p;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath, filters });
    if (r.canceled || !r.filePath) return null; target = r.filePath;
  }
  fs.writeFileSync(target, data);
  app.addRecentDocument(target);
  return target;
});
ipcMain.handle('open-file', async (e, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [...filters, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0]; app.addRecentDocument(p);
  return { path: p, name: path.basename(p), data: fs.readFileSync(p) };
});
ipcMain.on('app-ready', () => {
  if (rendererReady) return; rendererReady = true; BOOT.markReady();
  if (BOOT.rolledBack) win?.webContents.send('update-event', { type: 'rolledback', version: BOOT.rolledBack });
  updater.init({ app, getWin: () => win, BOOT });
  try { api.init({ app, getWin: () => win }); } catch (e) { console.error('API failed to start', e); }
});
ipcMain.handle('app-info', () => ({ version: BOOT.version, bundledVersion: BOOT.bundledVersion, source: BOOT.source, electron: process.versions.electron, ...updater.getSettings() }));
ipcMain.handle('update-check', (e, opts) => updater.check({ manual: true, ...(opts || {}) }));
ipcMain.handle('update-install-data', (e, data) => updater.installPackage(Buffer.from(data), { manual: true }));
ipcMain.handle('update-settings', (e, s) => updater.setSettings(s));
ipcMain.handle('api-info', () => api.info());
// online vector library: fetch only from the free Iconify icon service (and its official mirrors)
const LIB_HOSTS = ['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com'];
ipcMain.handle('lib-fetch', async (e, url) => {
  const u = new URL(url); if (u.protocol !== 'https:' || !LIB_HOSTS.includes(u.hostname)) throw new Error('Host not allowed');
  const { net } = require('electron');
  const r = await net.fetch(u.toString()); if (!r.ok) throw new Error('Server replied ' + r.status);
  return await r.text();
});
ipcMain.handle('api-settings', (e, s) => api.setSettings(s));
ipcMain.on('api-response', (e, r) => api.respond(r));
ipcMain.on('update-restart', () => { app.relaunch(); app.exit(0); });
ipcMain.on('notify', (e, { title, body }) => { try { if (!win?.isFocused()) new Notification({ title, body }).show(); } catch { } });

function sendOpenFile(p) {
  try { win.webContents.send('open-file', { path: p, name: path.basename(p), data: fs.readFileSync(p) }); } catch { }
}
app.on('open-file', (e, p) => { e.preventDefault(); if (win && !win.webContents.isLoading()) sendOpenFile(p); else pendingOpen.push(p); });

const send = (cmd) => () => win && win.webContents.send('menu', cmd);
function buildMenu() {
  const t = [
    ...(isMac ? [{ label: 'BeamForge', submenu: [{ role: 'about' }, { label: 'Check for Updates…', click: send('updates') }, { type: 'separator' }, { label: 'Remote API…', click: send('apiSettings') }, { label: 'Device Settings…', accelerator: 'Cmd+,', click: send('device') }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File', submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: send('save-as') },
        { type: 'separator' },
        { label: 'Import…', accelerator: 'CmdOrCtrl+I', click: send('import') },
        { label: 'Save G-code…', accelerator: 'CmdOrCtrl+E', click: send('exportGcode') },
        { label: 'Run G-code File…', click: send('sendGcodeFile') },
        { type: 'separator' },
        { label: 'Install Update File…', click: send('installUpdateFile') },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'Device Settings…', click: send('device') }, { label: 'Check for Updates…', click: send('updates') }, { role: 'quit' }])
      ]
    },
    {
      label: 'Edit', submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: send('cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: send('copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: send('paste') },
        { label: 'Paste in Place', accelerator: 'Alt+CmdOrCtrl+V', click: send('pasteInPlace') },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('selectAll') },
        { type: 'separator' },
        { label: 'Group', accelerator: 'CmdOrCtrl+G', click: send('group') },
        { label: 'Ungroup', accelerator: 'Shift+CmdOrCtrl+G', click: send('ungroup') },
      ]
    },
    {
      label: 'Arrange', submenu: [
        { label: 'Mirror Horizontally', click: send('mirrorH') }, { label: 'Mirror Vertically', click: send('mirrorV') },
        { label: 'Rotate 90° Right', accelerator: 'CmdOrCtrl+]', click: send('rotCW') }, { label: 'Rotate 90° Left', accelerator: 'CmdOrCtrl+[', click: send('rotCCW') },
        { type: 'separator' },
        { label: 'Align Left', click: send('alignL') }, { label: 'Align Centres Horizontally', click: send('alignCH') }, { label: 'Align Right', click: send('alignR') },
        { label: 'Align Top', click: send('alignT') }, { label: 'Align Centres Vertically', click: send('alignCV') }, { label: 'Align Bottom', click: send('alignB') },
        { label: 'Distribute Horizontally', click: send('distH') }, { label: 'Distribute Vertically', click: send('distV') },
        { label: 'Move to Centre of Work Area', click: send('centerPage') },
        { type: 'separator' },
        { label: 'Nest Parts…', accelerator: 'Alt+CmdOrCtrl+N', click: send('nest') },
        { label: 'Auto-Arrange (Optimise)', accelerator: 'Shift+Alt+CmdOrCtrl+N', click: send('autoArrange') },
      ]
    },
    {
      label: 'Tools', submenu: [
        { label: 'Box Builder…', accelerator: 'Alt+CmdOrCtrl+B', click: send('boxBuilder') },
        { label: 'Material Test Grid…', click: send('testGrid') },
        { label: 'Asset Tags & Labels…', click: send('tags') },
        { label: 'AV Panel Maker…', click: send('avPanel') },
        { label: 'Engraving Jig Maker…', accelerator: 'Alt+CmdOrCtrl+J', click: send('jig') },
        { label: 'Vector Library…', accelerator: 'Alt+CmdOrCtrl+L', click: send('vectorLib') },
        { type: 'separator' },
        { label: 'Weld / Union', click: send('weld') },
        { label: 'Subtract', click: send('subtract') }, { label: 'Intersect', click: send('intersect') },
        { label: 'Offset Shapes…', accelerator: 'Alt+CmdOrCtrl+O', click: send('offset') },
        { label: 'Grid Array…', accelerator: 'Alt+CmdOrCtrl+A', click: send('array') },
        { label: 'Trace Image…', accelerator: 'Alt+CmdOrCtrl+T', click: send('trace') },
        { label: 'Close / Join Paths…', click: send('closePaths') },
        { label: 'Convert Text to Path', click: send('toPath') },
      ]
    },
    {
      label: 'Laser', submenu: [
        { label: 'Preview…', accelerator: 'Alt+P', click: send('preview') },
        { label: 'Home', click: send('home') }, { label: 'Unlock ($X)', click: send('unlock') }, { label: 'Frame', click: send('frame') },
        { label: 'Set Origin Here', click: send('setOrigin') }, { label: 'Go to Origin', click: send('goOrigin') },
        { type: 'separator' }, { label: 'Rotary Setup…', click: send('rotary') }, { label: 'Camera…', click: send('camera') },
        { type: 'separator' }, { label: 'Vector Troubleshooter…', click: send('troubleshoot') }, { label: 'Remote API…', click: send('apiSettings') },
      ]
    },
    {
      label: 'Page', submenu: [
        { label: 'New Page', accelerator: 'Shift+CmdOrCtrl+N', click: send('pageNew') },
        { label: 'Duplicate Page', click: send('pageDuplicate') },
        { label: 'Rename Page…', click: send('pageRename') },
        { label: 'Delete Page', click: send('pageDelete') },
        { type: 'separator' },
        { label: 'Next Page', accelerator: 'Alt+CmdOrCtrl+Right', click: send('pageNext') },
        { label: 'Previous Page', accelerator: 'Alt+CmdOrCtrl+Left', click: send('pagePrev') },
      ]
    },
    {
      label: 'View', submenu: [
        { label: 'Zoom to Work Area', accelerator: 'CmdOrCtrl+0', click: send('zoomFit') },
        { label: 'Zoom to Selection', accelerator: 'Alt+CmdOrCtrl+0', click: send('zoomSel') },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoomOut') },
        { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'reload' }, { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.whenReady().then(() => {
  app.setAboutPanelOptions?.({ applicationName: 'BeamForge', applicationVersion: BOOT.version, version: BOOT.source === 'update' ? 'updated' : '', copyright: 'Laser design & control for GRBL' });
  buildMenu(); createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
