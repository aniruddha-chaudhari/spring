// vegetation/placeTrees.js — hero trees (ANCHORS.trees), scattered glade trees, edge framing trees and the cedar grove.
import * as THREE from 'three';
import { ANCHORS, groundHeight, borderDist, mulberry32, streamAt, loadTex, BORDER, IS_SPRING } from '../world.js';
import { GeoBuilder, leafMaterial, barkMaterial, swayDepthMaterial, inForegroundView } from './shared.js';
import { BUILDERS } from './trees.js';
import { foliageAtlas } from './atlas.js';

function segDist(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2));
  return Math.hypot(px - (ax + ex * t), pz - (az + ez * t));
}

// Keep sight lines from the default camera to the landmarks open.
const VIEW_FROM = [42, 48];
const VIEW_TO = () => [[ANCHORS.teahouse.x, ANCHORS.teahouse.z], [ANCHORS.bridge.x, ANCHORS.bridge.z], [-4, -5], [ANCHORS.torii.x, ANCHORS.torii.z]];
function blocksView(x, z, r) {
  for (const [tx, tz] of VIEW_TO()) if (segDist(x, z, VIEW_FROM[0], VIEW_FROM[1], tx, tz) < r) return true;
  return false;
}

export function buildTreeSet(group, F) {
  const atlas = foliageAtlas();
  const B = { maple: new GeoBuilder(), pine: new GeoBuilder(), cedar: new GeoBuilder() };
  const barkOf = { maple: 'maple', ginkgo: 'maple', pine: 'pine', cedar: 'cedar', sakura: 'maple' };
  const L = new GeoBuilder();
  const placed = [];   // {type, x, z, r, H}
  const add = (type, x, z, s, lean, seed, extra = {}) => {
    if (!BUILDERS[type]) { console.warn('[vegetation] unknown tree type', type, '- using maple'); type = 'maple'; }
    if (IS_SPRING) {
      if (type === 'maple' && extra.springSwap && seed % 3 !== 0) type = 'sakura';   // most framing trees bloom
      if (type === 'maple') extra.palette = 'springMaple';
      if (type === 'ginkgo') extra.palette = 'springGinkgo';
    }
    const t = { x, y: groundHeight(x, z), z, s, lean, ...extra };
    const info = BUILDERS[type](B[barkOf[type]], L, t, seed, 0);
    placed.push({ type, x, z, s, r: info.R, H: info.H, crown: info.crown, weeping: !!extra.weeping });
  };

  // hero trees
  let nSak = 0;
  ANCHORS.trees.forEach((t, i) => {
    // spring: the 2nd and 5th sakura (by the pond / teahouse) are weeping cherries hanging over the water
    const weeping = t.type === 'sakura' && [1, 4].includes(nSak++);
    add(t.type, t.x, t.z, t.s, t.lean, 7001 + i * 31, weeping ? { weeping } : {});
  });

  // scattered glade trees
  const rnd = mulberry32(555);
  const near = (x, z, d) => placed.some(p => Math.hypot(p.x - x, p.z - z) < d + p.r * 0.5);
  let tries = 0, extras = 0;
  while (extras < 4 && tries++ < 3000) {
    const x = (rnd() * 2 - 1) * (BORDER - 3), z = (rnd() * 2 - 1) * (BORDER - 3);
    const xb = borderDist(x, z); if (xb > -2.5 || xb < -8) continue;   // framing trees near the border only
    if (!F.free(x, z, 1.6, 1.8, 1.2)) continue;
    if (near(x, z, 5.5)) continue;
    if (blocksView(x, z, 6) || inForegroundView(x, groundHeight(x, z), z, 8)) continue;
    // keep the central foreground open, favour the glade's back and sides
    const frontness = (x + z) / (2 * BORDER);
    if (frontness > -0.1) continue;
    const r = rnd();
    const type = r < 0.62 ? 'maple' : r < 0.8 ? 'ginkgo' : 'pine';
    add(type, x, z, type === 'pine' ? 0.75 + rnd() * 0.2 : 0.7 + rnd() * 0.3, { x: 0, z: 0 }, 9100 + extras * 17, { hue: (rnd() - 0.5) * 2, springSwap: true });
    extras++;
  }
  // framing trees along the glade's edge (back and sides heavier)
  tries = 0; let edge = 0;
  while (edge < 16 && tries++ < 4000) {
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * (BORDER + 6) * 1.3, z = Math.sin(a) * (BORDER + 6) * 1.3;
    const bd = borderDist(x, z);
    const px = x * (1 - (bd + 2 - rnd() * 5) / Math.hypot(x, z)), pz = z * (1 - (bd + 2 - rnd() * 5) / Math.hypot(x, z));
    const pb = borderDist(px, pz); if (pb < 1 || pb > 6) continue;
    if (!F.free(px, pz, 1.5, 2, 1.0)) continue;
    if (near(px, pz, 6)) continue;
    if (px + pz > -6) continue;          // only the back half: never in front of the default camera
    if (blocksView(px, pz, 5) || inForegroundView(px, groundHeight(px, pz), pz, 9)) continue;
    const r = rnd();
    const type = r < 0.55 ? 'maple' : r < 0.7 ? 'ginkgo' : r < 0.85 ? 'pine' : 'cedar';
    add(type, px, pz, type === 'cedar' ? 0.7 + rnd() * 0.2 : 0.85 + rnd() * 0.3, { x: 0, z: 0 }, 9900 + edge * 23, { hue: (rnd() - 0.5) * 2, springSwap: true });
    edge++;
  }
  // cedar grove
  const g = ANCHORS.zones.cedarGrove;
  tries = 0; let cedars = 0;
  while (cedars < 26 && tries++ < 3000) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * g.r;
    const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d * 0.8;
    if (!F.free(x, z, 1.0, 1.5, 0.8)) continue;
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < (p.type === 'cedar' ? 3.2 : 4.5))) continue;
    add('cedar', x, z, 0.85 + rnd() * 0.3, { x: 0, z: 0 }, 12000 + cedars * 13);
    cedars++;
  }

  // meshes
  const meshes = [];
  const barkTex = { maple: 'trident_maple_bark', pine: 'pine_bark', cedar: 'japanese_cedar_bark' };
  const barkDepth = swayDepthMaterial(null, 0);
  for (const k of Object.keys(B)) {
    if (!B[k].count) continue;
    const mat = barkMaterial(loadTex(barkTex[k], 'diff'), loadTex(barkTex[k], 'nor'));
    const m = new THREE.Mesh(B[k].build(), mat);
    m.castShadow = m.receiveShadow = true; m.customDepthMaterial = barkDepth; m.name = 'bark_' + k;
    group.add(m); meshes.push(m);
  }
  const leafMat = leafMaterial(atlas, { alphaTest: 0.42, wrap: 0.6, transl: 1 });
  const lm = new THREE.Mesh(L.build(), leafMat);
  lm.castShadow = lm.receiveShadow = true; lm.customDepthMaterial = swayDepthMaterial(atlas, 0.42); lm.name = 'treeLeaves';
  group.add(lm); meshes.push(lm);

  const verts = meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
  return { placed, meshes, leafMat, stats: { trees: placed.length, hero: ANCHORS.trees.length, extras, edge, cedars, verts, leafCards: L.count / 4 } };
}
