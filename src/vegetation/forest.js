// vegetation/forest.js — the endless forest beyond the glade.
//   Tier A (just outside the border, out to ~35 m beyond it): instanced low-detail card trees (same generator as the
//            hero trees at lod 1, bark + leaves merged into one geometry on the foliage atlas). Cast shadows.
//   Tier B (hills and mountains out to ~240 m): instanced lumpy crown blobs / cedar cones with leafy shading noise.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, borderDist, streamAt, mulberry32, fbm2, noise2, smoothstep, IS_SPRING } from '../world.js';
import { GeoBuilder, leafMaterial, swayDepthMaterial, foliagePatch, lin, v3, inForegroundView } from './shared.js';
import { BUILDERS, emitClump, PALETTES } from './trees.js';
import { foliageAtlas, tileUV, TILE } from './atlas.js';

const CAM_XZ = [42, 48];   // default camera ground position: keep it clear

// ---------------------------------------------------------------- tier A variants
function variant(type, seed, extra = {}) {
  const bark = new GeoBuilder(), leaves = new GeoBuilder();
  const info = BUILDERS[type](bark, leaves, { x: 0, y: 0, z: 0, s: extra.s || 1, lean: { x: 0, z: 0 }, ...extra }, seed, 1);
  const out = new GeoBuilder();
  const bt = tileUV(TILE.bark);
  const barkCol = type === 'cedar' ? lin('#6a4a36') : type === 'pine' ? lin('#5a4a3c') : lin('#4e4038');
  out.append(bark, (u, v) => bt(0.2 + (u % 1) * 0.6, 0.2 + ((v * 0.37) % 1) * 0.6), barkCol);
  out.append(leaves);
  return { geo: out.build(), info };
}

