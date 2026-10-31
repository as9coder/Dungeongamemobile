import * as THREE from 'three';
import { RNG, hash2, clamp, TAU } from './util.js';
import { FX, faceTexture, artCanvas, hex } from './textures.js';

// ============================================================ shared assets
const geoCache = new Map();
export function boxGeo(w, h, d, pivot = 'c') {
  const k = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${pivot}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    if (pivot === 't') g.translate(0, -h / 2, 0);
    else if (pivot === 'b') g.translate(0, h / 2, 0);
    geoCache.set(k, g);
  }
  return g;
}

let _cloth = null;
export function clothTex() {
  if (_cloth) return _cloth;
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const v = 205 + Math.floor(hash2(i, j, 4) * 50);
    x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, j, 1, 1);
  }
  _cloth = new THREE.CanvasTexture(c);
  _cloth.magFilter = THREE.NearestFilter; _cloth.minFilter = THREE.NearestFilter; _cloth.colorSpace = THREE.SRGBColorSpace;
  return _cloth;
}

export function lam(color, o = {}) {
  return new THREE.MeshLambertMaterial(Object.assign({ color, map: clothTex() }, o));
}
export function emissiveMat(color, intensity = 1) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.color.multiplyScalar(intensity);
  return m;
}

export function part(w, h, d, mat, pivot = 'c', shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d, pivot), mat);
  m.castShadow = shadow;
  return m;
}

// ============================================================ pixel grid -> voxel mesh
export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.d = Array.from({ length: h }, () => Array(w).fill('.')); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y][x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y][x] : '.'; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  rows() { return this.d.map((r) => r.join('')); }
}

