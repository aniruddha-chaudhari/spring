// life/common.js — shared helpers for the life module: baked terrain/stream grids (cheap per-frame lookups),
// preset weights that crossfade smoothly, and small shader snippets.
import * as THREE from 'three';
import { groundHeight, streamAt, WATER_Y, clamp, IS_SPRING } from '../world.js';

// ---------------------------------------------------------------- baked grids
// Near grid: 1 m cells over ±64 m (height, signed distance to the water edge, flow velocity).
// Far grid: 4 m cells over ±256 m (height only) for the valley haze.
export const NEAR_HALF = 64, NEAR_N = 129;          // step 1 m
export const FAR_HALF = 256, FAR_N = 129;           // step 4 m
export const G = { h: null, wd: null, fx: null, fz: null, far: null, nearTex: null, farTex: null };

export function buildGrids() {
  if (G.h) return;
  const n = NEAR_N, N2 = n * n;
  const h = new Float32Array(N2), wd = new Float32Array(N2), fx = new Float32Array(N2), fz = new Float32Array(N2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -NEAR_HALF + i, z = -NEAR_HALF + j, k = j * n + i;
      h[k] = groundHeight(x, z);
      const st = streamAt(x, z);
      wd[k] = st.d - st.hw;
      if (wd[k] < 1) {
        // surface flow: fast where the channel is narrow/shallow (rapids), lazy in the pond, slower near the banks
        const q = clamp(st.d / st.hw, 0, 1);
        const sp = clamp(0.95 / (st.hw * st.depth), 0.03, 0.8) * (1 - 0.55 * q * q);
        const nx = -st.tz, nz = st.tx;                      // left normal
        const pull = -st.side * 0.3 * q * q * sp;           // drift back toward the centreline
        fx[k] = st.tx * sp + nx * pull; fz[k] = st.tz * sp + nz * pull;
      }
    }
  }
  const fn = FAR_N, far = new Float32Array(fn * fn), fs = (2 * FAR_HALF) / (fn - 1);
  for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) far[j * fn + i] = groundHeight(-FAR_HALF + i * fs, -FAR_HALF + j * fs);
  Object.assign(G, { h, wd, fx, fz, far });

  // GPU copies (half float RGBA, linear filtered): near = (height, water distance), far = (height)
  const toHalf = THREE.DataUtils.toHalfFloat;
  const nd = new Uint16Array(N2 * 4), fd = new Uint16Array(fn * fn * 4);
  for (let k = 0; k < N2; k++) { nd[k * 4] = toHalf(h[k]); nd[k * 4 + 1] = toHalf(clamp(wd[k], -60, 60)); nd[k * 4 + 3] = toHalf(1); }
  for (let k = 0; k < fn * fn; k++) { fd[k * 4] = toHalf(far[k]); fd[k * 4 + 3] = toHalf(1); }
  const mk = (data, size) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.needsUpdate = true; return t;
  };
  G.nearTex = mk(nd, n); G.farTex = mk(fd, fn);
}

function sampleN(arr, x, z) {
  let gx = x + NEAR_HALF, gz = z + NEAR_HALF;
  gx = gx < 0 ? 0 : gx > NEAR_N - 1.001 ? NEAR_N - 1.001 : gx;
  gz = gz < 0 ? 0 : gz > NEAR_N - 1.001 ? NEAR_N - 1.001 : gz;
  const i = gx | 0, j = gz | 0, u = gx - i, v = gz - j, k = j * NEAR_N + i;
  return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + NEAR_N] * (1 - u) + arr[k + NEAR_N + 1] * u) * v;
}
export const groundAt = (x, z) => sampleN(G.h, x, z);               // terrain / stream bed height
export const surfaceAt = (x, z) => Math.max(sampleN(G.h, x, z), WATER_Y);
export const waterDist = (x, z) => sampleN(G.wd, x, z);             // < 0 inside the water
export const flowX = (x, z) => sampleN(G.fx, x, z);
export const flowZ = (x, z) => sampleN(G.fz, x, z);
export const inNear = (x, z) => Math.abs(x) < NEAR_HALF - 1 && Math.abs(z) < NEAR_HALF - 1;

