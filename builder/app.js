// app.js — tools, input, UI, undo/save and the sample garden. Wires the modules together.
import * as THREE from 'three';
import {
  state, env, heights, heightAt, isWet, R, LAYER_FX, newId, uTime, chaikin, clamp, lerp,
  rotFromDir, toWorld, applySeasonMaterials, disposeGroup,
} from './core.js';
import { createRenderer } from './render.js';
import { initTerrain, getTerrainMesh, refreshTerrain, paintGround, setTerrainSeason, brush, generateGround, updateTerrain } from './terrain.js';
import { initNature, rebuildTrees, setNatureSeason, updateNature, respawnKoi, TREE_SPACING, treeRefAt } from './nature.js';
import { buildHouse, buildPagoda, buildTorii, buildWall, buildPath, buildDecor } from './builders.js';

// ---------------------------------------------------------------- setup
const view = createRenderer(document.getElementById('stage'));
const { scene, camera, controls, renderer } = view;
initTerrain(scene);
initNature(scene);

const world = new THREE.Group();     // committed structures
const preview = new THREE.Group();   // live preview while dragging
scene.add(world, preview);

const clock = new THREE.Clock();
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- tools
const TOOLS = {
  house:  { hint: 'Drag to lay out a house · Q / E rotate · big tiled footprints grow a second storey' },
  pagoda: { hint: 'Drag outward to size a pagoda — larger ones rise to five tiers' },
  torii:  { hint: 'Drag from one pillar to the other' },
  wall:   { hint: 'Draw a garden wall — where a path crosses it, a roofed gate appears' },
  path:   { hint: 'Draw a stepping-stone path — cross a pond and a red bridge arches over it' },
  tree:   { hint: 'Click to plant, hold and drag to paint a grove', brush: true },
  decor:  { hint: 'Click to place a stone lantern or rock' },
  raise:  { hint: 'Hold to raise hills', brush: true },
  pond:   { hint: 'Hold to dig — below the waterline it becomes a pond with koi', brush: true },
  smooth: { hint: 'Hold to soften the land', brush: true },
  erase:  { hint: 'Click or drag over anything to remove it', brush: true },
};
const TOOL_KEYS = ['house', 'pagoda', 'torii', 'wall', 'path', 'tree', 'decor', 'raise', 'pond', 'smooth', 'erase'];
const opts = { houseStyle: 'tile', tree: 'sakura', decor: 'lantern', brush: 2.6, rot: 0 };
let tool = 'house';

const SUBS = {
  house: [['houseStyle', [['tile', '瓦', 'Tiled roof'], ['thatch', '茅', 'Thatched']]]],
  tree: [['tree', [['sakura', '桜', 'Sakura'], ['maple', '紅葉', 'Maple'], ['pine', '松', 'Pine'], ['bamboo', '竹', 'Bamboo'], ['bush', '躑躅', 'Azalea']]]],
  decor: [['decor', [['lantern', '灯籠', 'Stone lantern'], ['rock', '石', 'Rock']]]],
};

function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  clearPreview();
  renderSub();
  updateHint();
  cursor.visible = false;
}
function renderSub() {
  const el = $('sub');
  el.innerHTML = '';
  for (const [key, items] of SUBS[tool] || []) {
    for (const [val, k, label] of items) {
      const b = document.createElement('button');
      b.className = 'chip' + (opts[key] === val ? ' on' : '');
      b.innerHTML = `<b>${k}</b>${label}`;
      b.onclick = () => { opts[key] = val; renderSub(); };
      el.appendChild(b);
    }
  }
  if (TOOLS[tool].brush) {
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = 'Brush';
    const r = document.createElement('input');
    Object.assign(r, { type: 'range', min: 0.8, max: 6, step: 0.1, value: opts.brush });
    r.oninput = () => { opts.brush = +r.value; };
    el.append(l, r);
  }
}
function updateHint() { $('hint').textContent = TOOLS[tool].hint; }

