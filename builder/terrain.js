// terrain.js — heightfield ground, painted ground canvas (season + gravel paths), pond water,
// soil-strata rim skirt and the lacquered urushi tray the garden sits in.
import * as THREE from 'three';
import {
  SIZE, HALF, RES, N, CELL, R, WATER, BASE, heights, heightAt, state, env, SEASONS,
  canvasTex, clamp, lerp, smoothstep, mulberry32,
} from './core.js';

// ---------------------------------------------------------------- constants
const GC = 1024;                 // ground canvas size (covers the full SIZE x SIZE square)
const PX = GC / SIZE;            // canvas px per world unit
const HMAX = 7, HMIN = -1.5;     // brush limits

const SKIRT_SEG = 256;
const SKIRT_BOTTOM = -1.6;
const SKIRT_SPAN = 9;            // world units of depth covered by the strata texture (v axis)
const SKIRT_REPEAT = 8;          // texture repeats around the circumference

const TRAY_IN = R + 0.15;        // inner face of the tray wall
const TRAY_OUT = R + 1.25;       // outer face at the lip
const TRAY_TOP = 0.25;           // top of the lip
const TRAY_FLOOR = -1.62;        // inner floor
const TRAY_UNDER = -1.72;        // underside

// Heights far outside the disc are pushed down to an "invisible table" level, so depth passes
// that ignore the disc discard see nothing floating above the tray rim.
const OUTSIDE_H = -1.8;

const f6 = v => Number(v).toFixed(6);

// ---------------------------------------------------------------- module state
let season = 'spring';
let terrain = null, terrainGeo = null, terrainMat = null;
let water = null, waterMat = null;
let skirt = null, skirtGeo = null, skirtTex = null;
let groundCanvas = null, groundCtx = null, groundTex = null;
let hData = null, hTex = null;
const baseCache = new Map();
const gravelCache = new Map();
const uWaterT = { value: 0 };
const waterU = {
  uHkT: uWaterT,
  uHkNrm: { value: null },
  uHkH: { value: null },
  uHkShallow: { value: new THREE.Color('#9fd0c2') },
  uHkFoam: { value: new THREE.Color('#f1f5ee') },
  uHkNS: { value: 1.0 },
};

// ---------------------------------------------------------------- colour helpers (sRGB, for canvas)
const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ================================================================ ground canvas
const SEASON_SEED = { spring: 11, summer: 23, autumn: 37, winter: 51 };

function softBlob(g, x, y, r, col, a, rnd) {
  g.save();
  g.translate(x, y);
  g.rotate(rnd() * Math.PI);
  g.scale(1, 0.45 + rnd() * 0.55);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, css(col, a));
  gr.addColorStop(0.6, css(col, a * 0.55));
  gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr;
  g.fillRect(-r, -r, 2 * r, 2 * r);
  g.restore();
}

// many tiny rects in one path (one fill per colour keeps this fast)
function speckles(g, rnd, n, col, a, smin, smax, cx = GC / 2, cy = GC / 2, spread = GC) {
  g.fillStyle = css(col, a);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const s = smin + rnd() * (smax - smin);
    const x = spread >= GC ? rnd() * GC : cx + (rnd() - 0.5) * spread;
    const y = spread >= GC ? rnd() * GC : cy + (rnd() - 0.5) * spread;
    g.rect(x, y, s, s * (0.8 + rnd() * 0.9));
  }
  g.fill();
}

function blades(g, rnd, n, col, a) {
  g.strokeStyle = css(col, a);
  g.lineWidth = 1;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = rnd() * GC, y = rnd() * GC, l = 2 + rnd() * 4, t = (rnd() - 0.5) * 1.8;
    g.moveTo(x, y);
    g.lineTo(x + t, y - l);
  }
  g.stroke();
}

function dotCluster(g, rnd, cx, cy, spread, n, cols, rmin, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, r = rmin + rnd() * (rmax - rmin);
    const col = cols[(rnd() * cols.length) | 0];
    g.fillStyle = css(col, alpha);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

function clover(g, rnd, base, count) {
  const col = mixRgb(base, [40, 80, 35], 0.35);
  for (let p = 0; p < count; p++) {
    const cx = rnd() * GC, cy = rnd() * GC, spread = 10 + rnd() * 18;
    g.fillStyle = css(col, 0.2 + rnd() * 0.1);
    g.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, rot = rnd() * Math.PI * 2;
      for (let k = 0; k < 3; k++) {
        const la = rot + k * 2.094;
        const lx = x + Math.cos(la) * 1.4, ly = y + Math.sin(la) * 1.4;
        g.moveTo(lx + 1.5, ly);
        g.arc(lx, ly, 1.5, 0, Math.PI * 2);
      }
    }
    g.fill();
  }
}

function leaves(g, rnd, cx, cy, spread, n, cols) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const rx = 2 + rnd() * 2.4, ry = 1.1 + rnd() * 1.1;
    g.fillStyle = css(cols[(rnd() * cols.length) | 0], 0.55 + rnd() * 0.35);
    g.beginPath(); g.ellipse(x, y, rx, ry, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
}

