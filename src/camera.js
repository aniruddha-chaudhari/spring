// camera.js — a smooth, Tiny Glade-style orbit camera for looking around the garden.
//
// State is (target, yaw, pitch, distance). Input only moves the *goal* state; the real camera eases toward it every
// frame, so every motion is smooth and interruptible. Highlights:
//   - left-drag orbits (with a little momentum on release), right/middle-drag or Shift+drag slides over the ground
//   - the wheel zooms toward whatever is under the cursor, and the view tilts lower as you get closer
//   - the focus point rides on the terrain, and the camera never sinks into hills or water
//   - double-click glides to a spot; WASD/arrows pan, Q/E turn, R/F or +/- zoom; touch: 1 finger orbit, 2 pinch/pan
// Exposes `target` (the smoothed focus point, used by depth of field / audio / particles) and update(dt).
import * as THREE from 'three';
import { groundHeight, WATER_Y, BORDER, clamp, lerp, smoothstep } from './world.js';

const MIN_DIST = 5, MAX_DIST = 120;
const MAX_PITCH = 1.38;                       // ~79°, nearly top-down
const minPitchFor = (d) => lerp(0.07, 0.3, smoothstep(12, 90, d));   // close up you may look almost level
const preferredPitch = (d) => lerp(0.26, 0.62, smoothstep(6, 80, d)); // zooming nudges the tilt toward this
const BOUND = BORDER + 14;                    // how far the focus point may wander from the glade centre

export class CameraRig {
  constructor(camera, dom, { target = new THREE.Vector3(0, 0.8, 0) } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.enabled = true;
    this.target = target.clone();             // current (smoothed)
    this.goal = { target: target.clone(), yaw: 0, pitch: 0.5, dist: 40 };
    this.cur = { yaw: 0, pitch: 0.5, dist: 40 };
    this.vel = { yaw: 0, pitch: 0 };          // orbit momentum (rad/s)
    this.keys = new Set();
    this.pointers = new Map();
    this.mode = null;                         // 'orbit' | 'pan' | 'touch'
    this.syncFromCamera();
    this._bind();
  }

  // Adopt the camera's current position / the given target as the new state (no easing).
  syncFromCamera(target = this.goal.target) {
    const off = this.camera.position.clone().sub(target);
    const dist = clamp(off.length(), MIN_DIST, MAX_DIST);
    const yaw = Math.atan2(off.x, off.z);
    const pitch = clamp(Math.asin(clamp(off.y / off.length(), -1, 1)), minPitchFor(dist), MAX_PITCH);
    this.goal.target.copy(target); this.target.copy(target);
    Object.assign(this.goal, { yaw, pitch, dist });
    Object.assign(this.cur, { yaw, pitch, dist });
    this._place();
  }

  // Plain-data snapshot of the full camera state (used to hand the view between the two season scenes).
  getState() {
    const g = this.goal, c = this.cur;
    return {
      target: this.target.toArray(), goalTarget: g.target.toArray(),
      goal: { yaw: g.yaw, pitch: g.pitch, dist: g.dist }, cur: { yaw: c.yaw, pitch: c.pitch, dist: c.dist },
    };
  }
  setState(s) {
    this.target.fromArray(s.target);
    this.goal.target.fromArray(s.goalTarget);
    Object.assign(this.goal, s.goal);
    Object.assign(this.cur, s.cur);
    this.vel.yaw = this.vel.pitch = 0;
    this.keys.clear(); this.pointers.clear(); this.mode = null;
    this._place();
  }

