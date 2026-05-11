/**
 * Комбинаторная и геометрическая модель n-куба в {-1, +1}ⁿ.
 *
 * Главное свойство: все запросы (вершины, рёбра, грани любой размерности,
 * соседи, инцидентность) реализованы строго через битовые операции над
 * индексами вершин. Никаких float-сравнений в структурных запросах —
 * чтобы геометрия и топология были строго сохранены и могли быть
 * использованы для теоретико-множественных представлений.
 *
 * Вершина v ∈ [0, 2ⁿ): бит i задаёт знак i-й координаты.
 *   coord(v, i) = (v >> i) & 1 ? +1 : -1
 *
 * Ребро (a, b): a < b, a ⊕ b = 2^axis для единственного axis.
 *
 * k-грань: подмножество вершин, у которых n - k координат зафиксированы.
 */
export class Hypercube {
    n;
    vertexCount;
    edgeCount;
    /** Координаты вершины i в виде Float64Array длины n. */
    vertexCoords;
    /** Все рёбра, отсортированы лексикографически по (a, b). */
    edges;
    /**
     * edgesByAxis[i] — массив рёбер, параллельных оси i.
     * Используется для подсветки рёбер при работе со слайдером d_i
     * или с активной плоскостью.
     */
    edgesByAxis;
    /**
     * Список соседей каждой вершины (n штук на вершину).
     * neighbors[v][i] = v ⊕ (1 << i) — сосед по i-й оси.
     */
    neighbors;
    constructor(n) {
        if (!Number.isInteger(n) || n < 1 || n > 16) {
            throw new RangeError(`Hypercube dimension must be integer in [1, 16], got ${n}`);
        }
        this.n = n;
        this.vertexCount = 1 << n;
        this.edgeCount = n * (1 << (n - 1));
        // Координаты: vertex i, координата j → ((i >> j) & 1) ? +1 : -1
        this.vertexCoords = new Array(this.vertexCount);
        for (let v = 0; v < this.vertexCount; v++) {
            const coords = new Float64Array(n);
            for (let j = 0; j < n; j++) {
                coords[j] = ((v >> j) & 1) ? 1 : -1;
            }
            this.vertexCoords[v] = coords;
        }
        // Рёбра: для каждой вершины v, для каждой оси i — если бит i = 0,
        // то (v, v | (1 << i)) — ребро по оси i. Это даёт каждое ребро ровно один раз.
        const edges = [];
        const edgesByAxis = Array.from({ length: n }, () => []);
        for (let v = 0; v < this.vertexCount; v++) {
            for (let i = 0; i < n; i++) {
                if (((v >> i) & 1) === 0) {
                    const e = { a: v, b: v | (1 << i), axis: i };
                    edges.push(e);
                    edgesByAxis[i].push(e);
                }
            }
        }
        this.edges = edges;
        this.edgesByAxis = edgesByAxis;
        // Соседи
        const neighbors = new Array(this.vertexCount);
        for (let v = 0; v < this.vertexCount; v++) {
            const row = new Array(n);
            for (let i = 0; i < n; i++)
                row[i] = v ^ (1 << i);
            neighbors[v] = row;
        }
        this.neighbors = neighbors;
    }
    /** Координаты вершины (НЕ копия — не модифицировать снаружи). */
    coords(v) {
        return this.vertexCoords[v];
    }
    /** Копия координат вершины. */
    coordsCopy(v) {
        return new Float64Array(this.vertexCoords[v]);
    }
    /**
     * Перечислить все k-грани (0 ≤ k ≤ n).
     * 0-грани = вершины, 1-грани = рёбра, n-грань = весь куб.
     * Возвращает массив длины C(n, k) · 2^(n - k).
     */
    faces(k) {
        if (!Number.isInteger(k) || k < 0 || k > this.n) {
            throw new RangeError(`face dimension k must be in [0, ${this.n}], got ${k}`);
        }
        const n = this.n;
        const out = [];
        // Перебираем все подмножества {0..n-1} мощности k.
        for (const freeMask of subsetsOfSize(n, k)) {
            const fixedMask = ((1 << n) - 1) & ~freeMask;
            // Перебираем все возможные значения фиксированных координат.
            // Это значения битов внутри fixedMask. Удобно — итерация
            // по подмножествам fixedMask.
            for (const fixedValues of subsetsOf(fixedMask)) {
                out.push({ freeMask, fixedValues, dim: k });
            }
        }
        return out;
    }
    /**
     * Множество вершин k-грани. Возвращает 2^k индексов.
     * Реализация: фиксированные биты вершины = биты fixedValues в позициях fixedMask;
     * свободные биты пробегают все 2^k комбинаций внутри freeMask.
     */
    faceVertices(face) {
        const { freeMask, fixedValues } = face;
        const fixedMask = ((1 << this.n) - 1) & ~freeMask;
        const baseVertex = fixedValues & fixedMask;
        const out = [];
        for (const subset of subsetsOf(freeMask)) {
            out.push(baseVertex | subset);
        }
        return out;
    }
    /**
     * Удобный конструктор грани по списку (axis, value) пар.
     * Например face({1: +1, 3: -1}) в 4-кубе даёт 2-грань с x₁=+1, x₃=-1,
     * x₀ и x₂ свободны.
     */
    buildFace(fixed) {
        let freeMask = ((1 << this.n) - 1) >>> 0;
        let fixedValues = 0;
        for (const [axisStr, val] of Object.entries(fixed)) {
            const axis = Number(axisStr);
            if (!Number.isInteger(axis) || axis < 0 || axis >= this.n) {
                throw new RangeError(`Bad axis ${axis}`);
            }
            freeMask &= ~(1 << axis);
            if (val === 1)
                fixedValues |= (1 << axis);
        }
        const dim = popcount(freeMask);
        return { freeMask, fixedValues, dim };
    }
}
/** Population count для 32-битных целых. */
export function popcount(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >>> 24;
}
/**
 * Перебор всех подмножеств заданной маски, представленных как биты.
 * Классический трюк: subset = (subset - 1) & mask пробегает подмножества
 * в убывающем порядке. Возвращаем их через генератор.
 *
 * Особый случай: пустое множество (subset = 0) тоже включается.
 */
export function* subsetsOf(mask) {
    // Сначала пустое подмножество.
    yield 0;
    if (mask === 0)
        return;
    let subset = mask;
    while (true) {
        yield subset;
        if (subset === 0)
            break;
        subset = (subset - 1) & mask;
        if (subset === mask)
            break; // защита от зацикливания (не должна срабатывать)
        if (subset === 0) {
            // 0 уже выдали в начале — выходим
            break;
        }
    }
}
/**
 * Все подмножества множества {0..n-1} мощности ровно k.
 * Возвращает битовые маски. Реализация: лексикографический перебор
 * комбинаций через trick Гослера.
 */
export function* subsetsOfSize(n, k) {
    if (k < 0 || k > n)
        return;
    if (k === 0) {
        yield 0;
        return;
    }
    let mask = (1 << k) - 1;
    const limit = 1 << n;
    while (mask < limit) {
        yield mask;
        // Gosper's hack: next combination with same popcount
        const c = mask & -mask;
        const r = mask + c;
        mask = (((r ^ mask) >>> 2) / c) | r;
    }
}
