import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildWorld, LAYOUT, DECOR_LAYER } from './world.js';
import { CarVisual, COLORS, setEnvMap } from './car.js';
import { Vehicle, VERSIONS, MS_TO_MPH } from './physics.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Particles } from './particles.js';
import { SkidMarks } from './skidmarks.js';
import { glowTexture, canvasTexture } from './geom.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('roadster.' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('roadster.' + k, JSON.stringify(v));
    } catch {}
  },
};

const isTouch = matchMedia('(pointer: coarse)').matches;
const QUALITY_IDS = ['low', 'medium', 'high', 'ultra'];
let quality = store.get('quality2', isTouch ? 'low' : 'high');
if (!QUALITY_IDS.includes(quality)) quality = 'high';
let versionId = store.get('version', 'thrust');
let colorId = store.get('color2', 'white');
let useKmh = store.get('kmh', true);
let assists = store.get('assists', true);

// Rendering presets. Pixel ratio is multiplied by an adaptive scale that keeps the frame rate up.
const PRESETS = {
  low: { pr: () => Math.min(devicePixelRatio, 1) * 0.85, bloom: false, shadows: false, shadowSize: 1024, refl: 0, post: false },
  medium: { pr: () => Math.min(devicePixelRatio, 1.25), bloom: true, shadows: true, shadowSize: 2048, refl: 2, post: true },
  high: { pr: () => Math.min(devicePixelRatio, 1.75), bloom: true, shadows: true, shadowSize: 4096, refl: 1, post: true },
  ultra: { pr: () => Math.min(Math.max(devicePixelRatio, 1.5), 2), bloom: true, shadows: true, shadowSize: 4096, refl: 1, post: true },
};
const P = () => PRESETS[quality];

// ---------------- Renderer ----------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  window.__showLoadError?.('Tu navegador o tu tarjeta gráfica no tienen WebGL activado, y el juego lo necesita para el 3D. Prueba con Chrome, Edge o Firefox actualizados.');
  throw err;
}
const isWebGL2 = renderer.capabilities.isWebGL2;
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);

// If the GPU driver resets, keep the game alive and redraw when the context comes back
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  $('gpu-lost').classList.remove('hidden');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  $('gpu-lost').classList.add('hidden');
  renderer.shadowMap.needsUpdate = true;
  reflFace = 0;
});

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x080b16, 0.00105);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 9500);
camera.layers.enable(DECOR_LAYER);

// ---------------- Reflections ----------------
// 8-bit cube map (cannot hold out-of-range values), refreshed one face per frame around the car.
const cubeRT = new THREE.WebGLCubeRenderTarget(quality === 'low' ? 128 : 256, { type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter });
const cubeCam = new THREE.CubeCamera(0.3, 4000, cubeRT);
scene.add(cubeCam);
setEnvMap(cubeRT.texture);
let reflFace = 0;
let reflTick = 0;

const world = buildWorld(scene, isTouch ? 'low' : 'high');
const vehicleWorld = {
  drivable: world.drivable,
  colliders: world.colliders,
  spawn: LAYOUT.spawn,
  refill: LAYOUT.refill,
  lineup: { x: LAYOUT.lineup.x, z1: LAYOUT.lineup.z1, z2: LAYOUT.lineup.z2 },
  loop: LAYOUT.loop,
};
const car = new Vehicle(vehicleWorld);
car.assists = assists;
const carColor = () => (COLORS.find((c) => c.id === colorId) || COLORS[0]).hex;
const visual = new CarVisual(scene, carColor());
car.setVersion(versionId);
visual.setVersion(versionId);
visual.doorsOpen = true;
const skids = new SkidMarks(scene);

// particles
const smokeTex = canvasTexture(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});
const smoke = new Particles(scene, 2000, smokeTex, false);
const glow = new Particles(scene, 2400, glowTexture(), true);

function hideForReflection(hide) {
  visual.m.group.visible = !hide;
  smoke.points.visible = glow.points.visible = !hide;
  skids.mesh.visible = !hide;
}

function updateReflections(full) {
  const p = P();
  if (!full) {
    if (p.refl === 0) return;
    if (reflTick++ % p.refl) return;
  }
  hideForReflection(true);
  const autoShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  if (full) {
    cubeCam.position.copy(visual.m.group.position).add(new THREE.Vector3(0, 0.9, 0));
    cubeCam.update(renderer, scene);
    reflFace = 0;
  } else {
    if (reflFace === 0) cubeCam.position.copy(visual.m.group.position).add(new THREE.Vector3(0, 0.9, 0));
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(cubeRT, reflFace);
    renderer.render(scene, cubeCam.children[reflFace]);
    renderer.setRenderTarget(prevRT);
    reflFace = (reflFace + 1) % 6;
    if (reflFace === 0) cubeRT.texture.needsPMREMUpdate = true;
  }
  renderer.shadowMap.autoUpdate = autoShadow;
  hideForReflection(false);
}

// ---------------- Post-processing ----------------
const composerRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: isWebGL2 ? 4 : 0 });
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Removes NaN/Inf pixels and clamps extreme highlights before bloom. Without this a single bad pixel
// gets spread over the whole screen by the bloom blur and the frame turns black.
const sanitize = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      #if __VERSION__ >= 300
        if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      #else
        if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || c.r > 1e4 || c.g > 1e4 || c.b > 1e4) c = vec4(0.0, 0.0, 0.0, 1.0);
      #endif
      c.rgb = clamp(c.rgb, 0.0, 40.0);
      c.a = 1.0;
      gl_FragColor = c;
    }`,
});
composer.addPass(sanitize);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 1.25);
composer.addPass(bloom);
// Cinematic finish: speed blur at the edges, slight chromatic aberration on boost, vignette, grade, grain
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uBoost: { value: 0 } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uSpeed; uniform float uBoost; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r = length(d);
      vec4 c = texture2D(tDiffuse, vUv);
      float amt = uSpeed * smoothstep(0.2, 0.75, r) * 0.05;
      if (amt > 0.0008) {
        vec4 acc = c;
        for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, vUv - d * amt * (float(i) / 5.0));
        c = acc / 6.0;
      }
      float ca = (0.0008 + uBoost * 0.006) * r;
      c.r = texture2D(tDiffuse, vUv - d * ca).r * 0.5 + c.r * 0.5;
      c.b = texture2D(tDiffuse, vUv + d * ca).b * 0.5 + c.b * 0.5;
      float vig = smoothstep(0.88, 0.22, length(d * vec2(1.12, 1.0)));
      c.rgb *= mix(0.6, 1.0, vig);
      c.rgb = mix(c.rgb, c.rgb * vec3(0.95, 0.99, 1.05), 0.55);
      c.rgb += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.014;
      gl_FragColor = c;
    }`,
});
composer.addPass(finish);
composer.addPass(new OutputPass());

