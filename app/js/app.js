// BeamForge — main application (UI, canvas, tools, documents, job control)
'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NATIVE = window.native || null;
const isMac = (NATIVE && NATIVE.platform === 'darwin') || /Mac/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
if (NATIVE && NATIVE.platform === 'darwin') document.body.classList.add('mac');

const PALETTE = ['#000000', '#0000ff', '#ff0000', '#00c000', '#c8c800', '#ff8000', '#00c8c8', '#ff00ff', '#b4b4b4', '#3060ff', '#a00000', '#00a000', '#a0a000', '#c08000', '#00a0ff', '#a000a0', '#808080', '#7d87b9', '#bb7784', '#4a6fe3', '#d33f6a', '#8cd78c', '#f0b98d', '#f6c4e1', '#fa9ed4', '#7a30b8', '#b45a00', '#00788c', '#86fa88', '#ffdb66'];
const dispColor = (i) => i === 0 ? '#e6e6e6' : PALETTE[i];
const pad2 = (n) => String(n).padStart(2, '0');
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return h ? `${h}:${pad2(m)}:${pad2(ss)}` : `${m}:${pad2(ss)}`; };
const n2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

const defaultLayer = (i) => ({ name: 'C' + pad2(i), mode: 'line', speed: 1000, minPower: 0, maxPower: 50, passes: 1, zStep: 0, interval: 0.1, angle: 0, crosshatch: false, bidir: true, overscan: 2, air: false, output: true, show: true, constant: false, imageMode: 'jarvis', halftoneCell: 6, halftoneAngle: 45 });
const newDoc = () => { const objects = []; return { objects, layers: PALETTE.map((c, i) => defaultLayer(i)), layerOrder: [], pages: [{ id: uid(), name: 'Page 1', objects }], page: 0 }; };
const syncPages = () => { S.doc.pages[S.doc.page].objects = S.doc.objects; };
const DEVICE_DEFAULTS = { name: 'GRBL Laser', width: 400, height: 400, sMax: 1000, rapid: 3000, baud: 115200, returnHome: true, header: '', footer: '', wheel: 'zoom', frameFeed: 3000, accel: 1500, timeFactor: 1, bufferSize: 0, gcodeExt: 'gcode', hideMsg: true };

const S = {
  doc: newDoc(), sel: new Set(), tool: 'select', view: { z: 2, x: 0, y: 0 }, undo: [], redo: [], clip: null,
  curLayer: 0, selLayer: null, device: { ...DEVICE_DEFAULTS, ...JSON.parse(localStorage.getItem('bf.device') || '{}') },
  drag: null, line: null, measure: null, mouse: [0, 0], space: false, filePath: null, fileName: 'Untitled', dirty: false,
  selAnchor: 'bl', jobAnchor: 'bl', lock: true, status: null, job: null
};
if (!S.device.wheelV2) { S.device.wheel = 'zoom'; S.device.wheelV2 = true; try { localStorage.setItem('bf.device', JSON.stringify(S.device)); } catch (e) { } }
const grbl = new Grbl();
function applyBuffer() { grbl.RX_SIZE = S.device.bufferSize > 0 ? S.device.bufferSize : (grbl.reportedRx || 127); }
const imgCache = new Map();
const cv = $('#cv'), ctx = cv.getContext('2d');
let dpr = window.devicePixelRatio || 1;

// ---------------------------------------------------------------- utilities
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3500);
}
function modal({ title, body, buttons = [{ label: 'OK', cls: 'primary' }], width, onClose }) {
  const M = $('#modal'); M.classList.remove('hidden');
  $('.title', M).textContent = title;
  const B = $('.body', M); B.innerHTML = ''; if (typeof body === 'string') B.innerHTML = body; else B.appendChild(body);
  $('.dlg', M).style.width = width ? width + 'px' : '';
  const F = $('footer', M); F.innerHTML = '';
  const close = () => { M.classList.add('hidden'); B.innerHTML = ''; onClose && onClose(); };
  for (const b of buttons) {
    const el = document.createElement('button'); el.textContent = b.label; if (b.cls) el.className = b.cls;
    el.onclick = async () => { const r = b.onClick ? await b.onClick(B) : true; if (r !== false) close(); };
    F.appendChild(el);
  }
  $('.x', M).onclick = close;
  M._close = close;
  applyIcons(B);
  setTimeout(() => { const f = $('input,select,textarea', B); if (f && !f.dataset.nofocus) f.focus(); }, 30);
  return { body: B, close };
}
const modalOpen = () => !$('#modal').classList.contains('hidden');
function confirmBox(title, text, okLabel = 'OK') {
  return new Promise(res => modal({ title, body: `<p style="max-width:420px;line-height:1.5">${text}</p>`, buttons: [{ label: 'Cancel', onClick: () => res(false) }, { label: okLabel, cls: 'primary', onClick: () => res(true) }], onClose: () => res(false) }));
}
function setMsg(m) { $('#sMsg').textContent = m || ''; }

// ---------------------------------------------------------------- object geometry
function getImage(src) {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.onload = () => { requestRender(); }; im.src = src; imgCache.set(src, im); }
  return im.complete && im.naturalWidth ? im : null;
}
function localPaths(o) { return o.type === 'image' ? [{ pts: [0, 0, o.w, 0, o.w, o.h, 0, o.h], closed: true }] : o.paths; }
function worldPaths(o) {
  const lp = localPaths(o), key = o.m.join(',');
  if (o._wp && o._wpk === key && o._wpl === lp) return o._wp;
  o._wp = G.xformPaths(lp, o.m); o._wpk = key; o._wpl = lp; o._box = G.pathsBox(o._wp);
  return o._wp;
}
function objBox(o) { worldPaths(o); return o._box; }
const selObjs = () => S.doc.objects.filter(o => S.sel.has(o.id));
function boxOf(objs) { let b = G.emptyBox(); objs.forEach(o => b = G.boxUnion(b, objBox(o))); return b; }
const selBox = () => boxOf(selObjs());
function cloneObj(o) {
  const c = {}; for (const k in o) if (k[0] !== '_') c[k] = o[k];
  c.m = o.m.slice(); if (o.adj) c.adj = { ...o.adj }; if (o.textProps) c.textProps = { ...o.textProps };
  return c;
}
function serializeDoc() {
  syncPages();
  return { objects: S.doc.objects.map(cloneObj), layers: JSON.parse(JSON.stringify(S.doc.layers)), layerOrder: S.doc.layerOrder.slice(),
    page: S.doc.page, pages: S.doc.pages.map(p => ({ id: p.id, name: p.name, objects: p === S.doc.pages[S.doc.page] ? null : p.objects.map(cloneObj) })) };
}
function loadDoc(d) {
  const nd = newDoc();
  d.layers?.forEach((L, i) => { if (nd.layers[i]) Object.assign(nd.layers[i], L); });
  const cp = (list) => (list || []).map(o => ({ ...o, m: o.m.slice() }));
  nd.objects = cp(d.objects);
  if (d.pages && d.pages.length) {
    nd.page = clamp(d.page | 0, 0, d.pages.length - 1);
    nd.pages = d.pages.map((p, i) => ({ id: p.id || uid(), name: p.name || `Page ${i + 1}`, objects: i === nd.page ? nd.objects : cp(p.objects) }));
  } else nd.pages[0].objects = nd.objects;
  nd.layerOrder = (d.layerOrder || []).slice();
  S.doc = nd; S.sel.clear(); refreshLayers();
}
function pushUndo() { S.undo.push(serializeDoc()); if (S.undo.length > 80) S.undo.shift(); S.redo = []; markDirty(); }
function markDirty() { S.dirty = true; S.ver = (S.ver || 0) + 1; scheduleAutosave(); updateTitle(); }
function updateTitle() { document.title = `${S.fileName}${S.dirty ? ' •' : ''} — BeamForge`; }
let autosaveT = 0;
function scheduleAutosave() {
  clearTimeout(autosaveT);
  autosaveT = setTimeout(() => { try { localStorage.setItem('bf.autosave', JSON.stringify({ doc: serializeDoc(), name: S.fileName, path: S.filePath })); } catch (e) { /* quota */ } }, 1200);
}
function refreshLayers() {
  const used = new Set(S.doc.objects.map(o => o.layer));
  S.doc.layerOrder = S.doc.layerOrder.filter(l => used.has(l));
  for (const l of [...used].sort((a, b) => a - b)) if (!S.doc.layerOrder.includes(l)) S.doc.layerOrder.push(l);
  if (S.selLayer !== null && !used.has(S.selLayer)) S.selLayer = null;
  if (S.selLayer === null && S.doc.layerOrder.length) S.selLayer = S.doc.layerOrder[0];
}
function commit() { refreshLayers(); renderLayerList(); updateNumbar(); updateShapeTab(); requestRender(); scheduleEstimate(); renderPages(); }
function addObjects(objs, select = true) {
  if (select) S.sel.clear();
  for (const o of objs) { if (!o.id) o.id = uid(); if (o.layer === undefined) o.layer = S.curLayer; S.doc.objects.push(o); if (select) S.sel.add(o.id); }
}
function expandGroups() {
  const gids = new Set(selObjs().map(o => o.groupId).filter(Boolean));
  if (gids.size) S.doc.objects.forEach(o => { if (o.groupId && gids.has(o.groupId)) S.sel.add(o.id); });
}
function transformSel(M, push = true) {
  const objs = selObjs(); if (!objs.length) return;
  if (push) pushUndo();
  objs.forEach(o => o.m = G.mul(M, o.m));
  commit();
}

// ---------------------------------------------------------------- view
const w2s = (x, y) => [x * S.view.z + S.view.x, -y * S.view.z + S.view.y];
const s2w = (sx, sy) => [(sx - S.view.x) / S.view.z, -(sy - S.view.y) / S.view.z];
function resize() {
  const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); requestRender();
}
function zoomToBox(b, margin = 40) {
  const r = cv.getBoundingClientRect(); const w = b.x1 - b.x0 || 10, h = b.y1 - b.y0 || 10;
  const z = Math.min((r.width - margin * 2) / w, (r.height - margin * 2) / h);
  S.view.z = clamp(z, 0.05, 400);
  S.view.x = r.width / 2 - (b.x0 + w / 2) * S.view.z; S.view.y = r.height / 2 + (b.y0 + h / 2) * S.view.z;
  requestRender();
}
const zoomFit = () => zoomToBox({ x0: 0, y0: 0, x1: S.device.width, y1: S.device.height }, 30);
function zoomAt(f, sx, sy) {
  const [wx, wy] = s2w(sx, sy); S.view.z = clamp(S.view.z * f, 0.05, 400);
  S.view.x = sx - wx * S.view.z; S.view.y = sy + wy * S.view.z; requestRender();
}

// ---------------------------------------------------------------- rendering
let renderPending = false;
function requestRender() { if (!renderPending) { renderPending = true; requestAnimationFrame(render); } }
function procCanvas(o) {
  const L = S.doc.layers[o.layer]; const img = getImage(o.img.src); if (!img) return null;
  const ww = o.w * Math.hypot(o.m[0], o.m[1]), wh = o.h * Math.hypot(o.m[2], o.m[3]);
  // limit preview resolution
  let cols = ww / L.interval, rows = wh / L.interval; const k = Math.min(1, 1400 / Math.max(cols, rows)); cols *= k; rows *= k;
  const key = [L.imageMode, Math.round(cols), Math.round(rows), JSON.stringify(o.adj || {}), L.halftoneCell, L.halftoneAngle].join('|');
  if (o._pk === key && o._pc) return o._pc;
  const res = Raster.process(img, cols, rows, o.adj || {}, L.imageMode, { threshold: o.adj?.threshold, halftoneCell: (L.halftoneCell || 6) * k, halftoneAngle: L.halftoneAngle });
  o._pc = Raster.toCanvas(res); o._pk = key; return o._pc;
}
function render() {
  renderPending = false;
  const W = cv.width / dpr, H = cv.height / dpr, z = S.view.z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#15171a'; ctx.fillRect(0, 0, W, H);
  // work area
  const [ax, ay] = w2s(0, S.device.height), aw = S.device.width * z, ah = S.device.height * z;
  ctx.fillStyle = '#1f2226'; ctx.fillRect(ax, ay, aw, ah);
  // grid
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  let st = steps.find(s => s * z >= 9) || 200; const major = st * (st === 2 || st === 20 || st === 200 ? 5 : st === 5 || st === 50 ? 2 : 5);
  ctx.lineWidth = 1;
  const drawGrid = (step, color) => {
    ctx.strokeStyle = color; ctx.beginPath();
    for (let x = 0; x <= S.device.width + 1e-6; x += step) { const sx = Math.round(w2s(x, 0)[0]) + .5; ctx.moveTo(sx, ay); ctx.lineTo(sx, ay + ah); }
    for (let y = 0; y <= S.device.height + 1e-6; y += step) { const sy = Math.round(w2s(0, y)[1]) + .5; ctx.moveTo(ax, sy); ctx.lineTo(ax + aw, sy); }
    ctx.stroke();
  };
  drawGrid(st, '#272b30'); drawGrid(major, '#333840');
  if (typeof renderUnderlays === 'function') renderUnderlays(ctx, w2s, S.view.z);
  ctx.strokeStyle = '#4a5058'; ctx.strokeRect(ax + .5, ay + .5, aw, ah);
  // rulers labels
  ctx.fillStyle = '#7d848d'; ctx.font = '10px Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const lstep = major * (major * z < 50 ? 2 : 1);
  for (let x = 0; x <= S.device.width; x += lstep) { const [sx] = w2s(x, 0); ctx.fillText(String(x), sx, ay + ah + 4); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = 0; y <= S.device.height; y += lstep) { const [, sy] = w2s(0, y); ctx.fillText(String(y), ax - 5, sy); }
  // origin marker
  const [ox, oy] = w2s(0, 0); ctx.strokeStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + 22, oy); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - 22); ctx.stroke();

  // objects
  const wt = [dpr * z, 0, 0, -dpr * z, dpr * S.view.x, dpr * S.view.y];
  const showProc = $('#iShowProc').checked;
  for (const L of S.doc.layerOrder.slice().reverse()) {
    const layer = S.doc.layers[L]; if (!layer.show) continue;
    const col = dispColor(L);
    for (const o of S.doc.objects) {
      if (o.layer !== L) continue;
      const sel = S.sel.has(o.id);
      if (o.type === 'image') {
        const img = getImage(o.img.src);
        ctx.setTransform(...wt); ctx.transform(...o.m); ctx.translate(0, o.h); ctx.scale(1, -1);
        if (img) {
          const src = showProc ? (procCanvas(o) || img) : img;
          ctx.imageSmoothingEnabled = !showProc;
          ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.92; ctx.fillRect(0, 0, o.w, o.h); ctx.globalAlpha = 1;
          ctx.drawImage(src, 0, 0, o.w, o.h);
        } else { ctx.fillStyle = '#333'; ctx.fillRect(0, 0, o.w, o.h); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const wp = worldPaths(o)[0].pts; ctx.strokeStyle = sel ? '#ffa45c' : o.model ? '#ff3030' : col; ctx.lineWidth = o.model ? 1.6 : 1; ctx.setLineDash(sel ? [5, 3] : []);
        ctx.beginPath(); for (let i = 0; i < 8; i += 2) { const [sx, sy] = w2s(wp[i], wp[i + 1]); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); } ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const wp = worldPaths(o);
      ctx.setTransform(...wt);
      ctx.beginPath();
      for (const p of wp) { const q = p.pts; ctx.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]); if (p.closed) ctx.closePath(); }
      if (layer.mode === 'fill') { ctx.fillStyle = col + '40'; ctx.fill('evenodd'); }
      ctx.lineWidth = (sel ? 1.6 : 1.2) / z; ctx.strokeStyle = col;
      if (sel) ctx.setLineDash([5 / z, 3 / z]);
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // selection box
  const objs = selObjs();
  if (objs.length && S.tool === 'select') {
    const b = boxOf(objs); const hs = handlesFor(b);
    ctx.strokeStyle = 'rgba(255,164,92,.8)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    const [x0, y0] = w2s(b.x0, b.y1), [x1, y1] = w2s(b.x1, b.y0);
    ctx.strokeRect(x0 - 3.5, y0 - 3.5, x1 - x0 + 7, y1 - y0 + 7); ctx.setLineDash([]);
    for (const h of hs) {
      ctx.fillStyle = h.id === 'rot' ? '#ff7a1a' : '#1d1f23'; ctx.strokeStyle = '#ffa45c';
      ctx.beginPath(); if (h.id === 'rot') ctx.arc(h.x, h.y, 5, 0, 7); else ctx.rect(h.x - 4, h.y - 4, 8, 8); ctx.fill(); ctx.stroke();
    }
    const [cx, cy] = w2s((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    ctx.strokeStyle = '#ffa45c'; ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
  }
  // drag previews
  const d = S.drag;
  if (d && d.kind === 'band') {
    const [x0, y0] = w2s(d.w0[0], d.w0[1]), [x1, y1] = w2s(d.w1[0], d.w1[1]);
    const crossing = x1 < x0;
    ctx.fillStyle = crossing ? 'rgba(80,200,120,.08)' : 'rgba(80,140,255,.08)'; ctx.strokeStyle = crossing ? '#50c878' : '#5a8cff';
    ctx.setLineDash(crossing ? [5, 3] : []); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0 + .5, y0 + .5, x1 - x0, y1 - y0); ctx.setLineDash([]);
  }
  if (d && d.kind === 'draw') {
    const paths = draftPaths(d); if (paths) {
      ctx.strokeStyle = dispColor(S.curLayer); ctx.lineWidth = 1.2; ctx.beginPath();
      for (const p of paths) { p.pts.forEach((v, i) => { if (i % 2) return; const [sx, sy] = w2s(p.pts[i], p.pts[i + 1]); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); if (p.closed) ctx.closePath(); }
      ctx.stroke();
      const b = G.pathsBox(paths); ctx.fillStyle = '#ffa45c'; ctx.font = '11px Menlo'; ctx.textAlign = 'left';
      const [tx, ty] = w2s(b.x1, b.y0); ctx.fillText(`${n2(b.x1 - b.x0)} × ${n2(b.y1 - b.y0)}`, tx + 8, ty + 10);
    }
  }
  if (S.line && S.line.pts.length) {
    const q = S.line.pts.concat(S.line.hover || []);
    ctx.strokeStyle = dispColor(S.curLayer); ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < q.length; i += 2) { const [sx, sy] = w2s(q[i], q[i + 1]); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
    ctx.stroke();
    const [fx, fy] = w2s(q[0], q[1]); ctx.strokeStyle = '#ffa45c'; ctx.strokeRect(fx - 4, fy - 4, 8, 8);
  }
  if (S.measure) {
    const [x0, y0] = w2s(...S.measure.a), [x1, y1] = w2s(...S.measure.b);
    ctx.strokeStyle = '#4fd1ff'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    const dx = S.measure.b[0] - S.measure.a[0], dy = S.measure.b[1] - S.measure.a[1];
    ctx.fillStyle = '#4fd1ff'; ctx.font = '12px Menlo'; ctx.textAlign = 'left';
    ctx.fillText(`${n2(Math.hypot(dx, dy))} mm  ∠${n2(Math.atan2(dy, dx) * 180 / Math.PI)}°  Δx ${n2(dx)} Δy ${n2(dy)}`, x1 + 10, y1 - 8);
  }
  // laser position
  if (grbl.connected && S.status) {
    const [lx, ly] = w2s(S.status.wpos[0], S.status.wpos[1]);
    ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(lx, ly, 7, 0, 7); ctx.moveTo(lx - 12, ly); ctx.lineTo(lx + 12, ly); ctx.moveTo(lx, ly - 12); ctx.lineTo(lx, ly + 12); ctx.stroke();
  }
  $('#sZoom').textContent = Math.round(z / 2 * 100) + '%';
}
function handlesFor(b) {
  const [x0, y0] = w2s(b.x0, b.y1), [x1, y1] = w2s(b.x1, b.y0); const p = 4, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [
    { id: 'tl', x: x0 - p, y: y0 - p, c: 'nwse-resize' }, { id: 't', x: mx, y: y0 - p, c: 'ns-resize' }, { id: 'tr', x: x1 + p, y: y0 - p, c: 'nesw-resize' },
    { id: 'r', x: x1 + p, y: my, c: 'ew-resize' }, { id: 'br', x: x1 + p, y: y1 + p, c: 'nwse-resize' }, { id: 'b', x: mx, y: y1 + p, c: 'ns-resize' },
    { id: 'bl', x: x0 - p, y: y1 + p, c: 'nesw-resize' }, { id: 'l', x: x0 - p, y: my, c: 'ew-resize' }, { id: 'rot', x: mx, y: y0 - p - 22, c: 'grab' }];
}

// ---------------------------------------------------------------- hit testing
function hitObject(wx, wy) {
  const tol = 5 / S.view.z;
  for (let i = S.doc.objects.length - 1; i >= 0; i--) {
    const o = S.doc.objects[i]; if (!S.doc.layers[o.layer].show) continue;
    const b = objBox(o); if (wx < b.x0 - tol || wx > b.x1 + tol || wy < b.y0 - tol || wy > b.y1 + tol) continue;
    const wp = worldPaths(o);
    if (o.type === 'image' || o.type === 'text') { if (G.pointInPolys(o.type === 'image' ? wp : [{ pts: [b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1], closed: true }], wx, wy)) return o; continue; }
    if (G.distToPaths(wp, wx, wy) <= tol || G.pointInPolys(wp, wx, wy)) return o;
  }
  return null;
}
function hitHandle(sx, sy) {
  if (!S.sel.size || S.tool !== 'select') return null;
  for (const h of handlesFor(selBox())) if (Math.abs(h.x - sx) <= 7 && Math.abs(h.y - sy) <= 7) return h;
  return null;
}

// ---------------------------------------------------------------- drawing tools
function draftPaths(d) {
  let [x0, y0] = d.w0, [x1, y1] = d.w1;
  if (d.shift) { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0); if (w < 0.01 && h < 0.01) return null;
  const bx = Math.min(x0, x1), by = Math.min(y0, y1);
  let p;
  if (S.tool === 'rect') p = G.rectPaths(w, h, +$('#pCorner').value || 0);
  else if (S.tool === 'ellipse') p = G.ellipsePaths(w, h);
  else p = G.polygonPaths(w, h, clamp(+$('#pSides').value || 6, 3, 64), $('#pStar').checked);
  d.res = { paths: p, m: G.translate(bx, by), w, h };
  return G.xformPaths(p, d.res.m);
}
function finishLine(close) {
  const L = S.line; S.line = null;
  if (!L || L.pts.length < 4) { requestRender(); return; }
  const pts = L.pts.slice();
  const b = G.pathsBox([{ pts }]);
  for (let i = 0; i < pts.length; i += 2) { pts[i] -= b.x0; pts[i + 1] -= b.y0; }
  pushUndo(); addObjects([{ type: 'path', paths: [{ pts, closed: !!close && pts.length >= 6 }], m: G.translate(b.x0, b.y0) }]);
  commit();
}
function snapAngle(x0, y0, x, y) {
  const a = Math.atan2(y - y0, x - x0), d = Math.hypot(x - x0, y - y0), s = Math.round(a / (Math.PI / 4)) * Math.PI / 4;
  return [x0 + d * Math.cos(s), y0 + d * Math.sin(s)];
}
function createText(wx, wy) {
  const tp = currentTextProps(); tp.text = 'Text';
  const paths = Trace.textToPaths(tp);
  pushUndo(); addObjects([{ type: 'text', textProps: tp, paths, m: G.translate(wx, wy) }]);
  setTool('select'); commit();
  setTimeout(() => { $('#tText').focus(); $('#tText').select(); }, 20);
}
function currentTextProps() {
  return { text: $('#tText').value || 'Text', font: $('#tFont').value || 'Arial', size: +$('#tSize').value || 10, bold: $('#tBold').classList.contains('on'), italic: $('#tItalic').classList.contains('on'), align: $('#tAlign').value, spacing: +$('#tSpacing').value || 0 };
}

// ---------------------------------------------------------------- mouse
function setTool(t) {
  if (S.line && t !== 'line') finishLine(false);
  S.tool = t; S.measure = null;
  $$('#tools [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  cv.style.cursor = t === 'select' ? 'default' : t === 'pan' ? 'grab' : 'crosshair';
  $('#polyProps').classList.toggle('hidden', !['polygon', 'rect'].includes(t));
  if (t === 'rect') { $('#pSides').parentElement.style.display = 'none'; $('#pStar').parentElement.style.display = 'none'; $('#pCorner').parentElement.style.display = ''; }
  if (t === 'polygon') { $('#pSides').parentElement.style.display = ''; $('#pStar').parentElement.style.display = ''; $('#pCorner').parentElement.style.display = 'none'; }
  requestRender();
}
function evPos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv.addEventListener('mousedown', (e) => {
  cv.focus(); document.activeElement?.blur?.();
  const [sx, sy] = evPos(e), w = s2w(sx, sy);
  hideCtx();
  if (e.button === 0 && e.ctrlKey && isMac) { openCtxAt(e, sx, sy); return; } // Mac ctrl-click = right-click
  if (e.button === 2) { S.drag = { kind: 'pan', s0: [sx, sy], v0: { ...S.view }, right: true, ev: e }; return; }
  if (e.button === 1 || S.tool === 'pan' || S.space) { S.drag = { kind: 'pan', s0: [sx, sy], v0: { ...S.view } }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  switch (S.tool) {
    case 'select': {
      const h = hitHandle(sx, sy);
      const objs = selObjs(), m0 = new Map(objs.map(o => [o.id, o.m.slice()]));
      if (h) { S.drag = { kind: h.id === 'rot' ? 'rotate' : 'scale', h: h.id, w0: w, b0: selBox(), m0 }; return; }
      const o = hitObject(...w);
      if (o) {
        if (e.shiftKey) { if (S.sel.has(o.id)) { S.sel.delete(o.id); if (o.groupId) S.doc.objects.forEach(x => x.groupId === o.groupId && S.sel.delete(x.id)); } else { S.sel.add(o.id); expandGroups(); } }
        else if (isMac ? e.metaKey : e.ctrlKey) { S.sel.clear(); S.sel.add(o.id); } // pick one shape inside a group
        else if (!S.sel.has(o.id)) { S.sel.clear(); S.sel.add(o.id); expandGroups(); }
        if (!e.shiftKey && (e.altKey)) { // alt-drag duplicates
          pushUndo(); const copies = selObjs().map(cloneObj); const gmap = {}; copies.forEach(c => { c.id = uid(); if (c.groupId) c.groupId = gmap[c.groupId] ||= uid(); });
          addObjects(copies); S.drag = { kind: 'move', w0: w, m0: new Map(copies.map(c => [c.id, c.m.slice()])), pushed: true };
        } else S.drag = { kind: 'move', w0: w, m0: new Map(selObjs().map(o => [o.id, o.m.slice()])) };
        commit(); return;
      }
      if (!e.shiftKey) S.sel.clear();
      S.drag = { kind: 'band', w0: w, w1: w, add: e.shiftKey }; commit(); return;
    }
    case 'rect': case 'ellipse': case 'polygon': S.drag = { kind: 'draw', w0: w, w1: w }; return;
    case 'line': {
      let p = w;
      if (!S.line) { S.line = { pts: [p[0], p[1]] }; requestRender(); return; }
      const q = S.line.pts; if (e.shiftKey) p = snapAngle(q[q.length - 2], q[q.length - 1], ...p);
      const [fx, fy] = w2s(q[0], q[1]);
      if (q.length >= 6 && Math.hypot(fx - sx, fy - sy) < 8) { finishLine(true); return; }
      if (e.detail >= 2) { finishLine(false); return; }
      q.push(p[0], p[1]); requestRender(); return;
    }
    case 'text': createText(...w); return;
    case 'measure': S.measure = { a: w, b: w }; S.drag = { kind: 'measure' }; requestRender(); return;
    case 'laserpos':
      if (!grbl.connected) { toast('Connect to the laser first', 'err'); return; }
      grbl.jogTo(w[0], w[1], +$('#jogFeed').value || 3000); return;
  }
});
window.addEventListener('mousemove', (e) => {
  const [sx, sy] = evPos(e), w = s2w(sx, sy); S.mouse = w;
  $('#sCursor').textContent = `x: ${n2(w[0])}  y: ${n2(w[1])}`;
  const d = S.drag;
  if (!d) {
    if (e.target === cv && S.tool === 'select') { const h = hitHandle(sx, sy); cv.style.cursor = h ? h.c : (hitObject(...w) ? 'move' : 'default'); }
    if (S.line) { let p = w; const q = S.line.pts; if (e.shiftKey) p = snapAngle(q[q.length - 2], q[q.length - 1], ...p); S.line.hover = p; requestRender(); }
    return;
  }
  if (d.kind === 'pan') {
    if (d.right && !d.moved) { if (Math.hypot(sx - d.s0[0], sy - d.s0[1]) < 5) return; d.moved = true; cv.style.cursor = 'grabbing'; }
    S.view.x = d.v0.x + sx - d.s0[0]; S.view.y = d.v0.y + sy - d.s0[1]; requestRender(); return;
  }
  if (d.kind === 'band' || d.kind === 'draw') { d.w1 = w; d.shift = e.shiftKey; requestRender(); return; }
  if (d.kind === 'measure') { S.measure.b = e.shiftKey ? snapAngle(...S.measure.a, ...w) : w; requestRender(); return; }
  if (!d.pushed) { const [s0x, s0y] = w2s(...d.w0); if (Math.hypot(sx - s0x, sy - s0y) < 2) return; pushUndo(); d.pushed = true; }
  let M = G.I();
  if (d.kind === 'move') {
    let dx = w[0] - d.w0[0], dy = w[1] - d.w0[1];
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    M = G.translate(dx, dy);
  } else if (d.kind === 'scale') {
    const b = d.b0, h = d.h;
    const ax = h.includes('l') ? b.x1 : h.includes('r') ? b.x0 : (b.x0 + b.x1) / 2;
    const ay = h.includes('t') ? b.y0 : h.includes('b') ? b.y1 : (b.y0 + b.y1) / 2;
    const hx = h.includes('l') ? b.x0 : b.x1, hy = h.includes('t') ? b.y1 : b.y0;
    let sx_ = (h.includes('l') || h.includes('r')) && hx !== ax ? (w[0] - ax) / (hx - ax) : 1;
    let sy_ = (h.includes('t') || h.includes('b')) && hy !== ay ? (w[1] - ay) / (hy - ay) : 1;
    if (h.length === 2 && S.lock !== e.shiftKey) { const s = Math.abs(sx_ - 1) > Math.abs(sy_ - 1) ? sx_ : sy_; sx_ = sy_ = s; }
    if (e.altKey) { /* scale from centre */ }
    const fix = (v) => Math.abs(v) < 0.002 ? 0.002 * (Math.sign(v) || 1) : v;
    M = G.scale(fix(sx_), fix(sy_), ax, ay);
  } else if (d.kind === 'rotate') {
    const b = d.b0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let a = (Math.atan2(w[1] - cy, w[0] - cx) - Math.atan2(d.w0[1] - cy, d.w0[0] - cx)) * 180 / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    M = G.rotate(a, cx, cy); setMsg(`Rotate ${n2(a)}°`);
  }
  for (const o of S.doc.objects) { const m0 = d.m0.get(o.id); if (m0) o.m = G.mul(M, m0); }
  updateNumbar(); requestRender();
});
window.addEventListener('mouseup', (e) => {
  const d = S.drag; if (!d) return; S.drag = null;
  if (d.kind === 'pan') { cv.style.cursor = S.tool === 'pan' ? 'grab' : 'default'; if (d.right && !d.moved) openCtxAt(e, ...d.s0); return; }
  if (d.kind === 'band') {
    const x0 = Math.min(d.w0[0], d.w1[0]), x1 = Math.max(d.w0[0], d.w1[0]), y0 = Math.min(d.w0[1], d.w1[1]), y1 = Math.max(d.w0[1], d.w1[1]);
    const crossing = d.w1[0] < d.w0[0];
    if (x1 - x0 > 0.01 || y1 - y0 > 0.01) for (const o of S.doc.objects) {
      if (!S.doc.layers[o.layer].show) continue;
      const b = objBox(o);
      const inside = b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1;
      const touch = b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
      if (inside || (crossing && touch)) S.sel.add(o.id);
    }
    expandGroups(); commit(); return;
  }
  if (d.kind === 'draw') {
    d.w1 = s2w(...evPos(e)); d.shift = e.shiftKey;
    if (draftPaths(d) && d.res.w > 0.2 && d.res.h > 0.2) {
      pushUndo(); addObjects([{ type: 'path', paths: d.res.paths, m: d.res.m, shape: S.tool }]);
      setTool('select');
    }
    commit(); return;
  }
  if (d.kind === 'measure') return;
  setMsg(''); if (d.pushed) commit();
});
cv.addEventListener('dblclick', (e) => {
  if (S.tool !== 'select') return;
  const o = hitObject(...s2w(...evPos(e)));
  if (o && o.type === 'text') { $('#tText').focus(); $('#tText').select(); }
  if (o && o.type === 'image' && o.model) { S.sel.clear(); S.sel.add(o.id); commit(); run('modelSettings'); }
});
cv.addEventListener('contextmenu', e => e.preventDefault());
// Scroll wheel / trackpad: zoom around the cursor. Pinch zooms. Shift / Space + scroll pans.
function wheelZoomFactor(e) {
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  return Math.exp(-clamp(dy, -250, 250) * (e.ctrlKey ? 0.012 : 0.0022));
}
cv.addEventListener('wheel', (e) => {
  e.preventDefault(); const [sx, sy] = evPos(e);
  const mode = S.device.wheel || 'zoom';
  const panMod = e.shiftKey || S.space;
  let zoom;
  if (e.ctrlKey || e.metaKey) zoom = true; // pinch gesture (or ⌘+scroll)
  else if (mode === 'pan') zoom = false;
  else if (mode === 'auto') zoom = !panMod && (e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40));
  else zoom = !panMod;
  if (zoom) zoomAt(wheelZoomFactor(e), sx, sy);
  else {
    let dx = e.deltaX, dy = e.deltaY;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; } // shift+wheel on a plain mouse scrolls sideways
    S.view.x -= dx; S.view.y -= dy; requestRender();
  }
}, { passive: false });
// Safari-style gesture events (some Mac trackpads in Electron)
let gestureZ = 1;
cv.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureZ = 1; });
cv.addEventListener('gesturechange', (e) => { e.preventDefault(); const [sx, sy] = evPos(e); zoomAt(e.scale / gestureZ, sx, sy); gestureZ = e.scale; });
new ResizeObserver(resize).observe(cv.parentElement);