const FACE_SHADE = { px: 0.86, nx: 0.8, py: 1.12, ny: 0.55, pz: 1.0, nz: 0.72 };
export function gridGeometry(grid, pal, depth = 2, vox = 0.075, anchor = [0, 0]) {
  const pos = [], nor = [], col = [], idx = [];
  const pc = {}; for (const k in pal) { const c = new THREE.Color(pal[k]); pc[k] = c; }
  const filled = (x, y) => grid.get(x, y) !== '.' && pc[grid.get(x, y)];
  const D = depth * vox;
  function quad(p, n, c, shade) {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]); nor.push(n[0], n[1], n[2]);
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const ch = grid.get(x, y); if (!filled(x, y)) continue;
    const c = pc[ch];
    const j = 0.9 + hash2(x, y, 7) * 0.2;
    const x0 = (x - anchor[0]) * vox, x1 = x0 + vox;
    const y1 = (anchor[1] - y) * vox, y0 = y1 - vox;
    const z0 = -D / 2, z1 = D / 2;
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c, FACE_SHADE.pz * j);
    quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], c, FACE_SHADE.nz * j);
    if (!filled(x + 1, y)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], c, FACE_SHADE.px * j);
    if (!filled(x - 1, y)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], c, FACE_SHADE.nx * j);
    if (!filled(x, y - 1)) quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], c, FACE_SHADE.py * j);
    if (!filled(x, y + 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], c, FACE_SHADE.ny * j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ============================================================ weapon sprites
export const TIERS = [
  { id: 'rusty', name: 'Rusty', blade: '#9c9288', edge: '#cfc6bb', dark: '#6a6258', guard: '#6a4a2a', grip: '#4a2f1a', pommel: '#8a7a60', gem: '#c0a060' },
  { id: 'iron', name: 'Iron', blade: '#aeb8c4', edge: '#e8eff6', dark: '#707a88', guard: '#5a6270', grip: '#5a3a22', pommel: '#8a96a6', gem: '#6ad0ff' },
  { id: 'gilded', name: 'Gilded', blade: '#dcc464', edge: '#fff3a8', dark: '#a28c2c', guard: '#8a5a1a', grip: '#6a2a2a', pommel: '#f2d24a', gem: '#ff4a6a' },
  { id: 'crystal', name: 'Crystal', blade: '#4fd8ec', edge: '#d8fdff', dark: '#2a9cba', guard: '#2a6a8a', grip: '#2a3a5a', pommel: '#6ae0ff', gem: '#ffffff' },
  { id: 'obsidian', name: 'Obsidian', blade: '#3e3850', edge: '#9a8ac8', dark: '#1e1a2a', guard: '#2a2236', grip: '#1a1422', pommel: '#6a3aa8', gem: '#c86aff' },
  { id: 'inferno', name: 'Infernal', blade: '#ff7a2a', edge: '#ffe69a', dark: '#b0300a', guard: '#3a1a14', grip: '#2a1410', pommel: '#ffb02a', gem: '#ffffff' },
];

function palFor(t, extra) {
  return Object.assign({ b: t.blade, e: t.edge, d: t.dark, f: t.dark, g: t.guard, h: t.grip, H: t.grip, p: t.pommel, a: t.gem, w: '#6a4a2a', W: '#4a321c', s: '#e8e8e8' }, extra || {});
}

function drawBlade(g, cx, y0, len, w, taper) {
  for (let i = 0; i < len; i++) {
    let ww = w; if (i < taper) ww = Math.max(1, Math.round(w * (i + 1) / (taper + 1)));
    const left = cx - Math.floor((ww - 1) / 2);
    for (let k = 0; k < ww; k++) {
      let c = 'b'; if (k === 0) c = 'e'; else if (k === ww - 1 && ww > 1) c = 'd'; else if (ww >= 5 && k === Math.floor(ww / 2)) c = 'f';
      g.set(left + k, y0 + i, c);
    }
  }
}

export function weaponSprite(type, variant = 0, tierIdx = 1, custom) {
  const t = Object.assign({}, TIERS[tierIdx % TIERS.length], custom || {});
  const pal = palFor(t);
  let g, anchor, tip, base, rot = 0;
  if (type === 'sword') {
    const v = [{ len: 18, w: 3, taper: 3, gw: 7 }, { len: 22, w: 3, taper: 4, gw: 9 }, { len: 22, w: 5, taper: 4, gw: 9 }, { len: 16, w: 3, taper: 3, gw: 5 }][variant % 4];
    g = new Grid(13, v.len + 8);
    drawBlade(g, 6, 0, v.len, v.w, v.taper);
    const gy = v.len; const gl = 6 - Math.floor(v.gw / 2);
    for (let k = 0; k < v.gw; k++) g.set(gl + k, gy, k === 0 || k === v.gw - 1 ? 'a' : 'g');
    for (let k = 1; k < v.gw - 1; k++) g.set(gl + k, gy + 1, 'g');
    for (let i = 0; i < 4; i++) g.set(6, gy + 2 + i, i % 2 ? 'H' : 'h');
    g.rect(5, gy + 6, 7, gy + 6, 'p'); g.set(6, gy + 7, 'p');
    anchor = [6, gy + 4]; tip = v.len + 4; base = 6;
  } else if (type === 'dagger') {
    const len = 10 + (variant % 2) * 2;
    g = new Grid(9, len + 8);
    drawBlade(g, 4, 0, len, 2 + (variant % 2), 3);
    g.rect(2, len, 6, len, 'g'); g.set(2, len, 'a'); g.set(6, len, 'a');
    for (let i = 0; i < 3; i++) g.set(4, len + 1 + i, i % 2 ? 'H' : 'h');
    g.rect(3, len + 4, 5, len + 4, 'p');
    anchor = [4, len + 2]; tip = len + 2; base = 4;
  } else if (type === 'axe') {
    const L = 24; g = new Grid(15, L + 4);
    for (let y = 2; y < L; y++) { g.set(7, y, 'h'); g.set(8, y, y % 2 ? 'H' : 'h'); }
    const dbl = variant % 2 === 1; const hh = 11;
    for (let i = 0; i < hh; i++) {
      const wd = Math.round(5.5 * Math.sin(Math.PI * (i + 0.5) / hh)) + 1;
      for (let k = 0; k < wd; k++) {
        const c = k === wd - 1 ? 'e' : (k === wd - 2 ? 'b' : 'd');
        g.set(6 - k, 1 + i, c);
        if (dbl) g.set(9 + k, 1 + i, c);
      }
    }
    g.rect(7, 1, 8, hh, 'g'); g.set(7, 0, 'p'); g.set(8, 0, 'p');
    g.rect(7, L, 8, L + 1, 'p');
    anchor = [7.5, L - 6]; tip = L - 8; base = 7.5;
  } else if (type === 'hammer') {
    const L = 26; g = new Grid(15, L + 3);
    for (let y = 6; y < L; y++) { g.set(7, y, 'h'); g.set(8, y, y % 2 ? 'H' : 'h'); }
    g.rect(3, 0, 12, 6, 'b'); g.rect(3, 0, 12, 0, 'e'); g.rect(3, 6, 12, 6, 'd');
    g.rect(3, 0, 4, 6, 'g'); g.rect(11, 0, 12, 6, 'g'); g.set(7, 3, 'a'); g.set(8, 3, 'a');
    g.rect(7, L, 8, L + 1, 'p');
    anchor = [7.5, L - 6]; tip = L - 8; base = 7.5;
  } else if (type === 'spear') {
    const L = 34; g = new Grid(9, L + 3);
    for (let y = 8; y < L; y++) { g.set(4, y, 'h'); g.set(5, y, y % 2 ? 'H' : 'h'); }
    const widths = [1, 2, 4, 4, 4, 3, 2, 2];
    widths.forEach((w, i) => { const l = 4 - Math.floor((w - 1) / 2) + (w % 2 === 0 ? 0 : 0); for (let k = 0; k < w; k++) g.set(l + k, i, k === 0 ? 'e' : (k === w - 1 ? 'd' : 'b')); });
    g.rect(3, 8, 6, 8, 'g'); g.rect(4, L, 5, L + 1, 'p');
    anchor = [4.5, L - 10]; tip = L - 10; base = 4.5;
  } else if (type === 'bow') {
    const H = 26; g = new Grid(9, H);
    for (let y = 0; y < H; y++) {
      const u = (y - (H - 1) / 2) / ((H - 1) / 2);
      const x = Math.round(5 * (1 - u * u) + 1);
      g.set(x, y, Math.abs(u) > 0.7 ? 'h' : 'H'); g.set(x + 1, y, 'h');
      if (y > 0 && y < H - 1) g.set(0, y, 's');
    }
    g.rect(4, 11, 7, 14, 'g'); g.set(5, 12, 'a');
    anchor = [5, 12]; tip = 12; base = 5; rot = -Math.PI / 2;
  } else if (type === 'crossbow') {
    const L = 22; g = new Grid(15, L);
    for (let y = 3; y < L; y++) { g.set(7, y, 'h'); g.set(8, y, 'H'); }
    g.rect(1, 3, 13, 4, 'g');
    for (let k = 0; k < 4; k++) { g.set(1 + k, 3 - Math.floor(k / 2), 'h'); g.set(13 - k, 3 - Math.floor(k / 2), 'h'); g.set(1 + k, 2, 'h'); }
    for (let x = 2; x < 13; x++) g.set(x, 7, 's');
    g.rect(7, 0, 8, 9, 'b'); g.set(7, 0, 'e'); g.set(8, 0, 'e');
    g.rect(6, 10, 9, 12, 'g'); g.set(7, 11, 'a');
    anchor = [7.5, 13]; tip = 16; base = 7.5;
  }
  return { grid: g, pal, anchor, tip, base, rot, type, tier: t };
}

// Cache of generated sprite geometries
const wGeoCache = new Map();
export function weaponGeometry(sp, key) {
  if (wGeoCache.has(key)) return wGeoCache.get(key);
  const depth = sp.type === 'bow' ? 1.6 : (sp.type === 'axe' || sp.type === 'hammer' ? 2.4 : 2);
  const geo = gridGeometry(sp.grid, sp.pal, depth, 0.07, sp.anchor);
  wGeoCache.set(key, geo); return geo;
}

// ============================================================ humanoid rigs
function makeMats(rig, list) {
  rig.mats = list;
  rig.setFlash = (v) => { for (const m of rig.mats) { if (m.emissive) m.emissive.setRGB(v, v * 0.9, v * 0.85); } };
}

export function humanoid(c) {
  const s = c.scale || 1;
  const mats = [];
  const M = (color, o) => { const m = lam(color, o); mats.push(m); return m; };
  const root = new THREE.Group();
  const T = Object.assign({ w: 0.82, h: 0.95, d: 0.46, color: 0x4a6a9a }, c.torso);
  const Hd = Object.assign({ s: 0.72, color: 0xe0a77a, face: 'hero' }, c.head);
  const A = Object.assign({ w: 0.3, h: 0.88, d: 0.3, color: 0xe0a77a, hand: 0xe0a77a }, c.arm);
  const L = Object.assign({ w: 0.36, h: 0.85, d: 0.36, color: 0x3a3a5a, boot: 0x2a2018 }, c.leg);
  const body = new THREE.Group(); root.add(body);
  const hipY = L.h;
  const rig = { root, body, scale: s, height: (L.h + T.h + Hd.s) * s };

  // legs
  const mkLeg = (side) => {
    const g = new THREE.Group(); g.position.set(side * (T.w / 4 + L.w * 0.02), hipY, 0);
    const m = part(L.w, L.h, L.d, M(L.color), 't'); g.add(m);
    const boot = part(L.w * 1.06, L.h * 0.28, L.d * 1.1, M(L.boot), 't'); boot.position.set(0, -L.h * 0.72, L.d * 0.03); g.add(boot);
    body.add(g); return g;
  };
  rig.legL = mkLeg(-1); rig.legR = mkLeg(1);
  // torso
  const torsoG = new THREE.Group(); torsoG.position.y = hipY; body.add(torsoG); rig.torsoG = torsoG;
  rig.torso = part(T.w, T.h, T.d, M(T.color), 'b'); torsoG.add(rig.torso);
  rig.chestGear = new THREE.Group(); torsoG.add(rig.chestGear);
  // head
  const headG = new THREE.Group(); headG.position.y = T.h; torsoG.add(headG); rig.head = headG;
  const hm = M(Hd.color); const hs = Hd.s;
  const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(Hd.face), color: 0xffffff }); mats.push(faceMat);
  const backMat = M(Hd.hair !== undefined ? Hd.hair : Hd.color);
  const headMesh = new THREE.Mesh(boxGeo(hs, hs, hs, 'b'), [hm, hm, backMat, hm, faceMat, backMat]);
  headMesh.castShadow = true; headMesh.position.y = 0.02; headG.add(headMesh); rig.headMesh = headMesh;
  rig.headGear = new THREE.Group(); headG.add(rig.headGear); rig.headGear.position.y = hs * 0.5;
  rig.headTop = hs + 0.02;
  // arms
  const mkArm = (side) => {
    const g = new THREE.Group(); g.position.set(side * (T.w / 2 + A.w / 2 + 0.02), T.h - 0.08, 0);
    const a = part(A.w, A.h, A.d, M(A.color), 't'); g.add(a);
    const hand = part(A.w * 1.05, A.w * 0.9, A.d * 1.05, M(A.hand), 't'); hand.position.y = -A.h * 0.84; g.add(hand);
    const slot = new THREE.Group(); slot.position.set(0, -A.h * 0.9, 0.04); g.add(slot);
    g.userData.slot = slot; g.userData.armMesh = a;
    torsoG.add(g); return g;
  };
  rig.armL = mkArm(-1); rig.armR = mkArm(1);
  rig.handR = rig.armR.userData.slot; rig.handL = rig.armL.userData.slot;
  rig.shoulderL = new THREE.Group(); rig.shoulderR = new THREE.Group();
  rig.armL.add(rig.shoulderL); rig.armR.add(rig.shoulderR);
  root.scale.setScalar(s);
  makeMats(rig, mats);
  rig.cfg = c;
  return rig;
}