let renderScale = 1;
function applyQuality() {
  const p = P();
  const pr = Math.max(0.5, p.pr() * renderScale);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = p.bloom;
  finish.enabled = p.post;
  world.moonLight.castShadow = p.shadows;
  if (world.moonLight.shadow.mapSize.x !== p.shadowSize) {
    world.moonLight.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    if (world.moonLight.shadow.map) {
      world.moonLight.shadow.map.dispose();
      world.moonLight.shadow.map = null;
    }
  }
  renderer.shadowMap.needsUpdate = true;
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyQuality();
});

// Adaptive resolution: drop render scale when frames get slow, raise it again when there is headroom
const perf = { ema: 1 / 60, lastChange: 0, slowFor: 0, fastFor: 0 };
function adaptResolution(rawDt, now) {
  if (document.hidden || rawDt > 0.25) return;
  perf.ema += (rawDt - perf.ema) * 0.05;
  if (perf.ema > 1 / 42) {
    perf.slowFor += rawDt;
    perf.fastFor = 0;
  } else if (perf.ema < 1 / 57) {
    perf.fastFor += rawDt;
    perf.slowFor = 0;
  } else perf.slowFor = perf.fastFor = 0;
  if (now - perf.lastChange < 2.5) return;
  if (perf.slowFor > 1.5 && renderScale > 0.55) {
    renderScale = Math.max(0.55, renderScale - 0.15);
    perf.lastChange = now;
    perf.slowFor = 0;
    applyQuality();
  } else if (perf.fastFor > 5 && renderScale < 1) {
    renderScale = Math.min(1, renderScale + 0.1);
    perf.lastChange = now;
    perf.fastFor = 0;
    applyQuality();
  }
}

applyQuality();

const input = new Input();
const audio = new GameAudio();

// ---------------- Game state ----------------
let state = 'loading';
let time = 0;
let introT = 0;
let camMode = 0;
const CAM_NAMES = ['cerca', 'lejos', 'cine'];
let score = 0;
let msgTimer = 0;
let subTimer = 0;
let timerText = '';
let timerHold = 0;
let screenMessage = '';
let screenMessageT = 0;

const challenges = [
  { id: 'launch', label: () => `0–60 mph en menos de ${launchTarget().toFixed(2).replace('.', ',')} s` },
  { id: 'loop', label: () => 'Rampa invertida: sube boca abajo y aterriza' },
  { id: 'kickflip', label: () => 'Kickflip: gira 180° en el aire y aterriza' },
  { id: 'lineup', label: () => 'Salta por encima de la fila de Teslas' },
  { id: 'drift', label: () => 'Derrape continuo de 3 segundos' },
  { id: 'top', label: () => 'Supera las 200 mph en la pista' },
  { id: 'rings', label: () => 'Vuela por los 6 anillos (Rocket)', needsFlight: true },
];
let done = {};
let best = {};
const launchTarget = () => ({ performance: 1.7, thrust: 1.0, rocket: 0.7 })[versionId];

const zeroSixty = { state: 'idle', t: 0 };
const quarter = { active: false, t: 0 };
const tree = { t: -1, foul: false };
let driftT = 0;
let driftScore = 0;
let maxMph = 0;
let nextRing = 0;
let invertedFlag = 0;
let lastRefillMsg = 0;

// ---------------- Camera state (used by respawn) ----------------
const cam = {
  up: new THREE.Vector3(0, 1, 0),
  fwd: new THREE.Vector3(0, 0, 1),
  yaw: 0,
  pitch: 0,
  dragging: false,
  lastDrag: -10,
  shake: 0,
  fov: 62,
  init: false,
};

// ---------------- Menu ----------------
function buildMenu() {
  const vEl = $('versions');
  vEl.innerHTML = '';
  for (const v of Object.values(VERSIONS)) {
    const b = document.createElement('button');
    b.className = 'vcard' + (v.id === versionId ? ' active' : '');
    b.innerHTML = `<h3>${v.name}</h3><div class="stat">&lt; ${String(v.zeroSixty).replace('.', ',')} s<small>0–60 mph</small></div><div class="stat" style="font-size:16px">${v.topMph}${v.id === 'rocket' ? '+' : ''} mph<small>máx.</small></div><p>${v.blurb}</p><p>${v.seats} plazas · ${v.deposit}</p>`;
    b.onclick = () => {
      versionId = v.id;
      store.set('version', versionId);
      visual.setVersion(versionId);
      buildMenu();
    };
    vEl.appendChild(b);
  }
  const cEl = $('colors');
  cEl.innerHTML = '';
  for (const c of COLORS) {
    const s = document.createElement('button');
    s.className = 'swatch' + (c.id === colorId ? ' active' : '');
    s.style.background = '#' + c.hex.toString(16).padStart(6, '0');
    s.title = c.name;
    s.setAttribute('aria-label', c.name);
    s.onclick = () => {
      colorId = c.id;
      store.set('color2', colorId);
      visual.setColor(c.hex);
      buildMenu();
    };
    cEl.appendChild(s);
  }
  const nm = document.createElement('div');
  nm.className = 'color-name';
  nm.textContent = (COLORS.find((c) => c.id === colorId) || COLORS[0]).name;
  nm.style.width = '100%';
  cEl.appendChild(nm);
  $('quality').value = quality;
  $('assists').checked = assists;
}
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + t.dataset.tab));
  })
);
$('quality').addEventListener('change', (e) => {
  quality = e.target.value;
  store.set('quality2', quality);
  renderScale = 1;
  applyQuality();
});
$('assists').addEventListener('change', (e) => {
  assists = e.target.checked;
  car.assists = assists;
  store.set('assists', assists);
});
$('fullscreen').addEventListener('click', () => {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  } catch {}
});
$('start').addEventListener('click', startGame);
$('resume').addEventListener('click', () => setPaused(false));
$('restart').addEventListener('click', () => {
  setPaused(false);
  respawn(LAYOUT.spawn.pos, LAYOUT.spawn.yaw);
});
$('tomenu').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  showMenu();
});
$('help').innerHTML = document.querySelector('#tab-controls .keys').outerHTML;

