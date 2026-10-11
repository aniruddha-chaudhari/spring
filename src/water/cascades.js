// water/cascades.js — (spring only) small hot-spring cascades over the rapids' rock ledges and off two big boulders.
// The stream surface stays flat at WATER_Y: each cascade is a separate animated sheet that pours from a lip just
// above the surface into the stream, plus a churn of foam at its base (drawn by the water shader via uCascades).
import * as THREE from 'three';
import { WATER_Y, S_RAPIDS, bankPoint, streamPoint, U } from '../world.js';

// Where the water spills. These follow the spring onsen stones built by architecture/onsen.js (keep in sync):
//  - 'ledge': low rock ledges across the rapids (LEDGE_DEFS there, top ~WATER_Y + 0.07). The stream pours over their
//    downstream edge as a short, wide white curtain. t0/t1 run across the channel (0 = north bank, 1 = south bank).
//  - 'spill': water pouring off the top of a big flat-topped boulder on the bank (BIG list there) into the stream.
const LEDGE_TOP = WATER_Y + 0.07;
const SPOTS = [
  { kind: 'ledge', ds: -6.0, t0: 0.02, t1: 0.68 },
  { kind: 'ledge', ds: -0.5, t0: 0.3, t1: 0.98 },
  { kind: 'ledge', ds: 5.0, t0: 0.02, t1: 0.42 },
  { kind: 'ledge', ds: 5.0, t0: 0.6, t1: 0.98 },
  { kind: 'spill', ds: -9.5, side: -1, off: 0.25, r: 1.65, top: 0.62, w: 0.85 },
  { kind: 'spill', ds: 2.5, side: -1, off: -0.15, r: 1.2, top: 0.4, w: 0.6 },
];
function crossPoint(s, t) { const p = streamPoint(s), k = (2 * t - 1) * p.hw; return { x: p.x + p.nx * k, z: p.z + p.nz * k }; }

// lip = centre of the edge the water leaves, dir = horizontal pour direction, across = along the lip,
// w = lip width, top = lip height above WATER_Y, base = where it lands (for the churn)
export const CASCADES = SPOTS.map((c) => {
  const s = S_RAPIDS + c.ds;
  const p = streamPoint(s);
  if (c.kind === 'ledge') {
    const a = crossPoint(s, c.t0), b = crossPoint(s, c.t1);
    const lip = { x: (a.x + b.x) / 2 + p.tx * 0.24, z: (a.z + b.z) / 2 + p.tz * 0.24, y: LEDGE_TOP + 0.035 };
    const w = Math.hypot(b.x - a.x, b.z - a.z) * 0.92;
    return { ...c, s, top: lip.y - WATER_Y, w, lip, dir: { x: p.tx, z: p.tz }, across: { x: p.nx, z: p.nz }, back: 0.32,
      base: { x: lip.x + p.tx * 0.45, z: lip.z + p.tz * 0.45 }, churnR: 0.55 };
  }
  // boulder spill: start a little inside the boulder (hidden by it) so the sheet emerges from its top edge
  const ctr = bankPoint(s, c.side, c.off);
  const dir = { x: -p.nx * c.side, z: -p.nz * c.side };
  const ins = c.r * 0.72;
  const lip = { x: ctr.x + dir.x * ins, z: ctr.z + dir.z * ins, y: WATER_Y + c.top - 0.02 };
  const reach = 0.85 * Math.sqrt((2 * c.top) / 9.8) + 0.25;
  return { ...c, s, top: c.top - 0.02, lip, dir, across: { x: -dir.z, z: dir.x }, back: 0.2,
    base: { x: lip.x + dir.x * reach, z: lip.z + dir.z * reach }, churnR: 0.5 + c.w * 0.4 };
});

