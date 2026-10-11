// vegetation/springPlants.js — the SPRING understory (autumn lives in plants.js and is untouched):
// young green grass clumps, nanohana (rapeseed) drifts in the meadows, wildflowers (violets, dandelions, white
// daisies), kakitsubata irises along the banks, ferns, moss, tsutsuji azaleas in bloom and fallen sakura petals.
import * as THREE from 'three';
import { ANCHORS, mulberry32, bankPoint, smoothstep, FOOTPRINTS, borderDist, S_POND, fbm2, BORDER } from '../world.js';
import { GeoBuilder, swayDepthMaterial, foliagePatch, lin, mixc, mulc, v3 } from './shared.js';
import { TILE, tileUV, foliageAtlas } from './atlas.js';
import { emitClump, PALETTES } from './trees.js';
import { ribbon, fern, C, U_WX, U_WZ } from './plants.js';

const UP = v3(0, 1, 0);
const jit = (c, r, k = 0.1) => { const m = 1 - k + r() * 2 * k; return [c[0] * m, c[1] * m, c[2] * m]; };
const S = {
  young: lin('#3f7a2a'), youngMid: lin('#5f9a34'), youngTip: lin('#a6cc5a'),
  rape: ['#f4d63a', '#f2cc2a', '#f6de52'].map(lin), rapeStem: lin('#5a8a30'),
  wild: [['#f6f3ea', 0.34], ['#f2d040', 0.26], ['#c4b0ea', 0.22], ['#9a7ad8', 0.18]].map(([c, w]) => [lin(c), w]),
  irisLeaf: lin('#3e7a40'), irisDeep: lin('#3a2490'), iris: lin('#5c3cc0'), irisPale: lin('#8a72dc'), irisSignal: lin('#f2e2a0'),
  shrubLeaf: ['#2f5a24', '#3a6a28', '#46762c'].map(lin),
  petal: ['#fdeef3', '#fae2ea', '#f7d6e1', '#f3c8d6', '#fff6f8'].map(lin),
};
const pickW = (arr, r) => { let x = r(); for (const [c, w] of arr) { if ((x -= w) <= 0) return c; } return arr[0][0]; };

// n crossed upright cards, base on the ground (tile base at the bottom)
function crossCard(L, x, y, z, w, h, tile, col, windK, phase, transl, rnd, n = 2) {
  const uv = tileUV(tile), a0 = rnd() * Math.PI;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k * Math.PI) / n, dx = Math.cos(a), dz = Math.sin(a);
    const ids = [];
    for (const [cs, ct] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
      const px = x + dx * cs * w, py = y + ct * h, pz = z + dz * cs * w;
      const nn = v3(dx * cs * 0.6, 1, dz * cs * 0.6).normalize();
      const [u, v] = uv(cs + 0.5, ct);
      ids.push(L.v([px, py, pz], [nn.x, nn.y, nn.z], u, v, mulc(col, 0.6 + 0.4 * ct), [x, z, windK * ct * h * h, phase], [0.4 * ct, phase * 9, transl, ct]));
    }
    L.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

// young susuki / grass clump: arching fresh-green leaves, no plumes
function youngClump(B, x, y, z, s, rnd) {
  const base = v3(x, y, z), phase = rnd() * 6.28;
  const n = 14 + ((rnd() * 8) | 0);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = v3(Math.cos(a), 0, Math.sin(a));
    const L = (0.55 + rnd() * 0.45) * s, reach = 0.35 + rnd() * 0.35;
    const pts = [], w = [], cols = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push(v3(x + d.x * L * reach * t * t, y - 0.04 + L * (1.35 * t - 0.75 * t * t), z + d.z * L * reach * t * t));
      w.push(0.02 * s * (1 - t * 0.85));
      cols.push(t < 0.5 ? mixc(S.young, S.youngMid, t * 2) : mixc(S.youngMid, S.youngTip, (t - 0.5) * 2));
    }
    ribbon(B, pts, w, cols, v3(-d.z, 0, d.x), base, 0.14, phase, 0.9, 0.3, () => v3(d.x * 0.3, 1, d.z * 0.3).normalize());
  }
}

