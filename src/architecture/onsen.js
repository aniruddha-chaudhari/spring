// onsen.js — spring-only additions: big flat-topped pale boulders around the pond rim and the rapids (onsen-pool feel),
// small stacked-stone cairns (ishizumi), rock ledges across the rapids for the water module's little cascades,
// and a subtle hanami touch at the teahouse (red-white paper lanterns and a kōhaku rope under the engawa eave).
import { ANCHORS, groundHeight, WATER_Y, S_POND, S_RAPIDS, bankPoint, streamPoint } from '../world.js';
import { THREE, V3, M, rockGeo, lathe, sweep, circleProfile, jitter, mulberry32, TAU, PI, lerp } from './kit.js';

// Ledges across the rapids. t runs across the channel: 0 = north/back bank edge (side -1), 1 = south/front bank edge (side +1).
const LEDGE_DEFS = [
  { s: S_RAPIDS - 6.0, spans: [[-0.08, 0.68]] },
  { s: S_RAPIDS - 0.5, spans: [[0.3, 1.08]] },
  { s: S_RAPIDS + 5.0, spans: [[-0.08, 0.42], [0.6, 1.08]] },
];
export const LEDGE_TOP = WATER_Y + 0.07;

function crossPoint(s, t) {
  const p = streamPoint(s), k = (2 * t - 1) * p.hw;
  return { x: p.x + p.nx * k, z: p.z + p.nz * k };
}

