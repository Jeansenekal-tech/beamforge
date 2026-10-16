// GRBL controller: Web Serial transport, built-in simulator, character-counting streamer.
'use strict';
class SerialTransport {
  constructor() { this.port = null; this.reader = null; this.writer = null; this.onData = null; this.onClose = null; }
  static available() { return 'serial' in navigator; }
  async open(baud) {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: baud, bufferSize: 8192 });
    this.writer = this.port.writable.getWriter();
    this._readLoop();
    try { await this.port.setSignals({ dataTerminalReady: true, requestToSend: false }); } catch (e) { }
    this.name = (() => { try { const i = this.port.getInfo(); return i.usbVendorId ? `USB ${i.usbVendorId.toString(16)}:${(i.usbProductId || 0).toString(16)}` : 'Serial port'; } catch { return 'Serial port'; } })();
  }
  async _readLoop() {
    const dec = new TextDecoder();
    while (this.port && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (; ;) { const { value, done } = await this.reader.read(); if (done) break; if (value && this.onData) this.onData(dec.decode(value)); }
      } catch (e) { /* device lost */ break; }
      finally { try { this.reader.releaseLock(); } catch { } }
    }
    if (this.onClose) this.onClose();
  }
  write(str) { if (this.writer) return this.writer.write(typeof str === 'string' ? new TextEncoder().encode(str) : str); }
  async close() {
    const p = this.port; this.port = null;
    try { await this.reader?.cancel(); } catch { }
    try { this.writer?.releaseLock(); } catch { }
    try { await p?.close(); } catch { }
  }
}

