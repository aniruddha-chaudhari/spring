// builders.js — procedural Japanese architecture for Hakoniwa.
// Every builder returns the OUTER group from pivotGroup(); parts are added to a Kit in the outer
// group's LOCAL x/z frame with ABSOLUTE world y, then merged into outer.userData.inner.
import * as THREE from 'three';
import {
  WATER, heightAt, M, Kit, pivotGroup, roofGeo, curvedBeam, resample, toWorld,
  mulberry32, clamp, lerp,
} from './core.js';

const PI = Math.PI;

// ---------------------------------------------------------------- local materials
const MOSS = new THREE.MeshStandardMaterial({ color: '#6f8f47', roughness: 0.9, flatShading: true });
const LANTERN_STONE = new THREE.MeshStandardMaterial({ color: '#b3ada1', roughness: 0.92, flatShading: true });
MOSS.shadowSide = LANTERN_STONE.shadowSide = THREE.FrontSide;

// ---------------------------------------------------------------- helpers
const seedOf = (id, salt) => ((id | 0) * 9973 + salt) | 0;
const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

// Box stretched between two points a=[x,y,z] and b (long axis = local x, w across, h vertical).
function seg3(kit, mat, a, b, w, h, ext = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dz), len = Math.hypot(L, dy) + ext;
  if (len < 1e-4) return;
  kit.box(mat, len, h, w, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.atan2(-dz, dx), 0, Math.atan2(dy, L));
}

// The four faces of a rectangular body with half extents (hx, hz). f(u, n) maps (along-face, outward) -> local [x, z].
function faces(hx, hz) {
  return [
    { L: 2 * hx, ry: 0, front: true, f: (u, n) => [u, hz + n] },
    { L: 2 * hz, ry: PI / 2, f: (u, n) => [hx + n, -u] },
    { L: 2 * hx, ry: 0, f: (u, n) => [-u, -hz - n] },
    { L: 2 * hz, ry: PI / 2, f: (u, n) => [-hx - n, u] },
  ];
}
// box on a face: sw along the face, sh tall, st thick (outward)
function fbox(kit, F, mat, sw, sh, st, u, y, n) {
  const [x, z] = F.f(u, n);
  kit.box(mat, sw, sh, st, x, y, z, F.ry);
}

// Hip ridges along the 4 roof corners, following roofGeo's surface (f = 0 edge, incl. corner upturn).
function roofHips(kit, mat, hw, hd, H, curve, up, eaveY, tEnd, size) {
  const e = Math.min(hw, hd), n = 6;
  for (const [sx, sz] of CORNERS) {
    const pts = [];
    for (let j = 0; j <= n; j++) {
      const t = tEnd * j / n;
      pts.push([sx * (hw - t * e), eaveY + H * Math.pow(t, curve) + up * (1 - t) * (1 - t) + size * 0.45, sz * (hd - t * e)]);
    }
    for (let j = 0; j < n; j++) seg3(kit, mat, pts[j], pts[j + 1], size, size, size * 0.9);
    // little upturned tile end at the corner tip
    kit.box(mat, size * 1.5, size * 1.7, size * 1.5, pts[0][0], pts[0][1] + size * 0.25, pts[0][2], Math.atan2(-sz, sx));
  }
}

function footprintHeights(cx, cz, rot, w, d) {
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const [x, z] = toWorld(cx, cz, rot, (i / 4 - 0.5) * w, (j / 4 - 0.5) * d);
    const hh = heightAt(x, z);
    if (hh < minH) minH = hh;
    if (hh > maxH) maxH = hh;
  }
  return [minH, maxH];
}

