/* Стальной рейд — кооперативный run'n'gun в духе Contra / Blazing Chrome.
   Один файл: движок, уровни, боссы, звук, сеть (PeerJS) и отрисовка. */
'use strict';
(function () {

// ───────────────────────── базовое ─────────────────────────
const W = 480, H = 270, T = 16, STEP = 1 / 60, GRAV = 950;
const screen = document.getElementById('screen');
const sctx = screen.getContext('2d');
const buf = document.createElement('canvas'); buf.width = W; buf.height = H;
let ctx = buf.getContext('2d');
let S = 2;
const FD = '"Russo One","Arial Black",Impact,sans-serif';
const FP = '"Exo 2","Trebuchet MS",sans-serif';
const IS_TOUCH = ('ontouchstart' in window) || ((navigator.maxTouchPoints || 0) > 0 && /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent || ''));

function resize() {
  const wrap = document.getElementById('wrap');
  const cw = wrap.clientWidth || window.innerWidth, ch = wrap.clientHeight || window.innerHeight;
  let s = Math.min(cw / W, ch / H); if (!(s > 0)) s = 1;
  const cssW = Math.floor(W * s), cssH = Math.floor(H * s);
  screen.style.width = cssW + 'px'; screen.style.height = cssH + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  screen.width = Math.max(W, Math.round(cssW * dpr));
  screen.height = Math.max(H, Math.round(cssH * dpr));
  S = screen.width / W;
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const r1 = v => Math.round(v * 10) / 10;
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function circRect(cx, cy, r, x, y, w, h) { const nx = clamp(cx, x, x + w), ny = clamp(cy, y, y + h); const dx = cx - nx, dy = cy - ny; return dx * dx + dy * dy <= r * r; }
function load(k, d) { try { const v = localStorage.getItem('steelraid.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem('steelraid.' + k, JSON.stringify(v)); } catch (e) { } }

// ───────────────────────── звук ─────────────────────────
let AC = null, master = null, sfxG = null, musG = null, noiseBuf = null, muted = load('muted', false);
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => { }); return; }
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    AC = new C();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(AC.destination);
    sfxG = AC.createGain(); sfxG.gain.value = 0.55; sfxG.connect(master);
    musG = AC.createGain(); musG.gain.value = 0.3; musG.connect(master);
    const len = AC.sampleRate; noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    mus.next = AC.currentTime + 0.05;
    // iOS: тихий буфер разблокирует вывод
    const s = AC.createBufferSource(); s.buffer = AC.createBuffer(1, 1, 22050); s.connect(AC.destination); s.start(0);
  } catch (e) { AC = null; }
}
function toggleMute() { muted = !muted; save('muted', muted); if (master) master.gain.value = muted ? 0 : 0.6; updateSoundBtn(); }
function osc(type, f0, f1, t, dur, vol, dest) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(dest || sfxG); o.start(t); o.stop(t + dur + 0.03);
}
function nz(t, dur, vol, freq, type, dest) {
  if (!AC || !noiseBuf) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || sfxG); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
}
const SFX = {
  shootB: t => osc('square', 900, 420, t, 0.06, 0.07),
  shootS: t => { osc('square', 520, 240, t, 0.08, 0.07); nz(t, 0.05, 0.05, 3000); },
  shootL: t => osc('sawtooth', 1500, 280, t, 0.14, 0.06),
  shootH: t => osc('triangle', 300, 900, t, 0.1, 0.09),
  shootF: t => nz(t, 0.09, 0.05, 1200, 'bandpass'),
  eshot: t => osc('square', 420, 300, t, 0.05, 0.035),
  hit: t => osc('square', 300, 140, t, 0.04, 0.045),
  clink: t => osc('square', 2100, 1800, t, 0.04, 0.04),
  boom: t => { nz(t, 0.35, 0.3, 900); osc('sine', 120, 40, t, 0.3, 0.28); },
  bigboom: t => { nz(t, 1.0, 0.45, 600); osc('sine', 90, 28, t, 0.9, 0.45); },
  jump: t => osc('square', 300, 620, t, 0.09, 0.05),
  dash: t => nz(t, 0.13, 0.12, 2400, 'highpass'),
  pickup: t => { osc('square', 660, 660, t, 0.07, 0.09); osc('square', 990, 990, t + 0.07, 0.1, 0.09); },
  hurt: t => osc('sawtooth', 420, 80, t, 0.25, 0.16),
  down: t => osc('square', 440, 100, t, 0.55, 0.14),
  revive: t => [523, 659, 784, 1046].forEach((f, i) => osc('square', f, f, t + i * 0.07, 0.1, 0.07)),
  super: t => { osc('sawtooth', 100, 1300, t, 0.5, 0.18); nz(t, 0.6, 0.28, 2000); },
  alarm: t => { for (let i = 0; i < 3; i++) osc('square', 880, 620, t + i * 0.42, 0.32, 0.1); },
  select: t => osc('square', 700, 700, t, 0.05, 0.06),
  confirm: t => { osc('square', 600, 600, t, 0.06, 0.07); osc('square', 900, 900, t + 0.06, 0.1, 0.07); },
  stomp: t => { osc('sine', 80, 30, t, 0.45, 0.5); nz(t, 0.3, 0.28, 400); },
  laser: t => osc('sawtooth', 220, 55, t, 0.65, 0.14),
  warn: t => osc('square', 1250, 1250, t, 0.05, 0.045),
  heal: t => { osc('triangle', 500, 1000, t, 0.25, 0.12); },
};
const sfxLast = {};
function playSfx(n) {
  if (!AC || muted || !SFX[n]) return;
  const t = AC.currentTime; if (sfxLast[n] && t - sfxLast[n] < 0.035) return; sfxLast[n] = t;
  try { SFX[n](t); } catch (e) { }
}

// музыка — простой секвенсор: бас, арпеджио, барабаны
const D_ROCK = { k: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], h: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] };
const D_FAST = { k: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], s: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0], h: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] };
const D_SOFT = { k: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], h: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] };
const D_NONE = { k: [], s: [], h: [] };
const SONGS = {
  title: { bpm: 100, root: 45, prog: [0, -4, -7, -2], bass: [0, -1, -1, 0, -1, -1, 0, -1, 0, -1, -1, 0, -1, -1, 7, -1], lead: [0, -1, 2, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 2, -1], d: D_SOFT },
  l0: { bpm: 140, root: 45, prog: [0, 0, -4, -2], bass: [0, -1, 0, 12, -1, 0, 12, -1, 0, -1, 0, 12, -1, 7, 10, 12], lead: [0, 1, 2, 4, 2, 1, 0, 1, 2, 4, 3, 2, 1, 2, 3, 4], d: D_ROCK },
  l1: { bpm: 148, root: 43, prog: [0, -2, -4, -5], bass: [0, 0, 12, 0, -1, 0, 12, 0, 0, 0, 12, 0, 10, -1, 7, -1], lead: [4, -1, 2, -1, 3, -1, 1, -1, 4, 3, 2, -1, 1, -1, 0, -1], d: D_ROCK },
  l2: { bpm: 154, root: 40, prog: [0, 1, 0, -2], bass: [0, 0, 0, 12, 0, 0, 10, 0, 0, 0, 0, 12, 0, 7, 0, 10], lead: [0, 2, 4, 2, 0, 2, 4, 3, 0, 2, 4, 2, 1, 3, 4, 3], d: D_FAST },
  boss: { bpm: 170, root: 42, prog: [0, 1, -2, 1], bass: [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 1, 1, 13, 1], lead: [4, 3, 2, 1, 4, 3, 2, 1, 4, 3, 2, 3, 4, -1, 4, -1], d: D_FAST },
  win: { bpm: 120, root: 48, prog: [0, 5, 7, 0], major: true, bass: [0, -1, -1, -1, 7, -1, -1, -1, 0, -1, -1, -1, 7, -1, 12, -1], lead: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, -1, 4, -1], d: D_SOFT },
  over: { bpm: 76, root: 45, prog: [0, -2, -4, -5], bass: [0, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1], lead: [2, -1, -1, -1, 1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1], d: D_NONE },
};
const mus = { name: null, song: null, step: 0, next: 0 };
const mf = m => 440 * Math.pow(2, (m - 69) / 12);
function playSong(name) {
  if (mus.name === name) return;
  mus.name = name; mus.song = SONGS[name] || null; mus.step = 0;
  if (AC) mus.next = AC.currentTime + 0.06;
}
function musicTick() {
  if (!AC || !mus.song) return;
  const s = mus.song, sp = 60 / s.bpm / 4;
  if (mus.next < AC.currentTime - 0.25) mus.next = AC.currentTime + 0.02;
  while (mus.next < AC.currentTime + 0.12) {
    if (!muted) schedStep(mus.step, mus.next, sp);
    mus.next += sp; mus.step = (mus.step + 1) % (16 * s.prog.length);
  }
}
function schedStep(st, t, sp) {
  const s = mus.song, bar = Math.floor(st / 16) % s.prog.length, i = st % 16, root = s.root + s.prog[bar];
  const b = s.bass[i]; if (b >= 0) osc('triangle', mf(root + b), 0, t, sp * 0.9, 0.24, musG);
  const L = s.lead[i];
  if (L >= 0) { const ch = s.major ? [0, 4, 7, 11, 12] : [0, 3, 7, 10, 12]; osc('square', mf(root + 24 + ch[L % 5]), 0, t, sp * 0.75, 0.04, musG); }
  if (s.d.k[i]) osc('sine', 150, 40, t, 0.12, 0.5, musG);
  if (s.d.s[i]) nz(t, 0.12, 0.2, 1800, 'bandpass', musG);
  if (s.d.h[i]) nz(t, 0.03, 0.07, 7000, 'highpass', musG);
}

// ───────────────────────── ввод ─────────────────────────
const keys = new Set();
const BIND = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], fire: ['KeyF'], jump: ['KeyG'], dash: ['KeyH'], sup: ['KeyR'], lock: ['KeyE'], start: ['Escape', 'KeyP'], ok: ['Enter', 'Space'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], fire: ['Slash', 'Numpad1'], jump: ['Period', 'Numpad2'], dash: ['Comma', 'Numpad3'], sup: ['Semicolon', 'Numpad0'], lock: ['Quote', 'Numpad5'], start: [], ok: ['NumpadEnter'] },
];
const BTN = ['left', 'right', 'up', 'down', 'fire', 'jump', 'dash', 'sup', 'lock', 'start', 'ok', 'auto'];
const GAME_CODES = new Set(); BIND.forEach(b => Object.values(b).forEach(a => a.forEach(k => GAME_CODES.add(k))));
const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };
addEventListener('keydown', e => {
  if (typing(e)) return;
  initAudio();
  if (GAME_CODES.has(e.code)) e.preventDefault();
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const TOUCH = {}; BTN.forEach(n => TOUCH[n] = false);
let autoFire = load('auto', true);
let pads = [];
function getPads() { try { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(p => p && p.connected) : []; } catch (e) { return []; } }
function localState(i) {
  const c = {}; const B = BIND[i];
  for (const n of BTN) c[n] = !!(B[n] && B[n].some(k => keys.has(k)));
  const gp = pads[i];
  if (gp) {
    const ax = gp.axes || [], bt = gp.buttons || [];
    const pr = k => !!(bt[k] && (bt[k].pressed || bt[k].value > 0.4));
    c.left = c.left || ax[0] < -0.45 || pr(14); c.right = c.right || ax[0] > 0.45 || pr(15);
    c.up = c.up || ax[1] < -0.5 || pr(12); c.down = c.down || ax[1] > 0.5 || pr(13);
    c.jump = c.jump || pr(0); c.dash = c.dash || pr(1); c.fire = c.fire || pr(2) || pr(7);
    c.sup = c.sup || pr(3) || pr(5); c.lock = c.lock || pr(4) || pr(6); c.start = c.start || pr(9);
  }
  if (i === 0) { for (const n of BTN) if (TOUCH[n]) c[n] = true; if (IS_TOUCH && autoFire) c.auto = true; }
  return c;
}
const mkIn = () => ({ c: {}, p: {}, prev: {} });
const INP = [mkIn(), mkIn()];
function setInput(I, c) { const p = {}; for (const n of BTN) p[n] = !!c[n] && !I.prev[n]; I.p = p; I.c = c; I.prev = c; }
const anyP = n => INP[0].p[n] || INP[1].p[n];
const confirmP = i => { const I = INP[i]; return I.p.fire || I.p.jump || I.p.ok; };
const anyConfirm = () => confirmP(0) || confirmP(1);

// ───────────────────────── темы и уровни ─────────────────────────
const THEMES = [
  { name: 'РЖАВАЯ ПУСТОШЬ', base: '#5c2e24', mid: '#74402f', dark: '#3b1b17', top: '#b8632f', top2: '#f0a65c', plat: '#9a714f', platD: '#4a3426', crate: '#8a6a44', crateD: '#4e3a24', song: 'l0', boss: 'МОЛОТ', bossSub: 'ШАГОХОД' },
  { name: 'НЕОН-СИТИ', base: '#1b1e2d', mid: '#262a3f', dark: '#0e1018', top: '#2a3150', top2: '#3ff0ff', glow: '#ff3fb4', plat: '#3a4160', platD: '#151827', crate: '#2c3352', crateD: '#12152a', song: 'l1', boss: 'ГАРПИЯ', bossSub: 'БОЕВОЙ ВЕРТОЛЁТ' },
  { name: 'ЯДРО ЗАВОДА', base: '#2a1a1a', mid: '#3a2424', dark: '#160c0c', top: '#4a3030', top2: '#ff8a2a', hazard: '#ffc23a', plat: '#5a4040', platD: '#241414', crate: '#4a3a2a', crateD: '#22180f', song: 'l2', boss: 'ЯДРО', bossSub: 'ГЛАВНЫЙ МОЗГ' },
];

function genLevel(n) {
  const rng = mulberry(7919 + n * 1013);
  const r = (a, b) => a + rng() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1));
  const cols = n === 0 ? 470 : 230 + n * 30, AR = 30, total = cols + AR, rows = 17;
  // эпизоды: погоня на байках (ур.1), мини-босс (ур.2), волны в запертой зоне (ур.3)
  const zones = n === 0 ? { chase: [86, 356] } : n === 1 ? { lock: [124, 'spider'] } : { lock: [128, 'waves'] };
  const inZone = c => (zones.chase && c >= zones.chase[0] - 3 && c <= zones.chase[1] + 3) || (zones.lock && c >= zones.lock[0] - 3 && c <= zones.lock[0] + 33);
  const tiles = []; for (let y = 0; y < rows; y++) tiles.push(new Uint8Array(total));
  const gnd = new Int16Array(total);
  let g = 13, seg = 0;
  for (let c = 0; c < total; c++) {
    if (c < 18 || c >= cols - 10 || inZone(c)) { gnd[c] = 13; g = 13; seg = Math.max(seg, 4); continue; }
    seg--;
    if (seg <= 0) {
      const roll = rng();
      if (roll < 0.2 && c > 24) {
        const pw = ri(2, 3);
        let k = 0;
        for (; k < pw && c + k < cols - 10 && !inZone(c + k + 3); k++) gnd[c + k] = -1;
        c += k - 1; seg = ri(6, 10); continue;
      } else if (roll < 0.55) { g = clamp(g + (rng() < 0.5 ? -1 : 1), 11, 14); seg = ri(6, 14); }
      else seg = ri(5, 12);
    }
    gnd[c] = g;
  }
  for (let c = 0; c < total; c++) if (gnd[c] >= 0) for (let y = gnd[c]; y < rows; y++) tiles[y][c] = 1;
  // ящики-укрытия
  for (let c = 22; c < cols - 12; c++) {
    if (inZone(c)) continue;
    if (gnd[c] > 0 && gnd[c - 1] === gnd[c] && gnd[c + 1] === gnd[c] && rng() < 0.05) {
      tiles[gnd[c] - 1][c] = 3;
      if (rng() < 0.35 && gnd[c + 1] === gnd[c]) { tiles[gnd[c] - 1][c + 1] = 3; if (rng() < 0.5) tiles[gnd[c] - 2][c] = 3; }
      c += 4;
    }
  }
  // мостки
  for (let c = 20; c < cols - 12;) {
    if (zones.chase && inZone(c)) { c += 4; continue; }
    if (rng() < 0.5 && gnd[c] > 0) {
      const len = ri(3, 6), row = gnd[c] - ri(4, 5);
      if (row > 5) for (let k = 0; k < len; k++) if (tiles[row][c + k] === 0 && tiles[row + 1][c + k] === 0) tiles[row][c + k] = 2;
      c += len + ri(4, 9);
    } else c += ri(3, 7);
  }
  // враги
  const spawns = [];
  const table = n === 0 ? [['runner', 4], ['turret', 2], ['drone', 2], ['leaper', 1], ['sniper', 1], ['kamikaze', 1]]
    : n === 1 ? [['runner', 4], ['turret', 2], ['drone', 3], ['leaper', 2], ['heavy', 1.5], ['shield', 1.5], ['bomber', 1], ['sniper', 1.5], ['kamikaze', 1.5]]
      : [['runner', 4], ['turret', 2.5], ['drone', 3], ['leaper', 2], ['heavy', 2.5], ['shield', 2], ['bomber', 1.5], ['sniper', 1.5], ['kamikaze', 2]];
  const tw = table.reduce((s, x) => s + x[1], 0);
  let c = 26;
  while (c < cols - 12) {
    if (inZone(c)) { c++; continue; }
    let roll = rng() * tw, type = table[0][0];
    for (const [ty, w] of table) { if (roll < w) { type = ty; break; } roll -= w; }
    if (type === 'runner') { const k = ri(2, 3 + n); for (let i = 0; i < k; i++) spawns.push({ x: (c + i * 1.3) * T, type }); }
    else if (type === 'drone') { const k = ri(1, 2 + (n > 0 ? 1 : 0)); for (let i = 0; i < k; i++) spawns.push({ x: (c + i * 2) * T, type, y: r(36, 100) }); }
    else spawns.push({ x: c * T, type });
    c += ri(7, 12) - n;
  }
  for (let cc = 40; cc < cols - 10; cc += ri(30, 42)) if (!inZone(cc)) spawns.push({ x: cc * T, type: 'carrier' });
  spawns.sort((a, b) => a.x - b.x);
  const Z = {};
  if (zones.chase) Z.chase = { x0: zones.chase[0] * T, x1: zones.chase[1] * T };
  if (zones.lock) Z.lock = { x: zones.lock[0] * T, kind: zones.lock[1] };
  return { n, tiles, gnd, total, cols, rows, spawns, arenaX: cols * T, zones: Z };
}
const LVCACHE = {};
const getLevel = n => LVCACHE[n] || (LVCACHE[n] = genLevel(n));

function tileAt(c, r) { const L = G.lv; if (!L) return 0; if (c < 0 || c >= L.total) return 1; if (r < 0 || r >= L.rows) return 0; return L.tiles[r][c]; }
const isSolid = t => t === 1 || t === 3;
const solidPx = (x, y) => isSolid(tileAt(Math.floor(x / T), Math.floor(y / T)));
function groundTop(x) { const c = Math.floor(x / T); const L = G.lv; if (c < 0 || c >= L.total) return null; for (let r = 0; r < L.rows; r++) if (isSolid(L.tiles[r][c])) return r * T; return null; }
function findGroundX(x) { for (let k = 0; k < 40; k++) { const xx = x + k * 8; if (groundTop(xx) !== null && groundTop(xx + 10) !== null) return xx; } return x; }

function moveBody(b, dt, useGrav) {
  if (useGrav !== false) b.vy = Math.min(b.vy + GRAV * dt, 560);
  b.hitX = false;
  if (b.vx !== 0) {
    b.x += b.vx * dt;
    const top = Math.floor(b.y / T), bot = Math.floor((b.y + b.h - 0.01) / T);
    if (b.vx > 0) { const c = Math.floor((b.x + b.w) / T); for (let r = top; r <= bot; r++) if (isSolid(tileAt(c, r))) { b.x = c * T - b.w - 0.001; b.hitX = true; break; } }
    else { const c = Math.floor(b.x / T); for (let r = top; r <= bot; r++) if (isSolid(tileAt(c, r))) { b.x = (c + 1) * T; b.hitX = true; break; } }
  }
  const prevBot = b.y + b.h; b.y += b.vy * dt; b.onGround = false;
  const l = Math.floor(b.x / T), rr = Math.floor((b.x + b.w - 0.01) / T);
  if (b.vy >= 0) {
    const row = Math.floor((b.y + b.h) / T);
    for (let c = l; c <= rr; c++) { const t = tileAt(c, row); if (isSolid(t) || (t === 2 && prevBot <= row * T + 0.5 && !(b.dropT > 0))) { b.y = row * T - b.h; b.vy = 0; b.onGround = true; break; } }
  } else {
    const row = Math.floor(b.y / T);
    for (let c = l; c <= rr; c++) if (isSolid(tileAt(c, row))) { b.y = (row + 1) * T; b.vy = 0; break; }
  }
}

// ───────────────────────── состояние игры ─────────────────────────
const DIFFS = [
  { name: 'НОВИЧОК', desc: '5 сердец, 5 кредитов, враги медленнее', hp: 5, lives: 5, eSpeed: 0.85, eFire: 1.35, eHp: 0.85, bossHp: 0.75, revive: 12 },
  { name: 'ВЕТЕРАН', desc: '3 сердца и 3 кредита. Как задумано', hp: 3, lives: 3, eSpeed: 1, eFire: 1, eHp: 1, bossHp: 1, revive: 9 },
  { name: 'ХАРДКОР', desc: 'Одно попадание, как в старой Контре', hp: 1, lives: 3, eSpeed: 1.12, eFire: 0.82, eHp: 1.1, bossHp: 1.15, revive: 7 },
];
const PERKS = [
  { id: 'armor', name: 'БРОНЯ', desc: '+1 сердце и полное лечение', stack: true },
  { id: 'rapid', name: 'СКОРОСТРЕЛ', desc: 'Стреляешь на 25% быстрее', stack: true },
  { id: 'caliber', name: 'КАЛИБР', desc: 'Пули бьют на 25% сильнее', stack: true },
  { id: 'dbl', name: 'ДВОЙНОЙ ПРЫЖОК', desc: 'Ещё один прыжок прямо в воздухе' },
  { id: 'ghost', name: 'РЫВОК-ПРИЗРАК', desc: 'Рывок чаще и ранит врагов насквозь' },
  { id: 'magnet', name: 'РЕАКТОР', desc: 'Супер-удар копится в 1,5 раза быстрее' },
  { id: 'angel', name: 'АНГЕЛ-ХРАНИТЕЛЬ', desc: 'Поднимаешь напарника вдвое быстрее и с полным здоровьем', coop: true },
  { id: 'arsenal', name: 'АРСЕНАЛ', desc: 'Оружие не теряется при падении. Старт с «Веером»' },
  { id: 'vamp', name: 'РЕМКОМПЛЕКТ', desc: 'Каждые 20 сбитых врагов +1 сердце' },
  { id: 'pierce', name: 'БРОНЕБОЙ', desc: 'Пули бластера пробивают врага насквозь' },
];
const WNAME = { B: 'БЛАСТЕР', S: 'ВЕЕР', L: 'ЛАЗЕР', H: 'РАКЕТЫ', F: 'ОГНЕМЁТ' };
const WLET = { S: 'В', L: 'Л', H: 'Р', F: 'О', '+': '+' };
const WCOL = { B: '#ffe066', S: '#ff6ad5', L: '#4ff3ff', H: '#ffa53a', F: '#ff7a2a', '+': '#5dff7a' };
const PALS = [
  { armor: '#3aa8ff', armorD: '#1d5fa8', visor: '#c8fbff', suit: '#1b2338', scarf: '#7ff0ff', gun: '#9aa4b8' },
  { armor: '#ff7a33', armorD: '#a8441a', visor: '#fff1b0', suit: '#2a1d1d', scarf: '#ffd04a', gun: '#b8a49a' },
  { armor: '#4fd16a', armorD: '#23803a', visor: '#e6ffb0', suit: '#16261b', scarf: '#b6ff5a', gun: '#9ab8a0' },
  { armor: '#a66bff', armorD: '#5a32a8', visor: '#f0d8ff', suit: '#1f1830', scarf: '#ff7ae0', gun: '#a8a0b8' },
  { armor: '#ff4a5a', armorD: '#a01e2e', visor: '#ffe0e0', suit: '#2a1418', scarf: '#ffb04a', gun: '#b89aa0' },
  { armor: '#d8dee8', armorD: '#7a8496', visor: '#7ff0ff', suit: '#22262e', scarf: '#ff3fb4', gun: '#9aa4b8' },
];
const HELMETS = ['АНТЕННА', 'ГРЕБЕНЬ', 'РОГА'];
const palOf = id => { const L = (V.looks || G.looks || [])[id]; return PALS[L ? L.c : id] || PALS[id]; };
const PNAME = ['ШТОРМ', 'ИСКРА'];
let NID = 1;

const newStats = () => ({ kills: 0, shots: 0, hits: 0, revives: 0, hurts: 0, supers: 0, dmg: 0 });
function makePlayer(i, hp) {
  return {
    id: i, active: false, out: false, x: 0, y: 0, w: 10, h: 22, vx: 0, vy: 0, onGround: false, facing: 1, ax: 1, ay: 0,
    hp, maxHp: hp, weapon: 'B', wlvl: 1, fireCd: 0, dashT: 0, dashCd: 0, dashDir: 1, dashHit: null, invT: 0,
    downed: false, downT: 0, revive: 0, meter: 0, overT: 0, crouch: false, coyote: 0, jbuf: 0, jumps: 0, dropT: 0,
    animT: 0, lastSafe: { x: 40, y: 0 }, kills: 0, killHeal: 0, respawnT: 0, sfxT: 0, bike: false,
    st: newStats(), tot: newStats(),
    perks: { armor: 0, rapid: 0, caliber: 0, dbl: 0, ghost: 0, magnet: 0, angel: 0, arsenal: 0, vamp: 0, pierce: 0 },
  };
}

