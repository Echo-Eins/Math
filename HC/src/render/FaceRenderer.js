import * as THREE from 'three';
/**
 * Рендер выделенных 2-граней и 3-ячеек.
 *
 * Архитектура: единый Mesh с обновляемым BufferGeometry. На каждом
 * кадре мы перестраиваем триангуляцию активных граней (их обычно
 * мало — 1..50, не тысячи) и устанавливаем флаг needsUpdate.
 *
 * 2-грань → 1 четырёхугольник → 2 треугольника, 4 вершины.
 * 3-ячейка → 6 ограничивающих 2-граней → 12 треугольников, 24 вершины.
 *
 * Триангуляция 2-грани: вершины упорядочены так, чтобы образовать
 * простой выпуклый четырёхугольник. Для куба {-1, +1}ⁿ четыре
 * вершины 2-грани отличаются битами в позициях двух свободных осей.
 * Порядок обхода: (00, 01, 11, 10) по битам свободных осей. Это
 * даёт замкнутый цикл по периметру.
 */
export class FaceRenderer {
    maxQuads;
    positions;
    indices;
    colors;
    geometry;
    material;
    mesh;
    /** Текущее число активных четырёхугольников. */
    activeQuads = 0;
    constructor(_hypercube, maxQuads = 256) {
        this.maxQuads = maxQuads;
        this.positions = new Float32Array(maxQuads * 4 * 3);
        this.indices = new Uint32Array(maxQuads * 6);
        this.colors = new Float32Array(maxQuads * 4 * 3);
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
        this.material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide, // оставляем обе стороны — back-face culling делаем сами через knife-clip
            depthWrite: false,
            blending: THREE.NormalBlending
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
    }
    /** Альфа-канал заливки граней (0..1). */
    setOpacity(opacity) {
        this.material.opacity = opacity;
    }
    /**
     * Получить отсортированные вершины 2-грани в порядке обхода периметра.
     * Возвращает массив длины 4 — VertexId, идущие по циклу.
     */
    static orderedQuadVertices(face, hypercube) {
        if (face.dim !== 2) {
            throw new Error(`orderedQuadVertices: expected 2-face, got dim=${face.dim}`);
        }
        // Найти две свободные оси.
        const free = [];
        for (let i = 0; i < hypercube.n; i++) {
            if ((face.freeMask >> i) & 1)
                free.push(i);
        }
        if (free.length !== 2)
            throw new Error('Bad freeMask for 2-face');
        const [u, v] = free;
        const fixedMask = ((1 << hypercube.n) - 1) & ~face.freeMask;
        const baseVertex = face.fixedValues & fixedMask;
        // Обход (00, 01, 11, 10): по битам (u, v) свободных осей.
        return [
            baseVertex,
            baseVertex | (1 << v),
            baseVertex | (1 << v) | (1 << u),
            baseVertex | (1 << u)
        ];
    }
    /**
     * Обновить геометрию: задаём список четырёхугольников (вершины уже
     * спроецированы в 3D) с цветом каждого.
     */
    update(quads) {
        const count = Math.min(quads.length, this.maxQuads);
        for (let q = 0; q < count; q++) {
            const quad = quads[q];
            const base = q * 4 * 3;
            const indexBase = q * 6;
            for (let k = 0; k < 4; k++) {
                this.positions[base + k * 3 + 0] = quad.positions[k][0];
                this.positions[base + k * 3 + 1] = quad.positions[k][1];
                this.positions[base + k * 3 + 2] = quad.positions[k][2];
                this.colors[base + k * 3 + 0] = quad.color[0];
                this.colors[base + k * 3 + 1] = quad.color[1];
                this.colors[base + k * 3 + 2] = quad.color[2];
            }
            // Триангуляция: (0,1,2) и (0,2,3) — корректно для выпуклого
            // четырёхугольника с обходом по периметру.
            const v0 = q * 4;
            this.indices[indexBase + 0] = v0 + 0;
            this.indices[indexBase + 1] = v0 + 1;
            this.indices[indexBase + 2] = v0 + 2;
            this.indices[indexBase + 3] = v0 + 0;
            this.indices[indexBase + 4] = v0 + 2;
            this.indices[indexBase + 5] = v0 + 3;
        }
        this.activeQuads = count;
        this.geometry.setDrawRange(0, count * 6);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.geometry.index.needsUpdate = true;
    }
    /**
     * Граничные 2-грани заданной 3-ячейки.
     * 3-ячейка задаётся freeMask с popcount=3; её граница состоит
     * из 6 двумерных граней — по две на каждую свободную ось 3-ячейки
     * (зафиксированную в ±1).
     */
    static boundary2FacesOf3Cell(cell, hypercube) {
        if (cell.dim !== 3)
            throw new Error(`expected 3-cell, got dim=${cell.dim}`);
        const freeAxes = [];
        for (let i = 0; i < hypercube.n; i++) {
            if ((cell.freeMask >> i) & 1)
                freeAxes.push(i);
        }
        if (freeAxes.length !== 3)
            throw new Error('Bad freeMask for 3-cell');
        const out = [];
        for (const ax of freeAxes) {
            for (const sign of [0, 1]) {
                const newFreeMask = cell.freeMask & ~(1 << ax);
                const newFixedValues = (cell.fixedValues & ~(1 << ax)) | (sign << ax);
                out.push({ freeMask: newFreeMask, fixedValues: newFixedValues, dim: 2 });
            }
        }
        return out;
    }
    get currentQuadCount() {
        return this.activeQuads;
    }
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
