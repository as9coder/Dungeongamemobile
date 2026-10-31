import * as THREE from 'three';
import { clamp, lerp, damp, rr, ri, pick, TAU, RNG, weightedPick, angleDiff } from './util.js';
import { Effects } from './fx.js';
import { generateCamp, generateDungeon, buildLevelMeshes, BIOMES, CS } from './world.js';
import { populateCamp, populateLevel } from './decor.js';
import * as P from './world.js';
import { Player, Enemy, Projectile, Pickup, ARTIFACT_COL } from './entities.js';
import {
  ENEMIES, BOSSES, BIOME_ENEMIES, MISSIONS, THREATS, QUESTS, ARTIFACTS, WEAPONS, ENCH, RARITY, rollItem, itemDamage, artifactPower, powerMult, xpNeed, MAX_LEVEL, itemValue,
} from './data.js';
import { A } from './audio.js';
import { writeSave, scheduleSave, genStock } from './save.js';
import { part, lam, emissiveMat } from './voxel.js';

const _v = new THREE.Vector3();
const BIOME_COL = { meadow: 0x4a8a30, crypt: 0x6a6a74, sands: 0xc9a560, frost: 0xa8d0f0, inferno: 0x4a2a2a, void: 0x4a3a6a, camp: 0x4a8a30 };
const BOSS_COL = { rotking: 0x9a5aff, lich: 0x7dffb0, sandtyrant: 0xffa030, frostwarden: 0x9ff4ff, magmatitan: 0xff6a1a, voidlord: 0xe070ff };

export class Game {
  constructor(eng, save) {
    this.eng = eng; this.scene = eng.scene; this.save = save; this.settings = save.settings; this.audio = A;
    this.fx = new Effects(eng.scene, eng.camera); eng.fx = this.fx;
    this.input = { mx: 0, mz: 0, attackPressed: false, shoot: false, rollPressed: false, potionPressed: false, art: [false, false, false], interactPressed: false };
    this.enemies = []; this.projectiles = []; this.pickups = []; this.spawners = []; this.beacons = []; this.effects = [];
    this.level = null; this.mode = 'boot'; this.paused = false; this.time = 0; this.hitstopT = 0; this.biomeId = 'camp';
    this.mission = null; this.threat = THREATS[0]; this.run = null; this.boss = null; this.exitPortal = null;
    this.player = new Player(this); this.scene.add(this.player.root);
    this.ui = null; this.flowT = 0; this.ambT = 0; this.ready = true; this.lowShadows = false;
    this.rng = new RNG(1);
  }
  get S() { return this.save; }
  setUI(ui) { this.ui = ui; }
  biomeColor() { return BIOME_COL[this.biomeId] || 0x888888; }
  bossColor() { return this.boss ? (BOSS_COL[this.boss.id] || 0xff6040) : 0xff6040; }
  stat(k, n = 1) { const s = this.save.quests.stats; if (k === 'level') s.level = this.save.level; else s[k] = (s[k] || 0) + n; }
  vibrate(ms) { try { if (window.AndroidBridge) window.AndroidBridge.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* */ } }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  banner(text, kind) { if (this.ui) this.ui.banner(text, kind); }
  toast(text, kind) { if (this.ui) this.ui.toast(text, kind); }