// ---------------------------------------------------------------- nesting (true-shape, like LightBurn 2.2 True Nest)
function nestContainerCandidate(sel) {
  const closed = sel.filter(o => o.type === 'path' && !o.groupId && o.paths.length && o.paths.every(p => p.closed));
  if (!closed.length || sel.length < 2) return null;
  const area = (o) => { const b = objBox(o); return (b.x1 - b.x0) * (b.y1 - b.y0); };
  const big = closed.reduce((a, o) => area(o) > area(a) ? o : a);
  const largestOther = Math.max(0, ...sel.filter(o => o !== big).map(area));
  return area(big) >= 2 * largestOther ? big : null; // the sheet must be clearly bigger than any single part
}
function nestUnits(parts, lockInner) {
  const groups = groupUnits(parts).map(objs => ({ objs }));
  const box = (u) => boxOf(u.objs), area = (u) => { const b = box(u); return (b.x1 - b.x0) * (b.y1 - b.y0); };
  if (lockInner) {
    groups.sort((a, b) => area(b) - area(a));
    for (let i = groups.length - 1; i >= 0; i--) {
      const u = groups[i], b = box(u), p0 = worldPaths(u.objs[0])[0]?.pts;
      if (!p0) continue;
      for (let j = 0; j < i; j++) {
        const v = groups[j]; if (!v || v === u) continue; const vb = box(v);
        if (b.x0 >= vb.x0 && b.x1 <= vb.x1 && b.y0 >= vb.y0 && b.y1 <= vb.y1 && v.objs.some(o => G.pointInPolys(worldPaths(o).filter(q => q.closed), p0[0], p0[1]))) { v.objs.push(...u.objs); groups.splice(i, 1); break; }
      }
    }
  }
  return groups.map(g => { const b = boxOf(g.objs); return { members: g.objs, objs: g.objs.map(worldPaths), cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 }; });
}
function nestDialog() {
  const sel = selObjs().filter(o => S.doc.layers[o.layer].show);
  const cand = nestContainerCandidate(sel);
  const st = { ...{ padding: 2, edge: 2, rot: 90, mode: 'pack', lockInner: true, overflow: 'leave', level: 1, into: cand ? 'shape' : 'area' }, ...JSON.parse(localStorage.getItem('bf.nest') || '{}') };
  if (!cand) st.into = 'area';
  const partsAll = st.into === 'shape' ? sel.filter(o => o !== cand) : (sel.length ? sel : S.doc.objects.filter(o => S.doc.layers[o.layer].show));
  if (!partsAll.length) return toast('Draw or import the parts you want to nest first', 'err');
  const cb = cand ? objBox(cand) : null;
  const body = document.createElement('div');
  body.innerHTML = `<div class="form">
    <label>Nest into</label><select id="nInto">${cand ? `<option value="shape">Selected shape (${n2(cb.x1 - cb.x0)} × ${n2(cb.y1 - cb.y0)} mm)</option>` : ''}<option value="area">Whole work area (${S.device.width} × ${S.device.height} mm)</option></select>
    <label>Parts</label><div id="nParts" class="note"></div>
    <label>Spacing</label><select id="nMode"><option value="pack">Pack tightly — use the least material</option><option value="spread">Spread out — maximise the space between parts</option></select>
    <label id="nPadL">Space between parts (mm)</label><input type="number" id="nPad" min="0" step="0.5">
    <label>Distance from edge (mm)</label><input type="number" id="nEdge" min="0" step="0.5">
    <label>Rotation</label><select id="nRot"><option value="0">Don't rotate (keep wood grain direction)</option><option value="90">90° steps</option><option value="45">45° steps</option><option value="30">30° steps</option><option value="15">15° steps</option><option value="10">10° steps</option></select>
    <label>Keep inner shapes with their outline</label><div class="row tight" style="margin:0"><input type="checkbox" id="nLock"><span class="note">e.g. holes and engraving inside a part move with it</span></div>
    <label class="n-sh">Parts that don't fit</label><select class="n-sh" id="nOver"><option value="leave">Leave them where they are</option><option value="pages">Put them on new pages (a copy of the sheet on each)</option><option value="sheets">Put them on extra sheets beside this one</option></select>
    <label>Optimise</label><select id="nLevel"><option value="0">Fast (~2 s)</option><option value="1">Normal (~6 s)</option><option value="2">Thorough (~15 s)</option><option value="3">Maximum (~40 s, finer detail)</option></select>
    <div class="full" id="nProgWrap" style="display:none"><div class="bar nbar"><div id="nBar"></div></div><div class="note" id="nMsg"></div></div>
    <div class="full note">Parts are packed by their real outline, so small parts can sit inside the holes of bigger ones. Groups stay together. Undo with ${MOD}Z.</div>
  </div>`;
  const $b = (id) => $(id, body);
  $b('#nInto').value = st.into; $b('#nMode').value = st.mode; $b('#nPad').value = st.padding; $b('#nEdge').value = st.edge; $b('#nRot').value = st.rot; $b('#nLock').checked = st.lockInner; $b('#nOver').value = st.overflow; $b('#nLevel').value = st.level;
  const parts = () => $b('#nInto').value === 'shape' ? sel.filter(o => o !== cand) : (sel.length ? sel : S.doc.objects.filter(o => S.doc.layers[o.layer].show));
  const sync = () => {
    const sh = $b('#nInto').value === 'shape'; $$('.n-sh', body).forEach(e => e.style.display = sh ? '' : 'none');
    $b('#nPadL').textContent = $b('#nMode').value === 'spread' ? 'Minimum space between parts (mm)' : 'Space between parts (mm)';
    const u = nestUnits(parts(), $b('#nLock').checked).length;
    $b('#nParts').textContent = `${u} part${u === 1 ? '' : 's'}${sel.length ? '' : ' (nothing selected, so all shapes)'}`;
  };
  body.oninput = sync; body.onchange = sync; sync();
  let running = false, stopFlag = false, cancelFlag = false;
  const M = modal({
    title: 'Nest parts', body, width: 600, onClose: () => { cancelFlag = true; stopFlag = true; }, buttons: [
      { label: 'Cancel', onClick: () => { cancelFlag = true; stopFlag = true; } },
      { label: 'Start nesting', cls: 'primary', onClick: async () => {
          if (running) { stopFlag = true; return false; }
          const o = { into: $b('#nInto').value, mode: $b('#nMode').value, padding: Math.max(0, +$b('#nPad').value || 0), edge: Math.max(0, +$b('#nEdge').value || 0), rot: +$b('#nRot').value, lockInner: $b('#nLock').checked, overflow: $b('#nOver').value, level: +$b('#nLevel').value };
          localStorage.setItem('bf.nest', JSON.stringify(o));
          running = true; const btn = $('#modal footer button.primary'); btn.textContent = 'Stop (keep best so far)';
          $b('#nProgWrap').style.display = ''; $$('input,select', body).forEach(e => e.disabled = true);
          try { await doNest(o, o.into === 'shape' ? cand : null, parts(), (p, msg) => { $b('#nBar').style.width = (p * 100).toFixed(0) + '%'; $b('#nMsg').textContent = msg; }, () => stopFlag, () => cancelFlag); }
          catch (e) { console.error(e); toast('Nesting failed: ' + e.message, 'err'); }
          running = false; if (!cancelFlag) M.close();
          return false;
        } }]
  });
}
async function doNest(o, contObj, parts, onProgress, stopped, cancelled) {
  const secs = [2, 6, 15, 40][o.level] ?? 6;
  let container = contObj ? { paths: worldPaths(contObj), box: objBox(contObj) }
    : { paths: [{ pts: [0, 0, S.device.width, 0, S.device.width, S.device.height, 0, S.device.height], closed: true }], box: { x0: 0, y0: 0, x1: S.device.width, y1: S.device.height } };
  let units = nestUnits(parts, o.lockInner);
  const total = units.length, moves = []; let sheets = 0, lastRes = null, totalPlaced = 0, sheetObjs = [], lastPlacedSheet = 0;
  for (let round = 0; round < 25 && units.length; round++) {
    const r = await Nest.run({ container, units, padding: o.padding, edge: o.edge, rotStep: o.rot, seconds: round ? Math.max(2, secs / 2) : secs, spread: o.mode === 'spread', fine: o.level >= 3,
      onProgress: (p, msg) => onProgress(p, (round ? `Sheet ${round + 1}: ` : '') + msg), stopped });
    if (cancelled()) return;
    if (!r || !r.placed) break;
    lastRes = r; totalPlaced += r.placed; lastPlacedSheet = sheets;
    const placedSet = new Set(r.placements.map(p => p.ui));
    for (const p of r.placements) moves.push({ unit: units[p.ui], p, sheetShift: null });
    units = units.filter((u, i) => !placedSet.has(i));
    if (!units.length || o.overflow === 'leave' || !contObj) break;
    sheets++;
    if (o.overflow === 'pages') { // same sheet position, on a new page
      const copy = cloneObj(contObj); copy.id = uid(); delete copy.groupId; copy.page = sheets; sheetObjs.push(copy);
      for (const m of moves) if (m.page === undefined) m.page = sheets - 1;
      continue;
    }
    // next sheet: copy of the container to the right of the previous one
    const w = container.box.x1 - container.box.x0 + 10;
    const copy = cloneObj(contObj); copy.id = uid(); delete copy.groupId; copy.m = G.mul(G.translate(w * sheets, 0), contObj.m);
    sheetObjs.push(copy);
    const cp = G.xformPaths(worldPaths(contObj), G.translate(w * sheets, 0));
    container = { paths: cp, box: G.pathsBox(cp) };
  }
  if (cancelled()) return;
  // drop a trailing extra sheet that ended up empty
  const roundsUsed = o.overflow === 'pages' ? (moves.some(m => m.page === undefined) ? sheets + 1 : sheets) : null;
  if (roundsUsed !== null && roundsUsed < sheets + 1) { sheets = roundsUsed - 1; sheetObjs.length = Math.max(0, sheets); }
  if (o.overflow === 'sheets' && lastPlacedSheet < sheets) { sheets = lastPlacedSheet; sheetObjs.length = sheets; }
  if (!moves.length) { toast(lastRes === null ? 'Nothing fits — check the spacing, edge distance and part sizes' : 'Nothing could be placed', 'err'); return; }
  pushUndo();
  for (const m of moves) if (m.page === undefined) m.page = o.overflow === 'pages' ? sheets : 0;
  for (const { unit, p } of moves) {
    const M = G.mul(G.translate(p.dx, p.dy), G.rotate(p.deg, unit.cx, unit.cy));
    for (const ob of unit.members) ob.m = G.mul(M, ob.m);
  }
  if (o.overflow === 'pages' && sheets) {
    const base = S.doc.page; syncPages(); const pageIdx = [base];
    for (let k = 1; k <= sheets; k++) { const i = addPage([], `${S.doc.pages[base].name} – sheet ${k + 1}`); pageIdx.push(i); }
    const moveIds = new Map(); moves.forEach(m => { if (m.page > 0) m.unit.members.forEach(ob => moveIds.set(ob.id, m.page)); });
    const keep = [];
    for (const ob of S.doc.objects) { const pg = moveIds.get(ob.id); if (pg) S.doc.pages[pageIdx[pg]].objects.push(ob); else keep.push(ob); }
    S.doc.objects = keep; syncPages();
    for (const c of sheetObjs) { const pg = c.page; delete c.page; S.doc.pages[pageIdx[pg]].objects.push(c); }
    sheetObjs.length = 0;
  }
  for (const s of sheetObjs) S.doc.objects.push(s);
  S.sel.clear(); moves.forEach(m => m.unit.members.forEach(ob => S.sel.add(ob.id))); sheetObjs.forEach(s => S.sel.add(s.id));
  commit();
  const left = total - totalPlaced;
  const msg = `Nested ${totalPlaced} of ${total} parts` + (sheets ? ` on ${sheets + 1} ${o.overflow === 'pages' ? 'pages' : 'sheets'}` : '') +
    (o.mode === 'spread' && lastRes ? ` · spacing ${n2(lastRes.padding)} mm` : '') + (lastRes && !sheets ? ` · ${Math.round(lastRes.fill * 100)}% of the sheet used` : '') +
    (left ? ` · ${left} didn't fit (left where they were)` : '');
  if (!o.quiet || left) toast(msg, left ? 'err' : 'ok');
  return { placed: totalPlaced, total, fill: lastRes?.fill };
}


