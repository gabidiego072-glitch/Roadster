import * as THREE from 'three';
import { loftGeometry, glowTexture } from './geom.js';

export const COLORS = [
  { id: 'red', name: 'Rojo Multicapa', hex: 0xa50f1a },
  { id: 'white', name: 'Blanco Nácar', hex: 0xe9ebee },
  { id: 'silver', name: 'Plata Galáctico', hex: 0x9ea3aa },
  { id: 'black', name: 'Negro Sólido', hex: 0x101114 },
  { id: 'blue', name: 'Azul Espacio', hex: 0x1b3a8c },
];

let envMap = null;
export function setEnvMap(e) {
  envMap = e;
}

function paint(hex, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    metalness: 0.55,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMap,
    envMapIntensity: 0.9,
    ...extra,
  });
}

const glassMat = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x05070a,
    metalness: 0.2,
    roughness: 0.04,
    transparent: true,
    opacity: 0.82,
    clearcoat: 1,
    envMap,
    envMapIntensity: 1.4,
  });

const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.4, envMap, envMapIntensity: 0.4 });

// Roadster body sections (z from rear to front, metres)
const BODY = [
  { z: -2.28, w: 0.62, b: 0.36, t: 0.74, tw: 0.9 },
  { z: -2.22, w: 0.86, b: 0.27, t: 0.86, tw: 0.86 },
  { z: -1.95, w: 0.98, b: 0.22, t: 0.94, tw: 0.82 },
  { z: -1.45, w: 1.02, b: 0.2, t: 0.97, tw: 0.78 },
  { z: -0.95, w: 1.0, b: 0.19, t: 0.95, tw: 0.76 },
  { z: -0.35, w: 0.95, b: 0.19, t: 0.92, tw: 0.8 },
  { z: 0.3, w: 0.94, b: 0.19, t: 0.88, tw: 0.82 },
  { z: 0.85, w: 0.96, b: 0.2, t: 0.79, tw: 0.84 },
  { z: 1.35, w: 0.99, b: 0.21, t: 0.7, tw: 0.82 },
  { z: 1.82, w: 0.93, b: 0.24, t: 0.58, tw: 0.84 },
  { z: 2.12, w: 0.8, b: 0.27, t: 0.5, tw: 0.86, nt: 2.2 },
  { z: 2.28, w: 0.55, b: 0.31, t: 0.43, tw: 0.9, nt: 2 },
];
const CANOPY = [
  { z: 1.05, w: 0.56, b: 0.74, t: 0.77, nt: 2, nb: 6, tw: 0.9 },
  { z: 0.6, w: 0.68, b: 0.8, t: 1.02, nt: 2.2, nb: 6, tw: 0.82 },
  { z: 0.05, w: 0.71, b: 0.84, t: 1.16, nt: 2.4, nb: 6, tw: 0.8 },
  { z: -0.55, w: 0.7, b: 0.88, t: 1.15, nt: 2.4, nb: 6, tw: 0.8 },
  { z: -1.15, w: 0.62, b: 0.9, t: 1.03, nt: 2.2, nb: 6, tw: 0.82 },
  { z: -1.62, w: 0.44, b: 0.9, t: 0.93, nt: 2, nb: 6, tw: 0.9 },
];

function makeWheel(radius, width, rimMat) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 32, 1),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  );
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  // rounded tire shoulders
  const sh = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.04, 0.05, 8, 32), tire.material);
  sh.rotation.y = Math.PI / 2;
  sh.position.x = width / 2 - 0.03;
  g.add(sh);
  const sh2 = sh.clone();
  sh2.position.x = -width / 2 + 0.03;
  g.add(sh2);
  // aero rim with turbine spokes
  const face = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, width + 0.02, 28), rimMat);
  face.rotation.z = Math.PI / 2;
  g.add(face);
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.9, roughness: 0.25, envMap });
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.035, radius * 0.6), spokeMat);
    const a = (i / 10) * Math.PI * 2;
    s.position.set(0, Math.sin(a) * radius * 0.36, Math.cos(a) * radius * 0.36);
    s.rotation.x = -a + 0.35;
    g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, width + 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 1, roughness: 0.2, envMap }));
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  // red brake caliper (doesn't spin, added to pivot later)
  return g;
}

