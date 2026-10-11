// vegetation/plants.js — understory: susuki (pampas) clumps, higanbana (red spider lilies), ferns, clipped shrubs,
// moss cushions and fallen leaves. All merged in world space (one draw per material).
import * as THREE from 'three';
import { ANCHORS, mulberry32, bankPoint, smoothstep, clamp, FOOTPRINTS, borderDist, S_POND, IS_SPRING } from '../world.js';
import { buildSpringPlants } from './springPlants.js';
import { GeoBuilder, leafMaterial, swayDepthMaterial, foliagePatch, lin, mixc, mulc, v3 } from './shared.js';
import { TILE, tileUV, plumeTexture, foliageAtlas } from './atlas.js';
import { emitClump, PALETTES } from './trees.js';

const UP = v3(0, 1, 0);
// wind direction (static lean of plumes / drift of fallen leaves) — matches U.uWindDir's default
export const U_WX = 0.86 / Math.hypot(0.86, 0.5), U_WZ = 0.5 / Math.hypot(0.86, 0.5);
const jit = (c, r, k = 0.1) => { const m = 1 - k + r() * 2 * k; return [c[0] * m, c[1] * m, c[2] * m]; };

// A bent ribbon along points pts[] with half-widths w[], colours cols[], side vector per point; world-space wind.
export function ribbon(B, pts, w, cols, side, base, windK, phase, transl, flutter, nrm = null, uvFn = null) {
  const idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], t = i / (pts.length - 1);
    const h = Math.max(0, p.y - base.y);
    const ww = windK * h * h;
    const n = nrm ? nrm(t) : UP;
    for (const sd of [-1, 1]) {
      const [u, v] = uvFn ? uvFn(sd * 0.5 + 0.5, t) : [0.5, 0.5];
      idx.push(B.v([p.x + side.x * w[i] * sd, p.y + side.y * w[i] * sd, p.z + side.z * w[i] * sd], [n.x, n.y, n.z], u, v, cols[i],
        [base.x, base.z, ww, phase], [flutter * t, phase * 7.0, transl, t]));
    }
  }
  for (let i = 0; i < pts.length - 1; i++) B.quad(idx[i * 2], idx[i * 2 + 1], idx[i * 2 + 3], idx[i * 2 + 2]);
}

// ---------------------------------------------------------------- susuki
export const C = {
  susBase: lin('#55602a'), susMid: lin('#8a8a3a'), susTip: lin('#d2b46a'), susRed: lin('#a86a3a'),
  stalk: lin('#b49a62'), plume: lin('#e0c79a'), plumeWarm: lin('#d4a868'),
  lilyRed: lin('#d4180f'), lilyDeep: lin('#a80e0c'), lilyStem: lin('#4a7a2c'),
  shrubGreen: ['#2f4a24', '#3a5628', '#46622c', '#55702f'].map(lin), moss: ['#4a6a24', '#587a2a', '#3e5a20'].map(lin),
  fern: ['#4c7a2c', '#5e8432', '#7a8a34', '#a08a3a'].map(lin),
};

