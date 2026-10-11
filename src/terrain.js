// terrain.js — the ground: a detailed inner heightfield for the glade and a coarse outer one for the endless valley.
// One splat-blended material: autumn grass, leaf litter, gravel paths, river pebbles, mossy rock on slopes,
// wet darkening at the waterline and a soft Tiny Glade-style border line.
import * as THREE from 'three';
import {
  groundHeight, streamAt, pathDist, borderDist, ANCHORS, WATER_Y, WORLD, LAYER_REFRACT,
  loadTex, applyCloudShadows, patchMaterial, fbm2, smoothstep, clamp, IS_SPRING,
} from './world.js';

const INNER = 56;        // inner mesh half-size (m)
const INNER_SEG = 448;   // 0.25 m cells
const OUTER_SEG = 260;   // ~2 m cells over the whole world

let material = null;
const meshes = [];

function splatAt(x, z) {
  const st = streamAt(x, z);
  // river bed (pebbles) under the water and a little up the bank
  const bed = 1 - smoothstep(st.hw - 0.2, st.hw + 0.55, st.d);
  // gravel paths with a slightly ragged edge
  const pd = pathDist(x, z) + fbm2(x * 0.9, z * 0.9, 2) * 0.18;
  const gravel = 1 - smoothstep(-0.25, 0.15, pd);
  // leaf litter under trees, in the cedar grove, in patches, and more of it outside the glade
  let leaves = 0;
  for (const t of ANCHORS.trees) {
    const r = 4.6 * t.s;
    const d = Math.hypot(x - t.x - t.lean.x * 1.5, z - t.z - t.lean.z * 1.5);
    leaves = Math.max(leaves, 1 - smoothstep(r * 0.4, r, d));
  }
  const g = ANCHORS.zones.cedarGrove;
  leaves = Math.max(leaves, 1 - smoothstep(g.r * 0.5, g.r * 1.2, Math.hypot(x - g.x, z - g.z)));
  const patch = smoothstep(0.15, 0.5, fbm2(x * 0.06 + 3, z * 0.06 - 5, 3));
  leaves = Math.max(leaves, patch * 0.7, smoothstep(2, 14, borderDist(x, z)) * 0.55 * (0.5 + patch));
  // normalise: bed > gravel > leaves > grass
  const wBed = bed;
  const wGravel = gravel * (1 - wBed);
  const wLeaves = clamp(leaves, 0, 1) * (1 - wBed) * (1 - wGravel);
  const wGrass = Math.max(0, 1 - wBed - wGravel - wLeaves);
  return [wGrass, wLeaves, wGravel, wBed];
}

function buildMesh(half, seg, isOuter) {
  const g = new THREE.PlaneGeometry(half * 2, half * 2, seg, seg).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const splat = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let y = groundHeight(x, z);
    // the outer mesh dips under the inner one so they never fight
    if (isOuter && Math.abs(x) < INNER - 1 && Math.abs(z) < INNER - 1) y -= 0.6;
    p.setY(i, y);
    const w = splatAt(x, z);
    splat.set(w, i * 4);
  }
  g.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  m.castShadow = !isOuter;
  m.layers.enable(LAYER_REFRACT);
  m.name = isOuter ? 'terrain-outer' : 'terrain';
  return m;
}

