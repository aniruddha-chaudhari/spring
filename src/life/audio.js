// life/audio.js — fully procedural WebAudio soundscape: babbling stream, wind + leaf rustle, birdsong
// (uguisu, sparrows, white-eye trills, crows), night insects (suzumushi + cricket chorus), furin chimes and the
// shishi-odoshi knock. Spring swaps the insects for kajika frogs, adds skylarks and a fuller warbler chorus.
// Continuous layers are built once and kept running; one-shot events create short-lived
// nodes that stop themselves and disconnect on 'ended' (with a hard cap on concurrent voices).
import { ANCHORS, U, windGustAt, streamPoint, S_RAPIDS, S_STONES, clamp, IS_SPRING } from '../world.js';
import { waterDist, W } from './common.js';

const MASTER = 0.8;
let ac = null, master, comp, verb, verbRet, bus = {}, sends = {};
let started = false, muted = false, suspendTimer = 0;
let noiseW, noiseP, noiseB, warble;
let L = {};                 // continuous layer handles
let voices = 0;             // live one-shot voices
const MAX_VOICES = 48;
let lastParam = -1;
const nx = {};              // next event times
let camRef = null, targetRef = null;
let rnd = Math.random;

// ---------------------------------------------------------------- public
export function startAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!ac) { ac = new AC({ latencyHint: 'playback' }); build(); }
  if (ac.state !== 'running') ac.resume();
  started = true;
  fadeMaster(muted ? 0 : MASTER, 2.5);
  return true;
}
export function setMuted(m) {
  muted = !!m;
  if (!ac) return;
  clearTimeout(suspendTimer);
  if (muted) {
    fadeMaster(0, 0.6);
    suspendTimer = setTimeout(() => { if (muted && ac.state === 'running') ac.suspend(); }, 1200);   // save CPU while muted
  } else {
    if (ac.state !== 'running') ac.resume();
    fadeMaster(MASTER, 1.2);
  }
}
export function isRunning() { return !!ac && started && ac.state === 'running'; }

// ---------------------------------------------------------------- graph
function fadeMaster(v, dur) {
  const g = master.gain, now = ac.currentTime;
  g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(v, now + dur);
}
function noiseBuffer(kind, seconds = 4) {
  const n = Math.floor(ac.sampleRate * seconds), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }   // brown
  }
  // crossfade the loop seam
  const f = Math.floor(ac.sampleRate * 0.05);
  for (let i = 0; i < f; i++) { const a = i / f; d[i] = d[i] * a + d[n - f + i] * (1 - a); }
  return b;
}
// smooth random control signal in [-1, 1] at ~rate Hz (looped buffer used to modulate AudioParams)
function modBuffer(seconds, rate) {
  const sr = 3000, n = Math.floor(sr * seconds), b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
  const pts = Math.max(2, Math.floor(seconds * rate)), v = [];
  for (let i = 0; i < pts; i++) v.push(Math.random() * 2 - 1);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * pts, k = Math.floor(x), f = x - k, a = v[k % pts], c = v[(k + 1) % pts];
    d[i] = a + (c - a) * (0.5 - 0.5 * Math.cos(Math.PI * f));
  }
  return b;
}
function loop(buf, offset = 0) {
  const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, offset % buf.duration); return s;
}
function filt(type, freq, Q = 0.7) { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; return f; }
function gain(v) { const g = ac.createGain(); g.gain.value = v; return g; }
function panner(p = 0) { const s = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain(); if (s.pan) s.pan.value = p; return s; }
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
// modulate an AudioParam: base value + depth * slow random signal
function modulate(param, buf, depth, offset = 0) { const s = loop(buf, offset), g = gain(depth); s.connect(g); g.connect(param); return s; }

function impulse(seconds, decay) {
  const n = Math.floor(ac.sampleRate * seconds), b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, k = 0.15 + 0.8 * t;                         // darker as it decays
      lp = lp + k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
    }
  }
  return b;
}

