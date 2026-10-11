// main.js — boots the view, loads the feature modules, runs the frame loop and the small UI.
//
// Seasons: each page load builds ONE season (world.js SEASON, default spring). Once it is up, the page downloads
// the other season's files into the browser cache in the background (nothing is built or kept in memory), so
// switching season is a quick reload that keeps the camera angle and time of day.
import * as THREE from 'three';
import { U, env, SEASON, IS_SPRING, TEXTURES, TEX_BASE } from './world.js';
import { createView } from './render.js';
import * as terrain from './terrain.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get('preset')) env.preset = params.get('preset');

// loading progress (textures go through the default manager)
THREE.DefaultLoadingManager.onProgress = (url, n, total) => { $('loadBar').style.width = `${Math.round((n / total) * 100)}%`; };

const view = createView($('stage'));
const ctx = { renderer: view.renderer, scene: view.scene, camera: view.camera, controls: view.controls, view };

// Feature modules are optional: if one is missing or throws, the rest of the scene still runs.
const MODULES = ['architecture', 'vegetation', 'water', 'life'];
const LOAD_TEXT = IS_SPRING
  ? { architecture: 'Raising the teahouse…', vegetation: 'Opening the cherry blossoms…', water: 'Warming the spring…', life: 'Waking the butterflies…' }
  : { architecture: 'Raising the teahouse…', vegetation: 'Growing the maples…', water: 'Filling the stream…', life: 'Waking the dragonflies…' };
const mods = {};
async function boot() {
  await terrain.init(ctx);
  for (const name of MODULES) {
    try {
      $('loadText').textContent = LOAD_TEXT[name];
      await new Promise(r => setTimeout(r, 0));
      // retry once: a dropped connection while fetching a module shouldn't cost a whole part of the scene
      const m = await import(`./${name}.js`).catch(() => new Promise(r => setTimeout(r, 600)).then(() => import(`./${name}.js?retry=1`)));
      await m.init?.(ctx);
      mods[name] = m;
    } catch (e) {
      console.warn(`[hakoniwa] module "${name}" not loaded:`, e);
    }
  }
  // cross-module wiring
  if (mods.water?.applyCaustics) {
    mods.water.applyCaustics(terrain.getTerrainMaterial());
    for (const m of mods.architecture?.getCausticsTargets?.() || []) mods.water.applyCaustics(m);
  }
  if (mods.architecture?.onKnock && mods.life?.knock) mods.architecture.onKnock(() => mods.life.knock());

  setPreset(env.preset);
  view.snapPreset?.();
  requestAnimationFrame(frame);
  setTimeout(() => $('loading').classList.add('done'), 400);
}

function setPreset(name) {
  env.preset = name;
  view.setPreset(name);
  for (const m of Object.values(mods)) m.setPreset?.(name);
  markOn('presets', 'preset', name);
}

// segmented control: mark the active button and slide the highlight under it
function markOn(groupId, key, value) {
  const group = $(groupId);
  let active = null;
  group.querySelectorAll('button').forEach(b => {
    const on = b.dataset[key] === value;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
    if (on) active = b;
  });
  const thumb = group.querySelector('.thumb');
  if (active && thumb) {
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
    requestAnimationFrame(() => group.classList.add('ready'));
  }
}

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  U.uTime.value = t;
  view.update(dt);
  for (const m of Object.values(mods)) m.update?.(dt, t, ctx);
  for (const m of Object.values(mods)) m.beforeRender?.(ctx);
  view.render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- seasons
// After this season is up, download everything the other season needs into the HTTP cache. Every code module is
// shared and already loaded, so that means the textures; the fetches run one at a time at low priority and nothing
// is decoded, built or kept in memory.
async function prefetchOtherSeason() {
  const urls = [];
  for (const id of TEXTURES) urls.push(`${TEX_BASE}${id}_diff.jpg`, `${TEX_BASE}${id}_nor.jpg`);
  urls.push(`${TEX_BASE}mossy_rock_rough.jpg`);
  for (const url of urls) {
    try { await fetch(url, { priority: 'low' }); } catch (e) { /* offline: the reload will fetch it */ }
  }
}

