// vegetation/shared.js — foliage material patches, geometry builder and small helpers shared by all plant modules.
import * as THREE from 'three';
import { U, WIND_GLSL, patchMaterial, applyCloudShadows, groundHeight } from '../world.js';

// ---------------------------------------------------------------- colours
const _c = new THREE.Color();
// sRGB hex -> linear [r,g,b]
export function lin(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
export function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function mulc(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

// ---------------------------------------------------------------- height cache (fast bilinear groundHeight for dense scatter)
export function makeHeightCache(half = 52, step = 0.4) {
  const n = Math.round((half * 2) / step) + 1;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = groundHeight(-half + i * step, -half + j * step);
  return function heightAt(x, z) {
    const fx = (x + half) / step, fz = (z + half) / step;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return groundHeight(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * v;
  };
}

// ---------------------------------------------------------------- geometry builder
// Every vertex carries: position, normal, uv, color (linear), aWind (baseX, baseZ, sway metres, phase), aLeaf (flutter, flutterPhase, translucency, -)
export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.l = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(p, n, u, v, col, wind, leaf) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v);
    this.c.push(col[0], col[1], col[2]); this.w.push(wind[0], wind[1], wind[2], wind[3]);
    this.l.push(leaf ? leaf[0] : 0, leaf ? leaf[1] : 0, leaf ? leaf[2] : 0, leaf ? leaf[3] : 0);
    return this.count - 1;
  }
  // append another builder; uvFn(u, v) optionally remaps its uvs; colMul multiplies its colours
  append(o, uvFn = null, colMul = null) {
    const off = this.count;
    for (const k of ['p', 'n', 'w', 'l']) for (let i = 0; i < o[k].length; i++) this[k].push(o[k][i]);
    for (let i = 0; i < o.uv.length; i += 2) { if (uvFn) { const [u, v] = uvFn(o.uv[i], o.uv[i + 1]); this.uv.push(u, v); } else this.uv.push(o.uv[i], o.uv[i + 1]); }
    for (let i = 0; i < o.c.length; i++) this.c.push(colMul ? o.c[i] * colMul[i % 3] : o.c[i]);
    for (let i = 0; i < o.i.length; i++) this.i.push(o.i[i] + off);
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.w, 4));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.l, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------- GLSL
// Sway for world-space merged geometry (HK_INSTANCED: local geometry in an InstancedMesh, base = instance origin).
export const SWAY_GLSL = /* glsl */`
attribute vec4 aWind;
attribute vec4 aLeaf;
varying float vHkTransl;
varying float vHkOuter;
vec3 hkSway(vec3 p, vec2 base, float w, float phase) {
  float g = windGust(base);
  float s = uWindStrength;
  float osc = sin(uTime * 1.21 + phase + dot(p, vec3(0.31, 0.17, 0.27))) * 0.62
            + sin(uTime * 2.33 + phase * 1.7 + p.y * 0.45) * 0.38;
  vec2 o = uWindDir * w * s * (0.12 + 0.62 * g + 0.26 * osc * (0.45 + g));
  o += vec2(-uWindDir.y, uWindDir.x) * w * s * 0.10 * sin(uTime * 0.93 + phase * 2.1 + p.x * 0.2);
  vec3 off = vec3(o.x, -dot(o, o) * 0.35, o.y);
  float fl = aLeaf.x * s * (0.3 + 0.9 * g);
  float ph = aLeaf.y;
  off += vec3(sin(uTime * 6.3 + ph), sin(uTime * 7.7 + ph * 1.31) * 1.3, sin(uTime * 5.1 + ph * 0.71)) * fl * 0.045;
  return off;
}`;

