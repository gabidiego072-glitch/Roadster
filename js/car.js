import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loftGeometry, glowTexture } from './geom.js';
import { smoothLoft, convexPrism } from './shape.js';
import { toTexture, treadNormal, sidewallCanvas, discCanvas, honeycombCanvas, ledStripCanvas, screenCanvas } from './textures.js';

export const COLORS = [
  { id: 'white', name: 'Blanco Nácar', hex: 0xe6e8eb, pearl: true },
  { id: 'red', name: 'Rojo Multicapa', hex: 0xa50f1a },
  { id: 'silver', name: 'Plata Galáctico', hex: 0x9ea3aa },
  { id: 'black', name: 'Negro Sólido', hex: 0x101114 },
  { id: 'blue', name: 'Azul Espacio', hex: 0x1b3a8c },
];

let envMap = null;
export function setEnvMap(e) {
  envMap = e;
}

// Roughness never goes below 0.08: razor-sharp highlights can exceed what the HDR buffers hold.
function paint(hex, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    metalness: 0.35,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMap,
    envMapIntensity: 1.4,
    ...extra,
  });
}

const glassMat = () =>
  new THREE.MeshPhysicalMaterial({
    color: 0x05070a,
    metalness: 0.2,
    roughness: 0.08,
    transparent: true,
    opacity: 0.85,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMap,
    envMapIntensity: 1.4,
  });

const darkMat = (rough = 0.55) => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: rough, metalness: 0.4, envMap, envMapIntensity: 0.5 });

// ---------- Body shape (metres; front axle z=+1.40, rear axle z=-1.40) ----------
// Half profile: bottom centre, sill, lower side, shoulder crease, top edge, top centre.
const S = (z, b, ws, wl, yl, wsh, ysh, wt, yt) => ({ z, pts: [[0, b], [ws, b], [wl, yl], [wsh, ysh], [wt, yt], [0, yt + 0.012]] });
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
// One-piece tinted canopy from mid-hood to the rear deck
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

// ---------- Wheels ----------
let wheelAssets = null;
function wheelMaterials() {
  if (wheelAssets) return wheelAssets;
  const tread = toTexture(treadNormal(), { srgb: false, repeat: [34, 1] });
  wheelAssets = {
    tyre: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.88, metalness: 0, side: THREE.DoubleSide }),
    tread: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, normalMap: tread, normalScale: new THREE.Vector2(1.2, 1.2) }),
    sidewall: new THREE.MeshBasicMaterial({ map: toTexture(sidewallCanvas()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.5, metalness: 0.7, envMap, side: THREE.DoubleSide }),
    face: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.6, metalness: 0.5, envMap }),
    spoke: new THREE.MeshStandardMaterial({ color: 0xa9aeb5, roughness: 0.32, metalness: 0.85, envMap, envMapIntensity: 0.6 }),
    spokeDark: new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.35, metalness: 0.8, envMap }),
    disc: new THREE.MeshStandardMaterial({ map: toTexture(discCanvas()), roughness: 0.45, metalness: 0.85, envMap, alphaTest: 0.5, side: THREE.DoubleSide }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.4, metalness: 0.6, envMap }),
  };
  return wheelAssets;
}

function spokeFace(ri) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    for (const off of [-0.022, 0.022]) {
      const sh = new THREE.Shape();
      sh.moveTo(0.065, off - 0.011);
      sh.lineTo(ri - 0.012, off * 0.5 - 0.007);
      sh.lineTo(ri - 0.012, off * 0.5 + 0.007);
      sh.lineTo(0.065, off + 0.011);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 1, curveSegments: 1 });
      g.rotateZ((i / 6) * Math.PI * 2 + 0.18);
      parts.push(g);
    }
  }
  const hub = new THREE.CylinderGeometry(0.075, 0.08, 0.04, 6);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, 0.012);
  parts.push(hub.toNonIndexed());
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

