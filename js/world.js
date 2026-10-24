import * as THREE from 'three';
import { ribbonGeometry, canvasTexture, noiseFill, glowTexture, rand } from './geom.js';
import { buildSedan, buildCybertruck, buildSemi, buildCybercab } from './car.js';
import { toTexture, dirtSet, concreteSet, asphaltSet, corrugatedSet, moonCanvas } from './textures.js';

// Decorative objects live on layer 1: the main camera sees them, the reflection cameras skip them.
export const DECOR_LAYER = 1;
const decor = (o) => {
  o.layers.set(DECOR_LAYER);
  return o;
};

// World layout (metres). +Z points from the stage toward the arena.
export const LAYOUT = {
  spawn: { pos: new THREE.Vector3(0, 1.2, -62), yaw: 0 },
  stage: { x: 0, z: -62, w: 30, d: 16, h: 1.2 },
  loop: { x: 0, z0: 78, R: 12, W: 10 },
  kicker: { x: 92, z0: 0, len: 16, h: 4.5, W: 10 },
  lineup: { x: 92, z1: 22, z2: 42 },
  landing: { x: 92, z0: 46, len: 18, h: 4.5 },
  refill: new THREE.Vector3(-30, 0, 38),
  strip: { x: -112, w: 22, zStart: -40, zQuarter: -40 + 402.3, zEnd: 1450 },
  standA: new THREE.Vector3(330, 0, 330),
  standB: new THREE.Vector3(-420, 0, 640),
  starship: new THREE.Vector3(270, 0, -280),
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export function buildWorld(scene, quality) {
  const drivable = [];
  const colliders = [];
  const animated = [];
  const W = { drivable, colliders, rings: [], cheerTime: 0, treeState: 0 };

  // ---------------- Sky, stars, moon ----------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP;
        float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise(vec3 p){
          vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
          float n000 = hash3(i), n100 = hash3(i+vec3(1,0,0)), n010 = hash3(i+vec3(0,1,0)), n110 = hash3(i+vec3(1,1,0));
          float n001 = hash3(i+vec3(0,0,1)), n101 = hash3(i+vec3(1,0,1)), n011 = hash3(i+vec3(0,1,1)), n111 = hash3(i+vec3(1,1,1));
          return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y), mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
        }
        void main(){
          float h = clamp(vP.y, -0.2, 1.0);
          vec3 top = vec3(0.005,0.01,0.035);
          vec3 mid = vec3(0.02,0.04,0.10);
          vec3 hor = vec3(0.16,0.10,0.10);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.12, h));
          c = mix(c, top, smoothstep(0.12, 0.7, h));
          // Waco city glow to the north-east
          float city = pow(max(0.0, dot(normalize(vec3(vP.x,0.0,vP.z)), normalize(vec3(0.5,0.0,0.85)))), 6.0) * (1.0 - smoothstep(0.0, 0.18, h));
          c += vec3(0.35,0.18,0.06) * city * 0.6;
          // Milky Way band with dust lanes
          vec3 bn = normalize(vec3(0.62, 0.35, -0.7));
          float d = dot(vP, bn);
          float band = exp(-d * d / 0.018);
          float clouds = vnoise(vP * 9.0) * 0.6 + vnoise(vP * 23.0) * 0.3 + vnoise(vP * 60.0) * 0.1;
          float dust = smoothstep(0.45, 0.7, vnoise(vP * 14.0 + 3.0));
          float mw = band * smoothstep(0.3, 0.85, clouds) * (1.0 - dust * 0.7) * smoothstep(0.02, 0.25, h);
          c += vec3(0.30, 0.29, 0.36) * mw * 0.32 + vec3(0.18, 0.14, 0.12) * band * 0.05 * smoothstep(0.02, 0.25, h);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  const sSize = [];
  const sPhase = [];
  const sCol = [];
  const bandN = new THREE.Vector3(0.62, 0.35, -0.7).normalize();
  const sv = new THREE.Vector3();
  for (let i = 0; i < 7000; i++) {
    const th = Math.random() * Math.PI * 2;
    const y = Math.pow(Math.random(), 0.7);
    const r = Math.sqrt(1 - y * y);
    sv.set(Math.cos(th) * r, y, Math.sin(th) * r);
    // keep extra stars only near the Milky Way band
    if (i > 3500 && Math.abs(sv.dot(bandN)) > 0.12) continue;
    sp.push(sv.x * 4000, sv.y * 4000 + 80, sv.z * 4000);
    const big = Math.random() < 0.04;
    sSize.push(big ? rand(3.5, 5.5) : rand(1.2, 2.8));
    sPhase.push(Math.random() * 6.28);
    const t = Math.random();
    sCol.push(t < 0.15 ? 1.0 : 0.85, t < 0.15 ? 0.85 : 0.9, t > 0.85 ? 0.75 : 1.0);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(sSize, 1));
  starGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(sPhase, 1));
  starGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(sCol, 3));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float aSize; attribute float aPhase; attribute vec3 aCol; uniform float uTime; uniform float uPR; varying float vA; varying vec3 vC;
      void main(){ vC = aCol; vA = 0.65 + 0.35 * sin(uTime * (1.5 + fract(aPhase) * 2.0) + aPhase * 7.0);
        gl_PointSize = aSize * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = smoothstep(0.5, 0.0, d); a = a * a * vA; gl_FragColor = vec4(vC * a, a); }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  scene.add(stars);
  animated.push((t) => (starMat.uniforms.uTime.value = t));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(moonCanvas()), fog: false, depthWrite: false, color: 0xdfe6f5 }));
  moon.position.set(-1600, 1500, -2600);
  moon.scale.setScalar(300);
  scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(160,185,255,0.5)', 'rgba(120,150,255,0)'), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moonHalo.position.copy(moon.position);
  moonHalo.scale.setScalar(900);
  scene.add(moonHalo);

  // ---------------- Lights ----------------
  scene.add(new THREE.HemisphereLight(0x6d82b8, 0x2a2016, 0.6));
  const moonLight = new THREE.DirectionalLight(0xb8c8ff, 0.8);
  moonLight.position.set(-60, 120, -80);
  moonLight.castShadow = quality !== 'low';
  moonLight.shadow.mapSize.set(2048, 2048);
  const sc = moonLight.shadow.camera;
  sc.left = sc.bottom = -45;
  sc.right = sc.top = 45;
  sc.near = 1;
  sc.far = 400;
  moonLight.shadow.bias = -0.0004;
  moonLight.shadow.normalBias = 0.03;
  scene.add(moonLight, moonLight.target);
  W.moonLight = moonLight;

  // ---------------- Ground ----------------
  const dirtTex = dirtSet(512);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({
      map: toTexture(dirtTex.color, { repeat: [640, 640], aniso: 16 }),
      normalMap: toTexture(dirtTex.normal, { srgb: false, repeat: [640, 640], aniso: 16 }),
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 1,
      color: 0xb8a690,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.surface = 'ground';
  scene.add(ground);
  drivable.push(ground);

  // 8 m concrete slabs with joints and wet patches that catch the stage lights
  const conc = concreteSet(1024);
  const concreteMat = new THREE.MeshStandardMaterial({
    map: toTexture(conc.color, { repeat: [30, 30], aniso: 16 }),
    normalMap: toTexture(conc.normal, { srgb: false, repeat: [30, 30], aniso: 16 }),
    roughnessMap: toTexture(conc.rough, { srgb: false, repeat: [30, 30], aniso: 16 }),
    roughness: 1,
    metalness: 0,
    color: 0x9a9da3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), concreteMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(30, 0.01, 20);
  pad.receiveShadow = true;
  scene.add(pad);

  // tyre marks from launches and practice runs
  const skidTex = canvasTexture(128, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (const x of [30, 98]) {
      for (let y = 0; y < h; y += 2) {
        const a = 0.55 * Math.min(1, y / 120) * (0.6 + Math.random() * 0.4);
        ctx.fillStyle = `rgba(8,8,8,${a})`;
        ctx.fillRect(x - 9 + Math.sin(y * 0.02) * 2, y, 18, 2);
      }
    }
  });
  const skidMat = new THREE.MeshBasicMaterial({ map: skidTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  for (const [x, z, len, rot] of [[0, 55, 22, 0], [1.2, 30, 18, 0.05], [-1, -30, 14, -0.04], [92, -20, 20, 0], [-112, -36, 30, 0], [-110.5, -30, 24, 0.02]]) {
    const sk = new THREE.Mesh(new THREE.PlaneGeometry(1.9, len), skidMat);
    sk.rotation.x = -Math.PI / 2;
    sk.rotation.z = rot;
    sk.position.set(x, 0.035, z);
    scene.add(sk);
  }

  // road links from pad to drag strip and test stands
  const asph = asphaltSet(512);
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: toTexture(asph.color, { repeat: [2, 60], aniso: 16 }),
    normalMap: toTexture(asph.normal, { srgb: false, repeat: [2, 60], aniso: 16 }),
    roughness: 0.88,
    color: 0xb0b0b0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const road = (x1, z1, x2, z2, w) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), asphaltMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(x2 - x1, z2 - z1);
    m.position.set((x1 + x2) / 2, 0.015, (z1 + z2) / 2);
    m.receiveShadow = true;
    scene.add(m);
  };
  road(-90, 0, LAYOUT.strip.x + 10, 0, 12);
  road(150, 140, LAYOUT.standA.x - 30, LAYOUT.standA.z - 30, 12);
  road(150, -100, LAYOUT.starship.x - 20, LAYOUT.starship.z + 20, 12);

  // ---------------- Drag strip ----------------
  const S = LAYOUT.strip;
  const stripLen = S.zEnd - (S.zStart - 30);
  const stripTex = canvasTexture(256, 1024, (ctx, w, h) => {
    noiseFill(ctx, w, h, '#1f2023', 0.16, 30000, 1.2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    ctx.fillRect(4, 0, 6, h);
    ctx.fillRect(w - 10, 0, 6, h);
  }, { repeat: [1, stripLen / 40] });
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(S.w, stripLen),
    new THREE.MeshStandardMaterial({
      map: stripTex,
      normalMap: toTexture(asph.normal, { srgb: false, repeat: [2, stripLen / 10], aniso: 16 }),
      roughness: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    })
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(S.x, 0.02, (S.zStart - 30 + S.zEnd) / 2);
  strip.receiveShadow = true;
  scene.add(strip);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const z of [S.zStart, S.zQuarter]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(S.w, 0.6), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(S.x, 0.03, z);
    scene.add(l);
  }
  // LED edge lines along strip
  addLedLine(scene, S.x - S.w / 2 - 0.5, S.zStart - 30, S.x - S.w / 2 - 0.5, S.zEnd, 0x2bd2ff);
  addLedLine(scene, S.x + S.w / 2 + 0.5, S.zStart - 30, S.x + S.w / 2 + 0.5, S.zEnd, 0x2bd2ff);
  // christmas tree
  const tree = new THREE.Group();
  tree.position.set(S.x, 0, S.zStart + 2);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  pole.position.y = 2;
  tree.add(pole);
  const bulbs = [];
  const bulbColors = [0xffaa00, 0xffaa00, 0xffaa00, 0x00ff55, 0xff1100];
  bulbColors.forEach((c, i) => {
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0.05 }));
      b.position.set(s * 0.35, 3.6 - i * 0.45, 0);
      tree.add(b);
      bulbs.push({ mesh: b, idx: i });
    }
  });
  scene.add(tree);
  W.setTree = (state) => {
    // state: 0 off, 1..3 amber count, 4 green, 5 red (foul)
    for (const b of bulbs) {
      let on = false;
      if (state >= 1 && state <= 4 && b.idx < Math.min(state, 3)) on = true;
      if (state === 4 && b.idx === 3) on = true;
      if (state === 5 && b.idx === 4) on = true;
      b.mesh.material.emissiveIntensity = on ? 6 : 0.05;
    }
  };
  // gantries
  addGantry(scene, S.x, S.zStart, S.w + 6, 'SALIDA · 0–60 MPH');
  addGantry(scene, S.x, S.zQuarter, S.w + 6, '1/4 MILLA');
  addGantry(scene, S.x, S.zEnd - 60, S.w + 6, 'VELOCIDAD PUNTA');
  addLabel(scene, 'DRAG STRIP', new THREE.Vector3(S.x, 9, S.zStart - 8), 26, '#7fe3ff');

  // ---------------- Stage + arch + LED screen ----------------
  const ST = LAYOUT.stage;
  const stageMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.4 });
  const stage = new THREE.Mesh(new THREE.BoxGeometry(ST.w, ST.h, ST.d), stageMat);
  stage.position.set(ST.x, ST.h / 2, ST.z);
  stage.receiveShadow = stage.castShadow = true;
  stage.userData.surface = 'stage';
  scene.add(stage);
  drivable.push(stage);
  colliders.push(box(ST.x - ST.w / 2, 0, ST.z - ST.d / 2, ST.x + ST.w / 2, ST.h, ST.z + ST.d / 2, { groundOnly: true }));
  // glowing stage edge
  const edge = new THREE.Mesh(new THREE.BoxGeometry(ST.w, 0.06, 0.06), new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 3 }));
  edge.position.set(ST.x, ST.h + 0.02, ST.z + ST.d / 2);
  scene.add(edge);
  // turntable disc on stage
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.05, 64), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.45, metalness: 0.7 }));
  disc.position.set(ST.x, ST.h + 0.025, ST.z);
  scene.add(disc);
  const discRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.05, 6, 96), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7fdcff, emissiveIntensity: 1.4 }));
  discRing.rotation.x = Math.PI / 2;
  discRing.position.set(ST.x, ST.h + 0.06, ST.z);
  scene.add(discRing);
  // ramp down from stage front
  const ramp = wedge(12, 10, ST.h, stageMat, stageMat);
  ramp.rotation.y = Math.PI;
  ramp.position.set(ST.x, 0, ST.z + ST.d / 2 + 10);
  ramp.userData.surface = 'ramp';
  scene.add(ramp);
  drivable.push(ramp);

  // arch structure behind stage (multiple glowing arches)
  const archGroup = new THREE.Group();
  archGroup.position.set(ST.x, 0, ST.z - ST.d / 2 - 2);
  const archMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.8, roughness: 0.3 });
  const archGlowMat = new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x9fe8ff, emissiveIntensity: 1.6 });
  for (let i = 0; i < 5; i++) {
    const r = 24 - i * 0.6;
    const a = new THREE.Mesh(new THREE.TorusGeometry(r, i === 0 ? 0.9 : 0.12, 10, 96, Math.PI), i === 0 ? archMat : archGlowMat);
    a.position.z = -i * 2.2;
    archGroup.add(a);
  }
  // LED wall inside arch
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 1024;
  screenCanvas.height = 420;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(32, 13), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 9, -1);
  archGroup.add(screen);
  scene.add(archGroup);
  W.screen = { canvas: screenCanvas, tex: screenTex, last: -1 };
  colliders.push(box(-26, 0, ST.z - ST.d / 2 - 14, 26, 30, ST.z - ST.d / 2 - 1, {}));

  // truss towers with stage spotlights
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x30333a, metalness: 0.8, roughness: 0.4 });
  const spotTargets = [];
  for (const x of [-19, 19]) {
    for (const z of [ST.z + 7]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), trussMat);
      t.position.set(x, 7, z);
      scene.add(t);
      colliders.push(box(x - 0.6, 0, z - 0.6, x + 0.6, 14, z + 0.6, {}));
      const sl = new THREE.SpotLight(0xffffff, 480, 80, 0.32, 0.5, 1.6);
      sl.position.set(x, 13.5, z);
      sl.target.position.set(ST.x, ST.h, ST.z);
      scene.add(sl, sl.target);
      spotTargets.push(sl);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1.5 }));
      head.position.set(x, 13.6, z);
      scene.add(head);
      addBeam(scene, sl.position, sl.target.position, 3.2, 0xffffff, 0.06);
    }
  }
  const backSpot = new THREE.SpotLight(0x88ccff, 900, 70, 0.5, 0.6, 1.6);
  backSpot.position.set(0, 26, ST.z - 12);
  backSpot.target.position.set(0, 0, ST.z + 4);
  scene.add(backSpot, backSpot.target);

  // sweeping searchlights into the sky
  const searchBeams = [];
  for (let i = 0; i < 8; i++) {
    const x = -30 + (i / 7) * 60;
    const b = makeSkyBeam(i % 2 ? 0x9fd8ff : 0xffffff);
    b.position.set(x, 0, ST.z - 20);
    scene.add(b);
    searchBeams.push({ b, phase: i * 0.9, side: i < 4 ? -1 : 1 });
  }
  animated.push((t) => {
    for (const s of searchBeams) {
      const ang = Math.sin(t * 0.35 + s.phase) * 0.45 + s.side * 0.12;
      s.b.rotation.set(-0.18 + Math.cos(t * 0.27 + s.phase) * 0.12, 0, ang);
    }
    disc.rotation.y = t * 0.2;
  });

  // ---------------- Crowd + barricades ----------------
  const crowdCount = quality === 'low' ? 500 : 1100;
  const crowd = decor(new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.23, 0.95, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), crowdCount));
  const heads = decor(new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), crowdCount));
  const skin = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x5c3a21, 0x3b2219];
  const crowdData = [];
  const col = new THREE.Color();
  for (let i = 0; i < crowdCount; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * rand(15, 46);
    const z = rand(-50, 8);
    const h = rand(0.9, 1.1);
    crowdData.push({ x, z, h, ph: Math.random() * 6.28, sp: rand(4, 7) });
    col.setHSL(Math.random(), rand(0.05, 0.35), rand(0.06, 0.2));
    crowd.setColorAt(i, col);
    heads.setColorAt(i, col.setHex(skin[i % skin.length]).multiplyScalar(0.55));
  }
  scene.add(crowd, heads);
  const phoneGeo = new THREE.BufferGeometry();
  const phones = [];
  crowdData.forEach((c, i) => {
    if (i % 4 === 0) phones.push(c.x, 2.1, c.z);
  });
  phoneGeo.setAttribute('position', new THREE.Float32BufferAttribute(phones, 3));
  const phoneMat = new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.35, transparent: true, opacity: 0.9 });
  scene.add(decor(new THREE.Points(phoneGeo, phoneMat)));
  colliders.push(box(13.5, 0, -52, 48, 2.5, 10, {}));
  colliders.push(box(-48, 0, -52, -13.5, 2.5, 10, {}));
  const barrMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 62), barrMat);
    bar.position.set(s * 13, 0.55, -21);
    scene.add(bar);
  }
  let crowdFrame = 0;
  animated.push((t) => {
    if (crowdFrame++ % 2) return;
    const cheer = Math.max(0, W.cheerTime - t);
    for (let i = 0; i < crowdCount; i++) {
      const c = crowdData[i];
      const jump = cheer > 0 ? Math.max(0, Math.sin(t * c.sp + c.ph)) * 0.5 : Math.max(0, Math.sin(t * 1.3 + c.ph)) * 0.04;
      tmpV.set(c.x, 0.71 * c.h + jump, c.z);
      tmpS.set(1, c.h, 1);
      tmpM.compose(tmpV, tmpQ.identity(), tmpS);
      crowd.setMatrixAt(i, tmpM);
      tmpV.set(c.x, 1.55 * c.h + jump, c.z);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      heads.setMatrixAt(i, tmpM);
    }
    crowd.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    phoneMat.opacity = 0.6 + Math.sin(t * 3) * 0.2 + (cheer > 0 ? 0.3 : 0);
  });

  // runway LED lines from stage to arena
  addLedLine(scene, -10, -44, -10, 58, 0xffffff);
  addLedLine(scene, 10, -44, 10, 58, 0xffffff);

  // ---------------- Inverted ramp (half loop) ----------------
  const L = LAYOUT.loop;
  const loopFn = (t) => {
    const th = t * Math.PI;
    return {
      p: new THREE.Vector3(L.x, L.R * (1 - Math.cos(th)) + 0.03, L.z0 + L.R * Math.sin(th)),
      n: new THREE.Vector3(0, Math.cos(th), -Math.sin(th)),
      side: new THREE.Vector3(1, 0, 0),
    };
  };
  const chevron = canvasTexture(256, 256, (ctx, w, h) => {
    noiseFill(ctx, w, h, '#1d2026', 0.15, 8000, 1.5);
    ctx.strokeStyle = 'rgba(80,220,255,0.9)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(40, 170);
    ctx.lineTo(128, 90);
    ctx.lineTo(216, 170);
    ctx.stroke();
  });
  chevron.wrapS = chevron.wrapT = THREE.RepeatWrapping;
  const loopMat = new THREE.MeshStandardMaterial({ map: chevron, emissiveMap: chevron, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
  const loopSurf = new THREE.Mesh(ribbonGeometry(loopFn, 96, L.W), loopMat);
  loopSurf.userData.surface = 'loop';
  loopSurf.userData.smooth = true;
  loopSurf.userData.curvature = 1 / L.R;
  loopSurf.receiveShadow = true;
  scene.add(loopSurf);
  drivable.push(loopSurf);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
  const outer = new THREE.Mesh(ribbonGeometry(loopFn, 96, L.W + 0.4, -0.45), shellMat);
  outer.castShadow = true;
  scene.add(outer);
  for (const s of [-1, 1]) {
    const sideFn = (t) => {
      const r = loopFn(t);
      return { p: r.p.clone().addScaledVector(r.side, s * (L.W / 2 + 0.2)).addScaledVector(r.n, 0.3), n: r.side, side: r.n };
    };
    scene.add(new THREE.Mesh(ribbonGeometry(sideFn, 96, 1.5), shellMat));
    // glowing rails
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const r = loopFn(i / 64);
      pts.push(r.p.clone().addScaledVector(r.side, s * (L.W / 2 + 0.1)).addScaledVector(r.n, 1.05));
    }
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 128, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x002030, emissive: 0x30d5ff, emissiveIntensity: 2.2 }));
    scene.add(rail);
  }
  // supports
  const colMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.8, roughness: 0.45 });
  for (let deg = 40; deg <= 180; deg += 20) {
    const r = loopFn(deg / 180);
    const top = r.p.clone().addScaledVector(r.n, -0.45);
    for (const s of [-1, 1]) {
      const h = top.y;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, h, 10), colMat);
      c.position.set(L.x + s * (L.W / 2 + 0.5), h / 2, top.z);
      c.castShadow = true;
      scene.add(c);
    }
  }
  // diagonal lattice bracing between the support columns
  const braceGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
  const braces = [];
  for (let deg = 40; deg < 180; deg += 20) {
    const p1 = loopFn(deg / 180).p.clone().addScaledVector(loopFn(deg / 180).n, -0.45);
    const p2 = loopFn((deg + 20) / 180).p.clone().addScaledVector(loopFn((deg + 20) / 180).n, -0.45);
    for (const s of [-1, 1]) {
      const x = L.x + s * (L.W / 2 + 0.5);
      for (const [a, b] of [
        [new THREE.Vector3(x, 0.3, p1.z), new THREE.Vector3(x, p2.y * 0.95, p2.z)],
        [new THREE.Vector3(x, p1.y * 0.95, p1.z), new THREE.Vector3(x, 0.3, p2.z)],
      ]) {
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        braces.push(new THREE.Matrix4().compose(mid, tmpQ.clone(), new THREE.Vector3(1, len, 1)));
      }
    }
  }
  const braceMesh = new THREE.InstancedMesh(braceGeo, colMat, braces.length);
  braces.forEach((m, i) => braceMesh.setMatrixAt(i, m));
  braceMesh.castShadow = true;
  scene.add(braceMesh);
  const beamTop = new THREE.Mesh(new THREE.BoxGeometry(L.W + 2, 0.5, 0.5), colMat);
  beamTop.position.set(L.x, 2 * L.R + 0.5, L.z0 + 0.3);
  scene.add(beamTop);
  colliders.push(box(L.x - L.W / 2 - 1, 0, L.z0 + 2, L.x + L.W / 2 + 1, 2 * L.R, L.z0 + L.R + 1, { groundOnly: true, notOnLoop: true }));
  addLabel(scene, 'RAMPA INVERTIDA', new THREE.Vector3(L.x, 2 * L.R + 7, L.z0 + L.R), 26, '#7fe3ff');
  const loopLight = new THREE.SpotLight(0xdff2ff, 2200, 90, 0.6, 0.6, 1.5);
  loopLight.position.set(L.x - 20, 30, L.z0 - 25);
  loopLight.target.position.set(L.x, 8, L.z0 + 6);
  scene.add(loopLight, loopLight.target);

  // ---------------- Jump over the Tesla lineup ----------------
  const K = LAYOUT.kicker;
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.6, roughness: 0.5, map: chevron });
  const kicker = wedge(K.W, K.len, K.h, rampMat, shellMat);
  kicker.position.set(K.x, 0, K.z0);
  kicker.userData.surface = 'ramp';
  kicker.castShadow = true;
  scene.add(kicker);
  drivable.push(kicker);
  colliders.push(box(K.x - K.W / 2, 0, K.z0 + K.len * 0.5, K.x + K.W / 2, K.h, K.z0 + K.len, { groundOnly: true }));
  const LD = LAYOUT.landing;
  const land = wedge(K.W + 2, LD.len, LD.h, rampMat, shellMat);
  land.rotation.y = Math.PI;
  land.position.set(LD.x, 0, LD.z0 + LD.len);
  land.userData.surface = 'ramp';
  land.castShadow = true;
  scene.add(land);
  drivable.push(land);
  colliders.push(box(LD.x - K.W / 2 - 1, 0, LD.z0, LD.x + K.W / 2 + 1, LD.h, LD.z0 + LD.len * 0.5, { groundOnly: true }));

  const lineup = [
    { m: buildSedan(0xd8dadc), name: 'Model 3' },
    { m: buildSedan(0x1c3f9a, 1.02, 0.18), name: 'Model Y' },
    { m: buildCybercab(), name: 'Cybercab' },
    { m: buildSedan(0x8a0f16, 1.06, 0.05), name: 'Model S' },
    { m: buildCybertruck(), name: 'Cybertruck' },
    { m: buildSemi(), name: 'Semi' },
  ];
  lineup.forEach((v, i) => {
    const z = LAYOUT.lineup.z1 + 1.5 + i * 3.4;
    v.m.position.set(K.x + (i === 5 ? 0 : 0), 0, z);
    v.m.rotation.y = Math.PI / 2;
    scene.add(v.m);
    const halfLen = i === 5 ? 6 : 3;
    const height = i === 5 ? 4.0 : i === 4 ? 1.95 : 1.5;
    colliders.push(box(K.x - halfLen, 0, z - 1.25, K.x + halfLen, height, z + 1.25, { crash: true }));
  });
  addLabel(scene, 'SALTO SOBRE LA FILA', new THREE.Vector3(K.x + 26, 9, (LAYOUT.lineup.z1 + LAYOUT.lineup.z2) / 2), 26, '#ffd27f');
  const jumpLight = new THREE.SpotLight(0xfff0dd, 1400, 90, 0.6, 0.6, 1.5);
  jumpLight.position.set(K.x + 25, 28, 30);
  jumpLight.target.position.set(K.x, 0, 32);
  scene.add(jumpLight, jumpLight.target);

  // ---------------- Air refill pad ----------------
  const R = LAYOUT.refill;
  const padMesh = new THREE.Mesh(new THREE.CircleGeometry(5, 6), new THREE.MeshStandardMaterial({ color: 0x06222c, emissive: 0x20c8ff, emissiveIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  padMesh.rotation.x = -Math.PI / 2;
  padMesh.position.set(R.x, 0.03, R.z);
  scene.add(padMesh);
  addLabel(scene, 'RECARGA DE AIRE', new THREE.Vector3(R.x, 5, R.z), 16, '#7fe3ff');
  animated.push((t) => {
    padMesh.material.emissiveIntensity = 1 + Math.sin(t * 3) * 0.5;
  });

  // ---------------- Rocket test stands + Starship ----------------
  buildTestStand(scene, LAYOUT.standA, animated, colliders);
  buildTestStand(scene, LAYOUT.standB, animated, colliders);
  buildStarship(scene, LAYOUT.starship, colliders);
  // flight rings around stand A
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff9a2e, emissiveIntensity: 3 });
  const heights = [14, 22, 30, 38, 30, 20];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = LAYOUT.standA.clone().add(new THREE.Vector3(Math.cos(a) * 75, heights[i], Math.sin(a) * 75));
    const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.45, 10, 48), ringMat.clone());
    ring.position.copy(c);
    ring.lookAt(c.clone().add(tangent));
    scene.add(ring);
    W.rings.push({ mesh: ring, center: c, normal: tangent, radius: 7, prevSide: 0 });
  }
  addLabel(scene, 'ANILLOS DE VUELO', LAYOUT.standA.clone().add(new THREE.Vector3(0, 70, 0)), 40, '#ffb35c');

  // ---------------- Scenery: light towers, bushes, hills ----------------
  const towerSpots = [
    [-60, -20], [130, -20], [-60, 130], [130, 130], [40, 140], [-140, 300], [-80, 700], [-140, 1100],
  ];
  towerSpots.forEach(([x, z], i) => addLightTower(scene, x, z, colliders, i < 4));

  const bushCount = quality === 'low' ? 700 : 1800;
  // mesquite / cedar scrub: two shades, low-poly but with proper normals
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  bushGeo.computeVertexNormals();
  const bush = decor(new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0x3b4026, roughness: 1 }), bushCount));
  let n = 0;
  while (n < bushCount) {
    const x = rand(-1800, 1800);
    const z = rand(-1800, 1800);
    if (x > -100 && x < 160 && z > -110 && z < 150) continue;
    if (Math.abs(x - S.x) < 30 && z > -80 && z < S.zEnd + 50) continue;
    const s = rand(0.5, 1.6);
    tmpM.compose(tmpV.set(x, s * 0.4, z), tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), tmpS.set(s * 1.3, s * 0.7, s * 1.2));
    bush.setMatrixAt(n, tmpM);
    bush.setColorAt(n, col.setHSL(0.18 + Math.random() * 0.06, 0.25 + Math.random() * 0.15, 0.12 + Math.random() * 0.06));
    n++;
  }
  scene.add(bush);

  const hillMat = new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 1, flatShading: true });
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + rand(-0.04, 0.04);
    const r = rand(2600, 3300);
    const h = rand(60, 220);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(rand(300, 600), h, 6), hillMat);
    hill.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
    scene.add(hill);
  }
  // distant red aviation lights (water tower / antennas)
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(900, 2200);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    m.position.set(Math.cos(a) * r, rand(30, 90), Math.sin(a) * r);
    scene.add(m);
    const ph = Math.random() * 6;
    animated.push((t) => (m.visible = Math.sin(t * 2 + ph) > 0));
  }

  buildScenery(scene, colliders, animated, W);

  W.update = (t, dt, carSpeedMph, extra) => {
    for (const f of animated) f(t, dt);
    // live LED wall
    if (t - W.screen.last > 0.12) {
      W.screen.last = t;
      drawScreen(W.screen.canvas, t, carSpeedMph, extra);
      W.screen.tex.needsUpdate = true;
    }
  };
  W.cheer = (t, dur = 4) => (W.cheerTime = t + dur);
  W.setTree(0);
  return W;
}

