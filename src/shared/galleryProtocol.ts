// Messages between the theme manager panel (src/extension/themeGallery.ts) and its
// webview (src/gallery/main.ts). Keep this file free of imports.

export type GalleryLang = 'en' | 'zh';

export interface GalleryTheme {
  /** Display name (also the key used to match catalog entries with installed themes). */
  name: string;
  author: string;
  /** GitHub `owner/repo` for community themes. */
  repo?: string;
  screenshot?: string;
  modes: Array<'dark' | 'light'>;
  /** In the community catalog. */
  community: boolean;
  /** Value for `imark.theme.name` when installed (theme id, `vscode` or `obsidian`). */
  id?: string;
  installed: boolean;
  origin?: 'bundled' | 'library' | 'external' | 'special';
  version?: string;
  size?: number;
  /** Selected anywhere in the settings (cannot be cleaned up). */
  inUse: boolean;
  /** The theme iMark currently shows. */
  current: boolean;
  /** Newer version available in the catalog. */
  update?: string;
  /** Short description for the special entries. */
  description?: string;
}

export interface GalleryState {
  lang: GalleryLang;
  themes: GalleryTheme[];
  catalog: { count: number; fetchedAt: number; loading: boolean; error?: string };
  /** name -> 'installing' | 'updating' | 'removing' */
  busy: Record<string, string>;
  checkingUpdates: boolean;
  libraryBytes: number;
  cacheBytes: number;
  libraryDir: string;
}

export type GalleryToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'install'; name: string }
  | { type: 'update'; name: string }
  | { type: 'use'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'checkUpdates' }
  | { type: 'cleanup' }
  | { type: 'import' }
  | { type: 'openFolder' }
  | { type: 'openUrl'; url: string };

export type HostToGallery = { type: 'state'; state: GalleryState } | { type: 'tab'; tab: 'installed' | 'community' };