function makeWheel(radius, width) {
  const M = wheelMaterials();
  const g = new THREE.Group();
  const ri = radius * 0.74;
  const hw = width / 2;
  const prof = [
    [ri, -hw + 0.012],
    [ri + 0.016, -hw - 0.004],
    [radius - 0.05, -hw - 0.007],
    [radius - 0.014, -hw + 0.018],
    [radius, -hw + 0.05],
    [radius, hw - 0.05],
    [radius - 0.014, hw - 0.018],
    [radius - 0.05, hw + 0.007],
    [ri + 0.016, hw + 0.004],
    [ri, hw - 0.012],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tyreGeo = new THREE.LatheGeometry(prof, 64);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, M.tyre);
  g.add(tyre);
  const treadGeo = new THREE.CylinderGeometry(radius + 0.002, radius + 0.002, width - 0.1, 64, 1, true);
  treadGeo.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(treadGeo, M.tread));
  const barrelGeo = new THREE.CylinderGeometry(ri, ri, width - 0.03, 40, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(barrelGeo, M.barrel));

  const face = spokeFace(ri);
  // dark centre plate so you cannot see through the wheel; brakes sit between it and the spokes
  const centre = new THREE.Mesh(new THREE.CircleGeometry(ri - 0.004, 40), M.face);
  centre.rotation.y = Math.PI / 2;
  centre.material.side = THREE.DoubleSide;
  g.add(centre);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.RingGeometry(ri + 0.018, radius - 0.03, 64), M.sidewall);
    wall.position.x = s * (hw + 0.008);
    wall.rotation.y = (s * Math.PI) / 2;
    g.add(wall);
    const spokes = new THREE.Mesh(face, M.spoke);
    spokes.position.x = s * (hw - 0.045);
    spokes.rotation.y = (s * Math.PI) / 2;
    g.add(spokes);
  }
  return g;
}