const G = {
  state: 'title', t: 0, level: 0, diff: load('diff', 1), d: DIFFS[1], lives: 3, score: 0, best: load('best', 0),
  players: [makePlayer(0, 3), makePlayer(1, 3)], lv: null, cam: { x: 0 },
  enemies: [], pbullets: [], ebullets: [], pickups: [], beams: [], warns: [], boss: null,
  arena: false, arenaRight: 0, spawnIdx: 0, ambT: 4, combo: 0, comboT: 0, slow: 0, hitstop: 0,
  bannerT: 0, bossIntroT: 0, paused: false, menuIdx: 0, wipeT: 0, perk: null, clearT: 0,
  stats: { kills: 0, time: 0 }, hintT: 0, song: 'title', sel: { p2: false }, escale: 1, bscale: 1, msg: '', msgT: 0, net: 'local',
  looks: [load('look', { c: 0, h: 0 }), { c: 1, h: 0 }], chase: false, chaseV: 125, chaseT: {}, lock: null, lockDone: false, lockMsg: '', lockMsgT: 0,
  selRow: 0, startLv: 0, unlock: load('unlock', 0), awayHost: false, awayGuest: false, p2Wait: false, levelStart: 0,
};
let V = G; // то, что рисуем: у хоста и в одиночной игре это сам G, у гостя — снимок от хоста

const FXS = { parts: [], texts: [], shake: 0, flash: 0, amb: [] };
function initAmb() { FXS.amb = []; for (let i = 0; i < 90; i++) FXS.amb.push({ x: Math.random() * W, y: Math.random() * H, s: rnd(0.4, 1), p: Math.random() * 6 }); }
initAmb();

// ───────────────────────── эффекты (через события, чтобы гость видел то же) ─────────────────────────
let netEvents = [];
let PRED = false; // true, пока второй телефон предсказывает своё движение: никаких эффектов и урона
function emit(ev) { if (PRED) return; runEvent(ev); if (NET.mode === 'host') netEvents.push(ev); }
function runEvent(ev) {
  switch (ev.e) {
    case 's': playSfx(ev.n); break;
    case 'x': fxExplode(ev.x, ev.y, ev.s); break;
    case 'k': fxSpark(ev.x, ev.y, ev.c, ev.n || 4); break;
    case 't': fxText(ev.x, ev.y, ev.s, ev.c, ev.z); break;
    case 'h': FXS.shake = Math.max(FXS.shake, ev.v); break;
    case 'f': FXS.flash = Math.max(FXS.flash, ev.v); break;
    case 'g': addPart({ kind: 'ghost', x: ev.x, y: ev.y, w: ev.w, h: ev.h2, c: ev.c, life: 0.18, max: 0.18 }); break;
    case 'r': addPart({ kind: 'ring', x: ev.x, y: ev.y, c: ev.c, life: 0.5, max: 0.5, s: ev.v || 60 }); break;
    case 'u': for (let i = 0; i < 6; i++) addPart({ x: ev.x + rnd(-5, 5), y: ev.y, vx: rnd(-30, 30), vy: rnd(-20, 5), life: 0.35, max: 0.35, c: '#d8d0c8', s: 2 }); break;
  }
}
const sfx = n => emit({ e: 's', n });
const boom = (x, y, s) => emit({ e: 'x', x: r1(x), y: r1(y), s });
const spark = (x, y, c, n) => emit({ e: 'k', x: r1(x), y: r1(y), c, n });
const ftext = (x, y, s, c, z) => emit({ e: 't', x: r1(x), y: r1(y), s, c, z: z || 8 });
const shake = v => emit({ e: 'h', v });
const flash = v => emit({ e: 'f', v });
function addPart(p) { if (FXS.parts.length > 650) FXS.parts.shift(); p.vx = p.vx || 0; p.vy = p.vy || 0; FXS.parts.push(p); }
function fxExplode(x, y, s) {
  const n = Math.min(40, 8 + s * 5);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = rnd(20, 60 + s * 25); addPart({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: rnd(0.25, 0.6), max: 0.6, c: pick(['#fff4c2', '#ffd04a', '#ff8a2a', '#ff4a2a']), s: rint(2, 3 + (s > 3 ? 2 : 0)), g: 0.3 }); }
  for (let i = 0; i < n / 2; i++) addPart({ x: x + rnd(-6, 6) * s * 0.5, y: y + rnd(-6, 6) * s * 0.5, vx: rnd(-15, 15), vy: rnd(-40, -10), life: rnd(0.5, 1.1), max: 1.1, c: pick(['#3a3036', '#55474c', '#2a2226']), s: rint(3, 5), g: -0.1 });
  addPart({ kind: 'ring', x, y, c: '#ffe2a0', life: 0.35, max: 0.35, s: 14 + s * 8 });
  addPart({ kind: 'flash', x, y, c: '#fff', life: 0.08, max: 0.08, s: 6 + s * 4 });
}
function fxSpark(x, y, c, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = rnd(40, 120); addPart({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.1, 0.25), max: 0.25, c: c || '#fff', s: 2 }); } }
function fxText(x, y, s, c, z) { FXS.texts.push({ x, y, s, c: c || '#fff', z: z || 8, life: 1.1 }); if (FXS.texts.length > 30) FXS.texts.shift(); }
function updFx(dt) {
  const P = FXS.parts;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.life -= dt;
    if (p.life <= 0) { P.splice(i, 1); continue; }
    if (p.g) p.vy += GRAV * p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = FXS.texts.length - 1; i >= 0; i--) { const t = FXS.texts[i]; t.life -= dt; t.y -= 22 * dt; if (t.life <= 0) FXS.texts.splice(i, 1); }
  FXS.shake = Math.max(0, FXS.shake - dt * 22);
  FXS.flash = Math.max(0, FXS.flash - dt * 2.5);
}

// ───────────────────────── игроки ─────────────────────────
const alive = p => p.active && !p.out && !p.downed && p.respawnT <= 0;
const alivePlayers = () => G.players.filter(alive);
function nearestPlayer(x, y) {
  let best = null, bd = 1e9;
  for (const p of G.players) { if (!alive(p)) continue; const d = Math.abs(p.x + p.w / 2 - x) + Math.abs(p.y + p.h / 2 - y) * 0.7; if (d < bd) { bd = d; best = p; } }
  return best;
}
function setCrouch(p, on) {
  if (on === p.crouch) return;
  if (on) { p.y += 10; p.h = 12; p.crouch = true; }
  else {
    // встаём, только если над головой свободно
    const c0 = Math.floor(p.x / T), c1 = Math.floor((p.x + p.w - 0.01) / T), r = Math.floor((p.y - 10) / T);
    for (let c = c0; c <= c1; c++) if (isSolid(tileAt(c, r))) return;
    p.y -= 10; p.h = 22; p.crouch = false;
  }
}
function standingOnPlatform(p) {
  const row = Math.floor((p.y + p.h + 1) / T), c0 = Math.floor(p.x / T), c1 = Math.floor((p.x + p.w - 0.01) / T);
  let plat = false; for (let c = c0; c <= c1; c++) { const t = tileAt(c, row); if (isSolid(t)) return false; if (t === 2) plat = true; }
  return plat;
}
function clampToCam(p) {
  const L = G.cam.x + 2, R = G.chase ? G.cam.x + W * 0.7 : (G.arenaRight || G.cam.x + W) - 2 - p.w;
  if (p.x < L) p.x = L; if (p.x > R) p.x = R;
}
function updatePlayer(p, I, dt) {
  if (!p.active || p.out) return;
  if (p.respawnT > 0) { if (PRED) return; p.respawnT -= dt; if (p.respawnT <= 0) placeRespawn(p); return; }
  const c = I.c, pr = I.p;
  p.invT = Math.max(0, p.invT - dt); p.fireCd -= dt; p.dashCd -= dt; p.overT = Math.max(0, p.overT - dt);
  p.dropT -= dt; p.coyote -= dt; p.jbuf -= dt; p.sfxT -= dt;
  if (p.downed) {
    if (PRED) return;
    if (p.revive <= 0) p.downT -= dt;
    p.vx = 0; moveBody(p, dt); clampToCam(p);
    if (p.y > H + 10) { p.x = findGroundX(Math.max(p.lastSafe.x, G.cam.x + 10)); p.y = (groundTop(p.x) || 200) - p.h - 1; p.vy = 0; }
    if (p.downT <= 0) downTimeout(p);
    return;
  }
  const mx = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  const lock = !!c.lock;
  if (mx && p.dashT <= 0) p.facing = mx;
  setCrouch(p, !!(c.down && p.onGround && mx === 0 && !lock && p.dashT <= 0 && !G.chase));
  // прицел: 8 направлений, как в Контре
  let ax = p.facing, ay = 0;
  if (lock) {
    ay = c.up ? -1 : c.down ? 1 : 0; ax = mx !== 0 ? mx : (ay !== 0 ? 0 : p.facing);
    if (c.down && mx === 0) { ax = p.facing; ay = 1; }
  } else if (c.up) { ay = -1; ax = mx; }
  else if (c.down) { if (p.onGround) { if (mx) { ax = mx; ay = 1; } else { ax = p.facing; ay = 0; } } else { ay = 1; ax = mx; } }
  if (ax === 0 && ay === 0) ax = p.facing;
  const len = Math.hypot(ax, ay); p.ax = ax / len; p.ay = ay / len;

  if (p.dashT > 0) {
    p.dashT -= dt; p.vx = p.dashDir * 285 + (G.chase ? G.chaseV : 0); p.vy = 0; moveBody(p, dt, false);
    if (Math.floor(p.dashT * 60) % 2 === 0) emit({ e: 'g', x: r1(p.x), y: r1(p.y), w: p.w, h2: p.h, c: palOf(p.id).scarf });
    if (p.perks.ghost && !PRED) for (const e of G.enemies) if (!e.dead && !p.dashHit.has(e) && overlap(p, e)) { p.dashHit.add(e); damageEnemy(e, 3, p, null); }
  } else {
    const speed = 96 * (p.overT > 0 ? 1.15 : 1);
    const base = G.chase ? G.chaseV : 0;
    const target = base + ((lock || p.crouch) ? 0 : mx * speed * (G.chase ? 0.9 : 1));
    p.vx += (target - p.vx) * Math.min(1, dt * (p.onGround ? 18 : 10));
    if (pr.jump) p.jbuf = 0.12;
    if (p.jbuf > 0) {
      if (c.down && p.onGround && standingOnPlatform(p)) { setCrouch(p, false); p.dropT = 0.25; p.jbuf = 0; p.onGround = false; p.y += 2; }
      else if (p.onGround || p.coyote > 0) { setCrouch(p, false); p.vy = -335; p.jbuf = 0; p.coyote = 0; p.onGround = false; p.jumps = p.perks.dbl ? 1 : 0; sfx('jump'); }
      else if (p.jumps > 0 && pr.jump) { p.vy = -300; p.jumps--; p.jbuf = 0; sfx('jump'); emit({ e: 'u', x: r1(p.x + 5), y: r1(p.y + p.h) }); }
    }
    if (!c.jump && p.vy < -140) p.vy = -140;
    if (pr.dash && p.dashCd <= 0) {
      setCrouch(p, false);
      p.dashT = 0.17; p.dashDir = mx || p.facing; p.facing = p.dashDir; p.dashCd = 0.85 * (p.perks.ghost ? 0.55 : 1); p.dashHit = new Set(); sfx('dash');
    }
    moveBody(p, dt);
  }
  if (p.onGround) { p.coyote = 0.09; if (p.dashT <= 0) p.jumps = p.perks.dbl ? 1 : 0; }
  if (!PRED) {
    if ((c.fire || (c.auto && !G.paused)) && p.fireCd <= 0) shoot(p);
    if (pr.sup && p.meter >= 100) activateOver(p);
  }
  if (G.chase) { p.facing = mx < 0 ? -1 : 1; if (!lock && !c.up && !c.down) { p.ax = p.facing; p.ay = 0; } }
  clampToCam(p);
  if (p.y > H + 16) { if (!PRED) pitFall(p); return; }
  if (p.onGround && groundTop(p.x - 3) !== null && groundTop(p.x + p.w + 3) !== null) { p.lastSafe.x = p.x; p.lastSafe.y = p.y + p.h; }
  if (Math.abs(p.vx) > 10 && p.onGround) p.animT += dt;
}
function placeRespawn(p) {
  let x = G.cam.x + 50 + p.id * 30;
  if (!G.arena) x = findGroundX(x);
  if (G.arenaRight) x = Math.min(x, G.arenaRight - 40);
  p.x = x; p.y = -30; p.vx = 0; p.vy = 0; p.h = 22; p.crouch = false; p.hp = p.maxHp; p.invT = 3; p.downed = false; p.revive = 0;
  p.lastSafe.x = x; p.lastSafe.y = 13 * T;
}
function pitFall(p) {
  hurtPlayer(p, true);
  const x = findGroundX(Math.max(p.lastSafe.x, G.cam.x + 8));
  p.x = x; p.y = (groundTop(x) || 13 * T) - p.h - 40; p.vy = 0; p.vx = 0;
  if (!p.downed) p.invT = Math.max(p.invT, 2);
}
function hurtPlayer(p, ignoreInv) {
  if (!alive(p)) return;
  if (!ignoreInv && (p.invT > 0 || p.dashT > 0 || p.overT > 0)) return;
  p.hp--; p.invT = 1.4; p.st.hurts++; p.tot.hurts++; shake(5); sfx('hurt'); spark(p.x + 5, p.y + 8, '#ff4a4a', 8);
  if (p.hp <= 0) downPlayer(p);
}
function downPlayer(p) {
  setCrouch(p, false);
  p.downed = true; p.hp = 0; p.downT = G.d.revive; p.revive = 0; p.vx = 0; p.dashT = 0; p.overT = 0;
  p.y += p.h - 10; p.h = 10;
  if (!p.perks.arsenal) { p.weapon = 'B'; p.wlvl = 1; }
  p.meter = Math.floor(p.meter / 2);
  sfx('down'); boom(p.x + 5, p.y + 5, 1);
  if (G.players.filter(q => q.active && !q.out).length > 1) ftext(p.x + 5, p.y - 16, 'ПОДНИМИ МЕНЯ!', '#ff6a6a', 8);
}
function standUp(p) { p.downed = false; p.y -= 12; p.h = 22; p.revive = 0; }
function downTimeout(p) {
  if (G.lives > 0) { G.lives--; standUp(p); p.respawnT = 1.0; ftext(G.cam.x + W / 2, 60, 'КРЕДИТ −1', '#ffd04a', 10); }
  else { standUp(p); p.out = true; }
}
function updateRevive(dt) {
  for (const d of G.players) {
    if (!d.active || d.out || !d.downed) continue;
    let helper = null;
    for (const q of G.players) if (q !== d && alive(q)) {
      const rad = q.perks.angel ? 42 : 28;
      if (Math.abs(q.x - d.x) < rad && Math.abs(q.y + q.h - (d.y + d.h)) < 30) helper = q;
    }
    if (helper) {
      d.revive += dt * (helper.perks.angel ? 2 : 1);
      if (d.revive >= 1.5) {
        standUp(d); d.hp = helper.perks.angel ? d.maxHp : Math.max(1, Math.ceil(d.maxHp / 2)); d.invT = 2;
        helper.st.revives++; helper.tot.revives++;
        sfx('revive'); ftext(d.x + 5, d.y - 6, 'В СТРОЮ!', '#5dff7a', 9);
        emit({ e: 'r', x: r1(d.x + 5), y: r1(d.y + 11), c: '#5dff7a', v: 40 });
      }
    } else d.revive = Math.max(0, d.revive - dt * 0.6);
  }
}
function checkTeam(dt) {
  const act = G.players.filter(p => p.active && !p.out);
  if (act.length === 0) { gameOver(); return; }
  const standing = act.filter(p => !p.downed && p.respawnT <= 0);
  const respawning = act.some(p => p.respawnT > 0);
  if (standing.length === 0 && !respawning) {
    G.wipeT += dt;
    if (G.wipeT > 1.3) {
      G.wipeT = 0;
      if (G.lives > 0) {
        G.lives--;
        for (const p of act) { if (p.downed) standUp(p); p.respawnT = 0.5; }
        G.ebullets.length = 0; G.beams.length = 0; G.warns.length = 0;
        ftext(G.cam.x + W / 2, 70, 'КРЕДИТ −1', '#ffd04a', 10);
      } else gameOver();
    }
  } else G.wipeT = 0;
}

// стрельба
function shoot(p) {
  const w = p.weapon, lvl = p.wlvl, od = p.overT > 0;
  const dm = (1 + 0.25 * p.perks.caliber) * (od ? 2 : 1) * (lvl > 1 ? 1.35 : 1);
  const rate = 1 / (1 + 0.25 * p.perks.rapid) * (od ? 0.55 : 1);
  const cx = p.x + p.w / 2, cy = p.y + (p.crouch ? 5 : 9);
  const mx = cx + p.ax * 9, my = cy + p.ay * 9;
  const ang = Math.atan2(p.ay, p.ax);
  const add = (a, sp, dmg, o) => (p.st.shots++, p.tot.shots++, G.pbullets.push(Object.assign({ nid: NID++, x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, life: 1.2, type: w, owner: p, a, hit: null, pierce: 0, r: 2 }, o || {})));
  let snd = 'shootB';
  switch (w) {
    case 'S': { const n = lvl > 1 ? 7 : 5; for (let i = 0; i < n; i++) add(ang + (i - (n - 1) / 2) * 0.13, 300, 0.85 * dm, { life: 0.75 }); p.fireCd = 0.24 * rate; snd = 'shootS'; break; }
    case 'L': add(ang, 440, 3.2 * dm, { pierce: 99, life: 1.0 }); p.fireCd = (lvl > 1 ? 0.24 : 0.32) * rate; snd = 'shootL'; break;
    case 'H': { const n = lvl > 1 ? 2 : 1; for (let i = 0; i < n; i++) add(ang + (n > 1 ? (i ? 0.3 : -0.3) : 0), 230, 1.3 * dm, { life: 1.7 }); p.fireCd = 0.2 * rate; snd = 'shootH'; break; }
    case 'F': add(ang + rnd(-0.12, 0.12), 220, (lvl > 1 ? 0.6 : 0.45) * dm, { pierce: 99, life: lvl > 1 ? 0.5 : 0.38, r: 3 }); p.fireCd = 0.05 * rate; snd = 'shootF'; break;
    default: add(ang, 340, dm, { pierce: p.perks.pierce ? 1 : 0 }); p.fireCd = 0.13 * rate;
  }
  if (p.sfxT <= 0) { sfx(snd); p.sfxT = w === 'F' ? 0.1 : 0.06; }
}
function activateOver(p) {
  p.meter = 0; p.overT = 4; p.st.supers++; p.tot.supers++;
  const sync = G.players.some(q => q !== p && q.overT > 3);
  const dmg = sync ? 20 : 9;
  flash(0.35); shake(7); sfx('super');
  emit({ e: 'r', x: r1(p.x + 5), y: r1(p.y + 10), c: palOf(p.id).scarf, v: 260 });
  ftext(p.x + 5, p.y - 14, sync ? 'СИНХРО-УДАР!' : 'ОВЕРДРАЙВ!', sync ? '#ffffff' : palOf(p.id).scarf, sync ? 12 : 10);
  if (sync) G.players.forEach(q => { if (q.overT > 0) q.overT += 2; });
  G.ebullets.length = 0;
  for (const e of G.enemies) if (!e.dead && e.x < G.cam.x + W + 10 && e.x + e.w > G.cam.x - 10) damageEnemy(e, dmg, p, null);
  if (G.boss && !G.boss.dead && G.boss.ready) for (const pt of G.boss.parts) if (pt.alive) damagePart(G.boss, pt, dmg * 1.3, p);
}

// ───────────────────────── враги ─────────────────────────
function spawnEnemy(type, x, y, extra) {
  const d = G.d, L = G.level;
  const e = { nid: NID++, type, x, y, vx: 0, vy: 0, w: 10, h: 20, hp: 2, t: 0, facing: -1, onGround: false, flash: 0, cd: rnd(0.8, 2), score: 100, contact: true, grav: true, aim: Math.PI, stopT: 0 };
  switch (type) {
    case 'runner': e.hp = 2 + L * 0.5; e.speed = rnd(50, 65) * d.eSpeed; break;
    case 'turret': e.w = 14; e.h = 12; e.hp = 6 + L * 2; e.score = 200; e.grav = false; e.cd = rnd(0.6, 1.4); e.burst = 0; e.bt = 0; break;
    case 'drone': e.w = 14; e.h = 10; e.hp = 3 + L; e.score = 150; e.grav = false; e.baseY = y; e.cd = rnd(1, 2.5); break;
    case 'leaper': e.w = 14; e.h = 10; e.hp = 4 + L; e.score = 150; e.cd = rnd(0.6, 1.2); break;
    case 'heavy': e.w = 18; e.h = 26; e.hp = 16 + L * 4; e.score = 400; e.speed = 22 * d.eSpeed; e.cd = 1.5; e.burst = 0; e.bt = 0; break;
    case 'carrier': e.w = 18; e.h = 12; e.hp = 3; e.score = 200; e.grav = false; e.baseY = y; e.contact = false; break;
    case 'missile': e.w = 8; e.h = 8; e.hp = 1; e.score = 50; e.grav = false; break;
    case 'sniper': e.hp = 4 + L; e.score = 250; e.cd = rnd(1.2, 2.2); break;
    case 'shield': e.w = 12; e.h = 22; e.hp = 7 + L * 1.5; e.score = 300; e.speed = 38 * d.eSpeed; break;
    case 'kamikaze': e.w = 12; e.h = 10; e.hp = 2 + L * 0.5; e.score = 150; e.speed = 105 * d.eSpeed; e.arm = 0; e.contact = false; break;
    case 'bomber': e.w = 26; e.h = 10; e.hp = 6 + L * 1.5; e.score = 300; e.grav = false; e.cd = rnd(0.6, 1.2); e.contact = false; e.baseY = y; break;
    case 'biker': e.w = 22; e.h = 18; e.hp = 5 + L; e.score = 250; e.grav = false; e.cd = rnd(1, 2); e.relX = rnd(300, 420); break;
    case 'barrier': e.w = 12; e.h = 18; e.hp = 8; e.score = 50; e.grav = false; break;
    case 'spider': e.w = 44; e.h = 28; e.hp = 95; e.score = 3000; e.mini = true; e.label = 'ПАУК'; e.mode = 'idle'; e.st = 1.4; e.legT = 0; e.n = 0; break;
  }
  if (type !== 'missile' && type !== 'carrier') e.hp *= G.escale;
  e.maxHp = e.hp;
  Object.assign(e, extra || {});
  G.enemies.push(e); return e;
}
function eShoot(x, y, a, sp, r) { G.ebullets.push({ nid: NID++, kind: 'orb', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: r || 3, life: 5 }); sfx('eshot'); }
const angTo = (x, y, p) => Math.atan2(p.y + p.h / 2 - y, p.x + p.w / 2 - x);

