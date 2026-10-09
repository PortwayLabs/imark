// Message protocol shared by the extension host and the webview.
// Keep this file free of imports so both bundles can include it.

export type EditorMode = 'live' | 'source' | 'reading';
export type ThemeMode = 'auto' | 'light' | 'dark';
export type Platform = 'mac' | 'win' | 'linux';
export type LinkStyle = 'markdown' | 'wikilink';
export type TableLayout = 'fit' | 'natural';
/** How strictly iMark protects its layout from theme CSS (`imark.theme.protection`). */
export type ThemeProtection = 'auto' | 'guard' | 'off';

/** A text change relative to the document the sender currently holds. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface EditorConfig {
  mode: EditorMode;
  readableLineWidth: boolean;
  showInlineTitle: boolean;
  showHeader: boolean;
  fontSize: number;
  lineNumbers: boolean;
  spellcheck: boolean;
  autoPairMarkdown: boolean;
  smartClickLinks: boolean;
  wideTables: boolean;
  tableLayout: TableLayout;
  tabSize: number;
  insertSpaces: boolean;
  attachmentLinkStyle: LinkStyle;
  platform: Platform;
}

export interface ThemeInfo {
  /** Display name of the resolved theme (for the UI). */
  name: string;
  /** Kind of theme: vscode-adaptive, obsidian defaults, or an Obsidian community theme. */
  kind: 'vscode' | 'obsidian' | 'theme';
  /** Ordered stylesheet URLs to load after the built-in base styles. */
  cssUris: string[];
  /** Light/dark preference. */
  mode: ThemeMode;
  /** Inline CSS appended last (accent color override, user font size). */
  extraCss: string;
  /** Layout protection; missing = `auto` (guard layer + runtime health check and repairs). */
  protection?: ThemeProtection;
  /** Do not show the theme-problem notice for this theme (the user silenced it). */
  quietIssues?: boolean;
}

/** A root folder the webview may load resources from. */
export interface ResourceRoot {
  /** Absolute filesystem path (POSIX separators). */
  fsPath: string;
  /** Webview URI prefix for this root. */
  webviewUri: string;
}

/** One workspace file relevant to link resolution / completion. */
export interface FileEntry {
  /** Index into the roots array. */
  root: number;
  /** Path relative to the root, POSIX separators. */
  path: string;
}

export interface DocumentInfo {
  /** Absolute path of the document. */
  fsPath: string;
  /** File name without extension. */
  title: string;
  /** Index of the root containing the document. */
  root: number;
  /** Path of the document relative to its root. */
  path: string;
}

// ---- Extension → Webview -------------------------------------------------

export interface InitMessage {
  type: 'init';
  text: string;
  gen: number;
  doc: DocumentInfo;
  roots: ResourceRoot[];
  files: FileEntry[];
  config: EditorConfig;
  theme: ThemeInfo;
}

export interface UpdateMessage {
  type: 'update';
  text: string;
  gen: number;
}

export interface ThemeMessage {
  type: 'theme';
  theme: ThemeInfo;
}

export interface ConfigMessage {
  type: 'config';
  config: EditorConfig;
}

export interface SetModeMessage {
  type: 'setMode';
  mode: EditorMode;
}

export interface ToggleReadingMessage {
  type: 'toggleReading';
}

export interface ToggleSourceMessage {
  type: 'toggleSource';
}

export interface FileIndexMessage {
  type: 'fileIndex';
  files: FileEntry[];
}

export interface FileContentMessage {
  type: 'fileContent';
  id: number;
  text: string | null;
}

export interface AttachmentSavedMessage {
  type: 'attachmentSaved';
  id: number;
  /** Path relative to the document folder (POSIX). */
  relPath: string;
  /** Path relative to the document's root, for wikilinks. */
  name: string;
  error?: string;
}

export interface FocusMessage {
  type: 'focus';
}

export interface DocumentRenamedMessage {
  type: 'documentInfo';
  doc: DocumentInfo;
}

export type HostMessage =
  | InitMessage
  | UpdateMessage
  | ThemeMessage
  | ConfigMessage
  | SetModeMessage
  | ToggleReadingMessage
  | ToggleSourceMessage
  | FileIndexMessage
  | FileContentMessage
  | AttachmentSavedMessage
  | FocusMessage
  | DocumentRenamedMessage;

// ---- Webview → Extension -------------------------------------------------

export interface ReadyMessage {
  type: 'ready';
}

export interface EditMessage {
  type: 'edit';
  gen: number;
  changes: TextChange[];
}

export interface OpenLinkMessage {
  type: 'openLink';
  href: string;
}

export interface OpenWikilinkMessage {
  type: 'openWikilink';
  target: string;
}

export interface SearchTagMessage {
  type: 'searchTag';
  tag: string;
}

export interface ReadFileMessage {
  type: 'readFile';
  id: number;
  /** Wikilink-style target (name or path without extension). */
  target: string;
}

export interface SaveAttachmentMessage {
  type: 'saveAttachment';
  id: number;
  name: string;
  mime: string;
  /** Base64 payload. */
  data: string;
}

export interface ModeChangedMessage {
  type: 'modeChanged';
  mode: EditorMode;
}

export interface StatsMessage {
  type: 'stats';
  words: number;
  characters: number;
}

export interface NotifyMessage {
  type: 'notify';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface RunCommandMessage {
  type: 'command';
  command: 'openSource' | 'selectTheme' | 'manageThemes' | 'toggleReadableLineWidth';
}

/** Result of the runtime theme health check (see render/themeHealth.ts). */
export interface ThemeIssueMessage {
  type: 'themeIssue';
  /** Display name of the theme the report is about. */
  theme: string;
  problems: string[];
  repaired: string[];
  /** `ignore`: the user asked not to be warned about this theme again. */
  action?: 'report' | 'ignore';
}

export interface WebviewFocusMessage {
  type: 'webviewFocus';
  focused: boolean;
}

export type WebviewMessage =
  | ReadyMessage
  | EditMessage
  | OpenLinkMessage
  | OpenWikilinkMessage
  | SearchTagMessage
  | ReadFileMessage
  | SaveAttachmentMessage
  | ModeChangedMessage
  | StatsMessage
  | NotifyMessage
  | RunCommandMessage
  | ThemeIssueMessage
  | WebviewFocusMessage;

// ---- Helpers shared by both sides -----------------------------------------

/** Apply sorted, non-overlapping changes (offsets in `text`) and return the new text. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let out = '';
  let pos = 0;
  for (const c of changes) {
    if (c.from < pos) throw new Error('changes must be sorted and non-overlapping');
    out += text.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + text.slice(pos);
}

/** Compute a single minimal replace turning `a` into `b` (common prefix/suffix diff). */
export function diffChange(a: string, b: string): TextChange | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

export function normalizeEol(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}
