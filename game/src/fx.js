import * as THREE from 'three';
import { FX } from './textures.js';
import { rr, clamp, TAU, lerp } from './util.js';

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// ------------------------------------------------------------------ point particle system
const VERT = `
attribute float aSize; attribute vec4 aColor; attribute float aType;
varying vec4 vColor; varying float vType;
uniform float uScale;
void main(){
  vColor = aColor; vType = aType;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 300.0);
}`;
const FRAG = `
precision mediump float;
varying vec4 vColor; varying float vType;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0; float d = length(p); float a = 0.0;
  if (vType < 0.5) { a = 1.0 - smoothstep(0.0, 1.0, d); a = a * a * 1.3; }
  else if (vType < 1.5) { a = (max(abs(p.x), abs(p.y)) < 0.82) ? 1.0 : 0.0; }
  else if (vType < 2.5) { float s = max(0.0, 1.0 - abs(p.x) * 7.0) * max(0.0, 1.0 - abs(p.y)) + max(0.0, 1.0 - abs(p.y) * 7.0) * max(0.0, 1.0 - abs(p.x)); a = clamp(s + (1.0 - smoothstep(0.0, 0.55, d)) * 0.8, 0.0, 1.0); }
  else { a = 1.0 - smoothstep(0.0, 0.2, abs(d - 0.78)); }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

class PointSystem {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max); this.type = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3); this.a0 = new Float32Array(max);
    this.alive = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aType', new THREE.BufferAttribute(this.type, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }
  emit(o) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.alive[i] = 1;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
    this.life[i] = this.maxLife[i] = o.life || 0.6;
    this.s0[i] = o.size || 0.3; this.s1[i] = o.size1 === undefined ? this.s0[i] : o.size1;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
    _c.set(o.color === undefined ? 0xffffff : o.color);
    this.c0[i * 3] = _c.r; this.c0[i * 3 + 1] = _c.g; this.c0[i * 3 + 2] = _c.b;
    _c.set(o.color1 === undefined ? (o.color === undefined ? 0xffffff : o.color) : o.color1);
    this.c1[i * 3] = _c.r; this.c1[i * 3 + 1] = _c.g; this.c1[i * 3 + 2] = _c.b;
    this.a0[i] = o.alpha === undefined ? 1 : o.alpha;
    this.type[i] = o.type || 0;
  }
  update(dt) {
    const max = this.max;
    for (let i = 0; i < max; i++) {
      if (!this.alive[i]) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      let l = this.life[i] - dt;
      if (l <= 0) { this.alive[i] = 0; this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] = l;
      const k = 1 - l / this.maxLife[i];
      const d = this.drag[i]; const f = d ? Math.max(0, 1 - d * dt) : 1;
      this.vel[i * 3] *= f; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * f - this.grav[i] * dt; this.vel[i * 3 + 2] *= f;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.3; }
      this.col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * k;
      this.col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * k;
      this.col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * k;
      const fade = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
      this.col[i * 4 + 3] = this.a0[i] * fade;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aType.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ main FX manager
export class Effects {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.glow = new PointSystem(scene, 2600, true);
    this.soft = new PointSystem(scene, 900, false);
    this.t = 0;
    // voxel debris
    const N = 500; this.debrisN = N; this.debris = [];
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.castShadow = false; this.debrisMesh.frustumCulled = false;
    for (let i = 0; i < N; i++) { this.debrisMesh.setColorAt(i, _c.set(0xffffff)); this.debris.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, s: 0.1 }); }
    this.debrisMesh.instanceColor.needsUpdate = true;
    scene.add(this.debrisMesh); this.dhead = 0;
    _m.makeScale(0, 0, 0); for (let i = 0; i < N; i++) this.debrisMesh.setMatrixAt(i, _m);
    // rings
    this.rings = []; const rgeo = new THREE.PlaneGeometry(1, 1); rgeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(rgeo, new THREE.MeshBasicMaterial({ map: FX.ring, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      m.visible = false; m.renderOrder = 3; scene.add(m); this.rings.push({ mesh: m, t: 0, dur: 1, r0: 1, r1: 1, a: 1, on: false });
    }
    // slash arcs (flat crescents)
    this.slashes = []; const sgeo = new THREE.PlaneGeometry(1, 0.5); sgeo.rotateX(-Math.PI / 2); sgeo.translate(0.5, 0, 0);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ map: FX.slash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 6; scene.add(m); this.slashes.push({ mesh: m, t: 0, dur: 1, on: false, len: 3, a: 1 });
    }
    // bolts (voxel lightning segments)
    this.bolts = []; const bgeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(bgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.renderOrder = 7; scene.add(m); this.bolts.push({ mesh: m, t: 0, dur: 1, on: false, w: 0.1 });
    }
    this.boltHead = 0;
    // telegraphs
    this.tele = []; const tgeo = new THREE.PlaneGeometry(1, 1); tgeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, uniforms: { uProg: { value: 0 }, uShape: { value: 0 }, uColor: { value: new THREE.Color(0xff3030) }, uAlpha: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform float uProg; uniform float uShape; uniform vec3 uColor; uniform float uAlpha;
          void main(){ vec2 p = vUv*2.0-1.0; float a = 0.0;
            if (uShape < 0.5) { float d = length(p); if (d>1.0) discard; float ring = smoothstep(0.88,0.95,d); float fill = step(d, uProg); a = 0.16 + ring*0.55 + fill*0.35; }
            else { if (abs(p.x)>1.0) discard; float edge = smoothstep(0.85,0.97,abs(p.x)); float fill = step((p.y*0.5+0.5), uProg); a = 0.16 + edge*0.5 + fill*0.35; }
            gl_FragColor = vec4(uColor, a*uAlpha); }`,
      });
      const m = new THREE.Mesh(tgeo, mat); m.visible = false; m.renderOrder = 2; m.position.y = 0.09; scene.add(m);
      this.tele.push({ mesh: m, t: 0, dur: 1, on: false, cb: null });
    }
    // flash lights
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 14, 1.6); scene.add(l); this.lights.push({ light: l, t: 0, dur: 1, i0: 0, on: false }); }
    this.lightHead = 0;
    // damage numbers
    this.dmgRoot = document.getElementById('ui');
    this.dmg = []; this.dmgPool = [];
    // weapon trails
    this.trails = [];
    // floating sprites (glow torches)
    this.sprites = [];
  }

  setScale(hpx) { const v = hpx / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)); this.glow.mat.uniforms.uScale.value = v; this.soft.mat.uniforms.uScale.value = v; }

  // ---------- emitters
  p(o) { (o.add === false ? this.soft : this.glow).emit(o); }
  burst(x, y, z, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, b = (Math.random() - 0.3) * (o.up === undefined ? 1 : o.up);
      const sp = (o.speed || 4) * (0.4 + Math.random() * 0.8);
      this.p({ x, y, z, vx: Math.cos(a) * sp * (1 - Math.abs(b) * 0.4), vy: b * sp + (o.lift || 0), vz: Math.sin(a) * sp * (1 - Math.abs(b) * 0.4), life: (o.life || 0.5) * (0.6 + Math.random() * 0.7), size: (o.size || 0.3) * (0.6 + Math.random() * 0.8), size1: o.size1 === undefined ? 0 : o.size1, color: o.color, color1: o.color1, grav: o.grav || 0, drag: o.drag === undefined ? 1.5 : o.drag, type: o.type || 0, alpha: o.alpha, add: o.add });
    }
  }
  sparks(x, y, z, color = 0xffd070, n = 10, speed = 6) { this.burst(x, y, z, n, { color, color1: 0xff6a20, speed, size: 0.22, life: 0.4, grav: 14, type: 2, drag: 1 }); }
  smoke(x, y, z, n = 4, color = 0x888888, size = 1.0) { for (let i = 0; i < n; i++) this.p({ x: x + rr(-0.3, 0.3), y, z: z + rr(-0.3, 0.3), vx: rr(-0.5, 0.5), vy: rr(0.6, 1.6), vz: rr(-0.5, 0.5), life: rr(0.7, 1.2), size: size * rr(0.6, 1), size1: size * 2.2, color, alpha: 0.5, type: 0, drag: 0.5, add: false }); }
  fire(x, y, z, n = 1, scale = 1) {
    for (let i = 0; i < n; i++) this.p({ x: x + rr(-0.12, 0.12) * scale, y, z: z + rr(-0.12, 0.12) * scale, vx: rr(-0.3, 0.3), vy: rr(1.2, 2.4) * scale, vz: rr(-0.3, 0.3), life: rr(0.35, 0.65), size: 0.55 * scale, size1: 0.05, color: 0xffd04a, color1: 0xff3a10, alpha: 0.9 });
  }
  debrisBurst(x, y, z, n, color, speed = 5, size = 0.18) {
    for (let i = 0; i < n; i++) {
      const d = this.debris[this.dhead]; const idx = this.dhead; this.dhead = (this.dhead + 1) % this.debrisN;
      const a = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.8);
      d.life = d.max = rr(0.6, 1.1); d.x = x; d.y = y; d.z = z; d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = rr(2, speed * 1.1);
      d.rx = rr(0, TAU); d.ry = rr(0, TAU); d.rz = rr(0, TAU); d.wx = rr(-9, 9); d.wy = rr(-9, 9); d.wz = rr(-9, 9); d.s = size * rr(0.6, 1.3);
      const cc = Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color;
      _c.set(cc); const j = rr(0.8, 1.15); _c.multiplyScalar(j);
      this.debrisMesh.setColorAt(idx, _c);
    }
    this.debrisMesh.instanceColor.needsUpdate = true;
  }
  ring(x, z, r1, color = 0xffffff, dur = 0.5, r0 = 0.3, y = 0.15, alpha = 1) {
    let r = this.rings.find((q) => !q.on) || this.rings[0];
    r.on = true; r.t = 0; r.dur = dur; r.r0 = r0; r.r1 = r1; r.a = alpha; r.mesh.visible = true; r.mesh.position.set(x, y, z); r.mesh.material.color.set(color);
  }
  slash(x, y, z, ang, len, color = 0xffffff, dur = 0.22, flip = 1) {
    let r = this.slashes.find((q) => !q.on) || this.slashes[0];
    r.on = true; r.t = 0; r.dur = dur; r.len = len; r.mesh.visible = true; r.mesh.position.set(x, y, z); r.mesh.rotation.set(0, -ang, 0); r.mesh.material.color.set(color); r.flip = flip;
    r.mesh.scale.set(len * 0.4, 1, len * 0.4 * flip);
  }
  bolt(x0, y0, z0, x1, y1, z1, color = 0xaee6ff, w = 0.14, dur = 0.28, jag = 0.5) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; const len = Math.hypot(dx, dy, dz); const segs = Math.max(3, Math.floor(len / 0.9));
    let px = x0, py = y0, pz = z0;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs; let nx = x0 + dx * t, ny = y0 + dy * t, nz = z0 + dz * t;
      if (i < segs) { nx += rr(-jag, jag); ny += rr(-jag, jag) * 0.6; nz += rr(-jag, jag); }
      const b = this.bolts[this.boltHead]; this.boltHead = (this.boltHead + 1) % this.bolts.length;
      b.on = true; b.t = 0; b.dur = dur; b.w = w; b.mesh.visible = true;
      b.mesh.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      _v.set(nx - px, ny - py, nz - pz); const sl = _v.length(); _v.normalize();
      b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v);
      b.mesh.scale.set(w, w, sl + w); b.mesh.material.color.set(color); b.mesh.material.opacity = 1;
      px = nx; py = ny; pz = nz;
    }
    this.burst(x1, y1, z1, 6, { color, speed: 4, size: 0.2, life: 0.3, type: 2 });
  }
  telegraph(x, z, size, dur, { shape = 0, ang = 0, len = 1, color = 0xff3030, cb = null } = {}) {
    const t = this.tele.find((q) => !q.on) || this.tele[0];
    t.on = true; t.t = 0; t.dur = dur; t.cb = cb; t.mesh.visible = true; t.mesh.position.set(x, 0.09, z);
    const u = t.mesh.material.uniforms; u.uShape.value = shape; u.uColor.value.set(color); u.uProg.value = 0; u.uAlpha.value = 1;
    if (shape === 0) { t.mesh.scale.set(size * 2, 1, size * 2); t.mesh.rotation.set(0, 0, 0); }
    else { t.mesh.scale.set(size * 2, 1, len); t.mesh.rotation.set(0, -ang - Math.PI / 2, 0); t.mesh.position.x += Math.cos(ang) * len / 2; t.mesh.position.z += Math.sin(ang) * len / 2; }
    return t;
  }
  flashLight(x, y, z, color = 0xffaa55, intensity = 6, dur = 0.3) {
    const l = this.lights[this.lightHead]; this.lightHead = (this.lightHead + 1) % this.lights.length;
    l.on = true; l.t = 0; l.dur = dur; l.i0 = intensity; l.light.position.set(x, y, z); l.light.color.set(color); l.light.intensity = intensity;
  }
  // damage number
  number(x, y, z, text, cls = '') {
    let el = this.dmgPool.pop();
    if (!el) { el = document.createElement('div'); this.dmgRoot.appendChild(el); }
    el.className = 'dmg ' + cls; el.textContent = text; el.style.display = 'block';
    this.dmg.push({ el, x: x + rr(-0.25, 0.25), y, z: z + rr(-0.25, 0.25), t: 0, dur: cls.includes('crit') ? 1.0 : 0.8, vy: 2.2 });
    if (this.dmg.length > 40) { const o = this.dmg.shift(); o.el.style.display = 'none'; this.dmgPool.push(o.el); }
  }
  // weapon trail ribbon
  createTrail(color = 0xffffff, segs = 14) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(segs * 2 * 3), col = new Float32Array(segs * 2 * 4), idx = [];
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 8; this.scene.add(m);
    const tr = { mesh: m, pts: [], segs, color: new THREE.Color(color), active: false, fade: 0 };
    this.trails.push(tr); return tr;
  }
  trailPush(tr, base, tip) {
    tr.pts.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
    if (tr.pts.length > tr.segs) tr.pts.pop();
  }

  update(dt) {
    this.t += dt;
    this.glow.update(dt); this.soft.update(dt);
    // debris
    const m = this.debrisMesh;
    for (let i = 0; i < this.debrisN; i++) {
      const d = this.debris[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { _m.makeScale(0, 0, 0); m.setMatrixAt(i, _m); continue; }
      d.vy -= 18 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < d.s * 0.5) { d.y = d.s * 0.5; d.vy *= -0.35; d.vx *= 0.7; d.vz *= 0.7; d.wx *= 0.6; d.wy *= 0.6; d.wz *= 0.6; }
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      const sc = d.s * Math.min(1, d.life / 0.25);
      _e.set(d.rx, d.ry, d.rz); _q.setFromEuler(_e); _s.set(sc, sc, sc); _v.set(d.x, d.y, d.z);
      _m.compose(_v, _q, _s); m.setMatrixAt(i, _m);
    }
    m.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      if (!r.on) continue; r.t += dt; const k = r.t / r.dur;
      if (k >= 1) { r.on = false; r.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k); const rad = (r.r0 + (r.r1 - r.r0) * e) * 2;
      r.mesh.scale.set(rad, 1, rad); r.mesh.material.opacity = (1 - k) * r.a;
    }
    for (const s of this.slashes) {
      if (!s.on) continue; s.t += dt; const k = s.t / s.dur;
      if (k >= 1) { s.on = false; s.mesh.visible = false; continue; }
      const e = 1 - (1 - k) * (1 - k); const sc = s.len * (0.55 + 0.6 * e);
      s.mesh.scale.set(sc, 1, sc * 0.75 * (s.flip || 1)); s.mesh.material.opacity = (1 - k) * 0.95;
    }
    for (const b of this.bolts) {
      if (!b.on) continue; b.t += dt; const k = b.t / b.dur;
      if (k >= 1) { b.on = false; b.mesh.visible = false; continue; }
      b.mesh.material.opacity = (1 - k) * (0.6 + 0.4 * Math.random());
    }
    for (const t of this.tele) {
      if (!t.on) continue; t.t += dt; const k = t.t / t.dur;
      t.mesh.material.uniforms.uProg.value = Math.min(1, k);
      if (k >= 1) { t.on = false; t.mesh.visible = false; if (t.cb) { const cb = t.cb; t.cb = null; cb(); } }
    }
    for (const l of this.lights) {
      if (!l.on) continue; l.t += dt; const k = l.t / l.dur;
      if (k >= 1) { l.on = false; l.light.intensity = 0; continue; }
      l.light.intensity = l.i0 * (1 - k) * (1 - k);
    }
    // numbers
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.dmg.length - 1; i >= 0; i--) {
      const d = this.dmg[i]; d.t += dt;
      if (d.t >= d.dur) { d.el.style.display = 'none'; this.dmgPool.push(d.el); this.dmg.splice(i, 1); continue; }
      _v.set(d.x, d.y + d.t * d.vy * (1 - d.t / d.dur * 0.5), d.z).project(this.camera);
      const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
      const k = d.t / d.dur; const sc = k < 0.15 ? 0.6 + k / 0.15 * 0.7 : 1.3 - (k - 0.15) * 0.3;
      d.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${sc.toFixed(2)})`;
      d.el.style.opacity = k > 0.6 ? String(1 - (k - 0.6) / 0.4) : '1';
    }
    // trails
    for (const tr of this.trails) {
      const pos = tr.mesh.geometry.attributes.position.array, col = tr.mesh.geometry.attributes.color.array;
      for (const p of tr.pts) p.age += dt;
      while (tr.pts.length && tr.pts[tr.pts.length - 1].age > 0.28) tr.pts.pop();
      const n = tr.pts.length;
      for (let i = 0; i < tr.segs; i++) {
        const p = tr.pts[Math.min(i, n - 1)];
        const valid = n > 1 && i < n;
        const a = valid ? Math.max(0, 1 - p.age / 0.28) * (1 - i / tr.segs * 0.4) : 0;
        if (n) {
          pos[i * 6] = p.b.x; pos[i * 6 + 1] = p.b.y; pos[i * 6 + 2] = p.b.z; pos[i * 6 + 3] = p.t.x; pos[i * 6 + 4] = p.t.y; pos[i * 6 + 5] = p.t.z;
        }
        for (let k = 0; k < 2; k++) { col[i * 8 + k * 4] = tr.color.r; col[i * 8 + k * 4 + 1] = tr.color.g; col[i * 8 + k * 4 + 2] = tr.color.b; col[i * 8 + k * 4 + 3] = a * (k === 0 ? 0.15 : 0.9); }
      }
      tr.mesh.geometry.attributes.position.needsUpdate = true; tr.mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  clearAll() {
    this.glow.alive.fill(0); this.soft.alive.fill(0);
    for (const d of this.debris) d.life = 0;
    for (const r of this.rings) { r.on = false; r.mesh.visible = false; }
    for (const s of this.slashes) { s.on = false; s.mesh.visible = false; }
    for (const b of this.bolts) { b.on = false; b.mesh.visible = false; }
    for (const t of this.tele) { t.on = false; t.mesh.visible = false; t.cb = null; }
    for (const l of this.lights) { l.on = false; l.light.intensity = 0; }
    for (const d of this.dmg) { d.el.style.display = 'none'; this.dmgPool.push(d.el); } this.dmg.length = 0;
    for (const tr of this.trails) tr.pts.length = 0;
  }
}
