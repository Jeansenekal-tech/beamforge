// Generators: material test grid, asset tags (QR / Code 128), AV panel templates.
// Loaded after app.js — uses its helpers (S, modal, toast, pushUndo, addObjects, commit, …).
'use strict';
const Makers = (() => {
  const rect = (x, y, w, h) => ({ pts: [x, y, x + w, y, x + w, y + h, x, y + h], closed: true });
  function rrect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); if (r < 0.01) return rect(x, y, w, h);
    const p = G.rectPaths(w, h, r)[0]; return { pts: p.pts.map((v, i) => v + (i % 2 ? y : x)), closed: true };
  }
  function circle(cx, cy, r) { const n = Math.max(24, Math.min(160, Math.round(r * 6))), pts = []; for (let k = 0; k < n; k++) { const a = k / n * 2 * Math.PI; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return { pts, closed: true }; }
  function slot(cx, cy, w, h) { // rounded slot (obround) centred at cx,cy
    const r = Math.min(w, h) / 2, pts = [], n = 16;
    if (w >= h) { for (let k = 0; k <= n; k++) { const a = -Math.PI / 2 + k / n * Math.PI; pts.push(cx + w / 2 - r + r * Math.cos(a), cy + r * Math.sin(a)); } for (let k = 0; k <= n; k++) { const a = Math.PI / 2 + k / n * Math.PI; pts.push(cx - w / 2 + r + r * Math.cos(a), cy + r * Math.sin(a)); } }
    else { for (let k = 0; k <= n; k++) { const a = k / n * Math.PI; pts.push(cx + r * Math.cos(a), cy + h / 2 - r + r * Math.sin(a)); } for (let k = 0; k <= n; k++) { const a = Math.PI + k / n * Math.PI; pts.push(cx + r * Math.cos(a), cy - h / 2 + r + r * Math.sin(a)); } }
    return { pts, closed: true };
  }
  const shift = (paths, dx, dy) => paths.map(p => ({ pts: p.pts.map((v, i) => v + (i % 2 ? dy : dx)), closed: p.closed }));
  const scaleP = (paths, k) => paths.map(p => ({ pts: p.pts.map(v => v * k), closed: p.closed }));
  // text as outlines, bottom-left at (x,y); shrinks to fit maxW if given
  function text(str, size, x, y, { bold = false, maxW = 0, align = 'left', font = 'Helvetica' } = {}) {
    if (!String(str).trim()) return { paths: [], w: 0, h: 0 };
    let paths = Trace.textToPaths({ text: String(str), font, size, bold, italic: false, align: 'left', spacing: 0 });
    let b = G.pathsBox(paths); let w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (maxW > 0 && w > maxW) { const k = maxW / w; paths = scaleP(paths, k); w *= k; h *= k; }
    const ax = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    return { paths: shift(paths, ax, y), w, h };
  }
  function layerFor(settings, name, prefer) {
    const li = freeLayer(prefer);
    Object.assign(S.doc.layers[li], settings, { name: name || S.doc.layers[li].name });
    return li;
  }
  // a layer in Line (cut) mode for outlines: the current layer if it already cuts, else a fresh one
  function cutLayer() {
    const cur = S.curLayer, L = S.doc.layers[cur];
    if (L.mode === 'line') return cur;
    const li = freeLayer(cur + 1); Object.assign(S.doc.layers[li], { mode: 'line' }); return li;
  }
  const obj = (paths, layer, extra = {}) => { const o = { type: 'path', paths, m: G.I(), layer, ...extra }; normalizeObjs([o]); return o; };
  const numIn = (v, d) => { const n = evalNum(v); return isNaN(n) ? d : n; };
  function formFields(body, st, map) { // id -> key; reads text/number/select/checkbox into st
    for (const [id, k] of Object.entries(map)) {
      const el = $('#' + id, body); if (!el) continue;
      if (el.type === 'checkbox') st[k] = el.checked;
      else if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.dataset.text) st[k] = el.value;
      else st[k] = numIn(el.value, st[k]);
    }
  }
  function fillForm(body, st, map) { for (const [id, k] of Object.entries(map)) { const el = $('#' + id, body); if (!el) continue; if (el.type === 'checkbox') el.checked = !!st[k]; else el.value = st[k]; } }

  // ================================================================== material test grid
  function testGridDialog() {
    const st = { material: 'Basswood 3mm', mode: 'fill', s0: 1000, s1: 6000, sn: 5, p0: 20, p1: 100, pn: 5, passes: 1, interval: 0.1, cell: 10, gap: 3, labels: true, lblSpeed: 3000, lblPower: 15, ...JSON.parse(localStorage.getItem('bf.testgrid') || '{}') };
    const map = { tgMat: 'material', tgMode: 'mode', tgS0: 's0', tgS1: 's1', tgSn: 'sn', tgP0: 'p0', tgP1: 'p1', tgPn: 'pn', tgPass: 'passes', tgInt: 'interval', tgCell: 'cell', tgGap: 'gap', tgLbl: 'labels', tgLS: 'lblSpeed', tgLP: 'lblPower' };
    const body = document.createElement('div'); body.className = 'gen2';
    body.innerHTML = `<div><canvas id="tgPv" width="380" height="320"></canvas><div class="note" id="tgInfo"></div></div><div class="form gform">
      <label>Material name</label><input type="text" id="tgMat" data-text="1">
      <label>Test type</label><select id="tgMode"><option value="fill">Engrave (filled squares)</option><option value="line">Cut / score (outlines)</option></select>
      <h5>Speed (rows, mm/min)</h5>
      <label>From → to</label><div class="row tight" style="margin:0"><input type="text" id="tgS0" style="width:70px"> → <input type="text" id="tgS1" style="width:70px"></div>
      <label>Steps</label><input type="text" id="tgSn">
      <h5>Power (columns, %)</h5>
      <label>From → to</label><div class="row tight" style="margin:0"><input type="text" id="tgP0" style="width:70px"> → <input type="text" id="tgP1" style="width:70px"></div>
      <label>Steps</label><input type="text" id="tgPn">
      <h5>Other</h5>
      <label>Passes</label><input type="text" id="tgPass">
      <label class="tg-f">Line interval (mm)</label><input class="tg-f" type="text" id="tgInt">
      <label>Square size / gap (mm)</label><div class="row tight" style="margin:0"><input type="text" id="tgCell" style="width:60px"><input type="text" id="tgGap" style="width:60px"></div>
      <label>Engrave labels</label><input type="checkbox" id="tgLbl">
      <label class="tg-l">Label speed / power</label><div class="tg-l row tight" style="margin:0"><input type="text" id="tgLS" style="width:70px"><input type="text" id="tgLP" style="width:50px">%</div>
      <div class="full note">After cutting, right-click the square you like best → <b>Save this test setting…</b> to add it to your material library.</div></div>`;
    fillForm(body, st, map);
    const vals = () => {
      const lin = (a, b, n, r) => Array.from({ length: Math.max(1, n | 0) }, (_, i) => { const v = n <= 1 ? a : a + (b - a) * i / (n - 1); return Math.round(v / r) * r; });
      return { speeds: lin(st.s0, st.s1, st.sn, 10), powers: lin(st.p0, st.p1, st.pn, 1) };
    };
    const draw = () => {
      formFields(body, st, map);
      $$('.tg-f', body).forEach(e => e.style.display = st.mode === 'fill' ? '' : 'none'); $$('.tg-l', body).forEach(e => e.style.display = st.labels ? '' : 'none');
      const { speeds, powers } = vals(), c = $('#tgPv', body), x = c.getContext('2d');
      x.fillStyle = '#e9e1d3'; x.fillRect(0, 0, c.width, c.height);
      const k = Math.min(260 / (powers.length * (st.cell + st.gap)), 240 / (speeds.length * (st.cell + st.gap))), ox = 90, oy = 52;
      x.font = '10px Menlo'; x.fillStyle = '#333'; x.textAlign = 'center';
      powers.forEach((p, i) => x.fillText(p + '%', ox + (i + 0.5) * (st.cell + st.gap) * k, oy - 8));
      x.textAlign = 'right'; speeds.forEach((s, j) => x.fillText(s, ox - 8, oy + (j + 0.6) * (st.cell + st.gap) * k));
      speeds.forEach((s, j) => powers.forEach((p, i) => {
        const dark = Math.min(1, (p / 100) * (1500 / Math.max(s, 100)) * 1.4);
        const X = ox + i * (st.cell + st.gap) * k, Y = oy + j * (st.cell + st.gap) * k, w = st.cell * k;
        if (st.mode === 'fill') { x.fillStyle = `rgba(60,30,10,${0.15 + 0.85 * dark})`; x.fillRect(X, Y, w, w); }
        else { x.strokeStyle = `rgba(60,30,10,${0.3 + 0.7 * dark})`; x.lineWidth = 1 + 2 * dark; x.strokeRect(X, Y, w, w); }
      }));
      x.fillStyle = '#333'; x.textAlign = 'left'; x.font = 'bold 12px -apple-system'; x.fillText(st.material, 12, 20);
      x.font = '10px -apple-system'; x.fillText('power →', ox, 30); x.save(); x.translate(18, oy + 60); x.rotate(-Math.PI / 2); x.fillText('← speed', 0, 0); x.restore();
      const n = speeds.length * powers.length, W = 22 + powers.length * (st.cell + st.gap), H = 20 + speeds.length * (st.cell + st.gap);
      $('#tgInfo', body).textContent = `${n} squares · about ${n2(W)} × ${n2(H)} mm`;
    };
    body.oninput = draw; setTimeout(draw, 0);
    modal({ title: 'Material test grid', body, width: 820, buttons: [{ label: 'Cancel' }, { label: 'Create test grid', cls: 'primary', onClick: () => { draw(); localStorage.setItem('bf.testgrid', JSON.stringify(st)); makeTestGrid(st, vals()); } }] });
  }
  function makeTestGrid(st, { speeds, powers }) {
    if (speeds.length * powers.length > 400) { toast('That is more than 400 squares — use fewer steps', 'err'); return false; }
    const pitch = st.cell + st.gap, lm = st.labels ? 22 : 0, tm = st.labels ? 18 : 0;
    const W = lm + powers.length * pitch, H = tm + speeds.length * pitch;
    const x0 = Math.max(2, (S.device.width - W) / 2), y0 = Math.max(2, (S.device.height - H) / 2);
    const gridLayer = layerFor({ mode: st.mode, speed: speeds[0], maxPower: powers[0], minPower: 0, passes: st.passes, interval: st.interval, air: st.mode === 'line' }, 'Test grid', S.doc.objects.some(o => o.layer === S.curLayer) ? undefined : S.curLayer + 1);
    const gid = uid(), objs = [];
    speeds.forEach((sp, j) => powers.forEach((pw, i) => {
      const x = x0 + lm + i * pitch, y = y0 + (speeds.length - 1 - j) * pitch;
      const cut = { speed: sp, maxPower: pw, minPower: 0, passes: st.passes, mode: st.mode, interval: st.interval };
      objs.push(obj([rect(x, y, st.cell, st.cell)], gridLayer, { groupId: gid, cut, testCell: { material: st.material, ...cut } }));
    }));
    if (st.labels) {
      const lbl = layerFor({ mode: 'fill', speed: st.lblSpeed, maxPower: st.lblPower, minPower: 0, passes: 1, interval: 0.1, air: false }, 'Test labels', gridLayer + 1);
      const ts = Math.min(3.2, st.cell * 0.4); const parts = [];
      powers.forEach((pw, i) => parts.push(...text(pw + '%', ts, x0 + lm + i * pitch + st.cell / 2, y0 + speeds.length * pitch + 1, { align: 'center', maxW: pitch - 0.5 }).paths));
      speeds.forEach((sp, j) => parts.push(...text(String(sp), ts, x0 + lm - 1.5, y0 + (speeds.length - 1 - j) * pitch + (st.cell - ts) / 2, { align: 'right', maxW: lm - 2 }).paths));
      parts.push(...text(`${st.material}  ·  ${st.mode === 'fill' ? 'engrave' : 'cut'}  ·  ${st.passes}x  ·  rows mm/min, columns %`, Math.min(3.5, ts * 1.1), x0, y0 + speeds.length * pitch + ts + 3, { maxW: W }).paths);
      if (parts.length) objs.push(obj(parts, lbl, { groupId: gid }));
    }
    pushUndo(); addObjects(objs); commit(); run('zoomSel');
    toast(`Test grid: ${speeds.length} speeds × ${powers.length} powers. Each square uses its own setting.`, 'ok');
  }
  function saveTestCell(o) {
    const c = o.testCell; if (!c) return;
    const body = document.createElement('div');
    body.innerHTML = `<div class="form"><label>Material</label><input type="text" id="scM" value="${(c.material || '').replace(/"/g, '&quot;')}">
      <label>Thickness (mm)</label><input type="text" id="scT" value="0">
      <label>Operation</label><select id="scO"><option>Engrave</option><option>Cut</option><option>Score</option><option>Photo</option></select>
      <label>Notes</label><input type="text" id="scN" placeholder="optional">
      <div class="full note">${c.speed} mm/min · ${c.maxPower}% · ${c.passes} pass(es) · ${c.mode === 'fill' ? 'Fill' : 'Line'}</div></div>`;
    $('#scO', body).value = c.mode === 'fill' ? 'Engrave' : 'Cut';
    modal({ title: 'Save test setting to My settings', body, buttons: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: (B) => {
      const op = $('#scO', B).value, mode = op === 'Photo' ? 'image' : (op === 'Engrave' ? 'fill' : 'line');
      Library.addEntry('my', { material: $('#scM', B).value.trim() || 'Material', thickness: numIn($('#scT', B).value, 0), op, source: 'Mine', notes: $('#scN', B).value,
        settings: { mode, speed: c.speed, maxPower: c.maxPower, minPower: 0, passes: c.passes, interval: c.interval || 0.1, bidir: true, overscan: 2.5, angle: 0, crosshatch: false, air: mode === 'line', imageMode: 'jarvis' } });
      toast('Saved to My settings — find it in the material Library', 'ok'); } }] });
  }

  // ================================================================== asset tags
  function tagDialog() {
    const st = { shape: 'hole', w: 60, h: 25, r: 3, hole: 5, source: 'serial', prefix: 'UAV-', start: 1, count: 20, digits: 4, csv: 'serial,name\nUAV-0001,Shure SM58\nUAV-0002,Shure SM58\nUAV-0003,Sennheiser e935', line1: '{serial}', line2: 'Unique AV', size: 4, bold: true, code: 'qr', codeText: '{serial}', ecc: 'M', invert: false, gap: 3, ...JSON.parse(localStorage.getItem('bf.tags') || '{}') };
    const map = { tgShape: 'shape', tgW: 'w', tgH: 'h', tgR: 'r', tgHole: 'hole', tgSrc: 'source', tgPre: 'prefix', tgStart: 'start', tgCount: 'count', tgDig: 'digits', tgCsv: 'csv', tgL1: 'line1', tgL2: 'line2', tgSize: 'size', tgBold: 'bold', tgCode: 'code', tgCT: 'codeText', tgEcc: 'ecc', tgInv: 'invert', tgGap: 'gap' };
    const body = document.createElement('div'); body.className = 'gen2';
    body.innerHTML = `<div><canvas id="tgPv" width="380" height="300"></canvas><div class="note" id="tgInfo"></div></div><div class="form gform">
      <h5>Tag</h5>
      <label>Shape</label><select id="tgShape"><option value="rect">Rectangle</option><option value="round">Rounded rectangle</option><option value="hole">Key tag (hole on the left)</option><option value="cable">Cable tag (cable-tie slots)</option><option value="circle">Round tag (hole at top)</option></select>
      <label>Width × height (mm)</label><div class="row tight" style="margin:0"><input type="text" id="tgW" style="width:60px"><input type="text" id="tgH" style="width:60px"></div>
      <label>Corner radius / hole Ø (mm)</label><div class="row tight" style="margin:0"><input type="text" id="tgR" style="width:60px"><input type="text" id="tgHole" style="width:60px"></div>
      <h5>Numbers</h5>
      <label>Source</label><select id="tgSrc"><option value="serial">Serial numbers</option><option value="csv">List / spreadsheet (CSV)</option></select>
      <label class="s-ser">Prefix · start · count · digits</label><div class="s-ser row tight" style="margin:0"><input type="text" id="tgPre" data-text="1" style="width:64px"><input type="text" id="tgStart" style="width:52px"><input type="text" id="tgCount" style="width:52px"><input type="text" id="tgDig" style="width:40px"></div>
      <label class="s-csv">CSV (first row = names)</label><div class="s-csv"><textarea id="tgCsv" rows="4" style="width:100%"></textarea><button class="small" id="tgCsvF">Load CSV file…</button></div>
      <h5>Content</h5>
      <label>Line 1 / Line 2</label><div class="row tight" style="margin:0"><input type="text" id="tgL1" data-text="1" style="flex:1"><input type="text" id="tgL2" data-text="1" style="flex:1"></div>
      <label>Text size (mm) · bold</label><div class="row tight" style="margin:0"><input type="text" id="tgSize" style="width:52px"><input type="checkbox" id="tgBold"></div>
      <label>Code</label><select id="tgCode"><option value="none">None</option><option value="qr">QR code</option><option value="c128">Barcode (Code 128)</option></select>
      <label class="s-code">Code contains</label><input class="s-code" type="text" id="tgCT" data-text="1">
      <label class="s-qr">QR error correction</label><select class="s-qr" id="tgEcc"><option value="L">Low (smallest)</option><option value="M">Medium</option><option value="Q">Quartile</option><option value="H">High (survives scratches)</option></select>
      <label class="s-code">Engrave background (anodised/dark)</label><input class="s-code" type="checkbox" id="tgInv">
      <label>Gap between tags (mm)</label><input type="text" id="tgGap">
      <div class="full note">Fields: <code>{serial}</code> <code>{n}</code> <code>{date}</code>, plus any CSV column name, e.g. <code>{name}</code>. Tags that don't fit go onto new pages.</div></div>`;
    fillForm(body, st, map);
    $('#tgCsvF', body).onclick = async () => { const f = await pickFile('.csv,.txt', true); if (f) { $('#tgCsv', body).value = bytesToText(f.data); draw(); } };
    let recs = [];
    const draw = () => {
      formFields(body, st, map);
      $$('.s-ser', body).forEach(e => e.style.display = st.source === 'serial' ? '' : 'none'); $$('.s-csv', body).forEach(e => e.style.display = st.source === 'csv' ? '' : 'none');
      $$('.s-code', body).forEach(e => e.style.display = st.code !== 'none' ? '' : 'none'); $$('.s-qr', body).forEach(e => e.style.display = st.code === 'qr' ? '' : 'none');
      try { recs = tagRecords(st); } catch (e) { recs = []; $('#tgInfo', body).textContent = e.message; }
      const c = $('#tgPv', body), x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#2a2d33'; x.fillRect(0, 0, c.width, c.height);
      if (!recs.length) return;
      let t; try { t = buildTag(st, recs[0], 0, 0); } catch (e) { $('#tgInfo', body).textContent = e.message; return; }
      const k = Math.min((c.width - 40) / st.w, (c.height - 80) / st.h);
      x.translate((c.width - st.w * k) / 2, (c.height + st.h * k) / 2 - 20); x.scale(k, -k);
      const path = (ps) => { x.beginPath(); for (const p of ps) { p.pts.forEach((v, i) => { if (i % 2) return; i ? x.lineTo(p.pts[i], p.pts[i + 1]) : x.moveTo(p.pts[i], p.pts[i + 1]); }); if (p.closed) x.closePath(); } };
      path(t.cut); x.fillStyle = '#d9b98c'; x.fill('evenodd'); x.strokeStyle = '#ff4040'; x.lineWidth = 1.5 / k; x.stroke();
      path(t.eng); x.fillStyle = '#2b1a0c'; x.fill('evenodd');
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#ccc'; x.font = '11px -apple-system'; x.fillText(`First tag: ${Object.entries(recs[0]).filter(([k]) => k !== 'n').slice(0, 3).map(([k, v]) => k + '=' + v).join(', ')}`, 10, c.height - 12);
      const per = perPage(st); $('#tgInfo', body).textContent = `${recs.length} tag(s) · ${per} per page → ${Math.ceil(recs.length / Math.max(1, per))} page(s)${t.warn ? ' · ' + t.warn : ''}`;
    };
    body.oninput = draw; body.onchange = draw; setTimeout(draw, 0);
    modal({ title: 'Asset tags & labels', body, width: 880, buttons: [{ label: 'Cancel' }, { label: 'Create tags', cls: 'primary', onClick: () => { draw(); if (!recs.length) return false; localStorage.setItem('bf.tags', JSON.stringify(st)); return makeTags(st, recs) !== false; } }] });
  }
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(v => v.trim())) rows.push(row); row = []; } else f += ch;
    }
    row.push(f); if (row.some(v => v.trim())) rows.push(row);
    return rows;
  }
  function tagRecords(st) {
    const date = new Date().toISOString().slice(0, 10);
    if (st.source === 'csv') {
      const rows = parseCSV(st.csv || ''); if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row');
      const head = rows[0].map(h => h.trim().toLowerCase());
      return rows.slice(1).map((r, i) => { const o = { n: i + 1, date }; head.forEach((h, k) => o[h] = (r[k] || '').trim()); if (!o.serial) o.serial = (r[0] || '').trim(); return o; });
    }
    const n = Math.max(1, Math.min(2000, st.count | 0));
    return Array.from({ length: n }, (_, i) => { const v = (st.start | 0) + i; return { n: v, serial: (st.prefix || '') + String(v).padStart(Math.max(0, st.digits | 0), '0'), date }; });
  }
  const fill = (tpl, rec) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => rec[k.toLowerCase()] ?? '');
  function qrPaths(text, size, ecc, invert, x, y) {
    const q = Codes.qr(text, ecc), mod = size / q.size, out = [];
    for (let r = 0; r < q.size; r++) { let c = 0; while (c < q.size) { if (!q.modules[r][c]) { c++; continue; } let e = c; while (e < q.size && q.modules[r][e]) e++; out.push(rect(x + c * mod, y + (q.size - 1 - r) * mod, (e - c) * mod, mod)); c = e; } }
    if (invert) out.push(rect(x - 2 * mod, y - 2 * mod, size + 4 * mod, size + 4 * mod));
    return { paths: mergeRows(out), mod, version: q.version };
  }
  function mergeRows(rects) { return rects; } // rectangles per row run; touching runs are fine for fill engraving
  function barPaths(text, w, h, invert, x, y) {
    const b = Codes.code128(text), mod = w / b.modules, out = []; let cx = x;
    b.widths.forEach((wd, i) => { if (i % 2 === 0) out.push(rect(cx, y, wd * mod, h)); cx += wd * mod; });
    if (invert) out.push(rect(x - 10 * mod, y - 1, w + 20 * mod, h + 2));
    return { paths: out, mod };
  }
  function buildTag(st, rec, ox, oy) {
    const W = st.w, H = st.h, m = Math.max(1.5, Math.min(W, H) * 0.08), cut = [], eng = []; let warn = '';
    let x0 = m, x1 = W - m;
    if (st.shape === 'circle') {
      const R = Math.min(W, H) / 2; cut.push(circle(R, R, R)); cut.push(circle(R, 2 * R - st.hole / 2 - m, st.hole / 2));
      const s = R * 1.15; // inner square-ish area
      return finishTag(st, rec, ox, oy, cut, eng, R - s / 2, R - s / 2 - st.hole * 0.3, s, s * 0.85, warn);
    }
    cut.push(st.shape === 'rect' ? rect(0, 0, W, H) : rrect(0, 0, W, H, st.shape === 'cable' ? H / 2 : st.r));
    if (st.shape === 'hole') { const cx = m + st.hole / 2; cut.push(circle(cx, H / 2, st.hole / 2)); x0 = cx + st.hole / 2 + m; }
    if (st.shape === 'cable') { const sw = Math.max(1.5, st.hole * 0.4), sh = Math.min(H - 2 * m, st.hole * 1.6); cut.push(slot(H / 2, H / 2, sw, sh)); cut.push(slot(W - H / 2, H / 2, sw, sh)); x0 = H / 2 + sw + m; x1 = W - H / 2 - sw - m; }
    return finishTag(st, rec, ox, oy, cut, eng, x0, m, x1 - x0, H - 2 * m, warn);
  }
  function finishTag(st, rec, ox, oy, cut, eng, ax, ay, aw, ah, warn) {
    // content area ax,ay,aw,ah
    let tx = ax, tw = aw, ty = ay, th = ah;
    if (st.code === 'qr') {
      const ct = fill(st.codeText, rec);
      if (ct) {
        const q0 = Codes.qr(ct, st.ecc), quiet = 2;
        let size = Math.min(ah, aw * 0.5); const mod = size / (q0.size + 2 * quiet); size = mod * q0.size;
        if (mod < 0.25) warn = `QR modules are only ${n2(mod)} mm — make the tag bigger or the text shorter`;
        const qx = ax + aw - size - quiet * mod, qy = ay + (ah - size) / 2;
        eng.push(...qrPaths(ct, size, st.ecc, st.invert, qx, qy).paths);
        tw = aw - size - 2 * quiet * mod - 1.5;
      }
    } else if (st.code === 'c128') {
      const ct = fill(st.codeText, rec);
      if (ct) {
        const b0 = Codes.code128(ct), bh = Math.max(4, ah * 0.42), bw = Math.min(aw, b0.modules * 0.5), mod = bw / b0.modules;
        if (mod < 0.25) warn = `barcode bars are only ${n2(mod)} mm wide — make the tag wider or the text shorter`;
        eng.push(...barPaths(ct, bw, bh, st.invert, ax + (aw - bw) / 2, ay).paths);
        ty = ay + bh + 1.2; th = ah - bh - 1.2;
      }
    }
    const lines = [fill(st.line1, rec), fill(st.line2, rec)].filter(l => l.trim());
    if (lines.length && tw > 3 && th > 1.5) {
      const size = Math.min(st.size, th / (lines.length * 1.3));
      const total = lines.length * size * 1.3 - size * 0.3;
      lines.forEach((l, i) => eng.push(...text(l, size * (i === 0 ? 1 : 0.85), tx, ty + (th + total) / 2 - (i + 1) * size * 1.3 + size * 0.3, { bold: st.bold && i === 0, maxW: tw }).paths));
    }
    return { cut: shift(cut, ox, oy), eng: shift(eng, ox, oy), warn };
  }
  function perPage(st) {
    const w = st.shape === 'circle' ? Math.min(st.w, st.h) : st.w, h = st.shape === 'circle' ? w : st.h, g = st.gap;
    return Math.max(0, Math.floor((S.device.width - 10 + g) / (w + g))) * Math.max(0, Math.floor((S.device.height - 10 + g) / (h + g)));
  }
  function makeTags(st, recs) {
    const w = st.shape === 'circle' ? Math.min(st.w, st.h) : st.w, h = st.shape === 'circle' ? w : st.h, g = st.gap;
    const cols = Math.floor((S.device.width - 10 + g) / (w + g)), rows = Math.floor((S.device.height - 10 + g) / (h + g)), per = cols * rows;
    if (!per) { toast('One tag is bigger than the work area', 'err'); return false; }
    const cutL = cutLayer(), engL = layerFor({ mode: 'fill', speed: 3000, maxPower: 30, minPower: 0, passes: 1, interval: 0.08, air: false }, 'Tag engrave', cutL + 1);
    setMsg('Building tags…');
    pushUndo(); syncPages();
    const basePage = S.doc.page; let pageIdx = basePage, made = 0;
    for (let i = 0; i < recs.length; i++) {
      const k = i % per, pg = Math.floor(i / per);
      if (pg > 0 && k === 0) pageIdx = addPage([], `${S.doc.pages[basePage].name} – tags ${pg + 1}`);
      const c = k % cols, r = Math.floor(k / cols);
      const ox = 5 + c * (w + g), oy = S.device.height - 5 - (r + 1) * (h + g) + g;
      const t = buildTag(st, recs[i], ox, oy), gid = uid();
      const objs = [obj(t.cut, cutL, { groupId: gid })]; if (t.eng.length) objs.push(obj(t.eng, engL, { groupId: gid }));
      if (pageIdx === basePage) addObjects(objs, false); else { objs.forEach(o => o.id = uid()); S.doc.pages[pageIdx].objects.push(...objs); }
      made++;
    }
    setMsg(''); S.sel.clear(); commit(); renderPages();
    const pages = Math.ceil(recs.length / per);
    toast(`${made} tag(s) created${pages > 1 ? ` on ${pages} pages` : ''}: outlines on C${pad2(cutL)} (cut), text & codes on C${pad2(engL)} (engrave)`, 'ok');
  }

  // ================================================================== AV panels
  const PANELS = { '19-1': [482.6, 1], '19-2': [482.6, 2], '19-3': [482.6, 3], '19-4': [482.6, 4], '10-1': [254, 1], '10-2': [254, 2], '10-3': [254, 3] };
  const CUTOUTS = {
    none: { name: 'None' },
    d: { name: 'D-series (XLR, speakON, etherCON, HDMI/USB/BNC feed-through)', w: 26, h: 31 },
    round: { name: 'Round hole', w: 0, h: 0 },
    rect: { name: 'Rectangle', w: 0, h: 0 },
    iec: { name: 'IEC C14 power inlet (snap-in 27.5 × 19.8)', w: 27.5, h: 19.8 },
    jack: { name: '1/4" jack / pot / switch (Ø9.5)', w: 9.5, h: 9.5 },
  };
  function cutout(type, cx, cy, o) {
    switch (type) {
      case 'd': { const out = [circle(cx, cy, 12)]; const hs = [[-9.5, 12], [9.5, -12]]; if (o.dHoles === 'four') hs.push([9.5, 12], [-9.5, -12]); hs.forEach(([dx, dy]) => out.push(circle(cx + dx, cy + dy, 1.6))); return { paths: out, h: 31 }; }
      case 'round': return { paths: [circle(cx, cy, o.dia / 2)], h: o.dia };
      case 'jack': return { paths: [circle(cx, cy, 4.75)], h: 9.5 };
      case 'rect': return { paths: [rect(cx - o.rw / 2, cy - o.rh / 2, o.rw, o.rh)], h: o.rh };
      case 'iec': return { paths: [rect(cx - 13.75, cy - 9.9, 27.5, 19.8)], h: 19.8 };
    }
    return { paths: [], h: 0 };
  }
  function panelDialog() {
    const st = { preset: '10-1', w: 200, h: 80, r: 0, rack: true, dHoles: 'diag', textSize: 3, rows: [{ type: 'd', count: 6, label: 'CH {n}', start: 1, dia: 22, rw: 30, rh: 20 }, { type: 'none', count: 2, label: 'OUT {n}', start: 1, dia: 22, rw: 30, rh: 20 }], ...JSON.parse(localStorage.getItem('bf.panel') || '{}') };
    const body = document.createElement('div'); body.className = 'gen1';
    const rowHtml = (i) => `<div class="prow"><b>Row ${i + 1}</b>
      <select data-r="${i}" data-k="type">${Object.entries(CUTOUTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
      <label>Count <input type="text" data-r="${i}" data-k="count" style="width:44px"></label>
      <label class="pr-round">Ø <input type="text" data-r="${i}" data-k="dia" style="width:44px"></label>
      <label class="pr-rect">W×H <input type="text" data-r="${i}" data-k="rw" style="width:40px"><input type="text" data-r="${i}" data-k="rh" style="width:40px"></label>
      <label>Label <input type="text" data-r="${i}" data-k="label" data-text="1" style="width:90px"></label>
      <label>from <input type="text" data-r="${i}" data-k="start" style="width:36px"></label></div>`;
    body.innerHTML = `<canvas id="pnPv" width="860" height="230"></canvas><div class="note" id="pnInfo"></div>
      <div class="form gform" style="margin-top:8px">
        <label>Panel</label><select id="pnPreset"><option value="19-1">19" rack · 1U</option><option value="19-2">19" rack · 2U</option><option value="19-3">19" rack · 3U</option><option value="19-4">19" rack · 4U</option><option value="10-1">10" rack · 1U</option><option value="10-2">10" rack · 2U</option><option value="10-3">10" rack · 3U</option><option value="custom">Custom plate / stage box</option></select>
        <label class="pn-c">Width × height (mm)</label><div class="pn-c row tight" style="margin:0"><input type="text" id="pnW" style="width:70px"><input type="text" id="pnH" style="width:70px"></div>
        <label>Corner radius (mm)</label><input type="text" id="pnR">
        <label class="pn-r">Rack mounting holes</label><input class="pn-r" type="checkbox" id="pnRack">
        <label>D-series screw holes</label><select id="pnDH"><option value="diag">2 (diagonal)</option><option value="four">4 (fits any orientation)</option></select>
        <label>Label text size (mm)</label><input type="text" id="pnTS">
      </div><div id="pnRows">${st.rows.map((_, i) => rowHtml(i)).join('')}</div>
      <div class="note">D-series cut-out: Ø24 mm with M3 holes 19 × 24 mm apart — fits Neutrik/Amphenol D-size XLR, speakON, etherCON, powerCON-D and feed-through connectors. Check the datasheet of other parts. Labels use the same <code>{n}</code> numbering.</div>`;
    const top = { pnPreset: 'preset', pnW: 'w', pnH: 'h', pnR: 'r', pnRack: 'rack', pnDH: 'dHoles', pnTS: 'textSize' };
    fillForm(body, st, top);
    $$('[data-r]', body).forEach(el => { const v = st.rows[+el.dataset.r][el.dataset.k]; el.value = v; });
    let built = null;
    const draw = () => {
      formFields(body, st, top);
      $$('[data-r]', body).forEach(el => { const r = st.rows[+el.dataset.r], k = el.dataset.k; r[k] = (el.tagName === 'SELECT' || el.dataset.text) ? el.value : numIn(el.value, r[k]); });
      $$('.pn-c', body).forEach(e => e.style.display = st.preset === 'custom' ? '' : 'none'); $$('.pn-r', body).forEach(e => e.style.display = st.preset === 'custom' ? 'none' : '');
      $$('.prow', body).forEach((row, i) => { const t = st.rows[i].type; $$('.pr-round', row).forEach(e => e.style.display = t === 'round' ? '' : 'none'); $$('.pr-rect', row).forEach(e => e.style.display = t === 'rect' ? '' : 'none'); });
      try { built = buildPanel(st); } catch (e) { built = null; $('#pnInfo', body).textContent = e.message; }
      const c = $('#pnPv', body), x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#23262b'; x.fillRect(0, 0, c.width, c.height);
      if (!built) return;
      const k = Math.min((c.width - 20) / built.W, (c.height - 20) / built.H); x.translate((c.width - built.W * k) / 2, (c.height + built.H * k) / 2); x.scale(k, -k);
      const path = (ps) => { x.beginPath(); for (const p of ps) { p.pts.forEach((v, i) => { if (i % 2) return; i ? x.lineTo(p.pts[i], p.pts[i + 1]) : x.moveTo(p.pts[i], p.pts[i + 1]); }); x.closePath(); } };
      path(built.cut); x.fillStyle = '#3d4249'; x.fill('evenodd'); x.strokeStyle = '#ff6060'; x.lineWidth = 1 / k; x.stroke();
      path(built.eng); x.fillStyle = '#e8e8e8'; x.fill('evenodd');
      const over = built.W > S.device.width || built.H > S.device.height;
      $('#pnInfo', body).innerHTML = `${n2(built.W)} × ${n2(built.H)} mm · ${built.count} cut-out(s)` + (over ? ` · <b style="color:#ff8a8a">bigger than your ${S.device.width} × ${S.device.height} mm work area${built.W > S.device.width && st.preset.startsWith('19') ? ' — a 19" panel needs a laser with at least 483 mm of travel; use a 10" panel on the Falcon' : ''}</b>` : '');
    };
    body.oninput = draw; body.onchange = draw; setTimeout(draw, 0);
    modal({ title: 'AV panel maker', body, width: 900, buttons: [{ label: 'Cancel' }, { label: 'Create panel', cls: 'primary', onClick: () => { draw(); if (!built) return false; localStorage.setItem('bf.panel', JSON.stringify(st)); makePanel(built); } }] });
  }
  function buildPanel(st) {
    let W, H, rack = false;
    if (st.preset === 'custom') { W = st.w; H = st.h; } else { const [w, u] = PANELS[st.preset]; W = w; H = u * 44.45 - 0.79; rack = st.rack; }
    if (!(W > 10 && H > 10)) throw new Error('Panel size is too small');
    const cut = [st.r > 0 ? rrect(0, 0, W, H, st.r) : rect(0, 0, W, H)], eng = [];
    let xL = 8, xR = W - 8;
    if (rack) {
      const u = Math.round((H + 0.79) / 44.45), inset = 8.75;
      for (let k = 0; k < u; k++) for (const z of [6.35, 38.1]) { const y = H - (k * 44.45 + z - 0.395); cut.push(slot(inset, y, 10, 6.5), slot(W - inset, y, 10, 6.5)); }
      xL = inset + 12; xR = W - inset - 12;
    }
    const rows = st.rows.filter(r => r.type !== 'none' && (r.count | 0) > 0);
    let count = 0;
    rows.forEach((r, ri) => {
      const n = r.count | 0, pitch = (xR - xL) / n, cy = H - (ri + 0.5) * H / rows.length + (st.textSize > 0 ? st.textSize * 0.6 : 0);
      for (let i = 0; i < n; i++) {
        const cx = xL + pitch * (i + 0.5), c = cutout(r.type, cx, cy, { ...r, dHoles: st.dHoles });
        const cw = r.type === 'd' ? 26 : r.type === 'round' ? r.dia : r.type === 'rect' ? r.rw : r.type === 'iec' ? 27.5 : 9.5;
        if (cw > pitch - 1) throw new Error(`Row ${ri + 1}: ${n} cut-outs don't fit side by side — use fewer`);
        cut.push(...c.paths); count++;
        const lbl = String(r.label || '').replace(/\{n\}/gi, (r.start | 0) + i);
        if (lbl.trim() && st.textSize > 0) eng.push(...text(lbl, st.textSize, cx, cy - c.h / 2 - st.textSize - 1.2, { align: 'center', maxW: pitch - 1, bold: true }).paths);
      }
    });
    const bad = cut.slice(1).some(p => { const b = G.pathsBox([p]); return b.x0 < 0 || b.y0 < 0 || b.x1 > W || b.y1 > H; });
    if (bad) throw new Error('Some cut-outs fall off the panel — make it taller or use fewer rows');
    return { W, H, cut, eng, count };
  }
  function makePanel(b) {
    const ox = Math.max(0, (S.device.width - b.W) / 2), oy = Math.max(0, (S.device.height - b.H) / 2), gid = uid();
    const cl = cutLayer(), objs = [obj(shift(b.cut, ox, oy), cl, { groupId: gid })];
    if (b.eng.length) { const li = layerFor({ mode: 'fill', speed: 3000, maxPower: 30, minPower: 0, passes: 1, interval: 0.08 }, 'Panel labels', cl + 1); objs.push(obj(shift(b.eng, ox, oy), li, { groupId: gid })); }
    pushUndo(); addObjects(objs); commit(); run('zoomSel');
    toast(`Panel ${n2(b.W)} × ${n2(b.H)} mm with ${b.count} cut-out(s)`, 'ok');
  }

  Object.assign(cmds, { testGrid: testGridDialog, tags: tagDialog, avPanel: panelDialog });
  return { testGridDialog, tagDialog, panelDialog, saveTestCell, buildTag, buildPanel, tagRecords, makeTestGrid, parseCSV, text, rect, rrect, circle, slot, shift, obj, layerFor, cutLayer, formFields, fillForm };
})();
