// nature.js — instanced trees (fluffy wind-swayed crowns), seasonal particles, fireflies and koi.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  R, WATER, heightAt, state, env, SEASONS, uTime, LAYER_FX,
  mergeAll, mulberry32, canvasTex, smoothstep, clamp,
} from './core.js';

// ---------------------------------------------------------------- public constants
export const TREE_SPACING = { sakura: 2.2, maple: 1.8, pine: 2.0, bamboo: 1.0, bush: 0.95 };

const TYPES = ['sakura', 'maple', 'pine', 'bamboo', 'bush'];

// ---------------------------------------------------------------- module state
let root = null, treeGroup = null;
const GEO = {};                 // type -> { trunk: BufferGeometry | null, crown: BufferGeometry }
const crownMats = {}, trunkMats = {};
let depthCrown = null, depthTrunk = null;
const treeMeshes = [];
const uSnow = { value: 0 };
let season = 'spring';

const _pos = new THREE.Vector3(), _scl = new THREE.Vector3(), _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4(), _col = new THREE.Color(), _yAxis = new THREE.Vector3(0, 1, 0);
const _v2 = new THREE.Vector2();

// ---------------------------------------------------------------- geometry helpers
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _lq = new THREE.Quaternion();

// Tapered cylinder from point a to point b (radius r0 at a, r1 at b).
function limb(a, b, r0, r1, seg = 7) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-3;
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  _lq.setFromUnitVectors(_up, _dir.set(dx, dy, dz).normalize());
  g.applyQuaternion(_lq);
  g.translate(a[0], a[1], a[2]);
  return g;
}
function ball(p, r, seg = 7) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
  g.translate(p[0], p[1], p[2]);
  return g;
}
// Polyline of limbs with smooth ball joints.
function chain(out, pts, radii, seg = 7) {
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(limb(pts[i], pts[i + 1], radii[i], radii[i + 1], seg));
    if (i > 0) out.push(ball(pts[i], radii[i] * 1.03, seg));
  }
}

// Smooth deterministic pseudo-noise in ~[-1, 1].
const noise3 = (x, y, z) =>
  (Math.sin(x * 1.7 + Math.sin(z * 1.3)) * Math.cos(y * 1.9 + Math.sin(x * 1.1)) +
   0.6 * Math.sin(z * 2.3 + Math.cos(y * 1.7)) * Math.cos(x * 0.7 - y * 1.3)) / 1.6;

// One lumpy foliage clump: indexed icosphere, vertex-noise displaced, smooth normals.
// c = { x, y, z, r, sx, sy, sz, amp, flat }   flat: clamp the underside (pine pads / bush mounds)
function clumpGeo(c, detail, rng) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const P = g.attributes.position;
  const s1 = rng() * 50, s2 = rng() * 50, s3 = rng() * 50;
  const amp = c.amp ?? 0.17;
  const sx = c.sx ?? 1, sy = c.sy ?? 1, sz = c.sz ?? 1;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const k = 1 + amp * noise3(x * 2.2 + s1, y * 2.2 + s2, z * 2.2 + s3)
                + amp * 0.45 * noise3(x * 5.3 + s3, y * 5.3 + s1, z * 5.3 + s2);
    x *= k; y *= k; z *= k;
    if (c.flat !== undefined && y < -c.flat) y = -c.flat + (y + c.flat) * 0.22;
    P.setXYZ(i, c.x + x * c.r * sx, c.y + y * c.r * sy, c.z + z * c.r * sz);
  }
  g.computeVertexNormals();
  return g;
}

