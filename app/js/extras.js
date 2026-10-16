// Rotary setup, camera overlay, online vector library (Iconify).
// Loaded after app.js and uses its helpers.
'use strict';
const Extras = (() => {
  const saveDevice = () => { try { localStorage.setItem('bf.device', JSON.stringify(S.device)); } catch (e) { } S.ver = (S.ver || 0) + 1; scheduleEstimate(); requestRender(); };

  // ================================================================== rotary
  const ROT_DEF = { enabled: false, type: 'roller', mmPerRot: 0, rollerDia: 25, objectDia: 80 };
  const rot = () => ({ ...ROT_DEF, ...(S.device.rotary || {}) });
  function updateRotChip() { const r = rot(), c = $('#rotChip'); if (c) { c.classList.toggle('hidden', !r.enabled); c.textContent = r.enabled ? `Rotary Ø${n2(r.objectDia).replace(/\.00$/, '')}` : 'Rotary'; } }
  function rotaryDialog() {
    const r = rot(), body = document.createElement('div');
    body.innerHTML = `<div class="form">
      <label>Rotary enabled</label><input type="checkbox" id="roEn" ${r.enabled ? 'checked' : ''}>
      <label>Type</label><select id="roType"><option value="roller">Roller (object sits on rollers)</option><option value="chuck">Chuck (object is clamped)</option></select>
      <label>Object diameter (mm)</label><input type="text" id="roObj" value="${r.objectDia}">
      <label class="ro-r">Roller diameter (mm)</label><input class="ro-r" type="text" id="roRoll" value="${r.rollerDia}">
      <label>Travel per rotation (mm)</label><div class="row tight" style="margin:0"><input type="text" id="roMPR" value="${r.mmPerRot || ''}" placeholder="auto" style="width:90px"><button class="small" id="roTest">Rotate one turn</button></div>
      <div class="full note" id="roInfo"></div>
      <div class="full note">How to set up: plug the rotary into the <b>Y</b> port. Put a tape mark on the ${r.type === 'chuck' ? 'chuck' : 'roller'}, click <b>Rotate one turn</b> and adjust “Travel per rotation” until it turns exactly once (leave it empty if your rotary is already calibrated in mm). Design in the normal way — the design's height wraps around the object. Use <b>Start from: Current position</b>, with the laser parked on the object.</div></div>`;
    const q = (id) => $(id, body); q('#roType').value = r.type;
    const read = () => ({ enabled: q('#roEn').checked, type: q('#roType').value, objectDia: Math.max(1, evalNum(q('#roObj').value) || 80), rollerDia: Math.max(1, evalNum(q('#roRoll').value) || 25), mmPerRot: Math.max(0, evalNum(q('#roMPR').value) || 0) });
    const info = () => { const v = read(); $$('.ro-r', body).forEach(e => e.style.display = v.type === 'roller' ? '' : 'none');
      const circ = Math.PI * v.objectDia, k = Gcode.rotaryScale(v);
      q('#roInfo').innerHTML = `Circumference <b>${n2(circ)} mm</b> — a design up to that tall wraps all the way round. Y is scaled × ${n2(k)}${v.mmPerRot ? '' : ' (no scaling: rotary already set up in mm)'}.`; };
    body.oninput = info; body.onchange = info; info();
    q('#roTest').onclick = () => { if (!grbl.connected) return toast('Connect to the laser first', 'err'); const v = read(); const d = v.mmPerRot || Math.PI * (v.type === 'roller' ? v.rollerDia : v.objectDia); grbl.jog(0, d, 0, 800); toast(`Sent one turn (${n2(d)} mm on Y)`); };
    modal({ title: 'Rotary setup', body, width: 560, buttons: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: () => { S.device.rotary = read(); saveDevice(); updateRotChip(); toast(S.device.rotary.enabled ? 'Rotary on — the design height wraps around the object' : 'Rotary off', 'ok'); } }] });
  }
  function drawRotaryGuide(ctx, w2s) {
    const r = rot(); if (!r.enabled) return;
    const circ = Math.PI * r.objectDia, [x0, y0] = w2s(0, Math.min(circ, S.device.height * 4)), [x1, y1] = w2s(S.device.width, 0);
    ctx.save(); ctx.fillStyle = 'rgba(79,209,255,.06)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(79,209,255,.7)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x0, y0 + .5); ctx.lineTo(x1, y0 + .5); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#4fd1ff'; ctx.font = '11px -apple-system'; ctx.textAlign = 'left'; ctx.fillText(`Rotary: one full turn of a Ø${n2(r.objectDia)} mm object (${n2(circ)} mm)`, x0 + 6, y0 - 6);
    ctx.restore();
  }

  // ================================================================== camera
  let camStream = null, overlay = null; // overlay = { canvas, at }
  const cam = () => ({ opacity: 0.85, show: true, ppm: 2, power: 20, speed: 1000, ...(S.device.camera || {}) });
  function solveH(src, dst) { // 4 point pairs → 3x3 homography (h33 = 1)
    const A = [], b = [];
    for (let i = 0; i < 4; i++) { const [u, v] = src[i], [x, y] = dst[i]; A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x); A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y); }
    for (let c = 0; c < 8; c++) { // gaussian elimination with pivoting
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) throw new Error('Those points are in a line — click the four marks again');
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const h = b.map((v, i) => v / A[i][i]); h.push(1); return h;
  }
  const applyH = (h, u, v) => { const w = h[6] * u + h[7] * v + h[8]; return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w]; };
  const marks = () => { const W = S.device.width, H = S.device.height, i = Math.min(25, Math.min(W, H) / 6); return [[i, i], [W - i, i], [W - i, H - i], [i, H - i]]; };
  async function openStream(deviceId) {
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = camStream; await v.play();
    await new Promise(r => setTimeout(r, 300)); return v;
  }
  function grab(video) { const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0); return c; }
  function warp(frame, Hbed2img, ppm) {
    const W = S.device.width, H = S.device.height, ow = Math.round(W * ppm), oh = Math.round(H * ppm);
    const src = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height), sd = src.data, fw = frame.width, fh = frame.height;
    const out = document.createElement('canvas'); out.width = ow; out.height = oh; const oc = out.getContext('2d'), od = oc.createImageData(ow, oh);
    for (let y = 0; y < oh; y++) {
      const by = H - (y + 0.5) / ppm;
      for (let x = 0; x < ow; x++) {
        const [u, v] = applyH(Hbed2img, (x + 0.5) / ppm, by), iu = u | 0, iv = v | 0, k = 4 * (y * ow + x);
        if (iu < 0 || iv < 0 || iu >= fw || iv >= fh) { od.data[k + 3] = 0; continue; }
        const s = 4 * (iv * fw + iu); od.data[k] = sd[s]; od.data[k + 1] = sd[s + 1]; od.data[k + 2] = sd[s + 2]; od.data[k + 3] = 255;
      }
    }
    oc.putImageData(od, 0, 0); return out;
  }
  function drawOverlay(ctx, w2s) {
    const c = cam(); if (!overlay || !c.show) return;
    const [x0, y0] = w2s(0, S.device.height), [x1, y1] = w2s(S.device.width, 0);
    ctx.save(); ctx.globalAlpha = c.opacity; ctx.imageSmoothingEnabled = true; ctx.drawImage(overlay.canvas, x0, y0, x1 - x0, y1 - y0); ctx.restore();
  }
  async function cameraDialog() {
    if (!navigator.mediaDevices?.getUserMedia) return toast('No camera support available', 'err');
    const c = cam(), body = document.createElement('div'); body.className = 'camwrap';
    body.innerHTML = `<div><canvas id="caPv" width="640" height="360"></canvas><div class="note" id="caMsg"></div></div>
      <div class="form gform">
        <label>Camera</label><select id="caDev"><option value="">Default camera</option></select>
        <h5>1 · Burn alignment marks</h5>
        <label>Mark speed / power</label><div class="row tight" style="margin:0"><input type="text" id="caSp" value="${c.speed}" style="width:64px"><input type="text" id="caPw" value="${c.power}" style="width:44px">%</div>
        <div class="full"><button id="caBurn" class="small">Burn 4 marks on scrap</button> <span class="note">Put a sheet of scrap on the bed first.</span></div>
        <h5>2 · Align</h5>
        <div class="full"><button id="caAlign" class="small">Click the 4 marks in the picture</button> <span class="note" id="caAl">${c.H ? '✓ aligned' : 'not aligned yet'}</span></div>
        <h5>3 · Overlay</h5>
        <div class="full"><button id="caUpd" class="small primary">Update overlay</button></div>
        <label>Show on the design</label><input type="checkbox" id="caShow" ${c.show ? 'checked' : ''}>
        <label>Opacity</label><input type="range" id="caOp" min="0.1" max="1" step="0.05" value="${c.opacity}">
        <div class="full note">Mount the camera above the bed so it sees the whole work area. Cameras with strong fisheye lenses bend straight lines and will be less accurate near the edges.</div>
      </div>`;
    const q = (id) => $(id, body); let video = null, mode = 'live', clicks = [], still = null, raf = 0;
    const msg = (t) => q('#caMsg').innerHTML = t;
    const pv = q('#caPv'), px = pv.getContext('2d');
    const fit = (w, h) => { const k = Math.min(pv.width / w, pv.height / h); return { k, ox: (pv.width - w * k) / 2, oy: (pv.height - h * k) / 2 }; };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const src = mode === 'align' ? still : video; if (!src) return;
      const w = src.videoWidth || src.width, h = src.videoHeight || src.height; if (!w) return;
      const f = fit(w, h); px.fillStyle = '#111'; px.fillRect(0, 0, pv.width, pv.height); px.drawImage(src, f.ox, f.oy, w * f.k, h * f.k);
      if (mode === 'align') {
        clicks.forEach(([u, v], i) => { const X = f.ox + u * f.k, Y = f.oy + v * f.k; px.strokeStyle = '#4fd1ff'; px.lineWidth = 2; px.beginPath(); px.arc(X, Y, 9, 0, 7); px.moveTo(X - 14, Y); px.lineTo(X + 14, Y); px.moveTo(X, Y - 14); px.lineTo(X, Y + 14); px.stroke(); px.fillStyle = '#4fd1ff'; px.font = 'bold 13px -apple-system'; px.fillText(String(i + 1), X + 10, Y - 10); });
      }
    };
    const names = ['1 — front left', '2 — front right', '3 — back right', '4 — back left'];
    pv.onclick = (e) => {
      if (mode !== 'align' || !still) return;
      const r = pv.getBoundingClientRect(), f = fit(still.width, still.height);
      clicks.push([((e.clientX - r.left) * pv.width / r.width - f.ox) / f.k, ((e.clientY - r.top) * pv.height / r.height - f.oy) / f.k]);
      if (clicks.length < 4) { msg(`Now click mark <b>${names[clicks.length]}</b>`); return; }
      try {
        const m = marks(); S.device.camera = { ...cam(), Himg2bed: solveH(clicks, m), H: solveH(m, clicks), deviceId: q('#caDev').value };
        saveDevice(); q('#caAl').textContent = '✓ aligned'; mode = 'live'; msg('Aligned. Click <b>Update overlay</b> to see your material under the design.');
      } catch (er) { msg(er.message); clicks = []; }
    };
    const start = async () => {
      try { video = await openStream(q('#caDev').value || c.deviceId); msg('Live view'); }
      catch (e) { msg(`Couldn't open the camera: ${e.message}. Check System Settings → Privacy & Security → Camera.`); }
      try { const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); const sel = q('#caDev'); sel.innerHTML = '<option value="">Default camera</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`).join(''); sel.value = c.deviceId || ''; } catch (e) { }
    };
    q('#caDev').onchange = async () => { S.device.camera = { ...cam(), deviceId: q('#caDev').value }; saveDevice(); await start(); };
    q('#caBurn').onclick = () => {
      if (!grbl.connected) return toast('Connect to the laser first', 'err');
      const sp = evalNum(q('#caSp').value) || 1000, pw = Math.min(100, evalNum(q('#caPw').value) || 20), Smax = S.device.sMax || 1000, lines = ['G90 G21', 'M4 S0'];
      for (const [x, y] of marks()) { lines.push(`G0 X${Gcode.fmt(x - 6)} Y${Gcode.fmt(y)}`, `G1 X${Gcode.fmt(x + 6)} S${Math.round(pw / 100 * Smax)} F${sp}`, `G0 X${Gcode.fmt(x)} Y${Gcode.fmt(y - 6)}`, `G1 Y${Gcode.fmt(y + 6)}`); }
      lines.push('M5', 'G0 X0 Y0');
      S.device.camera = { ...cam(), speed: sp, power: pw }; saveDevice();
      try { grbl.runJob(lines.join('\n'), 'alignment marks'); toast('Burning 4 alignment marks…'); } catch (e) { toast(e.message, 'err'); }
    };
    q('#caAlign').onclick = () => { if (!video) return toast('No camera picture yet', 'err'); still = grab(video); clicks = []; mode = 'align'; msg(`Click the centre of mark <b>${names[0]}</b> (front = the side nearest you, where Y is 0)`); };
    q('#caUpd').onclick = () => { const cc = cam(); if (!cc.H) return toast('Align the camera first (steps 1 and 2)', 'err'); if (!video) return toast('No camera picture', 'err'); overlay = { canvas: warp(grab(video), cc.H, cc.ppm), at: Date.now() }; requestRender(); toast('Overlay updated', 'ok'); };
    q('#caShow').onchange = () => { S.device.camera = { ...cam(), show: q('#caShow').checked }; saveDevice(); };
    q('#caOp').oninput = () => { S.device.camera = { ...cam(), opacity: +q('#caOp').value }; saveDevice(); };
    modal({ title: 'Camera', body, width: 1080, onClose: () => { cancelAnimationFrame(raf); if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } }, buttons: [{ label: 'Close', cls: 'primary' }] });
    loop(); start();
  }

  // ================================================================== vector library (Iconify)
  const API = 'https://api.iconify.design';
  const FREE = ['MIT', 'Apache-2.0', 'ISC', 'CC0-1.0', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense', '0BSD', 'OFL-1.1', 'MPL-2.0'];
  const SETS = [['', 'All icon sets'], ['mdi', 'Material Design'], ['tabler', 'Tabler'], ['ph', 'Phosphor'], ['material-symbols', 'Material Symbols'], ['game-icons', 'Game Icons (credit needed)'], ['fa6-solid', 'Font Awesome (credit needed)'], ['twemoji', 'Twemoji (credit needed)'], ['noto', 'Noto Emoji'], ['openmoji', 'OpenMoji (credit needed)'], ['healthicons', 'Health Icons'], ['carbon', 'Carbon'], ['lucide', 'Lucide']];
  const svgCache = new Map();
  const fetchText = (url) => NATIVE?.libFetch ? NATIVE.libFetch(url) : fetch(url).then(r => { if (!r.ok) throw new Error('Server replied ' + r.status); return r.text(); });
  async function iconSvg(id) {
    if (svgCache.has(id)) return svgCache.get(id);
    const [p, n] = id.split(':'); const t = await fetchText(`${API}/${encodeURIComponent(p)}/${encodeURIComponent(n)}.svg?color=%23000000`);
    svgCache.set(id, t); return t;
  }
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch (e) { } } })); }
  function vectorLibDialog() {
    const st = { q: '', set: '', free: true, size: 50, as: 'fill', ...JSON.parse(localStorage.getItem('bf.veclib') || '{}') };
    const body = document.createElement('div');
    body.innerHTML = `<div class="row wrap"><input id="vlQ" placeholder="Search free icons — e.g. guitar, speaker, microphone, deer, mandala" style="flex:1;min-width:260px" data-nofocus="1"><select id="vlSet">${SETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><label class="chk" style="margin:0"><input type="checkbox" id="vlFree"> No credit needed</label><button class="primary" id="vlGo">Search</button></div>
      <div id="vlGrid" class="vlgrid"><div class="note" style="padding:20px">Over 200 000 free, open-source icons from the Iconify collection. Search for anything; tick “No credit needed” to show only icons you can use on products you sell without crediting the designer.</div></div>
      <div class="row tight"><button class="small hidden" id="vlMore">More results</button><span class="grow"></span></div>
      <div class="vlsel" id="vlSel"></div>`;
    const q = (id) => $(id, body); q('#vlQ').value = st.q; q('#vlSet').value = st.set; q('#vlFree').checked = st.free;
    let start = 0, collections = {}, chosen = null, busy = false;
    const licOf = (id) => collections[id.split(':')[0]]?.license || {};
    const showSel = () => {
      if (!chosen) { q('#vlSel').innerHTML = ''; return; }
      const c = collections[chosen.split(':')[0]] || {}, lic = c.license || {}, free = FREE.includes(lic.spdx);
      q('#vlSel').innerHTML = `<div class="row tight wrap"><b>${chosen.split(':')[1].replace(/-/g, ' ')}</b><span class="note">${c.name || ''}${c.author?.name ? ' by ' + c.author.name : ''} · licence <b>${lic.title || lic.spdx || 'unknown'}</b>${free ? '' : ' — <span style="color:#ffb37a">credit the author if you sell items with it</span>'}</span><span class="grow"></span>
        <label>Width <input type="text" id="vlSize" value="${st.size}" style="width:54px"> mm</label>
        <select id="vlAs"><option value="fill">Insert for engraving (filled)</option><option value="line">Insert as cut outline</option></select>
        <button class="primary small" id="vlIns">Insert</button></div>`;
      q('#vlAs').value = st.as;
      q('#vlIns').onclick = () => insert(chosen, c);
    };
    const search = async (more) => {
      if (busy) return; const term = q('#vlQ').value.trim(); if (!term) return q('#vlQ').focus();
      st.q = term; st.set = q('#vlSet').value; st.free = q('#vlFree').checked; localStorage.setItem('bf.veclib', JSON.stringify(st));
      if (!more) { start = 0; q('#vlGrid').innerHTML = '<div class="note" style="padding:20px">Searching…</div>'; chosen = null; showSel(); }
      busy = true;
      try {
        const url = `${API}/search?query=${encodeURIComponent(term)}&limit=96&start=${start}${st.set ? '&prefix=' + encodeURIComponent(st.set) : ''}`;
        const res = JSON.parse(await fetchText(url));
        Object.assign(collections, res.collections || {});
        let icons = (res.icons || []).filter(id => !collections[id.split(':')[0]]?.palette);
        if (st.free) icons = icons.filter(id => FREE.includes(licOf(id).spdx));
        start = (res.start || 0) + (res.total || 0);
        if (!more) q('#vlGrid').innerHTML = '';
        if (!icons.length && !more) q('#vlGrid').innerHTML = `<div class="note" style="padding:20px">No ${st.free ? 'credit-free ' : ''}icons found for “${term.replace(/</g, '&lt;')}”. Try another word${st.free ? ' or untick “No credit needed”' : ''}.</div>`;
        const cells = icons.map(id => { const d = document.createElement('div'); d.className = 'vlcell'; d.title = id; d.innerHTML = '<div class="vlspin"></div>'; d.onclick = () => { $$('.vlcell.on', body).forEach(x => x.classList.remove('on')); d.classList.add('on'); chosen = id; showSel(); }; d.ondblclick = () => { chosen = id; insert(id, collections[id.split(':')[0]] || {}); }; q('#vlGrid').appendChild(d); return d; });
        q('#vlMore').classList.toggle('hidden', !(res.total >= res.limit));
        await pool(icons, 8, async (id, i) => { const svg = await iconSvg(id); cells[i].innerHTML = `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="">`; });
      } catch (e) {
        q('#vlGrid').innerHTML = `<div class="note" style="padding:20px;color:#ff9a9a">Couldn't reach the icon library: ${String(e.message || e).replace(/</g, '&lt;')}. Check your internet connection.</div>`;
      } finally { busy = false; }
    };
    const insert = async (id, coll) => {
      st.size = Math.max(1, evalNum(q('#vlSize')?.value) || st.size); st.as = q('#vlAs')?.value || st.as; localStorage.setItem('bf.veclib', JSON.stringify(st));
      try {
        const svg = await iconSvg(id), r = await Importers.svg(svg, () => S.curLayer);
        const objs = r.objects.filter(o => o.paths).map(o => ({ type: 'path', paths: o.paths, m: G.I() }));
        if (!objs.length) return toast('That icon has no usable shapes', 'err');
        normalizeObjs(objs);
        let b = G.emptyBox(); objs.forEach(o => b = G.boxUnion(b, G.pathsBox(G.xformPaths(o.paths, o.m))));
        const k = st.size / Math.max(0.01, b.x1 - b.x0), cx = S.device.width / 2, cy = S.device.height / 2;
        const M = G.mul(G.translate(cx - (b.x0 + b.x1) / 2 * k, cy - (b.y0 + b.y1) / 2 * k), G.scale(k, k));
        let layer = S.curLayer;
        if (st.as === 'fill' && S.doc.layers[layer].mode !== 'fill') { layer = freeLayer(layer); Object.assign(S.doc.layers[layer], { mode: 'fill', speed: 3000, maxPower: 30, interval: 0.1 }); }
        if (st.as === 'line' && S.doc.layers[layer].mode !== 'line') { layer = freeLayer(layer); S.doc.layers[layer].mode = 'line'; }
        const gid = objs.length > 1 ? uid() : undefined, lic = coll.license || {};
        objs.forEach(o => { o.m = G.mul(M, o.m); o.layer = layer; if (gid) o.groupId = gid; o.source = { icon: id, set: coll.name, author: coll.author?.name, licence: lic.title || lic.spdx }; });
        pushUndo(); addObjects(objs); commit();
        toast(`Inserted “${id.split(':')[1]}”${FREE.includes(lic.spdx) ? '' : ` — licence ${lic.title || lic.spdx}: credit ${coll.author?.name || 'the author'} if you sell items with it`}`, FREE.includes(lic.spdx) ? 'ok' : '');
      } catch (e) { toast('Could not insert: ' + e.message, 'err'); }
    };
    q('#vlGo').onclick = () => search(false); q('#vlMore').onclick = () => search(true);
    q('#vlQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(false); });
    modal({ title: 'Vector library', body, width: 900, buttons: [{ label: 'Close', cls: 'primary' }] });
    setTimeout(() => q('#vlQ').focus(), 50);
    if (st.q) search(false);
  }

  // hooks into the app
  window.renderUnderlays = (ctx, w2s, z) => { drawOverlay(ctx, w2s); drawRotaryGuide(ctx, w2s); };
  Object.assign(cmds, { rotary: rotaryDialog, camera: cameraDialog, vectorLib: vectorLibDialog });
  $('#rotChip')?.addEventListener('click', () => rotaryDialog());
  updateRotChip(); applyIcons(); applyCmdButtons();
  return { solveH, applyH, warp, marks, rotaryDialog, cameraDialog, vectorLibDialog, setOverlay: (c) => { overlay = { canvas: c, at: Date.now() }; requestRender(); } };
})();
