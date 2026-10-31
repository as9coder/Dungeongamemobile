import { weaponIcon, LOOKS } from './voxel.js';
import {
  WEAPONS, ARTIFACTS, ENCH, PERKS, RARITY, MISSIONS, THREATS, QUESTS, ARMOR_SETS, MAX_UPGRADE, MAX_LEVEL,
  itemDamage, itemRate, itemCrit, armorStats, artifactPower, itemValue, itemPrice, upgradeCost, itemPower, xpNeed, describeItem, rollItem, ENCH_KEYS, ENEMIES,
} from './data.js';
import { A } from './audio.js';
import { writeSave, scheduleSave, wipeSave, genStock } from './save.js';
import { clamp, fmt, TAU } from './util.js';
import { ARTIFACT_COL } from './entities.js';
import { T_WALL, T_LIQUID, T_PILLAR, CS } from './world.js';

const $ = (s, r = document) => r.querySelector(s);
const hexcss = (n) => '#' + n.toString(16).padStart(6, '0');

// ---------- icons
const armorIconCache = {};
function armorIcon(it) {
  const look = it.look || 'cloth'; if (armorIconCache[look]) return armorIconCache[look];
  const L = LOOKS[look] || LOOKS.cloth; const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  const px = (col, a, b, w, h) => { x.fillStyle = hexcss(col); x.fillRect(a, b, w, h); };
  px(L.arm, 3, 8, 6, 14); px(L.arm, 23, 8, 6, 14); px(L.torso, 8, 6, 16, 18); px(L.trim, 8, 6, 16, 2); px(L.trim, 14, 8, 4, 16);
  px(0x000000, 3, 21, 6, 1); px(L.leg, 9, 24, 6, 6); px(L.leg, 17, 24, 6, 6); px(L.boot, 9, 28, 6, 3); px(L.boot, 17, 28, 6, 3);
  px(L.helm === 'cap' ? L.torso : L.torso, 10, 0, 12, 7); px(L.trim, 10, 5, 12, 1);
  if (L.glow) { px(L.glow, 15, 12, 2, 2); px(L.glow, 12, 3, 2, 1); px(L.glow, 18, 3, 2, 1); }
  const s = document.createElement('canvas'); s.width = s.height = 64; const sx = s.getContext('2d'); sx.imageSmoothingEnabled = false; sx.drawImage(c, 0, 0, 64, 64);
  return (armorIconCache[look] = s.toDataURL());
}
function iconHTML(it) {
  if (!it) return '';
  if (WEAPONS[it.type]) return `<img src="${weaponIcon(it, 64)}">`;
  if (it.type === 'armor') return `<img src="${armorIcon(it)}">`;
  const a = ARTIFACTS[it.art]; return `<span class="em" style="color:${a.color}">${a.icon}</span>`;
}
function cellHTML(it, cls = '', attrs = '') {
  if (!it) return `<div class="cell empty ${cls}" ${attrs}></div>`;
  return `<div class="cell ${it.rarity} ${cls}" ${attrs}>${iconHTML(it)}<span class="lv">${it.level}</span>${it.upgrade ? `<span class="up">+${it.upgrade}</span>` : ''}</div>`;
}

export class UI {
  constructor(game) {
    this.g = game; this.root = $('#ui'); this.held = { atk: false, shoot: false };
    this.mode = 'title'; this.modal = null; this.lastObj = ''; this.mapT = 0; this.lastHp = 1; this.sel = null; this.tab = 'gear'; this.filter = 'all';
    this.keys = {}; this.joy = { id: null, ox: 0, oy: 0 };
    this.build(); this.bind();
    window.__onBack = () => this.onBack();
    window.__setPaused = (p) => { if (p && this.g.mode === 'mission' && !this.modal && this.mode === 'hud') this.showPause(); A.pause(p && false); };
  }
  build() {
    const g = this.g;
    this.root.insertAdjacentHTML('beforeend', `
      <div id="hud" class="hide">
        <div id="hpwrap"><div id="lvl">1</div><div class="bars"><div class="bar hp"><div class="ghost"></div><div class="fill"></div><div class="txt"></div></div><div class="bar xp"><div class="fill"></div></div></div></div>
        <div id="emwrap"><div class="gem"></div><span id="emv">0</span></div>
        <div id="obj" class="hide"></div>
        <div id="bossbar" class="hide"><div class="nm"></div><div class="bar"><div class="ghost" style="background:#fff"></div><div class="fill"></div></div></div>
        <div id="mapwrap"><canvas id="minimap" width="108" height="108"></canvas></div>
        <div class="hudbtn" id="pausebtn">❚❚</div>
        <div class="camp-menu hide" id="campmenu">
          <div class="hudbtn" data-open="gear">🎒<small>GEAR</small></div>
          <div class="hudbtn" data-open="quests">📜<small>QUESTS</small><span class="badge hide" id="qbadge">0</span></div>
          <div class="hudbtn" data-open="missions">🗺<small>MAP</small></div>
          <div class="hudbtn" data-open="settings">⚙<small>OPTIONS</small></div>
        </div>
        <div id="stickzone"></div><div id="stick"><div class="knob"></div></div>
        <div class="abtn" id="bAtk"><span class="ic">⚔</span></div>
        <div class="abtn" id="bRoll"><span class="ic">➤</span>ROLL</div>
        <div class="abtn" id="bShoot"><span class="ic">🏹</span></div>
        <div class="abtn" id="bPot"><span class="ic">🧪</span><span id="potn" style="position:absolute;bottom:2px;right:6px">3</span></div>
        <div class="abtn" id="bA0"><span class="ic"></span><div class="cd"></div><span class="cdt"></span></div>
        <div class="abtn" id="bA1"><span class="ic"></span><div class="cd"></div><span class="cdt"></span></div>
        <div class="abtn" id="bA2"><span class="ic"></span><div class="cd"></div><span class="cdt"></span></div>
        <div class="abtn hide" id="bUse"><span class="ic">✋</span>USE</div>
        <div id="prompt" class="hide"></div>
      </div>
      <div id="banner"></div><div id="toasts"></div><div id="modalroot"></div>
      <div id="title">
        <div class="logo">VOXEL<br><span>DELVERS</span></div>
        <div class="sub">A DUNGEON CRAWLING ADVENTURE</div>
        <div class="menu"><div class="btn big" data-act="play">PLAY</div><div class="btn sm hide" data-act="newgame">NEW GAME</div></div>
        <div class="ver">v1.0 · tap to begin</div>
      </div>
      <div id="fadecover"></div>`);
    this.hud = $('#hud'); this.title = $('#title'); this.modalRoot = $('#modalroot'); this.fadeEl = $('#fadecover'); this.g.eng.fadeEl = this.fadeEl;
    this.mini = $('#minimap').getContext('2d');
    this.refreshTitle();
    document.body.classList.toggle('lefty', !!this.g.save.settings.left);
  }
  refreshTitle() {
    const S = this.g.save; const has = S.runs > 0 || S.level > 1 || Object.keys(S.done).length > 0;
    $('[data-act=play]', this.title).textContent = has ? 'CONTINUE' : 'PLAY';
    $('[data-act=newgame]', this.title).classList.toggle('hide', !has);
  }

