import * as THREE from 'three';
import { clamp, lerp, damp, rr, ri, pick, TAU, angleDiff, lerpAngle, easeOut } from './util.js';
import { FX } from './textures.js';
import {
  makeHero, applyLook, makeWeaponMesh, makeZombie, makeSkeleton, makeKeg, makeSpider, makeSlime, makeWraith, makeCinder,
  makeMarauder, makeHexer, makeGolem, makeBoss, shadowBlob, part, lam, emissiveMat, boxGeo,
} from './voxel.js';
import { WEAPONS, ENCH, ENEMIES, BOSSES, enemyPalette, itemDamage, itemRate, itemCrit, armorStats, powerMult, RARITY } from './data.js';

const tmp = { x: 0, z: 0 };
const _v3 = new THREE.Vector3(), _v3b = new THREE.Vector3();

// ============================================================ base actor
export class Actor {
  constructor() {
    this.x = 0; this.z = 0; this.y = 0; this.vx = 0; this.vz = 0; this.hp = 1; this.maxHp = 1; this.r = 0.5; this.face = 0;
    this.dead = false; this.flashT = 0; this.status = {}; this.root = new THREE.Group(); this.t = 0; this.stunT = 0;
  }
  moveBy(g, dx, dz) {
    this.x += dx; this.z += dz; tmp.x = this.x; tmp.z = this.z;
    g.level.resolve(tmp, this.r); this.x = tmp.x; this.z = tmp.z;
  }
  get fwdX() { return Math.sin(this.face); }
  get fwdZ() { return Math.cos(this.face); }
  setStatus(type, dur, power = 0) {
    const s = this.status[type];
    if (!s) this.status[type] = { t: dur, power, tick: 0.5 };
    else { s.t = Math.max(s.t, dur); s.power = Math.max(s.power, power); }
  }
  updateStatus(g, dt) {
    for (const k in this.status) {
      const s = this.status[k]; s.t -= dt;
      if (s.t <= 0) { delete this.status[k]; continue; }
      if (k === 'burn' || k === 'poison') {
        s.tick -= dt;
        const col = k === 'burn' ? 0xff7a20 : 0x6aff6a;
        if (Math.random() < dt * 14) g.fx.p({ x: this.x + rr(-0.3, 0.3), y: this.y + rr(0.3, 1.6), z: this.z + rr(-0.3, 0.3), vx: 0, vy: rr(0.8, 1.6), vz: 0, life: 0.5, size: 0.35, size1: 0.05, color: col, color1: k === 'burn' ? 0xff2200 : 0x1a8a1a, alpha: 0.9 });
        if (s.tick <= 0) { s.tick = 0.5; this.dotDamage(g, s.power * 0.5, col); }
      }
    }
  }
  get slowF() { return this.status.freeze ? 0 : this.status.slow ? 0.5 : 1; }
}