// nanohana: a few stems with leaves and a yellow flower head (crossed cards)
function rapeseed(B, L, x, y, z, s, rnd) {
  const base = v3(x, y, z), phase = rnd() * 6.28;
  const n = 4 + ((rnd() * 5) | 0);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.22;
    const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
    const H = (0.42 + rnd() * 0.3) * s;
    const lean = v3((rnd() - 0.5) * 0.2 + U_WX * 0.08, 1, (rnd() - 0.5) * 0.2 + U_WZ * 0.08).normalize();
    const o = v3(sx, y - 0.03, sz);
    const pts = [o, o.clone().addScaledVector(lean, H * 0.5), o.clone().addScaledVector(lean, H)];
    ribbon(B, pts, [0.008, 0.007, 0.006].map(v => v * s), [mulc(S.rapeStem, 0.6), S.rapeStem, S.rapeStem], v3(Math.cos(a), 0, Math.sin(a)), base, 0.2, phase, 0.6, 0);
    // two broad leaves near the base
    for (let k = 0; k < 2; k++) {
      const b = a + k * 3.1 + rnd(), d = v3(Math.cos(b), 0, Math.sin(b));
      const lp = [o.clone().add(v3(0, 0.05, 0)), o.clone().add(v3(d.x * 0.12, 0.14, d.z * 0.12)), o.clone().add(v3(d.x * 0.2, 0.12, d.z * 0.2))];
      ribbon(B, lp, [0.02, 0.035, 0.01].map(v => v * s), [S.young, S.youngMid, S.youngMid], v3(-d.z, 0.3, d.x).normalize(), base, 0.1, phase, 0.8, 0.3);
    }
    const top = o.clone().addScaledVector(lean, H * 0.92);
    crossCard(L, top.x, top.y, top.z, 0.2 * s, 0.17 * s, TILE.flowers, jit(S.rape[(rnd() * 3) | 0], rnd, 0.06), 0.2, phase, 1.0, rnd);
  }
}

// kakitsubata iris: sword leaves + 2-3 flowers (three drooping falls, three upright standards)
function iris(B, x, y, z, s, rnd) {
  const base = v3(x, y, z), phase = rnd() * 6.28;
  const nl = 7 + ((rnd() * 5) | 0);
  for (let i = 0; i < nl; i++) {
    const a = rnd() * 6.283, d = v3(Math.cos(a) * 0.18, 1, Math.sin(a) * 0.18).normalize();
    const H = (0.5 + rnd() * 0.3) * s, o = v3(x + Math.cos(a) * 0.05, y - 0.03, z + Math.sin(a) * 0.05);
    const pts = [o, o.clone().addScaledVector(d, H * 0.5), o.clone().addScaledVector(d, H * 0.85).add(v3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05)), o.clone().addScaledVector(d, H).add(v3(Math.cos(a) * 0.12, -0.03, Math.sin(a) * 0.12))];
    ribbon(B, pts, [0.016, 0.018, 0.012, 0.002].map(v => v * s), [mulc(S.irisLeaf, 0.7), S.irisLeaf, S.irisLeaf, mixc(S.irisLeaf, S.youngTip, 0.3)], v3(-Math.sin(a), 0, Math.cos(a)), base, 0.16, phase, 0.7, 0.1);
  }
  const nf = 1 + ((rnd() * 3) | 0);
  for (let f = 0; f < nf; f++) {
    const a = rnd() * 6.283, H = (0.62 + rnd() * 0.22) * s;
    const o = v3(x + Math.cos(a) * 0.08, y - 0.03, z + Math.sin(a) * 0.08), top = o.clone().add(v3(0, H, 0));
    ribbon(B, [o, o.clone().add(v3(0, H * 0.5, 0)), top.clone()], [0.006, 0.005, 0.005], [S.irisLeaf, S.irisLeaf, S.irisLeaf], v3(1, 0, 0), base, 0.16, phase, 0.6, 0);
    const a0 = rnd() * 6.28;
    for (let k = 0; k < 3; k++) {
      const b = a0 + k * 2.094, d = v3(Math.cos(b), 0, Math.sin(b)), side = v3(-d.z, 0, d.x);
      // fall: out and down, broad, with a pale signal patch at its base
      const fp = [], fw = [], fc = [];
      for (let j = 0; j <= 3; j++) { const t = j / 3; fp.push(top.clone().addScaledVector(d, 0.075 * s * t).add(v3(0, (0.02 * t - 0.06 * t * t) * s, 0))); fw.push((0.012 + 0.022 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.1))) * s); fc.push(t < 0.4 ? mixc(S.irisSignal, S.iris, t / 0.4) : mixc(S.iris, S.irisDeep, (t - 0.4) * 0.8)); }
      ribbon(B, fp, fw, fc, side, base, 0.16, phase, 1.0, 0.4, () => v3(d.x * 0.4, 1, d.z * 0.4).normalize());
      // standard: narrow and upright
      const b2 = b + 1.047, d2 = v3(Math.cos(b2), 0, Math.sin(b2));
      const sp = [top.clone(), top.clone().add(v3(d2.x * 0.012 * s, 0.04 * s, d2.z * 0.012 * s)), top.clone().add(v3(d2.x * 0.02 * s, 0.07 * s, d2.z * 0.02 * s))];
      ribbon(B, sp, [0.006, 0.012, 0.004].map(v => v * s), [S.iris, S.irisPale, S.iris], v3(-d2.z, 0, d2.x), base, 0.16, phase, 1.0, 0.4);
    }
  }
}

