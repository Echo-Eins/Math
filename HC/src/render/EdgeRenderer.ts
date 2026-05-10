import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import type { Hypercube } from '../math/Hypercube.js';
import type { Edge } from '../math/types.js';

/**
 * Рендер рёбер гиперкуба.
 *
 * Стратегия: WebGL не поддерживает per-edge толщину линий через
 * обычный LineBasicMaterial. Поэтому используется LineSegments2 из
 * three/examples с настоящей экранной толщиной. Чтобы иметь
 * возможность подсвечивать рёбра, параллельные конкретной оси
 * (требование «активной плоскости»), все рёбра разбиты по группам:
 * по одной LineSegments2 на каждую исходную ось гиперкуба.
 *
 * Для n=10 это 10 экземпляров — приемлемо.
 */
export class EdgeRenderer {
  readonly n: number;
  private readonly groups: AxisGroup[];

  /** Корневой объект, добавляемый в сцену. */
  readonly object: THREE.Group;

  /** Стандартная толщина линии в экранных пикселях. */
  baseLinewidth = 1.6;
  /** Толщина для «активной» оси. */
  highlightLinewidth = 4.0;

  constructor(hypercube: Hypercube, renderer: THREE.WebGLRenderer) {
    this.n = hypercube.n;
    this.object = new THREE.Group();
    this.groups = [];
    const resolution = new THREE.Vector2();
    renderer.getSize(resolution);

    for (let axis = 0; axis < hypercube.n; axis++) {
      const axisEdges = hypercube.edgesByAxis[axis];
      const m = axisEdges.length;
      const positions = new Float32Array(m * 6); // 2 vertices × 3 floats × m segments
      const colors = new Float32Array(m * 6);

      const geometry = new LineSegmentsGeometry();
      // Стартовые позиции в (0,0,0); реальные значения проставим в первом update().
      geometry.setPositions(positions);
      geometry.setColors(colors);

      const material = new LineMaterial({
        linewidth: this.baseLinewidth,
        vertexColors: true,
        worldUnits: false,
        transparent: true,
        depthTest: true,
        alphaToCoverage: false
      });
      material.resolution.copy(resolution);

      const seg = new LineSegments2(geometry, material);
      seg.computeLineDistances();
      seg.frustumCulled = false; // мы сами управляем видимостью
      this.object.add(seg);

      this.groups.push({
        axis,
        edges: axisEdges,
        segments: seg,
        material,
        geometry,
        positions,
        colors
      });
    }
  }

  /**
   * Поднять/опустить толщину группы рёбер, параллельных оси `axis`.
   * Передайте highlightLinewidth для подсветки, baseLinewidth для возврата.
   */
  setAxisLinewidth(axis: number, width: number): void {
    if (axis < 0 || axis >= this.n) return;
    this.groups[axis].material.linewidth = width;
  }

  /** Сбросить все группы к базовой толщине. */
  resetLinewidths(): void {
    for (const g of this.groups) g.material.linewidth = this.baseLinewidth;
  }

  /**
   * Обновить геометрию: для каждого ребра принимаем спроецированные
   * концы и цвет. Если ребро было полностью отсечено клиппингом —
   * передаём вырожденный сегмент (обе точки совпадают: невидим).
   *
   * `edgeData` индексирован по группам и внутри группы — по порядку
   * hypercube.edgesByAxis[axis].
   */
  updateFromCallback(
    callback: (edge: Edge, axisIndex: number, edgeIndexInAxis: number) =>
      | null
      | {
          p1: [number, number, number];
          p2: [number, number, number];
          c1: [number, number, number];
          c2: [number, number, number];
        }
  ): void {
    for (const g of this.groups) {
      const pos = g.positions;
      const col = g.colors;
      for (let i = 0; i < g.edges.length; i++) {
        const e = g.edges[i];
        const data = callback(e, g.axis, i);
        const base = i * 6;
        if (data === null) {
          // Вырожденный сегмент.
          pos[base + 0] = 0; pos[base + 1] = 0; pos[base + 2] = 0;
          pos[base + 3] = 0; pos[base + 4] = 0; pos[base + 5] = 0;
          col[base + 0] = 0; col[base + 1] = 0; col[base + 2] = 0;
          col[base + 3] = 0; col[base + 4] = 0; col[base + 5] = 0;
        } else {
          pos[base + 0] = data.p1[0];
          pos[base + 1] = data.p1[1];
          pos[base + 2] = data.p1[2];
          pos[base + 3] = data.p2[0];
          pos[base + 4] = data.p2[1];
          pos[base + 5] = data.p2[2];
          col[base + 0] = data.c1[0];
          col[base + 1] = data.c1[1];
          col[base + 2] = data.c1[2];
          col[base + 3] = data.c2[0];
          col[base + 4] = data.c2[1];
          col[base + 5] = data.c2[2];
        }
      }
      g.geometry.setPositions(pos);
      g.geometry.setColors(col);
    }
  }

  /** Обновить resolution для всех материалов (вызывать при resize). */
  setResolution(width: number, height: number): void {
    for (const g of this.groups) {
      g.material.resolution.set(width, height);
    }
  }

  dispose(): void {
    for (const g of this.groups) {
      g.geometry.dispose();
      g.material.dispose();
    }
  }
}

interface AxisGroup {
  axis: number;
  edges: ReadonlyArray<Edge>;
  segments: LineSegments2;
  material: LineMaterial;
  geometry: LineSegmentsGeometry;
  positions: Float32Array;
  colors: Float32Array;
}
