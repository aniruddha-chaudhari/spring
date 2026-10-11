// life/koi.js — koi gliding lazily in the pond under the surface (on LAYER_REFRACT so they show through the water).
// One InstancedMesh; tail wiggle in the vertex shader, kohaku/sanke/showa/tancho/ogon patterns in the fragment shader.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { streamPoint, S_POND, WATER_Y, LAYER_REFRACT, mulberry32, patchMaterial, clamp } from '../world.js';
import { groundAt, waterDist, TAU, wrapAngle } from './common.js';

const N = 8;

function koiGeometry() {
  // body: lathe around Y, then laid along +Z (head at +Z)
  const prof = [[0, -0.5], [0.028, -0.49], [0.04, -0.42], [0.075, -0.25], [0.105, -0.05], [0.118, 0.12], [0.11, 0.28], [0.085, 0.4], [0.05, 0.47], [0, 0.5]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12).rotateX(Math.PI / 2).scale(1, 0.85, 1);
  const fin = (verts) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals(); return g;
  };
  const tail = fin([
    0, 0.02, -0.47, 0, 0.0, -0.66, 0, 0.15, -0.74,
    0, -0.02, -0.47, 0, -0.15, -0.74, 0, 0.0, -0.66,
    0, 0.02, -0.47, 0, -0.02, -0.47, 0, 0.0, -0.66,
  ]);
  const pecs = fin([
    0.07, -0.05, 0.27, 0.2, -0.08, 0.17, 0.08, -0.06, 0.15,
    -0.07, -0.05, 0.27, -0.08, -0.06, 0.15, -0.2, -0.08, 0.17,
  ]);
  const dorsal = fin([0, 0.09, 0.14, 0, 0.17, 0.02, 0, 0.08, -0.22, 0, 0.17, 0.02, 0, 0.12, -0.2, 0, 0.08, -0.22]);
  const parts = [body.toNonIndexed(), tail, pecs, dorsal];
  parts[0].deleteAttribute('uv');
  parts.forEach((g, i) => g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i ? 1 : 0), 1)));
  return mergeGeometries(parts);
}

const KOI_GLSL = /* glsl */`
float lk_h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float lk_n(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lk_h(i), lk_h(i + vec3(1,0,0)), f.x), mix(lk_h(i + vec3(0,1,0)), lk_h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(lk_h(i + vec3(0,0,1)), lk_h(i + vec3(1,0,1)), f.x), mix(lk_h(i + vec3(0,1,1)), lk_h(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

function koiMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.0, side: THREE.DoubleSide });
  patchMaterial(m, 'lifeKoi', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart; attribute vec3 aKoi; attribute vec2 aSwim;
        varying vec3 vKLocal; varying vec3 vKoi; varying float vKPart;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vKLocal = position; vKoi = aKoi; vKPart = aPart;
        float tailw = smoothstep(0.3, -0.75, position.z);
        transformed.x += sin(aSwim.x - position.z * 5.5) * aSwim.y * (0.012 + 0.12 * tailw * tailw);
        if (aPart > 0.5 && abs(position.x) > 0.07 && position.z > 0.1) transformed.y += sin(aSwim.x * 0.6 + position.x * 9.0) * 0.025;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vKLocal; varying vec3 vKoi; varying float vKPart;
        ${KOI_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 kp = vKLocal; float seed = vKoi.x * 13.0; float type = vKoi.y;
          float n1 = lk_n(kp * vec3(9.0, 9.0, 6.5) + seed) * 0.7 + lk_n(kp * 21.0 + seed) * 0.3;
          float n2 = lk_n(kp * 15.0 - seed * 1.7) * 0.75 + lk_n(kp * 30.0 + seed) * 0.25;
          float top = smoothstep(-0.05, 0.035, kp.y);
          vec3 white = vec3(0.92, 0.9, 0.85), red = vec3(0.8, 0.09, 0.025), black = vec3(0.025, 0.025, 0.03);
          vec3 c = white;
          float redM = smoothstep(0.5, 0.56, n1) * top;
          if (type < 0.5) { c = mix(white, red, redM); }                                            // kohaku
          else if (type < 1.5) { c = mix(white, red, redM); c = mix(c, black, smoothstep(0.7, 0.74, n2) * top); }   // sanke
          else if (type < 2.5) { c = mix(black, red, smoothstep(0.52, 0.58, n1) * top); c = mix(c, white, smoothstep(0.62, 0.68, n2) + (1.0 - top) * 0.6); } // showa
          else if (type < 3.5) { float d = length(vec2(kp.x * 1.2, kp.z - 0.34)); c = mix(white, red, smoothstep(0.075, 0.06, d) * top); } // tancho
          else if (type < 4.5) { c = vec3(1.0, 0.62, 0.16) * (0.85 + 0.3 * n2); }                     // yamabuki ogon
          else { c = mix(vec3(1.0, 0.36, 0.06), white, smoothstep(0.62, 0.7, n2) * 0.8); }               // orange / white
          c = mix(c, white * 0.92, smoothstep(0.0, -0.07, kp.y) * 0.55);                               // pale belly
          if (vKPart > 0.5) c = mix(c, white, 0.55);                                                   // translucent-ish fins
          float scales = 0.92 + 0.08 * sin(kp.z * 160.0) * sin(kp.x * 160.0 + kp.y * 120.0);
          diffuseColor.rgb = c * scales;
        }`);
  });
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
let mesh, swim, pts = [], rnd;
const F = () => new Float32Array(N);
const K = { x: F(), y: F(), z: F(), h: F(), sp: F(), tsp: F(), ty: F(), tx: F(), tz: F(), turn: F(), ph: F(), L: F(), wait: F() };

