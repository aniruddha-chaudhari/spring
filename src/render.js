// render.js — renderer, camera, sky, light presets and the post-processing stack.
// Look: soft miniature (Tiny Glade) + Ghost of Tsushima light. Linear HDR all the way to AgX tone mapping at the end.
import * as THREE from 'three';
import { CameraRig } from './camera.js';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BloomEffect, DepthOfFieldEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { U, env, LAYER_REFRACT, IS_SPRING, lerp, clamp } from './world.js';

// ---------------------------------------------------------------- presets
// az/el in degrees: azimuth measured from +X toward +Z. The default camera sits at azimuth ~49°.
const PRESETS = {
  afternoon: {
    az: 125, el: 40, sun: '#fff0d8', sunI: 3.3,
    zenith: '#4f86c6', horizon: '#cfe0ea', below: '#a9b9ae', glow: 0.35, sunSize: 0.0009,
    fog: '#b8ccd8', fogDensity: 0.0018, fogFalloff: 0.055, inscatter: 0.25,
    exposure: 1.0, bloom: 0.55, cloud: 0.42, wind: 1.0, night: 0, stars: 0, clouds: 0.45,
    tint: '#fffaf2', lift: '#000000', sat: 0.06, ao: 2.4,
  },
  golden: {
    az: 214, el: 7.5, sun: '#ffa955', sunI: 4.2,
    zenith: '#5d7fb6', horizon: '#ffc58c', below: '#c99a72', glow: 1.0, sunSize: 0.0016,
    fog: '#e9b27a', fogDensity: 0.0026, fogFalloff: 0.05, inscatter: 0.85,
    exposure: 1.05, bloom: 0.95, cloud: 0.22, wind: 1.15, night: 0, stars: 0, clouds: 0.38,
    tint: '#fff1df', lift: '#0b0503', sat: 0.12, ao: 2.2,
  },
  blue: {
    az: 250, el: 18, sun: '#8ea8ff', sunI: 0.55,
    zenith: '#1d2f5c', horizon: '#8d93bd', below: '#4a4f6d', glow: 0.15, sunSize: 0.0,
    fog: '#6878a6', fogDensity: 0.003, fogFalloff: 0.05, inscatter: 0.15,
    exposure: 1.35, bloom: 0.9, cloud: 0.0, wind: 0.7, night: 0.65, stars: 0.25, clouds: 0.3,
    tint: '#eef2ff', lift: '#03050c', sat: -0.04, ao: 2.0,
  },
  night: {
    az: 305, el: 42, sun: '#9fb4ff', sunI: 0.6,
    zenith: '#050a1a', horizon: '#18233f', below: '#0d1222', glow: 0.1, sunSize: 0.00035,
    fog: '#121a30', fogDensity: 0.0034, fogFalloff: 0.045, inscatter: 0.1,
    exposure: 1.7, bloom: 1.05, cloud: 0.0, wind: 0.6, night: 1, stars: 1, clouds: 0.22,
    tint: '#e8eeff', lift: '#02040a', sat: -0.1, ao: 1.8,
  },
};
// Spring: the Ghost of Tsushima hot-spring look — deep clear blue sky, crisp air, cool-white light; golden hour turns
// peach-pink instead of amber. Only the keys listed here change.
const SPRING = {
  afternoon: {
    az: 120, el: 52, sun: '#fff8ee', sunI: 3.5, zenith: '#2a5fae', horizon: '#bcd6ec', below: '#9fb8b0', glow: 0.25,
    fog: '#c4d8ea', fogDensity: 0.0012, inscatter: 0.15, cloud: 0.32, clouds: 0.38, tint: '#fbfdff', sat: 0.1, exposure: 1.02,
  },
  golden: {
    sun: '#ffbe8a', zenith: '#5a78b8', horizon: '#ffcfb4', below: '#c8a0a0', fog: '#efc1b0',
    fogDensity: 0.0021, tint: '#fff2ee', sat: 0.1,
  },
  blue: { zenith: '#22356a', horizon: '#a49ac4', fog: '#7c86b4' },
  night: { horizon: '#1c2a4a', fog: '#141e36' },
};
if (IS_SPRING) for (const k in SPRING) Object.assign(PRESETS[k], SPRING[k]);

