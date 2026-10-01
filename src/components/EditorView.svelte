<script lang="ts">
  import { tick } from 'svelte';
  import {
    StyleRegistry,
    buildView,
    layersCss,
    offsetToLineCol,
    resolveLayers,
    stylesheet,
    synthesizeDecorations,
    type Selection,
  } from '../lib/render';
  import { editor } from '../lib/store.svelte';
  import { toCss } from '../lib/theme';

  const view = $derived(editor.view);
  const mode = $derived(view.mode);
  const paint = $derived({ fg: view.terminalFg, bg: view.terminalBg });
  const text = $derived(editor.code.text);
  const fileName = $derived(editor.code.name || 'untitled');
  const borders = $derived(editor.env?.editor?.['popup-border'] ?? 'none');

  // --- selection state (reset whenever the code changes) ----------------------
  const synth = $derived(synthesizeDecorations(text));
  let primary = $state<Selection>({ anchor: 0, head: 0 });
  let secondary = $state<Selection | null>(null);
  $effect(() => {
    primary = synth.primary;
    secondary = synth.secondary;
  });

  // --- view model (theme independent) -------------------------------------------
  const hl = $derived(editor.highlight);
  const model = $derived.by(() => {
    const reg = new StyleRegistry();
    const input = {
      text,
      spans: hl?.ok ? hl.spans : [],
      scopeNames: hl?.ok ? hl.scopes : [],
      deco: synth.deco,
      opts: view,
    };
    const main = buildView({ ...input, primary, secondary }, reg);
    const other = view.split
      ? buildView(
          {
            ...input,
            primary: { anchor: -10, head: -10 },
            secondary: null,
            opts: { ...view, cursorline: false, cursorcolumn: false, jumpLabels: false, eolDiagnostics: false, relativeNumbers: false },
            maxLines: 400,
          },
          reg,
        )
      : null;
    return { reg, main, other };
  });

  // --- styles (theme dependent) -----------------------------------------------
  const sheet = $derived(stylesheet(editor.doc, model.reg, mode, paint, '.hxv'));
  const css = (layers: string[]) => layersCss(editor.doc, layers, mode, paint);
  const cssT = (layers: string[]) => toCss(resolveLayers(editor.doc, layers, mode), paint, { transparentBg: true });

  const modeLabel = $derived({ normal: 'NOR', insert: 'INS', select: 'SEL' }[mode]);
  const pos = $derived(offsetToLineCol(text, Math.max(0, primary.head)));
  const diagCounts = $derived.by(() => {
    const c = { error: 0, warning: 0, info: 0, hint: 0 };
    for (const d of synth.deco.diagnostics) c[d.severity]++;
    return c;
  });

  // --- interaction ----------------------------------------------------------------
  function offsetFromEvent(e: MouseEvent): number | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-o]');
    if (!el) return null;
    const base = Number(el.dataset.o);
    if (el.dataset.exact !== '1') return base;
    const doc = document as any;
    let idx = 0;
    if (doc.caretPositionFromPoint) idx = doc.caretPositionFromPoint(e.clientX, e.clientY)?.offset ?? 0;
    else if (doc.caretRangeFromPoint) idx = doc.caretRangeFromPoint(e.clientX, e.clientY)?.startOffset ?? 0;
    return base + Math.min(idx, (el.textContent?.length ?? 1) - 1);
  }

  function onMouseDown(e: MouseEvent) {
    const off = offsetFromEvent(e);
    if (off == null) return;
    e.preventDefault();
    if (e.shiftKey) primary = { anchor: primary.anchor, head: off };
    else primary = { anchor: off, head: off };
  }

  function onDblClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-o]');
    const off = offsetFromEvent(e);
    if (off == null || !el) return;
    let a = off;
    let b = off;
    while (a > 0 && /\w/.test(text[a - 1])) a--;
    while (b < text.length - 1 && /\w/.test(text[b + 1])) b++;
    primary = { anchor: a, head: b };
    const scopes = (el.dataset.s || '').split(' ').filter(Boolean);
    if (scopes.length) editor.selected = scopes[scopes.length - 1];
  }

  function onHover(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-o]');
    if (!el) return;
    const scopes = (el.dataset.s || '').split(' ').filter(Boolean);
    editor.inspect = { scopes, text: el.textContent ?? '' };
  }

  // --- popup placement ------------------------------------------------------------
  let frame: HTMLDivElement;
  let cursorBox = $state<{ x: number; y: number; h: number } | null>(null);
  $effect(() => {
    model;
    view.popup;
    tick().then(measure);
  });
  function measure() {
    const el = frame?.querySelector<HTMLElement>('[data-primary]');
    if (!el || !frame) return (cursorBox = null);
    const f = frame.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    cursorBox = { x: r.left - f.left, y: r.top - f.top, h: r.height };
  }

  const completions = [
    ['to_string', 'method'],
    ['to_owned', 'method'],
    ['total_area', 'function'],
    ['TryFrom', 'trait'],
    ['Token', 'struct'],
    ['toggle', 'field'],
    ['to_vec', 'method'],
  ];
  const pickerItems = [
    ['src/', 'main.rs', '2 min ago'],
    ['src/', 'theme.rs', '1 hour ago'],
    ['src/render/', 'mod.rs', 'yesterday'],
    ['tests/', 'theme_test.rs', 'last week'],
    ['', 'Cargo.toml', 'last week'],
  ];
  const infoItems = [
    ['f', 'Open file picker'],
    ['b', 'Open buffer picker'],
    ['k', 'Show docs for item under cursor'],
    ['s', 'Open symbol picker'],
    ['w', 'Window'],
    ['?', 'Open command palette'],
  ];

  /** helix menu scrollbar: thumb drawn with ui.menu.scroll fg, track with its bg. */
  function scrollCss(i: number, selected: boolean) {
    const scroll = resolveLayers(editor.doc, ['ui.menu.scroll'], mode);
    const color = i < 3 ? scroll.fg : scroll.bg;
    return cssT(selected ? ['ui.menu', 'ui.menu.selected'] : ['ui.menu']) + (color ? `;color:${color}` : ';opacity:.4');
  }

  function matchSpans(s: string, q: string) {
    const out: { t: string; m: boolean }[] = [];
    let qi = 0;
    for (const ch of s) {
      const m = qi < q.length && ch.toLowerCase() === q[qi];
      if (m) qi++;
      out.push({ t: ch, m });
    }
    return out;
  }
