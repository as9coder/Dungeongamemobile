import { rollItem } from './data.js';

const KEY = 'voxel_delvers_save_v1';

export function newSave() {
  return {
    v: 1, level: 1, xp: 0, emeralds: 80, inv: [],
    equip: {
      melee: { id: 's0', slot: 'melee', type: 'sword', variant: 0, tier: 0, name: 'Rusty Shortsword', rarity: 'common', level: 1, upgrade: 0, enchants: [], perks: [] },
      ranged: { id: 's1', slot: 'ranged', type: 'bow', variant: 0, tier: 0, name: 'Rusty Shortbow', rarity: 'common', level: 1, upgrade: 0, enchants: [], perks: [] },
      armor: { id: 's2', slot: 'armor', type: 'armor', look: 'cloth', setIdx: 0, name: "Wanderer's Garb", rarity: 'common', level: 1, upgrade: 0, enchants: [], perks: [] },
      art: [{ id: 's3', slot: 'artifact', type: 'artifact', art: 'flame', name: 'Dragon Breath', rarity: 'rare', level: 1, upgrade: 0, enchants: [], perks: [] }, null, null],
    },
    done: {}, // missionId -> highest threat index completed
    quests: { stats: {}, claimed: {} },
    settings: { sfx: 0.8, mus: 0.55, quality: 'auto', vibrate: true, left: false },
    stock: null, seenIntro: false, playTime: 0, runs: 0,
  };
}

export function loadSave() {
  let raw = null;
  try { if (window.AndroidBridge) raw = window.AndroidBridge.load(KEY); } catch (e) { /* ignore */ }
  if (!raw) { try { raw = localStorage.getItem(KEY); } catch (e) { /* ignore */ } }
  if (raw) {
    try {
      const s = JSON.parse(raw); const base = newSave();
      return Object.assign(base, s, { settings: Object.assign(base.settings, s.settings || {}), quests: Object.assign(base.quests, s.quests || {}) });
    } catch (e) { /* corrupted */ }
  }
  return newSave();
}

let saveTimer = 0;
export function writeSave(s) {
  const raw = JSON.stringify(s);
  try { if (window.AndroidBridge) window.AndroidBridge.save(KEY, raw); } catch (e) { /* ignore */ }
  try { localStorage.setItem(KEY, raw); } catch (e) { /* ignore */ }
}
export function scheduleSave(s) { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeSave(s), 400); }
export function wipeSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } try { if (window.AndroidBridge) window.AndroidBridge.save(KEY, ''); } catch (e) { /* ignore */ } }

export function genStock(level, luck = 0) {
  const out = [];
  const slots = ['melee', 'melee', 'ranged', 'armor', 'armor', 'artifact', 'melee', 'ranged'];
  slots.forEach((slot, i) => { out.push(rollItem(Math.max(1, level + (i % 3) - 1), { slot, bonus: 0.12 + luck })); });
  return out;
}
