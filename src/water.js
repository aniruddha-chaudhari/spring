// water.js — the stream + pond: refraction pre-pass, Beer–Lambert colour, flow-mapped ripples, foam, HDR glints,
// caustics for submerged materials (applyCaustics) and floating autumn leaves.
//
// API
//   init(ctx) / update(dt, t, ctx) / beforeRender(ctx) / setPreset(name)
//   applyCaustics(material)    patch a Mesh{Standard,Physical,Lambert,Phong}Material: caustics on its direct light below WATER_Y
//   CAUSTICS_GLSL, causticUniforms()   for custom ShaderMaterials: vec3 hkCaustics(vec3 worldPos) -> multiplier for direct sun
//   flowAt(x, z)               CPU stream velocity { x, z, speed, wake, turb } (koi, particles, audio…)
//   debug: ?wdbg=1 refraction buffer, 2 water body only, 3 path/depth, 4 reflection + specular
//   water                      { mesh, leaves, material, refractTarget } after init
import * as THREE from 'three';
import {
  WATER_Y, streamAt, ANCHORS, U, LAYER_REFRACT, CLOUD_GLSL, loadTex, patchMaterial, mulberry32, streamPoint, S_POND, IS_SPRING,
} from './world.js';
import { flowAt, obstacles, POND_C } from './water/flow.js';
import { makeWaveTexture } from './water/textures.js';
import { applyCaustics, causticShared, causticUniforms, CAUSTICS_GLSL } from './water/caustics.js';
import { createLeaves } from './water/leaves.js';
import { createPetals } from './water/petals.js';
import { createCascades, CASCADES } from './water/cascades.js';

export { applyCaustics, causticUniforms, CAUSTICS_GLSL, flowAt, causticShared, CASCADES };

const REFR_SCALE = 0.5;       // pre-pass resolution relative to the drawing buffer
const CELL = 0.5;             // surface mesh grid (m)
const MARGIN = 1.2;           // mesh reaches this far past the water's edge (hidden under the banks)

export const water = { mesh: null, leaves: null, material: null, refractTarget: null };

