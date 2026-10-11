// kit.js — shared helpers for architecture: noise, matrices, soft geometry (rounded boxes, sweeps, soft-polygon lathes,
// procedural rocks), per-material batching (one merged mesh per material) and the material/texture factory.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LAYER_REFRACT, loadTex, applyCloudShadows, patchMaterial, mulberry32, lerp, clamp, smoothstep } from '../world.js';

export { THREE, mulberry32, lerp, clamp, smoothstep };
export const V3 = THREE.Vector3;
export const PI = Math.PI, TAU = Math.PI * 2;

// ------------------------------------------------------------------ noise
function hash3(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux), lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux), uy);
  const b = lerp(lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux), lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux), uy);
  return lerp(a, b, uz) * 2 - 1;
}
export function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f + i * 13.1, y * f - i * 7.7, z * f + i * 3.3); f *= 2.02; a *= 0.5; }
  return s;
}

// ------------------------------------------------------------------ matrices
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3();
// Local transform: position, yaw (ry), pitch (rx), roll (rz) in 'YXZ' order, scale.
export function M(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
// Matrix that maps the unit Y axis segment (0,-.5,0)-(0,.5,0) onto a..b (for posts/rods between two points).
export function between(a, b) {
  const d = new V3().subVectors(b, a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.clone().normalize());
  return { m: new THREE.Matrix4().compose(new V3().addVectors(a, b).multiplyScalar(0.5), q, new V3(1, 1, 1)), len };
}

// ------------------------------------------------------------------ geometry
export function rbox(w, h, d, r = 0.02, seg = 2) {
  r = Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  return new RoundedBoxGeometry(w, h, d, seg, r);
}
// Box-projected UVs in metres (local space). long = grain axis ('x'|'y'|'z'); end-grain faces use the other two axes.
export function boxUV(su = 1, sv = 1, long = 'x', ou = 0, ov = 0) {
  const L = { x: 0, y: 1, z: 2 }[long];
  return (g) => {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const c = [0, 0, 0], nn = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      c[0] = p.getX(i); c[1] = p.getY(i); c[2] = p.getZ(i);
      nn[0] = Math.abs(n.getX(i)); nn[1] = Math.abs(n.getY(i)); nn[2] = Math.abs(n.getZ(i));
      const ax = nn[0] > nn[1] ? (nn[0] > nn[2] ? 0 : 2) : (nn[1] > nn[2] ? 1 : 2);
      let u, v;
      if (ax === L) { const o = [0, 1, 2].filter(k => k !== L); u = c[o[0]]; v = c[o[1]]; }
      else { const o = 3 - ax - L; u = c[L]; v = c[o]; }
      uv.setXY(i, u * su + ou, v * sv + ov);
    }
  };
}
// Planar UVs from local (a, b) axes in metres.
export function planarUV(su = 1, sv = 1, a = 'x', b = 'y', ou = 0, ov = 0) {
  const A = { x: 0, y: 1, z: 2 }[a], B = { x: 0, y: 1, z: 2 }[b];
  return (g) => {
    const p = g.attributes.position, uv = g.attributes.uv, c = [0, 0, 0];
    for (let i = 0; i < p.count; i++) { c[0] = p.getX(i); c[1] = p.getY(i); c[2] = p.getZ(i); uv.setXY(i, c[A] * su + ou, c[B] * sv + ov); }
  };
}

