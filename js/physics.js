import * as THREE from 'three';

const G = 9.81;
const MPH = 0.44704;
export const MS_TO_MPH = 1 / MPH;

// Data from the 15 Oct 2026 reveal coverage (claimed figures, not final specs).
export const VERSIONS = {
  performance: {
    id: 'performance',
    name: 'Performance',
    zeroSixty: 1.6,
    topMph: 214,
    thrusters: false,
    flight: false,
    seats: '2+2',
    deposit: 'Reserva: 50.000 $',
    blurb: 'La versión "de calle". Ventilador de succión, sin propulsores.',
  },
  thrust: {
    id: 'thrust',
    name: 'Thrust',
    zeroSixty: 0.9,
    topMph: 214,
    thrusters: true,
    flight: false,
    seats: '2+2',
    deposit: 'Reserva: 250.000 $',
    blurb: 'Propulsores de gas frío (aire comprimido): impulso, saltos y giros en el aire.',
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket',
    zeroSixty: 0.59,
    topMph: 230,
    thrusters: true,
    flight: true,
    seats: '1',
    deposit: 'Solo por invitación',
    blurb: 'Monoplaza. 10 toberas y 600 L de aire comprimido: puede despegar y volar.',
  },
};

// Chassis and tyre parameters for the handling model (single-track / bicycle model)
const CAR = { m: 1800, a: 1.4, b: 1.4, L: 2.8, Iz: 2900, hcg: 0.45 };
const TIRE = { muY: 1.22, muX: 2.3, B: 15.4, C: 1.45 };
// Simplified Pacejka curve: peaks near 7 degrees of slip and keeps ~76% grip when sliding
function tireForce(alpha, Fmax) {
  return Fmax * Math.sin(TIRE.C * Math.atan(TIRE.B * alpha));
}

