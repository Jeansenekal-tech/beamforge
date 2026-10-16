// Finger-joint box builder.
// Every box edge is a t×t prism shared by two panels; along it the inner span is split into an odd number
// of fingers that alternate between the two panels. Corner cubes (where three panels meet) go to the panel
// with the highest priority. Front/Back > Left/Right > Bottom/Top. This guarantees every edge interlocks.
'use strict';
const BoxMaker = (() => {
  const PRI = { front: 3, back: 3, left: 2, right: 2, bottom: 1, top: 1 };
  // panel frames: size along its 2D u/v axes and which panel sits on each 2D side
  function panels(W, D, H, open) {
    const has = (p) => !(open && p === 'top');
    const P = {
      bottom: { u: W, v: D, sides: { b: 'front', r: 'right', t: 'back', l: 'left' } },
      top: { u: W, v: D, sides: { b: 'front', r: 'right', t: 'back', l: 'left' } },
      front: { u: W, v: H, sides: { b: 'bottom', r: 'right', t: 'top', l: 'left' } },
      back: { u: W, v: H, sides: { b: 'bottom', r: 'left', t: 'top', l: 'right' } },
      left: { u: D, v: H, sides: { b: 'bottom', r: 'front', t: 'top', l: 'back' } },
      right: { u: D, v: H, sides: { b: 'bottom', r: 'back', t: 'top', l: 'front' } },
    };
    for (const k in P) { if (!has(k)) { delete P[k]; continue; } for (const s in P[k].sides) if (!has(P[k].sides[s])) P[k].sides[s] = null; }
    return P;
  }
  const oddCount = (span, finger) => { if (span < 3 * Math.min(finger, span / 3)) return 1; let n = Math.max(3, Math.round(span / finger)); if (n % 2 === 0) n += (span / n > finger ? -1 : 1); return Math.max(1, n); };

  // occupancy for one panel → orthogonal outline polygons
  function panelOutline(name, P, t, finger, subs = []) {
    const p = P[name], A = p.u, B = p.v;
    const nU = oddCount(A - 2 * t, finger), nV = oddCount(B - 2 * t, finger);
    const segU = (A - 2 * t) / nU, segV = (B - 2 * t) / nV;
    const owns = (side, s, seg) => { // s = position along that side's axis
      const q = p.sides[side]; if (!q) return true;
      const k = Math.min(Math.floor((s - t) / seg), 1e9);
      return (k % 2 === 0) === (PRI[name] > PRI[q]);
    };
    const cornerOwn = (s1, s2) => { const ns = [name, p.sides[s1], p.sides[s2]].filter(Boolean); return ns.every(n => n === name || PRI[name] > PRI[n]); };
    const xs = [0, t, A - t, A]; for (let i = 1; i < nU; i++) xs.push(t + i * segU);
    const ys = [0, t, B - t, B]; for (let i = 1; i < nV; i++) ys.push(t + i * segV);
    for (const r of subs) { xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
    const X = [...new Set(xs.map(v => +v.toFixed(6)))].sort((a, b) => a - b), Y = [...new Set(ys.map(v => +v.toFixed(6)))].sort((a, b) => a - b);
    const nx = X.length - 1, ny = Y.length - 1, occ = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cu = (X[i] + X[i + 1]) / 2, cv = (Y[j] + Y[j + 1]) / 2;
      const L = cu < t, R = cu > A - t, Bt = cv < t, T = cv > B - t;
      let o;
      if ((L || R) && (Bt || T)) o = cornerOwn(Bt ? 'b' : 't', L ? 'l' : 'r');
      else if (Bt) o = owns('b', cu, segU); else if (T) o = owns('t', cu, segU);
      else if (L) o = owns('l', cv, segV); else if (R) o = owns('r', cv, segV);
      else o = true;
      if (o && subs.some(r => cu > r[0] && cu < r[2] && cv > r[1] && cv < r[3])) o = false;
      occ[j * nx + i] = o ? 1 : 0;
    }
    return { loops: traceCells(occ, nx, ny, X, Y), w: A, h: B, fingers: [nU, nV] };
  }
  // outline of (union of `adds`) minus `subs`, all axis-aligned rects [x0,y0,x1,y1]
  function rectsOutline(adds, subs = []) {
    const xs = [], ys = []; for (const r of adds.concat(subs)) { xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
    const X = [...new Set(xs.map(v => +v.toFixed(6)))].sort((a, b) => a - b), Y = [...new Set(ys.map(v => +v.toFixed(6)))].sort((a, b) => a - b);
    const nx = X.length - 1, ny = Y.length - 1, occ = new Uint8Array(nx * ny);
    const inR = (r, x, y) => x > r[0] && x < r[2] && y > r[1] && y < r[3];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2; occ[j * nx + i] = adds.some(r => inR(r, cx, cy)) && !subs.some(r => inR(r, cx, cy)) ? 1 : 0; }
    return traceCells(occ, nx, ny, X, Y);
  }
  // boundary of occupied grid cells as CCW loops (holes CW), collinear points removed
  function traceCells(occ, nx, ny, X, Y) {
    const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && occ[j * nx + i] === 1;
    const next = new Map(); // directed edges with the filled cell on the left
    const add = (a, b) => next.set(a[0] + ',' + a[1], b);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add([i, j], [i + 1, j]);       // bottom edge →
      if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]); // right edge ↑
      if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]); // top edge ←
      if (!on(i - 1, j)) add([i, j + 1], [i, j]);       // left edge ↓
    }
    const loops = [];
    while (next.size) {
      const [k0] = next.keys(); let k = k0; const pts = [];
      while (next.has(k)) { const [i, j] = k.split(',').map(Number); pts.push([X[i], Y[j]]); const b = next.get(k); next.delete(k); k = b[0] + ',' + b[1]; }
      // drop collinear
      const out = [];
      for (let m = 0; m < pts.length; m++) {
        const a = pts[(m - 1 + pts.length) % pts.length], b = pts[m], c = pts[(m + 1) % pts.length];
        if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-9) out.push(b);
      }
      if (out.length >= 4) loops.push(out);
    }
    return loops;
  }
  // grow outer loops / shrink holes by k (kerf/2) — exact for orthogonal polygons
  function offsetLoop(loop, k) {
    if (!k) return loop.slice();
    const n = loop.length, out = [];
    let area = 0; for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1; // CCW outer → outward normal is (dy, -dx)
    for (let i = 0; i < n; i++) {
      const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
      const d1 = norm(b[0] - a[0], b[1] - a[1]), d2 = norm(c[0] - b[0], c[1] - b[1]);
      const n1 = [d1[1], -d1[0]], n2 = [d2[1], -d2[0]], dot = n1[0] * n2[0] + n1[1] * n2[1], f = k / Math.max(0.2, 1 + dot); // miter
      out.push([b[0] + sgn * f * (n1[0] + n2[0]), b[1] + sgn * f * (n1[1] + n2[1])]);
    }
    return out;
  }
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

  // ---------------- general joint engine ----------------
  // Each panel is a slab: an axis-aligned block in 3D, described by its 2D size (w × h), thickness t and a
  // frame f(u, v, n) → [x, y, z]. Where two slabs overlap (a t × t prism along one axis) the prism is split
  // into an odd number of fingers that alternate between them; anything inside three or more slabs goes to
  // the highest priority. Works for walls of any height (lowered fronts, crossbars, etc.).
  const EPS = 1e-7;
  function slabBox(s) { const a = s.f(0, 0, 0), b = s.f(s.w, s.h, s.t); return [0, 1, 2].map(i => [Math.min(a[i], b[i]), Math.max(a[i], b[i])]); }
  const ovl = (A, B) => A.map(([a0, a1], i) => [Math.max(a0, B[i][0]), Math.min(a1, B[i][1])]);
  const isEmpty = (R) => R.some(([a, b]) => b - a < EPS);
  const inBox = (B, p) => B.every(([lo, hi], i) => p[i] > lo + EPS && p[i] < hi - EPS);
  function axes(s) { // which 3D axis u and v run along, with direction
    const o = s.f(0, 0, 0), eu = s.f(1, 0, 0), ev = s.f(0, 1, 0), ax = (e) => { const i = [0, 1, 2].find(k => Math.abs(e[k] - o[k]) > 0.5); return { i, sg: Math.sign(e[i] - o[i]), o: o[i] }; };
    return { u: ax(eu), v: ax(ev) };
  }
  function solveJoints(slabs, finger) {
    slabs.forEach(s => { s.B = slabBox(s); s.ax = axes(s); });
    const pairs = new Map(), key = (a, b) => a.name < b.name ? a.name + '|' + b.name : b.name + '|' + a.name;
    for (let i = 0; i < slabs.length; i++) for (let j = i + 1; j < slabs.length; j++) {
      const A = slabs[i], Bs = slabs[j], R = ovl(A.B, Bs.B); if (isEmpty(R)) continue;
      const ext = R.map(([a, b]) => b - a), axis = ext.indexOf(Math.max(...ext));
      let [a, b] = R[axis];
      for (const C of slabs) { if (C === A || C === Bs) continue; const R2 = ovl(R, C.B); if (isEmpty(R2)) continue; if (R2[axis][0] <= a + EPS) a = Math.max(a, R2[axis][1]); if (R2[axis][1] >= b - EPS) b = Math.min(b, R2[axis][0]); }
      const n = b - a > EPS ? oddCount(b - a, finger) : 1;
      pairs.set(key(A, Bs), { axis, a, b, n, seg: (b - a) / n, hi: A.pri > Bs.pri ? A : Bs, R });
    }
    const owner = (p) => {
      const at = slabs.filter(s => inBox(s.B, p)); if (at.length < 2) return at[0] || null;
      const top = at.reduce((x, y) => y.pri > x.pri ? y : x);
      if (at.length > 2) return top;
      const pr = pairs.get(key(at[0], at[1])), s = p[pr.axis];
      if (s < pr.a || s > pr.b) return top;
      const k = Math.min(Math.floor((s - pr.a) / pr.seg), pr.n - 1);
      return (k % 2 === 0) ? pr.hi : (pr.hi === at[0] ? at[1] : at[0]);
    };
    return { pairs, owner, key };
  }
  function slabOutline(s, slabs, J, subs = []) {
    const { u: U, v: V } = s.ax, to2 = (A, x) => (x - A.o) * A.sg;
    const xs = [0, s.w], ys = [0, s.h];
    for (const o of slabs) {
      if (o === s) continue; const R = ovl(s.B, o.B); if (isEmpty(R)) continue;
      xs.push(to2(U, R[U.i][0]), to2(U, R[U.i][1])); ys.push(to2(V, R[V.i][0]), to2(V, R[V.i][1]));
      const pr = J.pairs.get(J.key(s, o));
      for (let k = 0; k <= pr.n; k++) { const x = pr.a + k * pr.seg; if (pr.axis === U.i) xs.push(to2(U, x)); else if (pr.axis === V.i) ys.push(to2(V, x)); }
    }
    for (const r of subs) { xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
    const X = [...new Set(xs.map(v => +Math.min(s.w, Math.max(0, v)).toFixed(6)))].sort((a, b) => a - b), Y = [...new Set(ys.map(v => +Math.min(s.h, Math.max(0, v)).toFixed(6)))].sort((a, b) => a - b);
    const nx = X.length - 1, ny = Y.length - 1, occ = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cu = (X[i] + X[i + 1]) / 2, cv = (Y[j] + Y[j + 1]) / 2;
      occ[j * nx + i] = J.owner(s.f(cu, cv, s.t / 2)) === s && !subs.some(r => cu > r[0] && cu < r[2] && cv > r[1] && cv < r[3]) ? 1 : 0;
    }
    return traceCells(occ, nx, ny, X, Y);
  }
  // round hole (clockwise, so it's a hole) and a half-round finger notch in the front edge of a lid
  const circleLoop = (cx, cy, r, n = 32) => Array.from({ length: n }, (_, i) => { const a = -i / n * 2 * Math.PI; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  function addNotch(loop, cx, r) {
    const i = loop.findIndex((a, k) => { const b = loop[(k + 1) % loop.length]; return Math.abs(a[1]) < EPS && Math.abs(b[1]) < EPS && a[0] < cx - r && b[0] > cx + r; });
    if (i < 0) return loop;
    const arc = []; for (let k = 0; k <= 16; k++) { const f = Math.PI - k / 16 * Math.PI; arc.push([cx + r * Math.cos(f), r * Math.sin(f)]); }
    return [...loop.slice(0, i + 1), ...arc, ...loop.slice(i + 1)];
  }

  // tab positions along a span: returns [[a,b],...] (centred tabs, width wt)
  function tabs(len, wt) { const n = len > 6 * wt ? 2 : 1; return Array.from({ length: n }, (_, i) => { const c = len * (n === 1 ? 0.5 : (i ? 0.75 : 0.25)); return [c - wt / 2, c + wt / 2]; }); }
  // o: { w, d, h, inside, t, finger, kerf, open, lid: 'fixed'|'open'|'liftoff'|'sliding'|'hinged', divX, divY }
  function build(o) {
    const t = o.t, lid = o.lid || (o.open ? 'open' : 'fixed'), kf = (o.kerf || 0) / 2, c = 0.3;
    const add = o.inside ? 2 * t : 0, W = o.w + add, D = o.d + add;
    const hr = Math.max(2.5 * t, 8);                              // sliding: height of the crossbar above the lid
    const m = Math.max(1.5, 0.6 * t), rh = t * Math.SQRT1_2 + 0.1; // hinged: wood left around the pivot hole, hole radius
    let H;
    if (lid === 'sliding') H = o.inside ? t + o.h + t + c + hr : o.h;
    else if (lid === 'hinged') H = o.inside ? t + o.h + t / 2 + m + rh : o.h;
    else H = o.h + (o.inside ? (lid === 'fixed' ? 2 * t : t) : 0);
    if (Math.min(W, D) < 3 * t + 1 || H < 3 * t + 1) throw new Error('The box is too small for that material thickness');
    const zl = H - hr - c - t;              // sliding: underside of the lid
    const zp = H - m - rh, zb = zp - t / 2; // hinged: pivot height, underside of the lid
    const yp = D - t - m - rh;              // hinged: pivot position front-to-back
    const ys = D - t - Math.max(2 * t, 6);  // sliding: where the side slots end
    const z1 = { fixed: H - t, open: H, liftoff: H - t - 0.5, sliding: zl - 0.5, hinged: zp - rh - 0.3 }[lid]; // top of the dividers
    const z0 = t, hd = z1 - z0;
    if (hd < 2 * t) throw new Error('The box is too low for that lid and material thickness');
    if (lid === 'hinged' && yp < 4 * t) throw new Error('The box is too shallow for a hinged lid');
    if (lid === 'sliding' && ys < 4 * t) throw new Error('The box is too shallow for a sliding lid');
    const nX = Math.max(0, Math.min(12, o.divX | 0)), nY = Math.max(0, Math.min(12, o.divY | 0));
    const Wi = W - 2 * t, Di = D - 2 * t;
    const wt = Math.max(t * 1.5, Math.min(o.finger, Math.min(Wi, Di, hd) / 4));
    if (nX && (Wi - nX * t) / (nX + 1) < 2 * t) throw new Error('Too many dividers across the width');
    if (nY && (Di - nY * t) / (nY + 1) < 2 * t) throw new Error('Too many dividers across the depth');
    const xs = Array.from({ length: nX }, (_, k) => t + (k + 1) * (Wi - nX * t) / (nX + 1) + k * t + t / 2);  // divider centre x
    const ys2 = Array.from({ length: nY }, (_, k) => t + (k + 1) * (Di - nY * t) / (nY + 1) + k * t + t / 2); // divider centre y
    const subs = { bottom: [], front: [], back: [], left: [], right: [] }, holes = { left: [], right: [] };
    // X-dividers (parallel to left/right): tabs into bottom, front and back
    const vt = tabs(hd, wt), dt = tabs(Di, wt), wtb = tabs(Wi, wt);
    for (const xc of xs) {
      if (!nY) for (const [a, b] of dt) subs.bottom.push([xc - t / 2, t + a, xc + t / 2, t + b]);
      for (const [a, b] of vt) { subs.front.push([xc - t / 2, z0 + a, xc + t / 2, z0 + b]); subs.back.push([W - xc - t / 2, z0 + a, W - xc + t / 2, z0 + b]); }
    }
    for (const yc of ys2) {
      for (const [a, b] of wtb) if (!nX) subs.bottom.push([t + a, yc - t / 2, t + b, yc + t / 2]);
      for (const [a, b] of vt) { subs.left.push([D - yc - t / 2, z0 + a, D - yc + t / 2, z0 + b]); subs.right.push([yc - t / 2, z0 + a, yc + t / 2, z0 + b]); }
    }
    // the walls as slabs
    const frontH = lid === 'sliding' ? zl : lid === 'hinged' ? zb : H, zc = zl + t + c;
    const slabs = [
      { name: 'bottom', pri: 1, w: W, h: D, f: (u, v, n) => [u, v, n] },
      lid === 'fixed' && { name: 'top', pri: 1, w: W, h: D, f: (u, v, n) => [u, v, H - t + n] },
      { name: 'front', pri: 3, w: W, h: frontH, f: (u, v, n) => [u, n, v] },
      lid === 'sliding' && { name: 'crossbar', pri: 3, w: W, h: H - zc, f: (u, v, n) => [u, n, zc + v] },
      { name: 'back', pri: 3, w: W, h: H, f: (u, v, n) => [W - u, D - t + n, v] },
      { name: 'left', pri: 2, w: D, h: H, f: (u, v, n) => [n, D - u, v] },
      { name: 'right', pri: 2, w: D, h: H, f: (u, v, n) => [W - t + n, u, v] },
    ].filter(Boolean);
    slabs.forEach(s => s.t = t);
    if (lid === 'sliding') { subs.left.push([D - ys, zl, D, zc]); subs.right.push([0, zl, ys, zc]); } // slots the lid runs in
    if (lid === 'hinged') { holes.left.push(circleLoop(D - yp, zp, rh)); holes.right.push(circleLoop(yp, zp, rh)); } // pivot holes
    const J = solveJoints(slabs, o.finger);
    const out = [];
    for (const s of slabs) {
      const raw = slabOutline(s, slabs, J, subs[s.name] || []).concat(holes[s.name] || []);
      out.push({ name: s.name, w: s.w, h: s.h, fingers: [0, 0], loops: raw.map(l => offsetLoop(l, kf)), raw, pose: s.f });
    }
    // divider panels (u along the divider, v up from the inside of the bottom)
    const both = nX && nY;
    xs.forEach((xc, k) => {
      const adds = [[0, 0, Di, hd]], sb = [];
      for (const [a, b] of vt) adds.push([-t, a, 0, b], [Di, a, Di + t, b]);
      if (!nY) for (const [a, b] of dt) adds.push([a, -t, b, 0]);
      for (const yc of ys2) sb.push([yc - t - t / 2, hd / 2, yc - t + t / 2, hd + 1]); // slot from the top
      const loops = rectsOutline(adds, sb).map(l => l.map(([u, v]) => [u + t, v + t]));
      out.push({ name: `divider X${k + 1}`, divider: { axis: 'x', pos: xc }, w: Di + 2 * t, h: hd + t, fingers: [0, 0], loops: loops.map(l => offsetLoop(l, kf)), raw: loops, pose: (u, v, n) => [xc - t / 2 + n, u, v] });
    });
    ys2.forEach((yc, k) => {
      const adds = [[0, 0, Wi, hd]], sb = [];
      for (const [a, b] of vt) adds.push([-t, a, 0, b], [Wi, a, Wi + t, b]);
      if (!nX) for (const [a, b] of wtb) adds.push([a, -t, b, 0]);
      for (const xc of xs) sb.push([xc - t - t / 2, -1, xc - t + t / 2, hd / 2]); // slot from the bottom
      const loops = rectsOutline(adds, sb).map(l => l.map(([u, v]) => [u + t, v + t]));
      out.push({ name: `divider Y${k + 1}`, divider: { axis: 'y', pos: yc }, w: Wi + 2 * t, h: hd + t, fingers: [0, 0], loops: loops.map(l => offsetLoop(l, kf)), raw: loops, pose: (u, v, n) => [u, yc - t / 2 + n, v] });
    });
    const notchR = Math.min(9, (W - 2 * t) / 5);
    let lidInfo = null;
    if (lid === 'liftoff') { // lid plate + a lip glued underneath that drops inside the walls
      const lip = rectsOutline([[t + c, t + c, W - t - c, D - t - c]]).map(l => l.map(([u, v]) => [u - t - c, v - t - c]));
      out.push({ name: 'lid', w: W, h: D, fingers: [0, 0], loops: rectsOutline([[0, 0, W, D]]).map(l => offsetLoop(l, kf)), pose: (u, v, n) => [u, v, H + 10 + n] });
      out.push({ name: 'lid lip', w: W - 2 * t - 2 * c, h: D - 2 * t - 2 * c, fingers: [0, 0], loops: lip.map(l => offsetLoop(l, kf)), pose: (u, v, n) => [u + t + c, v + t + c, H + 10 - t + n] });
    }
    if (lid === 'sliding') { // full-width plate whose edges run in the side slots; narrower behind the slots so it stops
      const raw = rectsOutline([[t + c, 0, W - t - c, D - t - c], [0, 0, W, ys - c]]).map(l => addNotch(l, W / 2, notchR));
      const pull = 0.45 * D;
      out.push({ name: 'lid', w: W, h: D - t - c, fingers: [0, 0], loops: raw.map(l => offsetLoop(l, kf)), raw, pose: (u, v, n) => [u, v - pull, zl + n] });
      lidInfo = { kind: 'sliding', zl, ys, zc, hr };
    }
    if (lid === 'hinged') { // plate between the sides with square pegs at the back that turn in round holes
      const raw = rectsOutline([[t + c, 0, W - t - c, yp + t / 2], [0, yp - t / 2, W, yp + t / 2]]).map(l => addNotch(l, W / 2, notchR));
      const th = 70 * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
      out.push({ name: 'lid', w: W, h: yp + t / 2, fingers: [0, 0], loops: raw.map(l => offsetLoop(l, kf)), raw, pose: (u, v, n) => { const dy = v - yp, dz = zb + n - zp; return [u, yp + dy * ct + dz * st, zp - dy * st + dz * ct]; } });
      lidInfo = { kind: 'hinged', yp, zp, zb, rh };
    }
    const insideH = (lid === 'sliding' ? zl : lid === 'hinged' ? zb : lid === 'fixed' ? H - t : H) - t;
    return { panels: out, outer: { W, D, H }, inner: { w: Wi, d: Di, h: insideH }, lid, both, lidInfo, t };
  }
  // ---------------- rounded box with living-hinge walls ----------------
  // o: { w, d, h, t, r (outer corner radius), kerf, open, finger, hinge: { spacing, slit, gap } }
  function buildFlex(o) {
    const t = o.t, W = o.w, D = o.d, H = o.h, k = (o.kerf || 0) / 2;
    const r = Math.max(2.5 * t, Math.min(o.r, W / 2 - t, D / 2 - t));
    const sw = W - 2 * r, sd = D - 2 * r, rm = r - t / 2, arc = Math.PI / 2 * rm;
    const L = 2 * sw + 2 * sd + 4 * arc;
    const wt = Math.max(2 * t, Math.min(o.finger || 10, 15));
    // straight runs along the wall, starting at the middle of the front edge, going counter-clockwise
    const segs = []; let s = 0;
    const addSeg = (len, kind) => { segs.push({ a: s, b: s + len, kind }); s += len; };
    addSeg(sw / 2, 'front'); addSeg(arc, 'arc'); addSeg(sd, 'right'); addSeg(arc, 'arc'); addSeg(sw, 'back'); addSeg(arc, 'arc'); addSeg(sd, 'left'); addSeg(arc, 'arc'); addSeg(sw / 2, 'front');
    // tab centres along each straight edge (measured from the start of the straight part)
    const tabCentres = (len) => { if (len < wt * 1.6) return []; const n = Math.max(1, Math.floor(len / (wt * 3))); return Array.from({ length: n }, (_, i) => (i + 0.5) * len / n); };
    // where a point on each straight edge lands on the unrolled wall (wall starts at the middle of the front, runs anticlockwise seen from above)
    const wallPos = { front: (c) => (r + c >= W / 2 ? r + c - W / 2 : L - sw / 2 + c), right: (c) => sw / 2 + arc + c, back: (c) => sw / 2 + 2 * arc + sd + (sw - c), left: (c) => sw / 2 + 3 * arc + sd + sw + (sd - c) };
    const notchAt = [];
    for (const c of tabCentres(sw)) notchAt.push(wallPos.front(c), wallPos.back(c));
    for (const c of tabCentres(sd)) notchAt.push(wallPos.right(c), wallPos.left(c));
    const adds = [[0, 0, L, H]], subs = [];
    const notch = (s0, s1) => { subs.push([s0, -1, s1, t]); if (!o.open) subs.push([s0, H - t, s1, H + 1]); };
    for (const c of notchAt) { const a0 = c - wt / 2, a1 = c + wt / 2; if (a0 < 0) { notch(-1, a1); notch(L + a0, L + 1); } else if (a1 > L) { notch(a0, L + 1); notch(-1, a1 - L); } else notch(a0, a1); }
    const wallLoops = rectsOutline(adds, subs).map(l => offsetLoop(l, k));
    // living hinge slits over each corner (+2 mm each side), kept clear of the notch zones
    const hs = o.hinge || {}, sp = hs.spacing || 1.6, slit = hs.slit || 12, gap = hs.gap || 2.5;
    const cuts = [], v0 = t + 1.5, v1 = H - (o.open ? 1.5 : t + 1.5);
    const arcs = [sw / 2, sw / 2 + arc + sd, sw / 2 + 2 * arc + sd + sw, sw / 2 + 3 * arc + 2 * sd + sw];
    for (const a0 of arcs) {
      let col = 0;
      for (let x = a0 - 2; x <= a0 + arc + 2; x += sp, col++) {
        const off = col % 2 ? (slit + gap) / 2 : 0;
        for (let y = v0 - off; y < v1; y += slit + gap) { const ya = Math.max(v0, y), yb = Math.min(v1, y + slit); if (yb - ya > 1) cuts.push({ pts: [x, ya, x, yb], closed: false }); }
      }
    }
    // base / lid: rounded rectangle inside the wall, with tabs reaching out into the wall notches (exact outline)
    const ri = r - t, pts = [];
    const edge = (x0, y0, x1, y1, outX, outY, list) => { // straight edge with bumps of depth t toward (outX,outY)
      const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      pts.push([x0, y0]);
      for (const c of list) { const a0 = c - wt / 2, a1 = c + wt / 2; pts.push([x0 + ux * a0, y0 + uy * a0], [x0 + ux * a0 + outX * t, y0 + uy * a0 + outY * t], [x0 + ux * a1 + outX * t, y0 + uy * a1 + outY * t], [x0 + ux * a1, y0 + uy * a1]); }
    };
    const corner = (cx, cy, a0) => { const n = Math.max(8, Math.round(ri * 1.2)); for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; pts.push([cx + ri * Math.cos(a), cy + ri * Math.sin(a)]); } };
    const tw = tabCentres(sw), td = tabCentres(sd);
    edge(r, t, W - r, t, 0, -1, tw); corner(W - r, r, -Math.PI / 2);
    edge(W - t, r, W - t, D - r, 1, 0, td); corner(W - r, D - r, 0);
    edge(W - r, D - t, r, D - t, 0, 1, tw.map(c => sw - c).sort((x, y) => x - y)); corner(r, D - r, Math.PI / 2);
    edge(t, D - r, t, r, -1, 0, td.map(c => sd - c).sort((x, y) => x - y)); corner(r, r, Math.PI);
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
    const plateLoop = offsetLoop(clean, k);
    const pieces = [{ name: 'wall', w: L, h: H, loops: wallLoops, cuts }, { name: 'base', w: W, h: D, loops: [plateLoop] }];
    if (!o.open) pieces.push({ name: 'lid', w: W, h: D, loops: [plateLoop.map(p => p.slice())] });
    return { pieces, outer: { W, D, H }, wallLength: L, r, kerf: k, wt, tabs: tw.length * 2 + td.length * 2 };
  }
  // a small two-piece joint to check the fit (same thickness, finger size and kerf)
  function testJoint(o) {
    const t = o.t, len = Math.max(o.finger * 3 + 2 * t, 25), dep = 20;
    const P = { a: { u: len, v: dep, sides: { b: null, r: null, t: 'b', l: null } }, b: { u: len, v: dep, sides: { b: null, r: null, t: 'a', l: null } } };
    PRI.a = 3; PRI.b = 1;
    const res = ['a', 'b'].map(n => { const r = panelOutline(n, P, t, o.finger); return { name: n === 'a' ? 'test A' : 'test B', w: r.w, h: r.h, loops: r.loops.map(l => offsetLoop(l, (o.kerf || 0) / 2)) }; });
    delete PRI.a; delete PRI.b; return res;
  }

  // 3D placement of each panel (u,v in panel plane, n = through thickness) for the preview
  function place(name, u, v, n, out, t, p) {
    const { W, D, H } = out;
    if (p && p.divider) return p.divider.axis === 'x' ? [p.divider.pos - t / 2 + n, u, v] : [u, p.divider.pos - t / 2 + n, v];
    if (name === 'lid') return [u, v, H + 10 + n];
    if (name === 'lid lip') return [u + t + 0.3, v + t + 0.3, H + 10 - t + n];
    switch (name) {
      case 'bottom': return [u, v, n];
      case 'top': return [u, v, H - t + n];
      case 'front': return [u, n, v];
      case 'back': return [W - u, D - t + n, v];
      case 'left': return [n, D - u, v];
      case 'right': return [W - t + n, u, v];
    }
  }
  function drawIso(ctx, box, cw, ch, opts = {}) {
    const yaw = (opts.yaw ?? 35) * Math.PI / 180, pitch = opts.pitch ?? 1;
    const { W, D, H } = box.outer;
    const proj = ([x, y, z]) => { x -= W / 2; y -= D / 2; const xr = x * Math.cos(yaw) - y * Math.sin(yaw), yr = x * Math.sin(yaw) + y * Math.cos(yaw); return [xr, -yr * 0.5 * pitch - z * 0.9, 0.9 * yr - 0.5 * z]; }; // viewed from the front, above
    const t = box.t, faces = [];
    for (const p of box.panels) {
      const pose = p.pose || ((u, v, n) => place(p.name, u, v, n, box.outer, t, p));
      if (!pose(0, 0, 0)) continue;
      const name = p.divider ? 'divider' : p.name, src = p.raw || p.loops;
      for (const n of [0, t]) faces.push({ name, loops: src.map(l => l.map(([u, v]) => proj(pose(u, v, n)))) });
      for (const loop of src) for (let i = 0; i < loop.length; i++) { // side walls of the cut edges
        const [u0, v0] = loop[i], [u1, v1] = loop[(i + 1) % loop.length];
        faces.push({ name, side: true, loops: [[proj(pose(u0, v0, 0)), proj(pose(u1, v1, 0)), proj(pose(u1, v1, t)), proj(pose(u0, v0, t))]] });
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of faces) for (const l of f.loops) for (const [x, y] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.min((cw - 30) / (x1 - x0 || 1), (ch - 30) / (y1 - y0 || 1)), ox = cw / 2 - (x0 + x1) / 2 * k, oy = ch / 2 - (y0 + y1) / 2 * k;
    faces.forEach(f => { let s = 0, n = 0; for (const l of f.loops) for (const p of l) { s += p[2]; n++; } f.depth = s / n; });
    faces.sort((a, b) => b.depth - a.depth);
    const col = { bottom: '#8a6a45', top: '#a07a4e', front: '#c8955c', back: '#9c7448', left: '#b38452', right: '#b88a57', divider: '#d9a86c', lid: '#a8804f', 'lid lip': '#8f6c44', crossbar: '#c08d58' };
    for (const f of faces) {
      ctx.beginPath();
      for (const l of f.loops) { l.forEach(([x, y], i) => i ? ctx.lineTo(ox + x * k, oy + y * k) : ctx.moveTo(ox + x * k, oy + y * k)); ctx.closePath(); }
      ctx.fillStyle = (col[f.name] || '#b38452') + (f.side ? 'ff' : 'e0'); ctx.fill('evenodd');
      ctx.strokeStyle = f.side ? 'rgba(40,25,10,.25)' : '#3a2614'; ctx.lineWidth = f.side ? 0.5 : 1; ctx.stroke();
    }
  }
  return { build, buildFlex, testJoint, drawIso, panelOutline, panels, rectsOutline, offsetLoop };
})();
