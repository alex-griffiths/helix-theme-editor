// Theme model mirroring helix-view's theme semantics: style parsing, palette
// lookup, scope fallback (`a.b.c` -> `a.b` -> `a`), style patching and TOML output.

export const MODIFIERS = [
  'bold',
  'dim',
  'italic',
  'underlined',
  'slow_blink',
  'rapid_blink',
  'reversed',
  'hidden',
  'crossed_out',
] as const;
export type Modifier = (typeof MODIFIERS)[number];

export const UNDERLINE_STYLES = ['line', 'curl', 'dashed', 'dotted', 'double_line'] as const;
export type UnderlineStyle = (typeof UNDERLINE_STYLES)[number];

/** The 16 terminal colours helix accepts by name (plus `reset`). */
export const ANSI_COLORS: Record<string, string> = {
  black: '#1d1f21',
  red: '#cc6666',
  green: '#8ca46a',
  yellow: '#e0b35c',
  blue: '#6f9fd4',
  magenta: '#b294bb',
  cyan: '#6fb8b0',
  gray: '#8a8f98',
  'light-red': '#f08080',
  'light-green': '#b5d68c',
  'light-yellow': '#f2d98a',
  'light-blue': '#9cc4f0',
  'light-magenta': '#d7b7e0',
  'light-cyan': '#9fe0d8',
  'light-gray': '#c5c8c6',
  white: '#f5f5f5',
};

export interface Underline {
  color?: string;
  style?: UnderlineStyle;
}

export interface Style {
  fg?: string;
  bg?: string;
  underline?: Underline;
  modifiers?: Modifier[];
}

export interface ThemeDoc {
  /** Name the theme will be committed as. */
  name: string;
  /** Theme this document was started from (used for "inherit" commits). */
  base: string | null;
  palette: Record<string, string>;
  styles: Record<string, Style>;
  /** Keys helix accepts that aren't plain styles (e.g. `rainbow`), preserved verbatim. */
  extras: Record<string, unknown>;
}

/** Own-property lookup, so scope names like `constructor` never hit Object.prototype. */
export function own<T>(obj: Record<string, T> | undefined | null, key: string): T | undefined {
  return obj && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

// ---------------------------------------------------------------------------
// Parsing

export function parseStyle(value: unknown, warnings?: string[], key = ''): Style | null {
  if (typeof value === 'string') return { fg: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const style: Style = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'fg' && typeof val === 'string') style.fg = val;
    else if (k === 'bg' && typeof val === 'string') style.bg = val;
    else if (k === 'underline' && val && typeof val === 'object') {
      const u = val as Record<string, unknown>;
      style.underline = {};
      if (typeof u.color === 'string') style.underline.color = u.color;
      if (typeof u.style === 'string') style.underline.style = u.style as UnderlineStyle;
    } else if (k === 'modifiers' && Array.isArray(val)) {
      style.modifiers = val.filter((m): m is Modifier => MODIFIERS.includes(m as Modifier));
      const bad = val.filter((m) => !MODIFIERS.includes(m as Modifier));
      if (bad.length) warnings?.push(`${key}: unknown modifiers ${bad.join(', ')}`);
    } else warnings?.push(`${key}: ignored attribute '${k}'`);
  }
  return style;
}

export function docFromResolved(
  name: string,
  base: string | null,
  palette: Record<string, unknown>,
  raw: Record<string, unknown>,
): { doc: ThemeDoc; warnings: string[] } {
  const warnings: string[] = [];
  const pal: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) {
    if (typeof v === 'string') pal[k] = v;
    else warnings.push(`palette.${k}: not a colour string`);
  }
  const styles: Record<string, Style> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = parseStyle(v, warnings, k);
    if (s) styles[k] = s;
    else extras[k] = v;
  }
  return { doc: { name, base, palette: pal, styles, extras }, warnings };
}

// ---------------------------------------------------------------------------
// Resolution

/** Resolve a colour reference to CSS. Palette entries take precedence, like helix. */
export function resolveColor(theme: ThemeDoc, color: string | undefined, depth = 0): string | undefined {
  if (!color || color === 'reset') return undefined;
  const pal = own(theme.palette, color);
  if (pal !== undefined && depth < 4) {
    return /^#[0-9a-fA-F]{6}$/.test(pal) ? pal : resolveColor(theme, pal, depth + 1);
  }
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return own(ANSI_COLORS, color);
}

