import * as THREE from 'three';
import { RNG, clamp, TAU, hash2 } from './util.js';
import { biomeTextures, FX } from './textures.js';
import { boxGeo, lam, part, emissiveMat } from './voxel.js';

export const CS = 2; // world units per grid cell

export const BIOMES = {
  camp:    { id: 'camp', name: 'Adventurer Camp', sky: 0x0b1030, fog: 0x0b1030, fogD: 0.012, hemi: [0x5a6aa8, 0x1a1a2a, 0.85], sun: [0x8fa8ff, 0.7], sunDir: [-0.5, 1, 0.6], torch: 0xffa040, tex: 'meadow', wallH: 4.2, exposure: 1.0 },
  meadow:  { id: 'meadow', name: 'Sunlit Meadows', sky: 0x8fd0ff, fog: 0x9fd8f0, fogD: 0.010, hemi: [0xcfe8ff, 0x4a6a30, 1.05], sun: [0xfff2d0, 2.0], sunDir: [-0.5, 1, 0.45], torch: 0xffb050, tex: 'meadow', wallH: 4.0, exposure: 1.05 },
  crypt:   { id: 'crypt', name: 'Forgotten Crypt', sky: 0x0e0c16, fog: 0x14101c, fogD: 0.022, hemi: [0x7a76a8, 0x1c1620, 0.75], sun: [0xaab4ff, 0.9], sunDir: [-0.4, 1, 0.5], torch: 0xffa43c, tex: 'crypt', wallH: 3.2, exposure: 1.1 },
  sands:   { id: 'sands', name: 'Sunscorched Sanctum', sky: 0xf0c080, fog: 0xe4b878, fogD: 0.014, hemi: [0xffe6b8, 0x8a6a3a, 1.0], sun: [0xfff0c0, 2.1], sunDir: [-0.6, 1, 0.3], torch: 0x66d8ff, tex: 'sands', wallH: 3.4, exposure: 1.05 },
  frost:   { id: 'frost', name: 'Frostbite Hollow', sky: 0x9ac4ea, fog: 0xa8cce8, fogD: 0.016, hemi: [0xdcf0ff, 0x5a7a9a, 0.95], sun: [0xe0f0ff, 1.7], sunDir: [-0.3, 1, 0.6], torch: 0x7fd8ff, tex: 'frost', wallH: 3.4, exposure: 1.05 },
  inferno: { id: 'inferno', name: 'Molten Depths', sky: 0x1c0806, fog: 0x2a0c08, fogD: 0.024, hemi: [0xa86a58, 0x2a0c08, 0.7], sun: [0xff9a68, 1.0], sunDir: [-0.4, 1, 0.5], torch: 0xff6a20, tex: 'inferno', wallH: 3.4, exposure: 1.15 },
  void:    { id: 'void', name: 'The Void Spire', sky: 0x08040f, fog: 0x0d0618, fogD: 0.026, hemi: [0x9a7ad8, 0x1a0c2c, 0.75], sun: [0xc89aff, 1.0], sunDir: [-0.4, 1, 0.5], torch: 0xc86aff, tex: 'void', wallH: 3.6, exposure: 1.15 },
};

// tile kinds
export const T_WALL = 0, T_FLOOR = 1, T_LIQUID = 2, T_PILLAR = 3, T_CORR = 4;

