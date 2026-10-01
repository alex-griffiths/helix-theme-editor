// Application state. All theme edits live here (and in localStorage as a draft)
// until they're committed to disk through the server.

import { api, type EnvInfo, type HighlightResult, type Language, type ThemeInfo } from './api';
import type { Mode, ViewOptions } from './render';
import { SAMPLES } from './samples';
import { cloneDoc, docFromResolved, serializeTheme, type Style, type ThemeDoc } from './theme';

const DRAFT_KEY = 'hx-theme-editor:draft';
const CODE_KEY = 'hx-theme-editor:code';
const VIEW_KEY = 'hx-theme-editor:view';
const COALESCE_MS = 700;

export interface CodeSource {
  name: string;
  text: string;
  /** Explicit language override; null = auto-detect from name/shebang. */
  language: string | null;
  path?: string;
}

interface Draft {
  doc: ThemeDoc;
  baseDoc: ThemeDoc | null;
  baseline: string;
}

function emptyDoc(): ThemeDoc {
  return { name: 'untitled', base: null, palette: {}, styles: {}, extras: {} };
}

function snapshot(doc: ThemeDoc): string {
  return JSON.stringify({ palette: doc.palette, styles: doc.styles, extras: doc.extras });
}

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const DEFAULT_VIEW: ViewOptions & { mode: Mode; colorModes: boolean; bufferline: boolean; split: boolean; popup: string; terminalBg: string; terminalFg: string } = {
  mode: 'normal',
  colorModes: true,
  bufferline: true,
  split: false,
  popup: 'none',
  cursorline: true,
  cursorcolumn: false,
  whitespace: false,
  indentGuides: true,
  ruler: null,
  inlayHints: true,
  eolDiagnostics: true,
  jumpLabels: false,
  softWrap: null,
  wrapIndicator: '↪ ',
  relativeNumbers: false,
  debug: false,
  tabWidth: 4,
  terminalBg: '#1b1b1f',
  terminalFg: '#d4d4d4',
};
export type ViewState = typeof DEFAULT_VIEW;

/** Start the preview with the user's own editor settings where they map onto preview options. */
function viewFromConfig(ed: Record<string, any>): ViewState {
  const v = { ...DEFAULT_VIEW };
  if (ed['line-number'] === 'relative') v.relativeNumbers = true;
  if (typeof ed.cursorline === 'boolean') v.cursorline = ed.cursorline;
  if (typeof ed.cursorcolumn === 'boolean') v.cursorcolumn = ed.cursorcolumn;
  if (Array.isArray(ed.rulers) && ed.rulers.length) v.ruler = ed.rulers[0] - 1;
  if (ed['soft-wrap']?.enable) {
    v.softWrap = 100;
    if (typeof ed['soft-wrap']['wrap-indicator'] === 'string') v.wrapIndicator = ed['soft-wrap']['wrap-indicator'] + ' ';
  }
  if (ed['indent-guides']?.render === false) v.indentGuides = false;
  if (ed.whitespace?.render === 'all') v.whitespace = true;
  if (ed.bufferline === 'never') v.bufferline = false;
  return v;
}

class EditorState {
  env = $state<EnvInfo | null>(null);
  themes = $state<ThemeInfo[]>([]);
  languages = $state<Language[]>([]);
  captures = $state<Record<string, string[]>>({});
  loadError = $state<string | null>(null);

  doc = $state<ThemeDoc>(emptyDoc());
  /** The loaded base theme, as loaded (used for diffs and inherit-mode commits). */
  baseDoc = $state.raw<ThemeDoc | null>(null);
  baseline = $state('');
  warnings = $state<string[]>([]);
  restoredDraft = $state(false);

  selected = $state<string | null>(null);
  inspect = $state<{ scopes: string[]; text: string } | null>(null);

  code = $state<CodeSource>({ ...SAMPLES[0], language: null });
  highlight = $state<HighlightResult | null>(null);
  highlighting = $state(false);

  view = $state<ViewState>({ ...DEFAULT_VIEW });

  toast = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  canUndo = $state(false);
  canRedo = $state(false);
  private lastEdit = { key: '', at: 0 };

  dirty = $derived(snapshot(this.doc) !== this.baseline);
  toml = $derived(serializeTheme(this.doc));

  async init() {
    const draft = load<Draft>(DRAFT_KEY);
    const code = load<CodeSource>(CODE_KEY);
    const view = load<Partial<ViewState>>(VIEW_KEY);
    if (code?.text) this.code = code;
    if (view) this.view = { ...DEFAULT_VIEW, ...view };
    try {
      const [env, themes, languages, captures] = await Promise.all([
        api.env(),
        api.themes(),
        api.languages(),
        api.scopes(),
      ]);
      this.env = env;
      this.themes = themes;
      this.languages = languages;
      this.captures = captures;
      if (!view) this.view = viewFromConfig(env.editor);
    } catch (e) {
      this.loadError = `Could not reach the local server: ${(e as Error).message}`;
    }
    if (draft?.doc) {
      this.doc = draft.doc;
      this.baseDoc = draft.baseDoc;
      this.baseline = draft.baseline;
      this.restoredDraft = snapshot(this.doc) !== this.baseline;
    } else if (this.env) {
      const start = this.env.activeTheme && this.themes.some((t) => t.name === this.env!.activeTheme) ? this.env.activeTheme : 'default';
      await this.loadBase(start);
    }
  }