function build() {
  master = gain(0);
  comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.008; comp.release.value = 0.25;
  master.connect(comp); comp.connect(ac.destination);
  verb = ac.createConvolver(); verb.buffer = impulse(3.2, 3.2);
  verbRet = gain(0.32); verb.connect(verbRet); verbRet.connect(master);
  for (const [k, send] of [['water', 0.05], ['wind', 0.0], ['birds', 0.3], ['insects', 0.22], ['fx', 0.45]]) {
    bus[k] = gain(k === 'insects' ? 0 : 1); bus[k].connect(master);
    sends[k] = gain(send); bus[k].connect(sends[k]); sends[k].connect(verb);
  }
  noiseW = noiseBuffer('white', 4); noiseP = noiseBuffer('pink', 5); noiseB = noiseBuffer('brown', 6);
  const modSlow = modBuffer(23, 0.35), modBabble = modBuffer(7, 9), modFast = modBuffer(5, 22), modRustle = modBuffer(6, 14);
  // a soft whistle timbre for birds
  warble = ac.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.14, 0.05, 0.02]));

  // ---- stream: low bed (stereo pink), babbling mid band, sparkling highs, rapids hiss
  const bed = gain(0.0);
  for (const [p, off] of [[-0.55, 0], [0.55, 2.1]]) chain(loop(noiseP, off), filt('lowpass', 700, 0.5), panner(p), bed);
  bed.connect(bus.water);
  L.bed = bed;
  const babG = gain(0.05);
  chain(loop(noiseW, 1.3), filt('bandpass', 1400, 0.9), filt('lowpass', 2600), babG, bus.water);
  modulate(babG.gain, modBabble, 0.045);
  L.bab = babG;
  const sparkG = gain(0.012);
  chain(loop(noiseW, 2.7), filt('highpass', 3500), filt('bandpass', 5200, 1.2), sparkG, bus.water);
  modulate(sparkG.gain, modFast, 0.012, 1.1);
  const rapG = gain(0), rapPan = panner(0);
  chain(loop(noiseW, 0.4), filt('highpass', 350), filt('lowpass', 4500), filt('peaking', 900, 1), rapG, rapPan, bus.water);
  modulate(rapG.gain, modSlow, 0.02, 5);
  L.rap = rapG; L.rapPan = rapPan;

  // ---- wind: brown noise through a swept band, plus leaf rustle (highs gated by gusts)
  const wBand = filt('bandpass', 380, 0.55), wG = gain(0);
  for (const [p, off] of [[-0.7, 0], [0.7, 3.3]]) chain(loop(noiseB, off), panner(p), wBand);
  chain(wBand, filt('lowpass', 1400), wG, bus.wind);
  modulate(wBand.frequency, modSlow, 90, 11);
  L.wBand = wBand; L.wG = wG;
  const rG = gain(0), rDepth = gain(0);
  chain(loop(noiseW, 3.1), filt('highpass', 2800), filt('lowpass', 9000), rG, panner(0.25), bus.wind);
  const rm = loop(modRustle); rm.connect(rDepth); rDepth.connect(rG.gain);
  L.rG = rG; L.rDepth = rDepth;

  // ---- insects: three suzumushi voices (ringing ~4.2 kHz, pulsed) + a soft cricket chorus (autumn only)
  L.suzu = [];
  if (!IS_SPRING) buildInsects(modSlow);
  const t = ac.currentTime;
  Object.assign(nx, { bubble: t, bird: t + 2, crow: t + 20, chime: t + 8, cricketLow: t, frog: t + 1, lark: t + 6 });
}

