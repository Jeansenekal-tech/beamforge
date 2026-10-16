// Engraving jig / template maker: cuts a holder with pockets for pencils, pens, coasters, blanks…, then lays
// out the design (or a list of names) over every pocket so a whole batch engraves in one go.
// Loaded after makers.js.
'use strict';
const Jig = (() => {
  const M = Makers;
  // item presets: shape, length (x) × width (y), engrave area (x × y), area offset along the length
  const PRESETS = {
    pencilHex: { label: 'Pencil — hexagonal (7 mm)', shape: 'rect', L: 176, Wd: 8.1, aw: 110, ah: 3.4, aoff: 10, notch: true },
    pencilRound: { label: 'Pencil — round (7.5 mm)', shape: 'rect', L: 176, Wd: 7.6, aw: 110, ah: 3, aoff: 10, notch: true },
    pencilShort: { label: 'Pencil — short / golf (9 cm)', shape: 'rect', L: 90, Wd: 8.1, aw: 50, ah: 3.4, aoff: 5, notch: true },
    pen: { label: 'Pen — round (10 mm)', shape: 'rect', L: 140, Wd: 10.2, aw: 70, ah: 4, aoff: -5, notch: true },
    marker: { label: 'Whiteboard marker / highlighter', shape: 'rect', L: 125, Wd: 16, aw: 60, ah: 6, aoff: 0, notch: true },
    coasterR: { label: 'Round coaster Ø 90', shape: 'round', L: 90, Wd: 90, aw: 70, ah: 70, aoff: 0, notch: true },
    coasterS: { label: 'Square coaster 95 × 95', shape: 'rect', L: 95, Wd: 95, aw: 80, ah: 80, aoff: 0, notch: true },
    keyring: { label: 'Keyring blank 50 × 30', shape: 'rect', L: 50, Wd: 30, aw: 34, ah: 22, aoff: 5, notch: true },
    dogtag: { label: 'Dog tag 50 × 28', shape: 'rect', L: 50, Wd: 28, aw: 40, ah: 18, aoff: 0, notch: true },
    card: { label: 'Business card (metal) 85 × 54', shape: 'rect', L: 85.6, Wd: 54, aw: 75, ah: 44, aoff: 0, notch: true },
    custom: { label: 'Custom rectangle', shape: 'rect' },
    customR: { label: 'Custom round', shape: 'round' },
  };
  const defaults = () => ({ preset: 'pencilHex', ...PRESETS.pencilHex, cl: 0.3, gap: 6, margin: 8, sheetW: Math.min(380, S.device.width), sheetH: Math.min(300, S.device.height), posX: 0, posY: 0, dir: 'auto', count: 0,
    content: 'design', names: 'Emma\nLiam\nOlivia\nNoah\nAva\nLucas', font: 'Helvetica', bold: true, rotDesign: 'auto', fit: true, sheetCut: true, ref: true });

  const notchR = (st) => { const pw = st.L + 2 * st.cl, ph = (st.shape === 'round' ? st.L : st.Wd) + 2 * st.cl; return Math.min(9, Math.max(5, Math.min(pw, ph) * 0.6)); };
  // pockets: [{cx, cy, rot}] with rot = 0 (length along X) or 90 (length along Y)
  function layout(st) {
    st = { ...st, gap: st.notch ? Math.max(st.gap, notchR(st) * 0.55 + 2.5) : st.gap }; // keep wood between a notch and the next pocket
    const pw = st.L + 2 * st.cl, ph = (st.shape === 'round' ? st.L : st.Wd) + 2 * st.cl;
    const fit = (w, h) => { const uw = st.sheetW - 2 * st.margin, uh = st.sheetH - 2 * st.margin; return { cols: Math.max(0, Math.floor((uw + st.gap) / (w + st.gap))), rows: Math.max(0, Math.floor((uh + st.gap) / (h + st.gap))), w, h }; };
    const a = fit(pw, ph), b = fit(ph, pw);
    let g = st.dir === 'x' ? a : st.dir === 'y' ? b : (b.cols * b.rows > a.cols * a.rows ? b : a);
    const rot = g === a ? 0 : 90, max = g.cols * g.rows, n = st.count > 0 ? Math.min(st.count, max) : max;
    // shrink the grid to what's used and centre it on the sheet
    const cols = Math.min(g.cols, n), rows = Math.ceil(n / Math.max(1, cols));
    const gw = cols * g.w + (cols - 1) * st.gap, gh = rows * g.h + (rows - 1) * st.gap;
    const x0 = st.posX + (st.sheetW - gw) / 2, y0 = st.posY + (st.sheetH - gh) / 2, out = [];
    for (let i = 0; i < n; i++) { const r = Math.floor(i / cols), c = i % cols; out.push({ cx: x0 + c * (g.w + st.gap) + g.w / 2, cy: y0 + gh - r * (g.h + st.gap) - g.h / 2, rot }); }
    return { pockets: out, max, rot, pw, ph };
  }
  const xf = (p) => G.mul(G.translate(p.cx, p.cy), G.rotate(p.rot));            // item frame → world
  function pocketPaths(st, p) {
    const pw = st.L + 2 * st.cl, ph = st.Wd + 2 * st.cl, out = [];
    if (st.shape === 'round') out.push(M.circle(0, 0, st.L / 2 + st.cl));
    else out.push(M.rect(-pw / 2, -ph / 2, pw, ph));
    if (st.notch) { // finger notch to lift the item out (overlapping cut — the scrap drops out with the pocket)
      const r = notchR(st), k = 0.45 * r; // circle mostly inside the pocket, poking out by 0.55 r
      out.push(st.shape === 'round' ? M.circle(st.L / 2 + st.cl - k, 0, r) : M.circle(0, -ph / 2 + k, r));
    }
    return G.xformPaths(out, xf(p));
  }
  function areaPaths(st, p) { return G.xformPaths([M.rect(st.aoff - st.aw / 2, -st.ah / 2, st.aw, st.ah)], xf(p)); }
  // fit a box (w×h) into the area: returns { k, deg }
  function fitInto(bw, bh, aw, ah, rotMode, scale) {
    const opts = (rotMode === 'auto' ? [0, 90] : [+rotMode]).map(deg => { const w = deg ? bh : bw, h = deg ? bw : bh; return { deg, k: Math.min(aw / w, ah / h) }; });
    const best = opts.reduce((a, b) => b.k > a.k ? b : a);
    return { deg: best.deg, k: scale ? best.k : 1, over: best.k < 1 };
  }
  function textPaths(str, st, aw, ah) {
    const size = ah * 0.9;
    let paths = Trace.textToPaths({ text: str, font: st.font || 'Helvetica', size, bold: !!st.bold, italic: false, align: 'left', spacing: 0 });
    let b = G.pathsBox(paths); if (!G.boxValid(b)) return [];
    const k = Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0), 1.5);
    return G.xformPaths(paths, G.mul(G.scale(k, k), G.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2)));
  }
  // what goes on each pocket: { design: bool, text: string|null }
  function contentRanges(st, nPockets) {
    const names = st.content === 'design' ? [] : String(st.names || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (st.content === 'design') return [Array.from({ length: nPockets }, () => ({ design: true, text: null }))];
    if (!names.length) throw new Error('Type the names / text, one per line');
    const batches = [];
    for (let i = 0; i < names.length; i += nPockets) batches.push(names.slice(i, i + nPockets).map(t => ({ design: st.content === 'both', text: t })));
    return batches;
  }
  // design geometry inside the item frame for one pocket: area split when there is also text
  function areas(st, item) {
    const A = { x: st.aoff, w: st.aw, h: st.ah };
    if (!(item.design && item.text)) return { d: item.design ? A : null, t: item.text ? A : null };
    const dw = Math.min(st.ah * 1.2, st.aw * 0.35), gap = Math.min(3, st.aw * 0.04);
    return { d: { x: A.x - A.w / 2 + dw / 2, w: dw, h: A.h }, t: { x: A.x - A.w / 2 + dw + gap + (A.w - dw - gap) / 2, w: A.w - dw - gap, h: A.h } };
  }

  function dialog() {
    const st = { ...defaults(), ...JSON.parse(localStorage.getItem('bf.jig') || '{}') };
    const design = selObjs().filter(o => S.doc.layers[o.layer].show);
    if (!design.length && st.content !== 'names') st.content = 'names';
    const map = { jgPre: 'preset', jgL: 'L', jgW: 'Wd', jgCl: 'cl', jgNotch: 'notch', jgAW: 'aw', jgAH: 'ah', jgAO: 'aoff', jgSW: 'sheetW', jgSH: 'sheetH', jgPX: 'posX', jgPY: 'posY', jgGap: 'gap', jgMar: 'margin', jgDir: 'dir', jgCnt: 'count',
      jgCon: 'content', jgNames: 'names', jgFont: 'font', jgBold: 'bold', jgRot: 'rotDesign', jgFit: 'fit', jgSheet: 'sheetCut', jgRef: 'ref' };
    const body = document.createElement('div'); body.className = 'gen2';
    body.innerHTML = `<div><canvas id="jgPv" width="400" height="330"></canvas><div class="note" id="jgInfo"></div></div><div class="form gform">
      <h5>Item</h5>
      <label>What are you engraving?</label><select id="jgPre">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
      <label>Length × width (mm)</label><div class="row tight" style="margin:0"><input type="text" id="jgL" style="width:60px"><input type="text" id="jgW" style="width:60px"><span class="note jg-r">Ø = length</span></div>
      <label>Clearance around it (mm)</label><input type="text" id="jgCl" title="Pocket = item + this much on every side. 0.2–0.4 mm for a snug fit.">
      <label>Finger notch to lift it out</label><input type="checkbox" id="jgNotch">
      <label>Engrave area (mm)</label><div class="row tight" style="margin:0"><input type="text" id="jgAW" style="width:60px"><input type="text" id="jgAH" style="width:60px"><span class="note">shift</span><input type="text" id="jgAO" style="width:48px" title="Move the engraving along the length, e.g. away from a pencil's eraser"></div>
      <h5>Jig sheet</h5>
      <label>Sheet size (mm)</label><div class="row tight" style="margin:0"><input type="text" id="jgSW" style="width:60px"><input type="text" id="jgSH" style="width:60px"></div>
      <label>Sheet position X · Y</label><div class="row tight" style="margin:0"><input type="text" id="jgPX" style="width:60px"><input type="text" id="jgPY" style="width:60px"><span class="note">0,0 = against the bed corner</span></div>
      <label>Gap · edge margin (mm)</label><div class="row tight" style="margin:0"><input type="text" id="jgGap" style="width:60px"><input type="text" id="jgMar" style="width:60px"></div>
      <label>Item direction</label><select id="jgDir"><option value="auto">Whichever fits the most</option><option value="x">Lengthways left–right</option><option value="y">Lengthways front–back</option></select>
      <label>How many pockets</label><div class="row tight" style="margin:0"><input type="text" id="jgCnt" style="width:60px"><span class="note">0 = as many as fit</span></div>
      <label>Cut the sheet outline too</label><input type="checkbox" id="jgSheet">
      <h5>Engraving</h5>
      <label>On each item</label><select id="jgCon"><option value="design" ${design.length ? '' : 'disabled'}>The selected design${design.length ? '' : ' (select one first)'}</option><option value="names">Names / text from a list</option><option value="both" ${design.length ? '' : 'disabled'}>Selected design + a name</option></select>
      <label class="jg-n">Names (one per line)</label><div class="jg-n"><textarea id="jgNames" rows="4" style="width:100%"></textarea><button class="small" id="jgCsv">Load list…</button></div>
      <label class="jg-n">Font · bold</label><div class="jg-n row tight" style="margin:0"><input type="text" id="jgFont" data-text="1" style="width:130px"><input type="checkbox" id="jgBold"></div>
      <label class="jg-d">Turn design</label><select class="jg-d" id="jgRot"><option value="auto">Automatically (biggest fit)</option><option value="0">Never</option><option value="90">90°</option></select>
      <label class="jg-d">Scale design to fill the area</label><input class="jg-d" type="checkbox" id="jgFit">
      <label>Show pockets on the engrave page</label><input type="checkbox" id="jgRef" title="Outlines on a layer that isn't sent to the laser, so you can see where everything goes">
      <div class="full note">Creates two pages: <b>1 – cut jig</b> (cut once from scrap board) and <b>2 – engrave</b>. Leave the jig on the bed, drop the items in and run page 2 with <b>Start from: Absolute coords</b>. A longer list makes more engrave pages.</div></div>`;
    M.fillForm(body, st, map);
    $('#jgCsv', body).onclick = async () => { const f = await pickFile('.csv,.txt', true); if (f) { const rows = M.parseCSV(bytesToText(f.data)); $('#jgNames', body).value = rows.map(r => r[0]).join('\n'); draw(); } };
    let lastPreset = st.preset, L = null, batches = [];
    const draw = () => {
      M.formFields(body, st, map);
      if (st.preset !== lastPreset) { const p = PRESETS[st.preset]; lastPreset = st.preset; if (p.L) { Object.assign(st, p); delete st.label; M.fillForm(body, st, map); } else st.shape = p.shape; }
      st.shape = PRESETS[st.preset].shape || 'rect'; if (st.shape === 'round') st.Wd = st.L;
      $('#jgW', body).disabled = st.shape === 'round'; $$('.jg-r', body).forEach(e => e.style.display = st.shape === 'round' ? '' : 'none');
      $$('.jg-n', body).forEach(e => e.style.display = st.content === 'design' ? 'none' : ''); $$('.jg-d', body).forEach(e => e.style.display = st.content === 'names' ? 'none' : '');
      const c = $('#jgPv', body), x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#2a2d33'; x.fillRect(0, 0, c.width, c.height);
      try {
        if (st.L <= 0 || st.Wd <= 0) throw new Error('Enter the item size');
        L = layout(st); if (!L.pockets.length) throw new Error("Not even one item fits on the sheet — make the sheet bigger or the margin smaller");
        batches = contentRanges(st, L.pockets.length);
      } catch (e) { L = null; $('#jgInfo', body).textContent = e.message; return; }
      const k = Math.min((c.width - 20) / st.sheetW, (c.height - 20) / st.sheetH);
      x.translate((c.width - st.sheetW * k) / 2 - st.posX * k, (c.height + st.sheetH * k) / 2 + st.posY * k); x.scale(k, -k);
      const path = (ps) => { x.beginPath(); for (const p of ps) { for (let i = 0; i < p.pts.length; i += 2) i ? x.lineTo(p.pts[i], p.pts[i + 1]) : x.moveTo(p.pts[i], p.pts[i + 1]); if (p.closed) x.closePath(); } };
      x.fillStyle = '#c9a77a'; x.fillRect(st.posX, st.posY, st.sheetW, st.sheetH);
      x.lineWidth = 1 / k;
      const first = batches[0] || [];
      L.pockets.forEach((p, i) => {
        path(pocketPaths(st, p)); x.fillStyle = '#1e2024'; x.fill('nonzero'); x.strokeStyle = '#ff4040'; x.stroke();
        const it = first[i]; if (!it) return;
        path(areaPaths(st, p)); x.fillStyle = it.text || it.design ? 'rgba(90,170,255,.55)' : 'rgba(255,255,255,.1)'; x.fill();
      });
      x.setTransform(1, 0, 0, 1, 0, 0);
      const items = st.content === 'design' ? L.pockets.length : batches.reduce((a, b) => a + b.length, 0);
      $('#jgInfo', body).innerHTML = `<b>${L.pockets.length}</b> pocket${L.pockets.length === 1 ? '' : 's'} (${L.max} fit) · items ${L.rot ? 'front–back' : 'left–right'}<br>${items} item(s) → ${batches.length} engrave page${batches.length === 1 ? '' : 's'}` +
        (st.posX + st.sheetW > S.device.width + 0.01 || st.posY + st.sheetH > S.device.height + 0.01 ? ` · <b style="color:#ff8a8a">sheet goes past the ${S.device.width} × ${S.device.height} mm work area</b>` : '');
    };
    body.oninput = draw; body.onchange = draw; setTimeout(draw, 0);
    modal({ title: 'Engraving jig maker', body, width: 900, buttons: [{ label: 'Cancel' }, { label: 'Create jig', cls: 'primary', onClick: () => { draw(); if (!L) return false; const s2 = { ...st }; localStorage.setItem('bf.jig', JSON.stringify(s2)); return make(st, L, batches, design) !== false; } }] });
  }

  function make(st, L, batches, design) {
    syncPages(); pushUndo();
    const cl = M.cutLayer(), jigObjs = [], gid = uid();
    const cut = [];
    if (st.sheetCut) cut.push(M.rect(st.posX, st.posY, st.sheetW, st.sheetH));
    for (const p of L.pockets) cut.push(...pocketPaths(st, p));
    jigObjs.push(M.obj(cut, cl, { groupId: gid }));
    let refLayer = null;
    if (st.ref) { refLayer = freeLayer(cl + 1); Object.assign(S.doc.layers[refLayer], { mode: 'line', output: false, name: 'Jig pockets (not sent)' }); }
    let txtLayer = null;
    const dBox = design.length ? boxOf(design) : null;
    const pages = batches.map((items) => {
      const objs = [];
      if (refLayer !== null) objs.push(M.obj(L.pockets.flatMap(p => pocketPaths(st, p)), refLayer));
      items.forEach((it, i) => {
        const p = L.pockets[i], A = areas(st, it), T = xf(p);
        if (A.d && dBox) {
          const bw = dBox.x1 - dBox.x0, bh = dBox.y1 - dBox.y0, f = fitInto(bw, bh, A.d.w, A.d.h, st.rotDesign, st.fit);
          const Mx = G.mul(T, G.mul(G.translate(A.d.x, 0), G.mul(G.rotate(f.deg), G.mul(G.scale(f.k, f.k), G.translate(-(dBox.x0 + dBox.x1) / 2, -(dBox.y0 + dBox.y1) / 2)))));
          const g2 = uid();
          for (const o of design) { const c = cloneObj(o); c.id = uid(); c.groupId = g2; c.m = G.mul(Mx, o.m); objs.push(c); }
        }
        if (A.t && it.text) {
          const tp = textPaths(it.text, st, A.t.w, A.t.h); if (!tp.length) return;
          if (txtLayer === null) txtLayer = M.layerFor({ mode: 'fill', speed: 3000, maxPower: 25, minPower: 0, passes: 1, interval: 0.08 }, 'Jig text', (refLayer ?? cl) + 1);
          objs.push(M.obj(G.xformPaths(tp, G.mul(T, G.translate(A.t.x, 0))), txtLayer));
        }
      });
      return objs;
    });
    const base = st.preset === 'custom' || st.preset === 'customR' ? 'Jig' : PRESETS[st.preset].label.split(' —')[0].split(' (')[0];
    const jigPage = addPage(jigObjs, `${base} – 1 cut jig`);
    pages.forEach((objs, b) => addPage(objs, `${base} – 2 engrave${pages.length > 1 ? ' ' + (b + 1) : ''}`));
    switchPage(jigPage); renderPages(); commit(); run('zoomFit');
    toast(`Jig with ${L.pockets.length} pockets on page "${S.doc.pages[jigPage].name}", engraving on ${pages.length} page(s) after it`, 'ok');
  }
  cmds.jig = dialog;
  return { dialog, layout, PRESETS, defaults, contentRanges, pocketPaths, make };
})();
