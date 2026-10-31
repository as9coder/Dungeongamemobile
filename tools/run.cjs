// Usage: node tools/run.cjs <scenario.cjs> [query]   scenario exports async ({page, shot, wait, ev, logs}) => {}
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const scen = require(path.resolve(process.argv[2]));
  const query = process.argv[3] || '';
  const W = scen.W || 1280, H = scen.H || 590;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: !!scen.touch });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'debug') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  await page.goto(scen.url ? scen.url + (query ? '?' + query : '') : 'file://' + path.resolve(__dirname, '../game/dist/index.html') + (query ? '?' + query : ''));
  const out = scen.out || '/tmp/shot';
  const shot = async (n) => { await page.screenshot({ path: `${out}_${n}.png` }); };
  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (f, a) => page.evaluate(f, a);
  try { await scen.run({ page, shot, wait, ev, logs }); } catch (e) { logs.push('SCENARIO ERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')); }
  const errs = await page.evaluate(() => window.__errors || []);
  console.log('frames', await page.evaluate(() => window.__frames));
  if (errs.length) console.log('window errors:', errs.join('\n'));
  console.log(logs.slice(0, 40).join('\n'));
  await browser.close();
})();