function processSpawns() {
  const L = G.lv;
  while (G.spawnIdx < L.spawns.length && L.spawns[G.spawnIdx].x < G.cam.x + W + 24) {
    const s = L.spawns[G.spawnIdx++];
    const edge = G.cam.x + W + 6;
    switch (s.type) {
      case 'runner': case 'heavy': case 'leaper': case 'shield': case 'kamikaze': {
        const x = findGroundX(Math.max(s.x, edge)); const gt = groundTop(x); if (gt === null) break;
        const h = { heavy: 26, leaper: 10, shield: 22, kamikaze: 10 }[s.type] || 20;
        spawnEnemy(s.type, x, gt - h); break;
      }
      case 'sniper': { const x = findGroundX(s.x); const gt = groundTop(x); if (gt === null) break; spawnEnemy('sniper', x, gt - 20); break; }
      case 'bomber': spawnEnemy('bomber', edge + 4, 30, { baseY: 30 }); break;
      case 'turret': { const x = findGroundX(s.x); const gt = groundTop(x); if (gt === null) break; spawnEnemy('turret', x, gt - 12); break; }
      case 'drone': spawnEnemy('drone', edge + 4, s.y, { baseY: s.y }); break;
      case 'carrier': spawnEnemy('carrier', edge + 4, 34, { baseY: 34 }); break;
    }
  }
}
function updAmbient(dt) {
  G.ambT -= dt;
  if (G.ambT > 0) return;
  const np = G.players.filter(p => p.active && !p.out).length;
  G.ambT = rnd(3.5, 6.5) / (1 + 0.4 * (np - 1)) * (G.d.eFire);
  const left = G.level >= 1 && Math.random() < 0.2;
  const x = left ? G.cam.x - 12 : G.cam.x + W + 6;
  const gt = groundTop(x + 5);
  if (gt === null) return;
  const e = spawnEnemy('runner', x, gt - 20); e.facing = left ? 1 : -1;
}
function updEnemies(dt) {
  const d = G.d;
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.t += dt; e.flash = Math.max(-1, e.flash - dt);
    const p = nearestPlayer(e.x + e.w / 2, e.y + e.h / 2);
    switch (e.type) {
      case 'runner': {
        if (e.t < dt * 1.5 && p) e.facing = p.x < e.x ? -1 : 1;
        if (e.stopT > 0) {
          e.stopT -= dt; e.vx = 0;
          if (e.stopT <= 0.15 && !e.shot) { e.shot = true; eShoot(e.x + e.w / 2 + e.facing * 7, e.y + 7, e.facing > 0 ? 0 : Math.PI, 135 * d.eSpeed); }
        } else {
          e.vx = e.facing * e.speed; e.cd -= dt;
          if (p && e.cd <= 0 && Math.abs(p.x - e.x) < 230 && Math.abs(p.y + p.h / 2 - (e.y + 8)) < 30 && e.x > G.cam.x && e.x < G.cam.x + W) {
            e.facing = p.x < e.x ? -1 : 1; e.stopT = 0.55; e.shot = false; e.cd = rnd(1.6, 3) * d.eFire;
          }
          if (e.onGround) { const ahead = e.x + (e.facing > 0 ? e.w + 4 : -4); if (e.hitX || groundTop(ahead) === null) e.vy = -310; }
        }
        moveBody(e, dt);
        break;
      }
      case 'turret': {
        if (p) { const ta = angTo(e.x + 7, e.y + 4, p); let da = ta - e.aim; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; e.aim += clamp(da, -2.5 * dt, 2.5 * dt); }
        e.cd -= dt;
        if (e.cd <= 0 && p && Math.abs(p.x - e.x) < 300) { e.burst = G.level >= 2 ? 3 : G.level === 1 ? 2 : 1; e.bt = 0; e.cd = 1.9 * d.eFire; }
        if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0) { eShoot(e.x + 7 + Math.cos(e.aim) * 10, e.y + 4 + Math.sin(e.aim) * 10, e.aim, 120 * d.eSpeed); e.burst--; e.bt = 0.16; } }
        break;
      }
      case 'drone': {
        if (e.hover) {
          const tx = p ? p.x + (e.nid % 2 ? -70 : 70) : e.x;
          e.x += clamp(tx - e.x, -50 * dt, 50 * dt);
          e.x = clamp(e.x, G.cam.x + 6, (G.arenaRight || G.cam.x + W) - 20);
        } else e.x -= 38 * d.eSpeed * dt;
        if (e.diving) { e.y += 160 * dt; if (e.y > H + 20) e.dead = true; }
        else e.y = e.baseY + Math.sin(e.t * 2.6) * 18;
        e.cd -= dt;
        if (p && e.cd <= 0 && e.x < G.cam.x + W - 4) { eShoot(e.x + 7, e.y + 8, angTo(e.x + 7, e.y + 8, p), 110 * d.eSpeed); e.cd = rnd(2, 3.2) * d.eFire; }
        if (G.level >= 1 && !e.hover && !e.diving && p && Math.abs(p.x - e.x) < 30 && Math.random() < 0.01) e.diving = true;
        break;
      }
      case 'leaper': {
        moveBody(e, dt);
        if (e.onGround) {
          e.vx = 0; e.cd -= dt;
          if (e.cd <= 0 && p && Math.abs(p.x - e.x) < 260) { const dx = p.x - e.x; e.vx = clamp(dx / 0.7, -150, 150) * d.eSpeed; e.vy = -310; e.cd = rnd(0.9, 1.5); e.facing = dx < 0 ? -1 : 1; }
        }
        break;
      }
      case 'heavy': {
        if (p) e.facing = p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1;
        e.vx = p && Math.abs(p.x - e.x) > 70 ? e.facing * e.speed : 0;
        moveBody(e, dt);
        e.cd -= dt;
        if (e.cd <= 0 && p && Math.abs(p.x - e.x) < 260) { e.burst = 3; e.bt = 0; e.cd = 2.2 * d.eFire; }
        if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0 && p) { let a = angTo(e.x + 9, e.y + 10, p); const base = e.facing > 0 ? 0 : Math.PI; let da = a - base; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; a = base + clamp(da, -0.5, 0.5); eShoot(e.x + 9 + e.facing * 10, e.y + 10, a, 130 * d.eSpeed, 3); e.burst--; e.bt = 0.13; } }
        break;
      }
      case 'carrier': e.x += (G.chase ? G.chaseV - 40 : -52) * dt; e.y = e.baseY + Math.sin(e.t * 3) * 10; break;
      case 'sniper': {
        moveBody(e, dt);
        if (p && e.stopT <= 0) e.facing = p.x < e.x ? -1 : 1;
        if (e.stopT > 0) {
          e.stopT -= dt;
          if (e.stopT > 0.35 && p) e.aim = angTo(e.x + 5 + e.facing * 6, e.y + 7, p);
          if (e.stopT <= 0) { eShoot(e.x + 5 + Math.cos(e.aim) * 10, e.y + 7 + Math.sin(e.aim) * 10, e.aim, 270 * d.eSpeed, 2); e.cd = rnd(2.4, 3.4) * d.eFire; }
        } else {
          e.cd -= dt;
          if (e.cd <= 0 && p && Math.abs(p.x - e.x) < 300 && e.x > G.cam.x && e.x < G.cam.x + W) { e.stopT = 1.15; e.aim = angTo(e.x + 5, e.y + 7, p); sfx('warn'); }
        }
        break;
      }
      case 'shield': {
        // каждые несколько секунд опускает щит — в этот момент уязвим спереди
        e.cd -= dt;
        if (e.stopT > 0) { e.stopT -= dt; e.vx = 0; moveBody(e, dt); break; }
        if (e.cd <= 0) { e.stopT = 0.9; e.cd = rnd(2.4, 3.4); break; }
        if (p) e.facing = p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1;
        e.vx = p && Math.abs(p.x - e.x) > 12 ? e.facing * e.speed : 0;
        if (e.onGround && e.hitX) e.vy = -280;
        moveBody(e, dt);
        break;
      }
      case 'kamikaze': {
        if (e.arm > 0) {
          e.arm -= dt; e.vx *= 0.85; moveBody(e, dt);
          if (e.arm <= 0) { blast(e.x + 6, e.y + 5, 30); killEnemy(e, null, true); }
          break;
        }
        if (p) e.facing = p.x < e.x ? -1 : 1;
        e.vx = e.facing * e.speed;
        if (e.onGround) { const ahead = e.x + (e.facing > 0 ? e.w + 4 : -4); if (e.hitX || groundTop(ahead) === null) e.vy = -300; }
        moveBody(e, dt);
        if (p && Math.abs(p.x + 5 - (e.x + 6)) < 26 && Math.abs(p.y + p.h - (e.y + e.h)) < 30) { e.arm = 0.45; sfx('warn'); }
        break;
      }
      case 'bomber': {
        e.x += (G.chase ? G.chaseV - 50 : -62 * d.eSpeed) * dt; e.y = e.baseY + Math.sin(e.t * 2) * 4; e.cd -= dt;
        if (e.cd <= 0 && e.x > G.cam.x + 10 && e.x < G.cam.x + W - 10) { e.cd = rnd(0.9, 1.4) * d.eFire; G.ebullets.push({ nid: NID++, kind: 'bomb', x: e.x + 13, y: e.y + 10, vx: G.chase ? G.chaseV - 20 : -30, vy: 20, r: 4, life: 4, grav: true }); }
        break;
      }
      case 'biker': {
        const tx = G.cam.x + e.relX;
        e.vx = clamp((tx - e.x) * 1.5, -200, 200) + (G.chase ? G.chaseV : 0);
        e.x += e.vx * dt; e.y = 13 * T - e.h - 2 + Math.sin(e.t * 8);
        if (p) e.facing = p.x < e.x ? -1 : 1;
        e.cd -= dt;
        if (e.cd <= 0 && p && Math.abs(e.x - tx) < 40) {
          e.cd = rnd(1.4, 2.2) * d.eFire;
          G.ebullets.push({ nid: NID++, kind: 'orb', x: e.x + 11 + e.facing * 13, y: e.y + 6, vx: e.facing * 140 + (G.chase ? G.chaseV : 0), vy: 0, r: 3, life: 4 }); sfx('eshot');
        }
        if (!G.chase) { e.relX -= 120 * dt; }
        break;
      }
      case 'barrier': break;
      case 'spider': {
        const minX = G.cam.x + 16, maxX = G.cam.x + W - e.w - 16, rage = e.hp < e.maxHp / 2 ? 1.45 : 1;
        e.legT += dt * (Math.abs(e.vx) > 1 ? 9 : 2);
        e.st -= dt * rage;
        switch (e.mode) {
          case 'walk': e.vx = Math.sign(e.tx - e.x) * 50 * d.eSpeed * rage; if (Math.abs(e.tx - e.x) < 4 || e.st <= 0) { e.vx = 0; e.mode = 'idle'; e.st = 0.6; } break;
          case 'idle':
            e.vx = 0;
            if (e.st <= 0) {
              const canSpawn = G.enemies.filter(q => q.type === 'leaper' && !q.dead).length < 3;
              const m = pick(canSpawn ? ['walk', 'shoot', 'shoot', 'leap', 'spawn'] : ['walk', 'shoot', 'shoot', 'leap']); e.mode = m; e.n = 0;
              if (m === 'walk') { e.tx = rnd(minX, maxX); e.st = 3; }
              if (m === 'shoot') { e.n = 3; e.st = 0.4; }
              if (m === 'leap') { if (e.onGround && p) { e.vy = -400; e.vx = clamp((p.x - e.x) / 0.85, -170, 170); } e.st = 2; }
              if (m === 'spawn') e.st = 0.5;
            }
            break;
          case 'shoot':
            e.vx = 0;
            if (e.st <= 0) {
              if (e.n > 0) { e.n--; e.st = 0.5; const mx = e.x + e.w / 2, my = e.y + 8, a = p ? angTo(mx, my, p) : Math.PI; for (let i = -2; i <= 2; i++) eShoot(mx, my, a + i * 0.18, 120 * d.eSpeed, 3); }
              else { e.mode = 'idle'; e.st = 0.9; }
            }
            break;
          case 'leap': if (e.onGround && e.st < 1.8) { e.vx = 0; shake(7); sfx('stomp'); eWaveAt(e.x + 4, -1); eWaveAt(e.x + e.w - 4, 1); e.mode = 'idle'; e.st = 0.9; } break;
          case 'spawn': if (e.st <= 0) { for (let k = 0; k < 2; k++) spawnEnemy('leaper', e.x + e.w / 2 + (k ? 10 : -20), e.y, { vy: -200 }); e.mode = 'idle'; e.st = 1.2; } break;
        }
        moveBody(e, dt); e.x = clamp(e.x, minX, maxX);
        if (p) e.facing = p.x < e.x ? -1 : 1;
        break;
      }
      case 'missile': {
        if (e.t < 0.45) { e.x += (e.vx || 0) * dt; e.y += (e.vy || -200) * dt; e.aim = -Math.PI / 2; }
        else {
          if (p) { const ta = angTo(e.x + 4, e.y + 4, p); let da = ta - e.aim; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; e.aim += clamp(da, -2.6 * dt, 2.6 * dt); }
          e.x += Math.cos(e.aim) * 95 * dt; e.y += Math.sin(e.aim) * 95 * dt;
          if (e.t > 4 || solidPx(e.x + 4, e.y + 4)) { killEnemy(e, null, true); }
        }
        break;
      }
    }
    if (e.dead) continue;
    if (G.lock && (e.wave || e.mini) && e.grav) {
      const L0 = G.cam.x + 2, R0 = G.cam.x + W - e.w - 2;
      if (e.inside) { const cx = clamp(e.x, L0, R0); if (cx !== e.x) { e.x = cx; if (e.type === 'runner') e.facing = e.x <= L0 ? 1 : -1; } }
      else if (e.x >= L0 && e.x <= R0) e.inside = true;
    }
    if (e.contact) for (const q of G.players) if (alive(q) && overlap({ x: q.x + 2, y: q.y + 2, w: q.w - 4, h: q.h - 3 }, e)) {
      hurtPlayer(q); if (e.type === 'missile') { killEnemy(e, null, true); break; }
    }
    const far = e.x + e.w < G.cam.x - 70 || e.x > G.cam.x + W + 220 || e.y > H + 30;
    if (far && !e.mini) e.dead = true;
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}
function damageEnemy(e, dmg, p, b) {
  if (e.dead) return;
  if (e.type === 'heavy' && b && Math.sign(b.vx) === -e.facing && Math.abs(b.vy) < Math.abs(b.vx) && b.type !== 'L') {
    dmg *= 0.25; sfx('clink'); spark(b.x, b.y, '#dfe8ff', 3);
  }
  e.hp -= dmg; if (!e.mini) e.flash = 0.07; else if (e.flash < -0.12) e.flash = 0.05;
  if (p) { p.st.dmg += dmg; p.tot.dmg += dmg; }
  if (p) p.meter = Math.min(100, p.meter + dmg * 1.6 * (1 + 0.5 * p.perks.magnet));
  if (e.hp <= 0) killEnemy(e, p); else sfx('hit');
}
function killEnemy(e, p, noScore) {
  if (e.dead) return;
  e.dead = true;
  const big = e.type === 'heavy' || e.type === 'turret' || e.type === 'bomber' || e.type === 'biker';
  boom(e.x + e.w / 2, e.y + e.h / 2, e.mini ? 5 : big ? 3 : e.type === 'missile' ? 1 : 2);
  sfx(e.mini ? 'bigboom' : 'boom'); if (big) shake(4); if (e.mini) { shake(10); flash(0.3); }
  if (noScore) return;
  G.combo++; G.comboT = 2.4;
  const mult = 1 + Math.min(3, Math.floor(G.combo / 6) * 0.5);
  const pts = Math.round(e.score * mult / 10) * 10;
  G.score += pts; G.stats.kills++;
  ftext(e.x + e.w / 2, e.y - 4, '+' + pts, mult > 1 ? '#ffd04a' : '#ffffff', 7);
  if (p) {
    p.kills++; p.st.kills++; p.tot.kills++;
    if (p.perks.vamp) { p.killHeal++; if (p.killHeal >= 20) { p.killHeal = 0; if (p.hp < p.maxHp) { p.hp++; ftext(p.x + 5, p.y - 8, '+1 ♥', '#5dff7a', 9); sfx('heal'); } } }
  }
  if (e.type === 'carrier') dropPickup(e.x + 4, e.y);
}
function dropPickup(x, y) {
  const hurt = G.players.some(p => alive(p) && p.hp < p.maxHp);
  const pool = ['S', 'S', 'L', 'L', 'H', 'H', 'F', 'F'].concat(hurt ? ['+', '+', '+'] : ['+']);
  G.pickups.push({ nid: NID++, kind: pick(pool), x, y, w: 12, h: 12, vx: 0, vy: -140, t: 0 });
}
function updPickups(dt) {
  for (const k of G.pickups) {
    k.t += dt; moveBody(k, dt);
    if (k.y > H) k.t = 99;
    for (const p of G.players) {
      if (!alive(p) || k.t >= 99 || !overlap(p, k)) continue;
      k.t = 99; sfx('pickup');
      if (k.kind === '+') {
        if (p.hp < p.maxHp) { p.hp++; ftext(p.x + 5, p.y - 8, '+1 ♥', '#5dff7a', 9); } else { G.score += 500; ftext(p.x + 5, p.y - 8, '+500', '#5dff7a', 8); }
      } else {
        if (p.weapon === k.kind) { p.wlvl = 2; ftext(p.x + 5, p.y - 8, WNAME[k.kind] + ' МАКС', WCOL[k.kind], 9); }
        else { p.weapon = k.kind; p.wlvl = 1; ftext(p.x + 5, p.y - 8, WNAME[k.kind], WCOL[k.kind], 9); }
      }
    }
  }
  G.pickups = G.pickups.filter(k => k.t < 14 && k.x > G.cam.x - 40);
}

// ───────────────────────── пули ─────────────────────────
function bossPartRect(b, pt) { return { x: b.x + pt.ox, y: b.y + pt.oy + (b.rise || 0) * 200, w: pt.w, h: pt.h }; }
function updPBullets(dt) {
  for (const b of G.pbullets) {
    b.life -= dt;
    if (b.type === 'H') {
      let tgt = null, bd = 260 * 260;
      for (const e of G.enemies) { if (e.dead) continue; const dx = e.x + e.w / 2 - b.x, dy = e.y + e.h / 2 - b.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; tgt = { x: e.x + e.w / 2, y: e.y + e.h / 2 }; } }
      if (G.boss && G.boss.ready && !G.boss.dead) for (const pt of G.boss.parts) { if (!pt.alive) continue; const r = bossPartRect(G.boss, pt); const dx = r.x + r.w / 2 - b.x, dy = r.y + r.h / 2 - b.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; tgt = { x: r.x + r.w / 2, y: r.y + r.h / 2 }; } }
      if (tgt) { const ta = Math.atan2(tgt.y - b.y, tgt.x - b.x), a = Math.atan2(b.vy, b.vx); let da = ta - a; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; const na = a + clamp(da, -7 * dt, 7 * dt), sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp; }
    }
    if (b.type === 'F') { b.r += dt * 14; b.vx *= 0.975; b.vy *= 0.975; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (solidPx(b.x, b.y)) { b.life = 0; spark(b.x, b.y, WCOL[b.type], 2); continue; }
    if (b.x < G.cam.x - 20 || b.x > G.cam.x + W + 20 || b.y < -20 || b.y > H + 20) { b.life = 0; continue; }
    for (const e of G.enemies) {
      if (e.dead || (b.hit && b.hit.has(e))) continue;
      if (circRect(b.x, b.y, b.r, e.x, e.y, e.w, e.h)) {
        if (e.type === 'shield' && !(e.stopT > 0) && b.type !== 'L' && b.type !== 'H' && Math.sign(b.vx) === -e.facing && Math.abs(b.vy) < Math.abs(b.vx) * 1.5) {
          sfx('clink'); spark(b.x, b.y, '#dfe8ff', 3); b.life = 0; break;
        }
        if (!b.counted && b.owner) { b.counted = true; b.owner.st.hits++; b.owner.tot.hits++; }
        damageEnemy(e, b.dmg, b.owner, b); spark(b.x, b.y, WCOL[b.type], 2);
        if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = new Set())).add(e); } else { b.life = 0; break; }
      }
    }
    if (b.life <= 0) continue;
    const bs = G.boss;
    if (bs && bs.ready && !bs.dead) for (const pt of bs.parts) {
      if (!pt.alive || (b.hit && b.hit.has(pt))) continue;
      const r = bossPartRect(bs, pt);
      if (circRect(b.x, b.y, b.r, r.x, r.y, r.w, r.h)) {
        if (!b.counted && b.owner) { b.counted = true; b.owner.st.hits++; b.owner.tot.hits++; }
        damagePart(bs, pt, b.dmg, b.owner, b);
        if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = new Set())).add(pt); } else { b.life = 0; break; }
      }
    }
  }
  G.pbullets = G.pbullets.filter(b => b.life > 0);
}
function blast(x, y, r) {
  boom(x, y, 2); sfx('boom'); shake(4);
  for (const p of G.players) if (alive(p) && circRect(x, y, r, p.x, p.y, p.w, p.h)) hurtPlayer(p);
}
function updEBullets(dt) {
  for (const b of G.ebullets) {
    b.life -= dt;
    if (b.grav) b.vy += GRAV * 0.55 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (!b.noTile && b.y > 0 && solidPx(b.x, b.y + (b.r || 0))) {
      if (b.kind === 'bomb' || b.kind === 'rock') blast(b.x, b.y, 24);
      b.life = 0; continue;
    }
    if (b.x < G.cam.x - 60 || b.x > G.cam.x + W + 60 || b.y > H + 20 || b.y < -80) { b.life = 0; continue; }
    for (const p of G.players) {
      if (!alive(p)) continue;
      const px = p.x + 2, py = p.y + 3, pw = p.w - 4, ph = p.h - 4;
      const hit = b.hw ? (Math.abs(b.x - (px + pw / 2)) < b.hw + pw / 2 && Math.abs(b.y - (py + ph / 2)) < b.hh + ph / 2) : circRect(b.x, b.y, b.r, px, py, pw, ph);
      if (hit) {
        if (b.kind === 'bomb' || b.kind === 'rock') { blast(b.x, b.y, 24); b.life = 0; break; }
        hurtPlayer(p); if (b.kind !== 'wave') { b.life = 0; break; }
      }
    }
  }
  G.ebullets = G.ebullets.filter(b => b.life > 0);
}
function updBeams(dt) {
  for (const bm of G.beams) {
    if (bm.warn > 0) {
      bm.warn -= dt;
      if (bm.kind === 'line' && bm.warn > 0.4) { const p = nearestPlayer(bm.ox, bm.oy); if (p) { bm.tx = p.x + p.w / 2; bm.ty = p.y + p.h / 2; } }
      if (Math.floor(bm.warn * 10) % 3 === 0) sfx('warn');
      if (bm.warn <= 0) { sfx('laser'); shake(3); }
      continue;
    }
    bm.fire -= dt;
    for (const p of G.players) {
      if (!alive(p)) continue;
      if (bm.kind === 'h') { if (p.y < bm.y + bm.hh && p.y + p.h > bm.y - bm.hh && p.x + p.w > bm.x1 && p.x < bm.x2) hurtPlayer(p); }
      else {
        const dx = bm.tx - bm.ox, dy = bm.ty - bm.oy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        const cx = p.x + p.w / 2 - bm.ox, cy = p.y + p.h / 2 - bm.oy, along = cx * ux + cy * uy;
        if (along > 0) { const perp = Math.abs(cx * uy - cy * ux); if (perp < 9) hurtPlayer(p); }
      }
    }
  }
  G.beams = G.beams.filter(b => b.warn > 0 || b.fire > 0);
}
function updWarns(dt) {
  for (const w of G.warns) {
    w.t -= dt;
    if (w.t <= 0) G.ebullets.push({ nid: NID++, kind: 'rock', x: w.x, y: -12, vx: 0, vy: 260, r: 6, life: 4, grav: true });
  }
  G.warns = G.warns.filter(w => w.t > 0);
}

// ───────────────────────── боссы ─────────────────────────
function bossTarget(b) { return nearestPlayer(b.x + b.w / 2, b.y + b.h / 2) || { x: G.cam.x + W / 2, y: 180, w: 10, h: 22 }; }
function makeBoss(n) {
  const ax = G.lv.arenaX, bs = G.bscale, gy = 13 * T;
  if (n === 0) { const hp = 150 * bs; return { kind: 0, name: 'МОЛОТ', x: ax + W - 110, y: -90, w: 64, h: 58, vx: 0, vy: 0, gy, face: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, t: 0, legT: 0, ready: false, parts: [{ id: 'body', ox: 0, oy: 0, w: 64, h: 58, hp, max: hp, alive: true, flash: 0 }] }; }
  if (n === 1) { const hp = 165 * bs; return { kind: 1, name: 'ГАРПИЯ', x: ax + W + 60, y: 40, w: 88, h: 30, hx: ax + W - 150, gy, face: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, t: 0, rot: 0, ang: 0, emit: 0, dir: -1, ready: false, parts: [{ id: 'body', ox: 0, oy: 0, w: 88, h: 30, hp, max: hp, alive: true, flash: 0 }] }; }
  const b = { kind: 2, name: 'ЯДРО', x: ax + W - 104, y: 16, w: 104, h: 192, gy, face: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, t: 0, rise: 1, ang: 0, emit: 0, ready: false, parts: [] };
  b.parts.push({ id: 'core', ox: 44, oy: 92, w: 34, h: 34, hp: 170 * bs, max: 170 * bs, alive: true, flash: 0, core: true });
  b.parts.push({ id: 'armT', ox: 4, oy: 34, w: 30, h: 22, hp: 55 * bs, max: 55 * bs, alive: true, flash: 0, cd: 1.4, burst: 0, bt: 0 });
  b.parts.push({ id: 'armB', ox: 4, oy: 146, w: 30, h: 22, hp: 55 * bs, max: 55 * bs, alive: true, flash: 0, cd: 2.6, burst: 0, bt: 0 });
  G.arenaRight = b.x + 18;
  return b;
}
function startBoss() {
  G.arena = true; G.cam.x = G.lv.arenaX;
  G.enemies = G.enemies.filter(e => e.x > G.cam.x - 10 && e.x < G.cam.x + W + 10);
  G.boss = makeBoss(G.level); G.bossIntroT = 2.8; sfx('alarm'); setSong('boss');
}
function damagePart(b, pt, dmg, p, bl) {
  if (!pt.alive || b.dead || !b.ready) return;
  if (b.kind === 2 && pt.core && b.phase === 1) { sfx('clink'); if (bl) spark(bl.x, bl.y, '#7ff0ff', 2); return; }
  pt.hp -= dmg; if (pt.flash < -0.12) pt.flash = 0.05; sfx('hit');
  if (p) { p.st.dmg += dmg; p.tot.dmg += dmg; }
  if (bl) spark(bl.x, bl.y, '#fff', 2);
  if (p) p.meter = Math.min(100, p.meter + dmg * 1.2 * (1 + 0.5 * p.perks.magnet));
  if (pt.hp <= 0) {
    pt.hp = 0; pt.alive = false;
    const r = bossPartRect(b, pt); boom(r.x + r.w / 2, r.y + r.h / 2, 4); sfx('bigboom'); shake(8);
    if (b.kind === 2 && !pt.core) {
      G.score += 2000; ftext(r.x + r.w / 2, r.y - 6, '+2000', '#ffd04a', 9);
      if (!b.parts.some(q => !q.core && q.alive)) { b.phase = 2; flash(0.3); ftext(b.x + 40, b.y + 70, 'ЯДРО ОТКРЫТО!', '#ff6a3a', 12); }
    } else { bossDie(b); return; }
  }
  if (b.kind !== 2 && b.phase === 1 && pt.hp < pt.max * 0.5) { b.phase = 2; flash(0.25); shake(6); ftext(b.x + b.w / 2, b.y - 10, 'ЯРОСТЬ!', '#ff4a4a', 12); sfx('alarm'); }
  if (b.kind === 2 && pt.core && b.phase === 2 && pt.hp < pt.max * 0.35) { b.phase = 3; flash(0.25); ftext(b.x + 40, b.y + 70, 'ПЕРЕГРЕВ!', '#ffffff', 12); sfx('alarm'); }
}
function bossDie(b) {
  b.dead = true; b.deathT = 2.6; b.boomT = 0; G.slow = 1.4;
  G.ebullets.length = 0; G.beams.length = 0; G.warns.length = 0;
  for (const e of G.enemies) killEnemy(e, null);
  const pts = 10000 * (G.level + 1); G.score += pts;
  ftext(b.x + b.w / 2, b.y + 20, '+' + pts, '#ffd04a', 14);
  sfx('bigboom'); shake(12); flash(0.5);
}
function updBoss(dt) {
  const b = G.boss; if (!b) return;
  b.t += dt;
  for (const pt of b.parts) pt.flash = Math.max(-1, pt.flash - dt);
  if (b.dead) {
    b.deathT -= dt; b.boomT -= dt;
    if (b.boomT <= 0) { b.boomT = 0.09; boom(b.x + rnd(0, b.w), b.y + (b.rise || 0) * 200 + rnd(0, b.h), rint(2, 4)); if (Math.random() < 0.4) sfx('boom'); shake(5); }
    if (b.deathT <= 0) {
      G.boss = null; G.arenaRight = 0; G.state = 'clear'; G.clearT = 0; setSong('win'); saveBest();
      const un = Math.min(2, G.level + 1); if (un > G.unlock) { G.unlock = un; save('unlock', un); }
    }
    return;
  }
  if (G.bossIntroT > 0) G.bossIntroT -= dt;
  if (b.kind === 0) boss0(b, dt); else if (b.kind === 1) boss1(b, dt); else boss2(b, dt);
  if (b.ready && b.kind !== 2 && !(b.kind === 1 && b.state === 'sweep' && (b.sub === 0 || b.sub === 3))) {
    const r = bossPartRect(b, b.parts[0]); const inner = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 6 };
    for (const p of G.players) if (alive(p) && overlap(p, inner)) hurtPlayer(p);
  }
}
function eWaveAt(x, dir) { G.ebullets.push({ nid: NID++, kind: 'wave', x, y: 13 * T - 7, hw: 5, hh: 7, vx: dir * 175, vy: 0, life: 3.2, noTile: true, r: 0 }); }
const eWave = eWaveAt;
function chooseAttack(b, opts) { let s; let k = 0; do { s = pick(opts); k++; } while (s === b.last && opts.length > 1 && k < 10); b.last = s; b.state = s; b.st = 0; b.n = 0; b.sub = 0; return s; }