function respawn(pos, yaw) {
  car.reset(pos, yaw);
  car.assists = assists;
  cam.init = false;
  for (let i = 0; i < 4; i++) skids.lift(i);
}

function showMenu() {
  state = 'menu';
  buildMenu();
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  respawn(LAYOUT.spawn.pos, LAYOUT.spawn.yaw);
}

function startGame() {
  audio.start();
  // the clicked button keeps keyboard focus; Space (handbrake) would press it again
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  car.setVersion(versionId);
  respawn(LAYOUT.spawn.pos, LAYOUT.spawn.yaw);
  visual.setColor(carColor());
  visual.setVersion(versionId);
  visual.doorsOpen = false;
  done = store.get('done.' + versionId, {});
  best = store.get('best.' + versionId, {});
  nextRing = 0;
  $('menu').classList.add('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  $('hud-version').textContent = 'Roadster ' + VERSIONS[versionId].name;
  $('chip-flight').classList.toggle('na', !VERSIONS[versionId].flight);
  renderChallenges();
  state = 'intro';
  introT = 0;
  $('intro-title').classList.remove('hidden');
  visual.lights = true;
}
input.bindTouch($('touch'));

function setPaused(p) {
  if (p && state === 'play') {
    state = 'paused';
    $('pause').classList.remove('hidden');
  } else if (!p && state === 'paused') {
    state = 'play';
    $('pause').classList.add('hidden');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
}

function renderChallenges() {
  const ul = $('challenges');
  ul.innerHTML = '';
  for (const c of challenges) {
    const li = document.createElement('li');
    const locked = c.needsFlight && !VERSIONS[versionId].flight;
    li.className = done[c.id] ? 'done' : locked ? 'locked' : '';
    li.innerHTML = `<span>${c.label()}</span>`;
    if (best[c.id] !== undefined) li.innerHTML += `<span class="best">${best[c.id]}</span>`;
    ul.appendChild(li);
  }
  $('hud-score').textContent = `${score.toLocaleString('es-ES')} pts`;
}

function complete(id, bonus = 1000) {
  if (done[id]) return;
  done[id] = true;
  store.set('done.' + versionId, done);
  score += bonus;
  const c = challenges.find((x) => x.id === id);
  showSub('Reto completado · ' + c.label(), 4);
  fireworks();
  world.cheer(time, 5);
  audio.beep(1320, 0.12, 0.25);
  setTimeout(() => audio.beep(1760, 0.2, 0.25), 130);
  screenMessage = 'RETO COMPLETADO';
  screenMessageT = time + 4;
  renderChallenges();
}

function setBest(id, val, text) {
  const prev = best['_' + id];
  if (prev === undefined || val < prev) {
    best['_' + id] = val;
    best[id] = text;
    store.set('best.' + versionId, best);
    renderChallenges();
  }
}

function showMsg(text, dur = 2) {
  const el = $('msg');
  el.textContent = text;
  el.classList.add('show');
  msgTimer = dur;
}
function showSub(text, dur = 2.5) {
  const el = $('submsg');
  el.textContent = text;
  el.classList.add('show');
  subTimer = dur;
}

// ---------------- Effects ----------------
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const white = new THREE.Color(0xd8f0ff);
const grey = new THREE.Color(0xa3a3a3);
const dustCol = new THREE.Color(0x8a7458);
const orange = new THREE.Color(0xffa040);
const hazeCol = new THREE.Color(0x6f84a6);

function fireworks() {
  const cols = [0x3fd8ff, 0xffffff, 0xe0202f, 0xffc04a];
  for (let k = 0; k < 4; k++) {
    const c = new THREE.Vector3((Math.random() - 0.5) * 50, 45 + Math.random() * 20, LAYOUT.stage.z - 10 + Math.random() * 20);
    const col = new THREE.Color(cols[k % cols.length]);
    for (let i = 0; i < 90; i++) {
      tmp.randomDirection().multiplyScalar(14 + Math.random() * 8);
      glow.emit(c, tmp, 1.8 + Math.random(), 2.2, 0.4, col, 1, 0.9, 4);
    }
  }
}

function emitEffects(dt, ctl) {
  const m = visual.m;
  if (car.fx.boost > 0.3) {
    for (const p of m.plumes.rear) {
      p.holder.getWorldPosition(tmp);
      tmp2.copy(p.dir).applyQuaternion(visual.m.group.quaternion).multiplyScalar(18 + Math.random() * 8).add(car.vel);
      glow.emit(tmp, tmp2, 0.35, 0.5, 2.2, white, 0.25, 3);
      if (Math.random() < 0.4) smoke.emit(tmp, tmp2.multiplyScalar(0.5), 1.2, 0.8, 4, white, 0.18, 1.5);
    }
  }
  if (car.fx.lift > 0.3) {
    for (const p of m.plumes.lift) {
      p.holder.getWorldPosition(tmp);
      tmp2.copy(p.dir).applyQuaternion(visual.m.group.quaternion).multiplyScalar(14).add(car.vel);
      glow.emit(tmp, tmp2, 0.3, 0.5, 2, white, 0.25, 3);
      if (Math.random() < 0.5) smoke.emit(tmp, tmp2.multiplyScalar(0.4), 1.4, 1, 5, white, 0.16, 1.2);
    }
  }
  // tyre smoke and tyre marks while sliding, spinning or braking hard
  const sliding = car.grounded && (car.skidding || car.drifting);
  const slipAmt = THREE.MathUtils.clamp(Math.max(car.tireSlipR || 0, (car.tireSlipF || 0) * 0.8) * 4, 0, 1);
  m.wheels.forEach((w, i) => {
    const rearOrSliding = !w.front || slipAmt > 0.75 || car.drifting;
    if (sliding && rearOrSliding) {
      w.pivot.getWorldPosition(tmp);
      tmp.addScaledVector(car.up, -w.r + 0.02);
      if (car.vel.lengthSq() > 0.1) tmp3.copy(car.vel).normalize();
      else tmp3.copy(car.fwd);
      skids.add(i, tmp, car.normal, tmp3, w.front ? 0.26 : 0.3, Math.max(0.35, slipAmt));
      if (Math.random() < 0.55 * (dt * 60)) {
        tmp.addScaledVector(car.up, 0.35);
        tmp2.set((Math.random() - 0.5) * 2, 0.9 + Math.random(), (Math.random() - 0.5) * 2).addScaledVector(car.vel, 0.15);
        smoke.emit(tmp, tmp2, 1.8, 0.8, 4.5, grey, 0.2 + slipAmt * 0.12, 1.4, -0.3);
      }
    } else skids.lift(i);
  });
  if (car.grounded && ctl.throttle > 0 && car.speed < 6 && car.speed > 0.3 && !car.skidding) {
    for (const w of m.wheels) {
      if (w.front) continue;
      w.pivot.getWorldPosition(tmp);
      tmp.addScaledVector(car.up, -0.25);
      tmp2.set((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2);
      smoke.emit(tmp, tmp2, 1.4, 0.6, 4, grey, 0.18, 1.5, -0.3);
    }
  }
  if (Math.random() < (state === 'intro' ? 0.6 : 0.12) * dt * 60) {
    const sx = Math.random() < 0.5 ? -1 : 1;
    tmp.set(sx * (6 + Math.random() * 8), 1.3, LAYOUT.stage.z + (Math.random() - 0.5) * 14);
    tmp2.set(sx * Math.random() * 0.8, 0.08, (Math.random() - 0.3) * 0.8);
    smoke.emit(tmp, tmp2, 5, 1.5, 4, hazeCol, 0.05, 0.3);
  }
}

function landingDust(strength) {
  for (let i = 0; i < 30 * strength; i++) {
    tmp.copy(car.pos).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.2, (Math.random() - 0.5) * 4));
    tmp2.set((Math.random() - 0.5) * 8, Math.random() * 3, (Math.random() - 0.5) * 8);
    smoke.emit(tmp, tmp2, 2, 1, 6, dustCol, 0.35, 1.8, -0.2);
  }
}

function sparks() {
  for (let i = 0; i < 120; i++) {
    tmp2.randomDirection().multiplyScalar(6 + Math.random() * 10);
    tmp2.y = Math.abs(tmp2.y);
    glow.emit(car.pos.clone().setY(car.pos.y + 0.5), tmp2, 0.6 + Math.random() * 0.5, 0.4, 0.1, orange, 1, 1, 9);
  }
  landingDust(2);
}

// ---------------- Camera ----------------
const CINE_SPOTS = [
  new THREE.Vector3(-14, 6, -30),
  new THREE.Vector3(-42, 10, 88),
  new THREE.Vector3(20, 4, 95),
  new THREE.Vector3(70, 8, 30),
  new THREE.Vector3(110, 3, 50),
  new THREE.Vector3(-96, 5, 0),
  new THREE.Vector3(-96, 6, 300),
  new THREE.Vector3(-96, 6, 700),
  new THREE.Vector3(-96, 6, 1100),
  new THREE.Vector3(260, 20, 300),
  new THREE.Vector3(400, 30, 360),
  new THREE.Vector3(230, 10, -200),
];
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state !== 'play' && state !== 'paused') return;
  cam.dragging = true;
  try {
    renderer.domElement.setPointerCapture(e.pointerId);
  } catch {}
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!cam.dragging) return;
  cam.yaw -= e.movementX * 0.006;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.004, -0.25, 0.9);
  cam.lastDrag = time;
});
renderer.domElement.addEventListener('pointerup', () => (cam.dragging = false));
renderer.domElement.addEventListener('pointercancel', () => (cam.dragging = false));

