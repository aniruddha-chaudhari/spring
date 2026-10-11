// dev.js — a plain test harness: simple lighting, a basic terrain from world.groundHeight, anchor markers.
// Loads feature modules given in ?m=water,vegetation and drives their init/update/beforeRender.
// window.dev = { renderer, scene, camera, controls, sun, cap(name, w, h) } for console poking.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { groundHeight, WATER_Y, ANCHORS, U, LAYER_REFRACT, loadTex, isWater } from './world.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9c0d0');
scene.fog = new THREE.Fog('#a9c0d0', 90, 300);
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(42, 34, 48);
camera.layers.enable(LAYER_REFRACT);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight('#cfe0ff', '#5a4a30', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd7a8', 3.2);
sun.position.set(40, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
U.uSunDir.value.copy(sun.position).normalize();
U.uSunColor.value.set('#ffd7a8').multiplyScalar(3.2);

// basic terrain (inner detail + outer ring)
function terrainMesh(size, seg, mat) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundHeight(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.layers.enable(LAYER_REFRACT);
  return m;
}
const grassMat = new THREE.MeshStandardMaterial({ map: loadTex('leafy_grass', 'diff', { repeat: [24, 24] }), roughness: 1 });
scene.add(terrainMesh(100, 300, grassMat));
const outer = terrainMesh(520, 220, new THREE.MeshStandardMaterial({ color: '#6f7a4a', roughness: 1 }));
outer.position.y = -0.05;
scene.add(outer);

const params = new URLSearchParams(location.search);
const mods = (params.get('m') || '').split(',').filter(Boolean);
const noWater = mods.includes('water');
if (!noWater) {
  const water = new THREE.Mesh(new THREE.PlaneGeometry(520, 520).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#2f7d86', transparent: true, opacity: 0.7, roughness: 0.1 }));
  water.position.y = WATER_Y;
  scene.add(water);
}

// anchor markers (hidden with ?markers=0)
if (params.get('markers') !== '0') {
  const mk = (color, w, h, d, x, z, rot = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55 }));
    m.position.set(x, groundHeight(x, z) + h / 2, z); m.rotation.y = rot; scene.add(m); return m;
  };
  const t = ANCHORS.teahouse; mk('#c08040', t.w, 3, t.d, t.x, t.z, t.rot);
  const b = ANCHORS.bridge; const bm = mk('#c03020', b.span, 0.4, b.width, b.x, b.z, b.rot); bm.position.y = 1;
  mk('#ffffff', 1.5, 2, 1.5, ANCHORS.shrine.x, ANCHORS.shrine.z, ANCHORS.shrine.rot);
  mk('#e04030', ANCHORS.torii.w, 3, 0.3, ANCHORS.torii.x, ANCHORS.torii.z, ANCHORS.torii.rot);
  for (const l of ANCHORS.lanterns) mk('#ffe080', 0.5, 1.6, 0.5, l.x, l.z);
  for (const r of ANCHORS.rocks) mk('#888888', r.s * 1.6, r.s, r.s * 1.4, r.x, r.z, r.rot);
  for (const s of ANCHORS.steppingStones) { const m = mk('#aaaaaa', s.r * 2, 0.25, s.r * 2, s.x, s.z); m.position.y = WATER_Y + 0.1; }
  for (const tr of ANCHORS.trees) mk({ maple: '#d03020', pine: '#2f5030', ginkgo: '#e0c030', cedar: '#30402a' }[tr.type], 0.6, 6 * tr.s, 0.6, tr.x, tr.z);
  for (const p of ANCHORS.paths) {
    const pts = p.pts.map(([x, z]) => new THREE.Vector3(x, groundHeight(x, z) + 0.1, z));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff' })));
  }
}

const ctx = { renderer, scene, camera, controls, sun, hemi };
const loaded = [];
for (const m of mods) {
  try {
    const mod = await import(`./${m}.js`);
    await mod.init?.(ctx);
    loaded.push(mod);
  } catch (e) { console.error('module failed', m, e); document.getElementById('info').textContent += ` [${m} failed: ${e.message}]`; }
}
document.getElementById('info').textContent += ` modules: ${mods.join(', ') || '(none)'}`;

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  U.uTime.value = t;
  controls.update();
  for (const m of loaded) m.update?.(dt, t, ctx);
  for (const m of loaded) m.beforeRender?.(ctx);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// cap('name.png', 1440, 900): render at that size and POST it to the local capture server (writes to the scratchpad).
async function cap(name, w = 1440, h = 900) {
  const ow = innerWidth, oh = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const m of loaded) m.beforeRender?.(ctx);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setSize(ow, oh); camera.aspect = ow / oh; camera.updateProjectionMatrix();
  await fetch('http://127.0.0.1:5181/' + name, { method: 'POST', body: url });
  return name;
}
window.dev = { ...ctx, cap, THREE, groundHeight, isWater, mods: loaded, U };

// Headless capture options: ?cam=x,y,z &target=x,y,z &sun=x,y,z &js=<urlencoded async JS run before the shot>
// &shot=name.png &w=1440 &h=900 &delay=5000  -> renders, POSTs the PNG to the capture server, sets document.title='SHOT-DONE'.
{
  const vec = (s) => s && s.split(',').map(Number);
  if (vec(params.get('cam'))) camera.position.set(...vec(params.get('cam')));
  if (vec(params.get('target'))) controls.target.set(...vec(params.get('target')));
  if (vec(params.get('sun'))) { sun.position.set(...vec(params.get('sun'))); U.uSunDir.value.copy(sun.position).normalize(); }
  controls.update();
  if (params.get('js')) {
    try { await (new Function('dev', `return (async () => { ${params.get('js')} })()`))(window.dev); }
    catch (e) { console.error('js param failed', e); }
  }
  if (params.get('shot')) {
    setTimeout(async () => {
      await cap(params.get('shot'), +params.get('w') || 1440, +params.get('h') || 900);
      document.title = 'SHOT-DONE';
    }, +params.get('delay') || 5000);
  }
}
