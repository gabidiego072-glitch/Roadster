import * as THREE from 'three';

// Tyre marks: a ring buffer of thin quads laid on the surface under each sliding wheel.
export class SkidMarks {
  constructor(scene, maxSegments = 2400) {
    this.max = maxSegments;
    this.pos = new Float32Array(maxSegments * 4 * 3);
    this.col = new Float32Array(maxSegments * 4 * 4);
    const idx = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -7,
        polygonOffsetUnits: -7,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.cursor = 0;
    this.last = new Map();
    this.dirty = false;
    this.tmpSide = new THREE.Vector3();
  }

  // wheelId: stable id; p: contact point; n: surface normal; dir: travel direction; width; strength 0..1
  add(wheelId, p, n, dir, width, strength) {
    const prev = this.last.get(wheelId);
    const side = this.tmpSide.crossVectors(n, dir).normalize().multiplyScalar(width / 2);
    const lift = 0.025;
    const L = new THREE.Vector3().copy(p).add(side).addScaledVector(n, lift);
    const R = new THREE.Vector3().copy(p).sub(side).addScaledVector(n, lift);
    if (!prev || prev.p.distanceToSquared(p) > 9) {
      this.last.set(wheelId, { p: p.clone(), L, R, a: strength });
      return;
    }
    if (prev.p.distanceToSquared(p) < 0.04) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 12;
    this.pos.set([prev.L.x, prev.L.y, prev.L.z, prev.R.x, prev.R.y, prev.R.z, L.x, L.y, L.z, R.x, R.y, R.z], o);
    const c = i * 16;
    const a0 = prev.a * 0.55;
    const a1 = strength * 0.55;
    this.col.set([0.03, 0.03, 0.03, a0, 0.03, 0.03, 0.03, a0, 0.03, 0.03, 0.03, a1, 0.03, 0.03, 0.03, a1], c);
    this.last.set(wheelId, { p: p.clone(), L, R, a: strength });
    this.dirty = true;
  }

  // wheel lifted or stopped sliding: the next mark starts a new strip
  lift(wheelId) {
    this.last.delete(wheelId);
  }

  clear() {
    this.col.fill(0);
    this.last.clear();
    this.dirty = true;
  }

  update(dt) {
    // fade old marks very slowly so long sessions don't fill the buffer with hard edges
    this.fadeT = (this.fadeT || 0) + dt;
    if (this.fadeT > 0.5) {
      this.fadeT = 0;
      for (let i = 3; i < this.col.length; i += 4) if (this.col[i] > 0) this.col[i] = Math.max(0, this.col[i] - 0.004);
      this.dirty = true;
    }
    if (this.dirty) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.color.needsUpdate = true;
      this.dirty = false;
    }
  }
}