function plumeMesh(len, radius, color) {
  const geo = new THREE.ConeGeometry(radius, len, 16, 1, true);
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

export function buildRoadster(colorHex) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const bodyMat = paint(colorHex);
  const shell = new THREE.Mesh(loftGeometry(BODY, 48), bodyMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // glass canopy (removable roof part shown separately)
  const gm = glassMat();
  const canopy = new THREE.Mesh(loftGeometry(CANOPY, 40), gm);
  canopy.castShadow = true;
  body.add(canopy);
  const roof = new THREE.Mesh(
    loftGeometry(
      [
        { z: 0.35, w: 0.5, b: 1.1, t: 1.15, nt: 2, nb: 2, tw: 0.9 },
        { z: 0.0, w: 0.58, b: 1.13, t: 1.19, nt: 2, nb: 2, tw: 0.9 },
        { z: -0.5, w: 0.58, b: 1.13, t: 1.18, nt: 2, nb: 2, tw: 0.9 },
        { z: -0.85, w: 0.5, b: 1.08, t: 1.12, nt: 2, nb: 2, tw: 0.9 },
      ],
      24
    ),
    new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, roughness: 0.05, metalness: 0.3, clearcoat: 1, envMap, envMapIntensity: 1.5 })
  );
  body.add(roof);

  // interior hint: seats + yoke visible through glass
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 });
  for (const x of [-0.33, 0.33]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.1), seatMat);
    seat.position.set(x, 0.7, -0.5);
    seat.rotation.x = -0.25;
    body.add(seat);
  }
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 16, Math.PI), darkMat());
  yoke.position.set(0.33, 0.78, 0.25);
  yoke.rotation.set(-0.3, 0, Math.PI);
  body.add(yoke);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ color: 0x3fa9ff }));
  screen.position.set(0, 0.76, 0.45);
  screen.rotation.x = -0.6;
  body.add(screen);

  // lower dark skirt / splitter / diffuser
  const trim = darkMat();
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.4), trim);
  splitter.position.set(0, 0.24, 2.05);
  body.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.35), trim);
  diffuser.position.set(0, 0.3, -2.1);
  body.add(diffuser);
  for (const s of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 2.0), trim);
    skirt.position.set(s * 0.95, 0.24, 0);
    body.add(skirt);
    // side intake
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.55), trim);
    intake.position.set(s * 0.985, 0.52, -1.0);
    intake.rotation.y = s * 0.12;
    body.add(intake);
  }

  // front light bar + hidden (pop-up) headlights
  const lightWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff4ff, emissiveIntensity: 1.6 });
  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.025, 0.03), lightWhite);
  frontBar.position.set(0, 0.47, 2.2);
  body.add(frontBar);
  const headlights = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.56, 0.6, 1.62);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.3), bodyMat);
    lid.position.set(0, 0, 0.12);
    pivot.add(lid);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 }));
    lens.position.set(0, -0.045, 0.27);
    pivot.add(lens);
    body.add(pivot);
    headlights.push({ pivot, lens });
  }

  // rear full-width light bar
  const rearMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1020, emissiveIntensity: 1.6 });
  const rearBar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.04, 0.03), rearMat);
  rearBar.position.set(0, 0.74, -2.245);
  body.add(rearBar);

  // cold-gas thruster nozzles (rear, lift, side)
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 1, roughness: 0.25, envMap });
  const plumes = { rear: [], lift: [], side: [] };
  const addNozzle = (x, y, z, dir, kind, r = 0.06) => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.12, 14, 1, true), nozzleMat);
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    n.position.y = -0.04;
    holder.add(n);
    const pl = plumeMesh(1.6, r * 2.4, 0xd8f0ff);
    pl.position.y = -0.1;
    holder.add(pl);
    body.add(holder);
    plumes[kind].push({ holder, plume: pl, dir });
  };
  for (const x of [-0.6, -0.22, 0.22, 0.6]) addNozzle(x, 0.47, -2.24, new THREE.Vector3(0, 0, -1), 'rear', 0.065);
  for (const x of [-0.72, 0.72]) for (const z of [-1.7, 1.7]) addNozzle(x, 0.2, z, new THREE.Vector3(0, -1, 0), 'lift');
  for (const s of [-1, 1]) for (const z of [-1.9, 1.9]) addNozzle(s * 0.9, 0.62, z, new THREE.Vector3(s, 0, 0), 'side', 0.04);

  // underbody suction fan glow + skirt LEDs
  const fanTex = glowTexture('rgba(90,220,255,1)', 'rgba(0,120,255,0)');
  const fanGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 5.4),
    new THREE.MeshBasicMaterial({ map: fanTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  fanGlow.rotation.x = -Math.PI / 2;
  fanGlow.position.y = 0.04;
  group.add(fanGlow);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x002233, emissive: 0x33ccff, emissiveIntensity: 0.0 });
  for (const s of [-1, 1]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.9), ledMat);
    led.position.set(s * 0.975, 0.2, 0);
    body.add(led);
  }
  const fanLight = new THREE.PointLight(0x33ccff, 0, 9, 2);
  fanLight.position.set(0, 0.15, 0);
  group.add(fanLight);

  // headlight beam
  const beam = new THREE.SpotLight(0xf2f6ff, 0, 140, 0.42, 0.45, 1.4);
  beam.position.set(0, 0.7, 2.0);
  beam.target.position.set(0, 0, 25);
  group.add(beam, beam.target);
  // brake/tail light glow on ground
  const tailLight = new THREE.PointLight(0xff1020, 1.5, 6, 2);
  tailLight.position.set(0, 0.6, -2.6);
  group.add(tailLight);

  // wheels
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.85, roughness: 0.3, envMap, envMapIntensity: 1 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4, metalness: 0.3 });
  const wheels = [];
  const W = [
    { x: 0.86, z: 1.36, r: 0.355, w: 0.28, front: true },
    { x: -0.86, z: 1.36, r: 0.355, w: 0.28, front: true },
    { x: 0.87, z: -1.36, r: 0.37, w: 0.33, front: false },
    { x: -0.87, z: -1.36, r: 0.37, w: 0.33, front: false },
  ];
  for (const d of W) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, d.r, d.z);
    const wheel = makeWheel(d.r, d.w, rimMat);
    wheel.traverse((m) => m.isMesh && (m.castShadow = true));
    pivot.add(wheel);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.22), caliperMat);
    cal.position.set(-Math.sign(d.x) * 0.06, 0.12, -0.12);
    pivot.add(cal);
    group.add(pivot);
    wheels.push({ pivot, wheel, front: d.front, r: d.r, baseY: d.r });
  }

  // "ROADSTER" badge on the rear
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.06), new THREE.MeshBasicMaterial({ map: badgeTexture(), transparent: true }));
  badge.position.set(0, 0.62, -2.262);
  badge.rotation.y = Math.PI;
  body.add(badge);

  return { group, body, bodyMat, wheels, headlights, plumes, fanGlow, ledMat, fanLight, beam, rearMat, roof, tailLight };
}

function badgeTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9dde2';
  ctx.font = '600 44px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '18px';
  ctx.fillText('ROADSTER', 256, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Keeps the visual car in sync with the physics state.
export class CarVisual {
  constructor(scene, colorHex) {
    this.scene = scene;
    this.m = buildRoadster(colorHex);
    scene.add(this.m.group);
    this.spin = 0;
    this.steerVis = 0;
    this.lights = false;
    this.lightAnim = 0;
    this.roofOn = true;
    this.tilt = new THREE.Vector2();
    this.t = 0;
  }

  setColor(hex) {
    this.m.bodyMat.color.setHex(hex);
  }

  toggleRoof() {
    this.roofOn = !this.roofOn;
    this.m.roof.visible = this.roofOn;
    return this.roofOn;
  }

  update(dt, car, ctl) {
    this.t += dt;
    const g = this.m.group;
    g.position.copy(car.pos);
    g.quaternion.slerp(car.quat, 1 - Math.exp(-30 * dt));

    // body roll/pitch from accelerations
    const latTarget = car.grounded ? THREE.MathUtils.clamp(-car.latAccel * 0.006, -0.06, 0.06) : 0;
    const lonTarget = car.grounded ? THREE.MathUtils.clamp(-car.lonAccel * 0.0025, -0.05, 0.05) : 0;
    this.tilt.x += (lonTarget - this.tilt.x) * (1 - Math.exp(-8 * dt));
    this.tilt.y += (latTarget - this.tilt.y) * (1 - Math.exp(-8 * dt));
    this.m.body.rotation.set(this.tilt.x, 0, this.tilt.y);
    this.m.body.position.y = car.suction ? -0.04 : 0;

    // wheels
    this.spin += (car.wheelSpeed / 0.36) * dt;
    this.steerVis += (ctl.steer * 0.5 * car.steerScale - this.steerVis) * (1 - Math.exp(-12 * dt));
    for (const w of this.m.wheels) {
      w.wheel.rotation.x = this.spin;
      w.pivot.rotation.y = w.front ? this.steerVis : 0;
      const drop = car.grounded ? 0 : -0.07;
      w.pivot.position.y += (w.baseY + drop - w.pivot.position.y) * (1 - Math.exp(-10 * dt));
    }

    // pop-up headlights
    const target = this.lights ? 1 : 0;
    this.lightAnim += (target - this.lightAnim) * (1 - Math.exp(-6 * dt));
    for (const h of this.m.headlights) {
      h.pivot.rotation.x = -this.lightAnim * 0.55;
      h.lens.material.emissiveIntensity = this.lightAnim * 1.8;
    }
    this.m.beam.intensity = this.lightAnim * 420;

    // brake lights
    const braking = ctl.brake > 0.1 && car.forwardSpeed > 0.5;
    this.m.rearMat.emissiveIntensity = braking ? 5 : 1.6;
    this.m.tailLight.intensity = braking ? 4 : 1.2;

    // thrusters
    const flick = 0.75 + Math.random() * 0.25;
    const setPl = (list, amount, len) => {
      for (const p of list) {
        p.plume.material.opacity = amount * 0.55 * flick;
        p.plume.scale.set(1, Math.max(0.01, amount * len * flick), 1);
      }
    };
    setPl(this.m.plumes.rear, car.fx.boost, 1.6);
    setPl(this.m.plumes.lift, car.fx.lift, 1.2);
    for (const p of this.m.plumes.side) {
      const want = car.fx.roll * Math.sign(p.dir.x);
      const a = Math.max(0, want) + car.fx.rot * 0.4;
      p.plume.material.opacity = Math.min(1, a) * 0.5 * flick;
      p.plume.scale.set(1, Math.max(0.01, Math.min(1, a) * 0.8), 1);
    }

    // suction
    const s = car.suction ? 1 : 0;
    const pulse = 0.85 + Math.sin(this.t * 30) * 0.15;
    this.m.fanGlow.material.opacity += (s * 0.9 * pulse - this.m.fanGlow.material.opacity) * (1 - Math.exp(-10 * dt));
    this.m.ledMat.emissiveIntensity = s * 4 * pulse;
    this.m.fanLight.intensity = s * 8 * pulse;
  }
}

// ---------- Other Tesla vehicles for the jump lineup (stylised) ----------
export function buildSedan(hex, scale = 1, tall = 0) {
  const g = new THREE.Group();
  const m = paint(hex);
  const sec = [
    { z: -2.4, w: 0.8, b: 0.38, t: 0.95 + tall, tw: 0.85 },
    { z: -2.2, w: 0.92, b: 0.3, t: 1.02 + tall, tw: 0.82 },
    { z: -1.2, w: 0.95, b: 0.27, t: 1.0 + tall, tw: 0.8 },
    { z: 0.5, w: 0.95, b: 0.27, t: 0.95 + tall * 0.6, tw: 0.8 },
    { z: 1.6, w: 0.92, b: 0.3, t: 0.8, tw: 0.82 },
    { z: 2.3, w: 0.7, b: 0.36, t: 0.6, tw: 0.86 },
  ];
  const b = new THREE.Mesh(loftGeometry(sec, 32), m);
  b.castShadow = true;
  g.add(b);
  const can = new THREE.Mesh(
    loftGeometry(
      [
        { z: 0.9, w: 0.7, b: 0.9, t: 0.95, nb: 6 },
        { z: 0.3, w: 0.78, b: 0.95, t: 1.35 + tall, nb: 6 },
        { z: -1.0, w: 0.78, b: 0.98, t: 1.4 + tall, nb: 6 },
        { z: -2.0, w: 0.7, b: 0.98, t: 1.08 + tall, nb: 6 },
      ],
      28
    ),
    glassMat()
  );
  g.add(can);
  addSimpleWheels(g, 0.36, 1.45, 0.85);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.02), new THREE.MeshStandardMaterial({ emissive: 0xff1020, emissiveIntensity: 1.5, color: 0x220000 }));
  rear.position.set(0, 0.85 + tall * 0.8, -2.41);
  g.add(rear);
  g.scale.setScalar(scale);
  return g;
}

