import * as THREE from 'three';
import './style.css';
import { Engine } from './engine.js';
import { initFxTextures } from './textures.js';
import { Effects } from './fx.js';
import { generateCamp, generateDungeon, buildLevelMeshes, BIOMES, CS } from './world.js';
import { populateCamp, populateLevel } from './decor.js';
import { makeHero, applyLook, makeWeaponMesh, makeZombie, makeSkeleton, makeKeg, makeSpider, makeSlime, makeWraith, makeCinder, makeMarauder, makeHexer, makeBoss } from './voxel.js';
import { RNG } from './util.js';

const eng = new Engine(document.getElementById('game'));
initFxTextures();
eng.setQuality('high');
const q = new URLSearchParams(location.search);
const biomeId = q.get('biome') || 'camp';
const B = BIOMES[biomeId];
eng.setBiome(B);
const fx = new Effects(eng.scene, eng.camera); eng.fx = fx;
const rng = new RNG(7);
let L;
if (biomeId === 'camp') { L = generateCamp(); } else { L = generateDungeon(rng, { biome: B, size: 'medium' }); }
buildLevelMeshes(L, rng, eng.wallUniforms);
if (biomeId === 'camp') populateCamp(L, rng); else populateLevel(L, rng);
eng.scene.add(L.group);
const hero = makeHero(); applyLook(hero, q.get('look') || 'plate');
hero.root.position.set(L.start.x, 0, L.start.z); eng.scene.add(hero.root);
const sw = makeWeaponMesh({ type: 'sword', variant: 2, tier: 3, glow: 0x66e0ff }); sw.envMap && 0;
sw.children[0].material.envMap = eng.envMap;
hero.handR.add(sw); sw.rotation.x = 1.0;
hero.armR.rotation.x = -0.6;
// show enemies lined up
const mk = [makeZombie({ skin: 0x5f9a4a, shirt: 0x2a6a8a, pants: 0x3a3a6a }), makeSkeleton({ bone: 0xd8d8cc, dark: 0x6a6a60 }), makeKeg(), makeSpider({ body: 0x2a2530, abd: 0x3a2a40, leg: 0x1a1620 }), makeSlime({ color: 0x6fdc5a, core: 0x3aa030 }), makeWraith({ color: 0x7ea0c8 }), makeCinder({ color: 0xff6a20, rod: 0xffc040 }), makeMarauder({ skin: 0x8aa08a, cloth: 0x4a3a5a, pants: 0x2a2a3a, metal: 0x7a808a }), makeHexer({ skin: 0x8aa08a, robe: 0x5a3a8a, robe2: 0x3a2060, gem: 0x7cffb0 })];
mk.forEach((m, i) => { m.root.position.set(L.start.x + 2.5 + (i % 5) * 2.4 - 6, 0, L.start.z - 3 - Math.floor(i / 5) * 3); m.root.rotation.y = 0.4; eng.scene.add(m.root); });
const bosses = ['rotking', 'lich', 'sandtyrant', 'frostwarden', 'magmatitan', 'voidlord'].map((id, i) => { const b = makeBoss(id); b.root.position.set(L.start.x - 10 + i * 4.2, 0, L.start.z + 6); eng.scene.add(b.root); return b; });
eng.camTarget.set(L.start.x, 0, L.start.z + (q.get('cz') ? +q.get('cz') : 0)); eng.snapCamera(eng.camTarget.x, eng.camTarget.z);
eng.setZoom(+(q.get('zoom') || 1));
let t = 0; let last = performance.now();
for (const tt of L.torches) { }
function loop() {
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  hero.armL.rotation.x = Math.sin(t * 2) * 0.2;
  eng.update(dt, hero.root.position); L.update(dt, t);
  for (const tt of L.torches) { const f = 0.85 + Math.sin(t * 12 + tt.seed) * 0.15; tt.flame.scale.set(f, 0.9 + Math.sin(t * 9 + tt.seed * 2) * 0.25, f); }
  eng.lightTorches(L.torches, hero.root.position.x, hero.root.position.z, t);
  fx.update(dt); eng.render();
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(loop);
}
window.__eng = eng; window.__fx = fx; window.__L = L;
loop();
