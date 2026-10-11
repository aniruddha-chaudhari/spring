// vegetation/atlas.js — canvas-drawn foliage atlas (near-white leaves tinted by vertex colour) + pampas plume texture.
// Tiles (4x4 of 256 px, flipY = false so canvas top row = v 0):
//   0-3 maple clusters, 4-5 ginkgo clusters, 6-7 black-pine needle tufts, 8-9 sugi sprays, 10 fern frond,
//   11 azalea/shrub cluster, 12-13 single maple leaves, 14 single ginkgo leaf, 15 opaque bark (instanced trunks)
import * as THREE from 'three';
import { mulberry32, IS_SPRING } from '../world.js';

// Spring reuses four autumn-only tiles: 3 + 13 -> sakura blossom clusters, 14 -> single petal, 12 -> wildflower clump.
export const TILE = IS_SPRING ? {
  maple: [0, 1, 2], ginkgo: [4, 5], pine: [6, 7], cedar: [8, 9], fern: 10, shrub: 11,
  mapleLeaf: [12, 13], ginkgoLeaf: 14, bark: 15, sakura: [3, 13], petal: 14, flowers: 12,
} : {
  maple: [0, 1, 2, 3], ginkgo: [4, 5], pine: [6, 7], cedar: [8, 9], fern: 10, shrub: 11,
  mapleLeaf: [12, 13], ginkgoLeaf: 14, bark: 15,
};
const N = 4, S = 256, W = N * S;

// uv of the solid white patch in the bark tile (opaque crown cores)
export const SOLID_UV = () => tileUV(15)(0.07, 0.93);

// uv rect of a tile with a small inset; returns function (s, t) -> [u, v] with s 0..1 left->right, t 0..1 bottom->top
export function tileUV(idx, inset = 2) {
  const col = idx % N, row = Math.floor(idx / N);
  const u0 = (col * S + inset) / W, u1 = ((col + 1) * S - inset) / W;
  const vTop = (row * S + inset) / W, vBot = ((row + 1) * S - inset) / W;
  return (s, t) => [u0 + (u1 - u0) * s, vBot + (vTop - vBot) * t];
}

function g(v, a = 1) { v = Math.max(0, Math.min(255, Math.round(v))); return `rgba(${v},${v},${v},${a})`; }
function warm(v, k = 0) { // slightly warm/cool white (k -1..1)
  const r = Math.min(255, v * (1 + 0.04 * k)), gg = v, b = Math.max(0, v * (1 - 0.1 * k));
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}

