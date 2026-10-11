// water/leaves.js — fallen maple / ginkgo leaves drifting on the stream, circling in the pond.
import * as THREE from 'three';
import { streamSamples, streamAt, streamPoint, borderDist, WATER_Y, mulberry32, U, S_POND, patchMaterial } from '../world.js';
import { flowAt, obstacles } from './flow.js';

// ------------------------------------------------------------- leaf atlas (2x2 cells)
function drawMaple(g, cx, cy, R, colA, colB, lobes = 7) {
  const span = lobes === 7 ? Math.PI * 1.55 : Math.PI * 1.3;
  const grd = g.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
  grd.addColorStop(0, colB); grd.addColorStop(0.55, colA); grd.addColorStop(1, colA);
  g.fillStyle = grd;
  const lob = [];
  for (let i = 0; i < lobes; i++) {
    const u = i / (lobes - 1);
    const ang = -Math.PI / 2 - span / 2 + u * span;                 // canvas: -y is up
    const len = R * (1 - 0.45 * Math.pow(Math.abs(u - 0.5) * 2, 2.0));
    lob.push({ ang, len });
    const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
    const w = len * 0.3;                                              // lanceolate lobe, widest at ~45%
    const mx = cx + dx * len * 0.45, my = cy + dy * len * 0.45;
    g.beginPath();
    g.moveTo(cx + px * w * 0.25, cy + py * w * 0.25);
    g.bezierCurveTo(mx + px * w * 1.2, my + py * w * 1.2, cx + dx * len * 0.8 + px * w * 0.35, cy + dy * len * 0.8 + py * w * 0.35, cx + dx * len, cy + dy * len);
    g.bezierCurveTo(cx + dx * len * 0.8 - px * w * 0.35, cy + dy * len * 0.8 - py * w * 0.35, mx - px * w * 1.2, my - py * w * 1.2, cx - px * w * 0.25, cy - py * w * 0.25);
    g.closePath(); g.fill();
  }
  g.beginPath(); g.arc(cx, cy, R * 0.2, 0, Math.PI * 2); g.fill();
  // veins + stem
  g.strokeStyle = 'rgba(90,20,5,0.22)'; g.lineWidth = R * 0.02;
  for (const l of lob) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(l.ang) * l.len * 0.85, cy + Math.sin(l.ang) * l.len * 0.85); g.stroke(); }
  g.strokeStyle = colA; g.lineWidth = R * 0.045;
  g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + R * 0.05, cy + R * 0.35, cx - R * 0.03, cy + R * 0.55); g.stroke();
}
function drawGinkgo(g, cx, cy, R, colA, colB) {
  const by = cy + R * 0.55;                        // stem base
  const grd = g.createRadialGradient(cx, by, R * 0.1, cx, by, R * 1.3);
  grd.addColorStop(0, colB); grd.addColorStop(1, colA);
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(cx, by);
  const n = 60;
  for (let k = 0; k <= n; k++) {
    const u = k / n, a = -Math.PI / 2 + (u - 0.5) * 2 * 0.95;
    let r = R * 1.05 * (1 - 0.18 * Math.exp(-(((u - 0.5) / 0.035) ** 2))) * (1 + 0.025 * Math.sin(u * 70));
    g.lineTo(cx + Math.cos(a) * r, by + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(120,90,10,0.25)'; g.lineWidth = R * 0.012;
  for (let k = 0; k < 16; k++) { const a = -Math.PI / 2 + (k / 15 - 0.5) * 1.8; g.beginPath(); g.moveTo(cx, by); g.lineTo(cx + Math.cos(a) * R, by + Math.sin(a) * R); g.stroke(); }
  g.strokeStyle = colA; g.lineWidth = R * 0.05;
  g.beginPath(); g.moveTo(cx, by); g.lineTo(cx + R * 0.05, by + R * 0.4); g.stroke();
}
function leafAtlas() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const h = S / 2, R = h * 0.47;
  drawMaple(g, h * 0.5, h * 0.52, R, '#d01c0c', '#ff7a30');          // red maple
  drawMaple(g, h * 1.5, h * 0.52, R, '#f06a0c', '#ffc848');          // orange maple
  drawGinkgo(g, h * 0.5, h * 1.42, R * 0.95, '#e8b010', '#fff27a');  // ginkgo yellow
  drawMaple(g, h * 1.5, h * 1.52, R, '#a5101a', '#f03c22', 5);       // deep crimson, 5 lobes
  // canvas pixels are premultiplied: transparent texels are black and would darken the mipmapped edges.
  // Dilate the leaf colours outward into the transparent texels (alpha stays 0).
  const id = g.getImageData(0, 0, S, S), d = id.data;
  const has = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) has[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let i = 0; i < S * S; i++) if (has[i] && d[i * 4 + 3] < 255) { const a = d[i * 4 + 3] / 255; for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(255, d[i * 4 + k] / a); }
  for (let pass = 0; pass < 12; pass++) {
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
  return t;   // NB: row 0 = canvas top = v 0
}

// ------------------------------------------------------------- simulation
export function createLeaves(count = 170) {
  const rnd = mulberry32(77);
  // stretch of stream inside the glade
  let sIn = Infinity, sOut = -Infinity;
  for (const p of streamSamples) if (borderDist(p.x, p.z) < -2) { sIn = Math.min(sIn, p.s); sOut = Math.max(sOut, p.s); }

  const geo = new THREE.PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2);
  { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.16 * (x * x + z * z) + 0.05 * x * x); } geo.computeVertexNormals(); }
  const atlas = new Float32Array(count * 2);
  geo.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlas, 2));
  const map = leafAtlas();
  // a little emissive = light glowing through the thin leaves (keeps the colours vivid when backlit)
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.28, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0 });
  patchMaterial(mat, 'leafAtlas', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aAtlas;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * 0.5 + aAtlas;\n#endif');
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'water-leaves';

  const L = [];
  const types = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];   // UV offsets of the atlas cells (row 0 = canvas top)
  const col = new THREE.Color();
  function place(l, s0, s1, spread) {
    const s = s0 + rnd() * (s1 - s0);
    const p = streamPoint(s);
    const off = (rnd() * 2 - 1) * Math.max(0.2, p.hw - 0.5) * spread;
    l.x = p.x + p.nx * off; l.z = p.z + p.nz * off;
    l.vx = 0; l.vz = 0;
  }
  for (let i = 0; i < count; i++) {
    const r = rnd();
    const type = r < 0.38 ? 0 : r < 0.66 ? 1 : r < 0.84 ? 2 : 3;
    const l = { type, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 1.2, size: 0.26 + rnd() * 0.14, ph: rnd() * 6.28, tilt: rnd() * 0.25, x: 0, z: 0, vx: 0, vz: 0 };
    if (rnd() < 0.4) place(l, S_POND - 9, S_POND + 9, 0.85); else place(l, sIn, sOut - 3, 0.8);
    atlas[i * 2] = types[type][0]; atlas[i * 2 + 1] = types[type][1];
    const v = 0.82 + rnd() * 0.3;
    col.setRGB(v * (0.95 + rnd() * 0.1), v * (0.9 + rnd() * 0.15), v * (0.9 + rnd() * 0.1));
    mesh.setColorAt(i, col);
    L.push(l);
  }
  const fl = { x: 0, z: 0, speed: 0, wake: 0, turb: 0, st: null };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3(), pos = new THREE.Vector3();

  function update(dt, t) {
    dt = Math.min(dt, 0.05);
    const wd = U.uWindDir.value, ws = U.uWindStrength.value;
    for (let i = 0; i < count; i++) {
      const l = L[i];
      flowAt(l.x, l.z, fl);
      const st = fl.st;
      // drag toward the local current + a little wind push + wander
      const k = Math.min(1, dt * 1.6);
      const wander = 0.025;
      l.vx += (fl.x + wd.x * 0.03 * ws + Math.sin(t * 0.37 + l.ph * 3) * wander - l.vx) * k;
      l.vz += (fl.z + wd.y * 0.03 * ws + Math.cos(t * 0.31 + l.ph * 5) * wander - l.vz) * k;
      l.x += l.vx * dt; l.z += l.vz * dt;
      // keep off the banks
      const lim = st.hw - 0.35;
      if (st.d > lim) {
        const nx = -st.tz * st.side, nz = st.tx * st.side;   // points away from the centreline
        const pen = Math.min(st.d - lim, 1);
        l.x -= nx * pen * Math.min(1, dt * 4); l.z -= nz * pen * Math.min(1, dt * 4);
        l.vx -= nx * pen * 0.5 * dt; l.vz -= nz * pen * 0.5 * dt;
      }
      // keep out of stones / rocks
      for (const o of obstacles) {
        const dx = l.x - o.x, dz = l.z - o.z, d = Math.hypot(dx, dz), rr = o.r + l.size * 0.45;
        if (d < rr && d > 1e-4) { l.x = o.x + dx / d * rr; l.z = o.z + dz / d * rr; }
      }
      l.rot += l.spin * dt * (0.25 + Math.min(fl.speed, 1.5)) + (fl.turb > 0.2 ? Math.sin(t * 3 + l.ph) * dt * fl.turb * 3 : 0);
      // respawn upstream once it leaves the glade
      if (st.s > sOut - 1 || borderDist(l.x, l.z) > -1.5 || st.d > st.hw + 0.5) place(l, sIn, sIn + 14, 0.8);
      // bob on the ripples
      const bob = Math.sin(t * 1.9 + l.ph) * (0.004 + 0.008 * Math.min(fl.speed, 1.2)) + fl.turb * Math.sin(t * 5.3 + l.ph * 2) * 0.012;
      pos.set(l.x, WATER_Y + 0.012 + bob, l.z);
      const tl = l.tilt * 0.25 + fl.turb * 0.25;
      e.set(Math.sin(t * 1.3 + l.ph) * tl, l.rot, Math.cos(t * 1.1 + l.ph * 1.7) * tl);
      q.setFromEuler(e);
      sc.setScalar(l.size);
      mesh.setMatrixAt(i, m4.compose(pos, q, sc));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  return { mesh, update };
}
