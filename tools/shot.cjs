// Usage: node tools/shot.cjs <out.png> [query] [waitMs] [w] [h]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'shot.png', query = process.argv[3] || '', wait = +(process.argv[4] || 4000);
  const W = +(process.argv[5] || 1280), H = +(process.argv[6] || 590);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  await page.goto('file://' + path.resolve(__dirname, '../game/dist/index.html') + (query ? '?' + query : ''));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out });
  console.log('frames', await page.evaluate(() => window.__frames));
  console.log(logs.slice(0, 25).join('\n'));
  await browser.close();
})();