// -------------------------------------------------------------- level class
export class Level {
  constructor(w, h, biome) {
    this.w = w; this.h = h; this.biome = biome;
    this.grid = new Uint8Array(w * h);
    this.room = new Int16Array(w * h).fill(-1);
    this.rooms = []; this.props = []; this.torches = []; this.chests = []; this.dist = null;
    this.propGrid = new Map(); this.flowDist = new Int16Array(w * h); this.flowStamp = -1;
    this.start = { x: 0, z: 0 }; this.exit = null; this.group = new THREE.Group();
    this.updaters = [];
  }
  idx(cx, cz) { return cz * this.w + cx; }
  inb(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  tile(cx, cz) { return this.inb(cx, cz) ? this.grid[cz * this.w + cx] : T_WALL; }
  solidCell(cx, cz) { const t = this.tile(cx, cz); return t === T_WALL || t === T_LIQUID || t === T_PILLAR; }
  walkable(cx, cz) { const t = this.tile(cx, cz); return t === T_FLOOR || t === T_CORR; }
  cx(x) { return Math.floor(x / CS); }
  cellCenter(cx, cz) { return { x: (cx + 0.5) * CS, z: (cz + 0.5) * CS }; }
  roomAt(x, z) { const cx = this.cx(x), cz = this.cx(z); return this.inb(cx, cz) ? this.room[cz * this.w + cx] : -1; }

  addProp(p) {
    p.r = p.r === undefined ? 0.6 : p.r;
    this.props.push(p);
    if (p.solid || p.breakable) {
      const cx0 = Math.floor((p.x - p.r) / CS), cx1 = Math.floor((p.x + p.r) / CS), cz0 = Math.floor((p.z - p.r) / CS), cz1 = Math.floor((p.z + p.r) / CS);
      for (let a = cx0; a <= cx1; a++) for (let b = cz0; b <= cz1; b++) { const k = b * this.w + a; let l = this.propGrid.get(k); if (!l) this.propGrid.set(k, l = []); l.push(p); }
    }
    return p;
  }
  removeProp(p) {
    p.dead = true;
    const i = this.props.indexOf(p); if (i >= 0) this.props.splice(i, 1);
    for (const l of this.propGrid.values()) { const j = l.indexOf(p); if (j >= 0) l.splice(j, 1); }
    if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
  }

  // push a circle out of walls / solid props. returns true if hit something
  resolve(pos, r) {
    let hit = false;
    const cx0 = Math.floor((pos.x - r) / CS), cx1 = Math.floor((pos.x + r) / CS), cz0 = Math.floor((pos.z - r) / CS), cz1 = Math.floor((pos.z + r) / CS);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      if (this.solidCell(cx, cz)) {
        const minx = cx * CS, maxx = minx + CS, minz = cz * CS, maxz = minz + CS;
        const qx = clamp(pos.x, minx, maxx), qz = clamp(pos.z, minz, maxz);
        let dx = pos.x - qx, dz = pos.z - qz; const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          hit = true;
          if (d2 > 1e-8) { const d = Math.sqrt(d2), push = r - d; pos.x += dx / d * push; pos.z += dz / d * push; }
          else { // centre inside block: push out along shortest axis
            const l = pos.x - minx, rr_ = maxx - pos.x, t = pos.z - minz, b = maxz - pos.z; const m = Math.min(l, rr_, t, b);
            if (m === l) pos.x = minx - r; else if (m === rr_) pos.x = maxx + r; else if (m === t) pos.z = minz - r; else pos.z = maxz + r;
          }
        }
      }
      const pl = this.propGrid.get(cz * this.w + cx);
      if (pl) for (const p of pl) {
        if (!p.solid || p.dead) continue;
        const dx = pos.x - p.x, dz = pos.z - p.z, rr2 = (r + p.r) * (r + p.r), d2 = dx * dx + dz * dz;
        if (d2 < rr2 && d2 > 1e-8) { const d = Math.sqrt(d2), push = r + p.r - d; pos.x += dx / d * push; pos.z += dz / d * push; hit = true; }
      }
    }
    return hit;
  }
  los(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz); const steps = Math.ceil(d / (CS * 0.45));
    for (let i = 1; i < steps; i++) { const t = i / steps; if (this.solidCell(this.cx(x0 + dx * t), this.cx(z0 + dz * t))) { if (this.tile(this.cx(x0 + dx * t), this.cx(z0 + dz * t)) !== T_LIQUID) return false; } }
    return true;
  }
  // BFS distance field from a world position
  computeFlow(px, pz) {
    const w = this.w, h = this.h, D = this.flowDist; D.fill(-1);
    const sx = clamp(this.cx(px), 0, w - 1), sz = clamp(this.cx(pz), 0, h - 1);
    const q = this._q || (this._q = new Int32Array(w * h)); let qh = 0, qt = 0;
    D[sz * w + sx] = 0; q[qt++] = sz * w + sx;
    while (qh < qt) {
      const c = q[qh++], cx = c % w, cz = (c / w) | 0, d = D[c];
      for (let k = 0; k < 8; k++) {
        const nx = cx + (k === 0 || k === 4 || k === 5 ? 1 : k === 1 || k === 6 || k === 7 ? -1 : 0), nz = cz + (k === 2 || k === 4 || k === 6 ? 1 : k === 3 || k === 5 || k === 7 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const ni = nz * w + nx; if (D[ni] >= 0 || this.solidCell(nx, nz)) continue;
        if (k >= 4 && (this.solidCell(cx, nz) || this.solidCell(nx, cz))) continue;
        D[ni] = d + 1; q[qt++] = ni;
      }
    }
  }
  // direction (unit vector in out) towards lower flow distance
  flowDir(x, z, out) {
    const cx = this.cx(x), cz = this.cx(z); const D = this.flowDist; let best = D[cz * this.w + cx], bx = 0, bz = 0;
    if (best < 0) { out.x = out.z = 0; return false; }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue; const nx = cx + dx, nz = cz + dz; if (!this.inb(nx, nz)) continue;
      const v = D[nz * this.w + nx]; if (v < 0) continue;
      if (dx && dz && (this.solidCell(cx + dx, cz) || this.solidCell(cx, cz + dz))) continue;
      if (v < best) { best = v; bx = dx; bz = dz; }
    }
    if (!bx && !bz) { out.x = out.z = 0; return false; }
    const c = this.cellCenter(cx + bx, cz + bz); let ddx = c.x - x, ddz = c.z - z; const l = Math.hypot(ddx, ddz) || 1;
    out.x = ddx / l; out.z = ddz / l; return true;
  }
  update(dt, t) { for (const u of this.updaters) u(dt, t); }
  dispose() {
    this.group.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose && 0; });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// -------------------------------------------------------------- dungeon generation
function carveRect(L, x0, z0, x1, z1, tile, room) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (L.inb(x, z)) { const i = L.idx(x, z); L.grid[i] = tile; if (room !== undefined) L.room[i] = room; }
}
function carveEllipse(L, cx, cz, rx, rz, room) {
  for (let z = cz - rz; z <= cz + rz; z++) for (let x = cx - rx; x <= cx + rx; x++) {
    const dx = (x - cx) / (rx + 0.5), dz = (z - cz) / (rz + 0.5);
    if (dx * dx + dz * dz <= 1 && L.inb(x, z)) { const i = L.idx(x, z); L.grid[i] = T_FLOOR; L.room[i] = room; }
  }
}
function corridor(L, ax, az, bx, bz, rng, wide = 3) {
  const h = (x0, x1, z) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let k = 0; k < wide; k++) { const zz = z + k - (wide >> 1); if (L.inb(x, zz) && L.grid[L.idx(x, zz)] === T_WALL) L.grid[L.idx(x, zz)] = T_CORR; } };
  const v = (z0, z1, x) => { for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let k = 0; k < wide; k++) { const xx = x + k - (wide >> 1); if (L.inb(xx, z) && L.grid[L.idx(xx, z)] === T_WALL) L.grid[L.idx(xx, z)] = T_CORR; } };
  if (rng.chance(0.5)) { h(ax, bx, az); v(az, bz, bx); } else { v(az, bz, ax); h(ax, bx, bz); }
}