function buildInsects(modSlow) {
  const pulseCurve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; pulseCurve[i] = Math.pow(Math.max(0, x), 1.5); }
  for (let k = 0; k < 3; k++) {
    const o = ac.createOscillator(); o.frequency.value = 4100 + k * 170 + Math.random() * 60;
    const lfo = ac.createOscillator(); lfo.frequency.value = 34 + k * 5;
    const shp = ac.createWaveShaper(); shp.curve = pulseCurve;
    const am = gain(0), env = gain(0), pn = panner(-0.6 + k * 0.6);
    lfo.connect(shp); shp.connect(am.gain);
    chain(o, am, env, pn, bus.insects);
    o.start(); lfo.start();
    L.suzu.push({ env, next: 0 });
  }
  for (const [f, rate, p] of [[3650, 17, -0.4], [5100, 23, 0.45], [4500, 12.5, 0.05]]) {
    const o = ac.createOscillator(); o.frequency.value = f;
    const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rate;
    const am = gain(0.5), lg = gain(0.5), g = gain(0.006);
    lfo.connect(lg); lg.connect(am.gain);
    chain(o, am, g, panner(p), bus.insects);
    modulate(g.gain, modSlow, 0.005, f * 0.001);
    o.start(); lfo.start();
  }
}

// ---------------------------------------------------------------- one-shot helpers
function voice(srcs, all, end) {
  voices++;
  let done = false;
  srcs[0].onended = () => { if (done) return; done = true; voices--; for (const n of all) { try { n.disconnect(); } catch (e) { /* already */ } } };
  for (const s of srcs) s.stop(end);
}
function panFor(x, z) {
  if (!camRef) return 0;
  const e = camRef.matrixWorld.elements;            // camera right vector = first column
  const dx = x - camRef.position.x, dz = z - camRef.position.z, d = Math.hypot(dx, dz) || 1;
  return clamp(((dx * e[0] + dz * e[2]) / d) * 1.4, -0.9, 0.9);
}
function distGain(x, z) {
  if (!targetRef) return 1;
  const d = Math.hypot(x - targetRef.x, z - targetRef.z);
  return 1 / (1 + d / 25);
}

function bubble(t0, amp, f0) {
  const o = ac.createOscillator(), g = gain(0), p = panner((rnd() - 0.5) * 1.4);
  const dur = 0.05 + rnd() * 0.09;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.5 + rnd() * 1.2), t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  chain(o, g, p, bus.water);
  o.start(t0); voice([o], [o, g, p], t0 + dur + 0.02);
}