function grassDetail(g, rnd, base, name) {
  const lightG = mixRgb(base, [240, 240, 170], 0.32);
  const darkG = mixRgb(base, [28, 58, 24], 0.38);
  speckles(g, rnd, 24000, darkG, 0.16, 0.8, 1.7);
  speckles(g, rnd, 20000, lightG, 0.18, 0.8, 1.5);
  blades(g, rnd, 8000, darkG, 0.16);
  blades(g, rnd, 6500, lightG, 0.18);

  if (name === 'spring') {
    clover(g, rnd, base, 70);
    const flowerCols = [[255, 251, 236], [255, 251, 236], [246, 196, 212], [243, 221, 110]];
    for (let i = 0; i < 95; i++) dotCluster(g, rnd, rnd() * GC, rnd() * GC, 8 + rnd() * 20, 4 + ((rnd() * 12) | 0), flowerCols, 1.0, 2.0, 0.85);
    // scattered sakura petals
    speckles(g, rnd, 1600, [244, 190, 206], 0.55, 1.0, 2.0);
  } else if (name === 'summer') {
    clover(g, rnd, base, 90);
    for (let i = 0; i < 70; i++) softBlob(g, rnd() * GC, rnd() * GC, 6 + rnd() * 16, darkG, 0.18, rnd);
    for (let i = 0; i < 45; i++) dotCluster(g, rnd, rnd() * GC, rnd() * GC, 6 + rnd() * 14, 3 + ((rnd() * 6) | 0), [[255, 252, 240], [245, 220, 90]], 0.9, 1.6, 0.8);
  } else if (name === 'autumn') {
    speckles(g, rnd, 9000, [205, 180, 100], 0.2, 0.8, 1.6); // dry grass
    const leafCols = [[210, 69, 46], [227, 154, 82], [200, 83, 47], [231, 182, 74], [154, 74, 42], [190, 120, 50]];
    for (let i = 0; i < 70; i++) leaves(g, rnd, rnd() * GC, rnd() * GC, 25 + rnd() * 45, 18 + ((rnd() * 24) | 0), leafCols);
    leaves(g, rnd, GC / 2, GC / 2, GC * 0.72, 1400, leafCols);
  }
}

function winterDetail(g, rnd) {
  // blue-grey drift shading
  for (let i = 0; i < 170; i++) softBlob(g, rnd() * GC, rnd() * GC, 30 + rnd() * 120, [176, 192, 212], 0.08 + rnd() * 0.12, rnd);
  for (let i = 0; i < 90; i++) softBlob(g, rnd() * GC, rnd() * GC, 20 + rnd() * 70, [252, 253, 255], 0.2 + rnd() * 0.2, rnd);
  // grass tips poking through
  g.strokeStyle = css([125, 140, 105], 0.28);
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 0; c < 80; c++) {
    const cx = rnd() * GC, cy = rnd() * GC, s = 8 + rnd() * 22;
    for (let i = 0; i < 30; i++) {
      const x = cx + (rnd() - 0.5) * s * 2, y = cy + (rnd() - 0.5) * s * 2;
      g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 1.5, y - 1.5 - rnd() * 2.5);
    }
  }
  g.stroke();
  speckles(g, rnd, 9000, [198, 210, 226], 0.22, 0.8, 1.8);
  speckles(g, rnd, 3500, [255, 255, 255], 0.9, 0.7, 1.3);
}

function makeBase(name) {
  const S = SEASONS[name] || SEASONS.spring;
  const winter = S.snow > 0;
  const rnd = mulberry32(SEASON_SEED[name] || 5);
  const c = document.createElement('canvas');
  c.width = c.height = GC;
  const g = c.getContext('2d');
  const base = rgbOf(S.ground);
  g.fillStyle = css(base);
  g.fillRect(0, 0, GC, GC);
  const pal = winter
    ? [rgbOf('#f7f9fb'), rgbOf('#cdd7e2'), rgbOf('#dfe6ee'), rgbOf('#ecebe6')]
    : [mixRgb(base, [238, 236, 160], 0.25), mixRgb(base, [38, 66, 30], 0.28), mixRgb(base, [70, 135, 100], 0.22), mixRgb(base, [196, 166, 86], 0.28)];
  for (let i = 0; i < 140; i++) softBlob(g, rnd() * GC, rnd() * GC, 70 + rnd() * 200, pal[(rnd() * 4) | 0], 0.10 + rnd() * 0.12, rnd);
  for (let i = 0; i < 520; i++) softBlob(g, rnd() * GC, rnd() * GC, 14 + rnd() * 50, pal[(rnd() * 4) | 0], 0.08 + rnd() * 0.12, rnd);
  if (winter) winterDetail(g, rnd); else grassDetail(g, rnd, base, name);
  // gentle darkening toward the rim of the disc for depth
  const cx = GC / 2, rp = R * PX;
  const vg = g.createRadialGradient(cx, cx, rp * 0.55, cx, cx, rp * 1.02);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, winter ? 'rgba(90,110,140,0.14)' : 'rgba(40,50,20,0.16)');
  g.fillStyle = vg;
  g.fillRect(0, 0, GC, GC);
  return c;
}
function getBase(name) {
  if (!baseCache.has(name)) baseCache.set(name, makeBase(name));
  return baseCache.get(name);
}