// ------------------------------------------------------------------ surface geometry
// A grid clipped to the channel (no fold-overs on the bends). Attributes:
//   uv     = (arc length s, signed distance across)        aFlow = velocity (m/s)
//   aInfo  = (distance inside the edge, channel depth, wake foam 0..1, rapids turbulence 0..1)
function buildGeometry() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  // bounding box of the stream (use streamAt on a coarse scan of the samples via ANCHORS-free math)
  for (let x = -262; x <= 262; x += 2) for (let z = -262; z <= 262; z += 2) {
    const st = streamAt(x, z);
    if (st.d < st.hw + MARGIN + 3) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  }
  minX = Math.floor(minX - 3); minZ = Math.floor(minZ - 3); maxX = Math.ceil(maxX + 3); maxZ = Math.ceil(maxZ + 3);
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const VX = nx + 1, VZ = nz + 1;
  const inside = new Float32Array(VX * VZ);
  for (let j = 0; j < VZ; j++) for (let i = 0; i < VX; i++) {
    const st = streamAt(minX + i * CELL, minZ + j * CELL);
    inside[j * VX + i] = st.hw + MARGIN - st.d;
  }
  const vid = new Int32Array(VX * VZ).fill(-1);
  const pos = [], uv = [], flow = [], info = [], idx = [];
  const fl = { x: 0, z: 0, speed: 0, wake: 0, turb: 0, st: null };
  const vert = (i, j) => {
    const k = j * VX + i;
    if (vid[k] >= 0) return vid[k];
    const x = minX + i * CELL, z = minZ + j * CELL;
    flowAt(x, z, fl);
    const st = fl.st;
    vid[k] = pos.length / 3;
    pos.push(x, WATER_Y, z);
    uv.push(st.s, st.d * st.side);
    flow.push(fl.x, fl.z);
    info.push(st.hw - st.d, st.depth, fl.wake, fl.turb);
    return vid[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * VX + i;
    if (Math.max(inside[a], inside[a + 1], inside[a + VX], inside[a + VX + 1]) <= 0) continue;
    const v00 = vert(i, j), v10 = vert(i + 1, j), v01 = vert(i, j + 1), v11 = vert(i + 1, j + 1);
    idx.push(v00, v01, v10, v10, v01, v11);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ------------------------------------------------------------------ shaders
const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aFlow;
attribute vec4 aInfo;
varying vec3 vWorld;
varying vec3 vView;
varying vec4 vClip;
varying vec2 vFlow;
varying vec4 vInfo;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
  vClip = gl_Position;
  vFlow = aFlow;
  vInfo = aInfo;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
#include <cube_uv_reflection_fragment>
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uCloud;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform sampler2D tWaves;
uniform sampler2D tRefr;
uniform sampler2D tDepth;
uniform vec2 uProjScale;      // (P00, P11)
uniform vec2 uDepthParams;    // (P22, P32) to linearise depth
uniform float uLogFar;
uniform mat4 uCamWorld;
uniform sampler2D uEnvMap;
uniform float uEnvIntensity;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uAmbient;        // irradiance from sky/ambient lights (used when there is no env map)
uniform vec3 uAbsorb;         // Beer–Lambert absorption per metre
uniform vec3 uDeepColor;      // single-scattering albedo of the water body (jade)
uniform float uScatter;
uniform float uRefract;
uniform float uReflect;
uniform float uGlint;
uniform vec4 uCascades[NUM_CHURN];
uniform vec3 uMilk;
uniform vec3 uMilkDeep;
uniform vec4 uRings[4];
uniform vec3 uLanterns[NUM_LANTERNS];
uniform vec3 uLanternColor;
uniform sampler2D tShadow;
uniform mat4 uShadowMatrix;
uniform vec2 uShadowSize;
uniform float uShadowBias;
uniform float uHasShadow;
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif
varying vec3 vWorld;
varying vec3 vView;
varying vec4 vClip;
varying vec2 vFlow;
varying vec4 vInfo;
${CLOUD_GLSL}

float viewZAt(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
#ifdef REFR_LOGDEPTH
  return exp2(d * log2(uLogFar + 1.0)) - 1.0;
#else
  return uDepthParams.y / ((d * 2.0 - 1.0) + uDepthParams.x);
#endif
}
vec3 viewPosAt(vec2 uv, float vz) { return vec3((uv * 2.0 - 1.0) * vz / uProjScale, -vz); }

float D_GGX(float NdH, float a) {
  float a2 = a * a; float d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-7);
}
float shadowAt(vec3 wp) {
  if (uHasShadow < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float z = sc.z + uShadowBias;
  #ifdef HK_SPRING
  // smoother bilinear PCF (the opaque milky surface shows shadow texels plainly)
  {
    vec2 ts = 1.0 / uShadowSize;
    vec2 st = sc.xy * uShadowSize - 0.5;
    vec2 f = fract(st), b = (floor(st) + 0.5) * ts;
    float acc = 0.0;
    for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
      float wx = i == -1 ? 1.0 - f.x : (i == 2 ? f.x : 1.0);
      float wy = j == -1 ? 1.0 - f.y : (j == 2 ? f.y : 1.0);
      acc += wx * wy * step(z, unpackRGBAToDepth(texture2D(tShadow, b + vec2(float(i), float(j)) * ts)));
    }
    return acc / 9.0;
  }
  #endif
  vec2 tx = 1.5 / uShadowSize;
  float s = 0.0;
  s += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy)));
  s += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy + vec2(tx.x, 0.0))));
  s += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy - vec2(tx.x, 0.0))));
  s += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy + vec2(0.0, tx.y))));
  s += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy - vec2(0.0, tx.y))));
  return s * 0.2;
}
vec2 grad(vec4 t) { return t.xy * 2.0 - 1.0; }

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vWorld.xz;
  vec2 flow = vFlow;
  float speed = length(flow);
  float shore = vInfo.x;
  float wake = vInfo.z;
  float turb = vInfo.w;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // ---------------------------------------------------------------- flow-mapped ripples (two phases, crossfaded)
  float jit = texture2D(tWaves, p * 0.027).a;
  float T = 1.8;
  float tp = uTime / T + jit;
  float ph0 = fract(tp), ph1 = fract(tp + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0), w1 = 1.0 - w0;
  float wn = inversesqrt(w0 * w0 + w1 * w1);
  vec2 o0 = flow * (ph0 - 0.5) * T, o1 = flow * (ph1 - 0.5) * T;
  vec2 j0 = vec2(0.37, 0.71) * floor(tp), j1 = vec2(0.37, 0.71) * floor(tp + 0.5) + 0.5;
  vec4 a0 = texture2D(tWaves, (p - o0) / 3.4 + j0),          a1 = texture2D(tWaves, (p - o1) / 3.4 + j1);
  vec4 b0 = texture2D(tWaves, (p - o0) / 1.37 + j0 * 1.7 + 0.31), b1 = texture2D(tWaves, (p - o1) / 1.37 + j1 * 1.7 + 0.31);
  vec4 d0 = texture2D(tWaves, (p - o0) / 0.57 + j0 * 2.3 + 0.17), d1 = texture2D(tWaves, (p - o1) / 0.57 + j1 * 2.3 + 0.17);
  vec2 gA = (grad(a0) * w0 + grad(a1) * w1) * wn;
  vec2 gB = (grad(b0) * w0 + grad(b1) * w1) * wn;
  vec2 gD = (grad(d0) * w0 + grad(d1) * w1) * wn;
  vec4 wr = texture2D(tWaves, (p + uWindDir * uTime * 0.45) / 2.3 + vec2(0.5, 0.2));
  vec4 wr2 = texture2D(tWaves, (p + uWindDir * uTime * 0.7 + vec2(-uWindDir.y, uWindDir.x) * 0.3) / 0.9 + vec2(0.13, 0.77));
  float sN = smoothstep(0.06, 1.3, speed);
  float calm = 1.0 - sN;
  vec2 slope = gA * (0.035 + 0.11 * sN + 0.06 * turb)
             + gB * (0.022 + 0.07 * sN + 0.10 * turb)
             + gD * (0.016 + 0.035 * sN + 0.07 * turb)
             + (grad(wr) * 0.03 + grad(wr2) * 0.018) * (0.4 + 0.8 * calm) * uWindStrength;
  // expanding rings in the pond
  for (int i = 0; i < 4; i++) {
    vec4 r = uRings[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 7.0) continue;
    vec2 dv = p - r.xy; float rr = length(dv) + 1e-4;
    float x = rr - age * 0.42;
    float env = exp(-x * x * 9.0) * exp(-age * 0.5) * r.w * smoothstep(0.0, 0.25, age);
    slope += dv / rr * sin(x * 30.0) * env * 0.35;
  }
  #ifdef HK_SPRING
  // onsen: soft, low-contrast surface, livelier only where the little cascades churn it
  float churn = 0.0;
  for (int i = 0; i < NUM_CHURN; i++) {
    vec4 c = uCascades[i];
    vec2 dc = p - c.xy;
    churn += exp(-dot(dc, dc) / (c.z * c.z)) * c.w;
  }
  churn = min(churn, 1.0);
  slope = slope * (0.4 + 0.25 * turb) + (gB * 0.16 + gD * 0.12) * churn;
  #endif
  slope *= 1.0 / (1.0 + dist * 0.004);
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  // ---------------------------------------------------------------- refraction + thickness
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  float wz = -vView.z;
  float bz0 = viewZAt(suv);
  vec3 bedV0 = viewPosAt(suv, bz0);
  float vdep0 = ${WATER_Y.toFixed(3)} - (uCamWorld * vec4(bedV0, 1.0)).y;
  if (bz0 < wz) vdep0 = 0.0;
  vec2 dV = (viewMatrix * vec4(slope.x, 0.0, slope.y, 0.0)).xy;
  vec2 offs = dV * uRefract * clamp(vdep0, 0.0, 1.4) * uProjScale * 0.5 / wz;
  float bz1 = viewZAt(suv + offs);
  float valid = step(wz + 0.02, bz1);
  offs *= valid;
  float bz = mix(bz0, bz1, valid);
  vec3 refr = vec3(texture2D(tRefr, suv + offs * 1.05).r, texture2D(tRefr, suv + offs).g, texture2D(tRefr, suv + offs * 0.95).b);
  vec3 bedV = viewPosAt(suv + offs, bz);
  float vdep = max(${WATER_Y.toFixed(3)} - (uCamWorld * vec4(bedV, 1.0)).y, 0.0);
  float path = clamp(max(bz - wz, 0.0) * dist / wz, 0.0, 30.0);

  // ---------------------------------------------------------------- lighting terms
  vec3 L = normalize(uSunDir);
  float sunUp = smoothstep(-0.04, 0.12, L.y);
  float sh = shadowAt(vWorld) * cloudShadow(vWorld.xz);
  vec3 sunC = uSunColor * sunUp * sh;
  vec3 ambIrr;
  #ifdef ENVMAP_TYPE_CUBE_UV
    ambIrr = textureCubeUV(uEnvMap, vec3(0.0, 1.0, 0.0), 1.0).rgb * PI * uEnvIntensity;
  #else
    ambIrr = uAmbient;
  #endif
  vec3 lightRad = (sunC * max(L.y, 0.0) * 0.8 + ambIrr) / PI;   // radiance scale of light inside the water
  // keep the jade readable under strongly tinted light (golden hour): scatter mostly the light's luminance
  lightRad = mix(lightRad, vec3(dot(lightRad, vec3(0.3, 0.55, 0.15))), 0.6);

  // absorption (down to the bed and back up) + in-scattering of the jade water body
  vec3 Tr = exp(-uAbsorb * (path + vdep * 0.8));
  vec3 scat = uDeepColor * lightRad * (1.0 - exp(-path * uScatter));
  // lanterns tint the water body at night
  vec3 lanternSpec = vec3(0.0);
  vec3 lanternGlow = vec3(0.0);
  #if NUM_LANTERNS > 0
  if (uNight > 0.01) {
    for (int i = 0; i < NUM_LANTERNS; i++) {
      vec3 ld = uLanterns[i] - vWorld; float d2 = dot(ld, ld); ld *= inversesqrt(d2);
      vec3 hl = normalize(ld + V);
      float fl = 0.02 + 0.98 * pow(1.0 - max(dot(V, hl), 0.0), 5.0);
      lanternSpec += uLanternColor * min(D_GGX(max(dot(N, hl), 0.0), 0.16) * fl * 0.25 / max(dot(N, V), 0.08), 40.0) / (1.0 + d2 * 0.12);
      vec3 lg = uLanternColor * 0.25 / (1.0 + d2 * 0.6);
      scat += lg * uDeepColor;
      lanternGlow += lg;
    }
    lanternSpec *= uNight;
  }
  #endif
  vec3 under = refr * Tr + scat;
  #ifdef HK_SPRING
  // milky hot-spring water: a bright, high-albedo scattering medium. The bed shows only within ~10-25 cm of the
  // surface; more thickness = more milk (brighter, more opaque), a touch greener where it is deep.
  float milkOp = 1.0 - exp(-path * 11.0);
  vec3 milkA = mix(uMilk, uMilkDeep, smoothstep(0.25, 1.5, vdep));
  vec3 lightM = (sunC * (0.3 + 0.7 * max(L.y, 0.0)) + ambIrr) / PI;
  lightM = mix(lightM, vec3(dot(lightM, vec3(0.3, 0.55, 0.15))), 0.35);
  lightM *= 1.0 + clamp((dot(N, L) - L.y) * 3.0, -0.25, 0.25) * sunUp;   // ripples shade the milk gently
  vec3 milk = milkA * lightM + milkA * (0.045 * uNight) + lanternGlow * milkA * 0.6;
  Tr = vec3(0.86, 0.97, 0.97) * (1.0 - milkOp);
  under = refr * Tr + milk * milkOp;
  #endif

  // reflection (environment / sky), dimmed near the banks where trees and banks would be reflected
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 sky;
  #ifdef ENVMAP_TYPE_CUBE_UV
    #ifdef HK_SPRING
    sky = textureCubeUV(uEnvMap, R, 0.2).rgb * uEnvIntensity;
    #else
    sky = textureCubeUV(uEnvMap, R, 0.12).rgb * uEnvIntensity;
    #endif
  #else
    sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
  #endif
  float occ = mix(0.42, 1.0, smoothstep(0.4, 4.5, shore));
  float NdV = max(dot(N, V), 0.0);
  float F = (0.02 + 0.98 * pow(1.0 - NdV, 5.0)) * uReflect;

  // sun glints: a sharp GGX lobe on the detailed surface -> very bright HDR sparkles for the bloom/DOF to bokeh
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0);
  float FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float glint = D_GGX(NdH, 0.006 + dist * 0.00004) * FH * 0.25 / max(NdV, 0.1);
  float sheen = D_GGX(NdH, 0.2) * FH * 0.25 / max(NdV, 0.1);
  // sparse sparkles: hashed facets in flow-advected space that flash when they face the sun
  vec2 gp = (p - o0) * 9.0 + j0 * 31.0;
  vec2 gi = floor(gp), gf = fract(gp) - 0.5;
  float hsh = fract(sin(dot(gi, vec2(127.1, 311.7))) * 43758.5453);
  float hsh2 = fract(hsh * 13.37 + 0.11);
  vec2 jitter = vec2(hsh, hsh2) - 0.5;
  float px = max(length(fwidth(gp)), 0.02);
  float dot_ = smoothstep(0.16 + px, 0.0, length(gf - jitter * 0.6));
  float flick = pow(max(sin(uTime * (2.0 + hsh * 4.0) + hsh2 * 40.0), 0.0), 6.0);
  float lobe = D_GGX(NdH, 0.06) * FH;
  float sparkle = dot_ * flick * step(0.55, hsh2) * min(lobe * 0.6, 25.0) * w0;
  float gl = min(glint, 60.0) + sparkle * 6.0;
  vec3 sunSpec = sunC * (gl * uGlint * (1.0 + 2.0 * uNight) + sheen * 0.05);
  #ifdef HK_SPRING
  // no glitter field: a soft broad sheen and only a hint of the sharp lobe
  sunSpec = sunC * (min(glint, 20.0) * 0.035 + D_GGX(NdH, 0.3) * FH * 0.25 / max(NdV, 0.1) * 0.12);
  #endif

  // ---------------------------------------------------------------- foam
  float fn = (b0.a * w0 + b1.a * w1 - 0.5) * wn + 0.5;
  float fn2 = (d0.a * w0 + d1.a * w1 - 0.5) * wn + 0.5;
  float contact = (1.0 - smoothstep(0.0, 0.045 + 0.06 * fn2, vdep0)) * (0.45 + 0.55 * sN);
  float lap = 0.55 + 0.45 * sin(uTime * 1.6 - shore * 5.0 + fn * 5.0);
  float amt = contact * lap;
  amt = max(amt, wake * (0.55 + 0.45 * fn2));
  amt = max(amt, turb * (0.25 + 0.55 * fn2));
  float foam = smoothstep(1.0 - amt, 1.0 - amt + 0.3, fn) * step(0.002, amt);
  // bubbly breakup: fine noise + soft density so it reads as froth, not paint
  float bub = smoothstep(0.25, 0.75, fn2);
  foam *= mix(0.45, 0.9, bub);
  vec3 foamCol = vec3(0.92, 0.95, 0.96) * (sunC * max(dot(N, L), 0.0) * 0.9 + ambIrr) / PI;
  #ifdef HK_SPRING
  // no harsh foam lines: gentle white water only at the rapids, stones and cascade bases
  amt = max(wake * (0.4 + 0.4 * fn2), turb * (0.18 + 0.4 * fn2));
  amt = max(amt, churn * (0.7 + 0.5 * fn2));
  foam = smoothstep(1.0 - amt, 1.0 - amt + 0.35, fn) * step(0.002, amt) * mix(0.4, 0.8, bub);
  // creamy rim where the water meets stone/bank + a faint mineral line just inside it
  float rim = pow(1.0 - smoothstep(0.0, 0.09 + 0.03 * fn2, vdep0), 2.0);   // wide + soft: the depth buffer is half-res
  float mineral = smoothstep(0.06, 0.1, vdep0) * (1.0 - smoothstep(0.12, 0.18, vdep0)) * (0.5 + 0.5 * fn);
  vec3 cream = vec3(0.97, 0.95, 0.88) * (sunC * max(L.y, 0.15) * 0.9 + ambIrr) / PI;
  #endif

  // ---------------------------------------------------------------- compose
  vec3 col = mix(under, sky * occ, F) + sunSpec + lanternSpec;
  col = mix(col, foamCol, foam);
  float alpha = smoothstep(0.0, 0.045, vdep0);
  alpha = max(alpha, foam * smoothstep(0.0, 0.015, vdep0 + 0.01));
  #ifdef HK_SPRING
  col = mix(col, cream, clamp(rim * 0.5 + mineral * 0.16, 0.0, 1.0));
  alpha = max(alpha, rim * 0.35);
  #endif

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * wz * wz);
    #else
      float fogF = smoothstep(fogNear, fogFar, wz);
    #endif
    // the refracted image is already fogged by the pre-pass: fog only the rest
    float keep = (1.0 - F) * (1.0 - foam);
    vec3 bedPart = refr * Tr * keep;
    float tr = dot(Tr, vec3(0.3333)) * keep;
    col = bedPart + (col - bedPart) * (1.0 - fogF) + fogColor * fogF * (1.0 - tr);
  #endif

  gl_FragColor = vec4(col, alpha);
  #if WDEBUG == 1
    gl_FragColor = vec4(refr, 1.0);
  #elif WDEBUG == 2
    gl_FragColor = vec4(under, 1.0);
  #elif WDEBUG == 3
    gl_FragColor = vec4(path / 10.0, vdep, vdep0, 1.0);
  #elif WDEBUG == 4
    gl_FragColor = vec4(sky * occ * F + sunSpec, 1.0);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ module state
