import { RNG, rr, ri, pick, clamp, weightedPick } from './util.js';
import { TIERS, LOOKS } from './voxel.js';

// ============================================================ rarity / enchants
export const RARITY = {
  common: { id: 'common', name: 'Common', color: '#d5dbe3', css: 'common', mult: 1.0, slots: 0, perks: 0 },
  rare: { id: 'rare', name: 'Rare', color: '#5ee08a', css: 'rare', mult: 1.22, slots: 1, perks: 1 },
  unique: { id: 'unique', name: 'Unique', color: '#ffb02e', css: 'unique', mult: 1.5, slots: 2, perks: 2 },
};

export const ENCH = {
  fire: { name: 'Flame Touch', color: 0xff7a20, css: '#ff8a3a', desc: 'Sets enemies ablaze for damage over time.' },
  frost: { name: 'Frostbite', color: 0x7fe0ff, css: '#7fe0ff', desc: 'Chills enemies, slowing or freezing them.' },
  shock: { name: 'Thunder Chain', color: 0xfff06a, css: '#fff06a', desc: 'Hits arc lightning to nearby foes.' },
  venom: { name: 'Venom', color: 0x6aff6a, css: '#6aff6a', desc: 'Poisons enemies with a lingering toxin.' },
  vamp: { name: 'Soul Siphon', color: 0xff4a7a, css: '#ff6a8a', desc: 'Heals you for a share of damage dealt.' },
  sharp: { name: 'Sharpness', color: 0xffffff, css: '#ffffff', desc: '+18% damage.' },
  crit: { name: 'Deadly Edge', color: 0xffd23a, css: '#ffd23a', desc: '+18% critical chance.' },
  boom: { name: 'Blast', color: 0xff9a3a, css: '#ffa23a', desc: 'Hits detonate in a small explosion.' },
  swift: { name: 'Swiftness', color: 0x9aff9a, css: '#9aff9a', desc: '+22% attack speed.' },
  gravity: { name: 'Gravity Well', color: 0xb08aff, css: '#b08aff', desc: 'Hits pull nearby enemies together.' },
};
export const ENCH_KEYS = Object.keys(ENCH);

export const PERKS = {
  hp: { name: 'Vitality', desc: '+12% max health' },
  roll: { name: 'Nimble', desc: 'Longer, faster rolls' },
  cd: { name: 'Arcane Flow', desc: 'Artifacts recharge 18% faster' },
  thorns: { name: 'Thorns', desc: 'Reflect 40% of melee damage taken' },
  regen: { name: 'Regeneration', desc: 'Regain health slowly over time' },
  potion: { name: 'Alchemist', desc: 'Potions heal 40% more' },
  speed: { name: 'Fleet', desc: '+8% movement speed' },
  luck: { name: 'Fortune', desc: '+30% emeralds, better loot' },
  dmg: { name: 'Might', desc: '+10% damage' },
};
const PERK_KEYS = Object.keys(PERKS);

// ============================================================ weapon & armor bases
export const WEAPONS = {
  sword: { slot: 'melee', name: 'Sword', dmg: 20, rate: 2.3, range: 2.9, arc: 2.0, kb: 3.5, combo: 3, crit: 0.08, names: ['Shortsword', 'Longsword', 'Claymore', 'Gladius'], desc: 'Balanced. 3-hit combo.' },
  dagger: { slot: 'melee', name: 'Dagger', dmg: 10, rate: 3.6, range: 2.2, arc: 1.6, kb: 1.5, combo: 4, crit: 0.22, names: ['Dirk', 'Stiletto', 'Kris', 'Fang'], desc: 'Very fast. High crit chance.' },
  axe: { slot: 'melee', name: 'Axe', dmg: 34, rate: 1.55, range: 3.0, arc: 2.6, kb: 5.5, combo: 2, crit: 0.08, names: ['Hatchet', 'Cleaver', 'Battleaxe', 'Reaver'], desc: 'Heavy cleave with wide arc.' },
  hammer: { slot: 'melee', name: 'Hammer', dmg: 52, rate: 1.0, range: 3.2, arc: 6.28, kb: 8, combo: 1, crit: 0.05, names: ['Mallet', 'Maul', 'Warhammer', 'Crusher'], desc: 'Slow ground-slam in all directions.' },
  spear: { slot: 'melee', name: 'Spear', dmg: 26, rate: 1.8, range: 4.6, arc: 0.7, kb: 4, combo: 2, crit: 0.1, names: ['Pike', 'Glaive', 'Halberd', 'Lance'], desc: 'Long reach thrusts pierce lines.' },
  bow: { slot: 'ranged', name: 'Bow', dmg: 18, rate: 1.6, range: 22, arc: 0, kb: 1.5, pierce: 0, speed: 30, crit: 0.1, names: ['Shortbow', 'Longbow', 'Recurve', 'Hunter Bow'], desc: 'Fast arrows. Hold to keep firing.' },
  crossbow: { slot: 'ranged', name: 'Crossbow', dmg: 34, rate: 0.85, range: 24, arc: 0, kb: 3, pierce: 2, speed: 40, crit: 0.12, names: ['Light Crossbow', 'Heavy Crossbow', 'Repeater', 'Ballista'], desc: 'Powerful bolts that pierce.' },
};
export const MELEE_TYPES = ['sword', 'dagger', 'axe', 'hammer', 'spear'];
export const RANGED_TYPES = ['bow', 'crossbow'];

