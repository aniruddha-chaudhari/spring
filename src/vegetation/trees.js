// vegetation/trees.js — procedural trees: branching skeleton -> bark tubes, leaf-cluster cards with crown-spherical normals.
// Species: maple (iroha-momiji), pine (Japanese black pine with cloud pads), cedar (sugi), ginkgo.
// Everything is emitted in world space into shared GeoBuilders so all hero trees cost 3 bark draws + 1 leaf draw.
import * as THREE from 'three';
import { mulberry32, smoothstep, clamp } from '../world.js';
import { GeoBuilder, lin, mixc, mulc, v3, basis } from './shared.js';
import { TILE, tileUV, SOLID_UV } from './atlas.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _ico = [];
function ico(detail = 1) {
  if (_ico[detail]) return _ico[detail];
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  return (_ico[detail] = { p: g.attributes.position.array, i: g.index.array });
}

const UP = v3(0, 1, 0);
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------- skeleton
// branch(): grows a polyline from p0 along dir with tropism, returns { pts, rad, level }.
function growLine(p0, dir, len, r0, r1, segs, trop, gnarl, rnd) {
  const pts = [p0.clone()], rad = [r0];
  const p = p0.clone(), d = dir.clone().normalize();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    d.x += (rnd() - 0.5) * gnarl; d.y += (rnd() - 0.5) * gnarl * 0.6; d.z += (rnd() - 0.5) * gnarl;
    d.addScaledVector(trop, 1 / segs * 3).normalize();
    p.addScaledVector(d, len / segs);
    pts.push(p.clone()); rad.push(r0 + (r1 - r0) * t);
  }
  return { pts, rad };
}
function dirAt(b, i) {
  const a = b.pts[Math.max(0, i - 1)], c = b.pts[Math.min(b.pts.length - 1, i + 1)];
  return c.clone().sub(a).normalize();
}
// child direction: tilt `angle` away from parent dir d at azimuth phi
function childDir(d, angle, phi) {
  const [a, b] = basis(d);
  const side = a.multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi));
  return d.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).normalize();
}

// Generic recursive tree. spec arrays are indexed by level (0 = trunk).
function growGeneric(spec, base, lean, rnd, scale) {
  const branches = [], ends = [];
  const leanV = v3(lean.x, 0, lean.z);
  function rec(p0, dir, len, r0, level) {
    const segs = Math.max(2, Math.round(len / spec.segLen[level]));
    const tr = v3(0, spec.up[level], 0).addScaledVector(leanV, spec.lean[level]);
    const rEnd = r0 * spec.taper[level];
    const b = growLine(p0, dir, len, r0, rEnd, segs, tr, spec.gnarl[level], rnd);
    b.level = level; branches.push(b);
    if (level >= spec.levels) { ends.push({ p: b.pts[b.pts.length - 1], d: dirAt(b, b.pts.length - 1), level, b }); return; }
    const nk = spec.kids[level];
    let phi = rnd() * 6.28;
    for (let k = 0; k < nk; k++) {
      const t = spec.kidStart[level] + (1 - spec.kidStart[level]) * ((k + 0.3 + rnd() * 0.5) / nk);
      const i = Math.min(b.pts.length - 1, Math.max(1, Math.round(t * segs)));
      phi += 2.39996 + (rnd() - 0.5) * 0.6;
      let cd = childDir(dirAt(b, i), spec.angle[level] * (0.8 + rnd() * 0.4), phi);
      if (spec.kidLean) cd.addScaledVector(leanV, spec.kidLean).normalize();
      const cl = len * spec.ratio[level] * (1 - spec.lenFall[level] * t) * (0.8 + rnd() * 0.4);
      const cr = b.rad[i] * spec.radRatio[level];
      if (cr < 0.006) continue;
      rec(b.pts[i].clone().addScaledVector(cd, -cr * 0.5), cd, cl, cr, level + 1);
    }
    if (spec.endClump?.[level]) ends.push({ p: b.pts[b.pts.length - 1], d: dirAt(b, b.pts.length - 1), level, b });
  }
  const tdir = v3(0, 1, 0).addScaledVector(leanV, spec.trunkLean).normalize();
  rec(v3(base.x, base.y - 0.35, base.z), tdir, spec.len[0] * scale, spec.r0 * scale, 0);
  return { branches, ends };
}