function uguisu(t0, pan, amp) {
  const o = ac.createOscillator(); o.setPeriodicWave(warble);
  const g = gain(0), p = panner(pan), f = o.frequency, a = g.gain;
  const vib = ac.createOscillator(), vg = gain(0); vib.frequency.value = 6; vib.connect(vg); vg.connect(f);
  // "hōōō" — long, slowly rising
  f.setValueAtTime(900, t0); f.linearRampToValueAtTime(1020, t0 + 1.0);
  a.setValueAtTime(0, t0); a.linearRampToValueAtTime(amp * 0.8, t0 + 0.18); a.setValueAtTime(amp * 0.8, t0 + 0.9); a.linearRampToValueAtTime(0, t0 + 1.08);
  // "ho-ke-kyo"
  let t = t0 + 1.32;
  f.setValueAtTime(1500, t); a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp, t + 0.02); a.setValueAtTime(amp, t + 0.1); a.linearRampToValueAtTime(0, t + 0.13);
  t += 0.18;
  f.setValueAtTime(2350, t); f.exponentialRampToValueAtTime(1800, t + 0.09);
  a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp, t + 0.015); a.setValueAtTime(amp, t + 0.08); a.linearRampToValueAtTime(0, t + 0.11);
  t += 0.16;
  f.setValueAtTime(1550, t); f.exponentialRampToValueAtTime(2500, t + 0.12); f.exponentialRampToValueAtTime(2050, t + 0.42);
  vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(70, t + 0.2);
  a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp, t + 0.03); a.setValueAtTime(amp * 0.9, t + 0.32); a.linearRampToValueAtTime(0, t + 0.48);
  chain(o, g, p, bus.birds);
  o.start(t0); vib.start(t0);
  voice([o, vib], [o, vib, vg, g, p], t + 0.55);
}
function chirps(t0, pan, amp) {
  const o = ac.createOscillator(); o.setPeriodicWave(warble);
  const g = gain(0), p = panner(pan), f = o.frequency, a = g.gain;
  const n = 2 + Math.floor(rnd() * 5), base = 2800 + rnd() * 1400, up = rnd() < 0.4;
  let t = t0;
  a.setValueAtTime(0, t0);
  for (let i = 0; i < n; i++) {
    const d = 0.05 + rnd() * 0.04;
    f.setValueAtTime(up ? base * 0.8 : base * 1.25, t); f.exponentialRampToValueAtTime(up ? base * 1.2 : base * 0.85, t + d);
    a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp, t + 0.008); a.linearRampToValueAtTime(0, t + d);
    t += d + 0.08 + rnd() * 0.18;
  }
  chain(o, g, p, bus.birds);
  o.start(t0); voice([o], [o, g, p], t + 0.05);
}
function trill(t0, pan, amp) {
  const o = ac.createOscillator(), g = gain(0), p = panner(pan), f = o.frequency, a = g.gain;
  const n = 10 + Math.floor(rnd() * 16), rate = 1 / (16 + rnd() * 8), hi = 4200 + rnd() * 1200;
  let t = t0;
  a.setValueAtTime(0, t0);
  for (let i = 0; i < n; i++) {
    const k = i / n, fq = hi * (1 - 0.18 * k) * (i % 2 ? 0.86 : 1);
    f.setValueAtTime(fq, t); f.exponentialRampToValueAtTime(fq * 0.9, t + rate * 0.7);
    a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp * (0.6 + 0.4 * Math.sin(k * Math.PI)), t + 0.006); a.linearRampToValueAtTime(0, t + rate * 0.75);
    t += rate;
  }
  chain(o, g, p, bus.birds);
  o.start(t0); voice([o], [o, g, p], t + 0.05);
}
// skylark (hibari): a long, tumbling, high warble from far up in the sky
function skylark(t0, pan, amp) {
  const o = ac.createOscillator(); o.setPeriodicWave(warble);
  const g = gain(0), p = panner(pan), f = o.frequency, a = g.gain;
  const n = 45 + Math.floor(rnd() * 45);
  let t = t0;
  a.setValueAtTime(0, t0);
  for (let i = 0; i < n; i++) {
    const d = 0.045 + rnd() * 0.06, fq = 2600 + rnd() * 2800, k = Math.sin((i / n) * Math.PI);
    f.setValueAtTime(fq, t); f.exponentialRampToValueAtTime(fq * (0.8 + rnd() * 0.45), t + d * 0.9);
    a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp * (0.4 + 0.6 * k), t + 0.006); a.linearRampToValueAtTime(amp * 0.1, t + d);
    t += d + (rnd() < 0.08 ? 0.12 : 0.008);
  }
  a.linearRampToValueAtTime(0, t + 0.03);
  chain(o, g, p, bus.birds);
  o.start(t0); voice([o], [o, g, p], t + 0.06);
}
// kajika frog: a clear, rising whistled trill near the water ("fi… fi fi fifififii")
function kajika(t0, pan, amp) {
  const o = ac.createOscillator(); o.setPeriodicWave(warble);
  const g = gain(0), p = panner(pan), f = o.frequency, a = g.gain;
  const n = 5 + Math.floor(rnd() * 9), base = 1650 + rnd() * 500;
  let t = t0, gap = 0.34;
  a.setValueAtTime(0, t0);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1 || 1), d = 0.07 + 0.05 * (1 - k), fq = base * (1 + 0.12 * k);
    f.setValueAtTime(fq * 0.93, t); f.exponentialRampToValueAtTime(fq * 1.1, t + d);
    a.setValueAtTime(0, t); a.linearRampToValueAtTime(amp * (0.45 + 0.55 * Math.sin(k * 2.6)), t + 0.012); a.linearRampToValueAtTime(0, t + d);
    t += d + gap; gap = Math.max(0.05, gap * 0.72);
  }
  chain(o, g, p, bus.insects);
  o.start(t0); voice([o], [o, g, p], t + 0.05);
}
function crow(t0, pan, amp) {
  const o = ac.createOscillator(); o.type = 'sawtooth';
  const fm = ac.createOscillator(), fmg = gain(38); fm.frequency.value = 41; fm.connect(fmg); fmg.connect(o.frequency);
  const b1 = filt('bandpass', 1150, 2.2), b2 = filt('bandpass', 2300, 3), lp = filt('lowpass', 2600), g = gain(0), p = panner(pan);
  o.connect(b1); o.connect(b2); b1.connect(lp); b2.connect(lp); chain(lp, g, p, bus.birds);
  const n = 2 + Math.floor(rnd() * 2); let t = t0;
  for (let i = 0; i < n; i++) {
    o.frequency.setValueAtTime(560, t); o.frequency.linearRampToValueAtTime(450, t + 0.36);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.04); g.gain.setValueAtTime(amp * 0.8, t + 0.26); g.gain.linearRampToValueAtTime(0, t + 0.4);
    t += 0.55 + rnd() * 0.15;
  }
  o.start(t0); fm.start(t0);
  voice([o, fm], [o, fm, fmg, b1, b2, lp, g, p], t + 0.1);
}
function chime(t0, pan, amp) {
  const f = [2093, 2349, 2637, 3136, 3520][Math.floor(rnd() * 5)] * (0.99 + rnd() * 0.02);
  const c = ac.createOscillator(), m = ac.createOscillator(), mg = gain(0), p2 = ac.createOscillator(), g = gain(0), g2 = gain(0), p = panner(pan);
  c.frequency.value = f; m.frequency.value = f * 1.414; p2.frequency.value = f * 2.76;
  m.connect(mg); mg.connect(c.frequency);
  mg.gain.setValueAtTime(f * 1.1, t0); mg.gain.exponentialRampToValueAtTime(1, t0 + 0.5);
  const dec = 2.2 + rnd() * 1.2;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
  g2.gain.setValueAtTime(0, t0); g2.gain.linearRampToValueAtTime(amp * 0.35, t0 + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dec * 0.4);
  c.connect(g); p2.connect(g2); g.connect(p); g2.connect(p); p.connect(bus.fx);
  c.start(t0); m.start(t0); p2.start(t0);
  voice([c, m, p2], [c, m, p2, mg, g, g2, p], t0 + dec + 0.05);
}
function noiseHit(t0, dest, type, freq, Q, amp, attack, dec, pan = 0) {
  const s = ac.createBufferSource(); s.buffer = noiseW;
  const f = filt(type, freq, Q), g = gain(0), p = panner(pan);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dec);
  chain(s, f, g, p, dest);
  s.start(t0, rnd() * 3); voice([s], [s, f, g, p], t0 + attack + dec + 0.02);
}