// ---------- hero looks (armour cosmetics)
export const LOOKS = {
  cloth:   { torso: 0x7a5a3a, leg: 0x4a3a2a, arm: 0x7a5a3a, boot: 0x2a1c12, trim: 0xc8a050, helm: 'cap', pad: 0, cape: 0x8a2a2a, glow: 0 },
  leather: { torso: 0x8a5a2a, leg: 0x5a3a1c, arm: 0x7a4a22, boot: 0x2a1c12, trim: 0xd8b060, helm: 'hood', pad: 1, cape: 0x3a5a2a, glow: 0 },
  chain:   { torso: 0x8a929e, leg: 0x4a505a, arm: 0x7a828e, boot: 0x2a2c32, trim: 0xd0d8e0, helm: 'iron', pad: 1, cape: 0x2a4a8a, glow: 0 },
  plate:   { torso: 0xb4bcc8, leg: 0x707a88, arm: 0xa4acb8, boot: 0x3a404a, trim: 0xf0f4fa, helm: 'knight', pad: 2, cape: 0x8a1a1a, glow: 0 },
  gilded:  { torso: 0xe0c040, leg: 0x9a7a20, arm: 0xd0b038, boot: 0x5a3a14, trim: 0xfff0a0, helm: 'horned', pad: 2, cape: 0x6a1a6a, glow: 0xffe070 },
  crystal: { torso: 0x4acfe6, leg: 0x2a7a96, arm: 0x3ab8d4, boot: 0x1a3a52, trim: 0xd8ffff, helm: 'crown', pad: 3, cape: 0x1a3a8a, glow: 0x6af0ff },
  obsidian:{ torso: 0x3a3450, leg: 0x1e1a2c, arm: 0x302a44, boot: 0x120e1c, trim: 0xa86aff, helm: 'horned', pad: 3, cape: 0x2a0a3a, glow: 0xb04aff },
  inferno: { torso: 0x7a2a1a, leg: 0x3a1410, arm: 0x6a2418, boot: 0x1a0a08, trim: 0xff8a2a, helm: 'crown', pad: 3, cape: 0x8a1408, glow: 0xff7a2a },
};
export const LOOK_IDS = Object.keys(LOOKS);