const SPECS = {
  maple: {
    levels: 3, r0: 0.27, len: [2.6], trunkLean: 0.25,
    segLen: [0.45, 0.45, 0.35, 0.3], taper: [0.6, 0.45, 0.45, 0.4],
    up: [0.02, 0.035, 0.015, -0.01], lean: [0.08, 0.05, 0.02, 0.0], gnarl: [0.1, 0.18, 0.22, 0.25],
    kids: [3, 4, 3], kidStart: [0.82, 0.3, 0.3], angle: [0.62, 0.8, 0.75], ratio: [1.25, 0.6, 0.6],
    lenFall: [0, 0.35, 0.3], radRatio: [0.72, 0.62, 0.62], kidLean: 0.25, endClump: { 2: true },
  },
  ginkgo: {
    levels: 3, r0: 0.28, len: [5.6], trunkLean: 0.04,
    segLen: [0.6, 0.5, 0.4, 0.3], taper: [0.35, 0.4, 0.45, 0.4],
    up: [0.03, 0.06, 0.03, 0.0], lean: [0, 0, 0, 0], gnarl: [0.04, 0.12, 0.18, 0.2],
    kids: [7, 3, 3], kidStart: [0.3, 0.35, 0.3], angle: [0.85, 0.6, 0.7], ratio: [0.55, 0.6, 0.55],
    lenFall: [0.65, 0.3, 0.3], radRatio: [0.55, 0.62, 0.62], endClump: { 1: true, 2: true },
  },
  // yoshino cherry: short gnarled trunk splitting low into long, spreading, knobbly limbs -> broad umbrella
  sakura: {
    levels: 3, r0: 0.34, len: [1.8], trunkLean: 0.2,
    segLen: [0.3, 0.4, 0.35, 0.3], taper: [0.72, 0.42, 0.45, 0.4],
    up: [0.012, 0.016, 0.01, -0.012], lean: [0.07, 0.035, 0.015, 0.0], gnarl: [0.2, 0.26, 0.28, 0.3],
    kids: [5, 4, 3], kidStart: [0.72, 0.25, 0.3], angle: [1.0, 0.78, 0.72], ratio: [2.15, 0.52, 0.56],
    lenFall: [0, 0.3, 0.3], radRatio: [0.6, 0.58, 0.6], kidLean: 0.18, endClump: { 2: true },
  },
};

// ---------------------------------------------------------------- bark tubes
function emitBark(B, branches, opts) {
  const { windW, base, phase, col = [1, 1, 1], flare = true, minR = 0.012, sides = [10, 7, 5, 4, 4], vScale = 1.6 } = opts;
  for (const br of branches) {
    if (br.rad[0] < minR) continue;
    const n = sides[Math.min(br.level, sides.length - 1)];
    const pts = br.pts, m = pts.length;
    // parallel-transport frames
    let T = pts[1].clone().sub(pts[0]).normalize();
    let [N] = basis(T);
    let arc = 0;
    const uRep = Math.max(1, Math.round((2 * Math.PI * br.rad[0]) / 0.9));
    const start = B.count;
    for (let i = 0; i < m; i++) {
      if (i > 0) arc += pts[i].distanceTo(pts[i - 1]);
      const Tn = dirAt(br, i);
      N.addScaledVector(Tn, -N.dot(Tn)).normalize(); T = Tn;
      const Bn = v3().crossVectors(T, N);
      let r = br.rad[i];
      if (flare && br.level === 0) { const yy = pts[i].y - (base.y - 0.35); r *= 1 + 0.9 * Math.exp(-yy * 3.2); }
      const ww = windW(pts[i]);
      for (let j = 0; j <= n; j++) {
        const a = (j / n) * Math.PI * 2;
        const nx = N.x * Math.cos(a) + Bn.x * Math.sin(a), ny = N.y * Math.cos(a) + Bn.y * Math.sin(a), nz = N.z * Math.cos(a) + Bn.z * Math.sin(a);
        const ao = br.level === 0 ? 0.75 + 0.25 * smoothstep(0, 1.2, pts[i].y - base.y) : 1;
        B.v([pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r], [nx, ny, nz], (j / n) * uRep, arc / vScale,
          mulc(col, ao), [base.x, base.z, ww, phase], null);
      }
    }
    for (let i = 0; i < m - 1; i++) for (let j = 0; j < n; j++) {
      const a = start + i * (n + 1) + j, b = a + n + 1;
      B.quad(a, a + 1, b + 1, b);
    }
  }
}

