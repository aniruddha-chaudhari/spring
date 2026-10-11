// shrine.js — a small wooden hokora on a stone base with a shimenawa rope and shide, a vermilion myōjin torii with
// a black kasagi, and a row of jizō statues in red bibs beside the path.
import { ANCHORS, groundHeight } from '../world.js';
import { THREE, V3, M, rbox, sweep, roundRectProfile, circleProfile, lathe, rockGeo, placer, jitter, mul, mulberry32, PI, TAU, lerp } from './kit.js';

// Twisted straw rope hanging between a and b (local), thick in the middle.
function shimenawa(P, mat, a, b, sag, thick) {
  const c = (t) => new V3(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - sag * Math.sin(PI * t), lerp(a.z, b.z, t));
  const dir = new V3().subVectors(b, a).normalize(), up = new V3(0, 1, 0), side = new V3().crossVectors(dir, up).normalize();
  for (let k = 0; k < 2; k++) {
    const pts = [], N = 48;
    for (let i = 0; i <= N; i++) {
      const t = i / N, r = thick * (0.45 + 0.55 * Math.sin(PI * t)) * 0.5, ph = t * 9 * TAU / 2 + k * PI;
      pts.push(c(t).add(up.clone().multiplyScalar(Math.cos(ph) * r)).add(side.clone().multiplyScalar(Math.sin(ph) * r)));
    }
    P.add(mat, sweep(pts, circleProfile(1, 8), {
      side: side.clone(), scale: (t) => { const r = thick * (0.45 + 0.55 * Math.sin(PI * t)) * 0.55; return [r, r]; }, uvScale: [2, 0.2],
    }), null, { tint: [1, 0.97, 0.9] });
  }
  return c;
}
// Zigzag paper streamer (shide) hanging from p.
function shide(P, mat, p, s = 1, ry = 0) {
  const w = 0.05 * s, h = 0.06 * s;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(w, h);
    P.add(mat, g, M(p.x + ((i % 2) ? w * 0.5 : -w * 0.5) * Math.cos(ry), p.y - h * (i + 0.5), p.z - ((i % 2) ? w * 0.5 : -w * 0.5) * Math.sin(ry), ry), { tint: [1, 1, 1], shadow: false });
  }
}