const COLOR_KEYS = ['sun', 'zenith', 'horizon', 'below', 'fog', 'tint', 'lift'];
const NUM_KEYS = ['sunI', 'glow', 'sunSize', 'fogDensity', 'fogFalloff', 'inscatter', 'exposure', 'bloom', 'cloud', 'wind', 'night', 'stars', 'clouds', 'sat', 'ao'];

function makeState(p) {
  const s = {};
  for (const k of COLOR_KEYS) s[k] = new THREE.Color(p[k]);
  for (const k of NUM_KEYS) s[k] = p[k];
  s.dir = dirFromAzEl(p.az, p.el);
  return s;
}
function dirFromAzEl(az, el) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
}

// ---------------------------------------------------------------- sky
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 zenith, horizon, below, sunColor, sunDir;
uniform float glow, sunSize, stars, clouds, time, night;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(smoothstep(-0.03, 0.75, h), 0.55));
  col = mix(col, below, smoothstep(0.0, -0.3, h));
  float sd = max(dot(d, sunDir), 0.0);
  // broad warm glow around the sun + horizon band
  col += sunColor * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.5) * glow;
  col += sunColor * 0.08 * glow * exp(-abs(h) * 9.0) * pow(sd, 2.0);
  // disk (sun or moon)
  col += sunColor * smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.55, sd) * (night > 0.5 ? 2.5 : 18.0);
  // soft clouds on a dome
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.18) * 1.6 + vec2(time * 0.006, time * 0.002);
    float c = fbm(p) * 0.75 + fbm(p * 3.1) * 0.25;
    c = smoothstep(0.48, 0.82, c) * clouds * smoothstep(0.0, 0.25, h);
    vec3 lit = mix(horizon * 1.05, horizon + sunColor * 0.35, pow(sd, 3.0));
    vec3 cc = mix(lit, zenith * 0.6 + horizon * 0.5, 0.35);
    col = mix(col, cc, c);
  }
  // stars
  if (stars > 0.0 && h > 0.0) {
    vec2 sp = d.xz / (h + 1.0) * 380.0;
    float s = h21(floor(sp));
    float tw = 0.6 + 0.4 * sin(time * 2.0 + s * 50.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9965, s) * stars * tw * smoothstep(0.05, 0.35, h) * 1.4;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- atmosphere (height fog + sun in-scattering) as a post effect
const ATMOS_FRAG = /* glsl */`
uniform mat4 projInv;
uniform mat4 viewInv;
uniform vec3 fogColor;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float density;
uniform float falloff;
uniform float fogStart;
uniform float inscatter;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) { outputColor = inputColor; return; }
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = projInv * ndc; vp /= vp.w;
  vec3 wp = (viewInv * vec4(vp.xyz, 1.0)).xyz;
  vec3 camPos = (viewInv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 ray = wp - camPos;
  float dist = length(ray);
  vec3 rd = ray / dist;
  float d = max(dist - fogStart, 0.0);
  // height fog: thicker low in the valley
  float hAvg = max(mix(camPos.y, wp.y, 0.5), -1.0);
  float heightK = exp(-max(hAvg, 0.0) * falloff);
  float amt = 1.0 - exp(-d * density * (0.35 + heightK));
  float sun = pow(max(dot(rd, sunDir), 0.0), 6.0);
  vec3 fc = fogColor + sunColor * 0.12 * inscatter * sun;
  outputColor = vec4(mix(inputColor.rgb, fc, clamp(amt, 0.0, 1.0)), inputColor.a);
}`;
class AtmosphereEffect extends Effect {
  constructor() {
    super('AtmosphereEffect', ATMOS_FRAG, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
        ['viewInv', new THREE.Uniform(new THREE.Matrix4())],
        ['fogColor', new THREE.Uniform(new THREE.Color())],
        ['sunColor', new THREE.Uniform(new THREE.Color())],
        ['sunDir', new THREE.Uniform(new THREE.Vector3())],
        ['density', new THREE.Uniform(0.005)],
        ['falloff', new THREE.Uniform(0.05)],
        ['fogStart', new THREE.Uniform(40)],
        ['inscatter', new THREE.Uniform(0.3)],
      ]),
    });
  }
}