// ---------------------------------------------------------------- pages (multi page projects)
function renderPages() {
  const bar = $('#pagebar'); if (!bar) return; syncPages();
  bar.innerHTML = '';
  S.doc.pages.forEach((p, i) => {
    const t = document.createElement('div'); t.className = 'ptab' + (i === S.doc.page ? ' on' : '');
    t.innerHTML = `<span>${p.name.replace(/</g, '&lt;')}</span><small>${p.objects.length || ''}</small>`;
    t.title = `${p.name} — ${p.objects.length} object(s). Double-click to rename, right-click for options.`;
    t.onclick = () => switchPage(i);
    t.ondblclick = () => renamePage(i);
    t.oncontextmenu = (e) => { e.preventDefault(); pageMenu(i, e.clientX, e.clientY); };
    bar.appendChild(t);
  });
  const add = document.createElement('button'); add.className = 'small padd'; add.textContent = '+'; add.title = 'Add a new page';
  add.onclick = () => run('pageNew'); bar.appendChild(add);
}
function switchPage(i) {
  if (i === S.doc.page || i < 0 || i >= S.doc.pages.length) return;
  syncPages(); S.doc.page = i; S.doc.objects = S.doc.pages[i].objects; S.sel.clear(); S.est = null; commit(); renderPages();
}
function renamePage(i) {
  const p = S.doc.pages[i];
  const body = document.createElement('div'); body.innerHTML = `<div class="form"><label>Page name</label><input type="text" id="pgName" value="${p.name.replace(/"/g, '&quot;')}"></div>`;
  modal({ title: 'Rename page', body, buttons: [{ label: 'Cancel' }, { label: 'Rename', cls: 'primary', onClick: (B) => { const v = $('#pgName', B).value.trim(); if (v) { pushUndo(); p.name = v; renderPages(); } } }] });
  setTimeout(() => { const i2 = $('#pgName'); i2?.select(); i2?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#modal footer .primary').click(); }); }, 40);
}
function pageMenu(i, x, y) {
  hideCtx(); const n = S.doc.pages.length;
  const m = document.createElement('div'); m.className = 'ctxmenu';
  const item = (label, fn, on = true) => { const d = document.createElement('div'); d.className = 'citem' + (on ? '' : ' off'); d.innerHTML = `<span>${label}</span>`; if (on) d.onclick = () => { hideCtx(); fn(); }; m.appendChild(d); };
  item('Rename…', () => renamePage(i));
  item('Duplicate page', () => { switchPage(i); run('pageDuplicate'); });
  item('Move left', () => movePage(i, -1), i > 0); item('Move right', () => movePage(i, 1), i < n - 1);
  m.insertAdjacentHTML('beforeend', '<div class="csep"></div>');
  item('Delete page', () => { switchPage(i); run('pageDelete'); }, n > 1);
  document.body.appendChild(m); const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
}
function movePage(i, d) {
  syncPages(); const P = S.doc.pages, j = i + d; if (j < 0 || j >= P.length) return; pushUndo();
  const cur = P[S.doc.page]; [P[i], P[j]] = [P[j], P[i]]; S.doc.page = P.indexOf(cur); renderPages();
}
function newPageName() { let k = S.doc.pages.length + 1; while (S.doc.pages.some(p => p.name === `Page ${k}`)) k++; return `Page ${k}`; }
function addPage(objs = [], name) { syncPages(); const p = { id: uid(), name: name || newPageName(), objects: objs }; S.doc.pages.push(p); return S.doc.pages.length - 1; }
function moveSelToPage(i) {
  const sel = selObjs(); if (!sel.length || i === S.doc.page) return; pushUndo();
  S.doc.objects = S.doc.objects.filter(o => !S.sel.has(o.id)); syncPages();
  S.doc.pages[i].objects.push(...sel); S.sel.clear(); commit(); renderPages();
  toast(`Moved ${sel.length} object(s) to ${S.doc.pages[i].name}`, 'ok');
}


// ---------------------------------------------------------------- 3D model import (depth maps)
const modelCache = new Map();
const b64FromBytes = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const bytesFromB64 = (b) => Uint8Array.from(atob(b), c => c.charCodeAt(0));
async function modelOf(o) {
  let m = modelCache.get(o.model.key); if (m) return m;
  m = await Model3D.parse(bytesFromB64(o.model.data), o.model.ext); modelCache.set(o.model.key, m); return m;
}
function modelDialog(model, st, title, onOK) {
  const body = document.createElement('div'); body.className = 'm3wrap';
  body.innerHTML = `<div><canvas id="m3pv" width="380" height="300"></canvas><div class="note" style="margin-top:4px">Drag the preview to rotate · white = highest (least burn), black = deepest</div><div class="note" id="m3info"></div></div>
  <div class="form m3form">
    <label>View from</label><select id="m3view"><option value="top">Top</option><option value="bottom">Bottom</option><option value="front">Front</option><option value="back">Back</option><option value="left">Left</option><option value="right">Right</option></select>
    <label>Rotate X / Y / Z (°)</label><div class="row tight" style="margin:0"><input type="number" id="m3rx" step="5" style="width:58px"><input type="number" id="m3ry" step="5" style="width:58px"><input type="number" id="m3rz" step="5" style="width:58px"></div>
    <label>Width (mm)</label><input type="number" id="m3w" min="1" step="1">
    <label>Height (mm)</label><input type="number" id="m3h" min="1" step="1">
    <label>Resolution</label><select id="m3dpi"><option value="127">127 DPI (0.2 mm)</option><option value="169">169 DPI (0.15 mm)</option><option value="254">254 DPI (0.1 mm)</option><option value="318">318 DPI (0.08 mm)</option><option value="423">423 DPI (0.06 mm)</option></select>
    <label>Bit depth (gray levels)</label><select id="m3lv"><option value="256">8-bit — 256 levels</option><option value="64">6-bit — 64 levels</option><option value="32">5-bit — 32 levels</option><option value="16">4-bit — 16 levels</option><option value="8">3-bit — 8 levels</option></select>
    <label>Invert depth</label><input type="checkbox" id="m3inv">
    <div class="full note">The model stays editable (red outline) — double-click it to change these settings. Use “Convert to bitmap” to make it a normal image.</div>
  </div>`;
  const q = (id) => $(id, body);
  q('#m3view').value = st.view; q('#m3rx').value = st.rx; q('#m3ry').value = st.ry; q('#m3rz').value = st.rz; q('#m3dpi').value = st.dpi; q('#m3lv').value = st.levels; q('#m3inv').checked = st.invert;
  let or = null, aspect = 1;
  const reorient = () => { or = Model3D.orient(model, st); const b = or.box; aspect = ((b.y1 - b.y0) || 1) / ((b.x1 - b.x0) || 1); };
  const draw = () => {
    const c = q('#m3pv'), x = c.getContext('2d'); x.fillStyle = '#2a2d33'; x.fillRect(0, 0, c.width, c.height);
    const k = Math.min((c.width - 16) / 1, (c.height - 16) / aspect);
    const w = Math.max(8, Math.min(c.width - 16, k)), h = Math.max(8, w * aspect);
    const r = Model3D.render(or, { wpx: w, hpx: h, levels: st.levels, invert: st.invert });
    x.drawImage(r.canvas, (c.width - w) / 2, (c.height - h) / 2);
    const b = or.box, sc = st.width / ((b.x1 - b.x0) || 1);
    q('#m3info').textContent = `${model.count.toLocaleString()} triangles · model depth ${n2((b.z1 - b.z0) * sc)} mm at this size · ${Math.round(st.width * st.dpi / 25.4)} × ${Math.round(st.width * aspect * st.dpi / 25.4)} px`;
  };
  const sync = (ev) => {
    const id = ev && ev.target && ev.target.id;
    st.view = q('#m3view').value; st.rx = +q('#m3rx').value || 0; st.ry = +q('#m3ry').value || 0; st.rz = +q('#m3rz').value || 0;
    st.dpi = +q('#m3dpi').value; st.levels = +q('#m3lv').value; st.invert = q('#m3inv').checked;
    if (['m3view', 'm3rx', 'm3ry', 'm3rz'].includes(id) || !or) reorient();
    if (id === 'm3h') st.width = Math.max(1, +q('#m3h').value / aspect); else if (id !== 'm3w' || +q('#m3w').value > 0) st.width = Math.max(1, +q('#m3w').value || st.width);
    if (id !== 'm3w') q('#m3w').value = n2(st.width); if (id !== 'm3h') q('#m3h').value = n2(st.width * aspect);
    draw();
  };
  body.oninput = sync;
  // drag to rotate
  let dr = null; const pv = q('#m3pv'); pv.style.cursor = 'grab';
  pv.onmousedown = (e) => { dr = { x: e.clientX, y: e.clientY, rx: st.rx, ry: st.ry }; pv.style.cursor = 'grabbing'; };
  const mv = (e) => { if (!dr) return; st.ry = Math.round(dr.ry + (e.clientX - dr.x) * 0.6); st.rx = Math.round(dr.rx + (e.clientY - dr.y) * 0.6); q('#m3rx').value = st.rx; q('#m3ry').value = st.ry; reorient(); q('#m3h').value = n2(st.width * aspect); draw(); };
  const up = () => { dr = null; pv.style.cursor = 'grab'; };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  reorient(); if (!st.width) st.width = Math.min(150, S.device.width * 0.6);
  q('#m3w').value = n2(st.width); q('#m3h').value = n2(st.width * aspect); setTimeout(draw, 10);
  modal({ title, body, width: 820, onClose: () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }, buttons: [{ label: 'Cancel' }, {
    label: 'OK', cls: 'primary', onClick: async () => {
      const wpx = st.width * st.dpi / 25.4, hpx = wpx * aspect;
      if (Math.max(wpx, hpx) > 8000) { toast('That size and resolution is too large — lower the resolution or size', 'err'); return false; }
      setMsg('Building depth map…'); await new Promise(r => setTimeout(r, 20));
      const r = Model3D.render(or, { wpx, hpx, levels: st.levels, invert: st.invert }); setMsg('');
      onOK(r.canvas.toDataURL('image/png'), st.width, st.width * aspect, { ...st });
    } }] });
}
async function importModel(f, ext) {
  setMsg('Reading 3D model…'); await new Promise(r => setTimeout(r, 10));
  const model = await Model3D.parse(f.data, ext); setMsg('');
  const key = uid(); modelCache.set(key, model);
  const st = { view: 'top', rx: 0, ry: 0, rz: 0, width: 0, dpi: 254, levels: 256, invert: false };
  modelDialog(model, st, `Import 3D model — ${f.name}`, async (src, w, h, settings) => {
    const im = await Importers.loadImage(src);
    const layer = freeLayer();
    const o = { type: 'image', img: { src, pw: im.naturalWidth, ph: im.naturalHeight }, w, h, m: G.translate((S.device.width - w) / 2, (S.device.height - h) / 2), layer, adj: {},
      model: { key, name: f.name, ext, data: b64FromBytes(f.data), settings } };
    pushUndo(); addObjects([o]);
    Object.assign(S.doc.layers[layer], { mode: 'image', imageMode: 'grayscale', interval: +(25.4 / settings.dpi).toFixed(3), speed: 3000, minPower: 0, maxPower: 60, name: 'C' + pad2(layer) + ' 3D' });
    commit(); toast(`3D model imported as a depth map on layer C${pad2(layer)} (Image, grayscale). Double-click it to adjust.`, 'ok');
  });
}


// ---------------------------------------------------------------- REST API (requests come from the main process)
async function apiHandle(r) {
  const ok = (json, status = 200) => NATIVE.apiRespond({ id: r.id, status, json });
  const err = (msg, status = 400) => NATIVE.apiRespond({ id: r.id, status, json: { error: msg } });
  const needJobs = () => { if (!r.allowJobs) { err('Controlling the laser through the API is switched off. Turn on “Allow starting jobs and machine commands” in BeamForge → Remote API.', 403); return false; } if (!grbl.connected) { err('BeamForge is not connected to a laser', 409); return false; } return true; };
  const key = `${r.method} ${r.path}`;
  try {
    switch (key) {
      case 'GET /status': {
        const j = grbl.job;
        return ok({ app: 'BeamForge', connected: grbl.connected, state: grbl.connected ? (S.status?.state || 'Unknown') : 'Disconnected',
          position: S.status ? { x: S.status.wpos[0], y: S.status.wpos[1], z: S.status.wpos[2] } : null,
          job: j ? { running: true, linesSent: j.acked, linesTotal: j.total, progress: j.total ? j.acked / j.total : 0, elapsedSeconds: (Date.now() - j.start) / 1000, estimatedSeconds: S.run?.est || null } : { running: false },
          project: S.fileName, page: { index: S.doc.page, name: S.doc.pages[S.doc.page].name, count: S.doc.pages.length } });
      }
      case 'GET /project': {
        syncPages(); const job = S.doc.objects.length ? buildJob(true) : null;
        return ok({ name: S.fileName, unsavedChanges: S.dirty, pages: S.doc.pages.map((p, i) => ({ index: i, name: p.name, objects: p.objects.length, current: i === S.doc.page })),
          layers: S.doc.layerOrder.map(li => { const L = S.doc.layers[li]; return { index: li, name: L.name, mode: L.mode, speed: L.speed, power: L.maxPower, passes: L.passes, output: L.output }; }),
          estimatedSeconds: job ? Math.round(job.stats.time) : 0, bounds: job?.bounds || null });
      }
      case 'GET /gcode': { const job = buildJob(true); if (!job) return err('Nothing to output on this page', 409); return NATIVE.apiRespond({ id: r.id, status: 200, text: job.gcode, type: 'text/plain' }); }
      case 'POST /import': {
        const name = r.query.name || r.headers.filename; if (!name) return err('Give the file name with ?name=… so BeamForge knows the file type');
        const before = S.doc.objects.length; await importFile({ name, data: new Uint8Array(r.body) });
        return ok({ imported: name, objectsAdded: S.doc.objects.length - before });
      }
      case 'POST /project/open': { await openProjectData(new TextDecoder().decode(r.body), r.query.name || 'API project', null); return ok({ opened: S.fileName }); }
      case 'POST /project/new': { S.doc = newDoc(); S.sel.clear(); S.undo = []; S.redo = []; S.fileName = 'Untitled'; S.filePath = null; S.dirty = false; updateTitle(); commit(); return ok({ ok: true }); }
      case 'POST /page': { const i = parseInt(r.query.index, 10); if (!(i >= 0 && i < S.doc.pages.length)) return err('No such page'); switchPage(i); return ok({ page: i, name: S.doc.pages[i].name }); }
      case 'POST /job/start': {
        if (!needJobs()) return; const job = buildJob(true); if (!job) return err('Nothing to output on this page', 409);
        if (startJob(job) === false) return err('The job could not start — check BeamForge', 409);
        toast('Job started remotely through the API', 'ok'); return ok({ started: true, estimatedSeconds: Math.round(job.stats.time) });
      }
      case 'POST /job/pause': if (!grbl.job) return err('No job is running', 409); grbl.pause(); return ok({ paused: true });
      case 'POST /job/resume': if (!grbl.connected) return err('Not connected', 409); grbl.resume(); return ok({ resumed: true });
      case 'POST /job/stop': if (!grbl.connected) return err('Not connected', 409); grbl.stop(); toast('Job stopped through the API', 'err'); return ok({ stopped: true });
      case 'POST /frame': if (!needJobs()) return; run('frame'); return ok({ framing: true });
      case 'POST /command': {
        if (!needJobs()) return; let c = ''; try { c = JSON.parse(new TextDecoder().decode(r.body)).command; } catch { c = new TextDecoder().decode(r.body); }
        c = String(c || '').trim(); if (!c) return err('Send {"command":"…"}'); grbl.send(c); return ok({ sent: c });
      }
    }
    return err(`Unknown endpoint ${key} — see /api/v1`, 404);
  } catch (e) { console.error(e); return err(e.message, 500); }
}
if (NATIVE?.onApiRequest) NATIVE.onApiRequest(apiHandle);
async function apiDialog() {
  if (!NATIVE?.apiInfo) return toast('The API is only available in the Mac app', 'err');
  const i = await NATIVE.apiInfo();
  const body = document.createElement('div');
  const draw = (i) => {
    body.innerHTML = `<div class="form">
      <label>Enable API</label><div class="row tight" style="margin:0"><input type="checkbox" id="apEn" ${i.enabled ? 'checked' : ''}><span class="note">${i.enabled ? (i.running ? '● running' : '✕ not running ' + (i.error || '')) : 'off'}</span></div>
      <label>Port</label><input type="number" id="apPort" value="${i.port}" min="1024" max="65535">
      <label>Allow other devices on the network</label><div class="row tight" style="margin:0"><input type="checkbox" id="apLan" ${i.lan ? 'checked' : ''}><span class="note">off = only this Mac can connect</span></div>
      <label>Access token</label><div class="row tight" style="margin:0"><input type="text" id="apTok" value="${i.token || ''}" placeholder="none (this Mac only)" style="flex:1;font-family:Menlo,monospace"><button class="small" id="apGen">New</button></div>
      <label>Allow starting jobs and machine commands</label><div class="row tight" style="margin:0"><input type="checkbox" id="apJobs" ${i.allowJobs ? 'checked' : ''}><span class="note">off = read status, import files and switch pages only</span></div>
      <label>Address</label><div style="font-family:Menlo,monospace;font-size:11px;user-select:text">${i.urls.length ? i.urls.join('<br>') : '—'}</div>
      <div class="full note">Try it: <code>curl ${i.urls[0] || 'http://127.0.0.1:' + i.port + '/api/v1'}/status${i.token ? ` -H "Authorization: Bearer ${i.token}"` : ''}</code><br>Open the address in a browser to see every endpoint. The API never replaces watching the laser — never leave a running laser unattended.</div>
    </div>`;
    $('#apGen', body).onclick = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); $('#apTok', body).value = [...a].map(b => b.toString(16).padStart(2, '0')).join(''); save(); };
  };
  const save = async () => draw(await NATIVE.apiSettings({ enabled: $('#apEn', body).checked, port: +$('#apPort', body).value, lan: $('#apLan', body).checked, token: $('#apTok', body).value.trim(), allowJobs: $('#apJobs', body).checked }));
  body.onchange = () => setTimeout(save, 0);
  draw(i);
  modal({ title: 'Remote API', body, width: 640, buttons: [{ label: 'Close', cls: 'primary' }] });
}


// ---------------------------------------------------------------- vector troubleshooter
function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}
function selfIntersects(p) {
  const q = p.pts, n = q.length / 2; if (n < 4 || n > 1500) return false;
  const segs = p.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < segs; j++) {
      if (p.closed && i === 0 && j === segs - 1) continue;
      const j2 = (j + 1) % n;
      if (segsIntersect(q[2 * i], q[2 * i + 1], q[2 * i2], q[2 * i2 + 1], q[2 * j], q[2 * j + 1], q[2 * j2], q[2 * j2 + 1])) return true;
    }
  }
  return false;
}
function scanVectors() {
  const scope = S.sel.size ? selObjs() : S.doc.objects.slice();
  const issues = [];
  const add = (id, title, desc, objs, fix, fixLabel) => { if (objs.length) issues.push({ id, title, desc, objs, fix, fixLabel }); };
  const vec = scope.filter(o => o.type !== 'image');
  const L = (o) => S.doc.layers[o.layer];
  // 1 open shapes on fill layers
  add('openFill', 'Open shapes on Fill layers', 'Fill only engraves inside closed shapes — these will be skipped.',
    vec.filter(o => L(o).mode === 'fill' && o.paths.some(p => !p.closed)),
    (objs) => objs.forEach(o => { o.paths = Importers.joinPaths(o.paths, 0.3 / G.mScale(o.m)).map(p => ({ pts: p.pts, closed: p.closed || p.pts.length >= 6 })); }), 'Close them');
  // 2 nearly-closed gaps
  add('gaps', 'Shapes with small gaps', 'Open paths whose ends are less than 0.5 mm apart — usually meant to be closed.',
    vec.filter(o => L(o).mode !== 'fill' && worldPaths(o).some(p => !p.closed && p.pts.length >= 6 && Math.hypot(p.pts[0] - p.pts[p.pts.length - 2], p.pts[1] - p.pts[p.pts.length - 1]) < 0.5)),
    (objs) => objs.forEach(o => { const k = 0.5 / G.mScale(o.m); o.paths = Importers.joinPaths(o.paths, k).map(p => { const q = p.pts; const close = !p.closed && q.length >= 6 && Math.hypot(q[0] - q[q.length - 2], q[1] - q[q.length - 1]) < k; return { pts: close ? q.slice(0, -2) : q, closed: p.closed || close }; }); }), 'Join & close');
  // 3 duplicates
  const sig = (o) => { const w = worldPaths(o); return o.layer + '|' + w.map(p => { const b = G.pathsBox([p]); return [p.pts.length, b.x0, b.y0, b.x1, b.y1].map(v => Math.round(v * 20)).join(','); }).sort().join(';'); };
  const seen = new Map(), dups = [];
  for (const o of vec) { const k = sig(o); if (seen.has(k)) dups.push(o); else seen.set(k, o); }
  add('dups', 'Duplicate shapes', 'Identical shapes stacked on top of each other — the laser would cut the same line twice.', dups,
    (objs) => { const ids = new Set(objs.map(o => o.id)); S.doc.objects = S.doc.objects.filter(o => !ids.has(o.id)); }, 'Delete duplicates');
  // 4 tiny
  add('tiny', 'Tiny shapes', 'Shapes smaller than 0.3 mm — usually dust from imports or traces.',
    vec.filter(o => { const b = objBox(o); return Math.max(b.x1 - b.x0, b.y1 - b.y0) < 0.3; }),
    (objs) => { const ids = new Set(objs.map(o => o.id)); S.doc.objects = S.doc.objects.filter(o => !ids.has(o.id)); }, 'Delete them');
  // 5 dense paths
  add('dense', 'Over-detailed paths', 'Paths with far more points than needed (over 30 per mm) — they make large, slow G-code.',
    vec.filter(o => { let pts = 0, len = 0; for (const p of worldPaths(o)) { pts += p.pts.length / 2; len += G.pathLength(p); } return pts > 200 && pts / Math.max(len, 0.01) > 30; }),
    (objs) => objs.forEach(o => { const t = 0.01 / G.mScale(o.m); o.paths = o.paths.map(p => ({ pts: G.simplify(p.closed ? p.pts.concat(p.pts.slice(0, 2)) : p.pts, t, p.closed).slice(0, p.closed ? -2 : undefined), closed: p.closed })).filter(p => p.pts.length >= 4); }), 'Simplify');
  // 6 self-intersecting closed shapes on fill layers
  add('cross', 'Self-crossing shapes on Fill layers', 'Outlines that cross themselves can fill unexpectedly (gaps where they overlap). Check them in Preview.',
    vec.filter(o => L(o).mode === 'fill' && worldPaths(o).some(p => p.closed && selfIntersects(p))), null);
  // 7 outside work area
  add('outside', 'Outside the work area', 'These are partly or fully beyond the laser’s reach and would be cut off or rejected.',
    scope.filter(o => { const b = objBox(o); return b.x0 < -0.01 || b.y0 < -0.01 || b.x1 > S.device.width + 0.01 || b.y1 > S.device.height + 0.01; }), null);
  // 8 wrong layer types
  add('imgOnLine', 'Images on Line / Fill layers', 'An image on a Line layer only cuts its rectangle outline. Move it to a layer set to Image.',
    scope.filter(o => o.type === 'image' && L(o).mode !== 'image'), (objs) => { const li = freeLayer(); objs.forEach(o => o.layer = li); setImageLayer(li); }, 'Move to an Image layer');
  add('noOut', 'Shapes on layers with Output off', 'These will not be sent to the laser.', scope.filter(o => !L(o).output), null);
  add('empty', 'Empty or broken objects', 'Objects with no usable geometry.', vec.filter(o => !o.paths.length || o.paths.every(p => p.pts.length < 4 || G.pathLength(p) < 1e-6)),
    (objs) => { const ids = new Set(objs.map(o => o.id)); S.doc.objects = S.doc.objects.filter(o => !ids.has(o.id)); }, 'Delete them');
  return { issues, scope: scope.length, selection: S.sel.size > 0 };
}
function troubleshooter() {
  const body = document.createElement('div');
  const draw = () => {
    const r = scanVectors();
    body.innerHTML = `<p class="note">Checked ${r.scope} object(s) ${r.selection ? 'in the selection' : 'on this page'}.</p>` + (r.issues.length ? r.issues.map((it, i) => `
      <div class="tsrow"><div><b>${it.title}</b> <span class="tscount">${it.objs.length}</span><div class="note">${it.desc}</div></div>
      <div class="row tight" style="margin:0"><button class="small" data-sel="${i}">Select</button>${it.fix ? `<button class="small primary" data-fix="${i}">${it.fixLabel}</button>` : ''}</div></div>`).join('')
      : '<div class="tsok">✓ No problems found</div>');
    $$('[data-sel]', body).forEach(b => b.onclick = () => { const it = r.issues[+b.dataset.sel]; S.sel.clear(); it.objs.forEach(o => S.sel.add(o.id)); commit(); run('zoomSel'); $('#modal')._close(); toast(`Selected ${it.objs.length}: ${it.title.toLowerCase()}`); });
    $$('[data-fix]', body).forEach(b => b.onclick = () => { const it = r.issues[+b.dataset.fix]; pushUndo(); it.fix(it.objs); S.sel.clear(); commit(); toast(`Fixed: ${it.title.toLowerCase()}`, 'ok'); draw(); });
    const fixAll = $('#modal footer .tsall'); if (fixAll) fixAll.disabled = !r.issues.some(x => x.fix);
  };
  modal({ title: 'Vector troubleshooter', body, width: 620, buttons: [
    { label: 'Fix all', cls: 'tsall', onClick: () => { const r = scanVectors(); const f = r.issues.filter(x => x.fix); if (!f.length) return false; pushUndo(); f.forEach(it => it.fix(it.objs)); S.sel.clear(); commit(); toast(`Fixed ${f.length} kind(s) of problem`, 'ok'); draw(); return false; } },
    { label: 'Scan again', onClick: () => { draw(); return false; } }, { label: 'Close', cls: 'primary' }] });
  draw();
}


