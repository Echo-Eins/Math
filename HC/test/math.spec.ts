import { describe, it, expect } from 'vitest';
import { Hypercube, popcount, subsetsOf, subsetsOfSize } from '../src/math/Hypercube.js';
import {
  identity,
  applyGivensLeft,
  applyMatrix,
  reorthogonalize,
  orthogonalityError
} from '../src/math/Givens.js';
import { Camera } from '../src/math/Camera.js';
import { Projection } from '../src/math/Projection.js';
import { KnifeClip } from '../src/culling/KnifeClip.js';

/* ---------- Hypercube combinatorics ---------- */

describe('Hypercube combinatorics', () => {
  for (const n of [1, 2, 3, 4, 5, 8, 10]) {
    it(`n=${n}: vertex count = 2^n`, () => {
      const h = new Hypercube(n);
      expect(h.vertexCount).toBe(1 << n);
    });

    it(`n=${n}: edge count = n · 2^(n-1)`, () => {
      const h = new Hypercube(n);
      expect(h.edgeCount).toBe(n * (1 << (n - 1)));
      expect(h.edges.length).toBe(h.edgeCount);
    });

    it(`n=${n}: each edge has Hamming distance 1`, () => {
      const h = new Hypercube(n);
      for (const e of h.edges) {
        const xor = e.a ^ e.b;
        expect(popcount(xor)).toBe(1);
        expect(xor).toBe(1 << e.axis);
        expect(e.a).toBeLessThan(e.b);
      }
    });

    it(`n=${n}: edges partition by axis correctly`, () => {
      const h = new Hypercube(n);
      let total = 0;
      for (let a = 0; a < n; a++) {
        expect(h.edgesByAxis[a].length).toBe(1 << (n - 1));
        for (const e of h.edgesByAxis[a]) {
          expect(e.axis).toBe(a);
        }
        total += h.edgesByAxis[a].length;
      }
      expect(total).toBe(h.edgeCount);
    });

    it(`n=${n}: vertex coords map bits to ±1`, () => {
      const h = new Hypercube(n);
      for (let v = 0; v < h.vertexCount; v++) {
        const c = h.coords(v);
        for (let j = 0; j < n; j++) {
          const expected = ((v >> j) & 1) ? 1 : -1;
          expect(c[j]).toBe(expected);
        }
      }
    });
  }

  it('face count C(n,k)·2^(n-k) is correct', () => {
    // 4-куб: 16 вершин, 32 ребра, 24 двумерные грани, 8 трёхмерных ячеек, 1 четырёхмерная.
    const h = new Hypercube(4);
    expect(h.faces(0).length).toBe(16); // вершины
    expect(h.faces(1).length).toBe(32); // рёбра
    expect(h.faces(2).length).toBe(24); // 2-грани
    expect(h.faces(3).length).toBe(8);  // 3-ячейки
    expect(h.faces(4).length).toBe(1);  // сам куб
  });

  it('faceVertices size = 2^k', () => {
    const h = new Hypercube(5);
    for (let k = 0; k <= 5; k++) {
      const faces = h.faces(k);
      for (const f of faces) {
        const verts = h.faceVertices(f);
        expect(verts.length).toBe(1 << k);
        // Все вершины должны лежать в гиперкубе и в указанной грани.
        for (const v of verts) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(h.vertexCount);
          // Фиксированные координаты должны совпадать с fixedValues.
          const fixedMask = ((1 << h.n) - 1) & ~f.freeMask;
          expect(v & fixedMask).toBe(f.fixedValues & fixedMask);
        }
      }
    }
  });

  it('buildFace produces correct face', () => {
    const h = new Hypercube(4);
    // x_0 = +1, x_2 = -1, остальные свободны (x_1, x_3).
    const f = h.buildFace({ 0: 1, 2: -1 });
    expect(f.dim).toBe(2);
    expect((f.freeMask >> 0) & 1).toBe(0);
    expect((f.freeMask >> 1) & 1).toBe(1);
    expect((f.freeMask >> 2) & 1).toBe(0);
    expect((f.freeMask >> 3) & 1).toBe(1);
    expect((f.fixedValues >> 0) & 1).toBe(1);
    expect((f.fixedValues >> 2) & 1).toBe(0);
  });

  it('subsetsOf produces 2^k elements (no duplicates)', () => {
    const mask = 0b10101;
    const seen = new Set<number>();
    for (const s of subsetsOf(mask)) {
      expect(s & ~mask).toBe(0); // подмножество маски
      seen.add(s);
    }
    expect(seen.size).toBe(1 << popcount(mask));
  });

  it('subsetsOfSize: C(n, k) элементов', () => {
    const all = [...subsetsOfSize(6, 3)];
    expect(all.length).toBe(20); // C(6,3)
    for (const m of all) expect(popcount(m)).toBe(3);
    // Все различны.
    expect(new Set(all).size).toBe(20);
  });
});

