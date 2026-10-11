// life/leaves.js — autumn: maple and ginkgo leaves detaching from the crowns, fluttering down on the gusts,
// resting on the ground (then fading) or floating away down the stream. Two InstancedMeshes, CPU-simulated.
// spring: sakura petals instead — light, carried in long gusty streams (hanafubuki), fading on the ground and
// vanishing at the water surface (the water module owns the floating petal rafts).
import * as THREE from 'three';
import { ANCHORS, WATER_Y, U, windGustAt, mulberry32, groundHeight, patchMaterial, applyCloudShadows, IS_SPRING } from '../world.js';
import { groundAt, waterDist, flowX, flowZ, inNear, W, TAU } from './common.js';

const FREE = 0, FALL = 1, GROUND = 2, FLOAT = 3;

// ---------------------------------------------------------------- textures (white-ish, tinted per instance)
function leafCanvas(kind) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  const P = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
  const grad = g.createRadialGradient(0, 8, 2, 0, 0, 60);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.6, '#f2eee8'); grad.addColorStop(1, '#cfc6bc');
  g.fillStyle = grad;
  g.strokeStyle = 'rgba(70,40,20,0.28)';
  if (kind === 'maple') {
    // seven pointed lobes (Japanese maple), centre lobe longest
    const lobes = 7, cy = 8;
    g.translate(0, cy);
    const ang = [], len = [];
    for (let i = 0; i < lobes; i++) { const a = (-1 + (2 * i) / (lobes - 1)) * 2.45; ang.push(a); len.push(58 * (0.5 + 0.5 * Math.cos(a * 0.55))); }
    g.beginPath();
    let p = P(-2.95, 9); g.moveTo(p[0], p[1]);
    for (let i = 0; i < lobes; i++) {
      const a = ang[i], L = len[i];
      const c1 = P(a - 0.2, L * 0.62), tip = P(a, L), c2 = P(a + 0.2, L * 0.62);
      g.quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]);
      const na = i < lobes - 1 ? (a + ang[i + 1]) / 2 : 2.95, nr = i < lobes - 1 ? L * 0.3 : 9;
      const n = P(na, nr);
      g.quadraticCurveTo(c2[0], c2[1], n[0], n[1]);
    }
    g.closePath(); g.fill();
    g.lineWidth = 1.6;
    for (let i = 0; i < lobes; i++) { const tip = P(ang[i], len[i] * 0.9); g.beginPath(); g.moveTo(0, 0); g.lineTo(tip[0], tip[1]); g.stroke(); }
    g.lineWidth = 3; g.strokeStyle = 'rgba(90,50,25,0.6)';
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(2, 25, -3, 52); g.stroke();
  } else if (kind === 'petal') {
    // sakura petal: rounded, with the little notch at the tip; pinker toward the base (texture carries the colour)
    const pg = g.createLinearGradient(0, 54, 0, -54);
    pg.addColorStop(0, '#ee98b2'); pg.addColorStop(0.35, '#fbd3df'); pg.addColorStop(0.75, '#fff3f6'); pg.addColorStop(1, '#ffe6ee');
    g.fillStyle = pg;
    g.beginPath(); g.moveTo(0, 54);
    g.bezierCurveTo(-30, 42, -56, -18, -24, -50);
    g.quadraticCurveTo(-9, -58, 0, -42);
    g.quadraticCurveTo(9, -58, 24, -50);
    g.bezierCurveTo(56, -18, 30, 42, 0, 54);
    g.closePath(); g.fill();
    g.lineWidth = 0.8; g.strokeStyle = 'rgba(200,90,120,0.18)';
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(0, 50); g.quadraticCurveTo(k * 9, 0, k * 11, -44 + Math.abs(k) * 3); g.stroke(); }
  } else {
    // ginkgo fan with a central notch
    const bx = 0, by = 34, R = 74, A = 1.1;
    g.beginPath(); g.moveTo(bx, by);
    g.arc(bx, by, R, -Math.PI / 2 - A, -Math.PI / 2 - 0.07);
    g.lineTo(bx, by - R * 0.72);
    g.arc(bx, by, R, -Math.PI / 2 + 0.07, -Math.PI / 2 + A);
    g.closePath(); g.fill();
    g.lineWidth = 0.9; g.strokeStyle = 'rgba(90,60,10,0.22)';
    for (let k = -14; k <= 14; k++) { const a = (k / 14) * A; const p = [bx + Math.sin(a) * R * 0.97, by - Math.cos(a) * R * 0.97]; g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(p[0], p[1]); g.stroke(); }
    g.lineWidth = 3; g.strokeStyle = 'rgba(110,80,20,0.6)';
    g.beginPath(); g.moveTo(bx, by - 2); g.lineTo(bx + 1, 62); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.07 * (1 - Math.abs(x) * 2) - 0.05 * z * z);   // V-fold along the midrib + slight curl
  }
  g.computeVertexNormals();
  return g;
}