// ---------------------------------------------------------------- leaf cards
// Adds a clump of cards around centre c. opts: tiles, size, count, radius, colorFn(p)->rgb, crownC, crownR (vec3 radii),
// crownBlend, flatten (0..1, pine pads), windW, base, phase, transl, flutter, ry (vertical squash of clump)
const _t = v3(), _n = v3(), _a = v3(), _b = v3();
export function emitClump(L, c, opts, rnd) {
  const { tiles, size, count, radius, colorFn, crownC, crownR, crownBlend = 0.55, flatten = 0, windW, base, phase, transl = 1, flutter = 1, ry = 0.85, aoMin = 0.45, core = 0, coreDetail = 1, coreMul = 0.62 } = opts;
  if (core > 0) emitCore(L, coreDetail, c, radius * core, ry * (1 - flatten * 0.6), colorFn, crownC, crownR, crownBlend, windW, base, phase, transl, rnd, coreMul);
  const uvs = tiles.map(t => tileUV(t));
  for (let k = 0; k < count; k++) {
    // position: biased toward the clump surface
    let dx, dy, dz, l2;
    do { dx = rnd() * 2 - 1; dy = rnd() * 2 - 1; dz = rnd() * 2 - 1; l2 = dx * dx + dy * dy + dz * dz; } while (l2 > 1 || l2 < 0.01);
    const l = Math.sqrt(l2), rr = radius * (0.45 + 0.55 * Math.pow(l, 0.35));
    const out = v3(dx / l, dy / l, dz / l);
    const p = v3(c.x + out.x * rr, c.y + out.y * rr * ry * (1 - flatten * 0.6), c.z + out.z * rr);
    // card orientation
    const cn = out.clone().addScaledVector(v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), 1.4);
    if (flatten) cn.lerp(UP, flatten);
    cn.normalize();
    // card "up" = outward/upward drift (twig base at the inside)
    const upv = out.clone().addScaledVector(UP, 0.6).addScaledVector(v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), 0.8);
    upv.addScaledVector(cn, -upv.dot(cn));
    if (upv.lengthSq() < 1e-4) upv.copy(basis(cn)[0]);
    upv.normalize();
    const rt = v3().crossVectors(upv, cn).normalize();
    const s = size * (0.75 + rnd() * 0.5);
    const uv = uvs[(rnd() * uvs.length) | 0];
    const flip = rnd() < 0.5;
    // shading normal: blend of clump-spherical and crown-ellipsoidal
    const col0 = colorFn(p, out, rnd);
    const fph = rnd() * 60;
    const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    const idx = [];
    for (const [cs, ct] of corners) {
      const q = v3().copy(p).addScaledVector(rt, cs * s).addScaledVector(upv, (ct - 0.35) * s);
      _a.copy(q).sub(c).normalize();
      _b.set((q.x - crownC.x) / crownR.x, (q.y - crownC.y) / crownR.y, (q.z - crownC.z) / crownR.z);
      const depth = _b.length();
      _b.normalize();
      _n.copy(_a).lerp(_b, crownBlend);
      if (flatten) _n.lerp(UP, flatten * 0.5);
      _n.normalize();
      // fake AO: darker inside the crown and on the underside
      const ao = aoMin + (1 - aoMin) * clamp(smoothstep(0.25, 1.0, depth) * 0.75 + (0.5 + 0.5 * _n.y) * 0.35, 0, 1);
      const [u, v] = uv(flip ? 1 - (cs + 0.5) : cs + 0.5, ct);
      idx.push(L.v([q.x, q.y, q.z], [_n.x, _n.y, _n.z], u, v, mulc(col0, ao), [base.x, base.z, windW(p), phase], [flutter * (0.35 + ct * 0.65), fph, transl, smoothstep(0.45, 1.05, depth)]));
    }
    L.quad(idx[0], idx[1], idx[2], idx[3]);
  }
}

