/**
 * Рекурсивная перспективная проекция ℝⁿ → ℝ³ с независимыми
 * фокусными расстояниями на каждом уровне.
 *
 * Формула одного шага (проекция d → d-1):
 *   Вход:  вектор v ∈ ℝᵈ (в системе камеры).
 *   Параметр: фокусное расстояние d_focal на этом уровне.
 *   Берём «глубокую» координату w = v[d-1].
 *   Проверка сингулярности: если d_focal + w ≤ ε, точка позади
 *     камеры на этом уровне → результат clipped.
 *   Масштаб: k = d_focal / (d_focal + w).
 *   Выход: вектор длины d-1, где new[i] = v[i] · k.
 *
 * Ортогональный режим: d_focal = +Infinity. Тогда k = 1 — просто
 * сбрасываем последнюю координату. Внимание: при identity-ориентации
 * камеры это коллапсирует структуру; нужен нетривиальный поворот
 * frame, чтобы высшие измерения «протекали» в видимые.
 *
 * Соглашение об индексации distances:
 *   distances[k] — фокус для уровня проекции (k+4) → (k+3).
 *   То есть distances[0] = d_4 (4→3), distances[1] = d_5 (5→4),
 *   ..., distances[n-4] = d_n (n→n-1).
 *   Длина массива = n - 3.
 */
