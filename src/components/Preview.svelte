<script lang="ts">
  import { api } from '../lib/api';
  import { SAMPLES } from '../lib/samples';
  import { editor } from '../lib/store.svelte';
  import { resolveKey } from '../lib/theme';
  import EditorView from './EditorView.svelte';

  let pathInput = $state('');
  let editing = $state(false);
  let fileInput: HTMLInputElement;
  let showOptions = $state(false);

  const view = $derived(editor.view);
  const sampleNames = SAMPLES.map((s) => s.name);
  const isSample = $derived(!editor.code.path && sampleNames.includes(editor.code.name));

  // Re-highlight when the code or language changes (debounced for typing).
  $effect(() => {
    editor.code.text;
    editor.code.language;
    editor.code.name;
    const t = setTimeout(() => {
      editor.rehighlight();
      editor.persistCode();
    }, 150);
    return () => clearTimeout(t);
  });

  function pickSample(name: string) {
    const s = SAMPLES.find((x) => x.name === name);
    if (s) editor.setCode({ name: s.name, text: s.text, language: null });
  }

  async function loadPath() {
    const p = pathInput.trim();
    if (!p) return;
    try {
      const f = await api.file(p);
      editor.setCode({ name: f.name, text: f.text, language: null, path: f.path });
      editor.notify('ok', `Loaded ${f.path}${f.language ? ` as ${f.language}` : ''}`);
    } catch (e) {
      editor.notify('error', (e as Error).message);
    }
  }

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return editor.notify('error', 'File is larger than 2 MB');
    const text = await file.text();
    editor.setCode({ name: file.name, text, language: null });
    (e.currentTarget as HTMLInputElement).value = '';
  }

  function onDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    file.text().then((text) => editor.setCode({ name: file.name, text, language: null }));
  }

  const toggles: [keyof typeof view, string, string][] = [
    ['cursorline', 'Cursorline', 'ui.cursorline.*'],
    ['cursorcolumn', 'Cursorcolumn', 'ui.cursorcolumn.*'],
    ['indentGuides', 'Indent guides', 'ui.virtual.indent-guide'],
    ['whitespace', 'Whitespace', 'ui.virtual.whitespace'],
    ['inlayHints', 'Inlay hints', 'ui.virtual.inlay-hint.*'],
    ['eolDiagnostics', 'EOL diagnostics', 'error / warning / info / hint'],
    ['jumpLabels', 'Jump labels', 'ui.virtual.jump-label'],
    ['relativeNumbers', 'Relative numbers', 'ui.linenr'],
    ['debug', 'Debugger', 'ui.debug.*, ui.highlight.frameline'],
    ['bufferline', 'Bufferline', 'ui.bufferline.*'],
    ['split', 'Split', 'ui.window, ui.statusline.inactive'],
    ['colorModes', 'Color modes', 'ui.statusline.normal/insert/select'],
  ];

  const popups = [
    ['none', 'None'],
    ['completion', 'Completion'],
    ['hover', 'Hover docs'],
    ['info', 'Key info'],
    ['command', 'Command'],
    ['picker', 'Picker'],
  ];

  const inspectKeys = $derived(
    (editor.inspect?.scopes ?? []).map((s) => ({ scope: s, key: resolveKey(editor.doc, s) })),
  );
</script>

