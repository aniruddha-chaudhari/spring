// world.js — the single source of truth for the scene layout.
// Units are metres, +Y up. The camera looks from +X/+Z toward the origin, so "north" (−Z) is the back of the view.
// Every module places things with groundHeight(), streamAt(), isFree() and the ANCHORS below so the world lines up.
import * as THREE from 'three';

// ---------------------------------------------------------------- constants
export const WATER_Y = 0;          // flat water surface for the whole stream + pond
export const BORDER = 38;          // half-size of the glade (rounded square). Detail lives inside; the world continues beyond.
export const BORDER_R = 12;        // corner radius of the glade border
export const WORLD = 260;          // terrain half-size; beyond ~60m it rises into hills and mountains

// Render layer for things that must appear in the water's refraction pre-pass (terrain, rocks, stones, posts in water).
// Objects stay on layer 0 too: obj.layers.enable(LAYER_REFRACT).
export const LAYER_REFRACT = 3;

// ---------------------------------------------------------------- shared uniforms / environment
// Updated every frame by render.js / main.js. Pass these objects straight into shader uniforms (they are shared refs).
export const U = {
  uTime: { value: 0 },                                   // seconds
  uWindDir: { value: new THREE.Vector2(0.86, 0.5).normalize() }, // world XZ direction the wind blows toward
  uWindStrength: { value: 1 },                           // 0 calm .. ~1.6 gusty (presets change it)
  uSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.3).normalize() }, // direction TO the sun (or moon at night)
  uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },    // linear colour * intensity of the key light
  uNight: { value: 0 },                                  // 0 day .. 1 night
  uCloud: { value: 0.35 },                               // cloud-shadow amount 0..1
};
// ---------------------------------------------------------------- season
// Fixed per page load (?season=spring|autumn, default spring); every module simply reads SEASON at init.
// After loading, main.js prefetches the other season's files into the HTTP cache, so switching (a reload) is fast.
// 'spring': sakura in bloom, milky turquoise onsen-like water (Ghost of Tsushima hot-spring look) with pale stone.
// 'autumn': red maples, clear jade stream.
export const SEASON = (() => {
  try { return new URLSearchParams(location.search).get('season') === 'autumn' ? 'autumn' : 'spring'; }
  catch (e) { return 'spring'; }
})();
export const IS_SPRING = SEASON === 'spring';
export const env = { preset: 'afternoon', night: 0, season: SEASON };

// ---------------------------------------------------------------- math + noise
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
// smooth value noise in [-1, 1]
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}
export function fbm2(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f + i * 17.3, z * f - i * 9.1); f *= 2.03; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- the stream
// Flows from the far back-left hills (−X, −Z) to the front-right (+X, +Z), widening into a pond near the centre.
const CTRL = [
  [-150, -128], [-96, -74], [-60, -36], [-38, -33], [-21, -19], [-5, -6],
  [7, 5], [12, 15], [24, 19], [33, 31], [52, 40], [90, 60], [160, 104],
];
export const streamCurve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const STREAM_LEN = streamCurve.getLength();
const NS = Math.ceil(STREAM_LEN / 0.5);
// samples: equal arc-length points with tangent
export const streamSamples = [];
{
  const pts = streamCurve.getSpacedPoints(NS);
  for (let i = 0; i <= NS; i++) {
    const t = streamCurve.getTangentAt(i / NS);
    const n = Math.hypot(t.x, t.z);
    streamSamples.push({ x: pts[i].x, z: pts[i].z, s: (i / NS) * STREAM_LEN, tx: t.x / n, tz: t.z / n });
  }
}
function nearestSample(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < streamSamples.length; i++) {
    const p = streamSamples[i], d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return streamSamples[best];
}

// Key positions along the stream (arc length s):
const POND = nearestSample(-4, -5);
export const S_POND = POND.s;
export const S_BRIDGE = S_POND + 21;      // arched bridge downstream of the pond
export const S_STONES = S_POND + 40;      // stepping stones near the front-right
export const S_RAPIDS = S_POND - 24;      // rocky rapids upstream

