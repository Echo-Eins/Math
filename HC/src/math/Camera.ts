import type { NDMatrix, NDVector } from './types.js';
import {
  identity,
  applyMatrix,
  applyGivensLeft,
  reorthogonalize,
  orthogonalityError,
  subVector
} from './Givens.js';

/**
 * n-мерная камера.
 *
 * Состояние:
 *   - position ∈ ℝⁿ: точка обзора в мировых координатах.
 *   - frame ∈ O(n): ортонормальный базис, строки = базисные векторы
 *     в мировых координатах. Строка n-1 (frame[n-1]) интерпретируется
 *     как «направление взгляда» в собственной системе камеры —
 *     именно вдоль этой оси выполняется первый шаг рекурсивной
 *     проекции (n → n-1).
 *
 * Преобразование мирового вектора в систему камеры:
 *   v_cam[i] = frame[i] · (v_world − position)
 *
 * Вращение камеры в плоскости (i, j) на дельта-угол dθ:
 *   frame ← G_{i,j}(dθ) · frame
 * Это инкрементальная операция: pad-контроллер в UI выдаёт серию
 * мелких dθ при перетаскивании.
 */
export class Camera {
  readonly n: number;
  readonly position: NDVector;
  readonly frame: NDMatrix;

  /**
   * Счётчик вращений с момента последней реортогонализации.
   * Когда превышает порог — вызываем reorthogonalize.
   */
  private opsSinceReortho = 0;
  private readonly reorthoThreshold = 200;
  private readonly errorThreshold = 1e-6;

  /** Временные буферы, чтобы не выделять память на каждый вызов transformWorldToCamera. */
  private readonly tmpCenteredBuffer: NDVector;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 3 || n > 16) {
      throw new RangeError(`Camera dimension must be in [3, 16], got ${n}`);
    }
    this.n = n;
    this.position = new Float64Array(n);
    this.frame = identity(n);
    this.tmpCenteredBuffer = new Float64Array(n);
  }

  /**
   * Сместить камеру в её собственной системе: position ← position + Σ delta[i] · frame[i].
   * То есть delta — смещение в координатах камеры. Это и есть «WASD в n-мерности».
   */
  moveLocal(delta: NDVector): void {
    if (delta.length !== this.n) {
      throw new Error(`Expected delta of length ${this.n}, got ${delta.length}`);
    }
    for (let i = 0; i < this.n; i++) {
      const d = delta[i];
      if (d === 0) continue;
      const row = i * this.n;
      for (let k = 0; k < this.n; k++) {
        this.position[k] += d * this.frame[row + k];
      }
    }
  }

  /** Установить позицию явно в мировых координатах. */
  setPosition(pos: NDVector): void {
    if (pos.length !== this.n) {
      throw new Error(`Expected position of length ${this.n}`);
    }
    this.position.set(pos);
  }

  /**
   * Применить инкрементальное вращение в плоскости (i, j) на угол dθ.
   * Внутреннее ведение счётчика — для автоматической реортогонализации.
   */
  rotate(i: number, j: number, dTheta: number): void {
    if (dTheta === 0) return;
    applyGivensLeft(this.frame, this.n, i, j, dTheta);
    this.opsSinceReortho++;
    if (this.opsSinceReortho >= this.reorthoThreshold) {
      this.checkAndReorthogonalize();
    }
  }

  /**
   * Принудительно вызвать реортогонализацию, если ошибка
   * превышает порог.
   */
  checkAndReorthogonalize(): void {
    const err = orthogonalityError(this.frame, this.n);
    if (err > this.errorThreshold) {
      reorthogonalize(this.frame, this.n);
    }
    this.opsSinceReortho = 0;
  }

  /** Текущая ошибка ортогональности (для диагностики в UI). */
  orthogonalityError(): number {
    return orthogonalityError(this.frame, this.n);
  }

  /**
   * Преобразовать мировой вектор в систему камеры.
   *   out ← frame · (v_world − position)
   * `out` и `v` должны быть разными буферами.
   */
  transformWorldToCamera(v: NDVector, out: NDVector): void {
    subVector(v, this.position, this.tmpCenteredBuffer);
    applyMatrix(this.frame, this.n, this.tmpCenteredBuffer, out);
  }

  /**
   * Сбросить ориентацию в identity, но сохранить позицию.
   */
  resetOrientation(): void {
    this.frame.set(identity(this.n));
    this.opsSinceReortho = 0;
  }

  /**
   * Установить «читаемую» стартовую ориентацию: одинаковые малые
   * углы во всех плоскостях (i, i+1), чтобы все оси «протекали»
   * в видимые координаты. Без этого orthographic-проекция при
   * d_i = ∞ коллапсирует.
   *
   * angle ≈ π/8 — компромисс: видны все измерения, но без хаоса.
   */
  setReadablePose(angle: number = Math.PI / 8): void {
    this.resetOrientation();
    for (let i = 0; i < this.n - 1; i++) {
      applyGivensLeft(this.frame, this.n, i, i + 1, angle);
    }
    this.checkAndReorthogonalize();
  }
}