function tierA(group, placed, atlas) {
  const fams = IS_SPRING ? [
    // spring: fresh greens of many shades, dark conifers, scattered yamazakura (keys kept so placement is shared)
    { key: 'mapleRed', type: 'maple', seeds: [301, 302], extra: { palette: 'springMaple', hue: -0.5 } },
    { key: 'mapleOrange', type: 'sakura', seeds: [303, 310], extra: { s: 1.05 } },
    { key: 'oak', type: 'maple', seeds: [304, 305], extra: { palette: 'springOak', hue: 0, s: 1.15 } },
    { key: 'ginkgo', type: 'ginkgo', seeds: [306], extra: { palette: 'springGinkgo' } },
    { key: 'cedar', type: 'cedar', seeds: [307, 308], extra: { s: 0.85 } },
    { key: 'pine', type: 'pine', seeds: [309], extra: { s: 0.9 } },
  ] : [
    { key: 'mapleRed', type: 'maple', seeds: [301, 302], extra: { hue: -1.2 } },
    { key: 'mapleOrange', type: 'maple', seeds: [303], extra: { palette: 'orange', hue: 0.5 } },
    { key: 'oak', type: 'maple', seeds: [304, 305], extra: { palette: 'oak', hue: 0, s: 1.15 } },
    { key: 'ginkgo', type: 'ginkgo', seeds: [306], extra: {} },
    { key: 'cedar', type: 'cedar', seeds: [307, 308], extra: { s: 0.85 } },
    { key: 'pine', type: 'pine', seeds: [309], extra: { s: 0.9 } },
  ];
  const variants = [];
  for (const f of fams) for (const sd of f.seeds) variants.push({ fam: f.key, ...variant(f.type, sd, f.extra), list: [] });
  // understory bushes hide the bare trunks at the forest edge
  const bushPals = IS_SPRING
    ? [['bushGreen', ['#3e6a2a', '#4a7a2e', '#58883a', '#6a9a3c'].map(lin), 501], ['bushRed', PALETTES.azalea.concat(['#4a7a2e', '#58883a'].map(lin)), 502], ['bushGold', PALETTES.springOak, 503]]
    : [['bushGreen', ['#34502a', '#3f5c2c', '#4c6630', '#5a6e32'].map(lin), 501], ['bushRed', PALETTES.shrubRed.concat(PALETTES.orange.slice(0, 3)), 502], ['bushGold', PALETTES.oak, 503]];
  for (const [key, pal, sd] of bushPals) {
    const L = new GeoBuilder(), r0 = mulberry32(sd);
    for (const [ox, oz, rr] of [[0, 0, 1.0], [0.9, 0.3, 0.75], [-0.7, 0.5, 0.7]]) {
      const cc = v3(ox, rr * 0.6, oz);
      emitClump(L, cc, {
        tiles: [TILE.shrub], size: 0.75, count: 16, radius: rr, ry: 0.8, core: 0.6, coreDetail: 0,
        colorFn: (p, o, q) => pal[(q() * pal.length) | 0], crownC: v3(0, 0.7, 0), crownR: v3(1.8, 1.0, 1.8), crownBlend: 0.6,
        windW: (p) => 0.04 * p.y, base: v3(0, 0, 0), phase: 0, transl: 0.7, flutter: 0.4, aoMin: 0.35,
      }, r0);
    }
    variants.push({ fam: key, geo: L.build(), info: {}, list: [] });
  }
  const rnd = mulberry32(777);
  const STEP = 5.2;
  for (let gz = -95; gz <= 95; gz += STEP) for (let gx = -95; gx <= 95; gx += STEP) {
    const x = gx + (rnd() - 0.5) * STEP * 0.9, z = gz + (rnd() - 0.5) * STEP * 0.9;
    const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
    const bd = borderDist(x, z);
    if (bd < 2.5 || bd > 36) continue;
    if (bd > 26 && r1 < smoothstep(26, 36, bd)) continue;           // hand over to tier B
    if (bd < 6 && r1 < 0.35) continue;                                // a softer, broken edge
    const st = streamAt(x, z);
    if (st.d < st.hw + 3 + r2 * 3) continue;
    if (Math.hypot(x - CAM_XZ[0], z - CAM_XZ[1]) < 16) continue;
    if (inForegroundView(x, groundHeight(x, z), z, 11)) continue;
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < 3.5 + p.r * 0.4)) continue;
    if (fbm2(x * 0.06 + 9, z * 0.06 - 4, 2) > 0.38) continue;          // small clearings
    // species clusters
    const n = fbm2(x * 0.035 - 3, z * 0.035 + 8, 3), m = fbm2(x * 0.05 + 17, z * 0.05 - 2, 2);
    let fam;
    if (n > 0.18) fam = r3 < 0.75 ? 'cedar' : 'pine';
    else if (m > 0.2) fam = r3 < 0.6 ? 'mapleRed' : 'mapleOrange';
    else if (m < -0.2) fam = r3 < 0.55 ? 'oak' : 'ginkgo';
    else fam = ['mapleRed', 'mapleOrange', 'oak', 'oak', 'ginkgo', 'cedar'][(r3 * 6) | 0];
    const vs = variants.filter(v => v.fam === fam);
    const v = vs[(r4 * vs.length) | 0];
    v.list.push({ x, y: groundHeight(x, z), z, s: 0.85 + rnd() * 0.45, rot: rnd() * 6.283, tint: 0.85 + rnd() * 0.3 });
  }
  // bushes: 2-3 around the forest edge per cell, in the gaps between trunks
  const bushes = variants.filter(v => v.fam.startsWith('bush'));
  for (let gz = -90; gz <= 90; gz += 3.4) for (let gx = -90; gx <= 90; gx += 3.4) {
    const x = gx + (rnd() - 0.5) * 3, z = gz + (rnd() - 0.5) * 3, r1 = rnd(), r2 = rnd();
    const bd = borderDist(x, z);
    if (bd < 0.5 || bd > 24 || r1 < smoothstep(8, 24, bd)) continue;
    const st = streamAt(x, z);
    if (st.d < st.hw + 1.5) continue;
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < 1.5)) continue;
    const y = groundHeight(x, z);
    if (inForegroundView(x, y, z, 2.2)) continue;
    const m = fbm2(x * 0.05 + 17, z * 0.05 - 2, 2);
    const v = r2 < 0.55 ? bushes[0] : m > 0 ? bushes[1] : bushes[2];
    v.list.push({ x, y: y - 0.1, z, s: 0.7 + rnd() * 0.6, rot: rnd() * 6.283, tint: 0.85 + rnd() * 0.3 });
  }
  const mat = leafMaterial(atlas, { alphaTest: 0.42, wrap: 0.6, transl: 0.9, instanced: true, key: 'A' });
  const depth = swayDepthMaterial(atlas, 0.42, { instanced: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
  let count = 0, verts = 0;
  for (const v of variants) {
    if (!v.list.length) continue;
    const im = new THREE.InstancedMesh(v.geo, mat, v.list.length);
    v.list.forEach((t, i) => {
      q.setFromAxisAngle(v3(0, 1, 0), t.rot); sc.set(t.s, t.s * (0.9 + (t.tint - 0.85)), t.s); pos.set(t.x, t.y, t.z);
      im.setMatrixAt(i, m4.compose(pos, q, sc));
      im.setColorAt(i, col.setScalar(t.tint));
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = depth;
    im.name = 'forestA_' + v.fam;
    group.add(im);
    count += v.list.length; verts += v.geo.attributes.position.count * v.list.length;
  }
  return { count, verts, variants: variants.length };
}

// ---------------------------------------------------------------- tier B blobs
function blobGeometry(kind, seed) {
  const rnd = mulberry32(seed);
  const B = new GeoBuilder();
  const lumps = [];
  if (kind === 'decid') {
    const H = 7.5;
    lumps.push([0, H * 0.6, 0, 2.3, 2.0]);
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + rnd(); const rr = 1.3 + rnd() * 0.7; lumps.push([Math.cos(a) * rr, H * (0.45 + rnd() * 0.4), Math.sin(a) * rr, 1.05 + rnd() * 0.45, 0.95 + rnd() * 0.3]); }
    lumps.push([0.3, H * 0.9, -0.2, 1.2, 1.0]);
  } else {
    const H = 11;
    for (let i = 0; i < 4; i++) lumps.push([0, H * (0.32 + i * 0.18), 0, 1.9 * (1 - i * 0.22), 1.7, 'cone']);
  }
  const ctr = kind === 'decid' ? v3(0, 4.6, 0) : v3(0, 6.5, 0);
  const crownR = kind === 'decid' ? v3(3.6, 2.8, 3.6) : v3(2.0, 5, 2.0);
  for (const [lx, ly, lz, r, h, cone] of lumps) {
    let g;
    if (cone) g = new THREE.ConeGeometry(r, h * 1.4, 7, 1, true).translate(0, 0, 0);
    else { g = new THREE.IcosahedronGeometry(1, 0); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); }
    const p = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const base = B.count;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (!cone) { const k = 1 + 0.22 * noise2(x * 2.1 + lx + seed, z * 2.1 + y * 1.7); x *= r * k; y *= h * k * 0.95; z *= r * k; }
      x += lx; y += ly; z += lz;
      const nl = v3(x - lx, (y - ly) * 0.8, z - lz).normalize();
      const nc = v3((x - ctr.x) / crownR.x, (y - ctr.y) / crownR.y, (z - ctr.z) / crownR.z);
      const depth = nc.length(); nc.normalize();
      const n = nl.lerp(nc, 0.55).normalize();
      const ao = 0.3 + 0.7 * Math.min(1, depth * 0.55 + (0.5 + 0.5 * n.y) * 0.5);
      const w = 0.012 * y * y / 8 + 0.03 * Math.hypot(x, z);
      B.v([x, y, z], [n.x, n.y, n.z], 0.5, 0.5, [ao, ao, ao], [0, 0, w, 0], [0.4, rnd() * 50, 0.5, 0]);
    }
    if (idx) for (let i = 0; i < idx.length; i += 3) B.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
    else for (let i = 0; i < p.count; i += 3) B.tri(base + i, base + i + 1, base + i + 2);
  }
  return B.build();
}

