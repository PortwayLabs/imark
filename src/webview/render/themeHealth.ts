// Runtime theme health check. After a theme's stylesheets have loaded, measure the
// visible editor / reading view and detect the ways a theme can make a note
// unusable in iMark: content squeezed to a sliver or pushed out of view, absurd
// font sizes, hidden text, text with (almost) the background colour. Each problem
// maps to a `body.imark-repair-*` class whose rules live in media/css/imark-guard.css.

export type ThemeProblemKind = 'load' | 'layout' | 'width' | 'font' | 'visibility' | 'contrast';

export interface ThemeProblem {
  kind: ThemeProblemKind;
  detail: string;
}

export interface HealthReport {
  problems: ThemeProblem[];
  /** Repair classes that were applied (and fixed the problem). */
  repaired: ThemeProblemKind[];
  /** Problems that are still present after repairing. */
  remaining: ThemeProblem[];
}

const REPAIRABLE: ThemeProblemKind[] = ['width', 'font', 'visibility', 'contrast'];

export function clearRepairs(body: HTMLElement = document.body): void {
  for (const k of REPAIRABLE) body.classList.remove(`imark-repair-${k}`);
  body.style.removeProperty('--imark-repair-text');
}

/** Resolve when every stylesheet link has loaded or failed (bounded by `timeout`); returns the failed hrefs. */
export function waitForStylesheets(links: HTMLLinkElement[], timeout = 4000): Promise<string[]> {
  const failed: string[] = [];
  const one = (link: HTMLLinkElement) =>
    new Promise<void>((resolve) => {
      if (link.sheet) return resolve();
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeout);
      link.addEventListener('load', done, { once: true });
      link.addEventListener(
        'error',
        () => {
          failed.push(link.href);
          done();
        },
        { once: true },
      );
    });
  return Promise.all(links.map(one)).then(() => failed);
}

// ---- colour helpers ----------------------------------------------------------------------

type RGBA = [number, number, number, number];

export function parseColor(value: string): RGBA | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i.exec(value);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith('%')) a /= 100;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
}

function luminance([r, g, b]: RGBA): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite `top` over `bottom` (alpha blending). */
function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

/** The colour actually painted behind `el`: blend semi-transparent backgrounds up to the root. */
function effectiveBackground(el: Element, dark: boolean): RGBA {
  const layers: RGBA[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0) {
      layers.push(c);
      if (c[3] >= 1) break;
    }
  }
  let bg: RGBA = dark ? [30, 30, 30, 1] : [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
  return bg;
}

// ---- the check ------------------------------------------------------------------------------

export interface HealthTargets {
  /** The visible view: `.markdown-source-view` or `.markdown-preview-view`. */
  container: HTMLElement;
  /** The element holding the text column (`.cm-content` / `.markdown-preview-sizer`). */
  content: HTMLElement | null;
  /** A representative text element (first non-empty line / paragraph), if any. */
  sample: HTMLElement | null;
  dark: boolean;
}

export function inspect(t: HealthTargets): ThemeProblem[] {
  const problems: ThemeProblem[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const box = t.container.getBoundingClientRect();
  if (vw >= 300 && vh >= 200 && (box.width < 120 || box.height < 60)) {
    problems.push({ kind: 'layout', detail: `the editor area is ${Math.round(box.width)}×${Math.round(box.height)}px` });
    return problems; // nothing else can be measured meaningfully
  }
  if (t.content) {
    const cr = t.content.getBoundingClientRect();
    const minWidth = Math.min(240, box.width * 0.4);
    if (cr.width < minWidth) problems.push({ kind: 'width', detail: `the text column is only ${Math.round(cr.width)}px wide` });
    else if (cr.left < box.left - 4 || cr.left > box.right - minWidth) problems.push({ kind: 'width', detail: 'the text column is pushed out of view' });
  }
  const sample = t.sample ?? t.content;
  if (sample) {
    const cs = getComputedStyle(sample);
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight);
    if (size < 9 || size > 40) problems.push({ kind: 'font', detail: `the text size is ${Math.round(size)}px` });
    else if (lh && lh < size * 0.8) problems.push({ kind: 'font', detail: 'lines overlap (line height too small)' });
    const hidden = cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.2 || cs.display === 'none' || (t.sample && t.sample.getBoundingClientRect().height === 0);
    let ancestorHidden = false;
    for (let n: HTMLElement | null = sample; n && n !== t.container.parentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (parseFloat(s.opacity) < 0.2 || s.display === 'none') ancestorHidden = true;
    }
    if (hidden || ancestorHidden) problems.push({ kind: 'visibility', detail: 'the note text is hidden' });
    const fg = parseColor(cs.color);
    if (fg && t.sample) {
      const bg = effectiveBackground(sample, t.dark);
      const ratio = contrastRatio(over(fg, bg), bg);
      if (ratio < 1.6) problems.push({ kind: 'contrast', detail: `text and background have almost the same colour (contrast ${ratio.toFixed(2)}:1)` });
    }
  }
  return problems;
}

/**
 * Inspect, apply repair classes for repairable problems and inspect again. Repair
 * classes already present (from another view mode) are kept; classes added here
 * that did not help are removed again so they cannot make things worse.
 */
export function checkAndRepair(getTargets: () => HealthTargets, body: HTMLElement = document.body): HealthReport {
  const problems = inspect(getTargets());
  const kinds = [...new Set(problems.filter((p) => REPAIRABLE.includes(p.kind)).map((p) => p.kind))];
  if (!kinds.length) return { problems, repaired: [], remaining: problems };
  const added = kinds.filter((k) => !body.classList.contains(`imark-repair-${k}`));
  for (const k of added) body.classList.add(`imark-repair-${k}`);
  if (kinds.includes('contrast')) {
    const t = getTargets();
    const bg = effectiveBackground(t.sample ?? t.container, t.dark);
    body.style.setProperty('--imark-repair-text', luminance(bg) > 0.4 ? '#1f1f1f' : '#e8e8e8');
  }
  const remaining = inspect(getTargets());
  const still = new Set(remaining.map((p) => p.kind));
  for (const k of added) if (still.has(k)) body.classList.remove(`imark-repair-${k}`);
  return { problems, repaired: kinds.filter((k) => !still.has(k)), remaining };
}
