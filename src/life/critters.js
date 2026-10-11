// life/critters.js — red dragonflies (akatombo), flocks crossing the sky, an egret fishing in the rapids,
// sparrows hopping by the teahouse path and a wagtail on the stepping stones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ANCHORS, WATER_Y, U, mulberry32, streamPoint, bankPoint, S_RAPIDS, S_STONES, S_POND, LAYER_REFRACT, patchMaterial,
  applyCloudShadows, clamp, IS_SPRING,
} from '../world.js';
import { groundAt, surfaceAt, waterDist, W, TAU, wrapAngle, easeInOut, OUT_GLSL } from './common.js';

export const STONE_TOP = WATER_Y + 0.22;   // assumed top of the stepping stones (perches)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
function writeMat(arr, i, x, y, z, yaw, pitch, roll, s) {
  _e.set(pitch, yaw, roll); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(s, s, s);
  _m.compose(_p, _q, _s); _m.toArray(arr, i * 16);
}

// geometry helper: non-indexed part with a flat colour and optional per-vertex attributes computed from position
function part(geo, color, attrs = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count, p = g.attributes.position;
  const c = new THREE.Color(color), ca = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  for (const [k, fn] of Object.entries(attrs)) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
    g.setAttribute(k, new THREE.BufferAttribute(a, 1));
  }
  return g;
}
function tris(verts, color, attrs) {   // verts: flat [x,y,z,...] triangles
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return part(g, color, attrs);
}