export const ARMOR_SETS = [
  { look: 'cloth', name: "Wanderer's Garb", minLevel: 1, hp: 16, def: 6 },
  { look: 'leather', name: "Hunter's Leathers", minLevel: 2, hp: 22, def: 10 },
  { look: 'chain', name: "Guardian's Mail", minLevel: 5, hp: 30, def: 16 },
  { look: 'plate', name: 'Knight Plate', minLevel: 8, hp: 38, def: 22 },
  { look: 'gilded', name: 'Gilded Vanguard', minLevel: 11, hp: 46, def: 28 },
  { look: 'crystal', name: 'Crystalweave', minLevel: 14, hp: 54, def: 34 },
  { look: 'obsidian', name: 'Obsidian Warplate', minLevel: 17, hp: 62, def: 40 },
  { look: 'inferno', name: 'Infernal Regalia', minLevel: 20, hp: 70, def: 46 },
];

export const ARTIFACTS = {
  flame: { name: 'Dragon Breath', icon: '🔥', cd: 14, color: '#ff8a3a', desc: 'Unleash a cone of searing flame.' },
  thunder: { name: 'Storm Rod', icon: '⚡', cd: 16, color: '#fff06a', desc: 'Call chain lightning on up to 6 foes.' },
  frost: { name: 'Frost Nova', icon: '❄', cd: 18, color: '#7fe0ff', desc: 'Freeze everything around you.' },
  totem: { name: 'Soul Totem', icon: '✚', cd: 24, color: '#6aff9a', desc: 'Plant a totem that heals and empowers you.' },
  meteor: { name: 'Meteor Sigil', icon: '☄', cd: 22, color: '#ff5a3a', desc: 'Rain meteors on the densest enemy pack.' },
  whirl: { name: 'Blade Cyclone', icon: '✦', cd: 15, color: '#d0e0ff', desc: 'Spin into a whirling storm of blades.' },
};
export const ARTIFACT_KEYS = Object.keys(ARTIFACTS);