export function makeHero() {
  const rig = humanoid({ scale: 1, head: { face: 'hero', color: 0xe0a77a, hair: 0x4a2c17 }, torso: { color: 0x7a5a3a }, arm: { color: 0x7a5a3a, hand: 0xe0a77a }, leg: { color: 0x4a3a2a } });
  // cape
  const capeMat = lam(0x8a2a2a); rig.mats.push(capeMat); rig.capeMat = capeMat;
  const cape = new THREE.Group(); cape.position.set(0, 0.8, -0.26); rig.torsoG.add(cape);
  const cm = part(0.74, 1.15, 0.07, capeMat, 't'); cape.add(cm); rig.cape = cape;
  // hair top
  rig.hair = part(0.78, 0.2, 0.78, lam(0x4a2c17), 'b'); rig.hair.position.y = 0.58; rig.head.add(rig.hair); rig.mats.push(rig.hair.material);
  rig.hairBack = part(0.78, 0.5, 0.18, lam(0x4a2c17), 'b'); rig.hairBack.position.set(0, 0.18, -0.3); rig.head.add(rig.hairBack); rig.mats.push(rig.hairBack.material);
  // belt
  const belt = part(0.86, 0.12, 0.5, lam(0x3a2414), 'c'); belt.position.y = 0.06; rig.torsoG.add(belt); rig.belt = belt; rig.mats.push(belt.material);
  rig.look = null;
  return rig;
}