export function init(root) {
  rnd = mulberry32(9090);
  const c = streamPoint(S_POND);
  // deep pond cells to swim to
  for (let z = -12; z <= 12; z += 0.5) for (let x = -12; x <= 12; x += 0.5) {
    const px = c.x + x, pz = c.z + z;
    if (groundAt(px, pz) < -1.1 && waterDist(px, pz) < -1.3) pts.push([px, pz]);
  }
  if (!pts.length) pts.push([c.x, c.z]);
  const geo = koiGeometry();
  const koi = new Float32Array(N * 3), types = [0, 0, 1, 2, 3, 4, 5, 0, 1];
  for (let i = 0; i < N; i++) { koi[i * 3] = rnd() * 10; koi[i * 3 + 1] = types[i % types.length]; koi[i * 3 + 2] = 0; }
  geo.setAttribute('aKoi', new THREE.InstancedBufferAttribute(koi, 3));
  swim = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSwim', swim);
  mesh = new THREE.InstancedMesh(geo, koiMaterial(), N);
  mesh.name = 'life-koi';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.layers.enable(LAYER_REFRACT);
  root.add(mesh);
  for (let i = 0; i < N; i++) {
    const p = pts[Math.floor(rnd() * pts.length)];
    K.x[i] = p[0]; K.z[i] = p[1]; K.h[i] = rnd() * TAU; K.y[i] = -0.35 - rnd() * 0.2;
    K.L[i] = 0.62 + rnd() * 0.32; K.ph[i] = rnd() * TAU; K.sp[i] = 0.2;
    newTarget(i);
  }
  update(0, 0);
}

function newTarget(i) {
  // usually a nearby spot (lazy meander), sometimes across the pond
  for (let k = 0; k < 8; k++) {
    const p = pts[Math.floor(rnd() * pts.length)];
    const d = Math.hypot(p[0] - K.x[i], p[1] - K.z[i]);
    if (d > 1.5 && (d < 6 || rnd() < 0.3)) { K.tx[i] = p[0]; K.tz[i] = p[1]; break; }
  }
  K.tsp[i] = rnd() < 0.15 ? 0.05 : 0.18 + rnd() * 0.24;
  K.ty[i] = rnd() < 0.15 ? -0.2 : -0.3 - rnd() * 0.28;
}

export function update(dt, t) {
  const arr = mesh.instanceMatrix.array;
  for (let i = 0; i < N; i++) {
    let x = K.x[i], z = K.z[i], h = K.h[i];
    let want = Math.atan2(K.tx[i] - x, K.tz[i] - z);
    // separation from the other koi
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const dx = x - K.x[j], dz = z - K.z[j], d2 = dx * dx + dz * dz;
      if (d2 < 1.0 && d2 > 1e-4) want += wrapAngle(Math.atan2(dx, dz) - want) * 0.35 * (1 - Math.sqrt(d2));
    }
    // look ahead: avoid shallow water and banks
    const ax = x + Math.sin(h) * 1.0, az = z + Math.cos(h) * 1.0;
    let avoid = false;
    if (groundAt(ax, az) > K.y[i] - 0.3 || waterDist(ax, az) > -0.9) {
      avoid = true;
      const c = pts[(i * 37) % pts.length];
      want = Math.atan2(c[0] - x, c[1] - z);
    }
    const maxTurn = (avoid ? 1.1 : 0.55) * dt;
    const dh = clamp(wrapAngle(want - h), -maxTurn, maxTurn);
    h += dh; K.turn[i] += (dh / Math.max(dt, 1e-4) - K.turn[i]) * Math.min(1, dt * 3);
    K.sp[i] += (K.tsp[i] - K.sp[i]) * Math.min(1, dt * 0.8);
    const sp = K.sp[i];
    x += Math.sin(h) * sp * dt; z += Math.cos(h) * sp * dt;
    const bed = groundAt(x, z);
    const ty = Math.min(Math.max(K.ty[i], bed + 0.25), WATER_Y - 0.17);
    K.y[i] += (ty - K.y[i]) * Math.min(1, dt * 0.5);
    if (Math.hypot(K.tx[i] - x, K.tz[i] - z) < 0.8 || rnd() < dt * 0.02) newTarget(i);
    K.x[i] = x; K.z[i] = z; K.h[i] = h;
    K.ph[i] += dt * (2.2 + sp * 9 + Math.abs(K.turn[i]) * 2);
    swim.array[i * 2] = K.ph[i];
    swim.array[i * 2 + 1] = clamp(0.35 + sp * 2.2 + Math.abs(K.turn[i]) * 0.6, 0.3, 1.4);
    _e.set(0, h, -K.turn[i] * 0.25); _q.setFromEuler(_e);
    _p.set(x, K.y[i], z); _s.setScalar(K.L[i]);
    _m.compose(_p, _q, _s).toArray(arr, i * 16);
  }
  mesh.instanceMatrix.needsUpdate = true;
  swim.needsUpdate = true;
}