// ============================================================ item generation
let _uid = 1;
const UNIQUES = [
  { name: 'Emberfang', type: 'sword', variant: 1, tier: 5, ench: ['fire', 'sharp'], palette: { blade: '#ff6a1a', edge: '#ffe29a', dark: '#a02a08', guard: '#2a1410', gem: '#ffffff' }, lore: 'Forged in a dying star.' },
  { name: 'Stormcaller', type: 'spear', variant: 0, tier: 3, ench: ['shock', 'swift'], palette: { blade: '#e8f060', edge: '#ffffff', dark: '#a0a820', guard: '#2a3a5a', gem: '#7ae0ff' }, lore: 'Thunder follows every thrust.' },
  { name: 'Frostbite', type: 'dagger', variant: 1, tier: 3, ench: ['frost', 'crit'], palette: { blade: '#9ae8ff', edge: '#ffffff', dark: '#4aa8d8', guard: '#2a5a8a', gem: '#ffffff' }, lore: 'Colder than a winter grave.' },
  { name: 'Soulreaper', type: 'axe', variant: 1, tier: 4, ench: ['vamp', 'sharp'], palette: { blade: '#7a2a9a', edge: '#e08aff', dark: '#3a1050', guard: '#1a0a24', gem: '#ff4a7a' }, lore: 'It drinks, and it is never full.' },
  { name: 'Thunderfall', type: 'hammer', variant: 0, tier: 2, ench: ['shock', 'boom'], palette: { blade: '#d0b040', edge: '#fff2a0', dark: '#907820', guard: '#4a3a1a', gem: '#7ae0ff' }, lore: 'Every swing is a storm.' },
  { name: 'Windpiercer', type: 'bow', variant: 1, tier: 3, ench: ['swift', 'crit'], palette: { blade: '#cfe8ff', edge: '#ffffff', dark: '#7aa8d8', guard: '#2a4a6a', gem: '#ffffff', h: '#c8f0d0', H: '#8ac8a0', s: '#ffffff' }, lore: 'Arrows outrun their own sound.' },
  { name: 'Venomspire', type: 'crossbow', variant: 0, tier: 2, ench: ['venom', 'boom'], palette: { blade: '#7aff4a', edge: '#e0ffc0', dark: '#3a9a1a', guard: '#2a3a1a', gem: '#c0ff60', h: '#3a5a2a', H: '#2a4a1a' }, lore: 'A single scratch is a death sentence.' },
  { name: 'Dawnbreaker', type: 'sword', variant: 2, tier: 2, ench: ['sharp', 'crit', 'vamp'], palette: { blade: '#fff0a0', edge: '#ffffff', dark: '#e0b830', guard: '#c08020', gem: '#ff6a6a' }, lore: 'It carries the sun inside.' },
  { name: 'Void Fang', type: 'dagger', variant: 0, tier: 4, ench: ['gravity', 'swift'], palette: { blade: '#4a2a8a', edge: '#c88aff', dark: '#1a0a3a', guard: '#120a24', gem: '#e08aff' }, lore: 'It bites reality itself.' },
  { name: 'Magma Maul', type: 'hammer', variant: 0, tier: 5, ench: ['fire', 'boom'], palette: { blade: '#4a2a2a', edge: '#ff8a3a', dark: '#2a1010', guard: '#ff5a1a', gem: '#ffd23a' }, lore: 'Cooled only by blood.' },
  { name: "Ranger's Last Word", type: 'bow', variant: 0, tier: 4, ench: ['fire', 'swift'], palette: { blade: '#ff9a4a', edge: '#ffe0b0', dark: '#a05a20', guard: '#4a2a1a', gem: '#ffd060', h: '#7a3a1a', H: '#5a2a10', s: '#ffe0b0' }, lore: 'The last thing many heard.' },
  { name: 'Glaive of Echoes', type: 'spear', variant: 0, tier: 4, ench: ['gravity', 'sharp'], palette: { blade: '#8a6aff', edge: '#d8c8ff', dark: '#4a2aa8', guard: '#2a1a5a', gem: '#ffffff' }, lore: 'It strikes twice. Sometimes thrice.' },
];

export function powerMult(level) { return 1 + 0.115 * (level - 1); }
export function xpNeed(l) { return Math.floor(60 + 42 * Math.pow(l - 1, 1.5)); }
export const MAX_LEVEL = 30;
export const MAX_UPGRADE = 5;

export function rollItem(level, opts = {}) {
  const rng = opts.rng || { next: Math.random };
  const luck = opts.luck || 0;
  let slot = opts.slot;
  if (!slot) slot = weightedPick(['melee', 'ranged', 'armor', 'artifact'], (s) => ({ melee: 36, ranged: 24, armor: 24, artifact: 16 }[s]));
  let rarity = opts.rarity;
  if (!rarity) {
    const r = Math.random() + luck * 0.1 + (opts.bonus || 0);
    rarity = r > 0.93 ? 'unique' : r > 0.62 ? 'rare' : 'common';
  }
  level = Math.max(1, Math.round(level));
  const it = { id: _uid++ + '_' + Math.floor(Math.random() * 1e6), slot, rarity, level, upgrade: 0, enchants: [], perks: [] };
  const R = RARITY[rarity];
  if (slot === 'melee' || slot === 'ranged') {
    // unique?
    if (rarity === 'unique' && Math.random() < 0.7) {
      const pool = UNIQUES.filter((u) => WEAPONS[u.type].slot === slot);
      const u = pick(pool);
      Object.assign(it, { type: u.type, variant: u.variant, tier: u.tier, name: u.name, palette: u.palette, lore: u.lore, enchants: u.ench.slice(), glow: ENCH[u.ench[0]].color, fixed: true });
    } else {
      const type = pick(slot === 'melee' ? MELEE_TYPES : RANGED_TYPES);
      const tier = clamp(Math.floor((level - 1) / 3.6 + Math.random() * 1.2 - 0.2), 0, TIERS.length - 1);
      const variant = ri(0, 3);
      const base = WEAPONS[type];
      it.type = type; it.tier = tier; it.variant = variant;
      it.name = `${TIERS[tier].name} ${base.names[variant]}`;
      const n = R.slots; const pool = ENCH_KEYS.slice();
      for (let i = 0; i < n; i++) { const e = pool.splice(ri(0, pool.length - 1), 1)[0]; it.enchants.push(e); }
      if (it.enchants.length) it.glow = ENCH[it.enchants[0]].color;
    }
  } else if (slot === 'armor') {
    const avail = ARMOR_SETS.filter((a) => a.minLevel <= level + 2);
    const set = Math.random() < 0.6 ? avail[avail.length - 1] : pick(avail);
    it.type = 'armor'; it.look = set.look; it.name = set.name; it.setIdx = ARMOR_SETS.indexOf(set);
    const pool = PERK_KEYS.slice();
    for (let i = 0; i < R.perks; i++) { it.perks.push(pool.splice(ri(0, pool.length - 1), 1)[0]); }
    if (rarity === 'unique') it.name = pick(['Dread', 'Radiant', 'Warden', 'Eternal', 'Abyssal']) + ' ' + set.name.split(' ').slice(-1)[0];
  } else {
    const key = pick(ARTIFACT_KEYS); const a = ARTIFACTS[key];
    it.type = 'artifact'; it.art = key; it.name = a.name; it.icon = a.icon;
    const pool = PERK_KEYS.slice(); // artifacts get no perks, but unique ones get +power
  }
  return it;
}