function boss0(b, dt) { // МОЛОТ
  const ax = G.lv.arenaX, gy = b.gy, p = bossTarget(b), P2 = b.phase > 1, sp = P2 ? 1.35 : 1;
  b.legT += Math.abs(b.vx) * dt * 0.09;
  if (P2 && Math.random() < 0.15) addPartSmoke(b.x + rnd(10, 54), b.y + rnd(4, 20));
  switch (b.state) {
    case 'enter':
      b.vy += GRAV * dt; b.y += b.vy * dt;
      if (b.y >= gy - b.h) { b.y = gy - b.h; b.vy = 0; shake(10); sfx('stomp'); emit({ e: 'u', x: r1(b.x + 32), y: gy }); b.state = 'idle'; b.st = 1.6; b.ready = true; }
      break;
    case 'idle':
      b.st -= dt; b.face = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
      if (b.st <= 0) {
        const opts = ['salvo', 'cannon', 'stomp', 'walk']; if (P2) opts.push('laser', 'stomp');
        const s = chooseAttack(b, opts);
        if (s === 'walk') b.tx = rnd(ax + 170, ax + W - b.w - 10);
        if (s === 'salvo') { b.n = P2 ? 6 : 4; b.st = 0.3; }
        if (s === 'cannon') { b.n = 3; b.st = 0.35; }
        if (s === 'stomp') b.st = 0.45;
        if (s === 'laser') {
          const x1 = b.face < 0 ? ax : b.x + b.w, x2 = b.face < 0 ? b.x : ax + W;
          G.beams.push({ kind: 'h', y: gy - 18, hh: 4, x1, x2, warn: 1.0, fire: 0.55, hint: 1 }); b.st = 1.9;
        }
      }
      break;
    case 'walk': {
      const dir = Math.sign(b.tx - b.x); b.vx = dir * 55 * sp; b.x += b.vx * dt;
      if (Math.abs(b.tx - b.x) < 3 || dir === 0) { b.vx = 0; b.state = 'idle'; b.st = 0.5 / sp; }
      break;
    }
    case 'salvo':
      b.st -= dt;
      if (b.st <= 0 && b.n > 0) { b.n--; b.st = 0.22 / sp; spawnEnemy('missile', b.x + 12 + Math.random() * 36, b.y - 4, { vy: -220, vx: rnd(-60, 30) }); sfx('shootH'); }
      if (b.n <= 0 && b.st <= 0) { b.state = 'idle'; b.st = 1.1 / sp; }
      break;
    case 'cannon':
      b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) {
          b.n--; b.st = 0.5 / sp;
          const mx = b.x + (b.face < 0 ? -10 : b.w + 10), my = b.y + 32, a = angTo(mx, my, p), k = P2 ? 5 : 3;
          for (let i = 0; i < k; i++) eShoot(mx, my, a + (i - (k - 1) / 2) * 0.16, 125 * sp, 4);
          spark(mx, my, '#ffd04a', 5);
        } else { b.state = 'idle'; b.st = 1.0 / sp; }
      }
      break;
    case 'stomp':
      if (b.sub === 0) { b.st -= dt; if (b.st <= 0) { b.sub = 1; b.vy = -470; b.tx = clamp(p.x + p.w / 2 - b.w / 2, ax + 8, ax + W - b.w - 8); } }
      else if (b.sub === 1) {
        b.vy += GRAV * dt; b.y += b.vy * dt; b.vx = (b.tx - b.x) * 2.4; b.x += b.vx * dt;
        if (b.vy > 0 && b.y >= gy - b.h) { b.y = gy - b.h; b.vy = 0; b.vx = 0; b.sub = 2; b.st = 0.9 / sp; shake(10); sfx('stomp'); eWave(b.x + 4, -1); eWave(b.x + b.w - 4, 1); b.wave2 = P2 ? 0.35 : 0; }
      } else {
        if (b.wave2 > 0) { b.wave2 -= dt; if (b.wave2 <= 0) { eWave(b.x + 4, -1); eWave(b.x + b.w - 4, 1); } }
        b.st -= dt; if (b.st <= 0) { b.state = 'idle'; b.st = 0.8 / sp; }
      }
      break;
    case 'laser': b.st -= dt; if (b.st <= 0) { b.state = 'idle'; b.st = 0.9; } break;
  }
  b.x = clamp(b.x, ax + 4, ax + W - b.w - 4);
}
function addPartSmoke(x, y) { addPart({ x, y, vx: rnd(-8, 8), vy: rnd(-30, -15), life: 0.9, max: 0.9, c: '#3a3036', s: 4, g: -0.05 }); }

function boss1(b, dt) { // ГАРПИЯ
  const ax = G.lv.arenaX, p = bossTarget(b), P2 = b.phase > 1, sp = P2 ? 1.3 : 1;
  b.rot += dt * 30;
  const hoverY = 46 + Math.sin(b.t * 2) * 6;
  const hover = k => { b.y += (hoverY - b.y) * Math.min(1, dt * (k || 3)); };
  const cx = b.x + b.w / 2, cy = b.y + b.h;
  switch (b.state) {
    case 'enter': b.x += (b.hx - b.x) * Math.min(1, dt * 1.5); hover(2); if (Math.abs(b.hx - b.x) < 4 && G.bossIntroT <= 0) { b.state = 'idle'; b.st = 0.8; b.ready = true; } break;
    case 'idle':
      b.st -= dt; hover();
      if (b.st <= 0) {
        const opts = ['move', 'fan', 'bombs'];
        if (G.enemies.filter(e => e.type === 'drone').length < 2) opts.push('drones');
        if (P2) opts.push('sweep', 'spiral', 'fan');
        const s = chooseAttack(b, opts);
        if (s === 'move') b.tx = rnd(ax + 16, ax + W - b.w - 16);
        if (s === 'fan') { b.n = 3; b.st = 0.3; }
        if (s === 'bombs') { b.dir = cx < ax + W / 2 ? 1 : -1; b.st = 0.2; }
        if (s === 'drones') b.st = 0.5;
        if (s === 'sweep') b.st = 0.8;
        if (s === 'spiral') { b.st = 2.2; b.emit = 0; }
      }
      break;
    case 'move': b.x += (b.tx - b.x) * Math.min(1, dt * 1.8 * sp); hover(); if (Math.abs(b.tx - b.x) < 4) { b.state = 'idle'; b.st = 0.5 / sp; } break;
    case 'fan':
      hover(); b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) { b.n--; b.st = 0.55 / sp; const a = angTo(cx, cy, p); for (let i = -3; i <= 3; i++) eShoot(cx, cy, a + i * 0.2, 110 * sp, 3); }
        else { b.state = 'idle'; b.st = 0.9 / sp; }
      }
      break;
    case 'bombs':
      b.x += b.dir * 140 * sp * dt; hover(); b.st -= dt;
      if (b.st <= 0) { b.st = 0.32 / sp; G.ebullets.push({ nid: NID++, kind: 'bomb', x: cx, y: cy, vx: b.dir * 20, vy: 30, r: 4, life: 4, grav: true }); }
      if ((b.dir > 0 && b.x > ax + W - b.w - 6) || (b.dir < 0 && b.x < ax + 6)) { b.state = 'idle'; b.st = 0.8 / sp; }
      break;
    case 'drones':
      hover(); b.st -= dt;
      if (b.st <= 0) { for (let k = 0; k < 2; k++) spawnEnemy('drone', b.x + 20 + k * 40, b.y + b.h, { hover: true, baseY: rnd(70, 120) }); b.state = 'idle'; b.st = 1.0; }
      break;
    case 'sweep':
      if (b.sub === 0) { b.y += (-70 - b.y) * Math.min(1, dt * 3); b.x += (ax + W + 40 - b.x) * Math.min(1, dt * 3); b.st -= dt; if (b.st <= 0) { b.sub = 1; b.x = ax + W + 20; b.y = b.gy - 16 - b.h; b.st = 1.2; } }
      else if (b.sub === 1) { b.st -= dt; if (Math.floor(b.st * 10) % 3 === 0) sfx('warn'); if (b.st <= 0) { b.sub = 2; sfx('dash'); } }
      else if (b.sub === 2) { b.x -= 330 * dt; if (b.x < ax - b.w - 20) { b.sub = 3; b.x = ax + W - 150; b.y = -70; } }
      else { b.y += (hoverY - b.y) * Math.min(1, dt * 2.5); if (Math.abs(b.y - hoverY) < 4) { b.state = 'idle'; b.st = 0.8; } }
      break;
    case 'spiral':
      hover(); b.st -= dt; b.emit -= dt;
      if (b.emit <= 0) { b.emit = 0.07; b.ang += 0.42; for (let k = 0; k < 2; k++) eShoot(cx, b.y + b.h / 2, b.ang + k * Math.PI, 85, 3); }
      if (b.st <= 0) { b.state = 'idle'; b.st = 1.0; }
      break;
  }
  if (b.state !== 'sweep' && b.state !== 'enter') b.x = clamp(b.x, ax + 4, ax + W - b.w - 4);
}

function boss2(b, dt) { // ЯДРО
  const ax = G.lv.arenaX, p = bossTarget(b), sp = b.phase === 1 ? 1 : b.phase === 2 ? 1.25 : 1.5;
  const core = b.parts[0], cx = b.x + core.ox + core.w / 2, cy = b.y + core.oy + core.h / 2;
  if (b.state === 'enter') {
    b.rise = Math.max(0, b.rise - dt * 0.45); shake(1.5);
    if (b.rise <= 0 && G.bossIntroT <= 0) { b.state = 'idle'; b.st = 1.2; b.ready = true; }
    return;
  }
  for (const a of b.parts) {
    if (a.core || !a.alive) continue;
    a.cd -= dt;
    if (a.cd <= 0) { a.burst = 3; a.bt = 0; a.cd = 2.4 / sp; }
    if (a.burst > 0) { a.bt -= dt; if (a.bt <= 0) { const mx = b.x + a.ox - 2, my = b.y + a.oy + a.h / 2; eShoot(mx, my, angTo(mx, my, p), 120 * sp, 3); a.burst--; a.bt = 0.15; } }
  }
  switch (b.state) {
    case 'idle':
      b.st -= dt;
      if (b.st <= 0) {
        const s = chooseAttack(b, ['spiral', 'eyelaser', 'summon', 'debris', 'spiral']);
        if (s === 'spiral') { b.st = 2.4; b.emit = 0; }
        if (s === 'eyelaser') { b.n = b.phase >= 3 ? 2 : 1; b.st = 0; }
        if (s === 'summon') b.st = 0.4;
        if (s === 'debris') {
          const k = b.phase >= 2 ? 6 : 4;
          for (let i = 0; i < k; i++) G.warns.push({ x: rnd(ax + 20, G.arenaRight - 20), t: 0.9 + i * 0.08 });
          G.warns.push({ x: p.x + p.w / 2, t: 1.0 }); b.st = 1.6;
        }
      }
      break;
    case 'spiral': {
      b.st -= dt; b.emit -= dt;
      if (b.emit <= 0) { b.emit = 0.09 / sp; b.ang += 0.33; const arms = b.phase >= 3 ? 3 : 2; for (let k = 0; k < arms; k++) eShoot(cx, cy, b.ang + k * 6.283 / arms, 80 * sp, 3); }
      if (b.st <= 0) { b.state = 'idle'; b.st = 1.0 / sp; }
      break;
    }
    case 'eyelaser':
      b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) { b.n--; G.beams.push({ kind: 'line', ox: cx, oy: cy, tx: p.x + p.w / 2, ty: p.y + p.h / 2, warn: 1.1, fire: 0.5 }); b.st = 1.7; }
        else { b.state = 'idle'; b.st = 0.6; }
      }
      break;
    case 'summon':
      b.st -= dt;
      if (b.st <= 0) { for (let k = 0; k < 2; k++) { const e = spawnEnemy('runner', rnd(ax + 30, ax + 260), -24); e.facing = Math.random() < 0.5 ? -1 : 1; } b.state = 'idle'; b.st = 1.2; }
      break;
    case 'debris': b.st -= dt; if (b.st <= 0) { b.state = 'idle'; b.st = 0.8 / sp; } break;
  }
}

// ───────────────────────── камера ─────────────────────────
function updateCamera(dt) {
  if (G.arena || G.lock) return;
  const Z = G.lv.zones || {};
  if (G.chase) {
    G.cam.x += G.chaseV * dt;
    if (G.cam.x >= Z.chase.x1 - W) { G.cam.x = Z.chase.x1 - W; endChase(); }
    return;
  }
  const al = alivePlayers();
  if (al.length) {
    const avg = al.reduce((s, p) => s + p.x, 0) / al.length, minx = Math.min(...al.map(p => p.x));
    let target = Math.min(avg - W * 0.4, minx - 8);
    if (Z.lock && !G.lockDone) target = Math.min(target, Z.lock.x);
    if (target > G.cam.x) G.cam.x += (target - G.cam.x) * Math.min(1, dt * 6);
  }
  if (Z.chase && !G.chaseDone && G.cam.x >= Z.chase.x0) startChase();
  if (Z.lock && !G.lockDone && G.cam.x >= Z.lock.x - 2) startLock();
  if (G.cam.x >= G.lv.arenaX) startBoss();
}

// ───────────────────────── эпизоды: погоня и запертые зоны ─────────────────────────
function startChase() {
  G.chase = true; G.chaseDone = false; G.chaseT = { bar: 1.6, bik: 1.2, bomb: 6, cap: 5 };
  G.players.forEach(p => { p.bike = true; });
  G.lockMsg = 'ПОГОНЯ! ПРЫГАЙ ЧЕРЕЗ БАРЬЕРЫ'; G.lockMsgT = 2.8; sfx('alarm');
}
function endChase() {
  G.chase = false; G.chaseDone = true;
  G.players.forEach(p => { p.bike = false; });
  G.lockMsg = 'ВЫРВАЛИСЬ!'; G.lockMsgT = 1.8; sfx('confirm');
}
function updChase(dt) {
  const T2 = G.chaseT, gy = 13 * T, np = G.players.filter(p => p.active && !p.out).length;
  T2.bar -= dt; T2.bik -= dt; T2.bomb -= dt; T2.cap -= dt;
  if (T2.bar <= 0) { T2.bar = rnd(1.3, 2.3); spawnEnemy('barrier', G.cam.x + W + 12, gy - 18); }
  if (T2.bik <= 0) {
    T2.bik = rnd(2.0, 3.4) / (1 + 0.3 * (np - 1));
    if (G.enemies.filter(e => e.type === 'biker').length < 2 + np) {
      const behind = Math.random() < 0.35;
      spawnEnemy('biker', behind ? G.cam.x - 40 : G.cam.x + W + 30, gy - 20, { relX: behind ? rnd(30, 120) : rnd(300, 430) });
    }
  }
  if (T2.bomb <= 0) { T2.bomb = rnd(6, 9); spawnEnemy('bomber', G.cam.x + W + 20, 30, { baseY: 30 }); }
  if (T2.cap <= 0) { T2.cap = rnd(9, 12); spawnEnemy('carrier', G.cam.x + W + 10, 40, { baseY: 40 }); }
}
function startLock() {
  const Z = G.lv.zones.lock;
  G.cam.x = Z.x; G.lock = { kind: Z.kind, wave: 0, t: Z.kind === 'spider' ? 0.5 : 1.2 };
  G.lockMsg = Z.kind === 'spider' ? 'МИНИ-БОСС: ПАУК' : 'ЗАСАДА! ТРИ ВОЛНЫ'; G.lockMsgT = 2.5; sfx('alarm');
  if (Z.kind === 'spider') spawnEnemy('spider', Z.x + W - 80, 13 * T - 28);
}
function spawnWave(n) {
  const x0 = G.cam.x, gy = 13 * T, np = G.players.filter(p => p.active && !p.out).length;
  const add = (type, x, y, ex) => { const e = spawnEnemy(type, x, y, ex); e.wave = true; return e; };
  if (n === 1) { for (let k = 0; k < 2; k++) { add('runner', x0 - 12 - k * 20, gy - 20); add('runner', x0 + W + 6 + k * 20, gy - 20); } add('kamikaze', x0 + W + 40, gy - 10); add('kamikaze', x0 - 40, gy - 10); }
  if (n === 2) { add('shield', x0 + W + 8, gy - 22); add('shield', x0 - 14, gy - 22); for (let k = 0; k < 3; k++) add('drone', x0 + 90 + k * 120, -20, { hover: true, baseY: 55 + k * 18 }); add('runner', x0 + 150, -30); add('runner', x0 + 320, -30); }
  if (n === 3) { add('heavy', x0 + W + 10, gy - 26); add('sniper', x0 + W - 60, -30); add('sniper', x0 + 40, -30); add('kamikaze', x0 + W + 30, gy - 10); add('kamikaze', x0 - 30, gy - 10); add('bomber', x0 + W + 20, 30, { baseY: 30 }); add('leaper', x0 + 200, -20); }
  if (np > 1) { add('runner', x0 + W + 50, gy - 20); add('runner', x0 - 50, gy - 20); }
}
function updLock(dt) {
  const L = G.lock;
  L.t -= dt;
  if (L.kind === 'spider') { if (L.t <= 0 && !G.enemies.some(e => e.mini && !e.dead)) endLock(); return; }
  if (G.enemies.some(e => e.wave && !e.dead)) return;
  if (L.t > 0) return;
  if (L.wave >= 3) { endLock(); return; }
  L.wave++; spawnWave(L.wave); L.t = 1.4;
  G.lockMsg = 'ВОЛНА ' + L.wave + ' / 3'; G.lockMsgT = 1.6; sfx('alarm');
}
function endLock() {
  G.lock = null; G.lockDone = true;
  G.lockMsg = 'ПРОХОД ОТКРЫТ →'; G.lockMsgT = 2; sfx('confirm');
  G.score += 3000; ftext(G.cam.x + W / 2, 100, '+3000', '#ffd04a', 11);
}

// ───────────────────────── ход игры ─────────────────────────
function setSong(name) { G.song = name; playSong(name); }
function saveBest() { if (G.score > G.best) { G.best = G.score; save('best', G.best); } }
function loadLevel(n) {
  G.level = n; G.lv = getLevel(n);
  G.enemies = []; G.pbullets = []; G.ebullets = []; G.pickups = []; G.beams = []; G.warns = [];
  G.boss = null; G.arena = false; G.arenaRight = 0; G.spawnIdx = 0; G.ambT = 5; G.combo = 0; G.cam.x = 0;
  G.bannerT = 3.2; G.bossIntroT = 0; G.wipeT = 0; G.hintT = n === 0 ? 12 : 0; G.paused = false; G.slow = 0;
  G.chase = false; G.chaseDone = false; G.lock = null; G.lockDone = false; G.lockMsgT = 0; G.stats.time = 0; G.stats.kills = 0;
  const np = G.players.filter(p => p.active).length || 1;
  G.escale = (1 + 0.3 * (np - 1)) * G.d.eHp; G.bscale = (1 + 0.6 * (np - 1)) * G.d.bossHp;
  G.players.forEach((p, i) => {
    if (!p.active) return;
    p.out = false; p.downed = false; p.respawnT = 0; p.x = 40 + i * 26; p.y = 13 * T - 22; p.h = 22; p.vx = 0; p.vy = 0;
    p.hp = p.maxHp; p.invT = 1.5; p.lastSafe = { x: p.x, y: 13 * T }; p.dashT = 0; p.overT = 0; p.crouch = false; p.revive = 0;
    p.bike = false; p.st = newStats();
    if (p.perks.arsenal && p.weapon === 'B') { p.weapon = 'S'; p.wlvl = 1; }
  });
  setSong(THEMES[n].song);
}
function startGame() {
  G.d = DIFFS[G.diff]; save('diff', G.diff);
  G.lives = G.d.lives; G.score = 0; G.stats = { kills: 0, time: 0 };
  G.players = [makePlayer(0, G.d.hp), makePlayer(1, G.d.hp)];
  G.players[0].active = true; G.players[1].active = !!G.sel.p2;
  const start = clamp(G.startLv | 0, 0, G.unlock);
  const coop = G.players[1].active;
  if (start > 0) G.players.forEach(p => {
    if (!p.active) return;
    for (let k = 0; k < start; k++) {
      const pool = PERKS.filter(q => (q.stack || !p.perks[q.id]) && (!q.coop || coop));
      if (pool.length) applyPerk(p, pick(pool).id);
    }
  });
  loadLevel(start); G.state = 'play'; sfx('confirm');
  if (start > 0) ftext(W / 2, 74, 'БОНУС ЗА ПРОПУСК: +' + start + ' УЛУЧШЕНИЯ КАЖДОМУ', '#5dff7a', 9);
}
function joinMid(p) {
  p.active = true; p.out = false; p.hp = p.maxHp = G.d.hp; p.respawnT = 0.3; p.downed = false;
  G.escale = 1.3 * G.d.eHp;
  ftext(G.cam.x + W / 2, 80, PNAME[p.id] + ' В ДЕЛЕ!', palOf(p.id).scarf, 11); sfx('confirm');
}
function gameOver() { G.state = 'over'; G.menuIdx = 0; setSong('over'); saveBest(); }
function goSelect() { showLobby(false); G.state = 'select'; G.menuIdx = 0; G.paused = false; if (NET.mode === 'host') G.sel.p2 = true; setSong('title'); }

function updTitle() { if (NET.mode === 'local' && !lobbyBusy() && (anyP('ok') || (!IS_TOUCH && (anyP('fire') || anyP('jump'))))) { G.sel = { p2: false }; goSelect(); sfx('confirm'); } }
function updSelect() {
  if (NET.mode === 'local') {
    if (INP[1].p.fire && !G.sel.p2) { G.sel.p2 = true; sfx('confirm'); return; }
    if (INP[0].p.start) { G.state = 'title'; setSong('title'); showLobby('main'); return; }
  } else G.sel.p2 = NET.mode === 'host' && NET.connected;
  G.startLv = clamp(G.startLv, 0, G.unlock);
  const rows = G.unlock > 0 ? 2 : 1;
  if (G.selRow >= rows) G.selRow = 0;
  if (anyP('up')) { G.selRow = (G.selRow + rows - 1) % rows; sfx('select'); }
  if (anyP('down')) { G.selRow = (G.selRow + 1) % rows; sfx('select'); }
  const dl = anyP('left') ? -1 : anyP('right') ? 1 : 0;
  if (dl) {
    if (G.selRow === 0) G.diff = (G.diff + 3 + dl) % 3;
    else G.startLv = (G.startLv + G.unlock + 1 + dl) % (G.unlock + 1);
    sfx('select');
  }
  for (let i = 0; i < 2; i++) {
    if (i === 1 && !G.sel.p2) continue;
    const I = INP[i], L = G.looks[i];
    if (I.p.dash) { L.c = (L.c + 1) % PALS.length; sfx('select'); }
    if (I.p.sup) { L.h = (L.h + 1) % HELMETS.length; sfx('select'); }
    if ((I.p.dash || I.p.sup) && i === 0) save('look', G.looks[0]);
  }
  const go = confirmP(0) || INP[1].p.jump || INP[1].p.ok || (NET.mode === 'host' && INP[1].p.fire);
  if (go) startGame();
}
function updPlay(dt) {
  if (anyP('start')) { G.paused = !G.paused; G.menuIdx = 0; sfx('select'); }
  if (G.paused) {
    if (anyP('up') || anyP('down')) { G.menuIdx = 1 - G.menuIdx; sfx('select'); }
    if (anyConfirm()) { sfx('confirm'); if (G.menuIdx === 0) G.paused = false; else goSelect(); }
    return;
  }
  for (const p of G.players) if (!p.active && INP[p.id].p.fire && (NET.mode !== 'host' || p.id === 0 || NET.connected)) joinMid(p);
  G.stats.time += dt;
  if (G.slow > 0) { G.slow -= dt; dt *= 0.35; }
  if (G.bannerT > 0) G.bannerT -= dt;
  if (G.hintT > 0) G.hintT -= dt;
  for (const p of G.players) updatePlayer(p, INP[p.id], dt);
  updateRevive(dt);
  updateCamera(dt);
  if (!G.arena && !G.chase && !G.lock) { processSpawns(); updAmbient(dt); }
  if (G.chase) updChase(dt);
  if (G.lock) updLock(dt);
  if (G.lockMsgT > 0) G.lockMsgT -= dt;
  updEnemies(dt); updBoss(dt); updPBullets(dt); updEBullets(dt); updBeams(dt); updWarns(dt); updPickups(dt);
  if (G.state === 'play') checkTeam(dt);
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
}
function updClear(dt) {
  G.clearT += dt;
  if (G.clearT > 1.5 && anyConfirm()) {
    sfx('confirm');
    if (G.level < 2) setupPerks(); else { G.state = 'win'; G.clearT = 0; saveBest(); }
  }
}
function setupPerks() {
  const coop = G.players.filter(p => p.active).length > 1;
  G.perk = G.players.map(p => {
    if (!p.active) return null;
    const pool = PERKS.filter(k => (k.stack || !p.perks[k.id]) && (!k.coop || coop));
    const opts = []; while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
    return { opts, idx: 0, done: false };
  });
  G.state = 'perk';
}
function updPerk() {
  let all = true;
  G.perk.forEach((ps, i) => {
    if (!ps) return;
    if (!ps.done && i === 1 && NET.mode === 'host' && !NET.connected) { ps.done = true; applyPerk(G.players[i], ps.opts[0]); }
    if (!ps.done) {
      const I = INP[i];
      if (I.p.up || I.p.left) { ps.idx = (ps.idx + ps.opts.length - 1) % ps.opts.length; sfx('select'); }
      if (I.p.down || I.p.right) { ps.idx = (ps.idx + 1) % ps.opts.length; sfx('select'); }
      if (confirmP(i)) { ps.done = true; applyPerk(G.players[i], ps.opts[ps.idx]); sfx('confirm'); }
    }
    if (!ps.done) all = false;
  });
  if (all) { G.perkWait = (G.perkWait || 0) + STEP; if (G.perkWait > 0.6) { G.perkWait = 0; loadLevel(G.level + 1); G.state = 'play'; } }
}
function applyPerk(p, id) {
  p.perks[id] = (p.perks[id] || 0) + 1;
  if (id === 'armor') { p.maxHp++; p.hp = p.maxHp; }
}
function updOver() {
  if (anyP('up') || anyP('down')) { G.menuIdx = 1 - G.menuIdx; sfx('select'); }
  if (anyConfirm()) {
    sfx('confirm');
    if (G.menuIdx === 0) {
      G.lives = G.d.lives; G.score = 0;
      G.players.forEach(p => { p.out = false; p.downed = false; p.hp = p.maxHp; });
      loadLevel(G.level); G.state = 'play';
    } else goSelect();
  }
}
function updWin(dt) { G.clearT += dt; if (G.clearT > 2.5 && anyConfirm()) { sfx('confirm'); goSelect(); } }