export function applyLook(rig, id) {
  if (rig.look === id) return;
  rig.look = id;
  const L = LOOKS[id] || LOOKS.cloth;
  const setc = (m, c) => m.color.setHex(c);
  setc(rig.torso.material, L.torso);
  setc(rig.armL.userData.armMesh.material, L.arm); setc(rig.armR.userData.armMesh.material, L.arm);
  for (const leg of [rig.legL, rig.legR]) { setc(leg.children[0].material, L.leg); setc(leg.children[1].material, L.boot); }
  rig.capeMat.color.setHex(L.cape);
  rig.belt.material.color.setHex(L.trim).multiplyScalar(0.7);
  const clear = (g) => { while (g.children.length) g.remove(g.children[0]); };
  clear(rig.headGear); clear(rig.chestGear); clear(rig.shoulderL); clear(rig.shoulderR);
  const metal = (c) => { const m = lam(c); rig.mats.push(m); return m; };
  const glowMat = L.glow ? emissiveMat(L.glow, 1.4) : null;
  const trim = metal(L.trim);
  const main = metal(L.torso);
  const hh = rig.headTop;
  rig.hair.visible = L.helm === 'cap' || L.helm === 'hood';
  rig.hairBack.visible = L.helm !== 'knight' && L.helm !== 'horned';
  switch (L.helm) {
    case 'cap': { const m = part(0.78, 0.14, 0.78, metal(L.torso), 'b'); m.position.y = -0.16; rig.headGear.add(m); const b = part(0.8, 0.07, 0.3, metal(L.torso), 'b'); b.position.set(0, -0.14, 0.45); rig.headGear.add(b); break; }
    case 'hood': { const m = part(0.84, 0.3, 0.84, metal(L.arm), 'b'); m.position.y = -0.3; rig.headGear.add(m); const bk = part(0.84, 0.6, 0.18, metal(L.arm), 'b'); bk.position.set(0, -0.58, -0.33); rig.headGear.add(bk); const sd = part(0.12, 0.55, 0.6, metal(L.arm), 'b'); sd.position.set(0.37, -0.56, -0.05); const sd2 = sd.clone(); sd2.position.x = -0.37; rig.headGear.add(sd, sd2); break; }
    case 'iron': { const m = part(0.82, 0.3, 0.82, main, 'b'); m.position.y = -0.3; rig.headGear.add(m); const n = part(0.1, 0.5, 0.1, trim, 'b'); n.position.set(0, -0.55, 0.42); rig.headGear.add(n); break; }
    case 'knight': { const m = part(0.84, 0.74, 0.84, main, 'b'); m.position.y = -0.72; rig.headGear.add(m); const v = part(0.7, 0.1, 0.06, metal(0x111118), 'c'); v.position.set(0, -0.36, 0.43); rig.headGear.add(v); const pl = part(0.1, 0.34, 0.5, trim, 'b'); pl.position.set(0, -0.22, 0); rig.headGear.add(pl); break; }
    case 'horned': { const m = part(0.84, 0.7, 0.84, main, 'b'); m.position.y = -0.7; rig.headGear.add(m); const v = part(0.7, 0.1, 0.06, glowMat || metal(0x111118), 'c'); v.position.set(0, -0.38, 0.43); rig.headGear.add(v); for (const sd of [-1, 1]) { const h1 = part(0.14, 0.34, 0.14, trim, 'b'); h1.position.set(sd * 0.46, -0.3, 0); h1.rotation.z = -sd * 0.4; const h2 = part(0.12, 0.3, 0.12, trim, 'b'); h2.position.set(sd * 0.62, -0.02, 0); h2.rotation.z = -sd * 0.9; rig.headGear.add(h1, h2); } break; }
    case 'crown': { const m = part(0.84, 0.5, 0.84, main, 'b'); m.position.y = -0.5; rig.headGear.add(m); for (let i = 0; i < 5; i++) { const sp = part(0.1, 0.24 + (i % 2) * 0.12, 0.1, glowMat || trim, 'b'); sp.position.set(-0.32 + i * 0.16, 0.0, i === 0 || i === 4 ? 0.3 : 0.38); rig.headGear.add(sp); } break; }
  }
  // chest
  if (L.pad >= 1) {
    const plate = part(0.9, 0.62, 0.54, main, 'b'); plate.position.y = 0.26; rig.chestGear.add(plate);
    const st = part(0.92, 0.1, 0.56, trim, 'b'); st.position.y = 0.8; rig.chestGear.add(st);
  }
  if (L.pad >= 2) {
    const em = part(0.2, 0.2, 0.06, glowMat || trim, 'c'); em.position.set(0, 0.55, 0.3); rig.chestGear.add(em);
  }
  for (const [g, sd] of [[rig.shoulderL, -1], [rig.shoulderR, 1]]) {
    if (L.pad >= 1) { const p = part(0.46, 0.16, 0.5, main, 'b'); p.position.set(sd * 0.02, 0.06, 0); g.add(p); }
    if (L.pad >= 2) { const p = part(0.5, 0.2, 0.54, trim, 'b'); p.position.set(sd * 0.04, 0.2, 0); g.add(p); }
    if (L.pad >= 3) { for (const k of [-0.14, 0.14]) { const sp = part(0.08, 0.3, 0.08, glowMat || trim, 'b'); sp.position.set(sd * 0.1, 0.32, k); g.add(sp); } }
  }
  rig.glowColor = L.glow;
}

// ---------- weapon mesh
export function makeWeaponMesh(item) {
  const grp = new THREE.Group();
  const sp = weaponSprite(item.type, item.variant || 0, item.tier || 1, item.palette);
  const geo = weaponGeometry(sp, `${item.type}_${item.variant || 0}_${item.tier || 1}_${item.palette ? item.id : ''}`);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.55, envMapIntensity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
  grp.add(mesh);
  const col = item.glow || (item.enchants && item.enchants[0] && item.enchants[0].color);
  if (col !== undefined && col !== null) {
    const gm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(geo, gm); glow.scale.setScalar(1.14); grp.add(glow); grp.userData.glow = glow;
  }
  mesh.rotation.y = sp.rot;
  if (grp.userData.glow) grp.userData.glow.rotation.y = sp.rot;
  const vox = 0.07;
  grp.userData.sp = sp;
  grp.userData.tipLocal = new THREE.Vector3(0, (sp.anchor[1]) * vox, 0); // top of sprite relative to anchor
  grp.userData.length = sp.anchor[1] * vox;
  grp.userData.type = item.type;
  return grp;
}