// ================================================================ dragonflies
const DF_N = 16, DF_SCALE = 1.6;
class Dragonflies {
  constructor(root, rnd) {
    this.rnd = rnd;
    const body = mergeGeometries([
      part(new THREE.CylinderGeometry(0.0085, 0.005, 0.17, 6, 1).rotateX(Math.PI / 2).translate(0, 0, -0.078), '#c41f16'),
      part(new THREE.SphereGeometry(0.016, 8, 6).scale(1, 1, 1.5).translate(0, 0, 0.018), '#6e2416'),
      part(new THREE.SphereGeometry(0.0145, 8, 6).translate(0, 0.002, 0.05), '#9a3322'),
    ]);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), DF_N);
    this.body.castShadow = true;
    // wings: 4 quads with side / pair attributes, flapped + shaded in a small shader
    const pos = [], uv = [], side = [], pair = [], idx = [];
    for (const s of [-1, 1]) for (const pr of [0, 1]) {
      const L = pr ? 0.14 : 0.15, zc = pr ? -0.004 : 0.026, ch = pr ? 0.042 : 0.033, sw = pr ? -0.012 : -0.004, b = pos.length / 3;
      pos.push(s * 0.01, 0.007, zc - ch / 2, s * 0.01, 0.007, zc + ch / 2, s * L, 0.007, zc + ch / 2 + sw, s * L, 0.007, zc - ch / 2 + sw);
      uv.push(0, 0, 0, 1, 1, 1, 1, 0);
      for (let k = 0; k < 4; k++) { side.push(s); pair.push(pr); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wg.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    wg.setAttribute('aPair', new THREE.Float32BufferAttribute(pair, 1));
    wg.setIndex(idx);
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(DF_N), 1).setUsage(THREE.DynamicDrawUsage);
    const phase = new Float32Array(DF_N); for (let i = 0; i < DF_N; i++) phase[i] = rnd() * 100;
    wg.setAttribute('aFlap', this.flap);
    wg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const wm = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: /* glsl */`
        attribute float aSide; attribute float aPair; attribute float aFlap; attribute float aPhase;
        uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          float ang = sin(uTime * 72.0 + aPhase + aPair * 2.1) * 0.8 * aFlap + 0.06 * aFlap - (1.0 - aFlap) * 0.05;
          float r = abs(position.x) - 0.01;
          vec3 p = position;
          p.x = aSide * (0.01 + r * cos(ang));
          p.y = position.y + r * sin(ang);
          vec3 n = vec3(-aSide * sin(ang), cos(ang), 0.0);
          mat4 mm = modelMatrix * instanceMatrix;
          vec4 wp = mm * vec4(p, 1.0);
          vN = normalize(mat3(mm) * n);
          vV = normalize(cameraPosition - wp.xyz);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float e = dot(q, q);
          if (e > 1.0) discard;
          vec3 N = normalize(vN); if (dot(N, vV) < 0.0) N = -N;
          float ndv = clamp(dot(N, vV), 0.0, 1.0);
          vec3 irid = 0.5 + 0.5 * cos(6.2831 * (ndv * 1.7 + vUv.x * 0.4 + vec3(0.0, 0.33, 0.67)));
          vec3 H = normalize(uSunDir + vV);
          // soft, capped sheen: the wings beat so fast that a sharp HDR highlight strobes into bloom "flashes"
          float spec = pow(max(dot(N, H), 0.0), 8.0) * 0.18;
          vec3 sun = uSunColor * (1.0 - 0.8 * uNight);
          float vein = smoothstep(0.92, 1.0, fract(vUv.x * 9.0)) * 0.4 + smoothstep(0.04, 0.0, abs(vUv.y - 0.72)) * 0.5;
          vec3 col = vec3(0.7, 0.72, 0.74) * (0.08 + 0.12 * length(sun)) + irid * spec * min(sun, vec3(1.2)) + vec3(0.15, 0.08, 0.04) * vein;
          col = min(col, vec3(0.75));
          float a = (0.16 + 0.25 * (1.0 - ndv) + 0.3 * spec + vein * 0.4) * smoothstep(1.0, 0.75, e);
          gl_FragColor = vec4(col, min(a, 0.9));
          ${OUT_GLSL}
        }`,
    });
    Object.assign(wm.uniforms, { uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uNight: U.uNight });
    this.wings = new THREE.InstancedMesh(wg, wm, DF_N);
    this.wings.instanceMatrix = this.body.instanceMatrix;   // shared transforms
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.frustumCulled = this.wings.frustumCulled = false;
    this.wings.renderOrder = 5;
    root.add(this.body, this.wings);

    // homes: most over the stream, a few over the pampas meadows
    const F = () => new Float32Array(DF_N);
    Object.assign(this, { x: F(), y: F(), z: F(), sx: F(), sy: F(), sz: F(), tx: F(), ty: F(), tz: F(), hx: F(), hz: F(), hr: F(),
      h: F(), timer: F(), dur: F(), mode: new Uint8Array(DF_N), next: new Uint8Array(DF_N), fl: F(), ph: F() });
    for (let i = 0; i < DF_N; i++) {
      this.rehome(i);
      this.x[i] = this.hx[i]; this.z[i] = this.hz[i]; this.y[i] = surfaceAt(this.x[i], this.z[i]) + 0.8;
      this.h[i] = rnd() * TAU; this.ph[i] = rnd() * TAU; this.mode[i] = 0; this.timer[i] = rnd() * 2; this.fl[i] = 1;
    }
  }
  rehome(i) {
    const r = this.rnd;
    if (i % 3 === 2) {
      const m = ANCHORS.zones.pampasMeadows[i % ANCHORS.zones.pampasMeadows.length];
      const a = r() * TAU, d = Math.sqrt(r()) * m.r * 0.7;
      this.hx[i] = m.x + Math.cos(a) * d; this.hz[i] = m.z + Math.sin(a) * d; this.hr[i] = 3.5;
    } else {
      const s = S_RAPIDS - 8 + r() * (S_STONES - S_RAPIDS + 16), p = streamPoint(s), o = (r() * 2 - 1) * (p.hw + 1);
      this.hx[i] = p.x + p.nx * o; this.hz[i] = p.z + p.nz * o; this.hr[i] = 3;
    }
  }
  pick(i) {
    const r = this.rnd, x = this.x[i], z = this.z[i];
    let tx, ty, tz, next = 0;
    const u = r();
    const stones = ANCHORS.steppingStones;
    if (u < 0.05) this.rehome(i);
    if (u < 0.16 && stones.length) {
      // perch on a nearby stepping stone (or just hover low there)
      let best = null, bd = 64;
      for (const s of stones) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
      if (best) { tx = best.x + (r() - 0.5) * 0.3; tz = best.z + (r() - 0.5) * 0.3; ty = STONE_TOP + 0.05; next = 2; }
    }
    if (tx === undefined && u < 0.3 && waterDist(x, z) < -0.4) {
      // akatombo dipping the water surface (laying eggs)
      tx = x + (r() - 0.5) * 0.8; tz = z + (r() - 0.5) * 0.8; ty = WATER_Y + 0.05; next = 3;
    }
    if (tx === undefined) {
      const a = r() * TAU, d = Math.sqrt(r()) * this.hr[i];
      tx = this.hx[i] + Math.cos(a) * d; tz = this.hz[i] + Math.sin(a) * d;
      ty = surfaceAt(tx, tz) + 0.35 + r() * 1.1;
    }
    this.sx[i] = x; this.sy[i] = this.y[i]; this.sz[i] = z; this.tx[i] = tx; this.ty[i] = ty; this.tz[i] = tz;
    const dist = Math.hypot(tx - x, ty - this.y[i], tz - z);
    this.dur[i] = clamp(dist / 3.4, 0.22, 2.6); this.timer[i] = 0; this.mode[i] = 1; this.next[i] = next;
  }
  update(dt, t) {
    const arr = this.body.instanceMatrix.array, r = this.rnd, vis = W.dragon;
    for (let i = 0; i < DF_N; i++) {
      const sc = clamp(vis * DF_N - i, 0, 1);
      if (sc <= 0) { writeMat(arr, i, 0, -50, 0, 0, 0, 0, 0); continue; }
      this.timer[i] += dt;
      let pitch = -0.08, wantFlap = 1;
      const mode = this.mode[i];
      if (mode === 1) {            // dart
        const u = Math.min(1, this.timer[i] / this.dur[i]), e = easeInOut(u);
        this.x[i] = this.sx[i] + (this.tx[i] - this.sx[i]) * e;
        this.y[i] = this.sy[i] + (this.ty[i] - this.sy[i]) * e + Math.sin(u * Math.PI) * 0.12;
        this.z[i] = this.sz[i] + (this.tz[i] - this.sz[i]) * e;
        const want = Math.atan2(this.tx[i] - this.sx[i], this.tz[i] - this.sz[i]);
        this.h[i] += wrapAngle(want - this.h[i]) * Math.min(1, dt * 14);
        pitch = 0.12;
        if (u >= 1) {
          const nx = this.next[i];
          this.timer[i] = 0;
          if (nx === 2) { this.mode[i] = 2; this.dur[i] = 2.5 + r() * 6; }
          else if (nx === 3) { this.mode[i] = 0; this.dur[i] = 0.12; }
          else { this.mode[i] = 0; this.dur[i] = 0.5 + r() * 2.2; }
        }
      } else if (mode === 0) {     // hover
        const hy = Math.sin(t * 2.3 + this.ph[i]) * 0.035, hx = Math.sin(t * 1.7 + this.ph[i] * 2) * 0.03;
        this.x[i] += hx * dt; this.y[i] += hy * dt * 1.5;
        this.h[i] += Math.sin(t * 0.7 + this.ph[i]) * 0.5 * dt;
        if (this.timer[i] > this.dur[i]) this.pick(i);
      } else {                     // perched: wings still, flat
        wantFlap = 0; pitch = 0;
        if (this.timer[i] > this.dur[i]) this.pick(i);
      }
      this.fl[i] += (wantFlap - this.fl[i]) * Math.min(1, dt * 10);
      this.flap.array[i] = this.fl[i];
      const bob = mode === 2 ? 0 : Math.sin(t * 9 + this.ph[i]) * 0.008;
      writeMat(arr, i, this.x[i], this.y[i] + bob, this.z[i], this.h[i], pitch, 0, DF_SCALE * sc);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
  }
}


