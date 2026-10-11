// teahouse.js — sukiya-style chashitsu on the pond's north bank: stone footings, hinoki frame, clay walls, shoji,
// tatami interior with a scroll and an andon, an engawa + deck over the water, a thick thatched irimoya roof,
// a tsukubai by the crawl-in entrance and a glass furin on the eave.
import { ANCHORS, groundHeight, WATER_Y, windGustAt } from '../world.js';
import {
  THREE, V3, M, rbox, sweep, circleProfile, roundRectProfile, lathe, rockGeo, placer, jitter, mul, PI, TAU,
  clamp, lerp, smoothstep, noise3, mulberry32,
} from './kit.js';

export function buildTeahouse(B, m, root) {
  const A = ANCHORS.teahouse;
  const rnd = mulberry32(101);
  const cr = Math.cos(A.rot), sr = Math.sin(A.rot);
  const base = M(A.x, 0, A.z, A.rot);
  const P = placer(B, base, rnd);
  const toW = (lx, lz) => [A.x + cr * lx + sr * lz, A.z - sr * lx + cr * lz];
  const gAt = (lx, lz) => { const [x, z] = toW(lx, lz); return groundHeight(x, z); };

  // ---------------------------------------------------------------- dimensions (local, metres; y is world height)
  const FL = 1.05, HB = 3.25;                               // floor top, beam/ceiling height
  const RX = 3.0, RZ0 = -2.6, RZ1 = 1.45;                   // room (shoji front at RZ1)
  const PX = 3.55, PZ0 = -2.95, PZ1 = 2.75;                 // raised platform incl. engawa
  const DZ1 = PZ1 + A.deck, DX0 = -2.25, DX1 = 3.15, DY = FL - 0.15;   // deck over the water
  const EZ = 2.62;                                          // engawa post line

  // ---------------------------------------------------------------- roof shape
  const Yeave = 3.3, Ex = 4.3, Ez = 3.8, zc = -0.1, TH = 0.5, Gx = Ex - 2.0;
  const sp = (x, k) => k * Math.log(1 + Math.exp(x / k));
  const hm = (mm) => Yeave + 0.45 * mm + 0.62 * sp(mm - 1.2, 0.35) + 0.1 * Math.sin(clamp(mm / Ez, 0, 1) * PI);
  const sabs = (v, k) => Math.sqrt(v * v + k * k) - k;
  const mLong = (z) => Ez - sabs(z - zc, 0.3);
  const mEnd = (x) => Ex - Math.abs(x);
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const rn = (x, z) => 0.04 * noise3(x * 1.1, 0.5, z * 1.1) + 0.015 * noise3(x * 4, 2, z * 4);
  const Yg = hm(Ex - Gx);
  let Zg2 = 0; { let lo = 0, hi = Ez; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (hm(mid) < Yg - 0.3) lo = mid; else hi = mid; } Zg2 = Ez - lo; }
  const H1 = (x, z) => hm(smin(mLong(z), mEnd(x), 0.6)) + rn(x, z);
  const H2 = (x, z) => hm(mLong(z)) + 0.07 - 0.3 * smoothstep(Zg2 - 0.7, Zg2, Math.abs(z - zc)) + rn(x, z);
  const under = (x, z) => H1(x, z) - TH;

  // Thick thatch shell over a (corner-rounded) rectangle: top surface, underside and a rolled lip around the edge.
  function shell(fn, x0, x1, z0, z1, nx, nz, R, uvf, sidesOnly = false) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
    const map = (u, v) => {
      let x = lerp(x0, x1, u), z = lerp(z0, z1, v);
      if (R > 0) {
        const a = Math.abs(x - cx) - (hx - R), b = Math.abs(z - cz) - (hz - R);
        if (a > 0 && b > 0) {
          const a2 = a * Math.sqrt(1 - (b / R) ** 2 / 2), b2 = b * Math.sqrt(1 - (a / R) ** 2 / 2);
          x = cx + Math.sign(x - cx) * (hx - R + a2); z = cz + Math.sign(z - cz) * (hz - R + b2);
        }
      }
      return [x, z];
    };
    const top = [], bot = [], uvT = [], idT = [], idB = [], grid = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const [x, z] = map(i / nx, j / nz), y = fn(x, z);
      grid.push([x, y, z]);
      top.push(x, y, z); bot.push(x, y - TH, z);
      const [u, v] = uvf(x, z); uvT.push(u, v);
    }
    const ix = (i, j) => i * (nz + 1) + j;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = ix(i, j), b = ix(i, j + 1), c = ix(i + 1, j), d = ix(i + 1, j + 1);
      idT.push(a, b, c, b, d, c); idB.push(a, c, b, b, c, d);
    }
    const mk = (pos, idx, uv) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); return g;
    };
    P.add(m.thatch, mk(top, idT, uvT), null, { tint: [1, 1, 1], shade: (x, y) => 0.82 + 0.18 * smoothstep(Yeave, Yeave + 1.2, y) });
    P.add(m.thatch, mk(bot, idB, uvT), null, { tint: [0.42, 0.37, 0.32] });
    // rolled lip along the perimeter
    const loop = [];
    for (let i = 0; i <= nx; i++) loop.push([i, 0]);
    for (let j = 1; j <= nz; j++) loop.push([nx, j]);
    for (let i = nx - 1; i >= 0; i--) loop.push([i, nz]);
    for (let j = nz - 1; j >= 1; j--) loop.push([0, j]);
    const lipPt = ([i, j]) => {
      const [x, y, z] = grid[ix(i, j)];
      const ox = x - cx, oz = z - cz, ol = Math.hypot(ox / hx, oz / hz) || 1;
      return new V3(x + (ox / hx / ol) * 0.04, y - TH * 0.5, z + (oz / hz / ol) * 0.04);
    };
    const prof = circleProfile(TH * 0.56, 12);
    if (!sidesOnly) {
      P.add(m.thatch, sweep(loop.map(lipPt), prof, { side: new V3(0, 1, 0), closed: true, uvScale: [0.3, 0.6] }), null, { tint: [0.78, 0.72, 0.64] });
    } else {
      for (const i of [0, nx]) {
        const pts = []; for (let j = 0; j <= nz; j++) pts.push(lipPt([i, j]));
        P.add(m.thatch, sweep(pts, prof, { side: new V3(1, 0, 0), uvScale: [0.3, 0.6] }), null, { tint: [0.78, 0.72, 0.64] });
      }
    }
  }
  const uv1 = (x, z) => {
    const a = mLong(z), b = mEnd(x);
    return a < b ? [x / 3.2, 0.04 + 0.93 * a / Ez] : [z / 3.2 + 0.37, 0.04 + 0.93 * b / Ez];
  };
  shell(H1, -Ex, Ex, zc - Ez, zc + Ez, 64, 56, 1.3, uv1);
  shell(H2, -(Gx + 0.45), Gx + 0.45, zc - Zg2, zc + Zg2, 40, 36, 0.15, (x, z) => [x / 3.2 + 0.11, 0.04 + 0.93 * mLong(z) / Ez], true);

  // ridge cap (cedar bark bundle) with crossed logs (karasu-odori)
  {
    const ry = hm(Ez) + 0.07;
    const path = [];
    for (let i = 0; i <= 24; i++) { const x = lerp(-(Gx + 0.42), Gx + 0.42, i / 24); path.push(new V3(x, ry + 0.06 + 0.12 * (x / (Gx + 0.6)) ** 4, zc)); }
    P.add(m.bark, sweep(path, roundRectProfile(0.62, 0.42, 0.17, 3), { side: new V3(0, 0, 1), uvScale: [0.5, 0.5] }), null, { tint: [0.75, 0.68, 0.62] });
    for (let k = 0; k < 7; k++) {
      const x = lerp(-Gx + 0.2, Gx - 0.2, k / 6);
      P.piece(m.darkWood, 0.12, 0.12, 1.05, x, ry + 0.3 + 0.12 * (x / (Gx + 0.6)) ** 4, zc, { r: 0.05, ry: (rnd() - 0.5) * 0.08, tint: [0.7, 0.66, 0.62] });
    }
    // bamboo binding bands
    for (let k = 0; k < 12; k++) {
      const x = lerp(-Gx - 0.4, Gx + 0.4, (k + 0.5) / 12);
      P.add(m.bambooDry, new THREE.TorusGeometry(0.27, 0.025, 6, 16), M(x, ry + 0.06 + 0.12 * (x / (Gx + 0.6)) ** 4, zc, PI / 2, 0, 0, 1, 0.78, 1), { tint: [0.6, 0.55, 0.45] });
    }
  }
  // gable walls (tsuma) of dark boards with a vertical lattice
  for (const sx of [-1, 1]) {
    const gx = sx * (Gx - 0.02);
    const yb = Yg - 0.28;
    let zb = 0; for (let z = 0; z < Zg2; z += 0.01) { if (H2(gx, zc + z) - TH - 0.02 < yb) { zb = z; break; } }
    const s = new THREE.Shape();
    s.moveTo(-zb, yb);
    for (let k = 0; k <= 30; k++) { const z = lerp(-zb, zb, k / 30); s.lineTo(z, Math.max(yb, H2(gx, zc + z) - TH - 0.03)); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 4 });
    const basis = new THREE.Matrix4().makeBasis(new V3(0, 0, sx), new V3(0, 1, 0), new V3(-sx, 0, 0)).setPosition(gx, 0, zc);
    P.add(m.darkWood, g, basis, { uv: (gg) => { const uv = gg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.6, uv.getX(i) * 0.6); }, tint: [0.8, 0.75, 0.7] });
    for (let z = -zb + 0.12; z < zb - 0.08; z += 0.13) {
      const yt = H2(gx, zc + z) - TH - 0.06;
      if (yt - yb < 0.15) continue;
      P.piece(m.timber, 0.03, yt - yb, 0.045, gx + sx * 0.03, (yt + yb) / 2, zc + z, { r: 0.01, tint: [0.65, 0.6, 0.55] });
    }
    P.piece(m.timber, 0.07, 0.1, zb * 2, gx + sx * 0.05, yb + 0.25, zc, { r: 0.02 });
  }
  // rafters under the eaves
  {
    const prof = circleProfile(0.03, 6);
    const rafter = (pts) => P.add(m.bambooDry, sweep(pts, prof, { side: new V3(0, 1, 0), uvScale: [0.6, 1] }), null, { tint: mul(jitter(rnd, 0.1), 0.55) });
    for (let x = -3.15; x <= 3.16; x += 0.42) {
      for (const [za, zb] of [[RZ1 - 0.05, zc + Ez - 0.25], [RZ0 + 0.05, zc - Ez + 0.25]]) {
        const pts = []; for (let k = 0; k <= 6; k++) { const z = lerp(za, zb, k / 6); pts.push(new V3(x, under(x, z) - 0.035, z)); }
        rafter(pts);
      }
    }
    for (let z = -2.2; z <= 1.9; z += 0.42) {
      for (const [xa, xb] of [[RX - 0.05, Ex - 0.25], [-RX + 0.05, -Ex + 0.25]]) {
        const pts = []; for (let k = 0; k <= 5; k++) { const x = lerp(xa, xb, k / 5); pts.push(new V3(x, under(x, z) - 0.035, z)); }
        rafter(pts);
      }
    }
  }

  // ---------------------------------------------------------------- footings + posts
  function footing(lx, lz, size = 0.2) {
    const g = gAt(lx, lz);
    const seed = Math.floor(rnd() * 1e6);
    if (g > WATER_Y + 0.03) {
      const top = g + 0.12;
      P.add(m.carved, rockGeo(seed, { detail: 2, scale: [size * 1.5, 0.18, size * 1.5], flatTop: 0.12, facets: 4, bump: 0.15 }), M(lx, top - 0.12, lz, rnd() * TAU),
        { tint: jitter(rnd, 0.08) });
      return top;
    }
    const top = WATER_Y + 0.24, bot = g - 0.3, h = top - bot;
    P.add(m.stone, rockGeo(seed, { detail: 3, scale: [size * 1.35, h / 2, size * 1.35], flatTop: h / 2 - 0.03, facets: 4, bump: 0.1, topSoft: 0.05 }),
      M(lx, top - (h / 2 - 0.03), lz, rnd() * TAU), { tint: jitter(rnd, 0.08), refract: true });
    return top;
  }
  const post = (lx, lz, yTop, size = 0.15, mat = m.timber) => {
    const yb = footing(lx, lz, size * 1.2);
    P.piece(mat, size, yTop - yb, size, lx, (yTop + yb) / 2, lz, { r: 0.028, refract: yb < 0.3, tint: jitter(rnd, 0.08, 0.02) });
  };
  const wallPosts = [
    ...[-3, -1.5, 0, 1.5, 3].map(x => [x, RZ1]), ...[-3, -1, 1, 3].map(x => [x, RZ0]), [3, -0.6], [-3, -0.6],
  ];
  for (const [x, z] of wallPosts) post(x, z, HB + 0.05);
  for (const x of [-RX, RX]) post(x, EZ, HB + 0.05, 0.16);
  // short under-floor posts (tsuka) along the platform edge
  for (const [x, z] of [[-1.5, EZ], [1.5, EZ], [-PX + 0.1, -2.8], [PX - 0.1, -2.8], [-PX + 0.1, -0.6], [PX - 0.1, -0.6], [-PX + 0.1, 1.45], [PX - 0.1, 1.45], [0, -2.82]]) post(x, z, FL - 0.18, 0.12);

  // ---------------------------------------------------------------- beams
  P.piece(m.timber, 2 * RX + 0.3, 0.24, 0.16, 0, HB - 0.08, RZ1, {});
  P.piece(m.timber, 2 * RX + 0.3, 0.24, 0.16, 0, HB - 0.08, RZ0, {});
  for (const x of [-RX, RX]) P.piece(m.timber, 0.16, 0.24, RZ1 - RZ0 + 0.3, x, HB - 0.08, (RZ0 + RZ1) / 2, {});
  for (const x of [-RX, RX]) P.piece(m.timber, 0.13, 0.2, EZ - RZ1 + 0.45, x, HB - 0.02, (EZ + RZ1) / 2 + 0.1, {});
  {   // engawa beam with a slight camber
    const path = []; for (let i = 0; i <= 16; i++) { const x = lerp(-PX - 0.1, PX + 0.1, i / 16); path.push(new V3(x, HB + 0.02 + 0.05 * (1 - (x / PX) ** 2), EZ)); }
    P.add(m.timber, sweep(path, roundRectProfile(0.16, 0.24, 0.04, 2), { side: new V3(0, 0, 1), uvScale: [0.6, 0.55] }), null, { tint: jitter(rnd, 0.05) });
  }

  // ---------------------------------------------------------------- floor, engawa, deck
  P.piece(m.darkWood, 2 * RX, 0.14, RZ1 - RZ0, 0, FL - 0.08, (RZ0 + RZ1) / 2, { r: 0.02 });
  {
    const tg = new THREE.PlaneGeometry(2 * RX - 0.12, RZ1 - RZ0 - 0.12).rotateX(-PI / 2);
    P.add(m.tatami, tg, M(0, FL + 0.012, (RZ0 + RZ1) / 2), { tint: [1, 1, 1] });
  }
  const board = (mat, len, w, along, x, y, z, tint) => {
    if (along === 'x') P.piece(mat, len, 0.05, w - 0.012, x, y - 0.025, z, { r: 0.012, tint, ry: (rnd() - 0.5) * 0.004 });
    else P.piece(mat, w - 0.012, 0.05, len, x, y - 0.025, z, { r: 0.012, tint, ry: (rnd() - 0.5) * 0.004 });
  };
  for (let z = RZ1 + 0.1; z < PZ1 - 0.01; z += 0.165) board(m.hinoki, 2 * PX, 0.165, 'x', 0, FL, Math.min(z + 0.0825, PZ1 - 0.08), mul(jitter(rnd, 0.1, 0.03), 0.92));
  for (const sx of [-1, 1]) for (let x = RX + 0.1; x < PX; x += 0.16) board(m.hinoki, RZ1 - PZ0 + 0.05, 0.16, 'z', sx * (x + 0.08), FL, (PZ0 + RZ1) / 2, mul(jitter(rnd, 0.1, 0.03), 0.9));
  board(m.hinoki, 2 * RX + 0.16, RZ0 - PZ0 - 0.07, 'x', 0, FL, (PZ0 + RZ0) / 2 - 0.04, mul(jitter(rnd, 0.1), 0.9));
  // edge beams of the platform
  P.piece(m.timber, 2 * PX + 0.1, 0.17, 0.13, 0, FL - 0.12, PZ1 - 0.04, {});
  P.piece(m.timber, 2 * PX + 0.1, 0.17, 0.13, 0, FL - 0.12, PZ0 + 0.04, {});
  for (const sx of [-1, 1]) P.piece(m.timber, 0.13, 0.17, PZ1 - PZ0, sx * (PX - 0.04), FL - 0.12, (PZ0 + PZ1) / 2, {});
  // deck boards (weathered), joists, edge beam, slender posts with braces
  for (let z = PZ1 + 0.02; z < DZ1 - 0.05; z += 0.18) {
    const j0 = (rnd() - 0.5) * 0.12, j1 = (rnd() - 0.5) * 0.12;
    const x0 = DX0 + j0, x1 = DX1 + j1;
    P.piece(m.weathered, x1 - x0, 0.055, 0.165, (x0 + x1) / 2, DY - 0.028 + (rnd() - 0.5) * 0.01, z + 0.09, { r: 0.015, ry: (rnd() - 0.5) * 0.01, rx: (rnd() - 0.5) * 0.02, tint: jitter(rnd, 0.12, 0.04) });
  }
  const jx = [DX0 + 0.15, lerp(DX0, DX1, 0.36), lerp(DX0, DX1, 0.68), DX1 - 0.15];
  for (const x of jx) P.piece(m.weathered, 0.09, 0.12, DZ1 - PZ1 + 0.05, x, DY - 0.115, (PZ1 + DZ1) / 2, { r: 0.02, tint: [0.75, 0.72, 0.7] });
  P.piece(m.weathered, DX1 - DX0 + 0.1, 0.16, 0.12, (DX0 + DX1) / 2, DY - 0.13, DZ1 - 0.08, { tint: [0.8, 0.76, 0.72] });
  for (const x of jx) for (const z of [PZ1 + 0.75, DZ1 - 0.12]) {
    const g = gAt(x, z);
    P.rod(m.pier, [x, g - 0.3, z], [x, DY - 0.17, z], 0.07, { seg: 10, refract: true, tint: jitter(rnd, 0.1) });
  }
  for (const z of [PZ1 + 0.75, DZ1 - 0.12]) P.piece(m.pier, DX1 - DX0, 0.08, 0.06, (DX0 + DX1) / 2, 0.32, z, { refract: true, tint: [0.85, 0.8, 0.78] });
  for (const x of [jx[0], jx[3]]) P.piece(m.pier, 0.06, 0.08, DZ1 - PZ1 - 0.75, x, 0.32, (PZ1 + 0.75 + DZ1 - 0.12) / 2, { refract: true });
  // low railing (koran) on three sides of the deck
  {
    const rh = 0.5, y0 = DY;
    const rail = (pts) => {
      for (let i = 0; i < pts.length; i++) P.piece(m.hinoki, 0.075, rh + 0.03, 0.075, pts[i][0], y0 + rh / 2, pts[i][1], { r: 0.018, tint: mul(jitter(rnd, 0.06), 0.85) });
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax);
        P.piece(m.hinoki, len + 0.08, 0.055, 0.085, (ax + bx) / 2, y0 + rh + 0.02, (az + bz) / 2, { ry, r: 0.025, tint: mul(jitter(rnd, 0.05), 0.95) });
        P.piece(m.hinoki, len, 0.035, 0.03, (ax + bx) / 2, y0 + rh * 0.45, (az + bz) / 2, { ry, r: 0.01, tint: mul(jitter(rnd, 0.05), 0.85) });
      }
    };
    const fz = DZ1 - 0.06, lx = DX0 + 0.05, rx = DX1 - 0.05;
    rail([[lx, PZ1 + 0.45], [lx, (PZ1 + fz) / 2 + 0.2], [lx, fz], [lerp(lx, rx, 0.33), fz], [lerp(lx, rx, 0.66), fz], [rx, fz], [rx, (PZ1 + fz) / 2 + 0.2], [rx, PZ1 + 0.45]]);
  }

  // ---------------------------------------------------------------- walls
  // A wall runs from (x0,z0) to (x1,z1); its local +Z is the outside. bays: list of specs between consecutive posts.
  function wall(x0, z0, x1, z1, posts, bays) {
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    const F = M(x0, 0, z0, Math.atan2(-dz, dx));
    const W = placer(B, base.clone().multiply(F), rnd);
    const top = (u) => under(x0 + dx * u, z0 + dz * u) + 0.16;
    const D = 0.09;
    const plaster = (u0, u1, y0, holes = []) => {
      const s = new THREE.Shape();
      s.moveTo(u0, y0); s.lineTo(u1, y0);
      for (let k = 0; k <= 8; k++) { const u = lerp(u1, u0, k / 8); s.lineTo(u, top(u)); }
      s.closePath();
      for (const h of holes) {
        const p = new THREE.Path();
        if (h.r) p.absarc(h.u, h.y, h.r, 0, TAU, true);
        else { p.moveTo(h.u0, h.y0); p.lineTo(h.u0, h.y1); p.lineTo(h.u1, h.y1); p.lineTo(h.u1, h.y0); p.closePath(); }
        s.holes.push(p);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 32 });
      g.translate(0, 0, -D / 2);
      const ou = rnd() * 3, ov = rnd() * 3;
      W.add(m.plaster, g, null, {
        uv: (gg) => { const uv = gg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.45 + ou, uv.getY(i) * 0.45 + ov); },
        tint: jitter(rnd, 0.04, 0.02), shade: (x, y) => 0.8 + 0.2 * smoothstep(FL, FL + 0.8, y),
      });
    };
    const koshi = (u0, u1) => {   // wainscot of vertical weathered boards + a rail
      for (let u = u0; u < u1 - 0.02; u += 0.14) {
        const w = Math.min(0.14, u1 - u);
        W.piece(m.weathered, w - 0.008, 0.55, 0.03, u + w / 2, FL + 0.17, D / 2 + 0.012, { r: 0.008, tint: jitter(rnd, 0.1, 0.03) });
      }
      W.piece(m.timber, u1 - u0, 0.06, 0.06, (u0 + u1) / 2, FL + 0.45, D / 2 + 0.02, { r: 0.015 });
    };
    const bambooBars = (u0, u1, y0, y1, step = 0.065) => {
      for (let u = u0 + step / 2; u < u1; u += step) W.rod(m.bambooDry, [u, y0, D / 2 + 0.02], [u, y1, D / 2 + 0.02], 0.012, { seg: 6, tint: mul(jitter(rnd, 0.1), 0.85) });
      for (const y of [y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.72]) W.rod(m.bambooDry, [u0, y, D / 2 + 0.035], [u1, y, D / 2 + 0.035], 0.011, { seg: 6, tint: [0.7, 0.65, 0.55] });
    };
    const paper = (u0, u1, y0, y1) => {
      const g = new THREE.PlaneGeometry(u1 - u0, y1 - y0);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (u1 - u0) / 0.7, 0.2 + uv.getY(i) * 0.75 * (y1 - y0) / 1.5);
      W.add(m.shoji, g, M((u0 + u1) / 2, (y0 + y1) / 2, -0.01), { tint: [1, 1, 1] });
    };
    const frame = (u0, u1, y0, y1) => {
      const t = 0.05;
      W.piece(m.timber, u1 - u0 + 2 * t, t, 0.06, (u0 + u1) / 2, y0 - t / 2, D / 2, { r: 0.012 });
      W.piece(m.timber, u1 - u0 + 2 * t, t, 0.06, (u0 + u1) / 2, y1 + t / 2, D / 2, { r: 0.012 });
      W.piece(m.timber, t, y1 - y0, 0.06, u0 - t / 2, (y0 + y1) / 2, D / 2, { r: 0.012 });
      W.piece(m.timber, t, y1 - y0, 0.06, u1 + t / 2, (y0 + y1) / 2, D / 2, { r: 0.012 });
    };
    for (let i = 0; i < bays.length; i++) {
      const ua = posts[i] + 0.075, ub = posts[i + 1] - 0.075, b = bays[i];
      if (b.type === 'shoji') {
        W.piece(m.timber, ub - ua, 0.08, 0.13, (ua + ub) / 2, FL + 0.03, 0, { r: 0.015 });            // sill (shikii)
        W.piece(m.timber, ub - ua, 0.09, 0.12, (ua + ub) / 2, FL + 1.85, 0, { r: 0.015 });            // lintel (kamoi)
        plaster(ua, ub, FL + 1.895);
        const pw = (ub - ua) / 2 + 0.015, ph = 1.78;
        for (const [pos, track] of b.panels) {
          const u = ua + pw / 2 + pos * (ub - ua - pw), w = (track - 0.5) * 0.04;
          const st = 0.032;
          W.piece(m.hinoki, st, ph, 0.03, u - pw / 2 + st / 2, FL + 0.07 + ph / 2, w, { r: 0.008 });
          W.piece(m.hinoki, st, ph, 0.03, u + pw / 2 - st / 2, FL + 0.07 + ph / 2, w, { r: 0.008 });
          W.piece(m.hinoki, pw, 0.04, 0.03, u, FL + 0.07 + ph - 0.02, w, { r: 0.008 });
          W.piece(m.hinoki, pw, 0.05, 0.03, u, FL + 0.095, w, { r: 0.008 });
          const pg = new THREE.PlaneGeometry(pw - 2 * st, ph - 0.09);
          W.add(m.shoji, pg, M(u, FL + 0.12 + (ph - 0.09) / 2, w), { tint: [1, 1, 1] });
        }
      } else {
        const holes = [];
        let y0 = FL + 0.42;
        if (b.door) { y0 = FL - 0.08; holes.push({ u0: b.door[0], u1: b.door[1], y0: FL + 0.02, y1: FL + 0.74 }); }
        if (b.win) holes.push({ u0: b.win[0], u1: b.win[1], y0: b.win[2], y1: b.win[3] });
        if (b.round) holes.push({ u: b.round[0], y: b.round[1], r: b.round[2] });
        if (b.door) { koshi(ua, b.door[0] - 0.06); koshi(b.door[1] + 0.06, ub); }
        else koshi(ua, ub);
        plaster(ua, ub, y0, holes);
        if (b.win) { const [u0, u1, a, c] = b.win; bambooBars(u0, u1, a, c); paper(u0, u1, a, c); frame(u0, u1, a, c); }
        if (b.round) {
          const [cu, cy, r] = b.round;
          for (let d = -r + 0.09; d < r; d += 0.09) { const h = Math.sqrt(r * r - d * d) - 0.01; W.rod(m.bambooDry, [cu + d, cy - h, 0], [cu + d, cy + h, 0], 0.011, { seg: 6, tint: [0.7, 0.62, 0.5] }); }
          for (const dy of [-0.14, 0.14]) { const h = Math.sqrt(r * r - dy * dy) - 0.01; W.rod(m.bambooDry, [cu - h, cy + dy, 0.015], [cu + h, cy + dy, 0.015], 0.011, { seg: 6, tint: [0.7, 0.62, 0.5] }); }
          const cg = new THREE.CircleGeometry(r + 0.02, 32);
          W.add(m.shoji, cg, M(cu, cy, -0.025), { tint: [1, 1, 1] });
        }
        if (b.door) {          // nijiriguchi: a small board door, slightly ajar
          const [u0, u1] = b.door;
          for (let k = 0; k < 4; k++) W.piece(m.weathered, (u1 - u0) / 4 - 0.006, 0.7, 0.025, u0 + 0.12 + (k + 0.5) * (u1 - u0) / 4, FL + 0.38, D / 2 + 0.03, { r: 0.006, tint: mul(jitter(rnd, 0.1), 0.85) });
          W.piece(m.timber, u1 - u0 + 0.1, 0.05, 0.05, u0 + 0.12 + (u1 - u0) / 2, FL + 0.55, D / 2 + 0.05, { r: 0.01 });
          W.piece(m.timber, u1 - u0 + 0.1, 0.05, 0.05, u0 + 0.12 + (u1 - u0) / 2, FL + 0.18, D / 2 + 0.05, { r: 0.01 });
          frame(u0, u1, FL + 0.02, FL + 0.74);
        }
        if (b.rail !== false) W.piece(m.timber, ub - ua, 0.05, 0.04, (ua + ub) / 2, FL + 1.85, D / 2 + 0.01, { r: 0.012, tint: [0.85, 0.82, 0.8] });
      }
    }
  }
  // front: shoji (two middle bays partly open toward the pond)
  wall(-RX, RZ1, RX, RZ1, [0, 1.5, 3, 4.5, 6], [
    { type: 'shoji', panels: [[0, 0], [1, 1]] },
    { type: 'shoji', panels: [[0, 0], [0.04, 1]] },
    { type: 'shoji', panels: [[1, 1], [0.96, 0]] },
    { type: 'shoji', panels: [[0, 0], [0.62, 1]] },
  ]);
  // back
  wall(RX, RZ0, -RX, RZ0, [0, 2, 4, 6], [
    { win: [0.55, 1.45, FL + 0.9, FL + 1.55] }, { rail: true }, { win: [0.6, 1.4, FL + 1.0, FL + 1.5] },
  ]);
  // east (entrance side, faces the default camera): window + nijiriguchi + small high window
  wall(RX, RZ1, RX, RZ0, [0, 2.05, 4.05], [
    { win: [0.45, 1.6, FL + 0.85, FL + 1.6] },
    { door: [2.4, 3.05], win: [3.25, 3.85, FL + 1.15, FL + 1.65] },
  ]);
  // west: round window
  wall(-RX, RZ0, -RX, RZ1, [0, 2.0, 4.05], [{ round: [1.0, FL + 1.2, 0.4] }, {}]);

  // ---------------------------------------------------------------- interior
  P.piece(m.darkWood, 2 * RX, 0.04, RZ1 - RZ0, 0, HB - 0.2, (RZ0 + RZ1) / 2, { r: 0.01, tint: [0.6, 0.55, 0.5] });      // ceiling
  P.piece(m.darkWood, 1.85, 0.12, 0.55, 0, FL + 0.06, RZ0 + 0.33, { r: 0.02, tint: [0.7, 0.6, 0.55] });                  // tokonoma
  P.rod(m.bark, [0.95, FL, RZ0 + 0.6], [0.95, HB - 0.2, RZ0 + 0.6], 0.06, { seg: 10, tint: [0.8, 0.7, 0.6] });            // toko-bashira
  P.piece(m.timber, 1.9, 0.08, 0.06, 0, FL + 1.98, RZ0 + 0.58, { r: 0.015 });
  P.add(m.scroll, new THREE.PlaneGeometry(0.42, 1.26), M(0, FL + 1.18, RZ0 + 0.07), { tint: [1, 1, 1] });
  for (const y of [FL + 1.81, FL + 0.54]) P.rod(m.darkWood, [-0.25, y, RZ0 + 0.08], [0.25, y, RZ0 + 0.08], 0.014, { seg: 6, tint: [0.5, 0.4, 0.35] });
  P.add(m.iron, lathe([[0.0, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.2], [0.035, 0.25], [0.045, 0.27], [0.0, 0.27]], { segs: 16 }), M(0.45, FL + 0.12, RZ0 + 0.33), { tint: [0.9, 0.6, 0.45] });
  // andon lamp
  const andonP = new V3(-1.15, FL, -0.75);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.rod(m.darkWood, [andonP.x + dx * 0.13, FL, andonP.z + dz * 0.13], [andonP.x + dx * 0.13, FL + 0.66, andonP.z + dz * 0.13], 0.012, { seg: 5 });
  P.piece(m.glowPaper, 0.24, 0.38, 0.24, andonP.x, FL + 0.43, andonP.z, { r: 0.02, tint: [1, 1, 1], uv: null });
  P.piece(m.darkWood, 0.3, 0.025, 0.3, andonP.x, FL + 0.23, andonP.z, { r: 0.01 });
  // brazier + kettle, cushions
  P.piece(m.darkWood, 0.34, 0.22, 0.34, 0.65, FL + 0.11, -0.45, { r: 0.03, tint: [0.6, 0.45, 0.35] });
  P.add(m.iron, lathe([[0, 0], [0.12, 0.01], [0.15, 0.08], [0.13, 0.15], [0.06, 0.18], [0.06, 0.2], [0, 0.2]], { segs: 18 }), M(0.65, FL + 0.22, -0.45), { tint: [1, 1, 1] });
  P.piece(m.cushion, 0.5, 0.07, 0.55, 0.05, FL + 0.035, 0.35, { r: 0.03, ry: 0.1, uv: null, tint: [1, 1, 1] });
  P.piece(m.cushion, 0.5, 0.07, 0.55, -0.35, FL + 0.035, -1.55, { r: 0.03, ry: -0.2, uv: null, tint: [0.9, 1, 1] });

  // ---------------------------------------------------------------- entrance stones + tsukubai (east side)
  const flatStone = (lx, lz, r, topAbove = 0.07, seedK = 0, mat = m.carved) => {
    const g = gAt(lx, lz), top = g + topAbove;
    P.add(mat, rockGeo(500 + seedK, { detail: 3, scale: [r, 0.2, r * 0.8], flatTop: 0.06, facets: 5, bump: 0.18 }), M(lx, top - 0.06, lz, rnd() * TAU), { tint: jitter(rnd, 0.08) });
    return top;
  };
  {  // kutsunugi-ishi under the crawl-in door, then stepping stones out to the path
    const lx = RX + 0.85, lz = RZ1 - 2.75;
    const g = gAt(lx, lz), top = Math.max(g + 0.12, FL - 0.42);
    P.add(m.carved, rockGeo(611, { detail: 3, scale: [0.42, (top - g + 0.15) / 2 + 0.05, 0.34], flatTop: (top - g + 0.15) / 2, facets: 5, bump: 0.12 }),
      M(lx, top - (top - g + 0.15) / 2, lz, 0.3), { tint: [1.05, 1.03, 1] });
    flatStone(RX + 1.75, -0.85, 0.34, 0.06, 1); flatStone(RX + 2.35, -0.05, 0.3, 0.05, 2); flatStone(RX + 1.5, 0.75, 0.26, 0.05, 3);
  }
  const tsukubaiWorld = new V3();
  {
    const tx = RX + 1.85, tz = -2.3, g = gAt(tx, tz);
    // basin: rounded stone with a carved bowl
    const prof = [[0.0, -0.1], [0.3, -0.1], [0.36, 0.06], [0.35, 0.22], [0.3, 0.33], [0.2, 0.36], [0.15, 0.34], [0.13, 0.27], [0.08, 0.22], [0, 0.21]];
    const bas = lathe(prof, { segs: 28, warp: (x, y, z) => { const n = 0.03 * noise3(x * 5, y * 5, z * 5); const k = y > 0.3 ? 0.4 : 1; return [x * (1 + n * k), y, z * (1 + n * k)]; } });
    P.add(m.carved, bas, M(tx, g, tz, 0.4), { tint: [1, 1, 1] });
    P.add(m.water, new THREE.CircleGeometry(0.15, 20).rotateX(-PI / 2), M(tx, g + 0.31, tz), { tint: [1, 1, 1], shadow: false });
    flatStone(tx, tz + 0.62, 0.36, 0.08, 4);                     // mae-ishi
    flatStone(tx - 0.62, tz + 0.15, 0.24, 0.2, 5);               // teshoku-ishi
    flatStone(tx + 0.6, tz + 0.2, 0.22, 0.16, 6);                // yuoke-ishi
    for (let k = 0; k < 9; k++) {                                 // pebbles in the 'sea'
      const a = rnd() * TAU, r = 0.42 + rnd() * 0.25, px = tx + Math.cos(a) * r, pz = tz + Math.sin(a) * r * 0.8;
      P.add(m.river, rockGeo(700 + k, { detail: 1, scale: [0.07, 0.04, 0.06], facets: 2 }), M(px, gAt(px, pz) + 0.015, pz, rnd() * TAU), { tint: jitter(rnd, 0.15) });
    }
    // kakei: bamboo spout on a forked post
    const px = tx + 0.45, pz = tz - 0.55, pg = gAt(px, pz);
    P.rod(m.bamboo, [px, pg - 0.1, pz], [px, pg + 0.62, pz], 0.035, { seg: 10, uv: null, tint: [0.9, 0.95, 0.8] });
    const s0 = new V3(px + 0.05, pg + 0.6, pz - 0.08), s1 = new V3(tx + 0.1, g + 0.5, tz - 0.12);
    P.rod(m.bamboo, s0, s1, 0.026, { seg: 10, uv: null, tint: [0.95, 1, 0.85] });
    const tg = new THREE.CylinderGeometry(0.006, 0.008, s1.y - (g + 0.31), 6);
    const tri = new THREE.Mesh(tg, m.trickle);
    tri.position.set(s1.x + 0.02, (s1.y + g + 0.31) / 2 - 0.02, s1.z + 0.01);
    tri.applyMatrix4(base);
    root.add(tri);
    // ladle resting on the basin
    P.rod(m.bambooDry, [tx - 0.3, g + 0.37, tz + 0.05], [tx + 0.22, g + 0.37, tz - 0.04], 0.008, { seg: 5, uv: null, tint: [1, 0.95, 0.85] });
    P.add(m.bambooDry, new THREE.CylinderGeometry(0.035, 0.032, 0.06, 10), M(tx + 0.25, g + 0.39, tz - 0.045), { tint: [1, 0.95, 0.85] });
    tsukubaiWorld.set(tx, g + 0.3, tz).applyMatrix4(base);
  }

  // ---------------------------------------------------------------- furin (glass wind chime) on the engawa beam
  const furin = new THREE.Group();
  const hook = new V3(2.15, HB - 0.1, EZ).applyMatrix4(base);
  furin.position.copy(hook);
  furin.rotation.y = A.rot;
  {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 4), m.darkWood);
    string.position.y = -0.07; furin.add(string);
    const bell = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.0], [0.03, -0.005], [0.06, -0.035], [0.075, -0.08], [0.08, -0.11], [0.078, -0.115]].map(([x, y]) => new THREE.Vector2(x, y)), 20), m.glass);
    bell.position.y = -0.14; bell.castShadow = true; furin.add(bell);
    const clap = new THREE.Group(); clap.position.y = -0.15; furin.add(clap);
    const cs = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 4), m.darkWood); cs.position.y = -0.06; clap.add(cs);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.24), m.strip); strip.position.y = -0.24; strip.castShadow = true; clap.add(strip);
    furin.userData.clap = clap;
  }
  root.add(furin);

  // ---------------------------------------------------------------- interior light
  const light = new THREE.PointLight('#ffb366', 0, 9, 2);
  light.position.copy(new V3(andonP.x, FL + 0.6, andonP.z + 0.3).applyMatrix4(base));
  light.castShadow = false;

  const glowMats = [m.shoji, m.glowPaper];
  return {
    furin, light, tsukubai: tsukubaiWorld,
    update(dt, t, night) {
      const gust = windGustAt(hook.x, hook.z, t);
      const a = (0.05 + 0.3 * gust) * (Math.sin(t * 2.1) * 0.6 + Math.sin(t * 3.7 + 1) * 0.4);
      furin.rotation.z = a * 0.35; furin.rotation.x = a * 0.2 * Math.sin(t * 0.7);
      const c = furin.userData.clap;
      c.rotation.z = a * 1.4 + Math.sin(t * 5.3) * 0.08 * (0.3 + gust); c.rotation.x = Math.sin(t * 1.9 + 2) * (0.1 + 0.4 * gust);
      c.rotation.y = Math.sin(t * 0.9) * 0.6;
      light.intensity = night * 2.4 * (1 + 0.04 * Math.sin(t * 13) + 0.03 * Math.sin(t * 7.1));
    },
    glowMats,
  };
}
