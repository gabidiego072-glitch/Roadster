import * as THREE from 'three';

// Builds a smooth body by connecting cross-sections along the Z axis.
// Each section: { z, w (half width), b (bottom y), t (top y), nt, nb (roundness top/bottom), tw (top width factor) }
export function loftGeometry(sections, segs = 36) {
  const pos = [];
  const idx = [];
  const ring = (s) => {
    const pts = [];
    const mid = (s.b + s.t) / 2;
    const hh = (s.t - s.b) / 2;
    const nt = s.nt ?? 2.6;
    const nb = s.nb ?? 5;
    const tw = s.tw ?? 0.8;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const n = sn >= 0 ? nt : nb;
      let x = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = mid + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      if (sn > 0) x *= 1 + (tw - 1) * Math.pow(sn, 1.5);
      pts.push(x + (s.x ?? 0), y, s.z);
    }
    return pts;
  };
  sections.forEach((s) => pos.push(...ring(s)));
  const R = sections.length;
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < segs; i++) {
      const a = r * segs + i;
      const b = r * segs + ((i + 1) % segs);
      const c = (r + 1) * segs + i;
      const d = (r + 1) * segs + ((i + 1) % segs);
      idx.push(a, b, c, b, d, c);
    }
  }
  // caps
  const cap = (r, start) => {
    const base = pos.length / 3;
    const s = sections[r];
    pos.push(s.x ?? 0, (s.b + s.t) / 2, s.z);
    const ringStart = pos.length / 3;
    for (let i = 0; i < segs; i++) {
      const k = (r * segs + i) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
    }
    for (let i = 0; i < segs; i++) {
      const p = ringStart + i;
      const q = ringStart + ((i + 1) % segs);
      if (start) idx.push(base, q, p);
      else idx.push(base, p, q);
    }
  };
  cap(0, true);
  cap(R - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Sweeps a flat ribbon along a parametric path. fn(t) -> { p: Vector3, n: Vector3 (surface normal), side: Vector3 }
export function ribbonGeometry(fn, steps, width, offset = 0) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { p, n, side } = fn(t);
    const o = n.clone().multiplyScalar(offset);
    const l = p.clone().add(o).addScaledVector(side, width / 2);
    const r = p.clone().add(o).addScaledVector(side, -width / 2);
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
    uv.push(0, t * steps * 0.25, 1, t * steps * 0.25);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.anisotropy = 8;
  return tex;
}

export function noiseFill(ctx, w, h, base, variance, count = 40000, size = 2) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * variance;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 0.5, size * Math.random() + 0.5);
  }
}

// Radial glow sprite texture
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function rand(a, b) {
  return a + Math.random() * (b - a);
}