// Half-width and depth of the channel along its length.
export function halfWidthAt(s) {
  const pond = Math.exp(-(((s - S_POND) / 7.5) ** 2));
  const stones = Math.exp(-(((s - S_STONES) / 4) ** 2));
  const rapids = Math.exp(-(((s - S_RAPIDS) / 6) ** 2));
  return 2.5 + 0.45 * Math.sin(s * 0.11 + 1) + 0.3 * Math.sin(s * 0.31) + 6.8 * pond + 0.9 * stones - 0.6 * rapids;
}
export function depthAt(s) {
  const pond = Math.exp(-(((s - S_POND) / 7.5) ** 2));
  const stones = Math.exp(-(((s - S_STONES) / 4) ** 2));
  const rapids = Math.exp(-(((s - S_RAPIDS) / 6) ** 2));
  return 0.75 + 1.05 * pond - 0.4 * stones - 0.35 * rapids;
}

// Nearest-sample index grid (1 m cells) so streamAt() is O(1).
const GN = WORLD * 2 + 1;
const nearestIdx = new Int32Array(GN * GN).fill(-1);
{
  const best = new Float32Array(GN * GN).fill(Infinity);
  const RAD = 48;
  for (let i = 0; i < streamSamples.length; i++) {
    const p = streamSamples[i];
    const cx = Math.round(p.x) + WORLD, cz = Math.round(p.z) + WORLD;
    for (let gz = Math.max(0, cz - RAD); gz <= Math.min(GN - 1, cz + RAD); gz++) {
      for (let gx = Math.max(0, cx - RAD); gx <= Math.min(GN - 1, cx + RAD); gx++) {
        const dx = gx - WORLD - p.x, dz = gz - WORLD - p.z, d = dx * dx + dz * dz;
        const k = gz * GN + gx;
        if (d < best[k]) { best[k] = d; nearestIdx[k] = i; }
      }
    }
  }
}

// streamAt(x, z) -> { d: distance to centreline, s: arc length, hw: half-width, depth, tx, tz: flow direction, side: +1 left/−1 right }
// Left of the flow (side +1) is the south/front bank, right (side −1) the north/back bank.
const FAR = { d: 999, s: 0, hw: 2.5, depth: 0.8, tx: 1, tz: 0, side: 1 };
export function streamAt(x, z) {
  const gx = Math.round(clamp(x, -WORLD, WORLD)) + WORLD, gz = Math.round(clamp(z, -WORLD, WORLD)) + WORLD;
  const idx = nearestIdx[gz * GN + gx];
  if (idx < 0) return FAR;
  let bd = Infinity, bs = 0, btx = 1, btz = 0, side = 1;
  for (let j = Math.max(0, idx - 4); j < Math.min(streamSamples.length - 1, idx + 4); j++) {
    const a = streamSamples[j], b = streamSamples[j + 1];
    const ex = b.x - a.x, ez = b.z - a.z, len2 = ex * ex + ez * ez;
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / len2, 0, 1);
    const px = a.x + ex * t, pz = a.z + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bd) {
      bd = d; bs = lerp(a.s, b.s, t);
      const l = Math.sqrt(len2); btx = ex / l; btz = ez / l;
      side = (btx * (z - pz) - btz * (x - px)) >= 0 ? 1 : -1;
    }
  }
  return { d: bd, s: bs, hw: halfWidthAt(bs), depth: depthAt(bs), tx: btx, tz: btz, side };
}
// Point on the centreline at arc length s, plus its flow tangent and LEFT normal (left of flow = south/front bank).
export function streamPoint(s) {
  const i = clamp(Math.round((s / STREAM_LEN) * NS), 0, NS);
  const p = streamSamples[i];
  return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, nx: -p.tz, nz: p.tx, hw: halfWidthAt(s), depth: depthAt(s) };
}
// A point on a bank: side +1 = south/front bank, −1 = north/back bank; off = metres beyond the water edge.
export function bankPoint(s, side, off) {
  const p = streamPoint(s);
  const k = side * (p.hw + off);
  return { x: p.x + p.nx * k, z: p.z + p.nz * k };
}
export function isWater(x, z, margin = 0) { const st = streamAt(x, z); return st.d < st.hw + margin; }