function addSimpleWheels(g, r, zoff, xoff, wdt = 0.28) {
  const tm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const rm = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.3 });
  for (const x of [-xoff, xoff])
    for (const z of [-zoff, zoff]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wdt, 20), tm);
      t.rotation.z = Math.PI / 2;
      t.position.set(x, r, z);
      g.add(t);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.65, r * 0.65, wdt + 0.02, 16), rm);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(t.position);
      g.add(rim);
    }
}

export function buildCybertruck() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.95, roughness: 0.35, envMap, envMapIntensity: 1 });
  // side profile: angular triangle silhouette
  const s = new THREE.Shape();
  s.moveTo(-2.9, 0.45);
  s.lineTo(2.9, 0.45);
  s.lineTo(2.9, 1.15);
  s.lineTo(2.75, 1.2);
  s.lineTo(0.15, 1.92);
  s.lineTo(-2.9, 1.3);
  s.lineTo(-2.9, 0.45);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
  geo.translate(0, 0, -1.0);
  geo.rotateY(-Math.PI / 2);
  const body = new THREE.Mesh(geo, steel);
  body.castShadow = true;
  g.add(body);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.02, 1.4), glassMat());
  glass.position.set(0, 1.62, 1.15);
  glass.rotation.x = 0.27;
  g.add(glass);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.03, 0.03), new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 3 }));
  bar.position.set(0, 1.18, 2.92);
  g.add(bar);
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.03, 0.03), new THREE.MeshStandardMaterial({ emissive: 0xff1020, emissiveIntensity: 2 }));
  bar2.position.set(0, 1.28, -2.92);
  g.add(bar2);
  addSimpleWheels(g, 0.44, 1.9, 0.9, 0.35);
  return g;
}

