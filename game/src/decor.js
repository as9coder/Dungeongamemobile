import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CS, T_FLOOR, T_CORR, T_WALL, T_PILLAR, T_LIQUID } from './world.js';
import * as P from './world.js';
import { TAU } from './util.js';

// merge all meshes under `root` (static) into one mesh per material
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map(); const keep = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noMerge) return;
    if (o.material.map === undefined && false) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    // normalise attributes
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (g.index) { /* keep indexed */ }
    const key = o.material.uuid; let b = buckets.get(key); if (!b) buckets.set(key, b = { mat: o.material, geos: [], shadow: o.castShadow }); b.geos.push(g);
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const geos = b.geos; if (!geos.length) continue;
    const merged = mergeGeometries(geos, false); if (!merged) continue;
    const m = new THREE.Mesh(merged, b.mat); m.castShadow = b.shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; out.add(m);
  }
  return out;
}

export function populateLevel(L, rng, opts = {}) {
  const B = L.biome; const g = L.group;
  const stat = new THREE.Group(); // merged at the end
  const dyn = new THREE.Group(); g.add(dyn);
  const place = (obj, x, z, y = 0, rot = null) => { obj.position.set(x, y, z); if (rot !== null) obj.rotation.y = rot; return obj; };
  const freeCell = (r, margin = 1) => {
    for (let a = 0; a < 40; a++) {
      const cx = rng.int(r.x0 + margin, r.x1 - margin), cz = rng.int(r.z0 + margin, r.z1 - margin);
      if (L.room[L.idx(cx, cz)] === r.id && L.walkable(cx, cz) && !L.props.some((p) => Math.abs(p.x - (cx + 0.5) * CS) < 1.2 && Math.abs(p.z - (cz + 0.5) * CS) < 1.2)) return { cx, cz, x: (cx + 0.5) * CS + rng.range(-0.4, 0.4), z: (cz + 0.5) * CS + rng.range(-0.4, 0.4) };
    }
    return null;
  };
  const wallAdj = (cx, cz) => { // returns outward direction if next to wall
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dz] of dirs) if (L.tile(cx + dx, cz + dz) === T_WALL) return [dx, dz];
    return null;
  };
  const addTorch = (cx, cz, dir, color) => {
    const x = (cx + 0.5) * CS + dir[0] * 0.78, z = (cz + 0.5) * CS + dir[1] * 0.78;
    const t = P.propTorch(color); const flame = t.userData.flame, glow = t.userData.glow;
    const fxg = new THREE.Group(); fxg.position.set(x, 0, z); fxg.add(flame, glow); g.add(fxg);
    place(t, x, z); stat.add(t);
    L.torches.push({ x, y: 1.9, z, color, flame, glow, seed: Math.random() * 10 });
  };
  const torchColor = B.torch;

  const rooms = L.rooms;
  // ---- torches
  for (const r of rooms) {
    const cells = [];
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (L.room[L.idx(x, z)] === r.id && L.walkable(x, z)) { const d = wallAdj(x, z); if (d) cells.push([x, z, d]); }
    rng.shuffle(cells);
    const want = r.type === 'boss' ? 8 : r.type === 'start' ? 3 : 4;
    let placed = 0; const used = [];
    for (const [x, z, d] of cells) {
      if (placed >= want) break;
      if (used.some((u) => Math.hypot(u[0] - x, u[1] - z) < 4)) continue;
      addTorch(x, z, d, torchColor); used.push([x, z]); placed++;
    }
  }
  // corridor torches
  { const cc = []; for (let z = 0; z < L.h; z++) for (let x = 0; x < L.w; x++) if (L.grid[z * L.w + x] === T_CORR) { const d = wallAdj(x, z); if (d && rng.chance(0.05)) cc.push([x, z, d]); } const used = []; for (const [x, z, d] of cc) { if (used.some((u) => Math.hypot(u[0] - x, u[1] - z) < 6)) continue; addTorch(x, z, d, torchColor); used.push([x, z]); } }

  const solidProp = (obj, x, z, r, type, extra) => { stat.add(obj); place(obj, x, z); L.addProp(Object.assign({ type, x, z, r, solid: true }, extra)); };
  const breakable = (obj, x, z, r, type, color, extra) => { dyn.add(obj); place(obj, x, z); L.addProp(Object.assign({ type, x, z, r, solid: true, breakable: true, hp: 1, mesh: obj, color }, extra)); };

  const biomeDecor = (r) => {
    const n = Math.floor(r.w * r.h / 18);
    for (let i = 0; i < n; i++) {
      const c = freeCell(r, 1); if (!c) continue;
      const roll = rng.next();
      switch (B.id) {
        case 'meadow':
          if (roll < 0.2) solidProp(P.propTree(rng), c.x, c.z, 0.9, 'tree');
          else if (roll < 0.32) solidProp(P.propRock(rng), c.x, c.z, 0.9, 'rock');
          else if (roll < 0.5) breakable(P.propCrate(rng), c.x, c.z, 0.6, 'crate', 0x9a6a30);
          else if (roll < 0.62) breakable(P.propBarrel(rng), c.x, c.z, 0.55, 'barrel', 0x8a5a2c);
          else if (roll < 0.85) stat.add(place(P.propFlower(rng), c.x, c.z));
          else stat.add(place(P.propMushroom(rng), c.x, c.z));
          break;
        case 'crypt':
          if (roll < 0.15) solidProp(P.propTomb(rng), c.x, c.z, 0.6, 'tomb');
          else if (roll < 0.3) breakable(P.propBarrel(rng), c.x, c.z, 0.55, 'barrel', 0x8a5a2c);
          else if (roll < 0.5) breakable(P.propCrate(rng), c.x, c.z, 0.6, 'crate', 0x9a6a30);
          else if (roll < 0.62) breakable(P.propPot(0x9a8a7a), c.x, c.z, 0.45, 'pot', 0x9a8a7a);
          else if (roll < 0.85) stat.add(place(P.propBones(rng), c.x, c.z, 0, rng.range(0, TAU)));
          else stat.add(place(P.propMushroom(rng), c.x, c.z));
          break;
        case 'sands':
          if (roll < 0.16) solidProp(P.propCactus(), c.x, c.z, 0.55, 'cactus');
          else if (roll < 0.3) solidProp(P.propRock(rng, 0xb89a62), c.x, c.z, 0.9, 'rock');
          else if (roll < 0.5) breakable(P.propPot(0xc88a48), c.x, c.z, 0.45, 'pot', 0xc88a48);
          else if (roll < 0.65) breakable(P.propCrate(rng), c.x, c.z, 0.6, 'crate', 0x9a6a30);
          else if (roll < 0.85) stat.add(place(P.propBones(rng), c.x, c.z, 0, rng.range(0, TAU)));
          else breakable(P.propBarrel(rng), c.x, c.z, 0.55, 'barrel', 0x8a5a2c);
          break;
        case 'frost':
          if (roll < 0.2) solidProp(P.propPine(rng, 0x2a6a4a, true), c.x, c.z, 0.9, 'tree');
          else if (roll < 0.34) solidProp(P.propCrystal(0x9ff0ff, 1.4), c.x, c.z, 0.7, 'crystal');
          else if (roll < 0.5) breakable(P.propCrate(rng), c.x, c.z, 0.6, 'crate', 0x9a6a30);
          else if (roll < 0.62) breakable(P.propBarrel(rng), c.x, c.z, 0.55, 'barrel', 0x8a5a2c);
          else stat.add(place(P.propSnowPile(rng), c.x, c.z, 0, rng.range(0, TAU)));
          break;
        case 'inferno':
          if (roll < 0.18) solidProp(P.propRock(rng, 0x3a2a2e), c.x, c.z, 0.9, 'rock');
          else if (roll < 0.3) solidProp(P.propCrystal(0xff7a20, 1.3), c.x, c.z, 0.7, 'crystal');
          else if (roll < 0.5) breakable(P.propPot(0x5a3a3a), c.x, c.z, 0.45, 'pot', 0x5a3a3a);
          else if (roll < 0.62) breakable(P.propBarrel(rng), c.x, c.z, 0.55, 'barrel', 0x8a5a2c);
          else stat.add(place(P.propBones(rng), c.x, c.z, 0, rng.range(0, TAU)));
          break;
        case 'void':
          if (roll < 0.2) solidProp(P.propObelisk(0xc77dff), c.x, c.z, 0.7, 'obelisk');
          else if (roll < 0.38) solidProp(P.propCrystal(0xb060ff, 1.5), c.x, c.z, 0.7, 'crystal');
          else if (roll < 0.58) breakable(P.propPot(0x4a3a6a), c.x, c.z, 0.45, 'pot', 0x4a3a6a);
          else if (roll < 0.7) breakable(P.propCrate(rng), c.x, c.z, 0.6, 'crate', 0x9a6a30);
          else stat.add(place(P.propBones(rng), c.x, c.z, 0, rng.range(0, TAU)));
          break;
      }
    }
    // ground cover
    const cover = Math.floor(r.w * r.h / 6);
    for (let i = 0; i < cover; i++) {
      const c = freeCell(r, 0); if (!c) continue;
      if (B.id === 'meadow') stat.add(place(P.propGrass(rng), c.x, c.z));
      else if (B.id === 'frost' && rng.chance(0.4)) stat.add(place(P.propSnowPile(rng), c.x, c.z, 0, rng.range(0, TAU)));
      else if (B.id === 'sands' && rng.chance(0.2)) stat.add(place(P.propRock(rng, 0xc9a560), c.x, c.z));
      else if (B.id === 'crypt' && rng.chance(0.3)) stat.add(place(P.propRock(rng, 0x55555e), c.x, c.z));
    }
  };

  for (const r of rooms) {
    if (r.type === 'start') {
      // gentle: a few crates
      for (let i = 0; i < 3; i++) { const c = freeCell(r, 1); if (c && Math.hypot(c.x - L.start.x, c.z - L.start.z) > 3) breakable(rng.chance(0.5) ? P.propCrate(rng) : P.propBarrel(rng), c.x, c.z, 0.58, 'crate', 0x9a6a30); }
      continue;
    }
    if (r.type === 'boss') {
      const col = B.torch;
      for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { const x = (r.cx + dx + 0.5) * CS, z = (r.cz + dz + 0.5) * CS; if (L.walkable(r.cx + dx, r.cz + dz)) { const b = P.propBrazier(col); dyn.add(b); place(b, x, z); L.addProp({ type: 'brazier', x, z, r: 0.6, solid: true }); L.torches.push({ x, y: 1.6, z, color: col, flame: b.userData.flame, glow: b.userData.glow, seed: Math.random() * 10 }); } }
      continue;
    }
    biomeDecor(r);
    if (r.type === 'treasure') {
      const c = L.cellCenter(r.cx, r.cz);
      const ch = P.propChest(false); dyn.add(ch); place(ch, c.x, c.z);
      const chest = { type: 'chest', x: c.x, z: c.z, r: 0.8, solid: true, mesh: ch, opened: false, rare: true };
      L.addProp(chest); L.chests.push(chest);
      for (const [dx, dz] of [[-2, 0], [2, 0]]) { const cc = L.cellCenter(r.cx + dx, r.cz + dz); const t = P.propCrystal(B.torch, 1.0); stat.add(t); place(t, cc.x, cc.z); }
    }
    // random chest in some combat rooms
    if (r.type === 'combat' && rng.chance(0.28)) {
      const c = freeCell(r, 2); if (c) { const ch = P.propChest(false); dyn.add(ch); place(ch, c.x, c.z, 0, rng.range(0, TAU)); const chest = { type: 'chest', x: c.x, z: c.z, r: 0.8, solid: true, mesh: ch, opened: false }; L.addProp(chest); L.chests.push(chest); }
    }
  }
  // banners / skulls on walls for crypt & sands
  if (B.id === 'crypt' || B.id === 'sands' || B.id === 'void' || B.id === 'inferno') {
    for (const r of rooms) {
      if (r.type === 'boss') continue;
      for (let i = 0; i < 2; i++) {
        const cells = []; for (let x = r.x0; x <= r.x1; x++) if (L.room[L.idx(x, r.z0)] === r.id && L.walkable(x, r.z0) && L.tile(x, r.z0 - 1) === T_WALL) cells.push(x);
        if (!cells.length) break; const x = rng.pick(cells);
        const b = P.propBanner(B.id === 'sands' ? 0x2a6a9a : B.id === 'void' ? 0x6a2aa0 : B.id === 'inferno' ? 0xa02a10 : 0x8a1a2a); stat.add(b); place(b, (x + 0.5) * CS, r.z0 * CS + 0.12);
      }
    }
  }
  g.add(mergeStatic(stat));
  return L;
}

