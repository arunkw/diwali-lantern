/* Diwali Lantern - (c) 2026 Doneology Labs (OPC) Pvt Ltd - MIT License
 * One canvas engine shared by the web/PWA build and the Windows desktop overlay.
 * Physics: Verlet integration with distance constraints (cord, light wire, bulbs, kandil).
 * The kandils are real 3D meshes (orthographic, painter's sort, Lambert + emissive light) drawn on a 2D canvas.
 */
(() => {
  'use strict';

  // ---------- environment ----------
  const qs = new URLSearchParams(location.search);
  const DESKTOP = !!(window.desktop && window.desktop.isDesktop) || qs.has('desktop');
  if (DESKTOP) document.body.classList.add('desktop');
  const cvs = document.getElementById('scene');
  const ctx = cvs.getContext('2d');
  let W = 0, H = 0, DPR = 1, U = 1, floorY = 0;

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now() / 1000;

  // ---------- settings ----------
  const KEY = 'diwaliLantern.v1';
  const defaults = { lantern: 0, lights: 0, diya: 0, lanternScale: 1, diyaScale: 1.3, sound: true, sparklerAlways: false };
  let S = Object.assign({}, defaults);
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

  // ---------- colour helpers ----------
  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(h, f) { const [r, g, b] = hex2rgb(h); const c = (v) => clamp(Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f), 0, 255); return `rgb(${c(r)},${c(g)},${c(b)})`; }
  function rgba(h, a) { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; }

  // ---------- glow sprite cache ----------
  const glowCache = new Map();
  function glowSprite(color, size = 64) {
    const k = color + size;
    if (glowCache.has(k)) return glowCache.get(k);
    const c = document.createElement('canvas'); c.width = c.height = size * 2;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size, size, 0, size, size, size);
    gr.addColorStop(0, rgba(color, 0.95)); gr.addColorStop(0.18, rgba(color, 0.55));
    gr.addColorStop(0.45, rgba(color, 0.16)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, size * 2, size * 2);
    glowCache.set(k, c); return c;
  }
  function glow(x, y, r, color, a = 1) {
    if (a <= 0.01) return;
    ctx.globalAlpha = a; ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1;
  }

  // ---------- sound (synthesised, no files) ----------
  const Snd = (() => {
    let ac = null, noiseBuf = null, master = null;
    function init() {
      if (ac) return true;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
      return !!ac;
    }
    function noise(dur, type, freq, q, vol, attack = 0.002, sweepTo = 0) {
      if (!S.sound || !init()) return;
      const t = ac.currentTime, src = ac.createBufferSource(); src.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
    }
    function tone(freq, dur, vol, type = 'sine', to = 0) {
      if (!S.sound || !init()) return;
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    return {
      unlock() { if (init() && ac.state === 'suspended') ac.resume(); },
      tink() { tone(rand(1500, 1900), 0.12, 0.05); },
      click() { tone(rand(600, 760), 0.06, 0.04, 'triangle'); },
      pop() { noise(0.09, 'bandpass', rand(1400, 2600), 0.9, 0.5); },
      boom() { noise(1.1, 'lowpass', 900, 0.7, 1.0, 0.003, 120); tone(70, 0.6, 0.6, 'sine', 35); },
      whoosh() { noise(1.0, 'bandpass', 500, 1.5, 0.18, 0.15, 3000); },
      crackle() { noise(0.6, 'highpass', 4000, 0.5, 0.12); },
      hiss(d) { noise(d, 'highpass', 3000, 0.4, 0.07, 0.2); },
      puff() { noise(0.25, 'lowpass', 700, 0.5, 0.12, 0.01); },
      fizz() { noise(0.35, 'bandpass', 5000, 0.8, 0.08, 0.02); },
      snap() { noise(0.05, 'highpass', 2500, 0.6, 0.35); tone(220, 0.08, 0.08, 'triangle', 90); },
    };
  })();

  // ---------- verlet core ----------
  const GRAV = () => 0.32 * U;
  function P(x, y, im = 1) { return { x, y, px: x, py: y, im, pinned: false }; }
  function C(a, b, len, rope = false) { return { a, b, len, rope }; }
  function integrate(p, damp = 0.992, g = GRAV()) {
    if (p.pinned) return;
    const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
    p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + g;
  }
  function solve(c) {
    const a = c.a, b = c.b; const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1e-4;
    if (c.rope && d < c.len) return;
    const wa = a.pinned ? 0 : a.im, wb = b.pinned ? 0 : b.im, sum = wa + wb;
    if (!sum) return;
    const k = (d - c.len) / d / sum;
    a.x += dx * k * wa; a.y += dy * k * wa; b.x -= dx * k * wb; b.y -= dy * k * wb;
  }
  function collide(p, r, fric = 0.82, bounce = 0.28) {
    if (p.pinned) return;
    if (p.y > floorY - r) { const vy = p.y - p.py, vx = p.x - p.px; p.y = floorY - r; p.py = p.y + vy * bounce; p.px = p.x - vx * fric; }
    if (p.x < r) { const vx = p.x - p.px; p.x = r; p.px = p.x + vx * 0.4; }
    if (p.x > W - r) { const vx = p.x - p.px; p.x = W - r; p.px = p.x + vx * 0.4; }
  }

  // ---------- pointer state ----------
  const M = { x: -999, y: -999, vx: 0, vy: 0, lx: -999, ly: -999, inside: false, down: false, touch: false, hist: [] };

  // "hand touch": anything within reach takes on some of the pointer's motion and is pushed aside
  function handTouch(p, reach, strength = 0.55) {
    if (!M.inside || p.pinned) return;
    if (M.touch && !M.down) return;
    const dx = p.x - M.x, dy = p.y - M.y, d = Math.hypot(dx, dy);
    if (d > reach || d < 1e-3) return;
    const f = 1 - d / reach;
    const sp = Math.hypot(M.vx, M.vy);
    if (sp > 0.2) { p.x += clamp(M.vx, -40, 40) * f * strength; p.y += clamp(M.vy, -40, 40) * f * strength * 0.8; }
    const push = (reach * 0.35 - d); if (push > 0) { p.x += (dx / d) * push * 0.25; p.y += (dy / d) * push * 0.25; }
  }

  // ---------- particles ----------
  const parts = [];
  function addP(o) { if (parts.length < 2600) parts.push(Object.assign({ life: 0, max: 1, g: 0, drag: 0.98, size: 2, type: 'dot', color: '#ffd36b', add: true }, o)); }
  function sparkleBurst(x, y, n = 18) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(1.2, 4.2) * U;
      addP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6 * U, max: rand(0.45, 0.95), g: 0.06 * U, size: rand(1.4, 3.2) * U, type: Math.random() < 0.45 ? 'star' : 'spark', color: pick(['#fff3b0', '#ffd36b', '#ffb03a', '#ffffff', '#ffe08a']) });
    }
    addP({ x, y, vx: 0, vy: 0, max: 0.35, type: 'ring', size: 4 * U, color: '#ffe7a3' });
    addP({ x, y, vx: 0, vy: 0, max: 0.22, type: 'flash', size: 26 * U, color: '#ffd36b' });
  }
  function smoke(x, y, n, spread = 1, big = 1) {
    for (let i = 0; i < n; i++) addP({ x: x + rand(-4, 4) * U * spread, y, vx: rand(-0.3, 0.3) * U * spread, vy: rand(-0.9, -0.3) * U, max: rand(1.6, 3.2), g: -0.004 * U, drag: 0.985, size: rand(4, 9) * U * big, type: 'smoke', color: '#bfb8c8', add: false, seed: rand(0, 10) });
  }
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
      if (p.type === 'smoke') p.vx += Math.sin(p.life * 3 + p.seed) * 0.02 * U;
      p.ox = p.x; p.oy = p.y; p.x += p.vx; p.y += p.vy;
      if (p.floor && p.y > floorY - 1) { p.y = floorY - 1; p.vy *= -0.3; p.vx *= 0.6; }
      if (p.trail && Math.random() < p.trail) addP({ x: p.x, y: p.y, vx: 0, vy: 0, max: 0.35, size: p.size * 0.6, type: 'dot', color: p.color, g: 0.01 * U });
    }
  }
  function drawParts(additive) {
    for (const p of parts) {
      if (p.add !== additive) continue;
      const k = p.life / p.max, a = 1 - k;
      if (p.type === 'smoke') {
        ctx.globalAlpha = 0.22 * a * Math.min(1, p.life * 4);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k * 2.4), 0, TAU); ctx.fill();
      } else if (p.type === 'paper') {
        ctx.globalAlpha = Math.min(1, a * 2.5); ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * p.spin); ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size); ctx.restore();
      } else if (p.type === 'spark') {
        ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, p.size * 0.6);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
      } else if (p.type === 'star') {
        const s = p.size * (1.6 - k);
        ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x - s * 2, p.y); ctx.lineTo(p.x + s * 2, p.y); ctx.moveTo(p.x, p.y - s * 2); ctx.lineTo(p.x, p.y + s * 2); ctx.stroke();
        glow(p.x, p.y, s * 3, p.color, a * 0.8);
      } else if (p.type === 'ring') {
        ctx.globalAlpha = a * 0.7; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size + k * 26 * U, 0, TAU); ctx.stroke();
      } else if (p.type === 'flash') {
        glow(p.x, p.y, p.size * (1 + k), p.color, a);
      } else if (p.type === 'shock') {
        ctx.globalAlpha = a * 0.5; ctx.strokeStyle = p.color; ctx.lineWidth = 3 * U * a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, Math.PI, TAU); ctx.stroke();
      } else {
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ======================================================================
  // 3D MINI RENDERER (orthographic projection, painter's sort, Lambert + emission, affine textures)
  // ======================================================================
  const PITCH = 0.22; // we look up at a hanging kandil, so we see a little of its underside
  const LDIR = (() => { const v = [-0.45, -0.55, 0.7], l = Math.hypot(...v); return v.map((x) => x / l); })();
  const HV = (() => { const v = [LDIR[0], LDIR[1], LDIR[2] + 1], l = Math.hypot(...v); return v.map((x) => x / l); })();
  let seedR = 20261105;
  const srand = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
  const TEX = {};
  function mkTex(name, size, paint) { if (TEX[name]) return TEX[name]; const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size); return (TEX[name] = c); }
  function wrapDraw(n, x, y, r, fn) { for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) if (x + ox > -r && x + ox < n + r && y + oy > -r && y + oy < n + r) fn(x + ox, y + oy); }
  const TEXF = {
    paper: () => mkTex('paper', 128, (g, n) => { // paper fibres and grain
      for (let i = 0; i < 700; i++) {
        const x = srand() * n, y = srand() * n, l = 4 + srand() * 12, a = srand() * Math.PI, light = srand() < 0.5;
        g.strokeStyle = light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'; g.lineWidth = 0.5 + srand() * 0.6;
        wrapDraw(n, x, y, l, (px, py) => { g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(a + 0.4) * l * 0.5, py + Math.sin(a + 0.4) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
      }
      for (let i = 0; i < 3000; i++) { g.fillStyle = srand() < 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'; g.fillRect(srand() * n, srand() * n, 1, 1); }
    }),
    foam: () => mkTex('foam', 64, (g, n) => { // expanded polystyrene (thermacol) beads
      g.fillStyle = 'rgba(110,110,110,0.35)'; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 230; i++) {
        const x = srand() * n, y = srand() * n, r = 2.2 + srand() * 2.8;
        wrapDraw(n, x, y, r, (px, py) => { const gr = g.createRadialGradient(px - r * 0.35, py - r * 0.35, 0, px, py, r); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.75, 'rgba(235,235,235,0.5)'); gr.addColorStop(1, 'rgba(100,100,100,0.6)'); g.fillStyle = gr; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); });
      }
    }),
    clay: () => mkTex('clay', 96, (g, n) => { // fired clay grain
      for (let i = 0; i < 3200; i++) { const v = srand(); g.fillStyle = v < 0.55 ? `rgba(40,10,0,${0.12 + v * 0.35})` : `rgba(255,215,170,${(v - 0.55) * 0.5})`; const sz = srand() < 0.88 ? 1 : 2; g.fillRect(srand() * n, srand() * n, sz, sz); }
      for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(60,20,5,0.25)'; g.lineWidth = 0.6; const x = srand() * n, y = srand() * n; g.beginPath(); g.moveTo(x, y); g.lineTo(x + srand() * 14 - 7, y + srand() * 3); g.stroke(); }
    }),
  };
  const patCache = new WeakMap();
  function pat(g, name) { let m = patCache.get(g); if (!m) patCache.set(g, (m = {})); return m[name] || (m[name] = g.createPattern(TEXF[name](), 'repeat')); }
  function mixHex(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b), h = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'); return '#' + h(lerp(A[0], B[0], t)) + h(lerp(A[1], B[1], t)) + h(lerp(A[2], B[2], t)); }

  function V3(md, x, y, z) { md.verts.push([x, y, z]); return md.verts.length - 1; }
  function F3(md, v, o) { md.faces.push(Object.assign({ v }, o)); }
  function finalize(md) {
    const c = md.center, P = md.verts;
    for (const f of md.faces) {
      const a = P[f.v[0]], b = P[f.v[1]], d = P[f.v[2]];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let cx = 0, cy = 0, cz = 0; for (const i of f.v) { cx += P[i][0]; cy += P[i][1]; cz += P[i][2]; }
      cx /= f.v.length; cy /= f.v.length; cz /= f.v.length;
      const ref = f.out || [cx - c[0], cy - c[1], cz - c[2]];
      f.sg = n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] >= 0 ? 1 : -1;
      // planar texture coordinates (in model units) so textures and decals stick to the surface
      const l1 = Math.hypot(...e1) || 1, u1 = e1.map((x) => x / l1), nl = Math.hypot(...n) || 1, nn = n.map((x) => x / nl);
      const u2 = [nn[1] * u1[2] - nn[2] * u1[1], nn[2] * u1[0] - nn[0] * u1[2], nn[0] * u1[1] - nn[1] * u1[0]];
      f.t = f.v.map((i) => { const p = P[i], w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; return [w[0] * u1[0] + w[1] * u1[1] + w[2] * u1[2], w[0] * u2[0] + w[1] * u2[1] + w[2] * u2[2]]; });
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of f.t) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      f.tb = [x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4];
      f.tc = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (f.decals) for (const dc of f.decals) dc.p = dc.bary ? [dc.bary.reduce((s, w, k) => s + w * f.t[k][0], 0), dc.bary.reduce((s, w, k) => s + w * f.t[k][1], 0)] : f.tc;
      if (f.glitter) f.gl = Array.from({ length: 4 }, () => [srand(), srand(), srand() * TAU]);
    }
    return md;
  }
  function rotP(v, cyw, syw, cp, sp, c) { const x = v[0] - c[0], y = v[1] - c[1], z = v[2] - c[2], x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw; return [x1 + c[0], y * cp - z1 * sp + c[1], y * sp + z1 * cp]; }
  function facePath(g, P, f) { const v = f.v; g.beginPath(); g.moveTo(P[v[0]][0], P[v[0]][1]); for (let i = 1; i < v.length; i++) g.lineTo(P[v[i]][0], P[v[i]][1]); g.closePath(); }
  function texAffine(g, P, f) {
    const [i0, i1, i2] = f.v, [u0, v0] = f.t[0], [ua, va] = f.t[1], [ub, vb] = f.t[2];
    const du1 = ua - u0, dv1 = va - v0, du2 = ub - u0, dv2 = vb - v0, det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-6) return false;
    const x0 = P[i0][0], y0 = P[i0][1], dx1 = P[i1][0] - x0, dy1 = P[i1][1] - y0, dx2 = P[i2][0] - x0, dy2 = P[i2][1] - y0;
    const a = (dx1 * dv2 - dx2 * dv1) / det, c = (dx2 * du1 - dx1 * du2) / det, b = (dy1 * dv2 - dy2 * dv1) / det, d = (dy2 * du1 - dy1 * du2) / det;
    if (Math.abs(a * d - b * c) < 1e-4) return false;
    g.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
    return true;
  }
  function faceColor(f, n, lvl, flick) {
    const lam = Math.max(0, n[0] * LDIR[0] + n[1] * LDIR[1] + n[2] * LDIR[2]), front = n[2] > 0;
    const spec = (p) => Math.pow(Math.max(0, n[0] * HV[0] + n[1] * HV[1] + n[2] * HV[2]), p);
    switch (f.mat) {
      case 'tpaper': { // translucent coloured paper, lit from inside
        const ext = front ? 0.25 + 0.6 * lam : 0.16, em = lvl * flick * (front ? 0.6 + 0.48 * n[2] : 0.95);
        return shade(f.col, ext * (1 - 0.55 * lvl) + em);
      }
      case 'foam': { // matte thermacol, faintly glowing when the bulb is on
        const base = lvl > 0.01 ? mixHex(f.col, '#ffe2b0', 0.42 * lvl) : f.col;
        return shade(base, 0.48 + 0.58 * lam + 0.2 * lvl * flick);
      }
      case 'foil': return shade(f.col, 0.42 + 0.5 * lam + 1.2 * spec(14) + 0.2 * lvl);
      case 'gpaper': { // opaque-ish paper: brightest where it faces us, like a real paper globe
        const ext = 0.28 + 0.5 * lam, em = lvl * flick * (0.22 + 0.95 * Math.pow(Math.max(0, n[2]), 1.6));
        return shade(f.col, ext * (1 - 0.5 * lvl) + em);
      }
      case 'gold': return shade(f.col, 0.4 + 0.55 * lam + 0.9 * spec(10) + 0.15 * lvl);
      default: return shade(f.col, 0.3 + 0.6 * lam + 0.1 * lvl);
    }
  }
  function drawDecal(g, f, dc, lvl, flick, alpha) {
    const [x, y] = dc.p, r = dc.r;
    if (dc.shape === 'diamond') {
      g.globalAlpha = alpha * 0.85; g.fillStyle = faceColor({ mat: 'tpaper', col: dc.col }, [0, 0, 1], lvl, flick);
      g.beginPath(); g.moveTo(x, y - r * 1.45); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.45); g.lineTo(x - r, y); g.closePath(); g.fill();
    } else if (dc.shape === 'hole') { // a cut-out showing the bulb inside
      g.globalAlpha = alpha; g.fillStyle = lvl > 0.02 ? shade('#ffd06a', 0.65 + 0.6 * lvl * flick) : '#3b2e24';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(80,60,40,0.45)'; g.lineWidth = r * 0.25; g.stroke();
      if (lvl > 0.05) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * 0.8; g.drawImage(glowSprite('#ffc860'), x - r * 3, y - r * 3, r * 6, r * 6); g.restore(); }
    } else if (dc.shape === 'dot') {
      g.globalAlpha = alpha; g.fillStyle = faceColor({ mat: 'gpaper', col: dc.col }, [0, 0, 1], lvl, flick);
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.globalAlpha = alpha;
  }
  function drawModel(g, md, yaw, lvl, t, light) {
    const c = md.center, cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const P = md.verts.map((v) => rotP(v, cyw, syw, cp, sp, c));
    const flick = 1 + Math.sin(t * 9.1) * 0.03 + Math.sin(t * 13.7) * 0.02;
    const list = [];
    for (const f of md.faces) {
      const a = P[f.v[0]], b = P[f.v[1]], d = P[f.v[2]];
      let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      const nl = (Math.hypot(nx, ny, nz) || 1) * f.sg; nx /= nl; ny /= nl; nz /= nl;
      if (!md.translucent && nz <= 0.001) continue; // opaque: back-face culling
      let z = 0; for (const i of f.v) z += P[i][2];
      list.push({ f, n: [nx, ny, nz], z: z / f.v.length + (f.zb || 0) * md.u });
    }
    list.sort((p, q) => p.z - q.z);
    const drawFace = (it, alpha) => {
      const f = it.f, n = it.n;
      g.globalAlpha = alpha; g.fillStyle = faceColor(f, n, lvl, flick);
      facePath(g, P, f); g.fill();
      if (md.seam) { g.strokeStyle = g.fillStyle; g.lineWidth = 0.9; g.stroke(); }
      if (f.tex || f.decals) {
        g.save(); facePath(g, P, f); g.clip();
        if (texAffine(g, P, f)) {
          if (f.tex) { g.globalAlpha = alpha * f.texA; g.fillStyle = pat(g, f.tex); g.fillRect(f.tb[0], f.tb[1], f.tb[2], f.tb[3]); }
          if (f.decals && n[2] > -0.05) for (const dc of f.decals) drawDecal(g, f, dc, lvl, flick, alpha);
        }
        g.restore();
      }
      if (f.glitter) { // foil glitter catching the light
        const A = P[f.v[0]], B = P[f.v[1]], C2 = P[f.v[2]];
        g.save(); g.globalCompositeOperation = 'lighter';
        for (const [p, q, ph] of f.gl) {
          const s = Math.pow(Math.max(0, Math.sin(t * 3.1 + ph)), 10); if (s < 0.05) continue;
          const x = A[0] + (B[0] - A[0]) * p + (C2[0] - B[0]) * q * p, y = A[1] + (B[1] - A[1]) * p + (C2[1] - B[1]) * q * p;
          g.globalAlpha = s; g.drawImage(glowSprite('#fff6d0'), x - 4 * md.u, y - 4 * md.u, 8 * md.u, 8 * md.u);
        }
        g.restore();
      }
      if (f.edge) {
        g.globalAlpha = alpha * (n[2] > 0 ? 1 : 0.55); g.strokeStyle = f.edge; g.lineWidth = f.edgeW || 1.2 * md.u; g.lineJoin = 'round';
        if (f.edgeSeg) { g.beginPath(); g.moveTo(P[f.edgeSeg[0]][0], P[f.edgeSeg[0]][1]); g.lineTo(P[f.edgeSeg[1]][0], P[f.edgeSeg[1]][1]); g.stroke(); }
        else { facePath(g, P, f); g.stroke(); }
      }
      g.globalAlpha = 1;
    };
    if (md.translucent) {
      for (const it of list) if (it.n[2] <= 0) drawFace(it, 0.97); // inside surfaces, seen through the paper
      if (lvl > 0.01 && light) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * flick * 0.9; const r = md.glowR * 0.6; g.drawImage(glowSprite('#fff2c8'), c[0] - r * 0.4, c[1] - r * 0.4, r * 0.8, r * 0.8); g.drawImage(glowSprite(light), c[0] - r, c[1] - r, r * 2, r * 2); g.restore(); }
      for (const it of list) if (it.n[2] > 0) drawFace(it, lvl > 0.01 ? 0.8 - 0.12 * lvl : 0.93);
    } else for (const it of list) drawFace(it, 1);
    return P;
  }

  // ======================================================================
  // LANTERN (kandil) - three 3D models
  // ======================================================================
  const LANTERN_STYLES = [
    { name: 'Akash Kandil', light: '#ffb347' },
    { name: 'Star Kandil', light: '#ffc870' },
    { name: 'Paper Globe', light: '#ffa04a' },
  ];
  // Akash kandil: hexagonal bamboo frame covered with translucent coloured paper, with paper frills
  function akashModel(u) {
    const md = { verts: [], faces: [], translucent: true }, N = 6, W = 122 * u, H = 180 * u, R = W / 2;
    const y1 = 12 * u, y2 = H * 0.3, y3 = H * 0.64, y4 = H * 0.9, a0 = Math.PI / 6;
    md.center = [0, (y2 + y3) / 2, 0]; md.w = W; md.h = y4 + 2 * u; md.glowR = W * 1.05; md.hookY = y1;
    const ring = (r, y) => { const ids = []; for (let i = 0; i < N; i++) { const a = a0 + i * TAU / N; ids.push(V3(md, Math.cos(a) * r, y, Math.sin(a) * r)); } return ids; };
    const r1 = ring(R * 0.24, y1), r2 = ring(R, y2), r3 = ring(R, y3), r4 = ring(R * 0.16, y4);
    const pal = ['#ff2b2b', '#ffc400', '#ff2e93', '#ff7300', '#1fbf62', '#2f8cff'], bamboo = '#6a4422';
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      F3(md, [r1[i], r1[j], r2[j], r2[i]], { mat: 'tpaper', col: pal[(i + 3) % N], tex: 'paper', texA: 0.22, edge: bamboo });
      F3(md, [r2[i], r2[j], r3[j], r3[i]], { mat: 'tpaper', col: pal[i], tex: 'paper', texA: 0.22, edge: bamboo, decals: [{ shape: 'diamond', r: 14 * u, col: pal[(i + 2) % N] }, { shape: 'diamond', r: 5.5 * u, col: '#fff1a8' }] });
      F3(md, [r3[i], r3[j], r4[j], r4[i]], { mat: 'tpaper', col: pal[(i + 3) % N], tex: 'paper', texA: 0.22, edge: bamboo });
    }
    F3(md, [...r1], { mat: 'gold', col: '#e0b040', out: [0, -1, 0] });
    F3(md, [...r4], { mat: 'gold', col: '#e0b040', out: [0, 1, 0] });
    const frill = (ids, y, drop, len, col) => {
      for (let i = 0; i < N; i++) {
        const A = md.verts[ids[i]], B = md.verts[ids[(i + 1) % N]];
        for (let k = 0; k < 4; k++) {
          const f0 = k / 4, f1 = (k + 1) / 4, fm = (f0 + f1) / 2, pm = [lerp(A[0], B[0], fm), y, lerp(A[2], B[2], fm)], ol = Math.hypot(pm[0], pm[2]) || 1;
          F3(md, [V3(md, lerp(A[0], B[0], f0), y, lerp(A[2], B[2], f0)), V3(md, lerp(A[0], B[0], f1), y, lerp(A[2], B[2], f1)), V3(md, pm[0] + pm[0] / ol * len * 0.55, y + drop, pm[2] + pm[2] / ol * len * 0.55)],
            { mat: 'tpaper', col, out: [pm[0], 0, pm[2]], zb: 0.6 });
        }
      }
    };
    frill(r2, y2, 8 * u, 10 * u, '#ffd23f');
    frill(r3, y3, 13 * u, 12 * u, '#ffd23f');
    return md;
  }
  // Star kandil: carved thermacol (expanded polystyrene) star with foil-wrapped edges and cut-outs
  function starModel(u) {
    const md = { verts: [], faces: [], translucent: false }, R = 80 * u, r = 35 * u, cy = 16 * u + R, t = 7 * u, d = 22 * u;
    md.center = [0, cy, 0]; md.w = R * 2; md.h = cy + R * 0.82; md.glowR = R * 1.5; md.hookY = cy - R;
    const oF = [], oB = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; oF.push(V3(md, Math.cos(a) * rr, cy + Math.sin(a) * rr, t)); oB.push(V3(md, Math.cos(a) * rr, cy + Math.sin(a) * rr, -t)); }
    const aF = V3(md, 0, cy, t + d), aB = V3(md, 0, cy, -t - d), foil = ['#e8b02a', '#d7263d'];
    for (let i = 0; i < 10; i++) {
      const j = (i + 1) % 10, tipAt1 = i % 2 === 0;
      const holes = [{ shape: 'hole', bary: [0.3, 0.35, 0.35], r: 3.6 * u }, { shape: 'hole', bary: tipAt1 ? [0.12, 0.7, 0.18] : [0.12, 0.18, 0.7], r: 2.3 * u }, { shape: 'hole', bary: [0.66, 0.17, 0.17], r: 2 * u }];
      F3(md, [aF, oF[i], oF[j]], { mat: 'foam', col: '#f4f1ea', tex: 'foam', texA: 0.6, decals: holes, edge: 'rgba(150,140,125,0.4)', edgeW: 0.7 * u });
      F3(md, [aB, oB[j], oB[i]], { mat: 'foam', col: '#f4f1ea', tex: 'foam', texA: 0.6 });
      F3(md, [oF[i], oB[i], oB[j], oF[j]], { mat: 'foil', col: foil[i % 2], glitter: true });
    }
    return md;
  }
  // Paper globe: pleated paper lantern on wire rings, with a painted band and lacquered card caps
  function globeModel(u) {
    const md = { verts: [], faces: [], translucent: false, seam: true }, R = 64 * u, ry = R * 0.9, cy = 22 * u + ry;
    md.center = [0, cy, 0]; md.w = R * 2; md.R = R; md.ry = ry; md.glowR = R * 1.9;
    const nLat = 14, nLon = 22, lat1 = 1.2, grid = [];
    for (let k = 0; k <= nLat; k++) {
      const ph = lerp(lat1, -lat1, k / nLat), pleat = k % 2 ? 0.965 : 1, rr = R * Math.cos(ph) * pleat, y = cy - ry * Math.sin(ph), row = [];
      for (let i = 0; i < nLon; i++) { const a = i * TAU / nLon; row.push(V3(md, Math.cos(a) * rr, y, Math.sin(a) * rr)); }
      grid.push(row);
    }
    for (let k = 0; k < nLat; k++) for (let i = 0; i < nLon; i++) {
      const j = (i + 1) % nLon, eq = k === 6 || k === 7;
      F3(md, [grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]], {
        mat: 'gpaper', col: eq ? '#f0b232' : '#d8262d', edge: 'rgba(80,12,10,0.5)', edgeW: 0.9 * u, edgeSeg: [grid[k][i], grid[k][j]],
        decals: eq && i % 2 === 0 ? [{ shape: 'dot', r: 2.8 * u, col: '#b3121e' }] : null,
      });
    }
    const yT = cy - ry * Math.sin(lat1), yB = cy + ry * Math.sin(lat1), rc = R * Math.cos(lat1) * 1.04;
    const cap = (ya, yb, top) => {
      const a = [], b = [];
      for (let i = 0; i < nLon; i += 2) { const an = i * TAU / nLon; a.push(V3(md, Math.cos(an) * rc, ya, Math.sin(an) * rc)); b.push(V3(md, Math.cos(an) * rc, yb, Math.sin(an) * rc)); }
      for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; F3(md, [a[i], a[j], b[j], b[i]], { mat: 'card', col: '#2a1c14', out: [md.verts[a[i]][0], 0, md.verts[a[i]][2]] }); }
      F3(md, top ? a : b, { mat: 'gold', col: '#c99a2e', out: [0, top ? -1 : 1, 0] });
    };
    cap(yT - 5 * u, yT + 2 * u, true);
    cap(yB - 2 * u, yB + 6 * u, false);
    md.hookY = yT - 5 * u; md.h = yB + 6 * u;
    return md;
  }
  const modelCache = new Map();
  function lanternModel(style, u) {
    u = Math.round(u * 200) / 200;
    const key = style + ':' + u; if (modelCache.has(key)) return modelCache.get(key);
    if (modelCache.size > 30) modelCache.clear();
    const md = [akashModel, starModel, globeModel][style](u); md.u = u; finalize(md); modelCache.set(key, md); return md;
  }
  function drawLanternModel(g, style, md, yaw, lvl, t) {
    const st = LANTERN_STYLES[style], u = md.u, c = md.center, flick = 1 + Math.sin(t * 9.1) * 0.03 + Math.sin(t * 13.7) * 0.02;
    g.strokeStyle = '#8c7a5a'; g.lineWidth = 1.4 * u; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, md.hookY); g.stroke();
    g.beginPath(); g.arc(0, 2.5 * u, 2.5 * u, 0, TAU); g.stroke();
    if (!md.translucent && lvl > 0.01) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * flick * (style === 1 ? 0.75 : 0.5); const r = md.glowR; g.drawImage(glowSprite(st.light), c[0] - r, c[1] - r, r * 2, r * 2); g.restore(); }
    drawModel(g, md, yaw, lvl, t, st.light);
    if (style === 2) { // paper grain over the globe
      g.save(); g.beginPath(); g.ellipse(c[0], c[1], md.R * 0.99, md.ry * 1.0, 0, 0, TAU); g.clip();
      g.globalAlpha = 0.16; g.fillStyle = pat(g, 'paper'); g.fillRect(c[0] - md.R, c[1] - md.ry, md.R * 2, md.ry * 2); g.restore();
    }
    if (lvl > 0.01) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * flick * (md.translucent ? 0.42 : 0.3); const r = md.glowR * 1.15; g.drawImage(glowSprite(st.light), c[0] - r, c[1] - r, r * 2, r * 2); g.restore(); }
  }

  let lantern = null;
  function lanternScaleMax(style, ropeLen) {
    const md1 = lanternModel(style, U);
    return Math.max(0.5, Math.min(2.6, (floorY - 24 * U - ropeLen) / md1.h, (W * 0.85) / md1.w));
  }
  function buildLantern() {
    const style = S.lantern, ropeLen = clamp(H * 0.17, 50 * U, 220 * U);
    const sc = clamp(S.lanternScale || 1, 0.5, lanternScaleMax(style, ropeLen));
    const md = lanternModel(style, U * sc), D = { w: md.w, h: md.h };
    const ax = clamp(W * (W < 700 ? 0.5 : 0.24), D.w * 0.7, W - D.w * 0.7);
    const n = 10, seg = ropeLen / n;
    const rope = []; for (let i = 0; i <= n; i++) rope.push(P(ax, i * seg, 1));
    rope[0].pinned = true;
    const top = P(ax, ropeLen + 2, 0.14), bot = P(ax, ropeLen + D.h, 0.14);
    const cons = []; for (let i = 0; i < n; i++) cons.push(C(rope[i], rope[i + 1], seg, true));
    cons.push(C(rope[n], top, 2, true));
    const body = C(top, bot, D.h);
    lantern = { style, sc, md, D, rope, top, bot, cons, body, attached: true, on: true, lvl: 1, ropeLen, drag: null, yaw: 0.45, yawV: 0.006 };
  }
  function setLanternScale(sc) {
    const L = lantern; if (!L) return;
    sc = clamp(sc, 0.5, lanternScaleMax(L.style, L.ropeLen));
    L.sc = sc; S.lanternScale = sc; L.md = lanternModel(L.style, U * sc); L.D = { w: L.md.w, h: L.md.h }; L.body.len = L.D.h;
  }
  function lanternFrame(L) {
    const dx = L.bot.x - L.top.x, dy = L.bot.y - L.top.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    return { ux, uy, ang: Math.atan2(-ux, uy), toWorld: (lx, ly) => [L.top.x + lx * uy + ly * ux, L.top.y - lx * ux + ly * uy], toLocal: (x, y) => { const rx = x - L.top.x, ry = y - L.top.y; return [rx * uy - ry * ux, rx * ux + ry * uy]; } };
  }
  function lanternHit(x, y) {
    const L = lantern; if (!L) return false;
    const F = lanternFrame(L), [lx, ly] = F.toLocal(x, y);
    return Math.abs(lx) < L.D.w * 0.5 && ly > L.md.hookY - 4 * U && ly < L.D.h + 2 * U;
  }
  function lanternBox() { // screen-space box around the kandil (for the resize handle)
    const L = lantern, F = lanternFrame(L), w = L.D.w * 0.52, pad = 6;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [lx, ly] of [[-w, L.md.hookY], [w, L.md.hookY], [w, L.D.h], [-w, L.D.h]]) { const [x, y] = F.toWorld(lx, ly); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, hx: x1 + pad, hy: y1 + pad };
  }
  function distSeg(px, py, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, wx = px - a.x, wy = py - a.y;
    const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1), 0, 1);
    return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
  }
  function snapLantern(why) {
    const L = lantern; if (!L || !L.attached) return;
    L.attached = false;
    L.cons = L.cons.filter((c) => c.b !== L.top);
    Snd.snap();
    for (let i = 0; i < 8; i++) addP({ x: L.top.x, y: L.top.y, vx: rand(-2, 2) * U, vy: rand(-2, 1) * U, max: 0.5, size: 1.5 * U, type: 'spark', color: '#fff2c0', g: 0.1 * U });
    if (why) showHint(why, 2200);
  }

  function updateLantern() {
    const L = lantern; if (!L) return;
    L.lvl = lerp(L.lvl, L.on ? 1 : 0, 0.12);
    for (const p of L.rope) { integrate(p, 0.985); handTouch(p, 26 * U, 0.4); }
    if (!L.drag) { integrate(L.top, 0.996); integrate(L.bot, 0.996); }
    else {
      integrate(L.bot, 0.99);
      let tx = M.x - L.drag.ox, ty = M.y - L.drag.oy;
      if (L.attached) {
        // the cord is taut: the kandil can only travel on an arc, unless it is yanked hard enough to pluck
        const ax = L.rope[0].x, ay = L.rope[0].y, dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy) || 1, maxR = L.ropeLen * 1.05, over = d - maxR;
        const downward = dy > L.ropeLen * 0.9 && Math.abs(dx) < dy * 0.9;
        if ((downward && over > L.ropeLen * 0.55) || over > L.ropeLen * 3.2) snapLantern('Plucked! It falls to the floor.');
        else if (over > 0) { tx = ax + dx / d * (maxR + over * 0.08); ty = ay + dy / d * (maxR + over * 0.08); if (over > L.ropeLen * 0.3 && !L.drag.hinted) { L.drag.hinted = true; showHint('Pull straight down harder to pluck the kandil.', 1800); } }
      }
      L.drag.tx = tx; L.drag.ty = ty;
      L.top.px = L.top.x; L.top.py = L.top.y; L.top.x = tx; L.top.y = ty;
    }
    if (!L.drag && L.attached) handTouch(L.bot, L.D.w * 0.45, 0.06);
    for (let it = 0; it < 14; it++) {
      solve(L.body); for (const c of L.cons) solve(c);
      if (L.drag && L.drag.tx !== undefined) { L.top.x = L.drag.tx; L.top.y = L.drag.ty; }
      const r = L.D.w * 0.5; collide(L.top, r * (L.attached ? 0.6 : 0.9)); collide(L.bot, r);
    }
    for (const p of L.rope) collide(p, 1);
    // torsion: the kandil twists slowly on its cord; swings and a brushing hand set it turning
    const vxb = L.bot.x - L.bot.px, onFloor = L.bot.y > floorY - L.D.w * 0.55;
    L.yawV += -0.0004 * (L.yaw - 0.45) + vxb * 0.00022 + Math.sin(now() * 0.37) * 0.00003;
    if (M.inside && !L.drag && !(M.touch && !M.down) && lanternHit(M.x, M.y)) L.yawV += clamp(M.vx, -30, 30) * 0.0005;
    L.yawV *= onFloor && !L.attached ? 0.9 : 0.995;
    L.yaw += L.yawV;
  }

  function drawRope(pts, color, w) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  function drawLantern(t) {
    const L = lantern; if (!L) return;
    drawRope(L.rope, 'rgba(220,200,160,0.9)', 1.6 * U);
    if (L.attached) drawRope([L.rope[L.rope.length - 1], L.top], 'rgba(220,200,160,0.9)', 1.6 * U);
    const F = lanternFrame(L);
    ctx.save(); ctx.translate(L.top.x, L.top.y); ctx.rotate(F.ang); drawLanternModel(ctx, L.style, L.md, L.yaw, L.lvl, t); ctx.restore();
    if (L.lvl > 0.05 && !DESKTOP) { const [cx] = F.toWorld(0, L.D.h * 0.5); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.18 * L.lvl; ctx.drawImage(glowSprite(LANTERN_STYLES[L.style].light), cx - 200 * U, floorY - 30 * U, 400 * U, 60 * U); ctx.restore(); }
  }
  // ======================================================================
  // STRING LIGHTS (laddi / jhalar)
  // ======================================================================
  const LIGHT_STYLES = [
    { name: 'Rangoli Mini Bulbs', wire: '#1f4d2b', colors: ['#ff2a2a', '#22d34a', '#2f7bff', '#ffd400', '#ff3dd6', '#ff8a00'] },
    { name: 'Warm Fairy LEDs', wire: '#b07a3a', colors: ['#ffd9a0', '#ffe7bf', '#ffcf86'] },
    { name: 'Twinkle Stars', wire: '#d8d0e8', colors: ['#ff5e5e', '#ffd34d', '#6bff95', '#5ec8ff', '#c77dff'] },
  ];
  let lights = null;
  function buildLights() {
    const style = S.lights, st = LIGHT_STYLES[style];
    const spans = Math.max(2, Math.round(W / 430));
    const perSpan = clamp(Math.round(W / spans / (style === 1 ? 26 : 34) / U), 8, 22);
    const pts = [], cons = [], bulbs = [];
    const prev = lights; const prevOn = prev ? prev.bulbs.map((b) => b.on) : null;
    for (let s = 0; s < spans; s++) {
      const x0 = 2 + s * (W - 4) / spans, x1 = 2 + (s + 1) * (W - 4) / spans, span = x1 - x0;
      const sag = clamp(span * 0.09, 22 * U, 64 * U);
      for (let i = s === 0 ? 0 : 1; i <= perSpan; i++) {
        const f = i / perSpan, x = lerp(x0, x1, f), y = 4 + 4 * sag * f * (1 - f);
        const p = P(x, y, 1); if (i === 0 || i === perSpan) p.pinned = true; pts.push(p);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) cons.push(C(pts[i], pts[i + 1], Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) * 1.0, true));
    let bi = 0;
    pts.forEach((p, i) => {
      if (p.pinned) return;
      const b = P(p.x, p.y + 8 * U, 0.9); cons.push(C(p, b, (style === 1 ? 5 : 8) * U));
      bulbs.push({ p, b, on: prevOn && bi < prevOn.length ? prevOn[bi] : true, lvl: 1, color: st.colors[bi % st.colors.length], phase: rand(0, TAU), idx: bi, tw: rand(0.6, 1.6) });
      bi++;
    });
    lights = { style, pts, cons, bulbs };
  }
  function updateLights() {
    const Lg = lights;
    for (const p of Lg.pts) { integrate(p, 0.985); handTouch(p, 40 * U, 0.55); }
    for (const b of Lg.bulbs) { integrate(b.b, 0.985); handTouch(b.b, 30 * U, 0.6); }
    for (let it = 0; it < 10; it++) for (const c of Lg.cons) solve(c);
  }
  function drawBulb(g, style, x, y, ang, color, lvl, u, t, phase) {
    g.save(); g.translate(x, y); g.rotate(ang);
    if (style === 0) {
      g.fillStyle = '#1f4d2b'; g.fillRect(-2.2 * u, -2 * u, 4.4 * u, 5 * u);
      g.fillStyle = lvl > 0.05 ? shade(color, 0.7 + 0.5 * lvl) : shade(color, 0.35);
      g.beginPath(); g.moveTo(-2.6 * u, 3 * u); g.quadraticCurveTo(-3.6 * u, 9 * u, 0, 13 * u); g.quadraticCurveTo(3.6 * u, 9 * u, 2.6 * u, 3 * u); g.closePath(); g.fill();
      if (lvl > 0.05) { g.fillStyle = `rgba(255,255,255,${0.55 * lvl})`; g.beginPath(); g.ellipse(-0.8 * u, 7 * u, 0.8 * u, 2.4 * u, 0, 0, TAU); g.fill(); }
    } else if (style === 1) {
      g.fillStyle = lvl > 0.05 ? shade(color, 0.8 + 0.4 * lvl) : '#6b5a44';
      g.beginPath(); g.arc(0, 2 * u, 2.3 * u, 0, TAU); g.fill();
    } else {
      const r = 6 * u, rr = 2.6 * u; g.translate(0, 6 * u); g.rotate(Math.sin(t + phase) * 0.2);
      g.fillStyle = lvl > 0.05 ? shade(color, 0.75 + 0.45 * lvl) : shade(color, 0.3);
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? rr : r; i ? g.lineTo(Math.cos(a) * q, Math.sin(a) * q) : g.moveTo(Math.cos(a) * q, Math.sin(a) * q); } g.closePath(); g.fill();
    }
    g.restore();
  }
  function bulbLevel(b, style, t) {
    if (!b.on) return 0;
    if (style === 0) { const chase = 0.62 + 0.38 * Math.sin(t * 3.2 - b.idx * 0.9); return chase; }
    if (style === 1) { return 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(t * b.tw * 2.2 + b.phase), 2); }
    return 0.5 + 0.5 * Math.sin(t * 1.4 * b.tw + b.phase);
  }
  function drawLights(t) {
    const Lg = lights, st = LIGHT_STYLES[Lg.style];
    ctx.strokeStyle = st.wire; ctx.lineWidth = (Lg.style === 1 ? 1 : 1.8) * U; ctx.lineCap = 'round';
    ctx.beginPath(); Lg.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    for (const b of Lg.bulbs) {
      b.lvl = lerp(b.lvl, bulbLevel(b, Lg.style, t), 0.25);
      let color = b.color;
      if (Lg.style === 2 && b.on) { const hue = Math.round(((t * 20 + b.idx * 23) % 360) / 12) * 12 % 360; color = hslHex(hue); }
      b.cur = color;
      ctx.strokeStyle = st.wire; ctx.lineWidth = 1 * U; ctx.beginPath(); ctx.moveTo(b.p.x, b.p.y); ctx.lineTo(b.b.x, b.b.y); ctx.stroke();
      const ang = Math.atan2(-(b.b.x - b.p.x), b.b.y - b.p.y);
      drawBulb(ctx, Lg.style, b.b.x, b.b.y, ang, color, b.lvl, U, t, b.phase);
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const b of Lg.bulbs) {
      if (b.lvl < 0.03) continue;
      const off = Lg.style === 0 ? 8 : Lg.style === 2 ? 6 : 2;
      const ang = Math.atan2(-(b.b.x - b.p.x), b.b.y - b.p.y);
      const gx = b.b.x - Math.sin(ang) * off * U, gy = b.b.y + Math.cos(ang) * off * U;
      glow(gx, gy, (Lg.style === 1 ? 16 : 24) * U, b.cur, b.lvl * 0.85);
    }
    ctx.restore();
  }
  function hslHex(h) { const s = 0.9, l = 0.6, k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0'); return '#' + to(f(0)) + to(f(8)) + to(f(4)); }

  // ======================================================================
  // DIYA (clay lamp) - drawn in 3/4 view with the spout and flame facing the viewer
  // ======================================================================
  const DIYA_STYLES = [{ name: 'Classic Terracotta' }, { name: 'Painted Diya' }, { name: 'Lotus Diya' }];
  const DIYA_H = [39, 39, 46]; // body height in diya units (hit box / resize handle)
  let diya = null;
  const dS = () => U * (S.diyaScale || 1);
  function buildDiya() {
    const s = dS(), x = diya ? clamp(diya.x, 44 * s, W - 44 * s) : W - 72 * s - (DESKTOP ? 30 : 0);
    diya = { x, lit: diya ? diya.lit : true, lvl: diya ? diya.lvl : 1, lean: 0, wind: 0, drag: null, vx: 0, smoke: [], emit: 0, ember: 0, newRib: false };
  }
  function diyaWick(style, s) { return style === 2 ? [0, -33 * s] : [0, -11 * s]; }
  function diyaBox() { const s = dS(), hh = DIYA_H[S.diya] * s, pad = 6; return { x0: diya.x - 43 * s - pad, x1: diya.x + 43 * s + pad, y0: floorY - hh - pad, y1: floorY + 2, hx: diya.x + 43 * s + pad, hy: floorY - hh - pad }; }
  function diyaHit(x, y) { if (!diya) return false; const b = diyaBox(); return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 + 4; }
  function setDiyaScale(sc) { S.diyaScale = clamp(sc, 0.5, Math.min(3, H * 0.35 / (DIYA_H[S.diya] * U))); const s = dS(); diya.x = clamp(diya.x, 44 * s, W - 44 * s); }

  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); }
  const CLAY = [
    { lit: '#d8834a', mid: '#b05628', dark: '#56220c', lip1: '#dc8d55', lip2: '#7a3414', inner: '#6a2a10' },
    { lit: '#e2493a', mid: '#b4241c', dark: '#560c08', lip1: '#f6cf5c', lip2: '#a3751a', inner: '#5a1a10', painted: true },
  ];
  function clayDiya(g, s, pal, lvl) {
    const rimY = -25 * s, rx = 38 * s, ry = 12.5 * s, fy = -5 * s, fx = 17 * s;
    g.fillStyle = 'rgba(0,0,0,0.45)'; ell(g, 0, 0.5 * s, 45 * s, 6.5 * s); g.fill(); // contact shadow
    // outer bowl
    g.beginPath(); g.moveTo(-rx, rimY);
    g.bezierCurveTo(-rx * 0.97, rimY + 15 * s, -fx * 1.35, fy, -fx, fy);
    g.ellipse(0, fy, fx, fx * 0.3, 0, Math.PI, 0, true);
    g.bezierCurveTo(fx * 1.35, fy, rx * 0.97, rimY + 15 * s, rx, rimY);
    g.ellipse(0, rimY, rx, ry, 0, 0, Math.PI, false);
    g.closePath();
    const gr = g.createLinearGradient(-rx, 0, rx, 0); gr.addColorStop(0, pal.lit); gr.addColorStop(0.42, pal.mid); gr.addColorStop(1, pal.dark);
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    const vg = g.createLinearGradient(0, rimY, 0, 1 * s); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = vg; g.fillRect(-rx, rimY, rx * 2, 30 * s);
    const hl = g.createRadialGradient(-rx * 0.55, rimY + 8 * s, 0, -rx * 0.55, rimY + 8 * s, 16 * s); hl.addColorStop(0, 'rgba(255,230,200,0.22)'); hl.addColorStop(1, 'rgba(255,230,200,0)');
    g.fillStyle = hl; g.fillRect(-rx, rimY, rx * 2, 30 * s);
    if (pal.painted) paintedMotifs(g, s, rimY, rx);
    g.globalAlpha = pal.painted ? 0.28 : 0.5; g.fillStyle = pat(g, 'clay'); g.fillRect(-rx, rimY - ry, rx * 2, 40 * s); g.globalAlpha = 1;
    if (lvl > 0.02) { g.globalCompositeOperation = 'lighter'; const fl = g.createRadialGradient(0, -12 * s, 0, 0, -12 * s, 34 * s); fl.addColorStop(0, `rgba(255,150,60,${0.2 * lvl})`); fl.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = fl; g.fillRect(-rx, rimY, rx * 2, 30 * s); g.globalCompositeOperation = 'source-over'; }
    g.restore();
    // rim lip (top surface of the wall)
    const rxi = rx - 4.6 * s, ryi = ry - 1.7 * s;
    g.beginPath(); g.ellipse(0, rimY, rx, ry, 0, 0, TAU); g.ellipse(0, rimY + 0.4 * s, rxi, ryi, 0, 0, TAU, true);
    const lg = g.createLinearGradient(-rx, 0, rx, 0); lg.addColorStop(0, pal.lip1); lg.addColorStop(1, pal.lip2);
    g.fillStyle = lg; g.fill('evenodd');
    if (pal.painted) { g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 0.8 * s; ell(g, 0, rimY, rx - 2.2 * s, ry - 0.8 * s); g.stroke(); }
    // inside of the bowl: the far wall catches the flame light
    ell(g, 0, rimY + 0.4 * s, rxi, ryi);
    const ig = g.createLinearGradient(0, rimY - ryi, 0, rimY + ryi); ig.addColorStop(0, mixHex(pal.inner, '#e07a30', 0.35 * lvl)); ig.addColorStop(1, '#1c0a04');
    g.fillStyle = ig; g.fill();
    // oil pool with the flame's reflection
    ell(g, 0, rimY + 3.2 * s, rxi * 0.8, ryi * 0.62);
    const og = g.createRadialGradient(0, rimY + 6 * s, 0, 0, rimY + 3.2 * s, rxi * 0.8); og.addColorStop(0, mixHex('#8a5e18', '#ffd27a', 0.6 * lvl)); og.addColorStop(1, '#3e2806');
    g.fillStyle = og; g.fill();
    if (lvl > 0.05) { g.fillStyle = `rgba(255,236,170,${0.55 * lvl})`; ell(g, 0, rimY + 6 * s, 5 * s, 1.3 * s); g.fill(); }
    // spout, pinched toward the viewer
    g.beginPath(); g.moveTo(-13 * s, -13.6 * s); g.quadraticCurveTo(-7 * s, -6.2 * s, 0, -4.6 * s); g.quadraticCurveTo(7 * s, -6.2 * s, 13 * s, -13.6 * s); g.closePath();
    const sg = g.createLinearGradient(0, -14 * s, 0, -4.6 * s); sg.addColorStop(0, pal.lip1); sg.addColorStop(1, pal.mid);
    g.fillStyle = sg; g.fill();
    g.strokeStyle = 'rgba(40,12,2,0.55)'; g.lineWidth = 1.2 * s;
    g.beginPath(); g.moveTo(-12 * s, -12.4 * s); g.quadraticCurveTo(-7 * s, -5.6 * s, 0, -4.2 * s); g.quadraticCurveTo(7 * s, -5.6 * s, 12 * s, -12.4 * s); g.stroke();
    g.beginPath(); g.moveTo(-6.5 * s, -13.4 * s); g.quadraticCurveTo(-3 * s, -8 * s, 0, -7.2 * s); g.quadraticCurveTo(3 * s, -8 * s, 6.5 * s, -13.4 * s); g.closePath();
    g.fillStyle = mixHex('#5a3c0e', '#c08a30', 0.5 * lvl); g.fill();
    wick(g, 0, -7.4 * s, -11 * s, s);
  }
  function wick(g, x, yb, yt, s) {
    g.lineCap = 'round';
    g.strokeStyle = '#ece0c4'; g.lineWidth = 2.3 * s; g.beginPath(); g.moveTo(x, yb); g.lineTo(x, yt + 1.2 * s); g.stroke();
    g.strokeStyle = '#22140c'; g.beginPath(); g.moveTo(x, yt + 1.2 * s); g.lineTo(x, yt); g.stroke();
  }
  function paintedMotifs(g, s, rimY, rx) {
    g.strokeStyle = '#f2c14e'; g.lineWidth = 1.7 * s;
    g.beginPath(); g.ellipse(0, rimY + 3.5 * s, rx * 0.97, 12 * s, 0, 0.06 * Math.PI, 0.94 * Math.PI); g.stroke();
    g.beginPath(); g.ellipse(0, rimY + 13 * s, rx * 0.66, 8 * s, 0, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
    for (let i = 0; i <= 14; i++) { // white dots, smaller toward the sides where the bowl turns away
      const a = lerp(0.1, 0.9, i / 14) * Math.PI, x = Math.cos(a) * rx * 0.86, y = rimY + 8.5 * s + Math.sin(a) * 10 * s, sz = (0.45 + 0.55 * Math.sin(a)) * 1.4 * s;
      g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(x, y, sz, 0, TAU); g.fill();
    }
    for (let i = 0; i <= 8; i++) {
      const a = lerp(0.15, 0.85, i / 8) * Math.PI, x = Math.cos(a) * rx * 0.62, y = rimY + 17 * s + Math.sin(a) * 4.5 * s, sq = Math.sin(a);
      g.fillStyle = '#2fae66'; g.beginPath(); g.ellipse(x, y, 3.4 * s * sq + 0.6 * s, 1.5 * s, -Math.cos(a) * 0.7, 0, TAU); g.fill();
    }
  }
  function lotusDiya(g, s, lvl) {
    g.fillStyle = 'rgba(0,0,0,0.45)'; ell(g, 0, 0.5 * s, 42 * s, 6.5 * s); g.fill();
    g.fillStyle = '#2b5420'; ell(g, 0, -2 * s, 37 * s, 9 * s); g.fill(); // leaf platter edge
    const pg = g.createLinearGradient(-36 * s, 0, 36 * s, 0); pg.addColorStop(0, '#79b84c'); pg.addColorStop(1, '#3d6e28');
    g.fillStyle = pg; ell(g, 0, -4 * s, 35.5 * s, 8.4 * s); g.fill();
    g.strokeStyle = 'rgba(30,60,20,0.5)'; g.lineWidth = 0.7 * s;
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.beginPath(); g.moveTo(0, -4 * s); g.lineTo(Math.cos(a) * 33 * s, -4 * s + Math.sin(a) * 7.8 * s); g.stroke(); }
    const K = 0.34, petals = [];
    const ring = (n, R0, yb, len, wid, off, cBase, cTip) => { for (let i = 0; i < n; i++) { const th = off + i * TAU / n; petals.push({ th, R0, yb, len, wid, z: Math.sin(th) * R0, cBase, cTip }); } };
    ring(10, 22 * s, -6 * s, 30 * s, 11 * s, 0.1, '#d23f78', '#ffd3e4');
    ring(8, 13 * s, -12 * s, 25 * s, 9 * s, 0.1 + TAU / 16, '#e2588e', '#fff0f5');
    petals.sort((a, b) => a.z - b.z);
    const drawPetal = (p) => {
      const c = Math.cos(p.th), sn = Math.sin(p.th), R1 = p.R0 + p.len * 0.42;
      const bx = c * p.R0, by = p.yb + sn * p.R0 * K, tx = c * R1, ty = p.yb - p.len * 0.88 + sn * R1 * K;
      const wv = p.wid * (0.3 + 0.7 * Math.abs(sn)) + p.wid * 0.12;
      const dx = tx - bx, dy = ty - by, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
      g.beginPath(); g.moveTo(bx, by);
      g.bezierCurveTo(bx + nx * wv, by + ny * wv, tx + nx * wv * 0.55 - dx * 0.15, ty + ny * wv * 0.55 - dy * 0.15, tx, ty);
      g.bezierCurveTo(tx - nx * wv * 0.55 - dx * 0.15, ty - ny * wv * 0.55 - dy * 0.15, bx - nx * wv, by - ny * wv, bx, by);
      const f = 0.68 + 0.3 * Math.cos(p.th - Math.PI) * 0.5 + 0.15 + (sn < 0 ? 0.22 : 0.06) * lvl;
      const gr = g.createLinearGradient(bx, by, tx, ty); gr.addColorStop(0, shade(p.cBase, f * 0.85)); gr.addColorStop(1, shade(p.cTip, f));
      g.fillStyle = gr; g.fill();
      g.strokeStyle = shade(p.cBase, 0.55); g.lineWidth = 0.7 * s; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo((bx + tx) / 2 + nx * wv * 0.1, (by + ty) / 2, tx, ty); g.stroke();
    };
    for (const p of petals) if (p.z < 0) drawPetal(p);
    // brass cup holding the oil and wick
    g.beginPath(); g.moveTo(-14 * s, -30 * s); g.bezierCurveTo(-13 * s, -24 * s, -7 * s, -20.5 * s, 0, -20.5 * s); g.bezierCurveTo(7 * s, -20.5 * s, 13 * s, -24 * s, 14 * s, -30 * s);
    g.ellipse(0, -30 * s, 14 * s, 4.8 * s, 0, 0, Math.PI, false); g.closePath();
    const bg = g.createLinearGradient(-14 * s, 0, 14 * s, 0); bg.addColorStop(0, '#f6d57a'); bg.addColorStop(0.35, '#d9a640'); bg.addColorStop(1, '#6b4710');
    g.fillStyle = bg; g.fill();
    g.beginPath(); g.ellipse(0, -30 * s, 14 * s, 4.8 * s, 0, 0, TAU); g.ellipse(0, -29.8 * s, 11.6 * s, 3.7 * s, 0, 0, TAU, true);
    const rg = g.createLinearGradient(-14 * s, 0, 14 * s, 0); rg.addColorStop(0, '#fff0b0'); rg.addColorStop(1, '#a8761c'); g.fillStyle = rg; g.fill('evenodd');
    ell(g, 0, -29.8 * s, 11.6 * s, 3.7 * s); const ig = g.createLinearGradient(0, -33.5 * s, 0, -26 * s); ig.addColorStop(0, mixHex('#6b4a14', '#ffb04a', 0.5 * lvl)); ig.addColorStop(1, '#1c1004'); g.fillStyle = ig; g.fill();
    ell(g, 0, -28.6 * s, 8.6 * s, 2.3 * s); g.fillStyle = mixHex('#7a5416', '#ffd27a', 0.55 * lvl); g.fill();
    wick(g, 0, -28.8 * s, -33 * s, s);
    for (const p of petals) if (p.z >= 0) drawPetal(p);
  }
  function drawDiyaBody(g, style, s, lvl) {
    if (style === 2) lotusDiya(g, s, lvl); else clayDiya(g, s, CLAY[style], lvl);
  }
  function drawFlame(g, x, y, u, lvl, lean, t) {
    if (lvl < 0.02) return;
    const fl = 1 + Math.sin(t * 11.3) * 0.06 + Math.sin(t * 17.9 + 1) * 0.05 + Math.sin(t * 5.1) * 0.04;
    const h = 30 * u * lvl * fl, w = 8 * u * lvl, tipX = x + lean * h * 0.8 + Math.sin(t * 7.7) * 0.8 * u;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5 * lvl; g.drawImage(glowSprite('#ff9d2e'), x - 75 * u, y - h * 0.6 - 75 * u, 150 * u, 150 * u);
    g.globalAlpha = 0.42 * lvl; g.drawImage(glowSprite('#ffd27a'), x - 26 * u, y - h * 0.6 - 26 * u, 52 * u, 52 * u);
    g.restore();
    const shape = (sc, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(x - w * sc, y); g.bezierCurveTo(x - w * sc * 1.15, y - h * sc * 0.45, lerp(x, tipX, 0.6) - w * sc * 0.3, y - h * sc * 0.75, lerp(x, tipX, sc), y - h * sc); g.bezierCurveTo(lerp(x, tipX, 0.6) + w * sc * 0.3, y - h * sc * 0.75, x + w * sc * 1.15, y - h * sc * 0.45, x + w * sc, y); g.quadraticCurveTo(x, y + w * sc * 0.7, x - w * sc, y); g.fill(); };
    g.globalAlpha = lvl;
    shape(1, 'rgba(255,120,20,0.85)'); shape(0.78, 'rgba(255,190,50,0.95)'); shape(0.5, 'rgba(255,245,200,1)');
    g.fillStyle = 'rgba(90,140,255,0.55)'; g.beginPath(); g.ellipse(x, y - 1.5 * u, w * 0.45, w * 0.35, 0, 0, TAU); g.fill();
    g.globalAlpha = 1;
  }
  function putOutDiya(reason) {
    const d = diya; if (!d.lit) return;
    d.lit = false; d.emit = 4; d.ember = 1; d.newRib = true; Snd.puff();
    if (reason) showHint(reason, 2400);
  }
  function lightDiya() {
    const d = diya, s = dS(), [wx, wy] = diyaWick(S.diya, s);
    d.lit = true; d.emit = 0; Snd.fizz();
    addP({ x: d.x + wx, y: floorY + wy - 10 * s, vx: 0, vy: 0, max: 0.3, type: 'flash', size: 50 * s, color: '#ffcf70' });
  }
  function updateDiya(dt, t) {
    const d = diya, s = dS();
    d.lvl = lerp(d.lvl, d.lit ? 1 : 0, d.lit ? 0.08 : 0.3);
    if (d.drag) { const nx = clamp(M.x - d.drag.ox, 44 * s, W - 44 * s); d.vx = nx - d.x; d.x = nx; } else d.vx *= 0.85;
    const [wx, wy] = diyaWick(S.diya, s), fx = d.x + wx, fy = floorY + wy;
    let wind = -d.vx * 0.05;
    if (M.inside && !(M.touch && !M.down)) { const dd = Math.hypot(M.x - fx, M.y - (fy - 20 * s)); if (dd < 160 * U) wind += clamp(M.vx, -30, 30) * 0.02 * (1 - dd / (160 * U)); }
    d.wind = lerp(d.wind, wind, 0.2);
    d.lean = clamp(lerp(d.lean, d.wind * 0.6, 0.15), -0.3, 0.3); // the flame stays upright, facing forward
    if (d.lit && Math.abs(d.wind) > 0.75 && !d.drag) putOutDiya('Whoosh! Too much wind. Click the diya to light it again.');
    d.ember = Math.max(0, d.ember - dt * 0.42);
    // a thin ribbon of soot-grey smoke rising from the hot wick, curling as it climbs
    if (d.emit > 0) {
      d.emit -= dt;
      d.smoke.push({ x: fx + d.vx * 0.2, y: fy - 1.5 * s, vx: d.vx * 0.3 + rand(-0.03, 0.03) * U, vy: -0.75 * U * (0.7 + 0.3 * (S.diyaScale || 1)), age: 0, str: clamp(d.emit / 4, 0, 1), brk: d.newRib, w: s });
      d.newRib = false;
    }
    for (let i = d.smoke.length - 1; i >= 0; i--) {
      const p = d.smoke[i]; p.age += dt;
      if (p.age > 4.2) { d.smoke.splice(i, 1); if (d.smoke[i]) d.smoke[i].brk = true; continue; }
      const curl = Math.min(1, p.age * 1.2);
      p.vy = p.vy * 0.994 - 0.004 * U;
      p.vx = p.vx * 0.95 + (Math.sin(p.y * 0.045 / U + t * 1.3 + p.age * 1.7) * 0.014 + Math.sin(p.y * 0.12 / U - t * 2.1) * 0.008) * U * curl + d.wind * 0.012 * U;
      p.x += p.vx; p.y += p.vy;
    }
    if (d.lit && Math.random() < 0.02) addP({ x: fx, y: fy - 22 * s, vx: rand(-0.2, 0.2), vy: -rand(0.4, 0.8) * U, max: 0.7, size: 0.9 * s, color: '#ffcf70', g: -0.005 });
  }
  function drawDiyaSmoke(d) {
    const pts = d.smoke; if (pts.length < 2) return;
    ctx.save();
    // soft body of the plume: overlapping blurred puffs along the rising ribbon
    const spr = glowSprite('#cfcac4');
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1];
      const life = Math.pow(1 - p.age / 4.2, 1.3) * (0.35 + 0.65 * p.str) * Math.min(1, p.age * 5 + 0.3);
      const r = (1.6 + p.age * 7.5) * p.w, gap = p.brk ? r : Math.hypot(p.x - q.x, p.y - q.y);
      const a = 0.75 * life * Math.min(1, (gap + 0.4) / (r * 0.45));
      if (a < 0.004) continue;
      ctx.globalAlpha = a; ctx.drawImage(spr, p.x - r, p.y - r, r * 2, r * 2);
    }
    // the thin thread of soot right above the wick
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1]; if (p.brk || p.age > 1.6) continue;
      const g = Math.round(lerp(90, 190, p.age / 1.6));
      ctx.globalAlpha = 0.55 * (1 - p.age / 1.6) * (0.4 + 0.6 * p.str);
      ctx.strokeStyle = `rgb(${g},${g - 4},${g - 8})`; ctx.lineWidth = (0.9 + p.age * 1.4) * p.w;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    ctx.restore();
  }
  function drawDiya(t) {
    const d = diya, s = dS(), [wx, wy] = diyaWick(S.diya, s), fx = d.x + wx, fy = floorY + wy;
    if (d.lvl > 0.03) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * d.lvl; ctx.drawImage(glowSprite('#ff9d2e'), d.x - 120 * s, floorY - 26 * s, 240 * s, 40 * s); ctx.restore(); }
    ctx.save(); ctx.translate(d.x, floorY); drawDiyaBody(ctx, S.diya, s, d.lvl); ctx.restore();
    drawFlame(ctx, fx, fy, s, d.lvl, d.lean, t);
    if (!d.lit && d.ember > 0.01) { // glowing wick tip cooling down
      const e = d.ember * (0.75 + 0.25 * Math.sin(t * 23));
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(fx, fy - 0.5 * s, 7 * s, '#ff5a1f', e); ctx.restore();
      ctx.fillStyle = `rgba(255,${Math.round(90 + 90 * d.ember)},40,${d.ember})`; ctx.beginPath(); ctx.arc(fx, fy - 0.5 * s, 1.3 * s, 0, TAU); ctx.fill();
    }
    drawDiyaSmoke(d);
  }
  // ======================================================================
  // CRACKERS
  // ======================================================================
  const crackers = [];
  const CR_TYPES = ['anar', 'bomb', 'ladi', 'rocket'];
  function dropCracker(x, y) {
    const type = pick(CR_TYPES);
    const c = { type, x: clamp(x, 30 * U, W - 30 * U), y: Math.min(y, floorY - 10 * U), vy: 0, vx: rand(-0.6, 0.6) * U, rot: rand(-0.3, 0.3), age: 0, state: 'fall', fuse: 0, t: 0, done: false, fade: 1 };
    if (type === 'ladi') { c.n = 14; c.popped = 0; c.hops = new Array(c.n).fill(0); c.dir = Math.random() < 0.5 ? 1 : -1; }
    if (type === 'rocket') { c.ry = 0; c.rvy = 0; c.wob = rand(0, TAU); }
    crackers.push(c);
    if (crackers.length > 14) crackers.shift();
  }
  function shockwave(x, y, power) {
    const R = 240 * U * power;
    const kick = (p) => { if (p.pinned) return; const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1; if (d > R) return; const f = (1 - d / R) * 14 * U * power; p.x += dx / d * f; p.y += dy / d * f - f * 0.3; };
    if (lantern) { lantern.rope.forEach(kick); kick(lantern.bot); lantern.yawV += rand(-0.03, 0.03) * power; }
    lights.pts.forEach(kick); lights.bulbs.forEach((b) => kick(b.b));
    if (diya && Math.abs(diya.x - x) < R) { diya.wind += (diya.x > x ? 1 : -1) * 1.5 * power * (1 - Math.abs(diya.x - x) / R); if (diya.wind > 0.75 || diya.wind < -0.75) putOutDiya('The blast blew out the diya. Click it to light it again.'); }
    shake = Math.max(shake, 10 * U * power);
    addP({ x, y, vx: 0, vy: 0, max: 0.5, type: 'shock', size: R, color: '#ffe0a0' });
  }
  function firework(x, y) {
    const pal = pick([['#ff4d6d', '#ffd166'], ['#06d6a0', '#ffffff'], ['#4cc9f0', '#f72585'], ['#ffd23f', '#ff7b00'], ['#c77dff', '#80ffdb']]);
    const n = 70;
    for (let i = 0; i < n; i++) { const a = i / n * TAU + rand(-0.05, 0.05), v = rand(2.4, 4.2) * U; addP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rand(1.1, 1.8), g: 0.045 * U, drag: 0.975, size: 1.8 * U, type: 'spark', color: pal[i % 2], trail: 0.25 }); }
    addP({ x, y, vx: 0, vy: 0, max: 0.4, type: 'flash', size: 80 * U, color: pal[0] });
    Snd.crackle(); Snd.pop();
  }
  function updateCrackers(dt, t) {
    for (let i = crackers.length - 1; i >= 0; i--) {
      const c = crackers[i]; c.age += dt;
      if (c.state === 'fall') {
        c.vy += GRAV() * 1.2; c.y += c.vy; c.x += c.vx;
        if (c.y >= floorY) { c.y = floorY; if (Math.abs(c.vy) > 3 * U) { c.vy *= -0.3; Snd.click(); } else { c.vy = 0; c.state = 'fuse'; c.t = 0; c.rot = 0; } }
        continue;
      }
      c.t += dt;
      const fuseLen = c.type === 'bomb' ? 1.6 : c.type === 'rocket' ? 1.1 : 0.8;
      if (c.state === 'fuse') {
        const fp = fusePoint(c);
        if (Math.random() < 0.8) addP({ x: fp[0], y: fp[1], vx: rand(-1.2, 1.2) * U, vy: rand(-2, 0.3) * U, max: rand(0.2, 0.45), g: 0.08 * U, size: 1.2 * U, type: 'spark', color: pick(['#fff4c2', '#ffb347']) });
        if (Math.random() < 0.15) smoke(fp[0], fp[1], 1, 0.5, 0.5);
        if (c.t >= fuseLen) { c.state = 'live'; c.t = 0; ignite(c); }
        continue;
      }
      if (c.state === 'live') liveCracker(c, dt, t);
      if (c.state === 'spent') { c.fade -= dt / 7; if (c.fade <= 0) crackers.splice(i, 1); }
    }
  }
  function fusePoint(c) {
    if (c.type === 'anar') return [c.x, c.y - 36 * U];
    if (c.type === 'bomb') return [c.x + 6 * U, c.y - 26 * U];
    if (c.type === 'rocket') return [c.x, c.y - 38 * U];
    const k = c.popped, f = c.dir > 0 ? k : c.n - 1 - k; return [c.x + (f - c.n / 2) * 8.5 * U, c.y - 4 * U];
  }
  function ignite(c) {
    if (c.type === 'anar') Snd.hiss(4.5);
    if (c.type === 'bomb') { Snd.boom(); boomFx(c.x, c.y - 12 * U, 1); c.state = 'spent'; }
    if (c.type === 'rocket') { Snd.whoosh(); c.rvy = -2 * U; }
  }
  function boomFx(x, y, power) {
    addP({ x, y, vx: 0, vy: 0, max: 0.35, type: 'flash', size: 160 * U * power, color: '#fff1c4' });
    addP({ x, y, vx: 0, vy: 0, max: 0.6, type: 'flash', size: 90 * U * power, color: '#ff7a1a' });
    for (let i = 0; i < 46 * power; i++) { const a = rand(Math.PI, TAU), v = rand(2, 9) * U * power; addP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rand(0.3, 0.9), g: 0.2 * U, size: 1.6 * U, type: 'spark', color: pick(['#fff4c2', '#ffd36b', '#ff8a2a']), floor: true }); }
    for (let i = 0; i < 18 * power; i++) { const a = rand(Math.PI, TAU), v = rand(1, 5) * U; addP({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rand(1.5, 2.6), g: 0.12 * U, drag: 0.97, size: rand(1.5, 3) * U, type: 'paper', spin: rand(-12, 12), color: pick(['#c62828', '#8d6e63', '#f5f5dc', '#2e7d32']), add: false, floor: true }); }
    smoke(x, y, 14 * power, 3, 1.6);
    shockwave(x, y, power);
  }
  function liveCracker(c, dt, t) {
    if (c.type === 'anar') {
      const dur = 4.5, k = c.t / dur, int = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
      for (let i = 0; i < 9 * int; i++) { const v = rand(4.5, 9.5) * U * (0.6 + 0.6 * int), a = -Math.PI / 2 + rand(-0.32, 0.32); addP({ x: c.x, y: c.y - 34 * U, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rand(0.6, 1.2), g: 0.16 * U, drag: 0.985, size: 1.4 * U, type: Math.random() < 0.85 ? 'spark' : 'star', color: pick(['#fff6d5', '#ffe08a', '#ffc04d', '#ffffff', '#ffd0ff']), floor: true }); }
      if (Math.random() < 0.15) smoke(c.x, c.y - 34 * U, 1, 1, 0.8);
      if (c.t > dur) c.state = 'spent';
    } else if (c.type === 'ladi') {
      const interval = 0.085;
      while (c.popped < c.n && c.t > c.popped * interval + rand(0, 0.02)) {
        const f = c.dir > 0 ? c.popped : c.n - 1 - c.popped, x = c.x + (f - c.n / 2) * 8.5 * U, y = c.y - 4 * U;
        c.hops[f] = 1; Snd.pop();
        addP({ x, y, vx: 0, vy: 0, max: 0.18, type: 'flash', size: 40 * U, color: '#fff0b0' });
        for (let k = 0; k < 8; k++) addP({ x, y, vx: rand(-3, 3) * U, vy: rand(-4, -0.5) * U, max: rand(0.2, 0.5), g: 0.2 * U, size: 1.3 * U, type: 'spark', color: '#ffe08a' });
        for (let k = 0; k < 3; k++) addP({ x, y, vx: rand(-2, 2) * U, vy: rand(-3, -1) * U, max: rand(1.2, 2), g: 0.12 * U, drag: 0.97, size: rand(1.2, 2.2) * U, type: 'paper', spin: rand(-14, 14), color: pick(['#d32f2f', '#f5f5dc']), add: false, floor: true });
        smoke(x, y, 2, 1, 0.7);
        shockwaveLite(x, y);
        c.popped++;
      }
      if (c.popped >= c.n) c.state = 'spent';
    } else if (c.type === 'rocket') {
      c.rvy -= 0.32 * U; c.rvy *= 0.985; c.ry += c.rvy; c.wob += dt * 9;
      const rx = c.x + Math.sin(c.wob) * 2 * U * Math.min(1, c.t * 2), ry = c.y - 38 * U + c.ry;
      for (let i = 0; i < 4; i++) addP({ x: rx + rand(-1.5, 1.5) * U, y: ry + 10 * U, vx: rand(-0.6, 0.6) * U, vy: rand(1, 3) * U, max: rand(0.3, 0.7), g: 0.05 * U, size: 1.3 * U, type: 'spark', color: pick(['#ffe8a0', '#ffb347', '#ffffff']) });
      if (Math.random() < 0.4) smoke(rx, ry + 12 * U, 1, 0.5, 0.6);
      c.rx = rx; c.rY = ry;
      if (ry < Math.max(H * 0.18, 90 * U) || c.t > 2.6) { firework(rx, ry); c.state = 'spent'; c.flown = true; }
    }
  }
  function shockwaveLite(x, y) {
    const R = 70 * U; const kick = (p) => { if (p.pinned) return; const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1; if (d > R) return; const f = (1 - d / R) * 4 * U; p.x += dx / d * f; p.y += dy / d * f - f * 0.5; };
    if (lantern && lantern.bot.y > floorY - 80 * U) kick(lantern.bot);
    shake = Math.max(shake, 2 * U);
  }
  function drawCrackers(t) {
    for (const c of crackers) {
      const spent = c.state === 'spent';
      ctx.save(); ctx.globalAlpha = spent ? clamp(c.fade, 0, 1) : 1; ctx.translate(c.x, c.y); ctx.rotate(c.rot || 0);
      const burn = spent ? 0.35 : 1;
      if (c.type === 'anar') {
        ctx.fillStyle = shade('#2e7d32', burn); ctx.beginPath(); ctx.moveTo(-13 * U, 0); ctx.lineTo(13 * U, 0); ctx.lineTo(4 * U, -32 * U); ctx.lineTo(-4 * U, -32 * U); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade('#ffcc33', burn); for (const y of [-8, -18, -26]) { const hw = 13 - (13 - 4) * (-y / 32); ctx.fillRect(-hw * U, (y - 1.5) * U, hw * 2 * U, 3 * U); }
        ctx.fillStyle = shade('#c62828', burn); ctx.beginPath(); ctx.ellipse(0, -32 * U, 4.5 * U, 2.2 * U, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = shade('#9e6b3b', burn); ctx.beginPath(); ctx.ellipse(0, -34 * U, 3 * U, 1.8 * U, 0, 0, TAU); ctx.fill();
      } else if (c.type === 'bomb') {
        if (!spent) {
          ctx.fillStyle = '#9c6b3a'; ctx.beginPath(); ctx.arc(0, -12 * U, 12 * U, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#6d4520'; ctx.lineWidth = 1 * U; for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.ellipse(0, -12 * U, 12 * U, Math.abs(k) * 3.6 * U + 1, k * 0.5, 0, TAU); ctx.stroke(); }
          ctx.fillStyle = '#c62828'; ctx.fillRect(-7 * U, -15 * U, 14 * U, 6 * U); ctx.fillStyle = '#ffd34d'; ctx.font = `bold ${5 * U}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('BOMB', 0, -10.5 * U);
          const fk = c.state === 'fuse' ? clamp(1 - c.t / 1.6, 0, 1) : 1;
          ctx.strokeStyle = '#d7c49e'; ctx.lineWidth = 1.4 * U; ctx.beginPath(); ctx.moveTo(0, -24 * U); ctx.quadraticCurveTo(3 * U, -24 * U - 6 * U * fk, 6 * U * fk, -24 * U - 2 * U * fk); ctx.stroke();
        } else { ctx.fillStyle = 'rgba(40,30,25,0.8)'; ctx.beginPath(); ctx.ellipse(0, -1 * U, 18 * U, 3 * U, 0, 0, TAU); ctx.fill(); }
      } else if (c.type === 'ladi') {
        ctx.strokeStyle = shade('#d7c49e', burn); ctx.lineWidth = 1 * U; ctx.beginPath(); ctx.moveTo(-c.n / 2 * 8.5 * U, -4 * U); ctx.lineTo(c.n / 2 * 8.5 * U, -4 * U); ctx.stroke();
        for (let f = 0; f < c.n; f++) {
          const x = (f - c.n / 2) * 8.5 * U; if (c.hops[f]) { if (!c.burnt) continue; }
          ctx.save(); ctx.translate(x, -4 * U); ctx.rotate(f % 2 ? 0.5 : -0.5);
          ctx.fillStyle = '#d32f2f'; ctx.fillRect(-2.2 * U, -5 * U, 4.4 * U, 10 * U); ctx.fillStyle = '#ffeb3b'; ctx.fillRect(-2.2 * U, -1 * U, 4.4 * U, 1.6 * U);
          ctx.restore();
        }
      } else if (c.type === 'rocket') {
        // bottle
        ctx.fillStyle = 'rgba(70,170,110,0.55)'; ctx.strokeStyle = 'rgba(190,255,210,0.6)'; ctx.lineWidth = 1 * U;
        ctx.beginPath(); ctx.moveTo(-8 * U, 0); ctx.lineTo(-8 * U, -18 * U); ctx.quadraticCurveTo(-8 * U, -24 * U, -3 * U, -26 * U); ctx.lineTo(-3 * U, -32 * U); ctx.lineTo(3 * U, -32 * U); ctx.lineTo(3 * U, -26 * U); ctx.quadraticCurveTo(8 * U, -24 * U, 8 * U, -18 * U); ctx.lineTo(8 * U, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (!c.flown && c.state !== 'live') drawRocket(0, -38 * U);
      }
      ctx.restore();
      if (c.type === 'rocket' && c.state === 'live') { ctx.save(); ctx.translate(c.rx, c.rY); drawRocket(0, 0); ctx.restore(); }
    }
  }
  function drawRocket(x, y) {
    ctx.strokeStyle = '#c8a46a'; ctx.lineWidth = 1.4 * U; ctx.beginPath(); ctx.moveTo(x + 2.5 * U, y - 4 * U); ctx.lineTo(x + 2.5 * U, y + 30 * U); ctx.stroke();
    ctx.fillStyle = '#e53935'; ctx.fillRect(x - 3 * U, y - 6 * U, 5 * U, 16 * U);
    ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.moveTo(x - 3 * U, y - 6 * U); ctx.lineTo(x - 0.5 * U, y - 13 * U); ctx.lineTo(x + 2 * U, y - 6 * U); ctx.fill();
  }

  // ======================================================================
  // SPARKLER CURSOR (phuljhadi)
  // ======================================================================
  const sparkler = { until: 0, total: 30 };
  function sparklerActive() { return S.sparklerAlways || now() < sparkler.until; }
  function updateSparkler() {
    const on = sparklerActive() && M.inside && (!M.touch || M.down);
    document.body.classList.toggle('sparkler', sparklerActive());
    if (!on) return;
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU), v = rand(1.5, 4.5) * U;
      addP({ x: M.x, y: M.y, vx: Math.cos(a) * v + M.vx * 0.2, vy: Math.sin(a) * v + M.vy * 0.2, max: rand(0.12, 0.32), drag: 0.92, g: 0.02 * U, size: 1.1 * U, type: 'spark', color: pick(['#fffbe8', '#fff1b8', '#ffd36b', '#ffffff']), fork: Math.random() < 0.3 });
    }
    if (Math.random() < 0.08) Snd.fizz();
  }
  function drawSparkler(t) {
    if (!sparklerActive() || !M.inside) return;
    const left = S.sparklerAlways ? 1 : clamp((sparkler.until - now()) / sparkler.total, 0, 1);
    const len = 80 * U, ang = 0.75;
    const ex = M.x + Math.cos(ang) * len, ey = M.y + Math.sin(ang) * len;
    ctx.strokeStyle = '#6e6e78'; ctx.lineWidth = 1.6 * U; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(M.x, M.y); ctx.lineTo(ex, ey); ctx.stroke();
    // unburnt coating
    const cl = len * 0.75 * left;
    ctx.strokeStyle = '#5a4b3c'; ctx.lineWidth = 3.4 * U; ctx.beginPath(); ctx.moveTo(M.x + Math.cos(ang) * 2, M.y + Math.sin(ang) * 2); ctx.lineTo(M.x + Math.cos(ang) * cl, M.y + Math.sin(ang) * cl); ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(M.x, M.y, 34 * U, '#ffe7a3', 0.9); glow(M.x, M.y, 10 * U, '#ffffff', 1);
    ctx.restore();
  }

  // ======================================================================
  // INPUT
  // ======================================================================
  let lastTap = { t: 0, x: 0, y: 0 }, press = null;
  function setPointer(e) {
    const nx = e.clientX, ny = e.clientY;
    if (M.x > -900) M.hist.push([nx - M.x, ny - M.y]);
    M.x = nx; M.y = ny; M.inside = true; M.touch = e.pointerType === 'touch';
  }
  function interactiveAt(x, y) {
    if (handleAt(x, y)) return true;
    if (lantern && (lanternHit(x, y) || cordAt(x, y))) return true;
    if (diyaHit(x, y)) return true;
    if (lights && bulbAt(x, y)) return true;
    for (const c of crackers) if (Math.abs(c.x - x) < 40 * U && y > c.y - 60 * U) return true;
    return false;
  }
  function bulbAt(x, y) {
    let best = null, bd = 16 * U;
    for (const b of lights.bulbs) { const d = Math.hypot(b.b.x - x, b.b.y + 4 * U - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  // ---- diagonal resize handles (kandil: bottom-right corner, diya: top-right corner) ----
  const RS = { lan: 0, diya: 0, touchObj: null, touchUntil: 0, active: null, start: null };
  const handleR = () => (M.touch ? 24 : 13);
  function inBox(b, x, y, pad) { return x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad; }
  function handleAt(x, y) {
    if (lantern && RS.lan > 0.3) { const b = lanternBox(); if (Math.hypot(x - b.hx, y - b.hy) < handleR()) return 'lantern'; }
    if (diya && RS.diya > 0.3) { const b = diyaBox(); if (Math.hypot(x - b.hx, y - b.hy) < handleR()) return 'diya'; }
    return null;
  }
  function updateHandles() {
    const mouse = M.inside && !M.touch, tn = now();
    const lanDragging = lantern && lantern.drag && !lantern.drag.pending, diyaDragging = diya && diya.drag && !diya.drag.pending;
    const wantL = RS.active === 'lantern' || (!RS.active && !lanDragging && ((mouse && lantern && inBox(lanternBox(), M.x, M.y, 18)) || (RS.touchObj === 'lantern' && tn < RS.touchUntil)));
    const wantD = RS.active === 'diya' || (!RS.active && !diyaDragging && ((mouse && inBox(diyaBox(), M.x, M.y, 18)) || (RS.touchObj === 'diya' && tn < RS.touchUntil)));
    RS.lan = lerp(RS.lan, wantL ? 1 : 0, 0.18); RS.diya = lerp(RS.diya, wantD ? 1 : 0, 0.18);
  }
  function drawHandle(b, a, dir) {
    if (a < 0.02) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,225,160,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.setLineDash([]);
    const r = M.touch ? 13 : 10, x = b.hx, y = b.hy;
    ctx.fillStyle = 'rgba(30,16,46,0.88)'; ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
    const k = r * 0.48, sy = dir === 'down' ? 1 : -1; // diagonal double arrow
    ctx.beginPath(); ctx.moveTo(x - k, y - k * sy); ctx.lineTo(x + k, y + k * sy);
    ctx.moveTo(x + k, y + k * sy); ctx.lineTo(x + k * 0.1, y + k * sy); ctx.moveTo(x + k, y + k * sy); ctx.lineTo(x + k, y + k * sy * 0.1);
    ctx.moveTo(x - k, y - k * sy); ctx.lineTo(x - k * 0.1, y - k * sy); ctx.moveTo(x - k, y - k * sy); ctx.lineTo(x - k, y - k * sy * 0.1);
    ctx.stroke(); ctx.restore();
  }
  function drawHandles() {
    if (lantern) drawHandle(lanternBox(), RS.lan, 'down');
    if (diya) drawHandle(diyaBox(), RS.diya, 'up');
  }
  function resizeMove() {
    const st = RS.start; if (!st) return;
    const f = Math.hypot(M.x - st.ax, M.y - st.ay) / st.d0, sc = Math.round(st.scale * f * 100) / 100;
    if (RS.active === 'lantern') setLanternScale(sc); else setDiyaScale(sc);
  }
  function updateCursor() {
    let c = 'default';
    if (sparklerActive()) c = 'none';
    else if (RS.active) c = RS.active === 'lantern' ? 'nwse-resize' : 'nesw-resize';
    else if (M.inside && !M.touch) {
      const h = handleAt(M.x, M.y);
      if (h) c = h === 'lantern' ? 'nwse-resize' : 'nesw-resize';
      else if ((lantern && lanternHit(M.x, M.y)) || diyaHit(M.x, M.y)) c = press && press.moved ? 'grabbing' : 'grab';
      else if ((lights && bulbAt(M.x, M.y)) || cordAt(M.x, M.y)) c = 'pointer';
    }
    if (cvs.style.cursor !== c) cvs.style.cursor = c;
  }
  function cordAt(x, y) {
    const L = lantern; if (!L || !L.attached) return false;
    const pts = [...L.rope, L.top];
    for (let i = 1; i < pts.length - 1; i++) if (distSeg(x, y, pts[i], pts[i + 1]) < 7 * U) return true;
    return false;
  }

  cvs.addEventListener('pointerdown', (e) => {
    Snd.unlock(); setPointer(e); M.down = true; M.hist.length = 0;
    try { cvs.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const x = e.clientX, y = e.clientY;
    press = { x, y, t: now(), target: null, moved: false };
    const h = handleAt(x, y);
    if (h) {
      press.target = 'resize'; RS.active = h;
      const ax = h === 'lantern' ? lantern.top.x : diya.x, ay = h === 'lantern' ? lantern.top.y : floorY;
      RS.start = { ax, ay, d0: Math.max(20, Math.hypot(x - ax, y - ay)), scale: h === 'lantern' ? lantern.sc : (S.diyaScale || 1) };
      return;
    }
    if (diyaHit(x, y)) press.target = 'diya';
    else if (lantern && lanternHit(x, y)) press.target = 'lantern';
    if (press.target && M.touch) { RS.touchObj = press.target; RS.touchUntil = now() + 4; }
    if (press.target === 'lantern') { const L = lantern; L.drag = { ox: x - L.top.x, oy: y - L.top.y, started: false, pending: true }; }
    if (press.target === 'diya') diya.drag = { ox: x - diya.x, pending: true };
  });
  cvs.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.moved = true;
    if (press && press.target === 'resize') resizeMove();
    if (DESKTOP && window.desktop && window.desktop.setIgnore) reportHit();
  });
  function endPress(e) {
    if (!press) { M.down = false; return; }
    const x = e.clientX, y = e.clientY, p = press; press = null; M.down = false;
    if (p.target === 'resize') { RS.active = null; RS.start = null; save(); if (M.touch) { RS.touchUntil = now() + 3; M.inside = false; } return; }
    const L = lantern;
    if (L && L.drag) {
      if (p.moved) { const v = avgVel(); L.top.px = L.top.x - v[0]; L.top.py = L.top.y - v[1]; }
      L.drag = null;
    }
    if (diya.drag) diya.drag = null;
    if (!p.moved) tap(x, y, p.target);
    if (M.touch) { M.inside = false; }
  }
  cvs.addEventListener('pointerup', endPress);
  cvs.addEventListener('pointercancel', endPress);
  cvs.addEventListener('pointerleave', (e) => { if (!press) { M.inside = false; } });
  cvs.addEventListener('contextmenu', (e) => { e.preventDefault(); if ((lantern && lanternHit(e.clientX, e.clientY)) || diyaHit(e.clientX, e.clientY)) openPanel(true); });
  function avgVel() { const h = M.hist.slice(-4); if (!h.length) return [0, 0]; let sx = 0, sy = 0; h.forEach((v) => { sx += v[0]; sy += v[1]; }); return [clamp(sx / h.length, -45, 45), clamp(sy / h.length, -45, 45)]; }

  function tap(x, y, target) {
    const t = now();
    const isDouble = t - lastTap.t < 0.33 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30;
    lastTap = isDouble ? { t: 0, x: 0, y: 0 } : { t, x, y };
    sparkleBurst(x, y, isDouble ? 10 : 18);
    Snd.tink();
    if (isDouble) {
      dropCracker(x, y);
      sparkler.until = now() + sparkler.total;
      return;
    }
    if (target === 'diya') { if (diya.lit) putOutDiya(); else lightDiya(); return; }
    if (target === 'lantern') { lantern.on = !lantern.on; Snd.click(); return; }
    if (cordAt(x, y)) { snapLantern('You cut the cord. The kandil drops.'); return; }
    const b = lights && bulbAt(x, y);
    if (b) { b.on = !b.on; Snd.click(); return; }
  }

  // pointer velocity sampled once per physics frame
  function samplePointer() {
    if (M.lx < -900) { M.lx = M.x; M.ly = M.y; }
    M.vx = M.x - M.lx; M.vy = M.y - M.ly; M.lx = M.x; M.ly = M.y;
    // lantern drag starts after a small move
    const L = lantern;
    if (press && press.moved && L && L.drag && L.drag.pending) L.drag.pending = false;
    if (L && L.drag && L.drag.pending && !press) L.drag = null;
    if (press && press.moved && diya.drag && diya.drag.pending) diya.drag.pending = false;
  }

  // desktop click-through reporting
  let lastIgnore = null;
  function reportHit() {
    if (!deskMode) { if (lastIgnore !== false) { window.desktop.setIgnore(false); lastIgnore = false; } return; }
    const hit = panelOpen || press || interactiveAt(M.x, M.y) || (!deskMode && overGear(M.x, M.y));
    const ignore = !hit;
    if (ignore !== lastIgnore) { window.desktop.setIgnore(ignore); lastIgnore = ignore; }
  }
  function overGear(x, y) { const r = gearBtn.getBoundingClientRect(); return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6; }

  // ======================================================================
  // UI: options panel
  // ======================================================================
  const panel = document.getElementById('panel'), gearBtn = document.getElementById('gear');
  let panelOpen = false, deskMode = false;
  function openPanel(v) {
    panelOpen = v; panel.hidden = !v;
    if (v) refreshChoices();
    if (DESKTOP && window.desktop && window.desktop.setIgnore) { window.desktop.setIgnore(false); lastIgnore = false; if (window.desktop.focus) window.desktop.focus(); }
  }
  gearBtn.addEventListener('click', () => openPanel(!panelOpen));
  document.getElementById('closePanel').addEventListener('click', () => openPanel(false));
  panel.addEventListener('pointerdown', (e) => { if (e.target === panel) openPanel(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) openPanel(false); });

  function makeChoices(el, items, key, draw) {
    el.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button'); b.className = 'choice'; b.type = 'button';
      const c = document.createElement('canvas'); b.appendChild(c);
      const label = document.createElement('span'); label.textContent = it.name; b.appendChild(label);
      b.addEventListener('click', () => { S[key] = i; save(); applyStyles(key); refreshChoices(); });
      el.appendChild(b); b._draw = (t) => draw(c, i, t); b._key = key; b._i = i;
    });
  }
  function prepThumb(c) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(60, r.width), h = Math.max(60, r.height);
    if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return [g, w, h];
  }
  function thumbLantern(c, i, t) {
    const [g, w, h] = prepThumb(c), m1 = lanternModel(i, 1), s = Math.min((h - 6) / m1.h, (w - 10) / m1.w) * 0.95, md = lanternModel(i, s);
    g.save(); g.translate(w / 2, 3); g.rotate(Math.sin(t * 1.3 + i) * 0.04); drawLanternModel(g, i, md, 0.45 + Math.sin(t * 0.7 + i) * 0.6, 1, t); g.restore();
  }
  function thumbLights(c, i, t) {
    const [g, w, h] = prepThumb(c), st = LIGHT_STYLES[i], n = 7;
    g.strokeStyle = st.wire; g.lineWidth = i === 1 ? 1 : 1.6; g.beginPath();
    const pt = (k) => { const f = k / (n - 1); return [6 + f * (w - 12), 18 + 34 * f * (1 - f)]; };
    for (let k = 0; k < n; k++) { const [x, y] = pt(k); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    for (let k = 0; k < n; k++) {
      const [x, y] = pt(k), b = { on: true, idx: k, tw: 1 + k * 0.1, phase: k }, lvl = bulbLevel(b, i, t);
      const col = i === 2 ? hslHex(Math.round(((t * 20 + k * 23) % 360) / 12) * 12 % 360) : st.colors[k % st.colors.length];
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * 0.9; const r = i === 1 ? 10 : 15; g.drawImage(glowSprite(col), x - r, y + 6 - r, r * 2, r * 2); g.restore();
      drawBulb(g, i, x, y, 0, col, lvl, 1, t, k);
    }
  }
  function thumbDiya(c, i, t) {
    const [g, w, h] = prepThumb(c), s = Math.min((w - 8) / 92, (h - 8) / (i === 2 ? 66 : 44));
    const bx = w / 2, by = h - 5, [wx, wy] = diyaWick(i, s);
    g.save(); g.translate(bx, by); drawDiyaBody(g, i, s, 1); g.restore();
    drawFlame(g, bx + wx, by + wy, s, 1, Math.sin(t * 1.7) * 0.06, t);
  }
  const chL = document.getElementById('chLantern'), chB = document.getElementById('chLights'), chD = document.getElementById('chDiya');
  makeChoices(chL, LANTERN_STYLES, 'lantern', thumbLantern);
  makeChoices(chB, LIGHT_STYLES, 'lights', thumbLights);
  makeChoices(chD, DIYA_STYLES, 'diya', thumbDiya);
  function refreshChoices() { document.querySelectorAll('.choice').forEach((b) => b.classList.toggle('on', S[b._key] === b._i)); }
  function drawThumbs(t) { if (!panelOpen) return; document.querySelectorAll('.choice').forEach((b) => b._draw(t)); }
  function applyStyles(key) {
    if (key === 'lantern') { const on = lantern ? lantern.on : true; lantern = null; buildLantern(); lantern.on = on; }
    if (key === 'lights') buildLights();
  }
  document.getElementById('btnSizes').addEventListener('click', () => { setLanternScale(1); setDiyaScale(1.3); save(); Snd.tink(); });
  document.getElementById('btnRehang').addEventListener('click', () => { const on = lantern ? lantern.on : true; lantern = null; buildLantern(); lantern.on = on; Snd.tink(); });
  document.getElementById('btnLights').addEventListener('click', () => { const any = lights.bulbs.some((b) => b.on); lights.bulbs.forEach((b) => (b.on = !any)); lantern.on = !any; diya.lit = !any; Snd.click(); });
  document.getElementById('btnClear').addEventListener('click', () => { crackers.length = 0; parts.length = 0; });
  const optSound = document.getElementById('optSound'), optSpark = document.getElementById('optSparkler'), optDesk = document.getElementById('optDesk');
  optSound.checked = !!S.sound; optSound.addEventListener('change', () => { S.sound = optSound.checked; save(); });
  optSpark.checked = !!S.sparklerAlways; optSpark.addEventListener('change', () => { S.sparklerAlways = optSpark.checked; save(); });
  optDesk.addEventListener('change', () => { if (window.desktop && window.desktop.setMode) window.desktop.setMode(optDesk.checked ? 'desktop' : 'celebrate'); });
  document.getElementById('btnQuit').addEventListener('click', () => { if (window.desktop && window.desktop.quit) window.desktop.quit(); });
  // links: desktop opens in default browser
  document.querySelectorAll('a[target=_blank]').forEach((a) => a.addEventListener('click', (e) => { if (window.desktop && window.desktop.openExternal) { e.preventDefault(); window.desktop.openExternal(a.href); } }));
  // share links (web)
  {
    const url = 'https://arunkw.github.io/diwali-lantern/';
    const msg = 'Light a kandil with me this Diwali. Tap it, swing it, pluck it, burst a cracker. Happy Diwali from Doneology Labs!';
    const enc = encodeURIComponent;
    document.getElementById('shWa').href = 'https://wa.me/?text=' + enc(msg + ' ' + url);
    document.getElementById('shX').href = 'https://twitter.com/intent/tweet?text=' + enc(msg) + '&url=' + enc(url);
    document.getElementById('shLi').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(url);
    document.getElementById('shFb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + enc(url);
    const nb = document.getElementById('shNative');
    if (!navigator.share) nb.style.display = 'none';
    nb.addEventListener('click', () => navigator.share({ title: 'Diwali Lantern', text: msg, url }).catch(() => {}));
  }

  // hint toast
  const hintEl = document.getElementById('hint'); let hintTimer = 0;
  function showHint(text, ms = 3500) { hintEl.textContent = text; hintEl.classList.add('show'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hintEl.classList.remove('show'), ms); }

  // desktop bridge
  if (DESKTOP && window.desktop) {
    if (window.desktop.onMode) window.desktop.onMode((m, first) => {
      deskMode = m === 'desktop'; optDesk.checked = deskMode; document.body.classList.toggle('overlay', deskMode);
      lastIgnore = null; if (window.desktop.setIgnore) reportHit();
      showHint(deskMode
        ? (first ? 'Diwali Lantern is floating over your apps. Keep working as usual; the kandil, diya and bulbs stay clickable. Right-click the kandil or diya for options. Ctrl+Shift+Q quits.' : 'Overlay mode: clicks on empty space go to your apps.')
        : 'Play mode: every click goes to the scene. Ctrl+Shift+D returns to overlay mode.', first ? 7000 : 3200);
    });
    if (window.desktop.onOpenOptions) window.desktop.onOpenOptions(() => openPanel(true));
    // a click that passed through the overlay to another app still leaves a sparkle (double-click: a cracker)
    if (window.desktop.onGlobalClick) window.desktop.onGlobalClick((x, y) => { if (panelOpen) return; M.x = x; M.y = y; M.inside = true; tap(x, y, null); });
  }


  // ======================================================================
  // LOOP
  // ======================================================================
  let shake = 0, stars = [];
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    U = clamp(Math.min(W / 560, H / 770), 0.62, 1.25);
    floorY = H - (DESKTOP ? 1 : 6);
    const keepOn = lantern ? lantern.on : true;
    lantern = null; buildLantern(); lantern.on = keepOn;
    buildLights(); buildDiya();
    stars = []; if (!DESKTOP) for (let i = 0; i < Math.round(W * H / 9000); i++) stars.push([Math.random() * W, Math.random() * H * 0.85, Math.random() * 1.3 + 0.2, Math.random() * TAU]);
  }
  window.addEventListener('resize', () => { clearTimeout(resize._t); resize._t = setTimeout(resize, 120); });

  function drawBackground(t) {
    if (DESKTOP) return;
    for (const s of stars) { ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + s[3])); ctx.fillStyle = '#fff'; ctx.fillRect(s[0], s[1], s[2], s[2]); }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, floorY - 40 * U, 0, H); g.addColorStop(0, 'rgba(60,30,40,0)'); g.addColorStop(1, 'rgba(60,30,40,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, floorY - 40 * U, W, H - floorY + 40 * U);
  }

  let last = performance.now(), acc = 0;
  const STEP = 1000 / 60;
  function frame(ms) {
    const dtMs = Math.min(100, ms - last); last = ms; acc += dtMs;
    const t = ms / 1000;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      samplePointer();
      updateLights(); updateLantern(); updateDiya(STEP / 1000, t); updateCrackers(STEP / 1000, t); updateSparkler(); updateParts(STEP / 1000);
      M.hist.length > 12 && M.hist.splice(0, M.hist.length - 12);
      acc -= STEP; steps++;
    }
    if (steps === 4) acc = 0;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (shake > 0.2) { ctx.translate(rand(-shake, shake), rand(-shake, shake)); shake *= 0.86; } else shake = 0;
    drawBackground(t);
    drawParts(false);
    drawCrackers(t);
    drawDiya(t);
    drawLantern(t);
    drawLights(t);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; drawParts(true); ctx.restore();
    updateHandles(); drawHandles(); updateCursor();
    drawSparkler(t);
    drawThumbs(t);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
  if (!DESKTOP) setTimeout(() => showHint(window.matchMedia('(pointer: coarse)').matches
    ? 'Tap the kandil, bulbs or diya. Drag the kandil to swing it, pull hard to pluck. Tap it, then drag the corner handle to resize. Double-tap for a cracker. ⚙ for options.'
    : 'Click the kandil, bulbs or diya. Drag the kandil to swing it, pull hard to pluck. Drag the corner handle to resize. Double-click for a cracker. ⚙ for options.', 6500), 600);

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // test hooks (used by automated checks)
  window.__diwali = { get lantern() { return lantern; }, get lights() { return lights; }, get diya() { return diya; }, get crackers() { return crackers; }, get RS() { return RS; }, tap, dropCracker, S, lanternBox, diyaBox };
})();