// ---------------- helpers ----------------
function box(x1, y1, z1, x2, y2, z2, opts) {
  return { min: new THREE.Vector3(x1, y1, z1), max: new THREE.Vector3(x2, y2, z2), ...opts };
}

// Wedge rising along +Z from z=0 (ground) to z=len (height h). Top face is the drivable surface.
function wedge(w, len, h, topMat, sideMat) {
  const hw = w / 2;
  const g = new THREE.BufferGeometry();
  const v = [
    // top
    -hw, 0, 0, hw, 0, 0, hw, h, len, -hw, h, len,
    // back (vertical)
    -hw, 0, len, hw, 0, len, hw, h, len, -hw, h, len,
    // left side
    -hw, 0, 0, -hw, 0, len, -hw, h, len,
    // right side
    hw, 0, 0, hw, h, len, hw, 0, len,
  ];
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 8, 10, 9, 11, 13, 12];
  const uv = [0, 0, 1, 0, 1, len / 4, 0, len / 4, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, 6, 0);
  g.addGroup(6, 12, 1);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, [topMat, sideMat]);
  m.receiveShadow = true;
  m.material.forEach((mm) => (mm.side = THREE.DoubleSide));
  return m;
}

function addLedLine(scene, x1, z1, x2, z2, color) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, len), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.5 }));
  m.position.set((x1 + x2) / 2, 0.05, (z1 + z2) / 2);
  m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
  scene.add(m);
}

