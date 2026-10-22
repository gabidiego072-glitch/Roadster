import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld, LAYOUT } from './world.js';
import { CarVisual, COLORS, setEnvMap } from './car.js';
import { Vehicle, VERSIONS, MS_TO_MPH } from './physics.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Particles } from './particles.js';
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
let quality = store.get('quality', isTouch ? 'low' : 'high');
let versionId = store.get('version', 'thrust');
let colorId = store.get('color', 'red');
let useKmh = store.get('kmh', true);

// ---------------- Renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x080b16, 0.0011);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 9500);

const pmrem = new THREE.PMREMGenerator(renderer);
setEnvMap(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);

const world = buildWorld(scene, isTouch ? 'low' : 'high');
const vehicleWorld = {
  drivable: world.drivable,
  colliders: world.colliders,
  spawn: LAYOUT.spawn,
  refill: LAYOUT.refill,
  lineup: { x: LAYOUT.lineup.x, z1: LAYOUT.lineup.z1, z2: LAYOUT.lineup.z2 },
};
const car = new Vehicle(vehicleWorld);
const carColor = () => (COLORS.find((c) => c.id === colorId) || COLORS[0]).hex;
const visual = new CarVisual(scene, carColor());
car.setVersion(versionId);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyQuality() {
  const pr = quality === 'high' ? Math.min(devicePixelRatio, 2) : quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : 0.85;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = quality !== 'low';
  world.moonLight.castShadow = quality !== 'low';
  renderer.shadowMap.needsUpdate = true;
}
applyQuality();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyQuality();
});

// particles
const smokeTex = canvasTexture(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});
const smoke = new Particles(scene, 1600, smokeTex, false);
const glow = new Particles(scene, 2000, glowTexture(), true);

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
let maxMph = 0;
let nextRing = 0;
let invertedFlag = 0;
let lastRefillMsg = 0;

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
      store.set('color', colorId);
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
}
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + t.dataset.tab));
  })
);
$('quality').addEventListener('change', (e) => {
  quality = e.target.value;
  store.set('quality', quality);
  applyQuality();
});
$('start').addEventListener('click', startGame);
$('resume').addEventListener('click', () => setPaused(false));
$('restart').addEventListener('click', () => {
  setPaused(false);
  car.reset(LAYOUT.spawn.pos, LAYOUT.spawn.yaw);
});
$('tomenu').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  showMenu();
});
$('help').innerHTML = document.querySelector('#tab-controls .keys').outerHTML;

function showMenu() {
  state = 'menu';
  buildMenu();
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  car.reset(LAYOUT.spawn.pos, LAYOUT.spawn.yaw);
}

function startGame() {
  audio.start();
  car.setVersion(versionId);
  car.reset(LAYOUT.spawn.pos, LAYOUT.spawn.yaw);
  visual.setColor(carColor());
  done = store.get('done.' + versionId, {});
  best = store.get('best.' + versionId, {});
  nextRing = 0;
  $('menu').classList.add('hidden');
  if (isTouch) {
    $('touch').classList.remove('hidden');
  }
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
const white = new THREE.Color(0xd8f0ff);
const grey = new THREE.Color(0x9a9a9a);
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
  // thruster vapour
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
  // tyre smoke while drifting or launching hard
  if (car.grounded && (car.drifting || (ctl.throttle > 0 && car.speed < 8 && car.speed > 0.5) || (ctl.handbrake && car.speed > 5))) {
    for (const w of m.wheels) {
      if (w.front && !car.drifting) continue;
      w.pivot.getWorldPosition(tmp);
      tmp.addScaledVector(car.up, -0.25);
      tmp2.set((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2).addScaledVector(car.vel, 0.2);
      smoke.emit(tmp, tmp2, 1.6, 0.8, 5, grey, 0.28, 1.5, -0.3);
    }
  }
  // stage haze
  if (Math.random() < (state === 'intro' ? 0.6 : 0.12) * dt * 60) {
    // low haze along the stage edges, away from the car on the turntable
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
const cam = {
  up: new THREE.Vector3(0, 1, 0),
  fwd: new THREE.Vector3(0, 0, 1),
  yaw: 0,
  pitch: 0,
  dragging: false,
  lastDrag: -10,
  shake: 0,
  fov: 62,
};
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
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!cam.dragging) return;
  cam.yaw -= e.movementX * 0.006;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.004, -0.3, 0.9);
  cam.lastDrag = time;
});
renderer.domElement.addEventListener('pointerup', () => (cam.dragging = false));

