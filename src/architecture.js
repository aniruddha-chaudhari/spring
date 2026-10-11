// architecture.js — all built and stone things in the garden: teahouse, taikobashi bridge, stepping stones, boulders,
// pebbles and bank stonework, kasuga stone lanterns, shishi-odoshi, hokora shrine + torii + jizō.
// Static pieces are merged into one mesh per material (see architecture/kit.js Batch); only animated bits are separate.
import * as THREE from 'three';
import { U, IS_SPRING } from './world.js';
import { Batch } from './architecture/kit.js';
import { makeMaterials } from './architecture/mats.js';
import { buildTeahouse } from './architecture/teahouse.js';
import { buildBridge } from './architecture/bridge.js';
import { buildStones } from './architecture/stones.js';
import { buildLanterns } from './architecture/lanterns.js';
import { buildShishi } from './architecture/shishi.js';
import { buildShrine } from './architecture/shrine.js';
import { buildOnsen } from './architecture/onsen.js';

let root = null, mats = null, tea = null, shishi = null, ledges = [];
const parts = [];          // { update(dt, t, night) }
const lights = [];         // warm night PointLights (<= 6)
const knockCbs = [];
let lightsOn = false;

export async function init(ctx) {
  root = new THREE.Group();
  root.name = 'architecture';
  mats = makeMaterials();
  const B = new Batch();
  tea = buildTeahouse(B, mats, root);
  parts.push(tea); lights.push(tea.light);
  buildBridge(B, mats);
  buildStones(B, mats, root);
  const lan = buildLanterns(B, mats, root);
  parts.push(lan); lights.push(...lan.lights);
  shishi = buildShishi(B, mats, root, (pos) => { for (const cb of knockCbs) { try { cb(pos); } catch (e) { console.error(e); } } });
  parts.push(shishi);
  buildShrine(B, mats);
  if (IS_SPRING) ledges = buildOnsen(B, mats, root).ledges;
  B.build(root, 'arch');
  for (const l of lights) { l.visible = false; root.add(l); }
  ctx.scene.add(root);
}

export function update(dt, t, ctx) {
  if (!root) return;
  const night = U.uNight.value;
  const want = night > 0.3 ? true : night < 0.25 ? false : lightsOn;
  if (want !== lightsOn) { lightsOn = want; for (const l of lights) l.visible = want; }
  const glow = THREE.MathUtils.smoothstep(night, 0.15, 0.7);
  mats.shoji.emissiveIntensity = glow * 1.15;
  mats.glowPaper.emissiveIntensity = glow * 3.0;
  if (mats.chochin) mats.chochin.emissiveIntensity = glow * 1.6;
  for (const p of parts) p.update?.(dt, t, glow);
}

export function setPreset(name) { /* night handled via U.uNight in update() */ }

export function onKnock(cb) { knockCbs.push(cb); return () => { const i = knockCbs.indexOf(cb); if (i >= 0) knockCbs.splice(i, 1); }; }

const _fp = new THREE.Vector3();
export function getFurinPosition(target = _fp) {
  if (!tea) return target.set(0, 0, 0);
  tea.furin.updateMatrixWorld();
  return tea.furin.getWorldPosition(target);
}

// Spring only: rock ledges across the rapids that the water module's cascades pour over.
// [{ s, a:{x,z}, b:{x,z}, top (world y of the ledge top), depth, flow:{x,z} (downstream unit dir) }]; [] in autumn.
export function getLedges() { return ledges; }

export function getCausticsTargets() {
  return mats ? [mats.stone, mats.river, mats.pier] : [];
}