// ================================================================ HOUSE
// One storey of wall: plaster core (yCore..coreTop), posts / beams / bay infill between y0 and y1.
function houseStorey(kit, rng, ww, wd, yCore, coreTop, y0, y1, o) {
  kit.box(M.plaster, 2 * ww - 0.04, coreTop - yCore, 2 * wd - 0.04, 0, (coreTop + yCore) / 2, 0);
  let door = null;
  const H = y1 - y0, yb = y0 + 0.1, yt = y1 - 0.12, bh = yt - yb;
  for (const F of faces(ww, wd)) {
    const nb = Math.max(1, Math.round(F.L / 1.1)), bw = F.L / nb, iw = bw - 0.14;
    const doorBay = o.door && F.front ? Math.floor(nb / 2) : -1;
    for (let i = 0; i <= nb; i++) fbox(kit, F, M.darkWood, 0.14, H, 0.14, -F.L / 2 + i * bw, y0 + H / 2, 0);
    fbox(kit, F, M.darkWood, F.L + 0.22, 0.1, 0.12, 0, y0 + 0.05, 0.02);   // sill
    fbox(kit, F, M.darkWood, F.L + 0.22, 0.12, 0.12, 0, y1 - 0.06, 0.02);  // head beam
    for (let i = 0; i < nb; i++) {
      const u = -F.L / 2 + (i + 0.5) * bw;
      if (i === doorBay) {
        fbox(kit, F, M.black, iw + 0.02, bh, 0.02, u, yb + bh / 2, 0);             // dark interior
        const nh = Math.min(0.55, bh * 0.42), pw = iw / 2 - 0.03;
        for (const s of [-1, 1]) fbox(kit, F, M.noren, pw, nh, 0.015, u + s * (pw / 2 + 0.015), yt - 0.03 - nh / 2, 0.07);
        fbox(kit, F, M.wood, iw + 0.08, 0.035, 0.035, u, yt - 0.02, 0.08);         // noren rod
        door = { u, iw };
        continue;
      }
      const r = rng();
      if (r < o.pShoji) {
        const k = o.kick, sh = bh - k;
        fbox(kit, F, M.wood, iw + 0.02, k, 0.04, u, yb + k / 2, 0.01);
        fbox(kit, F, M.shoji, iw + 0.02, sh, 0.03, u, yb + k + sh / 2, 0.01);
        fbox(kit, F, M.darkWood, iw, 0.04, 0.05, u, yb + k, 0.02);
        fbox(kit, F, M.darkWood, 0.035, sh, 0.05, u, yb + k + sh / 2, 0.02);
      } else if (r < o.pShoji + o.pPlaster) {
        if (rng() < 0.5 && bh > 0.8) {
          // koshi lattice window
          const wy = yb + bh * 0.62, wh = Math.min(0.45, bh * 0.36), wl = iw * 0.62;
          fbox(kit, F, M.black, wl, wh, 0.02, u, wy, 0);
          for (let s = 0; s < 5; s++) fbox(kit, F, M.wood, 0.035, wh, 0.04, u + (s / 4 - 0.5) * wl * 0.84, wy, 0.02);
          for (const s of [-1, 1]) fbox(kit, F, M.darkWood, wl + 0.06, 0.05, 0.05, u, wy + s * wh / 2, 0.025);
        } else {
          fbox(kit, F, M.darkWood, iw, 0.07, 0.05, u, yb + bh * 0.62, 0.01);        // nuki band
        }
        if (rng() < 0.5) fbox(kit, F, M.wood, iw, Math.min(0.38, bh * 0.3), 0.03, u, yb + Math.min(0.38, bh * 0.3) / 2, 0.01);
      } else {
        fbox(kit, F, M.wood, iw + 0.02, bh, 0.03, u, yb + bh / 2, 0.01);           // vertical boards
        for (const s of [-1, 1]) fbox(kit, F, M.darkWood, 0.04, bh, 0.05, u + s * iw / 4, yb + bh / 2, 0.02);
      }
    }
  }
  return door;
}

// Main hip roof over a storey of half extents (ww, wd) whose wall top is `top`.
function houseRoofParams(ww, wd, top, tile) {
  const ov = tile ? 0.75 : 0.65;
  const hw = ww + ov, hd = wd + ov, e = Math.min(hw, hd);
  const H = tile ? e * 0.62 : e * 1.15, curve = tile ? 1.45 : 0.85, up = tile ? 0.28 : 0.05;
  const yW = H * Math.pow(ov / e, curve);                 // roof height above eave at the wall line
  const drop = Math.min(yW * 0.7, tile ? 0.22 : 0.3);   // eave sits a little below the wall top
  const eave = top - drop;
  return { ov, hw, hd, e, H, curve, up, eave, fTop: eave + yW - 0.01, tMax: 1 };
}
const roofUnderY = (rf, n) => rf.eave + rf.H * Math.pow(clamp((rf.ov - n) / rf.e, 0, 1), rf.curve);