// ---------------------------------------------------------------- finger joint box builder
function boxDialog() {
  const st = { style: 'finger', w: 100, d: 80, h: 60, inside: false, t: 3, finger: 10, kerf: 0.15, lid: 'fixed', divX: 0, divY: 0, r: 20, hsp: 1.6, labels: true, gap: 4, ...JSON.parse(localStorage.getItem('bf.box') || '{}') };
  if (st.open !== undefined && !st.lidSet) { st.lid = st.open ? 'open' : 'fixed'; }
  const body = document.createElement('div'); body.className = 'bxwrap';
  body.innerHTML = `<div><canvas id="bxPv" width="420" height="340"></canvas>
      <div class="row tight"><button class="small" id="bx3d">3D view</button><button class="small" id="bxFlat">Cut layout</button><span class="grow"></span><span class="note">drag to turn</span></div>
      <div class="note" id="bxInfo"></div></div>
    <div class="form bxform">
      <label>Box style</label><select id="bxStyle"><option value="finger">Finger-joint box</option><option value="flex">Rounded box (living-hinge sides)</option></select>
      <h5>Size</h5>
      <label>Width × depth × height</label><div class="row tight" style="margin:0"><input type="text" id="bxW" style="width:56px"><input type="text" id="bxD" style="width:56px"><input type="text" id="bxH" style="width:56px"></div>
      <label class="bf-f">Measured</label><select class="bf-f" id="bxIn"><option value="0">Outside (overall size)</option><option value="1">Inside (space inside the box)</option></select>
      <label>Lid</label><select id="bxLid"><option value="fixed">Fixed top (closed box)</option><option value="open">No lid (open top)</option><option value="liftoff" class="bf-fo">Lift-off lid with a lip</option><option value="sliding" class="bf-fo">Sliding lid (slides out of the front)</option><option value="hinged" class="bf-fo">Hinged lid (pivot pins, opens to 120°)</option></select>
      <label class="bf-f">Dividers across / along</label><div class="bf-f row tight" style="margin:0"><input type="text" id="bxDX" style="width:44px" title="Dividers across the width (makes compartments left-to-right)"><input type="text" id="bxDY" style="width:44px" title="Dividers along the depth (front-to-back compartments)"><span class="note">0 = none</span></div>
      <label class="bf-x">Corner radius (mm)</label><input class="bf-x" type="text" id="bxR">
      <label class="bf-x">Hinge slit spacing (mm)</label><input class="bf-x" type="text" id="bxHS" title="Smaller = bends more easily but is weaker. 1.5–2 mm suits 3 mm plywood.">
      <h5>Material &amp; joints</h5>
      <label>Thickness · finger width</label><div class="row tight" style="margin:0"><input type="text" id="bxT" style="width:56px"><input type="text" id="bxF" style="width:56px"></div>
      <label>Kerf / fit (mm)</label><input type="text" id="bxK" title="Width of the laser cut. Bigger = tighter joints. Typical 0.1–0.2 mm on a 10 W diode; measure with the test joint.">
      <h5>Output</h5>
      <label>Engrave panel names</label><input type="checkbox" id="bxLbl">
      <label>Arrange pieces</label><select id="bxArr"><option value="nest">Nest tightly — least material</option><option value="rows">Neat rows</option></select>
      <label>Gap between panels (mm)</label><input type="text" id="bxGap">
      <div class="full note">Cut the <b>test joint</b> first — loose: raise Kerf; won't go together: lower it. <span class="bf-x">Living hinges bend best in 3 mm plywood or MDF; the wall is glued where its two ends meet.</span></div>
    </div>`;
  const q = (id) => $(id, body);
  const fields = { bxW: 'w', bxD: 'd', bxH: 'h', bxT: 't', bxF: 'finger', bxK: 'kerf', bxGap: 'gap', bxDX: 'divX', bxDY: 'divY', bxR: 'r', bxHS: 'hsp' };
  for (const [id, k] of Object.entries(fields)) q('#' + id).value = st[k];
  q('#bxIn').value = st.inside ? '1' : '0'; q('#bxLid').value = st.lid; q('#bxLbl').checked = st.labels; q('#bxStyle').value = st.style; q('#bxArr').value = st.arrange || 'nest';
  let view = 'iso', yaw = 35, box = null, flex = null, err = '';
  const pieces = () => box ? box.panels : flex ? flex.pieces : [];
  const draw = () => {
    const c = q('#bxPv'), x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#23262b'; x.fillRect(0, 0, c.width, c.height);
    if (!box && !flex) { x.fillStyle = '#ff8a8a'; x.font = '13px -apple-system'; x.fillText(err || '—', 16, 30); return; }
    if (view === 'iso' && box) { box.t = st.t; BoxMaker.drawIso(x, box, c.width, c.height, { yaw }); return; }
    if (view === 'iso' && flex) { drawFlexIso(x, flex, st, c.width, c.height, yaw); return; }
    const lay = layoutPanels(pieces(), st.gap); const k = Math.min((c.width - 20) / lay.w, (c.height - 20) / lay.h);
    x.translate((c.width - lay.w * k) / 2, (c.height + lay.h * k) / 2); x.scale(k, -k);
    x.lineWidth = 1 / k; x.strokeStyle = '#ffa45c'; x.fillStyle = 'rgba(255,164,92,.08)';
    for (const p of lay.items) {
      x.beginPath(); for (const l of p.loops) { l.forEach(([u, v], i) => i ? x.lineTo(u + p.x, v + p.y) : x.moveTo(u + p.x, v + p.y)); x.closePath(); } x.fill('evenodd'); x.stroke();
      if (p.cuts) { x.beginPath(); for (const cpath of p.cuts) { x.moveTo(cpath.pts[0] + p.x, cpath.pts[1] + p.y); x.lineTo(cpath.pts[2] + p.x, cpath.pts[3] + p.y); } x.stroke(); }
    }
  };
  const sync = () => {
    for (const [id, k] of Object.entries(fields)) { const v = evalNum(q('#' + id).value); if (!isNaN(v)) st[k] = v; }
    st.inside = q('#bxIn').value === '1'; st.lid = q('#bxLid').value; st.lidSet = true; st.labels = q('#bxLbl').checked; st.style = q('#bxStyle').value; st.arrange = q('#bxArr').value;
    $$('.bf-f', body).forEach(e => e.style.display = st.style === 'finger' ? '' : 'none'); $$('.bf-x', body).forEach(e => e.style.display = st.style === 'flex' ? '' : 'none');
    q('#bxLid').querySelectorAll('.bf-fo').forEach(e => e.disabled = st.style !== 'finger'); if (st.style !== 'finger' && !['fixed', 'open'].includes(st.lid)) { st.lid = 'fixed'; q('#bxLid').value = 'fixed'; }
    box = flex = null;
    try {
      if (st.t <= 0 || st.finger <= 0) throw new Error('Thickness and finger width must be above 0');
      if (st.finger < st.t) throw new Error('Fingers narrower than the material are fragile — use at least ' + st.t + ' mm');
      if (st.style === 'flex') {
        flex = BoxMaker.buildFlex({ w: st.w, d: st.d, h: st.h, t: st.t, r: st.r, kerf: st.kerf, open: st.lid === 'open', finger: st.finger, hinge: { spacing: st.hsp } }); err = '';
        q('#bxInfo').innerHTML = `Outside <b>${n2(st.w)} × ${n2(st.d)} × ${n2(st.h)}</b> mm · corner radius ${n2(flex.r)} mm<br>Wall strip ${n2(flex.wallLength)} mm long${flex.tabs ? '' : ' · <b>no straight sides for tabs — glue the base in</b>'}${flex.wallLength > S.device.width ? ` — <b style="color:#ff8a8a">longer than the ${S.device.width} mm work area; make the box smaller</b>` : ''}`;
      } else {
        box = BoxMaker.build({ ...st, open: st.lid !== 'fixed' }); err = '';
        const o = box.outer, i = box.inner, nd = (st.divX | 0) + (st.divY | 0);
        q('#bxInfo').innerHTML = `Outside <b>${n2(o.W)} × ${n2(o.D)} × ${n2(o.H)}</b> mm · inside ${n2(i.w)} × ${n2(i.d)} × ${n2(i.h)} mm<br>${box.panels.length} pieces${nd ? ` · ${((st.divX | 0) + 1) * ((st.divY | 0) + 1)} compartments` : ''}` +
          (st.lid === 'sliding' ? '<br>The lid slides in from the front through slots in the sides, under a crossbar. Pull it out with the finger notch.' : '') +
          (st.lid === 'hinged' ? '<br>The lid turns on square pegs in round holes in the sides. Put the lid in place <b>before</b> gluing the second side. Opens to about 120°.' : '');
      }
    } catch (e) { box = flex = null; err = e.message; q('#bxInfo').textContent = ''; }
    draw();
  };
  body.oninput = sync; body.onchange = sync;
  q('#bx3d').onclick = () => { view = 'iso'; draw(); }; q('#bxFlat').onclick = () => { view = 'flat'; draw(); };
  let dr = null; const pv = q('#bxPv'); pv.style.cursor = 'grab';
  pv.onmousedown = (e) => { dr = { x: e.clientX, yaw }; view = 'iso'; };
  const mv = (e) => { if (dr) { yaw = dr.yaw + (e.clientX - dr.x) * 0.5; draw(); } }, up = () => dr = null;
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  sync();
  const save = () => localStorage.setItem('bf.box', JSON.stringify(st));
  modal({ title: 'Box builder', body, width: 920, onClose: () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }, buttons: [
    { label: 'Make test joint', onClick: () => { if (!box && !flex) return false; save(); placeBox(BoxMaker.testJoint(st), 'Test joint', st); return true; } },
    { label: 'Cancel' },
    { label: 'Create box', cls: 'primary', onClick: () => { if (!box && !flex) { toast(err, 'err'); return false; } save(); placeBox(pieces(), box ? `Box ${n2(box.outer.W)}×${n2(box.outer.D)}×${n2(box.outer.H)}` : `Rounded box ${n2(st.w)}×${n2(st.d)}×${n2(st.h)}`, st); } }] });
}
function drawFlexIso(x, f, st, cw, ch, yawDeg) {
  const { W, D, H } = f.outer, r = f.r, yaw = yawDeg * Math.PI / 180;
  const ring = []; const seg = 10;
  const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(W - r, r, -Math.PI / 2); corner(W - r, D - r, 0); corner(r, D - r, Math.PI / 2); corner(r, r, Math.PI);
  const proj = ([px, py, pz]) => { px -= W / 2; py -= D / 2; const xr = px * Math.cos(yaw) - py * Math.sin(yaw), yr = px * Math.sin(yaw) + py * Math.cos(yaw); return [xr, -yr * 0.5 - pz * 0.9, yr]; };
  const all = ring.flatMap(([a, b]) => [proj([a, b, 0]), proj([a, b, H])]);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const k = Math.min((cw - 40) / (Math.max(...xs) - Math.min(...xs)), (ch - 40) / (Math.max(...ys) - Math.min(...ys))), ox = cw / 2 - (Math.max(...xs) + Math.min(...xs)) / 2 * k, oy = ch / 2 - (Math.max(...ys) + Math.min(...ys)) / 2 * k;
  const P = (p) => [ox + p[0] * k, oy + p[1] * k];
  // wall quads, back to front
  const quads = ring.map((p, i) => { const q2 = ring[(i + 1) % ring.length]; const pts = [[p[0], p[1], 0], [q2[0], q2[1], 0], [q2[0], q2[1], H], [p[0], p[1], H]].map(proj); return { pts, d: pts.reduce((a, b) => a + b[2], 0) / 4, curved: i % (seg + 1) !== seg }; });
  quads.sort((a, b) => b.d - a.d);
  for (const qd of quads) { x.beginPath(); qd.pts.forEach((p, i) => { const [a, b] = P(p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.fillStyle = qd.curved ? '#c08a55' : '#c8955c'; x.fill(); x.strokeStyle = 'rgba(58,38,20,.25)'; x.stroke(); }
  if (st.lid !== 'open') { x.beginPath(); ring.forEach((p, i) => { const [a, b] = P(proj([p[0], p[1], H])); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.fillStyle = '#a07a4e'; x.fill(); x.strokeStyle = '#3a2614'; x.stroke(); }
}
function layoutPanels(panels, gap) {
  // simple shelf packing, biggest first, rows no wider than the work area
  const items = panels.map(p => ({ ...p })).sort((a, b) => b.h - a.h || b.w - a.w);
  const maxW = Math.max(S.device.width - 10, ...items.map(p => p.w));
  let x = 0, y = 0, rowH = 0, w = 0;
  for (const p of items) {
    if (x > 0 && x + p.w > maxW) { x = 0; y += rowH + gap; rowH = 0; }
    p.x = x; p.y = y; x += p.w + gap; rowH = Math.max(rowH, p.h); w = Math.max(w, x - gap);
  }
  return { items, w, h: y + rowH };
}
async function placeBox(panels, title, st) {
  const lay = layoutPanels(panels, st.gap || 4), nestIt = st.arrange !== 'rows' && panels.length > 1;
  const ox = Math.max(2, (S.device.width - lay.w) / 2), oy = Math.max(2, (S.device.height - lay.h) / 2);
  const gid = uid(), cut = S.doc.layers[S.curLayer].mode === 'line' ? S.curLayer : (() => { const li = freeLayer(S.curLayer + 1); S.doc.layers[li].mode = 'line'; return li; })(), objs = [];
  let lblLayer = null;
  for (const p of lay.items) {
    const pg = nestIt ? uid() : gid; // while nesting each panel (with its label) moves on its own
    objs.push({ type: 'path', paths: p.loops.map(l => ({ pts: l.flat(), closed: true })).concat((p.cuts || []).map(c => ({ pts: c.pts.slice(), closed: false }))), m: G.translate(ox + p.x, oy + p.y), layer: cut, groupId: pg, boxPanel: p.name });
    if (st.labels) {
      const size = Math.max(3, Math.min(8, Math.min(p.w, p.h) / 6));
      const tp = { text: p.name.toUpperCase(), font: 'Helvetica', size, bold: true, italic: false, align: 'center', spacing: 0 };
      const paths = Trace.textToPaths(tp); const b = G.pathsBox(paths);
      if (lblLayer === null) { lblLayer = freeLayer(cut + 1); Object.assign(S.doc.layers[lblLayer], { mode: 'fill', speed: 3000, maxPower: 25, passes: 1, interval: 0.1, name: 'Labels' }); }
      objs.push({ type: 'text', textProps: tp, paths, m: G.translate(ox + p.x + (p.w - (b.x1 - b.x0)) / 2, oy + p.y + (p.h - (b.y1 - b.y0)) / 2), layer: lblLayer, groupId: objs[objs.length - 1].groupId });
    }
  }
  pushUndo(); addObjects(objs); commit();
  let nested = false;
  if (nestIt) {
    toast('Arranging the pieces to use the least material…');
    try { await doNest({ into: 'area', mode: 'pack', padding: Math.max(0.5, st.gap ?? 4), edge: 2, rot: 90, lockInner: true, overflow: 'leave', level: 0, quiet: true }, null, objs, () => {}, () => false, () => false); nested = true; }
    catch (e) { console.error(e); }
    objs.forEach(o => o.groupId = gid); commit();
  }
  run('zoomSel');
  const nb = boxOf(objs);
  if (nested) { lay.w = nb.x1 - nb.x0; lay.h = nb.y1 - nb.y0; }
  const over = lay.w > S.device.width || lay.h > S.device.height;
  toast(`${title}: ${panels.length} panel(s) on layer C${pad2(cut)}${lblLayer !== null ? `, names on C${pad2(lblLayer)} (engrave)` : ''}${over ? ' — bigger than the work area, use Nest or split across pages' : ''}`, over ? 'err' : 'ok');
}

// ---------------------------------------------------------------- right-click menu
function hideCtx() { $$('.ctxmenu').forEach(m => m.remove()); }
function openCtxAt(e, sx, sy) {
  const w = s2w(sx, sy); S.ctxWorld = w;
  if (S.tool !== 'select') setTool('select');
  const o = hitObject(...w);
  if (o && !S.sel.has(o.id)) { S.sel.clear(); S.sel.add(o.id); if (!(isMac ? e.metaKey : e.ctrlKey)) expandGroups(); commit(); }
  showCtx(e.clientX, e.clientY);
}
function showCtx(x, y) {
  hideCtx();
  const sel = selObjs(), n = sel.length, has = n > 0;
  const ctxHit = S.ctxWorld ? hitObject(...S.ctxWorld) : null;
  const grouped = sel.some(o => o.groupId), units = groupUnits(sel).length;
  const vec = sel.filter(o => o.type !== 'image'), img = sel.find(o => o.type === 'image'), txt = sel.some(o => o.type === 'text');
  const k = (m) => (isMac ? m.replace('Mod', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : m.replace('Mod', 'Ctrl').replace(/\+/g, '+'));
  const items = [
    { label: `${n} selected${grouped ? ' · grouped' : ''}`, header: true, show: has },
    { label: 'Group', key: k('Mod+G'), cmd: 'group', on: units >= 2 },
    { label: 'Ungroup', key: k('Shift+Mod+G'), cmd: 'ungroup', on: grouped },
    { sep: true },
    { label: 'Cut', key: k('Mod+X'), cmd: 'cut', on: has },
    { label: 'Copy', key: k('Mod+C'), cmd: 'copy', on: has },
    { label: 'Paste here', cmd: 'pasteHere', on: !!S.clip },
    { label: 'Paste in place', cmd: 'pasteInPlace', on: !!S.clip },
    { label: 'Duplicate', key: k('Mod+D'), cmd: 'duplicate', on: has },
    { label: 'Delete', key: '⌫', cmd: 'delete', on: has },
    { sep: true },
    { label: 'Transform', on: has, sub: [
      { label: 'Mirror horizontally', cmd: 'mirrorH' }, { label: 'Mirror vertically', cmd: 'mirrorV' },
      { label: 'Rotate 90° right', key: k('Mod+]'), cmd: 'rotCW' }, { label: 'Rotate 90° left', key: k('Mod+['), cmd: 'rotCCW' },
      { sep: true }, { label: 'Move to centre of work area', cmd: 'centerPage' }] },
    { label: 'Align', on: units >= 2, sub: [
      { label: 'Left', cmd: 'alignL' }, { label: 'Centres horizontally', cmd: 'alignCH' }, { label: 'Right', cmd: 'alignR' },
      { sep: true }, { label: 'Top', cmd: 'alignT' }, { label: 'Centres vertically', cmd: 'alignCV' }, { label: 'Bottom', cmd: 'alignB' },
      { sep: true }, { label: 'Distribute horizontally', cmd: 'distH', on: units >= 3 }, { label: 'Distribute vertically', cmd: 'distV', on: units >= 3 }] },
    { label: 'Save this test setting…', show: !!(ctxHit && ctxHit.testCell), fn: () => Makers.saveTestCell(ctxHit) },
    { label: 'Nest parts…', cmd: 'nest', on: S.doc.objects.length > 0 },
    { label: 'Auto-arrange (optimise)', cmd: 'autoArrange', on: S.doc.objects.length > 0 },
    { label: 'Box builder…', cmd: 'boxBuilder' },
    { label: 'Order', on: has, sub: [{ label: 'Bring to front', cmd: 'toFront' }, { label: 'Send to back', cmd: 'toBack' }] },
    { label: 'Vector troubleshooter…', cmd: 'troubleshoot', on: S.doc.objects.length > 0 },
    { label: 'Shape tools', on: vec.length > 0, sub: [
      { label: 'Weld / union', cmd: 'weld' }, { label: 'Subtract', cmd: 'subtract', on: vec.length >= 2 }, { label: 'Intersect', cmd: 'intersect', on: vec.length >= 2 },
      { label: 'Offset…', cmd: 'offset' }, { label: 'Grid array…', cmd: 'array' }, { label: 'Close / join paths…', cmd: 'closePaths' },
      { label: 'Convert text to path', cmd: 'toPath', on: txt }] },
    { label: '3D model settings…', cmd: 'modelSettings', show: !!(img && img.model) },
    { label: 'Convert 3D model to bitmap', cmd: 'modelToBitmap', show: !!(img && img.model) },
    { label: 'Image', show: !!img, sub: [{ label: 'Adjust image…', cmd: 'imageAdjust' }, { label: 'Trace to vectors…', cmd: 'trace' }, { label: 'Grid array…', cmd: 'array' }] },
    { label: 'Move to layer', on: has, layers: true },
    { label: 'Move to page', on: has, show: S.doc.pages.length > 1, sub: S.doc.pages.map((p, i) => ({ label: p.name + (i === S.doc.page ? ' (this page)' : ''), on: i !== S.doc.page, fn: () => moveSelToPage(i) })) },
    { sep: true },
    { label: 'Select all', key: k('Mod+A'), cmd: 'selectAll', on: S.doc.objects.length > 0 },
    { label: 'Select all on this layer', cmd: 'selectLayer', on: has },
    { label: 'Invert selection', cmd: 'invertSel', on: S.doc.objects.length > 0 },
    { label: 'Zoom to selection', cmd: 'zoomSel', on: has },
    { label: 'Zoom to work area', key: k('Mod+0'), cmd: 'zoomFit' },
  ];
  const build = (list, isSub) => {
    const m = document.createElement('div'); m.className = 'ctxmenu' + (isSub ? ' sub' : '');
    let lastSep = true;
    for (const it of list) {
      if (it.show === false) continue;
      if (it.sep) { if (!lastSep) { m.insertAdjacentHTML('beforeend', '<div class="csep"></div>'); lastSep = true; } continue; }
      lastSep = false;
      const el = document.createElement('div');
      if (it.header) { el.className = 'chead'; el.textContent = it.label; m.appendChild(el); continue; }
      const on = it.on !== false;
      el.className = 'citem' + (on ? '' : ' off') + (it.sub || it.layers ? ' hassub' : '');
      el.innerHTML = `<span>${it.label}</span><span class="ckey">${it.key || (it.sub || it.layers ? '›' : '')}</span>`;
      if (on && it.cmd) el.onclick = (ev) => { ev.stopPropagation(); hideCtx(); run(it.cmd); };
      if (on && it.fn) el.onclick = (ev) => { ev.stopPropagation(); hideCtx(); it.fn(); };
      if (on && (it.sub || it.layers)) {
        el.onmouseenter = () => {
          $$('.ctxmenu.sub', m.parentElement || document).forEach(x => x.remove());
          let sm;
          if (it.layers) {
            sm = document.createElement('div'); sm.className = 'ctxmenu sub layers';
            PALETTE.forEach((c, i) => { const d = document.createElement('div'); d.className = 'cswatch'; d.style.background = c; d.title = `C${pad2(i)}${S.doc.layerOrder.includes(i) ? ' — ' + S.doc.layers[i].name : ''}`; d.textContent = pad2(i); d.onclick = (ev) => { ev.stopPropagation(); hideCtx(); assignLayer(i); }; sm.appendChild(d); });
          } else sm = build(it.sub, true);
          document.body.appendChild(sm);
          const r = el.getBoundingClientRect(), sr = sm.getBoundingClientRect();
          let left = r.right - 2; if (left + sr.width > window.innerWidth - 4) left = r.left - sr.width + 2;
          let top = r.top - 4; if (top + sr.height > window.innerHeight - 4) top = window.innerHeight - sr.height - 4;
          sm.style.left = left + 'px'; sm.style.top = Math.max(4, top) + 'px';
        };
      } else el.onmouseenter = () => { if (!isSub) $$('.ctxmenu.sub').forEach(x => x.remove()); };
      m.appendChild(el);
    }
    if (m.lastChild && m.lastChild.className === 'csep') m.lastChild.remove();
    return m;
  };
  const menu = build(items, false); document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
}
window.addEventListener('mousedown', (e) => { if (!e.target.closest('.ctxmenu')) hideCtx(); }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); }, true);
window.addEventListener('blur', hideCtx);

// ---------------------------------------------------------------- keyboard
const typing = () => { const a = document.activeElement; return a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName)); };
window.addEventListener('keydown', (e) => {
  if (modalOpen()) { if (e.key === 'Escape') $('#modal')._close(); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (typing()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (mod && !NATIVE) { // browser fallback (Electron uses the app menu accelerators)
    const k = e.key.toLowerCase(); const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', c: 'copy', v: 'paste', x: 'cut', d: 'duplicate', a: 'selectAll', g: e.shiftKey ? 'ungroup' : 'group', s: 'save', o: 'open', i: 'import', n: 'new', 0: 'zoomFit', '=': 'zoomIn', '-': 'zoomOut', e: 'exportGcode' };
    if (map[k]) { e.preventDefault(); run(map[k]); }
    return;
  }
  if (mod) return;
  if (e.key === ' ') { S.space = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Escape') { if (S.line) { S.line = null; } S.sel.clear(); S.measure = null; setTool('select'); commit(); return; }
  if (e.key === 'Enter' && S.line) { finishLine(false); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { run('delete'); e.preventDefault(); return; }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault(); const st = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowDown' ? -st : e.key === 'ArrowUp' ? st : 0;
    if (S.sel.size) transformSel(G.translate(dx, dy));
    else if (!$('#tab-move').classList.contains('hidden') && grbl.connected) { const step = +$('#jogStep').value; grbl.jog(Math.sign(dx) * step, Math.sign(dy) * step, 0, +$('#jogFeed').value || 3000); }
    return;
  }
  const tools = { v: 'select', h: 'pan', r: 'rect', e: 'ellipse', p: 'polygon', l: 'line', t: 'text', m: 'measure' };
  if (e.altKey && e.code === 'KeyP') { run('preview'); return; }
  if (tools[e.key.toLowerCase()]) setTool(tools[e.key.toLowerCase()]);
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; cv.style.cursor = S.tool === 'pan' ? 'grab' : 'default'; } });

// ---------------------------------------------------------------- numeric bar
function buildAnchor(el, get, set) {
  el.innerHTML = '';
  for (const r of ['t', 'm', 'b']) for (const c of ['l', 'c', 'r']) {
    const s = document.createElement('span'); s.dataset.a = r + c; s.title = r + c;
    s.onclick = () => { set(r + c); [...el.children].forEach(x => x.classList.toggle('on', x.dataset.a === get())); updateNumbar(); };
    el.appendChild(s);
  }
  [...el.children].forEach(x => x.classList.toggle('on', x.dataset.a === get()));
}
function anchorPt(b, a) {
  return [a[1] === 'l' ? b.x0 : a[1] === 'r' ? b.x1 : (b.x0 + b.x1) / 2, a[0] === 'b' ? b.y0 : a[0] === 't' ? b.y1 : (b.y0 + b.y1) / 2];
}
function updateNumbar() {
  const objs = selObjs(), has = objs.length > 0;
  ['#nX', '#nY', '#nW', '#nH', '#nR'].forEach(id => $(id).disabled = !has);
  if (has) {
    const b = boxOf(objs), [ax, ay] = anchorPt(b, S.selAnchor);
    if (document.activeElement !== $('#nX')) $('#nX').value = n2(ax);
    if (document.activeElement !== $('#nY')) $('#nY').value = n2(ay);
    if (document.activeElement !== $('#nW')) $('#nW').value = n2(b.x1 - b.x0);
    if (document.activeElement !== $('#nH')) $('#nH').value = n2(b.y1 - b.y0);
  } else ['#nX', '#nY', '#nW', '#nH'].forEach(id => $(id).value = '');
  const texts = objs.filter(o => o.type === 'text');
  $('#textProps').classList.toggle('hidden', !(texts.length === 1 && objs.every(o => o.groupId ? o.groupId === texts[0].groupId : o === texts[0])));
  if (texts.length === 1) {
    const tp = texts[0].textProps;
    if (document.activeElement !== $('#tText')) $('#tText').value = tp.text;
    ensureFontOption(tp.font); $('#tFont').value = tp.font; $('#tSize').value = tp.size; $('#tAlign').value = tp.align; $('#tSpacing').value = tp.spacing;
    $('#tBold').classList.toggle('on', tp.bold); $('#tItalic').classList.toggle('on', tp.italic);
    const ls = Math.max(1, Math.round(tp.text.split('\n').length)); $('#tText').style.height = (8 + 16 * Math.min(ls, 4)) + 'px';
  }
  $('#sSel').textContent = has ? `${objs.length} selected` : '';
}
function numEdit() {
  const objs = selObjs(); if (!objs.length) return;
  const b = boxOf(objs), [ax, ay] = anchorPt(b, S.selAnchor);
  const X = +$('#nX').value, Y = +$('#nY').value; let W = +$('#nW').value, H = +$('#nH').value;
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  let sx = bw > 1e-6 && W > 0 ? W / bw : 1, sy = bh > 1e-6 && H > 0 ? H / bh : 1;
  if (S.lock) { const which = this === $('#nH') ? sy : sx; sx = sy = which; }
  let M = G.scale(sx, sy, ax, ay); M = G.mul(G.translate(X - ax, Y - ay), M);
  transformSel(M);
}

// ---------------------------------------------------------------- number entry: formulas, units, comma decimals
// e.g. "25.4*2", "1in", "3 cm + 5", "10,5", "100/3", "2ft"  → millimetres
function evalNum(str) {
  if (typeof str === 'number') return str;
  let t = String(str).trim().replace(/[  \s]/g, '');
  if (!t) return NaN;
  if (/^-?\d+,\d+$/.test(t) || (/,/.test(t) && !/\./.test(t) && !/\d,\d{3}(\D|$)/.test(t))) t = t.replace(/,/g, '.'); else t = t.replace(/,/g, '');
  const U = { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4, inch: 25.4, inches: 25.4, ft: 304.8, "'": 304.8, pt: 25.4 / 72, px: 25.4 / 96, deg: 1, '°': 1 };
  const toks = t.toLowerCase().match(/\d*\.?\d+(?:e[-+]?\d+)?(?:mm|cm|inches|inch|in|ft|pt|px|deg|m|"|'|°)?|[-+*/()^]/g);
  if (!toks || toks.join('') !== t.toLowerCase()) return NaN;
  let i = 0;
  const num = () => { const k = toks[i++]; const m = k.match(/^(\d*\.?\d+(?:e[-+]?\d+)?)(.*)$/); return parseFloat(m[1]) * (m[2] ? U[m[2]] : 1); };
  const atom = () => { const k = toks[i]; if (k === '-') { i++; return -atom(); } if (k === '+') { i++; return atom(); } if (k === '(') { i++; const v = expr(); if (toks[i++] !== ')') throw 0; return v; } if (k === undefined || /[*/^)]/.test(k)) throw 0; return num(); };
  const pow = () => { let v = atom(); while (toks[i] === '^') { i++; v = Math.pow(v, atom()); } return v; };
  const term = () => { let v = pow(); while (toks[i] === '*' || toks[i] === '/') { const op = toks[i++]; const r = pow(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  try { const v = expr(); return i === toks.length && isFinite(v) ? v : NaN; } catch { return NaN; }
}
// let the size/position boxes accept formulas: evaluate on Enter / leaving the box
['#nX', '#nY', '#nW', '#nH', '#nR'].forEach(id => {
  const el = $(id); el.type = 'text'; el.inputMode = 'decimal'; el.spellcheck = false; el.title = 'Type a number, a formula (e.g. 25.4*2, 100/3) or a unit (1in, 3cm)';
  el.addEventListener('change', (e) => {
    const v = evalNum(el.value);
    if (isNaN(v)) { e.stopImmediatePropagation(); toast(`“${el.value}” isn't a number or formula`, 'err'); updateNumbar(); return; }
    el.value = String(Math.round(v * 1000) / 1000);
  }, true);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
});

['#nX', '#nY', '#nW', '#nH'].forEach(id => $(id).addEventListener('change', numEdit));
$('#nR').addEventListener('change', () => {
  const a = +$('#nR').value; if (!a) return; const b = selBox(); transformSel(G.rotate(a, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)); $('#nR').value = 0;
});
$('#nLock').onclick = () => { S.lock = !S.lock; $('#nLock').classList.toggle('on', S.lock); };
buildAnchor($('#selAnchor'), () => S.selAnchor, a => S.selAnchor = a);
buildAnchor($('#jobAnchor'), () => S.jobAnchor, a => { S.jobAnchor = a; });

// text editing
const FALLBACK_FONTS = ['Arial', 'Arial Black', 'Helvetica', 'Helvetica Neue', 'Avenir', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Impact', 'Times New Roman', 'Georgia', 'Baskerville', 'Didot', 'Palatino', 'Hoefler Text', 'Rockwell', 'Copperplate', 'American Typewriter', 'Courier New', 'Menlo', 'Monaco', 'Chalkboard', 'Marker Felt', 'Noteworthy', 'Bradley Hand', 'Brush Script MT', 'Snell Roundhand', 'Zapfino', 'Savoye LET', 'Papyrus', 'Herculanum', 'Luminari', 'Phosphate', 'Comic Sans MS', 'DejaVu Sans', 'Liberation Sans'];
let fontsQueried = false;
function fillFonts(list) { const sel = $('#tFont'), cur = sel.value; sel.innerHTML = ''; [...new Set(list)].sort((a, b) => a.localeCompare(b)).forEach(f => { const o = document.createElement('option'); o.value = o.textContent = f; sel.appendChild(o); }); if (cur) { ensureFontOption(cur); sel.value = cur; } }
function ensureFontOption(f) { const sel = $('#tFont'); if (![...sel.options].some(o => o.value === f)) { const o = document.createElement('option'); o.value = o.textContent = f; sel.appendChild(o); } }
fillFonts(FALLBACK_FONTS); $('#tFont').value = 'Arial';
$('#tFont').addEventListener('mousedown', async () => {
  if (fontsQueried || !window.queryLocalFonts) return; fontsQueried = true;
  try { const fonts = await window.queryLocalFonts(); if (fonts.length) fillFonts(FALLBACK_FONTS.concat(fonts.map(f => f.family))); } catch (e) { }
});
$('#tFontFile').onclick = async () => {
  const f = await pickFile('.ttf,.otf,.woff,.woff2', true); if (!f) return;
  const name = f.name.replace(/\.[^.]+$/, '');
  try { const ff = new FontFace(name, f.data.buffer); await ff.load(); document.fonts.add(ff); ensureFontOption(name); $('#tFont').value = name; updateText(); toast(`Font “${name}” loaded`, 'ok'); }
  catch (e) { toast('Could not load font: ' + e.message, 'err'); }
};
let textUndoPushed = false;
async function updateText() {
  const t = selObjs().find(o => o.type === 'text'); if (!t) return;
  if (!textUndoPushed) { pushUndo(); textUndoPushed = true; setTimeout(() => textUndoPushed = false, 1500); }
  const tp = currentTextProps(); tp.text = $('#tText').value || ' ';
  try { await document.fonts.load(`${tp.size * 10}px "${tp.font}"`, tp.text); } catch (e) { }
  t.textProps = tp; t.paths = Trace.textToPaths(tp); commit();
}
$('#tText').addEventListener('input', updateText);
$('#tText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } });
['#tFont', '#tSize', '#tAlign', '#tSpacing'].forEach(id => $(id).addEventListener('change', updateText));
['#tBold', '#tItalic'].forEach(id => $(id).onclick = () => { $(id).classList.toggle('on'); updateText(); });

// ---------------------------------------------------------------- layers UI
const MODE_NAMES = { line: 'Line', fill: 'Fill', image: 'Image' };
function renderLayerList() {
  const el = $('#layerList'); el.innerHTML = '';
  const head = document.createElement('div'); head.className = 'lrow head';
  head.innerHTML = '<span></span><span>Layer</span><span>Mode</span><span>Spd/Pwr</span><span title="Passes">Pass</span><span title="Estimated time for this layer">Time</span><span title="Output">Out</span><span title="Show">Show</span>';
  el.appendChild(head);
  if (!S.doc.layerOrder.length) { el.insertAdjacentHTML('beforeend', '<div class="note empty">Draw or import something — layers appear here. Click a colour in the palette below to choose the layer for new shapes.</div>'); }
  for (const li of S.doc.layerOrder) {
    const L = S.doc.layers[li];
    const r = document.createElement('div'); r.className = 'lrow' + (S.selLayer === li ? ' sel' : '');
    r.title = L.preset ? 'Preset: ' + L.preset : '';
    r.innerHTML = `<span class="sw" style="background:${PALETTE[li]}"></span><span class="lname">${L.name}</span><span>${MODE_NAMES[L.mode]}</span><span>${L.speed}/${L.maxPower}%</span><span>${L.passes}</span><span class="ltime">${L.output ? (S.est && S.est.layers[li] !== undefined ? fmtTime(S.est.layers[li]) : '…') : '—'}</span><span class="ic ${L.output ? 'on' : ''}" data-t="output">${L.output ? '●' : '○'}</span><span class="ic ${L.show ? 'on' : ''}" data-t="show">${L.show ? '◉' : '◌'}</span>`;
    r.onclick = (e) => {
      const t = e.target.dataset.t;
      if (t) { L[t] = !L[t]; markDirty(); renderLayerList(); requestRender(); return; }
      S.selLayer = li; S.curLayer = li; renderLayerList();
      if (e.metaKey || e.ctrlKey) { S.sel.clear(); S.doc.objects.forEach(o => o.layer === li && S.sel.add(o.id)); commit(); }
    };
    r.ondblclick = () => editLayer(li);
    el.appendChild(r);
  }
  renderLayerQuick(); renderPalette();
}
function renderLayerQuick() {
  const q = $('#layerQuick'); const li = S.selLayer;
  if (li === null) { q.innerHTML = ''; return; }
  const L = S.doc.layers[li];
  q.innerHTML = `<label>Mode<select data-k="mode"><option value="line">Line</option><option value="fill">Fill</option><option value="image">Image</option></select></label>
    <label>Speed mm/min<input type="number" data-k="speed" min="1" step="10" value="${L.speed}"></label>
    <label>Max power %<input type="number" data-k="maxPower" min="0" max="100" step="1" value="${L.maxPower}"></label>`;
  $('select', q).value = L.mode;
  $$('[data-k]', q).forEach(inp => inp.onchange = () => { pushUndo(); const k = inp.dataset.k; L[k] = inp.type === 'number' ? +inp.value : inp.value; renderLayerList(); requestRender(); });
}
function renderPalette() {
  const p = $('#palette'); if (!p.children.length) {
    PALETTE.forEach((c, i) => {
      const d = document.createElement('div'); d.style.background = c; d.textContent = pad2(i); d.title = `Layer C${pad2(i)} — click to assign selection / set current layer`;
      d.onclick = () => assignLayer(i); p.appendChild(d);
    });
  }
  [...p.children].forEach((d, i) => d.style.outline = i === S.curLayer ? '2px solid #ffa45c' : '');
}
function assignLayer(i) {
  S.curLayer = i;
  const objs = selObjs();
  if (objs.length) {
    pushUndo();
    const L = S.doc.layers[i]; const fresh = !S.doc.objects.some(o => o.layer === i);
    objs.forEach(o => o.layer = i);
    if (fresh && objs.every(o => o.type === 'image')) { L.mode = 'image'; }
    else if (fresh && L.mode === 'image' && objs.some(o => o.type !== 'image')) L.mode = 'line';
    S.selLayer = i;
  }
  commit();
}
function editLayer(li) {
  const L = S.doc.layers[li];
  const f = document.createElement('div'); f.className = 'form';
  const modes = Object.entries(Raster.MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  f.innerHTML = `
    <label>Name</label><input type="text" data-k="name" value="${L.name}">
    <label>Mode</label><select data-k="mode"><option value="line">Line (cut / score along paths)</option><option value="fill">Fill (engrave inside shapes)</option><option value="image">Image (raster engrave)</option></select>
    <label>Speed (mm/min)</label><input type="number" data-k="speed" min="1" step="10">
    <label>Max power (%)</label><input type="number" data-k="maxPower" min="0" max="100" step="0.5">
    <label class="m-image">Min power (%)</label><input class="m-image" type="number" data-k="minPower" min="0" max="100" step="0.5">
    <label>Number of passes</label><input type="number" data-k="passes" min="1" max="100">
    <label>Z step per pass (mm)</label><input type="number" data-k="zStep" step="0.1" title="0 = off. Lowers Z by this much between passes (needs a Z axis)">
    <label>Air assist (M8)</label><input type="checkbox" data-k="air">
    <label>Constant power (M3)</label><input type="checkbox" data-k="constant" title="Off = dynamic power M4, which reduces power while accelerating (recommended)">
    <label>Output enabled</label><input type="checkbox" data-k="output">
    <h5 class="m-fill m-image">Scanning</h5>
    <label class="m-fill m-image">Line interval (mm)</label><div class="m-fill m-image row tight"><input type="number" data-k="interval" min="0.01" step="0.01" style="width:90px"><span class="note" id="dpiNote"></span></div>
    <label class="m-fill">Scan angle (°)</label><input class="m-fill" type="number" data-k="angle" step="1">
    <label class="m-fill">Cross-hatch</label><input class="m-fill" type="checkbox" data-k="crosshatch">
    <label class="m-fill m-image">Bi-directional</label><input class="m-fill m-image" type="checkbox" data-k="bidir">
    <label class="m-fill m-image">Overscan (mm)</label><input class="m-fill m-image" type="number" data-k="overscan" min="0" step="0.5">
    <h5 class="m-image">Image</h5>
    <label class="m-image">Image mode</label><select class="m-image" data-k="imageMode">${modes}</select>
    <label class="m-image m-ht">Halftone cell (px)</label><input class="m-image m-ht" type="number" data-k="halftoneCell" min="3" max="40">
    <label class="m-image m-ht">Halftone angle (°)</label><input class="m-image m-ht" type="number" data-k="halftoneAngle">
  `;
  const ins = $$('[data-k]', f);
  ins.forEach(i => { if (i.type === 'checkbox') i.checked = !!L[i.dataset.k]; else i.value = L[i.dataset.k]; });
  const vis = () => {
    const m = $('[data-k=mode]', f).value, im = $('[data-k=imageMode]', f).value;
    $$('.m-fill,.m-image', f).forEach(el => el.style.display = (el.classList.contains('m-' + m) && (!el.classList.contains('m-ht') || im === 'halftone')) ? '' : 'none');
    const iv = +$('[data-k=interval]', f).value; $('#dpiNote', f).textContent = iv > 0 ? `= ${Math.round(25.4 / iv)} DPI / LPI` : '';
  };
  f.oninput = vis; vis();
  modal({
    title: `Cut settings — ${L.name}`, body: f, width: 520, buttons: [
      { label: 'Library…', onClick: () => { setTimeout(() => openLibrary(li), 0); } },
      { label: 'Cancel' },
      { label: 'Apply to all used layers', onClick: () => { pushUndo(); for (const li2 of S.doc.layerOrder) { const t = S.doc.layers[li2]; ins.forEach(i => { if (['name', 'mode'].includes(i.dataset.k)) return; t[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value; }); } renderLayerList(); requestRender(); } },
      { label: 'OK', cls: 'primary', onClick: () => { pushUndo(); ins.forEach(i => L[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value); L.passes = Math.max(1, L.passes | 0); renderLayerList(); requestRender(); } }]
  });
}


// ---------------------------------------------------------------- material library
function applyPreset(li, e) {
  const L = S.doc.layers[li]; pushUndo();
  const hasImg = S.doc.objects.some(o => o.layer === li && o.type === 'image');
  const hasVec = S.doc.objects.some(o => o.layer === li && o.type !== 'image');
  Object.assign(L, JSON.parse(JSON.stringify(e.settings)));
  if (e.op === 'Engrave' && hasImg && !hasVec) L.mode = 'image';
  if (e.op === 'Photo' && hasVec && !hasImg) L.mode = 'fill';
  L.name = `${e.material.split(' (')[0]}${e.thickness ? ' ' + e.thickness : ''} ${e.op}`;
  L.preset = Library.label(e);
  renderLayerList(); requestRender();
  toast(`Layer ${pad2(li)} ← ${Library.label(e)} (${L.speed} mm/min, ${L.maxPower}%, ${L.passes} pass${L.passes > 1 ? 'es' : ''})`, 'ok');
}
function openLibrary(targetLayer = S.selLayer) {
  const body = document.createElement('div');
  const libs = Library.all();
  const st = { lib: localStorage.getItem('bf.lastLib') || libs[0].id, q: '', op: '', sel: null };
  if (!Library.get(st.lib)) st.lib = libs[0].id;
  body.innerHTML = `
    <div class="row wrap">
      <select id="lbLib">${libs.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select>
      <input id="lbQ" placeholder="Search material…" style="flex:1;min-width:140px" data-nofocus="1">
      <select id="lbOp"><option value="">All operations</option><option>Cut</option><option>Engrave</option><option>Photo</option><option>Score</option></select>
      <button class="small" id="lbImp">Import…</button><button class="small" id="lbExp">Export…</button>
    </div>
    <div class="row tight"><span class="note" id="lbTarget"></span><span class="grow"></span><button class="small" id="lbDev" title="Set work area 400 × 415 mm and Max S 1000">Use Falcon 10W work area</button></div>
    <div id="lbTable" class="libtable"></div>
    <div id="lbInfo" class="note" style="min-height:34px;margin-top:8px"></div>
    <div class="note" style="margin-top:4px">Settings are starting points — materials vary. Run a small test grid on scrap first, focus the laser properly and never leave it unattended.
      <b>Never laser PVC, vinyl, or chlorinated plastics</b> (toxic, corrosive gas). <span class="src-c">●</span> Creality official &nbsp;<span class="src-m">●</span> Community</div>`;
  const tbl = $('#lbTable', body);
  const targetTxt = () => $('#lbTarget', body).textContent = targetLayer !== null && targetLayer !== undefined ? `Applies to layer C${pad2(targetLayer)} (${S.doc.layers[targetLayer].name})` : 'Select a layer in the Cuts list first to apply a preset.';
  const draw = () => {
    const lib = Library.get(st.lib); const q = st.q.toLowerCase();
    const rows = lib.entries.filter(e => (!st.op || e.op === st.op) && (!q || (e.material + ' ' + e.notes).toLowerCase().includes(q)))
      .sort((a, b) => a.material.localeCompare(b.material) || a.thickness - b.thickness || a.op.localeCompare(b.op));
    tbl.innerHTML = `<div class="lbrow head"><span>Material</span><span>Thick.</span><span>Operation</span><span>Speed</span><span>Power</span><span>Passes</span><span></span></div>` +
      (rows.length ? rows.map(e => `<div class="lbrow${st.sel === e.id ? ' sel' : ''}" data-id="${e.id}" title="${(e.notes || '').replace(/"/g, '&quot;')}"><span>${e.material}</span><span>${e.thickness ? e.thickness + ' mm' : '—'}</span><span class="op op-${e.op}">${e.op}</span><span>${e.settings.speed}</span><span>${e.settings.maxPower}%</span><span>${e.settings.passes}</span><span class="${e.source === 'Creality' ? 'src-c' : 'src-m'}" title="${e.source === 'Creality' ? 'Creality official' : e.source}">●</span></div>`).join('')
        : `<div class="note" style="padding:14px">${lib.entries.length ? 'No matches.' : 'This library is empty. Use “Save layer to My settings” to add your own tested settings.'}</div>`);
    $$('.lbrow[data-id]', tbl).forEach(r => {
      r.onclick = () => { st.sel = r.dataset.id; draw(); };
      r.ondblclick = () => { st.sel = r.dataset.id; if (doApply()) M.close(); };
    });
    const e = lib.entries.find(x => x.id === st.sel);
    $('#lbInfo', body).innerHTML = e ? `<b>${Library.label(e)}</b> · ${MODE_NAMES[e.settings.mode]} mode · ${e.settings.speed} mm/min · ${e.settings.maxPower}% · ${e.settings.passes} pass(es)${e.settings.mode !== 'line' ? ` · interval ${e.settings.interval} mm (${Math.round(25.4 / e.settings.interval)} DPI)` : ''} · air assist ${e.settings.air ? 'on' : 'off'}${e.notes ? '<br>' + e.notes : ''}` : '';
    $('#lbDel').disabled = !e || !!lib.readonly; $('#lbApply').disabled = !e || targetLayer === null || targetLayer === undefined;
  };
  const doApply = () => {
    const lib = Library.get(st.lib), e = lib.entries.find(x => x.id === st.sel);
    if (!e || targetLayer === null || targetLayer === undefined) { toast('Select a layer in the Cuts list, then a preset', 'err'); return false; }
    applyPreset(targetLayer, e); return true;
  };
  const M = modal({
    title: 'Material library', body, width: 760, buttons: [
      { label: 'Delete preset', onClick: () => { Library.removeEntry(st.lib, st.sel); st.sel = null; draw(); return false; } },
      { label: 'Save layer to My settings', onClick: () => { saveLayerPreset(targetLayer, () => { st.lib = 'my'; $('#lbLib', body).value = 'my'; draw(); }); return false; } },
      { label: 'Close' },
      { label: 'Apply to layer', cls: 'primary', onClick: () => doApply() }]
  });
  const F = $('#modal footer'); F.children[0].id = 'lbDel'; F.children[0].style.marginRight = 'auto'; F.children[3].id = 'lbApply';
  $('#lbLib', body).value = st.lib;
  $('#lbLib', body).onchange = (ev) => { st.lib = ev.target.value; st.sel = null; localStorage.setItem('bf.lastLib', st.lib); draw(); };
  $('#lbQ', body).oninput = (ev) => { st.q = ev.target.value; draw(); };
  $('#lbOp', body).onchange = (ev) => { st.op = ev.target.value; draw(); };
  $('#lbExp', body).onclick = async () => { const l = Library.get(st.lib); await saveFile(l.name.replace(/[^\w\- ]+/g, '') + '.bflib', Library.exportLib(st.lib), [{ name: 'BeamForge library', extensions: ['bflib'] }]); };
  $('#lbImp', body).onclick = async () => {
    const f = await pickFile('.bflib,.json', true); if (!f) return;
    try { const nl = Library.importLib(bytesToText(f.data)); const o = document.createElement('option'); o.value = nl.id; o.textContent = nl.name; $('#lbLib', body).appendChild(o); st.lib = nl.id; $('#lbLib', body).value = nl.id; draw(); toast(`Imported ${nl.entries.length} preset(s)`, 'ok'); }
    catch (e) { toast('Import failed: ' + e.message, 'err'); }
  };
  $('#lbDev', body).onclick = () => { Object.assign(S.device, { width: 400, height: 415, sMax: 1000, name: 'Creality Falcon 10W' }); localStorage.setItem('bf.device', JSON.stringify(S.device)); zoomFit(); toast('Device set to Falcon 10W: 400 × 415 mm, Max S 1000', 'ok'); };
  targetTxt(); draw();
}
function saveLayerPreset(li, done) {
  if (li === null || li === undefined) { toast('Select a layer first', 'err'); return; }
  const L = S.doc.layers[li]; const defOp = L.mode === 'line' ? 'Cut' : L.mode === 'image' ? 'Photo' : 'Engrave';
  const f = document.createElement('div'); f.className = 'form';
  f.innerHTML = `<label>Material</label><input type="text" id="spM" placeholder="e.g. 3mm birch plywood">
    <label>Thickness (mm)</label><input type="number" id="spT" step="0.1" value="0">
    <label>Operation</label><select id="spO"><option>Cut</option><option>Engrave</option><option>Photo</option><option>Score</option></select>
    <label>Notes</label><input type="text" id="spN" placeholder="optional">
    <div class="full note">Saves layer C${pad2(li)}: ${MODE_NAMES[L.mode]}, ${L.speed} mm/min, ${L.maxPower}%, ${L.passes} pass(es).</div>`;
  $('#spO', f).value = defOp;
  // nested dialog: reuse the modal by stacking a simple overlay
  const ov = document.createElement('div'); ov.id = 'modal2'; ov.innerHTML = '<div class="dlg"><header><span class="title">Save to My settings</span></header><div class="body"></div><footer><button id="spC">Cancel</button><button id="spS" class="primary">Save</button></footer></div>';
  $('.body', ov).appendChild(f); document.body.appendChild(ov); setTimeout(() => $('#spM', f).focus(), 20);
  $('#spC', ov).onclick = () => ov.remove();
  $('#spS', ov).onclick = () => {
    const m = $('#spM', f).value.trim(); if (!m) { $('#spM', f).focus(); return; }
    const settings = {}; ['mode', 'speed', 'maxPower', 'minPower', 'passes', 'interval', 'bidir', 'overscan', 'angle', 'crosshatch', 'air', 'imageMode', 'constant', 'zStep', 'halftoneCell', 'halftoneAngle'].forEach(k => settings[k] = L[k]);
    Library.addEntry('my', { material: m, thickness: +$('#spT', f).value || 0, op: $('#spO', f).value, source: 'Mine', notes: $('#spN', f).value, settings });
    ov.remove(); toast('Saved to My settings', 'ok'); done && done();
  };
}

// ---------------------------------------------------------------- shape tab (images)
function updateShapeTab() {
  const objs = selObjs(); const img = objs.length === 1 && objs[0].type === 'image' ? objs[0] : null;
  $('#imgProps').classList.toggle('hidden', !img);
  if (!objs.length) $('#shapeInfo').innerHTML = 'Select a shape or image.';
  else {
    const types = [...new Set(objs.map(o => o.type))].join(', '); const b = boxOf(objs);
    const pathsN = objs.reduce((a, o) => a + (o.type === 'image' ? 0 : o.paths.length), 0);
    $('#shapeInfo').innerHTML = `<b>${objs.length}</b> object(s): ${types}<br>${n2(b.x1 - b.x0)} × ${n2(b.y1 - b.y0)} mm · ${pathsN} path(s)` + (objs.some(o => o.type === 'text') ? `<div class="row"><button class="small" data-cmd="toPath">Convert text to path</button></div>` : '');
    applyCmdButtons($('#shapeInfo'));
  }
  if (img) {
    const a = img.adj || {};
    const set = (id, v) => { $(id).value = v; $(id).nextElementSibling.textContent = v; };
    set('#iBright', a.brightness || 0); set('#iContrast', a.contrast || 0); set('#iGamma', a.gamma || 1); set('#iSharpen', a.sharpen || 0); set('#iThresh', a.threshold ?? 128);
    $('#iInvert').checked = !!a.invert;
  }
}
let adjPushed = false;
[['#iBright', 'brightness'], ['#iContrast', 'contrast'], ['#iGamma', 'gamma'], ['#iSharpen', 'sharpen'], ['#iThresh', 'threshold'], ['#iInvert', 'invert']].forEach(([id, k]) => {
  $(id).addEventListener('input', () => {
    const o = selObjs()[0]; if (!o || o.type !== 'image') return;
    if (!adjPushed) { pushUndo(); adjPushed = true; setTimeout(() => adjPushed = false, 1500); }
    o.adj = { ...(o.adj || {}), [k]: $(id).type === 'checkbox' ? $(id).checked : +$(id).value };
    if ($(id).nextElementSibling) $(id).nextElementSibling.textContent = $(id).value;
    requestRender();
  });
});
$('#iShowProc').onchange = requestRender;

// ---------------------------------------------------------------- files
async function pickFile(accept, binary = false) {
  if (NATIVE) {
    const exts = accept.split(',').map(s => s.replace('.', '').trim());
    const r = await NATIVE.openFile({ filters: [{ name: 'Supported files', extensions: exts }] });
    if (!r) return null; return { name: r.name, path: r.path, data: new Uint8Array(r.data) };
  }
  return new Promise(res => {
    const inp = $('#fileIn'); inp.accept = accept; inp.value = '';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return res(null); res({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); };
    inp.click();
  });
}
async function saveFile(name, text, filters) {
  if (NATIVE) return NATIVE.saveFile({ defaultPath: name, filters, data: text });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000); return name;
}
const bytesToText = (u8) => new TextDecoder().decode(u8);
const bytesToDataURL = (u8, mime) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([u8], { type: mime })); });
function nearestLayer(rgb) {
  let best = 0, bd = Infinity;
  PALETTE.forEach((c, i) => { const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16); const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
function freeLayer(pref) {
  const used = new Set(S.doc.objects.map(o => o.layer));
  if (pref !== undefined && !used.has(pref)) return pref;
  for (let i = 1; i < 30; i++) if (!used.has(i)) return i; return 29;
}
function placeImported(objs) {
  // centre the group in the work area (or keep if it already fits & is positioned)
  let b = G.emptyBox(); objs.forEach(o => b = G.boxUnion(b, G.pathsBox(G.xformPaths(localPaths(o), o.m))));
  if (!G.boxValid(b)) return;
  const tx = S.device.width / 2 - (b.x0 + b.x1) / 2, ty = S.device.height / 2 - (b.y0 + b.y1) / 2;
  objs.forEach(o => o.m = G.mul(G.translate(tx, ty), o.m));
}
async function importFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'bfproj') return openProjectData(bytesToText(f.data), f.name, f.path);
    if (ext === 'bfupdate') return installUpdateBytes(f.data);
    if (Model3D.FORMATS.includes(ext)) return importModel(f, ext);
    if (['gcode', 'nc', 'gc', 'ngc', 'tap', 'txt'].includes(ext)) return showGcodeFile(bytesToText(f.data), f.name);
    if (ext === 'svg') {
      const r = await Importers.svg(bytesToText(f.data), nearestLayer);
      const gid = r.objects.length > 1 ? uid() : undefined; const objs = [];
      for (const it of r.objects) {
        if (it.image) {
          const im = await Importers.loadImage(it.image);
          objs.push({ type: 'image', img: { src: it.image, pw: im.naturalWidth, ph: im.naturalHeight }, w: it.w, h: it.h, m: G.translate(it.x, it.y), layer: freeLayer(), groupId: gid, adj: {} });
        } else objs.push({ type: 'path', paths: it.paths, m: G.I(), layer: it.layer, groupId: gid });
      }
      if (!objs.length) { toast('No usable vector shapes found in that SVG', 'err'); return; }
      normalizeObjs(objs); placeImported(objs);
      pushUndo(); addObjects(objs);
      objs.filter(o => o.type === 'image').forEach(o => setImageLayer(o.layer));
      commit(); zoomToBox(boxOf(objs), 80);
      toast(`Imported ${f.name}: ${objs.length} object(s)` + (r.texts ? ` (${r.texts} text item(s) converted to outlines)` : '') + (r.skippedText ? ` — ${r.skippedText} text element(s) could not be converted` : ''), 'ok');
      return;
    }
    if (ext === 'dxf') {
      const r = Importers.dxf(bytesToText(f.data));
      if (!r.objects.length) { toast('No supported entities found in that DXF', 'err'); return; }
      const objs = r.objects.map(o => ({ type: 'path', paths: o.paths, m: G.I(), layer: S.curLayer }));
      normalizeObjs(objs); placeImported(objs); pushUndo(); addObjects(objs); commit(); zoomToBox(boxOf(objs), 80);
      toast(`Imported ${f.name}`, 'ok'); return;
    }
    const mimes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };
    if (mimes[ext]) {
      const src = await bytesToDataURL(f.data, mimes[ext]); const im = await Importers.loadImage(src);
      let w = im.naturalWidth * 25.4 / 96, h = im.naturalHeight * 25.4 / 96;
      const maxW = S.device.width * 0.6, maxH = S.device.height * 0.6; const k = Math.min(1, maxW / w, maxH / h); w *= k; h *= k;
      const layer = freeLayer();
      const o = { type: 'image', img: { src, pw: im.naturalWidth, ph: im.naturalHeight }, w, h, m: G.translate((S.device.width - w) / 2, (S.device.height - h) / 2), layer, adj: {} };
      pushUndo(); addObjects([o]); setImageLayer(layer); commit(); showTab('shape');
      toast(`Imported image ${im.naturalWidth}×${im.naturalHeight}px on layer C${pad2(layer)} (Image mode)`, 'ok'); return;
    }
    toast('Unsupported file type: .' + ext, 'err');
  } catch (e) { console.error(e); toast(`Import failed: ${e.message}`, 'err'); }
}
function setImageLayer(li) { const L = S.doc.layers[li]; if (L.mode !== 'image' && !S.doc.objects.some(o => o.layer === li && o.type !== 'image')) Object.assign(L, { mode: 'image', speed: 3000, maxPower: 40, minPower: 0, interval: 0.1, imageMode: 'jarvis' }); }
function normalizeObjs(objs) { // bake each path object's bbox into its matrix so local coords start at 0,0
  for (const o of objs) {
    if (o.type === 'image') continue;
    const wp = G.xformPaths(o.paths, o.m), b = G.pathsBox(wp);
    o.paths = wp.map(p => ({ pts: p.pts.map((v, i) => i % 2 ? v - b.y0 : v - b.x0), closed: p.closed })); o.m = G.translate(b.x0, b.y0);
  }
}
async function openProjectData(text, name, path) {
  const d = JSON.parse(text); if (!d.doc) throw new Error('Not a BeamForge project');
  loadDoc(d.doc); S.undo = []; S.redo = []; S.fileName = (name || 'Untitled').replace(/\.bfproj$/, ''); S.filePath = path || null; S.dirty = false;
  updateTitle(); commit(); zoomFit(); toast(`Opened ${S.fileName}`, 'ok');
}

// ---------------------------------------------------------------- commands
const cmds = {
  async new() { if (S.doc.objects.length && !(await confirmBox('New project', 'Discard the current design and start a new one?', 'Discard'))) return; S.doc = newDoc(); S.sel.clear(); S.undo = []; S.redo = []; S.fileName = 'Untitled'; S.filePath = null; S.dirty = false; updateTitle(); commit(); scheduleAutosave(); },
  async open() { const f = await pickFile('.bfproj', false); if (!f) return; try { await openProjectData(bytesToText(f.data), f.name, f.path); } catch (e) { toast('Could not open: ' + e.message, 'err'); } },
  async save(as = false) {
    const data = JSON.stringify({ app: 'BeamForge', version: 1, doc: serializeDoc(), device: { width: S.device.width, height: S.device.height } });
    let p;
    if (NATIVE) p = await NATIVE.saveFile({ defaultPath: S.filePath || (S.fileName + '.bfproj'), filters: [{ name: 'BeamForge project', extensions: ['bfproj'] }], data, path: as ? null : S.filePath });
    else p = await saveFile(S.fileName + '.bfproj', data);
    if (p) { S.filePath = NATIVE ? p : null; S.fileName = String(p).split(/[\\/]/).pop().replace(/\.bfproj$/, ''); S.dirty = false; updateTitle(); toast('Saved ' + S.fileName, 'ok'); }
  },
  saveAs() { return cmds.save(true); },
  async import() { const f = await pickFile('.svg,.dxf,.png,.jpg,.jpeg,.bmp,.gif,.webp,.gcode,.nc,.gc,.ngc,.tap,.bfproj,.bfupdate,.stl,.obj,.ply,.off,.3mf,.amf', true); if (f) importFile(f); },
  undo() { if (!S.undo.length) return; S.redo.push(serializeDoc()); loadDoc(S.undo.pop()); markDirty(); commit(); },
  redo() { if (!S.redo.length) return; S.undo.push(serializeDoc()); loadDoc(S.redo.pop()); markDirty(); commit(); },
  copy() { const o = selObjs(); if (o.length) { S.clip = o.map(cloneObj); S.pasteN = 0; } },
  cut() { cmds.copy(); cmds.delete(); },
  paste() {
    if (!S.clip) return; S.pasteN = (S.pasteN || 0) + 1; pushUndo();
    const gmap = {}; const objs = S.clip.map(c => { const o = cloneObj(c); o.id = uid(); if (o.groupId) o.groupId = gmap[o.groupId] ||= uid(); o.m = G.mul(G.translate(5 * S.pasteN, -5 * S.pasteN), o.m); return o; });
    addObjects(objs); commit();
  },
  duplicate() { const sel = selObjs(); if (!sel.length) return; pushUndo(); const gmap = {}; const objs = sel.map(c => { const o = cloneObj(c); o.id = uid(); if (o.groupId) o.groupId = gmap[o.groupId] ||= uid(); return o; }); addObjects(objs); commit(); toast('Duplicated in place — drag to move'); },
  delete() { if (!S.sel.size) return; pushUndo(); S.doc.objects = S.doc.objects.filter(o => !S.sel.has(o.id)); S.sel.clear(); commit(); },
  selectAll() { S.doc.objects.forEach(o => S.doc.layers[o.layer].show && S.sel.add(o.id)); setTool('select'); commit(); },
  group() { const o = selObjs(); if (o.length < 2) return toast('Select two or more shapes to group', 'err'); pushUndo(); const g = uid(); o.forEach(x => x.groupId = g); commit(); toast(`Grouped ${o.length} shapes`); },
  selectLayer() { const o = selObjs()[0]; const li = o ? o.layer : S.selLayer; if (li === null || li === undefined) return; S.sel.clear(); S.doc.objects.forEach(x => x.layer === li && S.doc.layers[li].show && S.sel.add(x.id)); commit(); },
  invertSel() { const prev = new Set(S.sel); S.sel.clear(); S.doc.objects.forEach(o => !prev.has(o.id) && S.doc.layers[o.layer].show && S.sel.add(o.id)); commit(); },
  toFront() { const sel = selObjs(); if (!sel.length) return; pushUndo(); S.doc.objects = S.doc.objects.filter(o => !S.sel.has(o.id)).concat(sel); commit(); },
  toBack() { const sel = selObjs(); if (!sel.length) return; pushUndo(); S.doc.objects = sel.concat(S.doc.objects.filter(o => !S.sel.has(o.id))); commit(); },
  pasteHere() {
    if (!S.clip) return; const at = S.ctxWorld || S.mouse; pushUndo();
    const gmap = {}; const objs = S.clip.map(c => { const o = cloneObj(c); o.id = uid(); if (o.groupId) o.groupId = gmap[o.groupId] ||= uid(); return o; });
    const b = boxOf(objs); const M = G.translate(at[0] - (b.x0 + b.x1) / 2, at[1] - (b.y0 + b.y1) / 2); objs.forEach(o => o.m = G.mul(M, o.m));
    addObjects(objs); commit();
  },
  imageAdjust() { showTab('shape'); },
  ungroup() { const o = selObjs().filter(x => x.groupId); if (!o.length) return toast('Nothing grouped in the selection', 'err'); pushUndo(); o.forEach(x => delete x.groupId); commit(); toast(`Ungrouped ${o.length} shapes — click a shape to select it on its own`); },
  mirrorH() { const b = selBox(); if (G.boxValid(b)) transformSel(G.scale(-1, 1, (b.x0 + b.x1) / 2, 0)); },
  mirrorV() { const b = selBox(); if (G.boxValid(b)) transformSel(G.scale(1, -1, 0, (b.y0 + b.y1) / 2)); },
  rotCW() { const b = selBox(); if (G.boxValid(b)) transformSel(G.rotate(-90, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)); },
  rotCCW() { const b = selBox(); if (G.boxValid(b)) transformSel(G.rotate(90, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)); },
  centerPage() { const b = selBox(); if (G.boxValid(b)) transformSel(G.translate(S.device.width / 2 - (b.x0 + b.x1) / 2, S.device.height / 2 - (b.y0 + b.y1) / 2)); },
  alignL: () => align('x', 0), alignCH: () => align('x', 0.5), alignR: () => align('x', 1),
  alignT: () => align('y', 1), alignCV: () => align('y', 0.5), alignB: () => align('y', 0),
  distH: () => distribute('x'), distV: () => distribute('y'),
  weld: () => booleanOp('union'), subtract: () => booleanOp('subtract'), intersect: () => booleanOp('intersect'),
  offset() {
    const objs = selObjs().filter(o => o.type !== 'image'); if (!objs.length) return toast('Select vector shapes to offset', 'err');
    modal({
      title: 'Offset shapes', body: `<div class="form"><label>Distance (mm)</label><input type="number" id="ofD" value="2" min="0.05" step="0.1"><label>Direction</label><select id="ofDir"><option value="1">Outward</option><option value="-1">Inward</option></select><label>Delete original</label><input type="checkbox" id="ofDel"></div>`,
      buttons: [{ label: 'Cancel' }, {
        label: 'Offset', cls: 'primary', onClick: (B) => {
          const d = +$('#ofD', B).value * +$('#ofDir', B).value; if (!d) return;
          const paths = Trace.offset(objs.map(worldPaths), d);
          if (!paths.length) { toast('Offset produced no shape (too far inward?)', 'err'); return; }
          pushUndo(); if ($('#ofDel', B).checked) S.doc.objects = S.doc.objects.filter(o => !S.sel.has(o.id));
          const o = { type: 'path', paths, m: G.I(), layer: objs[0].layer }; normalizeObjs([o]); addObjects([o]); commit();
        }
      }]
    });
  },
  array() {
    if (!S.sel.size) return toast('Select something to array', 'err');
    const b = selBox();
    modal({
      title: 'Grid array', body: `<div class="form"><label>Columns</label><input type="number" id="arC" value="3" min="1"><label>Rows</label><input type="number" id="arR" value="2" min="1"><label>Horizontal gap (mm)</label><input type="number" id="arGX" value="5" step="0.5"><label>Vertical gap (mm)</label><input type="number" id="arGY" value="5" step="0.5"><div class="full note">Item size ${n2(b.x1 - b.x0)} × ${n2(b.y1 - b.y0)} mm</div></div>`,
      buttons: [{ label: 'Cancel' }, {
        label: 'Create', cls: 'primary', onClick: (B) => {
          const C = Math.max(1, +$('#arC', B).value | 0), R = Math.max(1, +$('#arR', B).value | 0);
          const sx = b.x1 - b.x0 + +$('#arGX', B).value, sy = b.y1 - b.y0 + +$('#arGY', B).value;
          pushUndo(); const src = selObjs(); const all = [];
          for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (!r && !c) continue; const gmap = {};
            for (const s of src) { const o = cloneObj(s); o.id = uid(); if (o.groupId) o.groupId = gmap[o.groupId] ||= uid(); o.m = G.mul(G.translate(c * sx, -r * sy), o.m); all.push(o); }
          }
          addObjects(all, false); src.concat(all).forEach(o => S.sel.add(o.id)); commit();
        }
      }]
    });
  },
  trace() {
    const o = selObjs().find(x => x.type === 'image'); if (!o) return toast('Select an image to trace', 'err');
    const img = getImage(o.img.src); if (!img) return;
    const body = document.createElement('div');
    const st = { mode: 'outline', ...JSON.parse(localStorage.getItem('bf.trace') || '{}') };
    body.innerHTML = `<div class="form">
      <label>Trace type</label><select id="trM"><option value="outline">Outline — closed shapes around dark areas</option><option value="center">Center line — single lines through the middle (logos, sketches, text)</option></select>
      <label>Threshold</label><input type="range" id="trT" min="1" max="254" value="128">
      <label>Invert</label><input type="checkbox" id="trI">
      <label class="tr-o">Ignore smaller than (mm²)</label><input class="tr-o" type="number" id="trMin" value="0.5" step="0.1">
      <label class="tr-c">Remove branches shorter than (mm)</label><input class="tr-c" type="number" id="trBr" value="1.5" step="0.5" min="0">
      <label class="tr-c">Smoothing</label><input class="tr-c" type="range" id="trSm" min="0.2" max="3" step="0.1" value="0.8">
      <div class="full note tr-c">Works best with high-resolution images that have clean, even lines; low-resolution images give extra stray branches.</div>
    </div><canvas id="trPv" width="520" height="320" style="margin-top:10px;background:#fff;border-radius:6px"></canvas><div class="note" id="trN"></div>`;
    $('#trM', body).value = st.mode;
    let result = [], timer = 0;
    const pv = () => {
      const mode = $('#trM', body).value, t = +$('#trT', body).value, inv = $('#trI', body).checked;
      $$('.tr-o', body).forEach(e => e.style.display = mode === 'outline' ? '' : 'none'); $$('.tr-c', body).forEach(e => e.style.display = mode === 'center' ? '' : 'none');
      result = mode === 'center' ? Trace.centerLine(img, o.w, o.h, t, inv, +$('#trBr', body).value, +$('#trSm', body).value)
        : Trace.traceImage(img, o.w, o.h, t, inv).filter(p => Math.abs(G.polyArea(p.pts)) >= +$('#trMin', body).value);
      const c = $('#trPv', body), x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
      const k = Math.min((c.width - 20) / o.w, (c.height - 20) / o.h); x.setTransform(k, 0, 0, -k, (c.width - o.w * k) / 2, (c.height + o.h * k) / 2);
      x.save(); x.translate(0, o.h); x.scale(1, -1); x.globalAlpha = .25; x.drawImage(img, 0, 0, o.w, o.h); x.restore();
      x.beginPath(); for (const p of result) { x.moveTo(p.pts[0], p.pts[1]); for (let i = 2; i < p.pts.length; i += 2) x.lineTo(p.pts[i], p.pts[i + 1]); if (p.closed) x.closePath(); }
      if (mode === 'outline') { x.fillStyle = 'rgba(30,60,200,.35)'; x.fill('evenodd'); x.strokeStyle = '#e03'; x.lineWidth = 1 / k; }
      else { x.strokeStyle = '#e03'; x.lineWidth = 1.6 / k; x.lineJoin = 'round'; }
      x.stroke();
      const open = result.filter(p => !p.closed).length;
      $('#trN', body).textContent = mode === 'center' ? `${result.length} line(s)${open !== result.length ? ` (${result.length - open} closed)` : ''}` : `${result.length} closed path(s)`;
    };
    body.oninput = () => { clearTimeout(timer); timer = setTimeout(pv, 60); }; setTimeout(pv, 10);
    modal({ title: 'Trace image', body, width: 560, buttons: [{ label: 'Cancel' }, { label: 'Create vectors', cls: 'primary', onClick: () => {
      if (!result.length) return false; localStorage.setItem('bf.trace', JSON.stringify({ mode: $('#trM', body).value }));
      pushUndo(); const n = { type: 'path', paths: result, m: o.m.slice(), layer: freeLayer(S.curLayer) }; addObjects([n]); commit();
      toast(`Traced ${result.length} ${$('#trM', body).value === 'center' ? 'centre line' : 'path'}(s) — on layer C${pad2(n.layer)}`, 'ok'); } }] });
  },
  closePaths() {
    const objs = selObjs().filter(o => o.type === 'path'); if (!objs.length) return toast('Select vector paths to close/join', 'err');
    modal({
      title: 'Close / join paths', body: `<div class="form"><label>Join tolerance (mm)</label><input type="number" id="cpT" value="0.2" step="0.05" min="0"><label>Force-close all open paths</label><input type="checkbox" id="cpF"></div>`,
      buttons: [{ label: 'Cancel' }, {
        label: 'Apply', cls: 'primary', onClick: (B) => {
          const tol = +$('#cpT', B).value, force = $('#cpF', B).checked; pushUndo(); let opened = 0;
          for (const o of objs) { let p = Importers.joinPaths(o.paths, tol / G.mScale(o.m)); if (force) p = p.map(q => ({ pts: q.pts, closed: q.pts.length >= 6 ? true : q.closed })); o.paths = p; opened += p.filter(q => !q.closed).length; }
          commit(); toast(opened ? `${opened} path(s) remain open` : 'All paths are closed', opened ? '' : 'ok');
        }
      }]
    });
  },
  toPath() { const t = selObjs().filter(o => o.type === 'text'); if (!t.length) return; pushUndo(); t.forEach(o => { o.type = 'path'; delete o.textProps; }); commit(); },
  resetImg() { const o = selObjs()[0]; if (o?.type === 'image') { pushUndo(); o.adj = {}; updateShapeTab(); requestRender(); } },
  zoomFit, zoomSel() { const b = selBox(); if (G.boxValid(b)) zoomToBox(b, 80); else zoomFit(); },
  zoomIn() { const r = cv.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); },
  zoomOut() { const r = cv.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); },
  layerUp() { moveLayer(-1); }, layerDown() { moveLayer(1); }, layerEdit() { if (S.selLayer !== null) editLayer(S.selLayer); },
  library() { openLibrary(S.selLayer); },
  preview() { showPreview(); },
  cost() { costCalculator(); },
  nest() { nestDialog(); },
  async autoArrange() { // one click: optimised nesting with the last-used settings, no dialog
    const sel = selObjs().filter(o => S.doc.layers[o.layer].show), cand = nestContainerCandidate(sel);
    const parts = cand ? sel.filter(o => o !== cand) : (sel.length ? sel : S.doc.objects.filter(o => S.doc.layers[o.layer].show));
    if (!parts.length) return toast('Draw or import some parts first', 'err');
    const saved = JSON.parse(localStorage.getItem('bf.nest') || '{}');
    toast(`Auto-arranging ${cand ? 'onto the selected sheet' : 'on the work area'}…`);
    try { await doNest({ padding: 2, edge: 2, rot: 90, lockInner: true, mode: 'pack', ...saved, overflow: 'leave', level: 1, into: cand ? 'shape' : 'area' }, cand, parts, () => {}, () => false, () => false); }
    catch (e) { console.error(e); toast('Auto-arrange failed: ' + e.message, 'err'); }
  },
  boxBuilder() { boxDialog(); },
  troubleshoot() { troubleshooter(); },
  apiSettings() { apiDialog(); },
  async modelSettings() {
    const o = selObjs().find(x => x.type === 'image' && x.model); if (!o) return toast('Select an imported 3D model', 'err');
    let model; try { model = await modelOf(o); } catch (e) { return toast('Could not read the 3D model: ' + e.message, 'err'); }
    const st = { ...o.model.settings, width: o.w };
    modelDialog(model, st, `3D model — ${o.model.name}`, async (src, w, h, settings) => {
      const im = await Importers.loadImage(src); pushUndo();
      const b0 = objBox(o), cx = (b0.x0 + b0.x1) / 2, cy = (b0.y0 + b0.y1) / 2;
      const sx = Math.hypot(o.m[0], o.m[1]), sy = Math.hypot(o.m[2], o.m[3]);
      o.img = { src, pw: im.naturalWidth, ph: im.naturalHeight }; o.w = w / sx; o.h = h / sy; o.model = { ...o.model, settings }; delete o._pc;
      const b1 = objBox(o); o.m = G.mul(G.translate(cx - (b1.x0 + b1.x1) / 2, cy - (b1.y0 + b1.y1) / 2), o.m);
      S.doc.layers[o.layer].interval = +(25.4 / settings.dpi).toFixed(3); commit();
    });
  },
  modelToBitmap() { const os = selObjs().filter(x => x.type === 'image' && x.model); if (!os.length) return; pushUndo(); os.forEach(o => delete o.model); commit(); toast('Converted to a bitmap — the 3D settings can no longer be changed', 'ok'); },
  pageNew() { pushUndo(); const i = addPage(); switchPage(i); renderPages(); },
  pageDuplicate() { pushUndo(); syncPages(); const src = S.doc.pages[S.doc.page]; const gmap = {}; const objs = src.objects.map(o => { const c = cloneObj(o); c.id = uid(); if (c.groupId) c.groupId = gmap[c.groupId] ||= uid(); return c; }); const i = addPage(objs, src.name + ' copy'); S.doc.pages.splice(i, 1); S.doc.pages.splice(S.doc.page + 1, 0, { id: uid(), name: src.name + ' copy', objects: objs }); switchPage(S.doc.page + 1); renderPages(); },
  async pageDelete() {
    if (S.doc.pages.length < 2) return toast('A project needs at least one page', 'err');
    syncPages(); const p = S.doc.pages[S.doc.page];
    if (p.objects.length && !(await confirmBox('Delete page', `Delete “${p.name}” and its ${p.objects.length} object(s)? You can undo this.`, 'Delete'))) return;
    pushUndo(); const i = S.doc.page; S.doc.pages.splice(i, 1); S.doc.page = Math.min(i, S.doc.pages.length - 1); S.doc.objects = S.doc.pages[S.doc.page].objects; S.sel.clear(); commit(); renderPages();
  },
  pageRename() { renamePage(S.doc.page); },
  pageNext() { switchPage(S.doc.page + 1); }, pagePrev() { switchPage(S.doc.page - 1); },
  pasteInPlace() {
    if (!S.clip) return; pushUndo();
    const gmap = {}; const objs = S.clip.map(c => { const o = cloneObj(c); o.id = uid(); if (o.groupId) o.groupId = gmap[o.groupId] ||= uid(); return o; });
    addObjects(objs); commit();
  },
  updates() { updatesDialog(); },
  async installUpdateFile() { const f = await pickFile('.bfupdate', true); if (f) installUpdateBytes(f.data); },
  device() { deviceSettings(); },
  async exportGcode() {
    const job = buildJob(); if (!job) return;
    const ext = S.device.gcodeExt || 'gcode', name = (S.fileName || 'job') + '.' + ext;
    const p = await saveFile(name, job.gcode, [{ name: 'G-code', extensions: [ext, ...['gcode', 'nc'].filter(e => e !== ext)] }]);
    if (p) toast(`G-code saved (${job.stats.lines} lines, est. ${fmtTime(job.stats.time)})`, 'ok');
  },
  async sendGcodeFile() { const f = await pickFile('.gcode,.nc,.gc,.ngc,.tap,.txt', true); if (f) showGcodeFile(bytesToText(f.data), f.name); },
  home() { if (need()) grbl.send('$H'); },
  unlock() { if (need()) grbl.send('$X'); },
  frame() {
    if (!need()) return; const job = buildJob(); if (!job || !job.bounds) return;
    const b = job.machineBounds || job.bounds, F = S.device.frameFeed || 3000;
    const head = (S.device.header || '').split('\n').map(l => l.trim()).filter(l => l && !/^\$H/i.test(l)); // your start G-code, minus homing
    [...head, 'G90 G21', `G0 X${Gcode.fmt(b.x0)} Y${Gcode.fmt(b.y0)}`, `G1 X${Gcode.fmt(b.x0)} Y${Gcode.fmt(b.y1)} S0 F${F}`, `G1 X${Gcode.fmt(b.x1)} Y${Gcode.fmt(b.y1)}`, `G1 X${Gcode.fmt(b.x1)} Y${Gcode.fmt(b.y0)}`, `G1 X${Gcode.fmt(b.x0)} Y${Gcode.fmt(b.y0)}`].forEach(l => grbl.send(l, true));
    toast('Framing job outline (laser off)');
  },
  goOrigin() { if (need()) grbl.send('G90 G0 X0 Y0'); },
  setOrigin() { if (need()) { grbl.send('G10 L20 P1 X0 Y0'); toast('Work origin set to current position'); } },
  clearOrigin() { if (need()) { grbl.send('G10 L2 P1 X0 Y0'); toast('Work origin cleared (back to machine origin)'); } },
};
function need() { if (!grbl.connected) { toast('Not connected to a laser', 'err'); return false; } return true; }
function align(axis, f) {
  const objs = selObjs(); if (objs.length < 2) return toast('Select two or more objects', 'err');
  pushUndo(); const B = boxOf(objs); const units = groupUnits(objs);
  for (const u of units) { const b = boxOf(u); const d = axis === 'x' ? (B.x0 + (B.x1 - B.x0) * f) - (b.x0 + (b.x1 - b.x0) * f) : (B.y0 + (B.y1 - B.y0) * f) - (b.y0 + (b.y1 - b.y0) * f); const M = axis === 'x' ? G.translate(d, 0) : G.translate(0, d); u.forEach(o => o.m = G.mul(M, o.m)); }
  commit();
}
function groupUnits(objs) { const m = new Map(); objs.forEach(o => { const k = o.groupId || o.id; if (!m.has(k)) m.set(k, []); m.get(k).push(o); }); return [...m.values()]; }
function distribute(axis) {
  const units = groupUnits(selObjs()); if (units.length < 3) return toast('Select three or more objects', 'err');
  pushUndo(); const c = (u) => { const b = boxOf(u); return axis === 'x' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2; };
  units.sort((a, b) => c(a) - c(b)); const a0 = c(units[0]), a1 = c(units[units.length - 1]);
  units.forEach((u, i) => { const d = a0 + (a1 - a0) * i / (units.length - 1) - c(u); const M = axis === 'x' ? G.translate(d, 0) : G.translate(0, d); u.forEach(o => o.m = G.mul(M, o.m)); });
  commit();
}
function booleanOp(op) {
  const objs = selObjs().filter(o => o.type !== 'image'); if (objs.length < (op === 'union' ? 1 : 2)) return toast(op === 'union' ? 'Select shapes to weld' : 'Select two or more shapes', 'err');
  setMsg('Working…');
  setTimeout(() => {
    const shapes = objs.map(worldPaths); const paths = Trace.boolean(op, shapes); setMsg('');
    if (!paths.length) return toast('Result is empty', 'err');
    pushUndo(); S.doc.objects = S.doc.objects.filter(o => !objs.includes(o));
    const o = { type: 'path', paths, m: G.I(), layer: objs[0].layer }; normalizeObjs([o]); addObjects([o]); commit();
  }, 10);
}
function moveLayer(d) {
  const li = S.selLayer; const o = S.doc.layerOrder; const i = o.indexOf(li); const j = i + d; if (i < 0 || j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]]; markDirty(); renderLayerList();
}
function run(name, ...a) {
  const ae = document.activeElement, inText = ae && /INPUT|TEXTAREA/.test(ae.tagName);
  if (inText && ['copy', 'cut', 'paste', 'selectAll', 'undo', 'redo'].includes(name)) { document.execCommand(name === 'selectAll' ? 'selectAll' : name); return; }
  const f = cmds[name]; if (f) { try { const r = f(...a); if (r && r.catch) r.catch(e => toast(e.message, 'err')); } catch (e) { console.error(e); toast(e.message, 'err'); } }
}
function applyCmdButtons(root = document) { $$('[data-cmd]', root).forEach(b => { if (!b._bound) { b._bound = true; b.addEventListener('click', () => run(b.dataset.cmd)); } }); }

// ---------------------------------------------------------------- job building & preview
function buildJob(silent) {
  if (!S.doc.objects.length) { if (!silent) toast('Nothing to output — draw or import something first', 'err'); return null; }
  const startFrom = $('#startFrom').value;
  if (startFrom === 'current' && !grbl.connected && !silent) toast('“Current position” uses 0,0 until connected', '');
  S.doc.objects.forEach(o => o._sel = S.sel.has(o.id));
  if ($('#optSel').checked && !S.sel.size) { toast('“Cut selected graphics” is on but nothing is selected', 'err'); return null; }
  const job = Gcode.generate({
    objects: S.doc.objects, layers: S.doc.layers, layerOrder: S.doc.layerOrder, device: S.device,
    opts: { startFrom, anchor: S.jobAnchor, curPos: S.status ? S.status.wpos.slice(0, 2) : [0, 0], selectionOnly: $('#optSel').checked, optimize: $('#optOpt').checked },
    worldPaths, imageOf: (o) => getImage(o.img.src)
  });
  if (!job.moves.some(m => m.s > 0)) { if (!silent) toast('No output — check that layers have Output enabled and power above 0', 'err'); return null; }
  if (!silent && job.bounds && startFrom === 'absolute' && (job.bounds.x0 < -0.01 || job.bounds.x1 > S.device.width + 0.01 || (!job.rotary && (job.bounds.y0 < -0.01 || job.bounds.y1 > S.device.height + 0.01))))
    toast('Warning: part of the job is outside the work area', 'err');
  return job;
}
function showPreview(job = buildJob(), title = 'Preview') {
  if (!job) return;
  const body = document.createElement('div'); body.id = 'pvWrap';
  const W = Math.min(window.innerWidth - 120, 1100), H = Math.min(window.innerHeight - 280, 700);
  body.innerHTML = `<canvas id="pvCanvas" width="${W * dpr}" height="${H * dpr}" style="width:${W}px;height:${H}px"></canvas>
    <div class="row"><button id="pvPlay" class="small">▶ Play</button><input type="range" id="pvSlider" min="0" max="${job.moves.length}" value="${job.moves.length}" class="grow"><label class="chk" style="margin:0"><input type="checkbox" id="pvTravel" checked> Show travel</label></div>
    <div class="pvStats"><span>Estimated time <b>${fmtTime(job.stats.time)}</b></span><span>Cut <b>${n2(job.stats.cutDist / 1000)} m</b></span><span>Travel <b>${n2(job.stats.travelDist / 1000)} m</b></span><span>Lines <b>${job.stats.lines ?? '-'}</b></span>${job.bounds ? `<span>Size <b>${n2(job.bounds.x1 - job.bounds.x0)} × ${n2(job.bounds.y1 - job.bounds.y0)} mm</b></span>` : ''}<span id="pvT"></span><span class="grow"></span><span class="note">Scroll / pinch to zoom · drag to pan · double-click to reset</span></div>`;
  const c = $('#pvCanvas', body), x = c.getContext('2d');
  let b = G.emptyBox(); job.moves.forEach(m => { G.boxAdd(b, m.x0, m.y0); G.boxAdd(b, m.x1, m.y1); });
  if (job.workArea !== false) { G.boxAdd(b, 0, 0); G.boxAdd(b, S.device.width, S.device.height); }
  const k0 = Math.min((W - 30) / (b.x1 - b.x0 || 1), (H - 30) / (b.y1 - b.y0 || 1));
  const tx0 = (W - (b.x1 - b.x0) * k0) / 2 - b.x0 * k0, ty0 = (H + (b.y1 - b.y0) * k0) / 2 + b.y0 * k0;
  let k = k0, tx = tx0, ty = ty0;
  const draw = (upto) => {
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#0f1113'; x.fillRect(0, 0, W, H);
    x.setTransform(dpr * k, 0, 0, -dpr * k, dpr * tx, dpr * ty);
    x.fillStyle = '#1b1e22'; x.fillRect(0, 0, S.device.width, S.device.height);
    x.lineWidth = 1 / k; x.strokeStyle = '#3a3f46'; x.strokeRect(0, 0, S.device.width, S.device.height);
    const buckets = Array.from({ length: 6 }, () => new Path2D()), trav = new Path2D();
    for (let i = 0; i < upto; i++) {
      const m = job.moves[i];
      if (m.s < 0) { trav.moveTo(m.x0, m.y0); trav.lineTo(m.x1, m.y1); }
      else if (m.s > 0) { const bk = Math.min(5, Math.floor(m.s * 6)); buckets[bk].moveTo(m.x0, m.y0); buckets[bk].lineTo(m.x1, m.y1); }
    }
    x.lineWidth = Math.max(1 / k, 0.08); x.lineCap = 'round';
    buckets.forEach((p, i) => { x.strokeStyle = `rgba(255,${200 - i * 30},${80 - i * 12},${0.45 + i * 0.11})`; x.stroke(p); });
    if ($('#pvTravel', body).checked) { x.lineWidth = 0.7 / k; x.setLineDash([3 / k, 3 / k]); x.strokeStyle = 'rgba(255,60,60,.55)'; x.stroke(trav); x.setLineDash([]); }
    if (upto > 0 && upto < job.moves.length) { const m = job.moves[upto - 1]; x.fillStyle = '#4fd1ff'; x.beginPath(); x.arc(m.x1, m.y1, 4 / k, 0, 7); x.fill(); $('#pvT', body).textContent = `at ${fmtTime(m.t)}`; }
    else $('#pvT', body).textContent = '';
  };
  const sl = $('#pvSlider', body); sl.oninput = () => draw(+sl.value);
  // zoom (scroll / pinch) and pan (drag) in the preview; double-click resets
  c.style.cursor = 'grab';
  c.addEventListener('wheel', (e) => {
    e.preventDefault(); const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (e.shiftKey && !e.ctrlKey) { tx -= e.deltaY || e.deltaX; draw(+sl.value); return; }
    const f = wheelZoomFactor(e), nk = clamp(k * f, k0 * 0.3, k0 * 200), ff = nk / k;
    tx = mx - (mx - tx) * ff; ty = my - (my - ty) * ff; k = nk; draw(+sl.value);
  }, { passive: false });
  let pd = null;
  c.addEventListener('mousedown', (e) => { pd = { x: e.clientX, y: e.clientY, tx, ty }; c.style.cursor = 'grabbing'; });
  const pmove = (e) => { if (!pd) return; tx = pd.tx + e.clientX - pd.x; ty = pd.ty + e.clientY - pd.y; draw(+sl.value); };
  const pup = () => { pd = null; c.style.cursor = 'grab'; };
  window.addEventListener('mousemove', pmove); window.addEventListener('mouseup', pup);
  c.addEventListener('dblclick', () => { k = k0; tx = tx0; ty = ty0; draw(+sl.value); }); $('#pvTravel', body).onchange = () => draw(+sl.value);
  let anim = null;
  $('#pvPlay', body).onclick = () => {
    if (anim) { cancelAnimationFrame(anim); anim = null; $('#pvPlay', body).textContent = '▶ Play'; return; }
    if (+sl.value >= job.moves.length) sl.value = 0;
    $('#pvPlay', body).textContent = '❚❚ Pause';
    const stepN = Math.max(1, Math.ceil(job.moves.length / 600));
    const tick = () => { sl.value = Math.min(job.moves.length, +sl.value + stepN); draw(+sl.value); if (+sl.value < job.moves.length) anim = requestAnimationFrame(tick); else { anim = null; $('#pvPlay', body).textContent = '▶ Play'; } };
    tick();
  };
  setTimeout(() => draw(job.moves.length), 0);
  modal({
    title, body, width: W + 30, onClose: () => { anim && cancelAnimationFrame(anim); window.removeEventListener('mousemove', pmove); window.removeEventListener('mouseup', pup); }, buttons: [
      { label: 'Close' },
      { label: 'Cost…', onClick: () => { setTimeout(() => costCalculator(job), 0); } },
      { label: 'Save G-code…', onClick: async () => { const ext = S.device.gcodeExt || 'gcode'; await saveFile((S.fileName || 'job') + '.' + ext, job.gcode, [{ name: 'G-code', extensions: [ext] }]); return false; } },
      { label: 'Start job', cls: 'primary', onClick: () => startJob(job) }]
  });
}
function showGcodeFile(text, name) {
  const moves = Gcode.parse(text); const t = moves.length ? moves[moves.length - 1].t : 0;
  let cut = 0, trav = 0; moves.forEach(m => { const d = Math.hypot(m.x1 - m.x0, m.y1 - m.y0); if (m.s > 0) cut += d; else trav += d; });
  const job = { gcode: text, moves, stats: { time: t, cutDist: cut, travelDist: trav, lines: text.split('\n').length }, bounds: null };
  showPreview(job, `G-code file — ${name}`);
}


// ---------------------------------------------------------------- cost calculator
const COST_DEFAULTS = {
  currency: 'R', machineRate: 30, wattage: 72, tariff: 3.5, labourRate: 150, setupMin: 10, attend: true,
  markup: 50, vat: 0, consumables: 0, minCharge: 0, qty: 1, matBasis: 'area', margin: 3, waste: 10, gap: 3, matIdx: 0,
  materials: [{ name: '3mm plywood sheet', w: 600, h: 400, price: 0 }, { name: '3mm MDF sheet', w: 600, h: 400, price: 0 }, { name: 'Customer supplied', w: 0, h: 0, price: 0 }]
};
const costSettings = () => ({ ...COST_DEFAULTS, ...JSON.parse(localStorage.getItem('bf.cost') || '{}') });
function computeCost(c, job) {
  const t = job.stats.time, qty = Math.max(1, c.qty | 0), b = job.bounds || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const iw = b.x1 - b.x0 + 2 * c.margin, ih = b.y1 - b.y0 + 2 * c.margin;
  const hours = t * qty / 3600;
  const machine = hours * c.machineRate;
  const power = hours * c.wattage / 1000 * c.tariff;
  const labourH = c.setupMin / 60 + (c.attend ? hours : 0);
  const labour = labourH * c.labourRate;
  const m = c.materials[c.matIdx] || { w: 0, h: 0, price: 0 };
  let material = 0, matNote = '';
  if (m.price > 0 && m.w > 0 && m.h > 0 && iw > 0 && ih > 0) {
    if (c.matBasis === 'sheet') {
      const fit = (W, H) => Math.floor((W + c.gap) / (iw + c.gap)) * Math.floor((H + c.gap) / (ih + c.gap));
      const per = Math.max(fit(m.w, m.h), fit(m.h, m.w));
      if (per < 1) matNote = 'design is larger than the sheet';
      const sheets = per >= 1 ? Math.ceil(qty / per) : qty;
      material = sheets * m.price; matNote = matNote || `${sheets} sheet(s), ${per} per sheet`;
    } else {
      material = (iw * ih) / (m.w * m.h) * m.price * (1 + c.waste / 100) * qty;
      matNote = `${n2(iw * ih * qty / 100)} cm² used + ${c.waste}% waste`;
    }
  } else if (m.price > 0) matNote = 'set the sheet size'; else matNote = 'no material cost';
  const consumables = +c.consumables || 0;
  const sub = machine + power + labour + material + consumables;
  let total = sub * (1 + c.markup / 100);
  total = Math.max(total, +c.minCharge || 0);
  const vat = total * (c.vat || 0) / 100;
  return { t, qty, hours, machine, power, labour, labourH, material, matNote, consumables, sub, markup: total - sub, total: total + vat, vat, each: (total + vat) / qty, iw, ih, m };
}
const money = (c, v) => `${c.currency} ${(Math.round(v * 100) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function costLine(job) {
  if (!localStorage.getItem('bf.cost')) return '';
  const c = costSettings(); const r = computeCost({ ...c, qty: 1 }, job);
  return `<br>Cost ≈ <b>${money(c, r.total)}</b> each <span class="note">(${c.materials[c.matIdx]?.name || 'no material'})</span>`;
}
function costCalculator(job = buildJob()) {
  if (!job) return;
  const c = costSettings();
  const body = document.createElement('div'); body.className = 'costwrap';
  const matOpts = () => c.materials.map((m, i) => `<option value="${i}">${m.name}${m.price ? ` — ${c.currency}${m.price}` : ''}</option>`).join('');
  body.innerHTML = `
  <div class="form costform">
    <h5>Job</h5>
    <label>Quantity</label><input type="number" data-c="qty" min="1" step="1">
    <label>Time per item</label><div><b>${fmtTime(job.stats.time)}</b> <span class="note">${job.bounds ? `· ${n2(job.bounds.x1 - job.bounds.x0)} × ${n2(job.bounds.y1 - job.bounds.y0)} mm` : ''}</span></div>
    <h5>Machine</h5>
    <label>Currency symbol</label><input type="text" data-c="currency" style="width:60px">
    <label>Machine rate per hour</label><input type="number" data-c="machineRate" min="0" step="1" title="Wear, diode life, depreciation">
    <label>Power draw (W)</label><input type="number" data-c="wattage" min="0" step="1" title="Whole machine at the wall, incl. air assist">
    <label>Electricity per kWh</label><input type="number" data-c="tariff" min="0" step="0.05">
    <h5>Labour</h5>
    <label>Labour rate per hour</label><input type="number" data-c="labourRate" min="0" step="5">
    <label>Setup / design / finishing (min)</label><input type="number" data-c="setupMin" min="0" step="1">
    <label>Operator watches the job</label><input type="checkbox" data-c="attend" title="Lasers must not run unattended — charge labour for the run time">
    <h5>Material</h5>
    <label>Material</label><div class="row tight"><select data-c="matIdx" style="flex:1">${matOpts()}</select><button class="small" id="cmEdit">Edit…</button></div>
    <label>Charge material by</label><select data-c="matBasis"><option value="area">Area used (+ waste %)</option><option value="sheet">Whole sheets</option></select>
    <label>Margin around design (mm)</label><input type="number" data-c="margin" min="0" step="1">
    <label class="cb-area">Waste allowance (%)</label><input class="cb-area" type="number" data-c="waste" min="0" step="1">
    <label class="cb-sheet">Gap between items (mm)</label><input class="cb-sheet" type="number" data-c="gap" min="0" step="1">
    <h5>Pricing</h5>
    <label>Other consumables (per job)</label><input type="number" data-c="consumables" min="0" step="1" title="Masking tape, paint, packaging…">
    <label>Markup (%)</label><input type="number" data-c="markup" min="0" step="5">
    <label>Minimum charge</label><input type="number" data-c="minCharge" min="0" step="10">
    <label>VAT (%)</label><input type="number" data-c="vat" min="0" step="1" title="Leave 0 if you are not VAT registered">
  </div>
  <div class="costout" id="costOut"></div>`;
  const ins = $$('[data-c]', body);
  ins.forEach(i => { const v = c[i.dataset.c]; if (i.type === 'checkbox') i.checked = !!v; else i.value = v; });
  const sync = () => {
    ins.forEach(i => c[i.dataset.c] = i.type === 'checkbox' ? i.checked : i.type === 'number' || i.tagName === 'SELECT' && i.dataset.c === 'matIdx' ? +i.value : i.value);
    $$('.cb-area', body).forEach(e => e.style.display = c.matBasis === 'area' ? '' : 'none');
    $$('.cb-sheet', body).forEach(e => e.style.display = c.matBasis === 'sheet' ? '' : 'none');
    localStorage.setItem('bf.cost', JSON.stringify(c));
    const r = computeCost(c, job); body._r = r;
    const row = (k, v, n = '') => `<div class="crow"><span>${k}${n ? `<small>${n}</small>` : ''}</span><b>${money(c, v)}</b></div>`;
    $('#costOut', body).innerHTML = `
      <div class="cbig"><span>Total${r.qty > 1 ? ` for ${r.qty}` : ''}</span><b>${money(c, r.total)}</b></div>
      ${r.qty > 1 ? `<div class="crow each"><span>Per item</span><b>${money(c, r.each)}</b></div>` : ''}
      <div class="crow"><span>Laser time</span><b>${fmtTime(r.t * r.qty)}</b></div>
      ${row('Machine use', r.machine, `${n2(r.hours)} h × ${c.currency}${c.machineRate}`)}
      ${row('Electricity', r.power, `${n2(r.hours * c.wattage / 1000)} kWh`)}
      ${row('Labour', r.labour, `${n2(r.labourH)} h`)}
      ${row('Material', r.material, r.matNote)}
      ${r.consumables ? row('Consumables', r.consumables) : ''}
      <div class="crow sub"><span>Cost price</span><b>${money(c, r.sub)}</b></div>
      ${row(`Markup ${c.markup}%${c.minCharge && r.total - r.vat <= c.minCharge + 0.001 && r.sub * (1 + c.markup / 100) < c.minCharge ? ' (min. charge)' : ''}`, r.markup)}
      ${r.vat ? row(`VAT ${c.vat}%`, r.vat) : ''}
      <div class="note" style="margin-top:8px">Time uses this machine's estimate${S.device.calibJobs ? `, calibrated from ${S.device.calibJobs} real job(s)` : ''}. Settings are remembered.</div>`;
  };
  body.oninput = sync; body.onchange = sync;
  $('#cmEdit', body).onclick = () => editMaterials(c, () => { $('[data-c=matIdx]', body).innerHTML = matOpts(); $('[data-c=matIdx]', body).value = c.matIdx; sync(); });
  sync();
  modal({
    title: 'Job cost', body, width: 820, onClose: () => { if (S.est) S.est.key = ''; scheduleEstimate(); }, buttons: [
      { label: 'Copy summary', onClick: async () => {
          const r = body._r; const name = S.fileName || 'Laser job';
          const txt = [`${name}`, `Quantity: ${r.qty}`, `Size: ${n2(r.iw - 2 * c.margin)} × ${n2(r.ih - 2 * c.margin)} mm`, `Laser time: ${fmtTime(r.t * r.qty)}`,
            `Material: ${r.m.name || '-'}`, r.qty > 1 ? `Price per item: ${money(c, r.each)}` : '', `Total: ${money(c, r.total)}${c.vat ? ` (incl. VAT ${c.vat}%)` : ''}`].filter(Boolean).join('\n');
          try { await navigator.clipboard.writeText(txt); toast('Summary copied to clipboard', 'ok'); } catch { toast('Could not access the clipboard', 'err'); }
          return false; } },
      { label: 'Close', cls: 'primary' }]
  });
}
function editMaterials(c, done) {
  const ov = document.createElement('div'); ov.id = 'modal2';
  const draw = () => {
    ov.innerHTML = `<div class="dlg" style="width:560px"><header><span class="title">Materials &amp; sheet prices</span></header><div class="body">
      <div class="matgrid head"><span>Name</span><span>Sheet W (mm)</span><span>Sheet H (mm)</span><span>Price (${c.currency})</span><span></span></div>
      ${c.materials.map((m, i) => `<div class="matgrid" data-i="${i}"><input data-f="name" value="${m.name.replace(/"/g, '&quot;')}"><input type="number" data-f="w" value="${m.w}"><input type="number" data-f="h" value="${m.h}"><input type="number" data-f="price" step="0.5" value="${m.price}"><button class="small" data-del="${i}">✕</button></div>`).join('')}
      <button class="small" id="mAdd" style="margin-top:8px">+ Add material</button>
      <p class="note">Enter what you pay per sheet. “Area used” charges the share of the sheet your design takes up.</p></div>
      <footer><button id="mOk" class="primary">Done</button></footer></div>`;
    $$('.matgrid[data-i] input', ov).forEach(inp => inp.oninput = () => { const m = c.materials[+inp.parentElement.dataset.i]; m[inp.dataset.f] = inp.type === 'number' ? +inp.value : inp.value; });
    $$('[data-del]', ov).forEach(b => b.onclick = () => { c.materials.splice(+b.dataset.del, 1); if (c.matIdx >= c.materials.length) c.matIdx = Math.max(0, c.materials.length - 1); draw(); });
    $('#mAdd', ov).onclick = () => { c.materials.push({ name: 'New material', w: 600, h: 400, price: 0 }); draw(); };
    $('#mOk', ov).onclick = () => { if (!c.materials.length) c.materials.push({ name: 'Customer supplied', w: 0, h: 0, price: 0 }); localStorage.setItem('bf.cost', JSON.stringify(c)); ov.remove(); done(); };
  };
  document.body.appendChild(ov); draw();
}


// ---------------------------------------------------------------- updates
let pendingUpdate = null;
function updateBanner(ev) {
  $('#updBar')?.remove();
  const b = document.createElement('div'); b.id = 'updBar';
  b.innerHTML = `<span>⬆︎ <b>BeamForge ${ev.version}</b> is ready${ev.notes ? ' — ' + ev.notes.split('\n')[0].replace(/</g, '&lt;') : ''}</span><span class="grow"></span><button class="small" id="updLater">Later</button><button class="small primary" id="updNow">Restart now</button>`;
  document.body.appendChild(b);
  $('#updLater').onclick = () => b.remove();
  $('#updNow').onclick = () => restartForUpdate();
}
async function restartForUpdate() {
  if (grbl.job) { toast('A laser job is running — restart after it finishes', 'err'); return; }
  if (S.dirty && S.doc.objects.length && !(await confirmBox('Restart to update', 'Your design is kept (it is auto-saved), but save it to a file first if you want a copy. Restart now?', 'Restart'))) return;
  try { localStorage.setItem('bf.autosave', JSON.stringify({ doc: serializeDoc(), name: S.fileName, path: S.filePath })); } catch (e) { }
  if (grbl.connected) await grbl.disconnect();
  NATIVE.restartToUpdate();
}
async function installUpdateBytes(u8) {
  if (!NATIVE?.installUpdate) { toast('Updates only work in the Mac app', 'err'); return; }
  setMsg('Installing update…'); const r = await NATIVE.installUpdate(u8); setMsg('');
  return r;
}
async function updatesDialog() {
  if (!NATIVE?.appInfo) { toast('Updates only work in the Mac app', 'err'); return; }
  const info = await NATIVE.appInfo();
  const body = document.createElement('div');
  body.innerHTML = `<div class="form">
    <label>Installed version</label><div><b>${info.version}</b> <span class="note">${info.source === 'update' ? `(updated from ${info.bundledVersion})` : ''}</span></div>
    ${pendingUpdate ? `<label>Ready to install</label><div><b>${pendingUpdate.version}</b> — restart to use it</div>` : ''}
    <h5>Automatic updates</h5>
    <label>Update address</label><input type="text" id="uUrl" placeholder="https://…/latest.json" value="${(info.url || '').replace(/"/g, '&quot;')}">
    <label>Check automatically</label><div class="row tight" style="margin:0"><input type="checkbox" id="uAuto" ${info.auto ? 'checked' : ''}><span class="note">at start-up and every 6 hours; downloads in the background and asks before restarting</span></div>
    <label>Last check</label><div class="note" id="uLast">${info.lastCheck ? new Date(info.lastCheck).toLocaleString() + ' — ' + (info.lastResult || '') : 'never'}</div>
    <div class="full note">Updates never interrupt a running laser job. If an update fails to start, BeamForge automatically goes back to the previous version.</div>
  </div>`;
  const save = () => NATIVE.updateSettings({ url: $('#uUrl', body).value, auto: $('#uAuto', body).checked });
  body.onchange = save;
  modal({
    title: 'Updates', body, width: 560, buttons: [
      { label: 'Install update file…', onClick: async () => { await save(); setTimeout(() => run('installUpdateFile'), 0); } },
      { label: 'Check now', onClick: async () => { await save(); NATIVE.checkUpdates(); return false; } },
      { label: 'Close', cls: 'primary', onClick: save }]
  });
  if (pendingUpdate) $('#modal footer').insertAdjacentHTML('afterbegin', '<button class="primary" id="uRestart" style="margin-right:auto">Restart now</button>'), $('#uRestart').onclick = () => restartForUpdate();
}
if (NATIVE?.onUpdate) NATIVE.onUpdate((ev) => {
  if (ev.type === 'ready') { pendingUpdate = ev; updateBanner(ev); if (NATIVE.notify) NATIVE.notify('BeamForge update ready', `Version ${ev.version} — restart BeamForge to use it`); }
  else if (ev.type === 'checking') setMsg('Checking for updates…');
  else if (ev.type === 'downloading') setMsg(`Downloading BeamForge ${ev.version}…`);
  else if (ev.type === 'none') { setMsg(''); toast(`BeamForge ${ev.version} is up to date`, 'ok'); }
  else if (ev.type === 'info') { setMsg(''); toast(ev.message); }
  else if (ev.type === 'error') { setMsg(''); if (ev.manual) toast('Update: ' + ev.message, 'err'); else console.warn('update check:', ev.message); }
  else if (ev.type === 'rolledback') toast(`Update ${ev.version} didn't start properly, so BeamForge went back to the previous version.`, 'err');
  const last = $('#uLast'); if (last && ev.type !== 'checking') NATIVE.appInfo().then(i => { last.textContent = i.lastCheck ? new Date(i.lastCheck).toLocaleString() + ' — ' + (i.lastResult || '') : 'never'; });
});

