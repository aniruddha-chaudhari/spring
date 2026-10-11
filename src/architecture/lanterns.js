// lanterns.js — stone lanterns (tōrō): tall kasuga-dōrō on the banks and paths, and a low yukimi-dōrō by the pond.
// Soft hexagonal lathe parts, carved petals, curled roof corners, glowing paper fire-boxes and warm night lights.
import { ANCHORS, groundHeight } from '../world.js';
import { THREE, V3, M, lathe, rockGeo, sweep, roundRectProfile, jitter, mulberry32, PI, TAU, smoothstep, lerp, noise3 } from './kit.js';

const HEX = 6;
// corner-ness of a soft hexagon at angle th (1 at corners, 0 at face centres)
const corner = (th) => Math.abs(Math.sin(HEX * th / 2)) ** 6;
const rough = (amt) => (x, y, z) => { const n = amt * noise3(x * 9, y * 9, z * 9); return [x * (1 + n), y + n * 0.3, z * (1 + n)]; };

function kasuga(add, mt, rnd) {
  const S = add;
  const petals = (lo, hi, amp) => (x, y, z, th, t) => {
    const k = (t >= lo && t <= hi) ? Math.sin(PI * (t - lo) / (hi - lo)) : 0;
    const f = 1 + amp * k * Math.max(0, Math.cos(th * 12));
    const n = 0.012 * noise3(x * 9, y * 9, z * 9);
    return [x * (f + n), y, z * (f + n)];
  };
  // kiso (base) with kaeribana petals
  S(mt.carved, lathe([[0.31, -0.2], [0.31, 0.04], [0.29, 0.08], [0.24, 0.11], [0.18, 0.14], [0.13, 0.16], [0.0, 0.16]], { sides: HEX, k: 0.93, segs: 48, warp: petals(0.3, 0.9, 0.08) }));
  // sao (post) with a central node band
  S(mt.carved, lathe([[0.115, 0.12], [0.105, 0.42], [0.125, 0.45], [0.125, 0.5], [0.105, 0.53], [0.095, 0.85], [0.0, 0.86]], { segs: 24, warp: rough(0.015) }));
  // chudai (platform) with petals underneath
  S(mt.carved, lathe([[0.0, 0.83], [0.12, 0.83], [0.2, 0.87], [0.265, 0.93], [0.28, 0.985], [0.265, 1.02], [0.0, 1.02]], { sides: HEX, k: 0.93, segs: 48, warp: petals(0.05, 0.6, 0.07) }));
  // hibukuro (fire-box): glowing paper core + corner pillars + panels (two open windows, two moon cut-outs)
  S(mt.glowPaper, lathe([[0.0, 1.03], [0.135, 1.03], [0.135, 1.3], [0.0, 1.3]], { sides: HEX, k: 0.9, segs: 24 }), null, { shadow: false });
  const R = 0.19, ap = R * Math.cos(PI / 6), side = 2 * R * Math.sin(PI / 6);
  for (let i = 0; i < 6; i++) {
    const ca = PI / 6 + i * PI / 3;
    S(mt.carved, new THREE.CylinderGeometry(0.03, 0.032, 0.28, 6), M(Math.cos(ca) * (R - 0.02), 1.165, Math.sin(ca) * (R - 0.02)));
    const fa = i * PI / 3, ry = PI / 2 - fa, px = Math.cos(fa) * (ap - 0.01), pz = Math.sin(fa) * (ap - 0.01);
    if (i === 0 || i === 3) {   // window: rails top and bottom only
      S(mt.carved, new THREE.BoxGeometry(side, 0.05, 0.045), M(px, 1.055, pz, ry));
      S(mt.carved, new THREE.BoxGeometry(side, 0.05, 0.045), M(px, 1.285, pz, ry));
    } else {
      const s = new THREE.Shape();
      s.moveTo(-side / 2, -0.14); s.lineTo(side / 2, -0.14); s.lineTo(side / 2, 0.14); s.lineTo(-side / 2, 0.14); s.closePath();
      if (i === 1 || i === 4) { const h = new THREE.Path(); h.absarc(0, 0.01, 0.055, 0, TAU, true); s.holes.push(h); }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 20 });
      g.translate(0, 0, -0.02);
      S(mt.carved, g, M(px, 1.165, pz, ry));
    }
  }
  // kasa (roof) with curled corners (warabite)
  const kasa = lathe([[0.0, 1.29], [0.3, 1.3], [0.44, 1.315], [0.455, 1.34], [0.44, 1.37], [0.36, 1.42], [0.24, 1.49], [0.14, 1.54], [0.08, 1.56], [0.0, 1.57]], {
    sides: HEX, k: 0.97, segs: 72,
    warp: (x, y, z, th, t) => { const c = corner(th), rim = smoothstep(0.75, 0.3, t) * (t > 0.08 ? 1 : 0.4); const n = 0.01 * noise3(x * 7, y * 7, z * 7); return [x * (1 + n), y + 0.07 * c * rim, z * (1 + n)]; },
  });
  S(mt.carved, kasa);
  for (let i = 0; i < 6; i++) {
    const ca = PI / 6 + i * PI / 3, r = 0.43;
    S(mt.carved, new THREE.SphereGeometry(0.04, 10, 8), M(Math.cos(ca) * r, 1.4, Math.sin(ca) * r, 0, 0, 0, 1, 1.2, 1));
  }
  // hōju (jewel) on a lotus cup
  S(mt.carved, lathe([[0.0, 1.55], [0.075, 1.56], [0.095, 1.6], [0.06, 1.625], [0.035, 1.635], [0.06, 1.665], [0.075, 1.71], [0.06, 1.76], [0.03, 1.8], [0.008, 1.825], [0.0, 1.83]], { segs: 24, warp: rough(0.01) }));
  return 1.165;   // fire-box centre height
}

