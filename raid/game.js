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
  zap: t => { nz(t, 0.08, 0.08, 4000, 'highpass'); osc('sawtooth', 1800, 400, t, 0.08, 0.05); },
  wind: t => nz(t, 1.2, 0.08, 600, 'lowpass'),
  flip: t => { osc('sine', 260, 980, t, 0.14, 0.09); nz(t, 0.1, 0.05, 3000, 'highpass'); },
  swap: t => [392, 523, 659, 523, 784].forEach((f, i) => osc('square', f, f, t + i * 0.06, 0.08, 0.06)),
  slash: t => { nz(t, 0.12, 0.12, 2600, 'bandpass'); osc('sawtooth', 900, 180, t, 0.12, 0.06); },
  grav: t => { osc('sine', 200, 40, t, 0.7, 0.22); nz(t, 0.5, 0.08, 500, 'lowpass'); },
  suck: t => { nz(t, 2.2, 0.16, 420, 'lowpass'); osc('sine', 70, 40, t, 2, 0.12); },
  tether: t => osc('triangle', 520, 760, t, 0.05, 0.035),
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
  l3: { bpm: 132, root: 47, prog: [0, -4, 3, -2], bass: [0, -1, 12, -1, 0, -1, 12, 7, 0, -1, 12, -1, 10, -1, 7, -1], lead: [4, 2, 3, 1, 4, 2, 3, 0, 4, 2, 3, 1, 2, 3, 4, -1], d: D_ROCK },
  l4: { bpm: 126, root: 41, prog: [0, 3, 5, -2], bass: [0, 0, -1, 12, 0, -1, 10, -1, 0, 0, -1, 12, 7, -1, 5, -1], lead: [0, -1, 2, 4, -1, 2, 1, -1, 0, -1, 2, 4, 3, -1, 2, -1], d: D_SOFT },
  l5: { bpm: 160, root: 38, prog: [0, 1, 3, 1], bass: [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 10, 10, 12, 13], lead: [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 4, -1, 4, -1], d: D_FAST },
  boss2: { bpm: 176, root: 44, prog: [0, -1, 0, 1], bass: [0, 12, 0, 12, 0, 12, 0, 12, 1, 13, 1, 13, 0, 12, 10, 12], lead: [4, -1, 3, -1, 2, -1, 1, 2, 4, -1, 3, -1, 4, 3, 2, 1], d: D_FAST },
  final: { bpm: 184, root: 40, prog: [0, 1, 0, -2], bass: [0, 0, 12, 0, 1, 1, 13, 1, 0, 0, 12, 0, 10, 10, 11, 12], lead: [4, 3, 4, 2, 4, 3, 4, 1, 4, 3, 4, 2, 0, 1, 2, 3], d: D_FAST },
  l6: { bpm: 118, root: 42, prog: [0, -2, -5, -3], bass: [0, -1, -1, 0, -1, -1, 12, -1, 0, -1, -1, 0, -1, 10, -1, 7], lead: [4, -1, -1, 3, -1, -1, 2, -1, 4, -1, -1, 1, -1, 2, -1, -1], d: D_SOFT },
  l7: { bpm: 164, root: 45, prog: [0, -4, -2, 3], bass: [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 10, 0, 12, 0], lead: [0, 2, 4, 2, 3, 4, 3, 2, 0, 2, 4, 2, 4, 3, 2, 1], d: D_FAST },
  l8: { bpm: 136, root: 40, prog: [0, 3, -2, 1], bass: [0, -1, 0, 12, -1, 0, 10, -1, 0, -1, 0, 12, -1, 7, -1, 10], lead: [0, -1, 1, 2, -1, 3, 4, -1, 0, -1, 1, 2, -1, 4, 3, -1], d: D_ROCK },
  boss3: { bpm: 180, root: 43, prog: [0, 1, 0, -2], bass: [0, 12, 0, 12, 1, 13, 1, 13, 0, 12, 0, 12, -2, 10, -2, 10], lead: [4, 3, 4, -1, 2, 3, 2, -1, 4, 3, 4, -1, 1, 2, 3, 4], d: D_FAST },
  final2: { bpm: 190, root: 38, prog: [0, -1, -3, 1], bass: [0, 0, 12, 0, 0, 12, 0, 0, 1, 1, 13, 1, 0, 12, 10, 12], lead: [4, -1, 4, 3, 2, -1, 2, 1, 4, -1, 4, 3, 4, 3, 2, 0], d: D_FAST },
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
  { name: 'ЛЕДЯНОЙ ПЕРЕВАЛ', base: '#3a4a63', mid: '#4a5d7a', dark: '#232e40', top: '#dfeefa', top2: '#ffffff', ice: '#9fe3ff', plat: '#7a8ba3', platD: '#3a4558', crate: '#6d7f97', crateD: '#3b4659', song: 'l3', boss: 'ЧЕРВЬ', bossSub: 'ПОДЛЕДНЫЙ ЧЕРВЬ' },
  { name: 'ОРБИТАЛЬНАЯ СТАНЦИЯ', base: '#2a2f3a', mid: '#363c4a', dark: '#16191f', top: '#5a6478', top2: '#9fe6ff', glow: '#ffd04a', plat: '#4a5468', platD: '#1c2028', crate: '#3a4252', crateD: '#1a1e26', song: 'l4', boss: 'СТРАЖ', bossSub: 'СТРАЖ ВОРОТ' },
  { name: 'ЦИТАДЕЛЬ ОМЕГА', base: '#231a22', mid: '#33252f', dark: '#120c11', top: '#4a3a46', top2: '#ff3b5a', hazard: '#ff3b5a', plat: '#4a3a46', platD: '#1e161c', crate: '#3a2e36', crateD: '#1a1418', song: 'l5', boss: 'ОМЕГА', bossSub: 'ПОСЛЕДНЯЯ МАШИНА' },
  { name: 'КЛАДБИЩЕ ФЛОТА', base: '#1c202c', mid: '#2a3042', dark: '#0a0c14', top: '#3a4258', top2: '#7fdcff', glow: '#ff3b3b', plat: '#3a4258', platD: '#151924', crate: '#2e3446', crateD: '#141822', song: 'l6', boss: 'АБОРДАЖНИК', bossSub: 'ШТУРМОВОЙ БУР' },
  { name: 'ПОЯС АСТЕРОИДОВ', base: '#262330', mid: '#363244', dark: '#121018', top: '#4e4860', top2: '#ffb06a', glow: '#ff7a3a', plat: '#4e4860', platD: '#1a1722', crate: '#3a3448', crateD: '#18151e', song: 'l7', boss: 'ЛИНКОР', bossSub: 'ФЛАГМАН ФЛОТА' },
  { name: 'ГОРИЗОНТ СОБЫТИЙ', base: '#1e1830', mid: '#2c2346', dark: '#0e0a1a', top: '#463868', top2: '#c89bff', glow: '#ffb04a', plat: '#463868', platD: '#181226', crate: '#33284c', crateD: '#151022', song: 'l8', boss: 'ПОЖИРАТЕЛЬ', bossSub: 'ЧЁРНАЯ ДЫРА' },
];

// конфигурация уровней: длина, эпизоды и особенности
const LVCFG = [
  { cols: 470, zones: { chase: [86, 356, 'bike'] } },
  { cols: 260, zones: { lock: [124, 'spider'] } },
  { cols: 290, zones: { lock: [128, 'waves'] } },
  { cols: 330, zones: { chase: [76, 196, 'avalanche'] }, ice: true, wind: true },
  { cols: 340, zones: { chase: [98, 216, 'space'] }, grav: 0.62, lgrid: true, breach: true },
  { cols: 330, zones: { lock: [64, 'train'] }, belts: true, pistons: true },
  { cols: 300, zones: { lock: [150, 'airlock'] }, flip: true, dark: true },
  { cols: 400, ship: true, zones: { chase: [0, 400, 'ship'] }, trench: [236, 322], swap: 196 },
  { cols: 330, zones: { planets: [112, 206] }, wells: true, grav: 0.85 },
];
const NLEVELS = LVCFG.length;
function genLevel(n) {
  const cfg = LVCFG[n];
  if (cfg.ship) return genShip(n, cfg);
  const rng = mulberry(7919 + n * 1013);
  const r = (a, b) => a + rng() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1));
  const cols = cfg.cols, AR = 30, total = cols + AR, rows = 17;
  const zones = cfg.zones;
  const ch = zones.chase, lk = zones.lock, pz = zones.planets;
  const inZone = c => (ch && c >= ch[0] - 3 && c <= ch[1] + 3) || (lk && c >= lk[0] - 3 && c <= lk[0] + 33) || (pz && c >= pz[0] - 4 && c <= pz[1] + 4);
  const flatZone = c => inZone(c) && !(ch && ch[2] === 'avalanche');
  const tiles = []; for (let y = 0; y < rows; y++) tiles.push(new Uint8Array(total));
  const gnd = new Int16Array(total);
  let g = 13, seg = 0;
  for (let c = 0; c < total; c++) {
    if (c < 18 || c >= cols - 10 || flatZone(c)) { gnd[c] = 13; g = 13; seg = Math.max(seg, 4); continue; }
    seg--;
    if (seg <= 0) {
      const roll = rng();
      if (roll < 0.2 && c > 24) {
        const pw = ch && ch[2] === 'avalanche' && inZone(c) ? 2 : ri(2, 3);
        let k = 0;
        for (; k < pw && c + k < cols - 10 && !flatZone(c + k + 3); k++) gnd[c + k] = -1;
        c += k - 1; seg = ri(6, 10); continue;
      } else if (roll < 0.55) { g = clamp(g + (rng() < 0.5 ? -1 : 1), 11, 14); seg = ri(6, 14); }
      else seg = ri(5, 12);
    }
    gnd[c] = g;
  }
  // космос: пустота без опоры, лететь на ранцах
  if (ch && ch[2] === 'space') for (let c = ch[0] + 6; c < ch[1] - 1; c++) gnd[c] = -1;
  if (pz) for (let c = pz[0]; c < pz[1]; c++) gnd[c] = -1;
  // поезд: вагоны на высоте 11 с просветами
  const trainCols = new Set();
  if (lk && lk[1] === 'train') {
    const c0 = lk[0], pattern = [9, 2, 9, 2, 8];
    let c = c0;
    pattern.forEach((len, i) => { for (let k = 0; k < len; k++, c++) { if (i % 2 === 0) { gnd[c] = 11; trainCols.add(c); } else gnd[c] = -1; } });
  }
  for (let c = 0; c < total; c++) {
    if (gnd[c] < 0) continue;
    if (trainCols.has(c)) { tiles[11][c] = 7; for (let y = 12; y <= 14; y++) tiles[y][c] = 8; continue; }
    for (let y = gnd[c]; y < rows; y++) tiles[y][c] = 1;
  }
  // потолок, стены и лампы: магнитные ботинки
  let cg = null; const lamps = [], walls = [];
  if (cfg.flip) {
    cg = new Int8Array(total);
    let h = 3, sg = 0;
    for (let c = 0; c < total; c++) {
      if (c < 14 || c >= cols - 10 || inZone(c)) { cg[c] = 3; h = 3; sg = 3; continue; }
      sg--;
      if (sg <= 0) {
        const rr = rng();
        if (rr < 0.07 && c > 30 && !inZone(c + 4)) { cg[c] = 0; cg[c + 1] = 0; c += 1; sg = ri(9, 14); continue; }
        else if (rr < 0.5) { h = clamp(h + (rng() < 0.5 ? -1 : 1), 2, 4); sg = ri(6, 12); }
        else sg = ri(5, 10);
      }
      cg[c] = h;
    }
    for (let c = 0; c < total; c++) for (let y = 0; y < cg[c]; y++) tiles[y][c] = 1;
    let side = 1;
    for (let c = 36; c < cols - 18; c += ri(26, 34)) {
      let ok = true;
      for (let j = -3; j <= 4; j++) { const cc = c + j; if (inZone(cc) || gnd[cc] < 0 || !cg[cc]) ok = false; }
      if (!ok) continue;
      for (const cc of [c, c + 1]) {
        if (side > 0) for (let y = gnd[cc] - 4; y < gnd[cc]; y++) tiles[y][cc] = 1;
        else for (let y = cg[cc]; y < cg[cc] + 4; y++) tiles[y][cc] = 1;
      }
      walls.push({ c, side }); side = -side;
    }
    const LC = ['#ffd9a0', '#7fdcff', '#ff4a4a', '#ffd9a0'];
    for (let c = 8; c < total - 2; c += ri(8, 12)) if (cg[c] > 0 && isSolid(tiles[cg[c] - 1][c]) && tiles[cg[c]][c] === 0) lamps.push({ x: c * T + 8, y: cg[c] * T, col: LC[ri(0, 3)], fl: rng() < 0.3 });
  }
  // лёд и конвейеры на верхнем ряду
  if (cfg.ice || cfg.belts) for (let c = 20; c < cols - 12;) {
    if (rng() < 0.35 && gnd[c] > 0 && !trainCols.has(c)) {
      const len = ri(5, 11), kind = cfg.ice ? 4 : (rng() < 0.5 ? 5 : 6);
      for (let k = 0; k < len && c + k < cols - 12; k++) if (gnd[c + k] > 0 && !trainCols.has(c + k) && !(lk && inZone(c + k))) tiles[gnd[c + k]][c + k] = kind;
      c += len + ri(6, 14);
    } else c += ri(3, 8);
  }
  // ящики-укрытия
  for (let c = 22; c < cols - 12; c++) {
    if (inZone(c)) continue;
    if (gnd[c] > 0 && gnd[c - 1] === gnd[c] && gnd[c + 1] === gnd[c] && rng() < 0.05 && tiles[gnd[c] - 1][c] === 0) {
      tiles[gnd[c] - 1][c] = 3;
      if (rng() < 0.35 && gnd[c + 1] === gnd[c]) { tiles[gnd[c] - 1][c + 1] = 3; if (rng() < 0.5) tiles[gnd[c] - 2][c] = 3; }
      c += 4;
    }
  }
  // мостки
  for (let c = 20; c < cols - 12;) {
    if (ch && inZone(c)) { c += 4; continue; }
    if (lk && lk[1] === 'train' && inZone(c)) { c += 4; continue; }
    if (rng() < (cfg.flip ? 0.25 : 0.5) && gnd[c] > 0) {
      const len = ri(3, 6), row = gnd[c] - ri(4, 5);
      if (row > 5) for (let k = 0; k < len; k++) if (tiles[row][c + k] === 0 && tiles[row + 1][c + k] === 0) tiles[row][c + k] = 2;
      c += len + ri(4, 9);
    } else c += ri(3, 7);
  }
  // ловушки уровня (их состояние зависит только от времени уровня)
  const hz = [];
  const flatAt = c => gnd[c] > 0 && gnd[c - 1] === gnd[c] && gnd[c + 1] === gnd[c] && !inZone(c) && tiles[gnd[c] - 1][c] === 0;
  if (cfg.lgrid) for (let c = 30; c < cols - 14; c += ri(22, 32)) if (flatAt(c)) hz.push({ k: 'lgrid', x: c * T + 8, gy: gnd[c] * T, per: 3.2, on: 1.3, ph: r(0, 3.2) });
  if (cfg.breach) for (let c = 50; c < cols - 20; c += ri(70, 110)) if (!inZone(c)) hz.push({ k: 'breach', x: c * T + 8, per: 8, act: 2.6, ph: r(0, 8) });
  if (cfg.pistons) for (let c = 34; c < cols - 14; c += ri(24, 34)) if (flatAt(c)) hz.push({ k: 'piston', x: c * T + 8, gy: gnd[c] * T, per: 3.0, ph: r(0, 3) });
  // враги
  const spawns = [];
  const TABLES = [
    [['runner', 4], ['turret', 2], ['drone', 2], ['leaper', 1], ['sniper', 1], ['kamikaze', 1]],
    [['runner', 4], ['turret', 2], ['drone', 3], ['leaper', 2], ['heavy', 1.5], ['shield', 1.5], ['bomber', 1], ['sniper', 1.5], ['kamikaze', 1.5]],
    [['runner', 4], ['turret', 2.5], ['drone', 3], ['leaper', 2], ['heavy', 2.5], ['shield', 2], ['bomber', 1.5], ['sniper', 1.5], ['kamikaze', 2]],
    [['runner', 3], ['turret', 1.5], ['drone', 2], ['leaper', 1.5], ['sniper', 1.5], ['kamikaze', 1.5], ['shield', 1.5], ['yeti', 2], ['skier', 2]],
    [['runner', 3], ['turret', 2], ['drone', 2.5], ['shield', 1.5], ['sniper', 1.5], ['jet', 2.5], ['mine', 1.5], ['kamikaze', 1]],
    [['runner', 3], ['heavy', 2], ['shield', 2], ['sniper', 2], ['kamikaze', 2], ['turret', 2], ['jet', 2], ['bomber', 1.5], ['drone', 2], ['yeti', 1]],
    [['runner', 3], ['crawler', 3.5], ['cturret', 1.5], ['turret', 1.5], ['drone', 2], ['shield', 1.5], ['heavy', 1.5], ['kamikaze', 1.5], ['sniper', 1]],
    [['runner', 1]],
    [['runner', 3], ['turret', 2], ['drone', 2], ['jet', 2], ['shield', 1.5], ['sniper', 1.5], ['heavy', 1.5], ['mine', 1], ['kamikaze', 1.5], ['crawler', 1.5]],
  ];
  const table = TABLES[n];
  const tw = table.reduce((s, x) => s + x[1], 0);
  let c = 26;
  while (c < cols - 12) {
    if (inZone(c)) { c++; continue; }
    let roll = rng() * tw, type = table[0][0];
    for (const [ty, w] of table) { if (roll < w) { type = ty; break; } roll -= w; }
    if (type === 'runner') { const k = ri(2, 3 + Math.min(n, 3)); for (let i = 0; i < k; i++) spawns.push({ x: (c + i * 1.3) * T, type }); }
    else if (type === 'drone' || type === 'jet' || type === 'mine') { const k = ri(1, 2 + (n > 0 ? 1 : 0)); for (let i = 0; i < k; i++) spawns.push({ x: (c + i * 2) * T, type, y: r(type === 'mine' ? 60 : 36, type === 'mine' ? 160 : 100) }); }
    else if (type === 'crawler') spawns.push({ x: c * T, type, ceil: !!cfg.flip && rng() < 0.6 });
    else spawns.push({ x: c * T, type });
    c += ri(7, 12) - Math.min(n, 2) - (n >= 3 ? 1 : 0);
  }
  for (let cc = 40; cc < cols - 10; cc += ri(30, 42)) if (!inZone(cc)) spawns.push({ x: cc * T, type: 'carrier' });
  spawns.sort((a, b) => a.x - b.x);
  const Z = {};
  if (ch) Z.chase = { x0: ch[0] * T, x1: ch[1] * T, mode: ch[2] };
  if (lk) Z.lock = { x: lk[0] * T, kind: lk[1] };
  if (pz) Z.planets = { x0: pz[0] * T, x1: pz[1] * T };
  const extra = genExtra(n, cfg, { rng, r, ri, tiles, gnd, cols, total, inZone, spawns, Z, pz });
  spawns.sort((a, b) => a.x - b.x);
  return Object.assign({ n, tiles, gnd, total, cols, rows, spawns, arenaX: cols * T, zones: Z, hz, grav: cfg.grav || 1, cfg, cg, lamps, walls }, extra);
}
const LVCACHE = {};
const getLevel = n => LVCACHE[n] || (LVCACHE[n] = genLevel(n));

function tileAt(c, r) { const L = G.lv; if (!L) return 0; if (c < 0 || c >= L.total) return 1; if (r < 0 || r >= L.rows) return 0; return L.tiles[r][c]; }
const isSolid = t => t === 1 || t === 3 || t === 4 || t === 5 || t === 6 || t === 7;
const solidPx = (x, y) => isSolid(tileAt(Math.floor(x / T), Math.floor(y / T)));
function groundTopL(L, x) { const c = Math.floor(x / T); if (!L || c < 0 || c >= L.total) return null; let r = 0; while (r < L.rows && isSolid(L.tiles[r][c])) r++; for (; r < L.rows; r++) if (isSolid(L.tiles[r][c])) return r * T; return null; }
function groundTop(x) { return groundTopL(G.lv, x); }
function ceilBot(x) { const c = Math.floor(x / T), L = G.lv; if (!L || c < 0 || c >= L.total) return null; let r = 0; while (r < L.rows && isSolid(L.tiles[r][c])) r++; return r > 0 && r < L.rows ? r * T : null; }
function findCeilX(x) { for (let k = 0; k < 40; k++) { const xx = x + k * 8, a = ceilBot(xx); if (a !== null && ceilBot(xx + 14) === a) return xx; } return x; }
function findGroundX(x) { for (let k = 0; k < 40; k++) { const xx = x + k * 8; if (groundTop(xx) !== null && groundTop(xx + 10) !== null) return xx; } return x; }

function moveBody(b, dt, useGrav) {
  const gd = b.gd || 1;
  if (useGrav !== false) { const v = b.vy + GRAV * ((G.lv && G.lv.grav) || 1) * gd * dt; b.vy = gd > 0 ? Math.min(v, 560) : Math.max(v, -560); }
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
    for (let c = l; c <= rr; c++) { const t = tileAt(c, row); if (isSolid(t) || (gd > 0 && t === 2 && prevBot <= row * T + 0.5 && !(b.dropT > 0))) { b.y = row * T - b.h; b.vy = 0; if (gd > 0) b.onGround = true; break; } }
  } else {
    const row = Math.floor(b.y / T);
    for (let c = l; c <= rr; c++) if (isSolid(tileAt(c, row))) { b.y = (row + 1) * T; b.vy = 0; if (gd < 0) b.onGround = true; break; }
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
const WNAME = { B: 'БЛАСТЕР', S: 'ВЕЕР', L: 'ЛАЗЕР', H: 'РАКЕТЫ', F: 'ОГНЕМЁТ', M: 'МОЛНИЯ', D: 'ДИСК', G: 'ГРАВИГРАНАТА', K: 'ПЛАЗМЕННАЯ КОСА' };
const WLET = { S: 'В', L: 'Л', H: 'Р', F: 'О', M: 'М', D: 'Д', G: 'Г', K: 'К', '+': '+' };
const WCOL = { B: '#ffe066', S: '#ff6ad5', L: '#4ff3ff', H: '#ffa53a', F: '#ff7a2a', M: '#b49bff', D: '#9dff5a', G: '#5affd1', K: '#ff4a7a', '+': '#5dff7a' };
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
  lt: 0, windF: 0, wind: null, iceT: 6, bgScroll: 0, chaseMode: '', windBase: 0, pullF: 0, ship: null, sings: [], tether: 0,
};
let V = G; // то, что рисуем: у хоста и в одиночной игре это сам G, у гостя — снимок от хоста