// ================================================================ butterflies (spring)
// Cabbage whites, yellow kicho and swallowtails fluttering low over the banks and meadows, now and then settling
// with their wings folded up. Body + wings share instance transforms; wings flap in the vertex shader.
const BF_N = 10, BF_SCALE = 1.9;
class Butterflies {
  constructor(root, rnd) {
    this.rnd = rnd;
    const body = mergeGeometries([
      part(new THREE.CylinderGeometry(0.0045, 0.0035, 0.05, 5, 1).rotateX(Math.PI / 2).translate(0, 0, -0.006), '#2a2420'),
      part(new THREE.SphereGeometry(0.006, 6, 4).translate(0, 0, 0.022), '#2a2420'),
    ]);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), BF_N);
    const pos = [], uv = [], side = [], idx = [];
    for (const sd of [-1, 1]) {
      const b = pos.length / 3;
      pos.push(sd * 0.004, 0.003, -0.04, sd * 0.004, 0.003, 0.045, sd * 0.066, 0.003, 0.045, sd * 0.066, 0.003, -0.04);
      uv.push(0, 0, 0, 1, 1, 1, 1, 0);
      for (let k = 0; k < 4; k++) side.push(sd);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wg.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    wg.setIndex(idx);
    const type = new Float32Array(BF_N), phase = new Float32Array(BF_N);
    for (let i = 0; i < BF_N; i++) { type[i] = i < 5 ? 0 : i < 8 ? 1 : 2; phase[i] = rnd() * 100; }
    this.type = type;
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(BF_N).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    wg.setAttribute('aFlap', this.flap);
    wg.setAttribute('aType', new THREE.InstancedBufferAttribute(type, 1));
    wg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const wm = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      side: THREE.DoubleSide, fog: true,
      vertexShader: /* glsl */`
        attribute float aSide; attribute float aFlap; attribute float aType; attribute float aPhase;
        uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying float vType;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vType = aType;
          float f = sin(uTime * (aType > 1.5 ? 17.0 : 24.0) + aPhase);
          float ang = mix(1.42, 0.3 + 1.05 * f, aFlap);       // 1.42 = folded up (resting)
          float r = abs(position.x) - 0.004;
          vec3 p = position;
          p.x = aSide * (0.004 + r * cos(ang));
          p.y = position.y + r * sin(ang);
          mat4 mm = modelMatrix * instanceMatrix;
          vN = normalize(mat3(mm) * vec3(-aSide * sin(ang), cos(ang), 0.0));
          vec4 mvPosition = viewMatrix * mm * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
        varying vec2 vUv; varying vec3 vN; varying float vType;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec2 q = vUv;
          float fw = length((q - vec2(0.5, 0.64)) / vec2(0.52, 0.37));
          float hw = length((q - vec2(0.4, 0.27)) / vec2(0.42, 0.29));
          if (min(fw, hw) > 1.0) discard;
          vec3 c;
          if (vType < 0.5) {            // cabbage white: grey-black apex + one small spot
            c = vec3(0.94, 0.94, 0.9);
            c = mix(c, vec3(0.2), smoothstep(0.72, 0.92, q.x) * step(0.62, q.y) * step(fw, 1.0) * 0.85);
            c = mix(c, vec3(0.22), smoothstep(0.075, 0.05, length(q - vec2(0.55, 0.6))));
          } else if (vType < 1.5) {     // kicho (common grass yellow)
            c = vec3(1.0, 0.84, 0.2);
          } else {                      // swallowtail: pale yellow with black bands and edges
            c = vec3(0.98, 0.88, 0.48);
            float band = step(fract(q.y * 3.6 + q.x * 1.3), 0.22);
            float edge = smoothstep(0.78, 0.95, min(fw, hw));
            c = mix(c, vec3(0.06), max(band * 0.9, edge));
          }
          c = mix(c, c * 0.8, smoothstep(0.25, 0.0, q.x));   // dusky wing roots
          vec3 N = normalize(vN);
          float ndl = abs(dot(N, uSunDir));
          vec3 light = min(uSunColor * (0.08 + 0.26 * ndl) + vec3(0.32) * (1.0 - 0.7 * uNight), vec3(1.1));
          gl_FragColor = vec4(c * light, 1.0);
          ${OUT_GLSL}
        }`,
    });
    Object.assign(wm.uniforms, { uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uNight: U.uNight });
    this.wings = new THREE.InstancedMesh(wg, wm, BF_N);
    this.wings.instanceMatrix = this.body.instanceMatrix;
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.frustumCulled = this.wings.frustumCulled = false;
    root.add(this.body, this.wings);
    // homes along the flowery banks and over the meadows
    this.homes = [];
    for (const z of ANCHORS.zones.lilyBanks) for (let k = 0; k < 3; k++) {
      const p = bankPoint(z.s0 + rnd() * (z.s1 - z.s0), rnd() < 0.5 ? 1 : -1, 0.8 + rnd() * 2.5); this.homes.push(p);
    }
    for (const m of ANCHORS.zones.pampasMeadows) this.homes.push({ x: m.x, z: m.z });
    const F = () => new Float32Array(BF_N);
    Object.assign(this, { x: F(), y: F(), z: F(), tx: F(), ty: F(), tz: F(), h: F(), ph: F(), sp: F(), timer: F(), dur: F(), fl: F(),
      home: new Uint8Array(BF_N), perch: new Uint8Array(BF_N) });
    for (let i = 0; i < BF_N; i++) {
      this.home[i] = Math.floor(rnd() * this.homes.length);
      const hm = this.homes[this.home[i]];
      this.x[i] = hm.x + (rnd() - 0.5) * 3; this.z[i] = hm.z + (rnd() - 0.5) * 3; this.y[i] = surfaceAt(this.x[i], this.z[i]) + 0.6;
      this.ph[i] = rnd() * TAU; this.h[i] = rnd() * TAU; this.fl[i] = 1;
      this.pick(i);
    }
  }
  pick(i) {
    const r = this.rnd;
    if (r() < 0.06) this.home[i] = Math.floor(r() * this.homes.length);
    const hm = this.homes[this.home[i]];
    for (let k = 0; k < 6; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 4.5;
      const x = hm.x + Math.cos(a) * d, z = hm.z + Math.sin(a) * d;
      const land = waterDist(x, z) > 0.4;
      if (!land && k < 5) continue;
      this.perch[i] = land && r() < 0.3 ? 1 : 0;
      this.tx[i] = x; this.tz[i] = z;
      this.ty[i] = this.perch[i] ? groundAt(x, z) + 0.06 : surfaceAt(x, z) + 0.3 + r() * 0.9;
      break;
    }
    this.sp[i] = 0.6 + r() * 0.6; this.timer[i] = 0; this.dur[i] = 0;
  }
  update(dt, t) {
    const arr = this.body.instanceMatrix.array, r = this.rnd, vis = W.butter;
    for (let i = 0; i < BF_N; i++) {
      const sc = clamp(vis * BF_N - i, 0, 1);
      if (sc <= 0) { writeMat(arr, i, 0, -50, 0, 0, 0, 0, 0); continue; }
      let wantFlap = 1, ox = 0, oy = 0, oz = 0;
      if (this.dur[i] > 0) {                       // resting on the ground, wings folded, the odd slow fan
        this.timer[i] += dt;
        wantFlap = Math.sin(t * 1.3 + this.ph[i]) > 0.85 ? 0.35 : 0;
        if (this.timer[i] > this.dur[i]) { this.dur[i] = 0; this.pick(i); }
      } else {
        const dx = this.tx[i] - this.x[i], dy = this.ty[i] - this.y[i], dz = this.tz[i] - this.z[i];
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.08) {
          if (this.perch[i]) { this.dur[i] = 2 + r() * 5; this.timer[i] = 0; } else this.pick(i);
        } else {
          const st = Math.min(d, this.sp[i] * dt);
          this.x[i] += dx / d * st; this.y[i] += dy / d * st; this.z[i] += dz / d * st;
          const want = Math.atan2(dx, dz) + Math.sin(t * 2.7 + this.ph[i]) * 0.5;
          this.h[i] += wrapAngle(want - this.h[i]) * Math.min(1, dt * 4);
          // erratic flutter around the path, fading out near a landing spot
          const k = this.perch[i] ? Math.min(1, d / 0.6) : 1;
          ox = (Math.sin(t * 2.3 + this.ph[i]) * 0.14 + Math.sin(t * 5.1 + this.ph[i] * 2) * 0.05) * k;
          oy = (Math.sin(t * 7.0 + this.ph[i]) * 0.06 + Math.sin(t * 1.7 + this.ph[i]) * 0.1) * k;
          oz = (Math.cos(t * 1.9 + this.ph[i]) * 0.14 + Math.cos(t * 4.3 + this.ph[i]) * 0.05) * k;
        }
      }
      this.fl[i] += (wantFlap - this.fl[i]) * Math.min(1, dt * 8);
      this.flap.array[i] = this.fl[i];
      const big = this.type[i] > 1.5 ? 1.4 : 1;
      writeMat(arr, i, this.x[i] + ox, this.y[i] + oy, this.z[i] + oz, this.h[i], this.dur[i] > 0 ? 0 : -0.15, 0, BF_SCALE * big * sc);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
  }
}