function yukimi(add, mt, rnd) {
  const S = add;
  // three curved legs
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + PI / 6, ca = Math.cos(a), sa = Math.sin(a);
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, r = lerp(0.42, 0.16, t) + 0.08 * Math.sin(PI * t), y = lerp(-0.05, 0.46, t) + 0.05 * Math.sin(PI * t);
      pts.push(new V3(ca * r, y, sa * r));
    }
    S(mt.carved, sweep(pts, roundRectProfile(0.085, 0.085, 0.035, 2), { side: new V3(-sa, 0, ca), scale: (t) => [1 - 0.25 * t, 1 - 0.25 * t] }));
  }
  S(mt.carved, lathe([[0.0, 0.44], [0.2, 0.44], [0.25, 0.48], [0.25, 0.52], [0.22, 0.54], [0.0, 0.54]], { sides: HEX, k: 0.93, segs: 48, warp: rough(0.01) }));
  S(mt.glowPaper, lathe([[0.0, 0.54], [0.14, 0.54], [0.14, 0.77], [0.0, 0.77]], { sides: HEX, k: 0.9, segs: 24 }), null, { shadow: false });
  const R = 0.19;
  for (let i = 0; i < 6; i++) {
    const ca = PI / 6 + i * PI / 3;
    S(mt.carved, new THREE.CylinderGeometry(0.028, 0.03, 0.24, 6), M(Math.cos(ca) * (R - 0.02), 0.655, Math.sin(ca) * (R - 0.02)));
  }
  // the wide umbrella roof that catches snow
  S(mt.carved, lathe([[0.0, 0.76], [0.5, 0.78], [0.62, 0.8], [0.64, 0.83], [0.6, 0.86], [0.45, 0.92], [0.25, 1.0], [0.1, 1.04], [0.0, 1.05]], {
    sides: HEX, k: 0.95, segs: 72,
    warp: (x, y, z, th, t) => { const c = corner(th), rim = smoothstep(0.6, 0.25, t); const n = 0.012 * noise3(x * 6, y * 6, z * 6); return [x * (1 + n), y + 0.05 * c * rim, z * (1 + n)]; },
  }));
  S(mt.carved, lathe([[0.0, 1.03], [0.06, 1.04], [0.08, 1.07], [0.05, 1.09], [0.065, 1.13], [0.05, 1.18], [0.02, 1.21], [0.0, 1.22]], { segs: 20 }));
  return 0.655;
}

export function buildLanterns(B, m, root) {
  const rnd = mulberry32(404);
  const lights = [];
  ANCHORS.lanterns.forEach((L, i) => {
    const isYukimi = i === 2;
    const g = Math.min(groundHeight(L.x, L.z), groundHeight(L.x + 0.25, L.z), groundHeight(L.x - 0.25, L.z), groundHeight(L.x, L.z + 0.25), groundHeight(L.x, L.z - 0.25));
    const sc = isYukimi ? 1.05 : 0.95 + rnd() * 0.15;
    const base = M(L.x, g, L.z, rnd() * TAU, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.03, sc);
    const tint = jitter(rnd, 0.06, 0.02);
    const add = (mat, geo, lm = null, o = {}) => B.add(mat, geo, lm ? base.clone().multiply(lm) : base, { tint: mat === m.glowPaper ? [1, 1, 1] : tint, ...o });
    const fy = isYukimi ? yukimi(add, m, rnd) : kasuga(add, m, rnd);
    // a couple of stones at the foot
    for (let k = 0; k < 3; k++) {
      const a = rnd() * TAU, d = isYukimi ? 0.6 + rnd() * 0.2 : 0.42 + rnd() * 0.15, x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
      const s = 0.09 + rnd() * 0.08;
      B.add(m.stone, rockGeo(4400 + i * 7 + k, { detail: 2, scale: [s * 1.3, s * 0.8, s], facets: 3 }), M(x, groundHeight(x, z) + s * 0.2, z, rnd() * TAU), { tint: jitter(rnd, 0.1) });
    }
    if (lights.length < 5) {
      const pl = new THREE.PointLight("#ffad5c", 0, isYukimi ? 8 : 7, 2);
      pl.position.set(L.x, g + fy * sc, L.z);
      pl.userData.phase = rnd() * 10;
      lights.push(pl);
    }
  });
  return {
    lights,
    update(dt, t, night) {
      for (const l of lights) {
        const ph = l.userData.phase;
        l.intensity = night * 3.2 * (1 + 0.06 * Math.sin(t * 9.3 + ph) + 0.04 * Math.sin(t * 15.7 + ph * 2));
      }
    },
  };
}