function addGantry(scene, x, z, w, text) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), mat);
    p.position.set(x + (s * w) / 2, 4, z);
    scene.add(p);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 1.8, 0.6), mat);
  top.position.set(x, 8, z);
  scene.add(top);
  const tex = canvasTexture(1024, 96, (ctx, cw, ch) => {
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#7fe3ff';
    ctx.font = '700 60px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2 + 2);
  });
  for (const r of [0, Math.PI]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sign.position.set(x, 8, z + (r ? 0.31 : -0.31));
    sign.rotation.y = r ? 0 : Math.PI;
    scene.add(sign);
  }
}

export function addLabel(scene, text, pos, width, color) {
  const tex = canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.font = '800 96px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }));
  s.position.copy(pos);
  s.scale.set(width, width * 0.156, 1);
  scene.add(s);
  return s;
}

function beamMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vDist = length(mv.xyz); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = pow(vUv.y, 2.2) * edge * uStrength * smoothstep(4.0, 30.0, vDist); gl_FragColor = vec4(uColor * a, a); }`,
  });
}

function addBeam(scene, from, to, radius, color, strength) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const geo = new THREE.ConeGeometry(radius, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, beamMaterial(color, strength));
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  scene.add(m);
}

function makeSkyBeam(color) {
  const len = 900;
  const geo = new THREE.ConeGeometry(28, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateX(Math.PI); // tip at origin, opening upward
  const m = new THREE.Mesh(geo, beamMaterial(color, 0.08));
  // flip uv so brightness sits at the source
  const g = new THREE.Group();
  g.add(m);
  return g;
}

function addLightTower(scene, x, z, colliders, withLight) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a40, roughness: 0.6, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 3.5), mat);
  base.position.set(x, 0.8, z);
  scene.add(base);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 9, 8), new THREE.MeshStandardMaterial({ color: 0x777777 }));
  mast.position.set(x, 5.5, z);
  scene.add(mast);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4e0, emissiveIntensity: 4 });
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.2), lampMat);
    l.position.set(x - 0.75 + (i % 2) * 1.5, 10 + Math.floor(i / 2) * 0.5, z);
    scene.add(l);
  }
  if (withLight) {
    const pl = new THREE.PointLight(0xfff0dd, 700, 70, 1.7);
    pl.position.set(x, 10, z);
    scene.add(pl);
  }
  colliders.push(box(x - 1, 0, z - 1.8, x + 1, 2, z + 1.8, {}));
}

function buildTestStand(scene, p, animated, colliders) {
  const g = new THREE.Group();
  g.position.copy(p);
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d949c, metalness: 0.8, roughness: 0.4 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.95 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40), concrete);
  pad.position.y = 0.5;
  g.add(pad);
  // flame trench
  const trench = new THREE.Mesh(new THREE.BoxGeometry(10, 1.1, 30), new THREE.MeshStandardMaterial({ color: 0x1a1816 }));
  trench.position.set(0, 0.5, 6);
  g.add(trench);
  // tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 34, 8), steel);
    leg.position.set(Math.cos(a) * 7, 17, Math.sin(a) * 7);
    leg.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
    leg.castShadow = true;
    g.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 2, 24), steel);
  deck.position.y = 33;
  g.add(deck);
  // Raptor engine hanging under the deck
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.3, 3.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a3a30, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }));
  bell.position.y = 29.6;
  g.add(bell);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16), steel);
  body.position.y = 31.8;
  g.add(body);
  // occasional static-fire glow under the bell
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.2, 14, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.y = 21;
  flame.rotation.x = Math.PI;
  g.add(flame);
  const red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), red);
  beacon.position.y = 35;
  g.add(beacon);
  const flood = new THREE.SpotLight(0xffffff, 2500, 120, 0.7, 0.5, 1.4);
  flood.position.set(25, 20, 25);
  flood.target.position.set(0, 20, 0);
  g.add(flood, flood.target);
  scene.add(g);
  const ph = Math.random() * 20;
  animated.push((t) => {
    beacon.visible = Math.sin(t * 2.5 + ph) > 0;
    const cycle = (t + ph) % 30;
    const fire = cycle < 4 ? Math.min(1, cycle) * Math.min(1, 4 - cycle) : 0;
    flame.material.opacity = fire * (0.6 + Math.random() * 0.3);
    flame.scale.set(1, 0.8 + Math.random() * 0.3, 1);
  });
  colliders.push(box(p.x - 20, 0, p.z - 20, p.x + 20, 34, p.z + 20, {}));
}

function buildStarship(scene, p, colliders) {
  const g = new THREE.Group();
  g.position.copy(p);
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.95, roughness: 0.28 });
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 8, 16), new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.6 }));
  mount.position.y = 4;
  g.add(mount);
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 32), steel);
  hull.position.y = 28;
  hull.castShadow = true;
  g.add(hull);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(4.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  nose.scale.y = 2.6;
  nose.position.y = 48;
  g.add(nose);
  const tiles = new THREE.Mesh(new THREE.CylinderGeometry(4.52, 4.52, 40, 32, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 }));
  tiles.position.y = 28;
  tiles.rotation.y = Math.PI / 2;
  g.add(tiles);
  for (const s of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 4), steel);
    flap.position.set(s * 5, 14, 0);
    g.add(flap);
    const fwd = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 2.5), steel);
    fwd.position.set(s * 4.8, 50, 0);
    g.add(fwd);
  }
  for (const a of [0.6]) {
    const sl = new THREE.SpotLight(0xffffff, 12000, 160, 0.4, 0.5, 1.4);
    sl.position.set(Math.cos(a) * 40, 1, Math.sin(a) * 40);
    sl.target.position.set(0, 35, 0);
    g.add(sl, sl.target);
  }
  scene.add(g);
  colliders.push(box(p.x - 8, 0, p.z - 8, p.x + 8, 60, p.z + 8, {}));
}

function drawScreen(c, t, mph, extra) {
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#020409');
  g.addColorStop(1, '#0a1626');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // horizon line sweeping
  const sweep = (t * 0.25) % 1;
  const lg = ctx.createLinearGradient(sweep * w - 200, 0, sweep * w + 200, 0);
  lg.addColorStop(0, 'rgba(120,220,255,0)');
  lg.addColorStop(0.5, 'rgba(120,220,255,0.35)');
  lg.addColorStop(1, 'rgba(120,220,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, h * 0.62, w, 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2f6fa';
  ctx.font = '300 128px "Helvetica Neue", Arial, sans-serif';
  ctx.letterSpacing = '30px';
  ctx.fillText('ROADSTER', w / 2 + 15, h * 0.42);
  ctx.letterSpacing = '6px';
  ctx.font = '500 30px Arial, sans-serif';
  ctx.fillStyle = '#7fe3ff';
  ctx.fillText('McGREGOR, TEXAS  ·  15 · 10 · 2026', w / 2, h * 0.56);
  ctx.font = '700 64px Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.letterSpacing = '2px';
  const line = extra && extra.message ? extra.message : `${Math.round(mph)} MPH`;
  ctx.fillText(line, w / 2, h * 0.8);
  ctx.letterSpacing = '0px';
  // scan lines
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

// ---------------- Extra scenery: hangars, tanks, LED towers, media area, street lights, city glow ----------------
function buildScenery(scene, colliders, animated, W) {
  const corr = corrugatedSet();
  const wallMat = (rx, ry) =>
    new THREE.MeshStandardMaterial({
      map: toTexture(corr.color, { repeat: [rx, ry] }),
      normalMap: toTexture(corr.normal, { srgb: false, repeat: [rx, ry] }),
      roughness: 0.55,
      metalness: 0.65,
      color: 0xb4bac2,
    });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.5 });
  const doorGlow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffe2b0, emissiveIntensity: 1.3 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

  const hangar = (x, z, w, h, d, rotY) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wallMat(d / 4, h / 4), wallMat(d / 4, h / 4), roofMat, roofMat, wallMat(w / 4, h / 4), wallMat(w / 4, h / 4)]);
    walls.position.y = h / 2;
    walls.castShadow = walls.receiveShadow = true;
    g.add(walls);
    // curved roof cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 24, 1, false, 0, Math.PI), roofMat);
    cap.rotation.z = Math.PI / 2;
    cap.scale.set(1, 0.35, 1);
    cap.position.y = h;
    g.add(cap);
    // big hangar door half open, lit inside
    const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, h * 0.8), doorGlow);
    door.position.set(0, h * 0.4, d / 2 + 0.02);
    g.add(door);
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, h * 0.82, 0.4), wallMat(w / 12, h / 4));
    doorPanel.position.set(w * 0.33, h * 0.41, d / 2 + 0.3);
    g.add(doorPanel);
    // light strip along the eaves and beacons on the roof corners
    const eave = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff0d8, emissiveIntensity: 2 }));
    eave.position.set(0, h - 0.4, d / 2 + 0.1);
    g.add(eave);
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), beaconMat);
      b.position.set((sx * w) / 2, h + d * 0.17, 0);
      g.add(b);
      const ph = Math.random() * 6;
      animated.push((t) => (b.visible = Math.sin(t * 2.2 + ph) > -0.2));
    }
    scene.add(g);
    // axis-aligned collider covering the rotated footprint
    const c = Math.abs(Math.cos(rotY));
    const s = Math.abs(Math.sin(rotY));
    const hx = (w * c + d * s) / 2;
    const hz = (w * s + d * c) / 2;
    colliders.push({ min: new THREE.Vector3(x - hx, 0, z - hz), max: new THREE.Vector3(x + hx, h + d * 0.2, z + hz) });
  };
  hangar(205, -20, 64, 22, 40, -Math.PI / 2);
  hangar(-220, -150, 52, 18, 34, 0.25);
  hangar(60, 300, 44, 16, 30, Math.PI);

  // horizontal propellant tanks near test stand B
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.35, metalness: 0.5 });
  const saddleMat = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.7 });
  const B = LAYOUT.standB;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.position.set(B.x + 50 + i * 9, 0, B.z - 40);
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(3, 16, 6, 24), tankMat);
    tank.rotation.x = Math.PI / 2;
    tank.position.y = 4.4;
    tank.castShadow = true;
    g.add(tank);
    for (const z of [-6, 6]) {
      const sad = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2, 1), saddleMat);
      sad.position.set(0, 1, z);
      g.add(sad);
    }
    scene.add(g);
  }
  colliders.push({ min: new THREE.Vector3(B.x + 46, 0, B.z - 52), max: new THREE.Vector3(B.x + 81, 8, B.z - 28) });

  // giant LED towers either side of the stage, mirroring the arch screen
  const ST = LAYOUT.stage;
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 38, 0, ST.z - 4);
    g.rotation.y = -sx * 0.35;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11, 16, 1), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.6 }));
    frame.position.y = 11;
    g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 5.8), new THREE.MeshBasicMaterial({ map: W.screen.tex, toneMapped: false }));
    screen.position.set(0, 15, 0.52);
    g.add(screen);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2), new THREE.MeshStandardMaterial({ color: 0x2a2d33 }));
    leg.position.y = 1.5;
    g.add(leg);
    scene.add(g);
    colliders.push({ min: new THREE.Vector3(sx * 38 - 6, 0, ST.z - 7), max: new THREE.Vector3(sx * 38 + 6, 19, ST.z - 1) });
  }

  // media tents and a camera crane
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.8 });
  for (const [x, z] of [[-62, -66], [-62, -50], [62, -66], [62, -50]]) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 10), tentMat);
    base.position.y = 1.5;
    t.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 2.4, 4), tentMat);
    roof.position.y = 4.2;
    roof.rotation.y = Math.PI / 4;
    t.add(roof);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2dc, emissiveIntensity: 0.9 }));
    inside.position.set(0, 1.4, x > 0 ? -5.01 : 5.01);
    inside.rotation.y = x > 0 ? Math.PI : 0;
    t.add(inside);
    scene.add(t);
    colliders.push({ min: new THREE.Vector3(x - 5.5, 0, z - 5.5), max: new THREE.Vector3(x + 5.5, 5, z + 5.5) });
  }
  const crane = new THREE.Group();
  crane.position.set(-54, 0, -24);
  const craneMat = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5, metalness: 0.7 });
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), craneMat);
  mast.position.y = 3;
  crane.add(mast);
  const arm = new THREE.Group();
  arm.position.y = 6;
  const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 14), craneMat);
  armBar.position.z = 4;
  arm.add(armBar);
  const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1), new THREE.MeshStandardMaterial({ color: 0x0c0c0c }));
  camBox.position.set(0, -0.5, 11);
  arm.add(camBox);
  const tally = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  tally.position.set(0, -0.1, 11.5);
  arm.add(tally);
  crane.add(arm);
  scene.add(crane);
  colliders.push({ min: new THREE.Vector3(-55, 0, -25), max: new THREE.Vector3(-53, 6, -23) });
  animated.push((t) => {
    arm.rotation.y = 0.9 + Math.sin(t * 0.25) * 0.6;
    arm.rotation.x = 0.15 + Math.sin(t * 0.33) * 0.1;
  });

  // street lights along the access roads and the drag strip (instanced, emissive + glare)
  const poles = [];
  const addRow = (x1, z1, x2, z2, step, offset) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const dx = (x2 - x1) / len;
    const dz = (z2 - z1) / len;
    for (let d = step / 2; d < len; d += step) poles.push(new THREE.Vector3(x1 + dx * d - dz * offset, 0, z1 + dz * d + dx * offset));
  };
  addRow(150, 140, LAYOUT.standA.x - 30, LAYOUT.standA.z - 30, 45, 8);
  addRow(150, -100, LAYOUT.starship.x - 20, LAYOUT.starship.z + 20, 45, 8);
  const S = LAYOUT.strip;
  addRow(S.x + S.w / 2 + 6, S.zStart, S.x + S.w / 2 + 6, S.zEnd, 70, 0);
  addRow(S.x - S.w / 2 - 6, S.zStart + 35, S.x - S.w / 2 - 6, S.zEnd, 70, 0);
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.14, 9, 6), new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.6, metalness: 0.6 }), poles.length);
  const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffe6c0, emissiveIntensity: 3 }), poles.length);
  const glarePos = [];
  poles.forEach((p, i) => {
    tmpM.compose(tmpV.set(p.x, 4.5, p.z), tmpQ.identity(), tmpS.set(1, 1, 1));
    poleMesh.setMatrixAt(i, tmpM);
    tmpM.compose(tmpV.set(p.x, 9, p.z), tmpQ.identity(), tmpS.set(1, 1, 1));
    lampMesh.setMatrixAt(i, tmpM);
    glarePos.push(p.x, 8.9, p.z);
  });
  scene.add(decor(poleMesh), decor(lampMesh));
  // soft glow halos around every lamp
  const glareGeo = new THREE.BufferGeometry();
  glareGeo.setAttribute('position', new THREE.Float32BufferAttribute(glarePos, 3));
  const glare = decor(
    new THREE.Points(
      glareGeo,
      new THREE.PointsMaterial({ map: glowTexture('rgba(255,225,180,0.9)', 'rgba(255,200,140,0)'), size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 })
    )
  );
  scene.add(glare);
  // pools of light on the ground under the lamps (decals, no real lights)
  const poolGeo = new THREE.PlaneGeometry(14, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,220,170,0.22)', 'rgba(255,220,170,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
    poles.length
  );
  poles.forEach((p, i) => {
    tmpM.compose(tmpV.set(p.x, 0.05, p.z), tmpQ.identity(), tmpS.set(1, 1, 1));
    pools.setMatrixAt(i, tmpM);
  });
  scene.add(decor(pools));

  // Waco on the north-east horizon: thousands of warm city lights
  const city = [];
  const cityCol = [];
  const cc = new THREE.Color();
  for (let i = 0; i < 2600; i++) {
    const a = Math.atan2(0.85, 0.5) + (Math.random() - 0.5) * 0.7 * Math.pow(Math.random(), 0.5);
    const r = 2100 + Math.random() * 400;
    city.push(Math.cos(a) * r, 2 + Math.pow(Math.random(), 3) * 40, Math.sin(a) * r);
    cc.setHSL(0.08 + Math.random() * 0.06, 0.6 + Math.random() * 0.3, 0.55 + Math.random() * 0.3);
    if (Math.random() < 0.2) cc.setRGB(0.85, 0.9, 1);
    cityCol.push(cc.r, cc.g, cc.b);
  }
  const cityGeo = new THREE.BufferGeometry();
  cityGeo.setAttribute('position', new THREE.Float32BufferAttribute(city, 3));
  cityGeo.setAttribute('color', new THREE.Float32BufferAttribute(cityCol, 3));
  scene.add(decor(new THREE.Points(cityGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false }))));
}