// ---------------------------------------------------------------- terrain height
function bump(x, z, cx, cz, r, h) { const d2 = ((x - cx) ** 2 + (z - cz) ** 2) / (r * r); return h * Math.exp(-d2 * 2); }

// Height of the land ignoring the stream carve.
function landParts(x, z) {
  let gentle = 0.9 + fbm2(x * 0.018, z * 0.018, 4) * 1.5 + fbm2(x * 0.07 + 11, z * 0.07 - 7, 3) * 0.22;
  gentle += bump(x, z, -12, -33, 10, 4.2);   // shrine hill (back left)
  gentle += bump(x, z, -36, -4, 12, 2.0);    // west rise
  gentle += bump(x, z, 28, -24, 14, 2.6);    // back-right rise
  const r = Math.hypot(x, z * 1.15);
  const mount = smoothstep(58, 175, r) * (12 + (fbm2(x * 0.011 + 5, z * 0.011, 5) * 0.5 + 0.5) * 44)
              + smoothstep(46, 80, r) * (fbm2(x * 0.03, z * 0.03, 3) * 0.5 + 0.5) * 5;
  return { gentle, mount };
}

// groundHeight(x, z): THE terrain height. Water surface is WATER_Y; the channel bed is below it.
export function groundHeight(x, z) {
  const st = streamAt(x, z);
  const { gentle, mount } = landParts(x, z);
  const hw = st.hw;
  const valley = smoothstep(hw + 3, hw + 46, st.d);
  // keep the banks above water near the stream
  let land = lerp(Math.max(gentle, 0.55), gentle, smoothstep(hw + 2, hw + 9, st.d)) + mount * valley;
  const bankW = 1.8 + 0.9 * (noise2(x * 0.3, z * 0.3) * 0.5 + 0.5);
  const edge = WATER_Y - 0.12;
  if (st.d < hw) {
    const t = st.d / hw;
    const bedNoise = fbm2(x * 0.9, z * 0.9, 2) * 0.06;
    return WATER_Y - 0.12 - st.depth * Math.pow(1 - t * t, 0.7) + bedNoise;
  }
  return lerp(edge, land, smoothstep(0, 1, (st.d - hw) / bankW));
}
// Surface normal by central differences.
export function groundNormal(x, z, e = 0.15) {
  const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
}

// Rounded-square glade border.
export function borderDist(x, z) {   // < 0 inside, > 0 outside (metres)
  const qx = Math.abs(x) - (BORDER - BORDER_R), qz = Math.abs(z) - (BORDER - BORDER_R);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - BORDER_R;
}

// ---------------------------------------------------------------- anchors (hand-placed landmarks)
const facing = (dx, dz) => Math.atan2(dx, dz);        // rot so local +Z faces (dx, dz)   (object.rotation.y = rot)
const across = (nx, nz) => Math.atan2(-nz, nx);       // rot so local +X points along (nx, nz)

const pondP = streamPoint(S_POND);
const north = { x: -pondP.nx, z: -pondP.nz };          // back bank direction at the pond
const TEA_W = 7.2, TEA_D = 5.6;
const teaC = { x: pondP.x + north.x * (pondP.hw + 1.3), z: pondP.z + north.z * (pondP.hw + 1.3) };
const bridgeP = streamPoint(S_BRIDGE);
const stonesP = streamPoint(S_STONES);

