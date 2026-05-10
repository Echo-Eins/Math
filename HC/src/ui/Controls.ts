import type { HypercubeView } from '../render/HypercubeView.js';

/**
 * Контрольная панель.
 *
 * Эстетика — «инструментальная»: моноширинный шрифт, дискретные
 * значения, никаких градиентов. Сама сцена — главный визуальный
 * объект; панель только им управляет.
 *
 * Содержит секции:
 *   1. Depth Stack — слайдеры d_4..d_n + кнопка «Orthogonal toggle».
 *   2. Plane selector — n×n решётка для выбора активной плоскости.
 *   3. Rotation pad — область для drag-вращения в активной плоскости.
 *   4. Highlights — выделение 3-ячейки.
 *   5. Diagnostics — ошибка ортогональности, число вершин/рёбер.
 */
export class Controls {
  private readonly view: HypercubeView;
  readonly root: HTMLDivElement;
  private orthogonalToggles: HTMLInputElement[] = [];
  private depthSliders: HTMLInputElement[] = [];
  private depthValueLabels: HTMLSpanElement[] = [];
  private planeButtons: HTMLButtonElement[][] = [];
  private diagnosticsEl: HTMLPreElement;

  constructor(view: HypercubeView, mountTo: HTMLElement) {
    this.view = view;
    this.root = document.createElement('div');
    this.root.className = 'controls';
    mountTo.appendChild(this.root);

    this.injectStyles();
    this.buildHeader();
    this.buildDepthStack();
    this.buildPlaneSelector();
    this.buildRotationPad();
    this.buildHighlights();
    this.diagnosticsEl = this.buildDiagnostics();
  }

  private injectStyles(): void {
    if (document.getElementById('controls-styles')) return;
    const style = document.createElement('style');
    style.id = 'controls-styles';
    style.textContent = `
      .controls {
        position: absolute;
        top: 0; right: 0; bottom: 0;
        width: 320px;
        padding: 14px 16px;
        box-sizing: border-box;
        background: #0d0d10;
        color: #c8c8c8;
        font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.45;
        border-left: 1px solid #1f1f23;
        overflow-y: auto;
        user-select: none;
      }
      .controls h1 { font-size: 13px; margin: 0 0 4px; color: #f0f0f0; letter-spacing: 0.05em; }
      .controls h2 { font-size: 11px; margin: 14px 0 6px; color: #8a8a8a; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
      .controls .row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
      .controls .row label { flex: 0 0 38px; color: #b0b0b0; }
      .controls .row input[type="range"] { flex: 1; accent-color: #c4965a; }
      .controls .row .v { flex: 0 0 56px; text-align: right; font-variant-numeric: tabular-nums; color: #e0e0e0; }
      .controls .row .ortho-toggle { flex: 0 0 16px; cursor: pointer; }
      .controls .plane-grid { display: grid; gap: 1px; background: #1f1f23; padding: 1px; }
      .controls .plane-grid button {
        background: #161618;
        border: none;
        color: #555;
        font-family: inherit;
        font-size: 9px;
        padding: 0;
        aspect-ratio: 1;
        cursor: pointer;
        transition: background 0.1s;
      }
      .controls .plane-grid button:hover { background: #2a2a30; color: #aaa; }
      .controls .plane-grid button.active { background: #c4965a; color: #0d0d10; }
      .controls .plane-grid button.empty { cursor: default; background: #0d0d10; }
      .controls .plane-grid button.empty:hover { background: #0d0d10; color: #555; }
      .controls .rotation-pad {
        height: 80px;
        background: #161618;
        border: 1px solid #2a2a30;
        cursor: grab;
        position: relative;
        margin-top: 6px;
      }
      .controls .rotation-pad:active { cursor: grabbing; }
      .controls .rotation-pad .hint {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        color: #555; pointer-events: none;
      }
      .controls .btn {
        background: #1a1a1e; color: #d0d0d0;
        border: 1px solid #2a2a30; padding: 4px 10px;
        font-family: inherit; font-size: 11px; cursor: pointer;
        margin-right: 4px;
      }
      .controls .btn:hover { background: #25252b; }
      .controls pre { margin: 0; font-family: inherit; font-size: 10px; color: #888; }
      .controls .accent { color: #c4965a; }
      .controls input[type="checkbox"] { accent-color: #c4965a; cursor: pointer; }
    `;
    document.head.appendChild(style);
  }