// ---------------------------------------------------------------- machine UI
function startJob(job) {
  if (!grbl.connected) { toast('Connect to the laser first (or use the Simulator)', 'err'); return false; }
  if (grbl.job) { toast('A job is already running', 'err'); return false; }
  const st = S.status?.state || '';
  if (st.startsWith('Alarm')) { toast('Machine is in ALARM — Home or Unlock first', 'err'); return false; }
  if (S.device.laserModeWarn !== false && grbl.settings['32'] === 0) toast('Warning: GRBL laser mode is off ($32=0). Send $32=1 in the Console.', 'err');
  const lineT = []; let mi = 0, lastT = 0;
  for (const raw of job.gcode.split('\n')) { const l = raw.replace(/;.*$/, '').replace(/\(.*?\)/g, '').trim(); if (!l) continue; if (/^G[01]\b/.test(l) && job.moves[mi]) lastT = job.moves[mi++].t; lineT.push(lastT); }
  try { grbl.runJob(job.gcode, S.fileName); S.run = { est: job.stats.time, raw: job.stats.rawTime, lineT, hold: 0, holdStart: 0, start: Date.now(), real: grbl.t instanceof SerialTransport }; toast(`Job started — estimated ${fmtTime(job.stats.time)}`, 'ok'); } catch (e) { toast(e.message, 'err'); return false; }
}
$('#btnStart').onclick = () => { const j = buildJob(); if (j) startJob(j); };
$('#btnPause').onclick = () => { if (!need()) return; const st = S.status?.state || ''; if (st.startsWith('Hold')) grbl.resume(); else grbl.pause(); };
$('#btnStop').onclick = () => { if (!need()) return; grbl.stop(); toast('Stopped (soft reset). Machine may need homing/unlocking.', 'err'); };
$('#btnConnect').onclick = async () => {
  if (grbl.connected) { await grbl.disconnect(); return; }
  const kind = $('#connKind').value;
  if (kind === 'serial' && !SerialTransport.available()) { toast('Web Serial is not available in this browser — use the Mac app', 'err'); return; }
  $('#btnConnect').disabled = true;
  try { await grbl.connect(kind, +$('#baud').value); }
  catch (e) { if (!/No port selected|cancel/i.test(e.message)) toast('Connect failed: ' + e.message, 'err'); }
  finally { $('#btnConnect').disabled = false; }
};
grbl.on('conn', (on, name) => {
  $('#btnConnect').textContent = on ? 'Disconnect' : 'Connect'; $('#btnConnect').classList.toggle('primary', !on);
  if (on) toast('Connected to ' + name, 'ok'); requestRender();
});
let lastStatusRender = 0;
grbl.on('status', (st) => {
  S.status = st; const s = st.state.split(':')[0];
  const p = $('#mState'); p.textContent = st.state; p.className = 'pill ' + s;
  $('#mPos').textContent = `X ${n2(st.wpos[0])}  Y ${n2(st.wpos[1])}` + (st.wpos[2] ? `  Z ${n2(st.wpos[2])}` : '');
  $('#btnPause').querySelector('span').textContent = s === 'Hold' ? 'Resume' : 'Pause';
  const R = S.run;
  if (R) {
    if (s === 'Hold' && !R.holdStart) R.holdStart = Date.now();
    if (s !== 'Hold' && R.holdStart) { R.hold += Date.now() - R.holdStart; R.holdStart = 0; }
    if (R.finished && s === 'Idle') finishRun();
  }
  if (performance.now() - lastStatusRender > 100) { lastStatusRender = performance.now(); requestRender(); }
});
grbl.on('job', (j) => {
  const pct = j.total ? j.acked / j.total : 0; $('#progBar').style.width = (pct * 100).toFixed(1) + '%';
  const el = (Date.now() - j.start) / 1000;
  const R = S.run;
  if (j.aborted) { $('#progText').textContent = `Aborted at ${(pct * 100).toFixed(1)}% after ${fmtTime(el)}`; S.run = null; return; }
  if (j.done) { if (R) { R.finished = true; R.errors = j.errors; $('#progText').textContent = 'Finishing last moves…'; } else $('#progText').textContent = `Done in ${fmtTime(el)}`; return; }
  let remaining = Math.max(0, (R ? R.est : 0) - el);
  if (R && R.lineT.length) {
    const tDone = R.lineT[Math.min(j.acked, R.lineT.length - 1)] || 0;
    const active = (Date.now() - R.start - R.hold - (R.holdStart ? Date.now() - R.holdStart : 0)) / 1000;
    const rate = tDone > 15 ? clamp(active / tDone, 0.5, 2.5) : 1;
    remaining = Math.max(0, (R.est - tDone) * rate);
  }
  const done = R && R.est ? clamp(1 - remaining / Math.max(R.est, 1), 0, 1) : pct;
  $('#progBar').style.width = (done * 100).toFixed(1) + '%';
  $('#progText').textContent = `${(done * 100).toFixed(0)}% · elapsed ${fmtTime(el)} · remaining ~${fmtTime(remaining)}${R ? ` · est. total ${fmtTime(R.est)}` : ''}`;
});
function finishRun() {
  const R = S.run; S.run = null; if (!R) return;
  const actual = (Date.now() - R.start - R.hold) / 1000;
  $('#progBar').style.width = '100%';
  const diff = R.est ? Math.round((actual / R.est - 1) * 100) : 0;
  $('#progText').textContent = `Done in ${fmtTime(actual)} (estimated ${fmtTime(R.est)}, ${diff >= 0 ? '+' : ''}${diff}%)${R.errors ? ` — ${R.errors} error(s), see Console` : ''}`;
  toast(`Job complete in ${fmtTime(actual)}`, 'ok'); if (NATIVE?.notify) NATIVE.notify('BeamForge', 'Laser job complete');
  // learn from real jobs so future estimates match this machine
  if (R.real && actual > 30 && R.raw > 10) {
    const ratio = clamp(actual / R.raw, 0.4, 4), old = S.device.timeFactor;
    S.device.timeFactor = +(old && S.device.calibJobs ? old * 0.6 + ratio * 0.4 : ratio).toFixed(3);
    S.device.calibJobs = (S.device.calibJobs || 0) + 1;
    localStorage.setItem('bf.device', JSON.stringify(S.device)); S.ver = (S.ver || 0) + 1; scheduleEstimate();
  }
}
let estT = 0;
function scheduleEstimate() {
  clearTimeout(estT);
  estT = setTimeout(() => {
    const key = [S.ver, $('#optSel').checked, $('#optSel').checked ? [...S.sel].join() : '', S.device.accel, S.device.timeFactor, S.doc.objects.length].join('|');
    if (S.est && S.est.key === key) return;
    let job = null; try { job = S.doc.objects.length ? buildJob(true) : null; } catch (e) { console.error(e); }
    S.est = job ? { key, total: job.stats.time, cut: job.stats.cutTime, travel: job.stats.travelTime, layers: job.stats.layerTimes, job } : { key, total: 0, layers: {} };
    $('#jobEst').innerHTML = job ? `Estimated time <b>${fmtTime(job.stats.time)}</b> <span class="note">(laser ${fmtTime(job.stats.cutTime)} · travel ${fmtTime(job.stats.travelTime)})</span>${costLine(job)}` : '<span class="note">Nothing to cut yet</span>';
    renderLayerList();
  }, 450);
}
grbl.on('settings', (st) => {
  const a = Math.min(st['120'] || Infinity, st['121'] || Infinity);
  const r = Math.min(st['110'] || Infinity, st['111'] || Infinity); if (isFinite(r) && r > 0) S.device.rapid = r;
  if (isFinite(a) && a > 0 && S.device.accel !== a) { S.device.accel = a; localStorage.setItem('bf.device', JSON.stringify(S.device)); S.ver = (S.ver || 0) + 1; scheduleEstimate(); }
});
grbl.on('alarm', () => toast('Machine ALARM — see Console', 'err'));
const logEl = $('#log');
grbl.on('opt', () => applyBuffer());
grbl.on('log', (l, cls) => {
  if (S.device.hideMsg !== false && /^\[MSG:\s*(INFO|DBG|DEBUG|VERBOSE)/i.test(l)) return;
  const d = document.createElement('div'); d.className = cls || ''; d.textContent = l; logEl.appendChild(d);
  while (logEl.childElementCount > 1500) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
});
const hist = []; let hi = -1;
const sendCmd = () => { const v = $('#cmdIn').value.trim(); if (!v) return; if (!need()) return; grbl.send(v); hist.unshift(v); hi = -1; $('#cmdIn').value = ''; };
$('#cmdSend').onclick = sendCmd;
$('#cmdIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCmd();
  else if (e.key === 'ArrowUp') { hi = Math.min(hist.length - 1, hi + 1); if (hist[hi]) $('#cmdIn').value = hist[hi]; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { hi = Math.max(-1, hi - 1); $('#cmdIn').value = hi >= 0 ? hist[hi] : ''; e.preventDefault(); }
});
$$('[data-send]').forEach(b => b.onclick = () => { if (need()) grbl.send(b.dataset.send); });
$('#clearLog').onclick = () => logEl.innerHTML = '';
$$('[data-jog]').forEach(b => b.onclick = () => { if (!need()) return; const [dx, dy] = b.dataset.jog.split(',').map(Number), st = +$('#jogStep').value; grbl.jog(dx * st, dy * st, 0, +$('#jogFeed').value || 3000); });
$$('[data-jogz]').forEach(b => b.onclick = () => { if (!need()) return; grbl.jog(0, 0, +b.dataset.jogz * Math.min(+$('#jogStep').value, 10), 500); });

function showTab(t) { $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t)); $$('.tab').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t)); }
$$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