export function itemDamage(it, playerLevel = 1) {
  if (!it || !WEAPONS[it.type]) return 0;
  const b = WEAPONS[it.type];
  let d = b.dmg * powerMult(it.level) * (1 + 0.09 * it.upgrade) * RARITY[it.rarity].mult;
  if (it.enchants.includes('sharp')) d *= 1.18;
  return d;
}
export function itemRate(it) {
  const b = WEAPONS[it.type]; let r = b.rate * (it.enchants.includes('swift') ? 1.22 : 1); return r;
}
export function itemCrit(it) { const b = WEAPONS[it.type]; return b.crit + (it.enchants.includes('crit') ? 0.18 : 0); }
export function armorStats(it) {
  if (!it || it.type !== 'armor') return { hp: 0, def: 0 };
  const s = ARMOR_SETS[it.setIdx];
  const m = powerMult(it.level) * (1 + 0.08 * it.upgrade) * RARITY[it.rarity].mult;
  return { hp: Math.round(s.hp * m), def: Math.round(s.def * m) };
}
export function artifactPower(it) { return powerMult(it.level) * (1 + 0.1 * it.upgrade) * RARITY[it.rarity].mult; }

export function itemPower(it) {
  if (!it) return 0;
  if (WEAPONS[it.type]) return Math.round(itemDamage(it) * itemRate(it) * 0.5 + it.enchants.length * 3);
  if (it.type === 'armor') { const s = armorStats(it); return Math.round(s.hp * 0.4 + s.def * 0.8 + it.perks.length * 3); }
  return Math.round(artifactPower(it) * 12);
}
export function itemValue(it) { return Math.round((12 + it.level * 9) * RARITY[it.rarity].mult * RARITY[it.rarity].mult * (1 + 0.5 * it.upgrade)); }
export function itemPrice(it) { return Math.round(itemValue(it) * 3.2); }
export function upgradeCost(it) { return Math.round((30 + it.level * 14) * (it.upgrade + 1) * RARITY[it.rarity].mult); }

export function describeItem(it) {
  const lines = [];
  if (WEAPONS[it.type]) {
    const b = WEAPONS[it.type];
    lines.push([`${Math.round(itemDamage(it))}`, 'Damage']);
    lines.push([`${itemRate(it).toFixed(1)}/s`, 'Speed']);
    lines.push([`${Math.round(itemCrit(it) * 100)}%`, 'Crit']);
    if (b.slot === 'melee') lines.push([`${b.range.toFixed(1)}m`, 'Reach']);
  } else if (it.type === 'armor') {
    const s = armorStats(it); lines.push([`+${s.hp}`, 'Health']); lines.push([`${s.def}`, 'Defense']);
  } else if (it.type === 'artifact') {
    lines.push([`${Math.round(artifactPower(it) * 100)}%`, 'Power']); lines.push([`${ARTIFACTS[it.art].cd}s`, 'Cooldown']);
  }
  return lines;
}