// A software GRBL 1.1 so you can test jobs without a machine.
class SimTransport {
  constructor() { this.onData = null; this.onClose = null; this.name = 'Simulated GRBL'; }
  async open() {
    this.pos = [0, 0, 0]; this.wco = [0, 0, 0]; this.state = 'Idle'; this.q = []; this.f = 1000; this.s = 0; this.rel = false; this.hold = false;
    this.buf = ''; this.speed = 20; // simulation speed multiplier
    this.settings = { 0: 10, 1: 25, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 10: 1, 11: 0.01, 12: 0.002, 13: 0, 20: 0, 21: 0, 22: 1, 23: 0, 24: 25, 25: 500, 26: 250, 27: 1, 30: 1000, 31: 0, 32: 1, 100: 80, 101: 80, 102: 80, 110: 6000, 111: 6000, 112: 500, 120: 500, 121: 500, 122: 10, 130: 400, 131: 400, 132: 50 };
    setTimeout(() => this._emit("\r\nGrbl 1.1h ['$' for help]\r\n"), 100);
    this.timer = setInterval(() => this._tick(), 20);
  }
  _emit(s) { this.onData && this.onData(s); }
  write(data) {
    const s = typeof data === 'string' ? data : new TextDecoder().decode(data);
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (ch === '?') { this._status(); continue; }
      if (ch === '!') { this.hold = true; if (this.state === 'Run' || this.state === 'Jog') this.state = 'Hold:0'; continue; }
      if (ch === '~') { this.hold = false; if (this.state.startsWith('Hold')) this.state = this.q.length ? 'Run' : 'Idle'; continue; }
      if (c === 0x18) { this.q = []; this.cur = null; this.hold = false; this.state = 'Idle'; this.buf = ''; this._emit("\r\nGrbl 1.1h ['$' for help]\r\n"); continue; }
      if (c === 0x85) { if (this.state === 'Jog') { this.q = this.q.filter(m => !m.jog); this.cur = null; this.state = 'Idle'; } continue; }
      if (c >= 0x80) continue;
      if (ch === '\n') { this._line(this.buf.trim()); this.buf = ''; } else if (ch !== '\r') this.buf += ch;
    }
  }
  _status() {
    const w = this.pos.map((v, i) => (v - this.wco[i]).toFixed(3));
    this._emit(`<${this.state}|MPos:${this.pos.map(v => v.toFixed(3)).join(',')}|FS:${this.cur ? this.f : 0},${this.cur ? this.s : 0}|WCO:${this.wco.map(v => v.toFixed(3)).join(',')}>\r\n`);
  }
  _line(l) {
    const u = l.toUpperCase();
    if (!u) { this._emit('ok\r\n'); return; }
    if (u === '$$') { Object.entries(this.settings).forEach(([k, v]) => this._emit(`$${k}=${v}\r\n`)); this._emit('ok\r\n'); return; }
    if (u === '$I') { this._emit('[VER:1.1h.20190825:Simulator]\r\n[OPT:VL,15,128]\r\nok\r\n'); return; }
    if (u === '$G') { this._emit(`[GC:G0 G54 G17 G21 ${this.rel ? 'G91' : 'G90'} G94 M5 M9 T0 F${this.f} S${this.s}]\r\nok\r\n`); return; }
    if (u === '$X') { this.state = 'Idle'; this._emit('[MSG:Caution: Unlocked]\r\nok\r\n'); return; }
    if (u === '$H') { this.q.push({ to: [0, 0, 0], f: 3000, home: true }); this._emit('ok\r\n'); return; }
    const sm = u.match(/^\$(\d+)=([\d.]+)$/); if (sm) { this.settings[sm[1]] = +sm[2]; this._emit('ok\r\n'); return; }
    if (u.startsWith('$J=')) {
      const w = this._words(u.slice(3)); const rel = /G91/.test(u);
      const to = this._target(w, rel); this.q.push({ to, f: w.F || 1000, jog: true }); this._emit('ok\r\n'); return;
    }
    if (u.startsWith('$')) { this._emit('ok\r\n'); return; }
    const w = this._words(u);
    if (/G90/.test(u)) this.rel = false; if (/G91/.test(u)) this.rel = true;
    if (/G10\s*L20/.test(u)) { ['X', 'Y', 'Z'].forEach((a, i) => { if (w[a] !== undefined) this.wco[i] = this.pos[i] - w[a]; }); this._emit('ok\r\n'); return; }
    if (/G92/.test(u)) { ['X', 'Y', 'Z'].forEach((a, i) => { if (w[a] !== undefined) this.wco[i] = this.pos[i] - w[a]; }); this._emit('ok\r\n'); return; }
    if (w.S !== undefined) this.s = w.S; if (w.F !== undefined) this.f = w.F;
    if (w.X !== undefined || w.Y !== undefined || w.Z !== undefined) {
      const g0 = /^G0\b|^G00\b/.test(u); const to = this._target(w, this.rel);
      this.q.push({ to, f: g0 ? 6000 : this.f });
    }
    // planner buffer: delay ok when queue is long
    const ack = () => { if (this.q.length > 15) setTimeout(ack, 15); else this._emit('ok\r\n'); };
    ack();
  }
  _words(s) { const w = {}; s.replace(/([A-Z])([-+]?[\d.]+)/g, (_, k, v) => { w[k] = +v; return ''; }); return w; }
  _target(w, rel) {
    const base = rel ? this.pos : this.wco; const t = this.pos.slice();
    ['X', 'Y', 'Z'].forEach((a, i) => { if (w[a] !== undefined) t[i] = rel ? this.pos[i] + w[a] : this.wco[i] + w[a]; });
    // For queued relative moves, compute from the end of queue
    if (rel && this.q.length) { const last = this.q[this.q.length - 1].to; ['X', 'Y', 'Z'].forEach((a, i) => { t[i] = w[a] !== undefined ? last[i] + w[a] : last[i]; }); }
    return t;
  }
  _tick() {
    if (this.hold) return;
    if (!this.cur && this.q.length) { this.cur = this.q.shift(); this.state = this.cur.jog ? 'Jog' : this.cur.home ? 'Home' : 'Run'; }
    if (!this.cur) { if (this.state === 'Run' || this.state === 'Jog' || this.state === 'Home') this.state = 'Idle'; return; }
    let budget = 0.02 * this.speed; // seconds of motion this tick
    while (this.cur && budget > 0) {
      const step = this.cur.f / 60 * budget;
      const d = this.cur.to.map((v, i) => v - this.pos[i]); const L = Math.hypot(...d);
      if (L <= step) {
        budget -= L / (this.cur.f / 60); this.pos = this.cur.to.slice(); if (this.cur.home) this.wco = [0, 0, 0];
        this.cur = this.q.length && !this.q[0].home ? this.q.shift() : null;
      } else { this.pos = this.pos.map((v, i) => v + d[i] / L * step); budget = 0; }
    }
  }
  close() { clearInterval(this.timer); this.onClose && this.onClose(); }
}

