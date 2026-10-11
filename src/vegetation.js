// vegetation.js — all plants: grass, susuki, higanbana, ferns/shrubs/moss, hero + scattered trees, cedar grove,
// the endless distant forest and fallen leaves. Module contract: init(ctx), update(dt, t, ctx), setPreset(name).
//
// Draw calls (approx): grass ~63 chunks (frustum-culled), bark 3, tree leaves 1, forest tier A 9 instanced,
// tier B 8 instanced, plants 4. Everything sways via world.js WIND_GLSL and receives cloud shadows.
import * as THREE from 'three';
import { buildGrass, grassLod } from './vegetation/grass.js';
import { buildTreeSet } from './vegetation/placeTrees.js';
import { fields } from './vegetation/fields.js';
import { buildForest } from './vegetation/forest.js';
import { buildPlants } from './vegetation/plants.js';

export const stats = {};
export const group = new THREE.Group();
group.name = 'vegetation';
export { grassLod };
let grass = null, trees = null;
// Hero/scattered tree list (type, x, z, s, r, H, crown) for other modules (e.g. falling-leaf particles, birds).
export let placedTrees = [];

export async function init(ctx) {
  const t0 = performance.now();
  ctx.scene.add(group);
  const F = fields();
  trees = buildTreeSet(group, F);
  placedTrees = trees.placed;
  stats.trees = trees.stats;
  grass = buildGrass(group, F, placedTrees);
  stats.grass = grass.stats;
  const forest = buildForest(group, placedTrees);
  stats.forest = forest.stats;
  const plants = buildPlants(group, F, placedTrees, trees.leafMat);
  stats.plants = plants.stats;
  stats.buildMs = Math.round(performance.now() - t0);
  console.log('[vegetation]', JSON.stringify(stats));
}

export function update(dt, t, ctx) {
  grass?.update(ctx.camera);
}

// Lighting comes from the shared uniforms / scene lights; nothing preset-specific is needed here.
export function setPreset(name) {}
