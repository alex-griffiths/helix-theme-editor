// Builds a Helix-like editor view model from highlighted source text.
//
// Every cell is described by an ordered list of style "layers" (scopes patched in
// the same order Helix applies them). Runs of cells with the same layers become a
// piece whose CSS class is shared, so theme edits only regenerate a stylesheet.

import {
  emptyResolved,
  own,
  patch,
  resolveKey,
  toCss,
  type Paint,
  type ResolvedStyle,
  type Style,
  type ThemeDoc,
} from './theme';

export type Mode = 'normal' | 'insert' | 'select';
export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  from: number;
  to: number;
  severity: Severity;
  message: string;
  tag?: 'unnecessary' | 'deprecated';
}

export interface InlayHint {
  at: number;
  text: string;
  kind: 'type' | 'parameter';
}

export interface Selection {
  anchor: number;
  head: number;
}

export interface Decorations {
  diagnostics: Diagnostic[];
  diff: Map<number, 'plus' | 'delta' | 'minus'>;
  inlays: InlayHint[];
  breakpoint: number | null;
  frameLine: number | null;
}

export interface ViewOptions {
  cursorline: boolean;
  cursorcolumn: boolean;
  whitespace: boolean;
  indentGuides: boolean;
  ruler: number | null;
  inlayHints: boolean;
  eolDiagnostics: boolean;
  jumpLabels: boolean;
  softWrap: number | null;
  wrapIndicator: string;
  relativeNumbers: boolean;
  debug: boolean;
  tabWidth: number;
}

export interface Piece {
  text: string;
  cls: string;
  /** Absolute UTF-16 offset of the first source char, or -1 for virtual text. */
  offset: number;
  /** Syntax scopes (outermost first) of the source text under this piece. */
  scopes: string[];
}

export interface Row {
  key: string;
  line: number;
  continuation: boolean;
  lineCls: string;
  gutter: Piece[];
  pieces: Piece[];
}

export class StyleRegistry {
  private byKey = new Map<string, string>();
  readonly combos: { cls: string; layers: string[] }[] = [];

  cls(layers: string[]): string {
    const key = layers.join('|');
    let cls = this.byKey.get(key);
    if (!cls) {
      cls = `h${this.combos.length}`;
      this.byKey.set(key, cls);
      this.combos.push({ cls, layers });
    }
    return cls;
  }
}

// ---------------------------------------------------------------------------
// Layer resolution (the part that depends on the theme)

/** helix-term editor.rs cursor/selection scope selection. */
export function layerStyle(theme: ThemeDoc, layer: string, mode: Mode): Style | undefined {
  const exact = (s: string) => own(theme.styles, s);
  const fallback = (s: string) => {
    const k = resolveKey(theme, s);
    return k ? theme.styles[k] : undefined;
  };
  switch (layer) {
    case '@selection':
      return exact('ui.selection');
    case '@selection.primary':
      return exact('ui.selection.primary') ?? exact('ui.selection');
    case '@cursor': {
      const base = exact('ui.cursor') ?? exact('ui.selection');
      return exact(`ui.cursor.${mode}`) ?? base;
    }
    case '@cursor.primary': {
      const base = exact('ui.cursor') ?? exact('ui.selection');
      const basePrimary = fallback('ui.cursor.primary') ?? base;
      return exact(`ui.cursor.primary.${mode}`) ?? basePrimary;
    }
    case '@statusline.mode':
      return fallback(`ui.statusline.${mode}`);
  }
  return fallback(layer);
}

export function resolveLayers(theme: ThemeDoc, layers: string[], mode: Mode): ResolvedStyle {
  let acc = emptyResolved();
  for (const l of layers) acc = patch(acc, theme, layerStyle(theme, l, mode));
  return acc;
}

export function layersCss(theme: ThemeDoc, layers: string[], mode: Mode, paint: Paint): string {
  return toCss(resolveLayers(theme, layers, mode), paint);
}

export function stylesheet(theme: ThemeDoc, reg: StyleRegistry, mode: Mode, paint: Paint, scope: string): string {
  return reg.combos.map((c) => `${scope} .${c.cls}{${layersCss(theme, c.layers, mode, paint)}}`).join('\n');
}


// ---------------------------------------------------------------------------
// View model construction (independent of the theme)

export interface RenderInput {
  text: string;
  spans: [number, number, number[]][];
  scopeNames: string[];
  primary: Selection;
  secondary: Selection | null;
  deco: Decorations;
  opts: ViewOptions;
  maxLines?: number;
}

