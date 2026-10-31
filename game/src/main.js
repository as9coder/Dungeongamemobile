import './style.css';
import { Engine } from './engine.js';
import { initFxTextures } from './textures.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { loadSave } from './save.js';
import { A } from './audio.js';
import * as DATA from './data.js';

const container = document.getElementById('game');
const eng = new Engine(container);
initFxTextures();
const save = loadSave();
const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1100);
const q = save.settings.quality;
const params = new URLSearchParams(location.search);
const forced = params.get('q');
if (forced) { save.settings.quality = forced; }
if (q === 'auto' && !forced) { eng.resScale = mobile ? 0.85 : 1; eng.setQuality(mobile ? 'medium' : 'high'); }
else { const qq = forced || q; eng.manualQuality = true; eng.resScale = qq === 'low' ? 0.75 : 1; eng.setQuality(qq === 'auto' ? 'high' : qq); }
eng.onResize();

const game = new Game(eng, save);
const ui = new UI(game);
game.setUI(ui);
game.loadCamp();
game.titleMode = true;
if (params.get('skip')) { ui.title.classList.add('hide'); game.titleMode = false; ui.mode = 'hud'; }

const SIM = Math.max(1, Math.min(8, +(params.get('sim') || 1)));
let last = performance.now();
let errCount = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  try {
    if (game.titleMode) { eng.camYaw += rdt * 0.1; }
    ui.update(rdt);
    for (let i = 0; i < SIM; i++) game.update(rdt);
    eng.render();
    eng.adapt(rdt * 1000);
  } catch (e) {
    if (errCount++ < 5) console.error('frame error', e && e.stack || e);
    window.__errors = (window.__errors || []).concat(String(e && e.message));
  }
  window.__frames = (window.__frames || 0) + 1;
}
requestAnimationFrame(frame);
window.__data = DATA; window.__game = game; window.__ui = ui; window.__eng = eng;
window.addEventListener('error', (e) => { window.__errors = (window.__errors || []).concat(e.message + ' @' + e.filename + ':' + e.lineno); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game.mode === 'mission' && !ui.modal) ui.showPause(); });
