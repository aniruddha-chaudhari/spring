// life/air.js — golden-hour motes, fireflies, low mist hugging the stream and far valley haze.
// All GPU-animated: one Points draw each for motes/fireflies, one merged mesh each for mist and haze.
import * as THREE from 'three';
import { U, WATER_Y, mulberry32, streamPoint, S_RAPIDS, S_STONES, IS_SPRING } from '../world.js';
import { G, NEAR_HALF, NEAR_N, FAR_HALF, FAR_N, groundAt, surfaceAt, W, TAU, OUT_GLSL, NOISE_GLSL } from './common.js';

const _size = new THREE.Vector2();
function pointsResolution(uniforms) {
  return (renderer) => { renderer.getDrawingBufferSize(_size); uniforms.uResY.value = _size.y; };
}

// ---------------------------------------------------------------- motes (pollen / dust in the sunbeams)
// A subtle sprinkle over the water only (motes over the grass read as flashing, so the land box is disabled:
// nFocus = 0). Brightness is masked by drifting sun-aligned "beams".
const MOTE_BOX = 13;
function makeMotes(rnd) {
  const nFocus = 0, nWater = 50, n = nFocus + nWater;
  const pos = new Float32Array(n * 3), rr = new Float32Array(n * 4), kind = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i < nFocus) {   // local offset in the focus box; y = height above ground
      pos[i * 3] = (rnd() * 2 - 1) * MOTE_BOX; pos[i * 3 + 1] = 0.3 + Math.pow(rnd(), 1.4) * 5.5; pos[i * 3 + 2] = (rnd() * 2 - 1) * MOTE_BOX;
    } else {            // fixed over the stream / pond
      const s = S_RAPIDS - 10 + rnd() * (S_STONES - S_RAPIDS + 18), p = streamPoint(s), o = (rnd() * 2 - 1) * p.hw * 0.9;
      pos[i * 3] = p.x + p.nx * o; pos[i * 3 + 1] = WATER_Y + 0.25 + Math.pow(rnd(), 1.5) * 2.5; pos[i * 3 + 2] = p.z + p.nz * o;
      kind[i] = 1;
    }
    rr[i * 4] = rnd(); rr[i * 4 + 1] = rnd(); rr[i * 4 + 2] = rnd(); rr[i * 4 + 3] = 0.6 + rnd() * 2.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rr, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const uniforms = {
    uTime: U.uTime, uWindDir: U.uWindDir, uSunDir: U.uSunDir, uAmt: { value: 1 }, uColor: { value: new THREE.Color() }, uResY: { value: 900 },
    uFocus: { value: new THREE.Vector3() }, uHeight: { value: G.nearTex },
    uLand: { value: IS_SPRING ? 0 : 1 },   // spring: only the motes over the water
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aRnd; attribute float aKind;
      uniform float uTime; uniform vec2 uWindDir; uniform vec3 uSunDir; uniform float uAmt; uniform float uResY;
      uniform vec3 uFocus; uniform sampler2D uHeight; uniform float uLand;
      varying float vA;
      ${NOISE_GLSL}
      void main() {
        vec3 p = position;
        float ph = aRnd.x * 6.2831, sp = 0.6 + aRnd.y, edge = 1.0;
        vec2 drift = uWindDir * uTime * 0.18 * sp;
        float tt = uTime * 0.25 * sp;
        vec3 wob = vec3(sin(tt * 1.3 + ph), sin(tt * 0.9 + ph * 2.0) * 0.4, cos(tt * 1.1 + ph * 1.7)) * 0.6;
        if (aKind < 0.5) {
          // world-stable inside a box around the focus point; wraps (faded) at the box edge
          vec2 rel = mod(p.xz + drift - uFocus.xz + ${MOTE_BOX.toFixed(1)}, ${(2 * MOTE_BOX).toFixed(1)}) - ${MOTE_BOX.toFixed(1)};
          edge = smoothstep(${MOTE_BOX.toFixed(1)}, ${(MOTE_BOX * 0.6).toFixed(1)}, max(abs(rel.x), abs(rel.y)));
          vec2 xz = uFocus.xz + rel;
          float gh = max(texture2D(uHeight, (xz + ${NEAR_HALF.toFixed(1)} + 0.5) / ${NEAR_N.toFixed(1)}).r, ${WATER_Y.toFixed(2)});
          p = vec3(xz.x, gh + p.y, xz.y);
        } else {
          float d = mod(uTime * 0.15 * sp + aRnd.x * 10.0, 10.0) - 5.0;
          p.xz += uWindDir * d; edge = smoothstep(5.0, 3.5, abs(d));
        }
        p += wob;
        // sun shafts: bands aligned with the sun's horizontal direction, slowly drifting
        vec2 sh = normalize(uSunDir.xz + 1e-4), pp = vec2(-sh.y, sh.x);
        float beam = lf_noise(vec2(dot(p.xz, pp) * 0.16 + p.y * 0.05 + uTime * 0.02, dot(p.xz, sh) * 0.015));
        beam = mix(0.06, 1.0, smoothstep(0.52, 0.78, beam));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = 0.04 * (0.5 + aRnd.z) * projectionMatrix[1][1] * uResY * 0.5 / -mv.z;
        float tw = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * aRnd.w + ph * 5.0), 4.0);
        vec3 V = normalize(p - cameraPosition);
        float fwd = 0.3 + 2.0 * pow(max(dot(V, uSunDir), 0.0), 3.0);           // forward scattering toward the sun
        vA = uAmt * tw * fwd * beam * edge * min(1.0, (px * px) / 2.25) * (aKind < 0.5 ? uLand : 1.0);
        gl_PointSize = max(px, 1.5) * 3.0;
        if (uAmt < 0.002 || vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying float vA;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 6.0) * vA;
        gl_FragColor = vec4(uColor * 1.8 * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 45; pts.name = 'life-motes';
  pts.onBeforeRender = pointsResolution(uniforms);
  return { obj: pts, u: uniforms };
}

