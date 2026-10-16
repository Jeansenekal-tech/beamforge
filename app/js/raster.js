// Image processing for laser engraving: adjustments + dithering.
// Produces a Float32Array of burn intensity 0..1 (1 = full power) at the requested resolution.
'use strict';
const Raster = (() => {
  const MODES = {
    threshold: 'Threshold', ordered: 'Ordered (Bayer)', atkinson: 'Atkinson', floyd: 'Floyd–Steinberg',
    jarvis: 'Jarvis', stucki: 'Stucki', sierra: 'Sierra', grayscale: 'Grayscale (variable power)', halftone: 'Halftone'
  };
  const KERNELS = {
    floyd: { d: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    atkinson: { d: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
    jarvis: { d: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
    stucki: { d: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
    sierra: { d: 32, k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
  };
  const bayer8 = (() => {
    const b = [[0, 2], [3, 1]]; let m = b;
    for (let s = 2; s < 8; s *= 2) {
      const n = []; for (let y = 0; y < 2 * s; y++) { n[y] = []; for (let x = 0; x < 2 * s; x++) n[y][x] = 4 * m[y % s][x % s] + b[(y / s) | 0][(x / s) | 0]; }
      m = n;
    }
    return m;
  })();

  // img: HTMLImageElement; cols, rows: output grid; adj: {brightness,contrast,gamma,invert}; mode
  // returns { data: Float32Array(cols*rows) of 0..1 darkness after processing, cols, rows }
  function process(img, cols, rows, adj, mode, opts = {}) {
    cols = Math.max(1, Math.round(cols)); rows = Math.max(1, Math.round(rows));
    const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff'; c.fillRect(0, 0, cols, rows);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, cols, rows);
    const px = c.getImageData(0, 0, cols, rows).data;
    const n = cols * rows, L = new Float32Array(n);
    const br = (adj.brightness || 0) / 100, ct = (adj.contrast || 0) / 100, gm = adj.gamma || 1;
    const cf = ct >= 0 ? 1 + ct * 3 : 1 + ct;
    for (let k = 0; k < n; k++) {
      const a = px[4 * k + 3] / 255;
      let v = (0.299 * px[4 * k] + 0.587 * px[4 * k + 1] + 0.114 * px[4 * k + 2]) / 255;
      v = v * a + (1 - a); // transparent -> white
      v = (v - 0.5) * cf + 0.5 + br;
      v = Math.max(0, Math.min(1, v));
      v = Math.pow(v, 1 / gm);
      if (adj.invert) v = 1 - v;
      L[k] = v; // brightness 0..1 (1 = white)
    }
    // sharpen (unsharp)
    if (adj.sharpen > 0) {
      const amt = adj.sharpen / 100, B = new Float32Array(n);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let s = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) { s += L[yy * cols + xx]; cnt++; } }
        B[y * cols + x] = s / cnt;
      }
      for (let k = 0; k < n; k++) L[k] = Math.max(0, Math.min(1, L[k] + (L[k] - B[k]) * amt * 2));
    }
    const out = new Float32Array(n);
    const thr = (opts.threshold ?? 128) / 255;
    if (mode === 'grayscale') { for (let k = 0; k < n; k++) out[k] = 1 - L[k]; }
    else if (mode === 'threshold') { for (let k = 0; k < n; k++) out[k] = L[k] < thr ? 1 : 0; }
    else if (mode === 'ordered') {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const t = (bayer8[y & 7][x & 7] + 0.5) / 64; out[y * cols + x] = L[y * cols + x] < t ? 1 : 0; }
    } else if (mode === 'halftone') {
      const cell = Math.max(3, Math.round(opts.halftoneCell || 6)); const ang = (opts.halftoneAngle ?? 45) * Math.PI / 180;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const u = (x * ca + y * sa) / cell, v = (-x * sa + y * ca) / cell;
        const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
        const d = Math.sqrt(fu * fu + fv * fv) / 0.7071; // 0 centre .. 1 corner
        const dark = 1 - L[y * cols + x];
        out[y * cols + x] = d < Math.sqrt(dark) ? 1 : 0;
      }
    } else {
      const K = KERNELS[mode] || KERNELS.jarvis;
      const e = Float32Array.from(L);
      for (let y = 0; y < rows; y++) {
        const ltr = (y % 2 === 0) || !opts.serpentine;
        for (let xi = 0; xi < cols; xi++) {
          const x = ltr ? xi : cols - 1 - xi, k = y * cols + x;
          const o = e[k] < 0.5 ? 0 : 1; const err = e[k] - o;
          out[k] = 1 - o;
          for (const [dx0, dy, w] of K.k) {
            const dx = ltr ? dx0 : -dx0; const xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < cols && yy < rows) e[yy * cols + xx] += err * w / K.d;
          }
        }
      }
    }
    return { data: out, cols, rows };
  }
  // render processed data to a canvas for preview (black = burn)
  function toCanvas(res) {
    const cv = document.createElement('canvas'); cv.width = res.cols; cv.height = res.rows;
    const c = cv.getContext('2d'); const id = c.createImageData(res.cols, res.rows);
    for (let k = 0; k < res.data.length; k++) { const v = 255 - Math.round(res.data[k] * 255); id.data[4 * k] = id.data[4 * k + 1] = id.data[4 * k + 2] = v; id.data[4 * k + 3] = res.data[k] > 0.004 ? 255 : 0; }
    c.putImageData(id, 0, 0); return cv;
  }
  return { MODES, process, toCanvas };
})();