export function buildShrine(B, m) {
  const rnd = mulberry32(606);
  // ---------------------------------------------------------------- hokora
  {
    const S = ANCHORS.shrine;
    const cr = Math.cos(S.rot), sr = Math.sin(S.rot);
    const gAt = (lx, lz) => groundHeight(S.x + cr * lx + sr * lz, S.z - sr * lx + cr * lz);
    let gmin = Infinity, gmax = -Infinity;
    for (const [x, z] of [[-0.8, -0.7], [0.8, -0.7], [-0.8, 0.7], [0.8, 0.7], [0, 0]]) { const g = gAt(x, z); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    const P = placer(B, M(S.x, 0, S.z, S.rot), rnd);
    // two-tier dressed stone base
    const y1 = gmax + 0.22, h1 = y1 - gmin + 0.2;
    P.piece(m.carved, 1.55, h1, 1.35, 0, y1 - h1 / 2, 0, { r: 0.07, seg: 3, tint: jitter(rnd, 0.05), uv: null });
    const y2 = y1 + 0.2;
    P.piece(m.carved, 1.08, 0.2, 0.92, 0, y1 + 0.1, -0.05, { r: 0.05, seg: 3, tint: jitter(rnd, 0.05), uv: null });
    P.piece(m.carved, 0.6, 0.12, 0.28, 0, y1 + 0.06, 0.55, { r: 0.04, seg: 2, uv: null });          // step
    // body
    const bw = 0.6, bd = 0.5, bh = 0.52, by = y2 + 0.06;
    P.piece(m.darkWood, bw + 0.16, 0.06, bd + 0.16, 0, y2 + 0.03, -0.05, { r: 0.015 });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.piece(m.weathered, 0.055, bh, 0.055, x * bw / 2, by + bh / 2, -0.05 + z * bd / 2, { r: 0.012, tint: [0.75, 0.68, 0.62] });
    for (const x of [-1, 1]) for (let z = -bd / 2 + 0.05; z < bd / 2 - 0.02; z += 0.1)
      P.piece(m.weathered, 0.02, bh - 0.02, 0.098, x * (bw / 2 - 0.005), by + bh / 2, -0.05 + z + 0.05, { r: 0.006, tint: mul(jitter(rnd, 0.1), 0.75) });
    for (let x = -bw / 2 + 0.05; x < bw / 2 - 0.02; x += 0.1) P.piece(m.weathered, 0.098, bh - 0.02, 0.02, x + 0.05, by + bh / 2, -0.05 - bd / 2 + 0.005, { r: 0.006, tint: mul(jitter(rnd, 0.1), 0.75) });
    // front lattice doors
    const fz = -0.05 + bd / 2;
    P.piece(m.darkWood, bw - 0.04, bh - 0.06, 0.02, 0, by + bh / 2, fz - 0.03, { r: 0.006, tint: [0.35, 0.3, 0.28] });
    for (let x = -bw / 2 + 0.06; x < bw / 2 - 0.03; x += 0.06) P.piece(m.weathered, 0.016, bh - 0.06, 0.02, x, by + bh / 2, fz, { r: 0.005, tint: [0.8, 0.72, 0.65] });
    for (let y = by + 0.06; y < by + bh - 0.03; y += 0.07) P.piece(m.weathered, bw - 0.04, 0.014, 0.018, 0, y, fz + 0.012, { r: 0.004, tint: [0.8, 0.72, 0.65] });
    P.piece(m.timber, bw + 0.08, 0.05, 0.06, 0, by + bh + 0.02, fz, { r: 0.012 });
    P.piece(m.timber, bw + 0.08, 0.05, 0.06, 0, by + bh + 0.02, -0.05 - bd / 2, { r: 0.012 });
    // nagare-zukuri roof: long front slope, short back, gently curved, bark shingles
    const ry = by + bh + 0.32, rw = bw + 0.42;
    const slope = (z0, z1, y0, y1, sag) => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new V3(0, lerp(y0, y1, t) - sag * Math.sin(PI * t), lerp(z0, z1, t))); } return pts; };
    const roof = (pts) => P.add(m.bark, sweep(pts, roundRectProfile(rw, 0.075, 0.03, 2), { side: new V3(1, 0, 0), uvScale: [1, 1] }), null, { tint: [0.72, 0.68, 0.58] });
    roof(slope(-0.03, fz + 0.48, ry, ry - 0.33, 0.05));
    roof(slope(0.03, -0.05 - bd / 2 - 0.3, ry, ry - 0.3, 0.03));
    // moss on the ridge + ridge cap with katsuogi logs and crossed chigi
    P.add(m.timber, sweep([new V3(-rw / 2 - 0.04, ry + 0.05, 0), new V3(rw / 2 + 0.04, ry + 0.05, 0)], roundRectProfile(0.12, 0.1, 0.04, 2), { side: new V3(0, 0, 1) }), null, { tint: [0.5, 0.48, 0.42] });
    for (const x of [-0.2, 0, 0.2]) P.rod(m.timber, [x, ry + 0.13, -0.09], [x, ry + 0.13, 0.09], 0.032, { seg: 8, tint: [0.62, 0.55, 0.48] });
    for (const sx of [-1, 1]) for (const k of [-1, 1]) P.piece(m.timber, 0.025, 0.32, 0.05, sx * (rw / 2 + 0.01), ry + 0.08, k * 0.06, { rx: k * 0.55, r: 0.008, tint: [0.6, 0.55, 0.48] });
    // shimenawa across the front with shide
    const cu = shimenawa(P, m.rope, new V3(-bw / 2 - 0.03, by + bh - 0.1, fz + 0.08), new V3(bw / 2 + 0.03, by + bh - 0.1, fz + 0.08), 0.07, 0.085);
    for (const t of [0.3, 0.7]) { const p = cu(t); shide(P, m.paper, new V3(p.x, p.y - 0.03, p.z + 0.035), 0.9); }
    for (const t of [0.15, 0.5, 0.85]) { const p = cu(t); P.rod(m.rope, [p.x, p.y - 0.02, p.z], [p.x, p.y - 0.11, p.z], 0.006, { seg: 5, uv: null, tint: [1, 0.95, 0.85] }); }
    // offerings: two tiny sake cups and a stone
    for (const x of [-0.12, 0.12]) P.add(m.paper, new THREE.CylinderGeometry(0.03, 0.022, 0.035, 12), M(x, y2 + 0.08, fz + 0.12), { tint: [0.95, 0.95, 0.92] });
  }

  // ---------------------------------------------------------------- torii
  {
    const T = ANCHORS.torii;
    const cr = Math.cos(T.rot), sr = Math.sin(T.rot);
    const gAt = (lx, lz) => groundHeight(T.x + cr * lx + sr * lz, T.z - sr * lx + cr * lz);
    const yb = Math.min(gAt(-T.w / 2, 0), gAt(T.w / 2, 0));
    const P = placer(B, M(T.x, 0, T.z, T.rot), rnd);
    const H = 3.0, half = T.w / 2, lean = 0.035;
    for (const sx of [-1, 1]) {
      const g = gAt(sx * half, 0);
      // stone footing
      P.add(m.carved, lathe([[0.0, -0.3], [0.26, -0.3], [0.27, 0.06], [0.24, 0.12], [0.0, 0.12]], { segs: 24 }), M(sx * half, g, 0), { tint: jitter(rnd, 0.05) });
      const top = yb + H + 0.2;
      const pts = [new V3(sx * half, g + 0.1, 0), new V3(sx * (half - lean * (top - g)), top, 0)];
      const { m: mm } = (() => { const d = new V3().subVectors(pts[1], pts[0]); return { m: new THREE.Matrix4().compose(pts[0], new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()), new V3(1, 1, 1)) }; })();
      const len = pts[0].distanceTo(pts[1]);
      P.add(m.lacquer, lathe([[0.15, 0], [0.135, len * 0.5], [0.125, len], [0.0, len]], { segs: 24 }), mm, {
        tint: [1, 1, 1], uv: (g2) => { const uv = g2.attributes.uv, p = g2.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getY(i) * 0.4, uv.getX(i) * 0.5); },
      });
      P.add(m.black, lathe([[0.17, 0], [0.17, 0.36], [0.155, 0.4], [0.0, 0.4]], { segs: 24 }), mm, { tint: [1, 1, 1] });          // kamaki
      P.add(m.black, new THREE.CylinderGeometry(0.155, 0.155, 0.05, 24), new THREE.Matrix4().makeTranslation(sx * (half - lean * 2.0), yb + 2.15, 0), { tint: [1, 1, 1] });
      // wedges at the nuki
      P.piece(m.darkWood, 0.06, 0.1, 0.11, sx * (half + 0.2), yb + 2.15, 0, { r: 0.01, tint: [0.4, 0.35, 0.32] });
    }
    const lacq = { tint: [1, 1, 1], su: 0.4, sv: 0.4 };
    P.piece(m.lacquer, T.w + 0.9, 0.15, 0.1, 0, yb + 2.15, 0, { r: 0.025, ...lacq });                         // nuki
    P.piece(m.lacquer, 0.14, 0.42, 0.11, 0, yb + 2.45, 0, { r: 0.02, ...lacq });                              // gakuzuka
    P.piece(m.black, 0.32, 0.42, 0.04, 0, yb + 2.45, 0.075, { r: 0.012 });                                    // plaque
    P.piece(m.bronze, 0.36, 0.46, 0.02, 0, yb + 2.45, 0.055, { r: 0.008, tint: [0.7, 0.6, 0.45] });
    P.piece(m.lacquer, T.w + 1.0, 0.17, 0.2, 0, yb + 2.8, 0, { r: 0.03, ...lacq });                           // shimaki
    // kasagi: black, upswept ends
    const ext = half + 0.85, pts = [];
    for (let i = 0; i <= 28; i++) { const x = lerp(-ext, ext, i / 28); pts.push(new V3(x, yb + 3.0 + 0.2 * Math.abs(x / ext) ** 2.6, 0)); }
    P.add(m.black, sweep(pts, roundRectProfile(0.28, 0.17, 0.05, 3), { side: new V3(0, 0, 1), scale: (t) => { const e = Math.abs(t * 2 - 1); return [1 + 0.12 * e ** 3, 1 + 0.25 * e ** 3]; }, uvScale: [0.5, 0.5] }), null, { tint: [1, 1, 1] });
    // jizō row beside the path (right side of the torii)
    for (let k = 0; k < 3; k++) {
      const lx = half + 0.85 + k * 0.42, lz = 0.6 + k * 0.08, g = gAt(lx, lz);
      const s = [1, 0.85, 0.72][k];
      jizo(B, m, M(T.x + cr * lx + sr * lz, g - 0.02, T.z - sr * lx + cr * lz, T.rot + (rnd() - 0.5) * 0.3, 0, 0, s), rnd, 7000 + k);
    }
  }
}