export function buildSemi() {
  const g = new THREE.Group();
  const white = paint(0xc9ccd0, { metalness: 0.3 });
  const cab = new THREE.Mesh(
    loftGeometry(
      [
        { z: -1.6, w: 1.25, b: 0.9, t: 3.9, nt: 6, nb: 8, tw: 0.92 },
        { z: 0.6, w: 1.26, b: 0.85, t: 3.95, nt: 6, nb: 8, tw: 0.92 },
        { z: 1.6, w: 1.24, b: 0.8, t: 3.3, nt: 4, nb: 8, tw: 0.9 },
        { z: 2.3, w: 1.2, b: 0.75, t: 1.8, nt: 3, nb: 8, tw: 0.9 },
        { z: 2.45, w: 1.1, b: 0.8, t: 1.2, nt: 3, nb: 8, tw: 0.9 },
      ],
      32
    ),
    white
  );
  cab.castShadow = true;
  g.add(cab);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.1), glassMat());
  ws.position.set(0, 2.95, 1.98);
  ws.rotation.x = -0.62;
  g.add(ws);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 7.5), darkMat());
  chassis.position.set(0, 0.75, -2.2);
  g.add(chassis);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.03), new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 3 }));
  bar.position.set(0, 1.45, 2.4);
  g.add(bar);
  addSimpleWheels(g, 0.52, 1.7, 1.05, 0.4);
  const tm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const z of [-4.2, -5.3])
    for (const x of [-1.05, 1.05]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.45, 20), tm);
      t.rotation.z = Math.PI / 2;
      t.position.set(x, 0.52, z);
      g.add(t);
    }
  g.position.z = 1.4;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

export function buildCybercab() {
  const g = new THREE.Group();
  const m = paint(0xc9b47a, { metalness: 0.9, roughness: 0.25 });
  const b = new THREE.Mesh(
    loftGeometry(
      [
        { z: -1.9, w: 0.75, b: 0.35, t: 0.9, tw: 0.8 },
        { z: -1.5, w: 0.9, b: 0.28, t: 1.25, tw: 0.75 },
        { z: 0.2, w: 0.92, b: 0.26, t: 1.4, tw: 0.72 },
        { z: 1.4, w: 0.9, b: 0.28, t: 0.95, tw: 0.8 },
        { z: 1.95, w: 0.7, b: 0.34, t: 0.62, tw: 0.85 },
      ],
      32
    ),
    m
  );
  b.castShadow = true;
  g.add(b);
  const can = new THREE.Mesh(
    loftGeometry(
      [
        { z: 1.0, w: 0.72, b: 1.0, t: 1.05, nb: 6 },
        { z: 0.3, w: 0.8, b: 1.1, t: 1.45, nb: 6 },
        { z: -1.2, w: 0.75, b: 1.1, t: 1.32, nb: 6 },
      ],
      24
    ),
    glassMat()
  );
  g.add(can);
  addSimpleWheels(g, 0.36, 1.25, 0.86);
  return g;
}
