// Obsidian-style view header with the mode toggle and an actions menu.
import type { EditorMode } from '../../shared/protocol';
import { svgIconElement } from '../render/icons';

export type MenuAction = 'toggleSource' | 'toggleReadable' | 'openSource' | 'selectTheme' | 'manageThemes';

export interface HeaderOptions {
  title: string;
  mode: EditorMode;
  readable: boolean;
  onToggleReading(): void;
  onMenu(action: MenuAction): void;
}

export interface HeaderHandle {
  el: HTMLElement;
  update(state: { title?: string; mode?: EditorMode; readable?: boolean }): void;
}

export function createHeader(opts: HeaderOptions): HeaderHandle {
  let { title, mode, readable } = opts;
  const el = document.createElement('div');
  el.className = 'view-header';

  const titleContainer = document.createElement('div');
  titleContainer.className = 'view-header-title-container mod-at-start mod-at-end';
  const titleEl = document.createElement('div');
  titleEl.className = 'view-header-title';
  titleEl.textContent = title;
  titleContainer.appendChild(titleEl);

  const actions = document.createElement('div');
  actions.className = 'view-actions';

  const modeBtn = document.createElement('a');
  modeBtn.className = 'clickable-icon view-action mod-mode';
  modeBtn.addEventListener('mousedown', (e) => e.preventDefault());
  modeBtn.addEventListener('click', () => opts.onToggleReading());

  const moreBtn = document.createElement('a');
  moreBtn.className = 'clickable-icon view-action';
  moreBtn.setAttribute('aria-label', 'More options');
  moreBtn.appendChild(svgIconElement('more-vertical'));
  moreBtn.addEventListener('mousedown', (e) => e.preventDefault());
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu();
  });

  actions.append(modeBtn, moreBtn);
  el.append(titleContainer, actions);

  let menu: HTMLElement | null = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
    document.removeEventListener('mousedown', onDocDown, true);
  };
  const onDocDown = (e: MouseEvent) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  };
  const item = (icon: string, label: string, action: MenuAction | (() => void)) => {
    const it = document.createElement('div');
    it.className = 'menu-item tappable';
    const ic = document.createElement('div');
    ic.className = 'menu-item-icon';
    ic.appendChild(svgIconElement(icon));
    const tt = document.createElement('div');
    tt.className = 'menu-item-title';
    tt.textContent = label;
    it.append(ic, tt);
    it.addEventListener('click', () => {
      closeMenu();
      if (typeof action === 'function') action();
      else opts.onMenu(action);
    });
    return it;
  };
  const sep = () => {
    const s = document.createElement('div');
    s.className = 'menu-separator';
    return s;
  };
  function openMenu() {
    if (menu) return closeMenu();
    menu = document.createElement('div');
    menu.className = 'menu imark-menu';
    menu.append(
      item(mode === 'source' ? 'edit' : 'code', mode === 'source' ? 'Live preview' : 'Source mode', 'toggleSource'),
      item(mode === 'reading' ? 'edit' : 'book-open', mode === 'reading' ? 'Edit note' : 'Reading view', () => opts.onToggleReading()),
      sep(),
      item('text-cursor-input', readable ? 'Disable readable line width' : 'Readable line width', 'toggleReadable'),
      item('palette', 'Select theme…', 'selectTheme'),
      item('table', 'Manage themes…', 'manageThemes'),
      sep(),
      item('file-text', 'Open in text editor', 'openSource'),
    );
    document.body.appendChild(menu);
    const r = moreBtn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    setTimeout(() => document.addEventListener('mousedown', onDocDown, true));
  }

  function render() {
    titleEl.textContent = title;
    modeBtn.replaceChildren(svgIconElement(mode === 'reading' ? 'edit' : 'book-open'));
    modeBtn.setAttribute(
      'aria-label',
      mode === 'reading' ? 'Current view: reading\nClick to edit' : `Current view: ${mode === 'source' ? 'source' : 'editing'}\nClick to read`,
    );
  }
  render();

  return {
    el,
    update(s) {
      if (s.title !== undefined) title = s.title;
      if (s.mode !== undefined) mode = s.mode;
      if (s.readable !== undefined) readable = s.readable;
      render();
    },
  };
}
