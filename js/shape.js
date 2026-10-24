import * as THREE from 'three';

// Monotone cubic interpolation (Fritsch–Carlson): smooth like a spline but never overshoots.
function pchipSlopes(x, y) {
  const n = x.length;
  const h = [];
  const d = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(x[k + 1] - x[k]);
    d.push((y[k + 1] - y[k]) / (x[k + 1] - x[k]));
  }
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) m[k] = 0;
    else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
  }
  return m;
}

function pchipEval(x, y, m, k, t) {
  const h = x[k + 1] - x[k];
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * h * m[k + 1];
}

// Removes zero-area triangles and computes normals that are smooth across gentle bends
// but stay sharp across creases (angle in degrees). Expects non-indexed positions with outward winding.
export function finishGeometry(pos, creaseDeg = 32) {
  const tris = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const clean = [];
  const fn = [];
  for (let i = 0; i < pos.length; i += 9) {
    a.fromArray(pos, i);
    b.fromArray(pos, i + 3);
    c.fromArray(pos, i + 6);
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(e1, e2);
    const len = n.length();
    if (len < 1e-9) continue;
    n.divideScalar(len);
    clean.push(...pos.slice(i, i + 9));
    fn.push(n);
    tris.push(i);
  }
  const key = (x, y, z) => `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
  const map = new Map();
  for (let t = 0; t < fn.length; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const k = key(clean[o], clean[o + 1], clean[o + 2]);
      let list = map.get(k);
      if (!list) map.set(k, (list = []));
      list.push(t);
    }
  }
  const cosA = Math.cos((creaseDeg * Math.PI) / 180);
  const normals = new Float32Array(clean.length);
  const acc = new THREE.Vector3();
  for (let t = 0; t < fn.length; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const list = map.get(key(clean[o], clean[o + 1], clean[o + 2]));
      acc.set(0, 0, 0);
      for (const u of list) if (fn[u].dot(fn[t]) >= cosA) acc.add(fn[u]);
      if (acc.lengthSq() < 1e-12) acc.copy(fn[t]);
      acc.normalize();
      normals[o] = acc.x;
      normals[o + 1] = acc.y;
      normals[o + 2] = acc.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(clean, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  return g;
}

function signedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/**
 * Lofts polygon cross-sections along +Z into a closed, smooth-shaded solid with sharp creases.
 * sections: [{ z, pts: [[x, y], ...] }] sorted by increasing z, all with the same point count.
 * mirror: pts is a half profile from bottom centre (x=0) to top centre (x=0), mirrored to -X.
 * subdiv: extra rings per interval; smooth: point indices interpolated with a monotone spline
 * (others are interpolated linearly so intentional cut-outs such as wheel arches stay crisp).
 */
export function smoothLoft(sections, { mirror = true, subdiv = 4, smooth = null, crease = 32, caps = true } = {}) {
  const zs = sections.map((s) => s.z);
  const nP = sections[0].pts.length;
  const slopes = [];
  for (let i = 0; i < nP; i++) {
    const xs = sections.map((s) => s.pts[i][0]);
    const ys = sections.map((s) => s.pts[i][1]);
    slopes.push({ xs, ys, mx: pchipSlopes(zs, xs), my: pchipSlopes(zs, ys) });
  }
  const dense = [];
  for (let k = 0; k < sections.length - 1; k++) {
    for (let j = 0; j < subdiv; j++) {
      const t = j / subdiv;
      const z = zs[k] + (zs[k + 1] - zs[k]) * t;
      const pts = [];
      for (let i = 0; i < nP; i++) {
        const S = slopes[i];
        if (!smooth || smooth.includes(i)) pts.push([pchipEval(zs, S.xs, S.mx, k, t), pchipEval(zs, S.ys, S.my, k, t)]);
        else pts.push([S.xs[k] + (S.xs[k + 1] - S.xs[k]) * t, S.ys[k] + (S.ys[k + 1] - S.ys[k]) * t]);
      }
      dense.push({ z, pts });
    }
  }
  dense.push(sections[sections.length - 1]);

  let rings = dense.map((s) => {
    const r = s.pts.map(([x, y]) => [x, y]);
    if (mirror) for (let i = s.pts.length - 2; i >= 1; i--) r.push([-s.pts[i][0], s.pts[i][1]]);
    return r;
  });
  // make every ring counter-clockwise (seen from +Z) so faces point outward
  if (signedArea(rings[Math.floor(rings.length / 2)]) < 0) rings = rings.map((r) => r.slice().reverse());
  const n = rings[0].length;
  const P = (k, i) => [rings[k][i][0], rings[k][i][1], dense[k].z];
  const pos = [];
  const tri = (p, q, r) => pos.push(...p, ...q, ...r);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      tri(P(k, i), P(k, i2), P(k + 1, i));
      tri(P(k, i2), P(k + 1, i2), P(k + 1, i));
    }
  }
  if (caps) {
    for (const [k, start] of [
      [0, true],
      [rings.length - 1, false],
    ]) {
      const cx = rings[k].reduce((s, p) => s + p[0], 0) / n;
      const cy = rings[k].reduce((s, p) => s + p[1], 0) / n;
      const C = [cx, cy, dense[k].z];
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        if (start) tri(C, P(k, i2), P(k, i));
        else tri(C, P(k, i), P(k, i2));
      }
    }
  }
  return finishGeometry(pos, crease);
}

// Convex solid from a list of points: faces oriented away from the centroid (flat shaded).
export function convexPrism(outer, thickness) {
  const inner = outer.map(([x, y, z]) => [x - Math.sign(x) * thickness, y, z]);
  const v = [...outer, ...inner];
  const idx = [0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0];
  const cen = v.reduce((s, p) => [s[0] + p[0] / v.length, s[1] + p[1] / v.length, s[2] + p[2] / v.length], [0, 0, 0]);
  const pos = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const Cc = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    let [p, q, r] = [v[idx[i]], v[idx[i + 1]], v[idx[i + 2]]];
    A.fromArray(p);
    B.fromArray(q);
    Cc.fromArray(r);
    const nrm = new THREE.Vector3().crossVectors(B.clone().sub(A), Cc.clone().sub(A));
    const mid = A.clone().add(B).add(Cc).divideScalar(3).sub(new THREE.Vector3(...cen));
    if (nrm.dot(mid) < 0) [q, r] = [r, q];
    pos.push(...p, ...q, ...r);
  }
  return finishGeometry(pos, 1);
}
