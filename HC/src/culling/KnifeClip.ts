import type { Face } from '../math/types.js';
import type { Camera } from '../math/Camera.js';

/**
 * n-мерный отбраковщик 2-граней методом «knife-clip».
 *
 * Идея: 2-грань n-куба фиксирует n − 2 координаты (по одной для
 * каждого зафиксированного измерения). Каждая фиксированная
 * координата задаёт гиперплоскость x_a = s_a, где s_a ∈ {−1, +1}.
 * Грань видна «снаружи» вдоль оси a, если камера лежит на той же
 * стороне, что и outward-сторона: (C[a] − s_a) · s_a > 0,
 * то есть C[a] · s_a > 1.
 *
 * Грань видна целиком, если она visible-outward по ВСЕМ своим
 * фиксированным координатам.
 *
 * Замечание: при камере ВНУТРИ куба (все |C[i]| < 1) ни одна грань
 * не пройдёт критерий. В этом случае cull-флагом можно отключить
 * отбраковку, чтобы видеть «внутренности» куба.
 */
export class KnifeClip {
  /**
   * Возвращает true, если 2-грань `face` должна быть отрисована
   * при текущем положении камеры.
   *
   * cube_n: размерность гиперкуба (чтобы знать длину camera.position).
   */
  static isVisible(face: Face, camera: Camera): boolean {
    if (face.dim !== 2) {
      // Knife-clip определён здесь для 2-граней; для произвольных
      // граней семантика «outward» вырождается. Возвращаем true
      // как разрешающее значение.
      return true;
    }
    const n = camera.n;
    const pos = camera.position;
    const { freeMask, fixedValues } = face;
    for (let a = 0; a < n; a++) {
      if ((freeMask >> a) & 1) continue; // свободная ось — пропускаем
      const s = ((fixedValues >> a) & 1) ? 1 : -1;
      // Грань видна вдоль оси a, если pos[a] * s > 1.
      if (pos[a] * s <= 1) return false;
    }
    return true;
  }

  /**
   * Удобный фильтр: вернуть массив граней, прошедших knife-clip.
   */
  static filter(faces: ReadonlyArray<Face>, camera: Camera): Face[] {
    const out: Face[] = [];
    for (const f of faces) {
      if (KnifeClip.isVisible(f, camera)) out.push(f);
    }
    return out;
  }

  /**
   * Камера «внутри» гиперкуба, если все её координаты по модулю меньше 1.
   * В этом режиме knife-clip имеет смысл отключить.
   */
  static cameraInsideCube(camera: Camera): boolean {
    const n = camera.n;
    for (let i = 0; i < n; i++) {
      if (Math.abs(camera.position[i]) >= 1) return false;
    }
    return true;
  }
}
