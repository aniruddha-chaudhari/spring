// water/petals.js — (spring) sakura petals drifting on the stream, many gathered into soft rafts (hanaikada)
// that circle in the pond and collect along the still edges.
import * as THREE from 'three';
import { streamSamples, streamPoint, borderDist, WATER_Y, mulberry32, U, S_POND, patchMaterial } from '../world.js';
import { flowAt, obstacles } from './flow.js';

function dilateAtlas(g, S) {
  // canvas pixels are premultiplied; push petal colours into the transparent texels so mip edges don't go dark
  const id = g.getImageData(0, 0, S, S), d = id.data;
  const has = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) has[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let i = 0; i < S * S; i++) if (has[i] && d[i * 4 + 3] < 255) { const a = d[i * 4 + 3] / 255; for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(255, d[i * 4 + k] / a); }
  for (let pass = 0; pass < 10; pass++) {
    const next = has.slice();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; if (has[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
        const j = Y * S + X; if (!has[j]) continue;
        r += d[j * 4]; gg += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
      }
      if (n) { d[i * 4] = r / n; d[i * 4 + 1] = gg / n; d[i * 4 + 2] = b / n; d[i * 4 + 3] = 0; next[i] = 1; }
    }
    has.set(next);
  }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
function drawPetal(g, cx, cy, R, base, tip, notch = 0.16) {
  // obovate sakura petal: narrow at the base (bottom), wide rounded top with a small notch
  const grd = g.createLinearGradient(cx, cy + R, cx, cy - R);
  grd.addColorStop(0, base); grd.addColorStop(0.55, tip); grd.addColorStop(1, tip);
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(cx, cy + R * 0.95);
  g.bezierCurveTo(cx - R * 0.35, cy + R * 0.6, cx - R * 0.85, cy - R * 0.1, cx - R * 0.62, cy - R * 0.72);
  g.quadraticCurveTo(cx - R * 0.35, cy - R * 1.02, cx - R * 0.08, cy - R * 0.92);
  g.lineTo(cx, cy - R * (0.92 - notch));
  g.lineTo(cx + R * 0.08, cy - R * 0.92);
  g.quadraticCurveTo(cx + R * 0.35, cy - R * 1.02, cx + R * 0.62, cy - R * 0.72);
  g.bezierCurveTo(cx + R * 0.85, cy - R * 0.1, cx + R * 0.35, cy + R * 0.6, cx, cy + R * 0.95);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(220,120,150,0.18)'; g.lineWidth = R * 0.02;
  for (const a of [-0.35, 0, 0.35]) { g.beginPath(); g.moveTo(cx, cy + R * 0.9); g.quadraticCurveTo(cx + a * R * 0.4, cy, cx + a * R, cy - R * 0.75); g.stroke(); }
}
function petalAtlas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const h = S / 2, R = h * 0.44;
  drawPetal(g, h * 0.5, h * 0.5, R, '#ee8fae', '#ffe4ec');
  drawPetal(g, h * 1.5, h * 0.5, R, '#f7c0d0', '#ffffff', 0.12);
  drawPetal(g, h * 0.5, h * 1.5, R, '#ea8fab', '#ffd9e4', 0.2);
  drawPetal(g, h * 1.5, h * 1.5, R * 0.9, '#f5b3c8', '#ffeef3');
  return dilateAtlas(g, S);
}

