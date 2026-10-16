// Geometry helpers: matrices, bounding boxes, path flattening, simplification, hit tests.
'use strict';
const G = (() => {
  const I = () => [1, 0, 0, 1, 0, 0];
  // m = [a,b,c,d,e,f] : X = a*x + c*y + e ; Y = b*x + d*y + f
  const mul = (m, n) => [ // m * n  (apply n first, then m)
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const inv = (m) => {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  };
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
  const scale = (sx, sy, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
  const rotate = (deg, cx = 0, cy = 0) => {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  };
  const mScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

  const emptyBox = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const boxAdd = (b, x, y) => { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; };
  const boxUnion = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
  const boxValid = (b) => b && isFinite(b.x0) && isFinite(b.x1);

  // transform an array of paths [{pts:[x,y,...],closed}] by matrix
  const xformPaths = (paths, m) => paths.map(p => {
    const o = new Array(p.pts.length);
    for (let i = 0; i < p.pts.length; i += 2) {
      o[i] = m[0] * p.pts[i] + m[2] * p.pts[i + 1] + m[4];
      o[i + 1] = m[1] * p.pts[i] + m[3] * p.pts[i + 1] + m[5];
    }
    return { pts: o, closed: p.closed };
  });
  const pathsBox = (paths) => {
    const b = emptyBox();
    for (const p of paths) for (let i = 0; i < p.pts.length; i += 2) boxAdd(b, p.pts[i], p.pts[i + 1]);
    return b;
  };

  // Douglas–Peucker simplification on flat array
  function simplify(pts, tol, closed) {
    const n = pts.length / 2;
    if (n < 3 || tol <= 0) return pts.slice();
    const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    const t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop();
      const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const px = pts[2 * i], py = pts[2 * i + 1];
        let d;
        if (L === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
        else { const c = (px - ax) * dy - (py - ay) * dx; d = c * c / L; }
        if (d > md) { md = d; mi = i; }
      }
      if (md > t2 && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    const o = [];
    for (let i = 0; i < n; i++) if (keep[i]) o.push(pts[2 * i], pts[2 * i + 1]);
    if (closed && o.length < 6) return pts.slice();
    return o;
  }

  function pointInPolys(paths, x, y) { // even-odd over all closed paths
    let inside = false;
    for (const p of paths) {
      if (!p.closed) continue;
      const q = p.pts, n = q.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = q[2 * i], yi = q[2 * i + 1], xj = q[2 * j], yj = q[2 * j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
  function distToPaths(paths, x, y) {
    let best = Infinity;
    for (const p of paths) {
      const q = p.pts, n = q.length / 2;
      const segs = p.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const ax = q[2 * i], ay = q[2 * i + 1], bx = q[2 * j], by = q[2 * j + 1];
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
        if (d < best) best = d;
      }
      if (n === 1) best = Math.min(best, Math.hypot(q[0] - x, q[1] - y));
    }
    return best;
  }
  const polyArea = (q) => { let a = 0; const n = q.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) a += (q[2 * j] + q[2 * i]) * (q[2 * j + 1] - q[2 * i + 1]); return a / 2; };
  const pathLength = (p) => { let L = 0; const q = p.pts, n = q.length / 2; for (let i = 1; i < n; i++) L += Math.hypot(q[2 * i] - q[2 * i - 2], q[2 * i + 1] - q[2 * i - 1]); if (p.closed && n > 1) L += Math.hypot(q[0] - q[2 * n - 2], q[1] - q[2 * n - 1]); return L; };

  // ---------- SVG path data parsing & flattening ----------
  // Returns array of {pts, closed}; 'tol' is flattening tolerance in the path's own units.
  function parsePathD(d, tol = 0.05) {
    const toks = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gi) || [];
    let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = '';
    const out = []; let cur = null;
    const isCmd = t => /^[a-z]$/i.test(t);
    const num = () => parseFloat(toks[i++]);
    const flag = () => { // arc flags may be packed like "11" or "01.5"
      let t = toks[i];
      if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.startsWith('0.')) { toks[i] = t.slice(1); return +t[0]; }
      i++; return +t;
    };
    const start = (px, py) => { cur = { pts: [px, py], closed: false }; out.push(cur); };
    const lineTo = (px, py) => { if (!cur) start(x, y); cur.pts.push(px, py); };
    const nseg = (len) => Math.max(2, Math.min(256, Math.ceil(Math.sqrt(len / Math.max(tol, 1e-6)) * 1.5)));
    const cubic = (x1, y1, x2, y2, x3, y3) => {
      const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const n = nseg(len);
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        lineTo(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
    };
    const quad = (x1, y1, x2, y2) => {
      const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1);
      const n = nseg(len);
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        lineTo(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2);
      }
    };
    const arc = (rx, ry, phi, fa, fs, x2, y2) => {
      if (rx === 0 || ry === 0) { lineTo(x2, y2); return; }
      rx = Math.abs(rx); ry = Math.abs(ry);
      const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
      const dx = (x - x2) / 2, dy = (y - y2) / 2;
      const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
      let lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const num_ = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
      let co = Math.sqrt(Math.max(0, num_ / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
      if (fa === fs) co = -co;
      const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
      const cx = cp * cxp - sp * cyp + (x + x2) / 2, cy = sp * cxp + cp * cyp + (y + y2) / 2;
      const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
      const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
      let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
      const n = Math.max(4, Math.min(360, Math.ceil(Math.abs(dt) * Math.sqrt(Math.max(rx, ry) / Math.max(tol, 1e-6)) * 0.8)));
      for (let k = 1; k <= n; k++) {
        const t = t1 + dt * k / n;
        lineTo(cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp);
      }
    };
    while (i < toks.length) {
      if (isCmd(toks[i])) cmd = toks[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (C) {
        case 'M': { const nx = num() + ox, ny = num() + oy; x = sx = nx; y = sy = ny; start(x, y); cmd = rel ? 'l' : 'L'; break; }
        case 'L': { const nx = num() + ox, ny = num() + oy; lineTo(nx, ny); x = nx; y = ny; break; }
        case 'H': { const nx = num() + ox; lineTo(nx, y); x = nx; break; }
        case 'V': { const ny = num() + oy; lineTo(x, ny); y = ny; break; }
        case 'C': { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(a, b, c, e, f, g); lcx = c; lcy = e; x = f; y = g; break; }
        case 'S': {
          let a = x, b = y; if ('CS'.includes(prev)) { a = 2 * x - lcx; b = 2 * y - lcy; }
          const c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(a, b, c, e, f, g); lcx = c; lcy = e; x = f; y = g; break;
        }
        case 'Q': { const a = num() + ox, b = num() + oy, f = num() + ox, g = num() + oy; quad(a, b, f, g); lqx = a; lqy = b; x = f; y = g; break; }
        case 'T': {
          let a = x, b = y; if ('QT'.includes(prev)) { a = 2 * x - lqx; b = 2 * y - lqy; }
          const f = num() + ox, g = num() + oy; quad(a, b, f, g); lqx = a; lqy = b; x = f; y = g; break;
        }
        case 'A': { const rx = num(), ry = num(), ph = num(), fa = flag(), fs = flag(), f = num() + ox, g = num() + oy; arc(rx, ry, ph, fa, fs, f, g); x = f; y = g; break; }
        case 'Z': {
          if (cur) { cur.closed = true; const q = cur.pts; if (q.length > 2 && Math.abs(q[0] - q[q.length - 2]) < 1e-9 && Math.abs(q[1] - q[q.length - 1]) < 1e-9) q.length -= 2; }
          x = sx; y = sy; cur = null; break;
        }
        default: i++;
      }
      prev = C;
      if (isNaN(x) || isNaN(y)) break;
    }
    return out.filter(p => p.pts.length >= 4 || (p.pts.length >= 2 && !p.closed && false));
  }

  // Shape generators (local coordinates, mm)
  const rectPaths = (w, h, r = 0) => {
    if (r <= 0) return [{ pts: [0, 0, w, 0, w, h, 0, h], closed: true }];
    r = Math.min(r, w / 2, h / 2);
    const pts = [], seg = 12;
    const corner = (cx, cy, a0) => { for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } };
    corner(w - r, r, -Math.PI / 2); corner(w - r, h - r, 0); corner(r, h - r, Math.PI / 2); corner(r, r, Math.PI);
    return [{ pts, closed: true }];
  };
  const ellipsePaths = (w, h) => {
    const n = Math.max(48, Math.min(360, Math.round((w + h) * 1.5)));
    const pts = [];
    for (let k = 0; k < n; k++) { const a = k / n * 2 * Math.PI; pts.push(w / 2 + w / 2 * Math.cos(a), h / 2 + h / 2 * Math.sin(a)); }
    return [{ pts, closed: true }];
  };
  const polygonPaths = (w, h, sides = 6, star = false, inner = 0.5) => {
    const pts = [], n = star ? sides * 2 : sides;
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + k / n * 2 * Math.PI;
      const r = star && k % 2 ? inner : 1;
      pts.push(w / 2 + w / 2 * r * Math.cos(a), h / 2 + h / 2 * r * Math.sin(a));
    }
    return [{ pts, closed: true }];
  };

  return { I, mul, inv, apply, translate, scale, rotate, mScale, emptyBox, boxAdd, boxUnion, boxValid, xformPaths, pathsBox, simplify, pointInPolys, distToPaths, polyArea, pathLength, parsePathD, rectPaths, ellipsePaths, polygonPaths };
})();
