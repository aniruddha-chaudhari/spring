// core.js — shared constants, state, materials and geometry helpers.
// Every other module imports from here. Keep this file the single source of truth
// for the world layout, data schema and shared materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- world layout
// The garden is a disc of radius R inside a SIZE x SIZE heightfield, sitting in a lacquer tray.
export const SIZE = 44;            // world units covered by the heightfield (x and z in [-HALF, HALF])
export const HALF = SIZE / 2;
export const RES = 128;            // heightfield segments per side
export const N = RES + 1;          // heightfield vertices per side
export const CELL = SIZE / RES;
export const R = 20;               // radius of the playable garden disc
export const WATER = 0;            // water surface height; terrain below this is pond
export const BASE = 0.5;           // default ground height

// Layer used for glow sprites / particles so the depth pre-pass (miniature DOF) can skip them.
export const LAYER_FX = 1;

// heights[iz * N + ix] is the ground height at x = ix*CELL - HALF, z = iz*CELL - HALF
export const heights = new Float32Array(N * N).fill(BASE);

export function heightAt(x, z) {
  const fx = clamp((x + HALF) / CELL, 0, RES - 1e-4);
  const fz = clamp((z + HALF) / CELL, 0, RES - 1e-4);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const i = iz * N + ix;
  const a = heights[i], b = heights[i + 1], c = heights[i + N], d = heights[i + N + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
export const isWet = (x, z) => heightAt(x, z) < WATER + 0.03;

// ---------------------------------------------------------------- data schema
// All placed things are plain JSON so undo/save is just serialisation.
// house:  { id, x, z, w, d, rot, style: 'tile' | 'thatch' }   w along local x, d along local z, front = +z local
// pagoda: { id, x, z, size }                                    size 2.6..5.5, >= 4 gets five tiers
// torii:  { id, x, z, w, rot }                                  pillars on local x axis at ±w/2
// wall:   { id, pts: [[x,z],...] }                              freehand polyline
// path:   { id, pts: [[x,z],...], w }                           freehand polyline, w = width (default 1.3)
// tree:   { id, type: 'sakura'|'maple'|'pine'|'bamboo'|'bush', x, z, s, r }   s = scale, r = y rotation
// decor:  { id, type: 'lantern'|'rock', x, z, r, s }
// Rotation convention: group.rotation.y = rot, so local (lx, lz) -> world (lx*cos + lz*sin, -lx*sin + lz*cos).
export const state = {
  houses: [], pagodas: [], toriis: [], walls: [], paths: [], trees: [], decor: [],
  nextId: 1,
};
export const newId = () => state.nextId++;

// Environment (not part of undo).
export const env = {
  season: 'spring',  // spring | summer | autumn | winter
  time: 16,          // hours 0..24
  night: 0,          // 0 day .. 1 full night, computed by render.js from time
  mini: true,        // miniature depth-of-field on/off
  blur: 5,           // miniature strength 0..10
};

export const SEASONS = {
  spring: { ground: '#9dbb69', path: '#dcd3be', sakura: '#f4b9cb', maple: '#a7c46a', pine: '#47704c', bamboo: '#8aae53', bush: '#e48bb0', snow: 0 },
  summer: { ground: '#7aa553', path: '#d8cfb8', sakura: '#6aa257', maple: '#5c9a45', pine: '#3d6545', bamboo: '#77a245', bush: '#5f9a4c', snow: 0 },
  autumn: { ground: '#b5a45b', path: '#d6c8a8', sakura: '#e39a52', maple: '#d2452e', pine: '#43654a', bamboo: '#a3a654', bush: '#c8532f', snow: 0 },
  winter: { ground: '#e7ecef', path: '#bcb7ab', sakura: '#dde1e6', maple: '#d6dae0', pine: '#3a5e48', bamboo: '#7f9b5e', bush: '#e1e6ea', snow: 1 },
};

// Shared animated uniform (seconds). Materials that sway/ripple read this.
export const uTime = { value: 0 };

// ---------------------------------------------------------------- math utils
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
// world <-> local for a rotation about y
export const toWorld = (x, z, rot, lx, lz) => [x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)];
export const rotFromDir = (dx, dz) => Math.atan2(-dz, dx); // rot whose local +x points along (dx, dz)

// Resample a polyline [[x,z],...] at a fixed spacing. Returns [{x, z, h, d}] (h = ground height, d = distance along).
export function resample(pts, step) {
  const out = [];
  if (!pts.length) return out;
  let d = 0;
  out.push({ x: pts[0][0], z: pts[0][1], d: 0 });
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= len) {
      const f = t / len;
      out.push({ x: lerp(ax, bx, f), z: lerp(az, bz, f), d: d + t });
      t += step;
    }
    carry = len - (t - step);
    d += len;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(tail.x - last[0], tail.z - last[1]) > step * 0.3) out.push({ x: last[0], z: last[1], d });
  for (const p of out) p.h = heightAt(p.x, p.z);
  return out;
}