// ---------------------------------------------------------------- fireflies
function makeFireflies(rnd) {
  const n = 120, pos = new Float32Array(n * 3), rr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = S_RAPIDS - 14 + rnd() * (S_STONES - S_RAPIDS + 26), p = streamPoint(s), o = (rnd() * 2 - 1) * (p.hw + 4);
    const x = p.x + p.nx * o, z = p.z + p.nz * o;
    pos[i * 3] = x; pos[i * 3 + 1] = surfaceAt(x, z) + 0.25 + Math.pow(rnd(), 1.4) * 1.6; pos[i * 3 + 2] = z;
    rr[i * 4] = rnd(); rr[i * 4 + 1] = rnd(); rr[i * 4 + 2] = rnd(); rr[i * 4 + 3] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rr, 4));
  const uniforms = { uTime: U.uTime, uAmt: { value: 0 }, uResY: { value: 900 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aRnd;
      uniform float uTime; uniform float uAmt; uniform float uResY;
      varying float vA; varying float vCore;
      void main() {
        float ph = aRnd.x * 6.2831, sp = 0.5 + aRnd.y;
        vec3 p = position + vec3(sin(uTime * 0.21 * sp + ph) * 1.4 + sin(uTime * 0.53 + ph * 3.0) * 0.3,
                                 sin(uTime * 0.37 * sp + ph * 1.3) * 0.35,
                                 cos(uTime * 0.17 * sp + ph * 0.7) * 1.4 + cos(uTime * 0.61 + ph) * 0.3);
        float period = 2.4 + aRnd.z * 3.6;
        float f = fract(uTime / period + aRnd.w);
        float flash = smoothstep(0.0, 0.05, f) * smoothstep(0.34, 0.1, f);
        if (aRnd.y > 0.6) flash = max(flash, smoothstep(0.42, 0.46, f) * smoothstep(0.62, 0.48, f));  // double blinkers
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = 0.09 * projectionMatrix[1][1] * uResY * 0.5 / -mv.z;
        vA = uAmt * (0.06 + flash) * min(1.0, (px * px) / 2.25);
        vCore = flash;
        gl_PointSize = max(px, 1.5) * (5.0 + 3.0 * flash);
        if (uAmt < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vCore;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 26.0), halo = exp(-r2 * 5.0) * 0.35;
        vec3 col = vec3(0.55, 1.0, 0.18) * (core * 3.2 + halo * 1.1) + vec3(0.85, 1.0, 0.5) * core * vCore * 1.2;
        gl_FragColor = vec4(col * vA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 46; pts.name = 'life-fireflies';
  pts.onBeforeRender = pointsResolution(uniforms);
  return { obj: pts, u: uniforms };
}

// ---------------------------------------------------------------- mist: stacked terrain-following sheets
const SHEET_VS = /* glsl */`
  attribute float aLayer;
  varying vec3 vW; varying float vL;
  #include <fog_pars_vertex>
  void main() {
    vL = aLayer;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
function makeMist() {
  // smoothed surface (max(ground, water)) so sheets glide over bumps instead of following every one
  const n = NEAR_N, base = new Float32Array(n * n), sm = new Float32Array(n * n), R = 3;
  for (let k = 0; k < n * n; k++) base[k] = Math.max(G.h[k], WATER_Y);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      s += base[jj * n + ii]; c++;
    }
    sm[j * n + i] = Math.max(s / c, base[j * n + i] - 0.25);
  }
  const smAt = (x, z) => {
    const gx = Math.min(Math.max(x + NEAR_HALF, 0), n - 1.001), gz = Math.min(Math.max(z + NEAR_HALF, 0), n - 1.001);
    const i = gx | 0, j = gz | 0, u = gx - i, v = gz - j, k = j * n + i;
    return (sm[k] * (1 - u) + sm[k + 1] * u) * (1 - v) + (sm[k + n] * (1 - u) + sm[k + n + 1] * u) * v;
  };
  const OFF = [0.1, 0.26, 0.45, 0.68, 0.95, 1.3, 1.75];
  const SEG = 84, SIZE = 120, geos = [];
  for (let l = 0; l < OFF.length; l++) {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, smAt(p.getX(i), p.getZ(i)) + OFF[l]);
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(l / (OFF.length - 1)), 1));
    geos.push(g);
  }
  const geo = mergeSimple(geos);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uHeight: { value: G.nearTex }, uAmt: { value: 0.3 }, uColor: { value: new THREE.Color() }, uSunTint: { value: new THREE.Color() },
  }]);
  Object.assign(uniforms, { uTime: U.uTime, uWindDir: U.uWindDir, uSunDir: U.uSunDir });
  uniforms.uHeight.value = G.nearTex;
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: true,
    vertexShader: SHEET_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D uHeight; uniform float uAmt; uniform vec3 uColor; uniform vec3 uSunTint;
      uniform float uTime; uniform vec2 uWindDir; uniform vec3 uSunDir;
      varying vec3 vW; varying float vL;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        vec4 hm = texture2D(uHeight, (vW.xz + ${NEAR_HALF.toFixed(1)} + 0.5) / ${NEAR_N.toFixed(1)});
        float hgt = vW.y - max(hm.r, ${WATER_Y.toFixed(2)});
        if (hgt <= 0.0) discard;
        float soft = smoothstep(0.0, 0.4, hgt);
        // hug the water and the low hollows: ~0 a few metres up the banks and slopes
        float nearWater = smoothstep(4.0, -0.8, hm.g);
        float hollow = smoothstep(1.1, 0.35, hm.r - ${WATER_Y.toFixed(2)}) * smoothstep(9.0, 2.0, hm.g);
        float mask = max(nearWater, hollow * 0.6) * (1.0 - 0.75 * vL);
        // wind-aligned frame: wisps stretched along the breeze, drifting with it, domain-warped so they curl
        vec2 wd = uWindDir, wp = vec2(-wd.y, wd.x);
        vec2 xz = vec2(dot(vW.xz, wd), dot(vW.xz, wp));
        vec2 q = vec2(xz.x * 0.05 - uTime * 0.035, xz.y * 0.11) + vL * 4.3;
        vec2 warp = vec2(lf_fbm(q * 0.7 + 3.1 + uTime * 0.01), lf_fbm(q * 0.7 - 5.7 - uTime * 0.012)) - 0.5;
        q += warp * 1.6;
        float n = lf_fbm(q) * 0.7 + lf_fbm(q * 2.7 + 11.0 - uTime * 0.02) * 0.3;
        float dens = smoothstep(0.4, 0.82, n + nearWater * 0.08);
        float edge = smoothstep(58.0, 40.0, max(abs(vW.x), abs(vW.z)));
        float a = uAmt * dens * mask * soft * edge * 0.075;   // 7 layers stack to ~0.3 max
        if (a < 0.002) discard;
        vec3 V = normalize(vW - cameraPosition);
        float fwd = pow(max(dot(V, uSunDir), 0.0), 5.0);
        gl_FragColor = vec4(uColor + uSunTint * fwd, a);
        ${OUT_GLSL}
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 41; mesh.name = 'life-mist';
  return { obj: mesh, u: uniforms };
}

// ---------------------------------------------------------------- haze: big flat layers filling the far valleys
function makeHaze() {
  const Y = [1.5, 4.5, 9, 15], geos = [];
  for (let l = 0; l < Y.length; l++) {
    const g = new THREE.PlaneGeometry(520, 520, 1, 1).rotateX(-Math.PI / 2).translate(0, Y[l], 0);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(4).fill(l / (Y.length - 1)), 1));
    geos.push(g);
  }
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uHeight: { value: null }, uAmt: { value: 0.5 }, uColor: { value: new THREE.Color() }, uSunTint: { value: new THREE.Color() },
  }]);
  Object.assign(uniforms, { uTime: U.uTime, uWindDir: U.uWindDir, uSunDir: U.uSunDir });
  uniforms.uHeight.value = G.farTex;
  const step = (2 * FAR_HALF) / (FAR_N - 1);
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: true,
    vertexShader: SHEET_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D uHeight; uniform float uAmt; uniform vec3 uColor; uniform vec3 uSunTint;
      uniform float uTime; uniform vec2 uWindDir; uniform vec3 uSunDir;
      varying vec3 vW; varying float vL;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float gh = texture2D(uHeight, ((vW.xz + ${FAR_HALF.toFixed(1)}) / ${step.toFixed(3)} + 0.5) / ${FAR_N.toFixed(1)}).r;
        float hgt = vW.y - gh;
        if (hgt <= 0.0) discard;
        float soft = smoothstep(0.0, 3.5 + vL * 4.0, hgt);
        float r = length(vW.xz * vec2(1.0, 1.1));
        float ring = smoothstep(42.0, 90.0, r) * smoothstep(255.0, 185.0, r);
        vec2 q = vW.xz * 0.011 - uWindDir * uTime * 0.004 + vL * 7.0;
        float n = lf_fbm(q) * 0.7 + lf_fbm(q * 3.1 + 5.0) * 0.3;
        float dens = mix(0.35, 1.0, smoothstep(0.3, 0.75, n));
        float a = uAmt * soft * ring * dens * (0.3 - vL * 0.12);
        if (a < 0.002) discard;
        vec3 V = normalize(vW - cameraPosition);
        float fwd = pow(max(dot(V, uSunDir), 0.0), 4.0);
        gl_FragColor = vec4(uColor + uSunTint * fwd, a);
        ${OUT_GLSL}
      }`,
  });
  const mesh = new THREE.Mesh(mergeSimple(geos), mat);
  mesh.frustumCulled = false; mesh.renderOrder = 40; mesh.name = 'life-haze';
  return { obj: mesh, u: uniforms };
}