// shishi-odoshi: hollow bamboo "tock" + a small splash and a few drips
export function knock() {
  if (!isRunning() || voices > MAX_VOICES) return;
  const t0 = ac.currentTime + 0.01, a = ANCHORS.shishiodoshi, pan = panFor(a.x, a.z), dg = 0.5 + 0.5 * distGain(a.x, a.z);
  noiseHit(t0, bus.fx, 'bandpass', 760, 9, 0.9 * dg, 0.001, 0.13, pan);
  noiseHit(t0, bus.fx, 'bandpass', 1650, 12, 0.35 * dg, 0.001, 0.08, pan);
  const o = ac.createOscillator(), g = gain(0), p = panner(pan);
  o.frequency.setValueAtTime(540, t0); o.frequency.exponentialRampToValueAtTime(330, t0 + 0.08);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.32 * dg, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  chain(o, g, p, bus.fx); o.start(t0); voice([o], [o, g, p], t0 + 0.22);
  noiseHit(t0 + 0.04, bus.water, 'highpass', 1300, 0.7, 0.1 * dg, 0.012, 0.35, pan);
  for (let i = 0; i < 3; i++) bubble(t0 + 0.25 + rnd() * 0.5, 0.03 * dg, 500 + rnd() * 700);
}
// a small plop (egret strike, fish)
export function plop(x, z) {
  if (!isRunning() || voices > MAX_VOICES) return;
  const t0 = ac.currentTime + 0.01, pan = panFor(x, z), dg = distGain(x, z);
  noiseHit(t0, bus.water, 'bandpass', 900, 1.5, 0.12 * dg, 0.005, 0.18, pan);
  bubble(t0 + 0.02, 0.05 * dg, 380 + rnd() * 200);
}

