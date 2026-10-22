// Procedural audio with WebAudio: electric motor whine, cold-gas hiss, fan hum, wind, crowd, beeps.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start();
      return s;
    };

    // motor: two detuned oscillators through a low-pass
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sine';
    const g1 = ctx.createGain();
    g1.gain.value = 0.18;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.osc1.connect(g1).connect(lp);
    this.osc2.connect(g2).connect(lp);
    lp.connect(this.motorGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // thruster hiss
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.6;
    noise().connect(bp).connect(this.hissGain).connect(this.master);

    // suction fan hum
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    const fanLp = ctx.createBiquadFilter();
    fanLp.type = 'lowpass';
    fanLp.frequency.value = 500;
    noise().connect(fanLp).connect(this.fanGain);
    this.fanOsc = ctx.createOscillator();
    this.fanOsc.type = 'triangle';
    this.fanOsc.frequency.value = 180;
    const fo = ctx.createGain();
    fo.gain.value = 0.25;
    this.fanOsc.connect(fo).connect(this.fanGain);
    this.fanOsc.start();
    this.fanGain.connect(this.master);

    // wind / tyres
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = 'lowpass';
    this.windLp.frequency.value = 400;
    noise().connect(this.windLp).connect(this.windGain).connect(this.master);
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 1100;
    sbp.Q.value = 8;
    noise().connect(sbp).connect(this.screechGain).connect(this.master);

    // crowd ambience
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.02;
    const cbp = ctx.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = 900;
    cbp.Q.value = 0.4;
    noise().connect(cbp).connect(this.crowdGain).connect(this.master);

    // horn
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.08;
      o.connect(g).connect(this.hornGain);
      o.start();
    }
    this.hornGain.connect(this.master);
  }

  set(param, value, t = 0.06) {
    if (!this.ctx) return;
    param.setTargetAtTime(value, this.ctx.currentTime, t);
  }

  update(car, ctl, crowdNear, cheer) {
    if (!this.ctx) return;
    const spd = Math.abs(car.wheelSpeed);
    const load = Math.max(ctl.throttle, ctl.brake * 0.5);
    this.set(this.osc1.frequency, 60 + spd * 9);
    this.set(this.osc2.frequency, 120 + spd * 18);
    this.set(this.motorGain.gain, Math.min(0.35, 0.03 + load * 0.12 + spd * 0.002));
    const hiss = Math.max(car.fx.boost, car.fx.lift, Math.abs(car.fx.roll) * 0.5, car.flight ? 0.5 : 0);
    this.set(this.hissGain.gain, hiss * 0.45, 0.03);
    this.set(this.fanGain.gain, car.suction ? 0.12 : 0);
    this.set(this.windGain.gain, Math.min(0.3, car.speed * 0.003));
    this.set(this.windLp.frequency, 300 + car.speed * 25);
    this.set(this.screechGain.gain, car.grounded && car.drifting ? 0.12 : 0);
    this.set(this.crowdGain.gain, 0.01 + crowdNear * 0.05 + (cheer ? 0.25 : 0), 0.3);
    this.set(this.hornGain.gain, ctl.horn ? 0.5 : 0, 0.01);
  }

  beep(freq = 880, dur = 0.15, vol = 0.3) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.value = vol;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + dur * 0.6, 0.03);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.2);
  }

  boom(vol = 0.6) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.05, 0.25);
    s.connect(f).connect(g).connect(this.master);
    s.start();
    s.stop(this.ctx.currentTime + 1.5);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }
}
