// stones.js — stepping stones, boulders, bank stonework, path edging and pebbles along the water.
// Big stones are merged into the batch; the many small ones are instanced (a few shape variants each).
import {
  ANCHORS, groundHeight, WATER_Y, LAYER_REFRACT, S_POND, S_BRIDGE, S_STONES, S_RAPIDS, bankPoint, streamPoint, isWater, FOOTPRINTS,
} from '../world.js';
import { THREE, V3, M, rockGeo, jitter, mulberry32, TAU, lerp } from './kit.js';
import { IS_SPRING } from '../world.js';

// spring (onsen) stones: bigger, smoother, rounder masses
const SP = IS_SPRING ? { grow: 1.2, facets: 2, bump: 0.1, smooth: 2 } : null;

function inFootprint(x, z, pad = 0) {
  for (const f of FOOTPRINTS) {
    const dx = x - f.x, dz = z - f.z;
    const lx = dx * Math.cos(f.rot) - dz * Math.sin(f.rot), lz = dx * Math.sin(f.rot) + dz * Math.cos(f.rot);
    if (Math.abs(lx) < f.hx + pad && Math.abs(lz) < f.hz + pad) return true;
  }
  return false;
}

// Instanced stones: a handful of variants, instances distributed round-robin.
class StoneScatter {
  constructor(mat, variants) { this.mat = mat; this.variants = variants; this.items = variants.map(() => []); this.k = 0; }
  push(x, y, z, sx, sy, sz, ry, rx = 0, rz = 0, col = [1, 1, 1]) { this.items[this.k++ % this.variants.length].push({ x, y, z, sx, sy, sz, ry, rx, rz, col }); }
  build(parent, refract = true) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    this.variants.forEach((g, i) => {
      const list = this.items[i];
      if (!list.length) return;
      // the stone material expects a vertex colour attribute
      if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      const im = new THREE.InstancedMesh(g, this.mat, list.length);
      list.forEach((s, j) => {
        e.set(s.rx, s.ry, s.rz, 'YXZ'); q.setFromEuler(e);
        m4.compose(new V3(s.x, s.y, s.z), q, new V3(s.sx, s.sy, s.sz));
        im.setMatrixAt(j, m4);
        im.setColorAt(j, c.setRGB(s.col[0], s.col[1], s.col[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true; im.receiveShadow = true;
      if (refract) im.layers.enable(LAYER_REFRACT);
      parent.add(im);
    });
  }
}

export function buildStones(B, m, root) {
  const rnd = mulberry32(303);

  // ---- stepping stones: flat tops just above the water, bodies down to the bed
  ANCHORS.steppingStones.forEach((s, i) => {
    const g = groundHeight(s.x, s.z);
    const top = WATER_Y + 0.11 + (rnd() - 0.5) * 0.04;
    const bot = Math.min(g - 0.15, top - 0.35), h = top - bot;
    const sy = Math.max(h * 0.72, 0.3), ft = sy * 0.42;
    const geo = SP ? rockGeo(4000 + i, { detail: 3, scale: [s.r * 1.12, sy, s.r * 0.95], flatTop: ft, facets: 2, bump: 0.08, topSoft: 0.16, smooth: 2 })
      : rockGeo(4000 + i, { detail: 3, scale: [s.r * 1.0, sy, s.r * 0.84], flatTop: ft, facets: 4, bump: 0.12, topSoft: 0.12 });
    B.add(m.stone, geo, M(s.x, top - ft, s.z, s.rot, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.04), { tint: jitter(rnd, 0.08, 0.02), refract: true });
  });

  // ---- boulders: soft rounded, sunk into ground or bed, always breaking the surface
  for (const r of ANCHORS.rocks) {
    const g = groundHeight(r.x, r.z);
    let sy = r.s * 0.72;
    const top = Math.max(g + sy * 1.35, WATER_Y + 0.1 + sy * 0.3);
    sy = Math.max(sy, (top - g + 0.15) / 2);
    const geo = SP ? rockGeo(r.seed % 100000, { detail: 4, scale: [r.s * 1.2 * SP.grow, sy * 1.05, r.s * 0.95 * SP.grow], facets: SP.facets, bump: SP.bump, smooth: SP.smooth })
      : rockGeo(r.seed % 100000, { detail: r.s > 0.9 ? 4 : 3, scale: [r.s * 1.2, sy, r.s * 0.95], facets: 6, bump: 0.2 });
    B.add(m.stone, geo, M(r.x, top - sy, r.z, r.rot, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.15), { tint: jitter(rnd, 0.1, 0.03), refract: true });
  }

  // ---- instanced stone sets
  const wallVariants = [0, 1, 2, 3].map(k => SP ? rockGeo(5000 + k, { detail: 3, scale: [1, 0.68, 0.85], facets: 2, bump: 0.1, smooth: 2 }) : rockGeo(5000 + k, { detail: 2, scale: [1, 0.72, 0.85], facets: 5, bump: 0.16 }));
  const pebVariants = [0, 1, 2, 3, 4].map(k => SP ? rockGeo(6000 + k, { detail: 2, scale: [1, 0.55, 0.8], facets: 1, bump: 0.08, smooth: 2 }) : rockGeo(6000 + k, { detail: 1, scale: [1, 0.55, 0.8], facets: 3, bump: 0.14 }));
  const walls = new StoneScatter(m.stone, wallVariants);
  const pebbles = new StoneScatter(m.river, pebVariants);
  const grey = () => { const v = 0.82 + rnd() * 0.3, w = (rnd() - 0.5) * 0.08; return SP ? [0.95 + v * 0.1 + w, 0.95 + v * 0.08, 0.92 + v * 0.08 - w] : [v * (1 + w), v, v * (1 - w * 1.5)]; };

  // Bank stonework: two loose courses of rounded stones following the water edge.
  const bankRun = (s0, s1, side, size = 0.3) => {
    for (const course of [0, 1]) {
      let s = s0 + rnd() * 0.2;
      while (s < s1) {
        const sz = size * (0.6 + rnd() * rnd() * 0.9) * (course ? 0.85 : 1) * (SP ? 1.3 : 1);
        const off = course ? 0.32 + rnd() * 0.12 : -0.12 + rnd() * 0.1;
        const p = bankPoint(s, side, off);
        const g = groundHeight(p.x, p.z);
        const y = course ? g + sz * 0.3 : Math.max(g + sz * 0.25, WATER_Y - sz * 0.15);
        const sp = streamPoint(s);
        walls.push(p.x, y, p.z, sz * (0.9 + rnd() * 0.4), sz * (0.5 + rnd() * 0.3), sz * (0.75 + rnd() * 0.3), Math.atan2(sp.tx, sp.tz) + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2, grey());
        s += sz * (1.35 + rnd() * 0.25);
      }
    }
  };
  bankRun(S_POND - 6.5, S_POND + 6.5, -1, 0.34);          // under / beside the teahouse
  bankRun(S_POND - 2.5, S_POND + 8.5, 1, 0.3);            // pond, south bank (shishi-odoshi sits just upstream)
  bankRun(S_BRIDGE - 3.6, S_BRIDGE + 3.6, -1, 0.32);      // bridge abutments
  bankRun(S_BRIDGE - 3.6, S_BRIDGE + 3.6, 1, 0.32);
  bankRun(S_STONES - 1.8, S_STONES + 1.8, -1, 0.24);
  bankRun(S_STONES - 1.8, S_STONES + 1.8, 1, 0.24);

  // Path edging: low stones along straight-ish stretches of the gravel paths.
  for (const path of ANCHORS.paths) {
    const pts = path.pts.map(([x, z]) => new V3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const L = curve.getLength(), n = Math.floor(L / 0.42);
    for (let i = 1; i < n; i++) {
      const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      if (pts.some((q, k) => k > 0 && k < pts.length - 1 && q.distanceTo(p) < 1.0)) continue;   // skip around bends
      if (noiseGate(p.x, p.z) < 0.35) continue;                                                     // edging only "here and there"
      for (const side of [-1, 1]) {
        if (rnd() < 0.15) continue;
        const off = path.w / 2 + 0.1 + rnd() * 0.05;
        const x = p.x - tg.z * off * side, z = p.z + tg.x * off * side;
        if (isWater(x, z, 0.4) || inFootprint(x, z, -0.2)) continue;
        const sz = 0.11 + rnd() * 0.08;
        walls.push(x, groundHeight(x, z) + sz * 0.15, z, sz * 1.2, sz * 0.75, sz, Math.atan2(tg.x, tg.z) + (rnd() - 0.5) * 0.5, 0, 0, SP ? grey().map(v => v * 0.78) : grey());
      }
    }
  }

  // Pebbles along both water edges through the garden, plus a few around each boulder.
  for (const side of [-1, 1]) {
    for (let s = S_RAPIDS - 18; s < S_STONES + 14; s += 0.21 + rnd() * 0.1) {
      const off = -0.45 + rnd() * rnd() * 1.4;
      const p = bankPoint(s, side, off);
      if (Math.abs(p.x) > 36 || Math.abs(p.z) > 36) continue;
      const big = rnd() < 0.08;
      const sz = big ? 0.14 + rnd() * 0.1 : 0.04 + rnd() * 0.08;
      const g = groundHeight(p.x, p.z);
      pebbles.push(p.x, g + sz * 0.12, p.z, sz, sz * (0.6 + rnd() * 0.5), sz * (0.7 + rnd() * 0.4), rnd() * TAU, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, grey());
    }
  }
  for (const r of ANCHORS.rocks) {
    for (let k = 0; k < 5; k++) {
      const a = rnd() * TAU, d = r.s * (1.1 + rnd() * 0.6), x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      const sz = 0.05 + rnd() * 0.1;
      pebbles.push(x, groundHeight(x, z) + sz * 0.1, z, sz, sz * 0.6, sz * 0.8, rnd() * TAU, 0, 0, grey());
    }
  }
  walls.build(root);
  pebbles.build(root);
}

function noiseGate(x, z) {
  return 0.5 + 0.5 * Math.sin(x * 0.37 + Math.sin(z * 0.23) * 2) * Math.cos(z * 0.29 - 1.3);
}