// ---------------------------------------------------------------- leaves
function mapleLeaf(ctx, x, y, size, ang, tone, rnd, lobes = 7) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const palm = -size * 0.2;
  // petiole
  ctx.strokeStyle = g(tone * 0.6); ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, palm); ctx.stroke();
  const half = (lobes - 1) / 2;
  const grad = ctx.createRadialGradient(0, palm, size * 0.05, 0, palm, size * 0.75);
  grad.addColorStop(0, warm(tone * 1.0, 0.5)); grad.addColorStop(1, warm(tone * 0.8, -0.3));
  ctx.fillStyle = grad;
  const tips = [];
  for (let k = -half; k <= half; k++) {
    const a = k * (1.62 / half) + (rnd() - 0.5) * 0.08;
    const L = size * (0.62 - 0.26 * Math.pow(Math.abs(k) / half, 1.6)) * (0.92 + rnd() * 0.12);
    const w = L * (0.2 + rnd() * 0.04);
    const dx = Math.sin(a), dy = -Math.cos(a), px = -dy, py = dx;
    const tx = dx * L, ty = palm + dy * L;
    tips.push([tx, ty]);
    ctx.beginPath();
    ctx.moveTo(px * w * 0.45, palm + py * w * 0.45);
    ctx.quadraticCurveTo(dx * L * 0.5 + px * w * 1.25, palm + dy * L * 0.5 + py * w * 1.25, tx, ty);
    ctx.quadraticCurveTo(dx * L * 0.5 - px * w * 1.25, palm + dy * L * 0.5 - py * w * 1.25, -px * w * 0.45, palm - py * w * 0.45);
    ctx.closePath(); ctx.fill();
    // fine serration: little notches along the lobe
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    for (let s = 0.35; s < 0.9; s += 0.14) {
      for (const sg of [-1, 1]) {
        const ww = w * 1.1 * Math.sin(Math.PI * (0.25 + s * 0.75)) * (1 - s * 0.6);
        ctx.beginPath(); ctx.arc(dx * L * s + sg * px * ww * 1.05, palm + dy * L * s + sg * py * ww * 1.05, size * 0.012, 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, palm, size * 0.1, 0, 6.283); ctx.fill();
  ctx.strokeStyle = g(tone * 0.72, 0.8); ctx.lineWidth = Math.max(0.8, size * 0.012);
  for (const [tx, ty] of tips) { ctx.beginPath(); ctx.moveTo(0, palm); ctx.lineTo(tx * 0.86, palm + (ty - palm) * 0.86); ctx.stroke(); }
  ctx.restore();
}

function ginkgoLeaf(ctx, x, y, size, ang, tone, rnd) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const apex = -size * 0.32;
  ctx.strokeStyle = g(tone * 0.7); ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, apex); ctx.stroke();
  const R = size * 0.68, spread = 0.95 + rnd() * 0.15;
  const grad = ctx.createRadialGradient(0, apex, 2, 0, apex, R);
  grad.addColorStop(0, warm(tone * 0.86, 0.3)); grad.addColorStop(1, warm(tone, 0.6));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.moveTo(0, apex);
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = -spread + 2 * spread * t;
    let r = R * (0.93 + 0.05 * Math.sin(t * 40 + rnd()));
    if (Math.abs(t - 0.5) < 0.05) r *= 0.78;                 // central notch
    ctx.lineTo(Math.sin(a) * r, apex - Math.cos(a) * r);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = g(tone * 0.8, 0.45); ctx.lineWidth = 0.7;
  for (let i = 0; i < 14; i++) { const a = -spread * 0.95 + (2 * spread * 0.95) * i / 13; ctx.beginPath(); ctx.moveTo(0, apex); ctx.lineTo(Math.sin(a) * R * 0.92, apex - Math.cos(a) * R * 0.92); ctx.stroke(); }
  ctx.restore();
}

function smallLeaf(ctx, x, y, len, ang, tone) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = warm(tone, 0.2);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.38, -len * 0.45, 0, -len);
  ctx.quadraticCurveTo(-len * 0.38, -len * 0.45, 0, 0); ctx.fill();
  ctx.strokeStyle = g(tone * 0.75, 0.6); ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.85); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- spring tiles