export const ANCHORS = {
  // Teahouse on the pond's north bank, its front (local +Z) facing the pond; the engawa deck hangs over the water.
  teahouse: { x: teaC.x, z: teaC.z, rot: facing(-north.x, -north.z), w: TEA_W, d: TEA_D, deck: 1.8 },
  // Arched bridge: local +X spans across the stream, centred on the centreline.
  bridge: { x: bridgeP.x, z: bridgeP.z, rot: across(bridgeP.nx, bridgeP.nz), span: bridgeP.hw * 2 + 3.2, width: 1.7 },
  // Shishi-odoshi (bamboo deer-scarer) on the pond's south bank, spout pointing into the pond.
  shishiodoshi: (() => { const b = bankPoint(S_POND - 5, 1, 0.4); const p = streamPoint(S_POND - 5); return { x: b.x, z: b.z, rot: facing(-p.nx, -p.nz) }; })(),
  // Small shrine (hokora) on the hill with a torii in front of it.
  shrine: { x: -12, z: -33.5, rot: facing(0.3, 1) },
  torii: { x: -10.6, z: -27.5, rot: facing(0.3, 1), w: 2.6 },
  steppingStones: [],
  lanterns: [],
  rocks: [],
  trees: [],      // hero trees: { type: 'maple'|'sakura'|'pine'|'cedar'|'ginkgo', x, z, s, lean: {x, z} } ('sakura' only in spring)
  paths: [],      // gravel paths: { pts: [[x,z], ...], w }
  zones: {        // areas for scattering
    cedarGrove: { x: -14, z: -44, r: 15 },
    pampasMeadows: [{ x: -24, z: 14, r: 11 }, { x: 24, z: -6, r: 9 }, { x: 4, z: 27, r: 8 }],
    lilyBanks: [{ s0: S_POND - 18, s1: S_POND - 8 }, { s0: S_BRIDGE + 4, s1: S_STONES - 6 }],
  },
};

// Stepping stones straight across at S_STONES (slight zig-zag), tops just above the water.
{
  const rnd = mulberry32(11);
  const span = stonesP.hw + 0.6;
  for (let k = -span; k <= span + 0.01; k += 0.95) {
    const j = (rnd() - 0.5) * 0.5;
    ANCHORS.steppingStones.push({
      x: stonesP.x + stonesP.nx * k + stonesP.tx * j, z: stonesP.z + stonesP.nz * k + stonesP.tz * j,
      r: 0.42 + rnd() * 0.16, rot: rnd() * Math.PI * 2,
    });
  }
}

// Gravel paths (smoothed later by whoever renders them).
{
  const bN = bankPoint(S_BRIDGE, -1, 1.7), bS = bankPoint(S_BRIDGE, 1, 1.7);
  const tea = ANCHORS.teahouse;
  const teaSide = (lx) => ({ x: tea.x + Math.cos(tea.rot) * lx, z: tea.z - Math.sin(tea.rot) * lx }); // local +X offset
  const teaE = teaSide(tea.w / 2 + 1.6), teaW = teaSide(-(tea.w / 2 + 1.6));
  ANCHORS.paths.push({ pts: [[bN.x, bN.z], [bN.x + north.x * 4 - 2, bN.z + north.z * 4], [teaE.x + 2, teaE.z + 1.5], [teaE.x, teaE.z]], w: 1.5 });
  ANCHORS.paths.push({ pts: [[bS.x, bS.z], [bS.x - 1, bS.z + 5], [bS.x - 4, bS.z + 11], [bS.x - 3, bS.z + 18]], w: 1.5 });
  ANCHORS.paths.push({ pts: [[teaW.x, teaW.z], [teaW.x - 3, teaW.z - 3.5], [-11.5, -23], [ANCHORS.torii.x, ANCHORS.torii.z + 1], [ANCHORS.shrine.x, ANCHORS.shrine.z + 2.2]], w: 1.3 });
  const sN = bankPoint(S_STONES, -1, 0.9), sS = bankPoint(S_STONES, 1, 0.9);
  ANCHORS.paths.push({ pts: [[sN.x, sN.z], [sN.x + 3, sN.z - 4], [sN.x + 9, sN.z - 7]], w: 1.1 });
  ANCHORS.paths.push({ pts: [[sS.x, sS.z], [sS.x - 2, sS.z + 4], [sS.x - 2, sS.z + 9]], w: 1.1 });
}

// Stone lanterns (tōrō).
{
  const L = (p, side = 0, along = 0) => ANCHORS.lanterns.push({ x: p.x, z: p.z, rot: 0 });
  const bN = bankPoint(S_BRIDGE - 1.6, -1, 1.2), bS = bankPoint(S_BRIDGE + 1.6, 1, 1.2);
  L(bN); L(bS);
  L(bankPoint(S_POND + 9, 1, 1.4));
  L(bankPoint(S_POND - 11, -1, 1.6));
  L({ x: -11.2, z: -21.5 });
}