  persist() {
    save(DRAFT_KEY, { doc: this.doc, baseDoc: this.baseDoc, baseline: this.baseline } satisfies Draft);
  }

  persistCode() {
    if (this.code.text.length < 1_000_000) save(CODE_KEY, this.code);
  }

  persistView() {
    save(VIEW_KEY, this.view);
  }

  async refreshThemes() {
    this.themes = await api.themes();
  }

  /** Loads a theme (inheritance flattened) as the starting point for edits. */
  async loadBase(name: string) {
    try {
      const data = await api.theme(name);
      const { doc, warnings } = docFromResolved(name, name, data.palette, data.styles);
      this.doc = doc;
      this.baseDoc = cloneDoc(doc);
      this.baseline = snapshot(doc);
      this.warnings = warnings;
      this.undoStack = [];
      this.redoStack = [];
      this.syncHistory();
      this.restoredDraft = false;
      this.notify('ok', `Loaded ${name}${data.chain.length > 1 ? ` (inherits ${data.chain.slice(1).map((c) => c.name).join(' → ')})` : ''}`);
    } catch (e) {
      this.notify('error', (e as Error).message);
    }
  }

  // --- editing with undo/redo ------------------------------------------------

  /** Apply a mutation. Rapid edits with the same key (e.g. dragging a colour) coalesce into one undo step. */
  edit(fn: (doc: ThemeDoc) => void, key = '') {
    const now = Date.now();
    if (!key || key !== this.lastEdit.key || now - this.lastEdit.at > COALESCE_MS) {
      this.undoStack.push(JSON.stringify(this.doc));
      if (this.undoStack.length > 300) this.undoStack.shift();
    }
    this.lastEdit = { key, at: now };
    this.redoStack = [];
    fn(this.doc);
    this.syncHistory();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev);
    this.lastEdit = { key: '', at: 0 };
    this.syncHistory();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next);
    this.lastEdit = { key: '', at: 0 };
    this.syncHistory();
  }

  private syncHistory() {
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
  }

  setStyle(scope: string, style: Style | null, key = `style:${scope}`) {
    this.edit((d) => {
      if (style) d.styles[scope] = style;
      else delete d.styles[scope];
    }, key);
  }

  /** Discard all edits since the base was loaded / last commit. */
  revert() {
    if (!this.baseline) return;
    const base = JSON.parse(this.baseline);
    this.edit((d) => {
      d.palette = base.palette;
      d.styles = base.styles;
      d.extras = base.extras;
    });
  }

  replaceDoc(next: ThemeDoc) {
    this.edit((d) => {
      d.palette = next.palette;
      d.styles = next.styles;
      d.extras = next.extras;
    });
  }

  // --- committing --------------------------------------------------------------

  tomlFor(inherit: boolean): string {
    const header = `Theme "${this.doc.name}" created with helix-theme-editor${this.doc.base ? ` from "${this.doc.base}"` : ''}`;
    if (inherit && this.doc.base && this.baseDoc) {
      return serializeTheme(this.doc, { inheritFrom: { name: this.doc.base, doc: this.baseDoc }, header });
    }
    return serializeTheme(this.doc, { header });
  }

  async commit(opts: { inherit: boolean; overwrite: boolean; activate: boolean }) {
    const toml = this.tomlFor(opts.inherit);
    const result = await api.saveTheme({ name: this.doc.name, toml, overwrite: opts.overwrite, activate: opts.activate });
    this.baseline = snapshot(this.doc);
    await this.refreshThemes();
    if (opts.activate && this.env) this.env.activeTheme = this.doc.name;
    return result;
  }

  // --- code preview --------------------------------------------------------------

  private hlSeq = 0;
  async rehighlight() {
    const seq = ++this.hlSeq;
    this.highlighting = true;
    try {
      const res = await api.highlight({ language: this.code.language, name: this.code.name, text: this.code.text });
      if (seq === this.hlSeq) this.highlight = res;
    } catch (e) {
      if (seq === this.hlSeq) {
        this.highlight = { ok: false, error: (e as Error).message, language: null, scopes: [], spans: [] };
      }
    } finally {
      if (seq === this.hlSeq) this.highlighting = false;
    }
  }

  setCode(src: CodeSource) {
    this.code = { ...src, text: src.text.replace(/\r\n?/g, '\n') };
  }

  notify(kind: 'ok' | 'error', text: string) {
    this.toast = { kind, text };
    const current = this.toast;
    setTimeout(() => {
      if (this.toast === current) this.toast = null;
    }, kind === 'error' ? 7000 : 3500);
  }
}

export const editor = new EditorState();
