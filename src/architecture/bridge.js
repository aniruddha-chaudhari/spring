// bridge.js — taikobashi: natural wood deck planks on a gentle arch, vermilion railings and fascia, bronze giboshi
// on the end posts, timber pile bents in the water (LAYER_REFRACT) and stone landings at both banks.
import { ANCHORS, groundHeight, WATER_Y } from '../world.js';
import { THREE, V3, M, sweep, roundRectProfile, circleProfile, lathe, rockGeo, placer, jitter, mul, PI, TAU, lerp, mulberry32 } from './kit.js';

export function buildBridge(B, m) {
  const A = ANCHORS.bridge;
  const rnd = mulberry32(202);
  const base = M(A.x, 0, A.z, A.rot);
  const P = placer(B, base, rnd);
  const cr = Math.cos(A.rot), sr = Math.sin(A.rot);
  const gAt = (lx, lz) => groundHeight(A.x + cr * lx + sr * lz, A.z - sr * lx + cr * lz);

  const hL = A.span / 2, W = A.width;
  const yL = Math.max(gAt(-hL, -W / 2), gAt(-hL, W / 2), gAt(-hL, 0)) + 0.06;
  const yR = Math.max(gAt(hL, -W / 2), gAt(hL, W / 2), gAt(hL, 0)) + 0.06;
  const rise = 0.9;
  // deck-top height along the span; gentle arch with level ends so the landings meet the ground
  const yd = (x) => lerp(yL, yR, (x + hL) / (2 * hL)) + rise * (0.62 * (0.5 + 0.5 * Math.cos(PI * x / hL)) + 0.38 * Math.max(0, 1 - (x / hL) ** 2));
  const slope = (x) => (yd(x + 0.01) - yd(x - 0.01)) / 0.02;
  const arcPts = (z, dy, x0 = -hL, x1 = hL, n = 40) => { const out = []; for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n); out.push(new V3(x, yd(x) + dy, z)); } return out; };

  // ---- deck planks laid across the arch
  {
    // walk the arc in equal steps of plank width
    let x = -hL + 0.02;
    while (x < hL - 0.1) {
      const a = Math.atan(slope(x)), w = 0.19;
      const cx = x + Math.cos(a) * w / 2;
      const len = W - 0.12 + (rnd() - 0.5) * 0.04;
      P.piece(m.weathered, w - 0.014, 0.06, len, cx, yd(cx) - 0.03 + (rnd() - 0.5) * 0.008, (rnd() - 0.5) * 0.03,
        { rz: a + (rnd() - 0.5) * 0.015, ry: (rnd() - 0.5) * 0.012, r: 0.016, tint: jitter(rnd, 0.13, 0.04), su: 0.5 });
      x += Math.cos(a) * w;
    }
  }
  // ---- stringers (natural) and vermilion fascia beams
  for (const z of [-0.45, 0, 0.45]) P.add(m.darkWood, sweep(arcPts(z, -0.16, -hL + 0.1, hL - 0.1), roundRectProfile(0.12, 0.2, 0.03, 2), { uvScale: [0.6, 0.6] }), null, { tint: jitter(rnd, 0.08) });
  for (const sz of [-1, 1]) {
    const z = sz * (W / 2 - 0.02);
    P.add(m.lacquer, sweep(arcPts(z, -0.1, -hL - 0.05, hL + 0.05), roundRectProfile(0.1, 0.24, 0.03, 3), { uvScale: [0.5, 0.5] }), null, { tint: [1, 1, 1] });
  }
  // ---- railings
  const rz = W / 2 - 0.05;
  const nPosts = 8;
  const postX = []; for (let i = 0; i <= nPosts; i++) postX.push(lerp(-hL + 0.22, hL - 0.22, i / nPosts));
  for (const sz of [-1, 1]) {
    const z = sz * rz;
    for (let i = 0; i <= nPosts; i++) {
      const x = postX[i], end = i === 0 || i === nPosts;
      const y0 = yd(x) - 0.12;
      if (end) {
        const h = 1.12;
        P.add(m.lacquer, lathe([[0.075, 0], [0.075, h - 0.02], [0.06, h], [0, h]], { segs: 16 }), M(x, y0, z), { uv: (g) => {
          const uv = g.attributes.uv, p = g.attributes.position; for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getY(k) * 0.5, uv.getX(k) * 0.4); } });
        for (const by of [h - 0.12, h - 0.42]) P.add(m.bronze, new THREE.CylinderGeometry(0.083, 0.083, 0.045, 16), M(x, y0 + by, z), { tint: [0.85, 0.8, 0.7] });
        const gib = lathe([[0, 0], [0.07, 0], [0.075, 0.025], [0.058, 0.045], [0.062, 0.06], [0.09, 0.11], [0.088, 0.15], [0.065, 0.19], [0.03, 0.225], [0.012, 0.255], [0.016, 0.27], [0, 0.29]], { segs: 20 });
        P.add(m.bronze, gib, M(x, y0 + h - 0.01, z), { tint: [1, 1, 1] });
      } else {
        P.piece(m.lacquer, 0.09, 0.95, 0.09, x, y0 + 0.47, z, { r: 0.02, tint: [1, 1, 1], su: 0.5, sv: 0.5 });
      }
    }
    const x0 = postX[0], x1 = postX[nPosts];
    P.add(m.lacquer, sweep(arcPts(z, 0.72, x0, x1), roundRectProfile(0.085, 0.08, 0.035, 3), { uvScale: [0.5, 0.5] }), null, { tint: [1, 1, 1] });     // top rail
    P.add(m.lacquer, sweep(arcPts(z, 0.38, x0, x1), roundRectProfile(0.05, 0.055, 0.015, 2), { uvScale: [0.5, 0.5] }), null, { tint: [0.95, 0.95, 0.95] }); // mid rail
    P.add(m.lacquer, sweep(arcPts(z, 0.08, x0, x1), roundRectProfile(0.07, 0.09, 0.02, 2), { uvScale: [0.5, 0.5] }), null, { tint: [0.9, 0.9, 0.9] });   // bottom rail
  }
  // ---- pile bents in the water
  for (const bx of [-1.25, 0, 1.25]) {
    const ytop = yd(bx) - 0.32;
    for (const z of [-0.6, 0.6]) {
      const g = gAt(bx, z);
      P.rod(m.pier, [bx, g - 0.35, z], [bx, ytop, z], 0.085, { seg: 12, refract: true, tint: jitter(rnd, 0.1), taper: 0.92 });
    }
    P.piece(m.pier, 0.16, 0.16, W + 0.2, bx, ytop + 0.04, 0, { refract: true, r: 0.03 });
    P.piece(m.pier, 0.07, 0.1, W + 0.05, bx, 0.18, 0, { refract: true, r: 0.02, tint: [0.8, 0.78, 0.75] });
    // diagonal braces
    const gy = Math.min(gAt(bx, -0.6), gAt(bx, 0.6));
    P.rod(m.pier, [bx + 0.05, gy + 0.1, -0.58], [bx + 0.05, ytop - 0.05, 0.58], 0.035, { seg: 6, refract: true });
    P.rod(m.pier, [bx - 0.05, gy + 0.1, 0.58], [bx - 0.05, ytop - 0.05, -0.58], 0.035, { seg: 6, refract: true });
  }
  // ---- stone abutments + landing slabs at both ends
  for (const sx of [-1, 1]) {
    const xe = sx * (hL - 0.35);
    for (let k = 0; k < 3; k++) {
      const z = (k - 1) * 0.62, x = xe + (rnd() - 0.5) * 0.1, g = gAt(x, z);
      const top = yd(x) - 0.26, h = Math.max(0.3, top - g + 0.25);
      P.add(m.stone, rockGeo(2000 + k + (sx > 0 ? 10 : 0), { detail: 3, scale: [0.32, h / 2, 0.3], flatTop: h / 2 - 0.02, facets: 5, bump: 0.12 }), M(x, top - h / 2 + 0.02, z, rnd() * TAU), { tint: jitter(rnd, 0.08), refract: true });
    }
    const lx = sx * (hL + 0.42), g = Math.max(gAt(lx, -0.4), gAt(lx, 0.4), gAt(lx, 0));
    P.add(m.carved, rockGeo(2100 + (sx > 0 ? 1 : 0), { detail: 3, scale: [0.5, 0.22, 1.0], flatTop: 0.1, facets: 4, bump: 0.1, topSoft: 0.06 }), M(lx, g - 0.04, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.15), { tint: [1.02, 1, 0.97] });
  }
}