// Boulders: around the pond rim, the rapids, and by the stepping stones. half = fraction sunk below ground/water.
{
  const rnd = mulberry32(7);
  const R = (s, side, off, size) => { const p = bankPoint(s, side, off); ANCHORS.rocks.push({ x: p.x, z: p.z, s: size, rot: rnd() * 6.28, seed: Math.floor(rnd() * 1e6) }); };
  R(S_POND - 3, 1, -0.3, 1.1); R(S_POND + 4, 1, 0.2, 0.8); R(S_POND + 6.5, -1, -0.6, 1.3); R(S_POND - 8, -1, 0.1, 0.9);
  R(S_POND + 11, 1, -0.2, 0.7); R(S_POND - 12, 1, 0.3, 1.0);
  for (let s = S_RAPIDS - 9; s < S_RAPIDS + 9; s += 2.2) R(s, rnd() < 0.5 ? 1 : -1, -0.9 - rnd() * 1.2, 0.5 + rnd() * 0.6);
  R(S_RAPIDS - 3, -1, 0.6, 1.6); R(S_RAPIDS + 5, 1, 0.5, 1.4);
  R(S_STONES - 3, -1, -0.2, 0.8); R(S_STONES + 3.5, 1, -0.1, 0.9);
  R(S_BRIDGE - 4, 1, -0.3, 0.7); R(S_BRIDGE + 4, -1, -0.2, 0.75);
}

// Hero trees.
{
  const T = (type, p, s, leanToWater = null) => {
    let lean = { x: 0, z: 0 };
    if (leanToWater) { const q = streamPoint(leanToWater.s); lean = { x: -q.nx * leanToWater.side, z: -q.nz * leanToWater.side }; }
    ANCHORS.trees.push({ type, x: p.x, z: p.z, s, lean });
  };
  // maples hanging over the water — in spring most become sakura (one stays as a fresh-green maple for contrast)
  // (most stand on the far/north bank so they frame the stream instead of hiding it from the camera)
  const M = IS_SPRING ? 'sakura' : 'maple';
  T(M, bankPoint(S_BRIDGE + 12, -1, 5.0), 1.0, { s: S_BRIDGE + 12, side: -1 });
  T(M, bankPoint(S_POND - 7, 1, 2.8), 1.1, { s: S_POND - 7, side: 1 });
  T('maple', bankPoint(S_STONES + 14, -1, 2.2), 1.0, { s: S_STONES + 14, side: -1 });
  T(M, bankPoint(S_RAPIDS + 2, 1, 2.4), 1.05, { s: S_RAPIDS + 2, side: 1 });
  T(M, bankPoint(S_RAPIDS - 6, -1, 2.6), 0.95, { s: S_RAPIDS - 6, side: -1 });
  if (IS_SPRING) {
    // two extra sakura: one beside the teahouse, one framing the shrine path (weeping-cherry feel by the water)
    T('sakura', bankPoint(S_POND - 15, -1, 2.6), 1.15, { s: S_POND - 15, side: -1 });
    T('sakura', { x: -16.5, z: -26 }, 1.05);
  }
  // black pines leaning over the pond
  T('pine', bankPoint(S_POND + 5.5, 1, 0.8), 1.0, { s: S_POND + 5.5, side: 1 });
  T('pine', bankPoint(S_POND - 10, -1, 1.2), 0.9, { s: S_POND - 10, side: -1 });
  // ginkgo by the shrine
  T('ginkgo', { x: -5.5, z: -30 }, 1.1);
  T('ginkgo', { x: 20, z: -18 }, 1.0);
}