document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

// ---------------------------------------------------------------- building / rebuilding
const seen = new Set();
const pops = [];
let quiet = true; // no pop animations while loading

function rebuildStructures() {
  for (const c of [...world.children]) { world.remove(c); disposeGroup(c); }
  const add = (g, key) => {
    if (!g) return;
    world.add(g);
    if (!seen.has(key)) {
      seen.add(key);
      if (!quiet) { g.scale.setScalar(0.001); pops.push({ g, t0: clock.elapsedTime }); }
    }
  };
  for (const p of state.paths) add(buildPath(p), 'p' + p.id);
  for (const w of state.walls) add(buildWall(w, state.paths), 'w' + w.id);
  for (const h of state.houses) add(buildHouse(h), 'h' + h.id);
  for (const p of state.pagodas) add(buildPagoda(p), 'g' + p.id);
  for (const t of state.toriis) add(buildTorii(t), 't' + t.id);
  for (const d of state.decor) add(buildDecor(d), 'd' + d.id);
}
function rebuildAll() {
  refreshTerrain();
  paintGround();
  rebuildStructures();
  rebuildTrees();
  respawnKoi();
}
function clearPreview() {
  for (const c of [...preview.children]) { preview.remove(c); disposeGroup(c); }
}
function showPreview(g) { clearPreview(); if (g) preview.add(g); }

// ---------------------------------------------------------------- undo / redo / save
const undoStack = [], redoStack = [];
const snapshot = () => ({ h: heights.slice(), o: JSON.stringify(state) });
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}
function restore(s) {
  heights.set(s.h);
  const o = JSON.parse(s.o);
  for (const k of Object.keys(state)) state[k] = o[k];
  rebuildAll();
  scheduleSave();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); tok(0.8); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); tok(1.1); }

const SAVE_KEY = 'hakoniwa-v1';
let saveTimer = 0;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); }
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      h: Array.from(heights, v => Math.round(v * 1000)),
      s: state,
      env: { season: env.season, time: env.time },
    }));
  } catch (e) { /* storage full or blocked — the garden still works */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d.h || d.h.length !== heights.length) return false;
    for (let i = 0; i < heights.length; i++) heights[i] = d.h[i] / 1000;
    for (const k of Object.keys(state)) if (d.s[k] !== undefined) state[k] = d.s[k];
    if (d.env) { env.season = d.env.season || env.season; env.time = d.env.time ?? env.time; }
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- sound (soft wooden "tok")
let audio = null, soundOn = true;
function tok(pitch = 1, vol = 0.12) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain(), f = audio.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(260 * pitch, t + 0.09);
    f.type = 'lowpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(f).connect(g).connect(audio.destination);
    o.start(t); o.stop(t + 0.18);
  } catch (e) { /* audio unavailable */ }
}

// ---------------------------------------------------------------- picking & cursor
const canvas = renderer.domElement;
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lastPointer = null;

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function groundHit() {
  for (const hit of ray.intersectObject(getTerrainMesh(), false)) {
    if (Math.hypot(hit.point.x, hit.point.z) <= R - 0.2) return hit.point.clone();
  }
  return null;
}
function refAt() {
  for (const hit of ray.intersectObjects(world.children, true)) {
    let o = hit.object;
    while (o && !o.userData.ref) o = o.parent;
    if (o) return o.userData.ref;
  }
  return null;
}

const cursor = (() => {
  const n = 72;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: '#fff7e8', transparent: true, opacity: 0.9, depthTest: false }));
  l.renderOrder = 20; l.layers.set(LAYER_FX); l.visible = false; l.frustumCulled = false;
  l.userData.n = n;
  scene.add(l);
  return l;
})();
function placeCursor(p, radius) {
  if (!p) { cursor.visible = false; return; }
  const a = cursor.geometry.attributes.position, n = cursor.userData.n;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, x = p.x + Math.cos(t) * radius, z = p.z + Math.sin(t) * radius;
    a.setXYZ(i, x, heightAt(x, z) + 0.06, z);
  }
  a.needsUpdate = true;
  cursor.visible = true;
}