export function buildSpringPlants(group, F, placedTrees, leafMat) {
  const rnd = mulberry32(424242);
  const atlas = foliageAtlas();
  const plantB = new GeoBuilder();   // untextured ribbons: grass clumps, stems, irises
  const L = new GeoBuilder();        // atlas: flowers, ferns, azaleas, moss
  const FL = new GeoBuilder();       // atlas: fallen petals (no sway)
  const st = { youngClumps: 0, rapeseed: 0, wildflowers: 0, irises: 0, ferns: 0, azaleas: 0, moss: 0, petals: 0 };
  const taken = [];
  const clear = (x, z, r) => !taken.some(t => Math.hypot(t[0] - x, t[1] - z) < r + t[2]);

  // nanohana drifts in the meadows (dense centres, broken edges)
  for (const m of ANCHORS.zones.pampasMeadows) {
    const n = Math.round(m.r * m.r * 1.6);
    let made = 0, tries = 0;
    while (made < n && tries++ < n * 10) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.6) * m.r * 1.05;
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      if (borderDist(x, z) > -1 || !F.free(x, z, 0.25, 0.4, 0.3) || !clear(x, z, 0.35)) continue;
      const fade = 1 - smoothstep(m.r * 0.45, m.r * 1.05, d);
      if (rnd() > 0.25 + 0.75 * fade || fbm2(x * 0.3, z * 0.3, 2) < -0.35) continue;
      rapeseed(plantB, L, x, F.h(x, z), z, 0.85 + 0.35 * fade + rnd() * 0.15, rnd);
      taken.push([x, z, 0.3]); made++; st.rapeseed++;
    }
    // a few young grass clumps around each meadow
    for (let i = 0; i < m.r * 1.5; i++) {
      const a = rnd() * 6.283, d = m.r * (0.8 + rnd() * 0.5);
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      if (borderDist(x, z) > -1 || !F.free(x, z, 0.35, 0.4, 0.4) || !clear(x, z, 0.6)) continue;
      youngClump(plantB, x, F.h(x, z), z, 0.8 + rnd() * 0.3, rnd); taken.push([x, z, 0.4]); st.youngClumps++;
    }
  }
  // young green clumps along the banks
  for (let i = 0; i < 40; i++) {
    const p = bankPoint(S_POND - 42 + rnd() * 95, rnd() < 0.5 ? 1 : -1, 0.5 + rnd() * 2.0);
    if (borderDist(p.x, p.z) > -1 || !F.free(p.x, p.z, 0.3, 0.3, 0.5) || !clear(p.x, p.z, 1.0)) continue;
    youngClump(plantB, p.x, F.h(p.x, p.z), p.z, 0.75 + rnd() * 0.35, rnd); taken.push([p.x, p.z, 0.4]); st.youngClumps++;
  }

  // kakitsubata irises along the lily banks, right at the water's edge
  for (const lb of ANCHORS.zones.lilyBanks) {
    for (let s = lb.s0; s < lb.s1; s += 0.7 + rnd() * 0.6) {
      for (const side of [1, -1]) {
        if (rnd() < 0.2) continue;
        const p = bankPoint(s, side, 0.15 + rnd() * 0.9);
        if (!F.free(p.x, p.z, 0.1, 0.05, 0.2) || !clear(p.x, p.z, 0.25)) continue;
        iris(plantB, p.x, F.h(p.x, p.z), p.z, 0.95 + rnd() * 0.25, rnd); taken.push([p.x, p.z, 0.25]); st.irises++;
      }
    }
  }

  // wildflower drifts over the whole glade (violets, dandelions, white daisies), patchy by noise
  for (let i = 0; i < 9000 && st.wildflowers < 2600; i++) {
    const x = (rnd() * 2 - 1) * (BORDER + 4), z = (rnd() * 2 - 1) * (BORDER + 4);
    const bd = borderDist(x, z);
    if (bd > 3 || fbm2(x * 0.08 + 5, z * 0.08 - 9, 3) < 0.05 + 0.1 * rnd()) continue;
    if (!F.free(x, z, 0.05, 0.3, 0.15)) continue;
    const col = jit(pickW(S.wild, rnd), rnd, 0.05);
    const sz = 0.17 + rnd() * 0.12;
    crossCard(L, x, F.h(x, z) - 0.02, z, sz, sz * (0.85 + rnd() * 0.4), TILE.flowers, col, 0.25, rnd() * 6.28, 0.9, rnd);
    st.wildflowers++;
  }

  // ferns (fresh fronds) by rocks, along the banks and in the cedar grove
  const fernAt = (x, z, s) => { if (!F.free(x, z, 0.3, 0.15, 0.35) || !clear(x, z, 0.5)) return; fern(L, x, F.h(x, z), z, s, rnd); taken.push([x, z, 0.4]); st.ferns++; };
  for (const r of ANCHORS.rocks) for (let k = 0; k < 2; k++) { const a = rnd() * 6.28, d = r.s * 1.15 + 0.4 + rnd() * 0.5; fernAt(r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, 0.6 + rnd() * 0.35); }
  for (let i = 0; i < 50; i++) { const p = bankPoint(S_POND - 45 + rnd() * 100, rnd() < 0.5 ? 1 : -1, 0.3 + rnd() * 1.2); if (borderDist(p.x, p.z) < 0) fernAt(p.x, p.z, 0.55 + rnd() * 0.35); }
  const g = ANCHORS.zones.cedarGrove;
  for (let i = 0; i < 55; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * g.r; fernAt(g.x + Math.cos(a) * d, g.z + Math.sin(a) * d * 0.8, 0.8 + rnd() * 0.5); }

  // tsutsuji azaleas in bloom: leafy mound covered in magenta / pink / white blossoms
  const azaleaAt = (x, z, sc) => {
    if (!F.free(x, z, 0.45, 0.4, 0.3) || !clear(x, z, 0.5 * sc)) return;
    const y = F.h(x, z), base = v3(x, y, z), phase = rnd() * 6.28;
    const r = (0.55 + rnd() * 0.3) * sc;
    const cc = v3(x, y + r * 0.55, z);
    const bloom = PALETTES.azalea[(rnd() * PALETTES.azalea.length) | 0];
    const common = { crownC: cc, crownR: v3(r, r * 0.72, r), crownBlend: 0.75, windW: (p) => 0.03 * Math.max(0, p.y - y), base, phase, ry: 0.72 };
    emitClump(L, cc, { ...common, tiles: [TILE.shrub], size: 0.4 * sc, count: Math.round(24 * sc), radius: r * 0.92, core: 0.6, coreDetail: 0,
      colorFn: (p, o, q) => jit(S.shrubLeaf[(q() * 3) | 0], q, 0.08), transl: 0.6, flutter: 0.3, aoMin: 0.35 }, rnd);
    emitClump(L, cc, { ...common, tiles: TILE.sakura, size: 0.36 * sc, count: Math.round(30 * sc), radius: r * 1.04,
      colorFn: (p, o, q) => jit(bloom, q, 0.07), transl: 1.0, flutter: 0.4, aoMin: 0.5 }, rnd);
    taken.push([x, z, r]); st.azaleas++;
  };
  const tea = ANCHORS.teahouse, fpTea = FOOTPRINTS[0];
  for (let i = 0; i < 34; i++) {
    const a = rnd() * 6.283;
    const lx = Math.cos(a) * (fpTea.hx + 0.6 + rnd() * 1.2), lz = Math.sin(a) * (fpTea.hz + 0.6 + rnd() * 1.2);
    azaleaAt(tea.x + lx * Math.cos(tea.rot) + lz * Math.sin(tea.rot), tea.z - lx * Math.sin(tea.rot) + lz * Math.cos(tea.rot), 0.9 + rnd() * 0.4);
  }
  for (const p of ANCHORS.paths) {
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1], [bx, bz] = p.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = rnd() * 4; d < len; d += 3 + rnd() * 4) {
        const t = d / len, nx = -(bz - az) / len, nz = (bx - ax) / len, sd = rnd() < 0.5 ? 1 : -1;
        const off = p.w / 2 + 0.9 + rnd() * 0.8;
        if (rnd() < 0.85) azaleaAt(ax + (bx - ax) * t + nx * off * sd, az + (bz - az) * t + nz * off * sd, 0.75 + rnd() * 0.4);
      }
    }
  }
  for (const l of ANCHORS.lanterns) for (let k = 0; k < 3; k++) azaleaAt(l.x + (rnd() - 0.5) * 3, l.z + (rnd() - 0.5) * 3, 0.8);
  // a few groups on the banks near the pond
  for (let i = 0; i < 24; i++) { const p = bankPoint(S_POND - 16 + rnd() * 36, rnd() < 0.5 ? 1 : -1, 1.0 + rnd() * 2.5); azaleaAt(p.x, p.z, 0.7 + rnd() * 0.4); }

  // moss cushions at rock feet (fresh green)
  for (const r of ANCHORS.rocks) {
    const k = 1 + ((rnd() * 2) | 0);
    for (let i = 0; i < k; i++) {
      const a = rnd() * 6.28, d = r.s * 1.05 + rnd() * 0.25;
      const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      if (F.edge(x, z) < 0.05) continue;
      const y = F.h(x, z), base = v3(x, y, z), rr = 0.3 + rnd() * 0.25, cc = v3(x, y + rr * 0.1, z);
      emitClump(L, cc, {
        tiles: [TILE.shrub], size: 0.3, count: 14, radius: rr, ry: 0.3, flatten: 0.7,
        colorFn: (p, o, q) => jit(mixc(C.moss[(q() * 3) | 0], S.youngMid, 0.3), q, 0.1), crownC: cc, crownR: v3(rr, rr * 0.4, rr), crownBlend: 0.6,
        windW: () => 0, base, phase: 0, transl: 0.5, flutter: 0, aoMin: 0.5,
      }, rnd);
      st.moss++;
    }
  }

  // fallen sakura petals: thick under each sakura (drifted downwind), drifts along the paths, a light scatter
  const puv = tileUV(TILE.petal);
  const petal = (x, z, sz) => {
    if (F.edge(x, z) < 0.1 || F.blocked(x, z)) return;
    const y = F.h(x, z) + 0.02 + rnd() * 0.012;
    const n = v3((rnd() - 0.5) * 0.6, 1, (rnd() - 0.5) * 0.6).normalize();
    const a = rnd() * 6.283;
    const t1 = v3(Math.cos(a), 0, Math.sin(a)); t1.addScaledVector(n, -t1.dot(n)).normalize();
    const t2 = v3().crossVectors(n, t1);
    const c = jit(S.petal[(rnd() * S.petal.length) | 0], rnd, 0.04);
    const s = sz * (0.7 + rnd() * 0.6);
    const ids = [];
    for (const [cs, ct] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const p = v3(x, y + cs * cs * 0.2 * s, z).addScaledVector(t1, cs * s * 0.75).addScaledVector(t2, ct * s);
      const [u, v] = puv(cs + 0.5, ct + 0.5);
      ids.push(FL.v([p.x, p.y, p.z], [n.x, n.y, n.z], u, v, c, [x, z, 0, 0], [0, 0, 0.8, 0]));
    }
    FL.quad(ids[0], ids[1], ids[2], ids[3]);
    st.petals++;
  };
  for (const t of placedTrees) {
    if (t.type !== 'sakura') continue;
    const inside = borderDist(t.x, t.z) < 0;
    const n = Math.round((inside ? 1700 : 700) * t.s * t.s);
    const cx = t.crown ? t.crown.x : t.x, cz = t.crown ? t.crown.z : t.z;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.8) * (t.r + 1.8);
      petal(cx + Math.cos(a) * d + U_WX * d * 0.35, cz + Math.sin(a) * d + U_WZ * d * 0.35, 0.065);
    }
  }
  for (const p of ANCHORS.paths) {
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1], [bx, bz] = p.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let k = 0; k < len * 30; k++) {
        const t = rnd(), sd = rnd() < 0.5 ? 1 : -1;
        const off = (p.w / 2) * (0.5 + Math.pow(rnd(), 0.4) * 0.8) * sd;   // drifts collect at the path edges
        petal(ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off, 0.06);
      }
    }
  }
  for (let i = 0; i < 2500; i++) {
    const x = (rnd() * 2 - 1) * BORDER, z = (rnd() * 2 - 1) * BORDER;
    if (borderDist(x, z) < 0) petal(x, z, 0.06);
  }

  // meshes
  const out = [];
  const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  foliagePatch(plantMat, { wrap: 0.6, transl: 1, a2c: false, key: 'P' });
  const mk = (b, mat, name, cast, depth) => {
    if (!b.count) return;
    const m = new THREE.Mesh(b.build(), mat); m.name = name;
    m.castShadow = cast; m.receiveShadow = true; if (depth) m.customDepthMaterial = depth;
    group.add(m); out.push(m);
  };
  mk(plantB, plantMat, 'plants', true, swayDepthMaterial(null, 0));
  mk(L, leafMat, 'understory', true, swayDepthMaterial(atlas, 0.42));
  mk(FL, leafMat, 'fallenLeaves', false, null);
  st.verts = out.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
  return { meshes: out, stats: st };
}