// ---------------------------------------------------------------- placement helpers
function segDist(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
  const t = clamp(((px - ax) * ex + (pz - az) * ez) / l2, 0, 1);
  return Math.hypot(px - (ax + ex * t), pz - (az + ez * t));
}
// Distance from (x, z) to the nearest gravel path centreline minus its half width (<0 = on the path).
export function pathDist(x, z) {
  let best = Infinity;
  for (const p of ANCHORS.paths) {
    for (let i = 1; i < p.pts.length; i++) {
      const d = segDist(x, z, p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1]) - p.w / 2;
      if (d < best) best = d;
    }
  }
  return best;
}
// Footprints that vegetation must avoid: [{x, z, rot, hx, hz}] oriented rectangles (half extents incl. margin).
export const FOOTPRINTS = [
  { ...pick(ANCHORS.teahouse), hx: TEA_W / 2 + 1.2, hz: TEA_D / 2 + 1.2 + ANCHORS.teahouse.deck },
  { ...pick(ANCHORS.bridge), hx: ANCHORS.bridge.span / 2 + 1.2, hz: ANCHORS.bridge.width / 2 + 0.8 },
  { ...pick(ANCHORS.shrine), hx: 1.8, hz: 1.8 },
  { ...pick(ANCHORS.torii), hx: 2.2, hz: 0.8 },
  { ...pick(ANCHORS.shishiodoshi), hx: 1.4, hz: 1.4 },
];
function pick(a) { return { x: a.x, z: a.z, rot: a.rot || 0 }; }
function inFootprint(x, z, r) {
  for (const f of FOOTPRINTS) {
    const dx = x - f.x, dz = z - f.z;
    const lx = dx * Math.cos(f.rot) - dz * Math.sin(f.rot);   // inverse of local->world for rotation.y
    const lz = dx * Math.sin(f.rot) + dz * Math.cos(f.rot);
    if (Math.abs(lx) < f.hx + r && Math.abs(lz) < f.hz + r) return true;
  }
  for (const l of ANCHORS.lanterns) if (Math.hypot(x - l.x, z - l.z) < 0.9 + r) return true;
  for (const k of ANCHORS.rocks) if (Math.hypot(x - k.x, z - k.z) < k.s * 1.1 + r) return true;
  return false;
}
// isFree(x, z, r): true if a thing of radius r can stand here (dry land, off paths, outside structures).
export function isFree(x, z, r = 0.3, { waterMargin = 0.7, pathMargin = 0.2 } = {}) {
  if (isWater(x, z, waterMargin + r)) return false;
  if (pathDist(x, z) < pathMargin + r) return false;
  return !inFootprint(x, z, r);
}