// ============================================================ enemies
// pal: biome -> palette overrides
export const ENEMIES = {
  zombie: { name: 'Rotter', hp: 48, dmg: 11, speed: 2.6, radius: 0.55, xp: 10, em: 2, range: 1.9, windup: 0.55, cd: 1.3, ai: 'melee', model: 'zombie' },
  skeleton: { name: 'Bone Archer', hp: 34, dmg: 10, speed: 3.1, radius: 0.5, xp: 12, em: 3, range: 15, windup: 0.7, cd: 2.2, ai: 'archer', model: 'skeleton' },
  keg: { name: 'Powder Imp', hp: 30, dmg: 34, speed: 4.4, radius: 0.55, xp: 12, em: 3, range: 2.4, windup: 0.9, cd: 99, ai: 'keg', model: 'keg' },
  spider: { name: 'Crawler', hp: 28, dmg: 9, speed: 4.6, radius: 0.55, xp: 11, em: 2, range: 1.8, windup: 0.35, cd: 1.0, ai: 'spider', model: 'spider' },
  slime: { name: 'Jelly Cube', hp: 52, dmg: 10, speed: 2.2, radius: 0.7, xp: 9, em: 2, range: 1.5, windup: 0.3, cd: 1.1, ai: 'slime', model: 'slime' },
  marauder: { name: 'Marauder', hp: 190, dmg: 24, speed: 2.9, radius: 0.75, xp: 38, em: 9, range: 2.5, windup: 0.75, cd: 1.7, ai: 'brute', model: 'marauder', elite: true, poise: 0.7 },
  hexer: { name: 'Hexer', hp: 100, dmg: 16, speed: 2.8, radius: 0.6, xp: 36, em: 9, range: 13, windup: 0.9, cd: 3.2, ai: 'hexer', model: 'hexer', elite: true },
  wraith: { name: 'Wraith', hp: 60, dmg: 13, speed: 3.0, radius: 0.55, xp: 20, em: 4, range: 13, windup: 0.8, cd: 2.4, ai: 'floater', model: 'wraith', flying: true },
  cinder: { name: 'Cinder Wisp', hp: 55, dmg: 14, speed: 3.4, radius: 0.55, xp: 20, em: 4, range: 12, windup: 0.7, cd: 2.0, ai: 'floater', model: 'cinder', flying: true },
  golem: { name: 'Stone Golem', hp: 420, dmg: 32, speed: 2.2, radius: 1.1, xp: 70, em: 16, range: 3.2, windup: 1.0, cd: 2.4, ai: 'brute', model: 'golem', elite: true, poise: 0.9, scale: 1.7 },
};