// ---------------------------------------------------------------- colour grade (display-referred, after tone mapping)
const GRADE_FRAG = /* glsl */`
uniform vec3 tint;
uniform vec3 lift;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * tint + lift * (1.0 - inputColor.rgb);
  // gentle filmic S-curve
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
  outputColor = vec4(c, inputColor.a);
}`;
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      uniforms: new Map([['tint', new THREE.Uniform(new THREE.Color(1, 1, 1))], ['lift', new THREE.Uniform(new THREE.Color(0, 0, 0))]]),
    });
  }
}

// ---------------------------------------------------------------- view
export function createView(container) {
  const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; // AgX happens in the post stack
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, container.clientWidth / container.clientHeight, 0.4, 2400);
  camera.position.set(50, 23, 57);
  camera.layers.enable(LAYER_REFRACT);

  const controls = new CameraRig(camera, renderer.domElement, { target: new THREE.Vector3(0, 0.8, 0) });

  // sky dome
  const skyU = {
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, below: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() },
    glow: { value: 1 }, sunSize: { value: 0.001 }, stars: { value: 0 }, clouds: { value: 0.4 }, time: U.uTime, night: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.onBeforeRender = (r, s, cam) => sky.position.copy(cam.position);
  scene.add(sky);

  // environment probe scene (sky + warm ground bounce) for image-based ambient light and water reflections
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
  envScene.add(envSky);
  const envGroundMat = new THREE.MeshBasicMaterial({ color: '#4a4030', side: THREE.DoubleSide });
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(95, 32).rotateX(-Math.PI / 2), envGroundMat);
  envGround.position.y = -4;
  envScene.add(envGround);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, envTimer = 0;
  function refreshEnv() {
    const prev = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.5, 300);
    scene.environment = envRT.texture;
    if (prev) prev.dispose();
  }

  // key light
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 52, bottom: -52, near: 10, far: 320 });
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);

  // ---------------------------------------------------------------- post-processing
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });
  composer.addPass(new RenderPass(scene, camera));
  const w = container.clientWidth, h = container.clientHeight;
  const ao = new N8AOPostPass(scene, camera, w, h);
  Object.assign(ao.configuration, { aoRadius: 2.2, distanceFalloff: 1.2, intensity: 2.4, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false });
  ao.configuration.color = new THREE.Color('#1c1208');
  composer.addPass(ao);
  const atmos = new AtmosphereEffect();
  composer.addPass(new EffectPass(camera, atmos));
  const dof = new DepthOfFieldEffect(camera, { worldFocusRange: 16, bokehScale: 4.2, resolutionScale: 0.6 });
  dof.target = new THREE.Vector3();
  const dofPass = new EffectPass(camera, dof);
  composer.addPass(dofPass);
  const bloom = new BloomEffect({ mipmapBlur: true, intensity: 0.6, luminanceThreshold: 0.82, luminanceSmoothing: 0.3, radius: 0.72 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const grade = new GradeEffect();
  const hueSat = new HueSaturationEffect({ saturation: 0.08 });
  const bc = new BrightnessContrastEffect({ contrast: 0.04 });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
  composer.addPass(new EffectPass(camera, bloom, tone, grade, hueSat, bc, vignette));

  // ---------------------------------------------------------------- preset blending
  const cur = makeState(PRESETS.golden);
  let target = makeState(PRESETS.golden);
  let blending = false;
  function setPreset(name) {
    if (!PRESETS[name]) return;
    env.preset = name;
    target = makeState(PRESETS[name]);
    blending = true;
  }
  function blendState(dt) {
    const k = 1 - Math.exp(-dt * 1.8);
    let delta = 0;
    for (const key of COLOR_KEYS) { cur[key].lerp(target[key], k); }
    for (const key of NUM_KEYS) { delta += Math.abs(target[key] - cur[key]); cur[key] = lerp(cur[key], target[key], k); }
    delta += cur.dir.distanceTo(target.dir);
    cur.dir.lerp(target.dir, k).normalize();
    if (delta < 0.002) blending = false;
  }
  function applyState() {
    const s = cur;
    // shared uniforms
    U.uSunDir.value.copy(s.dir);
    U.uSunColor.value.copy(s.sun).multiplyScalar(s.sunI);
    U.uNight.value = s.night;
    env.night = s.night;
    U.uCloud.value = s.cloud;
    U.uWindStrength.value = s.wind;
    // sky
    skyU.zenith.value.copy(s.zenith); skyU.horizon.value.copy(s.horizon); skyU.below.value.copy(s.below);
    skyU.sunColor.value.copy(s.sun); skyU.sunDir.value.copy(s.dir);
    skyU.glow.value = s.glow; skyU.sunSize.value = s.sunSize; skyU.stars.value = s.stars; skyU.clouds.value = s.clouds; skyU.night.value = s.night;
    envGroundMat.color.copy(s.below).multiplyScalar(0.55).lerp(new THREE.Color('#5a4630'), 0.4 * (1 - s.night));
    // light
    sun.color.copy(s.sun);
    sun.intensity = s.sunI;
    // atmosphere
    const au = atmos.uniforms;
    au.get('fogColor').value.copy(s.fog);
    au.get('sunColor').value.copy(s.sun).multiplyScalar(s.sunI);
    au.get('sunDir').value.copy(s.dir);
    au.get('density').value = s.fogDensity;
    au.get('falloff').value = s.fogFalloff;
    au.get('inscatter').value = s.inscatter;
    // post
    renderer.toneMappingExposure = s.exposure;
    bloom.intensity = s.bloom;
    grade.uniforms.get('tint').value.copy(s.tint);
    grade.uniforms.get('lift').value.copy(s.lift);
    hueSat.saturation = s.sat;
    ao.configuration.intensity = s.ao;
  }

  // ---------------------------------------------------------------- frame
  let dofOn = true;
  const _v = new THREE.Vector3();
  function update(dt) {
    if (blending) blendState(dt);
    applyState();
    envTimer -= dt;
    if (envTimer <= 0 || !envRT) { refreshEnv(); envTimer = blending ? 0.25 : 6; }

    controls.update(dt);   // the rig keeps the focus on the land and the camera above it
    const t = controls.target;

    // sun follows the view a little so the shadow map always covers what we see
    _v.copy(t); _v.y = 0;
    sun.target.position.copy(_v);
    sun.position.copy(_v).addScaledVector(cur.dir, 160);
    sun.target.updateMatrixWorld();

    // focus on the orbit target
    dof.target.copy(t);
    const dist = camera.position.distanceTo(t);
    dof.cocMaterial.worldFocusRange = clamp(dist * 0.4, 3, 34);
    dof.bokehScale = dofOn ? clamp(2.2 + dist * 0.015, 2.2, 4) : 0;
    dofPass.enabled = dofOn;
    atmos.uniforms.get('fogStart').value = dist * 1.05;
    camera.updateMatrixWorld();
    atmos.uniforms.get('projInv').value.copy(camera.projectionMatrixInverse);
    atmos.uniforms.get('viewInv').value.copy(camera.matrixWorld);
  }
  function render(dt) { composer.render(dt); }
  function resize() {
    const W = container.clientWidth, H = container.clientHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    composer.setSize(W, H);
  }
  window.addEventListener('resize', resize);
  function setDOF(on) { dofOn = on; }
  // jump straight to the target preset (used on boot so the first frame is already right)
  function snapPreset() {
    for (const key of COLOR_KEYS) cur[key].copy(target[key]);
    for (const key of NUM_KEYS) cur[key] = target[key];
    cur.dir.copy(target.dir);
    blending = false;
    applyState();
    refreshEnv();
  }

  applyState();
  return { renderer, scene, camera, controls, composer, sun, setPreset, snapPreset, update, render, resize, setDOF, presets: Object.keys(PRESETS) };
}