// Merge clumps into one crown. Normals are bent toward an ellipsoid around the crown (or each clump
// for separate pads) so the foliage reads as one soft volume; vertex colours carry a baked AO.
function crownGeo(clumps, o = {}) {
  const detail = o.detail ?? 2, bend = o.bend ?? 0.5, perClump = !!o.perClump;
  const rng = mulberry32(o.seed ?? 7);
  const geos = clumps.map(c => clumpGeo(c, detail, rng));
  const box = new THREE.Box3();
  for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
  const ex = (box.max.x - box.min.x) / 2, ey = (box.max.y - box.min.y) / 2, ez = (box.max.z - box.min.z) / 2;
  geos.forEach((g, gi) => {
    const c = clumps[gi];
    const P = g.attributes.position, Nn = g.attributes.normal;
    const col = new Float32Array(P.count * 3);
    const bx = perClump ? c.x : cx, by = perClump ? c.y : cy, bz = perClump ? c.z : cz;
    const rx = perClump ? c.r * (c.sx ?? 1) : ex, ry = perClump ? c.r * (c.sy ?? 1) : ey, rz = perClump ? c.r * (c.sz ?? 1) : ez;
    for (let i = 0; i < P.count; i++) {
      const px = P.getX(i), py = P.getY(i), pz = P.getZ(i);
      const dx = (px - bx) / rx, dy = (py - by) / ry, dz = (pz - bz) / rz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      let nx = Nn.getX(i) * (1 - bend) + (dx / dl) * bend;
      let ny = Nn.getY(i) * (1 - bend) + (dy / dl) * bend;
      let nz = Nn.getZ(i) * (1 - bend) + (dz / dl) * bend;
      const nl = Math.hypot(nx, ny, nz) || 1;
      Nn.setXYZ(i, nx / nl, ny / nl, nz / nl);
      // baked ambient occlusion: darker low down and in crevices between clumps
      const gx = (px - cx) / ex, gy = (py - cy) / ey, gz = (pz - cz) / ez;
      const outw = smoothstep(0.5, 1.0, Math.hypot(gx, gy, gz));
      let ao = (0.6 + 0.4 * smoothstep(box.min.y, box.max.y, py)) * (0.72 + 0.28 * outw);
      if (perClump) ao *= 0.68 + 0.32 * smoothstep(-0.9, 0.5, dy);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return merged;
}

// ---------------------------------------------------------------- tree designs (base at y = 0, s = 1)
function buildSakura() {
  const t = [];
  chain(t, [[0, -0.25, 0], [0.02, 0.3, 0.03], [0.13, 0.75, 0.02], [0.05, 1.15, -0.04]], [0.2, 0.17, 0.14, 0.11], 8);
  t.push(limb([0, -0.15, 0], [0, 0.22, 0], 0.27, 0.16, 8));                       // root flare
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4;
    t.push(limb([0, 0.12, 0], [Math.cos(a) * 0.36, -0.08, Math.sin(a) * 0.36], 0.09, 0.035, 6));
  }
  for (let i = 0; i < 5; i++) {                                                     // spreading branches
    const a = i * Math.PI * 2 / 5 + 0.3, w = i % 2 ? 0.08 : -0.06;
    chain(t, [[0.05, 1.12, -0.04], [Math.cos(a) * 0.45, 1.42 + w, Math.sin(a) * 0.45], [Math.cos(a + 0.25) * 0.95, 1.62 + w, Math.sin(a + 0.25) * 0.95]], [0.085, 0.055, 0.028], 6);
  }
  t.push(limb([0.05, 1.12, -0.04], [0.02, 1.8, 0.05], 0.07, 0.03, 6));
  const rng = mulberry32(11), clumps = [{ x: 0, y: 2.0, z: 0, r: 0.72, sx: 1.25, sy: 0.62, sz: 1.25 }];
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7 + rng() * 0.35, d = 0.92 + rng() * 0.14;
    clumps.push({ x: Math.cos(a) * d, y: 1.7 + rng() * 0.22, z: Math.sin(a) * d, r: 0.48 + rng() * 0.1, sx: 1.15, sy: 0.72, sz: 1.15 });
  }
  return { trunk: mergeAll(t), crown: crownGeo(clumps, { seed: 21, bend: 0.55 }) };
}

function buildMaple() {
  const t = [];
  chain(t, [[0, -0.25, 0], [0.03, 0.5, 0], [-0.02, 1.0, 0.02], [0.02, 1.45, 0]], [0.12, 0.1, 0.085, 0.055], 7);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.5;
    chain(t, [[-0.02, 0.98, 0.02], [Math.cos(a) * 0.3, 1.35, Math.sin(a) * 0.3], [Math.cos(a) * 0.5, 1.65, Math.sin(a) * 0.5]], [0.055, 0.038, 0.022], 6);
  }
  const rng = mulberry32(12);
  const clumps = [
    { x: 0, y: 1.82, z: 0, r: 0.7, sx: 1.15, sy: 0.95, sz: 1.15 },
    { x: 0.05, y: 2.32, z: -0.05, r: 0.5 },
  ];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + rng() * 0.4, d = 0.58 + rng() * 0.1;
    clumps.push({ x: Math.cos(a) * d, y: 1.62 + rng() * 0.3, z: Math.sin(a) * d, r: 0.43 + rng() * 0.1, sy: 0.9 });
  }
  return { trunk: mergeAll(t), crown: crownGeo(clumps, { seed: 22, bend: 0.55 }) };
}

function buildPine() {
  const t = [];
  chain(t, [[0, -0.25, 0], [0.05, 0.35, 0.02], [0.32, 0.85, 0.06], [0.18, 1.35, 0.16], [0.42, 1.85, 0.05], [0.3, 2.35, -0.02]],
    [0.19, 0.16, 0.13, 0.11, 0.085, 0.06], 8);
  t.push(limb([0, -0.15, 0], [0.03, 0.2, 0.01], 0.26, 0.17, 8));
  const pads = [
    { from: [0.26, 0.78, 0.05], x: -0.75, y: 1.05, z: 0.35, r: 0.58 },
    { from: [0.27, 1.05, 0.11], x: 1.05, y: 1.3, z: -0.3, r: 0.52 },
    { from: [0.22, 1.45, 0.14], x: -0.45, y: 1.7, z: -0.5, r: 0.46 },
    { from: [0.4, 1.8, 0.06], x: 0.95, y: 2.0, z: 0.5, r: 0.42 },
    { from: [0.38, 1.98, 0.04], x: -0.25, y: 2.15, z: 0.4, r: 0.38 },
  ];
  const clumps = [];
  for (const p of pads) {
    const end = [p.x * 0.85 + p.from[0] * 0.15, p.y - 0.04, p.z * 0.85 + p.from[2] * 0.15];
    const mid = [(p.from[0] + end[0]) / 2, (p.from[1] + end[1]) / 2 + 0.06, (p.from[2] + end[2]) / 2];
    chain(t, [p.from, mid, end], [0.07, 0.05, 0.03], 6);
    clumps.push({ x: p.x, y: p.y, z: p.z, r: p.r, sx: 1.15, sy: 0.38, sz: 1.0, amp: 0.2, flat: 0.25 });
  }
  clumps.push({ x: 0.3, y: 2.5, z: -0.02, r: 0.5, sx: 1.1, sy: 0.44, sz: 1.0, amp: 0.2, flat: 0.3 });
  return { trunk: mergeAll(t), crown: crownGeo(clumps, { seed: 23, bend: 0.45, perClump: true }) };
}