export function buildHouse(h) {
  const rng = mulberry32(seedOf(h.id, 101));
  const rot = h.rot || 0, w = h.w ?? 4, d = h.d ?? 3.5;
  const tile = h.style !== 'thatch';
  const [minH, maxH] = footprintHeights(h.x, h.z, rot, w, d);
  const gy = heightAt(h.x, h.z);
  const outer = pivotGroup('houses', h.id, h.x, gy, h.z, rot);
  const kit = new Kit();

  // foundation + engawa deck
  const base = Math.max(maxH, WATER + 0.1) + 0.28, fb = minH - 0.4;
  kit.box(M.stone, w - 0.2, base - fb, d - 0.2, 0, (base + fb) / 2, 0);
  kit.box(M.stoneLight, w - 0.14, 0.07, d - 0.14, 0, base - 0.035, 0);
  const deckTop = base + 0.1;
  kit.box(M.deck, w - 0.06, 0.1, d - 0.06, 0, base + 0.05, 0);

  const ww = w / 2 - 0.25, wd = d / 2 - 0.25;
  const SH = 1.55, two = tile && Math.min(w, d) >= 4.6;
  const opts1 = tile ? { door: true, kick: 0.4, pShoji: 0.45, pPlaster: 0.35 } : { door: true, kick: 0.4, pShoji: 0.35, pPlaster: 0.25 };
  const top1 = deckTop + SH;
  let door, frontRoof, mainRf, mww = ww, mwd = wd;

  if (two) {
    // lower storey + pent skirt roof whose inner edge tucks into the inset upper storey
    const ov = 0.6, hw = ww + ov, hd = wd + ov, e = Math.min(hw, hd);
    const tMax = (ov + 0.4) / e, curve = 1.3, up = 0.16, rise = 0.5;
    const H = rise / Math.pow(tMax, curve);
    const yW = H * Math.pow(ov / e, curve), drop = Math.min(yW * 0.7, 0.18), eave = top1 - drop;
    const fTop1 = eave + yW - 0.01;
    door = houseStorey(kit, rng, ww, wd, deckTop, Math.max(top1, fTop1), deckTop, top1, opts1);
    kit.add(M.tile, roofGeo(2 * hw, 2 * hd, H, { curve, up, tMax }), 0, eave, 0);
    roofHips(kit, M.ridge, hw, hd, H, curve, up, eave, tMax, 0.1);
    frontRoof = { ov, e, H, curve, eave };
    const skirtTop = eave + rise;
    mww = ww - 0.35; mwd = wd - 0.35;
    const top2 = skirtTop + 1.25;
    mainRf = houseRoofParams(mww, mwd, top2, true);
    houseStorey(kit, rng, mww, mwd, fTop1 - 0.05, Math.max(top2, mainRf.fTop), skirtTop - 0.1, top2,
      { door: false, kick: 0.22, pShoji: 0.4, pPlaster: 0.5 });
  } else {
    mainRf = houseRoofParams(ww, wd, top1, tile);
    const coreTop = tile ? Math.max(top1, mainRf.fTop) : top1;
    door = houseStorey(kit, rng, ww, wd, deckTop, coreTop, deckTop, top1, opts1);
    if (!tile && mainRf.fTop > top1 + 0.01) kit.box(M.wood, 2 * ww, mainRf.fTop - top1, 2 * wd, 0, (mainRf.fTop + top1) / 2, 0); // gable boards under thatch
    frontRoof = mainRf;
  }

  // main roof
  const R = mainRf;
  const geo = roofGeo(2 * R.hw, 2 * R.hd, R.H, { curve: R.curve, up: R.up, thick: tile ? 0.12 : 0.3 });
  const ud = geo.userData;
  kit.add(tile ? M.tile : M.thatch, geo, 0, R.eave, 0);
  const rl = ud.ridgeLen, along = ud.ridgeAlongX, rry = along ? 0 : PI / 2, yR = R.eave + R.H;
  const onRidge = a => (along ? [a, 0] : [0, a]);
  if (tile) {
    roofHips(kit, M.ridge, R.hw, R.hd, R.H, R.curve, R.up, R.eave, 1, 0.12);
    kit.box(M.ridge, rl + 0.2, 0.09, 0.34, 0, yR + 0.01, 0, rry);
    kit.box(M.ridge, rl + 0.35, 0.18, 0.22, 0, yR + 0.08, 0, rry);
    for (const s of [-1, 1]) { const [x, z] = onRidge(s * (rl / 2 + 0.17)); kit.box(M.ridge, 0.14, 0.4, 0.36, x, yR + 0.16, z, rry); }
  } else {
    kit.box(M.darkWood, rl + 0.5, 0.26, 0.42, 0, yR + 0.04, 0, rry);
    const n = Math.max(2, Math.round((rl + 0.5) / 0.45));
    for (let k = 0; k < n; k++) {
      const [x, z] = onRidge(((k + 0.5) / n - 0.5) * (rl + 0.3));
      for (const s of [-1, 1]) kit.box(M.darkWood, 0.05, 0.7, 0.05, x, yR + 0.22, z, rry, s * 0.6);
    }
  }

  // door: stone step + hanging chochin lantern
  if (door) {
    const sz = d / 2 + 0.22;
    const [sx, szw] = toWorld(h.x, h.z, rot, door.u, sz);
    const gs = heightAt(sx, szw);
    const stTop = Math.min(base - 0.02, Math.max(gs + 0.06, base - 0.16));
    if (stTop > gs - 0.15) kit.box(M.stoneLight, Math.min(0.9, door.iw + 0.1), stTop - (gs - 0.25), 0.42, door.u, (stTop + gs - 0.25) / 2, sz);

    const n = 0.32, lx = Math.min(door.u + door.iw / 2 + 0.12, ww - 0.12), lz = wd + n;
    const yRoof = roofUnderY(frontRoof, n);
    const ly = Math.min(yRoof - 0.42, top1 - 0.5);
    kit.sphere(M.chochin, 0.12, lx, ly, lz, 1, 1.35, 1);
    for (const s of [-1, 1]) kit.cyl(M.black, 0.075, 0.075, 0.04, lx, ly + s * 0.16, lz, 8);
    kit.cyl(M.black, 0.008, 0.008, Math.max(0.02, yRoof - ly - 0.18), lx, (yRoof + ly + 0.18) / 2, lz, 4);
    kit.glow(lx, ly, lz, 1.0);
  }

  kit.build(outer.userData.inner);
  return outer;
}

