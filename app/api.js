// BeamForge REST API (main process). Off by default. Requests are forwarded to the app window,
// which does the work and answers. Bound to this Mac only unless "allow network" is switched on,
// in which case an access token is always required.
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let ctx = null, server = null, seq = 0;
const pending = new Map();
const DEFAULTS = { enabled: false, port: 8811, lan: false, token: '', allowJobs: false };
const file = () => path.join(ctx.app.getPath('userData'), 'api-settings.json');
function getSettings() { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { return { ...DEFAULTS }; } }
function saveSettings(s) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(s, null, 1)); }
function addresses(port) {
  const out = [`http://127.0.0.1:${port}/api/v1`];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}/api/v1`);
  return out;
}
function info() { const s = getSettings(); return { ...s, running: !!(server && server.listening), urls: s.enabled ? (s.lan ? addresses(s.port) : addresses(s.port).slice(0, 1)) : [], error: ctx && ctx.lastError || '' }; }

function init(c) { ctx = c; restart(); }
async function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  s.port = Math.max(1024, Math.min(65535, parseInt(s.port, 10) || 8811));
  if (s.lan && !s.token) s.token = crypto.randomBytes(12).toString('hex');
  saveSettings(s); await restart(); return info();
}
function stop() { if (server) { try { server.close(); } catch { } server = null; } }
function restart() {
  stop(); ctx.lastError = '';
  const s = getSettings(); if (!s.enabled) return Promise.resolve();
  return new Promise((done) => {
    const srv = http.createServer((req, res) => handle(req, res, s)); server = srv;
    srv.on('error', (e) => { ctx.lastError = e.code === 'EADDRINUSE' ? `Port ${s.port} is already in use` : e.message; if (server === srv) server = null; done(); });
    srv.listen(s.port, s.lan ? '0.0.0.0' : '127.0.0.1', done);
  });
}
function send(res, status, obj, type = 'application/json') {
  const body = type === 'application/json' ? JSON.stringify(obj, null, 1) : obj;
  res.writeHead(status, { 'Content-Type': type + (type.startsWith('text') || type.endsWith('json') ? '; charset=utf-8' : ''), 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Filename' });
  res.end(body);
}
function handle(req, res, s) {
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  const url = new URL(req.url, 'http://x');
  if (s.token) {
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
    if (auth !== s.token) return send(res, 401, { error: 'Missing or wrong access token' });
  }
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 100 * 1024 * 1024) { req.destroy(); return; } chunks.push(c); });
  req.on('end', () => {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/api' || p === '/api/v1') return send(res, 200, DOCS);
    if (!p.startsWith('/api/v1/')) return send(res, 404, { error: 'Not found — see /api/v1 for the list of endpoints' });
    const w = ctx.getWin(); if (!w || w.isDestroyed()) return send(res, 503, { error: 'BeamForge window is not open' });
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); send(res, 504, { error: 'Timed out waiting for BeamForge' }); }, 60000);
    pending.set(id, { res, t });
    w.webContents.send('api-request', { id, method: req.method, path: p.slice(7), query: Object.fromEntries(url.searchParams), headers: { filename: req.headers['x-filename'] || '', type: req.headers['content-type'] || '' }, body: Buffer.concat(chunks), allowJobs: s.allowJobs });
  });
}
function respond(r) {
  const p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.t);
  if (r.text !== undefined) send(p.res, r.status || 200, r.text, r.type || 'text/plain'); else send(p.res, r.status || 200, r.json || {});
}
const DOCS = {
  name: 'BeamForge REST API', version: 1,
  note: 'This API does not replace supervising the laser. Never leave a running laser unattended.',
  auth: 'If a token is set, send it as "Authorization: Bearer <token>" or ?token=<token>.',
  endpoints: {
    'GET /api/v1/status': 'Machine connection, state, position, running job progress, open project and page',
    'GET /api/v1/project': 'Project name, pages, layers in use with their settings, estimated job time',
    'GET /api/v1/gcode': 'G-code for the current page (text)',
    'POST /api/v1/import?name=file.svg': 'Import a file (body = raw file bytes) into the current page. SVG, DXF, PNG, JPG, STL, 3MF… ',
    'POST /api/v1/project/open?name=x.bfproj': 'Open a BeamForge project (body = file contents)',
    'POST /api/v1/project/new': 'Start a new empty project',
    'POST /api/v1/page?index=N': 'Switch to page N (0-based)',
    'POST /api/v1/job/start': 'Start the job for the current page (needs "Allow starting jobs" in BeamForge)',
    'POST /api/v1/job/pause': 'Pause the running job',
    'POST /api/v1/job/resume': 'Resume a paused job',
    'POST /api/v1/job/stop': 'Stop the running job',
    'POST /api/v1/frame': 'Trace the job outline with the laser off (needs "Allow starting jobs")',
    'POST /api/v1/command': 'Send one G-code / GRBL command, body {"command":"$H"} (needs "Allow starting jobs")',
  },
};
module.exports = { init, info, setSettings, respond, stop };