  private buildHeader(): void {
    const n = this.view.hypercube.n;
    const h = document.createElement('h1');
    h.innerHTML = `n-cube ⟨n=<span class="accent">${n}</span>⟩`;
    this.root.appendChild(h);
    const sub = document.createElement('div');
    sub.style.color = '#666';
    sub.style.fontSize = '10px';
    sub.style.marginBottom = '4px';
    const vc = this.view.hypercube.vertexCount;
    const ec = this.view.hypercube.edgeCount;
    sub.textContent = `${vc} vertices, ${ec} edges, C(n,2)=${(n * (n - 1)) / 2} rotation planes`;
    this.root.appendChild(sub);
  }

  private buildDepthStack(): void {
    const n = this.view.hypercube.n;
    if (n < 4) return; // нет уровней проекции

    const header = document.createElement('h2');
    header.textContent = 'Depth Stack (d_i)';
    this.root.appendChild(header);

    for (let dim = 4; dim <= n; dim++) {
      const row = document.createElement('div');
      row.className = 'row';

      const label = document.createElement('label');
      label.innerHTML = `d<sub>${dim}</sub>`;
      row.appendChild(label);

      const ortho = document.createElement('input');
      ortho.type = 'checkbox';
      ortho.title = 'orthogonal: d=∞';
      ortho.className = 'ortho-toggle';
      ortho.addEventListener('change', () => {
        const proj = this.view.projection;
        if (ortho.checked) {
          proj.setDistance(dim, Infinity);
          slider.disabled = true;
          slider.style.opacity = '0.4';
          valueEl.textContent = '∞';
        } else {
          slider.disabled = false;
          slider.style.opacity = '1';
          const v = Number(slider.value);
          proj.setDistance(dim, v);
          valueEl.textContent = v.toFixed(2);
        }
      });
      this.orthogonalToggles.push(ortho);
      row.appendChild(ortho);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '1.5';
      slider.max = '15';
      slider.step = '0.05';
      slider.value = '5';
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        this.view.projection.setDistance(dim, v);
        valueEl.textContent = v.toFixed(2);
      });
      // Подсветка соответствующей оси при работе со слайдером.
      slider.addEventListener('mouseenter', () => {
        this.view.highlightedDepthSliderAxis = dim - 1; // ось с индексом dim-1
      });
      slider.addEventListener('mouseleave', () => {
        this.view.highlightedDepthSliderAxis = null;
      });
      this.depthSliders.push(slider);
      row.appendChild(slider);

      const valueEl = document.createElement('span');
      valueEl.className = 'v';
      valueEl.textContent = '5.00';
      this.depthValueLabels.push(valueEl);
      row.appendChild(valueEl);