// Switching reloads the page with the other season (served from the cache), keeping the view and time of day.
const CAM_KEY = 'hakoniwa-camera';
function switchSeason(target) {
  if (target === SEASON) return;
  markOn('seasons', 'season', target);
  try { sessionStorage.setItem(CAM_KEY, JSON.stringify(view.controls.getState())); } catch (e) { /* storage blocked */ }
  const q = new URLSearchParams(location.search);
  q.set('season', target);
  q.set('preset', env.preset);
  $('loading').classList.remove('done');      // fade the loading screen back in, then reload behind it
  setTimeout(() => { location.search = q.toString(); }, 450);
}
// restore the camera handed over by a season switch (one-shot)
try {
  const saved = sessionStorage.getItem(CAM_KEY);
  if (saved) { sessionStorage.removeItem(CAM_KEY); view.controls.setState(JSON.parse(saved)); }
} catch (e) { /* bad or blocked storage: keep the default view */ }

// ---------------------------------------------------------------- UI
document.title = IS_SPRING ? 'Hakoniwa · Spring Blossoms' : 'Hakoniwa · Autumn Stream';
$('loadText').textContent = IS_SPRING ? 'Opening the cherry blossoms…' : 'Gathering fallen leaves…';
document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', () => setPreset(b.dataset.preset)));
markOn('seasons', 'season', SEASON);
document.querySelectorAll('#seasons button').forEach(b => b.addEventListener('click', () => switchSeason(b.dataset.season)));
// keep the highlights aligned when fonts load or the window resizes
const realign = () => { markOn('seasons', 'season', SEASON); markOn('presets', 'preset', env.preset); };
window.addEventListener('resize', realign);
document.fonts?.ready.then(realign);
// the controls hint fades after a while, or as soon as the camera is used
const hideHint = () => $('hint').classList.add('gone');
setTimeout(hideHint, 9000);
view.renderer.domElement.addEventListener('pointerdown', () => setTimeout(hideHint, 1500), { once: true });
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0) setPreset(view.presets[i]);
  if (e.key.toLowerCase() === 'h') document.body.classList.toggle('hide-ui');
});

// ---------------------------------------------------------------- URL options (also used for headless screenshots)
// ?season=autumn  ?preset=night  ?cam=x,y,z  ?target=x,y,z  ?ui=0  ?shot=name.png&w=1600&h=1000&delay=8000
const vec = (s) => s && s.split(',').map(Number);
if (vec(params.get('cam')) || vec(params.get('target'))) {
  if (vec(params.get('cam'))) view.camera.position.set(...vec(params.get('cam')));
  view.controls.syncFromCamera(vec(params.get('target')) ? new THREE.Vector3(...vec(params.get('target'))) : undefined);
}
if (params.get('ui') === '0') document.body.classList.add('hide-ui');
// ?js= runs code from the URL and ?shot= posts frames to a local capture server: development tools only, so they
// are ignored anywhere but this machine (otherwise a crafted link could run script on the deployed site).
const DEV_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const HEADLESS = DEV_HOST && (params.has('shot') || params.has('js'));

async function capture(name, w = 1600, h = 1000) {
  const st = $('stage');
  st.style.width = w + 'px'; st.style.height = h + 'px';
  view.resize();
  for (let i = 0; i < 4; i++) { frame.once(); }
  const url = view.renderer.domElement.toDataURL('image/png');
  st.style.width = ''; st.style.height = '';
  view.resize();
  await fetch('http://127.0.0.1:5181/' + name, { method: 'POST', body: url });
  return name;
}
frame.once = () => {
  const dt = 1 / 60;
  U.uTime.value += dt;
  view.update(dt);
  for (const m of Object.values(mods)) m.update?.(dt, U.uTime.value, ctx);
  for (const m of Object.values(mods)) m.beforeRender?.(ctx);
  view.render(dt);
};

// handy for the devtools console
const hk = window.hakoniwa = { view, mods, setPreset, switchSeason, U, env, capture, ready: false };

boot().then(async () => {
  hk.ready = true;
  // once this season is up and settled, download the other season's files in the background
  if (!HEADLESS) setTimeout(() => { hk.prefetch = prefetchOtherSeason().then(() => { hk.prefetched = true; }); }, 3000);
  if (!DEV_HOST) return;
  // ?js=<urlencoded async JS> runs once the scene is up (debugging / headless checks); `hk` = window.hakoniwa
  if (params.get('js')) {
    await new Promise(r => setTimeout(r, +params.get('jsDelay') || 0));
    try { await (new Function('hk', 'THREE', `return (async () => { ${params.get('js')} })()`))(window.hakoniwa, THREE); }
    catch (e) { console.error('js param failed', e); }
  }
  if (!params.get('shot')) return;
  setTimeout(() => capture(params.get('shot'), +params.get('w') || 1600, +params.get('h') || 1000)
    .then(() => { document.title = 'SHOT-DONE'; }), +params.get('delay') || 8000);
});