// ================================================================ PAGODA
export function buildPagoda(p) {
  const size = clamp(p.size ?? 4, 2.6, 5.5), T = size >= 4 ? 5 : 3;
  const sc = size / 4.5, sv = 0.7 + 0.3 * sc, so = clamp(sc, 0.7, 1.15);
  const P = size * 0.5;
  const [minH, maxH] = footprintHeights(p.x, p.z, 0, 2 * P, 2 * P);
  const gy = heightAt(p.x, p.z);
  const outer = pivotGroup('pagodas', p.id, p.x, gy, p.z, 0);
  const kit = new Kit();

  // stone platform + front steps
  const base = Math.max(maxH, WATER + 0.1) + 0.3, fb = minH - 0.4;
  kit.box(M.stone, 2 * P, base - fb, 2 * P, 0, (base + fb) / 2, 0);
  kit.box(M.stoneLight, 2 * P + 0.08, 0.1, 2 * P + 0.08, 0, base - 0.05, 0);
  const gF = heightAt(p.x, p.z + P + 0.35), rise = base - gF;
  if (rise > 0.1) {
    const ns = clamp(Math.round(rise / 0.16), 1, 5), sw = 1.2 * so;
    for (let k = 0; k < ns; k++) {
      const top = gF + rise * (k + 1) / (ns + 1), z0 = P + (ns - k) * 0.24, zb = P - 0.05;
      kit.box(M.stoneLight, sw, top - (gF - 0.25), z0 - zb, 0, (top + gF - 0.25) / 2, (z0 + zb) / 2);
    }
  }

  const b0 = size * 0.29, ov0 = 0.8 * so, shrink = 0.82, curve = 1.45, up = 0.3;
  let y0 = base, yCore = base, prev = null, apex = base;
  for (let i = 0; i < T; i++) {
    const last = i === T - 1, b = b0 * Math.pow(shrink, i);
    const hb = (i === 0 ? 1.05 : 0.6 * (1 - 0.03 * i)) * sv, y1 = y0 + hb;
    const ov = ov0 * (1 - 0.04 * i), R = b + ov;
    let tMax = 1, H;
    if (!last) { const bn = b0 * Math.pow(shrink, i + 1); tMax = (R - (bn - 0.05)) / R; H = 0.45 / Math.pow(tMax, curve); }
    else H = R * 0.62;
    const yW = H * Math.pow(ov / R, curve), drop = Math.min(yW * 0.7, 0.14), eave = y1 - drop, fTop = eave + yW - 0.01;

    // body: plaster core + vermilion bracket band under the eaves
    kit.box(M.plaster, 2 * b - 0.04, fTop - yCore, 2 * b - 0.04, 0, (fTop + yCore) / 2, 0);
    if (fTop - 0.01 - y1 > 0.02) kit.box(M.vermilion, 2 * b, fTop - 0.01 - y1, 2 * b, 0, (fTop - 0.01 + y1) / 2, 0);

    const pw = clamp(0.07 + b * 0.04, 0.09, 0.15);
    const yb = y0 + (i === 0 ? 0.08 : 0.02), yt = y1 - 0.1;
    for (const F of faces(b, b)) {
      const nb = 3, bw = F.L / nb, iw = bw - pw;
      for (let j = 0; j <= nb; j++) fbox(kit, F, M.vermilion, pw, hb + 0.1, pw, -F.L / 2 + j * bw, y0 + hb / 2 - 0.05, 0);
      fbox(kit, F, M.vermilion, F.L + 0.2, 0.1, 0.1, 0, y1 - 0.05, 0.03);
      if (i === 0) fbox(kit, F, M.vermilion, F.L + 0.2, 0.08, 0.1, 0, y0 + 0.04, 0.03);
      // central double door
      const dh = (yt - yb) * (i === 0 ? 0.92 : 0.8);
      fbox(kit, F, M.darkWood, iw * 0.86, dh, 0.03, 0, yb + dh / 2, 0);
      fbox(kit, F, M.black, 0.02, dh, 0.04, 0, yb + dh / 2, 0.01);
      if (i === 0) {
        for (const r of [0.25, 0.5, 0.75]) for (const c of [-0.22, 0.22]) fbox(kit, F, M.gold, 0.035, 0.035, 0.03, c * iw, yb + r * dh, 0.025);
        // renji lattice windows in the side bays
        const wh = (yt - yb) * 0.42, wy = yb + (yt - yb) * 0.58, wl = iw * 0.66;
        for (const s of [-1, 1]) {
          const u = s * bw;
          fbox(kit, F, M.black, wl, wh, 0.02, u, wy, 0);
          for (let k = 0; k < 5; k++) fbox(kit, F, M.darkWood, 0.03, wh, 0.035, u + (k / 4 - 0.5) * wl * 0.82, wy, 0.02);
          for (const t of [-1, 1]) fbox(kit, F, M.vermilion, wl + 0.06, 0.05, 0.05, u, wy + t * wh / 2, 0.025);
        }
      }
      // balcony railing standing on the skirt below
      if (prev) {
        const rn = 0.2;
        const ySk = prev.eave + prev.H * Math.pow(clamp((prev.R - b - rn) / prev.R, 0, 1), curve);
        const rt = y0 + 0.22, rlen = F.L + 2 * rn + 0.04;
        fbox(kit, F, M.vermilion, rlen, 0.04, 0.04, 0, rt, rn);
        fbox(kit, F, M.vermilion, rlen, 0.03, 0.03, 0, (rt + ySk) / 2 + 0.02, rn);
        for (const u of [-F.L / 2 - rn, -bw / 2, bw / 2, F.L / 2 + rn]) fbox(kit, F, M.vermilion, 0.04, rt - ySk + 0.04, 0.04, u, (rt + ySk) / 2, rn);
      }
    }

    // roof (skirt or full top roof), hips, little bells at the corners
    kit.add(M.tile, roofGeo(2 * R, 2 * R, H, { curve, up, tMax, thick: 0.14 }), 0, eave, 0);
    roofHips(kit, M.ridge, R, R, H, curve, up, eave, last ? 1 : tMax, 0.09 * so);
    for (const [sx, sz] of CORNERS) kit.cyl(M.gold, 0.03, 0.05, 0.09, sx * (R - 0.06), eave + up - 0.19, sz * (R - 0.06), 8);

    prev = { eave, H, R };
    yCore = fTop - 0.05;
    y0 = eave + H * Math.pow(tMax, curve);   // skirt top (≈ eave + 0.45)
    apex = eave + H;
  }

  // sorin spire
  const s = so;
  kit.box(M.darkWood, 0.34 * s, 0.16, 0.34 * s, 0, apex + 0.02, 0);
  kit.sphere(M.gold, 0.15 * s, 0, apex + 0.12, 0, 1, 0.6, 1);
  const poleH = 2.0 * sv;
  kit.cyl(M.gold, 0.025, 0.04, poleH, 0, apex + poleH / 2, 0, 8);
  const nR = 9, r0 = apex + 0.32, r1 = apex + 0.32 + poleH * 0.55;
  for (let k = 0; k < nR; k++) {
    const t = k / (nR - 1), rr = lerp(0.16, 0.1, t) * s;
    kit.cyl(M.gold, rr, rr, 0.035, 0, lerp(r0, r1, t), 0, 12);
  }
  const yf = r1 + (poleH - (r1 - apex)) * 0.45;
  for (const a of [0, PI / 2]) kit.box(M.gold, 0.24 * s, 0.2 * s, 0.02, 0, yf, 0, a);  // suien (water flame)
  kit.sphere(M.gold, 0.06 * s, 0, apex + poleH - 0.12, 0);
  kit.sphere(M.gold, 0.09 * s, 0, apex + poleH + 0.02, 0, 1, 1.15, 1);                    // hoju jewel

  kit.build(outer.userData.inner);
  return outer;
}

