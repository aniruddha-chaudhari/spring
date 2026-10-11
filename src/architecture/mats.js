// mats.js — every material used by the architecture module (created once in makeMaterials()).
import { THREE, texMat, std, stoneMat, canvasTex, mulberry32 } from './kit.js';
import { IS_SPRING } from '../world.js';

// ---------------------------------------------------------------- canvas textures
function grain(g, w, h, rnd, n, cols, a = 0.08) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[Math.floor(rnd() * cols.length)];
    g.globalAlpha = a * rnd();
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  g.globalAlpha = 1;
}
// Shoji: washi paper with a kumiko lattice. Colour map + emissive map (bars block the glow).
function shojiTex(emissive) {
  const rnd = mulberry32(emissive ? 5 : 4);
  return canvasTex(256, 640, (g, w, h) => {
    g.fillStyle = emissive ? '#fff3dc' : '#efe6d0'; g.fillRect(0, 0, w, h);
    if (!emissive) { grain(g, w, h, rnd, 5000, ['#d8ccb2', '#fffaf0', '#c9bb9c'], 0.25); }
    else { for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,${200 + rnd() * 40 | 0},${140 + rnd() * 60 | 0},0.08)`; g.fillRect(rnd() * w, rnd() * h, 40, 60); } }
    const bar = emissive ? '#120a04' : '#c7a273';
    const kick = h * 0.16;
    g.fillStyle = emissive ? '#000' : '#b08a5c'; g.fillRect(0, h - kick, w, kick);           // koshi-ita kickboard
    if (!emissive) { g.fillStyle = 'rgba(80,50,20,0.25)'; for (let x = 0; x < w; x += 32) g.fillRect(x, h - kick, 2, kick); }
    g.fillStyle = bar;
    const cols = 3, rows = 8, top = 0, ph = h - kick;
    for (let i = 1; i < cols; i++) g.fillRect((i / cols) * w - 3, top, 6, ph);
    for (let j = 1; j < rows; j++) g.fillRect(0, top + (j / rows) * ph - 3, w, 6);
    g.fillRect(0, h - kick - 6, w, 6);
  });
}
function tatamiTex() {
  const rnd = mulberry32(21);
  // 6 x 4 unit layout, each mat 2 x 1 units. [x, y, horizontal?]
  const mats = [[0, 0, 1], [2, 0, 1], [4, 0, 0], [5, 0, 0], [0, 1, 0], [1, 1, 1], [3, 1, 0], [1, 2, 1], [4, 2, 1], [0, 3, 1], [2, 3, 1], [4, 3, 1]];
  return canvasTex(1536, 1024, (g, w, h) => {
    const ux = w / 6, uy = h / 4;
    g.fillStyle = '#3a3220'; g.fillRect(0, 0, w, h);
    for (const [x, y, hor] of mats) {
      const mw = (hor ? 2 : 1) * ux, mh = (hor ? 1 : 2) * uy, px = x * ux, py = y * uy;
      const base = [184 + rnd() * 14, 172 + rnd() * 12, 112 + rnd() * 14];
      g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
      g.fillRect(px + 2, py + 2, mw - 4, mh - 4);
      // woven straw lines along the long axis
      for (let k = 0; k < (hor ? mh : mw); k += 3) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '90,80,40' : '235,225,170'},${0.12 + rnd() * 0.12})`;
        if (hor) g.fillRect(px + 2, py + k, mw - 4, 1.2); else g.fillRect(px + k, py + 2, 1.2, mh - 4);
      }
      // heri (cloth border) on the two long edges
      g.fillStyle = '#1e2620';
      const t = 14;
      if (hor) { g.fillRect(px + 2, py + 2, mw - 4, t); g.fillRect(px + 2, py + mh - 2 - t, mw - 4, t); }
      else { g.fillRect(px + 2, py + 2, t, mh - 4); g.fillRect(px + mw - 2 - t, py + 2, t, mh - 4); }
    }
  }, { repeat: false });
}
function scrollTex() {
  const rnd = mulberry32(31);
  return canvasTex(192, 576, (g, w, h) => {
    g.fillStyle = '#3d4a3c'; g.fillRect(0, 0, w, h);                       // mounting silk
    g.fillStyle = '#7d6a3f'; g.fillRect(0, h * 0.12, w, 6); g.fillRect(0, h * 0.86, w, 6);
    g.fillStyle = '#efe7d3'; g.fillRect(20, h * 0.15, w - 40, h * 0.68);    // paper
    grain(g, w, h, rnd, 800, ['#d8cdb4'], 0.3);
    // an ensō circle in ink
    g.strokeStyle = '#1a1714'; g.lineCap = 'round';
    const cx = w / 2, cy = h * 0.36, R = 44;
    for (let i = 0; i < 60; i++) {
      const a0 = -1.2 + i * 0.095, a1 = a0 + 0.11;
      g.lineWidth = 9 * (1 - i / 75) + 2;
      g.globalAlpha = 0.85 - i * 0.006;
      g.beginPath(); g.arc(cx, cy, R + Math.sin(i * 0.3) * 1.5, a0, a1); g.stroke();
    }
    g.globalAlpha = 1;
    // a vertical line of brush strokes (calligraphy-ish)
    for (let i = 0; i < 4; i++) {
      const y = h * 0.52 + i * 34;
      g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 12, y); g.quadraticCurveTo(cx, y - 6, cx + 14, y + 2); g.stroke();
      g.lineWidth = 4; g.beginPath(); g.moveTo(cx + 2 * (rnd() - 0.5), y - 8); g.lineTo(cx + 4 * (rnd() - 0.5), y + 18); g.stroke();
    }
    g.fillStyle = '#b02a1a'; g.fillRect(cx + 20, h * 0.78, 9, 9);          // seal
  }, { repeat: false });
}
// Weathered vermilion lacquer: faded patches, darker grime streaks, a little bare wood.
function lacquerTex() {
  const rnd = mulberry32(41);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8402a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(222,120,80,0.10)' : 'rgba(150,40,22,0.10)';
      g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 60, 6 + rnd() * 30, rnd() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 90; i++) {               // grain-aligned streaks (u = along the member)
      g.fillStyle = `rgba(${rnd() < 0.6 ? '90,30,18' : '235,150,110'},${0.05 + rnd() * 0.1})`;
      g.fillRect(rnd() * w, rnd() * h, 40 + rnd() * 200, 1 + rnd() * 3);
    }
    for (let i = 0; i < 25; i++) { g.fillStyle = 'rgba(95,72,55,0.55)'; g.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 30, 1 + rnd() * 3); }
    grain(g, w, h, rnd, 4000, ['#7a2414', '#e08060'], 0.25);
  });
}
function bambooTex() {
  const rnd = mulberry32(51);
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#a8a058'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {                      // lengthwise fibres (v = along the cane)
      g.fillStyle = `rgba(${rnd() < 0.5 ? '70,75,30' : '220,210,140'},${rnd() * 0.18})`;
      g.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(110,90,50,${rnd() * 0.25})`; g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 10, 10 + rnd() * 50); }
  });
}
function glassTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#e8f4f6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a8fc0'; g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = '#d23a22';
    for (let i = 0; i < 3; i++) {                     // little goldfish
      const x = 30 + i * 85, y = 50 + (i % 2) * 18;
      g.beginPath(); g.ellipse(x, y, 13, 7, 0.2, 0, 7); g.fill();
      g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x - 22, y - 8); g.lineTo(x - 20, y + 9); g.fill();
    }
  });
}
function stripTex() {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#cfe0ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a4a6a'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(w / 2 - 6, 40 + i * 44); g.lineTo(w / 2 + 6, 52 + i * 44); g.stroke(); }
  }, { repeat: false });
}
// Andon / lantern paper: warm, slightly blotchy.
function paperTex() {
  const rnd = mulberry32(61);
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f2e6cc'; g.fillRect(0, 0, w, h);
    grain(g, w, h, rnd, 1500, ['#d9c6a0', '#fff6e0'], 0.35);
  });
}

// Red-white festival paper lantern (chōchin): bands at the ends, bamboo ribs.
function chochinTex() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#f4ead6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c0281c'; g.fillRect(0, 0, w, h * 0.2); g.fillRect(0, h * 0.8, w, h * 0.2);
    g.beginPath(); g.arc(w / 2, h / 2, 26, 0, 7); g.fill();
    g.fillStyle = 'rgba(90,60,30,0.35)'; for (let y = 6; y < h; y += 12) g.fillRect(0, y, w, 1.5);
  });
}

// ---------------------------------------------------------------- materials
export function makeMaterials() {
  const m = {};
  // wood
  m.hinoki = texMat('hinoki', 'hinoki_planks', { color: '#c9b293', roughness: 0.78, normalScale: 0.6 });
  m.timber = texMat('timber', 'hinoki_planks', { color: '#8f7860', roughness: 0.85, normalScale: 0.8 });      // aged posts/beams
  m.weathered = texMat('weathered', 'weathered_brown_planks', { color: '#c4b4a2', roughness: 0.9, normalScale: 0.9 });
  m.pier = texMat('pier', 'weathered_brown_planks', { color: '#7d6e5e', roughness: 0.88 });                  // in water (caustics)
  m.darkWood = texMat('darkWood', 'weathered_brown_planks', { color: '#5c4a3c', roughness: 0.8 });
  m.bark = texMat('bark', 'japanese_cedar_bark', { color: '#9a8070', roughness: 0.95, normalScale: 1.2 });
  // walls and roofs
  m.plaster = texMat('plaster', 'clay_plaster', { color: '#e9cf9f', roughness: 0.97, normalScale: 0.8 });
  m.thatch = texMat('thatch', 'reed_roof_04', { color: '#cfc2a6', roughness: 1, normalScale: 1.4 });
  m.tiles = texMat('tiles', 'grey_roof_tiles', { color: '#9aa09a', roughness: 0.7 });
  // stone
  if (!IS_SPRING) {
    m.stone = stoneMat('stone', { tint: '#a8a397', scale: 0.45, moss: 0.6, sat: 0.6 });                  // boulders, bank stones (caustics)
  } else {
    // spring onsen: pale, smooth, matte cream/warm-grey stone with an orange mineral band at the waterline
    m.stone = stoneMat('stone', { tint: '#ffffff', scale: 0.22, moss: 0.14, mossColor: '#6f7a45', sat: 0.12, norStr: 0.45, wet: 0.55, roughness: 0.96,
      onsen: { mineral: '#b9804f', wetRough: 0.85 } });
    m.stone.color.setRGB(1.3, 1.2, 1.03);
  }
  m.carved = stoneMat('carved', { tint: '#cfcabe', scale: 0.7, moss: 0.4, sat: 0.22, norStr: 0.9 });    // lanterns, footings, basins
  if (!IS_SPRING) m.river = stoneMat('river', { tint: '#9c968c', scale: 0.9, moss: 0.35, sat: 0.4, norStr: 0.8, roughness: 0.8 }); // pebbles (caustics)
  else {
    m.river = stoneMat('river', { tint: '#ffffff', scale: 0.5, moss: 0.05, sat: 0.12, norStr: 0.4, wet: 0.5, roughness: 0.95, onsen: { mineral: '#b9804f', wetRough: 0.85 } });
    m.river.color.setRGB(1.25, 1.16, 1.0);
  }
  // paint / metal
  const lac = lacquerTex();
  m.lacquer = std('lacquer', { map: lac, normalMap: m.hinoki.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.62, color: '#e2c6bb' });
  m.black = std('blackLacquer', { color: '#211c19', roughness: 0.55, normalMap: m.hinoki.normalMap, normalScale: new THREE.Vector2(0.2, 0.2) });
  m.bronze = std('bronze', { color: '#9a7a3c', metalness: 0.85, roughness: 0.38 });
  m.iron = std('iron', { color: '#2a2624', metalness: 0.6, roughness: 0.55 });
  // natural fibres
  m.bamboo = std('bamboo', { map: bambooTex(), color: '#ffffff', roughness: 0.45 });
  m.bambooDry = std('bambooDry', { map: m.bamboo.map, color: '#c9b48a', roughness: 0.6 });
  m.rope = std('rope', { color: '#d9c58c', roughness: 1, normalMap: m.thatch.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), emissive: '#2a2416', emissiveIntensity: 0.5 });
  m.paper = std('shide', { color: '#f6f3ea', roughness: 0.9, side: THREE.DoubleSide });
  m.cloth = std('cloth', { color: '#b8241a', roughness: 0.95, side: THREE.DoubleSide });
  m.cushion = std('cushion', { color: '#5a3550', roughness: 0.95 }, { outdoor: false });
  // interior / glowing
  m.shoji = std('shoji', { map: shojiTex(false), emissiveMap: shojiTex(true), emissive: '#ffb860', emissiveIntensity: 0, roughness: 0.92, side: THREE.DoubleSide, color: '#ffffff' });
  m.tatami = std('tatami', { map: tatamiTex(), roughness: 0.9, color: '#ffffff' }, { outdoor: false });
  m.scroll = std('scroll', { map: scrollTex(), roughness: 0.9, color: '#ffffff' }, { outdoor: false });
  const pt = paperTex();
  m.glowPaper = std('glowPaper', { map: pt, emissiveMap: pt, emissive: '#ffa648', emissiveIntensity: 0, roughness: 0.9, color: '#ffffff', side: THREE.DoubleSide });
  if (IS_SPRING) {
    const ct = chochinTex();
    m.chochin = std('chochin', { map: ct, emissiveMap: ct, emissive: '#ff9a52', emissiveIntensity: 0, roughness: 0.9, color: '#ffffff', side: THREE.DoubleSide });
  }
  m.water = std('basinWater', { color: '#1d2b2c', roughness: 0.42, metalness: 0 }); // not mirror-sharp: a tiny sun pinpoint blooms into a flashing orb
  // transparent bits (not batched with opaque)
  m.glass = new THREE.MeshStandardMaterial({ map: glassTex(), color: '#ffffff', transparent: true, opacity: 0.62, roughness: 0.45, side: THREE.DoubleSide });
  m.strip = new THREE.MeshStandardMaterial({ map: stripTex(), roughness: 0.9, side: THREE.DoubleSide });
  m.trickle = new THREE.MeshStandardMaterial({ color: '#dff4ff', transparent: true, opacity: 0.55, roughness: 0.45, emissive: '#9cc6d8', emissiveIntensity: 0.15, depthWrite: false });
  return m;
}