// Opaque lumpy core inside a clump so the crown reads as a full mass (cards fringe it).
function emitCore(L, detail, c, r, ry, colorFn, crownC, crownR, crownBlend, windW, base, phase, transl, rnd, coreMul = 0.62) {
  const { p, i } = ico(detail);
  const [u, v] = SOLID_UV();
  const col0 = mulc(colorFn(c, v3(0, 1, 0), rnd), coreMul);
  const b0 = L.count, seed = rnd() * 100;
  for (let k = 0; k < p.length; k += 3) {
    const ox = p[k], oy = p[k + 1], oz = p[k + 2];
    const kk = 1 + 0.18 * Math.sin(ox * 4.1 + seed) * Math.sin(oz * 3.7 + oy * 2.9 + seed);
    const q = v3(c.x + ox * r * kk, c.y + oy * r * kk * ry, c.z + oz * r * kk);
    _a.set(ox, oy, oz);
    _b.set((q.x - crownC.x) / crownR.x, (q.y - crownC.y) / crownR.y, (q.z - crownC.z) / crownR.z);
    const depth = _b.length(); _b.normalize();
    _n.copy(_a).lerp(_b, crownBlend).normalize();
    const ao = 0.4 + 0.6 * clamp(smoothstep(0.2, 1.0, depth) * 0.7 + (0.5 + 0.5 * _n.y) * 0.4, 0, 1);
    L.v([q.x, q.y, q.z], [_n.x, _n.y, _n.z], u, v, mulc(col0, ao), [base.x, base.z, windW(c), phase], [0, 0, transl * 0.5, 0]);
  }
  for (let k = 0; k < i.length; k += 3) L.tri(b0 + i[k], b0 + i[k + 1], b0 + i[k + 2]);
}

// ---------------------------------------------------------------- palettes
const P = {
  maple: ['#9e1018', '#b8161a', '#cf2a17', '#dc4416', '#e8661a', '#ef8a1e', '#f0aa2a', '#e6c03c'].map(lin),
  ginkgo: ['#f4c629', '#f0b81c', '#f7d54a', '#e9a915', '#d8c23a', '#fbe27a'].map(lin),
  pine: ['#2c4a26', '#3a5a2c', '#4a6b32', '#5d7d3a', '#71893e'].map(lin),
  cedar: ['#1f3a2c', '#264433', '#2d4d38', '#34553c', '#5d5532'].map(lin),
  shrubRed: ['#a81c18', '#c8301a', '#d94a1e', '#b8402a'].map(lin),
  orange: ['#c8401a', '#dc5a18', '#e8761c', '#ee9222', '#f0aa2a', '#e8b838', '#d89a2a', '#e6c03c'].map(lin),
  oak: ['#5e6e2a', '#7a8030', '#94903a', '#a89a3c', '#b8a040', '#c4a848', '#8c7a30', '#c8b050'].map(lin),
  // spring
  sakura: ['#fde6ee', '#fbd9e5', '#f8cbdb', '#f5bdd1', '#f1aec6', '#ee9fbb'].map(lin),
  sakuraBud: ['#e8a0b8', '#e290ac'].map(lin),
  springMaple: ['#b4d65a', '#a6cc4a', '#98c23e', '#8ab836', '#7eae30', '#c2dc68', '#9cc444', '#86b434'].map(lin),
  springGinkgo: ['#c6da5a', '#b8d04c', '#d2e070', '#aac843', '#bcd456', '#dce47e'].map(lin),
  springOak: ['#6e9a34', '#7ea83a', '#5e8c2e', '#8cb444', '#70a036', '#a0c050', '#64902f', '#94bc48'].map(lin),
  azalea: ['#d8287a', '#e0408c', '#c81e6a', '#f070a8', '#f6f0f4', '#e85a9a'].map(lin),
};
const pick = (arr, rnd) => arr[(rnd() * arr.length) | 0];
const jitter = (c, rnd, k = 0.12) => { const m = 1 - k + rnd() * k * 2; return [c[0] * m, c[1] * m * (1 - k * 0.3 + rnd() * k * 0.6), c[2] * m]; };

function windFor(base, H, R) {
  return (p) => {
    const y = Math.max(0, p.y - base.y), r = Math.hypot(p.x - base.x, p.z - base.z);
    return 0.016 * y * Math.min(1.2, y / H) + 0.065 * r * Math.min(1.5, r / R);
  };
}

