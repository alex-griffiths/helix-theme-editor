<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/store.svelte';

  let { onClose }: { onClose: () => void } = $props();

  const existing = $derived(editor.themes.find((t) => t.name === editor.doc.name));
  const baseInfo = $derived(editor.themes.find((t) => t.name === editor.doc.base));
  // Inheriting from yourself only works when another theme of that name exists further down the search path.
  const selfInherit = $derived(editor.doc.base === editor.doc.name);
  const canInherit = $derived(
    !!editor.doc.base && !!editor.baseDoc && (!selfInherit || baseInfo?.source === 'runtime'),
  );
  const reserved = $derived(['default', 'base16_default'].includes(editor.doc.name));
  const valid = $derived(/^[A-Za-z0-9][A-Za-z0-9_.+-]*$/.test(editor.doc.name) && !reserved);

  let inherit = $state(false);
  let activate = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let result = $state<{ path: string; backup: string | null } | null>(null);

  const overwriting = $derived(existing?.source === 'user');
  const shadowing = $derived(existing && existing.source !== 'user');
  const preview = $derived(editor.tomlFor(inherit && canInherit));

  onMount(() => editor.refreshThemes());

  async function commit() {
    saving = true;
    error = null;
    try {
      result = await editor.commit({ inherit: inherit && canInherit, overwrite: overwriting, activate });
      editor.notify('ok', `Saved ${result.path}`);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Commit theme">
    <h2>Commit theme</h2>
    {#if result}
      <p>Wrote <code>{result.path}</code>{#if result.backup}, previous version kept at <code>{result.backup}</code>{/if}.</p>
      <p class="muted">
        In Helix run <code>:theme {editor.doc.name}</code>{activate ? ' (also set in config.toml; :config-reload picks it up)' : ''}.
      </p>
      <div class="actions"><button class="primary" onclick={onClose}>Done</button></div>
    {:else}
      <label class="field">
        <span>Name</span>
        <input class="mono" bind:value={editor.doc.name} spellcheck="false" />
        <span class="ext mono">.toml</span>
      </label>
      <div class="notes">
        {#if !valid}
          <div class="note error">{reserved ? `'${editor.doc.name}' is Helix's built-in theme name.` : 'Use letters, digits, - _ . +'}</div>
        {:else if overwriting}
          <div class="note warn">Overwrites your existing theme at <code>{existing?.path}</code> (a .bak copy is kept).</div>
        {:else if shadowing}
          <div class="note">A {existing?.source} theme named “{editor.doc.name}” exists; yours will take precedence over it.</div>
        {/if}
        <div class="note faint">Target: <code>{editor.env?.userThemeDir}/{editor.doc.name}.toml</code></div>
      </div>

      <div class="modes">
        <label class="mode" class:on={!inherit}>
          <input type="radio" bind:group={inherit} value={false} />
          <div>
            <b>Standalone</b>
            <span class="muted">Every scope and palette entry written out in full.</span>
          </div>
        </label>
        <label class="mode" class:on={inherit} class:disabled={!canInherit}>
          <input type="radio" bind:group={inherit} value={true} disabled={!canInherit} />
          <div>
            <b>Inherit from “{editor.doc.base ?? '—'}”</b>
            <span class="muted">
              {#if canInherit}
                Writes <code>inherits = "{editor.doc.base}"</code> plus only what you changed.
              {:else}
                Unavailable: the theme would inherit from itself.
              {/if}
            </span>
          </div>
        </label>
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={activate} />
        Set as the active theme in <code>config.toml</code>
        {#if editor.env?.activeTheme}<span class="faint">(currently {editor.env.activeTheme})</span>{/if}
      </label>

      <details>
        <summary>Preview file ({preview.split('\n').length} lines)</summary>
        <pre class="mono">{preview}</pre>
      </details>

      {#if error}<div class="note error">{error}</div>{/if}

      <div class="actions">
        <button class="ghost" onclick={onClose}>Cancel</button>
        <button class="primary" disabled={!valid || saving} onclick={commit}>
          {saving ? 'Saving…' : overwriting ? 'Overwrite' : 'Save'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: #0009;
    display: grid;
    place-items: center;
    z-index: 80;
  }
  .dialog {
    width: min(620px, 92vw);
    max-height: 88vh;
    overflow: auto;
    background: var(--bg-2);
    border: 1px solid var(--line-2);
    border-radius: 10px;
    padding: 18px 20px;
    box-shadow: 0 20px 60px #000c;
  }
  h2 {
    margin: 0 0 14px;
    font-size: 16px;
  }
  code {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--bg);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .field input {
    flex: 1;
  }
  .ext {
    color: var(--text-3);
  }
  .notes {
    margin: 8px 0 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .note {
    font-size: 12px;
  }
  .note.warn {
    color: var(--warn);
  }
  .note.error {
    color: var(--err);
  }
  .modes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mode {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .mode.on {
    border-color: var(--accent);
    background: var(--bg-3);
  }
  .mode.disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mode div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12.5px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 14px 0 10px;
    font-size: 12.5px;
  }
  details {
    margin: 6px 0;
    font-size: 12.5px;
  }
  pre {
    max-height: 260px;
    overflow: auto;
    background: var(--bg);
    padding: 10px;
    border-radius: var(--radius);
    font-size: 11.5px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }
</style>
