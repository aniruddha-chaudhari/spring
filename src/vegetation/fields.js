// vegetation/fields.js — cached placement fields for dense scatter inside the glade (bilinear grids).
//   edge(x,z): metres from the water's edge (<0 in water)   pd(x,z): pathDist   blocked(x,z): inside a footprint/rock/lantern
//   h(x,z): ground height   n(k, x, z): cached low-frequency noise channels
import { groundHeight, streamAt, pathDist, isFree, FOOTPRINTS, ANCHORS, fbm2 } from '../world.js';

const HALF = 56;
function grid(step, fn) {
  const n = Math.round((HALF * 2) / step) + 1;
  const a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = fn(-HALF + i * step, -HALF + j * step);
  return function (x, z, fallback) {
    const fx = (x + HALF) / step, fz = (z + HALF) / step;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return fallback(x, z);
    const i = fx | 0, jj = fz | 0, u = fx - i, v = fz - jj, k = jj * n + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + n] * (1 - u) + a[k + n + 1] * u) * v;
  };
}

let F = null;
export function fields() {
  if (F) return F;
  const edgeFn = (x, z) => { const s = streamAt(x, z); return s.d - s.hw; };
  const edgeG = grid(0.5, edgeFn);
  const pdG = grid(0.5, pathDist);
  const hG = grid(0.4, groundHeight);
  // obstacle mask at 0.25 m, only evaluated near obstacles
  const MS = 0.25, MN = Math.round((HALF * 2) / MS) + 1;
  const mask = new Uint8Array(MN * MN);
  const mark = (cx, cz, r) => {
    const i0 = Math.max(0, Math.floor((cx - r + HALF) / MS)), i1 = Math.min(MN - 1, Math.ceil((cx + r + HALF) / MS));
    const j0 = Math.max(0, Math.floor((cz - r + HALF) / MS)), j1 = Math.min(MN - 1, Math.ceil((cz + r + HALF) / MS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * MN + i; if (mask[k]) continue;
      const x = -HALF + i * MS, z = -HALF + j * MS;
      if (!isFree(x, z, 0, { waterMargin: -1e3, pathMargin: -1e3 })) mask[k] = 1;
    }
  };
  for (const f of FOOTPRINTS) mark(f.x, f.z, Math.hypot(f.hx, f.hz) + 0.5);
  for (const r of ANCHORS.rocks) mark(r.x, r.z, r.s * 1.1 + 0.5);
  for (const l of ANCHORS.lanterns) mark(l.x, l.z, 1.4);
  const blocked = (x, z) => {
    const i = Math.round((x + HALF) / MS), j = Math.round((z + HALF) / MS);
    if (i < 0 || j < 0 || i >= MN || j >= MN) return false;
    return mask[j * MN + i] === 1;
  };
  const noiseG = [
    grid(1, (x, z) => fbm2(x * 0.09 + 3.1, z * 0.09 - 1.7, 3)),     // 0 tall/short patches
    grid(1, (x, z) => fbm2(x * 0.045, z * 0.045, 2)),               // 1 broad height
    grid(1, (x, z) => fbm2(x * 0.05 - 7, z * 0.05 + 4, 3)),         // 2 dryness
    grid(1, (x, z) => fbm2(x * 0.11 + 20, z * 0.11 - 13, 3)),       // 3 rust patches
    grid(1, (x, z) => fbm2(x * 0.07 - 40, z * 0.07 + 31, 3)),       // 4 green patches
  ];
  const noiseFb = [
    (x, z) => fbm2(x * 0.09 + 3.1, z * 0.09 - 1.7, 3), (x, z) => fbm2(x * 0.045, z * 0.045, 2),
    (x, z) => fbm2(x * 0.05 - 7, z * 0.05 + 4, 3), (x, z) => fbm2(x * 0.11 + 20, z * 0.11 - 13, 3),
    (x, z) => fbm2(x * 0.07 - 40, z * 0.07 + 31, 3),
  ];
  F = {
    edge: (x, z) => edgeG(x, z, edgeFn),
    pd: (x, z) => pdG(x, z, pathDist),
    h: (x, z) => hG(x, z, groundHeight),
    blocked,
    n: (k, x, z) => noiseG[k](x, z, noiseFb[k]),
    // fast isFree equivalent
    free: (x, z, r = 0.3, waterMargin = 0.7, pathMargin = 0.2) => {
      if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return isFree(x, z, r, { waterMargin, pathMargin });
      if (edgeG(x, z, edgeFn) < waterMargin + r) return false;
      if (pdG(x, z, pathDist) < pathMargin + r) return false;
      if (r <= 0.3) return !blocked(x, z);
      return isFree(x, z, r, { waterMargin: -1e3, pathMargin: -1e3 });
    },
  };
  return F;
}
