import type { NDMatrix, NDVector } from './types.js';

/**
 * Утилиты для работы с n×n матрицами (row-major Float64Array).
 *
 * Применение: матрица ориентации камеры M ∈ O(n) — ортогональная,
 * строки которой суть базисные векторы камеры в мировых координатах.
 * Поворот в плоскости (i, j) на угол θ применяется как:
 *   M ← G_{i,j}(θ) · M
 * Это вращает i-ю и j-ю строки матрицы M (т.е. базисные векторы e_i, e_j):
 *   e_i_new = cos·e_i − sin·e_j
 *   e_j_new = sin·e_i + cos·e_j
 *
 * Преобразование мирового вектора в систему камеры: v_cam = M · v.
 * Обратно: v_world = Mᵀ · v_cam (M ортогональна).
 */

/** Создать единичную матрицу n×n. */
export function identity(n: number): NDMatrix {
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) M[i * n + i] = 1;
  return M;
}

/** Глубокая копия матрицы. */
export function cloneMatrix(M: NDMatrix): NDMatrix {
  return new Float64Array(M);
}

/**
 * Применить матрицу к вектору: out = M · v.
 * `out` и `v` могут совпадать НЕ должны (нужны отдельные буферы).
 */
export function applyMatrix(M: NDMatrix, n: number, v: NDVector, out: NDVector): void {
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) {
      s += M[row + j] * v[j];
    }
    out[i] = s;
  }
}

/**
 * Левое умножение M ← G_{i,j}(θ) · M.
 * Изменяет M на месте: вращает строки i и j в связке.
 * O(n) операций, не O(n²).
 */
export function applyGivensLeft(
  M: NDMatrix,
  n: number,
  i: number,
  j: number,
  theta: number
): void {
  if (i === j) return;
  if (i < 0 || i >= n || j < 0 || j >= n) {
    throw new RangeError(`Bad rotation plane (${i}, ${j}) in dimension ${n}`);
  }
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rowI = i * n;
  const rowJ = j * n;
  for (let k = 0; k < n; k++) {
    const a = M[rowI + k];
    const b = M[rowJ + k];
    M[rowI + k] = c * a - s * b;
    M[rowJ + k] = s * a + c * b;
  }
}

/**
 * Правое умножение M ← M · G_{i,j}(θ).
 * Изменяет M на месте: вращает столбцы i и j в связке.
 * Используется реже, в основном при тестах и сравнениях.
 */
export function applyGivensRight(
  M: NDMatrix,
  n: number,
  i: number,
  j: number,
  theta: number
): void {
  if (i === j) return;
  if (i < 0 || i >= n || j < 0 || j >= n) {
    throw new RangeError(`Bad rotation plane (${i}, ${j}) in dimension ${n}`);
  }
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  for (let k = 0; k < n; k++) {
    const a = M[k * n + i];
    const b = M[k * n + j];
    M[k * n + i] = c * a - s * b;
    M[k * n + j] = s * a + c * b;
  }
}

/**
 * Модифицированный процесс Грама-Шмидта по строкам.
 * После многократного применения вращений Гивенса с float64 матрица
 * незначительно теряет ортогональность; вызов раз в N кадров возвращает
 * её на многообразие O(n) без существенных искажений геометрии.
 *
 * Ошибки: если какая-то строка стала вырожденной (norm ≈ 0),
 * бросаем Error. На практике этого не должно случаться при штатных
 * вращениях, но даём явный сигнал, если случилось.
 */
export function reorthogonalize(M: NDMatrix, n: number): void {
  for (let i = 0; i < n; i++) {
    const rowI = i * n;
    let norm2 = 0;
    for (let k = 0; k < n; k++) norm2 += M[rowI + k] * M[rowI + k];
    const norm = Math.sqrt(norm2);
    if (norm < 1e-12) {
      throw new Error(`Degenerate basis vector at row ${i} during reorthogonalization`);
    }
    const inv = 1 / norm;
    for (let k = 0; k < n; k++) M[rowI + k] *= inv;
    for (let r = i + 1; r < n; r++) {
      const rowR = r * n;
      let dot = 0;
      for (let k = 0; k < n; k++) dot += M[rowI + k] * M[rowR + k];
      for (let k = 0; k < n; k++) M[rowR + k] -= dot * M[rowI + k];
    }
  }
}

/**
 * Численная оценка отклонения от ортогональности:
 *   ||MMᵀ − I||_F (норма Фробениуса).
 * 0 ⇒ ортогональна. Используется как метрика для триггера реортогонализации.
 */
export function orthogonalityError(M: NDMatrix, n: number): number {
  let err = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let dot = 0;
      for (let k = 0; k < n; k++) dot += M[i * n + k] * M[j * n + k];
      const expected = i === j ? 1 : 0;
      const d = dot - expected;
      err += d * d;
    }
  }
  return Math.sqrt(err);
}

/**
 * Скопировать вектор: out ← v.
 */
export function copyVector(v: NDVector, out: NDVector): void {
  out.set(v);
}

/**
 * Вычесть: out ← a − b.
 */
export function subVector(a: NDVector, b: NDVector, out: NDVector): void {
  const n = a.length;
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
}