function buildBamboo() {
  const rng = mulberry32(31);
  const t = [], tufts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rng() * 0.6, d = 0.08 + rng() * 0.26;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const H = 2.9 + rng() * 0.75, lean = 0.15 + rng() * 0.3;
    const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
    const r = 0.038 + rng() * 0.014;
    const A = [bx, -0.25, bz], B = [tx, H, tz];
    t.push(limb(A, B, r * 1.1, r * 0.72, 7));
    const L = H + 0.25, ux = (tx - bx) / L, uz = (tz - bz) / L;
    for (let y = 0.3 + rng() * 0.1; y < H - 0.25; y += 0.36 + rng() * 0.08) {   // node rings
      const f = (y + 0.25) / L, rr = r * (1.1 - 0.38 * f) * 1.3;
      const p = [bx + ux * (y + 0.25), y, bz + uz * (y + 0.25)];
      t.push(limb(p, [p[0] + ux * 0.035, y + 0.035, p[2] + uz * 0.035], rr, rr, 7));
    }
    const px = -Math.sin(a), pz = Math.cos(a);
    for (let k = 0; k < 3; k++) {                                                   // leaf tufts
      const f = 0.6 + k * 0.13 + rng() * 0.05, side = k % 2 ? 1 : -1;
      const y = -0.25 + L * f;
      tufts.push({ x: bx + (tx - bx) * f + px * side * 0.17, y, z: bz + (tz - bz) * f + pz * side * 0.17,
        r: 0.2 + rng() * 0.06, sx: 1.45, sy: 0.42, sz: 1.0, amp: 0.25 });
    }
    tufts.push({ x: tx, y: H + 0.04, z: tz, r: 0.17 + rng() * 0.04, sx: 0.9, sy: 0.85, sz: 0.9, amp: 0.25 });
  }
  return { trunk: mergeAll(t), crown: crownGeo(tufts, { seed: 24, bend: 0.5, perClump: true, detail: 1 }) };
}

function buildBush() {
  const rng = mulberry32(41);
  const clumps = [
    { x: 0, y: 0.36, z: 0, r: 0.5, sx: 1.3, sy: 0.75, sz: 1.3, flat: 0.55, amp: 0.13 },
    { x: 0.05, y: 0.56, z: -0.03, r: 0.34, amp: 0.13 },
  ];
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + rng() * 0.4, d = 0.46 + rng() * 0.08;
    clumps.push({ x: Math.cos(a) * d, y: 0.3, z: Math.sin(a) * d, r: 0.34 + rng() * 0.05, sx: 1.1, sy: 0.85, sz: 1.1, flat: 0.6, amp: 0.13 });
  }
  return { trunk: null, crown: crownGeo(clumps, { seed: 25, bend: 0.6 }) };
}

// ---------------------------------------------------------------- foliage / trunk shader patch
// Wind sway (amplitude grows with local height) for trunks and crowns; crowns also flutter, get a
// leafy brightness grain, a snow tint on upward faces and soft wrap / back-light / rim lighting.
const VERT_COMMON = /* glsl */`#include <common>
uniform float uTime;
#ifdef HK_LEAF
varying vec3 vLeafP;
#endif`;
const VERT_WIND = /* glsl */`#include <begin_vertex>
{
#ifdef USE_INSTANCING
  vec3 hkO = instanceMatrix[3].xyz;
  mat3 hkM = mat3(instanceMatrix);
#else
  vec3 hkO = vec3(0.0);
  mat3 hkM = mat3(1.0);
#endif
  float hkS2 = max(dot(hkM[0], hkM[0]), 1e-4);
  float hkH = max(position.y, 0.0);
  float hkPh = dot(hkO.xz, vec2(0.37, 0.29));
  float hkG = sin(uTime * 0.9 + hkPh) * 0.6 + sin(uTime * 1.7 + hkPh * 1.3) * 0.3 + sin(uTime * 3.1 + hkPh * 0.7 + position.y) * 0.1;
  vec3 hkW = vec3(0.3 + hkG, 0.0, 0.3 * sin(uTime * 1.3 + hkPh * 1.9)) * (0.010 * hkH * hkH);
  // world-space wind offset -> instance-local offset (instance matrix = uniform scale * rotation)
  transformed += vec3(dot(hkM[0], hkW), dot(hkM[1], hkW), dot(hkM[2], hkW)) / hkS2;
#ifdef HK_CROWN
  transformed += normal * (sin(uTime * 2.3 + hkPh + dot(position, vec3(5.1, 3.7, 4.3))) * 0.012 * hkH);
#endif
#ifdef HK_LEAF
  vLeafP = position * 9.0 + hkO * 1.7;
#endif
}`;
const FRAG_COMMON = /* glsl */`#include <common>
#ifdef HK_LEAF
uniform float uSnow;
varying vec3 vLeafP;
float hkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hkNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hkHash(i + vec3(0.0, 0.0, 0.0)), hkHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hkHash(i + vec3(0.0, 1.0, 0.0)), hkHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hkHash(i + vec3(0.0, 0.0, 1.0)), hkHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hkHash(i + vec3(0.0, 1.0, 1.0)), hkHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
#endif`;
const FRAG_SNOW = /* glsl */`#include <normal_fragment_maps>
#ifdef HK_LEAF
{
  float hkLeaf = hkNoise(vLeafP) * 0.65 + hkNoise(vLeafP * 2.7) * 0.35;
  diffuseColor.rgb *= 0.86 + 0.28 * hkLeaf;
  vec3 hkWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float hkSnow = uSnow * smoothstep(0.2, 0.65, hkWN.y + (hkLeaf - 0.5) * 0.4);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), hkSnow);
}
#endif`;
const FRAG_SSS = /* glsl */`#include <lights_fragment_end>
#if defined( HK_LEAF ) && NUM_DIR_LIGHTS > 0
{
  vec3 hkL = directionalLights[0].direction;
  vec3 hkV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float hkNL = dot(normal, hkL);
  float hkWrap = max(0.0, (hkNL + 0.6) / 1.6) - max(0.0, hkNL);
  float hkRim = pow(1.0 - max(0.0, dot(normal, hkV)), 3.0);
  float hkBack = pow(max(0.0, dot(-hkV, hkL)), 3.0) * (0.35 + 0.65 * hkRim);
  reflectedLight.directDiffuse += material.diffuseColor * directionalLights[0].color * RECIPROCAL_PI
    * (hkWrap * 0.3 + hkBack * 0.4 + hkRim * 0.1);
}
#endif`;