// ---------------------------------------------------------------- preset weights (smoothly crossfaded)
// Every system reads W.* each frame; setPresetTarget() changes the targets and stepWeights() eases toward them.
const P = {
  afternoon: { motes: 0.35, fire: 0, mist: 0, haze: 0.45, dragon: 1, flock: 1, ground: 1, leaf: 1, song: 1, insects: 0, crow: 0.15, stream: 1,
    mistCol: '#dfe7f0', hazeCol: '#c3d3e4', moteCol: '#fff0d6' },
  golden: { motes: 1, fire: 0, mist: 0.3, haze: 0.75, dragon: 1, flock: 1, ground: 1, leaf: 1.15, song: 0.7, insects: 0.18, crow: 1, stream: 1,
    mistCol: '#f4d2b0', hazeCol: '#e8b48c', moteCol: '#ffc477' },
  blue: { motes: 0.12, fire: 0.6, mist: 1, haze: 0.9, dragon: 0, flock: 0.45, ground: 0, leaf: 0.7, song: 0.12, insects: 0.75, crow: 0.25, stream: 1,
    mistCol: '#8696bd', hazeCol: '#7381ab', moteCol: '#c9d6ff' },
  night: { motes: 0, fire: 1, mist: 0.85, haze: 0.8, dragon: 0, flock: 0, ground: 0, leaf: 0.5, song: 0, insects: 1, crow: 0, stream: 1,
    mistCol: '#4a5878', hazeCol: '#242d46', moteCol: '#9fb0ff' },
};
// Spring overrides (season is fixed per page load). 'insects' drives the night chorus bus: crickets in autumn,
// kajika frogs in spring. 'butter' = butterflies (spring only). Motes over land are switched off in air.js.
const SPRING = {
  afternoon: { fire: 0, mist: 0, dragon: 0, butter: 1, leaf: 1, song: 1, insects: 0, crow: 0 },
  golden: { fire: 0, mist: 0, dragon: 0, butter: 0.6, leaf: 1, song: 0.85, insects: 0.12, crow: 0 },
  blue: { fire: 0, mist: 0.55, dragon: 0, butter: 0, leaf: 0.8, song: 0.35, insects: 0.8, crow: 0, mistCol: '#a3b0d2' },
  night: { fire: 0, mist: 0, dragon: 0, butter: 0, leaf: 0.6, song: 0, insects: 1, crow: 0 },
};
for (const k in P) { P[k].butter = 0; if (IS_SPRING) Object.assign(P[k], SPRING[k]); }
const NUM = ['motes', 'fire', 'mist', 'haze', 'dragon', 'flock', 'ground', 'leaf', 'song', 'insects', 'crow', 'stream', 'butter'];
const COL = ['mistCol', 'hazeCol', 'moteCol'];
export const W = { preset: 'golden' };
const T = {};
for (const k of NUM) { W[k] = P.golden[k]; T[k] = W[k]; }
for (const k of COL) { W[k] = new THREE.Color(P.golden[k]); T[k] = new THREE.Color(P.golden[k]); }

export function setPresetTarget(name, instant = false) {
  const p = P[name] || P.golden;
  W.preset = P[name] ? name : 'golden';
  for (const k of NUM) T[k] = p[k];
  for (const k of COL) T[k].set(p[k]);
  if (instant) { for (const k of NUM) W[k] = T[k]; for (const k of COL) W[k].copy(T[k]); }
}
export function stepWeights(dt) {
  const a = 1 - Math.exp(-dt * 0.9);                     // ~2.5 s to settle
  for (const k of NUM) W[k] += (T[k] - W[k]) * a;
  for (const k of COL) W[k].lerp(T[k], a);
}

// ---------------------------------------------------------------- misc
export const TAU = Math.PI * 2;
export const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const easeInOut = (u) => u * u * (3 - 2 * u);

// tone mapping + colour space chunks for ShaderMaterials (no-ops when rendering into the post stack)
export const OUT_GLSL = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>`;
export const NOISE_GLSL = /* glsl */`
float lf_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lf_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lf_hash(i), lf_hash(i + vec2(1, 0)), u.x), mix(lf_hash(i + vec2(0, 1)), lf_hash(i + vec2(1, 1)), u.x), u.y);
}
float lf_fbm(vec2 p) { return lf_noise(p) * 0.5 + lf_noise(p * 2.03 + 17.1) * 0.3 + lf_noise(p * 4.1 - 9.3) * 0.2; }`;