/* ---------- Givens rotations ---------- */

describe('Givens rotations', () => {
  it('Identity matrix is orthogonal', () => {
    const M = identity(5);
    expect(orthogonalityError(M, 5)).toBeLessThan(1e-14);
  });

  it('Single Givens preserves orthogonality', () => {
    const M = identity(6);
    applyGivensLeft(M, 6, 1, 4, 0.7);
    expect(orthogonalityError(M, 6)).toBeLessThan(1e-14);
  });

  it('Many Givens compositions stay near orthogonal; drift removable', () => {
    const n = 8;
    const M = identity(n);
    for (let k = 0; k < 5000; k++) {
      const i = Math.floor(Math.random() * n);
      let j = Math.floor(Math.random() * n);
      if (j === i) j = (j + 1) % n;
      applyGivensLeft(M, n, i, j, (Math.random() - 0.5) * 0.2);
    }
    const errBefore = orthogonalityError(M, n);
    // После 5000 случайных вращений float64 ошибка должна оставаться маленькой:
    expect(errBefore).toBeLessThan(1e-8);
    reorthogonalize(M, n);
    const errAfter = orthogonalityError(M, n);
    expect(errAfter).toBeLessThan(1e-12);
  });

  it('Inverse rotation cancels out', () => {
    const n = 4;
    const M = identity(n);
    applyGivensLeft(M, n, 0, 3, 1.234);
    applyGivensLeft(M, n, 0, 3, -1.234);
    expect(orthogonalityError(M, n)).toBeLessThan(1e-14);
    // Должна быть identity.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const expected = i === j ? 1 : 0;
        expect(Math.abs(M[i * n + j] - expected)).toBeLessThan(1e-14);
      }
    }
  });

  it('Rotation by π/2 swaps basis vectors (up to sign)', () => {
    const n = 3;
    const M = identity(n);
    applyGivensLeft(M, n, 0, 1, Math.PI / 2);
    // После G(0,1,π/2): row 0 = cos·e_0 − sin·e_1 = −e_1, row 1 = sin·e_0 + cos·e_1 = e_0.
    const v = new Float64Array([1, 0, 0]);
    const out = new Float64Array(3);
    applyMatrix(M, n, v, out);
    expect(Math.abs(out[0])).toBeLessThan(1e-14);  // first row · e_0 ≈ cos = 0
    expect(Math.abs(out[1] - 1)).toBeLessThan(1e-14); // second row · e_0 = sin = 1
  });
});

/* ---------- Camera ---------- */

describe('Camera', () => {
  it('Initial frame is identity, position is origin', () => {
    const c = new Camera(5);
    for (let i = 0; i < 5; i++) {
      expect(c.position[i]).toBe(0);
      for (let j = 0; j < 5; j++) {
        expect(c.frame[i * 5 + j]).toBe(i === j ? 1 : 0);
      }
    }
  });

  it('transformWorldToCamera with identity frame and zero position is identity transform', () => {
    const c = new Camera(4);
    const v = new Float64Array([1, -1, 1, -1]);
    const out = new Float64Array(4);
    c.transformWorldToCamera(v, out);
    for (let i = 0; i < 4; i++) expect(out[i]).toBe(v[i]);
  });

  it('Readable pose makes all higher dims contribute to lower ones', () => {
    const c = new Camera(5);
    c.setReadablePose();
    // After rotation, the first row of frame should have nonzero entries in all columns
    // (because we cascaded G(0,1), G(1,2), G(2,3), G(3,4)).
    const row0 = Array.from(c.frame.slice(0, 5));
    // Хотя бы 3 ненулевых: при последовательных малых поворотах коэффициенты остаются
    // отличными от нуля в подцепочке.
    const nonzero = row0.filter((x) => Math.abs(x) > 1e-3).length;
    expect(nonzero).toBeGreaterThanOrEqual(2);
  });

  it('moveLocal moves along current frame', () => {
    const c = new Camera(4);
    const delta = new Float64Array([0.5, 0, 0, 0]); // двинуть на 0.5 вдоль e_0 камеры
    c.moveLocal(delta);
    expect(c.position[0]).toBe(0.5);
    // При identity frame frame[0] = e_0 в мировых координатах, так что position[0] = 0.5.
  });

  it('Reorthogonalization preserves rotation direction', () => {
    const c = new Camera(5);
    for (let k = 0; k < 300; k++) c.rotate(0, 1, 0.05);
    c.checkAndReorthogonalize();
    expect(c.orthogonalityError()).toBeLessThan(1e-10);
  });
});

