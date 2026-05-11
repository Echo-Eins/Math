import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Hypercube } from '../math/Hypercube.js';
import { Camera as NDCamera } from '../math/Camera.js';
import { Projection } from '../math/Projection.js';
import { KnifeClip } from '../culling/KnifeClip.js';
import { vertexColor, edgeColor, applyEventHorizon } from '../color/VertexColor.js';
import { EdgeRenderer } from './EdgeRenderer.js';
import { FaceRenderer } from './FaceRenderer.js';
/**
 * Главный класс рендера: связывает математическое ядро с Three.js.
 *
 * Один кадр:
 *   1. Преобразуем все вершины гиперкуба в систему n-D камеры
 *      (mat-vec умножение M · (V − C)) — кэшируем в this.camFrameCoords.
 *   2. Рекурсивно проецируем для отрисовки рёбер (через projectEdge,
 *      с клиппингом и event-horizon-метаданными).
 *   3. Если есть подсвеченные грани/ячейки — проецируем их вершины.
 *   4. Записываем результат в BufferGeometry и render().
 *
 * Three.js камера — вторичная, она отвечает только за финальный шаг
 * 3D → 2D (на экран). По умолчанию это PerspectiveCamera с
 * OrbitControls, позволяющая пользователю «крутить» уже спроецированный
 * результат для лучшего восприятия глубины.
 */