const UPW = new THREE.Vector3(0, 1, 0);
const camRay = new THREE.Ray();
const camRaycaster = new THREE.Raycaster();
const boxTmp = new THREE.Box3();
const hitTmp = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();

// distance along the ray from the car to the desired camera spot before something blocks it
function cameraClearance(origin, dir, maxDist) {
  let best = maxDist;
  camRay.set(origin, dir);
  for (const b of world.colliders) {
    boxTmp.min.copy(b.min);
    boxTmp.max.copy(b.max);
    if (boxTmp.containsPoint(origin)) continue;
    const h = camRay.intersectBox(boxTmp, hitTmp);
    if (h) {
      const d = h.distanceTo(origin);
      if (d < best) best = d;
    }
  }
  camRaycaster.set(origin, dir);
  camRaycaster.far = best;
  const hits = camRaycaster.intersectObjects(world.drivable, false);
  if (hits.length && hits[0].distance < best) best = hits[0].distance;
  return best;
}

function groundBelow(p) {
  camRaycaster.set(vA.set(p.x, p.y + 3, p.z), vB.set(0, -1, 0));
  camRaycaster.far = 12;
  const hits = camRaycaster.intersectObjects(world.drivable, false);
  return hits.length ? hits[0].point.y : -Infinity;
}

// rotate a unit vector toward a target around an axis (never collapses through zero length)
function turnToward(v, target, axis, k) {
  const cross = vA.copy(v).cross(target).dot(axis);
  const dot = v.dot(target);
  const ang = Math.atan2(cross, dot);
  v.applyAxisAngle(axis, ang * k);
}