// ============================================================ player
export class Player extends Actor {
  constructor(g) {
    super();
    this.g = g; this.r = 0.5; this.rig = makeHero(); this.root.add(this.rig.root);
    this.shadow = shadowBlob(1.6, 0.8); this.root.add(this.shadow);
    this.state = 'idle'; this.stateT = 0; this.walkPhase = 0; this.combo = 0; this.comboT = 0; this.atk = null; this.rollT = 0; this.rollCD = 0; this.rollDir = { x: 0, z: 1 };
    this.invuln = 0; this.shootCD = 0; this.potions = 3; this.maxPotions = 3; this.potionCD = 0; this.potionKills = 0; this.healQueue = 0;
    this.artCD = [0, 0, 0]; this.artMax = [1, 1, 1]; this.queuedAttack = 0; this.regenT = 0;
    this.weaponMesh = null; this.bowMesh = null; this.trail = g.fx.createTrail(0xffffff, 16); this.trailOn = false;
    this.stats = {}; this.totem = null; this.whirlT = 0; this.castT = 0; this.lungeV = 0;
    this.footT = 0; this.reviveCount = 0; this.buffT = 0; this.dashGhost = 0;
  }
  recalc(save) {
    const L = save.level, e = save.equip, w = e.melee, a = e.armor;
    const as = armorStats(a);
    const perks = a ? a.perks : [];
    const has = (p) => perks.includes(p);
    this.stats = {
      maxHp: Math.round((100 + (L - 1) * 9 + as.hp) * (has('hp') ? 1.12 : 1)), def: as.def,
      dmgMult: (1 + 0.035 * (L - 1)) * (has('dmg') ? 1.1 : 1), speed: 6.6 * (has('speed') ? 1.08 : 1), rollMult: has('roll') ? 1.25 : 1,
      cdMult: has('cd') ? 0.82 : 1, thorns: has('thorns') ? 0.4 : 0, regen: has('regen') ? 0.012 : 0, potion: has('potion') ? 1.4 : 1, luck: has('luck') ? 0.3 : 0,
    };
    const ratio = this.maxHp > 1 ? this.hp / this.maxHp : 1;
    this.maxHp = this.stats.maxHp; this.hp = clamp(Math.round(this.maxHp * ratio), 1, this.maxHp);
    applyLook(this.rig, a ? a.look : 'cloth');
    this.setWeapon(w);
    this.ranged = e.ranged; this.melee = w;
    if (this.bowMesh) { this.rig.handL.remove(this.bowMesh); this.bowMesh = null; }
    if (this.ranged && this.ranged.type) {
      this.bowMesh = makeWeaponMesh(this.ranged); this.setEnv(this.bowMesh);
      this.bowMesh.visible = false; this.rig.handL.add(this.bowMesh);
      if (this.ranged.type === 'bow') { this.bowMesh.rotation.set(Math.PI / 2, 0, 0); } else { this.bowMesh.rotation.set(Math.PI / 2, 0, 0); }
    }
    this.artifacts = e.art;
    this.trail.color.set(w && w.enchants && w.enchants[0] ? ENCH[w.enchants[0]].color : 0xcfe8ff);
  }
  setEnv(m) { m.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMap = this.g.eng.envMap; }); }
  setWeapon(w) {
    if (this.weaponMesh) { this.rig.handR.remove(this.weaponMesh); this.weaponMesh = null; }
    if (!w) return;
    this.weaponMesh = makeWeaponMesh(w); this.setEnv(this.weaponMesh); this.rig.handR.add(this.weaponMesh);
    this.weaponMesh.rotation.x = Math.PI / 2 * 0.62; this.weaponBase = this.weaponMesh.rotation.x;
    if (w.type === 'bow' || w.type === 'crossbow') this.weaponMesh.rotation.x = Math.PI / 2;
  }
  get weaponLen() { return this.weaponMesh ? this.weaponMesh.userData.length : 1.2; }

  dotDamage(g, d) { if (this.dead || this.state === 'dead') return; this.hp -= d; this.flashT = 0.05; g.fx.number(this.x, 2.2, this.z, String(Math.round(d)), 'hurt'); if (this.hp <= 0) this.die(); }

  nearestEnemy(range, maxAng, dirx, dirz) {
    let best = null, bd = range * range;
    for (const e of this.g.enemies) {
      if (e.dead || e.hidden) continue;
      const dx = e.x - this.x, dz = e.z - this.z, d2 = dx * dx + dz * dz;
      if (d2 > bd) continue;
      if (maxAng < 3 && d2 > 1) { const a = Math.abs(angleDiff(Math.atan2(dirx, dirz), Math.atan2(dx, dz))); if (a > maxAng) continue; }
      bd = d2; best = e;
    }
    // also spawners / breakables count as aim targets within short range
    return best;
  }

  update(dt) {
    const g = this.g, inp = g.input, S = this.stats;
    this.t += dt; this.stateT += dt; this.flashT = Math.max(0, this.flashT - dt); this.invuln = Math.max(0, this.invuln - dt);
    this.rollCD = Math.max(0, this.rollCD - dt); this.shootCD = Math.max(0, this.shootCD - dt); this.comboT = Math.max(0, this.comboT - dt);
    this.potionCD = Math.max(0, this.potionCD - dt); this.castT = Math.max(0, this.castT - dt); this.buffT = Math.max(0, this.buffT - dt);
    for (let i = 0; i < 3; i++) this.artCD[i] = Math.max(0, this.artCD[i] - dt);
    this.updateStatus(g, dt);
    if (this.state === 'dead') { this.animDead(dt); return; }
    // regen / potion heal over time
    if (S.regen) { this.regenT += dt; if (this.regenT > 1) { this.regenT = 0; this.heal(this.maxHp * S.regen, true); } }
    if (this.healQueue > 0) { const h = Math.min(this.healQueue, this.maxHp * 0.5 * dt); this.healQueue -= h; this.hp = Math.min(this.maxHp, this.hp + h); if (Math.random() < dt * 20) g.fx.p({ x: this.x + rr(-0.4, 0.4), y: 0.2, z: this.z + rr(-0.4, 0.4), vy: 2, life: 0.7, size: 0.3, size1: 0.05, color: 0x6aff8a, type: 2 }); }
    // movement input -> world
    let mx = inp.mx, mz = inp.mz; const mag = Math.hypot(mx, mz);
    let wx = 0, wz = 0;
    if (mag > 0.05) {
      g.eng.screenUp(_v3); const ux = _v3.x, uz = _v3.z; const rx = -uz, rz = ux; // right vector (screen-right on ground)
      wx = ux * (-mz) + rx * mx; wz = uz * (-mz) + rz * mx; const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
      this.moveDir = { x: wx, z: wz, m: Math.min(1, mag) };
    } else this.moveDir = null;
    const slow = this.slowF;
    // buffered inputs
    if (inp.attackPressed) this.queuedAttack = 0.28;
    this.queuedAttack = Math.max(0, this.queuedAttack - dt);

    if (this.state === 'roll') {
      this.rollT += dt; const k = this.rollT / this.rollDur;
      const sp = this.rollSpeed * (1 - k * 0.55);
      this.moveBy(g, this.rollDir.x * sp * dt, this.rollDir.z * sp * dt);
      this.face = lerpAngle(this.face, Math.atan2(this.rollDir.x, this.rollDir.z), 0.4);
      if (Math.random() < 0.7) g.fx.p({ x: this.x, y: 0.15, z: this.z, vx: rr(-0.5, 0.5), vy: rr(0.2, 0.8), vz: rr(-0.5, 0.5), life: 0.45, size: 0.7, size1: 1.4, color: 0xc8c0b0, alpha: 0.35, add: false });
      if (k >= 1) { this.state = 'idle'; this.stateT = 0; }
      this.animRoll(k);
    } else {
      // actions
      if (inp.rollPressed && this.rollCD <= 0 && this.state !== 'cast') this.startRoll(wx, wz);
      else if (inp.potionPressed) this.usePotion();
      for (let i = 0; i < 3; i++) if (inp.art[i]) g.castArtifact(i);
      if (this.state === 'idle' || this.state === 'run') {
        if (this.queuedAttack > 0 && this.melee) this.startAttack(wx, wz);
        else if (inp.shoot && this.shootCD <= 0 && this.ranged && this.ranged.type) this.fireRanged(wx, wz);
      }
      // locomotion
      let speed = S.speed * slow * (this.buffT > 0 ? 1.18 : 1);
      if (this.state === 'attack') speed *= 0.35; if (this.state === 'cast') speed *= 0.4; if (inp.shoot && this.state !== 'attack') speed *= 0.72;
      if (this.whirlT > 0) speed *= 1.4;
      if (this.moveDir && this.state !== 'dead') {
        const m = this.moveDir.m;
        this.moveBy(g, wx * speed * m * dt, wz * speed * m * dt);
        this.walkPhase += dt * (6 + speed * 1.3);
        if (this.state === 'idle') this.state = 'run';
        if (this.state !== 'attack') { const want = Math.atan2(wx, wz); const aim = inp.shoot && this.aimTarget && !this.aimTarget.dead ? Math.atan2(this.aimTarget.x - this.x, this.aimTarget.z - this.z) : want; this.face = lerpAngle(this.face, aim, 1 - Math.exp(-16 * dt)); }
        this.footT -= dt; if (this.footT <= 0) { this.footT = 0.3; g.audio.sfx('step', 0.6); g.fx.p({ x: this.x, y: 0.08, z: this.z, life: 0.4, size: 0.35, size1: 0.7, color: 0xb0a898, alpha: 0.25, add: false }); }
      } else if (this.state === 'run') this.state = 'idle';
      if (this.state === 'attack') this.updateAttack(dt, wx, wz);
      if (this.state === 'cast' && this.castT <= 0) this.state = 'idle';
      // lunge decay
      if (Math.abs(this.lungeV) > 0.1) { this.moveBy(g, this.fwdX * this.lungeV * dt, this.fwdZ * this.lungeV * dt); this.lungeV *= Math.exp(-9 * dt); }
      if (this.state !== 'attack' && this.state !== 'cast') this.animLocomotion(dt);
    }
    // knockback velocity
    if (Math.abs(this.vx) + Math.abs(this.vz) > 0.05) { this.moveBy(g, this.vx * dt, this.vz * dt); const f = Math.exp(-8 * dt); this.vx *= f; this.vz *= f; }
    // whirl
    if (this.whirlT > 0) this.updateWhirl(dt);
    // trail
    this.updateTrail(dt);
    this.root.position.set(this.x, this.y, this.z);
    this.rig.root.rotation.y = this.face;
    // glow of armour
    if (this.rig.glowColor && Math.random() < dt * 6) g.fx.p({ x: this.x + rr(-0.4, 0.4), y: rr(0.4, 2.0), z: this.z + rr(-0.4, 0.4), vy: 0.6, life: 0.8, size: 0.18, size1: 0, color: this.rig.glowColor, type: 2, alpha: 0.8 });
    // flash
    this.rig.setFlash(this.flashT > 0 ? 0.7 : (this.invuln > 0 && this.state !== 'roll' ? (Math.sin(this.t * 40) > 0 ? 0.35 : 0) : 0));
    // cape
    const mv = this.moveDir ? this.moveDir.m : 0;
    this.rig.cape.rotation.x = damp(this.rig.cape.rotation.x, 0.12 + mv * 0.5 + Math.sin(this.t * 3) * 0.04 + (this.state === 'roll' ? 0.8 : 0), 8, dt);
  }

  // ---------------- rolling
  startRoll(wx, wz) {
    const g = this.g; let dx = wx, dz = wz; if (!this.moveDir) { dx = this.fwdX; dz = this.fwdZ; }
    this.rollDir = { x: dx, z: dz }; this.state = 'roll'; this.rollT = 0; this.rollDur = 0.42 / this.stats.rollMult; this.rollSpeed = 13 * this.stats.rollMult;
    this.rollCD = 0.55; this.invuln = Math.max(this.invuln, this.rollDur * 0.9); this.atk = null; this.trailOn = false; g.audio.sfx('roll');
    g.stat('rolls', 1);
    g.fx.burst(this.x, 0.2, this.z, 6, { color: 0xc0b8a8, size: 0.5, speed: 2, life: 0.4, add: false, alpha: 0.4, type: 0 });
  }
  animRoll(k) {
    const r = this.rig; r.torsoG.rotation.x = k * TAU * 0.95 * (k < 1 ? 1 : 0); r.torsoG.rotation.x = Math.sin(k * Math.PI) * 0.0 + k * 6.28; r.body.position.y = -0.35 * Math.sin(k * Math.PI);
    r.legL.rotation.x = r.legR.rotation.x = -1.2; r.armL.rotation.x = r.armR.rotation.x = -2.2;
  }

  // ---------------- melee
  startAttack(wx, wz) {
    const g = this.g, w = this.melee, b = WEAPONS[w.type];
    const rate = itemRate(w);
    const dur = 1 / rate * (this.buffT > 0 ? 0.85 : 1);
    this.combo = this.comboT > 0 ? (this.combo + 1) % b.combo : 0;
    this.comboT = dur + 0.55; this.queuedAttack = 0;
    // auto aim
    const dx = this.moveDir ? wx : this.fwdX, dz = this.moveDir ? wz : this.fwdZ;
    const tgt = this.nearestEnemy(Math.max(5.5, b.range + 2.5), 1.6, dx, dz);
    let ang = Math.atan2(dx, dz);
    if (tgt) ang = Math.atan2(tgt.x - this.x, tgt.z - this.z);
    this.face = ang;
    const last = this.combo === b.combo - 1 && b.combo > 1;
    this.atk = { t: 0, dur, hitAt: dur * (w.type === 'hammer' ? 0.5 : w.type === 'spear' ? 0.3 : 0.32), hit: false, step: this.combo, last, mult: last ? 1.45 : 1, dir: this.combo % 2 === 0 ? 1 : -1 };
    this.state = 'attack'; this.stateT = 0;
    this.lungeV = w.type === 'hammer' ? 2 : (w.type === 'spear' ? 7 : 5.5) * (tgt && Math.hypot(tgt.x - this.x, tgt.z - this.z) < 1.8 ? 0.3 : 1);
    g.audio.sfx(last || w.type === 'hammer' || w.type === 'axe' ? 'swing2' : 'swing');
    this.trailOn = false;
  }
  updateAttack(dt, wx, wz) {
    const a = this.atk; if (!a) { this.state = 'idle'; return; }
    a.t += dt; const p = a.t / a.dur; const g = this.g, w = this.melee, b = WEAPONS[w.type];
    // trail only during strike phase
    this.trailOn = p > a.hitAt / a.dur - 0.12 && p < 0.75;
    if (!a.hit && a.t >= a.hitAt) { a.hit = true; this.meleeStrike(a); }
    // allow chaining
    if (p > 0.62 && this.queuedAttack > 0) { this.state = 'idle'; this.startAttack(wx, wz); return; }
    if (p >= 1) { this.state = 'idle'; this.atk = null; this.trailOn = false; return; }
    this.animAttack(p, a, w.type);
  }
  meleeStrike(a) {
    const g = this.g, w = this.melee, b = WEAPONS[w.type];
    const crit = itemCrit(w);
    const fx = this.fwdX, fz = this.fwdZ, range = b.range + (a.last ? 0.5 : 0) + 0.3;
    const baseDmg = itemDamage(w) * this.stats.dmgMult * a.mult;
    let hits = 0; const col = w.enchants[0] ? ENCH[w.enchants[0]].color : 0xffffff;
    const targets = g.targetsIn(this.x, this.z, range + 1.5);
    const ang = Math.atan2(fz, fx); // direction (cos,sin) form
    for (const e of targets) {
      const dx = e.x - this.x, dz = e.z - this.z; const d = Math.hypot(dx, dz) - (e.r || 0.5);
      if (b.arc < 6) {
        if (w.type === 'spear') {
          const along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
          if (along < -0.3 || along > range + (e.r || 0.5) || side > 0.9 + (e.r || 0.5)) continue;
        } else {
          if (d > range) continue;
          const da = Math.abs(angleDiff(this.face, Math.atan2(dx, dz)));
          if (da > b.arc / 2 + (d < 1 ? 1.5 : 0.1)) continue;
        }
      } else if (d > range + 0.8) continue;
      const isCrit = Math.random() < crit;
      g.hitTarget(e, baseDmg * (isCrit ? 1.75 : 1) * rr(0.92, 1.08), { crit: isCrit, kb: b.kb * (a.last ? 1.4 : 1), srcX: this.x, srcZ: this.z, weapon: w, melee: true, heavy: a.last || w.type === 'hammer' });
      hits++;
    }
    // visuals
    const flip = a.dir;
    if (w.type === 'hammer') {
      const px = this.x + fx * 2.3, pz = this.z + fz * 2.3;
      g.fx.ring(px, pz, 4.2, col, 0.45, 0.5, 0.2); g.fx.debrisBurst(px, 0.2, pz, 16, [g.biomeColor(), 0x8a8a8a], 7, 0.25); g.fx.burst(px, 0.4, pz, 14, { color: col, size: 0.5, speed: 6, life: 0.4, add: true });
      g.eng.addShake(0.45); g.audio.sfx('slam'); g.hitstop(0.06);
    } else if (w.type === 'spear') {
      g.fx.slash(this.x + fx * 0.5, 1.0, this.z + fz * 0.5, Math.atan2(fz, fx), range * 1.1, col, 0.18, 0.4);
    } else {
      g.fx.slash(this.x + fx * 0.3, 1.1, this.z + fz * 0.3, Math.atan2(fz, fx) - (0.0), range * (a.last ? 1.5 : 1.15), col, a.last ? 0.3 : 0.22, flip);
      if (a.last) g.fx.slash(this.x + fx * 0.3, 1.2, this.z + fz * 0.3, Math.atan2(fz, fx), range * 1.2, 0xffffff, 0.2, -flip);
    }
    if (hits) { g.eng.addShake(a.last ? 0.3 : 0.14); g.hitstop(a.last ? 0.07 : 0.035); if (g.settings.vibrate && a.last) g.vibrate(12); }
  }
  animAttack(p, a, type) {
    const r = this.rig; const w = this.weaponMesh; const dir = a.dir;
    const sm = (x) => x * x * (3 - 2 * x);
    const windEnd = a.hitAt / a.dur;
    let armX, armZ = 0, twist = 0, lean = 0, wx = this.weaponBase || 0.9;
    if (type === 'hammer') {
      const k = p < windEnd ? sm(p / windEnd) : 1; armX = p < windEnd ? lerp(-0.4, -3.1, k) : lerp(-3.1, 0.2, sm(clamp((p - windEnd) / 0.18, 0, 1)));
      lean = p < windEnd ? -0.25 * k : 0.35 * clamp(1 - (p - windEnd) / 0.5, 0, 1); r.armL.rotation.x = armX;
    } else if (type === 'spear') {
      const k = p < windEnd ? sm(p / windEnd) : 1;
      armX = p < windEnd ? lerp(-1.2, -0.7, k) : lerp(-1.55, -1.5, sm(clamp((p - windEnd) / 0.2, 0, 1)));
      lean = p < windEnd ? -0.15 * k : 0.2 * clamp(1 - (p - windEnd) / 0.4, 0, 1); wx = 1.55;
      r.armR.position.z = p < windEnd ? -0.1 * k : 0.55 * clamp(1 - (p - windEnd) / 0.45, 0, 1); r.armL.rotation.x = -1.1;
    } else if (a.step % 2 === 0) { // overhead diagonal
      const k = p < windEnd ? sm(p / windEnd) : 1;
      armX = p < windEnd ? lerp(-0.3, -2.7, k) : lerp(-2.7, 0.7, sm(clamp((p - windEnd) / 0.22, 0, 1)));
      armZ = (p < windEnd ? lerp(0, -0.5 * dir, k) : lerp(-0.5 * dir, 0.4 * dir, sm(clamp((p - windEnd) / 0.22, 0, 1))));
      twist = (p < windEnd ? lerp(0, -0.5 * dir, k) : lerp(-0.5 * dir, 0.6 * dir, sm(clamp((p - windEnd) / 0.22, 0, 1))));
    } else { // horizontal sweep
      const k = p < windEnd ? sm(p / windEnd) : 1; armX = -1.55; wx = 1.45;
      twist = p < windEnd ? lerp(0, -1.1 * dir, k) : lerp(-1.1 * dir, 1.2 * dir, sm(clamp((p - windEnd) / 0.2, 0, 1)));
      armZ = 0.2 * dir;
    }
    if (p > 0.6 && type !== 'spear') { const q = (p - 0.6) / 0.4; armX = lerp(armX, 0, q * 0.5); twist *= 1 - q; armZ *= 1 - q; }
    r.armR.rotation.x = armX; r.armR.rotation.z = armZ; r.torsoG.rotation.y = twist; r.torsoG.rotation.x = lean;
    if (type !== 'hammer' && type !== 'spear') r.armL.rotation.x = -0.4 * (1 - p) - 0.2;
    if (w) w.rotation.x = wx;
    // legs plant
    r.legL.rotation.x = 0.4; r.legR.rotation.x = -0.4; r.body.position.y = 0;
  }
  updateTrail(dt) {
    const w = this.weaponMesh; const g = this.g;
    if (this.trailOn && w) {
      w.updateWorldMatrix(true, false);
      const L = this.weaponLen;
      _v3.set(0, L * 0.98, 0).applyMatrix4(w.matrixWorld); _v3b.set(0, L * 0.35, 0).applyMatrix4(w.matrixWorld);
      g.fx.trailPush(this.trail, _v3b, _v3);
      if (Math.random() < 0.5 && this.melee.enchants[0]) g.fx.p({ x: _v3.x, y: _v3.y, z: _v3.z, vx: rr(-0.8, 0.8), vy: rr(0, 1), vz: rr(-0.8, 0.8), life: 0.4, size: 0.22, size1: 0, color: ENCH[this.melee.enchants[0]].color, type: 2 });
    }
  }
  animLocomotion(dt) {
    const r = this.rig; const mv = this.moveDir ? this.moveDir.m : 0; const ph = this.walkPhase;
    const sw = Math.sin(ph) * 0.9 * mv;
    r.legL.rotation.x = damp(r.legL.rotation.x, sw, 20, dt); r.legR.rotation.x = damp(r.legR.rotation.x, -sw, 20, dt);
    const shooting = this.g.input.shoot && this.ranged && this.ranged.type;
    r.torsoG.rotation.y = damp(r.torsoG.rotation.y, shooting ? -0.4 : 0, 14, dt); r.torsoG.rotation.x = damp(r.torsoG.rotation.x, mv * 0.12, 10, dt);
    r.armR.position.z = 0;
    const idle = Math.sin(this.t * 2) * 0.04;
    if (this.state === 'shoot' || shooting) {
      r.armL.rotation.x = damp(r.armL.rotation.x, -1.55, 25, dt); r.armL.rotation.z = damp(r.armL.rotation.z, 0, 20, dt);
      r.armR.rotation.x = damp(r.armR.rotation.x, -1.3 + this.drawBack * 0.0, 25, dt);
      if (this.weaponMesh) this.weaponMesh.visible = false; if (this.bowMesh) this.bowMesh.visible = true;
    } else {
      r.armL.rotation.x = damp(r.armL.rotation.x, -sw * 0.8 + idle, 20, dt); r.armL.rotation.z = damp(r.armL.rotation.z, 0, 20, dt);
      r.armR.rotation.x = damp(r.armR.rotation.x, sw * 0.8 + idle - 0.15, 20, dt); r.armR.rotation.z = damp(r.armR.rotation.z, 0, 20, dt);
      if (this.weaponMesh) { this.weaponMesh.visible = true; this.weaponMesh.rotation.x = damp(this.weaponMesh.rotation.x, (this.weaponBase || 0.9), 15, dt); }
      if (this.bowMesh) this.bowMesh.visible = false;
    }
    r.body.position.y = damp(r.body.position.y, Math.abs(Math.sin(ph)) * 0.07 * mv, 20, dt);
    r.head.rotation.x = Math.sin(this.t * 1.5) * 0.02;
  }
  animDead(dt) {
    const r = this.rig; this.deadT = (this.deadT || 0) + dt; const k = Math.min(1, this.deadT / 0.5);
    r.root.rotation.x = -k * 1.5; r.root.position.y = 0; r.body.position.y = 0.2 * k;
    this.root.position.set(this.x, this.y, this.z);
  }
  drawBack = 0;

  // ---------------- ranged
  fireRanged(wx, wz) {
    const g = this.g, w = this.ranged, b = WEAPONS[w.type];
    const dx = this.moveDir ? wx : this.fwdX, dz = this.moveDir ? wz : this.fwdZ;
    const tgt = this.nearestEnemy(b.range, 1.2, dx, dz); this.aimTarget = tgt;
    let ang = Math.atan2(dx, dz);
    if (tgt) { const lead = 0.0; ang = Math.atan2(tgt.x - this.x, tgt.z - this.z); }
    this.face = ang; this.state = 'idle';
    const rate = itemRate(w); this.shootCD = 1 / rate;
    const fx = Math.sin(ang), fz = Math.cos(ang);
    const col = w.enchants[0] ? ENCH[w.enchants[0]].color : 0xffe9b0;
    const isCross = w.type === 'crossbow';
    const dmg = itemDamage(w) * this.stats.dmgMult;
    g.spawnProjectile({ team: 'player', x: this.x + fx * 0.8, z: this.z + fz * 0.8, y: 1.3, dx: fx, dz: fz, speed: b.speed, dmg, r: isCross ? 0.35 : 0.28, life: b.range / b.speed, pierce: b.pierce, kind: isCross ? 'bolt' : 'arrow', color: col, weapon: w, kb: b.kb, crit: itemCrit(w), trail: true });
    g.audio.sfx(isCross ? 'bolt' : 'shoot');
    g.fx.burst(this.x + fx, 1.3, this.z + fz, 4, { color: col, size: 0.25, speed: 3, life: 0.2, type: 2 });
    g.fx.slash(this.x + fx * 0.5, 1.0, this.z + fz * 0.5, Math.atan2(fz, fx), 1.6, col, 0.12, 0.3);
    this.recoil = 0.12;
    this.state = 'idle';
  }

  // ---------------- potion & damage
  usePotion() {
    if (this.potions <= 0 || this.potionCD > 0 || this.hp >= this.maxHp) { if (this.potions <= 0) this.g.audio.sfx('deny'); return; }
    this.potions--; this.potionCD = 1.0; this.healQueue += this.maxHp * 0.45 * this.stats.potion;
    this.g.audio.sfx('heal'); this.g.fx.ring(this.x, this.z, 2.2, 0x6aff9a, 0.6, 0.3); this.g.fx.burst(this.x, 1, this.z, 14, { color: 0x6aff9a, size: 0.3, speed: 2.5, life: 0.8, type: 2, lift: 2 });
  }
  heal(n, silent) {
    const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + n);
    if (!silent && this.hp > before) this.g.fx.number(this.x, 2.4, this.z, '+' + Math.round(this.hp - before), 'heal');
  }
  onHurt(dmg, srcX, srcZ, kbForce = 4) {
    const g = this.g;
    this.hp -= dmg; this.flashT = 0.15; this.invuln = 0.55; g.eng.hurt = Math.min(1, 0.4 + dmg / this.maxHp * 2);
    g.eng.addShake(clamp(dmg / this.maxHp * 2.5, 0.2, 0.7));
    const dx = this.x - srcX, dz = this.z - srcZ, l = Math.hypot(dx, dz) || 1; this.vx += dx / l * kbForce; this.vz += dz / l * kbForce;
    g.audio.sfx('hurt'); g.fx.number(this.x, 2.4, this.z, String(Math.round(dmg)), 'hurt');
    g.fx.burst(this.x, 1.2, this.z, 10, { color: 0xff3030, size: 0.3, speed: 4, life: 0.4, grav: 6, type: 1 });
    g.fx.debrisBurst(this.x, 1.2, this.z, 5, [0xcc2222, 0x992222], 4, 0.12);
    if (g.settings.vibrate) g.vibrate(40);
    if (this.hp <= 0) this.die();
    this.atk = null; if (this.state === 'attack') { this.state = 'idle'; this.trailOn = false; }
  }
  die() { this.hp = 0; this.state = 'dead'; this.deadT = 0; this.dead = true; this.g.audio.sfx('die'); this.g.onPlayerDeath(); }
  revive() { this.dead = false; this.state = 'idle'; this.hp = this.maxHp * 0.6; this.invuln = 2.5; this.rig.root.rotation.x = 0; this.rig.body.position.y = 0; this.g.fx.ring(this.x, this.z, 6, 0xffe9a0, 0.8); this.g.audio.sfx('heal'); }
  updateWhirl(dt) {
    this.whirlT -= dt; this.rig.torsoG.rotation.y += dt * 22; this.rig.armR.rotation.x = -1.5; this.rig.armL.rotation.x = -1.5;
    this.whirlTick = (this.whirlTick || 0) - dt;
    if (this.whirlTick <= 0) { this.whirlTick = 0.18; this.g.aoeDamage(this.x, this.z, 3.6, (this.whirlDmg || 20), { kb: 5, color: 0xd0e0ff, srcX: this.x, srcZ: this.z }); this.g.fx.ring(this.x, this.z, 3.6, 0xd0e0ff, 0.25, 1.5, 1.0, 0.6); this.g.audio.sfx('whirl', 0.5); }
    if (this.whirlT <= 0) this.rig.torsoG.rotation.y = 0;
    this.trailOn = true;
    // spinning trail from weapon
  }
}

