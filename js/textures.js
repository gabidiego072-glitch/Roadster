import * as THREE from 'three';

// Procedural textures: everything is drawn at load time, so the game ships as a single file.

export function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (draw) draw(ctx, w, h);
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = aniso;
  return t;
}

// Seeded random so textures look the same every run
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise height field in [0,1], several octaves
export function noiseField(size, { octaves = 5, base = 4, seed = 7, persistence = 0.5 } = {}) {
  const rand = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const top = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
        const bot = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
        out[y * size + x] += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// Height field -> tangent-space normal map canvas (wraps at the edges, so it tiles)
export function normalCanvas(height, w, h, strength = 2) {
  return makeCanvas(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const H = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const l = Math.hypot(dx, dy, 1);
        const o = (y * w + x) * 4;
        img.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
        img.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
        img.data[o + 2] = (1 / l) * 0.5 * 255 + 127.5;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function fieldToCanvas(field, size, map) {
  return makeCanvas(size, size, (ctx) => {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < field.length; i++) {
      const [r, g, b] = map(field[i], i);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

// Texas scrubland dirt: colour, normal and roughness
export function dirtSet(size = 512) {
  const f = noiseField(size, { octaves: 6, base: 4, seed: 11 });
  const pebbles = noiseField(size, { octaves: 2, base: 64, seed: 5, persistence: 0.6 });
  const height = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) height[i] = f[i] * 0.6 + Math.pow(pebbles[i], 6) * 1.6;
  const color = fieldToCanvas(f, size, (v, i) => {
    const p = Math.pow(pebbles[i], 5);
    const k = 0.75 + v * 0.5;
    const grass = Math.max(0, v - 0.62) * 2.2;
    return [(92 * k + p * 60) * (1 - grass * 0.4), (76 * k + p * 50) * (1 - grass * 0.1) + grass * 20, (56 * k + p * 40) * (1 - grass * 0.5)];
  });
  return { color, normal: normalCanvas(height, size, size, 3.5) };
}

// Concrete slab (one slab per texture) with expansion joints, stains and wet patches
export function concreteSet(size = 1024) {
  const f = noiseField(size, { octaves: 6, base: 3, seed: 21 });
  const fine = noiseField(size, { octaves: 2, base: 128, seed: 3, persistence: 0.7 });
  const wet = noiseField(size, { octaves: 4, base: 3, seed: 41 });
  const joint = (x, y) => {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    return d < 4 ? 1 - d / 4 : 0;
  };
  const height = new Float32Array(f.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    height[i] = f[i] * 0.25 + fine[i] * 0.35 - joint(x, y) * 1.2;
  }
  const color = fieldToCanvas(f, size, (v, i) => {
    const x = i % size;
    const y = (i / size) | 0;
    const j = joint(x, y);
    const w = wet[i] > 0.66 ? 0.88 : 1;
    const k = (0.8 + v * 0.35 + (fine[i] - 0.5) * 0.12) * w * (1 - j * 0.6);
    return [120 * k, 122 * k, 126 * k];
  });
  const rough = fieldToCanvas(f, size, (v, i) => {
    const r = wet[i] > 0.66 ? 70 - (wet[i] - 0.66) * 150 : 210 + v * 40;
    const c = Math.max(25, Math.min(255, r));
    return [c, c, c];
  });
  return { color, normal: normalCanvas(height, size, size, 2.2), rough };
}

// Asphalt with fine aggregate
export function asphaltSet(size = 512) {
  const f = noiseField(size, { octaves: 2, base: 96, seed: 31, persistence: 0.7 });
  const big = noiseField(size, { octaves: 4, base: 3, seed: 32 });
  const color = fieldToCanvas(f, size, (v, i) => {
    const k = 0.7 + v * 0.45 + (big[i] - 0.5) * 0.25;
    return [40 * k, 41 * k, 44 * k];
  });
  return { color, normal: normalCanvas(f, size, size, 3) };
}

// Corrugated metal siding for the hangars
export function corrugatedSet(w = 256, h = 256) {
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = Math.sin((x / w) * Math.PI * 2 * 16) * 0.5 + 0.5;
  const color = makeCanvas(w, h, (ctx) => {
    ctx.fillStyle = '#8f969e';
    ctx.fillRect(0, 0, w, h);
    const rand = rng(9);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(60,50,40,${rand() * 0.08})`;
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 6, 10 + rand() * 60);
    }
  });
  return { color, normal: normalCanvas(height, w, h, 6) };
}

// Tyre tread (normal map) and sidewall lettering
export function treadNormal() {
  const w = 256;
  const h = 64;
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w;
    const v = y / h;
    let d = 1;
    if (Math.abs(v - 0.5) < 0.04 || Math.abs(v - 0.22) < 0.03 || Math.abs(v - 0.78) < 0.03) d = 0;
    const slant = (u * 24 + v * 1.5) % 1;
    if ((v < 0.2 || v > 0.8) && slant < 0.18) d = 0;
    height[y * w + x] = d;
  }
  return normalCanvas(height, w, h, 1.8);
}

export function sidewallCanvas() {
  return makeCanvas(512, 512, (ctx, w) => {
    ctx.clearRect(0, 0, w, w);
    ctx.translate(w / 2, w / 2);
    ctx.fillStyle = 'rgba(200,200,200,0.6)';
    ctx.font = '700 22px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = 'ROADSTER  ·  285/30 ZR21  ·  ROADSTER  ·  325/30 ZR21  ·  ';
    const r = w * 0.462;
    for (let i = 0; i < text.length; i++) {
      const a = (i / text.length) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -r);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
    }
  });
}

// Drilled brake disc
export function discCanvas() {
  return makeCanvas(256, 256, (ctx, w) => {
    ctx.fillStyle = '#6d7076';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a3c40';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w * 0.27, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1c1f';
    for (let ring = 0; ring < 3; ring++) {
      const r = w * (0.33 + ring * 0.05);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + ring * 0.12;
        ctx.beginPath();
        ctx.arc(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, w / 2, w * 0.3 + i * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

// Hexagon mesh for the front intake
export function honeycombCanvas() {
  return makeCanvas(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2c30';
    ctx.lineWidth = 2;
    const r = 8;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 20; col++) {
        const cx = col * r * 1.75 + (row % 2) * r * 0.87;
        const cy = row * r * 1.5;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  });
}

// Segmented LED strip (emissive map)
export function ledStripCanvas(segments = 48, color = '#ff2030') {
  return makeCanvas(1024, 32, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const sw = w / segments;
    for (let i = 0; i < segments; i++) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#000');
      g.addColorStop(0.5, color);
      g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.fillRect(i * sw + 2, 4, sw - 4, h - 8);
    }
  });
}

// Centre touchscreen UI
export function screenCanvas() {
  return makeCanvas(512, 320, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b1018');
    g.addColorStop(1, '#141c28');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(80,140,200,0.35)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.45, h * (0.1 + i * 0.12));
      ctx.bezierCurveTo(w * 0.6, h * (0.2 + i * 0.1), w * 0.8, h * (0.05 + i * 0.12), w, h * (0.15 + i * 0.11));
      ctx.stroke();
    }
    ctx.fillStyle = '#3fd8ff';
    ctx.beginPath();
    ctx.arc(w * 0.72, h * 0.55, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eef2f6';
    ctx.font = '300 92px Arial, sans-serif';
    ctx.fillText('0', 40, 140);
    ctx.font = '500 22px Arial, sans-serif';
    ctx.fillStyle = '#8d97a5';
    ctx.fillText('MPH', 44, 175);
    ctx.fillText('D', 44, 230);
    ctx.fillStyle = '#e0202f';
    ctx.fillRect(40, 270, 150, 6);
  });
}

// Moon with maria and craters
export function moonCanvas() {
  return makeCanvas(256, 256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.75, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = '#e9ecf2';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2);
    ctx.fill();
    const rand = rng(77);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(150,158,172,${0.25 + rand() * 0.2})`;
      ctx.beginPath();
      ctx.arc(w / 2 + (rand() - 0.5) * w * 0.45, w / 2 + (rand() - 0.5) * w * 0.45, w * (0.04 + rand() * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 40; i++) {
      const x = w / 2 + (rand() - 0.5) * w * 0.6;
      const y = w / 2 + (rand() - 0.5) * w * 0.6;
      if (Math.hypot(x - w / 2, y - w / 2) > w * 0.33) continue;
      ctx.strokeStyle = 'rgba(120,128,140,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, 1 + rand() * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // soft halo
    const halo = ctx.createRadialGradient(w / 2, w / 2, w * 0.34, w / 2, w / 2, w / 2);
    halo.addColorStop(0, 'rgba(200,215,255,0.35)');
    halo.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, w);
  });
}