// raked-gravel CanvasPattern (tileable 128px)
function getGravel(name) {
  if (gravelCache.has(name)) return gravelCache.get(name);
  const S = SEASONS[name] || SEASONS.spring;
  const col = rgbOf(S.path);
  const T = 128;
  const c = document.createElement('canvas');
  c.width = c.height = T;
  const g = c.getContext('2d');
  const rnd = mulberry32(4242);
  g.fillStyle = css(col);
  g.fillRect(0, 0, T, T);
  const dark = mixRgb(col, [60, 50, 40], 0.45), light = mixRgb(col, [255, 252, 240], 0.6), mid = mixRgb(col, [125, 115, 100], 0.3);
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * T, y = rnd() * T, r = 0.45 + rnd() * 1.1, k = rnd();
    g.fillStyle = css(k < 0.4 ? dark : k < 0.75 ? light : mid, 0.3 + rnd() * 0.4);
    g.beginPath();
    for (let ox = -T; ox <= T; ox += T) for (let oy = -T; oy <= T; oy += T) {
      const px = x + ox, py = y + oy;
      if (px < -r || py < -r || px > T + r || py > T + r) continue;
      g.moveTo(px + r, py);
      g.arc(px, py, r, 0, Math.PI * 2);
    }
    g.fill();
  }
  const pat = groundCtx.createPattern(c, 'repeat');
  gravelCache.set(name, pat);
  return pat;
}

function pathToCanvas(p) {
  const pts = p && p.pts;
  if (!pts || !pts.length) return null;
  const X = v => (v + HALF) * PX;           // world x/z -> canvas px (matches plane UVs with flipY)
  const P = new Path2D();
  P.moveTo(X(pts[0][0]), X(pts[0][1]));
  if (pts.length === 1) P.lineTo(X(pts[0][0]) + 0.01, X(pts[0][1]));
  for (let i = 1; i < pts.length; i++) P.lineTo(X(pts[i][0]), X(pts[i][1]));
  return P;
}

const EDGE_PASSES = [[0.6, 0.08], [0.36, 0.12], [0.16, 0.2]];   // [extra width (world), alpha]
const GROOVES = [0.8, 0.6, 0.4, 0.2];                            // raked lines as fraction of width

export function paintGround(extraPaths = []) {
  if (!groundCtx) return;
  const g = groundCtx;
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.drawImage(getBase(season), 0, 0);

  const list = [];
  const add = p => { const P = pathToCanvas(p); if (P) list.push([P, (p.w || 1.3) * PX]); };
  for (const p of state.paths) add(p);
  if (extraPaths) for (const p of extraPaths) add(p);

  if (list.length) {
    const S = SEASONS[season] || SEASONS.spring;
    const pc = rgbOf(S.path);
    const edge = mixRgb(pc, [62, 52, 38], 0.6);
    const grooveCss = css(mixRgb(pc, [70, 62, 50], 0.5), 0.16);
    const pat = getGravel(season);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // soft darker edges first (all paths, so crossings merge)
    for (const [ex, a] of EDGE_PASSES) {
      g.strokeStyle = css(edge, a);
      for (const [P, W] of list) { g.lineWidth = W + ex * PX; g.stroke(P); }
    }
    // gravel body with raked grooves running along the path
    for (const [P, W] of list) {
      g.strokeStyle = pat; g.lineWidth = W; g.stroke(P);
      for (const k of GROOVES) {
        const gw = W * k;
        if (gw < 4) continue;
        g.strokeStyle = grooveCss; g.lineWidth = gw; g.stroke(P);
        g.strokeStyle = pat; g.lineWidth = gw - 2; g.stroke(P);
      }
    }
  }
  if (groundTex) groundTex.needsUpdate = true;
}