// ============================================================ enemies
const MODEL_FN = { zombie: makeZombie, skeleton: makeSkeleton, keg: makeKeg, spider: makeSpider, slime: makeSlime, marauder: makeMarauder, hexer: makeHexer, wraith: makeWraith, cinder: makeCinder, golem: makeGolem };

export class Enemy extends Actor {
  constructor(g, id, x, z, o = {}) {
    super();
    this.g = g; this.id = id; this.def = o.boss ? BOSSES[id] : ENEMIES[id]; const D = this.def; this.isBoss = !!o.boss;
    this.x = x; this.z = z; this.spawnX = x; this.spawnZ = z; this.room = o.room === undefined ? -1 : o.room;
    this.level = o.level || 1; this.elite = !!o.elite || D.elite || false; this.carrier = !!o.carrier; this.size = o.size || 2;
    const biome = g.biomeId;
    const lm = 1 + (o.boss ? 0.2 : 0.16) * (this.level - 1), dm = 1 + 0.115 * (this.level - 1);
    const tm = g.threat ? g.threat.hp : 1;
    this.maxHp = D.hp * lm * tm * (o.elite && !D.elite ? 2.2 : 1) * (id === 'slime' ? [0, 0.35, 0.65, 1][this.size] / 1 * 1.0 : 1);
    if (id === 'slime') this.maxHp = D.hp * lm * tm * [0, 0.3, 0.6, 1][this.size];
    this.hp = this.maxHp; this.dmg = D.dmg * dm; this.speed = D.speed * (o.elite && !D.elite ? 1.05 : 1) * (this.isBoss ? 1 : rr(0.92, 1.08));
    this.r = D.radius * (id === 'slime' ? [0, 0.6, 0.8, 1][this.size] : 1) * (o.elite && !D.elite ? 1.2 : 1);
    this.flying = !!D.flying; this.baseY = this.flying ? 1.1 : 0;
    this.state = 'idle'; this.stateT = 0; this.cdT = rr(0.3, 1.5); this.aggro = false; this.walkPhase = Math.random() * 6; this.hidden = false;
    this.face = rr(0, TAU); this.wanderT = rr(0, 3); this.wanderDir = { x: 0, z: 0 };
    this.poise = D.poise || 0; this.flow = { x: 0, z: 0 };
    this.xp = D.xp * (1 + 0.25 * (this.level - 1)); this.hurtMul = 1;
    // model
    if (this.isBoss) this.rig = makeBoss(id);
    else {
      const pal = enemyPalette(id, biome);
      const fn = MODEL_FN[D.model]; this.rig = fn(Object.assign({ scale: D.scale }, pal));
    }
    const sc = this.isBoss ? 1 : (id === 'slime' ? [0, 0.7, 1.0, 1.45][this.size] : (o.elite && !D.elite ? 1.28 : 1));
    this.rig.root.scale.multiplyScalar(sc); this.baseScale = this.rig.root.scale.x;
    this.root.add(this.rig.root);
    this.shadow = shadowBlob(this.r * 2.6, 0.75); this.root.add(this.shadow);
    const cs = this.isBoss || this.elite; this.rig.root.traverse((m) => { if (m.isMesh) m.castShadow = cs; });
    this.root.position.set(x, 0, z);
    if (this.elite || this.carrier) this.auraT = 0;
    if (this.carrier) { const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffd23a })); b.position.y = 3.4; this.root.add(b); this.marker = b; }
    this.pat = null; this.patIdx = 0; this.phase = 0; this.introDone = !this.isBoss; this.enraged = false;
    this.hitStagger = 0; this.alertT = 0; this.knock = { x: 0, z: 0 };
  }
  dotDamage(g, d, col) { this.g.damageEnemy(this, d, { dot: true, color: col }); }

  // helpers
  dist() { return Math.hypot(this.g.player.x - this.x, this.g.player.z - this.z); }
  dirToPlayer() { const p = this.g.player; const dx = p.x - this.x, dz = p.z - this.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l, d: l }; }
  turnTo(x, z, rate, dt) { this.face = lerpAngle(this.face, Math.atan2(x - this.x, z - this.z), 1 - Math.exp(-rate * dt)); }
  seek(dx, dz, speed, dt) { // move in direction, wall-aware
    this.moveBy(this.g, dx * speed * dt, dz * speed * dt);
  }
  chase(dt, speed, stopDist = 0) {
    const g = this.g, p = g.player; const d = this.dirToPlayer();
    if (d.d <= stopDist) return d;
    let dx = d.x, dz = d.z;
    const los = g.level.los(this.x, this.z, p.x, p.z);
    if (!los || this.flying === false && g.level.solidCell(g.level.cx(this.x + d.x * 1.2), g.level.cx(this.z + d.z * 1.2))) {
      if (g.level.flowDir(this.x, this.z, this.flow)) { dx = this.flow.x; dz = this.flow.z; }
    }
    this.seek(dx, dz, speed * this.slowF, dt);
    this.turnTo(this.x + dx, this.z + dz, 10, dt);
    this.walkPhase += dt * speed * 2.4;
    return d;
  }
  separate(dt) {
    const es = this.g.enemies;
    for (let i = 0; i < es.length; i++) {
      const o = es[i]; if (o === this || o.dead) continue;
      const dx = this.x - o.x, dz = this.z - o.z, rr2 = this.r + o.r; const d2 = dx * dx + dz * dz;
      if (d2 < rr2 * rr2 && d2 > 0.0001) { const d = Math.sqrt(d2), push = (rr2 - d) * 0.5; this.x += dx / d * push * 0.5; this.z += dz / d * push * 0.5; }
    }
  }

  update(dt) {
    const g = this.g, p = g.player; this.t += dt; this.stateT += dt; this.flashT = Math.max(0, this.flashT - dt);
    this.cdT -= dt; this.stunT = Math.max(0, this.stunT - dt);
    if (this.dead) return;
    // distance culling of AI for sleepers
    const dd = this.dist();
    if (this.isBoss && !this.aggro) { this.finishFrame(dt); return; }
    if (!this.aggro) {
      if (g.input && dd < (this.isBoss ? 0 : 11.5) && (dd < 6.5 || g.level.los(this.x, this.z, p.x, p.z)) && !p.dead) this.wake(true);
      else { this.idle(dt); this.finishFrame(dt); return; }
    }
    this.updateStatus(g, dt);
    if (this.status.freeze) { this.finishFrame(dt, true); return; }
    // knockback
    if (Math.abs(this.knock.x) + Math.abs(this.knock.z) > 0.05) { this.moveBy(g, this.knock.x * dt, this.knock.z * dt); const f = Math.exp(-7 * dt); this.knock.x *= f; this.knock.z *= f; }
    if (this.stunT > 0) { this.finishFrame(dt, true); return; }
    if (p.dead && !this.isBoss) { this.idle(dt); this.finishFrame(dt); return; }
    switch (this.def.ai) {
      case 'melee': this.aiMelee(dt); break;
      case 'archer': this.aiArcher(dt); break;
      case 'keg': this.aiKeg(dt); break;
      case 'spider': this.aiSpider(dt); break;
      case 'slime': this.aiSlime(dt); break;
      case 'brute': this.aiBrute(dt); break;
      case 'hexer': this.aiHexer(dt); break;
      case 'floater': this.aiFloater(dt); break;
      default: this.aiBoss(dt);
    }
    this.separate(dt);
    this.finishFrame(dt);
  }
  wake(alert) {
    if (this.aggro) return; this.aggro = true;
    if (alert) for (const o of this.g.enemies) if (!o.aggro && !o.dead && !o.isBoss && Math.hypot(o.x - this.x, o.z - this.z) < 9) o.aggro = true;
  }
  idle(dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) { this.wanderT = rr(1.5, 4); if (Math.random() < 0.6) { const a = rr(0, TAU); this.wanderDir = { x: Math.sin(a), z: Math.cos(a) }; } else this.wanderDir = { x: 0, z: 0 }; }
    if (this.wanderDir.x || this.wanderDir.z) {
      this.seek(this.wanderDir.x, this.wanderDir.z, this.speed * 0.3, dt); this.turnTo(this.x + this.wanderDir.x, this.z + this.wanderDir.z, 5, dt);
      this.walkPhase += dt * this.speed * 1.2;
      if (Math.hypot(this.x - this.spawnX, this.z - this.spawnZ) > 3.5) this.wanderDir = { x: this.spawnX - this.x, z: this.spawnZ - this.z };
    }
  }
  telegraphCone(range, dur) { }

  // ---------------- AIs
  aiMelee(dt) {
    const D = this.def, p = this.g.player;
    if (this.state === 'idle' || this.state === 'chase') {
      const d = this.chase(dt, this.speed, D.range * 0.8); this.state = 'chase';
      if (d.d < D.range && this.cdT <= 0) { this.state = 'windup'; this.stateT = 0; this.turnTo(p.x, p.z, 30, 1); }
    } else if (this.state === 'windup') {
      this.turnTo(p.x, p.z, 8, dt);
      if (this.stateT >= D.windup) {
        this.strikeMelee(D.range + 0.5, 1.4, this.dmg); this.state = 'recover'; this.stateT = 0; this.g.audio.sfx('swing', 0.6);
      }
    } else if (this.state === 'recover') { if (this.stateT > 0.45) { this.state = 'chase'; this.cdT = D.cd * rr(0.8, 1.2); } }
  }
  strikeMelee(range, arc, dmg, kb = 5) {
    const g = this.g, p = g.player; const d = this.dirToPlayer();
    const da = Math.abs(angleDiff(this.face, Math.atan2(d.x, d.z)));
    g.fx.slash(this.x + this.fwdX * 0.5, 1.0, this.z + this.fwdZ * 0.5, Math.atan2(this.fwdZ, this.fwdX), range * 0.9, 0xff8080, 0.18);
    if (d.d < range + p.r && da < arc) g.damagePlayer(dmg, this.x, this.z, { kb, src: this });
  }
  aiArcher(dt) {
    const D = this.def, p = this.g.player, g = this.g;
    const d = this.dirToPlayer(); const los = g.level.los(this.x, this.z, p.x, p.z);
    if (this.state === 'idle' || this.state === 'chase') {
      this.state = 'chase';
      if (d.d < 5.5) { this.seek(-d.x, -d.z, this.speed * 0.9 * this.slowF, dt); this.turnTo(p.x, p.z, 10, dt); this.walkPhase += dt * 7; }
      else if (d.d > 10.5 || !los) { this.chase(dt, this.speed); }
      else { // strafe
        const s = Math.sin(this.t * 0.7 + this.x) > 0 ? 1 : -1; this.seek(-d.z * s, d.x * s, this.speed * 0.5 * this.slowF, dt); this.turnTo(p.x, p.z, 10, dt); this.walkPhase += dt * 4;
      }
      if (los && d.d < D.range && this.cdT <= 0) { this.state = 'windup'; this.stateT = 0; this.g.audio.sfx('telegraph', 0.4); }
    } else if (this.state === 'windup') {
      this.turnTo(p.x, p.z, 12, dt);
      if (this.stateT >= D.windup) {
        const lead = clamp(d.d / 14, 0.1, 0.9) * 0.5;
        const tx = p.x + (p.moveDir ? p.moveDir.x * p.stats.speed * lead : 0), tz = p.z + (p.moveDir ? p.moveDir.z * p.stats.speed * lead : 0);
        const dx = tx - this.x, dz = tz - this.z, l = Math.hypot(dx, dz) || 1;
        g.spawnProjectile({ team: 'enemy', x: this.x + dx / l * 0.7, z: this.z + dz / l * 0.7, y: 1.3, dx: dx / l, dz: dz / l, speed: 15, dmg: this.dmg, r: 0.3, life: 2, kind: 'arrow', color: 0xffe9b0, owner: this, kb: 3 });
        g.audio.sfx('shoot', 0.5); this.state = 'recover'; this.stateT = 0;
      }
    } else if (this.state === 'recover') { if (this.stateT > 0.4) { this.state = 'chase'; this.cdT = D.cd * rr(0.8, 1.3); } }
  }
  aiKeg(dt) {
    const D = this.def, g = this.g;
    if (this.state === 'idle' || this.state === 'chase') {
      const d = this.chase(dt, this.speed, 0.3); this.state = 'chase';
      if (d.d < D.range) { this.state = 'fuse'; this.stateT = 0; g.audio.sfx('telegraph', 0.6); g.fx.telegraph(this.x, this.z, 3.4, D.windup, { color: 0xff6030 }); }
    } else if (this.state === 'fuse') {
      this.turnTo(this.g.player.x, this.g.player.z, 5, dt);
      if (this.stateT >= D.windup) { this.explode(); }
    }
  }
  explode() {
    const g = this.g; if (this.dead) return;
    g.explosion(this.x, this.z, 3.5, this.dmg, { src: this, color: 0xff7a30, hurtEnemies: 0.6 });
    this.hp = 0; this.dead = true; g.onEnemyDeath(this, { silent: true });
  }
  aiSpider(dt) {
    const D = this.def, g = this.g, p = g.player;
    if (this.state === 'idle' || this.state === 'chase') {
      const d = this.chase(dt, this.speed, 1.0); this.state = 'chase';
      if (d.d < D.range && this.cdT <= 0) { this.state = 'windup'; this.stateT = 0; }
      else if (d.d > 3.5 && d.d < 8 && this.cdT <= 0 && this.leapCD <= 0 || (this.leapCD === undefined && d.d > 3.5 && d.d < 8)) { this.leapCD = rr(2.5, 4); this.state = 'crouch'; this.stateT = 0; this.leapTo = { x: p.x, z: p.z }; }
      this.leapCD = (this.leapCD || 0) - dt;
    } else if (this.state === 'crouch') {
      this.turnTo(this.leapTo.x, this.leapTo.z, 20, dt);
      if (this.stateT > 0.4) { this.state = 'leap'; this.stateT = 0; this.leapFrom = { x: this.x, z: this.z }; this.g.audio.sfx('swing', 0.5); }
    } else if (this.state === 'leap') {
      const k = Math.min(1, this.stateT / 0.42); const nx = lerp(this.leapFrom.x, this.leapTo.x, k), nz = lerp(this.leapFrom.z, this.leapTo.z, k);
      this.moveBy(g, nx - this.x, nz - this.z); this.y = Math.sin(k * Math.PI) * 2.0;
      if (k >= 1) { this.y = 0; this.state = 'recover'; this.stateT = 0; this.cdT = 0.8; g.fx.ring(this.x, this.z, 1.6, 0xb0a0c0, 0.3, 0.3); if (this.dist() < 1.5 + p.r) g.damagePlayer(this.dmg, this.x, this.z, { kb: 5, src: this, poison: true }); }
    } else if (this.state === 'windup') {
      this.turnTo(p.x, p.z, 14, dt);
      if (this.stateT >= D.windup) { this.strikeMelee(D.range + 0.4, 1.6, this.dmg, 3); this.state = 'recover'; this.stateT = 0; }
    } else if (this.state === 'recover') { if (this.stateT > 0.4) { this.state = 'chase'; this.cdT = D.cd; } }
  }
  aiSlime(dt) {
    const D = this.def, g = this.g, p = g.player; const d = this.dirToPlayer();
    if (this.state === 'idle' || this.state === 'chase') {
      this.state = 'chase'; this.turnTo(p.x, p.z, 8, dt);
      if (this.stateT > 0.9 + this.size * 0.1) { this.state = 'hop'; this.stateT = 0; let dx = d.x, dz = d.z; if (!g.level.los(this.x, this.z, p.x, p.z) && g.level.flowDir(this.x, this.z, this.flow)) { dx = this.flow.x; dz = this.flow.z; } this.hopDir = { x: dx, z: dz }; }
    } else if (this.state === 'hop') {
      const k = Math.min(1, this.stateT / 0.5); this.y = Math.sin(k * Math.PI) * (0.9 + this.size * 0.3);
      this.seek(this.hopDir.x, this.hopDir.z, 5.2 * this.slowF, dt);
      if (k >= 1) { this.y = 0; this.state = 'chase'; this.stateT = 0; g.fx.ring(this.x, this.z, 1.0 + this.size * 0.4, 0x80ff80, 0.25, 0.2, 0.1, 0.5); if (d.d < this.r + p.r + 0.6) g.damagePlayer(this.dmg, this.x, this.z, { kb: 5, src: this }); }
    }
  }
  aiBrute(dt) {
    const D = this.def, g = this.g, p = g.player; const isGolem = this.id === 'golem';
    if (this.state === 'idle' || this.state === 'chase') {
      const d = this.chase(dt, this.speed, D.range * 0.75); this.state = 'chase';
      if (d.d < D.range && this.cdT <= 0) { this.state = 'windup'; this.stateT = 0; if (isGolem) g.fx.telegraph(this.x + this.fwdX * 1.5, this.z + this.fwdZ * 1.5, 3.2, D.windup, { color: 0xff4040 }); else g.fx.telegraph(this.x + this.fwdX * 1.3, this.z + this.fwdZ * 1.3, 2.2, D.windup, { color: 0xff4040 }); g.audio.sfx('telegraph', 0.5); }
      else if (!isGolem && d.d > 6 && d.d < 11 && this.cdT <= 0 && Math.random() < dt * 0.6) { this.state = 'chargeWind'; this.stateT = 0; this.chargeDir = { x: d.x, z: d.z }; g.fx.telegraph(this.x, this.z, 1.0, 0.8, { shape: 1, ang: Math.atan2(d.z, d.x), len: 10, color: 0xff5030 }); g.audio.sfx('telegraph', 0.6); }
    } else if (this.state === 'windup') {
      if (this.stateT < D.windup * 0.6) this.turnTo(p.x, p.z, 7, dt);
      if (this.stateT >= D.windup) {
        const px = this.x + this.fwdX * (isGolem ? 1.8 : 1.5), pz = this.z + this.fwdZ * (isGolem ? 1.8 : 1.5);
        g.explosion(px, pz, isGolem ? 3.3 : 2.3, this.dmg, { src: this, color: isGolem ? 0xffb060 : 0xffd0a0, noEnemyHurt: true, quiet: !isGolem, shake: isGolem ? 0.5 : 0.25 });
        this.state = 'recover'; this.stateT = 0; g.audio.sfx('slam', 0.7);
      }
    } else if (this.state === 'chargeWind') {
      this.turnTo(this.x + this.chargeDir.x, this.z + this.chargeDir.z, 15, dt);
      if (this.stateT > 0.8) { this.state = 'charge'; this.stateT = 0; g.audio.sfx('roar', 0.3); }
    } else if (this.state === 'charge') {
      const sp = 14; this.moveBy(g, this.chargeDir.x * sp * dt, this.chargeDir.z * sp * dt);
      if (Math.random() < 0.8) g.fx.p({ x: this.x, y: 0.2, z: this.z, vy: 0.5, life: 0.5, size: 0.9, size1: 1.6, color: 0xc0b8a8, alpha: 0.35, add: false });
      if (this.dist() < this.r + g.player.r + 0.3 && !this.chargeHit) { this.chargeHit = true; g.damagePlayer(this.dmg * 1.2, this.x, this.z, { kb: 9, src: this }); }
      if (this.stateT > 0.75) { this.state = 'recover'; this.stateT = -0.3; this.chargeHit = false; this.cdT = 3; }
    } else if (this.state === 'recover') { if (this.stateT > 0.6) { this.state = 'chase'; this.cdT = D.cd * rr(0.8, 1.2); } }
  }
  aiHexer(dt) {
    const D = this.def, g = this.g, p = g.player; const d = this.dirToPlayer(); const los = g.level.los(this.x, this.z, p.x, p.z);
    if (this.state === 'idle' || this.state === 'chase') {
      this.state = 'chase';
      if (d.d < 6) { this.seek(-d.x, -d.z, this.speed * 1.1 * this.slowF, dt); this.walkPhase += dt * 6; }
      else if (d.d > 11 || !los) this.chase(dt, this.speed);
      this.turnTo(p.x, p.z, 8, dt);
      if (this.cdT <= 0 && los && d.d < D.range) {
        const aliveMinions = g.enemies.filter((e) => e.summoner === this && !e.dead).length;
        this.castKind = (aliveMinions < 2 && Math.random() < 0.4) ? 'summon' : 'fangs'; this.state = 'cast'; this.stateT = 0; g.audio.sfx('summon', 0.6);
        g.fx.ring(this.x, this.z, 1.8, 0xa070ff, 0.6, 0.3);
      }
    } else if (this.state === 'cast') {
      this.turnTo(p.x, p.z, 8, dt);
      if (this.stateT >= D.windup) {
        if (this.castKind === 'summon') {
          for (let i = 0; i < 2; i++) { const a = rr(0, TAU); const e = g.spawnEnemy(Math.random() < 0.5 ? 'zombie' : 'skeleton', this.x + Math.cos(a) * 2, this.z + Math.sin(a) * 2, { level: this.level, summoned: true, aggro: true }); if (e) e.summoner = this; }
        } else {
          const dx = p.x - this.x, dz = p.z - this.z, l = Math.hypot(dx, dz) || 1;
          for (let i = 0; i < 5; i++) { const px = this.x + dx / l * (2.5 + i * 2.0) + rr(-0.3, 0.3), pz = this.z + dz / l * (2.5 + i * 2.0) + rr(-0.3, 0.3); g.groundStrike(px, pz, 1.5, this.dmg, 0.8 + i * 0.12, { color: 0xb070ff, src: this }); }
        }
        this.state = 'recover'; this.stateT = 0;
      }
    } else if (this.state === 'recover') { if (this.stateT > 0.7) { this.state = 'chase'; this.cdT = D.cd * rr(0.8, 1.3); } }
  }
  aiFloater(dt) {
    const D = this.def, g = this.g, p = g.player; const d = this.dirToPlayer(); const los = g.level.los(this.x, this.z, p.x, p.z);
    this.y = this.baseY + Math.sin(this.t * 2.2 + this.spawnX) * 0.25;
    if (this.state === 'idle' || this.state === 'chase') {
      this.state = 'chase';
      if (d.d < 5) this.seek(-d.x, -d.z, this.speed * this.slowF, dt);
      else if (d.d > 9.5 || !los) this.chase(dt, this.speed);
      else { const s = Math.sin(this.t * 0.5 + this.spawnZ) > 0 ? 1 : -1; this.seek(-d.z * s, d.x * s, this.speed * 0.6 * this.slowF, dt); }
      this.turnTo(p.x, p.z, 8, dt);
      if (los && d.d < D.range && this.cdT <= 0) { this.state = 'windup'; this.stateT = 0; g.audio.sfx('telegraph', 0.4); }
    } else if (this.state === 'windup') {
      this.turnTo(p.x, p.z, 12, dt);
      if (Math.random() < 0.6) g.fx.p({ x: this.x + this.fwdX, y: this.y + 1.0, z: this.z + this.fwdZ, vy: 0.5, life: 0.4, size: 0.4, size1: 0.0, color: this.id === 'cinder' ? 0xffa030 : 0x80d0ff, type: 2 });
      if (this.stateT >= D.windup) {
        const col = this.id === 'cinder' ? 0xff7020 : 0x90e0ff;
        for (let i = -1; i <= (this.elite ? 1 : 0); i++) { const a = Math.atan2(p.x - this.x, p.z - this.z) + i * 0.28; g.spawnProjectile({ team: 'enemy', x: this.x + Math.sin(a) * 0.8, z: this.z + Math.cos(a) * 0.8, y: this.y + 1.1, dx: Math.sin(a), dz: Math.cos(a), speed: 10, dmg: this.dmg, r: 0.4, life: 2.5, kind: 'orb', color: col, owner: this, kb: 3, homing: this.id === 'wraith' ? 1.2 : 0 }); }
        g.audio.sfx('fire', 0.5); this.state = 'recover'; this.stateT = 0;
      }
    } else if (this.state === 'recover') { if (this.stateT > 0.5) { this.state = 'chase'; this.cdT = D.cd * rr(0.8, 1.3); } }
  }

  // ---------------- boss
  aiBoss(dt) {
    const D = this.def, g = this.g, p = g.player; const d = this.dirToPlayer();
    const hpF = this.hp / this.maxHp;
    const newPhase = hpF < 0.33 ? 2 : hpF < 0.66 ? 1 : 0;
    if (newPhase > this.phase) {
      this.phase = newPhase; this.pat = { name: 'phase', t: 0 }; g.audio.sfx('roar'); g.eng.addShake(0.8); g.fx.ring(this.x, this.z, 12, 0xff4040, 0.8, 1, 0.2); this.invulnPhase = 1.2; g.banner(newPhase === 1 ? D.name + ' grows furious!' : 'Final fury!', 'warn');
      for (let i = 0; i < 6; i++) g.fx.burst(this.x, 2, this.z, 10, { color: 0xff6030, size: 0.8, speed: 8, life: 0.8 });
    }
    this.invulnPhase = Math.max(0, (this.invulnPhase || 0) - dt);
    const spd = 1 + this.phase * 0.18;
    if (!this.pat) {
      // walk toward player slowly, then choose a pattern
      if (d.d > 5) this.chase(dt, this.speed * spd, 4); else this.turnTo(p.x, p.z, 5, dt);
      this.walkPhase += dt * 3;
      if (this.cdT <= 0) { this.startPattern(D.patterns[this.patIdx % D.patterns.length]); this.patIdx++; }
      return;
    }
    this.updatePattern(dt, d);
  }
  startPattern(name) { this.pat = { name, t: 0, step: 0 }; this.stateT = 0; const g = this.g; if (name !== 'ring') g.audio.sfx('telegraph', 0.8); }
  endPattern(cd = 1.4) { this.pat = null; this.cdT = cd * (1 - this.phase * 0.2); this.y = 0; this.rig.root.rotation.x = 0; }
  updatePattern(dt, d) {
    const P = this.pat, g = this.g, p = g.player, D = this.def; P.t += dt; const t = P.t;
    const biome = g.biomeId;
    switch (P.name) {
      case 'phase': if (t > 1.3) this.endPattern(0.6); break;
      case 'slam': {
        if (P.step === 0) { P.step = 1; P.target = { x: p.x, z: p.z }; g.fx.telegraph(p.x, p.z, 4.6, 1.05, { color: 0xff3030 }); this.from = { x: this.x, z: this.z }; }
        else if (P.step === 1 && t > 0.55) { P.step = 2; }
        if (P.step === 2) { const k = clamp((t - 0.55) / 0.55, 0, 1); const nx = lerp(this.from.x, P.target.x, easeOut(k)), nz = lerp(this.from.z, P.target.z, easeOut(k)); this.moveBy(g, nx - this.x, nz - this.z); this.y = Math.sin(k * Math.PI) * 4; this.turnTo(P.target.x, P.target.z, 20, dt); if (k >= 1) { P.step = 3; this.y = 0; g.explosion(this.x, this.z, 4.8, this.dmg, { src: this, color: 0xffc080, noEnemyHurt: true, shake: 0.9, debris: true }); g.fx.ring(this.x, this.z, 8, 0xffe0a0, 0.6, 1); } }
        if (P.step === 3 && t > 1.7) this.endPattern(1.0);
        break;
      }
      case 'summon': {
        if (P.step === 0 && t > 0.2) { P.step = 1; g.audio.sfx('summon'); g.fx.ring(this.x, this.z, 6, 0xb060ff, 0.9, 1); }
        if (P.step === 1 && t > 1.0) {
          P.step = 2; const n = 3 + this.phase;
          const kinds = { rotking: ['zombie'], lich: ['skeleton', 'skeleton', 'zombie'], sandtyrant: ['spider', 'keg'], frostwarden: ['slime', 'skeleton'], magmatitan: ['cinder', 'keg'], voidlord: ['wraith', 'cinder'] }[this.id];
          for (let i = 0; i < n; i++) { const a = i / n * TAU + rr(-0.3, 0.3); const e = g.spawnEnemy(pick(kinds), this.x + Math.cos(a) * 5, this.z + Math.sin(a) * 5, { level: this.level, summoned: true, aggro: true }); if (e) g.fx.ring(e.x, e.z, 1.6, 0xb060ff, 0.5, 0.2); }
        }
        this.rig.armL.rotation.x = this.rig.armR.rotation.x = -2.6 * clamp(t / 0.6, 0, 1);
        if (t > 1.8) this.endPattern(1.6);
        break;
      }
      case 'ring': {
        const waves = 2 + this.phase;
        if (t > 0.8 + P.step * 0.55 && P.step < waves) {
          const n = 18 + this.phase * 4, off = P.step * 0.17 + rr(0, 0.2);
          for (let i = 0; i < n; i++) { const a = i / n * TAU + off; g.spawnProjectile({ team: 'enemy', x: this.x + Math.cos(a) * 1.5, z: this.z + Math.sin(a) * 1.5, y: 1.2, dx: Math.cos(a), dz: Math.sin(a), speed: 8.5 + P.step, dmg: this.dmg * 0.6, r: 0.38, life: 3.2, kind: 'orb', color: g.bossColor(), owner: this, kb: 3 }); }
          g.audio.sfx('fire', 0.7); g.fx.ring(this.x, this.z, 3, g.bossColor(), 0.4); P.step++;
        }
        this.rig.armL.rotation.x = this.rig.armR.rotation.x = -2.4 * Math.sin(Math.min(1, t / 0.5) * 1.6);
        if (t > 0.8 + waves * 0.55 + 0.5) this.endPattern(1.2);
        break;
      }
      case 'spiral': {
        if (t < 0.7) { this.turnTo(p.x, p.z, 8, dt); break; }
        const dur = 3.6; P.acc = (P.acc || 0) - dt;
        if (t < 0.7 + dur && P.acc <= 0) {
          P.acc = 0.1 - this.phase * 0.015; P.ang = (P.ang === undefined ? rr(0, TAU) : P.ang) + 0.42;
          for (let k = 0; k < 2 + (this.phase > 1 ? 1 : 0); k++) { const a = P.ang + k * TAU / (2 + (this.phase > 1 ? 1 : 0)); g.spawnProjectile({ team: 'enemy', x: this.x + Math.cos(a) * 1.4, z: this.z + Math.sin(a) * 1.4, y: 1.3, dx: Math.cos(a), dz: Math.sin(a), speed: 9, dmg: this.dmg * 0.5, r: 0.35, life: 3, kind: 'orb', color: g.bossColor(), owner: this, kb: 2 }); }
          g.audio.sfx('bolt', 0.3);
        }
        this.face += dt * 3; this.rig.armL.rotation.x = this.rig.armR.rotation.x = -1.5;
        if (t > 0.7 + dur + 0.4) this.endPattern(1.3);
        break;
      }
      case 'charge': {
        if (P.step === 0) { P.step = 1; P.dir = { x: d.x, z: d.z }; g.fx.telegraph(this.x, this.z, 1.5, 0.9, { shape: 1, ang: Math.atan2(d.z, d.x), len: 15, color: 0xff3030 }); }
        if (P.step === 1) { this.turnTo(this.x + P.dir.x, this.z + P.dir.z, 20, dt); if (t > 0.95) { P.step = 2; P.t2 = 0; g.audio.sfx('roar', 0.5); } }
        if (P.step === 2) {
          P.t2 += dt; const sp = 22; this.moveBy(g, P.dir.x * sp * dt, P.dir.z * sp * dt);
          g.fx.p({ x: this.x, y: 0.3, z: this.z, vy: 0.6, life: 0.6, size: 1.6, size1: 2.4, color: 0xc0b8a8, alpha: 0.35, add: false });
          if (this.dist() < this.r + p.r + 0.4 && !P.hit) { P.hit = true; g.damagePlayer(this.dmg * 1.3, this.x, this.z, { kb: 11, src: this }); }
          const cx = g.level.cx(this.x + P.dir.x * (this.r + 0.5)), cz = g.level.cx(this.z + P.dir.z * (this.r + 0.5));
          if (g.level.solidCell(cx, cz) || P.t2 > 0.9) { P.step = 3; P.t3 = 0; g.eng.addShake(0.7); g.audio.sfx('slam'); g.fx.debrisBurst(this.x + P.dir.x * 1.5, 1, this.z + P.dir.z * 1.5, 14, [0x8a8a8a, g.biomeColor()], 8, 0.3); this.stunT = 0; this.dizzy = 1.3; }
        }
        if (P.step === 3) { P.t3 += dt; if (P.t3 > 1.3) this.endPattern(1.0); }
        break;
      }
      case 'rain': {
        const n = 8 + this.phase * 3;
        if (t < 0.7) { this.rig.armL.rotation.x = this.rig.armR.rotation.x = -2.8 * clamp(t / 0.5, 0, 1); break; }
        P.acc = (P.acc || 0) - dt;
        if (P.step < n && P.acc <= 0) {
          P.acc = 0.2 - this.phase * 0.03; P.step++;
          const a = rr(0, TAU), r = P.step % 3 === 0 ? 0.5 : rr(1, 7);
          const x = p.x + Math.cos(a) * r + (p.moveDir ? p.moveDir.x * 2 : 0), z = p.z + Math.sin(a) * r + (p.moveDir ? p.moveDir.z * 2 : 0);
          if (!g.level.solidCell(g.level.cx(x), g.level.cx(z))) g.groundStrike(x, z, 2.1, this.dmg * 0.8, 0.95, { color: g.bossColor(), src: this, meteor: true });
        }
        if (P.step >= n && t > 0.7 + n * 0.2 + 1.2) this.endPattern(1.4);
        break;
      }
      case 'nova': {
        if (P.step === 0) { P.step = 1; this.rig.armL.rotation.x = this.rig.armR.rotation.x = -2.8; g.fx.telegraph(this.x, this.z, 3, 0.9, { color: 0xffa030 }); }
        if (P.step === 1 && t > 1.0) { P.step = 2; P.radius = 1; P.hit = false; g.audio.sfx('slam'); g.eng.addShake(0.6); }
        if (P.step === 2) {
          P.radius += dt * 9.5; const R = P.radius;
          g.fx.ring(this.x, this.z, R, g.bossColor(), 0.12, R * 0.98, 0.3, 0.8);
          if (Math.random() < 0.9) for (let i = 0; i < 3; i++) { const a = rr(0, TAU); g.fx.p({ x: this.x + Math.cos(a) * R, y: 0.3, z: this.z + Math.sin(a) * R, vy: rr(1, 3), life: 0.4, size: 0.5, size1: 0.1, color: g.bossColor(), type: 2 }); }
          const pd = Math.hypot(p.x - this.x, p.z - this.z);
          if (!P.hit && Math.abs(pd - R) < 0.9 + p.r) { P.hit = true; g.damagePlayer(this.dmg * 0.9, this.x, this.z, { kb: 9, src: this }); }
          if (R > 19) this.endPattern(1.2);
        }
        break;
      }
      case 'beam': {
        if (P.step === 0) { P.step = 1; P.ang = Math.atan2(d.z, d.x); g.fx.telegraph(this.x, this.z, 1.0, 1.0, { shape: 1, ang: P.ang, len: 22, color: 0xe070ff }); g.audio.sfx('telegraph'); }
        if (P.step === 1 && t > 1.05) { P.step = 2; P.t2 = 0; P.dirS = Math.random() < 0.5 ? 1 : -1; g.audio.sfx('roar', 0.4); }
        if (P.step === 2) {
          P.t2 += dt; P.ang += P.dirS * 0.95 * dt * (1 + this.phase * 0.2); const bx = Math.cos(P.ang), bz = Math.sin(P.ang);
          this.face = Math.atan2(bx, bz);
          const len = 22; g.fx.bolt(this.x + bx * 1.5, 1.4, this.z + bz * 1.5, this.x + bx * len, 1.0, this.z + bz * len, 0xe070ff, 0.5, 0.06, 0.25);
          for (let i = 0; i < 3; i++) g.fx.p({ x: this.x + bx * rr(2, len), y: 1.0, z: this.z + bz * rr(2, len), vy: rr(0, 2), life: 0.3, size: 0.6, size1: 0, color: 0xe070ff, type: 0 });
          const rx = p.x - this.x, rz = p.z - this.z; const along = rx * bx + rz * bz, side = Math.abs(-rx * bz + rz * bx);
          if (along > 0 && along < len && side < 0.9 + p.r) { P.tick = (P.tick || 0) - dt; if (P.tick <= 0) { P.tick = 0.35; g.damagePlayer(this.dmg * 0.55, this.x, this.z, { kb: 4, src: this }); } }
          if (P.t2 > 2.8) this.endPattern(1.5);
        }
        break;
      }
    }
  }

  // ---------------- common finishing: animation + transforms
  finishFrame(dt, frozen) {
    if (this.pat && this.pat.name === 'charge' && this.dizzy > 0) { this.dizzy -= dt; }
    this.root.position.set(this.x, this.y, this.z);
    this.rig.root.rotation.y = this.face;
    this.shadow.position.y = 0.06 - this.y; const sc = 1 / (1 + this.y * 0.15); this.shadow.scale.setScalar(sc);
    if (this.status.freeze) this.rig.setFlash(0.0);
    const tint = this.status.freeze ? 1 : 0;
    const hitf = this.flashT > 0 ? 0.65 : 0;
    this.rig.setFlash && this.rig.setFlash(hitf);
    if (this.state === 'fuse') this.rig.setFlash(Math.sin(this.stateT * 28) > 0 ? 0.9 : 0.1);
    if (this.state === 'windup' && !this.rig.spark) this.rig.setFlash(0.25 + 0.25 * Math.sin(this.stateT * 30));
    if (this.dead) return;
    if (!frozen) this.animate(dt); else if (this.status.freeze) { /* hold pose */ }
    if (this.elite || this.carrier) {
      this.auraT += dt;
      if (this.auraT > 0.08) { this.auraT = 0; this.g.fx.p({ x: this.x + rr(-0.5, 0.5), y: rr(0.2, 2.2) * (this.baseScale || 1), z: this.z + rr(-0.5, 0.5), vy: 1.2, life: 0.7, size: 0.28, size1: 0, color: this.carrier ? 0xffd23a : 0xff5a3a, type: 2, alpha: 0.8 }); }
      if (this.marker) { this.marker.rotation.y += dt * 3; this.marker.position.y = 3.4 + Math.sin(this.t * 3) * 0.15; }
    }
  }
  animate(dt) {
    const r = this.rig, moving = this.state === 'chase' || (this.state === 'idle' && (this.wanderDir.x || this.wanderDir.z));
    const ph = this.walkPhase, sw = Math.sin(ph) * (moving ? 0.8 : 0);
    const id = this.id; const D = this.def;
    if (r.legL && r.armL && !r.legs && !r.tail) { // humanoid
      r.legL.rotation.x = damp(r.legL.rotation.x, sw, 14, dt); r.legR.rotation.x = damp(r.legR.rotation.x, -sw, 14, dt);
      const raiseTarget = (this.state === 'windup' || this.state === 'cast' || this.state === 'fuse') ? -2.6 : null;
      if (id === 'zombie' || id === 'rotking') {
        const base = -1.35 + (moving ? Math.sin(ph) * 0.15 : 0);
        let t = base; if (this.state === 'windup') t = lerp(-2.5, -2.9, 0.5) * clamp(this.stateT / (D.windup || 0.5), 0.3, 1); else if (this.state === 'recover') t = -0.4;
        r.armL.rotation.x = damp(r.armL.rotation.x, t, 18, dt); r.armR.rotation.x = damp(r.armR.rotation.x, t, 18, dt);
      } else if (id === 'skeleton' || id === 'lich') {
        const aim = this.state === 'windup' ? -1.55 : null;
        r.armL.rotation.x = damp(r.armL.rotation.x, aim ?? -sw * 0.7, 18, dt); r.armR.rotation.x = damp(r.armR.rotation.x, aim ?? sw * 0.7, 18, dt);
        if (this.state === 'windup') { r.armR.rotation.y = 0.0; }
      } else if (id === 'hexer' || id === 'voidlord') {
        const c = this.state === 'cast' ? -2.4 : -0.5 + Math.sin(this.t * 2) * 0.1;
        r.armL.rotation.x = damp(r.armL.rotation.x, c, 12, dt); r.armR.rotation.x = damp(r.armR.rotation.x, c, 12, dt);
        if (id === 'voidlord' && r.orbs) r.orbs.forEach((o, i) => { const a = this.t * 1.6 + i * TAU / r.orbs.length; o.position.set(Math.cos(a) * 1.8, 2.2 + Math.sin(this.t * 2 + i) * 0.4, Math.sin(a) * 1.8); o.rotation.y += dt * 3; });
      } else {
        // brutes / golems
        let a = this.state === 'windup' ? lerp(0, -3.0, clamp(this.stateT / (D.windup || 0.8), 0, 1)) : this.state === 'recover' ? 0.4 : (this.state === 'chargeWind' ? -1.0 : -sw * 0.6);
        if (this.pat) a = this.pat.name === 'slam' ? (this.pat.step >= 1 && this.pat.step < 3 ? -2.9 : (this.pat.step === 3 ? 0.5 : -1)) : -sw * 0.6;
        r.armR.rotation.x = damp(r.armR.rotation.x, a, 16, dt); r.armL.rotation.x = damp(r.armL.rotation.x, this.state === 'windup' ? a : sw * 0.6, 16, dt);
        r.torsoG.rotation.x = damp(r.torsoG.rotation.x, this.state === 'windup' ? -0.25 : this.state === 'recover' ? 0.3 : 0, 10, dt);
        if (this.state === 'charge') { r.torsoG.rotation.x = 0.4; r.armR.rotation.x = r.armL.rotation.x = -1.2; }
      }
      r.body.position.y = damp(r.body.position.y, Math.abs(Math.sin(ph)) * 0.08 * (moving ? 1 : 0), 14, dt);
      if (this.id === 'rotking' && r.cape) r.cape.rotation.x = 0.15 + Math.sin(this.t * 3) * 0.05;
      if (this.dizzy > 0) { r.head.rotation.z = Math.sin(this.t * 14) * 0.3; r.torsoG.rotation.x = 0.35; } else if (r.head) r.head.rotation.z = damp(r.head.rotation.z, 0, 10, dt);
    } else if (id === 'keg') {
      r.legL.rotation.x = Math.sin(ph) * 0.9; r.legR.rotation.x = -Math.sin(ph) * 0.9;
      const f = this.state === 'fuse' ? 1 + Math.sin(this.stateT * 28) * 0.08 + this.stateT * 0.22 : 1; r.body.scale.setScalar(f);
      r.body.position.y = Math.abs(Math.sin(ph)) * 0.12;
      if (r.spark && Math.random() < 0.7) { const p3 = r.spark.getWorldPosition(_v3); this.g.fx.p({ x: p3.x, y: p3.y, z: p3.z, vx: rr(-1, 1), vy: rr(1, 3), vz: rr(-1, 1), life: 0.35, size: 0.28, size1: 0, color: 0xffd060, color1: 0xff4010, type: 2 }); }
    } else if (r.legs) { // spider
      r.legs.forEach((l) => { const s = l.userData.side, i = l.userData.i; const w = Math.sin(ph * 1.5 + i * 1.6 + (s > 0 ? 0 : Math.PI)) * (moving ? 0.35 : 0.04); l.rotation.y = l.userData.base + w; l.rotation.z = s * (-0.15 + Math.abs(w) * 0.2); });
      r.body.position.y = 0.45 + Math.abs(Math.sin(ph * 1.5)) * 0.06 * (moving ? 1 : 0) + (this.state === 'crouch' ? -0.2 : 0);
      r.body.rotation.x = this.state === 'crouch' ? -0.2 : (this.state === 'leap' ? 0.4 : 0);
    } else if (id === 'slime') {
      const sq = this.state === 'hop' ? 1 + Math.sin(clamp(this.stateT / 0.5, 0, 1) * Math.PI) * 0.25 : 1 - Math.sin(this.t * 4) * 0.04 - (this.state === 'chase' && this.stateT > 0.7 ? (this.stateT - 0.7) * 0.5 : 0);
      r.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    } else if (id === 'wraith') {
      r.body.position.y = 1.0 + Math.sin(this.t * 2) * 0.1; r.tail.forEach((t, i) => { t.position.x = Math.sin(this.t * 3 + i * 0.8) * 0.12 * (i + 1); });
      const aim = this.state === 'windup' ? -1.5 : -0.6; r.armL.rotation.x = damp(r.armL.rotation.x, aim, 12, dt); r.armR.rotation.x = damp(r.armR.rotation.x, aim, 12, dt);
    } else if (id === 'cinder') {
      r.rods.forEach((rd, i) => { const a = this.t * 2.5 + i * TAU / 6; rd.position.set(Math.cos(a) * 0.9, Math.sin(this.t * 3 + i) * 0.3, Math.sin(a) * 0.9); rd.rotation.y = a; });
      r.core.rotation.y = this.t;
    }
  }

  // ---------------- damage
  onHit(dmg, srcX, srcZ, kb, heavy) {
    const g = this.g; this.flashT = 0.12; this.wake(true);
    const dx = this.x - srcX, dz = this.z - srcZ, l = Math.hypot(dx, dz) || 1;
    const resist = this.isBoss ? 0.12 : (1 - this.poise);
    this.knock.x += dx / l * kb * resist; this.knock.z += dz / l * kb * resist;
    if (heavy && !this.isBoss && this.poise < 0.8) { this.stunT = Math.max(this.stunT, 0.28); if (this.state === 'windup' || this.state === 'cast') { this.state = 'recover'; this.stateT = 0; } }
    else if (!this.isBoss && this.poise < 0.5 && (this.state === 'windup' || this.state === 'fuse') && this.state !== 'fuse' && Math.random() < 0.35) { this.state = 'recover'; this.stateT = 0; this.cdT = 0.5; }
  }
}