export function generateDungeon(rng, { biome, size = 'medium', bossRoom = true }) {
  const dims = { small: [44, 44, 6], medium: [56, 56, 8], large: [66, 66, 10] }[size];
  const [W, H, N] = dims;
  const L = new Level(W, H, biome);
  const rooms = [];
  const tryPlace = (rw, rh, margin = 3) => {
    for (let a = 0; a < 80; a++) {
      const x = rng.int(3, W - rw - 3), z = rng.int(3, H - rh - 3);
      if (rooms.some((r) => x < r.x1 + margin && x + rw - 1 > r.x0 - margin && z < r.z1 + margin && z + rh - 1 > r.z0 - margin)) continue;
      return { x0: x, z0: z, x1: x + rw - 1, z1: z + rh - 1 };
    }
    return null;
  };
  // start room first
  const sr = tryPlace(9, 9); rooms.push(Object.assign(sr, { type: 'start' }));
  for (let i = 0; i < N * 3 && rooms.length < N; i++) {
    const rw = rng.int(7, 13), rh = rng.int(7, 13); const r = tryPlace(rw, rh); if (r) rooms.push(Object.assign(r, { type: 'combat' }));
  }
  let boss = null;
  if (bossRoom) { boss = tryPlace(17, 17, 3); if (boss) { boss.type = 'boss'; } }
  // order by chain from start
  const order = [rooms[0]]; const rest = rooms.slice(1);
  while (rest.length) {
    const last = order[order.length - 1]; let bi = 0, bd = 1e9;
    rest.forEach((r, i) => { const d = Math.hypot((r.x0 + r.x1) / 2 - (last.x0 + last.x1) / 2, (r.z0 + r.z1) / 2 - (last.z0 + last.z1) / 2); if (d < bd) { bd = d; bi = i; } });
    order.push(rest.splice(bi, 1)[0]);
  }
  if (boss) {
    // the boss room should be near the end of chain: connect from last room
    order.push(boss);
  }
  order.forEach((r, i) => {
    r.id = i; r.cx = (r.x0 + r.x1) >> 1; r.cz = (r.z0 + r.z1) >> 1; r.w = r.x1 - r.x0 + 1; r.h = r.z1 - r.z0 + 1;
    if (r.type === 'boss') { carveRect(L, r.x0, r.z0, r.x1, r.z1, T_FLOOR, i); }
    else if (r.type !== 'start' && rng.chance(0.3)) carveEllipse(L, r.cx, r.cz, r.w >> 1, r.h >> 1, i);
    else carveRect(L, r.x0, r.z0, r.x1, r.z1, T_FLOOR, i);
  });
  for (let i = 0; i < order.length - 1; i++) corridor(L, order[i].cx, order[i].cz, order[i + 1].cx, order[i + 1].cz, rng, 3);
  // extra loops
  for (let k = 0; k < 2; k++) { const a = rng.pick(order.slice(0, -1)), b = rng.pick(order.slice(0, -1)); if (a !== b) corridor(L, a.cx, a.cz, b.cx, b.cz, rng, 2); }
  // assign roles
  const mids = order.filter((r) => r.type === 'combat');
  rng.shuffle(mids);
  mids.forEach((r, i) => { r.type = i % 4 === 0 ? 'treasure' : 'combat'; });
  L.rooms = order; L.bossRoom = boss;
  // keep corridors' room id unset; mark corridor tiles near rooms stay -1
  L.start = L.cellCenter(order[0].cx, order[0].cz);
  // decorate rooms: pillars / liquid
  for (const r of order) {
    if (r.type === 'start') continue;
    const style = rng.int(0, 4);
    if (r.w >= 9 && r.h >= 9 && style === 0) { // 4 pillars
      for (const [px, pz] of [[r.cx - 3, r.cz - 3], [r.cx + 3, r.cz - 3], [r.cx - 3, r.cz + 3], [r.cx + 3, r.cz + 3]]) if (L.room[L.idx(px, pz)] === r.id) L.grid[L.idx(px, pz)] = T_PILLAR;
    } else if (r.w >= 9 && style === 1 && r.type !== 'boss' && (biome.id === 'inferno' || biome.id === 'frost' || biome.id === 'meadow' || biome.id === 'void')) { // liquid pool in the centre
      for (let z = r.cz - 1; z <= r.cz + 1; z++) for (let x = r.cx - 2; x <= r.cx + 2; x++) if (L.room[L.idx(x, z)] === r.id) L.grid[L.idx(x, z)] = T_LIQUID;
    } else if (style === 2 && r.type !== 'boss') { // scattered pillars
      for (let k = 0; k < 5; k++) { const px = rng.int(r.x0 + 2, r.x1 - 2), pz = rng.int(r.z0 + 2, r.z1 - 2); if (L.room[L.idx(px, pz)] === r.id && Math.hypot(px - r.cx, pz - r.cz) > 2) L.grid[L.idx(px, pz)] = T_PILLAR; }
    }
    if (r.type === 'boss') {
      for (const [px, pz] of [[r.x0 + 2, r.z0 + 2], [r.x1 - 2, r.z0 + 2], [r.x0 + 2, r.z1 - 2], [r.x1 - 2, r.z1 - 2]]) L.grid[L.idx(px, pz)] = T_PILLAR;
    }
  }
  // make sure connectivity: flood from start; any pillar/liquid fine since they are inside rooms and corridors are 3 wide
  return L;
}

export function generateCamp() {
  const biome = BIOMES.camp; const W = 36, H = 36; const L = new Level(W, H, biome);
  const cx = 18, cz = 18;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const d = Math.hypot((x - cx) * 1.0, (z - cz) * 1.0);
    const wob = 11.5 + Math.sin(Math.atan2(z - cz, x - cx) * 5) * 0.9 + Math.sin(Math.atan2(z - cz, x - cx) * 3 + 1) * 0.8;
    if (d < wob) { L.grid[L.idx(x, z)] = T_FLOOR; L.room[L.idx(x, z)] = 0; }
  }
  L.rooms = [{ id: 0, type: 'camp', cx, cz, x0: 6, z0: 6, x1: 30, z1: 30, w: 24, h: 24 }];
  L.start = L.cellCenter(cx, cz + 4);
  return L;
}