const PAL = {
  zombie: {
    meadow: { skin: 0x5f9a4a, shirt: 0x2a6a8a, pants: 0x3a3a6a }, crypt: { skin: 0x6a8a62, shirt: 0x4a3a5a, pants: 0x2a2a3a, rags: 0x2a1a2a }, sands: { skin: 0xb0a070, shirt: 0xa08a5a, pants: 0x6a5a3a }, frost: { skin: 0x9ac0d8, shirt: 0x4a6a9a, pants: 0x3a4a6a }, inferno: { skin: 0x4a3a30, shirt: 0x3a2020, pants: 0x241616 }, void: { skin: 0x7a6a98, shirt: 0x3a2a5a, pants: 0x20183a },
  },
  skeleton: {
    meadow: { bone: 0xd8d8cc, dark: 0x6a6a60 }, crypt: { bone: 0xcfcab8, dark: 0x5a5648 }, sands: { bone: 0xe8dcb0, dark: 0x8a7a50 }, frost: { bone: 0xcfe8f8, dark: 0x6a8aa8 }, inferno: { bone: 0x4a4650, dark: 0x1a181e }, void: { bone: 0xb8a0e0, dark: 0x4a3a6a },
  },
  spider: {
    meadow: { body: 0x2a2530, abd: 0x3a2a40, leg: 0x1a1620 }, crypt: { body: 0x3a3030, abd: 0x2a2a38, leg: 0x1a1a22 }, sands: { body: 0x7a5a30, abd: 0x9a7040, leg: 0x4a3418 }, frost: { body: 0x6a8ab0, abd: 0x8aaad0, leg: 0x3a5a80 }, inferno: { body: 0x4a1a14, abd: 0x7a2a14, leg: 0x24100c }, void: { body: 0x2a1a48, abd: 0x4a2a78, leg: 0x140a28 },
  },
  slime: { meadow: { color: 0x6fdc5a, core: 0x3aa030 }, crypt: { color: 0x6aa8d8, core: 0x3a6a9a }, sands: { color: 0xe0c050, core: 0xa08a20 }, frost: { color: 0x9ae8ff, core: 0x5aa8d0 }, inferno: { color: 0xff7a3a, core: 0xc03a10 }, void: { color: 0xb070ff, core: 0x6a30c0 } },
  marauder: { meadow: { skin: 0x8aa08a, cloth: 0x4a3a5a, pants: 0x2a2a3a, metal: 0x7a808a }, crypt: { skin: 0x8a9a8a, cloth: 0x5a2a3a, pants: 0x2a2030, metal: 0x6a707a }, sands: { skin: 0xb09870, cloth: 0x8a3a2a, pants: 0x4a3420, metal: 0xc0a050 }, frost: { skin: 0x9ab0c0, cloth: 0x3a4a7a, pants: 0x2a3050, metal: 0xaabcd0 }, inferno: { skin: 0x7a5a4a, cloth: 0x6a1a10, pants: 0x2a1410, metal: 0x3a3236 }, void: { skin: 0x8a7aa0, cloth: 0x3a1a5a, pants: 0x1a1030, metal: 0x4a4260 } },
  hexer: { meadow: { skin: 0x8aa08a, robe: 0x5a3a8a, robe2: 0x3a2060, gem: 0x7cffb0 }, crypt: { skin: 0x8a9a8a, robe: 0x2a4a5a, robe2: 0x1a2a3a, gem: 0x7cffb0 }, sands: { skin: 0xb09870, robe: 0x2a6a9a, robe2: 0x1a3a5a, gem: 0xffe070 }, frost: { skin: 0x9ab0c0, robe: 0x4a6ac0, robe2: 0x2a3a80, gem: 0xbff4ff }, inferno: { skin: 0x7a5a4a, robe: 0x8a2a10, robe2: 0x4a1008, gem: 0xffa030 }, void: { skin: 0x8a7aa0, robe: 0x4a1a7a, robe2: 0x240a48, gem: 0xe08aff } },
  wraith: { meadow: { color: 0x7ea0c8 }, crypt: { color: 0x8a90c8 }, sands: { color: 0xd8b878 }, frost: { color: 0xa0d8f8 }, inferno: { color: 0xc86a4a }, void: { color: 0xa070e0 } },
  cinder: { meadow: { color: 0xff6a20, rod: 0xffc040 }, crypt: { color: 0x70a0ff, rod: 0xa0d0ff }, sands: { color: 0x40d0e0, rod: 0xa0f8ff }, frost: { color: 0x80d8ff, rod: 0xe0f8ff }, inferno: { color: 0xff5a10, rod: 0xffc040 }, void: { color: 0xc060ff, rod: 0xf0b0ff } },
  golem: { meadow: { stone: 0x8a9a8a, stone2: 0x6a7a6a, glow: 0x7cffb0 }, crypt: { stone: 0x7a7a88, stone2: 0x5a5a68, glow: 0x9a7aff }, sands: { stone: 0xd0b070, stone2: 0xb09050, glow: 0xff9a2a }, frost: { stone: 0xa8d0f0, stone2: 0x80b0d8, glow: 0x9ff4ff }, inferno: { stone: 0x3a2a2e, stone2: 0x2a1c20, glow: 0xff6a1a }, void: { stone: 0x4a3a6a, stone2: 0x2a1c48, glow: 0xe08aff } },
};
export function enemyPalette(id, biome) { const t = PAL[id]; return t ? (t[biome] || t.meadow) : {}; }

export const BIOME_ENEMIES = {
  meadow: [['zombie', 6], ['skeleton', 3], ['keg', 2], ['spider', 2], ['slime', 3], ['marauder', 0.7]],
  crypt: [['zombie', 4], ['skeleton', 6], ['keg', 1.5], ['spider', 2], ['wraith', 2], ['hexer', 0.9], ['marauder', 0.8]],
  sands: [['zombie', 4], ['skeleton', 3], ['spider', 4], ['keg', 3], ['slime', 1.5], ['hexer', 1], ['marauder', 1], ['golem', 0.4]],
  frost: [['zombie', 4], ['skeleton', 4], ['slime', 3], ['wraith', 3], ['marauder', 1], ['golem', 0.6], ['hexer', 0.8]],
  inferno: [['cinder', 5], ['skeleton', 4], ['zombie', 3], ['keg', 3], ['marauder', 1.5], ['golem', 0.8], ['hexer', 0.9], ['spider', 1.5]],
  void: [['wraith', 4], ['hexer', 2.5], ['cinder', 2.5], ['marauder', 2], ['skeleton', 3], ['spider', 2], ['golem', 1]],
};

