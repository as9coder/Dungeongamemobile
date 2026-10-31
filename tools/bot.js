// Test bot injected into the page: window.__bot.start()
window.__botCode = function () {
  const g = window.__game, ui = window.__ui, eng = window.__eng;
  const bot = { on: true, t: 0, stuck: 0, log: [], lastPos: null };
  window.__bot = bot;
  const U = { x: 0, y: 0, z: 0 };
  function move(wx, wz) {
    eng.screenUp({ set(x, y, z) { U.x = x; U.z = z; return this; }, x: 0, y: 0, z: 0 });
  }
  function toStick(wx, wz) {
    const v = new (g.eng.camera.position.constructor)(); eng.screenUp(v); const ux = v.x, uz = v.z, rx = -uz, rz = ux;
    const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
    return { x: wx * rx + wz * rz, z: -(wx * ux + wz * uz) };
  }
  setInterval(() => {
    if (!bot.on || g.paused || g.mode !== 'mission' || !g.level) return;
    const p = g.player; if (p.dead) { ui.joyVec = null; return; }
    bot.t += 0.05; const L = g.level;
    const aggro = g.enemies.filter((e) => !e.dead && e.aggro && Math.hypot(e.x - p.x, e.z - p.z) < 16);
    let target = null, td = 1e9;
    for (const e of g.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < td && (aggro.length === 0 || e.aggro)) { td = d; target = e; } }
    let goal = null; let attackNow = false; let shoot = false;
    if (g.exitPortal) goal = g.exitPortal;
    else if (aggro.length && target) { goal = target; attackNow = true; }
    else {
      // objective targets
      const sp = g.spawners.find((s) => !s.dead); const bc = g.beacons.find((b) => !b.done);
      const ch = L.chests.find((c) => !c.opened);
      if (sp && g.objs.some((o) => o.type === 'spawners' && !o.done)) goal = sp;
      else if (bc && g.objs.some((o) => o.type === 'beacons' && !o.done)) goal = bc;
      else if (g.pickups.some((k) => !(k.kind === 'heart' && p.hp >= p.maxHp))) goal = g.pickups.find((k) => !(k.kind === 'heart' && p.hp >= p.maxHp));
      else if (g.boss && g.objs.every((o) => o.type === 'boss' || o.done)) goal = g.boss;
      else if (ch && Math.hypot(ch.x - p.x, ch.z - p.z) < 30 && Math.hypot(ch.x - p.x, ch.z - p.z) > 2.2) goal = ch;
      else if (target) goal = target;
      if (target && td < 8) { attackNow = true; }
    }
    if (!goal) { ui.joyVec = null; return; }
    bot.goal = (goal.kind || goal.type || (goal.isSpawner ? 'spawner' : goal.id || 'x')) + '@' + goal.x.toFixed(1) + ',' + goal.z.toFixed(1) + ' attack=' + attackNow;
    const gd = Math.hypot(goal.x - p.x, goal.z - p.z);
    let dx = goal.x - p.x, dz = goal.z - p.z;
    if (!L.los(p.x, p.z, goal.x, goal.z) || gd > 4) {
      L.computeFlow(goal.x, goal.z); const o = { x: 0, z: 0 }; if (L.flowDir(p.x, p.z, o)) { dx = o.x; dz = o.z; } L.computeFlow(p.x, p.z);
    }
    const stopDist = attackNow ? (g.player.melee && g.player.melee.type === 'spear' ? 3.2 : 1.8) : (goal.isSpawner ? 2.2 : (goal === g.boss ? 2.0 : 0.3));
    if (gd > stopDist || !attackNow && !goal.isSpawner) ui.joyVec = (gd > stopDist ? toStick(dx, dz) : null); else ui.joyVec = null;
    if (goal.isSpawner && gd < 3) { ui.joyVec = null; attackNow = true; }
    if (goal === g.boss && gd < 3) { ui.joyVec = null; attackNow = true; }
    if (g.beacons.length && !attackNow) { const bc = g.beacons.find((b) => !b.done); if (bc && Math.hypot(bc.x - p.x, bc.z - p.z) < 1.8) ui.joyVec = null; }
    ui.held.atk = attackNow && (gd < 3.4 || goal.isSpawner);
    ui.held.shoot = attackNow && gd > 4 && gd < 14;
    if (attackNow && Math.random() < 0.02) g.input.rollPressed = true;
    if (attackNow && Math.random() < 0.05) { g.input.art[Math.floor(Math.random() * 3)] = true; }
    if (p.hp / p.maxHp < 0.45) g.input.potionPressed = true;
    // stuck detection
    if (bot.lastPos && Math.hypot(bot.lastPos.x - p.x, bot.lastPos.z - p.z) < 0.02 && ui.joyVec) bot.stuck += 0.05; else bot.stuck = 0;
    bot.lastPos = { x: p.x, z: p.z };
    if (bot.stuck > 2) { bot.stuck = 0; bot.log.push('stuck at ' + p.x.toFixed(1) + ',' + p.z.toFixed(1) + ' goal ' + bot.goal); g.input.rollPressed = true; }
  }, 50);
};