function crownOf(points) {
  const c = v3(); for (const p of points) c.add(p); c.multiplyScalar(1 / Math.max(1, points.length));
  const r = v3(0.5, 0.5, 0.5);
  for (const p of points) { r.x = Math.max(r.x, Math.abs(p.x - c.x)); r.y = Math.max(r.y, Math.abs(p.y - c.y)); r.z = Math.max(r.z, Math.abs(p.z - c.z)); }
  r.addScalar(1.0);
  return { c, r };
}

// ---------------------------------------------------------------- species builders
// Each takes (barkB, leafB, {x, y, z, s, lean}, seed, lod) where lod 0 = hero, 1 = mid-distance (fewer, larger cards)
export function buildMaple(bark, leaves, t, seed, lod = 0) {
  const rnd = mulberry32(seed);
  const base = v3(t.x, t.y, t.z), s = t.s;
  const lean = t.lean || { x: 0, z: 0 };
  const { branches, ends } = growGeneric(SPECS.maple, base, lean, rnd, s);
  const clumpPts = ends.map(e => e.p);
  const { c: cc, r: cr } = crownOf(clumpPts);
  const H = cc.y + cr.y - base.y, R = Math.max(cr.x, cr.z);
  const windW = windFor(base, H, R), phase = rnd() * 6.28;
  emitBark(bark, branches, { windW, base, phase, col: [1, 0.92, 0.88], minR: lod ? 0.03 : 0.012, sides: lod ? [7, 5, 4, 3] : [10, 7, 5, 4] });
  // colour: crimson outside/top, orange-amber inside/below; whole-tree hue shift
  const shift = (rnd() - 0.5) * 2.2 + (t.hue || 0);
  const colorFn = (p, out, r) => {
    const outer = clamp(((p.y - cc.y) / cr.y) * 0.5 + 0.5, 0, 1) * 0.55 + clamp(Math.hypot(p.x - cc.x, p.z - cc.z) / R, 0, 1) * 0.45;
    let i = (1 - outer) * 5.2 + shift + (r() - 0.5) * 2.2;
    const pal = P[t.palette || 'maple'];
    i = clamp(Math.round(i), 0, pal.length - 1);
    return jitter(pal[i], r, 0.1);
  };
  for (const e of ends) {
    const big = e.level === 3;
    const rad = (big ? 1.05 : 0.85) * s * (0.85 + rnd() * 0.3);
    const cpos = e.p.clone().addScaledVector(e.d, rad * 0.35);
    emitClump(leaves, cpos, {
      tiles: TILE.maple, size: (lod ? 1.1 : 0.55) * s, count: Math.round((lod ? 6 : 62) * (big ? 1 : 0.75)), radius: rad * 1.15, aoMin: 0.32, core: lod ? 0.55 : 0.36, coreDetail: lod ? 0 : 1,
      colorFn, crownC: cc, crownR: cr, windW, base, phase, transl: 1.0, flutter: 1,
    }, rnd);
  }
  return { H, R, crown: cc, radius: R };
}

export function buildGinkgo(bark, leaves, t, seed, lod = 0) {
  const rnd = mulberry32(seed);
  const base = v3(t.x, t.y, t.z), s = t.s;
  const { branches, ends } = growGeneric(SPECS.ginkgo, base, { x: 0, z: 0 }, rnd, s);
  const { c: cc, r: cr } = crownOf(ends.map(e => e.p));
  const H = cc.y + cr.y - base.y, R = Math.max(cr.x, cr.z);
  const windW = windFor(base, H, R), phase = rnd() * 6.28;
  emitBark(bark, branches, { windW, base, phase, col: [0.85, 0.82, 0.78], minR: lod ? 0.03 : 0.012, sides: lod ? [7, 5, 4, 3] : [10, 7, 5, 4] });
  const colorFn = (p, out, r) => {
    const top = clamp(((p.y - cc.y) / cr.y) * 0.5 + 0.5, 0, 1);
    const pal = P[t.palette || 'ginkgo'];
    let c = pick(pal, r);
    if (top < 0.3 && r() < 0.35) c = pal[4];
    return jitter(c, r, 0.08);
  };
  for (const e of ends) {
    const rad = (e.level === 3 ? 0.85 : 1.0) * s * (0.85 + rnd() * 0.3);
    emitClump(leaves, e.p.clone().addScaledVector(e.d, rad * 0.3), {
      tiles: TILE.ginkgo, size: (lod ? 1.1 : 0.55) * s, count: lod ? 6 : (e.level === 3 ? 50 : 58), radius: rad * 1.15, aoMin: 0.36, core: lod ? 0.55 : 0.36, coreDetail: lod ? 0 : 1,
      colorFn, crownC: cc, crownR: cr, windW, base, phase, transl: 0.95, flutter: 1.1,
    }, rnd);
  }
  return { H, R, crown: cc, radius: R };
}

