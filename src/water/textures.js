// water/textures.js — procedural textures for the water (all generated on the CPU at load, tileable).
import * as THREE from 'three';
import { mulberry32, streamAt, WORLD } from '../world.js';
import { flowAt } from './flow.js';

const TAU = Math.PI * 2;

function dataTex(data, size, format = THREE.RGBAFormat) {
  const t = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// sum of tileable cosine waves with integer wave vectors; returns { h, gx, gy } Float32Arrays (gradients per texel-tile unit)
function waveField(N, nWaves, kMin, kMax, slopeExp, seed) {
  const rnd = mulberry32(seed);
  const h = new Float32Array(N * N), gx = new Float32Array(N * N), gy = new Float32Array(N * N);
  const cx = new Float32Array(N), sx = new Float32Array(N), cy = new Float32Array(N), sy = new Float32Array(N);
  for (let w = 0; w < nWaves; w++) {
    const k = kMin * Math.pow(kMax / kMin, rnd());
    const ang = w * 2.39996 + rnd() * 0.4;           // golden-angle spread -> isotropic
    let kx = Math.round(Math.cos(ang) * k), ky = Math.round(Math.sin(ang) * k);
    if (kx === 0 && ky === 0) kx = Math.max(1, Math.round(kMin));
    const kk = Math.hypot(kx, ky);
    const a = Math.pow(kk, -slopeExp) * (0.6 + 0.8 * rnd());
    const ph = rnd() * TAU;
    for (let i = 0; i < N; i++) {
      const tx = TAU * kx * i / N + ph, ty = TAU * ky * i / N;
      cx[i] = Math.cos(tx); sx[i] = Math.sin(tx); cy[i] = Math.cos(ty); sy[i] = Math.sin(ty);
    }
    const ax = -a * TAU * kx, ay = -a * TAU * ky;
    for (let y = 0; y < N; y++) {
      const c2 = cy[y], s2 = sy[y], row = y * N;
      for (let x = 0; x < N; x++) {
        const c = cx[x] * c2 - sx[x] * s2, s = sx[x] * c2 + cx[x] * s2;  // cos/sin(θx + θy)
        h[row + x] += a * c; gx[row + x] += ax * s; gy[row + x] += ay * s;
      }
    }
  }
  return { h, gx, gy };
}

// tileable value-noise fbm + worley, 0..1
function foamNoise(N, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(N * N);
  // value noise octaves
  let amp = 0.55;
  for (let P = 6; P <= 48; P *= 2) {
    const lat = new Float32Array(P * P); for (let i = 0; i < P * P; i++) lat[i] = rnd();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * P, fy = y / N * P, ix = Math.floor(fx), iy = Math.floor(fy);
      let ux = fx - ix, uy = fy - iy; ux = ux * ux * (3 - 2 * ux); uy = uy * uy * (3 - 2 * uy);
      const x0 = ix % P, x1 = (ix + 1) % P, y0 = iy % P, y1 = (iy + 1) % P;
      const v = (lat[y0 * P + x0] * (1 - ux) + lat[y0 * P + x1] * ux) * (1 - uy) + (lat[y1 * P + x0] * (1 - ux) + lat[y1 * P + x1] * ux) * uy;
      out[y * N + x] += v * amp;
    }
    amp *= 0.5;
  }
  // worley bubbles
  const C = 14; const pts = [];
  for (let i = 0; i < C * C; i++) pts.push([rnd(), rnd()]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x / N * C, fy = y / N * C, ix = Math.floor(fx), iy = Math.floor(fy);
    let best = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cxi = ix + ox, cyi = iy + oy;
      const p = pts[((cyi + C) % C) * C + ((cxi + C) % C)];
      const dx = cxi + p[0] - fx, dy = cyi + p[1] - fy, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    out[y * N + x] = out[y * N + x] * 0.62 + (1 - Math.min(Math.sqrt(best), 1)) * 0.38;
  }
  let mn = Infinity, mx = -Infinity;
  for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
  return out;
}

// RGBA: RG = surface slope (x, z) packed 0..1, B = height, A = foam / jitter noise.
export function makeWaveTexture(N = 256) {
  const f = waveField(N, 72, 2, 34, 1.45, 3);
  const foam = foamNoise(N, 5);
  let gm = 0, hmn = Infinity, hmx = -Infinity;
  for (let i = 0; i < N * N; i++) { gm += f.gx[i] * f.gx[i] + f.gy[i] * f.gy[i]; hmn = Math.min(hmn, f.h[i]); hmx = Math.max(hmx, f.h[i]); }
  const gs = 1 / (Math.sqrt(gm / (N * N)) * 2.6);   // ~±2.6σ fits in 0..1
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.max(0, Math.min(255, Math.round((f.gx[i] * gs * 0.5 + 0.5) * 255)));
    data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round((f.gy[i] * gs * 0.5 + 0.5) * 255)));
    data[i * 4 + 2] = Math.round((f.h[i] - hmn) / (hmx - hmn) * 255);
    data[i * 4 + 3] = Math.round(foam[i] * 255);
  }
  return dataTex(data, N);
}