// ================================================================ TORII
export function buildTorii(t) {
  const w = t.w ?? 2.4, rot = t.rot || 0;
  const gy = heightAt(t.x, t.z);
  const outer = pivotGroup('toriis', t.id, t.x, gy, t.z, rot);
  const kit = new Kit();
  const Ht = 1.6 + w * 0.45;
  const g = [-1, 1].map(s => { const [x, z] = toWorld(t.x, t.z, rot, s * w / 2, 0); return heightAt(x, z); });
  const top = Math.max(g[0], g[1]) + Ht;
  const pr = 0.09 + w * 0.018;

  [-1, 1].forEach((s, i) => {
    const x = s * w / 2, bot = g[i] - 0.25;
    kit.cyl(M.vermilion, pr * 0.86, pr, top - bot, x, (top + bot) / 2, 0, 14);
    kit.cyl(M.black, pr * 1.3, pr * 1.42, 0.34, x, g[i] + 0.1, 0, 14);   // kamaki base collar
    kit.cyl(M.black, pr * 1.36, pr * 1.36, 0.04, x, g[i] + 0.28, 0, 14);
  });
  // nuki tie beam, poking through the pillars
  const nukiY = top - 0.55 - w * 0.04;
  kit.box(M.vermilion, w + 0.55 + pr * 2, 0.15, 0.11, 0, nukiY, 0);
  // shimaki + kasagi lintels with upswept ends
  kit.add(M.vermilion, curvedBeam(w + 0.9, 0.16, 0.22, 0.06), 0, top + 0.08, 0);
  kit.add(M.black, curvedBeam(w + 1.45, 0.17, 0.3, 0.12 + w * 0.03), 0, top + 0.245, 0);
  // gakuzuka strut + plaque
  const gBot = nukiY + 0.075, gap = top - gBot, gm = (top + gBot) / 2;
  kit.box(M.vermilion, 0.1, gap, 0.08, 0, gm, 0);
  const ph = Math.min(0.42, gap * 0.78), pwid = ph * 0.72;
  kit.box(M.gold, pwid, ph, 0.05, 0, gm, 0);
  kit.box(M.black, pwid - 0.05, ph - 0.05, 0.07, 0, gm, 0);

  kit.build(outer.userData.inner);
  return outer;
}

// ================================================================ WALL (tsuijibei)
function centroid(pts) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  return pts.length ? [cx / pts.length, cz / pts.length] : [0, 0];
}