// ============================================================ projectiles
const arrowGeo = new THREE.BoxGeometry(0.07, 0.07, 0.9);
const tipGeo = new THREE.BoxGeometry(0.15, 0.15, 0.18);
const orbGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
export class Projectile {
  constructor(g, o) {
    this.g = g; Object.assign(this, { dmg: 1, r: 0.3, life: 2, pierce: 0, kb: 3, speed: 12, homing: 0, grav: 0 }, o);
    this.vx = o.dx * this.speed; this.vz = o.dz * this.speed; this.vy = o.vy || 0; this.dead = false; this.hit = new Set(); this.t = 0;
    const grp = new THREE.Group();
    if (this.kind === 'arrow' || this.kind === 'bolt') {
      const sh = new THREE.Mesh(arrowGeo, new THREE.MeshLambertMaterial({ color: this.kind === 'bolt' ? 0x8a8a98 : 0xc8a06a })); grp.add(sh);
      const tip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(1.6) })); tip.position.z = 0.5; grp.add(tip);
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color: this.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })); gl.scale.setScalar(this.kind === 'bolt' ? 1.4 : 1.0); gl.position.z = 0.4; grp.add(gl);
      if (this.kind === 'bolt') grp.scale.setScalar(1.25);
    } else {
      const c = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(1.5) })); grp.add(c); this.core = c;
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color: this.color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 })); gl.scale.setScalar(2.2); grp.add(gl);
    }
    grp.position.set(this.x, this.y, this.z); g.scene.add(grp); this.mesh = grp;
    grp.rotation.y = Math.atan2(this.vx, this.vz);
  }
  update(dt) {
    const g = this.g; this.t += dt; this.life -= dt;
    if (this.life <= 0) return this.kill(false);
    if (this.homing && this.team === 'enemy') {
      const p = g.player; const dx = p.x - this.x, dz = p.z - this.z, l = Math.hypot(dx, dz) || 1; const sp = Math.hypot(this.vx, this.vz);
      this.vx += dx / l * this.homing * sp * dt * 1.5; this.vz += dz / l * this.homing * sp * dt * 1.5; const nl = Math.hypot(this.vx, this.vz) || 1; this.vx = this.vx / nl * sp; this.vz = this.vz / nl * sp;
    }
    // sub-step for fast projectiles
    const steps = Math.ceil(Math.hypot(this.vx, this.vz) * dt / 0.6) || 1; const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.x += this.vx * sdt; this.z += this.vz * sdt; this.y += this.vy * sdt; this.vy -= this.grav * sdt;
      if (g.level.solidCell(g.level.cx(this.x), g.level.cx(this.z))) { if (g.level.tile(g.level.cx(this.x), g.level.cx(this.z)) !== 2) return this.kill(true); }
      if (this.check()) return;
    }
    this.mesh.position.set(this.x, this.y, this.z);
    if (this.kind === 'arrow' || this.kind === 'bolt') this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    else { this.core.rotation.x += dt * 5; this.core.rotation.y += dt * 4; }
    if (this.trail || this.kind === 'orb') g.fx.p({ x: this.x, y: this.y, z: this.z, vx: rr(-0.2, 0.2), vy: rr(-0.2, 0.2), vz: rr(-0.2, 0.2), life: 0.3, size: this.kind === 'orb' ? 0.55 : 0.28, size1: 0, color: this.color, alpha: 0.8 });
  }
  check() {
    const g = this.g;
    if (this.team === 'enemy') {
      const p = g.player; const dx = p.x - this.x, dz = p.z - this.z;
      if (dx * dx + dz * dz < (this.r + p.r) * (this.r + p.r) && !p.dead) {
        if (p.state === 'roll' || p.invuln > 0) return false;
        g.damagePlayer(this.dmg, this.x - this.vx, this.z - this.vz, { kb: this.kb, src: this.owner }); this.kill(true); return true;
      }
      return false;
    }
    for (const e of g.targetsIn(this.x, this.z, 3)) {
      if (this.hit.has(e)) continue;
      const dx = e.x - this.x, dz = e.z - this.z, rr2 = (this.r + (e.r || 0.5));
      if (dx * dx + dz * dz < rr2 * rr2) {
        if (e.flying === false || e.flying === undefined) { /* ground target: arrow height ok */ }
        this.hit.add(e);
        const isCrit = Math.random() < (this.crit || 0);
        g.hitTarget(e, this.dmg * (isCrit ? 1.75 : 1) * rr0(), { crit: isCrit, kb: this.kb, srcX: this.x - this.vx * 0.05, srcZ: this.z - this.vz * 0.05, weapon: this.weapon, projectile: true });
        if (this.pierce <= 0) { this.kill(true); return true; } this.pierce--;
      }
    }
    return false;
  }
  kill(impact) {
    if (this.dead) return; this.dead = true; const g = this.g;
    if (impact) { g.fx.burst(this.x, this.y, this.z, this.kind === 'orb' ? 10 : 6, { color: this.color, size: this.kind === 'orb' ? 0.5 : 0.25, speed: 4, life: 0.35, type: 2 }); if (this.kind === 'orb') g.fx.ring(this.x, this.z, 1.4, this.color, 0.3, 0.2, this.y); }
    g.scene.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.material && o.material.dispose) o.material.dispose(); });
  }
}
function rr0() { return 0.94 + Math.random() * 0.12; }