export class Projection {
    n;
    /** distances[k] = d_{k+4}, k ∈ [0, n-4]. Значение +Infinity допустимо. */
    distances;
    /** Минимальный «зазор» d_focal + w до сингулярности на текущем кадре. */
    static EPSILON = 1e-6;
    constructor(n) {
        if (n < 3)
            throw new RangeError(`Projection needs n ≥ 3, got ${n}`);
        this.n = n;
        this.distances = new Float64Array(Math.max(0, n - 3));
        // По умолчанию умеренные дистанции, не ортогональные.
        for (let i = 0; i < this.distances.length; i++) {
            this.distances[i] = 5;
        }
    }
    /** Установить дистанцию для уровня projection (sourceDim → sourceDim-1). */
    setDistance(sourceDim, value) {
        if (sourceDim < 4 || sourceDim > this.n) {
            throw new RangeError(`sourceDim ${sourceDim} out of range [4, ${this.n}]`);
        }
        if (Number.isNaN(value) || value <= 0) {
            throw new RangeError(`Distance must be positive (or +Infinity), got ${value}`);
        }
        this.distances[sourceDim - 4] = value;
    }
    getDistance(sourceDim) {
        if (sourceDim < 4 || sourceDim > this.n) {
            throw new RangeError(`sourceDim ${sourceDim} out of range [4, ${this.n}]`);
        }
        return this.distances[sourceDim - 4];
    }
    /**
     * Спроецировать вектор в системе камеры v_cam ∈ ℝⁿ → ℝ³.
     * `v_cam` НЕ изменяется. Возвращает структуру с позицией,
     * флагом clipped, массивом глубин и минимальным margin.
     */
    projectVertex(v_cam) {
        const n = this.n;
        if (v_cam.length !== n) {
            throw new RangeError(`Expected ${n}D vector, got ${v_cam.length}D`);
        }
        // Локальный буфер; выделение не критично — вершин обычно ≤ 1024.
        // Если станет узким местом — можно pre-allocate в конструкторе.
        const v = new Float64Array(v_cam);
        const hiddenDepths = [];
        let minMargin = Infinity;
        let curDim = n;
        while (curDim > 3) {
            const w = v[curDim - 1];
            const d = this.distances[curDim - 4];
            hiddenDepths.push(w);
            if (Number.isFinite(d)) {
                const margin = d + w;
                if (margin < minMargin)
                    minMargin = margin;
                if (margin <= Projection.EPSILON) {
                    // Точка позади камеры на этом уровне.
                    return {
                        pos: [0, 0, 0],
                        clipped: true,
                        hiddenDepths,
                        minMargin: margin
                    };
                }
                const k = d / margin;
                for (let i = 0; i < curDim - 1; i++)
                    v[i] *= k;
            }
            // При d = Infinity просто отбрасываем координату без масштаба.
            curDim--;
        }
        return {
            pos: [v[0], v[1], v[2]],
            clipped: false,
            hiddenDepths,
            minMargin
        };
    }
    /**
     * Спроецировать ребро [V1, V2] (оба в системе камеры).
     *
     * Алгоритм: на каждом уровне (от n до 4) проверяем «глубокую»
     * координату обеих точек:
     *   - если обе ≤ -d_focal: ребро целиком за камерой → clipped.
     *   - если обе > -d_focal: проецируем обе точки через формулу
     *     k = d / (d + w).
     *   - иначе: интерполируем точку, оказавшуюся за камерой, к
     *     гиперплоскости w = -d_focal + ε (с небольшим зазором,
     *     чтобы k не взрывался), потом проецируем.
     *
     * Клиппинг производится в системе координат ТЕКУЩЕГО уровня —
     * между двумя последовательными уровнями отрезок остаётся
     * прямым в данной редуцированной системе (это приближение
     * к истинной проективной кривой, достаточное для визуализации
     * рёбер 1-куба).
     */
    projectEdge(v1_cam, v2_cam) {
        const n = this.n;
        if (v1_cam.length !== n || v2_cam.length !== n) {
            throw new RangeError(`Expected ${n}D edge endpoints, got ${v1_cam.length}D and ${v2_cam.length}D`);
        }
        const v1 = new Float64Array(v1_cam);
        const v2 = new Float64Array(v2_cam);
        const hidden1 = [];
        const hidden2 = [];
        let minMargin = Infinity;
        let curDim = n;
        let clipped1Frac = 0;
        let clipped2Frac = 0;
        while (curDim > 3) {
            const w1 = v1[curDim - 1];
            const w2 = v2[curDim - 1];
            const d = this.distances[curDim - 4];
            hidden1.push(w1);
            hidden2.push(w2);
            if (Number.isFinite(d)) {
                const margin1 = d + w1;
                const margin2 = d + w2;
                const safe = Projection.EPSILON;
                const behind1 = margin1 <= safe;
                const behind2 = margin2 <= safe;
                if (behind1 && behind2) {
                    return { result: null };
                }
                if (behind1 !== behind2) {
                    // Найти параметр t ∈ (0, 1), при котором interpolated[curDim-1] = -d + safe.
                    // На отрезке v1 → v2: w(t) = w1 + t(w2 - w1). w(t) = -d + safe → 
                    // t = (-d + safe - w1) / (w2 - w1).
                    const target = -d + safe;
                    const t = (target - w1) / (w2 - w1);
                    if (Number.isFinite(t) && t >= -Projection.EPSILON && t <= 1 + Projection.EPSILON) {
                        const tClamped = Math.min(1, Math.max(0, t));
                        // Сдвинуть «плохой» конец в точку (1 − t из противоположной стороны).
                        const inplaceLerp = (src, dst, alpha) => {
                            for (let i = 0; i < curDim; i++) {
                                dst[i] = src[i] + alpha * (dst[i] - src[i]);
                            }
                        };
                        if (behind1) {
                            // v1 ← v1 + t (v2 − v1)
                            inplaceLerp(v2, v1, 1 - tClamped);
                            clipped1Frac = Math.max(clipped1Frac, tClamped);
                        }
                        else {
                            // v2 ← v1 + t (v2 − v1)
                            inplaceLerp(v1, v2, tClamped);
                            clipped2Frac = Math.max(clipped2Frac, 1 - tClamped);
                        }
                    }
                    else {
                        // На границе — отбрасываем для безопасности.
                        return { result: null };
                    }
                }
                // Теперь обе точки впереди камеры: проецируем.
                const m1 = d + v1[curDim - 1];
                const m2 = d + v2[curDim - 1];
                const minM = Math.min(m1, m2);
                if (minM < minMargin)
                    minMargin = minM;
                hidden1[hidden1.length - 1] = v1[curDim - 1];
                hidden2[hidden2.length - 1] = v2[curDim - 1];
                const k1 = d / m1;
                const k2 = d / m2;
                for (let i = 0; i < curDim - 1; i++) {
                    v1[i] *= k1;
                    v2[i] *= k2;
                }
            }
            curDim--;
        }
        return {
            result: {
                pos1: [v1[0], v1[1], v1[2]],
                pos2: [v2[0], v2[1], v2[2]],
                hiddenDepths1: hidden1,
                hiddenDepths2: hidden2,
                minMargin,
                clippedFraction: Math.min(1, clipped1Frac + clipped2Frac)
            }
        };
    }
}