// ---------------------------------------------------------------- tool actions
let drag = null; // { start, cur, pts, moved, undoPushed, lastPlant }
let spaceHeld = false;
const brushOps = { raise: 'raise', pond: 'pond', smooth: 'smooth' };

function houseFromDrag(a, b, moved) {
  const rot = opts.rot;
  if (!moved) return { x: a.x, z: a.z, w: 4, d: 3.2, rot, style: opts.houseStyle };
  const dx = b.x - a.x, dz = b.z - a.z;
  const lx = dx * Math.cos(rot) - dz * Math.sin(rot);
  const lz = dx * Math.sin(rot) + dz * Math.cos(rot);
  const w = clamp(Math.abs(lx), 2.6, 10), d = clamp(Math.abs(lz), 2.4, 8);
  const [x, z] = toWorld(a.x, a.z, rot, Math.sign(lx || 1) * w / 2, Math.sign(lz || 1) * d / 2);
  return { x, z, w, d, rot, style: opts.houseStyle };
}
function pagodaFromDrag(a, b, moved) {
  const size = moved ? clamp(Math.hypot(b.x - a.x, b.z - a.z) * 1.4, 2.6, 5.5) : 3.4;
  return { x: a.x, z: a.z, size };
}
function toriiFromDrag(a, b, moved) {
  if (!moved || Math.hypot(b.x - a.x, b.z - a.z) < 0.8) {
    // face the camera
    const vx = controls.target.x - camera.position.x, vz = controls.target.z - camera.position.z;
    return { x: a.x, z: a.z, w: 2.6, rot: rotFromDir(-vz, vx) };
  }
  const w = clamp(Math.hypot(b.x - a.x, b.z - a.z), 1.6, 5);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, w, rot: rotFromDir(b.x - a.x, b.z - a.z) };
}
const TEMP_ID = -1;

function onDown(p) {
  drag = { start: p, cur: p, pts: [[p.x, p.z]], moved: false, undoPushed: false, lastPlant: 0 };
  switch (tool) {
    case 'raise': case 'pond': case 'smooth':
      pushUndo(); drag.undoPushed = true; break;
    case 'tree':
      pushUndo(); drag.undoPushed = true;
      plantTree(p.x, p.z, true);
      break;
    case 'decor': {
      if (isWet(p.x, p.z)) break;
      pushUndo();
      const rock = opts.decor === 'rock';
      state.decor.push({ id: newId(), type: opts.decor, x: p.x, z: p.z, r: Math.random() * Math.PI * 2, s: rock ? 0.7 + Math.random() * 0.7 : 1 });
      rebuildStructures(); tok(rock ? 0.7 : 1.2); scheduleSave();
      break;
    }
    case 'erase': eraseHere(); break;
    case 'house': showPreview(buildHouse({ id: TEMP_ID, ...houseFromDrag(p, p, false) })); break;
    case 'pagoda': showPreview(buildPagoda({ id: TEMP_ID, ...pagodaFromDrag(p, p, false) })); break;
    case 'torii': showPreview(buildTorii({ id: TEMP_ID, ...toriiFromDrag(p, p, false) })); break;
  }
}