// -------------------------------------------------------------- rendering of level
function patchWallMaterial(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPlayer = uniforms.uPlayer; sh.uniforms.uCam = uniforms.uCam;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vec4 wp4 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp4 = instanceMatrix * wp4;\n#endif\n vWP = (modelMatrix * wp4).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 uPlayer; uniform vec3 uCam;').replace('void main() {', `void main() {
      { vec3 ab = uPlayer - uCam; float tt = dot(vWP - uCam, ab) / dot(ab, ab);
        if (tt > 0.0 && tt < 0.98) { vec3 cp = uCam + ab * tt; float dd = length((vWP - cp) * vec3(1.0, 0.8, 1.0)); float f = smoothstep(1.2, 3.6, dd);
          float th = mod(floor(gl_FragCoord.x) + 2.0 * floor(gl_FragCoord.y), 4.0) / 4.0 + 0.125; if (f < th * 0.95 && vWP.y > 0.4) discard; } }`);
  };
  mat.customProgramCacheKey = () => 'wallfade';
}

export function buildLevelMeshes(L, rng, uniforms) {
  const B = L.biome, tex = biomeTextures(B.tex);
  const g = L.group; const CSZ = CS;
  // floor
  const floorCells = [], corrCells = [];
  for (let z = 0; z < L.h; z++) for (let x = 0; x < L.w; x++) {
    const t = L.grid[z * L.w + x];
    if (t === T_FLOOR || t === T_PILLAR) floorCells.push([x, z]); else if (t === T_CORR) corrCells.push([x, z]); else if (t === T_LIQUID) floorCells.push([x, z, true]);
  }
  const mkInst = (geo, mat, cells, fn) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length)); const d = new THREE.Object3D(); const col = new THREE.Color();
    cells.forEach((c, i) => { fn(c, d, col); d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, col); });
    m.count = cells.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.receiveShadow = true; return m;
  };
  const floorGeo = boxGeo(CSZ, 0.8, CSZ);
  const floorMat = new THREE.MeshLambertMaterial({ map: tex.floor });
  const corrMat = new THREE.MeshLambertMaterial({ map: tex.path });
  const fl = mkInst(floorGeo, floorMat, floorCells.filter((c) => !c[2]), (c, d, col) => { d.position.set((c[0] + 0.5) * CSZ, -0.4, (c[1] + 0.5) * CSZ); d.scale.set(1, 1, 1); d.rotation.set(0, 0, 0); const j = 0.86 + hash2(c[0], c[1], 5) * 0.28; col.setRGB(j, j, j); });
  const co = mkInst(floorGeo, corrMat, corrCells, (c, d, col) => { d.position.set((c[0] + 0.5) * CSZ, -0.4, (c[1] + 0.5) * CSZ); d.scale.set(1, 1, 1); const j = 0.86 + hash2(c[0], c[1], 6) * 0.26; col.setRGB(j, j, j); });
  g.add(fl, co);
  // walls: only those touching walkable-ish cells
  const wallCells = [];
  for (let z = 0; z < L.h; z++) for (let x = 0; x < L.w; x++) {
    if (L.grid[z * L.w + x] !== T_WALL) continue;
    let adj = false;
    for (let dz = -1; dz <= 1 && !adj; dz++) for (let dx = -1; dx <= 1; dx++) { const t = L.tile(x + dx, z + dz); if (t !== T_WALL) { adj = true; break; } }
    if (adj) wallCells.push([x, z]);
  }
  const wallGeo = new THREE.BoxGeometry(CSZ, 1, CSZ); // custom: vertex shading
  {
    const pos = wallGeo.attributes.position, colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const k = y < 0 ? 0.45 : 1.0; colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k; }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); wallGeo.translate(0, 0.5, 0);
  }
  const wallMat = new THREE.MeshLambertMaterial({ map: tex.wall, vertexColors: true });
  patchWallMaterial(wallMat, uniforms);
  const wm = mkInst(wallGeo, wallMat, wallCells, (c, d, col) => {
    const hv = B.wallH + Math.floor(hash2(c[0], c[1], 9) * 3) * 0.5 + (B.id === 'meadow' || B.id === 'camp' ? hash2(c[0], c[1], 3) * 1.4 : 0);
    d.position.set((c[0] + 0.5) * CSZ, -0.6, (c[1] + 0.5) * CSZ); d.scale.set(1, hv + 0.6, 1);
    const j = 0.82 + hash2(c[0], c[1], 8) * 0.3; col.setRGB(j, j, j);
  });
  wm.castShadow = true; g.add(wm);
  // top caps (cheap lighter plane layer so the wall tops read well)
  const capMat = new THREE.MeshLambertMaterial({ map: tex.wallTop }); patchWallMaterial(capMat, uniforms);
  const capGeo = new THREE.PlaneGeometry(CSZ, CSZ); capGeo.rotateX(-Math.PI / 2);
  const caps = mkInst(capGeo, capMat, wallCells, (c, d, col) => {
    const hv = B.wallH + Math.floor(hash2(c[0], c[1], 9) * 3) * 0.5 + (B.id === 'meadow' || B.id === 'camp' ? hash2(c[0], c[1], 3) * 1.4 : 0);
    d.position.set((c[0] + 0.5) * CSZ, hv + 0.02, (c[1] + 0.5) * CSZ); d.scale.set(1, 1, 1); col.setRGB(1.05, 1.05, 1.05);
  });
  g.add(caps);
  // pillars
  const pil = [];
  for (let z = 0; z < L.h; z++) for (let x = 0; x < L.w; x++) if (L.grid[z * L.w + x] === T_PILLAR) pil.push([x, z]);
  if (pil.length) {
    const pg = new THREE.BoxGeometry(CSZ * 0.82, 1, CSZ * 0.82); pg.translate(0, 0.5, 0);
    const pm = new THREE.MeshLambertMaterial({ map: tex.accent && B.id === 'sands' ? tex.wall : tex.wall }); patchWallMaterial(pm, uniforms);
    const pi = mkInst(pg, pm, pil, (c, d, col) => { d.position.set((c[0] + 0.5) * CSZ, 0, (c[1] + 0.5) * CSZ); d.scale.set(1, B.wallH + 0.4, 1); col.setRGB(1.1, 1.1, 1.1); });
    pi.castShadow = true; g.add(pi);
    for (const c of pil) { const cap = part(CSZ * 0.98, 0.35, CSZ * 0.98, new THREE.MeshLambertMaterial({ map: tex.wallTop }), 'b'); cap.position.set((c[0] + 0.5) * CSZ, B.wallH + 0.2, (c[1] + 0.5) * CSZ); g.add(cap); const base = part(CSZ * 0.98, 0.5, CSZ * 0.98, new THREE.MeshLambertMaterial({ map: tex.wallTop }), 'b'); base.position.set((c[0] + 0.5) * CSZ, 0, (c[1] + 0.5) * CSZ); g.add(base); }
  }
  // liquids
  const liq = floorCells.filter((c) => c[2]);
  if (liq.length) {
    const lava = B.id === 'inferno';
    const tx = lava ? biomeTextures('inferno').accent : biomeTextures(B.id === 'frost' ? 'frost' : B.id === 'void' ? 'void' : 'meadow').accent;
    const lmat = lava ? new THREE.MeshBasicMaterial({ map: tx, color: 0xffa060 }) : new THREE.MeshLambertMaterial({ map: tx, color: B.id === 'void' ? 0xa070ff : B.id === 'frost' ? 0x80b8ff : 0x4a90ff, emissive: B.id === 'void' ? 0x2a1050 : 0x0a2a50 });
    const lg = new THREE.PlaneGeometry(CSZ, CSZ); lg.rotateX(-Math.PI / 2);
    const lm = mkInst(lg, lmat, liq, (c, d, col) => { d.position.set((c[0] + 0.5) * CSZ, -0.18, (c[1] + 0.5) * CSZ); d.scale.set(1, 1, 1); col.setRGB(1, 1, 1); });
    g.add(lm);
    const rim = mkInst(boxGeo(CSZ, 0.4, CSZ), new THREE.MeshLambertMaterial({ map: tex.wallTop }), liq, (c, d, col) => { d.position.set((c[0] + 0.5) * CSZ, -0.6, (c[1] + 0.5) * CSZ); col.setRGB(0.8, 0.8, 0.8); });
    g.add(rim);
    L.updaters.push((dt, t) => { tx.offset.x = (t * 0.04) % 1; tx.offset.y = (t * 0.025) % 1; });
    L.liquidCells = liq;
  }
}

// -------------------------------------------------------------- props
const _mats = {};
function M(c, key) { const k = key || c; return _mats[k] || (_mats[k] = lam(c)); }
function flameMat(c) { return emissiveMat(c, 1.6); }

export function propTorch(color = 0xffa040) {
  const g = new THREE.Group();
  const post = part(0.18, 1.5, 0.18, M(0x5a3a1c), 'b'); g.add(post);
  const bowl = part(0.4, 0.2, 0.4, M(0x2a2a30), 'b'); bowl.position.y = 1.45; g.add(bowl);
  const f = part(0.26, 0.34, 0.26, flameMat(color), 'b'); f.position.y = 1.62; g.add(f); g.userData.flame = f;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
  glow.scale.setScalar(2.6); glow.position.y = 1.9; g.add(glow); g.userData.glow = glow;
  return g;
}
export function propBrazier(color = 0xff7a20) {
  const g = new THREE.Group();
  const leg = part(0.6, 0.7, 0.6, M(0x2a2a30), 'b'); g.add(leg);
  const bowl = part(1.0, 0.35, 1.0, M(0x3a3a42), 'b'); bowl.position.y = 0.7; g.add(bowl);
  const f = part(0.7, 0.55, 0.7, flameMat(color), 'b'); f.position.y = 1.0; g.add(f); g.userData.flame = f;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
  glow.scale.setScalar(3.6); glow.position.y = 1.5; g.add(glow); g.userData.glow = glow;
  return g;
}
export function propCrate(rng) {
  const g = new THREE.Group(); const s = 0.9;
  const b = part(s, s, s, M(0x9a6a30, 'crate'), 'b'); g.add(b);
  for (const [w, h, d, x, y, z] of [[s + 0.04, 0.12, 0.12, 0, 0.1, s / 2], [s + 0.04, 0.12, 0.12, 0, s - 0.1, s / 2], [0.12, s, 0.12, s / 2 - 0.06, 0, s / 2]]) { const p = part(w, h, d, M(0x5a3a18, 'crate2'), 'b'); p.position.set(x, y, z); g.add(p); }
  g.rotation.y = rng ? rng.range(0, TAU) : 0; return g;
}
export function propBarrel(rng) {
  const g = new THREE.Group();
  const b = part(0.8, 1.05, 0.8, M(0x8a5a2c, 'barrel'), 'b'); g.add(b);
  for (const y of [0.18, 0.78]) { const r = part(0.86, 0.09, 0.86, M(0x3a3a40, 'ring'), 'b'); r.position.y = y; g.add(r); }
  g.rotation.y = rng ? rng.range(0, TAU) : 0; return g;
}
export function propPot(color = 0xb86a3a) {
  const g = new THREE.Group();
  const b = part(0.6, 0.55, 0.6, M(color), 'b'); g.add(b);
  const n = part(0.36, 0.2, 0.36, M(color), 'b'); n.position.y = 0.55; g.add(n);
  const r = part(0.5, 0.08, 0.5, M(color, 'potrim' + color), 'b'); r.position.y = 0.7; g.add(r);
  return g;
}
export function propChest(open = false, gold = 0xe0b030) {
  const g = new THREE.Group();
  const base = part(1.3, 0.7, 0.9, M(0x7a4a22, 'chest'), 'b'); g.add(base);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.7, -0.45); g.add(lidPivot);
  const lid = part(1.3, 0.4, 0.9, M(0x8a5a2a, 'chestlid'), 'b'); lid.position.z = 0.45; lidPivot.add(lid);
  const trim = M(gold, 'gold' + gold);
  for (const x of [-0.5, 0.5]) { const t = part(0.12, 0.74, 0.94, trim, 'b'); t.position.set(x, 0, 0); g.add(t); const t2 = part(0.12, 0.42, 0.94, trim, 'b'); t2.position.set(x, 0, 0.45); lidPivot.add(t2); }
  const lock = part(0.22, 0.3, 0.1, flameMat(gold), 'c'); lock.position.set(0, 0.62, 0.48); g.add(lock);
  g.userData.lid = lidPivot; g.userData.lock = lock;
  return g;
}
export function propTree(rng, leaf = 0x3a8a30, leaf2 = 0x58b848, h = 3.2) {
  const g = new THREE.Group(); const trunk = M(0x5a3a1c, 'trunk');
  const t = part(0.7, h, 0.7, trunk, 'b'); g.add(t);
  const lm = [M(leaf, 'lf' + leaf), M(leaf2, 'lf' + leaf2)];
  const blocks = [[0, h - 0.2, 0, 3.0, 1.4, 3.0], [0, h + 1.0, 0, 2.2, 1.2, 2.2], [0, h + 2.0, 0, 1.2, 1.0, 1.2], [1.4, h - 0.4, 0.4, 1.4, 1.0, 1.4], [-1.3, h - 0.5, -0.5, 1.4, 1.0, 1.4]];
  blocks.forEach((b, i) => { const m = part(b[3], b[4], b[5], lm[i % 2], 'b'); m.position.set(b[0], b[1], b[2]); g.add(m); });
  g.rotation.y = rng ? rng.range(0, TAU) : 0; return g;
}
export function propPine(rng, col = 0x2a6a3a, snow = false) {
  const g = new THREE.Group();
  const t = part(0.6, 1.4, 0.6, M(0x4a2f1a, 'pinetrunk'), 'b'); g.add(t);
  const sizes = [2.8, 2.2, 1.6, 1.0];
  sizes.forEach((s, i) => { const l = part(s, 0.8, s, M(col, 'pine' + col), 'b'); l.position.y = 0.9 + i * 0.75; g.add(l); if (snow) { const sn = part(s * 0.92, 0.12, s * 0.92, M(0xf4faff, 'snowtop'), 'b'); sn.position.y = 0.9 + i * 0.75 + 0.8; g.add(sn); } });
  g.rotation.y = rng ? rng.range(0, TAU) : 0; return g;
}
export function propCactus() {
  const g = new THREE.Group(); const c = M(0x4a9a3a, 'cactus');
  g.add(part(0.7, 2.6, 0.7, c, 'b'));
  const a = part(0.5, 0.5, 0.5, c, 'b'); a.position.set(0.6, 1.0, 0); g.add(a); const a2 = part(0.5, 1.0, 0.5, c, 'b'); a2.position.set(0.6, 1.4, 0); g.add(a2);
  const b = part(0.5, 0.5, 0.5, c, 'b'); b.position.set(-0.6, 1.5, 0); g.add(b); const b2 = part(0.5, 0.8, 0.5, c, 'b'); b2.position.set(-0.6, 1.9, 0); g.add(b2);
  return g;
}
export function propRock(rng, col = 0x7a7a82) {
  const g = new THREE.Group(); const m = M(col, 'rock' + col);
  const a = part(rng.range(0.9, 1.5), rng.range(0.6, 1.1), rng.range(0.9, 1.4), m, 'b'); a.rotation.y = rng.range(0, TAU); g.add(a);
  const b = part(0.7, 0.55, 0.7, M(col, 'rock2' + col), 'b'); b.position.set(rng.range(-0.7, 0.7), 0, rng.range(-0.7, 0.7)); g.add(b);
  return g;
}
export function propCrystal(color = 0x6af0ff, h = 1.6) {
  const g = new THREE.Group(); const m = emissiveMat(color, 1.15);
  const base = part(0.9, 0.2, 0.9, M(0x333340, 'crbase'), 'b'); g.add(base);
  [[0, 0.2, 0, 0.4, h], [0.3, 0.2, 0.15, 0.28, h * 0.65], [-0.28, 0.2, -0.1, 0.3, h * 0.75]].forEach((c, i) => { const s = part(c[3], c[4], c[3], m, 'b'); s.position.set(c[0], c[1], c[2]); s.rotation.set(rr0(i) * 0.15, i, rr0(i + 3) * 0.15); g.add(s); });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
  glow.scale.setScalar(3); glow.position.y = h * 0.6; g.add(glow); g.userData.glow = glow;
  return g;
}
function rr0(i) { return Math.sin(i * 12.9898) * 0.5 + 0.5; }
export function propBones(rng) {
  const g = new THREE.Group(); const m = M(0xd8d4c4, 'bone');
  for (let i = 0; i < 4; i++) { const b = part(rng.range(0.4, 0.8), 0.1, 0.12, m, 'b'); b.position.set(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5)); b.rotation.y = rng.range(0, TAU); g.add(b); }
  const s = part(0.34, 0.3, 0.34, m, 'b'); s.position.set(rng.range(-0.3, 0.3), 0.06, rng.range(-0.3, 0.3)); g.add(s);
  const e = part(0.22, 0.08, 0.04, M(0x111111, 'skeye'), 'b'); e.position.set(s.position.x, 0.2, s.position.z + 0.18); g.add(e);
  return g;
}
export function propTomb(rng) {
  const g = new THREE.Group(); const m = M(0x8a8a92, 'tomb');
  g.add(part(0.9, 1.3, 0.3, m, 'b')); const t = part(0.9, 0.2, 0.3, M(0x9a9aa2, 'tomb2'), 'b'); t.position.y = 1.3; g.add(t);
  const c = part(0.14, 0.7, 0.04, M(0x555560, 'tombx'), 'b'); c.position.set(0, 0.4, 0.17); g.add(c); const c2 = part(0.5, 0.14, 0.04, M(0x555560, 'tombx'), 'b'); c2.position.set(0, 0.88, 0.17); g.add(c2);
  g.rotation.y = rng ? rng.range(-0.3, 0.3) : 0; return g;
}
export function propBanner(color = 0xa02a2a) {
  const g = new THREE.Group();
  const pole = part(1.2, 0.1, 0.1, M(0x4a3020, 'pole'), 'c'); pole.position.y = 2.6; g.add(pole);
  const cloth = part(0.9, 1.7, 0.05, M(color, 'ban' + color), 't'); cloth.position.y = 2.55; g.add(cloth);
  const em = part(0.34, 0.34, 0.07, emissiveMat(0xffd060, 1.1), 'c'); em.position.set(0, 1.9, 0.02); g.add(em);
  return g;
}
export function propSpikes() {
  const g = new THREE.Group(); const base = part(1.6, 0.1, 1.6, M(0x303036, 'spkbase'), 'b'); g.add(base);
  const sm = M(0xaab0b8, 'spike'); const spikes = new THREE.Group(); g.add(spikes);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { const s = part(0.18, 0.6, 0.18, sm, 'b'); s.position.set(x * 0.46, 0, z * 0.46); spikes.add(s); }
  g.userData.spikes = spikes; spikes.position.y = -0.55; return g;
}
export function propSpawner(color = 0x7a50d8) {
  const g = new THREE.Group();
  const base = part(1.6, 0.4, 1.6, M(0x2a2a34, 'spbase'), 'b'); g.add(base);
  const cage = new THREE.Group(); g.add(cage);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) { const b = part(0.16, 1.6, 0.16, M(0x1a1a22, 'spbar'), 'b'); b.position.set(x, 0.4, z); cage.add(b); }
  const top = part(1.6, 0.16, 1.6, M(0x1a1a22, 'spbar'), 'b'); top.position.y = 2.0; cage.add(top);
  const core = part(0.6, 0.6, 0.6, emissiveMat(color, 1.5), 'c'); core.position.y = 1.2; g.add(core); g.userData.core = core;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
  glow.scale.setScalar(4); glow.position.y = 1.2; g.add(glow); g.userData.glow = glow;
  return g;
}
export function propPortal(color = 0x6af0ff) {
  const g = new THREE.Group(); const fr = M(0x2a2a34, 'pfr');
  for (const x of [-1.5, 1.5]) { const p = part(0.6, 4.2, 0.9, fr, 'b'); p.position.x = x; g.add(p); const e = part(0.14, 3.6, 0.14, emissiveMat(color, 1.3), 'b'); e.position.set(x * 0.8, 0.3, 0.5); g.add(e); }
  const top = part(3.6, 0.6, 0.9, fr, 'b'); top.position.y = 4.2; g.add(top);
  const sw = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  sw.position.y = 2.1; g.add(sw); g.userData.sheet = sw;
  const base = part(4.0, 0.3, 1.4, fr, 'b'); g.add(base);
  return g;
}
export function propAltar(color = 0xffd060) {
  const g = new THREE.Group();
  g.add(part(1.8, 0.5, 1.8, M(0x3a3a46, 'al1'), 'b'));
  const p = part(1.2, 0.9, 1.2, M(0x4a4a56, 'al2'), 'b'); p.position.y = 0.5; g.add(p);
  const gem = part(0.5, 0.5, 0.5, emissiveMat(color, 1.5), 'c'); gem.position.y = 2.0; gem.rotation.set(0.6, 0.6, 0); g.add(gem); g.userData.gem = gem;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
  glow.scale.setScalar(3.4); glow.position.y = 2.0; g.add(glow); g.userData.glow = glow;
  return g;
}
export function propCampfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) { const l = part(1.2, 0.22, 0.22, M(0x4a2f1a, 'log'), 'b'); l.rotation.y = i * Math.PI / 3; l.position.y = 0.0 + (i % 2) * 0.2; g.add(l); }
  for (let i = 0; i < 8; i++) { const s = part(0.34, 0.3, 0.34, M(0x6a6a72, 'stone'), 'b'); const a = i / 8 * TAU; s.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0); s.rotation.y = a; g.add(s); }
  const f = part(0.7, 1.0, 0.7, flameMat(0xffa030), 'b'); f.position.y = 0.3; g.add(f); g.userData.flame = f;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color: 0xff9030, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }));
  glow.scale.setScalar(7); glow.position.y = 1.0; g.add(glow); g.userData.glow = glow;
  return g;
}
export function propTent(color = 0xb04030) {
  const g = new THREE.Group(); const c = M(color, 'tent' + color);
  for (let i = 0; i < 5; i++) { const s = 3.4 - i * 0.6; const b = part(s, 0.6, 3.0, c, 'b'); b.position.y = i * 0.6; g.add(b); }
  const door = part(0.9, 1.5, 0.1, M(0x1a1410, 'tentdoor'), 'b'); door.position.set(0, 0, 1.52); g.add(door);
  const pole = part(0.12, 1.0, 0.12, M(0x5a3a1c, 'pole2'), 'b'); pole.position.y = 3.0; g.add(pole);
  return g;
}
export function propAnvil() {
  const g = new THREE.Group(); const m = M(0x3a3e48, 'anvil');
  g.add(part(1.2, 0.9, 1.2, M(0x5a3a1c, 'stump'), 'b'));
  const a = part(1.3, 0.35, 0.7, m, 'b'); a.position.y = 0.9; g.add(a);
  const b = part(0.6, 0.35, 0.5, m, 'b'); b.position.y = 1.25; g.add(b);
  const h = part(0.9, 0.3, 0.45, m, 'b'); h.position.set(0.8, 0.9, 0); g.add(h);
  const hot = part(0.5, 0.06, 0.3, flameMat(0xff7a20), 'b'); hot.position.set(0, 1.58, 0); g.add(hot);
  return g;
}
export function propStall(color = 0x2a8a5a) {
  const g = new THREE.Group();
  const table = part(2.6, 0.9, 1.3, M(0x7a4a22, 'tbl'), 'b'); g.add(table);
  for (const x of [-1.2, 1.2]) { const p = part(0.16, 2.8, 0.16, M(0x5a3a1c, 'tp'), 'b'); p.position.set(x, 0, -0.6); g.add(p); }
  const roof = part(3.0, 0.14, 1.9, M(color, 'roof' + color), 'b'); roof.position.set(0, 2.8, -0.1); g.add(roof);
  for (let i = 0; i < 6; i++) { const fl = part(0.5, 0.3, 0.14, M(i % 2 ? 0xf0f0e0 : color, 'fl' + i % 2 + color), 'b'); fl.position.set(-1.25 + i * 0.5, 2.5, 0.8); g.add(fl); }
  const gems = [0xff4a4a, 0x4aff8a, 0x4a8aff, 0xffd84a];
  gems.forEach((c, i) => { const it = part(0.26, 0.26, 0.26, emissiveMat(c, 1.2), 'b'); it.position.set(-0.9 + i * 0.6, 0.92, 0.1); g.add(it); });
  return g;
}
export function propBoard() {
  const g = new THREE.Group();
  for (const x of [-0.9, 0.9]) { const p = part(0.2, 2.4, 0.2, M(0x5a3a1c, 'bp'), 'b'); p.position.x = x; g.add(p); }
  const bd = part(2.2, 1.5, 0.12, M(0x7a5a30, 'bd'), 'b'); bd.position.y = 1.0; g.add(bd);
  for (let i = 0; i < 5; i++) { const s = part(0.4, 0.5, 0.04, M(i % 2 ? 0xf0e4c0 : 0xe8d8a8, 'paper' + i % 2), 'b'); s.position.set(-0.8 + i * 0.4, 1.35 - (i % 2) * 0.4, 0.09); s.rotation.z = (i - 2) * 0.05; g.add(s); }
  const em = part(0.3, 0.3, 0.1, emissiveMat(0xffd060, 1.4), 'c'); em.position.set(0, 2.6, 0); g.add(em); g.userData.beacon = em;
  return g;
}
export function propMap() {
  const g = new THREE.Group();
  const t = part(2.4, 0.9, 1.6, M(0x6a4a22, 'maptbl'), 'b'); g.add(t);
  const m = part(2.2, 0.06, 1.4, M(0xe8d8a8, 'map'), 'b'); m.position.y = 0.9; g.add(m);
  for (let i = 0; i < 5; i++) { const x = part(0.12, 0.1, 0.12, emissiveMat(i % 2 ? 0xff4040 : 0x40c0ff, 1.2), 'b'); x.position.set(-0.8 + i * 0.4, 0.96, (i % 3 - 1) * 0.3); g.add(x); }
  const beacon = part(0.34, 0.34, 0.34, emissiveMat(0x60ffb0, 1.5), 'c'); beacon.position.y = 2.4; g.add(beacon); g.userData.beacon = beacon;
  const post = part(0.1, 1.0, 0.1, M(0x5a3a1c, 'pole2'), 'b'); post.position.y = 1.4 - 0.5; g.add(post);
  return g;
}
export function propFlower(rng) {
  const g = new THREE.Group(); const col = rng.pick([0xff5a7a, 0xffe05a, 0xffffff, 0x8a7aff, 0xff9a3a]);
  const s = part(0.05, 0.4, 0.05, M(0x3a8a30, 'stem'), 'b'); g.add(s); const f = part(0.2, 0.12, 0.2, M(col, 'fw' + col), 'b'); f.position.y = 0.4; g.add(f);
  return g;
}
export function propGrass(rng, col = 0x4aa83a) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) { const b = part(0.07, rng.range(0.25, 0.55), 0.07, M(col, 'gr' + col), 'b'); b.position.set(rng.range(-0.18, 0.18), 0, rng.range(-0.18, 0.18)); b.rotation.z = rng.range(-0.3, 0.3); g.add(b); }
  return g;
}
export function propMushroom(rng) {
  const g = new THREE.Group(); const s = part(0.12, 0.3, 0.12, M(0xe8e0d0, 'mst'), 'b'); g.add(s); const c = part(0.4, 0.14, 0.4, M(0xc04a3a, 'mcap'), 'b'); c.position.y = 0.3; g.add(c);
  return g;
}
export function propSnowPile(rng) {
  const g = new THREE.Group(); const m = M(0xf0f8ff, 'snowp');
  const a = part(rng.range(1, 1.6), 0.4, rng.range(1, 1.5), m, 'b'); g.add(a); const b = part(0.7, 0.3, 0.7, m, 'b'); b.position.y = 0.4; g.add(b); return g;
}
export function propObelisk(color = 0xc77dff) {
  const g = new THREE.Group(); g.add(part(1.2, 0.4, 1.2, M(0x2a2236, 'ob0'), 'b'));
  const a = part(0.8, 2.6, 0.8, M(0x3a2a52, 'ob1'), 'b'); a.position.y = 0.4; g.add(a);
  const b = part(0.6, 0.6, 0.6, emissiveMat(color, 1.4), 'c'); b.position.y = 3.6; b.rotation.set(0.7, 0.7, 0); g.add(b); g.userData.gem = b;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
  glow.scale.setScalar(3); glow.position.y = 3.6; g.add(glow); g.userData.glow = glow;
  return g;
}
export function propLamp(color = 0xffb050) { const g = propTorch(color); return g; }