// ================================================================ flocks
const FL_N = 9;
const BIRD_GLSL = /* glsl */`
attribute float aWing; attribute vec2 aBird; attribute float aFlapAmp;
uniform float uTime;
float lifeBirdAng() {
  float f = sin(uTime * aBird.y + aBird.x);
  return (f * 0.95 * aFlapAmp + (1.0 - aFlapAmp) * 0.08) * (0.7 + 0.6 * aWing);
}`;
function birdPatch(withNormal) {
  return (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BIRD_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aWing > 0.0) { float a = lifeBirdAng(); float sd = sign(position.x); float r = abs(position.x) - 0.03;
          transformed.x = sd * (0.03 + r * cos(a)); transformed.y = position.y + r * sin(a); }`);
    if (withNormal) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        if (aWing > 0.0) { float a = lifeBirdAng(); float sd = sign(position.x); objectNormal = vec3(-sd * sin(a), cos(a), 0.0); }`);
  };
}
class Flock {
  constructor(root, rnd) {
    this.rnd = rnd;
    const wing = (s) => {
      const rf = [s * 0.03, 0, 0.06], rb = [s * 0.03, 0, -0.08], mf = [s * 0.25, 0.01, 0.035], mb = [s * 0.25, 0.01, -0.075], tp = [s * 0.48, 0, -0.07];
      const v = s < 0 ? [...rf, ...rb, ...mb, ...rf, ...mb, ...mf, ...mf, ...mb, ...tp] : [...rf, ...mb, ...rb, ...rf, ...mf, ...mb, ...mf, ...tp, ...mb];
      return tris(v, '#221d1a', { aWing: (x) => Math.abs(x) / 0.48 });
    };
    const zero = { aWing: () => 0 };
    const geo = mergeGeometries([
      part(new THREE.SphereGeometry(1, 8, 6).scale(0.055, 0.05, 0.19), '#2c2622', zero),
      part(new THREE.SphereGeometry(0.042, 6, 5).translate(0, 0.02, 0.18), '#231e1b', zero),
      part(new THREE.ConeGeometry(0.012, 0.06, 4).rotateX(Math.PI / 2).translate(0, 0.015, 0.24), '#3a332c', zero),
      tris([0, 0, -0.15, 0.07, 0, -0.3, -0.07, 0, -0.3], '#221d1a', zero),
      wing(1), wing(-1),
    ]);
    const bird = new Float32Array(FL_N * 2);
    for (let i = 0; i < FL_N; i++) { bird[i * 2] = rnd() * TAU; bird[i * 2 + 1] = 10 + rnd() * 4; }
    geo.setAttribute('aBird', new THREE.InstancedBufferAttribute(bird, 2));
    this.amp = new THREE.InstancedBufferAttribute(new Float32Array(FL_N).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlapAmp', this.amp);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    patchMaterial(mat, 'lifeBird', birdPatch(true));
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = birdPatch(false);
    this.mesh = new THREE.InstancedMesh(geo, mat, FL_N);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(this.mesh);
    this.active = false; this.nextT = 5; this.off = []; for (let i = 0; i < FL_N; i++) this.off.push({ b: 0, l: 0, u: 0, ph: 0, gl: 0 });
    this.p0 = new THREE.Vector3(); this.p1 = new THREE.Vector3(); this.p2 = new THREE.Vector3();
    this.hide();
  }
  hide() { const a = this.mesh.instanceMatrix.array; for (let i = 0; i < FL_N; i++) writeMat(a, i, 0, -80, 0, 0, 0, 0, 0); this.mesh.instanceMatrix.needsUpdate = true; }
  start(t) {
    const r = this.rnd, a = r() * TAU, dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const c = (r() - 0.5) * 34, bend = (r() - 0.5) * 50, alt = 8 + r() * 8;
    this.p0.set(-dx * 120 + px * c, alt + 2 + r() * 3, -dz * 120 + pz * c);
    this.p1.set(px * (c + bend), alt, pz * (c + bend));
    this.p2.set(dx * 120 + px * c, alt + 1 + r() * 4, dz * 120 + pz * c);
    this.len = 250; this.speed = 7 + r() * 3; this.t0 = t; this.dur = this.len / this.speed;
    this.n = 3 + Math.floor(r() * (FL_N - 2));
    const vee = r() < 0.5;
    for (let i = 0; i < FL_N; i++) {
      const o = this.off[i], k = Math.ceil(i / 2), sd = i % 2 ? 1 : -1;
      o.b = vee ? k * 1.4 + r() * 0.4 : r() * 7; o.l = vee ? sd * k * 1.1 + (r() - 0.5) * 0.4 : (r() - 0.5) * 6; o.u = (r() - 0.5) * 1.2;
      o.ph = r() * TAU; o.gl = 0.2 + r() * 0.4;
    }
    this.active = true;
  }
  bez(u, out, tan) {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    out.set(0, 0, 0).addScaledVector(this.p0, a).addScaledVector(this.p1, b).addScaledVector(this.p2, c);
    if (tan) tan.set(0, 0, 0).addScaledVector(this.p1, 2 * (1 - u)).addScaledVector(this.p0, -2 * (1 - u)).addScaledVector(this.p2, 2 * u).addScaledVector(this.p1, -2 * u);
  }
  update(dt, t) {
    if (!this.active) {
      if (t > this.nextT) {
        if (W.flock > 0.15 && this.rnd() < W.flock) this.start(t); else this.nextT = t + 8;
      }
      return;
    }
    const U0 = (t - this.t0) / this.dur;
    if (U0 > 1.08) { this.active = false; this.nextT = t + (14 + this.rnd() * 30) / Math.max(W.flock, 0.2); this.hide(); return; }
    const arr = this.mesh.instanceMatrix.array, P = _v1, T1 = _v2, T2 = _v3;
    for (let i = 0; i < FL_N; i++) {
      if (i >= this.n) { writeMat(arr, i, 0, -80, 0, 0, 0, 0, 0); continue; }
      const o = this.off[i];
      const u = U0 - o.b / this.len;
      this.bez(clamp(u, 0, 1), P, T1); this.bez(clamp(u + 0.01, 0, 1), _v4, T2);
      const tl = Math.hypot(T1.x, T1.z) || 1, nx = -T1.z / tl, nz = T1.x / tl;
      const yaw = Math.atan2(T1.x, T1.z), yaw2 = Math.atan2(T2.x, T2.z);
      const flapping = Math.sin(t * o.gl + o.ph) > -0.35 ? 1 : 0;
      this.amp.array[i] += (flapping - this.amp.array[i]) * Math.min(1, dt * 3);
      const bob = Math.sin(t * 2.2 + o.ph) * 0.25 * this.amp.array[i];
      writeMat(arr, i, P.x + nx * o.l + Math.sin(t * 0.7 + o.ph) * 0.5, P.y + o.u + bob, P.z + nz * o.l,
        yaw, -0.05 + Math.cos(t * 2.2 + o.ph) * 0.06, clamp(-wrapAngle(yaw2 - yaw) * 25, -0.6, 0.6), 1.25);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.amp.needsUpdate = true;
  }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

// ================================================================ egret
class Egret {
  constructor(root, rnd, onStrike) {
    this.rnd = rnd; this.onStrike = onStrike;
    const white = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#d9a628', roughness: 0.5 });
    const g = this.group = new THREE.Group(); g.name = 'life-egret';
    const leg = (x) => {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.55, -0.02);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.56, 5).translate(0, -0.28, 0), dark);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.09).translate(0, -0.555, 0.03), dark);
      pivot.add(m, foot); g.add(pivot); return pivot;
    };
    this.legL = leg(0.045); this.legR = leg(-0.045);
    this.body = new THREE.Group(); this.body.position.set(0, 0.66, 0); g.add(this.body);
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10).scale(0.82, 0.8, 1.75), white);
    torso.rotation.x = -0.38; this.body.add(torso);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.3), white);
    tail.rotation.x = 0.35; this.body.add(tail);
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.1, 0.17); this.body.add(this.neck);
    const curve = new THREE.CatmullRomCurve3([[0, 0, 0], [0, 0.11, 0.035], [0, 0.21, -0.015], [0, 0.31, 0.02], [0, 0.37, 0.075]].map(a => new THREE.Vector3(...a)));
    this.neck.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.027, 6), white));
    this.head = new THREE.Group(); this.head.position.set(0, 0.37, 0.075); this.neck.add(this.head);
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8).scale(0.85, 0.9, 1.3), white));
    this.head.add(new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.15, 6).rotateX(Math.PI / 2).translate(0, -0.005, 0.11), yellow));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), dark);
    eye.position.set(0.03, 0.01, 0.025); const eye2 = eye.clone(); eye2.position.x = -0.03; this.head.add(eye, eye2);
    g.scale.setScalar(1.3);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.layers.enable(LAYER_REFRACT); } });
    root.add(g);
    // home: shallows near the rapids, away from boulders, on the visible (front) bank if possible
    this.home = this.findHome();
    this.x = this.home.x; this.z = this.home.z; this.yaw = this.home.yaw;
    this.state = 'idle'; this.timer = 0; this.dur = 3; this.look = 0; this.lookT = 0; this.lookTimer = 0;
    this.neckX = 0; this.headX = 0; this.sx = 0; this.sz = 0; this.tx = 0; this.tz = 0; this.yaw0 = 0; this.yaw1 = 0;
  }
  ok(x, z) {
    const depth = WATER_Y - groundAt(x, z);
    if (depth < 0.06 || depth > 0.32) return false;
    for (const k of ANCHORS.rocks) if (Math.hypot(k.x - x, k.z - z) < k.s * 1.2 + 0.7) return false;
    return true;
  }
  findHome() {
    for (const side of [1, -1]) {
      for (let ds = 4; ds < 16; ds += 0.5) for (const sgn of [1, -1]) {
        const s = S_RAPIDS + sgn * ds;
        for (let off = 0.3; off < 1.6; off += 0.2) {
          const p = bankPoint(s, side, -off);
          if (this.ok(p.x, p.z)) {
            const q = streamPoint(s);
            return { x: p.x, z: p.z, yaw: Math.atan2(-q.tx, -q.tz) + side * 0.6 };   // face upstream, toward mid-stream
          }
        }
      }
    }
    const p = bankPoint(S_RAPIDS + 6, 1, -0.6); return { x: p.x, z: p.z, yaw: 0 };
  }
  update(dt, t) {
    const r = this.rnd, night = W.ground < 0.5;
    this.timer += dt;
    let neckT = night ? -0.25 : 0, headT = 0, legA = 0, legB = 0, bodyBob = Math.sin(t * 1.3) * 0.004;
    if (this.state === 'idle') {
      if (this.timer > this.dur) {
        this.timer = 0;
        const u = r();
        if (night) { this.dur = 4 + r() * 6; }
        else if (u < 0.35) {
          this.state = 'strike'; this.dur = 1.3;
        } else if (u < 0.75) {
          // step slowly to a new spot nearby
          for (let k = 0; k < 6; k++) {
            const a = this.yaw + (r() - 0.5) * 2.2, d = 0.25 + r() * 0.35;
            let tx = this.x + Math.sin(a) * d, tz = this.z + Math.cos(a) * d;
            if (Math.hypot(tx - this.home.x, tz - this.home.z) > 1.4) { tx = this.x + (this.home.x - this.x) * 0.4; tz = this.z + (this.home.z - this.z) * 0.4; }
            if (this.ok(tx, tz)) { this.sx = this.x; this.sz = this.z; this.tx = tx; this.tz = tz; this.yaw0 = this.yaw; this.yaw1 = this.yaw + wrapAngle(Math.atan2(tx - this.x, tz - this.z) - this.yaw) * 0.6; this.state = 'step'; this.dur = 2.2; break; }
          }
          if (this.state !== 'step') this.dur = 2;
        } else this.dur = 2 + r() * 4;
      }
      // glance around
      this.lookTimer -= dt;
      if (this.lookTimer < 0) { this.lookT = (r() - 0.5) * (night ? 0.4 : 1.6); this.lookTimer = 0.8 + r() * 2.5; }
    } else if (this.state === 'step') {
      const u = Math.min(1, this.timer / this.dur), e = easeInOut(u);
      this.x = this.sx + (this.tx - this.sx) * e; this.z = this.sz + (this.tz - this.sz) * e;
      this.yaw = this.yaw0 + (this.yaw1 - this.yaw0) * e;
      legA = u < 0.5 ? Math.sin(u * 2 * Math.PI) * 0.55 : 0; legB = u >= 0.5 ? Math.sin((u - 0.5) * 2 * Math.PI) * 0.55 : 0;
      bodyBob += Math.sin(u * TAU * 2) * 0.01;
      neckT = 0.15;
      if (u >= 1) { this.state = 'idle'; this.timer = 0; this.dur = 1.5 + r() * 4; }
    } else if (this.state === 'strike') {
      const u = this.timer;
      // crouch, lunge, hold, recover
      if (u < 0.45) { neckT = 0.25 * (u / 0.45); headT = 0.25 * (u / 0.45); this.lookT = 0; }
      else if (u < 0.62) { neckT = 1.45; headT = 0.9; if (!this.struck) { this.struck = true; this.onStrike?.(this.x + Math.sin(this.yaw) * 0.8, this.z + Math.cos(this.yaw) * 0.8); } }
      else if (u < 0.85) { neckT = 1.45; headT = 0.9; }
      else { neckT = 0; headT = 0; }
      if (u > this.dur) { this.state = 'idle'; this.timer = 0; this.dur = 2 + r() * 5; this.struck = false; }
    }
    const k = this.state === 'strike' && this.timer > 0.45 && this.timer < 0.62 ? 30 : 5;
    this.neckX += (neckT - this.neckX) * Math.min(1, dt * k);
    this.headX += (headT - this.headX) * Math.min(1, dt * k);
    this.look += (this.lookT - this.look) * Math.min(1, dt * 8);
    this.neck.rotation.x = this.neckX;
    this.neck.scale.y = night ? 0.72 : 1 - Math.max(0, -this.neckX) * 0.3;
    this.head.rotation.set(this.headX, this.look, 0);
    this.legL.rotation.x = -legA; this.legR.rotation.x = -legB;
    this.body.position.y = 0.66 + bodyBob;
    this.group.position.set(this.x, groundAt(this.x, this.z) + 0.01, this.z);
    this.group.rotation.y = this.yaw;
  }
}

