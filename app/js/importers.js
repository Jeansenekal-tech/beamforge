// File importers: SVG, DXF, bitmap images. All return {objects:[...]} with local paths in mm (y up).
'use strict';
const Importers = (() => {
  // CSS units (SVG 2): q = quarter-millimetre; em/ex/ch use the default 16px font
  const unitToMm = { mm: 1, cm: 10, q: 0.25, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96, em: 16 * 25.4 / 96, rem: 16 * 25.4 / 96, ex: 8 * 25.4 / 96, ch: 8 * 25.4 / 96 };
  const parseLen = (s) => {
    if (!s) return null; const m = String(s).trim().match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)$/i);
    if (!m || m[2] === '%') return null; return { v: parseFloat(m[1]), u: m[2].toLowerCase() };
  };
  function parseColor(c) {
    if (!c || c === 'none' || c === 'transparent') return null;
    const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = '#000'; cv.fillStyle = c;
    const s = cv.fillStyle; // #rrggbb or rgba()
    if (s[0] === '#') return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const m = s.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : null;
  }

  // ---------------- SVG ----------------
  // replace <use> with real copies so their content imports (repeat for nested uses)
  function expandUses(root) {
    for (let pass = 0; pass < 6; pass++) {
      const uses = [...root.querySelectorAll('use')].filter(u => !u.closest('defs,symbol,clipPath,mask,pattern,marker'));
      if (!uses.length) break;
      for (const u of uses) {
        const href = u.getAttribute('href') || u.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        const ref = href.startsWith('#') ? root.querySelector('[id="' + CSS.escape(href.slice(1)) + '"]') : null;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        for (const a of ['class', 'style', 'fill', 'stroke', 'stroke-width', 'display']) if (u.hasAttribute(a)) g.setAttribute(a, u.getAttribute(a));
        const x = parseFloat(u.getAttribute('x')) || 0, y = parseFloat(u.getAttribute('y')) || 0;
        g.setAttribute('transform', `${u.getAttribute('transform') || ''} translate(${x},${y})`);
        if (ref && !ref.contains(u)) {
          if (ref.nodeName.toLowerCase() === 'symbol') { for (const c of ref.childNodes) g.appendChild(c.cloneNode(true)); }
          else { const c = ref.cloneNode(true); c.removeAttribute('id'); g.appendChild(c); }
        }
        u.replaceWith(g);
      }
    }
  }
  // render one <text> element on its own and trace its outline (keeps font, size, spacing, tspans, transforms)
  async function textToOutline(el, root, k) {
    const bb = el.getBBox(); if (!bb.width || !bb.height) return null;
    const ctm = root.getScreenCTM().inverse().multiply(el.getScreenCTM());
    const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => [ctm.a * x + ctm.c * y + ctm.e, ctm.b * x + ctm.d * y + ctm.f]);
    const pad = Math.max(bb.height, bb.width) * 0.2;
    const x0 = Math.min(...pts.map(p => p[0])) - pad, y0 = Math.min(...pts.map(p => p[1])) - pad, x1 = Math.max(...pts.map(p => p[0])) + pad, y1 = Math.max(...pts.map(p => p[1])) + pad;
    const ppm = Math.min(30, 3000 / Math.max((x1 - x0) * k, (y1 - y0) * k, 1)); // pixels per mm
    const W = Math.ceil((x1 - x0) * k * ppm), H = Math.ceil((y1 - y0) * k * ppm);
    const cs = getComputedStyle(el);
    const clone = el.cloneNode(true); clone.removeAttribute('transform');
    const q = (v) => String(v).replace(/"/g, "'").replace(/[<>&]/g, '');
    const style = `font-family:${q(cs.fontFamily)};font-size:${cs.fontSize};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};letter-spacing:${cs.letterSpacing};word-spacing:${cs.wordSpacing};text-anchor:${cs.textAnchor};dominant-baseline:${cs.dominantBaseline};fill:#000;stroke:none`;
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}"><g transform="matrix(${ctm.a},${ctm.b},${ctm.c},${ctm.d},${ctm.e},${ctm.f})" style="${style}">${new XMLSerializer().serializeToString(clone)}</g></svg>`;
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try {
      const im = await loadImage(url);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(im, 0, 0, W, H);
      // canvas px → mm with y up (top of canvas = -y0*k)
      return Trace.canvasToPaths(cv, ppm, x0 * k, -y1 * k, 0.3);
    } finally { URL.revokeObjectURL(url); }
  }
  async function svg(text, nearestLayer) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root0 = doc.documentElement;
    if (!root0 || root0.nodeName.toLowerCase() !== 'svg') throw new Error('Not a valid SVG file');
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden';
    document.body.appendChild(host);
    const root = document.importNode(root0, true); host.appendChild(root);
    expandUses(root);
    try {
      // mm per user unit
      const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const W = parseLen(root.getAttribute('width')), H = parseLen(root.getAttribute('height'));
      let k = 25.4 / 96;
      if (vb.length === 4 && vb[2] > 0 && W) k = W.v * (unitToMm[W.u] ?? 25.4 / 96) / vb[2];
      else if (vb.length === 4 && vb[2] > 0 && H) k = H.v * (unitToMm[H.u] ?? 25.4 / 96) / vb[3];
      else if (W && unitToMm[W.u] !== undefined) k = unitToMm[W.u] * 1; // unitless width => px; no viewBox => user unit = unit
      if (vb.length !== 4 && W) k = unitToMm[W.u] ?? 25.4 / 96;
      const rootCTMi = root.getScreenCTM() ? root.getScreenCTM().inverse() : null;
      const items = [];
      const els = root.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,image');
      let skippedText = 0;
      // SVG 2 lets geometry come from attributes (any CSS unit) or from CSS properties
      const len = (el, a) => { try { if (el.hasAttribute(a) && el[a] && el[a].baseVal) return el[a].baseVal.value; } catch (e) { } const c = parseFloat(getComputedStyle(el)[a]); return isNaN(c) ? (parseFloat(el.getAttribute(a)) || 0) : c; };
      for (const el of els) {
        if (el.closest('defs,clipPath,mask,symbol,marker,pattern')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none') continue;
        let m = [1, 0, 0, 1, 0, 0];
        const sc = el.getScreenCTM();
        if (sc && rootCTMi) { const r = rootCTMi.multiply(sc); m = [r.a, r.b, r.c, r.d, r.e, r.f]; }
        const tag = el.nodeName.toLowerCase();
        const n = (a) => len(el, a);
        if (tag === 'image') {
          const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          if (href && href.startsWith('data:')) items.push({ image: href, x: n('x'), y: n('y'), w: n('width'), h: n('height'), m });
          continue;
        }
        let d = '';
        switch (tag) {
          case 'path': d = el.getAttribute('d') || ''; break;
          case 'rect': {
            const x = n('x'), y = n('y'), w = n('width'), h = n('height');
            const hasRx = el.hasAttribute('rx') || getComputedStyle(el).rx !== 'auto', hasRy = el.hasAttribute('ry') || getComputedStyle(el).ry !== 'auto';
            let rx = hasRx ? n('rx') : NaN, ry = hasRy ? n('ry') : NaN;
            if (isNaN(rx)) rx = isNaN(ry) ? 0 : ry; if (isNaN(ry)) ry = rx;
            rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
            d = rx > 0 ? `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
              : `M${x},${y}H${x + w}V${y + h}H${x}Z`;
            break;
          }
          case 'circle': { const cx = n('cx'), cy = n('cy'), r = n('r'); d = `M${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}Z`; break; }
          case 'ellipse': { const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry'); d = `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`; break; }
          case 'line': d = `M${n('x1')},${n('y1')}L${n('x2')},${n('y2')}`; break;
          case 'polyline': case 'polygon': {
            const p = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
            if (p.length >= 4) d = 'M' + p.join(' ') + (tag === 'polygon' ? 'Z' : '');
            break;
          }
        }
        if (!d) continue;
        const sx = Math.hypot(m[0], m[1]) * k || 1;
        const paths = G.parsePathD(d, 0.03 / sx);
        if (!paths.length) continue;
        const col = parseColor(cs.stroke) || parseColor(cs.fill) || [0, 0, 0];
        items.push({ paths: G.xformPaths(paths, m), color: col, filled: !!parseColor(cs.fill) && !parseColor(cs.stroke) });
      }
      // text → outlines
      for (const el of root.querySelectorAll('text')) {
        if (el.closest('defs,clipPath,mask,symbol,marker,pattern') || getComputedStyle(el).display === 'none') continue;
        try {
          const paths = await textToOutline(el, root, k);
          if (paths && paths.length) { const cs = getComputedStyle(el); items.push({ mmPaths: paths, color: parseColor(cs.fill) || parseColor(cs.stroke) || [0, 0, 0], filled: true, text: true }); }
          else skippedText++;
        } catch (e) { console.warn('text import', e); skippedText++; }
      }
      // convert to mm, flip y
      const objs = [];
      for (const it of items) {
        if (it.image) {
          const [x0, y0] = G.apply(it.m, it.x, it.y), [x1, y1] = G.apply(it.m, it.x + it.w, it.y + it.h);
          objs.push({ image: it.image, x: Math.min(x0, x1) * k, y: -Math.max(y0, y1) * k, w: Math.abs(x1 - x0) * k, h: Math.abs(y1 - y0) * k });
          continue;
        }
        const paths = it.mmPaths || it.paths.map(p => { const q = p.pts.map((v, i) => i % 2 ? -v * k : v * k); return { pts: q, closed: p.closed }; });
        objs.push({ paths, layer: nearestLayer(it.color), filled: it.filled });
      }
      return { objects: objs, skippedText, texts: items.filter(i => i.text).length };
    } finally { host.remove(); }
  }

  // ---------------- DXF ----------------
  function dxf(text) {
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
    let insunits = 4;
    // header units
    for (let i = 0; i < pairs.length - 1; i++) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') { insunits = parseInt(pairs[i + 1][1], 10); break; }
    const unit = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 0: 1 }[insunits] ?? 1;
    // collect blocks & entities
    const blocks = {}; const entities = [];
    let section = null, i = 0, curBlock = null;
    const readEntity = () => { // at pairs[i] == [0, TYPE]
      const type = pairs[i][1]; const e = { type, codes: [] }; i++;
      while (i < pairs.length && pairs[i][0] !== 0) { e.codes.push(pairs[i]); i++; }
      return e;
    };
    while (i < pairs.length) {
      const [c, v] = pairs[i];
      if (c === 0 && v === 'SECTION') { section = pairs[i + 1] && pairs[i + 1][1]; i += 2; continue; }
      if (c === 0 && v === 'ENDSEC') { section = null; i++; continue; }
      if (c === 0 && (section === 'ENTITIES' || section === 'BLOCKS')) {
        if (v === 'BLOCK') { const e = readEntity(); const name = (e.codes.find(p => p[0] === 2) || [])[1]; curBlock = blocks[name] = []; continue; }
        if (v === 'ENDBLK') { curBlock = null; readEntity(); continue; }
        const e = readEntity();
        if (e.type === 'POLYLINE') { // gather vertices
          e.vertices = [];
          while (i < pairs.length && pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') e.vertices.push(readEntity());
          if (pairs[i] && pairs[i][1] === 'SEQEND') readEntity();
        }
        if (section === 'BLOCKS') { if (curBlock) curBlock.push(e); } else entities.push(e);
        continue;
      }
      i++;
    }
    const get = (e, code, def = 0) => { const p = e.codes.find(q => q[0] === code); return p ? parseFloat(p[1]) : def; };
    const all = (e, code) => e.codes.filter(q => q[0] === code).map(q => parseFloat(q[1]));
    const arcPts = (cx, cy, r, a0, a1) => { // degrees CCW
      while (a1 <= a0) a1 += 360;
      const n = Math.max(8, Math.ceil((a1 - a0) / 360 * Math.max(32, r * 6)));
      const o = []; for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; o.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      return o;
    };
    const bulgePts = (x1, y1, x2, y2, b) => {
      if (!b) return [x2, y2];
      const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy); if (d === 0) return [x2, y2];
      const th = 4 * Math.atan(b), r = d * (1 + b * b) / (4 * Math.abs(b));
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, nx = -dy / d, ny = dx / d;
      const h = d * (1 - b * b) / (4 * b);
      const cx = mx + nx * h, cy = my + ny * h;
      const a0 = Math.atan2(y1 - cy, x1 - cx);
      const n = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI * 2) * Math.max(32, r * 6)));
      const o = []; for (let k = 1; k <= n; k++) { const a = a0 + th * k / n; o.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      return o;
    };
    const bspline = (ctrl, deg, knots, closed) => {
      const n = ctrl.length / 2; if (n < 2) return ctrl;
      if (!knots || knots.length !== n + deg + 1) { knots = []; for (let k = 0; k < n + deg + 1; k++) knots.push(k < deg + 1 ? 0 : k >= n ? n - deg : k - deg); }
      const t0 = knots[deg], t1 = knots[n], steps = Math.max(20, n * 12), o = [];
      for (let s = 0; s <= steps; s++) {
        let t = t0 + (t1 - t0) * s / steps; if (s === steps) t -= 1e-9;
        let k = deg; while (k < n - 1 && t >= knots[k + 1]) k++;
        const dx = [], dy = [];
        for (let j = 0; j <= deg; j++) { dx[j] = ctrl[2 * (j + k - deg)]; dy[j] = ctrl[2 * (j + k - deg) + 1]; }
        for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
          const den = knots[j + 1 + k - r] - knots[j + k - deg]; const a = den ? (t - knots[j + k - deg]) / den : 0;
          dx[j] = (1 - a) * dx[j - 1] + a * dx[j]; dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        }
        o.push(dx[deg], dy[deg]);
      }
      return o;
    };
    const toPaths = (e, depth = 0) => {
      switch (e.type) {
        case 'LINE': return [{ pts: [get(e, 10), get(e, 20), get(e, 11), get(e, 21)], closed: false }];
        case 'CIRCLE': { const p = arcPts(get(e, 10), get(e, 20), get(e, 40), 0, 360); p.length -= 2; return [{ pts: p, closed: true }]; }
        case 'ARC': return [{ pts: arcPts(get(e, 10), get(e, 20), get(e, 40), get(e, 50), get(e, 51)), closed: false }];
        case 'LWPOLYLINE': {
          const flags = get(e, 70); const closed = (flags & 1) === 1;
          const vs = []; let cur = null;
          for (const [c, v] of e.codes) {
            if (c === 10) { cur = { x: parseFloat(v), y: 0, b: 0 }; vs.push(cur); }
            else if (c === 20 && cur) cur.y = parseFloat(v); else if (c === 42 && cur) cur.b = parseFloat(v);
          }
          return [polyFromVerts(vs, closed)];
        }
        case 'POLYLINE': {
          const closed = (get(e, 70) & 1) === 1;
          const vs = e.vertices.map(v => ({ x: get(v, 10), y: get(v, 20), b: get(v, 42) }));
          return [polyFromVerts(vs, closed)];
        }
        case 'ELLIPSE': {
          const cx = get(e, 10), cy = get(e, 20), mx = get(e, 11), my = get(e, 21), ratio = get(e, 40, 1);
          let s = get(e, 41, 0), en = get(e, 42, Math.PI * 2); while (en <= s) en += Math.PI * 2;
          const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), b = a * ratio;
          const full = Math.abs(en - s - Math.PI * 2) < 1e-6;
          const n = Math.max(24, Math.ceil((en - s) / (Math.PI * 2) * Math.max(48, a * 6))), o = [];
          for (let k = 0; k <= (full ? n - 1 : n); k++) {
            const t = s + (en - s) * k / n, x = a * Math.cos(t), y = b * Math.sin(t);
            o.push(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot));
          }
          return [{ pts: o, closed: full }];
        }
        case 'SPLINE': {
          const deg = get(e, 71, 3), closed = (get(e, 70) & 1) === 1;
          const cx = all(e, 10), cy = all(e, 20), fx = all(e, 11), fy = all(e, 21), knots = all(e, 40);
          let pts;
          if (cx.length >= 2) { const ctrl = []; cx.forEach((x, k) => ctrl.push(x, cy[k])); pts = bspline(ctrl, deg, knots, closed); }
          else { pts = []; fx.forEach((x, k) => pts.push(x, fy[k])); }
          return [{ pts, closed }];
        }
        case 'INSERT': {
          if (depth > 4) return [];
          const name = (e.codes.find(p => p[0] === 2) || [])[1]; const blk = blocks[name]; if (!blk) return [];
          const ix = get(e, 10), iy = get(e, 20), sx = get(e, 41, 1), sy = get(e, 42, 1), rot = get(e, 50, 0);
          const m = G.mul(G.translate(ix, iy), G.mul(G.rotate(rot), G.scale(sx, sy)));
          return G.xformPaths(blk.flatMap(b => toPaths(b, depth + 1)), m);
        }
      }
      return [];
    };
    const polyFromVerts = (vs, closed) => {
      if (!vs.length) return { pts: [], closed };
      const pts = [vs[0].x, vs[0].y];
      for (let k = 1; k < vs.length; k++) pts.push(...bulgePts(vs[k - 1].x, vs[k - 1].y, vs[k].x, vs[k].y, vs[k - 1].b));
      if (closed && vs.length > 1) {
        const last = vs[vs.length - 1];
        const extra = bulgePts(last.x, last.y, vs[0].x, vs[0].y, last.b); extra.length -= 2; pts.push(...extra);
      }
      return { pts, closed };
    };
    let paths = entities.flatMap(e => toPaths(e)).filter(p => p.pts.length >= 4);
    paths = paths.map(p => ({ pts: p.pts.map(v => v * unit), closed: p.closed }));
    paths = joinPaths(paths, 0.02);
    return { objects: paths.length ? [{ paths }] : [] };
  }

  // join open paths whose endpoints touch
  function joinPaths(paths, tol) {
    const closed = paths.filter(p => p.closed), open = paths.filter(p => !p.closed).map(p => p.pts.slice());
    const near = (ax, ay, bx, by) => Math.abs(ax - bx) <= tol && Math.abs(ay - by) <= tol;
    const rev = (q) => { const o = []; for (let i = q.length - 2; i >= 0; i -= 2) o.push(q[i], q[i + 1]); return o; };
    let changed = true;
    while (changed) {
      changed = false;
      for (let a = 0; a < open.length && !changed; a++) {
        for (let b = a + 1; b < open.length; b++) {
          let A = open[a], B = open[b];
          const ae = [A[A.length - 2], A[A.length - 1]], as = [A[0], A[1]], bs = [B[0], B[1]], be = [B[B.length - 2], B[B.length - 1]];
          let J = null;
          if (near(...ae, ...bs)) J = A.concat(B.slice(2));
          else if (near(...ae, ...be)) J = A.concat(rev(B).slice(2));
          else if (near(...as, ...be)) J = B.concat(A.slice(2));
          else if (near(...as, ...bs)) J = rev(B).concat(A.slice(2));
          if (J) { open[a] = J; open.splice(b, 1); changed = true; break; }
        }
      }
    }
    const out = closed.slice();
    for (const q of open) {
      if (q.length >= 6 && near(q[0], q[1], q[q.length - 2], q[q.length - 1])) out.push({ pts: q.slice(0, -2), closed: true });
      else out.push({ pts: q, closed: false });
    }
    return out;
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not load image')); im.src = src; });
  }
  return { svg, dxf, joinPaths, loadImage, parseColor };
})();