function onMove(p) {
  if (!drag) return;
  drag.cur = p;
  if (Math.hypot(p.x - drag.start.x, p.z - drag.start.z) > 0.35) drag.moved = true;
  switch (tool) {
    case 'house': showPreview(buildHouse({ id: TEMP_ID, ...houseFromDrag(drag.start, p, drag.moved) })); break;
    case 'pagoda': showPreview(buildPagoda({ id: TEMP_ID, ...pagodaFromDrag(drag.start, p, drag.moved) })); break;
    case 'torii': showPreview(buildTorii({ id: TEMP_ID, ...toriiFromDrag(drag.start, p, drag.moved) })); break;
    case 'path': case 'wall': {
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.z - last[1]) < 0.45) break;
      drag.pts.push([p.x, p.z]);
      if (tool === 'path') paintGround([{ id: TEMP_ID, pts: drag.pts, w: 1.3 }]);
      else showPreview(buildWall({ id: TEMP_ID, pts: drag.pts }, state.paths));
      break;
    }
    case 'erase': eraseHere(); break;
  }
}

function onUp() {
  if (!drag) return;
  const { start, cur, moved } = drag;
  let built = false;
  switch (tool) {
    case 'house': pushUndo(); state.houses.push({ id: newId(), ...houseFromDrag(start, cur, moved) }); built = true; break;
    case 'pagoda': pushUndo(); state.pagodas.push({ id: newId(), ...pagodaFromDrag(start, cur, moved) }); built = true; break;
    case 'torii': pushUndo(); state.toriis.push({ id: newId(), ...toriiFromDrag(start, cur, moved) }); built = true; break;
    case 'path': case 'wall': {
      const pts = chaikin(drag.pts, 2);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len > 1.2) {
        pushUndo();
        const rounded = pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]);
        if (tool === 'path') state.paths.push({ id: newId(), pts: rounded, w: 1.3 });
        else state.walls.push({ id: newId(), pts: rounded });
        built = true;
      }
      paintGround();
      break;
    }
    case 'raise': case 'pond': case 'smooth':
      rebuildStructures(); rebuildTrees(); respawnKoi(); scheduleSave();
      break;
    case 'tree': case 'erase': scheduleSave(); break;
  }
  clearPreview();
  if (built) { rebuildStructures(); tok(tool === 'pagoda' ? 0.75 : 1); scheduleSave(); }
  drag = null;
}

function plantTree(x, z, exact) {
  const type = opts.tree;
  const sp = TREE_SPACING[type] || 1.5;
  if (!exact) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * opts.brush;
    x += Math.cos(a) * r; z += Math.sin(a) * r;
  }
  if (Math.hypot(x, z) > R - 0.6 || isWet(x, z)) return false;
  for (const t of state.trees) {
    const need = Math.min(sp, TREE_SPACING[t.type] || 1.5) * 0.85;
    if ((t.x - x) ** 2 + (t.z - z) ** 2 < need * need) return false;
  }
  const scale = { sakura: [0.85, 1.25], maple: [0.85, 1.15], pine: [0.8, 1.15], bamboo: [0.85, 1.15], bush: [0.8, 1.25] }[type] || [0.9, 1.1];
  state.trees.push({ id: newId(), type, x: +x.toFixed(2), z: +z.toFixed(2), s: +lerp(scale[0], scale[1], Math.random()).toFixed(2), r: +(Math.random() * Math.PI * 2).toFixed(2) });
  rebuildTrees();
  tok(1.4 + Math.random() * 0.3, 0.05);
  return true;
}

function removeRef(kind, id) {
  if (!drag.undoPushed) { pushUndo(); drag.undoPushed = true; }
  state[kind] = state[kind].filter(o => o.id !== id);
  tok(0.6, 0.08);
}
function eraseHere() {
  const ref = refAt();
  if (ref) {
    removeRef(ref.kind, ref.id);
    rebuildStructures();
    if (ref.kind === 'paths') paintGround();
    return;
  }
  const p = groundHit();
  if (!p) return;
  const tid = treeRefAt(p.x, p.z, Math.max(0.7, opts.brush * 0.45));
  if (tid != null) { removeRef('trees', tid); rebuildTrees(); return; }
  for (const path of state.paths) {
    const hw = (path.w || 1.3) / 2 + 0.2;
    for (const [x, z] of path.pts) {
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < hw * hw) {
        removeRef('paths', path.id); paintGround(); rebuildStructures(); return;
      }
    }
  }
}