// Chaikin smoothing for freehand strokes.
export function chaikin(pts, iterations = 2) {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// ---------------------------------------------------------------- textures
export function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const shojiTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#f4ead4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(150,120,80,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = '#5a4030'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5);
  g.lineWidth = 3;
  for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(i * w / 3, 0); g.lineTo(i * w / 3, h); g.stroke(); }
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
});

const tileTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#5b626b'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) {
    const grd = g.createLinearGradient(x, 0, x + 16, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.28)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = grd; g.fillRect(x, 0, 16, h);
  }
  for (let y = 0; y < h; y += 21) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y, w, 3); }
}, { repeat: true });

const thatchTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#a58a5c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w, y = Math.random() * h, l = 6 + Math.random() * 14;
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(70,50,25,0.25)' : 'rgba(235,210,150,0.25)';
    g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 2, y + l); g.stroke();
  }
}, { repeat: true });

export const glowTex = canvasTex(64, 64, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,230,170,1)'); r.addColorStop(0.25, 'rgba(255,190,110,0.55)'); r.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});

// ---------------------------------------------------------------- materials
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, ...o });
export const M = {
  wood: std('#5a3d2b'),
  darkWood: std('#3a2a20'),
  deck: std('#8a6a4a'),
  plaster: std('#efe7d7'),
  wallPlaster: std('#e6d6b6'),
  stone: std('#9b968b'),
  stoneLight: std('#b3ada1'),
  stepStone: std('#a29d92', { flatShading: true }),
  rock: std('#8c887d', { flatShading: true }),
  tile: std('#ffffff', { map: tileTex, side: THREE.DoubleSide }),
  ridge: std('#3f444b'),
  thatch: std('#ffffff', { map: thatchTex, side: THREE.DoubleSide }),
  vermilion: std('#c63f2c', { roughness: 0.7 }),
  black: std('#262220'),
  gold: std('#c9a24a', { metalness: 0.6, roughness: 0.35 }),
  noren: std('#2f4170', { side: THREE.DoubleSide }),
  shoji: std('#ffffff', { map: shojiTex, emissive: '#ffb45e', emissiveMap: shojiTex, emissiveIntensity: 0 }),
  lampPaper: std('#f3e2c0', { emissive: '#ffb45e', emissiveIntensity: 0 }),
  chochin: std('#d4442f', { emissive: '#ff6a3a', emissiveIntensity: 0 }),
  glow: new THREE.SpriteMaterial({ map: glowTex, color: '#ffc27a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
};
for (const k in M) if (M[k].isMeshStandardMaterial) M[k].shadowSide = THREE.FrontSide;

const ROOF_TILE = new THREE.Color('#ffffff'), ROOF_SNOW = new THREE.Color('#f4f7fa');
// Called on season change: snow on roofs etc. (Tree / ground colours are handled by their own modules.)
export function applySeasonMaterials(season) {
  const s = SEASONS[season].snow;
  M.tile.color.copy(ROOF_TILE).lerp(ROOF_SNOW, s).multiplyScalar(s ? 2.2 : 1);
  M.thatch.color.set(s ? '#e9edf0' : '#ffffff').multiplyScalar(s ? 1.6 : 1);
}
// Called every frame with env.night (0..1): lit windows and lanterns.
export function applyNightMaterials(night) {
  M.shoji.emissiveIntensity = night * 1.5;
  M.lampPaper.emissiveIntensity = night * 2.2;
  M.chochin.emissiveIntensity = 0.15 + night * 2.0;
  M.glow.opacity = night * 0.85;
}

// ---------------------------------------------------------------- Kit: merge many parts per material
// Builders add primitives in a local frame (x/z local, y ABSOLUTE world height), then kit.build(group)
// merges everything into one mesh per material and adds glow sprites (on LAYER_FX).
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
export class Kit {
  constructor() { this.map = new Map(); this.glows = []; }
  // rotation order YXZ: rz first, then rx (tilt), then ry (yaw)
  add(mat, geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    geo.applyMatrix4(_m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return geo;
  }
  box(mat, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, ry, rx, rz); }
  cyl(mat, rt, rb, h, x, y, z, seg = 10, ry = 0, rx = 0, rz = 0) { return this.add(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, ry, rx, rz); }
  sphere(mat, r, x, y, z, sx = 1, sy = 1, sz = 1) { return this.add(mat, new THREE.SphereGeometry(r, 10, 8), x, y, z, 0, 0, 0, sx, sy, sz); }
  glow(x, y, z, size = 1.2) { this.glows.push([x, y, z, size]); }
  build(group, { castShadow = true } = {}) {
    for (const [mat, list] of this.map) {
      const geos = list.map(prepForMerge);
      const merged = mergeGeometries(geos);
      geos.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow; mesh.receiveShadow = true;
      group.add(mesh);
    }
    for (const [x, y, z, s] of this.glows) {
      const sp = new THREE.Sprite(M.glow);
      sp.position.set(x, y, z); sp.scale.setScalar(s);
      sp.layers.set(LAYER_FX);
      sp.userData.fx = true;
      group.add(sp);
    }
    return group;
  }
}
export function prepForMerge(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}
// Merge arbitrary geometries (indexed or not) into one non-indexed geometry with position/normal/uv.
export function mergeAll(list) { const g = list.map(prepForMerge); const m = mergeGeometries(g); g.forEach(x => x.dispose()); return m; }

// Wrap a kit-built object so it has a ground pivot (for the pop-in animation) and a ref for erasing.
// Returns outer group positioned at (px, py, pz); kit coordinates stay absolute because inner is offset back.
export function pivotGroup(kind, id, px, py, pz, rot = 0) {
  const outer = new THREE.Group();
  outer.position.set(px, py, pz);
  outer.rotation.y = rot;
  const inner = new THREE.Group();
  inner.position.y = -py;
  outer.add(inner);
  outer.userData.ref = { kind, id };
  outer.userData.inner = inner;
  return outer;
}

// Dispose geometry of a built group (materials are shared and never disposed; sprite geometry is shared too).
export function disposeGroup(obj) {
  obj.traverse(o => { if (o.isMesh && !o.isSprite && !o.isInstancedMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
}

// ---------------------------------------------------------------- roofs
// Hip roof with concave (sagging) slopes and upturned corners — the Japanese silhouette.
// w, d: footprint INCLUDING overhang, centred on origin, eaves at y = 0, ridge at y = H.
// tMax < 1 builds only the lower band (a skirt / pent roof for pagodas and two-storey houses).
export function roofGeo(w, d, H, o = {}) {
  const curve = o.curve ?? 1.45, up = o.up ?? 0.25, K = o.K ?? 12, L = o.L ?? 8;
  const tMax = o.tMax ?? 1, thick = o.thick ?? 0.12, tile = o.tile ?? 0.9;
  const hw = w / 2, hd = d / 2, e = Math.min(hw, hd);
  const corner = (k, t) => {
    const a = hw - t * e, b = hd - t * e;
    return k === 0 ? [a, b] : k === 1 ? [-a, b] : k === 2 ? [-a, -b] : [a, -b];
  };
  const yAt = (t, f) => H * Math.pow(t, curve) + up * Math.pow(1 - t, 2) * Math.pow(Math.abs(2 * f - 1), 6);
  const slope = Math.hypot(e, H);
  const parts = [];
  for (let s = 0; s < 4; s++) {
    const pos = [], uv = [], ind = [];
    const c0 = corner(s, 0), c1 = corner((s + 1) % 4, 0);
    const len0 = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    for (let j = 0; j <= L; j++) {
      const t = tMax * j / L;
      const a = corner(s, t), b = corner((s + 1) % 4, t);
      for (let i = 0; i <= K; i++) {
        const f = i / K;
        pos.push(lerp(a[0], b[0], f), yAt(t, f), lerp(a[1], b[1], f));
        uv.push((f - 0.5) * len0 / tile, t * slope / tile);
      }
    }
    for (let j = 0; j < L; j++) for (let i = 0; i < K; i++) {
      const A = j * (K + 1) + i, B = A + 1, C = A + K + 1, D = C + 1;
      ind.push(A, C, B, B, C, D);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind); g.computeVertexNormals();
    parts.push(g);
    // fascia board along the eave
    const fp = [], fu = [], fi = [];
    for (let i = 0; i <= K; i++) {
      const f = i / K, x = lerp(c0[0], c1[0], f), z = lerp(c0[1], c1[1], f), y = yAt(0, f);
      fp.push(x, y, z, x, y - thick, z); fu.push(f, 0, f, 1);
      if (i < K) { const a = i * 2; fi.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    fg.setIndex(fi); fg.computeVertexNormals();
    parts.push(fg);
  }
  const merged = mergeAll(parts);
  merged.userData = { ridgeLen: Math.abs(hw - hd) * 2, ridgeAlongX: hw >= hd, topY: H * Math.pow(tMax, curve), innerHalf: [hw - tMax * e, hd - tMax * e] };
  return merged;
}

// Bend a box along its x axis (used for torii lintels / curved beams). Returns geometry.
export function curvedBeam(len, h, d, lift, segs = 16) {
  const g = new THREE.BoxGeometry(len, h, d, segs, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (len / 2); p.setY(i, p.getY(i) + lift * x * x * Math.abs(x)); }
  g.computeVertexNormals();
  return g;
}