function makeMaterial() {
  const tex = {
    grass: loadTex('leafy_grass', 'diff'), grassN: loadTex('leafy_grass', 'nor'),
    leaves: loadTex('forest_leaves_02', 'diff'), leavesN: loadTex('forest_leaves_02', 'nor'),
    gravel: loadTex('leaf_scattered_gravel', 'diff'), gravelN: loadTex('leaf_scattered_gravel', 'nor'),
    bed: loadTex('river_small_rocks', 'diff'), bedN: loadTex('river_small_rocks', 'nor'),
    rock: loadTex('mossy_rock', 'diff'), rockN: loadTex('mossy_rock', 'nor'),
  };
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  if (IS_SPRING) mat.defines = { HK_SPRING: '' };
  mat.name = 'terrain';
  patchMaterial(mat, 'terrain', (shader) => {
    for (const [k, v] of Object.entries(tex)) shader.uniforms['t_' + k] = { value: v };
    shader.uniforms.uWaterY = { value: WATER_Y };
    shader.uniforms.uBorder = { value: 38 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vTWorld;\nvarying vec3 vTNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vSplat;
varying vec3 vTWorld;
varying vec3 vTNormal;
uniform sampler2D t_grass, t_grassN, t_leaves, t_leavesN, t_gravel, t_gravelN, t_bed, t_bedN, t_rock, t_rockN;
uniform float uWaterY;
uniform float uBorder;
float tn_hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float tn_noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tn_hash(i), tn_hash(i + vec2(1, 0)), u.x), mix(tn_hash(i + vec2(0, 1)), tn_hash(i + vec2(1, 1)), u.x), u.y); }
// two scales blended by noise to hide tiling
vec4 tn_sample(sampler2D t, vec2 p, float s) {
  float k = tn_noise(p * 0.07);
  return mix(texture2D(t, p * s), texture2D(t, p * s * 0.37 + 0.31), smoothstep(0.3, 0.7, k));
}
float tn_borderDist(vec2 p) {
  vec2 q = abs(p) - vec2(uBorder - 12.0);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 12.0;
}
float tn_slope() { return 1.0 - smoothstep(0.62, 0.86, vTNormal.y); }
`)
      .replace('#include <map_fragment>', `
{
  vec2 p = vTWorld.xz;
  vec4 w = vSplat;
  float rockW = tn_slope() * (1.0 - w.w * 0.6);
  vec3 grass = tn_sample(t_grass, p, 0.28).rgb;
  float pv = tn_noise(p * 0.045) * 0.65 + tn_noise(p * 0.17) * 0.35;
#ifdef HK_SPRING
  // spring grade: fresh, slightly blue-green grass with lighter young patches
  grass *= mix(vec3(0.78, 1.0, 0.72), vec3(0.95, 1.12, 0.78), pv);
  // fallen sakura petals instead of autumn litter: pale pink over the leaf-litter texture
  vec3 lsrc = tn_sample(t_leaves, p, 0.35).rgb;
  vec3 leaves = mix(lsrc * vec3(0.85, 0.95, 0.8), vec3(0.98, 0.84, 0.88), smoothstep(0.25, 0.6, dot(lsrc, vec3(0.33))) * 0.85);
#else
  // autumn grade on the grass: golden/olive variation in big soft patches
  grass *= mix(vec3(0.92, 0.86, 0.55), vec3(1.08, 0.98, 0.62), pv);
  grass = mix(grass, grass * vec3(1.25, 0.82, 0.5), smoothstep(0.62, 0.85, pv) * 0.45);
  vec3 leaves = tn_sample(t_leaves, p, 0.35).rgb * vec3(1.12, 0.92, 0.82);
#endif
  // the source is dark wet stone with leaves; lift it toward pale garden gravel but keep a few leaf colours
  vec3 gsrc = tn_sample(t_gravel, p, 0.45).rgb;
  float gl = dot(gsrc, vec3(0.3, 0.5, 0.2));
  vec3 gravel = (mix(vec3(gl), gsrc, 0.35) * 2.4 + 0.06) * vec3(1.03, 0.99, 0.9);
  vec3 bed = tn_sample(t_bed, p, 0.42).rgb * vec3(0.95, 0.98, 0.95);
  vec3 rx = texture2D(t_rock, vTWorld.zy * 0.22).rgb, rz = texture2D(t_rock, vTWorld.xy * 0.22).rgb, ry = texture2D(t_rock, p * 0.22).rgb;
  vec3 bw = pow(abs(vTNormal), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec3 rock = rx * bw.x + ry * bw.y + rz * bw.z;
  vec3 col = grass * w.x + leaves * w.y + gravel * w.z + bed * w.w;
  col = mix(col, rock, clamp(rockW, 0.0, 1.0));
  // wet band at the waterline + darker damp soil under the surface
  float above = vTWorld.y - uWaterY;
  float wet = 1.0 - smoothstep(-0.05, 0.32, above);
  col *= mix(1.0, 0.58, wet);
  col = mix(col, col * vec3(0.82, 0.95, 0.92), smoothstep(0.0, -0.6, above));
  // outside the glade: slightly cooler and softer so the eye stays inside
  float bd = tn_borderDist(p);
  col = mix(col, col * vec3(0.93, 0.95, 1.0), smoothstep(0.0, 18.0, bd) * 0.5);
  // the border: a thin soft cream line, like a chalk mark on a tabletop
  float line = (1.0 - smoothstep(0.0, 0.16, abs(bd))) * (1.0 - smoothstep(-0.2, 0.2, above));
  col = mix(col, vec3(0.98, 0.93, 0.80), line * 0.55);
  diffuseColor.rgb *= col;
  vTerrainWet = wet;
}`)
      .replace('#include <common>', '#include <common>\nfloat vTerrainWet = 0.0;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, vTerrainWet);')
      .replace('#include <normal_fragment_maps>', `
{
  vec2 p = vTWorld.xz;
  vec4 w = vSplat;
  vec3 n = (tn_sample(t_grassN, p, 0.28).xyz * 2.0 - 1.0) * w.x
         + (tn_sample(t_leavesN, p, 0.35).xyz * 2.0 - 1.0) * w.y
         + (tn_sample(t_gravelN, p, 0.45).xyz * 2.0 - 1.0) * w.z
         + (tn_sample(t_bedN, p, 0.42).xyz * 2.0 - 1.0) * w.w;
  n.xy *= 0.9;
  vec3 N = normalize(vTNormal);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = normalize(cross(T, N)); // +Z: texture v follows world z
  vec3 wn = normalize(T * n.x + B * n.y + N * max(n.z, 0.2));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`);
  });
  applyCloudShadows(mat);
  return mat;
}

export async function init(ctx) {
  material = makeMaterial();
  const inner = buildMesh(INNER, INNER_SEG, false);
  const outer = buildMesh(WORLD, OUTER_SEG, true);
  ctx.scene.add(inner, outer);
  meshes.push(inner, outer);
}
export function getTerrainMaterial() { return material; }
export function getTerrainMeshes() { return meshes; }
export function update() {}