// ---------------------------------------------------------------- pointer input
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || spaceHeld) return;
  lastPointer = e;
  setRay(e);
  const p = groundHit();
  if (!p && tool !== 'erase') return;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capturable pointer */ }
  onDown(p || new THREE.Vector3());
});
canvas.addEventListener('pointermove', (e) => {
  lastPointer = e;
  setRay(e);
  const p = groundHit();
  if (TOOLS[tool].brush) placeCursor(p, opts.brush);
  else if (['house', 'pagoda', 'torii', 'decor', 'path', 'wall'].includes(tool) && !drag) placeCursor(p, 0.35);
  else cursor.visible = false;
  if (drag && (p || tool === 'erase')) onMove(p || drag.cur);
});
window.addEventListener('pointerup', (e) => { if (e.button === 0) onUp(); });
canvas.addEventListener('pointerleave', () => { if (!drag) cursor.visible = false; });

// ---------------------------------------------------------------- keyboard
const panKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; return; }
  const n = '1234567890-'.indexOf(e.key);
  if (n >= 0 && TOOL_KEYS[n]) { setTool(TOOL_KEYS[n]); return; }
  if (k === 'q' || k === 'e') {
    opts.rot += (k === 'q' ? 1 : -1) * Math.PI / 12;
    if (drag && tool === 'house') onMove(drag.cur);
    return;
  }
  if (k === 'h') { document.body.classList.toggle('zen'); return; }
  if (k === 'p') { takePhoto(); return; }
  if (k === '[') { opts.brush = clamp(opts.brush - 0.3, 0.8, 6); renderSub(); return; }
  if (k === ']') { opts.brush = clamp(opts.brush + 0.3, 0.8, 6); renderSub(); return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) panKeys.add(k);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceHeld = false; controls.mouseButtons.LEFT = null; }
  panKeys.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => { panKeys.clear(); spaceHeld = false; controls.mouseButtons.LEFT = null; });

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
function keyPan(dt) {
  if (!panKeys.size) return;
  camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
  _right.crossVectors(_fwd, camera.up).normalize();
  const s = dt * camera.position.distanceTo(controls.target) * 0.6;
  const move = new THREE.Vector3();
  if (panKeys.has('w') || panKeys.has('arrowup')) move.add(_fwd);
  if (panKeys.has('s') || panKeys.has('arrowdown')) move.sub(_fwd);
  if (panKeys.has('d') || panKeys.has('arrowright')) move.add(_right);
  if (panKeys.has('a') || panKeys.has('arrowleft')) move.sub(_right);
  move.multiplyScalar(s);
  controls.target.add(move); camera.position.add(move);
}

// ---------------------------------------------------------------- environment UI
function setSeason(s) {
  env.season = s;
  document.querySelectorAll('#seasons button').forEach(b => b.classList.toggle('on', b.dataset.season === s));
  applySeasonMaterials(s);
  setTerrainSeason(s);
  setNatureSeason(s);
  scheduleSave();
}
document.querySelectorAll('#seasons button').forEach(b => b.addEventListener('click', () => { setSeason(b.dataset.season); tok(1.2, 0.06); }));

