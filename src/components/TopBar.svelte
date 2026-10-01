<script lang="ts">
  import { editor } from '../lib/store.svelte';
  import ThemePicker from './ThemePicker.svelte';

  let { onCommit }: { onCommit: () => void } = $props();

  let pickerOpen = $state(false);

  async function pick(name: string) {
    pickerOpen = false;
    if (editor.dirty && !confirm(`Discard uncommitted changes to "${editor.doc.name}" and load "${name}"?`)) return;
    await editor.loadBase(name);
  }

  const nameValid = $derived(/^[A-Za-z0-9][A-Za-z0-9_.+-]*$/.test(editor.doc.name));
</script>

<header>
  <div class="brand">
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path d="M4 1c0 4 8 4 8 7s-8 3-8 7M12 1c0 4-8 4-8 7s8 3 8 7" stroke="var(--accent)" stroke-width="2" fill="none" />
    </svg>
    <span>Helix Theme Editor</span>
  </div>

  <div class="base">
    <span class="label">Base</span>
    <div class="picker-wrap">
      <button class="base-btn" onclick={() => (pickerOpen = !pickerOpen)} title="Load a theme to start from">
        <span class="mono">{editor.doc.base ?? '—'}</span>
        <span class="caret">▾</span>
      </button>
      {#if pickerOpen}
        <ThemePicker onPick={pick} onClose={() => (pickerOpen = false)} />
      {/if}
    </div>
  </div>

  <div class="name">
    <span class="label">Save as</span>
    <input
      class="mono"
      class:invalid={!nameValid}
      bind:value={editor.doc.name}
      spellcheck="false"
      title="File name in ~/.config/helix/themes (without .toml)"
    />
    {#if editor.dirty}
      <span class="dirty" title="Uncommitted changes (kept in this browser only)">● modified</span>
    {:else}
      <span class="clean">saved</span>
    {/if}
  </div>

  <div class="spacer"></div>

  <div class="actions">
    <button class="ghost" disabled={!editor.canUndo} onclick={() => editor.undo()} title="Undo (Ctrl+Z)">↶ Undo</button>
    <button class="ghost" disabled={!editor.canRedo} onclick={() => editor.redo()} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
    <button
      class="ghost"
      disabled={!editor.dirty}
      onclick={() => confirm('Revert all uncommitted changes?') && editor.revert()}
      title="Discard changes since the base was loaded or last commit">Revert</button
    >
    <button class="primary" disabled={!nameValid} onclick={onCommit} title="Write the theme to disk (Ctrl+S)">Commit…</button>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  .label {
    color: var(--text-3);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-right: 6px;
  }
  .base,
  .name {
    display: flex;
    align-items: center;
  }
  .picker-wrap {
    position: relative;
  }
  .base-btn {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 180px;
    justify-content: space-between;
  }
  .caret {
    color: var(--text-3);
  }
  .name input {
    width: 200px;
  }
  .name input.invalid {
    border-color: var(--err);
  }
  .dirty {
    margin-left: 10px;
    color: var(--warn);
    font-size: 12px;
  }
  .clean {
    margin-left: 10px;
    color: var(--text-3);
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
</style>