// ============================================================ pickups
const emGeo = new THREE.OctahedronGeometry(0.22);
const emMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40ff90).multiplyScalar(1.5) });
const heartMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a6a).multiplyScalar(1.4) });
export class Pickup {
  constructor(g, kind, x, z, o = {}) {
    this.g = g; this.kind = kind; this.x = x; this.z = z; this.y = 0.8; this.vx = rr(-3, 3); this.vz = rr(-3, 3); this.vy = rr(4, 7); this.t = 0; this.value = o.value || 1; this.item = o.item || null; this.dead = false;
    this.delay = o.delay || 0.35; this.magnet = kind !== 'item';
    let m;
    if (kind === 'emerald') { m = new THREE.Mesh(emGeo, emMat); m.scale.setScalar(this.value >= 10 ? 1.6 : 1); }
    else if (kind === 'heart') { m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), heartMat); }
    else if (kind === 'potion') { m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.35), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x60b0ff).multiplyScalar(1.5) })); }
    else if (kind === 'shard') { m = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23a).multiplyScalar(1.8) })); }
    else if (kind === 'item') {
      const it = this.item; const col = RARITY[it.rarity].color;
      m = new THREE.Group();
      if (it.slot === 'melee' || it.slot === 'ranged') { const w = makeWeaponMesh(it); w.scale.setScalar(0.8); w.rotation.z = Math.PI / 4; w.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) o.material.envMap = g.eng.envMap; }); m.add(w); }
      else if (it.slot === 'armor') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.5), new THREE.MeshLambertMaterial({ color: 0x8a9aae, emissive: 0x222a38 })); m.add(b); }
      else { const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(ARTIFACT_COL[it.art] || 0xffffff).multiplyScalar(1.6) })); m.add(b); }
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 5), new THREE.MeshBasicMaterial({ map: FX.beam, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 })); beam.position.y = 2.6; m.add(beam);
      const beam2 = beam.clone(); beam2.rotation.y = Math.PI / 2; m.add(beam2);
      this.beam = [beam, beam2];
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glow, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })); gl.scale.setScalar(2.4); gl.position.y = 0.2; m.add(gl);
      this.vy = 6; this.core = m.children[0];
    }
    this.mesh = m; m.position.set(x, this.y, z); g.scene.add(m);
  }
  update(dt) {
    const g = this.g, p = g.player; this.t += dt;
    if (this.y > 0.5 || this.vy > 0) { this.vy -= 22 * dt; this.y += this.vy * dt; this.x += this.vx * dt; this.z += this.vz * dt; if (this.y <= 0.5) { this.y = 0.5; this.vy = Math.abs(this.vy) * 0.35; if (this.vy < 1) this.vy = 0; this.vx *= 0.5; this.vz *= 0.5; } tmp.x = this.x; tmp.z = this.z; g.level.resolve(tmp, 0.2); this.x = tmp.x; this.z = tmp.z; }
    else { this.y = 0.5 + Math.sin(this.t * 4 + this.x) * 0.1; }
    this.mesh.position.set(this.x, this.y, this.z); this.mesh.rotation.y += dt * 2.5;
    if (this.kind === 'item') { this.core.position.y = 0.4 + Math.sin(this.t * 3) * 0.12; if (this.beam) this.beam.forEach((b) => { b.material.opacity = 0.6 + Math.sin(this.t * 6) * 0.2; }); if (Math.random() < dt * 8) g.fx.p({ x: this.x + rr(-0.4, 0.4), y: 0.3, z: this.z + rr(-0.4, 0.4), vy: 2, life: 0.8, size: 0.2, size1: 0, color: new THREE.Color(RARITY[this.item.rarity].color).getHex(), type: 2 }); }
    if (this.t < this.delay || p.dead) return;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const pr = this.kind === 'item' ? 1.5 : 1.1;
    if (this.magnet && d < 4.2) { const s = 9 + (4.2 - d) * 4; this.x += dx / d * s * dt; this.z += dz / d * s * dt; this.y = lerp(this.y, 1, dt * 5); }
    if (d < pr) this.collect();
  }
  collect() {
    const g = this.g; if (this.dead) return;
    if (this.kind === 'heart' && g.player.hp >= g.player.maxHp) return;
    this.dead = true; g.collect(this); g.scene.remove(this.mesh);
  }
}
export const ARTIFACT_COL = { flame: 0xff8a3a, thunder: 0xfff06a, frost: 0x7fe0ff, totem: 0x6aff9a, meteor: 0xff5a3a, whirl: 0xd0e0ff };