const SWAY_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
vHkTransl = aLeaf.z;
vHkOuter = aLeaf.w;
#ifdef HK_INSTANCED
  vec4 hkBase4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float hkPh = aWind.w + fract(sin(dot(hkBase4.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
  mat3 hkIm = mat3(modelMatrix) * mat3(instanceMatrix);
  vec3 hkWp = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  transformed += inverse(hkIm) * hkSway(hkWp, hkBase4.xz, aWind.z, hkPh);
#else
  transformed += hkSway(transformed, aWind.xy, aWind.z, aWind.w);
#endif
`;

// Physically-based direct light + wrap diffuse + translucency (light through leaves when backlit). Shadowed like any direct light.
export const FOLIAGE_LIGHT_GLSL = /* glsl */`
uniform float hkWrap;
uniform float hkTranslK;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying float vHkTransl;
varying float vHkOuter;
void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction );
  float wrapD = max( ( ndl + hkWrap ) / ( 1.0 + hkWrap ), 0.0 );
  reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseColor );
  reflectedLight.directSpecular += saturate( ndl ) * directLight.color * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ) * 0.5;
  float back = saturate( dot( geometryViewDir, -directLight.direction ) );
  float tr = vHkTransl * hkTranslK * ( pow( back, 5.0 ) * 2.2 + back * 0.35 + 0.08 ) * ( 0.35 + 0.65 * saturate( 0.5 - 0.5 * ndl ) );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * sqrt( max( material.diffuseColor, vec3( 0.0 ) ) ) * tr;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Foliage
`;
// Light scattered through the outer leaves of a crown even where the shadow map says "shadowed" (GoT-style glow).
export const FOLIAGE_GLOW_GLSL = /* glsl */`
{
  vec3 hkL = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  float hkBack = saturate( dot( normalize( vViewPosition ), -hkL ) );
  float hkG = vHkOuter * vHkTransl * hkTranslK * ( pow( hkBack, 6.0 ) * 0.9 + hkBack * 0.08 ) * smoothstep( -0.05, 0.12, uSunDir.y );
  reflectedLight.directDiffuse += uSunColor * diffuseColor.rgb * sqrt( max( diffuseColor.rgb, vec3( 0.0 ) ) ) * hkG * 0.6;
}
`;

// Guard the final colour of foliage: drop NaN/Inf and cap the brightness so a single blade or leaf can never
// produce an HDR pinpoint (bloom + depth of field turn those into flashing orbs). Inserted before <opaque_fragment>.
export const FOLIAGE_SANITIZE = /* glsl */`
if ( any( isnan( outgoingLight ) ) || any( isinf( outgoingLight ) ) ) outgoingLight = vec3( 0.0 );
outgoingLight = min( outgoingLight, vec3( 2.2 ) );
#include <opaque_fragment>`;

export const NORMAL_NOFLIP = /* glsl */`
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vNormal );
vec3 nonPerturbedNormal = normal;
`;

// Alpha-to-coverage friendly alpha test: sharpen with fwidth and keep coverage at distance (mip levels thin alpha out).
const ALPHA_A2C = /* glsl */`
#ifdef USE_ALPHATEST
  #ifdef USE_MAP
  { vec2 hkd = fwidth( vMapUv ) * hkTexSize; float hkLod = max( 0.0, log2( max( max( hkd.x, hkd.y ), 1e-5 ) ) ); diffuseColor.a *= 1.0 + hkLod * 0.32; }
  #endif
  diffuseColor.a = clamp( ( diffuseColor.a - alphaTest ) / max( fwidth( diffuseColor.a ), 1e-4 ) + 0.5, 0.0, 1.0 );
  if ( diffuseColor.a < 0.02 ) discard;
#endif
`;

// Patch a MeshStandardMaterial into a foliage material.
// opts: { sway: true|false, instanced, wrap, transl, a2c, texSize, extraVertexPars, extraBegin }
export function foliagePatch(material, opts = {}) {
  const { sway = true, instanced = false, wrap = 0.5, transl = 1, a2c = !!material.alphaTest, texSize = 1024, key = '' } = opts;
  material.userData.hkUniforms = { hkWrap: { value: wrap }, hkTranslK: { value: transl }, hkTexSize: { value: new THREE.Vector2(texSize, texSize) } };
  if (instanced) material.defines = { ...(material.defines || {}), HK_INSTANCED: '' };
  if (a2c) material.alphaToCoverage = true;
  patchMaterial(material, 'foliage' + key + (sway ? 's' : '') + (instanced ? 'i' : '') + (a2c ? 'a' : ''), (shader) => {
    Object.assign(shader.uniforms, material.userData.hkUniforms);
    shader.uniforms.uSunDir = U.uSunDir; shader.uniforms.uSunColor = U.uSunColor;
    shader.uniforms.uTime = U.uTime; shader.uniforms.uWindDir = U.uWindDir; shader.uniforms.uWindStrength = U.uWindStrength;
    let vs = shader.vertexShader;
    if (sway) {
      vs = vs.replace('#include <common>', `#include <common>\n${WIND_GLSL}\n${SWAY_GLSL}\n${opts.extraVertexPars || ''}`)
        .replace('#include <begin_vertex>', SWAY_BEGIN + (opts.extraBegin || ''));
    } else {
      vs = vs.replace('#include <common>', `#include <common>\nattribute vec4 aLeaf;\nvarying float vHkTransl;\n${opts.extraVertexPars || ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvHkTransl = aLeaf.z;\n${opts.extraBegin || ''}`);
    }
    shader.vertexShader = vs;
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec2 hkTexSize;\n${opts.extraFragPars || ''}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${FOLIAGE_LIGHT_GLSL}`)
      .replace('#include <normal_fragment_begin>', NORMAL_NOFLIP)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FOLIAGE_GLOW_GLSL);
    fs = fs.replace('#include <opaque_fragment>', FOLIAGE_SANITIZE);
    if (a2c) fs = fs.replace('#include <alphatest_fragment>', ALPHA_A2C).replace('#include <opaque_fragment>', 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );');
    if (opts.extraColor) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${opts.extraColor}`);
    shader.fragmentShader = fs;
  });
  applyCloudShadows(material);
  return material;
}