const FXS = { parts: [], texts: [], shake: 0, flash: 0, amb: [], bolts: [], ab: 0, slashes: [] };
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
    case 'z': FXS.bolts.push({ pts: ev.pts, life: 0.12 }); if (FXS.bolts.length > 12) FXS.bolts.shift(); break;
    case 'a': FXS.ab = Math.max(FXS.ab || 0, ev.v); break;
    case 'sl': FXS.slashes.push({ x: ev.x, y: ev.y, a: ev.a, r: ev.r, c: ev.c, life: 0.16 }); if (FXS.slashes.length > 8) FXS.slashes.shift(); break;
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
  if (s >= 4) FXS.ab = Math.max(FXS.ab, 0.35);
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
  for (let i = FXS.bolts.length - 1; i >= 0; i--) { FXS.bolts[i].life -= dt; if (FXS.bolts[i].life <= 0) FXS.bolts.splice(i, 1); }
  FXS.shake = Math.max(0, FXS.shake - dt * 22);
  FXS.flash = Math.max(0, FXS.flash - dt * 2.5);
  FXS.ab = Math.max(0, FXS.ab - dt * 2.4);
  for (let i = FXS.slashes.length - 1; i >= 0; i--) { FXS.slashes[i].life -= dt; if (FXS.slashes[i].life <= 0) FXS.slashes.splice(i, 1); }
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
  if (p.x < L) { p.x = L; if (G.chase && overlapSolid(p)) unstuck(p); }
  if (p.x > R) p.x = R;
}
function hzPhase(h) { return (((G.lt + h.ph) % h.per) + h.per) % h.per; }
function tileUnder(p) {
  const row = Math.floor((p.y + p.h + 1) / T);
  const t1 = tileAt(Math.floor((p.x + 2) / T), row), t2 = tileAt(Math.floor((p.x + p.w - 2) / T), row);
  return isSolid(t1) ? t1 : t2;
}
// внешние силы: ветер, разгерметизация, конвейер
function envPush(p) {
  let f = 0;
  const L = G.lv;
  if (G.windF) f += G.windF * (p.clamp ? 0.15 : (!p.onGround && L && L.cfg && L.cfg.flip) ? 1.4 : 1);
  if (L && L.wells) for (const w of L.wells) { const dx = w.x - (p.x + p.w / 2), dy = w.y - (p.y + p.h / 2), d = Math.hypot(dx, dy); if (d < w.r) f += Math.sign(dx) * w.f * (1 - d / w.r) * 1.6; }
  if (L && L.hz) for (const h of L.hz) if (h.k === 'breach' && Math.abs(p.x - h.x) < 120 && hzPhase(h) < h.act) f += Math.sign(h.x - p.x) * 78;
  if (p.onGround) { const t = tileUnder(p); if (t === 5) f += 48; else if (t === 6) f -= 48; }
  return f;
}
function overlapSolid(b) {
  const c0 = Math.floor(b.x / T), c1 = Math.floor((b.x + b.w - 0.01) / T), r0 = Math.floor(b.y / T), r1 = Math.floor((b.y + b.h - 0.01) / T);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isSolid(tileAt(c, r))) return true;
  return false;
}
function unstuck(p) { for (let k = 0; k < 48 && overlapSolid(p); k++) p.y -= 1; if (p.vy > 0) p.vy = 0; }
function slamImpact(p) {
  shake(6); sfx('stomp');
  emit({ e: 'r', x: r1(p.x + 5), y: r1(p.y + p.h), c: palOf(p.id).scarf, v: 60 });
  emit({ e: 'u', x: r1(p.x + 5), y: r1(p.y + p.h) });
  const dm = 5 * (1 + 0.25 * p.perks.caliber) * (p.overT > 0 ? 2 : 1);
  const cx = p.x + p.w / 2, cy = p.y + p.h;
  for (const e of G.enemies) if (!e.dead && circRect(cx, cy, 52, e.x, e.y, e.w, e.h)) damageEnemy(e, dm, p, null);
  const b = G.boss;
  if (b && b.ready && !b.dead && !b.hidden) for (const pt of b.parts) { if (!pt.alive) continue; const r = bossPartRect(b, pt); if (circRect(cx, cy, 52, r.x, r.y, r.w, r.h)) damagePart(b, pt, dm, p); }
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
    if (p.orb || p.pl >= 0) { p.vx = 0; p.vy = 0; }
    else if (p.fly) { p.vx = G.chase ? G.chaseV : 0; p.vy = 0; moveBody(p, dt, false); }
    else { p.vx = 0; moveBody(p, dt); }
    clampToCam(p);
    if (p.y > H + 10) { p.x = findGroundX(Math.max(p.lastSafe.x, G.cam.x + 10)); p.y = (groundTop(p.x) || 200) - p.h - 1; p.vy = 0; }
    if (p.downT <= 0) downTimeout(p);
    return;
  }
  if (p.role) { updShipPlayer(p, I, dt); return; }
  if (p.orb || p.pl >= 0 || inOrbitZone(p)) { updOrbit(p, I, dt); return; }
  const mx = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  const lock = !!c.lock, flying = !!p.fly, gd = p.gd || 1;
  if (mx && p.dashT <= 0) p.facing = mx;
  setCrouch(p, !!(gd > 0 && !flying && !p.slam && c.down && p.onGround && mx === 0 && !lock && p.dashT <= 0 && !(G.chase && G.chaseMode === 'bike')));
  // прицел: 8 направлений, как в Контре (в полёте стик управляет полётом). На потолке «вверх» и «вниз» меняются местами
  const cu = gd > 0 ? c.up : c.down, cd = gd > 0 ? c.down : c.up;
  let ax = p.facing, ay = 0;
  if (lock) {
    ay = cu ? -1 : cd ? 1 : 0; ax = mx !== 0 ? mx : (ay !== 0 ? 0 : p.facing);
    if (cd && mx === 0 && !flying) { ax = p.facing; ay = 1; }
  } else if (flying) { ax = p.facing; ay = 0; }
  else if (cu) { ay = -1; ax = mx; }
  else if (cd) { if (p.onGround) { if (mx) { ax = mx; ay = 1; } else { ax = p.facing; ay = 0; } } else { ay = 1; ax = mx; } }
  if (ax === 0 && ay === 0) ax = p.facing;
  ay *= gd;
  const len = Math.hypot(ax, ay); p.ax = ax / len; p.ay = ay / len;
  p.clamp = !!(G.lv.cfg.flip && p.onGround && mx === 0 && cd && !flying);

  const prevBot = p.y + p.h;
  if (p.dashT > 0) {
    p.dashT -= dt; p.vx = p.dashDir * 285 + (G.chase ? G.chaseV : 0); p.vy = 0; moveBody(p, dt, false);
    if (Math.floor(p.dashT * 60) % 2 === 0) emit({ e: 'g', x: r1(p.x), y: r1(p.y), w: p.w, h2: p.h, c: palOf(p.id).scarf });
    if (p.perks.ghost && !PRED) for (const e of G.enemies) if (!e.dead && !p.dashHit.has(e) && overlap(p, e)) { p.dashHit.add(e); damageEnemy(e, 3, p, null); }
    if (flying) p.y = clamp(p.y, 6, H - 46);
  } else if (flying) {
    const sp = 115, my = (c.down ? 1 : 0) - (c.up ? 1 : 0), bx = G.chase ? G.chaseV : 0;
    p.vx += (bx + mx * sp - p.vx) * Math.min(1, dt * 8);
    p.vy += (my * sp - p.vy) * Math.min(1, dt * 8);
    if (pr.dash && p.dashCd <= 0) { p.dashT = 0.17; p.dashDir = mx || p.facing; p.facing = p.dashDir; p.dashCd = 0.85 * (p.perks.ghost ? 0.55 : 1); p.dashHit = new Set(); sfx('dash'); }
    moveBody(p, dt, false);
    if (p.hitX || overlapSolid(p)) { unstuck(p); p.y -= 2; p.vy = Math.min(p.vy, -60); }
    p.y = clamp(p.y, 6, H - 46); p.onGround = false;
    if (!(G.chase && G.chaseMode === 'space') && groundTop(p.x) !== null && groundTop(p.x + p.w) !== null) { p.fly = false; p.vy = 0; }
  } else {
    const speed = 96 * (p.overT > 0 ? 1.15 : 1);
    const base = (G.chase ? G.chaseV : 0) + envPush(p);
    const target = base + ((lock || p.crouch || p.slam) ? 0 : mx * speed * (G.chase ? 0.9 : 1));
    const onIce = p.onGround && tileUnder(p) === 4;
    p.vx += (target - p.vx) * Math.min(1, dt * (onIce ? 2.6 : p.onGround ? 18 : 10));
    if (pr.jump) p.jbuf = 0.12;
    if (p.slam) p.vy = Math.max(p.vy, 480);
    else if (p.jbuf > 0) {
      if (gd > 0 && c.down && p.onGround && standingOnPlatform(p)) { setCrouch(p, false); p.dropT = 0.25; p.jbuf = 0; p.onGround = false; p.y += 2; }
      else if (p.onGround || p.coyote > 0) {
        setCrouch(p, false);
        const boost = p.onHead;
        p.vy = (boost ? -445 : -335) * gd; p.jbuf = 0; p.coyote = 0; p.onGround = false; p.jumps = p.perks.dbl ? 1 : 0; sfx('jump');
        if (boost) { ftext(p.x + 5, p.y - 8, 'ПОДСАДКА!', '#5dff7a', 8); emit({ e: 'u', x: r1(p.x + 5), y: r1(p.y + p.h) }); }
      }
      else if (gd > 0 && c.down && pr.jump) { p.slam = true; p.jbuf = 0; p.vy = 480; p.vx = 0; sfx('dash'); }
      else if (G.lv.cfg.flip && pr.jump) flipGrav(p);
      else if (p.jumps > 0 && pr.jump) { p.vy = -300 * gd; p.jumps--; p.jbuf = 0; sfx('jump'); emit({ e: 'u', x: r1(p.x + 5), y: r1(p.y + p.h) }); }
    }
    if (!c.jump && p.vy * gd < -140 && !p.slam) p.vy = -140 * gd;
    if (pr.dash && p.dashCd <= 0 && !p.slam) {
      setCrouch(p, false);
      p.dashT = 0.17; p.dashDir = mx || p.facing; p.facing = p.dashDir; p.dashCd = 0.85 * (p.perks.ghost ? 0.55 : 1); p.dashHit = new Set(); sfx('dash');
    }
    moveBody(p, dt);
    // можно встать на голову напарнику и прыгнуть с неё выше
    p.onHead = 0;
    const q = gd > 0 && (PRED ? (G.predPlayers || []) : G.players).find(o => o.id !== p.id && alive(o) && !o.fly && !o.crouch && (o.gd || 1) > 0 && !o.role && !(o.pl >= 0));
    if (q && !p.onGround && p.vy >= 0 && Math.abs((p.x + p.w / 2) - (q.x + q.w / 2)) < 9 && prevBot <= q.y + 3 && p.y + p.h >= q.y) {
      p.y = q.y - p.h; p.vy = 0; p.onGround = true; p.onHead = 1;
    }
    if (p.slam && p.onGround) { p.slam = false; if (!PRED) slamImpact(p); }
  }
  if (p.onGround) { p.coyote = 0.09; if (p.dashT <= 0) p.jumps = p.perks.dbl ? 1 : 0; }
  if (!PRED) {
    if ((c.fire || (c.auto && !G.paused)) && p.fireCd <= 0) shoot(p);
    if (pr.sup && p.meter >= 100) activateOver(p);
  }
  if (G.chase && !flying) { p.facing = mx < 0 ? -1 : 1; if (!lock && !c.up && !c.down) { p.ax = p.facing; p.ay = 0; } }
  clampToCam(p);
  if (!p.fly && (p.y > H + 16 || (gd < 0 && p.y + p.h < -16))) { if (!PRED) pitFall(p); return; }
  if (!p.fly && gd > 0 && p.onGround && !p.onHead && groundTop(p.x - 3) !== null && groundTop(p.x + p.w + 3) !== null) { p.lastSafe.x = p.x; p.lastSafe.y = p.y + p.h; }
  if (Math.abs(p.vx - (G.chase ? G.chaseV : 0)) > 10 && p.onGround) p.animT += dt;
}
function flipGrav(p) {
  p.gd = -(p.gd || 1); p.vy = 90 * p.gd; p.jbuf = 0; p.slam = false;
  sfx('flip'); emit({ e: 'r', x: r1(p.x + 5), y: r1(p.y + p.h / 2), c: palOf(p.id).scarf, v: 30 });
}
function placeRespawn(p) {
  let x = G.cam.x + 50 + p.id * 30;
  if (!G.arena) x = findGroundX(x);
  if (G.arenaRight) x = Math.min(x, G.arenaRight - 40);
  p.x = x; p.y = -30; p.vx = 0; p.vy = 0; p.h = 22; p.crouch = false; p.hp = p.maxHp; p.invT = 3; p.downed = false; p.revive = 0; p.slam = false; p.gd = 1;
  if (G.lv.cfg.flip) { p.y = (groundTop(x) || 13 * T) - p.h - 40; }
  if (G.lv.planets && orbitRespawn(p)) return;
  p.fly = !!(G.chase && G.chaseMode === 'space'); if (p.fly) p.y = 100;
  p.bike = !!(G.chase && G.chaseMode === 'bike');
  p.lastSafe.x = x; p.lastSafe.y = 13 * T;
}
function pitFall(p) {
  hurtPlayer(p, true); p.gd = 1;
  if (G.lv.planets && orbitRespawn(p)) return;
  const x = findGroundX(Math.max(p.lastSafe.x, G.cam.x + 8));
  p.x = x; p.y = (groundTop(x) || 13 * T) - p.h - 40; p.vy = 0; p.vx = 0;
  if (!p.downed) p.invT = Math.max(p.invT, 2);
}
function hurtPlayer(p, ignoreInv) {
  if (p.role) { shipHurt(); return; }
  if (!alive(p)) return;
  if (!ignoreInv && (p.invT > 0 || p.dashT > 0 || p.overT > 0)) return;
  p.hp--; p.invT = 1.4; p.st.hurts++; p.tot.hurts++; shake(5); sfx('hurt'); spark(p.x + 5, p.y + 8, '#ff4a4a', 8);
  if (p.hp <= 0) downPlayer(p);
}
function downPlayer(p) {
  setCrouch(p, false); p.slam = false; p.gd = 1; p.clamp = false;
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
  let cx = p.x + p.w / 2, cy = p.y + (p.crouch ? 5 : 9);
  if (p.role === 'p') { cx = p.x + p.w - 2; cy = p.y + 7; } else if (p.role === 'g') { cx = p.x + 4; cy = p.y + 5; }
  else if ((p.gd || 1) < 0) cy = p.y + p.h - (p.crouch ? 5 : 9);
  const mx = cx + p.ax * 9, my = cy + p.ay * 9;
  const ang = Math.atan2(p.ay, p.ax);
  const add = (a, sp, dmg, o) => (p.st.shots++, p.tot.shots++, G.pbullets.push(Object.assign({ nid: NID++, x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, life: 1.2, type: w, owner: p, a, hit: null, pierce: 0, r: 2 }, o || {})));
  let snd = 'shootB';
  switch (w) {
    case 'S': { const n = lvl > 1 ? 7 : 5; for (let i = 0; i < n; i++) add(ang + (i - (n - 1) / 2) * 0.13, 300, 0.85 * dm, { life: 0.75 }); p.fireCd = 0.24 * rate; snd = 'shootS'; break; }
    case 'L': add(ang, 440, 3.2 * dm, { pierce: 99, life: 1.0 }); p.fireCd = (lvl > 1 ? 0.24 : 0.32) * rate; snd = 'shootL'; break;
    case 'H': { const n = lvl > 1 ? 2 : 1; for (let i = 0; i < n; i++) add(ang + (n > 1 ? (i ? 0.3 : -0.3) : 0), 230, 1.3 * dm, { life: 1.7 }); p.fireCd = 0.2 * rate; snd = 'shootH'; break; }
    case 'F': add(ang + rnd(-0.12, 0.12), 220, (lvl > 1 ? 0.6 : 0.45) * dm, { pierce: 99, life: lvl > 1 ? 0.5 : 0.38, r: 3 }); p.fireCd = 0.05 * rate; snd = 'shootF'; break;
    case 'M': { lightning(p, mx, my, ang, dm, lvl); p.fireCd = 0.19 * rate; snd = 'zap'; break; }
    case 'D': {
      const maxD = lvl > 1 ? 4 : 2, n = lvl > 1 ? 2 : 1;
      if (G.pbullets.filter(b => b.owner === p && b.type === 'D').length + n > maxD) { p.fireCd = 0.05; return; }
      for (let i = 0; i < n; i++) add(ang + (n > 1 ? (i ? 0.22 : -0.22) : 0), 300, 1.5 * dm, { pierce: 99, life: 2.4, r: 5, t: 0, back: false });
      p.fireCd = 0.3 * rate; snd = 'shootH'; break;
    }
    case 'G': add(ang, 250, 1.2 * dm, { life: 0.75, r: 4, grav: !(G.ship || G.lv.planets), lvl }); p.fireCd = (lvl > 1 ? 0.55 : 0.7) * rate; snd = 'shootH'; break;
    case 'K': scythe(p, cx, cy, ang, dm, lvl); p.fireCd = (lvl > 1 ? 0.2 : 0.26) * rate; snd = 'slash'; break;
    default: add(ang, 340, dm, { pierce: p.perks.pierce ? 1 : 0 }); p.fireCd = 0.13 * rate;
  }
  if (p.sfxT <= 0) { sfx(snd); p.sfxT = w === 'F' ? 0.1 : 0.06; }
}
// молния: бьёт ближайшего врага по направлению прицела и перескакивает на соседей
function lightning(p, mx, my, ang, dm, lvl) {
  const tg = [];
  for (const e of G.enemies) if (!e.dead && e.x + e.w > G.cam.x && e.x < G.cam.x + W) tg.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, e });
  const b = G.boss;
  if (b && b.ready && !b.dead && !b.hidden) for (const pt of b.parts) if (pt.alive) { const r = bossPartRect(b, pt); tg.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, pt }); }
  let best = null, bd = 175;
  for (const t of tg) { const d = Math.hypot(t.x - mx, t.y - my); let da = Math.atan2(t.y - my, t.x - mx) - ang; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; if (d < bd && Math.abs(da) < 0.62) { bd = d; best = t; } }
  const pts = [[r1(mx), r1(my)]];
  p.st.shots++; p.tot.shots++;
  if (!best) { pts.push([r1(mx + Math.cos(ang) * 60), r1(my + Math.sin(ang) * 60)]); emit({ e: 'z', pts }); return; }
  p.st.hits++; p.tot.hits++;
  const used = new Set(); let cur = best, k = 0, maxN = lvl > 1 ? 5 : 3;
  while (cur && k <= maxN) {
    used.add(cur); pts.push([r1(cur.x), r1(cur.y)]);
    const dmg = (k === 0 ? 1.8 : 1.25) * dm;
    if (cur.e) damageEnemy(cur.e, dmg, p, null); else damagePart(G.boss, cur.pt, dmg, p);
    let nx = null, nd = 85; for (const t of tg) { if (used.has(t)) continue; const d = Math.hypot(t.x - cur.x, t.y - cur.y); if (d < nd) { nd = d; nx = t; } }
    cur = nx; k++;
  }
  emit({ e: 'z', pts });
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
  if (G.boss && !G.boss.dead && G.boss.ready && !G.boss.hidden) for (const pt of G.boss.parts) if (pt.alive && !pt.shield) damagePart(G.boss, pt, dmg * 1.3, p);
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
    case 'yeti': e.w = 18; e.h = 24; e.hp = 14 + L * 1.5; e.score = 450; e.speed = 32 * d.eSpeed; e.cd = rnd(1.2, 2); e.charge = 0; e.stun = 0; break;
    case 'skier': e.w = 14; e.h = 16; e.hp = 4 + L * 0.5; e.score = 200; e.speed = 150 * d.eSpeed; e.shot = false; break;
    case 'asteroid': { const big = !(extra && extra.sz === 1); e.sz = big ? 2 : 1; e.w = e.h = big ? 22 : 12; e.hp = big ? 7 : 2; e.score = big ? 150 : 60; e.grav = false; e.rot = Math.random() * 6; e.vr = rnd(-3, 3); break; }
    case 'fighter': e.w = 18; e.h = 10; e.hp = 4 + L * 0.5; e.score = 200; e.grav = false; e.cd = rnd(0.8, 1.8); e.baseY = y; break;
    case 'mine': e.w = 10; e.h = 10; e.hp = 2; e.score = 80; e.grav = false; e.arm = 0; e.contact = false; e.baseY = y; break;
    case 'jet': e.w = 12; e.h = 20; e.hp = 6 + L; e.score = 300; e.grav = false; e.cd = rnd(1.4, 2.4); e.baseY = y; e.burst = 0; e.bt = 0; break;
    case 'crawler': e.w = 14; e.h = 10; e.hp = 4 + L * 0.4; e.score = 180; e.speed = rnd(38, 50) * d.eSpeed; e.cd = rnd(1.4, 2.4); break;
    case 'spider': e.w = 44; e.h = 28; e.hp = 95; e.score = 3000; e.mini = true; e.label = 'ПАУК'; e.mode = 'idle'; e.st = 1.4; e.legT = 0; e.n = 0; break;
  }
  if (type !== 'missile' && type !== 'carrier' && type !== 'asteroid') e.hp *= G.escale;
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
      case 'runner': case 'heavy': case 'leaper': case 'shield': case 'kamikaze': case 'yeti': case 'skier': {
        const x = findGroundX(Math.max(s.x, edge)); const gt = groundTop(x); if (gt === null) break;
        const h = { heavy: 26, leaper: 10, shield: 22, kamikaze: 10, yeti: 24, skier: 16 }[s.type] || 20;
        spawnEnemy(s.type, x, gt - h); break;
      }
      case 'sniper': { const x = findGroundX(s.x); const gt = groundTop(x); if (gt === null) break; spawnEnemy('sniper', x, gt - 20); break; }
      case 'crawler': {
        if (s.ceil) { const x = findCeilX(Math.max(s.x, edge)); const cb = ceilBot(x); if (cb === null) break; spawnEnemy('crawler', x, cb, { gd: -1 }); }
        else { const x = findGroundX(Math.max(s.x, edge)); const gt = groundTop(x); if (gt === null) break; spawnEnemy('crawler', x, gt - 10); }
        break;
      }
      case 'cturret': { const x = findCeilX(s.x); const cb = ceilBot(x); if (cb === null) break; spawnEnemy('turret', x, cb, { gd: -1 }); break; }
      default: if (spawnSpecial(s, edge)) break;
      case 'bomber': spawnEnemy('bomber', edge + 4, 30, { baseY: 30 }); break;
      case 'jet': spawnEnemy('jet', edge + 4, s.y, { baseY: s.y }); break;
      case 'mine': spawnEnemy('mine', Math.max(s.x, edge), s.y, { baseY: s.y }); break;
      case 'turret': { const x = findGroundX(s.x); const gt = groundTop(x); if (gt === null) break; spawnEnemy('turret', x, gt - 12); break; }
      case 'drone': { const dy = G.lv.cfg.flip ? Math.max(s.y, 86) : s.y; spawnEnemy('drone', edge + 4, dy, { baseY: dy }); break; }
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
        const py = (e.gd || 1) < 0 ? e.y + 8 : e.y + 4;
        if (p) { const ta = angTo(e.x + 7, py, p); let da = ta - e.aim; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; e.aim += clamp(da, -2.5 * dt, 2.5 * dt); }
        e.cd -= dt;
        if (e.cd <= 0 && p && Math.abs(p.x - e.x) < 300) { e.burst = G.level >= 2 ? 3 : G.level === 1 ? 2 : 1; e.bt = 0; e.cd = 1.9 * d.eFire; }
        if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0) { eShoot(e.x + 7 + Math.cos(e.aim) * 10, py + Math.sin(e.aim) * 10, e.aim, 120 * d.eSpeed); e.burst--; e.bt = 0.16; } }
        break;
      }
      case 'crawler': {
        const gdE = e.gd || 1;
        if (e.t < dt * 1.5 && p) e.facing = p.x < e.x ? -1 : 1;
        e.vx = e.facing * e.speed;
        moveBody(e, dt);
        if (e.onGround) {
          const ax = e.x + (e.facing > 0 ? e.w + 2 : -2);
          const sup = gdE > 0 ? (groundTop(ax) !== null && Math.abs(groundTop(ax) - (e.y + e.h)) < 2) : (ceilBot(ax) !== null && Math.abs(ceilBot(ax) - e.y) < 2);
          if (e.hitX || !sup) e.facing = -e.facing;
        }
        e.cd -= dt;
        if (p && e.cd <= 0 && Math.abs(p.x - e.x) < 240 && e.x > G.cam.x && e.x < G.cam.x + W) { e.cd = rnd(1.8, 2.8) * d.eFire; eShoot(e.x + 7, e.y + (gdE > 0 ? 2 : e.h - 2), angTo(e.x + 7, e.y + 5, p), 115 * d.eSpeed, 3); }
        break;
      }
      default: updSpecialEnemy(e, p, dt); break;
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
      case 'yeti': {
        if (e.stun > 0) { e.stun -= dt; e.vx = 0; moveBody(e, dt); break; }
        if (e.charge > 0) {
          e.charge -= dt; e.vx = e.facing * 235 * d.eSpeed; moveBody(e, dt);
          if (e.hitX) { e.charge = 0; e.stun = 1.1; shake(4); sfx('stomp'); }
          break;
        }
        if (e.stopT > 0) { e.stopT -= dt; e.vx = 0; moveBody(e, dt); if (e.stopT <= 0) { e.charge = 0.85; sfx('dash'); } break; }
        if (p) e.facing = p.x < e.x ? -1 : 1;
        e.vx = e.facing * e.speed; if (e.onGround && e.hitX) e.vy = -300;
        moveBody(e, dt);
        e.cd -= dt;
        if (p && e.cd <= 0 && Math.abs(p.x - e.x) < 220 && Math.abs(p.y + p.h - (e.y + e.h)) < 24 && e.x > G.cam.x && e.x < G.cam.x + W) { e.stopT = 0.55; e.cd = rnd(2.4, 3.4) * d.eFire; sfx('warn'); }
        break;
      }
      case 'skier': {
        e.vx = -e.speed;
        if (e.onGround) { const ahead = e.x - 6; if (e.hitX || groundTop(ahead) === null) e.vy = -320; }
        moveBody(e, dt);
        if (!e.shot && p && e.x < G.cam.x + W * 0.75) { e.shot = true; eShoot(e.x, e.y + 6, angTo(e.x, e.y + 6, p), 140 * d.eSpeed, 3); }
        e.facing = -1;
        break;
      }
      case 'asteroid': e.x += (e.vx || 0) * dt; e.y += (e.vy || 0) * dt; e.rot += e.vr * dt; break;
      case 'fighter': {
        e.x += (G.chase ? G.chaseV - 75 : (e.rev ? 75 : -75) * d.eSpeed) * dt; e.y = e.baseY + Math.sin(e.t * 3 + (e.nid % 5)) * 26;
        e.cd -= dt;
        if (p && e.cd <= 0 && e.x < G.cam.x + W - 10) { eShoot(e.x, e.y + 5, angTo(e.x, e.y + 5, p), 125 * d.eSpeed + (G.chase ? G.chaseV * 0.5 : 0), 3); e.cd = rnd(1.6, 2.4) * d.eFire; }
        break;
      }
      case 'mine': {
        e.x += (G.chase ? G.chaseV - 25 : 0) * dt; e.y = e.baseY + Math.sin(e.t * 2 + e.nid) * 6;
        if (e.arm > 0) { e.arm -= dt; if (e.arm <= 0) { blast(e.x + 5, e.y + 5, 32); killEnemy(e, null, true); } break; }
        if (p && Math.hypot(p.x + 5 - (e.x + 5), p.y + p.h / 2 - (e.y + 5)) < 40) { e.arm = 0.5; sfx('warn'); }
        break;
      }
      case 'jet': {
        if (p) { e.facing = p.x < e.x ? -1 : 1; const tx = p.x + (e.facing > 0 ? -150 : 150) + ((e.nid % 5) - 2) * 22; e.x += clamp(tx - e.x, -60 * dt, 60 * dt); }
        if (G.chase) e.x += G.chaseV * dt;
        e.y = e.baseY + Math.sin(e.t * 2.2) * 8;
        e.cd -= dt;
        if (e.cd <= 0 && p && e.x > G.cam.x && e.x < G.cam.x + W) { e.burst = 3; e.bt = 0; e.cd = 2.4 * d.eFire; }
        if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0 && p) { eShoot(e.x + 6 + e.facing * 8, e.y + 8, angTo(e.x + 6, e.y + 8, p), 130 * d.eSpeed, 3); e.burst--; e.bt = 0.14; } }
        break;
      }
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
    const far = e.x + e.w < G.cam.x - 70 || e.x > G.cam.x + W + 220 || e.y > H + 30 || e.y < -120;
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
  if (e.type === 'asteroid' && e.sz === 2) for (let k = 0; k < 2; k++) spawnEnemy('asteroid', e.x + 5, e.y + 5, { sz: 1, vx: (e.vx || 0) + rnd(-30, 30), vy: k ? -40 : 40 });
}
function dropPickup(x, y) {
  const hurt = G.players.some(p => alive(p) && p.hp < p.maxHp);
  const pool = ['S', 'S', 'L', 'L', 'H', 'H', 'F', 'F'].concat(G.level >= 3 ? ['M', 'M', 'D', 'D', 'M', 'D'] : ['M', 'D']).concat(G.level >= 6 ? ['G', 'G', 'K', 'K', 'G', 'K'] : []).concat(hurt ? ['+', '+', '+'] : ['+']);
  G.pickups.push({ nid: NID++, kind: pick(pool), x, y, w: 12, h: 12, vx: 0, vy: -140, t: 0 });
}
function updPickups(dt) {
  for (const k of G.pickups) {
    k.t += dt;
    if (G.ship) { k.vy *= Math.pow(0.05, dt); k.x += 18 * dt; k.y = clamp(k.y + k.vy * dt, 10, H - 20); } else moveBody(k, dt);
    if (k.y > H) k.t = 99;
    for (const p of G.players) {
      if (!alive(p) || k.t >= 99 || !overlap(p, k)) continue;
      k.t = 99; sfx('pickup');
      if (k.kind === '+' && G.ship) {
        if (G.ship.hp < G.ship.max) { G.ship.hp++; ftext(p.x + 5, p.y - 8, '+1 ♥ КОРАБЛЮ', '#5dff7a', 9); } else { G.score += 500; ftext(p.x + 5, p.y - 8, '+500', '#5dff7a', 8); }
      } else if (k.kind === '+') {
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
      if (G.boss && G.boss.ready && !G.boss.dead && !G.boss.hidden) for (const pt of G.boss.parts) { if (!pt.alive) continue; const r = bossPartRect(G.boss, pt); const dx = r.x + r.w / 2 - b.x, dy = r.y + r.h / 2 - b.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; tgt = { x: r.x + r.w / 2, y: r.y + r.h / 2 }; } }
      if (tgt) { const ta = Math.atan2(tgt.y - b.y, tgt.x - b.x), a = Math.atan2(b.vy, b.vx); let da = ta - a; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283; const na = a + clamp(da, -7 * dt, 7 * dt), sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp; }
    }
    if (b.type === 'F') { b.r += dt * 14; b.vx *= 0.975; b.vy *= 0.975; }
    if (b.type === 'G' && b.grav) b.vy += GRAV * 0.55 * ((G.lv && G.lv.grav) || 1) * dt;
    if ((G.lv.wells || G.lv.planets || (G.boss && G.boss.kind === 8)) && b.type !== 'D' && bendBullet(b, dt, true)) { b.life = 0; spark(b.x, b.y, WCOL[b.type] || '#fff', 2); continue; }
    if (b.type === 'D') {
      b.t += dt;
      if (!b.back && (b.t > 0.42 || solidPx(b.x + b.vx * dt, b.y + b.vy * dt))) { b.back = true; b.hit = null; }
      if (b.back) {
        const o = b.owner, ox = o.x + o.w / 2, oy = o.y + o.h / 2, dx = ox - b.x, dy = oy - b.y, d = Math.hypot(dx, dy) || 1;
        b.vx = dx / d * 340; b.vy = dy / d * 340;
        if (d < 12 || !alive(o)) { b.life = 0; continue; }
      } else { b.vx *= 0.985; b.vy *= 0.985; }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.type !== 'D' && solidPx(b.x, b.y)) { b.life = 0; spark(b.x, b.y, WCOL[b.type], 2); continue; }
    if (b.type !== 'D' && (b.x < G.cam.x - 20 || b.x > G.cam.x + W + 20 || b.y < -20 || b.y > H + 20)) { b.life = 0; continue; }
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
    if (bs && bs.ready && !bs.dead && !bs.hidden) for (const pt of bs.parts) {
      if (!pt.alive || (b.hit && b.hit.has(pt))) continue;
      const r = bossPartRect(bs, pt);
      if (circRect(b.x, b.y, b.r, r.x, r.y, r.w, r.h)) {
        if (!b.counted && b.owner) { b.counted = true; b.owner.st.hits++; b.owner.tot.hits++; }
        damagePart(bs, pt, b.dmg, b.owner, b);
        if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = new Set())).add(pt); } else { b.life = 0; break; }
      }
    }
  }
  for (const b of G.pbullets) if (b.life <= 0 && b.type === 'G' && !b.done) { b.done = true; makeSing(b); }
  G.pbullets = G.pbullets.filter(b => b.life > 0);
}
function blast(x, y, r) {
  boom(x, y, 2); sfx('boom'); shake(4);
  for (const p of G.players) if (alive(p) && circRect(x, y, r, p.x, p.y, p.w, p.h)) hurtPlayer(p);
}
function updEBullets(dt) {
  for (const b of G.ebullets) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.grav) b.vy += GRAV * 0.55 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if ((G.lv.wells || G.lv.planets || (G.boss && G.boss.kind === 8)) && bendBullet(b, dt, false)) { b.life = 0; continue; }
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
    if (bm.kind === 'rot') bm.a += bm.va * dt;
    for (const p of G.players) {
      if (!alive(p)) continue;
      if (bm.kind === 'h') { if (p.y < bm.y + bm.hh && p.y + p.h > bm.y - bm.hh && p.x + p.w > bm.x1 && p.x < bm.x2) hurtPlayer(p); }
      else {
        if (bm.kind === 'rot') { bm.tx = bm.ox + Math.cos(bm.a) * 100; bm.ty = bm.oy + Math.sin(bm.a) * 100; }
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
    if (w.t > 0) continue;
    if (w.k === 'ice') G.ebullets.push({ nid: NID++, kind: 'icicle', x: w.x, y: -14, vx: 0, vy: 240, r: 4, life: 4, grav: true });
    else if (w.k === 'drock') G.ebullets.push({ nid: NID++, kind: 'rock', x: G.cam.x - 8, y: w.y, vx: 210, vy: 0, r: 6, life: 4, noTile: true });
    else if (w.k === 'gantry') G.ebullets.push({ nid: NID++, kind: 'gantry', x: G.cam.x + W + 24, y: 11 * T - 24, hw: 8, hh: 10, vx: -360, vy: 0, life: 3, noTile: true, r: 0 });
    else G.ebullets.push({ nid: NID++, kind: 'rock', x: w.x, y: -12, vx: 0, vy: 260, r: 6, life: 4, grav: true });
  }
  G.warns = G.warns.filter(w => w.t > 0);
}

