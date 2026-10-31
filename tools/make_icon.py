#!/usr/bin/env python3
"""Generate the launcher icon (pixel-art knight helm + sword, voxel style)."""
from PIL import Image, ImageDraw, ImageFilter
import sys, os
N = 32; S = 6  # 32x32 pixel art, upscaled to 192
img = Image.new("RGB", (N, N))
px = img.load()
# sunset dungeon gradient
for y in range(N):
    for x in range(N):
        t = y / (N - 1)
        r = int(34 + 150 * t * t); g = int(14 + 60 * t); b = int(70 - 20 * t)
        d = ((x - 16) ** 2 + (y - 15) ** 2) ** .5
        glow = max(0, 1 - d / 17) ** 2
        px[x, y] = (min(255, r + int(120 * glow)), min(255, g + int(70 * glow)), min(255, b + int(20 * glow)))
def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= x < N and 0 <= y < N: px[x, y] = c
# helmet
iron = (150, 160, 175); dark = (80, 88, 104); light = (205, 214, 226); visor = (22, 24, 36)
rect(9, 8, 22, 23, iron); rect(9, 8, 22, 9, light); rect(9, 8, 10, 23, light); rect(21, 10, 22, 23, dark)
rect(8, 10, 8, 20, dark); rect(23, 10, 23, 20, dark)
rect(11, 14, 20, 17, visor); rect(15, 10, 16, 23, dark) if False else None
rect(15, 18, 16, 23, dark)
rect(11, 18, 13, 21, iron); rect(18, 18, 20, 21, iron)
# crest
rect(14, 4, 17, 7, (220, 50, 50)); rect(15, 3, 16, 3, (255, 110, 90))
# eyes glow
rect(12, 15, 13, 16, (80, 255, 220)); rect(18, 15, 19, 16, (80, 255, 220))
# sword behind (diagonal)
for i in range(14):
    x = 4 + i; y = 27 - i
    c = (120, 235, 255) if i % 3 else (220, 255, 255)
    if 0 <= y < N and 0 <= x < N:
        px[x, y] = c
        if x + 1 < N: px[x + 1, y] = (70, 170, 220)
rect(2, 28, 4, 30, (120, 70, 30)); rect(5, 26, 7, 28, (200, 160, 40))
# sparkles
for (x, y) in [(26, 5), (4, 6), (27, 24), (6, 14)]:
    rect(x, y, x, y, (255, 250, 200)); rect(x - 1, y, x - 1, y, (255, 200, 120)); rect(x + 1, y, x + 1, y, (255, 200, 120))
img = img.resize((N * S, N * S), Image.NEAREST)
out = sys.argv[1]
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out)
print("icon ->", out)
