// life.js — everything that makes the garden feel alive: falling maple/ginkgo leaves (resting, floating downstream),
// red dragonflies, flocks, an egret, sparrows + a wagtail, koi, golden motes, fireflies, low mist + valley haze,
// and a procedural WebAudio soundscape. Implementation lives in src/life/*.
import * as THREE from 'three';
import { env } from './world.js';
import { buildGrids, setPresetTarget, stepWeights, W } from './life/common.js';
import * as leaves from './life/leaves.js';
import * as critters from './life/critters.js';
import * as koi from './life/koi.js';
import * as air from './life/air.js';
import * as audio from './life/audio.js';

let root = null;

export async function init(ctx) {
  buildGrids();
  setPresetTarget(env.preset, true);
  root = new THREE.Group();
  root.name = 'life';
  ctx.scene.add(root);
  air.init(root);
  leaves.init(root);
  koi.init(root);
  critters.init(root, { onStrike: (x, z) => audio.plop(x, z) });
}

export function update(dt, t, ctx) {
  if (!root) return;
  dt = Math.min(dt, 0.1);
  stepWeights(dt);
  leaves.update(dt, t);
  critters.update(dt, t);
  koi.update(dt, t);
  air.update(dt, t, ctx);
  audio.update(dt, t, ctx);
}

// name: 'afternoon' | 'golden' | 'blue' | 'night'. Visuals and audio crossfade over ~2–3 s; pass instant=true to snap.
export function setPreset(name, instant = false) {
  setPresetTarget(name, instant === true);
}

export const startAudio = audio.startAudio;     // call from a user gesture
export const setMuted = audio.setMuted;
export const knock = audio.knock;               // shishi-odoshi strike (wired by main.js to architecture.onKnock)
export const weights = W;                       // current crossfaded preset weights (read-only, for debugging)