// Black pine: twisting trunk leaning toward the water, horizontal limbs ending in flat cloud pads.
export function buildPine(bark, leaves, t, seed, lod = 0) {
  const rnd = mulberry32(seed);
  const base = v3(t.x, t.y, t.z), s = t.s;
  const lean = t.lean && (t.lean.x || t.lean.z) ? v3(t.lean.x, 0, t.lean.z) : v3(Math.cos(seed), 0, Math.sin(seed)).multiplyScalar(0.4);
  const branches = [], pads = [];
  // trunk: S-curve, leaning out
  const H = 6.2 * s;
  const tpts = [], trad = [];
  const segs = 14;
  const side = v3(-lean.z, 0, lean.x);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const off = lean.clone().multiplyScalar((Math.sin(u * 1.9) * 1.0 + u * 1.6) * s * 1.4).addScaledVector(side, Math.sin(u * 4.1 + seed) * 0.35 * s);
    tpts.push(v3(base.x + off.x, base.y - 0.35 + u * H * (1 - 0.15 * u), base.z + off.z));
    trad.push(0.24 * s * (1 - 0.72 * u));
  }
  branches.push({ pts: tpts, rad: trad, level: 0 });
  const trunkTop = tpts[segs];
  const nLimbs = lod ? 6 : 9;
  let phi = rnd() * 6.28;
  for (let k = 0; k < nLimbs; k++) {
    const u = 0.38 + 0.6 * (k / (nLimbs - 1));
    const i = Math.round(u * segs);
    phi += 2.39996 + (rnd() - 0.5) * 0.5;
    let d = v3(Math.cos(phi), 0.15 + rnd() * 0.2, Math.sin(phi));
    d.addScaledVector(lean, 0.6).normalize();
    const len = (2.6 - 1.6 * u + rnd() * 0.8) * s;
    const b = growLine(tpts[i], d, len, trad[i] * 0.55, trad[i] * 0.2, 5, v3(0, -0.015, 0), 0.25, rnd);
    b.level = 1; branches.push(b);
    pads.push({ p: b.pts[b.pts.length - 1], r: (1.0 + rnd() * 0.5 + (1 - u) * 0.5) * s });
    if (rnd() < 0.6) pads.push({ p: b.pts[2].clone().add(v3(0, 0.25 * s, 0)), r: (0.7 + rnd() * 0.3) * s });
  }
  pads.push({ p: trunkTop.clone().add(v3(0, 0.2, 0)), r: 1.15 * s });
  const { c: cc, r: cr } = crownOf(pads.map(p => p.p));
  const R = Math.max(cr.x, cr.z);
  const windW = windFor(base, H, R), phase = rnd() * 6.28;
  emitBark(bark, branches, { windW, base, phase, col: [0.9, 0.86, 0.84], minR: 0.02, sides: lod ? [7, 5] : [10, 6], vScale: 1.2 });
  const colorFn = (p, out, r) => {
    const top = clamp(out.y * 0.5 + 0.5, 0, 1);
    return jitter(P.pine[clamp(Math.round(top * 3.2 + (r() - 0.5) * 1.5), 0, 4)], r, 0.1);
  };
  for (const pd of pads) {
    // a few sub-branchlets into the pad
    emitClump(leaves, pd.p, {
      tiles: TILE.pine, size: (lod ? 1.1 : 0.78) * s, count: Math.round((lod ? 8 : 26) * pd.r / s), radius: pd.r,
      colorFn, crownC: pd.p, crownR: v3(pd.r, pd.r * 0.45, pd.r), crownBlend: 0.6, flatten: 0.6, ry: 0.45, core: 0.7, coreDetail: lod ? 0 : 1,
      windW, base, phase, transl: 0.35, flutter: 0.4, aoMin: 0.4,
    }, rnd);
  }
  return { H, R, crown: cc, radius: R };
}

