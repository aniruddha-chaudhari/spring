// water/caustics.js — animated caustics on anything under the water surface (bed, rocks, stones, posts).
// applyCaustics(material) patches a Mesh{Standard,Physical,Lambert,Phong}Material; custom shaders can use
// CAUSTICS_GLSL + causticUniforms() and call hkCaustics(worldPos) to get an RGB multiplier for direct sunlight.
import { U, WATER_Y, patchMaterial, IS_SPRING } from '../world.js';
import { makeCausticTexture, makeWaterMask, MASK_HALF } from './textures.js';

let shared = null;
export function causticShared() {
  if (shared) return shared;
  const c = makeCausticTexture(512);
  shared = {
    caustic: c.tex,
    mask: makeWaterMask(512),
    uniforms: {
      hkcTex: { value: c.tex },
      hkcMask: { value: null },
      hkcNorm: { value: 1 / c.minMean },
      hkcStrength: { value: IS_SPRING ? 0.28 : 1 },   // milky spring water scatters most of the focus away
      hkcBlur: { value: IS_SPRING ? 1.8 : 0 },
      hkcTime: U.uTime, hkcSunDir: U.uSunDir, hkcSunColor: U.uSunColor, hkcNight: U.uNight,
    },
  };
  shared.uniforms.hkcMask.value = shared.mask;
  return shared;
}
// Shared uniform refs (merge into a ShaderMaterial's uniforms).
export function causticUniforms() { return causticShared().uniforms; }

const F = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
export const CAUSTICS_GLSL = /* glsl */`
uniform sampler2D hkcTex;
uniform sampler2D hkcMask;
uniform float hkcNorm;
uniform float hkcStrength;
uniform float hkcBlur;
uniform float hkcTime;
uniform vec3 hkcSunDir;
uniform vec3 hkcSunColor;
uniform float hkcNight;
float hkcPhaseSample(vec2 uv, vec2 chroma, float bias, out vec3 rgb) {
  rgb = vec3(texture2D(hkcTex, uv + chroma, bias).r, texture2D(hkcTex, uv, bias).r, texture2D(hkcTex, uv - chroma, bias).r);
  return rgb.g;
}
// RGB multiplier for DIRECT sun light at world position wp (1.0 = unchanged).
vec3 hkCaustics(vec3 wp) {
  float below = ${F(WATER_Y)} - wp.y;
  if (below <= 0.0) return vec3(1.0);
  vec4 m = texture2D(hkcMask, wp.xz / ${F(MASK_HALF * 2)} + 0.5);
  float edge = (m.r - 0.5) * 8.0;                       // metres inside the water's edge
  float sunK = clamp(dot(hkcSunColor, vec3(0.3, 0.55, 0.15)) * 0.42, 0.0, 1.25) * (1.0 - hkcNight)
             * smoothstep(0.02, 0.25, hkcSunDir.y);
  float fade = hkcStrength * sunK * smoothstep(-0.15, 0.5, edge) * smoothstep(0.0, 0.1, below) * exp(-below * 0.38);
  if (fade < 0.003) return vec3(1.0);
  vec2 flow = (m.gb - 0.5) * 8.0;
  vec3 L = normalize(hkcSunDir);
  vec3 rs = refract(-L, vec3(0.0, 1.0, 0.0), 0.75);   // refracted sun ray (pointing down)
  vec2 q = wp.xz + rs.xz / max(-rs.y, 0.3) * below;   // where that ray crossed the surface
  const float sc = 1.0 / 1.8;                          // tile size (m); softer deeper down via LOD bias
  float bias = clamp(below * 1.6 - 0.2, 0.0, 3.0) + hkcBlur;
  float T = 2.2;
  float tp = hkcTime / T;
  float ph0 = fract(tp), ph1 = fract(tp + 0.5);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0), w1 = 1.0 - w0;
  vec2 o0 = flow * (ph0 - 0.5) * T, o1 = flow * (ph1 - 0.5) * T;
  vec2 j0 = vec2(0.31, 0.17) * floor(tp), j1 = vec2(0.31, 0.17) * floor(tp + 0.5) + 0.5;
  vec2 dA = vec2(0.021, 0.013) * hkcTime, dB = vec2(-0.017, 0.024) * hkcTime;
  vec2 ch = vec2(0.004, 0.0022) * (1.0 + below * 1.2);
  vec3 a0, a1, b0, b1;
  hkcPhaseSample((q - o0) * sc + dA + j0, ch, bias, a0);
  hkcPhaseSample((q - o1) * sc + dA + j1, ch, bias, a1);
  hkcPhaseSample((q - o0) * sc * 1.43 + dB + j0.yx + 0.37, ch * 1.43, bias, b0);
  hkcPhaseSample((q - o1) * sc * 1.43 + dB + j1.yx + 0.37, ch * 1.43, bias, b1);
  vec3 a = a0 * w0 + a1 * w1, b = b0 * w0 + b1 * w1;
  vec3 c = min(a, b) * hkcNorm;                        // mean ~1, bright webs up to ~5
  c = pow(c, vec3(1.25));
  c = c / (1.0 + c * 0.22) * 1.3;                     // soft-clip the peaks (no HDR glitter on the bed)
  return mix(vec3(1.0), c, fade);
}`;

export function applyCaustics(material) {
  const u = causticUniforms();
  return patchMaterial(material, 'caustics', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hkcWorldPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 hkcW = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  hkcW = batchingMatrix * hkcW;
  #endif
  #ifdef USE_INSTANCING
  hkcW = instanceMatrix * hkcW;
  #endif
  hkcWorldPos = (modelMatrix * hkcW).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 hkcWorldPos;\n${CAUSTICS_GLSL}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= hkCaustics(hkcWorldPos);');
  });
}
