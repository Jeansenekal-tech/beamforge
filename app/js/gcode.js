// Toolpath planner + GRBL G-code generator.
'use strict';
const Gcode = (() => {
  const fmt = (v) => { const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };

  // ---------- line mode ordering ----------
  function orderPaths(paths, start, optimize) {
    const n = paths.length;
    if (!optimize || n < 2) return paths.map(p => ({ ...p }));
    const boxes = paths.map(p => G.pathsBox([p]));
    // containment: parent must be cut after all its children (inner first)
    const blockers = new Array(n).fill(0), children = Array.from({ length: n }, () => []);
    if (n <= 2500) {
      for (let a = 0; a < n; a++) {
        if (!paths[a].closed) continue;
        const A = boxes[a];
        for (let b = 0; b < n; b++) {
          if (a === b) continue; const B = boxes[b];
          if (B.x0 >= A.x0 && B.x1 <= A.x1 && B.y0 >= A.y0 && B.y1 <= A.y1 && (B.x1 - B.x0) * (B.y1 - B.y0) < (A.x1 - A.x0) * (A.y1 - A.y0)) {
            if (G.pointInPolys([paths[a]], paths[b].pts[0], paths[b].pts[1])) { blockers[a]++; children[b].push(a); }
          }
        }
      }
    }
    const done = new Uint8Array(n), out = []; let cx = start[0], cy = start[1];
    for (let step = 0; step < n; step++) {
      let best = -1, bd = Infinity, bi = 0, brev = false;
      for (let k = 0; k < n; k++) {
        if (done[k] || blockers[k] > 0) continue;
        const q = paths[k].pts;
        if (paths[k].closed) {
          for (let i = 0; i < q.length; i += 2) { const d = (q[i] - cx) ** 2 + (q[i + 1] - cy) ** 2; if (d < bd) { bd = d; best = k; bi = i; brev = false; } }
        } else {
          const d0 = (q[0] - cx) ** 2 + (q[1] - cy) ** 2, d1 = (q[q.length - 2] - cx) ** 2 + (q[q.length - 1] - cy) ** 2;
          if (d0 < bd) { bd = d0; best = k; bi = 0; brev = false; }
          if (d1 < bd) { bd = d1; best = k; bi = 0; brev = true; }
        }
      }
      if (best < 0) { best = done.findIndex((d, k) => !d); bi = 0; brev = false; }
      done[best] = 1; children[best].forEach(c => blockers[c]--);
      const p = paths[best]; let q = p.pts;
      if (p.closed && bi) q = q.slice(bi).concat(q.slice(0, bi));
      if (brev) { const r = []; for (let i = q.length - 2; i >= 0; i -= 2) r.push(q[i], q[i + 1]); q = r; }
      out.push({ pts: q, closed: p.closed });
      cx = q[0]; cy = q[1];
      if (!p.closed) { cx = q[q.length - 2]; cy = q[q.length - 1]; }
    }
    return out;
  }

  // ---------- fill scanlines ----------
  function scanFill(paths, interval, angleDeg) {
    const rot = angleDeg * Math.PI / 180, c = Math.cos(-rot), s = Math.sin(-rot);
    const edges = [];
    for (const p of paths) {
      if (!p.closed) continue;
      const q = p.pts, n = q.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = q[2 * i] * c - q[2 * i + 1] * s, y0 = q[2 * i] * s + q[2 * i + 1] * c;
        const x1 = q[2 * j] * c - q[2 * j + 1] * s, y1 = q[2 * j] * s + q[2 * j + 1] * c;
        if (y0 === y1) continue;
        edges.push(y0 < y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
      }
    }
    if (!edges.length) return [];
    let ymin = Infinity, ymax = -Infinity; for (const e of edges) { if (e[1] < ymin) ymin = e[1]; if (e[3] > ymax) ymax = e[3]; }
    const nl = Math.floor((ymax - ymin) / interval);
    const buckets = Array.from({ length: nl + 1 }, () => []);
    edges.forEach((e, k) => { const a = Math.max(0, Math.ceil((e[1] - ymin) / interval - 0.5)); if (a <= nl) buckets[a].push(k); });
    const lines = []; let active = [];
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const back = (x, y) => [x * cr - y * sr, x * sr + y * cr];
    for (let li = 0; li <= nl; li++) {
      const y = ymin + (li + 0.5) * interval;
      active = active.filter(k => edges[k][3] > y);
      for (const k of buckets[li]) if (edges[k][3] > y) active.push(k);
      const xs = [];
      for (const k of active) { const e = edges[k]; if (e[1] <= y && e[3] > y) xs.push(e[0] + (y - e[1]) * (e[2] - e[0]) / (e[3] - e[1])); }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const segs = [];
      for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 1e-6) segs.push([back(xs[k], y), back(xs[k + 1], y)]);
      if (segs.length) lines.push(segs);
    }
    return lines; // [[ [[x,y],[x,y]], ... ] per scanline]
  }

  // ---------- main generator ----------
  // ctx: { objects, layers, layerOrder, device, opts:{startFrom, anchor, curPos, selectionOnly, optimize}, worldPaths(o), imageOf(o) }
  function generate(ctx) {
    const { device: dev, opts } = ctx;
    const Smax = dev.sMax || 1000;
    const ops = []; // {t:'L', layer} {t:0,x,y} {t:1,x,y,s(0..1),f} {t:'air',on} {t:'mode',m:'M3'|'M4'}
    let cur = [0, 0];
    const objs = ctx.objects.filter(o => !opts.selectionOnly || o._sel);
    const powerFrac = (L, v = 1) => ((L.minPower + (L.maxPower - L.minPower) * v) / 100);
    for (const li of ctx.layerOrder) {
      const L0 = ctx.layers[li]; if (!L0 || !L0.output) continue;
      const all = objs.filter(o => o.layer === li && !o.hidden);
      if (!all.length) continue;
      // objects may carry their own cut settings (material test grid etc.): run each setting as its own group
      const groups = new Map();
      for (const o of all) { const k = o.cut ? JSON.stringify(o.cut) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
      for (const [gk, lobjs] of groups) {
      const L = gk ? { ...L0, ...JSON.parse(gk) } : L0;
      ops.push({ t: 'L', layer: li, name: L.name + (gk ? ` [${L.speed} mm/min ${L.maxPower}%]` : ''), mode: L.mode });
      ops.push({ t: 'air', on: !!L.air }); ops.push({ t: 'mode', m: L.constant ? 'M3' : 'M4' });
      const passes = Math.max(1, L.passes | 0);
      const vecObjs = lobjs.filter(o => o.type !== 'image'), imgObjs = lobjs.filter(o => o.type === 'image');
      for (let pass = 0; pass < passes; pass++) {
        if (L.zStep && pass > 0) ops.push({ t: 'z', dz: -L.zStep });
        // Vector paths
        if (vecObjs.length) {
          const world = vecObjs.flatMap(o => ctx.worldPaths(o)).filter(p => p.pts.length >= 4);
          if (L.mode === 'line' || L.mode === 'image') {
            const ordered = orderPaths(world, cur, opts.optimize !== false);
            const P = L.maxPower / 100;
            for (const p of ordered) {
              const q = p.pts;
              ops.push({ t: 0, x: q[0], y: q[1] });
              for (let i = 2; i < q.length; i += 2) ops.push({ t: 1, x: q[i], y: q[i + 1], s: P, f: L.speed });
              if (p.closed) ops.push({ t: 1, x: q[0], y: q[1], s: P, f: L.speed });
              cur = [ops[ops.length - 1].x, ops[ops.length - 1].y];
            }
          } else if (L.mode === 'fill') {
            const angles = [L.angle || 0]; if (L.crosshatch) angles.push((L.angle || 0) + 90);
            for (const ang of angles) {
              const lines = scanFill(world.filter(p => p.closed), L.interval, ang);
              const ov = L.overscan || 0;
              lines.forEach((segs, k) => {
                const rev = L.bidir && (k % 2 === 1);
                let sg = segs.map(s => s.slice());
                if (rev) sg = sg.reverse().map(s => [s[1], s[0]]);
                const a = sg[0][0], b = sg[0][1];
                const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
                ops.push({ t: 0, x: a[0] - ux * ov, y: a[1] - uy * ov });
                if (ov) ops.push({ t: 1, x: a[0], y: a[1], s: 0, f: L.speed });
                for (let si = 0; si < sg.length; si++) {
                  const [p0, p1] = sg[si];
                  if (si > 0) ops.push({ t: 1, x: p0[0], y: p0[1], s: 0, f: L.speed });
                  ops.push({ t: 1, x: p1[0], y: p1[1], s: L.maxPower / 100, f: L.speed });
                }
                const e = sg[sg.length - 1][1];
                if (ov) ops.push({ t: 1, x: e[0] + ux * ov, y: e[1] + uy * ov, s: 0, f: L.speed });
                cur = [ops[ops.length - 1].x, ops[ops.length - 1].y];
              });
            }
          }
        }
        // Images
        for (const o of imgObjs) {
          const img = ctx.imageOf(o); if (!img) continue;
          const m = o.m;
          const ww = o.w * Math.hypot(m[0], m[1]), wh = o.h * Math.hypot(m[2], m[3]);
          const cols = Math.max(1, Math.round(ww / L.interval)), rows = Math.max(1, Math.round(wh / L.interval));
          const res = Raster.process(img, cols, rows, o.adj || {}, L.imageMode || 'jarvis', { threshold: o.adj?.threshold, halftoneCell: L.halftoneCell, halftoneAngle: L.halftoneAngle });
          const ov = L.overscan || 0;
          const gray = (L.imageMode === 'grayscale');
          let dirFlip = false;
          for (let r = 0; r < rows; r++) {
            const row = res.data.subarray(r * cols, r * cols + cols);
            let first = -1, last = -1;
            for (let c = 0; c < cols; c++) if (row[c] > 0.004) { if (first < 0) first = c; last = c; }
            if (first < 0) continue;
            const ly = o.h - (r + 0.5) * o.h / rows;
            const P = (c) => G.apply(m, c * o.w / cols, ly);
            const rev = L.bidir && dirFlip; dirFlip = !dirFlip;
            // build runs
            const runs = []; let c = first;
            while (c <= last) {
              const v = row[c]; let e = c + 1;
              const q = gray ? Math.round(v * 50) : (v > 0.5 ? 1 : 0);
              while (e <= last && (gray ? Math.round(row[e] * 50) : (row[e] > 0.5 ? 1 : 0)) === q) e++;
              runs.push([c, e, gray ? q / 50 : q]); c = e;
            }
            const seq = rev ? runs.slice().reverse().map(([a, b, v]) => [b, a, v]) : runs;
            const s0 = P(seq[0][0]), s1 = P(seq[0][1]);
            const dx = s1[0] - s0[0], dy = s1[1] - s0[1], dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
            ops.push({ t: 0, x: s0[0] - ux * ov, y: s0[1] - uy * ov });
            if (ov) ops.push({ t: 1, x: s0[0], y: s0[1], s: 0, f: L.speed });
            for (const [a, b, v] of seq) {
              const pb = P(b);
              const s = v > 0 ? (gray ? powerFrac(L, v) : L.maxPower / 100) : 0;
              ops.push({ t: 1, x: pb[0], y: pb[1], s, f: L.speed });
            }
            const e = P(seq[seq.length - 1][1]);
            if (ov) ops.push({ t: 1, x: e[0] + ux * ov, y: e[1] + uy * ov, s: 0, f: L.speed });
            cur = [ops[ops.length - 1].x, ops[ops.length - 1].y];
          }
        }
      }
      if (L.zStep && passes > 1) ops.push({ t: 'z', dz: L.zStep * (passes - 1) });
      }
    }
    // ---- job bounds & offset ----
    const box = G.emptyBox();
    for (const o of ops) if (o.t === 1 && o.s > 0) G.boxAdd(box, o.x, o.y);
    let ox = 0, oy = 0;
    if (G.boxValid(box) && opts.startFrom !== 'absolute') {
      const a = opts.anchor || 'bl';
      const ax = a[1] === 'l' ? box.x0 : a[1] === 'r' ? box.x1 : (box.x0 + box.x1) / 2;
      const ay = a[0] === 'b' ? box.y0 : a[0] === 't' ? box.y1 : (box.y0 + box.y1) / 2;
      const target = opts.startFrom === 'current' ? (opts.curPos || [0, 0]) : [0, 0];
      ox = target[0] - ax; oy = target[1] - ay;
    }
    // ---- rotary: the design's Y becomes rotation; scale it to what the controller needs ----
    const rot = dev.rotary && dev.rotary.enabled ? dev.rotary : null;
    const rk = rot ? rotaryScale(rot) : 1;
    const ry0 = opts.startFrom === 'current' ? (opts.curPos || [0, 0])[1] : 0;
    const mapY = (y) => rot ? ry0 + (y - ry0) * rk : y;
    // ---- emit ----
    const out = [];
    const rapid = dev.rapid || 3000;
    out.push(`; ${dev.appName || 'BeamForge'} G-code for GRBL`);
    out.push(`; Generated ${new Date().toISOString()}`);
    out.push(`; Start mode: ${opts.startFrom || 'absolute'}`);
    if (rot) out.push(`; Rotary: ${rot.type}, Y scale ${fmt(rk)} (object Ø${fmt(rot.objectDia)} mm)`);
    if (G.boxValid(box)) out.push(`; Bounds: X${fmt(box.x0 + ox)} Y${fmt(mapY(box.y0 + oy))} to X${fmt(box.x1 + ox)} Y${fmt(mapY(box.y1 + oy))}`);
    out.push('G90', 'G21');
    if (dev.header) out.push(...dev.header.split('\n').filter(Boolean));
    let lx = null, ly = null, lf = null, ls = null, mode = null, laserOn = false;
    const moves = []; let px = opts.startFrom === 'current' ? (opts.curPos || [0, 0])[0] : 0, py = opts.startFrom === 'current' ? (opts.curPos || [0, 0])[1] : 0;
    let tCut = 0, tTravel = 0, dCut = 0, dTravel = 0, curLayer = -1;
    // Motion model: trapezoidal acceleration with junction slow-down (like GRBL's planner, simplified).
    const A = Math.max(50, dev.accel || 1500); // mm/s^2
    let pdx = 0, pdy = 0, ptype = -1;
    const layerTimes = {};
    const segTime = (d, feed, type, dx, dy) => {
      if (d <= 0) return 0;
      const v = feed / 60, ux = dx / d, uy = dy / d;
      // corner severity 0 (straight on) .. 1 (full reversal / stop)
      let k = 1;
      if (ptype === type) k = (1 - (ux * pdx + uy * pdy)) / 2;
      pdx = ux; pdy = uy; ptype = type;
      const vr = Math.min(v, Math.sqrt(A * d)); // can't reach full speed on short moves
      return d / vr + k * vr / A;
    };
    for (const o of ops) {
      if (o.t === 'L') { out.push(`; Layer ${o.name} (${o.mode})`); curLayer = o.layer; continue; }
      if (o.t === 'air') { out.push(o.on ? 'M8' : 'M9'); continue; }
      if (o.t === 'z') { out.push('G91', `G0 Z${fmt(o.dz)}`, 'G90'); ptype = -1; continue; }
      if (o.t === 'mode') { if (mode !== o.m || !laserOn) { out.push(`${o.m} S0`); mode = o.m; laserOn = true; ls = 0; } continue; }
      const x = o.x + ox, y = o.y + oy;
      const sx = fmt(x), sy = fmt(mapY(y));
      if (sx === lx && sy === ly) continue;
      let line = o.t === 0 ? 'G0' : 'G1';
      if (sx !== lx) line += ' X' + sx; if (sy !== ly) line += ' Y' + sy;
      const d = Math.hypot(x - px, y - py);
      let dt;
      if (o.t === 1) {
        const S = Math.round(o.s * Smax * 100) / 100;
        if (S !== ls) { line += ' S' + fmt(S); ls = S; }
        if (o.f !== lf) { line += ' F' + fmt(o.f); lf = o.f; }
        dt = segTime(d, o.f, 1, x - px, y - py); tCut += dt; if (o.s > 0) dCut += d; else dTravel += d;
        moves.push({ x0: px, y0: py, x1: x, y1: y, s: o.s, t: tCut + tTravel, layer: curLayer });
      } else {
        dt = segTime(d, rapid, 0, x - px, y - py); tTravel += dt; dTravel += d;
        moves.push({ x0: px, y0: py, x1: x, y1: y, s: -1, t: tCut + tTravel, layer: curLayer });
      }
      layerTimes[curLayer] = (layerTimes[curLayer] || 0) + dt;
      out.push(line); lx = sx; ly = sy; px = x; py = y;
    }
    out.push('M9', 'M5');
    if (dev.returnHome !== false) {
      const home = opts.startFrom === 'current' ? (opts.curPos || [0, 0]) : [0, 0];
      out.push(`G0 X${fmt(home[0])} Y${fmt(home[1])}`);
      const d = Math.hypot(home[0] - px, home[1] - py); tTravel += segTime(d, rapid, 0, home[0] - px, home[1] - py);
      moves.push({ x0: px, y0: py, x1: home[0], y1: home[1], s: -1, t: tCut + tTravel, layer: -1 });
    }
    if (dev.footer) out.push(...dev.footer.split('\n').filter(Boolean));
    const k = dev.timeFactor > 0 ? dev.timeFactor : 1; // calibration learned from finished real jobs
    moves.forEach(m => m.t *= k);
    for (const l in layerTimes) layerTimes[l] *= k;
    return {
      gcode: out.join('\n') + '\n', moves, bounds: G.boxValid(box) ? { x0: box.x0 + ox, y0: box.y0 + oy, x1: box.x1 + ox, y1: box.y1 + oy } : null,
      machineBounds: G.boxValid(box) ? { x0: box.x0 + ox, y0: mapY(box.y0 + oy), x1: box.x1 + ox, y1: mapY(box.y1 + oy) } : null, rotary: !!rot,
      stats: { time: (tCut + tTravel) * k, cutTime: tCut * k, travelTime: tTravel * k, cutDist: dCut, travelDist: dTravel, lines: out.length, layerTimes, rawTime: tCut + tTravel }
    };
  }
  // rotary: how many controller Y-mm move the object's surface by 1 mm
  function rotaryScale(r) {
    const per = +r.mmPerRot > 0 ? +r.mmPerRot : 0;
    if (r.type === 'chuck') return per && r.objectDia > 0 ? per / (Math.PI * r.objectDia) : 1;
    return per && r.rollerDia > 0 ? per / (Math.PI * r.rollerDia) : 1; // roller: object diameter doesn't matter
  }
  // Parse arbitrary G-code into moves for preview (for loaded .gcode files)
  function parse(text) {
    let x = 0, y = 0, s = 0, f = 1000, rel = false, t = 0; const moves = [];
    for (const raw of text.split('\n')) {
      const l = raw.replace(/\(.*?\)|;.*$/g, '').trim().toUpperCase(); if (!l) continue;
      const w = {}; l.replace(/([A-Z])([-+]?[\d.]+)/g, (_, k, v) => { if (k === 'G' && w.G !== undefined) w.G2 = +v; else w[k] = +v; return ''; });
      if (w.G === 90 || w.G2 === 90) rel = false; if (w.G === 91 || w.G2 === 91) rel = true;
      if (w.S !== undefined) s = w.S; if (w.F !== undefined) f = w.F;
      if (w.M === 5) s = 0;
      if (w.X === undefined && w.Y === undefined) continue;
      const nx = w.X !== undefined ? (rel ? x + w.X : w.X) : x, ny = w.Y !== undefined ? (rel ? y + w.Y : w.Y) : y;
      const g = w.G ?? 1; const d = Math.hypot(nx - x, ny - y);
      if (g === 0) { t += d / 3000 * 60; moves.push({ x0: x, y0: y, x1: nx, y1: ny, s: -1, t }); }
      else { t += d / f * 60; moves.push({ x0: x, y0: y, x1: nx, y1: ny, s: s / 1000, t }); }
      x = nx; y = ny;
    }
    return moves;
  }
  return { generate, scanFill, orderPaths, parse, fmt, rotaryScale };
})();