export function isValidColor(theme: ThemeDoc, color: string): boolean {
  return color === 'reset' || resolveColor(theme, color) !== undefined;
}

/** Scope fallback chain: `a.b.c` -> `a.b` -> `a`. */
export function scopeChain(scope: string): string[] {
  const out = [scope];
  let s = scope;
  while (s.includes('.')) {
    s = s.slice(0, s.lastIndexOf('.'));
    out.push(s);
  }
  return out;
}

/** The theme key that styles `scope`, following helix's fallback rules. */
export function resolveKey(theme: ThemeDoc, scope: string): string | null {
  for (const s of scopeChain(scope)) if (own(theme.styles, s)) return s;
  return null;
}

export function getStyle(theme: ThemeDoc, scope: string): Style | undefined {
  const k = resolveKey(theme, scope);
  return k ? theme.styles[k] : undefined;
}

/** A style with colours resolved to CSS hex (undefined = not set). */
export interface ResolvedStyle {
  fg?: string;
  bg?: string;
  ulColor?: string;
  ulStyle?: UnderlineStyle;
  modifiers: Set<Modifier>;
}

export function emptyResolved(): ResolvedStyle {
  return { modifiers: new Set() };
}

/** Style::patch: later values override, modifiers accumulate. */
export function patch(acc: ResolvedStyle, theme: ThemeDoc, style: Style | undefined): ResolvedStyle {
  if (!style) return acc;
  const out: ResolvedStyle = { ...acc, modifiers: new Set(acc.modifiers) };
  const fg = resolveColor(theme, style.fg);
  const bg = resolveColor(theme, style.bg);
  if (fg) out.fg = fg;
  if (bg) out.bg = bg;
  if (style.underline) {
    const c = resolveColor(theme, style.underline.color);
    if (c) out.ulColor = c;
    if (style.underline.style) out.ulStyle = style.underline.style;
  }
  for (const m of style.modifiers ?? []) out.modifiers.add(m);
  return out;
}

export function composeScopes(theme: ThemeDoc, scopes: string[], base?: ResolvedStyle): ResolvedStyle {
  let acc = base ?? emptyResolved();
  for (const s of scopes) acc = patch(acc, theme, getStyle(theme, s));
  return acc;
}

export interface Paint {
  fg: string;
  bg: string;
}

/** Convert a resolved style into inline CSS. `paint` supplies defaults for fg/bg. */
export function toCss(r: ResolvedStyle, paint: Paint, opts: { transparentBg?: boolean } = {}): string {
  let fg = r.fg ?? paint.fg;
  let bg = r.bg ?? (opts.transparentBg ? 'transparent' : paint.bg);
  if (r.modifiers.has('reversed')) {
    const realBg = r.bg ?? paint.bg;
    bg = fg;
    fg = realBg;
  }
  const css: string[] = [`color:${fg}`, `background:${bg}`];
  if (r.modifiers.has('bold')) css.push('font-weight:700');
  if (r.modifiers.has('italic')) css.push('font-style:italic');
  if (r.modifiers.has('dim')) css.push('opacity:.6');
  if (r.modifiers.has('hidden')) css.push('color:transparent');
  if (r.modifiers.has('slow_blink')) css.push('animation:hx-blink 1.6s steps(1) infinite');
  if (r.modifiers.has('rapid_blink')) css.push('animation:hx-blink .5s steps(1) infinite');
  const lines: string[] = [];
  const ulStyle = r.ulStyle ?? (r.modifiers.has('underlined') ? 'line' : undefined);
  if (ulStyle) lines.push('underline');
  if (r.modifiers.has('crossed_out')) lines.push('line-through');
  if (lines.length) {
    const deco = { line: 'solid', curl: 'wavy', dashed: 'dashed', dotted: 'dotted', double_line: 'double' }[
      ulStyle ?? 'line'
    ];
    css.push(`text-decoration-line:${lines.join(' ')}`);
    css.push(`text-decoration-style:${deco}`);
    if (r.ulColor) css.push(`text-decoration-color:${r.ulColor}`);
    css.push('text-underline-offset:2px');
    css.push('text-decoration-skip-ink:none');
  }
  return css.join(';');
}

// ---------------------------------------------------------------------------
// Serialisation

function tomlString(s: string): string {
  // JSON string escapes are valid TOML basic-string escapes.
  return JSON.stringify(s);
}

function tomlKey(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k);
}