function updateCamera(dt) {
  const carPos = visual.m.group.position;
  const onLoop = car.grounded && car.surface === 'loop';
  const upTarget = onLoop ? car.up : UPW;
  if (!cam.init) cam.up.copy(upTarget);
  else cam.up.lerp(upTarget, 1 - Math.exp(-(car.grounded ? 6 : 1.8) * dt)).normalize();

  // heading target: car forward, blended toward the travel direction while sliding
  const fwdT = tmp.copy(car.fwd);
  if (car.grounded) {
    if (car.speed > 4 && car.forwardSpeed > 0) fwdT.lerp(tmp2.copy(car.vel).normalize(), 0.4);
  } else if (car.flight) {
    fwdT.set(car.fwd.x, 0, car.fwd.z);
  } else {
    tmp2.set(car.vel.x, 0, car.vel.z);
    if (tmp2.lengthSq() > 9) fwdT.copy(tmp2);
    else fwdT.copy(cam.fwd);
  }
  fwdT.addScaledVector(cam.up, -fwdT.dot(cam.up));
  if (fwdT.lengthSq() < 1e-6) fwdT.copy(cam.fwd);
  fwdT.normalize();
  cam.fwd.addScaledVector(cam.up, -cam.fwd.dot(cam.up));
  if (cam.fwd.lengthSq() < 1e-6) cam.fwd.copy(fwdT);
  cam.fwd.normalize();
  if (!cam.init) cam.fwd.copy(fwdT);
  else {
    const rate = car.grounded ? 4.2 + Math.min(car.speed, 40) * 0.06 : 2.2;
    turnToward(cam.fwd, fwdT, cam.up, 1 - Math.exp(-rate * dt));
  }

  if (!cam.dragging && time - cam.lastDrag > 1.5) {
    cam.yaw *= Math.exp(-3 * dt);
    cam.pitch *= Math.exp(-3 * dt);
  }

  const spd = car.speed;
  if (camMode === 2) {
    let bestD = Infinity;
    let spot = CINE_SPOTS[0];
    for (const s of CINE_SPOTS) {
      const d = s.distanceToSquared(carPos);
      if (d < bestD) {
        bestD = d;
        spot = s;
      }
    }
    const desired = Math.sqrt(bestD) > 140 ? carPos.clone().add(new THREE.Vector3(30, 14, -30)) : spot.clone();
    if (!cam.init) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(carPos.x, carPos.y + 0.8, carPos.z);
    const dist = camera.position.distanceTo(carPos);
    cam.fov = THREE.MathUtils.clamp(2 * Math.atan(9 / dist) * THREE.MathUtils.RAD2DEG, 8, 60);
  } else {
    const dist = (camMode === 0 ? 6.6 : 11.5) + Math.min(spd * 0.022, 2.6);
    const height = camMode === 0 ? 2.0 : 4.0;
    const f = tmp2.copy(cam.fwd).applyAxisAngle(cam.up, cam.yaw);
    const side = tmp3.crossVectors(cam.up, f).normalize();
    f.applyAxisAngle(side, cam.pitch);
    const pivot = new THREE.Vector3().copy(carPos).addScaledVector(cam.up, 1.2);
    const desired = new THREE.Vector3().copy(carPos).addScaledVector(cam.up, height + cam.pitch * 3).addScaledVector(f, -dist);
    // keep a clear line of sight: pull the camera in front of walls, ramps and buildings
    const toCam = desired.clone().sub(pivot);
    const len = toCam.length();
    toCam.divideScalar(len);
    const clear = cameraClearance(pivot, toCam, len);
    if (clear < len) desired.copy(pivot).addScaledVector(toCam, Math.max(1.2, clear - 0.4));
    if (!cam.init) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-(onLoop ? 14 : 10) * dt));
    if (cam.up.y > 0.7) {
      const gy = groundBelow(camera.position);
      if (camera.position.y < gy + 0.45) camera.position.y = gy + 0.45;
    }
    camera.up.copy(cam.up);
    const look = new THREE.Vector3().copy(carPos).addScaledVector(cam.up, 1.0).addScaledVector(f, 2.5).addScaledVector(car.vel, 0.03);
    camera.lookAt(look);
    cam.fov = 60 + Math.min(16, spd * 0.12) + car.fx.boost * 6 + (car.drifting ? 2 : 0);
  }
  cam.init = true;
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
    const s = cam.shake * 0.25;
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
  }
  if (car.fx.boost > 0.5) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, 0));
  camera.fov += (cam.fov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  const ml = world.moonLight;
  ml.target.position.copy(carPos);
  ml.position.copy(carPos).add(new THREE.Vector3(-60, 120, -80));
}

function introCamera() {
  const c = LAYOUT.spawn.pos;
  const a = -0.9 + introT * 0.32;
  const r = 9 - introT * 0.5;
  camera.position.set(c.x + Math.sin(a) * r, c.y + 1.6 + Math.max(0, 2.5 - introT * 0.5), c.z + Math.cos(a) * r);
  camera.up.set(0, 1, 0);
  camera.lookAt(c.x, c.y + 0.7, c.z);
  camera.fov = 45;
  camera.updateProjectionMatrix();
  world.moonLight.target.position.copy(c);
  world.moonLight.position.copy(c).add(new THREE.Vector3(-60, 120, -80));
  cam.init = false;
}

function menuCamera() {
  const c = LAYOUT.spawn.pos;
  const a = time * 0.12 + 0.6;
  camera.position.set(c.x + Math.sin(a) * 8, c.y + 1.5, c.z + Math.cos(a) * 8);
  camera.up.set(0, 1, 0);
  // frame the car in the upper right, clear of the menu text on the left
  const dir = vA.set(c.x - camera.position.x, 0, c.z - camera.position.z).normalize();
  const right = vB.crossVectors(dir, UPW).normalize();
  camera.lookAt(c.x - right.x * 3.4, c.y - 0.35, c.z - right.z * 3.4);
  camera.fov = 50;
  camera.updateProjectionMatrix();
  world.moonLight.target.position.copy(c);
  world.moonLight.position.copy(c).add(new THREE.Vector3(-60, 120, -80));
}

// ---------------- Minimap ----------------
const mm = $('minimap');
const mctx = mm.getContext('2d');
function drawMinimap() {
  const W = mm.width;
  const H = mm.height;
  const cx = W / 2;
  const cy = H / 2;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, W, H);
  mctx.save();
  mctx.beginPath();
  mctx.arc(cx, cy, W / 2 - 1, 0, Math.PI * 2);
  mctx.clip();
  const s = car.speed > 60 || car.flight ? 0.22 : 0.42;
  const yaw = Math.atan2(car.fwd.x, car.fwd.z);
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const a = -c * s;
  const cc = sn * s;
  const b = -sn * s;
  const d = -c * s;
  const X = car.pos.x;
  const Z = car.pos.z;
  mctx.setTransform(a, b, cc, d, cx - (a * X + cc * Z), cy - (b * X + d * Z));
  const rect = (x1, z1, x2, z2, col) => {
    mctx.fillStyle = col;
    mctx.fillRect(x1, z1, x2 - x1, z2 - z1);
  };
  rect(-90, -100, 150, 140, 'rgba(120,130,145,0.35)');
  const S = LAYOUT.strip;
  rect(S.x - S.w / 2, S.zStart - 30, S.x + S.w / 2, S.zEnd, 'rgba(160,170,185,0.45)');
  rect(S.x - S.w / 2, S.zQuarter - 1.5, S.x + S.w / 2, S.zQuarter + 1.5, '#fff');
  const ST = LAYOUT.stage;
  rect(ST.x - ST.w / 2, ST.z - ST.d / 2, ST.x + ST.w / 2, ST.z + ST.d / 2, '#e8edf2');
  rect(-48, -52, -13.5, 10, 'rgba(255,255,255,0.12)');
  rect(13.5, -52, 48, 10, 'rgba(255,255,255,0.12)');
  for (const b2 of world.colliders) {
    if (b2.max.y > 10 && !b2.crash) rect(b2.min.x, b2.min.z, b2.max.x, b2.max.z, 'rgba(255,255,255,0.18)');
  }
  const L = LAYOUT.loop;
  rect(L.x - L.W / 2, L.z0, L.x + L.W / 2, L.z0 + L.R, '#3fd8ff');
  const K = LAYOUT.kicker;
  rect(K.x - K.W / 2, K.z0, K.x + K.W / 2, K.z0 + K.len, '#ffd27f');
  rect(K.x - 6, LAYOUT.lineup.z1, K.x + 6, LAYOUT.lineup.z2, 'rgba(255,255,255,0.55)');
  rect(K.x - K.W / 2, LAYOUT.landing.z0, K.x + K.W / 2, LAYOUT.landing.z0 + LAYOUT.landing.len, '#ffd27f');
  mctx.fillStyle = '#3fd8ff';
  mctx.beginPath();
  mctx.arc(LAYOUT.refill.x, LAYOUT.refill.z, 6, 0, 7);
  mctx.fill();
  for (const p of [LAYOUT.standA, LAYOUT.standB, LAYOUT.starship]) {
    mctx.fillStyle = 'rgba(255,90,90,0.8)';
    mctx.beginPath();
    mctx.arc(p.x, p.z, 18, 0, 7);
    mctx.fill();
  }
  world.rings.forEach((r, i) => {
    mctx.fillStyle = i === nextRing ? '#3fd8ff' : i < nextRing ? 'rgba(75,227,138,0.8)' : '#ff9a2e';
    mctx.beginPath();
    mctx.arc(r.center.x, r.center.z, i === nextRing ? 9 : 6, 0, 7);
    mctx.fill();
  });
  mctx.restore();
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.fillStyle = '#e0202f';
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 1.5;
  mctx.beginPath();
  mctx.moveTo(cx, cy - 8);
  mctx.lineTo(cx + 6, cy + 6);
  mctx.lineTo(cx, cy + 3);
  mctx.lineTo(cx - 6, cy + 6);
  mctx.closePath();
  mctx.fill();
  mctx.stroke();
}