// Sugi: tall straight trunk, narrow conical tiers of dark blue-green spray clumps.
export function buildCedar(bark, leaves, t, seed, lod = 0) {
  const rnd = mulberry32(seed);
  const base = v3(t.x, t.y, t.z), s = t.s;
  const H = (14 + rnd() * 5) * s;
  const tl = growLine(v3(base.x, base.y - 0.4, base.z), v3((rnd() - 0.5) * 0.04, 1, (rnd() - 0.5) * 0.04), H, 0.34 * s, 0.03, lod ? 6 : 12, v3(0, 0.0, 0), 0.015, rnd);
  tl.level = 0;
  const branches = [tl];
  const crownStart = 0.32 + rnd() * 0.1;
  const Rb = (2.0 + rnd() * 0.5) * s;
  const windW = windFor(base, H, Rb), phase = rnd() * 6.28;
  const clumps = [];
  const nTier = lod ? 10 : 13;
  let phi = rnd() * 6.28;
  for (let k = 0; k < nTier; k++) {
    const u = crownStart + (1 - crownStart) * (k / (nTier - 1));
    const coneR = Rb * Math.pow(1 - (u - crownStart) / (1 - crownStart), 0.85) + 0.35 * s;
    const y = base.y + u * H;
    const per = Math.max(2, Math.round(coneR * (lod ? 2.2 : 2.6)));
    for (let j = 0; j < per; j++) {
      phi += 2.39996;
      const r = coneR * (0.7 + rnd() * 0.3);
      const d = v3(Math.cos(phi), -0.1 + rnd() * 0.2, Math.sin(phi));
      const p0 = v3(base.x, y, base.z);
      if (!lod && coneR > 0.8) {
        const b = growLine(p0, v3(d.x, 0.25, d.z), r * 0.85, 0.05 * s, 0.015, 3, v3(0, -0.02, 0), 0.1, rnd); b.level = 1; branches.push(b);
      }
      clumps.push({ p: v3(base.x + d.x * r * 0.8, y - 0.15 + rnd() * 0.3, base.z + d.z * r * 0.8), r: (0.55 + rnd() * 0.3) * s * (0.6 + 0.4 * coneR / Rb) });
    }
  }
  clumps.push({ p: v3(base.x, base.y + H * 0.98, base.z), r: 0.45 * s });
  emitBark(bark, branches, { windW, base, phase, col: [0.95, 0.85, 0.8], minR: 0.02, sides: lod ? [6, 4] : [10, 4], vScale: 2.2, flare: true });
  const cc = v3(base.x, base.y + H * (crownStart + 1) / 2, base.z), cr = v3(Rb + 0.6, H * (1 - crownStart) / 2 + 0.6, Rb + 0.6);
  const bronze = rnd() < 0.15;
  const colorFn = (p, out, r) => {
    const top = clamp((p.y - base.y) / H, 0, 1);
    let i = clamp(Math.round(top * 2.5 + out.y + (r() - 0.5) * 1.2), 0, 3);
    let c = P.cedar[i];
    if (bronze && r() < 0.4) c = P.cedar[4];
    return jitter(c, r, 0.08);
  };
  for (const cl of clumps) {
    emitClump(leaves, cl.p, {
      tiles: TILE.cedar, size: (lod ? 1.15 : 0.85) * s, count: lod ? 6 : 9, radius: cl.r * (lod ? 1.2 : 1),
      colorFn, crownC: cc, crownR: cr, crownBlend: 0.7, windW, base, phase, transl: 0.3, flutter: 0.35, aoMin: 0.38, ry: 0.7, core: 0.6, coreDetail: lod ? 0 : 1,
    }, rnd);
  }
  return { H, R: Rb, crown: cc, radius: Rb };
}