function plumeMesh(len, radius, color) {
  const geo = new THREE.ConeGeometry(radius, len, 16, 1, true);
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

export function buildRoadster(colorHex) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const bodyMat = paint(colorHex, { iridescence: 0.1, iridescenceIOR: 1.3 });
  const shell = new THREE.Mesh(smoothLoft(BODY, { smooth: [3, 4, 5], subdiv: 4, crease: 30 }), bodyMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  // tinted bronze glass roof (reflective, like the reveal car)
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x2c1a12,
    metalness: 0.6,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMap,
    envMapIntensity: 2.2,
  });
  const canopy = new THREE.Mesh(smoothLoft(CANOPY, { subdiv: 5, crease: 40 }), glass);
  canopy.castShadow = true;
  body.add(canopy);
  const roofMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0705, roughness: 0.08, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, envMap, envMapIntensity: 2 });
  const roof = new THREE.Mesh(
    smoothLoft(
      [
        { z: -0.95, pts: [[0, 1.12], [0.5, 1.092], [0.52, 1.102], [0, 1.138]] },
        { z: 0.35, pts: [[0, 1.1], [0.5, 1.072], [0.52, 1.082], [0, 1.118]] },
      ],
      { subdiv: 1, crease: 60 }
    ),
    roofMat
  );
  body.add(roof);

  // rear sail panels (flying buttresses)
  for (const s of [-1, 1]) {
    const sail = new THREE.Mesh(
      convexPrism(
        [
          [s * 0.99, 0.82, -0.92],
          [s * 0.97, 0.88, -2.08],
          [s * 0.64, 1.02, -1.5],
        ],
        0.05
      ),
      bodyMat
    );
    sail.castShadow = true;
    body.add(sail);
  }

  // ---------- interior (visible with the doors open or the roof panel off) ----------
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xc8581f, roughness: 0.62 });
  const seatInsert = new THREE.MeshStandardMaterial({ color: 0x8e3a12, roughness: 0.7 });
  for (const x of [-0.33, 0.33]) {
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.56, 0.12, 3, 0.04), seatMat);
    back.position.set(x, 0.66, -0.47);
    back.rotation.x = -0.32;
    body.add(back);
    const insert = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.4, 0.02, 2, 0.01), seatInsert);
    insert.position.set(x, 0.66, -0.4);
    insert.rotation.x = -0.32;
    body.add(insert);
    const head = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.14, 0.1, 3, 0.04), seatMat);
    head.position.set(x, 1.0, -0.6);
    head.rotation.x = -0.32;
    body.add(head);
    const cush = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.12, 0.52, 3, 0.04), seatMat);
    cush.position.set(x, 0.4, -0.15);
    body.add(cush);
  }
  const dash = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.12, 0.36, 3, 0.04), darkMat(0.7));
  dash.position.set(0, 0.66, 0.58);
  body.add(dash);
  const consoleBox = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.16, 0.9, 2, 0.03), darkMat(0.6));
  consoleBox.position.set(0, 0.42, 0.05);
  body.add(consoleBox);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), new THREE.MeshBasicMaterial({ map: toTexture(screenCanvas()), toneMapped: false }));
  screen.position.set(0, 0.79, 0.46);
  screen.rotation.x = -0.55;
  body.add(screen);
  const yokeMat = darkMat(0.45);
  const yoke = new THREE.Group();
  const grip = new THREE.BoxGeometry(0.035, 0.16, 0.035);
  for (const s of [-1, 1]) {
    const gr = new THREE.Mesh(grip, yokeMat);
    gr.position.x = s * 0.15;
    yoke.add(gr);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.035, 0.035), yokeMat);
  bar.position.y = -0.07;
  yoke.add(bar);
  const hubY = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), yokeMat);
  hubY.rotation.x = Math.PI / 2;
  yoke.add(hubY);
  yoke.position.set(0.33, 0.74, 0.32);
  yoke.rotation.x = -0.35;
  body.add(yoke);

  // ---------- front ----------
  const trim = darkMat(0.5);
  const honey = new THREE.MeshStandardMaterial({ map: toTexture(honeycombCanvas(), { repeat: [3, 1] }), roughness: 0.7, metalness: 0.3 });
  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.13, 0.1), [trim, trim, trim, trim, honey, trim]);
  intake.position.set(0, 0.41, 2.3);
  body.add(intake);
  const splitter = new THREE.Mesh(new RoundedBoxGeometry(1.74, 0.04, 0.32, 2, 0.015), darkMat(0.35));
  splitter.position.set(0, 0.27, 2.22);
  body.add(splitter);
  for (const z of [1.4, -1.4])
    for (const s of [-1, 1]) {
      const liner = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.46), darkMat(0.9));
      liner.position.set(s * 0.715, 0.48, z);
      liner.rotation.y = (s * Math.PI) / 2;
      body.add(liner);
    }
  // full-width light bar: housing + emissive strip (headlights hidden inside)
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.045, 0.04), darkMat(0.2));
  housing.position.set(0, 0.5, 2.318);
  body.add(housing);
  const lightWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f6ff, emissiveIntensity: 1.6 });
  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.016, 0.03), lightWhite);
  frontBar.position.set(0, 0.5, 2.335);
  body.add(frontBar);
  for (const s of [-1, 1]) {
    const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.16), lightWhite);
    wrap.position.set(s * 0.9, 0.52, 2.27);
    wrap.rotation.y = s * 0.5;
    body.add(wrap);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.1), new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xff7a1a, emissiveIntensity: 1.5 }));
    marker.position.set(s * 0.995, 0.74, 0.95);
    body.add(marker);
  }

  // ---------- rear ----------
  const tail = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.42, 0.08, 2, 0.02), trim);
  tail.position.set(0, 0.5, -2.34);
  body.add(tail);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.3), darkMat(0.35));
    fin.position.set(i * 0.16, 0.29, -2.2);
    body.add(fin);
  }
  const rearMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1020, emissiveIntensity: 1.6, emissiveMap: toTexture(ledStripCanvas(56)) });
  const rearBar = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.035), rearMat);
  rearBar.position.set(0, 0.79, -2.382);
  rearBar.rotation.y = Math.PI;
  body.add(rearBar);
  const rearSolid = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1020, emissiveIntensity: 1.6 });
  for (const s of [-1, 1]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), rearSolid);
    corner.position.set(s * 0.68, 0.6, -2.39);
    body.add(corner);
  }
  const reverseMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0 });
  for (const s of [-1, 1]) {
    const rv = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.02), reverseMat);
    rv.position.set(s * 0.4, 0.6, -2.39);
    body.add(rv);
  }

  // ---------- cold-gas thrusters ----------
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 1, roughness: 0.25, envMap, side: THREE.DoubleSide });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28, envMap, envMapIntensity: 1.2, side: THREE.DoubleSide });
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: 0x2a7fa0, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  const plumes = { rear: [], lift: [], side: [] };
  const addNozzle = (x, y, z, dir, kind, r = 0.06, mat = nozzleMat) => {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.12, 16, 1, true), mat);
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    n.position.y = -0.04;
    holder.add(n);
    const ringGeo = new THREE.CircleGeometry(r * 0.78, 16);
    ringGeo.rotateX(Math.PI / 2);
    const glowDisc = new THREE.Mesh(ringGeo, nozzleGlow);
    glowDisc.position.y = 0.0;
    holder.add(glowDisc);
    const pl = plumeMesh(1.6, r * 2.4, 0xd8f0ff);
    pl.position.y = -0.1;
    holder.add(pl);
    body.add(holder);
    plumes[kind].push({ holder, plume: pl, dir });
  };
  for (const x of [-0.55, -0.33, -0.11, 0.11, 0.33, 0.55]) addNozzle(x, 0.42, -2.36, new THREE.Vector3(0, 0, -1), 'rear', 0.055);
  for (const s of [-1, 1]) for (const z of [-0.9, 0.9]) addNozzle(s * 0.86, 0.2, z, new THREE.Vector3(0, -1, 0), 'lift', 0.05, goldMat);
  for (const s of [-1, 1]) for (const z of [-2.0, 2.0]) addNozzle(s * 0.92, 0.6, z, new THREE.Vector3(s, 0, 0), 'side', 0.035);

  // ---------- rear wing (Rocket) ----------
  const wing = new THREE.Group();
  const wingMat = paint(0x15171a, { metalness: 0.6, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.42, 0.34, 2, 0.012), wingMat);
    strut.position.set(s * 0.45, 1.06, -2.02);
    strut.rotation.x = 0.25;
    wing.add(strut);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.26, 0.5, 2, 0.01), wingMat);
    plate.position.set(s * 0.9, 1.26, -2.12);
    wing.add(plate);
    const plateLight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.025), rearSolid);
    plateLight.position.set(s * 0.9, 1.26, -2.37);
    wing.add(plateLight);
  }
  const blade = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.04, 0.42, 2, 0.015), wingMat);
  blade.position.set(0, 1.29, -2.14);
  blade.rotation.x = -0.12;
  wing.add(blade);
  const wingLight = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.025, 0.02), rearSolid);
  wingLight.position.set(0, 1.31, -2.36);
  wing.add(wingLight);
  wing.visible = false;
  body.add(wing);

  // ---------- butterfly doors ----------
  const doors = [];
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.8, 0.86);
    const D = (z, bulge) => ({
      z,
      pts: [
        [s * 0.8, 0.24],
        [s * 0.95, 0.24],
        [s * (0.995 + bulge), 0.42],
        [s * (0.965 + bulge * 0.5), 0.775],
        [s * 0.71, 0.8],
        [s * 0.8, 0.78],
      ],
    });
    const doorGeo = smoothLoft([D(-0.86, 0), D(-0.3, 0.008), D(0.3, 0.008), D(0.86, 0)], { mirror: false, subdiv: 3, crease: 30 });
    doorGeo.translate(0, -0.8, -0.86);
    const door = new THREE.Mesh(doorGeo, bodyMat);
    door.castShadow = true;
    hinge.add(door);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 1.66), trim);
    sill.position.set(s * 0.975, 0.28 - 0.8, -0.86);
    hinge.add(sill);
    for (const zEdge of [0.855, -0.855]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.5, 0.008), seamMat);
      seam.position.set(s * 0.982, 0.52 - 0.8, zEdge - 0.86);
      hinge.add(seam);
    }
    const doorGlass = new THREE.Mesh(
      smoothLoft(
        [
          { z: -0.8, pts: [[s * 0.725, 0.85], [s * 0.73, 0.85], [s * 0.555, 1.115], [s * 0.55, 1.115]] },
          { z: 0.84, pts: [[s * 0.64, 0.77], [s * 0.645, 0.77], [s * 0.505, 0.925], [s * 0.5, 0.925]] },
        ],
        { mirror: false, subdiv: 1, crease: 60 }
      ).translate(0, -0.8, -0.86),
      glass
    );
    hinge.add(doorGlass);
    body.add(hinge);
    doors.push(hinge);
  }
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x002233, emissive: 0x33ccff, emissiveIntensity: 0.0 });
  for (const s of [-1, 1]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.6), ledMat);
    led.position.set(s * 0.8, 0.21, 0);
    body.add(led);
  }

  // soft contact shadow
  const aoTex = glowTexture('rgba(0,0,0,1)', 'rgba(0,0,0,0)');
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.4),
    new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.02;
  contact.renderOrder = 1;
  group.add(contact);

  // underbody suction fan glow
  const fanTex = glowTexture('rgba(90,220,255,1)', 'rgba(0,120,255,0)');
  const fanGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 5.4),
    new THREE.MeshBasicMaterial({ map: fanTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  fanGlow.rotation.x = -Math.PI / 2;
  fanGlow.position.y = 0.04;
  group.add(fanGlow);
  const fanLight = new THREE.PointLight(0x33ccff, 0, 7, 2);
  fanLight.position.set(0, 0.35, 0);
  group.add(fanLight);

  const beam = new THREE.SpotLight(0xf2f6ff, 0, 150, 0.45, 0.5, 1.4);
  beam.position.set(0, 0.55, 2.1);
  beam.target.position.set(0, 0, 25);
  group.add(beam, beam.target);
  const tailLight = new THREE.PointLight(0xff1020, 0.6, 5, 2);
  tailLight.position.set(0, 0.55, -3.1);
  group.add(tailLight);

  // wheels
  const M = wheelMaterials();
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
    const side = Math.sign(d.x);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(d.r * 0.6, 40), M.disc);
    disc.position.x = side * (d.w / 2 - 0.09);
    disc.rotation.y = (side * Math.PI) / 2;
    pivot.add(disc);
    const cal = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.2, 0.12, 2, 0.02), M.caliper);
    cal.position.set(side * (d.w / 2 - 0.075), 0.13, -0.1);
    cal.rotation.x = 0.5;
    pivot.add(cal);
    group.add(pivot);
    wheels.push({ pivot, wheel, front: d.front, r: d.r, baseY: d.r });
  }

  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.06), new THREE.MeshBasicMaterial({ map: badgeTexture(), transparent: true }));
  badge.position.set(0, 0.68, -2.385);
  badge.rotation.y = Math.PI;
  body.add(badge);

  return { group, body, bodyMat, wheels, contact, frontBar: lightWhite, plumes, nozzleGlow, fanGlow, ledMat, fanLight, beam, rearMat, rearSolid, reverseMat, roof, tailLight, wing, doors };
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
    this.lights = false;
    this.lightAnim = 0;
    this.roofOn = true;
    this.doorsOpen = false;
    this.doorAnim = 0;
    this.tilt = new THREE.Vector2();
    this.tiltVel = new THREE.Vector2();
    this.t = 0;
  }

  setColor(hex) {
    this.m.bodyMat.color.setHex(hex);
    const c = COLORS.find((x) => x.hex === hex);
    this.m.bodyMat.iridescence = c && c.pearl ? 0.1 : 0;
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
    g.quaternion.slerp(car.quat, 1 - Math.exp(-40 * dt));

    if (this.doorsOpen && car.speed > 3) this.doorsOpen = false;
    this.doorAnim += ((this.doorsOpen ? 1 : 0) - this.doorAnim) * (1 - Math.exp(-4 * dt));
    for (const d of this.m.doors) d.rotation.x = this.doorAnim * 1.15;

    // body roll and pitch on a damped spring (suspension feel)
    const latTarget = car.grounded ? THREE.MathUtils.clamp(-(car.latAccel || 0) * 0.0055, -0.065, 0.065) : 0;
    const lonTarget = car.grounded ? THREE.MathUtils.clamp(-(car.axFilt || 0) * 0.0028, -0.05, 0.05) : 0;
    const k = 120;
    const c = 16;
    this.tiltVel.x += ((lonTarget - this.tilt.x) * k - this.tiltVel.x * c) * dt;
    this.tiltVel.y += ((latTarget - this.tilt.y) * k - this.tiltVel.y * c) * dt;
    this.tilt.x += this.tiltVel.x * dt;
    this.tilt.y += this.tiltVel.y * dt;
    this.m.body.rotation.set(this.tilt.x, 0, this.tilt.y);
    this.m.body.position.y = car.suction ? -0.04 : 0;

    const spinSpeed = car.wheelSpeed + (car.wheelspin ? 25 : 0);
    this.spin += (spinSpeed / 0.38) * dt;
    const steerVis = THREE.MathUtils.clamp(car.steerAngle || 0, -0.6, 0.6);
    for (const w of this.m.wheels) {
      w.wheel.rotation.x = this.spin;
      w.pivot.rotation.y = w.front ? steerVis : 0;
      const drop = car.grounded ? 0 : -0.07;
      w.pivot.position.y += (w.baseY + drop - w.pivot.position.y) * (1 - Math.exp(-10 * dt));
    }

    this.lightAnim += ((this.lights ? 1 : 0) - this.lightAnim) * (1 - Math.exp(-6 * dt));
    this.m.frontBar.emissiveIntensity = 1.2 + this.lightAnim * 1.6;
    this.m.beam.intensity = this.lightAnim * 420;

    const vx = car.forwardSpeed;
    const braking = (ctl.brake > 0.1 && vx > 0.5) || (ctl.handbrake && car.speed > 0.5);
    this.m.rearMat.emissiveIntensity = braking ? 5 : 1.6;
    this.m.rearSolid.emissiveIntensity = braking ? 5 : 1.6;
    this.m.tailLight.intensity = braking ? 2 : 0.6;
    this.m.reverseMat.emissiveIntensity = vx < -0.5 ? 3 : 0;

    const flick = 0.75 + Math.random() * 0.25;
    const setPl = (list, amount, len) => {
      for (const p of list) {
        p.plume.material.opacity = amount * 0.55 * flick;
        p.plume.scale.set(1, Math.max(0.01, amount * len * flick), 1);
      }
    };
    setPl(this.m.plumes.rear, car.fx.boost, 1.6);
    setPl(this.m.plumes.lift, car.fx.lift, 1.2);
    this.m.nozzleGlow.opacity = 0.18 + Math.max(car.fx.boost, car.fx.lift) * 0.8;
    for (const p of this.m.plumes.side) {
      const want = car.fx.roll * Math.sign(p.dir.x);
      const a = Math.max(0, want) + car.fx.rot * 0.4;
      p.plume.material.opacity = Math.min(1, a) * 0.5 * flick;
      p.plume.scale.set(1, Math.max(0.01, Math.min(1, a) * 0.8), 1);
    }

    this.m.contact.material.opacity += ((car.grounded ? 0.75 : 0) - this.m.contact.material.opacity) * (1 - Math.exp(-12 * dt));
    const s = car.suction ? 1 : 0;
    const pulse = 0.85 + Math.sin(this.t * 30) * 0.15;
    this.m.fanGlow.material.opacity += (s * 0.9 * pulse - this.m.fanGlow.material.opacity) * (1 - Math.exp(-10 * dt));
    this.m.ledMat.emissiveIntensity = s * 4 * pulse;
    this.m.fanLight.intensity = s * 4 * pulse;
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
  const front = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.02), new THREE.MeshStandardMaterial({ emissive: 0xe8f4ff, emissiveIntensity: 1.2, color: 0x222222 }));
  front.position.set(0, 0.62, 2.31);
  g.add(front);
  g.scale.setScalar(scale);
  return g;
}

function addSimpleWheels(g, r, zoff, xoff, wdt = 0.28) {
  const tm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const rm = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.3, envMap });
  for (const x of [-xoff, xoff])
    for (const z of [-zoff, zoff]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wdt, 24), tm);
      t.rotation.z = Math.PI / 2;
      t.position.set(x, r, z);
      g.add(t);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.65, r * 0.65, wdt + 0.02, 18), rm);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(t.position);
      g.add(rim);
    }
}

export function buildCybertruck() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.95, roughness: 0.35, envMap, envMapIntensity: 1 });
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