export function buildWall(w, paths = []) {
  const pts = w.pts || [];
  const [cx, cz] = centroid(pts);
  const outer = pivotGroup('walls', w.id, cx, heightAt(cx, cz), cz, 0);
  if (pts.length < 2) return outer;
  const S = resample(pts, 0.5);
  if (S.length < 2) return outer;
  const P = S.map(q => ({ x: q.x - cx, z: q.z - cz, h: q.h, ht: Math.max(q.h, WATER + 0.05), d: q.d }));
  const nSeg = P.length - 1;
  const kit = new Kit();

  // building chemistry: segments crossing a path become gaps
  const pr = (paths || []).filter(p => p && p.pts && p.pts.length).map(p => {
    const r = (p.w ?? 1.3) / 2 + 0.3;
    return { r2: r * r, s: p.pts.length > 1 ? resample(p.pts, 0.3) : [{ x: p.pts[0][0], z: p.pts[0][1] }] };
  });
  const gap = new Array(nSeg).fill(false);
  for (let i = 0; i < nSeg; i++) {
    const mx = (S[i].x + S[i + 1].x) / 2, mz = (S[i].z + S[i + 1].z) / 2;
    search: for (const p of pr) for (const q of p.s) {
      const dx = q.x - mx, dz = q.z - mz;
      if (dx * dx + dz * dz < p.r2) { gap[i] = true; break search; }
    }
  }
  const gates = [], gatePts = new Set();
  for (let i = 0; i < nSeg;) {
    if (!gap[i]) { i++; continue; }
    let j = i;
    while (j + 1 < nSeg && gap[j + 1]) j++;
    const len = P[j + 1].d - P[i].d;
    if (len < 0.8) for (let k = i; k <= j; k++) gap[k] = false;            // too small: keep the wall
    else if (i > 0 && j + 1 < nSeg) { gates.push([i, j + 1]); gatePts.add(i); gatePts.add(j + 1); }
    i = j + 1;
  }

  // wall segments
  const CAP_A = 0.5, CAP_HALF = 0.24;
  for (let i = 0; i < nSeg; i++) {
    if (gap[i]) continue;
    const A = P[i], B = P[i + 1];
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    const ry = Math.atan2(-dz, dx), nx = -dz / L, nz = dx / L;
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, len = L + 0.12;
    const hm = (A.ht + B.ht) / 2, bot = Math.min(A.h, B.h) - 0.3;
    const sTop = hm + 0.22, pTop = sTop + 1.15;
    kit.box(M.stone, len, sTop - bot, 0.6, mx, (sTop + bot) / 2, mz, ry);
    kit.box(M.wallPlaster, len, pTop - sTop, 0.44, mx, (pTop + sTop) / 2, mz, ry);
    kit.box(M.darkWood, len, 0.08, 0.5, mx, pTop - 0.02, mz, ry);
    kit.box(M.darkWood, len, 0.16, 0.2, mx, pTop + 0.08, mz, ry);
    const ridgeY = pTop + 0.2;
    const off = CAP_HALF * Math.cos(CAP_A), yb = ridgeY - CAP_HALF * Math.sin(CAP_A);
    for (const s of [-1, 1]) kit.box(M.tile, len + 0.04, 0.05, 2 * CAP_HALF, mx + nx * off * s, yb, mz + nz * off * s, ry, s * CAP_A);
    kit.box(M.ridge, len + 0.04, 0.09, 0.11, mx, ridgeY + 0.02, mz, ry);
  }

  // finished ends: a small capped pillar wherever a wall run stops (except at gate posts)
  const built = i => i >= 0 && i < nSeg && !gap[i];
  for (let k = 0; k <= nSeg; k++) {
    if (built(k - 1) === built(k) || gatePts.has(k)) continue;
    const E = P[k], o = built(k) ? P[k + 1] : P[k - 1];
    const ry = Math.atan2(-(o.z - E.z), o.x - E.x), bot = E.h - 0.3, sTop = E.ht + 0.24, top = sTop + 1.3;
    kit.box(M.stone, 0.7, sTop - bot, 0.7, E.x, (sTop + bot) / 2, E.z, ry);
    kit.box(M.wallPlaster, 0.56, top - sTop, 0.56, E.x, (top + sTop) / 2, E.z, ry);
    kit.box(M.darkWood, 0.62, 0.08, 0.62, E.x, top, E.z, ry);
    kit.add(M.tile, new THREE.CylinderGeometry(0.03, 0.56, 0.28, 4, 1), E.x, top + 0.18, E.z, ry + PI / 4);
    kit.sphere(M.ridge, 0.06, E.x, top + 0.33, E.z);
  }

  // roofed gates across paths
  for (const [i0, i1] of gates) {
    const A = P[i0], B = P[i1];
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const ry = Math.atan2(-dz, dx), ux = dx / L, uz = dz / L;
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const gTop = Math.max(A.ht, B.ht) + 2.0;
    for (const E of [A, B]) {
      kit.box(M.stone, 0.36, 0.3, 0.36, E.x, E.ht + 0.05, E.z, ry);
      kit.box(M.darkWood, 0.22, gTop - (E.h - 0.2), 0.22, E.x, (gTop + E.h - 0.2) / 2, E.z, ry);
    }
    kit.box(M.darkWood, L + 0.5, 0.14, 0.18, mx, gTop - 0.05, mz, ry);
    kit.box(M.darkWood, L + 0.3, 0.1, 0.12, mx, gTop - 0.45, mz, ry);
    const H = 0.42, geo = roofGeo(L + 0.9, 1.15, H, { curve: 1.3, up: 0.14 });
    const rl = geo.userData.ridgeLen;
    kit.add(M.tile, geo, mx, gTop + 0.04, mz, ry);
    const yR = gTop + 0.04 + H;
    kit.box(M.ridge, rl + 0.2, 0.1, 0.13, mx, yR + 0.03, mz, ry);
    for (const s of [-1, 1]) kit.box(M.ridge, 0.08, 0.22, 0.2, mx + ux * s * (rl / 2 + 0.1), yR + 0.08, mz + uz * s * (rl / 2 + 0.1), ry);
  }

  kit.build(outer.userData.inner);
  return outer;
}