<div class="toolbar">
  <div class="row">
    <select value={isSample ? editor.code.name : ''} onchange={(e) => pickSample((e.currentTarget as HTMLSelectElement).value)} title="Sample code">
      {#if !isSample}<option value="">{editor.code.name}</option>{/if}
      {#each SAMPLES as s}<option value={s.name}>{s.name}</option>{/each}
    </select>
    <button onclick={() => fileInput.click()} title="Open a file from your computer">Open file…</button>
    <input type="file" bind:this={fileInput} onchange={onFile} hidden />
    <input
      class="mono path"
      bind:value={pathInput}
      placeholder="~/path/to/file.rs"
      onkeydown={(e) => e.key === 'Enter' && loadPath()}
      spellcheck="false"
      title="Load a file by path from this machine"
    />
    <button onclick={loadPath} disabled={!pathInput.trim()}>Load</button>
    <select
      value={editor.code.language ?? ''}
      onchange={(e) => (editor.code.language = (e.currentTarget as HTMLSelectElement).value || null)}
      title="Language"
    >
      <option value="">Auto{editor.highlight?.language && !editor.code.language ? ` (${editor.highlight.language})` : ''}</option>
      {#each editor.languages as l}<option value={l.name}>{l.name}</option>{/each}
    </select>
    <button class:on={editing} onclick={() => (editing = !editing)} title="Edit or paste the preview text">{editing ? 'Done' : 'Edit text'}</button>
  </div>

  <div class="row">
    <div class="seg" title="Editor mode (affects cursor and statusline scopes)">
      {#each [['normal', 'NOR'], ['insert', 'INS'], ['select', 'SEL']] as [m, label]}
        <button class:on={view.mode === m} onclick={() => (editor.view.mode = m as typeof view.mode)}>{label}</button>
      {/each}
    </div>
    <label class="popup-sel">
      Popup
      <select bind:value={editor.view.popup}>
        {#each popups as [id, label]}<option value={id}>{label}</option>{/each}
      </select>
    </label>
    <div class="options-wrap">
      <button onclick={() => (showOptions = !showOptions)} class:on={showOptions}>View options ▾</button>
      {#if showOptions}
        <div class="options">
          {#each toggles as [key, label, scopes]}
            <label title={scopes}><input type="checkbox" bind:checked={editor.view[key] as boolean} /> {label}</label>
          {/each}
          <label title="ui.virtual.ruler">
            <input
              type="checkbox"
              checked={view.ruler != null}
              onchange={(e) => (editor.view.ruler = (e.currentTarget as HTMLInputElement).checked ? 79 : null)}
            /> Ruler
            {#if view.ruler != null}<input class="num" type="number" min="1" value={view.ruler + 1} oninput={(e) => (editor.view.ruler = Math.max(0, +(e.currentTarget as HTMLInputElement).value - 1))} />{/if}
          </label>
          <label title="ui.virtual.wrap, ui.gutter.virtual">
            <input
              type="checkbox"
              checked={view.softWrap != null}
              onchange={(e) => (editor.view.softWrap = (e.currentTarget as HTMLInputElement).checked ? 80 : null)}
            /> Soft wrap
            {#if view.softWrap != null}<input class="num" type="number" min="20" value={view.softWrap} oninput={(e) => (editor.view.softWrap = Math.max(20, +(e.currentTarget as HTMLInputElement).value))} />{/if}
          </label>
          <div class="term">
            <span title="Used where the theme leaves fg/bg unset (terminal defaults)">Terminal</span>
            <input type="color" bind:value={editor.view.terminalFg} title="Default foreground" />
            <input type="color" bind:value={editor.view.terminalBg} title="Default background" />
          </div>
        </div>
      {/if}
    </div>
    <span class="grow"></span>
    {#if editor.highlighting}<span class="faint">highlighting…</span>{/if}
    {#if editor.highlight && !editor.highlight.ok}
      <span class="hl-error" title={editor.highlight.error}>⚠ {editor.highlight.error}</span>
    {:else if editor.highlight?.warnings?.length}
      <span class="hl-warn" title={editor.highlight.warnings.join('\n')}>⚠ {editor.highlight.warnings[0]}</span>
    {/if}
  </div>
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="stage" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  {#if editing}
    <textarea
      class="mono"
      spellcheck="false"
      value={editor.code.text}
      oninput={(e) => (editor.code = { ...editor.code, text: (e.currentTarget as HTMLTextAreaElement).value })}
    ></textarea>
  {:else}
    <EditorView />
  {/if}
</div>

<div class="inspector">
  {#if editor.inspect && editor.inspect.scopes.length}
    <span class="faint">Scopes under pointer:</span>
    {#each inspectKeys as { scope, key }, i}
      {#if i}<span class="faint">›</span>{/if}
      <button class="scope mono" onclick={() => (editor.selected = scope)} title={key ? `Styled by ${key}` : 'Not styled by this theme'}>
        {scope}{#if key && key !== scope}<span class="faint"> → {key}</span>{:else if !key}<span class="faint"> (unstyled)</span>{/if}
      </button>
    {/each}
  {:else}
    <span class="faint">Hover code to inspect its scopes · click to move the cursor · shift-click to extend · double-click to edit a token's scope · drop a file to preview it</span>
  {/if}
</div>

<style>
  .toolbar {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .path {
    flex: 1;
    min-width: 140px;
    max-width: 360px;
  }
  button.on {
    border-color: var(--accent);
    background: var(--bg-4);
  }
  .seg {
    display: flex;
  }
  .seg button {
    border-radius: 0;
    font-family: var(--mono);
    font-size: 12px;
  }
  .seg button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .seg button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .seg button + button {
    border-left: none;
  }
  .popup-sel {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
  }
  .options-wrap {
    position: relative;
  }
  .options {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    background: var(--bg-2);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px #000a;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(150px, auto));
    gap: 6px 16px;
    white-space: nowrap;
  }
  .options label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 56px;
    background: var(--bg);
    border: 1px solid var(--line-2);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .term {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 6px;
    border-top: 1px solid var(--line);
    padding-top: 8px;
    color: var(--text-2);
  }
  .grow {
    flex: 1;
  }
  .hl-error,
  .hl-warn {
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .hl-error {
    color: var(--err);
  }
  .hl-warn {
    color: var(--warn);
  }
  .stage {
    flex: 1;
    min-height: 0;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
  }
  .stage textarea {
    flex: 1;
    resize: none;
    font-size: 13px;
    line-height: 1.45;
    white-space: pre;
    tab-size: 4;
  }
  .inspector {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 8px;
    min-height: 34px;
    font-size: 12px;
    flex-wrap: wrap;
    border-top: 1px solid var(--line);
    background: var(--bg-2);
  }
  .scope {
    font-size: 11.5px;
    padding: 1px 7px;
  }
</style>