let ctxRef = null, material = null, mesh = null, leaves = null, rt = null;
const camSave = { mask: 0 };
const _size = new THREE.Vector2(), _clear = new THREE.Color(), _prevClear = new THREE.Color();
let frameNo = 0, lastEnv = undefined, pmrem = null;
const pmremCache = new WeakMap();
const rings = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -100, 0));
let nextRing = 1, ringIdx = 0;
const rnd = mulberry32(1234);
const isDev = typeof location !== 'undefined' && /dev\.html/.test(location.pathname);

function makeTarget(w, h) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true,
  });
  t.depthTexture = new THREE.DepthTexture(w, h);
  t.depthTexture.type = THREE.UnsignedIntType;
  t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.NearestFilter;
  return t;
}

export async function init(ctx) {
  ctxRef = ctx;
  const { scene, renderer } = ctx;
  causticShared();
  const waves = makeWaveTexture(256);
  rt = makeTarget(2, 2);
  const lanterns = ANCHORS.lanterns.map((l) => new THREE.Vector3(l.x, 1.15, l.z));
  material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    defines: { NUM_LANTERNS: Math.max(1, lanterns.length), WDEBUG: +(new URLSearchParams(location.search).get('wdbg') || 0), NUM_CHURN: 1, ...(IS_SPRING ? { HK_SPRING: '' } : {}) },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      tWaves: { value: null }, tRefr: { value: null }, tDepth: { value: null },
      uProjScale: { value: new THREE.Vector2(1, 1) }, uDepthParams: { value: new THREE.Vector2(-1, -0.2) }, uLogFar: { value: 1000 },
      uCamWorld: { value: new THREE.Matrix4() },
      uEnvMap: { value: null }, uEnvIntensity: { value: 1 },
      uSkyZenith: { value: new THREE.Color(0.45, 0.62, 0.85) }, uSkyHorizon: { value: new THREE.Color(0.75, 0.8, 0.85) },
      uAmbient: { value: new THREE.Color(0.6, 0.65, 0.75) },
      uAbsorb: { value: new THREE.Vector3(0.62, 0.13, 0.19) },
      uDeepColor: { value: new THREE.Color(0.02, 0.3, 0.23) },
      uScatter: { value: 0.5 },
      uRefract: { value: 0.9 },
      uReflect: { value: 0.6 },
      uGlint: { value: 1 },
      uCascades: { value: [new THREE.Vector4(0, 0, 1, 0)] },
      uMilk: { value: new THREE.Color('#8ccdc6') },        // lit milky turquoise (albedo, sRGB-ish target #9ed8d8)
      uMilkDeep: { value: new THREE.Color('#72c6b2') },    // a touch greener where deep
      uRings: { value: rings },
      uLanterns: { value: lanterns.length ? lanterns : [new THREE.Vector3(0, -100, 0)] },
      uLanternColor: { value: new THREE.Color(1.0, 0.55, 0.22).multiplyScalar(2.2) },
      tShadow: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowSize: { value: new THREE.Vector2(1024, 1024) },
      uShadowBias: { value: -0.0005 }, uHasShadow: { value: 0 },
    }]),
    fog: true, transparent: true, depthWrite: true, depthTest: true,
    extensions: { derivatives: true },
  });
  // shared refs (merge() clones, so re-attach the live objects)
  Object.assign(material.uniforms, {
    uTime: U.uTime, uWindDir: U.uWindDir, uWindStrength: U.uWindStrength, uCloud: U.uCloud,
    uSunDir: U.uSunDir, uSunColor: U.uSunColor, uNight: U.uNight,
  });
  material.uniforms.tWaves.value = waves;
  material.uniforms.uRings.value = rings;
  material.uniforms.uLanterns.value = lanterns.length ? lanterns : [new THREE.Vector3(0, -100, 0)];
  if (renderer.capabilities.logarithmicDepthBuffer) material.defines.REFR_LOGDEPTH = 1;

  mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.name = 'water';
  mesh.renderOrder = -1;   // first among transparents, so particles/fireflies above the surface blend over it
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  scene.add(mesh);

  leaves = IS_SPRING ? createPetals() : createLeaves(170);
  scene.add(leaves.mesh);
  if (IS_SPRING) {
    const cas = createCascades(waves, material.uniforms.uAmbient);
    scene.add(cas.group);
    material.uniforms.uCascades.value = cas.churn;
    material.defines.NUM_CHURN = cas.churn.length;
    water.cascades = cas.group;
  }

  Object.assign(water, { mesh, leaves, material, refractTarget: rt });

  if (isDev) devExtras(scene);
  refreshSceneInfo(scene);
}