// ───────────────────────── боссы ─────────────────────────
function bossTarget(b) { return nearestPlayer(b.x + b.w / 2, b.y + b.h / 2) || { x: G.cam.x + W / 2, y: 180, w: 10, h: 22 }; }
function makeBoss(n) {
  if (n >= 6) return makeBoss3(n);
  if (n >= 3) return makeBoss2(n);
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
  G.arena = true; if (!G.ship) G.cam.x = G.lv.arenaX;
  G.enemies = G.enemies.filter(e => e.x > G.cam.x - 10 && e.x < G.cam.x + W + 10);
  G.boss = makeBoss(G.level); G.bossIntroT = 2.8; sfx('alarm'); setSong(G.level === 8 ? 'final2' : G.level >= 6 ? 'boss3' : G.level === 5 ? 'final' : G.level >= 3 ? 'boss2' : 'boss');
}
function damagePart(b, pt, dmg, p, bl) {
  if (!pt.alive || b.dead || !b.ready || b.hidden) return;
  if (pt.shield || (b.kind === 2 && pt.core && b.phase === 1)) { sfx('clink'); if (bl) spark(bl.x, bl.y, '#7ff0ff', 2); return; }
  if (b.kind === 6 && pt.core && !(b.open > 0)) { dmg *= 0.3; if (bl && Math.random() < 0.3) spark(bl.x, bl.y, '#9aa1b2', 1); }
  pt.hp -= dmg; if (pt.flash < -0.12) pt.flash = 0.05; sfx('hit');
  if (p) { p.st.dmg += dmg; p.tot.dmg += dmg; }
  if (bl) spark(bl.x, bl.y, '#fff', 2);
  if (p) p.meter = Math.min(100, p.meter + dmg * 1.2 * (1 + 0.5 * p.perks.magnet));
  if (pt.hp <= 0) {
    pt.hp = 0; pt.alive = false;
    const r = bossPartRect(b, pt); boom(r.x + r.w / 2, r.y + r.h / 2, pt.core ? 4 : 3); sfx('bigboom'); shake(pt.core ? 8 : 5);
    if (b.kind === 2 && !pt.core) {
      G.score += 2000; ftext(r.x + r.w / 2, r.y - 6, '+2000', '#ffd04a', 9);
      if (!b.parts.some(q => !q.core && q.alive)) { b.phase = 2; flash(0.3); ftext(b.x + 40, b.y + 70, 'ЯДРО ОТКРЫТО!', '#ff6a3a', 12); }
    } else if (b.kind === 4 && !pt.core) { G.score += 400; ftext(r.x + 8, r.y - 4, '+400', '#ffd04a', 8); }
    else if (b.kind === 5 && !pt.core) {
      G.score += pt.fist ? 3000 : 600; ftext(r.x + r.w / 2, r.y - 6, pt.fist ? '+3000' : '+600', '#ffd04a', 9);
      if (b.form === 1 && !b.parts.some(q => q.fist && q.alive)) omegaForm2(b);
    } else if (b.kind === 6 && !pt.core) { G.score += 1500; ftext(r.x + r.w / 2, r.y - 6, '+1500', '#ffd04a', 9); }
    else if (b.kind === 7 && !pt.core) { G.score += 800; ftext(r.x + r.w / 2, r.y - 6, '+800', '#ffd04a', 9); }
    else if (b.kind === 8 && !pt.core) {
      G.score += 1200; ftext(r.x + r.w / 2, r.y - 6, '+1200', '#ffd04a', 9);
      if (b.phase === 1 && !b.parts.some(q => q.feed != null && q.alive)) { b.phase = 2; b.state = 'idle'; b.st = 1.2; flash(0.4); shake(8); ftext(b.hx, b.hy + 50, 'ГОРИЗОНТ ОТКРЫЛСЯ! БЕЙ В СЕРДЦЕ', '#ffb04a', 11); sfx('alarm'); }
    }
    else { bossDie(b); return; }
    emit({ e: 'a', v: 0.5 });
  }
  const hp = pt.hp / pt.max;
  if ((b.kind === 0 || b.kind === 1) && b.phase === 1 && hp < 0.5) { b.phase = 2; flash(0.25); shake(6); ftext(b.x + b.w / 2, b.y - 10, 'ЯРОСТЬ!', '#ff4a4a', 12); sfx('alarm'); }
  if (b.kind === 2 && pt.core && b.phase === 2 && hp < 0.35) { b.phase = 3; flash(0.25); ftext(b.x + 40, b.y + 70, 'ПЕРЕГРЕВ!', '#ffffff', 12); sfx('alarm'); }
  if (b.kind === 3 && b.phase < 3 && hp < (b.phase === 1 ? 0.6 : 0.3)) { b.phase++; flash(0.2); ftext(b.x + 15, b.y - 10, b.phase === 2 ? 'ЧЕРВЬ ЗЛИТСЯ!' : 'ЛЕДЯНОЙ ДОЖДЬ!', '#9fe3ff', 11); sfx('alarm'); }
  if (b.kind === 4 && pt.core && b.phase === 1 && hp < 0.5) { b.phase = 2; flash(0.25); ftext(b.x + 60, b.y - 4, 'КОЛЬЦО УСКОРЯЕТСЯ!', '#9fe6ff', 11); sfx('alarm'); }
  if (b.kind === 6 && pt.core && b.phase === 1 && hp < 0.5) { b.phase = 2; flash(0.25); shake(6); ftext(b.x + 40, b.y + 60, 'АБОРДАЖНИК В ЯРОСТИ!', '#ff4a4a', 11); sfx('alarm'); }
  if (b.kind === 7 && pt.core && b.phase === 1 && hp < 0.5) { b.phase = 2; flash(0.25); shake(6); ftext(r0x(b, pt), 70, 'РЕАКТОР ПЕРЕГРЕТ!', '#ffb06a', 11); sfx('alarm'); }
  if (b.kind === 8 && pt.core && b.phase === 2 && hp < 0.4) { b.phase = 3; b.state = 'idle'; b.st = 1; b.pulse = 0; flash(0.35); shake(8); ftext(b.hx - 120, 70, 'ДЫРА ВТЯГИВАЕТ ВСЁ! ДЕРЖИСЬ', '#ff6a3a', 11); sfx('alarm'); }
  if (b.kind === 5 && pt.core && b.form === 2 && b.phase === 2 && hp < 0.4) { b.phase = 3; flash(0.3); ftext(b.x + 20, b.y - 10, 'ПОСЛЕДНИЙ РЫВОК ОМЕГИ!', '#ff3b5a', 12); sfx('alarm'); }
}
function bossDie(b) {
  b.dead = true; b.deathT = 2.6; b.boomT = 0; G.slow = 1.4; emit({ e: 'a', v: 1 });
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
    if (b.boomT <= 0) { b.boomT = 0.09; const ex = b.ex != null ? b.ex : b.x, ew = b.ew != null ? b.ew : b.w, ey = b.ey != null ? b.ey : b.y + (b.rise || 0) * 200, eh = b.eh != null ? b.eh : b.h; boom(ex + rnd(0, ew), ey + rnd(0, eh), rint(2, 4)); if (Math.random() < 0.4) sfx('boom'); shake(5); }
    if (b.deathT <= 0) {
      G.boss = null; G.bossDone = true; G.arenaRight = 0; G.state = 'clear'; G.clearT = 0; setSong('win'); saveBest();
      const un = Math.min(NLEVELS - 1, G.level + 1); if (un > G.unlock) { G.unlock = un; save('unlock', un); }
    }
    return;
  }
  if (G.bossIntroT > 0) G.bossIntroT -= dt;
  if (b.kind === 0) boss0(b, dt); else if (b.kind === 1) boss1(b, dt); else if (b.kind === 2) boss2(b, dt);
  else if (b.kind === 3) boss3(b, dt); else if (b.kind === 4) boss4(b, dt); else if (b.kind === 5) boss5(b, dt);
  else if (b.kind === 6) boss6(b, dt); else if (b.kind === 7) boss7(b, dt); else boss8(b, dt);
  if (b.ready && b.kind <= 1 && !(b.kind === 1 && b.state === 'sweep' && (b.sub === 0 || b.sub === 3))) {
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

// ───────────────────────── боссы главы 2 ─────────────────────────
function makeBoss2(n) {
  const ax = G.lv.arenaX, bs = G.bscale, gy = 13 * T;
  if (n === 3) {
    const hp = 210 * bs;
    return { kind: 3, name: 'ЧЕРВЬ', x: ax + W / 2, y: H + 60, w: 30, h: 30, gy, face: -1, state: 'enter', st: 2.2, sub: 0, n: 0, phase: 1, t: 0, ready: false, hidden: true, trail: [], mx: ax + W / 2, x0: 0, x1: 0, dur: 1.5, s: 0, hgt: 140, spat: false, parts: [{ id: 'head', ox: 0, oy: 0, w: 30, h: 30, hp, max: hp, alive: true, flash: 0 }] };
  }
  if (n === 4) {
    const cx = ax + W - 110, cy = 112;
    const b = { kind: 4, name: 'СТРАЖ', x: cx - 60, y: cy - 60, w: 120, h: 120, gy, face: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, t: 0, ready: false, rot: 0, dir: 1, dirT: 4, rise: 1, parts: [] };
    for (let k = 0; k < 8; k++) b.parts.push({ id: 'pl' + k, ox: 0, oy: 0, w: 16, h: 16, hp: 24 * bs, max: 24 * bs, alive: true, flash: 0, plate: k });
    b.parts.push({ id: 'eye', ox: 42, oy: 42, w: 36, h: 36, hp: 230 * bs, max: 230 * bs, alive: true, flash: 0, core: true });
    return b;
  }
  const b = { kind: 5, name: 'ОМЕГА', x: ax + W - 160, y: 30, w: 150, h: 178, gy, face: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, form: 1, t: 0, ready: false, rise: 1, ang: 0, emit: 0, hT: 2, parts: [] };
  b.parts.push({ id: 'head', ox: 50, oy: 6, w: 48, h: 40, hp: 120 * bs, max: 120 * bs, alive: true, flash: 0, core: true, shield: true });
  b.parts.push({ id: 'fistL', ox: -14, oy: 112, w: 34, h: 30, hp: 75 * bs, max: 75 * bs, alive: true, flash: 0, fist: true, hx: -14, hy: 112, mode: 'idle', mt: 0 });
  b.parts.push({ id: 'fistR', ox: 92, oy: 124, w: 34, h: 30, hp: 75 * bs, max: 75 * bs, alive: true, flash: 0, fist: true, hx: 92, hy: 124, mode: 'idle', mt: 0 });
  G.arenaRight = b.x + 40;
  return b;
}
function boss3(b, dt) { // ЧЕРВЬ
  const ax = G.lv.arenaX, p = bossTarget(b), sp = b.phase === 1 ? 1 : b.phase === 2 ? 1.2 : 1.4, gy = b.gy;
  if (b.state === 'enter' || b.state === 'under') {
    b.hidden = true; b.st -= dt * sp;
    b.mx += clamp(p.x + p.w / 2 - b.mx, -95 * dt, 95 * dt);
    b.mx = clamp(b.mx, ax + 30, ax + W - 30);
    if (b.st < 0.9 && Math.random() < 0.3) shake(1.5);
    if (b.st <= 0 && G.bossIntroT <= 0) {
      b.state = 'erupt'; b.ready = true; b.hidden = false; b.s = 0; b.trail = [];
      b.x0 = b.mx; const dir = b.mx < ax + W / 2 ? 1 : -1;
      b.x1 = clamp(b.x0 + dir * rnd(150, 230), ax + 20, ax + W - 20);
      b.dur = 1.5 / sp; b.hgt = rnd(125, 160); b.spat = false;
      sfx('stomp'); shake(6); emit({ e: 'u', x: r1(b.x0), y: gy }); emit({ e: 'u', x: r1(b.x0 + 8), y: gy });
    }
    return;
  }
  b.s += dt / b.dur;
  const s = Math.min(1, b.s), x = b.x0 + (b.x1 - b.x0) * s, y = gy + 26 - 4 * b.hgt * s * (1 - s);
  b.face = b.x1 > b.x0 ? 1 : -1;
  b.x = x - b.w / 2; b.y = y - b.h / 2;
  b.trail.push([r1(x), r1(y)]); if (b.trail.length > 18) b.trail.shift();
  if (!b.spat && s >= 0.5 && b.phase >= 2) {
    b.spat = true; const a = angTo(x, y, p), k = b.phase >= 3 ? 3 : 2;
    for (let i = -k; i <= k; i++) G.ebullets.push({ nid: NID++, kind: 'shard', x, y, vx: Math.cos(a + i * 0.2) * 135, vy: Math.sin(a + i * 0.2) * 135, r: 3, life: 4 });
    sfx('shootS');
  }
  for (const q of G.players) {
    if (!alive(q)) continue;
    let hit = y < gy + 10 && overlap(q, { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 8 });
    if (!hit) for (let i = 0; i < b.trail.length; i += 2) { const [tx, ty] = b.trail[i]; if (ty < gy - 2 && circRect(tx, ty, 9, q.x, q.y, q.w, q.h)) { hit = true; break; } }
    if (hit) hurtPlayer(q);
  }
  if (s >= 1) {
    b.state = 'under'; b.hidden = true; b.st = rnd(0.9, 1.4); b.mx = b.x1; b.y = H + 60;
    emit({ e: 'u', x: r1(b.x1), y: gy }); shake(4);
    if (b.phase >= 3) for (let k = 0; k < 3; k++) G.warns.push({ x: rnd(ax + 20, ax + W - 20), t: 0.9 + k * 0.15, k: 'ice' });
  }
}
function boss4(b, dt) { // СТРАЖ
  const ax = G.lv.arenaX, P2 = b.phase > 1, cx = b.x + 60, cy = b.y + 60 + (b.rise || 0) * 200;
  if (P2) { b.dirT -= dt; if (b.dirT <= 0) { b.dirT = 4; b.dir = -b.dir; } }
  b.rot += 0.9 * dt * (P2 ? 1.8 : 1) * b.dir;
  for (const pt of b.parts) if (pt.plate !== undefined) { const a = b.rot + pt.plate * Math.PI / 4; pt.ox = 60 + Math.cos(a) * 48 - 8; pt.oy = 60 + Math.sin(a) * 48 - 8; }
  if (b.state === 'enter') { b.rise = Math.max(0, b.rise - dt * 0.5); if (b.rise <= 0 && G.bossIntroT <= 0) { b.state = 'idle'; b.st = 1; b.ready = true; } return; }
  switch (b.state) {
    case 'idle':
      b.st -= dt;
      if (b.st <= 0) {
        const s = chooseAttack(b, ['ring', 'beam', 'fighters', 'mines', 'ring', 'beam']);
        if (s === 'ring') { b.n = P2 ? 4 : 3; b.st = 0.2; }
        if (s === 'beam') { b.n = P2 ? 2 : 1; b.st = 0; }
        if (s === 'fighters' || s === 'mines') b.st = 0.4;
      }
      break;
    case 'ring':
      b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) { b.n--; b.st = 0.6; const k = P2 ? 20 : 16, off = Math.random(); for (let i = 0; i < k; i++) eShoot(cx, cy, (i + off) / k * 6.283, 85, 3); }
        else { b.state = 'idle'; b.st = 1.0; }
      }
      break;
    case 'beam':
      b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) { b.n--; const dir = Math.random() < 0.5 ? 1 : -1; G.beams.push({ kind: 'rot', ox: cx, oy: cy, a: dir > 0 ? Math.PI * 0.62 : Math.PI * 1.38, va: dir * 1.25, warn: 1.1, fire: 1.95, hint: 2 }); b.st = 3.3; }
        else { b.state = 'idle'; b.st = 0.8; }
      }
      break;
    case 'fighters':
      b.st -= dt;
      if (b.st <= 0) { for (let k = 0; k < 3; k++) spawnEnemy('fighter', ax + W + 10 + k * 24, 46 + k * 34, { baseY: 46 + k * 34 }); b.state = 'idle'; b.st = 1.2; }
      break;
    case 'mines':
      b.st -= dt;
      if (b.st <= 0) { for (let k = 0; k < 3; k++) { const y = rnd(60, 170); spawnEnemy('mine', ax + rnd(60, 300), y, { baseY: y }); } b.state = 'idle'; b.st = 1.2; }
      break;
  }
}
function boss5(b, dt) { // ОМЕГА
  const ax = G.lv.arenaX, p = bossTarget(b), gy = b.gy;
  if (b.state === 'enter') { b.rise = Math.max(0, b.rise - dt * 0.45); shake(1.5); if (b.rise <= 0 && G.bossIntroT <= 0) { b.state = 'idle'; b.st = 1.2; b.ready = true; } return; }
  if (b.form === 1) {
    const fists = b.parts.filter(q => q.fist);
    b.parts[0].shield = fists.some(q => q.alive);
    b.hT -= dt;
    if (b.hT <= 0) { b.hT = 2.2; const hx = b.x + 74, hy = b.y + 30, a = angTo(hx, hy, p); for (let i = -1; i <= 1; i++) eShoot(hx, hy, a + i * 0.2, 125, 4); }
    for (const f of fists) {
      if (!f.alive) continue;
      f.mt -= dt;
      const absX = () => b.x + f.ox, toward = (tx, ty, k) => { f.ox += (tx - b.x - f.ox) * Math.min(1, dt * k); f.oy += (ty - b.y - f.oy) * Math.min(1, dt * k); };
      switch (f.mode) {
        case 'idle': f.ox += (f.hx - f.ox) * Math.min(1, dt * 4); f.oy += (f.hy + Math.sin(b.t * 2 + f.hx) * 4 - f.oy) * Math.min(1, dt * 4); break;
        case 'rise': toward(f.tx, 20, 4); if (f.mt <= 0) { f.mode = 'hold'; f.mt = 0.5; } break;
        case 'hold': toward(f.tx, 20, 8); if (f.mt <= 0) { f.mode = 'drop'; f.vy = 0; } break;
        case 'drop':
          f.vy = (f.vy || 0) + 1400 * dt; f.oy += f.vy * dt;
          if (b.y + f.oy + f.h >= gy) { f.oy = gy - f.h - b.y; f.mode = 'back'; f.mt = 0.7; shake(9); sfx('stomp'); eWaveAt(absX() + 2, -1); eWaveAt(absX() + f.w - 2, 1); }
          break;
        case 'wind': f.ox += 30 * dt; if (f.mt <= 0) { f.mode = 'fly'; f.oy = gy - 44 - b.y; sfx('dash'); } break;
        case 'fly': f.ox -= 430 * dt; if (absX() < ax + 4) { f.mode = 'back'; f.mt = 0.9; shake(5); } break;
        case 'back': f.ox += (f.hx - f.ox) * Math.min(1, dt * 3); f.oy += (f.hy - f.oy) * Math.min(1, dt * 3); if (f.mt <= 0) f.mode = 'idle'; break;
      }
      const r = bossPartRect(b, f), inner = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 };
      for (const q of G.players) if (alive(q) && overlap(q, inner)) hurtPlayer(q);
    }
    b.st -= dt;
    if (b.st <= 0 && fists.every(f => !f.alive || f.mode === 'idle')) {
      const live = fists.filter(f => f.alive);
      if (live.length) {
        const f = pick(live), atk = pick(['slam', 'slam', 'punch']);
        if (atk === 'slam') { f.mode = 'rise'; f.mt = 0.7; f.tx = clamp(p.x - 12, ax + 10, b.x - 30); }
        else { f.mode = 'wind'; f.mt = 0.7; }
        b.st = live.length > 1 ? 1.6 : 1.1;
      }
    }
    return;
  }
  // форма 2 и 3: ядро летает с щитами-сферами
  const core = b.parts.find(q => q.core), orbs = b.parts.filter(q => q.orb !== undefined);
  const P3 = b.phase >= 3;
  b.ang += (P3 ? 3 : 2.2) * dt;
  orbs.forEach(o => { const a = b.ang + o.orb * Math.PI / 2; o.ox = 20 + Math.cos(a) * 36 - 7; o.oy = 20 + Math.sin(a) * 36 - 7; });
  core.shield = orbs.filter(o => o.alive).length >= 2;
  const cx = b.x + 20, cy = b.y + 20;
  if (b.state !== 'dive') { b.mvT = (b.mvT || 0) - dt; if (b.mvT <= 0) { b.mvT = rnd(2, 3); b.tx = rnd(ax + 40, ax + W - 80); b.ty = rnd(36, 90); } b.x += ((b.tx || b.x) - b.x) * Math.min(1, dt * 1.6); b.y += ((b.ty || b.y) - b.y) * Math.min(1, dt * 1.6); }
  switch (b.state) {
    case 'idle':
      b.st -= dt;
      if (b.st <= 0) {
        const s = chooseAttack(b, P3 ? ['spiral', 'walls', 'aimed', 'dive', 'walls'] : ['spiral', 'aimed', 'dive', 'summon']);
        if (s === 'spiral') { b.st = 2.2; b.emit = 0; }
        if (s === 'aimed') { b.n = 3; b.st = 0.3; }
        if (s === 'dive') { b.sub = 0; b.st = 0.8; }
        if (s === 'summon') b.st = 0.4;
        if (s === 'walls') { b.n = 4; b.st = 0.2; }
      }
      break;
    case 'spiral':
      b.st -= dt; b.emit -= dt;
      if (b.emit <= 0) { b.emit = P3 ? 0.06 : 0.08; b.sp = (b.sp || 0) + 0.37; const arms = P3 ? 3 : 2; for (let k = 0; k < arms; k++) eShoot(cx, cy, b.sp + k * 6.283 / arms, 85, 3); }
      if (b.st <= 0) { b.state = 'idle'; b.st = 0.9; }
      break;
    case 'aimed':
      b.st -= dt;
      if (b.st <= 0) { if (b.n > 0) { b.n--; b.st = 0.5; const a = angTo(cx, cy, p); for (let i = -3; i <= 3; i++) eShoot(cx, cy, a + i * 0.18, 120, 3); } else { b.state = 'idle'; b.st = 0.9; } }
      break;
    case 'summon':
      b.st -= dt;
      if (b.st <= 0) { spawnEnemy('kamikaze', ax - 10, gy - 10); spawnEnemy('kamikaze', ax + W + 10, gy - 10); b.state = 'idle'; b.st = 1.0; }
      break;
    case 'walls':
      b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) {
          b.n--; b.st = 1.15; const low = b.n % 2 === 0;
          for (let y = 18; y < gy - 2; y += 13) { const inWall = low ? y > gy - 30 : y < gy - 34; if (inWall) G.ebullets.push({ nid: NID++, kind: 'orb', x: ax + W + 6, y, vx: -150, vy: 0, r: 4, life: 5 }); }
          ftext(ax + W / 2, 40, low ? 'ПРЫГАЙ!' : 'ОСТАВАЙСЯ ВНИЗУ!', '#ff9a6a', 10);
        } else { b.state = 'idle'; b.st = 1.0; }
      }
      break;
    case 'dive':
      if (b.sub === 0) { b.x += (ax + W + 40 - b.x) * Math.min(1, dt * 3); b.y += (gy - 16 - 40 - b.y) * Math.min(1, dt * 3); b.st -= dt; if (b.st <= 0) { b.sub = 1; b.x = ax + W + 20; b.y = gy - 16 - 40; b.st = 1.0; } }
      else if (b.sub === 1) { b.st -= dt; if (Math.floor(b.st * 10) % 3 === 0) sfx('warn'); if (b.st <= 0) { b.sub = 2; sfx('dash'); } }
      else if (b.sub === 2) { b.x -= 340 * dt; if (b.x < ax - 60) { b.sub = 3; b.x = ax + W / 2; b.y = -60; } }
      else { b.y += (60 - b.y) * Math.min(1, dt * 2.5); if (Math.abs(b.y - 60) < 4) { b.state = 'idle'; b.st = 0.8; } }
      if (b.sub === 2) { const inner = { x: b.x + 4, y: b.y + 4, w: 32, h: 32 }; for (const q of G.players) if (alive(q) && overlap(q, inner)) hurtPlayer(q); }
      break;
  }
}
function omegaForm2(b) {
  const bs = G.bscale, ax = G.lv.arenaX;
  b.form = 2; b.phase = 2; b.wx = b.x; b.wy = b.y; b.torsoDead = 1;
  for (let k = 0; k < 8; k++) boom(b.x + rnd(0, b.w), b.y + rnd(0, b.h), 4);
  flash(0.5); shake(12); sfx('bigboom');
  b.x = ax + W - 130; b.y = 50; b.w = 40; b.h = 40; b.state = 'idle'; b.st = 1.5; b.tx = b.x; b.ty = b.y;
  b.parts = [{ id: 'core', ox: 0, oy: 0, w: 40, h: 40, hp: 170 * bs, max: 170 * bs, alive: true, flash: 0, core: true, shield: true }];
  for (let k = 0; k < 4; k++) b.parts.push({ id: 'orb' + k, ox: 0, oy: 0, w: 14, h: 14, hp: 22 * bs, max: 22 * bs, alive: true, flash: 0, orb: k });
  G.arenaRight = 0;
  ftext(ax + W / 2, 80, 'ОМЕГА ВЫРВАЛАСЬ! СБЕЙ СФЕРЫ', '#ff3b5a', 11);
}

// ───────────────────────── камера ─────────────────────────
function updateCamera(dt) {
  if (G.chaseMode === 'ship') {
    const b = G.boss;
    if (b && b.stopX != null) { if (G.cam.x >= b.stopX) { G.cam.x = b.stopX; G.chaseV = 0; b.atEnd = true; } else G.chaseV = 52; }
    G.cam.x = Math.min(G.cam.x + G.chaseV * dt, b && b.stopX != null ? b.stopX : 1e9);
    const S = G.ship, tr = G.lv.trenchX;
    if (S && tr && !S.trench && G.cam.x > tr[0] - W * 0.9) { S.trench = true; G.lockMsg = 'КАНЬОН! ДЕРЖИСЬ ПОСЕРЕДИНЕ'; G.lockMsgT = 2.4; sfx('alarm'); }
    if (!G.boss && !G.bossDone && G.cam.x >= G.lv.arenaX - W) startBoss();
    return;
  }
  if (G.arena || G.lock) return;
  const Z = G.lv.zones || {};
  if (G.chase) {
    G.cam.x += G.chaseV * dt;
    const endX = Z.chase.x1 - (Z.chase.mode === 'space' ? W * 0.45 : W);
    if (G.cam.x >= endX) { G.cam.x = endX; endChase(); }
    return;
  }
  const al = alivePlayers();
  if (al.length) {
    const avg = al.reduce((s, p) => s + p.x, 0) / al.length, minx = Math.min(...al.map(p => p.x));
    let target = Math.min(avg - W * 0.4, minx - 8);
    if (Z.lock && !G.lockDone) target = Math.min(target, Z.lock.x);
    if (target > G.cam.x) G.cam.x += (target - G.cam.x) * Math.min(1, dt * 6);
  }
  if (Z.chase && !G.chaseDone && G.cam.x >= Z.chase.x0 - (Z.chase.mode === 'space' ? W * 0.45 : 0)) { if (G.cam.x < Z.chase.x1 - W) startChase(); else G.chaseDone = true; }
  if (Z.lock && !G.lockDone && G.cam.x >= Z.lock.x - 2) { if (G.cam.x < Z.lock.x + W) startLock(); else G.lockDone = true; }
  if (G.cam.x >= G.lv.arenaX) startBoss();
}

