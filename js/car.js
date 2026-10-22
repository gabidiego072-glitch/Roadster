import * as THREE from 'three';
import { loftGeometry, glowTexture } from './geom.js';

export const COLORS = [
  { id: 'white', name: 'Blanco Nácar', hex: 0xe4e6e9 },
  { id: 'red', name: 'Rojo Multicapa', hex: 0xa50f1a },
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

// ---------- Faceted geometry helpers ----------
// Lofts polygon cross-sections along Z. Each section: { z, pts: [[x, y], ...] }.
// mirror=true: pts is a half profile from bottom centre (x=0) to top centre (x=0), mirrored to the -X side.
function polyLoft(sections, mirror = true) {
  const rings = sections.map((s) => {
    const r = s.pts.map(([x, y]) => [x + (s.x || 0), y]);
    if (mirror) {
      for (let i = s.pts.length - 2; i >= 1; i--) r.push([-s.pts[i][0] + (s.x || 0), s.pts[i][1]]);
    }
    return r.map(([x, y]) => [x, y, s.z]);
  });
  const n = rings[0].length;
  const pos = [];
  const idx = [];
  rings.forEach((r) => r.forEach((p) => pos.push(...p)));
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      const c = (k + 1) * n + i;
      const d = (k + 1) * n + ((i + 1) % n);
      idx.push(a, b, c, b, d, c);
    }
  }
  for (const k of [0, rings.length - 1]) {
    const base = pos.length / 3;
    const r = rings[k];
    const cx = r.reduce((s, p) => s + p[0], 0) / n;
    const cy = r.reduce((s, p) => s + p[1], 0) / n;
    pos.push(cx, cy, r[0][2]);
    for (let i = 0; i < n; i++) idx.push(base, k * n + i, k * n + ((i + 1) % n));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

// Body half-profile: bottom centre, sill, lower side, shoulder crease, body top edge, top centre.
const S = (z, b, ws, wl, yl, wsh, ysh, wt, yt) => ({ z, pts: [[0, b], [ws, b], [wl, yl], [wsh, ysh], [wt, yt], [0, yt + 0.01]] });
// Front axle z=+1.40, rear axle z=-1.40. Lower side is pulled in at the axles to form angular wheel arches.
const BODY = [
  S(-2.36, 0.36, 0.74, 0.8, 0.5, 0.84, 0.8, 0.56, 0.84),
  S(-2.26, 0.3, 0.84, 0.92, 0.44, 0.95, 0.86, 0.62, 0.9),
  S(-1.98, 0.26, 0.88, 0.96, 0.42, 1.0, 0.87, 0.64, 0.91),
  S(-1.84, 0.25, 0.7, 0.73, 0.56, 1.02, 0.87, 0.66, 0.91),
  S(-1.4, 0.25, 0.7, 0.75, 0.81, 1.03, 0.86, 0.7, 0.89),
  S(-0.98, 0.25, 0.7, 0.73, 0.55, 1.0, 0.83, 0.72, 0.86),
  S(-0.86, 0.22, 0.78, 0.8, 0.42, 0.8, 0.8, 0.72, 0.84),
  S(0.0, 0.22, 0.78, 0.8, 0.42, 0.8, 0.76, 0.7, 0.8),
  S(0.86, 0.22, 0.78, 0.8, 0.42, 0.8, 0.77, 0.64, 0.77),
  S(0.98, 0.25, 0.7, 0.72, 0.53, 0.99, 0.78, 0.62, 0.76),
  S(1.4, 0.25, 0.7, 0.74, 0.79, 1.0, 0.8, 0.6, 0.74),
  S(1.82, 0.25, 0.7, 0.72, 0.53, 1.0, 0.71, 0.62, 0.71),
  S(1.96, 0.25, 0.86, 0.95, 0.4, 0.99, 0.66, 0.64, 0.68),
  S(2.2, 0.27, 0.86, 0.92, 0.35, 0.96, 0.55, 0.7, 0.6),
  S(2.34, 0.32, 0.78, 0.84, 0.38, 0.88, 0.5, 0.66, 0.53),
];
// One-piece dark glass canopy from mid-hood to the rear deck
const C = (z, bw, by, tw, ty) => ({ z, pts: [[0, by - 0.02], [bw, by - 0.02], [bw, by], [tw, ty], [0, ty + 0.012]] });
const CANOPY = [
  C(-1.98, 0.62, 0.912, 0.4, 0.918),
  C(-1.76, 0.65, 0.905, 0.42, 0.96),
  C(-1.2, 0.7, 0.88, 0.5, 1.06),
  C(-0.6, 0.72, 0.84, 0.56, 1.14),
  C(0.1, 0.7, 0.8, 0.56, 1.12),
  C(0.7, 0.64, 0.775, 0.5, 0.98),
  C(1.22, 0.6, 0.745, 0.48, 0.755),
];

function makeWheel(radius, width) {
  const g = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.92 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 36, 1), tireMat);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  const side = width / 2 + 0.005;
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.7, roughness: 0.35, envMap });
  const silver = new THREE.MeshStandardMaterial({ color: 0x9aa0a7, metalness: 0.6, roughness: 0.45, envMap, envMapIntensity: 0.45 });
  for (const s of [-1, 1]) {
    // dark rim face, silver lip, six-spoke star
    const face = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.8, 36), dark);
    face.position.x = s * side;
    face.rotation.y = (s * Math.PI) / 2;
    g.add(face);
    const lip = new THREE.Mesh(new THREE.RingGeometry(radius * 0.76, radius * 0.82, 36), silver);
    lip.position.x = s * (side + 0.002);
    lip.rotation.y = (s * Math.PI) / 2;
    g.add(lip);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const shape = new THREE.Shape();
      shape.moveTo(0.04, -0.03);
      shape.lineTo(radius * 0.77, -0.012);
      shape.lineTo(radius * 0.77, 0.03);
      shape.lineTo(0.04, 0.03);
      const sp = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }), i % 2 ? silver : silver);
      const holder = new THREE.Group();
      holder.position.x = s * (side + 0.004);
      holder.rotation.y = (s * Math.PI) / 2;
      sp.rotation.z = a + 0.12;
      holder.add(sp);
      g.add(holder);
    }
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.06, 6), dark);
    hub.position.x = s * (side + 0.03);
    hub.rotation.y = (s * Math.PI) / 2;
    g.add(hub);
  }
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

