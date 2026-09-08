// Decides whether a rendered table needs to break out of the readable line
// width: when its natural (unwrapped) width exceeds the column, the host gets
// `is-wide` so CSS can let it grow towards the editor width and, failing that,
// scroll horizontally. Narrow tables keep their normal left-aligned layout.

export interface TableFitHandle {
  update(): void;
  dispose(): void;
}

export function fitTable(host: HTMLElement, wrapper: HTMLElement, table: HTMLElement): TableFitHandle {
  let raf = 0;
  const measure = () => {
    raf = 0;
    if (!host.isConnected) return;
    const column = host.clientWidth;
    if (!column) return;
    // The table is always laid out at its natural (max-content) width, so its box is the measurement.
    const natural = table.getBoundingClientRect().width;
    void wrapper;
    host.classList.toggle('is-wide', natural > column + 1);
    host.style.setProperty('--imark-table-natural-width', `${Math.ceil(natural)}px`);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  // Only re-measure when the column width changes; height changes (caused by our
  // own toggling) must not feed back into another measurement.
  let lastWidth = -1;
  const ro =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          const w = Math.round(entries[0]?.contentRect.width ?? host.clientWidth);
          if (w === lastWidth) return;
          lastWidth = w;
          schedule();
        })
      : null;
  ro?.observe(host);
  schedule();
  return {
    update: schedule,
    dispose() {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