const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };

export function matchingBracket(text: string, pos: number): number | null {
  const ch = text[pos];
  const other = BRACKETS[ch];
  if (!other) return null;
  const forward = '([{'.includes(ch);
  let depth = 0;
  for (let i = pos; forward ? i < text.length : i >= 0; i += forward ? 1 : -1) {
    if (text[i] === ch) depth++;
    else if (text[i] === other && --depth === 0) return i;
  }
  return null;
}

function jumpLabel(n: number): string {
  const a = 'abcdefghijklmnopqrstuvwxyz';
  return a[Math.floor(n / 26) % 26] + a[n % 26];
}

interface Cell {
  text: string;
  offset: number;
  layers: string[];
  scopes: string[];
}

export function buildView(input: RenderInput, reg: StyleRegistry): { rows: Row[]; truncated: boolean } {
  const { text, spans, scopeNames, primary, secondary, deco, opts } = input;
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const maxLines = input.maxLines ?? 4000;
  const truncated = lines.length > maxLines;
  const shown = truncated ? lines.slice(0, maxLines) : lines;

  const selRange = (s: Selection) => ({
    from: Math.min(s.anchor, s.head),
    to: Math.max(s.anchor, s.head) + 1,
    head: s.head,
  });
  const prim = selRange(primary);
  const sec = secondary ? selRange(secondary) : null;
  const matchPos = matchingBracket(text, primary.head);

  const lineOf = (off: number) => {
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      if (off <= acc + lines[i].length) return i;
      acc += lines[i].length + 1;
    }
    return lines.length - 1;
  };
  const cursorLine = lineOf(primary.head);
  const secLine = sec ? lineOf(sec.head) : -1;

  const diagsByLine = new Map<number, Diagnostic[]>();
  for (const d of deco.diagnostics) {
    const l = lineOf(d.from);
    (diagsByLine.get(l) ?? diagsByLine.set(l, []).get(l)!).push(d);
  }
  const sevRank: Record<Severity, number> = { hint: 0, info: 1, warning: 2, error: 3 };

  const inlaysAt = new Map<number, InlayHint[]>();
  if (opts.inlayHints) for (const h of deco.inlays) (inlaysAt.get(h.at) ?? inlaysAt.set(h.at, []).get(h.at)!).push(h);

  // Visual column of the primary cursor, for cursorcolumn.
  const visualCol = (line: string, col: number) => {
    let v = 0;
    for (let i = 0; i < col && i < line.length; i++) v = line[i] === '\t' ? v + opts.tabWidth - (v % opts.tabWidth) : v + 1;
    return v;
  };
  let cursorVcol = 0;
  {
    let acc = 0;
    for (let i = 0; i < cursorLine; i++) acc += lines[i].length + 1;
    cursorVcol = visualCol(lines[cursorLine] ?? '', primary.head - acc);
  }

  const indentOf = (l: string) => {
    if (!l.trim()) return -1;
    let v = 0;
    for (const ch of l) {
      if (ch === ' ') v++;
      else if (ch === '\t') v += opts.tabWidth - (v % opts.tabWidth);
      else break;
    }
    return v;
  };
  const indentUnit = detectIndentUnit(shown, opts.tabWidth);

  const rows: Row[] = [];
  let spanIdx = 0;
  let lineStart = 0;
  let labelCounter = 0;
  const digits = Math.max(3, String(shown.length).length);

  for (let li = 0; li < shown.length; li++) {
    const line = shown[li];
    const isCursorLine = li === cursorLine;
    const isSecLine = li === secLine && !isCursorLine;
    const lineLayers = ['ui.background'];
    if (opts.debug && deco.frameLine === li) lineLayers.push('ui.highlight.frameline');
    if (opts.cursorline && isCursorLine) lineLayers.push('ui.cursorline.primary');
    else if (opts.cursorline && isSecLine) lineLayers.push('ui.cursorline.secondary');

    // Guide columns for indent guides: blank lines borrow the surrounding indentation.
    let indent = indentOf(line);
    if (indent < 0) {
      let prev = 0;
      let next = 0;
      for (let j = li - 1; j >= 0; j--) if ((prev = indentOf(shown[j])) >= 0) break;
      for (let j = li + 1; j < shown.length; j++) if ((next = indentOf(shown[j])) >= 0) break;
      indent = Math.max(0, Math.min(prev, next));
    }

    const lineDiags = diagsByLine.get(li) ?? [];
    const cells: Cell[] = [];
    let vcol = 0;
    let col = 0;
    const words: [number, number][] = [];
    if (opts.jumpLabels) for (const m of line.matchAll(/[A-Za-z0-9_]{2,}/g)) words.push([m.index!, m.index! + m[0].length]);

    const pushVirtual = (txt: string, layers: string[]) => {
      cells.push({ text: txt, offset: -1, layers: [...lineLayers, ...layers], scopes: [] });
      vcol += txt.length;
    };

    const cellLayers = (off: number, ch: string, v: number, syntax: string[]) => {
      const layers = [...lineLayers];
      if (opts.cursorcolumn && v === cursorVcol) layers.push('ui.cursorcolumn.primary');
      layers.push('ui.text');
      for (const s of syntax) layers.push(s);
      for (const d of lineDiags) {
        if (off >= d.from && off < d.to) {
          layers.push(`diagnostic.${d.severity}`);
          if (d.tag) layers.push(`diagnostic.${d.tag}`);
        }
      }
      const isWs = ch === ' ' || ch === '\t';
      if (isWs && opts.whitespace) layers.push('ui.virtual.whitespace');
      if (opts.ruler != null && v === opts.ruler) layers.push('ui.virtual.ruler');
      if (sec && off >= sec.from && off < sec.to) layers.push('@selection');
      if (off >= prim.from && off < prim.to) layers.push('@selection.primary');
      if (off === matchPos) layers.push('ui.cursor.match');
      if (sec && off === sec.head) layers.push('@cursor');
      if (off === primary.head) layers.push('@cursor.primary');
      return layers;
    };

    for (const ch of line) {
      const off = lineStart + col;
      for (const h of inlaysAt.get(off) ?? []) pushVirtual(h.text, [`ui.virtual.inlay-hint.${h.kind}`]);

      while (spanIdx < spans.length && spans[spanIdx][1] <= off) spanIdx++;
      const span = spans[spanIdx];
      const syntax = span && span[0] <= off ? span[2].map((i) => scopeNames[i]) : [];

      const width = ch === '\t' ? opts.tabWidth - (vcol % opts.tabWidth) : 1;
      let shownText: string;
      const isGuide =
        opts.indentGuides && vcol < indent && vcol % indentUnit === 0 && (ch === ' ' || ch === '\t') && indent > vcol;
      if (isGuide) shownText = '│' + ' '.repeat(width - 1);
      else if (ch === '\t') shownText = (opts.whitespace ? '→' : ' ') + ' '.repeat(width - 1);
      else if (ch === ' ') shownText = opts.whitespace ? '·' : ' ';
      else shownText = ch;

      const layers = cellLayers(off, ch, vcol, syntax);
      if (isGuide) layers.splice(layers.indexOf('ui.text') + 1 + syntax.length, 0, 'ui.virtual.indent-guide');

      if (opts.jumpLabels) {
        const w = words.find(([a, b]) => col >= a && col < b);
        if (w && col < w[0] + 2) {
          const label = jumpLabel(labelCounter + words.indexOf(w));
          shownText = label[col - w[0]];
          layers.push('ui.virtual.jump-label');
        }
      }

      cells.push({ text: shownText, offset: off, layers, scopes: syntax });
      vcol += width;
      col += ch.length;
    }
    labelCounter += words.length;

    // End of line: inlay hints at EOL, newline cell (cursor may sit there), ruler padding.
    const eolOff = lineStart + line.length;
    for (const h of inlaysAt.get(eolOff) ?? []) pushVirtual(h.text, [`ui.virtual.inlay-hint.${h.kind}`]);
    const inSel = (r: { from: number; to: number } | null) => !!r && eolOff >= r.from && eolOff < r.to;
    if (opts.whitespace || inSel(prim) || inSel(sec)) {
      const eolLayers = cellLayers(eolOff, '\n', vcol, []);
      if (opts.whitespace) eolLayers.push('ui.virtual.whitespace');
      cells.push({ text: opts.whitespace ? '⏎' : ' ', offset: eolOff, layers: eolLayers, scopes: [] });
      vcol++;
    }
    if (opts.ruler != null && vcol <= opts.ruler) {
      while (vcol < opts.ruler) pushVirtual(' ', []);
      pushVirtual(' ', ['ui.virtual.ruler']);
    }
    if (opts.cursorcolumn && vcol <= cursorVcol) {
      while (vcol < cursorVcol) pushVirtual(' ', []);
      pushVirtual(' ', ['ui.cursorcolumn.primary']);
    }
    if (opts.eolDiagnostics && lineDiags.length) {
      const d = [...lineDiags].sort((a, b) => sevRank[b.severity] - sevRank[a.severity])[0];
      pushVirtual('    ', []);
      pushVirtual(d.message, [d.severity]);
    }

    // Split into visual rows (soft wrap).
    const visualRows: Cell[][] = [[]];
    if (opts.softWrap) {
      let w = 0;
      for (const c of cells) {
        if (w + c.text.length > opts.softWrap && visualRows[visualRows.length - 1].length) {
          visualRows.push([]);
          w = opts.wrapIndicator.length;
        }
        visualRows[visualRows.length - 1].push(c);
        w += c.text.length;
      }
    } else visualRows[0] = cells;

    visualRows.forEach((rowCells, ri) => {
      const continuation = ri > 0;
      const pieces: Piece[] = [];
      if (continuation) {
        pieces.push({ text: opts.wrapIndicator, cls: reg.cls([...lineLayers, 'ui.virtual.wrap']), offset: -1, scopes: [] });
      }
      for (const c of rowCells) {
        const cls = reg.cls(c.layers);
        const last = pieces[pieces.length - 1];
        if (last && last.cls === cls && (last.offset >= 0) === (c.offset >= 0) && sameScopes(last.scopes, c.scopes)) {
          last.text += c.text;
        } else pieces.push({ text: c.text, cls, offset: c.offset, scopes: c.scopes });
      }
      rows.push({
        key: `${li}:${ri}`,
        line: li,
        continuation,
        lineCls: reg.cls(lineLayers),
        gutter: gutterFor(li, continuation, isCursorLine, lineLayers),
        pieces,
      });
    });

    lineStart += line.length + 1;
  }

  function gutterFor(li: number, continuation: boolean, selected: boolean, lineLayers: string[]): Piece[] {
    const g = [...lineLayers, selected ? 'ui.gutter.selected' : 'ui.gutter'];
    if (continuation) g[g.length - 1] += '.virtual';
    const piece = (text: string, extra: string[] = []) => ({ text, cls: reg.cls([...g, ...extra]), offset: -1, scopes: [] });
    if (continuation) return [piece(' '.repeat(digits + 4))];

    let sign = piece(' ');
    const diags = diagsByLine.get(li);
    if (opts.debug && deco.frameLine === li) sign = piece('▶', ['ui.debug.active']);
    else if (opts.debug && deco.breakpoint === li) sign = piece('●', ['ui.debug.breakpoint']);
    else if (diags?.length) {
      const worst = diags.reduce((a, b) => (sevRank[b.severity] > sevRank[a.severity] ? b : a));
      sign = piece('●', [worst.severity]);
    }
    const n = opts.relativeNumbers && !selected ? Math.abs(li - cursorLine) : li + 1;
    const num = piece(String(n).padStart(digits), [selected ? 'ui.linenr.selected' : 'ui.linenr']);
    const diff = deco.diff.get(li);
    const diffPiece = diff
      ? piece(diff === 'minus' ? '▔' : '▍', [`diff.${diff}.gutter`])
      : piece(' ');
    return [sign, piece(' '), num, piece(' '), diffPiece];
  }

  return { rows, truncated };
}