// ───────────────────────── эпизоды: погоня и запертые зоны ─────────────────────────
function startChase() {
  const mode = G.lv.zones.chase.mode;
  G.chase = true; G.chaseDone = false; G.chaseMode = mode;
  G.chaseV = mode === 'avalanche' ? 135 : mode === 'space' ? 110 : mode === 'ship' ? 72 : 125;
  G.chaseT = { bar: 1.6, bik: 1.2, bomb: 6, cap: 5, ast: 0.6, ftr: 3, mine: 2.5, ice: 2.5, ski: 1.5 };
  G.players.forEach(p => { p.bike = mode === 'bike'; p.fly = (mode === 'space' && p.active && !p.out) || !!p.role; if (p.fly && !p.role) { p.vy = -60; p.slam = false; } });
  G.windF = 0; G.wind = null;
  G.lockMsg = mode === 'avalanche' ? 'ЛАВИНА! БЕГИ ВПЕРЁД!' : mode === 'space' ? 'РАНЦЫ ВКЛЮЧЕНЫ! ЛЕТИМ' : mode === 'ship' ? 'ВЗЛЁТ! ЛЕТИМ СКВОЗЬ ПОЯС' : 'ПОГОНЯ! ПРЫГАЙ ЧЕРЕЗ БАРЬЕРЫ';
  G.lockMsgT = 2.8; sfx('alarm');
}
function endChase() {
  G.chase = false; G.chaseDone = true;
  G.players.forEach(p => { p.bike = false; });
  G.lockMsg = G.chaseMode === 'avalanche' ? 'ЛАВИНА ПОЗАДИ' : G.chaseMode === 'space' ? 'ИДЁМ НА ПОСАДКУ' : 'ВЫРВАЛИСЬ!';
  G.lockMsgT = 1.8; sfx('confirm');
}
function updChase(dt) {
  if (G.chaseMode === 'ship') return;
  const T2 = G.chaseT, gy = 13 * T, np = G.players.filter(p => p.active && !p.out).length;
  for (const k in T2) T2[k] -= dt;
  if (T2.cap <= 0) { T2.cap = rnd(9, 12); spawnEnemy('carrier', G.cam.x + W + 10, 40, { baseY: 40 }); }
  if (G.chaseMode === 'avalanche') {
    for (const p of G.players) if (alive(p) && p.x < G.cam.x + 20) hurtPlayer(p);
    if (T2.ski <= 0) { T2.ski = rnd(1.6, 2.6) / (1 + 0.3 * (np - 1)); const x = G.cam.x + W + 10, gt = groundTop(x + 7); if (gt !== null) spawnEnemy('skier', x, gt - 16); }
    if (T2.ice <= 0) { T2.ice = rnd(2.2, 3.4); G.warns.push({ x: G.cam.x + rnd(220, W - 20), t: 1.0, k: 'ice' }); }
    return;
  }
  if (G.chaseMode === 'space') {
    if (T2.ast <= 0) { T2.ast = rnd(0.9, 1.5) / (1 + 0.25 * (np - 1)); spawnEnemy('asteroid', G.cam.x + W + 20, rnd(16, H - 70), { vx: G.chaseV - rnd(40, 90), vy: rnd(-15, 15) }); }
    if (T2.ftr <= 0) { T2.ftr = rnd(4, 5.5); const by = rnd(40, 150); for (let k = 0; k < 3; k++) spawnEnemy('fighter', G.cam.x + W + 20 + k * 26, by, { baseY: by }); }
    if (T2.mine <= 0) { T2.mine = rnd(3, 4.2); const y = rnd(30, H - 70); spawnEnemy('mine', G.cam.x + W + 10, y, { baseY: y }); }
    return;
  }
  if (T2.bar <= 0) { T2.bar = rnd(1.3, 2.3); spawnEnemy('barrier', G.cam.x + W + 12, gy - 18); }
  if (T2.bik <= 0) {
    T2.bik = rnd(2.0, 3.4) / (1 + 0.3 * (np - 1));
    if (G.enemies.filter(e => e.type === 'biker').length < 2 + np) {
      const behind = Math.random() < 0.35;
      spawnEnemy('biker', behind ? G.cam.x - 40 : G.cam.x + W + 30, gy - 20, { relX: behind ? rnd(30, 120) : rnd(300, 430) });
    }
  }
  if (T2.bomb <= 0) { T2.bomb = rnd(6, 9); spawnEnemy('bomber', G.cam.x + W + 20, 30, { baseY: 30 }); }
}
// ветер, сосульки и ловушки станции/цитадели
function updWorld(dt) {
  G.lt += dt;
  const L = G.lv, cfg = L.cfg || {};
  if (cfg.wind && !G.chase && !G.arena && !G.lock) {
    if (!G.wind) G.wind = { t: rnd(5, 8), dir: 0, warn: 0, gust: 0 };
    const w = G.wind;
    if (w.gust > 0) { w.gust -= dt; G.windBase = w.dir * 58; if (w.gust <= 0) { G.windBase = 0; w.t = rnd(7, 11); } }
    else if (w.warn > 0) { w.warn -= dt; if (w.warn <= 0) { w.gust = 3; sfx('wind'); } }
    else { w.t -= dt; if (w.t <= 0) { w.dir = Math.random() < 0.6 ? -1 : 1; w.warn = 1.2; G.lockMsg = w.dir < 0 ? '← ПОРЫВ ВЕТРА' : 'ПОРЫВ ВЕТРА →'; G.lockMsgT = 1.4; } }
    G.iceT -= dt;
    if (G.iceT <= 0) { G.iceT = rnd(6, 9); for (const p of alivePlayers()) G.warns.push({ x: p.x + rnd(-30, 70), t: 1.0, k: 'ice' }); }
  } else G.windBase = 0;
  if (L.hz && L.hz.length) for (const h of L.hz) {
    if (Math.abs(h.x - (G.cam.x + W / 2)) > W) continue;
    const s = hzPhase(h);
    if (h.k === 'lgrid' && s < h.on) for (const p of G.players) { if (alive(p) && p.x + p.w > h.x - 3 && p.x < h.x + 3 && p.y < h.gy) hurtPlayer(p); }
    if (h.k === 'piston') {
      if ((h.lastS || 0) < 2.3 && s >= 2.3 && s < 2.5) { shake(4); sfx('stomp'); }
      h.lastS = s;
      if (s >= 2.3 && s < 2.85) for (const p of G.players) { if (alive(p) && p.x + p.w > h.x - 14 && p.x < h.x + 14 && p.y < h.gy) hurtPlayer(p); }
    }
  }
}
function startLock() {
  const Z = G.lv.zones.lock;
  G.cam.x = Z.x; G.lock = { kind: Z.kind, wave: 0, t: Z.kind === 'spider' ? 0.5 : Z.kind === 'train' ? 45 : 1.2, gT: 3, eT: 2.5, jT: 7, hT: 10, cT: 8 };
  G.lockMsg = Z.kind === 'spider' ? 'МИНИ-БОСС: ПАУК' : Z.kind === 'train' ? 'БРОНЕПОЕЗД! ПРИГИБАЙСЯ ПОД МОСТАМИ' : Z.kind === 'airlock' ? 'АВАРИЙНЫЙ ШЛЮЗ · ДЕРЖИТЕСЬ' : 'ЗАСАДА! ТРИ ВОЛНЫ'; G.lockMsgT = 2.8; sfx('alarm');
  if (Z.kind === 'airlock') Object.assign(G.lock, { ph: 'calm', t: 5, cyc: 0, eT: 0.6 });
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
function trainX() { for (let k = 0; k < 12; k++) { const x = G.cam.x + rnd(40, W - 60); if (groundTop(x) !== null && groundTop(x + 10) !== null) return x; } return G.cam.x + 100; }
function updLock(dt) {
  const L = G.lock;
  L.t -= dt;
  if (L.kind === 'train') {
    G.bgScroll += 360 * dt;
    const np = G.players.filter(p => p.active && !p.out).length;
    L.gT -= dt; L.eT -= dt; L.jT -= dt; L.hT -= dt; L.cT -= dt;
    if (L.gT <= 0) { L.gT = rnd(3.6, 5.2); G.warns.push({ x: G.cam.x + W - 14, t: 1.0, k: 'gantry' }); }
    if (L.eT <= 0) { L.eT = rnd(2.2, 3.4); for (let k = 0; k < (np > 1 ? 2 : 1); k++) { const e = spawnEnemy('runner', trainX(), -24); e.wave = true; } }
    if (L.jT <= 0) { L.jT = rnd(6, 8); const y = rnd(50, 100); const e = spawnEnemy('jet', G.cam.x + W + 10, y, { baseY: y }); e.wave = true; }
    if (L.hT <= 0) { L.hT = rnd(9, 12); spawnEnemy('bomber', G.cam.x + W + 20, 30, { baseY: 30 }); }
    if (L.cT <= 0) { L.cT = rnd(9, 12); spawnEnemy('carrier', G.cam.x + W + 10, 40, { baseY: 40 }); }
    if (L.t <= 0) { for (const e of G.enemies) if (e.wave) killEnemy(e, null, true); endLock('ПОЕЗД ПРИБЫЛ!'); }
    return;
  }
  if (L.kind === 'spider') { if (L.t <= 0 && !G.enemies.some(e => e.mini && !e.dead)) endLock(); return; }
  if (L.kind === 'airlock') { updAirlock(L, dt); return; }
  if (G.enemies.some(e => e.wave && !e.dead)) return;
  if (L.t > 0) return;
  if (L.wave >= 3) { endLock(); return; }
  L.wave++; spawnWave(L.wave); L.t = 1.4;
  G.lockMsg = 'ВОЛНА ' + L.wave + ' / 3'; G.lockMsgT = 1.6; sfx('alarm');
}
function endLock(msg) {
  G.lock = null; G.lockDone = true;
  G.lockMsg = msg || 'ПРОХОД ОТКРЫТ →'; G.lockMsgT = 2; sfx('confirm');
  G.score += 3000; ftext(G.cam.x + W / 2, 100, '+3000', '#ffd04a', 11);
}

// ───────────────────────── ход игры ─────────────────────────
function setSong(name) { G.song = name; playSong(name); }
function saveBest() { if (G.score > G.best) { G.best = G.score; save('best', G.best); } }
function loadLevel(n) {
  G.level = n; G.lv = getLevel(n);
  G.enemies = []; G.pbullets = []; G.ebullets = []; G.pickups = []; G.beams = []; G.warns = [];
  G.boss = null; G.arena = false; G.arenaRight = 0; G.spawnIdx = 0; G.ambT = 5; G.combo = 0; G.cam.x = 0;
  G.bannerT = 3.2; G.bossIntroT = 0; G.wipeT = 0; G.hintT = (n === 0 || n >= 3) ? 12 : 0; G.paused = false; G.slow = 0;
  G.chase = false; G.chaseDone = false; G.lock = null; G.lockDone = false; G.lockMsgT = 0; G.stats.time = 0; G.stats.kills = 0;
  G.lt = 0; G.windF = 0; G.wind = null; G.iceT = 6; G.bgScroll = 0; G.chaseMode = ''; G.windBase = 0; G.pullF = 0; G.ship = null; G.sings = []; G.tether = 0; G.bossDone = false;
  const np = G.players.filter(p => p.active).length || 1;
  G.escale = (1 + 0.3 * (np - 1)) * G.d.eHp; G.bscale = (1 + 0.6 * (np - 1)) * G.d.bossHp;
  G.players.forEach((p, i) => {
    if (!p.active) return;
    p.out = false; p.downed = false; p.respawnT = 0; p.x = 40 + i * 26; p.y = 13 * T - 22; p.h = 22; p.vx = 0; p.vy = 0;
    p.hp = p.maxHp; p.invT = 1.5; p.lastSafe = { x: p.x, y: 13 * T }; p.dashT = 0; p.overT = 0; p.crouch = false; p.revive = 0;
    p.bike = false; p.fly = false; p.slam = false; p.st = newStats(); p.gd = 1; p.clamp = false; p.role = ''; p.w = 10; p.ang = 0; p.pl = -1; p.orb = false; p.lastPl = -1;
    if (p.perks.arsenal && p.weapon === 'B') { p.weapon = 'S'; p.wlvl = 1; }
  });
  setSong(THEMES[n].song);
  if (G.lv.cfg.ship) setupShip();
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
  if (G.ship) { p.respawnT = 0; assignRoles(); }
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
  if (!G.ship) updateRevive(dt);
  updateCamera(dt);
  if (!G.arena && !G.chase && !G.lock) { processSpawns(); updAmbient(dt); }
  else if (G.chaseMode === 'ship' && !G.boss) processSpawns();
  if (G.chase) updChase(dt);
  if (G.lock) updLock(dt);
  updWorld(dt);
  if (G.lockMsgT > 0) G.lockMsgT -= dt;
  if (G.ship) updShip(dt);
  if (G.lv.planets) updTether(dt);
  updEnemies(dt); updBoss(dt); updPBullets(dt); updEBullets(dt); updBeams(dt); updWarns(dt); updPickups(dt); updSings(dt);
  G.windF = (G.windBase || 0) + G.pullF; G.pullF = 0;
  if (G.state === 'play' && !G.ship) checkTeam(dt);
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
}
function updClear(dt) {
  G.clearT += dt;
  if (G.clearT > 1.5 && anyConfirm()) {
    sfx('confirm');
    if (G.level < NLEVELS - 1) setupPerks(); else { G.state = 'win'; G.clearT = 0; saveBest(); }
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
  p.gd = hp.gd || 1; p.clamp = !!hp.clamp; p.role = hp.role || ''; p.pl = hp.pl == null ? -1 : hp.pl; p.orb = !!hp.orb; p.lastPl = hp.lastPl == null ? -1 : hp.lastPl; p.ang = hp.ang || 0; p.th = hp.th || 0; p.vt = hp.vt || 0; p.tang = hp.tang || 0;
  return p;
}
function guestPrepWorld(v) {
  G.lv = getLevel(v.level); G.cam.x = v.cam.x; G.arenaRight = v.arenaRight || 0; G.chase = !!v.chase; G.chaseV = v.chaseV || 125; G.paused = false;
  G.lt = v.lt || 0; G.windF = v.windF || 0; G.chaseMode = v.chaseMode || ''; G.predPlayers = v.players;
  G.ship = v.ship ? Object.assign({ pred: true }, v.ship) : null;
}
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
    'bike', 'st', 'tot', 'dashDir', 'dashCd', 'jumps', 'coyote', 'jbuf', 'dropT', 'fireCd', 'pdbl', 'pgh', 'fly', 'slam', 'onHead', 'gd', 'clamp', 'role', 'ang', 'pl', 'th', 'vt', 'orb', 'tang', 'lastPl'],
  e: ['nid', 'type', 'x', 'y', 'w', 'h', 'vx', 'facing', 'flash', 'aim', 't', 'stopT', 'onGround', 'diving', 'mini', 'hp', 'maxHp', 'mode', 'label', 'legT', 'arm', 'sz', 'rot', 'charge', 'stun', 'gd'],
  b: ['nid', 'type', 'x', 'y', 'vx', 'vy', 'r', 'life'],
  eb: ['nid', 'kind', 'x', 'y', 'vx', 'vy', 'r', 'hw', 'hh'],
  pk: ['nid', 'kind', 'x', 'y', 't'],
  bm: ['kind', 'y', 'x1', 'x2', 'hh', 'ox', 'oy', 'tx', 'ty', 'warn', 'fire', 'hint', 'a'],
  wn: ['x', 't', 'k', 'y'],
  bo: ['kind', 'name', 'x', 'y', 'w', 'h', 'vx', 'gy', 'face', 'state', 'sub', 'phase', 't', 'legT', 'rot', 'rise', 'dead', 'deathT', 'ready', 'st', 'trail', 'mx', 'hidden', 'form', 'wx', 'wy', 'torsoDead', 'side', 'open', 'pull', 'stopX', 'hx', 'hy', 'ang', 'atEnd', 'pulse', 'ta'],
  pt: ['id', 'ox', 'oy', 'w', 'h', 'hp', 'max', 'alive', 'flash', 'core', 'shield', 'fist', 'plate', 'orb', 'mode', 'hx', 'hy', 'by', 'feed', 'tur'],
  sg: ['x', 'y', 't', 'r'],
};
const q2 = v => typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v === 'boolean' ? (v ? 1 : 0) : (v === undefined ? null : v);
const pack = (list, f) => list.map(o => f.map(k => q2(o[k])));
const unpack = (arr, f) => (arr || []).map(a => { const o = {}; f.forEach((k, i) => o[k] = a[i]); return o; });
function makeSnap() {
  const s = {
    t: 's', st: G.state, tm: q2(G.t), lv: G.level, df: G.diff, li: G.lives, sc: G.score, be: G.best, co: G.combo, pa: G.paused ? 1 : 0, mi: G.menuIdx,
    bn: q2(G.bannerT), bi: q2(G.bossIntroT), hi: q2(G.hintT), cx: q2(G.cam.x), ar: G.arena ? 1 : 0, arr: q2(G.arenaRight), so: G.song, p2: G.sel.p2 ? 1 : 0,
    ct: q2(G.clearT), sk: G.stats.kills, stt: q2(G.stats.time), pk: G.perk, wt: q2(G.wipeT),
    lk: G.lock ? { k: G.lock.kind, w: G.lock.wave, p: G.lock.ph, c: G.lock.cyc } : null,
    shp: G.ship ? [G.ship.hp, G.ship.max, q2(G.ship.inv), q2(G.ship.ta || 0)] : null, SG: pack(G.sings, NF.sg), te: q2(G.tether), lm: G.lockMsg, lmt: q2(G.lockMsgT), ch: G.chase ? 1 : 0, cv: G.chaseV,
    lo: G.looks, sr: G.selRow, sl: G.startLv, un: G.unlock, ah: G.awayHost ? 1 : 0, ag: G.awayGuest ? 1 : 0, ak: REM.ack,
    lt: q2(G.lt), wf: q2(G.windF), bsc: q2(G.bgScroll), cm: G.chaseMode,
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
    lock: d.lk ? { kind: d.lk.k, wave: d.lk.w, ph: d.lk.p, cyc: d.lk.c } : null,
    ship: d.shp ? { hp: d.shp[0], max: d.shp[1], inv: d.shp[2], ta: d.shp[3] } : null, sings: unpack(d.SG, NF.sg), tether: d.te || 0, lockMsg: d.lm || '', lockMsgT: d.lmt || 0, chase: !!d.ch, chaseV: d.cv || 125,
    looks: d.lo || G.looks, selRow: d.sr | 0, startLv: d.sl | 0, unlock: d.un | 0, awayHost: !!d.ah, awayGuest: !!d.ag,
    lt: d.lt || 0, windF: d.wf || 0, bgScroll: d.bsc || 0, chaseMode: d.cm || '',
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
    v.players = v.players.map(o => o.id !== 1 ? o : Object.assign({}, o, { x: q.x + PR.off.x, y: q.y + PR.off.y, vx: q.vx, vy: q.vy, facing: q.facing, ax: q.ax, ay: q.ay, crouch: q.crouch, h: q.h, w: q.w, onGround: q.onGround, animT: q.animT, dashT: q.dashT, bike: q.bike, gd: q.gd, clamp: q.clamp, ang: q.ang, pl: q.pl, orb: q.orb, tang: q.tang }));
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
  } else if (th === 2) {
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
  } else if (th === 3) {
    grad([[0, '#16233f'], [0.5, '#3f5f8f'], [1, '#a9c8e6']]);
    for (let i = 0; i < 40; i++) { sc.fillStyle = 'rgba(255,255,255,0.6)'; sc.fillRect(rng() * W, rng() * 90, 1, 1); }
    const far = mkCanvas(960, 170), fc = far.getContext('2d');
    for (let x = -40; x < 1000;) {
      const w = 90 + rng() * 120, h = 70 + rng() * 80, px = x + w / 2;
      fc.fillStyle = '#5a7398'; fc.beginPath(); fc.moveTo(x, 170); fc.lineTo(px, 170 - h); fc.lineTo(x + w, 170); fc.fill();
      fc.fillStyle = '#eaf4ff'; fc.beginPath(); fc.moveTo(px - h * 0.22, 170 - h * 0.7); fc.lineTo(px, 170 - h); fc.lineTo(px + h * 0.22, 170 - h * 0.7); fc.lineTo(px + h * 0.08, 170 - h * 0.62); fc.lineTo(px - h * 0.05, 170 - h * 0.72); fc.fill();
      x += w * 0.6 + rng() * 40;
    }
    layers.push({ c: far, sp: 0.1, y: 96 });
    const mid = mkCanvas(960, 120), mc = mid.getContext('2d');
    for (let x = 0; x < 960; x += 10 + rng() * 22) {
      const h = 30 + rng() * 60; mc.fillStyle = '#1e3048';
      for (let k = 0; k < 5; k++) { const ww = (5 - k) * 3 + 2; mc.fillRect(x - ww / 2, 120 - h + k * h / 5, ww, h / 5 + 1); }
      mc.fillStyle = '#d8e8f8'; mc.fillRect(x - 3, 120 - h + 2, 6, 2);
    }
    layers.push({ c: mid, sp: 0.32, y: 120 });
  } else if (th === 4) {
    grad([[0, '#02030a'], [0.7, '#070a1e'], [1, '#121a3a']]);
    for (let i = 0; i < 160; i++) { sc.fillStyle = rng() < 0.15 ? '#ffe6c0' : '#c8d8ff'; sc.globalAlpha = 0.3 + rng() * 0.7; sc.fillRect(rng() * W, rng() * H, 1, 1); }
    sc.globalAlpha = 1;
    const pg = sc.createRadialGradient(330, 70, 6, 350, 90, 70); pg.addColorStop(0, '#7fd0ff'); pg.addColorStop(0.6, '#2a6aa8'); pg.addColorStop(1, '#0a1a3a');
    sc.fillStyle = pg; sc.beginPath(); sc.arc(350, 90, 62, 0, 6.283); sc.fill();
    sc.strokeStyle = 'rgba(200,230,255,0.45)'; sc.lineWidth = 3; sc.beginPath(); sc.ellipse(350, 92, 100, 18, -0.2, 0, 6.283); sc.stroke();
    const far = mkCanvas(960, 140), fc = far.getContext('2d');
    for (let x = 0; x < 960; x += 120 + rng() * 120) {
      fc.fillStyle = '#1c2236'; fc.fillRect(x, 60 + rng() * 30, 50 + rng() * 40, 18); fc.fillRect(x + 20, 20 + rng() * 20, 8, 80);
      fc.fillStyle = '#2a3452'; for (let k = 0; k < 4; k++) fc.fillRect(x - 30 + k * 12, 40, 10, 28);
      fc.fillStyle = '#ffd04a'; fc.fillRect(x + 22, 18, 3, 3);
    }
    layers.push({ c: far, sp: 0.08, y: 40 });
    const mid = mkCanvas(960, 160), mc = mid.getContext('2d');
    mc.fillStyle = '#121624';
    for (let x = 0; x < 960; x += 60) { mc.fillRect(x, 20, 4, 140); for (let y = 20; y < 160; y += 20) { mc.fillRect(x, y, 60, 2); } }
    mc.fillStyle = '#1a2032'; for (let x = 0; x < 960; x += 60) for (let y = 20; y < 160; y += 20) { mc.beginPath(); mc.moveTo(x, y); mc.lineTo(x + 60, y + 20); mc.lineTo(x + 58, y + 20); mc.lineTo(x, y + 2); mc.fill(); }
    layers.push({ c: mid, sp: 0.3, y: 70 });
  } else if (th === 5) {
    grad([[0, '#14040a'], [0.55, '#3c0a16'], [1, '#7a1420']]);
    const far = mkCanvas(960, 230), fc = far.getContext('2d');
    for (let x = 0; x < 960;) {
      const w = 26 + rng() * 40, h = 90 + rng() * 120; fc.fillStyle = '#220810'; fc.fillRect(x, 230 - h, w, h);
      fc.fillRect(x - 4, 230 - h - 8, w + 8, 8); for (let k = 0; k < w; k += 8) fc.fillRect(x - 4 + k, 230 - h - 14, 4, 6);
      fc.fillStyle = '#ff3b5a'; fc.fillRect(x + w / 2 - 1, 230 - h + 10, 3, 3);
      fc.fillStyle = 'rgba(255,200,200,0.06)'; fc.beginPath(); fc.moveTo(x + w / 2, 230 - h); fc.lineTo(x + w / 2 - 60 + rng() * 120, 0); fc.lineTo(x + w / 2 - 30 + rng() * 120, 0); fc.fill();
      x += w + 30 + rng() * 70;
    }
    layers.push({ c: far, sp: 0.1, y: 40 });
    const mid = mkCanvas(960, 150), mc = mid.getContext('2d');
    mc.fillStyle = '#1a070d'; mc.fillRect(0, 70, 960, 80);
    for (let x = 0; x < 960; x += 40) { mc.fillRect(x, 50, 26, 22); }
    mc.fillStyle = '#2a0c14'; for (let x = 20; x < 960; x += 90) { for (let y = 0; y < 70; y += 6) mc.fillRect(x + (y % 12 ? 0 : 2), y, 4, 4); }
    layers.push({ c: mid, sp: 0.3, y: 120 });
  }
  else if (th >= 6) buildBG3(th, rng, sc, layers, grad);
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
  if (th === 3) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; const wf = V.windF || 0; for (const a of FXS.amb) { const y = ((a.y + tm * 40 * a.s) % H + H) % H, x = ((a.x - cx * 0.5 + Math.sin(tm + a.p) * 10 + tm * wf * 3 * a.s) % W + W) % W; ctx.fillRect(x, y, a.s > 0.7 ? 2 : 1, a.s > 0.7 ? 2 : 1); } if (wf) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (const a of FXS.amb.slice(0, 30)) { const x = ((a.x + tm * wf * 8) % W + W) % W; ctx.fillRect(x, a.y % H, 22, 1); } } }
  if (th === 4) { for (const a of FXS.amb.slice(0, 20)) { if (Math.sin(tm * 3 + a.p * 7) > 0.9) { ctx.fillStyle = '#ffffff'; ctx.fillRect(a.x, a.y * 0.8, 1, 1); } } }
  if (th === 5) { ctx.fillStyle = 'rgba(200,180,180,0.45)'; for (const a of FXS.amb.slice(0, 50)) { const y = ((a.y + tm * 22 * a.s) % H + H) % H, x = ((a.x - cx * 0.4 + Math.sin(tm + a.p) * 12) % W + W) % W; ctx.fillRect(x, y, 1, 1); } }
  if (th === 6) { ctx.fillStyle = 'rgba(180,200,230,0.25)'; for (const a of FXS.amb.slice(0, 40)) { const y = ((a.y + Math.sin(tm * 0.5 + a.p) * 10) % H + H) % H, x = ((a.x - cx * 0.6 * a.s + tm * 6 * a.s) % W + W) % W; ctx.fillRect(x, y, 1, 1); } }
  if (th === 7) { ctx.fillStyle = 'rgba(220,230,255,0.35)'; for (const a of FXS.amb.slice(0, 50)) { const x = ((a.x - cx * 1.2 * a.s) % W + W) % W; ctx.fillRect(x, a.y % H, 2 + a.s * 8, 1); } }
  if (th === 8) { for (const a of FXS.amb.slice(0, 30)) { if (Math.sin(tm * 3 + a.p * 7) > 0.85) { ctx.fillStyle = '#ffffff'; ctx.fillRect(a.x, a.y * 0.9, 1, 1); } } ctx.fillStyle = 'rgba(200,155,255,0.3)'; for (const a of FXS.amb.slice(40, 80)) { const x = ((a.x - cx * 0.7 - tm * 18 * a.s) % W + W) % W, y = (a.y + Math.sin(tm + a.p) * 8) % H; ctx.fillRect(x, y, 1, 1); } }
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
        if (L.n === 3 && h > 0.5) R(x + ((h * 90) | 0) % 12, y + 4, 2, 3 + ((h * 7) | 0) % 3, '#cfe8fa');
        if (L.n === 4) { R(x, y + 4, T, 1, (c % 4 === 0) ? th.glow : th.mid); }
        if (L.n === 5) { R(x, y + 4, T, 1, th.hazard); }
        if (L.n === 6) { R(x, y + 4, T, 1, c % 6 === 0 ? th.top2 : th.mid); if (c % 6 === 0) R(x + 7, y + 2, 2, 1, th.top2); }
        if (L.n === 7) { R(x, y + 4, T, 1, '#ff7a3a55'); if (c % 4 === 0) R(x + 2, y + 6, 12, 1, th.dark); }
        if (L.n === 8 && h > 0.55) { const cxx = x + ((h * 90) | 0) % 12; R(cxx, y - 3, 2, 3, '#c89bff'); R(cxx, y - 3, 1, 1, '#ffffff'); }
        if (L.zones && L.zones.chase && L.zones.chase.mode === 'bike' && x >= L.zones.chase.x0 && x < L.zones.chase.x1) { R(x, y + 4, T, 3, '#3a2a28'); if (c % 2) R(x + 2, y + 5, 10, 1, '#f0e0b0'); }
      }
      if (c > 0 && L.tiles[r][c - 1] === 0) R(x, y, 1, T, th.top2 + '66');
      if (L.n >= 6 && r < L.rows - 1 && L.tiles[r + 1][c] === 0) { R(x, y + T - 4, T, 4, th.top); R(x, y + T - 1, T, 1, '#05060a'); if (c % 5 === 2) R(x + 6, y + T - 3, 4, 1, th.top2); }
    } else if (t === 3) {
      R(x, y, T, T, th.crateD); R(x + 1, y + 1, T - 2, T - 2, th.crate); R(x + 2, y + 2, T - 4, T - 4, th.crateD);
      R(x + 3, y + 3, T - 6, T - 6, th.crate);
      for (let k = 0; k < 10; k++) { R(x + 3 + k, y + 3 + k, 1, 1, th.crateD); R(x + 12 - k, y + 3 + k, 1, 1, th.crateD); }
    } else if (t === 4) {
      R(x, y, T, T, th.base); R(x, y + T - 1, T, 1, th.dark);
      R(x, y, T, 5, th.ice || '#9fe3ff'); R(x, y, T, 1, '#ffffff'); R(x + ((c * 5) % 10), y + 2, 4, 1, '#e8fbff');
    } else if (t === 5 || t === 6) {
      R(x, y, T, T, th.base); R(x, y, T, 6, '#22262e'); R(x, y, T, 1, '#5a6478');
      const off = Math.floor((V.lt || 0) * 48) % 8, dir = t === 5 ? 1 : -1;
      for (let k = -8; k < T + 8; k += 8) { const xx = x + k + (dir > 0 ? off : -off); if (xx >= x && xx + 3 <= x + T) { R(xx, y + 2, 2, 2, '#ffd04a'); R(xx + (dir > 0 ? 2 : -1), y + 3, 1, 1, '#ffd04a'); } }
      R(x, y + 6, T, 1, '#111318');
    } else if (t === 7) {
      R(x, y, T, T, '#4a4f5e'); R(x, y, T, 2, '#8a92a8'); R(x, y + T - 2, T, 2, '#2a2e38');
      R(x + 3, y + 6, 2, 2, '#2a2e38'); R(x + 11, y + 6, 2, 2, '#2a2e38');
      if (c % 9 === 4) R(x + 2, y + 3, 12, 6, '#3a3f4c');
    } else if (t === 8) {
      R(x, y, T, T, '#2e3240'); R(x, y, T, 1, '#3e4456');
      if (r === 12 && c % 3 === 1) R(x + 3, y + 4, 10, 5, '#ffd04a55');
      if (r === 14) { R(x, y + T - 3, T, 3, '#1c1f2a'); }
    } else if (t === 2) {
      R(x, y, T, 4, th.plat); R(x, y, T, 1, th.top2); R(x, y + 4, T, 1, th.platD);
      for (let k = 0; k < 4; k++) { R(x + k * 4, y + 5 + (k % 2) * 2, 2, 2, th.platD); }
    }
  }
}
function drawHazards() {
  const L = V.lv; if (!L || !L.hz) return;
  const tm = V.lt || 0, cx = V.cam.x;
  for (const h of L.hz) {
    if (h.x < cx - 60 || h.x > cx + W + 60) continue;
    const s = (((tm + h.ph) % h.per) + h.per) % h.per;
    if (h.k === 'lgrid') {
      R(h.x - 5, 4, 10, 6, '#3a4252'); R(h.x - 5, h.gy - 6, 10, 6, '#3a4252');
      if (s < h.on) { ctx.globalAlpha = 0.35; R(h.x - 4, 10, 8, h.gy - 16, '#ff3fb4'); ctx.globalAlpha = 1; R(h.x - 1, 10, 2, h.gy - 16, '#ffd0f0'); }
      else if (h.per - s < 0.55 && Math.floor(tm * 20) % 2) R(h.x, 10, 1, h.gy - 16, '#ff3fb4');
      R(h.x - 2, 6, 4, 2, s < h.on ? '#ff3fb4' : '#5a2a48');
    } else if (h.k === 'breach') {
      const act = s < h.act, warn = !act && h.per - s < 1.2;
      ctx.fillStyle = '#05060c'; ctx.beginPath(); ctx.arc(h.x, 90, 18, 0, 6.283); ctx.fill();
      ctx.strokeStyle = act || (warn && Math.floor(tm * 8) % 2) ? '#ff3b3b' : '#5a6478'; ctx.lineWidth = 3; ctx.stroke();
      if (act) { ctx.strokeStyle = 'rgba(200,230,255,0.5)'; ctx.lineWidth = 1; for (let k = 0; k < 14; k++) { const ph = (tm * 3 + k * 0.37) % 1, side = k % 2 ? 1 : -1, x0 = h.x + side * (120 - ph * 110), y0 = 40 + (k * 37) % 160; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 - side * 14, y0 + (90 - y0) * 0.08); ctx.stroke(); } }
    } else if (h.k === 'piston') {
      let bot = 44;
      if (s >= 1.9 && s < 2.3) bot = 44 + (Math.floor(tm * 30) % 2);
      else if (s >= 2.3 && s < 2.4) bot = 44 + (h.gy - 44) * ((s - 2.3) / 0.1);
      else if (s >= 2.4 && s < 2.85) bot = h.gy;
      else if (s >= 2.85) bot = h.gy - (h.gy - 44) * ((s - 2.85) / 0.15);
      R(h.x - 18, 0, 36, 12, '#3a2e36'); R(h.x - 3, 12, 6, Math.max(0, bot - 28), '#7a6a72');
      R(h.x - 15, bot - 16, 30, 16, '#55474c'); R(h.x - 15, bot - 4, 30, 4, '#ff3b5a'); R(h.x - 13, bot - 14, 26, 2, '#7a6a72');
      if (s >= 1.9 && s < 2.3 && Math.floor(tm * 10) % 2) { const gt = h.gy; R(h.x - 14, gt - 2, 28, 2, '#ff3b3b'); }
    }
  }
}
function drawTrainDecor() {
  const off = (V.bgScroll || 0) % 12, y = 15 * T + 6, x0 = V.cam.x;
  R(x0, y - 2, W, 2, '#55474c'); R(x0, y + 8, W, 2, '#55474c');
  for (let x = -12; x < W + 12; x += 12) R(Math.round(x0 + x - off), y, 6, 8, '#2a2026');
  const L = V.lv;
  for (let c = Math.floor(x0 / T); c < Math.floor(x0 / T) + 32; c++) {
    if (L.tiles[14] && L.tiles[14][c] === 8 && c % 3 === 0) {
      const wx = c * T + 8, wy = 15 * T + 2, a = (V.bgScroll || 0) / 6;
      ctx.fillStyle = '#1a1a22'; ctx.beginPath(); ctx.arc(wx, wy, 6, 0, 6.283); ctx.fill();
      R(Math.round(wx + Math.cos(a) * 4) - 1, Math.round(wy + Math.sin(a) * 4) - 1, 2, 2, '#9aa1b2');
    }
  }
}
function drawAvalanche() {
  const x0 = V.cam.x, tm = V.t || 0;
  ctx.fillStyle = '#eef6ff';
  ctx.beginPath(); ctx.moveTo(x0 - 30, H);
  for (let y = H; y >= 20; y -= 10) ctx.lineTo(x0 + 16 + Math.sin(y * 0.09 + tm * 9) * 7 + (H - y) * 0.03, y);
  ctx.lineTo(x0 - 30, 20); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#cfe2f5'; for (let k = 0; k < 10; k++) { const yy = (k * 27 + tm * 90) % H; R(Math.round(x0 + 4 + Math.sin(tm * 7 + k) * 6), Math.round(yy), 6, 4, '#cfe2f5'); }
}
function drawPlayer(p, isMe) {
  if (!p.active || p.out || p.respawnT > 0) return;
  if (p.role) { if (p.role === 'p') drawShip(p, isMe); return; }
  const flip = (p.gd || 1) < 0, ang = p.ang || 0;
  if (!flip && !ang) return drawPlayerBody(p, isMe);
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  let q = p;
  ctx.save(); ctx.translate(cx, cy);
  if (ang) { ctx.rotate(ang); const c = Math.cos(-ang), s = Math.sin(-ang); q = Object.assign({}, p, { ax: p.ax * c - p.ay * s, ay: p.ax * s + p.ay * c }); }
  if (flip) { ctx.scale(1, -1); q = Object.assign({}, q, { ay: -q.ay }); }
  ctx.translate(-cx, -cy);
  try { drawPlayerBody(q, isMe); } finally { ctx.restore(); }
}
function drawPlayerBody(p, isMe) {
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
  if (p.fly && !p.downed) { const fl = Math.floor(tm * 24) % 2; R(x + (f > 0 ? -3 : 9), y + 7, 4, 8, '#5a6480'); R(x + (f > 0 ? -3 : 9), y + 15, 4, 3 + fl * 2, fl ? '#ffd04a' : '#ff6a2a'); R(x + (f > 0 ? -2 : 10), y + 18 + fl * 2, 2, 2, '#ff6a2a'); }
  if (p.slam) { ctx.globalAlpha = 0.5; R(x + 1, y - 12, 2, 10, P.scarf); R(x + 7, y - 16, 2, 14, P.scarf); ctx.globalAlpha = 1; }
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
    case 'yeti': {
      const fr = Math.floor((e.t || 0) * 6) % 2, ch = e.charge > 0;
      R(x + 3, y + 17, 5, 7 - fr, C('#cfdbe8')); R(x + 10, y + 17 + fr, 5, 7 - fr, C('#cfdbe8'));
      R(x + 1, y + 6, 16, 12, C('#e8f0f8')); R(x + 3, y + 8, 12, 6, C('#b9c8d8'));
      R(x + 3, y, 12, 8, C('#e8f0f8')); R(x + (f > 0 ? 8 : 4), y + 3, 6, 2, C(e.stopT > 0 || ch ? '#ff3b3b' : '#3fb6ff'));
      R(f > 0 ? x + 16 : x - 3, y + 8, 5, 8, C('#9aa8b8'));
      if (e.stun > 0 && Math.floor(tm * 10) % 2) R(x + 7, y - 4, 4, 2, '#ffd04a');
      break;
    }
    case 'skier': {
      R(x - 2, y + 15, 18, 1, C('#e8eef8')); R(x + 3, y + 11, 3, 4, C(EC.dark)); R(x + 8, y + 11, 3, 4, C(EC.dark));
      R(x + 2, y + 4, 10, 8, C('#3a8adf')); R(x + 3, y, 8, 5, C(EC.metal)); R(x + 3, y + 2, 4, 1, C(EC.eye));
      break;
    }
    case 'asteroid': {
      const s = e.w, cx = x + s / 2, cy = y + s / 2, rr = s / 2;
      ctx.fillStyle = e.flash > 0 ? '#fff' : '#5a4a44'; ctx.beginPath();
      for (let k = 0; k < 8; k++) { const a = e.rot + k * 0.785, rad = rr * (0.78 + 0.22 * hash(e.nid || 1, k)); k ? ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad) : ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill();
      R(Math.round(cx - rr * 0.3), Math.round(cy - rr * 0.3), Math.max(2, Math.round(rr * 0.4)), Math.max(2, Math.round(rr * 0.3)), C('#7a6a62'));
      break;
    }
    case 'fighter': {
      R(x + 2, y + 3, 16, 4, C('#6a5a80')); R(x, y + 4, 4, 2, C('#8a7aa0')); R(x + 6, y, 6, 3, C('#4a3a5e')); R(x + 6, y + 7, 6, 3, C('#4a3a5e'));
      R(x + 3, y + 4, 3, 2, C('#ff3b78')); R(x + 18, y + 4, 3, 2, Math.floor(tm * 20) % 2 ? '#7ff0ff' : '#3fb6ff');
      break;
    }
    case 'mine': {
      const lit = e.arm > 0 ? Math.floor(tm * 24) % 2 : Math.floor(tm * 3) % 2;
      R(x + 1, y + 1, 8, 8, C('#3a3036')); R(x + 4, y - 1, 2, 12, C('#55474c')); R(x - 1, y + 4, 12, 2, C('#55474c'));
      R(x + 4, y + 4, 2, 2, lit ? '#ff3b3b' : '#5a1a1a');
      if (e.arm > 0) { ctx.globalAlpha = 0.3; R(x - 6, y - 6, 22, 22, '#ff3b3b'); ctx.globalAlpha = 1; }
      break;
    }
    case 'jet': {
      R(x + 2, y + 13, 3, 6, C(EC.dark)); R(x + 7, y + 13, 3, 6, C(EC.dark));
      R(x + 1, y + 6, 10, 8, C('#5a6480')); R(x + 2, y, 8, 7, C(EC.metal)); R(x + (f > 0 ? 6 : 2), y + 3, 4, 1, C(EC.eye));
      R(f > 0 ? x - 3 : x + 11, y + 7, 4, 7, C(EC.dark)); R(f > 0 ? x - 3 : x + 11, y + 14, 4, 4, Math.floor(tm * 24) % 2 ? '#ffd04a' : '#ff6a2a');
      R(f > 0 ? x + 9 : x - 5, y + 9, 8, 2, C(EC.dark));
      break;
    }
    case 'crawler': {
      const fr = Math.floor((e.t || 0) * 12) % 2;
      for (let k = 0; k < 3; k++) R(x + 1 + k * 5 + fr, y + 8, 2, 2, C(EC.dark));
      R(x + 1, y + 3, 12, 6, C('#33402f')); R(x + 3, y + 1, 8, 3, C('#5a7a4a')); R(x + 2, y + 4, 10, 1, C('#7aa860'));
      R(x + (f > 0 ? 10 : 1), y + 4, 3, 2, C('#ffe066'));
      R(x + (f > 0 ? 13 : -1), y + 6, 2, 1, C(EC.dark));
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
    default: drawEnemy3(e, x, y, f, C, tm);
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
    case 'D': {
      const a = (V.t || 0) * 24 + (b.nid || 0), x = Math.round(b.x), y = Math.round(b.y);
      for (let k = 0; k < 4; k++) { const aa = a + k * 1.571; R(Math.round(x + Math.cos(aa) * 4) - 1, Math.round(y + Math.sin(aa) * 4) - 1, 3, 3, c); }
      R(x - 1, y - 1, 3, 3, '#ffffff');
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
    case 'icicle': R(x - 3, y - 8, 6, 6, '#bfefff'); R(x - 2, y - 2, 4, 4, '#9fe3ff'); R(x - 1, y + 2, 2, 4, '#e8fbff'); break;
    case 'shard': R(x - 3, y - 3, 6, 6, '#7fdcff'); R(x - 1, y - 1, 2, 2, '#ffffff'); break;
    case 'gantry': {
      const top = 0, bot = y + b.hh;
      R(x - b.hw, top, b.hw * 2, bot - top, '#3a3036'); R(x - b.hw + 2, top, 2, bot - top, '#55474c'); R(x + b.hw - 4, top, 2, bot - top, '#55474c');
      for (let yy = top + 4; yy < bot; yy += 10) R(x - b.hw + 2, yy, b.hw * 2 - 4, 2, '#55474c');
      R(x - b.hw - 2, bot - 6, b.hw * 2 + 4, 6, '#ffc23a'); R(x - b.hw - 2, bot - 4, b.hw * 2 + 4, 2, '#1a1a1a');
      break;
    }
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
      let dx = bm.tx - bm.ox, dy = bm.ty - bm.oy;
      if (bm.kind === 'rot') { dx = Math.cos(bm.a); dy = Math.sin(bm.a); }
      const L = Math.hypot(dx, dy) || 1, ex = bm.ox + dx / L * 700, ey = bm.oy + dy / L * 700;
      ctx.beginPath(); ctx.moveTo(bm.ox, bm.oy); ctx.lineTo(ex, ey);
      if (bm.warn > 0) { ctx.strokeStyle = bm.warn > 0.4 ? 'rgba(255,60,60,0.55)' : (Math.floor(tm * 20) % 2 ? '#ff3b3b' : '#ffffff'); ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.strokeStyle = 'rgba(255,90,60,0.5)'; ctx.lineWidth = 12; ctx.stroke(); ctx.strokeStyle = '#ffb0a0'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }
}
function drawWarns() {
  const tm = V.t || 0;
  for (const w of V.warns) {
    if (Math.floor(tm * 14) % 2) continue;
    const x = Math.round(w.x);
    if (w.k === 'drock') { const yy = Math.round(w.y); R(x - 6, yy - 1, 14, 2, '#ff3b3b'); R(x + 6, yy - 3, 2, 6, '#ff3b3b'); continue; }
    if (w.k === 'gantry') { const yy = 11 * T - 34; R(x - 6, yy, 16, 22, '#ff3b3b'); R(x - 2, yy + 4, 8, 3, '#fff'); R(x - 2, yy + 10, 8, 3, '#fff'); continue; }
    const gt = groundTopL(V.lv, x), y = (gt === null ? 13 * T : gt) - 3, c = w.k === 'ice' ? '#7fdcff' : '#ff3b3b';
    R(x - 6, y, 12, 2, c); R(x - 1, y - 12, 2, 7, c); R(x - 1, y - 4, 2, 2, c);
  }
}
function drawBolts() {
  for (const bo of FXS.bolts) {
    ctx.globalAlpha = clamp(bo.life * 10, 0, 1);
    for (const [col, lw] of [['#b49bff', 3], ['#ffffff', 1]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < bo.pts.length; i++) {
        const [x, y] = bo.pts[i];
        if (i === 0) { ctx.moveTo(x, y); continue; }
        const [px, py] = bo.pts[i - 1];
        for (let k = 1; k <= 3; k++) { const f = k / 4; ctx.lineTo(px + (x - px) * f + rnd(-4, 4), py + (y - py) * f + rnd(-4, 4)); }
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
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
function drawBossA(b) {
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

function circ(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, 6.283); ctx.fill(); }
function drawBoss(b) {
  if (b.kind <= 2) return drawBossA(b);
  if (b.kind === 6) return drawBoarder(b);
  if (b.kind === 7) return drawLinkor(b);
  if (b.kind === 8) return drawDevourer(b);
  const tm = V.t || 0, gy = b.gy || 13 * T;
  if (b.kind === 3) {
    if (b.hidden) {
      const x = Math.round(b.mx);
      if (b.st < 1.0 || b.state === 'enter') { for (let k = -3; k <= 3; k++) R(x + k * 6 + (Math.floor(tm * 20) % 2), gy - 1, 3, 2, '#9fe3ff'); if (Math.floor(tm * 10) % 2) R(x - 1, gy - 10, 2, 6, '#ffffff'); }
      return;
    }
    const tr = b.trail || [], n = tr.length;
    for (let i = 0; i < n - 1; i += 2) { const [sx, sy] = tr[i]; if (sy > gy + 6) continue; const rr = 5 + (i / Math.max(1, n)) * 8; circ(sx, sy, rr, '#46628c'); circ(sx - 1, sy - 2, rr * 0.55, '#9fc4e8'); }
    const hx = b.x + b.w / 2, hy = b.y + b.h / 2, pt = b.parts[0], fl = pt.flash > 0;
    const prev = n > 2 ? tr[n - 3] : [hx - b.face, hy], a = Math.atan2(hy - prev[1], hx - prev[0]);
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(a);
    R(-15, -13, 24, 26, fl ? '#fff' : '#3a5682'); R(-11, -9, 16, 18, fl ? '#fff' : '#5a7aa8');
    const jaw = Math.abs(Math.sin(tm * 10)) * 4;
    R(7, -13 - jaw, 13, 8, '#e8f4ff'); R(7, 5 + jaw, 13, 8, '#e8f4ff'); R(16, -6 - jaw, 3, 3, '#ffffff'); R(16, 3 + jaw, 3, 3, '#ffffff');
    R(-3, -9, 5, 3, '#ff3b3b'); R(-3, 6, 5, 3, '#ff3b3b');
    ctx.restore();
    return;
  }
  if (b.kind === 4) {
    const oy = (b.rise || 0) * 200, cx = b.x + 60, cy = b.y + 60 + oy;
    ctx.strokeStyle = '#1c2236'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(cx, cy, 58, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = '#2e3852'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 58, 0, 6.283); ctx.stroke();
    for (let k = 0; k < 6; k++) { const a = -(b.rot || 0) * 0.5 + k * 1.047; R(Math.round(cx + Math.cos(a) * 30) - 1, Math.round(cy + Math.sin(a) * 30) - 1, 3, 3, '#2e3852'); }
    for (const pt of b.parts) {
      if (pt.plate == null || !pt.alive) continue;
      const px = Math.round(b.x + pt.ox), py = Math.round(b.y + pt.oy + oy), fl = pt.flash > 0;
      R(px, py, 16, 16, fl ? '#fff' : '#4a5468'); R(px + 2, py + 2, 12, 12, fl ? '#fff' : '#8a96b0'); R(px + 4, py + 4, 8, 3, '#c8d8f0');
      if (pt.hp < pt.max / 2) { R(px + 5, py + 8, 6, 1, '#1c2236'); R(px + 9, py + 9, 1, 4, '#1c2236'); }
    }
    const eye = b.parts.find(q => q.core); if (!eye) return;
    const fl = eye.flash > 0, tgt = V.players.find(q => q.active && !q.out && !q.downed) || { x: cx - 100, y: 190, w: 10, h: 22 };
    const a = Math.atan2(tgt.y + 10 - cy, tgt.x + 5 - cx);
    circ(cx, cy, 19, fl ? '#fff' : '#e8eef8');
    circ(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 10, b.phase > 1 ? '#ff3fb4' : '#3fb6ff');
    circ(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, 4, '#05060c');
    R(Math.round(cx + Math.cos(a) * 6) - 4, Math.round(cy + Math.sin(a) * 6) - 5, 3, 2, '#ffffff');
    return;
  }
  // ОМЕГА
  const oy = (b.rise || 0) * 200;
  if (b.form === 1) {
    const x = Math.round(b.x), y = Math.round(b.y) + oy;
    R(x + 22, y + 44, 108, 134, '#2a1e28'); R(x + 28, y + 50, 96, 122, '#3a2a36');
    R(x + 4, y + 46, 30, 30, '#4a3a46'); R(x + 118, y + 46, 30, 30, '#4a3a46');
    for (let k = 0; k < 5; k++) R(x + 40 + k * 16, y + 150, 10, 4, Math.floor(tm * 4 + k) % 3 ? '#5a1a26' : '#ff3b5a');
    circ(x + 76, y + 104, 14, '#1a1016'); circ(x + 76, y + 104, 8 + Math.sin(tm * 6) * 2, '#ff3b5a');
    for (const f of b.parts) {
      if (!f.fist || !f.alive) continue;
      const fx = b.x + f.ox, fy = b.y + f.oy + oy, sx = f.hx < 40 ? x + 18 : x + 132, sy = y + 62;
      ctx.strokeStyle = '#2a1e28'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx + 17, fy + 15); ctx.stroke();
      ctx.strokeStyle = '#4a3a46'; ctx.lineWidth = 3; ctx.stroke();
      const fl = f.flash > 0;
      R(Math.round(fx), Math.round(fy), 34, 30, fl ? '#fff' : '#5b6170'); R(Math.round(fx) + 2, Math.round(fy) + 2, 30, 8, fl ? '#fff' : '#9aa1b2');
      for (let k = 0; k < 4; k++) R(Math.round(fx) + 3 + k * 8, Math.round(fy) + 12, 6, 6, '#3a3f4c');
      if (f.mode === 'wind' && Math.floor(tm * 16) % 2) { ctx.globalAlpha = 0.5; R(Math.round(fx) - 3, Math.round(fy) - 3, 40, 36, '#ff3b5a'); ctx.globalAlpha = 1; }
      if (f.mode === 'hold' || f.mode === 'rise') { if (Math.floor(tm * 12) % 2) R(Math.round(fx), gy - 2, 34, 2, '#ff3b3b'); }
    }
    const hd = b.parts[0], hx = Math.round(b.x + hd.ox), hy = Math.round(b.y + hd.oy + oy), fl = hd.flash > 0;
    R(hx, hy, 48, 40, fl ? '#fff' : '#55474c'); R(hx + 4, hy + 4, 40, 10, fl ? '#fff' : '#6a5a64');
    R(hx + 6, hy + 16, 36, 7, Math.floor(tm * 8) % 2 ? '#ff3b5a' : '#ff7a8a'); R(hx + 10, hy + 28, 28, 6, '#2a1e28');
    for (let k = 0; k < 5; k++) R(hx + 11 + k * 6, hy + 28, 3, 6, '#9aa1b2');
    if (hd.shield) { ctx.strokeStyle = `rgba(127,240,255,${0.45 + 0.25 * Math.sin(tm * 6)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx + 24, hy + 20, 32, 0, 6.283); ctx.stroke(); }
    return;
  }
  if (b.torsoDead) {
    const x = Math.round(b.wx), y = Math.round(b.wy);
    R(x + 30, y + 110, 90, 68, '#1a1016'); R(x + 40, y + 96, 30, 20, '#241a20'); R(x + 84, y + 120, 26, 14, '#2a1e28');
    if (Math.floor(tm * 6) % 2) R(x + 60 + Math.round(Math.sin(tm) * 10), y + 104, 3, 3, '#ff7a3a');
  }
  const cx = b.x + 20, cy = b.y + 20, core = b.parts.find(q => q.core), fl = core && core.flash > 0, P3 = b.phase >= 3;
  circ(cx, cy, 21, '#2a1e28'); circ(cx, cy, 14 + Math.sin(tm * (P3 ? 14 : 6)) * 2, fl ? '#fff' : P3 ? '#ffe6a0' : '#ff3b5a'); circ(cx, cy, 5, '#ffffff');
  ctx.strokeStyle = '#55474c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(cx, cy, 28, 8, tm, 0, 6.283); ctx.stroke();
  for (const o of b.parts) { if (o.orb == null || !o.alive) continue; const ox = b.x + o.ox + 7, oy2 = b.y + o.oy + 7; circ(ox, oy2, 7, o.flash > 0 ? '#fff' : '#7fdcff'); circ(ox, oy2, 3, '#ffffff'); }
  if (core && core.shield) { ctx.strokeStyle = `rgba(127,240,255,${0.45 + 0.25 * Math.sin(tm * 6)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 6.283); ctx.stroke(); }
  if (b.state === 'dive' && b.sub === 1) { const ex = (V.cam.x + W) - 22, wy = b.y + 20; if (Math.floor(tm * 10) % 2) { R(ex, wy - 10, 18, 20, '#ff3b3b'); R(ex + 8, wy - 7, 2, 9, '#fff'); R(ex + 8, wy + 4, 2, 2, '#fff'); } }
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
    if (p.role && V.ship) {
      txt(p.role === 'p' ? 'ПИЛОТ' : 'СТРЕЛОК', x0, 16, 8, '#ffffff', al);
      txt(WNAME[p.weapon] + (p.wlvl > 1 ? '+' : ''), x0, 26, 8, WCOL[p.weapon], al);
      const bx = right ? x0 - 56 : x0;
      rectUI(bx, 37, 56, 5, '#0a0a12'); rectUI(bx + 1, 38, 54 * clamp(p.meter / 100, 0, 1), 3, p.meter >= 100 ? (blink(8) ? '#ffffff' : P.scarf) : P.armorD);
      if (p.meter >= 100) txt('СУПЕР!', right ? bx - 4 : bx + 60, 35, 7, '#ffffff', al);
      return;
    }
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
    let hp = 0, mx = 0; for (const pt of (b.kind === 7 ? b.parts.filter(q => q.core) : b.parts)) { hp += Math.max(0, pt.hp); mx += pt.max; }
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
  for (const bm of V.beams) {
    if (bm.hint === 1 && bm.warn > 0) txt('ПРИГНИСЬ ↓', (bm.x1 + bm.x2) / 2 - cx, bm.y - 24, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
    if (bm.hint === 2 && (bm.warn > 0 || bm.fire > 1.4)) txt('УКРОЙСЯ ПОД СТРАЖЕМ ИЛИ РЫВОК СКВОЗЬ ЛУЧ!', W / 2, 150, 9, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  }
  if (b && b.kind === 5 && b.form === 1 && b.parts.some(f => f.fist && f.alive && f.mode === 'wind')) txt('ПРИГНИСЬ ↓', W / 2, 150, 12, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  if (b && b.kind === 5 && b.state === 'dive' && b.sub === 1) txt('ПРИГНИСЬ ↓', W / 2, 150, 12, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  if (V.chase && V.chaseMode === 'avalanche' && V.players.some(q => q.active && !q.downed && q.x < V.cam.x + 40)) txt('ВПЕРЁД! ЛАВИНА ДОГОНЯЕТ', W / 2, 150, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  if (b && b.kind === 1 && b.state === 'sweep' && b.sub === 1) txt('ПРИГНИСЬ ↓', W / 2, 150, 12, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  drawHUD3(b);
  // баннеры
  if (V.bannerT > 0) {
    const a = clamp(Math.min(V.bannerT, 3.2 - V.bannerT) * 3, 0, 1); sctx.globalAlpha = a;
    rectUI(0, 92, W, 50, 'rgba(6,4,14,0.72)'); rectUI(0, 92, W, 1, '#ffffff33'); rectUI(0, 141, W, 1, '#ffffff33');
    txt((V.level >= 6 ? 'ГЛАВА 3 · ' : V.level >= 3 ? 'ГЛАВА 2 · ' : '') + 'УРОВЕНЬ ' + (V.level + 1) + ' / ' + NLEVELS, W / 2, 98, 9, '#ffd04a', 'center');
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
    const lines = V.level === 6 ? ['Магнитные ботинки: в прыжке нажми ПРЫЖОК ещё раз', 'Высокую стену не перепрыгнуть — пройди по потолку', 'Темно: светят фонари, выстрелы и лампы']
      : V.level === 7 ? (V.players.filter(q => q.active).length > 1 ? ['Корабль на двоих: пилот рулит и стреляет вперёд', 'Стрелок стиком крутит турель во все стороны', 'На полпути вы поменяетесь местами'] : ['Ты пилот: стик — полёт, огонь — вперёд', 'Турель сверху стреляет сама', 'РЫВОК — бочка, на миг неуязвим'])
      : V.level === 8 ? ['Воронки тянут к себе и гнут пули', 'На планетоиде бегай вокруг, прыжок — к соседнему', 'В космосе напарников держит трос']
      : V.level === 3 ? ['Новое: в прыжке ВНИЗ + ПРЫЖОК — удар о землю', 'Можно встать на голову напарнику и прыгнуть выше', 'Лёд скользкий, ветер сносит. Впереди лавина!']
      : V.level === 4 ? ['Низкая гравитация: прыжки выше и дольше', 'В открытом космосе стик управляет полётом', 'Лазерные решётки мигают — проходи, когда погасли']
        : V.level === 5 ? ['На поезде пригибайся под мостами', 'Прессы бьют по красной отметке', 'Конвейеры несут — учитывай при прыжках']
          : IS_TOUCH ? ['Стик: бег и прицел в 8 сторон', 'РЫВОК делает неуязвимым на миг', 'Вниз + ПРЫЖОК: спрыгнуть с мостков'] : ['Вверх/вниз + бег — стрельба по диагонали', 'РЫВОК делает неуязвимым на миг', 'Вниз + ПРЫЖОК: спрыгнуть с мостков'];
    lines.forEach((l, i) => txt(l, W / 2, 158 + i * 11, 8, '#e8eef8', 'center'));
    sctx.globalAlpha = 1;
  }
  if (G.msgT > 0 && NET.mode === 'host') txt(G.msg, W / 2, 60, 7, '#ffd04a', 'center');
}
const prevCanvas = mkCanvas(24, 36), prevCtx = prevCanvas.getContext('2d');
function drawPreview(id, x, y, sc) {
  prevCtx.clearRect(0, 0, 24, 36);
  const saved = ctx; ctx = prevCtx;
  try { drawPlayerBody({ id, active: true, out: false, respawnT: 0, invT: 0, overT: 0, downed: false, crouch: false, onGround: true, vx: 0, vy: 0, animT: 0, dashT: 0, facing: 1, ax: 1, ay: 0, w: 10, h: 22, x: 7, y: 8, bike: false }, false); }
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
    if (V.clearT > 1.5 && blink(2)) txt(V.level < NLEVELS - 1 ? 'ОГОНЬ — ВЫБРАТЬ УЛУЧШЕНИЕ' : 'ОГОНЬ — ДАЛЬШЕ', W / 2, 236, 10, '#ffffff', 'center');
    if (V.level === 2) txt('ГЛАВА 1 ПРОЙДЕНА · ВПЕРЕДИ ГЛАВА 2: КОНТРУДАР', W / 2, 220, 8, '#7ff0ff', 'center');
    if (V.level === 5) txt('ГЛАВА 2 ПРОЙДЕНА · ВПЕРЕДИ ГЛАВА 3: ГЛУБОКИЙ КОСМОС', W / 2, 220, 8, '#7ff0ff', 'center');
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
    txt('Пожиратель погас. Космос снова наш.   Очки ' + V.score + ' · рекорд ' + Math.max(V.best, V.score), W / 2, 46, 8, '#ffd04a', 'center');
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
    drawBG(V.lv.n, V.cam.x + (V.bgScroll || 0));
    const sx = FXS.shake > 0 ? (Math.random() * 2 - 1) * FXS.shake : 0, sy = FXS.shake > 0 ? (Math.random() * 2 - 1) * FXS.shake : 0;
    ctx.setTransform(1, 0, 0, 1, Math.round(-V.cam.x + sx), Math.round(sy));
    drawWells();
    drawPlanets();
    drawTiles();
    drawLamps();
    drawHazards();
    if (V.lock && V.lock.kind === 'airlock') drawAirlock();
    if (V.lock && V.lock.kind === 'train') drawTrainDecor();
    if (V.chase && V.chaseMode === 'avalanche') drawAvalanche();
    if (V.chase && V.chaseMode === 'bike') { ctx.fillStyle = 'rgba(255,240,220,0.22)'; for (let k = 0; k < 16; k++) { const xx = V.cam.x + W - ((V.t * 700 + k * 137) % (W + 80)), yy = 24 + (k * 53) % 170; ctx.fillRect(Math.round(xx), yy, 18 + (k % 3) * 8, 1); } }
    if (V.boss && (V.boss.kind === 2 || V.boss.kind === 8)) drawBoss(V.boss);
    for (const k of V.pickups) drawPickup(k);
    for (const e of V.enemies) drawEnemyT(e);
    if (V.boss && V.boss.kind !== 2 && V.boss.kind !== 8) drawBoss(V.boss);
    const me = myId();
    V.players.forEach(p => { if (p.id !== me) drawPlayer(p, false); });
    V.players.forEach(p => { if (p.id === me) drawPlayer(p, true); });
    for (const b of V.pbullets) drawPBullet(b);
    for (const b of V.ebullets) drawEBullet(b);
    drawTether(); drawSings(); drawSlashes();
    drawBeams(); drawWarns(); drawBolts(); drawParts();
    drawFG();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (V.lv.cfg.dark) darkPass(sx, sy);
    ctx.setTransform(1, 0, 0, 1, Math.round(-V.cam.x + sx), Math.round(sy));
    glowPass();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    drawBG(0, (performance.now() / 1000) * 30);
    ctx.fillStyle = 'rgba(6,4,14,0.35)'; ctx.fillRect(0, 0, W, H);
  }
  if (FXS.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, FXS.flash * 2)})`; ctx.fillRect(0, 0, W, H); }
  sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.imageSmoothingEnabled = false;
  blitWorld(inGame);
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

// ───────────────────────── глава 3: глубокий космос ─────────────────────────
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283; return d; };
function hexA(c, a) {
  if (!c || c[0] !== '#') return c;
  let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

// дополнительные объекты уровней: воронки, планетоиды и враги на них
function genExtra(n, cfg, o) {
  const { rng, r, ri, cols, inZone, spawns, pz } = o;
  const ex = {};
  if (cfg.wells) {
    ex.wells = [];
    for (let c = 34; c < cols - 18; c += ri(24, 34)) {
      if (inZone(c) || inZone(c + 7) || inZone(c - 7)) continue;
      ex.wells.push({ x: c * T + 8, y: r(64, 118), r: 78, f: 52, sp: rng() < 0.5 ? 1 : -1 });
    }
  }
  if (pz) {
    const x0 = pz[0] * T, x1 = pz[1] * T, P = [];
    let x = x0 + 66, k = 0;
    while (x < x1 - 80) {
      const rad = k === 0 ? 34 : r(28, 44), y = k === 0 ? 152 : r(100, 166);
      P.push({ x, y, r: rad, spin: (rng() < 0.5 ? -1 : 1) * r(0.12, 0.35), hue: ri(0, 4), seed: ri(1, 9999) });
      x += rad + r(62, 92) + 34; k++;
    }
    ex.planets = P;
    P.forEach((pl, i) => {
      if (i === 0) return;
      const t = rng();
      if (t < 0.45) spawns.push({ x: pl.x - 40, type: 'pturret', pl: i, th: -Math.PI / 2 + r(-0.8, 0.8) });
      else if (t < 0.9) spawns.push({ x: pl.x - 40, type: 'orbiter', pl: i, th: r(-2.4, -0.7) });
      if (rng() < 0.35) spawns.push({ x: pl.x, type: 'pjet', y: r(40, 80) });
    });
  }
  return ex;
}

// уровень-полёт: каньон и корпус линкора, остальное — открытый космос
function genShip(n, cfg) {
  const rng = mulberry(7919 + n * 1013);
  const r = (a, b) => a + rng() * (b - a), ri = (a, b) => Math.floor(r(a, b + 1));
  const cols = cfg.cols, AR = 110, total = cols + AR, rows = 17;
  const tiles = []; for (let y = 0; y < rows; y++) tiles.push(new Uint8Array(total));
  const gnd = new Int16Array(total).fill(-1);
  const [t0, t1] = cfg.trench, spawns = [];
  let fh = 16, chh = 0;
  for (let c = t0; c < t1; c++) {
    const k = c - t0, tail = t1 - 1 - c;
    if (k < 8 || tail < 8) { const e = Math.min(k, tail); fh = Math.round(clamp(16 - e * 0.55, 12, 16)); chh = Math.round(clamp(e * 0.5, 0, 3)); }
    else if (rng() < 0.22) { fh = clamp(fh + (rng() < 0.5 ? -1 : 1), 10, 13); chh = clamp(chh + (rng() < 0.5 ? -1 : 1), 2, 5); if (fh - chh < 7) chh = fh - 7; }
    for (let y = fh; y < rows; y++) tiles[y][c] = 1;
    for (let y = 0; y < chh; y++) tiles[y][c] = 1;
    gnd[c] = fh;
    if (k > 10 && tail > 10 && k % 7 === 3) spawns.push({ x: c * T, type: rng() < 0.5 ? 'tturret' : 'tcturret' });
  }
  const ax = cols * T;
  for (let c = cols + 4; c < total; c++) { for (let y = 14; y < rows; y++) tiles[y][c] = 1; gnd[c] = 14; }
  const towers = [[18, 3], [37, 4], [56, 3], [70, 5]];
  for (const [o, h] of towers) for (let c = cols + o; c < cols + o + 3; c++) for (let y = 14 - h; y < 14; y++) tiles[y][c] = 1;
  for (let c = cols + 78; c < cols + 84; c++) for (let y = 9; y < 14; y++) tiles[y][c] = 1;
  for (let c = 16; c < cols - 8;) {
    const x = c * T;
    if (c >= t0 - 4 && c < t1 + 2) { if (rng() < 0.35) spawns.push({ x, type: 'fighter', y: r(80, 130) }); c += ri(9, 13); continue; }
    const s = c < 100 ? 0 : 1, roll = rng();
    if (s === 0) {
      if (roll < 0.55) spawns.push({ x, type: 'ast', y: r(20, 225), big: rng() < 0.5 });
      else if (roll < 0.75) spawns.push({ x, type: 'mine', y: r(40, 210) });
      else spawns.push({ x, type: 'fighter', y: r(60, 190) });
      c += ri(3, 6);
    } else {
      if (roll < 0.28) spawns.push({ x, type: 'fighter', y: r(60, 190) });
      else if (roll < 0.52) spawns.push({ x, type: 'swarm', y: r(70, 180) });
      else if (roll < 0.68) spawns.push({ x, type: 'ast', y: r(20, 225), big: rng() < 0.6 });
      else if (roll < 0.8) spawns.push({ x, type: 'gunship', y: r(60, 170) });
      else spawns.push({ x, type: 'mine', y: r(40, 210) });
      c += ri(5, 9);
    }
  }
  for (let c = 34; c < cols - 10; c += ri(30, 40)) spawns.push({ x: c * T, type: 'carrier' });
  spawns.sort((a, b) => a.x - b.x);
  return {
    n, tiles, gnd, total, cols, rows, spawns, arenaX: ax, zones: { chase: { x0: 0, x1: total * T, mode: 'ship' } }, hz: [], grav: 1, cfg,
    trenchX: [t0 * T, t1 * T], towers: towers.map(([o, h]) => ({ x: ax + o * T, w: 3 * T, top: (14 - h) * T })), lamps: [], walls: [],
  };
}

// ── спецвраги
function spawnSpecial(s, edge) {
  switch (s.type) {
    case 'ast': spawnEnemy('asteroid', edge + 20, s.y, { vx: G.chaseV - rnd(30, 80), vy: rnd(-12, 12), sz: s.big ? 2 : 1 }); return true;
    case 'fighter': for (let k = 0; k < 3; k++) { const y = clamp(s.y + (k - 1) * 22, 20, 220); spawnEnemy('fighter', edge + 10 + k * 24, y, { baseY: y }); } return true;
    case 'swarm': for (let k = 0; k < 5; k++) spawnEnemy('swarm', edge + 10 + k * 16, s.y, { baseY: s.y, ph: k * 0.7 }); return true;
    case 'gunship': spawnEnemy('gunship', G.cam.x - 40, s.y, { baseY: s.y }); ftext(G.cam.x + 40, s.y - 10, '← СЗАДИ!', '#ff9a6a', 9); return true;
    case 'tturret': { const gt = groundTop(s.x + 7); if (gt !== null) spawnEnemy('turret', s.x, gt - 12); return true; }
    case 'tcturret': { const cb = ceilBot(s.x + 7); if (cb !== null) spawnEnemy('turret', s.x, cb, { gd: -1 }); return true; }
    case 'pturret': case 'orbiter': { const e = spawnEnemy(s.type, 0, 0, { pl: s.pl, th: s.th, dir: Math.random() < 0.5 ? 1 : -1 }); placeOnPlanetE(e); return true; }
    case 'pjet': spawnEnemy('jet', edge + 4, s.y, { baseY: s.y }); return true;
  }
  return false;
}
function placeOnPlanetE(e) {
  const P = G.lv.planets && G.lv.planets[e.pl]; if (!P) return;
  const Rr = P.r + e.h / 2, cx = P.x + Math.cos(e.th) * Rr, cy = P.y + Math.sin(e.th) * Rr;
  e.x = cx - e.w / 2; e.y = cy - e.h / 2; e.rot = e.th + Math.PI / 2;
}
function updSpecialEnemy(e, p, dt) {
  const d = G.d;
  switch (e.type) {
    case 'swarm': e.x += ((G.chase ? G.chaseV : 0) - 105 * d.eSpeed) * dt; e.y = e.baseY + Math.sin(e.t * 3.2 + (e.ph || 0)) * 42; break;
    case 'gunship': {
      if (e.hold > 0) { e.hold -= dt; const tx = G.cam.x + e.relX; e.x += clamp((tx - e.x) * 2, -170, 170) * dt + (G.chase ? G.chaseV : 0) * dt; }
      else { e.x += ((G.chase ? G.chaseV : 0) - 40) * dt; e.baseY -= 80 * dt; }
      e.y = e.baseY + Math.sin(e.t * 1.6) * 10; e.facing = 1; e.cd -= dt;
      if (e.hold > 0 && p && e.cd <= 0 && e.x > G.cam.x) { e.cd = rnd(1.5, 2.1) * d.eFire; const a = angTo(e.x + 28, e.y + 8, p); for (let i = -1; i <= 1; i++) eShoot(e.x + 28, e.y + 8, a + i * 0.2, 118 * d.eSpeed, 3); }
      break;
    }
    case 'pturret': {
      placeOnPlanetE(e);
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (p) { const ta = angTo(cx, cy, p); e.aim += clamp(angDiff(ta, e.aim), -2.2 * dt, 2.2 * dt); }
      e.cd -= dt;
      if (e.cd <= 0 && p && e.x > G.cam.x - 10 && e.x < G.cam.x + W) { e.burst = 2; e.bt = 0; e.cd = 2.3 * d.eFire; }
      if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0) { eShoot(cx + Math.cos(e.aim) * 10, cy + Math.sin(e.aim) * 10, e.aim, 112 * d.eSpeed, 3); e.burst--; e.bt = 0.2; } }
      break;
    }
    case 'orbiter': {
      const P = G.lv.planets[e.pl];
      e.th += (e.dir || 1) * 34 / (P.r + 7) * d.eSpeed * dt;
      if (Math.random() < 0.004) e.dir = -(e.dir || 1);
      placeOnPlanetE(e); e.facing = e.dir || 1; e.cd -= dt;
      if (e.cd <= 0 && p && e.x > G.cam.x - 10 && e.x < G.cam.x + W) { e.cd = rnd(2, 3) * d.eFire; const cx = e.x + e.w / 2, cy = e.y + e.h / 2; eShoot(cx, cy, angTo(cx, cy, p), 108 * d.eSpeed, 3); }
      break;
    }
  }
}

// ── корабль на двоих: пилот и стрелок
function setupShip() {
  const d = G.d;
  G.ship = { hp: d.hp + 2, max: d.hp + 2, inv: 2, swapped: false, tur: 0.4, ta: -0.4, trench: false };
  assignRoles();
  startChase();
}
function assignRoles() {
  const S = G.ship; if (!S) return;
  const act = G.players.filter(p => p.active && !p.out);
  const pilot = act.find(p => p.id === (S.swapped ? 1 : 0)) || act[0];
  const prev = G.players.find(p => p.role === 'p' && p.active);
  const px = prev ? prev.x : G.cam.x + 70, py = prev ? prev.y : 120;
  for (const p of G.players) {
    p.role = !p.active || p.out ? '' : (p === pilot ? 'p' : 'g');
    if (!p.role) continue;
    p.downed = false; p.crouch = false; p.fly = true; p.gd = 1; p.respawnT = 0; p.slam = false; p.bike = false;
    if (p.role === 'p') { p.w = 24; p.h = 12; p.x = px; p.y = py; p.facing = 1; p.vx = G.chaseV; p.vy = 0; }
    else { p.w = 8; p.h = 10; if (p.tang == null) p.tang = -0.6; }
  }
}
function updShip(dt) {
  const S = G.ship, cfg = G.lv.cfg;
  S.inv = Math.max(0, S.inv - dt);
  const act = G.players.filter(p => p.active && !p.out);
  if (!act.some(p => p.role === 'p') || act.some(p => !p.role)) assignRoles();
  if (!S.swapped && cfg.swap && G.cam.x >= cfg.swap * T && act.length > 1) {
    S.swapped = true; assignRoles(); G.lockMsg = 'МЕНЯЕМСЯ МЕСТАМИ!'; G.lockMsgT = 2.4; sfx('swap');
    const pl = G.players.find(p => p.role === 'p'); if (pl) ftext(pl.x + 12, pl.y - 22, PNAME[pl.id] + ' ЗА ШТУРВАЛОМ', palOf(pl.id).scarf, 9);
  }
  for (const p of G.players) if (p.role) p.invT = S.inv;
  if (act.some(p => p.role === 'g')) return;
  // одиночная игра: турель стреляет сама
  const pl = act.find(p => p.role === 'p'); if (!pl) return;
  const tx = pl.x + 13, ty = pl.y - 3;
  let best = null, bd = 250;
  for (const e of G.enemies) { if (e.dead) continue; const dd = Math.hypot(e.x + e.w / 2 - tx, e.y + e.h / 2 - ty); if (dd < bd) { bd = dd; best = e; } }
  const bs = G.boss;
  if (!best && bs && bs.ready && !bs.dead) for (const pt of bs.parts) { if (!pt.alive || pt.shield) continue; const rr = bossPartRect(bs, pt), dd = Math.hypot(rr.x + rr.w / 2 - tx, rr.y + rr.h / 2 - ty); if (dd < bd) { bd = dd; best = rr; } }
  if (best) S.ta += angDiff(Math.atan2(best.y + best.h / 2 - ty, best.x + best.w / 2 - tx), S.ta) * Math.min(1, dt * 8);
  S.tur -= dt;
  if (best && S.tur <= 0) {
    S.tur = 0.34; const a = S.ta;
    G.pbullets.push({ nid: NID++, x: tx + Math.cos(a) * 9, y: ty + Math.sin(a) * 9, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, dmg: 0.8 * (1 + 0.25 * pl.perks.caliber), life: 1.2, type: 'B', owner: pl, a, hit: null, pierce: 0, r: 2 });
  }
}
function shipHurt() {
  const S = G.ship; if (!S || S.pred || S.inv > 0 || PRED) return;
  const pl = G.players.find(p => p.role === 'p'); if (!pl) return;
  if (pl.dashT > 0 || pl.overT > 0) return;
  S.hp--; S.inv = 1.4; pl.st.hurts++; pl.tot.hurts++; shake(6); sfx('hurt'); spark(pl.x + 12, pl.y + 6, '#ff4a4a', 10);
  if (S.hp <= 0) {
    boom(pl.x + 12, pl.y + 6, 4); sfx('bigboom'); flash(0.3);
    if (G.lives > 0) { G.lives--; S.hp = S.max; S.inv = 3; pl.x = G.cam.x + 60; pl.y = 120; pl.vx = G.chaseV; pl.vy = 0; G.ebullets.length = 0; ftext(G.cam.x + W / 2, 70, 'КОРАБЛЬ ПОДБИТ · КРЕДИТ −1', '#ffd04a', 10); }
    else gameOver();
  }
}
function updShipPlayer(p, I, dt) {
  const c = I.c, pr = I.p;
  const mx = (c.right ? 1 : 0) - (c.left ? 1 : 0), my = (c.down ? 1 : 0) - (c.up ? 1 : 0);
  p.onGround = false; p.crouch = false; p.animT += dt;
  if (p.role === 'p') {
    p.facing = 1; p.ax = 1; p.ay = 0;
    if (pr.dash && p.dashCd <= 0) { p.dashT = 0.36; p.dashCd = 1.0 * (p.perks.ghost ? 0.6 : 1); p.dashHit = new Set(); sfx('dash'); }
    if (p.dashT > 0) p.dashT -= dt;
    const sp = 128;
    p.vx += (G.chaseV + mx * sp - p.vx) * Math.min(1, dt * 7);
    p.vy += (my * sp - p.vy) * Math.min(1, dt * 7);
    moveBody(p, dt, false);
    if (p.hitX) {
      if (!overlapSolid({ x: p.x + 3, y: p.y - 9, w: p.w, h: p.h })) p.vy = -120;
      else if (!overlapSolid({ x: p.x + 3, y: p.y + 9, w: p.w, h: p.h })) p.vy = 120;
    }
    const L0 = G.cam.x + 4, R0 = G.cam.x + W * 0.78 - p.w;
    if (p.x < L0) { p.x = L0; if (overlapSolid(p)) { unstuck(p); shipHurt(); } }
    if (p.x > R0) p.x = R0;
    p.y = clamp(p.y, 8, H - 16);
    if (overlapSolid(p)) unstuck(p);
    if (p.perks.ghost && p.dashT > 0 && !PRED) for (const e of G.enemies) if (!e.dead && !p.dashHit.has(e) && overlap(p, e)) { p.dashHit.add(e); damageEnemy(e, 3, p, null); }
  } else {
    const pl = (PRED ? (G.predPlayers || []) : G.players).find(q => q.role === 'p' && q.active);
    if (pl) { p.x = pl.x + 9; p.y = pl.y - 11; p.vx = pl.vx; p.vy = pl.vy; }
    if (mx || my) p.tang = (p.tang || 0) + angDiff(Math.atan2(my, mx), p.tang || 0) * Math.min(1, dt * 12);
    p.ax = Math.cos(p.tang || 0); p.ay = Math.sin(p.tang || 0); p.facing = p.ax >= 0 ? 1 : -1;
  }
  if (!PRED) {
    if ((c.fire || (c.auto && !G.paused)) && p.fireCd <= 0) shoot(p);
    if (pr.sup && p.meter >= 100) activateOver(p);
  }
}

// ── планетоиды: радиальная гравитация
function inOrbitZone(p) {
  const L = G.lv; if (!L || !L.planets || p.fly || p.role || p.downed) return false;
  const Z = L.zones.planets, cx = p.x + p.w / 2;
  return !p.onGround && cx > Z.x0 - 2 && cx < Z.x1 + 2;
}
function nearestPlanet(x, y) { const P = G.lv.planets; let bi = -1, bd = 1e9; for (let i = 0; i < P.length; i++) { const d = Math.hypot(P[i].x - x, P[i].y - y) - P[i].r; if (d < bd) { bd = d; bi = i; } } return [bi, bd]; }
function placeOnPlanet(p) { const P = G.lv.planets[p.pl], Rr = P.r + 11, cx = P.x + Math.cos(p.th) * Rr, cy = P.y + Math.sin(p.th) * Rr; p.x = cx - p.w / 2; p.y = cy - 11; p.ang = p.th + Math.PI / 2; }
function orbitRespawn(p) {
  const L = G.lv; if (!L.planets) return false;
  const Z = L.zones.planets;
  if (G.cam.x + W < Z.x0 || G.cam.x > Z.x1) return false;
  let i = -1;
  const q = G.players.find(o => o !== p && alive(o) && o.pl >= 0);
  if (q) i = q.pl;
  else if (p.lastPl >= 0 && L.planets[p.lastPl].x > G.cam.x + 10) i = p.lastPl;
  if (i < 0) { let bd = 1e9; L.planets.forEach((P, k) => { const d = Math.abs(P.x - (G.cam.x + W / 2)); if (d < bd && P.x > G.cam.x + 20 && P.x < G.cam.x + W - 20) { bd = d; i = k; } }); }
  if (i < 0) return false;
  p.pl = i; p.th = -Math.PI / 2; p.vt = 0; p.orb = true; p.vx = p.vy = 0; p.onGround = true; placeOnPlanet(p); p.invT = Math.max(p.invT, 2);
  return true;
}
function updOrbit(p, I, dt) {
  const c = I.c, pr = I.p, L = G.lv, PL = L.planets;
  const mx = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  p.orb = true; p.gd = 1; p.clamp = false; p.slam = false;
  if (p.crouch) { p.y -= 10; p.h = 22; p.crouch = false; }
  if (mx && p.dashT <= 0) p.facing = mx;
  if (pr.jump) p.jbuf = 0.12;
  if (pr.dash && p.dashCd <= 0) { p.dashT = 0.17; p.dashDir = mx || p.facing; p.dashCd = 0.85 * (p.perks.ghost ? 0.55 : 1); p.dashHit = new Set(); sfx('dash'); }
  if (p.dashT > 0) p.dashT -= dt;
  if (p.pl >= 0) {
    const P = PL[p.pl], Rr = P.r + 11;
    const tv = p.dashT > 0 ? p.dashDir * 240 : mx * 92;
    p.vt += (tv - p.vt) * Math.min(1, dt * 12);
    p.th += p.vt / Rr * dt;
    p.onGround = true; p.lastPl = p.pl;
    if (p.jbuf > 0) {
      p.jbuf = 0; const ux = Math.cos(p.th), uy = Math.sin(p.th), rx = -uy, ry = ux;
      p.vx = ux * 290 + rx * p.vt * 1.2; p.vy = uy * 290 + ry * p.vt * 1.2; p.pl = -1; p.leaveT = 0.25; p.onGround = false; sfx('jump');
    } else placeOnPlanet(p);
    if (Math.abs(p.vt) > 10) p.animT += dt;
  }
  if (p.pl < 0) {
    p.onGround = false; p.leaveT = (p.leaveT || 0) - dt;
    const bx = p.x + p.w / 2, by = p.y + 11;
    const [j, dd] = nearestPlanet(bx, by);
    let upA = -Math.PI / 2;
    if (j >= 0 && dd < 140) {
      const P = PL[j], dx = P.x - bx, dy = P.y - by, d = Math.hypot(dx, dy) || 1;
      p.vx += dx / d * 470 * dt; p.vy += dy / d * 470 * dt; upA = Math.atan2(-dy, -dx);
    } else p.vy += 380 * (L.grav || 1) * dt;
    const a = p.ang - Math.PI / 2, rx = -Math.sin(a), ry = Math.cos(a);
    if (mx) { p.vx += rx * mx * 240 * dt; p.vy += ry * mx * 240 * dt; }
    if (p.dashT > 0) { p.vx += rx * p.dashDir * 700 * dt; p.vy += ry * p.dashDir * 700 * dt; }
    const sp = Math.hypot(p.vx, p.vy); if (sp > 340) { p.vx *= 340 / sp; p.vy *= 340 / sp; }
    p.ang += angDiff(upA + Math.PI / 2, p.ang) * Math.min(1, dt * 7);
    moveBody(p, dt, false);
    if (p.onGround) { p.orb = false; p.ang = 0; p.lastPl = -1; p.pl = -1; }
    else {
      for (let i = 0; i < PL.length; i++) {
        if (i === p.lastPl && p.leaveT > 0) continue;
        const P = PL[i], bx2 = p.x + p.w / 2, by2 = p.y + 11, d = Math.hypot(bx2 - P.x, by2 - P.y);
        if (d <= P.r + 11) {
          p.pl = i; p.th = Math.atan2(by2 - P.y, bx2 - P.x); const ux = Math.cos(p.th), uy = Math.sin(p.th);
          p.vt = clamp(p.vx * -uy + p.vy * ux, -120, 120); p.vx = p.vy = 0; placeOnPlanet(p); p.onGround = true;
          if (!PRED) emit({ e: 'u', x: r1(bx2), y: r1(by2) });
          break;
        }
      }
      const cx = p.x + p.w / 2, Z = L.zones.planets;
      if (p.pl < 0 && (cx < Z.x0 - 6 || cx > Z.x1 + 6)) { p.orb = false; }
    }
  }
  // прицел в системе бойца, потом поворот в мир
  const lock = !!c.lock;
  let ax = p.facing, ay = 0;
  if (lock) { ay = c.up ? -1 : c.down ? 1 : 0; ax = mx !== 0 ? mx : (ay !== 0 ? 0 : p.facing); }
  else if (c.up) { ay = -1; ax = mx; }
  else if (c.down && p.pl < 0) { ay = 1; ax = mx; }
  if (ax === 0 && ay === 0) ax = p.facing;
  const l = Math.hypot(ax, ay); ax /= l; ay /= l;
  const ca = Math.cos(p.ang || 0), sa = Math.sin(p.ang || 0);
  p.ax = ax * ca - ay * sa; p.ay = ax * sa + ay * ca;
  if (!PRED) {
    if ((c.fire || (c.auto && !G.paused)) && p.fireCd <= 0) shoot(p);
    if (pr.sup && p.meter >= 100) activateOver(p);
  }
  if (p.pl < 0) clampToCam(p);
  else if (p.x < G.cam.x - 4) { p.pl = -1; p.vx = 60; p.vy = -60; }
  if (p.y > H + 30 || p.y < -80) { if (!PRED) pitFall(p); }
}
function updTether(dt) {
  G.tether = 0;
  const act = G.players.filter(alive); if (act.length < 2) return;
  const [a, b] = act; if (!(a.orb || b.orb)) return;
  const ax = a.x + 5, ay = a.y + 11, bx = b.x + 5, by = b.y + 11, d = Math.hypot(bx - ax, by - ay) || 1;
  G.tether = Math.max(0.02, clamp((d - 70) / 90, 0, 1));
  if (d <= 125) return;
  const k = Math.min(1000, (d - 125) * 10), ux = (bx - ax) / d, uy = (by - ay) / d;
  const pull = (q, s) => { if (q.pl >= 0 || q.onGround) return; q.vx += ux * s * k * dt; q.vy += uy * s * k * dt; };
  pull(a, 1); pull(b, -1);
  if (d > 160 && (G.tetherSnd = (G.tetherSnd || 0) - dt) <= 0) { G.tetherSnd = 0.5; sfx('tether'); }
}
// гравитационные воронки, планеты и дыра гнут пули
function bendBullet(b, dt, mine) {
  const L = G.lv;
  if (L.wells) for (const w of L.wells) { const dx = w.x - b.x, dy = w.y - b.y, d2 = dx * dx + dy * dy; if (d2 < w.r * w.r) { const d = Math.sqrt(d2) || 1, a = 1300 * (1 - d / w.r); b.vx += dx / d * a * dt; b.vy += dy / d * a * dt; if (!mine && d < 8) return true; } }
  if (L.planets) for (const P of L.planets) { const dx = b.x - P.x, dy = b.y - P.y; if (dx * dx + dy * dy < P.r * P.r) return true; }
  const bs = G.boss;
  if (bs && bs.kind === 8 && !bs.dead && bs.ready) {
    const dx = bs.hx - b.x, dy = bs.hy - b.y, d = Math.hypot(dx, dy) || 1;
    if (mine && d < 240) {
      const ux = dx / d, uy = dy / d, a = 900 * (1 - d / 240) + 150;
      b.vx += ux * a * dt; b.vy += uy * a * dt;
      if (d < 180) { const vr = b.vx * ux + b.vy * uy, k = Math.max(0, 1 - 2.4 * dt); b.vx = ux * vr + (b.vx - ux * vr) * k; b.vy = uy * vr + (b.vy - uy * vr) * k; }
      if (d < 18) {
        const heart = bs.parts.find(q => q.core);
        if (heart && heart.alive) { if (!heart.shield && b.owner && !b.counted) { b.counted = true; b.owner.st.hits++; b.owner.tot.hits++; } damagePart(bs, heart, b.dmg, b.owner, b); }
        return true;
      }
    }
    if (!mine && d < 26 && b.kind === 'rock') return true;
  }
  return false;
}

// ── оружие: гравиграната и плазменная коса
function makeSing(b) {
  const lv = b.lvl || 1;
  G.sings.push({ x: b.x, y: b.y, t: lv > 1 ? 2.0 : 1.5, r: lv > 1 ? 88 : 68, owner: b.owner, dm: b.dmg, tick: 0 });
  sfx('grav'); emit({ e: 'r', x: r1(b.x), y: r1(b.y), c: WCOL.G, v: 70 });
}
function updSings(dt) {
  if (!G.sings.length) return;
  for (const s of G.sings) {
    s.t -= dt; s.tick -= dt;
    const hitNow = s.tick <= 0; if (hitNow) s.tick = 0.25;
    for (const e of G.enemies) {
      if (e.dead || e.mini) continue;
      const dx = s.x - (e.x + e.w / 2), dy = s.y - (e.y + e.h / 2), d = Math.hypot(dx, dy) || 1;
      if (d > s.r) continue;
      const still = e.type === 'turret' || e.type === 'pturret' || e.type === 'orbiter' || e.type === 'barrier';
      if (!still) { e.x += dx / d * 120 * dt; if (!e.grav) e.y += dy / d * 120 * dt; }
      if (hitNow && d < s.r * 0.65) damageEnemy(e, 0.9 * s.dm, s.owner, null);
    }
    const bs = G.boss;
    if (hitNow && bs && bs.ready && !bs.dead && !bs.hidden) for (const pt of bs.parts) { if (!pt.alive) continue; const r = bossPartRect(bs, pt); if (Math.hypot(r.x + r.w / 2 - s.x, r.y + r.h / 2 - s.y) < s.r * 0.5 + Math.max(r.w, r.h) / 2) damagePart(bs, pt, 0.6 * s.dm, s.owner); }
    for (const eb of G.ebullets) if (eb.life > 0 && eb.kind !== 'wave' && eb.kind !== 'gantry' && Math.hypot(eb.x - s.x, eb.y - s.y) < s.r * 0.7) eb.life = 0;
    if (s.t <= 0) {
      boom(s.x, s.y, 3); shake(5); sfx('boom');
      for (const e of G.enemies) if (!e.dead && Math.hypot(e.x + e.w / 2 - s.x, e.y + e.h / 2 - s.y) < s.r * 0.75) damageEnemy(e, 4 * s.dm, s.owner, null);
    }
  }
  G.sings = G.sings.filter(s => s.t > 0);
}
function scythe(p, cx, cy, ang, dm, lvl) {
  const R0 = lvl > 1 ? 46 : 36, half = 1.25;
  p.st.shots++; p.tot.shots++;
  let hit = false, refl = 0;
  const inArc = (x, y, pad) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d > R0 + pad) return false; return d < 10 || Math.abs(angDiff(Math.atan2(dy, dx), ang)) < half; };
  for (const e of G.enemies) if (!e.dead && inArc(e.x + e.w / 2, e.y + e.h / 2, Math.max(e.w, e.h) / 2)) { damageEnemy(e, 2.6 * dm, p, null); hit = true; }
  const b = G.boss;
  if (b && b.ready && !b.dead && !b.hidden) for (const pt of b.parts) { if (!pt.alive) continue; const r = bossPartRect(b, pt); if (inArc(r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) / 2)) { damagePart(b, pt, 2.6 * dm, p); hit = true; } }
  for (const eb of G.ebullets) {
    if (eb.life <= 0 || eb.kind === 'wave' || eb.kind === 'gantry') continue;
    if (inArc(eb.x, eb.y, 4)) { eb.life = 0; refl++; const a2 = Math.atan2(eb.y - cy, eb.x - cx); G.pbullets.push({ nid: NID++, x: eb.x, y: eb.y, vx: Math.cos(a2) * 320, vy: Math.sin(a2) * 320, dmg: 1.5 * dm, life: 1, type: 'K', owner: p, a: a2, hit: null, pierce: 0, r: 3 }); }
  }
  if (hit) { p.st.hits++; p.tot.hits++; }
  if (refl) ftext(cx, cy - 18, 'ОТБИЛ!', WCOL.K, 8);
  emit({ e: 'sl', x: r1(cx), y: r1(cy), a: r1(ang), r: R0, c: palOf(p.id).scarf });
}

// ── шлюз с разгерметизацией
function updAirlock(L, dt) {
  const hx = G.cam.x + W - 22, np = G.players.filter(p => p.active && !p.out).length;
  if (L.ph === 'calm') {
    L.eT -= dt;
    if (L.eT <= 0) {
      L.eT = rnd(1.3, 2.0) / (np > 1 ? 1.25 : 1);
      const rr = Math.random(); let e;
      if (rr < 0.45) e = spawnEnemy('runner', G.cam.x - 12, 13 * T - 20);
      else if (rr < 0.75) e = spawnEnemy('crawler', G.cam.x - 14, 3 * T, { gd: -1 });
      else { const y = rnd(70, 140); e = spawnEnemy('jet', G.cam.x - 16, y, { baseY: y }); }
      e.wave = true; e.facing = 1;
    }
    if (L.t <= 0) { L.ph = 'warn'; L.t = 1.7; G.lockMsg = 'РАЗГЕРМЕТИЗАЦИЯ! ПРИЖМИСЬ'; G.lockMsgT = 1.7; sfx('alarm'); }
  } else if (L.ph === 'warn') { if (L.t <= 0) { L.ph = 'suck'; L.t = 3.6; sfx('suck'); shake(5); } }
  else if (L.ph === 'suck') {
    G.pullF += 82;
    let sucked = 0;
    for (const e of G.enemies) { if (e.dead || e.mini) continue; e.x += (e.grav ? 150 : 190) * dt; if (e.x + e.w > hx - 4) { killEnemy(e, null); sucked++; } }
    if (sucked) ftext(hx - 30, 110, 'ВЫСОСАЛО!', '#9fe6ff', 9);
    for (const q of G.players) if (alive(q) && q.x + q.w > hx - 6) { hurtPlayer(q); q.x = hx - 80; q.vx = -60; }
    if (L.t <= 0) {
      L.cyc++;
      if (L.cyc >= 3) { for (const e of G.enemies) if (e.wave) killEnemy(e, null, true); endLock('ШЛЮЗ ЗАДРАЕН!'); return; }
      L.ph = 'calm'; L.t = 6.5; L.eT = 0.5; G.lockMsg = 'ЦИКЛ ' + (L.cyc + 1) + ' / 3'; G.lockMsgT = 1.4;
    }
  }
}

// ── боссы главы 3
function makeBoss3(n) {
  const ax = G.lv.arenaX, bs = G.bscale, gy = 13 * T;
  if (n === 6) {
    const hp = 165 * bs;
    return { kind: 6, name: 'АБОРДАЖНИК', x: ax + W - 130, y: -60, w: 80, h: 40, gy, face: -1, side: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, t: 0, ready: false, open: 0,
      parts: [
        { id: 'eye', ox: 26, by: 2, oy: 2, w: 28, h: 18, hp, max: hp, alive: true, flash: 0, core: true },
        { id: 'canL', ox: 2, by: 22, oy: 22, w: 16, h: 12, hp: 50 * bs, max: 50 * bs, alive: true, flash: 0, cd: 1.5 },
        { id: 'canR', ox: 62, by: 22, oy: 22, w: 16, h: 12, hp: 50 * bs, max: 50 * bs, alive: true, flash: 0, cd: 2.3 },
      ] };
  }
  if (n === 7) {
    const L = G.lv, b = { kind: 7, name: 'ЛИНКОР', x: ax, y: 0, w: 1400, h: H, gy, face: -1, state: 'run', st: 0, sub: 0, n: 0, phase: 1, t: 0, ready: true, atEnd: false, stopX: ax + 84 * T + 30 - W, parts: [] };
    L.towers.forEach((tw, i) => b.parts.push({ id: 'tw' + i, tur: 1, ox: tw.x - ax + 14, oy: tw.top - 12, w: 20, h: 12, hp: 34 * bs, max: 34 * bs, alive: true, flash: 0, cd: rnd(0.8, 2) }));
    [130, 450, 760, 1010].forEach((ox, i) => b.parts.push({ id: 'ht' + i, tur: 1, ox, oy: 14 * T - 12, w: 20, h: 12, hp: 30 * bs, max: 30 * bs, alive: true, flash: 0, cd: rnd(0.8, 2) }));
    [380, 840].forEach((ox, i) => b.parts.push({ id: 'mp' + i, tur: 2, ox, oy: 14 * T - 10, w: 22, h: 10, hp: 26 * bs, max: 26 * bs, alive: true, flash: 0, cd: rnd(1, 2.5) }));
    b.parts.push({ id: 'core', ox: 78 * T + 26, oy: 9 * T - 48, w: 44, h: 44, hp: 300 * bs, max: 300 * bs, alive: true, flash: 0, core: true, shield: true });
    return b;
  }
  const hx = ax + W - 66, hy = 98;
  const b = { kind: 8, name: 'ПОЖИРАТЕЛЬ', x: hx - 40, y: hy - 40, w: 80, h: 80, hx, hy, gy, face: -1, state: 'enter', st: 0, sub: 0, n: 0, phase: 1, t: 0, ready: false, ang: 0, pull: 0, open: 0, pulse: 0, grow: 0, parts: [] };
  b.parts.push({ id: 'heart', ox: 28, oy: 28, w: 24, h: 24, hp: 230 * bs, max: 230 * bs, alive: true, flash: 0, core: true, shield: true });
  for (let k = 0; k < 4; k++) b.parts.push({ id: 'f' + k, feed: k, ox: 0, oy: 0, w: 16, h: 16, hp: 42 * bs, max: 42 * bs, alive: true, flash: 0, cd: 1 + k * 0.6 });
  G.arenaRight = hx - 44;
  return b;
}
const r0x = (b, pt) => b.x + pt.ox + pt.w / 2 - 60;
function landWave(b) {
  shake(10); sfx('stomp');
  const y = b.side > 0 ? 13 * T - 7 : 3 * T + 7, v = b.phase > 1 ? 220 : 175;
  const mk = (x, dir) => G.ebullets.push({ nid: NID++, kind: 'wave', x, y, hw: 5, hh: 7, vx: dir * v, vy: 0, life: 3.2, noTile: true, r: 0 });
  mk(b.x + 4, -1); mk(b.x + b.w - 4, 1);
  emit({ e: 'u', x: r1(b.x + 20), y: r1(y) }); emit({ e: 'u', x: r1(b.x + 60), y: r1(y) });
}
function boss6(b, dt) { // АБОРДАЖНИК
  const ax = G.lv.arenaX, p = bossTarget(b), P2 = b.phase > 1, sp = P2 ? 1.3 : 1;
  const floorY = 13 * T - b.h, ceilY = 3 * T, eye = b.parts[0];
  for (const pt of b.parts) pt.oy = b.side > 0 ? pt.by : b.h - pt.by - pt.h;
  if (b.open > 0) b.open -= dt;
  if (b.state === 'enter') {
    b.y += (ceilY - b.y) * Math.min(1, dt * 2.5);
    if (Math.abs(b.y - ceilY) < 1.5 && G.bossIntroT <= 0) { b.y = ceilY; b.state = 'idle'; b.st = 1; b.ready = true; shake(8); sfx('stomp'); }
    return;
  }
  if (b.state !== 'drill' || b.sub !== 1) b.face = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
  if (!(b.state === 'flip' && b.sub === 1)) for (const c of b.parts) {
    if (c.core || !c.alive) continue;
    c.cd -= dt * sp;
    if (c.cd <= 0) { c.cd = rnd(2.2, 3.0); const r = bossPartRect(b, c), cx = r.x + r.w / 2, cy = r.y + r.h / 2, a = angTo(cx, cy, p); for (let i = -1; i <= 1; i++) eShoot(cx, cy, a + i * 0.22, 115, 3); }
  }
  switch (b.state) {
    case 'idle':
      b.st -= dt * sp;
      if (b.st <= 0) {
        const opts = ['flip', 'flip', 'drill', 'spread'];
        if (G.enemies.filter(e => e.type === 'crawler').length < 3) opts.push('crawl');
        const s = chooseAttack(b, opts);
        if (s === 'flip') b.st = 0.55;
        if (s === 'drill') { b.st = 0.8; b.dir = b.face; }
        if (s === 'spread') { b.n = P2 ? 4 : 3; b.st = 0.3; }
        if (s === 'crawl') b.st = 0.5;
      }
      break;
    case 'flip':
      if (b.sub === 0) { b.st -= dt; if (Math.random() < 0.3) shake(1.5); if (b.st <= 0) { b.sub = 1; b.y0 = b.y; b.y1 = b.side > 0 ? ceilY : floorY; b.s = 0; sfx('flip'); } }
      else if (b.sub === 1) {
        b.s += dt * 1.8 * sp; const s = Math.min(1, b.s), e = s * s * (3 - 2 * s);
        b.y = b.y0 + (b.y1 - b.y0) * e;
        if (s >= 0.5) b.side = b.y1 > 120 ? 1 : -1;
        if (s >= 1) { b.y = b.y1; landWave(b); b.sub = 2; b.open = P2 ? 2.4 : 3.0; b.st = b.open; }
      } else { b.st -= dt; if (b.st <= 0) { b.state = 'idle'; b.st = 0.6; } }
      break;
    case 'drill':
      if (b.sub === 0) { b.st -= dt; if (Math.floor(b.st * 10) % 3 === 0) sfx('warn'); if (b.st <= 0) { b.sub = 1; sfx('dash'); } }
      else if (b.sub === 1) {
        b.x += b.dir * 300 * sp * dt; const minX = ax + 4, maxX = ax + W - b.w - 4;
        if (b.x <= minX || b.x >= maxX) { b.x = clamp(b.x, minX, maxX); b.sub = 2; b.st = 2.2; b.open = 2.2; shake(9); sfx('stomp'); spark(b.dir > 0 ? b.x + b.w : b.x, b.y + b.h / 2, '#ffd04a', 12); }
      } else { b.st -= dt; if (b.st <= 0) { b.state = 'idle'; b.st = 0.6; } }
      break;
    case 'spread':
      b.st -= dt;
      if (b.st <= 0) {
        if (b.n > 0) { b.n--; b.st = 0.45; const cx = b.x + b.w / 2, cy = b.y + (b.side > 0 ? 6 : b.h - 6), a = angTo(cx, cy, p), k = P2 ? 3 : 2; for (let i = -k; i <= k; i++) eShoot(cx, cy, a + i * 0.17, 125, 3); }
        else { b.state = 'idle'; b.st = 0.8; }
      }
      break;
    case 'crawl':
      b.st -= dt;
      if (b.st <= 0) { const other = b.side > 0 ? -1 : 1; for (let k = 0; k < 2; k++) { const x = ax + 50 + k * (W - 130); if (other < 0) spawnEnemy('crawler', x, ceilY, { gd: -1 }); else spawnEnemy('crawler', x, 13 * T - 10); } b.state = 'idle'; b.st = 0.8; }
      break;
  }
  if (b.ready) { const inner = { x: b.x + 6, y: b.y + 4, w: b.w - 12, h: b.h - 8 }; for (const q of G.players) if (alive(q) && overlap(q, inner)) hurtPlayer(q); }
}
function boss7(b, dt) { // ЛИНКОР
  const p = bossTarget(b), P2 = b.phase > 1;
  b.ex = G.cam.x + 160; b.ew = W - 180; b.ey = 40; b.eh = 170;
  const core = b.parts.find(q => q.core);
  core.shield = !b.atEnd;
  for (const pt of b.parts) {
    if (!pt.alive || pt.core) continue;
    const r = bossPartRect(b, pt), sx = r.x - G.cam.x;
    if (sx < 10 || sx > W - 10) continue;
    pt.cd -= dt; if (pt.cd > 0) continue;
    const cx = r.x + r.w / 2, cy = r.y + 2;
    if (pt.tur === 2) { pt.cd = rnd(2.6, 3.6); spawnEnemy('missile', cx, cy, { vx: -40, vy: -170 }); sfx('shootH'); }
    else { pt.cd = rnd(1.6, 2.4); const a = angTo(cx, cy, p); for (let i = -1; i <= 1; i++) eShoot(cx, cy, a + i * 0.14, 122, 3); }
  }
  if (!b.atEnd) return;
  if (!b.started) { b.started = true; b.state = 'idle'; b.st = 1.2; G.lockMsg = 'РЕАКТОР! ЦЕЛЬСЯ В ЯДРО'; G.lockMsgT = 2.2; sfx('alarm'); }
  const cr = bossPartRect(b, core), cx = cr.x + 22, cy = cr.y + 22;
  switch (b.state) {
    case 'idle':
      b.st -= dt;
      if (b.st <= 0) {
        const s = chooseAttack(b, ['fan', 'beam', 'fighters', 'fan', 'beam']);
        if (s === 'fan') { b.n = P2 ? 4 : 3; b.st = 0.2; }
        if (s === 'beam') { b.n = P2 ? 3 : 2; b.st = 0.1; }
        if (s === 'fighters') b.st = 0.3;
      }
      break;
    case 'fan':
      b.st -= dt;
      if (b.st <= 0) { if (b.n > 0) { b.n--; b.st = 0.6; const k = P2 ? 9 : 7; for (let i = 0; i < k; i++) eShoot(cx - 14, cy, Math.PI + (i - (k - 1) / 2) * 0.16, 118, 3); } else { b.state = 'idle'; b.st = 1; } }
      break;
    case 'beam':
      b.st -= dt;
      if (b.st <= 0) { if (b.n > 0) { b.n--; G.beams.push({ kind: 'h', y: rnd(30, 190), x1: G.cam.x - 10, x2: cx - 20, hh: 7, warn: 1.05, fire: 0.6, hint: 3 }); b.st = 0.95; } else { b.state = 'idle'; b.st = 1.1; } }
      break;
    case 'fighters':
      b.st -= dt;
      if (b.st <= 0) { const by = rnd(60, 160); for (let k = 0; k < 3; k++) spawnEnemy('fighter', G.cam.x + W + 10 + k * 24, by + (k - 1) * 22, { baseY: by + (k - 1) * 22 }); b.state = 'idle'; b.st = 1.2; }
      break;
  }
}
function boss8(b, dt) { // ПОЖИРАТЕЛЬ
  const p = bossTarget(b), P3 = b.phase >= 3;
  b.ang += (b.phase === 1 ? 0.7 : 1.1) * dt;
  const heart = b.parts.find(q => q.core);
  for (const f of b.parts) if (f.feed != null) { const a = b.ang + f.feed * Math.PI / 2; f.ox = 40 + Math.cos(a) * 92 - 8; f.oy = 40 + Math.sin(a) * 52 - 8; }
  if (b.state === 'enter') { b.grow = Math.min(1, b.grow + dt * 0.5); b.pull = 10; G.pullF += 10; if (b.grow >= 1 && G.bossIntroT <= 0) { b.state = 'idle'; b.st = 1; b.ready = true; } return; }
  let pull = b.phase === 1 ? 20 : 28;
  if (P3) {
    const prev = b.pulse % 6; b.pulse += dt; const cyc = b.pulse % 6;
    if (cyc < 3.2) {
      pull = 86; heart.shield = true; b.open = 0;
      if (prev >= 3.2 || b.pulse < dt * 1.5) { G.lockMsg = 'ДЕРЖИСЬ! БЕГИ ОТ ДЫРЫ ←'; G.lockMsgT = 1.6; sfx('suck'); }
      if (Math.random() < dt * 2.2) G.ebullets.push({ nid: NID++, kind: 'rock', x: G.cam.x - 10, y: 13 * T - rnd(10, 40), vx: 170, vy: 0, r: 6, life: 4, noTile: true });
    } else { pull = 16; heart.shield = false; b.open = 1; }
  } else if (b.phase === 2) { b.oc = (b.oc || 0) + dt; b.open = (b.oc % 5.6) < 3.2 ? 1 : 0; heart.shield = !b.open; }
  else { heart.shield = true; b.open = 0; }
  b.pull = pull; G.pullF += pull;
  for (const q of G.players) if (alive(q) && q.x + q.w > b.hx - 62) { hurtPlayer(q); q.x -= 50; q.vx = -80; }
  for (const e of G.enemies) if (!e.dead && !e.mini && e.x + e.w > b.hx - 50 && Math.abs(e.y + e.h / 2 - b.hy) < 120) killEnemy(e, null, true);
  const cx = b.hx, cy = b.hy;
  if (b.phase === 1) for (const f of b.parts) { if (f.feed == null || !f.alive) continue; f.cd -= dt; if (f.cd <= 0) { f.cd = rnd(2.2, 3); const r = bossPartRect(b, f); eShoot(r.x + 8, r.y + 8, angTo(r.x + 8, r.y + 8, p), 110, 3); } }
  switch (b.state) {
    case 'idle':
      b.st -= dt;
      if (b.st <= 0) {
        const opts = b.phase === 1 ? ['spiral', 'spiral', 'debris'] : P3 ? ['beams', 'spiral', 'fighters'] : ['beams', 'spiral', 'debris', 'fighters'];
        const s = chooseAttack(b, opts);
        if (s === 'spiral') { b.st = 2.2; b.emit = 0; }
        if (s === 'beams') { b.st = 3.6; b.n = 0; }
        if (s === 'debris') { b.n = 5; b.st = 0.3; }
        if (s === 'fighters') b.st = 0.4;
      }
      break;
    case 'spiral':
      b.st -= dt; b.emit = (b.emit || 0) - dt;
      if (b.emit <= 0) { b.emit = P3 ? 0.13 : 0.1; b.sp = (b.sp || 0) + 0.41; for (let k = 0; k < 2; k++) eShoot(cx, cy, b.sp + k * Math.PI, 80, 3); }
      if (b.st <= 0) { b.state = 'idle'; b.st = 1; }
      break;
    case 'beams':
      if (b.n === 0) { b.n = 1; const dir = Math.random() < 0.5 ? 1 : -1; G.beams.push({ kind: 'rot', ox: cx, oy: cy, a: Math.PI * (dir > 0 ? 0.62 : 1.38), va: dir * 1.0, warn: 1.1, fire: 2.4, hint: 4 }); }
      b.st -= dt; if (b.st <= 0) { b.state = 'idle'; b.st = 0.9; }
      break;
    case 'debris':
      b.st -= dt;
      if (b.st <= 0) { if (b.n > 0) { b.n--; b.st = 0.55; G.warns.push({ x: G.cam.x + 14, y: rnd(40, 13 * T - 30), t: 0.6, k: 'drock' }); } else { b.state = 'idle'; b.st = 1; } }
      break;
    case 'fighters':
      b.st -= dt;
      if (b.st <= 0) { for (let k = 0; k < 2; k++) { const y = 50 + k * 60; spawnEnemy('fighter', G.cam.x - 20, y, { baseY: y, rev: true }); } b.state = 'idle'; b.st = 1.2; }
      break;
  }
}

// ───────────────────────── графика главы 3 ─────────────────────────
const GLOW = new Map();
function glowSprite(c) {
  let s = GLOW.get(c);
  if (!s) {
    s = mkCanvas(32, 32); const g = s.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, hexA(c, 1)); gr.addColorStop(0.3, hexA(c, 0.45)); gr.addColorStop(1, hexA(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32); GLOW.set(c, s);
  }
  return s;
}
const HOT = { '#fff4c2': 1, '#ffd04a': 1, '#ff8a2a': 1, '#ff4a2a': 1, '#ffffff': 1, '#fff': 1, '#ffe2a0': 1 };
function lampI(l, tm) { if (!l.fl) return 1; return hash(Math.floor(tm * 9 + l.x * 0.13), l.x | 0) > 0.3 ? 1 : 0.15; }
// свечение: всё яркое светится поверх картинки
function glowPass() {
  const n = V.lv ? V.lv.n : 0, A = n >= 6 ? 1 : 0.7, cx = V.cam.x;
  ctx.globalCompositeOperation = 'lighter';
  const G2 = (x, y, r, c, a) => { if (x < cx - r || x > cx + W + r) return; ctx.globalAlpha = clamp(a * A, 0, 1); ctx.drawImage(glowSprite(c), x - r, y - r, r * 2, r * 2); };
  for (const b of V.pbullets) G2(b.x, b.y, b.type === 'F' ? 10 : b.type === 'L' ? 12 : b.type === 'G' ? 14 : 8, WCOL[b.type] || '#ffe066', 0.55);
  for (const b of V.ebullets) { const k = b.kind; if (!k || k === 'orb' || k === 'shard') G2(b.x, b.y, (b.r || 3) * 3.2, k === 'shard' ? '#7fdcff' : '#ff3b78', 0.6); else if (k === 'wave') G2(b.x, b.y, 14, '#ffb04a', 0.5); }
  let m = 0;
  for (const p of FXS.parts) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'flash') G2(p.x, p.y, p.s * 2.6, '#ffd890', a);
    else if (!p.kind && m < 140 && HOT[p.c]) { m++; G2(p.x, p.y, p.s * 2.2, p.c, 0.35 * a); }
  }
  for (const p of V.players) {
    if (!p.active || p.out || p.respawnT > 0 || p.downed) continue;
    const P = palOf(p.id);
    if (p.overT > 0) G2(p.x + p.w / 2, p.y + p.h / 2, 26, P.scarf, 0.45);
    if (p.role === 'p') G2(p.x - 4, p.y + 6, 14, '#ff9a3a', 0.7);
    else if (p.fly && !p.role) G2(p.x + (p.facing > 0 ? 0 : 10), p.y + 18, 9, '#ff9a3a', 0.6);
  }
  if (V.lv && V.lv.lamps) for (const l of V.lv.lamps) G2(l.x, l.y + 4, 22, l.col, lampI(l, V.lt || 0) * 0.7);
  for (const bo of FXS.bolts) for (const [x, y] of bo.pts) G2(x, y, 14, '#b49bff', 0.6);
  for (const s of V.sings || []) G2(s.x, s.y, s.r * 0.6, WCOL.G, 0.35);
  if (n >= 6) {
    for (const e of V.enemies) G2(e.x + e.w / 2, e.y + e.h / 2, 7, '#ff3b3b', 0.35);
    const b = V.boss;
    if (b && !b.dead) for (const pt of b.parts) if (pt.alive && (pt.core || pt.feed != null)) G2(b.x + pt.ox + pt.w / 2, b.y + pt.oy + pt.h / 2, pt.core ? 30 : 14, pt.feed != null ? '#c89bff' : b.kind === 7 ? '#ff9a3a' : '#ff3b5a', pt.shield ? 0.25 : 0.6);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}
// темнота: видно только то, что освещено
const lightC = mkCanvas(W, H), lightX = lightC.getContext('2d');
function darkPass(sx, sy) {
  const lc = lightX, ox = V.cam.x - sx, oy = -sy, S0 = glowSprite('#ffffff'), tm = V.lt || 0;
  lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.fillStyle = 'rgba(2,3,10,0.8)'; lc.fillRect(0, 0, W, H);
  lc.globalCompositeOperation = 'destination-out';
  const Lt = (x, y, r, a) => { const X = x - ox, Y = y - oy; if (X < -r || X > W + r || Y < -r || Y > H + r) return; lc.globalAlpha = clamp(a, 0, 1); lc.drawImage(S0, X - r, Y - r, r * 2, r * 2); };
  for (const l of V.lv.lamps || []) Lt(l.x, l.y + 8, 54, lampI(l, tm));
  for (const p of V.players) {
    if (!p.active || p.out || p.respawnT > 0) continue;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    Lt(px, py, 44, 1);
    if (!p.downed) { Lt(px + p.ax * 36, py + p.ay * 36, 34, 1); Lt(px + p.ax * 74, py + p.ay * 74, 44, 0.9); Lt(px + p.ax * 118, py + p.ay * 118, 54, 0.7); Lt(px + p.ax * 165, py + p.ay * 165, 58, 0.4); }
  }
  for (const b of V.pbullets) Lt(b.x, b.y, 18, 0.7);
  for (const b of V.ebullets) Lt(b.x, b.y, 14, 0.6);
  for (const e of V.enemies) Lt(e.x + e.w / 2, e.y + e.h / 2, 18, 0.32);
  for (const k of V.pickups) Lt(k.x + 6, k.y + 6, 18, 0.7);
  let m = 0;
  for (const p of FXS.parts) { const a = clamp(p.life / p.max, 0, 1); if (p.kind === 'flash' || p.kind === 'ring') Lt(p.x, p.y, (p.s || 10) * 2.6, a); else if (!p.kind && m < 60 && HOT[p.c]) { m++; Lt(p.x, p.y, 12, 0.4 * a); } }
  for (const bo of FXS.bolts) for (const [x, y] of bo.pts) Lt(x, y, 26, 0.7);
  for (const s of FXS.slashes) Lt(s.x + Math.cos(s.a) * s.r * 0.6, s.y + Math.sin(s.a) * s.r * 0.6, 34, 0.8);
  for (const bm of V.beams) if (bm.warn <= 0) { if (bm.kind === 'h') for (let x = bm.x1; x < bm.x2; x += 40) Lt(x, bm.y, 26, 0.8); }
  const b = V.boss;
  if (b && !b.dead) { Lt(b.x + b.w / 2, b.y + b.h / 2, 64, 0.45); for (const pt of b.parts) if (pt.core && pt.alive) Lt(b.x + pt.ox + pt.w / 2, b.y + pt.oy + pt.h / 2, 38, 0.8); }
  if (V.lock && V.lock.kind === 'airlock') Lt(V.cam.x + W - 14, 8 * T, 80, V.lock.ph === 'calm' ? 0.35 : 0.9);
  if (FXS.flash > 0) { lc.globalAlpha = Math.min(1, FXS.flash * 2); lc.fillRect(0, 0, W, H); }
  lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1;
  ctx.drawImage(lightC, 0, 0);
}
// вывод на экран: наезд, наклон камеры и расслоение цветов
const camFX = { z: 1, r: 0 };
const abR = mkCanvas(W, H), abRx = abR.getContext('2d'), abC = mkCanvas(W, H), abCx = abC.getContext('2d');
function camTarget() {
  let z = 1, r = 0; const b = V.boss;
  if (V.state !== 'play' && V.state !== 'clear') return [1, 0];
  if (b && V.bossIntroT > 0) z = 1 + 0.07 * Math.sin(Math.PI * clamp(1 - V.bossIntroT / 2.8, 0, 1));
  if (b && b.kind === 8 && b.phase >= 2 && !b.dead) { r = Math.sin((V.t || 0) * 0.33) * 0.05; z = Math.max(z, 1.1); }
  if (b && b.dead) z = Math.max(z, 1.05);
  return [z, r];
}
function blitWorld(inGame) {
  const sw = screen.width, sh = screen.height;
  const [tz, tr] = inGame ? camTarget() : [1, 0];
  camFX.z += (tz - camFX.z) * 0.08; camFX.r += (tr - camFX.r) * 0.08;
  const z = camFX.z, rot = camFX.r, ab = inGame ? FXS.ab : 0;
  const tf = Math.abs(z - 1) > 0.002 || Math.abs(rot) > 0.001;
  const draw = (img, ox) => {
    if (tf) { sctx.setTransform(1, 0, 0, 1, sw / 2, sh / 2); sctx.rotate(rot); sctx.scale(z, z); sctx.drawImage(img, -sw / 2 + ox, -sh / 2, sw, sh); sctx.setTransform(1, 0, 0, 1, 0, 0); }
    else sctx.drawImage(img, ox, 0, sw, sh);
  };
  if (tf || ab > 0.02) { sctx.fillStyle = '#000'; sctx.fillRect(0, 0, sw, sh); }
  if (ab > 0.02) {
    for (const [cx2, col] of [[abRx, '#ff0000'], [abCx, '#00ffff']]) { cx2.globalCompositeOperation = 'source-over'; cx2.drawImage(buf, 0, 0); cx2.globalCompositeOperation = 'multiply'; cx2.fillStyle = col; cx2.fillRect(0, 0, W, H); cx2.globalCompositeOperation = 'source-over'; }
    const k = ab * 3.2 * S;
    draw(abR, -k); sctx.globalCompositeOperation = 'lighter'; draw(abC, k); sctx.globalCompositeOperation = 'source-over';
  } else draw(buf, 0);
}
// передний план: балки и обломки быстрее камеры
function drawFG() {
  const n = V.lv.n; if (n < 6) return;
  const cx = V.cam.x, tm = V.t || 0;
  if (n === 6) {
    for (let k = 0; k < 3; k++) {
      const per = 760, sx = ((k * 271 - cx * 0.35) % per + per) % per - 120, x = Math.round(cx + sx);
      R(x, 0, 12, H, '#05060a'); R(x + 1, 0, 1, H, '#1a1e2a');
      ctx.strokeStyle = '#05060a'; ctx.lineWidth = 3;
      for (let y = 30; y < H; y += 70) { ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 40, y + 34); ctx.stroke(); }
      if (Math.floor(tm * 2 + k) % 2) R(x + 4, 22, 4, 3, '#ff3b3b');
    }
    return;
  }
  ctx.globalAlpha = n === 7 ? 0.7 : 0.85;
  for (let k = 0; k < (n === 7 ? 2 : 3); k++) {
    const per = 900, sx = ((k * 389 - cx * 0.5 - tm * (n === 7 ? 40 : 10)) % per + per) % per - 140, x = cx + sx, y = 30 + ((k * 97) % 180), s = 14 + (k * 7) % 18;
    ctx.fillStyle = '#07060c'; ctx.beginPath();
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + tm * 0.3 * (k % 2 ? 1 : -1), rr = s * (0.7 + 0.3 * hash(k, i)); i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.strokeStyle = n === 7 ? '#3a2a30' : '#2a2040'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawLamps() {
  const L = V.lv; if (!L.lamps || !L.lamps.length) return;
  const cx = V.cam.x, tm = V.lt || 0;
  for (const l of L.lamps) { if (l.x < cx - 20 || l.x > cx + W + 20) continue; const on = lampI(l, tm) > 0.5; R(l.x - 6, l.y, 12, 3, '#3a4258'); R(l.x - 4, l.y + 3, 8, 2, on ? l.col : '#2a2e38'); }
}
function drawWells() {
  const L = V.lv; if (!L.wells) return;
  const cx = V.cam.x, tm = V.lt || 0;
  for (const w of L.wells) {
    if (w.x < cx - 100 || w.x > cx + W + 100) continue;
    const g = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, w.r);
    g.addColorStop(0, 'rgba(8,0,18,0.95)'); g.addColorStop(0.16, 'rgba(70,24,120,0.5)'); g.addColorStop(0.5, 'rgba(120,60,200,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(w.x - w.r, w.y - w.r, w.r * 2, w.r * 2);
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(200,155,255,0.4)'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); for (let i = 0; i <= 22; i++) { const f = i / 22, a = tm * 1.6 * w.sp + k * 1.571 + f * 4.2 * w.sp, rr = 6 + f * w.r * 0.85; const x = w.x + Math.cos(a) * rr, y = w.y + Math.sin(a) * rr * 0.9; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    for (let i = 0; i < 12; i++) { const f = ((tm * 0.45 + i / 12) % 1), rr = w.r * (1 - f), a = i * 2.1 + f * 5 * w.sp; R(Math.round(w.x + Math.cos(a) * rr), Math.round(w.y + Math.sin(a) * rr * 0.9), 1, 1, '#f0dcff'); }
    ctx.globalCompositeOperation = 'source-over';
    circ(w.x, w.y, 5, '#05010a'); ctx.strokeStyle = '#c89bff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w.x, w.y, 6.5, 0, 6.283); ctx.stroke();
  }
}
const PLC = [['#8a6a5a', '#5a4038', '#e8b090'], ['#5a7a9a', '#38506a', '#a0d8ff'], ['#7a5a9a', '#4a3868', '#d8a8ff'], ['#6a8a5a', '#405a38', '#b8f0a0'], ['#9a7a4a', '#6a5030', '#ffd890']];
function planetSprite(P) {
  if (P.spr) return P.spr;
  const d = Math.ceil(P.r * 2) + 2, c = mkCanvas(d, d), g = c.getContext('2d'), col = PLC[P.hue], rg = mulberry(P.seed);
  g.fillStyle = col[0]; g.beginPath(); g.arc(d / 2, d / 2, P.r, 0, 6.283); g.fill();
  g.save(); g.beginPath(); g.arc(d / 2, d / 2, P.r, 0, 6.283); g.clip();
  g.globalAlpha = 0.35; g.fillStyle = col[1]; for (let i = 0; i < 5; i++) g.fillRect(0, rg() * d, d, 2 + rg() * 5);
  g.globalAlpha = 1;
  for (let i = 0; i < 9; i++) { const x = rg() * d, y = rg() * d, rr = 2 + rg() * P.r * 0.25; g.fillStyle = col[1]; g.beginPath(); g.arc(x, y, rr, 0, 6.283); g.fill(); g.globalAlpha = 0.5; g.fillStyle = col[2]; g.beginPath(); g.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.45, 0, 6.283); g.fill(); g.globalAlpha = 1; }
  g.restore();
  P.spr = c; return c;
}
function drawPlanets() {
  const L = V.lv; if (!L.planets) return;
  const cx = V.cam.x, tm = V.t || 0;
  for (const P of L.planets) {
    if (P.x + P.r * 1.6 < cx || P.x - P.r * 1.6 > cx + W) continue;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45; ctx.drawImage(glowSprite(PLC[P.hue][2]), P.x - P.r * 1.55, P.y - P.r * 1.55, P.r * 3.1, P.r * 3.1); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const s = planetSprite(P), d = s.width;
    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(tm * P.spin); ctx.drawImage(s, -d / 2, -d / 2); ctx.restore();
    const g = ctx.createRadialGradient(P.x - P.r * 0.4, P.y - P.r * 0.4, P.r * 0.1, P.x, P.y, P.r * 1.02);
    g.addColorStop(0, 'rgba(255,255,255,0.2)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,12,0.62)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, P.r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = hexA(PLC[P.hue][2], 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 0.5, 0, 6.283); ctx.stroke();
  }
}
function drawTether() {
  if (!(V.tether > 0)) return;
  const ps = V.players.filter(q => q.active && !q.out && !q.downed && !(q.respawnT > 0)); if (ps.length < 2) return;
  const [a, b] = ps, ax = a.x + a.w / 2, ay = a.y + 11, bx = b.x + b.w / 2, by = b.y + 11, t = V.tether;
  const mx = (ax + bx) / 2, my = (ay + by) / 2 + 22 * (1 - t);
  ctx.strokeStyle = t > 0.85 ? '#ff8a6a' : '#9fe6ff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
  ctx.globalAlpha = 0.25; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
}
function drawSings() {
  const tm = V.t || 0;
  for (const s of V.sings || []) {
    const rr = s.r * 0.32;
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(90,255,209,0.38)'; ctx.lineWidth = 1;
    for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(s.x, s.y, rr * 0.7 + k * 5, (rr * 0.7 + k * 5) * 0.4, tm * (2 + k) + k, 0, 6.283); ctx.stroke(); }
    for (let i = 0; i < 10; i++) { const f = ((tm * 1.4 + i / 10) % 1), d = s.r * (1 - f), a = i * 2.4 + f * 4; R(Math.round(s.x + Math.cos(a) * d), Math.round(s.y + Math.sin(a) * d), 2, 2, '#c8fff0'); }
    ctx.globalCompositeOperation = 'source-over';
    circ(s.x, s.y, 6 + Math.sin(tm * 20) * 1, '#020806'); ctx.strokeStyle = '#5affd1'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, 7.5, 0, 6.283); ctx.stroke();
  }
}
function drawSlashes() {
  for (const s of FXS.slashes) {
    const a = clamp(s.life / 0.16, 0, 1), k = 1 - a;
    ctx.globalAlpha = a; ctx.lineCap = 'round';
    ctx.strokeStyle = s.c; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.65 + k * 0.25), s.a - 1.15, s.a + 1.15); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.7 + k * 0.25), s.a - 0.9, s.a + 0.9); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }
}
function drawAirlock() {
  const L = V.lock, x = V.cam.x + W - 14, tm = V.t || 0, ph = L.ph, top = 3 * T, bot = 13 * T, cy = 8 * T, open = ph === 'suck', bl = Math.floor(tm * 8) % 2;
  R(x, top, 14, bot - top, '#2a3042'); R(x, top, 2, bot - top, '#4a5468');
  for (let yy = top + 6; yy < bot; yy += 12) R(x + 4, yy, 8, 3, '#1a1e2a');
  ctx.fillStyle = open ? '#000000' : '#3a4258'; ctx.beginPath(); ctx.arc(x + 2, cy, 34, Math.PI / 2, Math.PI * 1.5); ctx.fill();
  if (open) { for (let k = 0; k < 9; k++) R(Math.round(x - 6 - hash(k, 3) * 26), Math.round(cy - 28 + hash(k, 7) * 56), 1, 1, '#ffffff'); }
  else { R(x - 30, cy - 1, 32, 2, '#262a36'); for (let k = -2; k <= 2; k++) R(x - 6 - Math.abs(k) * 4, cy + k * 12 - 1, 3, 3, '#7a8496'); }
  ctx.strokeStyle = open || (ph === 'warn' && bl) ? '#ff3b3b' : '#7a8496'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + 2, cy, 34, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
  for (let k = 0; k < 4; k++) { R(x, top + k * 6, 14, 3, k % 2 ? '#ffc23a' : '#1a1a1a'); R(x, bot - 24 + k * 6, 14, 3, k % 2 ? '#ffc23a' : '#1a1a1a'); }
  if (open) {
    ctx.strokeStyle = 'rgba(220,235,255,0.45)'; ctx.lineWidth = 1;
    for (let k = 0; k < 26; k++) { const y0 = top + 8 + (k * 37) % (bot - top - 16), f = (tm * 2.2 + k * 0.13) % 1, xs = V.cam.x + 10 + f * (W - 40), yy = y0 + (cy - y0) * f * 0.6; ctx.beginPath(); ctx.moveTo(xs, yy); ctx.lineTo(xs + 18, yy + (cy - y0) * 0.04); ctx.stroke(); }
  }
  if (ph !== 'calm') for (let k = 0; k < 4; k++) R(Math.round(V.cam.x + 40 + k * 110), top, 10, 3, bl ? '#ff3b3b' : '#5a1a1a');
  R(V.cam.x, 7 * T, 6, 6 * T, '#2a3042'); R(V.cam.x + 4, 7 * T, 2, 6 * T, '#ffc23a');
}
function drawEnemyT(e) {
  const gd = e.gd || 1, rot = (e.type === 'pturret' || e.type === 'orbiter') ? (e.rot || 0) : 0;
  if (gd > 0 && !rot) return drawEnemy(e);
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  let q = e;
  ctx.save(); ctx.translate(cx, cy);
  if (rot) { ctx.rotate(rot); q = Object.assign({}, e, { aim: (e.aim || 0) - rot }); }
  if (gd < 0) { ctx.scale(1, -1); q = Object.assign({}, q, { aim: -(q.aim || 0) }); }
  ctx.translate(-cx, -cy);
  try { drawEnemy(q); } finally { ctx.restore(); }
}
function drawEnemy3(e, x, y, f, C, tm) {
  switch (e.type) {
    case 'swarm': {
      const fl = Math.floor(tm * 20 + (e.nid || 0)) % 2;
      R(x + 1, y + 2, 8, 4, C('#6a5a80')); R(x, y + 3, 2, 2, C('#ff3b78')); R(x + 8, y, 2, 8, C('#4a3a5e')); R(x + 9, y + 3, 2, 2, fl ? '#7ff0ff' : '#3fb6ff');
      return true;
    }
    case 'gunship': {
      const fl = Math.floor(tm * 24) % 2;
      R(x - 4, y + 6, 5, 4, fl ? '#ffd04a' : '#ff6a2a');
      R(x, y + 4, 30, 8, C('#5a4a5a')); R(x + 4, y + 2, 20, 3, C('#7a6a7a')); R(x + 2, y + 12, 22, 3, C('#3a2e3a'));
      R(x + 6, y - 2, 10, 4, C('#3a2e3a')); R(x + 24, y + 6, 8, 4, C('#2a222a')); R(x + 30, y + 7, 4, 2, C('#9aa1b2'));
      R(x + 18, y + 5, 4, 2, '#ff3b3b');
      return true;
    }
    case 'pturret': {
      R(x, y + 6, 14, 6, C('#3a2e4a')); R(x + 2, y + 2, 10, 6, C('#6a5a80')); R(x + 4, y, 6, 3, C('#9a8ab0'));
      for (let i = 2; i <= 11; i++) R(Math.round(x + 7 + Math.cos(e.aim || 0) * i) - 1, Math.round(y + 4 + Math.sin(e.aim || 0) * i) - 1, 2, 2, C(i > 9 ? '#c89bff' : '#2a2238'));
      R(x + 6, y + 3, 2, 2, Math.floor(tm * 4) % 2 ? '#ff3b3b' : '#5a1a1a');
      return true;
    }
    case 'orbiter': {
      const fr = Math.floor((e.t || 0) * 10) % 2;
      R(x + 2 + fr, y + 10, 3, 4, C(EC.dark)); R(x + 7 - fr, y + 10, 3, 4, C(EC.dark));
      R(x + 1, y + 3, 10, 8, C('#4a6a5a')); R(x + 2, y, 8, 5, C('#6a9a7a')); R(x + (f > 0 ? 6 : 2), y + 2, 4, 2, C('#ffe066'));
      return true;
    }
  }
  return false;
}
// корабль: корпус пилота, турель стрелка
function drawShip(p, isMe) {
  const tm = V.t || 0, S = V.ship;
  if (S && S.inv > 0 && Math.floor(tm * 24) % 2 === 0) return;
  const x = Math.round(p.x), y = Math.round(p.y), P = palOf(p.id);
  const gun = V.players.find(q => q.role === 'g' && q.active && !q.out);
  const roll = p.dashT > 0 ? Math.cos((0.36 - p.dashT) / 0.36 * 6.283) : 1, sy = (roll < 0 ? -1 : 1) * Math.max(0.2, Math.abs(roll));
  const fl = Math.floor(tm * 30) % 2;
  ctx.save(); ctx.translate(x + 12, y + 6); ctx.scale(1, sy); ctx.translate(-(x + 12), -(y + 6));
  R(x - 7 - fl * 2, y + 4, 8 + fl * 2, 4, fl ? '#ffd04a' : '#ff8a2a'); R(x - 3, y + 5, 4, 2, '#ffffff');
  R(x + 2, y - 2, 11, 3, '#3a4258'); R(x + 2, y + 11, 11, 3, '#3a4258'); R(x + 3, y - 3, 6, 1, P.armorD); R(x + 3, y + 14, 6, 1, P.armorD);
  R(x, y + 2, 20, 8, '#8a96b0'); R(x + 2, y + 3, 17, 2, '#c8d8f0'); R(x, y + 8, 20, 2, '#4a5468');
  R(x + 18, y + 4, 6, 4, '#8a96b0'); R(x + 22, y + 5, 3, 2, '#c8d8f0');
  R(x + 3, y + 6, 10, 2, P.armor);
  R(x + 12, y + 1, 7, 5, '#1a2a3a'); R(x + 13, y + 2, 4, 3, P.armor); R(x + 15, y + 2, 2, 1, P.visor);
  ctx.restore();
  const tx = x + 13, ty = y - 3, GP = gun ? palOf(gun.id) : P;
  const ta = gun ? Math.atan2(gun.ay, gun.ax) : (S ? S.ta || 0 : 0);
  R(tx - 4, ty, 8, 3, '#4a5468'); R(tx - 3, ty - 3, 6, 4, gun ? GP.armor : '#6a7488'); if (gun) R(tx - 1, ty - 2, 3, 1, GP.visor);
  for (let i = 2; i <= 9; i++) R(Math.round(tx + Math.cos(ta) * i) - 1, Math.round(ty - 1 + Math.sin(ta) * i) - 1, 2, 2, i > 7 ? '#e8eef8' : '#9aa4b8');
  if (p.overT > 0) { ctx.globalAlpha = 0.25 + 0.15 * Math.sin(tm * 30); R(x - 4, y - 6, 32, 22, P.scarf); ctx.globalAlpha = 1; }
  const meG = gun && NET.mode !== 'local' && gun.id === myId();
  if ((isMe || meG) && NET.mode !== 'local') { const c = meG ? GP.scarf : P.scarf, ax0 = meG ? tx - 2 : x + 10, ay0 = meG ? ty - 10 : y - 10 - Math.abs(Math.sin(tm * 4)) * 2; R(ax0, ay0, 4, 1, c); R(ax0 + 1, ay0 + 1, 2, 1, c); }
}
function drawBoarder(b) {
  const tm = V.t || 0, x = Math.round(b.x), y = Math.round(b.y), f = b.face || -1;
  ctx.save(); if ((b.side || 1) < 0) { ctx.translate(0, 2 * y + b.h); ctx.scale(1, -1); }
  const eye = b.parts.find(q => q.core);
  for (let k = 0; k < 4; k++) { const lx = x + 8 + k * 19; R(lx, y + 30, 5, 7, '#2a2e38'); R(lx - 2, y + 36, 9, 4, '#4a5060'); }
  R(x + 4, y + 12, 72, 20, '#3e4658'); R(x + 8, y + 8, 64, 6, '#5a6478'); R(x + 10, y + 7, 60, 1, '#8a96b0'); R(x + 4, y + 28, 72, 4, '#262a36');
  for (let k = 0; k < 6; k++) R(x + 10 + k * 11, y + 30, 6, 2, '#ffc23a');
  const dx = f > 0 ? x + 76 : x + 4, sp = b.state === 'drill' ? 30 : 6;
  ctx.fillStyle = '#9aa1b2'; ctx.beginPath(); ctx.moveTo(dx, y + 12); ctx.lineTo(dx + f * 22, y + 21); ctx.lineTo(dx, y + 30); ctx.closePath(); ctx.fill();
  for (let k = 0; k < 4; k++) { const o = (tm * sp + k * 5) % 20; R(Math.round(dx + f * o * 0.95) - (f < 0 ? 2 : 0), Math.round(y + 13 + o * 0.42), 2, Math.max(1, Math.round(16 - o * 0.8)), '#5b6170'); }
  if (b.state === 'drill' && b.sub === 0 && Math.floor(tm * 12) % 2) R(dx + f * 6 - 3, y + 18, 6, 6, '#ff3b3b');
  for (const c of b.parts) {
    if (c.core) continue; const cx = x + c.ox, cy = y + c.by;
    if (!c.alive) { R(cx + 2, cy + 2, 12, 8, '#1a1418'); if (Math.floor(tm * 10) % 3 === 0) R(cx + 4 + Math.random() * 8, cy + 3, 2, 2, '#ffd04a'); continue; }
    const fl = c.flash > 0; R(cx, cy, 16, 12, fl ? '#fff' : '#5b6170'); R(cx + 2, cy + 2, 12, 3, fl ? '#fff' : '#9aa1b2'); R(cx + 5, cy + 6, 6, 4, '#ff6a3a');
  }
  if (eye) {
    const ex = x + eye.ox, ey = y + eye.by, fl = eye.flash > 0, op = (b.open || 0) > 0;
    const ew = eye.w, eh = eye.h;
    R(ex - 2, ey - 2, ew + 4, eh + 4, '#262a36');
    if (op) { R(ex, ey, ew, eh, fl ? '#fff' : '#3a0a10'); R(ex + 4, ey + 3, ew - 8, eh - 6, fl ? '#fff' : '#ff3b3b'); R(ex + ew / 2 - 3, ey + eh / 2 - 3, 6, 6, '#ffffff'); }
    else { R(ex, ey, ew, eh, fl ? '#fff' : '#5a6478'); R(ex, ey + eh / 2 - 1, ew, 2, '#262a36'); R(ex + ew / 2 - 1, ey, 2, eh, '#262a36'); R(ex + 3, ey + 2, ew - 6, 1, '#8a96b0'); }
  }
  if (b.phase > 1 && Math.floor(tm * 6) % 2) R(x + 20, y + 14, 3, 3, '#ff6a3a');
  ctx.restore();
}
function drawLinkor(b) {
  const tm = V.t || 0, cx = V.cam.x, p0 = V.players.find(q => q.role === 'p') || { x: cx + 100, y: 120, w: 24, h: 12 };
  for (let k = 0; k < 14; k++) { const x = b.x + 40 + k * 100; if (x < cx - 40 || x > cx + W + 40) continue; R(x, 14 * T - 2, 30, 2, '#5a5266'); if (Math.floor(tm * 2 + k) % 3 === 0) R(x + 12, 14 * T + 5, 3, 3, '#ff7a3a'); }
  for (const pt of b.parts) {
    const x = Math.round(b.x + pt.ox), y = Math.round(b.y + pt.oy); if (x < cx - 80 || x > cx + W + 80) continue;
    const fl = pt.flash > 0;
    if (pt.core) {
      const ccx = x + 22, ccy = y + 22, pulse = Math.sin(tm * (b.phase > 1 ? 12 : 5)) * 2;
      R(x - 8, y + 30, 60, 22, '#2a2632'); R(x - 4, y - 6, 52, 40, '#33303e');
      for (let k = 0; k < 4; k++) R(x - 2 + k * 13, y + 36, 8, 3, Math.floor(tm * 4 + k) % 2 ? '#ff7a3a' : '#5a2a1a');
      ctx.strokeStyle = '#6e6880'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(ccx, ccy, 24, 9, tm * 0.8, 0, 6.283); ctx.stroke(); ctx.beginPath(); ctx.ellipse(ccx, ccy, 24, 9, -tm * 0.8 + 1, 0, 6.283); ctx.stroke();
      circ(ccx, ccy, 16, '#120c10'); circ(ccx, ccy, 11 + pulse, fl ? '#ffffff' : b.phase > 1 ? '#ffe6a0' : '#ff7a3a'); circ(ccx, ccy, 4, '#ffffff');
      if (pt.shield && pt.alive) { ctx.strokeStyle = `rgba(127,240,255,${0.45 + 0.25 * Math.sin(tm * 6)})`; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * 6.283 + tm * 0.4, px = ccx + Math.cos(a) * 28, py = ccy + Math.sin(a) * 28; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
    } else if (!pt.alive) { R(x + 2, y + 4, pt.w - 4, pt.h - 4, '#1a1418'); if (Math.floor(tm * 10) % 3 === 0) R(x + 4 + Math.random() * 10, y + 4, 2, 2, '#ffd04a'); }
    else if (pt.tur === 2) { R(x, y, 22, 10, fl ? '#fff' : '#4e4860'); R(x + 3, y + 2, 7, 6, '#1a1722'); R(x + 12, y + 2, 7, 6, '#1a1722'); R(x, y, 22, 2, '#8a8098'); }
    else {
      R(x, y + 4, 20, 8, fl ? '#fff' : '#4e4860'); R(x + 4, y, 12, 6, fl ? '#fff' : '#6e6880');
      const a = Math.atan2(p0.y + 6 - (y + 3), p0.x + 12 - (x + 10));
      for (let i = 2; i <= 12; i++) R(Math.round(x + 10 + Math.cos(a) * i) - 1, Math.round(y + 3 + Math.sin(a) * i) - 1, 2, 2, i > 10 ? '#ffb06a' : '#2a2632');
      R(x + 9, y + 2, 2, 2, '#ff3b3b');
    }
  }
}
function drawDisk(hx, hy, R0, tm, front) {
  const tilt = -0.14;
  ctx.globalCompositeOperation = 'lighter';
  const rings = [[2.7, 0.55, 'rgba(255,90,40,0.35)', 5], [2.2, 0.46, 'rgba(255,150,60,0.5)', 4], [1.75, 0.37, 'rgba(255,210,140,0.6)', 3], [1.4, 0.3, 'rgba(255,245,220,0.75)', 2]];
  for (const [rx, ry, c, lw] of rings) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.ellipse(hx, hy, R0 * rx, R0 * rx * ry, tilt, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke(); }
  for (let i = 0; i < 46; i++) {
    const rr = R0 * (1.35 + (i % 9) * 0.16), sp = 2.2 / (1 + (i % 9) * 0.3), a = tm * sp + i * 2.39;
    const s = Math.sin(a); if ((s > 0) !== front) continue;
    const lx = Math.cos(a) * rr, ly = s * rr * 0.36, x = hx + lx * Math.cos(tilt) - ly * Math.sin(tilt), y = hy + lx * Math.sin(tilt) + ly * Math.cos(tilt);
    R(Math.round(x), Math.round(y), 2, 1, i % 3 ? '#ffd9a0' : '#ffffff');
  }
  ctx.globalCompositeOperation = 'source-over';
}
function drawDevourer(b) {
  const tm = V.t || 0, hx = b.hx, hy = b.hy, g = b.state === 'enter' ? (b.grow || 0) : 1, R0 = 30 * Math.max(0.05, g);
  const gr = ctx.createRadialGradient(hx, hy, R0 * 0.8, hx, hy, R0 * 4.4);
  gr.addColorStop(0, 'rgba(255,170,90,0.32)'); gr.addColorStop(0.25, 'rgba(150,70,200,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr; ctx.fillRect(hx - R0 * 4.4, hy - R0 * 4.4, R0 * 8.8, R0 * 8.8);
  const pull = b.pull || 0;
  if (pull > 0) { ctx.strokeStyle = `rgba(230,210,255,${clamp(pull / 120, 0.08, 0.5)})`; ctx.lineWidth = 1; for (let k = 0; k < 30; k++) { const f = (tm * (0.25 + pull / 260) + k / 30) % 1, a = k * 2.399, d = 260 * (1 - f) + R0, x0 = hx + Math.cos(a) * d, y0 = hy + Math.sin(a) * d * 0.7; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (hx - x0) * 0.08, y0 + (hy - y0) * 0.08); ctx.stroke(); } }
  drawDisk(hx, hy, R0, tm, false);
  circ(hx, hy, R0, '#000000');
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,220,170,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, R0 + 1.5, 0, 6.283); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,170,90,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(hx, hy - R0 * 0.1, R0 * 1.3, R0 * 1.05, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  drawDisk(hx, hy, R0, tm, true);
  const heart = b.parts.find(q => q.core);
  if (heart && heart.alive && b.phase >= 2) {
    const fl = heart.flash > 0, op = (b.open || 0) > 0, pr = 7 + Math.sin(tm * 9) * 1.5;
    if (op) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glowSprite('#ff3fb4'), hx - 30, hy - 30, 60, 60); ctx.globalCompositeOperation = 'source-over'; circ(hx, hy, pr + 3, fl ? '#ffffff' : '#ff3fb4'); circ(hx, hy, pr * 0.55, '#ffffff'); }
    else { circ(hx, hy, 6, '#3a1030'); ctx.strokeStyle = `rgba(127,240,255,${0.4 + 0.25 * Math.sin(tm * 6)})`; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * 6.283 + tm * 0.6, px = hx + Math.cos(a) * 15, py = hy + Math.sin(a) * 15; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
  }
  for (const f of b.parts) {
    if (f.feed == null || !f.alive) continue;
    const fx = b.x + f.ox + 8, fy = b.y + f.oy + 8, fl = f.flash > 0;
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(200,155,255,${0.35 + 0.2 * Math.sin(tm * 8 + f.feed)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(hx, hy); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = fl ? '#ffffff' : '#9a6ad8'; ctx.beginPath(); ctx.moveTo(fx, fy - 9); ctx.lineTo(fx + 7, fy); ctx.lineTo(fx, fy + 9); ctx.lineTo(fx - 7, fy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = fl ? '#ffffff' : '#e8d0ff'; ctx.beginPath(); ctx.moveTo(fx, fy - 5); ctx.lineTo(fx + 3, fy); ctx.lineTo(fx, fy + 5); ctx.lineTo(fx - 3, fy); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,90,60,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(hx - 56, 3 * T); ctx.lineTo(hx - 56, 13 * T); ctx.stroke(); ctx.setLineDash([]);
}
function drawHUD3(b) {
  const tm = V.t || 0, S = V.ship;
  if (S) {
    const off = V.combo >= 6 ? 9 : 0, bw = 7, w0 = S.max * (bw + 2);
    txt('КОРАБЛЬ', W / 2, 27 + off, 7, '#9fe6ff', 'center');
    for (let i = 0; i < S.max; i++) { const px = W / 2 - w0 / 2 + i * (bw + 2); rectUI(px, 37 + off, bw, 6, '#0a0a12'); rectUI(px + 1, 38 + off, bw - 2, 4, i < S.hp ? (S.hp === 1 ? (blink(6) ? '#ff4a4a' : '#ff9a9a') : '#7ff0ff') : '#2a2430'); }
  }
  if (V.lock && V.lock.kind === 'airlock') {
    txt('ЦИКЛ ' + Math.min(3, (V.lock.cyc | 0) + 1) + ' / 3', W / 2, 36, 8, '#ff9a6a', 'center');
    if (V.lock.ph === 'warn' || V.lock.ph === 'suck') txt('СТИК К ПОЛУ ИЛИ ПОТОЛКУ — БОТИНКИ ДЕРЖАТ', W / 2, 150, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  }
  for (const bm of V.beams) {
    if (bm.hint === 3 && bm.warn > 0) txt('УЙДИ С ЛУЧА ↑↓', W / 2, 150, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
    if (bm.hint === 4 && (bm.warn > 0 || bm.fire > 1.6)) txt('РЫВОК СКВОЗЬ ЛУЧ!', W / 2, 150, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  }
  if (b && b.kind === 6 && b.ready && !b.dead) {
    if ((b.open || 0) > 0) txt('ГЛАЗ ОТКРЫТ — ОГОНЬ!', W / 2, 44, 9, '#ff6a6a', 'center');
    else if (b.state === 'drill' && b.sub === 0) txt('БУР! УХОДИ НА ДРУГУЮ СТОРОНУ', W / 2, 150, 10, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
  }
  if (b && b.kind === 8 && b.ready && !b.dead) {
    if (b.phase >= 3 && b.pull > 60) txt('ДЕРЖИСЬ! БЕГИ ←', W / 2, 150, 12, blink(8) ? '#ff4a4a' : '#ffffff', 'center');
    else if (b.phase === 1) txt('СБЕЙ КРИСТАЛЛЫ-КОРМИЛЬЦЫ', W / 2, 44, 8, '#c89bff', 'center');
    else if ((b.open || 0) > 0) txt('СЕРДЦЕ ОТКРЫТО — ПУЛИ САМИ ЛЕТЯТ В ДЫРУ!', W / 2, 44, 8, '#ff9adf', 'center');
  }
  const L = V.lv;
  if (L && L.walls && L.walls.length && V.state === 'play') {
    for (const w of L.walls.slice(0, 2)) {
      const wx = w.c * T;
      if (!V.players.some(q => q.active && !q.downed && q.x > wx - 110 && q.x < wx && ((q.gd || 1) > 0) === (w.side > 0))) continue;
      txt(w.side > 0 ? 'ПРЫЖОК, В ВОЗДУХЕ ЕЩЁ ПРЫЖОК — НА ПОТОЛОК' : 'ПРЫЖОК, ЕЩЁ ПРЫЖОК — ОБРАТНО НА ПОЛ', W / 2, 120, 9, blink(3) ? '#ffd04a' : '#ffffff', 'center');
    }
  }
}

// ── фоны главы 3: туманности и звёзды в несколько слоёв
function nebulaOn(c, rng, cols, n, w, h) {
  for (let i = 0; i < n; i++) {
    const [col, a] = cols[i % cols.length], x = rng() * w, y = rng() * h, r = 40 + rng() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0));
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function starsOn(c, rng, n, w, h, big) {
  for (let i = 0; i < n; i++) { const k = rng(); c.fillStyle = k < 0.15 ? '#ffe6c0' : k < 0.3 ? '#c0d8ff' : '#ffffff'; c.globalAlpha = 0.25 + rng() * 0.75; const s = big && rng() < 0.12 ? 2 : 1; c.fillRect(Math.floor(rng() * w), Math.floor(rng() * h), s, s); }
  c.globalAlpha = 1;
}
function buildBG3(th, rng, sc, layers, grad) {
  if (th === 6) {
    grad([[0, '#03040a'], [0.6, '#080b16'], [1, '#121828']]);
    nebulaOn(sc, rng, [['#3a1a5a', 0.22], ['#1a3a6a', 0.2], ['#5a1a2a', 0.12]], 7, W, H);
    starsOn(sc, rng, 120, W, H, true);
    const far = mkCanvas(960, 240), fc = far.getContext('2d');
    for (let x = 0; x < 960; x += 120) {
      fc.fillStyle = '#0b0e17'; fc.fillRect(x, 0, 22, 240); fc.fillRect(x - 40, 0, 102, 14); fc.fillRect(x - 40, 220, 102, 20);
      fc.beginPath(); fc.moveTo(x + 22, 14); fc.quadraticCurveTo(x + 70, 30, x + 98, 14); fc.lineTo(x + 98, 22); fc.quadraticCurveTo(x + 70, 38, x + 22, 22); fc.fill();
      fc.fillStyle = rng() < 0.5 ? '#ff3b3b' : '#3fb6ff'; fc.fillRect(x + 9, 40 + rng() * 150, 3, 3);
    }
    layers.push({ c: far, sp: 0.22, y: 16 });
    const mid = mkCanvas(960, 200), mc = mid.getContext('2d');
    for (let x = 0; x < 960; x += 70 + rng() * 60) {
      mc.fillStyle = '#121624'; mc.fillRect(x, 40 + rng() * 40, 40 + rng() * 30, 110);
      mc.fillStyle = '#1c2a3a'; mc.fillRect(x + 6, 70, 18, 10); mc.fillStyle = rng() < 0.5 ? '#2a6a7a' : '#3a2a4a'; mc.fillRect(x + 8, 72, 14, 6);
      mc.fillStyle = '#0e1220'; for (let y = 20; y < 200; y += 30 + rng() * 30) mc.fillRect(x - 30, y, 120, 5);
    }
    layers.push({ c: mid, sp: 0.42, y: 50 });
    return;
  }
  if (th === 7) {
    grad([[0, '#05040e'], [0.5, '#0e0a22'], [1, '#1e1030']]);
    nebulaOn(sc, rng, [['#6a2a8a', 0.28], ['#ff7a3a', 0.14], ['#2a4aaa', 0.22], ['#aa3a6a', 0.16]], 10, W, H);
    starsOn(sc, rng, 180, W, H, true);
    const gg = sc.createRadialGradient(70, 300, 20, 90, 320, 190); gg.addColorStop(0, '#e8a060'); gg.addColorStop(0.5, '#a05a3a'); gg.addColorStop(1, '#2a1420');
    sc.fillStyle = gg; sc.beginPath(); sc.arc(90, 330, 170, 0, 6.283); sc.fill();
    sc.save(); sc.beginPath(); sc.arc(90, 330, 170, 0, 6.283); sc.clip(); sc.globalAlpha = 0.25; sc.fillStyle = '#ffd0a0'; for (let k = 0; k < 6; k++) sc.fillRect(0, 175 + k * 16, 260, 3); sc.globalAlpha = 1; sc.restore();
    sc.strokeStyle = 'rgba(255,220,180,0.5)'; sc.lineWidth = 3; sc.beginPath(); sc.ellipse(90, 300, 250, 34, -0.18, Math.PI * 1.02, Math.PI * 1.98); sc.stroke();
    const s1 = mkCanvas(960, H), s1c = s1.getContext('2d'); starsOn(s1c, rng, 140, 960, H, false); layers.push({ c: s1, sp: 0.04, y: 0 });
    const far = mkCanvas(960, H), fc = far.getContext('2d');
    for (let i = 0; i < 26; i++) { const x = rng() * 960, y = rng() * H, r = 3 + rng() * 9; fc.fillStyle = '#1a1424'; fc.beginPath(); fc.arc(x, y, r, 0, 6.283); fc.fill(); fc.fillStyle = '#3a2a3a'; fc.beginPath(); fc.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, 6.283); fc.fill(); }
    layers.push({ c: far, sp: 0.14, y: 0 });
    const mid = mkCanvas(960, H), mc = mid.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const x = rng() * 960, y = rng() * H, r = 12 + rng() * 22;
      mc.fillStyle = '#1e1622'; mc.beginPath(); for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283, rr = r * (0.75 + rng() * 0.25); k ? mc.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : mc.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } mc.closePath(); mc.fill();
      mc.strokeStyle = 'rgba(255,170,110,0.45)'; mc.lineWidth = 1.5; mc.beginPath(); mc.arc(x, y, r * 0.85, Math.PI * 1.05, Math.PI * 1.7); mc.stroke();
    }
    layers.push({ c: mid, sp: 0.32, y: 0 });
    return;
  }
  grad([[0, '#04020a'], [0.55, '#0c0618'], [1, '#1c0c22']]);
  nebulaOn(sc, rng, [['#5a2a8a', 0.26], ['#ff8a3a', 0.12], ['#8a2a6a', 0.18]], 9, W, H);
  starsOn(sc, rng, 150, W, H, true);
  const bx = 120, by = 54;
  const lg = sc.createRadialGradient(bx, by, 4, bx, by, 60); lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(0.17, 'rgba(0,0,0,1)'); lg.addColorStop(0.23, 'rgba(255,200,140,0.45)'); lg.addColorStop(0.42, 'rgba(160,80,200,0.14)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  sc.fillStyle = lg; sc.fillRect(bx - 60, by - 60, 120, 120);
  sc.strokeStyle = 'rgba(255,190,120,0.45)'; sc.lineWidth = 1.5; sc.beginPath(); sc.ellipse(bx, by, 34, 6, -0.15, 0, 6.283); sc.stroke();
  const s1 = mkCanvas(960, H), s1c = s1.getContext('2d'); starsOn(s1c, rng, 120, 960, H, false); layers.push({ c: s1, sp: 0.05, y: 0 });
  const far = mkCanvas(960, 200), fc = far.getContext('2d');
  for (let i = 0; i < 12; i++) {
    const x = rng() * 960, y = 40 + rng() * 120, w = 30 + rng() * 60;
    fc.fillStyle = '#140c20'; fc.beginPath(); fc.moveTo(x - w / 2, y); fc.lineTo(x + w / 2, y); fc.lineTo(x + w * 0.2, y + w * 0.6); fc.lineTo(x - w * 0.15, y + w * 0.7); fc.closePath(); fc.fill();
    fc.fillStyle = '#3a2a5a'; fc.fillRect(x - w / 2, y, w, 2);
  }
  layers.push({ c: far, sp: 0.18, y: 40 });
  const mid = mkCanvas(960, 150), mc = mid.getContext('2d');
  for (let x = 0; x < 960; x += 50 + rng() * 80) { const h = 20 + rng() * 70; mc.fillStyle = '#1a1028'; mc.beginPath(); mc.moveTo(x, 150); mc.lineTo(x + 6, 150 - h); mc.lineTo(x + 12, 150 - h * 0.6); mc.lineTo(x + 18, 150); mc.fill(); mc.fillStyle = '#c89bff'; mc.globalAlpha = 0.4; mc.fillRect(x + 5, 150 - h, 2, h * 0.5); mc.globalAlpha = 1; }
  layers.push({ c: mid, sp: 0.38, y: 126 });
}

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
