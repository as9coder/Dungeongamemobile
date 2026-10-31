import * as THREE from 'three';
import { RNG, hash2, vnoise, clamp } from './util.js';

export function hex(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mul(a, f) { return [clamp(a[0] * f, 0, 255), clamp(a[1] * f, 0, 255), clamp(a[2] * f, 0, 255)]; }

function finish(canvas, { repeat = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

function pixelCanvas(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y);
    const i = (y * w + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] === undefined ? 255 : col[3];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- block textures (all seamless, 32x32) ----------
export function brickTexture(base, mortar, seed = 1, o = {}) {
  const S = 32, bh = o.bh || 8, bw = o.bw || 16, rng = new RNG(seed);
  const B = hex(base), M = hex(mortar);
  const rows = S / bh, jit = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) jit[r * 3 + c] = rng.range(0.82, 1.14);
  const cv = pixelCanvas(S, S, (x, y) => {
    const r = Math.floor(y / bh), off = (r % 2) * (bw / 2);
    const xx = (x + off) % S, c = Math.floor(xx / bw);
    const ly = y % bh, lx = xx % bw;
    if (ly === bh - 1 || lx === bw - 1) return mul(M, 0.9 + hash2(x, y, seed) * 0.2);
    let f = jit[r * 3 + c] * (0.9 + hash2(x, y, seed + 7) * 0.2);
    if (ly === 0) f *= 1.18; if (lx === 0) f *= 1.1; if (ly === bh - 2) f *= 0.85;
    const n = vnoise(x * 0.5, y * 0.5, seed) * 0.15;
    let col = mul(B, f * (0.92 + n));
    if (o.moss && vnoise(x * 0.3, y * 0.3, seed + 3) > 0.62) col = mix(col, hex(o.moss), 0.7);
    return col;
  });
  return finish(cv);
}

export function tileTexture(base, grout, seed = 2, o = {}) {
  const S = 32, T = 16, B = hex(base), G = hex(grout);
  const jit = [0, 1, 2, 3].map((i) => 0.88 + hash2(i, seed, 11) * 0.24);
  const cv = pixelCanvas(S, S, (x, y) => {
    const tx = Math.floor(x / T), ty = Math.floor(y / T), lx = x % T, ly = y % T;
    if (lx === T - 1 || ly === T - 1) return mul(G, 0.8 + hash2(x, y, seed) * 0.3);
    let f = jit[tx + ty * 2] * (0.93 + hash2(x, y, seed + 5) * 0.14);
    if (lx === 0 || ly === 0) f *= 1.14; if (lx === T - 2 || ly === T - 2) f *= 0.88;
    let col = mul(B, f);
    if (o.tint) col = mix(col, hex(o.tint), vnoise(x * 0.25, y * 0.25, seed) * 0.45);
    if (o.crack && hash2(Math.floor(x / 2), Math.floor(y / 2), seed + 9) > 0.97) col = mul(col, 0.55);
    return col;
  });
  return finish(cv);
}

export function noiseTexture(colors, seed = 3, o = {}) {
  const S = 32, cols = colors.map(hex), sc = o.scale || 0.35;
  const cv = pixelCanvas(S, S, (x, y) => {
    const n = (vnoise(x * sc, y * sc, seed) * 0.6 + vnoise(x * sc * 2.3, y * sc * 2.3, seed + 4) * 0.4);
    const k = clamp(n * (cols.length - 1) + (hash2(x, y, seed) - 0.5) * (o.grain ?? 0.35), 0, cols.length - 1.001);
    const i = Math.floor(k);
    return mix(cols[i], cols[i + 1], k - i);
  });
  return finish(cv);
}

export function grassTexture(seed = 4) {
  const cv = pixelCanvas(32, 32, (x, y) => {
    const n = vnoise(x * 0.4, y * 0.4, seed);
    let c = mix(hex(0x3f8f2e), hex(0x62b53c), n);
    const h = hash2(x, y, seed);
    if (h > 0.9) c = mul(c, 1.25); else if (h < 0.15) c = mul(c, 0.72);
    if (hash2(x >> 1, y >> 1, seed + 8) > 0.985) c = hex(0xf2e060);
    return c;
  });
  return finish(cv);
}

export function planksTexture(base = 0x8a5a2b, seed = 5) {
  const B = hex(base);
  const cv = pixelCanvas(32, 32, (x, y) => {
    const p = Math.floor(y / 8), ly = y % 8;
    const f = 0.85 + hash2(p, seed, 3) * 0.3;
    if (ly === 7) return mul(B, 0.55);
    const grain = vnoise(x * 0.12 + p * 7, y * 1.3, seed) * 0.25;
    let c = mul(B, f * (0.9 + grain));
    if (ly === 0) c = mul(c, 1.15);
    if ((x + p * 11) % 16 === 0) c = mul(c, 0.7);
    return c;
  });
  return finish(cv);
}

export function lavaTexture(seed = 6) {
  const cv = pixelCanvas(32, 32, (x, y) => {
    const n = vnoise(x * 0.22, y * 0.22, seed) * 0.65 + vnoise(x * 0.5, y * 0.5, seed + 2) * 0.35;
    const k = clamp((n - 0.25) * 2.2, 0, 1);
    return mix(hex(0xa8200a), hex(0xffd23a), k * k);
  });
  return finish(cv);
}

export function waterTexture(seed = 7, deep = 0x2a6fd4, light = 0x6fc4ff) {
  const cv = pixelCanvas(32, 32, (x, y) => {
    const n = vnoise(x * 0.25 + 3, y * 0.5, seed) * 0.7 + vnoise(x * 0.6, y * 0.3, seed + 1) * 0.3;
    return mix(hex(deep), hex(light), clamp((n - 0.35) * 2.5, 0, 1));
  });
  return finish(cv);
}

export function voidTexture(seed = 8) {
  const cv = pixelCanvas(32, 32, (x, y) => {
    const n = vnoise(x * 0.3, y * 0.3, seed);
    let c = mix(hex(0x1a0f2e), hex(0x372058), n);
    const v = Math.abs(vnoise(x * 0.18, y * 0.18, seed + 5) - 0.5);
    if (v < 0.035) c = mix(c, hex(0xc77dff), 0.9);
    if (hash2(x, y, seed) > 0.985) c = hex(0xe5b8ff);
    return c;
  });
  return finish(cv);
}

export function leafTexture(a = 0x2f7d2a, b = 0x55b847, seed = 9) {
  const cv = pixelCanvas(32, 32, (x, y) => {
    const h = hash2(x >> 1, y >> 1, seed);
    let c = mix(hex(a), hex(b), h);
    if (hash2(x, y, seed + 3) > 0.8) c = mul(c, 0.7);
    return c;
  });
  return finish(cv);
}

export function barkTexture(base = 0x5a3a1c, seed = 10) {
  const B = hex(base);
  const cv = pixelCanvas(32, 32, (x, y) => {
    const n = vnoise(x * 0.9, y * 0.12, seed);
    let c = mul(B, 0.7 + n * 0.6);
    if (hash2(x, y, seed) > 0.93) c = mul(c, 0.6);
    return c;
  });
  return finish(cv);
}

// ---------- ascii pixel art ----------
export function artCanvas(rows, pal, scale = 1) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (ch === '.' || ch === ' ' || !pal[ch]) continue;
    ctx.fillStyle = pal[ch]; ctx.fillRect(x * scale, y * scale, scale, scale);
  }
  return c;
}
export function artTexture(rows, pal) {
  const t = finish(artCanvas(rows, pal, 4), { repeat: false, mip: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- fx sprites ----------
function radial(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return c;
}
function spriteTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

export const FX = {};
export function initFxTextures() {
  FX.soft = spriteTex(radial(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]));
  FX.glow = spriteTex(radial(128, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.45)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]));
  FX.smoke = spriteTex(radial(64, [[0, 'rgba(255,255,255,0.8)'], [0.6, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
  // square pixel particle
  const sq = document.createElement('canvas'); sq.width = sq.height = 8;
  const sctx = sq.getContext('2d'); sctx.fillStyle = '#fff'; sctx.fillRect(1, 1, 6, 6); sctx.fillStyle = 'rgba(255,255,255,0.6)'; sctx.fillRect(0, 2, 8, 4); sctx.fillRect(2, 0, 4, 8);
  FX.square = spriteTex(sq);
  FX.square.magFilter = THREE.NearestFilter;
  // star spark
  const st = document.createElement('canvas'); st.width = st.height = 64;
  const x = st.getContext('2d'); x.translate(32, 32);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 6 : 30; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill();
  FX.star = spriteTex(st);
  // ring
  const rg = document.createElement('canvas'); rg.width = rg.height = 128;
  const rc = rg.getContext('2d');
  const rgr = rc.createRadialGradient(64, 64, 34, 64, 64, 64);
  rgr.addColorStop(0, 'rgba(255,255,255,0)'); rgr.addColorStop(0.55, 'rgba(255,255,255,0.15)'); rgr.addColorStop(0.9, 'rgba(255,255,255,1)'); rgr.addColorStop(1, 'rgba(255,255,255,0)');
  rc.fillStyle = rgr; rc.fillRect(0, 0, 128, 128);
  FX.ring = spriteTex(rg);
  // slash crescent
  const sl = document.createElement('canvas'); sl.width = 256; sl.height = 128;
  const sx = sl.getContext('2d');
  const grd = sx.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
  sx.fillStyle = grd; sx.beginPath(); sx.moveTo(0, 64); sx.quadraticCurveTo(128, 0, 256, 64); sx.quadraticCurveTo(128, 30, 0, 64); sx.fill();
  FX.slash = spriteTex(sl);
  // trail gradient (1D)
  const tr = document.createElement('canvas'); tr.width = 64; tr.height = 8;
  const tx = tr.getContext('2d');
  const tg = tx.createLinearGradient(0, 0, 64, 0); tg.addColorStop(0, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(255,255,255,1)');
  tx.fillStyle = tg; tx.fillRect(0, 0, 64, 8);
  FX.trail = spriteTex(tr);
  // shadow blob
  FX.shadow = spriteTex(radial(64, [[0, 'rgba(0,0,0,0.65)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]));
  // beam
  const bm = document.createElement('canvas'); bm.width = 8; bm.height = 64;
  const bx = bm.getContext('2d');
  const bg = bx.createLinearGradient(0, 0, 8, 0); bg.addColorStop(0, 'rgba(255,255,255,0)'); bg.addColorStop(0.5, 'rgba(255,255,255,1)'); bg.addColorStop(1, 'rgba(255,255,255,0)');
  bx.fillStyle = bg; bx.fillRect(0, 0, 8, 64);
  FX.beam = spriteTex(bm);
}

// ---------- mob / hero face art ----------
export const FACES = {
  hero: { rows: ['HHHHHHHH', 'HHHHHHHH', 'HssssssH', 'sswsswss', 'sebsebss', 'ssssssss', 'sssmmsss', 'sssssss s'.replace(' ','')], pal: { H: '#4a2c17', s: '#e0a77a', w: '#ffffff', e: '#2a6bd8', b: '#14213f', m: '#a8553f' } },
  zombie: { rows: ['gggggggg', 'gggggggg', 'gdddgddg', 'gwkggwkg', 'gkkggkkg', 'gggggggg', 'gdmmmmdg', 'gdgddgdg'], pal: { g: '#5f9a4a', d: '#4a7c39', w: '#d8e8c0', k: '#1c2a14', m: '#2a1a14' } },
  skeleton: { rows: ['wwwwwwww', 'wwwwwwww', 'wkkwwkkw', 'wkkwwkkw', 'wwwddwww', 'wwwwwwww', 'wkwkwkkw', 'wwwwwwww'], pal: { w: '#d8d8cc', d: '#a8a89c', k: '#1d1d1f' } },
  keg: { rows: ['oooooooo', 'ooyooyoo', 'okkooKko'.replace('K','k'), 'okkookko', 'oooooooo', 'okkkkkko', 'ookooKoo'.replace('K','k'), 'oooooooo'], pal: { o: '#c9772f', y: '#ffd35a', k: '#241208' } },
  spider: { rows: ['kkkkkkkk', 'krkkkkrk', 'krrkkrrk', 'kkkkkkkk', 'kwkrrkwk', 'kkkkkkkk', 'kwwkkwwk', 'kkkkkkkk'], pal: { k: '#26212e', r: '#e23a3a', w: '#cfcfd8' } },
  marauder: { rows: ['gggggggg', 'gggggggg', 'gbbggbbg', 'gkkggkkg', 'gggggggg', 'ggggnggg', 'ggnnnngg', 'gggnnggg'], pal: { g: '#8aa08a', b: '#3a2a22', k: '#a8201a', n: '#6c8a6c' } },
  hexer: { rows: ['pppppppp', 'pppppppp', 'pwwppwwp', 'pkgppkgp', 'pppppppp', 'pppnnppp', 'ppnnnnpp', 'pppnnppp'], pal: { p: '#7a5a92', w: '#e8e8ee', k: '#1a1030', g: '#7cffb0', n: '#5a3a72' } },
  slime: { rows: ['gggggggg', 'gggggggg', 'gkkggkkg', 'gkkggkkg', 'gggggggg', 'gggmmggg', 'gggggggg', 'gggggggg'], pal: { g: '#6fdc5a', k: '#1c4a18', m: '#2a7a22' } },
  wraith: { rows: ['bbbbbbbb', 'bbbbbbbb', 'bkkbbkkb', 'bkcbbkcb', 'bbbbbbbb', 'bbkkkkbb', 'bbkkkkbb', 'bbbbbbbb'], pal: { b: '#7ea0c8', k: '#0a1020', c: '#7dfcff' } },
  imp: { rows: ['rrrrrrrr', 'rrrrrrrr', 'ryyrryyr', 'rkyrrkyr', 'rrrrrrrr', 'rkkkkkkr', 'rrkrrkrr', 'rrrrrrrr'], pal: { r: '#c03a1a', y: '#ffe36a', k: '#2a0a04' } },
  golem: { rows: ['gggggggg', 'gddddddg', 'gcckkccg', 'gckkkkcg', 'gggggggg', 'gddddddg', 'gggggggg', 'gggggggg'], pal: { g: '#8a8f99', d: '#5d626c', c: '#a8d8ff', k: '#2a2f3a' } },
  king: { rows: ['yyyyyyyy', 'ygygygyy', 'gggggggg', 'gwkggwkg', 'gkkggkkg', 'gggggggg', 'gmmmmmmg', 'gmgmgmgg'], pal: { y: '#ffd23a', g: '#6fa05a', w: '#fff', k: '#a8201a', m: '#2a1a14' } },
  voidlord: { rows: ['pppppppp', 'pkkkkkkp', 'pkvkkvkp', 'pkkkkkkp', 'pppppppp', 'pkkppkkp', 'pppkkppp', 'pppppppp'], pal: { p: '#4a2a78', k: '#120820', v: '#e08aff' } },
};
const faceCache = {};
export function faceTexture(name, tint) {
  const key = name + (tint || '');
  if (faceCache[key]) return faceCache[key];
  const f = FACES[name];
  const pal = Object.assign({}, f.pal);
  const rows = f.rows.map((r) => r.padEnd(8, r[r.length - 1]).slice(0, 8));
  const t = artTexture(rows, pal);
  faceCache[key] = t; return t;
}

// per-biome block texture sets
const texCache = {};
export function biomeTextures(id) {
  if (texCache[id]) return texCache[id];
  let t;
  switch (id) {
    case 'meadow': t = { floor: grassTexture(11), wall: leafTexture(0x2a6e2a, 0x4faa3e, 12), trunk: barkTexture(0x5a3a1c, 13), path: noiseTexture([0x8a6a45, 0xa8855a, 0x7a5a38], 14), wallTop: leafTexture(0x3a8a30, 0x6acb4a, 15), accent: noiseTexture([0x7a7a80, 0x9a9aa2, 0x686870], 16) }; break;
    case 'crypt': t = { floor: tileTexture(0x6b6a72, 0x34333a, 21, { crack: 1 }), wall: brickTexture(0x58575f, 0x2c2b32, 22, { moss: 0x3f6a38 }), path: tileTexture(0x7d7b84, 0x3a3940, 23), wallTop: tileTexture(0x7a7a84, 0x3c3c44, 24), accent: planksTexture(0x6a4524, 25) }; break;
    case 'sands': t = { floor: tileTexture(0xd8b878, 0x9a7e48, 31, { crack: 1 }), wall: brickTexture(0xc9a560, 0x8a6e3c, 32, { bh: 8, bw: 16 }), path: noiseTexture([0xe0c488, 0xf0d89c, 0xd0b074], 33), wallTop: tileTexture(0xe6c888, 0xa88c54, 34), accent: noiseTexture([0xa86a30, 0xc88a48, 0x985a28], 35) }; break;
    case 'frost': t = { floor: tileTexture(0xb4d4ec, 0x6a94b8, 41, { tint: 0xffffff }), wall: brickTexture(0x7fa8cc, 0x4a6e92, 42), path: noiseTexture([0xeaf4ff, 0xcfe6fa, 0xffffff], 43), wallTop: noiseTexture([0xffffff, 0xe0f0ff, 0xcfe6fa], 44), accent: noiseTexture([0x4a7ac0, 0x6aa2e8, 0x3a68ac], 45) }; break;
    case 'inferno': t = { floor: tileTexture(0x3c2a2e, 0x1a0f12, 51, { crack: 1, tint: 0x8a2a10 }), wall: brickTexture(0x4a2a2e, 0x1e1012, 52), path: tileTexture(0x52363a, 0x22141a, 53), wallTop: tileTexture(0x5e3a3e, 0x2a181c, 54), accent: lavaTexture(55) }; break;
    case 'void': t = { floor: tileTexture(0x2c2244, 0x120a24, 61, { tint: 0x6a3aa8 }), wall: voidTexture(62), path: tileTexture(0x382a58, 0x160e2c, 63), wallTop: voidTexture(64), accent: voidTexture(65) }; break;
    default: t = biomeTextures('crypt');
  }
  texCache[id] = t; return t;
}
