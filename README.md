# Voxel Delvers

A Minecraft-Dungeons-style mobile action RPG: isometric voxel dungeon crawling, quests, boss fights, loot and
weapon progression. Built with WebGL (three.js), bundled into a native Android shell (WebView).

**Download:** `releases/VoxelDelvers.apk` (sideload; Android 7.0+, landscape).

## Features
- 6 hand-themed biomes (Meadow, Crypt, Sanctum, Frost, Inferno, Void) with procedurally generated dungeons
- 6 missions with objectives (kill, spawners, beacons, shard carriers) + 6 unique bosses with multi-phase patterns
- 7 weapon types (sword, dagger, axe, hammer, spear, bow, crossbow), 3 rarities, 10 enchantments with FX, upgrades and reforging
- 8 armor sets (visibly change the hero), 6 artifacts (flame, lightning, frost nova, totem, meteors, blade cyclone)
- Walkable camp hub: mission map, blacksmith, merchant, quest board; persistent side quests
- Post-processing (MSAA, bloom, grading), dynamic shadows, GPU particles, weapon trails, hit-stop, screen shake
- Fully procedural audio (SFX + adaptive music) and procedural pixel textures: zero asset files
- Touch controls: floating stick, attack/roll/ranged/artifact/potion buttons, left-hand mode

## Build
```
# web bundle
cd game && npm install && node build.mjs
# Android (no Android SDK needed): needs .toolchain/{android-all.jar,dx.jar,apksig.jar}
python3 tools/build_apk.py releases/VoxelDelvers.apk
```
`tools/build_apk.py` compiles the Java shell with `javac`, dexes with `dx`, generates the binary manifest and
resource table itself, and signs with APK Signature Scheme v2 (`apksig`).

Desktop testing: open `game/dist/index.html` (WASD move, J attack, K shoot, Space roll, 1-3 artifacts, Q potion, E use).
