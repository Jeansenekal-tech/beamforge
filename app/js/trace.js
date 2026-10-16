// Raster-based vector tools: marching-squares contour tracing, text outlines,
// boolean ops (weld/union/subtract/intersect) and offsets via an offscreen canvas.
'use strict';
const Trace = (() => {
  // field: Float32Array (w*h) values 0..1 ; returns closed contours in pixel coords
  function contours(field, w, h, thr = 0.5) {
    // pad by 1
    const W = w + 2, H = h + 2;
    const f = new Float32Array(W * H);
    for (let y = 0; y < h; y++) f.set(field.subarray(y * w, y * w + w), (y + 1) * W + 1);
    const hId = (i, j) => 2 * (j * W + i), vId = (i, j) => 2 * (j * W + i) + 1;
    const pos = new Map();
    const pt = (id) => {
      let p = pos.get(id); if (p) return p;
      const k = id >> 1, i = k % W, j = (k / W) | 0;
      let a, b, ax, ay, bx, by;
      if ((id & 1) === 0) { a = f[j * W + i]; b = f[j * W + i + 1]; ax = i; ay = j; bx = i + 1; by = j; }
      else { a = f[j * W + i]; b = f[(j + 1) * W + i]; ax = i; ay = j; bx = i; by = j + 1; }
      const t = (b - a) !== 0 ? (thr - a) / (b - a) : 0.5;
      p = [ax + (bx - ax) * t - 1, ay + (by - ay) * t - 1];
      pos.set(id, p); return p;
    };
    const adj = new Map(); // edgeId -> [other edge ids]
    const link = (a, b) => {
      let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b);
      let m = adj.get(b); if (!m) adj.set(b, m = []); m.push(a);
    };
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const tl = f[j * W + i] >= thr, tr = f[j * W + i + 1] >= thr, br = f[(j + 1) * W + i + 1] >= thr, bl = f[(j + 1) * W + i] >= thr;
        const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const T = hId(i, j), B = hId(i, j + 1), L = vId(i, j), R = vId(i + 1, j);
        switch (c) {
          case 1: case 14: link(L, B); break;
          case 2: case 13: link(B, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(T, R); break;
          case 6: case 9: link(T, B); break;
          case 7: case 8: link(L, T); break;
          case 5: case 10: {
            const ctr = (f[j * W + i] + f[j * W + i + 1] + f[(j + 1) * W + i + 1] + f[(j + 1) * W + i]) / 4 >= thr;
            if ((c === 5) === ctr) { link(L, T); link(B, R); } else { link(T, R); link(L, B); }
            break;
          }
        }
      }
    }
    const used = new Set(), out = [];
    for (const start of adj.keys()) {
      if (used.has(start)) continue;
      const loop = []; let prev = -1, cur = start;
      while (cur !== undefined && !used.has(cur)) {
        used.add(cur); const p = pt(cur); loop.push(p[0], p[1]);
        const nb = adj.get(cur); let nx;
        for (const n of nb) if (n !== prev && !used.has(n)) { nx = n; break; }
        prev = cur; cur = nx;
      }
      if (loop.length >= 6) out.push(loop);
    }
    return out;
  }

  // Convert a canvas (alpha channel) into local-mm paths. pxPerMm, origin offsets in mm.
  // Canvas y goes down; output y goes up with the canvas top at y = ox/oy origin + height.
  function canvasToPaths(canvas, pxPerMm, x0mm, y0mm, simplifyPx = 0.35) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width: w, height: h } = canvas;
    const d = ctx.getImageData(0, 0, w, h).data;
    const field = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) field[k] = d[4 * k + 3] / 255;
    const loops = contours(field, w, h, 0.5);
    const paths = [];
    for (const l of loops) {
      const s = G.simplify(l.concat(l.slice(0, 2)), simplifyPx, true); s.length -= 2;
      if (s.length < 6) continue;
      const pts = new Array(s.length);
      for (let k = 0; k < s.length; k += 2) { pts[k] = x0mm + s[k] / pxPerMm; pts[k + 1] = y0mm + (h - s[k + 1]) / pxPerMm; }
      if (Math.abs(G.polyArea(pts)) < 1e-4) continue;
      paths.push({ pts, closed: true });
    }
    return paths;
  }

  // ----- Text to outlines -----
  function textToPaths(o) {
    // o: {text, font, size (mm, cap height-ish = font em), bold, italic, align, spacing(mm), lineSpacing}
    const lines = (o.text || ' ').split('\n');
    const pxPerMm = Math.max(4, Math.min(40, 300 / Math.max(o.size, 0.5)));
    const fpx = o.size * pxPerMm;
    const fontStr = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${fpx}px "${o.font}", sans-serif`;
    const mc = document.createElement('canvas').getContext('2d');
    mc.font = fontStr;
    if ('letterSpacing' in mc) mc.letterSpacing = `${(o.spacing || 0) * pxPerMm}px`;
    const widths = lines.map(l => mc.measureText(l).width);
    const lh = fpx * (o.lineSpacing || 1.2);
    const maxW = Math.max(1, ...widths);
    const pad = Math.ceil(fpx * 0.4);
    let W = Math.ceil(maxW + pad * 2), H = Math.ceil(lh * (lines.length - 1) + fpx * 1.4 + pad * 2);
    const cap = 8000; let k = 1;
    if (W > cap || H > cap) { k = cap / Math.max(W, H); }
    const cv = document.createElement('canvas'); cv.width = Math.ceil(W * k); cv.height = Math.ceil(H * k);
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.scale(k, k); c.font = fontStr; if ('letterSpacing' in c) c.letterSpacing = `${(o.spacing || 0) * pxPerMm}px`;
    c.fillStyle = '#000'; c.textBaseline = 'alphabetic';
    lines.forEach((l, i) => {
      let x = pad;
      if (o.align === 'center') x = pad + (maxW - widths[i]) / 2;
      else if (o.align === 'right') x = pad + maxW - widths[i];
      c.fillText(l, x, pad + fpx + i * lh);
    });
    const ppm = pxPerMm * k;
    // baseline of the last line sits at y = 0 local
    const baseY = (pad + fpx + (lines.length - 1) * lh) * k;
    const paths = canvasToPaths(cv, ppm, -pad * k / ppm, -(cv.height - baseY) / ppm, 0.3);
    return normalize(paths);
  }
  // shift paths so bbox min is at 0,0
  function normalize(paths) {
    const b = G.pathsBox(paths); if (!G.boxValid(b)) return paths;
    return paths.map(p => { const q = p.pts.slice(); for (let i = 0; i < q.length; i += 2) { q[i] -= b.x0; q[i + 1] -= b.y0; } return { pts: q, closed: p.closed }; });
  }

  // ----- raster boolean & offset -----
  function rasterCtx(box, margin, maxPx = 5000) {
    const w = box.x1 - box.x0 + 2 * margin, h = box.y1 - box.y0 + 2 * margin;
    const ppm = Math.max(2, Math.min(25, maxPx / Math.max(w, h)));
    const cv = document.createElement('canvas'); cv.width = Math.ceil(w * ppm) + 2; cv.height = Math.ceil(h * ppm) + 2;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const x0 = box.x0 - margin, y0 = box.y0 - margin;
    // world mm -> canvas px (flip y)
    ctx.setTransform(ppm, 0, 0, -ppm, -x0 * ppm, cv.height + y0 * ppm);
    return { cv, ctx, ppm, x0, y0 };
  }
  const tracePath = (ctx, paths, closeAll = true) => {
    ctx.beginPath();
    for (const p of paths) {
      const q = p.pts; if (q.length < 4) continue;
      ctx.moveTo(q[0], q[1]); for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]);
      if (p.closed || closeAll) ctx.closePath();
    }
  };
  // shapes: array of world-path arrays (each one object)
  function boolean(op, shapes) {
    let box = G.emptyBox(); shapes.forEach(s => box = G.boxUnion(box, G.pathsBox(s)));
    const R = rasterCtx(box, 1);
    const { ctx } = R; ctx.fillStyle = '#000';
    if (op === 'union') { shapes.forEach(s => { tracePath(ctx, s); ctx.fill('evenodd'); }); }
    else if (op === 'subtract') {
      tracePath(ctx, shapes[0]); ctx.fill('evenodd');
      ctx.globalCompositeOperation = 'destination-out';
      shapes.slice(1).forEach(s => { tracePath(ctx, s); ctx.fill('evenodd'); });
    } else if (op === 'intersect') {
      tracePath(ctx, shapes[0]); ctx.fill('evenodd');
      ctx.globalCompositeOperation = 'destination-in';
      shapes.slice(1).forEach(s => { tracePath(ctx, s); ctx.fill('evenodd'); });
    }
    return canvasToPaths(R.cv, R.ppm, R.x0, R.y0, 0.4);
  }
  function offset(shapes, dist) {
    let box = G.emptyBox(); shapes.forEach(s => box = G.boxUnion(box, G.pathsBox(s)));
    const R = rasterCtx(box, Math.max(0, dist) + 1);
    const { ctx } = R; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    shapes.forEach(s => { tracePath(ctx, s); ctx.fill('evenodd'); });
    ctx.lineWidth = Math.abs(dist) * 2;
    if (dist > 0) shapes.forEach(s => { tracePath(ctx, s); ctx.stroke(); });
    else { ctx.globalCompositeOperation = 'destination-out'; shapes.forEach(s => { tracePath(ctx, s); ctx.stroke(); }); }
    return canvasToPaths(R.cv, R.ppm, R.x0, R.y0, 0.4);
  }
  // Trace an image (bitmap -> vector), threshold 0..255, returns local mm paths for an image of w x h mm
  function traceImage(img, wmm, hmm, threshold = 128, invert = false) {
    const maxPx = 1600; const s = Math.min(1, maxPx / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const field = new Float32Array(cv.width * cv.height);
    for (let k = 0; k < field.length; k++) {
      const l = 0.299 * d[4 * k] + 0.587 * d[4 * k + 1] + 0.114 * d[4 * k + 2];
      let v = (threshold - l) / 40 + 0.5; v = Math.max(0, Math.min(1, v)); field[k] = invert ? 1 - v : v;
    }
    const loops = contours(field, cv.width, cv.height, 0.5);
    const sx = wmm / cv.width, sy = hmm / cv.height, out = [];
    for (const l of loops) {
      const q = G.simplify(l.concat(l.slice(0, 2)), 0.6, true); q.length -= 2;
      if (q.length < 6) continue;
      const pts = []; for (let k = 0; k < q.length; k += 2) pts.push(q[k] * sx, hmm - q[k + 1] * sy);
      if (Math.abs(G.polyArea(pts)) < sx * sy * 4) continue;
      out.push({ pts, closed: true });
    }
    return out;
  }

  // ----- Center line trace: thin dark shapes to 1-pixel skeletons and follow them as lines -----
  // returns open (and closed, for rings) paths in local mm for an image of wmm x hmm
  function centerLine(img, wmm, hmm, threshold = 128, invert = false, minBranchMm = 1, smooth = 0.6) {
    const maxPx = 1200; const sc = Math.min(1, maxPx / Math.max(img.width, img.height));
    const W = Math.max(3, Math.round(img.width * sc)) + 2, H = Math.max(3, Math.round(img.height * sc)) + 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = invert ? '#000' : '#fff'; c.fillRect(0, 0, W, H); c.drawImage(img, 1, 1, W - 2, H - 2);
    const d = c.getImageData(0, 0, W, H).data, b = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const a = d[4 * k + 3] / 255, l = (0.299 * d[4 * k] + 0.587 * d[4 * k + 1] + 0.114 * d[4 * k + 2]) * a + 255 * (1 - a);
      b[k] = (invert ? l >= threshold : l < threshold) ? 1 : 0;
    }
    for (let x = 0; x < W; x++) { b[x] = 0; b[(H - 1) * W + x] = 0; } for (let y = 0; y < H; y++) { b[y * W] = 0; b[y * W + W - 1] = 0; }
    // Zhang–Suen thinning
    let changed = true; const del = [];
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const k = y * W + x; if (!b[k]) continue;
          const p2 = b[k - W], p3 = b[k - W + 1], p4 = b[k + 1], p5 = b[k + W + 1], p6 = b[k + W], p7 = b[k + W - 1], p8 = b[k - 1], p9 = b[k - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2); if (A !== 1) continue;
          if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
          del.push(k);
        }
        if (del.length) { changed = true; for (const k of del) b[k] = 0; }
      }
    }
    const minLen = Math.max(2, minBranchMm * (W - 2) / wmm);
    const off = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const neigh = (k) => { // 4-neighbours always; a diagonal only if it isn't already reachable through a 4-neighbour
      const x = k % W, y = (k / W) | 0, out = [];
      for (const [dx, dy] of off) {
        const j = (y + dy) * W + x + dx; if (!b[j]) continue;
        if (dx && dy && (b[y * W + x + dx] || b[(y + dy) * W + x])) continue;
        out.push(j);
      }
      return out;
    };
    let paths = [];
    for (let iter = 0; iter < 3; iter++) {
      paths = []; const seen = new Uint8Array(W * H), usedEdge = new Set();
      const deg = (k) => neigh(k).length;
      const walk = (a, n) => {
        const line = [a, n]; usedEdge.add(a + ',' + n); usedEdge.add(n + ',' + a);
        let prev = a, cur = n;
        while (deg(cur) === 2 && !seen[cur]) {
          seen[cur] = 1; const nx = neigh(cur).find(j => j !== prev); if (nx === undefined) break;
          usedEdge.add(cur + ',' + nx); usedEdge.add(nx + ',' + cur); line.push(nx); prev = cur; cur = nx;
        }
        return line;
      };
      for (let k = 0; k < W * H; k++) {
        if (!b[k]) continue; const dg = deg(k);
        if (dg === 2) continue;
        if (dg === 0) continue; // lone dot
        for (const n of neigh(k)) if (!usedEdge.has(k + ',' + n)) { const l = walk(k, n); paths.push({ px: l, closed: false, a: dg, z: deg(l[l.length - 1]) }); }
      }
      for (let k = 0; k < W * H; k++) { // pure loops (rings)
        if (!b[k] || seen[k] || deg(k) !== 2) continue;
        const n = neigh(k)[0]; seen[k] = 1; const l = walk(k, n); paths.push({ px: l, closed: true, a: 2, z: 2 });
      }
      // prune short spurs (one free end, other end on a junction), then rebuild the graph
      let pruned = 0;
      for (const p of paths) {
        if (p.closed || p.px.length >= minLen) continue;
        const spur = (p.a === 1 && p.z >= 3) || (p.z === 1 && p.a >= 3), lone = p.a === 1 && p.z === 1 && p.px.length < minLen * 0.6;
        if (spur || lone) { for (let i = 0; i < p.px.length; i++) { const k = p.px[i]; if ((i === 0 && p.a >= 3) || (i === p.px.length - 1 && p.z >= 3)) continue; b[k] = 0; } pruned++; }
      }
      if (!pruned) break;
    }
    // to mm, simplify
    const sx = wmm / (W - 2), sy = hmm / (H - 2), out = [];
    for (const p of paths) {
      const q = []; for (const k of p.px) { const x = k % W, y = (k / W) | 0; q.push((x - 0.5) * sx, hmm - (y - 0.5) * sy); }
      if (p.closed) q.length -= 2;
      const s2 = G.simplify(p.closed ? q.concat(q.slice(0, 2)) : q, smooth * sx, p.closed);
      if (p.closed) s2.length -= 2;
      if (s2.length >= 4) out.push({ pts: s2, closed: p.closed && s2.length >= 6 });
    }
    return joinEnds(out, 1.5 * sx);
  }
  // merge open lines whose ends touch (left over at junctions after pruning)
  function joinEnds(paths, tol) {
    if (typeof Importers !== 'undefined' && Importers.joinPaths) {
      const open = paths.filter(p => !p.closed), closed = paths.filter(p => p.closed);
      return closed.concat(Importers.joinPaths(open, tol).map(p => ({ pts: p.pts, closed: false })));
    }
    return paths;
  }

  return { contours, canvasToPaths, textToPaths, boolean, offset, traceImage, centerLine, normalize };
})();