      this.root.appendChild(row);
    }
  }

  private buildPlaneSelector(): void {
    const n = this.view.hypercube.n;
    if (n < 2) return;

    const header = document.createElement('h2');
    header.textContent = 'Rotation Plane';
    this.root.appendChild(header);

    const desc = document.createElement('div');
    desc.style.color = '#666';
    desc.style.fontSize = '10px';
    desc.style.marginBottom = '4px';
    desc.textContent = 'click cell (i,j) to activate plane Xᵢ Xⱼ';
    this.root.appendChild(desc);

    const grid = document.createElement('div');
    grid.className = 'plane-grid';
    grid.style.gridTemplateColumns = `repeat(${n + 1}, 1fr)`;
    this.root.appendChild(grid);

    // Заголовок: пустая верхняя левая ячейка, потом 0..n-1
    const corner = document.createElement('button');
    corner.className = 'empty';
    corner.disabled = true;
    grid.appendChild(corner);
    for (let j = 0; j < n; j++) {
      const head = document.createElement('button');
      head.className = 'empty';
      head.textContent = String(j);
      head.style.color = '#888';
      head.disabled = true;
      grid.appendChild(head);
    }

    // Строки
    for (let i = 0; i < n; i++) {
      this.planeButtons[i] = [];
      const head = document.createElement('button');
      head.className = 'empty';
      head.textContent = String(i);
      head.style.color = '#888';
      head.disabled = true;
      grid.appendChild(head);
      for (let j = 0; j < n; j++) {
        const cell = document.createElement('button');
        if (i >= j) {
          cell.className = 'empty';
          cell.disabled = true;
        } else {
          cell.textContent = '·';
          cell.addEventListener('click', () => {
            this.setActivePlane(i, j);
          });
        }
        grid.appendChild(cell);
        this.planeButtons[i][j] = cell;
      }
    }

    // Активируем (0, 1) по умолчанию.
    this.setActivePlane(0, 1);
  }

  private setActivePlane(i: number, j: number): void {
    this.view.activeRotationPlane = [i, j];
    for (let a = 0; a < this.view.hypercube.n; a++) {
      for (let b = 0; b < this.view.hypercube.n; b++) {
        const btn = this.planeButtons[a]?.[b];
        if (!btn) continue;
        btn.classList.remove('active');
        if (a === i && b === j) btn.classList.add('active');
      }
    }
  }

  private buildRotationPad(): void {
    const pad = document.createElement('div');
    pad.className = 'rotation-pad';
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'drag horizontally to rotate';
    pad.appendChild(hint);

    let dragging = false;
    let lastX = 0;
    pad.addEventListener('mousedown', (e) => {
      dragging = true;
      lastX = e.clientX;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      this.view.rotateActivePlane(dx * 0.01);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
    this.root.appendChild(pad);
  }

  private buildHighlights(): void {
    const header = document.createElement('h2');
    header.textContent = 'Highlights';
    this.root.appendChild(header);

    const row = document.createElement('div');
    const showBtn = document.createElement('button');
    showBtn.className = 'btn';
    showBtn.textContent = 'show 3-cell';
    showBtn.addEventListener('click', () => {
      const n = this.view.hypercube.n;
      if (n < 3) return;
      // Канонический выбор: оси 0, 1, 2 свободны, остальные +1.
      let freeMask = (1 << 0) | (1 << 1) | (1 << 2);
      if (n < 3) freeMask = (1 << n) - 1;
      const fixedMask = ((1 << n) - 1) & ~freeMask;
      this.view.highlightCellByFreeMask(freeMask, fixedMask); // все фиксированные = +1
    });
    row.appendChild(showBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn';
    clearBtn.textContent = 'clear';
    clearBtn.addEventListener('click', () => this.view.clearHighlights());
    row.appendChild(clearBtn);

    this.root.appendChild(row);

    // Toggles
    const cullRow = document.createElement('div');
    cullRow.className = 'row';
    cullRow.style.marginTop = '8px';
    const cullCb = document.createElement('input');
    cullCb.type = 'checkbox';
    cullCb.checked = this.view.cullingEnabled;
    cullCb.addEventListener('change', () => {
      this.view.cullingEnabled = cullCb.checked;
    });
    cullRow.appendChild(cullCb);
    const cullLabel = document.createElement('span');
    cullLabel.textContent = 'knife-clip culling';
    cullRow.appendChild(cullLabel);
    this.root.appendChild(cullRow);

    const horizonRow = document.createElement('div');
    horizonRow.className = 'row';
    const horizonCb = document.createElement('input');
    horizonCb.type = 'checkbox';
    horizonCb.checked = this.view.eventHorizonEnabled;
    horizonCb.addEventListener('change', () => {
      this.view.eventHorizonEnabled = horizonCb.checked;
    });
    horizonRow.appendChild(horizonCb);
    const horizonLabel = document.createElement('span');
    horizonLabel.textContent = 'event-horizon warning';
    horizonRow.appendChild(horizonLabel);
    this.root.appendChild(horizonRow);
  }

  private buildDiagnostics(): HTMLPreElement {
    const header = document.createElement('h2');
    header.textContent = 'Diagnostics';
    this.root.appendChild(header);

    const pre = document.createElement('pre');
    this.root.appendChild(pre);
    return pre;
  }

  /** Вызывается каждый кадр для обновления диагностического вывода. */
  tick(): void {
    const d = this.view.diagnostics();
    this.diagnosticsEl.textContent =
      `ortho err  ${d.orthoError.toExponential(2)}\n` +
      `vertices   ${d.vertexCount}\n` +
      `edges      ${d.edgeCount}\n` +
      `quads      ${d.activeQuads}`;
  }
}