// ================================================================ small birds
function sparrowParts(wagtail) {
  const bodyCol = wagtail ? '#3a3a3c' : '#7a5a3a', belly = wagtail ? '#f0eee8' : '#d9cbb0', cap = wagtail ? '#1c1c1e' : '#6a3d22';
  const body = mergeGeometries([
    part(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.95, 1.6).translate(0, 0.07, 0), bodyCol),
    part(new THREE.SphereGeometry(0.044, 8, 6).scale(0.95, 0.8, 1.4).translate(0, 0.058, 0.01), belly),
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 3).translate(0.02, 0.03, 0), '#5a4030'),
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 3).translate(-0.02, 0.03, 0), '#5a4030'),
  ]);
  const head = mergeGeometries([
    part(new THREE.SphereGeometry(0.036, 8, 6), cap),
    part(new THREE.SphereGeometry(0.03, 8, 6).translate(0, -0.008, 0.008), wagtail ? '#f4f2ee' : '#efe6d6'),
    part(new THREE.ConeGeometry(0.008, 0.026, 4).rotateX(Math.PI / 2).translate(0, -0.004, 0.044), '#3a2a20'),
  ]);
  const tail = part(new THREE.BoxGeometry(0.035, 0.008, wagtail ? 0.13 : 0.07).translate(0, 0, wagtail ? -0.065 : -0.035), cap);
  return { body, head, tail };
}
class SmallBird {
  constructor(root, rnd, mat, geos, opts) {
    this.rnd = rnd; this.opts = opts;
    const g = this.group = new THREE.Group();
    g.add(new THREE.Mesh(geos.body, mat));
    this.head = new THREE.Mesh(geos.head, mat); this.head.position.set(0, 0.11, 0.07); g.add(this.head);
    this.tail = new THREE.Mesh(geos.tail, mat); this.tail.position.set(0, 0.08, -0.07); this.tail.rotation.x = -0.35; g.add(this.tail);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(opts.scale);
    root.add(g);
    this.x = opts.x; this.z = opts.z; this.y = opts.y(this.x, this.z); this.yaw = rnd() * TAU;
    this.state = 0; this.timer = 0; this.dur = rnd(); this.hops = 0;
    this.sx = 0; this.sz = 0; this.sy = 0; this.tx = 0; this.tz = 0; this.ty = 0; this.peck = 0; this.headYaw = 0; this.bob = 0;
  }
  update(dt, t, vis) {
    const r = this.rnd, o = this.opts;
    this.group.visible = vis > 0.02;
    if (!this.group.visible) return;
    this.timer += dt;
    let hopY = 0, pitch = 0;
    if (this.state === 0) {                 // idle: look around, peck
      if (this.timer > this.dur) {
        this.timer = 0;
        const u = r();
        if (u < 0.45 || this.hops > 0) {
          const target = o.next(this);
          if (target) {
            this.sx = this.x; this.sz = this.z; this.sy = this.y; this.tx = target.x; this.tz = target.z; this.ty = o.y(target.x, target.z);
            this.yaw = Math.atan2(this.tx - this.x, this.tz - this.z);
            this.state = 1; this.dur = target.far ? 0.42 : 0.2; this.hops = this.hops > 0 ? this.hops - 1 : (r() < 0.5 ? Math.floor(r() * 3) : 0);
          } else this.dur = 0.5;
        } else if (u < 0.75) { this.state = 2; this.dur = 0.35 + r() * 0.5; }
        else { this.dur = 0.3 + r() * 1.4; this.yaw += (r() - 0.5) * 1.6; }
        if (this.state === 0 && r() < 0.6) this.headYaw = (r() - 0.5) * 1.6;
      }
    } else if (this.state === 1) {          // hop
      const u = Math.min(1, this.timer / this.dur);
      this.x = this.sx + (this.tx - this.sx) * u; this.z = this.sz + (this.tz - this.sz) * u; this.y = this.sy + (this.ty - this.sy) * u;
      hopY = Math.sin(u * Math.PI) * (this.dur > 0.3 ? 0.22 : 0.07);
      pitch = -0.2 * Math.sin(u * Math.PI);
      if (u >= 1) { this.state = 0; this.timer = 0; this.dur = this.hops > 0 ? 0.08 + r() * 0.12 : 0.4 + r() * 1.5; this.headYaw = 0; }
    } else {                                 // peck
      const u = this.timer / this.dur;
      pitch = Math.max(0, Math.sin(u * Math.PI * 3)) * 0.65;
      if (u >= 1) { this.state = 0; this.timer = 0; this.dur = 0.3 + r() * 1.2; }
    }
    this.head.rotation.set(pitch * 0.6, this.headYaw, 0);
    // wagtails pump their tails constantly; sparrows flick occasionally
    const pump = o.wagtail ? Math.sin(t * 13) * 0.4 * (0.5 + 0.5 * Math.sin(t * 0.9 + this.yaw)) : Math.sin(t * 20) * 0.1 * (this.state === 1 ? 1 : 0);
    this.tail.rotation.x = -0.3 + pump;
    this.group.position.set(this.x, this.y + hopY, this.z);
    this.group.rotation.set(pitch, this.yaw, 0, 'YXZ');
    this.group.scale.setScalar(o.scale * Math.min(1, vis * 1.5));
  }
}