export function populateCamp(L, rng) {
  const g = L.group; const stat = new THREE.Group();
  const cx = 18 * CS, cz = 18 * CS;
  const place = (o, x, z, rot = 0, y = 0) => { o.position.set(x, y, z); o.rotation.y = rot; return o; };
  const solid = (o, x, z, r, type, extra) => { stat.add(place(o, x, z, rng.range(0, TAU))); L.addProp(Object.assign({ type, x, z, r, solid: true }, extra)); };
  // central campfire
  const cf = P.propCampfire(); g.add(place(cf, cx, cz));
  L.addProp({ type: 'campfire', x: cx, z: cz, r: 1.5, solid: true }); L.campfire = { x: cx, z: cz, flame: cf.userData.flame, glow: cf.userData.glow };
  L.torches.push({ x: cx, y: 1.4, z: cz, color: 0xff9030, flame: cf.userData.flame, glow: cf.userData.glow, seed: 1 });
  // stations
  const st = {};
  const mk = (id, obj, x, z, rot, label, r = 1.4) => { g.add(place(obj, x, z, rot)); const s = { id, x, z, label, obj, r: 3.2 }; st[id] = s; L.addProp({ type: 'station', id, x, z, r, solid: true }); return s; };
  mk('missions', P.propMap(), cx, cz - 15, 0, 'Mission Map');
  mk('smith', P.propAnvil(), cx + 14, cz - 2, -Math.PI / 2, 'Blacksmith');
  mk('merchant', P.propStall(0x2a8a5a), cx - 14, cz - 2, Math.PI / 2, 'Merchant');
  mk('quests', P.propBoard(), cx + 8, cz + 12, Math.PI + 0.4, 'Quest Board');
  L.stations = st;
  // tents / decor
  solid(P.propTent(0xb04030), cx - 12, cz + 8, 2.0, 'tent'); solid(P.propTent(0x3060b0), cx + 15, cz + 6, 2.0, 'tent'); solid(P.propTent(0xc09030), cx - 6, cz + 15, 2.0, 'tent');
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, TAU), d = rng.range(5, 19); const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const ccx = Math.floor(x / CS), ccz = Math.floor(z / CS);
    if (!L.walkable(ccx, ccz) || L.props.some((p) => Math.hypot(p.x - x, p.z - z) < 3.2)) continue;
    const r = rng.next();
    if (r < 0.3) solid(P.propTree(rng, 0x2f7d2a, 0x4faa3e), x, z, 0.9, 'tree');
    else if (r < 0.5) solid(P.propRock(rng), x, z, 0.9, 'rock');
    else if (r < 0.7) { const o = P.propBarrel(rng); stat.add(place(o, x, z)); L.addProp({ type: 'barrel', x, z, r: 0.55, solid: true }); }
    else stat.add(place(P.propFlower(rng), x, z));
  }
  for (let i = 0; i < 110; i++) { const a = rng.range(0, TAU), d = rng.range(2, 21); const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (L.walkable(Math.floor(x / CS), Math.floor(z / CS))) stat.add(place(rng.chance(0.6) ? P.propGrass(rng) : P.propFlower(rng), x, z)); }
  // lamp posts around the edge
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + 0.5, x = cx + Math.cos(a) * 9, z = cz + Math.sin(a) * 9;
    const t = P.propLamp(0xffb050); const flame = t.userData.flame, glow = t.userData.glow;
    const fxg = new THREE.Group(); fxg.position.set(x, 0, z); fxg.add(flame, glow); g.add(fxg);
    stat.add(place(t, x, z));
    L.torches.push({ x, y: 1.9, z, color: 0xffb050, flame, glow, seed: i });
  }
  g.add(mergeStatic(stat));
}