function susuki(B, P, x, y, z, s, rnd) {
  const base = v3(x, y, z), phase = rnd() * 6.28;
  const nLeaves = 22 + ((rnd() * 10) | 0);
  for (let i = 0; i < nLeaves; i++) {
    const a = rnd() * 6.283, d = v3(Math.cos(a), 0, Math.sin(a));
    const L = (1.1 + rnd() * 0.7) * s, segs = 5;
    const o = v3(x + d.x * rnd() * 0.12, y - 0.05, z + d.z * rnd() * 0.12);
    const pts = [], w = [], cols = [];
    const reach = 0.35 + rnd() * 0.35;
    const tipC = rnd() < 0.25 ? C.susRed : C.susTip;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      pts.push(v3(o.x + d.x * L * reach * t * t, o.y + L * (1.35 * t - 0.75 * t * t), o.z + d.z * L * reach * t * t));
      w.push(0.022 * s * (1 - t * 0.85));
      cols.push(t < 0.5 ? mixc(C.susBase, C.susMid, t * 2) : mixc(C.susMid, tipC, (t - 0.5) * 2));
    }
    const side = v3(-d.z, 0, d.x);
    ribbon(B, pts, w, cols, side, base, 0.13, phase, 0.8, 0.3, (t) => v3(d.x * 0.3, 1, d.z * 0.3).normalize());
  }
  // flowering stalks with plumes
  const nSt = 6 + ((rnd() * 8) | 0);
  const plumeUV = (u, v) => [u, 1 - v];
  const wdir = v3(U_WX, 0, U_WZ);
  for (let i = 0; i < nSt; i++) {
    const a = rnd() * 6.283, lean = 0.08 + rnd() * 0.16;
    // stalks fan out a little but all lean (and their plumes nod) downwind
    const d = v3(Math.cos(a) * lean + wdir.x * 0.18, 1, Math.sin(a) * lean + wdir.z * 0.18).normalize();
    const H = (1.35 + rnd() * 0.6) * s;
    const o = v3(x + Math.cos(a) * 0.06, y - 0.05, z + Math.sin(a) * 0.06);
    const sp = [], sw = [], sc = [];
    for (let k = 0; k <= 3; k++) { const t = k / 3; sp.push(o.clone().addScaledVector(d, H * t * 0.8)); sw.push(0.008 * s); sc.push(mixc(C.susBase, C.stalk, t)); }
    const side = v3(-d.z, 0, d.x).normalize();
    ribbon(B, sp, sw, sc, side, base, 0.13, phase, 0.6, 0, null);
    // plume: 2 crossed, slender cards nodding downwind
    const pl = H * (0.3 + rnd() * 0.08);
    const pStart = o.clone().addScaledVector(d, H * 0.76);
    const droop = wdir.clone().multiplyScalar(0.8).add(v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.3)).normalize();
    const tint = mixc(C.plume, C.plumeWarm, rnd());
    for (let c = 0; c < 2; c++) {
      const ang = a + c * Math.PI / 2;
      const sv = v3(Math.cos(ang), 0, Math.sin(ang));
      const pts = [], w = [], cols = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        pts.push(pStart.clone().addScaledVector(d, pl * t * 0.9).addScaledVector(droop, pl * 0.4 * t * t).add(v3(0, -pl * 0.12 * t * t, 0)));
        w.push(0.065 * s * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.2 + t))));
        cols.push(mulc(tint, 0.75 + 0.25 * t));
      }
      ribbon(P, pts, w, cols, sv, base, 0.13, phase, 1.0, 0.5, (t) => v3(droop.x * 0.4, 1, droop.z * 0.4).normalize(), plumeUV);
    }
  }
}

// ---------------------------------------------------------------- higanbana
function lily(B, x, y, z, s, rnd, phase, base) {
  const H = (0.38 + rnd() * 0.14) * s;
  const lean = v3((rnd() - 0.5) * 0.15, 1, (rnd() - 0.5) * 0.15).normalize();
  const o = v3(x, y - 0.03, z);
  const top = o.clone().addScaledVector(lean, H);
  for (let c = 0; c < 2; c++) {
    const sv = c ? v3(1, 0, 0) : v3(0, 0, 1);
    const pts = [o, o.clone().addScaledVector(lean, H * 0.5), top.clone()];
    ribbon(B, pts, [0.007, 0.006, 0.005].map(v => v * s), [mulc(C.lilyStem, 0.6), C.lilyStem, C.lilyStem], sv, base, 0.25, phase, 0.6, 0);
  }
  const ang0 = rnd() * 6.28;
  const nP = 6;
  for (let i = 0; i < nP; i++) {
    const a = ang0 + (i / nP) * 6.283 + (rnd() - 0.5) * 0.3;
    const d = v3(Math.cos(a), 0, Math.sin(a));
    const sv = v3(-d.z, 0, d.x);
    // petal: out and curling back down
    const P = [], W = [], Cc = [];
    const L = 0.085 * s;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      P.push(top.clone().addScaledVector(d, L * (t + 0.1)).add(v3(0, L * (0.45 * t - 1.0 * t * t), 0)));
      W.push(0.013 * s * (1 - t * 0.6)); Cc.push(mixc(C.lilyDeep, C.lilyRed, 0.4 + 0.6 * t));
    }
    ribbon(B, P, W, Cc, sv, base, 0.25, phase, 1.2, 0.4, () => v3(d.x * 0.5, 1, d.z * 0.5).normalize());
    // long stamens sweeping up and out
    const S = [], SW = [], SC = [];
    const ls = 0.15 * s, a2 = a + 0.25;
    const ds = v3(Math.cos(a2), 0, Math.sin(a2));
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      S.push(top.clone().addScaledVector(ds, ls * 0.75 * t).add(v3(0, ls * (0.75 * t - 0.15 * t * t), 0)));
      SW.push(0.0042 * s); SC.push(C.lilyRed);
    }
    ribbon(B, S, SW, SC, v3(-ds.z, 0, ds.x), base, 0.25, phase, 1.2, 0.5, () => UP);
  }
}

