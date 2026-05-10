import { HypercubeView } from './render/HypercubeView.js';
import { Controls } from './ui/Controls.js';

/**
 * Точка входа. Создаём canvas, инициализируем view, цикл анимации.
 *
 * Размерность задаётся через URL hash: index.html#n=10. Значение по
 * умолчанию — 4 (тессеракт), чтобы первый запуск был наглядным.
 */
function getDimensionFromURL(): number {
  const hash = window.location.hash;
  const match = hash.match(/n=(\d+)/);
  if (match) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 3 && n <= 12) return n;
  }
  return 4;
}

function main(): void {
  const n = getDimensionFromURL();
  document.title = `${n}-cube`;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;inset:0;display:flex;background:#0a0a0c;';
  document.body.appendChild(wrapper);

  const canvasContainer = document.createElement('div');
  canvasContainer.style.cssText = 'flex:1;position:relative;min-width:0;';
  wrapper.appendChild(canvasContainer);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  canvasContainer.appendChild(canvas);

  // Привести размер canvas к фактическому размеру контейнера до создания view.
  const fit = () => {
    canvas.width = canvasContainer.clientWidth;
    canvas.height = canvasContainer.clientHeight;
  };
  fit();

  const view = new HypercubeView(canvas, n);
  const controls = new Controls(view, wrapper);

  // Resize handling.
  window.addEventListener('resize', () => {
    fit();
    view.resize(canvas.clientWidth, canvas.clientHeight);
  });
  view.resize(canvas.clientWidth, canvas.clientHeight);

  // Anim loop.
  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    view.update(dt);
    controls.tick();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Доступ из консоли для отладки.
  (window as unknown as { view: HypercubeView }).view = view;
}

main();