// dev harness only: caustics + a pebble bed on the placeholder terrain so the water can be judged
function devExtras(scene) {
  const bedTex = loadTex('river_small_rocks', 'diff');
  scene.traverse((o) => {
    if (!o.isMesh || o === mesh || !o.material?.isMeshStandardMaterial || !o.geometry?.parameters?.widthSegments) return;
    const m = o.material;
    patchMaterial(m, 'devbed', (shader) => {
      shader.uniforms.hkDevBed = { value: bedTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 hkDevPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nhkDevPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 hkDevPos;\nuniform sampler2D hkDevBed;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{ float bed = 1.0 - smoothstep(-0.02, 0.3, hkDevPos.y);
  vec3 rk = texture2D(hkDevBed, hkDevPos.xz * 0.42).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, rk * vec3(0.9, 0.88, 0.8), bed); }`);
    });
    applyCaustics(m);
  });
}

function refreshSceneInfo(scene) {
  let amb = new THREE.Color(0, 0, 0), shadowLight = null, hemiFound = false;
  scene.traverse((o) => {
    if (!o.isLight) return;
    o.layers.enable(LAYER_REFRACT);   // lights must be visible to the refraction camera
    if (o.isHemisphereLight) { amb.add(_clear.copy(o.color).lerp(o.groundColor, 0.25).multiplyScalar(o.intensity)); hemiFound = true; }
    if (o.isAmbientLight) amb.add(_clear.copy(o.color).multiplyScalar(o.intensity));
    if (o.isDirectionalLight && o.castShadow && !shadowLight) shadowLight = o;
  });
  if (!hemiFound && amb.r + amb.g + amb.b === 0) amb.setRGB(0.5, 0.55, 0.65);
  material.uniforms.uAmbient.value.copy(amb);
  water.shadowLight = shadowLight;
}

function updateEnv(scene, renderer) {
  const e = scene.environment || null;
  if (e === lastEnv) return;
  lastEnv = e;
  const d = material.defines;
  delete d.ENVMAP_TYPE_CUBE_UV; delete d.CUBEUV_TEXEL_WIDTH; delete d.CUBEUV_TEXEL_HEIGHT; delete d.CUBEUV_MAX_MIP;
  let tex = null;
  if (e) {
    if (e.mapping === THREE.CubeUVReflectionMapping) tex = e;
    else {
      tex = pmremCache.get(e);
      if (!tex) {
        pmrem = pmrem || new THREE.PMREMGenerator(renderer);
        const r = e.isCubeTexture ? pmrem.fromCubemap(e) : pmrem.fromEquirectangular(e);
        tex = r.texture; pmremCache.set(e, tex);
      }
    }
  }
  if (tex && tex.image && tex.image.height) {
    const h = tex.image.height, maxMip = Math.log2(h) - 2;
    d.ENVMAP_TYPE_CUBE_UV = 1;
    d.CUBEUV_TEXEL_WIDTH = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
    d.CUBEUV_TEXEL_HEIGHT = 1 / h;
    d.CUBEUV_MAX_MIP = maxMip.toFixed(1);
    material.uniforms.uEnvMap.value = tex;
  } else material.uniforms.uEnvMap.value = null;
  material.needsUpdate = true;
}

export function update(dt, t, ctx = ctxRef) {
  if (!material) return;
  frameNo++;
  leaves.update(dt, t);
  leaves.mesh.material.emissiveIntensity = (IS_SPRING ? 0.3 : 0.28) * (1 - U.uNight.value);
  // occasional rings in the pond (koi kissing the surface, drips)
  const now = U.uTime.value;
  if (now > nextRing || now < nextRing - 20) {
    const s = S_POND + (rnd() - 0.5) * 13;
    const p = streamPoint(s);
    const off = (rnd() * 2 - 1) * Math.max(0.5, p.hw - 1.5);
    rings[ringIdx].set(p.x + p.nx * off, p.z + p.nz * off, now, 0.5 + rnd() * 0.6);
    ringIdx = (ringIdx + 1) % 4;
    nextRing = now + 1.0 + rnd() * 3.0;
  }
  if (frameNo % 45 === 1) refreshSceneInfo(ctx.scene);
}

export function beforeRender(ctx = ctxRef) {
  if (!material) return;
  const { renderer, scene, camera } = ctx;
  updateEnv(scene, renderer);

  // sky colours for the env-less fallback
  const u = material.uniforms;
  const fogC = scene.fog ? scene.fog.color : null;
  if (scene.background && scene.background.isColor) {
    u.uSkyHorizon.value.copy(fogC || scene.background).lerp(scene.background, 0.3);
    u.uSkyZenith.value.copy(scene.background).multiply(_clear.setRGB(0.78, 0.88, 1.05));
  } else if (fogC) {
    u.uSkyHorizon.value.copy(fogC);
    u.uSkyZenith.value.copy(fogC).multiply(_clear.setRGB(0.75, 0.85, 1.05));
  }

  // shadow map of the key light (RGBA-packed PCF maps only)
  const sl = water.shadowLight;
  if (sl && sl.shadow && sl.shadow.map && renderer.shadowMap.enabled && renderer.shadowMap.type !== THREE.VSMShadowMap) {
    u.tShadow.value = sl.shadow.map.texture;
    u.uShadowMatrix.value.copy(sl.shadow.matrix);
    u.uShadowSize.value.copy(sl.shadow.mapSize);
    u.uShadowBias.value = sl.shadow.bias - 0.0004;
    u.uHasShadow.value = 1;
  } else u.uHasShadow.value = 0;

  // ---- refraction pre-pass: only LAYER_REFRACT, half resolution, HalfFloat colour + depth
  renderer.getDrawingBufferSize(_size);
  const w = Math.max(2, Math.round(_size.x * REFR_SCALE)), h = Math.max(2, Math.round(_size.y * REFR_SCALE));
  if (rt.width !== w || rt.height !== h) {
    rt.dispose(); rt.depthTexture.dispose();
    rt = makeTarget(w, h); water.refractTarget = rt;
  }
  const prevRT = renderer.getRenderTarget();
  const prevFace = renderer.getActiveCubeFace(), prevMip = renderer.getActiveMipmapLevel();
  const prevAuto = renderer.autoClear;
  renderer.getClearColor(_prevClear); const prevAlpha = renderer.getClearAlpha();
  const sm = renderer.shadowMap, prevSAU = sm.autoUpdate, prevSNU = sm.needsUpdate;
  camSave.mask = camera.layers.mask;
  const prevLeaves = leaves.mesh.visible, prevMesh = mesh.visible;
  mesh.visible = false; leaves.mesh.visible = false;
  camera.layers.set(LAYER_REFRACT);
  sm.autoUpdate = false; sm.needsUpdate = false;           // reuse this frame's/last frame's shadow maps
  renderer.setRenderTarget(rt);
  renderer.setClearColor(fogC || _clear.setRGB(0.6, 0.7, 0.75), 1);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  // restore
  camera.layers.mask = camSave.mask;
  sm.autoUpdate = prevSAU; sm.needsUpdate = prevSNU;
  renderer.setRenderTarget(prevRT, prevFace, prevMip);
  renderer.setClearColor(_prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  mesh.visible = prevMesh; leaves.mesh.visible = prevLeaves;

  u.tRefr.value = rt.texture;
  u.tDepth.value = rt.depthTexture;
  const pm = camera.projectionMatrix.elements;
  u.uProjScale.value.set(pm[0], pm[5]);
  u.uDepthParams.value.set(pm[10], pm[14]);
  u.uLogFar.value = camera.far;
  u.uCamWorld.value.copy(camera.matrixWorld);
}

export function setPreset(name) {
  if (!material) return;
  const u = material.uniforms;
  // a touch more glitter at golden hour, calmer reflections at night
  u.uGlint.value = name === 'golden' ? 1.25 : name === 'night' ? 1.0 : name === 'blue' ? 0.8 : 1.0;
  if (IS_SPRING) u.uGlint.value = 0;   // spring uses its own soft sheen (see HK_SPRING)
}