const UP = new THREE.Vector3(0, 1, 0);
const GRAV = new THREE.Vector3(0, -G, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const ray = new THREE.Raycaster();
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const pc = new THREE.Vector3();
const na = new THREE.Vector3();
const nb = new THREE.Vector3();
const nc = new THREE.Vector3();
const pl = new THREE.Vector3();

export class Vehicle {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3(); // local: x pitch, y yaw, z roll
    this.normal = new THREE.Vector3(0, 1, 0);
    this.prevNormal = new THREE.Vector3(0, 1, 0);
    this.fwd = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.left = new THREE.Vector3();
    this.events = [];
    this.assists = true;
    this.fx = { boost: 0, lift: 0, roll: 0, rot: 0 };
    this.setVersion('thrust');
    this.reset(world.spawn.pos, world.spawn.yaw);
  }

  setVersion(id) {
    const v = VERSIONS[id];
    this.version = v;
    this.baseAccel = 26.82 / (VERSIONS.performance.zeroSixty * 0.96);
    const want = 26.82 / (v.zeroSixty * 0.96);
    this.thrustAccel = v.thrusters ? Math.max(0, want - this.baseAccel) : 0;
    this.vTop = v.topMph * MPH;
    this.drag = (this.baseAccel * 30) / Math.pow(this.vTop, 3);
  }

  reset(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, yaw);
    this.grounded = true;
    this.surface = 'stage';
    this.normal.set(0, 1, 0);
    this.prevNormal.set(0, 1, 0);
    this.tank = 1;
    this.suction = false;
    this.flight = false;
    this.crashed = 0;
    this.air = null;
    this.steerScale = 1;
    this.steerIn = 0;
    this.steerAngle = 0;
    this.yawRate = 0;
    this.normalAcc = G;
    this.axFilt = 0;
    this.ayFilt = 0;
    this.tireSlipF = 0;
    this.tireSlipR = 0;
    this.wheelspin = false;
    this.skidding = false;
    this.driftLatch = false;
    this.wheelSpeed = 0;
    this.latAccel = 0;
    this.lonAccel = 0;
    this.slip = 0;
    this.drifting = false;
    this.lastSafe = { pos: pos.clone(), yaw };
    this.safeTimer = 0;
    this.prevVF = 0;
    this.basis();
  }

  basis() {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
  }

  get speed() {
    return this.vel.length();
  }
  get forwardSpeed() {
    return this.vel.dot(this.fwd);
  }

  probe(origin, dir, far) {
    ray.set(origin, dir);
    ray.far = far;
    const hits = ray.intersectObjects(this.world.drivable, false);
    if (!hits.length) return null;
    const h = hits[0];
    const obj = h.object;
    let n;
    if (obj.userData.smooth) {
      // curved surfaces: interpolate vertex normals so the car follows the curve smoothly
      const pos = obj.geometry.attributes.position;
      const nor = obj.geometry.attributes.normal;
      const f = h.face;
      pa.fromBufferAttribute(pos, f.a);
      pb.fromBufferAttribute(pos, f.b);
      pc.fromBufferAttribute(pos, f.c);
      na.fromBufferAttribute(nor, f.a);
      nb.fromBufferAttribute(nor, f.b);
      nc.fromBufferAttribute(nor, f.c);
      pl.copy(h.point);
      obj.worldToLocal(pl);
      n = THREE.Triangle.getInterpolation(pl, pa, pb, pc, na, nb, nc, new THREE.Vector3()).normalize().transformDirection(obj.matrixWorld);
    } else {
      n = h.face.normal.clone().transformDirection(obj.matrixWorld);
    }
    if (n.dot(dir) > 0) n.negate();
    return { point: h.point, normal: n, distance: h.distance, surface: obj.userData.surface || 'ground', curvature: obj.userData.curvature };
  }

  toggleSuction() {
    this.suction = !this.suction;
    return this.suction;
  }

  toggleFlight() {
    if (!this.version.flight) return 'noflight';
    if (this.flight) {
      this.flight = false;
      return 'off';
    }
    if (this.tank < 0.05) return 'empty';
    this.flight = true;
    if (this.grounded) {
      this.leaveGround();
      this.vel.addScaledVector(UP, 4);
      this.pos.addScaledVector(UP, 0.3);
    }
    return 'on';
  }

  jump() {
    if (!this.version.thrusters) return 'nothrusters';
    if (!this.grounded || this.tank < 0.08) return 'no';
    this.tank -= 0.1;
    this.basis();
    this.vel.addScaledVector(this.up, this.version.flight ? 11 : 9.5);
    this.pos.addScaledVector(this.up, 0.15);
    this.leaveGround();
    this.fx.lift = 1.4;
    this.events.push({ type: 'jump' });
    return 'ok';
  }

  leaveGround() {
    if (!this.grounded) return;
    this.grounded = false;
    this.angVel.set(0, this.yawRate, 0);
    this.skidding = false;
    this.drifting = false;
    this.air = {
      time: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      start: this.pos.clone(),
      maxY: this.pos.y,
      fromLoop: this.surface === 'loop',
      invertedAtExit: this.up.y < -0.5,
      overLineup: false,
    };
    if (this.air.fromLoop && this.air.invertedAtExit) this.events.push({ type: 'loopExit' });
  }

  crash(reason) {
    if (this.crashed > 0) return;
    this.crashed = 2.0;
    this.flight = false;
    this.events.push({ type: 'crash', reason, pos: this.pos.clone() });
  }

  update(dt, c) {
    this.fx.boost = Math.max(0, this.fx.boost - dt * 6);
    this.fx.lift = Math.max(0, this.fx.lift - dt * 4);
    this.fx.roll *= Math.exp(-dt * 10);
    this.fx.rot *= Math.exp(-dt * 10);

    if (this.crashed > 0) {
      this.crashed -= dt;
      // tumble
      this.vel.addScaledVector(GRAV, dt);
      this.vel.multiplyScalar(Math.exp(-1.5 * dt));
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y < 0.4) {
        this.pos.y = 0.4;
        this.vel.y = Math.abs(this.vel.y) * 0.3;
      }
      q1.setFromEuler(new THREE.Euler(dt * 3, dt * 1.3, dt * 4));
      this.quat.multiply(q1);
      if (this.crashed <= 0) {
        this.reset(this.lastSafe.pos, this.lastSafe.yaw);
        this.events.push({ type: 'respawn' });
      }
      return;
    }

    const spd = this.speed;
    const steps = Math.min(24, Math.max(this.grounded ? Math.ceil(dt * 200) : 1, Math.ceil((spd * dt) / 0.4)));
    const h = dt / steps;
    const vf0 = this.forwardSpeed;
    for (let i = 0; i < steps; i++) {
      if (this.grounded) this.groundStep(h, c);
      else this.airStep(h, c);
      if (this.crashed > 0) break;
      this.collide();
    }
    this.basis();
    const vf = this.forwardSpeed;
    this.lonAccel = (vf - vf0) / dt;
    this.wheelSpeed = this.grounded ? vf : this.wheelSpeed * Math.exp(-0.5 * dt) + (c.throttle * 30 - c.brake * 10) * dt;

    // refill air (compressor) when not thrusting
    const usingAir = this.fx.boost > 0.05 || this.fx.lift > 0.05 || this.flight;
    if (!usingAir) this.tank = Math.min(1, this.tank + dt * (this.grounded ? 0.06 : 0.015));
    const R = this.world.refill;
    if (this.grounded && Math.hypot(this.pos.x - R.x, this.pos.z - R.z) < 5) {
      if (this.tank < 1) this.events.push({ type: 'refilling' });
      this.tank = Math.min(1, this.tank + dt * 0.6);
    }

    // safe respawn point
    if (this.grounded && this.surface === 'ground' && this.normal.y > 0.98 && this.speed < 40) {
      this.safeTimer += dt;
      if (this.safeTimer > 1) {
        this.safeTimer = 0;
        const yaw = Math.atan2(this.fwd.x, this.fwd.z);
        this.lastSafe = { pos: this.pos.clone().setY(0), yaw };
      }
    }
    if (this.pos.y < -20 || Math.abs(this.pos.x) > 3500 || Math.abs(this.pos.z) > 3500) this.crash('fuera');
  }

  groundStep(h, c) {
    this.basis();
    const { fwd, up, left } = this;
    const n = this.normal;
    // gravity along the surface
    const gN = GRAV.dot(n);
    v1.copy(GRAV).addScaledVector(n, -gN);
    this.vel.addScaledVector(v1, h);

    const { m, a, b, L, Iz, hcg } = CAR;
    const assists = this.assists;
    let vx = this.vel.dot(fwd);
    let vy = this.vel.dot(left);
    const speed = Math.hypot(vx, vy);
    const absVx = Math.abs(vx);

    // normal load: gravity into the surface + curvature + suction fan (2G)
    const N = Math.max(0.25 * G, this.normalAcc);
    const axT = THREE.MathUtils.clamp(this.axFilt, -2.5 * G, 2.5 * G);
    let Fzf = m * ((N * b) / L) - (m * axT * hcg) / L;
    let Fzr = m * ((N * a) / L) + (m * axT * hcg) / L;
    Fzf = Math.max(Fzf, 0.08 * m * N);
    Fzr = Math.max(Fzr, 0.08 * m * N);

    // steering: speed-sensitive lock keeps the front tyres near peak grip, smoothed input
    const tau = THREE.MathUtils.lerp(0.07, 0.17, THREE.MathUtils.clamp(absVx / 60, 0, 1));
    this.steerIn += (c.steer - this.steerIn) * (1 - Math.exp(-h / tau));
    let deltaMax = THREE.MathUtils.clamp((L * TIRE.muY * N) / Math.max(vx * vx, 1) + 0.055, 0.075, 0.58);
    if (this.surface === 'loop') deltaMax *= 0.35;
    let delta = this.steerIn * deltaMax;
    const beta = Math.atan2(vy, Math.max(absVx, 1));
    // drift assist: front wheels follow the direction of travel so slides stay controllable
    if (assists && !c.handbrake && speed > 6 && Math.abs(beta) > 0.1 && vx > 0) {
      const w = THREE.MathUtils.clamp((Math.abs(beta) - 0.1) / 0.25, 0, 1) * 0.85;
      const target = THREE.MathUtils.clamp(beta, -0.62, 0.62) + this.steerIn * 0.12;
      delta = THREE.MathUtils.lerp(delta, target, w);
    }
    this.steerAngle = delta;

    // wheel-frame velocities and slip angles
    const r = this.yawRate;
    const vyf = vy + a * r;
    const vyr = vy - b * r;
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const vLongF = vx * cd + vyf * sd;
    const vLatF = -vx * sd + vyf * cd;
    const alphaF = Math.atan(vLatF / Math.max(Math.abs(vLongF), 1));
    const alphaR = Math.atan(vyr / Math.max(absVx, 1));

    // power-drift latch: starts with a slide under throttle, holds while the throttle stays in, ends on lift-off
    if (!assists || c.handbrake || vx <= 2 || c.throttle < 0.25 || Math.abs(beta) < 0.07) this.driftLatch = false;
    else if (this.drifting) this.driftLatch = true;
    const powerDrift = this.driftLatch;

    // longitudinal forces: tri-motor AWD (35/65), brakes (60/40), regen when coasting
    let drive = 0;
    let brake = 0;
    if (c.throttle > 0) {
      if (vx < -0.5) brake += 14 * c.throttle;
      else drive += this.baseAccel * Math.min(1, 30 / Math.max(vx, 1)) * c.throttle;
    }
    if (c.brake > 0) {
      if (vx > 0.5) brake += 14 * c.brake;
      else if (vx > -16) drive -= 9 * c.brake;
    }
    const sgn = vx >= 0 ? 1 : -1;
    const brakeF = -sgn * m * brake * Math.min(1, absVx / 0.6);
    // while power-drifting the torque goes rearward and part of it is lost to wheelspin
    if (powerDrift && drive > 0) drive = Math.min(drive, 7.5);
    const frontShare = powerDrift ? 0.1 : 0.35;
    let FxF = m * drive * frontShare + brakeF * 0.6;
    let FxR = m * drive * (1 - frontShare) + brakeF * 0.4;
    if (c.handbrake) {
      // rear wheels locked: sliding friction, no rear drive
      FxR = -sgn * 0.75 * TIRE.muY * Fzr * Math.min(1, absVx / 2) + brakeF * 0.4;
    }
    const capXF = TIRE.muX * Fzf;
    const capXR = TIRE.muX * Fzr;
    this.wheelspin = Math.abs(FxR) > capXR * 0.98 && !c.handbrake && c.throttle > 0.5;
    FxF = THREE.MathUtils.clamp(FxF, -capXF, capXF);
    FxR = THREE.MathUtils.clamp(FxR, -capXR, capXR);

    // friction ellipse: longitudinal use reduces lateral capacity
    let latF = Math.sqrt(Math.max(0.05, 1 - (FxF / capXF) ** 2));
    let latR = Math.sqrt(Math.max(0.05, 1 - (FxR / capXR) ** 2));
    if (c.handbrake) latR *= 0.45;
    // power oversteer: throttle keeps the rear sliding once a drift has started
    if (powerDrift) latR *= 1 - 0.45 * c.throttle;
    let FyF = -tireForce(alphaF, TIRE.muY * Fzf * latF);
    let FyR = -tireForce(alphaR, TIRE.muY * Fzr * latR);
    // never push harder than what removes the axle's sideways speed in this step (low-speed stability)
    const capF = (0.5 * m * Math.abs(vLatF)) / h;
    const capR = (0.5 * m * Math.abs(vyr)) / h;
    FyF = THREE.MathUtils.clamp(FyF, -capF, capF);
    FyR = THREE.MathUtils.clamp(FyR, -capR, capR);

    // body-frame totals
    const FxCar = FxF * cd - FyF * sd + FxR;
    const FyCar = FxF * sd + FyF * cd + FyR;
    let Mz = a * (FxF * sd + FyF * cd) - b * FyR;

    // drift controller: while power-drifting, hold a slide angle the player shapes with the steering
    if (powerDrift && speed > 6) {
      const dir = Math.sign(beta) || 1;
      const into = this.steerIn * -dir; // steering into the turn makes the drift deeper
      const betaT = dir * THREE.MathUtils.clamp(0.3 + 0.45 * into, 0.1, 0.72);
      const rPath = this.ayFilt / Math.max(speed, 1);
      Mz += Iz * (9 * (beta - betaT) - 3.5 * (r - rPath));
    }
    // stability control: damps yaw that goes beyond what the steering asks for
    if (assists && !c.handbrake && !powerDrift) {
      const rMax = (TIRE.muY * N) / Math.max(absVx, 1);
      const rTarget = THREE.MathUtils.clamp((vx * Math.tan(delta)) / L, -rMax, rMax);
      const k = 2.4;
      Mz += -Iz * k * (r - rTarget) * Math.min(1, speed / 8);
    }

    this.vel.addScaledVector(fwd, (FxCar / m) * h);
    this.vel.addScaledVector(left, (FyCar / m) * h);
    let rNew = r + (Mz / Iz) * h;
    // low speed: blend to a kinematic model (no sliding when parking)
    const sBlend = THREE.MathUtils.clamp((speed - 0.6) / 3.5, 0, 1);
    const rKin = (vx * Math.tan(delta)) / L;
    rNew = rNew * sBlend + rKin * (1 - sBlend);
    if (sBlend < 1) {
      const lat = this.vel.dot(left);
      this.vel.addScaledVector(left, -lat * (1 - Math.exp(-12 * (1 - sBlend) * h)));
    }
    this.yawRate = rNew;
    q1.setFromAxisAngle(up, rNew * h);
    this.quat.premultiply(q1);

    // cold-gas boost
    if (c.boost && this.version.thrusters && this.tank > 0) {
      this.vel.addScaledVector(fwd, this.thrustAccel * h);
      this.tank = Math.max(0, this.tank - h * 0.11);
      this.fx.boost = 1;
    }
    // aero drag + rolling resistance + regen when coasting
    const spd = this.vel.length();
    if (spd > 0.01) {
      const coast = c.throttle === 0 && c.brake === 0 && !c.handbrake ? 0.75 : 0.15;
      const dec = Math.min(spd, (this.drag * spd * spd + coast) * h);
      this.vel.addScaledVector(v2.copy(this.vel).divideScalar(spd), -dec);
    }
    this.basis();
    vx = this.vel.dot(this.fwd);
    const topCap = this.vTop * (this.version.thrusters ? 1.03 : 1);
    if (vx > topCap) this.vel.addScaledVector(this.fwd, topCap - vx);

    // telemetry for visuals, audio and challenges
    const axNow = FxCar / m;
    this.axFilt += (axNow - this.axFilt) * (1 - Math.exp(-10 * h));
    this.ayFilt += (FyCar / m - this.ayFilt) * (1 - Math.exp(-10 * h));
    this.latAccel = this.ayFilt;
    this.tireSlipF = Math.abs(alphaF);
    this.tireSlipR = Math.abs(alphaR);
    this.slip = Math.abs(beta);
    this.drifting = speed > 8 && (Math.abs(beta) > 0.2 || (Math.abs(alphaR) > 0.2 && Math.abs(r) > 0.3));
    this.skidding = speed > 4 && (Math.abs(alphaR) > 0.14 || Math.abs(alphaF) > 0.2 || this.wheelspin || (c.handbrake && speed > 3));

    // integrate + stick to the surface
    this.pos.addScaledVector(this.vel, h);
    this.basis();
    const hit = this.probe(v1.copy(this.pos).addScaledVector(this.up, 1.2), v2.copy(this.up).negate(), 2.2);
    if (!hit) {
      this.leaveGround();
      return;
    }
    const nn = hit.normal;
    const ds = this.vel.length() * h;
    let k = 0;
    if (hit.curvature !== undefined) k = hit.curvature;
    else if (ds > 1e-4) {
      v1.copy(nn).sub(this.prevNormal);
      v2.copy(this.vel).normalize();
      k = THREE.MathUtils.clamp(-v1.dot(v2) / ds, -2, 2);
    }
    const v2s = this.vel.lengthSq();
    const press = -GRAV.dot(nn) + v2s * k + (this.suction ? 2 * G : 0);
    if (press < 0 && nn.y < 0.3) {
      this.leaveGround();
      return;
    }
    this.normalAcc += (Math.max(press, 0) - this.normalAcc) * (1 - Math.exp(-30 * h));
    this.pos.copy(hit.point);
    this.vel.addScaledVector(nn, -this.vel.dot(nn));
    q1.setFromUnitVectors(this.up, nn);
    this.quat.premultiply(q1).normalize();
    this.prevNormal.copy(nn);
    this.normal.copy(nn);
    this.surface = hit.surface;
    if (this.surface === 'loop') this.loopAssist(h);
  }

  // On the inverted ramp: engage suction like in the reveal demo, keep the car centred and pointing along the ramp.
  loopAssist(h) {
    const L = this.world.loop;
    if (!L) return;
    if (!this.suction) {
      this.suction = true;
      this.events.push({ type: 'autoSuction' });
    }
    if (this.up.y < -0.85) this.events.push({ type: 'inverted' });
    const lim = L.W / 2 - 1.15;
    const dx = this.pos.x - L.x;
    if (Math.abs(dx) > lim) {
      this.pos.x = L.x + Math.sign(dx) * lim;
      if (this.vel.x * Math.sign(dx) > 0) this.vel.x *= -0.2;
    }
    this.basis();
    // yaw error: forward should have no sideways (X) component
    const err = Math.asin(THREE.MathUtils.clamp(this.fwd.x, -1, 1)) * Math.sign(this.left.x || 1);
    const fix = -err * Math.min(1, 4 * h);
    q1.setFromAxisAngle(this.up, fix);
    this.quat.premultiply(q1).normalize();
    this.vel.applyAxisAngle(this.up, fix);
    this.vel.x *= Math.exp(-3 * h);
    this.yawRate *= Math.exp(-8 * h);
  }

  airStep(h, c) {
    this.basis();
    const air = this.air;
    air.time += h;
    air.maxY = Math.max(air.maxY, this.pos.y);
    const L = this.world.lineup;
    if (Math.abs(this.pos.x - L.x) < 7 && this.pos.z > L.z1 && this.pos.z < L.z2 && this.pos.y > 1) air.overLineup = true;

    const hasAir = this.version.thrusters && this.tank > 0;
    if (this.flight) {
      if (this.tank <= 0) {
        this.flight = false;
        this.events.push({ type: 'tankEmpty' });
      }
      // hover: thrusters cancel gravity and keep the car level
      const yawRate = THREE.MathUtils.clamp(c.steer + c.yawAir, -1, 1) * 1.6;
      q1.setFromAxisAngle(UP, yawRate * h);
      this.quat.premultiply(q1);
      this.basis();
      const yaw = Math.atan2(this.fwd.x, this.fwd.z);
      q1.setFromAxisAngle(UP, yaw);
      this.quat.slerp(q1, 1 - Math.exp(-5 * h));
      this.angVel.set(0, 0, 0);
      const vert = (c.lift ? 12 : 0) - (c.descend ? 10 : 0);
      this.vel.y += vert * h;
      if (!c.lift && !c.descend) this.vel.y *= Math.exp(-2.5 * h);
      v1.set(this.fwd.x, 0, this.fwd.z).normalize();
      const fwdIn = c.throttle - c.brake;
      this.vel.addScaledVector(v1, fwdIn * 16 * h);
      if (c.boost) {
        this.vel.addScaledVector(v1, this.thrustAccel * 0.6 * h);
        this.fx.boost = 1;
      }
      // horizontal drag
      const d = Math.exp(-0.45 * h);
      this.vel.x *= d;
      this.vel.z *= d;
      // bank into turns visually
      this.tank = Math.max(0, this.tank - h * (0.028 + (c.boost ? 0.05 : 0) + (c.lift ? 0.02 : 0)));
      this.fx.lift = Math.max(this.fx.lift, 0.6 + (c.lift ? 0.4 : 0));
    } else {
      this.vel.addScaledVector(GRAV, h);
      if (c.boost && hasAir) {
        this.vel.addScaledVector(this.fwd, this.thrustAccel * h);
        this.tank = Math.max(0, this.tank - h * 0.11);
        this.fx.boost = 1;
      }
      if (c.lift && hasAir) {
        this.vel.addScaledVector(this.up, (this.version.flight ? 20 : 14) * h);
        this.tank = Math.max(0, this.tank - h * 0.2);
        this.fx.lift = 1;
      }
      // rotation: thrusters give strong air control, otherwise only wheel inertia
      const auth = hasAir ? 10 : 2.2;
      const inPitch = c.pitch;
      const inRoll = c.roll;
      const inYaw = c.yawAir;
      this.angVel.x += inPitch * auth * h;
      this.angVel.z += inRoll * auth * h;
      this.angVel.y += inYaw * auth * 0.6 * h;
      const damp = inPitch || inRoll || inYaw ? 0.6 : 2.5;
      this.angVel.multiplyScalar(Math.exp(-damp * h));
      this.angVel.clampScalar(-4.5, 4.5);
      if (hasAir && (inPitch || inRoll || inYaw)) {
        this.tank = Math.max(0, this.tank - h * 0.035);
        this.fx.roll = inRoll;
        this.fx.rot = Math.abs(inPitch) + Math.abs(inYaw);
      }
      q1.setFromEuler(new THREE.Euler(this.angVel.x * h, this.angVel.y * h, this.angVel.z * h, 'XYZ'));
      this.quat.multiply(q1).normalize();
      air.roll += this.angVel.z * h;
      air.pitch += this.angVel.x * h;
      air.yaw += this.angVel.y * h;
      // landing assist: close to the ground and no rotation input -> level the car out (not counted as a trick)
      if (!inPitch && !inRoll && !inYaw && this.vel.y < 0) {
        const below = this.probe(v1.copy(this.pos).add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0), 10);
        if (below && below.distance < 9) {
          v2.set(this.fwd.x, 0, this.fwd.z);
          if (v2.lengthSq() < 0.01) v2.set(-this.up.x, 0, -this.up.z);
          q1.setFromAxisAngle(UP, Math.atan2(v2.x, v2.z));
          this.quat.slerp(q1, 1 - Math.exp(-2.6 * h));
          this.angVel.multiplyScalar(Math.exp(-4 * h));
        }
      }
    }

    this.pos.addScaledVector(this.vel, h);
    this.basis();

    // landing check from the car centre
    const centre = v1.copy(this.pos).addScaledVector(this.up, 0.6);
    const origin = v2.copy(centre).add(new THREE.Vector3(0, 1.5, 0));
    const hit = this.probe(origin, new THREE.Vector3(0, -1, 0), 1.5 + 0.7 + Math.max(0, -this.vel.y) * h);
    if (hit && hit.distance - 1.5 <= 0.62 && this.vel.dot(hit.normal) < 0.5) {
      const upDot = this.up.dot(hit.normal);
      if (upDot > 0.2 || (this.flight && upDot > 0)) this.land(hit);
      else this.crash('aterrizaje');
    }
  }

  land(hit) {
    const nn = hit.normal;
    const impact = -this.vel.dot(nn);
    const air = this.air;
    this.pos.copy(hit.point);
    this.vel.addScaledVector(nn, -this.vel.dot(nn));
    this.vel.multiplyScalar(impact > 18 ? 0.8 : 0.95);
    q1.setFromUnitVectors(v1.set(0, 1, 0).applyQuaternion(this.quat), nn);
    this.quat.premultiply(q1).normalize();
    this.grounded = true;
    this.flight = false;
    this.normal.copy(nn);
    this.prevNormal.copy(nn);
    this.surface = hit.surface;
    this.yawRate = THREE.MathUtils.clamp(this.angVel.y, -3, 3) * 0.5;
    this.normalAcc = G;
    this.angVel.set(0, 0, 0);
    if (air) {
      const dist = Math.hypot(this.pos.x - air.start.x, this.pos.z - air.start.z);
      this.events.push({
        type: 'land',
        impact,
        airTime: air.time,
        roll: air.roll,
        pitch: air.pitch,
        yaw: air.yaw,
        distance: dist,
        height: air.maxY - Math.min(air.start.y, this.pos.y),
        fromLoop: air.fromLoop,
        invertedAtExit: air.invertedAtExit,
        overLineup: air.overLineup,
      });
    }
    this.air = null;
  }

  collide() {
    const centre = v1.copy(this.pos).addScaledVector(this.up, 0.6);
    for (const b of this.world.colliders) {
      if (b.groundOnly && (!this.grounded || this.surface !== 'ground')) continue;
      const r = 1.1;
      if (centre.x < b.min.x - r || centre.x > b.max.x + r) continue;
      if (centre.z < b.min.z - r || centre.z > b.max.z + r) continue;
      if (centre.y - 0.5 > b.max.y || centre.y + 0.5 < b.min.y) continue;
      const spd = this.speed;
      if ((b.crash && spd > 6) || (!this.grounded && spd > 12)) {
        this.vel.multiplyScalar(-0.2);
        this.crash('choque');
        return;
      }
      // push out along the smallest axis (XZ)
      const dx1 = b.max.x + r - centre.x;
      const dx2 = centre.x - (b.min.x - r);
      const dz1 = b.max.z + r - centre.z;
      const dz2 = centre.z - (b.min.z - r);
      const m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) {
        this.pos.x += dx1;
        if (this.vel.x < 0) this.vel.x *= -0.25;
      } else if (m === dx2) {
        this.pos.x -= dx2;
        if (this.vel.x > 0) this.vel.x *= -0.25;
      } else if (m === dz1) {
        this.pos.z += dz1;
        if (this.vel.z < 0) this.vel.z *= -0.25;
      } else {
        this.pos.z -= dz2;
        if (this.vel.z > 0) this.vel.z *= -0.25;
      }
      this.yawRate *= 0.85;
      if (spd > 8) this.events.push({ type: 'bump', speed: spd });
    }
  }
}