/* ---------- Projection ---------- */

describe('Projection', () => {
  it('Orthogonal projection (d=∞) preserves first 3 coords', () => {
    const p = new Projection(5);
    for (let i = 0; i < p.distances.length; i++) p.distances[i] = Infinity;
    const v = new Float64Array([0.7, -0.3, 0.5, 0.9, -0.8]);
    const r = p.projectVertex(v);
    expect(r.clipped).toBe(false);
    expect(r.pos[0]).toBeCloseTo(0.7, 12);
    expect(r.pos[1]).toBeCloseTo(-0.3, 12);
    expect(r.pos[2]).toBeCloseTo(0.5, 12);
    expect(r.hiddenDepths).toEqual([-0.8, 0.9]); // отбрасывали с x_5, потом x_4
  });

  it('Perspective shrinks distant points', () => {
    const p = new Projection(4);
    p.setDistance(4, 5); // d_4 = 5
    const near = new Float64Array([1, 0, 0, 0]);  // x_4 = 0
    const far = new Float64Array([1, 0, 0, 4]);   // x_4 = 4
    const rNear = p.projectVertex(near);
    const rFar = p.projectVertex(far);
    // k_near = 5/(5+0) = 1; k_far = 5/(5+4) ≈ 0.555
    expect(rNear.pos[0]).toBeCloseTo(1, 12);
    expect(rFar.pos[0]).toBeCloseTo(5 / 9, 12);
  });

  it('Vertex behind camera is clipped', () => {
    const p = new Projection(4);
    p.setDistance(4, 5);
    const behind = new Float64Array([1, 0, 0, -6]); // x_4 = -6 < -d_4 = -5
    const r = p.projectVertex(behind);
    expect(r.clipped).toBe(true);
  });

  it('Edge with one endpoint behind camera is clipped at singularity', () => {
    const p = new Projection(4);
    p.setDistance(4, 5);
    const front = new Float64Array([1, 0, 0, 2]);
    const behind = new Float64Array([1, 0, 0, -10]);
    const er = p.projectEdge(front, behind);
    expect(er.result).not.toBeNull();
    expect(er.result!.clippedFraction).toBeGreaterThan(0);
  });

  it('Edge with both endpoints behind camera returns null', () => {
    const p = new Projection(4);
    p.setDistance(4, 5);
    const b1 = new Float64Array([1, 0, 0, -8]);
    const b2 = new Float64Array([1, 0, 0, -10]);
    expect(p.projectEdge(b1, b2).result).toBeNull();
  });
});

/* ---------- KnifeClip ---------- */

describe('KnifeClip', () => {
  it('Camera outside in one axis sees face fixed in that axis', () => {
    const h = new Hypercube(4);
    const cam = new Camera(4);
    cam.position.set([3, 0, 0, 0]); // далеко по x_0
    // Грань x_0 = +1, x_1 = +1, свободны x_2, x_3.
    const face = h.buildFace({ 0: 1, 1: 1 });
    // Камера на стороне x_0 = +1 (3 > 1), но НЕ на стороне x_1 = +1 (0 < 1).
    // Поэтому грань НЕ должна быть видна (нужна видимость по обеим фиксированным осям).
    expect(KnifeClip.isVisible(face, cam)).toBe(false);
  });

  it('Camera in outward octant sees face', () => {
    const h = new Hypercube(4);
    const cam = new Camera(4);
    cam.position.set([3, 3, 0, 0]);
    const face = h.buildFace({ 0: 1, 1: 1 });
    expect(KnifeClip.isVisible(face, cam)).toBe(true);
  });

  it('Camera inside cube → no face passes', () => {
    const h = new Hypercube(4);
    const cam = new Camera(4);
    cam.position.set([0, 0, 0, 0]); // в центре
    const face = h.buildFace({ 0: 1, 1: 1 });
    expect(KnifeClip.isVisible(face, cam)).toBe(false);
    expect(KnifeClip.cameraInsideCube(cam)).toBe(true);
  });
});
