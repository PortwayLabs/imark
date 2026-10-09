// Small floating notice shown when the theme health check found problems. It is
// styled entirely by media/css/imark-guard.css so that it stays readable even when
// the theme that triggered it is broken.
import type { ThemeProblem } from '../render/themeHealth';

export interface ThemeNoticeOptions {
  theme: string;
  problems: ThemeProblem[];
  repaired: Set<string>;
  onSelectTheme(): void;
  onIgnore(): void;
}

let current: HTMLElement | null = null;
let timer: number | undefined;

export function hideThemeNotice(): void {
  window.clearTimeout(timer);
  current?.remove();
  current = null;
}

export function showThemeNotice(opts: ThemeNoticeOptions): void {
  hideThemeNotice();
  const el = document.createElement('div');
  el.className = 'imark-theme-notice';
  el.setAttribute('role', 'status');
  const text = document.createElement('div');
  text.className = 'imark-theme-notice-text';
  const fixed = opts.problems.filter((p) => opts.repaired.has(p.kind));
  const open = opts.problems.filter((p) => !opts.repaired.has(p.kind));
  const parts: string[] = [];
  if (fixed.length) parts.push(`iMark corrected it (${fixed.map((p) => p.detail).join('; ')}).`);
  if (open.length) parts.push(`${cap(open.map((p) => p.detail).join('; '))}. Another theme may work better.`);
  text.textContent = `Theme "${opts.theme}" does not fit iMark's layout. ${parts.join(' ')}`;
  const button = (label: string, cls: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => {
      hideThemeNotice();
      action();
    });
    return b;
  };
  el.append(
    text,
    button('Select theme…', 'mod-cta', opts.onSelectTheme),
    button("Don't show again", '', opts.onIgnore),
    button('✕', 'mod-close', () => undefined),
  );
  el.lastElementChild?.setAttribute('aria-label', 'Dismiss');
  document.body.appendChild(el);
  current = el;
  // Repaired problems need no action: let the notice go away by itself.
  if (!open.length) timer = window.setTimeout(hideThemeNotice, 12000);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
