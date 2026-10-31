// Fully procedural audio: SFX + generative music (no asset files)
let ctx = null, master, sfxBus, musBus, comp, noiseBuf;
const state = { sfxVol: 0.8, musVol: 0.5, mode: null, timer: 0, step: 0, nextT: 0, playing: false, intensity: 0 };

function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export const A = {
  unlock() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp); comp.connect(ctx.destination);
        sfxBus = ctx.createGain(); sfxBus.gain.value = state.sfxVol; sfxBus.connect(master);
        musBus = ctx.createGain(); musBus.gain.value = state.musVol * 0.5; musBus.connect(master);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; return; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (state.pending) { const m = state.pending; state.pending = null; A.music(m); }
  },
  setVolumes(sfx, mus) { state.sfxVol = sfx; state.musVol = mus; if (sfxBus) { sfxBus.gain.value = sfx; musBus.gain.value = mus * 0.5; } },
  pause(p) { if (!ctx) return; if (p) ctx.suspend(); else ctx.resume(); },

  // ---------- primitives
  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, attack = 0.005, delay = 0, bus = null, lp = 0 } = {}) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = o; if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
    n.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, { vol = 0.3, f0 = 1000, f1 = 1000, q = 1, type = 'bandpass', delay = 0, attack = 0.003, bus = null } = {}) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },

  sfx(name, v = 1) {
    if (!ctx || state.sfxVol <= 0) return;
    const r = () => 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'swing': this.noise(0.18, { vol: 0.22 * v, f0: 700 * r(), f1: 2600, q: 0.8 }); break;
      case 'swing2': this.noise(0.22, { vol: 0.26 * v, f0: 500 * r(), f1: 2000, q: 0.7 }); this.tone(140, 0.2, { type: 'sawtooth', vol: 0.05 * v, slide: -60 }); break;
      case 'hit': this.noise(0.12, { vol: 0.35 * v, f0: 900, f1: 200, q: 0.6 }); this.tone(180 * r(), 0.12, { type: 'square', vol: 0.18 * v, slide: -110 }); break;
      case 'crit': this.noise(0.2, { vol: 0.4 * v, f0: 1500, f1: 200 }); this.tone(220, 0.16, { type: 'square', vol: 0.2 * v, slide: -130 }); this.tone(1320, 0.3, { type: 'triangle', vol: 0.18 * v, delay: 0.02 }); this.tone(1980, 0.25, { type: 'sine', vol: 0.12 * v, delay: 0.04 }); break;
      case 'kill': this.noise(0.25, { vol: 0.3 * v, f0: 700, f1: 90 }); this.tone(120, 0.25, { type: 'square', vol: 0.16 * v, slide: -80 }); break;
      case 'shoot': this.tone(520 * r(), 0.16, { type: 'sawtooth', vol: 0.12 * v, slide: -330, lp: 2400 }); this.noise(0.1, { vol: 0.12 * v, f0: 3000, f1: 800 }); break;
      case 'bolt': this.tone(300, 0.2, { type: 'square', vol: 0.14 * v, slide: -180 }); this.noise(0.12, { vol: 0.18 * v, f0: 2000, f1: 500 }); break;
      case 'roll': this.noise(0.28, { vol: 0.2 * v, f0: 300, f1: 1400, q: 0.5, type: 'lowpass' }); break;
      case 'hurt': this.tone(160, 0.28, { type: 'sawtooth', vol: 0.26 * v, slide: -90, lp: 900 }); this.noise(0.15, { vol: 0.2 * v, f0: 500, f1: 120 }); break;
      case 'die': this.tone(300, 0.9, { type: 'sawtooth', vol: 0.25 * v, slide: -240, lp: 900 }); this.noise(0.6, { vol: 0.2 * v, f0: 600, f1: 60 }); break;
      case 'emerald': this.tone(1320, 0.1, { type: 'triangle', vol: 0.14 * v }); this.tone(1760, 0.18, { type: 'triangle', vol: 0.14 * v, delay: 0.06 }); break;
      case 'pickup': this.tone(660, 0.1, { type: 'square', vol: 0.1 * v }); this.tone(990, 0.16, { type: 'square', vol: 0.1 * v, delay: 0.07 }); break;
      case 'heart': this.tone(520, 0.2, { type: 'sine', vol: 0.2 * v, slide: 400 }); this.tone(780, 0.3, { type: 'sine', vol: 0.16 * v, delay: 0.1, slide: 300 }); break;
      case 'loot': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.16 * v, delay: i * 0.07 })); break;
      case 'chest': [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.15 * v, delay: i * 0.06 })); this.noise(0.3, { vol: 0.1, f0: 300, f1: 1200 }); break;
      case 'levelup': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => { this.tone(f, 0.5, { type: 'triangle', vol: 0.18 * v, delay: i * 0.09 }); this.tone(f * 2, 0.4, { type: 'sine', vol: 0.06 * v, delay: i * 0.09 }); }); break;
      case 'click': this.tone(880, 0.05, { type: 'square', vol: 0.08 * v }); break;
      case 'open': this.tone(440, 0.08, { type: 'square', vol: 0.08 * v }); this.tone(660, 0.1, { type: 'square', vol: 0.08 * v, delay: 0.05 }); break;
      case 'deny': this.tone(180, 0.18, { type: 'square', vol: 0.12 * v, slide: -40 }); break;
      case 'buy': this.tone(1200, 0.06, { type: 'square', vol: 0.1 * v }); this.tone(1600, 0.1, { type: 'square', vol: 0.1 * v, delay: 0.05 }); this.noise(0.1, { vol: 0.08, f0: 4000, f1: 2000 }); break;
      case 'upgrade': this.noise(0.4, { vol: 0.2 * v, f0: 800, f1: 4000 }); [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.15 * v, delay: 0.1 + i * 0.07 })); this.tone(100, 0.2, { type: 'square', vol: 0.15 * v, slide: -50 }); break;
      case 'explode': this.noise(0.7, { vol: 0.6 * v, f0: 1400, f1: 40, q: 0.4, type: 'lowpass' }); this.tone(90, 0.5, { type: 'sine', vol: 0.5 * v, slide: -60 }); break;
      case 'fire': this.noise(0.5, { vol: 0.3 * v, f0: 1800, f1: 600, q: 0.5 }); this.tone(110, 0.4, { type: 'sawtooth', vol: 0.08 * v, lp: 500 }); break;
      case 'zap': this.noise(0.25, { vol: 0.35 * v, f0: 4000, f1: 600, q: 0.8, type: 'highpass' }); this.tone(900, 0.2, { type: 'sawtooth', vol: 0.12 * v, slide: -700 }); break;
      case 'freeze': this.noise(0.45, { vol: 0.2 * v, f0: 6000, f1: 2000, type: 'highpass' }); [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.4, { type: 'sine', vol: 0.1 * v, delay: i * 0.03 })); break;
      case 'heal': [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.4, { type: 'sine', vol: 0.15 * v, delay: i * 0.08 })); break;
      case 'meteor': this.tone(900, 0.6, { type: 'sawtooth', vol: 0.1 * v, slide: -800, lp: 1800 }); this.noise(0.5, { vol: 0.15 * v, f0: 2500, f1: 300 }); break;
      case 'whirl': this.noise(0.35, { vol: 0.25 * v, f0: 500, f1: 2500, q: 1.5 }); break;
      case 'slam': this.tone(70, 0.5, { type: 'sine', vol: 0.55 * v, slide: -40 }); this.noise(0.4, { vol: 0.4 * v, f0: 800, f1: 60, type: 'lowpass' }); break;
      case 'roar': this.tone(90, 1.2, { type: 'sawtooth', vol: 0.3 * v, slide: -30, lp: 600 }); this.tone(135, 1.0, { type: 'sawtooth', vol: 0.2 * v, slide: -40, lp: 500 }); this.noise(1.0, { vol: 0.2 * v, f0: 400, f1: 100, type: 'lowpass' }); break;
      case 'telegraph': this.tone(440, 0.25, { type: 'triangle', vol: 0.1 * v, slide: 220 }); break;
      case 'break': this.noise(0.25, { vol: 0.35 * v, f0: 1200, f1: 200, q: 0.5 }); this.tone(200, 0.1, { type: 'square', vol: 0.1 * v, slide: -100 }); break;
      case 'spawner': this.noise(0.8, { vol: 0.4 * v, f0: 2000, f1: 80, type: 'lowpass' }); this.tone(60, 0.8, { type: 'sawtooth', vol: 0.25 * v, slide: -30 }); [880, 1100, 1320].forEach((f, i) => this.tone(f, 0.3, { type: 'sine', vol: 0.1, delay: i * 0.05 })); break;
      case 'portal': [262, 330, 392, 523].forEach((f, i) => this.tone(f, 0.9, { type: 'sine', vol: 0.14 * v, delay: i * 0.12, attack: 0.1 })); break;
      case 'beacon': this.tone(330, 0.6, { type: 'triangle', vol: 0.18 * v, slide: 330 }); this.noise(0.5, { vol: 0.15 * v, f0: 500, f1: 3000 }); break;
      case 'summon': this.tone(200, 0.6, { type: 'sawtooth', vol: 0.15 * v, slide: 400, lp: 1200 }); this.noise(0.5, { vol: 0.15 * v, f0: 3000, f1: 300 }); break;
      case 'step': this.noise(0.05, { vol: 0.05 * v, f0: 400 * r(), f1: 150, q: 1 }); break;
      case 'victory': [392, 494, 587, 784, 988, 1175].forEach((f, i) => { this.tone(f, 0.7, { type: 'triangle', vol: 0.18 * v, delay: i * 0.13 }); }); break;
      case 'defeat': [392, 330, 262, 196].forEach((f, i) => { this.tone(f, 0.8, { type: 'sawtooth', vol: 0.12 * v, delay: i * 0.25, lp: 800 }); }); break;
    }
  },

  // ---------- music
  music(mode) {
    if (!ctx) { state.pending = mode; return; }
    if (state.mode === mode && state.playing) return;
    state.mode = mode; state.step = 0; state.nextT = ctx.currentTime + 0.1; state.playing = true;
    if (!state.timer) state.timer = setInterval(() => A._sched(), 90);
  },
  stopMusic() { state.playing = false; state.mode = null; },
  setIntensity(v) { state.intensity = v; },

  _sched() {
    if (!ctx || !state.playing || ctx.state !== 'running') return;
    const M = MODES[state.mode] || MODES.camp;
    const stepDur = 60 / M.bpm / 4;
    while (state.nextT < ctx.currentTime + 0.25) {
      A._step(M, state.step, state.nextT, stepDur);
      state.nextT += stepDur; state.step++;
    }
  },
  _inst(kind, f, t, dur, vol, o = {}) {
    const g = ctx.createGain(); g.connect(musBus);
    if (kind === 'kick') {
      const os = ctx.createOscillator(); os.frequency.setValueAtTime(150, t); os.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); os.connect(g); os.start(t); os.stop(t + 0.22); return;
    }
    if (kind === 'snare' || kind === 'hat') {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; const fl = ctx.createBiquadFilter(); fl.type = kind === 'hat' ? 'highpass' : 'bandpass'; fl.frequency.value = kind === 'hat' ? 7000 : 1800;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'hat' ? 0.05 : 0.16)); s.connect(fl); fl.connect(g); s.start(t, Math.random()); s.stop(t + 0.2); return;
    }
    const mk = (type, det, vv) => { const os = ctx.createOscillator(); os.type = type; os.frequency.value = f; os.detune.value = det; const gg = ctx.createGain(); gg.gain.value = vv; os.connect(gg); gg.connect(fl2); os.start(t); os.stop(t + dur + 0.1); };
    const fl2 = ctx.createBiquadFilter(); fl2.type = 'lowpass'; fl2.frequency.value = o.lp || 2400; fl2.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (kind === 'pad') { mk('triangle', -8, 0.5); mk('triangle', 8, 0.5); mk('sine', 0, 0.4); }
    else if (kind === 'pluck') { mk(o.type || 'square', 0, 0.5); }
    else if (kind === 'bass') { mk('sawtooth', 0, 0.5); mk('square', -1200, 0.3); }
    else if (kind === 'lead') { mk('triangle', 0, 0.6); mk('sine', 1200, 0.2); }
  },
  _step(M, s, t, sd) {
    const bar = Math.floor(s / 16) % M.prog.length, st = s % 16;
    const root = M.root + M.prog[bar];
    const intense = state.intensity;
    // pad at bar start
    if (st === 0) for (const iv of M.chord) A._inst('pad', mtof(root + iv + 12), t, sd * 16, 0.07, { attack: 0.3, lp: 1400 });
    // bass
    if (M.bass[st]) A._inst('bass', mtof(root - 12 + (M.bass[st] === 2 ? 7 : 0)), t, sd * 1.8, 0.12, { lp: 600 });
    // arp
    const a = M.arp[st % M.arp.length];
    if (a >= 0 && (M.arpAlways || intense > 0.3 || st % 4 === 0)) A._inst('pluck', mtof(root + M.scale[a % M.scale.length] + 12 * Math.floor(a / M.scale.length) + 12), t, sd * 2.2, 0.075, { type: M.pluck, lp: 3200 });
    // melody (sparse)
    const mel = M.mel[(bar * 16 + st) % M.mel.length];
    if (mel >= 0 && intense < 0.9) A._inst('lead', mtof(root + M.scale[mel % M.scale.length] + 24), t, sd * 3, 0.06, { attack: 0.02, lp: 3600 });
    // drums when fighting
    if (M.drums && intense > 0.35) {
      if (st % 8 === 0) A._inst('kick', 0, t, 0, 0.35);
      if (st % 8 === 4) A._inst('snare', 0, t, 0, 0.12);
      if (st % 2 === 0) A._inst('hat', 0, t, 0, 0.04);
      if (intense > 0.75 && (st === 6 || st === 14)) A._inst('kick', 0, t, 0, 0.25);
    }
  },
};

