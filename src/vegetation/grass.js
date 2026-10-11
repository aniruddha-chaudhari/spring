// vegetation/grass.js — dense GPU-instanced grass blades in spatial chunks with frustum culling and distance LOD.
// Every blade is 11 vertices (4 segments + tip). Per-instance data: root/yaw, shape (height, width, lean, rank), tint.
// LOD: a blade's "rank" (0..1, random) is compared with a distance-based density; dropped blades shrink smoothly and the
// survivors widen to keep coverage. Per chunk, instanceCount is cut to the highest density it can need this frame.
import * as THREE from 'three';
import { U, WIND_GLSL, borderDist, noise2, mulberry32, patchMaterial, applyCloudShadows, ANCHORS, smoothstep, IS_SPRING } from '../world.js';
import { FOLIAGE_LIGHT_GLSL, FOLIAGE_GLOW_GLSL, FOLIAGE_SANITIZE, NORMAL_NOFLIP, lin } from './shared.js';

const CH = 12;           // chunk size (m)
const EXT = 48;          // grass covers |x|,|z| < EXT (glade border 38 + fringe)
const FRINGE = 10;       // feathered fringe beyond the border
const DENSITY = 84;
const LOW_POLY_DIST = 34;  // chunks farther than this use the 5-triangle blade      // candidate blades per m²

export const grassLod = { near: 12, far: 85, min: 0.17 };
function lodDensity(d) { return 1 + (grassLod.min - 1) * smoothstep(grassLod.near, grassLod.far, d); }