// ---------------- Game logic per frame ----------------
const fmt = (t) => t.toFixed(2).replace('.', ',');

function handleEvents() {
  for (const e of car.events) {
    switch (e.type) {
      case 'land': {
        const rollDeg = Math.abs(e.roll) * THREE.MathUtils.RAD2DEG;
        const pitchDeg = Math.abs(e.pitch) * THREE.MathUtils.RAD2DEG;
        const tricks = [];
        let pts = 0;
        if (rollDeg >= 150) {
          const turns = Math.round(rollDeg / 180) * 180;
          tricks.push(`KICKFLIP ${turns}°`);
          pts += turns * 2;
        }
        if (pitchDeg >= 300) {
          const n = Math.round(pitchDeg / 360);
          tricks.push(`${e.pitch > 0 ? 'MORTAL ADELANTE' : 'MORTAL ATRÁS'}${n > 1 ? ' x' + n : ''}`);
          pts += n * 600;
        }
        if (e.airTime > 1.2 && !tricks.length && e.distance > 20) tricks.push(`SALTO ${Math.round(e.distance)} m`);
        if (e.airTime > 0.8) pts += Math.round(e.airTime * 100);
        if (tricks.length) {
          showMsg(tricks.join(' + '), 2.2);
          showSub(`${fmt(e.airTime)} s en el aire · ${Math.round(e.distance)} m · +${pts} pts`, 2.5);
          world.cheer(time, 3);
          screenMessage = tricks[0];
          screenMessageT = time + 3;
        } else if (e.airTime > 0.8) {
          showSub(`${fmt(e.airTime)} s en el aire · ${Math.round(e.distance)} m · +${pts} pts`, 2);
        }
        score += pts;
        if (rollDeg >= 150) complete('kickflip');
        if (e.fromLoop && e.invertedAtExit && rollDeg >= 120) complete('loop', 2000);
        if (e.overLineup && e.distance > 18) complete('lineup', 1500);
        if (e.impact > 12) {
          cam.shake = Math.min(1, e.impact / 25);
          landingDust(Math.min(2, e.impact / 12));
          audio.boom(Math.min(0.5, e.impact / 50));
        }
        renderChallenges();
        break;
      }
      case 'crash':
        showMsg('¡CHOQUE!', 1.8);
        showSub('Reapareciendo…', 1.8);
        sparks();
        audio.boom(0.8);
        cam.shake = 1;
        break;
      case 'respawn':
        nextRingCheckReset();
        cam.init = false;
        for (let i = 0; i < 4; i++) skids.lift(i);
        break;
      case 'inverted':
        if (time - invertedFlag > 4) {
          showSub('Boca abajo · succión a 2G', 1.8);
          invertedFlag = time;
        }
        break;
      case 'autoSuction':
        showSub('Succión activada: el coche se pega a la rampa (2G)', 2.2);
        break;
      case 'loopExit':
        showMsg('¡GIRA! A / D', 1.8);
        showSub('Haz el kickflip de 180° para caer sobre las ruedas', 2.2);
        break;
      case 'tankEmpty':
        showSub('Depósito de aire vacío: vuelve a la zona de recarga', 3);
        break;
      case 'refilling':
        if (time - lastRefillMsg > 3) {
          showSub('Recargando aire comprimido…', 1.5);
          lastRefillMsg = time;
        }
        break;
      case 'bump':
        cam.shake = Math.max(cam.shake, Math.min(0.6, e.speed / 40));
        break;
    }
  }
  car.events.length = 0;
}

function nextRingCheckReset() {
  for (const r of world.rings) r.prevSide = 0;
}

