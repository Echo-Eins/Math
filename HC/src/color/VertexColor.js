/**
 * Окраска вершин по «координатному градиенту».
 *
 * Базовая идея: цвет несёт информацию о положении вершины во всех n
 * измерениях, чтобы при любом искажении проекцией пользователь
 * визуально различал «угол» куба.
 *
 * Схема:
 *   - Первые три координаты (x_1, x_2, x_3 в системе камеры)
 *     отображаются на RGB через линейное преобразование из [-1, 1]
 *     в [0.25, 1.0] — диапазон смещён в светлую часть, чтобы не было
 *     близких к чёрному цветов на тёмном фоне.
 *   - Остальные координаты (x_4..x_n) суммируются в «глубинную меру»
 *     и модулируют насыщенность через смешивание с серым.
 *
 * Возвращает три числа в [0, 1] — RGB.
 */
export function vertexColor(coordsInCamera) {
    const n = coordsInCamera.length;
    const map = (x) => 0.25 + 0.75 * (x * 0.5 + 0.5);
    let r = map(clamp11(coordsInCamera[0] ?? 0));
    let g = n >= 2 ? map(clamp11(coordsInCamera[1])) : 0.5;
    let b = n >= 3 ? map(clamp11(coordsInCamera[2])) : 0.5;
    // Глубинная мера: сумма квадратов высших координат, нормированная.
    if (n > 3) {
        let sumSq = 0;
        for (let i = 3; i < n; i++) {
            const x = clamp11(coordsInCamera[i]);
            sumSq += x * x;
        }
        // Максимум sumSq для куба {-1,+1}ⁿ равен n - 3.
        const depthNorm = sumSq / (n - 3);
        // Десатурация: 0 → без изменений, 1 → к серому (mid grey).
        const grey = 0.55;
        const t = 0.35 * depthNorm;
        r = r * (1 - t) + grey * t;
        g = g * (1 - t) + grey * t;
        b = b * (1 - t) + grey * t;
    }
    return [clamp01(r), clamp01(g), clamp01(b)];
}
/**
 * Цвет ребра — среднее цветов концевых вершин.
 */
export function edgeColor(v1Coords, v2Coords) {
    const c1 = vertexColor(v1Coords);
    const c2 = vertexColor(v2Coords);
    return [(c1[0] + c2[0]) * 0.5, (c1[1] + c2[1]) * 0.5, (c1[2] + c2[2]) * 0.5];
}
/**
 * Смешать цвет с предупреждающим красным в зависимости от margin до
 * сингулярности. margin → 0 ⇒ красный.
 *
 * threshold: расстояние, ниже которого начинается окраска (обычно ~10%
 * от характерной d). margin > threshold → возвращает исходный цвет.
 */
export function applyEventHorizon(color, margin, threshold) {
    if (!Number.isFinite(margin) || margin >= threshold)
        return color;
    const t = Math.max(0, Math.min(1, 1 - margin / threshold));
    // Линейная интерполяция к ярко-красному (1, 0.1, 0.05).
    const wr = t;
    return [
        color[0] * (1 - wr) + 1.0 * wr,
        color[1] * (1 - wr) + 0.1 * wr,
        color[2] * (1 - wr) + 0.05 * wr
    ];
}
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp11(x) {
    return x < -1 ? -1 : x > 1 ? 1 : x;
}