const KANJI_TIME = (h) => h < 4.5 ? '夜' : h < 7 ? '暁' : h < 11 ? '朝' : h < 15 ? '昼' : h < 18 ? '午後' : h < 20 ? '夕' : '夜';
function syncTimeLabel() {
  const h = Math.floor(env.time) % 24, m = Math.floor((env.time % 1) * 60);
  $('timeLabel').textContent = `${KANJI_TIME(env.time)}  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
$('time').addEventListener('input', (e) => { env.time = +e.target.value; syncTimeLabel(); scheduleSave(); });
$('mini').addEventListener('change', (e) => { env.mini = e.target.checked; });
$('blur').addEventListener('input', (e) => { env.blur = +e.target.value; });
$('undo').onclick = undo;
$('redo').onclick = redo;
$('photo').onclick = () => takePhoto();
$('sound').onclick = () => { soundOn = !soundOn; $('sound').classList.toggle('off', !soundOn); };
$('sample').onclick = () => { pushUndo(); loadSample(); rebuildAll(); scheduleSave(); tok(1); };
$('clear').onclick = () => {
  pushUndo();
  for (const k of ['houses', 'pagodas', 'toriis', 'walls', 'paths', 'trees', 'decor']) state[k] = [];
  generateGround(Math.floor(Math.random() * 1000));
  rebuildAll(); scheduleSave(); tok(0.7);
};
$('sideToggle').onclick = () => $('side').classList.toggle('open');

function takePhoto() {
  const cursorWas = cursor.visible;
  cursor.visible = false;
  const url = view.screenshot();
  cursor.visible = cursorWas;
  const a = document.createElement('a');
  const d = new Date();
  a.download = `hakoniwa-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.png`;
  a.href = url;
  a.click();
  tok(1.6, 0.08);
}

// ---------------------------------------------------------------- sample garden
function loadSample() {
  for (const k of ['houses', 'pagodas', 'toriis', 'walls', 'paths', 'trees', 'decor']) state[k] = [];
  state.nextId = 1;
  generateGround(7);
  // koi pond (two overlapping digs make it an oval) and a hill for the pagoda
  for (let i = 0; i < 40; i++) { brush('pond', 2.2, 2.6, 3.8, 0.05); brush('pond', 5.4, 2.4, 3.4, 0.05); }
  for (let i = 0; i < 30; i++) brush('pond', 7.6, 6.6, 3.3, 0.05);
  for (let i = 0; i < 26; i++) brush('raise', -11, -7.5, 5.5, 0.05);
  for (let i = 0; i < 4; i++) { brush('smooth', 4.5, 4, 7, 0.05); brush('smooth', -11, -7.5, 6.5, 0.05); }
  for (let i = 0; i < 30; i++) brush('flatten', -11, -7.6, 3.6, 0.05); // level the pagoda's hilltop

  const P = (pts, w = 1.3) => state.paths.push({ id: newId(), pts: chaikin(pts, 2).map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]), w });
  P([[-5.8, 10.6], [-5.4, 8.6], [-4.4, 6.4], [-2.6, 4.2], [0, 3], [3.6, 2.6], [7.2, 2.3], [10.2, 1.2], [12.8, -1.4], [14, -4.6]]);
  P([[-1.8, 3.6], [-3.2, 0.4], [-5.4, -2.4], [-7.8, -4.6], [-9.4, -5.9]]);
  state.walls.push({ id: newId(), pts: chaikin([[-13.5, 8.0], [-9.5, 7.6], [-5.2, 7.4], [-1.4, 7.9], [1.4, 9.2]], 2) });

  state.houses.push({ id: newId(), x: -6, z: 13, w: 5.2, d: 3.4, rot: Math.PI, style: 'tile' });
  state.houses.push({ id: newId(), x: 12.4, z: -8.8, w: 4.2, d: 3.2, rot: 0.6, style: 'thatch' });
  state.houses.push({ id: newId(), x: -15.2, z: 2.6, w: 3.4, d: 2.8, rot: -1.25, style: 'tile' });
  state.pagodas.push({ id: newId(), x: -11, z: -7.6, size: 4.3 });

  const tor = (x, z, dx, dz) => state.toriis.push({ id: newId(), x, z, w: 2.4, rot: rotFromDir(dz, -dx) });
  tor(-4.3, -1.0, -2.2, -2.8);
  tor(-6.6, -3.5, -2.4, -2.2);

  const T = (type, x, z, s = 1) => { if (!isWet(x, z)) state.trees.push({ id: newId(), type, x, z, s, r: (x * 7.3 + z * 3.1) % 6.28 }); };
  [[-1, 11.5, 1.1], [3.4, 13.6, 1], [-9.8, 3.8, 1.15], [11.4, 10.6, 1.05], [-15, 9.4, 0.95], [-12.5, 12.5, 1]].forEach(([x, z, s]) => T('sakura', x, z, s));
  [[8.2, -5.8, 1], [13.4, 4.2, 1.05], [-2.2, -7.2, 1], [4, -10.4, 0.95], [16, -1, 0.9]].forEach(([x, z, s]) => T('maple', x, z, s));
  [[-0.8, 6.2, 1], [-14.6, -3.4, 1.05], [-7.4, -12, 1], [1.4, -3.6, 0.9], [-12.6, -11.4, 0.9], [12.2, 7.2, 0.9]].forEach(([x, z, s]) => T('pine', x, z, s));
  for (let i = 0; i < 11; i++) { const a = i * 2.39996, r = 0.6 + Math.sqrt(i) * 0.75; T('bamboo', -2.5 + Math.cos(a) * r, -15.2 + Math.sin(a) * r, 0.9 + (i % 3) * 0.08); }
  [[0.4, 5.4], [9, -0.6], [-1.6, 0.6], [4.2, -1.4], [-8.2, 9.8], [-3.4, 10.4], [-13.4, -6], [4.4, 9.8], [10.8, 4.6], [2, 8.4], [7.4, 10.6]].forEach(([x, z], i) => T('bush', x, z, 0.85 + (i % 3) * 0.12));

  const D = (type, x, z, s = 1) => state.decor.push({ id: newId(), type, x, z, r: x * 1.7 + z, s });
  D('lantern', -3.7, 5.2); D('lantern', 10.6, 3.4); D('lantern', -8.6, -3.8); D('lantern', 9.6, 8.8);
  D('rock', 7.8, 4.2, 0.9); D('rock', 0.8, 0.2, 0.75); D('rock', -13, -4.6, 1.2); D('rock', 5.6, 9.6, 1); D('rock', 10.4, 6.4, 0.7);
}

// ---------------------------------------------------------------- boot
if (!load()) { loadSample(); env.season = 'spring'; env.time = 16.2; }
$('time').value = env.time;
syncTimeLabel();
$('mini').checked = env.mini;
$('blur').value = env.blur;
setSeason(env.season);
rebuildAll();
setTool('house');
quiet = false;

const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  uTime.value = t;

  if ($('flow').checked) {
    env.time = (env.time + dt * 0.1) % 24;
    $('time').value = env.time;
    syncTimeLabel();
  }

  if (drag && brushOps[tool] && lastPointer) {
    setRay(lastPointer);
    const p = groundHit();
    if (p) {
      drag.cur = p;
      if (brush(brushOps[tool], p.x, p.z, opts.brush, dt)) refreshTerrain();
      placeCursor(p, opts.brush);
    }
  }
  if (drag && tool === 'tree' && drag.moved && t - drag.lastPlant > 0.06) {
    drag.lastPlant = t;
    plantTree(drag.cur.x, drag.cur.z, false);
  }

  for (let i = pops.length - 1; i >= 0; i--) {
    const { g, t0 } = pops[i];
    const k = Math.min((t - t0) / 0.45, 1);
    const s = Math.max(0.001, easeOutBack(k));
    g.scale.set(lerp(0.4, 1, s), s, lerp(0.4, 1, s));
    if (k >= 1) { g.scale.setScalar(1); pops.splice(i, 1); }
  }

  keyPan(dt);
  updateTerrain(dt);
  updateNature(dt, t);
  view.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => {
  frame();
  setTimeout(() => $('loading').classList.add('done'), 150);
});
window.addEventListener('beforeunload', save);

// Handy for poking at the garden from the devtools console.
window.hakoniwa = { view, state, env, setSeason, setTool, rebuildAll, loadSample };