export const BOSSES = {
  rotking: { name: 'The Rot King', hp: 1500, dmg: 24, speed: 2.8, radius: 1.5, xp: 300, em: 90, scale: 2.4, patterns: ['slam', 'summon', 'charge', 'slam', 'ring'], title: 'Lord of the Meadow' },
  lich: { name: 'Bone Warden', hp: 2000, dmg: 26, speed: 2.9, radius: 1.3, xp: 450, em: 120, scale: 2.3, patterns: ['spiral', 'summon', 'rain', 'ring', 'nova'], title: 'Keeper of the Crypt' },
  sandtyrant: { name: 'Sand Tyrant', hp: 2800, dmg: 30, speed: 3.0, radius: 1.7, xp: 650, em: 160, scale: 2.4, patterns: ['slam', 'rain', 'charge', 'nova', 'summon'], title: 'Scourge of the Dunes' },
  frostwarden: { name: 'Frost Warden', hp: 3600, dmg: 32, speed: 3.0, radius: 1.7, xp: 850, em: 200, scale: 2.5, patterns: ['rain', 'nova', 'spiral', 'slam', 'ring'], title: 'The Frozen Sentinel' },
  magmatitan: { name: 'Magma Titan', hp: 4800, dmg: 38, speed: 3.1, radius: 1.9, xp: 1100, em: 260, scale: 2.7, patterns: ['slam', 'rain', 'charge', 'ring', 'summon', 'nova'], title: 'Heart of the Mountain' },
  voidlord: { name: 'The Void Lord', hp: 7000, dmg: 42, speed: 3.2, radius: 1.5, xp: 2000, em: 400, scale: 2.5, patterns: ['beam', 'spiral', 'rain', 'summon', 'nova', 'ring'], title: 'Devourer of Worlds' },
};

// ============================================================ missions & story
export const MISSIONS = [
  {
    id: 'm1', name: 'Whispering Meadow', biome: 'meadow', level: 1, size: 'small', boss: 'rotking', color: '#6fdc5a',
    brief: 'Rotters have risen from the barrows and overrun the meadow outside camp. Cut a path through them and silence their king.',
    objectives: [{ type: 'kill', n: 12, text: 'Defeat the undead' }, { type: 'boss', text: 'Slay the Rot King' }],
    intro: 'Elder Maren: "The dead stir where they should sleep. Take up a blade, Delver. Start with the meadow."',
    outro: 'Elder Maren: "The Rot King is no more... but the crypts beneath still whisper."',
  },
  {
    id: 'm2', name: 'Hollow Crypt', biome: 'crypt', level: 4, size: 'medium', boss: 'lich', color: '#a090c8',
    brief: 'Dark spawners feed an endless tide of bones. Shatter them and confront the Bone Warden at the crypt\'s heart.',
    objectives: [{ type: 'spawners', n: 3, text: 'Shatter the dark spawners' }, { type: 'boss', text: 'Defeat the Bone Warden' }],
    intro: 'Elder Maren: "Spawner cages feed the horde. Break them, then end the Warden."',
    outro: 'Elder Maren: "Sand drifts from the east, where an old sanctum wakes."',
  },
  {
    id: 'm3', name: 'Sunscorch Sanctum', biome: 'sands', level: 8, size: 'medium', boss: 'sandtyrant', color: '#f0c060',
    brief: 'Four Sun Shards power the sanctum\'s guardian. Hunt the shard-bearers and bring the Tyrant down.',
    objectives: [{ type: 'shards', n: 4, text: 'Recover Sun Shards from shard-bearers' }, { type: 'boss', text: 'Topple the Sand Tyrant' }],
    intro: 'Elder Maren: "Marked beasts carry the shards. Take them back, one by one."',
    outro: 'Elder Maren: "Winter has come early to the northern peaks. Dress warmly."',
  },
  {
    id: 'm4', name: 'Frostbite Hollow', biome: 'frost', level: 12, size: 'medium', boss: 'frostwarden', color: '#8fe0ff',
    brief: 'Three ancient beacons keep the Frost Warden asleep — and someone has put them out. Relight them under fire.',
    objectives: [{ type: 'beacons', n: 3, text: 'Relight the ancient beacons' }, { type: 'boss', text: 'Break the Frost Warden' }],
    intro: 'Elder Maren: "Stand upon a beacon until it catches. Expect company."',
    outro: 'Elder Maren: "Fire. The mountain itself is burning. We go deeper."',
  },
  {
    id: 'm5', name: 'Molten Depths', biome: 'inferno', level: 16, size: 'large', boss: 'magmatitan', color: '#ff7a3a',
    brief: 'Cinders and iron-clad marauders guard the path to the Magma Titan. Burn through them all.',
    objectives: [{ type: 'kill', n: 30, text: 'Purge the molten horde' }, { type: 'spawners', n: 2, text: 'Shatter the fire spawners' }, { type: 'boss', text: 'Extinguish the Magma Titan' }],
    intro: 'Elder Maren: "The heat is unbearable. Do not stand in it."',
    outro: 'Elder Maren: "One shadow left. The Spire hungers."',
  },
  {
    id: 'm6', name: 'The Void Spire', biome: 'void', level: 20, size: 'large', boss: 'voidlord', color: '#c77dff',
    brief: 'At the top of the Void Spire waits the one who woke the dead. End this.',
    objectives: [{ type: 'beacons', n: 3, text: 'Sever the void anchors' }, { type: 'kill', n: 25, text: 'Defeat the void spawn' }, { type: 'boss', text: 'Destroy the Void Lord' }],
    intro: 'Elder Maren: "I have nothing left to teach you. Go. Finish it."',
    outro: 'Elder Maren: "The dead sleep. The meadow blooms. You are the stuff of legend, Delver."',
  },
];
export const THREATS = [
  { name: 'Default', lvl: 0, loot: 1, hp: 1 },
  { name: 'Adventure I', lvl: 4, loot: 1.3, hp: 1.15 },
  { name: 'Adventure II', lvl: 8, loot: 1.7, hp: 1.3 },
  { name: 'Adventure III', lvl: 12, loot: 2.2, hp: 1.5 },
];

