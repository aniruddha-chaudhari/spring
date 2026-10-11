// water/flow.js — the stream's velocity field (CPU). Shared by the water mesh attributes, the caustics flow texture
// and the floating leaves so everything drifts the same way.
import { streamAt, streamPoint, S_POND, S_RAPIDS, ANCHORS, clamp, smoothstep } from '../world.js';

const pondP = streamPoint(S_POND);
export const POND_C = { x: pondP.x, z: pondP.z, hw: pondP.hw };

// Obstacles that sit in the water (stepping stones + boulders whose footprint reaches into the channel).
// r = effective radius at the waterline, (tx, tz) = local flow direction.
export const obstacles = [];
for (const s of ANCHORS.steppingStones) {
  const st = streamAt(s.x, s.z);
  obstacles.push({ x: s.x, z: s.z, r: s.r * 0.95, tx: st.tx, tz: st.tz, kind: 'stone' });
}
for (const k of ANCHORS.rocks) {
  const st = streamAt(k.x, k.z);
  const r = k.s * 0.72;
  if (st.d < st.hw + r * 0.35) obstacles.push({ x: k.x, z: k.z, r, tx: st.tx, tz: st.tz, kind: 'rock' });
}

// flowAt(x, z) -> { x, z: velocity (m/s), speed, wake 0..1 (foam behind/around obstacles), turb 0..1 (rapids) }
const OUT = { x: 0, z: 0, speed: 0, wake: 0, turb: 0, st: null };
export function flowAt(x, z, out = OUT) {
  const st = streamAt(x, z);
  out.st = st;
  if (st.d > st.hw + 10) { out.x = out.z = out.speed = out.wake = out.turb = 0; return out; }
  // continuity: speed ~ discharge / cross-section, faster in the narrow shallow rapids, slow in the pond
  let sp = clamp(1.7 / (st.hw * st.depth), 0.05, 2.4);
  const q = Math.min(st.d / st.hw, 1.25);
  sp *= Math.max(0.1, 1 - 0.72 * q * q);                      // slower near the banks
  let vx = st.tx * sp, vz = st.tz * sp;
  // lazy eddy circling the pond
  const dx = x - POND_C.x, dz = z - POND_C.z, r = Math.hypot(dx, dz) + 1e-6;
  const sw = 0.34 * (r / 6) * Math.exp(-((r / 6) ** 2));
  vx += (-dz / r) * sw; vz += (dx / r) * sw;
  // potential flow around cylinders (stones/rocks) + wake foam behind them
  let wake = 0;
  for (const o of obstacles) {
    const ox = x - o.x, oz = z - o.z, r2 = ox * ox + oz * oz;
    const R = o.r, lim = R * 5;
    if (r2 > lim * lim) continue;
    const rr = Math.sqrt(r2);
    const a = ox * o.tx + oz * o.tz, b = -ox * o.tz + oz * o.tx;   // along / across the flow
    if (rr < R) { vx *= 0.05; vz *= 0.05; wake = Math.max(wake, 1); continue; }
    const U0 = vx * o.tx + vz * o.tz;
    const inv = (R * R) / (r2 * r2);
    const va = U0 * (1 - inv * (a * a - b * b)), vb = -U0 * inv * 2 * a * b;
    const bl = smoothstep(lim, R * 2.2, rr);
    const dva = (va - U0) * bl, dvb = vb * bl;
    vx += dva * o.tx - dvb * o.tz; vz += dva * o.tz + dvb * o.tx;
    // wake: a fan of foam downstream, plus a collar of foam hugging the stone
    const spd = clamp(Math.abs(U0) / 0.8, 0.25, 1.3);
    if (a > -R * 0.2) {
      const wdt = R * (0.45 + a / (R * 5));
      wake += Math.exp(-((b / wdt) ** 2)) * Math.exp(-Math.max(a, 0) / (R * 3.2 * spd)) * smoothstep(-R * 0.2, R * 0.9, a) * 0.6 * spd;
    }
    wake += Math.exp(-(((rr - R) / (0.1 + 0.08 * R)) ** 2)) * 0.4 * spd;
  }
  const speed = Math.hypot(vx, vz);
  const rap = Math.exp(-(((st.s - S_RAPIDS) / 9) ** 2));
  out.x = vx; out.z = vz; out.speed = speed;
  out.wake = clamp(wake, 0, 1);
  out.turb = clamp(rap * smoothstep(0.6, 1.6, speed) * 1.3 + smoothstep(1.6, 2.4, speed) * 0.4, 0, 1);
  return out;
}