// ───────────────────────── сеть (PeerJS) ─────────────────────────
const NET = { mode: 'local', peer: null, conn: null, connected: false, snapAcc: 0, lastRecv: 0, prevSnap: null, curSnap: null, curAt: 0, interval: 1 / 30, gcnt: {}, gprev: {}, code: '', seq: 0, hostAway: false, recon: null };
const REM = { held: {}, cnt: {}, last: {}, q: [], ack: 0 };
BTN.forEach(n => { NET.gcnt[n] = 0; REM.cnt[n] = 0; REM.last[n] = 0; });
const PEER_PREFIX = 'steelraid-v1-';
// Соединение: сначала напрямую (WebRTC через PeerJS, с запасным TURN-ретранслятором),
// а если напрямую не выходит — через публичный MQTT-ретранслятор по интернету.
const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const mqttLib = () => window.mqtt && (window.mqtt.connect ? window.mqtt : window.mqtt.default);
function netClose() {
  const c = NET.conn, p = NET.peer;
  NET.conn = null; NET.peer = null; NET.connected = false;
  try { c && c.close(); } catch (e) { }
  try { p && p.destroy(); } catch (e) { }
  for (const cl of (NET.relays || []).concat(NET.grelay || [])) { try { cl.end(true); } catch (e) { } }
  NET.relays = null; NET.grelay = null;
}
function peerOk() { return typeof window.Peer === 'function'; }
async function iceConfig() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  try {
    const user = (Math.floor(Date.now() / 1000) + 24 * 3600) + ':steelraid', enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('openrelayprojectsecret'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(user)));
    let bin = ''; for (const x of sig) bin += String.fromCharCode(x);
    servers.push({ urls: ['turn:staticauth.openrelay.metered.ca:80', 'turn:staticauth.openrelay.metered.ca:80?transport=tcp', 'turn:staticauth.openrelay.metered.ca:443', 'turns:staticauth.openrelay.metered.ca:443?transport=tcp'], username: user, credential: btoa(bin) });
  } catch (e) { }
  return { iceServers: servers };
}
const relayTopic = (code, dir) => 'steelraid/v2/' + code + '/' + dir;
const relayText = buf => typeof buf === 'string' ? buf : (buf && buf.toString && !(buf instanceof Uint8Array && buf.constructor === Uint8Array) ? buf.toString() : new TextDecoder().decode(buf));
function relayClient(url) {
  const M = mqttLib(); if (!M) return null;
  try { return M.connect(url, { clientId: 'sr' + Math.random().toString(16).slice(2, 10), clean: true, connectTimeout: 7000, reconnectPeriod: 2500, keepalive: 20 }); } catch (e) { return null; }
}
function makeRelayConn(client, pub) {
  const ls = {};
  const c = {
    relay: true, open: true, client,
    on(n, f) { (ls[n] = ls[n] || []).push(f); return c; },
    emit(n, a) { (ls[n] || []).slice().forEach(f => f(a)); },
    send(d) { if (c.open) { try { client.publish(pub, JSON.stringify(d), { qos: 0 }); } catch (e) { } } },
    close() { if (!c.open) return; c.open = false; try { client.publish(pub, '{"t":"bye"}', { qos: 0 }); } catch (e) { } c.emit('close'); },
  };
  return c;
}
async function hostGame() {
  if (!peerOk() && !mqttLib()) { setStatus('host', 'Не загрузились сетевые библиотеки. Обнови страницу.'); return; }
  netClose(); NET.mode = 'host'; NET.gen = (NET.gen || 0) + 1; const gen = NET.gen;
  const code = String(rint(1000, 9999)); NET.code = code;
  document.getElementById('host-code').textContent = code;
  setStatus('host', 'Подключаюсь к серверу…');
  startHostRelay(code, gen);
  if (!peerOk()) return;
  const config = await iceConfig(); if (NET.gen !== gen) return;
  const peer = new window.Peer(PEER_PREFIX + code, { debug: 0, config });
  NET.peer = peer;
  peer.on('open', () => { if (!NET.connected) setStatus('host', 'Ждём второго игрока…'); });
  peer.on('error', err => {
    if (NET.peer !== peer) return;
    if (err && err.type === 'unavailable-id') { hostGame(); return; }
    if (err && err.type === 'peer-unavailable') return;
    if (!NET.connected) setStatus('host', 'Основной сервер не отвечает, работает запасной канал. Можно подключаться.');
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
  peer.on('connection', conn => {
    if (!NET.connected) setStatus('host', 'Второй телефон нашёлся, соединяемся…');
    conn.on('open', () => hostAccept(conn));
  });
}
function startHostRelay(code, gen) {
  if (!mqttLib()) return;
  NET.relays = [];
  for (const url of RELAY_BROKERS) {
    const cl = relayClient(url); if (!cl) continue;
    NET.relays.push(cl);
    cl.on('connect', () => { try { cl.subscribe(relayTopic(code, 'g2h')); } catch (e) { } });
    cl.on('message', (topic, buf) => {
      if (NET.gen !== gen) return;
      let d; try { d = JSON.parse(relayText(buf)); } catch (e) { return; }
      if (d.t === 'join') {
        const cur = NET.conn;
        if (NET.connected && cur && !cur.relay) return;
        if (NET.connected && cur && cur.relay && cur.sid === d.sid) { if (cur.client === cl) cur.send({ t: 'welcome', sid: d.sid }); return; }
        if (NET.connected && cur && cur.relay) { cur.open = false; NET.connected = false; NET.conn = null; }
        const c = makeRelayConn(cl, relayTopic(code, 'h2g')); c.sid = d.sid; cl._rc = c;
        c.send({ t: 'welcome', sid: d.sid });
        hostAccept(c);
        return;
      }
      const c = cl._rc; if (!c || !c.open || NET.conn !== c) return;
      if (d.t === 'bye') { c.open = false; c.emit('close'); return; }
      c.emit('data', d);
    });
  }
}
function hostAccept(conn) {
  if (NET.conn && NET.connected && NET.conn !== conn) { try { conn.close(); } catch (e) { } return; }
  NET.conn = conn; NET.connected = true; NET.lastRecv = performance.now();
  BTN.forEach(n => { REM.cnt[n] = 0; REM.last[n] = 0; REM.held[n] = false; });
  REM.q = []; REM.ack = 0; G.awayGuest = false;
  try { conn.send({ t: 'hi', v: 2 }); } catch (e) { }
  showLobby(false); G.sel.p2 = true; sfx('confirm');
  if (G.state === 'title') goSelect();
  else if (G.state === 'play') {
    if (G.p2Wait) { G.p2Wait = false; joinMid(G.players[1]); }
    else if (!G.players[1].active) ftext(G.cam.x + W / 2, 90, 'ИСКРА НА СВЯЗИ — ЖМИ ОГОНЬ', '#ffd04a', 9);
  }
  conn.on('data', d => { if (NET.conn === conn) onHostData(d); });
  conn.on('close', () => { if (NET.conn === conn) hostLostGuest(); });
  conn.on('error', () => { if (NET.conn === conn) hostLostGuest(); });
}
function hostLostGuest() {
  if (!NET.connected && !NET.conn) return;
  const c = NET.conn; NET.connected = false; NET.conn = null;
  try { c && c.close(); } catch (e) { }
  const p = G.players[1];
  if (G.state === 'play' && p.active) { p.active = false; G.p2Wait = true; ftext(G.cam.x + W / 2, 90, 'ИСКРА ПОТЕРЯЛА СВЯЗЬ', '#ffd04a', 10); }
  G.sel.p2 = false; G.awayGuest = false;
  G.msg = 'Второй телефон отключился. Он вернётся сам или войдёт снова с тем же кодом.'; G.msgT = 6;
}
function onHostData(d) {
  if (!d || typeof d !== 'object') return;
  NET.lastRecv = performance.now();
  if (d.t === 'i') { REM.q.push(d); if (REM.q.length > 8) REM.q.splice(0, REM.q.length - 8); }
  else if (d.t === 'away') { G.awayGuest = true; if (G.state === 'play') G.paused = true; }
  else if (d.t === 'back') G.awayGuest = false;
  else if (d.t === 'look' && d.l) G.looks[1] = { c: clamp(d.l.c | 0, 0, PALS.length - 1), h: clamp(d.l.h | 0, 0, HELMETS.length - 1) };
}
function remoteIn() {
  if (REM.q.length > 3) REM.q.splice(0, REM.q.length - 2); // догоняем, если сообщения скопились
  const m = REM.q.shift();
  if (m) { BTN.forEach((n, i) => { REM.held[n] = !!(m.h & (1 << i)); REM.cnt[n] = (m.c && m.c[i]) | 0; }); REM.ack = m.s | 0; }
  const I = INP[1], c = {}, p = {};
  for (const n of BTN) { const cn = REM.cnt[n], ln = REM.last[n]; p[n] = cn !== ln && NET.connected; REM.last[n] = cn; c[n] = NET.connected && (!!REM.held[n] || p[n]); }
  I.c = c; I.p = p; I.prev = c;
}
async function joinGame(code, silent) {
  if (!peerOk() && !mqttLib()) { setStatus('join', 'Не загрузились сетевые библиотеки. Обнови страницу.'); return; }
  if (!/^\d{4}$/.test(code)) { setStatus('join', 'Нужен код из 4 цифр.'); return; }
  netClose(); NET.mode = 'guest'; NET.code = code; NET.gen = (NET.gen || 0) + 1; const gen = NET.gen;
  if (!silent) setStatus('join', 'Подключаюсь к серверу…');
  let opened = false, pendingRtc = null, notFoundT = null;
  const succeed = conn => {
    if (NET.gen !== gen || opened) { try { conn.close(); } catch (e) { } return; }
    opened = true; clearTimeout(to); clearTimeout(relayT); clearTimeout(notFoundT);
    NET.conn = conn; NET.connected = true; NET.lastRecv = performance.now(); NET.recon = null; NET.hostAway = false;
    NET.seq = 0; BTN.forEach(n => { NET.gcnt[n] = 0; }); NET.gprev = {}; PR.p = null; PR.hist.length = 0;
    showLobby(false); setStatus('join', '');
    conn.on('data', d => { if (NET.conn === conn) onGuestData(d); });
    conn.on('close', () => { if (NET.conn === conn) guestDrop(); });
    conn.on('error', () => { if (NET.conn === conn) guestDrop(); });
    if (conn.relay) { if (pendingRtc) { try { pendingRtc.close(); } catch (e) { } } (NET.grelay || []).forEach(cl => { if (cl !== conn.client) { try { cl.end(true); } catch (e) { } } }); NET.grelay = [conn.client]; }
    else { (NET.grelay || []).forEach(cl => { try { cl.end(true); } catch (e) { } }); NET.grelay = null; }
    try { conn.send({ t: 'look', l: load('look', null) || { c: 1, h: 0 } }); } catch (e) { }
  };
  const fail = msg => { if (NET.mode !== 'guest' || NET.recon || NET.gen !== gen || opened) return; setStatus('join', msg); netClose(); NET.mode = 'local'; };
  const to = setTimeout(() => fail('Не получилось соединиться. Проверь код и интернет на обоих телефонах. Первый телефон должен оставаться на экране с кодом.'), 30000);
  const relayT = setTimeout(() => { if (!opened && NET.gen === gen) { if (!silent) setStatus('join', 'Напрямую не выходит, подключаюсь через ретранслятор…'); startGuestRelay(code, gen, succeed); } }, silent ? 800 : 7000);
  if (!peerOk()) { startGuestRelay(code, gen, succeed); return; }
  const config = await iceConfig(); if (NET.gen !== gen) return;
  const peer = new window.Peer({ debug: 0, config }); NET.peer = peer;
  peer.on('open', () => {
    if (NET.gen !== gen || opened) return;
    if (!silent) setStatus('join', 'Сервер найден, соединяюсь с первым телефоном…');
    const conn = peer.connect(PEER_PREFIX + code, { serialization: 'json', reliable: false });
    pendingRtc = conn;
    conn.on('open', () => succeed(conn));
  });
  peer.on('error', err => {
    if (NET.gen !== gen || opened) return;
    startGuestRelay(code, gen, succeed);
    if (err && err.type === 'peer-unavailable' && !notFoundT) {
      if (!silent) setStatus('join', 'Ищу игру через ретранслятор…');
      notFoundT = setTimeout(() => fail('Игра с кодом ' + code + ' не найдена. Проверь цифры и что первый телефон на экране с кодом.'), 9000);
    }
  });
}
function startGuestRelay(code, gen, succeed) {
  if (!mqttLib() || NET.grelay) return;
  const sid = Math.random().toString(36).slice(2, 8);
  NET.grelay = [];
  for (const url of RELAY_BROKERS) {
    const cl = relayClient(url); if (!cl) continue;
    NET.grelay.push(cl);
    let c = null;
    const join = () => { try { cl.publish(relayTopic(code, 'g2h'), JSON.stringify({ t: 'join', sid }), { qos: 0 }); } catch (e) { } };
    cl.on('connect', () => { try { cl.subscribe(relayTopic(code, 'h2g'), () => join()); } catch (e) { } });
    const iv = setInterval(() => { if (c || NET.gen !== gen) { clearInterval(iv); return; } if (cl.connected) join(); }, 2000);
    cl.on('message', (topic, buf) => {
      let d; try { d = JSON.parse(relayText(buf)); } catch (e) { return; }
      if (!c) { if (d.t === 'welcome' && d.sid === sid && NET.gen === gen) { c = makeRelayConn(cl, relayTopic(code, 'g2h')); c.sid = sid; succeed(c); } return; }
      if (NET.conn !== c) return;
      if (d.t === 'bye') { c.open = false; c.emit('close'); return; }
      c.emit('data', d);
    });
  }
}
// связь оборвалась посреди игры: пробуем вернуться сами в течение минуты
function guestDrop() {
  if (NET.mode !== 'guest' || NET.recon) return;
  if (!NET.connected) return;
  NET.connected = false;
  NET.recon = { until: performance.now() + 60000, next: performance.now() + 800 };
}
function reconTick() {
  const R = NET.recon; if (!R) return;
  const now = performance.now();
  if (now > R.until) { NET.recon = null; guestLost('Связь с первым телефоном потеряна.'); return; }
  if (now >= R.next) { R.next = now + 6000; joinGame(NET.code, true); }
}
function guestLost(msg) {
  if (NET.mode !== 'guest') return;
  NET.recon = null; netClose(); NET.mode = 'local'; V = G; G.state = 'title'; setSong('title');
  PR.p = null; PR.hist.length = 0; NET.curSnap = NET.prevSnap = null;
  showLobby('join'); setStatus('join', msg);
}
function guestSendInput() {
  if (!NET.conn || !NET.connected) return null;
  const s = localState(0); const edges = {}; let h = 0;
  BTN.forEach((n, i) => { if (s[n]) h |= (1 << i); edges[n] = !!s[n] && !NET.gprev[n]; if (edges[n]) NET.gcnt[n]++; });
  NET.gprev = s; NET.seq++;
  try { NET.conn.send({ t: 'i', h, c: BTN.map(n => NET.gcnt[n]), s: NET.seq }); } catch (e) { }
  return { seq: NET.seq, c: s, p: edges };
}
// предсказание: второй телефон сразу двигает своего бойца и сверяется с хостом по номерам ввода
const PR = { p: null, hist: [], off: { x: 0, y: 0 } };
function predictStep(p, I, dt) { PRED = true; try { updatePlayer(p, I, dt); } finally { PRED = false; } }
function canPredict(v) { const hp = v && v.players && v.players.find(q => q.id === 1); return !!(v && v.state === 'play' && !v.paused && hp && hp.active && !hp.out && !hp.downed && !(hp.respawnT > 0)); }
function predFromSnap(hp) {
  const p = makePlayer(1, hp.maxHp);
  for (const k of NF.p) if (k in hp && k !== 'st' && k !== 'tot') p[k] = hp[k];
  p.perks.dbl = hp.pdbl | 0; p.perks.ghost = hp.pgh | 0; p.crouch = !!hp.crouch; p.onGround = !!hp.onGround; p.bike = !!hp.bike; p.dashHit = new Set();
  return p;
}
function guestPrepWorld(v) { G.lv = getLevel(v.level); G.cam.x = v.cam.x; G.arenaRight = v.arenaRight || 0; G.chase = !!v.chase; G.chaseV = v.chaseV || 125; G.paused = false; }
function reconcile(v, ack) {
  if (!canPredict(v)) { PR.p = null; PR.hist.length = 0; PR.off.x = PR.off.y = 0; return; }
  const hp = v.players.find(q => q.id === 1);
  const old = PR.p ? { x: PR.p.x, y: PR.p.y } : null;
  guestPrepWorld(v);
  const np = predFromSnap(hp);
  while (PR.hist.length && PR.hist[0].seq <= ack) PR.hist.shift();
  if (PR.hist.length > 40) PR.hist.splice(0, PR.hist.length - 40);
  for (const h of PR.hist) predictStep(np, h, STEP);
  if (old) { PR.off.x += old.x - np.x; PR.off.y += old.y - np.y; if (Math.hypot(PR.off.x, PR.off.y) > 48) { PR.off.x = 0; PR.off.y = 0; } }
  PR.p = np;
}
function guestStep(dt) {
  const s = guestSendInput();
  if (s && PR.p && canPredict(NET.curSnap)) { PR.hist.push(s); predictStep(PR.p, s, dt); }
  const k = Math.exp(-dt * 10); PR.off.x *= k; PR.off.y *= k;
  const limit = NET.hostAway ? 300000 : 8000;
  if (NET.connected && performance.now() - NET.lastRecv > limit) guestDrop();
  reconTick();
}
// упаковка снимка
const NF = {
  p: ['id', 'active', 'out', 'x', 'y', 'w', 'h', 'vx', 'vy', 'facing', 'ax', 'ay', 'crouch', 'downed', 'downT', 'revive', 'hp', 'maxHp', 'weapon', 'wlvl', 'meter', 'overT', 'invT', 'respawnT', 'dashT', 'onGround', 'animT', 'kills',
    'bike', 'st', 'tot', 'dashDir', 'dashCd', 'jumps', 'coyote', 'jbuf', 'dropT', 'fireCd', 'pdbl', 'pgh'],
  e: ['nid', 'type', 'x', 'y', 'w', 'h', 'vx', 'facing', 'flash', 'aim', 't', 'stopT', 'onGround', 'diving', 'mini', 'hp', 'maxHp', 'mode', 'label', 'legT', 'arm'],
  b: ['nid', 'type', 'x', 'y', 'vx', 'vy', 'r', 'life'],
  eb: ['nid', 'kind', 'x', 'y', 'vx', 'vy', 'r', 'hw', 'hh'],
  pk: ['nid', 'kind', 'x', 'y', 't'],
  bm: ['kind', 'y', 'x1', 'x2', 'hh', 'ox', 'oy', 'tx', 'ty', 'warn', 'fire', 'hint'],
  wn: ['x', 't'],
  bo: ['kind', 'name', 'x', 'y', 'w', 'h', 'vx', 'gy', 'face', 'state', 'sub', 'phase', 't', 'legT', 'rot', 'rise', 'dead', 'deathT', 'ready', 'st'],
  pt: ['id', 'ox', 'oy', 'w', 'h', 'hp', 'max', 'alive', 'flash', 'core'],
};
const q2 = v => typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v === 'boolean' ? (v ? 1 : 0) : (v === undefined ? null : v);
const pack = (list, f) => list.map(o => f.map(k => q2(o[k])));
const unpack = (arr, f) => (arr || []).map(a => { const o = {}; f.forEach((k, i) => o[k] = a[i]); return o; });
function makeSnap() {
  const s = {
    t: 's', st: G.state, tm: q2(G.t), lv: G.level, df: G.diff, li: G.lives, sc: G.score, be: G.best, co: G.combo, pa: G.paused ? 1 : 0, mi: G.menuIdx,
    bn: q2(G.bannerT), bi: q2(G.bossIntroT), hi: q2(G.hintT), cx: q2(G.cam.x), ar: G.arena ? 1 : 0, arr: q2(G.arenaRight), so: G.song, p2: G.sel.p2 ? 1 : 0,
    ct: q2(G.clearT), sk: G.stats.kills, stt: q2(G.stats.time), pk: G.perk, wt: q2(G.wipeT),
    lk: G.lock ? { k: G.lock.kind, w: G.lock.wave } : null, lm: G.lockMsg, lmt: q2(G.lockMsgT), ch: G.chase ? 1 : 0, cv: G.chaseV,
    lo: G.looks, sr: G.selRow, sl: G.startLv, un: G.unlock, ah: G.awayHost ? 1 : 0, ag: G.awayGuest ? 1 : 0, ak: REM.ack,
    P: pack(G.players.map(p => Object.assign({}, p, { pdbl: p.perks.dbl, pgh: p.perks.ghost })), NF.p), E: pack(G.enemies, NF.e), B: pack(G.pbullets, NF.b), EB: pack(G.ebullets, NF.eb),
    K: pack(G.pickups, NF.pk), BM: pack(G.beams, NF.bm), WN: pack(G.warns, NF.wn),
    BO: G.boss ? { o: NF.bo.map(k => q2(G.boss[k])), p: pack(G.boss.parts, NF.pt) } : null,
    ev: netEvents,
  };
  netEvents = [];
  return s;
}
function sendSnap() {
  if (!NET.conn || !NET.connected) { netEvents = []; return; }
  try { NET.conn.send(makeSnap()); } catch (e) { netEvents = []; }
}
function onGuestData(d) {
  if (!d || typeof d !== 'object') return;
  NET.lastRecv = performance.now();
  if (d.t === 'away') { NET.hostAway = true; return; }
  if (d.t === 'back') { NET.hostAway = false; return; }
  if (d.t !== 's') return;
  const now = performance.now();
  if (NET.curSnap) { const dtt = (now - NET.curAt) / 1000; NET.interval = clamp(NET.interval * 0.8 + dtt * 0.2, 1 / 60, 0.2); }
  NET.prevSnap = NET.curSnap; NET.curSnap = decodeSnap(d); NET.curAt = now;
  NET.hostAway = !!d.ah;
  if (d.ev) for (const ev of d.ev) runEvent(ev);
  playSong(d.so);
  if (d.lo && d.lo[1]) { const mine = load('look', null); if (!mine || mine.c !== d.lo[1].c || mine.h !== d.lo[1].h) save('look', d.lo[1]); }
  reconcile(NET.curSnap, d.ak | 0);
}
function decodeSnap(d) {
  const v = {
    state: d.st, t: d.tm, level: d.lv, diff: d.df, lives: d.li, score: d.sc, best: d.be, combo: d.co, paused: !!d.pa, menuIdx: d.mi,
    bannerT: d.bn, bossIntroT: d.bi, hintT: d.hi, cam: { x: d.cx }, arena: !!d.ar, arenaRight: d.arr, song: d.so, sel: { p2: !!d.p2 },
    clearT: d.ct, stats: { kills: d.sk, time: d.stt }, perk: d.pk, wipeT: d.wt, lv: getLevel(d.lv), d: DIFFS[d.df] || DIFFS[1],
    lock: d.lk ? { kind: d.lk.k, wave: d.lk.w } : null, lockMsg: d.lm || '', lockMsgT: d.lmt || 0, chase: !!d.ch, chaseV: d.cv || 125,
    looks: d.lo || G.looks, selRow: d.sr | 0, startLv: d.sl | 0, unlock: d.un | 0, awayHost: !!d.ah, awayGuest: !!d.ag,
    players: unpack(d.P, NF.p), enemies: unpack(d.E, NF.e), pbullets: unpack(d.B, NF.b), ebullets: unpack(d.EB, NF.eb),
    pickups: unpack(d.K, NF.pk), beams: unpack(d.BM, NF.bm), warns: unpack(d.WN, NF.wn), boss: null, net: 'guest', msg: '', msgT: 0,
  };
  if (d.BO) { const b = {}; NF.bo.forEach((k, i) => b[k] = d.BO.o[i]); b.parts = unpack(d.BO.p, NF.pt); v.boss = b; }
  return v;
}
// у гостя: плавная картинка между двумя снимками и свой боец из предсказания
function guestView(now) {
  const cur = NET.curSnap; if (!cur) return null;
  const prev = NET.prevSnap;
  let v = cur;
  if (prev && prev.level === cur.level) {
    const a = clamp((now - NET.curAt) / 1000 / NET.interval, 0, 1);
    const ext = Math.min((now - NET.curAt) / 1000, 0.1);
    v = Object.assign({}, cur);
    const lerp = (p, c) => p + (c - p) * a;
    v.cam = { x: Math.abs(cur.cam.x - prev.cam.x) < 200 ? lerp(prev.cam.x, cur.cam.x) : cur.cam.x };
    v.t = lerp(prev.t, cur.t);
    const mix = (cl, pl) => {
      const m = new Map(); for (const o of pl) m.set(o.nid !== undefined ? o.nid : o.id, o);
      return cl.map(o => { const p = m.get(o.nid !== undefined ? o.nid : o.id); if (!p || Math.abs(p.x - o.x) > 80) return o; return Object.assign({}, o, { x: lerp(p.x, o.x), y: lerp(p.y, o.y) }); });
    };
    v.players = mix(cur.players, prev.players);
    v.enemies = mix(cur.enemies, prev.enemies);
    v.pickups = mix(cur.pickups, prev.pickups);
    v.pbullets = cur.pbullets.map(b => Object.assign({}, b, { x: b.x + b.vx * ext, y: b.y + b.vy * ext }));
    v.ebullets = cur.ebullets.map(b => Object.assign({}, b, { x: b.x + (b.vx || 0) * ext, y: b.y + (b.vy || 0) * ext }));
    if (cur.boss && prev.boss && cur.boss.kind === prev.boss.kind) v.boss = Object.assign({}, cur.boss, { x: lerp(prev.boss.x, cur.boss.x), y: lerp(prev.boss.y, cur.boss.y) });
  }
  if (PR.p && canPredict(cur)) {
    const q = PR.p;
    if (v === cur) v = Object.assign({}, cur);
    v.players = v.players.map(o => o.id !== 1 ? o : Object.assign({}, o, { x: q.x + PR.off.x, y: q.y + PR.off.y, vx: q.vx, vy: q.vy, facing: q.facing, ax: q.ax, ay: q.ay, crouch: q.crouch, h: q.h, onGround: q.onGround, animT: q.animT, dashT: q.dashT, bike: q.bike }));
  }
  return v;
}

// ───────────────────────── фоны ─────────────────────────
const BG = [];
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function buildBG(th) {
  const rng = mulberry(31 + th * 97);
  const sky = mkCanvas(W, H), sc = sky.getContext('2d');
  const layers = [];
  const grad = (stops) => { const g = sc.createLinearGradient(0, 0, 0, H); stops.forEach(([o, c]) => g.addColorStop(o, c)); sc.fillStyle = g; sc.fillRect(0, 0, W, H); };
  if (th === 0) {
    grad([[0, '#1d1030'], [0.42, '#5a2348'], [0.72, '#c4533a'], [1, '#f4a259']]);
    const sun = mkCanvas(110, 110), su = sun.getContext('2d');
    const g = su.createLinearGradient(0, 0, 0, 110); g.addColorStop(0, '#ffe08a'); g.addColorStop(1, '#ff6a3a');
    su.fillStyle = g; su.beginPath(); su.arc(55, 55, 50, 0, 6.283); su.fill();
    for (let i = 0; i < 7; i++) su.clearRect(0, 62 + i * 7, 110, 2 + i * 0.6);
    sc.drawImage(sun, 300, 70);
    const far = mkCanvas(960, 150), fc = far.getContext('2d'); fc.fillStyle = '#5a2648';
    for (let x = 0; x < 960;) { const w = 40 + rng() * 90, h = 30 + rng() * 60; fc.beginPath(); fc.moveTo(x, 150); fc.lineTo(x + 8, 150 - h); fc.lineTo(x + w - 8, 150 - h); fc.lineTo(x + w, 150); fc.fill(); x += w + rng() * 30; }
    layers.push({ c: far, sp: 0.1, y: 112 });
    const mid = mkCanvas(960, 140), mc = mid.getContext('2d'); mc.fillStyle = '#2f1530';
    for (let x = 0; x < 960;) {
      const w = 18 + rng() * 26, h = 40 + rng() * 80; mc.fillRect(x, 140 - h, w, h);
      for (let k = 0; k < 4; k++) mc.clearRect(x + rng() * (w - 4), 140 - h + rng() * 10, 4 + rng() * 6, 3 + rng() * 6);
      mc.fillStyle = '#41203f'; for (let yy = 140 - h + 8; yy < 136; yy += 9) mc.fillRect(x + 3, yy, 3, 3); mc.fillStyle = '#2f1530';
      if (rng() < 0.4) mc.fillRect(x + w / 2, 140 - h - 14, 1, 14);
      x += w + 10 + rng() * 40;
    }
    mc.fillStyle = '#24101f'; for (let x = 0; x < 960; x += 4) mc.fillRect(x, 130 + Math.sin(x * 0.02) * 4, 4, 20);
    layers.push({ c: mid, sp: 0.3, y: 136 });
  } else if (th === 1) {
    grad([[0, '#05061a'], [0.55, '#151040'], [1, '#3a1a5a']]);
    for (let i = 0; i < 70; i++) { sc.fillStyle = rng() < 0.2 ? '#ffd0f0' : '#c8d0ff'; sc.fillRect(rng() * W, rng() * 120, 1, 1); }
    sc.fillStyle = '#e8e6ff'; sc.beginPath(); sc.arc(90, 46, 16, 0, 6.283); sc.fill(); sc.fillStyle = '#151040'; sc.beginPath(); sc.arc(97, 42, 14, 0, 6.283); sc.fill();
    const far = mkCanvas(960, 210), fc = far.getContext('2d');
    for (let x = 0; x < 960;) {
      const w = 20 + rng() * 34, h = 70 + rng() * 130; fc.fillStyle = '#141533'; fc.fillRect(x, 210 - h, w, h);
      for (let yy = 210 - h + 5; yy < 205; yy += 5) for (let xx = x + 3; xx < x + w - 3; xx += 4) if (rng() < 0.18) { fc.fillStyle = pick(['#3ff0ff', '#ff3fb4', '#ffd04a', '#6a7aff']); fc.globalAlpha = 0.55; fc.fillRect(xx, yy, 2, 2); fc.globalAlpha = 1; }
      x += w + 2 + rng() * 10;
    }
    layers.push({ c: far, sp: 0.12, y: 60 });
    const mid = mkCanvas(960, 170), mc = mid.getContext('2d');
    for (let x = 0; x < 960;) {
      const w = 30 + rng() * 40, h = 50 + rng() * 90; mc.fillStyle = '#0c0d22'; mc.fillRect(x, 170 - h, w, h);
      if (rng() < 0.6) {
        const c = pick(['#3ff0ff', '#ff3fb4', '#ffd04a']), sy = 170 - h + 10 + rng() * 30, sw = 10 + rng() * (w - 14);
        mc.globalAlpha = 0.25; mc.fillStyle = c; mc.fillRect(x + 4, sy - 3, sw + 6, 12); mc.globalAlpha = 1; mc.fillRect(x + 7, sy, sw, 6);
        mc.fillStyle = '#0c0d22'; for (let k = 0; k < sw; k += 4) mc.fillRect(x + 7 + k, sy + 2, 2, 2);
      }
      x += w + 6 + rng() * 26;
    }
    layers.push({ c: mid, sp: 0.35, y: 100 });
  } else {
    grad([[0, '#0e0406'], [0.6, '#2a0a0e'], [1, '#5a1612']]);
    const far = mkCanvas(960, 220), fc = far.getContext('2d');
    for (let x = 0; x < 960;) {
      const w = 14 + rng() * 16, h = 90 + rng() * 110; fc.fillStyle = '#2a0e10'; fc.fillRect(x, 220 - h, w, h); fc.fillRect(x - 3, 220 - h, w + 6, 6);
      const g = fc.createRadialGradient(x + w / 2, 220 - h, 2, x + w / 2, 220 - h, 26); g.addColorStop(0, 'rgba(255,120,40,0.55)'); g.addColorStop(1, 'rgba(255,120,40,0)'); fc.fillStyle = g; fc.fillRect(x - 26, 220 - h - 26, w + 52, 52);
      x += w + 30 + rng() * 60;
    }
    fc.fillStyle = '#220a0c'; for (let x = 0; x < 960; x += 120 + rng() * 80) { const r = 20 + rng() * 22, y = 170 + rng() * 30; fc.beginPath(); fc.arc(x, y, r, 0, 6.283); fc.fill(); for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; fc.fillRect(x + Math.cos(a) * r - 3, y + Math.sin(a) * r - 3, 7, 7); } }
    layers.push({ c: far, sp: 0.1, y: 50 });
    const mid = mkCanvas(960, 180), mc = mid.getContext('2d');
    mc.fillStyle = '#1a0a0c';
    for (let y = 30; y < 170; y += 34 + rng() * 20) { mc.fillRect(0, y, 960, 7); for (let x = rng() * 80; x < 960; x += 60 + rng() * 90) { mc.fillRect(x - 2, y - 3, 11, 13); } }
    for (let x = 0; x < 960; x += 50 + rng() * 80) mc.fillRect(x, 0, 8, 180);
    mc.fillStyle = '#3a1416'; for (let x = 0; x < 960; x += 30 + rng() * 60) mc.fillRect(x, 20 + rng() * 140, 3, 3);
    layers.push({ c: mid, sp: 0.3, y: 90 });
  }
  return { sky, layers };
}
function drawBG(th, cx) {
  const b = BG[th] || (BG[th] = buildBG(th));
  ctx.drawImage(b.sky, 0, 0);
  for (const L of b.layers) {
    const w = L.c.width; let o = -((cx * L.sp) % w); if (o > 0) o -= w;
    ctx.drawImage(L.c, Math.round(o), L.y); ctx.drawImage(L.c, Math.round(o + w), L.y);
  }
  const tm = V.t || 0;
  if (th === 0) { ctx.fillStyle = 'rgba(255,200,150,0.35)'; for (const a of FXS.amb.slice(0, 40)) { const x = ((a.x - cx * 0.6 * a.s - tm * 14 * a.s) % W + W) % W, y = (a.y + Math.sin(tm + a.p) * 6) % H; ctx.fillRect(x, y, 1, 1); } }
  if (th === 1) { ctx.fillStyle = 'rgba(160,200,255,0.32)'; for (const a of FXS.amb) { const y = ((a.y + tm * 260 * a.s) % (H + 20)) - 10, x = ((a.x - cx * 0.5 - y * 0.25) % W + W) % W; ctx.fillRect(x, y, 1, 6); } }
  if (th === 2) { for (const a of FXS.amb.slice(0, 45)) { const y = ((a.y - tm * 30 * a.s) % H + H) % H, x = ((a.x - cx * 0.4 + Math.sin(tm * 2 + a.p) * 8) % W + W) % W; ctx.fillStyle = a.s > 0.7 ? '#ffb04a' : '#ff6a2a'; ctx.fillRect(x, y, 1, 1); } }
}

// ───────────────────────── отрисовка мира ─────────────────────────
const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
function drawTiles() {
  const L = V.lv, th = THEMES[L.n];
  const c0 = Math.max(0, Math.floor(V.cam.x / T) - 1), c1 = Math.min(L.total, c0 + Math.ceil(W / T) + 3);
  for (let c = c0; c < c1; c++) for (let r = 0; r < L.rows; r++) {
    const t = L.tiles[r][c]; if (!t) continue;
    const x = c * T, y = r * T, h = hash(c, r);
    if (t === 1) {
      const top = r === 0 || !isSolid(L.tiles[r - 1][c]);
      R(x, y, T, T, th.base);
      R(x, y + T - 1, T, 1, th.dark); R(x + (r % 2 ? 4 : 11), y, 1, T, th.dark);
      if (h < 0.35) R(x + 2 + ((h * 100) | 0) % 10, y + 4 + ((h * 1000) | 0) % 8, 3, 2, th.mid);
      if (top) {
        R(x, y, T, 4, th.top); R(x, y, T, 1, th.top2);
        if (L.n === 0 && h > 0.6) { R(x + ((h * 50) | 0) % 12, y - 2, 2, 2, th.top); R(x + ((h * 70) | 0) % 13, y - 1, 1, 1, th.top2); }
        if (L.n === 1) { R(x, y + 4, T, 1, th.glow); }
        if (L.n === 2) { for (let k = 0; k < T; k += 4) R(x + k, y + 1, 2, 2, (c + k / 4) % 2 ? th.hazard : th.dark); }
        if (L.zones && L.zones.chase && x >= L.zones.chase.x0 && x < L.zones.chase.x1) { R(x, y + 4, T, 3, '#3a2a28'); if (c % 2) R(x + 2, y + 5, 10, 1, '#f0e0b0'); }
      }
      if (c > 0 && L.tiles[r][c - 1] === 0) R(x, y, 1, T, th.top2 + '66');
    } else if (t === 3) {
      R(x, y, T, T, th.crateD); R(x + 1, y + 1, T - 2, T - 2, th.crate); R(x + 2, y + 2, T - 4, T - 4, th.crateD);
      R(x + 3, y + 3, T - 6, T - 6, th.crate);
      for (let k = 0; k < 10; k++) { R(x + 3 + k, y + 3 + k, 1, 1, th.crateD); R(x + 12 - k, y + 3 + k, 1, 1, th.crateD); }
    } else if (t === 2) {
      R(x, y, T, 4, th.plat); R(x, y, T, 1, th.top2); R(x, y + 4, T, 1, th.platD);
      for (let k = 0; k < 4; k++) { R(x + k * 4, y + 5 + (k % 2) * 2, 2, 2, th.platD); }
    }
  }
}
function drawPlayer(p, isMe) {
  if (!p.active || p.out || p.respawnT > 0) return;
  const tm = V.t || 0;
  if (p.invT > 0 && !p.downed && Math.floor(tm * 24) % 2 === 0) return;
  const P = palOf(p.id), f = p.facing;
  const x = Math.round(p.x), y = Math.round(p.y);
  if (p.overT > 0) { ctx.globalAlpha = 0.25 + 0.15 * Math.sin(tm * 30); R(x - 3, y - 3, p.w + 6, p.h + 6, P.scarf); ctx.globalAlpha = 1; }
  if (p.downed) {
    const by = y + p.h;
    R(x - 5, by - 5, 18, 5, P.suit); R(x - 3, by - 6, 9, 3, P.armor);
    R(x + (f > 0 ? 9 : -9), by - 7, 7, 6, P.armor); R(x + (f > 0 ? 12 : -9), by - 5, 3, 2, P.visor);
    R(x + 13, by - 2, 6, 2, P.gun);
    return;
  }
  const sw = Math.sin(tm * 14) * 1.5;
  if (p.crouch) {
    R(x + (f > 0 ? -5 : p.w + 1), y + 2 + sw * 0.4, 4, 2, P.scarf);
    R(x + 1, y + 4, 8, 5, P.suit); R(x + 2, y + 5, 6, 3, P.armor);
    R(x, y + 9, 10, 3, P.suit); R(x + (f > 0 ? 7 : 0), y + 10, 3, 2, P.armorD);
    R(x + 1, y - 2, 8, 6, P.armor); R(x + 1, y + 2, 8, 2, P.armorD); R(x + (f > 0 ? 4 : 1), y, 5, 2, P.visor);
    drawHelmet(p, x, y - 2, P, f);
    drawGun(p, x + 5, y + 5, P);
  } else {
    R(x + (f > 0 ? -4 : p.w), y + 7 + sw * 0.5, 4, 2, P.scarf); R(x + (f > 0 ? -7 : p.w + 3), y + 8 + sw, 3, 2, P.scarf);
    if (p.bike) { R(x + 2, y + 15, 7, 4, P.suit); }
    else if (!p.onGround) { R(x + 1, y + 15, 4, 5, P.suit); R(x + 5, y + 14, 4, 5, P.suit); R(x + 1, y + 19, 4, 2, P.armorD); R(x + 5, y + 18, 4, 2, P.armorD); }
    else if (Math.abs(p.vx) > 12) {
      const fr = Math.floor(p.animT * 12) % 4, o = [0, 2, 0, -2][fr];
      R(x + 3 + o, y + 15, 3, 5, P.suit); R(x + 4 - o, y + 15, 3, 5, P.suit); R(x + 2 + o, y + 20, 4, 2, P.armorD); R(x + 4 - o, y + 20, 4, 2, P.armorD);
    } else { R(x + 1, y + 15, 3, 5, P.suit); R(x + 6, y + 15, 3, 5, P.suit); R(x + 1, y + 20, 3, 2, P.armorD); R(x + 6, y + 20, 3, 2, P.armorD); }
    R(x + 1, y + 7, 8, 8, P.suit); R(x + 2, y + 8, 6, 4, P.armor); R(x + 1, y + 14, 8, 1, P.armorD);
    R(x + 1, y, 8, 7, P.armor); R(x + 1, y + 5, 8, 2, P.armorD); R(x + (f > 0 ? 4 : 1), y + 2, 5, 2, P.visor);
    drawHelmet(p, x, y, P, f);
    drawGun(p, x + 5, y + 10, P);
    if (p.bike) drawBike(x, y + p.h, f, P, tm);
  }
  if (p.dashT > 0) { ctx.globalAlpha = 0.5; R(x - f * 6, y + 4, 6, p.h - 6, P.scarf); ctx.globalAlpha = 1; }
  if (isMe && V.net !== 'local' && NET.mode !== 'local') { const ay2 = y - (p.crouch ? 9 : 7) - Math.abs(Math.sin(tm * 4)) * 2; R(x + 3, ay2, 4, 1, P.scarf); R(x + 4, ay2 + 1, 2, 1, P.scarf); }
}
function drawHelmet(p, x, y, P, f) {
  const L = (V.looks || G.looks || [])[p.id]; const h = L ? L.h : 0;
  if (h === 1) { R(x + 3, y - 3, 4, 3, P.scarf); R(x + 4, y - 4, 2, 1, P.scarf); }
  else if (h === 2) { R(x, y - 3, 2, 4, P.armorD); R(x + 8, y - 3, 2, 4, P.armorD); R(x, y - 4, 1, 1, P.armorD); R(x + 9, y - 4, 1, 1, P.armorD); }
  else R(x + (f > 0 ? 2 : 7), y - 2, 1, 2, P.armorD);
}
function drawBike(x, by, f, P, tm) {
  const fl = Math.floor(tm * 24) % 2;
  R(x - 8, by - 8, 26, 5, '#3a4258'); R(x - 6, by - 9, 20, 2, '#5a6480'); R(x - 8, by - 4, 26, 1, '#222838');
  R(f > 0 ? x + 16 : x - 10, by - 7, 4, 3, '#ffe9a0');
  R(x - 2, by - 10, 6, 2, P.armorD);
  ctx.globalAlpha = 0.55; R(x - 6, by - 2, 22, 2, fl ? '#7ff0ff' : '#3fb6ff'); ctx.globalAlpha = 1;
  R(f > 0 ? x - 12 : x + 18, by - 7, 4, 3, fl ? '#ffd04a' : '#ff6a2a'); R(f > 0 ? x - 15 : x + 22, by - 6, 3, 1, '#ff6a2a');
}
function drawGun(p, sx, sy, P) {
  for (let i = 1; i <= 8; i++) { ctx.fillStyle = i > 6 ? '#e8eef8' : P.gun; ctx.fillRect(Math.round(sx + p.ax * i) - 1, Math.round(sy + p.ay * i) - 1, 2, 2); }
}
const EC = { metal: '#5b6170', dark: '#2d313b', light: '#9aa1b2', eye: '#ff3b3b', glow: '#ff9a3b', red: '#a8323a' };
function drawEnemy(e) {
  const x = Math.round(e.x), y = Math.round(e.y), f = e.facing, tm = V.t || 0;
  const fl = e.flash > 0;
  const C = c => fl ? '#ffffff' : c;
  switch (e.type) {
    case 'runner': {
      const fr = Math.floor((e.t || 0) * 10) % 4, o = e.stopT > 0 || !e.onGround ? 0 : [0, 2, 0, -2][fr];
      R(x + 2 + o, y + 13, 3, 7, C(EC.dark)); R(x + 5 - o, y + 13, 3, 7, C(EC.dark));
      R(x + 1, y + 6, 8, 8, C(EC.red)); R(x + 2, y + 7, 6, 3, C('#c8484f'));
      R(x + 1, y, 8, 7, C(EC.metal)); R(x + (f > 0 ? 5 : 1), y + 2, 4, 2, C(EC.eye));
      R(x + (f > 0 ? 6 : -4), y + 8, 8, 2, C(EC.dark));
      if (e.stopT > 0 && e.stopT < 0.3) R(x + (f > 0 ? 13 : -6), y + 7, 3, 3, '#ffe066');
      break;
    }
    case 'turret': {
      R(x, y + 6, 14, 6, C(EC.dark)); R(x + 2, y + 2, 10, 6, C(EC.metal)); R(x + 4, y, 6, 3, C(EC.light));
      for (let i = 2; i <= 11; i++) R(Math.round(x + 7 + Math.cos(e.aim) * i) - 1, Math.round(y + 4 + Math.sin(e.aim) * i) - 1, 2, 2, C(i > 9 ? EC.glow : EC.dark));
      R(x + 6, y + 3, 2, 2, C(Math.floor(tm * 4) % 2 ? EC.eye : '#5a1a1a'));
      break;
    }
    case 'drone': {
      const pr = Math.floor(tm * 30) % 2;
      R(x - 2 + pr * 2, y - 2, 8, 1, C('#cfd6e4')); R(x + 8 - pr * 2, y - 2, 8, 1, C('#cfd6e4'));
      R(x + 3, y - 1, 2, 2, C(EC.dark)); R(x + 9, y - 1, 2, 2, C(EC.dark));
      R(x, y + 1, 14, 6, C(EC.metal)); R(x + 2, y + 7, 10, 3, C(EC.dark)); R(x + 5, y + 3, 4, 3, C(EC.eye));
      break;
    }
    case 'leaper': {
      const k = e.onGround ? 0 : 2;
      R(x + 3, y + 2, 8, 6, C(EC.metal)); R(x + 5, y + 3, 4, 2, C(EC.eye));
      R(x, y + 6 - k, 3, 2, C(EC.dark)); R(x - 1, y + 8 - k, 2, 2, C(EC.dark)); R(x + 11, y + 6 - k, 3, 2, C(EC.dark)); R(x + 13, y + 8 - k, 2, 2, C(EC.dark));
      R(x + 2, y + 8, 2, 2, C(EC.dark)); R(x + 10, y + 8, 2, 2, C(EC.dark));
      break;
    }
    case 'heavy': {
      const fr = Math.floor((e.t || 0) * 5) % 2;
      R(x + 3, y + 18, 5, 8, C(EC.dark)); R(x + 10, y + 18 - fr, 5, 8 + fr, C(EC.dark));
      R(x + 1, y + 6, 16, 13, C('#6b4a3a')); R(x + 3, y + 8, 12, 4, C('#8a6248'));
      R(x + 3, y, 12, 7, C(EC.metal)); R(x + (f > 0 ? 9 : 3), y + 3, 6, 1, C(EC.eye));
      R(x + (f > 0 ? 15 : -3), y + 4, 6, 18, C('#b9c2d4')); R(x + (f > 0 ? 16 : -2), y + 5, 4, 16, C('#7c8598'));
      break;
    }
    case 'carrier': {
      R(x + 2, y + 3, 14, 7, C('#c9cfda')); R(x + 4, y + 4, 10, 5, C('#e9edf4'));
      const wf = Math.sin(tm * 18) > 0 ? 0 : 2; R(x - 2, y + 1 + wf, 6, 2, C(EC.light)); R(x + 14, y + 1 + wf, 6, 2, C(EC.light));
      R(x + 7, y + 5, 4, 3, C('#ffd04a'));
      break;
    }
    case 'missile': {
      const a = e.aim || 0;
      for (let i = 0; i < 6; i++) R(Math.round(x + 4 - Math.cos(a) * i), Math.round(y + 4 - Math.sin(a) * i), 2, 2, i < 2 ? C('#e8eef8') : C(EC.metal));
      R(Math.round(x + 4 - Math.cos(a) * 8), Math.round(y + 4 - Math.sin(a) * 8), 3, 3, Math.floor(tm * 30) % 2 ? '#ffd04a' : '#ff6a2a');
      break;
    }
    case 'sniper': {
      R(x + 2, y + 13, 3, 7, C(EC.dark)); R(x + 5, y + 13, 3, 7, C(EC.dark));
      R(x + 1, y + 6, 8, 8, C('#3d5a3a')); R(x + 1, y, 8, 7, C('#2c4230')); R(x + (f > 0 ? 5 : 1), y + 3, 4, 1, C(EC.eye));
      const a = e.aim || (f > 0 ? 0 : Math.PI);
      for (let i = 0; i < 13; i++) R(Math.round(x + 5 + Math.cos(a) * i), Math.round(y + 8 + Math.sin(a) * i), 2, 1, C(i > 10 ? '#9aa1b2' : EC.dark));
      if (e.stopT > 0) {
        const bright = e.stopT < 0.35;
        ctx.strokeStyle = bright ? (Math.floor(tm * 30) % 2 ? '#ffffff' : '#ff3b3b') : 'rgba(255,60,60,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 5 + Math.cos(a) * 13, y + 8 + Math.sin(a) * 13); ctx.lineTo(x + 5 + Math.cos(a) * 340, y + 8 + Math.sin(a) * 340); ctx.stroke();
      }
      break;
    }
    case 'shield': {
      const fr = Math.floor((e.t || 0) * 8) % 2;
      R(x + 3, y + 15, 3, 7 - fr, C(EC.dark)); R(x + 7, y + 15 + fr, 3, 7 - fr, C(EC.dark));
      R(x + 2, y + 6, 8, 10, C('#4a5468')); R(x + 2, y, 8, 7, C(EC.metal)); R(x + (f > 0 ? 6 : 2), y + 3, 4, 1, C(EC.eye));
      const sx = f > 0 ? x + 9 : x - 3, low = e.stopT > 0 ? 10 : 0;
      R(sx, y + 1 + low, 6, 21 - low, C('#7c8598')); R(sx + 1, y + 2 + low, 4, 19 - low, C(low ? '#8a93a6' : '#c9d2e4'));
      if (!low) R(sx + 2, y + 5, 2, 3, C('#3a4258'));
      break;
    }
    case 'kamikaze': {
      const lit = e.arm > 0 ? Math.floor(tm * 24) % 2 : Math.floor(tm * 4) % 2;
      R(x + 1, y + 1, 10, 7, C('#3a3036')); R(x + 3, y, 6, 2, C('#55474c')); R(x + 2, y + 4, 8, 1, C('#ffc23a'));
      R(x + 5, y - 2, 2, 2, lit ? '#ff3b3b' : '#5a1a1a');
      R(x + 1, y + 8, 3, 2, C(EC.dark)); R(x + 8, y + 8, 3, 2, C(EC.dark));
      if (e.arm > 0) { ctx.globalAlpha = 0.35; R(x - 3, y - 3, 18, 16, '#ff3b3b'); ctx.globalAlpha = 1; }
      break;
    }
    case 'bomber': {
      R(x, y + 3, 26, 5, C('#4a4f5e')); R(x + 2, y + 2, 6, 2, C('#7aa8d8')); R(x + 8, y, 10, 2, C('#6a7080'));
      R(x + 24, y + 4, 3, 3, Math.floor(tm * 20) % 2 ? '#ffb43a' : '#ff6a2a'); R(x + 11, y + 8, 4, 2, C(EC.dark));
      break;
    }
    case 'biker': {
      const fl = Math.floor(tm * 24) % 2;
      R(x, y + 12, 22, 5, C('#5a2030')); R(x + 2, y + 11, 16, 2, C('#7a3040'));
      R(f > 0 ? x + 20 : x - 2, y + 12, 3, 3, '#ffe9a0');
      ctx.globalAlpha = 0.5; R(x + 2, y + 17, 18, 1, fl ? '#ff6a6a' : '#ff3b3b'); ctx.globalAlpha = 1;
      R(x + 7, y + 3, 8, 9, C(EC.red)); R(x + 8, y - 2, 7, 6, C(EC.metal)); R(x + (f > 0 ? 12 : 8), y, 3, 2, C(EC.eye));
      R(f > 0 ? x + 14 : x, y + 6, 8, 2, C(EC.dark));
      break;
    }
    case 'barrier': {
      R(x, y, 12, 18, C('#ffc23a'));
      for (let k = 0; k < 3; k++) R(x, y + 2 + k * 6, 12, 3, C('#1a1a1a'));
      R(x - 1, y + 16, 14, 2, C('#55474c'));
      break;
    }
    case 'spider': {
      const lt = e.legT || 0;
      for (let i = 0; i < 4; i++) {
        const lx = x + 4 + i * 11, o = Math.round(Math.sin(lt + i * 1.6) * 2);
        R(lx - 2, y + 12 + o, 3, 6, C(EC.dark)); R(lx - 4, y + 18 + o, 3, 10 - o, C('#3a3f4c'));
      }
      R(x + 4, y + 6, 36, 12, C('#4a3a5e')); R(x + 10, y + 1, 24, 7, C('#6a5a80')); R(x + 12, y, 20, 2, C('#8a7aa0'));
      const ex = f > 0 ? x + 28 : x + 8;
      for (let k = 0; k < 3; k++) R(ex + k * 3, y + 9, 2, 2, C(EC.eye));
      R(f > 0 ? x + 38 : x - 4, y + 12, 10, 3, C(EC.dark));
      if (e.hp < e.maxHp / 2 && Math.floor(tm * 6) % 2) R(x + 18, y + 4, 2, 2, '#ff6a3a');
      break;
    }
  }
}
function drawPickup(k) {
  if (k.t > 11 && Math.floor((V.t || 0) * 10) % 2) return;
  const x = Math.round(k.x), y = Math.round(k.y + Math.sin((V.t || 0) * 5 + (k.nid || 0)) * 1.5), c = WCOL[k.kind];
  R(x, y + 2, 12, 8, '#1a1a24'); R(x + 1, y + 1, 10, 10, c); R(x + 2, y + 2, 8, 8, '#1a1a24');
  R(x + 1, y + 1, 10, 1, '#ffffff'); R(x - 2, y + 4, 2, 4, c); R(x + 12, y + 4, 2, 4, c);
}
function drawPBullet(b) {
  const c = WCOL[b.type];
  switch (b.type) {
    case 'L': {
      const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(b.x - ux * 22, b.y - uy * 22); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
      break;
    }
    case 'F': {
      const k = 1 - clamp(b.life / 0.5, 0, 1); const s = Math.round(b.r * 2);
      ctx.fillStyle = k < 0.3 ? '#fff4a8' : k < 0.6 ? '#ffb43a' : k < 0.85 ? '#ff5a2a' : '#5a2a2a';
      ctx.globalAlpha = 0.85; ctx.fillRect(Math.round(b.x - s / 2), Math.round(b.y - s / 2), s, s); ctx.globalAlpha = 1;
      break;
    }
    case 'H': R(Math.round(b.x) - 2, Math.round(b.y) - 2, 4, 4, c); R(Math.round(b.x - b.vx * 0.02) - 1, Math.round(b.y - b.vy * 0.02) - 1, 2, 2, '#ffe2a0'); break;
    case 'S': R(Math.round(b.x) - 2, Math.round(b.y) - 2, 4, 4, c); R(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 2, '#fff'); break;
    default: {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      R(Math.round(b.x - b.vx / sp * 3) - 1, Math.round(b.y - b.vy / sp * 3) - 1, 2, 2, '#ff9a3b');
      R(Math.round(b.x) - 2, Math.round(b.y) - 2, 4, 4, c); R(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 2, '#fff');
    }
  }
}
function drawEBullet(b) {
  const tm = V.t || 0, x = Math.round(b.x), y = Math.round(b.y);
  switch (b.kind) {
    case 'wave': R(x - b.hw, y - b.hh, b.hw * 2, b.hh * 2, Math.floor(tm * 20) % 2 ? '#ffd04a' : '#ff6a2a'); R(x - b.hw + 2, y - b.hh + 3, b.hw * 2 - 4, b.hh * 2 - 3, '#fff4c2'); break;
    case 'bomb': R(x - 4, y - 4, 8, 8, '#22222a'); R(x - 1, y - 6, 2, 2, Math.floor(tm * 12) % 2 ? '#ff3b3b' : '#ffd04a'); break;
    case 'rock': R(x - 6, y - 6, 12, 12, '#4a3428'); R(x - 4, y - 5, 6, 4, '#6e5040'); break;
    default: {
      ctx.fillStyle = 'rgba(255,60,120,0.35)'; ctx.beginPath(); ctx.arc(x, y, b.r + 2, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ff3b78'; ctx.beginPath(); ctx.arc(x, y, b.r, 0, 6.283); ctx.fill();
      R(x - 1, y - 1, 2, 2, '#fff');
    }
  }
}
function drawBeams() {
  const tm = V.t || 0;
  for (const bm of V.beams) {
    if (bm.kind === 'h') {
      if (bm.warn > 0) { if (Math.floor(tm * 16) % 2) { R(bm.x1, bm.y, bm.x2 - bm.x1, 1, '#ff3b3b'); } }
      else { R(bm.x1, bm.y - bm.hh - 2, bm.x2 - bm.x1, bm.hh * 2 + 4, 'rgba(255,60,60,0.45)'); R(bm.x1, bm.y - bm.hh, bm.x2 - bm.x1, bm.hh * 2, '#ff6a6a'); R(bm.x1, bm.y - 1, bm.x2 - bm.x1, 2, '#ffffff'); }
    } else {
      const dx = bm.tx - bm.ox, dy = bm.ty - bm.oy, L = Math.hypot(dx, dy) || 1, ex = bm.ox + dx / L * 700, ey = bm.oy + dy / L * 700;
      ctx.beginPath(); ctx.moveTo(bm.ox, bm.oy); ctx.lineTo(ex, ey);
      if (bm.warn > 0) { ctx.strokeStyle = bm.warn > 0.4 ? 'rgba(255,60,60,0.55)' : (Math.floor(tm * 20) % 2 ? '#ff3b3b' : '#ffffff'); ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.strokeStyle = 'rgba(255,90,60,0.5)'; ctx.lineWidth = 12; ctx.stroke(); ctx.strokeStyle = '#ffb0a0'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }
}
function drawWarns() {
  const tm = V.t || 0;
  for (const w of V.warns) { if (Math.floor(tm * 14) % 2) continue; const x = Math.round(w.x), y = 13 * T - 3; R(x - 6, y, 12, 2, '#ff3b3b'); R(x - 1, y - 12, 2, 7, '#ff3b3b'); R(x - 1, y - 4, 2, 2, '#ff3b3b'); }
}
function drawParts() {
  for (const p of FXS.parts) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'ring') { ctx.globalAlpha = a; ctx.strokeStyle = p.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - a) + 2, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 1; continue; }
    if (p.kind === 'flash') { ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; continue; }
    if (p.kind === 'ghost') { ctx.globalAlpha = a * 0.5; R(Math.round(p.x), Math.round(p.y), p.w, p.h, p.c); ctx.globalAlpha = 1; continue; }
    ctx.globalAlpha = Math.min(1, a * 1.5); R(Math.round(p.x), Math.round(p.y), p.s, p.s, p.c); ctx.globalAlpha = 1;
  }
}
function drawBoss(b) {
  const tm = V.t || 0;
  if (b.kind === 0) {
    const pt = b.parts[0], fl = pt.flash > 0, C = c => fl ? '#fff' : c, x = Math.round(b.x), f = b.face;
    const crouch = b.state === 'stomp' && b.sub === 0 ? 4 : 0, y = Math.round(b.y) + crouch;
    const s = Math.sin(b.legT || 0) * 3;
    R(x + 8, y + 36, 10, 10 - crouch, C('#3a3f4c')); R(x + 6 + s, y + 46 - crouch, 12, 12, C('#4a5060')); R(x + 2 + s, y + 54 - crouch, 18, 4, C('#2a2e38'));
    R(x + 46, y + 36, 10, 10 - crouch, C('#3a3f4c')); R(x + 46 - s, y + 46 - crouch, 12, 12, C('#4a5060')); R(x + 44 - s, y + 54 - crouch, 18, 4, C('#2a2e38'));
    R(x + 2, y + 6, 60, 32, C('#6a707e')); R(x + 2, y + 30, 60, 8, C('#3f4450')); R(x + 8, y + 2, 48, 6, C('#9aa1b2'));
    for (let i = 0; i < 6; i++) R(x + 6 + i * 10, y + 32, 6, 2, C('#ffc23a'));
    R(x + 20, y - 4, 24, 8, C('#2d313b')); for (let i = 0; i < 4; i++) R(x + 22 + i * 6, y - 3, 3, 3, C('#ff5a3a'));
    R(x + (f < 0 ? 6 : 38), y + 12, 20, 12, C('#111318'));
    const eyeC = b.phase > 1 ? (Math.floor(tm * 10) % 2 ? '#ffffff' : '#ff3b3b') : '#ff3b3b';
    R(x + (f < 0 ? 9 : 47), y + 16, 8, 4, C(eyeC));
    R(f < 0 ? x - 14 : x + 62, y + 28, 16, 8, C('#2d313b')); R(f < 0 ? x - 16 : x + 76, y + 29, 3, 6, C('#9aa1b2'));
    if (b.phase > 1) { R(x + 14, y + 10, 1, 8, '#ff6a3a'); R(x + 15, y + 17, 6, 1, '#ff6a3a'); R(x + 48, y + 22, 1, 6, '#ff6a3a'); }
  } else if (b.kind === 1) {
    const pt = b.parts[0], fl = pt.flash > 0, C = c => fl ? '#fff' : c, x = Math.round(b.x), y = Math.round(b.y);
    R(x + 8, y + 8, 72, 16, C('#55607a')); R(x + 10, y + 20, 68, 4, C('#2f3648')); R(x + 2, y + 12, 10, 10, C('#55607a'));
    R(x + 6, y + 10, 14, 6, C('#5ad8ff')); R(x + 7, y + 10, 5, 2, '#d8f8ff');
    R(x + 78, y + 12, 12, 5, C('#46506a')); R(x + 86, y + 3, 4, 13, C('#3a4258'));
    R(x + 30, y + 24, 6, 5, C('#22283a')); R(x + 52, y + 24, 6, 5, C('#22283a')); R(x + 20, y + 28, 44, 2, C('#2f3648'));
    R(x + 70, y + 15, 4, 3, Math.floor(tm * 20) % 2 ? '#ffb43a' : '#ff6a2a');
    for (let i = 0; i < 5; i++) R(x + 24 + i * 9, y + 12, 5, 2, C('#ff3fb4'));
    R(x + 40, y + 3, 4, 5, C('#22283a'));
    const bw = Math.abs(Math.cos(b.rot || 0)) * 44 + 4; R(Math.round(x + 42 - bw), y + 2, Math.round(bw * 2), 2, 'rgba(230,236,255,0.8)');
    if (b.phase > 1 && Math.floor(tm * 6) % 2) R(x + 26, y + 9, 3, 3, '#ff6a3a');
    if (b.state === 'sweep' && b.sub === 1) {
      const wy = y + b.h / 2; const ex = (V.cam.x + W) - 22;
      if (Math.floor(tm * 10) % 2) { R(ex, wy - 10, 18, 20, '#ff3b3b'); R(ex + 8, wy - 7, 2, 9, '#fff'); R(ex + 8, wy + 4, 2, 2, '#fff'); }
    }
  } else {
    const oy = Math.round((b.rise || 0) * 200), x = Math.round(b.x), y = Math.round(b.y) + oy;
    R(x + 20, y, 90, 196, '#241a26'); R(x + 24, y + 4, 82, 188, '#2f2232');
    for (let i = 0; i < 9; i++) R(x + 30, y + 12 + i * 20, 70, 2, '#3e2c42');
    for (let i = 0; i < 6; i++) R(x + 92, y + 16 + i * 28, 6, 14, Math.floor(tm * 3 + i) % 3 ? '#4a2030' : '#ff4a3a');
    R(x + 14, y + 60, 12, 6, '#3e2c42'); R(x + 14, y + 128, 12, 6, '#3e2c42');
    const tgt = V.players.find(q => q.active && !q.out && !q.downed) || { x: x - 100, y: 180, w: 10, h: 22 };
    for (const pt of b.parts) {
      const px = x + pt.ox, py = y + pt.oy;
      if (pt.core) continue;
      if (!pt.alive) { R(px + 6, py + 4, 18, 14, '#1a1418'); if (Math.floor(tm * 12) % 3 === 0) R(px + 8 + Math.random() * 12, py + 6 + Math.random() * 8, 2, 2, '#ffd04a'); continue; }
      const fl = pt.flash > 0, C = c => fl ? '#fff' : c;
      R(px, py, pt.w, pt.h, C('#5b6170')); R(px + 2, py + 2, pt.w - 4, 6, C('#9aa1b2')); R(px + 10, py + 9, 8, 6, C('#ff3b3b'));
      const a = Math.atan2(tgt.y + 10 - (py + 11), tgt.x + 5 - px);
      for (let i = 0; i < 12; i++) R(Math.round(px + Math.cos(a) * i) - 1, Math.round(py + 11 + Math.sin(a) * i) - 1, 3, 3, C('#2d313b'));
    }
    const core = b.parts[0], ccx = x + core.ox + core.w / 2, ccy = y + core.oy + core.h / 2, fl = core.flash > 0;
    ctx.fillStyle = '#120c12'; ctx.beginPath(); ctx.arc(ccx, ccy, 20, 0, 6.283); ctx.fill();
    const pulse = 0.5 + 0.5 * Math.sin(tm * (b.phase >= 3 ? 14 : 5));
    ctx.fillStyle = fl ? '#fff' : (b.phase >= 3 ? '#ffe6a0' : b.phase === 2 ? '#ff6a3a' : '#a8323a');
    ctx.beginPath(); ctx.arc(ccx, ccy, 11 + pulse * 3, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(ccx - 2, ccy - 2, 4, 4);
    if (b.phase === 1 && core.alive) { ctx.strokeStyle = `rgba(127,240,255,${0.45 + 0.25 * Math.sin(tm * 6)})`; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * 6.283 + tm * 0.5; const px2 = ccx + Math.cos(a) * 25, py2 = ccy + Math.sin(a) * 25; k ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2); } ctx.stroke(); }
  }
}