// ---------------------------------------------------------------- ferns
export function fern(L, x, y, z, s, rnd) {
  const base = v3(x, y, z), phase = rnd() * 6.28;
  const n = 7 + ((rnd() * 5) | 0);
  const uv = tileUV(TILE.fern);
  const col = C.fern[(rnd() * C.fern.length) | 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rnd() * 0.5, d = v3(Math.cos(a), 0, Math.sin(a));
    const Lf = (0.55 + rnd() * 0.35) * s, rise = 0.5 + rnd() * 0.3;
    const pts = [], w = [], cols = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push(v3(x + d.x * Lf * t, y + Lf * (rise * t - (rise * 0.9) * t * t) + 0.02, z + d.z * Lf * t));
      w.push(Lf * 0.24); cols.push(mulc(jit(col, rnd, 0.06), 0.55 + 0.45 * t));
    }
    const side = v3(-d.z, 0, d.x);
    ribbon(L, pts, w, cols, side, base, 0.12, phase, 0.8, 0.5, (t) => v3(d.x * 0.35, 1, d.z * 0.35).normalize(), (u, t) => uv(u, t));
  }
}

// ---------------------------------------------------------------- placement
export function buildPlants(group, F, placedTrees, leafMat) {
  if (IS_SPRING) return buildSpringPlants(group, F, placedTrees, leafMat);
  const rnd = mulberry32(31337);
  const atlas = foliageAtlas();
  const plantB = new GeoBuilder();      // untextured: susuki leaves/stalks, lilies
  const plumeB = new GeoBuilder();      // plume texture
  const L = new GeoBuilder();           // atlas: ferns, shrubs, moss
  const FL = new GeoBuilder();          // atlas: fallen leaves (no sway)
  const st = { susuki: 0, lilies: 0, lilyClusters: 0, ferns: 0, shrubs: 0, moss: 0, fallen: 0 };
  const taken = [];
  const clear = (x, z, r) => !taken.some(t => Math.hypot(t[0] - x, t[1] - z) < r + t[2]);

  // susuki in the meadows
  for (const m of ANCHORS.zones.pampasMeadows) {
    const n = Math.round(m.r * m.r * 0.6);
    let made = 0, tries = 0;
    while (made < n && tries++ < n * 12) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.65) * m.r * 1.1;
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      if (!F.free(x, z, 0.35, 0.4, 0.4) || !clear(x, z, 0.75)) continue;
      if (borderDist(x, z) > -1) continue;
      const edgeFade = 1 - smoothstep(m.r * 0.5, m.r * 1.1, d);
      if (rnd() > 0.35 + 0.65 * edgeFade) continue;
      susuki(plantB, plumeB, x, F.h(x, z), z, 0.8 + 0.45 * edgeFade + rnd() * 0.2, rnd);
      taken.push([x, z, 0.5]); made++; st.susuki++;
    }
  }
  // susuki scattered along the banks
  for (let i = 0; i < 46; i++) {
    const s = S_POND - 42 + rnd() * 95, side = rnd() < 0.5 ? 1 : -1;
    const p = bankPoint(s, side, 0.6 + rnd() * 2.2);
    if (borderDist(p.x, p.z) > -1 || !F.free(p.x, p.z, 0.35, 0.3, 0.6) || !clear(p.x, p.z, 1.2)) continue;
    susuki(plantB, plumeB, p.x, F.h(p.x, p.z), p.z, 0.75 + rnd() * 0.35, rnd);
    taken.push([p.x, p.z, 0.5]); st.susuki++;
  }

  // higanbana drifts along the lily banks (both sides), plus a few by the shrine path
  const lilyAt = (x, z, nF, spread) => {
    const base = v3(x, F.h(x, z), z), phase = rnd() * 6.28;
    let made = 0;
    for (let k = 0; k < nF; k++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * spread;
      const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
      if (!F.free(fx, fz, 0.02, 0.15, 0.05)) continue;
      lily(plantB, fx, F.h(fx, fz), fz, 1.0 + rnd() * 0.25, rnd, phase, base); made++;
    }
    if (made) { st.lilyClusters++; st.lilies += made; taken.push([x, z, spread * 0.8]); }
  };
  for (const lb of ANCHORS.zones.lilyBanks) {
    for (let s = lb.s0; s < lb.s1; s += 0.9 + rnd() * 0.8) {
      for (const side of [1, -1]) {
        if (rnd() < 0.25) continue;
        const p = bankPoint(s, side, 0.35 + rnd() * 1.6);
        if (!F.free(p.x, p.z, 0.1, 0.2, 0.2) || !clear(p.x, p.z, 0.1)) continue;
        lilyAt(p.x, p.z, 6 + ((rnd() * 10) | 0), 0.45 + rnd() * 0.3);
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    const p = ANCHORS.paths[2].pts[1 + (i % 3)];
    const x = p[0] + (rnd() - 0.5) * 6, z = p[1] + (rnd() - 0.5) * 6;
    if (F.pd(x, z) < 0.3 || F.pd(x, z) > 2.2 || !F.free(x, z, 0.1, 0.5, 0.2)) continue;
    lilyAt(x, z, 5 + ((rnd() * 6) | 0), 0.4);
  }

  // ferns: near water, by rocks, and on the cedar grove floor
  const fernAt = (x, z, s) => { if (!F.free(x, z, 0.3, 0.15, 0.35) || !clear(x, z, 0.5)) return; fern(L, x, F.h(x, z), z, s, rnd); taken.push([x, z, 0.4]); st.ferns++; };
  for (const r of ANCHORS.rocks) for (let k = 0; k < 2; k++) { const a = rnd() * 6.28, d = r.s * 1.15 + 0.4 + rnd() * 0.5; fernAt(r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, 0.7 + rnd() * 0.4); }
  for (let i = 0; i < 70; i++) { const p = bankPoint(S_POND - 45 + rnd() * 100, rnd() < 0.5 ? 1 : -1, 0.3 + rnd() * 1.2); if (borderDist(p.x, p.z) < 0) fernAt(p.x, p.z, 0.6 + rnd() * 0.4); }
  const g = ANCHORS.zones.cedarGrove;
  for (let i = 0; i < 55; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * g.r; fernAt(g.x + Math.cos(a) * d, g.z + Math.sin(a) * d * 0.8, 0.8 + rnd() * 0.5); }

  // clipped shrubs (karikomi) + autumn azaleas: around the teahouse and along paths
  const shrubAt = (x, z, red, sc) => {
    if (!F.free(x, z, 0.5, 0.5, 0.35) || !clear(x, z, 0.7 * sc)) return;
    const y = F.h(x, z), base = v3(x, y, z), phase = rnd() * 6.28;
    const r = (0.55 + rnd() * 0.3) * sc;
    const pal = red ? PALETTES.shrubRed : C.shrubGreen;
    const cc = v3(x, y + r * 0.55, z);
    emitClump(L, cc, {
      tiles: [TILE.shrub], size: 0.42 * sc, count: Math.round(34 * sc), radius: r, ry: 0.72,
      colorFn: (p, out, rr) => jit(pal[(rr() * pal.length) | 0], rr, 0.08), crownC: cc, crownR: v3(r, r * 0.72, r), crownBlend: 0.75,
      windW: (p) => 0.03 * Math.max(0, p.y - y), base, phase, transl: 0.7, flutter: 0.4, aoMin: 0.35,
    }, rnd);
    taken.push([x, z, r]); st.shrubs++;
  };
  const tea = ANCHORS.teahouse, fpTea = FOOTPRINTS[0];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.283;
    const lx = Math.cos(a) * (fpTea.hx + 0.6 + rnd() * 1.2), lz = Math.sin(a) * (fpTea.hz + 0.6 + rnd() * 1.2);
    const x = tea.x + lx * Math.cos(tea.rot) + lz * Math.sin(tea.rot), z = tea.z - lx * Math.sin(tea.rot) + lz * Math.cos(tea.rot);
    shrubAt(x, z, rnd() < 0.4, 0.9 + rnd() * 0.4);
  }
  for (const p of ANCHORS.paths) {
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1], [bx, bz] = p.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = rnd() * 4; d < len; d += 3 + rnd() * 4) {
        const t = d / len, nx = -(bz - az) / len, nz = (bx - ax) / len, sd = rnd() < 0.5 ? 1 : -1;
        const off = p.w / 2 + 0.9 + rnd() * 0.8;
        if (rnd() < 0.45) shrubAt(ax + (bx - ax) * t + nx * off * sd, az + (bz - az) * t + nz * off * sd, rnd() < 0.5, 0.75 + rnd() * 0.4);
      }
    }
  }
  for (const l of ANCHORS.lanterns) shrubAt(l.x + (rnd() - 0.5) * 2.5, l.z + (rnd() - 0.5) * 2.5, rnd() < 0.5, 0.8);

  // moss cushions at rock feet
  for (const r of ANCHORS.rocks) {
    const k = 1 + ((rnd() * 2) | 0);
    for (let i = 0; i < k; i++) {
      const a = rnd() * 6.28, d = r.s * 1.05 + rnd() * 0.25;
      const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      if (F.edge(x, z) < 0.05) continue;
      const y = F.h(x, z), base = v3(x, y, z), rr = 0.3 + rnd() * 0.25;
      const cc = v3(x, y + rr * 0.1, z);
      emitClump(L, cc, {
        tiles: [TILE.shrub], size: 0.3, count: 14, radius: rr, ry: 0.3, flatten: 0.7,
        colorFn: (p, o, q) => jit(C.moss[(q() * 3) | 0], q, 0.1), crownC: cc, crownR: v3(rr, rr * 0.4, rr), crownBlend: 0.6,
        windW: () => 0, base, phase: 0, transl: 0.5, flutter: 0, aoMin: 0.5,
      }, rnd);
      st.moss++;
    }
  }

  // fallen leaves under maples/ginkgos and drifting along the path edges
  const fallen = (x, z, pal, sz) => {
    if (F.edge(x, z) < 0.15 || F.blocked(x, z)) return;
    const y = F.h(x, z) + 0.025 + rnd() * 0.01;
    const e = 0.3, hx = F.h(x + e, z) - F.h(x - e, z), hz = F.h(x, z + e) - F.h(x, z - e);
    const n = v3(-hx, 2 * e, -hz).normalize();
    n.x += (rnd() - 0.5) * 0.5; n.z += (rnd() - 0.5) * 0.5; n.normalize();
    const a = rnd() * 6.283;
    let t1 = v3(Math.cos(a), 0, Math.sin(a)); t1.addScaledVector(n, -t1.dot(n)).normalize();
    const t2 = v3().crossVectors(n, t1);
    const tile = pal === 'ginkgo' ? TILE.ginkgoLeaf : TILE.mapleLeaf[(rnd() * 2) | 0];
    const uv = tileUV(tile);
    const src = pal === 'ginkgo' ? PALETTES.ginkgo : PALETTES.maple;
    let c = src[(rnd() * src.length) | 0];
    c = mixc(c, lin('#7a4a2a'), rnd() * 0.45);           // some browning
    const s = sz * (0.7 + rnd() * 0.6);
    const ids = [];
    for (const [cs, ct] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const curl = (cs * cs) * 0.25 * s;
      const p = v3(x, y + curl, z).addScaledVector(t1, cs * s).addScaledVector(t2, ct * s);
      const [u, v] = uv(cs + 0.5, ct + 0.5);
      ids.push(FL.v([p.x, p.y, p.z], [n.x, n.y, n.z], u, v, c, [x, z, 0, 0], [0, 0, 0.6, 0]));
    }
    FL.quad(ids[0], ids[1], ids[2], ids[3]);
    st.fallen++;
  };
  for (const t of placedTrees) {
    if (t.type !== 'maple' && t.type !== 'ginkgo') continue;
    const n = Math.round(420 * t.s * t.s);
    const cx = t.crown ? t.crown.x : t.x, cz = t.crown ? t.crown.z : t.z;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.7) * (t.r + 1.2);
      // biased downwind
      fallen(cx + Math.cos(a) * d + U_WX * d * 0.3, cz + Math.sin(a) * d + U_WZ * d * 0.3, t.type, 0.17);
    }
  }
  for (const p of ANCHORS.paths) {
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1], [bx, bz] = p.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let k = 0; k < len * 22; k++) {
        const t = rnd(), sd = rnd() < 0.5 ? 1 : -1;
        const off = (p.w / 2) * (0.4 + Math.pow(rnd(), 0.5) * 0.9) * sd;
        fallen(ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off, rnd() < 0.8 ? 'maple' : 'ginkgo', 0.15);
      }
    }
  }

  // meshes
  const out = [];
  const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  foliagePatch(plantMat, { wrap: 0.6, transl: 1, a2c: false, key: 'P' });
  const plumeTex = plumeTexture();
  const plumeMat = new THREE.MeshStandardMaterial({ map: plumeTex, vertexColors: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
  foliagePatch(plumeMat, { wrap: 0.7, transl: 1.0, texSize: 512, key: 'plume' });
  const plainDepth = swayDepthMaterial(null, 0);
  const mk = (b, mat, name, cast, depth) => {
    if (!b.count) return;
    const m = new THREE.Mesh(b.build(), mat); m.name = name;
    m.castShadow = cast; m.receiveShadow = true; if (depth) m.customDepthMaterial = depth;
    group.add(m); out.push(m);
  };
  mk(plantB, plantMat, 'plants', true, plainDepth);
  mk(plumeB, plumeMat, 'susukiPlumes', true, swayDepthMaterial(plumeTex, 0.3));
  mk(L, leafMat, 'understory', true, swayDepthMaterial(atlas, 0.42));
  mk(FL, leafMat, 'fallenLeaves', false, null);
  st.verts = out.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
  return { meshes: out, stats: st };
}