// ============================================================ side quests (persistent)
export const QUESTS = [
  { id: 'q_kill50', name: 'Gravedigger', desc: 'Defeat 50 enemies.', stat: 'kills', goal: 50, reward: { em: 80, xp: 120 } },
  { id: 'q_kill250', name: 'Exterminator', desc: 'Defeat 250 enemies.', stat: 'kills', goal: 250, reward: { em: 250, xp: 500, item: { slot: 'melee', rarity: 'rare' } } },
  { id: 'q_kill1000', name: 'Legend of the Blade', desc: 'Defeat 1000 enemies.', stat: 'kills', goal: 1000, reward: { em: 900, xp: 2000, item: { slot: 'armor', rarity: 'unique' } } },
  { id: 'q_chest5', name: 'Treasure Hunter', desc: 'Open 5 chests.', stat: 'chests', goal: 5, reward: { em: 100, xp: 100 } },
  { id: 'q_chest25', name: 'Master Looter', desc: 'Open 25 chests.', stat: 'chests', goal: 25, reward: { em: 400, xp: 600, item: { slot: 'ranged', rarity: 'rare' } } },
  { id: 'q_break30', name: 'Wrecking Crew', desc: 'Smash 30 crates, barrels and pots.', stat: 'breaks', goal: 30, reward: { em: 90, xp: 100 } },
  { id: 'q_art20', name: 'Arcane Apprentice', desc: 'Use artifacts 20 times.', stat: 'arts', goal: 20, reward: { em: 120, xp: 160, item: { slot: 'artifact', rarity: 'rare' } } },
  { id: 'q_roll60', name: 'Slippery', desc: 'Dodge roll 60 times.', stat: 'rolls', goal: 60, reward: { em: 80, xp: 110 } },
  { id: 'q_crit40', name: 'Critical Mass', desc: 'Land 40 critical hits.', stat: 'crits', goal: 40, reward: { em: 150, xp: 200 } },
  { id: 'q_dmg', name: 'Heavy Hitter', desc: 'Deal 10,000 total damage.', stat: 'damage', goal: 10000, reward: { em: 220, xp: 350 } },
  { id: 'q_upg', name: 'Apprentice Smith', desc: 'Upgrade gear 3 times.', stat: 'upgrades', goal: 3, reward: { em: 140, xp: 200 } },
  { id: 'q_boss1', name: 'Kingslayer', desc: 'Defeat any boss.', stat: 'bosses', goal: 1, reward: { em: 150, xp: 250 } },
  { id: 'q_boss4', name: 'Titan Hunter', desc: 'Defeat 4 bosses.', stat: 'bosses', goal: 4, reward: { em: 500, xp: 900, item: { slot: 'melee', rarity: 'unique' } } },
  { id: 'q_lvl5', name: 'Getting Started', desc: 'Reach level 5.', stat: 'level', goal: 5, reward: { em: 120, xp: 0 } },
  { id: 'q_lvl12', name: 'Veteran Delver', desc: 'Reach level 12.', stat: 'level', goal: 12, reward: { em: 400, xp: 0, item: { slot: 'armor', rarity: 'rare' } } },
  { id: 'q_lvl20', name: 'Champion', desc: 'Reach level 20.', stat: 'level', goal: 20, reward: { em: 1200, xp: 0, item: { slot: 'artifact', rarity: 'unique' } } },
  { id: 'q_em', name: 'Emerald Baron', desc: 'Collect 2,000 emeralds in total.', stat: 'emTotal', goal: 2000, reward: { em: 300, xp: 400 } },
  { id: 'q_win3', name: 'Threat Level', desc: 'Complete a mission on Adventure difficulty.', stat: 'adventure', goal: 1, reward: { em: 400, xp: 500, item: { slot: 'ranged', rarity: 'unique' } } },
];