function leafMaterial(tex, petal = false) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: petal ? 0.85 : 0.72, metalness: 0 });
  // thin-leaf translucency: glow when the sun is behind the leaf (golden-hour backlight); softer for petals
  const sss = petal ? '0.25' : '0.6';
  patchMaterial(m, petal ? 'lifePetalSSS' : 'lifeLeafSSS', (shader) => {
    shader.uniforms.uSunDir = U.uSunDir; shader.uniforms.uSunColor = U.uSunColor;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      { vec3 sv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float back = max(dot(-normal, sv), 0.0);
        float behind = pow(max(dot(normalize(vViewPosition), sv), 0.0), 2.0);
        reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * (0.35 * back + 0.5 * behind * back) * ${sss}; }`);
  });
  if (petal) {
    // un-darken the mips: transparent texels are black, so small/distant petals would turn into dark specks
    patchMaterial(m, 'lifePetalMip', (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb /= max(sampledDiffuseColor.a, 0.15);');
    });
  }
  applyCloudShadows(m);
  return m;
}

// ---------------------------------------------------------------- pool
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _ax = new THREE.Vector3(), _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);

class Pool {
  constructor(n, kind, palette, rnd) {
    this.n = n; this.kind = kind; this.rnd = rnd; this.cursor = 0; this.petal = kind === 'petal';
    this.mesh = new THREE.InstancedMesh(leafGeometry(), leafMaterial(leafCanvas(kind), this.petal), n);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = `life-leaves-${kind}`;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.set(palette[Math.floor(rnd() * palette.length)]);
      c.offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.08);
      this.mesh.setColorAt(i, c);
    }
    const F = () => new Float32Array(n);
    Object.assign(this, {
      st: new Uint8Array(n), x: F(), y: F(), z: F(), vx: F(), vz: F(), age: F(), life: F(), size: F(), fall: F(),
      ph: F(), swA: F(), swF: F(), dir: F(), spir: F(), yaw: F(), spin: F(), tum: F(), tumR: F(), tilt: F(),
      qx: F(), qy: F(), qz: F(), qw: F(), rx: F(), rz: F(),
    });
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _m);
  }
  alloc() {
    for (let k = 0; k < this.n; k++) {
      const i = (this.cursor + k) % this.n;
      if (this.st[i] === FREE) { this.cursor = (i + 1) % this.n; return i; }
    }
    // pool full: recycle the oldest grounded leaf
    let best = -1, ba = -1;
    for (let i = 0; i < this.n; i++) if (this.st[i] === GROUND && this.age[i] / this.life[i] > ba) { ba = this.age[i] / this.life[i]; best = i; }
    return best;
  }
  spawn(x, y, z, vx, vz) {
    const i = this.alloc(); if (i < 0) return -1;
    const r = this.rnd, maple = this.kind === 'maple';
    this.st[i] = FALL; this.age[i] = 0; this.life[i] = 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vz[i] = vz;
    if (this.petal) {
      // light petals: slow sink, quick small flutter, lots of spinning and tumbling
      this.size[i] = 0.03 + r() * 0.02;
      this.fall[i] = 0.22 + r() * 0.22;
      this.ph[i] = r() * TAU; this.swA[i] = 0.06 + r() * 0.16; this.swF[i] = 2.5 + r() * 3.5;
      this.dir[i] = r() * TAU; this.spir[i] = (r() - 0.5) * 3;
      this.yaw[i] = r() * TAU; this.spin[i] = (r() - 0.5) * 6;
      this.tum[i] = r() * TAU; this.tumR[i] = r() < 0.55 ? (r() < 0.5 ? -1 : 1) * (4 + r() * 10) : 0;
      this.tilt[i] = 0.5 + r() * 0.7;
      return i;
    }
    this.size[i] = maple ? 0.24 + r() * 0.12 : 0.21 + r() * 0.09;
    this.fall[i] = 0.5 + r() * 0.45;
    this.ph[i] = r() * TAU; this.swA[i] = 0.22 + r() * 0.5; this.swF[i] = 1.7 + r() * 1.7;
    this.dir[i] = r() * TAU; this.spir[i] = (r() - 0.5) * 1.4;
    this.yaw[i] = r() * TAU; this.spin[i] = (r() - 0.5) * 2.6;
    this.tum[i] = 0; this.tumR[i] = r() < 0.25 ? (r() < 0.5 ? -1 : 1) * (6 + r() * 9) : 0;
    this.tilt[i] = 0.45 + r() * 0.55;
    return i;
  }
  // place directly on the ground (initial carpet)
  settle(i, x, z, ageFrac) {
    this.x[i] = x; this.z[i] = z; this.rx[i] = x; this.rz[i] = z;
    this.land(i, this.rnd);
    this.age[i] = this.life[i] * ageFrac;
  }
  land(i, r) {
    const x = this.rx[i], z = this.rz[i];
    const h = groundAt(x, z);
    this.x[i] = x; this.z[i] = z;
    if (h < WATER_Y - 0.03 && waterDist(x, z) < -0.05) {
      this.st[i] = FLOAT; this.life[i] = this.petal ? 0.35 : 35 + r() * 40; this.y[i] = WATER_Y + 0.012;
      _q.setFromAxisAngle(UP, this.yaw[i]);
    } else {
      this.st[i] = GROUND; this.life[i] = this.petal ? 8 + r() * 16 : 16 + r() * 24; this.y[i] = h + 0.012 + r() * 0.012;
      const dx = groundAt(x + 0.35, z) - groundAt(x - 0.35, z), dz = groundAt(x, z + 0.35) - groundAt(x, z - 0.35);
      _n.set(-dx, 0.7, -dz).normalize();
      _n.x += (r() - 0.5) * 0.25; _n.z += (r() - 0.5) * 0.25; _n.normalize();
      _q.setFromUnitVectors(UP, _n); _q2.setFromAxisAngle(UP, this.yaw[i]); _q.multiply(_q2);
      if (r() < 0.3) { _q2.setFromAxisAngle(XA, Math.PI); _q.multiply(_q2); this.y[i] += 0.01; } // some land upside-down
    }
    this.age[i] = 0;
    this.qx[i] = _q.x; this.qy[i] = _q.y; this.qz[i] = _q.z; this.qw[i] = _q.w;
    this.write(i, x, this.y[i], z, _q, this.size[i]);
  }
  write(i, x, y, z, q, s) {
    _p.set(x, y, z); _s.set(s, s, s);
    _m.compose(_p, q, _s);
    _m.toArray(this.mesh.instanceMatrix.array, i * 16);
  }
  update(dt, t) {
    const wx = U.uWindDir.value.x, wz = U.uWindDir.value.y, ws = U.uWindStrength.value;
    const petal = this.petal, relax = 1 - Math.exp(-dt * (petal ? 2.6 : 1.3));
    const fadeT = petal ? 0.35 : 2;
    const r = this.rnd;
    for (let i = 0; i < this.n; i++) {
      const st = this.st[i];
      if (st === FREE) continue;
      this.age[i] += dt;
      if (st === FALL) {
        const g = windGustAt(this.x[i], this.z[i], t);
        const sp = (petal ? 0.35 + 3.6 * g * g : 0.25 + 2.1 * g * g) * ws;
        this.vx[i] += (wx * sp - this.vx[i]) * relax;
        this.vz[i] += (wz * sp - this.vz[i]) * relax;
        this.ph[i] += dt * this.swF[i]; this.dir[i] += dt * this.spir[i];
        const s = Math.sin(this.ph[i]), c = Math.cos(this.ph[i]);
        this.x[i] += this.vx[i] * dt; this.z[i] += this.vz[i] * dt;
        this.y[i] += (-this.fall[i] * (0.4 + 0.9 * Math.abs(c)) + g * g * (petal ? 0.75 : 0.5) * ws) * dt;
        const cd = Math.cos(this.dir[i]), sd = Math.sin(this.dir[i]);
        const px = this.x[i] + cd * this.swA[i] * s, pz = this.z[i] + sd * this.swA[i] * s;
        this.rx[i] = px; this.rz[i] = pz;
        const floor = Math.max(groundAt(px, pz), WATER_Y);
        if (this.y[i] <= floor + 0.03 || this.age[i] > 60) { this.land(i, r); continue; }
        this.tum[i] += this.tumR[i] * dt;
        _ax.set(-sd, 0, cd);
        _q.setFromAxisAngle(_ax, this.tilt[i] * s);
        _q2.setFromAxisAngle(UP, this.yaw[i] + this.spin[i] * this.age[i]); _q.multiply(_q2);
        if (this.tumR[i] !== 0) { _q2.setFromAxisAngle(XA, this.tum[i]); _q.multiply(_q2); }
        const grow = Math.min(1, this.age[i] / 0.5);
        this.write(i, px, this.y[i], pz, _q, this.size[i] * grow);
      } else {
        if (st === FLOAT && petal) {
          _q.setFromAxisAngle(UP, this.yaw[i]);              // petal touching the water: just vanish
        } else if (st === FLOAT) {
          const x = this.x[i], z = this.z[i];
          let fx = flowX(x, z), fz = flowZ(x, z);
          const nx = x + fx * dt, nz = z + fz * dt;
          if (waterDist(nx, nz) < -0.08) { this.x[i] = nx; this.z[i] = nz; }
          this.yaw[i] += dt * 0.25 * Math.sin(this.ph[i] + this.age[i] * 0.3);
          if (!inNear(this.x[i], this.z[i]) && this.life[i] - this.age[i] > 1.5) this.age[i] = this.life[i] - 1.5;
          _q.setFromAxisAngle(UP, this.yaw[i]);
          _q2.setFromAxisAngle(XA, Math.sin(t * 1.7 + this.ph[i]) * 0.06); _q.multiply(_q2);
          this.y[i] = WATER_Y + 0.012 + Math.sin(t * 2.1 + this.ph[i]) * 0.004;
        } else {
          _q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]);
        }
        const rem = this.life[i] - this.age[i];
        if (rem <= 0) { this.st[i] = FREE; _m.makeScale(0, 0, 0); _m.toArray(this.mesh.instanceMatrix.array, i * 16); continue; }
        if (st === GROUND && rem > fadeT) continue; // static: matrix already written
        const fade = Math.min(1, rem / fadeT);
        this.write(i, this.x[i], this.y[i] - (1 - fade) * 0.02, this.z[i], _q, this.size[i] * fade);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- module
const MAPLE = ['#c81e10', '#d8281a', '#b0140e', '#e2401a', '#ee6a1e', '#d03a16', '#9c1812', '#f08a24', '#e3a032'];
const GINKGO = ['#f2c230', '#eab21c', '#f6d24a', '#d9a018', '#f0c840'];
const PETAL = ['#ffffff', '#fff4f7', '#ffe9ef', '#ffdfe8', '#fbe8ee', '#ffd6e2'];
let maple, ginkgo, petals, trees = [], rnd, blowAcc = 0;

export function init(root) {
  rnd = mulberry32(4242);
  if (IS_SPRING) return initSpring(root);
  maple = new Pool(460, 'maple', MAPLE, rnd);
  ginkgo = new Pool(170, 'ginkgo', GINKGO, rnd);
  root.add(maple.mesh, ginkgo.mesh);
  for (const tr of ANCHORS.trees) {
    if (tr.type !== 'maple' && tr.type !== 'ginkgo') continue;
    const s = tr.s || 1, gy = groundHeight(tr.x, tr.z);
    trees.push({
      pool: tr.type === 'maple' ? maple : ginkgo,
      cx: tr.x + (tr.lean?.x || 0) * 1.4 * s, cz: tr.z + (tr.lean?.z || 0) * 1.4 * s, cy: gy + 4.9 * s,
      rh: 3.0 * s, rv: 1.4 * s, rate: (tr.type === 'maple' ? 0.75 : 0.9) * s, acc: rnd(), gx: tr.x, gz: tr.z,
    });
  }
  // start alive: a carpet under each tree and some leaves already in the air
  for (const tr of trees) {
    for (let k = 0; k < 30; k++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * tr.rh * 1.25;
      const x = tr.cx + Math.cos(a) * d, z = tr.cz + Math.sin(a) * d;
      const i = tr.pool.alloc(); if (i < 0) break;
      tr.pool.spawn(x, 0, z, 0, 0); tr.pool.settle(i, x, z, rnd() * 0.85);
    }
    for (let k = 0; k < 4; k++) spawnFromTree(tr, rnd() * 0.85);
  }
  // write initial matrices
  update(0, 0);
}

function initSpring(root) {
  petals = new Pool(2600, 'petal', PETAL, rnd);
  root.add(petals.mesh);
  for (const tr of ANCHORS.trees) {
    if (tr.type !== 'sakura') continue;
    const s = tr.s || 1, gy = groundHeight(tr.x, tr.z);
    trees.push({
      pool: petals,
      cx: tr.x + (tr.lean?.x || 0) * 1.4 * s, cz: tr.z + (tr.lean?.z || 0) * 1.4 * s, cy: gy + 4.6 * s,
      rh: 3.2 * s, rv: 1.5 * s, rate: 4.5 * s, acc: rnd(), gx: tr.x, gz: tr.z,
    });
  }
  for (const tr of trees) {
    for (let k = 0; k < 140; k++) {        // a pale carpet under each tree
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * tr.rh * 1.5;
      const x = tr.cx + Math.cos(a) * d, z = tr.cz + Math.sin(a) * d;
      if (groundAt(x, z) < WATER_Y) continue;
      const i = petals.alloc(); if (i < 0) break;
      petals.spawn(x, 0, z, 0, 0); petals.settle(i, x, z, rnd() * 0.85);
    }
    for (let k = 0; k < 30; k++) spawnFromTree(tr, rnd() * 0.9);
  }
  update(0, 0);
}

function spawnFromTree(tr, drop = 0) {
  const a = rnd() * TAU, d = Math.sqrt(rnd()) * tr.rh;
  const x = tr.cx + Math.cos(a) * d, z = tr.cz + Math.sin(a) * d;
  const y = tr.cy + (rnd() - 0.4) * tr.rv * 2 - drop * (tr.cy - groundAt(x, z));
  return tr.pool.spawn(x, y, z, 0, 0);
}

export function update(dt, t) {
  if (IS_SPRING) return updateSpring(dt, t);
  const ws = U.uWindStrength.value, wk = W.leaf;
  for (const tr of trees) {
    const g = windGustAt(tr.gx, tr.gz, t);
    tr.acc += dt * tr.rate * wk * (0.3 + 2.2 * g * g * g) * (0.5 + 0.5 * ws);
    while (tr.acc >= 1) { tr.acc -= 1; spawnFromTree(tr); }
  }
  // leaves blowing in across the glade from off-screen (upwind)
  const wx = U.uWindDir.value.x, wz = U.uWindDir.value.y;
  const gUp = windGustAt(-wx * 30, -wz * 30, t);
  blowAcc += dt * 0.9 * wk * (0.2 + 2.5 * gUp * gUp) * ws;
  while (blowAcc >= 1) {
    blowAcc -= 1;
    const side = (rnd() - 0.5) * 70, d = 44 + rnd() * 8;
    const x = -wx * d - wz * side, z = -wz * d + wx * side;
    const pool = rnd() < 0.75 ? maple : ginkgo;
    pool.spawn(x, groundAt(x, z) + 3 + rnd() * 6, z, wx * 2.5, wz * 2.5);
  }
  maple.update(dt, t);
  ginkgo.update(dt, t);
}

// spring: a steady light fall from each sakura, and a petal blizzard (hanafubuki) whenever a gust passes
function updateSpring(dt, t) {
  const ws = U.uWindStrength.value, wk = W.leaf;
  for (const tr of trees) {
    const g = windGustAt(tr.gx, tr.gz, t);
    tr.acc += dt * tr.rate * wk * (0.12 + 7 * g * g * g) * (0.5 + 0.5 * ws);
    let guard = 0;
    while (tr.acc >= 1 && guard++ < 60) { tr.acc -= 1; spawnFromTree(tr); }
    if (tr.acc > 1) tr.acc = 1;
  }
  // long streams blowing across the glade from upwind during gusts
  const wx = U.uWindDir.value.x, wz = U.uWindDir.value.y;
  const gUp = windGustAt(-wx * 30, -wz * 30, t);
  blowAcc += dt * 3 * wk * (0.08 + 9 * gUp * gUp * gUp) * ws;
  let guard = 0;
  while (blowAcc >= 1 && guard++ < 40) {
    blowAcc -= 1;
    const side = (rnd() - 0.5) * 60, d = 40 + rnd() * 8;
    const x = -wx * d - wz * side, z = -wz * d + wx * side;
    petals.spawn(x, groundAt(x, z) + 2 + rnd() * 6, z, wx * 3, wz * 3);
  }
  if (blowAcc > 1) blowAcc = 1;
  petals.update(dt, t);
}