// notched sakura petal pointing along -y from the origin
function petal(ctx, len, w) {
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(w * 0.9, -len * 0.25, w * 0.75, -len * 0.95, w * 0.22, -len);
  ctx.lineTo(0, -len * 0.86);
  ctx.lineTo(-w * 0.22, -len);
  ctx.bezierCurveTo(-w * 0.75, -len * 0.95, -w * 0.9, -len * 0.25, 0, 0);
  ctx.fill();
}
function blossom(ctx, x, y, r, rot, tone) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  for (let i = 0; i < 5; i++) {
    ctx.save(); ctx.rotate(i * 1.2566);
    const gr = ctx.createLinearGradient(0, 0, 0, -r);
    gr.addColorStop(0, g(tone * 0.72)); gr.addColorStop(0.45, g(tone * 0.95)); gr.addColorStop(1, g(tone));
    ctx.fillStyle = gr; petal(ctx, r, r * 0.62); ctx.restore();
  }
  ctx.fillStyle = g(tone * 0.86); ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, 6.283); ctx.fill();
  ctx.strokeStyle = g(tone * 0.8, 0.5); ctx.lineWidth = 0.8;
  for (let i = 0; i < 9; i++) { const a = i * 0.7; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36); ctx.stroke(); }
  ctx.restore();
}
function drawSpringTile(ctx, idx, rnd) {
  const cx = S / 2;
  if (TILE.sakura.includes(idx)) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = g(150); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, S); ctx.quadraticCurveTo(cx - 14, S * 0.7, cx, S * 0.55); ctx.stroke();
    const n = idx === 3 ? 30 : 24;
    const fl = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, r = Math.pow(rnd(), 0.6) * 96;
      fl.push([cx + Math.cos(a) * r, S * 0.47 + Math.sin(a) * r * 0.85, 20 + rnd() * 13, rnd() * 6.28, 200 + rnd() * 55]);
    }
    fl.sort((p, q) => p[4] - q[4]);
    for (const [x, y, r, a, t] of fl) {
      if (rnd() < 0.12) { ctx.fillStyle = g(150); ctx.beginPath(); ctx.ellipse(x, y, r * 0.3, r * 0.45, a, 0, 6.283); ctx.fill(); }  // bud
      else blossom(ctx, x, y, r, a, t);
    }
  } else if (idx === TILE.petal) {
    ctx.save(); ctx.translate(cx, S * 0.92);
    const gr = ctx.createLinearGradient(0, 0, 0, -S * 0.85);
    gr.addColorStop(0, g(185)); gr.addColorStop(0.4, g(240)); gr.addColorStop(1, g(255));
    ctx.fillStyle = gr; petal(ctx, S * 0.85, S * 0.62);
    ctx.restore();
  } else if (idx === TILE.flowers) {
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {   // narrow leaves
      const x = cx + (rnd() - 0.5) * 120, a = (rnd() - 0.5) * 1.2, L = 60 + rnd() * 70;
      ctx.strokeStyle = g(70); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, S); ctx.quadraticCurveTo(x + Math.sin(a) * L * 0.4, S - L * 0.6, x + Math.sin(a) * L, S - L); ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {   // flowers on thin stems
      const x = cx + (rnd() - 0.5) * 190, y = S * 0.18 + rnd() * S * 0.45;
      ctx.strokeStyle = g(80); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + (x - cx) * 0.3, S); ctx.quadraticCurveTo(x, S * 0.75, x, y); ctx.stroke();
      blossom(ctx, x, y, 15 + rnd() * 10, rnd() * 6.28, 235 + rnd() * 20);
    }
  }
}