// Real caustics: photons refracted through a tileable wavy surface onto a plane, accumulated, normalised (mean = 1),
// stored /4 in R8. Also returns the expected value of min(a, b) for two decorrelated lookups so the shader can normalise.
export function makeCausticTexture(N = 512) {
  const f = waveField(N, 26, 3, 10, 1.1, 17);
  // scale the displacement so the pattern is just past focus (sharp cusps): use the RMS of the laplacian
  let lap2 = 0;
  const G = (arr, x, y) => arr[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x += 2) {
    const l = (G(f.gx, x + 1, y) - G(f.gx, x - 1, y)) * 0.5 + (G(f.gy, x, y + 1) - G(f.gy, x, y - 1)) * 0.5;
    lap2 += l * l;
  }
  const rmsLap = Math.sqrt(lap2 / ((N / 2) * (N / 2)));
  const disp = 0.95 / rmsLap;                  // texels of displacement per unit gradient
  const acc = new Float32Array(N * N);
  const M = N * 2, inv = N / M;
  const rnd = mulberry32(23);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const px = (i + rnd()) * inv, py = (j + rnd()) * inv;
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const gxv = (G(f.gx, x0, y0) * (1 - fx) + G(f.gx, x0 + 1, y0) * fx) * (1 - fy) + (G(f.gx, x0, y0 + 1) * (1 - fx) + G(f.gx, x0 + 1, y0 + 1) * fx) * fy;
    const gyv = (G(f.gy, x0, y0) * (1 - fx) + G(f.gy, x0 + 1, y0) * fx) * (1 - fy) + (G(f.gy, x0, y0 + 1) * (1 - fx) + G(f.gy, x0 + 1, y0 + 1) * fx) * fy;
    const tx = px - gxv * disp, ty = py - gyv * disp;
    const ix = Math.floor(tx), iy = Math.floor(ty), ux = tx - ix, uy = ty - iy;
    const a = ((ix % N) + N) % N, b = ((iy % N) + N) % N, a1 = (a + 1) % N, b1 = (b + 1) % N;
    acc[b * N + a] += (1 - ux) * (1 - uy); acc[b * N + a1] += ux * (1 - uy);
    acc[b1 * N + a] += (1 - ux) * uy; acc[b1 * N + a1] += ux * uy;
  }
  // light blur
  const tmp = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) tmp[y * N + x] = (G(acc, x - 1, y) + 2 * G(acc, x, y) + G(acc, x + 1, y)) * 0.25;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) acc[y * N + x] = (G(tmp, x, y - 1) + 2 * G(tmp, x, y) + G(tmp, x, y + 1)) * 0.25;
  let mean = 0; for (const v of acc) mean += v; mean /= N * N;
  const data = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) data[i] = Math.min(255, Math.round(acc[i] / mean / 4 * 255));
  // E[min(a, b)] for decorrelated samples (in stored units) so the shader can renormalise to mean 1
  let em = 0; const r2 = mulberry32(5);
  for (let k = 0; k < 40000; k++) {
    const a = data[Math.floor(r2() * N * N)], b = data[Math.floor(r2() * N * N)];
    em += Math.min(a, b) / 255;
  }
  em /= 40000;
  const tex = dataTex(data, N, THREE.RedFormat);
  return { tex, minMean: em, mean: 0.25 };
}

// World-space water mask for the caustics on other materials. 512² over ±256 m (1 m texels):
// R = signed distance inside the water edge (0.5 = edge, +1 m per 1/8), GB = flow velocity (±4 m/s), A = 1.
export const MASK_HALF = 256;
export function makeWaterMask(N = 512) {
  const data = new Uint8Array(N * N * 4);
  const cell = (MASK_HALF * 2) / N;
  const fl = { x: 0, z: 0, speed: 0, wake: 0, turb: 0, st: null };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -MASK_HALF + (i + 0.5) * cell, z = -MASK_HALF + (j + 0.5) * cell;
    const o = (j * N + i) * 4;
    const st = streamAt(Math.max(-WORLD, Math.min(WORLD, x)), Math.max(-WORLD, Math.min(WORLD, z)));
    const e = st.hw - st.d;
    data[o] = Math.max(0, Math.min(255, Math.round((0.5 + e / 8) * 255)));
    if (e > -3) { flowAt(x, z, fl); data[o + 1] = Math.round((0.5 + Math.max(-4, Math.min(4, fl.x)) / 8) * 255); data[o + 2] = Math.round((0.5 + Math.max(-4, Math.min(4, fl.z)) / 8) * 255); }
    else { data[o + 1] = 128; data[o + 2] = 128; }
    data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