function deviceSettings() {
  const d = S.device; const f = document.createElement('div'); f.className = 'form';
  f.innerHTML = `<h5>Machine</h5>
    <label>Device name</label><input type="text" data-k="name">
    <label>Work area width X (mm)</label><input type="number" data-k="width" min="10">
    <label>Work area height Y (mm)</label><input type="number" data-k="height" min="10">
    <label>Max S value ($30)</label><input type="number" data-k="sMax" min="1" title="Must match GRBL $30 — usually 1000 (some use 255)">
    <label>Rapid speed for estimates (mm/min)</label><input type="number" data-k="rapid" min="100">
    <label>Frame speed (mm/min)</label><input type="number" data-k="frameFeed" min="100">
    <label>Controller buffer size (bytes)</label><input type="number" data-k="bufferSize" min="0" max="16384" title="0 = automatic (127 for GRBL, or what the controller reports). Set this if your firmware reports it wrongly or not at all.">
    <label>G-code file extension</label><select data-k="gcodeExt"><option value="gcode">.gcode</option><option value="nc">.nc</option><option value="gc">.gc</option><option value="ngc">.ngc</option><option value="txt">.txt</option></select>
    <label>Hide FluidNC info messages</label><input type="checkbox" data-k="hideMsg" title="Hide [MSG:INFO] / [MSG:DBG] chatter in the Console">
    <label>Acceleration (mm/s²)</label><input type="number" data-k="accel" min="50" title="Read automatically from GRBL $120/$121 when connected">
    <label>Time estimate factor</label><input type="number" data-k="timeFactor" min="0.3" max="4" step="0.01" title="1 = raw estimate. Learns automatically from finished jobs on the real laser.">
    <label>Return to origin when done</label><input type="checkbox" data-k="returnHome">
    <h5>G-code</h5>
    <label class="full">Start G-code (added after G90 G21)</label><textarea class="full" data-k="header" placeholder="e.g. $H"></textarea>
    <label class="full">End G-code</label><textarea class="full" data-k="footer"></textarea>
    <h5>Interface</h5>
    <label>Mouse wheel / trackpad</label><select data-k="wheel"><option value="zoom">Scroll zooms (hold Shift or Space to pan)</option><option value="pan">Scroll pans (pinch or ⌘+scroll zooms)</option><option value="auto">Auto (mouse wheel zooms, trackpad scroll pans)</option></select>
    <div class="full note">GRBL must be in laser mode (<b>$32=1</b>) for safe, dynamic-power engraving. Read your controller's $30 value from the Console with $$.</div>`;
  const ins = $$('[data-k]', f);
  ins.forEach(i => { if (i.type === 'checkbox') i.checked = !!d[i.dataset.k]; else i.value = d[i.dataset.k] ?? ''; });
  modal({
    title: 'Device settings', body: f, width: 520, buttons: [{ label: 'Cancel' }, {
      label: 'Save', cls: 'primary', onClick: () => {
        ins.forEach(i => d[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value);
        localStorage.setItem('bf.device', JSON.stringify(d)); applyBuffer(); S.ver = (S.ver || 0) + 1; scheduleEstimate(); zoomFit(); toast('Device settings saved', 'ok');
      }
    }]
  });
}

// ---------------------------------------------------------------- drag & drop
const stage = $('#stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drag'); });
stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault(); stage.classList.remove('drag');
  for (const f of e.dataTransfer.files) await importFile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
});
document.addEventListener('paste', async (e) => {
  if (typing()) return;
  const items = [...(e.clipboardData?.items || [])]; const img = items.find(i => i.type.startsWith('image/'));
  if (img) { const f = img.getAsFile(); await importFile({ name: 'pasted.' + (img.type.split('/')[1] || 'png'), data: new Uint8Array(await f.arrayBuffer()) }); e.preventDefault(); return; }
  const svgT = e.clipboardData?.getData('text/plain'); if (svgT && svgT.trim().startsWith('<svg')) { await importFile({ name: 'pasted.svg', data: new TextEncoder().encode(svgT) }); e.preventDefault(); return; }
  if (NATIVE) return; run('paste');
});