// icon renderer for UI (45deg rotated sprite)
const iconCache = new Map();
export function weaponIcon(item, size = 64) {
  const key = `${item.type}_${item.variant || 0}_${item.tier || 1}_${item.palette ? item.id : ''}_${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const sp = weaponSprite(item.type, item.variant || 0, item.tier || 1, item.palette);
  let rows = sp.grid.rows();
  const sc = Math.max(1, Math.floor(size / Math.max(sp.grid.w, sp.grid.h) * 0.95));
  const src = artCanvas(rows, sp.pal, sc);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.translate(size / 2, size / 2);
  if (item.type === 'bow') { x.rotate(0); x.scale(1, 1); }
  else x.rotate(Math.PI / 4);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  const url = c.toDataURL();
  iconCache.set(key, url); return url;
}

// ============================================================ enemy / boss models
function shaded(m, c) { return m; }

export function makeZombie(p) {
  const rig = humanoid({
    scale: p.scale || 1,
    head: { face: p.face || 'zombie', color: p.skin, hair: p.skin },
    torso: { color: p.shirt, w: 0.84, h: 0.92, d: 0.48 }, arm: { color: p.skin, hand: p.skin }, leg: { color: p.pants, boot: p.pants },
  });
  rig.armL.rotation.x = rig.armR.rotation.x = -1.35;
  if (p.rags) { const r = part(0.86, 0.22, 0.5, lam(p.rags), 'b'); r.position.y = 0.0; rig.torsoG.add(r); rig.mats.push(r.material); }
  return rig;
}
export function makeSkeleton(p) {
  const rig = humanoid({
    scale: p.scale || 1, head: { face: p.face || 'skeleton', color: p.bone, hair: p.bone },
    torso: { color: p.bone, w: 0.62, h: 0.9, d: 0.3 }, arm: { color: p.bone, hand: p.bone, w: 0.2, h: 0.9, d: 0.2 }, leg: { color: p.bone, boot: p.bone, w: 0.22, h: 0.9, d: 0.22 },
  });
  for (let i = 0; i < 4; i++) { const rb = part(0.7, 0.06, 0.34, lam(p.dark), 'c'); rb.position.y = 0.22 + i * 0.18; rig.torsoG.add(rb); rig.mats.push(rb.material); }
  const sp = part(0.1, 0.9, 0.1, lam(p.dark), 'b'); sp.position.set(0, 0.0, -0.08); rig.torsoG.add(sp); rig.mats.push(sp.material);
  return rig;
}
export function makeMarauder(p) {
  const rig = humanoid({
    scale: p.scale || 1.2, head: { face: 'marauder', color: p.skin, hair: p.skin, s: 0.74 },
    torso: { color: p.cloth, w: 1.0, h: 1.0, d: 0.56 }, arm: { color: p.cloth, hand: p.skin, w: 0.36, h: 0.9, d: 0.36 }, leg: { color: p.pants, boot: 0x2a2018, w: 0.4, h: 0.85, d: 0.4 },
  });
  const helm = part(0.8, 0.22, 0.8, lam(p.metal), 'b'); helm.position.y = 0.52 - 0.12; rig.head.add(helm); rig.mats.push(helm.material);
  for (const sd of [-1, 1]) { const h = part(0.14, 0.36, 0.14, lam(0xe8e0c8), 'b'); h.position.set(sd * 0.44, 0.34, 0); h.rotation.z = -sd * 0.5; rig.head.add(h); const h2 = part(0.12, 0.26, 0.12, lam(0xe8e0c8), 'b'); h2.position.set(sd * 0.6, 0.6, 0); h2.rotation.z = -sd * 1.0; rig.head.add(h2); }
  const plate = part(1.06, 0.5, 0.6, lam(p.metal), 'b'); plate.position.y = 0.44; rig.chestGear.add(plate); rig.mats.push(plate.material);
  for (const sd of [-1, 1]) { const pd = part(0.52, 0.2, 0.56, lam(p.metal), 'b'); pd.position.set(0, 0.04, 0); (sd < 0 ? rig.shoulderL : rig.shoulderR).add(pd); rig.mats.push(pd.material); }
  return rig;
}
export function makeHexer(p) {
  const rig = humanoid({
    scale: p.scale || 1.05, head: { face: 'hexer', color: p.skin, hair: p.skin, s: 0.74 },
    torso: { color: p.robe, w: 0.84, h: 1.3, d: 0.5 }, arm: { color: p.robe, hand: p.skin, w: 0.28, h: 0.8, d: 0.28 }, leg: { color: p.robe, boot: p.robe, w: 0.5, h: 0.5, d: 0.5 },
  });
  const skirt = part(1.0, 0.7, 0.66, lam(p.robe2), 't'); skirt.position.y = 0.2; rig.torsoG.add(skirt); rig.mats.push(skirt.material);
  const hat = part(0.9, 0.12, 0.9, lam(p.robe2), 'b'); hat.position.y = 0.52 - 0.04; rig.head.add(hat); rig.mats.push(hat.material);
  const hat2 = part(0.6, 0.5, 0.6, lam(p.robe2), 'b'); hat2.position.y = 0.6; rig.head.add(hat2); rig.mats.push(hat2.material);
  const gem = part(0.14, 0.14, 0.14, emissiveMat(p.gem, 1.5), 'c'); gem.position.set(0, 0.16, 0.32); rig.chestGear.add(gem);
  rig.armL.rotation.x = rig.armR.rotation.x = -0.5;
  return rig;
}
export function makeGolem(p) {
  const s = p.scale || 1.6;
  const rig = humanoid({
    scale: s, head: { face: p.face || 'golem', color: p.stone, hair: p.stone, s: 0.62 },
    torso: { color: p.stone, w: 1.2, h: 1.1, d: 0.8 }, arm: { color: p.stone2 || p.stone, hand: p.stone2 || p.stone, w: 0.5, h: 1.2, d: 0.5 }, leg: { color: p.stone2 || p.stone, boot: p.stone, w: 0.5, h: 0.9, d: 0.5 },
  });
  if (p.glow) {
    const gm = emissiveMat(p.glow, 1.5);
    for (let i = 0; i < 4; i++) { const v = part(0.9 - i * 0.1, 0.08, 0.06, gm, 'c'); v.position.set(0, 0.2 + i * 0.22, 0.41); rig.torsoG.add(v); }
    const core = part(0.26, 0.26, 0.1, gm, 'c'); core.position.set(0, 0.6, 0.42); rig.torsoG.add(core);
    rig.glowMat = gm;
  }
  for (const sd of [-1, 1]) { const sh = part(0.62, 0.34, 0.7, lam(p.stone), 'b'); sh.position.set(0, 0.1, 0); (sd < 0 ? rig.shoulderL : rig.shoulderR).add(sh); rig.mats.push(sh.material); }
  return rig;
}

export function makeKeg() {
  const rig = { root: new THREE.Group(), mats: [] };
  const m = (c, o) => { const x = lam(c, o); rig.mats.push(x); return x; };
  const body = new THREE.Group(); rig.root.add(body); rig.body = body;
  const keg = part(0.9, 0.9, 0.9, m(0xb5702a), 'b'); keg.position.y = 0.3; body.add(keg);
  for (const y of [0.45, 1.0]) { const band = part(0.96, 0.1, 0.96, m(0x2a2a30), 'c'); band.position.y = y; body.add(band); }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshLambertMaterial({ map: faceTexture('keg'), transparent: true })); face.position.set(0, 0.78, 0.46); body.add(face); rig.mats.push(face.material);
  rig.legL = part(0.26, 0.3, 0.26, m(0x3a2a20), 't'); rig.legL.position.set(-0.2, 0.32, 0); rig.legR = part(0.26, 0.3, 0.26, m(0x3a2a20), 't'); rig.legR.position.set(0.2, 0.32, 0);
  body.add(rig.legL, rig.legR);
  const fuse = part(0.08, 0.3, 0.08, m(0x2a2018), 'b'); fuse.position.y = 1.2; body.add(fuse);
  const spark = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffb030 })); spark.position.y = 1.52; body.add(spark); rig.spark = spark;
  rig.height = 1.5; rig.setFlash = (v) => { for (const x of rig.mats) if (x.emissive) x.emissive.setRGB(v, v, v); };
  return rig;
}

export function makeSpider(p) {
  const rig = { root: new THREE.Group(), mats: [], legs: [] };
  const m = (c) => { const x = lam(c); rig.mats.push(x); return x; };
  const body = new THREE.Group(); body.position.y = 0.45; rig.root.add(body); rig.body = body;
  const bm = m(p.body); const thorax = part(0.8, 0.5, 0.8, bm, 'c'); body.add(thorax);
  const abdomen = part(0.95, 0.65, 1.0, m(p.abd), 'c'); abdomen.position.set(0, 0.1, -0.85); body.add(abdomen);
  const head = new THREE.Mesh(boxGeo(0.6, 0.5, 0.5, 'c'), [bm, bm, bm, bm, new THREE.MeshLambertMaterial({ map: faceTexture('spider') }), bm]); head.position.set(0, 0, 0.62); head.castShadow = true; body.add(head); rig.mats.push(head.material[4]);
  const legMat = m(p.leg);
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sd * 0.36, 0, 0.3 - i * 0.28);
    const up = part(0.7, 0.12, 0.12, legMat, 'c'); up.position.x = sd * 0.35; g.add(up);
    const lo = part(0.12, 0.7, 0.12, legMat, 't'); lo.position.set(sd * 0.7, 0, 0); g.add(lo);
    g.userData.base = (i - 1.5) * 0.4 * sd; g.userData.side = sd; g.userData.i = i;
    body.add(g); rig.legs.push(g);
  }
  rig.height = 1.0; rig.setFlash = (v) => { for (const x of rig.mats) if (x.emissive) x.emissive.setRGB(v, v, v); };
  return rig;
}

export function makeSlime(p) {
  const rig = { root: new THREE.Group(), mats: [] };
  const body = new THREE.Group(); rig.root.add(body); rig.body = body;
  const inner = new THREE.MeshLambertMaterial({ color: p.core, emissive: 0x000000 }); rig.mats.push(inner);
  const outerMat = new THREE.MeshLambertMaterial({ color: p.color, transparent: true, opacity: 0.62, emissive: 0x000000 }); rig.mats.push(outerMat);
  const core = part(0.55, 0.55, 0.55, inner, 'b'); core.position.y = 0.2; body.add(core);
  const outer = new THREE.Mesh(boxGeo(1.1, 1.0, 1.1, 'b'), outerMat); outer.castShadow = true; body.add(outer); rig.outer = outer;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: faceTexture('slime'), transparent: true, opacity: 0.9 })); face.position.set(0, 0.45, 0.56); body.add(face);
  rig.height = 1.0; rig.setFlash = (v) => { for (const x of rig.mats) if (x.emissive) x.emissive.setRGB(v, v, v); };
  return rig;
}

export function makeWraith(p) {
  const rig = { root: new THREE.Group(), mats: [] };
  const m = (c, o) => { const x = new THREE.MeshLambertMaterial(Object.assign({ color: c, transparent: true, opacity: 0.88, emissive: 0x000000 }, o)); rig.mats.push(x); return x; };
  const body = new THREE.Group(); rig.root.add(body); rig.body = body; body.position.y = 1.0;
  const head = new THREE.Mesh(boxGeo(0.78, 0.78, 0.78, 'c'), new THREE.MeshLambertMaterial({ map: faceTexture('wraith'), transparent: true, opacity: 0.95 })); head.position.y = 1.0; head.castShadow = true; body.add(head); rig.mats.push(head.material);
  rig.head = head;
  const tail = [];
  for (let i = 0; i < 5; i++) { const s = 0.9 - i * 0.16; const t = part(s, 0.4, s * 0.8, m(p.color, { opacity: 0.8 - i * 0.12 }), 'c'); t.position.y = 0.5 - i * 0.38; t.castShadow = false; body.add(t); tail.push(t); }
  rig.tail = tail;
  for (const sd of [-1, 1]) { const a = part(0.2, 0.9, 0.2, m(p.color), 't'); a.position.set(sd * 0.55, 0.9, 0.1); a.rotation.x = -0.6; body.add(a); rig['arm' + (sd < 0 ? 'L' : 'R')] = a; }
  rig.height = 2.0; rig.setFlash = (v) => { for (const x of rig.mats) if (x.emissive) x.emissive.setRGB(v, v, v); };
  return rig;
}

export function makeCinder(p) {
  const rig = { root: new THREE.Group(), mats: [] };
  const body = new THREE.Group(); rig.root.add(body); rig.body = body; body.position.y = 1.2;
  const core = new THREE.Mesh(boxGeo(0.8, 0.8, 0.8, 'c'), [0, 1, 2, 3, 4, 5].map(() => null)); rig.mats = [];
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture('imp') });
  const sideMat = new THREE.MeshBasicMaterial({ color: p.color });
  core.material = [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat]; body.add(core);
  rig.core = core;
  rig.rods = [];
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(boxGeo(0.14, 0.7, 0.14, 'c'), new THREE.MeshBasicMaterial({ color: p.rod })); body.add(r); rig.rods.push(r);
  }
  rig.flashMats = [sideMat];
  rig.height = 2.2;
  rig.setFlash = (v) => { sideMat.color.setHex(p.color).lerp(new THREE.Color(0xffffff), clamp(v, 0, 1)); };
  return rig;
}

// ============================================================ bosses
export function makeBoss(id) {
  switch (id) {
    case 'rotking': {
      const r = makeZombie({ scale: 2.4, skin: 0x5a8a44, shirt: 0x6a2a8a, pants: 0x3a2a4a, rags: 0x2a1a3a, face: 'king' });
      const crown = new THREE.Group(); crown.position.y = 0.72; r.head.add(crown);
      const base = part(0.84, 0.16, 0.84, lam(0xffd23a), 'b'); crown.add(base); r.mats.push(base.material);
      for (let i = 0; i < 5; i++) { const sp = part(0.12, 0.3, 0.12, emissiveMat(0xffd23a, 1.3), 'b'); sp.position.set(-0.3 + i * 0.15, 0.14, i % 4 === 0 ? 0.3 : 0.1); crown.add(sp); }
      const cape = part(1.0, 1.5, 0.08, lam(0x6a1a1a), 't'); cape.position.set(0, 0.95, -0.28); r.torsoG.add(cape); r.mats.push(cape.material); r.cape = cape;
      return r;
    }
    case 'lich': {
      const r = makeSkeleton({ scale: 2.3, bone: 0xcfc8d8, dark: 0x4a3a5a, face: 'skeleton' });
      const robe = part(1.0, 1.4, 0.6, lam(0x2a1a4a), 't'); robe.position.y = 0.4; r.torsoG.add(robe); r.mats.push(robe.material);
      const hood = part(0.95, 0.9, 0.95, lam(0x2a1a4a), 'b'); hood.position.y = -0.1; r.head.add(hood); r.mats.push(hood.material);
      const eyes = part(0.5, 0.1, 0.05, emissiveMat(0x7dffb0, 1.8), 'c'); eyes.position.set(0, 0.36, 0.44); r.head.add(eyes);
      return r;
    }
    case 'sandtyrant': {
      const r = makeGolem({ scale: 2.4, stone: 0xd9b565, stone2: 0xb8924a, glow: 0xff7a1a, face: 'golem' });
      for (let i = 0; i < 3; i++) { const sp = part(0.2, 0.7 + i * 0.2, 0.2, lam(0xffd23a), 'b'); sp.position.set((i - 1) * 0.4, 0.58, -0.1); r.head.add(sp); r.mats.push(sp.material); }
      return r;
    }
    case 'frostwarden': {
      const r = makeGolem({ scale: 2.5, stone: 0x9fcdf0, stone2: 0x6aa8d8, glow: 0x9ff4ff, face: 'golem' });
      for (const sd of [-1, 1]) { for (let i = 0; i < 3; i++) { const sp = part(0.16, 0.6 + i * 0.1, 0.16, emissiveMat(0xcff8ff, 1.2), 'b'); sp.position.set(sd * (0.18 + i * 0.16), 0.02, 0); sp.rotation.z = -sd * (0.3 + i * 0.25); (sd < 0 ? r.shoulderL : r.shoulderR).add(sp); } }
      return r;
    }
    case 'magmatitan': {
      const r = makeGolem({ scale: 2.7, stone: 0x3a2a2e, stone2: 0x2a1c20, glow: 0xff6a1a, face: 'golem' });
      for (const sd of [-1, 1]) { const h = part(0.18, 0.5, 0.18, emissiveMat(0xff7a1a, 1.4), 'b'); h.position.set(sd * 0.34, 0.6, 0); h.rotation.z = -sd * 0.35; r.head.add(h); }
      return r;
    }
    case 'voidlord': {
      const r = makeHexer({ scale: 2.5, skin: 0x7a4aa8, robe: 0x1c0f30, robe2: 0x341a5a, gem: 0xe08aff });
      r.head.children[0].material[4] = new THREE.MeshLambertMaterial({ map: faceTexture('voidlord') });
      r.orbs = [];
      for (let i = 0; i < 4; i++) { const o = part(0.34, 0.34, 0.34, emissiveMat(0xd070ff, 1.5), 'c'); r.root.add(o); r.orbs.push(o); }
      return r;
    }
  }
  return makeGolem({ stone: 0x888888 });
}

// ============================================================ misc voxel props used by world
export function shadowBlob(size = 1.4, opacity = 0.7) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: FX.shadow, transparent: true, depthWrite: false, opacity }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.renderOrder = 1;
  return m;
}