function jizo(B, m, base, rnd, seed) {
  const add = (mat, geo, lm = null, o = {}) => B.add(mat, geo, lm ? base.clone().multiply(lm) : base, { tint: [1, 1, 1], ...o });
  add(m.carved, rockGeo(seed, { detail: 3, scale: [0.24, 0.14, 0.2], flatTop: 0.08, facets: 4, bump: 0.12 }), M(0, 0.0, 0));
  add(m.carved, lathe([[0.0, 0.07], [0.15, 0.07], [0.165, 0.14], [0.155, 0.3], [0.13, 0.42], [0.09, 0.47], [0.05, 0.49], [0.0, 0.49]], { segs: 24 }), M(0, 0, 0, 0, 0, 0, 1, 1, 0.82));
  add(m.carved, new THREE.SphereGeometry(0.085, 18, 14), M(0, 0.56, 0, 0, 0, 0, 1, 1.08, 0.95));
  add(m.carved, new THREE.SphereGeometry(0.035, 10, 8), M(0, 0.3, 0.13, 0, 0, 0, 1, 1.4, 0.8));      // joined hands
  const bib = new THREE.CylinderGeometry(0.085, 0.16, 0.15, 20, 1, true, -PI * 0.42, PI * 0.84);
  add(m.cloth, bib, M(0, 0.405, 0.005, 0, 0, 0, 1, 1, 0.92));
  add(m.cloth, new THREE.SphereGeometry(0.09, 16, 8, 0, TAU, 0, PI * 0.5), M(0, 0.575, 0, 0, -0.1, 0, 1.02, 0.9, 1.0));     // knit cap
}
