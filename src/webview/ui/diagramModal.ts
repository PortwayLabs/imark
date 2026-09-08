// Full-screen preview for diagrams (Obsidian-style modal) with zoom and pan.
import { svgIconElement } from '../render/icons';

export function openDiagramPreview(svgMarkup: string, title = 'Diagram'): void {
  document.querySelector('.imark-diagram-modal')?.remove();
  const container = document.createElement('div');
  container.className = 'modal-container mod-dim imark-diagram-modal';
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.style.opacity = '0.85';
  const modal = document.createElement('div');
  modal.className = 'modal mod-imark-diagram';
  const close = document.createElement('div');
  close.className = 'modal-close-button';
  close.setAttribute('aria-label', 'Close');
  const header = document.createElement('div');
  header.className = 'modal-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.textContent = title;
  const toolbar = document.createElement('div');
  toolbar.className = 'imark-diagram-toolbar';
  const content = document.createElement('div');
  content.className = 'modal-content imark-diagram-viewport';
  const canvas = document.createElement('div');
  canvas.className = 'imark-diagram-canvas';
  canvas.innerHTML = svgMarkup;
  content.appendChild(canvas);
  header.append(titleEl, toolbar);
  modal.append(close, header, content);
  container.append(bg, modal);
  document.body.appendChild(container);

  const svg = canvas.querySelector('svg');
  let baseW = 800;
  let baseH = 600;
  if (svg) {
    const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      baseW = vb[2];
      baseH = vb[3];
    } else {
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) {
        baseW = r.width;
        baseH = r.height;
      }
    }
    svg.removeAttribute('style');
    svg.setAttribute('width', String(baseW));
    svg.setAttribute('height', String(baseH));
    svg.style.maxWidth = 'none';
    svg.style.display = 'block';
  }

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'imark-diagram-zoom';
  const apply = () => {
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };
  const actualSize = () => {
    scale = 1;
    tx = (content.clientWidth - baseW) / 2;
    ty = (content.clientHeight - baseH) / 2;
    apply();
  };
  const fit = () => {
    const vw = content.clientWidth - 32;
    const vh = content.clientHeight - 32;
    scale = Math.min(vw / baseW, vh / baseH, 2.5);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    tx = (content.clientWidth - baseW * scale) / 2;
    ty = (content.clientHeight - baseH * scale) / 2;
    apply();
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = Math.min(8, Math.max(0.1, scale * factor));
    const k = next / scale;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    scale = next;
    apply();
  };
  const center = () => ({ x: content.clientWidth / 2, y: content.clientHeight / 2 });

  const button = (icon: string | null, label: string, onClick: () => void, text?: string) => {
    const b = document.createElement('button');
    b.className = 'clickable-icon imark-diagram-button';
    b.setAttribute('aria-label', label);
    b.title = label;
    if (icon) b.appendChild(svgIconElement(icon));
    if (text) b.append(text);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  toolbar.append(
    button(null, 'Zoom out (-)', () => zoomAt(1 / 1.25, center().x, center().y), '-'),
    zoomLabel,
    button(null, 'Zoom in (+)', () => zoomAt(1.25, center().x, center().y), '+'),
    button(null, 'Actual size (1)', actualSize, '1:1'),
    button(null, 'Fit to window (0)', fit, 'Fit'),
    button('copy', 'Copy SVG', () => {
      navigator.clipboard?.writeText(svgMarkup).then(() => {
        titleEl.textContent = `${title} (SVG copied)`;
        setTimeout(() => (titleEl.textContent = title), 1200);
      });
    }),
  );

  // Pan by dragging, zoom with the wheel / pinch, double-click to zoom in.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  }
  function onUp() {
    dragging = false;
    content.classList.remove('is-dragging');
  }
  content.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    content.classList.add('is-dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  content.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = content.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.002));
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );
  content.addEventListener('dblclick', (e) => {
    const rect = content.getBoundingClientRect();
    zoomAt(1.5, e.clientX - rect.left, e.clientY - rect.top);
  });

  function destroy() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey, true);
    container.remove();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      destroy();
    } else if (e.key === '+' || e.key === '=') zoomAt(1.25, center().x, center().y);
    else if (e.key === '-') zoomAt(1 / 1.25, center().x, center().y);
    else if (e.key === '0') fit();
    else if (e.key === '1') actualSize();
  }
  window.addEventListener('keydown', onKey, true);
  bg.addEventListener('click', destroy);
  close.addEventListener('click', destroy);
  container.setAttribute('tabindex', '-1');
  container.focus();
  requestAnimationFrame(fit);
}
