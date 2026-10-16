// 3D model import → depth map (grayscale) for 3D/relief engraving.
// Formats: STL (binary/ASCII), OBJ, PLY (ASCII/binary), OFF, 3MF, AMF (plain or zipped). Multiple meshes are merged.
'use strict';
const Model3D = (() => {
  const td = new TextDecoder();

  // ---------------- zip (for 3MF / zipped AMF) ----------------
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a valid zip/3MF file');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      files[name] = { method, csize, lho }; p += 46 + nl + xl + cl;
    }
    const read = async (name) => {
      const f = files[name]; if (!f) return null;
      const ln = dv.getUint16(f.lho + 26, true), lx = dv.getUint16(f.lho + 28, true);
      const data = u8.subarray(f.lho + 30 + ln + lx, f.lho + 30 + ln + lx + f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new Error('Unsupported zip compression');
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    };
    return { names: Object.keys(files), read };
  }

  // ---------------- parsers → Float32Array triangle soup (9 floats / triangle) ----------------
  function soup(verts, tris) { // verts: flat [x,y,z...], tris: flat [a,b,c...]
    const out = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) { const v = tris[i] * 3; out[i * 3] = verts[v]; out[i * 3 + 1] = verts[v + 1]; out[i * 3 + 2] = verts[v + 2]; }
    return out;
  }
  function stl(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === u8.length) {
        const out = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) out[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
        return out;
      }
    }
    const txt = td.decode(u8), v = [];
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m;
    while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3]);
    if (!v.length) throw new Error('No triangles found in STL');
    return Float32Array.from(v.slice(0, Math.floor(v.length / 9) * 9));
  }
  function obj(u8) {
    const v = [], t = [];
    for (const line of td.decode(u8).split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
      else if (p[0] === 'f') {
        const nv = v.length / 3, idx = p.slice(1).filter(Boolean).map(s => { const k = parseInt(s, 10); return k < 0 ? nv + k : k - 1; });
        for (let i = 1; i + 1 < idx.length; i++) t.push(idx[0], idx[i], idx[i + 1]);
      }
    }
    if (!t.length) throw new Error('No faces found in OBJ');
    return soup(v, t);
  }
  function off(u8) {
    const tok = td.decode(u8).replace(/#.*$/gm, '').split(/\s+/).filter(Boolean);
    let i = 0; if (/OFF$/i.test(tok[0])) i++;
    const nv = +tok[i++], nf = +tok[i++]; i++;
    const v = []; for (let k = 0; k < nv; k++) v.push(+tok[i++], +tok[i++], +tok[i++]);
    const t = []; for (let k = 0; k < nf; k++) { const n = +tok[i++], f = []; for (let j = 0; j < n; j++) f.push(+tok[i++]); for (let j = 1; j + 1 < n; j++) t.push(f[0], f[j], f[j + 1]); }
    return soup(v, t);
  }
  function ply(u8) {
    let hEnd = -1; const head = td.decode(u8.subarray(0, Math.min(u8.length, 65536)));
    const hi = head.indexOf('end_header'); if (hi < 0) throw new Error('Invalid PLY header');
    hEnd = head.slice(0, hi).length; const nl = head.indexOf('\n', hi); const dataStart = new TextEncoder().encode(head.slice(0, nl + 1)).length;
    const lines = head.slice(0, hEnd).split('\n').map(l => l.trim());
    let format = 'ascii'; const els = []; let cur = null;
    for (const l of lines) {
      const p = l.split(/\s+/);
      if (p[0] === 'format') format = p[1];
      else if (p[0] === 'element') { cur = { name: p[1], count: +p[2], props: [] }; els.push(cur); }
      else if (p[0] === 'property' && cur) { if (p[1] === 'list') cur.props.push({ list: true, ct: p[2], it: p[3], name: p[4] }); else cur.props.push({ t: p[1], name: p[2] }); }
    }
    const v = [], t = [];
    if (format === 'ascii') {
      const tok = td.decode(u8.subarray(dataStart)).split(/\s+/).filter(Boolean); let i = 0;
      for (const e of els) for (let k = 0; k < e.count; k++) {
        const vals = {};
        for (const pr of e.props) { if (pr.list) { const n = +tok[i++]; const a = []; for (let j = 0; j < n; j++) a.push(+tok[i++]); vals[pr.name] = a; } else vals[pr.name] = +tok[i++]; }
        if (e.name === 'vertex') v.push(vals.x, vals.y, vals.z);
        else if (e.name === 'face') { const f = vals.vertex_indices || vals.vertex_index || []; for (let j = 1; j + 1 < f.length; j++) t.push(f[0], f[j], f[j + 1]); }
      }
    } else {
      const le = format === 'binary_little_endian', dv = new DataView(u8.buffer, u8.byteOffset + dataStart, u8.byteLength - dataStart); let o = 0;
      const rd = (ty) => { let r; switch (ty) {
        case 'char': case 'int8': r = dv.getInt8(o); o += 1; break; case 'uchar': case 'uint8': r = dv.getUint8(o); o += 1; break;
        case 'short': case 'int16': r = dv.getInt16(o, le); o += 2; break; case 'ushort': case 'uint16': r = dv.getUint16(o, le); o += 2; break;
        case 'int': case 'int32': r = dv.getInt32(o, le); o += 4; break; case 'uint': case 'uint32': r = dv.getUint32(o, le); o += 4; break;
        case 'float': case 'float32': r = dv.getFloat32(o, le); o += 4; break; case 'double': case 'float64': r = dv.getFloat64(o, le); o += 8; break;
        default: throw new Error('Unknown PLY type ' + ty); } return r; };
      for (const e of els) for (let k = 0; k < e.count; k++) {
        const vals = {};
        for (const pr of e.props) { if (pr.list) { const n = rd(pr.ct); const a = new Array(n); for (let j = 0; j < n; j++) a[j] = rd(pr.it); vals[pr.name] = a; } else vals[pr.name] = rd(pr.t); }
        if (e.name === 'vertex') v.push(vals.x, vals.y, vals.z);
        else if (e.name === 'face') { const f = vals.vertex_indices || vals.vertex_index || []; for (let j = 1; j + 1 < f.length; j++) t.push(f[0], f[j], f[j + 1]); }
      }
    }
    if (!t.length) throw new Error('No faces found in PLY (point clouds are not supported)');
    return soup(v, t);
  }
  const els = (doc, tag) => [...doc.getElementsByTagNameNS('*', tag)];
  async function threeMF(u8) {
    const z = await unzip(u8);
    const names = z.names.filter(n => /\.model$/i.test(n)); if (!names.length) throw new Error('No 3D model inside this 3MF');
    const objects = {}; let build = [];
    for (const name of names) {
      const doc = new DOMParser().parseFromString(td.decode(await z.read(name)), 'application/xml');
      for (const ob of els(doc, 'object')) {
        const id = ob.getAttribute('id'); const mesh = ob.getElementsByTagNameNS('*', 'mesh')[0];
        const rec = { tris: null, comps: [] };
        if (mesh) {
          const v = []; for (const vx of els(mesh, 'vertex')) v.push(+vx.getAttribute('x'), +vx.getAttribute('y'), +vx.getAttribute('z'));
          const t = []; for (const tr of els(mesh, 'triangle')) t.push(+tr.getAttribute('v1'), +tr.getAttribute('v2'), +tr.getAttribute('v3'));
          rec.tris = soup(v, t);
        }
        for (const c of els(ob, 'component')) rec.comps.push({ id: c.getAttribute('objectid'), m: c.getAttribute('transform') });
        objects[id] = rec;
      }
      build = build.concat(els(doc, 'item').map(it => ({ id: it.getAttribute('objectid'), m: it.getAttribute('transform') })));
    }
    const parseM = (s) => { if (!s) return null; const a = s.trim().split(/\s+/).map(Number); return a.length === 12 ? a : null; };
    const apply = (tris, m) => { if (!m) return tris; const o = new Float32Array(tris.length); for (let i = 0; i < tris.length; i += 3) { const x = tris[i], y = tris[i + 1], zz = tris[i + 2]; o[i] = x * m[0] + y * m[3] + zz * m[6] + m[9]; o[i + 1] = x * m[1] + y * m[4] + zz * m[7] + m[10]; o[i + 2] = x * m[2] + y * m[5] + zz * m[8] + m[11]; } return o; };
    const resolve = (id, depth = 0) => {
      const r = objects[id]; if (!r || depth > 8) return [];
      let out = r.tris ? [r.tris] : [];
      for (const c of r.comps) out = out.concat(resolve(c.id, depth + 1).map(t => apply(t, parseM(c.m))));
      return out;
    };
    let parts = [];
    if (build.length) for (const b of build) parts = parts.concat(resolve(b.id).map(t => apply(t, parseM(b.m))));
    else for (const id in objects) if (objects[id].tris) parts.push(objects[id].tris);
    return concat(parts);
  }
  async function amf(u8) {
    if (u8[0] === 0x50 && u8[1] === 0x4b) { const z = await unzip(u8); u8 = await z.read(z.names[0]); }
    const doc = new DOMParser().parseFromString(td.decode(u8), 'application/xml');
    const parts = [];
    for (const ob of els(doc, 'object')) {
      const v = []; for (const c of els(ob, 'coordinates')) { const g = (k) => +(c.getElementsByTagNameNS('*', k)[0]?.textContent || 0); v.push(g('x'), g('y'), g('z')); }
      const t = []; for (const tr of els(ob, 'triangle')) { const g = (k) => +(tr.getElementsByTagNameNS('*', k)[0]?.textContent || 0); t.push(g('v1'), g('v2'), g('v3')); }
      if (t.length) parts.push(soup(v, t));
    }
    if (!parts.length) throw new Error('No triangles found in AMF');
    return concat(parts);
  }
  function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Float32Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }

  const FORMATS = ['stl', 'obj', 'ply', 'off', '3mf', 'amf'];
  async function parse(u8, ext) {
    ext = ext.toLowerCase();
    const tris = ext === 'stl' ? stl(u8) : ext === 'obj' ? obj(u8) : ext === 'ply' ? ply(u8) : ext === 'off' ? off(u8) : ext === '3mf' ? await threeMF(u8) : ext === 'amf' ? await amf(u8) : null;
    if (!tris || tris.length < 9) throw new Error('No triangles found in this model');
    for (let i = 0; i < tris.length; i++) if (!isFinite(tris[i])) tris[i] = 0;
    return { tris, count: tris.length / 9 };
  }

  // ---------------- depth map rendering ----------------
  // each view = [tilt about X, turn about Z]; the turn is applied first (screen X right, Y up, depth toward the viewer)
  const VIEWS = { top: [0, 0], bottom: [180, 0], front: [-90, 0], back: [-90, 180], left: [-90, 90], right: [-90, -90] };
  const mul3 = (a, b) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return o; };
  function rotMatrix(ax, ay, az) {
    const r = Math.PI / 180, [cx, sx, cy, sy, cz, sz] = [Math.cos(ax * r), Math.sin(ax * r), Math.cos(ay * r), Math.sin(ay * r), Math.cos(az * r), Math.sin(az * r)];
    const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const mm = (a, b) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return o; };
    return mm(Rz, mm(Ry, Rx));
  }
  // settings: { view, rx, ry, rz }  → rotated triangles + bounds (model units, assumed mm)
  function orient(model, s) {
    const v = VIEWS[s.view] || VIEWS.top;
    const R = mul3(rotMatrix(s.rx || 0, s.ry || 0, s.rz || 0), mul3(rotMatrix(v[0], 0, 0), rotMatrix(0, 0, v[1])));
    const t = model.tris, out = new Float32Array(t.length);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i], y = t[i + 1], z = t[i + 2];
      const X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z;
      out[i] = X; out[i + 1] = Y; out[i + 2] = Z;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
    }
    return { tris: out, box: { x0, y0, z0, x1, y1, z1 } };
  }
  // renders a depth map; options { wpx, hpx, levels, invert } → { canvas, coverage }
  function render(oriented, o) {
    const { tris, box } = oriented, W = Math.max(1, Math.round(o.wpx)), H = Math.max(1, Math.round(o.hpx));
    const sx = W / ((box.x1 - box.x0) || 1), sy = H / ((box.y1 - box.y0) || 1);
    const zb = new Float32Array(W * H).fill(-Infinity);
    for (let i = 0; i < tris.length; i += 9) {
      const ax = (tris[i] - box.x0) * sx, ay = (box.y1 - tris[i + 1]) * sy, az = tris[i + 2];
      const bx = (tris[i + 3] - box.x0) * sx, by = (box.y1 - tris[i + 4]) * sy, bz = tris[i + 5];
      const cx = (tris[i + 6] - box.x0) * sx, cy = (box.y1 - tris[i + 7]) * sy, cz = tris[i + 8];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-12) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * az + w1 * bz + w2 * cz, k = y * W + x;
          if (z > zb[k]) zb[k] = z;
        }
      }
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), id = ctx.createImageData(W, H), zr = (box.z1 - box.z0) || 1, L = Math.max(2, o.levels || 256);
    let cov = 0;
    for (let k = 0; k < W * H; k++) {
      let g = 255;
      if (zb[k] > -Infinity) {
        cov++;
        let t = (zb[k] - box.z0) / zr; if (o.invert) t = 1 - t;      // t: 1 = highest point (white = least burn)
        t = Math.round(t * (L - 1)) / (L - 1);
        g = Math.round(t * 255);
      }
      id.data[4 * k] = id.data[4 * k + 1] = id.data[4 * k + 2] = g; id.data[4 * k + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return { canvas: cv, coverage: cov / (W * H) };
  }
  return { FORMATS, parse, orient, render, VIEWS };
})();