// ================================================================ rim skirt texture
function drawSkirt(g, W, H, name) {
  const S = SEASONS[name] || SEASONS.spring;
  const winter = S.snow > 0;
  const rnd = mulberry32(9001);
  const pu = H / SKIRT_SPAN;                         // px per world unit of depth
  g.clearRect(0, 0, W, H);
  const mkWave = () => {
    const ks = [1, 2, 3, 5, 8].map(k => [k, (0.6 + rnd() * 1.6) * (k > 3 ? 0.5 : 1), rnd() * 6.2832]);
    return x => { let s = 0; for (const [k, a, p] of ks) s += a * Math.sin(6.2832 * k * x / W + p); return s; };
  };
  const bands = [
    [0, '#3b2a1e'], [0.42, '#4c3626'], [0.8, '#7d5d40'], [1.05, '#5f4431'], [1.35, '#98774f'],
    [1.62, '#806043'], [2.2, '#a48357'], [2.75, '#6c4f37'], [3.5, '#8e6d4b'], [4.6, '#755740'],
    [5.8, '#937352'], [7.2, '#654a35'],
  ];
  for (const [d, col] of bands) {
    const wf = mkWave(), y0 = d * pu, amp = d < 0.5 ? 1 : 2.2;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, d === 0 ? 0 : y0 + wf(x) * amp);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }
  // fine horizontal streaks (wrap around u)
  g.lineWidth = 1;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W, y = rnd() * H, len = 10 + rnd() * 50;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(30,20,12,0.10)' : 'rgba(230,205,160,0.08)';
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + len, y + (rnd() - 0.5) * 2);
    if (x + len > W) { g.moveTo(x - W, y); g.lineTo(x - W + len, y); }
    g.stroke();
  }
  // roots in the loam
  for (let i = 0; i < 140; i++) {
    let x = rnd() * W, y = (0.08 + rnd() * 0.25) * pu;
    const light = rnd() < 0.35;
    g.strokeStyle = light ? 'rgba(180,154,114,0.35)' : 'rgba(34,22,14,0.5)';
    g.lineWidth = 0.6 + rnd() * 0.8;
    g.beginPath(); g.moveTo(x, y);
    const steps = 3 + ((rnd() * 4) | 0);
    for (let k = 0; k < steps; k++) { x += (rnd() - 0.5) * 6; y += 2 + rnd() * 5; g.lineTo(x, y); }
    g.stroke();
  }
  // pebbles
  const pebCols = ['#9b958a', '#b6ad9c', '#7d776d', '#c9bfa9', '#8b7f6e', '#a8a296'];
  for (let i = 0; i < 460; i++) {
    const x = rnd() * W, y = (0.5 + rnd() * (SKIRT_SPAN - 0.5)) * pu;
    const rx = 1.4 + rnd() * rnd() * 5, ry = rx * (0.55 + rnd() * 0.35), rot = (rnd() - 0.5) * 0.8;
    for (const ox of [0, -W, W]) {
      const px = x + ox;
      if (px < -rx * 2 || px > W + rx * 2) continue;
      g.fillStyle = pebCols[(rnd() * pebCols.length) | 0];
      g.beginPath(); g.ellipse(px, y, rx, ry, rot, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(30,20,12,0.35)'; g.lineWidth = 0.8;
      g.beginPath(); g.ellipse(px, y + 0.5, rx, ry, rot, 0.1, Math.PI - 0.1); g.stroke();
      g.fillStyle = 'rgba(255,250,235,0.35)';
      g.beginPath(); g.arc(px - rx * 0.3, y - ry * 0.35, Math.max(0.5, rx * 0.25), 0, Math.PI * 2); g.fill();
    }
  }
  // grassy / snowy lip at the very top
  const lipH = 0.13 * pu;
  if (winter) {
    g.fillStyle = '#eef2f5';
    g.fillRect(0, 0, W, lipH * 1.1);
    g.fillStyle = 'rgba(170,186,206,0.6)';
    g.fillRect(0, lipH * 1.1 - 1.2, W, 1.2);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, r = 1.2 + rnd() * 3;
      g.fillStyle = '#eef2f5';
      g.beginPath(); g.arc(x, lipH * 1.05, r, 0, Math.PI); g.fill();
    }
  } else {
    const base = rgbOf(S.ground);
    const side = mixRgb(base, [30, 50, 20], 0.22), dark = mixRgb(base, [20, 40, 15], 0.45), light = mixRgb(base, [240, 240, 180], 0.25);
    g.fillStyle = css(side);
    g.fillRect(0, 0, W, lipH);
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 1.3) {
      g.strokeStyle = css(rnd() < 0.5 ? side : dark, 0.9);
      g.beginPath(); g.moveTo(x, lipH - 2); g.lineTo(x + (rnd() - 0.5) * 2, lipH + rnd() * rnd() * 7); g.stroke();
    }
    g.fillStyle = css(light, 0.8);
    g.fillRect(0, 0, W, 1.5);
  }
}

// ================================================================ water normal map (tileable)
function makeWaterNormals() {
  const T = 256;
  const rnd = mulberry32(31337);
  const waves = [];
  for (let k = 0; k < 10; k++) {
    let m = ((rnd() * 13) | 0) - 6, n = ((rnd() * 13) | 0) - 6;
    if (m === 0 && n === 0) m = 3;
    const f = Math.hypot(m, n);
    waves.push([m, n, rnd() * Math.PI * 2, 1 / (0.6 + f)]);
  }
  return canvasTex(T, T, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    const S = 0.9;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let du = 0, dv = 0;
      for (const [m, n, p, a] of waves) {
        const c = Math.cos(6.2832 * (m * u + n * v) + p) * a;
        du += c * m; dv += c * n;
      }
      let nx = -du * S * 0.12, ny = -dv * S * 0.12, nz = 1;
      const l = 1 / Math.hypot(nx, ny, nz);
      nx *= l; ny *= l; nz *= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true, srgb: false });
}

// ================================================================ vertex tint palette (linear colours)
const TC = {
  rock: new THREE.Color(), sand: new THREE.Color(), mudS: new THREE.Color(), mudD: new THREE.Color(),
  rockLo: 0.12, rockHi: 0.4, rockA: 0.8,
};
function setTintPalette(name) {
  const w = (SEASONS[name] || SEASONS.spring).snow > 0;
  TC.rock.set(w ? '#8f949a' : '#8c7a60');
  TC.sand.set(w ? '#d2d6d6' : '#dacfa9');
  TC.mudS.set(w ? '#5f6a69' : '#6b6447');
  TC.mudD.set(w ? '#2b4048' : '#2d4744');
  TC.rockLo = w ? 0.07 : 0.12;
  TC.rockHi = w ? 0.3 : 0.4;
  TC.rockA = w ? 0.9 : 0.8;
}
let _r = 0, _g = 0, _b = 0, _a = 0;
function over(c, f) {
  if (f <= 0) return;
  const na = 1 - (1 - _a) * (1 - f);
  const k = _a * (1 - f);
  _r = (_r * k + c.r * f) / na;
  _g = (_g * k + c.g * f) / na;
  _b = (_b * k + c.b * f) / na;
  _a = na;
}
const _mud = new THREE.Color();