// ---------------------------------------------------------------- NATIVE bridges
if (NATIVE) {
  NATIVE.onMenu((cmd) => { if (cmd === 'save-as') run('saveAs'); else run(cmd); });
  let portModal = null;
  NATIVE.onSerialPorts((ports) => {
    const html = ports.length ? ports.map(p => `<div class="portItem" data-id="${p.portId}"><b>${p.displayName || p.portName}</b><div class="note">${p.portName}${p.vendorId ? ` · VID ${p.vendorId} PID ${p.productId}` : ''}</div></div>`).join('')
      : '<p class="note">No serial ports found. Plug in the laser via USB and make sure its driver (CH340 / CP210x) is installed. The list updates automatically.</p>';
    const fill = (B) => { B.innerHTML = html; $$('.portItem', B).forEach(el => el.onclick = () => { NATIVE.chooseSerial(el.dataset.id); portModal.picked = true; portModal.close(); }); };
    if (portModal && modalOpen()) { fill(portModal.body); return; }
    portModal = modal({ title: 'Choose your laser’s serial port', body: '', buttons: [{ label: 'Cancel' }], onClose: () => { if (!portModal.picked) NATIVE.chooseSerial(''); portModal = null; } });
    portModal.picked = false; fill(portModal.body);
  });
  NATIVE.onOpenFile?.(async (f) => importFile({ name: f.name, path: f.path, data: new Uint8Array(f.data) }));
}

// ---------------------------------------------------------------- boot
applyIcons(); applyCmdButtons();
$$('#tools [data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
// tooltips: platform modifiers
if (!isMac) $$('[title]').forEach(el => el.title = el.title.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+'));
try {
  const a = JSON.parse(localStorage.getItem('bf.autosave') || 'null');
  if (a && a.doc && a.doc.objects?.length) { loadDoc(a.doc); S.fileName = a.name || 'Untitled'; S.filePath = a.path || null; }
} catch (e) { }
updateTitle(); resize(); setTool('select'); commit();
setTimeout(zoomFit, 30);
window.BF = { S, cmds, run, importFile, buildJob, grbl, worldPaths, addObjects, commit, objBox, boxOf, switchPage }; // for scripting/tests
// report a healthy start only if nothing crashed while starting (otherwise the launcher rolls back)
setTimeout(() => { if (NATIVE?.appReady && !window.__bootErrors) NATIVE.appReady(); }, 1500);