const VERT = /* glsl */`
#include <common>
attribute vec2 aUV;          // x: across -0.5..0.5, y: 0 (lip) .. 1 (water)
attribute float aLen;        // metres along the sheet at this vertex
varying vec2 vUV;
varying float vLen;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vUV = aUV; vLen = aLen;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */`
#include <common>
uniform sampler2D tWaves;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform vec3 uAmbient;
uniform float uSeed;
varying vec2 vUV;
varying float vLen;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  float u = vUV.x, v = vUV.y;
  // streaks stretched along the fall, scrolling down; two layers at different speeds
  float n1 = texture2D(tWaves, vec2(u * 0.9 + uSeed, vLen * 0.22 - uTime * 0.9)).a;
  float n2 = texture2D(tWaves, vec2(u * 1.7 + uSeed * 1.7 + 0.3, vLen * 0.38 - uTime * 1.45)).a;
  float n3 = texture2D(tWaves, vec2(u * 3.1 + uSeed * 0.3, vLen * 0.9 - uTime * 2.3)).a;
  float streak = n1 * 0.5 + n2 * 0.35 + n3 * 0.25;
  float white = smoothstep(0.1, 0.75, v);                   // glassy at the lip, white water lower down
  float side = smoothstep(0.5, 0.36 - 0.06 * n2, abs(u));     // soft ragged sides
  float a = smoothstep(0.45 - 0.25 * white, 0.85 - 0.2 * white, streak) * (0.45 + 0.5 * white) + 0.18;
  a *= side * smoothstep(0.0, 0.06, v);
  a = clamp(a, 0.0, 0.92);
  vec3 L = normalize(uSunDir);
  vec3 N = normalize(vNormal);
  float sunUp = smoothstep(-0.04, 0.12, L.y);
  float dif = 0.55 + 0.45 * abs(dot(N, L));                  // thin sheet: lit from both sides
  vec3 E = uSunColor * sunUp * dif * 0.9 + uAmbient;
  vec3 milk = vec3(0.62, 0.86, 0.85);
  vec3 foam = vec3(0.95, 0.97, 0.97);
  vec3 col = mix(milk, foam, white * (0.55 + 0.45 * streak)) * E / PI;
  col += vec3(0.5, 0.75, 0.75) * 0.05 * uNight;              // the milky water glows faintly at night
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function sheetGeometry(c) {
  const NU = 10, NV = 22;
  const pos = [], uv = [], len = [], idx = [];
  const fallT = Math.sqrt((2 * c.top) / 9.8);
  const back = c.back;                                 // the sheet starts a little behind the lip, on the stone
  // profile point at v in [0,1]: first 18% runs over the lip, then a ballistic arc down to (below) the surface
  const prof = (v) => {
    const k = 0.18;
    if (v < k) { const t = v / k; return { h: -back * (1 - t), y: c.top + 0.03 * (1 - t) }; }
    const t = ((v - k) / (1 - k)) * (fallT + 0.06);      // run on slightly below the surface
    return { h: 0.85 * t + 0.6 * t * t, y: c.top - 4.9 * t * t };
  };
  let acc = 0, prev = null;
  const lens = [];
  for (let j = 0; j <= NV; j++) { const p = prof(j / NV); if (prev) acc += Math.hypot(p.h - prev.h, p.y - prev.y); lens.push(acc); prev = p; }
  for (let j = 0; j <= NV; j++) {
    const v = j / NV, p = prof(v);
    const wid = c.w * (c.kind === 'ledge' ? 1.0 : 0.92 + 0.22 * v);
    for (let i = 0; i <= NU; i++) {
      const u = i / NU - 0.5;
      const bow = 0.06 * (1 - 4 * u * u) * Math.min(1, v * 3);   // centre runs slightly ahead
      const x = c.lip.x + c.dir.x * (p.h + bow) + c.across.x * u * wid;
      const z = c.lip.z + c.dir.z * (p.h + bow) + c.across.z * u * wid;
      pos.push(x, WATER_Y + p.y, z);
      uv.push(u, v);
      len.push(lens[j]);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, d = a + NU + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createCascades(wavesTex, ambient) {
  const group = new THREE.Group();
  group.name = 'water-cascades';
  const mats = [];
  CASCADES.forEach((c, k) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        tWaves: { value: wavesTex }, uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uNight: U.uNight,
        uAmbient: ambient, uSeed: { value: k * 0.37 },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(sheetGeometry(c), mat);
    m.renderOrder = 2;
    m.frustumCulled = false;
    group.add(m);
    mats.push(mat);
  });
  // churn at the base, consumed by the water shader: (x, z, radius, strength)
  const churn = [];
  for (const c of CASCADES) {
    // long ledge curtains get several churn spots along the lip
    const n = Math.max(1, Math.round(c.w / 1.1));
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : (i / (n - 1) - 0.5) * c.w * 0.8;
      churn.push(new THREE.Vector4(c.base.x + c.across.x * u, c.base.z + c.across.z * u, c.churnR, c.kind === 'ledge' ? 0.8 : 1));
    }
  }
  return { group, churn };
}