function windPatch(shader) {
  shader.uniforms.uTime = uTime;
  shader.uniforms.uSnow = uSnow;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', VERT_COMMON)
    .replace('#include <begin_vertex>', VERT_WIND);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', FRAG_COMMON)
    .replace('#include <normal_fragment_maps>', FRAG_SNOW)
    .replace('#include <lights_fragment_end>', FRAG_SSS);
}
function windMaterial(mat, defines) {
  mat.defines = { ...(mat.defines || {}), ...defines };
  mat.onBeforeCompile = windPatch;
  mat.customProgramCacheKey = () => 'hk-wind';
  return mat;
}

// ---------------------------------------------------------------- particles (petals / leaves / snow, fireflies)
const PTS_VERT = /* glsl */`
uniform float uTime;
uniform float uSize;
uniform float uScale;
uniform float uAspect;
uniform float uTumble;
uniform float uLight;
uniform vec3 uColA;
uniform vec3 uColB;
attribute vec4 aRand;   // x size mult, y colour mix, z spin speed, w phase
varying vec3 vCol;
varying float vAngle;
varying float vSquash;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float ps = uSize * aRand.x * projectionMatrix[1][1] * uScale;
  if (projectionMatrix[3][3] == 0.0) ps /= max(-mvPosition.z, 0.05);
  vCol = mix(uColA, uColB, aRand.y) * uLight;
#ifdef GLOW
  float b = sin(uTime * (1.1 + aRand.z) + aRand.w * 6.2831);
  vAlpha = 0.06 + 0.94 * smoothstep(0.25, 0.95, b);
  vAngle = 0.0;
  vSquash = 1.0;
  ps *= 0.65 + 0.35 * vAlpha;
#else
  float spin = uTime * aRand.z + aRand.w * 6.2831;
  float flip = abs(sin(spin * 0.6));                    // flat flake turning face-on / edge-on
  vAngle = spin;
  vSquash = mix(1.0, uAspect / mix(0.3, 1.0, flip), uTumble);
  vAlpha = 1.0;
  ps *= mix(1.0, 0.8 + 0.2 * flip, uTumble);
  vCol *= mix(1.0, 0.82 + 0.25 * flip, uTumble);
#endif
  gl_PointSize = max(ps, 1.0);
  #include <fog_vertex>
}`;
const PTS_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uOpacity;
varying vec3 vCol;
varying float vAngle;
varying float vSquash;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vAngle), s = sin(vAngle);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.y *= vSquash;
  vec2 uv = p + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  float a = texture2D(uMap, uv).a * vAlpha * uOpacity;
  if (a < 0.01) discard;
  vec3 col = vCol;
#ifndef GLOW
  col *= 0.9 + 0.2 * (0.5 - p.x);                       // soft tip-to-base shading
#endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function pointsMaterial(tex, glow) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uSize: { value: 0.16 }, uScale: { value: 400 }, uAspect: { value: 1 }, uTumble: { value: 0 },
    uLight: { value: 1 }, uOpacity: { value: 1 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() },
    uMap: { value: null },
  }]);
  uniforms.uTime = uTime;
  uniforms.uMap.value = tex;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: PTS_VERT, fragmentShader: PTS_FRAG,
    defines: glow ? { GLOW: '' } : {},
    transparent: true, depthWrite: false, fog: true,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
function setPointScale(renderer, scene, camera, geometry, material) {
  renderer.getDrawingBufferSize(_v2);
  material.uniforms.uScale.value = _v2.y * 0.5;
}

