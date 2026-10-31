import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp, clamp, TAU } from './util.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uHurt: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uVig: { value: 0.55 }, uSat: { value: 1.12 }, uFlash: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uHurt; uniform float uFade; uniform float uTime; uniform vec3 uTint; uniform float uVig; uniform float uSat; uniform vec3 uFlash;
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.006;
      vec3 col; col.r = texture2D(tDiffuse, uv + off).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col *= uTint;
      col = (col - 0.18) * 1.06 + 0.18;
      float vig = smoothstep(0.85, 0.15, r2 * 1.9);
      col *= mix(1.0 - uVig, 1.0, vig);
      col += uFlash;
      col = mix(col, vec3(0.9, 0.05, 0.05) * (0.3 + 0.7 * (1.0 - vig) * 2.0), uHurt * 0.55 * (0.35 + (1.0 - vig)));
      col *= (1.0 - uFade);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Engine {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    container.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 2, 1, 260);
    this.quality = 'high'; this.resScale = 1; this.t = 0;
    this.camTarget = new THREE.Vector3(); this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.camYaw = -0.62; this.camDist = 1; this.camDistTarget = 1; this.shake = 0; this.shakeT = 0;
    this.camOffset = new THREE.Vector3();
    // lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5); this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(-0.5, 1, 0.5).normalize();
    this.playerLight = new THREE.PointLight(0xffc880, 14, 16, 1.7); this.scene.add(this.playerLight);
    this.torchLights = [0, 1].map(() => { const l = new THREE.PointLight(0xffa040, 0, 13, 1.8); this.scene.add(l); return l; });
    this.wallUniforms = { uPlayer: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } };
    // env for metals
    try {
      const pm = new THREE.PMREMGenerator(r); this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    } catch (e) { this.envMap = null; }
    this.hurt = 0; this.fade = 0; this.fadeTarget = 0; this.fadeSpeed = 2;
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.frameTimes = []; this.autoTimer = 0;
  }

  setQuality(q) {
    this.quality = q;
    const high = q === 'high', med = q === 'medium';
    this.sun.shadow.mapSize.set(high ? 2048 : med ? 1024 : 512, high ? 2048 : med ? 1024 : 512);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.renderer.shadowMap.enabled = true;
    this.useComposer = q !== 'low';
    this.msaa = high ? 4 : med ? 2 : 0;
    this.buildComposer();
  }

  buildComposer() {
    const r = this.renderer;
    if (this.composer) { this.composer.dispose && this.composer.dispose(); this.composer = null; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (!this.useComposer) { this.grade = null; this.bloom = null; this.outputPass = null; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = this.exposure || 1; return; }
    r.toneMapping = THREE.NoToneMapping;
    try {
      const hf = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: this.msaa });
      const c = this.composer = new EffectComposer(r, rt);
      c.setPixelRatio(1); c.setSize(size.x, size.y);
      c.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(64, size.x >> 1), Math.max(64, size.y >> 1)), 0.55, 0.65, 0.82);
      c.addPass(this.bloom);
      this.grade = new ShaderPass(GradeShader); c.addPass(this.grade);
      this.outputPass = new OutputPass(); c.addPass(this.outputPass);
      this.outputPass.uniforms && (this.outputPass.uniforms.toneMappingExposure && (this.outputPass.uniforms.toneMappingExposure.value = this.exposure || 1));
      r.toneMappingExposure = this.exposure || 1;
    } catch (e) {
      console.warn('composer failed', e); this.useComposer = false; this.composer = null; r.toneMapping = THREE.ACESFilmicToneMapping;
    }
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.2) * this.resScale;
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep vertical coverage roughly constant on narrow screens
    this.camera.fov = w / h < 1.6 ? 34 : 30; this.camera.updateProjectionMatrix();
    if (this.composer) { const s = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.composer.setSize(s.x, s.y); if (this.bloom) this.bloom.resolution.set(s.x >> 1, s.y >> 1); }
    this.fxScaleDirty = true;
  }

  setBiome(b) {
    this.biome = b;
    this.scene.background = new THREE.Color(b.sky);
    this.scene.fog = new THREE.FogExp2(b.fog, b.fogD);
    this.hemi.color.setHex(b.hemi[0]); this.hemi.groundColor.setHex(b.hemi[1]); this.hemi.intensity = b.hemi[2];
    this.sun.color.setHex(b.sun[0]); this.sun.intensity = b.sun[1];
    this.sunDir.set(b.sunDir[0], b.sunDir[1], b.sunDir[2]).normalize();
    this.exposure = b.exposure || 1;
    if (this.useComposer) { this.renderer.toneMappingExposure = this.exposure; if (this.outputPass) this.outputPass.uniforms.toneMappingExposure && (this.outputPass.uniforms.toneMappingExposure.value = this.exposure); }
    else this.renderer.toneMappingExposure = this.exposure;
    const dark = b.id === 'crypt' || b.id === 'inferno' || b.id === 'void' || b.id === 'camp';
    this.playerLight.intensity = dark ? 16 : 5; this.playerLight.color.setHex(b.id === 'void' ? 0xcaa0ff : b.id === 'frost' ? 0xbfe4ff : 0xffc880);
    if (this.grade) { this.grade.uniforms.uVig.value = dark ? 0.62 : 0.4; this.grade.uniforms.uTint.value.setRGB(1, 1, 1); }
    if (this.bloom) { this.bloom.strength = dark ? 0.7 : 0.45; this.bloom.threshold = dark ? 0.72 : 0.85; }
  }

  addShake(a) { this.shake = Math.max(this.shake, a); }
  setZoom(z) { this.camDistTarget = z; }
  snapCamera(x, z) { this.camTarget.set(x, 0, z); this.updateCamera(0.0, true); }

  updateCamera(dt, snap = false) {
    this.camDist = snap ? this.camDistTarget : damp(this.camDist, this.camDistTarget, 2.5, dt);
    const hd = 18.5 * this.camDist, hgt = 25 * this.camDist;
    this.camOffset.set(Math.sin(this.camYaw) * hd, hgt, Math.cos(this.camYaw) * hd);
    const want = this.camTarget;
    if (snap) { this.camLook.copy(want); } else { this.camLook.x = damp(this.camLook.x, want.x, 7, dt); this.camLook.z = damp(this.camLook.z, want.z, 7, dt); this.camLook.y = 0.8; }
    this.camPos.copy(this.camLook).add(this.camOffset);
    this.shake = Math.max(0, this.shake - dt * 3.2);
    let sx = 0, sy = 0, sz = 0;
    if (this.shake > 0) { this.shakeT += dt * 60; const a = this.shake * this.shake * 0.7; sx = Math.sin(this.shakeT * 1.7) * a; sy = Math.cos(this.shakeT * 2.3) * a; sz = Math.sin(this.shakeT * 1.3 + 1) * a; }
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z + sz);
    this.camera.lookAt(this.camLook.x, this.camLook.y + 0.6, this.camLook.z);
  }
  // direction on the ground that is "up" on screen
  screenUp(out) { out.set(-this.camOffset.x, 0, -this.camOffset.z).normalize(); return out; }

  update(dt, playerPos) {
    this.t += dt;
    this.updateCamera(dt);
    // sun follows
    const tx = Math.round(this.camLook.x * 2) / 2, tz = Math.round(this.camLook.z * 2) / 2;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 55, this.sunDir.y * 55, tz + this.sunDir.z * 55);
    this.sun.target.updateMatrixWorld();
    if (playerPos) {
      this.playerLight.position.set(playerPos.x, 3.2, playerPos.z);
      this.wallUniforms.uPlayer.value.set(playerPos.x, 1.0, playerPos.z);
    }
    this.wallUniforms.uCam.value.copy(this.camera.position);
    // hurt / fade
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    this.fade = damp(this.fade, this.fadeTarget, this.fadeSpeed * 2.2, dt);
    if (this.grade) { this.grade.uniforms.uHurt.value = this.hurt; this.grade.uniforms.uFade.value = this.fade; this.grade.uniforms.uTime.value = this.t; }
    else if (this.fadeEl) { this.fadeEl.style.opacity = this.fade; }
  }
  setFlash(r, g, b) { if (this.grade) this.grade.uniforms.uFlash.value.setRGB(r, g, b); }
  fadeTo(v, speed = 1) { this.fadeTarget = v; this.fadeSpeed = speed; }

  // assign nearest torches to the 2 pooled lights
  lightTorches(torches, px, pz, time) {
    const best = [null, null], bd = [1e9, 1e9];
    for (const t of torches) {
      const d = (t.x - px) * (t.x - px) + (t.z - pz) * (t.z - pz);
      if (d < bd[0]) { bd[1] = bd[0]; best[1] = best[0]; bd[0] = d; best[0] = t; } else if (d < bd[1]) { bd[1] = d; best[1] = t; }
    }
    for (let i = 0; i < 2; i++) {
      const l = this.torchLights[i], t = best[i];
      if (t && bd[i] < 24 * 24) { l.position.set(t.x, t.y, t.z); l.color.setHex(t.color); l.intensity = (9 + Math.sin(time * 11 + t.seed) * 1.5) * (1 - bd[i] / 700); }
      else l.intensity = 0;
    }
  }

  render() {
    if (this.fxScaleDirty && this.fx) { const s = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.fx.setScale(s.y); this.fxScaleDirty = false; }
    if (this.composer && this.useComposer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  // adaptive quality: call each frame with real frame time
  adapt(frameMs) {
    this.frameTimes.push(frameMs); if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length; this.frameTimes.length = 0;
    if (this.manualQuality) return;
    if (avg > 26) { // below ~38fps
      if (this.resScale > 0.7) { this.resScale = Math.max(0.65, this.resScale - 0.15); this.onResize(); }
      else if (this.quality === 'high') this.setQuality('medium');
      else if (this.quality === 'medium') this.setQuality('low');
    }
  }
}