export function createPetals({ rafts = 16, perRaft = 34, loose = 300 } = {}) {
  const rnd = mulberry32(91);
  let sIn = Infinity, sOut = -Infinity;
  for (const p of streamSamples) if (borderDist(p.x, p.z) < -2) { sIn = Math.min(sIn, p.s); sOut = Math.max(sOut, p.s); }
  const count = rafts * perRaft + loose;
  const geo = new THREE.PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2);
  { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.12 * x * x + 0.04 * z * z); } geo.computeVertexNormals(); }
  const atlas = new Float32Array(count * 2);
  geo.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlas, 2));
  const map = petalAtlas();
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.3, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  patchMaterial(mat, 'leafAtlas', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aAtlas;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * 0.5 + aAtlas;\n#endif');
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'water-petals';

  const types = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
  const col = new THREE.Color();
  const D = [];            // drifters: rafts first, then loose petals
  function place(l, s0, s1, spread) {
    const s = s0 + rnd() * (s1 - s0);
    const p = streamPoint(s);
    const off = (rnd() * 2 - 1) * Math.max(0.2, p.hw - 0.6) * spread;
    l.x = p.x + p.nx * off; l.z = p.z + p.nz * off; l.vx = 0; l.vz = 0;
  }
  for (let r = 0; r < rafts; r++) {
    const l = { raft: true, rad: 0.35 + rnd() * 0.45, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.25, ph: rnd() * 6.28, x: 0, z: 0, vx: 0, vz: 0, petals: [] };
    if (rnd() < 0.55) place(l, S_POND - 8, S_POND + 8, 0.9); else place(l, sIn, sOut - 3, 0.9);
    for (let k = 0; k < perRaft; k++) {
      // petals clumped toward the raft centre, elongated along a random axis
      const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * l.rad * (0.6 + 0.4 * rnd());
      l.petals.push({ ox: Math.cos(a) * rr * 1.35, oz: Math.sin(a) * rr * 0.75, rot: rnd() * 6.28, ph: rnd() * 6.28 });
    }
    D.push(l);
  }
  for (let i = 0; i < loose; i++) {
    const l = { raft: false, rad: 0.05, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 1.6, ph: rnd() * 6.28, x: 0, z: 0, vx: 0, vz: 0 };
    if (rnd() < 0.45) place(l, S_POND - 9, S_POND + 9, 0.9); else place(l, sIn, sOut - 3, 0.85);
    D.push(l);
  }
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const ty = Math.floor(rnd() * 4);
    atlas[i * 2] = types[ty][0]; atlas[i * 2 + 1] = types[ty][1];
    sizes[i] = 0.1 + rnd() * 0.05;
    const v = 0.9 + rnd() * 0.12;
    col.setRGB(v, v * (0.94 + rnd() * 0.06), v * (0.96 + rnd() * 0.04));
    mesh.setColorAt(i, col);
  }

  const fl = { x: 0, z: 0, speed: 0, wake: 0, turb: 0, st: null };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  function drift(l, dt, t) {
    flowAt(l.x, l.z, fl);
    const st = fl.st;
    const wd = U.uWindDir.value, ws = U.uWindStrength.value;
    const k = Math.min(1, dt * (l.raft ? 1.0 : 1.6));
    const wander = l.raft ? 0.012 : 0.03;
    let tx = fl.x + wd.x * 0.035 * ws + Math.sin(t * 0.37 + l.ph * 3) * wander;
    let tz = fl.z + wd.y * 0.035 * ws + Math.cos(t * 0.31 + l.ph * 5) * wander;
    // in still water, petals slowly gather along the edges
    const nx = -st.tz * st.side, nz = st.tx * st.side;       // away from the centreline
    const still = 1 - Math.min(1, fl.speed / 0.3);
    tx += nx * 0.05 * still; tz += nz * 0.05 * still;
    l.vx += (tx - l.vx) * k; l.vz += (tz - l.vz) * k;
    l.x += l.vx * dt; l.z += l.vz * dt;
    const lim = st.hw - 0.3 - l.rad * 0.8;
    if (st.d > lim) {
      const pen = Math.min(st.d - lim, 1);
      l.x -= nx * pen * Math.min(1, dt * 4); l.z -= nz * pen * Math.min(1, dt * 4);
      l.vx -= nx * pen * 0.5 * dt; l.vz -= nz * pen * 0.5 * dt;
    }
    for (const o of obstacles) {
      const dx = l.x - o.x, dz = l.z - o.z, d = Math.hypot(dx, dz), rr = o.r + l.rad * 0.8 + 0.04;
      if (d < rr && d > 1e-4) { l.x = o.x + dx / d * rr; l.z = o.z + dz / d * rr; }
    }
    l.rot += l.spin * dt * (0.25 + Math.min(fl.speed, 1.5));
    if (st.s > sOut - 1 || borderDist(l.x, l.z) > -1.5 || st.d > st.hw + 0.5) place(l, sIn, sIn + 14, 0.8);
    return fl;
  }
  function put(i, x, z, y, rot, tilt, t, ph, size) {
    pos.set(x, y, z);
    e.set(Math.sin(t * 1.3 + ph) * tilt, rot, Math.cos(t * 1.1 + ph * 1.7) * tilt);
    q.setFromEuler(e);
    sc.setScalar(size);
    mesh.setMatrixAt(i, m4.compose(pos, q, sc));
  }
  function update(dt, t) {
    dt = Math.min(dt, 0.05);
    let i = 0;
    for (const l of D) {
      const f = drift(l, dt, t);
      const bobA = 0.003 + 0.006 * Math.min(f.speed, 1.2);
      const turb = f.turb;
      if (l.raft) {
        const c = Math.cos(l.rot), s = Math.sin(l.rot);
        for (const p of l.petals) {
          const jx = Math.sin(t * 0.7 + p.ph) * 0.02, jz = Math.cos(t * 0.6 + p.ph * 1.3) * 0.02;
          const ox = p.ox + jx, oz = p.oz + jz;
          const x = l.x + ox * c - oz * s, z = l.z + ox * s + oz * c;
          put(i, x, z, WATER_Y + 0.008 + Math.sin(t * 1.9 + l.ph + p.ox * 3) * bobA + (p.ph % 1) * 0.003, p.rot + l.rot, 0.08, t, p.ph, sizes[i]);
          i++;
        }
      } else {
        put(i, l.x, l.z, WATER_Y + 0.008 + Math.sin(t * 1.9 + l.ph) * bobA, l.rot, 0.12 + turb * 0.3, t, l.ph, sizes[i]);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  return { mesh, update };
}