const FLAKE_MAX = 450;
const FLAKES = {
  spring: { n: 180, size: 0.16, aspect: 1.7, tumble: 1, a: '#f5b6c9', b: '#fde2eb', fall: [0.3, 0.55], sway: 0.55, wind: 0.28, rest: [1.5, 3.5], opacity: 0.95 },
  autumn: { n: 120, size: 0.18, aspect: 1.3, tumble: 1, a: '#c63d26', b: '#e8902c', fall: [0.45, 0.75], sway: 0.6, wind: 0.3, rest: [2, 4], opacity: 1 },
  winter: { n: 450, size: 0.09, aspect: 1, tumble: 0, a: '#ffffff', b: '#e4ecfa', fall: [0.9, 1.4], sway: 0.25, wind: 0.18, rest: [0.4, 1.2], opacity: 0.95 },
  summer: null,
};
let flakePoints = null, flakeMat = null, flakeCfg = null, flakeCount = 0;
const flakePos = new Float32Array(FLAKE_MAX * 3), flakeRand = new Float32Array(FLAKE_MAX * 4);
const fVy = new Float32Array(FLAKE_MAX), fPh = new Float32Array(FLAKE_MAX), fFq = new Float32Array(FLAKE_MAX);
const fRest = new Float32Array(FLAKE_MAX), fWater = new Uint8Array(FLAKE_MAX);

function randDisc(rr) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * rr; _v2.set(Math.cos(a) * d, Math.sin(a) * d); return _v2; }

function spawnFlake(i, anyHeight) {
  const cfg = flakeCfg;
  const p = randDisc(R * 0.98), x = p.x, z = p.y;
  const g = Math.max(heightAt(x, z), WATER);
  flakePos[i * 3] = x;
  flakePos[i * 3 + 1] = anyHeight ? g + 0.5 + Math.random() * (11.5 - g) : 8 + Math.random() * 4;
  flakePos[i * 3 + 2] = z;
  fVy[i] = cfg.fall[0] + Math.random() * (cfg.fall[1] - cfg.fall[0]);
  fPh[i] = Math.random() * Math.PI * 2;
  fFq[i] = 0.7 + Math.random() * 0.9;
  fRest[i] = 0; fWater[i] = 0;
}

function setFlakeMode(s) {
  flakeCfg = FLAKES[s] || null;
  if (!flakePoints) return;
  if (!flakeCfg) { flakeCount = 0; flakePoints.visible = false; return; }
  const cfg = flakeCfg, u = flakeMat.uniforms;
  flakeCount = cfg.n;
  u.uSize.value = cfg.size; u.uAspect.value = cfg.aspect; u.uTumble.value = cfg.tumble; u.uOpacity.value = cfg.opacity;
  u.uColA.value.set(cfg.a); u.uColB.value.set(cfg.b);
  for (let i = 0; i < flakeCount; i++) {
    spawnFlake(i, true);
    flakeRand[i * 4] = 0.75 + Math.random() * 0.5;
    flakeRand[i * 4 + 1] = Math.random();
    flakeRand[i * 4 + 2] = (0.8 + Math.random() * 2.2) * (Math.random() < 0.5 ? -1 : 1);
    flakeRand[i * 4 + 3] = Math.random();
  }
  const g = flakePoints.geometry;
  g.setDrawRange(0, flakeCount);
  g.attributes.position.needsUpdate = true;
  g.attributes.aRand.needsUpdate = true;
  flakePoints.visible = true;
}

function updateFlakes(dt, t) {
  const cfg = flakeCfg, P = flakePos, n = flakeCount;
  const windX = cfg.wind * (0.7 + 0.3 * Math.sin(t * 0.21)), windZ = cfg.wind * 0.35 * Math.sin(t * 0.13 + 1.0);
  const R2 = R * R;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    let x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
    if (fRest[i] > 0) {                                 // lying on the ground / floating on the pond
      fRest[i] -= dt;
      if (fWater[i]) { x += windX * 0.15 * dt; z += windZ * 0.15 * dt; }
      if (fRest[i] <= 0 || x * x + z * z > R2 || (fWater[i] && heightAt(x, z) >= WATER)) { spawnFlake(i, false); continue; }
      P[i3] = x; P[i3 + 2] = z;
      continue;
    }
    const ph = fPh[i], f = fFq[i];
    x += (windX + Math.sin(t * f + ph) * cfg.sway) * dt;
    z += (windZ + Math.cos(t * f * 0.8 + ph * 1.3) * cfg.sway) * dt;
    y -= fVy[i] * (0.75 + 0.25 * Math.sin(t * f * 1.7 + ph)) * dt;
    if (x * x + z * z > R2) { spawnFlake(i, false); continue; }
    let g = heightAt(x, z);
    const wet = g < WATER;
    if (wet) g = WATER;
    if (y <= g + 0.03) {
      y = g + 0.03;
      fRest[i] = cfg.rest[0] + Math.random() * (cfg.rest[1] - cfg.rest[0]);
      fWater[i] = wet ? 1 : 0;
    }
    P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
  }
  flakePoints.geometry.attributes.position.needsUpdate = true;
}

// fireflies
const FF_N = 90;
let ffPoints = null, ffMat = null;
const ffPos = new Float32Array(FF_N * 3), ffRand = new Float32Array(FF_N * 4);
const ffHx = new Float32Array(FF_N), ffHz = new Float32Array(FF_N), ffH = new Float32Array(FF_N);
const ffA = new Float32Array(FF_N), ffP = new Float32Array(FF_N);