  // ---------------------------------------------------------------- input
  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => this._down(e));
    d.addEventListener('pointermove', (e) => this._move(e));
    d.addEventListener('pointerup', (e) => this._up(e));
    d.addEventListener('pointercancel', (e) => this._up(e));
    d.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    d.addEventListener('dblclick', (e) => this._dbl(e));
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '+', '=', '-', '_', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this.mode = null; });
    d.style.cursor = 'grab';
  }

  _down(e) {
    if (!this.enabled) return;
    try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch') {
      this.mode = this.pointers.size >= 2 ? 'touch' : 'orbit';
      this._touchRef = null;
    } else {
      this.mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit';
    }
    this.vel.yaw = this.vel.pitch = 0;
    this._lastMoveT = performance.now();
    this.dom.style.cursor = this.mode === 'pan' ? 'move' : 'grabbing';
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const now = performance.now(), dtm = Math.max((now - this._lastMoveT) / 1000, 1 / 240);
    this._lastMoveT = now;

    if (this.mode === 'touch' && this.pointers.size >= 2) { this._touch(); return; }
    if (this.mode === 'orbit') {
      const k = 2.6 / this.dom.clientHeight;   // a full-height drag ≈ 150°
      const dyaw = -dx * k, dpitch = dy * k;
      this.goal.yaw += dyaw;
      this.goal.pitch = clamp(this.goal.pitch + dpitch, minPitchFor(this.goal.dist), MAX_PITCH);
      // momentum: a smoothed estimate of the drag speed
      this.vel.yaw = lerp(this.vel.yaw, dyaw / dtm, 0.35);
      this.vel.pitch = lerp(this.vel.pitch, dpitch / dtm, 0.35);
    } else if (this.mode === 'pan') {
      this._panPixels(dx, dy);
    }
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    if (this.pointers.size === 0) {
      // no momentum if the pointer stopped before letting go
      if (performance.now() - this._lastMoveT > 90) this.vel.yaw = this.vel.pitch = 0;
      this.mode = null;
      this.dom.style.cursor = 'grab';
    } else if (this.pointers.size === 1) {
      this.mode = 'orbit';
      this._touchRef = null;
    }
  }

  _touch() {
    const [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, span = Math.hypot(a.x - b.x, a.y - b.y);
    if (this._touchRef) {
      const r = this._touchRef;
      this._panPixels(cx - r.cx, cy - r.cy);
      if (span > 10 && r.span > 10) this._zoomBy(r.span / span, cx, cy);
    }
    this._touchRef = { cx, cy, span };
  }

  // slide the focus over the ground so the world follows the pointer
  _panPixels(dx, dy) {
    const g = this.goal;
    const worldPerPx = (2 * g.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / this.dom.clientHeight;
    const s = worldPerPx * 1.05;
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);     // forward along the ground
    const rx = Math.cos(g.yaw), rz = -Math.sin(g.yaw);      // right
    // vertical drags move further when looking down at a shallow angle (ground is foreshortened)
    const fwdK = 1 / Math.max(Math.sin(g.pitch), 0.35);
    g.target.x += (-dx * rx + dy * fx * fwdK) * s;
    g.target.z += (-dx * rz + dy * fz * fwdK) * s;
    this.vel.yaw = this.vel.pitch = 0;
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;   // lines -> pixels
    this._zoomBy(Math.exp(clamp(delta, -240, 240) * 0.0014), e.clientX, e.clientY);
  }

  // factor < 1 zooms in. Zooming moves the focus toward the point under the cursor so it stays put on screen.
  _zoomBy(factor, sx, sy) {
    const g = this.goal;
    const nd = clamp(g.dist * factor, MIN_DIST, MAX_DIST);
    const k = 1 - nd / g.dist;
    const hit = this._groundUnder(sx, sy);
    if (hit && k > 0) {               // only steer toward the cursor when zooming in
      g.target.x += (hit.x - g.target.x) * k;
      g.target.z += (hit.z - g.target.z) * k;
    }
    g.dist = nd;
    // tilt gently toward a comfortable angle for this distance (lower when close, like Tiny Glade)
    g.pitch = clamp(lerp(g.pitch, preferredPitch(nd), 0.12 * Math.abs(Math.log(factor)) / 0.17), minPitchFor(nd), MAX_PITCH);
  }

  _groundUnder(sx, sy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // march along the ray to find the terrain (cheap and good enough at these scales)
    const o = ray.ray.origin, dir = ray.ray.direction;
    let prev = 0;
    for (let t = 0.5; t < 400; t *= 1.08) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y <= Math.max(groundHeight(x, z), WATER_Y)) {
        let a = prev, b = t;      // refine
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2, mx = o.x + dir.x * m, my = o.y + dir.y * m, mz = o.z + dir.z * m;
          if (my <= Math.max(groundHeight(mx, mz), WATER_Y)) b = m; else a = m;
        }
        return new THREE.Vector3(o.x + dir.x * b, 0, o.z + dir.z * b);
      }
      prev = t;
    }
    return null;
  }

  _dbl(e) {
    const hit = this._groundUnder(e.clientX, e.clientY);
    if (!hit) return;
    this.goal.target.x = hit.x; this.goal.target.z = hit.z;
    this.goal.dist = Math.min(this.goal.dist, 26);
    this.goal.pitch = clamp(Math.min(this.goal.pitch, preferredPitch(this.goal.dist) + 0.1), minPitchFor(this.goal.dist), MAX_PITCH);
    this.vel.yaw = this.vel.pitch = 0;
  }

  _keys(dt) {
    if (!this.keys.size) return;
    const has = (...k) => k.some(x => this.keys.has(x));
    const pan = 520 * dt;   // in "pixels" so it scales with distance like mouse panning
    if (has('w', 'arrowup')) this._panPixels(0, pan);
    if (has('s', 'arrowdown')) this._panPixels(0, -pan);
    if (has('a', 'arrowleft')) this._panPixels(pan, 0);
    if (has('d', 'arrowright')) this._panPixels(-pan, 0);
    if (has('q')) this.goal.yaw += 1.4 * dt;
    if (has('e')) this.goal.yaw -= 1.4 * dt;
    const cx = this.dom.clientWidth / 2 + this.dom.getBoundingClientRect().left;
    const cy = this.dom.clientHeight / 2 + this.dom.getBoundingClientRect().top;
    if (has('r', '+', '=')) this._zoomBy(Math.exp(-1.6 * dt), cx, cy);
    if (has('f', '-', '_')) this._zoomBy(Math.exp(1.6 * dt), cx, cy);
  }

  // ---------------------------------------------------------------- per frame
  update(dt = 1 / 60) {
    dt = Math.min(dt, 0.1);
    const g = this.goal, c = this.cur;
    this._keys(dt);

    // orbit momentum (only while not dragging)
    if (!this.mode && (Math.abs(this.vel.yaw) > 1e-3 || Math.abs(this.vel.pitch) > 1e-3)) {
      g.yaw += this.vel.yaw * dt;
      g.pitch += this.vel.pitch * dt;
      const decay = Math.exp(-dt * 5.5);
      this.vel.yaw *= decay; this.vel.pitch *= decay;
    }

    // constraints on the goal
    g.dist = clamp(g.dist, MIN_DIST, MAX_DIST);
    g.pitch = clamp(g.pitch, minPitchFor(g.dist), MAX_PITCH);
    // soft bounds: the focus may stray a little past the glade and is eased back
    const bx = clamp(g.target.x, -BOUND, BOUND), bz = clamp(g.target.z, -BOUND, BOUND);
    g.target.x += (bx - g.target.x) * Math.min(1, dt * 6);
    g.target.z += (bz - g.target.z) * Math.min(1, dt * 6);
    // the focus rides on the land (or the water surface)
    g.target.y = Math.max(groundHeight(g.target.x, g.target.z), WATER_Y) + 0.6;

    // ease the real state toward the goal (frame-rate independent)
    const kRot = 1 - Math.exp(-dt * 12), kZoom = 1 - Math.exp(-dt * 9), kPan = 1 - Math.exp(-dt * 10);
    c.yaw += (g.yaw - c.yaw) * kRot;
    c.pitch += (g.pitch - c.pitch) * kRot;
    c.dist += (g.dist - c.dist) * kZoom;
    this.target.lerp(g.target, kPan);
    this._place();
  }

  _place() {
    const c = this.cur, t = this.target, cam = this.camera;
    const cp = Math.cos(c.pitch);
    cam.position.set(t.x + Math.sin(c.yaw) * cp * c.dist, t.y + Math.sin(c.pitch) * c.dist, t.z + Math.cos(c.yaw) * cp * c.dist);
    // never sink into a hill or below the water: lift the camera, and remember the tilt so it doesn't fight back
    const floor = Math.max(groundHeight(cam.position.x, cam.position.z), WATER_Y) + 0.9;
    if (cam.position.y < floor) {
      cam.position.y = floor;
      const need = Math.asin(clamp((floor - t.y) / c.dist, -1, 1));
      if (need > this.goal.pitch) this.goal.pitch = Math.min(need, MAX_PITCH);
    }
    cam.lookAt(t);
  }
}
