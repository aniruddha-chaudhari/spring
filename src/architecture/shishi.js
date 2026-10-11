// shishi.js — shishi-odoshi (deer scarer): a bamboo spout trickles into a pivoting bamboo tube; it slowly fills, tips,
// pours into a stone basin and swings back to knock on a stone (every ~7 s). Knocks are reported via callbacks.
import { ANCHORS, groundHeight } from '../world.js';
import { THREE, V3, M, Batch, lathe, rockGeo, jitter, mulberry32, PI, TAU, lerp, smoothstep, noise3, canvasTex } from './kit.js';

const PERIOD = 7.0, T_TIP = 5.0, T_POURED = 5.45, T_BACK = 6.1, T_KNOCK = 6.42;
const A_REST = -0.42, A_FULL = -0.3, A_TIP = 0.55;

export function buildShishi(B, m, root, onKnockFire) {
  const S = ANCHORS.shishiodoshi;
  const rnd = mulberry32(505);
  const cr = Math.cos(S.rot), sr = Math.sin(S.rot);
  const toW = (lx, lz) => [S.x + cr * lx + sr * lz, S.z - sr * lx + cr * lz];
  const gAt = (lx, lz) => { const [x, z] = toW(lx, lz); return groundHeight(x, z); };
  // step back from the water edge until the whole device (front basin included) stands on dry ground
  let oz = 0;
  for (let k = 0; k < 30; k++) { if (gAt(0, oz + 0.5) > 0.06 && gAt(0, oz - 0.6) > 0.06) break; oz -= 0.1; }
  const gy = gAt(0, oz);
  const base = M(...(() => { const [x, z] = toW(0, oz); return [x, gy, z]; })(), S.rot);
  const add = (mat, geo, lm = null, o = {}) => B.add(mat, geo, lm ? base.clone().multiply(lm) : base, { tint: jitter(rnd, 0.06), ...o });
  const ly = (lx, lz) => gAt(lx, lz + oz) - gy;   // local ground height relative to the device origin
  const rod = (mat, a, b, r, o = {}) => {
    const A = new V3(...a), Bv = new V3(...b), d = new V3().subVectors(Bv, A), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize());
    const mm = new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), q, new V3(1, 1, 1));
    add(mat, new THREE.CylinderGeometry(r, r, len, o.seg || 10, 1, false), mm, o);
    // bamboo nodes
    if (o.nodes) for (let t = 0.2 + rnd() * 0.15; t < 0.95; t += 0.3 + rnd() * 0.1) {
      const p = A.clone().lerp(Bv, t);
      add(mat, new THREE.TorusGeometry(r, r * 0.12, 5, 12), new THREE.Matrix4().compose(p, q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), PI / 2)), new V3(1, 1, 1)), { tint: [0.75, 0.72, 0.55] });
    }
  };

  const PIV = 0.48, BACK = 0.38, FRONT = 0.47;
  // ---- stones: basin in front, knock stone behind, a few around
  const basinZ = FRONT * Math.cos(A_TIP) + 0.02;
  const bprof = [[0.0, -0.12], [0.3, -0.12], [0.36, 0.0], [0.35, 0.09], [0.3, 0.15], [0.21, 0.17], [0.17, 0.14], [0.1, 0.1], [0, 0.095]];
  add(m.carved, lathe(bprof, { segs: 28, warp: (x, y, z) => { const n = 0.04 * noise3(x * 4 + 3, y * 4, z * 4); return [x * (1 + n), y, z * (1 + n) * 0.85]; } }), M(0, ly(0, basinZ) - 0.02, basinZ, 0.3), { tint: [1, 1, 1] });
  add(m.water, new THREE.CircleGeometry(0.15, 20).rotateX(-PI / 2), M(0, ly(0, basinZ) + 0.13, basinZ, 0, 0, 0, 1.15, 1, 0.95), { tint: [1, 1, 1], shadow: false });
  const backZ = -BACK * Math.cos(A_REST);
  const knockTop = PIV + BACK * Math.sin(A_REST) - 0.05;      // y of the tube's back end at rest minus its radius
  const kh = knockTop - ly(0, backZ) + 0.12;
  add(m.carved, rockGeo(5501, { detail: 3, scale: [0.16, kh / 2, 0.14], flatTop: kh / 2 - 0.02, facets: 5, bump: 0.12 }), M(0, knockTop - kh / 2 + 0.02, backZ - 0.02, 0.4));
  for (const [x, z, s] of [[0.42, 0.25, 0.2], [-0.4, 0.45, 0.16], [0.5, -0.3, 0.14], [-0.35, -0.55, 0.22], [0.25, 0.75, 0.12]]) {
    add(m.stone, rockGeo(5510 + Math.floor(x * 100), { detail: 3, scale: [s * 1.3, s * 0.8, s], facets: 4 }), M(x, ly(x, z) + s * 0.15, z, rnd() * TAU));
  }
  // ---- frame: two bamboo posts with an axle
  for (const sx of [-1, 1]) rod(m.bamboo, [sx * 0.085, ly(sx * 0.085, 0) - 0.1, 0], [sx * 0.085, PIV + 0.12, 0], 0.028, { nodes: true, tint: [0.9, 0.92, 0.8] });
  rod(m.bambooDry, [-0.12, PIV, 0], [0.12, PIV, 0], 0.012, { seg: 6 });
  for (const sx of [-1, 1]) add(m.bamboo, new THREE.CircleGeometry(0.028, 10).rotateX(-PI / 2), M(sx * 0.085, PIV + 0.12, 0), { tint: [0.55, 0.5, 0.35] });
  // ---- water supply: a post and a long spout pipe above the tube mouth
  const mouthRest = new V3(0, PIV + FRONT * Math.sin(-A_REST) + 0.02, FRONT * Math.cos(A_REST));
  const spoutEnd = new V3(0.0, mouthRest.y + 0.16, mouthRest.z - 0.08);
  rod(m.bamboo, [-0.32, ly(-0.32, -0.15) - 0.1, -0.15], [-0.32, spoutEnd.y + 0.12, -0.15], 0.035, { nodes: true, tint: [0.92, 0.95, 0.8] });
  add(m.bamboo, new THREE.CircleGeometry(0.035, 10).rotateX(-PI / 2), M(-0.32, spoutEnd.y + 0.12, -0.15), { tint: [0.5, 0.45, 0.32] });
  rod(m.bamboo, [-0.34, spoutEnd.y + 0.06, -0.15], [spoutEnd.x, spoutEnd.y, spoutEnd.z], 0.02, { tint: [0.95, 1, 0.82] });
  rod(m.bamboo, [-0.32, spoutEnd.y + 0.06, -0.17], [-0.62, ly(-0.62, -1.0) + 0.02, -1.0], 0.022, { tint: [0.85, 0.85, 0.7] });
  add(m.stone, rockGeo(5590, { detail: 3, scale: [0.26, 0.2, 0.22], facets: 4 }), M(-0.66, ly(-0.66, -1.08) + 0.04, -1.08, 0.7));

  // ---- the pivoting tube (separate group, its own small batch)
  const pivot = new THREE.Group();
  pivot.position.set(0, PIV, 0);
  const tubeHolder = new THREE.Group();
  tubeHolder.applyMatrix4(base);
  tubeHolder.add(pivot);
  root.add(tubeHolder);
  {
    const TB = new Batch();
    const R = 0.052, len = BACK + FRONT;
    const tube = new THREE.CylinderGeometry(R, R, len, 16, 6, true);
    const p = tube.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > len / 2 - 1e-3) p.setY(i, y + (p.getZ(i) / R) * 0.075);   // angled mouth, lower lip longer
    }
    tube.computeVertexNormals();
    tube.rotateX(PI / 2).translate(0, 0, (FRONT - BACK) / 2);           // along +Z, pivot at origin
    const tubeMat = m.bamboo.clone(); tubeMat.side = THREE.DoubleSide; tubeMat.onBeforeCompile = m.bamboo.onBeforeCompile; tubeMat.customProgramCacheKey = m.bamboo.customProgramCacheKey;
    TB.add(tubeMat, tube, null, { tint: [1, 1, 0.9] });
    TB.add(m.bamboo, new THREE.CircleGeometry(R, 16), M(0, 0, -BACK, PI), { tint: [0.6, 0.55, 0.38] });
    TB.add(m.bamboo, new THREE.CircleGeometry(R * 0.97, 16), M(0, 0, 0.2), { tint: [0.25, 0.22, 0.15] });   // inner node (dark)
    for (const z of [-BACK + 0.03, 0.2]) TB.add(m.bamboo, new THREE.TorusGeometry(R, 0.007, 5, 16), M(0, 0, z), { tint: [0.75, 0.7, 0.5] });
    TB.build(pivot, 'shishi');
  }
  // ---- water: spout trickle (always) + pour (while tipped)
  const flowTex = canvasTex(16, 128, (g, w, h) => {
    const r = mulberry32(9);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h, 2 + r() * 3, 6 + r() * 16); }
  });
  const flowMat = m.trickle.clone(); flowMat.map = flowTex; flowMat.alphaMap = flowTex; flowMat.needsUpdate = true;
  const trickle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 1, 6, 1, true), flowMat);
  tubeHolder.add(trickle);
  const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 1, 8, 1, true), flowMat);
  tubeHolder.add(pour);
  const spoutTip = spoutEnd.clone().add(new V3(0, -0.012, 0.012));

  const knockWorld = new V3(0, knockTop, backZ).applyMatrix4(base);
  let prev = 0, phaseT = 1.2;
  const mouth = new V3();
  const angleAt = (p) => {
    if (p < T_TIP) { const k = p / T_TIP; return lerp(A_REST, A_FULL, k * k); }
    if (p < T_POURED) { const k = (p - T_TIP) / (T_POURED - T_TIP); return lerp(A_FULL, A_TIP, k * k * (3 - 2 * k)); }
    if (p < T_BACK) { const k = (p - T_POURED) / (T_BACK - T_POURED); return A_TIP - 0.05 * Math.sin(k * PI) * (1 - k); }
    if (p < T_KNOCK) { const k = (p - T_BACK) / (T_KNOCK - T_BACK); return lerp(A_TIP, A_REST, k * k); }
    const k = (p - T_KNOCK) / (PERIOD - T_KNOCK);
    return A_REST + 0.07 * Math.abs(Math.sin(k * PI * 2.2)) * Math.exp(-k * 4);
  };
  const place = (mesh, a, b, rTop = 1) => {
    const d = new V3().subVectors(b, a), len = Math.max(d.length(), 0.001);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
    mesh.scale.set(rTop, len, rTop);
  };
  return {
    knockWorld,
    update(dt, t) {
      phaseT = (phaseT + dt) % PERIOD;
      const p = phaseT;
      if ((prev < T_KNOCK && p >= T_KNOCK) || (prev > p && T_KNOCK > prev)) onKnockFire(knockWorld);
      prev = p;
      const a = angleAt(p);
      pivot.rotation.x = a;
      // mouth (front lip) position in device space
      mouth.set(0, Math.sin(-a) * FRONT + PIV + 0.03, Math.cos(a) * FRONT);
      const wob = 1 + 0.15 * Math.sin(t * 23);
      // the trickle falls straight down from the spout onto the tube (or past it into the basin when tipped)
      const reach = FRONT * Math.cos(a);
      const yHit = spoutTip.z < reach - 0.02 ? PIV - Math.tan(a) * spoutTip.z + 0.03 : ly(0, spoutTip.z) + 0.13;
      place(trickle, spoutTip, new V3(spoutTip.x, Math.min(yHit, spoutTip.y - 0.02), spoutTip.z + 0.001), wob);
      const pouring = p > T_TIP + 0.3 && p < T_BACK + 0.05;
      pour.visible = pouring;
      if (pouring) {
        const k = smoothstep(T_TIP + 0.3, T_POURED + 0.1, p) * (1 - smoothstep(T_BACK - 0.2, T_BACK + 0.05, p));
        const end = new V3(0, ly(0, basinZ) + 0.13, basinZ + 0.04);
        place(pour, mouth.clone().add(new V3(0, -0.02, 0.02)), end, 0.3 + 0.9 * k);
      }
      flowTex.offset.y = (flowTex.offset.y + dt * 2.5) % 1;
    },
  };
}