// ================================================================ PATH (stones + bridges)
function buildBridge(kit, A, B, cx, cz, pw) {
  const ax = A.x - cx, az = A.z - cz, dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L, px = -uz, pz = ux, ry = Math.atan2(-dz, dx);
  const yA = Math.max(A.h, WATER) + 0.06, yB = Math.max(B.h, WATER) + 0.06;
  const ah = clamp(L * 0.18, 0.4, 1.6);
  const Y = t => lerp(yA, yB, t) + ah * Math.sin(PI * t);
  const at = (t, v, dy = 0) => [ax + ux * t * L + px * v, Y(t) + dy, az + uz * t * L + pz * v];
  const dw = clamp(pw * 0.85, 0.9, 1.5), hv = dw / 2;

  // planked deck + under-structure
  const nP = Math.max(8, Math.round(L / 0.17));
  for (let k = 0; k < nP; k++) seg3(kit, M.deck, at(k / nP, 0, -0.03), at((k + 1) / nP, 0, -0.03), dw, 0.06, -0.025);
  const nS = Math.max(6, Math.round(L / 0.4));
  for (let k = 0; k < nS; k++) {
    const t0 = k / nS, t1 = (k + 1) / nS;
    seg3(kit, M.darkWood, at(t0, 0, -0.11), at(t1, 0, -0.11), dw * 0.7, 0.1, 0.04);
    for (const s of [-1, 1]) seg3(kit, M.vermilion, at(t0, s * hv, -0.07), at(t1, s * hv, -0.07), 0.05, 0.16, 0.03);
  }

  // railings
  const nPost = Math.max(2, Math.round(L / 0.6)), nR = nPost * 4, rv = hv - 0.03;
  for (const s of [-1, 1]) {
    const v = s * rv;
    for (let j = 0; j <= nPost; j++) {
      const end = j === 0 || j === nPost, b = at(j / nPost, v), ph = end ? 0.6 : 0.5, pt = end ? 0.09 : 0.065;
      kit.box(M.vermilion, pt, ph, pt, b[0], b[1] + ph / 2 - 0.05, b[2], ry);
      if (end) {   // giboshi
        const yt = b[1] + ph - 0.05;
        kit.cyl(M.gold, 0.06, 0.06, 0.04, b[0], yt + 0.01, b[2], 10);
        kit.sphere(M.gold, 0.065, b[0], yt + 0.08, b[2], 1, 1.1, 1);
        kit.cyl(M.gold, 0, 0.035, 0.09, b[0], yt + 0.17, b[2], 8);
      }
    }
    for (let k = 0; k < nR; k++) {
      const t0 = k / nR, t1 = (k + 1) / nR;
      seg3(kit, M.vermilion, at(t0, v, 0.46), at(t1, v, 0.46), 0.055, 0.05, 0.02);
      seg3(kit, M.vermilion, at(t0, v, 0.24), at(t1, v, 0.24), 0.04, 0.04, 0.02);
    }
  }

  // piers into the water
  for (const t of [1 / 3, 2 / 3]) {
    let any = false;
    for (const s of [-1, 1]) {
      const top = at(t, s * hv * 0.7, -0.12);
      const bed = heightAt(top[0] + cx, top[2] + cz) - 0.05;
      if (top[1] - bed > 0.15) { kit.cyl(M.darkWood, 0.06, 0.07, top[1] - bed, top[0], (top[1] + bed) / 2, top[2], 8); any = true; }
    }
    if (any) seg3(kit, M.darkWood, at(t, -hv * 0.85, -0.17), at(t, hv * 0.85, -0.17), 0.09, 0.09);
  }
}

export function buildPath(p) {
  const pts = p.pts || [];
  const [cx, cz] = centroid(pts);
  const outer = pivotGroup('paths', p.id, cx, heightAt(cx, cz), cz, 0);
  if (pts.length < 2) return outer;
  const s = resample(pts, 0.3), n = s.length;
  if (n < 2) return outer;
  const kit = new Kit();
  const rng = mulberry32(seedOf(p.id, 303));
  const pw = p.w ?? 1.3, sw = clamp(pw / 1.3, 0.8, 1.5);
  const wet = s.map(q => q.h < WATER + 0.03);
  const excl = [];
  const perpAt = k => {
    const a = s[Math.max(k - 1, 0)], b = s[Math.min(k + 1, n - 1)];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    return [-tz / l, tx / l];
  };

  // wet runs: bridge if land on both sides, else stepping stones in the water
  for (let i = 0; i < n;) {
    if (!wet[i]) { i++; continue; }
    let j = i;
    while (j + 1 < n && wet[j + 1]) j++;
    const before = i - 1, after = j + 1;
    if (before >= 0 && after < n && Math.hypot(s[after].x - s[before].x, s[after].z - s[before].z) >= 1.0) {
      buildBridge(kit, s[before], s[after], cx, cz, pw);
      excl.push(s[before], s[after]);
    } else {
      let next = -Infinity, cnt = 0;
      for (let k = i; k <= j; k++) {
        if (s[k].d < next) continue;
        next = s[k].d + 0.8;
        const [qx, qz] = perpAt(k), off = (cnt++ % 2 ? 1 : -1) * (0.05 + rng() * 0.08) * sw;
        const r = (0.38 + rng() * 0.12) * sw, top = WATER + 0.05, bot = Math.min(s[k].h - 0.1, top - 0.12);
        kit.add(M.stepStone, new THREE.CylinderGeometry(r * 0.92, r, top - bot, 7), s[k].x + qx * off - cx, (top + bot) / 2, s[k].z + qz * off - cz,
          rng() * PI * 2, 0, 0, 1, 1, 0.8 + rng() * 0.25);
      }
    }
    i = j + 1;
  }

  // dry stepping stones
  let next = 0.25, cnt = 0;
  for (let k = 0; k < n; k++) {
    if (s[k].d < next) continue;
    next = s[k].d + 0.85;
    if (wet[k]) continue;
    if (excl.some(e => Math.hypot(e.x - s[k].x, e.z - s[k].z) < 0.75)) continue;
    const [qx, qz] = perpAt(k), off = (cnt++ % 2 ? 1 : -1) * (0.06 + rng() * 0.1) * sw;
    const r = (0.28 + rng() * 0.14) * sw;
    const wx = s[k].x + qx * off, wz = s[k].z + qz * off;
    kit.add(M.stepStone, new THREE.CylinderGeometry(r * 0.94, r, 0.1, 7), wx - cx, heightAt(wx, wz) + 0.03, wz - cz,
      rng() * PI * 2, 0, 0, 1, 1, 0.75 + rng() * 0.3);
  }

  kit.build(outer.userData.inner);
  return outer;
}