// ---------------------------------------------------------------- per-frame
let chimeArmed = true;
export function update(dt, t, ctx) {
  if (!ac || !started || ac.state !== 'running') return;
  camRef = ctx.camera; targetRef = ctx.controls?.target || null;
  const now = ac.currentTime, ahead = now + 0.15;
  const tx = targetRef ? targetRef.x : 0, tz = targetRef ? targetRef.z : 0;
  const camD = ctx.camera.position.distanceTo(targetRef || ctx.camera.position);
  const zoom = clamp(1.25 - camD / 160, 0.45, 1);           // closer = richer detail
  const nearStream = 0.35 + 0.65 * clamp(1 - Math.max(waterDist(tx, tz), 0) / 40, 0, 1);
  const ws = U.uWindStrength.value;
  const gust = windGustAt(tx, tz, t) * ws;

  // continuous params at ~10 Hz (setTargetAtTime: smooth, bounded automation list)
  if (now - lastParam > 0.1) {
    lastParam = now;
    const tc = 0.25;
    L.bed.gain.setTargetAtTime(0.16 * nearStream * W.stream, now, tc);
    const rp = streamPoint(S_RAPIDS), rd = Math.hypot(rp.x - tx, rp.z - tz);
    L.rap.gain.setTargetAtTime(0.11 * W.stream * zoom / (1 + rd / 18), now, tc);
    if (L.rapPan.pan) L.rapPan.pan.setTargetAtTime(panFor(rp.x, rp.z) * 0.8, now, tc);
    L.wG.gain.setTargetAtTime((0.025 + 0.16 * gust * gust) * Math.min(ws, 1.4), now, 0.4);
    L.wBand.frequency.setTargetAtTime(260 + 520 * gust, now, 0.5);
    const rust = 0.05 * gust * gust * gust * zoom;
    L.rG.gain.setTargetAtTime(rust * 0.6, now, 0.3); L.rDepth.gain.setTargetAtTime(rust * 0.5, now, 0.3);
    bus.birds.gain.setTargetAtTime(Math.max(W.song, W.crow * 0.6), now, 1.5);
    bus.insects.gain.setTargetAtTime(W.insects * zoom, now, 1.5);
  }

  // bubbling / plinks (babbling brook)
  if (nx.bubble < now - 0.5) nx.bubble = now;
  let guard = 0;
  while (nx.bubble < ahead && guard++ < 8) {
    if (voices < MAX_VOICES) bubble(nx.bubble, (0.012 + rnd() * rnd() * 0.05) * nearStream * zoom, 320 + Math.pow(rnd(), 2) * 1500);
    nx.bubble += (0.04 + rnd() * 0.16) / (0.4 + 0.6 * nearStream);
  }

  // birdsong (day) — uguisu now and then, sparrow chirps, white-eye trills
  if (nx.bird < now - 1) nx.bird = now + rnd();
  if (nx.bird < ahead) {
    if (W.song > 0.05 && voices < MAX_VOICES) {
      const u = rnd(), pan = (rnd() - 0.5) * 1.6, amp = (0.035 + rnd() * 0.03) * zoom;
      if (IS_SPRING) {         // spring: warblers everywhere, a softer, fuller chorus of small birds
        if (u < 0.4 && (!nx.ugu || now > nx.ugu)) { uguisu(nx.bird, pan, amp * 1.2); nx.ugu = now + 5 + rnd() * 7; }
        else if (u < 0.75) chirps(nx.bird, pan, amp * 0.65);
        else trill(nx.bird, pan, amp * 0.55);
      } else if (u < 0.22 && (!nx.ugu || now > nx.ugu)) { uguisu(nx.bird, pan, amp * 1.15); nx.ugu = now + 14 + rnd() * 20; }
      else if (u < 0.72) chirps(nx.bird, pan, amp);
      else trill(nx.bird, pan, amp * 0.7);
    }
    nx.bird += (IS_SPRING ? 0.6 + rnd() * 2.4 : 1.6 + rnd() * 5.5) / Math.max(W.song, 0.25);
  }
  if (IS_SPRING) {
    if (nx.lark < now - 1) nx.lark = now + 3;
    if (nx.lark < ahead) {      // skylarks high over the meadows
      if (W.song > 0.4 && voices < MAX_VOICES) skylark(nx.lark, (rnd() - 0.5) * 1.4, 0.022 * zoom);
      nx.lark += 9 + rnd() * 14;
    }
    if (nx.frog < now - 1) nx.frog = now + rnd();
    if (nx.frog < ahead) {      // kajika frogs along the stream at dusk / night
      if (W.insects > 0.05 && voices < MAX_VOICES) {
        const sp = streamPoint(S_RAPIDS - 6 + rnd() * (S_STONES - S_RAPIDS + 12));
        kajika(nx.frog, panFor(sp.x, sp.z) * 0.9, (0.03 + rnd() * 0.025) * (0.6 + 0.4 * distGain(sp.x, sp.z)));
      }
      nx.frog += (1.2 + rnd() * 3.5) / Math.max(W.insects, 0.3);
    }
  }
  // crows, far away, at golden hour
  if (nx.crow < now - 1) nx.crow = now + 5;
  if (nx.crow < ahead) {
    if (W.crow > 0.3 && rnd() < W.crow && voices < MAX_VOICES) crow(nx.crow, (rnd() - 0.5) * 1.8, 0.05 * zoom);
    nx.crow += 22 + rnd() * 45;
  }
  // suzumushi phrases ("riiin … riiin")
  for (const v of L.suzu) {
    if (v.next < now - 1) v.next = now + rnd();
    if (v.next < ahead) {
      const d = 0.5 + rnd() * 1.3, a = 0.03 + rnd() * 0.02, s = v.next;
      v.env.gain.setValueAtTime(0, s); v.env.gain.linearRampToValueAtTime(a, s + 0.05);
      v.env.gain.setValueAtTime(a * 0.85, s + d - 0.08); v.env.gain.linearRampToValueAtTime(0, s + d);
      v.next = s + d + 0.25 + rnd() * 1.6;
    }
  }
  // furin: tinkles when a gust reaches the teahouse
  const tea = ANCHORS.teahouse, tg = windGustAt(tea.x, tea.z, t) * ws;
  if (chimeArmed && tg > 0.55) {
    chimeArmed = false;
    const n = 1 + Math.floor(rnd() * 4), pan = panFor(tea.x, tea.z), amp = 0.035 * (0.5 + 0.5 * distGain(tea.x, tea.z));
    for (let i = 0; i < n && voices < MAX_VOICES; i++) chime(now + 0.05 + i * (0.12 + rnd() * 0.35), pan, amp * (1 - i * 0.15));
  } else if (tg < 0.35) chimeArmed = true;
  if (nx.chime < now - 1) nx.chime = now + 10;
  if (nx.chime < ahead) {    // the odd lone tinkle in light air
    if (ws > 0.3 && voices < MAX_VOICES) chime(nx.chime, panFor(tea.x, tea.z), 0.02);
    nx.chime += 14 + rnd() * 26;
  }
}
