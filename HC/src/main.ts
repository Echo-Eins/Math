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
    if (Number.isInteger(n)) return clampDimension(n);
  }
  return 4;
}

function clampDimension(n: number): number {
  return Math.max(3, Math.min(12, Math.trunc(n)));
}

function writeDimensionToURL(n: number): void {
  const url = new URL(window.location.href);
  url.hash = `n=${n}`;
  window.history.replaceState(null, '', url);
}

function main(): void {
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
    canvas.width = Math.max(1, canvasContainer.clientWidth);
    canvas.height = Math.max(1, canvasContainer.clientHeight);
  };
  fit();

  let view: HypercubeView | null = null;
  let controls: Controls | null = null;

  const createScene = (n: number): void => {
    document.title = `${n}-cube`;
    fit();
    view = new HypercubeView(canvas, n);
    controls = new Controls(view, wrapper, {
      onDimensionChange: rebuildScene
    });
    view.resize(canvas.clientWidth, canvas.clientHeight);
    (window as unknown as { view: HypercubeView }).view = view;
  };

  const rebuildScene = (nextDimension: number): void => {
    const n = clampDimension(nextDimension);
    if (view?.hypercube.n === n) return;
    controls?.dispose();
    view?.dispose();
    writeDimensionToURL(n);
    createScene(n);
  };

  createScene(getDimensionFromURL());

  // Resize handling.
  window.addEventListener('resize', () => {
    fit();
    view?.resize(canvas.clientWidth, canvas.clientHeight);
  });

  // Anim loop.
  let last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    view?.update(dt);
    controls?.tick();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