// ================================================================ DECOR
function jitterPoly(geo, rng, amt) {
  const pos = geo.attributes.position, map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!map.has(key)) map.set(key, 1 - amt + rng() * amt * 2);
    const f = map.get(key);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

function stoneLantern(kit, k, g) {
  const S = LANTERN_STONE;
  let y = g - 0.06;
  const hex = (rt, rb, hh) => { kit.cyl(S, rt * k, rb * k, hh * k, 0, y + hh * k / 2, 0, 6); y += hh * k; };
  hex(0.3, 0.32, 0.12);     // kiso (base)
  hex(0.2, 0.28, 0.08);
  const poleBot = y;
  hex(0.085, 0.1, 0.5);     // sao (pole)
  kit.cyl(S, 0.115 * k, 0.115 * k, 0.04 * k, 0, poleBot + 0.25 * k, 0, 10);   // fushi ring
  hex(0.24, 0.12, 0.1);     // chudai (platform)
  hex(0.24, 0.24, 0.04);
  // hibukuro (firebox): glowing paper windows framed by stone corner posts and rims
  const y0 = y, fh = 0.3 * k;
  kit.cyl(M.lampPaper, 0.14 * k, 0.14 * k, fh, 0, y0 + fh / 2, 0, 6);
  for (let j = 0; j < 6; j++) {
    const th = j * PI / 3;
    kit.box(S, 0.05 * k, fh, 0.05 * k, Math.sin(th) * 0.15 * k, y0 + fh / 2, Math.cos(th) * 0.15 * k, th);
  }
  kit.cyl(S, 0.19 * k, 0.19 * k, 0.04 * k, 0, y0 + 0.02 * k, 0, 6);
  y = y0 + fh;
  kit.cyl(S, 0.19 * k, 0.19 * k, 0.04 * k, 0, y - 0.02 * k, 0, 6);
  kit.glow(0, y0 + fh / 2, 0, 1.3 * k);
  // kasa (roof) with upturned corner curls
  kit.cyl(S, 0.38 * k, 0.37 * k, 0.04 * k, 0, y + 0.02 * k, 0, 6);
  kit.cyl(S, 0.06 * k, 0.37 * k, 0.2 * k, 0, y + 0.14 * k, 0, 6);
  for (let j = 0; j < 6; j++) {
    const th = j * PI / 3;
    kit.sphere(S, 0.045 * k, Math.sin(th) * 0.38 * k, y + 0.07 * k, Math.cos(th) * 0.38 * k, 1, 1.4, 1);
  }
  y += 0.24 * k;
  // hoju knob
  kit.cyl(S, 0.06 * k, 0.07 * k, 0.04 * k, 0, y + 0.02 * k, 0, 6);
  kit.sphere(S, 0.075 * k, 0, y + 0.1 * k, 0, 1, 1.1, 1);
  kit.cyl(S, 0, 0.04 * k, 0.07 * k, 0, y + 0.2 * k, 0, 6);
}

function boulder(kit, rng, s, d) {
  const R = 0.55 * s;
  const sx = R * (1 + rng() * 0.35), sy = R * (0.6 + rng() * 0.3), sz = R * (0.85 + rng() * 0.3);
  const rr = Math.max(sx, sz) * 0.6;
  let gmin = heightAt(d.x, d.z);
  for (const [ox, oz] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) gmin = Math.min(gmin, heightAt(d.x + ox, d.z + oz));
  const cy = gmin + sy * 0.35;
  const geo = jitterPoly(rng() < 0.5 ? new THREE.DodecahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, 1), rng, 0.18);
  kit.add(M.rock, geo, 0, cy, 0, rng() * PI * 2, 0, 0, sx, sy, sz);
  if (rng() < 0.65) {
    const mg = jitterPoly(new THREE.IcosahedronGeometry(1, 1), rng, 0.12);
    kit.add(MOSS, mg, 0, cy + sy * 0.72, 0, rng() * PI * 2, 0, 0, sx * 0.72, sy * 0.32, sz * 0.72);
  }
  // a couple of pebbles at the foot
  const np = Math.floor(rng() * 3);
  for (let i = 0; i < np; i++) {
    const a = rng() * PI * 2, dist = Math.max(sx, sz) * (1.05 + rng() * 0.3), pr = R * (0.16 + rng() * 0.12);
    const lx = Math.cos(a) * dist, lz = Math.sin(a) * dist;
    // local offsets are rotated by d.r in the outer group; sample ground at the matching world point
    const [wx, wz] = toWorld(d.x, d.z, d.r || 0, lx, lz);
    kit.add(M.rock, jitterPoly(new THREE.DodecahedronGeometry(1, 0), rng, 0.2), lx, heightAt(wx, wz) + pr * 0.25, lz,
      rng() * PI * 2, 0, 0, pr * 1.2, pr * 0.7, pr);
  }
}

export function buildDecor(d) {
  const s = d.s ?? 1;
  const gy = heightAt(d.x, d.z);
  const outer = pivotGroup('decor', d.id, d.x, gy, d.z, d.r || 0);
  const kit = new Kit();
  if (d.type === 'rock') boulder(kit, mulberry32(seedOf(d.id, 505)), s, d);
  else stoneLantern(kit, s, gy);
  kit.build(outer.userData.inner);
  return outer;
}