function tomlValue(v: unknown): string {
  if (typeof v === 'string') return tomlString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, val]) => `${tomlKey(k)} = ${tomlValue(val)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return '""';
}

export function isEmptyStyle(s: Style): boolean {
  return !s.fg && !s.bg && !s.underline?.color && !s.underline?.style && !s.modifiers?.length;
}

export function styleToToml(s: Style): string {
  if (s.fg && !s.bg && !s.underline && !s.modifiers?.length) return tomlString(s.fg);
  const obj: Record<string, unknown> = {};
  if (s.fg) obj.fg = s.fg;
  if (s.bg) obj.bg = s.bg;
  if (s.underline && (s.underline.color || s.underline.style)) {
    const u: Record<string, string> = {};
    if (s.underline.color) u.color = s.underline.color;
    if (s.underline.style) u.style = s.underline.style;
    obj.underline = u;
  }
  if (s.modifiers?.length) obj.modifiers = s.modifiers;
  return tomlValue(obj);
}

function styleEq(a: Style | undefined, b: Style | undefined): boolean {
  if (!a || !b) return a === b;
  return styleToToml(a) === styleToToml(b);
}

const SECTION_ORDER: [string, (k: string) => boolean][] = [
  ['Syntax', (k) => !/^(ui|markup|diff|diagnostic|warning|error|info|hint)(\.|$)/.test(k)],
  ['Markup', (k) => /^markup(\.|$)/.test(k)],
  ['Diff', (k) => /^diff(\.|$)/.test(k)],
  ['Interface', (k) => /^ui(\.|$)/.test(k)],
  ['Diagnostics', (k) => /^(diagnostic|warning|error|info|hint)(\.|$)/.test(k)],
];

export interface SerializeOptions {
  /** Emit `inherits = base` and only the differences from `baseDoc`. */
  inheritFrom?: { name: string; doc: ThemeDoc };
  header?: string;
}

export function serializeTheme(theme: ThemeDoc, opts: SerializeOptions = {}): string {
  const out: string[] = [];
  if (opts.header) out.push(...opts.header.split('\n').map((l) => `# ${l}`), '');
  const parent = opts.inheritFrom?.doc;
  if (opts.inheritFrom) out.push(`inherits = ${tomlString(opts.inheritFrom.name)}`, '');

  const keys = Object.keys(theme.styles).filter((k) => !parent || !styleEq(theme.styles[k], own(parent.styles, k)));
  // In inherit mode a scope removed relative to the parent must be blanked explicitly.
  const removed = parent ? Object.keys(parent.styles).filter((k) => !own(theme.styles, k)) : [];

  const placed = new Set<string>();
  for (const [title, test] of SECTION_ORDER) {
    const section = [...keys, ...removed].filter((k) => !placed.has(k) && test(k)).sort(scopeSort);
    if (!section.length) continue;
    out.push(`# ${title}`);
    for (const k of section) {
      placed.add(k);
      const st = own(theme.styles, k);
      const v = st ? styleToToml(st) : '{}';
      out.push(`${tomlString(k)} = ${v}`);
    }
    out.push('');
  }

  const extras = Object.entries(theme.extras).filter(
    ([k, v]) => !parent || JSON.stringify(own(parent.extras, k)) !== JSON.stringify(v),
  );
  for (const [k, v] of extras) out.push(`${tomlKey(k)} = ${tomlValue(v)}`);
  if (extras.length) out.push('');

  const palette = Object.entries(theme.palette).filter(([k, v]) => !parent || own(parent.palette, k) !== v);
  if (palette.length) {
    out.push('[palette]');
    for (const [k, v] of palette) out.push(`${tomlKey(k)} = ${tomlString(v)}`);
    out.push('');
  }
  return out.join('\n');
}

function scopeSort(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Every place a palette name is referenced from styles. */
export function paletteUsage(theme: ThemeDoc, name: string): string[] {
  const used: string[] = [];
  for (const [k, s] of Object.entries(theme.styles)) {
    if (s.fg === name || s.bg === name || s.underline?.color === name) used.push(k);
  }
  return used;
}

export function renamePaletteRefs(theme: ThemeDoc, from: string, to: string) {
  for (const s of Object.values(theme.styles)) {
    if (s.fg === from) s.fg = to;
    if (s.bg === from) s.bg = to;
    if (s.underline?.color === from) s.underline.color = to;
  }
  for (const [k, v] of Object.entries(theme.palette)) if (v === from) theme.palette[k] = to;
}

export function cloneDoc(doc: ThemeDoc): ThemeDoc {
  return JSON.parse(JSON.stringify(doc));
}