function prism(tri, thickness, mat) {
  // tri: three [x, y, z] points on the outer face; inner face offset toward the centre on X
  const outer = tri;
  const inner = tri.map(([x, y, z]) => [x - Math.sign(x) * thickness, y, z]);
  const v = [...outer, ...inner].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]);
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return new THREE.Mesh(f, mat);
}

export function buildRoadster(colorHex) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const bodyMat = paint(colorHex, { flatShading: true, side: THREE.DoubleSide, metalness: 0.45, roughness: 0.32 });
  const shell = new THREE.Mesh(polyLoft(BODY), bodyMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // tinted (bronze) one-piece glass roof
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x3a2418,
    metalness: 0.65,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMap,
    envMapIntensity: 2.6,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const canopy = new THREE.Mesh(polyLoft(CANOPY), glass);
  canopy.castShadow = true;
  body.add(canopy);
  // removable centre roof panel (darker) for the targa toggle
  const roof = new THREE.Mesh(
    polyLoft([
      { z: -0.95, pts: [[0, 1.118], [0.5, 1.09], [0.52, 1.1], [0, 1.135]] },
      { z: 0.35, pts: [[0, 1.098], [0.5, 1.07], [0.52, 1.08], [0, 1.115]] },
    ]),
    new THREE.MeshPhysicalMaterial({ color: 0x0b0705, roughness: 0.04, metalness: 0.4, clearcoat: 1, envMap, envMapIntensity: 1.8, side: THREE.DoubleSide })
  );
  body.add(roof);

  // rear "sail" panels (flying buttresses) in body colour
  for (const s of [-1, 1]) {
    const sail = prism(
      [
        [s * 0.99, 0.82, -0.92],
        [s * 0.97, 0.88, -2.08],
        [s * 0.64, 1.02, -1.5],
      ],
      0.05,
      bodyMat
    );
    sail.castShadow = true;
    body.add(sail);
  }

  // orange interior
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xc8581f, roughness: 0.6 });
  for (const x of [-0.33, 0.33]) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.1), seatMat);
    back.position.set(x, 0.62, -0.45);
    back.rotation.x = -0.3;
    body.add(back);
    const cush = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.5), seatMat);
    cush.position.set(x, 0.38, -0.15);
    body.add(cush);
  }
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 16, Math.PI), darkMat());
  yoke.position.set(0.33, 0.66, 0.35);
  yoke.rotation.set(-0.3, 0, Math.PI);
  body.add(yoke);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ color: 0x3fa9ff }));
  screen.position.set(0, 0.66, 0.55);
  screen.rotation.x = -0.6;
  body.add(screen);

  const trim = darkMat();
  // dark front intake under the light bar + splitter
  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.13, 0.12), trim);
  intake.position.set(0, 0.41, 2.3);
  body.add(intake);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.04, 0.3), trim);
  splitter.position.set(0, 0.27, 2.24);
  body.add(splitter);
  // wheel-well liners
  for (const z of [1.4, -1.4])
    for (const s of [-1, 1]) {
      const liner = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.46), trim);
      liner.position.set(s * 0.715, 0.48, z);
      liner.rotation.y = (s * Math.PI) / 2;
      body.add(liner);
    }

  // front full-width light bar (headlights are hidden in it)
  const lightWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f6ff, emissiveIntensity: 1.6 });
  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.022, 0.03), lightWhite);
  frontBar.position.set(0, 0.5, 2.335);
  body.add(frontBar);
  for (const s of [-1, 1]) {
    const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, 0.16), lightWhite);
    wrap.position.set(s * 0.9, 0.52, 2.27);
    wrap.rotation.y = s * 0.5;
    body.add(wrap);
    // amber side marker on the front fender
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.1), new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xff7a1a, emissiveIntensity: 1.5 }));
    marker.position.set(s * 0.995, 0.74, 0.95);
    body.add(marker);
  }

  // rear: dark tail panel, red light bar, nozzle bank
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.08), trim);
  tail.position.set(0, 0.5, -2.34);
  body.add(tail);
  const rearMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1020, emissiveIntensity: 1.6 });
  const rearBar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.03, 0.03), rearMat);
  rearBar.position.set(0, 0.79, -2.37);
  body.add(rearBar);
  for (const s of [-1, 1]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), rearMat);
    corner.position.set(s * 0.68, 0.6, -2.39);
    body.add(corner);
  }

  // cold-gas thruster nozzles: rear bank, gold lift nozzles at the sills, side roll nozzles
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 1, roughness: 0.25, envMap });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28, envMap, envMapIntensity: 1.2 });
  const plumes = { rear: [], lift: [], side: [] };
  const addNozzle = (x, y, z, dir, kind, r = 0.06, mat = nozzleMat) => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.12, 14, 1, true), mat);
    n.material.side = THREE.DoubleSide;
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
  for (const x of [-0.55, -0.33, -0.11, 0.11, 0.33, 0.55]) addNozzle(x, 0.42, -2.36, new THREE.Vector3(0, 0, -1), 'rear', 0.055);
  for (const s of [-1, 1]) for (const z of [-0.9, 0.9]) addNozzle(s * 0.86, 0.2, z, new THREE.Vector3(0, -1, 0), 'lift', 0.05, goldMat);
  for (const s of [-1, 1]) for (const z of [-2.0, 2.0]) addNozzle(s * 0.92, 0.6, z, new THREE.Vector3(s, 0, 0), 'side', 0.035);

  // rear wing (shown on the Rocket version)
  const wing = new THREE.Group();
  const wingMat = paint(0x15171a, { metalness: 0.6, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.34), wingMat);
    strut.position.set(s * 0.45, 1.06, -2.02);
    strut.rotation.x = 0.25;
    wing.add(strut);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.5), wingMat);
    plate.position.set(s * 0.9, 1.26, -2.12);
    wing.add(plate);
    const plateLight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.025), rearMat);
    plateLight.position.set(s * 0.9, 1.26, -2.37);
    wing.add(plateLight);
  }
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.035, 0.42), wingMat);
  blade.position.set(0, 1.29, -2.14);
  blade.rotation.x = -0.12;
  wing.add(blade);
  const wingLight = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.025, 0.02), rearMat);
  wingLight.position.set(0, 1.31, -2.36);
  wing.add(wingLight);
  wing.visible = false;
  body.add(wing);

  // butterfly doors (hinged at the front, swing upward)
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.8, 0.86);
    const D = (z) => ({
      z,
      pts: [
        [s * 0.8, 0.24],
        [s * 0.95, 0.24],
        [s * 0.995, 0.42],
        [s * 0.965, 0.775],
        [s * 0.71, 0.8],
        [s * 0.8, 0.78],
      ],
    });
    const doorGeo = polyLoft([D(-0.86), D(-0.3), D(0.3), D(0.86)], false);
    doorGeo.translate(0, -0.8, -0.86);
    const door = new THREE.Mesh(doorGeo, bodyMat);
    door.castShadow = true;
    hinge.add(door);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 1.66), trim);
    sill.position.set(s * 0.975, 0.28 - 0.8, -0.86);
    hinge.add(sill);
    const handleGlass = new THREE.Mesh(
      polyLoft(
        [
          { z: -0.8, pts: [[s * 0.725, 0.85], [s * 0.73, 0.85], [s * 0.555, 1.115], [s * 0.55, 1.115]] },
          { z: 0.84, pts: [[s * 0.64, 0.77], [s * 0.645, 0.77], [s * 0.505, 0.925], [s * 0.5, 0.925]] },
        ],
        false
      ).translate(0, -0.8, -0.86),
      glass
    );
    hinge.add(handleGlass);
    body.add(hinge);
    doors.push(hinge);
  }
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x002233, emissive: 0x33ccff, emissiveIntensity: 0.0 });
  for (const s of [-1, 1]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.6), ledMat);
    led.position.set(s * 0.8, 0.21, 0);
    body.add(led);
  }

  // underbody suction fan glow
  const fanTex = glowTexture('rgba(90,220,255,1)', 'rgba(0,120,255,0)');
  const fanGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 5.4),
    new THREE.MeshBasicMaterial({ map: fanTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  fanGlow.rotation.x = -Math.PI / 2;
  fanGlow.position.y = 0.04;
  group.add(fanGlow);
  const fanLight = new THREE.PointLight(0x33ccff, 0, 9, 2);
  fanLight.position.set(0, 0.15, 0);
  group.add(fanLight);

  const beam = new THREE.SpotLight(0xf2f6ff, 0, 140, 0.42, 0.45, 1.4);
  beam.position.set(0, 0.55, 2.1);
  beam.target.position.set(0, 0, 25);
  group.add(beam, beam.target);
  const tailLight = new THREE.PointLight(0xff1020, 1.5, 6, 2);
  tailLight.position.set(0, 0.6, -2.7);
  group.add(tailLight);

  // wheels
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4, metalness: 0.6 });
  const wheels = [];
  const W = [
    { x: 0.86, z: 1.4, r: 0.375, w: 0.3, front: true },
    { x: -0.86, z: 1.4, r: 0.375, w: 0.3, front: true },
    { x: 0.87, z: -1.4, r: 0.385, w: 0.34, front: false },
    { x: -0.87, z: -1.4, r: 0.385, w: 0.34, front: false },
  ];
  for (const d of W) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, d.r, d.z);
    const wheel = makeWheel(d.r, d.w);
    wheel.traverse((m) => m.isMesh && (m.castShadow = true));
    pivot.add(wheel);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.22), caliperMat);
    cal.position.set(-Math.sign(d.x) * 0.08, 0.12, -0.12);
    pivot.add(cal);
    group.add(pivot);
    wheels.push({ pivot, wheel, front: d.front, r: d.r, baseY: d.r });
  }

  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.06), new THREE.MeshBasicMaterial({ map: badgeTexture(), transparent: true }));
  badge.position.set(0, 0.68, -2.385);
  badge.rotation.y = Math.PI;
  body.add(badge);

  return { group, body, bodyMat, wheels, frontBar: lightWhite, plumes, fanGlow, ledMat, fanLight, beam, rearMat, roof, tailLight, wing, doors };
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
    this.doorsOpen = false;
    this.doorAnim = 0;
    this.tilt = new THREE.Vector2();
    this.t = 0;
  }

  setColor(hex) {
    this.m.bodyMat.color.setHex(hex);
  }

  setVersion(id) {
    this.m.wing.visible = id === 'rocket';
  }

  toggleRoof() {
    this.roofOn = !this.roofOn;
    this.m.roof.visible = this.roofOn;
    return this.roofOn;
  }

  toggleDoors() {
    this.doorsOpen = !this.doorsOpen;
    return this.doorsOpen;
  }

  update(dt, car, ctl) {
    this.t += dt;
    const g = this.m.group;
    g.position.copy(car.pos);
    g.quaternion.slerp(car.quat, 1 - Math.exp(-30 * dt));

    // doors close automatically once the car moves
    if (this.doorsOpen && car.speed > 3) this.doorsOpen = false;
    this.doorAnim += ((this.doorsOpen ? 1 : 0) - this.doorAnim) * (1 - Math.exp(-4 * dt));
    for (const d of this.m.doors) d.rotation.x = this.doorAnim * 1.15;

    const latTarget = car.grounded ? THREE.MathUtils.clamp(-car.latAccel * 0.006, -0.06, 0.06) : 0;
    const lonTarget = car.grounded ? THREE.MathUtils.clamp(-car.lonAccel * 0.0025, -0.05, 0.05) : 0;
    this.tilt.x += (lonTarget - this.tilt.x) * (1 - Math.exp(-8 * dt));
    this.tilt.y += (latTarget - this.tilt.y) * (1 - Math.exp(-8 * dt));
    this.m.body.rotation.set(this.tilt.x, 0, this.tilt.y);
    this.m.body.position.y = car.suction ? -0.04 : 0;

    this.spin += (car.wheelSpeed / 0.38) * dt;
    this.steerVis += (ctl.steer * 0.5 * car.steerScale - this.steerVis) * (1 - Math.exp(-12 * dt));
    for (const w of this.m.wheels) {
      w.wheel.rotation.x = this.spin;
      w.pivot.rotation.y = w.front ? this.steerVis : 0;
      const drop = car.grounded ? 0 : -0.07;
      w.pivot.position.y += (w.baseY + drop - w.pivot.position.y) * (1 - Math.exp(-10 * dt));
    }

    // headlights hidden in the light bar
    this.lightAnim += ((this.lights ? 1 : 0) - this.lightAnim) * (1 - Math.exp(-6 * dt));
    this.m.frontBar.emissiveIntensity = 1.2 + this.lightAnim * 1.6;
    this.m.beam.intensity = this.lightAnim * 420;

    const braking = ctl.brake > 0.1 && car.forwardSpeed > 0.5;
    this.m.rearMat.emissiveIntensity = braking ? 5 : 1.6;
    this.m.tailLight.intensity = braking ? 4 : 1.2;

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