export class HypercubeView {
    hypercube;
    ndCamera;
    projection;
    scene;
    threeCamera;
    renderer;
    controls;
    edgeRenderer;
    faceRenderer;
    /** Кеш: для каждой вершины — её координаты в системе n-D камеры. */
    camFrameCoords;
    /** Активная плоскость вращения. null = ни одной. */
    activeRotationPlane = null;
    /** «Глубинная» ось для дополнительного контроллера (scroll wheel). */
    activeDepthAxis = null;
    /** Как интерпретировать drag по canvas: как n-D поворот или как обычный 3D orbit. */
    canvasDragMode = 'nd';
    projectionPreset = 'readable';
    /** Подсвечивать рёбра, параллельные оси, при работе с d_axis-слайдером. */
    highlightedDepthSliderAxis = null;
    /** Выделенные 2-грани и 3-ячейки. */
    highlightedFaces = [];
    highlightedCells = [];
    /** Включён ли knife-clip для подсвеченных граней. */
    cullingEnabled = true;
    /** Включён ли event-horizon-предупреждение (красная окраска у сингулярности). */
    eventHorizonEnabled = true;
    /** Порог предупреждения о близости к сингулярности (относительно d_focal). */
    eventHorizonThresholdFactor = 0.15;
    /**
     * Параметр для авто-вращения камеры (если включено).
     * Скорость в радианах/секунду в плоскости (0, 1).
     */
    autoRotateSpeed = 0;
    constructor(canvas, n) {
        this.hypercube = new Hypercube(n);
        this.ndCamera = new NDCamera(n);
        this.projection = new Projection(n);
        this.activeDepthAxis = n > 3 ? n - 1 : null;
        // Стартовая «читаемая поза»: высшие измерения протекают в видимые.
        this.setProjectionPreset(n === 4 ? 'schlegel' : 'readable');
        // Three.js setup.
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0c);
        const aspect = canvas.clientWidth / canvas.clientHeight;
        this.threeCamera = new THREE.PerspectiveCamera(45, aspect, 0.01, 200);
        this.threeCamera.position.set(0, 0, 6);
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        this.controls = new OrbitControls(this.threeCamera, canvas);
        this.controls.enableDamping = true;
        this.controls.enableRotate = false;
        // Кеш буферов под координаты в системе камеры.
        this.camFrameCoords = new Array(this.hypercube.vertexCount);
        for (let v = 0; v < this.hypercube.vertexCount; v++) {
            this.camFrameCoords[v] = new Float64Array(n);
        }
        this.edgeRenderer = new EdgeRenderer(this.hypercube, this.renderer);
        this.scene.add(this.edgeRenderer.object);
        this.faceRenderer = new FaceRenderer(this.hypercube, 512);
        this.scene.add(this.faceRenderer.mesh);
    }
    /**
     * Перенести все вершины из мирового пространства в систему камеры.
     * Результат — в this.camFrameCoords.
     */
    updateCameraFrameCoords() {
        const vc = this.hypercube.vertexCount;
        for (let v = 0; v < vc; v++) {
            this.ndCamera.transformWorldToCamera(this.hypercube.coords(v), this.camFrameCoords[v]);
        }
    }
    /**
     * Главное обновление: пересчёт всей геометрии и render().
     * Вызывается каждый кадр.
     */
    update(_dtSeconds) {
        this.controls.update();
        if (this.autoRotateSpeed !== 0 && this.hypercube.n >= 2) {
            this.ndCamera.rotate(0, 1, this.autoRotateSpeed * _dtSeconds);
        }
        this.updateCameraFrameCoords();
        this.updateEdges();
        this.updateFaces();
        this.renderer.render(this.scene, this.threeCamera);
    }
    /** Перестроить геометрию рёбер. */
    updateEdges() {
        const proj = this.projection;
        const thresholdFactor = this.eventHorizonThresholdFactor;
        // Подсчёт характерной d_focal для масштабирования порога:
        let minD = Infinity;
        for (let i = 0; i < proj.distances.length; i++) {
            const d = proj.distances[i];
            if (Number.isFinite(d) && d < minD)
                minD = d;
        }
        const horizonThreshold = Number.isFinite(minD) ? minD * thresholdFactor : Infinity;
        this.edgeRenderer.updateFromCallback((edge) => {
            const w1 = this.camFrameCoords[edge.a];
            const w2 = this.camFrameCoords[edge.b];
            const er = proj.projectEdge(w1, w2);
            if (er.result === null)
                return null;
            let c1 = vertexColor(w1);
            let c2 = vertexColor(w2);
            if (this.eventHorizonEnabled && er.result.minMargin < horizonThreshold) {
                c1 = applyEventHorizon(c1, er.result.minMargin, horizonThreshold);
                c2 = applyEventHorizon(c2, er.result.minMargin, horizonThreshold);
            }
            return {
                p1: er.result.pos1,
                p2: er.result.pos2,
                c1,
                c2
            };
        });
        // Подсветка активной плоскости / глубинного слайдера.
        this.edgeRenderer.resetLinewidths();
        if (this.activeRotationPlane) {
            const [i, j] = this.activeRotationPlane;
            this.edgeRenderer.setAxisLinewidth(i, this.edgeRenderer.highlightLinewidth);
            this.edgeRenderer.setAxisLinewidth(j, this.edgeRenderer.highlightLinewidth);
        }
        if (this.activeDepthAxis !== null) {
            this.edgeRenderer.setAxisLinewidth(this.activeDepthAxis, this.edgeRenderer.highlightLinewidth * 0.8);
        }
        if (this.highlightedDepthSliderAxis !== null) {
            this.edgeRenderer.setAxisLinewidth(this.highlightedDepthSliderAxis, this.edgeRenderer.highlightLinewidth);
        }
    }
    /** Перестроить геометрию выделенных граней. */
    updateFaces() {
        const quads = [];
        // Собираем все 2-грани, подлежащие отрисовке.
        const all2Faces = [];
        all2Faces.push(...this.highlightedFaces);
        for (const cell of this.highlightedCells) {
            all2Faces.push(...FaceRenderer.boundary2FacesOf3Cell(cell, this.hypercube));
        }
        // Knife-clip.
        const filtered = this.cullingEnabled && !KnifeClip.cameraInsideCube(this.ndCamera)
            ? KnifeClip.filter(all2Faces, this.ndCamera)
            : all2Faces;
        for (const face of filtered) {
            const orderedVerts = FaceRenderer.orderedQuadVertices(face, this.hypercube);
            const positions = [];
            let valid = true;
            let avgColor = [0, 0, 0];
            for (const v of orderedVerts) {
                const w = this.camFrameCoords[v];
                const pr = this.projection.projectVertex(w);
                if (pr.clipped) {
                    valid = false;
                    break;
                }
                positions.push(pr.pos);
                const c = vertexColor(w);
                avgColor[0] += c[0] * 0.25;
                avgColor[1] += c[1] * 0.25;
                avgColor[2] += c[2] * 0.25;
            }
            if (valid) {
                quads.push({ positions, color: avgColor });
            }
        }
        this.faceRenderer.update(quads);
    }
    /** Изменить размер канвы. */
    resize(width, height) {
        this.renderer.setSize(width, height, false);
        this.threeCamera.aspect = width / height;
        this.threeCamera.updateProjectionMatrix();
        this.edgeRenderer.setResolution(width * window.devicePixelRatio, height * window.devicePixelRatio);
    }
    /** Высокоуровневые API для UI. */
    /** Применить инкрементальное вращение в активной плоскости. */
    rotateActivePlane(dTheta) {
        if (!this.activeRotationPlane)
            return;
        const [i, j] = this.activeRotationPlane;
        this.ndCamera.rotate(i, j, dTheta);
    }
    /**
     * Вертикальный drag смешивает выбранную глубинную ось с видимой осью z.
     * Для n=4 это дает ожидаемое "посмотреть под другим 4D углом" без ручного
     * выбора плоскости (2, 3) в сетке.
     */
    rotateDepthAxis(dTheta, visibleAxis = 2) {
        const depthAxis = this.activeDepthAxis;
        if (depthAxis === null || this.hypercube.n < 4)
            return;
        if (visibleAxis < 0 || visibleAxis >= this.hypercube.n || visibleAxis === depthAxis)
            return;
        this.ndCamera.rotate(visibleAxis, depthAxis, dTheta);
    }
    applyViewportDrag(dx, dy) {
        const scale = 0.01;
        if (dx !== 0)
            this.rotateActivePlane(dx * scale);
        if (dy !== 0)
            this.rotateDepthAxis(dy * scale);
    }
    setActiveDepthAxis(axis) {
        if (axis !== null && (axis < 0 || axis >= this.hypercube.n))
            return;
        this.activeDepthAxis = axis;
    }
    setCanvasDragMode(mode) {
        this.canvasDragMode = mode;
        this.controls.enableRotate = mode === 'orbit';
    }
    resetReadablePose() {
        this.setProjectionPreset('readable');
    }
    setProjectionPreset(preset) {
        this.projectionPreset = preset;
        this.ndCamera.setPosition(new Float64Array(this.hypercube.n));
        if (preset === 'schlegel') {
            this.ndCamera.resetOrientation();
            for (let dim = 4; dim <= this.hypercube.n; dim++) {
                this.projection.setDistance(dim, 1.55);
            }
            this.eventHorizonEnabled = true;
            return;
        }
        this.ndCamera.setReadablePose(Math.PI / 9);
        for (let dim = 4; dim <= this.hypercube.n; dim++) {
            this.projection.setDistance(dim, preset === 'orthographic' ? Infinity : 5);
        }
        this.eventHorizonEnabled = preset !== 'orthographic';
    }
    /** Установить выделение единственной 3-ячейки (по freeMask). */
    highlightCellByFreeMask(freeMask, fixedValues) {
        this.highlightedCells = [
            { freeMask, fixedValues, dim: 3 }
        ];
    }
    clearHighlights() {
        this.highlightedFaces = [];
        this.highlightedCells = [];
    }
    /** Для отладки/диагностики. */
    diagnostics() {
        return {
            orthoError: this.ndCamera.orthogonalityError(),
            vertexCount: this.hypercube.vertexCount,
            edgeCount: this.hypercube.edgeCount,
            activeQuads: this.faceRenderer.currentQuadCount
        };
    }
    dispose() {
        this.edgeRenderer.dispose();
        this.faceRenderer.dispose();
        this.renderer.dispose();
        this.controls.dispose();
    }
}
// Silence unused import in some configurations.
void edgeColor;