function updateTimers(dt, ctl) {
  const mph = car.forwardSpeed * MS_TO_MPH;
  if (car.grounded && car.speed < 0.3) {
    zeroSixty.state = 'armed';
  } else if (zeroSixty.state === 'armed' && car.forwardSpeed > 0.3) {
    zeroSixty.state = 'running';
    zeroSixty.t = 0;
  }
  if (zeroSixty.state === 'running') {
    zeroSixty.t += dt;
    timerText = `0–60 mph  ${fmt(zeroSixty.t)} s`;
    timerHold = 0.1;
    if (mph >= 60) {
      zeroSixty.state = 'idle';
      const t = zeroSixty.t;
      timerText = `0–60 mph en ${fmt(t)} s`;
      timerHold = 4;
      showMsg(`0–60 · ${fmt(t)} s`, 2.5);
      screenMessage = `0–60 MPH ${t.toFixed(2)} S`;
      screenMessageT = time + 5;
      setBest('launch', t, fmt(t) + ' s');
      if (t < launchTarget()) complete('launch');
    } else if (zeroSixty.t > 10 || ctl.brake > 0 || !car.grounded) {
      zeroSixty.state = 'idle';
    }
  }

  const S = LAYOUT.strip;
  const onStrip = Math.abs(car.pos.x - S.x) < S.w / 2;
  const staged = onStrip && car.pos.z > S.zStart - 8 && car.pos.z < S.zStart && car.speed < 0.3;
  if (staged && tree.t < 0 && !quarter.active) {
    tree.t = 0;
    tree.foul = false;
    showSub('En posición: espera a la luz verde', 2);
  }
  if (tree.t >= 0) {
    tree.t += dt;
    const step = Math.min(4, 1 + Math.floor(tree.t / 0.5));
    if (!tree.foul && step < 4 && car.speed > 0.5) {
      tree.foul = true;
      world.setTree(5);
      showMsg('SALIDA NULA', 1.5);
      setTimeout(() => world.setTree(0), 1500);
      tree.t = -1;
    } else if (!tree.foul) {
      world.setTree(step);
      if (step < 4 && Math.floor((tree.t - dt) / 0.5) !== Math.floor(tree.t / 0.5)) audio.beep(660, 0.1, 0.2);
      if (step === 4 && Math.floor((tree.t - dt) / 0.5) !== Math.floor(tree.t / 0.5)) audio.beep(1320, 0.3, 0.3);
      if (car.speed > 0.5 && step === 4) {
        quarter.active = true;
        quarter.t = tree.t - 1.5;
        tree.t = -1;
      }
      if (!onStrip || tree.t > 12) {
        tree.t = -1;
        world.setTree(0);
      }
    }
  }
  if (quarter.active) {
    quarter.t += dt;
    if (car.pos.z >= S.zQuarter) {
      quarter.active = false;
      const trap = Math.round(car.speed * MS_TO_MPH);
      showMsg(`1/4 MILLA · ${fmt(quarter.t)} s`, 3);
      showSub(`Velocidad de paso: ${trap} mph`, 3);
      screenMessage = `1/4 MILE ${quarter.t.toFixed(2)} S`;
      screenMessageT = time + 5;
      world.setTree(0);
    } else if (!onStrip || quarter.t > 40) {
      quarter.active = false;
      world.setTree(0);
    }
  }

  const absMph = car.speed * MS_TO_MPH;
  if (car.grounded && absMph > maxMph) maxMph = absMph;
  if (car.grounded && absMph >= 200) complete('top');

  // drift: time + score multiplied by angle and speed
  if (car.grounded && car.drifting) {
    driftT += dt;
    driftScore += dt * car.speed * (car.slip || 0) * 18;
    if (driftT > 0.5) {
      timerText = `Derrape ${fmt(driftT)} s · ${Math.round(driftScore)} pts`;
      timerHold = 1;
    }
    if (driftT >= 3) complete('drift');
  } else if (driftT > 0) {
    if (driftT > 1) {
      score += Math.round(driftScore);
      showSub(`Derrape de ${fmt(driftT)} s · +${Math.round(driftScore)} pts`, 1.8);
    }
    driftT = 0;
    driftScore = 0;
  }

  world.rings.forEach((r, i) => {
    const side = tmp.copy(car.pos).addScaledVector(car.up, 0.6).sub(r.center).dot(r.normal);
    const radial = tmp.addScaledVector(r.normal, -side).length();
    if (r.prevSide !== 0 && Math.sign(side) !== Math.sign(r.prevSide) && radial < r.radius && i === nextRing) {
      nextRing++;
      score += 300;
      audio.beep(990, 0.12, 0.25);
      showSub(`Anillo ${nextRing} de ${world.rings.length}`, 1.5);
      if (nextRing >= world.rings.length) complete('rings', 2500);
    }
    r.prevSide = side;
    const active = i === nextRing;
    r.mesh.material.emissive.setHex(i < nextRing ? 0x4be38a : active ? 0x3fd8ff : 0xff9a2e);
    r.mesh.material.emissiveIntensity = active ? 4 + Math.sin(time * 6) * 1.5 : 2;
  });
}

const GAUGE_LEN = 251.3; // arc length of the speed gauge path
function updateHUD(ctl) {
  const ms = car.grounded ? Math.abs(car.forwardSpeed) : car.speed;
  const mph = ms * MS_TO_MPH;
  const kmh = ms * 3.6;
  $('speed').textContent = Math.round(useKmh ? kmh : mph);
  $('unit').textContent = useKmh ? 'km/h' : 'mph';
  $('speed2').textContent = useKmh ? `${Math.round(mph)} mph` : `${Math.round(kmh)} km/h`;
  const frac = Math.min(1, mph / VERSIONS[versionId].topMph);
  $('gauge-fill').style.strokeDashoffset = String(GAUGE_LEN * (1 - frac));
  $('gauge-fill').classList.toggle('boost', car.fx.boost > 0.3);
  const vx = car.forwardSpeed;
  $('gear').textContent = !car.grounded ? (car.flight ? 'V' : '·') : vx < -0.4 ? 'R' : car.speed < 0.3 && ctl.throttle === 0 ? 'N' : 'D';
  $('power').style.width = `${Math.min(100, Math.max(ctl.throttle * 60, car.fx.boost * 100, (car.axFilt || 0) > 0 ? car.axFilt * 2.5 : 0))}%`;
  const liters = Math.round(car.tank * 600);
  $('tank').style.width = `${car.tank * 100}%`;
  $('tank-l').textContent = `${liters} L`;
  $('tank').parentElement.classList.toggle('low', car.tank < 0.2);
  $('chip-suction').classList.toggle('on', car.suction);
  $('chip-flight').classList.toggle('on', car.flight);
  $('chip-lights').classList.toggle('on', visual.lights);
  $('chip-assist').classList.toggle('on', assists);
  $('chip-cam').textContent = 'Cámara: ' + CAM_NAMES[camMode];
  $('timer').textContent = timerHold > 0 ? timerText : '';
  $('hud-score').textContent = `${score.toLocaleString('es-ES')} pts`;
}