const UPW = new THREE.Vector3(0, 1, 0);
function updateCamera(dt) {
  const carPos = visual.m.group.position;
  // reference frame that follows the car on the inverted ramp but stays level in the air
  const upTarget = car.grounded && car.surface === 'loop' ? car.up : UPW;
  cam.up.lerp(upTarget, 1 - Math.exp(-(car.grounded ? 5 : 1.5) * dt)).normalize();
  let fwdTarget;
  if (car.grounded) {
    fwdTarget = tmp.copy(car.fwd);
    if (car.forwardSpeed < -2) fwdTarget.copy(car.vel).normalize();
  } else if (car.flight) {
    fwdTarget = tmp.set(car.fwd.x, 0, car.fwd.z).normalize();
  } else {
    fwdTarget = tmp.set(car.vel.x, 0, car.vel.z);
    if (fwdTarget.lengthSq() < 4) fwdTarget.copy(cam.fwd);
    fwdTarget.normalize();
  }
  // keep fwd perpendicular to up
  fwdTarget.addScaledVector(cam.up, -fwdTarget.dot(cam.up)).normalize();
  cam.fwd.lerp(fwdTarget, 1 - Math.exp(-(car.grounded ? 5 : 2) * dt));
  cam.fwd.addScaledVector(cam.up, -cam.fwd.dot(cam.up)).normalize();

  if (!cam.dragging && time - cam.lastDrag > 1.5) {
    cam.yaw *= Math.exp(-3 * dt);
    cam.pitch *= Math.exp(-3 * dt);
  }

  const spd = car.speed;
  let desired;
  let look;
  if (camMode === 2) {
    // cinematic: nearest broadcast camera, long lens tracking the car
    let bestD = Infinity;
    let spot = CINE_SPOTS[0];
    for (const s of CINE_SPOTS) {
      const d = s.distanceToSquared(carPos);
      if (d < bestD) {
        bestD = d;
        spot = s;
      }
    }
    desired = spot.clone();
    if (Math.sqrt(bestD) > 140) desired = carPos.clone().add(new THREE.Vector3(30, 14, -30));
    camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    camera.up.set(0, 1, 0);
    look = carPos.clone().addScaledVector(UPW, 0.8);
    camera.lookAt(look);
    const dist = camera.position.distanceTo(carPos);
    cam.fov = THREE.MathUtils.clamp(2 * Math.atan(9 / dist) * THREE.MathUtils.RAD2DEG, 8, 60);
  } else {
    const dist = (camMode === 0 ? 6.8 : 12) + Math.min(spd * 0.025, 3);
    const height = camMode === 0 ? 2.1 : 4.2;
    const f = tmp2.copy(cam.fwd).applyAxisAngle(cam.up, cam.yaw);
    const side = new THREE.Vector3().crossVectors(cam.up, f).normalize();
    f.applyAxisAngle(side, cam.pitch);
    desired = carPos.clone().addScaledVector(cam.up, height + cam.pitch * 3).addScaledVector(f, -dist);
    const k = car.grounded && car.surface === 'loop' ? 14 : 9;
    camera.position.lerp(desired, 1 - Math.exp(-k * dt));
    // keep camera above the ground when level
    if (cam.up.y > 0.7 && camera.position.y < 0.6) camera.position.y = 0.6;
    camera.up.copy(cam.up);
    look = carPos.clone().addScaledVector(cam.up, 1.0).addScaledVector(f, 2.5);
    camera.lookAt(look);
    cam.fov = 60 + Math.min(16, spd * 0.12) + car.fx.boost * 6;
  }
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
    const s = cam.shake * 0.25;
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
  }
  if (car.fx.boost > 0.5) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, 0));
  camera.fov += (cam.fov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  // shadow camera follows the car
  const ml = world.moonLight;
  ml.target.position.copy(carPos);
  ml.position.copy(carPos).add(new THREE.Vector3(-60, 120, -80));
}

function introCamera(dt) {
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
  cam.fwd.set(0, 0, 1);
  cam.up.set(0, 1, 0);
}