function placeFireflies() {
  const trees = state.trees;
  for (let i = 0; i < FF_N; i++) {
    let x, z;
    if (trees.length && Math.random() < 0.6) {
      const tr = trees[(Math.random() * trees.length) | 0];
      x = tr.x + (Math.random() - 0.5) * 3; z = tr.z + (Math.random() - 0.5) * 3;
    } else { const p = randDisc(R * 0.9); x = p.x; z = p.y; }
    const d = Math.hypot(x, z), lim = R - 1.5;
    if (d > lim) { x *= lim / d; z *= lim / d; }
    ffHx[i] = x; ffHz[i] = z;
    ffH[i] = 0.7 + Math.random() * 1.5;
    ffA[i] = 0.12 + Math.random() * 0.22;
    ffP[i] = Math.random() * 100;
  }
}

function updateFireflies(t) {
  const lim2 = (R - 0.3) * (R - 0.3);
  for (let i = 0; i < FF_N; i++) {
    const a = ffA[i], p = ffP[i];
    let x = ffHx[i] + Math.sin(t * a + p) * 1.3 + Math.sin(t * a * 2.3 + p * 1.7) * 0.45;
    let z = ffHz[i] + Math.cos(t * a * 0.9 + p * 1.3) * 1.3 + Math.sin(t * a * 1.9 + p * 0.6) * 0.45;
    const d2 = x * x + z * z;
    if (d2 > lim2) { const k = Math.sqrt(lim2 / d2); x *= k; z *= k; }
    const g = Math.max(heightAt(x, z), WATER);
    const y = g + Math.max(0.4, ffH[i] + Math.sin(t * a * 1.4 + p * 2.1) * 0.3);
    ffPos[i * 3] = x; ffPos[i * 3 + 1] = y; ffPos[i * 3 + 2] = z;
  }
  ffPoints.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- koi
const KOI_MAX = 14;
const KOI_DEPTH = WATER - 0.22;
const KOI_VARIANTS = [
  ['#d63c1e', 0.0],    // kohaku: red on white
  ['#f07a22', 3.0],    // solid orange
  ['#ece6da', 3.0],    // platinum white
  ['#d23a22', -0.55],  // mostly white, red patches
  ['#f39a2a', 0.35],   // orange & white
];
let koiMesh = null, koiCount = 0;
const kx = new Float32Array(KOI_MAX), kz = new Float32Array(KOI_MAX), kh = new Float32Array(KOI_MAX);
const ksp = new Float32Array(KOI_MAX), kph = new Float32Array(KOI_MAX), ksz = new Float32Array(KOI_MAX);
const kturn = new Float32Array(KOI_MAX);
const KOI_GRID = 0.5;
const deepCells = new Float32Array(Math.pow(Math.ceil(2 * R / KOI_GRID) + 1, 2) * 2);
let deepCount = 0;

const isDeep = (x, z) => x * x + z * z < (R - 0.3) * (R - 0.3) && heightAt(x, z) < KOI_DEPTH;

function koiGeo() {
  const parts = [];
  const body = new THREE.SphereGeometry(1, 14, 10);
  body.scale(0.19, 0.055, 0.072); body.translate(0.02, 0, 0);
  parts.push(body);
  const tail = new THREE.ConeGeometry(0.075, 0.15, 8);
  tail.rotateZ(-Math.PI / 2);                 // tip toward +x (body), fan toward -x
  tail.scale(1, 0.16, 1); tail.translate(-0.21, 0, 0);
  parts.push(tail);
  for (const s of [-1, 1]) {
    const fin = new THREE.SphereGeometry(1, 8, 4);
    fin.scale(0.04, 0.008, 0.05); fin.rotateY(s * 0.5); fin.translate(0.07, -0.02, s * 0.075);
    parts.push(fin);
  }
  const g = mergeAll(parts);
  const aKoi = new Float32Array(KOI_MAX * 2);
  const rng = mulberry32(77);
  for (let i = 0; i < KOI_MAX; i++) { aKoi[i * 2] = rng() * 20; aKoi[i * 2 + 1] = KOI_VARIANTS[i % KOI_VARIANTS.length][1]; }
  g.setAttribute('aKoi', new THREE.InstancedBufferAttribute(aKoi, 2));
  return g;
}

function koiPatch(shader) {
  shader.uniforms.uTime = uTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform float uTime;
attribute vec2 aKoi;
varying float vKoiMask;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  float hkPh = dot(instanceMatrix[3].xz, vec2(1.7, 2.3));
#else
  float hkPh = 0.0;
#endif
  float hkTail = max(0.06 - position.x, 0.0);
  transformed.z += sin(uTime * 7.0 + hkPh - position.x * 6.0) * 0.5 * hkTail * hkTail;
  float hkN = sin(position.x * 26.0 + aKoi.x) + 0.7 * sin(position.z * 45.0 + aKoi.x * 2.3) + 0.5 * sin(position.y * 30.0 + aKoi.x * 1.3);
  vKoiMask = smoothstep(-0.25, 0.25, hkN + aKoi.y);
}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying float vKoiMask;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = mix(vec3(0.96, 0.94, 0.9), diffuseColor.rgb, vKoiMask);`);
}

function sampleDeep() {
  deepCount = 0;
  for (let z = -R; z <= R; z += KOI_GRID) {
    for (let x = -R; x <= R; x += KOI_GRID) {
      if (isDeep(x, z)) { deepCells[deepCount * 2] = x; deepCells[deepCount * 2 + 1] = z; deepCount++; }
    }
  }
}

function placeKoi(i) {
  if (!deepCount) return false;
  for (let tries = 0; tries < 8; tries++) {
    const c = (Math.random() * deepCount) | 0;
    let x = deepCells[c * 2], z = deepCells[c * 2 + 1];
    if (tries < 7) { x += (Math.random() - 0.5) * KOI_GRID * 0.8; z += (Math.random() - 0.5) * KOI_GRID * 0.8; }
    if (isDeep(x, z) || tries === 7) { kx[i] = x; kz[i] = z; break; }
  }
  kh[i] = Math.random() * Math.PI * 2;
  return true;
}

export function respawnKoi() {
  if (!koiMesh) return;
  sampleDeep();
  const area = deepCount * KOI_GRID * KOI_GRID;
  const target = area < 1.5 ? 0 : Math.min(KOI_MAX, Math.max(1, Math.round(area / 2.2)));
  for (let i = 0; i < target; i++) {
    if (i >= koiCount || !isDeep(kx[i], kz[i])) placeKoi(i);
  }
  koiCount = target;
  koiMesh.count = koiCount;
  koiMesh.visible = koiCount > 0;
  writeKoiMatrices(0);
}

function updateKoi(dt, t) {
  const look = 0.55;
  for (let i = 0; i < koiCount; i++) {
    let h = kh[i], speedK = 1;
    if (!isDeep(kx[i], kz[i])) { placeKoi(i); continue; }   // terrain changed under it
    const ax = kx[i] + Math.cos(h) * look, az = kz[i] - Math.sin(h) * look;
    if (!isDeep(ax, az)) {
      if (!kturn[i]) {
        const l = h + 0.9, r = h - 0.9;
        const dl = isDeep(kx[i] + Math.cos(l) * look, kz[i] - Math.sin(l) * look);
        const dr = isDeep(kx[i] + Math.cos(r) * look, kz[i] - Math.sin(r) * look);
        kturn[i] = dl && !dr ? 1 : dr && !dl ? -1 : (Math.random() < 0.5 ? 1 : -1);
      }
      h += kturn[i] * 2.4 * dt;
      speedK = 0.35;
    } else {
      kturn[i] = 0;
      const wander = Math.sin(t * 0.37 + kph[i]) * 0.5 + Math.sin(t * 0.13 + kph[i] * 2.0) * 0.4;
      h += wander * 0.7 * dt;
    }
    kh[i] = h;
    const sp = ksp[i] * speedK * (0.85 + 0.15 * Math.sin(t * 1.9 + kph[i]));
    const nx = kx[i] + Math.cos(h) * sp * dt, nz = kz[i] - Math.sin(h) * sp * dt;
    if (isDeep(nx, nz)) { kx[i] = nx; kz[i] = nz; }
  }
  writeKoiMatrices(t);
}

function writeKoiMatrices(t) {
  for (let i = 0; i < koiCount; i++) {
    _pos.set(kx[i], WATER - 0.1 + Math.sin(t * 1.3 + kph[i]) * 0.015, kz[i]);
    _quat.setFromAxisAngle(_yAxis, kh[i]);
    _scl.setScalar(ksz[i]);
    _mat.compose(_pos, _quat, _scl);
    koiMesh.setMatrixAt(i, _mat);
  }
  koiMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- public API
export function initNature(scene) {
  root = new THREE.Group();
  root.name = 'nature';
  scene.add(root);
  treeGroup = new THREE.Group();
  treeGroup.name = 'trees';
  root.add(treeGroup);

  // tree geometry (built once, shared by every rebuild)
  GEO.sakura = buildSakura();
  GEO.maple = buildMaple();
  GEO.pine = buildPine();
  GEO.bamboo = buildBamboo();
  GEO.bush = buildBush();

  const bark = { sakura: '#3f2c26', maple: '#5a4433', pine: '#4d3b2f', bamboo: '#7f9c48' };
  for (const k of TYPES) {
    crownMats[k] = windMaterial(new THREE.MeshStandardMaterial({ color: SEASONS[env.season][k], roughness: 0.9, metalness: 0, vertexColors: true }),
      { HK_CROWN: '', HK_LEAF: '' });
    if (bark[k]) trunkMats[k] = windMaterial(new THREE.MeshStandardMaterial({ color: bark[k], roughness: k === 'bamboo' ? 0.55 : 0.95, metalness: 0 }), {});
  }
  depthCrown = windMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { HK_CROWN: '' });
  depthTrunk = windMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), {});

  // seasonal flakes
  const flakeTex = canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,255,255,0.92)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  flakeMat = pointsMaterial(flakeTex, false);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(flakePos, 3).setUsage(THREE.DynamicDrawUsage));
  fg.setAttribute('aRand', new THREE.BufferAttribute(flakeRand, 4));
  flakePoints = new THREE.Points(fg, flakeMat);
  flakePoints.frustumCulled = false;
  flakePoints.layers.set(LAYER_FX);
  flakePoints.userData.fx = true;
  flakePoints.onBeforeRender = setPointScale;
  root.add(flakePoints);

  // fireflies
  const ffTex = canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.14, 'rgba(255,255,255,0.9)');
    r.addColorStop(0.38, 'rgba(255,255,255,0.22)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  ffMat = pointsMaterial(ffTex, true);
  ffMat.uniforms.uSize.value = 0.24;
  ffMat.uniforms.uColA.value.set('#e2ff86').multiplyScalar(2.4);
  ffMat.uniforms.uColB.value.set('#b4f25a').multiplyScalar(2.4);
  for (let i = 0; i < FF_N; i++) {
    ffRand[i * 4] = 0.7 + Math.random() * 0.6; ffRand[i * 4 + 1] = Math.random();
    ffRand[i * 4 + 2] = Math.random() * 1.6; ffRand[i * 4 + 3] = Math.random();
  }
  const ffg = new THREE.BufferGeometry();
  ffg.setAttribute('position', new THREE.BufferAttribute(ffPos, 3).setUsage(THREE.DynamicDrawUsage));
  ffg.setAttribute('aRand', new THREE.BufferAttribute(ffRand, 4));
  ffPoints = new THREE.Points(ffg, ffMat);
  ffPoints.frustumCulled = false;
  ffPoints.layers.set(LAYER_FX);
  ffPoints.userData.fx = true;
  ffPoints.visible = false;
  ffPoints.onBeforeRender = setPointScale;
  root.add(ffPoints);
  placeFireflies();

  // koi
  const koiMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0 });
  koiMat.onBeforeCompile = koiPatch;
  koiMat.customProgramCacheKey = () => 'hk-koi';
  koiMesh = new THREE.InstancedMesh(koiGeo(), koiMat, KOI_MAX);
  koiMesh.castShadow = false;
  koiMesh.receiveShadow = true;
  koiMesh.frustumCulled = false;
  koiMesh.name = 'koi';
  const krng = mulberry32(99);
  for (let i = 0; i < KOI_MAX; i++) {
    koiMesh.setColorAt(i, _col.set(KOI_VARIANTS[i % KOI_VARIANTS.length][0]));
    ksp[i] = 0.32 + krng() * 0.28; kph[i] = krng() * 100; ksz[i] = 0.85 + krng() * 0.3;
  }
  koiMesh.instanceColor.needsUpdate = true;
  koiMesh.count = 0;
  root.add(koiMesh);

  setNatureSeason(env.season);
  rebuildTrees();
  respawnKoi();
}

function makeInst(geo, mat, depthMat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.customDepthMaterial = depthMat;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.kind = 'trees';
  treeGroup.add(m);
  treeMeshes.push(m);
  return m;
}

const counts = {}, cursors = {}, parts = {};
export function rebuildTrees() {
  if (!treeGroup) return;
  for (const m of treeMeshes) { treeGroup.remove(m); m.dispose(); }
  treeMeshes.length = 0;
  for (const k of TYPES) { counts[k] = 0; cursors[k] = 0; parts[k] = null; }
  for (const t of state.trees) if (counts[t.type] !== undefined) counts[t.type]++;
  for (const k of TYPES) {
    if (!counts[k]) continue;
    parts[k] = {
      trunk: GEO[k].trunk ? makeInst(GEO[k].trunk, trunkMats[k], depthTrunk, counts[k]) : null,
      crown: makeInst(GEO[k].crown, crownMats[k], depthCrown, counts[k]),
    };
  }
  for (const t of state.trees) {
    const p = parts[t.type];
    if (!p) continue;
    const i = cursors[t.type]++;
    _pos.set(t.x, heightAt(t.x, t.z) - 0.05, t.z);
    _quat.setFromAxisAngle(_yAxis, t.r || 0);
    _scl.setScalar(t.s || 1);
    _mat.compose(_pos, _quat, _scl);
    if (p.trunk) p.trunk.setMatrixAt(i, _mat);
    p.crown.setMatrixAt(i, _mat);
    // subtle per-tree variation: ±8% brightness, slight warm/cool hue shift
    const rng = mulberry32(((t.id || 0) * 2654435761) >>> 0);
    const b = 0.92 + rng() * 0.16, hs = rng() * 2 - 1;
    p.crown.setColorAt(i, _col.setRGB(b * (1 + 0.06 * hs), b * (1 + 0.015 * hs), b * (1 - 0.06 * hs)));
  }
  for (const m of treeMeshes) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    if (m.boundingSphere) m.boundingSphere.radius += 0.3;   // headroom for wind sway
  }
  if (ffPoints) placeFireflies();
}

export function setNatureSeason(s) {
  if (!SEASONS[s]) return;
  season = s;
  for (const k of TYPES) if (crownMats[k]) crownMats[k].color.set(SEASONS[s][k]);
  uSnow.value = SEASONS[s].snow;
  setFlakeMode(s);
}

export function updateNature(dt, t) {
  if (!root) return;
  dt = clamp(dt, 0, 0.1);
  const night = env.night;
  if (flakePoints && flakeCfg && flakeCount) {
    flakeMat.uniforms.uLight.value = 1 - 0.72 * night;
    updateFlakes(dt, t);
  }
  if (ffPoints) {
    const op = season === 'summer' ? night : season === 'spring' ? 0.4 * night : 0;
    ffMat.uniforms.uOpacity.value = op;
    ffPoints.visible = op > 0.01;
    if (ffPoints.visible) updateFireflies(t);
  }
  if (koiMesh && koiCount) updateKoi(dt, t);
}

export function treeRefAt(x, z, radius) {
  let best = null, bd = radius * radius;
  for (const t of state.trees) {
    const dx = t.x - x, dz = t.z - z, d = dx * dx + dz * dz;
    if (d <= bd) { bd = d; best = t.id; }
  }
  return best;
}
