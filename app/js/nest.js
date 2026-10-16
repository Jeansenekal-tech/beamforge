// True-shape nesting: packs parts by their real outlines (holes included) into a container,
// keeping a minimum gap ("padding") between parts and an edge buffer from the container.
// Works on a raster of the container; part footprints are drawn conservatively so the real gap is
// never smaller than requested. Optional "spread" mode finds the largest gap at which everything fits.
'use strict';
const Nest = (() => {
  const yieldUI = () => new Promise(r => setTimeout(r, 0));

  function drawPaths(ctx, list, toPx) { // list: array of objects, each an array of paths
    for (const paths of list) {
      ctx.beginPath();
      for (const p of paths) {
        const q = p.pts; if (q.length < 4) continue;
        let [x, y] = toPx(q[0], q[1]); ctx.moveTo(x, y);
        for (let i = 2; i < q.length; i += 2) { [x, y] = toPx(q[i], q[i + 1]); ctx.lineTo(x, y); }
        if (p.closed) ctx.closePath();
      }
      ctx.fill('evenodd'); ctx.stroke();
    }
  }
  function runsOf(cv, minAlpha) {
    const { width: w, height: h } = cv, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const runs = [];
    for (let y = 0; y < h; y++) {
      let s = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && d[4 * (y * w + x) + 3] >= minAlpha;
        if (on && s < 0) s = x; else if (!on && s >= 0) { runs.push([y, s, x]); s = -1; }
      }
    }
    return runs;
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

  // ----- container grid (1 = blocked) -----
  function buildContainer(container, c, edge) {
    const b = container.box, W = Math.ceil((b.x1 - b.x0) / c), H = Math.ceil((b.y1 - b.y0) / c);
    const cv = canvas(W, H), ctx = cv.getContext('2d', { willReadFrequently: true });
    const toPx = (x, y) => [(x - b.x0) / c, (b.y1 - y) / c];
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0)'; ctx.lineWidth = 0.01;
    drawPaths(ctx, [container.paths], toPx);
    // erode by the edge buffer (+1 px safety)
    ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.lineWidth = 2 * edge / c + 1;
    ctx.beginPath();
    for (const p of container.paths) { const q = p.pts; let [x, y] = toPx(q[0], q[1]); ctx.moveTo(x, y); for (let i = 2; i < q.length; i += 2) { [x, y] = toPx(q[i], q[i + 1]); ctx.lineTo(x, y); } if (p.closed) ctx.closePath(); }
    ctx.stroke();
    const d = ctx.getImageData(0, 0, W, H).data;
    const grid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) grid[i] = d[4 * i + 3] >= 250 ? 0 : 1; // only fully-inside cells are usable
    return { W, H, grid, c, box: b };
  }
  // ----- part footprint at a rotation -----
  function footprint(unit, deg, c, pad) {
    const cx = unit.cx, cy = unit.cy, M = G.rotate(deg, cx, cy);
    const rot = unit.objs.map(paths => G.xformPaths(paths, M));
    let bb = G.emptyBox(); rot.forEach(ps => bb = G.boxUnion(bb, G.pathsBox(ps)));
    const m = Math.ceil(pad / c) + 2;
    const fx0 = bb.x0 - m * c, fy1 = bb.y1 + m * c;
    const mw = Math.ceil((bb.x1 - bb.x0) / c) + 2 * m + 1, mh = Math.ceil((bb.y1 - bb.y0) / c) + 2 * m + 1;
    const toPx = (x, y) => [(x - fx0) / c, (fy1 - y) / c];
    const mk = (lw) => {
      const cv = canvas(mw, mh), ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = lw;
      drawPaths(ctx, rot, toPx); return runsOf(cv, 1);
    };
    const runsU = mk(1), runsD = pad > 0 ? mk(2 * pad / c + 1) : runsU;
    let ux0 = Infinity, ux1 = -Infinity, uy0 = Infinity, uy1 = -Infinity;
    for (const [y, s, e] of runsU) { if (s < ux0) ux0 = s; if (e > ux1) ux1 = e; if (y < uy0) uy0 = y; if (y + 1 > uy1) uy1 = y + 1; }
    let cells = 0; for (const r of runsU) cells += r[2] - r[1];
    return { deg, fx0, fy1, mw, mh, runsU, runsD, ux0, ux1, uy0, uy1, cells };
  }

  // ----- placement on a grid -----
  class Board {
    constructor(cont) {
      this.cont = cont; const { W, H } = cont;
      this.W = W; this.H = H; this.part = new Uint8Array(W * H);
      this.cPre = new Int32Array((W + 1) * H); this.pPre = new Int32Array((W + 1) * H);
      for (let y = 0; y < H; y++) this._pre(cont.grid, this.cPre, y);
      this.minTop = H;
    }
    _pre(g, pre, y) { const W = this.W, o = y * (W + 1), r = y * W; pre[o] = 0; for (let x = 0; x < W; x++) pre[o + x + 1] = pre[o + x] + g[r + x]; }
    // rightmost blocked cell in [a,b) of row y, or -1
    _lastBlocked(pre, y, a, b) {
      const o = y * (this.W + 1), tot = pre[o + b];
      if (tot === pre[o + a]) return -1;
      let lo = a + 1, hi = b; // smallest k with pre[k] == tot -> last blocked = k-1
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pre[o + mid] === tot) hi = mid; else lo = mid + 1; }
      return lo - 1;
    }
    // returns true if the part fits at (x,y), otherwise the next x worth trying
    test(f, x, y) {
      const W = this.W, H = this.H; let jump = x + 1;
      for (const [r, s, e] of f.runsU) {
        const gy = y + r; if (gy < 0 || gy >= H) return Infinity;
        const a = x + s, b = x + e; if (a < 0 || b > W) return a < 0 ? x - a : Infinity;
        const lb = this._lastBlocked(this.cPre, gy, a, b); if (lb >= 0) return Math.max(jump, lb + 1 - s);
      }
      for (const [r, s, e] of f.runsD) {
        const gy = y + r; if (gy < 0 || gy >= H) continue;
        const a = Math.max(0, x + s), b = Math.min(W, x + e); if (a >= b) continue;
        const lb = this._lastBlocked(this.pPre, gy, a, b); if (lb >= 0) return Math.max(jump, lb + 1 - s);
      }
      return true;
    }
    // lowest (bottom-most) then left-most position; stop early once below `limitTop`
    find(f, limitTop) {
      const yMin = -f.uy0, yMax = this.H - f.uy1, xMin = -f.ux0, xMax = this.W - f.ux1;
      if (yMax < yMin || xMax < xMin) return null;
      for (let y = yMax; y >= yMin; y--) {
        if (limitTop !== undefined && y + f.uy0 < limitTop) return null;
        let x = xMin;
        while (x <= xMax) { const t = this.test(f, x, y); if (t === true) return { x, y, top: y + f.uy0 }; if (!isFinite(t)) break; x = Math.max(x + 1, t); }
      }
      return null;
    }
    place(f, x, y) {
      const rows = new Set();
      for (const [r, s, e] of f.runsU) { const gy = y + r; for (let gx = x + s; gx < x + e; gx++) this.part[gy * this.W + gx] = 1; rows.add(gy); }
      for (const gy of rows) this._pre(this.part, this.pPre, gy);
      this.minTop = Math.min(this.minTop, y + f.uy0);
    }
  }

  function rotations(step) { if (!step) return [0]; const out = []; for (let a = 0; a < 360 - 1e-6; a += step) out.push(a); return out; }

  // one complete packing attempt in a given order
  async function attempt(cont, fps, order, ctl) {
    const bd = new Board(cont), placed = [];
    for (let k = 0; k < order.length; k++) {
      if (ctl.stop()) return null;
      const ui = order[k]; let best = null;
      for (const f of fps[ui]) {
        const r = bd.find(f, best ? best.top + 1 : undefined);
        if (r && (!best || r.top > best.top || (r.top === best.top && r.x < best.x))) best = { ...r, f };
      }
      if (best) { bd.place(best.f, best.x, best.y); placed.push({ ui, f: best.f, x: best.x, y: best.y }); }
      if (ctl.tick) await ctl.tick((k + 1) / order.length);
    }
    return { placed, usedRows: bd.H - bd.minTop, board: bd };
  }
  const better = (a, b) => !b || a.placed.length > b.placed.length || (a.placed.length === b.placed.length && a.usedRows < b.usedRows);

  // main entry
  // opts: { container:{paths, box}, units:[{objs:[paths...], cx, cy, area}], padding, edge, rotStep, seconds, spread, onProgress(p,msg), stopped() }
  async function run(opts) {
    const cb = opts.container.box, span = Math.max(cb.x1 - cb.x0, cb.y1 - cb.y0);
    const c = Math.max(0.15, span / (opts.fine ? 750 : 520));
    const rots = rotations(opts.rotStep);
    const n = opts.units.length;
    const t0 = performance.now(), budget = opts.seconds * 1000;
    const stopped = () => opts.stopped && opts.stopped();
    const prog = (p, msg) => opts.onProgress && opts.onProgress(Math.min(1, p), msg);

    const prep = async (pad, edge) => {
      const cont = buildContainer(opts.container, c, edge);
      const fps = [];
      for (let i = 0; i < n; i++) { fps.push(rots.map(d => footprint(opts.units[i], d, c, pad))); if (i % 4 === 3) await yieldUI(); }
      return { cont, fps };
    };
    const orders = (fps) => {
      const idx = [...Array(n).keys()], area = i => fps[i][0].cells;
      const dim = i => Math.max(fps[i][0].ux1 - fps[i][0].ux0, fps[i][0].uy1 - fps[i][0].uy0);
      const ht = i => fps[i][0].uy1 - fps[i][0].uy0;
      return [idx.slice().sort((a, b) => area(b) - area(a)), idx.slice().sort((a, b) => dim(b) - dim(a)), idx.slice().sort((a, b) => ht(b) - ht(a))];
    };
    const shuffleNear = (o) => { const a = o.slice(); const swaps = 1 + Math.floor(Math.random() * Math.max(1, n / 4)); for (let s = 0; s < swaps; s++) { const i = Math.floor(Math.random() * (n - 1)); const j = Math.min(n - 1, i + 1 + Math.floor(Math.random() * 3)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    // --- phase 1: pack with the requested padding, improving until time runs out ---
    prog(0, 'Preparing shapes…');
    let { cont, fps } = await prep(opts.padding, opts.edge);
    let best = null, tries = 0;
    const base = orders(fps);
    const packBudget = opts.spread ? budget * 0.45 : budget;
    for (let i = 0; ; i++) {
      if (stopped() && best) break;
      const order = i < base.length ? base[i] : shuffleNear(best ? best.order : base[0]);
      const r = await attempt(cont, fps, order, { stop: () => stopped() && !!best, tick: i === 0 ? async (p) => { prog(p * 0.3, 'Nesting…'); await yieldUI(); } : null });
      if (!r) break;
      tries++; r.order = order;
      if (better(r, best)) best = r;
      const el = performance.now() - t0;
      prog(0.3 + 0.7 * Math.min(1, el / packBudget) * (opts.spread ? 0.5 : 1), `Nesting… try ${tries} · ${best.placed.length}/${n} placed`);
      await yieldUI();
      if (n <= 1) break;
      if (el > packBudget && i >= base.length - 1) break;
    }
    let pad = opts.padding;
    // --- phase 2 (spread): largest padding at which everything still fits ---
    if (opts.spread && best && best.placed.length === n && !stopped()) {
      let lo = opts.padding, hi = Math.min(cb.x1 - cb.x0, cb.y1 - cb.y0) / 2, bestR = best, bestFps = fps, bestCont = cont;
      for (let it = 0; it < 9 && hi - lo > Math.max(c, 0.2) && !stopped(); it++) {
        const mid = (lo + hi) / 2;
        prog(0.65 + it * 0.035, `Maximising spacing… trying ${mid.toFixed(1)} mm`);
        const P = await prep(mid, opts.edge);
        let ok = null;
        for (const order of orders(P.fps)) { const r = await attempt(P.cont, P.fps, order, { stop: () => false }); if (r.placed.length === n) { r.order = order; ok = r; break; } await yieldUI(); }
        if (ok) { lo = mid; bestR = ok; bestFps = P.fps; bestCont = P.cont; } else hi = mid;
      }
      best = bestR; fps = bestFps; cont = bestCont; pad = lo;
    }
    if (!best) return null;
    // --- convert grid placements to transforms ---
    const res = [];
    let ux = G.emptyBox();
    for (const p of best.placed) {
      const f = p.f, wx = cb.x0 + p.x * c, wy = cb.y1 - p.y * c;
      const dx = wx - f.fx0, dy = wy - f.fy1;
      res.push({ ui: p.ui, deg: f.deg, dx, dy });
      G.boxAdd(ux, cb.x0 + (p.x + f.ux0) * c, cb.y1 - (p.y + f.uy1) * c); G.boxAdd(ux, cb.x0 + (p.x + f.ux1) * c, cb.y1 - (p.y + f.uy0) * c);
    }
    // spread mode: centre the layout in the container if that stays inside it
    if (opts.spread && res.length) {
      const cxs = Math.round(((cb.x0 + cb.x1) / 2 - (ux.x0 + ux.x1) / 2) / c), cys = Math.round(((ux.y0 + ux.y1) / 2 - (cb.y0 + cb.y1) / 2) / c);
      const bd = new Board(cont);
      const ok = best.placed.every(p => bd.test(p.f, p.x + cxs, p.y + cys) === true);
      if (ok) { res.forEach(r => { r.dx += cxs * c; r.dy -= cys * c; }); ux = { x0: ux.x0 + cxs * c, x1: ux.x1 + cxs * c, y0: ux.y0 - cys * c, y1: ux.y1 - cys * c }; }
    }
    const usedArea = best.placed.reduce((a, p) => a + p.f.cells, 0) * c * c;
    let free = 0; for (let i = 0; i < cont.grid.length; i++) if (!cont.grid[i]) free++;
    prog(1, 'Done');
    return { placements: res, placed: best.placed.length, total: n, tries, padding: pad, cell: c, usedBox: ux, fill: usedArea / (free * c * c || 1), seconds: (performance.now() - t0) / 1000 };
  }
  return { run };
})();
