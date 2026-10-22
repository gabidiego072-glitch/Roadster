// Keyboard + gamepad + touch input, merged into one control state per frame.
export class Input {
  constructor() {
    this.keys = new Set();
    this.edges = new Set();
    this.steer = 0;
    this.padPrev = [];
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  press(code) {
    if (!this.keys.has(code)) this.edges.add(code);
    this.keys.add(code);
  }
  release(code) {
    this.keys.delete(code);
  }

  bindTouch(root) {
    root.querySelectorAll('[data-key]').forEach((el) => {
      const code = el.dataset.key;
      const on = (e) => {
        e.preventDefault();
        el.classList.add('on');
        this.press(code);
      };
      const off = (e) => {
        e.preventDefault();
        el.classList.remove('on');
        this.release(code);
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    });
  }

  read(dt) {
    const k = (c) => this.keys.has(c);
    const e = (c) => this.edges.has(c);
    let throttle = k('KeyW') || k('ArrowUp') ? 1 : 0;
    let brake = k('KeyS') || k('ArrowDown') ? 1 : 0;
    let left = k('KeyA') || k('ArrowLeft') ? 1 : 0;
    let right = k('KeyD') || k('ArrowRight') ? 1 : 0;
    let steerTarget = left - right;
    let roll = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    let pitch = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let yawAir = (k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0);
    let handbrake = k('Space');
    let boost = k('ShiftLeft') || k('ShiftRight');
    let lift = k('KeyQ');
    let descend = k('KeyX') || k('ControlLeft');
    const ctl = {
      jump: e('KeyQ'),
      suction: e('KeyE'),
      flight: e('KeyF'),
      lights: e('KeyL'),
      doors: e('KeyO'),
      camera: e('KeyC'),
      reset: e('KeyR'),
      horn: k('KeyH'),
      roof: e('KeyG'),
      help: e('KeyI') || e('Tab'),
      pause: e('Escape') || e('KeyP'),
      mute: e('KeyM'),
    };

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (gp) {
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const bp = (i) => b(i) > 0.5 && !(this.padPrev[i] > 0.5);
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      const lx = dz(gp.axes[0] || 0);
      const ly = dz(gp.axes[1] || 0);
      throttle = Math.max(throttle, b(7));
      brake = Math.max(brake, b(6));
      if (lx) {
        steerTarget = -lx;
        roll = lx;
      }
      if (ly) pitch = -ly;
      const rx = dz(gp.axes[2] || 0);
      if (rx) yawAir = -rx;
      handbrake = handbrake || b(1) > 0.5;
      boost = boost || b(5) > 0.5;
      lift = lift || b(0) > 0.5;
      descend = descend || b(4) > 0.5;
      ctl.jump = ctl.jump || bp(0);
      ctl.suction = ctl.suction || bp(2);
      ctl.flight = ctl.flight || bp(3);
      ctl.camera = ctl.camera || bp(8);
      ctl.pause = ctl.pause || bp(9);
      ctl.lights = ctl.lights || bp(12);
      ctl.reset = ctl.reset || bp(13);
      this.padPrev = gp.buttons.map((x) => x.value);
    }

    // smooth keyboard steering
    const rate = steerTarget === 0 ? 7 : 4.5;
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-rate * dt));
    if (Math.abs(this.steer) < 0.001) this.steer = 0;

    this.edges.clear();
    return Object.assign(ctl, { throttle, brake, steer: this.steer, roll, pitch, yawAir, handbrake, boost, lift, descend });
  }
}
