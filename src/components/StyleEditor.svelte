<script lang="ts" module>
  import type { Style } from '../lib/theme';
  // Shared clipboard for copy/paste of styles between scopes.
  let clipboard = $state<{ style: Style | null }>({ style: null });
</script>

<script lang="ts">
  import { SCOPE_DESCRIPTIONS } from '../lib/scopes';
  import { editor } from '../lib/store.svelte';
  import { MODIFIERS, UNDERLINE_STYLES, isEmptyStyle, own as ownOf, resolveKey, type Modifier, type UnderlineStyle } from '../lib/theme';
  import ColorField from './ColorField.svelte';

  let { scope }: { scope: string } = $props();

  const own = $derived(ownOf(editor.doc.styles, scope));
  const fromKey = $derived(own ? scope : resolveKey(editor.doc, scope));
  const effective = $derived(fromKey ? editor.doc.styles[fromKey] : undefined);
  const baseStyle = $derived(ownOf(editor.baseDoc?.styles, scope));
  const changed = $derived(JSON.stringify(own ?? null) !== JSON.stringify(baseStyle ?? null));
  const languages = $derived(ownOf(editor.captures, scope));

  /** Copy-on-write: editing an inherited scope starts from the style it currently inherits. */
  function update(fn: (s: Style) => void, key?: string) {
    const next: Style = JSON.parse(JSON.stringify(own ?? effective ?? {}));
    fn(next);
    if (next.underline && !next.underline.color && !next.underline.style) delete next.underline;
    if (next.modifiers && !next.modifiers.length) delete next.modifiers;
    if (!next.fg) delete next.fg;
    if (!next.bg) delete next.bg;
    editor.setStyle(scope, next, key ?? `style:${scope}`);
  }

  function toggleModifier(m: Modifier) {
    update((s) => {
      const mods = new Set(s.modifiers ?? []);
      if (mods.has(m)) mods.delete(m);
      else mods.add(m);
      s.modifiers = MODIFIERS.filter((x) => mods.has(x));
    }, `mod:${scope}:${m}:${Date.now()}`);
  }

  function resetToBase() {
    editor.setStyle(scope, baseStyle ? JSON.parse(JSON.stringify(baseStyle)) : null, `reset:${Date.now()}`);
  }
</script>

<div class="editor">
  {#if ownOf(SCOPE_DESCRIPTIONS, scope)}
    <div class="desc">{ownOf(SCOPE_DESCRIPTIONS, scope)}</div>
  {/if}
  <div class="status">
    {#if own}
      {#if isEmptyStyle(own)}
        <span class="badge warn" title="An empty style stops fallback to parent scopes">set (empty — blocks fallback)</span>
      {:else}
        <span class="badge set">set</span>
      {/if}
    {:else if fromKey}
      <span class="badge">inherits from <button class="link mono" onclick={() => (editor.selected = fromKey)}>{fromKey}</button></span>
      <span class="faint">editing creates an override</span>
    {:else}
      <span class="badge">not set</span>
    {/if}
    {#if languages}
      <span class="faint langs" title={languages.join(', ')}>used by {languages.length} language{languages.length === 1 ? '' : 's'}</span>
    {/if}
  </div>

  <ColorField
    label="Foreground"
    value={effective?.fg}
    inherited={!own}
    editKey="{scope}:fg"
    onChange={(v, key) => update((s) => (s.fg = v), key)}
  />
  <ColorField
    label="Background"
    value={effective?.bg}
    inherited={!own}
    editKey="{scope}:bg"
    onChange={(v, key) => update((s) => (s.bg = v), key)}
  />
  <ColorField
    label="Underline"
    value={effective?.underline?.color}
    inherited={!own}
    editKey="{scope}:ul"
    onChange={(v, key) =>
      update((s) => {
        s.underline = { ...s.underline, color: v };
        if (!v) delete s.underline.color;
      }, key)}
  />
  <div class="field">
    <span class="label">Line style</span>
    <select
      value={effective?.underline?.style ?? ''}
      onchange={(e) =>
        update((s) => {
          const v = (e.currentTarget as HTMLSelectElement).value as UnderlineStyle | '';
          s.underline = { ...s.underline, style: v || undefined };
          if (!v) delete s.underline.style;
        })}
    >
      <option value="">none</option>
      {#each UNDERLINE_STYLES as u}<option value={u}>{u}</option>{/each}
    </select>
  </div>
  <div class="field">
    <span class="label">Modifiers</span>
    <div class="mods">
      {#each MODIFIERS as m}
        <button class="mod" class:on={effective?.modifiers?.includes(m)} class:inherited={!own} onclick={() => toggleModifier(m)}>
          {m.replace('_', ' ')}
        </button>
      {/each}
    </div>
  </div>

  <div class="actions">
    <button class="ghost" onclick={() => (clipboard.style = effective ? JSON.parse(JSON.stringify(effective)) : null)} title="Copy this style">Copy</button>
    <button class="ghost" disabled={!clipboard.style} onclick={() => editor.setStyle(scope, JSON.parse(JSON.stringify(clipboard.style)), `paste:${Date.now()}`)}>Paste</button>
    {#if !own}
      <button class="ghost" onclick={() => editor.setStyle(scope, {}, `empty:${Date.now()}`)} title="Set an empty style, which prevents fallback to the parent scope">Set empty</button>
    {/if}
    <div class="grow"></div>
    {#if changed}
      <button class="ghost" onclick={resetToBase} title="Restore the value from the base theme">Reset to base</button>
    {/if}
    {#if own}
      <button class="ghost danger" onclick={() => editor.setStyle(scope, null, `rm:${Date.now()}`)} title="Remove this key so the scope falls back to its parent">Remove</button>
    {/if}
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px 12px;
    background: var(--bg-3);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .desc {
    color: var(--text-2);
    font-size: 12px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    flex-wrap: wrap;
  }
  .badge {
    background: var(--bg-4);
    border-radius: 10px;
    padding: 1px 8px;
    color: var(--text-2);
  }
  .badge.set {
    background: var(--accent-bg);
    color: var(--accent-fg);
  }
  .badge.warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .langs {
    margin-left: auto;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    width: 62px;
    color: var(--text-2);
    font-size: 12px;
    flex: none;
  }
  select {
    flex: 1;
  }
  .mods {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .mod {
    font-size: 11.5px;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--bg);
  }
  .mod.on {
    background: var(--accent-2);
    border-color: var(--accent);
    color: var(--bg);
  }
  .mod.on.inherited {
    opacity: 0.7;
    border-style: dashed;
  }
  .actions {
    display: flex;
    gap: 4px;
    margin-top: 2px;
  }
  .actions button {
    font-size: 12px;
    padding: 3px 8px;
  }
  .grow {
    flex: 1;
  }
</style>