// merge same-layout indexed geometries (position + aLayer), keeping draw order
function mergeSimple(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), lay = new Float32Array(nv), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, ov * 3); lay.set(g.attributes.aLayer.array, ov);
    const ix = g.index.array; for (let k = 0; k < ix.length; k++) idx[oi + k] = ix[k] + ov;
    ov += g.attributes.position.count; oi += ix.length; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('aLayer', new THREE.BufferAttribute(lay, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------------------------------------------------------------- module
let motes, flies, mist, haze;
const _c = new THREE.Color();
export function init(root) {
  const rnd = mulberry32(31337);
  motes = makeMotes(rnd); flies = makeFireflies(rnd); mist = makeMist(); haze = makeHaze();
  root.add(haze.obj, mist.obj, motes.obj, flies.obj);
  update(0, 0);
}
export function update(dt, t, ctx) {
  if (ctx?.controls?.target) motes.u.uFocus.value.copy(ctx.controls.target);
  motes.u.uAmt.value = W.motes;
  motes.u.uColor.value.copy(W.moteCol);
  flies.u.uAmt.value = W.fire;
  // sun-glow tint: normalised hue of the key light, dimmed at night
  const sc = U.uSunColor.value, m = Math.max(sc.r, sc.g, sc.b, 1e-3);
  _c.setRGB(sc.r / m, sc.g / m, sc.b / m).multiplyScalar(Math.min(1, m / 3) * (1 - 0.8 * U.uNight.value));
  mist.u.uAmt.value = W.mist; mist.u.uColor.value.copy(W.mistCol); mist.u.uSunTint.value.copy(_c).multiplyScalar(0.7);
  haze.u.uAmt.value = W.haze; haze.u.uColor.value.copy(W.hazeCol); haze.u.uSunTint.value.copy(_c).multiplyScalar(0.5);
  mist.obj.visible = W.mist > 0.005; haze.obj.visible = W.haze > 0.005;
  motes.obj.visible = W.motes > 0.002; flies.obj.visible = W.fire > 0.002;
}