// Cross-section profiles for sweep(): CCW loops of {a, b, na, nb} (a = side axis, b = up axis).
export function roundRectProfile(w, h, r, seg = 3) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const out = [];
  const cs = [[w / 2 - r, h / 2 - r, 0], [-(w / 2 - r), h / 2 - r, PI / 2], [-(w / 2 - r), -(h / 2 - r), PI], [w / 2 - r, -(h / 2 - r), 1.5 * PI]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * PI / 2;
    out.push({ a: cx + Math.cos(a) * r, b: cy + Math.sin(a) * r, na: Math.cos(a), nb: Math.sin(a) });
  }
  return out;
}
export function circleProfile(r, n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push({ a: Math.cos(a) * r, b: Math.sin(a) * r, na: Math.cos(a), nb: Math.sin(a) }); }
  return out;
}
// Sweep a closed profile along a polyline. side = fixed sideways reference (profile 'a' axis); scale(t) -> [sa, sb].
export function sweep(path, profile, { side = new V3(0, 0, 1), scale = null, caps = true, uvScale = [1, 1], closed = false } = {}) {
  if (closed) { caps = false; }
  const P0 = path.length;
  if (closed) path = [...path, path[0]];
  const P = path.length, Mp = profile.length, R = Mp + 1;
  const prevOf = (i) => closed ? path[(i - 1 + P0) % P0] : path[Math.max(i - 1, 0)];
  const nextOf = (i) => closed ? path[(i + 1) % P0] : path[Math.min(i + 1, P - 1)];
  const per = [0];
  for (let j = 1; j <= Mp; j++) { const a = profile[j % Mp], b = profile[j - 1]; per.push(per[j - 1] + Math.hypot(a.a - b.a, a.b - b.b)); }
  const pos = [], nor = [], uv = [], idx = [];
  const T = new V3(), B = new V3(), N = new V3(), q = new V3(), nn = new V3();
  let s = 0;
  const rings = [];
  for (let i = 0; i < P; i++) {
    if (i > 0) s += path[i].distanceTo(path[i - 1]);
    T.subVectors(nextOf(i), prevOf(i)).normalize();
    B.copy(side).addScaledVector(T, -side.dot(T)).normalize();
    N.crossVectors(B, T).normalize();
    const [sa, sb] = scale ? scale(i / (P - 1), i) : [1, 1];
    rings.push({ T: T.clone(), B: B.clone(), N: N.clone(), sa, sb });
    for (let j = 0; j <= Mp; j++) {
      const pr = profile[j % Mp];
      q.copy(path[i]).addScaledVector(B, pr.a * sa).addScaledVector(N, pr.b * sb);
      nn.copy(B).multiplyScalar(pr.na / sa).addScaledVector(N, pr.nb / sb).normalize();
      pos.push(q.x, q.y, q.z); nor.push(nn.x, nn.y, nn.z); uv.push(s * uvScale[0], per[j] * uvScale[1]);
    }
  }
  for (let i = 0; i < P - 1; i++) for (let j = 0; j < Mp; j++) {
    const a = i * R + j, b = a + R;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  if (caps) {
    for (const end of [0, 1]) {
      const i = end ? P - 1 : 0, rg = rings[i], c = path[i];
      const base = pos.length / 3;
      const n = end ? rg.T : rg.T.clone().negate();
      pos.push(c.x, c.y, c.z); nor.push(n.x, n.y, n.z); uv.push(0, 0);
      for (let j = 0; j < Mp; j++) {
        const pr = profile[j];
        q.copy(c).addScaledVector(rg.B, pr.a * rg.sa).addScaledVector(rg.N, pr.b * rg.sb);
        pos.push(q.x, q.y, q.z); nor.push(n.x, n.y, n.z); uv.push(pr.a * uvScale[1], pr.b * uvScale[1]);
      }
      for (let j = 0; j < Mp; j++) {
        const a = base + 1 + j, b = base + 1 + ((j + 1) % Mp);
        if (end) idx.push(base, b, a); else idx.push(base, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Soft regular polygon radius factor (n sides, k<1 rounds the corners). 1 at the corners when k = 1.
export function softPoly(theta, n, k = 0.95) {
  if (!n) return 1;
  return Math.cos(PI / n) / Math.cos((2 / n) * Math.asin(k * Math.sin(n * theta / 2)));
}
// Lathe around Y. profile [[r, y], ...] bottom -> top. sides > 0 makes a soft polygon (e.g. 6 for hexagonal lanterns).
// warp(x, y, z, theta, t) -> [x, y, z] lets callers curl corners or add noise.
export function lathe(profile, { sides = 0, k = 0.95, segs = 32, phase = 0, warp = null } = {}) {
  const n = profile.length, pos = [], uv = [], idx = [];
  for (let j = 0; j < n; j++) {
    const [r, y] = profile[j];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * TAU;
      const f = softPoly(th + phase, sides, k);
      let p = [Math.cos(th) * r * f, y, Math.sin(th) * r * f];
      if (warp) p = warp(p[0], p[1], p[2], th, j / (n - 1));
      pos.push(p[0], p[1], p[2]); uv.push(i / segs, j / (n - 1));
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = (j + 1) * segs + i, c = j * segs + (i + 1) % segs, d = (j + 1) * segs + (i + 1) % segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Neighbour-averaging smooth for indexed geometry.
function laplacian(g, iters = 1, amt = 0.5) {
  const p = g.attributes.position, n = p.count, idx = g.index.array;
  const nb = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, z = 0;
      for (const j of nb[i]) { x += p.getX(j); y += p.getY(j); z += p.getZ(j); }
      const k = nb[i].size || 1;
      tmp[i * 3] = lerp(p.getX(i), x / k, amt); tmp[i * 3 + 1] = lerp(p.getY(i), y / k, amt); tmp[i * 3 + 2] = lerp(p.getZ(i), z / k, amt);
    }
    for (let i = 0; i < n; i++) p.setXYZ(i, tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2]);
  }
}
// Soft, hand-made looking rock around the origin (unit-ish radius before scale).
// opts: detail, scale [sx, sy, sz], facets (soft planar cuts), bump, flatTop (local y where the top flattens), flatBottom.
export function rockGeo(seed, { detail = 3, scale = [1, 0.75, 1], facets = 5, bump = 0.2, flatTop = null, topSoft = 0.08, smooth = 1 } = {}) {
  const rnd = mulberry32(seed * 7919 + 13);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position;
  const o = [rnd() * 100, rnd() * 100, rnd() * 100];
  const cuts = [];
  for (let k = 0; k < facets; k++) {
    const th = rnd() * TAU, y = (rnd() * 2 - 1) * 0.8;
    const r = Math.sqrt(1 - y * y);
    cuts.push({ n: new V3(Math.cos(th) * r, y, Math.sin(th) * r), d: 0.62 + rnd() * 0.22 });
  }
  const v = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = 1 + bump * fbm3(v.x * 1.4 + o[0], v.y * 1.4 + o[1], v.z * 1.4 + o[2], 3) + 0.035 * noise3(v.x * 6 + o[1], v.y * 6, v.z * 6 + o[2]);
    v.multiplyScalar(r);
    for (const c of cuts) {
      const e = v.dot(c.n) - c.d;
      const ex = (e + Math.sqrt(e * e + 0.012)) / 2;   // soft relu -> flat-ish facets with rounded edges
      v.addScaledVector(c.n, -ex * 0.85);
    }
    v.set(v.x * scale[0], v.y * scale[1], v.z * scale[2]);
    if (flatTop !== null) {          // smooth-min the top onto a plane
      const a = v.y, b = flatTop, kk = topSoft;
      const h = Math.max(kk - Math.abs(a - b), 0) / kk;
      v.y = Math.min(a, b) - h * h * kk * 0.25;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  if (smooth) laplacian(g, smooth, 0.45);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  return g;
}

// ------------------------------------------------------------------ batching
// Collects geometry per material (and per refraction flag) and merges it into one mesh each.
const KEEP = ['position', 'normal', 'uv'];
export class Batch {
  constructor() { this.groups = new Map(); }
  // tint: [r, g, b] multipliers (linear). shade(x, y, z, nx, ny, nz) -> scalar (world space). uv(g): local-space UV writer.
  add(mat, geom, matrix = null, { tint = null, refract = false, shade = null, uv = null, shadow = true } = {}) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (uv) uv(g);
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    const p = g.attributes.position, nr = g.attributes.normal;
    const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
    for (let i = 0; i < n; i++) {
      const s = shade ? shade(p.getX(i), p.getY(i), p.getZ(i), nr.getX(i), nr.getY(i), nr.getZ(i)) : 1;
      col[i * 3] = tr * s; col[i * 3 + 1] = tg * s; col[i * 3 + 2] = tb * s;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const key = mat.uuid + (refract ? '|r' : '') + (shadow ? '' : '|ns');
    if (!this.groups.has(key)) this.groups.set(key, { mat, refract, shadow, list: [] });
    this.groups.get(key).list.push(g);
    if (geom !== g && !geom.userData.keep) geom.dispose();
    return this;
  }
  build(parent, name = 'batch') {
    const meshes = [];
    for (const { mat, refract, shadow, list } of this.groups.values()) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${name}:${mat.name}`;
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      if (refract) mesh.layers.enable(LAYER_REFRACT);
      parent.add(mesh); meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

// ------------------------------------------------------------------ textures
export function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ materials
export const MATS = [];  // every material we create (for disposal / debugging)
export function std(name, opts, { outdoor = true } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...opts });
  m.name = name;
  if (outdoor) applyCloudShadows(m);
  MATS.push(m);
  return m;
}
export function texMat(name, id, { color = '#ffffff', roughness = 0.85, normalScale = 1, metalness = 0, outdoor = true, ...rest } = {}) {
  return std(name, {
    map: loadTex(id, 'diff'), normalMap: loadTex(id, 'nor'), normalScale: new THREE.Vector2(normalScale, normalScale),
    color, roughness, metalness, ...rest,
  }, { outdoor });
}

// Triplanar world-space stone: mossy_rock (or another texture) + moss on upward faces + darker damp sides near the water.
const ARCH_GLSL = /* glsl */`
varying vec3 vArchP;
varying vec3 vArchN;
uniform sampler2D tpDiff;
uniform sampler2D tpNor;
uniform float tpScale;
uniform float tpNorStr;
uniform float tpSat;
uniform float uMoss;
uniform vec3 uMossCol;
uniform float uWet;
float archHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float archNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(archHash(i), archHash(i + vec3(1,0,0)), f.x), mix(archHash(i + vec3(0,1,0)), archHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(archHash(i + vec3(0,0,1)), archHash(i + vec3(1,0,1)), f.x), mix(archHash(i + vec3(0,1,1)), archHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;
export function stoneMat(name, { tint = '#a8a59c', scale = 0.55, moss = 0.7, mossColor = '#58652a', wet = 1, sat = 0.7, norStr = 1.1,
  roughness = 0.92, tex = 'mossy_rock', onsen = null } = {}) {
  // onsen (spring only): { mineral: '#hex', wetRough } adds an orange mineral band at the waterline + damp stone above it.
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness, metalness: 0, vertexColors: true });
  m.name = name;
  const uni = {
    tpDiff: { value: loadTex(tex, 'diff') }, tpNor: { value: loadTex(tex, 'nor') }, tpScale: { value: scale }, tpNorStr: { value: norStr },
    tpSat: { value: sat }, uMoss: { value: moss }, uMossCol: { value: new THREE.Color(mossColor) }, uWet: { value: wet },
  };
  if (onsen) { uni.uMineralCol = { value: new THREE.Color(onsen.mineral || '#c9763a') }; uni.uWetRough = { value: onsen.wetRough ?? 0.8 }; }
  const ONSEN_DECL = onsen ? '\nuniform vec3 uMineralCol;\nuniform float uWetRough;' : '';
  const ONSEN_COL = onsen ? `
      {
        float mv = vArchP.y + (mn - 0.5) * 0.14 + (archNoise(vArchP * vec3(3.0, 0.6, 3.0)) - 0.5) * 0.1;
        float band = smoothstep(-0.22, -0.1, mv) * (1.0 - smoothstep(0.16, 0.3, mv));
        float streak = archNoise(vec3(vArchP.x * 7.0, vArchP.y * 1.5, vArchP.z * 7.0));
        float stain = band * smoothstep(0.3, 0.75, streak + (mn - 0.5) * 0.5) * (1.0 - 0.7 * smoothstep(0.55, 0.95, aN.y));
        base = mix(base, uMineralCol * (0.8 + 0.4 * tl), stain * 0.6);
        float damp = smoothstep(0.12, 0.26, mv) * (1.0 - smoothstep(0.3, 0.62, mv));
        base *= 1.0 - 0.3 * damp;
      }` : '';
  m.userData.archUniforms = uni;
  patchMaterial(m, onsen ? 'archStoneOnsen' : 'archStone', (shader) => {
    Object.assign(shader.uniforms, uni);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vArchP;\nvarying vec3 vArchN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 ap = vec4(transformed, 1.0); vec3 an = objectNormal;
        #ifdef USE_INSTANCING
          ap = instanceMatrix * ap; an = mat3(instanceMatrix) * an;
        #endif
        vArchP = (modelMatrix * ap).xyz; vArchN = normalize(mat3(modelMatrix) * an);
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ARCH_GLSL + ONSEN_DECL)
      .replace('#include <map_fragment>', `
      vec3 aN = normalize(vArchN);
      vec3 aW = pow(abs(aN), vec3(4.0)); aW /= (aW.x + aW.y + aW.z);
      vec3 aP = vArchP * tpScale;
      vec3 tcol = texture2D(tpDiff, aP.zy).rgb * aW.x + texture2D(tpDiff, aP.xz).rgb * aW.y + texture2D(tpDiff, aP.xy).rgb * aW.z;
      float tl = dot(tcol, vec3(0.3, 0.59, 0.11));
      tcol = mix(vec3(tl), tcol, tpSat);${onsen ? '\n      tcol = mix(vec3(0.34), tcol, 0.42); tl = dot(tcol, vec3(0.3, 0.59, 0.11));' : ''}
      float mn = archNoise(vArchP * 1.9) * 0.6 + archNoise(vArchP * 6.1) * 0.4;
      float mossAmt = uMoss * smoothstep(0.42, 0.85, aN.y + (mn - 0.5) * 0.7) * smoothstep(0.05, 0.2, vArchP.y);
      vec3 base = tcol * diffuseColor.rgb * 1.6;
      base = mix(base, uMossCol * (0.55 + 0.9 * tl), mossAmt);
      float archWet = uWet * (1.0 - smoothstep(-0.04, 0.07, vArchP.y + (mn - 0.5) * 0.05));
      base *= mix(1.0, 0.48, archWet);${ONSEN_COL}
      diffuseColor.rgb = base;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
      roughnessFactor = mix(roughnessFactor, ${onsen ? 'uWetRough' : '0.32'}, archWet);
      roughnessFactor = mix(roughnessFactor, 1.0, mossAmt);`)
      .replace('#include <normal_fragment_maps>', `{
        vec3 nx = texture2D(tpNor, aP.zy).xyz * 2.0 - 1.0;
        vec3 ny = texture2D(tpNor, aP.xz).xyz * 2.0 - 1.0;
        vec3 nz = texture2D(tpNor, aP.xy).xyz * 2.0 - 1.0;
        float ns = tpNorStr * (1.0 - 0.6 * mossAmt);
        nx.xy *= ns; ny.xy *= ns; nz.xy *= ns;
        nx = vec3(nx.xy + aN.zy, abs(nx.z) * aN.x);
        ny = vec3(ny.xy + aN.xz, abs(ny.z) * aN.y);
        nz = vec3(nz.xy + aN.xy, abs(nz.z) * aN.z);
        vec3 wn = normalize(nx.zyx * aW.x + ny.xzy * aW.y + nz.xyz * aW.z);
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`);
  });
  applyCloudShadows(m);
  MATS.push(m);
  return m;
}

// Small deterministic colour jitter: returns [r, g, b] multipliers around 1.
export function jitter(rnd, amt = 0.08, hue = 0.03) {
  const v = 1 + (rnd() * 2 - 1) * amt, h = (rnd() * 2 - 1) * hue;
  return [v * (1 + h), v, v * (1 - h)];
}
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// ------------------------------------------------------------------ local-frame placer
// Places pieces in a local frame (base matrix) into a Batch. Wood-like pieces get grain-aligned box UVs.
export function placer(B, base, rnd) {
  const add = (mat, geo, lm = null, opts = {}) => B.add(mat, geo, lm ? base.clone().multiply(lm) : base, opts);
  // rounded wooden/stone member, w (x) * h (y) * d (z), centred at (x, y, z) with yaw/pitch/roll
  const piece = (mat, w, h, d, x, y, z, o = {}) => {
    const { ry = 0, rx = 0, rz = 0, r = Math.min(w, h, d) * 0.2, tint = jitter(rnd, 0.07, 0.02), refract = false, seg = Math.min(w, h, d) < 0.07 ? 1 : 2,
      su = 0.6, sv = 0.55, shade = null, uv = undefined } = o;
    const long = w >= h && w >= d ? 'x' : (h >= d ? 'y' : 'z');
    add(mat, rbox(w, h, d, r, seg), M(x, y, z, ry, rx, rz), { tint, refract, shade, uv: uv === undefined ? boxUV(su, sv, long, rnd() * 10, rnd()) : uv });
  };
  // round rod between local points a and b (Vector3 or [x,y,z])
  const rod = (mat, a, b, r, o = {}) => {
    const { seg = 8, taper = 1, tint = jitter(rnd, 0.06, 0.02), refract = false, su = 0.6, sv = 0.55, uv = undefined } = o;
    const A = Array.isArray(a) ? new V3(...a) : a, Bv = Array.isArray(b) ? new V3(...b) : b;
    const { m, len } = between(A, Bv);
    const g = new THREE.CylinderGeometry(r * taper, r, len, seg, 1, false);
    add(mat, g, m, { tint, refract, uv: uv === undefined ? boxUV(su, sv, 'y', rnd() * 10, rnd()) : uv });
  };
  return { add, piece, rod, base };
}