// Depth material for shadow casting that sways like the foliage material (and alpha-tests the map).
export function swayDepthMaterial(map, alphaTest, { instanced = false } = {}) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map || null, alphaTest: map ? alphaTest : 0, side: THREE.DoubleSide });
  if (instanced) m.defines = { HK_INSTANCED: '' };
  patchMaterial(m, 'hkdepth' + (instanced ? 'i' : ''), (shader) => {
    shader.uniforms.uTime = U.uTime; shader.uniforms.uWindDir = U.uWindDir; shader.uniforms.uWindStrength = U.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\n${SWAY_GLSL}`)
      .replace('#include <begin_vertex>', SWAY_BEGIN);
  });
  return m;
}

// Standard foliage material (vertex colours * atlas), double sided, A2C.
export function leafMaterial(map, { alphaTest = 0.42, wrap = 0.55, transl = 1, instanced = false, roughness = 0.85, key = '' } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest, side: THREE.DoubleSide, roughness, metalness: 0 });
  foliagePatch(m, { instanced, wrap, transl, texSize: map?.image?.width || 1024, key });
  return m;
}

// Bark material with sway (trunk and branches bend with the crown).
export function barkMaterial(diff, nor, { instanced = false, color = '#ffffff' } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95, metalness: 0, color, vertexColors: true });
  if (instanced) m.defines = { HK_INSTANCED: '' };
  patchMaterial(m, 'bark' + (instanced ? 'i' : ''), (shader) => {
    shader.uniforms.uTime = U.uTime; shader.uniforms.uWindDir = U.uWindDir; shader.uniforms.uWindStrength = U.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\n${SWAY_GLSL}`)
      .replace('#include <begin_vertex>', SWAY_BEGIN);
  });
  applyCloudShadows(m);
  return m;
}

// ---------------------------------------------------------------- vector helpers
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// orthonormal basis around a direction
export function basis(d) {
  const up = Math.abs(d.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0);
  const a = v3().crossVectors(d, up).normalize();
  const b = v3().crossVectors(a, d).normalize();
  return [a, b];
}

// ---------------------------------------------------------------- keep the default views open
// True if a tree standing at (x, y, z) with height h would appear in the FOREGROUND (between the camera and the
// glade) of the default main camera (render.js) or the dev harness camera.
const VIEWS = [
  { pos: [50, 23, 57], fov: 28 },   // render.js default
  { pos: [42, 34, 48], fov: 32 },   // dev.js default
].map(({ pos, fov }) => {
  const c = new THREE.PerspectiveCamera(fov, 16 / 9, 0.5, 2000);
  c.position.set(...pos); c.lookAt(0, 0.8, 0); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return { c, d: Math.hypot(...pos) };
});
const _pv = new THREE.Vector3();
export function inForegroundView(x, y, z, h, margin = 0.12) {
  for (const { c, d } of VIEWS) {
    const dist = Math.hypot(x - c.position.x, z - c.position.z);
    if (dist > d * 0.82) continue;
    for (const k of [1, 0.6, 0.3]) {
      _pv.set(x, y + h * k, z).project(c);
      if (_pv.z < 1 && Math.abs(_pv.x) < 1 + margin && _pv.y > -1 - margin && _pv.y < 1) return true;
    }
  }
  return false;
}