export function buildOnsen(B, m, root) {
  const rnd = mulberry32(808);
  const tint = () => { const v = 0.9 + rnd() * 0.18, w = (rnd() - 0.5) * 0.06; return [v * (1 + w), v, v * (1 - w)]; };

  // ---- rock ledges across the rapids
  const ledges = [];
  LEDGE_DEFS.forEach((L, li) => {
    const p = streamPoint(L.s);
    const ry = Math.atan2(-p.nz, p.nx);            // local +X along the ledge (across the stream)
    for (const [t0, t1] of L.spans) {
      const a = crossPoint(L.s, t0), b = crossPoint(L.s, t1);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(2, Math.round(len / 0.95));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = lerp(a.x, b.x, t) + p.tx * (rnd() - 0.5) * 0.2, z = lerp(a.z, b.z, t) + p.tz * (rnd() - 0.5) * 0.2;
        const g = groundHeight(x, z);
        const top = LEDGE_TOP + (rnd() - 0.5) * 0.04;
        const h = Math.max(0.35, top - g + 0.25), sy = h * 0.75, ft = sy * 0.3;
        const sx = (len / n) * (0.66 + rnd() * 0.12), sz = 0.55 + rnd() * 0.2;
        B.add(m.stone, rockGeo(9000 + li * 40 + i, { detail: 3, scale: [sx, sy, sz], flatTop: ft, facets: 4, bump: 0.1, topSoft: 0.1, smooth: 1 }),
          M(x, top - ft, z, ry + (rnd() - 0.5) * 0.25), { tint: tint(), refract: true });
      }
      ledges.push({ s: L.s, a: { x: +a.x.toFixed(2), z: +a.z.toFixed(2) }, b: { x: +b.x.toFixed(2), z: +b.z.toFixed(2) }, top: LEDGE_TOP, depth: 0.5,
        flow: { x: +p.tx.toFixed(3), z: +p.tz.toFixed(3) } });
    }
  });

  // ---- big flat-topped pale boulders (pond rim + rapids), some carrying cairns
  const BIG = [
    [S_POND + 2.5, 1, -0.55, 1.25, 0.42, true],
    [S_POND - 10.5, -1, -0.35, 1.45, 0.5, false],
    [S_POND - 14.5, 1, -0.25, 1.3, 0.46, true],
    [S_RAPIDS - 9.5, -1, 0.25, 1.65, 0.62, false],
    [S_RAPIDS + 8.5, 1, 0.05, 1.5, 0.55, true],
    [S_RAPIDS + 2.5, -1, -0.15, 1.2, 0.4, false],
  ];
  const cairnTops = [];
  BIG.forEach(([s, side, off, r, above, cairn], i) => {
    const p = bankPoint(s, side, off), g = groundHeight(p.x, p.z);
    const top = WATER_Y + above, h = Math.max(0.6, top - g + 0.35), sy = h * 0.6, ft = sy * 0.5;
    const sp = streamPoint(s);
    B.add(m.stone, rockGeo(9500 + i, { detail: 4, scale: [r * 1.05, sy, r * 0.8], flatTop: ft, facets: 3, bump: 0.12, topSoft: 0.22, smooth: 2 }),
      M(p.x, top - ft, p.z, Math.atan2(sp.tx, sp.tz) + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06), { tint: tint(), refract: true });
    if (cairn) cairnTops.push({ x: p.x + (rnd() - 0.5) * r * 0.5, y: top - 0.015, z: p.z + (rnd() - 0.5) * r * 0.4 });
  });
  // ---- cairns (ishizumi): 4-6 flat stones, each smaller, slightly off-centre
  cairnTops.forEach((c, ci) => {
    let y = c.y, x = c.x, z = c.z;
    const n = 4 + (ci % 3);
    for (let k = 0; k < n; k++) {
      const r = 0.17 * Math.pow(0.8, k) * (0.9 + rnd() * 0.2), hh = r * (0.42 + rnd() * 0.12);
      B.add(m.river, rockGeo(9700 + ci * 10 + k, { detail: 2, scale: [r, hh, r * 0.85], facets: 2, bump: 0.08, smooth: 2 }),
        M(x, y + hh * 0.8, z, rnd() * TAU, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1), { tint: tint() });
      y += hh * 1.55; x += (rnd() - 0.5) * r * 0.25; z += (rnd() - 0.5) * r * 0.25;
    }
  });

  // ---- hanami: chōchin lanterns and a red-white rope under the teahouse engawa beam (same frame as teahouse.js)
  const lights = [];
  if (m.chochin) {
    const A = ANCHORS.teahouse, base = M(A.x, 0, A.z, A.rot), HB = 3.25, EZ = 2.62 + 0.11;
    const add = (mat, geo, lm, o = {}) => B.add(mat, geo, base.clone().multiply(lm), { tint: [1, 1, 1], ...o });
    for (const x of [-2.3, -0.8, 0.7]) {
      const y = HB - 0.82 + (rnd() - 0.5) * 0.06, cord = HB - 0.06 - (y + 0.17);
      add(m.darkWood, new THREE.CylinderGeometry(0.004, 0.004, cord, 4), M(x, y + 0.17 + cord / 2, EZ));
      add(m.black, new THREE.CylinderGeometry(0.06, 0.07, 0.035, 14), M(x, y + 0.155, EZ));
      add(m.black, new THREE.CylinderGeometry(0.07, 0.06, 0.035, 14), M(x, y - 0.155, EZ));
      add(m.chochin, lathe([[0.07, -0.14], [0.11, -0.09], [0.125, 0], [0.11, 0.09], [0.07, 0.14]], { segs: 20 }), M(x, y, EZ, rnd() * TAU), { shadow: false });
    }
    // kōhaku rope: two strands (red + white) twisted, swagged between the engawa posts
    const a = new V3(-3.0, HB - 0.38, EZ + 0.02), b = new V3(3.0, HB - 0.38, EZ + 0.02);
    for (const [k, mat] of [[0, m.cloth], [1, m.paper]]) {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const t = i / 80, swag = 0.16 * Math.abs(Math.sin(PI * t * 3)), ph = t * 40 * PI + k * PI;
        pts.push(new V3(lerp(a.x, b.x, t), a.y - swag + Math.cos(ph) * 0.011, a.z + Math.sin(ph) * 0.011));
      }
      B.add(mat, sweep(pts, circleProfile(0.012, 6), { side: new V3(0, 0, 1) }), base, { tint: [1, 1, 1], shadow: false });
    }
  }
  return { ledges, lights };
}