const MIN = [0, 2, 3, 5, 7, 8, 10], MAJ = [0, 2, 4, 5, 7, 9, 11], PHR = [0, 1, 3, 5, 7, 8, 10], HARM = [0, 2, 3, 5, 7, 8, 11];
const MODES = {
  camp: { bpm: 84, root: 57, scale: MIN, chord: [0, 7, 15], prog: [0, -4, -2, -5], bass: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 2, 0], arp: [0, 2, 4, 2, 0, 2, 4, 5], arpAlways: true, pluck: 'triangle', mel: [-1, -1, -1, -1, 4, -1, -1, 2, -1, -1, -1, -1, 3, -1, 2, -1, -1, -1, 0, -1, -1, -1, -1, -1, 2, -1, 4, -1, 5, -1, -1, -1], drums: false },
  meadow: { bpm: 104, root: 55, scale: MAJ, chord: [0, 4, 11], prog: [0, 5, 7, 3], bass: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 2], arp: [0, 2, 4, 7, 4, 2], arpAlways: true, pluck: 'triangle', mel: [4, -1, 2, -1, 4, 5, -1, 4, 2, -1, -1, -1, 0, -1, 2, -1], drums: true },
  crypt: { bpm: 92, root: 50, scale: MIN, chord: [0, 3, 10], prog: [0, -2, -4, -2], bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 2, 0, 0], arp: [0, 3, 5, 3, 7, 5, 3, -1], pluck: 'square', mel: [-1, -1, -1, -1, 4, -1, -1, -1, -1, -1, 3, -1, -1, -1, -1, -1], drums: true },
  sands: { bpm: 100, root: 52, scale: PHR, chord: [0, 4, 7], prog: [0, 1, 0, -2], bass: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 2, 0], arp: [0, 1, 3, 1, 4, 3, 1, 0], pluck: 'square', mel: [4, -1, 3, 1, -1, -1, 0, -1, 1, -1, 3, -1, 4, -1, -1, -1], drums: true },
  frost: { bpm: 88, root: 53, scale: MIN, chord: [0, 7, 14], prog: [0, 3, -2, -4], bass: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0], arp: [0, 4, 7, 4, 9, 7, 4, 2], arpAlways: true, pluck: 'sine', mel: [7, -1, -1, 4, -1, -1, 5, -1, -1, 2, -1, -1, 4, -1, -1, -1], drums: true },
  inferno: { bpm: 118, root: 45, scale: HARM, chord: [0, 3, 7], prog: [0, 1, 0, -2], bass: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 2, 0], arp: [0, 2, 3, 5, 3, 2, 0, -1], pluck: 'sawtooth', mel: [-1, -1, 4, -1, 3, -1, 2, -1, -1, -1, 5, -1, 4, -1, -1, -1], drums: true },
  void: { bpm: 96, root: 48, scale: PHR, chord: [0, 3, 6], prog: [0, -1, -5, -1], bass: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 2, 0], arp: [0, 1, 4, 5, 4, 1, 3, 0], arpAlways: true, pluck: 'sawtooth', mel: [-1, 4, -1, -1, 5, -1, 3, -1, -1, -1, 6, -1, 4, -1, -1, -1], drums: true },
  boss: { bpm: 126, root: 43, scale: HARM, chord: [0, 3, 7], prog: [0, 0, -2, 1], bass: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 2, 2], arp: [0, 3, 5, 7, 5, 3, 2, 0], arpAlways: true, pluck: 'sawtooth', mel: [4, -1, 5, -1, 6, -1, 4, -1, 3, -1, 4, -1, 2, -1, -1, -1], drums: true },
};
