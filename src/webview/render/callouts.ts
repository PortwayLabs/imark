// Callout type metadata mirroring Obsidian's built-in callouts.
export interface CalloutMeta {
  /** Canonical type used for `data-callout`. */
  type: string;
  icon: string;
  /** Default title (capitalised type name). */
  title: string;
}

const aliases: Record<string, { type: string; icon: string }> = {
  note: { type: 'note', icon: 'pencil' },
  abstract: { type: 'abstract', icon: 'clipboard-list' },
  summary: { type: 'abstract', icon: 'clipboard-list' },
  tldr: { type: 'abstract', icon: 'clipboard-list' },
  info: { type: 'info', icon: 'info' },
  todo: { type: 'todo', icon: 'check-circle-2' },
  tip: { type: 'tip', icon: 'flame' },
  hint: { type: 'tip', icon: 'flame' },
  important: { type: 'tip', icon: 'flame' },
  success: { type: 'success', icon: 'check' },
  check: { type: 'success', icon: 'check' },
  done: { type: 'success', icon: 'check' },
  question: { type: 'question', icon: 'help-circle' },
  help: { type: 'question', icon: 'help-circle' },
  faq: { type: 'question', icon: 'help-circle' },
  warning: { type: 'warning', icon: 'alert-triangle' },
  caution: { type: 'warning', icon: 'alert-triangle' },
  attention: { type: 'warning', icon: 'alert-triangle' },
  failure: { type: 'failure', icon: 'x' },
  fail: { type: 'failure', icon: 'x' },
  missing: { type: 'failure', icon: 'x' },
  danger: { type: 'danger', icon: 'zap' },
  error: { type: 'danger', icon: 'zap' },
  bug: { type: 'bug', icon: 'bug' },
  example: { type: 'example', icon: 'list' },
  quote: { type: 'quote', icon: 'quote' },
  cite: { type: 'quote', icon: 'quote' },
};

export function calloutMeta(rawType: string): CalloutMeta {
  const key = rawType.trim().toLowerCase();
  const hit = aliases[key];
  const title = key.charAt(0).toUpperCase() + key.slice(1);
  if (hit) return { type: key, icon: hit.icon, title };
  return { type: key || 'note', icon: 'pencil', title: title || 'Note' };
}

export interface CalloutHeader {
  type: string;
  fold: '' | '+' | '-';
  title: string;
  metadata: string;
}

/** Parse the first line of a blockquote (without the leading `>`), e.g. `[!note]- Title`. */
export function parseCalloutHeader(firstLine: string): CalloutHeader | null {
  const m = /^\s*\[!([^\]|]+)(?:\|([^\]]*))?\]([+-]?)[ \t]?(.*)$/.exec(firstLine);
  if (!m) return null;
  return { type: m[1].trim(), metadata: (m[2] ?? '').trim(), fold: (m[3] as '' | '+' | '-') ?? '', title: m[4].trim() };
}