  // ------------------------------------------------------------ level lifecycle
  clearWorld() {
    for (const e of this.enemies) { this.scene.remove(e.root); }
    for (const p of this.projectiles) { this.scene.remove(p.mesh); }
    for (const p of this.pickups) { this.scene.remove(p.mesh); }
    for (const e of this.effects) if (e.mesh) this.scene.remove(e.mesh);
    this.enemies.length = 0; this.projectiles.length = 0; this.pickups.length = 0; this.spawners.length = 0; this.beacons.length = 0; this.effects.length = 0;
    if (this.level) { this.scene.remove(this.level.group); this.level.group.traverse((o) => { if (o.geometry && o.isMesh && !o.geometry.userData.shared) { /* geometry cache shared */ } }); }
    this.fx.clearAll(); this.boss = null; this.exitPortal = null; this.level = null;
  }
  buildLevel(L, biome, populate) {
    buildLevelMeshes(L, this.rng, this.eng.wallUniforms);
    populate(L);
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: new THREE.Color(biome.fog).multiplyScalar(biome.id === 'meadow' ? 0.55 : 0.5) }));
    gp.rotation.x = -Math.PI / 2; gp.position.set(L.w * CS / 2, -0.85, L.h * CS / 2); L.group.add(gp);
    this.scene.add(L.group); this.level = L; this.biomeId = biome.id;
    this.eng.setBiome(biome);
    L.explored = new Uint8Array(L.w * L.h);
  }
  placePlayer(x, z) {
    const p = this.player; p.x = x; p.z = z; p.vx = p.vz = 0; p.state = 'idle'; p.dead = false; p.rig.root.rotation.x = 0; p.rig.body.position.y = 0; p.atk = null; p.status = {};
    p.root.position.set(x, 0, z); this.eng.snapCamera(x, z);
  }
  loadCamp() {
    this.clearWorld(); this.mode = 'camp'; this.mission = null; this.run = null;
    const L = generateCamp(); this.buildLevel(L, BIOMES.camp, (LL) => populateCamp(LL, new RNG(11)));
    this.player.recalc(this.save); this.player.hp = this.player.maxHp; this.player.potions = this.player.maxPotions;
    this.placePlayer(L.start.x, L.start.z); this.eng.setZoom(1.0);
    A.music('camp'); A.setIntensity(0.1); this.station = null;
    for (let i = 0; i < 3; i++) this.player.artCD[i] = 0;
    // a couple of ambient NPC-ish props: none. fireflies handled in ambient()
    if (this.ui) this.ui.onCamp();
    this.eng.fadeTo(0, 1.2);
    scheduleSave(this.save);
    if (!this.save.stock) this.save.stock = genStock(this.save.level);
  }
  startMission(mission, threatIdx = 0) {
    this.clearWorld(); this.mode = 'mission'; this.mission = mission; this.threat = THREATS[threatIdx]; this.threatIdx = threatIdx;
    const seed = (Math.random() * 1e9) | 0; const rng = new RNG(seed);
    const biome = BIOMES[mission.biome];
    const L = generateDungeon(rng, { biome, size: mission.size });
    this.buildLevel(L, biome, (LL) => populateLevel(LL, rng));
    this.mlevel = mission.level + this.threat.lvl;
    this.run = { xp: 0, em: 0, items: [], kills: 0, time: 0, deaths: 0, revived: 0, startLevel: this.save.level, chests: 0, bossDown: false, damageTaken: 0 };
    this.objs = mission.objectives.map((o) => Object.assign({ have: 0, done: false }, o));
    this.player.recalc(this.save); this.player.hp = this.player.maxHp; this.player.potions = 3; this.player.potionKills = 0;
    this.placePlayer(L.start.x, L.start.z);
    this.populateEnemies(rng);
    this.setupObjectives(rng);
    this.eng.setZoom(1.0); this.eng.fadeTo(0, 1.2);
    A.music(mission.biome); A.setIntensity(0.3);
    this.save.runs++;
    if (this.ui) this.ui.onMission();
    this.banner(mission.name, 'title');
    this.toast(mission.intro, 'story');
    this.flowT = 0; this.level.computeFlow(this.player.x, this.player.z);
    this.eng.fx.setScale && this.eng.onResize();
  }
  populateEnemies(rng) {
    const L = this.level, table = BIOME_ENEMIES[this.mission.biome]; const lvl = this.mlevel;
    L.rooms.forEach((r, ri_) => {
      if (r.type === 'start' || r.type === 'boss') return;
      let budget = clamp(Math.round(r.w * r.h / 24), 3, 8) + (this.threatIdx > 0 ? 1 : 0) + (r.type === 'treasure' ? 2 : 0);
      for (let i = 0; i < budget; i++) {
        const id = weightedPick(table, (t) => (ENEMIES[t[0]].elite ? t[1] * (this.mission.level < 3 ? 0 : 1) * (0.5 + ri_ / L.rooms.length) : t[1]))[0];
        const c = this.freeCellInRoom(r, rng); if (!c) continue;
        const e = this.spawnEnemy(id, c.x, c.z, { level: lvl + Math.floor(ri_ * 0.25), room: r.id });
        if (e && id === 'slime') { /* default size 2 */ }
      }
    });
    // a few roaming groups in corridors
  }
  freeCellInRoom(r, rng) {
    const L = this.level;
    for (let a = 0; a < 30; a++) {
      const cx = rng.int(r.x0 + 1, r.x1 - 1), cz = rng.int(r.z0 + 1, r.z1 - 1);
      if (L.room[L.idx(cx, cz)] !== r.id || !L.walkable(cx, cz)) continue;
      const c = L.cellCenter(cx, cz);
      if (L.props.some((p) => p.solid && Math.hypot(p.x - c.x, p.z - c.z) < 1.4)) continue;
      return { x: c.x + rng.range(-0.5, 0.5), z: c.z + rng.range(-0.5, 0.5), cx, cz };
    }
    return null;
  }
  spawnEnemy(id, x, z, o = {}) {
    if (this.enemies.length > 60) return null;
    const e = new Enemy(this, id, x, z, Object.assign({ level: this.mlevel || 1 }, o));
    if (o.aggro) e.aggro = true;
    e.summoned = !!o.summoned;
    this.scene.add(e.root); this.enemies.push(e);
    if (o.summoned) { this.fx.ring(x, z, 1.5, 0xb060ff, 0.5, 0.2); this.fx.burst(x, 0.5, z, 8, { color: 0xb060ff, size: 0.4, speed: 3, life: 0.5, type: 2 }); }
    return e;
  }
  setupObjectives(rng) {
    const L = this.level; const rooms = L.rooms.filter((r) => r.type === 'combat' || r.type === 'treasure');
    const spawnObj = this.objs.find((o) => o.type === 'spawners');
    if (spawnObj) {
      const rs = rng.shuffle(rooms.slice()).slice(0, spawnObj.n);
      rs.forEach((r) => {
        const c = this.freeCellInRoom(r, rng) || L.cellCenter(r.cx, r.cz); const col = { crypt: 0x7a50d8, inferno: 0xff6a20, void: 0xc060ff }[this.mission.biome] || 0x7a50d8;
        const m = P.propSpawner(col); m.position.set(c.x, 0, c.z); L.group.add(m);
        const hpv = 140 * (1 + 0.16 * (this.mlevel - 1)) * this.threat.hp;
        const s = { isSpawner: true, x: c.x, z: c.z, r: 1.1, hp: hpv, maxHp: hpv, mesh: m, room: r.id, spawnT: 2, alive: [], dead: false, color: col };
        this.spawners.push(s); L.addProp({ type: 'spawner', x: c.x, z: c.z, r: 1.0, solid: true });
      });
    }
    const beaconObj = this.objs.find((o) => o.type === 'beacons');
    if (beaconObj) {
      const rs = rng.shuffle(rooms.slice()).slice(0, beaconObj.n);
      rs.forEach((r) => {
        const c = this.freeCellInRoom(r, rng) || L.cellCenter(r.cx, r.cz); const col = this.mission.biome === 'void' ? 0xc060ff : 0x7fe0ff;
        const m = P.propAltar(col); m.position.set(c.x, 0, c.z); L.group.add(m);
        const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.45, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.1, c.z); L.group.add(ring);
        this.beacons.push({ x: c.x, z: c.z, mesh: m, ring, progress: 0, done: false, waves: 0, color: col, room: r.id });
        L.addProp({ type: 'altar', x: c.x, z: c.z, r: 0.9, solid: true });
      });
    }
    const shardObj = this.objs.find((o) => o.type === 'shards');
    if (shardObj) {
      const cands = this.enemies.filter((e) => e.def.elite);
      rng.shuffle(cands);
      let need = shardObj.n;
      for (const e of cands) { if (need <= 0) break; e.carrier = true; need--; this.makeCarrier(e); }
      while (need > 0) { const r = rng.pick(rooms); const c = this.freeCellInRoom(r, rng); if (!c) break; const e = this.spawnEnemy('marauder', c.x, c.z, { level: this.mlevel + 1, room: r.id, elite: true }); if (e) { this.makeCarrier(e); need--; } }
    }
    // boss
    if (this.mission.boss && L.bossRoom) {
      const r = L.bossRoom; const c = L.cellCenter(r.cx, r.cz - 3);
      const e = new Enemy(this, this.mission.boss, c.x, c.z, { boss: true, level: this.mlevel, room: r.id });
      e.dmg = e.def.dmg * (1 + 0.115 * (this.mlevel - 1)); e.xp = e.def.xp * (1 + 0.25 * (this.mlevel - 1));
      this.scene.add(e.root); this.enemies.push(e); this.boss = e; e.face = 0; e.faceInit = true;
      e.root.position.set(c.x, 0, c.z);
    }
    this.bossWoken = false; this.exitOpen = false;
  }
  makeCarrier(e) { const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffd23a })); b.position.y = 3.4; e.root.add(b); e.marker = b; e.auraT = 0; }

  // ------------------------------------------------------------ main update
  update(rdt) {
    if (this.paused || this.mode === 'boot') { this.eng.update(rdt, this.player); this.fx.update(rdt * 0.0); return; }
    let dt = Math.min(rdt, 0.05);
    if (this.hitstopT > 0) { this.hitstopT -= rdt; dt *= 0.06; }
    if (this.slowmo > 0) { this.slowmo -= rdt; dt *= 0.3; }
    this.time += dt;
    const p = this.player, L = this.level; if (!L) return;
    if (this.mode === 'mission' && this.run) this.run.time += dt;
    p.update(dt);
    // flow field refresh
    this.flowT -= dt; if (this.flowT <= 0 && this.mode === 'mission') { this.flowT = 0.3; L.computeFlow(p.x, p.z); }
    // enemies
    let alive = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.scene.remove(e.root); this.enemies.splice(i, 1); continue; }
      const far = Math.hypot(e.x - p.x, e.z - p.z) > 38 && !e.isBoss;
      e.hidden = far; e.root.visible = !far;
      if (far && !e.aggro) continue;
      e.update(dt); alive++;
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) { const pr = this.projectiles[i]; if (pr.dead) { this.projectiles.splice(i, 1); continue; } pr.update(dt); }
    for (let i = this.pickups.length - 1; i >= 0; i--) { const pk = this.pickups[i]; if (pk.dead) { this.pickups.splice(i, 1); continue; } pk.update(dt); }
    this.updateEffects(dt);
    if (this.mode === 'mission') this.updateMission(dt);
    else if (this.mode === 'camp') this.updateCamp(dt);
    // level + torches
    L.update(dt, this.time);
    for (const t of L.torches) { const f = 0.85 + Math.sin(this.time * 12 + t.seed) * 0.15; if (t.flame) { t.flame.scale.set(f, 0.9 + Math.sin(this.time * 9 + t.seed * 2) * 0.25, f); } if (t.glow) t.glow.material.opacity = 0.65 + Math.sin(this.time * 14 + t.seed) * 0.12; if (Math.random() < dt * 5) this.fx.fire(t.x, t.y - 0.1, t.z, 1, 0.6); }
    this.eng.lightTorches(L.torches, p.x, p.z, this.time);
    this.eng.camTarget.set(p.x, 0, p.z);
    this.eng.update(dt, p);
    this.fx.update(dt);
    this.ambient(dt);
    // music intensity
    const near = this.enemies.filter((e) => e.aggro && !e.dead).length;
    A.setIntensity(clamp(near / 6, 0, 1));
    // reset edge-triggered inputs
    const inp = this.input; inp.attackPressed = inp.rollPressed = inp.potionPressed = inp.interactPressed = false; inp.art[0] = inp.art[1] = inp.art[2] = false;
    // fade for lights
  }
  ambient(dt) {
    this.ambT -= dt; if (this.ambT > 0) return; this.ambT = 0.12;
    const p = this.player; const b = this.biomeId; const a = rr(0, TAU), d = rr(2, 14);
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    if (this.level && !this.level.walkable(this.level.cx(x), this.level.cx(z))) return;
    if (b === 'inferno') this.fx.p({ x, y: rr(0, 1), z, vx: rr(-0.3, 0.3), vy: rr(1, 2.5), vz: rr(-0.3, 0.3), life: 3, size: 0.2, size1: 0, color: 0xffa030, color1: 0xff3000, type: 1, alpha: 0.9 });
    else if (b === 'frost') this.fx.p({ x, y: rr(4, 8), z, vx: rr(-0.5, 0.5), vy: rr(-1.2, -0.7), vz: rr(-0.3, 0.3), life: 5, size: 0.14, size1: 0.14, color: 0xffffff, type: 1, alpha: 0.8 });
    else if (b === 'void') this.fx.p({ x, y: rr(0, 4), z, vx: 0, vy: rr(0.3, 1), vz: 0, life: 3, size: 0.25, size1: 0, color: 0xc77dff, type: 2, alpha: 0.8 });
    else if (b === 'meadow' || b === 'camp') this.fx.p({ x, y: rr(0.5, 2.5), z, vx: rr(-0.4, 0.4), vy: rr(-0.1, 0.3), vz: rr(-0.4, 0.4), life: 4, size: 0.2, size1: 0.2, color: 0xe8ff80, color1: 0xa0ff60, type: 0, alpha: 0.9 });
    else this.fx.p({ x, y: rr(0.5, 4), z, vx: rr(-0.2, 0.2), vy: rr(0, 0.2), vz: rr(-0.2, 0.2), life: 4, size: 0.12, size1: 0.12, color: b === 'sands' ? 0xfff0b0 : 0xc8c8e0, type: 1, alpha: 0.35 });
  }

  // ------------------------------------------------------------ camp
  updateCamp(dt) {
    const p = this.player, L = this.level; let near = null;
    for (const k in L.stations) { const s = L.stations[k]; const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < s.r) near = s; s.obj.userData.beacon && (s.obj.userData.beacon.rotation.y += dt * 2, s.obj.userData.beacon.position.y += Math.sin(this.time * 3) * dt * 0.1); }
    this.station = near;
    if (near && this.input.interactPressed || near && this.input.attackPressed) { this.input.attackPressed = false; if (this.ui) this.ui.openStation(near.id); }
    // campfire sparks
    if (Math.random() < dt * 14) this.fx.fire(L.campfire.x, 0.5, L.campfire.z, 2, 1.4);
    if (Math.random() < dt * 4) this.fx.p({ x: L.campfire.x + rr(-0.5, 0.5), y: 1.2, z: L.campfire.z + rr(-0.5, 0.5), vy: rr(2, 4), vx: rr(-1, 1), vz: rr(-1, 1), life: 1.4, size: 0.16, size1: 0, color: 0xffd060, type: 1, alpha: 1 });
    if (Math.random() < dt * 3) this.fx.smoke(L.campfire.x, 2.2, L.campfire.z, 1, 0x666666, 1.2);
    // potions replenished
    p.potions = p.maxPotions;
  }

  // ------------------------------------------------------------ mission logic
  objDone(type) { const o = this.objs.find((x) => x.type === type); return !o || o.done; }
  progress(type, n = 1) {
    const o = this.objs.find((x) => x.type === type && !x.done); if (!o) return;
    o.have = Math.min(o.n || 1, o.have + n);
    if (o.have >= (o.n || 1)) { o.done = true; this.banner('Objective complete!', 'good'); A.sfx('loot'); this.toast(o.text + ' ✔', 'good'); }
    this.checkExit();
  }
  checkExit() {
    if (this.exitOpen) return;
    if (this.objs.every((o) => o.done)) this.openExit();
  }
  openExit() {
    this.exitOpen = true; const L = this.level; const r = L.bossRoom || L.rooms[L.rooms.length - 1];
    const c = L.bossRoom ? L.cellCenter(r.cx, r.cz) : (this.boss ? { x: this.boss.x, z: this.boss.z } : L.cellCenter(r.cx, r.cz));
    const col = BIOMES[this.mission.biome].torch;
    const portal = P.propPortal(0x70f0ff); portal.position.set(c.x, 0, c.z); portal.rotation.y = 0.6; L.group.add(portal);
    this.exitPortal = { x: c.x, z: c.z, mesh: portal };
    this.fx.ring(c.x, c.z, 8, 0x70f0ff, 1.2, 1); A.sfx('portal');
    this.banner('The portal is open!', 'good'); this.toast('Step into the portal to return to camp.', 'info');
    this.fx.burst(c.x, 2, c.z, 30, { color: 0x70f0ff, size: 0.6, speed: 6, life: 1.2, type: 2 });
  }
  updateMission(dt) {
    const p = this.player, L = this.level;
    // explore reveal
    this.revealT = (this.revealT || 0) - dt;
    if (this.revealT <= 0) {
      this.revealT = 0.25; const pcx = L.cx(p.x), pcz = L.cx(p.z), R = 8;
      for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) { if (x * x + z * z > R * R) continue; const cx = pcx + x, cz = pcz + z; if (L.inb(cx, cz)) L.explored[L.idx(cx, cz)] = 1; }
    }
    // boss wake
    if (this.boss && !this.boss.aggro && !this.boss.dead) {
      const b = this.boss; const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < 13 && L.los(p.x, p.z, b.x, b.z) || d < 9) this.wakeBoss();
    }
    // chests
    for (const c of L.chests) { if (!c.opened && Math.hypot(c.x - p.x, c.z - p.z) < 2.0) this.openChest(c); if (c.opened && c.anim < 1) { c.anim = Math.min(1, c.anim + dt * 3); c.mesh.userData.lid.rotation.x = -1.9 * c.anim; } }
    // spawners
    for (const s of this.spawners) {
      if (s.dead) continue; const d = Math.hypot(p.x - s.x, p.z - s.z);
      s.mesh.userData.core.rotation.y += dt * 2; s.mesh.userData.core.position.y = 1.2 + Math.sin(this.time * 3 + s.x) * 0.15;
      if (d < 18) {
        s.alive = s.alive.filter((e) => !e.dead); s.spawnT -= dt;
        if (s.spawnT <= 0 && s.alive.length < 3) {
          s.spawnT = 5.5; const a = rr(0, TAU); const biome = this.mission.biome; const pickId = pick(BIOME_ENEMIES[biome].filter((t) => !ENEMIES[t[0]].elite))[0];
          const e = this.spawnEnemy(pickId, s.x + Math.cos(a) * 2, s.z + Math.sin(a) * 2, { level: this.mlevel, aggro: true, summoned: true, room: s.room }); if (e) { s.alive.push(e); this.fx.burst(s.x, 1.2, s.z, 14, { color: s.color, size: 0.5, speed: 5, life: 0.6, type: 2 }); A.sfx('summon', 0.5); }
        }
        if (Math.random() < dt * 8) this.fx.p({ x: s.x + rr(-0.5, 0.5), y: rr(1, 2.2), z: s.z + rr(-0.5, 0.5), vy: 1.5, life: 0.8, size: 0.3, size1: 0, color: s.color, type: 2 });
      }
    }
    // beacons
    for (const b of this.beacons) {
      if (b.done) { b.mesh.userData.gem.rotation.y += dt * 2; continue; }
      const d = Math.hypot(p.x - b.x, p.z - b.z); const on = d < 2.4 && !p.dead;
      b.mesh.userData.gem.rotation.y += dt * (1 + b.progress * 6); b.mesh.userData.gem.position.y = 2.0 + Math.sin(this.time * 3) * 0.1;
      b.ring.material.opacity = 0.3 + b.progress * 0.5 + (on ? 0.2 : 0); b.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.03);
      if (on) {
        b.progress = Math.min(1, b.progress + dt / 4.2);
        if (Math.random() < dt * 30) this.fx.p({ x: b.x + rr(-1.5, 1.5), y: 0.2, z: b.z + rr(-1.5, 1.5), vy: 3 + b.progress * 3, life: 0.7, size: 0.3, size1: 0, color: b.color, type: 2 });
        const nextWave = [0.05, 0.45, 0.8][b.waves];
        if (nextWave !== undefined && b.progress >= nextWave) {
          b.waves++; this.banner('Ambush!', 'warn'); A.sfx('summon');
          const biome = this.mission.biome; const n = 3 + b.waves + (this.threatIdx > 0 ? 1 : 0);
          for (let i = 0; i < n; i++) { const a = i / n * TAU; const id = weightedPick(BIOME_ENEMIES[biome], (t) => (ENEMIES[t[0]].elite ? 0.3 * t[1] : t[1]))[0]; const x = b.x + Math.cos(a) * 6, z = b.z + Math.sin(a) * 6; if (this.level.walkable(this.level.cx(x), this.level.cx(z))) this.spawnEnemy(id, x, z, { level: this.mlevel, aggro: true, summoned: true }); }
        }
        if (b.progress >= 1) {
          b.done = true; this.fx.ring(b.x, b.z, 9, b.color, 0.9, 1); this.fx.burst(b.x, 2, b.z, 30, { color: b.color, size: 0.6, speed: 7, life: 1, type: 2 }); A.sfx('beacon'); this.eng.addShake(0.4); this.progress('beacons');
          b.ring.material.opacity = 0.9; this.fx.flashLight(b.x, 3, b.z, b.color, 12, 0.8);
        }
      } else b.progress = Math.max(0, b.progress - dt * 0.15);
    }
    // portal
    if (this.exitPortal) {
      const e = this.exitPortal; const sh = e.mesh.userData.sheet; sh.material.opacity = 0.45 + Math.sin(this.time * 4) * 0.12; sh.scale.y = 1 + Math.sin(this.time * 3) * 0.02;
      if (Math.random() < dt * 20) this.fx.p({ x: e.x + rr(-1.2, 1.2), y: rr(0.2, 3.8), z: e.z + rr(-0.3, 0.3), vy: rr(0.5, 2), life: 1, size: 0.3, size1: 0, color: 0x70f0ff, type: 2 });
      if (Math.hypot(p.x - e.x, p.z - e.z) < 2.4 && !p.dead && !this.completing) this.completeMission();
    }
    // breakable props: arrows handled by targetsIn
    // death-fade fail-safe
  }
  openChest(c) {
    c.opened = true; c.anim = 0; this.stat('chests', 1); if (this.run) this.run.chests++;
    A.sfx('chest'); const fx = this.fx; fx.ring(c.x, c.z, 3, 0xffd060, 0.5, 0.3); fx.burst(c.x, 1.2, c.z, 22, { color: 0xffe080, size: 0.5, speed: 6, life: 0.8, type: 2, lift: 3 }); fx.flashLight(c.x, 2, c.z, 0xffd060, 8, 0.4);
    const luck = this.player.stats.luck; const n = 1 + (c.rare ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) { const it = rollItem((this.mlevel || 1) + ri(0, 2), { bonus: c.rare ? 0.28 : 0.1, luck }); this.dropItem(it, c.x + rr(-1.2, 1.2), c.z + rr(-1.2, 1.2) + 1); }
    this.dropEmeralds(c.x, c.z + 1, Math.round((12 + this.mlevel * 4) * (c.rare ? 1.8 : 1)));
    if (Math.random() < 0.4) this.drop('heart', c.x, c.z + 1);
    this.eng.addShake(0.15);
  }
  wakeBoss() {
    const b = this.boss; b.aggro = true; this.bossWoken = true; A.sfx('roar'); A.music('boss'); this.eng.setZoom(1.22); this.eng.addShake(0.6);
    this.banner(b.def.name, 'boss'); this.toast(b.def.title, 'story'); this.fx.ring(b.x, b.z, 10, 0xff4040, 0.9, 1);
    b.cdT = 2.0; if (this.ui) this.ui.onBoss(b);
  }
  completeMission() {
    this.completing = true; const m = this.mission; const S = this.save; const R = this.run;
    A.sfx('victory'); this.eng.fadeTo(1, 0.8); A.music('camp'); this.player.invuln = 6;
    // bonus victory loot
    const items = []; const n = 1 + (this.threatIdx > 0 ? 1 : 0);
    for (let i = 0; i < n; i++) { const it = rollItem(this.mlevel + 1, { bonus: 0.18 * this.threat.loot, luck: this.player.stats.luck }); items.push(it); }
    const bonusEm = Math.round(40 * this.mlevel * this.threat.loot);
    S.emeralds += bonusEm; R.em += bonusEm; this.stat('emTotal', bonusEm);
    for (const it of items) { this.addItem(it); R.items.push(it); }
    const prev = S.done[m.id]; if (prev === undefined || prev < this.threatIdx) S.done[m.id] = this.threatIdx;
    if (this.threatIdx > 0) this.stat('adventure', 1);
    S.stock = genStock(S.level, this.player.stats.luck);
    writeSave(S);
    this.completeAt = this.time;
    setTimeout(() => { this.completing = false; if (this.ui) this.ui.showResults(true, items, bonusEm); }, 900);
    this.paused = false;
  }
  onPlayerDeath() {
    A.music('camp'); A.setIntensity(0); this.run && (this.run.deaths++);
    setTimeout(() => { if (this.ui && this.mode === 'mission') this.ui.showDeath(); }, 1300);
  }
  revivePlayer() {
    const cost = 60 * this.mlevel; if (this.save.emeralds < cost) return false;
    this.save.emeralds -= cost; this.player.revive(); this.run.revived++;
    for (const e of this.enemies) if (!e.isBoss && Math.hypot(e.x - this.player.x, e.z - this.player.z) < 6) { e.knock.x += (e.x - this.player.x) * 2; e.knock.z += (e.z - this.player.z) * 2; }
    A.music(this.boss && this.boss.aggro ? 'boss' : this.mission.biome); return true;
  }
  failMission() { this.eng.fadeTo(1, 1.2); setTimeout(() => { this.ui.showResults(false, [], 0); }, 700); }

  // ------------------------------------------------------------ targeting & combat
  targetsIn(x, z, r) {
    const out = []; const r2 = r * r;
    for (const e of this.enemies) { if (e.dead || e.hidden) continue; const dx = e.x - x, dz = e.z - z; const rr_ = r + e.r; if (dx * dx + dz * dz < rr_ * rr_) { e.isTarget = true; out.push(e); } }
    for (const s of this.spawners) { if (s.dead) continue; const dx = s.x - x, dz = s.z - z; if (dx * dx + dz * dz < (r + 1) * (r + 1)) out.push(s); }
    const L = this.level; const cx0 = L.cx(x - r), cx1 = L.cx(x + r), cz0 = L.cx(z - r), cz1 = L.cx(z + r);
    const seen = new Set();
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) { const l = L.propGrid.get(cz * L.w + cx); if (!l) continue; for (const pr of l) { if (!pr.breakable || pr.dead || seen.has(pr)) continue; seen.add(pr); const dx = pr.x - x, dz = pr.z - z; if (dx * dx + dz * dz < (r + pr.r) * (r + pr.r)) out.push(pr); } }
    return out;
  }
  hitTarget(t, dmg, o) {
    if (t.isSpawner) return this.damageSpawner(t, dmg, o);
    if (t.breakable) return this.breakProp(t);
    return this.damageEnemy(t, dmg, o);
  }
  damageSpawner(s, dmg, o) {
    if (s.dead) return; s.hp -= dmg; this.fx.number(s.x, 2.6, s.z, String(Math.round(dmg)), o && o.crit ? 'crit' : ''); this.fx.sparks(s.x, 1.4, s.z, s.color, 8); A.sfx('hit');
    s.mesh.scale.setScalar(1.08); setTimeout(() => s.mesh && s.mesh.scale.setScalar(1), 60);
    if (s.hp <= 0) {
      s.dead = true; this.level.group.remove(s.mesh); const pr = this.level.props.find((p) => p.type === 'spawner' && p.x === s.x && p.z === s.z); if (pr) this.level.removeProp(pr);
      this.fx.ring(s.x, s.z, 6, s.color, 0.7, 0.5); this.fx.burst(s.x, 1.4, s.z, 40, { color: s.color, size: 0.7, speed: 9, life: 0.9, type: 2 }); this.fx.debrisBurst(s.x, 1.2, s.z, 24, [0x1a1a22, s.color], 8, 0.25);
      this.fx.flashLight(s.x, 2, s.z, s.color, 14, 0.7); A.sfx('spawner'); this.eng.addShake(0.6); this.hitstop(0.1);
      for (let i = 0; i < 8; i++) this.drop('emerald', s.x, s.z, 3);
      for (const e of s.alive) if (!e.dead) { e.hp = 0; e.dead = true; this.onEnemyDeath(e, {}); }
      this.progress('spawners');
    }
  }
  breakProp(p) {
    if (p.dead) return; const L = this.level; L.removeProp(p);
    this.fx.debrisBurst(p.x, 0.6, p.z, 10, [p.color || 0x9a6a30, 0x5a3a18], 5, 0.16); this.fx.smoke(p.x, 0.5, p.z, 2, 0xaaa090, 0.8); A.sfx('break');
    this.stat('breaks', 1);
    const luck = 1 + this.player.stats.luck;
    if (Math.random() < 0.55 * luck) this.drop('emerald', p.x, p.z, ri(1, 3));
    if (Math.random() < 0.07) this.drop('heart', p.x, p.z);
    if (Math.random() < 0.03 && this.mode === 'mission') this.drop('potion', p.x, p.z);
    if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
  }
  damageEnemy(e, dmg, o = {}) {
    if (e.dead) return;
    if (e.invulnPhase > 0) { this.fx.number(e.x, e.y + 2.5, e.z, 'IMMUNE', 'info'); return; }
    dmg = Math.max(1, Math.round(dmg)); if (e.status.freeze && !o.dot) dmg = Math.round(dmg * 1.25);
    e.hp -= dmg; this.stat('damage', dmg);
    const p = this.player; const w = o.weapon;
    const colE = w && w.enchants && w.enchants[0] ? ENCH[w.enchants[0]].color : (o.color || 0xffffff);
    const ey = (e.y || 0) + 1.2 * (e.baseScale || 1);
    if (!o.dot) {
      e.onHit(dmg, o.srcX === undefined ? p.x : o.srcX, o.srcZ === undefined ? p.z : o.srcZ, o.kb || 0, o.heavy);
      this.fx.number(e.x, ey + 1, e.z, String(dmg), o.crit ? 'crit' : (o.proc ? 'proc' : ''));
      this.fx.sparks(e.x, ey, e.z, o.crit ? 0xffe070 : 0xffe9c0, o.crit ? 14 : 7, o.crit ? 8 : 5);
      this.fx.debrisBurst(e.x, ey, e.z, o.crit ? 6 : 3, this.enemyColors(e), 4.5, 0.14);
      if (o.melee || o.projectile) A.sfx(o.crit ? 'crit' : 'hit', o.crit ? 1 : 0.8);
      if (o.crit) { this.stat('crits', 1); this.fx.ring(e.x, e.z, 1.6, 0xffe070, 0.25, 0.3, ey); this.eng.addShake(0.15); }
    } else this.fx.number(e.x, ey + 0.6, e.z, String(dmg), 'dot');
    if (w && !o.dot && !o.proc) this.applyEnchants(e, dmg, w, o);
    if (e.hp <= 0) { e.dead = true; this.onEnemyDeath(e, o); }
  }
  enemyColors(e) { const cols = []; for (const m of (e.rig.mats || [])) if (m.color) cols.push(m.color.getHex()); return cols.length ? cols.slice(0, 4) : [0x888888]; }
  applyEnchants(e, dmg, w, o) {
    const p = this.player; const en = w.enchants;
    for (const k of en) {
      switch (k) {
        case 'fire': if (Math.random() < 0.7) e.setStatus('burn', 3.2, dmg * 0.5); this.fx.burst(e.x, 1.2, e.z, 5, { color: 0xffa030, color1: 0xff3000, size: 0.5, speed: 3, life: 0.5 }); break;
        case 'frost': if (Math.random() < 0.4) { if (!e.isBoss && Math.random() < 0.3) { e.setStatus('freeze', 1.6); this.fx.burst(e.x, 1.2, e.z, 12, { color: 0xbff4ff, size: 0.4, speed: 4, life: 0.7, type: 1 }); A.sfx('freeze', 0.5); } else e.setStatus('slow', 3); } break;
        case 'shock': if (Math.random() < 0.33) this.chainLightning(e, dmg * 0.55, 2, 6); break;
        case 'venom': if (Math.random() < 0.6) e.setStatus('poison', 4, dmg * 0.4); break;
        case 'vamp': { const h = Math.max(1, dmg * 0.045); p.heal(h, true); if (Math.random() < 0.3) this.fx.p({ x: e.x, y: 1.2, z: e.z, vy: 3, life: 0.5, size: 0.3, size1: 0, color: 0xff4a7a, type: 2 }); break; }
        case 'boom': if (Math.random() < 0.28) { this.explosion(e.x, e.z, 2.4, dmg * 0.6, { color: 0xffa23a, proc: true, hurtEnemies: 1, noPlayerHurt: true, quiet: true, except: e }); } break;
        case 'gravity': if (Math.random() < 0.35) { for (const o2 of this.enemies) { if (o2 === e || o2.dead || o2.isBoss) continue; const dx = e.x - o2.x, dz = e.z - o2.z, d = Math.hypot(dx, dz); if (d < 5 && d > 0.5) { o2.knock.x += dx / d * 7; o2.knock.z += dz / d * 7; } } this.fx.ring(e.x, e.z, 5, 0xb08aff, 0.4, 5, 0.3, 0.6); } break;
      }
    }
  }
  chainLightning(from, dmg, n, range) {
    let cur = from; const hit = new Set([from]);
    for (let i = 0; i < n; i++) {
      let best = null, bd = range * range;
      for (const e of this.enemies) { if (e.dead || hit.has(e)) continue; const d2 = (e.x - cur.x) ** 2 + (e.z - cur.z) ** 2; if (d2 < bd) { bd = d2; best = e; } }
      if (!best) break; hit.add(best);
      this.fx.bolt(cur.x, 1.4, cur.z, best.x, 1.2, best.z, 0xfff06a, 0.12, 0.25, 0.4); A.sfx('zap', 0.4);
      this.damageEnemy(best, dmg, { proc: true, color: 0xfff06a, srcX: cur.x, srcZ: cur.z, kb: 1 }); cur = best;
    }
  }
  onEnemyDeath(e, o = {}) {
    const g = this, p = this.player, ey = 1.0 * (e.baseScale || 1);
    // voxel disintegrate
    const cols = this.enemyColors(e); const nDeb = e.isBoss ? 60 : e.elite ? 22 : 12;
    this.fx.debrisBurst(e.x, 0.8 + (e.y || 0), e.z, nDeb, cols, e.isBoss ? 12 : 6, e.isBoss ? 0.4 : 0.2 * (e.baseScale || 1));
    if (!o.silent) { this.fx.burst(e.x, ey, e.z, e.isBoss ? 40 : 10, { color: 0xffffff, color1: 0xaaaaaa, size: 0.7, speed: 4, life: 0.5, add: false, alpha: 0.5, type: 0 }); this.fx.smoke(e.x, 0.6, e.z, 3, 0x777777, 1.0); A.sfx('kill', e.isBoss ? 1 : 0.7); }
    e.root.visible = false; e.dead = true;
    if (e.summoned && e.summoner) { /* no loot for summons? they still give a little */ }
    // xp and loot
    const luck = 1 + p.stats.luck; const thr = this.threat ? this.threat.loot : 1;
    if (this.mode === 'mission') {
      this.addXp(e.xp * (e.summoned ? 0.4 : 1));
      this.stat('kills', 1); this.run.kills++; if (!e.summoned && !e.isBoss || e.isBoss === false) this.progress('kill');
      const emN = e.def.em ? Math.max(1, Math.round(e.def.em * luck * (1 + 0.04 * (this.mlevel - 1)) * (e.summoned ? 0.4 : 1) * thr)) : 0;
      this.dropEmeralds(e.x, e.z, emN);
      if (Math.random() < (e.hp !== undefined && p.hp / p.maxHp < 0.4 ? 0.14 : 0.06)) this.drop('heart', e.x, e.z);
      p.potionKills++; if (p.potionKills >= 14 && p.potions < p.maxPotions) { p.potionKills = 0; p.potions++; this.toast('+1 Potion', 'good'); }
      let ch = (e.isBoss ? 1 : e.elite ? 0.5 : 0.045) * thr * (e.summoned ? 0.3 : 1) * (1 + p.stats.luck);
      let drops = e.isBoss ? 3 : 1;
      for (let i = 0; i < drops; i++) if (Math.random() < ch) { const it = rollItem(this.mlevel + ri(0, 2), { bonus: e.isBoss ? 0.4 : e.elite ? 0.12 : 0, luck: p.stats.luck }); this.dropItem(it, e.x + rr(-1, 1), e.z + rr(-1, 1)); }
      if (e.carrier) { this.drop('shard', e.x, e.z); }
      if (e.id === 'slime' && e.size > 1) { for (let i = 0; i < 2; i++) { const a = i * Math.PI + rr(0, 1); const s = this.spawnEnemy('slime', e.x + Math.cos(a) * 0.8, e.z + Math.sin(a) * 0.8, { level: e.level, size: e.size - 1, aggro: true, room: e.room, summoned: true }); if (s) { s.knock.x = Math.cos(a) * 5; s.knock.z = Math.sin(a) * 5; } } }
      if (e.isBoss) this.onBossDeath(e);
    } else this.dropEmeralds(e.x, e.z, 1);
  }
  onBossDeath(e) {
    this.slowmo = 1.4; this.eng.addShake(1); A.sfx('explode'); A.sfx('roar', 0.6); this.run.bossDown = true; this.stat('bosses', 1);
    this.fx.ring(e.x, e.z, 14, 0xffffff, 1.0, 1); this.fx.flashLight(e.x, 3, e.z, 0xffffff, 20, 1.0);
    for (let i = 0; i < 80; i++) this.fx.p({ x: e.x, y: rr(0.5, 3), z: e.z, vx: rr(-10, 10), vy: rr(2, 12), vz: rr(-10, 10), life: rr(0.8, 1.6), size: rr(0.4, 1.0), size1: 0, color: 0xffe9a0, color1: 0xff8030, type: 2, grav: 8 });
    for (let i = 0; i < 14; i++) this.drop('emerald', e.x, e.z, ri(4, 12));
    for (const x of this.enemies) if (!x.dead && x !== e && x.summoned) { x.hp = 0; x.dead = true; this.onEnemyDeath(x, {}); }
    this.eng.setZoom(1.0); A.music(this.mission.biome); this.boss = null; this.banner('VICTORY!', 'boss'); if (this.ui) this.ui.onBossGone();
    this.progress('boss');
  }
  dropEmeralds(x, z, n) {
    while (n > 0) { const v = n >= 20 ? 10 : n >= 8 ? 5 : 1; this.drop('emerald', x, z, v); n -= v; if (this.pickups.length > 150) break; }
  }
  drop(kind, x, z, value = 1) {
    if (kind === 'emerald' && value > 1 && value <= 3) { for (let i = 0; i < value; i++) this.pickups.push(new Pickup(this, 'emerald', x, z, { value: 1 })); return; }
    this.pickups.push(new Pickup(this, kind, x, z, { value }));
  }
  dropItem(it, x, z) { this.pickups.push(new Pickup(this, 'item', x, z, { item: it, delay: 0.6 })); A.sfx('loot', 0.7); }
  collect(pk) {
    const S = this.save, p = this.player;
    switch (pk.kind) {
      case 'emerald': S.emeralds += pk.value; if (this.run) this.run.em += pk.value; this.stat('emTotal', pk.value); A.sfx('emerald', 0.6); this.fx.p({ x: pk.x, y: 1, z: pk.z, vy: 2, life: 0.5, size: 0.4, size1: 0, color: 0x40ff90, type: 2 }); this.ui && this.ui.pulse('em'); break;
      case 'heart': p.heal(p.maxHp * 0.25); A.sfx('heart'); this.fx.ring(p.x, p.z, 1.8, 0xff6a8a, 0.5, 0.3); break;
      case 'potion': if (p.potions < p.maxPotions) p.potions++; A.sfx('pickup'); this.toast('+1 Potion', 'good'); break;
      case 'shard': A.sfx('loot'); this.fx.ring(p.x, p.z, 3, 0xffd23a, 0.6, 0.3); this.progress('shards'); break;
      case 'item': { const added = this.addItem(pk.item); if (this.run) this.run.items.push(pk.item); A.sfx('pickup'); this.toast((added ? '' : '(Inventory full - sold) ') + pk.item.name, pk.item.rarity); this.fx.ring(p.x, p.z, 2.2, new THREE.Color(RARITY[pk.item.rarity].color).getHex(), 0.5, 0.3); break; }
    }
  }
  addItem(it) {
    const S = this.save;
    if (S.inv.length >= 48) { const v = itemValue(it); S.emeralds += v; return false; }
    S.inv.push(it); return true;
  }
  addXp(n) {
    const S = this.save; if (S.level >= MAX_LEVEL) return; n = Math.round(n); S.xp += n; if (this.run) this.run.xp += n;
    while (S.level < MAX_LEVEL && S.xp >= xpNeed(S.level)) {
      S.xp -= xpNeed(S.level); S.level++; this.stat('level');
      const p = this.player; p.recalc(S); p.hp = p.maxHp; A.sfx('levelup'); this.banner('LEVEL ' + S.level, 'good');
      this.fx.ring(p.x, p.z, 6, 0xffe070, 0.9, 0.5); this.fx.burst(p.x, 1.5, p.z, 40, { color: 0xffe070, size: 0.5, speed: 8, life: 1.0, type: 2, lift: 3 });
      this.toast('Level up! Health restored.', 'good');
    }
  }
  damagePlayer(dmg, sx, sz, o = {}) {
    const p = this.player; if (p.dead || p.invuln > 0 || p.state === 'roll') return false;
    const S = p.stats; const lvl = this.mlevel || 1;
    const red = S.def / (S.def + 55 + 12 * lvl);
    dmg = Math.max(1, Math.round(dmg * (1 - red) * (o.mult || 1)));
    if (this.run) this.run.damageTaken += dmg;
    p.onHurt(dmg, sx, sz, o.kb || 4);
    if (o.poison) p.setStatus('poison', 3, dmg * 0.5);
    if (S.thorns && o.src && o.src.hp !== undefined && !o.src.dead && Math.hypot(o.src.x - p.x, o.src.z - p.z) < 3.5) this.damageEnemy(o.src, dmg * S.thorns / (1 - red) * 2, { proc: true, color: 0xffffff });
    return true;
  }
  explosion(x, z, r, dmg, o = {}) {
    const fx = this.fx; const col = o.color || 0xff7a30;
    fx.ring(x, z, r * 1.1, col, 0.45, r * 0.2, 0.3); if (!o.quiet) fx.ring(x, z, r * 1.5, 0xffffff, 0.3, r * 0.3, 0.3, 0.5);
    fx.burst(x, 0.8, z, o.quiet ? 10 : 26, { color: 0xffe080, color1: col, size: 1.0, speed: o.quiet ? 5 : 9, life: 0.6, up: 1.4 });
    fx.smoke(x, 0.5, z, o.quiet ? 2 : 5, 0x555555, 1.6); fx.debrisBurst(x, 0.5, z, o.quiet ? 6 : 16, [this.biomeColor(), 0x555555], 8, 0.22);
    fx.flashLight(x, 2, z, col, o.quiet ? 6 : 12, 0.35);
    if (!o.quiet) { this.eng.addShake(o.shake || 0.55); A.sfx('explode', 0.9); } else A.sfx('explode', 0.4);
    const p = this.player;
    if (!o.noPlayerHurt && !p.dead) { const d = Math.hypot(p.x - x, p.z - z); if (d < r + p.r) this.damagePlayer(dmg * (1 - clamp(d / (r + 0.5), 0, 0.5) * 0.4), x, z, { kb: 8, src: o.src }); }
    if (o.hurtEnemies || o.proc || !o.noEnemyHurt) {
      if (o.hurtEnemies) for (const e of this.enemies) { if (e.dead || e === o.src || e === o.except) continue; const d = Math.hypot(e.x - x, e.z - z); if (d < r + e.r) this.damageEnemy(e, dmg * o.hurtEnemies, { proc: true, kb: 6, srcX: x, srcZ: z, color: col }); }
    }
    for (const t of this.targetsIn(x, z, r)) if (t.breakable) this.breakProp(t);
  }
  aoeDamage(x, z, r, dmg, o = {}) {
    for (const t of this.targetsIn(x, z, r)) {
      if (t.isSpawner || t.breakable) { this.hitTarget(t, dmg, o); continue; }
      this.damageEnemy(t, dmg * rr(0.92, 1.08), Object.assign({ proc: true, srcX: x, srcZ: z, heavy: false }, o));
    }
  }
  groundStrike(x, z, r, dmg, delay, o = {}) {
    const fx = this.fx; const col = o.color || 0xff4040;
    fx.telegraph(x, z, r, delay, { color: 0xff3030, cb: () => {
      const p = this.player;
      if (o.meteor) {
        fx.burst(x, 0.6, z, 20, { color: col, size: 0.9, speed: 8, life: 0.6, up: 1.5 }); fx.ring(x, z, r * 1.3, col, 0.4, 0.3); fx.debrisBurst(x, 0.5, z, 10, [this.biomeColor(), col], 8, 0.25); fx.flashLight(x, 2, z, col, 9, 0.3); A.sfx('explode', 0.6); this.eng.addShake(0.3);
      } else { fx.burst(x, 0.5, z, 16, { color: col, size: 0.6, speed: 6, life: 0.5, up: 1.6, type: 2 }); fx.ring(x, z, r * 1.2, col, 0.3, 0.2); A.sfx('break', 0.7); fx.debrisBurst(x, 0.3, z, 8, [col, 0x333344], 6, 0.2); }
      if (!p.dead && Math.hypot(p.x - x, p.z - z) < r + p.r * 0.5) this.damagePlayer(dmg, x, z, { kb: 6, src: o.src });
    } });
    if (o.meteor) { // falling streak visual
      let t = 0; const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.6) })); this.scene.add(m);
      this.effects.push({ type: 'meteor', mesh: m, t: 0, dur: delay, x, z, col });
    }
  }
  spawnProjectile(o) { const p = new Projectile(this, o); this.projectiles.push(p); return p; }

  // ------------------------------------------------------------ artifacts
  castArtifact(i) {
    const p = this.player; const a = p.artifacts && p.artifacts[i]; if (!a || p.dead || p.artCD[i] > 0 || p.state === 'roll') return;
    const key = a.art; const def = ARTIFACTS[key]; const pow = artifactPower(a) * (1 + 0.035 * (this.save.level - 1));
    const cd = def.cd * p.stats.cdMult; p.artCD[i] = p.artMax[i] = cd; p.state = 'cast'; p.castT = 0.38; p.atk = null; this.stat('arts', 1);
    const tgt = p.nearestEnemy(14, 3.2, p.fwdX, p.fwdZ); if (tgt) p.face = Math.atan2(tgt.x - p.x, tgt.z - p.z);
    const fx = this.fx, dmgBase = 42 * pow;
    A.sfx('open', 0.5);
    switch (key) {
      case 'flame': this.effects.push({ type: 'flame', t: 0, dur: 1.5, dmg: dmgBase * 0.34, tick: 0, ang: Math.atan2(Math.cos(p.face), Math.sin(p.face)) }); A.sfx('fire'); break;
      case 'thunder': {
        const ts = this.enemies.filter((e) => !e.dead && !e.hidden && Math.hypot(e.x - p.x, e.z - p.z) < 15).sort((a2, b2) => Math.hypot(a2.x - p.x, a2.z - p.z) - Math.hypot(b2.x - p.x, b2.z - p.z)).slice(0, 6);
        const list = ts.length ? ts : [{ x: p.x + p.fwdX * 5, z: p.z + p.fwdZ * 5, fake: true }];
        list.forEach((e, k) => setTimeout(() => { if (this.mode === 'boot') return; const ex = e.x, ez = e.z; fx.bolt(ex + rr(-1, 1), 14, ez + rr(-1, 1), ex, 0.5, ez, 0xfff06a, 0.22, 0.4, 1.0); fx.ring(ex, ez, 2.4, 0xfff06a, 0.3, 0.3); fx.flashLight(ex, 2, ez, 0xfff06a, 10, 0.25); A.sfx('zap'); this.eng.addShake(0.25); if (!e.fake && !e.dead) { this.damageEnemy(e, dmgBase * 1.25, { proc: true, color: 0xfff06a, srcX: ex, srcZ: ez, kb: 3, heavy: true }); e.stunT = Math.max(e.stunT, 0.5); this.chainLightning(e, dmgBase * 0.5, 2, 5); } }, k * 90));
        break;
      }
      case 'frost': {
        fx.ring(p.x, p.z, 8, 0x9ff0ff, 0.6, 0.5); fx.ring(p.x, p.z, 5, 0xffffff, 0.4, 0.3); A.sfx('freeze'); this.eng.addShake(0.3);
        for (let k = 0; k < 40; k++) { const ang = rr(0, TAU), d = rr(1, 7); fx.p({ x: p.x + Math.cos(ang) * d, y: rr(0.2, 2), z: p.z + Math.sin(ang) * d, vy: rr(1, 3), life: 0.9, size: 0.4, size1: 0, color: 0xbff4ff, type: 2 }); }
        fx.debrisBurst(p.x, 1, p.z, 24, [0xbff4ff, 0xffffff, 0x7fd8ff], 9, 0.2);
        for (const t of this.targetsIn(p.x, p.z, 7.5)) { if (t.isSpawner || t.breakable) { this.hitTarget(t, dmgBase, {}); continue; } this.damageEnemy(t, dmgBase * 0.7, { proc: true, color: 0x9ff0ff, srcX: p.x, srcZ: p.z, kb: 5 }); if (!t.isBoss) t.setStatus('freeze', 2.4); else t.setStatus('slow', 3); }
        break;
      }
      case 'totem': {
        const tx = p.x + p.fwdX * 2, tz = p.z + p.fwdZ * 2;
        const m = new THREE.Group(); const gm = emissiveMat(0x6aff9a, 1.4);
        m.add(part(0.7, 0.5, 0.7, lam(0x4a6a4a), 'b')); const mid = part(0.6, 1.1, 0.6, lam(0x5a8a5a), 'b'); mid.position.y = 0.5; m.add(mid); const top = part(0.5, 0.5, 0.5, gm, 'b'); top.position.y = 1.6; m.add(top);
        m.position.set(tx, 0, tz); this.scene.add(m);
        this.effects.push({ type: 'totem', t: 0, dur: 9, x: tx, z: tz, mesh: m, tick: 0, top });
        fx.ring(tx, tz, 5, 0x6aff9a, 0.8, 0.5); A.sfx('heal'); fx.burst(tx, 1, tz, 20, { color: 0x6aff9a, size: 0.4, speed: 4, life: 0.8, type: 2, lift: 2 });
        break;
      }
      case 'meteor': {
        let best = null, bn = -1; for (const e of this.enemies) { if (e.dead || e.hidden || Math.hypot(e.x - p.x, e.z - p.z) > 16) continue; let n = 0; for (const o of this.enemies) if (!o.dead && Math.hypot(o.x - e.x, o.z - e.z) < 4.5) n++; if (n > bn) { bn = n; best = e; } }
        const cx = best ? best.x : p.x + p.fwdX * 7, cz = best ? best.z : p.z + p.fwdZ * 7;
        for (let k = 0; k < 7; k++) { const a = rr(0, TAU), d = k === 0 ? 0 : rr(1.5, 5); const mx = cx + Math.cos(a) * d, mz = cz + Math.sin(a) * d; setTimeout(() => { if (this.mode === 'boot') return; fx.telegraph(mx, mz, 2.6, 0.8, { color: 0xff7030, cb: () => { this.explosion(mx, mz, 2.7, dmgBase * 1.5, { noPlayerHurt: true, hurtEnemies: 1, color: 0xff6a30, shake: 0.35, src: null }); } }); const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7030).multiplyScalar(1.7) })); this.scene.add(m); this.effects.push({ type: 'meteor', mesh: m, t: 0, dur: 0.8, x: mx, z: mz, col: 0xff7030 }); A.sfx('meteor', 0.7); }, k * 170); }
        break;
      }
      case 'whirl': p.whirlT = 2.4; p.whirlDmg = dmgBase * 0.5; p.invuln = Math.max(p.invuln, 0.4); A.sfx('whirl'); fx.ring(p.x, p.z, 3.6, 0xd0e0ff, 0.4, 0.5); break;
    }
  }
  updateEffects(dt) {
    const p = this.player, fx = this.fx;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]; e.t += dt;
      if (e.type === 'flame') {
        const ang = Math.atan2(p.fwdZ, p.fwdX); p.state === 'cast' && (p.castT = 0.3);
        for (let k = 0; k < 9; k++) { const sp = rr(-0.5, 0.5), d = rr(5, 11); fx.p({ x: p.x + p.fwdX * 0.9, y: 1.1, z: p.z + p.fwdZ * 0.9, vx: Math.cos(ang + sp * 0.8) * d, vy: rr(-0.5, 1), vz: Math.sin(ang + sp * 0.8) * d, life: rr(0.35, 0.6), size: 0.7, size1: 2.0, color: 0xffe070, color1: 0xff3000, alpha: 0.9, drag: 1.2 }); }
        if (Math.random() < 0.4) fx.p({ x: p.x + p.fwdX * rr(2, 7), y: rr(0.5, 1.5), z: p.z + p.fwdZ * rr(2, 7), vy: 2, life: 1, size: 1.2, size1: 2.4, color: 0x333333, alpha: 0.3, add: false, type: 0 });
        e.tick -= dt; if (e.tick <= 0) {
          e.tick = 0.14; fx.flashLight(p.x + p.fwdX * 3, 1.5, p.z + p.fwdZ * 3, 0xff8030, 7, 0.2);
          for (const t of this.targetsIn(p.x, p.z, 8)) { const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz); const da = Math.abs(angleDiff(p.face, Math.atan2(dx, dz))); if (d < 8 && da < 0.62) { if (t.isSpawner || t.breakable) this.hitTarget(t, e.dmg, {}); else { this.damageEnemy(t, e.dmg, { proc: true, color: 0xff8030, srcX: p.x, srcZ: p.z, kb: 1.5 }); t.setStatus('burn', 3, e.dmg * 1.2); } } }
        }
        if (e.t > e.dur) this.effects.splice(i, 1);
      } else if (e.type === 'totem') {
        e.top.rotation.y += dt * 3; e.top.position.y = 1.6 + Math.sin(e.t * 4) * 0.1; e.tick -= dt;
        if (Math.random() < dt * 20) fx.p({ x: e.x + rr(-2.5, 2.5), y: 0.2, z: e.z + rr(-2.5, 2.5), vy: rr(1, 2.5), life: 0.8, size: 0.25, size1: 0, color: 0x6aff9a, type: 2 });
        if (e.tick <= 0) { e.tick = 0.5; fx.ring(e.x, e.z, 5, 0x6aff9a, 0.7, 4.5, 0.15, 0.4); if (Math.hypot(p.x - e.x, p.z - e.z) < 5.2 && !p.dead) { p.heal(p.maxHp * 0.03); p.buffT = 1.2; } }
        if (e.t > e.dur) { fx.burst(e.x, 1, e.z, 14, { color: 0x6aff9a, size: 0.4, speed: 4, life: 0.6, type: 2 }); this.scene.remove(e.mesh); this.effects.splice(i, 1); }
      } else if (e.type === 'meteor') {
        const k = clamp(e.t / e.dur, 0, 1); e.mesh.position.set(e.x + (1 - k) * 8, 1 + (1 - k) * (1 - k) * 22, e.z + (1 - k) * 4); e.mesh.rotation.x += dt * 8; e.mesh.rotation.y += dt * 6;
        fx.p({ x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z, life: 0.4, size: 1.2, size1: 0, color: e.col, alpha: 0.8 }); fx.p({ x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z, vy: 1, life: 0.6, size: 1.4, size1: 2.2, color: 0x442211, alpha: 0.3, add: false });
        if (k >= 1) { this.scene.remove(e.mesh); this.effects.splice(i, 1); }
      }
    }
  }
}