// ================================================================ outside-disc sealing
let outIdx = null, outW = null, outSX = null, outSZ = null;
function prepOutside() {
  const idx = [], w = [], sx = [], sz = [];
  const a = R + 0.8, b = R + 1.4, s = R + 0.3;   // source ring at R+0.3 never reads vertices beyond R+0.8
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const x = ix * CELL - HALF, z = iz * CELL - HALF, r = Math.hypot(x, z);
    if (r <= a) continue;
    idx.push(iz * N + ix);
    w.push(smoothstep(a, b, r));
    sx.push(x / r * s); sz.push(z / r * s);
  }
  outIdx = Int32Array.from(idx); outW = Float32Array.from(w);
  outSX = Float32Array.from(sx); outSZ = Float32Array.from(sz);
}
function sealOutside() {
  if (!outIdx) prepOutside();
  for (let k = 0; k < outIdx.length; k++) {
    const t = outW[k];
    heights[outIdx[k]] = t >= 1 ? OUTSIDE_H : lerp(heightAt(outSX[k], outSZ[k]), OUTSIDE_H, t);
  }
}

// ================================================================ init
export function initTerrain(scene) {
  season = (env && SEASONS[env.season]) ? env.season : 'spring';
  setTintPalette(season);

  // ---- ground canvas texture
  groundCanvas = document.createElement('canvas');
  groundCanvas.width = groundCanvas.height = GC;
  groundCtx = groundCanvas.getContext('2d');
  groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 8;
  // flipY (default true): canvas row py=0 <-> v=1. PlaneGeometry v = 1 - iz/RES, so
  // canvas py = iz/RES*GC = (z+HALF)/SIZE*GC and px = (x+HALF)/SIZE*GC. Paths paint exactly under the stroke.

  // ---- heightfield
  // PlaneGeometry vertex (ix, iy): x = ix*CELL-HALF, y = HALF-iy*CELL. rotateX(-PI/2) maps y -> -z,
  // so z = iy*CELL-HALF and vertex index iy*N+ix == heights index.
  terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, RES, RES).rotateX(-Math.PI / 2);
  terrainGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  terrainGeo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage));
  terrainGeo.setAttribute('hkTint', new THREE.BufferAttribute(new Float32Array(N * N * 4), 4).setUsage(THREE.DynamicDrawUsage));
  terrainGeo.boundingBox = new THREE.Box3();
  terrainGeo.boundingSphere = new THREE.Sphere();

  terrainMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: groundTex, vertexColors: true, roughness: 0.96, metalness: 0 });
  terrainMat.onBeforeCompile = (sh) => {
    sh.uniforms.uHkR = { value: R };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 hkTint;\nvarying vec4 vHkTint;\nvarying vec3 vHkW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHkTint = hkTint;\nvHkW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vHkTint;\nvarying vec3 vHkW;\nuniform float uHkR;')
      .replace('#include <clipping_planes_fragment>', 'if (dot(vHkW.xz, vHkW.xz) > uHkR * uHkR) discard;\n#include <clipping_planes_fragment>')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vHkTint.rgb, vHkTint.a);');
  };
  terrainMat.customProgramCacheKey = () => 'hk-terrain';

  terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  scene.add(terrain);

  // ---- heights texture for the water shader (shore foam / shallow tint)
  hData = new Uint8Array(N * N);
  hTex = new THREE.DataTexture(hData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  hTex.magFilter = hTex.minFilter = THREE.LinearFilter;
  hTex.unpackAlignment = 1;              // rows are N=129 bytes
  hTex.needsUpdate = true;
  waterU.uHkH.value = hTex;
  waterU.uHkNrm.value = makeWaterNormals();

  // ---- water
  const waterGeo = new THREE.CircleGeometry(R - 0.02, 160).rotateX(-Math.PI / 2);
  waterMat = new THREE.MeshStandardMaterial({
    color: '#4f95a3', transparent: true, opacity: 0.82, roughness: 0.12, metalness: 0.05, depthWrite: false,
  });
  waterMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHkW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHkW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHkW;
uniform float uHkT;
uniform float uHkNS;
uniform sampler2D uHkNrm;
uniform sampler2D uHkH;
uniform vec3 uHkShallow;
uniform vec3 uHkFoam;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 hkUv = ((vHkW.xz + ${f6(HALF)}) * ${f6(1 / CELL)} + 0.5) * ${f6(1 / N)};
  float hkDep = -(texture2D(uHkH, hkUv).r * 2.0 - 1.0);   // water depth above terrain
  if (hkDep < -0.04) discard;
  float hkSh = 1.0 - smoothstep(0.0, 0.5, hkDep);
  diffuseColor.rgb = mix(diffuseColor.rgb, uHkShallow, hkSh * 0.55);
  float hkWob = 0.5 + 0.5 * sin(vHkW.x * 3.1 + vHkW.z * 2.3 + uHkT * 1.3) * sin(vHkW.z * 2.7 - vHkW.x * 1.7 - uHkT * 0.9);
  float hkFoam = 1.0 - smoothstep(0.0, 0.06 + 0.06 * hkWob, hkDep);
  diffuseColor.rgb = mix(diffuseColor.rgb, uHkFoam, hkFoam * 0.6);
  diffuseColor.a *= mix(1.0, 0.6, hkSh);
  diffuseColor.a = max(diffuseColor.a, hkFoam * 0.75);
}`)
      .replace('#include <normal_fragment_maps>', `{
  vec3 hkA = texture2D(uHkNrm, vHkW.xz * 0.085 + vec2(uHkT * 0.011, uHkT * 0.004)).xyz;
  vec3 hkB = texture2D(uHkNrm, vHkW.zx * 0.13 + vec2(-uHkT * 0.007, uHkT * 0.010)).xyz;
  vec3 hkM = hkA + hkB - 1.0;
  hkM.xy *= uHkNS;
  vec3 hkN = normalize(vec3(hkM.x, max(hkM.z, 0.2), hkM.y));
  normal = normalize((viewMatrix * vec4(hkN, 0.0)).xyz);
}`);
  };
  waterMat.customProgramCacheKey = () => 'hk-water';
  water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'water';
  water.position.y = WATER;
  water.renderOrder = 2;
  water.receiveShadow = true;
  water.castShadow = false;
  scene.add(water);

  // ---- rim skirt
  skirtTex = canvasTex(1024, 512, (g, w, h) => drawSkirt(g, w, h, season), { repeat: true });
  skirtTex.wrapT = THREE.ClampToEdgeWrapping;
  const cols = SKIRT_SEG + 1;
  const sPos = new Float32Array(cols * 2 * 3), sNor = new Float32Array(cols * 2 * 3), sUv = new Float32Array(cols * 2 * 2);
  const sIdx = [];
  for (let j = 0; j < cols; j++) {
    const a = j / SKIRT_SEG * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < 2; k++) {
      const v = j * 2 + k;
      sPos[v * 3] = c * R; sPos[v * 3 + 1] = SKIRT_BOTTOM; sPos[v * 3 + 2] = s * R;
      sNor[v * 3] = c; sNor[v * 3 + 1] = 0; sNor[v * 3 + 2] = s;
      sUv[v * 2] = j / SKIRT_SEG * SKIRT_REPEAT; sUv[v * 2 + 1] = 1;
    }
    if (j < SKIRT_SEG) {
      const t0 = j * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      sIdx.push(t0, t1, b0, t1, b1, b0);       // outward-facing winding
    }
  }
  skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  skirtGeo.setAttribute('normal', new THREE.BufferAttribute(sNor, 3));
  skirtGeo.setAttribute('uv', new THREE.BufferAttribute(sUv, 2).setUsage(THREE.DynamicDrawUsage));
  skirtGeo.setIndex(sIdx);
  skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.95, metalness: 0 }));
  skirt.name = 'terrainSkirt';
  skirt.receiveShadow = true;
  skirt.castShadow = false;
  scene.add(skirt);

  // ---- lacquer tray
  scene.add(buildTray());

  refreshTerrain();
  paintGround();
}

function buildTray() {
  const group = new THREE.Group();
  group.name = 'tray';
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const t = lerp(a0, a1, i / n); pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } };
  const D = Math.PI / 180;
  // profile (r, y): underside out -> outer wall up -> rounded lip -> inner wall down -> floor in
  pts.push([0, TRAY_UNDER]);
  pts.push([R + 0.9, TRAY_UNDER]);
  arc(R + 1.06, TRAY_UNDER + 0.12, 0.12, -90 * D, 0, 4);          // rounded foot -> (R+1.18, -1.60)
  pts.push([R + 1.215, -0.8]);
  arc(TRAY_OUT - 0.2, TRAY_TOP - 0.2, 0.2, 0, 90 * D, 6);          // outer lip corner
  arc(TRAY_IN + 0.2, TRAY_TOP - 0.2, 0.2, 90 * D, 180 * D, 6);     // inner lip corner -> (TRAY_IN, 0.05)
  pts.push([TRAY_IN, -0.8]);
  pts.push([TRAY_IN, TRAY_FLOOR + 0.06]);
  pts.push([TRAY_IN - 0.06, TRAY_FLOOR]);
  pts.push([0, TRAY_FLOOR]);
  const prof = [];
  for (const [x, y] of pts) {
    const last = prof[prof.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 1e-4) continue;
    prof.push(new THREE.Vector2(x, y));
  }
  const trayMat = new THREE.MeshPhysicalMaterial({
    color: '#2e1712', roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.25,
  });
  const tray = new THREE.Mesh(new THREE.LatheGeometry(prof, 160), trayMat);
  tray.castShadow = true;
  tray.receiveShadow = true;
  group.add(tray);

  const goldMat = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.85, roughness: 0.3 });
  const band = new THREE.Mesh(new THREE.TorusGeometry((TRAY_IN + TRAY_OUT) / 2, 0.04, 8, 220), goldMat);
  band.rotation.x = Math.PI / 2;
  band.position.y = TRAY_TOP;
  band.castShadow = true; band.receiveShadow = true;
  group.add(band);
  const band2 = new THREE.Mesh(new THREE.TorusGeometry(TRAY_OUT - 0.01, 0.025, 6, 220), goldMat);
  band2.rotation.x = Math.PI / 2;
  band2.position.y = -0.05;
  band2.receiveShadow = true;
  group.add(band2);

  // soft contact shadow on the invisible table
  const shTex = canvasTex(256, 256, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(20,12,8,0.55)');
    gr.addColorStop(0.55, 'rgba(20,12,8,0.45)');
    gr.addColorStop(0.72, 'rgba(20,12,8,0.2)');
    gr.addColorStop(1, 'rgba(20,12,8,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  });
  const shSize = TRAY_OUT * 1.6 * 2;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(shSize, shSize).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }),
  );
  shadow.name = 'trayContactShadow';
  shadow.position.y = -1.75;
  shadow.renderOrder = -1;
  group.add(shadow);
  return group;
}

export function getTerrainMesh() { return terrain; }

// ================================================================ refresh (every frame while brushing)
export function refreshTerrain() {
  if (!terrain) return;
  sealOutside();
  const pos = terrainGeo.attributes.position.array;
  const nor = terrainGeo.attributes.normal.array;
  const col = terrainGeo.attributes.color.array;
  const tin = terrainGeo.attributes.hkTint.array;
  const lim2 = (R + 0.6) * (R + 0.6);
  let minH = Infinity, maxH = -Infinity;

  for (let iz = 0; iz < N; iz++) {
    const zm = iz > 0 ? iz - 1 : 0, zp = iz < RES ? iz + 1 : RES;
    const z = iz * CELL - HALF;
    for (let ix = 0; ix < N; ix++) {
      const xm = ix > 0 ? ix - 1 : 0, xp = ix < RES ? ix + 1 : RES;
      const i = iz * N + ix;
      const h = heights[i];
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      pos[i * 3 + 1] = h;

      const hl = heights[iz * N + xm], hr = heights[iz * N + xp];
      const hd = heights[zm * N + ix], hu = heights[zp * N + ix];
      const dx = (hr - hl) / ((xp - xm) * CELL), dz = (hu - hd) / ((zp - zm) * CELL);
      const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      nor[i * 3] = -dx * l; nor[i * 3 + 1] = l; nor[i * 3 + 2] = -dz * l;

      const x = ix * CELL - HALF;
      if (x * x + z * z > lim2) {
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
        tin[i * 4 + 3] = 0;
        hData[i] = 255;
        continue;
      }

      const u = h - WATER;
      const slope = 1 - l;
      // multiplier: darker with water depth, soft cavity darkening in hollows
      const deep = u < 0 ? smoothstep(0, 1.4, -u) : 0;
      let m = 1 - 0.58 * deep;
      const lap = (hl + hr + hd + hu) * 0.25 - h;
      m *= 1 - clamp(lap * 2.5, 0, 0.12);
      col[i * 3] = m * (1 - 0.1 * deep); col[i * 3 + 1] = m; col[i * 3 + 2] = m;

      // tint (blend target): rock on slopes, sand at the shoreline, mud under water
      _r = _g = _b = _a = 0;
      over(TC.rock, smoothstep(TC.rockLo, TC.rockHi, slope) * TC.rockA);
      over(TC.sand, smoothstep(-0.05, 0.0, u) * (1 - smoothstep(0.035, 0.08, u)) * 0.85);
      const wet = smoothstep(0.0, -0.06, u);
      if (wet > 0) {
        _mud.copy(TC.mudS).lerp(TC.mudD, smoothstep(0.02, 1.2, -u));
        over(_mud, wet * 0.92);
      }
      tin[i * 4] = _r; tin[i * 4 + 1] = _g; tin[i * 4 + 2] = _b; tin[i * 4 + 3] = _a;

      // terrain height relative to water, encoded [-1, 1] -> [0, 255]
      hData[i] = clamp((u + 1) * 127.5, 0, 255);
    }
  }
  terrainGeo.attributes.position.needsUpdate = true;
  terrainGeo.attributes.normal.needsUpdate = true;
  terrainGeo.attributes.color.needsUpdate = true;
  terrainGeo.attributes.hkTint.needsUpdate = true;
  terrainGeo.boundingBox.min.set(-HALF, minH, -HALF);
  terrainGeo.boundingBox.max.set(HALF, maxH, HALF);
  terrainGeo.boundingBox.getBoundingSphere(terrainGeo.boundingSphere);
  hTex.needsUpdate = true;

  // skirt top follows the rim
  const sp = skirtGeo.attributes.position.array, su = skirtGeo.attributes.uv.array;
  for (let j = 0; j <= SKIRT_SEG; j++) {
    const a = j / SKIRT_SEG * Math.PI * 2;
    const top = Math.max(heightAt(Math.cos(a) * R, Math.sin(a) * R), WATER) + 0.015;
    const t = j * 2, b = t + 1;
    sp[t * 3 + 1] = top;
    sp[b * 3 + 1] = SKIRT_BOTTOM;
    su[t * 2 + 1] = 1;
    su[b * 2 + 1] = 1 - (top - SKIRT_BOTTOM) / SKIRT_SPAN;
  }
  skirtGeo.attributes.position.needsUpdate = true;
  skirtGeo.attributes.uv.needsUpdate = true;
  skirtGeo.computeBoundingSphere();
}

// ================================================================ season
export function setTerrainSeason(name) {
  season = SEASONS[name] ? name : 'spring';
  setTintPalette(season);
  const winter = SEASONS[season].snow > 0;
  if (skirtTex) {
    const c = skirtTex.image;
    drawSkirt(c.getContext('2d'), c.width, c.height, season);
    skirtTex.needsUpdate = true;
  }
  if (waterMat) {
    waterMat.color.set(winter ? '#9ebfc8' : '#4f95a3');
    waterMat.opacity = winter ? 0.9 : 0.82;
    waterMat.roughness = winter ? 0.28 : 0.12;
    waterU.uHkShallow.value.set(winter ? '#d6e6ea' : '#9fd0c2');
    waterU.uHkNS.value = winter ? 0.25 : 1.0;
  }
  refreshTerrain();
  paintGround();
}

// ================================================================ brush
let scratch = null;
export function brush(op, x, z, radius, dt) {
  if (!(radius > 0) || !(dt > 0)) return false;
  const lim = R + 0.5;
  const ix0 = clamp(Math.floor((x - radius + HALF) / CELL), 0, RES), ix1 = clamp(Math.ceil((x + radius + HALF) / CELL), 0, RES);
  const iz0 = clamp(Math.floor((z - radius + HALF) / CELL), 0, RES), iz1 = clamp(Math.ceil((z + radius + HALF) / CELL), 0, RES);
  if (ix0 > ix1 || iz0 > iz1) return false;

  // snapshot (padded by one) so smoothing is order independent
  if (!scratch) scratch = new Float32Array(N * N);
  const pz0 = Math.max(0, iz0 - 1), pz1 = Math.min(RES, iz1 + 1), px0 = Math.max(0, ix0 - 1), px1 = Math.min(RES, ix1 + 1);
  for (let iz = pz0; iz <= pz1; iz++) for (let ix = px0; ix <= px1; ix++) scratch[iz * N + ix] = heights[iz * N + ix];
  const avg9 = (ix, iz) => {
    let s = 0, c = 0;
    for (let oz = -1; oz <= 1; oz++) {
      const jz = iz + oz; if (jz < 0 || jz > RES) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const jx = ix + ox; if (jx < 0 || jx > RES) continue;
        s += scratch[jz * N + jx]; c++;
      }
    }
    return s / c;
  };

  const target = op === 'flatten' ? heightAt(x, z) : 0;
  const r2 = radius * radius;
  let changed = false;
  for (let iz = iz0; iz <= iz1; iz++) {
    const wz = iz * CELL - HALF, dz = wz - z;
    for (let ix = ix0; ix <= ix1; ix++) {
      const wx = ix * CELL - HALF, dx = wx - x;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      const rr = Math.hypot(wx, wz);
      if (rr > lim) continue;
      const q = 1 - d2 / r2;
      let w = q * q;
      const ring = smoothstep(R - 0.6, lim, rr);   // near the rim edits fade out
      w *= 1 - 0.7 * ring;
      const i = iz * N + ix;
      const h0 = heights[i];
      let h = h0;
      switch (op) {
        case 'raise': h = Math.min(HMAX, h + 2.2 * dt * w); if (h0 > HMAX) h = h0; break;
        case 'pond': h = Math.max(HMIN, h - 2.2 * dt * w); if (h0 < HMIN) h = h0; break;
        case 'smooth': h = lerp(h, avg9(ix, iz), clamp(dt * w * 8, 0, 1)); break;
        case 'flatten': h = lerp(h, target, clamp(dt * w * 5, 0, 1)); break;
        default: return false;
      }
      // rim ring: ease toward the local neighbourhood so no single vertex spikes at the edge
      if (ring > 0 && op !== 'smooth') h = lerp(h, avg9(ix, iz) + (h - h0), clamp(dt * 4 * ring * w, 0, 0.5));
      if (Math.abs(h - h0) > 1e-7) { heights[i] = h; changed = true; }
    }
  }
  return changed;
}

// ================================================================ default meadow
export function generateGround(seed = 1) {
  const rnd = mulberry32((seed * 9973 + 17) | 0);
  const waves = [];
  let norm = 0;
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2, f = (0.07 + rnd() * 0.12) * (1 + k * 0.18);
    const amp = 1 / (1 + k * 0.5);
    waves.push([Math.cos(a) * f, Math.sin(a) * f, rnd() * Math.PI * 2, amp]);
    norm += amp;
  }
  const bumps = [];
  for (let k = 0; k < 4; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.7;
    bumps.push([Math.cos(a) * d, Math.sin(a) * d, 2.5 + rnd() * 3.5, (rnd() - 0.35) * 0.18]);
  }
  for (let iz = 0; iz < N; iz++) {
    const z = iz * CELL - HALF;
    for (let ix = 0; ix < N; ix++) {
      const x = ix * CELL - HALF;
      let n = 0;
      for (const [kx, kz, p, a] of waves) n += a * Math.sin(kx * x + kz * z + p);
      n /= norm;
      let b = 0;
      for (const [bx, bz, br, bh] of bumps) { const d2 = ((x - bx) ** 2 + (z - bz) ** 2) / (br * br); b += bh * Math.exp(-d2); }
      const r = Math.hypot(x, z);
      heights[iz * N + ix] = BASE + n * 0.3 + b + 0.28 * smoothstep(R * 0.55, R, r);
    }
  }
  sealOutside();
}

// ================================================================ animation
export function updateTerrain(dt) {
  uWaterT.value += Math.min(dt || 0, 0.1);
}