function bladeGeometry() {
  const T = [0, 0.28, 0.52, 0.74, 0.9];
  const pos = [];
  for (const t of T) pos.push(-1, t, 0, 1, t, 0);
  pos.push(0, 1, 0);
  const idx = [];
  for (let i = 0; i < T.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const l = (T.length - 1) * 2; idx.push(l, l + 1, l + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // far LOD: same vertices, levels 0, 0.52, 0.9 + tip (5 triangles instead of 9)
  g.userData.lowIndex = new THREE.Uint16BufferAttribute([0, 1, 5, 0, 5, 4, 4, 5, 9, 4, 9, 8, 8, 9, 10], 1);
  return g;
}

const GRASS_VERT_PARS = /* glsl */`
${WIND_GLSL}
attribute vec4 aRoot;   // x y z yaw
attribute vec4 aShape;  // height width lean rank
attribute vec4 aTint;   // dry wet rust seed
uniform vec3 uLod;      // near far min
uniform vec3 gRoot, gOlive, gLush, gStraw, gRust, gLushTip;
varying vec3 vGrassCol;
varying float vHkTransl;
varying float vHkOuter;
`;
const GRASS_NORMAL = /* glsl */`
float hkT = position.y, hkSide = position.x;
vec3 hkRootP = aRoot.xyz;
float hkCamD = distance(cameraPosition, hkRootP);
float hkDens = mix(1.0, uLod.z, smoothstep(uLod.x, uLod.y, hkCamD));
float hkKeep = clamp((hkDens - aShape.w) * 30.0, 0.0, 1.0);
float hkH = aShape.x * hkKeep;
float hkW = aShape.y * pow(1.0 / hkDens, 1.0) * (1.0 - pow(hkT, 1.5) * 0.92);
vec2 hkF = vec2(sin(aRoot.w), cos(aRoot.w));
vec2 hkR = vec2(hkF.y, -hkF.x);
vec2 hkD = hkF * aShape.z * hkH + windBend(hkRootP.xz, 1.0, hkH * 0.95);
float hkDl = length(hkD);
if (hkDl > hkH * 0.92) { hkD *= hkH * 0.92 / hkDl; hkDl = hkH * 0.92; }
float hkHy = sqrt(max(hkH * hkH - hkDl * hkDl * 0.85, hkH * hkH * 0.08));
vec3 hkPos = hkRootP + vec3(0.0, hkHy * hkT, 0.0) + vec3(hkD.x, 0.0, hkD.y) * hkT * hkT + vec3(hkR.x, 0.0, hkR.y) * hkSide * hkW * 0.5;
vec3 objectNormal = normalize(vec3(0.0, 1.7, 0.0) + vec3(hkF.x, 0.0, hkF.y) * 0.3 + vec3(hkR.x, 0.0, hkR.y) * hkSide * 0.5
                    + vec3(hkD.x, 0.0, hkD.y) / max(hkH, 0.01) * 0.5);
// colour: dark roots -> olive/green -> golden straw tips; rust patches; lush near water; brighter where the gust passes
float hkGust = windGust(hkRootP.xz);
vec3 hkMid = mix(gOlive, gLush, aTint.y);
vec3 hkTip = mix(gStraw, gRust, aTint.z);
hkTip = mix(hkTip, gLushTip, aTint.y * 0.55);
vec3 hkC = mix(hkMid, hkTip, smoothstep(0.15, 1.0, hkT) * (0.1 + 0.9 * aTint.x));
hkC *= mix(0.45, 1.0, smoothstep(0.0, 0.55, hkT));
hkC *= 0.82 + 0.36 * fract(aTint.w * 13.71);
hkC *= 1.0 + hkGust * 0.28 * hkT * uWindStrength;
vGrassCol = hkC;
vHkTransl = 0.85 * hkT;
vHkOuter = 0.6 * hkT;
`;

export function buildGrass(scene, F, placedTrees = []) {
  const blade = bladeGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const lodU = { value: new THREE.Vector3(grassLod.near, grassLod.far, grassLod.min) };
  const cols = IS_SPRING ? {
    // spring: fresh green, light yellow-green tips, no straw or rust
    gRoot: lin('#24361a'), gOlive: lin('#4f8a2c'), gLush: lin('#3f8a2a'), gStraw: lin('#b6d660'),
    gRust: lin('#9cc850'), gLushTip: lin('#a8d45e'),
  } : {
    gRoot: lin('#2a3214'), gOlive: lin('#7a7c34'), gLush: lin('#5f7e2e'), gStraw: lin('#ecc674'),
    gRust: lin('#b0582a'), gLushTip: lin('#a9b25a'),
  };
  const uniforms = { uLod: lodU, hkWrap: { value: 0.7 }, hkTranslK: { value: 1.4 } };
  for (const k in cols) uniforms[k] = { value: new THREE.Color(...cols[k]) };
  patchMaterial(mat, 'grass', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uSunDir = U.uSunDir; shader.uniforms.uSunColor = U.uSunColor;
    shader.uniforms.uTime = U.uTime; shader.uniforms.uWindDir = U.uWindDir; shader.uniforms.uWindStrength = U.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GRASS_VERT_PARS)
      .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
      .replace('#include <begin_vertex>', 'vec3 transformed = hkPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vGrassCol;')
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + FOLIAGE_LIGHT_GLSL)
      .replace('#include <normal_fragment_begin>', NORMAL_NOFLIP)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FOLIAGE_GLOW_GLSL)
      .replace('#include <opaque_fragment>', FOLIAGE_SANITIZE);
  });
  applyCloudShadows(mat);

  const meadows = ANCHORS.zones.pampasMeadows;
  const canopy = placedTrees.filter(t => t.type !== 'pine').map(t => ({ x: t.crown ? t.crown.x : t.x, z: t.crown ? t.crown.z : t.z, r: t.r + 1 }));
  const group = new THREE.Group(); group.name = 'grass';
  const chunks = [];
  let total = 0;
  const nC = Math.ceil((EXT * 2) / CH);
  for (let cz = 0; cz < nC; cz++) for (let cx = 0; cx < nC; cx++) {
    const x0 = -EXT + cx * CH, z0 = -EXT + cz * CH;
    // skip chunks fully outside the fringe
    if (borderDist(x0 + CH / 2, z0 + CH / 2) > FRINGE + CH * 0.71) continue;
    const rnd = mulberry32(1000 + cz * 97 + cx * 13);
    const can = canopy.filter(t => t.x > x0 - t.r && t.x < x0 + CH + t.r && t.z > z0 - t.r && t.z < z0 + CH + t.r);
    const n = Math.round(CH * CH * DENSITY);
    const root = [], shape = [], tint = [];
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * CH, z = z0 + rnd() * CH;
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      const bd = borderDist(x, z);
      if (bd > FRINGE) continue;
      if (bd > 0 && r1 > (1 - smoothstep(0, FRINGE, bd + noise2(x * 0.25, z * 0.25) * 3)) ) continue;
      const edge = F.edge(x, z);            // metres from the water's edge
      if (edge < 0.08) continue;
      const pd = F.pd(x, z);
      if (pd < 0.06) continue;
      if (F.blocked(x, z)) continue;
      if (pd < 0.5 && r2 < 0.5 * (1 - pd / 0.5)) continue;   // sparse right at path edges
      const y = F.h(x, z) - 0.03;
      const wet = smoothstep(2.6, 0.3, edge);
      let meadow = 0;
      for (const m of meadows) meadow = Math.max(meadow, 1 - smoothstep(m.r * 0.6, m.r * 1.3, Math.hypot(x - m.x, z - m.z)));
      const patch = F.n(0, x, z);
      let h = 0.28 + 0.16 * patch + 0.22 * Math.max(0, F.n(1, x, z));
      h += wet * 0.3 + meadow * 0.08;
      h *= 0.3 + 0.7 * smoothstep(0.0, 1.4, pd);                       // trimmed near paths
      h *= 0.7 + 0.6 * r3;
      for (const t of can) { const dd = Math.hypot(x - t.x, z - t.z); if (dd < t.r) h *= 0.5 + 0.5 * smoothstep(t.r * 0.35, t.r, dd); }
      if (bd > 0) h *= 1 - 0.4 * smoothstep(0, FRINGE, bd);
      if (IS_SPRING) h *= 0.72 - 0.12 * meadow;        // spring: shorter, lusher (no tall dry tufts)
      h = Math.max(0.06, h);
      const w = 0.045 + 0.04 * r4 + wet * 0.01;
      const lean = 0.15 + 0.45 * rnd();
      const green = smoothstep(0.0, 0.35, F.n(4, x, z));
      const dry = Math.min(1, Math.max(0, 0.5 + 0.8 * F.n(2, x, z) + meadow * 0.5 - wet * 0.6 - green * 0.5));
      const rust = smoothstep(0.18, 0.45, F.n(3, x, z)) * (1 - wet) * (0.3 + 0.7 * rnd()) * (IS_SPRING ? 0.4 : 1);
      root.push(x, y, z, rnd() * Math.PI * 2);
      shape.push(h, w, lean, 0);
      tint.push(dry, wet, rust, rnd());
      if (y < ymin) ymin = y; if (y + h > ymax) ymax = y + h;
    }
    const cnt = root.length / 4;
    if (!cnt) continue;
    for (let i = 0; i < cnt; i++) shape[i * 4 + 3] = (i + 0.5) / cnt;   // rank: generation order is spatially random
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.setAttribute('position', blade.getAttribute('position'));
    geo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(root), 4));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shape), 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tint), 4));
    geo.instanceCount = cnt;
    const cy = (ymin + ymax) / 2 + 0.4;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CH / 2, cy, z0 + CH / 2), Math.hypot(CH / 2, CH / 2, (ymax - ymin) / 2 + 1.2));
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - 1, ymin - 0.5, z0 - 1), new THREE.Vector3(x0 + CH + 1, ymax + 1, z0 + CH + 1));
    const geoLow = new THREE.InstancedBufferGeometry();
    geoLow.index = blade.userData.lowIndex;
    for (const k of ['position', 'aRoot', 'aShape', 'aTint']) geoLow.setAttribute(k, geo.getAttribute(k));
    geoLow.instanceCount = cnt;
    geoLow.boundingSphere = geo.boundingSphere; geoLow.boundingBox = geo.boundingBox;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.name = 'grassChunk';
    group.add(mesh);
    chunks.push({ mesh, geo, geoLow, cnt, box: geo.boundingBox });
    total += cnt;
  }
  scene.add(group);

  const _p = new THREE.Vector3();
  function update(camera) {
    lodU.value.set(grassLod.near, grassLod.far, grassLod.min);
    const c = camera.position;
    let drawn = 0;
    for (const ch of chunks) {
      ch.box.clampPoint(c, _p);
      const d = _p.distanceTo(c);
      const need = Math.min(1, lodDensity(d) + 0.04);
      const g = d > LOW_POLY_DIST ? ch.geoLow : ch.geo;
      if (ch.mesh.geometry !== g) ch.mesh.geometry = g;
      g.instanceCount = Math.max(1, Math.ceil(ch.cnt * need));
      drawn += g.instanceCount;
    }
    stats.drawnMax = drawn;
  }
  const stats = { blades: total, chunks: chunks.length, drawnMax: 0 };
  update({ position: new THREE.Vector3(50, 23, 57) });
  return { group, update, stats, material: mat };
}