// ───────────────────────── интерфейс (чёткий слой) ─────────────────────────
function txt(s, x, y, size, color, align, font, noShadow) {
  sctx.font = fontStr(size, font); sctx.textAlign = align || 'left'; sctx.textBaseline = 'top';
  if (!noShadow) { sctx.fillStyle = 'rgba(0,0,0,0.8)'; sctx.fillText(s, (x + 1) * S, (y + 1) * S); }
  sctx.fillStyle = color; sctx.fillText(s, x * S, y * S);
}
function fontStr(size, font) { const f = font || FP; return (f === FP ? '700 ' : '') + Math.round(size * S) + 'px ' + f; }
function measure(s, size, font) { sctx.font = fontStr(size, font); return sctx.measureText(s).width / S; }
function rectUI(x, y, w, h, c) { sctx.fillStyle = c; sctx.fillRect(x * S, y * S, w * S, h * S); }
function strokeUI(x, y, w, h, c, lw) { sctx.strokeStyle = c; sctx.lineWidth = (lw || 1) * S; sctx.strokeRect((x + 0.5) * S, (y + 0.5) * S, (w - 1) * S, (h - 1) * S); }
function wrap(s, maxW, size) { const words = s.split(' '); const lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (measure(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; }
const blink = (rate) => Math.floor((V.t || G.t) * (rate || 3)) % 2 === 0;
function chromeText(s, x, y, size) {
  sctx.font = `${Math.round(size * S)}px ${FD}`; sctx.textAlign = 'center'; sctx.textBaseline = 'top';
  sctx.fillStyle = '#0a0612'; sctx.fillText(s, x * S, (y + 3) * S);
  sctx.fillStyle = '#ff3fb4'; sctx.fillText(s, x * S, (y + 1.5) * S);
  const g = sctx.createLinearGradient(0, y * S, 0, (y + size) * S);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#9fd8ff'); g.addColorStop(0.5, '#28466e'); g.addColorStop(0.62, '#e8f6ff'); g.addColorStop(1, '#7aa8d8');
  sctx.fillStyle = g; sctx.fillText(s, x * S, y * S);
}
function myId() { return NET.mode === 'guest' ? 1 : 0; }
function drawHUD() {
  const tm = V.t || 0;
  V.players.forEach(p => {
    const right = p.id === 1, x0 = right ? W - 8 : 8, al = right ? 'right' : 'left', P = palOf(p.id);
    if (!p.active) {
      const canJoin = NET.mode === 'local' ? (!IS_TOUCH || !!pads[1]) : (NET.mode === 'host' && NET.connected);
      if (V.state === 'play' && canJoin && blink(2)) txt(right ? 'ИГРОК 2: ОГОНЬ — ВОЙТИ' : 'ИГРОК 1: ОГОНЬ', x0, 7, 8, '#ffd04a', al);
      return;
    }
    const me = NET.mode !== 'local' && p.id === myId();
    txt(PNAME[p.id] + (me ? ' · ТЫ' : ''), x0, 5, 9, P.scarf, al);
    if (p.out) { txt('ВЫБЫЛ', x0, 16, 8, '#ff6a6a', al); return; }
    const pipW = 7, gap = 2;
    for (let i = 0; i < p.maxHp; i++) {
      const px = right ? x0 - (i + 1) * (pipW + gap) + gap : x0 + i * (pipW + gap);
      rectUI(px, 17, pipW, 6, '#0a0a12'); rectUI(px + 1, 18, pipW - 2, 4, i < p.hp ? (p.hp === 1 ? (blink(6) ? '#ff4a4a' : '#ff9a9a') : '#ff4a5a') : '#2a2430');
    }
    const wy = 26, wl = WNAME[p.weapon] + (p.wlvl > 1 ? '+' : '');
    txt(wl, x0, wy, 8, WCOL[p.weapon], al);
    const bx = right ? x0 - 56 : x0, by = 37;
    rectUI(bx, by, 56, 5, '#0a0a12'); rectUI(bx + 1, by + 1, 54 * clamp(p.meter / 100, 0, 1), 3, p.meter >= 100 ? (blink(8) ? '#ffffff' : P.scarf) : P.armorD);
    if (p.meter >= 100) txt('СУПЕР!', right ? bx - 4 : bx + 60, by - 2, 7, '#ffffff', al);
  });
  txt(String(V.score).padStart(7, '0'), W / 2, 5, 11, '#ffffff', 'center');
  txt('КРЕДИТЫ ' + V.lives, W / 2, 18, 7, '#ffd04a', 'center');
  if (V.combo >= 6) txt('КОМБО ×' + (1 + Math.min(3, Math.floor(V.combo / 6) * 0.5)).toFixed(1), W / 2, 27, 8, '#ff6ad5', 'center');
  // босс
  const b = V.boss;
  if (b && b.ready && !b.dead) {
    let hp = 0, mx = 0; for (const pt of b.parts) { hp += Math.max(0, pt.hp); mx += pt.max; }
    const bw = 220, bx = (W - bw) / 2, by = H - 16;
    txt(b.name, bx, by - 11, 9, '#ff6a6a');
    rectUI(bx, by, bw, 7, '#0a0a12'); rectUI(bx + 1, by + 1, (bw - 2) * clamp(hp / mx, 0, 1), 5, b.phase > 1 ? '#ff4a3a' : '#ff8a3a');
  }
  const mini = !b && V.enemies.find(e => e.mini);
  if (mini) {
    const bw = 180, bx = (W - bw) / 2, by = H - 16;
    txt(mini.label || 'МИНИ-БОСС', bx, by - 11, 9, '#ff9a6a');
    rectUI(bx, by, bw, 7, '#0a0a12'); rectUI(bx + 1, by + 1, (bw - 2) * clamp(mini.hp / mini.maxHp, 0, 1), 5, '#ff9a3a');
  }
  if (V.lock && V.lock.kind === 'waves' && V.lock.wave > 0) txt('ВОЛНА ' + V.lock.wave + ' / 3', W / 2, 36, 8, '#ff9a6a', 'center');
  if (V.lockMsgT > 0 && V.lockMsg) {
    sctx.globalAlpha = clamp(V.lockMsgT * 2, 0, 1);
    rectUI(0, 64, W, 26, 'rgba(6,4,14,0.6)');
    txt(V.lockMsg, W / 2, 69, 13, '#ffc23a', 'center', FD);
    sctx.globalAlpha = 1;
  }
  // подписи в мире
  const cx = V.cam.x;
  for (const k of V.pickups) txt(WLET[k.kind], k.x + 6 - cx, k.y + 3, 7, '#ffffff', 'center');
  V.players.forEach(p => {
    if (!p.active || !p.downed || p.out) return;
    const sx = p.x + 5 - cx, sy = p.y - 18;
    txt(Math.ceil(p.downT) + '', sx, sy - 9, 9, '#ff6a6a', 'center');
    if (p.revive > 0) { rectUI(sx - 14, sy + 3, 28, 4, '#0a0a12'); rectUI(sx - 13, sy + 4, 26 * clamp(p.revive / 1.5, 0, 1), 2, '#5dff7a'); }
    else if (blink(3)) txt('ПОДОЙДИ!', sx, sy + 1, 7, '#ffffff', 'center');
  });
  for (const t of FXS.texts) { sctx.globalAlpha = clamp(t.life * 1.6, 0, 1); txt(t.s, t.x - cx, t.y, t.z, t.c, 'center'); sctx.globalAlpha = 1; }
  for (const bm of V.beams) if (bm.hint && bm.warn > 0) txt('ПРИГНИСЬ ↓', (bm.x1 + bm.x2) / 2 - cx, bm.y - 24, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  if (b && b.kind === 1 && b.state === 'sweep' && b.sub === 1) txt('ПРИГНИСЬ ↓', W / 2, 150, 12, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  // баннеры
  if (V.bannerT > 0) {
    const a = clamp(Math.min(V.bannerT, 3.2 - V.bannerT) * 3, 0, 1); sctx.globalAlpha = a;
    rectUI(0, 92, W, 50, 'rgba(6,4,14,0.72)'); rectUI(0, 92, W, 1, '#ffffff33'); rectUI(0, 141, W, 1, '#ffffff33');
    txt('УРОВЕНЬ ' + (V.level + 1) + ' / 3', W / 2, 98, 9, '#ffd04a', 'center');
    chromeText(THEMES[V.level].name, W / 2, 110, 22);
    sctx.globalAlpha = 1;
  }
  if (V.bossIntroT > 0 && b) {
    const a = clamp(Math.min(V.bossIntroT, 2.8 - V.bossIntroT) * 3, 0, 1); sctx.globalAlpha = a;
    rectUI(0, 96, W, 46, 'rgba(60,0,8,0.75)');
    for (let i = 0; i < 24; i++) { rectUI(((i * 24 + tm * 60) % (W + 24)) - 24, 96, 12, 4, '#ffc23a'); rectUI(((i * 24 - tm * 60) % (W + 24) + W + 24) % (W + 24) - 24, 138, 12, 4, '#ffc23a'); }
    txt('ВНИМАНИЕ · ' + THEMES[V.level].bossSub, W / 2, 104, 9, '#ffc23a', 'center');
    txt(b.name, W / 2, 114, 20, '#ffffff', 'center', FD);
    sctx.globalAlpha = 1;
  }
  if (V.hintT > 0 && V.state === 'play') {
    sctx.globalAlpha = clamp(V.hintT, 0, 1);
    const lines = IS_TOUCH ? ['Стик: бег и прицел в 8 сторон', 'РЫВОК делает неуязвимым на миг', 'Вниз + ПРЫЖОК: спрыгнуть с мостков'] : ['Вверх/вниз + бег — стрельба по диагонали', 'РЫВОК делает неуязвимым на миг', 'Вниз + ПРЫЖОК: спрыгнуть с мостков'];
    lines.forEach((l, i) => txt(l, W / 2, 158 + i * 11, 8, '#e8eef8', 'center'));
    sctx.globalAlpha = 1;
  }
  if (G.msgT > 0 && NET.mode === 'host') txt(G.msg, W / 2, 60, 7, '#ffd04a', 'center');
}
const prevCanvas = mkCanvas(24, 36), prevCtx = prevCanvas.getContext('2d');
function drawPreview(id, x, y, sc) {
  prevCtx.clearRect(0, 0, 24, 36);
  const saved = ctx; ctx = prevCtx;
  try { drawPlayer({ id, active: true, out: false, respawnT: 0, invT: 0, overT: 0, downed: false, crouch: false, onGround: true, vx: 0, vy: 0, animT: 0, dashT: 0, facing: 1, ax: 1, ay: 0, w: 10, h: 22, x: 7, y: 8, bike: false }, false); }
  finally { ctx = saved; }
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(prevCanvas, 0, 0, 24, 36, x * S, y * S, 24 * sc * S, 36 * sc * S);
}
function mvpScore(s) { return s.kills * 100 + s.dmg * 8 + s.revives * 400 + s.supers * 100 - s.hurts * 150; }
function drawStats(key, y, mvpLabel) {
  const ps = V.players.filter(p => p.active && p[key]);
  if (!ps.length) return;
  const two = ps.length > 1, w = two ? 360 : 240, x = (W - w) / 2;
  panel(x, y, w, 150);
  const acc = s => s.shots ? Math.round(s.hits / s.shots * 100) : 0;
  const rows = [['СБИТО ВРАГОВ', s => s.kills, 1], ['ТОЧНОСТЬ', s => acc(s), 1, '%'], ['ПОДНЯЛ НАПАРНИКА', s => s.revives, 1], ['РАНЕНИЯ', s => s.hurts, -1], ['СУПЕР-УДАРЫ', s => s.supers, 1]];
  const cols = two ? [x + 70, x + w - 70] : [x + w - 50];
  ps.forEach((p, i) => txt(PNAME[p.id], cols[i], y + 8, 10, palOf(p.id).scarf, 'center', FD));
  rows.forEach(([label, f, dir, suf], r) => {
    const yy = y + 30 + r * 17;
    txt(label, two ? W / 2 : x + 14, yy, 7, '#8a90a8', two ? 'center' : 'left');
    const vals = ps.map(p => f(p[key]));
    const best = two && vals[0] !== vals[1] ? (dir > 0 ? (vals[0] > vals[1] ? 0 : 1) : (vals[0] < vals[1] ? 0 : 1)) : -1;
    vals.forEach((v, i) => txt((i === best ? '★ ' : '') + v + (suf || ''), cols[i], yy - 1, 9, i === best ? '#ffffff' : '#a8aec4', 'center'));
  });
  if (two) {
    const sc = ps.map(p => mvpScore(p[key]));
    const win = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
    txt(win < 0 ? 'НИЧЬЯ — ОТЛИЧНАЯ КОМАНДА' : mvpLabel + ': ' + PNAME[ps[win].id] + ' ♛', W / 2, y + 126, 10, win < 0 ? '#ffd04a' : palOf(ps[win].id).scarf, 'center', FD);
  }
}
function panel(x, y, w, h) { rectUI(x, y, w, h, 'rgba(8,6,18,0.86)'); strokeUI(x, y, w, h, '#ffffff22'); }
function menuList(items, idx, y) {
  items.forEach((s, i) => {
    const sel = i === idx;
    if (sel) rectUI(W / 2 - 90, y + i * 18 - 3, 180, 15, 'rgba(63,240,255,0.14)');
    txt((sel ? '▸ ' : '') + s, W / 2, y + i * 18, 9, sel ? '#ffffff' : '#8a90a8', 'center');
  });
}
function drawUI() {
  const st = V.state;
  if (st === 'title') {
    chromeText('СТАЛЬНОЙ', W / 2, 26, 34);
    chromeText('РЕЙД', W / 2, 62, 34);
    txt('КООПЕРАТИВНЫЙ БОЕВИК НА ДВОИХ', W / 2, 100, 8, '#ffd04a', 'center');
    if (G.best > 0) txt('РЕКОРД ' + String(G.best).padStart(7, '0'), W / 2, 111, 7, '#8a90a8', 'center');
    if (!IS_TOUCH && !lobbyBusy()) {
      panel(40, 122, 400, 102);
      txt('ИГРОК 1', 60, 128, 9, PALS[0].scarf); txt('ИГРОК 2', 260, 128, 9, PALS[1].scarf);
      const k1 = ['WASD — бег и прицел', 'F — огонь   G — прыжок', 'H — рывок   R — супер', 'E — стоять и целиться'];
      const k2 = ['Стрелки — бег и прицел', '/ — огонь   . — прыжок', ', — рывок   ; — супер', "' — стоять и целиться"];
      k1.forEach((s, i) => txt(s, 60, 142 + i * 11, 8, '#d8deea')); k2.forEach((s, i) => txt(s, 260, 142 + i * 11, 8, '#d8deea'));
      txt('Геймпады тоже работают. M — звук. Esc — пауза.', W / 2, 192, 7, '#8a90a8', 'center');
      if (blink(2)) txt('ENTER — ИГРАТЬ', W / 2, 206, 10, '#ffffff', 'center');
    }
    return;
  }
  if (st === 'select') {
    chromeText('ОТРЯД', W / 2, 10, 22);
    [0, 1].forEach(i => {
      const on = i === 0 || V.sel.p2, x = i === 0 ? 54 : 248, y = 40, w = 178, h = 92, P = palOf(i), L = (V.looks || G.looks)[i];
      panel(x, y, w, h); if (on) strokeUI(x, y, w, h, P.scarf, 1);
      if (on) drawPreview(i, x + 12, y + 12, 2);
      txt(PNAME[i], x + 108, y + 8, 12, on ? P.scarf : '#55586a', 'center', FD);
      let sub = 'ГОТОВ';
      if (!on) sub = NET.mode === 'local' ? (blink(2) ? 'ОГОНЬ — ВОЙТИ' : '') : 'ЖДЁМ ВТОРОЙ ТЕЛЕФОН';
      else if (NET.mode !== 'local' && i === myId()) sub = 'ЭТО ТЫ';
      txt(sub, x + 108, y + 30, 8, on ? '#ffffff' : '#ffd04a', 'center');
      if (on) {
        txt('ШЛЕМ: ' + HELMETS[L.h], x + 108, y + 46, 7, '#a8aec4', 'center');
        txt(IS_TOUCH ? 'РЫВОК — цвет' : 'рывок — цвет', x + 108, y + 62, 7, '#8a90a8', 'center');
        txt(IS_TOUCH ? 'СУПЕР — шлем' : 'супер — шлем', x + 108, y + 73, 7, '#8a90a8', 'center');
      }
    });
    const d = DIFFS[V.diff], rows = V.unlock > 0 ? 2 : 1;
    const py = 140, ph = rows > 1 ? 70 : 52;
    panel(54, py, 372, ph);
    const row = (r, label, val, col) => {
      const yy = py + 8 + r * 30, selr = V.selRow === r && rows > 1;
      if (selr) rectUI(60, yy - 3, 360, 26, 'rgba(63,240,255,0.10)');
      txt(label, 72, yy + 4, 7, '#8a90a8');
      txt('◂  ' + val + '  ▸', W / 2 + 30, yy, 12, col, 'center', FD);
    };
    row(0, 'СЛОЖНОСТЬ', d.name, V.diff === 2 ? '#ff6a6a' : V.diff === 0 ? '#5dff7a' : '#ffd04a');
    if (rows > 1) row(1, 'СТАРТ', 'УРОВЕНЬ ' + (V.startLv + 1), '#7ff0ff');
    txt(rows > 1 && V.selRow === 1 ? THEMES[V.startLv].name + (V.startLv > 0 ? ' · бонус +' + V.startLv + ' улучш.' : '') : d.desc, W / 2, py + ph - 14, 7, '#d8deea', 'center');
    if (blink(2)) txt(IS_TOUCH ? 'ПРЫЖОК — В БОЙ' : 'ENTER ИЛИ ПРЫЖОК — В БОЙ', W / 2, 222, 10, '#ffffff', 'center');
    if (NET.mode === 'guest') txt('Настройки и старт — на любом из телефонов', W / 2, 238, 7, '#8a90a8', 'center');
    if (G.msgT > 0 && NET.mode === 'host') txt(G.msg, W / 2, 250, 7, '#ffd04a', 'center');
    return;
  }
  drawHUD();
  if (st === 'play' && V.paused) {
    rectUI(0, 0, W, H, 'rgba(4,3,10,0.6)');
    chromeText('ПАУЗА', W / 2, 80, 26);
    menuList(['ПРОДОЛЖИТЬ', 'К ВЫБОРУ ОТРЯДА'], V.menuIdx, 128);
  }
  if (st === 'clear') {
    rectUI(0, 0, W, H, 'rgba(4,3,10,0.7)');
    chromeText('ЗОНА ЗАЧИЩЕНА', W / 2, 16, 22);
    const tt = Math.floor(V.stats.time);
    txt('ОЧКИ ' + V.score + '   ·   ВРЕМЯ ' + Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0'), W / 2, 46, 8, '#d8deea', 'center');
    drawStats('st', 62, 'ЛУЧШИЙ БОЕЦ УРОВНЯ');
    if (V.clearT > 1.5 && blink(2)) txt(V.level < 2 ? 'ОГОНЬ — ВЫБРАТЬ УЛУЧШЕНИЕ' : 'ОГОНЬ — ДАЛЬШЕ', W / 2, 236, 10, '#ffffff', 'center');
  }
  if (st === 'perk' && V.perk) {
    rectUI(0, 0, W, H, 'rgba(4,3,10,0.78)');
    chromeText('УЛУЧШЕНИЕ', W / 2, 14, 22);
    const act = V.perk.map((ps, i) => ps ? i : -1).filter(i => i >= 0);
    act.forEach((i, k) => {
      const ps = V.perk[i], P = palOf(i);
      const colW = act.length > 1 ? 200 : 260, x = act.length > 1 ? (k === 0 ? 30 : 250) : (W - colW) / 2;
      txt(PNAME[i] + (NET.mode !== 'local' && i === myId() ? ' · ТЫ' : ''), x + colW / 2, 46, 9, P.scarf, 'center');
      ps.opts.forEach((id, j) => {
        const pk = PERKS.find(q => q.id === id), y = 60 + j * 58, sel = j === ps.idx;
        panel(x, y, colW, 52);
        if (sel) { strokeUI(x, y, colW, 52, ps.done ? '#5dff7a' : P.scarf, 2); }
        txt(pk.name, x + 10, y + 7, 10, sel ? '#ffffff' : '#a8aec4', 'left', FD);
        wrap(pk.desc, colW - 20, 8).slice(0, 2).forEach((l, n) => txt(l, x + 10, y + 24 + n * 11, 8, sel ? '#d8deea' : '#7a8098'));
      });
      if (ps.done) txt('ГОТОВ', x + colW / 2, 238, 10, '#5dff7a', 'center');
      else if (blink(2)) txt('↑↓ ВЫБОР · ОГОНЬ — ВЗЯТЬ', x + colW / 2, 238, 8, '#ffffff', 'center');
    });
  }
  if (st === 'over') {
    rectUI(0, 0, W, H, 'rgba(20,2,6,0.7)');
    chromeText('ОТРЯД ПАЛ', W / 2, 70, 28);
    txt('ОЧКИ ' + V.score, W / 2, 112, 9, '#ffffff', 'center');
    menuList(['ЕЩЁ РАЗ С УРОВНЯ ' + (V.level + 1), 'К ВЫБОРУ ОТРЯДА'], V.menuIdx, 140);
  }
  if (st === 'win') {
    rectUI(0, 0, W, H, 'rgba(4,3,10,0.75)');
    chromeText('ПОБЕДА!', W / 2, 10, 28);
    txt('Машины повержены. Город свободен.   Очки ' + V.score + ' · рекорд ' + Math.max(V.best, V.score), W / 2, 46, 8, '#ffd04a', 'center');
    drawStats('tot', 62, 'ЛУЧШИЙ БОЕЦ РЕЙДА');
    if (V.clearT > 2.5 && blink(2)) txt('ОГОНЬ — В МЕНЮ', W / 2, 236, 10, '#ffffff', 'center');
  }
  const awayMsg = NET.mode === 'guest' && (V.awayHost || NET.hostAway) ? 'ПЕРВЫЙ ТЕЛЕФОН СВЕРНУЛ ИГРУ · ЖДЁМ' : NET.mode === 'host' && G.awayGuest ? 'ВТОРОЙ ТЕЛЕФОН СВЕРНУЛ ИГРУ · ЖДЁМ' : '';
  if (awayMsg) { rectUI(0, H - 46, W, 22, 'rgba(6,4,14,0.8)'); txt(awayMsg, W / 2, H - 41, 9, '#ffd04a', 'center'); }
  if (NET.mode === 'guest' && NET.recon) {
    rectUI(0, 0, W, H, 'rgba(4,3,10,0.7)');
    txt('СВЯЗЬ ПОТЕРЯНА', W / 2, 100, 16, '#ff6a6a', 'center', FD);
    txt('Переподключаюсь… ещё ' + Math.max(0, Math.ceil((NET.recon.until - performance.now()) / 1000)) + ' с', W / 2, 126, 9, '#ffffff', 'center');
    txt('Проверь Wi-Fi и что игра открыта на первом телефоне', W / 2, 142, 7, '#8a90a8', 'center');
  } else if (NET.mode === 'guest' && NET.connected && !V.awayHost && !NET.hostAway && performance.now() - NET.lastRecv > 1500) txt('СВЯЗЬ ПРЕРЫВАЕТСЯ…', W / 2, H - 30, 9, '#ff6a6a', 'center');
}

// ───────────────────────── кадр ─────────────────────────
function render(now) {
  if (NET.mode === 'guest') { const gv = guestView(now); if (gv) V = gv; else V = G; } else V = G;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const inGame = V.state === 'play' || V.state === 'clear' || V.state === 'perk' || V.state === 'over' || V.state === 'win';
  if (inGame && V.lv) {
    drawBG(V.lv.n, V.cam.x);
    const sx = FXS.shake > 0 ? (Math.random() * 2 - 1) * FXS.shake : 0, sy = FXS.shake > 0 ? (Math.random() * 2 - 1) * FXS.shake : 0;
    ctx.setTransform(1, 0, 0, 1, Math.round(-V.cam.x + sx), Math.round(sy));
    drawTiles();
    if (V.chase) { ctx.fillStyle = 'rgba(255,240,220,0.22)'; for (let k = 0; k < 16; k++) { const xx = V.cam.x + W - ((V.t * 700 + k * 137) % (W + 80)), yy = 24 + (k * 53) % 170; ctx.fillRect(Math.round(xx), yy, 18 + (k % 3) * 8, 1); } }
    if (V.boss && V.boss.kind === 2) drawBoss(V.boss);
    for (const k of V.pickups) drawPickup(k);
    for (const e of V.enemies) drawEnemy(e);
    if (V.boss && V.boss.kind !== 2) drawBoss(V.boss);
    const me = myId();
    V.players.forEach(p => { if (p.id !== me) drawPlayer(p, false); });
    V.players.forEach(p => { if (p.id === me) drawPlayer(p, true); });
    for (const b of V.pbullets) drawPBullet(b);
    for (const b of V.ebullets) drawEBullet(b);
    drawBeams(); drawWarns(); drawParts();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    drawBG(0, (performance.now() / 1000) * 30);
    ctx.fillStyle = 'rgba(6,4,14,0.35)'; ctx.fillRect(0, 0, W, H);
  }
  if (FXS.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, FXS.flash * 2)})`; ctx.fillRect(0, 0, W, H); }
  sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.imageSmoothingEnabled = false;
  sctx.drawImage(buf, 0, 0, screen.width, screen.height);
  // лёгкие сканлайны
  sctx.fillStyle = 'rgba(0,0,0,0.12)'; const step = Math.max(2, Math.round(S * 2));
  for (let y = 0; y < screen.height; y += step) sctx.fillRect(0, y, screen.width, Math.max(1, Math.round(S * 0.6)));
  drawUI();
}
function step(dt) {
  pads = getPads();
  musicTick();
  updFx(dt);
  G.t += dt;
  if (G.msgT > 0) G.msgT -= dt;
  if (NET.mode === 'guest') { guestStep(dt); syncTouchUI(); return; }
  if (NET.mode === 'host') { remoteIn(); if (NET.connected && performance.now() - NET.lastRecv > (G.awayGuest ? 300000 : 8000)) hostLostGuest(); }
  setInput(INP[0], localState(0));
  if (NET.mode !== 'host') setInput(INP[1], localState(1));
  switch (G.state) {
    case 'title': updTitle(); break;
    case 'select': updSelect(); break;
    case 'play': updPlay(dt); break;
    case 'clear': updClear(dt); break;
    case 'perk': updPerk(); break;
    case 'over': updOver(); break;
    case 'win': updWin(dt); break;
  }
  if (NET.mode === 'host') { NET.snapAcc += dt; const rate = NET.conn && NET.conn.relay ? 1 / 20 : 1 / 30; if (NET.snapAcc >= rate - 0.001) { NET.snapAcc = 0; sendSnap(); } }
  else netEvents = [];
  syncTouchUI();
}

// ───────────────────────── лобби и сенсорное управление (HTML) ─────────────────────────
const $ = id => document.getElementById(id);
function lobbyVisible() { const l = $('lobby'); return l && !l.hidden; }
function lobbyBusy() { const l = $('lobby'); return !!(l && !l.hidden && $('lb-main').hidden); }
function showLobby(which) {
  const l = $('lobby'); if (!l) return;
  if (!which) { l.hidden = true; return; }
  l.hidden = false;
  ['main', 'host', 'join'].forEach(k => { $('lb-' + k).hidden = k !== which; });
}
function setStatus(which, s) { const el = $(which + '-status'); if (el) el.textContent = s; }
function updateSoundBtn() { const b = $('b-sound'); if (b) { b.textContent = muted ? 'Звук: выкл' : 'Звук: вкл'; b.setAttribute('aria-pressed', muted ? 'false' : 'true'); } const t = $('t-sound'); if (t) t.textContent = muted ? '♪ ВЫКЛ' : '♪'; }
function updateAutoBtn() { const b = $('t-auto'); if (b) { b.classList.toggle('on', autoFire); b.textContent = autoFire ? 'АВТО ✓' : 'АВТО'; } }
let lastTouchState = '';
function syncTouchUI() {
  const st = V.state, key = st;
  if (key === lastTouchState) return;
  lastTouchState = key;
  document.body.classList.toggle('ingame', st !== 'title' && st !== 'select');
  document.body.classList.toggle('st-play', st === 'play');
  const t = $('touch'); if (!t || !IS_TOUCH) return;
  t.hidden = st === 'title';
}
function setupUI() {
  updateSoundBtn(); updateAutoBtn();
  if (!IS_TOUCH) $('b-solo').textContent = 'Играть на этом компьютере';
  $('b-solo').addEventListener('click', () => { initAudio(); netClose(); NET.mode = 'local'; G.sel = { p2: false }; showLobby(false); goSelect(); sfx('confirm'); });
  $('b-host').addEventListener('click', () => { initAudio(); showLobby('host'); hostGame(); });
  $('b-join').addEventListener('click', () => { initAudio(); showLobby('join'); setStatus('join', ''); setTimeout(() => { try { $('join-code').focus(); } catch (e) { } }, 50); });
  $('b-host-cancel').addEventListener('click', () => { netClose(); NET.mode = 'local'; showLobby('main'); });
  $('b-join-cancel').addEventListener('click', () => { netClose(); NET.mode = 'local'; showLobby('main'); });
  const go = () => { initAudio(); const code = ($('join-code').value || '').replace(/\D/g, ''); try { $('join-code').blur(); } catch (e) { } joinGame(code); };
  $('b-join-go').addEventListener('click', go);
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('b-sound').addEventListener('click', () => { initAudio(); toggleMute(); });
  const fs = $('b-full');
  if (fs) {
    if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) fs.hidden = true;
    fs.addEventListener('click', () => { const el = document.documentElement; try { if (document.fullscreenElement) document.exitFullscreen(); else (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } catch (e) { } });
  }
  if (!IS_TOUCH) return;
  document.body.classList.add('touch');
  applyLayout();
  window.addEventListener('resize', applyLayout);
  TIDS.forEach(id => { const el = $(id); el.addEventListener('pointerdown', e => { if (editing) startDrag(e, el); }, true); });
  document.addEventListener('pointermove', e => { if (drag && drag.pid === e.pointerId) moveDrag(e); });
  document.addEventListener('pointerup', e => { if (drag && drag.pid === e.pointerId) endDrag(); });
  $('t-edit').addEventListener('click', () => { if (!V.paused && V.state === 'play') { TOUCH.start = true; setTimeout(() => { TOUCH.start = false; }, 120); } setEditing(true); });
  $('t-done').addEventListener('click', () => setEditing(false));
  $('t-reset').addEventListener('click', () => { layout = { scale: 1, mirror: false, pos: {} }; applyLayout(); });
  $('t-mirror').addEventListener('click', () => { layout.mirror = !layout.mirror; layout.pos = {}; applyLayout(); });
  $('t-scale').addEventListener('input', e => { layout.scale = clamp(parseFloat(e.target.value) || 1, 0.7, 1.4); applyLayout(); });
  const pad = $('tpad'), knob = $('tknob');
  const ptrs = new Map();
  const padUpdate = () => {
    TOUCH.left = TOUCH.right = TOUCH.up = TOUCH.down = false;
    const r = pad.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let kx = 0, ky = 0;
    for (const pt of ptrs.values()) {
      const dx = pt.x - cx, dy = pt.y - cy, d = Math.hypot(dx, dy), dz = r.width * 0.16;
      if (d > dz) {
        const a = Math.atan2(dy, dx), oct = Math.round(a / (Math.PI / 4));
        const dirs = { 0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0], '-4': [-1, 0], '-3': [-1, -1], '-2': [0, -1], '-1': [1, -1] }[oct] || [0, 0];
        if (dirs[0] > 0) TOUCH.right = true; if (dirs[0] < 0) TOUCH.left = true; if (dirs[1] > 0) TOUCH.down = true; if (dirs[1] < 0) TOUCH.up = true;
      }
      const m = Math.min(d, r.width * 0.36); kx = d ? dx / d * m : 0; ky = d ? dy / d * m : 0;
    }
    knob.style.transform = `translate(${kx}px,${ky}px)`;
  };
  pad.addEventListener('pointerdown', e => { if (editing) return; e.preventDefault(); initAudio(); try { pad.setPointerCapture(e.pointerId); } catch (_) { } ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); padUpdate(); });
  pad.addEventListener('pointermove', e => { if (ptrs.has(e.pointerId)) { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); padUpdate(); } });
  const end = e => { ptrs.delete(e.pointerId); padUpdate(); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => pad.addEventListener(n, end));
  document.querySelectorAll('[data-btn]').forEach(b => {
    const n = b.dataset.btn;
    const on = e => { if (editing && TIDS.includes(b.id)) return; e.preventDefault(); initAudio(); TOUCH[n] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) { } };
    const off = () => { TOUCH[n] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(k => b.addEventListener(k, off));
  });
  $('t-auto').addEventListener('click', () => { autoFire = !autoFire; save('auto', autoFire); updateAutoBtn(); });
  $('t-sound').addEventListener('click', () => { initAudio(); toggleMute(); });
  ['touchend', 'click'].forEach(n => document.addEventListener(n, () => initAudio(), { passive: true }));
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}

// настройка расположения и размера кнопок
const TIDS = ['tpad', 'k-jump', 'k-fire', 'k-dash', 'k-sup'];
const TBASE = { tpad: 136, 'k-jump': 76, 'k-fire': 70, 'k-dash': 60, 'k-sup': 54 };
let layout = load('layout', null) || { scale: 1, mirror: false, pos: {} };
if (!layout.pos) layout.pos = {};
let editing = false, drag = null;
function applyLayout() {
  const t = $('touch'); if (!t) return;
  t.classList.toggle('mirror', !!layout.mirror);
  for (const id of TIDS) {
    const el = $(id); if (!el) continue;
    const sz = Math.round(TBASE[id] * layout.scale); el.style.width = el.style.height = sz + 'px';
    const ps = layout.pos[id];
    if (ps) { el.style.left = Math.round(clamp(ps.x * innerWidth - sz / 2, 0, innerWidth - sz)) + 'px'; el.style.top = Math.round(clamp(ps.y * innerHeight - sz / 2, 0, innerHeight - sz)) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; }
    else { el.style.left = el.style.top = el.style.right = el.style.bottom = ''; }
  }
  const k = $('tknob'); if (k) { const ks = Math.round(56 * layout.scale); k.style.width = k.style.height = ks + 'px'; k.style.margin = (-ks / 2) + 'px 0 0 ' + (-ks / 2) + 'px'; }
  const sc = $('t-scale'); if (sc) sc.value = layout.scale;
  const mi = $('t-mirror'); if (mi) mi.classList.toggle('on', !!layout.mirror);
}
function setEditing(on) {
  editing = on; document.body.classList.toggle('editing', on);
  const p = $('tedit'); if (p) p.hidden = !on;
  BTN.forEach(n => { TOUCH[n] = false; });
  if (!on) save('layout', layout);
}
function startDrag(e, el) {
  e.preventDefault(); e.stopPropagation();
  const r = el.getBoundingClientRect();
  drag = { pid: e.pointerId, el, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
}
function moveDrag(e) {
  const el = drag.el, sz = el.offsetWidth;
  const cx = clamp(e.clientX - drag.dx, sz / 2, innerWidth - sz / 2), cy = clamp(e.clientY - drag.dy, sz / 2, innerHeight - sz / 2);
  layout.pos[el.id] = { x: cx / innerWidth, y: cy / innerHeight };
  el.style.left = Math.round(cx - sz / 2) + 'px'; el.style.top = Math.round(cy - sz / 2) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
}
function endDrag() { drag = null; save('layout', layout); }

// ───────────────────────── запуск ─────────────────────────
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let d = (now - last) / 1000; last = now; if (d > 0.1) d = 0.1; if (d < 0) d = 0;
  acc += d; let n = 0;
  while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n++; }
  if (n >= 5) acc = 0;
  render(now);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
document.addEventListener('visibilitychange', () => {
  const hidden = document.hidden;
  if (!hidden) NET.lastRecv = performance.now();
  if (NET.mode === 'host') {
    G.awayHost = hidden; if (hidden && G.state === 'play') G.paused = true;
    try { if (NET.conn && NET.connected) { NET.conn.send({ t: hidden ? 'away' : 'back' }); NET.conn.send(makeSnap()); } } catch (e) { }
  } else if (NET.mode === 'guest') {
    try { if (NET.conn && NET.connected) NET.conn.send({ t: hidden ? 'away' : 'back' }); } catch (e) { }
  } else if (hidden && G.state === 'play') G.paused = true;
});
try { if (document.fonts && document.fonts.load) { document.fonts.load('700 16px "Exo 2"'); document.fonts.load('16px "Russo One"'); } } catch (e) { }
setupUI(); resize(); showLobby('main'); playSong('title');
requestAnimationFrame(frame);

if (window.__TEST__) window.__game = { G, NET, INP, step, render, startGame, loadLevel, setInput, TOUCH, keys, makeSnap, decodeSnap, onGuestData, guestView, get V() { return V; }, setV: v => { V = v; }, FXS, getLevel, emit };
})();