function tierB(group) {
  const geos = { decid: blobGeometry('decid', 5), cedar: blobGeometry('cedar', 6) };
  const pal = IS_SPRING ? {
    // spring hills: 'red' slot = soft-pink yamazakura clouds
    red: ['#e6b2c4', '#eec2d0', '#dba2b6'].map(lin), orange: ['#76a238', '#84ae40', '#6c9832'].map(lin),
    gold: ['#98b844', '#a6c050', '#8cac3e'].map(lin), green: ['#3c6627', '#46742b', '#52802e'].map(lin),
    cedar: ['#1f3527', '#253d2c', '#2b452f', '#33472d'].map(lin),
  } : {
    red: ['#7e1c14', '#962618', '#a43818'].map(lin), orange: ['#a8501c', '#b8641e', '#a86e26'].map(lin),
    gold: ['#a88a2a', '#b89832', '#9a8030'].map(lin), green: ['#435428', '#53602a', '#5e6430'].map(lin),
    cedar: ['#1f3527', '#253d2c', '#2b452f', '#33472d'].map(lin),
  };
  const rnd = mulberry32(4242);
  const STEP = 5.0, EXT = 245;
  const lists = {};   // key: kind_quadrant
  for (let gz = -EXT; gz <= EXT; gz += STEP) for (let gx = -EXT; gx <= EXT; gx += STEP) {
    const x = gx + (rnd() - 0.5) * STEP * 0.95, z = gz + (rnd() - 0.5) * STEP * 0.95;
    const r1 = rnd(), r2 = rnd(), r3 = rnd();
    const bd = borderDist(x, z);
    if (bd < 26) continue;
    if (bd < 36 && r1 > smoothstep(26, 36, bd)) continue;
    const st = streamAt(x, z);
    if (st.d < st.hw + 3 + r2 * 4) continue;
    if (Math.hypot(x - CAM_XZ[0], z - CAM_XZ[1]) < 20) continue;
    if (bd < 70 && inForegroundView(x, groundHeight(x, z), z, 12)) continue;
    if (fbm2(x * 0.025 + 31, z * 0.025 - 12, 3) > 0.3 + 0.1 * r2) continue;   // clearings / meadows on the hills
    const y = groundHeight(x, z);
    const n = fbm2(x * 0.018 - 3, z * 0.018 + 8, 3) + y * 0.006, m = fbm2(x * 0.03 + 17, z * 0.03 - 2, 3);
    let kind = 'decid', c;
    if (n > 0.12 + r3 * 0.1) { kind = 'cedar'; c = pal.cedar[(r3 * 4) | 0]; }
    else {
      let fam = m > 0.22 ? 'red' : m > 0.02 ? 'orange' : m > -0.2 ? 'gold' : 'green';
      let alt = r3 < 0.25 ? ['red', 'orange', 'gold', 'green'][(r2 * 4) | 0] : fam;
      if (IS_SPRING) {
        fam = m > 0.15 ? 'orange' : m > -0.12 ? 'green' : 'gold';
        alt = (r3 < 0.1 || (m > 0.28 && r2 < 0.3)) ? 'red' : r3 < 0.3 ? ['orange', 'gold', 'green'][(r2 * 3) | 0] : fam;
      }
      c = pal[alt][(r1 * 3) | 0];
    }
    const quad = (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0);
    const key = kind + quad;
    (lists[key] ||= []).push({ x, y, z, s: 0.8 + rnd() * 0.55, rot: rnd() * 6.283, c, k: 0.85 + rnd() * 0.3 });
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  foliagePatch(mat, {
    instanced: true, wrap: 0.3, transl: 0.5, a2c: false, key: 'B',
    extraColor: 'diffuseColor.rgb *= 0.55 + 0.75 * hk_cloudNoise(hkWorldPos.xz * 3.1 + hkWorldPos.y * 2.3) * (0.6 + 0.4 * hk_cloudNoise(hkWorldPos.zx * 0.8 - hkWorldPos.y * 0.9 + 3.1));',
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
  let count = 0, verts = 0;
  for (const key in lists) {
    const L = lists[key], kind = key.startsWith('cedar') ? 'cedar' : 'decid';
    const im = new THREE.InstancedMesh(geos[kind], mat, L.length);
    L.forEach((t, i) => {
      q.setFromAxisAngle(v3(0, 1, 0), t.rot); sc.set(t.s, t.s * (0.85 + rnd() * 0.35), t.s); pos.set(t.x, t.y - 0.3, t.z);
      im.setMatrixAt(i, m4.compose(pos, q, sc));
      im.setColorAt(i, col.setRGB(t.c[0] * t.k, t.c[1] * t.k, t.c[2] * t.k));
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = false; im.receiveShadow = true;
    im.name = 'forestB_' + key;
    group.add(im);
    count += L.length; verts += geos[kind].attributes.position.count * L.length;
  }
  return { count, verts, meshes: Object.keys(lists).length };
}

export function buildForest(group, placed) {
  const atlas = foliageAtlas();
  const a = tierA(group, placed, atlas);
  const b = tierB(group);
  return { stats: { tierA: a, tierB: b } };
}
