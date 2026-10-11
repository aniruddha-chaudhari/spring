// render.js — renderer, camera, controls, time-of-day lighting and the miniature (macro-lens) look.
//
// Pipeline:  RenderPass → MiniatureDOFPass (depth-based macro DOF) → UnrealBloomPass → GradePass → OutputPass
//
// MiniatureDOFPass:
//   1. depth pre-pass of layer 0 only (glow sprites / particles on LAYER_FX are skipped) into an RGBA-packed target
//   2. half-res prefilter: downsample colour + signed circle of confusion (negative = in front of focus)
//   3. half-res golden-angle gather (scatter-as-gather weighting, foreground spreading, highlight-weighted bokeh)
//   4. full-res composite: sharp image where in focus, blurred where the CoC (or a blurred foreground) covers it
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { env, LAYER_FX, R, applyNightMaterials, clamp, lerp, smoothstep } from './core.js';

const DEG = Math.PI / 180;

// ============================================================== shaders
const QUAD_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Signed, normalised circle of confusion from the packed depth target. >0 behind focus, <0 in front.
const COC_GLSL = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDist;
uniform float cocGain;
uniform float deadZone;
float getCoc(vec2 uv) {
  float d = unpackRGBAToDepth(texture2D(tDepth, uv));
  float dist = d > 0.99999 ? 1.0e6 : -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
  dist = max(dist, cameraNear);
  // thin-lens: |1/focus - 1/dist| scaled by focus so the look is zoom-independent-ish
  float c = (1.0 - focusDist / dist) * cocGain;
  float a = max(abs(c) - deadZone, 0.0) / (1.0 - deadZone);
  return clamp(sign(c) * a, -1.0, 1.0);
}`;

const PREFILTER_FS = /* glsl */`
uniform sampler2D tColor;
varying vec2 vUv;
${COC_GLSL}
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(col, getCoc(vUv));
}`;

const GATHER_FS = /* glsl */`
uniform sampler2D tPre;
uniform vec2 texel;        // half-res texel size
uniform float maxRadius;   // half-res pixels
uniform float highlight;   // bokeh highlight boost
varying vec2 vUv;
#define TAPS 56
#define GOLDEN_ANGLE 2.39996323
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hiW(vec3 c) { return 1.0 + highlight * smoothstep(0.7, 3.0, luma(c)); }
void main() {
  vec4 c0 = texture2D(tPre, vUv);
  float cC = c0.a;
  float cR = abs(cC) * maxRadius;
  float w0 = hiW(c0.rgb);
  vec3 acc = c0.rgb * w0;
  float wAcc = w0;
  float fgCount = 0.0;
  float fgMax = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(TAPS)) * maxRadius;
    float th = fi * GOLDEN_ANGLE;
    vec4 s = texture2D(tPre, vUv + vec2(cos(th), sin(th)) * r * texel);
    float sR = abs(s.a) * maxRadius;
    // a sample behind the centre may not blur over it further than the centre's own blur
    // (keeps sharp subjects from being washed over by the blurred background)
    float behind = step(cC + 0.02, s.a);
    float effR = mix(sR, min(sR, cR * 2.0), behind);
    // does this sample's blur disc reach the centre? (scatter-as-gather)
    float cover = smoothstep(r - 1.0, r + 0.5, effR);
    float w = cover * hiW(s.rgb);
    acc += s.rgb * w;
    wAcc += w;
    // blurred foreground spreading over a sharper background
    float front = step(s.a, cC - 0.05) * step(s.a, 0.0);
    fgCount += cover * front;
    fgMax = max(fgMax, sR * front * cover);
  }
  // fraction of the foreground disc that overlaps this pixel (≈0.5 right at a blurred edge)
  float expected = max(float(TAPS) * (fgMax / maxRadius) * (fgMax / maxRadius), 1.0);
  float fgAlpha = clamp(fgCount / expected, 0.0, 1.0);
  gl_FragColor = vec4(acc / wAcc, fgAlpha);
}`;

const COMPOSITE_FS = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform vec2 blurTexel;
uniform float maxRadiusFull;
varying vec2 vUv;
${COC_GLSL}
void main() {
  vec4 sharp = texture2D(tColor, vUv);
  // small tent on the half-res blur: fills the gaps between spiral taps -> creamier
  vec2 o = blurTexel * 0.75;
  vec4 b = texture2D(tBlur, vUv) * 0.5
         + texture2D(tBlur, vUv + vec2( o.x,  o.y)) * 0.125
         + texture2D(tBlur, vUv + vec2(-o.x,  o.y)) * 0.125
         + texture2D(tBlur, vUv + vec2( o.x, -o.y)) * 0.125
         + texture2D(tBlur, vUv + vec2(-o.x, -o.y)) * 0.125;
  float coc = getCoc(vUv);
  float own = smoothstep(0.6, 2.4, abs(coc) * maxRadiusFull);
  float f = max(own, b.a);
  gl_FragColor = vec4(mix(sharp.rgb, b.rgb, f), 1.0);
}`;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.08 },
    uContrast: { value: 1.05 },
    uWarm: { value: 1.0 },
    uNight: { value: 0 },
    uVignette: { value: 0.2 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uSat, uContrast, uWarm, uNight, uVignette, uGrain, uTime;
uniform vec2 uRes;
varying vec2 vUv;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec4 tex = texture2D(tDiffuse, vUv);
  vec3 c = max(tex.rgb, 0.0);            // linear HDR (tone mapping happens in OutputPass)
  float l = luma(c);
  float hl = smoothstep(0.03, 0.9, l);
  // split tone: warm highlights, slightly cool shadows
  vec3 tint = mix(vec3(0.975, 1.0, 1.03), vec3(1.045, 1.0, 0.94), hl);
  c *= mix(vec3(1.0), tint, uWarm);
  // night: push the shadows towards deep teal
  c = mix(c, c * vec3(0.82, 1.02, 1.14), uNight * (1.0 - hl) * 0.6);
  // saturation
  l = luma(c);
  c = max(mix(vec3(l), c, uSat), 0.0);
  // soft contrast around mid grey (log-space pivot)
  c = 0.18 * pow(c / 0.18 + 1e-6, vec3(uContrast));
  // vignette
  vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.3, 1.05, length(d));
  // fine film grain
  float n = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * vec2(197.0, 113.0)) - 0.5;
  c *= 1.0 + n * uGrain;
  c += n * 0.0015;
  gl_FragColor = vec4(max(c, 0.0), tex.a);
}`,
};

// ============================================================== Miniature DOF pass
class MiniatureDOFPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.focusDist = 40;
    this.width = 1; this.height = 1;

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.depthMaterial.blending = THREE.NoBlending;

    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: false };
    const half = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false };
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, nearest);
    this.preRT = new THREE.WebGLRenderTarget(1, 1, half);
    this.blurRT = new THREE.WebGLRenderTarget(1, 1, half);
    this.depthRT.texture.name = 'MiniatureDOF.depth';
    this.preRT.texture.name = 'MiniatureDOF.pre';
    this.blurRT.texture.name = 'MiniatureDOF.blur';

    const cocUniforms = () => ({
      tDepth: { value: this.depthRT.texture },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      focusDist: { value: 40 },
      cocGain: { value: 2 },
      deadZone: { value: 0.07 },
    });
    const mat = (fs, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false, blending: THREE.NoBlending });

    this.preMat = mat(PREFILTER_FS, { tColor: { value: null }, ...cocUniforms() });
    this.gatherMat = mat(GATHER_FS, {
      tPre: { value: this.preRT.texture },
      texel: { value: new THREE.Vector2(1, 1) },
      maxRadius: { value: 6 },
      highlight: { value: 1.6 },
    });
    this.compMat = mat(COMPOSITE_FS, {
      tColor: { value: null },
      tBlur: { value: this.blurRT.texture },
      blurTexel: { value: new THREE.Vector2(1, 1) },
      maxRadiusFull: { value: 12 },
      ...cocUniforms(),
    });
    this.quad = new FullScreenQuad(null);
    this._clearColor = new THREE.Color();
  }

  setSize(width, height) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    // depth at (close to) full res for crisp in-focus edges; scaled down on very large buffers
    const ds = clamp(1920 / this.width, 0.5, 1);
    this.depthRT.setSize(Math.max(1, Math.round(this.width * ds)), Math.max(1, Math.round(this.height * ds)));
    const hw = Math.max(1, Math.floor(this.width / 2)), hh = Math.max(1, Math.floor(this.height / 2));
    this.preRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    this.gatherMat.uniforms.texel.value.set(1 / hw, 1 / hh);
    this.compMat.uniforms.blurTexel.value.set(1 / hw, 1 / hh);
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!env.mini || !(env.blur > 0.01)) { this.needsSwap = false; return; } // bypass: leave readBuffer as is
    this.needsSwap = true;
    const { scene, camera } = this;
    const blur = clamp(env.blur, 0, 10);

    // ---- uniforms
    const maxFull = Math.max(3, (8 + blur * 0.8) * (this.height / 1080));
    for (const m of [this.preMat, this.compMat]) {
      const u = m.uniforms;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.focusDist.value = this.focusDist;
      u.cocGain.value = blur * 0.4;
    }
    this.gatherMat.uniforms.maxRadius.value = maxFull * 0.5;
    this.compMat.uniforms.maxRadiusFull.value = maxFull;

    // ---- 1. depth pre-pass (layer 0 only, no background, no shadow-map re-render)
    const oldOverride = scene.overrideMaterial, oldBg = scene.background, oldMask = camera.layers.mask;
    const oldAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(this._clearColor);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;

    scene.overrideMaterial = this.depthMaterial;
    scene.background = null;
    camera.layers.set(0);
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setClearColor(0xffffff, 1);   // packs to depth ≈ 1 (far / sky)
    renderer.setRenderTarget(this.depthRT);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    scene.overrideMaterial = oldOverride;
    scene.background = oldBg;
    camera.layers.mask = oldMask;
    renderer.shadowMap.autoUpdate = oldAutoUpdate;
    renderer.setClearColor(this._clearColor, oldAlpha);

    // ---- 2. prefilter (half res colour + signed CoC)
    this.preMat.uniforms.tColor.value = readBuffer.texture;
    this.quad.material = this.preMat;
    renderer.setRenderTarget(this.preRT);
    this.quad.render(renderer);

    // ---- 3. gather blur (half res)
    this.quad.material = this.gatherMat;
    renderer.setRenderTarget(this.blurRT);
    this.quad.render(renderer);

    // ---- 4. composite (full res)
    this.compMat.uniforms.tColor.value = readBuffer.texture;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);

    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    this.depthRT.dispose(); this.preRT.dispose(); this.blurRT.dispose();
    this.depthMaterial.dispose(); this.preMat.dispose(); this.gatherMat.dispose(); this.compMat.dispose();
    this.quad.dispose();
  }
}

// ============================================================== time-of-day palette
// [hour, skyTop, skyHorizon, sunColour, sunIntensity, hemiSky, hemiGround, hemiIntensity]
const NIGHT_KEY = ['#0a1a2e', '#1d4058', '#9cc2ea', 0.75, '#4a8aae', '#1a2a30', 1.6];
const KEYS_RAW = [
  [0, ...NIGHT_KEY],
  [4.5, ...NIGHT_KEY],
  [5.6, '#1f2d55', '#b9788a', '#ffa98a', 0.7, '#7d7fae', '#3e3238', 1.6],   // pre-dawn
  [6.4, '#5f84bd', '#ffb48c', '#ffa868', 1.6, '#a8b4d6', '#6f5242', 1.6],   // dawn
  [8.0, '#6fa6dc', '#f2ddc4', '#ffe2bf', 2.4, '#bdd3ec', '#7c6a52', 1.7],   // morning
  [12.0, '#6aa3e0', '#dfeaf0', '#fff3e0', 2.45, '#c2daf0', '#7e7258', 1.75], // noon
  [15.0, '#719fd6', '#f5ddb8', '#ffdcaa', 2.6, '#c6d4e6', '#83694b', 1.7],
  [16.5, '#7f9ccc', '#ffcf98', '#ffc07a', 2.5, '#d4cfd6', '#8b6545', 1.6],  // golden
  [17.6, '#6f80b8', '#ffab73', '#ff9a55', 2.1, '#c9a9b6', '#74503c', 1.5],
  [18.5, '#4b5592', '#f27a5a', '#ff6e40', 1.3, '#9a86a8', '#4e3838', 1.5],  // sunset
  [19.6, '#262f60', '#7d6699', '#a596d8', 0.7, '#61689e', '#2c2a3c', 1.7],  // dusk
  [21.0, ...NIGHT_KEY],
  [24.0, ...NIGHT_KEY],
];
const KEYS = KEYS_RAW.map(k => ({
  h: k[0], top: new THREE.Color(k[1]), hor: new THREE.Color(k[2]), sun: new THREE.Color(k[3]), sunI: k[4],
  hSky: new THREE.Color(k[5]), hGnd: new THREE.Color(k[6]), hI: k[7],
}));

// Sun arc: rises in the east (AZ_E), sets in the west (AZ_W). Chosen so the default 16:00 view is warm 3/4 side light.
const AZ_E = -35 * DEG, AZ_W = 145 * DEG, MAX_ELEV = 62 * DEG, MIN_ELEV = 12 * DEG;
const MOON_DIR = new THREE.Vector3(Math.cos(50 * DEG) * Math.cos(100 * DEG), Math.sin(50 * DEG), Math.cos(50 * DEG) * Math.sin(100 * DEG)).normalize();

// ============================================================== createRenderer
export function createRenderer(container) {
  const size = () => [Math.max(1, container.clientWidth || window.innerWidth), Math.max(1, container.clientHeight || window.innerHeight)];
  let [W, H] = size();

  // ---- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  // ---- scene / camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.5, 400);
  camera.position.set(33, 30, 37);
  camera.layers.enable(LAYER_FX);
  camera.lookAt(0, 0.5, 0);

  // ---- controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.minDistance = 9;
  controls.maxDistance = 75;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.3;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.9;
  if ('zoomToCursor' in controls) controls.zoomToCursor = true;
  controls.update();

  // ---- lights
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -25; sc.right = 25; sc.top = 25; sc.bottom = -25; sc.near = 1; sc.far = 140;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  sun.target.position.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xc6d4e6, 0x83694b, 1.7);
  scene.add(hemi);

  // ---- background gradient (screen-space) + fog
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 4; bgCanvas.height = 256;
  const bgCtx = bgCanvas.getContext('2d');
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.generateMipmaps = false;
  bgTex.minFilter = THREE.LinearFilter;
  bgTex.magFilter = THREE.LinearFilter;
  scene.background = bgTex;
  scene.fog = new THREE.Fog(0xf3e1c3, 70, 150);
  const lastBg = new Float32Array(6).fill(-1);
  const _bot = new THREE.Color(), _warm = new THREE.Color('#5a3a2a');
  function drawBackground(top, hor) {
    const v = [top.r, top.g, top.b, hor.r, hor.g, hor.b];
    let diff = 0;
    for (let i = 0; i < 6; i++) diff += Math.abs(v[i] - lastBg[i]);
    if (diff < 0.004) return;
    lastBg.set(v);
    // bottom of the screen: horizon colour sinking into a soft, warm tabletop-ish dusk
    _bot.copy(hor).lerp(_warm, 0.18).multiplyScalar(0.82);
    const g = bgCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + top.getHexString());
    g.addColorStop(0.58, '#' + hor.getHexString());
    g.addColorStop(1, '#' + _bot.getHexString());
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, 4, 256);
    bgTex.needsUpdate = true;
  }

  // ---- post-processing
  const pr = renderer.getPixelRatio();
  // sized in CSS px: EffectComposer multiplies by its pixel ratio (taken from the renderer) in setSize()
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  rt.texture.name = 'Hakoniwa.rt';
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const dofPass = new MiniatureDOFPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.2, 0.55, 0.85);
  const gradePass = new ShaderPass(GradeShader);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(dofPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(outputPass);
  composer.setSize(W, H);
  gradePass.uniforms.uRes.value.set(W * pr, H * pr);

  // ---- focus
  let focusOverride = null;
  let focusDist = camera.position.distanceTo(controls.target);
  const _fwd = new THREE.Vector3(), _tmp = new THREE.Vector3();
  function setFocusPoint(v) { focusOverride = v ? v.clone() : null; }

  // ---- time of day
  const C = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hSky: new THREE.Color(), hGnd: new THREE.Color() };
  const _sunDir = new THREE.Vector3(), _dir = new THREE.Vector3();
  function updateTimeOfDay() {
    const h = ((env.time % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothstep(0, 1, (h - a.h) / Math.max(1e-6, b.h - a.h));
    C.top.copy(a.top).lerp(b.top, t);
    C.hor.copy(a.hor).lerp(b.hor, t);
    C.sun.copy(a.sun).lerp(b.sun, t);
    C.hSky.copy(a.hSky).lerp(b.hSky, t);
    C.hGnd.copy(a.hGnd).lerp(b.hGnd, t);
    const sunI = lerp(a.sunI, b.sunI, t), hI = lerp(a.hI, b.hI, t);

    // sun arc
    const ang = Math.PI * (h - 6) / 12;
    const elev = MAX_ELEV * Math.sin(ang);
    const sinE = Math.sin(elev);
    const night = 1 - smoothstep(-0.3, 0.05, sinE);
    env.night = night;
    applyNightMaterials(night);

    const az = lerp(AZ_E, AZ_W, clamp((h - 6) / 12, 0, 1));
    const el = Math.max(elev, MIN_ELEV);
    _sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    _dir.copy(_sunDir).lerp(MOON_DIR, night).normalize();
    sun.position.copy(_dir).multiplyScalar(70);
    sun.color.copy(C.sun);
    sun.intensity = sunI;
    hemi.color.copy(C.hSky);
    hemi.groundColor.copy(C.hGnd);
    hemi.intensity = hI;

    drawBackground(C.top, C.hor);
    scene.fog.color.copy(C.hor);

    renderer.toneMappingExposure = lerp(1.05, 1.18, night);
    bloomPass.strength = lerp(0.2, 0.85, night);
    bloomPass.threshold = lerp(0.85, 0.72, night);
    bloomPass.radius = lerp(0.5, 0.65, night);
    const gu = gradePass.uniforms;
    gu.uWarm.value = lerp(1.0, 0.35, night);
    gu.uNight.value = night;
    gu.uSat.value = lerp(1.08, 0.62, night);
  }

  // ---- per-frame
  const _clampOld = new THREE.Vector3();
  let clock = 0;
  function frame(dt) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 1 / 60;
    clock += dt;

    controls.update();
    // keep the pivot over the diorama; shift the camera by the same amount so the orbit stays intact
    const tg = controls.target;
    _clampOld.copy(tg);
    const rr = Math.hypot(tg.x, tg.z);
    if (rr > R) { tg.x *= R / rr; tg.z *= R / rr; }
    tg.y = clamp(tg.y, -1, 4);
    if (!_clampOld.equals(tg)) camera.position.add(_tmp.subVectors(tg, _clampOld));
    camera.lookAt(tg);
    camera.updateMatrixWorld();

    updateTimeOfDay();

    // fog: only a light haze on the far side, relative to the current orbit distance
    const camDist = camera.position.distanceTo(tg);
    scene.fog.near = camDist + 8;
    scene.fog.far = camDist + 110;

    // focus (view-space depth of the focus point), eased so it never pops
    const fp = focusOverride || tg;
    camera.getWorldDirection(_fwd);
    const want = Math.max(camera.near * 4, _tmp.subVectors(fp, camera.position).dot(_fwd));
    focusDist += (want - focusDist) * (1 - Math.exp(-dt * 10));
    if (dt === 0 || !Number.isFinite(focusDist)) focusDist = want;
    dofPass.focusDist = focusDist;

    gradePass.uniforms.uTime.value = clock;
    composer.render(dt);
  }

  function resize() {
    [W, H] = size();
    const p = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(p);
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    composer.setPixelRatio(p);
    composer.setSize(W, H);   // also resizes the DOF / bloom targets via pass.setSize
    gradePass.uniforms.uRes.value.set(W * p, H * p);
  }
  window.addEventListener('resize', resize);

  function screenshot() {
    frame(0);
    return renderer.domElement.toDataURL('image/png');
  }

  // prime the lighting so the first frame (and anything reading env.night) is correct
  updateTimeOfDay();

  return { renderer, scene, camera, controls, sun, render: frame, resize, screenshot, setFocusPoint };
}