class Grbl {
  constructor() {
    this.t = null; this.connected = false; this.rx = ''; this.status = { state: 'Disconnected', mpos: [0, 0, 0], wpos: [0, 0, 0], wco: [0, 0, 0], fs: [0, 0] };
    this.sent = []; this.queue = []; this.RX_SIZE = 127; this.job = null; this.listeners = {}; this.settings = {};
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }
  async connect(kind, baud) {
    if (this.connected) await this.disconnect();
    this.t = kind === 'sim' ? new SimTransport() : new SerialTransport();
    this.t.onData = (s) => this._onData(s);
    this.t.onClose = () => { if (this.connected) { this.connected = false; this._reset(); this.status.state = 'Disconnected'; this.emit('status', this.status); this.emit('conn', false); this.emit('log', '[Disconnected]', 'sys'); } };
    await this.t.open(baud);
    this.connected = true; this.emit('conn', true, this.t.name);
    this.emit('log', `[Connected: ${this.t.name} @ ${baud}]`, 'sys');
    this.lastRx = Date.now(); this.silent = false;
    this.poll = setInterval(() => {
      if (!this.connected) return; this.t.write('?');
      const quiet = Date.now() - this.lastRx > 3000;
      if (quiet && !this.silent) { this.silent = true; this.status.state = 'Not Responding'; this.emit('status', this.status); this.emit('log', '[Controller is not responding]', 'err'); }
    }, 250);
    setTimeout(() => { if (this.connected) { this.send('$$', true); this.send('$I', true); } }, 1500);
  }
  async disconnect() {
    clearInterval(this.poll); const t = this.t; this.connected = false; this._reset();
    try { await t?.close(); } catch { }
    this.status.state = 'Disconnected'; this.emit('status', this.status); this.emit('conn', false);
  }
  _reset() { this.sent = []; this.queue = []; if (this.job) { this.job.done = true; this.emit('job', { ...this.job, aborted: true }); } this.job = null; }
  _onData(s) {
    this.lastRx = Date.now(); if (this.silent) { this.silent = false; this.emit('log', '[Controller responding again]', 'sys'); }
    this.rx += s; let i;
    while ((i = this.rx.indexOf('\n')) >= 0) {
      const line = this.rx.slice(0, i).replace(/\r$/, ''); this.rx = this.rx.slice(i + 1);
      if (line) this._line(line.trim());
    }
  }
  _line(l) {
    if (l.startsWith('<')) { this._parseStatus(l); return; }
    if (l === 'ok' || l.startsWith('error')) {
      const it = this.sent.shift();
      if (it && !it.silent || l.startsWith('error')) this.emit('log', it ? `${l}${l.startsWith('error') ? ' (' + (it.cmd) + ') ' + Grbl.errText(l) : ''}` : l, l.startsWith('error') ? 'err' : 'ok');
      if (it && it.job && this.job) {
        this.job.acked++;
        if (l.startsWith('error')) this.job.errors++;
        if (this.job.acked >= this.job.total) { this.job.done = true; this.job.end = Date.now(); this.emit('job', { ...this.job }); this.job = null; }
        else if (this.job.acked % 5 === 0) this.emit('job', { ...this.job });
      }
      this._pump(); return;
    }
    if (l.startsWith('ALARM')) { this.emit('log', l + ' ' + Grbl.alarmText(l), 'err'); this.emit('alarm', l); if (this.job) { this.queue = []; } }
    else if (l.startsWith('Grbl')) { this.sent = []; this.emit('log', l, 'sys'); this.emit('welcome', l); }
    else if (/^\$\d+=/.test(l)) { const [k, v] = l.slice(1).split('='); this.settings[k] = parseFloat(v); this.emit('settings', this.settings); if (!this._quietSettings) this.emit('log', l, 'in'); }
    else { const om = l.match(/^\[OPT:[^,]*,(\d+),(\d+)/); if (om) { this.reportedRx = +om[2]; this.emit('opt', this.reportedRx); } this.emit('log', l, 'in'); }
  }
  _parseStatus(l) {
    const parts = l.slice(1, -1).split('|'); const st = this.status; st.state = parts[0];
    for (const p of parts.slice(1)) {
      const [k, v] = p.split(':'); const n = v ? v.split(',').map(Number) : [];
      if (k === 'MPos') { st.mpos = n; st.wpos = n.map((x, i) => x - (st.wco[i] || 0)); }
      else if (k === 'WPos') { st.wpos = n; st.mpos = n.map((x, i) => x + (st.wco[i] || 0)); }
      else if (k === 'WCO') { st.wco = n; st.wpos = st.mpos.map((x, i) => x - n[i]); }
      else if (k === 'FS') st.fs = n; else if (k === 'Ov') st.ov = n; else if (k === 'Pn') st.pins = v;
    }
    this.emit('status', st);
  }
  _pump() {
    let used = this.sent.reduce((a, b) => a + b.len, 0);
    while (this.queue.length) {
      const it = this.queue[0]; if (used + it.len > this.RX_SIZE && this.sent.length) break;
      this.queue.shift(); this.sent.push(it); used += it.len; this.t.write(it.cmd + '\n');
    }
  }
  send(cmd, silent = false) {
    if (!this.connected) return false;
    cmd = cmd.trim(); if (!cmd) return;
    if (!silent) this.emit('log', '> ' + cmd, 'out');
    if (cmd === '$$') this._quietSettings = silent;
    this.queue.push({ cmd, len: cmd.length + 1, silent }); this._pump(); return true;
  }
  realtime(byte) { if (this.connected) this.t.write(new Uint8Array([byte])); }
  runJob(gcode, name = 'job') {
    if (!this.connected) throw new Error('Not connected');
    if (this.job) throw new Error('A job is already running');
    const lines = gcode.split('\n').map(l => l.replace(/;.*$/, '').replace(/\(.*?\)/g, '').trim()).filter(Boolean);
    this.job = { name, total: lines.length, acked: 0, errors: 0, start: Date.now(), done: false };
    for (const l of lines) this.queue.push({ cmd: l, len: l.length + 1, silent: true, job: true });
    this.emit('job', { ...this.job }); this._pump();
  }
  pause() { this.realtime(0x21); }
  resume() { this.realtime(0x7e); }
  stop() {
    this.queue = []; this.realtime(0x18); this.sent = [];
    if (this.job) { this.job.done = true; this.job.aborted = true; this.emit('job', { ...this.job }); this.job = null; }
    setTimeout(() => this.send('M5', true), 400);
  }
  jog(dx, dy, dz, feed) {
    const parts = []; if (dx) parts.push('X' + Gcode.fmt(dx)); if (dy) parts.push('Y' + Gcode.fmt(dy)); if (dz) parts.push('Z' + Gcode.fmt(dz));
    if (parts.length) this.send(`$J=G91 G21 ${parts.join(' ')} F${feed}`);
  }
  jogTo(x, y, feed) { this.send(`$J=G90 G21 X${Gcode.fmt(x)} Y${Gcode.fmt(y)} F${feed}`); }
  static errText(e) {
    const m = { 1: 'Expected command letter', 2: 'Bad number format', 3: 'Invalid $ statement', 8: 'Not idle', 9: 'Locked out (alarm) — unlock with $X or home', 15: 'Jog target exceeds machine travel', 20: 'Unsupported command', 22: 'Feed rate undefined', 33: 'Invalid target' };
    const n = parseInt(e.split(':')[1], 10); return m[n] || '';
  }
  static alarmText(a) {
    const m = { 1: 'Hard limit triggered', 2: 'Soft limit — target outside travel', 3: 'Reset while in motion — re-home recommended', 6: 'Homing fail (reset)', 7: 'Homing fail (door)', 8: 'Homing fail — pull-off', 9: 'Homing fail — no switch found' };
    const n = parseInt(a.split(':')[1], 10); return m[n] ? '— ' + m[n] : '';
  }
}