function sameScopes(a: string[], b: string[]) {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function detectIndentUnit(lines: string[], tabWidth: number): number {
  const counts = new Map<number, number>();
  let prev = 0;
  for (const l of lines.slice(0, 500)) {
    if (!l.trim()) continue;
    if (l.startsWith('\t')) return tabWidth;
    const n = l.length - l.trimStart().length;
    const diff = Math.abs(n - prev);
    if (diff > 0) counts.set(diff, (counts.get(diff) ?? 0) + 1);
    prev = n;
  }
  let best = 4;
  let bestN = 0;
  for (const [k, v] of counts) if (v > bestN && k <= 8) [best, bestN] = [k, v];
  return best;
}

// ---------------------------------------------------------------------------
// Synthesised decorations so every UI scope has something to show on real code.

export function synthesizeDecorations(text: string): { deco: Decorations; primary: Selection; secondary: Selection | null } {
  const lines = text.split('\n');
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const wordIn = (li: number, minLen = 3): [number, number] | null => {
    const m = /[A-Za-z_][A-Za-z0-9_]{2,}/.exec(lines[li].slice(0));
    if (!m || m[0].length < minLen) return null;
    return [starts[li] + m.index, starts[li] + m.index + m[0].length];
  };
  const contentLines = lines.map((l, i) => (l.trim().length >= 8 ? i : -1)).filter((i) => i >= 0);

  // Primary cursor a little way into the file, on a word.
  const cursorLine = contentLines.find((i) => i >= Math.min(6, lines.length - 1)) ?? contentLines[0] ?? 0;
  const lastWord = [...(lines[cursorLine] ?? '').matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)][0];
  const primary: Selection = lastWord
    ? { anchor: starts[cursorLine] + lastWord.index!, head: starts[cursorLine] + lastWord.index! + lastWord[0].length - 1 }
    : { anchor: starts[cursorLine] ?? 0, head: starts[cursorLine] ?? 0 };

  const secLine = contentLines.find((i) => i > cursorLine + 1);
  let secondary: Selection | null = null;
  if (secLine !== undefined) {
    const w = wordIn(secLine);
    if (w) secondary = { anchor: w[0], head: w[1] - 1 };
  }

  const diagnostics: Diagnostic[] = [];
  const kinds: [Severity, string, Diagnostic['tag']?][] = [
    ['error', 'mismatched types: expected `u32`, found `&str`'],
    ['warning', 'unused variable: consider prefixing with an underscore'],
    ['info', 'this value is only read once'],
    ['hint', 'consider removing this clone'],
    ['hint', 'unnecessary: this code is unreachable', 'unnecessary'],
    ['warning', 'deprecated: use the newer API instead', 'deprecated'],
  ];
  let k = 0;
  for (const li of contentLines) {
    if (k >= kinds.length) break;
    if (li <= 1 || li === cursorLine || li === secLine) continue;
    if (diagnostics.length && li - lineOfOffset(starts, diagnostics[diagnostics.length - 1].from) < 3) continue;
    const w = wordIn(li);
    if (!w) continue;
    const [severity, message, tag] = kinds[k++];
    diagnostics.push({ from: w[0], to: w[1], severity, message, tag });
  }

  const diff = new Map<number, 'plus' | 'delta' | 'minus'>();
  if (lines.length > 3) {
    diff.set(1, 'plus');
    diff.set(2, 'plus');
  }
  if (diagnostics[0]) diff.set(lineOfOffset(starts, diagnostics[0].from), 'delta');
  const delLine = contentLines.find((i) => i > cursorLine + 3);
  if (delLine !== undefined) diff.set(delLine, 'minus');

  const inlays: InlayHint[] = [];
  const letRe = /\b(?:let|const|var|val)\s+(?:mut\s+)?([A-Za-z_]\w*)\s*(?==)/g;
  for (const m of text.matchAll(letRe)) {
    if (inlays.length >= 2) break;
    inlays.push({ at: m.index! + m[0].trimEnd().length, text: ': Vec<u8>', kind: 'type' });
  }
  const callRe = /\b(?!if\b|for\b|while\b|match\b|fn\b|function\b|def\b|return\b)([a-z_]\w*)\((?=[A-Za-z0-9"'&])/g;
  for (const m of text.matchAll(callRe)) {
    const at = m.index! + m[0].length;
    const lineStart = text.lastIndexOf('\n', at) + 1;
    if (/^\s*(pub\s+)?(fn|def|function|func)\b/.test(text.slice(lineStart, at))) continue;
    inlays.push({ at, text: 'value: ', kind: 'parameter' });
    break;
  }
  if (!inlays.some((h) => h.kind === 'type') && contentLines[2] !== undefined) {
    inlays.push({ at: starts[contentLines[2]] + lines[contentLines[2]].length, text: ' -> Result<()>', kind: 'type' });
  }

  const bp = contentLines.find((i) => i > cursorLine + 5);
  const frame = contentLines.find((i) => bp !== undefined && i > bp);
  return {
    deco: { diagnostics, diff, inlays, breakpoint: bp ?? null, frameLine: frame ?? null },
    primary,
    secondary,
  };
}

function lineOfOffset(starts: number[], off: number) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function offsetToLineCol(text: string, off: number) {
  const before = text.slice(0, off);
  const line = before.split('\n').length - 1;
  return { line, col: off - (before.lastIndexOf('\n') + 1) };
}