// ---------------------------------------------------------------- shader helpers
// Wind: travelling gusts (like waves through a field). Include WIND_GLSL in a vertex shader and declare the uniforms
// uTime, uWindDir, uWindStrength (pass U.uTime etc.). windGust() is 0..1; windBend() gives a world-space XZ offset.
export const WIND_GLSL = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
float hk_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hk_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hk_hash(i), hk_hash(i + vec2(1, 0)), u.x), mix(hk_hash(i + vec2(0, 1)), hk_hash(i + vec2(1, 1)), u.x), u.y);
}
float windGust(vec2 xz) {
  vec2 q = xz * 0.045 - uWindDir * uTime * 0.55;
  float g = hk_noise(q) * 0.65 + hk_noise(q * 2.3 + 7.1) * 0.35;
  return smoothstep(0.25, 0.85, g);
}
// height01: 0 at the root .. 1 at the tip; stiffness: 1 = grass, ~0.15 = tree trunk
vec2 windBend(vec2 xz, float height01, float stiffness) {
  float g = windGust(xz);
  float flutter = sin(uTime * 3.1 + xz.x * 0.7 + xz.y * 0.9) * 0.5 + sin(uTime * 5.3 + xz.x * 1.3) * 0.25;
  float amt = (0.18 + g * 0.82) * uWindStrength * stiffness * height01 * height01;
  return uWindDir * amt * (0.55 + 0.45 * flutter) + vec2(-uWindDir.y, uWindDir.x) * amt * 0.18 * flutter;
}`;
// JS mirror of windGust for CPU things (particles, audio).
export function windGustAt(x, z, t) {
  const qx = x * 0.045 - U.uWindDir.value.x * t * 0.55, qz = z * 0.045 - U.uWindDir.value.y * t * 0.55;
  const g = (noise2(qx, qz) * 0.5 + 0.5) * 0.65 + (noise2(qx * 2.3 + 7.1, qz * 2.3 + 7.1) * 0.5 + 0.5) * 0.35;
  return smoothstep(0.25, 0.85, g);
}

// Cloud shadows drifting over the land: 0.0 (fully shaded) .. 1.0 (sunlit). Needs uTime, uWindDir, uCloud.
export const CLOUD_GLSL = /* glsl */`
float hk_cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(41.3, 289.1))) * 43758.5);
  float b = fract(sin(dot(i + vec2(1, 0), vec2(41.3, 289.1))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(41.3, 289.1))) * 43758.5);
  float d = fract(sin(dot(i + vec2(1, 1), vec2(41.3, 289.1))) * 43758.5);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float cloudShadow(vec2 xz) {
  vec2 q = xz * 0.018 - uWindDir * uTime * 0.012;
  float n = hk_cloudNoise(q) * 0.6 + hk_cloudNoise(q * 2.1 + 3.7) * 0.3 + hk_cloudNoise(q * 4.3) * 0.1;
  return 1.0 - uCloud * smoothstep(0.45, 0.75, n);
}`;

// Compose several onBeforeCompile patches on one material. patch(shader, material) mutates shader source/uniforms.
// Each patch needs a unique key (used for the program cache).
export function patchMaterial(material, key, patch) {
  const list = material.userData.hkPatches || (material.userData.hkPatches = []);
  if (list.some(p => p.key === key)) return material;
  list.push({ key, patch });
  material.onBeforeCompile = (shader) => { for (const p of list) p.patch(shader, material); };
  material.customProgramCacheKey = () => list.map(p => p.key).join('|');
  material.needsUpdate = true;
  return material;
}
// Ready-made patch: darken DIRECT light by drifting cloud shadows (works on any MeshStandard/Physical/Lambert material).
export function applyCloudShadows(material) {
  return patchMaterial(material, 'cloud', (shader) => {
    shader.uniforms.uTime = U.uTime; shader.uniforms.uWindDir = U.uWindDir; shader.uniforms.uCloud = U.uCloud;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hkWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nhkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    if (!shader.vertexShader.includes('hkWorldPos = (modelMatrix')) { /* worldpos chunk missing: fall back */
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nhkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 hkWorldPos;\nuniform float uTime;\nuniform vec2 uWindDir;\nuniform float uCloud;\n${CLOUD_GLSL}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float cs = cloudShadow(hkWorldPos.xz); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs; }');
  });
}

// ---------------------------------------------------------------- textures
// loadTex('mossy_rock', 'diff' | 'nor' | 'rough', { repeat: [u, v] }) — Poly Haven 1k CC0 textures in assets/tex.
// Cached per (id, map); returns a clone if a different repeat is requested.
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
export const TEX_BASE = new URL('../assets/tex/', import.meta.url).href;
export function loadTex(id, map = 'diff', { repeat = [1, 1] } = {}) {
  const key = `${id}_${map}`;
  let base = texCache.get(key);
  if (!base) {
    base = texLoader.load(`${TEX_BASE}${id}_${map}.jpg`);
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.colorSpace = map === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    base.anisotropy = 8;
    texCache.set(key, base);
  }
  if (repeat[0] === 1 && repeat[1] === 1) return base;
  const t = base.clone();
  t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}
// Available texture ids (each has _diff and _nor; mossy_rock also has _rough):
export const TEXTURES = [
  'leafy_grass', 'forest_leaves_02', 'leaf_scattered_gravel', 'river_small_rocks', 'mossy_rock', 'japanese_stone_wall',
  'japanese_cedar_bark', 'trident_maple_bark', 'pine_bark', 'hinoki_planks', 'weathered_brown_planks',
  'reed_roof_04', 'clay_plaster', 'grey_roof_tiles',
];

// ---------------------------------------------------------------- module contract
// Every feature module exports:
//   export async function init(ctx)       ctx = { renderer, scene, camera, controls }
//   export function update(dt, t, ctx)    called every frame (dt seconds, t elapsed seconds)
// and optionally:
//   export function beforeRender(ctx)     called right before the post-processing composer renders (water refraction)
//   export function setPreset(name, k)    'afternoon' | 'golden' | 'blue' | 'night' — env/U are already updated when called
