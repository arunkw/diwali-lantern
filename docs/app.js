/* Diwali Lantern - (c) 2026 Doneology Labs (OPC) Pvt Ltd - MIT License
 * One canvas engine shared by the web/PWA build and the Windows desktop overlay.
 * Physics: Verlet integration with distance constraints (ropes, strips, tinsel, bulbs, kandil).
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
  const defaults = { lantern: 0, lights: 0, diya: 0, tag: 'शुभ दीपावली', sound: true, sparklerAlways: false };
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
  // LANTERN (kandil)
  // ======================================================================
  const LANTERN_STYLES = [
    { name: 'Akash Kandil', paper: '#e8461f', trim: '#ffcc33', light: '#ffb347', strips: ['#ff3b30', '#ffcc00', '#ff7a00', '#e91e63'] },
    { name: 'Star Kandil', paper: '#e8237a', trim: '#ffd84a', light: '#ff9ad0', strips: ['#ff2d78', '#ffd400', '#8e44ff', '#00b8a9'] },
    { name: 'Paper Globe', paper: '#c8102e', trim: '#f5c542', light: '#ffa94d', strips: ['#c8102e', '#ff8f00', '#f5c542', '#7b1fa2'] },
  ];
  function lanternDims(style, u) {
    if (style === 0) { const w = 112 * u, h = 168 * u; const y3 = h * 0.66, y4 = h * 0.88; return { w, h, attach: [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map((f) => [f * w, y3]), tag: [0, y4] }; }
    if (style === 1) {
      const R = 74 * u, r = R * 0.45, cy = R + 10 * u, h = cy + R;
      const tip = (deg) => [Math.cos(deg * Math.PI / 180) * R, cy + Math.sin(deg * Math.PI / 180) * R];
      const a = tip(54), b = tip(126), inner = [0, cy + r];
      return { w: R * 2, h, R, r, cy, attach: [[a[0] - 6 * u, a[1]], [a[0] + 4 * u, a[1] - 2 * u], [b[0] + 6 * u, b[1]], [b[0] - 4 * u, b[1] - 2 * u], [inner[0] - 8 * u, inner[1]], [inner[0] + 8 * u, inner[1]]], tag: inner };
    }
    const w = 120 * u, h = 156 * u, cy = h * 0.5, ry = h * 0.38, by = cy + ry + 6 * u;
    return { w, h, cy, ry, attach: [-0.32, -0.19, -0.07, 0.07, 0.19, 0.32].map((f) => [f * w, by]), tag: [0, by + 4 * u] };
  }

  // draw lantern body in local coordinates (hook at 0,0; y down)
  function drawLanternBody(g, style, u, lvl, t) {
    const st = LANTERN_STYLES[style], D = lanternDims(style, u);
    const pf = 0.42 + 0.58 * lvl; // paper brightness
    const flick = 1 + Math.sin(t * 9.1) * 0.03 + Math.sin(t * 13.7) * 0.02;
    g.lineJoin = 'round';
    // hook ring
    g.strokeStyle = shade(st.trim, 0.8); g.lineWidth = 2 * u;
    g.beginPath(); g.arc(0, 3 * u, 3 * u, 0, TAU); g.stroke();

    if (style === 0) {
      const { w, h } = D, y1 = h * 0.08, y2 = h * 0.32, y3 = h * 0.66, y4 = h * 0.88;
      // inner glow behind paper
      if (lvl > 0.01) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * flick; g.drawImage(glowSprite(st.light), -w, (y2 + y3) / 2 - w, w * 2, w * 2); g.restore(); }
      // cap
      g.fillStyle = shade(st.trim, 0.55 + 0.4 * lvl); g.fillRect(-w * 0.12, 5 * u, w * 0.24, y1 - 5 * u);
      // top pyramid: two faces
      g.fillStyle = shade(st.paper, pf * 0.8); g.beginPath(); g.moveTo(-w * 0.12, y1); g.lineTo(0, y1); g.lineTo(-w * 0.17, y2); g.lineTo(-w / 2, y2); g.closePath(); g.fill();
      g.fillStyle = shade(st.paper, pf * 1.0); g.beginPath(); g.moveTo(-w * 0.04, y1); g.lineTo(w * 0.04, y1); g.lineTo(w * 0.17, y2); g.lineTo(-w * 0.17, y2); g.closePath(); g.fill();
      g.fillStyle = shade(st.paper, pf * 0.7); g.beginPath(); g.moveTo(0, y1); g.lineTo(w * 0.12, y1); g.lineTo(w / 2, y2); g.lineTo(w * 0.17, y2); g.closePath(); g.fill();
      // band: three hexagon faces
      const faces = [[-w / 2, -w / 6, 0.78], [-w / 6, w / 6, 1.0], [w / 6, w / 2, 0.68]];
      for (const [x0, x1, f] of faces) {
        g.fillStyle = shade(st.paper, pf * f); g.fillRect(x0, y2, x1 - x0, y3 - y2);
        // diamond window + dots showing the light
        const cx = (x0 + x1) / 2, cy = (y2 + y3) / 2, hw = (x1 - x0) * 0.28, hh = (y3 - y2) * 0.32;
        g.fillStyle = lvl > 0.02 ? shade('#fff0b8', 0.55 + 0.45 * lvl * flick) : shade(st.paper, 0.32);
        g.beginPath(); g.moveTo(cx, cy - hh); g.lineTo(cx + hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx - hw, cy); g.closePath(); g.fill();
        for (const dy of [-hh * 1.25, hh * 1.25]) { g.beginPath(); g.arc(cx, cy + dy, 2.2 * u, 0, TAU); g.fill(); }
        g.strokeStyle = shade(st.trim, 0.5 + 0.5 * lvl); g.lineWidth = 1.2 * u; g.strokeRect(x0, y2, x1 - x0, y3 - y2);
      }
      // frills
      g.fillStyle = shade(st.trim, 0.6 + 0.4 * lvl);
      for (let i = 0; i < 12; i++) { const x = -w / 2 + (i + 0.5) * (w / 12); g.beginPath(); g.moveTo(x - w / 24, y2); g.lineTo(x, y2 + 6 * u); g.lineTo(x + w / 24, y2); g.fill(); g.beginPath(); g.moveTo(x - w / 24, y3); g.lineTo(x, y3 - 6 * u); g.lineTo(x + w / 24, y3); g.fill(); }
      // bottom pyramid
      g.fillStyle = shade(st.paper, pf * 0.75); g.beginPath(); g.moveTo(-w / 2, y3); g.lineTo(-w * 0.17, y3); g.lineTo(-w * 0.03, y4); g.lineTo(-w * 0.08, y4); g.closePath(); g.fill();
      g.fillStyle = shade(st.paper, pf * 0.95); g.beginPath(); g.moveTo(-w * 0.17, y3); g.lineTo(w * 0.17, y3); g.lineTo(w * 0.05, y4); g.lineTo(-w * 0.05, y4); g.closePath(); g.fill();
      g.fillStyle = shade(st.paper, pf * 0.62); g.beginPath(); g.moveTo(w * 0.17, y3); g.lineTo(w / 2, y3); g.lineTo(w * 0.08, y4); g.lineTo(w * 0.03, y4); g.closePath(); g.fill();
      g.strokeStyle = shade(st.trim, 0.55 + 0.45 * lvl); g.lineWidth = 1.4 * u;
      g.beginPath(); g.moveTo(-w / 2, y2); g.lineTo(-w * 0.12, y1); g.moveTo(w / 2, y2); g.lineTo(w * 0.12, y1); g.moveTo(-w / 2, y3); g.lineTo(-w * 0.08, y4); g.lineTo(w * 0.08, y4); g.lineTo(w / 2, y3); g.stroke();
    } else if (style === 1) {
      const { R, r, cy } = D;
      if (lvl > 0.01) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * flick; g.drawImage(glowSprite(st.light), -R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2); g.restore(); }
      g.strokeStyle = shade(st.trim, 0.6); g.lineWidth = 2 * u; g.beginPath(); g.moveTo(0, 6 * u); g.lineTo(0, cy - R); g.stroke();
      const v = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; v.push([Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      for (let i = 0; i < 10; i++) {
        const a = v[i], b = v[(i + 1) % 10];
        g.fillStyle = shade(st.paper, pf * (i % 2 ? 0.72 : 1.02));
        g.beginPath(); g.moveTo(0, cy); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath(); g.fill();
      }
      g.strokeStyle = shade(st.trim, 0.55 + 0.45 * lvl); g.lineWidth = 1.6 * u;
      g.beginPath(); v.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke();
      // inner star with cut-work
      const s2 = 0.52; g.fillStyle = lvl > 0.02 ? shade('#fff2a8', 0.6 + 0.4 * lvl * flick) : shade(st.trim, 0.45);
      g.beginPath(); v.forEach((p, i) => { const x = p[0] * s2, y = cy + (p[1] - cy) * s2; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill();
      g.fillStyle = shade(st.paper, pf * 0.85);
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5; g.beginPath(); g.arc(Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2, 3.2 * u, 0, TAU); g.fill(); }
      g.beginPath(); g.arc(0, cy, 4 * u, 0, TAU); g.fill();
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5, x = Math.cos(a) * R * 0.72, y = cy + Math.sin(a) * R * 0.72; g.fillStyle = lvl > 0.02 ? shade('#fff2a8', 0.5 + 0.5 * lvl) : shade(st.paper, 0.35); g.beginPath(); g.arc(x, y, 2.6 * u, 0, TAU); g.fill(); }
    } else {
      const { w, cy, ry } = D, rx = w / 2;
      if (lvl > 0.01) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = lvl * flick; g.drawImage(glowSprite(st.light), -w * 1.1, cy - w * 1.1, w * 2.2, w * 2.2); g.restore(); }
      g.strokeStyle = shade(st.trim, 0.6); g.lineWidth = 2 * u; g.beginPath(); g.moveTo(0, 6 * u); g.lineTo(0, cy - ry - 8 * u); g.stroke();
      const gr = g.createRadialGradient(-rx * 0.2, cy - ry * 0.2, 2, 0, cy, rx * 1.05);
      gr.addColorStop(0, lvl > 0.02 ? shade('#ffe1a0', 0.6 + 0.45 * lvl * flick) : shade(st.paper, 0.6));
      gr.addColorStop(0.55, shade(st.paper, pf)); gr.addColorStop(1, shade(st.paper, pf * 0.55));
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, cy, rx, ry, 0, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.ellipse(0, cy, rx, ry, 0, 0, TAU); g.clip();
      g.strokeStyle = shade(st.trim, 0.45 + 0.4 * lvl); g.lineWidth = 1.1 * u;
      for (let k = 1; k <= 4; k++) { const ex = rx * k / 4.4; g.beginPath(); g.ellipse(0, cy, ex, ry, 0, 0, TAU); g.stroke(); }
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(0, cy + k * ry * 0.35, rx, 3 * u, 0, 0, TAU); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1; }
      // mandala medallion
      g.fillStyle = lvl > 0.02 ? shade('#fff0b0', 0.55 + 0.45 * lvl) : shade(st.trim, 0.45);
      g.beginPath(); g.arc(0, cy, ry * 0.28, 0, TAU); g.fill();
      g.fillStyle = shade(st.paper, pf * 0.9);
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.beginPath(); g.ellipse(Math.cos(a) * ry * 0.15, cy + Math.sin(a) * ry * 0.15, 4 * u, 2 * u, a, 0, TAU); g.fill(); }
      g.restore();
      g.fillStyle = shade(st.trim, 0.55 + 0.45 * lvl);
      g.beginPath(); g.ellipse(0, cy - ry, rx * 0.36, 7 * u, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(0, cy + ry, rx * 0.36, 7 * u, 0, 0, TAU); g.fill();
      g.fillRect(-rx * 0.36, cy - ry - 8 * u, rx * 0.72, 4 * u); g.fillRect(-rx * 0.36, cy + ry + 3 * u, rx * 0.72, 4 * u);
    }
  }

  let lantern = null;
  function buildLantern() {
    const style = S.lantern, D = lanternDims(style, U);
    const ax = clamp(W * (W < 700 ? 0.5 : 0.24), D.w * 0.7, W - D.w * 0.7);
    const ropeLen = clamp(H * 0.17, 70 * U, 220 * U);
    const n = 10, seg = ropeLen / n;
    const rope = []; for (let i = 0; i <= n; i++) rope.push(P(ax, i * seg, 1));
    rope[0].pinned = true;
    const top = P(ax, ropeLen + 2, 0.14), bot = P(ax, ropeLen + D.h, 0.14);
    const cons = []; for (let i = 0; i < n; i++) cons.push(C(rope[i], rope[i + 1], seg, true));
    cons.push(C(rope[n], top, 2, true));
    const body = C(top, bot, D.h);
    const L = { style, D, rope, top, bot, cons, body, attached: true, on: lantern ? lantern.on : true, lvl: lantern ? lantern.lvl : 1, strips: [], tag: null, ropeLen, drag: null, cut: false };
    // strips: paper ribbons alternating with gold / silver tinsel
    const st = LANTERN_STYLES[style];
    D.attach.forEach((a, i) => {
      const type = i % 3 === 1 ? 'gold' : i % 3 === 2 ? 'silver' : 'paper';
      const segs = 9, len = rand(9, 12.5) * U;
      const pts = [], sc = [];
      for (let k = 0; k <= segs; k++) pts.push(P(ax + a[0], top.y + a[1] + k * len, 1));
      pts[0].pinned = true;
      for (let k = 0; k < segs; k++) sc.push(C(pts[k], pts[k + 1], len, true));
      L.strips.push({ pts, cons: sc, type, color: st.strips[i % st.strips.length], a, attached: true, width: (type === 'paper' ? 5.5 : 4) * U, seed: rand(0, 99) });
    });
    // tag: short string + card
    {
      const segs = 3, len = 9 * U, pts = [], sc = [];
      for (let k = 0; k <= segs; k++) pts.push(P(ax + D.tag[0], top.y + D.tag[1] + k * len, k === segs ? 0.7 : 1));
      pts[0].pinned = true;
      for (let k = 0; k < segs; k++) sc.push(C(pts[k], pts[k + 1], len, true));
      const card = P(pts[segs].x, pts[segs].y + 30 * U, 0.8);
      sc.push(C(pts[segs], card, 30 * U));
      L.tag = { pts, cons: sc, card, attached: true };
    }
    lantern = L;
  }
  function lanternFrame(L) {
    const dx = L.bot.x - L.top.x, dy = L.bot.y - L.top.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    return { ux, uy, ang: Math.atan2(-ux, uy), toWorld: (lx, ly) => [L.top.x + lx * uy + ly * ux, L.top.y - lx * ux + ly * uy], toLocal: (x, y) => { const rx = x - L.top.x, ry = y - L.top.y; return [rx * uy - ry * ux, rx * ux + ry * uy]; } };
  }
  function lanternHit(x, y) {
    const L = lantern; if (!L) return false;
    const F = lanternFrame(L), [lx, ly] = F.toLocal(x, y);
    return Math.abs(lx) < L.D.w * 0.52 && ly > -4 * U && ly < L.D.h * (L.style === 0 ? 0.9 : 1) + 2 * U;
  }
  function distSeg(px, py, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, wx = px - a.x, wy = py - a.y;
    const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1), 0, 1);
    return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
  }
  function snapLantern(why) {
    const L = lantern; if (!L || !L.attached) return;
    L.attached = false; L.cut = true;
    L.cons = L.cons.filter((c) => c.b !== L.top);
    Snd.snap();
    for (let i = 0; i < 8; i++) addP({ x: L.top.x, y: L.top.y, vx: rand(-2, 2) * U, vy: rand(-2, 1) * U, max: 0.5, size: 1.5 * U, type: 'spark', color: '#fff2c0', g: 0.1 * U });
    if (why) showHint(why, 2200);
  }

  function updateLantern() {
    const L = lantern; if (!L) return;
    L.lvl = lerp(L.lvl, L.on ? 1 : 0, 0.12);
    for (const p of L.rope) { integrate(p, 0.985); handTouch(p, 26 * U, 0.4); }
    if (!(L.drag)) { integrate(L.top, 0.996); integrate(L.bot, 0.996); }
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
    // light hand-brush on hanging lantern
    if (!L.drag && L.attached) { handTouch(L.bot, L.D.w * 0.45, 0.06); }
    const F0 = lanternFrame(L);
    // strips & tag follow lantern
    const pinStrip = (s, a) => { if (!s.attached) return; const [x, y] = F0.toWorld(a[0], a[1]); s.pts[0].x = s.pts[0].px = x; s.pts[0].y = s.pts[0].py = y; };
    for (const s of L.strips) { pinStrip(s, s.a); for (const p of s.pts) { integrate(p, 0.975); handTouch(p, 34 * U, 0.6); } }
    pinStrip(L.tag, L.D.tag); for (const p of L.tag.pts) integrate(p, 0.98); integrate(L.tag.card, 0.98); handTouch(L.tag.card, 30 * U, 0.5);
    const allCons = [L.body, ...L.cons];
    for (let it = 0; it < 14; it++) {
      for (const c of allCons) solve(c);
      if (L.drag && L.drag.tx !== undefined) { L.top.x = L.drag.tx; L.top.y = L.drag.ty; }
      const r = L.D.w * 0.5; collide(L.top, r * (L.attached ? 0.6 : 0.9)); collide(L.bot, r);
    }
    for (const p of L.rope) collide(p, 1);
    const F = lanternFrame(L);
    for (const s of L.strips) {
      if (s.attached) { const [x, y] = F.toWorld(s.a[0], s.a[1]); s.pts[0].x = x; s.pts[0].y = y; }
      for (let it = 0; it < 6; it++) for (const c of s.cons) solve(c);
      for (const p of s.pts) collide(p, 2 * U, 0.6, 0.1);
    }
    { const [x, y] = F.toWorld(L.D.tag[0], L.D.tag[1]); L.tag.pts[0].x = x; L.tag.pts[0].y = y; for (let it = 0; it < 6; it++) for (const c of L.tag.cons) solve(c); for (const p of L.tag.pts) collide(p, 2 * U); collide(L.tag.card, 10 * U, 0.6, 0.2); }
  }

  function drawStrip(s, t) {
    const pts = s.pts;
    if (s.type === 'paper') {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2; ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my); }
      const e = pts[pts.length - 1]; ctx.lineTo(e.x, e.y); ctx.stroke();
      // crease highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = s.width * 0.25; ctx.stroke();
      // cut V tail
      const p = pts[pts.length - 2], dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.moveTo(e.x + nx * s.width / 2, e.y + ny * s.width / 2); ctx.lineTo(e.x + dx / d * 6 * U + nx * s.width / 2, e.y + dy / d * 6 * U + ny * s.width / 2); ctx.lineTo(e.x, e.y + 0); ctx.lineTo(e.x + dx / d * 6 * U - nx * s.width / 2, e.y + dy / d * 6 * U - ny * s.width / 2); ctx.lineTo(e.x - nx * s.width / 2, e.y - ny * s.width / 2); ctx.fill();
    } else {
      const base = s.type === 'gold' ? ['#fff1a8', '#ffd23f', '#e6a817', '#fff8d6'] : ['#ffffff', '#d9e2ec', '#aab7c4', '#f4f8ff'];
      ctx.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
        ctx.strokeStyle = base[2]; ctx.lineWidth = 1.2 * U; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const n = 7;
        for (let k = 0; k < n; k++) {
          const f = k / n, x = a.x + dx * f, y = a.y + dy * f, h = Math.sin((i * n + k) * 12.9898 + s.seed) * 43758.5453;
          const r = (h - Math.floor(h)), len = s.width * (0.8 + r * 0.9), sh = Math.sin(t * 6 + i * 1.7 + k * 2.3 + s.seed);
          ctx.strokeStyle = base[(k + i) % 4]; ctx.lineWidth = 0.9 * U; ctx.globalAlpha = 0.65 + 0.35 * sh;
          ctx.beginPath(); ctx.moveTo(x - nx * len, y - ny * len); ctx.lineTo(x + nx * len, y + ny * len); ctx.stroke();
          if (sh > 0.93) { ctx.globalAlpha = 1; glow(x, y, 6 * U, base[0], 0.9); }
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  function drawRope(pts, color, w) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  function wrapText(text, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines.slice(0, 2);
  }
  function drawLantern(t) {
    const L = lantern; if (!L) return;
    drawRope(L.rope, 'rgba(220,200,160,0.9)', 1.6 * U);
    if (L.attached) drawRope([L.rope[L.rope.length - 1], L.top], 'rgba(220,200,160,0.9)', 1.6 * U);
    for (const s of L.strips) if (!s.front) drawStrip(s, t);
    const F = lanternFrame(L);
    ctx.save(); ctx.translate(L.top.x, L.top.y); ctx.rotate(F.ang); drawLanternBody(ctx, L.style, U, L.lvl, t); ctx.restore();
    // tag
    const tg = L.tag; drawRope([...tg.pts], 'rgba(255,230,170,0.9)', 1 * U);
    const last = tg.pts[tg.pts.length - 1], c = tg.card, ang = Math.atan2(-(c.x - last.x), c.y - last.y);
    ctx.save(); ctx.translate(last.x, last.y); ctx.rotate(ang);
    ctx.font = `600 ${13 * U}px "Nirmala UI","Noto Sans Devanagari","Segoe UI",system-ui,sans-serif`;
    const lines = wrapText(S.tag || ' ', 96 * U);
    const tw = Math.max(54 * U, ...lines.map((l) => ctx.measureText(l).width)) + 18 * U, th = (lines.length * 16 + 14) * U;
    ctx.fillStyle = '#fff4dc'; ctx.strokeStyle = '#c99a2e'; ctx.lineWidth = 1.4 * U;
    ctx.beginPath(); ctx.moveTo(-tw / 2 + 8 * U, 0); ctx.lineTo(tw / 2 - 8 * U, 0); ctx.lineTo(tw / 2, 8 * U); ctx.lineTo(tw / 2, th); ctx.lineTo(-tw / 2, th); ctx.lineTo(-tw / 2, 8 * U); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c99a2e'; ctx.beginPath(); ctx.arc(0, 5 * U, 2.2 * U, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a1c12'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, 0, (16 + i * 16) * U));
    ctx.restore();
    L.tagBox = { x: last.x, y: last.y, w: tw, h: th, ang };
    // floor light pool when lit and hanging
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
  // DIYA (clay lamp)
  // ======================================================================
  const DIYA_STYLES = [{ name: 'Classic Terracotta' }, { name: 'Painted Diya' }, { name: 'Lotus Diya' }];
  let diya = null;
  function buildDiya() {
    const x = diya ? clamp(diya.x, 60 * U, W - 60 * U) : W - 70 * U - (DESKTOP ? 30 : 0);
    diya = { x, lit: diya ? diya.lit : true, lvl: diya ? diya.lvl : 1, lean: 0, wind: 0, drag: null, vx: 0 };
  }
  function diyaWick(style, u) { return style === 2 ? [0, -26 * u] : [37 * u, -22 * u]; }
  function drawDiyaBody(g, style, u, lit, t) {
    if (style === 2) {
      // lotus
      const petal = (ang, len, wid, col, edge) => { g.save(); g.rotate(ang); g.fillStyle = col; g.strokeStyle = edge; g.lineWidth = 1 * u; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-wid, -len * 0.55, 0, -len); g.quadraticCurveTo(wid, -len * 0.55, 0, 0); g.fill(); g.stroke(); g.restore(); };
      g.save(); g.translate(0, -6 * u);
      for (const a of [-1.25, -0.75, 0.75, 1.25]) petal(a, 34 * u, 12 * u, '#e66a9a', '#b83b6c');
      g.restore();
      g.fillStyle = '#c99a2e'; g.beginPath(); g.ellipse(0, -18 * u, 20 * u, 6 * u, 0, 0, TAU); g.fill();
      g.fillStyle = '#7a4a10'; g.beginPath(); g.ellipse(0, -18 * u, 16 * u, 4 * u, 0, 0, TAU); g.fill();
      g.fillStyle = lit ? '#e8b84a' : '#a07a2a'; g.beginPath(); g.ellipse(0, -18 * u, 13 * u, 3 * u, 0, 0, TAU); g.fill();
      g.save(); g.translate(0, -2 * u);
      for (const a of [-0.95, -0.45, 0, 0.45, 0.95]) petal(a * 1.0, 26 * u, 10 * u, '#f7a8c6', '#c94f7f');
      g.restore();
      g.fillStyle = '#5e8f3e'; g.beginPath(); g.ellipse(0, -1 * u, 26 * u, 4 * u, 0, 0, TAU); g.fill();
      g.strokeStyle = '#3b2412'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(0, -18 * u); g.lineTo(0, -26 * u); g.stroke();
      return;
    }
    const painted = style === 1;
    const bodyCol = painted ? ['#d63a2a', '#8c1d14'] : ['#c4622f', '#7a3013'];
    const gr = g.createLinearGradient(0, -20 * u, 0, 0); gr.addColorStop(0, bodyCol[0]); gr.addColorStop(1, bodyCol[1]);
    // spout
    g.fillStyle = bodyCol[1]; g.beginPath(); g.moveTo(22 * u, -20 * u); g.quadraticCurveTo(36 * u, -24 * u, 42 * u, -22 * u); g.quadraticCurveTo(36 * u, -14 * u, 22 * u, -10 * u); g.closePath(); g.fill();
    // bowl
    g.fillStyle = gr; g.beginPath(); g.moveTo(-32 * u, -18 * u); g.bezierCurveTo(-30 * u, -2 * u, -14 * u, 0, 0, 0); g.bezierCurveTo(16 * u, 0, 30 * u, -4 * u, 32 * u, -18 * u); g.closePath(); g.fill();
    // rim + oil
    g.fillStyle = painted ? '#e9b949' : '#9a4520'; g.beginPath(); g.ellipse(0, -18 * u, 32 * u, 7 * u, 0, 0, TAU); g.fill();
    g.fillStyle = painted ? '#6d1a12' : '#4a1c0a'; g.beginPath(); g.ellipse(0, -18 * u, 28 * u, 5.4 * u, 0, 0, TAU); g.fill();
    g.fillStyle = lit ? '#d9a63a' : '#8a6a28'; g.beginPath(); g.ellipse(2 * u, -17.6 * u, 22 * u, 3.6 * u, 0, 0, TAU); g.fill();
    if (lit) { g.fillStyle = 'rgba(255,240,190,0.55)'; g.beginPath(); g.ellipse(14 * u, -18 * u, 6 * u, 1.3 * u, 0, 0, TAU); g.fill(); }
    if (painted) {
      g.fillStyle = '#fff3dc'; for (let i = -5; i <= 5; i++) { g.beginPath(); g.arc(i * 5 * u, -9 * u + Math.abs(i) * 0.45 * u, 1.3 * u, 0, TAU); g.fill(); }
      g.fillStyle = '#2bb673'; for (const x of [-18, 0, 18]) { g.beginPath(); g.ellipse(x * u, -4 * u - Math.abs(x) * 0.12 * u, 3.2 * u, 1.6 * u, 0.4, 0, TAU); g.fill(); }
      g.strokeStyle = '#ffd34d'; g.lineWidth = 1.2 * u; g.beginPath(); g.ellipse(0, -18 * u, 32 * u, 7 * u, 0, 0, TAU); g.stroke();
    } else {
      g.strokeStyle = 'rgba(255,190,140,0.25)'; g.lineWidth = 1 * u; g.beginPath(); g.moveTo(-24 * u, -8 * u); g.quadraticCurveTo(0, -3 * u, 24 * u, -9 * u); g.stroke();
    }
    // wick
    g.strokeStyle = '#f2e6cf'; g.lineWidth = 2.2 * u; g.beginPath(); g.moveTo(30 * u, -19 * u); g.lineTo(37 * u, -22 * u); g.stroke();
    g.strokeStyle = '#2a1a10'; g.lineWidth = 2.2 * u; g.beginPath(); g.moveTo(36 * u, -21.6 * u); g.lineTo(37.5 * u, -22.4 * u); g.stroke();
  }
  function drawFlame(g, x, y, u, lvl, lean, t) {
    if (lvl < 0.02) return;
    const fl = 1 + Math.sin(t * 11.3) * 0.06 + Math.sin(t * 17.9 + 1) * 0.05 + Math.sin(t * 5.1) * 0.04;
    const h = 30 * u * lvl * fl, w = 8.5 * u * lvl, tipX = x + lean * h * 0.9 + Math.sin(t * 7.7) * 1.2 * u;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.85 * lvl; g.drawImage(glowSprite('#ff9d2e'), x - 90 * u, y - h * 0.5 - 90 * u, 180 * u, 180 * u);
    g.globalAlpha = 0.6 * lvl; g.drawImage(glowSprite('#ffd27a'), x - 30 * u, y - h * 0.6 - 30 * u, 60 * u, 60 * u);
    g.restore();
    const shape = (sc, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(x - w * sc, y); g.bezierCurveTo(x - w * sc * 1.15, y - h * sc * 0.45, lerp(x, tipX, 0.6) - w * sc * 0.3, y - h * sc * 0.75, lerp(x, tipX, sc), y - h * sc); g.bezierCurveTo(lerp(x, tipX, 0.6) + w * sc * 0.3, y - h * sc * 0.75, x + w * sc * 1.15, y - h * sc * 0.45, x + w * sc, y); g.quadraticCurveTo(x, y + w * sc * 0.7, x - w * sc, y); g.fill(); };
    g.globalAlpha = lvl;
    shape(1, 'rgba(255,120,20,0.85)'); shape(0.78, 'rgba(255,190,50,0.95)'); shape(0.5, 'rgba(255,245,200,1)');
    g.fillStyle = 'rgba(90,140,255,0.55)'; g.beginPath(); g.ellipse(x, y - 1.5 * u, w * 0.45, w * 0.35, 0, 0, TAU); g.fill();
    g.globalAlpha = 1;
  }
  function diyaHit(x, y) { return diya && Math.abs(x - diya.x) < 46 * U && y > floorY - 64 * U && y < floorY + 4; }
  function updateDiya(dt, t) {
    const d = diya;
    d.lvl = lerp(d.lvl, d.lit ? 1 : 0, d.lit ? 0.08 : 0.25);
    if (d.drag) { const nx = clamp(M.x - d.drag.ox, 46 * U, W - 46 * U); d.vx = nx - d.x; d.x = nx; }
    else { d.vx *= 0.85; }
    // wind from hand / motion bends the flame (it lags behind motion)
    const [wx, wy] = diyaWick(S.diya, U), fx = d.x + wx, fy = floorY + wy;
    let wind = -d.vx * 0.06;
    if (M.inside && !(M.touch && !M.down)) { const dd = Math.hypot(M.x - fx, M.y - (fy - 20 * U)); if (dd < 160 * U) wind += clamp(M.vx, -30, 30) * 0.02 * (1 - dd / (160 * U)); }
    d.wind = lerp(d.wind, wind, 0.2);
    d.lean = clamp(lerp(d.lean, d.wind, 0.15), -0.9, 0.9);
    if (d.lit && Math.abs(d.wind) > 0.75 && !d.drag) { d.lit = false; Snd.puff(); smoke(fx, fy - 4 * U, 10); showHint('Whoosh! Too much wind. Click the diya to light it again.', 2400); }
    if (!d.lit && d.lvl > 0.05 && Math.random() < 0.3) smoke(fx, fy - 4 * U, 1);
    if (d.lit && Math.random() < 0.02) addP({ x: fx, y: fy - 22 * U, vx: rand(-0.2, 0.2), vy: -rand(0.4, 0.8) * U, max: 0.7, size: 0.9 * U, color: '#ffcf70', g: -0.005 });
  }
  function drawDiya(t) {
    const d = diya, [wx, wy] = diyaWick(S.diya, U);
    if (d.lvl > 0.03) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * d.lvl; ctx.drawImage(glowSprite('#ff9d2e'), d.x - 110 * U, floorY - 26 * U, 220 * U, 40 * U); ctx.restore(); }
    ctx.save(); ctx.translate(d.x, floorY); drawDiyaBody(ctx, S.diya, U, d.lvl > 0.3, t); ctx.restore();
    drawFlame(ctx, d.x + wx, floorY + wy, U, d.lvl, d.lean, t);
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
    if (lantern) { for (const s of lantern.strips) s.pts.forEach(kick); lantern.rope.forEach(kick); kick(lantern.bot); kick(lantern.tag.card); }
    lights.pts.forEach(kick); lights.bulbs.forEach((b) => kick(b.b));
    if (diya && Math.abs(diya.x - x) < R) { diya.wind += (diya.x > x ? 1 : -1) * 1.5 * power * (1 - Math.abs(diya.x - x) / R); }
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
    if (lantern) for (const s of lantern.strips) if (!s.attached || lantern.bot.y > floorY - 80 * U) s.pts.forEach(kick);
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
    if (lantern && (lanternHit(x, y) || nearLanternThings(x, y, 14 * U))) return true;
    if (diyaHit(x, y)) return true;
    if (lights && bulbAt(x, y)) return true;
    if (lights && y < 140 * U && lights.pts.some((p) => Math.hypot(p.x - x, p.y - y) < 40 * U)) return true;
    for (const c of crackers) if (Math.abs(c.x - x) < 40 * U && y > c.y - 60 * U) return true;
    return false;
  }
  function nearLanternThings(x, y, r) {
    const L = lantern;
    for (const s of L.strips) for (let i = 0; i < s.pts.length - 1; i++) if (distSeg(x, y, s.pts[i], s.pts[i + 1]) < r) return true;
    for (let i = 0; i < L.rope.length - 1; i++) if (distSeg(x, y, L.rope[i], L.rope[i + 1]) < r) return true;
    if (L.tagBox && Math.hypot(x - L.tag.card.x, y - L.tag.card.y) < 40 * U) return true;
    return false;
  }
  function bulbAt(x, y) {
    let best = null, bd = 16 * U;
    for (const b of lights.bulbs) { const d = Math.hypot(b.b.x - x, b.b.y + 4 * U - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  function stripAt(x, y, reach) {
    if (!lantern) return null;
    let best = null, bd = reach || 9 * U;
    for (const s of lantern.strips) for (let i = 0; i < s.pts.length - 1; i++) { const d = distSeg(x, y, s.pts[i], s.pts[i + 1]); if (d < bd) { bd = d; best = s; } }
    return best;
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
    if (diyaHit(x, y)) press.target = 'diya';
    else if (stripAt(x, y, 6 * U)) press.target = 'strip';
    else if (lantern && lanternHit(x, y)) press.target = 'lantern';
    if (press.target === 'lantern') { const L = lantern; L.drag = { ox: x - L.top.x, oy: y - L.top.y, started: false, pending: true }; }
    if (press.target === 'diya') diya.drag = { ox: x - diya.x, pending: true };
  });
  cvs.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.moved = true;
    if (DESKTOP && window.desktop && window.desktop.setIgnore) reportHit();
  });
  function endPress(e) {
    if (!press) { M.down = false; return; }
    const x = e.clientX, y = e.clientY, p = press; press = null; M.down = false;
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
  cvs.addEventListener('contextmenu', (e) => e.preventDefault());
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
    if (target === 'diya') {
      diya.lit = !diya.lit; const [wx, wy] = diyaWick(S.diya, U);
      if (!diya.lit) { Snd.puff(); smoke(diya.x + wx, floorY + wy - 4 * U, 12); }
      else { Snd.fizz(); addP({ x: diya.x + wx, y: floorY + wy - 10 * U, vx: 0, vy: 0, max: 0.3, type: 'flash', size: 50 * U, color: '#ffcf70' }); }
      return;
    }
    if (target === 'lantern') { lantern.on = !lantern.on; Snd.click(); return; }
    const s = stripAt(x, y);
    if (s) {
      if (s.attached) { s.attached = false; s.pts[0].pinned = false; s.pts.forEach((p) => { p.px = p.x - rand(-1, 1); }); Snd.snap(); }
      return;
    }
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
    const hit = panelOpen || press || interactiveAt(M.x, M.y) || overGear(M.x, M.y);
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
    const [g, w, h] = prepThumb(c), D = lanternDims(i, 1), s = Math.min((h - 6) / D.h, (w - 10) / D.w) * 0.95;
    g.save(); g.translate(w / 2, 3 + Math.sin(t * 1.5 + i) * 1); g.rotate(Math.sin(t * 1.3 + i) * 0.05); drawLanternBody(g, i, s, 1, t); g.restore();
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
    const [g, w, h] = prepThumb(c), s = Math.min(1, (w - 8) / 92);
    const bx = w / 2 - (i === 2 ? 0 : 6 * s), by = h - 8, [wx, wy] = diyaWick(i, s);
    g.save(); g.translate(bx, by); drawDiyaBody(g, i, s, true, t); g.restore();
    drawFlame(g, bx + wx, by + wy, s, 1, Math.sin(t * 1.7) * 0.1, t);
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
  const tagInput = document.getElementById('tagText');
  tagInput.value = S.tag; tagInput.addEventListener('input', () => { S.tag = tagInput.value; save(); });
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
    if (window.desktop.onMode) window.desktop.onMode((m) => { deskMode = m === 'desktop'; optDesk.checked = deskMode; lastIgnore = null; if (window.desktop.setIgnore) reportHit(); showHint(deskMode ? 'Desktop mode: empty space clicks go to your apps. The kandil, lights, diya and tinsel stay interactive.' : 'Celebrate mode: click anywhere for sparkles, double-click for crackers.', 3200); });
    if (window.desktop.onOpenOptions) window.desktop.onOpenOptions(() => openPanel(true));
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
    drawSparkler(t);
    drawThumbs(t);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
  setTimeout(() => showHint(window.matchMedia('(pointer: coarse)').matches
    ? 'Tap the kandil, bulbs or diya. Drag the kandil to swing it, pull hard to pluck. Double-tap for a cracker. ⚙ for options.'
    : 'Click the kandil, bulbs or diya. Drag the kandil to swing it, pull hard to pluck. Double-click for a cracker. ⚙ for options.', 6000), 600);

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // test hooks (used by automated checks)
  window.__diwali = { get lantern() { return lantern; }, get lights() { return lights; }, get diya() { return diya; }, get crackers() { return crackers; }, tap, dropCracker, S };
})();