function controls(ctl) {
  if (ctl.pause) {
    setPaused(state === 'play');
    return;
  }
  if (state !== 'play') return;
  if (ctl.suction) {
    const on = car.toggleSuction();
    showSub(on ? 'Ventilador de succión ACTIVADO · +2G de agarre' : 'Ventilador de succión desactivado', 1.6);
    audio.beep(on ? 520 : 320, 0.08, 0.15);
  }
  if (ctl.jump && car.grounded && !car.flight) {
    const r = car.jump();
    if (r === 'nothrusters') showSub('La versión Performance no lleva propulsores', 1.8);
  }
  if (ctl.flight) {
    const r = car.toggleFlight();
    if (r === 'noflight') showSub('El modo vuelo es exclusivo del Roadster Rocket', 2);
    else if (r === 'empty') showSub('Sin aire comprimido para volar', 2);
    else showSub(r === 'on' ? 'MODO VUELO · Q subir · X bajar · W/S avanzar' : 'Modo vuelo desactivado', 2);
  }
  if (ctl.lights) visual.lights = !visual.lights;
  if (ctl.doors) {
    if (car.speed < 2 && car.grounded) showSub(visual.toggleDoors() ? 'Puertas de mariposa abiertas' : 'Puertas cerradas', 1.4);
    else showSub('Para el coche para abrir las puertas', 1.4);
  }
  if (ctl.roof) showSub(visual.toggleRoof() ? 'Techo de cristal colocado' : 'Techo de cristal desmontado', 1.5);
  if (ctl.camera) {
    camMode = (camMode + 1) % 3;
    cam.init = false;
  }
  if (ctl.reset) {
    respawn(car.lastSafe.pos, car.lastSafe.yaw);
    showSub('Reaparecido', 1);
  }
  if (ctl.assists) {
    assists = !assists;
    car.assists = assists;
    store.set('assists', assists);
    showSub(assists ? 'Ayudas de conducción ACTIVADAS (estabilidad y derrape asistido)' : 'Ayudas de conducción desactivadas', 2);
  }
  if (ctl.help) $('help').classList.toggle('hidden');
  if (ctl.mute) showSub(audio.toggleMute() ? 'Sonido silenciado' : 'Sonido activado', 1.2);
}
// While driving, Space/Enter must never activate a focused button (e.g. the start or resume button)
const guardKeys = (e) => {
  if (state !== 'play' && state !== 'intro') return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    e.preventDefault();
  }
};
addEventListener('keydown', guardKeys, true);
addEventListener('keyup', guardKeys, true);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyU') {
    useKmh = !useKmh;
    store.set('kmh', useKmh);
  }
});

// ---------------- Main loop ----------------
const clock = new THREE.Clock();
const debug = { freeze: false };
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, roll: 0, pitch: 0, yawAir: 0, handbrake: false, boost: false, lift: false, descend: false, horn: false };

function render() {
  if (contextLost) return;
  updateReflections(false);
  if (quality === 'low') renderer.render(scene, camera);
  else composer.render();
}

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  time += dt;
  adaptResolution(rawDt, time);
  const ctl = input.read(dt);
  controls(ctl);

  if (state === 'play') {
    if (!debug.freeze) car.update(dt, ctl);
    handleEvents();
    updateTimers(dt, ctl);
    visual.update(dt, car, ctl);
    emitEffects(dt, ctl);
    if (debug.cam) debug.cam(camera);
    else updateCamera(dt);
    updateHUD(ctl);
    drawMinimap();
    const crowdNear = THREE.MathUtils.clamp(1 - car.pos.distanceTo(new THREE.Vector3(0, 0, -20)) / 120, 0, 1);
    audio.update(car, ctl, crowdNear, world.cheerTime > time);
  } else if (state === 'intro') {
    introT += dt;
    car.update(dt, NO_INPUT);
    car.events.length = 0;
    visual.update(dt, car, NO_INPUT);
    emitEffects(dt, NO_INPUT);
    introCamera();
    const cd = $('countdown');
    const n = 3 - Math.floor(introT - 1.5);
    if (introT > 1.5 && n >= 1) {
      cd.classList.remove('hidden');
      if (cd.textContent !== String(n)) {
        cd.textContent = String(n);
        audio.beep(660, 0.15, 0.3);
      }
    }
    if (introT > 4.5) {
      cd.textContent = '¡YA!';
      audio.beep(1320, 0.35, 0.35);
      setTimeout(() => cd.classList.add('hidden'), 700);
      $('intro-title').classList.add('hidden');
      $('hud').classList.remove('hidden');
      state = 'play';
      cam.init = false;
      world.cheer(time, 4);
      fireworks();
      $('hint').classList.remove('hidden');
      setTimeout(() => $('hint').classList.add('hidden'), 9000);
    }
    audio.update(car, NO_INPUT, 1, true);
  } else if (state === 'menu') {
    visual.update(dt, car, NO_INPUT);
    menuCamera();
    emitEffects(dt, NO_INPUT);
  }

  if (msgTimer > 0 && (msgTimer -= dt) <= 0) $('msg').classList.remove('show');
  if (subTimer > 0 && (subTimer -= dt) <= 0) $('submsg').classList.remove('show');
  if (timerHold > 0) timerHold -= dt;

  const mph = car.speed * MS_TO_MPH;
  world.update(time, dt, mph, screenMessageT > time ? { message: screenMessage } : null);
  finish.uniforms.uTime.value = time % 100;
  const speedFx = state === 'play' ? THREE.MathUtils.clamp((car.speed - 25) / 70, 0, 1) : 0;
  finish.uniforms.uSpeed.value += (speedFx - finish.uniforms.uSpeed.value) * (1 - Math.exp(-3 * dt));
  finish.uniforms.uBoost.value += (car.fx.boost - finish.uniforms.uBoost.value) * (1 - Math.exp(-6 * dt));
  smoke.update(dt, renderer.domElement.height);
  glow.update(dt, renderer.domElement.height);
  skids.update(dt);
  render();
}

// Warm-up: build every shader up front (for the screen and the off-screen targets) so the game does
// not stutter the first time something new comes into view, then show the menu.
function warmUp() {
  try {
    menuCamera();
    updateReflections(true);
    renderer.setRenderTarget(composerRT);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(null);
    renderer.compile(scene, camera);
    composer.render();
  } catch (err) {
    console.warn('warm-up', err);
  }
}

requestAnimationFrame(() => {
  warmUp();
  frame();
  setTimeout(() => {
    $('loading').classList.add('hidden');
    showMenu();
  }, 300);
});
window.__game = {
  THREE,
  scene,
  composer,
  car,
  world,
  camera,
  renderer,
  visual,
  debug,
  skids,
  input,
  get state() {
    return state;
  },
  get quality() {
    return quality;
  },
  get renderScale() {
    return renderScale;
  },
  startGame,
  skipIntro: () => (introT = 10),
  setCam: (m) => (camMode = m),
};