// ---------------------------------------------------------------- tiles
function drawTile(ctx, idx, rnd) {
  if (IS_SPRING && (TILE.sakura.includes(idx) || idx === TILE.petal || idx === TILE.flowers)) {
    const ox = (idx % N) * S, oy = Math.floor(idx / N) * S;
    ctx.save(); ctx.translate(ox, oy); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
    drawSpringTile(ctx, idx, rnd);
    ctx.restore();
    return;
  }
  const ox = (idx % N) * S, oy = Math.floor(idx / N) * S;
  ctx.save(); ctx.translate(ox, oy);
  ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
  const cx = S / 2;
  if (TILE.maple.includes(idx)) {
    // twig from the bottom centre, leaves fanned around it
    const k = TILE.maple.indexOf(idx);
    ctx.strokeStyle = g(90); ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, S); ctx.quadraticCurveTo(cx - 10, S * 0.6, cx + 6, S * 0.35); ctx.stroke();
    const n = k === 3 ? 6 : 9 + k;
    const leaves = [];
    for (let i = 0; i < n; i++) {
      const a = (rnd() - 0.5) * 2.6;
      const r = 30 + rnd() * 72;
      leaves.push([cx + Math.sin(a) * r * 0.95, S * 0.52 - Math.cos(a) * r * 0.75 + 18, 64 + rnd() * 34, a * 0.85 + (rnd() - 0.5) * 0.5, 205 + rnd() * 50]);
    }
    leaves.sort((p, q) => p[4] - q[4]);
    for (const [x, y, s, a, t] of leaves) {
      ctx.strokeStyle = g(110); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx + 2, S * 0.55); ctx.lineTo(x, y); ctx.stroke();
      mapleLeaf(ctx, x, y, s, a, t, rnd, rnd() < 0.8 ? 7 : 5);
    }
  } else if (TILE.ginkgo.includes(idx)) {
    ctx.strokeStyle = g(110); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, S); ctx.lineTo(cx + 4, S * 0.4); ctx.stroke();
    const n = idx === 4 ? 11 : 8;
    for (let i = 0; i < n; i++) {
      const a = (rnd() - 0.5) * 2.7, r = 28 + rnd() * 70;
      ginkgoLeaf(ctx, cx + Math.sin(a) * r, S * 0.55 - Math.cos(a) * r * 0.8 + 14, 58 + rnd() * 26, a * 0.9, 215 + rnd() * 40, rnd);
    }
  } else if (TILE.pine.includes(idx)) {
    // a branchlet with 3-4 brush-like needle tufts
    ctx.lineCap = 'round';
    ctx.strokeStyle = g(100); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx, S); ctx.lineTo(cx, S * 0.45); ctx.stroke();
    const tufts = idx === 6 ? [[cx, S * 0.42, 0], [cx - 55, S * 0.62, -0.7], [cx + 55, S * 0.58, 0.7], [cx - 20, S * 0.78, -0.3]] : [[cx, S * 0.4, 0.1], [cx - 60, S * 0.55, -0.9], [cx + 62, S * 0.66, 0.8]];
    for (const [tx, ty, ta] of tufts) {
      for (let i = 0; i < 150; i++) {
        const a = ta + (rnd() - 0.5) * 2.4, L = 40 + rnd() * 62;
        ctx.strokeStyle = g(150 + rnd() * 105); ctx.lineWidth = 1.2 + rnd() * 0.9;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.sin(a) * L, ty - Math.cos(a) * L * 0.95); ctx.stroke();
      }
    }
  } else if (TILE.cedar.includes(idx)) {
    // sugi: rope-like sprays made of tiny awl needles
    const sprays = idx === 8 ? 5 : 4;
    for (let s = 0; s < sprays; s++) {
      const a0 = (s - (sprays - 1) / 2) * 0.42 + (rnd() - 0.5) * 0.2;
      let x = cx + (rnd() - 0.5) * 20, y = S - 4, a = a0 * 0.4;
      const len = 150 + rnd() * 80;
      for (let d = 0; d < len; d += 3) {
        a += (a0 - a) * 0.04 + (rnd() - 0.5) * 0.05;
        x += Math.sin(a) * 3; y -= Math.cos(a) * 3;
        const w = 13 * (1 - d / len * 0.6);
        for (let k = 0; k < 3; k++) {
          const side = rnd() < 0.5 ? -1 : 1, b = a + side * (0.9 + rnd() * 0.5);
          ctx.strokeStyle = g(150 + rnd() * 100); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(b) * w * rnd(), y - Math.cos(b) * w * rnd()); ctx.stroke();
        }
        if (d > 30 && rnd() < 0.05) { // side shoot
          let sx = x, sy = y, sa = a + (rnd() < 0.5 ? -1 : 1) * 0.8;
          for (let e = 0; e < 40; e += 3) { sx += Math.sin(sa) * 3; sy -= Math.cos(sa) * 3; for (let k = 0; k < 2; k++) { const b = sa + (rnd() - 0.5) * 3; ctx.strokeStyle = g(140 + rnd() * 100); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.sin(b) * 8, sy - Math.cos(b) * 8); ctx.stroke(); } }
        }
      }
    }
  } else if (idx === TILE.fern) {
    // pinnate frond, base at the bottom, gently curved
    ctx.lineCap = 'round';
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([cx + Math.sin(t * 2.2) * 18 * t, S - 6 - t * (S - 16)]); }
    ctx.strokeStyle = g(150); ctx.lineWidth = 2.5;
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    for (let i = 4; i < 40; i++) {
      const t = i / 40, [x, y] = pts[i];
      const L = 78 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - t * 0.35);
      for (const sd of [-1, 1]) {
        const a = sd * (1.15 - t * 0.35);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = warm(200 + rnd() * 45, -0.2);
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let k = 0; k <= 8; k++) { const u = k / 8; ctx.lineTo(L * 0.11 * (1 - u) * (0.75 + 0.25 * Math.sin(u * 25)), -L * u); }
        for (let k = 8; k >= 0; k--) { const u = k / 8; ctx.lineTo(-L * 0.11 * (1 - u) * (0.75 + 0.25 * Math.sin(u * 25 + 1)), -L * u); }
        ctx.fill(); ctx.restore();
      }
    }
  } else if (idx === TILE.shrub) {
    ctx.lineCap = 'round';
    for (let w = 0; w < 6; w++) {
      const x = cx + (rnd() - 0.5) * 150, y = S * 0.5 + (rnd() - 0.5) * 130;
      for (let i = 0; i < 7; i++) smallLeaf(ctx, x, y, 34 + rnd() * 22, i * 0.9 + rnd() * 0.4, 205 + rnd() * 50);
    }
    for (let i = 0; i < 26; i++) smallLeaf(ctx, cx + (rnd() - 0.5) * 190, S * 0.5 + (rnd() - 0.5) * 190, 26 + rnd() * 24, rnd() * 6.28, 200 + rnd() * 55);
  } else if (TILE.mapleLeaf.includes(idx)) {
    mapleLeaf(ctx, cx, S - 14, 200, 0, 240, rnd, idx === 12 ? 7 : 5);
  } else if (idx === TILE.ginkgoLeaf) {
    ginkgoLeaf(ctx, cx, S - 10, 220, 0, 240, rnd);
  } else if (idx === TILE.bark) {
    ctx.fillStyle = g(150); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = g(90 + rnd() * 120, 0.35); ctx.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 4, 10 + rnd() * 40); }
    ctx.fillStyle = g(255); ctx.fillRect(0, 0, 44, 44);   // solid white patch (crown cores) — see SOLID_UV
  }
  ctx.restore();
}