// Yoshino sakura: dark gnarled trunk, broad umbrella of dense pale-pink blossom clumps. t.weeping adds hanging strands.
export function buildSakura(bark, leaves, t, seed, lod = 0) {
  const rnd = mulberry32(seed);
  const base = v3(t.x, t.y, t.z), s = t.s;
  const lean = t.lean || { x: 0, z: 0 };
  const { branches, ends } = growGeneric(SPECS.sakura, base, lean, rnd, s);
  const { c: cc, r: cr } = crownOf(ends.map(e => e.p));
  const H = cc.y + cr.y - base.y, R = Math.max(cr.x, cr.z);
  const windW = windFor(base, H, R), phase = rnd() * 6.28;
  emitBark(bark, branches, { windW, base, phase, col: [0.42, 0.36, 0.36], minR: lod ? 0.03 : 0.012, sides: lod ? [7, 5, 4, 3] : [10, 7, 5, 4] });
  const pal = P[t.palette || 'sakura'];
  const colorFn = (p, out, r) => {
    if (r() < 0.05) return jitter(pick(P.sakuraBud, r), r, 0.06);
    const outer = clamp(((p.y - cc.y) / cr.y) * 0.5 + 0.5, 0, 1) * 0.6 + clamp(Math.hypot(p.x - cc.x, p.z - cc.z) / R, 0, 1) * 0.4;
    const i = clamp(Math.round((1 - outer) * 5 + (r() - 0.5) * 2), 0, pal.length - 1);
    return jitter(pal[i], r, 0.04);
  };
  const weep = !!t.weeping && !lod;
  for (const e of ends) {
    const big = e.level === 3;
    const rad = (big ? 1.1 : 0.9) * s * (0.85 + rnd() * 0.3);
    emitClump(leaves, e.p.clone().addScaledVector(e.d, rad * 0.25), {
      tiles: TILE.sakura || TILE.maple, size: (lod ? 1.05 : 0.5) * s, count: Math.round((lod ? 7 : 58) * (big ? 1 : 0.75) * (weep ? 0.7 : 1)),
      radius: rad * 1.12, ry: 0.68, aoMin: 0.55, core: lod ? 0.55 : 0.3, coreDetail: lod ? 0 : 1, coreMul: 0.72,
      colorFn, crownC: cc, crownR: cr, crownBlend: 0.6, windW, base, phase, transl: 1.0, flutter: 0.8,
    }, rnd);
    // shidarezakura: blossom strands hanging from the outer branch ends
    if (weep && big && rnd() < 0.8) {
      const out = v3(e.p.x - base.x, 0, e.p.z - base.z).normalize();
      const len = (1.2 + rnd() * 1.8) * s;
      const uvs = (TILE.sakura || TILE.maple).map(k => tileUV(k));
      const n = Math.round(len / 0.15);
      for (let k = 0; k < n; k++) {
        const u = k / n;
        const p = e.p.clone().add(v3(out.x * 0.35 * u * len, -u * len, out.z * 0.35 * u * len));
        const a = rnd() * 6.283, cn = v3(Math.cos(a), 0.2, Math.sin(a)).normalize();
        const upv = v3(0, -1, 0).addScaledVector(cn, -(-cn.y)).normalize();
        const rt = v3().crossVectors(upv, cn).normalize();
        const sz = 0.34 * s * (1 - u * 0.35) * (0.8 + rnd() * 0.4);
        const uv = uvs[(rnd() * uvs.length) | 0];
        const col = mulc(colorFn(p, out, rnd), 0.8 + 0.2 * (1 - u));
        const ww = windW(e.p) + 0.16 * u * len;
        const nrm = v3(out.x, 0.3, out.z).normalize();
        const ids = [];
        for (const [cs, ct] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
          const q = p.clone().addScaledVector(rt, cs * sz).addScaledVector(upv, (ct - 0.5) * sz);
          const [uu, vv] = uv(cs + 0.5, 1 - ct);
          ids.push(leaves.v([q.x, q.y, q.z], [nrm.x, nrm.y, nrm.z], uu, vv, col, [base.x, base.z, ww, phase], [0.8, rnd() * 60, 1.0, 1]));
        }
        leaves.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
  }
  return { H, R, crown: cc, radius: R };
}

export const BUILDERS = { maple: buildMaple, ginkgo: buildGinkgo, pine: buildPine, cedar: buildCedar, sakura: buildSakura };
export { P as PALETTES };