  // ------------------------------------------------------------ input
  bind() {
    const g = this.g, inp = g.input;
    const zone = $('#stickzone'), stick = $('#stick'), knob = $('.knob', stick);
    const R = 52; const home = { x: 0, y: 0 };
    const setStick = (px, py) => { stick.style.left = px - 62 + 'px'; stick.style.bottom = (window.innerHeight - py - 62) + 'px'; };
    zone.addEventListener('pointerdown', (e) => {
      A.unlock(); if (this.joy.id !== null) return; this.joy.id = e.pointerId; zone.setPointerCapture(e.pointerId); this.joy.ox = e.clientX; this.joy.oy = e.clientY; setStick(e.clientX, e.clientY); knob.style.transform = 'translate(0,0)'; e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joy.id) return; let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy; const d = Math.hypot(dx, dy);
      if (d > R) { this.joy.ox += dx / d * (d - R); this.joy.oy += dy / d * (d - R); setStick(this.joy.ox, this.joy.oy); dx = e.clientX - this.joy.ox; dy = e.clientY - this.joy.oy; }
      const m = Math.min(1, Math.hypot(dx, dy) / R); const l = Math.hypot(dx, dy) || 1;
      this.joyVec = { x: dx / l * (m < 0.12 ? 0 : m), z: dy / l * (m < 0.12 ? 0 : m) }; knob.style.transform = `translate(${dx / l * Math.min(R, Math.hypot(dx, dy))}px,${dy / l * Math.min(R, Math.hypot(dx, dy))}px)`; e.preventDefault();
    });
    const up = (e) => { if (e.pointerId !== this.joy.id) return; this.joy.id = null; this.joyVec = null; stick.style.left = ''; stick.style.bottom = ''; knob.style.transform = ''; };
    zone.addEventListener('pointerup', up); zone.addEventListener('pointercancel', up);
    const btn = (id, down, upfn) => {
      const el = $('#' + id); el.addEventListener('pointerdown', (e) => { A.unlock(); el.setPointerCapture(e.pointerId); el.classList.add('on'); down(); e.preventDefault(); });
      const u = () => { el.classList.remove('on'); upfn && upfn(); }; el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u); el.addEventListener('lostpointercapture', u);
    };
    btn('bAtk', () => { this.held.atk = true; inp.attackPressed = true; }, () => { this.held.atk = false; });
    btn('bShoot', () => { this.held.shoot = true; }, () => { this.held.shoot = false; });
    btn('bRoll', () => { inp.rollPressed = true; });
    btn('bPot', () => { inp.potionPressed = true; });
    btn('bUse', () => { inp.interactPressed = true; });
    for (let i = 0; i < 3; i++) btn('bA' + i, () => { inp.art[i] = true; });
    $('#pausebtn').addEventListener('pointerdown', (e) => { A.sfx('click'); this.showPause(); e.preventDefault(); });
    $('#campmenu').addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-open]'); if (!b) return; A.sfx('click'); this.openStation(b.dataset.open === 'gear' ? 'gear' : b.dataset.open); e.preventDefault(); });
    // keyboard (desktop / gamepad-less testing)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; this.keys[e.code] = true; A.unlock();
      if (e.code === 'KeyJ' || e.code === 'KeyZ') { this.held.atk = true; inp.attackPressed = true; }
      if (e.code === 'KeyK' || e.code === 'KeyX') this.held.shoot = true;
      if (e.code === 'Space' || e.code === 'ShiftLeft') inp.rollPressed = true;
      if (e.code === 'KeyQ') inp.potionPressed = true; if (e.code === 'KeyE') inp.interactPressed = true;
      if (e.code === 'Digit1') inp.art[0] = true; if (e.code === 'Digit2') inp.art[1] = true; if (e.code === 'Digit3') inp.art[2] = true;
      if (e.code === 'Escape') this.onBack();
      if (e.code === 'KeyI') this.openStation('gear');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyJ' || e.code === 'KeyZ') this.held.atk = false; if (e.code === 'KeyK' || e.code === 'KeyX') this.held.shoot = false; });
    // delegated modal clicks
    this.root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return; A.unlock(); this.act(el.dataset.act, el.dataset, el);
    });
    // block context menu / gestures
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (!e.target.closest('.pbody')) e.preventDefault(); }, { passive: false });
  }
  pollInput() {
    const g = this.g, inp = g.input, k = this.keys;
    let mx = 0, mz = 0;
    if (this.joyVec) { mx = this.joyVec.x; mz = this.joyVec.z; }
    else { mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0); mz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0); const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; } }
    inp.mx = mx; inp.mz = mz; inp.shoot = this.held.shoot;
    if (this.held.atk && this.g.mode === 'mission') inp.attackPressed = true;
  }

  // ------------------------------------------------------------ mode switches
  onCamp() { this.mode = 'hud'; this.hud.classList.remove('hide'); $('#campmenu').classList.remove('hide'); $('#pausebtn').classList.add('hide'); $('#mapwrap').classList.add('hide'); $('#obj').classList.add('hide'); $('#bossbar').classList.add('hide'); this.setCombatButtons(false); this.fade(0); this.updateBadge(); }
  onMission() { this.mode = 'hud'; this.hud.classList.remove('hide'); $('#campmenu').classList.add('hide'); $('#pausebtn').classList.remove('hide'); $('#mapwrap').classList.remove('hide'); $('#obj').classList.remove('hide'); $('#bossbar').classList.add('hide'); this.setCombatButtons(true); this.lastObj = ''; this.refreshArtifactButtons(); this.fade(0); if (!this.g.save.seenTutorial) { this.g.save.seenTutorial = true; setTimeout(() => { this.toast('Left stick: move · ⚔ hold: attack · ➤ roll to dodge', 'info'); }, 2500); setTimeout(() => this.toast('🏹 shoots · artifacts have big cooldowns · 🧪 heals', 'info'), 6500); } }
  setCombatButtons(on) { for (const id of ['bAtk', 'bRoll', 'bShoot', 'bPot', 'bA0', 'bA1', 'bA2']) $('#' + id).classList.toggle('hide', !on && id !== 'bAtk' && id !== 'bRoll'); $('#bAtk').classList.toggle('hide', false); }
  fade(v) { this.fadeEl.style.opacity = v; }
  onBoss(b) { const bar = $('#bossbar'); bar.classList.remove('hide'); $('.nm', bar).textContent = b.def.name.toUpperCase(); $('#obj').classList.add('hide'); this.boss = b; this.bossGhost = 1; }
  onBossGone() { $('#bossbar').classList.add('hide'); $('#obj').classList.remove('hide'); this.boss = null; }
  refreshArtifactButtons() {
    const p = this.g.player; for (let i = 0; i < 3; i++) { const a = p.artifacts && p.artifacts[i]; const el = $('#bA' + i); el.classList.toggle('hide', !a || this.g.mode !== 'mission'); if (a) { const d = ARTIFACTS[a.art]; $('.ic', el).textContent = d.icon; $('.ic', el).style.color = d.color; el.style.borderColor = d.color; } }
    const rg = p.ranged && p.ranged.type; $('#bShoot').classList.toggle('hide', !rg || this.g.mode !== 'mission');
    $('#bShoot .ic').textContent = p.ranged && p.ranged.type === 'crossbow' ? '➶' : '🏹';
  }
  updateBadge() { const n = this.claimable(); const b = $('#qbadge'); b.textContent = n; b.classList.toggle('hide', n === 0); }

  // ------------------------------------------------------------ per frame
  update(dt) {
    this.pollInput();
    const g = this.g; if (this.mode !== 'hud' || !g.level) return;
    const p = g.player, S = g.save;
    // bars
    const hpf = clamp(p.hp / p.maxHp, 0, 1); const hf = $('#hpwrap .hp .fill'), hg = $('#hpwrap .hp .ghost');
    if (Math.abs(hpf - this.lastHp) > 0.002) { hf.style.transform = `scaleX(${hpf})`; if (hpf > this.lastHp) hg.style.transform = `scaleX(${hpf})`; else setTimeout(() => { hg.style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1)})`; }, 10); this.lastHp = hpf; }
    $('#hpwrap .hp .txt').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    $('#lvl').textContent = S.level;
    $('#hpwrap .xp .fill').style.transform = `scaleX(${S.level >= MAX_LEVEL ? 1 : S.xp / xpNeed(S.level)})`;
    $('#emv').textContent = fmt(S.emeralds);
    // buttons
    if (g.mode === 'mission') {
      $('#potn').textContent = p.potions;
      for (let i = 0; i < 3; i++) { const a = p.artifacts && p.artifacts[i]; if (!a) continue; const el = $('#bA' + i); const cd = p.artCD[i], mx = p.artMax[i] || 1; $('.cd', el).style.transform = `scaleY(${cd > 0 ? cd / mx : 0})`; $('.cdt', el).textContent = cd > 0 ? Math.ceil(cd) : ''; }
      this.updateObjectives(); this.updateBoss(dt);
      this.mapT -= dt; if (this.mapT <= 0) { this.mapT = 0.15; this.drawMap(); }
    }
    // camp prompt
    const near = g.mode === 'camp' ? g.station : null; const pr = $('#prompt'), use = $('#bUse');
    if (near && !this.modal) { pr.textContent = near.label; pr.classList.remove('hide'); use.classList.remove('hide'); }
    else { pr.classList.add('hide'); if (g.mode === 'camp') use.classList.add('hide'); }
    if (g.mode === 'mission') { use.classList.add('hide'); const L = g.level; const pc = g.chestNear; }
  }
  updateObjectives() {
    const g = this.g; const el = $('#obj'); if (!g.objs) return;
    const key = g.objs.map((o) => o.have + ':' + o.done).join('|') + (g.exitOpen ? 'X' : ''); if (key === this.lastObj) return; this.lastObj = key;
    let html = `<div class="t">${g.mission.name.toUpperCase()}</div>`;
    for (const o of g.objs) html += `<div class="o ${o.done ? 'done' : ''}">${o.done ? '✔' : '▸'} ${o.text}${o.n && !o.done ? ` <b>${o.have}/${o.n}</b>` : ''}</div>`;
    if (g.exitOpen) html += `<div class="o"><b>▸ Enter the portal</b></div>`;
    el.innerHTML = html;
  }
  updateBoss(dt) {
    const b = this.boss; if (!b) return; const bar = $('#bossbar'); const f = clamp(b.hp / b.maxHp, 0, 1);
    $('.fill', bar).style.transform = `scaleX(${f})`; $('.ghost', bar).style.transform = `scaleX(${f})`; $('.fill', bar).style.transformOrigin = 'left'; $('.ghost', bar).style.transformOrigin = 'left';
  }
  drawMap() {
    const g = this.g, L = g.level, c = this.mini, p = g.player; if (!L || !L.explored) return;
    const W = 108, S = 4, N = W / S; c.clearRect(0, 0, W, W); c.fillStyle = 'rgba(6,8,22,0.6)'; c.fillRect(0, 0, W, W);
    const pcx = L.cx(p.x), pcz = L.cx(p.z); const half = N / 2;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const cx = pcx - half + x, cz = pcz - half + z; if (!L.inb(cx, cz) || !L.explored[L.idx(cx, cz)]) continue;
      const t = L.grid[L.idx(cx, cz)];
      c.fillStyle = t === 0 ? '#3a4278' : t === T_LIQUID ? '#2a5aa0' : t === T_PILLAR ? '#4a5088' : '#8a96d0'; if (t === 0) { /* wall only if adjacent explored floor */ }
      c.fillRect(x * S, z * S, S, S);
    }
    const mk = (wx, wz, col, r = 3) => { const mx = (L.cx(wx) - (pcx - half)) * S + S / 2, mz = (L.cx(wz) - (pcz - half)) * S + S / 2; if (mx < 0 || mz < 0 || mx > W || mz > W) return; c.fillStyle = col; c.fillRect(mx - r / 2, mz - r / 2, r, r); };
    for (const s of g.spawners) if (!s.dead && L.explored[L.idx(L.cx(s.x), L.cx(s.z))]) mk(s.x, s.z, '#c060ff', 5);
    for (const b of g.beacons) if (L.explored[L.idx(L.cx(b.x), L.cx(b.z))]) mk(b.x, b.z, b.done ? '#60ff90' : '#ffd23a', 5);
    for (const e of g.enemies) if (!e.dead && e.aggro && Math.hypot(e.x - p.x, e.z - p.z) < 14) mk(e.x, e.z, '#ff5a5a', 3);
    if (g.boss && g.bossWoken) mk(g.boss.x, g.boss.z, '#ff2020', 7);
    else if (g.boss && L.explored[L.idx(L.cx(g.boss.x), L.cx(g.boss.z))]) mk(g.boss.x, g.boss.z, '#ff8080', 6);
    if (g.exitPortal) { const t = Math.floor(g.time * 3) % 2; mk(g.exitPortal.x, g.exitPortal.z, t ? '#7af0ff' : '#ffffff', 6); }
    c.fillStyle = '#ffffff'; c.beginPath(); const px = half * S + S / 2, pz = half * S + S / 2; const a = p.face; c.moveTo(px + Math.sin(a) * 5, pz + Math.cos(a) * 5); c.lineTo(px + Math.sin(a + 2.5) * 4, pz + Math.cos(a + 2.5) * 4); c.lineTo(px + Math.sin(a - 2.5) * 4, pz + Math.cos(a - 2.5) * 4); c.fill();
    // rotate hint: map uses world axes
  }
  pulse(k) { const e = $('#emwrap'); e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); }
  banner(text, kind = '') { const b = $('#banner'); b.innerHTML = `<div class="b ${kind}">${text}</div>`; const n = b.firstChild; setTimeout(() => { if (b.firstChild === n) b.innerHTML = ''; }, 2500); }
  toast(text, kind = '') { const t = $('#toasts'); const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text; t.appendChild(d); while (t.children.length > 4) t.firstChild.remove(); setTimeout(() => d.remove(), 3500); }

  // ------------------------------------------------------------ modals
  openModal(title, body, opts = {}) {
    this.closeModal(true); this.modal = opts.name || title; this.g.paused = true;
    this.modalRoot.innerHTML = `<div class="modal"><div class="panel" style="${opts.width ? `width:min(100%,${opts.width}px)` : ''}"><div class="ptitle"><span>${title}</span>${opts.noClose ? '' : '<button class="x" data-act="close">✕</button>'}<span class="em hide" id="mem">◆ <span id="memv"></span></span></div><div class="pbody">${body}</div></div></div>`;
    if (opts.showEm !== false) { const e = $('#mem'); e.classList.remove('hide'); $('#memv').textContent = fmt(this.g.save.emeralds); }
    this.modalOpts = opts;
  }
  closeModal(silent) { this.modalRoot.innerHTML = ''; if (this.modal && !silent) { this.g.paused = false; } this.modal = null; this.g.input.attackPressed = false; if (!silent) { this.held.atk = false; this.held.shoot = false; } }
  refreshEm() { const e = $('#memv'); if (e) e.textContent = fmt(this.g.save.emeralds); }
  onBack() {
    if (this.modal) { if (!this.modalOpts.noClose) { A.sfx('click'); this.closeModal(); if (this.g.mode === 'mission' && this.modal === null && this.pausedByMenu) { this.pausedByMenu = false; } } return; }
    if (this.g.mode === 'mission' && this.mode === 'hud') this.showPause();
  }
  openStation(id) {
    A.sfx('open');
    if (id === 'missions') this.showMissions(); else if (id === 'smith') { this.tab = 'smith'; this.showGear(); } else if (id === 'merchant') this.showMerchant(); else if (id === 'quests') this.showQuests(); else if (id === 'gear') { this.tab = 'gear'; this.showGear(); } else if (id === 'settings') this.showSettings();
  }

  // ---- gear / blacksmith
  showGear() {
    const g = this.g, S = g.save, p = g.player; const smith = this.tab === 'smith';
    const E = S.equip; const eqSlots = [['melee', E.melee], ['ranged', E.ranged], ['armor', E.armor], ['art0', E.art[0]], ['art1', E.art[1]], ['art2', E.art[2]]];
    const flt = this.filter; const inv = S.inv.map((it, i) => [it, i]).filter(([it]) => flt === 'all' || (flt === 'weapon' && (it.slot === 'melee' || it.slot === 'ranged')) || (flt === 'armor' && it.slot === 'armor') || (flt === 'artifact' && it.slot === 'artifact'));
    inv.sort((a, b) => ({ unique: 0, rare: 1, common: 2 }[a[0].rarity] - { unique: 0, rare: 1, common: 2 }[b[0].rarity]) || (b[0].level - a[0].level));
    const sel = this.getSel();
    const eqHtml = eqSlots.map(([k, it], i) => cellHTML(it, `${this.sel && this.sel.src === 'eq' && this.sel.k === k ? 'sel' : ''}`, `data-act="selq" data-k="${k}"`)).join('');
    const st = p.stats;
    const html = `
      <div class="tabs"><div class="tab ${!smith ? 'on' : ''}" data-act="tab" data-t="gear">GEAR</div><div class="tab ${smith ? 'on' : ''}" data-act="tab" data-t="smith">BLACKSMITH</div><span style="flex:1"></span>
        ${['all', 'weapon', 'armor', 'artifact'].map((f) => `<div class="tab ${flt === f ? 'on' : ''}" data-act="filter" data-f="${f}">${f.toUpperCase()}</div>`).join('')}</div>
      <div class="row" style="align-items:flex-start">
        <div class="col" style="width:176px;flex:0 0 176px"><div class="slots">${eqHtml}</div>
          <div class="detail" style="min-height:0;font-size:17px"><div class="stat"><span>Level</span><b>${S.level}</b></div><div class="stat"><span>Health</span><b>${st.maxHp}</b></div><div class="stat"><span>Defense</span><b>${st.def}</b></div><div class="stat"><span>Melee</span><b>${p.melee ? Math.round(itemDamage(p.melee) * st.dmgMult) : 0}</b></div><div class="stat"><span>Ranged</span><b>${p.ranged && p.ranged.type ? Math.round(itemDamage(p.ranged) * st.dmgMult) : 0}</b></div></div></div>
        <div style="flex:1;min-width:0"><div class="grid" id="invgrid">${inv.map(([it, i]) => cellHTML(it, this.sel && this.sel.src === 'inv' && this.sel.i === i ? 'sel' : '', `data-act="seli" data-i="${i}"`)).join('') || '<div style="color:#8e98c8;padding:10px">No items. Loot chests and enemies!</div>'}</div></div>
        <div style="width:236px;flex:0 0 236px">${this.detailHTML(sel, smith)}</div>
      </div>`;
    this.openModal(smith ? 'BLACKSMITH' : 'GEAR', html, { name: 'gear', width: 940 });
    const pb = $('.pbody'); if (this.gearScroll) pb.scrollTop = this.gearScroll;
  }
  getSel() { const S = this.g.save; const s = this.sel; if (!s) return null; if (s.src === 'inv') return S.inv[s.i] || null; const k = s.k; if (k.startsWith('art')) return S.equip.art[+k[3]]; return S.equip[k] || null; }
  detailHTML(it, smith, shopBtn) {
    if (!it) return `<div class="detail" style="color:#8e98c8">Select an item to see details.${smith ? '<br><br>Upgrade gear to boost its stats, or reforge to roll new enchantments.' : ''}</div>`;
    const g = this.g, S = g.save; const R = RARITY[it.rarity]; const E = S.equip;
    const eqd = it.slot === 'artifact' ? null : E[it.slot]; let lines = describeItem(it);
    const cmp = (v, ev) => { if (ev === undefined || !eqd || eqd === it) return ''; const d = v - ev; return d > 0.5 ? ` <span class="up-arrow">▲${Math.round(d)}</span>` : d < -0.5 ? ` <span class="down-arrow">▼${Math.round(-d)}</span>` : ''; };
    let stats = '';
    if (WEAPONS[it.type]) { const d = itemDamage(it); stats += `<div class="stat"><span>Damage</span><b>${Math.round(d)}${cmp(d, eqd && WEAPONS[eqd.type] ? itemDamage(eqd) : undefined)}</b></div><div class="stat"><span>Speed</span><b>${itemRate(it).toFixed(1)}/s</b></div><div class="stat"><span>Crit</span><b>${Math.round(itemCrit(it) * 100)}%</b></div><div class="stat"><span>DPS</span><b>${Math.round(d * itemRate(it))}${cmp(d * itemRate(it), eqd && WEAPONS[eqd.type] ? itemDamage(eqd) * itemRate(eqd) : undefined)}</b></div>`; }
    else if (it.type === 'armor') { const a = armorStats(it), e = eqd ? armorStats(eqd) : null; stats += `<div class="stat"><span>Health</span><b>+${a.hp}${cmp(a.hp, e ? e.hp : undefined)}</b></div><div class="stat"><span>Defense</span><b>${a.def}${cmp(a.def, e ? e.def : undefined)}</b></div>`; }
    else { const a = ARTIFACTS[it.art]; stats += `<div class="stat"><span>Power</span><b>${Math.round(artifactPower(it) * 100)}%</b></div><div class="stat"><span>Cooldown</span><b>${a.cd}s</b></div><div style="color:#aab4e8;font-size:17px;margin-top:3px">${a.desc}</div>`; }
    const ench = it.enchants.map((k) => `<div class="ench" style="color:${ENCH[k].css}">◆ ${ENCH[k].name}<br><i>${ENCH[k].desc}</i></div>`).join('');
    const perks = it.perks.map((k) => `<div class="ench" style="color:#9ad8ff">◆ ${PERKS[k].name}<br><i>${PERKS[k].desc}</i></div>`).join('');
    const isEq = !shopBtn && this.sel && this.sel.src === 'eq'; let btns = '';
    if (shopBtn) btns = shopBtn;
    else if (!smith) {
      if (!isEq) btns += `<div class="btn sm" data-act="equip">EQUIP</div> <div class="btn sm gold" data-act="sell">SELL 💎${itemValue(it)}</div>`;
      else if (it.slot === 'artifact') btns += `<div class="btn sm" data-act="unequip">UNEQUIP</div>`;
    } else {
      const c = upgradeCost(it); const maxed = it.upgrade >= MAX_UPGRADE;
      btns += `<div class="btn sm ${maxed || S.emeralds < c ? 'dis' : 'gold'}" data-act="upgrade">${maxed ? 'MAX' : `UPGRADE 💎${c}`}</div> `;
      if (it.slot !== 'artifact' && (it.enchants.length || it.perks.length)) { const rc = Math.round(c * 0.9); btns += `<div class="btn sm ${S.emeralds < rc ? 'dis' : ''}" data-act="reforge">REFORGE 💎${rc}</div> `; }
      if (!isEq) btns += `<div class="btn sm tiny gold" data-act="sell">SELL 💎${itemValue(it)}</div>`;
    }
    return `<div class="detail"><h3 class="${it.rarity}-t">${it.name}${it.upgrade ? ' +' + it.upgrade : ''}</h3><div class="sub">${R.name} ${it.slot === 'armor' ? 'Armor' : it.slot === 'artifact' ? 'Artifact' : WEAPONS[it.type].name} · Lv ${it.level}${it.lore ? `<br><i>"${it.lore}"</i>` : ''}</div>${stats}${ench}${perks}<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${btns}</div></div>`;
  }

  // ---- merchant
  showMerchant() {
    const g = this.g, S = g.save; if (!S.stock) S.stock = genStock(S.level);
    const sel = this.msel === undefined ? null : S.stock[this.msel];
    const rc = 40 + S.level * 6;
    const html = `<div class="row" style="align-items:flex-start"><div style="flex:1"><div class="grid">${S.stock.map((it, i) => it ? cellHTML(it, this.msel === i ? 'sel' : '', `data-act="msel" data-i="${i}"`) : `<div class="cell empty"><span class="lbl">SOLD</span></div>`).join('')}</div>
      <div style="margin-top:10px"><div class="btn sm" data-act="reroll">REROLL STOCK 💎${rc}</div></div></div>
      <div style="width:240px;flex:0 0 240px">${sel ? this.merchDetail(sel) : '<div class="detail" style="color:#8e98c8">"Finest wares this side of the Void! Pick something."<br><br>— Brix, Merchant</div>'}</div></div>`;
    this.openModal('MERCHANT', html, { name: 'merchant', width: 860 });
  }
  merchDetail(it) {
    const S = this.g.save; const price = itemPrice(it);
    return this.detailHTML(it, false, `<div class="btn sm ${S.emeralds < price ? 'dis' : 'gold'}" data-act="buy">BUY 💎${price}</div>`);
  }

  // ---- missions
  showMissions() {
    const g = this.g, S = g.save; const unlocked = (i) => i === 0 || S.done[MISSIONS[i - 1].id] !== undefined;
    if (this.msn === undefined) { this.msn = MISSIONS.findIndex((m) => S.done[m.id] === undefined); if (this.msn < 0) this.msn = MISSIONS.length - 1; }
    const m = MISSIONS[this.msn]; const done = S.done[m.id]; const maxThreat = done === undefined ? 0 : Math.min(THREATS.length - 1, done + 1);
    if (this.threatSel === undefined || this.threatSel > maxThreat) this.threatSel = 0;
    const th = THREATS[this.threatSel]; const rl = m.level + th.lvl;
    const cards = MISSIONS.map((mm, i) => `<div class="mcard ${i === this.msn ? 'sel' : ''} ${unlocked(i) ? '' : 'lock'}" data-act="msn" data-i="${i}"><div class="dot" style="background:${mm.color}">${i + 1}</div><div><div class="nm">${mm.name}</div><div class="meta">${unlocked(i) ? `Recommended level ${mm.level}` : 'Locked — finish the previous mission'}</div></div>${S.done[mm.id] !== undefined ? '<div class="chk">✔</div>' : ''}</div>`).join('');
    const warn = S.level < rl - 3;
    const html = `<div class="row" style="align-items:flex-start"><div style="width:44%;flex:0 0 44%">${cards}</div>
      <div style="flex:1"><div class="detail"><h3 style="color:${m.color}">${m.name}</h3><div class="sub">${({ meadow: 'Sunlit Meadows', crypt: 'Forgotten Crypt', sands: 'Scorched Sanctum', frost: 'Frozen Hollow', inferno: 'Molten Depths', void: 'The Void' })[m.biome]} · Level ${rl} ${warn ? '<span style="color:#ff7a7a">⚠ dangerous</span>' : ''}</div>
        <div style="font-size:19px;margin-bottom:6px">${m.brief}</div>
        ${m.objectives.map((o) => `<div class="ench">▸ ${o.text}${o.n ? ' (' + o.n + ')' : ''}</div>`).join('')}
        ${maxThreat > 0 ? `<div class="threat">${THREATS.slice(0, maxThreat + 1).map((t, i) => `<div class="tab ${this.threatSel === i ? 'on' : ''}" data-act="threat" data-i="${i}">${t.name}</div>`).join('')}</div><div class="sub">Loot ×${th.loot} · Enemies tougher</div>` : ''}
        <div style="margin-top:10px"><div class="btn big ${unlocked(this.msn) ? '' : 'dis'}" style="min-width:0;width:100%" data-act="start">▶ START MISSION</div></div></div></div></div>`;
    this.openModal('MISSION MAP', html, { name: 'missions', width: 900, showEm: true });
  }

  // ---- quests
  claimable() { const st = this.g.save.quests.stats; st.level = this.g.save.level; return QUESTS.filter((q) => !this.g.save.quests.claimed[q.id] && (st[q.stat] || 0) >= q.goal).length; }
  showQuests() {
    const g = this.g, S = g.save, st = S.quests.stats; st.level = S.level;
    const nextM = MISSIONS.find((m) => S.done[m.id] === undefined);
    const storyHtml = nextM ? `<div class="story"><b>MAIN QUEST</b><br>Next: <span style="color:${nextM.color}">${nextM.name}</span> — ${nextM.objectives.map((o) => o.text).join(', ')}.</div>` : `<div class="story"><b>MAIN QUEST COMPLETE</b><br>The dead sleep. Take on higher Adventure threats for greater loot!</div>`;
    const list = QUESTS.slice().sort((a, b) => { const ca = S.quests.claimed[a.id] ? 2 : (st[a.stat] || 0) >= a.goal ? 0 : 1; const cb = S.quests.claimed[b.id] ? 2 : (st[b.stat] || 0) >= b.goal ? 0 : 1; return ca - cb; });
    const html = storyHtml + list.map((q) => { const v = Math.min(q.goal, st[q.stat] || 0); const claimed = S.quests.claimed[q.id]; const ready = v >= q.goal && !claimed;
      return `<div class="quest ${ready ? 'done' : ''}" style="${claimed ? 'opacity:.5' : ''}"><div class="info"><div class="nm">${q.name}</div><div class="ds">${q.desc} <span style="color:#8e98c8">(${fmt(v)}/${fmt(q.goal)})</span></div><div class="pb"><i style="width:${v / q.goal * 100}%"></i></div></div><div class="rw">◆ ${q.reward.em}${q.reward.xp ? `<br>XP ${q.reward.xp}` : ''}${q.reward.item ? '<br><span style="color:#ffb02e">+ Gear</span>' : ''}</div>${claimed ? '<div class="chk" style="color:#46f098;font-family:PS2P">✔</div>' : `<div class="btn sm ${ready ? 'gold' : 'dis'}" data-act="claim" data-id="${q.id}">CLAIM</div>`}</div>`; }).join('');
    this.openModal('QUEST BOARD', html, { name: 'quests', width: 760 });
  }

  // ---- settings / pause
  showSettings(fromPause) {
    const S = this.g.save.settings;
    const html = `<div class="slider"><span style="width:130px">Sound FX</span><input type="range" min="0" max="100" value="${Math.round(S.sfx * 100)}" data-s="sfx"></div>
      <div class="slider"><span style="width:130px">Music</span><input type="range" min="0" max="100" value="${Math.round(S.mus * 100)}" data-s="mus"></div>
      <div class="tabs" style="margin-top:12px"><span style="width:130px;font-size:22px;align-self:center">Graphics</span>${['auto', 'high', 'medium', 'low'].map((q) => `<div class="tab ${S.quality === q ? 'on' : ''}" data-act="quality" data-q="${q}">${q.toUpperCase()}</div>`).join('')}</div>
      <div class="tabs"><span style="width:130px;font-size:22px;align-self:center">Vibration</span><div class="tab ${S.vibrate ? 'on' : ''}" data-act="vib">${S.vibrate ? 'ON' : 'OFF'}</div></div>
      <div class="tabs"><span style="width:130px;font-size:22px;align-self:center">Controls</span><div class="tab ${S.left ? 'on' : ''}" data-act="lefty">${S.left ? 'LEFT-HANDED' : 'RIGHT-HANDED'}</div></div>
      <div class="tabs" style="margin-top:14px"><div class="btn sm red" data-act="reset">${this.resetArm ? 'TAP AGAIN TO ERASE SAVE' : 'RESET PROGRESS'}</div></div>`;
    this.openModal('OPTIONS', html, { name: 'settings', width: 560, showEm: false });
    this.modalRoot.querySelectorAll('input[type=range]').forEach((el) => el.addEventListener('input', () => { const v = +el.value / 100; S[el.dataset.s] = v; A.setVolumes(S.sfx, S.mus); scheduleSave(this.g.save); }));
    this.modalRoot.querySelectorAll('input[type=range]').forEach((el) => el.addEventListener('change', () => A.sfx('click')));
    this.settingsFromPause = !!fromPause;
  }
  showPause() {
    if (this.modal) return; A.sfx('open');
    this.openModal('PAUSED', `<div class="col" style="align-items:center;gap:12px;padding:10px"><div class="btn big" data-act="resume">▶ RESUME</div><div class="btn" data-act="settingsp">OPTIONS</div><div class="btn red" data-act="abandon">ABANDON MISSION</div></div>`, { name: 'pause', width: 420, showEm: false });
  }
  showDeath() {
    const g = this.g; if (this.modal) this.closeModal(true);
    const cost = 60 * g.mlevel, can = g.save.emeralds >= cost;
    this.openModal('YOU HAVE FALLEN', `<div class="col" style="align-items:center;gap:12px;padding:8px"><div class="res-title res-lose">DEFEATED</div><div style="font-size:21px;text-align:center">Revive on the spot and fight on, or retreat to camp. You keep everything you looted.</div><div class="btn big ${can ? 'gold' : 'dis'}" data-act="revive">REVIVE 💎${cost}</div><div class="btn" data-act="giveup">RETREAT TO CAMP</div></div>`, { name: 'death', width: 480, noClose: true });
  }
  showResults(win, items, bonusEm) {
    const g = this.g, R = g.run; if (this.modal) this.closeModal(true);
    const mins = Math.floor(R.time / 60), secs = Math.floor(R.time % 60);
    const html = `<div class="res-title ${win ? 'res-win' : 'res-lose'}">${win ? 'MISSION COMPLETE!' : 'MISSION FAILED'}</div>
      <div class="res-stats"><div><span>Enemies slain</span><b>${R.kills}</b></div><div><span>Time</span><b>${mins}:${String(secs).padStart(2, '0')}</b></div><div><span>Experience</span><b>+${fmt(R.xp)}</b></div><div><span>Emeralds</span><b style="color:#46f098">+${fmt(R.em)}</b></div><div><span>Items found</span><b>${R.items.length}</b></div><div><span>Level</span><b>${g.save.level}${g.save.level > R.startLevel ? ' ▲' : ''}</b></div></div>
      ${R.items.length ? `<div style="text-align:center;margin-bottom:6px;font-size:18px;color:#8e98c8">Loot</div><div class="grid" style="max-width:520px;margin:0 auto 10px;grid-template-columns:repeat(auto-fill,minmax(52px,1fr))">${R.items.slice(-16).map((it) => cellHTML(it)).join('')}</div>` : ''}
      <div style="text-align:center"><div class="btn big" data-act="home">RETURN TO CAMP</div></div>`;
    this.openModal(win ? 'VICTORY' : 'DEFEAT', html, { name: 'results', width: 640, noClose: true, showEm: false });
    if (win) { const m = g.mission; setTimeout(() => this.toast(m.outro, 'story'), 600); }
    writeSave(g.save);
  }
  showDialog(lines, cb) {
    let i = 0; const el = document.createElement('div'); el.className = 'dlg';
    const render = () => { el.innerHTML = `<div class="who">ELDER MAREN</div><div>${lines[i]}</div><div class="nx"><div class="btn sm" data-dlg>NEXT ▶</div></div>`; };
    render(); this.root.appendChild(el); this.g.paused = true;
    el.addEventListener('click', () => { A.sfx('click'); i++; if (i >= lines.length) { el.remove(); this.g.paused = false; cb && cb(); } else render(); });
  }

  // ------------------------------------------------------------ actions
  act(a, d, el) {
    const g = this.g, S = g.save;
    switch (a) {
      case 'play': this.startGame(); return;
      case 'newgame': if (!this.newArm) { this.newArm = true; el.textContent = 'TAP AGAIN: ERASE'; setTimeout(() => { this.newArm = false; el.textContent = 'NEW GAME'; }, 2500); return; } wipeSave(); location.reload(); return;
      case 'close': A.sfx('click'); this.closeModal(); this.updateBadge(); return;
      case 'tab': A.sfx('click'); this.tab = d.t; this.gearScroll = $('.pbody').scrollTop; this.showGear(); return;
      case 'filter': A.sfx('click'); this.filter = d.f; this.showGear(); return;
      case 'seli': A.sfx('click'); this.sel = { src: 'inv', i: +d.i }; this.gearScroll = $('.pbody').scrollTop; this.showGear(); return;
      case 'selq': A.sfx('click'); this.sel = { src: 'eq', k: d.k }; this.gearScroll = $('.pbody').scrollTop; this.showGear(); return;
      case 'equip': this.equipSel(); return;
      case 'unequip': { const it = this.getSel(); const k = this.sel.k; if (it && k.startsWith('art')) { S.equip.art[+k[3]] = null; S.inv.push(it); this.sel = null; this.afterGearChange(); } return; }
      case 'sell': { const it = this.getSel(); if (!it) return; const v = itemValue(it); if (this.sel.src === 'inv') { S.inv.splice(this.sel.i, 1); S.emeralds += v; A.sfx('buy'); this.toast(`Sold ${it.name} for ◆${v}`, 'good'); this.sel = null; this.afterGearChange(); } return; }
      case 'upgrade': { const it = this.getSel(); if (!it || it.upgrade >= MAX_UPGRADE) return; const c = upgradeCost(it); if (S.emeralds < c) { A.sfx('deny'); return; } S.emeralds -= c; it.upgrade++; g.stat('upgrades', 1); A.sfx('upgrade'); this.toast(`${it.name} upgraded to +${it.upgrade}!`, 'good'); this.afterGearChange(); return; }
      case 'reforge': { const it = this.getSel(); if (!it) return; const c = Math.round(upgradeCost(it) * 0.9); if (S.emeralds < c) { A.sfx('deny'); return; } S.emeralds -= c;
        if (it.slot === 'armor') { const pk = Object.keys(PERKS).filter((k) => !it.perks.includes(k)); if (it.perks.length) it.perks[Math.floor(Math.random() * it.perks.length)] = pk[Math.floor(Math.random() * pk.length)]; }
        else { const pool = ENCH_KEYS.filter((k) => !it.enchants.includes(k)); if (it.enchants.length) it.enchants[Math.floor(Math.random() * it.enchants.length)] = pool[Math.floor(Math.random() * pool.length)]; it.glow = ENCH[it.enchants[0]].color; if (it.fixed) { it.fixed = false; } }
        A.sfx('upgrade'); this.toast('Reforged!', 'good'); this.afterGearChange(); return; }
      case 'msel': A.sfx('click'); this.msel = +d.i; this.showMerchant(); return;
      case 'buy': { const it = S.stock[this.msel]; if (!it) return; const pr = itemPrice(it); if (S.emeralds < pr) { A.sfx('deny'); return; } if (S.inv.length >= 48) { A.sfx('deny'); this.toast('Inventory full', 'warn'); return; } S.emeralds -= pr; S.inv.push(it); S.stock[this.msel] = null; this.msel = undefined; A.sfx('buy'); this.toast(`Bought ${it.name}`, it.rarity); scheduleSave(S); this.showMerchant(); return; }
      case 'reroll': { const c = 40 + S.level * 6; if (S.emeralds < c) { A.sfx('deny'); return; } S.emeralds -= c; S.stock = genStock(S.level, g.player.stats.luck); this.msel = undefined; A.sfx('buy'); this.showMerchant(); return; }
      case 'msn': A.sfx('click'); this.msn = +d.i; this.threatSel = 0; this.showMissions(); return;
      case 'threat': A.sfx('click'); this.threatSel = +d.i; this.showMissions(); return;
      case 'start': { const unlocked = this.msn === 0 || S.done[MISSIONS[this.msn - 1].id] !== undefined; if (!unlocked) { A.sfx('deny'); return; } A.sfx('portal'); this.closeModal(true); g.paused = false; this.hud.classList.add('hide'); g.eng.fadeTo(1, 1.5); const mi = this.msn, th = this.threatSel; setTimeout(() => { g.startMission(MISSIONS[mi], th); }, 700); return; }
      case 'claim': { const q = QUESTS.find((x) => x.id === d.id); if (!q || S.quests.claimed[q.id]) return; S.quests.claimed[q.id] = true; S.emeralds += q.reward.em; g.stat('emTotal', 0); if (q.reward.xp) g.addXp(q.reward.xp); if (q.reward.item) { const it = rollItem(S.level + 1, Object.assign({ bonus: 0 }, q.reward.item)); g.addItem(it); this.toast('Reward: ' + it.name, it.rarity); } A.sfx('loot'); scheduleSave(S); this.updateBadge(); this.showQuests(); return; }
      case 'quality': A.sfx('click'); S.settings.quality = d.q; this.applyQuality(); this.showSettings(this.settingsFromPause); return;
      case 'vib': S.settings.vibrate = !S.settings.vibrate; A.sfx('click'); if (S.settings.vibrate) g.vibrate(30); this.showSettings(this.settingsFromPause); return;
      case 'lefty': S.settings.left = !S.settings.left; document.body.classList.toggle('lefty', S.settings.left); A.sfx('click'); this.showSettings(this.settingsFromPause); return;
      case 'reset': if (!this.resetArm) { this.resetArm = true; this.showSettings(this.settingsFromPause); return; } wipeSave(); location.reload(); return;
      case 'resume': A.sfx('click'); this.closeModal(); return;
      case 'settingsp': A.sfx('click'); this.showSettings(true); return;
      case 'abandon': A.sfx('click'); this.closeModal(true); g.paused = false; this.hud.classList.add('hide'); g.mode = 'loading'; g.eng.fadeTo(1, 1.5); setTimeout(() => { g.loadCamp(); }, 700); return;
      case 'revive': if (g.revivePlayer()) { A.sfx('heal'); this.closeModal(); } else A.sfx('deny'); return;
      case 'giveup': this.closeModal(true); g.paused = false; g.failMission(); return;
      case 'home': A.sfx('click'); this.closeModal(true); g.paused = false; this.hud.classList.add('hide'); g.eng.fadeTo(1, 2); setTimeout(() => { g.loadCamp(); }, 500); return;
    }
  }
  afterGearChange() { const g = this.g; g.player.recalc(g.save); this.refreshArtifactButtons(); scheduleSave(g.save); this.gearScroll = $('.pbody') ? $('.pbody').scrollTop : 0; this.showGear(); this.updateBadge(); }
  equipSel() {
    const g = this.g, S = g.save, it = this.getSel(); if (!it || this.sel.src !== 'inv') return; A.sfx('open');
    S.inv.splice(this.sel.i, 1);
    if (it.slot === 'artifact') {
      let k = S.equip.art.findIndex((a) => !a); if (k < 0) k = S.equip.art.findIndex((a) => a && a.art === it.art); if (k < 0) k = 0;
      if (S.equip.art[k]) S.inv.push(S.equip.art[k]); S.equip.art[k] = it; this.sel = { src: 'eq', k: 'art' + k };
    } else { const old = S.equip[it.slot]; if (old) S.inv.push(old); S.equip[it.slot] = it; this.sel = { src: 'eq', k: it.slot }; }
    this.toast('Equipped ' + it.name, it.rarity); this.afterGearChange();
  }
  applyQuality() {
    const q = this.g.save.settings.quality; const e = this.g.eng;
    if (q === 'auto') { e.manualQuality = false; if (!e.quality) e.setQuality('high'); } else { e.manualQuality = true; e.resScale = q === 'low' ? 0.75 : 1; e.setQuality(q); e.onResize(); }
    e.setBiome(e.biome);
    scheduleSave(this.g.save);
  }
  startGame() {
    const g = this.g, S = g.save; A.unlock(); A.setVolumes(S.settings.sfx, S.settings.mus); A.sfx('click');
    this.title.classList.add('hide'); this.mode = 'hud'; g.titleMode = false;
    A.music('camp');
    if (!S.seenIntro) { S.seenIntro = true; this.showDialog(['Welcome to camp, Delver! I am Elder Maren. The dead have begun to rise across the realm — from meadows to the Void itself.', 'Walk to the glowing <b style="color:#ffd23a">Mission Map</b> to set out. Visit the <b style="color:#6aff9a">Blacksmith</b> to upgrade gear and the <b style="color:#6aff9a">Merchant</b> for new wares.', 'Slay the undead, loot chests, smash crates, and grow stronger. The realm is counting on you!']); }
  }
}