// Canvas -> RGBA DataTexture with transparent texels filled with the tile's mean colour (no dark fringes in mips).
function canvasToTexture(cv, tiles) {
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
  const tw = cv.width / tiles, th = cv.height / tiles;
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = ty * th; y < (ty + 1) * th; y += 2) for (let x = tx * tw; x < (tx + 1) * tw; x += 2) {
      const k = (y * cv.width + x) * 4; if (d[k + 3] > 200) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
    }
    if (!n) continue; r /= n; gg /= n; b /= n;
    for (let y = ty * th; y < (ty + 1) * th; y++) for (let x = tx * tw; x < (tx + 1) * tw; x++) {
      const k = (y * cv.width + x) * 4;
      if (d[k + 3] < 8) { d[k] = r; d[k + 1] = gg; d[k + 2] = b; }
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), cv.width, cv.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.flipY = false; tex.needsUpdate = true;
  return tex;
}

let _atlas = null;
export function foliageAtlas() {
  if (_atlas) return _atlas;
  const cv = document.createElement('canvas'); cv.width = cv.height = W;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(4242);
  for (let i = 0; i < N * N; i++) drawTile(ctx, i, rnd);
  _atlas = canvasToTexture(cv, N);
  _atlas.userData.canvas = cv;
  return _atlas;
}

// Pampas (susuki) plume: 128x512, base at the bottom (canvas bottom = v 1).
let _plume = null;
export function plumeTexture() {
  if (_plume) return _plume;
  const w = 128, h = 512;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(99);
  ctx.lineCap = 'round';
  // several drooping racemes from a short axis, covered in silky hairs
  const axisTop = h * 0.08;
  for (let r = 0; r < 9; r++) {
    const y0 = h - 20 - r * (h * 0.06);
    const side = (r % 2 ? 1 : -1) * (0.15 + rnd() * 0.35);
    const len = h * (0.55 + rnd() * 0.3) * (1 - r * 0.04);
    let x = w / 2, y = y0, a = side * 0.4;
    for (let d = 0; d < len; d += 2.5) {
      a += (side * 0.25 - a) * 0.03;
      x += Math.sin(a) * 2.5; y -= Math.cos(a) * 2.5;
      if (y < axisTop) break;
      const t = d / len;
      const hair = 9 + 16 * Math.sin(Math.PI * Math.min(1, t * 1.2));
      for (let k = 0; k < 4; k++) {
        const b = a + (rnd() - 0.5) * 2.2;
        const v = 200 + rnd() * 55;
        const warmK = 1 - t;
        ctx.strokeStyle = `rgba(${Math.min(255, v + 10)},${v - 8 * warmK},${v - 40 * warmK},${0.75})`;
        ctx.lineWidth = 0.9 + rnd() * 0.6;
        const hl = hair * (0.4 + rnd() * 0.6);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(b) * hl, y - Math.cos(b) * hl * 0.6 - 3); ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgb(170,150,110)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(w / 2, h * 0.3); ctx.stroke();
  _plume = canvasToTexture(cv, 1);
  return _plume;
}