function menuCamera(dt) {
  const c = LAYOUT.spawn.pos;
  const a = time * 0.12;
  camera.position.set(c.x + Math.sin(a) * 7.5 - 2, c.y + 1.4, c.z + Math.cos(a) * 7.5);
  camera.up.set(0, 1, 0);
  camera.lookAt(c.x - 1.5, c.y + 0.6, c.z);
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
  // car marker (always pointing up)
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
        break;
      case 'inverted':
        if (time - invertedFlag > 4) {
          showSub('Boca abajo · succión a 2G', 1.8);
          invertedFlag = time;
        }
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
  // 0-60
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

  // drag strip: christmas tree + quarter mile
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

  // top speed
  const absMph = car.speed * MS_TO_MPH;
  if (car.grounded && absMph > maxMph) maxMph = absMph;
  if (car.grounded && absMph >= 200) complete('top');

  // drift
  if (car.grounded && car.drifting) {
    driftT += dt;
    if (driftT > 0.6) {
      timerText = `Derrape ${fmt(driftT)} s`;
      timerHold = 1;
    }
    if (driftT >= 3) complete('drift');
  } else if (driftT > 0) {
    if (driftT > 1.5) score += Math.round(driftT * 150);
    driftT = 0;
  }

  // rings
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

function updateHUD(ctl) {
  const ms = car.grounded ? Math.abs(car.forwardSpeed) : car.speed;
  const mph = ms * MS_TO_MPH;
  const kmh = ms * 3.6;
  $('speed').textContent = Math.round(useKmh ? kmh : mph);
  $('unit').textContent = useKmh ? 'km/h' : 'mph';
  $('speed2').textContent = useKmh ? `${Math.round(mph)} mph` : `${Math.round(kmh)} km/h`;
  $('power').style.width = `${Math.min(100, Math.max(ctl.throttle * 60, car.fx.boost * 100, car.lonAccel > 0 ? car.lonAccel * 2.5 : 0))}%`;
  const liters = Math.round(car.tank * 600);
  $('tank').style.width = `${car.tank * 100}%`;
  $('tank-l').textContent = `${liters} L`;
  $('tank').parentElement.classList.toggle('low', car.tank < 0.2);
  $('chip-suction').classList.toggle('on', car.suction);
  $('chip-flight').classList.toggle('on', car.flight);
  $('chip-lights').classList.toggle('on', visual.lights);
  $('chip-cam').textContent = 'Cámara: ' + CAM_NAMES[camMode];
  if (timerHold > 0) $('timer').textContent = timerText;
  else $('timer').textContent = '';
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
  if (ctl.roof) showSub(visual.toggleRoof() ? 'Techo de cristal colocado' : 'Techo de cristal desmontado', 1.5);
  if (ctl.camera) camMode = (camMode + 1) % 3;
  if (ctl.reset) {
    car.reset(car.lastSafe.pos, car.lastSafe.yaw);
    showSub('Reaparecido', 1);
  }
  if (ctl.help) $('help').classList.toggle('hidden');
  if (ctl.mute) showSub(audio.toggleMute() ? 'Sonido silenciado' : 'Sonido activado', 1.2);
}
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

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const ctl = input.read(dt);
  controls(ctl);

  if (state === 'play') {
    if (!debug.freeze) car.update(dt, ctl);
    handleEvents();
    updateTimers(dt, ctl);
    visual.update(dt, car, ctl);
    emitEffects(dt, ctl);
    updateCamera(dt);
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
    introCamera(dt);
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
      world.cheer(time, 4);
      fireworks();
      $('hint').classList.remove('hidden');
      setTimeout(() => $('hint').classList.add('hidden'), 9000);
    }
    audio.update(car, NO_INPUT, 1, true);
  } else if (state === 'menu') {
    visual.update(dt, car, NO_INPUT);
    menuCamera(dt);
    emitEffects(dt, NO_INPUT);
  }

  if (msgTimer > 0 && (msgTimer -= dt) <= 0) $('msg').classList.remove('show');
  if (subTimer > 0 && (subTimer -= dt) <= 0) $('submsg').classList.remove('show');
  if (timerHold > 0) timerHold -= dt;

  const mph = car.speed * MS_TO_MPH;
  world.update(time, dt, mph, screenMessageT > time ? { message: screenMessage } : null);
  smoke.update(dt, renderer.domElement.height);
  glow.update(dt, renderer.domElement.height);
  if (quality === 'low') renderer.render(scene, camera);
  else composer.render();
}

// Show the menu once the first frame is ready
requestAnimationFrame(() => {
  frame();
  setTimeout(() => {
    $('loading').classList.add('hidden');
    showMenu();
  }, 300);
});
window.__game = { car, world, camera, renderer, visual, debug, get state() { return state; }, startGame, skipIntro: () => (introT = 10), setCam: (m) => (camMode = m) };