// ================================================================ module
let dfs = null, butterflies = null, flock, egret, birds = [];
export function init(root, { onStrike } = {}) {
  const rnd = mulberry32(777);
  if (IS_SPRING) butterflies = new Butterflies(root, rnd); else dfs = new Dragonflies(root, rnd);
  flock = new Flock(root, rnd);
  egret = new Egret(root, rnd, onStrike);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  applyCloudShadows(mat);
  // sparrows by the teahouse path
  const sp = sparrowParts(false), path = ANCHORS.paths[0];
  const a = path.pts[path.pts.length - 2], b = path.pts[path.pts.length - 1];
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const dry = (x, z) => waterDist(x, z) > 0.8 && Math.hypot(x - ANCHORS.teahouse.x, z - ANCHORS.teahouse.z) > 4.4;
  for (let i = 0; i < 3; i++) {
    let x = cx + (rnd() - 0.5) * 2, z = cz + (rnd() - 0.5) * 2;
    if (!dry(x, z)) { x = cx; z = cz; }
    birds.push(new SmallBird(root, rnd, mat, sp, {
      scale: 1.6, x, z, y: (x, z) => groundAt(x, z),
      next: (bd) => {
        for (let k = 0; k < 5; k++) {
          let ang = bd.yaw + (rnd() - 0.5) * 2.4;
          if (Math.hypot(bd.x - cx, bd.z - cz) > 2.2) ang = Math.atan2(cx - bd.x, cz - bd.z) + (rnd() - 0.5) * 0.8;
          const d = 0.12 + rnd() * 0.18, x = bd.x + Math.sin(ang) * d, z = bd.z + Math.cos(ang) * d;
          if (dry(x, z)) return { x, z };
        }
        return null;
      },
    }));
  }
  // a wagtail (sekirei) working the stepping stones
  const stones = ANCHORS.steppingStones;
  if (stones.length > 1) {
    const wg = sparrowParts(true);
    let idx = Math.floor(stones.length / 2);
    const w = new SmallBird(root, rnd, mat, wg, {
      scale: 1.6, wagtail: true, x: stones[idx].x, z: stones[idx].z,
      y: (x, z) => {
        let best = 1e9, top = surfaceAt(x, z);
        for (const s of stones) { const d = Math.hypot(s.x - x, s.z - z); if (d < s.r && d < best) { best = d; top = STONE_TOP; } }
        return top;
      },
      next: (bd) => {
        if (rnd() < 0.55) { // shuffle on the same stone
          const s = stones[idx], a = rnd() * TAU, d = rnd() * s.r * 0.5;
          return { x: s.x + Math.cos(a) * d, z: s.z + Math.sin(a) * d };
        }
        idx = clamp(idx + (rnd() < 0.5 ? -1 : 1), 0, stones.length - 1);
        return { x: stones[idx].x + (rnd() - 0.5) * 0.2, z: stones[idx].z + (rnd() - 0.5) * 0.2, far: true };
      },
    });
    birds.push(w);
  }
}
export function update(dt, t) {
  dfs?.update(dt, t);
  butterflies?.update(dt, t);
  flock.update(dt, t);
  egret.update(dt, t);
  for (const b of birds) b.update(dt, t, W.ground);
}