</script>

{@html `<style>${sheet}</style>`}

<div class="hxv frame" bind:this={frame} style={css(['ui.background'])}>
  {#if view.bufferline}
    <div class="bufferline" style={css(['ui.bufferline.background'])}>
      <span style={css(['ui.bufferline.active'])}>&nbsp;{fileName}&nbsp;</span><span style={css(['ui.bufferline'])}>&nbsp;lib.rs&nbsp;</span><span style={css(['ui.bufferline'])}>&nbsp;Cargo.toml [+]&nbsp;</span>
    </div>
  {/if}

  <div class="panes">
    <div class="pane">
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_mouse_events_have_key_events -->
      <div class="rows" onmousedown={onMouseDown} ondblclick={onDblClick} onmouseover={onHover} onscroll={measure}>
        {#each model.main.rows as row (row.key)}
          <div class="row {row.lineCls}">
            <span class="gutter">{#each row.gutter as g}<span class={g.cls}>{g.text}</span>{/each}</span><span class="code"
              >{#each row.pieces as p}{#if p.offset >= 0}<span
                    class={p.cls}
                    data-o={p.offset}
                    data-s={p.scopes.join(' ')}
                    data-exact={p.text.length === 1 || !/[\t]/.test(text.slice(p.offset, p.offset + p.text.length)) ? '1' : '0'}
                    data-primary={p.offset === primary.head ? '' : undefined}>{p.text}</span
                  >{:else}<span class={p.cls}>{p.text}</span>{/if}{/each}</span
            >
          </div>
        {/each}
        {#if model.main.truncated}
          <div class="truncated">… preview truncated to 4000 lines</div>
        {/if}
      </div>
      <div class="statusline" style={css(['ui.statusline'])}>
        <span style={css(['ui.statusline', ...(view.colorModes ? ['@statusline.mode'] : [])])}>&nbsp;{modeLabel}&nbsp;</span>
        <span>&nbsp;&nbsp;{editor.code.path ?? fileName}{editor.dirty ? ' [+]' : ''}</span>
        <span class="grow"></span>
        {#if diagCounts.warning}<span style={css(['ui.statusline', 'warning'])}>●</span>&nbsp;{diagCounts.warning}&nbsp;{/if}
        {#if diagCounts.error}<span style={css(['ui.statusline', 'error'])}>●</span>&nbsp;{diagCounts.error}&nbsp;{/if}
        <span style={css(['ui.statusline', 'ui.statusline.separator'])}>│</span>
        <span>&nbsp;{secondary ? 2 : 1} sel{secondary ? 's' : ''}&nbsp;</span>
        <span style={css(['ui.statusline', 'ui.statusline.separator'])}>│</span>
        <span>&nbsp;{pos.line + 1}:{pos.col + 1}&nbsp;</span>
        <span style={css(['ui.statusline', 'ui.statusline.separator'])}>│</span>
        <span>&nbsp;{editor.highlight?.language ?? 'text'}&nbsp;</span>
      </div>
    </div>

    {#if model.other}
      <div class="separator" style={css(['ui.background', 'ui.window'])}></div>
      <div class="pane">
        <div class="rows">
          {#each model.other.rows as row (row.key)}
            <div class="row {row.lineCls}">
              <span class="gutter">{#each row.gutter as g}<span class={g.cls}>{g.text}</span>{/each}</span><span class="code"
                >{#each row.pieces as p}<span class={p.cls}>{p.text}</span>{/each}</span
              >
            </div>
          {/each}
        </div>
        <div class="statusline" style={css(['ui.statusline.inactive'])}>
          <span>&nbsp;{modeLabel}&nbsp;&nbsp;&nbsp;{fileName}</span>
          <span class="grow"></span>
          <span>{pos.line + 1}:{pos.col + 1}&nbsp;</span>
        </div>
      </div>
    {/if}
  </div>

  <div class="cmdline" style={css(['ui.background', 'ui.text'])}>
    {#if view.popup === 'command'}
      <span>:th</span><span style={css(['ui.background', '@cursor.primary'])}>&nbsp;</span>
    {:else if view.popup === 'info'}
      <span class="grow"></span><span>space&nbsp;</span>
    {:else}
      <span>Loaded {editor.code.path ?? fileName}</span>
    {/if}
  </div>

  <!-- Popups -->
  {#if view.popup === 'completion' && cursorBox}
    <div class="float" style="left:{cursorBox.x}px; top:{cursorBox.y + cursorBox.h}px">
      <div class="menu" class:bordered={borders === 'all' || borders === 'menu'} style={css(['ui.menu'])}>
        {#each completions as [name, kind], i}
          <div class="menu-item" style={css(i === 1 ? ['ui.menu', 'ui.menu.selected'] : ['ui.menu'])}>
            <span>{name}</span><span class="kind">{kind}</span>
            <span style={scrollCss(i, i === 1)}>▐</span>
          </div>
        {/each}
      </div>
      <div class="popup doc" class:bordered={borders === 'all' || borders === 'popup'} style={css(['ui.popup'])}>
        <div>
          <span style={cssT(['ui.text', 'keyword.function'])}>fn</span>
          <span style={cssT(['ui.text', 'function.method'])}>to_owned</span><span style={cssT(['ui.text', 'punctuation.bracket'])}>(</span><span
            style={cssT(['ui.text', 'operator'])}>&amp;</span
          ><span style={cssT(['ui.text', 'variable.builtin'])}>self</span><span style={cssT(['ui.text', 'punctuation.bracket'])}>)</span>
          <span style={cssT(['ui.text', 'operator'])}>-&gt;</span>
          <span style={cssT(['ui.text', 'type'])}>Self</span><span style={cssT(['ui.text', 'punctuation.delimiter'])}>::</span><span
            style={cssT(['ui.text', 'type'])}>Owned</span
          >
        </div>
        <div>&nbsp;</div>
        <div style={cssT(['ui.text'])}>Creates owned data from borrowed data, usually by cloning.</div>
        <div style={cssT(['ui.text'])}>See <span style={cssT(['ui.text', 'markup.raw.inline'])}>Clone</span> for details.</div>
      </div>
    </div>
  {/if}

  {#if view.popup === 'hover' && cursorBox}
    <div class="float up" style="left:{cursorBox.x}px; bottom:calc(100% - {cursorBox.y}px)">
      <div class="popup" class:bordered={borders === 'all' || borders === 'popup'} style={css(['ui.popup'])}>
        <div style={cssT(['ui.text', 'markup.heading'])}>total_area</div>
        <div>
          <span style={cssT(['ui.text', 'keyword.function'])}>fn</span>
          <span style={cssT(['ui.text', 'function'])}>total_area</span><span style={cssT(['ui.text', 'punctuation.bracket'])}>(</span><span
            style={cssT(['ui.text', 'variable.parameter'])}>shapes</span
          ><span style={cssT(['ui.text', 'punctuation.delimiter'])}>:</span>
          <span style={cssT(['ui.text', 'operator'])}>&amp;</span><span style={cssT(['ui.text', 'punctuation.bracket'])}>[</span><span
            style={cssT(['ui.text', 'type'])}>Shape</span
          ><span style={cssT(['ui.text', 'punctuation.bracket'])}>])</span>
          <span style={cssT(['ui.text', 'operator'])}>-&gt;</span> <span style={cssT(['ui.text', 'type.builtin'])}>f64</span>
        </div>
        <div style={cssT(['ui.text'])}>───</div>
        <div style={cssT(['ui.text'])}>Computes the <span style={cssT(['ui.text', 'markup.bold'])}>total</span> area of <span style={cssT(['ui.text', 'markup.italic'])}>all</span> shapes.</div>
        <div style={cssT(['ui.text'])}><span style={cssT(['ui.text', 'markup.link.text'])}>docs</span> <span style={cssT(['ui.text', 'markup.link.url'])}>https://docs.rs</span></div>
      </div>
    </div>
  {/if}

  {#if view.popup === 'info'}
    <div class="float info" class:bordered={borders !== 'none'} style={css(['ui.popup.info'])}>
      <div class="info-title" style={cssT(['ui.popup.info', 'ui.text.info'])}>Space</div>
      {#each infoItems as [k, desc]}
        <div style={cssT(['ui.popup.info', 'ui.text.info'])}><span class="key">{k}</span>{desc}</div>
      {/each}
    </div>
  {/if}

  {#if view.popup === 'command'}
    <div class="float command">
      <div class="popup help" class:bordered={borders !== 'none'} style={css(['ui.help'])}>
        <div>Change the editor theme (show current theme if no name specified).</div>
        <div>&nbsp;</div>
        <div>Aliases: th</div>
      </div>
      <div class="menu grid" style={css(['ui.menu'])}>
        {#each ['theme', 'theme-reload', 'tree-sitter-scopes', 'tree-sitter-highlight-name', 'tree-sitter-subtree', 'tutor'] as c, i}
          <span style={css(i === 0 ? ['ui.menu', 'ui.menu.selected'] : ['ui.menu'])}>&nbsp;{c}&nbsp;</span>
        {/each}
      </div>
    </div>
  {/if}

  {#if view.popup === 'picker'}
    <div class="picker bordered" style={css(['ui.background'])}>
      <div class="pick-list">
        <div class="prompt" style={cssT(['ui.text'])}>
          <span>&gt; thm</span><span style={css(['ui.background', '@cursor.primary'])}>&nbsp;</span>
          <span class="grow"></span><span style={cssT(['ui.text.inactive'])}>5/128</span>
        </div>
        <div class="sep" style={cssT(['ui.background.separator'])}>{'─'.repeat(200)}</div>
        <div class="pick-header" style={css(['ui.background', 'ui.picker.header'])}>
          <span style={cssT(['ui.picker.header', 'ui.picker.header.column.active'])}>path</span>
          <span style={cssT(['ui.picker.header', 'ui.picker.header.column'])}>modified</span>
        </div>
        {#each pickerItems as [dir, file, when], i}
          <div class="pick-item" style={css(i === 1 ? ['ui.background', 'ui.text', 'ui.text.focus'] : ['ui.background', 'ui.text'])}>
            <span>
              <span style={cssT(i === 1 ? ['ui.text', 'ui.text.focus', 'ui.text.directory'] : ['ui.text', 'ui.text.directory'])}>{dir}</span
              >{#each matchSpans(file, 'thm') as c}<span style={c.m ? cssT(['ui.text', ...(i === 1 ? ['ui.text.focus'] : []), 'special']) + ';font-weight:700' : ''}>{c.t}</span>{/each}
            </span>
            <span style={cssT(['ui.text.inactive'])}>{when}</span>
          </div>
        {/each}
      </div>
      <div class="pick-preview bordered-left" style={css(['ui.background'])}>
        {#each model.main.rows.filter((r) => !r.continuation).slice(0, 24) as row, i (row.key)}
          <div class="pv-row" style={i === 4 ? css(['ui.background', 'ui.highlight']) : ''}>
            {#each row.pieces.filter((p) => p.offset >= 0) as p}<span style={cssT(['ui.text', ...p.scopes])}>{text.slice(p.offset, p.offset + p.text.length).replace(/\n/g, '')}</span>{/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .frame {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--mono);
    font-size: 13.5px;
    line-height: 1.45;
    overflow: hidden;
    border-radius: 6px;
    border: 1px solid var(--line);
    font-variant-ligatures: none;
  }
  .bufferline,
  .statusline,
  .cmdline {
    display: flex;
    white-space: pre;
    flex: none;
    overflow: hidden;
  }
  .grow {
    flex: 1;
  }
  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .separator {
    width: 1ch;
    flex: none;
    background-image: linear-gradient(currentColor, currentColor);
    background-size: 1px 100%;
    background-repeat: no-repeat;
    background-position: center;
  }
  .rows {
    flex: 1;
    overflow: auto;
    cursor: text;
    user-select: none;
  }
  .row {
    white-space: pre;
    min-width: max-content;
    display: block;
  }
  .gutter {
    display: inline-block;
  }
  .truncated {
    padding: 4px 8px;
    opacity: 0.6;
  }
  .float {
    position: absolute;
    display: flex;
    gap: 0;
    z-index: 5;
    white-space: pre;
    align-items: flex-start;
  }
  .bordered {
    border: 1px solid currentColor;
    border-radius: 4px;
  }
  .menu {
    padding: 0;
    min-width: 24ch;
  }
  .menu-item {
    display: flex;
    gap: 2ch;
    padding: 0 0 0 1ch;
  }
  .menu-item .kind {
    margin-left: auto;
  }
  .popup {
    padding: 0 1ch;
    max-width: 60ch;
    white-space: normal;
  }
  .doc {
    margin-left: 1ch;
  }
  .float.up {
    align-items: flex-end;
  }
  .info {
    right: 1ch;
    bottom: 3.2em;
    flex-direction: column;
    padding: 0 1ch;
    align-items: stretch;
  }
  .info-title {
    text-align: center;
    font-weight: 700;
  }
  .info .key {
    display: inline-block;
    width: 3ch;
  }
  .command {
    left: 0;
    right: 0;
    bottom: 1.45em;
    flex-direction: column;
    align-items: stretch;
  }
  .command .help {
    align-self: flex-end;
    margin: 0 1ch 0 0;
    max-width: 50ch;
  }
  .menu.grid {
    display: flex;
    flex-wrap: wrap;
  }
  .picker {
    position: absolute;
    inset: 8% 6%;
    display: flex;
    z-index: 6;
    white-space: pre;
  }
  .pick-list {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .prompt {
    display: flex;
    padding: 0 1ch;
  }
  .sep {
    overflow: hidden;
  }
  .pick-header,
  .pick-item {
    display: grid;
    grid-template-columns: 1fr 14ch;
    padding: 0 1ch;
  }
  .pick-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    border-left: 1px solid currentColor;
  }
  .pv-row {
    padding: 0 1ch;
  }
</style>
