<script lang="ts">
  import { parse } from 'smol-toml';
  import { api } from '../lib/api';
  import { editor } from '../lib/store.svelte';
  import { docFromResolved } from '../lib/theme';

  let inherit = $state(false);
  let draft = $state<string | null>(null);
  let error = $state<string | null>(null);

  const canInherit = $derived(!!editor.doc.base && !!editor.baseDoc);
  const generated = $derived(editor.tomlFor(inherit && canInherit));
  const text = $derived(draft ?? generated);

  async function apply() {
    if (draft == null) return;
    error = null;
    try {
      const parsed = parse(draft) as Record<string, any>;
      let palette = (parsed.palette ?? {}) as Record<string, unknown>;
      const { palette: _p, inherits, ...styles } = parsed;
      let merged: Record<string, unknown> = styles;
      if (typeof inherits === 'string') {
        // Resolve the parent like helix: palette merged per key, other keys replaced.
        const parent =
          inherits === editor.doc.base && editor.baseDoc
            ? { palette: editor.baseDoc.palette, styles: { ...editor.baseDoc.styles, ...editor.baseDoc.extras } }
            : await api.theme(inherits);
        palette = { ...parent.palette, ...palette };
        merged = { ...parent.styles, ...styles };
      }
      const { doc, warnings } = docFromResolved(editor.doc.name, editor.doc.base, palette, merged);
      editor.replaceDoc(doc);
      editor.warnings = warnings;
      draft = null;
      editor.notify('ok', warnings.length ? `Applied with ${warnings.length} warning(s)` : 'Applied TOML');
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function copy() {
    navigator.clipboard?.writeText(text);
    editor.notify('ok', 'Copied to clipboard');
  }
</script>

<div class="bar">
  <div class="seg">
    <button class:on={!inherit} onclick={() => (inherit = false)}>Standalone</button>
    <button class:on={inherit} disabled={!canInherit} onclick={() => (inherit = true)} title="Only write differences and inherit the rest from the base theme">
      Inherit from {editor.doc.base ?? 'base'}
    </button>
  </div>
  <div class="grow"></div>
  <button class="ghost" onclick={copy}>Copy</button>
</div>

{#if draft != null}
  <div class="apply">
    <span>Edited — apply to replace the current theme (undoable).</span>
    <button class="primary" onclick={apply}>Apply</button>
    <button class="ghost" onclick={() => ((draft = null), (error = null))}>Discard</button>
  </div>
{/if}
{#if error}<div class="error">{error}</div>{/if}
{#if editor.warnings.length}
  <details class="warnings">
    <summary>{editor.warnings.length} warning(s) while parsing</summary>
    <ul>{#each editor.warnings as w}<li class="mono">{w}</li>{/each}</ul>
  </details>
{/if}

<textarea class="mono" spellcheck="false" value={text} oninput={(e) => (draft = (e.currentTarget as HTMLTextAreaElement).value)}></textarea>

<style>
  .bar {
    display: flex;
    gap: 6px;
    padding: 10px;
    border-bottom: 1px solid var(--line);
    align-items: center;
  }
  .grow {
    flex: 1;
  }
  .seg {
    display: flex;
  }
  .seg button {
    border-radius: 0;
    font-size: 12px;
  }
  .seg button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .seg button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
    border-left: none;
  }
  .seg button.on {
    background: var(--bg-4);
    border-color: var(--accent);
  }
  .apply {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    background: var(--accent-bg);
    font-size: 12px;
  }
  .apply span {
    flex: 1;
  }
  .error {
    padding: 8px 10px;
    background: var(--err-bg);
    color: var(--err-fg);
    font-size: 12px;
  }
  .warnings {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--warn);
  }
  .warnings ul {
    margin: 4px 0;
    padding-left: 18px;
    color: var(--text-2);
  }
  textarea {
    flex: 1;
    margin: 10px;
    resize: none;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    tab-size: 4;
  }
</style>
