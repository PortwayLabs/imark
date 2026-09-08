// Lazy-loaded Mermaid renderer with a result cache and light/dark theming.
type Mermaid = typeof import('mermaid').default;

let loader: Promise<Mermaid> | null = null;
let dark = document.body.classList.contains('theme-dark');
let themeKey = dark ? 'dark' : 'light';
let counter = 0;
const cache = new Map<string, Promise<MermaidResult>>();
const MAX_CACHE = 200;

export type MermaidResult = { svg: string; error?: undefined } | { svg?: undefined; error: string };

function fontFamily(): string {
  return getComputedStyle(document.body).getPropertyValue('--font-text').trim() || 'sans-serif';
}

function configure(m: Mermaid): void {
  m.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: fontFamily(),
    logLevel: 5,
    suppressErrorRendering: true,
    flowchart: { htmlLabels: true },
  });
}

export function getMermaid(): Promise<Mermaid> {
  if (!loader) {
    loader = import('mermaid').then((mod) => {
      const m = mod.default;
      configure(m);
      return m;
    });
  }
  return loader;
}

export function mermaidThemeKey(): string {
  return themeKey;
}

/** Call when the light/dark class changes. Resolves to true when the theme actually changed. */
export async function setMermaidDark(isDark: boolean): Promise<boolean> {
  if (isDark === dark) return false;
  dark = isDark;
  themeKey = dark ? 'dark' : 'light';
  cache.clear();
  if (loader) configure(await loader);
  return true;
}

export function renderMermaid(code: string): Promise<MermaidResult> {
  const key = `${themeKey} ${code}`;
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<MermaidResult> => {
      try {
        const m = await getMermaid();
        const id = `imark-mermaid-${++counter}`;
        const { svg } = await m.render(id, code);
        return { svg };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: msg.replace(/^Error:\s*/, '') };
      }
    })();
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, p);
  }
  return p;
}

/** Fill `container` with the rendered diagram (or an error box). */
export async function mountMermaid(container: HTMLElement, code: string): Promise<void> {
  container.classList.add('mermaid', 'is-loading');
  const result = await renderMermaid(code);
  container.classList.remove('is-loading');
  if (result.error !== undefined) {
    container.classList.add('mermaid-error');
    container.textContent = '';
    const pre = document.createElement('pre');
    pre.className = 'mermaid-error-message';
    pre.textContent = `Mermaid: ${result.error}`;
    container.appendChild(pre);
    return;
  }
  container.classList.remove('mermaid-error');
  container.innerHTML = result.svg;
  const svg = container.querySelector('svg');
  if (svg) {
    svg.style.maxWidth = '100%';
    svg.removeAttribute('height');
  }
}
