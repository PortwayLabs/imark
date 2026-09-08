// Post-processing for rendered HTML: syntax-highlight code blocks, fetch and
// render note embeds, wire copy buttons.
import { LanguageDescription } from '@codemirror/language';
import { highlightCode } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';
import { obsidianHighlightStyle } from '../editor/highlightStyle';
import { renderMarkdown, type RenderContext } from './markdownIt';
import { extractBlock, extractHeadingSection } from '../editor/widgets';

const langCache = new Map<string, Promise<LanguageDescription | null>>();

export async function loadLanguage(name: string): Promise<LanguageDescription | null> {
  const key = name.toLowerCase();
  if (!langCache.has(key)) {
    const desc = LanguageDescription.matchLanguageName(languages, name, true);
    langCache.set(
      key,
      desc
        ? desc
            .load()
            .then(() => desc)
            .catch(() => null)
        : Promise.resolve(null),
    );
  }
  return langCache.get(key)!;
}

export async function highlightCodeElement(code: HTMLElement, lang: string): Promise<void> {
  const desc = await loadLanguage(lang);
  if (!desc?.support) return;
  const text = code.textContent ?? '';
  const tree = desc.support.language.parser.parse(text);
  const frag = document.createDocumentFragment();
  highlightCode(
    text,
    tree,
    obsidianHighlightStyle,
    (chunk: string, classes: string) => {
      if (classes) {
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = chunk;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(chunk));
      }
    },
    () => frag.appendChild(document.createTextNode('\n')),
  );
  code.replaceChildren(frag);
  code.classList.add('is-loaded');
}

export type ReadFile = (target: string) => Promise<string | null>;

/** Hydrate a container filled by `renderMarkdown`. */
export function hydrateRendered(container: HTMLElement, ctx: RenderContext, readFile: ReadFile): void {
  // Code blocks
  container.querySelectorAll<HTMLElement>('pre > code[data-lang]').forEach((code) => {
    const lang = code.getAttribute('data-lang') ?? '';
    if (lang && !code.classList.contains('is-loaded')) void highlightCodeElement(code, lang);
  });
  container.querySelectorAll<HTMLButtonElement>('button.copy-code-button').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const code = btn.parentElement?.querySelector('code');
      navigator.clipboard?.writeText(code?.textContent ?? '').then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = 'Copy'), 1200);
      });
    });
  });
  // Note embeds
  const depth = ctx.depth ?? 0;
  if (depth < 3) {
    container.querySelectorAll<HTMLElement>('.markdown-embed[data-embed-target]').forEach((embed) => {
      if (embed.dataset.hydrated) return;
      embed.dataset.hydrated = '1';
      const target = embed.getAttribute('data-embed-target') ?? '';
      const heading = embed.getAttribute('data-embed-heading') ?? '';
      const sizer = embed.querySelector<HTMLElement>('.markdown-preview-sizer');
      if (!sizer || embed.classList.contains('is-unresolved')) return;
      readFile(target).then((text) => {
        if (text == null) {
          sizer.innerHTML = `<p class="embed-unresolved">${target}</p>`;
          return;
        }
        let body = text;
        if (heading) body = heading.startsWith('^') ? extractBlock(text, heading.slice(1)) : extractHeadingSection(text, heading);
        const inner: RenderContext = { resolver: ctx.resolver, depth: depth + 1 };
        sizer.innerHTML = renderMarkdown(body, inner);
        hydrateRendered(sizer, inner, readFile);
      });
    });
  }
  // Callout folding
  container.querySelectorAll<HTMLElement>('.callout.is-collapsible > .callout-title').forEach((title) => {
    if (title.dataset.wired) return;
    title.dataset.wired = '1';
    title.addEventListener('click', () => {
      const callout = title.parentElement!;
      callout.classList.toggle('is-collapsed');
      title.querySelector('.callout-fold')?.classList.toggle('is-collapsed');
    });
  });
}
